// destruct.js — 구조물 파괴(부서짐) 시스템. 21번 F-3 정본(three-pinata 보로노이 + Rapier 파편).
//   PoC(_destruct_test.html) 검증 방식을 모듈화. build.js 부재·claim.js 타워/항구가 등록해 쓴다.
//   ★ ctx.destruct.makeBreakable(mesh,{hp}) 로 "부술 수 있는 구조물" 등록 → 대포(cannon) 포탄 명중 시
//      hp 감소, 0이면 그 자리에 박스 프록시를 voronoi fracture → Rapier 파편이 물리로 흩어진다.
//   의존: ctx.world/ctx.RAPIER(physics.js) · ctx.cannon(포탄) · ctx.terrain.collide(보행 제거).
//        physics 없으면 파편 없이 "제거"만(비치명적).
import * as THREE from 'three';
import { DestructibleMesh, FractureOptions } from 'three-pinata';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (공성 포탄 데미지)

const FRAG_COUNT       = 12;    // 구조물당 파편 수(21번 F-3 타워 12~20)
const FRAG_LIFE        = 5.0;   // 파편 수명(초)
const FRAG_FADE        = 1.2;   // 마지막 페이드 구간
const MAX_LIVE_FRAGS   = 140;   // 동시 파편 상한(프레임 안전)
const MAX_DESTROY_PF   = 3;     // 프레임당 파괴 수 제한(21번 §7 동시≤3)
const CANNON_DMG       = BAL.structures.cannonShotDmg;    // ⚖️ balance.js (포탄 1발 데미지 · 타워 HP ≈ 3~4발)

export function initDestruct(ctx){
  const { scene } = ctx;
  const world = ctx.world, RAPIER = ctx.RAPIER;
  const breakables = [];   // { mesh, hp, maxHp, half, center, mat, inner, broken, onBreak }
  const liveFrags  = [];   // { mesh, body, life }
  if(!world) console.warn('[destruct] ctx.world(physics.js) 없음 — 파편 물리 비활성(파괴 시 제거만).');

  const innerMat = new THREE.MeshStandardMaterial({ color:0x5a4326, roughness:1.0, metalness:0.0 });   // 부서진 단면(속살)
  function pickMat(mesh){
    let c = 0x9a7b50;
    mesh.traverse(o=>{ if(o.isMesh && o.material && o.material.color) c = o.material.color.getHex(); });
    return new THREE.MeshStandardMaterial({ color:c, roughness:0.9, metalness:0.04 });
  }

  const fractureOptions = new FractureOptions({ fractureMethod:'voronoi', fragmentCount:FRAG_COUNT, voronoiOptions:{ mode:'3D' } });

  // ── 등록: mesh의 월드 bbox로 파편 박스 산출 ──
  function makeBreakable(mesh, { hp=30, mat, inner, onBreak, buoy=false }={}){
    if(!mesh) return null;
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const b = { mesh, hp, maxHp:hp, half:{ x:Math.max(0.2,size.x/2), y:Math.max(0.2,size.y/2), z:Math.max(0.2,size.z/2) },
      center, mat: mat||pickMat(mesh), inner: inner||innerMat, broken:false, onBreak, buoy };
    breakables.push(b); mesh.userData.breakable = b;
    return b;
  }

  function damage(b, dmg, impactPoint){
    if(!b || b.broken) return;
    b.hp -= dmg;
    if(b.hp <= 0) fracture(b, impactPoint || b.center.clone());
  }
  function hitMesh(mesh, dmg, impactPoint){ damage(mesh && mesh.userData && mesh.userData.breakable, dmg, impactPoint); }

  let destroyedPF = 0;
  function fracture(b, impactPoint){
    if(b.broken) return; b.broken = true;
    const i = breakables.indexOf(b); if(i>=0) breakables.splice(i,1);
    // 원본 제거 + 보행 충돌체에서 제거
    scene.remove(b.mesh);
    const ci = ctx.terrain && ctx.terrain.collide ? ctx.terrain.collide.indexOf(b.mesh) : -1;
    if(ci>=0) ctx.terrain.collide.splice(ci,1);
    if(b.onBreak){ try{ b.onBreak(); }catch(e){} }
    if(!world || destroyedPF>=MAX_DESTROY_PF) return;   // 물리 없으면/한도 초과면 제거만
    destroyedPF++;

    // 박스 프록시 voronoi fracture (build 부재는 복잡메시라 bbox 박스로 연출 — 21번 F-3 박스기반 보로노이)
    const geo = new THREE.BoxGeometry(b.half.x*2, b.half.y*2, b.half.z*2);
    const dm = new DestructibleMesh(geo, b.mat, b.inner);
    dm.position.copy(b.center);
    const local = impactPoint.clone().sub(b.center);
    fractureOptions.voronoiOptions = { mode:'3D', impactPoint:local, impactRadius:Math.max(b.half.x,b.half.y,b.half.z)*1.2 };
    let frags = [];
    try { frags = dm.fracture(fractureOptions); }
    catch(e){ console.warn('[destruct] fracture fail:', e&&e.message); geo.dispose(); return; }
    geo.dispose();

    for(const fr of frags){
      scene.add(fr); fr.castShadow = true;
      const body = spawnFragBody(fr, impactPoint);
      liveFrags.push({ mesh:fr, body, life:b.buoy?FRAG_LIFE*1.8:FRAG_LIFE, buoy:b.buoy });   // 부력 잔해는 더 오래 떠 있음
    }
    while(liveFrags.length > MAX_LIVE_FRAGS){ disposeFrag(liveFrags.shift()); }
    ctx.sound?.play?.('destroy');   // 구조물 파괴음 (통합 테이블)
  }

  // three-pinata 파편: geometry 원점정렬 + position=worldCenter. 그 자리에 dynamic body + 폭발 임펄스.
  function spawnFragBody(fr, impactPoint){
    fr.geometry.computeBoundingBox();
    const bb = fr.geometry.boundingBox, sz = bb.getSize(new THREE.Vector3());
    const c = fr.position.clone();
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setLinearDamping(0.25).setAngularDamping(0.5));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(0.05,sz.x/2), Math.max(0.05,sz.y/2), Math.max(0.05,sz.z/2))
        .setRestitution(0.06).setFriction(0.9), body);
    const away = c.clone().sub(impactPoint); const d = away.length()||1; away.multiplyScalar(1/d);
    const pw = 3.5 + Math.random()*3.5;
    body.applyImpulse({ x:(away.x*0.7)*pw + (Math.random()-0.5), y:(Math.abs(away.y)*0.4+0.8)*pw + 2, z:(away.z*0.7)*pw + (Math.random()-0.5) }, true);
    body.applyTorqueImpulse({ x:(Math.random()-0.5)*2.5, y:(Math.random()-0.5)*2.5, z:(Math.random()-0.5)*2.5 }, true);
    return body;
  }

  function disposeFrag(f){
    if(!f) return;
    scene.remove(f.mesh);
    if(f.mesh.geometry) f.mesh.geometry.dispose();
    if(f.body && world){ try{ world.removeRigidBody(f.body); }catch(e){} }
  }

  // ── 업데이트: 포탄 명중 감지 + 파편 물리 동기화/수명 ──
  ctx.onUpdate(dt=>{
    destroyedPF = 0;
    // 1) 대포 포탄 ↔ 구조물 충돌(AABB)
    if(ctx.cannon && ctx.cannon.projectiles && breakables.length){
      for(const pr of ctx.cannon.projectiles){
        const p = pr.mesh.position;
        for(const b of breakables){
          if(b.broken) continue;
          if(Math.abs(p.x-b.center.x) < b.half.x+0.4 && Math.abs(p.y-b.center.y) < b.half.y+0.4 && Math.abs(p.z-b.center.z) < b.half.z+0.4){
            damage(b, CANNON_DMG, p.clone());
            pr.t = 0;   // 포탄 소멸(다음 cannon 업데이트에서 제거)
            break;
          }
        }
      }
    }
    // 2) 파편: Rapier body → mesh 동기화 + 수명/페이드
    const WL = ctx.water ? (ctx.water.level||0) : null;
    for(let i=liveFrags.length-1; i>=0; i--){
      const f = liveFrags[i];
      // 부력: 물리 바닥 없는 바다에서 파편이 가라앉아 사라지는 문제 → 수면(WL)에서 떠 잔해로 남김
      if(f.buoy && f.body && WL!=null){ const t=f.body.translation();
        if(t.y < WL){ const lv=f.body.linvel();
          f.body.setTranslation({ x:t.x, y:WL, z:t.z }, true);
          f.body.setLinvel({ x:lv.x*0.55, y:Math.max(0, lv.y*0.15), z:lv.z*0.55 }, true);   // 수평 감쇠 + 하강 차단(수면 부유)
          f.body.setAngvel({ x:0, y:f.body.angvel().y*0.6, z:0 }, true);                       // 수면에선 평평하게 떠 흔들림 최소
        } }
      if(f.body){ const t=f.body.translation(), q=f.body.rotation();
        f.mesh.position.set(t.x,t.y,t.z); f.mesh.quaternion.set(q.x,q.y,q.z,q.w); }
      f.life -= dt;
      if(f.life < FRAG_FADE){ const op = Math.max(0, f.life/FRAG_FADE);
        f.mesh.traverse(o=>{ if(o.material){ o.material.transparent=true; o.material.opacity=op; } }); }
      if(f.life <= 0){ disposeFrag(f); liveFrags.splice(i,1); }
    }
  });

  ctx.destruct = { makeBreakable, damage, hitMesh, breakables, liveFrags,
    stat:()=>({ breakable:breakables.length, frags:liveFrags.length }),
    _debugHit(mesh, dmg=999){ hitMesh(mesh, dmg, (mesh.userData.breakable&&mesh.userData.breakable.center.clone())||new THREE.Vector3()); } };
  console.log('[destruct] 파괴 시스템 등록 — three-pinata voronoi + Rapier 파편. world=', !!world);
  return ctx.destruct;
}
