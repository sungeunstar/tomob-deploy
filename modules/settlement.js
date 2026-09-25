// settlement.js — 🏛️ 거점 건물 시스템. owned 섬(claimed, owner='player') 항구 근처 슬롯에 **골드**로 건물 건설 → 그 섬 패시브 효과.
//   에셋 = KayKit Medieval Hexagon 건물 FBX(단일 아틀라스 hexagons_medieval.png). build.js fitDungeon(FBX+아틀라스+정규화) 패턴 재사용.
//   효과·비용 = BAL.buildings SSOT(한 줄 튜닝). 저장 = claimed[i].buildings[](save.js 연동).
//   경제 설계(대화 2026-07-03): 재료는 배·방어탑, **골드는 거점 건물**(골드 싱크). 시장=파는값↑(교역허브) / 광산·제재소=채집↑(생산기지).
//   배치 = 항구(dockPoint) 주변 슬롯 링(조준 없이 슬롯 자동 = 헤드리스 검증 가능). v1=시장 효과(trade.js) → 이후 증분.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BAL } from '/tomob-deploy/modules/balance.js';
import { tribeById } from '/tomob-deploy/modules/tribes.js';   // 섬 소유 진영(lean) → 건물 색

// 건물 색 = 섬 소유 진영(사령관 확정 2026-07-04, 얼라이언스/호드式): 파수꾼=blue / 남은자=red / 중립=yellow. green=예비.
const HXBASE = '/tomob-deploy/KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings';
const COL_BY_LEAN = { watch:'blue', remnant:'red', neutral:'yellow' };
const DEF_COL = 'yellow';   // 중립/미상 기본
const hxDir = (col)=>`${HXBASE}/${col}/`;
const hxTex = (col)=>`${hxDir(col)}hexagons_medieval.png`;
const PFAC = (new URLSearchParams(location.search).get('faction')||'').trim();   // 플레이어 진영(remnant/watch)
const FIT = 9;   // 건물 목표 최대치수(m) — 정규화 스케일. ★사령관 "크기 다 너무작음, 실제건물이랑 뷰 맞춰줘"(2026-07-17) — 기존 6m는 왜소해보임(wharf.js 항구는 같은 카탈로그를 ×2.2=13m 랜드마크로 별도 확대). 6→9로 상향.
const MIN_GAP = FIT + 1;   // 마우스 배치 시 기존 건물과 최소 이격 거리(m) — FIT 상향에 맞춰 겹침판정도 동반 확대(구 하드코딩 6m).

// 건물 카탈로그: id → {fbx 베이스명, 이름, 설명}. 효과·비용·상한은 BAL.buildings[id].
//   ⛔icon(이모지) 필드 폐지(2026-07-22) — empire.js가 SVG 라인아이콘을 쓰고, 이모지는 사령관 금지 규칙.
//   act = 건물 앞 [E] 상호작용 라벨(3-1 장소화). 없으면 접근해도 프롬프트 안 뜸(순수 패시브 건물).
//   ★mine은 dungeonrun.js가 자체 [E]를 이미 갖고 있어 여기서 act를 주지 않는다(이중 배선 금지).
export const BUILDINGS = {
  market:      { file:'building_market',       name:'시장',     desc:'그 섬 교역 판매가↑ (교역 허브)',    act:'교역' },
  mine:        { file:'building_mine',         name:'광산',     desc:'그 섬 채광 산출↑ (생산 기지)' },
  lumbermill:  { file:'building_lumbermill',   name:'제재소',   desc:'그 섬 벌목·목재 산출↑' },
  home_A:      { file:'building_home_A',       name:'집',       desc:'인구 → 골드 패시브 수입' },
  windmill:    { file:'building_windmill',     name:'풍차',     desc:'골드 패시브 수입' },
  watermill:   { file:'building_watermill',    name:'물방앗간', desc:'골드 패시브 수입' },
  blacksmith:  { file:'building_blacksmith',   name:'대장간',   desc:'제작 비용↓',                        act:'제작대' },
  church:      { file:'building_church',       name:'교회',     desc:'평판↑' },
  harbor:      { file:'building_tavern',       name:'항구',     desc:'배 정박·교역·수리 관문 (G키로 해안 건설)', hidden:true },   // ★선술집 모델 재활용 — G키 즉시건설 전용
  barracks:    { file:'building_barracks',     name:'막사',     desc:'수비병 상주 · 용병 모집',           act:'수비대' },
  archeryrange:{ file:'building_archeryrange', name:'궁수장',   desc:'습격 시 자동 궁수 방어' },
  well:        { file:'building_well',         name:'우물',     desc:'수비대 비전투 회복' },
  inn:         { file:'building_tavern',       name:'여관',     desc:'추종자(정예 크루) 영입 거점',       act:'여관' },   // ★선술집 모델 재활용
};

// ── 🌱 섬 성장 엔진(Lv0~5) SSOT ── 건물 "존재"가 4수치를 60s 틱마다 누적 → 임계값 도달 시 Lv 승격.
//   평판 3축과 동일 패턴: 0부터 누적 / 하한 0 / 상한·하락 없음(위협에 의한 안정도 감소는 축3 스코프). 건물 효과값(effectSum)과 관심사 분리.
const GROWTH_PER_TICK = 1;   // 건물 1개당 틱(60s)마다 매핑 수치 +1. 단순 시작(종류별 가중치 없음). 8슬롯 발전섬 기준 Lv5 ≈ 30분.
// 건물 id → 성장 수치 키. 집=인구 / 막사·궁수장·우물=안정도 / 생산계열=번영도 / 교회·항구=영향력.
const GROWTH_MAP = {
  home_A:'pop',
  barracks:'stability', archeryrange:'stability', well:'stability',
  market:'prosperity', mine:'prosperity', lumbermill:'prosperity', windmill:'prosperity', watermill:'prosperity', blacksmith:'prosperity',
  church:'influence', harbor:'influence', inn:'influence',
};

export async function initSettlement(ctx){
  const { scene, camera } = ctx;
  if(!scene){ console.warn('[settlement] scene 없음'); return; }
  const B = ()=> BAL.buildings || {};
  const slotR = ()=> (B().slotRadius || 18);
  const slotMax = ()=> (B().slotCount || 8);   // 절대 상한(Lv5) — 슬롯 링 좌표 개수는 항상 이걸로 계산(복원 좌표 안정성).
  // 🌱 Lv 연동 사용 가능 슬롯(감사 B2) — Lv를 올릴 실질 보상. growth 없으면 Lv0.
  //   ⚠️slotPos의 링 분할 수는 slotMax 고정이어야 한다(가변이면 세이브 복원 좌표가 Lv에 따라 흔들림).
  function slotN(island){
    const tbl = B().slotByLv;
    if(!Array.isArray(tbl) || !tbl.length) return slotMax();
    const lv = Math.max(0, Math.min(tbl.length-1, (island && island.growth && island.growth.lv|0) || 0));
    return Math.min(slotMax(), tbl[lv]);
  }
  // 🔢 섬당 동일 건물 상한(감사 B1). BAL에 max 없으면 무제한(구 동작 폴백).
  function maxOf(id){ const e = B()[id]; return (e && e.max != null) ? e.max : Infinity; }
  function countOf(island, id){ return (island && island.buildings || []).filter(b => b.id === id).length; }

  // ── FBX 로드 + 아틀라스 주입 + 정규화(수평중심·바닥 y=0). build.js fitDungeon 패턴. 프로토타입 캐시. ──
  const _fbx = new FBXLoader();
  const _texL = new THREE.TextureLoader();
  const _atlas = {};   // col -> texture (색별 아틀라스 캐시)
  function atlas(col){ if(!_atlas[col]){ const t=_texL.load(encodeURI(hxTex(col))); t.flipY=true; t.colorSpace=THREE.SRGBColorSpace; _atlas[col]=t; } return _atlas[col]; }
  const _proto = {};   // 'id_col' -> Promise<Group>
  function loadProto(id, col){
    const key = id+'_'+col;
    if(_proto[key]) return _proto[key];
    const b = BUILDINGS[id]; if(!b) return Promise.resolve(null);
    _proto[key] = new Promise((resolve)=>{
      _fbx.load(encodeURI(hxDir(col) + b.file + '_' + col + '.fbx'), (o)=>{
        const tx = atlas(col);
        o.traverse(c=>{ if(c.isMesh){ c.castShadow=true; c.receiveShadow=true;
          const ms = Array.isArray(c.material)?c.material:[c.material];
          ms.forEach(m=>{ if(m){ m.map=tx; if(m.color)m.color.setHex(0xffffff); m.needsUpdate=true; } }); } });
        // 정규화: 최대치수 → FIT(m), 수평중심 + 바닥 y=0
        let bb=new THREE.Box3().setFromObject(o), s=bb.getSize(new THREE.Vector3());
        const md=Math.max(s.x,s.y,s.z)||1; o.scale.setScalar(FIT/md);
        bb=new THREE.Box3().setFromObject(o); const c2=bb.getCenter(new THREE.Vector3()), mn=bb.min.clone();
        const holder=new THREE.Group(); o.position.set(-c2.x,-mn.y,-c2.z); holder.add(o); resolve(holder);
      }, undefined, (e)=>{ console.warn('[settlement] FBX 로드 실패:', b.file, col, e&&e.message); resolve(null); });
    });
    return _proto[key];
  }

  // ── 건물 색 = 섬 소유 진영(lean) → COL_BY_LEAN. 플레이어 섬 = 플레이어 진영(PFAC). ──
  function colorFor(island){
    if(!island) return DEF_COL;
    if(island.owner==='player') return COL_BY_LEAN[PFAC] || DEF_COL;
    const t = island.tribe ? tribeById(island.tribe) : null;
    return COL_BY_LEAN[t ? t.lean : 'neutral'] || DEF_COL;
  }

  // ── 슬롯: 항구 건물(육지) 중심 링. 섬당 slotN개. ──
  //   ★버그수정(사령관 2026-07-09): 앵커를 island.dockPoint로 쓰던 게 원인. dockPoint는 "배 정박점"으로
  //     항구에서 바다 방향 ~20m 밖·y=수면(wharf.js/claim.js) → 그 주위 링에 건물을 놓으니 전부 바다 위에 떠
  //     "골드는 나가는데 섬엔 아무것도 안 보임". 앵커 = 항구 건물 위치(island.x/z, 육지) + dockPoint 반대(내륙)로
  //     중심을 살짝 밀어 링이 물가가 아니라 섬 위에 앉게 교정.
  function anchorOf(island){
    let ax = island.x, az = island.z;
    // 🚩 깃발 거점(outpost.js)은 깃발 위치가 곧 중심 — dockPoint 보정 없이 그대로 앵커(항구가 없는 거점).
    if(!island.byFlag){
      const d = island.dockPoint;
      if(d && d.x!=null){ let ix=ax-d.x, iz=az-d.z; const L=Math.hypot(ix,iz);   // 항구→정박점 반대 = 내륙 방향
        if(L>1e-3){ ix/=L; iz/=L; ax += ix*slotR()*0.6; az += iz*slotR()*0.6; } }
    }
    const ay = ctx.terrain ? ctx.terrain.groundAt(ax, az, 5000) : 0;
    return { x:ax, y:ay, z:az };
  }
  function slotPos(island, i){ const a=anchorOf(island); const ang=(i/slotMax())*Math.PI*2; const r=slotR();   // ★분할수=slotMax 고정(Lv 무관 — 복원 좌표 안정)
    const x=a.x+Math.cos(ang)*r, z=a.z+Math.sin(ang)*r;
    const wl = ctx.water ? ctx.water.level : 0;
    const gy=ctx.terrain? ctx.terrain.groundAt(x,z, 5000) : 0;   // 5000=지형 위에서 수직 낙하(낮은 ray-start·항구지붕 오검출 제거)
    return { x, y:(gy>wl+0.4? gy : wl), z, i }; }   // 육지면 실지면, 아니면 수면(물속으로 안 가라앉게)
  //   ★freeSlot은 "지을 수 있는가"(Lv 슬롯) / restoreSlot은 "복원 자리"(절대 상한) — 구세이브가 Lv보다 많이 가졌어도 복원은 허용.
  function freeSlot(island){ const used=new Set((island.buildings||[]).map(b=>b.slot));
    for(let i=0;i<slotN(island);i++) if(!used.has(i)) return i; return -1; }
  function restoreSlot(island){ const used=new Set((island.buildings||[]).map(b=>b.slot));
    for(let i=0;i<slotMax();i++) if(!used.has(i)) return i; return 0; }
  // ★섬 3D 로드 판정 — 슬롯 링에 실제 육지 지면이 하나라도 잡히면 그 섬이 스트리밍(로드)된 상태.
  //   N키(empire) 원격 건설로 아직 로드 안 된 섬에 지으면 지형이 없어 지면계산 실패 → 건물이 물속/허공에 뜸.
  //   → 미로드 섬은 건설 자체를 막고 "근처로 가라" 안내(골드 차감 전 차단). raw groundAt만 검사(fallback 미사용).
  //   (항구 메시는 링 안쪽 = slotR 밖 샘플엔 안 걸려 오검출 없음.)
  function terrainLoadedFor(island){
    if(!island) return false;
    if(!ctx.terrain || !ctx.terrain.groundAt) return true;   // 지형 시스템 없음(테스트 하네스) → 게이트 우회
    // ★근접 게이트(사령관 2026-07-14 "고스트 안 뜸" 버그수정): 기존엔 "섬 지형이 스트리밍(collide)됐나"만 검사 →
    //   worldstream LOAD_R=2800m 안이면 무조건 통과. 그래서 섬이 화면 밖 수백~2천 m 밖이어도 N(empire) 건설
    //   버튼이 켜지고 ghostShow가 ok:true로 그 먼 섬 슬롯에 고스트를 놓았다 → 고스트는 정상 생성됐지만 카메라
    //   시야 밖이라 "고스트가 안 뜬다"로 보임. 스트리밍 범위(렌더용)와 "항구 근처(건설 가능)"를 분리해 좁힌다.
    const px = ctx.player?.pos?.x, pz = ctx.player?.pos?.z;
    if(px!=null && pz!=null){ const NEAR = (island.r||40) + slotR() + 60;   // 항구 접근 범위(내섬 위·항구 정박 포함) — 2.8km 스트림 범위와 분리
      if((island.x-px)*(island.x-px)+(island.z-pz)*(island.z-pz) > NEAR*NEAR) return false; }
    const a = anchorOf(island); const wl = ctx.water ? ctx.water.level : 0; const r = slotR();
    for(let i=0;i<slotMax();i++){ const ang=(i/slotMax())*Math.PI*2;
      if(ctx.terrain.groundAt(a.x+Math.cos(ang)*r, a.z+Math.sin(ang)*r, 5000) > wl+0.6) return true; }
    return false;
  }

  // ── 소유 섬 판정 ──
  function ownedIslands(){ return (ctx.claimed||[]).filter(c=>c && c.owner==='player'); }
  function nearestOwned(x,z, maxD=60){ let best=null,bd=maxD*maxD;
    for(const c of ownedIslands()){ const d=(c.x-x)*(c.x-x)+(c.z-z)*(c.z-z); if(d<bd){ bd=d; best=c; } } return best; }
  // ★버그수정(감사 A2, 2026-07-22): 효과 조회 반경이 80m 하드코딩이었다.
  //   claim.js 점령섬은 r=40이지만 worldstream 실제 섬은 r=isle.r||120 → 큰 섬의 절반 이상에서 채광/벌목 배율이
  //   1.0으로 떨어졌다("1000골드 광산이 복권"). 섬 반경을 따라가게 교체 — 섬 밖 여유는 EFF_PAD.
  const EFF_PAD = 40;   // 섬 경계 밖 여유(m) — 해안 채집/정박 지점까지 커버
  function effectRadiusOf(c){ return (c.r || 40) + slotR() + EFF_PAD; }
  function islandAt(x,z){   // 교역·채집 효과 조회용 — 그 좌표를 품는 내 섬(반경은 섬마다 다름)
    let best=null, bd=Infinity;
    for(const c of ownedIslands()){ const R=effectRadiusOf(c), d=(c.x-x)*(c.x-x)+(c.z-z)*(c.z-z);
      if(d <= R*R && d < bd){ bd=d; best=c; } }
    return best; }

  // ── 건물 배치(내부 공통 — 건설/복원 공유). posOverride 있으면 마우스 지정 위치(사령관), 없으면 슬롯 자동(복원·자동성장). ──
  // ── 🔌 충돌체 부착/해제 (감사 A5) — 부착은 **그룹 1개**만 collide에 넣는다.
  //   구현: 예전엔 자식 메시를 개별 push 해서 해제가 O(n) 탐색이었고, 실제로 아무도 해제하지 않아 배열이 단조 증가했다.
  //   terrain.groundAt/레이캐스트는 전부 intersectObjects(collide, **true**) = 재귀라 그룹 1개로 동작이 동일하다.
  function attachCollision(mesh){
    if(mesh.userData._setAttached) return;
    if(ctx.terrain && ctx.terrain.collide) ctx.terrain.collide.push(mesh);
    if(ctx.terrain && ctx.terrain.addTrimesh){ try{ ctx.terrain.addTrimesh(mesh); }catch(e){ console.warn('[settlement] trimesh 충돌체 실패', e&&e.message); } }
    mesh.userData._setAttached = true;
  }
  function detachCollision(mesh){
    if(!mesh.userData._setAttached) return;
    if(ctx.terrain && ctx.terrain.collide){ const i=ctx.terrain.collide.indexOf(mesh); if(i>=0) ctx.terrain.collide.splice(i,1); }
    if(ctx.terrain && ctx.terrain.removeTrimesh){ try{ ctx.terrain.removeTrimesh(mesh); }catch(_){} }   // _bodies를 비우므로 이중 제거 안전
    mesh.userData._setAttached = false;
  }

  async function placeBuilding(island, id, slot, posOverride){
    const proto = await loadProto(id, colorFor(island)); if(!proto) return null;
    const mesh = proto.clone(true);
    const p = posOverride ? { x:posOverride.x, y:posOverride.y, z:posOverride.z } : slotPos(island, slot);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = (posOverride && posOverride.rotY!=null) ? posOverride.rotY
      : Math.atan2(anchorOf(island).x - p.x, anchorOf(island).z - p.z);   // 항구를 바라보게(수동 회전 없으면)
    scene.add(mesh);
    attachCollision(mesh);   // ★충돌체(사령관 "건물들 충돌체 설정해주고", 2026-07-17)
    // ★rotY·y를 rec에 보존(감사 A1) — save.js가 이걸 저장해야 리로드 후 같은 자리에 선다.
    const rec = { id, slot, mesh, x:p.x, y:p.y, z:p.z, rotY:mesh.rotation.y, shown:true };
    (island.buildings || (island.buildings=[])).push(rec);
    return rec;
  }

  // ── 건설(골드 차감) — 성공 시 rec, 실패 시 {ok:false,reason}. pos=마우스 지정 위치(있으면 그곳에, 없으면 슬롯). ──
  async function build(island, id, pos){
    if(!island || island.owner!=='player') return { ok:false, reason:'not-owned' };
    if(!BUILDINGS[id]) return { ok:false, reason:'no-def' };
    if(!terrainLoadedFor(island)) return { ok:false, reason:'not-loaded' };   // ★미로드(원격) 섬 = 물속 배치 방지. 골드 차감 전 차단.
    if(countOf(island, id) >= maxOf(id)) return { ok:false, reason:'max-kind', max:maxOf(id) };   // 🔢 동일 건물 상한(감사 B1)
    const cost = (B()[id] && B()[id].cost) || 0;
    const slot = freeSlot(island); if(slot<0) return { ok:false, reason:'no-slot' };   // 슬롯=건물 수 상한(Lv 연동)
    if(ctx.inventory && !ctx.inventory.addGold(-cost)) return { ok:false, reason:'no-gold', cost };
    const rec = await placeBuilding(island, id, slot, pos);
    if(!rec){ if(ctx.inventory) ctx.inventory.addGold(cost); return { ok:false, reason:'load-fail' }; }   // 로드 실패 = 환불
    ctx.sound?.play?.('build_place');
    applySideEffects(island, id, rec);
    if(ctx.invui?.toast) ctx.invui.toast(`${BUILDINGS[id].name} 건설 (−${cost}골드)`);
    if(ctx.updHotbar) ctx.updHotbar();
    return { ok:true, rec };
  }

  // ── 🏗️ 건설 고스트 미리보기(empire.js N키 UI가 구동) — wharf.js G키 고스트 패턴을 거점 건물에 적용. ──
  //   슬롯 고정(freeSlot+slotPos) → 위치 이동 없음. 다음 빈 슬롯에 반투명 클론을 띄우고 [E] 확정 시 build() 호출.
  //   유효/무효 틴트 = terrainLoadedFor(그 섬 근처 로드 여부). 확정/취소 라우팅은 empire.js가 담당.
  //   ★2026-07-15(사령관 "고정 장소 말고 마우스로 지정"): 슬롯 고정 → 카메라 조준점(지형) 따라 이동 + 클릭([E]) 배치.
  let _ghost=null, _ghostIsl=null, _ghostId=null, _ghostValid=null, _ghostOK=false, _ghostYawOff=0;
  const _grc=new THREE.Raycaster();
  function _tintGhost(v){ if(!_ghost || _ghostValid===v) return; _ghostValid=v; const hex=v?0x1b6b2b:0x8a1f1f;
    _ghost.traverse(o=>{ if(o.isMesh && o.material && o.material.emissive) o.material.emissive.setHex(hex); }); }
  function ghostCancel(){ if(_ghost){ scene.remove(_ghost); _ghost=null; } _ghostIsl=null; _ghostId=null; _ghostValid=null; _ghostOK=false; _ghostYawOff=0; }
  // ★사령관 "R로 돌리고 좌클릭으로 건설"(2026-07-17, wharf.js G키 항구건설과 동일 조작으로 통일) — 90도씩 추가 회전.
  function ghostRotate(){ if(_ghost) _ghostYawOff += Math.PI/2; }
  async function ghostShow(island, id){
    ghostCancel();
    if(!island || island.owner!=='player' || !BUILDINGS[id]) return { ok:false, reason:'bad' };
    if(!terrainLoadedFor(island)) return { ok:false, reason:'not-loaded' };
    if(countOf(island, id) >= maxOf(id)) return { ok:false, reason:'max-kind', max:maxOf(id) };   // 🔢 상한 도달(감사 B1) — 고스트도 안 띄움
    if(freeSlot(island)<0) return { ok:false, reason:'no-slot' };
    const proto = await loadProto(id, colorFor(island)); if(!proto) return { ok:false, reason:'load-fail' };
    const mesh = proto.clone(true); const p0 = slotPos(island, 0); mesh.position.set(p0.x, p0.y, p0.z);   // 초기 위치(update가 조준 따라 이동)
    mesh.traverse(o=>{ if(o.isMesh){ o.material = (o.material && o.material.clone) ? o.material.clone() : o.material;
      if(o.material){ o.material.transparent=true; o.material.opacity=0.5; o.material.depthWrite=false; } } });   // 반투명 고스트
    scene.add(mesh);
    _ghost=mesh; _ghostIsl=island; _ghostId=id; _ghostValid=null; _ghostOK=false; _tintGhost(false);
    return { ok:true };
  }
  // 카메라 조준(중앙) → 지형점으로 고스트 이동 + 유효성(육지·항구근처·비겹침). 매 프레임.
  function _updateGhost(){
    if(!_ghost || !_ghostIsl || !ctx.camera) return;
    const collide = ctx.terrain && ctx.terrain.collide;
    _grc.setFromCamera({x:0,y:0}, ctx.camera);
    const hits = collide ? _grc.intersectObjects(collide, true) : [];
    if(!hits.length){ _ghostOK=false; _tintGhost(false); return; }
    const pt=hits[0].point, wl=ctx.water?ctx.water.level:0, an=anchorOf(_ghostIsl);
    _ghost.position.set(pt.x, pt.y, pt.z);
    _ghost.rotation.y = Math.atan2(an.x-pt.x, an.z-pt.z) + _ghostYawOff;   // 항구 기본방향 + R 회전 오프셋
    let overlap=false; for(const b of (_ghostIsl.buildings||[])){ if(Math.hypot(pt.x-b.x, pt.z-b.z)<MIN_GAP){ overlap=true; break; } }
    const ok = (pt.y > wl+0.5) && (Math.hypot(pt.x-an.x, pt.z-an.z) < slotR()*3.5) && !overlap;   // 육지 + 항구근처(과도한 원거리 금지) + 비겹침
    _ghostOK=ok; _tintGhost(ok);
  }
  async function ghostConfirm(){
    if(!_ghost || !_ghostIsl || !_ghostId) return { ok:false, reason:'no-ghost' };
    if(!_ghostOK) return { ok:false, reason:'bad-spot' };   // 무효 위치(바다/원거리/겹침)
    const isl=_ghostIsl, id=_ghostId, pos={ x:_ghost.position.x, y:_ghost.position.y, z:_ghost.position.z, rotY:_ghost.rotation.y }; ghostCancel();
    return await build(isl, id, pos);   // 마우스 지정 위치 + R로 돌린 방향으로 건설
  }
  function ghostActive(){ return !!_ghost; }

  // ── 🌱 무료·무소유 배치(축6 종족섬 자동성장) — build()와 별개 경로. 골드 차감·소유권 체크 없음. ──
  //   capture.js 가 종족섬(owner≠player)에 카탈로그 건물을 조용히 세울 때 사용. 슬롯 꽉 차면 조용히 no-op(정상).
  async function placeFree(island, id){
    if(!island || !BUILDINGS[id]) return null;
    if(countOf(island, id) >= maxOf(id)) return null;   // 🔢 동일 건물 상한 — 종족섬도 한 종류로 도배되지 않게
    // ★Lv 슬롯은 플레이어 성장 보상이므로 종족섬엔 적용하지 않는다(구 동작=8칸 유지). 꽉 차면 조용히 no-op.
    const used=new Set((island.buildings||[]).map(b=>b.slot)); let slot=-1;
    for(let i=0;i<slotMax();i++) if(!used.has(i)){ slot=i; break; }
    if(slot < 0) return null;
    return await placeBuilding(island, id, slot);
  }

  // ── 효과 조회 API(다른 모듈이 호출) — 그 좌표 섬 건물들의 effect[key] 합산 ──
  function effectSum(island, key){ if(!island || !island.buildings) return 0; const bb=B(); let s=0;
    for(const rec of island.buildings){ const e=bb[rec.id] && bb[rec.id].effect; if(e && e[key]!=null) s+=e[key]; } return s; }
  function effectAt(x,z,key){ return effectSum(islandAt(x,z), key); }
  function effectGlobal(key){ let s=0; for(const c of ownedIslands()) s+=effectSum(c,key); return s; }   // 제국 전체 합산(제작 할인 등 위치 무관 효과)
  function craftDisc(){ return Math.min(0.9, effectGlobal('craftDisc')); }   // 🔧 대장간 = 제작 재료 무상 확률(상한 90%)
  // ── 건설/복원 시 건물별 사이드이펙트(수비대 배치 등) ──
  //   ★버그수정(감사 A4, 2026-07-22): 예전엔 place(island)만 넘겨 수비병이 **막사 위치와 무관하게 섬 중심(island.x+3)**에
  //     고정 스폰됐고, "이미 수비대 있으면 거부" 때문에 **2채째 막사는 병사 0명**이었다.
  //     → 건물 rec(좌표)을 넘겨 그 건물 앞에 세우고, garrison이 rec 단위로 중복을 판정한다(막사 2채 = 2명).
  function applySideEffects(island, id, rec){
    if((id==='barracks' || id==='archeryrange') && ctx.garrison?.place) ctx.garrison.place(island, rec);
  }
  // 교역 판매가 배율(시장): 1 + Σ sellMul. trade.js sell()이 호출.
  function sellMulAt(x,z){ return 1 + effectAt(x,z,'sellMul'); }
  // 채집 배율(광산/제재소): 1 + Σ. mine.js/axetree.js가 호출(P2).
  function mineMulAt(x,z){ return 1 + effectAt(x,z,'mineMul'); }
  function woodMulAt(x,z){ return 1 + effectAt(x,z,'woodMul'); }

  // ── 🌱 섬 성장 엔진 함수 ── (건물 효과값 계산 effectSum/effectGlobal과 별개 — 관심사 분리)
  //   island.growth = { pop, stability, prosperity, influence, lv }. claim.js가 growth 없이 섬을 만들므로 lazy 초기화.
  function ensureGrowth(island){ if(island && !island.growth) island.growth={ pop:0, stability:0, prosperity:0, influence:0, lv:0 }; return island? island.growth : null; }
  function growthOf(island){ return ensureGrowth(island); }   // 외부(축4 추종자·축5 세력선언) 편의 조회 — island.growth 직접 읽어도 됨.
  // Lv 재계산(한번 오른 Lv 유지 — 하락 없음). 임계값 = 향후방향_v2 §3 + 세력선언 인구 50 정합(Lv5 pop 80 ≥ 50).
  function recalcLv(island, g){
    let lv = g.lv|0;
    if(lv<1 && (island.buildings||[]).length>=1) lv=1;                          // Lv0→1: 건물 1개 이상(전초기지)
    if(lv<2 && g.pop>=10) lv=2;                                                 // Lv1→2: 작은마을
    if(lv<3 && g.pop>=25 && g.stability>=20) lv=3;                              // Lv2→3: 항구마을
    if(lv<4 && g.pop>=50 && g.prosperity>=40) lv=4;                             // Lv3→4: 항구도시
    if(lv<5 && g.pop>=80 && g.influence>=30 && g.prosperity>=60) lv=5;          // Lv4→5: 세력중심지(수도)
    if(lv>(g.lv|0)){ g.lv=lv; if(ctx.invui?.toast) ctx.invui.toast(`${island.name||'거점'} 성장 → Lv${lv}`); }
    return g.lv;
  }
  // 한 섬 1틱: 존재하는 건물 수만큼 매핑 수치 가산 + Lv 승격. (tickIncome과 같은 60s 틱에서 호출)
  function tickGrowth(island){ if(!island) return; const g=ensureGrowth(island);
    for(const rec of (island.buildings||[])){ const key=GROWTH_MAP[rec.id]; if(key) g[key]+=GROWTH_PER_TICK; }
    recalcLv(island, g); }
  // ── 이벤트 기반 즉시 성장(축3 연결 레이어) ── 교역·토벌·해전 등 "행동"이 그 자리 섬을 즉시 성장시킴.
  //   건물 틱(tickGrowth, 60s 존재 기반)과 별개 경로 — 재사용/우회 없이 독립. key는 4수치만 유효.
  const GROWTH_KEYS = ['pop','stability','prosperity','influence'];
  function bumpGrowth(island, key, amount){
    if(!island) return;
    if(!GROWTH_KEYS.includes(key)){ console.warn('[settlement] bumpGrowth 잘못된 key:', key); return; }
    const g = ensureGrowth(island);
    g[key] = Math.max(0, g[key] + (Number(amount)||0));   // 하한 0, 상한 없음(누적 관례)
    recalcLv(island, g);
  }

  // ── 골드 패시브 수입(집·방앗간, P3) + 🌱 섬 성장 — 같은 60s 틱마다 owned 섬 처리 ──
  let _incAcc=0;
  function tickIncome(dt){ _incAcc += dt; if(_incAcc < 60) return; _incAcc -= 60;
    let g=0; for(const c of ownedIslands()) g += effectSum(c,'goldPerMin'); g=Math.round(g);
    if(g>0 && ctx.inventory){ ctx.inventory.addGold(g); if(ctx.invui?.toast) ctx.invui.toast(`거점 수입 +${g}골드`); if(ctx.updHotbar) ctx.updHotbar(); }
    for(const c of ownedIslands()) tickGrowth(c);   // 🌱 섬 성장 누적(골드와 같은 틱 — 새 타이머 안 만듦)
  }

  // ⛔ 구 T키 건설 패널(ensurePanel/render/openMenu/ctx.settlementMenu) **삭제** — 2026-07-22 감사 C1.
  //   호출처 0건(전수 grep 확인)인 데드코드였고, empire.js(N키)와 UI가 이중화돼 있었으며 이모지 아이콘을 써서
  //   사령관 이모지 금지 규칙과도 충돌했다. 건설 진입점은 empire.js(N키) 단일.

  // ── 세이브 복원: 저장된 buildings[] → 메시 재생성 ──
  //   ★버그수정(감사 A1, 2026-07-22): 예전엔 저장에 x/z/rotY가 없어 복원이 항상 slotPos(항구 중심 원형 링)로 떨어졌다.
  //     = 사령관이 마우스로 배치한 마을이 **리로드 한 번에 전부 링으로 되돌아감**(2026-07-15 마우스 배치 지시가 무효화).
  //     → 좌표가 있으면 그 자리 그대로, 없으면(구세이브) 기존처럼 슬롯 폴백. y는 현재 지형 기준으로 다시 앉힌다
  //       (지형 생성이 결정론이 아니면 저장 y가 어긋날 수 있어 지면 재조회가 더 안전).
  async function restore(island, saved){ if(!island || !Array.isArray(saved)) return;
    // ★기존 메시 정리 후 재구성 — 안 하면 buildings=[] 로 참조만 끊겨 씬·collide·물리바디에 유령이 남는다(A5와 같은 누수).
    for(const old of (island.buildings || [])){ if(old.mesh){ try{ scene.remove(old.mesh); }catch(_){} detachCollision(old.mesh); } }
    island.buildings=[];
    for(const s of saved){
      if(!BUILDINGS[s.id]) continue;
      const slot = (s.slot!=null) ? s.slot : restoreSlot(island);
      let pos = null;
      if(s.x!=null && s.z!=null){
        const wl = ctx.water ? ctx.water.level : 0;
        const gy = ctx.terrain?.groundAt ? ctx.terrain.groundAt(s.x, s.z, 5000) : (s.y||0);
        pos = { x:s.x, z:s.z, y:(gy>wl+0.4 ? gy : (s.y!=null ? s.y : wl)), rotY:(s.rotY||0) };
      }
      const rec = await placeBuilding(island, s.id, slot, pos);
      if(rec) applySideEffects(island, s.id, rec);
    } }

  // ── 🧹 거리 컬링(감사 A5) — 건물 메시·충돌체·물리바디가 영원히 상주하던 문제 ──
  //   worldstream은 **스트리밍 섬(rec)** 만 언로드한다. 점령섬 건물은 scene에 직접 붙어 있어 아무도 해제하지 않았고,
  //   terrain.collide 배열이 단조 증가해 groundAt 레이캐스트 비용이 계속 늘었다.
  //   ⚠️데이터(island.buildings)는 건드리지 않는다 — 효과·성장·수입은 멀리 있어도 계속 작동해야 한다(설계 의도).
  //   숨김/복귀는 mesh.parent 토글 + attach/detachCollision 만으로 처리(재로드 없음 → 히칫 없음).
  const CULL_ON = 900, CULL_OFF = 780;   // 히스테리시스(m) — 경계에서 껐다 켜졌다 하는 것 방지
  let _cullAcc = 0;
  function tickCull(dt){
    _cullAcc += dt; if(_cullAcc < 1) return; _cullAcc = 0;   // 1s 주기면 충분(항해 속도 대비)
    cullNow();
  }
  // ⚠️헤드리스 검증용 직접 호출(environment.sweepBuried와 같은 이유) — 헤드리스는 rAF가 초당 2틱 수준이고
  //   dt가 0.05로 클램프돼 **시간 누산기가 영원히 안 찬다**. 시간 기반 로직은 대기 말고 이 함수를 직접 부를 것.
  function cullNow(){
    const pp = ctx.player && ctx.player.pos; if(!pp) return;
    for(const isl of ownedIslands()){
      const d = Math.hypot(isl.x - pp.x, isl.z - pp.z);
      for(const rec of (isl.buildings || [])){
        if(!rec.mesh) continue;
        if(rec.shown && d > CULL_ON){ scene.remove(rec.mesh); detachCollision(rec.mesh); rec.shown = false; }
        else if(!rec.shown && d < CULL_OFF){ scene.add(rec.mesh); attachCollision(rec.mesh); rec.shown = true; }
      }
    }
  }

  // ── 🚪 건물 앞 [E] 상호작용(3-1 장소화) ──
  //   감사 B4: 13종 중 [E]가 있는 건 광산 하나뿐이라 "세워도 다가가서 할 게 없는 장식"이었다.
  //   BUILDINGS[id].act 가 있는 건물만 프롬프트를 띄우고, 실제 기능은 각 모듈의 기존 공개 API로 위임한다(로직 복제 금지).
  //   ⚠️mine은 dungeonrun.js가 이미 자체 [E]를 갖고 있어 act를 주지 않았다(이중 배선 금지).
  const ACT_R = 5;                      // 상호작용 반경(m) — dungeonrun 광산(4m)보다 살짝 넉넉히
  let _actNear = null, _actEPrev = false;
  function anyModalOpen(){
    return !!((ctx.empire && ctx.empire.isOpen && ctx.empire.isOpen())
      || (ctx.harbor && ctx.harbor.isOpen && ctx.harbor.isOpen())
      || (ctx.trade && ctx.trade.open)
      || (ctx.invui && ctx.invui.isOpen && ctx.invui.isOpen())
      || (ctx.dungeon && ctx.dungeon.active));
  }
  function runAct(isl, rec){
    const id = rec.id;
    if(id === 'market'){                                   // 🏪 그 섬 시세로 교역창
      if(ctx.trade && ctx.trade.openWith){ ctx.trade.openWith(rec.x, rec.z); return true; }
    } else if(id === 'blacksmith'){                        // 🔧 제작대 = 인벤 제작 탭
      if(ctx.invui && ctx.invui.open){ ctx.invui.open('craft'); return true; }
    } else if(id === 'barracks' || id === 'inn'){          // 🛡/🏨 용병·추종자 = 내 섬 패널의 해당 건물 상세로 직행
      if(ctx.empire && ctx.empire.openAt){ ctx.empire.openAt(isl, id); return true; }
    }
    return false;
  }
  function tickAct(dt){
    if(_ghost || anyModalOpen()){ _actNear = null; return; }   // 고스트 배치 중·모달 중엔 프롬프트 금지
    const pp = ctx.player && ctx.player.pos; if(!pp) return;
    let near = null, nd = ACT_R;
    for(const isl of ownedIslands()){
      if(Math.hypot(isl.x - pp.x, isl.z - pp.z) > effectRadiusOf(isl)) continue;   // 먼 섬 건너뜀(전수 순회 절감)
      for(const rec of (isl.buildings || [])){
        if(!rec.shown || !BUILDINGS[rec.id] || !BUILDINGS[rec.id].act) continue;
        const d = Math.hypot(pp.x - rec.x, pp.z - rec.z);
        if(d < nd){ nd = d; near = { isl, rec }; }
      }
    }
    if(!near){ _actNear = null; return; }
    if(!_actNear || _actNear.rec !== near.rec){ _actNear = near;
      if(ctx.invui?.toast) ctx.invui.toast(`[E] ${BUILDINGS[near.rec.id].act}`); }
    const eNow = !!(ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
    if(eNow && !_actEPrev && document.pointerLockElement === (ctx.renderer && ctx.renderer.domElement)) runAct(near.isl, near.rec);
    _actEPrev = eNow;
  }

  ctx.onUpdate(dt=>{ dt = dt||0.016; tickIncome(dt); tickCull(dt); tickAct(dt);
    if(_ghost && _ghostIsl) _updateGhost(); });   // 고스트 활성 시 카메라 조준 따라 이동+유효성(마우스 배치)

  // ── 항구(harbor) 건물 메시 = 섬 진영색. wharf.js(G키 즉시건설)가 위치·충돌 처리. ──
  async function harborMesh(island){ const p=await loadProto('harbor', colorFor(island)); return p?p.clone(true):null; }
  function harborCost(){ return (B().harbor && B().harbor.cost) || 0; }

  ctx.settlement = { BUILDINGS, build, placeFree, restore,
    effectAt, effectSum, effectGlobal, sellMulAt, mineMulAt, woodMulAt, craftDisc,
    ownedIslands, nearestOwned, islandAt, effectRadiusOf, colorFor, harborMesh, harborCost,
    canBuildAt: terrainLoadedFor,   // ★empire(N키)가 원격 미로드 섬 건설 버튼 비활성화·안내에 사용
    ghostShow, ghostConfirm, ghostCancel, ghostActive, ghostRotate,   // 🏗️ 건설 고스트 미리보기(empire.js UI 구동 — 리스트 클릭→고스트→R 회전→좌클릭/[E] 확정)
    tickGrowth, growthOf, bumpGrowth,   // 🌱 섬 성장 엔진(축4 추종자·축5 세력선언이 island.growth 참조). bumpGrowth=이벤트 즉시성장(축3 연결). island.growth 직접 읽어도 됨.
    slotN, slotMax, maxOf, freeSlot,    // 🔢 empire.js UI가 Lv 슬롯·동일건물 상한을 그대로 표시(계산 중복 금지)
    cullNow,                            // 🧹 거리 컬링 1회 강제(헤드리스 검증 전용 — rAF 누산기 우회)
    count: countOf };
  console.log('[settlement] 거점 건물 시스템 등록 — 건물 '+Object.keys(BUILDINGS).length+'종(N키 내 섬에서 건설). 효과=BAL.buildings. 슬롯=Lv연동 '+(B().slotByLv||[]).join('/'));
  return ctx.settlement;
}

// [근거]
// 확정:
//  - owned 섬 = ctx.claimed(owner='player'), 항구 = dockPoint — claim.js 실코드.
//  - FBX+단일아틀라스 정규화 배치 = build.js fitDungeon 검증된 패턴.
//  - 건물 골드 비용/효과 SSOT = BAL.buildings — [[voyage-balance-ssot]] 원칙.
//  - 건물 FBX는 색상 폴더에만 존재(neutral=구조물) — 디스크 스캔. v1 blue 고정.
// 제안(앤 판단):
//  - 슬롯 링 배치(조준 없이) — 항구 주변 마을화 + 헤드리스 검증 가능. 자유배치는 후순위.
//  - 건물 12종 카탈로그·효과 key(sellMul/mineMul/woodMul/goldPerMin 등) — 대화 합의 기반, 수치는 BAL서 컨펌.
//  - 골드 수입 60s 틱 — 집·방앗간 패시브(P3).
// 🌱 섬 성장 엔진(2026-07-09 추가):
//  확정:
//   - 4수치(pop/stability/prosperity/influence)·Lv0~5 단계·건물→수치 매핑 = 향후방향.md §11·§12, 향후방향_v2.md §3 정의.
//   - 평판 3축과 동일 패턴(0부터 누적·하한 0·상한/하락 없음) = reputation.js SSOT 관례.
//   - island.growth는 섬 객체 필드 → save.js claimed 직렬화에 growth 왕복 최소 추가(그 외 save.js 불변).
//  제안(앤 설계 + 밸런스 확인):
//   - 틱당 +1(GROWTH_PER_TICK), 60s 틱(tickIncome 합류 — 새 타이머 없음). 8슬롯 발전섬 기준 Lv2≈3~4분·Lv5≈30분으로 확인 → 조정 없이 채택.
//   - Lv 임계값 = 앤 제안값 그대로. Lv5 pop 80 ≥ 세력선언 인구 50(향후방향_v2 §13) 정합.
//   - 안정도 감소·건물 차등가중치·인구상한·Lv하락·HUD = 이번 스코프 밖(과설계 금지).
//
// 🔍 내 섬 감사 반영(2026-07-22, `_내섬_감사.md`):
//  버그(코드 근거로 확정 후 수정):
//   - A1 세이브 배치 유실 — save.js가 {id,slot}만 저장 → restore가 항상 slotPos(원형 링). x/z/rotY 왕복으로 교정.
//   - A2 효과 반경 80m 하드코딩 — claim 점령섬 r=40 vs worldstream 실섬 r=120 → 큰 섬 절반에서 채광/벌목 배율 무효.
//        islandAt을 섬별 (r + slotRadius + EFF_PAD)로 교체.
//   - A4 막사 수비병이 섬 중심 고정 스폰 + 2채째 무시 — applySideEffects가 건물 rec을 넘기고 garrison이 rec 단위 판정.
//   - A5 메시/충돌체/물리바디 영구 상주 — 그룹 1개 collide 등록 + 거리 컬링(CULL_ON/OFF 히스테리시스).
//   - C1 데드 T키 패널 삭제(호출처 0) · 이모지 icon 필드 폐지.
//  설계(사령관 컨펌 2026-07-22 "페이즈3까지 끝까지"):
//   - B1 동일 건물 상한 BAL.buildings[id].max — "제일 싼 goldPerMin 도배"가 최적해였던 것 차단.
//   - B2 슬롯을 Lv 연동(BAL.buildings.slotByLv) — Lv를 올릴 실질 보상 신설. 링 분할수는 slotMax 고정(복원 좌표 안정).
//   - B4 건물 앞 [E](BUILDINGS[id].act) — 시장=교역 / 대장간=제작 / 막사·여관=해당 상세. 기능은 기존 API 위임(복제 없음).
//   - B5 우물 빈 효과 회수 → guardRegen(수비대 비전투 회복, garrison.js가 소비).
