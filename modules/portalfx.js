// portalfx.js — 문틀 안쪽에 생기는 "포탈 막" VFX. 보스방 게이트(bossgate.glb) 개구부용.
// ─────────────────────────────────────────────────────────────────────────────
// ★정본 = modules/gate.js(차원문). 기법을 그대로 계승한다:
//     NOISE(fbm) 스크롤 + 다층 ShaderMaterial + AdditiveBlending + 코어/림 + 유니폼 공유(clone 금지).
//   ⛔ 단색 MeshBasic Plane/Torus 금지(사령관 "짜친다" 반복 지적 — feedback_threejs_no_cheap_fx).
//
// 차원문(하늘의 소용돌이)과 다른 점 = **문(門)이라서 흐름이 다르다**:
//   · 소용돌이는 원반이 도는 그림. 문은 **개구부를 채운 수직 막**이 서 있는 그림이다.
//   · 그래서 회전 나선 대신 **위로 흐르는 커튼(상승류) + 개구부 테두리를 타고 도는 림**을 주축으로 짰다.
//   · 문틀 모양을 따르도록 마스크는 원이 아니라 **초타원(superellipse)** — 아치형/사각형 개구부 모두 맞는다.
//
// 구조(뒤 → 앞):
//   ① veil   : 깊이 3겹. 뒤로 갈수록 어둡고 느리게 흘러 **막 너머의 공간감**(시차)을 만든다.
//   ② core   : 개구부 중앙의 밝은 에너지 — 숨쉬듯 맥동.
//   ③ rim    : 개구부 테두리를 타고 도는 밝은 띠 + 바깥으로 새는 헤일로.
//   ④ light  : PointLight 1개(상주 — add/remove 반복 금지. 밝기만 0↔값으로 조절).
//              ⚠️라이트 add/remove = 씬 전체 셰이더 재컴파일(voyage-light-recompile-trap) → 반드시 상주.
import * as THREE from 'three';

// gate.js와 동일한 fbm 정본(값 노이즈 5옥타브). 셰이더 간 결이 통일돼야 톤이 맞는다.
const NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+11.7;a*=.5;}return v;}
// 초타원 거리 — n=2면 타원, n이 크면 모서리가 각진 사각형. 문틀 개구부 모양에 맞춘다.
float sedist(vec2 p, float n){ return pow(pow(abs(p.x),n)+pow(abs(p.y),n), 1.0/n); }
`;

const VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

/**
 * 문틀 개구부를 채우는 포탈 막을 만든다.
 * @param {object} o
 *   w,h      개구부 폭/높이(m)
 *   glow     밝은 쪽 색(코어·림)
 *   deep     어두운 쪽 색(막 안쪽)
 *   shape    초타원 지수. 2=타원 · 4~6=모서리 둥근 사각(문틀 기본) · 크면 각진 사각
 *   light    PointLight 사용 여부(기본 true)
 * @returns { group, U, update(dt), setOpen(v), dispose() }
 */
export function createPortal(o = {}){
  const w = o.w || 6, h = o.h || 9;
  const glow = new THREE.Color(o.glow != null ? o.glow : 0x63e0ff);
  const deep = new THREE.Color(o.deep != null ? o.deep : 0x1b2f8a);
  // ★초타원 지수 — 2=타원 · 4=알약처럼 매우 둥금 · 6~8=모서리만 둥근 사각(문 개구부에 맞음) · 크면 각진 사각.
  //   4로 렌더해보니 문이라기보다 캡슐로 보였다 → 기본을 6으로 올림.
  const shape = o.shape != null ? o.shape : 6.0;

  // ★유니폼 공유 — 겹마다 clone 하면 uTime 링크가 끊겨 층이 따로 논다(gate.js 주석의 함정 그대로).
  // ★uScale = (그 판의 크기) / (개구부 크기). 판마다 크기가 달라도 dA==1 이 **항상 개구부 테두리**가 되게 정규화한다.
  //   ⚠️2026-07-22 1차 렌더에서 발각된 버그: 마스크를 `sedist(q)/max(uAspect,1)` 로 잡았더니 uAspect<1(세로로 긴 문)일 때
  //     가로 방향이 영원히 1에 도달하지 못해 **좌우로 안 잘리고 문틀 밖으로 샜다.** 종횡비는 노이즈 등방성에만 쓰고,
  //     마스크는 판의 정규좌표 p로만 잡아야 한다.
  const U = {
    uTime: { value: 0 },
    uOpen: { value: 0 },            // 0=닫힘(투명) → 1=완전 개방. 문 애니와 함께 올린다.
    uGlow: { value: glow.clone() },
    uDeep: { value: deep.clone() },
    uAspect: { value: w / h },      // 노이즈 등방성 보정 전용(마스크에 쓰지 말 것)
    uShape: { value: shape },
    uScale: { value: 1 },
    uDepth: { value: 0 },           // 겹마다 덮어쓸 값(0=앞, 1=뒤) — 겹별 머티리얼에서만 다름
  };
  const group = new THREE.Group();

  // ── ① 막(veil) 3겹 — 뒤로 갈수록 느리고 어둡게. 겹 사이 간격이 시차를 만들어 "깊이 있는 구멍"으로 읽힌다.
  const VEIL_LAYERS = 3, VEIL_GAP = Math.min(w, h) * 0.14;
  const veilGeo = new THREE.PlaneGeometry(w, h, 1, 1);
  const veilMats = [];
  for(let i = 0; i < VEIL_LAYERS; i++){
    const t = i / (VEIL_LAYERS - 1);   // 0=앞, 1=뒤
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, U, { uDepth: { value: t }, uScale: { value: 1.0 } }),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false, vertexShader: VS,
      fragmentShader: NOISE + `
        varying vec2 vUv; uniform float uTime,uOpen,uAspect,uShape,uScale,uDepth; uniform vec3 uGlow,uDeep;
        void main(){
          vec2 p=(vUv-0.5)*2.0;
          float dA=sedist(p, uShape)*uScale;                    // ★개구부 정규화 거리(1=테두리). 종횡비를 섞지 않는다.
          if(dA>1.0) discard;
          vec2 q=vec2(p.x*uAspect, p.y);                        // 노이즈 등방성 보정(문이 세로로 길어도 결이 안 늘어남)
          float sp = mix(1.0, 0.45, uDepth);                    // 뒤 겹일수록 느리게 = 시차(깊이감)
          // ★핵심 수정 — 등방성 fbm은 그냥 '연기 구름'이 된다(1차 렌더에서 확인).
          //   x 주파수를 y보다 훨씬 높게 잡아 **세로로 길게 늘어진 필라멘트**를 만들고, y를 시간으로 밀어 위로 흐르게 한다.
          vec2 nc = vec2(q.x*4.6, q.y*1.0 - uTime*0.62*sp);
          float s1 = fbm(nc);
          float s2 = fbm(nc*2.35 + vec2(11.3, -uTime*0.44*sp));
          // ★대비는 pow가 아니라 smoothstep으로 — pow(x,1.9)는 fbm의 평균대(0.5 부근)를 통째로 눌러버려
          //   2차 렌더에서 막이 거의 안 보였다. smoothstep은 중간대를 0~1로 펴줘서 결이 살아난다.
          float streak = smoothstep(0.26, 0.78, s1*0.62 + s2*0.38);
          // 가로 방향 얕은 물결 — 세로 결만 있으면 '커튼'이 아니라 '빗금'으로 보인다.
          float ripple = 0.5 + 0.5*sin(q.y*7.0 - uTime*1.5 + fbm(nc*0.8)*4.0);
          float rimUp = smoothstep(0.46, 1.0, dA);              // 에너지가 테두리(문틀)에 달라붙는 느낌
          // ★기본 채움(0.22) — 3차 렌더에서 결이 있는 자리만 밝고 나머지가 새까매서 '연기 몇 가닥'으로 보였다.
          //   포탈은 **막**이라 개구부 전체가 항상 차 있어야 하고, 그 위에 밝은 결이 흘러야 한다.
          float fill  = (0.22 + 0.78*streak) * (0.62 + 0.26*rimUp + 0.22*ripple);
          float edge  = smoothstep(1.0, 0.93, dA);              // 테두리 직전 부드럽게 끊기
          float I = fill*edge*uOpen*mix(1.05, 0.42, uDepth);    // ★겹 3장이 additive로 겹치므로 겹당 게인을 차등(앞 밝고 뒤 흐리게)
          vec3 col = mix(uDeep, uGlow, clamp(streak*0.85 + 0.15, 0.0, 1.0));
          gl_FragColor = vec4(col*I, clamp(I,0.0,1.0));
        }`
    });
    veilMats.push(mat);
    const m = new THREE.Mesh(veilGeo, mat);
    m.position.z = -t * VEIL_GAP;      // 문틀 안쪽으로 물러남 = 진짜 구멍처럼
    m.renderOrder = 2 + (VEIL_LAYERS - i);
    group.add(m);
  }

  // ── ② 코어 — 개구부 중앙의 밝은 에너지. 숨쉬듯 맥동(정지된 밝은 원 금지).
  const coreMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uScale: { value: 0.94 } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false, vertexShader: VS,
    fragmentShader: NOISE + `
      varying vec2 vUv; uniform float uTime,uOpen,uAspect,uShape,uScale; uniform vec3 uGlow,uDeep;
      void main(){
        vec2 p=(vUv-0.5)*2.0;
        float dA=sedist(p, uShape)*uScale;
        if(dA>1.0) discard;
        vec2 q=vec2(p.x*uAspect, p.y);
        float en = fbm(vec2(q.x*3.0, q.y*1.1 - uTime*0.46));
        float pulse = 0.82 + 0.18*sin(uTime*1.35) + 0.08*(fbm(vec2(uTime*1.9, 4.0))-0.5);   // 맥동 + 불규칙 플리커
        // ★1차 렌더에서 중앙이 흰색으로 타버렸다 — 하드 코어(smoothstep(0.30,0.0,d)*0.95) 폐기.
        //   부드러운 중앙 밝힘만 남기고 게인을 크게 낮춘다. 겹겹이 additive라 여기서 조금만 올려도 금방 포화된다.
        float c = smoothstep(0.98, 0.16, dA);
        float I = c*c*(0.20 + 0.22*en) * pulse * uOpen;
        vec3 col = mix(uDeep, uGlow, clamp(0.45 + en*0.55, 0.0, 1.0));
        gl_FragColor = vec4(col*I, clamp(I,0.0,1.0));
      }`
  });
  const core = new THREE.Mesh(new THREE.PlaneGeometry(w*0.94, h*0.94, 1, 1), coreMat);
  core.position.z = 0.02; core.renderOrder = 6; group.add(core);

  // ── ③ 림 — 개구부 테두리를 타고 도는 밝은 띠 + 바깥으로 새는 헤일로(문틀에 빛이 묻는 느낌).
  const rimMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uScale: { value: 1.30 } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false, vertexShader: VS,
    fragmentShader: NOISE + `
      varying vec2 vUv; uniform float uTime,uOpen,uAspect,uShape,uScale; uniform vec3 uGlow;
      void main(){
        vec2 p=(vUv-0.5)*2.0;
        float dA=sedist(p, uShape)*uScale;                 // 1.0 = 개구부 테두리
        if(dA>1.26) discard;                               // ★헤일로를 테두리 부근으로 **강하게 제한** —
                                                           //   1차 렌더에선 상인방 전체가 하얗게 씻겨나갔다(마스크 버그 + 넓은 헤일로).
        float ang=atan(p.y*uAspect, p.x);
        float run = fbm(vec2(ang*3.6 + uTime*0.9, dA*6.0))*0.65 + fbm(vec2(ang*8.5 - uTime*1.3, dA*11.0))*0.35;
        float band = smoothstep(0.88, 0.995, dA) * smoothstep(1.045, 0.99, dA);   // 개구부 바로 안쪽의 얇고 밝은 띠
        float halo = smoothstep(1.26, 1.0, dA) * step(1.0, dA);                   // 바깥쪽으로만 짧게 새는 빛
        float I = (band*(0.42 + 0.72*run) + halo*0.20*(0.5 + 0.6*run)) * uOpen;
        gl_FragColor = vec4(uGlow*I, clamp(I,0.0,1.0));
      }`
  });
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(w*1.30, h*1.30, 1, 1), rimMat);
  rim.position.z = 0.04; rim.renderOrder = 7; group.add(rim);

  // ── ④ 광원 — ★상주 1개. intensity만 조절한다(add/remove 반복 = 셰이더 재컴파일 폭탄).
  let light = null;
  if(o.light !== false){
    light = new THREE.PointLight(glow.getHex(), 0, Math.max(w, h) * 3.4, 2);
    light.position.set(0, 0, Math.min(w, h) * 0.28);
    group.add(light);
  }

  const baseInt = o.lightIntensity != null ? o.lightIntensity : 14;
  return {
    group, U,
    /** 개방도 0~1 — 문 애니메이션 진행도에 맞춰 올리면 문이 갈라지며 막이 차오른다. */
    setOpen(v){ U.uOpen.value = Math.max(0, Math.min(1, v)); for(const m of veilMats) m.uniforms.uOpen.value = U.uOpen.value; },
    update(dt){
      U.uTime.value += dt;
      for(const m of veilMats) m.uniforms.uTime.value = U.uTime.value;
      if(light){   // 막의 맥동과 같은 위상으로 광원도 흔들린다(빛과 그림이 따로 놀지 않게)
        const pulse = 0.84 + 0.16 * Math.sin(U.uTime.value * 1.35);
        light.intensity = baseInt * U.uOpen.value * pulse;
      }
    },
    dispose(){
      veilGeo.dispose(); core.geometry.dispose(); rim.geometry.dispose();
      for(const m of veilMats) m.dispose();
      coreMat.dispose(); rimMat.dispose();
    },
  };
}
