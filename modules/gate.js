// gate.js — 차원문(Dimension Gate). ★ref(voyage/ref/차원문레퍼.png) 기준.
//   [먹구름 카메라추종 돔 + 섬 상공 고정 '진짜 3D' 소용돌이 메시 + 바닥 빔/마법진 + 몬스터 스폰].
//   ★2026-07-14(사령관 "3차원이 아닌 것 같다 / 멀어지면 작아져야") — 기존 '돔에 각도로 뚫은 구멍' 트릭 폐기.
//     그 방식은 카메라 시선각(dot) 기반이라 어느 각도서든 완벽한 원 + 거리 무관 고정 크기였음.
//     지금은 게이트 상공 고정 월드좌표에 [나선 디스크 + 먹구름 도넛 링] 실제 지오메트리를 눕혀 배치 →
//     원근 축소(멀수록 작게)와 시점각 왜곡(비스듬히 보면 타원=누운 도넛)이 자동으로 생김.
//   ?sys=terrain,player,sky,nightsky,monsters,combat,gate. 단축키 O:게이트 N:밤 M:일반.
import * as THREE from 'three';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (게이트 등급·스폰 풀)
import { radialTexture } from '/tomob-deploy/modules/fxpool.js';   // R1: radial 텍스처 팩토리 공용화(색스톱 그대로)
import { toast } from '/tomob-deploy/modules/uikit.js';   // ★2026-07-13: 침공 알림 토스트

const NOISE=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+11.7;a*=.5;}return v;}
`;

// ★게이트 등급 = balance.js(BAL.gates) 단일 소스. grade1~4 + boss. 등급별 적정레벨 몬스터만 스폰.
const GATE_THEMES = BAL.gates;
const DEFAULT_GATE = 'grade1';

export function initGate(ctx){
  const { scene } = ctx;
  // ── 소용돌이 튜닝 상수(제안값 — 실플레이로 조정) ──
  const VORTEX_SKY = 340;                    // 소용돌이 중심 고도(게이트 바닥 기준 +m). 멀리서 낮은 각도=납작, 그러나 수평선보단 위
  const VORTEX_R   = 560;                    // 소용돌이 반지름(m). 넓고 크게 펴진 나선(레퍼런스 스케일)
  const VORTEX_LEAN_DEG = 0;                 // 0=수평(하늘의 구멍). 밑에서=둥글게 / 옆에서=두께 있는 옆모습. 하늘 고정(빌보드 아님)
  const ALT_BEAM = VORTEX_SKY;               // 빛기둥 높이 = 소용돌이 고도(지면~소용돌이 중심 연결, 끊김 방지)
  const GLOW = new THREE.Color(0x46e88a), VOR = new THREE.Color(0x1a8a4a);

  // ── ① 먹구름 돔 (카메라 추종 — 하늘 전체 솔리드. 소용돌이 자체는 ①-b의 월드 고정 3D 메시) ──
  const U={ uTime:{value:0}, uOpen:{value:0}, uCloud:{value:new THREE.Color(0x3b4658)},
    uGlow:{value:GLOW.clone()}, uVor:{value:VOR.clone()} };
  const dome=new THREE.Mesh(new THREE.SphereGeometry(4700, 56, 36), new THREE.ShaderMaterial({
    uniforms:U, transparent:true, depthWrite:false, side:THREE.BackSide, fog:false,
    vertexShader:`varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:NOISE+`
      varying vec3 vD; uniform float uTime,uOpen; uniform vec3 uCloud;
      void main(){
        vec3 d=normalize(vD); if(d.y<0.0) discard;
        float horizon=smoothstep(0.0,0.26,d.y);
        // ★하늘을 가득 채운 불투명 뭉게 폭풍구름(고대비 — 봉우리 밝고 골 어둡게)
        vec2 cuv=d.xz/(abs(d.y)+0.26);
        float n=fbm(cuv*1.7+uTime*0.012)*0.6 + fbm(cuv*3.6-uTime*0.008)*0.4;
        float puff=smoothstep(0.28,0.70,n);          // 뭉게구름 덩어리
        vec3 col=mix(uCloud*0.22, uCloud*0.72, puff); // ★어두운 폭풍 구름(전체적으로 어둡게 — 봉우리만 약간 밝게)
        float a=horizon*(0.90+0.10*puff)*uOpen;       // 하늘 가득 불투명(어둡지만 꽉 참)
        gl_FragColor=vec4(col, clamp(a,0.,1.));
      }`}));
  dome.frustumCulled=false; dome.renderOrder=1; scene.add(dome);

  // ── ①-b 소용돌이 = 진짜 다층 3D 포털 VFX (섬 상공 고정 월드좌표 — 원근 축소·시점각 왜곡 자동) ──
  //   ★2026-07-14(사령관 "무슨 도넛을 하늘에 띄우고 끝이야"): 토러스 1개 폐기 → 깊이 있는 포털로 재작성.
  //   구조(vortex→tiltG 안, 로컬 +Z=포털 '면'이 보는 방향):
  //     · cloudSpiral: 어두운 폭풍 구름이 나선으로 휘몰이(레퍼런스 "구름에서 나옴") — 바깥은 돔과 이어지게 페이드
  //     · energyCore : 중심의 밝은 에너지 나선 + 코어(additive glow) — 여기서 빛기둥이 뻗음
  //   tiltG를 수평 근처로 눕히고(LEAN°만 관측자 쪽으로 기움) + vortex.rotation.y로 면이 늘 관측자 향함
  //   → 배에서 비스듬히 올려다보면 '누운 타원', 다가갈수록(원근) 커지고 더 둥글게.
  //   uniforms는 돔의 U 공유(uTime/uOpen/uGlow/uVor/uCloud 색·개폐 자동 동기).
  const _pv=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  // ☁️ 폭풍 구름 나선(어두운 구름이 휘몰이) — normal blend, 바깥은 돔과 이어지게 페이드.
  //   ★나선 왜곡 = 반경 따라 변하는 회전(mat2)로 좌표를 비틀어 샘플 → atan2 ±π 시임(세로 끊김) 원천 없음.
  // 지오·머티리얼(여러 겹이 공유 — U 유니폼 공유로 시간·색·개폐 자동 동기. clone 금지=uTime 링크 끊김).
  const cloudGeo=new THREE.CircleGeometry(VORTEX_R, 160);
  const cloudMat=new THREE.ShaderMaterial({
    uniforms:U, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false, vertexShader:_pv,
    fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uGlow,uVor,uCloud;
      void main(){ vec2 p=(vUv-0.5)*2.0; float r=length(p); if(r>1.0) discard;
        float spin=uTime*0.26 - 1.7/(r+0.34);                    // ★부드러운 나선 감김(넓고 흐르는 팔 — 동심 링 아님)
        float ca=cos(spin), sa=sin(spin); vec2 rp=mat2(ca,-sa,sa,ca)*p;   // ★연속 비틀림 = 시임 없음
        float broad=fbm(rp*1.5 + uTime*0.02)*0.66 + fbm(rp*3.2 - uTime*0.015)*0.34;  // 넓은 나선 팔(저주파)
        broad=smoothstep(0.30,0.66,broad);                       // 은하식 흐르는 팔(물결무늬 방지)
        float fine=fbm(rp*7.5 + uTime*0.03)*0.6 + fbm(rp*14.0 - uTime*0.02)*0.4;  // 가는 결(고주파 디테일)
        float wisp=pow(clamp(fine,0.,1.),2.2);                   // 날카로운 가는 실 필라멘트
        float cl=broad*(0.66 + 0.6*wisp);                        // 넓은 팔 안에 가는 필라멘트 디테일
        float hi=smoothstep(0.5,0.80,broad)*wisp;                // 팔 가장자리 밝은 실 하이라이트
        float radial=smoothstep(1.0,0.12,r);                     // 중심으로 밝게(에너지 조명)
        float edge=smoothstep(1.0,0.85,r);                       // 바깥 거의 끝까지 팔 보임(레퍼런스처럼 넓게)
        float hole=smoothstep(0.02,0.20,r);
        float I=cl*(0.42 + radial*0.62)*edge*hole*uOpen;         // 밝게 — 바깥 나선 팔도 또렷
        vec3 col=mix(uVor, uGlow, radial*0.7) + uGlow*hi*edge*0.8;   // 밝은 실 하이라이트 = 촘촘한 디테일
        gl_FragColor=vec4(col*I, clamp(I,0.,1.)); }`});
  const coreGeo=new THREE.CircleGeometry(VORTEX_R*0.82, 160);
  const coreMat=new THREE.ShaderMaterial({
    uniforms:U, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false, vertexShader:_pv,
    fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uGlow,uVor;
      void main(){ vec2 p=(vUv-0.5)*2.0; float r=length(p); if(r>1.0) discard;
        float spin=uTime*0.5 - 2.6/(r+0.18);
        float ca=cos(spin), sa=sin(spin); vec2 rp=mat2(ca,-sa,sa,ca)*p;   // ★연속 비틀림 = 시임 없음
        float en=fbm(rp*3.4 + uTime*0.05)*0.6 + fbm(rp*7.0 - uTime*0.04)*0.4;
        en=smoothstep(0.30,0.82,en);                             // 구름결 대비
        float glow=smoothstep(0.72,0.06,r);
        float core=smoothstep(0.11,0.0,r);                       // 밝은 중심 코어
        float I=(en*glow*1.05 + core*1.5)*uOpen;                 // 코어 부드럽게(흰색 번짐 줄임)
        vec3 col=mix(uVor,uGlow,clamp(en,0.,1.)) + uGlow*core*0.5;   // 글로우색 코어(흰색 억제)
        gl_FragColor=vec4(col*I, clamp(I,0.,1.)); }`});
  // ☁️ 소용돌이 = 구름 나선을 법선(수직)으로 여러 겹 쌓은 두께 있는 3D 볼륨. 하늘 고정(빌보드 아님) →
  //   밑에서=둥근 소용돌이 / 옆에서=두께 있는 옆모습. 돔 폭풍 구름 사이에서 '쏟아지는' 느낌.
  const tiltG=new THREE.Group();
  tiltG.rotation.x=-(Math.PI/2 - THREE.MathUtils.degToRad(VORTEX_LEAN_DEG));  // LEAN=0 → 수평(하늘의 구멍)
  const V_LAYERS=5, V_THICK=VORTEX_R*0.16;   // 겹 수 · 두께(플랫한 원반 + 약간의 두께감 · 실플레이 튜닝)
  for(let i=0;i<V_LAYERS;i++){ const t=i/(V_LAYERS-1), zc=(t-0.5)*V_THICK;
    const m=new THREE.Mesh(cloudGeo, cloudMat); m.position.z=zc; m.rotation.z=t*1.6; m.renderOrder=2; tiltG.add(m); }   // 겹마다 비틀림 → 3D 볼륨
  const energyCore=new THREE.Mesh(coreGeo, coreMat); energyCore.renderOrder=3; tiltG.add(energyCore);
  const vortex=new THREE.Group(); vortex.add(tiltG);
  vortex.visible=false; scene.add(vortex);

  // ── ② 빛기둥 (밝은 초록흰빛 솔리드 광선 — 빌보드, 어느 방향서도 기둥처럼) ──
  const BU={ uTime:{value:0}, uCol:{value:GLOW.clone()}, uOpen:{value:0} };
  const _vsh=`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  // 코어(밝은 광선) — 폭14
  const beamCore=new THREE.Mesh(new THREE.PlaneGeometry(14, ALT_BEAM, 1, 1), new THREE.ShaderMaterial({
    uniforms:BU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:_vsh,
    fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uCol;
      void main(){
        float y=vUv.y;
        // 좌우로 넘실대는 불기둥(곧은 레이저 X)
        float wob=(fbm(vec2(y*3.2 - uTime*1.6, 1.0))-0.5)*0.55 + (fbm(vec2(y*7.5 - uTime*2.9, 4.0))-0.5)*0.25;
        float x=abs((vUv.x-0.5)+wob*0.5)*2.0;
        float streak=pow(clamp(fbm(vec2(vUv.x*5.0, y*4.5 - uTime*2.4)),0.0,1.0),1.5);
        float body=pow(clamp(1.0-x,0.0,1.0),2.4)*(0.30+1.1*streak);
        float core=pow(clamp(1.0-x,0.0,1.0),6.0)*(0.6+0.5*streak);
        float ends=smoothstep(1.0,0.86,y);                                  // 위쪽만 페이드
        float I=(body+core*1.5)*ends*uOpen;
        I*=0.78+0.22*fbm(vec2(uTime*2.4,1.0));
        vec3 col=mix(uCol, vec3(0.85,1.0,0.9), core*0.85);
        gl_FragColor=vec4(col*clamp(I,0.0,1.0)*1.7, clamp(I,0.0,1.0)); }`}));
  // 헤일로(넓은 부드러운 글로우) — 폭48
  const beamHalo=new THREE.Mesh(new THREE.PlaneGeometry(48, ALT_BEAM, 1, 1), new THREE.ShaderMaterial({
    uniforms:BU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:_vsh,
    fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uCol;
      void main(){
        float y=vUv.y;
        float wob=(fbm(vec2(y*2.6 - uTime*1.3, 2.0))-0.5)*0.5;
        float x=abs((vUv.x-0.5)+wob*0.4)*2.0;
        float glow=pow(clamp(1.0-x,0.0,1.0), 2.0);
        float turb=0.6+0.5*fbm(vec2(vUv.x*3.0, y*3.0 - uTime*1.8));
        float ends=smoothstep(1.0,0.82,y);
        float a=glow*0.42*turb*ends*uOpen;
        gl_FragColor=vec4(uCol*1.4, clamp(a,0.0,1.0)); }`}));
  const beam=new THREE.Group(); beam.add(beamHalo, beamCore);
  beamHalo.renderOrder=3; beamCore.renderOrder=4;   // ★먹구름 돔(renderOrder 1)보다 위 — 돔에 안 가려지게
  beam.position.y=ALT_BEAM*0.5; scene.add(beam);
  const beamLight=new THREE.PointLight(GLOW.getHex(), 0, 120, 2); scene.add(beamLight);

  // ── ③ 바닥 마법진 (문양처럼 퍼짐) ──
  const RU={ uTime:{value:0}, uCol:{value:GLOW.clone()}, uOpen:{value:0} };
  // ★ref(voyage/ref/마법진.webp) 처음부터 재구현 — 불타는 초록 에너지 소환진.
  //   연속 반경 레이아웃(2단 분리 방지) + 진짜 룬 글리프 2띠 + 펜타그램 + fbm 불꽃질감 + 잔불(shader ember, Points 아님).
  const rune=new THREE.Mesh(new THREE.CircleGeometry(20, 128), new THREE.ShaderMaterial({
    uniforms:RU, transparent:true, depthWrite:false, depthTest:true, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4,
    blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uCol;
      const float TAU=6.28318530718;
      float segDist(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h); }
      vec2 sv(float i,float R){ float a=-1.5707963+i*(TAU/5.0); return vec2(cos(a),sin(a))*R; }
      void main(){
        vec2 p0=(vUv-0.5)*2.0; float r0=length(p0);
        if(r0>1.16){ discard; }
        float edge=smoothstep(0.98,0.70,r0);               // 둥글게 페이드(짤림 방지)
        // 화염 워프(물처럼 크게 출렁이지 않게 소량)
        vec2 w1=vec2(fbm(p0*3.2+vec2(0.0,-uTime*1.2)), fbm(p0*3.2+vec2(5.3,-uTime*1.3)))-0.5;
        vec2 p=p0 + w1*0.055;
        float r=length(p); float ang=atan(p.y,p.x);
        // 연료선 거리장(D): 링3 + 펜타그램 + 룬 눈금
        float D=1e9;
        D=min(D, abs(r-0.80)); D=min(D, abs(r-0.50)); D=min(D, abs(r-0.22));
        float sa=uTime*0.05; mat2 M=mat2(cos(sa),sin(sa),-sin(sa),cos(sa)); vec2 qs=M*p;
        float RS=0.48; vec2 v0=sv(0.,RS),v1=sv(1.,RS),v2=sv(2.,RS),v3=sv(3.,RS),v4=sv(4.,RS);
        float ds=1e9;
        ds=min(ds,segDist(qs,v0,v2)); ds=min(ds,segDist(qs,v2,v4)); ds=min(ds,segDist(qs,v4,v1)); ds=min(ds,segDist(qs,v1,v3)); ds=min(ds,segDist(qs,v3,v0));
        D=min(D, ds);
        float N=44.0; float fs=abs(fract(ang/TAU*N + uTime*0.04)-0.5);
        D=min(D, abs(r-0.66)+fs*0.5);
        // FIRE: 날카로운 방사 불혀 + 깊은 틈 + 빠른 깜빡임
        float streak=fbm(vec2(ang*11.0, r*7.0 - uTime*3.2));
        streak=pow(clamp(streak,0.0,1.0), 2.6);
        float tongue=pow(clamp(fbm(vec2(ang*26.0, r*3.0 - uTime*3.8)),0.0,1.0), 3.4);
        float fuel=exp(-D*9.0);
        float flame=fuel*(streak*2.4 + tongue*1.7);
        float hot=exp(-D*34.0)*(0.7+0.6*streak);
        float ember=smoothstep(0.66,1.0, fbm(p*26.0 - vec2(0.0,uTime*3.4)))*smoothstep(0.34,0.0,D);
        float center=exp(-r*3.6)*(0.5+0.8*fbm(p*5.0-vec2(0.0,uTime*2.2)));
        float I=(flame*1.0 + hot*0.85 + ember*1.8 + center*0.7)*edge*uOpen;
        I*=0.74+0.26*fbm(vec2(uTime*3.4,5.0));
        vec3 col=mix(uCol*0.08, uCol, clamp(I,0.0,1.0));
        col=mix(col, mix(uCol,vec3(0.85,1.0,0.9),0.85), clamp(hot*0.6+ember+center*0.5-0.2,0.0,1.0));
        float a=clamp(I,0.0,1.0);
        gl_FragColor=vec4(col*a*0.95, a); }`}));
  rune.rotation.x=-Math.PI/2; rune.renderOrder=3; scene.add(rune);

  // ── ③-b 위로 타오르는 불꽃 링 (소환진 둘레에서 솟는 수직 화염) ──
  const WU={ uTime:{value:0}, uCol:{value:GLOW.clone()}, uOpen:{value:0} };
  function makeFlameRing(radius, height, topR){
    const m=new THREE.Mesh(new THREE.CylinderGeometry(topR, radius, height, 72, 1, true), new THREE.ShaderMaterial({
      uniforms:WU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:NOISE+`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uCol;
        void main(){
          float v=vUv.y;                                              // 0 바닥 .. 1 꼭대기
          float col1=fbm(vec2(vUv.x*20.0, -uTime*2.6));               // 컬럼별 불혀 높이
          float hgt=0.30+0.60*col1;
          float shape=smoothstep(hgt, hgt*0.12, v);                   // 아래 넓고 위 뾰족(불혀)
          float tex=pow(clamp(fbm(vec2(vUv.x*42.0, v*7.5 - uTime*4.2)),0.0,1.0), 2.5); // 날카로운 세로흐름
          float body=shape*(0.20+1.35*tex);
          float baseHot=smoothstep(0.34,0.0,v);                       // 바닥 백열
          float I=(body + baseHot*body*1.6);
          I*=0.72+0.28*fbm(vec2(uTime*4.2,2.0));                      // 빠른 깜빡임
          vec3 col=mix(mix(uCol,vec3(0.9,1.0,0.92),0.7), uCol, clamp(v*1.3,0.0,1.0)); // 바닥 백열초록→위 진초록
          float a=clamp(I,0.0,1.0)*smoothstep(1.0,0.72,v)*uOpen;      // 위 뾰족 컷 + 게이트 페이드
          gl_FragColor=vec4(col*a, a);
        }`}));
    m.position.y=height/2; return m;
  }
  const flameRings=new THREE.Group();
  flameRings.add(makeFlameRing(16, 8, 17.4), makeFlameRing(10, 5.5, 10.8));   // 바깥/중간 링 둘레 화염(rune 반경 16/10 매칭)
  flameRings.renderOrder=3; scene.add(flameRings);

  // ── ④ 솟구치는 입자 ──
  const _pcTex=radialTexture(48, [[0,'rgba(255,255,255,1)'],[0.4,'rgba(190,255,210,0.7)'],[1,'rgba(90,230,140,0)']], { srgb:true });   // R1: 색스톱 그대로
  const PCN=200, pcGeo=new THREE.BufferGeometry(), _pcp=new Float32Array(PCN*3), _pcs=new Float32Array(PCN);
  for(let i=0;i<PCN;i++){ const a=Math.random()*6.283, rr=Math.random()*7; _pcp[i*3]=Math.cos(a)*rr; _pcp[i*3+1]=Math.random()*ALT_BEAM; _pcp[i*3+2]=Math.sin(a)*rr; _pcs[i]=0.5+Math.random(); }
  pcGeo.setAttribute('position', new THREE.BufferAttribute(_pcp,3));
  const pcMat=new THREE.PointsMaterial({ color:0xa9ffc6, map:_pcTex, size:0.7, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
  const pcPts=new THREE.Points(pcGeo, pcMat); pcPts.frustumCulled=false; pcPts.renderOrder=3; scene.add(pcPts);

  // ── 상태 ──
  let active=false, theme=null, gGX=0, gGY=0, gGZ=0, openT=0, spawned=0, spawnAcc=0;
  let bossSpawned=false, bossRef=null, cleared=false;   // ★게이트 보스: 보스 스폰/추적/토벌 여부
  const OPEN_DUR=3.5;
  let prevT=null, nightArmed=true;   // 🌙 자정 근처섬 개방(wave.js 패턴): prevT=이전 sky시간 · nightArmed=이번 밤 개방 가능(낮에 재무장)
  let nightCount=0;   // 🌙 밤 카운트(자정 크로싱마다 +1). 게이트는 2번째 밤부터 개방 — 첫 밤=튜토리얼 보호(사령관 2026-07-23).
  // 🌙 개방 예약(retry): 자정 크로싱은 '이번 밤 개방'을 예약만 하고, 실제 개방은 아래 재시도 루프가 담당.
  //   섬 스트리밍/콜라이더 등록 시차로 크로싱 프레임에 섬이 없어도 조용히 다음날까지 스킵하지 않고 밤새 재시도한다.
  let openPending=false, openTryAcc=0, openElapsed=0;

  // ★섬 충돌체(RAPIER 물리) 직접 레이캐스트 = 캐릭터가 실제 닿는 표면. 높이추정 아님.
  const SEA = (typeof ctx.water?.level==='number') ? ctx.water.level : 0;   // 해수면 Y
  const LAND_MARGIN = 3;   // 섬 판정: 해수면 + 이만큼 위
  // 섬 충돌체(RAPIER 물리) 레이캐스트 — 고정 높이서 ↓. 바다 위면 seabed(<0) 또는 null.
  function colliderGroundY(x, z){
    const R=ctx.RAPIER, w=ctx.world; if(!R||!w) return null;
    const fromY=260;
    try{
      const ray=new R.Ray({x,y:fromY,z},{x:0,y:-1,z:0});
      const hit=w.castRay(ray, fromY+600, true, undefined, undefined, ctx.player?.col||undefined);
      if(!hit) return null;
      const toi=(hit.toi!==undefined)?hit.toi:hit.timeOfImpact;
      return fromY - toi;
    }catch(e){ return null; }
  }
  // ★섬/바다 판별: 충돌체 표면이 해수면보다 충분히 높으면 육지. null/해수면이하 = 바다.
  //   (R4 정책 예외 — ground.js SSOT의 THREE 레이 대신 Rapier 물리레이 유지: 게이트는 "몹이 실제로 설 수 있는
  //    물리 바닥"이 필요 + 스트리밍 섬 collide 등록 시차 대응. 사유 문서=ground.js 헤더. 신규 코드는 ctx.ground 사용.)
  function isLand(x, z){ const y=colliderGroundY(x,z); return (y!=null && y>SEA+LAND_MARGIN) ? y : null; }
  // ★내륙 한 점 찾기: 중심에서 링 확장, 후보+이웃 8방향 전부 육지여야 통과(해안 슬리버 배제).
  function findIslandSpot(cx, cz, maxR){
    maxR = maxR||120;
    const test=(x,z)=>{ const y=isLand(x,z); if(y==null) return null;
      const ok=[[8,0],[-8,0],[0,8],[0,-8],[6,6],[-6,6],[6,-6],[-6,-6]].every(d=>isLand(x+d[0],z+d[1])!=null);
      return ok? y : null; };
    let y=test(cx,cz); if(y!=null) return {x:cx,z:cz,y};
    for(let r=10;r<=maxR;r+=10){ for(let a=0;a<360;a+=20){ const rad=a*Math.PI/180;
      const x=cx+Math.cos(rad)*r, z=cz+Math.sin(rad)*r; y=test(x,z); if(y!=null) return {x,z,y}; } }
    return null;
  }
  function open(themeKey, gx, gz, gy){
    theme=GATE_THEMES[themeKey]||GATE_THEMES[DEFAULT_GATE];
    const col=new THREE.Color(theme.color);
    U.uGlow.value.copy(col); U.uVor.value.copy(col).multiplyScalar(0.4);
    BU.uCol.value.copy(col); RU.uCol.value.copy(col); WU.uCol.value.copy(col); beamLight.color.copy(col); pcMat.color.copy(col).lerp(new THREE.Color(0xffffff),0.4);
    // 좌표 미지정 시 = 섬 내륙 자동 탐색(중심: 명시 or terrain.spawn).
    const py=ctx.player?.pos?.y||0;
    if(gx==null||gz==null){
      const sp=ctx.terrain?.spawn||{x:0,z:0};
      const spot=findIslandSpot(gx??sp.x, gz??sp.z, 140);
      if(spot){ gGX=spot.x; gGZ=spot.z; gGY=spot.y; }
      else { gGX=gx??sp.x??0; gGZ=gz??sp.z??0; gGY=(colliderGroundY(gGX,gGZ))??py; console.warn('[gate] 섬 내륙 못찾음 — 폴백'); }
    } else {
      gGX=gx; gGZ=gz;
      // 바닥높이: 명시값 > 섬 충돌체 레이캐스트 > (폴백)terrain.groundAt.
      if(gy!=null) gGY=gy;
      else { const cy=colliderGroundY(gGX,gGZ); gGY=(cy!=null)?cy:((ctx.terrain?.groundAt?.(gGX,gGZ,py+40))||py); }
    }
    beam.position.set(gGX, gGY+ALT_BEAM*0.5, gGZ);
    vortex.position.set(gGX, gGY+VORTEX_SKY, gGZ);   // ★소용돌이 = 섬 상공 고정 월드좌표(카메라 추종 아님 → 원근 자동)
    rune.position.set(gGX, gGY+0.05, gGZ);   // 바닥 밀착(살짝 떠보임 방지). polygonOffset로 z-fighting 회피.
    flameRings.position.set(gGX, gGY+0.05, gGZ);   // 불꽃 링도 게이트 바닥에
    beamLight.position.set(gGX, gGY+8, gGZ);
    pcPts.position.set(gGX, gGY, gGZ);
    active=true; openT=0; spawned=0; spawnAcc=0;
    bossSpawned=false; bossRef=null; cleared=false;   // ★보스 추적 리셋
    // ⚡스폰 풀 프리로드 — 게이트 열림 연출(OPEN_DUR 3.5s + uOpen 0.6 게이트) 동안 몹 모델·애니·
    //   텍스처·셰이더를 미리 로드/컴파일(monsters.js preloadMonster 프리워밍) → 첫 스폰 콜드로드 히칫 제거.
    try{ (theme.pool||[]).forEach(k=>ctx.preloadMonster?.(k)); if(theme.bossKey) ctx.preloadMonster?.(theme.bossKey); }catch(_){}
    // ★2026-07-13(사령관 "게이트 열리면 노래 안 나오나"): 원래 전용 BGM 없었음 — 신규 곡 대신 기존 battle 트랙 재사용(bgm_battle.mp3).
    try{ ctx.sound?.bgm?.set('battle'); }catch(_){}
    console.log('[gate] 오픈:', theme.ko, '@', gGX.toFixed(0), gGZ.toFixed(0), 'gy', gGY.toFixed(0));
    return theme;
  }
  function close(){ active=false; try{ ctx.sound?.bgm?.set(null); }catch(_){} }   // BGM force 해제 → auto 복귀
  // 🌙 등급 = 플레이어 레벨 매칭 (BAL.gates.lvl: 1~4=g1 · 4~8=g2 · 9~14=g3 · 15~20=g4 · 20+=boss)
  function gradeForLevel(lv){ if(lv>=20) return 'boss'; if(lv>=15) return 'grade4'; if(lv>=9) return 'grade3'; if(lv>=4) return 'grade2'; return 'grade1'; }
  // ★2026-07-13(사령관 "섬 어디든 열려도 됨" — 항구/플레이어 근처 제약 폐지): 지금 스트리밍(worldstream.loaded)돼
  //   물리 콜라이더가 실제로 있는 섬 중 무작위 1개. (스트림 안 된 먼 섬은 몹이 설 바닥 자체가 없어 선택 불가 — 기술 제약.)
  //   ws 없거나 로드된 섬이 없으면 null(호출부가 플레이어 근접 폴백으로 대체).
  function pickGateIsland(){
    const ws=ctx.worldstream; if(!ws || !ws.loaded || !ws.loaded.size || !ws.islands) return null;
    const ids=[...ws.loaded.keys()]; const id=ids[(Math.random()*ids.length)|0];
    const isle=ws.islands.find(i=>i.id===id); if(!isle) return null;
    const WS=ws.WORLD_SCALE||1.5;
    const name = (ws.isleName ? ws.isleName(isle) : (isle.prefab||isle.id));   // 🏷️ 제대로 된 섬 이름(해안/부족명)
    return { x:isle.x*WS, z:isle.z*WS, name };
  }
  // ★침공 알림 — "OOO 게이트가 [섬 이름]에서 열렸다" 토스트(사령관 지시, 기존엔 console.log만 있었음).
  function announceInvasion(th, islandName){
    if(!th) return;
    toast('「'+(islandName||'미지의 해안')+'」에 마수가 쏟아진다', { accent:'red', ms:5200, speaker:th.ko+' 침공' });
  }

  ctx.onUpdate(dt=>{ dt=dt??0.016; const t=(U.uTime.value+=dt); BU.uTime.value=t; RU.uTime.value=t; WU.uTime.value=t;
    if(ctx.camera) dome.position.copy(ctx.camera.position);   // 먹구름 돔 = 카메라 추종
    if(ctx.camera) beam.rotation.y=Math.atan2(ctx.camera.position.x-beam.position.x, ctx.camera.position.z-beam.position.z); // 빛기둥 빌보드(항상 카메라 향함)
    // 소용돌이 = 수평(y축) 회전만 카메라 추적 — 눕힌 면이 항상 관측자 쪽으로 기울어 보임(도넛 옆면 노출 방지).
    //   눕힘각(tiltG.rotation.x)·월드 위치는 고정이라 거리 멀어지면 원근으로 작아지고, 비스듬히 보면 타원으로 찌그러짐.
    // ★소용돌이 = 하늘에 고정된 수평 3D 오브젝트(빌보드 아님) → 보는 각도·거리에 따라 다르게 보임(밑=둥글게 / 옆=비스듬히)
    vortex.visible=U.uOpen.value>0.02;
    // 🌙 자정(dayTime 0.75) 상향 크로싱 → 근처 섬에 등급별 게이트 개방. 낮(0.05~0.65) 진입 = 재무장 + 미토벌 게이트 close.
    const st=ctx.sky?.getTime?.();
    if(st!=null){
      // 🌙 자정(0.75) 상향 크로싱 감지 → 밤 카운트. 실제 개방은 아래 재시도 루프.
      const crossedMidnight = (prevT!=null && prevT<0.75 && st>=0.75);
      if(crossedMidnight) nightCount++;
      // ★게이트는 2번째 밤부터만 개방(첫 밤=튜토리얼 중일 수 있어 보호, 사령관 2026-07-23). 세션 기준 카운트.
      if(nightArmed && !active && !openPending && crossedMidnight && nightCount>=2){
        openPending=true; openTryAcc=1e9; openElapsed=0;   // Acc 큰 값 = 이번 프레임 즉시 1차 시도
      }
      // 개방 재시도: 섬 스트리밍/콜라이더 등록 시차 대응 — 성공 or 낮 재무장까지 밤새 재시도(무한 침묵 스킵 제거).
      if(openPending){
        if(active || !nightArmed){ openPending=false; }    // 이미 열렸거나 낮 진입 → 예약 해제
        else {
          openElapsed+=dt; openTryAcc+=dt;
          if(openTryAcc>=0.6){                              // 0.6s 간격 재시도(첫 프레임은 즉시)
            openTryAcc=0;
            const p=ctx.player?.pos, lv=ctx.combat?.level ?? 1;
            // ★섬 어디든 열려도 됨(사령관 2026-07-13) — 스트리밍된 섬 중 무작위 우선, 없으면 플레이어 근처로 폴백.
            const pick=pickGateIsland();
            const baseX=pick?pick.x:(p?.x??gGX), baseZ=pick?pick.z:(p?.z??gGZ);
            const grow=Math.min(400, (Math.floor(openElapsed/2))*200);   // 실패 지속 시 탐색반경 단계 확대(+0→+200→+400 상한)
            const searchR=(pick?200:300)+grow;
            const spot=(ctx.dungeon && ctx.dungeon.active) ? null : findIslandSpot(baseX, baseZ, searchR);   // ★D4(2026-07-15 던전 신규): 던전 중 개방 보류 — 플레이어 근처 폴백이 던전 아레나 바닥을 육지로 오인해 지하에 게이트가 열리는 것 방지(예약 유지 → 퇴장 후 밤이면 정상 개방)
            if(spot){ const th=open(gradeForLevel(lv), spot.x, spot.z, spot.y);
              nightArmed=false; openPending=false;
              announceInvasion(th, pick?.name);
              console.log('[gate] 🌙 자정 개방 — lv'+lv+' →', gradeForLevel(lv), pick?('@'+pick.name):'(플레이어 근처 폴백)', 'R'+searchR, openElapsed>0.7?('(재시도 '+openElapsed.toFixed(1)+'s)'):''); }
            else if(openElapsed<0.7) console.warn('[gate] 자정 개방 1차 실패 — 개방 가능 섬 대기하며 재시도 중…');
          }
        }
      }
      if(st>0.05 && st<0.65){ nightArmed=true; openPending=false; if(active && !cleared) close(); }   // 낮 진입: 재무장 + 예약 해제 + 미토벌 닫힘
      prevT=st;
    }
    const tgt=active?1:0;
    if(U.uOpen.value<tgt) U.uOpen.value=Math.min(tgt, U.uOpen.value+dt/OPEN_DUR);
    else if(U.uOpen.value>tgt) U.uOpen.value=Math.max(tgt, U.uOpen.value-dt/2.0);
    BU.uOpen.value=U.uOpen.value; RU.uOpen.value=U.uOpen.value; WU.uOpen.value=U.uOpen.value;
    beamLight.intensity=U.uOpen.value*(34+Math.sin(t*3)*8);
    // 입자
    pcPts.visible=U.uOpen.value>0.02; pcMat.opacity=U.uOpen.value*0.85;
    if(pcPts.visible){ const p=pcGeo.attributes.position.array;
      for(let i=0;i<PCN;i++){ const s=_pcs[i];
        p[i*3+1]+=(14+Math.cos(t*1.5+i)*3)*s*dt;
        const rr=Math.max(0.5,(1-p[i*3+1]/ALT_BEAM)*7); const a=Math.atan2(p[i*3+2],p[i*3])+dt*1.5;
        p[i*3]=Math.cos(a)*rr; p[i*3+2]=Math.sin(a)*rr;
        if(p[i*3+1]>ALT_BEAM){ const aa=Math.random()*6.283,r0=Math.random()*7; p[i*3]=Math.cos(aa)*r0; p[i*3+1]=0; p[i*3+2]=Math.sin(aa)*r0; } }
      pcGeo.attributes.position.needsUpdate=true;
    }
    if(!active) return;
    openT+=dt;
    const _spot=(minR,maxR)=>{ let sx=gGX,sz=gGZ;   // 마법진 주변 육지 지점(뭉침 방지)
      for(let i=0;i<6;i++){ const a=Math.random()*6.283, rr=minR+Math.random()*(maxR-minR);
        const x=gGX+Math.cos(a)*rr, z=gGZ+Math.sin(a)*rr; if(isLand(x,z)!=null) return {x,z}; }
      return {x:sx,z:sz}; };
    if(theme && ctx.spawnMonster && U.uOpen.value>0.6){
      // ★게이트 보스 1회 스폰(bossKey) — boss:true → monsters.js가 스탯 승격(HP×4.5·공격×1.5·크기×1.3)
      if(!bossSpawned && theme.bossKey){ bossSpawned=true; const p=_spot(8,28);
        ctx.spawnMonster({ k:theme.bossKey, at:p, ignoreMax:true, aggro:true, boss:true, auraColor:theme.color });
        console.log('[gate] 보스 등장:', theme.ko, theme.bossKey); }
      // ★잡몹 웨이브 — 보스전용 게이트(theme.boss=드래곤)는 보스만, 그 외 등급은 pool 웨이브(배회)
      if(!theme.boss && spawned<theme.count){ spawnAcc+=dt;
        if(spawnAcc>=theme.interval){ spawnAcc=0; const k=theme.pool[(Math.random()*theme.pool.length)|0]; const p=_spot(10,36);
          ctx.spawnMonster({ k, at:p, ignoreMax:true, aggro:false, wander:true, home:{x:gGX,z:gGZ,r:40} });
          spawned++; }
      }
    }
    // ★토벌 판정 — 보스 처치 = 게이트 클리어 + 보상(골드+영혼). XP·기본영혼 드롭은 보스 def.hp(×4.5) 스케일로 자동.
    if(bossSpawned && !cleared){
      if(!bossRef) bossRef = ctx.monsters?.find(m=>m.isBoss && !m.dead) || null;
      if(bossRef && bossRef.dead){ cleared=true; const g=theme?.grade||1, R=BAL.bossGate.reward;
        ctx.inventory?.addGold?.(R.goldPerGrade*g); ctx.combat?.addSoul?.(R.soulPerGrade*g);
        const xpBonus=R.xpPerGrade*g; ctx.combat?.addXp?.(xpBonus);   // ★2026-07-13(사령관 "클리어하면 추가 경험치") 완료 보너스 XP
        toast('차원문 클리어', { accent:'gold', ms:4200, emphasis:true, speaker:(theme?.ko||'게이트')+' · 경험치 +'+xpBonus });   // ENEMY FELLED式 강조
        console.log('[gate] 토벌 완료:', theme?.ko, '등급'+g, '→ 골드+'+(R.goldPerGrade*g), '영혼+'+(R.soulPerGrade*g), 'XP+'+xpBonus);
        close();
      }
    }
  });

  // 단축키 O:게이트 N:밤 M:일반
  if(typeof window!=='undefined' && !window.__gateKeys){ window.__gateKeys=true;
    addEventListener('keydown', e=>{ if(!window.__testMode) return; const k=e.key.toLowerCase();   // ⌨️ 게이트/시간 디버그 = 테스트모드(Ctrl+Shift+K) 전용 — m이 월드맵(M)과 겹치던 것 차단
      if(k==='o'){ active?close():open(theme?Object.keys(GATE_THEMES).find(x=>GATE_THEMES[x]===theme):DEFAULT_GATE); }   // 좌표없음 → 섬 자동탐색
      else if(k==='n'){ ctx.sky?.setTime?.(0.75); if(ctx.sky&&'timeScale'in ctx.sky)ctx.sky.timeScale=0; }
      else if(k==='m'){ ctx.sky?.setTime?.(0.25); if(ctx.sky&&'timeScale'in ctx.sky)ctx.sky.timeScale=0; active=false; }
    });
  }

  // ── 🚪 [E] 차원문 진입(사령관 확정 2026-08-07 진입 ①) ──
  //   밤 개방·석판 개방 모두 같은 게이트라 이 한 곳으로 입장이 통일된다. 던전 내부는 dungeonrun이 전담.
  const ENTER_R = 6;   // 게이트 중심에서 이 거리 안이면 진입 가능(m)
  let _gPrompt = null, _gEPrev = false;
  function _ensurePrompt(){
    if(_gPrompt) return _gPrompt;
    _gPrompt = document.createElement('div');
    _gPrompt.style.cssText = 'position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:40;display:none;'
      + 'padding:9px 18px;border-radius:7px;background:rgba(12,16,24,.86);border:1px solid rgba(140,200,255,.45);'
      + "color:#dff0ff;font:600 15px Pretendard,system-ui,'Malgun Gothic';letter-spacing:.02em;pointer-events:none;"
      + 'box-shadow:0 10px 30px rgba(0,0,0,.5)';
    document.body.appendChild(_gPrompt);
    return _gPrompt;
  }
  function _nearGate(){
    if(!active || !ctx.player || !ctx.player.pos) return false;
    if(ctx.dungeon && ctx.dungeon.active) return false;
    const p = ctx.player.pos;
    return Math.hypot(p.x - gGX, p.z - gGZ) <= ENTER_R;
  }
  function enterDungeon(){
    if(!_nearGate()) return false;
    if(!ctx.dungeon || !ctx.dungeon.enter){ toast('던전 시스템을 사용할 수 없습니다', { accent:'red' }); return false; }
    // 게이트가 열린 섬을 넘긴다(없으면 좌표만 — dungeonrun이 내부에서 처리).
    const isl = (ctx.settlement && ctx.settlement.islandAt) ? ctx.settlement.islandAt(gGX, gGZ) : null;
    const ok = ctx.dungeon.enter(isl || { x:gGX, z:gGZ, tier:(theme && theme.grade) || 1 });
    if(ok && _gPrompt) _gPrompt.style.display='none';
    return ok;
  }
  addEventListener('keydown', e=>{
    if(e.code!=='KeyE' || e.repeat) return;
    if(ctx.input && ctx.input.blocks && ctx.input.blocks('KeyE')) return;   // UI/조타 중이면 양보
    if(_nearGate()) enterDungeon();
  });
  ctx.onUpdate(()=>{
    const near = _nearGate();
    if(near === _gEPrev) return; _gEPrev = near;
    const el = _ensurePrompt();
    el.textContent = `[E] ${(theme && theme.ko) || '차원문'} 진입`;
    el.style.display = near ? 'block' : 'none';
  });

  // ── 🌀 석판으로 직접 개방(사령관 확정 2026-08-07 진입 ②) ──
  //   퀵슬롯에서 석판(slab1~5)을 고르면 서 있는 자리에 그 등급 차원문이 열린다. 밤 개방과 같은 open() 경로를
  //   그대로 쓰므로 연출·몹 스폰·[E] 입장이 전부 공유된다(새 던전 로직을 또 만들지 않는다).
  function startPlace(id){
    // 🔬 진단 훅 — 석판을 썼는데 아무 일도 안 일어나면 콘솔에서 `__slabWhy`로 이유를 본다.
    //   (실측 사례: 육지 판정 실패 시 조용히 토스트만 뜨는데, 왜 실패했는지가 안 보여 원인 특정이 오래 걸렸다)
    const why = r => { try{ window.__slabWhy = r; }catch(_){} return r; };
    const m = /^slab([1-5])$/.exec(id||''); if(!m){ why('id불일치:'+id); return false; }
    if(ctx.inventory && ctx.inventory.count(id) <= 0){ why('보유0'); return false; }
    if(active){ why('이미열림'); toast('이미 차원문이 열려 있습니다', { accent:'red' }); return true; }
    if(ctx.dungeon && ctx.dungeon.active){ why('던전중'); toast('던전 안에서는 열 수 없습니다', { accent:'red' }); return true; }
    const pp = ctx.player && ctx.player.pos;
    if(!pp){ why('pos없음'); return true; }
    why('진행');
    // 발밑이 육지여야 한다(바다·던전 바닥 금지). 살짝 앞쪽에 열어 플레이어와 겹치지 않게.
    const fwd = ctx.camera ? new THREE.Vector3(0,0,-1).applyQuaternion(ctx.camera.quaternion) : new THREE.Vector3(0,0,-1);
    let gx = pp.x + fwd.x*10, gz = pp.z + fwd.z*10;
    let gy = isLand(gx, gz);
    if(gy == null){ gx = pp.x; gz = pp.z; gy = isLand(gx, gz); }
    if(gy == null){ why('육지아님 '+gx.toFixed(0)+','+gz.toFixed(0)); toast('육지에서만 차원문을 열 수 있습니다', { accent:'red' }); return true; }
    why('개방시도 '+gx.toFixed(0)+','+gz.toFixed(0)+' y'+gy.toFixed(1));
    // ⚠️테마 키는 grade1~grade4 + **boss**(grade5는 없음). 티어5는 boss로 매핑해야 등급이 맞는다.
    //   (실측으로 확인: GATE_THEMES 키 = grade1,grade2,grade3,grade4,boss. 예전엔 grade5가 undefined라
    //    DEFAULT_GATE로 조용히 폴백돼 심층 석판이 하급 차원문을 열었다.)
    const _tier = +m[1];
    const _key = (_tier >= 5) ? 'boss' : ('grade' + _tier);
    open(_key, gx, gz, gy);
    if(ctx.inventory){ ctx.inventory.remove(id, 1); if(ctx.updHotbar) ctx.updHotbar(); }
    toast(`${(GATE_THEMES[_key]||{}).ko||'차원문'} 개방 — 다가가 [E]로 진입`, { accent:'gold', ms:4200 });
    return true;
  }

  ctx.gate={ open, close, dome, beam, rune, vortex, U, themes:GATE_THEMES,
    isLand, findIslandSpot, colliderGroundY, SEA, startPlace,
    get active(){ return active; }, get theme(){ return theme; }, get _spawned(){ return spawned; }, get _openT(){ return openT; } };
  // ★실게임: init 자동 오픈 안 함 — 휴면(active=false·uOpen→0=불가시) 시작. 자정 크로싱(onUpdate)이 근처 섬에 개방. 디버그 O키(testMode)=수동 오픈.
  console.log('[gate] 초기화 — 휴면. 자정(dayTime 0.75) 근처섬 개방. 단축키 O/N/M(testMode).');
  return ctx.gate;
}
