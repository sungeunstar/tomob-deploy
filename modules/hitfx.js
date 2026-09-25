// hitfx.js — 타격 임팩트 VFX(펠월드 레퍼런스 2장 정밀 재현, 사령관 지시 2026-07-02 강화).
//   combat.damageMonster 단일 통로에서 ctx.flashHit(mn, hitPos, crit) 를 "호출당하는" 이펙트 라이브러리.
//   ⚠️ 자체 명중판정/트리거 없음 — 배선은 combat.js 단일 통로에만(G8 정합). 여기선 그리기만. combat.js 미수정.
//
//   ■ 재도입 금지(feedback_threejs_no_cheap_fx): 큰 크로매틱 충격파 링 / 화면 방사블러·색수차 포스트펄스 /
//     큰 슬래시 아크 / THREE.Points·SphereGeometry 폭죽 / radial-gradient 스프라이트 / 흰 전신 백열. 전부 커스텀 GLSL SDF quad만.
//   ■ 레퍼런스(ref/화면/타격효과.png·타격효과2.png) = 접촉점 스파크 2종 + 뜨거운 코어. 전 강도 BAL.feel.hitfx SSOT:
//     ◆ 태양버스트(sunburst, 주력) : 접촉점 중심 카메라평면 2D 방사로 촘촘한 가는 금빛 needle 다수(1 draw call).
//         각 needle = 방사각 baked → 버텍스에서 root(origin)→tip로 뻗음, 프래그 needle SDF(팁으로 뾰족),
//         흰금빛코어→금색→주황, additive, 아주 짧은 밝은 플래시(~0.13s). 레퍼1의 "태양 폭발".
//     ◆ 불티 샤드(ember, 보조)     : 굵은 금빛 샤드가 3D 바깥+위로 흩뿌려짐, 속도방향 anisotropic stretch,
//         중력 포물선, 버스트보다 길게 흩날림(~0.38s). 레퍼2의 "튀는 불티". (1 draw call, velocity-baked)
//     ◆ 코어 플래시               : SDF 별/십자 quad, 접촉점 흰금빛 뜨거운 코어, 짧게(레퍼보다 크고 밝게).
//     ◆ 히트 팝(squash)           : 몹 grp 스케일 임펄스(셰이더 아님). 미세하게.
//     ◆ 미세 warm 림 틴트(선택)   : material.onBeforeCompile fresnel×u_hit emissive 가산. 아주 옅고 짧게.
//         ★몹별 머티리얼 clone → 각 몹이 자기 u_hit uniform 보유 = 공유머티리얼 흰색고착/교차오염 근본해결.
//   ■ origin 배치 : 매 명중 미세 지터(originJitter) + 몹중심→플레이어 방향 접촉면 당김(contactPull) = "같은 위치 고착" 방지.
import * as THREE from 'three';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 타격감 수치 SSOT (BAL.feel.hitfx). 하드코딩 금지(G4).

export function initHitfx(ctx){
  const { scene, camera } = ctx;
  const H = () => BAL.feel.hitfx;   // 런타임 튜닝(슬라이더/촬영) 반영 위해 매번 조회
  const _R = new THREE.Vector3(), _U = new THREE.Vector3();   // 카메라 right/up(빌보드 기준면)
  const camBasis = ()=>({ r:new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),
                          u:new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1) });   // 스폰 즉시 카메라축(첫 프레임 degenerate 방지)
  // ★프리멀티플라이드 additive(One+One). 기본 THREE.AdditiveBlending은 src=SrcAlpha라 기여가 col·a²·glow로
  //   알파가 제곱돼 중심 외 광선이 뭉개짐(=이전 "너무 성기고 작음"의 근본원인). One+One이면 col·a·glow로 온전 발광.
  const ADD = { blending:THREE.CustomBlending, blendEquation:THREE.AddEquation, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor };
  const _quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);       // 코어 플래시용 공유 quad(중심원점, uv 0..1)
  const TWO_PI = Math.PI * 2;
  let _lastOrigin = null;   // 검수용 — 마지막 버스트 origin(지터/당김 적용 후). 같은위치 회귀검증에 사용.

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ 태양버스트(sunburst, 주력) — 접촉점 중심 카메라평면 2D 방사. 촘촘한 가는 금빛 needle 다수(버스트당 1메시).
  //    정점 attribute에 needle별 방사각/길이/폭 baked → 버텍스에서 root(origin,y=0)→tip(y=1)로 뻗음(카메라평면).
  //    프래그: 팁으로 갈수록 뾰족해지는 needle SDF + 흰금빛코어(뿌리)→금색→주황(팁) 그라디언트, additive.
  //    레퍼1처럼 원반을 거의 채우는 "태양 폭발". 시간엔 길이 거의 고정, 밝기만 빠르게 페이드(플래시).
  // ═════════════════════════════════════════════════════════════════════════
  const _BURST_VERT = `precision highp float;
    attribute vec2 aLocal;      // quad 코너: x=폭축(-0.5..0.5), y=길이축(0=root..1=tip)
    attribute float aAngle;     // needle 방사각(카메라평면 라디안)
    attribute float aLen;       // needle 길이(m)
    attribute float aWid;       // needle 폭(m)
    uniform vec3  u_origin;     // 접촉점(월드)
    uniform float u_t;          // 경과(sec)
    uniform float u_life;       // 수명(sec)
    uniform vec3  u_camR;       // 카메라 right
    uniform vec3  u_camU;       // 카메라 up
    varying float vAlong;       // 길이축(0 root..1 tip) — needle SDF/그라디언트
    varying float vAcross;      // 폭축(-0.5..0.5)
    varying float vLife;        // 잔여수명(1→0)
    void main(){
      float lf = clamp(1.0 - u_t/u_life, 0.0, 1.0);
      float ca = cos(aAngle), sa = sin(aAngle);
      vec3 dir  = u_camR*ca + u_camU*sa;      // 방사방향(카메라평면)
      vec3 perp = -u_camR*sa + u_camU*ca;     // 수직(폭)
      float len = aLen * (0.90 + 0.10*lf);    // 거의 고정(짧게 살짝 수축)
      vec3 wp = u_origin + dir*(aLocal.y*len) + perp*(aLocal.x*aWid);
      vAlong = aLocal.y; vAcross = aLocal.x; vLife = lf;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const _BURST_FRAG = `precision highp float;
    uniform vec3  u_core; uniform vec3 u_mid; uniform vec3 u_tip;
    uniform float u_glow;
    varying float vAlong; varying float vAcross; varying float vLife;
    void main(){
      // ★폭 프로파일: 뿌리 넓고 팁 얇되 0은 아님 → 광선이 끝까지 가늘게 보임(뿌리에 뭉치는 blob 방지, 레퍼처럼 긴 광선).
      float prof = 1.0 - vAlong*0.82;                // 1 뿌리 .. 0.18 팁
      float d = abs(vAcross)*2.0 / max(prof, 0.06);  // >1 = needle 밖
      float mask = smoothstep(1.0, 0.35, d);         // crisp 엣지(fuzzy blob 방지) — 날카로운 광선
      vec3 col = mix(u_core, u_mid, smoothstep(0.0, 0.22, vAlong));   // 흰금빛→금색(짧은 흰코어)
      col = mix(col, u_tip, smoothstep(0.45, 1.0, vAlong));           // →주황(팁)
      float hot = smoothstep(0.22, 0.0, vAlong);     // 뿌리(명중점) 더 뜨겁게(흰금빛 코어)
      col = mix(col, u_core, hot*0.7);
      float along = 0.72 + 0.28*(1.0 - vAlong);      // 길이방향 밝기: 팁까지 광선 밝게 유지(레퍼는 끝도 금빛)
      float a = mask * vLife * along;
      gl_FragColor = vec4(col * a * u_glow, a);
    }`;
  const _BCORN = [[-0.5,0.0],[0.5,0.0],[0.5,1.0],[-0.5,1.0]];   // root(y=0) → tip(y=1)
  // ⚡ 풀링(2026-07-03) — 기존: 매 히트 BufferGeometry+ShaderMaterial new→0.2s 뒤 dispose(그로기 난타=초당 10회+
  //   할당/해제 = GC 스파이크). 아케인 볼트 풀(_arcPool)과 동일 패턴으로 전환: 고정 슬롯 재사용(visible 토글,
  //   attribute 재기입+drawRange). 랜덤 재생성은 그대로 수행 → 시각 결과 완전 동일.
  //   풀 고갈 시 최고령 슬롯 강탈(동시 8히트+ 순간뿐). cap 부족 시 그 슬롯만 재생성(grow — BAL 슬라이더 대응).
  function _acqPooled(pool, maxN, maker){
    let s=null;
    for(const p of pool){ if(!p.active){ s=p; break; } }
    if(!s && pool.length<maxN){ s=maker(); pool.push(s); }
    if(!s){ s=pool[0]; for(const p of pool) if(p.t>s.t) s=p; }   // 최고령 강탈
    return s;
  }
  const _bursts = [];   // 풀 슬롯 {mesh, mat, geo, cap, active, t, life}
  function _mkBurstSlot(cap){
    const V=cap*4, aLocal=new Float32Array(V*2), idx=new Uint16Array(cap*6);
    for(let i=0;i<cap;i++){
      for(let c=0;c<4;c++){ const v=i*4+c; aLocal[v*2]=_BCORN[c][0]; aLocal[v*2+1]=_BCORN[c][1]; }
      const o=i*4, k=i*6; idx[k]=o; idx[k+1]=o+1; idx[k+2]=o+2; idx[k+3]=o; idx[k+4]=o+2; idx[k+5]=o+3;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V*3),3));   // 미사용(셰이더가 계산) 더미
    g.setAttribute('aLocal', new THREE.BufferAttribute(aLocal,2));
    g.setAttribute('aAngle', new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aLen',   new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aWid',   new THREE.BufferAttribute(new Float32Array(V),1));
    g.setIndex(new THREE.BufferAttribute(idx,1));
    const mat=new THREE.ShaderMaterial({
      uniforms:{ u_origin:{value:new THREE.Vector3()}, u_t:{value:0}, u_life:{value:1},
        u_camR:{value:new THREE.Vector3(1,0,0)}, u_camU:{value:new THREE.Vector3(0,1,0)},
        u_core:{value:new THREE.Color()}, u_mid:{value:new THREE.Color()}, u_tip:{value:new THREE.Color()},
        u_glow:{value:1} },
      vertexShader:_BURST_VERT, fragmentShader:_BURST_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:false });
    const mesh=new THREE.Mesh(g, mat); mesh.frustumCulled=false; mesh.renderOrder=9992; mesh.visible=false; scene.add(mesh);   // ★bloom 제거(사령관 "너무 밝음") — 임팩트는 자체 additive glow만
    return { mesh, mat, geo:g, cap, active:false, t:0, life:1 };
  }
  function spawnBurst(pos, mul, ov){ const h=H(); ov=ov||{};
    _lastOrigin = pos.clone();   // 검수용(지터/당김 이미 적용된 좌표)
    const n = Math.max(1, Math.round(h.burstCount * (mul>1 ? 1.25 : 1)));   // crit=가닥↑
    const szMul = (mul>1 ? 1.0 + (mul-1)*0.4 : 1.0) * (ov.scale||1);         // crit=길이↑(완만) + ov.scale(그로기 보라 임팩트=크게)
    let s=_acqPooled(_bursts, 8, ()=>_mkBurstSlot(n+6));
    if(n>s.cap){ scene.remove(s.mesh); s.mat.dispose(); s.geo.dispose(); const i=_bursts.indexOf(s); s=_mkBurstSlot(n+6); _bursts[i]=s; }   // cap 성장(드묾)
    const A=s.geo.getAttribute('aAngle'), L=s.geo.getAttribute('aLen'), W=s.geo.getAttribute('aWid');
    for(let i=0;i<n;i++){
      const base = (i/n)*TWO_PI;                                   // 균등 방사
      const ang  = base + (Math.random()*2-1)*(Math.PI/n)*0.9;     // 슬롯 내 지터(뭉치지 않게)
      const ln = h.burstLen * szMul * (1 + (Math.random()*2-1)*h.burstLenVar);   // 길고 짧은 광선 섞임
      const wd = h.burstWidth * (0.8 + Math.random()*0.5);
      for(let c=0;c<4;c++){ const v=i*4+c; A.array[v]=ang; L.array[v]=ln; W.array[v]=wd; }
    }
    A.needsUpdate=L.needsUpdate=W.needsUpdate=true;
    s.geo.setDrawRange(0, n*6);
    const cb=camBasis(), u=s.mat.uniforms;
    u.u_origin.value.copy(pos); u.u_t.value=0; u.u_life.value=h.burstLifeSec;
    u.u_camR.value.copy(cb.r); u.u_camU.value.copy(cb.u);
    u.u_core.value.set(ov.colCore??h.colCore); u.u_mid.value.set(ov.colMid??h.colMid); u.u_tip.value.set(ov.colTip??h.colTip);
    u.u_glow.value=(mul>1 ? h.burstGlow*1.15 : h.burstGlow)*(ov.glowMul||1);
    s.t=0; s.life=h.burstLifeSec; s.active=true; s.mesh.visible=true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ 불티 샤드(ember, 보조) — 굵은 금빛 샤드가 3D 바깥+위로 흩뿌려짐. anisotropic 스트레치 quad(속도방향 늘어남).
  //    버스트당 1메시. 정점 attribute에 샤드별 방향/속도/크기 baked → 버텍스에서 시간(u_t)만 진행(포물선+중력).
  //    프래그: needle SDF + 흰금빛코어→금색→주황, additive. 레퍼2의 "튀는 불티"(버스트보다 굵고 오래).
  // ═════════════════════════════════════════════════════════════════════════
  const _EMBER_VERT = `precision highp float;
    attribute vec2 aLocal;      // quad 코너: x=폭축(-0.5..0.5), y=길이축(-0.5..0.5)
    attribute vec3 aDir;        // 샤드 초기 방향(월드, 단위)
    attribute float aSpeed;     // 초기 속도(m/s)
    attribute float aLen;       // 샤드 길이(m)
    attribute float aWid;       // 샤드 폭(m)
    uniform vec3  u_origin;     // 접촉점(월드)
    uniform float u_t;          // 경과(sec)
    uniform float u_life;       // 수명(sec)
    uniform float u_grav;       // 중력 가속(m/s^2)
    uniform vec3  u_camR;       // 카메라 right
    uniform vec3  u_camU;       // 카메라 up
    varying float vAlong;       // 길이축(-0.5..0.5) — 코어/팁 그라디언트
    varying float vAcross;      // 폭축(-0.5..0.5)
    varying float vLife;        // 잔여수명(1→0)
    void main(){
      float t = u_t;
      vec3 vel   = aDir * aSpeed;                                        // 초기 속도벡터
      vec3 center= u_origin + vel*t + vec3(0.0, -0.5*u_grav*t*t, 0.0);   // 포물선 이동
      vec3 velNow= vel + vec3(0.0, -u_grav*t, 0.0);                      // 현재 속도(스트레치 방향)
      vec2 vs = vec2(dot(velNow, u_camR), dot(velNow, u_camU));          // 카메라평면 투영
      float vl = length(vs) + 1e-4;
      vec2 along = vs / vl;                                              // 이동방향(스크린)
      vec2 perp  = vec2(-along.y, along.x);                              // 수직(폭)
      float lf  = clamp(1.0 - t/u_life, 0.0, 1.0);
      float len = aLen * (0.45 + 0.55*lf);                              // 수명동안 짧아짐
      float wid = aWid * (0.35 + 0.65*lf);                              // 수명동안 얇아짐
      vec2 s = along*(aLocal.y*len) + perp*(aLocal.x*wid);              // 스크린 오프셋
      vec3 worldPos = center + u_camR*s.x + u_camU*s.y;                 // 빌보드 복원
      vAlong = aLocal.y; vAcross = aLocal.x; vLife = lf;
      gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }`;
  const _EMBER_FRAG = `precision highp float;
    uniform vec3  u_core; uniform vec3 u_mid; uniform vec3 u_tip;
    uniform float u_glow; uniform float u_coreBoost;
    varying float vAlong; varying float vAcross; varying float vLife;
    void main(){
      float ay = abs(vAlong)*2.0;                 // 0 뿌리 .. 1 팁
      float ax = abs(vAcross)*2.0;                // 0 중심선 .. 1 가장자리
      float taper = 1.0 - ay*ay;                  // 팁으로 갈수록 뾰족
      float d = ax / max(taper, 0.03);            // >1 = 샤드 밖
      float mask = smoothstep(1.0, 0.5, d);       // crisp 엣지
      float coreLine = smoothstep(0.5, 0.0, ax) * smoothstep(1.0, 0.1, ay);   // 뿌리쪽 밝은 중심선
      float headGlow = smoothstep(0.35, 0.0, ay); // 뿌리(명중점) 더 뜨겁게
      vec3 col = mix(u_mid, u_tip, ay*ay);        // 금색→주황(팁으로 식음)
      col = mix(col, u_core, clamp((coreLine+headGlow*0.5)*u_coreBoost, 0.0, 1.0));   // 흰금빛 코어(뿌리)
      float a = mask * vLife;
      gl_FragColor = vec4(col * a * u_glow, a);
    }`;
  const _CORN = [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]];
  const _embers = [];   // ⚡풀 슬롯 {mesh, mat, geo, cap, active, t, life} — spawnBurst와 동일 풀 패턴
  function _mkEmberSlot(cap){
    const V=cap*4, aLocal=new Float32Array(V*2), idx=new Uint16Array(cap*6);
    for(let i=0;i<cap;i++){
      for(let c=0;c<4;c++){ const v=i*4+c; aLocal[v*2]=_CORN[c][0]; aLocal[v*2+1]=_CORN[c][1]; }
      const o=i*4, k=i*6; idx[k]=o; idx[k+1]=o+1; idx[k+2]=o+2; idx[k+3]=o; idx[k+4]=o+2; idx[k+5]=o+3;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V*3),3));   // 미사용 더미
    g.setAttribute('aLocal', new THREE.BufferAttribute(aLocal,2));
    g.setAttribute('aDir',   new THREE.BufferAttribute(new Float32Array(V*3),3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aLen',   new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aWid',   new THREE.BufferAttribute(new Float32Array(V),1));
    g.setIndex(new THREE.BufferAttribute(idx,1));
    const mat=new THREE.ShaderMaterial({
      uniforms:{ u_origin:{value:new THREE.Vector3()}, u_t:{value:0}, u_life:{value:1}, u_grav:{value:9.8},
        u_camR:{value:new THREE.Vector3(1,0,0)}, u_camU:{value:new THREE.Vector3(0,1,0)},
        u_core:{value:new THREE.Color()}, u_mid:{value:new THREE.Color()}, u_tip:{value:new THREE.Color()},
        u_glow:{value:1}, u_coreBoost:{value:1} },
      vertexShader:_EMBER_VERT, fragmentShader:_EMBER_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:false });
    const mesh=new THREE.Mesh(g, mat); mesh.frustumCulled=false; mesh.renderOrder=9991; mesh.visible=false; scene.add(mesh);   // ★bloom 제거(너무 밝음)
    return { mesh, mat, geo:g, cap, active:false, t:0, life:1 };
  }
  function spawnEmbers(pos, mul, ov){ const h=H(); ov=ov||{};
    const n = Math.max(1, Math.round(h.emberCount * (mul>1 ? mul : 1)));   // crit=수↑
    const szMul = (mul>1 ? 1.0 + (mul-1)*0.5 : 1.0) * (ov.scale||1);        // crit=크기↑ + ov.scale(그로기 보라)
    let s=_acqPooled(_embers, 8, ()=>_mkEmberSlot(n+8));
    if(n>s.cap){ scene.remove(s.mesh); s.mat.dispose(); s.geo.dispose(); const i=_embers.indexOf(s); s=_mkEmberSlot(n+8); _embers[i]=s; }
    const D=s.geo.getAttribute('aDir'), SP=s.geo.getAttribute('aSpeed'), L=s.geo.getAttribute('aLen'), W=s.geo.getAttribute('aWid');
    for(let i=0;i<n;i++){
      // 방향: 구면 랜덤 → 상반구 + 상승 바이어스(접촉점서 방사, 살짝 위로)
      let vx=Math.random()*2-1, vy=Math.random()*2-1, vz=Math.random()*2-1;
      let Ln=Math.hypot(vx,vy,vz)||1; vx/=Ln; vy/=Ln; vz/=Ln;
      vy = Math.abs(vy)*h.emberSpread + 0.18;                             // 위쪽 편향
      Ln=Math.hypot(vx,vy,vz)||1; vx/=Ln; vy/=Ln; vz/=Ln;
      const sp = h.emberSpeed * (1 + (Math.random()*2-1)*h.emberSpeedVar);
      const ln = h.emberLen * szMul * (0.7 + Math.random()*0.6);
      const wd = h.emberWidth * szMul * (0.8 + Math.random()*0.4);
      for(let c=0;c<4;c++){ const v=i*4+c;
        D.array[v*3]=vx; D.array[v*3+1]=vy; D.array[v*3+2]=vz;
        SP.array[v]=sp; L.array[v]=ln; W.array[v]=wd; }
    }
    D.needsUpdate=SP.needsUpdate=L.needsUpdate=W.needsUpdate=true;
    s.geo.setDrawRange(0, n*6);
    const cb=camBasis(), u=s.mat.uniforms;
    u.u_origin.value.copy(pos); u.u_t.value=0; u.u_life.value=h.emberLifeSec; u.u_grav.value=h.emberGravity;
    u.u_camR.value.copy(cb.r); u.u_camU.value.copy(cb.u);
    u.u_core.value.set(ov.colCore??h.colCore); u.u_mid.value.set(ov.colMid??h.colMid); u.u_tip.value.set(ov.colTip??h.colTip);
    u.u_glow.value=h.emberGlow*(ov.glowMul||1); u.u_coreBoost.value=mul>1 ? h.coreBoost*1.6 : h.coreBoost;
    s.t=0; s.life=h.emberLifeSec; s.active=true; s.mesh.visible=true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ 코어 플래시 — SDF 별/십자 작은 quad(빌보드), 접촉점 흰금빛 뜨거운 코어, 짧게. additive.
  // ═════════════════════════════════════════════════════════════════════════
  const _CORE_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const _CORE_FRAG = `precision highp float; varying vec2 vUv;
    uniform vec3 u_core; uniform vec3 u_mid; uniform float u_op;
    void main(){
      vec2 p=(vUv-0.5)*2.0; float r=length(p);
      float center = smoothstep(0.45, 0.0, r);                       // 뜨거운 흰금빛 라운드 코어
      float glow   = smoothstep(1.0, 0.0, r) * 0.22;                 // 부드러운 warm 헤일로(옅게 — 광선이 주역)
      float ang=atan(p.y,p.x);
      float spikes = pow(max(0.0, cos(ang*4.0)), 14.0) * smoothstep(1.0,0.0,r) * 0.35;   // 옅은 4방향 광채(태양버스트 보강)
      float a = clamp(center + glow + spikes, 0.0, 1.0)*u_op;
      vec3 col = mix(u_mid, u_core, clamp(center*1.3 + spikes*0.4, 0.0, 1.0));            // 중심=흰금빛, 바깥=금색
      gl_FragColor = vec4(col*a*2.1, a);                                                  // 밝게(레퍼 매우 밝음). 프리멀티플라이드 additive
    }`;
  const _cores = [];   // ⚡풀 슬롯 {mesh, mat, active, t, life, size} — 지오는 _quadGeo 공유, 머티리얼만 슬롯당 1회
  function _mkCoreSlot(){
    const mat=new THREE.ShaderMaterial({
      uniforms:{ u_core:{value:new THREE.Color()}, u_mid:{value:new THREE.Color()}, u_op:{value:1} },
      vertexShader:_CORE_VERT, fragmentShader:_CORE_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:false });
    const mesh=new THREE.Mesh(_quadGeo, mat); mesh.renderOrder=9993; mesh.visible=false; scene.add(mesh);   // ★bloom 제거(너무 밝음)
    return { mesh, mat, active:false, t:0, life:1, size:1 };
  }
  function spawnCore(pos, mul, ov){ const h=H(); ov=ov||{};
    const s=_acqPooled(_cores, 8, _mkCoreSlot);
    s.mat.uniforms.u_core.value.set(ov.colCore??h.colCore); s.mat.uniforms.u_mid.value.set(ov.colMid??h.colMid); s.mat.uniforms.u_op.value=1;
    s.mesh.position.copy(pos);
    s.t=0; s.life=h.coreMs/1000; s.size=h.coreSize*(mul>1?1.35:1)*(ov.scale||1);
    s.active=true; s.mesh.visible=true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ [전면 신설 2026-07-02] 그로기 난타 전용 임팩트 — 펠월드 레퍼런스(ref/화면/타격효과.png) 정밀 재현.
  //     ★★기존 골드 스파크(spawnBurst/spawnEmbers/spawnCore)와 코드·셰이더·비주얼 전부 별개. 색변형 재활용 아님(사령관 지시).
  //     그로기 난타(ctx._mashMode)일 때만 발동. 보라색·밝고 화려·짧은 강한 플래시.
  //     구성 2요소(레퍼 그대로):
  //       ① 중앙 방사광선(radial spikes) : 접촉점 중심에서 삼각형 스파이크가 불꽃처럼 사방으로 확 뻗음.
  //           ▸ spawnBurst의 quad-per-needle과 다른 triangle-per-ray 지오메트리 → 팁이 진짜 꼭짓점 = 완벽히 뾰족한 스파이크.
  //           ▸ 뿌리(base)=넓고 흰보라 hot core, 팁=뾰족 짙은 보라. u_t로 순간 확 뻗음(ease-out) + 밝기 페이드.
  //       ② 외곽 큰 링(expanding ring)   : 카메라빌보드 quad의 annulus SDF. 작게 떴다 크게 팽창하며 얇아지고 페이드.
  //           ▸ ★"바깥 큰 동그라미" = 기존 게임 스파크에 없던 핵심 요소. 밝은 흰보라 엣지 + 선명 보라 본체.
  //     전 수치 SSOT = BAL.feel.groggy.(impactCol*/impactScale/impactGlow/ray*/ring*). 하드코딩 0(G4/G7).
  // ═════════════════════════════════════════════════════════════════════════
  //  ── ① 중앙 방사광선 셰이더(triangle-per-ray) ──
  const _GRAY_VERT = `precision highp float;
    attribute float aAlong;   // 0=base(중심,뿌리) .. 1=tip(끝)  — 길이축
    attribute float aSide;    // -1/+1 (base 두 코너) / 0 (tip)   — 폭축(삼각형)
    attribute float aAngle;   // 방사각(카메라평면 라디안)
    attribute float aLen;     // 스파이크 길이(m)
    attribute float aWid;     // base 반폭(m)
    uniform vec3  u_origin;   // 접촉점(월드)
    uniform float u_t;        // 경과(sec)
    uniform float u_life;     // 수명(sec)
    uniform vec3  u_camR;     // 카메라 right
    uniform vec3  u_camU;     // 카메라 up
    varying float vAlong; varying float vSide; varying float vLife;
    void main(){
      float lf  = clamp(1.0 - u_t/u_life, 0.0, 1.0);
      // 순간적으로 확 뻗음(수명 전반 35%에 거의 최대길이 도달, ease-out cubic) — "확 퍼지는" 불꽃 폭발감
      float grow = 1.0 - pow(1.0 - clamp(u_t/(u_life*0.35), 0.0, 1.0), 3.0);
      float len  = aLen * (0.30 + 0.70*grow);
      float ca=cos(aAngle), sa=sin(aAngle);
      vec3 dir  = u_camR*ca + u_camU*sa;      // 방사방향(카메라평면)
      vec3 perp = -u_camR*sa + u_camU*ca;     // 수직(폭)
      vec3 wp = u_origin + dir*(aAlong*len) + perp*(aSide*aWid);
      vAlong=aAlong; vSide=aSide; vLife=lf;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const _GRAY_FRAG = `precision highp float;
    uniform vec3 u_core; uniform vec3 u_mid; uniform vec3 u_tip; uniform float u_glow;
    varying float vAlong; varying float vSide; varying float vLife;
    void main(){
      // 삼각형이라 폭은 팁으로 자연 수렴 → across = |폭축| / 잔여폭(1-along). 부드러운 엣지로 crisp 스파이크.
      float across = abs(vSide) / max(1.0 - vAlong, 0.045);
      float mask   = smoothstep(1.0, 0.42, across);        // >1=스파이크 밖. 날카로운 광선.
      vec3 col = mix(u_core, u_mid, smoothstep(0.0, 0.32, vAlong));   // 흰보라 코어→보라
      col = mix(col, u_tip, smoothstep(0.5, 1.0, vAlong));            // →짙은 보라(팁)
      float hot = smoothstep(0.26, 0.0, vAlong);           // 뿌리(명중점) 흰보라로 더 뜨겁게
      col = mix(col, u_core, hot*0.85);
      float bright = mix(1.0, 0.5, vAlong);                // 팁으로 살짝 어둡게(뿌리 폭발감)
      float a = mask * vLife * bright;
      if(a < 0.003) discard;
      gl_FragColor = vec4(col * a * u_glow, a);            // 프리멀티플라이드 additive(One+One)
    }`;
  //  ── ② 외곽 큰 링 셰이더(annulus SDF quad) ──
  const _GRING_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const _GRING_FRAG = `precision highp float; varying vec2 vUv;
    uniform float u_prog;                                  // 0..1 진행
    uniform vec3  u_ringCore; uniform vec3 u_ringGlow; uniform float u_glow;
    uniform float u_rad0; uniform float u_rad1; uniform float u_thick0; uniform float u_thick1;
    void main(){
      vec2 p=(vUv-0.5)*2.0; float r=length(p);
      float ease  = 1.0 - pow(1.0 - u_prog, 2.2);          // ease-out 팽창(초반 빠르게 확 커짐)
      float rad   = mix(u_rad0, u_rad1, ease);
      float thick = mix(u_thick0, u_thick1, u_prog);       // 팽창하며 얇아짐
      float ring  = smoothstep(thick, thick*0.28, abs(r - rad));            // crisp 본체 링
      float lead  = smoothstep(thick*0.55, 0.0, abs(r - (rad+thick*0.4)));  // 바깥쪽 밝은 선행 엣지(펠월드 링 특유)
      float core  = smoothstep(0.16, 0.0, r) * (1.0 - u_prog);              // 순간 중심 코어 글로우(짧게)
      float fade  = 1.0 - u_prog*u_prog;                   // 앞부분 밝고 빠르게 소멸
      vec3 col = mix(u_ringGlow, u_ringCore, clamp(ring*0.7 + lead + core, 0.0, 1.0));   // 엣지=흰보라, 본체=보라
      float a  = clamp(ring*0.95 + lead*0.55 + core*0.9, 0.0, 1.0) * fade;
      if(a < 0.003) discard;
      gl_FragColor = vec4(col * a * u_glow, a);            // 프리멀티플라이드 additive
    }`;
  const _grays  = [];   // ⚡풀 슬롯: 중앙 방사광선 {mesh, mat, geo, cap, active, t, life}
  const _grings = [];   // ⚡풀 슬롯: 외곽 링     {mesh, mat, active, t, life, size}
  const _GRAY_TRI = [[0,1],[0,-1],[1,0]];   // [aAlong, aSide]: base+ / base- / tip (삼각형 1개=광선 1가닥)
  function _mkGraySlot(cap){
    const V=cap*3;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V*3),3));   // 미사용 더미(셰이더가 계산)
    const aAlong=new Float32Array(V), aSide=new Float32Array(V);
    for(let i=0;i<cap;i++) for(let c=0;c<3;c++){ const v=i*3+c; aAlong[v]=_GRAY_TRI[c][0]; aSide[v]=_GRAY_TRI[c][1]; }
    g.setAttribute('aAlong', new THREE.BufferAttribute(aAlong,1));
    g.setAttribute('aSide',  new THREE.BufferAttribute(aSide,1));
    g.setAttribute('aAngle', new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aLen',   new THREE.BufferAttribute(new Float32Array(V),1));
    g.setAttribute('aWid',   new THREE.BufferAttribute(new Float32Array(V),1));   // 비인덱스 삼각형(3정점=1광선)
    const mat=new THREE.ShaderMaterial({
      uniforms:{ u_origin:{value:new THREE.Vector3()}, u_t:{value:0}, u_life:{value:1},
        u_camR:{value:new THREE.Vector3(1,0,0)}, u_camU:{value:new THREE.Vector3(0,1,0)},
        u_core:{value:new THREE.Color()}, u_mid:{value:new THREE.Color()}, u_tip:{value:new THREE.Color()},
        u_glow:{value:1} },
      vertexShader:_GRAY_VERT, fragmentShader:_GRAY_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:false });
    const mesh=new THREE.Mesh(g, mat); mesh.frustumCulled=false; mesh.renderOrder=9995; mesh.visible=false; scene.add(mesh);
    return { mesh, mat, geo:g, cap, active:false, t:0, life:1 };
  }
  function _mkGringSlot(){
    const rmat=new THREE.ShaderMaterial({
      uniforms:{ u_prog:{value:0},
        u_ringCore:{value:new THREE.Color()}, u_ringGlow:{value:new THREE.Color()},
        u_glow:{value:1}, u_rad0:{value:0.16}, u_rad1:{value:0.94}, u_thick0:{value:0.15}, u_thick1:{value:0.03} },
      vertexShader:_GRING_VERT, fragmentShader:_GRING_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:false });
    const rmesh=new THREE.Mesh(_quadGeo, rmat); rmesh.renderOrder=9996; rmesh.visible=false; scene.add(rmesh);
    return { mesh:rmesh, mat:rmat, active:false, t:0, life:1, size:1 };
  }
  function groggyImpact(pos, mul, ov){ const G=BAL.feel.groggy; mul=mul||1; ov=ov||{};   // ov=색/발광 override(헌터 물리 임팩트 재활용용). 기본=보라(근접).
    _lastOrigin = pos.clone();   // 검수용
    const scl   = (G.impactScale||1) * (mul>1 ? 1.15 : 1.0);   // crit(난타=크리급)=조금 더 크게
    const glowM = (G.impactGlow||1);
    // ── ① 중앙 방사광선(triangle spikes) — 풀 재사용(난타=초당 10회+ 지오 할당이던 핵심 지점) ──
    const n = Math.max(3, Math.round((G.rayCount||24) * (mul>1 ? 1.2 : 1) * (0.75+Math.random()*0.5)));   // ★가닥수 매 타격 ±25%(모양 변주)
    const rot0 = Math.random()*TWO_PI;   // ★매 타격 전체 랜덤 회전 — 같은 그림 복붙 방지(사령관 "모양 너무 일정")
    let s=_acqPooled(_grays, 8, ()=>_mkGraySlot(n+10));
    if(n>s.cap){ scene.remove(s.mesh); s.mat.dispose(); s.geo.dispose(); const i=_grays.indexOf(s); s=_mkGraySlot(n+10); _grays[i]=s; }
    const A=s.geo.getAttribute('aAngle'), L=s.geo.getAttribute('aLen'), W=s.geo.getAttribute('aWid');
    for(let i=0;i<n;i++){
      const base = rot0 + (i/n)*TWO_PI;                            // ★랜덤 회전 적용
      const ang  = base + (Math.random()*2-1)*(Math.PI/n)*1.3;     // 슬롯 내 지터 강화(더 불규칙한 불꽃)
      const ln   = (G.rayLen||1.7)*scl * (1 + (Math.random()*2-1)*(G.rayLenVar||0.5));
      const wd   = (G.rayWidth||0.13)*scl * (0.55 + Math.random()*0.9);   // 폭 편차↑(굵고 가는 선 섞임)
      for(let c=0;c<3;c++){ const v=i*3+c; A.array[v]=ang; L.array[v]=ln; W.array[v]=wd; }
    }
    A.needsUpdate=L.needsUpdate=W.needsUpdate=true;
    s.geo.setDrawRange(0, n*3);
    const cb=camBasis(); const rlife=G.rayLifeSec||0.17; const u=s.mat.uniforms;
    u.u_origin.value.copy(pos); u.u_t.value=0; u.u_life.value=rlife;
    u.u_camR.value.copy(cb.r); u.u_camU.value.copy(cb.u);
    u.u_core.value.set(ov.core ?? G.impactColCore); u.u_mid.value.set(ov.mid ?? G.impactColMid); u.u_tip.value.set(ov.tip ?? G.impactColTip);
    u.u_glow.value=(G.rayGlow||3.2)*glowM*(ov.glowMul??1);
    if(ov.bloom) s.mesh.layers.enable(1); else s.mesh.layers.disable(1);
    s.t=0; s.life=rlife; s.active=true; s.mesh.visible=true;
    // ── ② 외곽 큰 링 (풀) ──
    const r=_acqPooled(_grings, 8, _mkGringSlot); const ru=r.mat.uniforms;
    ru.u_prog.value=0;
    ru.u_ringCore.value.set(ov.ringCore ?? G.ringColCore); ru.u_ringGlow.value.set(ov.ringGlow ?? G.ringColGlow);
    ru.u_glow.value=(G.ringGlow||2.6)*glowM*(ov.glowMul??1);
    ru.u_rad0.value=G.ringRad0??0.16; ru.u_rad1.value=G.ringRad1??0.94;
    ru.u_thick0.value=G.ringThick0??0.15; ru.u_thick1.value=G.ringThick1??0.03;
    r.mesh.position.copy(pos);
    if(ov.bloom) r.mesh.layers.enable(1); else r.mesh.layers.disable(1);
    r.t=0; r.life=G.ringLifeSec||0.32; r.size=(G.ringSize||2.8)*scl*(0.82+Math.random()*0.36);   // ★링 크기 매 타격 변주(±18%)
    r.active=true; r.mesh.visible=true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ [룬마스터 전용 신설 2026-07-02] 아케인 처형 VFX — 마법사(staff)가 그로기 몹 E연타 시.
  //     ★타클래스 처형(보라 groggyImpact)과 코드·셰이더·색 완전 별개. 재활용 아님(사령관 지시).
  //     레퍼런스: ref/마법느낌.jpg(파란-시안 볼트) + ref/마법진.webp(룬 마법진, 파랑-시안 틴트).
  //     ① arcaneStrike(pos,mul) : 접촉점에 파란 아케인 볼트 — 흰-시안 hot 코어 + curl/fbm 휘감는 플라스마 오라 +
  //         날카로운 선단 + 꼬리 스트릭. additive. ★볼트 풀링(BAL arcane.boltPool 상한, 재사용=draw call 고정).
  //     ② arcaneCircleEnsure(mn) : 몹 발밑 룬 마법진 — 단일 quad 1개(연타 중 유지·수명갱신, 재생성 X).
  //         텍스처 휘도기반 파랑-시안 틴트 + 중앙 화염기둥 마스크(룬링만) + 천천히 회전 + 발광 + 페이드.
  //     전 수치 SSOT = BAL.feel.groggy.arcane.*. 하드코딩 0(G4/G7).
  // ═════════════════════════════════════════════════════════════════════════
  //  ── ① 아케인 볼트 셰이더(camera-빌보드 elongated quad, uv=길이/폭축) ──
  const _ARC_BOLT_VERT = `precision highp float;
    uniform vec3 u_origin; uniform float u_angle; uniform float u_len; uniform float u_wid;
    uniform vec3 u_camR; uniform vec3 u_camU;
    varying float vAlong; varying float vAcross;
    void main(){
      float along = uv.x;          // 0=꼬리 .. 1=선단(접촉점)
      float across = uv.y - 0.5;   // -0.5..0.5 (폭축)
      vAlong = along; vAcross = across;
      float ca = cos(u_angle), sa = sin(u_angle);
      vec3 dir  = u_camR*ca + u_camU*sa;      // 입사방향(카메라평면)
      vec3 perp = -u_camR*sa + u_camU*ca;     // 수직(폭)
      vec3 wp = u_origin + dir*((along-1.0)*u_len) + perp*(across*u_wid);   // 선단(along=1)=접촉점, 꼬리 뒤로
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const _ARC_BOLT_FRAG = `precision highp float;
    uniform float u_t; uniform float u_life; uniform float u_seed; uniform float u_noise;
    uniform vec3 u_core; uniform vec3 u_mid; uniform vec3 u_edge; uniform float u_glow;
    varying float vAlong; varying float vAcross;
    // ── value noise + fbm(커스텀 GLSL, THREE.Points 아님) — 휘감는 플라스마 tendril ──
    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }
    float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+7.1; a*=0.5; } return s; }
    void main(){
      float lf = clamp(1.0 - u_t/u_life, 0.0, 1.0);
      float ax = abs(vAcross)*2.0;                        // 0 중심선 .. 1 엣지
      float shape = sin(clamp(vAlong,0.0,1.0)*3.14159);   // 0 양끝 .. 1 몸통(렌즈형)
      float halfW = 0.12 + 0.86*pow(shape,0.7);           // 선단·꼬리 좁고 몸통 넓음
      float d = ax / max(halfW, 0.05);                    // >1 = 볼트 envelope 밖
      // 휘감는 플라스마(넘실대는 에너지): fbm으로 엣지 넘실 + tendril, u_t로 흐름
      vec2 np = vec2(vAlong*4.5 - u_t*6.0 + u_seed*13.0, vAcross*6.0 + u_t*2.0 + u_seed*4.0);
      float n = fbm(np);
      float plasma = smoothstep(1.25, 0.30, d + (n-0.5)*u_noise*1.8);
      float body   = smoothstep(1.0, 0.42, d);
      float mask   = max(body, plasma*0.85);
      float coreLine = smoothstep(0.30, 0.0, d);                                  // 흰-시안 hot 코어 라인
      float head = smoothstep(0.80, 1.0, vAlong) * smoothstep(0.6, 0.0, ax);      // 날카로운 밝은 선단
      float tail = smoothstep(0.0, 0.28, vAlong);                                 // 꼬리 스트릭 페이드
      vec3 col = mix(u_edge, u_mid, smoothstep(1.1, 0.4, d));                     // 파랑 엣지 → 시안 본체
      col = mix(col, u_core, clamp(coreLine + head, 0.0, 1.0));                   // → 흰-시안 hot 코어/선단
      float a = clamp((mask*tail + head*0.8) * lf, 0.0, 1.0);
      if(a < 0.004) discard;
      gl_FragColor = vec4(col * a * u_glow, a);   // 프리멀티플라이드 additive(One+One)
    }`;
  //  ── ② 룬 마법진 셰이더(휘도기반 틴트 + 중앙 화염기둥 마스크) ──
  const _ARC_RING_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const _ARC_RING_FRAG = `precision highp float; varying vec2 vUv;
    uniform sampler2D u_map; uniform vec3 u_tint; uniform float u_op; uniform float u_glow;
    uniform float u_inner; uniform float u_feather;
    void main(){
      vec4 t = texture2D(u_map, vUv);
      float lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));         // 휘도(원본 주황 무시 → 룬 패턴만 추출)
      float r = length(vUv-0.5)*2.0;                             // 0 중심 .. 1 엣지
      float centerMask = smoothstep(u_inner, u_inner+u_feather, r);   // 중앙 화염기둥 죽임(룬링만)
      float edgeMask   = smoothstep(1.0, 0.86, r);                    // 원 밖 페이드
      float a = lum * centerMask * edgeMask * u_op;
      if(a < 0.003) discard;
      vec3 col = u_tint * lum;                                   // 파랑-시안 틴트
      gl_FragColor = vec4(col * u_glow * u_op, a);               // 프리멀티플라이드 additive
    }`;
  //  ── 아케인 볼트 풀(재사용 — draw call 고정) ──
  const _ARC = () => BAL.feel.groggy.arcane;
  const _arcPool = [];   // {mesh, mat, active, t, life}
  (function initArcPool(){ const A=_ARC(); const N=Math.max(2, (A&&A.boltPool)|0 || 12);
    for(let i=0;i<N;i++){
      const mat=new THREE.ShaderMaterial({
        uniforms:{ u_origin:{value:new THREE.Vector3()}, u_angle:{value:0}, u_len:{value:1}, u_wid:{value:1},
          u_camR:{value:new THREE.Vector3(1,0,0)}, u_camU:{value:new THREE.Vector3(0,1,0)},
          u_t:{value:0}, u_life:{value:1}, u_seed:{value:0}, u_noise:{value:0.9},
          u_core:{value:new THREE.Color()}, u_mid:{value:new THREE.Color()}, u_edge:{value:new THREE.Color()}, u_glow:{value:2.4} },
        vertexShader:_ARC_BOLT_VERT, fragmentShader:_ARC_BOLT_FRAG,
        transparent:true, ...ADD, depthWrite:false, depthTest:false });
      const mesh=new THREE.Mesh(_quadGeo, mat); mesh.frustumCulled=false; mesh.renderOrder=9988;
      mesh.visible=false; mesh.layers.enable(1); scene.add(mesh);   // ★layer1=magic bloom(마법은 밝아도 OK)
      _arcPool.push({ mesh, mat, active:false, t:0, life:1 });
    }
  })();
  // 볼트 1개 발사(풀 슬롯 재사용) — arcaneStrike/arcaneImpact 공용. 동일 플라스마 셰이더.
  function _fireBolt(pos, ang, len, wid, life, glow){ const A=_ARC();
    let slot = _arcPool.find(s=>!s.active);
    if(!slot) slot = _arcPool.reduce((a,c)=> (a.t/a.life)>=(c.t/c.life) ? a : c);   // 여유 없으면 가장 오래된 것 재활용(캡 유지)
    const u=slot.mat.uniforms; const cb=camBasis();
    u.u_origin.value.copy(pos); u.u_angle.value=ang; u.u_len.value=len; u.u_wid.value=wid;
    u.u_camR.value.copy(cb.r); u.u_camU.value.copy(cb.u);
    u.u_t.value=0; u.u_life.value=life; u.u_seed.value=Math.random(); u.u_noise.value=A.boltNoise??0.9;
    u.u_core.value.set(A.boltCore); u.u_mid.value.set(A.boltMid); u.u_edge.value.set(A.boltEdge);
    u.u_glow.value=glow;
    slot.active=true; slot.t=0; slot.life=life; slot.mesh.visible=true;
  }
  function arcaneStrike(pos, mul){ const A=_ARC(); mul=mul||1;
    _lastOrigin = pos.clone();   // 검수용
    const szMul = (mul>1 ? 1.0 + (mul-1)*0.35 : 1.0);
    const spread = (A.boltSpreadDeg||24)*Math.PI/180;
    const nb = Math.max(1, (A.boltPerHit|0)||1);
    const life = (A.boltLifeSec||0.22) * (mul>1 ? 1.1 : 1.0);
    for(let b=0;b<nb;b++){
      const ang  = (Math.random()<0.5 ? 0.0 : Math.PI) + (Math.random()*2-1)*spread;  // 대체로 수평(좌/우 입사) + 변주
      const len  = (A.boltLen||2.6) * szMul * (0.85 + Math.random()*0.35);
      const wid  = (A.boltWidth||0.95) * szMul * (0.85 + Math.random()*0.3);
      _fireBolt(pos, ang, len, wid, life, (A.boltGlow||2.4)*(mul>1?1.15:1.0));
    }
  }
  //  ── 룬 마법진(단일 인스턴스 — 재생성 X, 수명갱신) ──
  const _arcTL = new THREE.TextureLoader();
  let _arcTex=null;
  function arcTex(){ if(_arcTex) return _arcTex;
    _arcTex=_arcTL.load(encodeURI('/tomob-deploy/ref/마법진.webp'));   // dev서버가 voyage 서빙
    _arcTex.colorSpace=THREE.SRGBColorSpace; return _arcTex; }
  let _arcMesh=null, _arcMat=null, _arcState=null;   // _arcState={mn, op, spin, holdUntil}
  const _arcHit=new THREE.Vector3();   // ★원거리 아케인 볼트 원점(몹 중심) 스크래치 — contactPull 당김 배제용
  const _arcTo=new THREE.Vector3();    // ★헌터 에너지 애로우 타겟(몹) 스크래치
  const _beamDir=new THREE.Vector3();  // ★에너지 애로우 빔 방향(발사 곡선을 빔에 수직으로 세우기)
  function ensureArcMesh(){ if(_arcMesh) return; const A=_ARC();
    _arcMat=new THREE.ShaderMaterial({
      uniforms:{ u_map:{value:arcTex()}, u_tint:{value:new THREE.Color(A.circleTint||0x35ccff)},
        u_op:{value:0}, u_glow:{value:A.circleGlow||1.4},
        u_inner:{value:A.circleInner??0.19}, u_feather:{value:A.circleInnerFeather??0.14} },
      vertexShader:_ARC_RING_VERT, fragmentShader:_ARC_RING_FRAG,
      transparent:true, ...ADD, depthWrite:false, depthTest:true, side:THREE.DoubleSide });
    _arcMesh=new THREE.Mesh(_quadGeo, _arcMat); _arcMesh.rotation.x=-Math.PI/2;   // 수평(바닥)
    _arcMesh.renderOrder=9987; _arcMesh.frustumCulled=false; _arcMesh.visible=false; _arcMesh.layers.enable(1); scene.add(_arcMesh);
  }
  function arcaneCircleEnsure(mn){ if(!mn||!mn.grp) return; const A=_ARC(); ensureArcMesh();
    const now=performance.now();
    // ★한번 발동되고 그 대상 발밑에 고정(사령관 2026-07-02). 홀드 중엔 다른 몹으로 재타겟/재발동 안 함 — 마법진이 몹 사이 점프 방지.
    //   홀드 만료(update에서 _arcState=null) 후 새 처형이면 아래 조건이 새로 발동.
    if(!_arcState){ _arcState={ mn, op:0, spin:Math.random()*TWO_PI, holdUntil:0 }; _arcMesh.visible=true; }
    _arcState.holdUntil = now + (A.circleHoldMs||700);  // ★수명 갱신(재생성/재타겟 X)
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ [신설 2026-07-02] arcaneImpact — 몹에게 꽂히는 "맞는이펙트"(레퍼런스 ref/맞는이펙트.jpg)
  //     구성: ① 중앙서 사방 방사되는 청백 전기 스파이크(bolt 플라스마 셰이더 재활용)
  //           ② 밝은 청백 코어 플래시(spawnCore)
  //           ③ 몹 지면 파란 룬 임팩트 서클(단발·확 떴다 사라짐 — 시전자 발밑 캐스팅서클과 별개)
  //           ④ 몹을 감싸는 흰 크레센트 아크 2개(회전하며 페이드)
  //     E 1타마다 몹 위치에 발생. 전부 커스텀 GLSL + additive + bloom 레이어(1). 풀 재사용(draw call 캡).
  // ═════════════════════════════════════════════════════════════════════════
  //  ── ④ 흰 감싸는 아크 셰이더(카메라 빌보드 + in-shader roll로 크레센트 배치) ──
  const _AIMP_ARC_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const _AIMP_ARC_FRAG = `precision highp float; varying vec2 vUv;
    uniform float u_t,u_life,u_r0,u_thick,u_span,u_roll,u_glow; uniform vec3 u_col;
    void main(){
      float lf=clamp(1.0-u_t/u_life,0.0,1.0);
      vec2 p=(vUv-0.5)*2.0; float r=length(p);
      float ang=atan(p.y,p.x)-u_roll; ang=mod(ang+3.14159265,6.2831853)-3.14159265;   // -pi..pi(회전 적용)
      float grow=0.85+0.30*(u_t/max(u_life,0.001));                 // 살짝 팽창(감싸며 벌어짐)
      float band=smoothstep(u_thick,0.0,abs(r-u_r0*grow));          // 반경밴드=호 두께
      float aa=abs(ang);
      float within=smoothstep(u_span, u_span*0.65, aa);             // 각폭 내 + 끝 테이퍼(브러시)
      float head=smoothstep(u_span, 0.0, aa);                       // 앞쪽 진하게(브러시 머리)
      float a=band*within*lf*(0.45+0.55*head);
      if(a<0.004) discard;
      gl_FragColor=vec4(u_col*a*u_glow, a);   // 프리멀티플라이드 additive(One+One)
    }`;
  const _arcArcPool=[];   // {mesh,mat,active,t,life,roll,spin}
  (function initArcArcPool(){ const N=6;
    for(let i=0;i<N;i++){
      const mat=new THREE.ShaderMaterial({
        uniforms:{ u_t:{value:0},u_life:{value:1},u_r0:{value:0.72},u_thick:{value:0.11},
          u_span:{value:1.1},u_roll:{value:0},u_glow:{value:2.2},u_col:{value:new THREE.Color(0xffffff)} },
        vertexShader:_AIMP_ARC_VERT, fragmentShader:_AIMP_ARC_FRAG,
        transparent:true, ...ADD, depthWrite:false, depthTest:false, side:THREE.DoubleSide });
      const mesh=new THREE.Mesh(_quadGeo, mat); mesh.frustumCulled=false; mesh.renderOrder=9989;
      mesh.visible=false; mesh.layers.enable(1); scene.add(mesh);
      _arcArcPool.push({ mesh, mat, active:false, t:0, life:1, spin:0 });
    }
  })();
  function _spawnArcArc(pos, roll, mul, ov){ const A=_ARC(); ov=ov||{};   // ov=오버라이드(헌터 발사 조리개 링=full ring 등)
    let s=_arcArcPool.find(p=>!p.active); if(!s) s=_arcArcPool.reduce((a,c)=>(a.t/a.life)>=(c.t/c.life)?a:c);
    s.mesh.position.copy(pos); s.mesh.scale.setScalar((ov.size??(A.impArcSize||2.8))*(mul>1?1.1:1));
    const u=s.mat.uniforms;
    u.u_r0.value=ov.r0??(A.impArcRadius||0.72); u.u_thick.value=ov.thick??(A.impArcThick||0.11);
    u.u_span.value=(ov.span!=null?ov.span:(A.impArcSpanDeg||130)*Math.PI/360);   // half-span(rad). π=full ring
    u.u_col.value.set(ov.col??(A.impArcColor||0xffffff)); u.u_glow.value=ov.glow??(A.impArcGlow||2.2);
    u.u_roll.value=roll; u.u_life.value=(ov.life??(A.impArcLifeSec||0.28)); u.u_t.value=0;
    s.active=true; s.t=0; s.life=u.u_life.value; s.roll=roll;
    s.spin=(ov.spin??(A.impArcSpin||6.0))*(Math.random()<0.5?1:-1); s.mesh.visible=true;
    // ★faceDir 지정 시: 카메라 빌보드 대신 그 방향에 수직으로 세움(헌터 발사 곡선=빔 관통 "돌파" 포털). 없으면 빌보드(임팩트 아크).
    if(ov.faceDir){ if(!s.faceDir) s.faceDir=ov.faceDir.clone(); else s.faceDir.copy(ov.faceDir); } else s.faceDir=null;
  }
  //  ── ③ 몹 지면 임팩트 룬서클 풀(단발, ring 셰이더+마법진 재활용) ──
  const _arcImpPool=[];
  (function initArcImpPool(){ const N=6;
    for(let i=0;i<N;i++){
      const mat=new THREE.ShaderMaterial({
        uniforms:{ u_map:{value:arcTex()}, u_tint:{value:new THREE.Color(0x35ccff)},
          u_op:{value:0}, u_glow:{value:1.6}, u_inner:{value:0.19}, u_feather:{value:0.14} },
        vertexShader:_ARC_RING_VERT, fragmentShader:_ARC_RING_FRAG,
        transparent:true, ...ADD, depthWrite:false, depthTest:true, side:THREE.DoubleSide });
      const mesh=new THREE.Mesh(_quadGeo, mat); mesh.rotation.x=-Math.PI/2;
      mesh.renderOrder=9986; mesh.frustumCulled=false; mesh.visible=false; mesh.layers.enable(1); scene.add(mesh);
      _arcImpPool.push({ mesh, mat, active:false, t:0, life:1, spin:0 });
    }
  })();
  function _spawnImpCircle(mn, mul){ if(!mn||!mn.grp) return; const A=_ARC();
    let s=_arcImpPool.find(p=>!p.active); if(!s) s=_arcImpPool.reduce((a,c)=>(a.t/a.life)>=(c.t/c.life)?a:c);
    const gx=mn.grp.position.x, gz=mn.grp.position.z; let gy=mn.grp.position.y;
    if(ctx.terrain?.groundAt){ const g=ctx.terrain.groundAt(gx,gz,600); if(g>-100) gy=g; }
    const sc=(mn.def?.scale||1.7);
    s.mesh.position.set(gx, gy+0.05, gz); s.mesh.scale.setScalar((A.impCircleSize||2.3)*sc);
    s.mesh.rotation.z=Math.random()*TWO_PI;
    const u=s.mat.uniforms; u.u_tint.value.set(A.circleTint||0x35ccff);
    u.u_inner.value=A.circleInner??0.19; u.u_feather.value=A.circleInnerFeather??0.14; u.u_op.value=0;
    s.active=true; s.t=0; s.life=(A.impCircleLifeSec||0.42); s.mesh.visible=true;
    s.spin=(Math.random()<0.5?1:-1)*0.8;
  }
  function arcaneImpact(pos, mul, mn){ const A=_ARC(); mul=mul||1;
    _lastOrigin = pos.clone();
    // ① 사방 방사 전기 스파이크(bolt 플라스마 재활용)
    const nS=Math.max(1,(A.impSpikeCount|0)||7); const base=Math.random()*TWO_PI;
    for(let i=0;i<nS;i++){
      const ang=base + i/nS*TWO_PI + (Math.random()*2-1)*0.28;
      const len=(A.impSpikeLen||1.6)*(0.8+Math.random()*0.5)*(mul>1?1.15:1);
      const wid=(A.impSpikeWidth||0.62)*(0.8+Math.random()*0.4);
      _fireBolt(pos, ang, len, wid, (A.impSpikeLifeSec||0.24), (A.impSpikeGlow||1.4));
    }
    // ② 중앙 코어 플래시
    spawnCore(pos, mul, { colCore:A.impCoreColHot??0xf2ffff, colMid:A.impCoreColMid??0x36ccff, scale:(A.impCoreScale||1.25) });
    // ③ 몹 지면 룬 임팩트 서클
    _spawnImpCircle(mn, mul);
    // ④ 감싸는 흰 아크(좌/우)
    const nA=Math.max(1,(A.impArcCount|0)||2);
    for(let i=0;i<nA;i++) _spawnArcArc(pos, i/nA*TWO_PI + (Math.random()*2-1)*0.3, mul);
  }

  // ── [헌터 전용 신설 2026-07-02] 화살 박힘 임팩트 — groggyImpact 구조(사방광선+외곽링) 물리색 재활용 =
  //    "다른 클래스만큼" 무게(사령관). 마법 아님 → bloom 레이어 미사용(=건조·물리적), 흰/탄 색. combat.execArrowVolley가 화살 도착 시 호출.
  function arrowEmbedImpact(pos, mul){ const R=(BAL.feel.groggy.arrow)||{}; mul=mul||1;
    // ★다른 클래스만큼 화려하게(사령관): 사방광선+링에 bloom ON + 밝기↑ → 룬마스터급 광채. 물리색(흰-골드)이라 마법과 구분.
    groggyImpact(pos, mul, { core:R.impCore??0xfff4e0, mid:R.impMid??0xffd9a0, tip:R.impTip??0xffffff,
      ringCore:R.impRingCore??0xfff0d8, ringGlow:R.impRingGlow??0xffcf8a, glowMul:(R.impGlowMul??1.5), bloom:true });
    spawnCore(pos, mul, { colCore:R.coreCol??0xfff6ea, colMid:R.impMid??0xffd9a0, scale:(R.coreScale??1.2) });
    // kinetic 파편(불티) — 화살 꽂히며 사방으로 튀는 흰-골드 샤드. 활 임팩트 강타감.
    spawnEmbers(pos, mul, { colCore:R.impTip??0xffffff, colMid:R.impMid??0xffd9a0, colTip:R.impCore??0xfff4e0, scale:(R.emberScale??1.15) });
  }

  // ── [헌터 재제작 2026-07-02 · 레퍼런스 ref/활.webp] 에너지 애로우 — 물리 나무화살 폐기.
  //    파란-흰 집중 에너지 빔이 활(가슴)에서 몹으로 뻗음 + 발사지점 조리개 링 2겹 + 섬광 + 몹 임팩트 섬광/스파클.
  //    빔=아케인 플라스마 셰이더 재활용(카메라평면 각/길이 계산으로 from→to 연결). 조리개=흰아크풀 full-ring. 전부 bloom.
  //    룬마스터(영역 폭발+지면 마법진)와 구분되는 "저격 빔" 정체성. SSOT=BAL.feel.groggy.arrow.beam*/launch*.
  function energyArrow(from, to, mul){ const R=(BAL.feel.groggy.arrow)||{}; mul=mul||1;
    _lastOrigin = to.clone();
    const cb=camBasis();
    const dvx=to.x-from.x, dvy=to.y-from.y, dvz=to.z-from.z;
    const cx=dvx*cb.r.x+dvy*cb.r.y+dvz*cb.r.z, cy=dvx*cb.u.x+dvy*cb.u.y+dvz*cb.u.z;   // 카메라 평면 투영
    const ang=Math.atan2(cy,cx); const len=Math.max(1.5, Math.hypot(cx,cy));           // 화면상 from→to 방향/길이
    // ① 에너지 빔(from→to) — 아케인 플라스마(파란-흰) 재활용, bloom. tip=몹(to).
    _fireBolt(to, ang, len, (R.beamWid||0.5), (R.beamLifeSec||0.18), (R.beamGlow||2.4));
    // ② 발사 = 활(bow) 곡선 2개(위·아래 크레센트가 좌우 끝에서 만나 뾰족한 렌즈), 빔에 수직으로 세워 빔이 가운데를 돌파(관통).
    const _rs=(R.launchRingSize||2.3), _rl=(R.launchRingLifeSec||0.24), _sp=(R.launchArcSpan??1.25);
    _beamDir.set(to.x-from.x, to.y-from.y, to.z-from.z); if(_beamDir.lengthSq()>1e-6) _beamDir.normalize();
    _spawnArcArc(from,  Math.PI/2, mul, { span:_sp, r0:(R.launchArcR0??0.66), thick:(R.launchArcThick??0.06), size:_rs, life:_rl, col:R.beamMid??0x8fdcff, glow:2.2, spin:0.7, faceDir:_beamDir });
    _spawnArcArc(from, -Math.PI/2, mul, { span:_sp, r0:(R.launchArcR0??0.66), thick:(R.launchArcThick??0.06), size:_rs, life:_rl, col:0xffffff,          glow:2.4, spin:-0.7, faceDir:_beamDir });
    spawnCore(from, mul, { colCore:0xffffff, colMid:R.beamMid??0x8fdcff, scale:(R.launchFlashScale||1.1) });
    // ③ 몹 임팩트 — 섬광 + 파란-흰 스파클 파편
    spawnCore(to, mul, { colCore:0xffffff, colMid:R.beamMid??0x8fdcff, scale:(R.impFlashScale||1.0) });
    spawnEmbers(to, mul, { colCore:0xffffff, colMid:R.beamMid??0x8fdcff, colTip:R.beamEdge??0x2f7bff, scale:(R.emberScale??1.15) });
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ [재제작 2026-07-02] 검격 리본 트레일(blade ribbon) — ★크레센트/SDF quad 완전 폐기.
  //     휘두르는 칼날이 실제로 쓸고 지난 궤적을 3D 리본 메시로 그린다(Genshin/펠월드식 소드 트레일).
  //     player.js onUpdate가 3인칭 무기 본(slotR)에 붙은 칼날의 tip(칼끝)/hilt(밑동) 월드좌표를 스윙 중 매 프레임
  //     bladeSample()로 push → 여기서 연속 (hilt,tip) 엣지를 삼각스트립 quad로 이어 리본 생성.
  //     오래된 구간일수록 alpha↓(꼬리 페이드), 스윙 끝나면 fadeMs 내 소멸. 새 스윙은 bladeTrailBegin()으로 궤적 분리.
  //     ★골드 임팩트 스파크와 별개·다른 쿨톤(시안화이트). additive + bloom 레이어(1). 수치 SSOT=BAL.feel.slash.
  //     리본 지오메트리는 매 프레임 갱신(단일 BufferGeometry, setAttribute + index drawRange).
  // ═════════════════════════════════════════════════════════════════════════
  const RIB_MAX = 48;   // 리본 정점 버퍼 상한(샘플 수). 실사용 = min(BAL.feel.slash.samples, RIB_MAX)
  const _RIBBON_VERT = `precision highp float;
    attribute float aEdge;   // 0=hilt(밑동) .. 1=tip(칼끝) — 폭축
    attribute float aAge;    // 0=최신 머리 .. 1=오래된 꼬리 — 길이축(꼬리 페이드)
    varying float vEdge; varying float vAge;
    void main(){ vEdge=aEdge; vAge=aAge;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
  const _RIBBON_FRAG = `precision highp float;
    uniform vec3 u_col; uniform vec3 u_edge; uniform float u_glow; uniform float u_op;
    varying float vEdge; varying float vAge;
    void main(){
      float tail = clamp(1.0 - vAge, 0.0, 1.0);      // 꼬리로 갈수록 소멸
      tail = tail*tail;                               // 급격한 꼬리 페이드(잔상 깔끔)
      float tip  = smoothstep(0.30, 1.0, vEdge);      // 칼끝쪽 밝은 흰 코어(진행 날)
      float root = smoothstep(0.12, 0.0, vEdge);      // 밑동 살짝 페이드(손에서 뜬 리본 방지)
      vec3 col = mix(u_col, u_edge, tip);             // 시안 본체 → 흰 칼끝
      float a = tail * u_op * (0.45 + 0.55*tip) * (1.0 - root*0.5);
      if(a < 0.004) discard;
      gl_FragColor = vec4(col * a * u_glow, a);       // 프리멀티플라이드 additive(One+One)
    }`;
  const _ribGeo  = new THREE.BufferGeometry();
  const _ribPos  = new Float32Array(RIB_MAX*2*3);
  const _ribEdge = new Float32Array(RIB_MAX*2);
  const _ribAge  = new Float32Array(RIB_MAX*2);
  for(let i=0;i<RIB_MAX;i++){ _ribEdge[i*2]=0.0; _ribEdge[i*2+1]=1.0; }   // 짝수 정점=hilt(0), 홀수=tip(1) — 고정
  _ribGeo.setAttribute('position', new THREE.BufferAttribute(_ribPos,3));
  _ribGeo.setAttribute('aEdge',    new THREE.BufferAttribute(_ribEdge,1));
  _ribGeo.setAttribute('aAge',     new THREE.BufferAttribute(_ribAge,1));
  _ribGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(RIB_MAX*6),1));
  _ribGeo.setDrawRange(0,0);
  const _ribMat = new THREE.ShaderMaterial({
    uniforms:{ u_col:{value:new THREE.Color(BAL.feel.slash.color)}, u_edge:{value:new THREE.Color(BAL.feel.slash.edgeColor)},
      u_glow:{value:BAL.feel.slash.glow}, u_op:{value:1} },
    vertexShader:_RIBBON_VERT, fragmentShader:_RIBBON_FRAG,
    transparent:true, ...ADD, depthWrite:false, depthTest:false, side:THREE.DoubleSide });   // 양면(스윙이 카메라 반대로 향해도 보임)
  const _ribMesh = new THREE.Mesh(_ribGeo, _ribMat);
  _ribMesh.frustumCulled=false; _ribMesh.renderOrder=9990;   // ★bloom 제거(사령관 "검슬래시 너무 밝음") — glow만
  _ribMesh.visible=false; scene.add(_ribMesh);
  const _ribSamples = [];   // {h:Vector3(hilt), tp:Vector3(tip), time:ms, brk:bool}
  let _ribNewSwing = false;
  function bladeTrailBegin(){ _ribNewSwing = true; }   // 스윙 시작 신호 — 다음 샘플=새 궤적(이전 스윙과 quad 연결 안 함)
  function bladeSample(hilt, tip){ const S=BAL.feel.slash; const now=performance.now();
    const last=_ribSamples[_ribSamples.length-1];
    if(last && !_ribNewSwing){ const ms=(S.minStep||0.02); if(last.tp.distanceToSquared(tip) < ms*ms) return; }   // 미세 이동=중복 샘플 스킵
    _ribSamples.push({ h:hilt.clone(), tp:tip.clone(), time:now, brk:_ribNewSwing });
    _ribNewSwing=false;
    const cap=Math.min((S.samples|0)||16, RIB_MAX);
    while(_ribSamples.length>cap) _ribSamples.shift();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ [타격감 D] 그로기 별표시(stagger stars) — 커스텀 GLSL 회전 별 SDF quad(코어 별 셰이더 재활용 계열).
  //     ⚠️ 이모지·THREE.Points·SphereGeometry·radial-gradient 스프라이트 금지(파일 상단 폐기목록 준수).
  //     그로기 몹 머리 위에 금빛 별 3개가 orbit + 자전. combat(진입)·monsters(종료)가 groggyStars(mn,on) 호출.
  //     위치 추종/자전/사망정리는 아래 onUpdate에서(hitfx 자체 갱신).
  // ═════════════════════════════════════════════════════════════════════════
  const _STAR_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const _STAR_FRAG = `precision highp float; varying vec2 vUv;
    uniform float u_rot; uniform float u_op; uniform float u_glow; uniform vec3 u_core; uniform vec3 u_tip;
    void main(){
      vec2 p=(vUv-0.5)*2.0;
      float cs=cos(u_rot), sn=sin(u_rot); p=mat2(cs,-sn,sn,cs)*p;      // 별 자전
      float a=atan(p.y,p.x), r=length(p);
      // 4갈래 뾰족한 별(태양버스트 needle SDF 계열) + 뜨거운 코어
      float rays = pow(max(0.0,cos(a*2.0)),3.0) + pow(max(0.0,sin(a*2.0)),3.0);
      float spike = rays * smoothstep(1.0, 0.0, r) * 0.95;
      float core  = smoothstep(0.34, 0.0, r);
      float m = clamp(core*1.15 + spike, 0.0, 1.0);
      if(m < 0.012) discard;
      vec3 col = mix(u_tip, u_core, clamp(core*1.5, 0.0, 1.0));         // 중심=흰금빛, 갈래=금
      gl_FragColor = vec4(col * m * u_glow * u_op, m * u_op);           // 프리멀티 additive(밝은 배경 대비 = u_glow 상향)
    }`;
  const _stars = [];   // {mn, grp, mats:[], t}
  function groggyStars(mn, on){
    const idx = _stars.findIndex(s=>s.mn===mn);
    if(on){
      if(idx>=0) return;   // 이미 있음(idempotent — combat 진입·monsters 매프레임 둘 다 안전)
      const G = BAL.feel.groggy;
      const grp=new THREE.Group(); const mats=[];
      const cCore=new THREE.Color(0xfffbe6), cTip=new THREE.Color(0xffcc22);   // 흰금빛 코어 → 진한 금(대비 강화)
      const N = Math.max(1, G.starCount|0);
      for(let i=0;i<N;i++){
        const mat=new THREE.ShaderMaterial({
          uniforms:{ u_rot:{value:Math.random()*TWO_PI}, u_op:{value:1}, u_glow:{value:G.starGlow}, u_core:{value:cCore.clone()}, u_tip:{value:cTip.clone()} },
          vertexShader:_STAR_VERT, fragmentShader:_STAR_FRAG, transparent:true, ...ADD, depthWrite:false, depthTest:false });
        const mesh=new THREE.Mesh(_quadGeo, mat); mesh.renderOrder=9994; mesh.scale.setScalar(G.starScale);
        grp.add(mesh); mats.push(mat);
      }
      scene.add(grp); _stars.push({ mn, grp, mats, t:0 });
    } else if(idx>=0){
      const s=_stars[idx]; scene.remove(s.grp); for(const m of s.mats) m.dispose(); _stars.splice(idx,1);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ 미세 warm 림 틴트 — onBeforeCompile 주입. ★몹별 머티리얼 clone(u_hit uniform 몹 전용).
  //     흰색고착 버그 근본해결: 종류가 같아 템플릿 머티리얼을 공유해도 각 몹이 자기 clone·uniform을 가짐.
  //     (스파크가 주력 — 여긴 아주 옅고 짧게. rimIntensity=0으로 두면 사실상 꺼짐.)
  // ═════════════════════════════════════════════════════════════════════════
  const _tracked = [];   // clone 머티리얼 보유 몹(제거 시 dispose 위해 추적)
  //  ★솔리드 실루엣 플래시(사령관 지정): 맞는 순간 몹 전체가 단색으로 확 번쩍(격투게임/펠월드식 hit flash).
  //     emissive 테두리 아님 — 최종 프래그 색을 u_flashColor로 mix 오버라이드(라이팅 무시=솔리드 실루엣). 몹별 clone(u_hit uniform 전용).
  function injectRim(m, U){
    m.onBeforeCompile = (shader)=>{
      shader.uniforms.u_hit=U.u_hit; shader.uniforms.u_flashColor=U.u_flashColor;
      shader.fragmentShader = 'uniform float u_hit;\nuniform vec3 u_flashColor;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, u_flashColor, clamp(u_hit, 0.0, 1.0));   // 솔리드 실루엣 플래시(피격 순간 단색 번쩍)`);
    };
    m.needsUpdate=true;   // 셰이더 재컴파일(hfx 변형은 1회 컴파일 후 프로그램 공유 — 몹별 재컴파일 없음)
  }
  function ensureRimMats(mn){ if(mn._hfxMats!==undefined) return;   // 1회만
    const mats=[]; const h=H();
    const U={ u_hit:{value:0}, u_flashColor:{value:new THREE.Color(h.flashColor)} };
    mn.grp.traverse(o=>{ if(!o.isMesh) return;
      const arr=Array.isArray(o.material)?o.material:[o.material];
      const nu=arr.map(m=>{ if(!m || !m.isMeshStandardMaterial) return m;   // 표준 머티리얼만
        const c=m.clone(); injectRim(c, U); mats.push(c); return c; });
      o.material = Array.isArray(o.material) ? nu : nu[0]; });
    if(mats.length){ mn._hfxMats=mats; mn._hfxU=U; _tracked.push(mn); }
    else { mn._hfxMats=null; }   // 표준 머티리얼 없음 = 스킵(재시도 방지, null!==undefined)
  }
  function rimFlash(mn, mul){ if(!mn || !mn.grp) return; if(H().flashStrength<=0) return;   // 0=끔(clone 생략)
    ensureRimMats(mn); if(!mn._hfxU) return;
    const peak=Math.min(1, (mul>1?mul:1) * H().flashStrength);   // crit=더 진한 솔리드
    mn._hfxU.u_hit.value=peak; mn._hfxRimPeak=peak; mn._hfxRimT=0; mn._hfxRimActive=true; }

  // ═════════════════════════════════════════════════════════════════════════
  //  ◆ 히트 팝(squash & stretch) — 몹 grp 스케일 임펄스(셰이더 아님). y수축·xz팽창 후 감쇠. 미세하게.
  // ═════════════════════════════════════════════════════════════════════════
  function popImpulse(mn, mul){ if(!mn || !mn.grp) return; const h=H(); if(h.popScale<=0) return;
    if(!mn._hfxPop) mn._hfxPop={ base:mn.grp.scale.clone() };
    mn._hfxPop.t=0; mn._hfxPop.amp=h.popScale*mul; mn._hfxPop.dur=Math.max(0.001, h.popMs/1000); mn._hfxPop.active=true; }

  // ═════════════════════════════════════════════════════════════════════════
  //  단일 진입점 — combat.damageMonster가 호출. hitPos=명중 월드좌표(몹 가슴), crit=boolean.
  //    처치(kill)는 combat이 flashHit 전에 mn.hp-=out 하므로 여기서 mn.hp<=0로 감지(combat 미수정).
  //    ★origin 배치: contactPull(몹중심→플레이어 방향 접촉면 당김) + originJitter(미세 랜덤) → "같은 위치 고착" 방지.
  // ═════════════════════════════════════════════════════════════════════════
  function flashHit(mn, hitPos, crit){ if(!mn) return; const h=H();
    const kill = (mn.hp!=null && mn.hp<=0);
    const mul = (crit || kill) ? h.critMul : 1;
    const pos = hitPos
      ? (hitPos.isVector3 ? hitPos.clone() : new THREE.Vector3(hitPos.x, hitPos.y, hitPos.z))
      : (mn.grp ? new THREE.Vector3(mn.grp.position.x, mn.grp.position.y+(mn.def?.scale||1.7)*0.6, mn.grp.position.z) : null);
    if(pos){
      const radius = (mn.def?.scale||1.7)*0.45;   // 대략 타격 반경(combat.monR과 동일 계수)
      // contactPull: 몹중심→플레이어 방향(수평)으로 origin을 표면쪽으로 당김 → 실제 접촉면처럼 보임
      const pp = ctx.player?.pos;
      if(pp && mn.grp && h.contactPull>0){
        const dx=pp.x-mn.grp.position.x, dz=pp.z-mn.grp.position.z; const d=Math.hypot(dx,dz);
        if(d>0.01){ const k=radius*h.contactPull; pos.x+=dx/d*k; pos.z+=dz/d*k; }
      }
      // originJitter: 매 명중 미세 랜덤(같은 위치 반복 방지 — 회귀검증 대상)
      if(h.originJitter>0){ const j=h.originJitter;
        pos.x+=(Math.random()*2-1)*j; pos.y+=(Math.random()*2-1)*j; pos.z+=(Math.random()*2-1)*j; }
    }
    popImpulse(mn, mul);   // 히트 팝(미세) — 평타/그로기 공통
    rimFlash(mn, mul);     // (솔리드 플래시 — flashStrength=0이면 스킵) 공통
    if(pos){
      // ★그로기 난타(ctx._mashMode)면 신설 보라 임팩트(중앙 방사광선+외곽 큰 링)만 발동 — 골드 스파크와 별개·중복 안 함.
      //   평타/일반 피격은 기존 골드 스파크(태양버스트+불티+코어) 그대로(불가침).
      if(ctx._mashMode){
        // ★클래스 분기: 마법사(staff)=파란 아케인 볼트 + 발밑 룬 마법진. 그 외=기존 보라 groggyImpact(불가침).
        if(ctx.player?.currentTool==='staff'){
          // ★원거리 룬마스터 처형: 몹에게 "맞는이펙트"(전기폭발+지면서클+흰아크)가 꽂히고, 시전자 발밑엔 캐스팅 마법진.
          //   pos는 contactPull로 당겨진 좌표라 몹 중심을 다시 계산해 사용(당김=카메라밀착 과광 방지).
          _arcHit.copy(mn.grp.position); _arcHit.y += (mn.def?.scale||1.7)*0.55;
          arcaneImpact(_arcHit, mul, mn);   // 몹 몸에 맞는이펙트(레퍼런스 ref/맞는이펙트.jpg)
          arcaneCircleEnsure(mn);           // 시전자(플레이어) 발밑 캐스팅 마법진(update가 player.pos 추종)
        }
        else if(ctx.player?.currentTool==='bow'){
          // ★헌터(레퍼런스 ref/활.webp) = 파란-흰 에너지 애로우 빔: 활(가슴)→몹. 발사 조리개링+섬광, 몹 임팩트 섬광/스파클. 룬마스터와 구분되는 저격 빔.
          const pp=ctx.player?.pos; const _R=BAL.feel.groggy.arrow||{};
          _arcTo.copy(mn.grp.position); _arcTo.y += (mn.def?.scale||1.7)*(_R.impactYMul??0.35);                                   // 몹 임팩트 높이(튜닝: impactYMul)
          // ★발사 지점 = 플레이어에서 조준(몹)방향 앞쪽으로 offset → 뒤통수/몸이 아니라 활 앞에서 나감(사령관)
          const _bx=pp?pp.x:mn.grp.position.x, _bz=pp?pp.z:mn.grp.position.z;
          let _fx=_arcTo.x-_bx, _fz=_arcTo.z-_bz; const _fl=Math.hypot(_fx,_fz)||1; _fx/=_fl; _fz/=_fl;
          const _fwd=_R.launchFwd??1.3;
          _arcHit.set(_bx+_fx*_fwd, (pp?(pp.y||0):mn.grp.position.y)+(_R.launchY??0.55), _bz+_fz*_fwd);   // 조준방향 앞 + 활 높이
          energyArrow(_arcHit, _arcTo, mul);
        }
        else { groggyImpact(pos, mul); }
      }
      else { spawnBurst(pos, mul); spawnEmbers(pos, mul); spawnCore(pos, mul); }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  매 프레임 — 버스트/불티/코어 애니 · 팝/림 감쇠 · clone 머티리얼 누수정리.
  // ═════════════════════════════════════════════════════════════════════════
  ctx.onUpdate((dt)=>{ dt=dt??0.016; const h=H();
    // 카메라 right/up(빌보드 기준)
    _R.setFromMatrixColumn(camera.matrixWorld,0); _U.setFromMatrixColumn(camera.matrixWorld,1);
    // ◆ 태양버스트 (⚡풀: 만료=슬립, dispose/splice 없음)
    for(const s of _bursts){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      const u=s.mat.uniforms; u.u_t.value=s.t; u.u_camR.value.copy(_R); u.u_camU.value.copy(_U); }
    // ◆ 불티 샤드 (⚡풀)
    for(const s of _embers){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      const u=s.mat.uniforms; u.u_t.value=s.t; u.u_camR.value.copy(_R); u.u_camU.value.copy(_U); }
    // ◆ 코어 플래시 (⚡풀)
    for(const c of _cores){ if(!c.active) continue; c.t+=dt; const u=c.t/c.life;
      if(u>=1){ c.active=false; c.mesh.visible=false; continue; }
      c.mat.uniforms.u_op.value=1-u; c.mesh.quaternion.copy(camera.quaternion);
      c.mesh.scale.setScalar(c.size*(0.6+u*0.5)); }   // 짧게 살짝 커지며 페이드
    // ◆ [신설] 그로기 중앙 방사광선 (⚡풀) — u_t 진행(확 뻗음+밝기 페이드) + 카메라 빌보드축 갱신
    for(const s of _grays){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      const u=s.mat.uniforms; u.u_t.value=s.t; u.u_camR.value.copy(_R); u.u_camU.value.copy(_U); }
    // ◆ [신설] 그로기 외곽 링 (⚡풀) — u_prog(팽창+페이드) + 카메라 빌보드(quaternion) + 고정 월드크기
    for(const s of _grings){ if(!s.active) continue; s.t+=dt; const u=s.t/s.life;
      if(u>=1){ s.active=false; s.mesh.visible=false; continue; }
      s.mat.uniforms.u_prog.value=u; s.mesh.quaternion.copy(camera.quaternion); s.mesh.scale.setScalar(s.size); }
    // ◆ [신설] 아케인 볼트 풀 — u_t 진행(플라스마 흐름+페이드) + 카메라 빌보드축 갱신. 수명초과=비활성(dispose 안 함=풀 재사용).
    for(const s of _arcPool){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      const u=s.mat.uniforms; u.u_t.value=s.t; u.u_camR.value.copy(_R); u.u_camU.value.copy(_U); }
    // ◆ [신설] 맞는이펙트 흰 아크 — t진행 + roll회전(감싸며 돎) + 카메라 빌보드. 수명초과=비활성.
    for(const s of _arcArcPool){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      s.roll += s.spin*dt; const u=s.mat.uniforms; u.u_t.value=s.t; u.u_roll.value=s.roll;
      if(s.faceDir){ s.mesh.lookAt(s.mesh.position.x+s.faceDir.x, s.mesh.position.y+s.faceDir.y, s.mesh.position.z+s.faceDir.z); }   // 빔에 수직(관통 포털)
      else s.mesh.quaternion.copy(camera.quaternion); }
    // ◆ [신설] 맞는이펙트 몹 지면 임팩트 서클 — op 0→1→0 벨(확 떴다 사라짐) + 회전.
    for(const s of _arcImpPool){ if(!s.active) continue; s.t+=dt;
      if(s.t>=s.life){ s.active=false; s.mesh.visible=false; continue; }
      const u=s.t/s.life; s.mesh.rotation.z += s.spin*dt;
      s.mat.uniforms.u_op.value=Math.sin(u*Math.PI)*0.95;
      s.mat.uniforms.u_glow.value=(_ARC().impCircleGlow||1.6); }
    // ◆ [신설] 룬 마법진(단일) — 몹 발밑 추종 + 회전 + 발광펄스 + 페이드인/홀드/페이드아웃. 몹 사망/제거 시 자동 페이드.
    if(_arcState){ const A=_ARC(); const now=performance.now(); const st=_arcState;
      // ★마법진 = 시전자(룬마스터) 발밑에 깔린다(사령관). 몹 발밑 아님. 몹 생사와 무관 — 시전(E 난타로 holdUntil 갱신) 중 유지, 멈추면 페이드.
      const out  = now>st.holdUntil;
      st.op += out ? -dt/Math.max(0.01, A.circleFade||0.5) : dt/Math.max(0.01, A.circleFadeIn||0.16);
      st.op = Math.max(0, Math.min(1, st.op));
      if(out && st.op<=0){ _arcMesh.visible=false; _arcState=null; }
      else {
        st.spin += (A.circleRot||0.5)*dt;
        const pp=ctx.player?.pos; let gx=pp?pp.x:0, gz=pp?pp.z:0, gy=pp?pp.y:0;
        if(ctx.terrain?.groundAt){ const g=ctx.terrain.groundAt(gx,gz,600); if(g>-100) gy=g; }
        _arcMesh.position.set(gx, gy+0.06, gz);
        _arcMesh.rotation.z=st.spin;
        _arcMesh.scale.setScalar(A.circleSize||2.9);   // 시전자 발밑 = 몹scale 배율 없이 고정 지름
        const u=_arcMat.uniforms; u.u_tint.value.set(A.circleTint||0x35ccff);
        u.u_op.value=st.op*(A.circleOp??0.95);
        u.u_glow.value=(A.circleGlow||1.4)*(0.85+0.15*Math.sin(now*0.006));
        u.u_inner.value=A.circleInner??0.19; u.u_feather.value=A.circleInnerFeather??0.14;
      }
    }
    // ◆ [재제작] 검격 리본 트레일 — 노후 샘플 제거 + 지오메트리 재구성(꼬리 페이드) + 색/발광 런타임 반영(슬라이더).
    { const now=performance.now(); const S=BAL.feel.slash; const fade=Math.max(1, S.fadeMs||150);
      while(_ribSamples.length && (now-_ribSamples[0].time)>fade) _ribSamples.shift();   // fadeMs 지난 구간 소멸
      const n=_ribSamples.length;
      if(n>=2){
        for(let k=0;k<n;k++){ const s=_ribSamples[k]; const age=Math.min(1,(now-s.time)/fade);
          const o=k*6; _ribPos[o]=s.h.x; _ribPos[o+1]=s.h.y; _ribPos[o+2]=s.h.z;      // 짝수 정점=hilt
          _ribPos[o+3]=s.tp.x; _ribPos[o+4]=s.tp.y; _ribPos[o+5]=s.tp.z;              // 홀수 정점=tip
          _ribAge[k*2]=age; _ribAge[k*2+1]=age; }
        const idx=_ribGeo.index.array; let ii=0;
        for(let k=0;k<n-1;k++){ if(_ribSamples[k+1].brk) continue;   // 새 스윙 경계는 quad 연결 안 함
          const b=k*2; idx[ii++]=b; idx[ii++]=b+1; idx[ii++]=b+2; idx[ii++]=b+1; idx[ii++]=b+3; idx[ii++]=b+2; }
        _ribGeo.setDrawRange(0, ii);
        _ribGeo.index.needsUpdate=true;
        _ribGeo.attributes.position.needsUpdate=true; _ribGeo.attributes.aAge.needsUpdate=true;
        _ribMat.uniforms.u_col.value.set(S.color); _ribMat.uniforms.u_edge.value.set(S.edgeColor); _ribMat.uniforms.u_glow.value=S.glow;
        _ribMesh.visible = ii>0;
      } else { _ribMesh.visible=false; _ribGeo.setDrawRange(0,0); }
    }
    // ◆ [타격감 D] 그로기 별표시 — 머리 위 orbit + 자전 + 사망/제거 몹 자동정리
    for(let i=_stars.length-1;i>=0;i--){ const s=_stars[i], mn=s.mn;
      if(!mn || mn.dead || !mn.grp || !ctx.monsters || ctx.monsters.indexOf(mn)===-1){
        scene.remove(s.grp); for(const m of s.mats) m.dispose(); _stars.splice(i,1); continue; }
      s.t+=dt; const G=BAL.feel.groggy;
      const sc=(mn.def?.scale||1.7), headY=mn.grp.position.y+sc*G.starHeadY, orbitR=sc*G.starOrbitR;
      const cx=mn.grp.position.x, cz=mn.grp.position.z; const nS=s.grp.children.length;
      for(let k=0;k<nS;k++){ const st=s.grp.children[k]; const ph=s.t*2.4 + k*(TWO_PI/nS);
        st.position.set(cx+Math.cos(ph)*orbitR, headY+Math.sin(s.t*3+k)*0.10, cz+Math.sin(ph)*orbitR);
        st.quaternion.copy(camera.quaternion);   // 카메라 빌보드
        st.scale.setScalar(G.starScale*(0.9+0.15*Math.sin(s.t*6+k*2)));   // 미세 반짝(펄스)
        s.mats[k].uniforms.u_rot.value = s.t*3.0 + k; s.mats[k].uniforms.u_glow.value = G.starGlow; }
    }
    // 히트 팝 + warm 림 감쇠 (몹 순회)
    for(const mn of (ctx.monsters||[])){
      const p=mn._hfxPop;
      if(p && p.active){ p.t+=dt; const u=p.t/p.dur;
        if(u>=1){ mn.grp.scale.copy(p.base); p.active=false; }
        else { const amp=p.amp*(1-u); const b=p.base;
          mn.grp.scale.set(b.x*(1+amp*0.6), b.y*(1-amp), b.z*(1+amp*0.6)); } }
      if(mn._hfxRimActive && mn._hfxU){ mn._hfxRimT+=dt; const rd=Math.max(0.001, h.flashMs/1000); const u=mn._hfxRimT/rd;
        const U=mn._hfxU; U.u_flashColor.value.set(h.flashColor);   // 런타임 슬라이더 반영
        // 솔리드 플래시: 앞 60%는 풀강도 유지(확실한 번쩍) → 뒤 40% 급격 페이드
        if(u>=1){ U.u_hit.value=0; mn._hfxRimActive=false; }
        else { const k = u<0.6 ? 1.0 : (1-(u-0.6)/0.4); U.u_hit.value=mn._hfxRimPeak*k; } }
    }
    // clone 머티리얼 누수정리 — ctx.monsters에서 빠진(제거된) 몹의 clone dispose
    for(let i=_tracked.length-1;i>=0;i--){ const mn=_tracked[i];
      if(!ctx.monsters || ctx.monsters.indexOf(mn)===-1){
        for(const c of (mn._hfxMats||[])){ try{ c.dispose(); }catch(e){} }
        mn._hfxMats=null; mn._hfxU=null; _tracked.splice(i,1); }
    }
  });

  function clear(){   // 검수/촬영용 — 살아있는 버스트·불티·코어 즉시 소등(⚡풀 유지=재사용, dispose 없음)
    for(const s of _bursts){ s.active=false; s.mesh.visible=false; s.t=0; }
    for(const s of _embers){ s.active=false; s.mesh.visible=false; s.t=0; }
    for(const c of _cores){ c.active=false; c.mesh.visible=false; c.t=0; }
    for(const s of _grays){ s.active=false; s.mesh.visible=false; s.t=0; }                                // ★신설 그로기 광선 flush
    for(const s of _grings){ s.active=false; s.mesh.visible=false; s.t=0; }                               // ★신설 그로기 링 flush
    for(const s of _arcPool){ s.active=false; s.mesh.visible=false; s.t=0; }                              // ★아케인 볼트 flush(풀은 유지=재사용)
    for(const s of _arcArcPool){ s.active=false; s.mesh.visible=false; s.t=0; }                           // ★맞는이펙트 흰 아크 flush
    for(const s of _arcImpPool){ s.active=false; s.mesh.visible=false; s.t=0; }                           // ★맞는이펙트 몹 지면 서클 flush
    if(_arcMesh){ _arcMesh.visible=false; } _arcState=null;                                               // ★룬 마법진 flush
    _ribSamples.length=0; _ribNewSwing=false; _ribMesh.visible=false; _ribGeo.setDrawRange(0,0); }   // 검격 리본 flush
    //   ★그로기 별표시(_stars)는 clear() 대상 아님 — 순간 임팩트fx가 아니라 그로기 CC 지속상태 인디케이터.
    //   (몹 사망/제거 시 onUpdate가 자동 정리. clear는 버스트·불티·코어만 flush.)

  ctx.flashHit = flashHit;   // ★combat.js 단일 통로 호출(이름 유지 — 기존 배선/파일럿 스파이 호환)
  const _actN = pool=>{ let n=0; for(const s of pool) if(s.active) n++; return n; };   // ⚡풀 활성 카운트(active/stats용)
  const _arcActiveCount = ()=>{ let n=0; for(const s of _arcPool) if(s.active) n++;
    for(const s of _arcArcPool) if(s.active) n++; for(const s of _arcImpPool) if(s.active) n++;   // ★맞는이펙트 아크/서클도 bloom 대상
    if(_arcState && _arcState.op>0) n++; return n; };
  ctx.hitfx = { flashHit, popImpulse, rimFlash, spawnBurst, spawnEmbers, spawnCore, groggyImpact, groggyStars, arcaneStrike, arcaneImpact, arcaneCircleEnsure, arrowEmbedImpact, energyArrow, bladeTrailBegin, bladeSample, clear,
    lastOrigin:()=> _lastOrigin ? _lastOrigin.toArray() : null,   // 검수용(같은위치 회귀검증)
    arcaneActive:()=> _arcActiveCount() > 0,                      // ★magic bloom 파이프라인 활성 판정(마법사 아케인 볼트/마법진 있을 때 bloom)
    active:()=> (_actN(_bursts) + _actN(_embers) + _actN(_cores) + _actN(_grays) + _actN(_grings) + _stars.length + _arcActiveCount() + (_ribMesh.visible?1:0)) > 0,
    stats:()=>({ burst:_actN(_bursts), embers:_actN(_embers), cores:_actN(_cores), gray:_actN(_grays), gring:_actN(_grings), tracked:_tracked.length, groggy:_stars.length, ribbon:_ribSamples.length,
      arcBolt:_arcPool.reduce((a,s)=>a+(s.active?1:0),0), arcCircle:(_arcState && _arcState.op>0)?1:0, arcPool:_arcPool.length,
      arcImpArc:_arcArcPool.reduce((a,s)=>a+(s.active?1:0),0), arcImpCircle:_arcImpPool.reduce((a,s)=>a+(s.active?1:0),0) }) };
  console.log('[hitfx] 초기화 — 펠월드 레퍼런스 재현(태양버스트 + 불티 샤드 + 코어 플래시 + 히트팝 + 미세 warm 림 + 검격 리본 트레일 + 그로기 임팩트[중앙광선+외곽링] + 룬마스터 아케인 처형[시전자 발밑 마법진 + 몹 맞는이펙트=전기폭발+지면서클+흰아크])');
}
