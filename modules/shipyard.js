// shipyard.js — 배 제작(드라이독). ★건설 모드 = 게임 안에서 처리(메뉴 안 거침 → 마우스 시점 유지).
//   진입: 오직 항구 관리 '배 관리 → 제작' 탭 → build() 즉시 건조(바로 이름 → 부두 옆 바다 스폰). K키 건조 폐지(사령관).
//   [ / ] 레시피 전환(롱십↔캐러벨). 재료(테스트 무한). build.js B키 빌드와 같은 패턴.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initShip } from '/tomob-deploy/modules/ship.js';

// ★조선소 라인업 = 3티어 진행형(사령관 확정 2026-07-03). 화물칸 용량 = 티어 차등(inventory.js CARGO_CAPACITY와 키 정렬).
//   시작배 오세베르그(무료·화물20)는 game.html이 직접 지급 → 여기엔 없음. 건조 가능배 = 캐러벨→엠티범선→퀸.
//   방향보정 파라미터(center/standUp/flip 등)는 모델 고유 → NPC 풀(navalencounter.js ENEMY_POOL)에서 검증된 값 계승(단 갑판 boarding 파라미터 제외).
//   ⚠️ 롱십 제거: ship:{} 비어서 오세베르그로 폴백 = 시작배와 외형 중복(3000골드 주고 같은 배)이었음.
// ★배 건조 = 오직 금화(사령관 2026-07-03). 목재 차감 폐지 — 조선소는 금화로 즉시 건조(재료 하나씩 채우기 없음).
// ★caravel 프로파일 = opening/ENEMY_POOL 검증값에 정렬(2026-07-03): 기존 shipyard caravel엔 flip·useModelHelm이
//   없어서 ①뱃머리 방향 반대 ②모델 내장 조타륜(후방) 대신 ship_helm.glb를 가운데 놓음(조타 2개·텍스처 문제)이었음.
// ★export(2026-08-07, BUG-A4): 배 건조를 제작탭으로 옮기면서 invui가 카탈로그(이름·가격·모델경로)를 읽는다.
//   수치는 여기가 SSOT — invui는 비추기만 하고 값을 복제하지 않는다.
export const SHIPS = [
  { key:'caravel', name:'캐러벨',   gold:600,  ship:{ objUrl:'/tomob-deploy/obj/caravel-ship/optimized.glb', length:56, albedoDir:'/tomob-deploy/obj/caravel-ship/textures/', stripRig:true, center:true, useModelHelm:true, flip:true, clothSail:true, showSides:false } },
  // ★empty·queen 설정 = sandbox.html 검증된 GLB 프로파일 계승(플레이어 항해+갑판보행 확인된 값). length/helmX/deckLevels 임의변경 금지(서로 튜닝 의존).
  { key:'empty',   name:'엠티 범선', gold:1500, ship:{ objUrl:'/tomob-deploy/obj/empty-ship/optimized.glb', length:56, helmX:-17, clothSail:'all' } },
  { key:'queen',   name:'퀸 앤스 리벤지', gold:3000, ship:{ objUrl:'/tomob-deploy/obj/queen-annes-revenge/optimized.glb', length:45, center:true, standUp:true, calmBuoy:true, deckLevels:[5.5,7.3], ovDeckW:31, ovDeckL:7.5, deckCx:3.5, deckCz:1.25 } },
];

import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';
export function initShipyard(ctx){
  const { scene } = ctx;
  ctx.fleet = ctx.fleet || [];   // 내 함대(항구 귀속)
  let ghost=null, idx=0, buildMode=false, valid=false, loading=false;

  // ★토스트 = uikit 공통(제작 = gold)
  function toast(t){ ukToast(t, { accent:'gold', ms:2400 }); }

  const hudEl=document.createElement('div'); hudEl.style.cssText='position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:8;color:#7af0a0;font:14px Pretendard,system-ui,"Malgun Gothic";text-shadow:0 1px 3px #000;pointer-events:none;display:none;text-align:center'; document.body.appendChild(hudEl);
  function hud(){ if(!buildMode){ hudEl.style.display='none'; return; } const r=SHIPS[idx];
    const inv=ctx.inventory, haveG=inv?(inv.gold||0):0;
    const okG=haveG>=r.gold;   // ★금화만(목재 폐지)
    hudEl.innerHTML=`배 건설 — <b style="color:#aef0c8">${r.name}</b><br>`
      +`<span style="font-size:13px">골드 <b style="color:${okG?'#f0d060':'#ff9090'}">${haveG}/${r.gold}</b></span><br>`
      +`<span style="font-size:12px;color:#9fbac4">[ / ] 배 전환 · ${valid?(okG?'<b style="color:#7af0a0">좌클릭 건조</b>':'<b style="color:#ff9090">골드 부족</b>'):'<b style="color:#ff9090">부두 근처로</b>'} · ESC 종료</span>`;
    hudEl.style.display='block'; }

  async function loadGhost(rec){
    const url=rec.ship.objUrl||'/tomob-deploy/obj/oseberg-ship/_ex/oseberg.1.8.obj';
    let obj;
    try{ obj=/\.fbx$/i.test(url) ? await new Promise((r,j)=>new FBXLoader().load(url,r,undefined,j))
      : /\.glb|\.gltf$/i.test(url) ? (await new Promise((r,j)=>new GLTFLoader().load(url,r,undefined,j))).scene
      : await new Promise((r,j)=>new OBJLoader().load(url,r,undefined,j)); }
    catch(e){ const g=new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(6,3,20),new THREE.MeshBasicMaterial({color:0x4ade5a,transparent:true,opacity:0.42,depthWrite:false}))); return g; }
    // caravel FBX 'SailAnim' 등 morph NaN 정점 제거 — Box3 NaN 방지(ship.js와 동일 처리)
    const bad=[]; obj.traverse(o=>{ if(o.isMesh&&o.geometry){ o.geometry.morphAttributes={}; o.morphTargetInfluences=null;
      o.geometry.computeBoundingBox(); const bb=o.geometry.boundingBox; if(!bb||isNaN(bb.min.x)||isNaN(bb.max.x)) bad.push(o); } });
    bad.forEach(o=>{ if(o.parent) o.parent.remove(o); });
    const sz=new THREE.Vector3(); new THREE.Box3().setFromObject(obj).getSize(sz);
    obj.scale.setScalar((rec.ship.length||22)/Math.max(sz.x,sz.z,0.01));
    obj.traverse(o=>{ if(o.isMesh) o.material=new THREE.MeshBasicMaterial({ color:0x4ade5a, transparent:true, opacity:0.42, depthWrite:false }); });
    return obj;
  }
  async function showGhost(){ if(loading) return; loading=true; if(ghost){ scene.remove(ghost); ghost=null; }
    const g=await loadGhost(SHIPS[idx]); if(buildMode){ ghost=g; scene.add(ghost); } loading=false; }

  function enter(key){
    if(!(ctx.wharf&&ctx.wharf.pos)){ toast('먼저 항구(부두)를 지어라 (G)'); return; }
    if(key){ const i=SHIPS.findIndex(s=>s.key===key); if(i>=0) idx=i; }
    buildMode=true; showGhost(); hud();
    // ★메뉴(harbor)에서 진입 시 시점 잠금이 풀려 있으므로 재요청 — 마우스 시점 정상화
    if(ctx.renderer && ctx.renderer.domElement.requestPointerLock) ctx.renderer.domElement.requestPointerLock();
  }
  function exit(){ buildMode=false; if(ghost){ scene.remove(ghost); ghost=null; } hud(); }
  function cycle(d){ if(!buildMode) return; idx=(idx+d+SHIPS.length)%SHIPS.length; showGhost(); hud(); }

  // 배 이름 짓기 모달(invui 톤)
  function askName(cb){
    if(document.exitPointerLock) document.exitPointerLock();
    const ov=document.createElement('div'); ov.style.cssText='position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(6,11,18,.55);backdrop-filter:blur(6px);font-family:Pretendard,system-ui,"Malgun Gothic"';
    ov.innerHTML=`<div style="background:linear-gradient(180deg,rgba(13,20,30,.96),rgba(8,12,19,.97));border:1px solid rgba(201,168,90,.5);border-radius:14px;padding:24px 28px;width:340px;box-shadow:0 20px 60px rgba(0,0,0,.6)">
      <div style="color:#f3e8ca;font:800 18px Pretendard;border-left:3px solid #e7c878;padding-left:10px;margin-bottom:16px">배 이름 짓기</div>
      <input id="sy_name" maxlength="16" placeholder="배 이름" style="width:100%;padding:11px 12px;border-radius:8px;border:1px solid rgba(201,168,90,.4);background:rgba(8,14,22,.7);color:#f0e0b0;font:15px Pretendard;outline:none;box-sizing:border-box"/>
      <button id="sy_ok" style="width:100%;margin-top:16px;padding:11px;border-radius:8px;border:1px solid #d8b24e;background:linear-gradient(180deg,#ecc962,#a9842f);color:#2a1d06;font:800 15px Pretendard;cursor:pointer">건조</button></div>`;
    document.body.appendChild(ov);
    const inp=ov.querySelector('#sy_name'); setTimeout(()=>inp.focus(),50);
    const done=()=>{ const nm=inp.value.trim()||'이름없는 배'; document.body.removeChild(ov); cb(nm); };
    ov.querySelector('#sy_ok').onclick=done;
    inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.code==='Enter') done(); });
  }

  // ★위치를 무조건 바다로(사령관): 항구/부두/육지 위든, 가장 가까운 물 방향으로 배가 확실히 뜨는 지점(경계 넘어 +18m)까지 밀어냄.
  //   기존엔 물 경계(해안선)만 반환해 배가 부두·해안에 반쯤 걸치던 것 → 바다 안쪽으로 확실히 띄운다.
  //   ★가장 "열린 바다" 방향을 찾아 배 길이만큼 확보(사령관 "배가 땅에 쳐박혀서 나옴"). 첫 물 방향 +18m는 배(56m)가 못 벗어나 뱃머리가 땅에 걸리던 버그.
  function toSea(x,z, clearance=30){ const wl=ctx.water?ctx.water.level:0;
    const land=(px,pz)=>(ctx.terrain?ctx.terrain.groundAt(px,pz,5000):0)>wl+0.3;
    let best=null, bestReach=-1;
    for(let a=0;a<6.283;a+=0.3){ const c=Math.cos(a), s=Math.sin(a);       // 각 방향으로 물이 얼마나 이어지는지 측정
      let reach=0; for(let r=6;r<=160;r+=4){ if(land(x+c*r, z+s*r)) break; reach=r; }
      if(reach>bestReach){ bestReach=reach; best={c,s}; } }
    if(!best || bestReach<10) return { x, z };                              // 열린 물 못 찾음 → 원위치(안전)
    const d=Math.min(bestReach-6, Math.max(clearance, 22));                 // 열린 물 안쪽 + 배 길이만큼 확보(양끝 물 위)
    return { x:x+best.c*d, z:z+best.s*d }; }
  // ★SIM-B2(GAP-3) 수정 — 정박점 점유 검사. 기존엔 무조건 ctx.wharf.dock 동일좌표 스폰 →
  //   배 2척이 0m 완전 겹침(Z-파이팅 + 겹친 갑판 콜라이더가 플레이어 지터). 점유 시 주변 물에서 빈자리 탐색.
  function freeDock(px, pz){
    const wl=ctx.water?ctx.water.level:0;
    const occupied=(x,z)=>!!(ctx.fleet && ctx.fleet.some(f=>{ if(!f) return false;
      const m=f.bs&&f.bs.mesh; const fx=m?m.position.x:f.x, fz=m?m.position.z:f.z;
      return Math.hypot(fx-x, fz-z) < 16; }));
    if(!occupied(px,pz)) return { x:px, z:pz };
    for(let r=18; r<=96; r+=14) for(let a=0; a<6.283; a+=0.55){
      const x=px+Math.cos(a)*r, z=pz+Math.sin(a)*r;
      if((ctx.terrain?ctx.terrain.groundAt(x,z,5000):0) < wl-0.5 && !occupied(x,z)) return { x, z };
    }
    return { x:px+18, z:pz };   // 최후 폴백(그래도 겹침만은 회피)
  }

  async function confirm(){
    if(!buildMode||!valid||!ghost) return;
    const rec=SHIPS[idx], inv=ctx.inventory;
    // ★비용 = 오직 골드(목재 폐지, 사령관 2026-07-03). 부족하면 건조 불가.
    const haveG=inv?(inv.gold||0):Infinity;
    if(haveG<rec.gold){ toast('골드 부족 — '+rec.gold+' 필요 (보유 '+haveG+')'); return; }
    // ★건조 위치 = 항구(wharf) 기준으로 무조건 바다로 밀어냄(사령관). 항구 있으면 항구에서, 없으면 고스트에서.
    const _w = ctx.wharf && ctx.wharf.pos, dk = ctx.wharf && ctx.wharf.dock;
    const pos = dk ? freeDock(dk.x, dk.z) : toSea(_w?_w.x:ghost.position.x, _w?_w.z:ghost.position.z); exit();   // ★정박점(물속) 우선 + 점유 시 빈자리(SIM-B2)
    askName(async (name)=>{
      try{ await initShip(ctx, Object.assign({ spawn:pos, cannonStations:true }, rec.ship));
        // ★건조 직후 정박(사령관): 돛 접고 닻 내림 → 바람에 안 밀려 벽 처박힘 방지. 플레이어가 조타(Z)로 출항.
        try{ const bs=ctx.ship; if(bs){ bs.anchored=true; bs.furl=1; bs.sail=0; bs.speed=0; bs.yawVel=0; bs.boarded=false; } }catch(_){}
        try{ if(inv){ inv.addGold(-rec.gold); if(ctx.updHotbar)ctx.updHotbar(); } }catch(_){}   // ★골드만 차감(건조 성공 후)
        ctx.fleet.push({ id:'ship-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name, key:rec.key, bs:ctx.ship, x:pos.x, z:pos.z });   // stable id로 배별 보급 분리
        toast(''+name+' 건조 완료! 정박 중 — 조타(Z)로 출항');
        ctx.events.emit('shipBuilt', { name, key:rec.key, bs:ctx.ship });   // R2: 이벤트 버스
      }catch(e){ console.warn('[shipyard] 배 생성 실패',e&&e.message); toast('배 생성 실패: '+(e&&e.message)); }
    });
  }

  // ★즉시 건조(사령관 "배제작 누르자마자 바로 배이름짓기") — 고스트·좌클릭 없이 바로 이름 모달 → 항구 옆 열린 바다에 스폰.
  async function build(key){
    const rec=SHIPS.find(s=>s.key===key)||SHIPS[idx]; const inv=ctx.inventory;
    const _w=ctx.wharf&&ctx.wharf.pos;
    if(!_w){ toast('항구가 없어요 — 먼저 해안에 항구를 지으세요 (G)'); return; }
    const haveG=inv?(inv.gold||0):Infinity;
    if(haveG<rec.gold){ toast('골드 부족 — '+rec.gold+' 필요 (보유 '+haveG+')'); return; }
    const dk=ctx.wharf&&ctx.wharf.dock;                          // ★정박점(물속) 우선 — 항구가 물가 육지라 toSea가 실패해 배가 항구 밑 처박히던 버그(사령관)
    const pos = dk ? freeDock(dk.x, dk.z) : toSea(_w.x, _w.z, Math.max(28,(rec.ship.length||40)*0.7));   // ★점유 시 빈자리(SIM-B2)
    if(buildMode) exit();                                        // 혹시 고스트 모드였으면 정리
    askName(async (name)=>{
      try{ await initShip(ctx, Object.assign({ spawn:pos, cannonStations:true }, rec.ship));
        try{ const bs=ctx.ship; if(bs){ bs.anchored=true; bs.furl=1; bs.sail=0; bs.speed=0; bs.yawVel=0; bs.boarded=false; } }catch(_){}   // 건조 직후 정박
        try{ if(inv){ inv.addGold(-rec.gold); if(ctx.updHotbar)ctx.updHotbar(); } }catch(_){}
        ctx.fleet.push({ id:'ship-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name, key:rec.key, bs:ctx.ship, x:pos.x, z:pos.z });
        toast(''+name+' 건조 완료! 정박 중 — 조타(Z)로 출항');
        ctx.events.emit('shipBuilt', { name, key:rec.key, bs:ctx.ship });   // R2: 이벤트 버스
      }catch(e){ console.warn('[shipyard] 배 생성 실패',e&&e.message); toast('배 생성 실패: '+(e&&e.message)); }
    });
  }

  // 고스트 = 부두(wharf) 옆 바다, 카메라 방향 12m(위치 미세조정). 부두 기준이라 항상 보임 + 시점 유지.
  ctx.onUpdate(()=>{
    if(!buildMode||!ghost) return;
    const w=ctx.wharf&&ctx.wharf.pos, wl=ctx.water?ctx.water.level:0; if(!w){ valid=false; return; }
    const look=ctx.player.camLook||{x:0,z:1}, lx=look.x||0, lz=(look.z==null?1:look.z), ln=Math.hypot(lx,lz)||1;
    ghost.position.set(w.x+(lx/ln)*12, wl+1.0, w.z+(lz/ln)*12); ghost.rotation.y=Math.atan2(lx,lz);
    valid=true; hud();
  });
  ctx.renderer.domElement.addEventListener('mousedown', e=>{ if(e.button===0&&buildMode&&document.pointerLockElement===ctx.renderer.domElement) confirm(); });
  addEventListener('keydown', e=>{
    // ★K키 건조 폐지(사령관) — 건조는 오직 항구 관리 '배 관리 → 제작' 탭에서만.
    if(buildMode){ if(e.code==='Escape') exit(); else if(e.code==='BracketRight') cycle(1); else if(e.code==='BracketLeft') cycle(-1); }
  });

  // ★세이브 복원용 — 배 키로 재건(비용/이름/훅 없이 initShip만 재사용). save.js restore가 호출.
  async function rebuild(key, opts={}){
    const rec=SHIPS.find(s=>s.key===key); if(!rec){ console.warn('[shipyard] rebuild 미지원 키', key); return null; }
    const pos=toSea(opts.x||0, opts.z||0, Math.max(28,(rec.ship.length||40)*0.7));   // ★복원 배도 열린 바다로 보정(사령관 "다시 로그인하니 배가 땅에 박힘" — 옛 저장좌표가 해안이면 물 위로 밀어냄)
    try { await initShip(ctx, Object.assign({ spawn:pos, cannonStations:true }, rec.ship)); }
    catch(e){ console.warn('[shipyard] rebuild 실패', key, e&&e.message); return null; }
    if(ctx.ship && opts.durability!=null) ctx.ship.durability=opts.durability;
    try{ const bs=ctx.ship; if(bs){ bs.anchored=true; bs.furl=1; bs.sail=0; bs.speed=0; bs.yawVel=0; bs.boarded=false; } }catch(_){}   // ★복원 배도 정박(사령관 "배가 지 맘대로 감" — rebuild가 정박 안 해 바람에 표류하던 것)
    return ctx.ship;   // ctx.ship = 방금 재건한 배(save.js가 active를 마지막에 재건해 ctx.ship 지정)
  }

  let starterWreck=null;
  async function showStarterWreck(opts={}){
    if(starterWreck)return starterWreck;
    const rec=SHIPS.find(s=>s.key==='caravel')||SHIPS[0], at=opts.at||ctx.terrain?.spawn||ctx.player?.pos||{x:0,z:0};
    const pos=toSea(at.x,at.z,Math.max(30,(rec.ship.length||40)*0.7));
    const g=await loadGhost(rec);
    g.traverse(o=>{if(o.isMesh){o.material=new THREE.MeshStandardMaterial({color:0x55483c,roughness:1,metalness:0,transparent:true,opacity:.82});}});
    g.position.set(pos.x,(ctx.water?.level||0)-0.7,pos.z);g.rotation.z=-0.08;g.rotation.y=0.25;scene.add(g);
    starterWreck={group:g,pos,interactionAt:{x:pos.x,z:pos.z}};
    return starterWreck;
  }
  function clearStarterWreck(){if(starterWreck?.group)scene.remove(starterWreck.group);starterWreck=null;}

  // 신규 온보딩 전용: 항구/골드 없이 해안의 반파 캐러벨을 수리해 인수한다.
  // 수리재 차감과 exactly-once 판정은 questline 상태가 소유하며, 여기서는 기존 initShip 프로파일만 재사용한다.
  function acquireStarter(opts={}){
    const existing=(ctx.fleet||[]).find(f=>f&&f.onboardingStarter);
    if(existing) return Promise.resolve(existing);
    const rec=SHIPS.find(s=>s.key==='caravel')||SHIPS[0];
    const sp=opts.at || ctx.terrain?.spawn || ctx.player?.pos || {x:0,z:0};
    const pos=opts.wreckPos ? {x:opts.wreckPos.x,z:opts.wreckPos.z} : toSea(sp.x, sp.z, Math.max(30,(rec.ship.length||40)*0.7));
    return new Promise(resolve=>askName(async name=>{
      const oldWreck=starterWreck;
      try{
        clearStarterWreck();
        await initShip(ctx, Object.assign({ spawn:pos, cannonStations:true }, rec.ship));
        const bs=ctx.ship;
        if(bs){ bs.anchored=true; bs.furl=1; bs.sail=0; bs.speed=0; bs.yawVel=0; bs.boarded=false; }
        const fleetRec={ id:'ship-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),name, key:rec.key, bs, x:pos.x, z:pos.z, onboardingStarter:true };
        ctx.fleet.push(fleetRec);
        toast(name+' 수리 완료! 정박 중 — 조타(Z)로 출항');
        ctx.events.emit('starterShipAcquired', { name, key:rec.key, bs, fleetRec });
        resolve(fleetRec);
      }catch(e){ console.warn('[shipyard] 시작 배 수리 실패',e&&e.message); toast('배 수리 실패: '+(e&&e.message)); if(oldWreck?.group){scene.add(oldWreck.group);starterWreck=oldWreck;} resolve(null); }
    }));
  }

  // ★배 건조 상시 안내(사령관 #22) — 부두 근처면 "배 건조 — 항구 관리" 힌트. 튜토(questline)를 건너뛰고 섬에 와도 배 만드는 법을 알게.
  const _kHint=document.createElement('div');
  _kHint.style.cssText='position:fixed;left:50%;bottom:152px;transform:translateX(-50%);z-index:8;color:#aef0c8;font:700 13px Pretendard,system-ui,"Malgun Gothic";text-shadow:0 1px 3px #000;pointer-events:none;display:none';
  _kHint.innerHTML='배 건조 <span style="opacity:.6">— 항구 <b>[E]</b> → 배 관리 → 제작</span>';
  document.body.appendChild(_kHint);
  ctx.onUpdate(()=>{
    if(buildMode){ if(_kHint.style.display!=='none') _kHint.style.display='none'; return; }
    const w=ctx.wharf&&ctx.wharf.pos, pp=ctx.player&&ctx.player.pos;
    const near = w && pp && Math.hypot(w.x-pp.x, w.z-pp.z)<32 && !(ctx.ship&&ctx.ship.boarded) && !ctx.noPointerLock;
    _kHint.style.display = near ? 'block' : 'none';
  });

  ctx.shipyard={ enter, exit, cycle, build, SHIPS, buildMode:()=>buildMode, rebuild, showStarterWreck, clearStarterWreck, acquireStarter,
    _dbg:()=>({ buildMode, hasGhost:!!ghost, hasWharf:!!(ctx.wharf&&ctx.wharf.pos), valid, idx }),
    _forceConfirm(){ valid=true; return confirm(); } };   // 디버그: 좌클릭 없이 건조 강제(검증용)
  console.log('[shipyard] 배 제작(드라이독) — K키 건설 모드 / [ ]전환 / 부두 근처 좌클릭. 배', SHIPS.map(s=>s.key).join('/'));
  return ctx.shipyard;
}
