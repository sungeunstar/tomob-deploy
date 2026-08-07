// grade.js — 화면 전체 컬러 그레이딩 포스트 패스 (2026-07-24 신설)
//   발단: 사령관 "게임 특유의 색감이 없다, 너무 밝다"(Sea of Thieves 레퍼런스). 분석=`_색감_레퍼런스.md`.
//   진단(실측): 우리 낮 화면은 흑점이 8.4배 들려 있고(그림자 비중 1/30) p50이 3.9배 밝으며 채도 0.67배,
//     비네팅은 역전(모서리가 중앙보다 밝음). 원인 = **화면 전체 그레이딩 패스가 0개**였다.
//     ACES 톤매핑만 있었고 그건 설계상 "색을 입히지 않는" 매퍼다.
//
//   구조(★렌더 파이프라인 침습 — 주의):
//     magic.js가 ctx.setRenderOverride()로 최종 렌더를 소유한다(마법 블룸 합성). 그 출력이 **화면에 직접** 그려진다.
//     그레이딩을 걸려면 씬을 렌더타겟에 받아야 한다 → magic의 override를 이 모듈이 **감싼다**:
//         setRenderTarget(_rt) → (magic override 또는 renderer.render) → setRenderTarget(null) → gradeQuad(화면)
//     magic이 내부에서 `setRenderTarget(null)`로 화면을 강제하던 한 줄만 `ctx._gradeRT ?? null`로 바꿔
//     base+글로우가 _rt에 담기게 했다(magic.js). _gradeRT가 없으면(이 모듈 미로드) 기존 동작 그대로 = 안전.
//
//   색공간: _rt는 NoColorSpace(기본) → renderer가 톤매핑된 **linear 값**을 저장한다. 셰이더가 sRGB로 인코딩한 뒤
//     감마공간에서 그레이딩한다(lift/gain·대비·채도·색온도·비네팅은 디스플레이 감마공간이 통념 — DaVinci 등).
//   ⚠️착수 순서(사령관 컨펌): 이번엔 **낮 프리셋 1차 제안값**으로 before/after를 만든다. 항목별 라이브 훅
//     `window.__grade(...)`로 하나씩 끄며 판정(visual-one-change-at-a-time). 확정값은 BAL.grading으로.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BAL } from './balance.js';

export function initGrade(ctx){
  const r = ctx.renderer, scene = ctx.scene, camera = ctx.camera;
  const G = (BAL && BAL.grading) ? BAL.grading : {};

  // ── 렌더타겟(화면 픽셀수와 동일) ──
  const _sz = new THREE.Vector2();
  r.getSize(_sz);
  const dpr = r.getPixelRatio();
  //   ★2026-07-24 AO: RT에 DepthTexture를 붙여 이 패스 안에서 SSAO를 계산한다(추가 풀스크린 패스 0개).
  //   magic override가 bloom 유무와 무관하게 씬을 이 rt에 실제 깊이와 함께 렌더하므로(magic.js:64/77) 깊이가 유효.
  const mkRT = () => {
    const t = new THREE.WebGLRenderTarget(Math.max(1, Math.round(_sz.x*dpr)), Math.max(1, Math.round(_sz.y*dpr)),
      { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, type:THREE.UnsignedByteType, depthBuffer:true });
    t.depthTexture = new THREE.DepthTexture(t.width, t.height);
    t.depthTexture.type = THREE.UnsignedIntType;   // perspective near0.1/far8000 — 근거리 AO엔 충분
    return t;
  };
  let rt = mkRT();
  ctx._gradeRT = rt;   // ★magic.js가 최종 base+글로우를 여기 그린다(setRenderTarget(ctx._gradeRT ?? null))

  // ── AO 렌더타겟(SSAO 결과 저장 — 별도 패스 → grade에서 블러/적용) ──
  //   ★2026-07-25 노이즈 수정: 8샘플 SSAO를 grade 안에 인라인하니 픽셀별 회전노이즈가 블러 없이 그대로 나와
  //     "TV 노이즈"처럼 지글거렸다(사령관 지적). 표준 SSAO대로 **AO 전용 패스 → grade에서 16탭 블러**로 분리.
  const mkAO = () => new THREE.WebGLRenderTarget(rt.width, rt.height,
    { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, type:THREE.UnsignedByteType, depthBuffer:false });
  let aoRT = mkAO();

  // ── AO 패스 유니폼(깊이→뷰공간 SSAO, strength 미적용=grade에서 적용) ──
  const aoUni = {
    tDepth:     { value: rt.depthTexture },
    uProj:      { value: new THREE.Matrix4() },
    uProjInv:   { value: new THREE.Matrix4() },
    uRes:       { value: new THREE.Vector2(rt.width, rt.height) },
    uAoRadius:  { value: G.aoRadius ?? 1.0 },       // 접촉부만 잡고 넓은 먹구름형 음영은 만들지 않음
    uAoBias:    { value: G.aoBias ?? 0.08 },        // 로우폴리 면의 self-occlusion 억제
    uAoFar:     { value: G.aoFar ?? 110 },          // 원거리 깊이 오차가 그림자처럼 보이지 않게 조기 페이드
  };
  const aoQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: aoUni, depthTest:false, depthWrite:false,
    extensions:{ derivatives:true },                   // dFdx/dFdy(뷰공간 flat 노멀) — GLSL1 안전
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader:`
      uniform sampler2D tDepth; uniform mat4 uProj, uProjInv;
      uniform float uAoRadius,uAoBias,uAoFar; uniform vec2 uRes;
      varying vec2 vUv;
      vec3 viewPos(vec2 uv, float d){                     // 깊이(NDC z)→뷰공간. 카메라는 -Z.
        vec4 ndc = vec4(uv*2.0-1.0, d*2.0-1.0, 1.0);
        vec4 vp = uProjInv * ndc; return vp.xyz / vp.w;
      }
      void main(){
        float dC = texture2D(tDepth, vUv).x;
        if(dC >= 0.9999){ gl_FragColor = vec4(1.0); return; }   // 하늘/원경 = 차폐 없음
        vec3 P = viewPos(vUv, dC);
        if(-P.z > uAoFar + 40.0){ gl_FragColor = vec4(1.0); return; }
        vec3 n = normalize(cross(dFdx(P), dFdy(P)));        // flat 노멀(로우폴리 적합)
        float rnd = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);  // 회전노이즈(블러가 편다)
        vec3 up = abs(n.y) < 0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
        vec3 T = normalize(cross(up, n)); vec3 B = cross(n, T);
        float occ = 0.0; const int NS = 8;
        for(int i=0;i<NS;i++){
          float fi = float(i);
          float ang = fi * 2.3999632 + rnd*6.2831;          // 골든앵글 나선
          float rad = sqrt((fi+0.5)/float(NS));
          vec3 dir = vec3(cos(ang)*rad, sin(ang)*rad, sqrt(max(0.0,1.0-rad*rad)));  // z-up 반구
          vec3 sv = P + (T*dir.x + B*dir.y + n*dir.z) * uAoRadius;
          vec4 sp = uProj * vec4(sv, 1.0); sp.xyz /= sp.w;
          vec2 suv = sp.xy*0.5 + 0.5;
          if(suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) continue;
          float surfZ = viewPos(suv, texture2D(tDepth, suv).x).z;
          float rangeCheck = smoothstep(0.0, 1.0, uAoRadius / max(0.001, abs(P.z - surfZ)));
          occ += (surfZ >= sv.z + uAoBias ? 1.0 : 0.0) * rangeCheck;
        }
        float ao01 = 1.0 - occ/float(NS);                    // strength는 grade에서 적용(라이브 튜닝)
        float distFade = 1.0 - smoothstep(uAoFar*0.6, uAoFar, -P.z);
        gl_FragColor = vec4(vec3(mix(1.0, ao01, distFade)), 1.0);
      }`,
  }));

  // ── 그레이딩 셰이더 (감마공간 작업) ──
  const uni = {
    tDiffuse:   { value: rt.texture },
    // ★2026-07-24 Phase 4 재설계 — 기본 ON. 이전 실패(어둡게 pivot0.42 + 비네팅0.34 + 대비1.18)는
    //   나무를 검게 죽이고 칙칙하게 만들었다. SoT는 어둡지 않다 — **밝게 유지 + 따뜻 + 부드러운 대비 + 채도**.
    //   ⚠️로우폴리 flat shading은 대비를 세우면 그림자면이 검정으로 클리핑된다 → 대비는 아주 약하게.
    //   ★2026-07-24 기본 OFF — 후처리로 색을 만들려던 접근 자체가 문제였다(채도 올리면 형광·내리면 바램).
    //   색은 소스(머티리얼)+조명(warm/cool)에서 잡는다. 그레이딩은 __grade(1)로 미세보정만. 시간대 fade는 유지.
    //   ★2026-07-27 팰월드 톤 사다리 "중" 적용 — 위 "기본 OFF" 판단은 **도구가 없어서** 나온 것이었다.
    //     당시엔 밝기를 내리는 감마 항이 없어 채도만 만질 수 있었고, 그래서 올리면 형광·내리면 바램이었다.
    //     감마(uGamma)와 미드톤 tint(uMidTint)가 생긴 지금은 밝기·색온도를 정공법으로 만질 수 있다.
    //     ⚠️uEnabled 초기값 0은 그대로 두지만 onUpdate가 `_baseOn(=1)×dayF`로 덮어쓴다 → **낮엔 ON**이다.
    uEnabled:   { value: 0.0 },
    // 흑점/백점(lift·gain) — 나무가 이미 어두우니 흑점 거의 안 건드림(검정 더 죽이지 않게)
    uBlack:     { value: G.black ?? 0.02 },
    uWhite:     { value: G.white ?? 1.0 },
    // ★2026-07-27 신설 — 감마(lift/gamma/gain의 gamma). **밝기를 내리는 유일한 도구.**
    //   발단: 팰월드 피팅이 수렴 실패. 우리 p50 0.551 vs 팰월드 0.214(2.6배 밝음)인데
    //   기존 도구(lift/gain·대비·채도)로는 black·contrast·pivot을 **범위 끝까지 밀고도** p50 0.443이 한계였다.
    //   lift/gain은 흑점을 올리면 오히려 중간톤을 밝히고, 대비 pivot은 밝기 이동폭이 작다.
    //   ⇒ `pow(c, gamma)`가 필요하다. gamma>1이면 **검정·흰색은 그대로 두고 중간톤만 내린다**(클리핑 없음).
    //   사령관 2026-07-24 지적 "환경 자체가 너무 밝고"가 여기서 처음 실제로 다뤄진다.
    //   ⚠️기본값 1.0 = 무변경.
    uGamma:     { value: G.gamma ?? 1.24 },        // 중간톤 과압축 완화 — 원색이 검고 쨍하게 갈라지지 않게
    // 대비 — 아주 약하게(1.0=무변). 로우폴리는 세우면 검정 죽음. pivot 0.5=밝기 유지.
    uContrast:  { value: G.contrast ?? 1.04 },
    uPivot:     { value: G.pivot ?? 0.45 },
    // 채도(휘도 보존) — 원색 에셋의 국부 채도를 먼저 눌러 형광 잔디·짙은 수관을 완화한다.
    //   화면 평균 통계는 하늘·바다 비중에 오염되므로 레퍼런스 평균에 맞춰 채도를 올리지 않는다.
    uSat:       { value: G.sat ?? 0.92 },
    // ★색온도 분리(리서치 ★2 — 스타일라이즈드 심장) — 그림자=cool(파랑↑) / 하이라이트=warm(주황↑).
    //   ⚠️전역 warm(uTemp)은 제거했다 — 그림자까지 데워 warm/cool 대비를 죽였다. 분리가 정석.
    //   ★2026-07-27 목표 룩이 팰월드로 바뀌며 방향 반전 — 팰월드는 **그림자도 살짝 따뜻**(shadow warm +0.039)하고
    //     중간톤이 강하게 따뜻(+0.139)하다. SoT식 "cool 그림자"는 대조군으로만 남긴다(`_색감_레퍼런스.md` §1-B).
    uShadowTint:{ value: new THREE.Color(...(G.shadowTint ?? [  0.004, 0.001,-0.004 ])) },
    uHighTint:  { value: new THREE.Color(...(G.highTint   ?? [  0.003, 0.001,-0.003 ])) },
    // ★2026-07-27 신설 — 미드톤 tint. 목표 룩이 팰월드로 바뀌면서 필요해졌다(`_색감_레퍼런스.md` §1-B).
    //   기존 가중은 shadowW=1-smoothstep(0,0.45,lum) / highW=smoothstep(0.55,1,lum)이라
    //   **lum≈0.5에서 둘 다 0 = 중간톤엔 tint가 한 톨도 안 걸렸다.**
    //   그런데 팰월드 룩의 핵심이 mid warm +0.139(따뜻한 햇살)다 → 파라미터 조정만으론 표현 불가라 항을 추가한다.
    //   ⚠️기본값 0 = 무변경. 값을 넣기 전까지 기존 화면과 100% 동일하다.
    uMidTint:   { value: new THREE.Color(...(G.midTint    ?? [  0.012, 0.004,-0.012 ])) },
    // 비네팅 — 아주 약하게(은은한 시선 집중, 답답하지 않게)
    uVignette:  { value: G.vignette ?? 0.10 },
    uVigStart:  { value: G.vigStart ?? 0.45 },
    // ── SSAO 적용(2026-07-25) — aoRT(전용 패스)를 16탭 블러로 펴서 곱한다. 그레이딩(uEnabled)과 독립 — 밤에도 적용.
    tAO:        { value: aoRT.texture },
    uRes:       { value: new THREE.Vector2(rt.width, rt.height) },
    uAoOn:      { value: (G.aoOn ?? 1) },
    uAoStrength:{ value: G.aoStrength ?? 0.75 },    // 접지만 남기고 로우폴리 면의 과한 얼룩·먹먹함 완화
  };
  const gradeQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: uni, depthTest:false, depthWrite:false,
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader:`
      uniform sampler2D tDiffuse; uniform float uEnabled;
      uniform float uBlack,uWhite,uGamma,uContrast,uPivot,uSat,uVignette,uVigStart;
      uniform vec3 uShadowTint,uMidTint,uHighTint;
      uniform sampler2D tAO; uniform float uAoOn,uAoStrength; uniform vec2 uRes;
      varying vec2 vUv;
      const vec3 LW = vec3(0.2126,0.7152,0.0722);
      // AO 4x4(16탭) 블러 — SSAO 회전노이즈 제거(사령관 "노이즈 가득" 수정). step 1.5px.
      float aoBlur(){
        vec2 texel = 1.5 / uRes; float s = 0.0;
        for(int y=-2;y<2;y++) for(int x=-2;x<2;x++)
          s += texture2D(tAO, vUv + vec2(float(x)+0.5, float(y)+0.5)*texel).r;
        return s / 16.0;
      }
      void main(){
        vec3 src = texture2D(tDiffuse, vUv).rgb;           // RT는 이미 sRGB(디스플레이) 값 — renderer가 인코딩해 저장
        if(uAoOn > 0.5){                                    // ★AO는 그레이딩과 독립 — 항상(밤 포함) 적용
          float ao = 1.0 - (1.0 - aoBlur()) * uAoStrength;
          src *= clamp(ao, 0.0, 1.0);
        }
        if(uEnabled < 0.002){ gl_FragColor = vec4(src,1.0); return; }   // 완전 off(밤/노을 자동 fade 포함)=원본 패스스루
        vec3 c = clamp(src, 0.0, 1.0);                      // ★감마공간 그대로 그레이딩(pow 제거 — 이중감마가 원본을 밝히고 탈채했었다)
        // ① lift/gain: 흑점·백점 정규화(들린 검정을 0으로)
        c = clamp((c - uBlack) / max(1e-4, (uWhite - uBlack)), 0.0, 1.0);
        // ①-b 감마(lift/gamma/gain의 gamma) — 밝기 조절. 1.0=무변, >1이면 중간톤만 어두워진다(0과 1은 고정점).
        if(uGamma < 0.999 || uGamma > 1.001) c = pow(c, vec3(uGamma));
        // ② 대비 S커브(pivot 중심 거듭제곱 대비)
        c = clamp((c - uPivot) * uContrast + uPivot, 0.0, 1.0);
        // ③ 채도(휘도 보존) — 낮춰서 형광 제거
        float l = dot(c, LW);
        c = mix(vec3(l), c, uSat);
        // ④ 색온도 분리 — 그림자/하이라이트에 각각 tint(luma 가중)
        float lum = dot(c, LW);
        float shadowW = 1.0 - smoothstep(0.0, 0.45, lum);   // 어두울수록 1
        float highW   = smoothstep(0.55, 1.0, lum);         // 밝을수록 1
        // ★미드톤 가중 = 나머지 전부. shadowW는 lum<0.45에서만, highW는 lum>0.55에서만 0이 아니므로
        //   둘이 동시에 켜지지 않는다 → 세 가중의 합은 항상 1(구멍 없는 분할). lum≈0.5에서 midW=1.
        float midW    = 1.0 - shadowW - highW;
        c += uShadowTint * shadowW + uMidTint * midW + uHighTint * highW;
        // ⑤ 비네팅(모서리 어둡게 — 시선 집중)
        float d = distance(vUv, vec2(0.5));
        float vig = 1.0 - uVignette * smoothstep(uVigStart, 0.75, d);
        c *= vig;
        // ★강도 = uEnabled(0~1). 낮 1 → 노을/밤 0(자동 fade, sky._sunBase 구동). 노을을 탈색시키지 않는다.
        c = mix(src, clamp(c, 0.0, 1.0), uEnabled);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));

  // ── 시간대 자동 fade — 낮에만 그레이딩, 노을/밤엔 자동으로 빠진다(노을 탈색 방지) ──
  //   sky._sunBase = max(0,elev)*1.55+0.04. 정오 1.55 · 노을 진입 ~0.6 · 밤 0.04.
  //   smoothstep(0.6,1.15): 낮 대부분 full → 노을 들어가며 0으로. _baseOn은 __grade 수동 토글.
  // 사령관 실플레이 판정: 캐릭터·땅·나무 전체 색이 함께 망가짐.
  // 전역 팰월드 필터는 기본 OFF. 원본 재질+본편 조명은 통과시키고 AO만 독립 유지한다.
  let _baseOn = 0;
  let _aoOn = uni.uAoOn.value;                       // AO 수동 토글 상태(__ao). 던전 가드와 별개.
  let _aoActive = _aoOn > 0.5;                        // 이번 프레임 AO 패스 렌더 여부(off/던전이면 스킵=성능)
  ctx.onUpdate(() => {
    const sb = (ctx.sky && ctx.sky._sunBase != null) ? ctx.sky._sunBase : 1.5;
    const dayF = THREE.MathUtils.smoothstep(sb, 0.6, 1.15);
    uni.uEnabled.value = _baseOn * dayF;
    // AO용 카메라 투영행렬(SSAO 깊이→뷰공간 재구성). 매 프레임 카메라가 움직이므로 갱신.
    aoUni.uProj.value.copy(camera.projectionMatrix);
    aoUni.uProjInv.value.copy(camera.projectionMatrixInverse);
    // 던전 안에선 AO 끔(자체 광원 다수 + 성능). 오버월드만.
    const on = ((ctx.dungeon && ctx.dungeon.active) ? 0 : _aoOn) > 0.5;
    _aoActive = on;
    uni.uAoOn.value = on ? 1 : 0;
  });

  // ── magic override 감싸기 (+ AO 전용 패스) ──
  const inner = ctx.getRenderOverride ? ctx.getRenderOverride() : null;   // magic이 설정한 것(없으면 null)
  ctx.setRenderOverride(() => {
    r.setRenderTarget(rt);
    r.clear();
    if(inner) inner();                     // magic 경로: base(+글로우)를 rt에 그림(magic.js 1줄 수정 덕에 화면 아닌 rt로)
    else r.render(scene, camera);          // magic 미로드 폴백
    if(_aoActive){                         // AO 패스: rt.depthTexture로 SSAO → aoRT (off/던전이면 스킵)
      r.setRenderTarget(aoRT);
      aoQuad.render(r);
    }
    r.setRenderTarget(null);
    gradeQuad.render(r);                    // rt.texture 그레이딩 + aoRT 블러 곱 → 화면
  });

  addEventListener('resize', () => {
    r.getSize(_sz); const d = r.getPixelRatio();
    rt.setSize(Math.max(1, Math.round(_sz.x*d)), Math.max(1, Math.round(_sz.y*d)));
    aoRT.setSize(rt.width, rt.height);
    uni.tDiffuse.value = rt.texture;
    uni.tAO.value = aoRT.texture;
    aoUni.tDepth.value = rt.depthTexture;            // setSize가 depthTexture도 리사이즈(객체 동일)
    uni.uRes.value.set(rt.width, rt.height);
    aoUni.uRes.value.set(rt.width, rt.height);
  });

  // ── 🎛️ 라이브 튜닝 훅(사령관 눈 판정) ──
  //   __grade(0/1) = 통째 on/off (before/after 즉시 대조). __grade({black:.., sat:.., ...}) = 개별 조정.
  //   개별 A/B: __grade({vignette:0}) 처럼 한 항만 0으로 꺼보면 그 항의 기여가 바로 보인다.
  try{
    window.__grade = v => {
      if(v === 0 || v === false){ _baseOn = 0; uni.uEnabled.value = 0; return 'OFF'; }
      if(v === 1 || v === true || v == null){ if(v!=null) _baseOn = 1; }
      if(typeof v === 'object'){
        _baseOn = 1;
        const set = (k,u)=>{ if(v[k]!=null) uni[u].value = +v[k]; };
        set('black','uBlack'); set('white','uWhite'); set('gamma','uGamma');
        set('contrast','uContrast'); set('pivot','uPivot');
        set('sat','uSat'); set('vignette','uVignette'); set('vigStart','uVigStart');
        if(v.shadowTint) uni.uShadowTint.value.setRGB(...v.shadowTint);
        if(v.midTint)    uni.uMidTint.value.setRGB(...v.midTint);
        if(v.highTint)   uni.uHighTint.value.setRGB(...v.highTint);
      }
      return { enabled:uni.uEnabled.value, black:uni.uBlack.value, white:uni.uWhite.value,
        gamma:uni.uGamma.value, contrast:uni.uContrast.value, pivot:uni.uPivot.value, sat:uni.uSat.value,
        vignette:uni.uVignette.value, vigStart:uni.uVigStart.value,
        shadowTint:[uni.uShadowTint.value.r,uni.uShadowTint.value.g,uni.uShadowTint.value.b].map(x=>+x.toFixed(3)),
        midTint:[uni.uMidTint.value.r,uni.uMidTint.value.g,uni.uMidTint.value.b].map(x=>+x.toFixed(3)),
        highTint:[uni.uHighTint.value.r,uni.uHighTint.value.g,uni.uHighTint.value.b].map(x=>+x.toFixed(3)) };
    };
    // AO 토글/튜닝 — __ao(0/1) on·off, __ao({radius,strength,bias,far}) 개별.
    window.__ao = v => {
      if(v === 0 || v === false){ _aoOn = 0; return 'AO OFF'; }
      if(v === 1 || v === true || v == null){ _aoOn = 1; }
      if(typeof v === 'object'){
        _aoOn = 1;
        if(v.strength!=null) uni.uAoStrength.value = +v.strength;   // 강도는 grade 패스(라이브)
        if(v.radius!=null)   aoUni.uAoRadius.value = +v.radius;     // 반경/바이어스/페이드는 AO 패스
        if(v.bias!=null)     aoUni.uAoBias.value   = +v.bias;
        if(v.far!=null)      aoUni.uAoFar.value    = +v.far;
      }
      return { on:_aoOn, radius:aoUni.uAoRadius.value, strength:uni.uAoStrength.value, bias:aoUni.uAoBias.value, far:aoUni.uAoFar.value };
    };
  }catch(_){}

  console.log('[grade] 컬러 그레이딩+AO 패스 활성 — __grade(0)/__ao(0)로 원본 대조');
  ctx.grade = { get rt(){ return rt; }, uni, quad:gradeQuad,
    setEnabled: on => { uni.uEnabled.value = on ? 1 : 0; } };
  return ctx.grade;
}

// [근거]
// 확정: 화면 전체 그레이딩 패스 부재가 "색감 없음"의 원인(실측 _색감_레퍼런스.md §3). ACES는 색을 안 입힘.
// 확정: magic.js가 setRenderOverride 점유 → 감싸는 방식이 유일하게 안전(체인). magic.js setRenderTarget 1줄 수정 동반.
// 제안: 낮 프리셋 1차값(black .045·white .98·contrast 1.18·pivot .42·sat 1.16·vignette .34) — 사령관 눈 판정으로 확정.
