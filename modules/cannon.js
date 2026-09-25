// cannon.js — 대포/포탄. mas main.js 9863-9941(fireProjectile 탄도 역산 + updateProjectiles 중력적분·충돌·착탄) 이식.
// 우클릭 = 카메라 방향으로 발사. 포물선 포탄 → 지형/물/몬스터 착탄 시 폭발 이펙트.
// ⚡ 퍼포먼스 개보수(튜토전투 프레임드랍 박멸):
//   ① PointLight 풀 상주(intensity 0) — 발사마다 add/remove하면 라이트 개수 변동 → 씬 전체 머티리얼
//      셰이더 재컴파일 폭탄(three.js nPointLights 해시). 개수 고정으로 재컴파일 0.
//   ② 섬광 스프라이트·파문 링 풀 — 매 발사 new/dispose 제거(GC 스파이크 방지).
//   ③ three.quarks ParticleSystem 풀 + restart() 재사용 — 매 발사 시스템 생성/삭제 제거.
//   ④ init 직후 프리워밍(renderer.compile) — 첫 발사/첫 착탄 셰이더 컴파일 히칫 제거(player.js shockwaveVFX 패턴).
import * as THREE from 'three';
import { BatchedRenderer, ParticleSystem, ConstantValue, IntervalValue, ConstantColor,
         ColorOverLife, ColorRange, SphereEmitter, RenderMode } from 'three.quarks';
import { createLightPool, createVisiblePool, radialTexture } from '/tomob-deploy/modules/fxpool.js';   // R1: 풀/텍스처 공용화(수치·개수 불변)
import { BAL } from '/tomob-deploy/modules/balance.js';   // ★C(2026-07-15): 포탄 중력/속도 SSOT — navalcombat 조준밴드와 동일 소스(밴드=실탄도 계약 보호)

export function initCannon(ctx){
  const { scene } = ctx; const PROJ_G=BAL.naval.projGravity; const projectiles=[], impacts=[];   // ★C: 하드코딩 24 → BAL(동작 불변)
  const ballGeo=new THREE.SphereGeometry(0.32,10,10), ballMat=new THREE.MeshLambertMaterial({ color:0x141414 });

  // ── ✨ 포탄 궤적 트레이서(흰 포물선) — 레퍼런스(해상전투1·2)의 흰색 포탄 궤적 재현. ──
  //   Line + 정점색 페이드(머리=흰색 → 꼬리=검정) + 가산블렌딩(검정=완전투명) = 뒤로 사그라드는 얇은 흰 선.
  //   ★풀링(발사마다 new 금지) — 40슬롯 점유추적(fxpool createVisiblePool 패턴: visible=점유 플래그).
  //     라운드로빈 금지: 동시비행 40발 초과 시 아직 나는 포탄의 Line을 재할당하면 버퍼 경합·조기소멸 → 궤적 깨짐.
  //     grabTrail=미사용(visible=false) 슬롯만 반환, 전부 사용중이면 null(라이트 풀 고갈 시와 동일하게 트레일 생략).
  const TRAIL_LEN=16, TRAIL_N=40;
  const trailPool=[];
  for(let i=0;i<TRAIL_N;i++){
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN*3),3));
    g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(TRAIL_LEN*3),3));
    const ln=new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending }));
    ln.frustumCulled=false; ln.visible=false; scene.add(ln); trailPool.push(ln);
  }
  const grabTrail=()=>trailPool.find(t=>!t.visible)||null;   // 고갈 시 null(트레일 없이 발사) — 호출부가 visible=true로 점유 표시

  // ── three.quarks 파티클 VFX ──
  const batch = new BatchedRenderer(); scene.add(batch);
  const flameTex = radialTexture(64, [[0,'rgba(255,255,255,1)'],[0.35,'rgba(255,210,130,0.9)'],[0.7,'rgba(255,110,30,0.5)'],[1,'rgba(120,30,0,0)']]);   // R1: 색스톱 그대로
  const flameMat = new THREE.MeshBasicMaterial({ map:flameTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
  const smokeMat = new THREE.MeshBasicMaterial({ map:flameTex, transparent:true, depthWrite:false, color:0x8a8a8a });
  // 물보라용 흰/하늘빛 소프트 입자 (불꽃과 달리 일반 블렌딩 — 글로우 없이 물방울 느낌)
  const dropTex = radialTexture(64, [[0,'rgba(255,255,255,1)'],[0.5,'rgba(210,235,255,0.85)'],[1,'rgba(160,205,245,0)']]);
  const waterMat = new THREE.MeshBasicMaterial({ map:dropTex, transparent:true, depthWrite:false, color:0xdff1ff });
  const ripples=[];   // 수면 파문 링 { mesh(풀 슬롯), t, life }
  const flashes=[];   // 순간 섬광/점광원 { spr(풀)|null, ls(라이트슬롯)|null, t, life, peak }

  // ── ① 점광원 풀 — R1: fxpool 공용화(개수 5·색·거리 불변. 씬 상주·intensity 0 원칙 동일). ──
   // ⚡2026-07-22 축소: three.js는 `visible`인 광원을 **intensity 0이어도 픽셀마다 계산**한다.
   //   놀고 있는 풀 광원이 씬에 30개 있었고, 이게 전투 프레임 드랍의 주원인이었다(실측: 광원 38개 제외 시 렌더 584→10ms).
   //   동시에 실제로 필요한 개수만 남긴다. 고갈 시엔 빛만 생략되고 이펙트는 그대로 나온다(기존 정책 유지).
  const lightPool=createLightPool(scene, 3, { color:0xffb060, distance:26 });   // 5→3 (머즐 플래시는 매우 짧다)
  const grabLight=()=>lightPool.grab();   // 고갈 시 라이트 생략(스프라이트만)

  // ── ② 섬광 스프라이트 풀 (머티리얼도 슬롯당 1회만 clone — 매 발사 clone 금지) — R1: visible 풀 공용화 ──
  const flashMat = new THREE.SpriteMaterial({ map:flameTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, color:0xffd9a0 });
  const spritePool=createVisiblePool(scene, 8, ()=>new THREE.Sprite(flashMat.clone()));
  const grabSprite=()=>spritePool.grab();

  // ── ② 수면 파문 링 풀 (지오메트리 공유 1개) — R1: visible 풀 공용화 ──
  const ringGeo=new THREE.RingGeometry(0.3,0.8,28);
  const ringPool=createVisiblePool(scene, 6, ()=>{ const rm=new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color:0xe2f3ff, transparent:true, opacity:0.7, depthWrite:false, side:THREE.DoubleSide }));
    rm.rotation.x=-Math.PI/2; return rm; });
  const grabRing=()=>ringPool.grab();

  // ── ③ 파티클 시스템 풀 — 생성은 init 1회, 사용은 restart()(three.quarks 0.15 공식 API). 라운드로빈. ──
  function makePSPool(n, maker){
    const pool=[]; for(let i=0;i<n;i++){ const ps=maker(); ps.emitter.position.set(0,-999,0); scene.add(ps.emitter); batch.addSystem(ps); pool.push(ps); }
    let idx=0; return ()=>pool[(idx++)%n];
  }
  const nextPuff = makePSPool(8, ()=>{ // 머즐 연기 퍼프
    const ps=new ParticleSystem({
      duration:0.4, looping:false, worldSpace:true, maxParticle:26,
      startLife:new IntervalValue(0.3,0.7), startSpeed:new IntervalValue(4,10),
      startSize:new IntervalValue(0.5,1.5), startColor:new ConstantColor(new THREE.Vector4(0.85,0.82,0.74,0.55)),
      emissionOverTime:new ConstantValue(0), emissionBursts:[{time:0,count:new ConstantValue(11),cycle:1,interval:0,probability:1}],
      shape:new SphereEmitter({radius:0.3}), material:smokeMat, renderMode:RenderMode.BillBoard });
    try{ ps.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(0.85,0.82,0.74,0.55), new THREE.Vector4(0.5,0.5,0.5,0)))); }catch(e){}
    return ps; });
  const nextFire = makePSPool(4, ()=>{ // 폭발 불꽃 코어
    const ps=new ParticleSystem({
      duration:0.6, looping:false, worldSpace:true, maxParticle:70,
      startLife:new IntervalValue(0.22,0.5), startSpeed:new IntervalValue(7,17),
      startSize:new IntervalValue(0.8,2.4), startColor:new ConstantColor(new THREE.Vector4(1,0.75,0.3,1)),
      emissionOverTime:new ConstantValue(0), emissionBursts:[{time:0,count:new ConstantValue(46),cycle:1,interval:0,probability:1}],
      shape:new SphereEmitter({radius:0.4}), material:flameMat, renderMode:RenderMode.BillBoard });
    try{ ps.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(1,0.9,0.5,1), new THREE.Vector4(0.5,0.08,0,0)))); }catch(e){}
    return ps; });
  const nextSmoke = makePSPool(4, ()=>{ // 폭발 연기 (느리고 오래)
    const ps=new ParticleSystem({
      duration:1.0, looping:false, worldSpace:true, maxParticle:40,
      startLife:new IntervalValue(0.6,1.1), startSpeed:new IntervalValue(1,4),
      startSize:new IntervalValue(1.0,2.4), startColor:new ConstantColor(new THREE.Vector4(0.6,0.6,0.6,0.4)),
      emissionOverTime:new ConstantValue(0), emissionBursts:[{time:0,count:new ConstantValue(14),cycle:1,interval:0,probability:1}],
      shape:new SphereEmitter({radius:0.6}), material:smokeMat, renderMode:RenderMode.BillBoard });
    try{ ps.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(0.65,0.65,0.65,0.45), new THREE.Vector4(0.4,0.4,0.4,0)))); }catch(e){}
    return ps; });
  const nextSpray = makePSPool(6, ()=>{ // 물기둥/물보라
    const ps=new ParticleSystem({
      duration:0.5, looping:false, worldSpace:true, maxParticle:60,
      startLife:new IntervalValue(0.28,0.62), startSpeed:new IntervalValue(5,12),
      startSize:new IntervalValue(0.4,1.2), startColor:new ConstantColor(new THREE.Vector4(0.9,0.96,1,0.95)),
      emissionOverTime:new ConstantValue(0), emissionBursts:[{time:0,count:new ConstantValue(42),cycle:1,interval:0,probability:1}],
      shape:new SphereEmitter({radius:0.5}), material:waterMat, renderMode:RenderMode.BillBoard });
    try{ ps.addBehavior(new ColorOverLife(new ColorRange(new THREE.Vector4(0.92,0.97,1,0.95), new THREE.Vector4(0.8,0.9,1,0)))); }catch(e){}
    return ps; });

  // 🎯 머즐 플래시 — 포구 발사 섬광(빌보드 스프라이트) + 순간 점광원 + 바깥으로 연기 퍼프.
  //   broadside 각 포구에서 호출(dx,dz = 발사 방향=현측 바깥). 포탄이 허공서 생기는 듯 보이는 문제 해결.
  function muzzleFlash(x,y,z, dx=0,dz=1){
    const d=Math.hypot(dx,dz)||1; dx/=d; dz/=d;
    const fx=x+dx*1.2, fz=z+dz*1.2;   // 포구 약간 바깥
    // 1) 섬광 스프라이트 (풀)
    const spr=grabSprite();
    if(spr){ spr.position.set(fx,y,fz); spr.scale.setScalar(0.6); spr.material.opacity=1; spr.visible=true; }
    // 2) 순간 점광원(주황) (풀)
    const ls=grabLight();
    if(ls){ ls.light.color.setHex(0xffb060); ls.light.distance=22; ls.light.position.set(fx,y+0.4,fz); }
    flashes.push({ spr, ls, t:0, life:0.16, peak:9 });
    // 3) 연기 퍼프(바깥으로) (풀 restart)
    const puff=nextPuff(); puff.emitter.position.set(fx,y,fz); puff.restart();
  }

  function explode(x,y,z){
    // 💡 순간 점광원 — 폭발이 거리·역광에도 확실히 보이게(피격 가시성) (풀)
    const ls=grabLight();
    if(ls){ ls.light.color.setHex(0xff7a28); ls.light.distance=30; ls.light.position.set(x,y+0.5,z); }
    flashes.push({ spr:null, ls, t:0, life:0.32, peak:11 });
    // 불꽃 코어 + 연기 (풀 restart)
    const fire=nextFire(); fire.emitter.position.set(x,y,z); fire.restart();
    const smoke=nextSmoke(); smoke.emitter.position.set(x,y,z); smoke.restart();
  }

  // 💦 물 착탄 = 물보라(위로 솟는 물기둥) + 수면 파문 링 + splash 사운드 (불 폭발 대신)
  function splash(x,z){
    const WL=ctx.water?ctx.water.level:0;
    // 1) 물기둥/물보라 (풀 restart)
    const spray=nextSpray(); spray.emitter.position.set(x,WL+0.3,z); spray.restart();
    // 2) ★평면 확산 링 제거(사령관 2026-07-10 "바다에 동그랗게 퍼지는거 짜침") — 물기둥 스프레이만 남김
    // 3) splash 사운드(물 입수음 재사용)
    ctx.sound?.sfxPath('/suimo_splash'+(1+(Math.random()*3|0))+'.wav', 0.45);
  }

  // 공용 포탄 스폰 — 초기속도(vx,vy,vz)로 발사. fire()·fireVel() 공통 경로.
  function _spawnBall(fx,fy,fz, vx,vy,vz, life){
    const m=new THREE.Mesh(ballGeo, ballMat); m.position.set(fx,fy,fz); scene.add(m);
    // ✨ 궤적 트레이서 부착 — 히스토리 전부 포구 위치로 초기화(첫 프레임 꼬리가 원점서 뻗지 않게)
    //   40슬롯 전부 사용중이면 trail=null(궤적 생략) — 같은 Line을 나는 포탄끼리 공유하는 재할당 경합 방지.
    const trail=grabTrail(); if(trail) trail.visible=true;
    const hist=trail ? new Float32Array(TRAIL_LEN*3) : null;
    if(hist){ for(let k=0;k<TRAIL_LEN;k++){ hist[k*3]=fx; hist[k*3+1]=fy; hist[k*3+2]=fz; } }
    const pr={ mesh:m, vx, vy, vz, t:life, trail, hist };
    projectiles.push(pr);
    ctx.sound?.play?.('cannon_fire');   // 대포 발사음 (통합 테이블)
    return pr;
  }
  function fire(fx,fy,fz, tx,ty,tz){   // mas fireProjectile: 비행시간 T 동안 중력 하에 (tx,ty,tz) 통과하는 초기속도 역산 (육상 대포·기존 broadside)
    const dx=tx-fx, dy=ty-fy, dz=tz-fz, horiz=Math.hypot(dx,dz)||0.001, VH=BAL.naval.projSpeed, T=Math.max(0.45,Math.min(2.6,horiz/VH));   // ★C: 하드코딩 22 → BAL(동작 불변)
    return _spawnBall(fx,fy,fz, dx/T, (dy+0.5*PROJ_G*T*T)/T, dz/T, T+2.5);
  }
  // ⚔️ 해전 조준 전용 — 초기속도(수평방향·발사각·총구속도)를 직접 지정. 조준 밴드 곡률과 실제 탄도가 100% 일치. (navalcombat fireNav)
  function fireVel(fx,fy,fz, vx,vy,vz){ return _spawnBall(fx,fy,fz, vx,vy,vz, 6); }
  // (구 burst 스프라이트 → explode() three.quarks 파티클로 대체)

  ctx.onUpdate(dt=>{
    batch.update(dt);   // three.quarks 파티클 갱신
    // 순간 섬광/점광원 애니(머즐 플래시·폭발광): 빠르게 솟았다 사그라듦 → 만료 시 풀 반납(제거/dispose 없음)
    for(let i=flashes.length-1;i>=0;i--){ const f=flashes[i]; f.t+=dt; const k=f.t/f.life;
      if(f.spr){ const s=0.6+k*4; f.spr.scale.setScalar(s); f.spr.material.opacity=Math.max(0,1-k); }
      if(f.ls) f.ls.light.intensity=f.peak*Math.max(0,1-k*1.1);
      if(k>=1){ if(f.spr) spritePool.park(f.spr);
        if(f.ls) lightPool.release(f.ls); flashes.splice(i,1); } }
    // 수면 파문 링 애니(퍼지며 페이드) → 만료 시 풀 반납
    for(let i=ripples.length-1;i>=0;i--){ const r=ripples[i]; r.t+=dt; const k=r.t/r.life;
      const s=1+k*7; r.mesh.scale.set(s,s,s); r.mesh.material.opacity=Math.max(0,0.7*(1-k));
      if(k>=1){ ringPool.park(r.mesh); ripples.splice(i,1); } }
    const WL=ctx.water?ctx.water.level:0;
    for(let i=projectiles.length-1;i>=0;i--){ const pr=projectiles[i]; pr.t-=dt; pr.vy-=PROJ_G*dt;
      const p=pr.mesh.position; p.x+=pr.vx*dt; p.y+=pr.vy*dt; p.z+=pr.vz*dt;
      // ✨ 궤적 트레일 갱신 — 히스토리 한 칸 밀고 머리=현재. 정점색 머리(흰)→꼬리(검=투명) 가산페이드.
      if(pr.trail){ const h=pr.hist;
        for(let k=h.length-1;k>=3;k--) h[k]=h[k-3];
        h[0]=p.x; h[1]=p.y; h[2]=p.z;
        const pos=pr.trail.geometry.attributes.position.array, col=pr.trail.geometry.attributes.color.array;
        for(let k=0;k<TRAIL_LEN;k++){ pos[k*3]=h[k*3]; pos[k*3+1]=h[k*3+1]; pos[k*3+2]=h[k*3+2];
          const a=1-k/(TRAIL_LEN-1), c=a*a*1.35; col[k*3]=c; col[k*3+1]=c; col[k*3+2]=c; }
        pr.trail.geometry.attributes.position.needsUpdate=true; pr.trail.geometry.attributes.color.needsUpdate=true; }
      let waterHit = p.y<=WL, solidHit=false;                            // 물 착탄 / 단단한 것 착탄 구분
      // 🏰 요새 공성 = 지형보다 먼저(섬 위 요새로 온 포탄이 건물 전에 지면에 맞아 스킵되던 것 방지)
      if(!waterHit && ctx.siegeFort && ctx.siegeFort.impact && ctx.siegeFort.impact(p)){ solidHit=true; }   // 직격/스플래시/연쇄
      if(!waterHit && !solidHit && ctx.terrain){ const gy=ctx.terrain.groundAt(p.x,p.z,p.y+6); if(gy>0.5 && p.y<=gy+0.3) solidHit=true; }   // 지형
      if(!waterHit && !solidHit && ctx.fortify && ctx.fortify.solidAt && ctx.fortify.solidAt(p)){ solidHit=true; ctx.fortify.damage(p, 40, 2.2); }   // 🧱 포탄 → 벽 공성(블록 파괴)
      if(!waterHit && !solidHit && ctx.monsters) for(const mn of ctx.monsters){ if(mn.dead)continue; const q=mn.mesh.position;   // 몬스터 직격
        if(Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<1.7){ solidHit=true;
          // ★A4(2026-07-15): damageMonster 단일 통로로 배선 — 대포 처치도 XP·영혼·드롭·어그로 정상 지급(기존 직접 hp감산은 전부 누락). feel:false=해전 중 전역 히트스톱/크리사운드 오염 방지.
          ctx.combat?._damageMonster?.(mn, 25, mn.mesh.position.clone(), false, {feel:false});
          break; } }
      if(waterHit || solidHit || pr.t<=0){
        if(waterHit) splash(p.x,p.z);                 // 💦 물보라+파문
        else if(solidHit) explode(p.x,p.y,p.z);       // 🔥 단단한 것엔 폭발
        if(pr.trail) pr.trail.visible=false;          // ✨ 트레이서 반납(다음 발사 재사용)
        scene.remove(pr.mesh); projectiles.splice(i,1);
      }
    }
  });

  // ── ④ 프리워밍 — 파티클/스프라이트/링/포탄 머티리얼을 로드 시점에 컴파일(첫 발사 히칫 제거). ──
  //   화면 밖(y=-990)에서 각 이펙트 1회 방출 + renderer.compile. 사운드는 프리워밍 중 끄기 위해 직접 방출.
  try{
    const warmBall=new THREE.Mesh(ballGeo, ballMat); warmBall.position.set(0,-990,0); scene.add(warmBall);
    const p0=nextPuff(); p0.emitter.position.set(0,-990,0); p0.restart();
    const f0=nextFire(); f0.emitter.position.set(0,-990,0); f0.restart();
    const s0=nextSmoke(); s0.emitter.position.set(0,-990,0); s0.restart();
    const w0=nextSpray(); w0.emitter.position.set(0,-990,0); w0.restart();
    const spr0=grabSprite(); if(spr0){ spr0.position.set(0,-990,0); spr0.visible=true; }
    const rg0=grabRing(); if(rg0){ rg0.position.set(0,-990,0); rg0.visible=true; }
    batch.update(1/60);                                   // 버스트 방출 → 배치 지오메트리 실체화
    if(ctx.renderer && ctx.camera) ctx.renderer.compile(scene, ctx.camera);
    if(spr0) spritePool.park(spr0);
    if(rg0) ringPool.park(rg0);
    scene.remove(warmBall);
  }catch(e){ console.warn('[cannon] prewarm skip', e); }

  // ★우클릭 캐릭터 발사 제거 — 대포는 방어타워(claim.js)·배(ship.js)가 자기 대포 위치에서 fire()를 호출한다.
  //   캐릭터에서 포탄이 나가지 않음. (우클릭은 차지공격 2단계용으로 예약)
  addEventListener('contextmenu', e=>{ if(document.pointerLockElement===ctx.renderer.domElement) e.preventDefault(); });

  ctx.cannon={ fire, fireVel, projectiles, explode, splash, muzzleFlash };
  return ctx.cannon;
}
