// outpost.js — 🚩 거점 깃발 (팰월드式 베이스). 사령관 확정 2026-08-07.
//   깃발(기본재료 제작) → 퀵슬롯 → 섬 아무 곳에나 설치 → 그 지점 중심 원형 반경이 내 거점.
//   반경 경계에 라인이 보이고, 그 안에서만 거점 건물을 짓는다. 섬당 1개(탐험 동기).
//   거점 레벨업(골드+토모브의 영혼+평판 문턱) → 설치 가능한 깃발 수가 늘어난다.
//
//   [기존 시스템 재사용 — 새 데이터 모델 만들지 않음]
//     거점 레코드 = 기존 ctx.claimed[] 엔트리 그대로({x,z,name,r,owner,buildings,growth}).
//       → settlement.js(건물·성장 Lv), empire.js(목록 UI), save.js(저장)가 이미 이 배열을 읽는다.
//     차이는 "항구 게이지를 채워 점령"(claim.js) 대신 "깃발을 꽂아 즉시 거점화"라는 진입 경로뿐.
//     ★settlement.anchorOf가 island.dockPoint(항구 정박점) 기준이라, 깃발 거점은 dockPoint 없이 만들어
//       island.x/z(=깃발 위치)가 그대로 앵커가 된다 — 슬롯 링이 깃발 주위에 깔린다.
//
//   설치 패턴 = campfire.js(자유설치 프롭)와 동일: 퀵슬롯 선택 → 지면 고스트 → 좌클릭 확정.
//   수치 SSOT = BAL.outpost (balance.js 한 곳) — [[voyage-balance-ssot]].
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BAL } from '/tomob-deploy/modules/balance.js';
import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';

const FLAG_MODEL = encodeURI('/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Castle Kit/Models/GLB format/flag.glb');
const FLAG_H = 5.2;            // 깃대 목표 높이(m) — 멀리서도 내 거점이 보이게 랜드마크 크기
const RING_SEG = 96;           // 경계 링 분할 수(지형 따라 샘플링)
const RING_LIFT = 0.35;        // 지면에서 살짝 띄움(z-fighting 방지)
const RING_COL = 0xf0d9a8;     // 경계선 색(퀘스트 트래커와 같은 골드 톤)

export async function initOutpost(ctx){
  const { scene, camera } = ctx;
  const O = () => BAL.outpost;
  const toast = (t, accent='gold') => { try{ ukToast(t, { accent, ms:2600 }); }catch(_){} };

  // ── 깃발 프로토타입 ──
  let proto = null;
  try{
    const g = await new GLTFLoader().loadAsync(FLAG_MODEL);
    proto = g.scene;
    let bb = new THREE.Box3().setFromObject(proto);
    const sz = bb.getSize(new THREE.Vector3());
    proto.scale.setScalar(FLAG_H / (sz.y || 1));
    bb = new THREE.Box3().setFromObject(proto);
    proto.position.y = -bb.min.y;                       // 바닥 y=0 정규화(설치 좌표에 그대로 앉힘)
    proto.traverse(o=>{ if(o.isMesh){ o.castShadow = true;
      const ms = Array.isArray(o.material)?o.material:[o.material];
      ms.forEach(m=>{ if(m && m.map) m.map.colorSpace = THREE.SRGBColorSpace; }); } });
  }catch(e){ console.warn('[outpost] 깃발 모델 로드 실패', e && e.message); }

  // ── 상태 ──
  //   flags[] = 설치된 깃발의 시각물 {grp, ring, band, island}. 거점 데이터 자체는 ctx.claimed가 소유.
  const flags = [];
  let slots = O().startSlots|0;      // 현재 설치 가능한 거점 수(레벨업으로 증가)

  const claimedList = () => (ctx.claimed || []);
  const myOutposts  = () => claimedList().filter(c => c && c.owner === 'player' && c.byFlag);

  // ── 🔵 경계 시각화: 지형을 따라가는 링 라인 + 낮은 반투명 벽(팰월드 베이스 경계) ──
  function makeBoundary(cx, cz, R){
    const pts = [], bandPos = [];
    const wl = ctx.water ? ctx.water.level : 0;
    for(let i=0; i<=RING_SEG; i++){
      const a = (i/RING_SEG) * Math.PI*2;
      const x = cx + Math.cos(a)*R, z = cz + Math.sin(a)*R;
      const gy = ctx.terrain ? ctx.terrain.groundAt(x, z, 5000) : 0;
      const y = (gy > wl + 0.2 ? gy : wl) + RING_LIFT;      // 바다로 넘어간 구간은 수면에 눕힘
      pts.push(new THREE.Vector3(x, y, z));
      if(i < RING_SEG) bandPos.push(x, y, z, x, y + 2.2, z);  // 벽 세그먼트 하단/상단
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color:RING_COL, transparent:true, opacity:0.85, depthWrite:false })
    );
    ring.renderOrder = 3;

    // 반투명 벽 — 링을 따라 세운 스트립(경계가 "면"으로도 읽히게). 위로 갈수록 투명.
    const g = new THREE.BufferGeometry();
    const verts = [], idx = [], alpha = [];
    for(let i=0; i<RING_SEG; i++){
      const b = i*6;
      verts.push(bandPos[b], bandPos[b+1], bandPos[b+2], bandPos[b+3], bandPos[b+4], bandPos[b+5]);
      alpha.push(0.30, 0.0);
    }
    for(let i=0; i<RING_SEG; i++){
      const a0 = i*2, a1 = i*2+1, b0 = ((i+1)%RING_SEG)*2, b1 = ((i+1)%RING_SEG)*2+1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('aAlpha',   new THREE.Float32BufferAttribute(alpha, 1));
    g.setIndex(idx);
    const bandMat = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, side:THREE.DoubleSide,
      uniforms:{ uCol:{ value:new THREE.Color(RING_COL) } },
      vertexShader:`attribute float aAlpha; varying float vA;
        void main(){ vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:`uniform vec3 uCol; varying float vA;
        void main(){ gl_FragColor=vec4(uCol, vA); }`,
    });
    const band = new THREE.Mesh(g, bandMat);
    band.renderOrder = 2;
    return { ring, band };
  }
  function disposeBoundary(b){
    if(!b) return;
    for(const o of [b.ring, b.band]){ if(!o) continue;
      scene.remove(o);
      try{ o.geometry && o.geometry.dispose(); }catch(_){}
      try{ o.material && o.material.dispose(); }catch(_){}
    }
  }

  // ── 설치 가능 판정 ──
  //   ① 육지(수면 위) ② 같은 섬에 이미 내 거점 없음 ③ 남은 거점 슬롯 있음 ④ 다른 거점과 최소 간격
  function canPlaceAt(x, z){
    const wl = ctx.water ? ctx.water.level : 0;
    const gy = ctx.terrain ? ctx.terrain.groundAt(x, z, 5000) : 0;
    if(gy <= wl + 0.6) return { ok:false, reason:'바다 위에는 거점을 세울 수 없습니다' };

    const mine = myOutposts();
    if(mine.length >= slots)
      return { ok:false, reason:`거점 한도 ${mine.length}/${slots} — 거점을 확장해야 더 세울 수 있습니다` };

    // 섬당 1개 — islands 레지스트리로 "같은 섬" 판정(등록 전이면 최소 간격으로 폴백).
    const isle = ctx.islands && ctx.islands.at ? ctx.islands.at(x, z) : null;
    if(isle){
      for(const c of mine){ if(c.isleId && c.isleId === isle.id)
        return { ok:false, reason:`이 섬에는 이미 거점이 있습니다 (${c.name})` }; }
    }
    for(const c of mine){
      if(Math.hypot(c.x - x, c.z - z) < O().minGap)
        return { ok:false, reason:`다른 거점과 너무 가깝습니다 (최소 ${O().minGap}m)` };
    }
    return { ok:true, isle, groundY:gy };
  }

  // ── 거점 생성(설치 확정 / 세이브 복원 공용) ──
  function spawnOutpost(x, z, opts={}){
    const gy = opts.groundY != null ? opts.groundY
             : (ctx.terrain ? ctx.terrain.groundAt(x, z, 5000) : 0);
    const grp = new THREE.Group();
    grp.position.set(x, gy, z);
    if(proto) grp.add(proto.clone(true));
    scene.add(grp);

    const R = O().radius;
    const b = makeBoundary(x, z, R);
    scene.add(b.ring); scene.add(b.band);

    // 거점 데이터 = 기존 claimed 엔트리 형식(settlement/empire/save가 그대로 소비)
    const isle = opts.isle || (ctx.islands && ctx.islands.at ? ctx.islands.at(x, z) : null);
    let island = opts.island || null;
    if(!island){
      island = {
        x, z, r:R, owner:'player', byFlag:true,
        name: opts.name || (isle && isle.name ? isle.name + ' 거점' : '거점 ' + (myOutposts().length + 1)),
        isleId: isle ? isle.id : null,
        buildings: [], towers: [], hasHarbor:false,
      };
      claimedList().push(island);
      ctx.claimReg = island;
    }
    const rec = { grp, ring:b.ring, band:b.band, island, x, z, r:R };
    flags.push(rec);
    if(ctx.events) ctx.events.emit('outpostPlaced', island);
    return rec;
  }

  // ── 배치 모드(퀵슬롯 'banner' 선택 → 지면 고스트 → 좌클릭) ──
  let placing = false, ghost = null, ghostRing = null, ghostOK = false;
  const _rc = new THREE.Raycaster(), _fwd = new THREE.Vector3();
  function groundMeshes(){
    return (ctx.environment && ctx.environment.groundMeshes) || (ctx.terrain && ctx.terrain.collide) || [];
  }
  function aimGround(){
    camera.getWorldDirection(_fwd); _rc.set(camera.position, _fwd); _rc.far = 80;
    const hit = _rc.intersectObjects(groundMeshes(), true);
    return hit.length ? hit[0].point : null;
  }
  function makeGhost(){
    if(ghost) return;
    ghost = proto ? proto.clone(true) : new THREE.Group();
    ghost.traverse(o=>{ if(o.isMesh){
      o.material = o.material && o.material.clone ? o.material.clone() : o.material;
      if(o.material){ o.material.transparent = true; o.material.opacity = 0.55; o.material.depthWrite = false; }
    } });
    ghost.visible = false; scene.add(ghost);
    // 미리보기 링(반경 실물 크기 — 어디까지가 내 거점이 될지 설치 전에 보여준다)
    const pts = [];
    for(let i=0; i<=RING_SEG; i++){ const a=(i/RING_SEG)*Math.PI*2;
      pts.push(new THREE.Vector3(Math.cos(a)*O().radius, 0, Math.sin(a)*O().radius)); }
    ghostRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color:RING_COL, transparent:true, opacity:0.6, depthWrite:false, depthTest:false })
    );
    ghostRing.renderOrder = 4; ghostRing.visible = false; scene.add(ghostRing);
  }
  function startPlace(id){
    if(id !== 'banner') return false;
    if(ctx.inventory && ctx.inventory.count('banner') <= 0) return false;
    placing = true; makeGhost();
    const el = ctx.renderer.domElement;
    if(el && el.requestPointerLock) el.requestPointerLock();
    toast(`거점 깃발 — 세울 자리를 보고 좌클릭 (${myOutposts().length}/${slots})`, 'gold');
    return true;
  }
  function stopPlace(){
    placing = false;
    if(ghost) ghost.visible = false;
    if(ghostRing) ghostRing.visible = false;
  }
  function doPlace(){
    if(!placing) return;
    const p = aimGround(); if(!p) return;
    const chk = canPlaceAt(p.x, p.z);
    if(!chk.ok){ toast(chk.reason, 'red'); return; }
    const rec = spawnOutpost(p.x, p.z, { isle:chk.isle, groundY:chk.groundY });
    ctx.sound?.play?.('build_place');
    if(ctx.inventory){ ctx.inventory.remove('banner', 1); if(ctx.updHotbar) ctx.updHotbar(); }
    ctx.reputation?.applyAction?.('CLAIM_EMPTY');
    toast(`${rec.island.name} 설치 — 반경 ${O().radius}m 안에서 거점 건물을 지을 수 있습니다`, 'green');
    if(!ctx.inventory || ctx.inventory.count('banner') <= 0) stopPlace();
  }
  ctx.renderer.domElement.addEventListener('mousedown', e=>{ if(e.button === 0 && placing) doPlace(); });
  addEventListener('keydown', e=>{ if(e.code === 'Escape' && placing) stopPlace(); });

  // ── 매 프레임: 고스트 추적 + 유효성 색 ──
  ctx.onUpdate(()=>{
    if(!placing || !ghost) return;
    const p = aimGround();
    if(!p){ ghost.visible = false; if(ghostRing) ghostRing.visible = false; return; }
    ghost.visible = true; ghost.position.copy(p);
    if(ghostRing){ ghostRing.visible = true; ghostRing.position.set(p.x, p.y + RING_LIFT, p.z); }
    const chk = canPlaceAt(p.x, p.z);
    if(chk.ok !== ghostOK){
      ghostOK = chk.ok;
      const c = chk.ok ? RING_COL : 0xff5544;
      if(ghostRing) ghostRing.material.color.setHex(c);
      ghost.traverse(o=>{ if(o.isMesh && o.material && o.material.color) o.material.color.setHex(c); });
    }
  });

  // ── 🔎 반경 판정(건설 게이트 — build.js / settlement.js가 호출) ──
  //   반환: 그 좌표를 품는 내 거점 레코드(claimed 엔트리) 또는 null.
  function outpostAt(x, z){
    let best = null, bd = Infinity;
    for(const f of flags){
      const d = Math.hypot(f.x - x, f.z - z);
      if(d <= f.r && d < bd){ bd = d; best = f.island; }
    }
    return best;
  }
  const inRange = (pos)=> !!(pos && outpostAt(pos.x, pos.z));

  // ── 📈 거점 확장(레벨업): 골드 + 토모브의 영혼 소모, 평판(honor) 문턱 ──
  function expandCost(){
    const tbl = O().expand || [];
    return (slots < O().maxSlots) ? (tbl[slots] || null) : null;
  }
  function canExpand(){
    const c = expandCost();
    if(!c) return { ok:false, reason:'거점 확장 한도에 도달했습니다', cost:null };
    const gold = ctx.inventory ? ctx.inventory.gold : 0;
    const soul = ctx.combat ? ctx.combat.soul : 0;
    const honor = ctx.reputation ? ctx.reputation.honor : 0;
    if(gold < c.gold)  return { ok:false, reason:`금화 부족 (${gold}/${c.gold})`, cost:c };
    if(soul < c.soul)  return { ok:false, reason:`토모브의 영혼 부족 (${soul}/${c.soul})`, cost:c };
    if(honor < c.honor) return { ok:false, reason:`명예 부족 (${honor}/${c.honor})`, cost:c };
    return { ok:true, cost:c };
  }
  function expand(){
    const chk = canExpand();
    if(!chk.ok){ toast(chk.reason, 'red'); return { ok:false, reason:chk.reason }; }
    const c = chk.cost;
    // 골드·영혼 실제 차감(평판은 문턱이라 소모하지 않음). 하나라도 실패하면 되돌린다.
    if(!ctx.inventory.addGold(-c.gold)) { toast('금화 차감 실패', 'red'); return { ok:false, reason:'gold' }; }
    if(!ctx.combat.spendSoul(c.soul)) { ctx.inventory.addGold(c.gold); toast('영혼 차감 실패', 'red'); return { ok:false, reason:'soul' }; }
    slots = Math.min(O().maxSlots, slots + 1);
    toast(`거점 확장 — 세울 수 있는 거점 ${slots}개`, 'gold');
    if(ctx.events) ctx.events.emit('outpostExpanded', slots);
    return { ok:true, slots };
  }

  // ── 💾 저장/복원 (save.js가 호출) ──
  //   거점 레코드 자체는 save.js의 claimed 왕복이 이미 담당한다(byFlag/isleId 포함). 여기서 저장하는 건
  //   claimed에 없는 것 = 확장 슬롯 수뿐. 복원은 "claimed에 복원된 byFlag 엔트리"에 시각물(깃발·경계)을 다시 붙이는 일.
  function snapshot(){ return { slots }; }
  function restore(sv){
    if(sv && sv.slots != null) slots = Math.max(O().startSlots, sv.slots|0);
    // save.js가 먼저 복원해둔 claimed 중 깃발 거점에 시각물 재생성(중복 방지 = 이미 flags에 있으면 건너뜀).
    for(const c of claimedList()){
      if(!c || !c.byFlag || c.owner !== 'player') continue;
      if(flags.some(f => f.island === c)) continue;
      spawnOutpost(c.x, c.z, { island: c });
    }
    // 구 세이브 안전장치: 확장으로 얻은 슬롯보다 실제 거점이 많으면 슬롯을 실제 개수로 올린다(거점이 잠기지 않게).
    const used = myOutposts().length;
    if(used > slots) slots = Math.min(O().maxSlots, used);
  }

  // ── 🗑️ 철거(깃발 회수) — 거점 건물이 남아 있으면 막는다(고아 건물 방지). ──
  function removeAt(x, z){
    const i = flags.findIndex(f => Math.hypot(f.x - x, f.z - z) < 3);
    if(i < 0) return false;
    const f = flags[i];
    if((f.island.buildings || []).length > 0){ toast('거점 건물을 먼저 철거해야 합니다', 'red'); return false; }
    scene.remove(f.grp); disposeBoundary(f);
    const ci = claimedList().indexOf(f.island); if(ci >= 0) claimedList().splice(ci, 1);
    flags.splice(i, 1);
    if(ctx.inventory){ ctx.inventory.add('banner', 1); if(ctx.updHotbar) ctx.updHotbar(); }
    toast('거점 깃발 회수', 'gold');
    return true;
  }

  ctx.outpost = {
    startPlace, stopPlace, canPlaceAt, spawnOutpost, removeAt,
    outpostAt, inRange,
    expand, canExpand, expandCost,
    snapshot, restore,
    get placing(){ return placing; },
    get slots(){ return slots; },
    get used(){ return myOutposts().length; },
    list: ()=> flags.map(f=>f.island),
  };
  // 디버그 훅(콘솔 실측 — 스크린샷 왕복 대신)
  window.__outpost = ctx.outpost;
  console.log('[outpost] 거점 깃발 준비 — 제작(목8·돌4·밧줄2) → 퀵슬롯 → 설치. 반경', O().radius, 'm · 시작 슬롯', slots);
  return ctx.outpost;
}
