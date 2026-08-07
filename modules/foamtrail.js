// foamtrail.js — 🌊 월드공간 포말 마스크 RT (웨이크 트레일 + 착수 물보라). ref/배나가는효과.png 재현.
//   기법: 핑퐁 렌더타겟 누적 — 매 프레임 ①감쇠+확산 패스(이전 마스크가 옅어지며 바깥으로 번짐)
//         ②스탬프 패스(선미/착수 지점에 불규칙 얼룩을 가산) → water.js 셰이더가 이 마스크를 샘플해
//         크레스트 폼과 같은 fbm 질감으로 수면에 그린다(떠다니는 스프라이트/파티클 아님 — 포말이 '물에' 있음).
//   영역: 배(없으면 플레이어) 중심 AREA(m) 정사각형. 텍셀 그리드에 스냅해 이동 시 내용 시프트(스위밍 방지).
//   소비처: ship.js(선미 스탬프·착수 버스트) · water.js(setWake). 성역 준수 — 파형/부력 로직 무관(색 합성만).
import * as THREE from 'three';

const S    = 512;    // RT 해상도 — 512²(텍셀 ≈ 0.55m). 감쇠+스탬프 2패스로 GPU 비용 미미
const AREA = 280;    // 커버 영역(m) — 트레일 길이(배 최고속 ~8m/s × 수명 ~10s + 여유)
const TAU  = 4.2;    // 감쇠 시정수(s) — 레퍼런스 트레일 길이(선미 진하고 멀수록 흐림, 오래 잔존)

export function initFoamtrail(ctx){
  const renderer = ctx.renderer;
  if(!renderer){ console.warn('[foamtrail] renderer 없음 — 비활성'); return null; }

  const rtOpt = { format:THREE.RGBAFormat, type:THREE.UnsignedByteType, depthBuffer:false, stencilBuffer:false,
                  minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
                  wrapS:THREE.ClampToEdgeWrapping, wrapT:THREE.ClampToEdgeWrapping };
  let rtA = new THREE.WebGLRenderTarget(S, S, rtOpt);
  let rtB = new THREE.WebGLRenderTarget(S, S, rtOpt);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── ① 감쇠+확산 패스 — 이전 마스크를 (이동 시프트 보정해) 읽어 옅어지고 살짝 번진 채로 쓴다 ──
  const decayMat = new THREE.ShaderMaterial({
    uniforms:{ uPrev:{value:null}, uOff:{value:new THREE.Vector2(0,0)}, uDecay:{value:1}, uDiff:{value:0}, uTexel:{value:1/S} },
    depthTest:false, depthWrite:false,
    vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader:`varying vec2 vUv; uniform sampler2D uPrev; uniform vec2 uOff; uniform float uDecay,uDiff,uTexel;
      void main(){
        vec2 uv=vUv+uOff;   // 영역 중심 이동 → 내용 반대 시프트(월드 고정)
        float c=texture2D(uPrev,uv).r;
        float n=texture2D(uPrev,uv+vec2(uTexel,0.0)).r+texture2D(uPrev,uv-vec2(uTexel,0.0)).r
               +texture2D(uPrev,uv+vec2(0.0,uTexel)).r+texture2D(uPrev,uv-vec2(0.0,uTexel)).r;
        float v=mix(c, n*0.25, uDiff)*uDecay;   // 십자 4탭 확산 — 포말이 바깥으로 번지며 소멸(레퍼런스 트레일 끝단)
        if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) v=0.0;
        gl_FragColor=vec4(v,0.0,0.0,1.0); }`,
  });
  const decayScene = new THREE.Scene();
  decayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), decayMat));

  // ── ② 스탬프 패스 — 불규칙 얼룩(가산). 완벽한 원 금지: 해시 노이즈로 가장자리를 깨뜨림 ──
  const stampScene = new THREE.Scene();
  const STAMP_POOL = 28;
  const _stampGeo = new THREE.PlaneGeometry(1,1);
  const _mkStampMat = () => new THREE.ShaderMaterial({
    uniforms:{ uI:{value:1}, uSeed:{value:0} },
    transparent:true, blending:THREE.AdditiveBlending, depthTest:false, depthWrite:false,
    vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:`varying vec2 vUv; uniform float uI,uSeed;
      float h2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 d=vUv-0.5; float r=length(d)*2.0;
        float blob=smoothstep(1.0,0.22,r);                       // радial 감쇠
        float nz=0.5+0.5*n2(vUv*6.5+uSeed*3.1);                  // 얼룩(불규칙 경계 — '동그라미 파장' 금지)
        gl_FragColor=vec4(uI*blob*(0.55+0.45*nz),0.0,0.0,1.0); }`,
  });
  const stamps = [];
  for(let i=0;i<STAMP_POOL;i++){ const m=new THREE.Mesh(_stampGeo, _mkStampMat()); m.visible=false; stampScene.add(m); stamps.push(m); }
  let _stampN = 0;   // 이번 프레임 사용 수

  // ── 영역 앵커(텍셀 스냅) ──
  const TEXEL_W = AREA/S;
  let cx = 0, cz = 0, _init = false;
  const snap = v => Math.round(v/TEXEL_W)*TEXEL_W;

  // ── 스탬프 요청 큐(즉시 + 지연 버스트) ──
  //   ang(rad)=진행방향(스탬프를 그 방향으로 늘임) · aspect=길이/폭 비(1=원형). 웨이크=길쭉한 타원(줄무늬 씨앗).
  const _queue = [];   // {x,z,r,i,delay,ang,aspect}
  function stamp(x, z, r, intensity, ang, aspect){ _queue.push({ x, z, r, i:intensity, delay:0, ang:ang||0, aspect:aspect||1 }); }
  // 착수 물보라 — 중심 강타 + 바깥으로 번지는 지연 얼룩들(실제 물 퍼짐: 프레임에 걸쳐 확장. '한 번에 링' 아님)
  function burst(x, z, power){
    const P = Math.min(1, (power||3)/6);
    stamp(x, z, 3.2+4.5*P, 0.75+0.35*P);   // 중심 임팩트
    const N = 6+Math.round(P*4);
    for(let j=0;j<N;j++){ const a=(j/N)*Math.PI*2 + (j*0.7)%1, t=0.06+(j/N)*0.30+((j*13)%7)*0.012;
      const dd=2.5+P*4.0*(0.5+((j*7)%5)/5);
      _queue.push({ x:x+Math.cos(a)*dd, z:z+Math.sin(a)*dd, r:1.6+2.8*P*((j%3)+1)/3, i:0.30+0.35*P, delay:t }); }
  }

  // ── 프레임 업데이트: 앵커 추적 → 감쇠/확산 → 스탬프 → 스왑 → water 주입 ──
  ctx.onUpdate(dt => {
    dt = Math.min(dt||0.016, 0.1);
    const anchor = ctx.ship ? { x:ctx.ship.x, z:ctx.ship.z } : (ctx.player && ctx.player.pos) || null;
    if(!anchor) return;
    const nx = snap(anchor.x), nz = snap(anchor.z);
    if(!_init){ cx=nx; cz=nz; _init=true; }
    const offU = (nx-cx)/AREA, offV = (nz-cz)/AREA;   // 중심 이동량(uv) — prev 샘플 시프트
    cx = nx; cz = nz;

    // ① 감쇠+확산
    decayMat.uniforms.uPrev.value = rtA.texture;
    decayMat.uniforms.uOff.value.set(offU, offV);
    decayMat.uniforms.uDecay.value = Math.exp(-dt/TAU);
    decayMat.uniforms.uDiff.value = Math.min(0.30, dt*3.5);   // 확산량 dt 비례 — 트레일 과폭 억제(사령관 "배 크기에 안 맞게 넓음")
    // ② 스탬프 배치(큐 소비 — 지연 버스트 포함)
    _stampN = 0;
    for(let i=_queue.length-1; i>=0; i--){ const q=_queue[i];
      if(q.delay > 0){ q.delay -= dt; continue; }
      if(_stampN >= STAMP_POOL){ break; }
      const m = stamps[_stampN++];
      m.position.set((q.x-cx)*(2/AREA), (q.z-cz)*(2/AREA), 0);
      const s = Math.max(0.004, q.r*4/AREA);   // 지름 2r → NDC 스케일(4r/AREA)
      m.scale.set(s*(q.aspect||1), s, 1);      // 진행방향으로 길쭉(웨이크 줄무늬 씨앗)
      m.rotation.z = q.ang || 0;               // NDC x=월드x·y=월드z — atan2(dz,dx) 그대로
      m.material.uniforms.uI.value = q.i;
      m.material.uniforms.uSeed.value = (q.x*7.13 + q.z*3.71) % 10;
      m.visible = true;
      _queue.splice(i,1);
    }
    // ③ 렌더(핑퐁) — 렌더러 상태 보존
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.setRenderTarget(rtB);
    renderer.autoClear = false;                 // 감쇠 quad가 전면 덮어씀 — clear 불필요
    renderer.render(decayScene, cam);
    if(_stampN > 0) renderer.render(stampScene, cam);   // 가산 스탬프
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
    for(let i=0;i<_stampN;i++) stamps[i].visible = false;
    const t = rtA; rtA = rtB; rtB = t;          // 스왑 — rtA = 최신
    // ④ water 주입
    if(ctx.water && ctx.water.setWake) ctx.water.setWake(rtA.texture, cx, cz, AREA);
  });

  ctx.foamtrail = { stamp, burst, get area(){ return { cx, cz, size:AREA }; }, texture:()=>rtA.texture };
  console.log(`[foamtrail] 포말 RT ${S}²/${AREA}m — 감쇠 τ${TAU}s·확산·스탬프풀 ${STAMP_POOL} (웨이크+착수, water.setWake 주입)`);
  return ctx.foamtrail;
}

// [근거]
// 확정: 선미 뒤끓는 포말 트레일이 수면 자체에 녹아 뒤로 퍼지며 소멸 + 흘수선 옅은 포말. (출처: ref/배나가는효과.png — 2026-07-05 분석·컨펌)
// 확정: 착수 물보라 = "동그라미 파장" 폐지, 실제 물 퍼짐(불규칙·시간차 확장). (출처: 사령관 /plan 지시 2026-07-05)
// 확정: 파형·부력 로직 무변경 — water 셰이더 색 합성만(성역). (출처: work.md §A 파도 성역)
// 제안: S=512·AREA=280m·τ=3.2s·확산 dt*7 = 제안값(사령관 실GPU 눈 판정으로 튜닝. 헤드리스는 물 렌더 불가).
// 미정: 다중 배(적선) 웨이크 — v1은 플레이어 배 앵커 영역 내에서만 보임(적선이 근처면 같이 그려짐. 전맵 커버는 후속).
