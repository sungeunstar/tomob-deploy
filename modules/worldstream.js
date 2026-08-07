// worldstream.js — 오픈월드 섬 스트리밍 (P1 매니저 + P2 충돌·나무·LOD).
//   개념: worldmap.canon.json(203섬 좌표+prefab)이 개념상 월드 전체. 실제 3D는 플레이어 근처 섬만 로딩.
//   다가가면 페이드인, 멀어지면 언로딩(메모리 회수). 배가 느려 미리 로딩 시간 충분 = 전체화면 로딩 없음.
//   P1 = 지형 메시 스트리밍. P2 = ①섬 트라이메시 충돌(상륙·보행) ②나무 산포(근처 섬만) ③먼 섬=민둥 실루엣 LOD.
//   game.html ?stream=1 일 때만 활성(기존 게임 무영향).
//
//   재사용: tutorial.html loadRealIsland(좌표에 프리팹 3D) + terrain.collide/addTrimesh(충돌) + environment kaykit_nature 나무.
//   데이터: canon island={id,x,z,r,prefab} / backup.sessions[prefab].objs=[{url:FBX,x,y,z,scale}] (이름 규약 1:1).

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DestructibleMesh } from 'three-pinata';   // 🪓 스트리밍 섬 나무 벌목화(environment 방식과 동일) — 사령관 #20
import { locationReveal } from './uikit.js';   // 해역 진입 배너(P3)
import { BAL } from './balance.js';   // 🏝️ 섬 크기 손잡이(BAL.island) — 홈섬(game.html)과 같은 SSOT
import { TRIBES, tribeById } from './tribes.js';   // 🏴 섬 = 12부족 소유(사령관: 섬은 이미 중립 부족이 점령 중)

const CANON_URL  = '/worldmap.canon.json';
const BACKUP_URL = '/voyage_islands_backup.json';
const TERRAIN_TEX= '/obj/lowpoly_terrain/Terrain_Assets/Textures/CPT_Terrain_Texture_Atlas_01.png';
// ★2026-07-10(사령관 "산이없음/모양이다르다"): terrain.js(홈섬 로더)는 lowpoly_terrain 카테고리 FBX에
//   0.01 베이스 스케일을 곱한다(원본 FBX가 ~수만 유닛짜리라 실 게임 단위로 줄여야 함). 여기 스트리밍 로더는
//   이 보정이 없어서 섬 원본 지오메트리가 100배 큰 채로 로드 → canon.r 맞춤 축소가 그만큼 더 세게 걸려
//   지형 굴곡(산 등)이 짓눌려 납작하게 사라졌었다. terrain.js와 동일한 카테고리 판정+0.01 보정 적용.
const LOWPOLY_TERRAIN = new Set(['Islands','Terrain','Mountains','River','Water','Ice','Clouds']);
const TREE_TYPES = ['Tree_1_A','Tree_1_C','Tree_2_B','Tree_2_D','Tree_3_A','Tree_3_C','Tree_4_B','Tree_4_C'];   // environment 20종 중 서브셋

import { WORLD_SCALE, filterCanonIslands } from './islands.js';   // 🧭 canon→월드 SSOT(R5 승격) + R6 섬목록 필터(navmap과 공유 — 사령관 2026-07-09)
const LOAD_R   = 2800;      // 이 반경 내 섬 지형 로딩
const UNLOAD_R = 3600;      // 이 반경 밖 섬 언로딩 (히스테리시스)
const TREE_NEAR= 1700;      // 이 반경 내 섬에만 나무 산포(가까이 오면 채움) — 먼 섬은 민둥 실루엣
const TREE_FAR = 2100;      // 이 반경 밖으로 멀어지면 나무 제거(지형은 유지)
const FADE_SEC = 1.6;

export async function initWorldstream(ctx){
  let canon, backup;
  // ★2026-07-10 수정(사령관 "3D엔 있는데 지도엔 없는 섬"): navmap.js는 ?t=Date.now()로 캐시를 우회하는데
  //   여긴 캐시버스터가 없어서 브라우저가 옛날 worldmap.canon.json을 계속 재사용 → 지도(최신)와 3D(캐시된 구버전)가 서로 다른 섬 배치를 그림.
  try { [canon, backup] = await Promise.all([ fetch(CANON_URL+'?t='+Date.now()).then(r=>r.json()), fetch(BACKUP_URL).then(r=>r.json()) ]); }
  catch(e){ console.warn('[worldstream] 데이터 로드 실패', e&&e.message); return null; }
  // ★terrain.js와 동일한 카테고리(byUrl) 인덱스 — lowpoly_terrain 에셋 0.01 베이스 스케일 판정용(위 주석 참조).
  const _byUrlCat = new Map();
  try {
    const [ti,ai] = await Promise.all([ fetch('/terrain-index.json').then(r=>r.json()).catch(()=>[]), fetch('/asset-index.json').then(r=>r.json()).catch(()=>[]) ]);
    [...ti,...ai].forEach(m=>_byUrlCat.set(m.url, m.category));
  } catch(_){}
  //   ⚠️ 원점(0,0) 섬 제외: isle0이 canon 생성 아티팩트로 (0,0)에 박혀 있어(유일) 월드 중앙에 유령 부족섬('이방용병의섬')이
  //     3D로 렌더되나 미니맵·월드맵엔 안 뜸(사령관 2026-07-04). 홈=isle31·스폰들과 무관해 제외 안전.
  //   필터 로직 본체 = islands.js filterCanonIslands() (R6, navmap.js와 공유 SSOT — 사령관 2026-07-09)
  const islands = filterCanonIslands(canon.islands, backup.sessions);
  const tl = new THREE.TextureLoader(); const atlas = tl.load(encodeURI(TERRAIN_TEX)); atlas.colorSpace=THREE.SRGBColorSpace; atlas.flipY=false;
  const fbxL = new FBXLoader(); fbxL.setResourcePath('/obj/lowpoly_terrain/Terrain_Assets/Textures/');
  const _fbxCache={};
  const loadFBX = url => _fbxCache[url] || (_fbxCache[url]=new Promise((res,rej)=>fbxL.load(encodeURI(url),res,undefined,rej)));
  // ★2026-07-13 공유 지오메트리 참조카운트(사령관 버그#1): 같은 FBX를 쓰는 섬이 여러 개일 때(예: '소형섬2'가 13개 섬 재사용,
  //   서로 다른 프리팹도 CPT_Island_H_a_06.fbx 공유) src.clone(true)는 three.js 규약상 geometry를 얕은 참조로만 복사 →
  //   모든 인스턴스가 _fbxCache의 같은 BufferGeometry를 공유한다. 한 섬이 UNLOAD 시 disposeGroup이 무조건 geometry.dispose()를
  //   호출하면 아직 로드된 다른 섬의 GPU 버퍼까지 해제돼 그 섬이 깨지거나 재업로드 플리커가 난다. geo별 사용중 인스턴스 수를
  //   세어 0이 될 때만 실제 dispose. (인스턴스마다 clone하는 나무/광석 geo는 여기 등록 안 됨 → disposeGroup이 기존대로 즉시 dispose)
  const _geoRC = new Map();   // BufferGeometry → 아직 로드돼 있는 인스턴스 수
  function _geoRetain(obj){ obj.traverse(n=>{ if(n.isMesh && n.geometry){ _geoRC.set(n.geometry, (_geoRC.get(n.geometry)||0)+1); } }); }

  // ── 나무 프로토타입 프리로드(kaykit_nature) — environment 방식(geo/mat 추출, 높이1 정규화·밑동 y0)으로
  //   통일해야 DestructibleMesh 벌목이 됨. (environment.js:78-86과 동일 절차) ──
  const capMat=new THREE.MeshStandardMaterial({color:0xcea463,roughness:0.85,side:THREE.DoubleSide});   // 절단면(벌목 그루터기 단면)
  const glL=new GLTFLoader(); const TREE_PROTOS=[];
  await Promise.all(TREE_TYPES.map(n=> glL.loadAsync(`/kaykit_nature/${n}_Color1.gltf`).then(g=>{
    let src=null; g.scene.updateMatrixWorld(true); g.scene.traverse(o=>{ if(o.isMesh && !src) src=o; });
    if(!src) return;
    let geo=src.geometry.index?src.geometry.toNonIndexed():src.geometry.clone();
    src.updateMatrixWorld(true); geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox(); let bb=geo.boundingBox; const s=1/(bb.max.y-bb.min.y);
    geo.scale(s,s,s); geo.computeBoundingBox(); bb=geo.boundingBox; geo.translate(0,-bb.min.y,0);
    const mat=Array.isArray(src.material)?src.material[0]:src.material; mat.side=THREE.DoubleSide; if(mat.map)mat.map.colorSpace=THREE.SRGBColorSpace; mat.needsUpdate=true;
    TREE_PROTOS.push({name:n, geo, mat});
  }).catch(()=>{})));
  // ⛏️ 광석용 돌 프로토(kaykit Rock 1종) — mine.registerNode가 채광 가능 Brush 광맥으로 교체하므로 시각 모델은 간단해도 됨(#20).
  let ORE_PROTO=null;
  await glL.loadAsync('/kaykit_nature/Rock_1_A_Color1.gltf').then(g=>{
    let src=null; g.scene.traverse(o=>{ if(o.isMesh&&!src)src=o; }); if(!src)return;
    let geo=src.geometry.index?src.geometry.toNonIndexed():src.geometry.clone();
    src.updateMatrixWorld(true); geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox(); const s=geo.boundingBox.getSize(new THREE.Vector3()); const mx=Math.max(s.x,s.y,s.z)||1;
    geo.scale(1/mx,1/mx,1/mx); geo.computeBoundingBox(); geo.translate(0,-geo.boundingBox.min.y,0);
    const mat=Array.isArray(src.material)?src.material[0]:src.material; if(mat.map)mat.map.colorSpace=THREE.SRGBColorSpace;
    ORE_PROTO={geo, mat};
  }).catch(()=>{});
  // ★버그수정(2026-07-13 밤): '구리광석'은 mine.js ORES 목록의 실제 명칭('구리')과 안 맞아 nameIdx 조회 실패
  //   → registerOreNode가 항상 stoneIdx로 폴백, 스트림 섬 구리 광맥이 전부 '돌'로 등록되던 것. mine.js 명칭과 일치시킴.
  const ORE_NAMES=['돌','철광석','구리'];

  const _prefCenter={};
  function prefabCenter(prefab){ if(_prefCenter[prefab]) return _prefCenter[prefab];
    const objs=(backup.sessions[prefab].objs||[]).filter(o=>!/\/Clouds\//i.test(o.url));
    let cx=0,cz=0,n=0; objs.forEach(o=>{ cx+=o.x; cz+=o.z; n++; }); return (_prefCenter[prefab]={x:n?cx/n:0, z:n?cz/n:0});
  }

  // ── 바다 확대: 스트림 섬 로딩 반경(UNLOAD_R) 밖까지 물이 덮게(먼 섬이 물 밖에 떠 "짤리던" 것 해소). 물 평면은 카메라 추종(water.js). ──
  try { if(ctx.water && ctx.water.mesh){ const need=Math.ceil((UNLOAD_R*2.5)/3000*10)/10;   // 3000=water.js 평면폭
    if((ctx.water.mesh.scale.x||1) < need){ ctx.water.mesh.scale.set(need,1,need); console.log('[worldstream] 바다 확대 x'+need); } } } catch(_){}

  // ── P3: 해역 진입 배너(진영/영해). 근처 섬 점령 중이면 사령관 이름, 아니면 진영(남은자/파수꾼)/미개척. 해안명은 자체 판단(pool). ──
  const FAC={ remnant:'남은자', watch:'파수꾼' };
  const _qp=new URLSearchParams(location.search);
  const PNAME=(_qp.get('name')||'').trim()||'선장';
  const PFAC=(_qp.get('faction')||'').trim();   // remnant | watch
  const COASTS=['잿빛 여울','안개 물목','부서진 등대곶','소금바람 해안','검은 모래톱','늑대이빨 암초','잊혀진 만','첫별 여울','스올의 문턱','아라랏 그림자','붉은 사구','고래뼈 해안','유리 물결','서리 어금니','천 개의 돛 무덤','침묵의 협만'];
  const _hash=s=>{ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };
  // ★섬 = 12부족 소유(결정론, id 해시). 진영(remnant/watch/neutral)은 그 부족의 lean에서 파생 → 일관.
  const _outpostDone = new Set();   // 부족 거점(깃발) 배치한 섬 id (스트림 재로드 중복 방지)
  const islandTribe=isle=> TRIBES[_hash(isle.id) % TRIBES.length].id;
  const islandFaction=isle=>{ const t=tribeById(islandTribe(isle)); return t ? t.lean : 'neutral'; };
  const ownedByPlayer=isle=>{ if(!ctx.claimed) return false; const wx=isle.x*WORLD_SCALE, wz=isle.z*WORLD_SCALE;
    return ctx.claimed.some(c=> c.owner==='player' && ((c.islandId&&c.islandId===isle.id)||Math.hypot((c.x)-wx,(c.z)-wz) < (isle.r||120)+140) ); };
  // ★홈섬 = NPC 점령 제외(사령관 "플레이어 시작섬은 NPC 점령 빼야"). 부족 거점·부족 배너 없음(첫 항구 건설 게이트도 통과).
  //   2026-07-10(카브 특수취급 폐지): ctx.homeIslandId(캐릭터 생성 시 랜덤배정된 isSpawn 섬 id)가 있으면 id로 정확히 판정 —
  //   더 이상 "원점과의 거리" 어림짐작(구모드) 아님. id 없는 샌드박스/레거시 경로만 거리 폴백 유지.
  const HOME = (ctx.terrain && ctx.terrain.spawn) ? { x:ctx.terrain.spawn.x, z:ctx.terrain.spawn.z }
    : (ctx.player && ctx.player.pos ? { x:ctx.player.pos.x, z:ctx.player.pos.z } : { x:0, z:0 });
  const HOME_R = 800;   // 인접 canon 섬은 ~2250m 떨어져 있어 홈 반경 800이 이웃을 잘못 잡지 않음
  const isHome = ctx.homeIslandId
    ? (isle => isle.id === ctx.homeIslandId)
    : (isle => Math.hypot(isle.x*WORLD_SCALE - HOME.x, isle.z*WORLD_SCALE - HOME.z) < HOME_R);
  // ★스폰섬 3D 미렌더 안전망(사령관 2026-07-10 "무조건 섬에 상륙할 땐 3D 렌더되게"):
  //   홈섬은 원래 terrain.js가 로컬 로드하므로 worldstream이 스킵(중복 방지). 그런데 오프셋 불일치·세션 유실 등으로
  //   terrain이 홈섬을 못 그리면 아무도 안 그려 "내 위치에 섬이 없음" → terrain이 실제 지형 오브젝트를 로드했을 때만 스킵.
  const _terrainHasIsland = !!(ctx.terrain && Array.isArray(ctx.terrain._allObjs) && ctx.terrain._allObjs.length > 0);
  const skipHomeLoad = isle => isHome(isle) && _terrainHasIsland;   // terrain이 홈을 그렸을 때만 스트림 스킵
  if(!_terrainHasIsland) console.warn('[worldstream] terrain 홈섬 미로드 감지 — 홈섬도 스트리밍으로 렌더(안전망)');

  // ── 🏰 온보딩 첫 정복 = 본편과 동일한 정식 공성전(사령관 확정 2026-07-14) ──
  //   기본 정책(DEC-013): 홈 3500유닛 내 섬 = tier0(방벽 0·평화 점령). 하지만 ?quest=1(1차 퀘스트라인)일 때
  //   온보딩이 겨냥하는 그 첫 섬 — questline.pickTarget()이 잡는 "홈에서 가장 가까운 비홈 부족섬" 딱 1곳 — 만은
  //   본편 먼 섬과 동일한 방벽·포대(claim.buildCoastalRampart, tier≥1)를 세워, 방금 배운 조타+현측포격(Q/E)으로
  //   방벽을 부순 뒤에야 상륙·점령하게 한다(capture.towersAlive 게이트 정상 작동).
  //   ★이 예외는 이 한 섬에만 국한 — 다른 근거리 섬의 tier0 무방비(DEC-013)·먼 섬 방벽 로직은 절대 안 건드림.
  // v3 온보딩은 공성 대신 차원문 던전으로 점령한다. 구 공성 코드는 보존하되 자동 예외 발동은 끈다.
  const _questOnboarding = false;
  const ONBOARD_TIER = 2;   // 튜토(막 배운 Q/E 현측포격)로 격파 가능한 수준 = 포대 2기·중간 호(본편 tier2와 동일 체급, 워크오버 아님)
  let _onboardTargetId = null;
  if(_questOnboarding){
    let bd = Infinity;
    for(const isle of islands){ if(isHome(isle)) continue;
      const d = Math.hypot(isle.x*WORLD_SCALE - HOME.x, isle.z*WORLD_SCALE - HOME.z);
      if(d < bd){ bd = d; _onboardTargetId = isle.id; } }
    if(_onboardTargetId) console.log('[worldstream] 🏰 온보딩 첫 정복 섬', _onboardTargetId, '→ tier'+ONBOARD_TIER+' 정식 공성전(DEC-013 예외)');
  }
  let _lastBanner=null;
  function regionBanner(isle){
    let name, band, sub=COASTS[_hash(isle.id)%COASTS.length];
    if(isHome(isle)){ name='고향의 섬'; band='내 영해'; sub='첫 항해가 시작된 곳'; }   // ★홈섬 = 부족 아님(플레이어 스폰 바인딩섬). 프리팹은 랜덤배정이라 "카브" 고정명 아님.
    else if(ownedByPlayer(isle)){ name=`${PNAME}님의 해안`; band='내 영해'; }
    else { const t=tribeById(islandTribe(isle)); const f=t?t.lean:'neutral';
      name = t ? `${t.ko}의 섬` : '미개척 해안';                              // ★부족 소유 섬
      band = (f==='neutral') ? '중립 부족' : (f===PFAC ? '우호 부족' : '적대 부족'); }
    try{ locationReveal({ name, band, sub }); }catch(_){}
  }

  const loaded = new Map();   // id → { group, trees, fade, loading, collided }
  let _loadingCount = 0; const MAX_CONCURRENT = 1;

  // 섬 그룹 위 육지 지점 탐색. ★해안 근처(가장자리) 우선(사령관 #19: 깃발이 섬 중앙이라 항구 못 지음) —
  //   바깥부터 안쪽으로 나선하며 "마른땅이면서 조금 바깥은 물"인 해안 지점을 우선 채택. 못 찾으면 안쪽 마른땅 폴백.
  const _landRC = new THREE.Raycaster(); _landRC.far = 2000; const _landDN = new THREE.Vector3(0,-1,0);
  function _landY(px,pz){ _landRC.set(new THREE.Vector3(px,600,pz),_landDN); const h=_landRC.intersectObject(_lastLandGroup,true); return (h.length&&h[0].point.y>0.6)?h[0].point.y:null; }
  let _lastLandGroup=null;
  function _findLandOnIsland(group, wx, wz, rad){
    _lastLandGroup=group;
    for(let f=0.82; f>=0.15; f-=0.1){
      for(let s=0;s<12;s++){ const a=(s/12+f*0.3)*6.2832; const px=wx+Math.cos(a)*rad*f, pz=wz+Math.sin(a)*rad*f;
        const y=_landY(px,pz); if(y==null) continue;
        const ox=wx+Math.cos(a)*rad*(f+0.15), oz=wz+Math.sin(a)*rad*(f+0.15);   // 살짝 바깥
        if(_landY(ox,oz)==null) return { x:px, z:pz, y };   // 바깥이 물 = 해안(항구 지을 가장자리)
      }
    }
    for(let R=0;R<=rad;R+=Math.max(6,rad*0.15)){ for(let s=0;s<8;s++){ const a=s/8*6.2832; const px=wx+Math.cos(a)*R,pz=wz+Math.sin(a)*R; const y=_landY(px,pz); if(y!=null) return {x:px,z:pz,y}; } }   // 폴백: 아무 마른땅
    return null;
  }

  // ⚡ 최적화 ③(스트림-인 분산): 트라이메시 빌드(Float32Array 굽기+Rapier BVH)를 섬 전체 한 번에 하면
  //   로드 순간 히칫 → 프레임당 1메시씩 큐로 분산. THREE collide(groundAt)는 즉시, 물리는 수십 프레임에 걸쳐 완성.
  const _triQ=[];   // { group, meshes:[], i }
  function queueTrimesh(group){
    if(group.userData._triQueued) return; group.userData._triQueued=true;
    group.updateWorldMatrix(true,true); group.userData._bodies=group.userData._bodies||[];
    const meshes=[]; group.traverse(o=>{ if(o.isMesh&&o.geometry&&o.geometry.attributes.position) meshes.push(o); });
    _triQ.push({ group, meshes, i:0 });
  }
  function addCollision(group){ try {
    if(ctx.terrain && ctx.terrain.collide){
      if(ctx.terrain.collide.indexOf(group) < 0) ctx.terrain.collide.push(group);   // 중복 등록 가드(재시도 안전)
      if(!(group.userData._bodies && group.userData._bodies.length) && !group.userData._triQueued){
        if(ctx.terrain.addTrimeshMesh) queueTrimesh(group);                          // ③분산 경로(기본)
        else if(ctx.terrain.addTrimesh) ctx.terrain.addTrimesh(group);               // 폴백(구 terrain 계약)
      }
      return true; }
  } catch(_){} return false; }
  function removeCollision(group){ try {
    if(ctx.terrain && ctx.terrain.collide){ const i=ctx.terrain.collide.indexOf(group); if(i>=0) ctx.terrain.collide.splice(i,1); if(ctx.terrain.removeTrimesh) ctx.terrain.removeTrimesh(group); }
  } catch(_){} }

  // ── 🌊 저지대 섬 침수 방지 리프트(사령관 2026-07-10 "다른 섬들 바다가 넘침") ──
  //   섬 배치 높이는 terrain.js(홈섬 로더)와 동일(프리팹 o.y 그대로)이라 로더 버그는 아니다. 다만 소형섬3처럼
  //   원본이 납작한 저지대 섬은 게르스트너 파도 마루(≈해수면+crest)가 낮은 해안을 넘나든다. 그룹 표면을 격자
  //   레이캐스트로 스캔해 "마른 땅 하위 15%(=해안선)"가 파도 마루+여유 위로 오도록 소량만 들어올린다.
  //   자기-스케일: 이미 충분히 높은 섬은 lift≈0, 진짜 저지대 섬만 최대 5유닛까지. (x,z·겹침 좌표 무영향)
  let _sea=null, _crest=null;
  function _seaCrest(){
    if(_sea!==null) return;
    _sea = (ctx.water && ctx.water.level!=null) ? ctx.water.level : 0;
    let c=0;
    if(ctx.water && ctx.water.heightAt){ for(let i=0;i<80;i++){ const h=ctx.water.heightAt((i*131)%4000-2000,(i*197)%4000-2000)-_sea; if(h>c) c=h; } }
    _crest = c>0.5 ? c : 3;   // 물 미준비 폴백
  }
  function islandLift(group){
    _seaCrest();
    const box=new THREE.Box3().setFromObject(group); if(!isFinite(box.max.y)||!isFinite(box.min.y)) return 0;
    const c=box.getCenter(new THREE.Vector3()), s=box.getSize(new THREE.Vector3());
    const rc=new THREE.Raycaster(); rc.far=(box.max.y-box.min.y)+200; const DN=new THREE.Vector3(0,-1,0);
    const N=13, dry=[];
    for(let ix=0;ix<N;ix++)for(let iz=0;iz<N;iz++){
      const x=c.x+(ix/(N-1)-0.5)*s.x*0.96, z=c.z+(iz/(N-1)-0.5)*s.z*0.96;
      rc.set(new THREE.Vector3(x, box.max.y+50, z), DN);
      const h=rc.intersectObject(group,true);
      if(h.length && h[0].point.y>_sea) dry.push(h[0].point.y);
    }
    if(dry.length<4) return 0;
    dry.sort((a,b)=>a-b);
    const shore=dry[Math.floor((dry.length-1)*0.15)];   // 해안(마른 땅 하위 15%)
    return Math.max(0, Math.min(5, (_sea+_crest+1)-shore));
  }

  async function loadIsland(isle){
    if(loaded.has(isle.id)) return;
    loaded.set(isle.id, { group:null, trees:null, fade:0, loading:true, collided:false });
    _loadingCount++;
    try {
      const sess = backup.sessions[isle.prefab]; const c = prefabCenter(isle.prefab);
      const group = new THREE.Group(); group.name = 'ws_'+isle.id;
      for(const o of (sess.objs||[])){
        if(/\/Clouds\//i.test(o.url)) continue;
        try {
          const src = await loadFBX(o.url); const m = src.clone(true);
          const cat = _byUrlCat.get(o.url);
          // ★2026-07-10(사령관 "근처 종족섬이 회색 민둥/병신같다"): 예전엔 여기서 재질을 MeshStandardMaterial+공유아틀라스로
          //   통째 교체했는데, 그 아틀라스 flipY가 FBX UV와 어긋나 풀(초록) 대신 바위(회색) 밴드를 샘플링 → 홈섬 제외
          //   모든 스트리밍 섬이 회색 민둥으로 렌더됐다(라이브 검증: flip 뒤집으니 terrain.js 렌더와 일치). 근본 해결로
          //   terrain.js(홈섬 로더)처럼 FBX 원본 재질(자기 텍스처=correct flip)을 살린다. 단 인스턴스별 독립 페이드 위해
          //   재질만 clone(맵 텍스처 객체는 공유 OK). 맵 없는 지형만 아틀라스 폴백(terrain.js §38-39과 동일 규칙).
          m.traverse(n=>{ if(n.isMesh){
            const cloned = Array.isArray(n.material) ? n.material.map(mm=>mm.clone()) : n.material.clone();
            (Array.isArray(cloned)?cloned:[cloned]).forEach(mm=>{
              mm.side=THREE.DoubleSide; if(mm.map) mm.map.colorSpace=THREE.SRGBColorSpace;
              if((LOWPOLY_TERRAIN.has(cat)||!cat) && !mm.map){ mm.map=atlas; if(mm.color)mm.color.set(0xffffff); }
              mm.transparent=true; mm.opacity=0; mm.needsUpdate=true;
            });
            n.material=cloned; n.castShadow=false; n.receiveShadow=true; n.frustumCulled=true;
          } });
          const base = (LOWPOLY_TERRAIN.has(cat) || !cat) ? 0.01 : 1;   // ★terrain.js getModule()과 동일 보정(위 주석) — 없으면 산·지형 굴곡이 짓눌림
          m.position.set((o.x - c.x), o.y||0, (o.z - c.z)); m.scale.setScalar(base*(o.scale||1));
          group.add(m); _geoRetain(m);   // 공유 지오메트리 참조카운트 +1 (언로드 시 0일 때만 dispose)
        } catch(_){}
      }
      // 프리팹 내부 배치폭(대형 최대 3150m)이 canon 섬 간격보다 커 서로 겹치는 문제를 방지한다.
      // 작은 섬을 일률 반경 120으로 만들었던 구 정규화와 달리, 원본 크기는 유지하되 canon 지름을 넘는 경우만 축소한다.
      //
      // ★BUG-A6 수정(2026-08-07, 사령관 "섬들이 공중에 떠있는듯"). 이 블록에 결함이 두 개 있었다:
      //   ① **조건이 없었다** — 주석은 "넘는 경우만 축소"인데 코드엔 가드가 없어 `span < maxSpan`인 섬은 오히려 **확대**됐다.
      //      → `fit < 1`일 때만 적용해 주석의 의도(축소 전용)와 코드를 일치시킨다.
      //   ② **수직 보정이 없었다** — multiplyScalar는 y도 곱하는데 그룹 원점은 해수면(y=0) 고정이라,
      //      원점 아래로 뻗은 섬 바닥이 축소되며 원점 쪽으로 끌려 올라가 **섬 전체가 물 위로 떴다**.
      //      → 바닥면(localBox.min.y)이 축소 전 높이에 그대로 머물도록 그룹 y를 내려 보정한다.
      //      유도: 스케일 후 월드y = Y + p·f. 바닥 p=baseY가 원래 높이 baseY에 남으려면 Y = baseY·(1−f).
      //   ⛔[[voyage-terrain-procgen-distrust]] — 이 영역은 실패 이력이 있다. 수치를 새로 지어내지 않고
      //     "의도와 어긋난 부분만" 바로잡는다. 비균일 스케일·bottomAlign 재도입 아님(스케일은 여전히 균일).
      group.updateWorldMatrix(true, true);
      try{
        const localBox=new THREE.Box3().setFromObject(group);
        const localSize=localBox.getSize(new THREE.Vector3());
        const span=Math.max(localSize.x, localSize.z);
        // 🏝️ canon 반경에 맞춘다(2026-08-07 맵 재생성 후). canon r = 실제 목표 반경이므로 tier 예외·임의 배율이 없다.
        //   확대도 허용한다 — 목표보다 작은 프리팹은 키워야 tier 크기가 일관된다(구 코드는 축소만 해서 제각각이었음).
        const _IS=(BAL.island||{ fitToCanon:true });
        const maxSpan=(isle.r||120)*WORLD_SCALE*2;
        if(_IS.fitToCanon && isFinite(span) && span>0){
          const fit=maxSpan/span;
          group.scale.multiplyScalar(fit);
          group.userData._worldFit=fit;
          group.updateWorldMatrix(true, true);
        }
      }catch(_){ }
      // ⚠️ y는 0(해수면) 고정 — 그룹 원점이 곧 해수면이므로 스케일이 이미 해수면 기준 균일 축소가 된다.
      //   ⛔2026-08-07 1차 시도에서 여기에 baseY*(1-fit) 보정을 넣었다가 **지면이 물밑으로 내려가 섬이 잠겼다**.
      //     (기준면을 bbox 최하단으로 잡은 실수 — terrain.js에서 같은 실수를 하고 실측으로 확인함.) 보정 없음이 정답.
      group.position.set(isle.x*WORLD_SCALE, 0, isle.z*WORLD_SCALE);
      // 🚢 상선 섬 회피용 실제 footprint 반경 캐시(프리팹별, canon 단위) — canon isle.r(=80)이 원본크기로 렌더되는
      //   섬(반경~180)보다 훨씬 작아 상선이 섬 테두리를 뚫고 지나가던 것(사령관 2026-07-10). 렌더 bbox로 실측 → npc.js avoidIslands가 소비.
      //   ★2026-07-12 실측 척도 수정(관통 근본원인 일부): 기존 max(size.x,size.z)/2 는 'bbox 중심' 기준 반경인데, npc.js 회피원의
      //   중심은 '섬 원점(isle.x,z)'이다. prefabCenter=오브젝트 위치 평균이라 실제 지오메트리 bbox 중심과 어긋난 프리팹은
      //   그 오프셋만큼 회피원이 작아져 장축 끝이 원 밖으로 삐져나옴 → 섬 원점 기준 축별 최대 거리로 측정(오프셋 자동 포함).
      //   + islandEffRVer 버전 증가 → npc.js 가 항로 후보 캐시(_routeIsles)를 무효화(실측 갱신을 회피에 즉시 반영).
      try{ const _fb=new THREE.Box3().setFromObject(group);
        const _cx=isle.x*WORLD_SCALE, _cz=isle.z*WORLD_SCALE;
        const _rC=Math.max(Math.abs(_fb.min.x-_cx), Math.abs(_fb.max.x-_cx), Math.abs(_fb.min.z-_cz), Math.abs(_fb.max.z-_cz))/WORLD_SCALE;
        if(isFinite(_rC)&&_rC>0){ ctx.islandEffR = ctx.islandEffR || new Map();
          if(_rC > (ctx.islandEffR.get(isle.prefab)||0)){ ctx.islandEffR.set(isle.prefab, _rC); ctx.islandEffRVer=(ctx.islandEffRVer||0)+1; } } }catch(_){}
      const rec = loaded.get(isle.id);
      if(!rec){ disposeGroup(group); return; }   // 로드 도중 언로드됨
      rec.group = group; rec.loading = false; rec.fade = 0;
      ctx.scene.add(group);
      group.updateMatrixWorld(true);
      const _lift = islandLift(group);   // 🌊 저지대 침수 방지(자기-스케일) — 충돌/나무 산포 전에 적용해야 표면이 맞음
      if(_lift>0){ group.position.y += _lift; group.updateMatrixWorld(true); rec.lift=_lift; }
      rec.collided = addCollision(group);   // 상륙·보행 충돌 (★실패 시 update 루프가 재시도 — 오프닝 중 terrain 스왑 등으로 유실되던 것=QA#20)
      // 🔬 QA#20 진단: 보행(KCC)은 Rapier 트라이메시 전용 — 생성 0이면 "보이는데 밟으면 빠지는 섬". 재현 정보 수집.
      const _nb=(group.userData._bodies||[]).length;
      if(rec.collided && _nb===0) console.warn('[worldstream] ⚠️QA#20 후보 — 물리 트라이메시 0:', isle.id, isle.prefab);
      // 🏝️ R5-P1: 레지스트리 SSOT 등록 → islandLoaded 이벤트(미니맵·전투 등 구독)
      if(ctx.islands) ctx.islands.register({ id:isle.id, name:isle.name||isle.id, x:isle.x*WORLD_SCALE, z:isle.z*WORLD_SCALE,
        r:isle.r||120, kind:'stream', tribe:islandTribe(isle), faction:islandFaction(isle), group, rec });
      // ★부족 거점(깃발)은 loadIsland가 아니라 update 루프에서 섬 가까울 때 배치(scatterTrees와 동일 타이밍 = 그룹 raycast로 실제 육지 탐색 가능). 로드 직후엔 육지 못 잡아 물속 박혔음.
    } finally { _loadingCount--; }
  }

  // ── 나무 산포(근처 섬만). 섬 그룹은 canon.r로 스케일 → 나무는 별도 언스케일 그룹에 월드좌표로(정상 크기) ──
  function scatterTrees(isle, rec){
    if(!TREE_PROTOS.length || rec.trees || !rec.group) return;
    const trees = new THREE.Group(); trees.name='wst_'+isle.id;   // 위치 (0,0,0) — dm은 월드좌표로 배치(axetree sliceWorld 정합)
    const count = isle.tier==='large'?34 : isle.tier==='small'?11 : 20;   // large=중형과 반지름 동일해져(worldmap TIER_R) tier로 밀도 구분(2026-07-09)
    // ★버그수정(2026-07-13 밤, "근처 섬에 나무·돌·광물이 없음" — 라이브 실측 확정): canon isle.r/isle.x,z는
    //   논리값이라 실제 FBX 프리팹 외곽과 안 맞을 수 있음(특히 소형섬 — 실측 사례: r=80인데 실제 육지는 그보다
    //   훨씬 작아 원반 샘플링 대부분이 바다에 떨어져 레이캐스트 계속 실패 → 나무 0/11, 광물 0개). rec.group의
    //   실제 바운딩박스로 중심·반경을 재측정해 사용(측정 실패/기형이면 canon 값으로 폴백).
    let wx=isle.x*WORLD_SCALE, wz=isle.z*WORLD_SCALE, rad=(isle.r||100)*0.92;
    try{
      const bbox=new THREE.Box3().setFromObject(rec.group);
      if(!bbox.isEmpty()){
        const bsize=bbox.getSize(new THREE.Vector3()), bctr=bbox.getCenter(new THREE.Vector3());
        const measured=Math.min(bsize.x,bsize.z)/2*0.88;
        if(measured>10 && isFinite(measured)){ wx=bctr.x; wz=bctr.z; rad=measured; }
      }
    }catch(_){}
    const rc=new THREE.Raycaster(); rc.far=2000; const DN=new THREE.Vector3(0,-1,0);
    const envTREES = ctx.environment && ctx.environment.TREES;   // 🪓 axetree 벌목 대상(라이브 참조). 있으면 등록 → 벌목 가능.
    rec._treeTs = [];   // 이 섬 소유 T 객체(언로드 시 environment.TREES에서 제거)
    for(let i=0;i<count;i++){
      const a=Math.random()*6.2832, rr=Math.sqrt(Math.random())*rad;
      const px=wx+Math.cos(a)*rr, pz=wz+Math.sin(a)*rr;
      rc.set(new THREE.Vector3(px, 600, pz), DN);
      const h=rc.intersectObject(rec.group, true); if(!h.length) continue;
      const gy=h[0].point.y; if(gy < 0.4) continue;   // 물 위(마른 땅)만
      const proto=TREE_PROTOS[(Math.random()*TREE_PROTOS.length)|0]; if(!proto) continue;
      // ★environment.js:120-129와 동일 — DestructibleMesh(높이1 정규화 geo × H) + T 객체 + Rapier 줄기 충돌체.
      const H=12+Math.random()*10;   // 나무 높이(m)
      const dm=new DestructibleMesh(proto.geo.clone(), proto.mat.clone(), capMat);   // mat clone = fade opacity 개별
      dm.scale.setScalar(H); dm.position.set(px, gy, pz); dm.rotation.y=Math.random()*6.2832; dm.castShadow=true;
      dm.traverse(n=>{ if(n.isMesh&&n.material){ n.material.transparent=true; n.material.opacity=rec.fade; } });
      trees.add(dm);
      if(envTREES){
        const T={ obj:dm, name:proto.name, H, gy, chops:0, state:'stand', shake:0, hitY:gy+H*0.4, parts:[], stumps:[], fellAt:0, fallDir:new THREE.Vector3(Math.random()-0.5,0,Math.random()-0.5).normalize() };
        envTREES.push(T); rec._treeTs.push(T);
        if(ctx.world && ctx.RAPIER){ const sr=0.6+H*0.04;   // 줄기 충돌체(서있는 나무 통과 방지 — environment.js:127-130)
          const cb=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(px,gy+H/2,pz));
          ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cylinder(H/2,sr), cb); T.standCol=cb; }
      }
    }
    // ⛏️ 광석 산포(#20) — 돌 mesh + userData.ore → mine.registerNode가 채광 가능 Brush 광맥으로 교체.
    rec._oreMeshes = [];
    if(ORE_PROTO && ctx.mine && ctx.mine.registerNode){
      const oreCount = isle.tier==='large'?7 : isle.tier==='small'?2 : 4;
      for(let i=0;i<oreCount;i++){
        const a=Math.random()*6.2832, rr=Math.sqrt(Math.random())*rad;
        const px=wx+Math.cos(a)*rr, pz=wz+Math.sin(a)*rr;
        rc.set(new THREE.Vector3(px,600,pz),DN); const h=rc.intersectObject(rec.group,true); if(!h.length) continue;
        // ★2026-07-10(사령관 "바다주변에 광물이 떠있음"): 여유값 0.4는 파도(Gerstner, uWaveAmp~0.7) 마루보다 얕아서
        //   해안 근처 광물이 파도가 칠 때마다 물 위로 뜬 것처럼 보였음 — environment.js 홈섬 광물(WATER_Y+0.3=2.3) 수준으로 상향.
        const gy=h[0].point.y; if(gy<2.2) continue;
        const s=0.9+Math.random()*0.8; const mesh=new THREE.Mesh(ORE_PROTO.geo, ORE_PROTO.mat.clone());
        mesh.scale.setScalar(s*3); mesh.position.set(px, gy-0.1, pz); mesh.rotation.y=Math.random()*6.283; mesh.castShadow=true;
        mesh.userData.ore=ORE_NAMES[(Math.random()*ORE_NAMES.length)|0]; ctx.scene.add(mesh);
        try{ const R=ctx.mine.registerNode(mesh); if(R) rec._oreMeshes.push(mesh); }catch(_){ ctx.scene.remove(mesh); }
      }
    }
    ctx.scene.add(trees); rec.trees=trees;
  }
  // 🪓 언로드/제거 시 environment.TREES 등록·Rapier 줄기 충돌체 정리(누수·유령 벌목대상 방지)
  function _clearTreeRegs(rec){
    const envTREES = ctx.environment && ctx.environment.TREES;
    if(rec._treeTs){ for(const T of rec._treeTs){
      if(envTREES){ const i=envTREES.indexOf(T); if(i>=0) envTREES.splice(i,1); }
      if(T.standCol && ctx.world){ try{ ctx.world.removeRigidBody(T.standCol); }catch(_){} T.standCol=null; }   // ★null = 중복 removeRigidBody 방지(Rapier "recursive use" 크래시 차단)
    } rec._treeTs=null; }
    if(rec._oreMeshes){ for(const m of rec._oreMeshes){ try{ if(ctx.mine&&ctx.mine.unregisterNode) ctx.mine.unregisterNode(m); }catch(_){} } rec._oreMeshes=null; }
  }
  function removeTrees(rec){ if(!rec.trees) return; _clearTreeRegs(rec); ctx.scene.remove(rec.trees); disposeGroup(rec.trees); rec.trees=null; }

  function disposeGroup(group){ if(!group) return; group.traverse(n=>{ if(n.isMesh){
    const g=n.geometry;
    if(g && g.dispose){
      if(_geoRC.has(g)){ const c=(_geoRC.get(g)||0)-1;   // 공유 지오메트리: 마지막 인스턴스일 때만 실제 해제
        if(c>0) _geoRC.set(g,c); else { _geoRC.delete(g); g.dispose(); } }
      else g.dispose();   // 미등록(나무·광석 등 인스턴스별 clone) → 기존대로 즉시 해제
    }
    if(n.material){ if(Array.isArray(n.material)) n.material.forEach(m=>m.dispose&&m.dispose()); else n.material.dispose&&n.material.dispose(); } } }); }
  function unloadIsland(id){
    const rec = loaded.get(id); if(!rec) return;
    if(rec.trees){ _clearTreeRegs(rec); ctx.scene.remove(rec.trees); disposeGroup(rec.trees); }
    if(rec.group){ for(let i=_triQ.length-1;i>=0;i--) if(_triQ[i].group===rec.group) _triQ.splice(i,1);   // ③ 대기 중 빌드 잡 회수
      removeCollision(rec.group); ctx.scene.remove(rec.group); disposeGroup(rec.group); }
    if(rec.outpost && rec.outpost.owner!=='player' && ctx.capture?.removeOutpost){   // 부족 거점(비점령) 깃발 정리 → 재로드 시 재등록
      ctx.capture.removeOutpost(rec.outpost); _outpostDone.delete(id); }
    if(ctx.islands) ctx.islands.unregister(id);   // 🏝️ R5-P1: 레지스트리 해제 → islandUnloaded 이벤트
    loaded.delete(id);
  }

  // ── 스트리밍 루프 ──
  let _tick=0;
  ctx.onUpdate(dt=>{
    dt = dt||0.016;
    // ⚡ ③ 트라이메시 분산 빌드 — 프레임당 1메시(수십 프레임에 걸쳐 완성, 히칫 제거)
    if(_triQ.length && ctx.terrain && ctx.terrain.addTrimeshMesh){
      const job=_triQ[0], m=job.meshes[job.i++];
      if(m){ try{ ctx.terrain.addTrimeshMesh(m, job.group); }catch(_){} }
      if(job.i>=job.meshes.length) _triQ.shift();
    }
    // 페이드인(지형+나무)
    loaded.forEach(rec=>{ if(rec.group && rec.fade<1){ rec.fade=Math.min(1, rec.fade+dt/FADE_SEC); const done=rec.fade>=1;
      rec.group.traverse(n=>{ if(n.isMesh&&n.material){ n.material.opacity=rec.fade; if(done){ n.material.transparent=false; n.material.needsUpdate=true; } } });
      if(rec.trees) rec.trees.traverse(n=>{ if(n.isMesh&&n.material){ n.material.opacity=rec.fade; if(done) n.material.transparent=false; } });
    }});
    _tick-=dt; if(_tick>0) return; _tick=0.4;
    const p = ctx.player && ctx.player.pos; if(!p) return;

    for(const id of [...loaded.keys()]){
      const isle = islands.find(i=>i.id===id); if(!isle) continue;
      const rec = loaded.get(id);
      const d = Math.hypot(isle.x*WORLD_SCALE - p.x, isle.z*WORLD_SCALE - p.z);
      if(d > UNLOAD_R){ unloadIsland(id); continue; }
      // 나무 LOD: 가까우면 채우고, 멀어지면 뺌(지형 실루엣은 유지)
      if(rec && rec.group && !rec.loading){
        // ★R5-P1(QA#20): 충돌 등록 유실 자가치유 — 오프닝의 terrain 스왑 창에서 어댑혹 배열에 등록됐다
        //   복구 때 유실되면 "보이는데 땅이 없는 섬"이 영구화되던 것. 멤버십 실검사(0.4s 주기·수 개 섬)로 재등록.
        if(!rec.collided || (ctx.terrain && ctx.terrain.collide && ctx.terrain.collide.indexOf(rec.group) < 0))
          rec.collided = addCollision(rec.group);
        if(d < TREE_NEAR && !rec.trees) scatterTrees(isle, rec);
        else if(d > TREE_FAR && rec.trees) removeTrees(rec);
        // 🏴 부족 거점: 섬 가까울 때(그룹 렌더/육지 탐색 가능) 실제 육지에 깃발 배치(1회). 홈·점령섬 제외.
        if(d < TREE_NEAR && ctx.capture && !_outpostDone.has(id) && !ownedByPlayer(isle) && !isHome(isle)){
          const wx=isle.x*WORLD_SCALE, wz=isle.z*WORLD_SCALE;
          const land=_findLandOnIsland(rec.group, wx, wz, (isle.r||120)*0.9);
          if(land){ _outpostDone.add(id);
            // 🏰 온보딩 요새 = 성(60m)이 커서 깃발 지점을 덮음 → 점령 반경 넓게(성 근처 가면 자동 점령중, 사령관). 그 외 섬은 기본.
            const capR = (isle.id===_onboardTargetId) ? 34 : undefined;
            const o=ctx.capture.registerOutpost(islandTribe(isle), { x:land.x, z:land.z, r:capR }); rec.outpost=o;
            // ★방어 타워 티어(사령관 #18-C, 홈 거리 기반): 가까운 섬=T1(타워0=무방비)→멀수록 증가. 배 함포로 부수고 상륙.
            const homeD = Math.hypot(wx - HOME.x, wz - HOME.z);
            let tier = homeD < 3500 ? 0 : homeD < 7000 ? 1 : homeD < 11000 ? 2 : 3;
            if(isle.id === _onboardTargetId && tier < ONBOARD_TIER) tier = ONBOARD_TIER;   // 🏰 온보딩 타겟 섬 1곳만 tier 승격(정식 공성전) — 그 외 근거리 섬은 DEC-013(tier0) 그대로
            if(isle.id === _onboardTargetId && ctx.siegeFort && ctx.siegeFort.build){
              // 🏰 온보딩 첫 정복 = 신 요새(Hexagon 성+투석기탑, 함포 직격/스플래시/연쇄로 격파 → 본성 함락 → 상륙). 샌드박스 확정본.
              ctx.siegeFort.build({ x:land.x, z:land.z, islandCenter:{x:wx,z:wz}, tribe:islandTribe(isle) })
                .then(handles=>{ if(handles && o.towers) o.towers.push(...handles); })
                .catch(e=>console.warn('[worldstream] 요새 build 실패', e&&e.message));
            } else if(tier>0 && o && ctx.claim && ctx.claim.buildCoastalRampart){   // 그 외 먼 섬 = 기존 복셀 방벽(불변)
              const handles=ctx.claim.buildCoastalRampart({ x:land.x, z:land.z, islandCenter:{x:wx,z:wz}, tier, tribe:islandTribe(isle) });
              if(handles) o.towers.push(...handles); }
          }
        }
      }
    }
    if(_loadingCount < MAX_CONCURRENT){
      let best=null, bd=LOAD_R;
      for(const isle of islands){ if(loaded.has(isle.id) || skipHomeLoad(isle)) continue;   // ★홈섬은 terrain.js가 로컬 로드 시에만 스킵(안전망: 미로드면 스트림)
        const d = Math.hypot(isle.x*WORLD_SCALE - p.x, isle.z*WORLD_SCALE - p.z);
        if(d < bd){ bd=d; best=isle; } }
      if(best) loadIsland(best);
    }
    // ── P3: 해역 진입 배너 — 섬 해안에 다가가면 1회(진영/영해). 벗어나면 리셋(재진입 시 다시). ──
    //   ★2026-07-12(사령관): 오프닝 깨어남 컷신은 검정화면 뒤에서 홈섬에 스폰돼 배너가 검정 위에 먼저 떴음.
    //     ctx._suppressBanner(오프닝이 검정~전경 사이 세팅)면 억제 — _lastBanner도 안 건드려, 억제 해제 시 전경에서 자연 발동.
    if(!ctx._suppressBanner && !(ctx.dungeon && ctx.dungeon.active)){ let nb=null, nbd=1e9;   // ★던전은 오버월드에서 수평 380m만 띄운 하늘 공간(dungeonrun OFF_XZ) — 반경판정이 XZ만 봐서 홈섬 배너가 던전 안에서도 오발동하던 것
      for(const isle of islands){ const d=Math.hypot(isle.x*WORLD_SCALE - p.x, isle.z*WORLD_SCALE - p.z);
        if(d < (isle.r||120)+380 && d<nbd){ nbd=d; nb=isle; } }
      if(nb){ if(nb.id!==_lastBanner){ _lastBanner=nb.id; regionBanner(nb); } } else { _lastBanner=null; }
    }
  });

  // 🏷️ 섬 표시 이름 — 부족 소유면 "○○의 섬", 아니면 해안 이름 풀(regionBanner과 동일 규칙). gate 침공 토스트 등에서 사용.
  function isleName(isle){ if(!isle) return '이름 없는 해안';
    const t=tribeById(islandTribe(isle)); if(t) return `${t.ko}의 섬`;
    return COASTS[_hash(isle.id)%COASTS.length]; }
  ctx.worldstream = { islands, loaded, loadIsland, unloadIsland, islandTribe, islandFaction, isleName,
    WORLD_SCALE,   // 🧭 canon 단위→월드 미터 변환(questline 마커가 아직 스트림 안 된 섬 방향을 즉시 가리키게)
    status:()=>({ total:islands.length, loaded:loaded.size, withTrees:[...loaded.values()].filter(r=>r.trees).length, outposts:_outpostDone.size }) };
  console.log('[worldstream] P1+P2 활성 — canon', islands.length, '섬. 충돌·나무·LOD.');
  return ctx.worldstream;
}
