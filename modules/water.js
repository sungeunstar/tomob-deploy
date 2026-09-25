// water.js — SUIMONO식 바다 (셰이더 + water_normal_*.png). 메시 기반, 복셀 독립.
// 출처: voyage/index.html:231-239 (검증본) → 모듈로 재작성. 카메라 추종.
import * as THREE from 'three';

export function initWater(ctx, { waveAmp=1.0, size=8000 }={}){
  const { scene, camera, onUpdate } = ctx;
  const tl = new THREE.TextureLoader();
  const wl = u => { const t=tl.load(u); t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; };
  let mat = null;
  // 🌊 파도 스펙트럼(2026-07-04 리메이크) — 방향·주파수를 흩어 반복(타일링) 제거 + 높은 중파(배가 벽을 타게).
  //   {a:방향rad, f:공간주파수(작을수록 긴 파장), A:진폭, s:시간속도}. f<0.10=너울/중파(uSwell 스케일·타는 높은 파도)/ else=잔물결(uWaveAmp).
  //   ★셰이더 GLSL를 이 배열에서 생성 + heightAt(부력)도 같은 배열 루프 → shader↔부력 자동 동기. (three.js water-pro: Gerstner 스웰이 타일링 깸)
  //   ★2026-07-14 블랙플래그 리싱크드 레퍼런스 재조정(제안값) — wave_ref 프레임 분석:
  //     ①너울은 길고 둥글게 굴러오고(마루 뾰족X) ②그 위에 빠른 중파·잔챙이 챱(chop)이 촘촘 ③주기 체감 6~10초(기존보다 빠름).
  const WAVES = [
    {a:0.42,f:0.011,A:1.55,s:0.30}, {a:2.61,f:0.016,A:1.70,s:0.36}, {a:4.53,f:0.009,A:1.25,s:0.26},   // 큰 너울(긴 파장, 둥근 rise/fall — 레퍼런스: 배가 넘실넘실 타는 주 성분)
    {a:1.15,f:0.042,A:1.45,s:0.58}, {a:3.34,f:0.058,A:1.15,s:0.70}, {a:5.41,f:0.035,A:1.25,s:0.52}, {a:0.87,f:0.078,A:0.75,s:0.85},   // 중파 = 배가 타는 높은 파도(레퍼런스: 너울 위 거친 폭풍파, 주기↑빠르게)
    {a:3.92,f:0.105,A:0.42,s:1.00}, {a:2.08,f:0.130,A:0.32,s:1.15}, {a:5.90,f:0.155,A:0.26,s:1.25}, {a:4.77,f:0.185,A:0.22,s:1.40}, {a:1.63,f:0.235,A:0.14,s:1.60},   // 잔물결/챱(레퍼런스: 표면이 잘게 부서지는 질감 — 항 추가·진폭↑)
  ];
  // ★V3(2026-07-22): Gerstner 수평변위 적용 대역을 f<0.07 → **f<GERST_CUT** 로 확대.
  //   사인은 좌우대칭이라 마루가 둥글고 골이 좁다(실제 바다는 정반대). 수평변위가 정점을 마루로 당겨
  //   **마루 뾰족·골 넓음**을 만든다. 너울에만 걸려 있어서 중파·잔챙이는 여전히 "고무 이불"이었다.
  //   ⚠️변위를 키우면 heightAt(부력)과 셰이더가 어긋난다 → 아래 heightAt이 **역변위 반복(fixed-point)** 으로 동기를 맞춘다.
  //     GERST_CUT을 바꾸면 heightAt의 _gerstBand도 같이 바뀌어야 한다(둘 다 이 상수를 쓴다).
  const GERST_CUT = 0.11;
  const _wg = (()=>{ const P=[],AM=[],H=[],SX=[],SZ=[],GX=[],GZ=[];
    WAVES.forEach((w,i)=>{ const c=Math.cos(w.a), s=Math.sin(w.a), kx=+(c*w.f).toFixed(6), kz=+(s*w.f).toFixed(6), sc=w.f<0.10?'uSwell':'uWaveAmp';
      P.push(`float p${i}=${kx}*x+${kz}*z+uTime*${w.s.toFixed(3)};`);
      AM.push(`float A${i}=${w.A.toFixed(3)}*${sc};`);
      H.push(`sin(p${i})*A${i}`); SX.push(`cos(p${i})*A${i}*${kx}`); SZ.push(`cos(p${i})*A${i}*${kz}`);
      if(w.f<GERST_CUT){ GX.push(`cos(p${i})*A${i}*${c.toFixed(4)}`); GZ.push(`cos(p${i})*A${i}*${s.toFixed(4)}`); }
    });
    return { pre:P.join('')+AM.join(''), h:H.join('+'), sx:SX.join('+'), sz:SZ.join('+'), gx:GX.join('+')||'0.0', gz:GZ.join('+')||'0.0' };
  })();
  // JS 쪽 Gerstner 대역(heightAt 역변위용) — 위 셰이더 생성과 **같은 조건**이어야 한다.
  const _gerstBand = WAVES.filter(w=>w.f<GERST_CUT).map(w=>({ c:Math.cos(w.a), s:Math.sin(w.a), kx:Math.cos(w.a)*w.f, kz:Math.sin(w.a)*w.f, A:w.A, sp:w.s, swell:w.f<0.10 }));
  // 🚢 웨이크 포말 마스크 기본 텍스처(1×1 검정) — foamtrail.js 미탑재/초기화 전에도 셰이더 샘플 안전.
  const _wakeBlank = new THREE.DataTexture(new Uint8Array([0,0,0,255]), 1, 1); _wakeBlank.needsUpdate = true;
  try{
    mat = new THREE.ShaderMaterial({
      uniforms:{
        uTime:{value:0}, uWaveAmp:{value:waveAmp},
        // 🌊 너울/중파 배율(WAVES 스펙트럼 f<0.10 항) — 배가 타는 높은 파도 세기. 1=배열 기본 진폭. window.__swell(값).
        //   ★제안값 1.05 — 새 WAVES 진폭합이 커져서(8.22→9.10) 총 파고는 기존(×1.15≈9.45)과 동급 유지.
        uSwell:{value:1.05},
        // 🌊 파도 노멀 세기 — 파도 함수의 경사(기울기)를 조명 노멀에 반영해 파도 '면'이 빛을 받게(SoT식 조각된 파도). 0=구버전(평평 이불). window.__waven(값).
        //   ★제안값 30 — 레퍼런스는 파도 '면'의 명암 대비가 강함(굴러오는 면이 어둡고 등이 밝음).
        uWaveN:{value:30.0},
        // 🌊 Gerstner 스티프니스(뾰족한 마루+넓은 골) / 크레스트 폼(마루 흰거품). window.__gerst(값)/__foam(값).
        //   ★제안값: Gerstner 0.55→0.38 — 레퍼런스 마루는 뾰족한 스파이크가 아니라 둥글게 굴러오고, 뾰족함 대신 포말이 마루를 정의.
        //   Foam 0.6→0.85 — 레퍼런스는 마루 포말 + 바람결 줄무늬 포말이 표면을 넓게 덮음(폭풍 바다 질감의 핵심).
        uGerstner:{value:0.38}, uFoam:{value:0.85},
        uNormA:{value:wl('/tomob-deploy/water_normal_calm.png')}, uNormB:{value:wl('/tomob-deploy/water_normal_roll.png')}, uNormC:{value:wl('/tomob-deploy/water_normal_turb.png')},
        uSunDir:{value:new THREE.Vector3(0.45,0.8,0.35).normalize()},
        // ☀️ 낮 모아나 팔레트 — 밝은 터쿼이즈 얕음 + 딥블루. wind.js가 _wsh/_wdp/_wsk로 이 3색을 소유(폭풍 lerp).
        //   ★낮 채도 복구: 얕음 비비드 터쿼이즈, 딥은 살짝 더 푸르게(직전 너프 복원).
        // ★아트통일: 모아나 청록 기조 유지(사령관 "청록 좋다" 비퇴행), 채도만 살짝↓ 명도 살짝↑.
        //   0x21ddc6(과채도 비비드) → 0x33cdba(약간 차분한 터쿼이즈) — 하늘·지형과 한 톤. 퇴행 아님(여전히 또렷한 청록).
        // 🌊 2026-07-24 바다색 SoT화 시도 → **원복**. uShallow/uDeep을 밝게 바꿔도 전경 바다색이 무반응(실측
        //   _sea_tune.mjs: 값 5조합 전부 전경 58,107,98 고정)임을 규명했다. 이 각도 최종색은 fresnel 하늘반사(167행)+
        //   SSS(177행)가 지배한다. SoT 터쿼이즈는 셰이더 다항 조정이 필요 = 별도 트랙(_바다물리 정본 회귀 위험).
        //   라이브 훅 __shallow/__deep은 유지(추후 조정용).
        uShallow:{value:new THREE.Color(0x33cdba)}, uDeep:{value:new THREE.Color(0x0a5a6e)},
        uSky:{value:new THREE.Color(0xa6cbe8)}, uSun:{value:new THREE.Color(0xfff0c8)},
        // 🌙 밤/달빛 (sky.js가 매 프레임 주입). uNight 0=낮 1=밤. uMoonDir=달 방향.
        //   ★밤 팔레트 = Shadertoy 톤 정합: lightColour=(0.65,0.8,1.0) 달빛, skyColour=0.1*(0.32,0.65,1.0) 짙은 청.
        //   수평선에서 하늘(짙은 청)과 바다가 하나로 이어지게 deep을 skyColour 계열로 맞춤.
        uMoonDir:{value:new THREE.Vector3(-0.45,0.8,-0.35).normalize()}, uNight:{value:0.0},
        uMoonCol:{value:new THREE.Color(0.65,0.8,1.0)},                          // = lightColour
        // ★밤 바다 어둠 보강: 달빛 받는 밤 바다가 깜깜하지 않게 살짝 올림(채도 유지, 모아나 푸른 밤).
        uMoonShallow:{value:new THREE.Color(0.10,0.22,0.34)},                    // 달빛 받는 얕은 면(청) — 약간 밝게
        uMoonDeep:{value:new THREE.Color(0.030,0.070,0.120)},                    // ≈ skyColour 계열 — 수평선서 하늘과 동화(살짝 보강)
        // 🌩️ 밤+폭풍 바다: 밤 팔레트가 storm 색을 덮어쓰지 않게, 밤 경로에 storm 어둠을 직접 합성.
        //   sky.js setStorm이 매 프레임 uStorm 주입. 밤+폭풍이면 더 어둡고 차가운 청회.
        uStorm:{value:0.0},
        uMoonShallowStorm:{value:new THREE.Color(0.055,0.11,0.16)},              // 밤+폭풍 얕은면(어둡고 채도↓ 청회)
        uMoonDeepStorm:{value:new THREE.Color(0.012,0.028,0.045)},               // 밤+폭풍 딥(거의 검은 청회)
        // ★바다↔하늘 일관: 하늘 수평선색(노을·밤 포함)을 sky.js가 매 프레임 주입.
        //   바다 fresnel 반사가 항상 현재 하늘색을 따르게 해서 낮·황혼·밤 모두 바다가 하늘과 한 톤으로 이어진다.
        uHorizonCol:{value:new THREE.Color(0xa6cbe8)},
        // 🚢 웨이크/물보라 포말 마스크(foamtrail.js 월드공간 RT) — ref/배나가는효과.png 선미 트레일·착수 퍼짐.
        //   xy=영역 중심(월드 xz) · z=1/영역크기 · w=활성(0/1). 파형·부력(성역)과 무관 — 색 합성만.
        uWakeTex:{value:_wakeBlank}, uWakeArea:{value:new THREE.Vector4(0,0,0,0)},

        // ══ 🌊 Phase 2 비주얼(2026-07-22) — 진단 `_바다물리_진단.md` W1/W2/W4/W5 ══
        // ── V1 역광 투과(SSS) — ref/파도1.png의 핵심. 얇은 마루가 빛을 통과시켜 형광 청록으로 빛나는 것.
        //   기존 셰이더엔 이 항이 **한 줄도 없어** 바다가 "속이 꽉 찬 불투명 물체"로 보였다.
        //   맑음=강하게(터쿼이즈 발광) / 폭풍=약하게(빛이 안 통하는 탁한 물). uStorm으로 보간.
        uSSS:{value:1.0}, uSSSPow:{value:3.2},
        uSSSCol:{value:new THREE.Color(0.16,0.92,0.78)},        // 맑음 — 파도1 형광 터쿼이즈
        uSSSColStorm:{value:new THREE.Color(0.30,0.52,0.50)},   // 폭풍 — 파도2 탁한 청회록
        // ── V2 실반사(하늘 전용 큐브 프로브) — 기존엔 fresnel에 **색 1개(uHorizonCol)** 를 섞어
        //   전 파도면이 같은 색 = 플라스틱. 프로브가 붙으면 파도 면마다 반사가 달라져 명암이 조각된다.
        //   uReflMix=0이면 구 동작(색 1개)으로 자동 폴백 → 프로브 실패해도 바다가 깨지지 않는다.
        uRefl:{value:null}, uReflMix:{value:0.0},
        // ── V4 바람결 줄무늬 방향 — 기존 vec2(0.913,0.408) **하드코딩**이라 바람이 바뀌어도 줄무늬는 고정이었다.
        uWindDir:{value:new THREE.Vector2(0.913,0.408)},
        // ── ⛔**바람결 줄무늬 포말 = OFF**(사령관 지시 2026-07-22: "바람결? 빼 / 이상해 정신없어").
        //   경위: 원래 있던 기능(블랙플래그 레퍼런스)인데 ①내가 폭풍 증폭(2.1)을 넣어 비 올 때 2.5배가 되고
        //   ②방향을 wind.dir에 묶어 **표면 결이 계속 회전**하면서 파도 결과 따로 놀았다 → 사령관 "정신없다".
        //   코드는 남기되 기본 0. 되살리려면 window.__streak(1) — 단, 방향 회전은 이미 고정으로 되돌렸다.
        uStreak:{value:0.0},
        // ── V5 날씨 분기: 포말량(마루 거품). 맑음=파도1 / 폭풍=조금 더 부서짐(파도2). 줄무늬와 무관.
        uFoamStorm:{value:1.35}, uStreakStorm:{value:1.0},
      },
      transparent:true, depthWrite:false, side:THREE.DoubleSide,
      vertexShader:`uniform float uTime;uniform float uWaveAmp;uniform float uSwell;uniform float uGerstner;varying vec3 vWorld;varying vec3 vView;varying vec2 vSlope;varying float vWaveH;
        void main(){vec4 wp=modelMatrix*vec4(position,1.0);float x=wp.x,z=wp.z;
          // ★파도 스펙트럼(WAVES 배열서 생성) — heightAt(JS)와 동일 공식(부력↔시각 동기, 수직높이만; Gerstner 수평변위는 부력 근사).
          ${_wg.pre}
          float h=${_wg.h};
          vWaveH=h; wp.y+=h;
          // ★Gerstner 수평 변위(f<0.07 큰 파도) — 정점을 마루쪽으로 당겨 뾰족한 마루+넓은 골. Q=uGerstner.
          wp.x += uGerstner*(${_wg.gx});
          wp.z += uGerstner*(${_wg.gz});
          // 경사 dh/dx,dh/dz — 노멀 재계산(파도 면 조명).
          float dx=${_wg.sx};
          float dz=${_wg.sz};
          vSlope=vec2(dx,dz);
          vWorld=wp.xyz;vView=cameraPosition-wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader:`uniform float uTime;uniform sampler2D uNormA,uNormB,uNormC;uniform vec3 uSunDir,uShallow,uDeep,uSky,uSun;uniform vec3 uMoonDir,uMoonCol,uMoonShallow,uMoonDeep,uMoonShallowStorm,uMoonDeepStorm;uniform float uNight,uStorm,uWaveN,uFoam;uniform vec3 uHorizonCol;uniform sampler2D uWakeTex;uniform vec4 uWakeArea;
        uniform float uSSS,uSSSPow,uReflMix,uFoamStorm,uStreakStorm,uStreak;uniform vec3 uSSSCol,uSSSColStorm;uniform vec2 uWindDir;uniform samplerCube uRefl;
        varying vec3 vWorld;varying vec3 vView;varying vec2 vSlope;varying float vWaveH;
        vec2 sn(sampler2D t,vec2 uv){return texture2D(t,uv).xy*2.0-1.0;}
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        // ★흰네모 수정: floor(hash)는 정사각 셀마다 평탄한 상수값 → 부감서 네모 패치로 보임.
        //   smooth value-noise(셀 경계 보간)로 교체해 평탄 셀 제거. 어디서 봐도 연속.
        float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
          return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
        void main(){
          vec2 p=vWorld.xz;
          // ★네모 아티팩트 수정: 노멀맵 3중 샘플 주파수를 서로 무리수배로 어긋나게(공명 타일 제거)
          //   + 4번째 미세 옥타브로 셀 경계 연속화. 정사각 격자 공명을 깬다.
          vec2 d1=sn(uNormA,p*0.0431+vec2(uTime*0.021,uTime*0.013));
          vec2 d2=sn(uNormB,p*0.0177-vec2(uTime*0.0107,uTime*0.0163));
          vec2 d3=sn(uNormC,p*0.0833+vec2(-uTime*0.0241,uTime*0.0089));
          vec2 d4=sn(uNormA,p*0.0061+vec2(uTime*0.006,-uTime*0.004));   // 대형 굼슬(저주파) — 격자감 분산
          // ★파도 면 조명: 노멀맵 잔물결 + 파도 함수 경사(vSlope). uWaveN>0이면 파도 면이 빛을 받아 조각된 파도로 보임(SoT).
          vec3 N=normalize(vec3((d1.x+d2.x+d3.x*0.7+d4.x*1.3) - vSlope.x*uWaveN, 6.0, (d1.y+d2.y+d3.y*0.7+d4.y*1.3) - vSlope.y*uWaveN));
          vec3 V=normalize(vView);
          float fres=clamp(0.03+0.97*pow(1.0-max(0.0,dot(V,N)),3.5),0.0,1.0);
          float depthF=pow(max(0.0,dot(V,vec3(0.0,1.0,0.0))),0.55);
          // ★섬쪽 바다 통합: 밤엔 얕음(섬 근처 밝음)↔깊음(먼바다 어둠) 대비를 줄여(depthF를 중앙 0.5로 당김)
          //   섬 근처 바다가 먼 바다와 같은 달빛 톤이 되게 → '섬쪽 바다만 밝게 뜨는' 분할 제거. 낮엔 모아나 깊이감 유지.
          depthF = mix(depthF, 0.5, uNight*0.6);
          // 낮/밤 팔레트 lerp — 밤엔 Shadertoy 청 톤(수평선서 하늘과 동화). 죽은 검은 바다 금지.
          //   🌩️ 밤 팔레트 자체에 storm 어둠을 합성(밤이 storm 색을 덮어쓰는 문제 해결).
          vec3 moonShallowC=mix(uMoonShallow,uMoonShallowStorm,uStorm);
          vec3 moonDeepC   =mix(uMoonDeep,   uMoonDeepStorm,   uStorm);
          vec3 shallow=mix(uShallow,moonShallowC,uNight);
          vec3 deep   =mix(uDeep,   moonDeepC,   uNight);
          vec3 base=mix(deep,shallow,depthF);
          // ★바다↔하늘 일관: fresnel 반사색을 실제 하늘 수평선색(uHorizonCol, 노을·밤 포함)으로.
          //   낮=밝은 하늘, 황혼=붉은 노을, 밤=짙은 청을 바다가 그대로 반사 → 수평선서 하늘과 한 톤으로 이어진다.
          //   (기존: uSky/nightSkyRefl 하드코딩 → 하늘이 노을/밤으로 변해도 바다는 안 따라가 '조명 다른' 분할이 생겼음)
          vec3 R=reflect(-V,N);
          // ── 🪞 V2 실반사(하늘 전용 큐브 프로브) ────────────────────────────────
          //   기존: fresnel에 **색 1개(uHorizonCol)** 를 섞음 → 전 파도면이 같은 색 = 플라스틱.
          //   신규: 반사벡터로 하늘 큐브맵을 샘플 → 파도 면마다 반사가 달라져 명암이 조각된다(레퍼런스의 질감).
          //   uReflMix=0(프로브 미준비/실패)이면 **구 동작으로 자동 폴백** — 바다가 절대 깨지지 않는다.
          vec3 skyC=uHorizonCol;
          if(uReflMix>0.001){
            vec3 probe=textureCube(uRefl, R).rgb;
            //   거친 면(마루·포말 근처)은 반사가 흐려지므로 수평선색과 섞어 과한 대비를 눌러준다.
            skyC=mix(uHorizonCol, probe, uReflMix*(1.0-0.35*uStorm));
          }
          vec3 col=mix(base,skyC,fres);
          // ── ✨ V1 역광 투과(SSS) — ref/파도1.png의 핵심. 마루가 얇은 곳에서 빛이 통과해 형광 청록으로 빛난다.
          //   물리 근사: 시선이 광원 반대쪽을 볼수록(dot(V,-L)) · 마루가 높을수록(vWaveH) · 면이 기울수록 강해짐.
          //   ⚠️이 항이 없으면 아무리 색을 맞춰도 바다가 "속이 꽉 찬 불투명 물체"로 보인다(진단 W1).
          {
            vec3 L=normalize(mix(uSunDir, uMoonDir, uNight));
            float back=pow(max(0.0, dot(V, -L)), uSSSPow);              // 역광 방향성
            float thin=smoothstep(0.15, 2.2, vWaveH + length(vSlope)*2.5);  // 마루·경사면일수록 얇다
            vec3  sc=mix(uSSSCol, uSSSColStorm, uStorm);                // 맑음=형광 터쿼이즈 / 폭풍=탁한 청회록
            float amt=uSSS*back*thin*(1.0-0.55*uNight)*(1.0-0.45*uStorm);   // 밤·폭풍엔 통과광이 약해짐
            col += sc*amt;
          }
          // ── 반사 specular: 낮=태양, 밤=달. 시간에 따라 전환(uNight)
          float sunSpec=pow(max(0.0,dot(R,normalize(uSunDir))),140.0);
          col+=uSun*sunSpec*1.8*(1.0-uNight);
          // 🌙 달빛 specular + 세로 윤슬 길(moonlit path)
          vec3 MD=normalize(uMoonDir);
          float md=max(0.0,dot(R,MD));
          float moonSpecTight=pow(md,90.0);      // 또렷한 달 반사 핵(200→90: 격자 공명 완화, 부드러운 윤슬)
          float moonSpecWide =pow(md,22.0);      // 넓게 퍼진 윤슬 길(세로로 길게 늘어지는 광로)
          // 잔물결로 끊긴 윤슬: 표면 노멀 변조 + 노이즈로 specular를 점박이로 쪼갬
          float ripple=0.55+0.45*sin(vWorld.z*0.5+uTime*1.7+d1.x*4.0)*sin(vWorld.x*0.31-uTime*1.1);
          // ★흰네모 수정: step(floor hash) → 정사각 셀이 통째로 흰색이 됨(부감 네모의 진짜 원인).
          //   smooth vnoise로 교체 + smoothstep으로 부드러운 점박이. 평탄 셀 0.
          float glint=vnoise(p*0.7+vec2(uTime*0.6));
          // 핵은 진하게, 윤슬 길은 잔물결로 끊어 반짝이게(셀 경계 없는 연속 변조)
          float moonPath=moonSpecTight*1.6 + moonSpecWide*ripple*(0.4+0.7*smoothstep(0.45,0.7,glint));
          // 🌩️ 폭풍이면 달이 먹구름 뒤 → 달빛 윤슬 크게 약화(1-0.8*storm). 거친 어두운 바다.
          col+=uMoonCol*moonPath*2.6*uNight*(1.0-0.8*uStorm);
          // fresnel sparkle(절제) — 밤에 물 표면 반짝임. ★달빛 경로(moonSpecWide)에서만 반짝이게
          //   게이트 → 바다 전체를 흰 셀로 덮지 않음. smoothstep으로 부드러운 점.
          float sparkle=fres*smoothstep(0.9,0.98,glint)*ripple*smoothstep(0.02,0.25,moonSpecWide);
          col+=uMoonCol*sparkle*0.9*uNight;
          // 밤에도 약한 생기(청록 발광) — 완전 검정 방지(0.06→0.10: 달빛 받는 밤바다 형체 유지)
          col+=uMoonShallow*0.10*uNight;
          // 🌊 크레스트 폼(흰 거품) — 재작업 2026-07-23(레퍼런스 ref/파도1.png 대조: 근처만 부서지고 먼 바다는 깨끗한 터쿼이즈).
          //   ★기존 짜침 3원인 제거: ①저주파 부드러운 vnoise 2겹 곱 = 우유 얼룩 ②0.3 바닥값 = 마루 전체 균일한 흰 띠
          //     ③단색 순백 lerp = 페인트. → 고주파 fbm 부서짐 + 임계 샤픈(바닥값 0) + 거리 페이드 + 반투명 오프화이트로 교체.
          // ★V5 날씨 분기 유지: 폭풍이면 마루 포말이 더 많이 부서진다(파도2 = 표면이 넓게 하얘짐).
          float foamAmt=uFoam*mix(1.0, uFoamStorm, uStorm);
          // ① 마루 마스크(경사 급한 부서지는 면 강조)
          float crest=smoothstep(0.72, 2.15, vWaveH + length(vSlope)*4.2);
          // ② 다중 옥타브 fbm — 저주파 얼룩 대신 고주파 부서지는 거품 구조
          float fb = vnoise(p*0.85 + vec2(uTime*0.33,-uTime*0.21))*0.52
                   + vnoise(p*2.20 - vec2(uTime*0.48, uTime*0.29))*0.32
                   + vnoise(p*5.10 + vec2(-uTime*0.66, uTime*0.42))*0.16;
          // ③ 임계 샤픈 — 바닥값 없이 임계 이상만 거품 = 드물고 구조적(진짜 부서진 자국)
          float bub=smoothstep(0.46, 0.86, fb);
          // ④ 거리 페이드 — 먼 바다는 깨끗(레퍼런스: 근처 큰 파도만 포말). length(vView)=카메라 거리.
          float distFade=1.0 - smoothstep(150.0, 640.0, length(vView));
          float foam=clamp(crest*foamAmt*bub*(0.28+0.72*distFade),0.0,0.88);
          foam*=(1.0-0.35*uNight);   // 밤엔 포말도 차분하게(순백 튐 방지)
          // 🌬️ 바람결 줄무늬 포말(레퍼런스 핵심) — 표면 전체에 바람 방향으로 길게 찢긴 흰 줄무늬.
          //   ★V4(2026-07-22): 방향이 **vec2(0.913,0.408) 하드코딩**이라 바람이 바뀌어도 줄무늬는 영원히 고정이었다.
          //     → uWindDir(ctx.wind.dir에서 매 프레임 주입)로 교체. 바람이 돌면 표면 결도 같이 돈다.
          //   ★V5: 폭풍일수록 줄무늬가 강해진다(파도2의 wind streak가 표면을 넓게 덮는 질감).
          vec2 wdir=normalize(uWindDir+vec2(1e-5,0.0));
          vec2 swc=vec2(dot(p,wdir), dot(p,vec2(-wdir.y,wdir.x)));
          //   ⚠️**투영 기준축(wdir)을 돌리면 안 된다** — swc는 월드좌표 p(원점에서 수백~수천 m)를 wdir에 투영한 값이라,
          //     축이 dθ만큼 돌면 패턴이 |p|·dθ 만큼 흐른다. 풍향 회전 0.09rad/s × 1000m = **초속 90m**로 패턴이 질주한다.
          //     (사령관 "천천히가 아니라 미친듯이 빨리 감"의 정확한 원인. 그래서 wdir은 이제 고정이다.)
          //   ⚠️시간 스크롤 계수도 낮춘다: 두 겹이 **서로 반대 방향**(-uTime / +uTime)이라 곱하면 맥놀이가 생겨
          //     실제 속도보다 훨씬 부산스럽게 보인다. 0.10/0.07 → 0.020/0.013(약 1/5).
          float streak=vnoise(vec2(swc.x*0.045-uTime*0.020, swc.y*0.38))*vnoise(vec2(swc.x*0.11+uTime*0.013, swc.y*0.90)+3.7);
          float streakF=uStreak*mix(1.0,uStreakStorm,uStorm)*smoothstep(0.30,0.72,streak)*(0.30+0.70*smoothstep(0.0,1.8,vWaveH));
          foam=clamp(foam+streakF,0.0,0.95);
          // 포말색: 차가운 순백(0.92,0.96,0.99) → 반투명 오프화이트 + 햇빛 향할수록 살짝 따뜻(물보라가 빛 받음). 순백 페인트 제거.
          float foamWarm=clamp(dot(V,uSunDir),0.0,1.0)*(1.0-uNight);
          vec3 foamCol=mix(vec3(0.82,0.88,0.93), vec3(1.00,0.97,0.90), foamWarm*0.55);
          col=mix(col, foamCol, foam);
          // 🚢 웨이크/물보라(foamtrail RT) — ref/배나가는효과.png 3구조 재현(사령관 "거품 늘리기 아님" 지적 후 재작업):
          //   ①선미 직후 = 꽉 찬 뒤끓는 백색 코어 ②중간 = 진행방향 줄무늬로 찢김 ③끝단 = 조각 얼룩 소멸
          //   + 폭기(공기 섞인 물) 유백색 — 순백 페인트가 아니라 우유빛 물색으로.
          //   줄무늬 방향 = 마스크 등고선(기울기의 수직) → 별도 방향 저장 없이 트레일 진행방향 자동 추출.
          if(uWakeArea.w>0.5){
            vec2 wuv=(vWorld.xz-uWakeArea.xy)*uWakeArea.z+0.5;
            float edge=smoothstep(0.0,0.06,wuv.x)*smoothstep(1.0,0.94,wuv.x)*smoothstep(0.0,0.06,wuv.y)*smoothstep(1.0,0.94,wuv.y);
            float wk=texture2D(uWakeTex,wuv).r*edge;
            if(wk>0.004){
              float ee=uWakeArea.z*2.4;   // ≈1텍셀 — 기울기 탭
              float gxx=texture2D(uWakeTex,wuv+vec2(ee,0.0)).r-texture2D(uWakeTex,wuv-vec2(ee,0.0)).r;
              float gzz=texture2D(uWakeTex,wuv+vec2(0.0,ee)).r-texture2D(uWakeTex,wuv-vec2(0.0,ee)).r;
              vec2 tdir=normalize(vec2(-gzz,gxx)+vec2(1e-4,0.0));   // 등고선 = 트레일 길이 방향
              vec2 wp2=vec2(dot(p,tdir), dot(p,vec2(-tdir.y,tdir.x)));
              // 이방성 끓음: 길이방향 성기게(줄무늬 늘임) × 가로방향 촘촘(찢김) + 시간 흐름(뒤끓음)
              float boil=vnoise(wp2*vec2(0.30,1.7)+vec2(uTime*1.15,0.0))*vnoise(wp2*vec2(0.85,3.3)-vec2(uTime*0.7,uTime*0.33));
              float core=smoothstep(0.55,0.88,wk);                                  // ①코어(선미 직후)
              float streak=smoothstep(0.16,0.55,wk)*smoothstep(0.28,0.72,boil);     // ②줄무늬 찢김
              float tail=smoothstep(0.035,0.18,wk)*smoothstep(0.55,0.85,boil);      // ③조각 얼룩
              float wkF=clamp(core*(0.62+0.55*boil)+streak*0.85+tail*0.5,0.0,1.0);
              vec3 wCol=mix(vec3(0.70,0.86,0.90), vec3(0.97,0.99,1.0), core);       // 폭기 유백→코어 순백
              col=mix(col, wCol, wkF*0.95);
              foam=max(foam, wkF);   // 알파/프레넬 게이트 공유
            }
          }
          gl_FragColor=vec4(col,mix(0.7,0.98,max(fres,foam)));
        }`,
    });
  }catch(e){ console.warn('[water] shader fail → fallback', e); mat=new THREE.MeshStandardMaterial({color:0x2f86c2, transparent:true, opacity:0.9}); }

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3000,3000,300,300).rotateX(-Math.PI/2), mat);   // 세그먼트 300² — 물 표면이 실제로 파도치게(1×1이면 평평)
  mesh.renderOrder = -1; scene.add(mesh);

  // 수중 안개 (mas main.js:1018 이식) — 카메라가 수면 아래면 청록 탁하게 + 비네트
  const _airNear=scene.fog?scene.fog.near:600, _airFar=scene.fog?scene.fog.far:4000;
  const _airFogC=scene.fog?scene.fog.color.clone():new THREE.Color(0x8fc1e3), _airBg=scene.background.clone();
  let _uw=null, _wasUW=false; const LEVEL=0;

  // ── 🌊 수중 물빛(caustics) — intro/index.html 수중 셰이더 이식(ghostty water.glsl · ShaderToy water). ──
  //   풀스크린 additive plane. 잠수 시 화면 전체에 반복 삼각함수 caustics 빛결이 은은히 일렁임(intro와 동일 톤: 청록×0.24).
  //   uOpacity로 페이드(수중=1). depthTest off → 오브젝트 위에도 물빛 비침(화면 앞뒤 같은 바다).
  const _causMat=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, depthTest:false, blending:THREE.AdditiveBlending, fog:false,
    uniforms:{ uOpacity:{value:0}, uTime:{value:0}, uRes:{value:new THREE.Vector2(innerWidth,innerHeight)} },
    vertexShader:'void main(){ gl_Position=vec4(position.xy,0.999,1.0); }',
    fragmentShader:`precision highp float; uniform float uOpacity,uTime; uniform vec2 uRes;
      #define TAU 6.28318530718
      void main(){
        vec2 fragCoord=gl_FragCoord.xy; vec3 water_color=vec3(1.0)*0.5;
        float time=uTime*0.5+23.0; vec2 uv=fragCoord/uRes;
        vec2 p=mod(uv*TAU,TAU)-250.0; vec2 i=vec2(p); float c=1.0; float inten=0.005;
        for(int n=0;n<6;n++){ float t=time*(1.0-(3.5/float(n+1)));
          i=p+vec2(cos(t-i.x)+sin(t+i.y),sin(t-i.y)+cos(t+i.x));
          c+=1.0/length(vec2(p.x/(sin(i.x+t)/inten),p.y/(cos(i.y+t)/inten))); }
        c/=6.0; c=1.17-pow(c,1.4);
        vec3 color=vec3(pow(abs(c),15.0));
        color=clamp((color+water_color)*1.2,0.0,1.0);
        gl_FragColor=vec4(color*vec3(0.34,0.60,0.82)*uOpacity*0.24,1.0);   // 은은하게(0.24) — intro 튜닝값
      }`
  });
  const _causMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2), _causMat);
  _causMesh.frustumCulled=false; _causMesh.renderOrder=4; _causMesh.visible=false; scene.add(_causMesh);
  addEventListener('resize', ()=>{ _causMat.uniforms.uRes.value.set(innerWidth,innerHeight); });
  let _causOp=0;

  // ── 🪞 V2 하늘 전용 큐브 프로브(2026-07-22) ──────────────────────────────────
  //   목적: 파도 면마다 반사가 달라지게(기존엔 색 1개라 전 면이 같은 색 = 플라스틱).
  //   ⚠️비용 통제 — 드로우콜 이력([[voyage-check-harness]] 던전 4319→728)을 감안해 **하늘만** 찍는다:
  //     ①전용 레이어(SKY_LAYER)에 sky.js 오브젝트만 등록하고 큐브 카메라를 그 레이어로 고정
  //       → 섬·배·몹은 애초에 렌더 대상이 아니다(전체 씬 재렌더 아님).
  //     ②해상도 128 · 갱신 2.5회/초. 하늘은 천천히 변하므로 매 프레임 찍을 이유가 없다.
  //     ③실패하면 uReflMix=0으로 두어 **구 동작(색 1개)으로 자동 폴백** — 바다가 깨지지 않는다.
  //   배·섬까지 비치게 하려면 SSR/평면반사가 필요하고 드로우콜이 배로 뛴다 → 사령관 프레임 판정 후 별건.
  // 🌬️ 줄무늬 방향 기준 = **주 너울 방향**(WAVES 첫 항). 구 하드코딩 (0.913,0.408)이 바로 이 각(≈0.42rad)이었다.
  //   바람은 이 기준에서 ±범위 안에서만 흔든다 — 결을 가로지르면 물 위에 띠를 덮은 것처럼 보인다(사령관 지적).
  const SWELL_ANG = WAVES[0].a, STREAK_WIND_RANGE = 0.45;   // rad (≈26°)
  // ⛔**기본 = 주 너울 방향 고정**(2026-07-22 사령관 "줄무늬들이 방향이 바뀌면서 미친듯이 생김").
  //   V4(풍향 추종)는 **개념부터 틀렸다** — 이 프로젝트의 WAVES(파도 방향)는 하드코딩 고정인데
  //   `wind.dir`은 ~10초마다 눈에 띄게 떠돌도록 설계돼 있다(wind.js 주석). 줄무늬만 회전시키면
  //   **파도 결과 표면 결이 따로 놀며 계속 돌아** 물 텍스처가 아니라 겹쳐 놓은 띠로 보인다.
  //   → 고정이 정답. 바다 전체가 바람 따라 돌게 하려면 WAVES 자체를 회전시켜야 하고, 그건 부력·항해까지 얽힌 별건.
  //   window.__windlock(-1)로 풍향 추종을 켤 수 있게만 남겨둔다(실험용).
  let _windLock = SWELL_ANG;   // ≥0=그 각으로 고정 / -1=풍향 추종(실험)

  const SKY_LAYER = 5;
  const PROBE_HZ = 0.4;   // 초 — 갱신 간격
  //   ★_probeAcc를 PROBE_HZ로 시작 = **첫 틱에 즉시 1회 촬영.** 안 그러면 첫 반사가 0.4초 늦게 뜨고,
  //     헤드리스(초당 2틱·dt 0.05 클램프)에선 누적이 임계에 못 미쳐 프로브가 영영 안 붙는다(검증 불가).
  let _cubeRT=null, _cubeCam=null, _probeAcc=PROBE_HZ, _probeReady=false, _probeTried=false;
  // ⚠️**지연 생성 필수** — game.html은 `initWater`를 `initSky`보다 **먼저** 부른다(134줄 vs 137줄).
  //   생성 시점엔 ctx.sky가 아직 없어 여기서 만들면 프로브가 영원히 안 붙는다. 첫 업데이트에서 한 번만 시도한다.
  function _ensureProbe(){
    if(_probeTried || !ctx.sky || !mat.uniforms || !mat.uniforms.uRefl) return;
    _probeTried = true;
    try{
      _cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps:true, minFilter:THREE.LinearMipmapLinearFilter });
      _cubeCam = new THREE.CubeCamera(1, 12000, _cubeRT);
      _cubeCam.layers.set(SKY_LAYER);                              // 큐브 카메라는 하늘 레이어만 본다
      for(const c of _cubeCam.children) c.layers.set(SKY_LAYER);   // 6면 카메라 각각에도(three 버전 차 방어)
      scene.add(_cubeCam);
      // sky.js 오브젝트를 하늘 레이어에도 등록(기본 레이어 0은 유지 → 메인 카메라 렌더는 그대로).
      let n=0; for(const k of ['dome','sunSprite','moonSprite','moonHalo','stars','starbox']){
        const o = ctx.sky[k]; if(o && o.layers){ o.layers.enable(SKY_LAYER); n++; }
      }
      mat.uniforms.uRefl.value = _cubeRT.texture;
      console.log('[water] 🪞 하늘 큐브 프로브 등록 — 128px · '+PROBE_HZ+'s 간격 · 하늘 오브젝트 '+n+'개');
    }catch(e){ console.warn('[water] 큐브 프로브 실패 → 수평선색 폴백', e&&e.message); _cubeRT=null; _cubeCam=null; }
  }

  onUpdate(dt => {
    if(mat.uniforms) mat.uniforms.uTime.value += dt; mesh.position.set(camera.position.x, LEVEL, camera.position.z);
    // 🪞 큐브 프로브 — 첫 틱에 지연 생성(위 _ensureProbe 주석 참조) 후 저빈도 갱신.
    _ensureProbe();
    if(_cubeCam && ctx.renderer){
      _probeAcc += dt;
      if(_probeAcc >= PROBE_HZ){ _probeAcc = 0;
        _cubeCam.position.set(camera.position.x, Math.max(camera.position.y, LEVEL+2), camera.position.z);
        const _vis = mesh.visible; mesh.visible = false;      // 물이 자기 자신을 찍지 않게(레이어로 이미 배제되지만 이중 안전)
        try{ _cubeCam.update(ctx.renderer, scene); _probeReady = true; }
        catch(e){ console.warn('[water] 프로브 갱신 실패 — 폴백', e&&e.message); _probeReady=false; _cubeCam=null; }
        mesh.visible = _vis;
      }
      // 준비되면 반사 세기를 서서히 올린다(첫 프레임 검은 큐브가 번쩍이는 것 방지)
      //   ⚠️보간 계수는 **[0,1]로 양쪽 클램프**할 것. dt가 음수/이상치인 틱이 있으면 계수가 음수가 되어
      //     값이 반대로 튄다(실제로 uReflMix가 -0.04까지 갔다). 결과도 [0,0.85]로 한 번 더 가둔다.
      const tgt = _probeReady ? 0.85 : 0.0;
      const kk = Math.max(0, Math.min(1, (dt||0)*2));
      const nv = mat.uniforms.uReflMix.value + (tgt - mat.uniforms.uReflMix.value)*kk;
      mat.uniforms.uReflMix.value = Math.max(0, Math.min(0.85, nv));
    }
    // 🌬️ V4 — 줄무늬 포말 방향.
    //   ⚠️사령관 지적("바다에 줄무늬가 생긴다", 2026-07-22): 풍향을 **그대로** 따르게 했더니 이상해졌다.
    //     원인 = 기존 하드코딩 (0.913,0.408)은 우연이 아니라 **주 너울 방향(WAVES[0].a≈0.42rad)** 이었다.
    //     줄무늬가 파도 결을 '따라' 누워 있어 자연스러웠는데, wind.dir은 자유롭게 떠돌아 결을 '가로질러' 눕는다.
    //     게다가 풍향이 0/90° 근처면 방향이 월드 축과 정렬돼 vnoise 격자와 공명해 딱딱한 줄이 생긴다.
    //   → **주 너울 방향을 기준**으로 두고 바람은 ±STREAK_WIND_RANGE 안에서만 흔든다(결을 크게 벗어나지 않음).
    //     window.__windlock(rad)로 고정, __windlock(-1)로 추종 복귀 — 사령관이 즉석에서 판별·튜닝 가능.
    if(mat.uniforms && mat.uniforms.uWindDir){
      let ang;
      if(_windLock >= 0) ang = _windLock;                       // 고정(디버그/확정값)
      else {
        const base = SWELL_ANG;
        if(ctx.wind){ let d=(ctx.wind.dir - base + Math.PI)%(Math.PI*2); if(d<0)d+=Math.PI*2; d-=Math.PI;
          ang = base + Math.max(-STREAK_WIND_RANGE, Math.min(STREAK_WIND_RANGE, d)); }
        else ang = base;
      }
      mat.uniforms.uWindDir.value.set(Math.cos(ang), Math.sin(ang));
    }
    // ★수중 판정: 카메라가 물속 OR 플레이어가 잠수(몸 물속). TPS에선 카메라가 수면 위에 남아 잠수해도 미발동하던 것 보강(사령관 "잠수 시 화면 안 바뀜").
    const under = (camera.position.y < LEVEL) || !!(ctx.player && ctx.player.pos && ctx.player.pos.y < LEVEL - 1.0);
    if(under && !_wasUW){ _wasUW=true;
      if(scene.fog) scene.fog.color.set(0x0e3850); scene.background.set(0x0e3850);
      if(!_uw){ _uw=document.createElement('div'); _uw.style.cssText='position:fixed;inset:0;z-index:6;pointer-events:none;transition:opacity .35s;background:radial-gradient(ellipse at 50% 45%, rgba(20,80,110,.10), rgba(6,34,56,.5) 95%)'; document.body.appendChild(_uw); }
      _uw.style.opacity='1';
    } else if(!under && _wasUW){ _wasUW=false;
      if(scene.fog){ scene.fog.color.copy(_airFogC); scene.fog.near=_airNear; scene.fog.far=_airFar; } scene.background.copy(_airBg);
      if(_uw) _uw.style.opacity='0';
    }
    // ★수중 가시거리(2026-07-13 밤, 사령관 "너무 투명함 — 바다 같지 않음"): far를 48→20으로 줄여 더 탁하게.
    //   매 프레임 갱신 = window.__uwNear/__uwFar로 잠수 중에도 즉시 라이브 튜닝 가능(기본 1.0/20).
    if(under && scene.fog){
      scene.fog.near = (window.__uwNear!=null) ? window.__uwNear : 1.0;
      scene.fog.far  = (window.__uwFar!=null)  ? window.__uwFar  : 20;
    }
    // 🌊 caustics 물빛 — 시간 진행 + 수중 페이드(부드럽게). 화면 밖(위)일 땐 draw 스킵(비용↓).
    _causMat.uniforms.uTime.value += dt;
    _causOp += ((under?1:0) - _causOp) * Math.min(1, dt*4);
    _causMat.uniforms.uOpacity.value = _causOp;
    _causMesh.visible = _causOp > 0.003;
  });

  // 파도 높이 함수(셰이더 vertexShader와 동일 공식) — 배가 물 표면에 정확히 떠서 같이 출렁이게.
  //   ⚠️**Gerstner 역변위(2026-07-22 V3)**: 정점 셰이더는 정점을 수평으로 밀어(wp.x/z += uGerstner*…) 마루를 뾰족하게 만든다.
  //     따라서 화면의 월드 좌표 (X,Z)에 보이는 물 표면은 **원래 격자점 (x,z)에서 밀려온 것**이고,
  //     h(X,Z)를 그냥 계산하면 실제 보이는 높이와 어긋난다 → 배가 물에 안 맞는다(파도 속에 박히거나 뜸).
  //     역변위를 고정점 반복(2회)으로 풀어 원래 격자점을 찾은 뒤 그 자리 높이를 돌려준다.
  //     변위가 작아 2회면 충분히 수렴한다(하네스 `_water_e2e.mjs`가 셰이더 식과 수치 대조).
  ctx.water = { mesh, mat, level:LEVEL,
    heightAt(x,z){ if(!mat.uniforms) return LEVEL;
      const t=mat.uniforms.uTime.value, wa=mat.uniforms.uWaveAmp.value, sw=mat.uniforms.uSwell.value;
      const Q=mat.uniforms.uGerstner ? mat.uniforms.uGerstner.value : 0;
      let bx=x, bz=z;
      if(Q>1e-4 && _gerstBand.length){                 // 역변위: bx ← X − disp(bx,bz)
        for(let it=0; it<2; it++){
          let dx=0, dz=0;
          for(const g of _gerstBand){ const A=g.A*(g.swell?sw:wa), cp=Math.cos(g.kx*bx + g.kz*bz + t*g.sp);
            dx += cp*A*g.c; dz += cp*A*g.s; }
          bx = x - Q*dx; bz = z - Q*dz;
        }
      }
      let h=0; for(const w of WAVES){ const c=Math.cos(w.a), s=Math.sin(w.a), sc=w.f<0.10?sw:wa;   // ★WAVES 배열 = 셰이더와 동일(부력↔시각 동기)
        h += w.A*sc*Math.sin(c*w.f*bx + s*w.f*bz + t*w.s); }
      return LEVEL + h; },
    // 🧪 검증 전용 — 하네스가 "정점 셰이더가 실제로 만드는 표면점"을 재현해 heightAt과 대조한다.
    //   격자점 (x,z)를 셰이더와 똑같이 변위시켜 (worldX, worldZ, y)를 돌려준다.
    _surfacePoint(x,z){ if(!mat.uniforms) return { x, y:LEVEL, z };
      const t=mat.uniforms.uTime.value, wa=mat.uniforms.uWaveAmp.value, sw=mat.uniforms.uSwell.value;
      const Q=mat.uniforms.uGerstner ? mat.uniforms.uGerstner.value : 0;
      let h=0; for(const w of WAVES){ const c=Math.cos(w.a), s=Math.sin(w.a), sc=w.f<0.10?sw:wa;
        h += w.A*sc*Math.sin(c*w.f*x + s*w.f*z + t*w.s); }
      let dx=0, dz=0;
      for(const g of _gerstBand){ const A=g.A*(g.swell?sw:wa), cp=Math.cos(g.kx*x + g.kz*z + t*g.sp);
        dx += cp*A*g.c; dz += cp*A*g.s; }
      return { x:x+Q*dx, y:LEVEL+h, z:z+Q*dz }; },
    // 🚢 foamtrail.js가 매 프레임 호출 — 웨이크 포말 RT/영역 주입. tex=null이면 비활성.
    setWake(tex, cx, cz, size){ if(!mat.uniforms || !mat.uniforms.uWakeTex) return;
      if(tex){ mat.uniforms.uWakeTex.value = tex; mat.uniforms.uWakeArea.value.set(cx, cz, 1/size, 1); }
      else mat.uniforms.uWakeArea.value.w = 0; } };
  // 🎛️ 라이브 튜닝(사령관 눈 판정 — 물결 품질) : window.__swell(진폭) / window.__waveAmp(값) + 화면 슬라이더 패널
  try{ window.__shallow = h => { if(h!=null) mat.uniforms.uShallow.value.set(h); return '#'+mat.uniforms.uShallow.value.getHexString(); };   // 🌊 얕은물 색(SoT 조정)
       window.__deep = h => { if(h!=null) mat.uniforms.uDeep.value.set(h); return '#'+mat.uniforms.uDeep.value.getHexString(); };            // 🌊 깊은물 색
       window.__swell = v => { if(mat.uniforms) mat.uniforms.uSwell.value = +v; return mat.uniforms.uSwell.value; };
       window.__waveAmp = v => { if(mat.uniforms) mat.uniforms.uWaveAmp.value = +v; return mat.uniforms.uWaveAmp.value; };
       window.__waven = v => { if(mat.uniforms) mat.uniforms.uWaveN.value = +v; return mat.uniforms.uWaveN.value; };
       window.__gerst = v => { if(mat.uniforms) mat.uniforms.uGerstner.value = +v; return mat.uniforms.uGerstner.value; };
       window.__foam = v => { if(mat.uniforms) mat.uniforms.uFoam.value = +v; return mat.uniforms.uFoam.value; };
       // 🔍 Phase2 격리 훅(2026-07-22) — "바다에 줄무늬가 생긴다" 같은 지적을 **추측 없이 1초에 판별**하기 위한 것.
       //   인자 없이 부르면 조회만. 하나씩 0으로 꺼보면 어느 항이 범인인지 바로 나온다.
       window.__streak = v => { if(v!=null) mat.uniforms.uStreak.value = +v; return mat.uniforms.uStreak.value; };   // 바람결 줄무늬 포말
       window.__sss    = v => { if(v!=null) mat.uniforms.uSSS.value = +v;    return mat.uniforms.uSSS.value; };      // 역광 투과
       window.__reflmix= v => { if(v!=null) mat.uniforms.uReflMix.value = +v;return mat.uniforms.uReflMix.value; };  // 하늘 큐브 반사
       window.__windlock = v => { _windLock = (v==null) ? _windLock : +v; return _windLock; };                        // 줄무늬 방향: -1=풍향추종 / 각도(rad)=고정
       window.__waterdbg = () => ({ streak:mat.uniforms.uStreak.value, sss:mat.uniforms.uSSS.value,
         reflMix:+mat.uniforms.uReflMix.value.toFixed(2), storm:mat.uniforms.uStorm.value, foam:mat.uniforms.uFoam.value,
         gerst:mat.uniforms.uGerstner.value, windDir:[+mat.uniforms.uWindDir.value.x.toFixed(3), +mat.uniforms.uWindDir.value.y.toFixed(3)],
         windLock:_windLock, swellAng:SWELL_ANG, streakRange:STREAK_WIND_RANGE });   // ★하네스가 기준각/허용범위를 여기서 읽는다(값 이중 정의 금지)
  }catch(_){}
  // ★2026-07-10(사령관 "불필요한 것들 정리") — 파도 값 확정 후 기본 숨김으로 전환. 필요할 때만 ?tuner=1로 재활성.
  try{ if(new URLSearchParams(location.search).get('tuner')==='1') _buildWaveTuner(mat); }catch(e){ console.warn('[water] 튜너 패널 실패', e&&e.message); }
  return ctx.water;
}

// 🎚️ 파도 라이브 슬라이더 패널 — 사령관이 항해하며 직접 드래그. [~]키로 숨김/표시. 값 확정 후 기본값 고정하면 제거.
function _buildWaveTuner(mat){
  if(typeof document==='undefined' || document.getElementById('waveTuner')) return;
  const p=document.createElement('div'); p.id='waveTuner';
  p.style.cssText='position:fixed;left:14px;bottom:14px;z-index:120;width:210px;padding:12px 14px;'
    +'background:rgba(10,16,22,.86);border:1px solid rgba(120,190,210,.4);border-radius:12px;'
    +"font:12px Pretendard,system-ui,'Malgun Gothic';color:#cfe8f0;box-shadow:0 6px 22px rgba(0,0,0,.5);"
    +'backdrop-filter:blur(4px);user-select:none';
  const row=(label,id,min,max,step,val)=>`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
      <span>${label}</span><b id="${id}_v" style="color:#7fe3ff;font-variant-numeric:tabular-nums">${val}</b></div>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"
      style="width:100%;accent-color:#4fc3d8;margin-bottom:11px;cursor:pointer">`;
  const sw=mat.uniforms.uSwell.value, wa=mat.uniforms.uWaveAmp.value, wn=mat.uniforms.uWaveN.value, gs=mat.uniforms.uGerstner.value, fm=mat.uniforms.uFoam.value;
  p.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px">
      <b style="color:#9fe3f5;letter-spacing:.03em">🌊 파도 튜너</b>
      <span style="font-size:10px;color:#6d8894">[~] 숨김</span></div>
    ${row('너울(스웰)','wtSwell',0,6,0.1,sw)}${row('잔물결','wtWave',0,2,0.05,wa)}${row('파도 면 조명','wtWaveN',0,80,1,wn)}
    ${row('마루 뾰족(Gerstner)','wtGerst',0,1.5,0.05,gs)}${row('폼(흰거품)','wtFoam',0,1.5,0.05,fm)}
    ${row('배 기울기(climb)','wtPitch',1,4,0.1,2.2)}${row('승선감(마루착지)','wtRide',1,12,0.2,3.0)}
    <label style="display:flex;align-items:center;gap:7px;margin:2px 0 8px;cursor:pointer">
      <input id="wtSail" type="checkbox" checked style="accent-color:#4fc3d8;cursor:pointer">
      <span>🌬️ 순풍 자동항해 (Z조타 후 Q/E만)</span></label>
    <div style="font-size:10px;color:#6d8894;line-height:1.5">'승선감' 낮을수록 슈우웅 뜨고 착지 극적. 맞으면 값 알려주세요.</div>`;
  document.body.appendChild(p);
  const bind=(id,uni)=>{ const el=p.querySelector('#'+id), vv=p.querySelector('#'+id+'_v');
    el.addEventListener('input',()=>{ const v=parseFloat(el.value); if(mat.uniforms) mat.uniforms[uni].value=v; vv.textContent=v.toFixed(2); });
    el.addEventListener('mousedown',e=>e.stopPropagation()); };
  bind('wtSwell','uSwell'); bind('wtWave','uWaveAmp'); bind('wtWaveN','uWaveN'); bind('wtGerst','uGerstner'); bind('wtFoam','uFoam');
  // 배 기울기(climb) = ship.js window.__pitch
  { const el=p.querySelector('#wtPitch'), vv=p.querySelector('#wtPitch_v');
    el.addEventListener('input',()=>{ const v=parseFloat(el.value); vv.textContent=v.toFixed(1); try{ window.__pitch && window.__pitch(v); }catch(_){} });
    el.addEventListener('mousedown',e=>e.stopPropagation()); }
  // 승선감 = ship.js window.__ride(k,c) — 댐핑(c)만 조절(낮을수록 극적). 스프링 강성 k는 고정.
  { const el=p.querySelector('#wtRide'), vv=p.querySelector('#wtRide_v');
    el.addEventListener('input',()=>{ const v=parseFloat(el.value); vv.textContent=v.toFixed(1); try{ window.__ride && window.__ride(null,v); }catch(_){} });
    el.addEventListener('mousedown',e=>e.stopPropagation()); }
  // 🌬️ 순풍 자동항해 토글 → ship.js window.__sail(on)
  { const cb=p.querySelector('#wtSail'); cb.addEventListener('change',()=>{ try{ window.__sail && window.__sail(cb.checked); }catch(_){} }); }
  // 📊 실시간 물리 증거 — 배 수직속도(부력물리 작동 확인). 항해(닻올림) 중에만 움직임.
  const rd=document.createElement('div'); rd.style.cssText='margin-top:9px;padding-top:8px;border-top:1px solid rgba(120,190,210,.2);font-size:10px;color:#8fd0ff;font-variant-numeric:tabular-nums;line-height:1.5';
  p.appendChild(rd);
  (function _rdLoop(){ requestAnimationFrame(_rdLoop);
    const c=window.__ctx; if(!c){ rd.textContent='📊 …'; return; }
    // ★플레이어가 실제로 밟고/조타하는 배 우선(ctx.ship과 다를 수 있음 — 그게 버그일 수도)
    const s=(c.player&&c.player._onShip)||c.ship;
    if(!s){ rd.textContent='📊 배 없음 (건조·승선 필요)'; return; }
    const vy=s.buoyVY||0, sp=s.speed||0, st=s.anchored?'⚓정박':(s.boarded?'🧭조타중':'표류');
    // ★실제 위치 이동량 — 속도8인데 이게 0이면 이동코드가 진짜 멈춘 것.
    const mv=Math.hypot(s.x-(window.__lsx!=null?window.__lsx:s.x), s.z-(window.__lsz!=null?window.__lsz:s.z));
    window.__lsx=s.x; window.__lsz=s.z;
    const land=s._hitLand?'<b style="color:#ff5a5a">🏝️섬충돌</b>':'';
    const pp=c.player&&c.player.pos, d=pp?Math.hypot(pp.x-s.x, pp.z-s.z):0;
    const same=(s===c.ship)?'':' <b style="color:#ffb84d">(ctx.ship≠내배!)</b>';
    rd.innerHTML=`📊 속도<b style="color:${sp<0.3?'#ff8a8a':'#9fe3a0'}">${sp.toFixed(1)}</b> · 실이동<b style="color:${mv<0.02?'#ff5a5a':'#9fe3a0'}">${mv.toFixed(3)}</b> · furl${(s.furl||0).toFixed(1)} ${land}${same}<br>${st} · 배거리 ${d|0}m ${d>40?'<b style="color:#ff5a5a">⚠️떨어짐</b>':''}`;
  })();
  addEventListener('keydown',e=>{ if(e.code==='Backquote'){ p.style.display=(p.style.display==='none'?'block':'none'); } });   // [~]/[`] 토글
}
