// wharf.js — ⚓ 항구 건설(G키 고스트 배치). 사령관 개편 2026-07-04:
//   ★부두(the-wharf 물리모델)·재료투입 폐지 — "닻 내려 정박하니 물리 부두 불필요". 골드로 건설.
//   ★G = 항구 건물(선술집 모델·진영색·2.2배) 고스트 미리보기 → 해안서 바다 향해 위치 잡기 → 좌클릭 건설 → 골드 차감·섬 점령·dockPoint·깃발.
//     (고스트 이유: 건물이 커서 발밑에 두면 파묻힘 — 사령관. R 회전 · ESC 취소.)
//   외부 계약 보존: ctx.wharfBuild API(menu 가드) · onWharfBuilt 훅(smithy/questline/follower 체인) · rebuild(save.js) · claimed/dockPoint.
//   의존: ctx.scene·terrain(collide,groundAt,addTrimesh)·water·player·inventory·settlement(harborMesh/harborCost).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FLAG = encodeURI('/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Pirate Kit/Models/GLB format/flag-pirate.glb');
const HARBOR_SCALE = 2.2;   // 항구 건물 크기 배율(settlement 기본 6m × 2.2 ≈ 13m 랜드마크). 사령관 "너무 작음" — 여기서 튜닝.
const GHOST_FWD = 11;       // 고스트를 시야(카메라 정면) 앞으로 밀어내는 거리(m) — 발밑 파묻힘 방지 + 화면에 보이게(사령관).

import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';
import { initGround } from '/tomob-deploy/modules/ground.js';   // R4: 해안 판정 SSOT (game.html 밖 하네스 페이지 대비 자체 보장)
export function initWharf(ctx){
  const { scene } = ctx;
  if(!ctx.ground) initGround(ctx);   // R4: SSOT 미등록 페이지(구 하네스 등)에서도 동일 판정 보장
  const toast = t => ukToast(t, { accent:'gold', ms:2400 });
  const wl = () => ctx.water ? ctx.water.level : 0;
  function groundY(x,z){ return ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0; }
  function harborCost(){ return (ctx.settlement && ctx.settlement.harborCost && ctx.settlement.harborCost()) || 0; }

  // ★R4: 해안 판정 = ctx.ground SSOT 위임 (구현은 ground.js로 이관 — wharf·gate·wave 3벌 제각각이던 것 통일)
  const seaDir   = (x,z)=> ctx.ground.seaDir(x,z);
  const isOpenSea= (x,z)=> ctx.ground.isOpenSea(x,z);

  // 🏴 ⛔깃발 폐지(사령관 2026-08-07 "항구 지으면 깃발이 바닥에 박히는 것도 없애줘").
  //   부두는 **바다 위** 구조물인데 깃발은 groundY(=해저)에 꽂혀 물속에 박혀 보였다.
  //   거점 표시는 이제 🚩거점 깃발(outpost.js)이 전담하므로 항구용 깃발은 중복이기도 하다. 호출부는 no-op으로 유지.
  function plantFlag(){ /* 폐지 — 부두는 해상 구조물이라 지면 꽂이 깃발이 물속에 박혔다 */ }

  // ⚓ 부두(the-wharf) 모델 로더 — BUG-A4(사령관 2026-08-07 "항구는 예전에 넣어놨던 부두로").
  //   원본 = the-wharf/source/model/Untitled 1.obj (22.5k면·7그룹). ⚠️동봉 .mtl이 없어 OBJLoader가 재질을 못 만든다
  //   → usemtl 이름(Mat.1_1 / Mat_1 / Mat.2_1 / Mat_2)을 textures/ 파일명에 직접 매핑해 주입한다.
  //     Mat.1_1·Mat_1 = 파일명이 그대로 대응(확실). 나머지 둘은 대응 텍스처가 없어 DefaultMaterial로 채운다.
  //   ★교체 지점을 placeHarborMesh 한 곳으로 둔 이유: 신규건설·고스트·세이브 재건이 전부 이 경로를 지나므로
  //     여기만 바꾸면 나머지가 자동으로 따라온다(선술집 모델은 다른 거점 건물에서 계속 사용 — 제거 아님).
  const WHARF_OBJ = '/tomob-deploy/the-wharf/source/model/Untitled 1.obj';
  const WHARF_TEX = '/tomob-deploy/the-wharf/textures/';
  // ★실측 교정(2026-08-07): OBJLoader는 mtl이 없으면 메시 name에 **usemtl 값이 아니라 오브젝트 이름**을 넣는다.
  //   실제 메시 이름 = `Null`,`Null.1`~`Null.4`(목조 잔교 5개) + `tire`,`tire02`(고무 범퍼 2개).
  //   1차 구현은 usemtl 이름(`Mat.1_1` 등)으로 매칭해 **전부 실패 → 폴백 하나로 통일**되고 있었다.
  //   3안(Mat_1 / Mat.1_1 / DefaultMaterial)을 실제 렌더해 비교한 결과 **Mat_1이 목재 색으로 가장 자연스러움**
  //   (DefaultMaterial은 붉게 뜸). 타이어는 전용 Car_Tire 텍스처.
  const WHARF_WOOD = { map:'Untitled_1_Mat_1_BaseColor.png', nrm:'Untitled_1_Mat_1_Normal.png' };
  const WHARF_TIRE = { map:'Car_Tire_BaseColor.png',         nrm:'Car_Tire_Normal.png' };
  const wharfMatFor = name => (/tire/i.test(name||'') ? WHARF_TIRE : WHARF_WOOD);
  // ⚓ 부두 규모·높이 — **실측 기반**(2026-08-07, 사령관 "수면에 고정이 안 되는데?").
  //   원인: 수면(y=0)에 고정했더니 **해안 파고 최고 5.29m**가 부두 전체 높이 3.3m를 통째로 덮어 물속에 잠겨 보였다.
  //   (전 해역 기준 파고는 최고 7.32m. 부두 자리인 해안 근처만 재면 5.29m.)
  //   해법 ①폭 26→42m로 키워 높이도 비례 상승(3.3→5.3m) ②갑판이 파고 위에 오도록 수면에서 띄운다.
  //   모델 구조 실측: 전체 높이의 98%가 갑판 상단(기둥+갑판이 한 덩어리, 갑판이 맨 위).
  const WHARF_SPAN = 42;      // 목표 최대 수평 치수(m). 캐러벨 56m가 옆에 붙는 규모 + 높이 확보(폭:높이 ≈ 7.9:1 → 5.3m)
  //   ⚠️1차에 +2.6으로 띄웠더니 갑판은 파도 위였지만 **기둥 바닥까지 수면 위(2.6m)로 떠서 부두가 공중에 뜬 꼴**이었다.
  //     모델이 통짜 5.3m라 "갑판은 파고 위 + 기둥은 수중"을 동시에 만족할 수 없다 → 기둥 잠김을 우선한다.
  //     음수 = 수면 아래로 내림. 기둥 1.2m 수중 · 갑판 4.1m → 평상시 파도(실측 1.2m) 위, 큰 파도(최고 5.3m) 때만 덮임
  //     (실제 항구도 폭풍 때 갑판이 덮이므로 그쪽이 자연스럽다).
  const WHARF_LIFT = -1.2;
  let _wharfProto = null, _wharfDeckH = 5.3;   // 갑판 높이(원점=기둥 바닥). 로더가 실측값으로 덮어씀
  async function loadWharfProto(){
    if(_wharfProto) return _wharfProto;
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    const texL = new THREE.TextureLoader(), cache = {};
    const tex = (f, srgb)=>{ if(!f) return null; const k=f+(srgb?'|s':'');
      if(!cache[k]){ const t=texL.load(encodeURI(WHARF_TEX+f)); if(srgb) t.colorSpace=THREE.SRGBColorSpace; cache[k]=t; } return cache[k]; };
    const root = await new Promise((rs,rj)=>new OBJLoader().load(encodeURI(WHARF_OBJ), rs, undefined, rj));
    root.traverse(o=>{ if(!o.isMesh) return;
      const m = wharfMatFor(o.name);   // 이름에 'tire'가 있으면 고무 범퍼, 아니면 목조 잔교
      o.material = new THREE.MeshStandardMaterial({ map:tex(m.map,true), normalMap:tex(m.nrm,false),
        roughness:0.85, metalness:0, side:THREE.DoubleSide });   // 판자가 얇아 뒷면도 그려야 구멍이 안 보임
      o.castShadow = true; o.receiveShadow = true;
    });
    // 정규화: 최대 수평 치수를 WHARF_SPAN에 맞추고, 바닥 y=0 · 수평중심 원점으로(배치 좌표에 그대로 앉히기 위해)
    let bb=new THREE.Box3().setFromObject(root), sz=bb.getSize(new THREE.Vector3());
    root.scale.setScalar(WHARF_SPAN / (Math.max(sz.x, sz.z) || 1));
    bb=new THREE.Box3().setFromObject(root);
    const c=bb.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -bb.min.y, -c.z);
    const holder=new THREE.Group(); holder.add(root);
    // 갑판 높이(원점=기둥 바닥 기준) — 배치 시 "갑판을 해안 지면에 맞추는" 계산에 쓴다.
    _wharfDeckH = (new THREE.Box3().setFromObject(holder)).max.y;
    _wharfProto = holder;
    console.log('[wharf] 부두 모델 로드 — the-wharf OBJ · 목표폭', WHARF_SPAN, 'm');
    return _wharfProto;
  }
  async function wharfMesh(){
    try{ const p = await loadWharfProto(); return p ? p.clone(true) : null; }
    catch(e){ console.warn('[wharf] 부두 모델 로드 실패 — 기존 항구 건물로 폴백', e && e.message); return null; }
  }

  // ⚓ 부두 배치 높이 — **휠로 직접 조절**(사령관 2026-08-07 "스크롤로 위아래 조절하면 되잖아").
  //   해안 높이가 섬마다 달라 자동 계산으로는 원하는 위치가 안 나온다 → 고스트 미리보기 중 마우스 휠로 사령관이 직접 맞춘다.
  //   (build.js의 휠 높이조절과 같은 패턴. 확정 시 그 높이가 그대로 실물에 적용된다.)
  let wharfLift = WHARF_LIFT;   // 현재 배치 높이 오프셋(수면 기준). 휠로 증감, 배치 시작 시 기본값으로 리셋

  // 항구(부두) 배치(공통 — 신규건설/이어하기 재건). 지면 안착 + 보행 충돌체.
  async function placeHarborMesh(island, x, z, roty){
    // ⚓ 부두 우선. 실패 시에만 구 항구 건물(선술집 모델)로 폴백해 항구가 아예 안 생기는 회귀를 막는다.
    let mesh = await wharfMesh();
    const isWharf = !!mesh;
    if(!mesh){
      if(!ctx.settlement || !ctx.settlement.harborMesh){ console.warn('[wharf] settlement 미연결'); return null; }
      mesh = await ctx.settlement.harborMesh(island);
    }
    if(!mesh) return null;
    if(!isWharf) mesh.scale.setScalar(HARBOR_SCALE);   // ★구 건물 폴백만 배율 적용(부두는 로더가 이미 정규화)
    // ⚓ 부두는 **바다 위 구조물**(사령관 2026-08-07 "저거 항구는 바다 위에 건설하는 거야").
    //   지면 높이를 따라가면 해안 쪽이 육지로 올라타 다리가 땅에 파묻힌다 → **항상 수면에 얹는다.**
    //   (구 항구 건물 폴백은 육지 건물이라 종전대로 지면/수면 중 높은 쪽.)
    const gy=groundY(x,z);
    mesh.position.set(x, isWharf ? wl()+wharfLift : (gy>wl()?gy:wl()), z); mesh.rotation.y=roty||0;
    scene.add(mesh);
    if(ctx.terrain.collide) mesh.traverse(o=>{ if(o.isMesh) ctx.terrain.collide.push(o); });
    if(ctx.terrain.addTrimesh){ try{ ctx.terrain.addTrimesh(mesh); }catch(e){ console.warn('[wharf] trimesh 충돌체 실패', e&&e.message); } }
    ctx.wharf={ obj:mesh, pos:{ x, z }, dock:(island&&island.dockPoint)?{ x:island.dockPoint.x, z:island.dockPoint.z }:null };   // dock=정박점(물속) — 배 건조/호출 스폰지점
    if(island) island._wharfMesh = mesh;   // ★철거(demolish) 타게팅용 참조
    return mesh;
  }

  // ── 🔨 항구 철거 (SIM-B3/GAP-2 — "한번 지으면 영구 불멸"이던 것) ──
  //   규칙: 점령(claimed·깃발·dockPoint)은 유지, 항구 건물만 철거 → 섬당 1개 가드가 wharf 유무 기준이라 재건설 자연 허용.
  //   캐스케이드: 물리(trimesh)·collide·씬 메시 → 교역 NPC/팻말 → island.wharf/ctx.wharf null(★stale 방지=D4) → 골드 50% 환급.
  function _demolishIsland(isl){
    const mesh = isl && isl._wharfMesh;
    if(!mesh) return false;
    try{ if(ctx.terrain && ctx.terrain.removeTrimesh) ctx.terrain.removeTrimesh(mesh); }catch(_){}
    if(ctx.terrain && ctx.terrain.collide){
      const set=new Set(); mesh.traverse(o=>{ if(o.isMesh) set.add(o); });
      for(let i=ctx.terrain.collide.length-1;i>=0;i--) if(set.has(ctx.terrain.collide[i])) ctx.terrain.collide.splice(i,1);
    }
    scene.remove(mesh);
    const wx = isl.wharf ? isl.wharf.x : mesh.position.x, wz = isl.wharf ? isl.wharf.z : mesh.position.z;
    try{ if(ctx.trader && ctx.trader.removeNear) ctx.trader.removeNear(wx, wz, 40); }catch(_){}
    isl._wharfMesh=null; isl.wharf=null;
    if(ctx.wharf && ctx.wharf.obj===mesh) ctx.wharf=null;
    const refund=Math.round(harborCost()*0.5);
    if(refund>0 && ctx.inventory && ctx.inventory.addGold){ ctx.inventory.addGold(refund); toast('항구 철거 — '+refund+' 환급'); }
    else toast('항구 철거 완료');
    if(ctx.updHotbar) ctx.updHotbar();
    return true;
  }
  function demolishAimed(range=12){   // 망치 좌클릭 — 화면 중앙 조준 항구 철거 (player.js 디스패처가 fortify→build 다음에 호출)
    const cam=ctx.camera; if(!cam) return false;
    const rc=new THREE.Raycaster(); rc.setFromCamera({ x:0, y:0 }, cam); rc.far=range;
    for(const isl of (ctx.claimed||[])){
      const m=isl && isl._wharfMesh; if(!m) continue;
      if(rc.intersectObject(m, true).length) return _demolishIsland(isl);
    }
    return false;
  }

  // ── 실제 완성(고스트 확정 / 헤드리스 force 공통) ──
  let _busy=false, _folTarget=null, _folT=0;   // _folTarget = 추종자(ctx.follower.group) 달려올 목표
  async function commitHarbor(bx, bz, roty, { force, claimFoe }={}){
    if(_busy) return false;
    // ★섬당 항구 1개 규칙 — 섬 정체성(canon id)으로 판정(사령관 2026-07-23 "큰 섬에 여러 개 지어짐").
    //   기존 거리 가드(하드코딩 r=40)는 큰 섬 반대편 해안을 못 잡았다. canon id 일치 = 같은 섬 = 차단.
    //   canonId가 null(worldmap 미init 등)이면 기존 거리 가드로 폴백.
    const _cid = (ctx.claim && ctx.claim.nearestCanonId) ? ctx.claim.nearestCanonId(bx, bz) : null;
    if(ctx.claimed && ctx.claimed.some(e=> e && e.wharf &&
        ((_cid!=null && e.canonId!=null && e.canonId===_cid) || Math.hypot(e.x-bx, e.z-bz) < (e.r||40)+30))){
      toast('이 섬에는 이미 항구가 있습니다'); return false;
    }
    const cost=harborCost();
    if(!force && ctx.inventory && ctx.inventory.gold<cost){ toast('골드 부족 — 항구 '+cost+'골드'); return false; }
    _busy=true;
    try{
      const bsea=seaDir(bx,bz) || { x:Math.sin(roty), z:Math.cos(roty), dist:6 };
      const edge=bsea.dist||6;
      const dock={ x:bx+bsea.x*(edge+16), y:wl()+1, z:bz+bsea.z*(edge+16) };   // 정박점 = 물속(자동항해 도착지)
      const island={ x:bx, z:bz, name:'점령섬 '+((ctx.claimed?ctx.claimed.length:0)+1), r:40, owner:'player',
        dockPoint:dock, towers:[], buildings:[], hasHarbor:true, wharf:{ x:bx, z:bz, roty }, canonId:_cid };   // 섬 좌표=항구 건물. canonId=섬당 1개 가드 판정용(2026-07-23)
      const mesh=await placeHarborMesh(island, bx, bz, roty);
      if(!mesh){ toast('항구 건물 로드 실패'); return false; }
      if(!force && ctx.inventory) ctx.inventory.addGold(-cost);
      plantFlag(bx, bz);
      if(ctx.claimed){ ctx.claimed.push(island); ctx.claimReg=island; ctx.reputation?.applyAction('CLAIM_EMPTY'); }
      // ★BUG-018: 건물 0개 무인도 깃발 위에 항구를 세운 것이면, 그 깃발 거점(capture.js outpost)도 플레이어 소유로 전환
      //   → 문양 갱신·이후 isHostile/수비대/상인 게이트가 즉시 "내 땅"으로 인지(더는 NPC 안 뜸).
      if(claimFoe && ctx.capture && ctx.capture.claimEmpty) ctx.capture.claimEmpty(claimFoe);
      toast('항구 완성! 섬 점령 (총 '+((ctx.claimed&&ctx.claimed.length)||1)+'개)'+(cost&&!force?' · −'+cost+'골드':''));
      ctx.events.emit('wharfBuilt', { x:bx, z:bz });   // R2: 이벤트 버스
      { // ★추종자 목표 = 계단 문앞(사령관 실측·검증). 건물 로컬좌표 → localToWorld(three.js가 회전·스케일 자동 처리, 수동수학 X)
        //   → 어떤 회전/모델이어도 항상 계단 앞. 계단 등지고 바깥 바라보기는 mover(아래 lookAt)가 처리.
        mesh.updateMatrixWorld(true);
        const _sp = mesh.localToWorld(new THREE.Vector3(-0.62, 0.564, 3.715));   // 계단 로컬좌표(실측)
        _folTarget={ x:_sp.x, z:_sp.z, fx:bx, fz:bz }; _folT=0; }
      if(ctx.updHotbar) ctx.updHotbar();
      return true;
    } finally { _busy=false; }
  }

  // ── 고스트 배치 ──
  let ghost=null, placing=false, valid=false, yawOff=0, _loadingGhost=false;
  let _ghostIsWharf=false;   // ⚓ 현재 고스트가 부두 모델인가(=수면 고정) / 구 건물 폴백인가(=지면 추종)
  async function makeGhost(){
    // ⚓ 고스트도 실제 배치물과 같은 부두 모델(미리보기와 결과가 달라 보이면 위치를 못 잡는다). 실패 시만 구 건물 폴백.
    let gm = await wharfMesh(); const isWharf = !!gm; _ghostIsWharf = isWharf;
    if(!gm) gm = await ctx.settlement?.harborMesh?.({ owner:'player' });   // 플레이어 진영색
    if(!gm) return null;
    if(!isWharf) gm.scale.setScalar(HARBOR_SCALE);
    gm.traverse(o=>{ if(o.isMesh){ o.material = (o.material && o.material.clone) ? o.material.clone() : o.material;
      if(o.material){ o.material.transparent=true; o.material.opacity=0.5; o.material.depthWrite=false; } } });
    return gm;
  }
  async function startPlacing(){
    if(ctx.dungeon && ctx.dungeon.active){ toast('던전 안에서는 항구를 지을 수 없습니다'); return; }   // ★2026-07-23 던전 내 항구건설 차단(수평 오프셋 좌표라 seaDir 오판)
    if(ctx.ship && ctx.ship.boarded) return;   // 승선 중 = 항해 → 항구 배치 안 함
    if(placing || _loadingGhost) return;
    // ★채집 튜토 이수 전 항구 잠금(사령관 2026-07-23) — 튜토는 순서대로. gathertuto 완료 플래그 게이트.
    try{ if(!localStorage.getItem('mas_gather_tuto_done')){ toast('먼저 채집을 배우세요 — 도끼/곡괭이로 목재·돌을 캐면 항구 건설이 열립니다'); return; } }catch(_){}
    const pp=ctx.player.pos;
    if(groundY(pp.x,pp.z)<=wl()+0.6){ toast('육지 해안으로 올라가세요'); return; }
    if(!seaDir(pp.x,pp.z)){ toast('바다 옆 해안으로 이동하세요'); return; }
    const cost=harborCost();
    if(ctx.inventory && ctx.inventory.gold<cost){ toast('골드 부족 — 항구 '+cost+'골드 필요 (보유 '+ctx.inventory.gold+')'); return; }
    _loadingGhost=true; const gm=await makeGhost(); _loadingGhost=false;
    if(!gm){ toast('항구 모델 로드 실패'); return; }
    ghost=gm; scene.add(ghost); placing=true; yawOff=0;
    wharfLift = WHARF_LIFT;   // ⬍ 배치 시작마다 기본 높이로 리셋(직전 배치 값이 남지 않게)
    toast('항구 터 — 해안서 바다를 향해 서기 · [휠] 높이 · [R] 회전 · 좌클릭 건설 · [ESC] 취소');
    _liftHud();
  }
  function cancel(){ if(ghost){ scene.remove(ghost); ghost=null; } placing=false; _liftHudHide(); }
  function rotate(){ if(placing) yawOff += Math.PI/2; }

  let _seaT=0, _sea=null, _land=false, _lastValid=null; const _camFwd=new THREE.Vector3();
  ctx.onUpdate((dt)=>{
    if(!placing || !ghost) return;
    const pp=ctx.player.pos;
    _seaT-=(dt||0.016);
    if(_seaT<=0){ _seaT=0.15; _sea=seaDir(pp.x,pp.z); _land=groundY(pp.x,pp.z)>wl()+0.6; }   // 해안탐지 버스트 0.15s마다
    // 배치 방향 = 카메라(시야) 정면 — 보이는 앞쪽에 놓기(사령관). 시선 없으면 바다 방향 폴백.
    let dx=0, dz=1;
    if(ctx.camera){ ctx.camera.getWorldDirection(_camFwd); _camFwd.y=0;
      if(_camFwd.lengthSq()>1e-4){ _camFwd.normalize(); dx=_camFwd.x; dz=_camFwd.z; } }
    else if(_sea){ dx=_sea.x; dz=_sea.z; }
    const gx=pp.x+dx*GHOST_FWD, gz=pp.z+dz*GHOST_FWD, gy=groundY(gx,gz);
    // ⚓ 미리보기도 실제 배치와 같은 규칙 — 부두는 수면 고정(해상 구조물), 구 건물 폴백만 지면 추종.
    ghost.position.set(gx, _ghostIsWharf ? wl()+wharfLift : (gy>wl()?gy:wl()), gz);
    const sea=_sea||{x:dx,z:dz};
    ghost.rotation.y=Math.atan2(sea.x,sea.z)+yawOff;   // 건물은 바다를 향해(R로 추가 회전)
    valid = _land && !!_sea && isOpenSea(pp.x,pp.z);
    if(valid!==_lastValid){ _lastValid=valid; const col=valid?0x66ff88:0xff5a5a;   // 색은 바뀔 때만(고폴리 순회 절감)
      ghost.traverse(o=>{ if(o.isMesh&&o.material&&o.material.color) o.material.color.setHex(col); }); }
  });

  async function confirm(){
    if(!placing || !ghost) return;
    if(ctx.dungeon && ctx.dungeon.active){ cancel(); toast('던전 안에서는 항구를 지을 수 없습니다'); return; }   // ★2026-07-23 배치 중 던전 진입 방어(고스트 정리)
    if(!valid){ toast('외해 옆 육지(해안)에서 지으세요'); return; }
    const pp=ctx.player.pos;
    // ★BUG-018 정책(2026-07-13, 사령관): 건물이 자란 "방어섬"만 게이지 정복을 강제한다. 건물 0개(무인도)인 빈 깃발은
    //   막지 않고 그냥 항구를 짓게 해준다 — 그 자체가 거점화(아래 commitHarbor가 foe를 넘겨받아 소유권 이전).
    const foe=(ctx.capture&&ctx.capture.outposts||[]).find(o=>o&&o.owner!=='player'&&Math.hypot(o.x-pp.x,o.z-pp.z)<420);
    if(foe && foe.buildings && foe.buildings.length>0){ const tk=ctx.tribes&&ctx.tribes.tribeById&&ctx.tribes.tribeById(foe.tribe);
      toast(''+((tk&&tk.ko)||'부족')+'의 섬 — 항구로는 못 뺏어요. 깃발 거점을 정복하세요'); return; }
    // ★2026-07-13(사령관 "점령했는데 항구 건설 안 됨") — capture.js flipOwner는 깃발만 점령해도(건물 0개)
    //   ctx.claimed에 owner='player' 항목을 즉시 만든다(hasHarbor:false). owner만 보고 막으면 그 빈 거점 근처엔
    //   영원히 진짜 항구를 못 짓는 소프트락이었다. 실제 항구(hasHarbor)가 있을 때만 막는다.
    const dupe=(ctx.claimed||[]).find(c=>c&&c.owner==='player'&&c.hasHarbor&&Math.hypot(c.x-pp.x,c.z-pp.z)<60);
    if(dupe){ toast('이미 이 근처에 항구가 있어요'); return; }
    const bx=ghost.position.x, bz=ghost.position.z, roty=ghost.rotation.y;
    scene.remove(ghost); ghost=null; placing=false; _liftHudHide();
    // ★BUG-018: foe(건물 0개 무인도 깃발)가 있었다면 항구건설 성공 후 그 거점의 소유권도 함께 넘긴다(claimEmpty).
    await commitHarbor(bx, bz, roty, { claimFoe: foe||null });
  }

  // ── 이어하기 재건 — 저장된 island.wharf(항구건물 변환)로 메시+깃발+충돌체 재생성. claim은 save.js가 이미 복원. ──
  async function rebuild(island){
    if(!island || !island.wharf) return false;
    if(ctx.wharf && ctx.wharf.pos && Math.hypot(ctx.wharf.pos.x-island.wharf.x, ctx.wharf.pos.z-island.wharf.z)<4) return true;
    const w=island.wharf;
    const mesh=await placeHarborMesh(island, w.x, w.z, w.roty||0);
    if(!mesh) return false;
    plantFlag(island.x, island.z);
    // ★2026-07-10(사령관 "재입장하면 추종자가 또 항구로 감"): placeHarborMesh가 ctx.wharf를 매번 새 객체로 만들어서
    //   trader.js의 "_trader 없으면 스폰" 부트스트랩이 재접속마다 다시 발동 → 그때그때의(방금 새로 생긴) 추종자를
    //   또 항구로 소모해감. 이어하기로 복원되는 항구=이미 지난 세션에 상인 배정이 끝난 항구이므로 재발동 스킵.
    if(ctx.wharf) ctx.wharf._trader = true;
    console.log('[wharf] 이어하기 항구 재건 —', island.name);
    return true;
  }

  addEventListener('keydown', e=>{
    if(e.code==='Escape' && placing){ cancel(); return; }   // ESC는 포인터락 해제 전 처리
    if(document.pointerLockElement!==ctx.renderer.domElement) return;
    // ★G키 폐지(사령관 2026-07-23): 항구 건설 시작 = N키 내 섬 관리, 확정 = 좌클릭(아래 mousedown). R = 배치 중 회전만.
    if(e.code==='KeyR' && placing) rotate();
  });
  // ⬍ 휠 = 부두 높이 조절(사령관 2026-08-07). build.js 휠 높이조절과 같은 조작감. 배치 중에만 동작.
  addEventListener('wheel', e=>{
    if(!placing || !_ghostIsWharf) return;
    e.preventDefault();
    wharfLift += (e.deltaY < 0 ? 0.25 : -0.25);
    wharfLift = Math.max(-8, Math.min(8, wharfLift));   // 과도한 이탈 방지(수면 ±8m)
    _liftHud();
  }, { passive:false });
  // 현재 높이 표시(화면 하단) — 휠 돌릴 때만 잠깐 뜨고 배치 끝나면 사라진다.
  let _liftEl=null, _liftT=0;
  function _liftHud(){
    if(!_liftEl){ _liftEl=document.createElement('div');
      _liftEl.style.cssText='position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:41;'
        +'padding:7px 15px;border-radius:7px;background:rgba(12,16,24,.86);border:1px solid rgba(201,168,90,.45);'
        +"color:#f0d9a8;font:600 14px Pretendard,system-ui,'Malgun Gothic';pointer-events:none";
      document.body.appendChild(_liftEl); }
    _liftEl.textContent = `높이 ${wharfLift>=0?'+':''}${wharfLift.toFixed(2)}m · [휠] 조절 · [R] 회전 · 좌클릭 건설`;
    _liftEl.style.display='block';
    clearTimeout(_liftT); _liftT=setTimeout(()=>{ if(_liftEl) _liftEl.style.display='none'; }, 2200);
  }
  function _liftHudHide(){ if(_liftEl) _liftEl.style.display='none'; clearTimeout(_liftT); }
  ctx.renderer.domElement.addEventListener('mousedown', e=>{ if(e.button===0 && placing && document.pointerLockElement===ctx.renderer.domElement) confirm(); });

  // ── 추종자(ctx.follower.group)가 방금 지은 항구로 달려오기 ──
  //   비오프닝 추종자(game.html 인라인 soldier 등)를 목표까지 직선 이동. 오프닝 follower.js는 자체 이동(.group 없어 여기선 no-op).
  ctx.onUpdate((dt)=>{
    if(!_folTarget) return;
    const g=ctx.follower && ctx.follower.group; if(!g) return;
    _folT+=(dt||0.016);
    const p=g.position; let dx=_folTarget.x-p.x, dz=_folTarget.z-p.z; const d=Math.hypot(dx,dz);
    const yb=Math.max(groundY(p.x,p.z), wl()+0.2);
    if(d<=1.5){   // 문앞 도착 → 고정 + 항구 바라보기
      const fx=_folTarget.fx, fz=_folTarget.fz; _folTarget=null; p.y=yb;
      ctx.follower.setMoving && ctx.follower.setMoving(false);       // idle
      if(fx!=null) g.lookAt(2*p.x-fx, p.y, 2*p.z-fz);               // ★항구 등지고 바깥(도착 방향) 바라보기 — 사령관 "뒤돌고"
      return; }
    const step=Math.min(d, 8*(dt||0.016)); dx/=d; dz/=d;             // 달리기 8m/s
    p.x+=dx*step; p.z+=dz*step;
    ctx.follower.setMoving && ctx.follower.setMoving(true);          // 달리기 애니(sprint)
    p.y=yb + (ctx.follower.setMoving ? 0 : Math.abs(Math.sin(_folT*16))*0.18);   // 애니 있으면 지면 안착(다리는 sprint가), 없으면 hop
    g.lookAt(_folTarget.x, p.y, _folTarget.z);                       // 진행 방향(문앞)을 향해
  });

  ctx.wharfBuild={ start:startPlacing, cancel, rotate, confirm, rebuild, demolishAimed,
    placing:()=>placing, building:()=>false, cost:()=>({ gold:harborCost() }),
    // 🔬 배치 높이 진단(휠 조절 검증용) — 고스트가 실제로 그 높이에 있는지 확인한다.
    _liftInfo:()=>({ lift:+wharfLift.toFixed(2), sea:wl(), isWharf:_ghostIsWharf,
                     ghostY: ghost ? +ghost.position.y.toFixed(2) : null }),
    _debugComplete(){ const pp=ctx.player.pos, sea=seaDir(pp.x,pp.z)||{x:1,z:0,dist:6};   // 헤드리스: 게이트/고스트 없이 즉시
      commitHarbor(pp.x, pp.z, Math.atan2(sea.x,sea.z), { force:true }); return true; },
    _debugDemolish(){ const pp=ctx.player.pos; let best=null, bd=1e9;   // 헤드리스: 조준 없이 최근접 항구 철거
      for(const isl of (ctx.claimed||[])){ if(!isl||!isl._wharfMesh) continue;
        const d=Math.hypot((isl.wharf?isl.wharf.x:isl.x)-pp.x, (isl.wharf?isl.wharf.z:isl.z)-pp.z);
        if(d<bd){ bd=d; best=isl; } }
      return best ? _demolishIsland(best) : false; } };
  console.log('[wharf] 항구 고스트 건설 등록 — G(해안) → 고스트 → R 회전 · 좌클릭 건설(골드) · ESC 취소. 진영색 항구 + 섬 점령.');
  return ctx.wharfBuild;
}
