// raidship.js — 습격선 접근 연출 (Phase 5 배 접근). 습격(raid.js) 시 적 종족의 배가 해안으로 다가와 상륙시킴.
//   ★풀 해전(navalcombat)이 아니라 가벼운 "프롭 배": 먼바다서 등장 → 해안으로 항해(예고시간) → 상륙(습격병 스폰 훅) → 정박 →
//     격퇴 시 격침(가라앉음) / 상실 시 퇴각.
//   콘센트: ctx.scene/water/terrain 읽기만. 이 파일만 수정.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SHIP = '/obj/queen-annes-revenge/optimized.glb';   // 해적 갤리온(습격선)
const SHIP_LEN = 22;   // 정규화 길이(m)

export function initRaidship(ctx){
  const { scene } = ctx;
  let proto=null;
  (async ()=>{                                  // ★optimized.glb = DRACO 압축 → DRACOLoader 필수(ship.js 패턴)
    const loader = new GLTFLoader();
    try { const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
      const draco = new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco);
    } catch(e){ console.warn('[raidship] DRACO 로더 실패', e&&e.message); }
    loader.load(SHIP, g=>{
      const s=g.scene; const box=new THREE.Box3().setFromObject(s), sz=new THREE.Vector3(); box.getSize(sz);
      s.scale.setScalar(SHIP_LEN/(Math.max(sz.x,sz.z)||1));
      s.traverse(o=>{ if(o.isMesh){ o.castShadow=true; } });
      proto=s; console.log('[raidship] 습격선 모델 로드');
    }, undefined, e=>console.warn('[raidship] 모델 로드 실패', e&&e.message));
  })();

  const wl = ()=> ctx.water ? (ctx.water.level||0) : 0;
  const groundY = (x,z)=> ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0;
  let active=null;   // { group, from, to, t, dur, phase, onLanded, landed, bob, landPt }

  // 섬에서 바다 방향(외해) 찾기 — 중간(45m)·먼(80m) 지점이 물인 방향 우선, 없으면 먼 지점만 물이어도 채택.
  function seaDir(island){
    const water=(x,z)=> groundY(x,z) <= wl()+0.5;
    for(let i=0;i<16;i++){ const a=i/16*Math.PI*2, dx=Math.cos(a), dz=Math.sin(a);
      if(water(island.x+dx*45, island.z+dz*45) && water(island.x+dx*80, island.z+dz*80)) return { dx, dz }; }
    for(let i=0;i<16;i++){ const a=i/16*Math.PI*2, dx=Math.cos(a), dz=Math.sin(a);
      if(water(island.x+dx*80, island.z+dz*80)) return { dx, dz }; }
    return null;
  }

  // 습격선 접근 시작. opts:{ dur(항해 초), onLanded(landPt=>) }
  function approach(island, opts={}){
    if(active){ scene.remove(active.group); active=null; }
    const dir = seaDir(island);
    if(!proto || !dir){ if(opts.onLanded) opts.onLanded({ x:island.x, z:island.z }); return null; }   // 바다 없음/미로드 → 상륙만
    const ship = proto.clone(true);
    const from = { x:island.x+dir.dx*92, z:island.z+dir.dz*92 };   // 먼바다
    const land = { x:island.x+dir.dx*24, z:island.z+dir.dz*24 };   // 해안 앞(정박)
    ship.position.set(from.x, wl(), from.z);
    ship.rotation.y = Math.atan2(-dir.dx, -dir.dz);   // 뱃머리 = 섬 향함
    scene.add(ship);
    active = { group:ship, from, to:land, t:0, dur:Math.max(4, opts.dur||12), phase:'in', onLanded:opts.onLanded, landed:false, bob:Math.random()*6, landPt:land };
    return active;
  }
  function depart(sink){ if(!active) return; active.phase = sink?'sink':'out'; active.t=0; }

  ctx.onUpdate(dt=>{
    if(!active) return; const s=active, g=s.group; s.t+=dt; s.bob+=dt;
    const bobY = Math.sin(s.bob*1.4)*0.28, roll = Math.sin(s.bob*1.1)*0.03;
    if(s.phase==='in'){
      const u=Math.min(1, s.t/s.dur), e=u<0.5?2*u*u:1-Math.pow(-2*u+2,2)/2;   // ease
      g.position.set(s.from.x+(s.to.x-s.from.x)*e, wl()+bobY, s.from.z+(s.to.z-s.from.z)*e); g.rotation.z=roll;
      if(u>=1){ s.phase='anchored'; s.t=0; if(!s.landed){ s.landed=true; if(s.onLanded) try{ s.onLanded(s.landPt); }catch(_){} } }
    } else if(s.phase==='anchored'){ g.position.y=wl()+bobY; g.rotation.z=roll; }
    else if(s.phase==='out'){ const u=Math.min(1, s.t/9), e=u*u;
      g.position.set(s.to.x+(s.from.x-s.to.x)*e, wl()+bobY, s.to.z+(s.from.z-s.to.z)*e); g.rotation.z=roll;
      if(u>=1){ scene.remove(g); active=null; } }
    else if(s.phase==='sink'){ g.position.y -= dt*1.3; g.rotation.z += dt*0.35; g.rotation.x += dt*0.12;
      if(g.position.y < wl()-9){ scene.remove(g); active=null; } }
  });

  ctx.raidship = { approach, depart, isActive:()=>!!active, phase:()=>active&&active.phase,
    status:()=> active ? { phase:active.phase, t:+active.t.toFixed(1), dur:active.dur, landed:active.landed } : null };
  console.log('[raidship] 습격선 접근 연출 등록 — 해적 갤리온이 해안으로 항해→상륙→퇴각/격침.');
  return ctx.raidship;
}
