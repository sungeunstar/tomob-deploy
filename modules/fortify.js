// fortify.js — 블록 방어 축성(P2b: 티어). BlockBits 블록을 그리드에 쌓아 성벽·타워.
//   렌더=타입별 InstancedMesh(1드로우콜) · 물리=static Rapier 콜라이더(fixed=거의 공짜, _blockspike 검증).
//   블록 HP → ctx.fortify.damage(pos,dmg,r)로 파괴(공성) → 인스턴스 숨김 + 제한 파편(sleep, 상한).
//   티어: 나무방책(싸고 약함) / 돌벽(중간) / 철벽(비쌈 튼튼). 퀵슬롯 선택 → 배치모드(조준·클릭 스택).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const _B='/KayKit_BlockBits_1.0_FREE/KayKit_BlockBits_1.0_FREE/Assets/gltf/';
const TYPES={
  woodblock:{ url:_B+'wood.gltf',  hp:15 },   // 나무방책 — 싸고 약함
  wallblock:{ url:_B+'stone.gltf', hp:30 },   // 돌벽 — 중간
  ironblock:{ url:_B+'metal.gltf', hp:65 },   // 철벽 — 비쌈·튼튼
  cannonblock:{ url:_B+'metal.gltf', hp:50, turret:true },   // 🔫 포대 — 상단에 자동 대포(타워 위에 얹음)
};
const BLKNAME={ woodblock:'나무방책', wallblock:'돌벽', ironblock:'철벽', cannonblock:'포대' };   // 🔨 철거 토스트용
const CAP=4096, DEBRIS_CAP=200;
const TUR_RANGE=48, TUR_RELOAD=2.6;   // 포대: 사거리·재장전(높이 얹을수록 아치가 멀리 — claim 포좌와 동일 원리)

export async function initFortify(ctx){
  const { scene, camera } = ctx;
  const collide = ctx.terrain && ctx.terrain.collide;
  const groundAt = (x,z,fromY)=> ctx.terrain ? ctx.terrain.groundAt(x,z,fromY) : 0;
  if(!scene||!camera||!collide){ console.warn('[fortify] scene/camera/terrain 없음'); return; }

  const _hide=new THREE.Object3D(); _hide.scale.setScalar(0.0001); _hide.updateMatrix();
  let BW=2,BH=2,BD=2;   // 블록 치수(모든 BlockBits 동일 큐브 — 첫 로드로 확정)

  // ── 타입별 지오/머티/인스턴스메시 ──
  const T={}; const loader=new GLTFLoader();
  for(const id in TYPES){ const g=await loader.loadAsync(TYPES[id].url);
    let geo=null, mat=null; g.scene.traverse(m=>{ if(m.isMesh&&!geo){ geo=m.geometry; mat=m.material; } });
    geo.computeBoundingBox(); const s=new THREE.Vector3(); geo.boundingBox.getSize(s); BW=s.x||BW; BH=s.y||BH; BD=s.z||BD;
    const inst=new THREE.InstancedMesh(geo, mat, CAP); inst.count=0; inst.castShadow=inst.receiveShadow=true; inst.frustumCulled=false;   // ★최적화(사령관 "최적화"): count=CAP(4096)면 블록 0개여도 GPU가 고폴리 4096개 처리(≈15M삼각형). 실제 배치 수만 그림.
    for(let i=0;i<CAP;i++) inst.setMatrixAt(i,_hide.matrix); inst.instanceMatrix.needsUpdate=true; scene.add(inst); collide.push(inst);
    T[id]={ geo, mat, inst, hp:TYPES[id].hp, freeIdx:[], nextIdx:0 };
  }

  const blocks=new Map();     // "ix,layer,iz" -> {t, idx, hp, body, ix,iz,layer}
  const columns=new Map();    // "ix,iz" -> {baseY, top}
  const _m=new THREE.Object3D(), _v=new THREE.Vector3();
  function allocIdx(t){ return t.freeIdx.length? t.freeIdx.pop() : (t.nextIdx<CAP? t.nextIdx++ : -1); }
  function setInst(t,idx,x,y,z){ _m.position.set(x,y,z); _m.rotation.set(0,0,0); _m.scale.setScalar(1); _m.updateMatrix(); t.inst.setMatrixAt(idx,_m.matrix); t.inst.instanceMatrix.needsUpdate=true; if(idx+1>t.inst.count) t.inst.count=idx+1; }   // ★count=실제 배치 상한(고폴리 인스턴스 낭비 제거)
  function hideInst(t,idx){ t.inst.setMatrixAt(idx,_hide.matrix); t.inst.instanceMatrix.needsUpdate=true; }
  function addCollider(x,y,z){ if(!(ctx.RAPIER&&ctx.world)) return null;
    const b=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x,y,z));
    ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(BW/2,BH/2,BD/2), b); return b; }

  // ── 조준 → 대상 복셀(컬럼 위 스택) ──
  const rc=new THREE.Raycaster();
  function aimHit(){ rc.setFromCamera({x:0,y:0}, camera); const hs=rc.intersectObjects(collide,true); return hs.length? hs[0].point : null; }
  function targetVoxel(){ const pt=aimHit(); if(!pt) return null;
    const ix=Math.round(pt.x/BW), iz=Math.round(pt.z/BD), ck=ix+','+iz;
    let col=columns.get(ck), base;
    if(col) base=col.baseY; else { base=groundAt(ix*BW, iz*BD, pt.y+4); if(base<=0.6) return {invalid:true, pos:new THREE.Vector3(ix*BW,1,iz*BD)}; }
    const layer=col? col.top+1 : 0;
    return { ix, iz, layer, base, ck, pos:new THREE.Vector3(ix*BW, base+layer*BH+BH/2, iz*BD) };
  }
  // 포탄·투사체 착탄 판정(O(1)) — 그 지점에 블록 있으면 true. cannon.js가 공성 시 호출.
  function solidAt(wp){ const ix=Math.round(wp.x/BW), iz=Math.round(wp.z/BD); const col=columns.get(ix+','+iz); if(!col) return false;
    const layer=Math.round((wp.y-col.baseY-BH/2)/BH); return layer>=0 && blocks.has(ix+','+layer+','+iz); }
  // 몸통 높이대에서 수평 1.4m 내 가장 가까운 블록(습격병 벽 공성용). {key,cx,cy,cz} 또는 null.
  function nearestBlock(x,y,z){ const bix=Math.round(x/BW), biz=Math.round(z/BD); let best=null, bd=1.96;   // 1.4^2
    for(let dx=-1;dx<=1;dx++) for(let dz=-1;dz<=1;dz++){ const ix=bix+dx, iz=biz+dz; const col=columns.get(ix+','+iz); if(!col) continue;
      for(let L=0;L<=col.top;L++){ const key=ix+','+L+','+iz; if(!blocks.has(key)) continue;
        const cy=col.baseY+L*BH+BH/2; if(cy < y-BH*0.6 || cy > y+3.5) continue;   // 몹 발밑~머리 높이대 블록만(슬로프 견고)
        const cx=ix*BW, cz=iz*BD, hd=(cx-x)*(cx-x)+(cz-z)*(cz-z); if(hd<bd){ bd=hd; best={key,cx,cy,cz}; } } }
    return best; }

  // ── 배치(현재 타입) ──
  let curType='wallblock';
  const itemOf=id=>id;   // 아이템 id = 타입 id(인벤 count)
  function placeAt(tv){ if(!tv||tv.invalid) return false;
    const key=tv.ix+','+tv.layer+','+tv.iz; if(blocks.has(key)) return false;
    const item=itemOf(curType); if(ctx.inventory && ctx.inventory.count(item)<1) return false;
    const t=T[curType]; const idx=allocIdx(t); if(idx<0) return false;
    setInst(t, idx, tv.pos.x, tv.pos.y, tv.pos.z);
    const body=addCollider(tv.pos.x, tv.pos.y, tv.pos.z);
    blocks.set(key,{t:curType, idx, hp:t.hp, body, ix:tv.ix, iz:tv.iz, layer:tv.layer});
    let col=columns.get(tv.ck); if(!col){ col={baseY:tv.base, top:-1}; columns.set(tv.ck,col); } col.top=Math.max(col.top,tv.layer);
    if(TYPES[curType].turret){ const bar=makeBarrel(); bar.position.set(tv.pos.x, tv.pos.y+BH/2, tv.pos.z); scene.add(bar);
      turrets.push({x:tv.pos.x, y:tv.pos.y+BH/2+0.9, z:tv.pos.z, bar, reloadT:0, owner:'player'}); }   // 🔫 포대 상단 대포(내 소유=몹만 조준)
    if(ctx.inventory){ ctx.inventory.remove(item,1); if(ctx.updHotbar)ctx.updHotbar();
      if(ctx.inventory.count(item)<1) exit(); }
    return true;
  }

  // ── 비대화형 배치(NPC·월드 생성용) — 조준·인벤 미개입, 특정 월드좌표에 직접 찍음 ──
  //   기존 blocks/columns/inst/addCollider 인프라 그대로 재사용(새 풀 금지). owner 지정 = 적 소유(망치 철거 불가·함포로만).
  //   cannonblock이면 capture.js towersAlive 게이트 호환 핸들 {hp,dead,x,y,z} 반환(damage로 hp/dead 실시간 동기화).
  function placeStatic(type, x, baseY, z, opts={}){
    const t=T[type]; if(!t) return null;
    const ix=Math.round(x/BW), iz=Math.round(z/BD), layer=opts.layer|0, ck=ix+','+iz;
    const key=ix+','+layer+','+iz; if(blocks.has(key)) return null;
    let col=columns.get(ck); const base = col ? col.baseY : baseY;   // 같은 컬럼이면 기존 baseY로 높이 일치
    const px=ix*BW, py=base+layer*BH+BH/2, pz=iz*BD;
    const idx=allocIdx(t); if(idx<0) return null;
    setInst(t, idx, px, py, pz);
    const body=addCollider(px, py, pz);
    const rec={ t:type, idx, hp:t.hp, body, ix, iz, layer, owner:opts.owner||'enemy' };
    blocks.set(key, rec);
    if(!col){ col={baseY:base, top:-1}; columns.set(ck,col); } col.top=Math.max(col.top, layer);
    if(TYPES[type].turret){ const bar=makeBarrel(); bar.position.set(px, py+BH/2, pz); scene.add(bar);
      turrets.push({x:px, y:py+BH/2+0.9, z:pz, bar, reloadT:0, owner:opts.owner||'enemy'});   // 🔫 자동 대포 딸려옴(적 소유=배도 조준)
      const handle={ hp:t.hp, dead:false, x:px, y:py, z:pz }; rec.handle=handle; return handle; }   // 게이트 호환 살아있는 참조
    return rec;
  }

  // ── 🔫 포대(자동 대포) ──
  const turrets=[];   // {x,y,z, bar, reloadT}
  const _turMat=new THREE.MeshStandardMaterial({color:0x2a2f35, metalness:0.7, roughness:0.45});
  function makeBarrel(){ const g=new THREE.Group();
    const base=new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.9,0.8,14), _turMat); base.position.y=0.45; base.castShadow=true; g.add(base);   // 회전 받침
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(0.38,0.5,3.0,16), _turMat); barrel.rotation.x=Math.PI/2-0.22; barrel.position.set(0,1.15,1.25); barrel.castShadow=true; g.add(barrel);   // 포신(살짝 위로=아치)
    const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.52,0.35,16), _turMat); muzzle.rotation.x=Math.PI/2-0.22; muzzle.position.set(0,1.78,2.55); g.add(muzzle);   // 포구 링
    return g; }

  // ── 파편(동적, 상한, sleep) ──
  const debris=[];
  function spawnDebris(typeId,x,y,z){ if(!(ctx.RAPIER&&ctx.world)) return; const t=T[typeId];
    const body=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.dynamic().setTranslation(x,y,z)
      .setLinvel((Math.random()-0.5)*4,(Math.random()*3+1.5),(Math.random()-0.5)*4)
      .setAngvel({x:Math.random()*3,y:Math.random()*3,z:Math.random()*3}));
    ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(BW/2,BH/2,BD/2).setDensity(1.1).setRestitution(0.2), body);
    const mesh=new THREE.Mesh(t.geo,t.mat); mesh.castShadow=true; scene.add(mesh); debris.push({body,mesh});
    while(debris.length>DEBRIS_CAP){ const d=debris.shift(); scene.remove(d.mesh); try{ctx.world.removeRigidBody(d.body);}catch(_){} }
  }
  function cleanupTurret(rec){ if(!TYPES[rec.t].turret) return; const cx=rec.ix*BW, cz=rec.iz*BD;   // 🔫 포대 블록 제거 시 상단 배럴+turrets 항목 정리(안 하면 유령 포대가 계속 발사)
    for(let i=turrets.length-1;i>=0;i--){ const tr=turrets[i]; if(Math.abs(tr.x-cx)<0.2 && Math.abs(tr.z-cz)<0.2){ scene.remove(tr.bar); turrets.splice(i,1); } } }
  function _removeBlock(key,rec,refund){ const t=T[rec.t]; hideInst(t,rec.idx); t.freeIdx.push(rec.idx);
    if(rec.handle){ rec.handle.dead=true; rec.handle.hp=0; }   // 게이트 핸들 사망 반영(capture towersAlive)
    if(rec.body&&ctx.world){ try{ctx.world.removeRigidBody(rec.body);}catch(_){} }
    cleanupTurret(rec);
    const cx=rec.ix*BW, cy=(columns.get(rec.ix+','+rec.iz)?.baseY??0)+rec.layer*BH+BH/2, cz=rec.iz*BD;
    blocks.delete(key);
    const col=columns.get(rec.ix+','+rec.iz); if(col){ let tt=-1; for(let Lv=col.top;Lv>=0;Lv--){ if(blocks.has(rec.ix+','+Lv+','+rec.iz)){ tt=Lv; break; } } col.top=tt; if(tt<0) columns.delete(rec.ix+','+rec.iz); }
    spawnDebris(rec.t,cx,cy,cz);
    if(refund && ctx.inventory){ ctx.inventory.add(rec.t,1); if(ctx.updHotbar)ctx.updHotbar(); }   // 🔨 망치 철거 = 재료 1개 환급(공성 파괴는 환급 없음)
  }
  function destroyBlock(key,rec){ _removeBlock(key,rec,false); }   // 공성 파괴(대포·습격 — 환급 없음)
  // 🔨 망치 철거: 조준선 최근접 히트가 내 블록이면 부수고 재료 1개 환급. 벽 뒤(더 가까운 지형/딴 블록에 가림) 관통 방지.
  function demolishAimed(range=9){ rc.setFromCamera({x:0,y:0}, camera);
    const hs=rc.intersectObjects(collide,true); if(!hs.length) return false;
    const h=hs[0]; if(h.distance>range || h.instanceId==null) return false;
    let hitType=null; for(const id in T){ if(h.object===T[id].inst){ hitType=id; break; } }
    if(!hitType) return false;
    for(const [key,rec] of blocks){ if(rec.t===hitType && rec.idx===h.instanceId){
      if(rec.owner){ if(ctx.invui&&ctx.invui.toast) ctx.invui.toast('적 방어시설 — 함포로만 부술 수 있다'); return false; }   // 🏰 적 소유 = 망치 철거 불가(AC式)
      _removeBlock(key,rec,true); ctx.sound?.play?.('destroy');
      if(ctx.invui&&ctx.invui.toast) ctx.invui.toast(''+(BLKNAME[rec.t]||rec.t)+' 철거 (+1)');
      return true; } }
    return false;
  }
  // ── 공성 데미지 API(대포·습격이 호출) ──
  function damage(worldPos, dmg=15, radius=BW*0.9){ const r2=radius*radius; let hit=0;
    for(const [key,rec] of [...blocks]){ const cx=rec.ix*BW, cy=(columns.get(rec.ix+','+rec.iz)?.baseY??0)+rec.layer*BH+BH/2, cz=rec.iz*BD;
      const dx=cx-worldPos.x, dy=cy-worldPos.y, dz=cz-worldPos.z; if(dx*dx+dy*dy+dz*dz>r2) continue;
      rec.hp-=dmg; if(rec.handle) rec.handle.hp=rec.hp; hit++; if(rec.hp<=0) destroyBlock(key,rec); }   // 핸들 hp 동기화(capture 게이트 폴링)
    return hit;
  }

  // ── 고스트 ──
  let placeMode=false;
  const ghost=new THREE.Mesh(T[curType].geo, T[curType].mat.clone()); ghost.material.transparent=true; ghost.material.opacity=0.45; ghost.material.depthWrite=false; ghost.visible=false; scene.add(ghost);
  const G_OK=0x7fe08a, G_NO=0xe06a6a;
  function setGhostType(id){ ghost.geometry=T[id].geo; ghost.material.map=T[id].mat.map||null; ghost.material.needsUpdate=true; }
  function enter(){ placeMode=true; ghost.visible=true; }
  function exit(){ placeMode=false; ghost.visible=false; }
  function toggle(){ placeMode?exit():enter(); }
  function startPlace(id){ if(!T[id]) return false; curType=id; setGhostType(id); if(ctx.build&&ctx.build.mode)ctx.build.mode(false); enter(); return true; }

  addEventListener('keydown', e=>{ if(e.code==='KeyL' && document.pointerLockElement===ctx.renderer.domElement){ toggle(); } });
  // 🧱 블록 배치 = 우클릭(마인크래프트式). 꾹 누르면 쿨다운(0.13s)마다 연속 배치 — 조준 훑으면 벽이 쭉 세워짐. (던전 부품은 build.js 좌클릭·고스트 그대로)
  let _rmbHold=false, _placeCD=0;
  function _rmbDown(e){ if(placeMode && e.button===2 && document.pointerLockElement===ctx.renderer.domElement){ e.preventDefault(); _rmbHold=true; if(placeAt(targetVoxel())) _placeCD=0.13; } }
  ctx.renderer.domElement.addEventListener('pointerdown', _rmbDown);
  ctx.renderer.domElement.addEventListener('mousedown', _rmbDown);   // 멀티버튼 pointerdown 누락 폴백(placeAt 점유검사로 중복 무해)
  addEventListener('pointerup', e=>{ if(e.button===2) _rmbHold=false; });
  addEventListener('mouseup',   e=>{ if(e.button===2) _rmbHold=false; });

  ctx.onUpdate((dt)=>{ dt=dt||0.016; if(_placeCD>0) _placeCD-=dt;
    if(placeMode){ const tv=targetVoxel();
      if(tv&&!tv.invalid){ ghost.position.copy(tv.pos); ghost.visible=true; const key=tv.ix+','+tv.layer+','+tv.iz;
        const ok=!blocks.has(key) && (!ctx.inventory || ctx.inventory.count(itemOf(curType))>=1); ghost.material.color.setHex(ok?G_OK:G_NO);
        if(_rmbHold && ok && _placeCD<=0){ if(placeAt(tv)) _placeCD=0.13; }   // 우클릭 꾹 = 연속 배치(쿨다운 게이팅)
      } else ghost.visible=false;
    }
    for(const d of debris){ const t=d.body.translation(), q=d.body.rotation(); d.mesh.position.set(t.x,t.y,t.z); d.mesh.quaternion.set(q.x,q.y,q.z,q.w); }
    // 🏴 P3b: 어그로 습격병이 벽에 막히면 밀려나고 그 블록을 깎는다(벽 공성)
    if(ctx.monsters && blocks.size){ for(const mn of ctx.monsters){ if(mn.dead || !mn.aggro || !mn.grp) continue;
      const gp=mn.grp.position, nb=nearestBlock(gp.x, gp.y, gp.z); if(!nb) continue;
      const ddx=gp.x-nb.cx, ddz=gp.z-nb.cz, hd=Math.hypot(ddx,ddz)||0.001, keep=BW/2+0.55;
      if(hd<keep){ gp.x=nb.cx+ddx/hd*keep; gp.z=nb.cz+ddz/hd*keep; }   // 벽 면 밖으로 밀어냄(관통 방지)
      mn._wallCD=(mn._wallCD||0)-dt; if(mn._wallCD<=0){ mn._wallCD=(mn.def&&mn.def.atkCD)||1.2; damage(_v.set(nb.cx,nb.cy,nb.cz), 10, BW*0.6); }   // 벽 깎기(쿨다운)
    }}
    // 🔫 P2c: 포대 자동 조준·발사(사거리 내 최근접 어그로몹, 적 소유 포대는 플레이어 배도 표적). 높이 얹을수록 cannon 아치가 멀리 닿음.
    //   owner='player'(내가 세운 포대) → 몹만 조준(자기 배 오사 방지). owner!=='player'(점령 전 적 방벽) → 몹 + 플레이어 배 중 최근접.
    if(turrets.length){ for(const tr of turrets){ tr.reloadT-=dt;
      let best=null, bd=TUR_RANGE*TUR_RANGE, tx=0, ty=0, tz=0;
      if(ctx.monsters){ for(const mn of ctx.monsters){ if(mn.dead||!mn.aggro||!mn.grp) continue; const q=mn.grp.position; const dd=(q.x-tr.x)*(q.x-tr.x)+(q.z-tr.z)*(q.z-tr.z); if(dd<bd){ bd=dd; best=mn; tx=q.x; ty=(q.y||0)+1; tz=q.z; } } }
      if(tr.owner!=='player' && ctx.ship){ const sh=ctx.ship;   // 🏰 적 방벽 포대 = 플레이어 배도 조준(공성 쌍방향)
        if(sh.x!=null && sh.z!=null && (sh.durability==null || sh.durability>0)){
          const dd=(sh.x-tr.x)*(sh.x-tr.x)+(sh.z-tr.z)*(sh.z-tr.z);
          if(dd<bd){ bd=dd; best=sh; tx=sh.x; tz=sh.z; ty=(sh.mesh?sh.mesh.position.y:(ctx.water?ctx.water.level:0))+1.2; }
        }
      }
      if(best){ tr.bar.rotation.y=Math.atan2(tx-tr.x, tz-tr.z);
        if(tr.reloadT<=0){ tr.reloadT=TUR_RELOAD; if(ctx.cannon&&ctx.cannon.fire) ctx.cannon.fire(tr.x,tr.y,tr.z, tx,ty,tz); } }
    }}
  });

  ctx.fortify={ enter, exit, toggle, startPlace, placeAt, placeStatic, targetVoxel, demolishAimed, damage, solidAt, curType:()=>curType,
    count:()=>blocks.size, debrisCount:()=>debris.length, dims:()=>({BW,BH,BD}), isPlacing:()=>placeMode, types:Object.keys(TYPES) };
  console.log('[fortify] 축성 P2b — 티어 '+Object.keys(TYPES).join('/')+' · 블록 '+BW.toFixed(2)+'m³');
  return ctx.fortify;
}
