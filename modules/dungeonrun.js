// dungeonrun.js — ⛏️ 광산 던전 입장(수직 슬라이스) ★D4(2026-07-15 던전 신규) ★D4b(2026-07-16 던전 모듈러 재구축)
//   진입점: empire.js 광산(mine) 건물 패널의 "던전 입장" 버튼 → ctx.dungeon.enter(isl).
//   (일일 3회 제한 _dgLeft-- 는 empire.js가 이미 처리 — 여기서 건드리지 않는다.)
//   흐름: enter(오버월드 상태 저장 → KayKit 조각 로드 대기 → 절차생성 던전 빌드 → 텔레포트 → 웨이브 스폰) →
//         전투 → 전멸=클리어(보상+출구 포탈) → exit(던전 dispose + 오버월드 정확 복원).
//   ★D4b 공간 재구축: 휑한 원형 아레나 → KayKit Dungeon Remastered 모듈러 조각(4m 그리드) 기반
//     "방 4~6개 + 폭1 복도" 미로형 절차생성 던전. 기계 흐름(enter/exit/동결/클리어/보상/가드)은 D4 그대로.
//   좌표 설계: 던전 = 입장 지점에서 수평 +380/+380m(먼바다 상공) · 수직 +240m.
//     · 수평을 크게 안 벗어남 → worldstream 로드/언로드 무변(섬 스트리밍 churn 없음).
//     · 수직 분리 → 몹 AI·despawn·aggro가 전부 "수평 거리" 기준이라, 오버월드 몹과 상호 간섭 차단은
//       아래 "몹 동결"로 해결(수평만 믿지 않음).
//   오버월드 정지: ①살아있는 오버월드 몹 전원 동결(배열에서 빼고 씬에서 내림 → tick 자체가 안 돎, exit 시 원상복귀)
//     ②raid.setEnabled(false) ③자동저장 보류(save.js write가 ctx.dungeon.active 확인 — 던전 좌표 저장 방지)
//     ④gate.js 자정 개방 보류(던전 중 던전 바닥을 '육지'로 오인해 던전 안에 게이트가 열리는 것 방지).
//   구 dungeon.js(SDF 던전)는 미사용 — 사령관 지시 "새로 만들어라".
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // ★D4b: KayKit 조각 로더(프로젝트 관례 = three/addons)
import { BAL } from './balance.js';           // ⚖️ tierForLevel + gates pool(등급별 몬스터 풀 SSOT)
import { MATERIALS } from './inventory.js';   // 광물 보상 이름표(토스트용)
import { toast as ukToast, dialog as ukDialog, locationReveal as ukLocation } from './uikit.js';   // ★[5] 상자 개봉 = 대화창(디자인 시스템) / 던전 입장 = 지역 진입 배너
import { radialTexture } from './fxpool.js';   // 🔥 불 함정 파티클 텍스처(드래곤 브레스와 동일 방식)
import { createWaterfall, createPool } from './waterfallfx.js';   // 🏔️ 지하 2층 폭포·물웅덩이 (정본=water.js)
import { createPortal } from './portalfx.js';                     // 🚪 보스 게이트 포탈 막 (정본=gate.js)
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';   // ⚡ 정적 지오메트리 병합(드로우콜 감축)

// ══════════════════════════════════════════════════════════════════════════
// ★D4b KayKit 조각 프로토타입 — 세션 1회 로드 후 clone(드로우콜은 조각 수로 제한, 재입장 재로드 없음).
//   프로토타입 메시엔 _kaykitShared 플래그 → clone에 전파 → disposeArena가 공유 geometry/material을
//   건드리지 않음(재입장 시 클론 원본 파괴 금지). 던전 전용 생성물(불꽃/포탈)만 dispose.
// ══════════════════════════════════════════════════════════════════════════
const KIT_BASE = '/KayKit_DungeonRemastered_1.1_FREE/KayKit_DungeonRemastered_1.1_FREE/Assets/gltf/';
const KIT_NAMES = ['floor_tile_large', 'floor_dirt_large_rocky', 'wall', 'wall_doorway',
                   'pillar', 'column', 'chest_gold', 'barrel_small', 'banner_red', 'torch_mounted',
                   // ★2026-07-16(사령관 개선): 계단(상하 이동)·상자더미(오를 수 있는 블럭)·스파이크 함정 타일
                   'stairs', 'crates_stacked', 'floor_tile_big_spikes',
                   // ★2026-07-16(사령관 "인테리어 다양하게"): 가구·통·잔해·전리품 소품 — 방마다 분위기 다양화
                   'barrel_large', 'keg', 'box_stacked', 'table_medium', 'chair', 'rubble_large', 'rubble_half',
                   // ⛔2026-07-22 제거 — 어느 테마도 안 쓰는데 로드만 하던 것들. `bottle_A_green`·`shelf_large`는 **초록** 계열이라
                   //   재유입 위험까지 있었다(사령관 "풀 다 빼"). `trunk_large_A`는 궤짝(사령관 "상자는 넣으면 안 되지").
                   'coin_stack_medium',
                   // ★2026-07-16 2층: 함정 나무 바닥(trapdoor) + 하층 광물 파밍
                   'floor_wood_large',
                   // ★2026-07-22(사령관 "계단옆에 막는 난간이 좀 이상함") — 회색 박스 파라펫 폐기, KayKit 정품 난간 조각으로 교체.
                   'barrier', 'barrier_half', 'barrier_column', 'barrier_corner',
                   // ══ ★2026-07-22 조각 전수 활용 (사령관 "던전리마스터 보니까 있을 거 다 있네 이거 왜 다 활용 안 한 거지 / 쓸 수 있는 거 다 써야 할 것 같은데") ══
                   //   팩 211종 중 지금까지 29종만 로드했다. 벽 1종·바닥 2종으로만 지어서 방 크기만 다르고 전부 같아 보였던 근본 원인.
                   //   ⚠️ 벽 변형은 **실측으로 전부 4.00 × 4.00**임을 확인하고 넣었다(기존 wall과 동일 규격 = 배치 무위험).
                   //      단 구멍 뚫린 변형(arched/broken/window_open 등)은 **밀폐 벽을 대체하지 않고 안쪽에 덧대기만** 한다(기밀 불변식 유지, 조립부 참조).
                   'wall_arched', 'wall_broken', 'wall_gated', 'wall_sloped',   // ⛔wall_cracked(0.63)·wall_pillar(0.75)·wall_shelves(0.87)는 제외 —
                   //   기본 wall(0.50)보다 안쪽으로 더 튀어나와 **벽 횃불을 통째로 덮었다**(사령관 "횃불 어디감").
                   //   wall_shelves 는 선반 위 초록 병이 바로 사령관이 말한 "풀"이었다(사령관 "풀 다 빼").
                   'wall_scaffold', 'wall_open_scaffold', 'wall_doorway_scaffold',
                   'wall_window_open', 'wall_window_closed', 'wall_window_open_scaffold', 'wall_window_closed_scaffold',
                   'wall_archedwindow_open', 'wall_archedwindow_gated', 'wall_archedwindow_gated_scaffold',
                   //   바닥 — ★2026-07-22 사령관 "바닥 나무는 빼, 바닥은 돌바닥으로 해야지" · "풀 나오는 거 이걸 왜 넣은 거야"
                   //     ⇒ 목재 바닥·잡초 타일은 바닥 팔레트에서 **완전 제외**. 광산 바닥 = 돌 타일 + 흙/암반뿐.
                   //     (floor_wood_large는 팔레트가 아니라 'W' 함정 바닥 전용으로만 남는다.)
                   //   ★윗면 높이 실측: tile_large 0.05 · dirt_large 0.11 · dirt_rocky 0.29.
                   //   floor_tile_large_rocks(0.54)는 **일부러 뺐다** — 이웃 타일과 49cm 단차가 생겨 보행이 걸린다.
                   'floor_dirt_large',
                   //   ★석재 기단 — 낮은 단(엄폐 '=')과 용암 점프 발판에 쓴다. 둘 다 예전엔 단색 BoxGeometry 민짜였다.
                   'floor_foundation_allsides',
                   //   기둥·구조 장식
                   'pillar_decorated',
                   //   소품 — 프리팹 ASCII 글자를 방 테마가 이 풀에서 골라 해석한다(같은 'o'라도 방마다 다른 물건).
                   //   ⛔ ★2026-07-22 사령관 "상자는 넣으면 안 되지, 실제 상자 열릴 것 같잖아"
                   //      → 궤짝·상자류(chest·trunk_*·box_large/small)는 **전부 제외**. 진짜 보상 상자(chest_gold)와 혼동되면 안 된다.
                   //      쌓아 올린 더미(crates_stacked·box_stacked·barrel_small_stack)만 남긴다 — 명백히 배경 집기라 열 것처럼 안 보인다.
                   //      같은 이유로 동전 더미(coin_stack_*)도 뺐다 — 주울 수 있을 것처럼 보인다.
                   'barrel_large_decorated', 'barrel_small_stack', 'keg_decorated',
                   'table_long', 'table_long_broken', 'table_long_decorated_A', 'table_medium_broken',
                   'table_small', 'table_small_decorated_A', 'table_small_decorated_B', 'stool',
                   'candle_lit', 'candle_triple', 'candle_melted', 'candle_thin_lit',
                   'sword_shield', 'sword_shield_gold', 'plate_stack', 'torch_lit',
                   'floor_tile_small_broken_A', 'floor_tile_small_broken_B',
                   'banner_brown', 'banner_green', 'banner_patternB_red', 'banner_thin_brown', 'banner_triple_red'];
// 광물 key → mine.js ORES 한글명(registerNode의 userData.ore 매칭용)
const ORE_KO = { iron:'철광석', copper:'구리', tin:'주석', cobalt:'코발트', gold:'금', silver:'은', gem:'보석', coal:'석탄', stone:'돌' };
let _kitPromise = null;
// 🚪 보스 게이트(지하 2층 최심부) — 사령관이 추가한 `epic_alien_temple_door_animated.glb`에서
//   Hall·Plane을 잘라낸 편집본(`scripts/glb_trim.mjs` → bossgate.glb, 99.6MB→49.6MB).
//   내부: 문틀 + 문짝 4장(up/down/left/right) + 애니메이션 `Door downAction`(문짝 4장 translation).
//   ⚠️50MB라 입장 때 처음 받으면 렉이 걸린다 → loadKit과 같은 방식으로 캐시 + 부팅 후 프리로드.
let _gatePromise = null;
export function loadBossGate(){
  if(_gatePromise) return _gatePromise;
  _gatePromise = new GLTFLoader().loadAsync('/bossgate.glb')
    .then(g => {
      // 개구부 실측 — 문짝 4장의 합친 bbox가 곧 통로 구멍이다(코드로 추정하지 않는다).
      // ⚠️GLTFLoader는 노드 이름의 **공백을 `_`로 치환**한다(PropertyBinding.sanitizeNodeName).
      //   glTF 원본은 "Door down_gameasset"인데 로드 후엔 "Door_down_gameasset"이 된다.
      //   공백만 기대한 정규식을 쓰면 하나도 안 잡혀 개구부 크기가 0이 되고, 스케일이 7000배로 폭발한다(실제로 겪음).
      const panels = [];
      g.scene.traverse(o => { if(/^Door[_ ](up|down|left|right)[_ ]gameasset$/.test(o.name || '')) panels.push(o); });
      const ab = new THREE.Box3();
      for(const p of panels) ab.union(new THREE.Box3().setFromObject(p));
      if(!panels.length || ab.isEmpty()){   // 폴백 — 문짝을 못 찾으면 모델 전체의 가운데 60%를 개구부로 본다
        console.warn('[dungeonrun] 게이트 문짝 노드를 못 찾음 — 전체 bbox 기준 폴백');
        const fb = new THREE.Box3().setFromObject(g.scene), fs2 = fb.getSize(new THREE.Vector3());
        ab.copy(fb).expandByVector(fs2.multiplyScalar(-0.2));
      }
      const full = new THREE.Box3().setFromObject(g.scene);
      return { scene: g.scene, animations: g.animations || [],
               aperture: { size: ab.getSize(new THREE.Vector3()), center: ab.getCenter(new THREE.Vector3()) },
               full: { size: full.getSize(new THREE.Vector3()), min: full.min.clone() } };
    })
    .catch(e => { _gatePromise = null; console.warn('[dungeonrun] 보스 게이트 로드 실패 — 게이트 없이 진행', e && e.message); return null; });
  return _gatePromise;
}
export function loadKit(){
  if(_kitPromise) return _kitPromise;
  const L = new GLTFLoader();
  _kitPromise = Promise.all(KIT_NAMES.map(n => L.loadAsync(KIT_BASE + n + '.gltf').then(g => [n, g.scene])))
    .then(entries => {
      const kit = {};
      for(const [n, sc] of entries){
        sc.traverse(o => { if(o.isMesh){ o.userData._kaykitShared = true; o.castShadow = false; o.receiveShadow = false; } });
        kit[n] = sc;
      }
      // 문짝 제거 — wall_doorway는 여닫이 문 메시 포함. 통로를 항상 열린 아치로(문이 물리/시야를 막지 않게).
      const door = kit.wall_doorway.getObjectByName('wall_doorway_door');
      if(door && door.parent) door.parent.remove(door);
      // ★CELL 실측 — floor_tile_large Box3(x폭)로 그리드 셀 간격 확정(KayKit 명목 4m, 실측으로 고정).
      const fb = new THREE.Box3().setFromObject(kit.floor_tile_large);
      const fs = fb.getSize(new THREE.Vector3());
      kit.CELL = Math.round(fs.x * 100) / 100 || 4;
      kit.FLOOR_TOP = fb.max.y;   // 타일 윗면(≈+0.05) — 로컬 y0 배치 기준 정보용
      // 흙바닥 변주 타일 — 크기가 CELL과 일치할 때만 사용(불일치 시 이음새 구멍 방지)
      const db = new THREE.Box3().setFromObject(kit.floor_dirt_large_rocky).getSize(new THREE.Vector3());
      kit.dirtOk = Math.abs(db.x - fs.x) < 0.05 && Math.abs(db.z - fs.z) < 0.05;
      // ★벽 실측(높이/바닥오프셋) — 벽 2단 적층·천장·단상 높이 정렬 기준(하드코딩 대신 실측).
      const wb = new THREE.Box3().setFromObject(kit.wall);
      kit.WALL_H   = Math.round((wb.max.y - wb.min.y) * 100) / 100 || 4;   // 벽 한 장 높이(≈4)
      kit.WALL_MIN = wb.min.y;                                             // 벽 바닥 y(피벗→바닥 오프셋)
      // ★계단 실측 — 상하 이동 층고 = 계단 실제 상승량(정확 정렬). run=수평 길이.
      const sb = new THREE.Box3().setFromObject(kit.stairs);
      kit.STAIR_RISE = Math.round((sb.max.y - sb.min.y) * 100) / 100 || 2;
      kit.STAIR_RUN  = Math.round((sb.max.z - sb.min.z) * 100) / 100 || 4;
      kit.STAIR_MIN  = sb.min.y;
      // ★★2026-07-22 **밟는 면** 실측 — bbox(y 0~5.10)는 계단 **밑판(y=0)까지 포함**이라 보행 낙차와 다르다.
      //   실제로는 높은 쪽 끝(z=0) 윗면 5.10 · 낮은 쪽 끝(z=RUN) 윗면 1.10 → **보행 낙차 4.00**이고 y=0~1.10은 밑판.
      //   전엔 bbox 높이(5.10)로 스케일해서 낮은 쪽 끝이 칸 바닥보다 늘 0.43m 떠 있었다(칸 경계마다 작은 단 + 난간 어긋남).
      //   ⇒ 정점에서 z 양끝의 윗면을 직접 뽑아 STAIR_TOP/STAIR_LOW를 잡고, 이걸로 스케일·정렬한다.
      {
        let top = -Infinity, low = -Infinity;
        const zTop = sb.min.z + (sb.max.z - sb.min.z) * 0.12, zLow = sb.max.z - (sb.max.z - sb.min.z) * 0.12;
        kit.stairs.updateWorldMatrix(true, true);
        kit.stairs.traverse(o => { if(!(o.isMesh && o.geometry && o.geometry.attributes.position)) return;
          const pos = o.geometry.attributes.position, v = new THREE.Vector3();
          for(let i = 0; i < pos.count; i++){ v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            if(v.z <= zTop) top = Math.max(top, v.y);
            if(v.z >= zLow) low = Math.max(low, v.y); } });
        kit.STAIR_TOP  = isFinite(top) ? top : kit.STAIR_RISE;    // 높은 쪽 끝 윗면(≈5.10)
        kit.STAIR_LOW  = isFinite(low) ? low : 0;                 // 낮은 쪽 끝 윗면(≈1.10)
        kit.STAIR_DROP = Math.max(0.01, kit.STAIR_TOP - kit.STAIR_LOW);   // 실제 보행 낙차(≈4.00)
      }
      // ★난간(barrier) 실측 — 계단실 파라펫을 조각 실치수에 맞춰 이어붙이기 위함(하드코딩 금지).
      const bb = new THREE.Box3().setFromObject(kit.barrier), bs = bb.getSize(new THREE.Vector3());
      kit.BARRIER_W = Math.round(bs.x * 100) / 100 || 4;   // 한 장 폭(≈4.0 = CELL)
      kit.BARRIER_H = Math.round(bs.y * 100) / 100 || 1;   // 높이(≈1.10)
      kit.BARRIER_MIN = bb.min.y;                          // 피벗→밑면 오프셋(≈0)
      // ★스파이크 함정 타일 윗면(가시 끝) — 판정/시각 배치용
      const kb = new THREE.Box3().setFromObject(kit.floor_tile_big_spikes);
      kit.SPIKE_TOP = kb.max.y;
      console.log('[dungeonrun] KayKit 조각 ' + KIT_NAMES.length + '종 로드 — CELL=' + kit.CELL
        + ' · WALL_H=' + kit.WALL_H + ' · STAIR rise=' + kit.STAIR_RISE + '/run=' + kit.STAIR_RUN + ' (실측)');
      return kit;
    })
    .catch(e => { _kitPromise = null; throw e; });   // 실패 시 캐시 비움 — 다음 입장 때 재시도 가능
  return _kitPromise;
}

// ══════════════════════════════════════════════════════════════════════════
// ★D4b 절차생성 — 12×12 그리드에 직사각형 방 4~6개(1칸 간격) + 폭1 L자 복도 체인 연결.
//   cell type: 0=void · 1=room · 2=corridor. 입구=rooms[0], 보물방=BFS 최원방.
// ══════════════════════════════════════════════════════════════════════════
function tryGenRooms(G, wantMin, wantMax){
  const type = new Uint8Array(G * G);
  const roomId = new Int8Array(G * G).fill(-1);
  const rooms = [];
  const idx = (x, z) => z * G + x;
  const want = wantMin + ((Math.random() * (wantMax - wantMin + 1)) | 0);   // 방 수 = 티어 config(BAL.dungeon)
  for(let t = 0; t < 240 && rooms.length < want; t++){
    const w = 4 + ((Math.random() * 2) | 0), h = 4 + ((Math.random() * 2) | 0);   // 4~5 × 4~5셀 (패킹 위해 상한 6→5)
    const x = (Math.random() * (G - w + 1)) | 0, z = (Math.random() * (G - h + 1)) | 0;
    let ok = true;   // 기존 방과 1칸 간격(벽 공유 금지 — 방↔방 직결 방지, 연결은 복도만)
    for(const r of rooms){ if(x < r.x + r.w + 1 && r.x < x + w + 1 && z < r.z + r.h + 1 && r.z < z + h + 1){ ok = false; break; } }
    if(!ok) continue;
    const r = { x, z, w, h, cx: x + (w >> 1), cz: z + (h >> 1), id: rooms.length };
    rooms.push(r);
    for(let i = x; i < x + w; i++) for(let j = z; j < z + h; j++){ type[idx(i, j)] = 1; roomId[idx(i, j)] = r.id; }
  }
  // 복도: 방 i → i-1 L자 카브(x먼저/z먼저 랜덤) — 체인 연결 = 전 방 연결 보장
  for(let i = 1; i < rooms.length; i++){
    const a = rooms[i], b = rooms[i - 1];
    let x = a.cx, z = a.cz;
    const carve = () => { const k = idx(x, z); if(type[k] === 0) type[k] = 2; };
    if(Math.random() < 0.5){
      while(x !== b.cx){ x += Math.sign(b.cx - x); carve(); }
      while(z !== b.cz){ z += Math.sign(b.cz - z); carve(); }
    } else {
      while(z !== b.cz){ z += Math.sign(b.cz - z); carve(); }
      while(x !== b.cx){ x += Math.sign(b.cx - x); carve(); }
    }
  }
  return { G, type, roomId, rooms };
}
function fallbackRooms(G){   // 극단 방어(확률상 거의 불가) — 대각 방 2개 + L복도 고정 배치
  const type = new Uint8Array(G * G), roomId = new Int8Array(G * G).fill(-1);
  const idx = (x, z) => z * G + x;
  const rooms = [{ x: 1, z: 1, w: 4, h: 4, cx: 3, cz: 3, id: 0 }, { x: 7, z: 7, w: 4, h: 4, cx: 9, cz: 9, id: 1 }];
  for(const r of rooms) for(let i = r.x; i < r.x + r.w; i++) for(let j = r.z; j < r.z + r.h; j++){ type[idx(i, j)] = 1; roomId[idx(i, j)] = r.id; }
  for(let x = 4; x <= 9; x++){ const k = idx(x, 3); if(type[k] === 0) type[k] = 2; }
  for(let z = 4; z <= 8; z++){ const k = idx(9, z); if(type[k] === 0) type[k] = 2; }
  return { G, type, roomId, rooms };
}
// ══ 설계 템플릿(사령관 "맵 구조 짜서 소/중/대 3개씩") — 랜덤 대신 코헤런트한 레이아웃. rooms=[x,z,w,h] · links=[a,b] · 마커 ent/boss/trap ══
const TEMPLATES = {
  small: [
    { G:12, rooms:[[1,4,3,3],[5,1,3,3],[5,7,3,3],[8,4,3,4]], links:[[0,1],[0,2],[1,3],[2,3]], ent:0, boss:3, trap:2 },
    { G:12, rooms:[[1,1,3,3],[1,7,3,4],[5,4,3,3],[8,1,3,3],[8,6,3,4]], links:[[0,2],[1,2],[2,3],[2,4]], ent:0, boss:4, trap:1 },
    { G:12, rooms:[[4,1,4,3],[1,5,3,3],[8,5,3,3],[4,8,4,3]], links:[[0,1],[0,2],[1,3],[2,3]], ent:0, boss:3, trap:1 },
  ],
  medium: [
    { G:15, rooms:[[1,6,3,3],[5,2,3,3],[5,9,3,4],[9,5,3,4],[12,1,3,3]], links:[[0,1],[0,2],[1,3],[2,3],[3,4]], ent:0, boss:3, trap:2 },
    { G:15, rooms:[[1,1,4,3],[1,7,3,4],[6,4,4,4],[11,1,3,4],[11,8,3,4]], links:[[0,2],[1,2],[2,3],[2,4]], ent:0, boss:4, trap:1 },
    { G:15, rooms:[[6,1,4,3],[1,5,3,4],[11,5,3,4],[6,6,4,4],[6,11,4,3]], links:[[0,3],[3,1],[3,2],[3,4]], ent:0, boss:4, trap:1 },
  ],
  large: [
    { G:18, rooms:[[1,7,3,4],[5,2,3,3],[5,11,3,4],[9,7,4,4],[14,2,3,4],[14,11,3,4],[9,1,3,3]], links:[[0,1],[0,2],[1,3],[2,3],[3,4],[3,5],[1,6]], ent:0, boss:3, trap:2 },
    { G:18, rooms:[[1,1,4,3],[1,7,3,4],[1,13,4,3],[6,6,4,4],[11,1,3,4],[11,7,4,4],[11,13,3,4]], links:[[0,3],[1,3],[2,3],[3,4],[3,5],[5,6]], ent:0, boss:5, trap:2 },
    { G:18, rooms:[[7,1,4,3],[1,5,3,4],[13,5,4,4],[7,6,4,4],[1,11,3,4],[13,11,4,4],[7,12,4,4]], links:[[0,3],[3,1],[3,2],[3,6],[6,4],[6,5]], ent:0, boss:6, trap:3 },
  ],
};
function buildFromTemplate(tpl){
  const G = tpl.G, type = new Uint8Array(G*G), roomId = new Int8Array(G*G).fill(-1);
  const idx = (x,z) => z*G + x;
  const rooms = tpl.rooms.map((r,i) => ({ x:r[0], z:r[1], w:r[2], h:r[3], cx:r[0]+(r[2]>>1), cz:r[1]+(r[3]>>1), id:i }));
  for(const r of rooms) for(let i=r.x;i<r.x+r.w;i++) for(let j=r.z;j<r.z+r.h;j++){ if(i<G&&j<G){ type[idx(i,j)]=1; roomId[idx(i,j)]=r.id; } }
  for(const [a,b] of tpl.links){ const A=rooms[a], B=rooms[b]; if(!A||!B) continue; let x=A.cx, z=A.cz;
    const carve = () => { const k=idx(x,z); if(type[k]===0) type[k]=2; };
    if(Math.random()<0.5){ while(x!==B.cx){ x+=Math.sign(B.cx-x); carve(); } while(z!==B.cz){ z+=Math.sign(B.cz-z); carve(); } }
    else { while(z!==B.cz){ z+=Math.sign(B.cz-z); carve(); } while(x!==B.cx){ x+=Math.sign(B.cx-x); carve(); } }
  }
  return { G, type, roomId, rooms, entIdx: tpl.ent||0, bossIdx: tpl.boss, trapIdx: tpl.trap };
}
// ══ 흐름 조립(프리팹 방 배치) — 방=ROOM_PREFABS 배치(w×h는 프리팹) + 링크 복도. role: entrance/combat/trapdoor/boss ══
//   ★2026-07-16 근본 재설계(사령관 "동선 별로·소형도 최소 10분·너무 별로") — 방 수·그리드 대폭 확대 + 계단식(staircase)
//   배치로 방-복도 우발적 교차 차단(연결 안 된 방끼리 겹치면 벽/문 파이프라인이 그 경계를 인지 못해 뚫린 채 이어짐).
//   좌표는 전부 손계산 충돌검증 완료(방 rect 간 최소 1셀 간격, 링크 경로의 두 가능한 L자 꺾임 모두 제3의 방과 안 겹침).
// ★2026-07-17 2차 재설계(사령관 "그냥 큰 사각형 도는 느낌" + "레버 내리면 입구로 가는 숏컷") — 순회형 폐기.
//   본선(entrance→combat…→leverRoom)은 동→남으로 크게 돌아 진행하지만, leverRoom을 좌표상 entrance 바로 아래(같은 cx)에
//   둬서 "그래프상 멀지만 공간상 가깝다"는 다크소울류 지름길 구조를 만든다. entrance↔leverRoom 사이 문은 평소 잠겨있다가
//   레버를 당기면 보스문과 함께 열려 본선을 되짚지 않고 입구로 바로 복귀 가능(shortcutDoor, buildDungeon 참조).
//   전 좌표 스크립트 검증 완료(겹침 0 · 두 방향 카빙 전부 제3의 방 관통 0 · 전 방 BFS 연결 확인).
const FLOWS = {
  small: [   // 입구→전투×3→레버(나무함정방) 본선(4홉, 동→남) + 보물 곁가지 + 보스(잠긴문, 입구 직결) + 레버→입구 숏컷
    { G:42, rooms:[
        {role:'entrance',pf:0,x:14,z:14},
        {role:'combat',  pf:0,x:23,z:14},
        {role:'combat',  pf:1,x:23,z:23},
        {role:'combat',  pf:2,x:23,z:32},
        {role:'trapdoor',pf:0,x:13,z:32},
        {role:'treasure',pf:0,x:31,z:14},
        {role:'boss',    pf:0,x:2, z:12},
      ],
      links:[[0,1],[1,2],[2,3],[3,4],[1,5],[0,6],[0,4]], lockedDoor:[0,6], leverRoom:4, shortcutLink:[0,4] },
  ],
  medium: [   // 입구→전투×4→레버 본선(5홉) + 보물 곁가지 + 용암 곁가지 + 보스(잠긴문) + 레버→입구 숏컷
    { G:50, rooms:[
        {role:'entrance',pf:0,x:14,z:14},
        {role:'combat',  pf:0,x:23,z:14},
        {role:'combat',  pf:1,x:23,z:23},
        {role:'combat',  pf:2,x:23,z:32},
        {role:'combat',  pf:0,x:23,z:41},
        {role:'trapdoor',pf:0,x:13,z:41},
        {role:'treasure',pf:0,x:31,z:14},
        {role:'lava',    pf:0,x:31,z:23},
        {role:'boss',    pf:0,x:2, z:12},
      ],
      links:[[0,1],[1,2],[2,3],[3,4],[4,5],[1,6],[2,7],[0,8],[0,5]], lockedDoor:[0,8], leverRoom:5, shortcutLink:[0,5] },
  ],
  large: [   // 입구→전투×5→레버 본선(6홉) + 보물 곁가지 + 용암 곁가지 + 보스(잠긴문) + 레버→입구 숏컷
    { G:58, rooms:[
        {role:'entrance',pf:0,x:14,z:14},
        {role:'combat',  pf:0,x:23,z:14},
        {role:'combat',  pf:1,x:23,z:23},
        {role:'combat',  pf:2,x:23,z:32},
        {role:'combat',  pf:0,x:23,z:41},
        {role:'combat',  pf:1,x:23,z:50},
        {role:'trapdoor',pf:0,x:13,z:50},
        {role:'treasure',pf:0,x:31,z:14},
        {role:'lava',    pf:0,x:31,z:23},
        {role:'boss',    pf:0,x:2, z:12},
      ],
      links:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[1,7],[2,8],[0,9],[0,6]], lockedDoor:[0,9], leverRoom:6, shortcutLink:[0,6] },
  ],
};
// ══════════════════════════════════════════════════════════════════════════
// ★2026-07-17 4차 재설계(사령관 "완전 수제작 던전 하나 — 생성기 안 쓰고 셀 하나하나 손으로") — small 전용.
//   FLOWS의 "방+두 세그먼트 L자 자동카빙" 대신, 방 크기 제각각 + 통로를 여러 직선 조각을 이어붙여 손수 여러 번
//   꺾이게 그렸다. 큰 동굴방(cavern, 11×9) 하나 + 완전히 분리된 칼럼의 숏컷(레버→입구, 메인 동선과 안 겹침).
//   좌표는 스크립트로 겹침·의도치 않은 방 관통·연결성 전부 검증 완료(손계산 아님).
// ★2026-07-21 10차-B — 단일 지상 그리드 + hall방(지하 뱀형 switchback). 지하 방=천장·2단벽 인클로저(엔클로징 수정).
//   봉인방=코드가 hall중심+(13,12셀)=(22,22)에 직접 건축. 좌표 검증: verify_surface.mjs·verify_zigzag.mjs.
// ★2026-07-21 다층 그리드 — 던전 전체(지상+하강)를 하나의 그리드로. 하강은 "칸이 층층이 낮아지는 복도"로 표현.
//   손으로 만든 램프/계단 기하 전부 폐기 → 벽·천장이 파이프라인에서 자동 파생 = 구멍 구조적 불가.
//   ⚠️설계 제약: (1)한 칸은 높이 하나(heightfield) — 방 위에 방 못 얹음. (2)복도 칸당 낙차 ≤ STEP_MAX(0.7)여야
//     벽이 안 생기고 걸어서 내려감 → 낙차 큰 구간은 복도를 길게 뽑는다.
// ★2026-07-21 11차 재설계(사령관 "내려가는건 한번에 내려가야지 서서히가 뭐가 던전이야" + "1층이랑 지하 방 디자인이 다 달라야지")
//   폐기: 방↔복도를 11번 거치며 칸당 0.2~0.3m씩 야금야금 낮추던 슬로프 하강(= "서서히").
//   신설: 지상층(평평) → **사각 나선 계단실 한 바퀴로 -20m 뚝** → 지하층(평평). 층이 확실히 갈린다.
//   방 프리팹도 전부 다르게 — 지상=인공 갱도(좁고 각짐: entrance/mineshaft/combat/collapse/boss/treasure),
//   지하=천연 대공동(넓고 거침: greatcavern/abyss/cavern/lava/deadend/lowtreasure). 같은 프리팹 재탕 0.
// ⛔ 폭포 대홀(지하 2층) 스위치 — 2026-07-22 비활성.
//   구조를 BoxGeometry로 손수 짜서 천연 동공이 아니라 회색 직육면체가 됐다. 실제 동굴 메시 + CSG로 재작업 예정.
//   코드(buildCascadeHall·waterfallfx·portalfx·게이트 배선)는 전부 보존 — 여기만 true로 바꾸면 되살아난다.
const CASCADE_ON = false;
// ★2026-07-23 던전 보스 확대 배율(사령관 "보스몹 너무 작음"). bossGate.mul.scale(1.3)에 곱해져 실효 ≈2.2×.
//   오버월드 게이트 보스(gate.js)엔 미전달이라 불변 — 던전 spawnBoss만 opts.scaleMul로 넘긴다.
// ★2026-07-23 던전 보스 체력 배율(사령관 "체력 너무 금방 달아, 보스 던전 느낌 안 남 — 더 길게").
//   bossGate.mul.hp(2.8)에 곱해져 실효 ≈8.4× base. 오버월드 게이트 보스엔 미전달이라 불변.
const HANDCRAFT = {
  small: {
    G: 72,   // ★2026-07-24 60→72 — 보스 아레나가 21×25칸으로 커지며 x66·z66까지 쓴다(구 60이면 격자 밖으로 잘림).
    // ── 🌀 사각 나선 계단실 — 링 5×5(20m). 진입=북변 중앙(26,20) → 시계방향 한 바퀴 15칸 → NW 모서리(24,20)에서 종료.
    //    모서리 4곳=참(평평), 나머지 10칸=계단(kit.stairs 실측 run4/rise2 = 26.5°) → 10×2 = **-20m 한 바퀴**.
    //    링 안쪽 3×3 + 진입칸 서쪽 이웃(25,20) = 최하부 홀 바닥(-20). 안쪽 면엔 벽을 안 세워 가운데가 뻥 뚫린다.
    // ★2026-07-21 사령관 확정 동선: "1층 방 여러개 → **마지막 방에서 지하로** · 지하도 풍성하게 → **지하 끝방에 보스**"
    //   ⇒ 지상은 한 줄 본선(입구→갱도→채굴장→갱도B→갱도C→붕괴갱)이고 붕괴갱**에서만** 계단실로 내려간다.
    //     보스는 지상 입구 옆이 아니라 **지하 최심부**. 레버(막장)도 지하라 되돌아 올라오는 구간이 0이 된다.
    stairwell: { x:40, z:20, size:5, entry:[42,20], rise:2, cw:true },
    rooms: [
      // ── 지상층(depth 0) · 인공 갱도 — 프리팹 전부 다름. 본선 0→1→2→3→4→6, 5는 곁가지 ──
      { role:'entrance',      x:2,  z:2  },                // 0 입구(스폰)       5×4  center(4,4)
      { role:'mineshaft',     x:10, z:2  },                // 1 채굴 갱도        7×5  center(13,4)
      { role:'combat', pf:2,  x:20, z:2  },                // 2 대형 채굴장      8×6  center(24,5)
      { role:'combat', pf:1,  x:31, z:2  },                // 3 좁은 갱도B       5×5  center(33,4)
      { role:'combat', pf:0,  x:39, z:2  },                // 4 갱도C            6×5  center(42,4)
      { role:'treasure',      x:48, z:2  },                // 5 동 보물(곁)      5×4  center(50,4)
      { role:'collapse',      x:39, z:10 },                // 6 붕괴갱 ★지상 마지막 방 → 계단실 6×6 center(42,13)
      // ── 지하층(depth -20) · 천연 대공동 — 프리팹 전부 다름. 7→8/9→12→13(보스) ──
      { role:'greatcavern',   x:20, z:26, depth:-20 },     // 7  거대 대공동(하강 도착) 13×11 center(26,31)
      { role:'abyss',         x:6,  z:28, depth:-20 },     // 8  심연             9×8  center(10,32)
      { role:'cavern',        x:20, z:40, depth:-20 },     // 9  동굴 챔버       11×9  center(25,44)
      { role:'lava',          x:6,  z:42, depth:-20 },     // 10 🌋 용암 점프맵(곁) 8×7 center(9,45)
      { role:'lowtreasure',   x:36, z:30, depth:-20 },     // 11 지하 보물(곁)    5×5  center(38,32)
      { role:'deadend',       x:36, z:40, depth:-20 },     // 12 막장(레버)       7×6  center(39,42)
      // ── 🏔️ 지하 2층(폭포 대홀) — ⛔2026-07-22 **비활성**. CASCADE_ON=true 로 되살린다.
      //   사유: 껍질·램프를 BoxGeometry로 손수 짜서 "산에 구멍 뚫린 동공"이 아니라 회색 직육면체 방이 됐다(사령관 "저게 맵이야?").
      //   재작업 방향 = 박스 폐기 → 실제 동굴 메시(rock-mountain-with-cave / RealisticCave2) + CSG(mtncave.js 검증본).
      //   폭포 VFX(waterfallfx.js)·포탈(portalfx.js)·게이트(bossgate.glb) 배선은 그대로 두고 재사용한다.
      ...(CASCADE_ON ? [
        { role:'cascade', x:41, z:26, w:11, h:11, depth:-20 },  // 🏔️ 폭포 대홀(비활성)
        { role:'boss',    x:52, z:28, depth:-50 },
      ] : [
        // 🏛️ 지하 대전당 — 16×14칸(64×56m) · 천장 16m(rows:4). 던전에서 가장 큰 공간.
        { role:'grandhall', x:44, z:26, depth:-20, rows:4 },    // 13 center(52,33)
        { role:'bossarena', x:46, z:42, depth:-23, rows:6 },    // 14 ★🌋용암 바다 아레나(2026-07-24 재설계) = 21×25칸(84×100m) center(56,54) · 천장 24m(rows:6) · 대전당(-20)보다 3m 낮음
        //    진입로(북, x54~58) → 원반 무대(지름 17칸). 방 나머지는 전부 용암. 게이트 [E] 도착지 = (cx, z+1) = (56,43) = 진입로 첫 칸.
      ]),
    ],
    corridors: [
      // ── 지상 본선(전부 depth 0) ──
      [[7,4],[9,4]],                   // 입구 → 채굴 갱도
      [[17,4],[19,4]],                 // 채굴 갱도 → 대형 채굴장
      [[28,5],[30,5]],                 // 대형 채굴장 → 좁은 갱도B
      [[36,4],[38,4]],                 // 갱도B → 갱도C
      [[45,4],[47,4]],                 // 갱도C → 동 보물(곁가지)
      [[42,7],[42,9]],                 // 갱도C ↓ 붕괴갱
      [[42,16],[42,19]],               // 붕괴갱 ↓ 계단실 진입(42,20)  ★지상에서 지하로 가는 유일한 길
      // ── 지하(계단실 최하부 → 대공동 …→ 보스, 전부 depth -20) ──
      [[39,20],[26,20],[26,25]],       // 계단실 종료칸(40,20) 서쪽 → 거대 대공동
      [[19,31],[15,31]],               // 대공동 → 심연
      [[26,37],[26,39]],               // 대공동 ↓ 동굴 챔버
      [[10,36],[10,41]],               // 심연 ↓ 용암 점프맵(곁)
      [[33,32],[35,32]],               // 대공동 → 지하 보물(곁)
      [[31,44],[35,44]],               // 동굴 챔버 → 막장(레버)
      // 🏔️ 폭포 대홀 경유 동선 — CASCADE_ON 일 때만. 끄면 11차 동선(막장 → 보스방)으로 돌아간다.
      ...(CASCADE_ON ? [
        [[43,42],[43,25],[42,25]],     // 막장 동쪽 → 북상 → 대홀 북변 진입
      ] : [
        [[43,42],[43,38]],             // 막장 동쪽 → 북상 → 🏛️대전당 서변(44,38) 진입
        [[56,40],[56,41]],             // 대전당 남변 → 보스 아레나 ★최심부 — 이 문 자리에 보스 게이트 GLB가 선다
        //   ★2026-07-24 x 50→56 — 아레나가 21칸으로 넓어지며 진입로(코즈웨이)가 x54~58로 옮겨졌다. 게이트는 이 문 에지에 서므로
        //     아레나 진입로와 x가 맞아야 한다. (56,41)은 -23으로 보간돼 (56,40)-20 과 3m 단차 = 파이프라인이 자동으로 벽을 세운다
        //     (걸어서 못 내려감 = 의도. 진입은 게이트 [E] 텔레포트 전용).
      ]),
    ],
    entIdx: 0, bossIdx: 14, leverIdx: 12, cascadeIdx: (CASCADE_ON ? 13 : -1), grandIdx: (CASCADE_ON ? -1 : 13),
  },
};
// ★2026-07-21 다층화 — 칸마다 높이(hgt)를 갖는다. 방은 rm.depth, 복도는 양끝 방 높이 사이를 칸 단위로 보간(계단식 하강).
//   경사 램프 같은 "손으로 만든 특수 기하"를 없애는 게 목적 — 전부 일반 칸이라 벽·천장이 자동 파생된다(구멍 구조적 불가).
//   인접 칸 높이차 ≤ STEP_MAX 면 걸어서 넘어가는 단(벽 없음), 초과면 파이프라인이 자동으로 벽을 세운다.
function assembleHandcraft(spec){
  const G = spec.G, type = new Uint8Array(G*G), roomId = new Int8Array(G*G).fill(-1), idx=(x,z)=>z*G+x;
  const hgt = new Float32Array(G*G);   // 칸 바닥 높이(월드 단위, 0=지상층)
  const rooms = spec.rooms.map((rm,i)=>{
    let w, h;
    if(rm.w && rm.h){ w = rm.w; h = rm.h; }   // ★커스텀 사이즈(hall 등 — ROOM_PREFABS ASCII 그리드 없이 코드로 직접 빌드)
    else { const set=ROOM_PREFABS[rm.role]||ROOM_PREFABS.combat; const pf=set[rm.pf||0]||set[0]; w=pf.w; h=pf.h; }
    // ★rows = 그 방의 벽 단수(기본 2단=8m). 대전당처럼 **천장이 높아야 하는 방**만 크게 준다.
    //   방마다 다르게 못 주면 80×64m 홀도 8m 천장이라 '큰 홀'로 안 읽힌다.
    return { x:rm.x, z:rm.z, w, h, cx:rm.x+(w>>1), cz:rm.z+(h>>1), id:i, role:rm.role, pfIdx:(rm.pf||0), depth:(rm.depth||0), rows:(rm.rows||0) }; });
  for(const r of rooms) for(let i=r.x;i<r.x+r.w;i++) for(let j=r.z;j<r.z+r.h;j++){ if(i>=0&&j>=0&&i<G&&j<G){ const k=idx(i,j); type[k]=1; roomId[k]=r.id; hgt[k]=r.depth; } }
  // ── 🌀 사각 나선 계단실(type 3 = 계단칸) — 방·복도보다 먼저 새겨야 복도 높이 보간이 계단실 끝 높이를 물려받는다.
  //   링을 시계방향으로 열거 → 진입칸부터 한 바퀴(마지막 1칸은 경로에서 빼 최하부 바닥으로) → 모서리=참(평평), 나머지=계단 1단(rise).
  //   ⚠️한 칸은 높이 하나(heightfield)라 링을 두 바퀴 이상 돌 수 없다. 총 하강 = (계단칸 수 × rise)로 자연히 결정된다.
  let well = null;
  if(spec.stairwell){
    const S = spec.stairwell, x0 = S.x, z0 = S.z, n = S.size, rise = S.rise || 2;
    const ring = [];
    for(let i=0;i<n;i++)    ring.push([x0+i,   z0    ]);   // N변 서→동
    for(let j=1;j<n;j++)    ring.push([x0+n-1, z0+j  ]);   // E변 북→남
    for(let i=n-2;i>=0;i--) ring.push([x0+i,   z0+n-1]);   // S변 동→서
    for(let j=n-2;j>=1;j--) ring.push([x0,     z0+j  ]);   // W변 남→북
    if(S.cw === false) ring.reverse();
    const isCorner = (x,z) => (x===x0 || x===x0+n-1) && (z===z0 || z===z0+n-1);
    const st = Math.max(0, ring.findIndex(c => c[0]===S.entry[0] && c[1]===S.entry[1]));
    const path = []; for(let k=0;k<ring.length-1;k++) path.push(ring[(st+k)%ring.length]);
    const rest = ring[(st+ring.length-1)%ring.length];     // 경로에서 빠지는 1칸 = 최하부 바닥(진입칸 반대편 이웃)
    let h = 0; const stairCells = [];
    for(let k=0;k<path.length;k++){ const [x,z] = path[k], corner = isCorner(x,z);
      if(k>0 && !corner) h -= rise;                        // 참(모서리)은 이전 높이 유지 = 평평한 참
      const kk = idx(x,z); type[kk] = 3; hgt[kk] = h;
      stairCells.push({ x, z, y:h, corner, prev:(k>0?path[k-1]:null) }); }
    const botY = h;
    const floorCells = [[rest[0], rest[1]]];
    for(let i=x0+1;i<x0+n-1;i++) for(let j=z0+1;j<z0+n-1;j++) floorCells.push([i,j]);
    for(const [x,z] of floorCells){ const kk = idx(x,z); type[kk] = 1; hgt[kk] = botY; }   // 링 안쪽 = 최하부 홀 바닥
    well = { x:x0, z:z0, size:n, topY:0, botY, rise, stairCells,
             cells: new Set([...path, ...floorCells].map(c => c[0]+','+c[1])),
             inner: new Set(floorCells.map(c => c[0]+','+c[1])) };
  }
  // 복도 — 칸 목록을 먼저 모으고, 양끝(인접 방·계단실)의 높이 사이를 균등 보간해 계단식으로 낮아지게 한다.
  for(const path of spec.corridors){
    const cells = [];
    for(let s=0;s<path.length-1;s++){ let [x,z]=path[s]; const [x1,z1]=path[s+1];
      const push=()=>{ if(x>=0&&z>=0&&x<G&&z<G) cells.push([x,z]); };
      push(); while(x!==x1||z!==z1){ x+=Math.sign(x1-x); z+=Math.sign(z1-z); push(); } }
    // 양끝 높이 = 그 끝 칸에 인접한 방/계단실 칸의 높이(없으면 0). 복도가 방을 지나가면 그 칸은 방 높이 유지.
    const endH = (cx,cz) => { for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[0,0]]){ const nx=cx+dx, nz=cz+dz;
        if(nx>=0&&nz>=0&&nx<G&&nz<G){ const t2=type[idx(nx,nz)]; if(t2===1||t2===3) return hgt[idx(nx,nz)]; } } return 0; };
    const h0 = cells.length ? endH(cells[0][0], cells[0][1]) : 0;
    const h1 = cells.length ? endH(cells[cells.length-1][0], cells[cells.length-1][1]) : 0;
    for(let i=0;i<cells.length;i++){ const [x,z]=cells[i], k=idx(x,z);
      if(type[k]===1 || type[k]===3) continue;        // 방·계단실 칸은 자기 높이 유지(덮어쓰지 않음)
      const t = cells.length>1 ? i/(cells.length-1) : 0;
      type[k]=2; hgt[k] = h0 + (h1-h0)*t;             // 계단식 보간
    }
  }
  return { G, type, roomId, rooms, hgt, well, entIdx: spec.entIdx, bossIdx: spec.bossIdx, trapIdx: spec.trapIdx, leverIdx: spec.leverIdx,
           stairIdx: spec.stairIdx, alcoveIdx: spec.alcoveIdx, stairfootIdx: spec.stairfootIdx, treasureIdx: spec.treasureIdx };
}
function assembleFromFlow(flow){
  const G = flow.G, type = new Uint8Array(G*G), roomId = new Int8Array(G*G).fill(-1), idx=(x,z)=>z*G+x;
  const rooms = flow.rooms.map((rm,i)=>{ const set=ROOM_PREFABS[rm.role]||ROOM_PREFABS.combat; const pf=set[rm.pf||0]||set[0];
    return { x:rm.x, z:rm.z, w:pf.w, h:pf.h, cx:rm.x+(pf.w>>1), cz:rm.z+(pf.h>>1), id:i, role:rm.role, pfIdx:(rm.pf||0) }; });
  for(const r of rooms) for(let i=r.x;i<r.x+r.w;i++) for(let j=r.z;j<r.z+r.h;j++){ if(i>=0&&j>=0&&i<G&&j<G){ type[idx(i,j)]=1; roomId[idx(i,j)]=r.id; } }
  for(const [a,b] of flow.links){ const A=rooms[a],B=rooms[b]; if(!A||!B) continue; let x=A.cx,z=A.cz; const carve=()=>{ const k=idx(x,z); if(type[k]===0) type[k]=2; };
    if(Math.random()<0.5){ while(x!==B.cx){ x+=Math.sign(B.cx-x); carve(); } while(z!==B.cz){ z+=Math.sign(B.cz-z); carve(); } }
    else { while(z!==B.cz){ z+=Math.sign(B.cz-z); carve(); } while(x!==B.cx){ x+=Math.sign(B.cx-x); carve(); } } }
  const find=role=>rooms.findIndex(r=>r.role===role);
  return { G, type, roomId, rooms, entIdx: Math.max(0,find('entrance')), bossIdx: find('boss')<0?null:find('boss'), trapIdx: find('trapdoor')<0?null:find('trapdoor'), leverIdx: flow.leverRoom!=null?flow.leverRoom:null };
}
function genLayout(cfg){
  const hand = cfg && cfg.size && HANDCRAFT[cfg.size];
  const flow = cfg && cfg.size && FLOWS[cfg.size];
  const pool = cfg && cfg.size && TEMPLATES[cfg.size];
  let lay;
  if(hand){ const spec = hand.upper || hand; lay = assembleHandcraft(spec); lay._lowerSpec = hand.upper ? hand.lower : null; }   // ★수제작 던전 최우선. 2층이면(upper 존재) 지상=upper, lower 스펙은 buildDungeon이 -DROP에 렌더
  else if(flow && flow.length){ lay = assembleFromFlow(flow[(Math.random()*flow.length)|0]); }   // ★프리팹 흐름 조립 우선
  else if(pool && pool.length){ lay = buildFromTemplate(pool[(Math.random()*pool.length)|0]); }
  else {   // 폴백 = 랜덤
    const Gr = (cfg && cfg.grid) || 18;
    const rmin = (cfg && cfg.rooms && cfg.rooms[0]) || 6, rmax = (cfg && cfg.rooms && cfg.rooms[1]) || 7;
    for(let t = 0; t < 10; t++){ lay = tryGenRooms(Gr, rmin, rmax); if(lay.rooms.length >= Math.max(3, rmin-1)) break; }
    if(!lay || lay.rooms.length < 2) lay = fallbackRooms(Gr);
  }
  const G = lay.G;
  const { type, roomId, rooms } = lay;
  const idx = (x, z) => z * G + x;
  const walk = (x, z) => x >= 0 && z >= 0 && x < G && z < G && type[idx(x, z)] > 0;
  // ★불의 통로(gauntlet) — 입구 방에서 곧게 뻗는 복도 + 좌우 은신 알코브. type에 카빙(벽/문 파이프라인이 자동 처리).
  let gauntlet = null;
  {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let best = null;
    for(const rm of rooms){   // ★모든 방에서 곧은 void 런 탐색(입구만이면 자주 실패 → 안정성↑)
      for(const [dx,dz] of dirs){
        let sx, sz;
        if(dx===1){ sx=rm.x+rm.w; sz=rm.cz; } else if(dx===-1){ sx=rm.x-1; sz=rm.cz; }
        else if(dz===1){ sx=rm.cx; sz=rm.z+rm.h; } else { sx=rm.cx; sz=rm.z-1; }
        let len=0, x=sx, z=sz;
        while(x>=1 && z>=1 && x<G-1 && z<G-1 && type[idx(x,z)]===0 && len<7){ len++; x+=dx; z+=dz; }
        // ★11차: 불의 통로는 뻗어나온 방의 높이를 물려받아야 한다(전엔 hgt 미설정=항상 0이라, 지하 -20 방에서
        //   뻗은 통로가 지상 높이에 떠서 천장 없이 뚫려 있었음 — 기밀검사 12발의 정체).
        if(!best || len>best.len) best={dx,dz,sx,sz,len, y:(lay.hgt ? lay.hgt[idx(rm.cx,rm.cz)] : 0)};
      }
    }
    if(best && best.len>=3){
      const {dx,dz,sx,sz}=best, GL=Math.min(best.len,7), px=-dz, pz=dx, gy=best.y||0;
      const cells=[], alcoves=[]; let x=sx, z=sz;
      for(let i=0;i<GL;i++){ type[idx(x,z)]=2; if(lay.hgt) lay.hgt[idx(x,z)]=gy; cells.push([x,z]);
        if(i%2===1 && i<GL-1){ const s=(i%4===1)?1:-1, ax=x+px*s, az=z+pz*s;
          if(ax>=1&&az>=1&&ax<G-1&&az<G-1 && type[idx(ax,az)]===0){ type[idx(ax,az)]=2; if(lay.hgt) lay.hgt[idx(ax,az)]=gy; alcoves.push([ax,az]); } }
        x+=dx; z+=dz; }
      gauntlet = { cells, alcoves, reward: cells[cells.length-1] };
    }
  }
  // BFS(입구 방 중심 기준) — 최원방=보물방 + 몹 배치 깊이 가중
  const dist = new Int16Array(G * G).fill(-1);
  const ent = rooms[(lay.entIdx != null && rooms[lay.entIdx]) ? lay.entIdx : 0];   // ★템플릿 입구
  const q = [[ent.cx, ent.cz]]; dist[idx(ent.cx, ent.cz)] = 0;
  while(q.length){
    const [x, z] = q.shift(), d = dist[idx(x, z)];
    for(const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      const nx = x + dx, nz = z + dz;
      if(walk(nx, nz) && dist[idx(nx, nz)] < 0){ dist[idx(nx, nz)] = d + 1; q.push([nx, nz]); }
    }
  }
  let treasure = ent;
  for(const r of rooms){ if(r.id === 0) continue; const d = dist[idx(r.cx, r.cz)]; if(d >= 0 && (treasure === ent || d > dist[idx(treasure.cx, treasure.cz)])) treasure = r; }
  if(lay.bossIdx != null && rooms[lay.bossIdx]) treasure = rooms[lay.bossIdx];   // ★템플릿 보스방(포탈) 우선
  // 경계 벽 에지(walkable↔void) + 방↔복도 문 에지 열거.
  //   에지 = { x,z(walkable 셀), dir:0N/1E/2S/3W } — walkable-void 에지는 walkable 쪽 유일 소유라 중복 없음.
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const wallEdges = [], doorEdges = [], sealEdges = [];
  // ★다층화(2026-07-21): 칸 높이. 평면(FLOWS/템플릿 등 구 경로)은 전부 0 → 기존과 완전히 동일하게 렌더된다(회귀 0).
  const hgt = lay.hgt || new Float32Array(G * G);
  const STEP_MAX = 0.7;   // 이 이하 높이차 = 걸어서 넘는 단(벽 없음) / 초과 = 파이프라인이 자동으로 벽을 세움
  // ★2026-07-21 11차 — 사각 나선 계단실. 계단실 안쪽(링↔링·링↔최하부홀)은 벽을 세우지 않는다:
  //   ①링↔링은 계단(kit.stairs)이 높이차를 잇고 ②안쪽이 트여 있어야 계단을 돌며 20m 아래가 내려다보인다(사령관 확정 형태).
  //   대신 계단실 바깥 경계 벽은 최하부 바닥(botY)에서 천장까지 통짜로 세운다(wellWall) — 계단 밑 빈 공간이 새지 않게.
  const well = lay.well || null;
  const inWell = (x, z) => !!(well && well.cells.has(x + ',' + z));
  for(let z = 0; z < G; z++) for(let x = 0; x < G; x++){
    if(!walk(x, z)) continue;
    const hHere = hgt[idx(x, z)], here = inWell(x, z);
    for(let d = 0; d < 4; d++){
      const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
      if(!walk(nx, nz)){ wallEdges.push({ x, z, dir: d, rid: roomId[idx(x, z)], y: here ? well.botY : hHere, wellWall: here }); continue; }
      if(here && inWell(nx, nz)) continue;   // ★계단실 내부 — 벽 없음(계단이 잇고, 가운데는 뻥 뚫림)
      // ★계단실 출입구(mouth) — 통행은 열어두되 그 "밑"(최하부 바닥까지)은 막는다. 안 막으면 최하부 홀에서
      //   쏜 수평 광선이 출입구 복도 바닥 밑을 지나 그대로 바깥으로 샌다(기밀검사 12발의 정체).
      //   ★그 "위"도 막아야 한다 — 계단실은 천장이 최상단(+8)인데 바깥 복도 천장은 제 칸 높이+8이라,
      //     복도 천장 위쪽 구간이 계단실 쪽으로 트여 있었다(기밀검사 마지막 2발). nH=이웃 칸 높이를 실어 보낸다.
      if(here && !inWell(nx, nz)) sealEdges.push({ x, z, dir: d, y0: well.botY, y1: hHere, nH: hgt[idx(nx, nz)] });
      // ★높이차가 큰 이웃 = 통행 불가 → 벽. 낮은 쪽은 높은 쪽 천장까지 닿게 `up`(높이차)을 실어 보낸다(그 사이가 뚫리던 것 방지).
      const nH = hgt[idx(nx, nz)];
      if(Math.abs(hHere - nH) > STEP_MAX){
        wallEdges.push({ x, z, dir: d, rid: roomId[idx(x, z)], y: here ? well.botY : hHere, wellWall: here, up: Math.max(0, nH - hHere) }); continue; }
      // 방↔복도 접점(문): 복도 c → 방 r 방향 에지 + 복도가 1폭 관(수직 이웃 둘 다 void)일 때만.
      //   복도가 방 벽에 "평행"하게 붙은 개활 경계엔 문틀을 세우지 않는다(열린 경계 유지).
      if(type[idx(x, z)] === 2 && (type[idx(nx, nz)] === 1 || type[idx(nx, nz)] === 3) && d < 4){
        const px = DIRS[(d + 1) % 4][0], pz = DIRS[(d + 1) % 4][1];   // 에지 수직축
        if(!walk(x + px, z + pz) && !walk(x - px, z - pz))
          doorEdges.push({ x, z, dir: d, rid: roomId[idx(nx, nz)], y: hHere });
      }
    }
  }
  const trapRoom = (lay.trapIdx != null && rooms[lay.trapIdx]) ? rooms[lay.trapIdx] : null;   // ★템플릿 2층 진입방
  const leverRoom = (lay.leverIdx != null && rooms[lay.leverIdx]) ? rooms[lay.leverIdx] : null;   // ★레버방(보스문 개방)
  const hallRoom = rooms.find(r => r.role === 'hall') || null;   // ★2026-07-17 5차 — 큰 홀(1층↔지하1층 지그재그 램프). 있으면 구 낙하함정(twoLv) 대신 buildGrandHall 사용.
  const stairRoom = (lay.stairIdx != null && rooms[lay.stairIdx]) ? rooms[lay.stairIdx] : null;   // ★10차 — 지하 내려가는 계단방(지상)
  const alcoveRoom = (lay.alcoveIdx != null && rooms[lay.alcoveIdx]) ? rooms[lay.alcoveIdx] : null;   // ★10차 — 봉인방(엘베 도착·보스문 옆)
  return { G, type, roomId, rooms, hgt, well, entrance: ent, treasure, dist, idx, wallEdges, doorEdges, sealEdges, gauntlet, trapRoom, leverRoom, hallRoom, bossRoom: treasure,
           stairRoom, alcoveRoom, lowerSpec: lay._lowerSpec || null };
}

// fbm 노이즈(gate.js 기법 참조 — 셰이더 소용돌이/에너지 공용 헬퍼. 게이트 '비주얼' 복붙 아님)
const DGN_NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+11.7;a*=.5;}return v;}
`;
// ══════════════════════════════════════════════════════════════════════════
// ★2026-07-16 출구 포탈 — ShaderMaterial 소용돌이(fbm 연속비틀림 + 밝은 코어 + 림 페이드) + 발광 링 + 상승 입자 + 광원.
//   gate.js '하늘 소용돌이+빔+마법진' 비주얼 복붙 아님 = 바닥에 선 세로 원형 게이트웨이(고유 형태). 기법(fbm 셰이더)만 정본 준용.
//   시작 invisible → 클리어 시 visible + 광원 on. dispose는 disposeArena가 처리(_kaykitShared 아님).
// ══════════════════════════════════════════════════════════════════════════
export function buildPortal(x, z){
  const COL = new THREE.Color(0x46e88a), VOR = new THREE.Color(0x0e6b39);
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const face = new THREE.Group(); face.position.y = 2.4; g.add(face);   // 세로 게이트 중심
  const U = { uTime:{value:0}, uCol:{value:COL.clone()}, uVor:{value:VOR.clone()} };
  // 소용돌이 에너지 디스크 — 반경별 회전(mat2 연속 비틀림=시임 없음) fbm 팔 + 가는 필라멘트 + 밝은 코어 + 가장자리 페이드
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.9, 96), new THREE.ShaderMaterial({
    uniforms:U, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: DGN_NOISE + `
      varying vec2 vUv; uniform float uTime; uniform vec3 uCol,uVor;
      void main(){ vec2 p=(vUv-0.5)*2.0; float r=length(p); if(r>1.0) discard;
        float spin=uTime*0.7 - 2.6/(r+0.22);
        float ca=cos(spin), sa=sin(spin); vec2 rp=mat2(ca,-sa,sa,ca)*p;   // 연속 비틀림
        float arm=fbm(rp*2.4 + uTime*0.16)*0.6 + fbm(rp*5.2 - uTime*0.12)*0.4;
        arm=smoothstep(0.28,0.72,arm);
        float wisp=pow(clamp(fbm(rp*9.0 + uTime*0.2),0.,1.),2.2);           // 가는 밝은 실
        float radial=smoothstep(1.0,0.15,r);                                // 중심으로 밝게
        float core=smoothstep(0.42,0.0,r);                                  // 밝은 코어
        float edge=smoothstep(1.0,0.72,r);                                  // 가장자리 페이드
        float hole=smoothstep(0.0,0.12,r);
        float rim=smoothstep(0.80,0.93,r)*smoothstep(1.0,0.93,r);            // 밝은 에너지 테두리 링(도넛 메시 대신)
        float I=((arm*(0.5+wisp*0.7))*(0.45+radial*0.8) + core*1.4 + rim*2.4)*edge*hole;
        vec3 col=mix(uVor, uCol, radial) + vec3(0.75,1.0,0.88)*core*0.7 + uCol*wisp*edge*0.5 + uCol*rim*1.5;
        gl_FragColor=vec4(col*I, clamp(I,0.0,1.0)); }`}));
  face.add(disc);
  // 상승 입자(불꽃형 radial 텍스처 — additive Points, sizeAttenuation)
  const N = 64, pg = new THREE.BufferGeometry(), pp = new Float32Array(N*3);
  for(let i=0;i<N;i++){ const a=Math.random()*6.283, rr=Math.random()*1.7; pp[i*3]=Math.cos(a)*rr; pp[i*3+1]=Math.random()*3.8-0.4; pp[i*3+2]=Math.sin(a)*rr*0.28; }
  pg.setAttribute('position', new THREE.BufferAttribute(pp,3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({
    map: radialTexture(32,[[0,'rgba(224,255,238,1)'],[0.5,'rgba(90,235,158,0.8)'],[1,'rgba(40,180,110,0)']],{srgb:true}),
    color:0xaeffd2, size:0.22, transparent:true, opacity:0.9, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true }));
  g.add(pts);
  const light = new THREE.PointLight(COL.getHex(), 0, 28, 2.0); light.position.set(0, 2.4, 0); g.add(light);
  // ★버그 수정(2026-07-17, 사령관 "보스 죽을 때 5~6초 정지" 실측 원인): 그룹째 visible=false로 숨기면 이 안의 PointLight도
  //   THREE 조명 카운트에서 완전히 빠짐 — doClear()에서 그룹을 visible=true로 바꾸는 순간 씬의 활성 조명 수(NUM_POINT_LIGHTS)가
  //   바뀌어, 그 프레임에 화면에 있던 스킨드 메시(몹 시체·플레이어 등)의 라이팅 셰이더가 전부 새 조명 수로 재컴파일됨(WebGL
  //   linkProgram 계측으로 실측: 그 순간 신규 프로그램 8개, 5~6초). 그룹(=조명)은 처음부터 항상 visible로 둬 조명 카운트를
  //   던전 입장 시점(이미 프리워밍 중)부터 고정하고, 시각 요소(원반·파티클)만 개별로 숨긴다.
  disc.visible = false; pts.visible = false;
  g.userData.light = light; g.userData.disc = disc; g.userData.pts = pts;
  g.userData.spin = (dt) => { U.uTime.value += dt;
    const a = pg.attributes.position.array;
    for(let i=0;i<N;i++){ a[i*3+1] += dt*1.4; if(a[i*3+1] > 3.4){ a[i*3+1] = -0.4;
      const an=Math.random()*6.283, rr=Math.random()*1.7; a[i*3]=Math.cos(an)*rr; a[i*3+2]=Math.sin(an)*rr*0.28; } }
    pg.attributes.position.needsUpdate = true; };
  return g;
}

// ══════════════════════════════════════════════════════════════════════════
// ★2026-07-16 불 함정(엘든링 지하묘지식) — 드래곤 브레스(monsters.breathStream)와 동일 파티클 스트림 방식.
//   불 텍스처(additive) Points를 분출점에서 로컬 +Z로 뿜음(길이≈len). update(k, dt): k=세기 0..1(opacity·유량), dt=경과.
//   꺼지면(k≈0) 갱신 정지(파티클 소멸). ★원뿔 메시(구버전) 폐기 — 사령관 "너무 짜침".
// ══════════════════════════════════════════════════════════════════════════
let _fireTexOut = null, _fireTexCore = null, _emberTex = null;
function fireTexOut(){ if(!_fireTexOut) _fireTexOut = radialTexture(64,
  [[0,'rgba(255,236,180,1)'],[0.3,'rgba(255,150,50,0.9)'],[0.7,'rgba(220,60,15,0.5)'],[1,'rgba(120,20,0,0)']], { srgb:true }); return _fireTexOut; }
function fireTexCore(){ if(!_fireTexCore) _fireTexCore = radialTexture(48,
  [[0,'rgba(255,255,255,1)'],[0.4,'rgba(255,230,140,0.95)'],[1,'rgba(255,140,40,0)']], { srgb:true }); return _fireTexCore; }
function emberTex(){ if(!_emberTex) _emberTex = radialTexture(32,
  [[0,'rgba(255,240,190,1)'],[0.5,'rgba(255,150,60,0.9)'],[1,'rgba(255,90,20,0)']], { srgb:true }); return _emberTex; }
// 🔥 밀도 높은 2겹 파티클 화염 제트(드래곤 브레스급) + 잉걸불 + 노즐 코어 글로우. 로컬 +Z로 분출.
export function buildFireJet(len){
  const grp = new THREE.Group();
  const LIFE = 0.5, speed = len / LIFE;
  // 파티클 레이어 팩토리: 개수·크기·색·퍼짐·상승
  function layer(N, size, col, tex, spread, rise){
    const geo = new THREE.BufferGeometry();
    const pa = new Float32Array(N*3), life = new Float32Array(N), vel = new Float32Array(N*3);
    for(let i=0;i<N;i++){ pa[i*3]=0; pa[i*3+1]=0.7; pa[i*3+2]=0; life[i]=Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pa,3));
    const mat = new THREE.PointsMaterial({ map:tex, color:col, size, transparent:true, opacity:0,
      depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled=false; grp.add(pts);
    return { geo, pa, life, vel, N, mat, step(dt){
      for(let i=0;i<N;i++){ life[i]-=dt/LIFE;
        if(life[i]<=0){ life[i]=1; pa[i*3]=0; pa[i*3+1]=0.7; pa[i*3+2]=0;
          vel[i*3]  =(Math.random()-0.5)*speed*spread;
          vel[i*3+1]=(Math.random()-0.2)*speed*rise;
          vel[i*3+2]=(0.6+Math.random()*0.55)*speed; }
        pa[i*3]+=vel[i*3]*dt; pa[i*3+1]+=vel[i*3+1]*dt; pa[i*3+2]+=vel[i*3+2]*dt; }
      geo.attributes.position.needsUpdate=true; } };
  }
  const outer = layer(180, 1.7, 0xff5a14, fireTexOut(), 0.34, 0.24);   // 넓은 주황 화염 몸통
  const core  = layer(110, 0.9, 0xffe08a, fireTexCore(), 0.16, 0.14);  // 밝은 백열 코어(더 빠르고 좁게)
  const ember = layer(34,  0.4, 0xffd070, emberTex(), 0.5, 0.55);      // 흩날리는 잉걸불(느리게 위로)
  // 노즐 코어 글로우(분출구의 뜨거운 덩어리)
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20),
    new THREE.MeshBasicMaterial({ map:fireTexCore(), color:0xffb060, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide }));
  glow.position.set(0, 0.7, 0.2); grp.add(glow);
  grp.userData.update = (k, dt) => {
    outer.mat.opacity = 0.92*k; core.mat.opacity = 0.98*k; ember.mat.opacity = 0.9*k;
    glow.material.opacity = 0.7*k*(0.7+0.3*Math.sin(dt*0)); glow.scale.setScalar(0.7+0.5*k);
    glow.lookAt && (glow.rotation.z += dt*0.6);
    if(k<=0.02 || dt<=0) return;
    outer.step(dt); core.step(dt); ember.step(dt*0.7);
  };
  return grp;
}

// 🔩 화염 분출구(대포/스파우트형 장치) — 벽에서 나온 어두운 철제 포신. 로컬 +Z가 분출 방향. 불 붙으면 주둥이 발광.
//   불 자체(파티클)는 buildFireJet가 담당 — 이건 "불이 나오는 장치"(사령관 "대포 같은 장치"). setHot(k)로 주둥이 달아오름.
export function buildFireEmitter(){
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color:0x26262b, roughness:0.55, metalness:0.85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.34, 14), iron);
  base.rotation.x = Math.PI/2; base.position.set(0, 0.75, 0.05); g.add(base);          // 벽 부착부
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.44, 1.05, 16), iron);
  barrel.rotation.x = Math.PI/2; barrel.position.set(0, 0.75, 0.62); g.add(barrel);    // 포신(앞으로 벌어짐)
  const flange = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.10, 8, 20), iron);
  flange.position.set(0, 0.75, 1.12); g.add(flange);                                    // 주둥이 링
  const rivet = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 6, 16), iron);
  rivet.position.set(0, 0.75, 0.35); g.add(rivet);                                      // 중간 밴드(디테일)
  const tipMat = new THREE.MeshStandardMaterial({ color:0x2a140a, emissive:0xff5212, emissiveIntensity:0, roughness:0.4 });
  const tip = new THREE.Mesh(new THREE.CircleGeometry(0.32, 18), tipMat);
  tip.position.set(0, 0.75, 1.14); g.add(tip);                                          // 달아오르는 주둥이
  g.userData.muzzleZ = 1.14;                                                            // 불 시작점(로컬 +Z)
  g.userData.setHot = (k) => { tipMat.emissiveIntensity = 2.6 * k; };
  return g;
}

// 🪜 사다리(하층→상층 복귀) — 어두운 목재 레일 2 + 가로대. 오르기는 텔레포트(물리 등반 불요).
export function buildLadder(h){
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color:0x5a3a1e, roughness:0.9, metalness:0.05 });
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.13, h, 0.13), wood); railL.position.set(-0.34, h/2, 0); g.add(railL);
  const railR = railL.clone(); railR.position.x = 0.34; g.add(railR);
  const n = Math.max(3, Math.floor(h/0.5));
  for(let i=1;i<n;i++){ const rung=new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.09, 0.09), wood); rung.position.set(0, i*(h/n), 0); g.add(rung); }
  return g;
}

// ══════════════════════════════════════════════════════════════════════════
// ★방 프리팹(사령관 "방 프리팹 방식으로 근본") — 방 '내부'까지 손 설계. grid 1글자 = 셀 피처.
//   '.' 바닥 · '#' 기둥 · 'o' 대형통 · 'n' 상자더미(오름) · 't' 테이블 · 'c' 의자 · 'r' 잔해 · 'x' 보물상자
//   's' 가시함정(타이머) · 'f' 화염분출구 · '^' 벽 횃불 · 'b' 배너 · 'm' 몹 스폰 · '=' 낮은 단(엄폐)
//   반환: { grp, mobSpots, spikes, fires, chest, torches } (월드 배치는 grp.position로).
// ══════════════════════════════════════════════════════════════════════════
export function buildPrefabRoom(kit, pf, CELL, opts){
  const W = pf.w, H = pf.h;
  const grp = new THREE.Group();
  const wallAt = (opts && opts.wallAt) || null;   // ★(i,j,dir)=>bool — 그 칸의 그 변에 실제 벽(lay.wallEdges)이 있는지 정밀조회. 없으면(문·개방경계 등) 벽부착 장식 스킵
  const TH = (opts && opts.theme) || null;        // ★방 테마(ROOM_THEMES) — 아래 소품 글자 해석에 쓴다. null이면 예전 기본 조각.
  const cx = i => (i - (W-1)/2) * CELL, cz = j => (j - (H-1)/2) * CELL;
  const place = (name, x, z, rotY, y) => { const m = kit[name].clone(true); m.position.set(x, y||0, z); if(rotY) m.rotation.y = rotY; grp.add(m); return m; };
  const out = { grp, mobSpots:[], spikes:[], fires:[], chest:null, torches:[] };
  // 바닥(던전 조립 시 noFloor=기존 ① 바닥 재사용 → 내부만 얹음)
  if(!(opts && opts.noFloor)) for(let j=0;j<H;j++) for(let i=0;i<W;i++){ const dirt = kit.dirtOk && Math.random()<0.14;
    place(dirt?'floor_dirt_large_rocky':'floor_tile_large', cx(i), cz(j), ((Math.random()*4)|0)*Math.PI/2); }
  // 인테리어(grid)
  const flameGeo = new THREE.ConeGeometry(0.16,0.5,6), flameMat = new THREE.MeshBasicMaterial({ color:0xffb14e, transparent:true, opacity:0.95 });
  for(let j=0;j<H;j++){ const row = pf.grid[j]||''; for(let i=0;i<W;i++){ const ch = row[i]||'.'; const x=cx(i), z=cz(j);
    const edge = (i===0||j===0||i===W-1||j===H-1);
    // ★이 칸이 걸친 변에 실제 벽이 확인될 때만 벽부착 장식(횃불/배너) 허용 — 문 자리는 물론, 코너/폭 안 맞는 개방경계처럼
    //   문도 아니고 벽도 아닌 자리(레이아웃에 따라 생김)까지 전부 걸러냄. "문이 아니면 벽"이라는 역추정 대신 lay.wallEdges 직접 조회(2026-07-16 2차 수정).
    const sideDir = j===0?0 : i===W-1?1 : j===H-1?2 : i===0?3 : null;
    const wallHere = sideDir==null || !wallAt || wallAt(i, j, sideDir);
    const inX = i===0?1 : i===W-1?-1 : 0, inZ = j===0?1 : j===H-1?-1 : 0;   // 벽→안쪽 방향
    const J = CELL*0.34;   // ★셀 내 자연 지터(정형화 방지) + 스케일 변주
    const prop = (name) => { const m=place(name, x+(Math.random()-0.5)*J, z+(Math.random()-0.5)*J, Math.random()*6.28); m.scale.multiplyScalar(0.8+Math.random()*0.4); return m; };
    // ★가장자리 칸(edge)에 걸린 충돌 소품은 그 변에 실제 벽이 있을 때만 배치 — 문 자리에 통/상자/테이블 등이 끼어 길막되는 것 방지
    //   (전엔 횃불/배너만 이렇게 걸렀고 나머지 소품은 무조건 배치라 문 옆에 자주 걸렸음, 2026-07-16 4차)
    const blockOk = !edge || wallHere;
    // ★2026-07-22 — 소품 이름을 **방 테마가 해석**한다(ROOM_THEMES). 같은 'o'라도 목재갱도=통 / 대공동=바위잔해 / 보물방=장식통.
    //   테마가 없으면(구 FLOWS 경로 등) 예전 기본 조각 그대로 = 회귀 없음.
    // ★기둥 높이 = 그 방 벽 단수에 맞춘다. 8m 방이면 2, 16m 대전당이면 4 — 안 맞추면 기둥이 천장에 못 닿아 '큰 홀'이 안 된다.
    if(ch==='#'){ if(blockOk){ const p=place(themeProp(TH,'#','pillar'), x+(Math.random()-0.5)*0.3, z+(Math.random()-0.5)*0.3, Math.random()<0.5?0:Math.PI); p.scale.y=(opts&&opts.pillarRows)||2; } }
    else if(ch==='o'){ if(blockOk) prop(themeProp(TH,'o','barrel_large')); }
    else if(ch==='n'){ if(blockOk) prop(themeProp(TH,'n','crates_stacked')); }
    else if(ch==='t'){ if(blockOk) prop(themeProp(TH,'t','table_medium')); }
    else if(ch==='c'){ if(blockOk) prop(themeProp(TH,'c','chair')); }
    else if(ch==='r'){ if(blockOk) prop(themeProp(TH,'r','rubble_large')); }
    else if(ch==='b' && edge && wallHere){ const yaw=Math.atan2(inX,inZ); place(themeProp(TH,'b','banner_red'), x, z, yaw, 0); }
    else if(ch==='x'){ const m=place('chest_gold', x, z, Math.random()*6.28); m.position.y=0.22; out.chest={x,z}; }
    else if(ch==='s'){ const sp=place('floor_tile_big_spikes', x, z, 0, 0.02); sp.scale.set(0.85,0.9,0.85); out.spikes.push({x,z,mesh:sp}); }
    else if(ch==='f'){ const yaw=Math.atan2(inX,inZ); const em=buildFireEmitter(); em.position.set(x,0,z); em.rotation.y=yaw; grp.add(em);
      const jet=buildFireJet(CELL*1.5); jet.position.set(x+inX*1.1, 0, z+inZ*1.1); jet.rotation.y=yaw; grp.add(jet); out.fires.push({x,z,em,jet,dx:inX,dz:inZ}); }
    else if(ch==='^' && edge && wallHere){ const yaw=Math.atan2(inX,inZ);
      // ★벽면 자체가 이 칸 중심에서 CELL/2(=2m) 만큼 바깥쪽(-inX/-inZ)에 있음(addWalls·edgePos와 동일 규약) —
      //   전엔 +0.45(안쪽으로 살짝)만 줘서 벽과 1.5m 넘게 떨어진 채 방 한복판 근처에 떠 있었음. 벽면 바로 앞(-1.7)으로 이동(2026-07-16 3차, 실측).
      // ★2026-07-22 실측 재배치 (사령관 "횃불 어디감" · "너무 어두워짐")
      //   벽 조각 `wall`은 z가 -0.50~0.50이라 **벽면이 셀 중심에서 1.50m**에 있다. 그런데 옛 WOFF=-1.7은
      //   횃불을 1.70m(=벽면보다 0.20m 안쪽=벽 속)에 박았고, **불꽃(1.55m)도 벽면 뒤**라 보이지 않았다.
      //   → 벽면(1.50m)보다 확실히 앞으로 뺀다. 브래킷 1.35m · 불꽃 1.15m · 광원 1.10m.
      const WOFF = -1.35;
      const tm=place('torch_mounted', x+inX*WOFF, z+inZ*WOFF, yaw); tm.position.y=2.3;
      const fl=new THREE.Mesh(flameGeo,flameMat); fl.position.set(x+inX*(WOFF+0.20),2.6,z+inZ*(WOFF+0.20)); grp.add(fl);
      const lp=new THREE.PointLight(0xffb86b,16,34,2); lp.position.set(x+inX*(WOFF+0.25),2.65,z+inZ*(WOFF+0.25)); lp.userData._base=16; grp.add(lp); out.torches.push(lp); }   // ★2026-07-22: 12/26→16/34(방이 15개로 늘고 대공동이 커져 도달거리 부족)
    else if(ch==='m') out.mobSpots.push({x,z});
    else if(ch==='W'){ place('floor_wood_large', x, z, 0, 0.03); const bc=place('chest_gold', x, z, Math.random()*6.28); bc.position.y=0.22; out.trapdoor={x,z}; out.baitChest=bc; }   // 나무 바닥 함정(2층 진입)
    else if(ch==='P'){ out.portal={x,z}; out.bossSpot={x,z}; }   // 보스/포탈 스폰 마커
    // 낮은 단(엄폐) — ★2026-07-22 교체. 전엔 단색 BoxGeometry(0x3a3630)라 대공동 한복판에 **검은 판때기**로 보였다("짜친").
    //   → KayKit `floor_foundation_allsides`(실측 2.20×2.00×2.20 석재 기단)를 0.6m로 눌러 얹는다. 재질이 던전 벽·바닥과 통일된다.
    else if(ch==='='){
      if(kit.floor_foundation_allsides){
        const b = place('floor_foundation_allsides', x, z, ((Math.random()*4)|0)*Math.PI/2, 0);
        b.scale.set(CELL*0.86/2.2, 0.62/2.0, CELL*0.86/2.2);
      } else { const box=new THREE.Mesh(new THREE.BoxGeometry(CELL*0.8,0.6,CELL*0.8), new THREE.MeshStandardMaterial({color:0x3a3630,roughness:1})); box.position.set(x,0.3,z); grp.add(box); }
    }
    else if(ch==='L'){ (out.lavaCells||(out.lavaCells=[])).push({x,z}); }   // 🌋 용암 셀 — 여기엔 아무것도 안 놓음(바닥도 조립부가 생략=구멍). 조립부가 bounds 잡아 용암 지대 생성
  }}
  return out;
}
// ══ 방 프리팹 세트(손 설계 · 크기 각각 다름 · 함정=복도라 방 안은 엄폐/전투 위주 + 나무함정방만 W) ══
export const ROOM_PREFABS = {
  entrance: [ { w:5, h:4, grid:["#...#",".b.^.",".....","#...#"] } ],   // ★입구방=바닥 소품(o/n 등) 전부 금지 — 스폰지점 끼임 + 문쪽 길막 둘 다 방지(2026-07-16 2차)
  combat:   [ { w:6, h:5, grid:["#nb..o","o...t.","..mm.^","^.t...",".rn..#"] },
              { w:5, h:5, grid:["#..o#",".n.m.","o..t^","^m..n","#.r.#"] },
              { w:8, h:6, grid:["#n...b.o","o..t..t.","..mm..n^","^n..mm..",".t...to.","o..r..n#"] } ],
  treasure: [ { w:5, h:4, grid:["#b^b#","o.x.o","^tct^","#nrn#"] } ],
  // ★보스방(구형 FLOWS medium/large 전용) — b(배너)는 가장자리 칸에만 유효. 안쪽은 '#'(석주).
  boss:     [ { w:8, h:7, grid:["#b.^..b#","o......o",".#....#.","...PP...",".#....#.","o.r..r.o","#b^..^b#"] } ],
  // ★보스 아레나 (2026-07-24 전면 재설계 — 사령관 확정 형태. 구 11×11 "중앙 용암 + 둘레 링"은 폐기했다:
  //   "기존 용암맵 재탕이 아니라 … 보스방 입장하면 길다랗게 가는 길이 있고 기둥이 있고 양옆엔 다 용암,
  //    가운데는 링이 있고 사방에 용암이 깔려있는 형태. 맵도 더 크게, 천장도 넓게")
  //   ⇒ **용암 바다 위에 뜬 지형**으로 뒤집었다. 구 설계는 "바닥 안에 용암 웅덩이"였고, 이건 "용암 안에 바닥 섬"이다.
  //     ① 진입로 = 북쪽에서 남으로 40m 뻗는 폭 12m 코즈웨이. 양옆에 석주 열주(#), 그 바깥은 전부 용암.
  //     ② 원반 = 지름 17칸(68m) **꽉 찬 원형 무대**. 사령관 선택지 = "꽉 찬 원반(링=테두리)" — 안쪽은 용암이 아니다.
  //     ③ 링 = 원반 **테두리를 두르는 석주 링**(#). 걷는 면이 아니라 경계 표식이자 엄폐물.
  //     ④ 사방 용암 = 방 전체(21×25칸)의 나머지 전부. 바닥 타일이 생략되고 buildLavaPit이 7m 아래 용암면 + 밀폐 림을 만든다.
  //   ⚠️'^'(횃불)·'b'(배너)는 **벽에 붙는 장식**이라 이 방엔 하나도 못 쓴다 — 방 가장자리 칸이 전부 용암(L)이라
  //     벽면과 맞닿는 바닥 칸이 없다. 조명은 용암 자체 발광 + buildLavaPit의 상주 바운스 광원 2개가 담당한다.
  //   ⚠️보스 스폰 'P'는 원반 정중앙. 진입로 끝에서 원반에 올라서면 정면으로 마주 본다.
  bossarena: [ { w:21, h:25, grid:[
    "LLLLLLLL#...#LLLLLLLL",
    "LLLLLLLL.....LLLLLLLL",
    "LLLLLLLL#...#LLLLLLLL",
    "LLLLLLLL..m..LLLLLLLL",
    "LLLLLLLL#...#LLLLLLLL",
    "LLLLLLLL.....LLLLLLLL",
    "LLLLLLLL#...#LLLLLLLL",
    "LLLLLLLL..m..LLLLLLLL",
    "LLLLLLLL#...#LLLLLLLL",
    "LLLLLLL.......LLLLLLL",
    "LLLLLLL#.....#LLLLLLL",
    "LLLLL#.........#LLLLL",
    "LLLL#...........#LLLL",
    "LLL#....#...#....#LLL",
    "LLL....m.....m....LLL",
    "LL#...............#LL",
    "LL.................LL",
    "LL....#...P...#....LL",
    "LL.................LL",
    "LL#...............#LL",
    "LLL....m#...#m....LLL",
    "LLL#.............#LLL",
    "LLLL#...........#LLLL",
    "LLLLL#.........#LLLLL",
    "LLLLLLL#.....#LLLLLLL"] } ],
  trapdoor: [ { w:6, h:5, grid:["#.^..#","o....n","......","n....o","#..^.#"] } ],
  // ★2026-07-17 수제작 던전용 — 넓은 동굴 챔버(11×9). 중앙 개활지 + 단상(=), 기존 전투방보다 훨씬 큼(사령관 "큰 동굴방 하나").
  cavern:   [ { w:11, h:9, grid:["#..^...^..#","o.........o","..r.m.m.r..","..m..#..m..",".r..===..r.","..m.....m..","...m.r.m...","r..r...r..r","#..^...^..#"] } ],
  // ══ 2026-07-21 11차 지상 전용 신규(사령관 "1층 방도 다 달라야지") — 지상=인공 갱도(좁고 각짐·목재/수레/광차), 지하=천연 대공동과 대비. ══
  //   갱도A = 가늘고 긴 채굴 갱(7×5). 벽면 광차·목재 지주(통·상자더미)가 양옆으로 늘어서고 가운데 동선만 비움.
  //   ★2026-07-22 — 가운데 열(동선)은 비우고 양옆 벽을 따라 지주(#)·통·궤짝을 늘어세워 "좁고 긴 갱" 인상을 만든다.
  mineshaft:  [ { w:7, h:5, grid:["#o.^.o#","n..m..n","#.r.r.#","o.m..to","#r.^.r#"] } ],
  //   붕괴갱 = 무너진 구역(6×6). 잔해가 방 전체에 흩어져 엄폐물 역할, 몹 3. 계단실 직전 방(하강 직전 긴장).
  collapse:   [ { w:6, h:6, grid:["#.^..#","r..r.o",".m.rr.","r..m.r","o.r.mr","#r.^r#"] } ],
  // 🌋 용암 방 — 가장자리 링(안전, 어느 변으로 들어와도 착지)  ·  중앙 'L' = 큰 용암 지대(바닥 없음).
  //   링만 밟고 지나갈 수도 있음 = 하강은 선택적 도전(맨 아래 보상 상자). 욕심내면 즉사.
  lava:     [ { w:8, h:7, grid:["#..^^..#","o.LLLL.o",".bLLLL^.","..LLLL..",".^LLLL.b","o.LLLL.o","#..^^..#"] } ],
  // ══ 2026-07-20 10차 지하 전용 프리팹(대공동 성격 — 크고 트임·거친 암반·몹 많음). 지상 갱도(작은방)와 대비. ══
  stairfoot:   [ { w:6, h:6, grid:["#.^..#","o....o","..mm..","......","n....r","#.^..#"] } ],   // 계단 도착 작은 홀
  // ★2026-07-22 몹 마커 증설 (사령관 "지하 넓은 홀에비해 몬스터가 적음") — 지하 대공동은 넓이에 비해 마커가 3~4개뿐이라
  //   방별 라운드로빈으로 나눠도 큰 방에 1~2마리밖에 안 들어갔다. 넓은 방일수록 마커를 많이 준다(greatcavern 4→8·abyss 3→7·cavern 4→8·deadend 2→3).
  // ★2026-07-22 밀도 상향 (사령관 "다시 꾸며 제대로"). `_dgcensus.mjs` 집계 결과 14방 통틀어 소품이 50개뿐이었다 —
  //   벽 변형은 잘 깔렸는데(cracked 95·broken 65·arched 34) **방 안이 텅 비어** 52×44m 대공동에 기둥 하나가 전부였다.
  //   ⚠️소품은 전부 충돌체다 → 무작정 채우면 길막·draw call 문제. 동선(가운데)은 비우고 **엄폐물처럼 흩는다.**
  greatcavern: [ { w:13, h:11, grid:[
    "#..^.....^..#","o..r.....r..o",".r..===..r...","..m..===..m..","..#m.....m#..","n..r..#..r..r",
    "....m...m....","..m..r.r..m..",".r...===...r.","o..r.....r..o","#..^.....^..#"] } ],   // 거대 대공동(몹8 · 석주 3 · 단상 3 · 바위 12)
  abyss:       [ { w:9, h:8, grid:["#..^.^..#","o.......o","..m...m..",".m..#..m.","..r.m.r..","..m...m..","r..r.r..n","#..^.^..#"] } ],   // 심연(몹7 · 석주 1)
  deadend:     [ { w:7, h:6, grid:["#..^..#","o..r..o","..m.r..","r..m..r","n..m..r","#..^..#"] } ],   // 막장(몹3 · 레버는 코드 배치)
  // 🏛️ 지하 대전당 (사령관 2026-07-22 "키트로 지은 지하 대전당으로 가봐") — 던전 최심부.
  //   격자 + KayKit 조각만으로 짓는다(손으로 짠 박스 금지 — 그게 폭포 대홀을 망친 원인이다).
  //   구성: 좌우 **석주 열주 두 줄**(#) · 가운데 넓은 신랑(身廊) · 중앙 단상(=) · 안쪽 끝 보스 자리(P) ·
  //         벽면 횃불(^)과 배너(b). 방 높이는 rows:4 로 **16m**(기본 8m의 두 배)라 들어서면 규모가 읽힌다.
  grandhall: [ { w:16, h:14, grid:[
    "#..^........^..#",
    "o..............o",
    "..#..........#..",
    "^..............^",
    "..#...m..m...#..",
    "o......m.......o",
    "..#..........#..",
    "^...m......m...^",
    "o.....====.....o",
    "..#....m.....#..",
    "^...m......m...^",
    "o..b........b..o",
    "..r....PP....r..",
    "#..^........^..#"] } ],
  lowtreasure: [ { w:5, h:5, grid:["#b^b#","o.r.o","^.x.^","o.c.o","#.^.#"] } ],   // 지하 보물방(상자)
};

// ══════════════════════════════════════════════════════════════════════════
// 🎨 방 테마 팔레트 (★2026-07-22 신설 — 사령관 "쓸 수 있는 거 다 써야 할 것 같은데 / 짜치게 만들지 말고")
// ──────────────────────────────────────────────────────────────────────────
// 문제: 방 프리팹은 14개로 다르게 만들어놨는데도 "재탕"으로 보였다. 원인은 프리팹이 아니라 **재료**였다.
//   벽 1종(wall) · 바닥 2종만 써서 지었으니 크기와 소품 위치만 다른 **같은 회색 사각방**이 14개였던 것.
// 해법: 방마다 **재료 팔레트(테마)** 를 준다. 같은 ASCII 글자라도 테마가 다른 조각으로 해석한다.
//   예) 'o' = "큰 통 계열" → 목재 갱도에선 통·나무궤, 대공동에선 잔해 바위, 보물방에선 장식통.
//   ⇒ 프리팹을 한 줄도 안 고치고 방의 인상이 통째로 바뀐다. 조각을 늘릴수록 자동으로 다양해진다.
//
// 필드:
//   floors : 바닥 타일 가중치 [이름, 가중치] — ⚠️윗면 높이가 비슷한 것만(단차 방지). 실측치는 KIT_NAMES 주석 참조.
//   walls  : 벽면에 **덧대는** 장식 벽 가중치. ⚠️구조·밀폐용 `wall`을 대체하는 게 아니라 그 안쪽에 겹친다(기밀 불변식 유지).
//   wallRate : 벽 에지 중 장식을 덧댈 비율(0~1). 1로 두면 벽이 시끄럽고 draw call도 늘어난다.
//   props  : 프리팹 글자 → 후보 조각 배열. 없으면 기존 기본값을 그대로 쓴다.
export const ROOM_THEMES = {
  // ⛏️ 목재 보강 갱도 — 지상 입구권. 비계·목재·통. "사람이 판 굴".
  timber: {
    floors: [['floor_tile_large', 7], ['floor_dirt_large', 3]],
    walls:  [['wall_scaffold', 5], ['wall_open_scaffold', 4], ['wall_window_closed_scaffold', 2], ['wall_broken', 1]],
    wallRate: 0.55,
    props: {
      o: ['barrel_large', 'keg', 'barrel_small_stack', 'barrel_large_decorated'],
      n: ['crates_stacked', 'box_stacked', 'barrel_small_stack'],
      t: ['table_long', 'table_medium', 'table_small'],
      c: ['chair', 'stool'],
      r: ['rubble_half', 'rubble_large', 'floor_tile_small_broken_A'],
    },
  },
  // ⛏️ 암반 갱도 — 지상 안쪽. 돌·금 간 벽·버려진 장비. 목재가 줄고 암반이 드러난다.
  mine: {
    floors: [['floor_tile_large', 6], ['floor_dirt_large', 3], ['floor_dirt_large_rocky', 2]],
    walls:  [['wall_broken', 4], ['wall_scaffold', 3], ['wall_window_closed', 2], ['wall_sloped', 2]],
    wallRate: 0.5,
    props: {
      o: ['barrel_large', 'barrel_small_stack', 'keg'],
      n: ['crates_stacked', 'box_stacked', 'barrel_small_stack'],
      t: ['table_medium', 'table_long_broken', 'table_medium_broken'],
      c: ['stool', 'chair'],
      r: ['rubble_large', 'rubble_half', 'floor_tile_small_broken_B'],
    },
  },
  // 🕳️ 붕괴·폐갱 — 무너진 구역. 부서진 벽과 잔해가 지배한다.
  ruin: {
    floors: [['floor_tile_large', 4], ['floor_dirt_large_rocky', 4], ['floor_dirt_large', 3]],
    walls:  [['wall_broken', 7], ['wall_open_scaffold', 3], ['wall_arched', 1]],
    wallRate: 0.7,
    props: {
      o: ['barrel_large', 'rubble_large'],
      n: ['crates_stacked', 'rubble_large', 'box_stacked'],
      t: ['table_long_broken', 'table_medium_broken'],
      c: ['stool', 'chair'],
      r: ['rubble_large', 'rubble_half', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
    },
  },
  // 🕯️ 천연 대공동 — 지하. 흙·이끼·거친 암반. 인공물이 거의 없다.
  cavern: {
    floors: [['floor_dirt_large', 5], ['floor_dirt_large_rocky', 5], ['floor_tile_large', 2]],
    walls:  [['wall_broken', 6], ['wall_arched', 3], ['wall_window_open', 2]],
    wallRate: 0.6,
    props: {
      o: ['rubble_large', 'barrel_large'],
      n: ['rubble_large', 'crates_stacked'],
      t: ['table_long_broken', 'table_medium_broken'],
      c: ['stool'],
      r: ['rubble_large', 'rubble_half', 'floor_tile_small_broken_B'],
    },
  },
  // 💰 보관실·성소 — 보물방/보스방. 장식 기둥·선반·촛대·배너. 유일하게 "지어진" 공간.
  vault: {
    floors: [['floor_tile_large', 9], ['floor_dirt_large', 1]],
    walls:  [['wall_archedwindow_gated', 4], ['wall_arched', 4], ['wall_gated', 3]],
    wallRate: 0.65,
    props: {
      o: ['barrel_large_decorated', 'keg_decorated', 'barrel_large'],
      n: ['box_stacked', 'crates_stacked', 'barrel_large_decorated'],
      t: ['table_long_decorated_A', 'table_small_decorated_A', 'table_small_decorated_B'],
      c: ['chair', 'stool'],
      r: ['plate_stack', 'sword_shield_gold', 'sword_shield', 'candle_triple'],
      b: ['banner_red', 'banner_patternB_red', 'banner_triple_red', 'banner_brown'],
      '#': ['pillar', 'pillar_decorated'],
    },
  },
};
// 방 role → 테마. 본선을 걸어가며 timber → mine → ruin → (계단) → cavern → vault 로 재료가 바뀐다 = 깊이가 눈에 보인다.
export const ROLE_THEME = {
  entrance:'timber', mineshaft:'timber', trapdoor:'timber',
  combat:'mine', stairfoot:'mine',
  collapse:'ruin', deadend:'ruin',
  greatcavern:'cavern', abyss:'cavern', cavern:'cavern', lava:'cavern',
  treasure:'vault', lowtreasure:'vault', boss:'vault', grandhall:'vault',
};
/** 가중치 배열 [[이름,가중치]...] 에서 하나 뽑기. 없으면 fallback. */
export function pickWeighted(list, fallback){
  if(!list || !list.length) return fallback;
  let sum = 0; for(const e of list) sum += e[1];
  let r = Math.random() * sum;
  for(const e of list){ r -= e[1]; if(r <= 0) return e[0]; }
  return list[list.length-1][0];
}
/** 테마 소품 풀에서 글자 ch 에 해당하는 조각 하나. 풀이 없으면 기본 이름 그대로. */
function themeProp(theme, ch, dflt){
  const pool = theme && theme.props && theme.props[ch];
  if(!pool || !pool.length) return dflt;
  return pool[(Math.random() * pool.length) | 0];
}

// ══════════════════════════════════════════════════════════════════════════
// 🌋 용암 지대(Phase 2 세트피스, 사령관 확정 2026-07-16) — 방 중앙 바닥을 들어낸 큰 용암 + 그 위 지그재그 하강 발판.
//   표면 = DGN_NOISE(fbm) 정본 기법 재사용: 굳은 암각(crust) 사이로 발광 균열(crack)이 흐름. ⛔반투명 주황 평면 금지 패턴.
//   좌표 = 방 로컬(월드 배치는 root). 반환 bounds/lavaY로 루프가 즉사 판정.
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// 🏔️ 폭포 대홀 = 지하 2층 (사령관 확정 2026-07-22)
//   "마지막은 지하 2층인 셈. 나오면 큰 홀이 보이고 돌길 따라 밑으로 내려가는 형태, 폭포 보이고 밑에 보스방 보이는 형태"
//   재확인: "홀이라기보다 **산에 구멍 뚫려 있는 보스방 느낌**" ⇒ 건축물이 아니라 천연 동공.
//
// ⚠️왜 커스텀 기하인가: 던전 격자는 heightfield(한 칸=높이 하나)라 **한 공간에 높은 턱 + 중간 절벽길 + 맨 밑 바닥**을
//   동시에 둘 수 없다. buildLavaPit / buildGrandHall 과 같은 방식으로 손으로 짠다.
//
// ⚠️재질: 사령관 "예전에 cave.js 텍스처 썼던 거 그걸로 하면 됨".
//   cave.js 정본은 텍스처 맵이 아니라 **toLowpoly** — 4K 텍스처를 버리고 `flatShading` 단색으로 통일하는 처리다.
//   팔레트도 cave.js 그대로: C_ROCK 0x8a8478 · C_TUNNEL 0x6f7176 · 바닥 0x44464a · 벽 0x55585e · 천장 0x393b40.
//   ⇒ KayKit 벽돌벽(지상 갱도)과 확실히 갈려서 "지하 2층에 내려왔다"가 재질만으로 읽힌다.
//
// 좌표계: 로컬 원점 = 물웅덩이 바닥 중앙(y=0). 진입 턱은 y=+drop. 배치는 grp.position 이 담당.
// 반환: { grp, floorCol, solids, entryLocal, poolY, topY, gateLocal, mobSpots, torches, fallY }
// ══════════════════════════════════════════════════════════════════════════
// ⚡ 정적 지오메트리 병합 — 사령관 "프레임 드랍이 너무 심함"(2026-07-22).
//   실측: 던전 밖 드로우콜 **37** → 던전 안 **4,319**. 메시 6,185개가 전부 개별 드로우콜이었다.
//   던전 벽·바닥·천장은 한 번 지으면 절대 안 움직이므로, **머티리얼별로 하나의 메시로 합치면** 드로우콜이 종류 수만큼으로 준다.
//   KayKit 팩은 텍스처 아틀라스 1장을 공유하므로 대부분이 한 덩어리로 합쳐진다.
//
// ⚠️지키는 것:
//   · 월드 변환을 지오메트리에 구워 넣는다(applyMatrix4 — 노멀도 같이 보정됨).
//   · 속성 구성이 다른 지오메트리는 mergeGeometries가 null을 뱉는다 → 그 묶음은 **원본 그대로 남긴다**(안전 폴백).
//   · 병합 결과는 새 지오메트리다 → `_kaykitShared` 를 붙이지 않는다(안 그러면 disposeArena가 건너뛰어 누수).
//   · 애니메이션/런타임 제거 대상(문·상자 발광·불꽃·물·포탈)은 애초에 이 그룹에 안 넣는다.
// ⚠️★전역 병합은 하지 않는다 — **공간 청크 단위**로 합친다. 이유(실측으로 확인):
//   `three-mesh-bvh`는 CDN(esm.sh)에서 받아오는 의존성이라 **로드 실패할 수 있다**(실제로 실패한 환경을 확인했다:
//   computeBoundsTree 미설치 · boundsTree 0개 · 레이 1발 **163.9ms**). BVH 없이 통짜로 합치면 groundAt이
//   매 프레임 150만 삼각형을 전수 탐색하게 되어 **드로우콜을 줄인 대가로 레이캐스트를 파괴**한다.
//   32m 청크로 쪼개면 ①three의 바운딩 스피어 컬링이 그대로 살아 레이캐스트가 빠르고 ②프러스텀 컬링도 유지되며
//   ③드로우콜은 여전히 수십 배 준다. BVH가 붙으면 덤으로 더 빨라진다(있으면 붙인다).
function mergeStaticGroup(group, tag, chunk){
  const CH = chunk || 32;
  group.updateWorldMatrix(true, true);
  const buckets = new Map();   // (머티리얼 + 공간청크) → [geometry(월드 변환 적용)]
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const _p = new THREE.Vector3();
  group.traverse(o => {
    if(!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)){ return; }
    const gm = o.geometry.clone();
    gm.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));   // 그룹 로컬 기준으로 통일
    o.getWorldPosition(_p);
    // ★2026-07-24 버그수정 — 키에 **visible**을 넣는다. 안 넣으면 `visible=false` 콜라이더(게이트 차단판 등)가
    //   같은 머티리얼의 보이는 벽과 한 묶음으로 합쳐져 **눈에 보이는 검은 판때기로 되살아난다.**
    //   (addTrimeshMesh는 visible을 안 보므로 숨긴 콜라이더는 정상 관례인데, 병합이 그 관례를 깨고 있었다.)
    const key = o.material.uuid + '|' + (o.visible ? 1 : 0) + '|' + Math.floor(_p.x/CH) + ',' + Math.floor(_p.y/CH) + ',' + Math.floor(_p.z/CH);
    let e = buckets.get(key);
    if(!e){ e = { mat: o.material, vis: o.visible, geos: [] }; buckets.set(key, e); }
    e.geos.push(gm);
  });
  const before = (() => { let n = 0; group.traverse(o => { if(o.isMesh) n++; }); return n; })();
  group.clear();
  let after = 0;
  for(const { mat, vis, geos } of buckets.values()){
    let merged = null;
    try{ merged = mergeGeometries(geos, false); }catch(_){ merged = null; }
    if(merged){
      merged.computeBoundingSphere();   // ★청크 단위 바운딩 = 레이캐스트/프러스텀 컬링이 살아 있게 하는 핵심
      try{ if(merged.computeBoundsTree) merged.computeBoundsTree(); }catch(_){}   // BVH 있으면 덤(CDN 실패해도 무방)
      const mm = new THREE.Mesh(merged, mat); mm.visible = vis !== false; group.add(mm); after++;   // ★숨긴 콜라이더는 숨긴 채로
      for(const gm of geos) gm.dispose();
    } else {
      // 폴백 — 합칠 수 없는 묶음(속성 구성 불일치)은 개별 메시로 되돌린다.
      for(const gm of geos){ const mm = new THREE.Mesh(gm, mat); mm.visible = vis !== false; group.add(mm); after++; }
    }
  }
  console.log('[dungeonrun] ⚡ ' + tag + ' 병합 ' + before + ' → ' + after + '개 메시');
  return { before, after };
}

export function buildCascadeHall(L, kit, gate){
  const g = new THREE.Group();
  const floorCol = new THREE.Group();   // 레이캐스트(groundAt/스폰) 등록용 — 밟는 면만
  const solids = [];                    // 물리 차단(벽·난간 대용 바위턱)
  const mobSpots = [], torches = [];

  const W = L.w, D = L.d, DROP = L.drop, CW = L.pathW, RUNS = L.runs, RL = L.runLen;
  const topY = DROP;                    // 진입 턱 높이(로컬)
  const ceilY = topY + L.ceil;

  // ── cave.js 정본 재질(toLowpoly = flatShading 단색) ──
  const mkMat = (c, r) => new THREE.MeshStandardMaterial({ color:c, roughness:(r==null?1:r), metalness:0.02, flatShading:true });
  const M_ROCK  = mkMat(0x6f7176);      // C_TUNNEL — 동공 벽
  const M_FLOOR = mkMat(0x44464a);      // 바닥
  const M_CEIL  = mkMat(0x393b40);      // 천장
  const M_PATH  = mkMat(0x8a8478);      // C_ROCK — 돌길(주변 벽보다 밝아 동선이 눈에 띈다)

  const box = (mat, sx, sy, sz, x, y, z, parent) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); (parent || g).add(m); return m;
  };

  // ── ① 동공 껍질 — 바닥 아래·사방 벽·천장. 여기가 유일하게 구멍 날 수 있는 구간이라 두껍게 겹쳐 막는다.
  const T = 3.0, hw = W/2, hd = D/2;
  const poolY = 0;   // 물웅덩이 바닥 = 이 함수의 로컬 원점. ★껍질(동벽 개구부)에서 이미 쓰므로 여기서 선언(아래서 하면 TDZ 오류).
  box(M_FLOOR, W + T*2, T, D + T*2, 0, -T/2, 0);                                  // 바닥판(물웅덩이 아래)
  box(M_CEIL,  W + T*2, T, D + T*2, 0, ceilY + T/2, 0);                           // 천장
  box(M_ROCK, T, ceilY + T*2, D + T*2, -(hw + T/2), ceilY/2, 0);                  // 서벽(통짜)
  box(M_ROCK, W + T*2, ceilY + T*2, T, 0, ceilY/2, (hd + T/2));                   // 남벽(통짜)
  // ★★북벽도 통짜로 세우면 안 된다 — **복도가 여기로 들어온다.**
  //   2026-07-22: 동벽(게이트)만 뚫고 북벽을 안 뚫어서 **대홀 입구가 통째로 막혔다**(사령관 "아직도 폭포맵 막혀있음").
  //   ⚠️격자 연결성 검사(`_dgreach`)는 이걸 못 잡는다 — 격자는 내가 세운 커스텀 벽의 존재를 모른다.
  //   진입 턱(entryLocal) 자리에 개구부를 남기고 좌/우/위 세 조각으로 나눠 세운다.
  {
    const EW = 11, EH = 7;                        // 진입 개구부 폭·높이
    const ez0 = -(hd + T/2), exC = -hw + L.ledgeD/2;   // 개구부 중심 x = 진입 턱 중심
    const sideW = (W + T*2 - EW) / 2;
    box(M_ROCK, sideW, ceilY + T*2, T, exC - EW/2 - sideW/2, ceilY/2, ez0);       // 개구부 서쪽
    box(M_ROCK, sideW, ceilY + T*2, T, exC + EW/2 + sideW/2, ceilY/2, ez0);       // 개구부 동쪽
    box(M_ROCK, EW, ceilY + T*2 - EH, T, exC, topY + EH + (ceilY + T*2 - EH)/2 - T, ez0);   // 개구부 위
    box(M_ROCK, EW, Math.max(0.5, topY - poolY), T, exC, poolY + Math.max(0.5, topY - poolY)/2, ez0);   // 개구부 아래(턱 밑)
  }
  // ★★동벽만 통짜로 세우면 안 된다 — 보스 게이트가 이 벽에 붙는다.
  //   2026-07-22 실측 확인: 격자 파이프라인이 세운 경계 벽은 뚫었는데 **이 암벽을 안 뚫어서** 보스방이 완전 고립됐다
  //   (연결성 검사 `_dgreach.mjs`: 보스방 도달률 **0%**). 내가 세운 벽으로 내가 막은 것.
  //   → 개구부(폭 GW · 높이 GH)를 남기고 좌/우/위 세 조각으로 나눠 세운다. 아래는 물웅덩이 바닥이라 벽이 필요 없다.
  {
    const GW = 10, GH = 9.5, gz0 = 0;            // 게이트 개구부 — gateLocal.z(=0) 중심
    const ex = hw + T/2;
    const sideD = (D + T*2 - GW) / 2;            // 좌/우 남는 폭
    box(M_ROCK, T, ceilY + T*2, sideD, ex, ceilY/2, gz0 - GW/2 - sideD/2);        // 개구부 남쪽
    box(M_ROCK, T, ceilY + T*2, sideD, ex, ceilY/2, gz0 + GW/2 + sideD/2);        // 개구부 북쪽
    box(M_ROCK, T, ceilY + T*2 - GH, GW, ex, poolY + GH + (ceilY + T*2 - GH)/2, gz0);   // 개구부 위
  }

  // ── ② 물웅덩이 — 바닥은 걸어 다닌다(수심 무릎). 물면은 시각(반투명), 바닥은 별도.
  const pool = box(M_FLOOR, W, 0.4, D, 0, poolY - 0.2, 0, floorCol);              // ★밟는 바닥 → floorCol
  pool.material = M_FLOOR;
  // ★수면 — 단색 반투명 판때기(옛 방식) 금지. water.js 정본(프레넬 + 잔결 + 마루 포말)을 실내 웅덩이용으로 축소한 셰이더.
  //   폭포 착수점에서 퍼지는 파문이 주축이다. createPool은 waterfallfx.js.
  const fallLocal = { x: W/2 - 1.2, z: D * 0.19 };   // 폭포가 물을 때리는 자리(동쪽 벽 앞)
  const pool2 = createPool({ w: W - 1, d: D - 1, impact: { x: fallLocal.x, z: fallLocal.z } });
  pool2.mesh.position.set(0, poolY + L.poolDeep, 0); g.add(pool2.mesh);

  // ★폭포 — 동쪽 벽에서 물웅덩이로. 물줄기 + 마루 + 물안개 + 상주 광원(waterfallfx.js).
  const fallH = topY - 2 - (poolY + L.poolDeep);
  const wf = createWaterfall({ w: 7, h: fallH });
  wf.group.position.set(fallLocal.x, poolY + L.poolDeep, fallLocal.z);
  wf.group.rotation.y = -Math.PI/2;   // 물줄기 면이 서쪽(홀 안쪽)을 향함 = 진입 턱에서 정면으로 보인다
  g.add(wf.group);

  // ── ③ 진입 턱 — 서쪽 벽에 붙은 높은 발코니. 여기 서면 홀 전경 + 폭포 + 맨 밑 보스 게이트가 한눈에 보인다.
  const lx = -hw + L.ledgeD/2, lz = -hd + L.ledgeW/2;
  box(M_PATH, L.ledgeD, 1.0, L.ledgeW, lx, topY - 0.5, lz, floorCol);
  const entryLocal = { x: lx, y: topY, z: lz };

  // ── ④ 절벽 지그재그 돌길 — 서쪽 절반을 뱀처럼 왕복하며 내려온다. **드롭 쪽 난간 없음**(사령관 선택안).
  //   구간 i: x 방향으로 RL 만큼 전진하며 stepY 만큼 하강 → 끝에서 CW 만큼 z 이동(참) → 방향 반전.
  //   ★2026-07-22 재설계 — 1차는 램프를 x축으로 왕복시키며 z를 5m씩 밀었더니 **홀 바닥을 통째로 덮는 평판 더미**가 됐다
  //     (렌더로 확인). 사령관이 고른 그림은 "바위에 파인 좁은 절벽길 + 가운데는 뻥 뚫림"인데 정반대였다.
  //   ⇒ 재구성: 길은 **서쪽 벽면을 따라 남↔북으로 왕복**하고, 꺾일 때마다 동쪽으로 한 폭씩만 나온다.
  //     길 **아래는 바위로 꽉 채워** 절벽면처럼 만든다(선택 그림의 █ 부분). 동쪽 절반은 통째로 비어 폭포·물웅덩이가 보인다.
  const pathPts = [];                             // 🔧 돌길 중심선 — `_cascadewalk.mjs`가 "앞이 막혔는지" 검사할 때 쓴다
  const NR = 4;                                   // 구간 4개 = 꺾임 3번. 6개면 길이 동쪽으로 너무 많이 나온다.
  const stepY = DROP / NR;
  // ★zA는 **진입 턱이 끝나는 곳**부터. 턱(z: -hd ~ -hd+ledgeW)과 겹치면 램프 앞부분이 턱 밑에 깔려
  //   턱에서 램프로 내려설 수가 없다(실측에서 첫 3슬라이스가 턱에 가려 있었다).
  const zA = -hd + L.ledgeW + 1, zB = hd - 3;      // 길이 오가는 z 구간(남↔북)
  let curY = topY, curX = -hw + CW/2 + 1;          // 서쪽 벽에 딱 붙어서 시작
  for(let i = 0; i < NR; i++){
    const dir = (i % 2 === 0) ? 1 : -1;            // +z → -z → +z …
    const az = dir > 0 ? zA : zB, bz = dir > 0 ? zB : zA;
    const yA = curY, yB = curY - stepY;
    const len = Math.abs(bz - az), diag = Math.hypot(len, yA - yB), pitch = Math.atan2(yA - yB, len);
    // 경사 램프 — 회전시킨 박스 **한 장**(조각을 이어붙이면 이음새마다 빠지는 곳이 생긴다. 계단실에서 겪은 문제).
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(CW, 0.9, diag + 0.4), M_PATH);
    ramp.position.set(curX, (yA + yB)/2 - 0.45, (az + bz)/2);
    // ⚠️부호 주의 — Rx(+θ)는 로컬 +Z를 **아래로** 눕힌다. dir>0(=+z로 전진)일 때 내려가야 하므로 +pitch가 맞다.
    //   1차엔 -pitch를 줘서 램프가 **반대로 올라갔고**, 길(내려감)과 구간 한가운데서 교차해 정면이 막혔다
    //   (사령관 "벽 뒤로 가는 길이 보이는데 앞은 막혀있음" · ref/길x.png). `_cascadewalk.mjs`가 표면 높이 실측으로 잡아냈다.
    ramp.rotation.x = dir > 0 ? pitch : -pitch;
    g.add(ramp); { const cl = ramp.clone(); floorCol.add(cl); }
    // ★길 아래 바위 — 이게 있어야 "떠 있는 판때기"가 아니라 "바위를 깎아 낸 길"로 보인다.
    //   ⚠️2026-07-22 버그 수정(사령관 "벽 뒤로 가는 길이 보이는데 앞은 막혀있음" + 스샷 ref/길x.png·길x2.png):
    //     처음엔 이 바위를 **박스 한 장**으로 넣고 윗면을 구간 **평균 높이**에 맞췄다. 그런데 그 위의 길은 경사다
    //     → 구간 하반부에서 바위가 길보다 **stepY/2 - 0.9 = 2.85m** 솟아 **길을 정면에서 막았다.**
    //     (플레이어는 그 너머로 이어지는 길만 보이고 앞은 막힌 상태가 된다.)
    //   ⇒ 구간을 12조각으로 잘라 **각 조각의 윗면이 그 지점의 길 높이보다 항상 아래**에 오게 채운다.
    const fillW = curX + CW/2 - (-hw);
    const SLICES = 12, slLen = len / SLICES;
    for(let s = 0; s < SLICES; s++){
      const t = (s + 0.5) / SLICES;                       // 구간 내 진행도(0=시작, 1=끝)
      const yHere = yA + (yB - yA) * t;                   // 그 지점의 길 높이
      const top = yHere - 0.95;                           // 길 두께(0.9) 아래로 확실히 내림
      const h = Math.max(0.4, top - poolY);
      const zc = az + (bz - az) * t;
      box(M_ROCK, fillW, h, slLen + 0.3, -hw + fillW/2, poolY + h/2, zc);
      pathPts.push({ x: curX, y: yHere, z: zc });   // 그 지점의 길 중심(검수용)
    }
    // 참(landing) — 꺾이는 자리. 평평해서 방향 전환이 편하고, 여기서 홀 전경이 한 번씩 눈에 들어온다.
    if(i < NR - 1){
      const lzz = bz + dir*CW*0.5, lxx = curX + CW/2;
      box(M_PATH, CW*2, 0.9, CW, lxx, yB - 0.45, lzz, floorCol);
      box(M_PATH, CW*2, 0.9, CW, lxx, yB - 0.45, lzz);
      box(M_ROCK, lxx + CW - (-hw), Math.max(0.5, yB - 0.9 - poolY), CW, -hw + (lxx + CW - (-hw))/2, poolY + Math.max(0.5, yB - 0.9 - poolY)/2, lzz);
      mobSpots.push({ x: lxx, y: yB, z: lzz });   // 참마다 몹 1
      pathPts.push({ x: lxx, y: yB, z: lzz });   // 참도 경로에 포함(검수용)
      curX += CW;                                  // 다음 구간은 한 폭 동쪽으로
    }
    curY = yB;
  }
  const fallY = curY;   // 돌길 최하단(= 물웅덩이 직전)

  // ── ⑤ 보스 게이트 — 동쪽 벽 앞, 물웅덩이 건너편. 돌길을 다 내려와 물을 건너면 정면에 보인다.
  const gateLocal = { x: hw - 6, y: poolY, z: 0 };
  // 게이트 앞 마른 단 — 물 밖으로 나와 서는 자리(문 애니 볼 때 물에 잠겨 있으면 볼품없다)
  box(M_PATH, 10, 1.2, 16, hw - 5, poolY + 0.6 - 0.6, 0, floorCol);
  box(M_PATH, 10, 1.2, 16, hw - 5, poolY + 0.6 - 0.6, 0);
  // 🚪 게이트 본체 + 포탈 막. gate가 없으면(로드 실패) 조용히 건너뛴다 — 던전은 그대로 동작.
  let gateFx = null;
  if(gate && gate.scene){
    const gg = gate.scene.clone(true);
    const ap = gate.aperture, fullS = gate.full.size;
    // 통로 폭 5m·높이 6m에 맞춘다 — 원본은 수천 단위(Sketchfab 스케일)라 실측 기반으로 줄여야 한다.
    const want = 7.5, s = want / Math.max(0.001, ap.size.x);
    gg.scale.setScalar(s);
    // 개구부 바닥이 마른 단 윗면(poolY+0.6)에 오도록, 개구부 중심을 게이트 자리에 맞춰 역보정.
    const apBottomLocal = (ap.center.y - ap.size.y/2) * s;
    gg.position.set(gateLocal.x, poolY + 0.6 - apBottomLocal, gateLocal.z - ap.center.z * s);
    gg.rotation.y = -Math.PI/2;   // 문 정면이 홀 안쪽(서쪽)을 향함
    g.add(gg);
    const mixer = gate.animations.length ? new THREE.AnimationMixer(gg) : null;
    const portal = createPortal({ w: ap.size.x * s * 0.97, h: ap.size.y * s * 0.97,
      glow: 0x63e0ff, deep: 0x1b2f8a, shape: 6.0, lightIntensity: 15 });
    portal.group.position.set(gateLocal.x - 0.3, poolY + 0.6 + ap.size.y * s * 0.485, gateLocal.z);
    portal.group.rotation.y = -Math.PI/2;
    portal.setOpen(0);            // 닫힘 — 레버를 당겨야 열린다
    g.add(portal.group);
    gateFx = { mixer, portal, clips: gate.animations, opened: false, t: 0 };
  }

  const fallSpot = { x: fallLocal.x, yTop: topY - 2, yBot: poolY + L.poolDeep, z: fallLocal.z, w: 7 };

  // ── ⑦ 조명 — 상주 PointLight 소수(add/remove 반복 금지: 셰이더 재컴파일 함정).
  for(const t of [0.15, 0.5, 0.85]){
    const lp = new THREE.PointLight(0x9fc4e8, 6, 46, 2);
    lp.position.set(-hw*0.3, poolY + 4 + topY*t, -hd*0.5 + D*0.5*t);
    lp.userData._base = 6; g.add(lp); torches.push(lp);
  }
  return { grp: g, floorCol, solids, entryLocal, gateLocal, fallSpot, poolY, topY, ceilY, fallY, mobSpots, torches, W, D, pathPts,
           fx: { pool: pool2, fall: wf, gate: gateFx } };   // 루프가 매 프레임 update(dt) — 안 돌리면 물이 정지화면이 된다
}

export function buildLavaPit(minX, maxX, minZ, maxZ, L, kit){
  const g = new THREE.Group();
  const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2, w=maxX-minX, d=maxZ-minZ;
  const lavaY = -L.depth;
  const U = { uTime:{ value:0 } };
  // ══ 🌋 용암 표면 — 2026-07-24 전면 재작업 (사령관 "지금 용암 같지 않음"). 정본=`_용암VFX_리서치.md` ══
  //   구 버전은 **fbm 2옥타브 얼룩이 통째로 미끄러지는 평면**이었다. 결손 진단 7건 중 셰이더로 잡는 5건:
  //     ⓐ판(plate) 구조 없음 → **Voronoi 셀 = 굳은 현무암 판 / 셀 경계 = 균열**.
  //        실제 용암 표면은 "구름"이 아니라 갈라져 표류하는 **판**이다. 레퍼런스들이 전부 Voronoi를 쓰는 이유.
  //     ⓑ온도 구배가 2색 보간 → **흑체 램프**(검정 → **암적** → 주황 → 노랑 → 황백).
  //        특히 **암적(dull red) 구간이 없어서** 플라스틱 주황으로 보였다. 이게 "용암 같지 않음"의 색 쪽 주범.
  //     ⓒ크러스트와 균열이 같은 속도로 흐름 → **전단 분리**: 판은 느리게 표류, 균열 폭은 별도 노이즈로 벌어졌다 닫힘.
  //     ⓓ평면(정점 변위 0) → **느린 대류 변위**로 걸쭉하게 일렁이게(점성 표현은 윗면만 — 80.lv).
  //     ⓔ발광이 1.0에서 잘림 → 균열 코어를 **1.0 초과**(최대 ~3.3)로 뽑고 **블룸 레이어**에 올린다.
  //        ⚠️게임은 ACES 톤매핑(exposure 0.62)이라 1.0 이하로는 절대 "빛나 보이지" 않는다.
  //   ⛔`MeshBasicMaterial` 단색 금지(/vfx 규율) — ShaderMaterial + 노이즈 스크롤 + 코어/림, 정본 gate.js 기법 준용.
  const LAVA_NOISE = DGN_NOISE + `
    vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))))*43758.5453); }
    // Voronoi F1/F2 + 셀 해시. (F2-F1)이 0에 가까운 곳 = 셀 경계 = 균열.
    vec3 voro(vec2 p, float t){
      vec2 n=floor(p), f=fract(p);
      float f1=8.0, f2=8.0; vec2 best=n;
      for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
        vec2 gv=vec2(float(i),float(j));
        vec2 o=hash2(n+gv);
        o=0.5+0.42*sin(t*0.16 + 6.2831*o);      // 판이 살짝 꿈틀 = 표류(고정 격자로 안 보이게)
        float dd=length(gv+o-f);
        if(dd<f1){ f2=f1; f1=dd; best=n+gv; } else if(dd<f2){ f2=dd; }
      }
      return vec3(f1, f2, hash(best));
    }
    // 흑체 램프 — 굳은 현무암 → 암적 → 주황 → 노랑 → 황백.
    vec3 blackbody(float t){
      t=clamp(t,0.0,1.0);
      vec3 c0=vec3(0.020,0.014,0.012);   // 식은 현무암(거의 검정)
      vec3 c1=vec3(0.34,0.028,0.006);    // ★암적 — 이 구간이 있어야 "식어가는 돌"로 읽힌다
      vec3 c2=vec3(0.95,0.26,0.02);      // 주황
      vec3 c3=vec3(1.00,0.66,0.12);      // 노랑
      vec3 c4=vec3(1.00,0.95,0.78);      // 황백(가장 뜨거운 균열 코어)
      if(t<0.28) return mix(c0,c1,t/0.28);
      if(t<0.55) return mix(c1,c2,(t-0.28)/0.27);
      if(t<0.80) return mix(c2,c3,(t-0.55)/0.25);
      return mix(c3,c4,(t-0.80)/0.20);
    }`;
  const UL = { uTime:U.uTime, uSize:{ value:new THREE.Vector2(w+2.5, d+2.5) } };
  // 정점 세그먼트 — 대류 변위용. 4m당 1분할(넓은 용암 바다도 상한 96으로 묶어 정점 폭주 방지).
  const segX = Math.max(8, Math.min(96, Math.round((w+2.5)/4))), segZ = Math.max(8, Math.min(96, Math.round((d+2.5)/4)));
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(w+2.5, d+2.5, segX, segZ), new THREE.ShaderMaterial({
    uniforms:UL,
    // ⓓ점성 대류 — PlaneGeometry는 XY 평면이고 아래에서 -90° 눕히므로 **로컬 z가 곧 월드 높이**다.
    vertexShader: DGN_NOISE + `
      varying vec2 vUv; uniform float uTime; uniform vec2 uSize;
      void main(){ vUv=uv;
        vec3 pos=position;
        vec2 wp=uv*uSize;                                   // 월드 스케일(m) — 구덩이 크기가 달라도 파장이 일정
        float s = fbm(wp*0.085 + vec2(uTime*0.020, uTime*0.012))
                + fbm(wp*0.190 - vec2(uTime*0.014, uTime*0.009))*0.45;
        pos.z += (s-0.72)*0.42;                             // 진폭 ≈ ±0.3m — 느리고 두껍게
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0); }`,
    // ★2026-07-24 헤드리스 격리 렌더(swiftshader)로 실제 검증한 버전. scratchpad/lavatest.html에서 눈으로 확인 후 이식.
    //   핵심 = 도메인 워프로 셀 기하 흐트림(안 하면 게임 타일 느낌) + 판별 잔열(일부 판이 붉게 식는 중).
    fragmentShader: LAVA_NOISE + `
      varying vec2 vUv; uniform float uTime; uniform vec2 uSize;
      void main(){
        vec2 wp = vUv*uSize; vec2 drift = vec2(uTime*0.025, uTime*0.016);   // ⓒ판 표류(느림)
        // ★도메인 워프 — 셀이 기하학적으로 너무 깔끔한 것(게임 타일 느낌) 완화. 균열이 자연스럽게 구불.
        vec2 warp = vec2(fbm(wp*0.13+drift), fbm(wp*0.13+vec2(5.2,1.3)-drift)) - 0.5;
        vec2 wq = wp + warp*3.5;
        vec3 v = voro(wq/4.5 + drift*0.2, uTime); float cd = v.y - v.x; float plate = v.z;
        float shear = fbm(wp*0.10 - drift*1.4);
        float coreW = 0.05 + 0.05*shear, haloW = 0.40 + 0.12*shear;
        float core = 1.0 - smoothstep(0.0, coreW, cd);        // 가장 뜨거운 얇은 균열선
        float halo = 1.0 - smoothstep(0.0, haloW, cd);        // 넓은 발광(가짜 블룸 — 벽 안 뚫음)
        // ⓑ판별 잔열 — 일부 판(≈30%)은 아직 붉게 식는 중. 판 중앙일수록 뜨겁게.
        float hotPlate = smoothstep(0.62, 0.98, plate);
        float platefill = smoothstep(0.9, 0.2, v.x);
        float residual = hotPlate*platefill;
        float crust = fbm(wq*0.5+drift)*0.6 + fbm(wq*1.3-drift*0.7)*0.4;
        float pulse = 0.88 + 0.12*sin(uTime*0.6 + plate*6.28);
        float T = core*0.9 + halo*0.30 + residual*0.45*(0.4+0.6*crust);
        T *= pulse;
        vec3 col = blackbody(T);
        col += vec3(1.0, 0.5, 0.12) * pow(core, 2.5) * 0.6;                 // 코어 하이라이트(ACES 뚫기)
        col *= mix(0.30+0.45*crust, 1.0, clamp(halo+residual, 0.0, 1.0));   // 크러스트 대비
        gl_FragColor=vec4(col,1.0); }`}));
  surf.rotation.x = -Math.PI/2; surf.position.set(cx, lavaY, cz);
  // ⛔블룸 레이어 제거(2026-07-24) — 크고 상주하는 면을 블룸에 올리면 벽 뒤에서 화면 전체로 노란빛이 샌다(사령관 "노란 장판").
  //   HDR 발광값(코어 최대 3.3)은 그대로 두되 번짐은 포기. 진짜 글로우는 오클루전 블룸 별도 작업 필요.
  g.add(surf);
  // ── 🔥 잔불(불티) — 정본 기법(monsters breathStream / fxpool radialTexture): Points + additive + sizeAttenuation.
  //   수명 순환을 **GPU에서** 돌린다(uTime 하나로 결정) → 매 프레임 CPU 갱신 0. 넓은 용암 바다에 스케일감을 준다.
  {
    const N = Math.max(60, Math.min(400, Math.round((w*d)/26)));
    const seed = new Float32Array(N*3), pos0 = new Float32Array(N*3);
    for(let i=0;i<N;i++){
      pos0[i*3] = (Math.random()-0.5)*w; pos0[i*3+1] = 0; pos0[i*3+2] = (Math.random()-0.5)*d;
      seed[i*3] = Math.random();                       // 위상
      seed[i*3+1] = 0.55 + Math.random()*1.15;         // 상승 속도
      seed[i*3+2] = 0.6 + Math.random()*0.9;           // 크기
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos0,3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seed,3));
    const em = new THREE.ShaderMaterial({
      // ⚠️`radialTexture`는 premultiply 옵션이 없다(정본 시그니처 = size, stops, {inner,edge,circle,srgb}).
      //   그래서 프래그먼트에서 rgb에 a를 곱해 **직접 프리멀티플라이**한다 — 안 하면 additive에서 가장자리가 검게 뜬다.
      uniforms:{ uTime:U.uTime, uTex:{ value: radialTexture(64, [[0,'rgba(255,240,200,1)'],[0.35,'rgba(255,150,40,0.85)'],[1,'rgba(255,60,0,0)']], { circle:true }) } },
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      vertexShader:`
        attribute vec3 aSeed; uniform float uTime; varying float vLife;
        void main(){
          float life = fract(uTime*0.16*aSeed.y + aSeed.x);      // 0→1 순환
          vLife = life;
          vec3 p = position;
          p.y += life * 7.0 * aSeed.y;                            // 천천히 떠오름
          p.x += sin(uTime*0.6 + aSeed.x*30.0) * 0.7 * life;      // 열기류 흔들림
          p.z += cos(uTime*0.5 + aSeed.x*21.0) * 0.7 * life;
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          gl_PointSize = (26.0*aSeed.z) * (1.0-life*0.55) / max(0.001, -mv.z) * 34.0;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader:`
        uniform sampler2D uTex; varying float vLife;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord);
          float fade = smoothstep(0.0,0.12,vLife) * (1.0-smoothstep(0.55,1.0,vLife));
          gl_FragColor = vec4(t.rgb * t.a * 1.4, t.a) * fade; }` });   // rgb*a = 프리멀티플라이(additive 검은 테 방지)
    const embers = new THREE.Points(eg, em);
    embers.frustumCulled = false; embers.position.set(cx, lavaY+0.2, cz);
    embers.layers.enable(1);   // 블룸
    g.add(embers);
  }
  // 용암 반사광(주황 바운스) — 넓이 대비 2개면 충분(라이트 추가=셰이더 재컴파일이라 상주 고정)
  const l1=new THREE.PointLight(0xff6a1e, 7, Math.max(w,d)*1.1, 2); l1.position.set(cx, lavaY+2.2, cz-d*0.25); g.add(l1);
  const l2=new THREE.PointLight(0xff8a3c, 5, Math.max(w,d)*0.9, 2); l2.position.set(cx, lavaY+2.2, cz+d*0.25); g.add(l2);
  // ── 지그재그 하강 발판 + 길다란 좁은 길 ──
  // ★2026-07-22 발판 교체 — 전엔 `BoxGeometry` + 단색 MeshStandard(0x2b2622) 민짜 박스였다.
  //   용암 위 어두운 배경에 어두운 박스라 **거의 안 보였고**(사령관 "용암 점프맵은 보이지도 않음") 재질도 짜쳤다.
  //   → KayKit `floor_foundation_allsides`(실측 2.20×2.00×2.20 석재 블록)를 눌러 얹는다. 던전 나머지와 같은 재질·같은 톤.
  //   kit이 없으면(구 호출부) 예전 박스로 폴백 = 회귀 없음.
  const rockMat = new THREE.MeshStandardMaterial({ color:0x4a443c, roughness:0.95 });
  const FND = kit && kit.floor_foundation_allsides ? kit.floor_foundation_allsides : null;
  const solids = [];
  const slab = (x,y,z,sx,sz) => {
    let m;
    if(FND){ m = FND.clone(true);
      m.scale.set(sx/2.2, 0.5/2.0, sz/2.2);   // 조각 실측(2.2 × 2.0 × 2.2) 기준으로 원하는 판 크기에 맞춤
      m.position.set(x, y-0.5, z);            // 피벗이 밑면(minY 0) → 윗면이 y에 오도록 판 두께만큼 내림
    } else { m = new THREE.Mesh(new THREE.BoxGeometry(sx,0.5,sz), rockMat); m.position.set(x,y-0.25,z); }
    g.add(m); solids.push(m); return m; };
  const chestSpot = { x:cx, z:cz };
  {
    const N = L.steps, zA = minZ+1.2, zB = maxZ-1.2;
    for(let i=0;i<N;i++){
      const t = N>1 ? i/(N-1) : 0;
      const y = -L.dropPerStep*(i+1);
      const z = zA + (zB-zA)*t;                       // -Z → +Z 로 전진하며
      const side = (i%2===0) ? -1 : 1;                // 좌우 지그재그
      if(i === N-1){                                   // 맨 아래 = 보상 발판(가운데, 조금 넓게)
        slab(cx, y, z, L.padW*1.5, L.padW*1.5); chestSpot.x=cx; chestSpot.z=z; chestSpot.y=y;
      } else if(i === 1){                              // ★길다란 좁은 길 구간(사령관 "길다란 길들")
        slab(cx + side*(w*0.18), y, z, L.pathW, L.pathLen);
      } else {
        slab(cx + side*(w*0.22), y, z, L.padW, L.padW);
      }
    }
  }
  // ★2026-07-21 11차 — 용암 구덩이 옆구리 밀폐. 방 바닥(y0)에서 용암면 아래까지 4면 림 + 바닥 팬을 두른다.
  //   전엔 구덩이가 방 바닥 아래로 파여 있는데 방 벽은 바닥 위로만 서 있어서, 발판 위에서 수평으로 쏜 광선이
  //   방 바닥 밑을 지나 그대로 바깥으로 샜다(기밀검사 41발). 발판이 잘 보이도록 림은 어두운 암석색.
  {
    const PAN = lavaY - 1.6, TH = 1.2, hw = (maxX-minX)/2 + TH/2, hd = (maxZ-minZ)/2 + TH/2, hh = (0 - PAN);
    const rim = (sx, sy, sz, px, py, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), rockMat);
      m.position.set(px, py, pz); g.add(m); solids.push(m); };
    rim(hw*2, hh, TH, cx, PAN + hh/2, minZ - TH/2);      // N
    rim(hw*2, hh, TH, cx, PAN + hh/2, maxZ + TH/2);      // S
    rim(TH, hh, hd*2, minX - TH/2, PAN + hh/2, cz);      // W
    rim(TH, hh, hd*2, maxX + TH/2, PAN + hh/2, cz);      // E
    rim(hw*2, TH, hd*2, cx, PAN - TH/2, cz);             // 바닥 팬(용암 아래 완전 폐합)
  }
  return { grp:g, U, lavaY, minX, maxX, minZ, maxZ, solids, chestSpot };
}

// ══════════════════════════════════════════════════════════════════════════
// 🏛️ 지하 던전(1층↔지하 다층) — 2026-07-20 9차 전면 재설계(사령관 "지하도 지그재그로 내려가고, 벽도 KayKit
//   에셋으로, 불은 내려갈 때 하나씩 켜지고, 지하도 1층만한 방+몬스터 맵으로, 레버 당기면 엘리베이터가 수직상승해
//   시작지점 옆 봉인방 벽이 부서지며 열린다"). 8차(단색 박스 선형 4방 남향 체인) 폐기.
//   ── 근본 구조 ──
//   ① 벽 = KayKit `kit.wall` 시각(다른 던전과 통일) + 불투명 박스 콜라이더(검증된 차단, invisible). 바닥도 KayKit 타일.
//   ② 지그재그 = 코너 하강(A 랜딩에서 1층 문을 피해 제자리 하강) → 지하 방들이 X를 좌우로 꺾으며 -Z(시작지점 방향)로
//      단조 전진 + 매 구간 Y 하강. 마지막 구간은 buildDungeon이 넘겨준 exitLocal(시작지점 옆 봉인방 바로 아래)로 라우팅.
//   ③ 순차 점등 = 모든 횃불 intensity 0(꺼짐)으로 시작 + userData._litY(점등 임계 깊이) 부여 → 메인 루프가 플레이어가
//      그 깊이보다 내려오면 해당 횃불부터 부드럽게 켠다("내려갈 때 불이 하나씩").
//   ④ 방+몬스터 = 랜딩(A) → 적재소(B) → 균열방(C) → 큰 홀(D, 곁가지 보물방 E) → 막장(F, 레버+엘리베이터). 방마다 몹 스폰.
//   ⑤ 반환 leverLocal/elevatorLocal/surfaceLocal/bottomY = buildDungeon이 레버·엘리베이터(수직)·봉인방을 얹는 계약.
//   좌표계 = 방 로컬(원점=홀 footprint 중심). 지하 방은 전부 y<0라 1층 지형과 절대 안 겹침(수평은 자유).
// ══════════════════════════════════════════════════════════════════════════
function buildGrandHall(r, CELL, kit, opts){
  opts = opts || {};
  const grp = new THREE.Group();                 // 물리 콜라이더(벽/램프벽 박스, invisible) — pfGroups(trimesh) 등록
  const floorCol = new THREE.Group();            // ★10차-B: 지하 바닥 콜라이더 전용(trimesh + collide 레이캐스트) — 벽과 분리(groundAt 벽상단 오인 방지)
  const vis = new THREE.Group();                 // KayKit 시각(벽·바닥·소품) — decoGrp만 등록(충돌 무간섭)
  const WALL_H = (kit && kit.WALL_H) || 4;
  const half = (r.w / 2) * CELL;                 // 홀 footprint 반폭(A 랜딩용)
  const WH = 3.6;                                // 지하 방/복도 벽 높이
  const CW = 6;                                  // 통행 폭(램프/문)
  const floorMat = new THREE.MeshStandardMaterial({ color:0x241c14, roughness:0.97 });
  const boxMat   = new THREE.MeshStandardMaterial({ color:0x201a15, roughness:0.95 });   // 콜라이더 박스(invisible)
  const flameGeo = new THREE.ConeGeometry(0.16,0.5,6), flameMat = new THREE.MeshBasicMaterial({ color:0xffb14e, transparent:true, opacity:0.95 });
  const out = { grp, visGrp: vis, floorCol, mobSpots: [], torches: [] };

  // ── KayKit 벽 타일 — (cx,cz) 중심, 길이 len, alongX(true=X축 rotY0 / false=Z축 rotYπ/2). 콜라이더=불투명 박스(invisible) + 시각=kit.wall CELL 타일 ──
  const kwall = (cx, cz, len, alongX, y) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(alongX?len:0.5, WH, alongX?0.5:len), boxMat);
    box.position.set(cx, y+WH/2, cz); box.visible = false; grp.add(box);
    if(kit && kit.wall){
      const n = Math.max(1, Math.round(len / CELL)), step = len / n;
      for(let i=0;i<n;i++){ const w = kit.wall.clone(true);
        const off = -len/2 + step*(i+0.5);
        w.position.set(alongX ? cx+off : cx, y, alongX ? cz : cz+off);
        w.rotation.y = alongX ? 0 : Math.PI/2; w.scale.y = WH / WALL_H; vis.add(w); }
    }
    return box;
  };
  // ── KayKit 바닥 — 사각 영역(cx±hw, cz±hd) 평지 y. 콜라이더=박스(grp) + 시각=KayKit 타일(vis) ──
  const kfloor = (cx, cz, hw, hd, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw*2, 0.4, hd*2), floorMat); m.position.set(cx, y-0.2, cz); floorCol.add(m);   // ★바닥 콜라이더 → floorCol(레이캐스트 collide)
    if(kit && kit.floor_tile_large) for(let zz=cz-hd+CELL/2; zz<cz+hd; zz+=CELL) for(let xx=cx-hw+CELL/2; xx<cx+hw; xx+=CELL){
      const dirt = kit.dirtOk && Math.random()<0.12;
      const t = (dirt ? kit.floor_dirt_large_rocky : kit.floor_tile_large).clone(true);
      t.position.set(xx, y+0.01, zz); t.rotation.y = ((Math.random()*4)|0)*Math.PI/2; vis.add(t);
    }
    return m;
  };
  // ── KayKit 천장 — 방/램프 위를 y+WH에 덮어 어둠(외곽 쉘) 유출 차단. 불투명 박스(차폐) + 바닥타일 뒤집기(시각). collide 미등록. ──
  //   ★10차-B 지하 인클로저 수정(2026-07-21): 지하 방들이 천장이 없어 벽 위로 다 뚫려 보이던 것 → 천장으로 폐합.
  const kceil = (cx, cz, hw, hd, y) => {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(hw*2+0.4, 0.4, hd*2+0.4), boxMat); cap.position.set(cx, y+WH+0.2, cz); vis.add(cap);   // 불투명 차폐판
    if(kit && kit.floor_tile_large) for(let zz=cz-hd+CELL/2; zz<cz+hd; zz+=CELL) for(let xx=cx-hw+CELL/2; xx<cx+hw; xx+=CELL){
      const t = kit.floor_tile_large.clone(true); t.position.set(xx, y+WH+0.02, zz); t.rotation.x = Math.PI; t.rotation.z = ((Math.random()*4)|0)*Math.PI/2; vis.add(t);
    }
  };
  const pillar = (x, y, z) => { let p; if(kit && kit.pillar){ p = kit.pillar.clone(true); p.scale.y = WH/WALL_H; } else p = new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.4,WH,8), boxMat); p.position.set(x,y,z); vis.add(p); return p; };
  const prop = (name, x, y, z, ry) => { if(!kit || !kit[name]) return null; const m = kit[name].clone(true); m.position.set(x,y,z); if(ry) m.rotation.y = ry; grp.add(m); return m; };
  // ── 순차 점등 횃불 — 기둥 위 브라지어. intensity 0 시작 + _litY=점등 임계 깊이(그 아래로 내려오면 켜짐). _base=목표 밝기 ──
  const torch = (x, y, z, color, base, litY) => {
    const fl = new THREE.Mesh(flameGeo, flameMat); fl.position.set(x, y+WH+0.15, z); fl.visible = false; vis.add(fl);
    const lp = new THREE.PointLight(color||0xffb060, 0, 20, 2); lp.position.set(x, y+WH+0.2, z);
    lp.userData._base = base||9; lp.userData._litY = (litY!=null?litY:y+2); lp.userData._flame = fl; grp.add(lp);
    out.torches.push(lp); return lp;
  };
  // ── 방 = 사방 KayKit 벽(문 방향은 gap) + 바닥 + 문 옆 기둥/횃불 2개. doors=열어둘 변 집합('N'/'S'/'E'/'W') ──
  //   cx/cz=방 중심, hw/hd=반폭/반깊이, y=바닥, litY=이 방 횃불 점등 임계 깊이.
  const room = (cx, cz, hw, hd, y, doors, litY, torchColor) => {
    kfloor(cx, cz, hw, hd, y);
    kceil(cx, cz, hw, hd, y);   // ★천장 폐합(뚫림 방지)
    const gap = CW/2, seg = h2 => h2 - gap;   // 문 있는 변: 중앙 CW 비우고 양옆 seg
    // 북(z-)·남(z+): X축 벽 / 동(x+)·서(x-): Z축 벽
    const wallSide = (dir) => {
      const open = doors && doors.indexOf(dir) >= 0;
      if(dir==='N' || dir==='S'){ const z = cz + (dir==='S'? hd : -hd);
        if(!open){ kwall(cx, z, hw*2, true, y); }
        else { const s = seg(hw); if(s>0.3){ kwall(cx-(gap+s/2), z, s, true, y); kwall(cx+(gap+s/2), z, s, true, y); } } }
      else { const x = cx + (dir==='E'? hw : -hw);
        if(!open){ kwall(x, cz, hd*2, false, y); }
        else { const s = seg(hd); if(s>0.3){ kwall(x, cz-(gap+s/2), s, false, y); kwall(x, cz+(gap+s/2), s, false, y); } } }
    };
    for(const d of ['N','S','E','W']) wallSide(d);
    // 문 옆 기둥+횃불(열린 변마다) — "지그재그 내려갈 때 불 하나씩"
    if(doors) for(const d of doors){
      const along = (d==='N'||d==='S');
      const bx = cx + (along? 0 : (d==='E'? hw-0.6 : -(hw-0.6)));
      const bz = cz + (along? (d==='S'? hd-0.6 : -(hd-0.6)) : 0);
      // 문 양옆 기둥(시각) — 횃불은 한쪽만(포인트라이트 수 관리, 순차 점등)
      for(const s of [-1,1]){ const px = bx + (along? s*(gap+0.6) : 0), pz = bz + (along? 0 : s*(gap+0.6)); pillar(px, y, pz); }
      const tx = bx + (along? (gap+0.6) : 0), tz = bz + (along? 0 : (gap+0.6));
      torch(tx, y, tz, torchColor, 12, litY);   // ★base 9→12 — 어두운 앰비언트에서 방을 밝힐 주광원(횃불 의존 무드)
    }
  };

  // ══ 뱀형(serpentine) switchback — 3열×3행 격자, 경로가 좌↔우로 꺾이며 층층이 하강(A→…→막장). ══
  //   ★램프 전부 축정렬(진입각0°) — 좌우꺾임은 코너방이 두 수직면 문으로 흡수(대각램프 없음). 좌표=scratchpad/verify_zigzag.mjs 검증본(PASS).
  //   막장(SR[8])=홀로컬(52,48) 고정 → buildDungeon이 봉인방을 hall중심+(13,12셀)=이 XZ 바로 위에 두므로 엘베가 수직 도달(무회전).
  //   (구 5방 하드코딩 axis+zig 폐기 — 인접방이 축 반대편이라 램프가 근본적으로 과경사→문틈 통과불가였음. 2026-07-21 확진·재설계)
  const RH = 8, RD = 7, DHx = RH+2, DDz = RD+2, DX = 26, DZ = 24, DROP = 3.5;
  const colX = [0, DX, 2*DX], rowZ = [0, DZ, 2*DZ];
  const order = [[0,0],[1,0],[2,0],[2,1],[1,1],[0,1],[0,2],[1,2],[2,2]];   // 뱀형 방문순서(좌→우→내려→우→좌→내려→좌→우)
  const yA = 0;
  const SR = order.map(([col,row],i)=>{
    const big = i===4, landing = i===0;   // A=랜딩(홀 풋프린트) · 중앙=큰 홀 · 막장=SR[8]
    return { i, cx: colX[col], cz: rowZ[row], y: -DROP*i,
      hw: landing ? half : (big ? DHx : RH), hd: landing ? half : (big ? DDz : RD),
      color: i===8 ? 0x8fb0ff : (big ? 0xffb060 : (i%2 ? 0xd8a860 : 0x8fb0ff)), doors: [] };
  });
  // 곁가지: 보물(H=SR[7] 남쪽), 용암균열방(D'=SR[3] 동쪽)
  const BR = [
    { id:'T', role:'treasure', host: SR[7], dx: 0,  dz: DZ, hw: RH-1, hd: RD-1, doors: [] },
    { id:'V', role:'lava',     host: SR[3], dx: DX, dz: 0,  hw: RH,   hd: RD,   doors: [] },
  ];
  for(const b of BR){ b.cx = b.host.cx + b.dx; b.cz = b.host.cz + b.dz; b.y = b.host.y; }
  // 램프 링크(메인 인접쌍 8 + 곁가지 2) + 문면 계산(램프가 잇는 두 변에 문 gap). 전부 축정렬.
  const OPP = { E:'W', W:'E', N:'S', S:'N' };
  const faceOf = (a,b)=>{ const dx=b.cx-a.cx, dz=b.cz-a.cz; return Math.abs(dx)>=Math.abs(dz) ? (dx>0?'E':'W') : (dz>0?'S':'N'); };
  // ★y 필수 — 빠지면 rampSeg midY=NaN → 램프 소실 → 낙하 밖으로(2026-07-20 확진). 여기선 항상 rm.y 전달.
  const edgeOf = (rm,f)=>({ x: rm.cx + (f==='E'?rm.hw:f==='W'?-rm.hw:0), z: rm.cz + (f==='S'?rm.hd:f==='N'?-rm.hd:0), y: rm.y });
  const links = [];
  for(let i=0;i<8;i++) links.push([SR[i], SR[i+1]]);   // 메인 체인 A→…→막장
  for(const b of BR) links.push([b.host, b]);            // 곁가지
  for(const [a,b] of links){ const f = faceOf(a,b); a.doors.push(f); b.doors.push(OPP[f]);
    rampSeg(grp, floorCol, vis, kit, edgeOf(a,f), edgeOf(b,OPP[f]), CW, WH, WALL_H, boxMat, floorMat); }

  // A(SR[0]) = 1층 진입 랜딩 = 홀 footprint 전체(벽은 grid 파이프라인 소관 → room() 미호출, 바닥만).
  kfloor(0, 0, half, half, yA);
  prop('table_medium', -half+3, yA, -half+3, 0.3); prop('crates_stacked', half-3.5, yA, -half+3, 1.2);
  out.mobSpots.push({ x: 3, z: 0, y: yA });
  // ★하강 입구(mouth) — 첫 램프 A→B(+X)가 홀 footprint를 빠져나가는 +X 변(edgeOf(A,'E')=(half,0)와 일치). buildDungeon이 이 위치 1층 벽을 뚫는다.
  //   상시 켜진 횃불(litY 크게)로 "내려가는 길" 표식.
  const mouth = { x: half, z: 0 };
  out.descentMouth = { x: mouth.x, z: mouth.z };
  torch(mouth.x, yA, mouth.z, 0xffbf66, 13, yA + 50);

  // 방 B..막장(SR[1..8]) — room()이 사방벽(문 gap)+바닥+문옆 순차점등 횃불. 몹 스폰·소품.
  for(let i=1;i<SR.length;i++){ const s = SR[i];
    room(s.cx, s.cz, s.hw, s.hd, s.y, s.doors, s.y+2, s.color);
    if(i===4){   // 큰 홀 — 기둥 + 몹3
      pillar(s.cx-s.hw+2, s.y, s.cz-s.hd+2); pillar(s.cx+s.hw-2, s.y, s.cz-s.hd+2);
      out.mobSpots.push({ x:s.cx-4, z:s.cz, y:s.y }); out.mobSpots.push({ x:s.cx+4, z:s.cz+2, y:s.y }); out.mobSpots.push({ x:s.cx, z:s.cz-3, y:s.y });
    } else if(i===8){   // 막장 — 잔해 + 몹2 + 횃불
      prop('rubble_large', s.cx-s.hw+2.4, s.y, s.cz-s.hd+2, 0.3); prop('rubble_large', s.cx+s.hw-2.6, s.y, s.cz+s.hd-2, 2.1);
      out.mobSpots.push({ x:s.cx-3.5, z:s.cz, y:s.y }); out.mobSpots.push({ x:s.cx+3.5, z:s.cz+1.2, y:s.y });
      torch(s.cx, s.y, s.cz, 0x8fb0ff, 7, s.y+2);
    } else {   // 일반 전투/채광방 — 소품 + 몹2
      prop(i%3 ? 'barrel_large' : 'crates_stacked', s.cx-s.hw+2.5, s.y, s.cz-s.hd+2.5, 0.4);
      const sgn = (i%2) ? 1 : -1;
      out.mobSpots.push({ x:s.cx-3, z:s.cz, y:s.y }); out.mobSpots.push({ x:s.cx+3, z:s.cz+sgn*2, y:s.y });
    }
  }
  // 곁가지 T(보물방) — 상자 + 발광
  { const t = BR[0]; room(t.cx, t.cz, t.hw, t.hd, t.y, t.doors, t.y+2, 0xffcf72);
    if(kit && kit.chest_gold){ const bc = kit.chest_gold.clone(true); bc.position.set(t.cx, t.y+0.22, t.cz); bc.rotation.y = Math.random()*6.28; grp.add(bc); }
    const gm = new THREE.MeshBasicMaterial({ color:0xffe2a6, transparent:true, opacity:0.34, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
    const sp = new THREE.Mesh(new THREE.CircleGeometry(0.75,20), gm); sp.rotation.x=-Math.PI/2; sp.position.set(t.cx, t.y+0.5, t.cz); sp.userData._chestGlow=true; vis.add(sp);
    out.chestLocal = { x: t.cx, z: t.cz, y: t.y }; }
  // 곁가지 V(용암 균열방) — 벽 균열 시각(순수, DGN_NOISE 정본 기법) + 몹
  { const v = BR[1]; room(v.cx, v.cz, v.hw, v.hd, v.y, v.doors, v.y+2, 0xff8a3c);
    const lx = v.cx+v.hw-1.2, lz = v.cz, U = { uTime:{ value:0 } };
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(2.6,3.6), new THREE.ShaderMaterial({ uniforms:U,
      vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: DGN_NOISE + `varying vec2 vUv; uniform float uTime; void main(){ vec2 p=vUv*5.0; float f=fbm(p+vec2(uTime*0.05,uTime*0.03)); float crust=smoothstep(0.38,0.62,f); vec3 hot=mix(vec3(1.0,0.32,0.03),vec3(1.0,0.85,0.3),f); vec3 rock=vec3(0.06,0.02,0.015); gl_FragColor=vec4(mix(hot,rock,crust*0.9),1.0); }` }));
    crack.rotation.y = -Math.PI/2; crack.position.set(lx, v.y+1.9, lz); vis.add(crack); out.lavaCrackU = U;
    torch(v.cx+v.hw-1.5, v.y, v.cz, 0xff6a1e, 7, v.y+2);
    out.mobSpots.push({ x:v.cx, z:v.cz, y:v.y }); }

  out.rooms = [...SR, ...BR].map(s => ({ x: s.cx, z: s.cz, y: s.y, hw: s.hw, hd: s.hd }));   // 🔧 디버그(헤드리스 렌더 검증용)
  const F = SR[8];
  out.leverLocal    = { x: F.cx-3.4, z: F.cz+2.0, y: F.y };
  out.elevatorLocal = { x: F.cx, z: F.cz, y: F.y };      // 엘리베이터 발판(막장 중심 = 수직 상승구 바닥)
  out.surfaceLocal  = { x: F.cx, z: F.cz, y: yA };       // 수직 상승 도착점(1층 봉인방 바닥, 엘리베이터 바로 위)
  out.entryLocal    = { x: 0, z: 0, y: yA };             // A 랜딩(1층 진입 지점)
  out.bottomY = F.y;
  return out;
}

// 경사 램프 조각 — 두 지점 a→b를 CW 폭으로 잇는 내리막 바닥+양옆 벽. 지하 방들을 연결(지그재그 코너).
//   콜라이더=박스(grp) + 시각 KayKit 바닥 타일(vis). 벽은 kwall과 같은 규약(박스 콜라이더 invisible + KayKit 시각).
function rampSeg(grp, floorCol, vis, kit, a, b, CW, WH, WALL_H, boxMat, floorMat){
  // ★방어 가드 — 끝점 y가 없으면(undefined/NaN) midY=NaN → 행렬 전체 NaN → 램프 소실 → 플레이어 낙하 밖으로. 평램프로 폴백.
  if(!isFinite(a.y) || !isFinite(b.y)){ const fb = isFinite(a.y) ? a.y : (isFinite(b.y) ? b.y : 0);
    a = { x:a.x, z:a.z, y: isFinite(a.y)?a.y:fb }; b = { x:b.x, z:b.z, y: isFinite(b.y)?b.y:fb };
    console.warn('[dungeonrun] rampSeg: 끝점 y 누락 → 평램프 폴백', a, b); }
  const dx = b.x-a.x, dz = b.z-a.z, dy = b.y-a.y;
  const len = Math.hypot(dx, dz) || 0.1, midX=(a.x+b.x)/2, midZ=(a.z+b.z)/2, midY=(a.y+b.y)/2;
  const yaw = Math.atan2(dx, dz);                 // +Z 기준 회전
  const pitch = Math.atan2(dy, len);              // 내리막 각
  const g = new THREE.Group(); g.position.set(midX, midY, midZ); g.rotation.y = yaw; grp.add(g);
  // 바닥 콜라이더 → floorCol(레이캐스트 collide 대상, 몹 이동 높이) — 벽과 분리
  const fg = new THREE.Group(); fg.position.set(midX, midY, midZ); fg.rotation.y = yaw; floorCol.add(fg);
  const fl = new THREE.Mesh(new THREE.BoxGeometry(CW, 0.4, len+0.6), floorMat); fl.rotation.x = -pitch; fl.position.y = -0.2; fg.add(fl);
  for(const side of [-1,1]){ const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, WH, len+0.6), boxMat);
    w.position.set(side*CW/2, WH/2, 0); w.rotation.x = -pitch; w.visible = false; g.add(w); }
  // ★램프 천장(경사) — 없으면 램프 구간에서 벽 위로 다 뚫려 보임(2026-07-21 인클로저 수정). 시각 전용(vis), collide 미등록.
  { const cg = new THREE.Group(); cg.position.set(midX, midY, midZ); cg.rotation.y = yaw; vis.add(cg);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(CW+0.8, 0.4, len+0.6), boxMat);
    cap.rotation.x = -pitch; cap.position.y = WH + 0.2; cg.add(cap); }
  // 시각 벽(KayKit) — 램프 길이만큼 CELL 타일, 경사 따라.
  const CELL = (kit && kit.CELL) || 4;
  if(kit && kit.wall){ const gv = new THREE.Group(); gv.position.set(midX, midY, midZ); gv.rotation.y = yaw; vis.add(gv);
    const n = Math.max(1, Math.round(len/CELL)), step = len/n;
    for(const side of [-1,1]) for(let i=0;i<n;i++){ const w = kit.wall.clone(true);
      const zz = -len/2 + step*(i+0.5), yy = -Math.tan(pitch)*zz;
      w.position.set(side*CW/2, yy, zz); w.rotation.y = Math.PI/2; w.scale.y = WH/WALL_H; gv.add(w); }
    // 시각 바닥 타일(경사)
    if(kit.floor_tile_large) for(let i=0;i<n;i++){ const t = kit.floor_tile_large.clone(true);
      const zz = -len/2 + step*(i+0.5), yy = -Math.tan(pitch)*zz; t.position.set(0, yy+0.21, zz); t.rotation.x = -pitch; gv.add(t); }
  }
  return g;
}

// 🛗 엘리베이터 — 레버를 당기기 전엔 비활성(등불 꺼짐·탑승 불가). 당기면 점등되어 [E]로 탑승 가능해짐.
//   ★2026-07-17 재제작(사령관 "순간이동 말고 실제 엘리베이터처럼 바닥이 올라가야지") — 탑승 시 발판+플레이어가
//   실제로 지하1층→1층 진입 랜딩까지 수 초에 걸쳐 이동(메인 루프 elevRide 처리, buildDungeon 참조). 순간이동 폐기.
export function buildElevator(){
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color:0x3a3a42, roughness:0.5, metalness:0.8 });
  const wood = new THREE.MeshStandardMaterial({ color:0x6a4a2a, roughness:0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 2.4), wood); deck.position.y = 0.15; g.add(deck);
  for(const [sx, sz] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.2, 8), iron);
    post.position.set(sx*1.05, 1.1, sz*1.05); g.add(post);
  }
  const topA = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.12), iron); topA.position.set(0, 2.2, 1.05); g.add(topA);
  const topB = topA.clone(); topB.position.z = -1.05; g.add(topB);
  const lamp = new THREE.PointLight(0x8fd0ff, 0, 12, 2); lamp.position.set(0, 2.3, 0); g.add(lamp);
  g.userData.activate = () => { lamp.intensity = 7; };
  return g;
}

// 🚪 대형 봉인 게이트 장식(2026-07-17 재제작, 사령관 "진짜 큰 게이트문 같은게 있어야") — 교차 판자 방식 폐기.
//   양옆 석조 기둥(2단 벽 높이 전체) + 상인방 + 철제 이중 문짝(리벳) + 브라지어 2개. 기둥/상인방은 영구 장식(decoGrp),
//   문짝만 반환해 호출부가 bossDoorMeshes/shortcutMeshes에 얹어 잠금 해제 시 다른 flat wall과 함께 사라지게 한다.
function buildGateDecor(WALL_H, braColor){
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color:0x3a3a40, roughness:0.88, metalness:0.06 });
  const ironMat  = new THREE.MeshStandardMaterial({ color:0x201d1a, roughness:0.5, metalness:0.88 });
  const rivetMat = new THREE.MeshStandardMaterial({ color:0x4a4640, roughness:0.4, metalness:0.9 });
  for(const side of [-1, 1]){
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.85, WALL_H * 2, 0.85), stoneMat);
    pil.position.set(side * 1.75, WALL_H, 0); g.add(pil);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 1.1), stoneMat);
    cap.position.set(side * 1.75, WALL_H * 2 + 0.2, 0); g.add(cap);
    const bra = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.5, 8), ironMat);
    bra.position.set(side * 1.75, WALL_H * 0.95, 0.5); g.add(bra);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), new THREE.MeshBasicMaterial({ color: 0xffb14e, transparent:true, opacity:0.95 }));
    fl.position.set(side * 1.75, WALL_H * 1.25, 0.5); g.add(fl);
    const bl = new THREE.PointLight(braColor || 0xff9a3c, 7, 13, 2); bl.position.set(side * 1.75, WALL_H * 1.1, 0.6); g.add(bl);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.6, 0.75), stoneMat);
  lintel.position.set(0, WALL_H * 1.55, 0); g.add(lintel);
  // 철제 이중 문짝 — 잠금 해제 시 호출부가 visible=false 처리(다른 flat wall과 동일 규약)
  const leaves = [];
  for(const side of [-1, 1]){
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.55, WALL_H * 1.35, 0.16), ironMat);
    leaf.position.set(side * 0.79, WALL_H * 0.68, 0); g.add(leaf); leaves.push(leaf);
    for(let ry = 0; ry < 4; ry++){ const riv = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), rivetMat);
      riv.rotation.x = Math.PI / 2; riv.position.set(side * 0.79, WALL_H * (0.25 + ry * 0.32), 0.09); g.add(riv); }
  }
  return { grp: g, leaves };
}
// 🔧 레버 — 당기면 잠긴 보스문 개방. base + 회전 손잡이. pull()로 당김 애니.
export function buildLever(){
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color:0x3a3a42, roughness:0.5, metalness:0.8 });
  const wood = new THREE.MeshStandardMaterial({ color:0x6a4a2a, roughness:0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.5,1.0), iron); base.position.y=0.25; g.add(base);
  const pivot = new THREE.Group(); pivot.position.set(0,0.5,0); g.add(pivot);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,1.3,8), wood); handle.position.y=0.65; pivot.add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8), new THREE.MeshStandardMaterial({ color:0xcc3020, emissive:0x400804, emissiveIntensity:1.2, roughness:0.4 })); knob.position.y=1.3; pivot.add(knob);
  pivot.rotation.x = -0.55;   // 안 당긴 상태(뒤로 기울임)
  g.userData.pull = () => { pivot.rotation.x = 0.55; };
  return g;
}

export function initDungeonRun(ctx){
  const OFF_XZ = 380, OFF_Y = 240;   // 입장 지점 대비 던전 오프셋(D4 그대로 — 스트리밍/AI 간섭 회피 검증치)
  const SPAWN_GAP = 0.45;            // 몹 스폰 간격(s) — 콜드로드 히칫 분산
  const SPAWN_WAIT_MAX = 25;         // 스폰 대기 상한(s) — 로드 실패분은 기대치에서 제외(클리어 데드락 방지)
  const EMPTY_CLEAR_T = 30;          // 몹이 1마리도 안 나온 채 이 시간 경과 → 자동 클리어(오프라인 등 극단 방어)
  // ★2026-07-22 상한 9→22 (사령관 "너무 어두워짐"). 방이 15개(지상 7 + 지하 7 + 폭포 대홀)로 늘었는데 상한이 9면
  //   **방 하나당 0.6개**다. 거대 대공동(52×44m)·폭포 대홀(44×44m)엔 사실상 한 개도 못 들어갔다.
  //   횃불이 이 던전의 주광원이므로(앰비언트는 0.13/0.06로 거의 없음) 상한이 곧 밝기다.
  const MAX_TORCH = 22;

  // ── 상태 ──
  let active = false, cleared = false;
  let saved = null;                  // 오버월드 복귀 스냅샷 { pos, yaw, pitch, boarded, raidEnabled }
  const frozen = [];                 // 동결한 오버월드 몹(exit 시 원상복귀)
  let tag = null;                    // 이번 런 던전 몹 식별자(spawnMonster opts.tag → mn._outpostTag)
  const seenMobs = new Set();        // 실제로 스폰 확인된 던전 몹
  let pending = [], spawnT = 0, expected = 0, waitT = 0, tier = 1;
  let root = null, floorGrp = null, portal = null, torches = [], hallTorches = [];   // 던전 씬 오브젝트 (hallTorches=지하 순차 점등 전용)
  // ⚡2026-07-22 광원 풀 (사령관 "전투 프레임 드랍") — **실측으로 확정한 최적화**.
  //   three.js는 `visible`인 광원을 **intensity가 0이어도 전부 셰이더에 넣어 픽셀마다 계산**한다.
  //   던전에서 intensity 0인 광원 38개를 셰이더에서 빼자 렌더가 **584ms → 10ms**로 떨어졌다(실측).
  //   즉 '멀면 intensity 0' 방식은 밝기만 끌 뿐 **비용은 그대로** 낸다. 개수 자체를 줄여야 한다.
  //   ⇒ 횃불을 **좌표 데이터(torchSpots)** 로만 두고, 실제 광원은 **고정 개수 풀**이 플레이어 근처로 따라다닌다.
  //     개수가 고정이라 셰이더 재컴파일도 없다(개수가 바뀌면 관련 머티리얼 전체 재컴파일 = 히칫).
  const TORCH_POOL = 6;
  let torchSpots = [], torchPool = [], _torchPick = 0;
  let center = null;                 // 던전 중심(월드좌표, y=바닥 높이) — 로드 완료 전 null(업데이트 루프 대기)
  let dgExitR = 150;                  // ★외부 이탈 판정 반경 — G(그리드 크기)에 맞춰 매 입장마다 재계산(고정값이면 대형 던전서 오작동)
  let flickerT = 0;
  let runSeq = 0;                    // ★D4b 입장 시퀀스 — 로드 대기 중 이탈/재입장 시 뒤늦은 빌드 무효화
  // ★2026-07-16 보스전(잡몹 전멸 후 등급별 우버몹 1마리 — combat.js 상단 체력바 자동 표시)
  let bossPhase = false, bossSpawned = false, bossRef = null, bossSpot = null, bossKey = null;
  let dcfg = null;   // ★이번 런 티어 config(BAL.dungeon.get(tier)) — 몹수·함정·보상·광물 SSOT
  let lower = null, onLower = false, transferCd = 0;   // ★2층: 하층 챔버 정보 · 현재 하층 여부 · 이동 쿨다운
  let dgChests = [], _chestEPrev = false, _chestDlg = null;   // ★상자 [E] 개봉 등록제(미끼=함정 / 보상=열기). _chestDlg=열린 보상 대화창(동시 1개)
  let bossDoor = null, shortcutDoor = null, alcoveDoor = null, lever = null, elevator = null, bossBounds = null, bossDoorOpen = false, _leverEPrev = false, _elevEPrev = false;   // ★[3] 레버+잠긴 보스문+숏컷 게이트+봉인방 + [4] 엘리베이터(지하)
  let elevRiding = false, elevT = 0;   // ★[4] 엘리베이터 실제 탑승 이동 진행(0→1) — 순간이동 폐기
  let alcoveDebris = null;             // ★봉인방 벽 파괴 파편(레버 당김 순간 생성 → 루프에서 낙하/소거)
  let hallFx = null;   // 🏛️ 큰 홀 장식 셰이더(용암 균열 uTime) — 있으면 매 프레임 갱신
  let lavaPits = [];   // 🌋 용암 지대들 — 각 { U, lavaY, lethal, dmg, x0,x1,z0,z1 }. 루프가 즉사 판정 + 셰이더 uTime 갱신 (점프맵 + 🌋보스 링 아레나)
  let deepCued = false; // 🎵 지하 도달 시네마틱 큐 — 런당 1회(사령관 확정: 기본 앰비언트 → 지하 도달 순간 'The Deep Below')
  let bossEnter = null;    // 🚪 [E] 보스방 진입 — { x,z(게이트 앞), to:{x,y,z}(보스방 중앙) }
  let _gateEPrev = false;
  let bossGateFx = null;   // 🚪 보스 게이트(대전당 남쪽 문) — { mixer, clips, portal, opened, t }. 레버로 열린다
  let cascade = null;   // 🏔️ 폭포 대홀 — { fx:{pool,fall,gate}, ... }. 루프가 물/폭포/문 애니를 굴린다
  // ★2026-07-16 함정(스파이크 압력판 · 불 화염제트) · 어두운 무드(sky 조명/fog 오버라이드 스냅샷)
  let trapSpots = [], trapCd = 0, fireTraps = [], fireCd = 0, gauntFire = null;   // + 불의 통로(화염 파도)
  let moodSaved = null;              // { fog, bg } 오버월드 복원용
  const dungeonFog = new THREE.Fog(0x07080c, 5, 46);   // 어두운 던전 fog(가까운 far → 폐쇄·암전 무드)

  const toast = (t, o) => { try{ ukToast(t, o || { accent:'gold', ms:3000 }); }catch(_){ ctx.invui?.toast?.(t); } };

  // ── HUD(남은 몬스터 · 나가기 안내) — 존댓말 ──
  const hud = document.createElement('div');
  hud.id = 'dgrHud';
  hud.style.cssText = 'position:fixed;left:50%;top:58px;transform:translateX(-50%);z-index:30;display:none;'
    + 'padding:8px 18px;border-radius:9px;background:rgba(10,8,6,.78);border:1px solid rgba(201,168,90,.5);'
    + "color:#f0e0b0;font:600 14px Pretendard,system-ui,'Malgun Gothic';text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap";
  document.body.appendChild(hud);
  // ★2026-07-16(사령관 "상단 토스트 빼도 될 듯"): 상단 고정 배너 제거 — 상시 숨김.
  //   남은 몹 수는 표시하지 않고, 보스 등장 시 combat.js 상단 체력바가 대신 위치를 차지. 입장/클리어는 순간 토스트로만 안내.
  function updHud(){ /* 상단 배너 폐지 — no-op(호출부 보존) */ }

  // ── 등급 매칭: 플레이어 레벨 → 티어 → gates 등급 재사용(SSOT: pool=잡몹 · bossKey=우버몹) ──
  function refreshTier(){ const lv = (ctx.combat && ctx.combat.level) || 1; tier = BAL.level.tierForLevel(lv); return tier; }
  // 잡몹 풀 = 등급 pool(tier5는 dragon 단일풀이라 grade4 정예로 갈음 — 잡몹에 드래곤 방지)
  function pickPool(){ const key = { 1:'grade1', 2:'grade2', 3:'grade3', 4:'grade4', 5:'grade4' }[refreshTier()] || 'grade1';
    return (BAL.gates[key] && BAL.gates[key].pool) || BAL.gates.grade1.pool; }
  // 보스 = 등급 우버몹(tier5 = 보스 차원문 dragon 네이티브 보스)
  function bossGrade(){ return { 1:'grade1', 2:'grade2', 3:'grade3', 4:'grade4', 5:'boss' }[refreshTier()] || 'grade1'; }
  function pickBossKey(){ const g = BAL.gates[bossGrade()]; return (g && g.bossKey) || 'sk_minion'; }
  function bossColor(){ const g = BAL.gates[bossGrade()]; return (g && g.color) || 0x46e88a; }

  // ══════════════════════════════════════════════════════════════════════
  // ★D4b 던전 메시화 — genLayout 결과를 KayKit 조각 clone으로 조립.
  //   충돌 설계(D4 규칙 유지): 바닥(floorGrp)만 collide(레이캐스트: groundAt/몹 스폰/영혼 드롭)에 등록,
  //   바닥+벽+문틀+기둥은 Rapier trimesh(플레이어 보행/차단). 장식(궤짝/술통/배너/횃불대)은 시각 전용 —
  //   collide에 벽/장식이 들어가면 위에서 내려꽂는 groundAt(스폰 fromY=600)이 벽 상단을 바닥으로 오인한다.
  //   천장 없음(사령관 지시 — 스폰 레이캐스트 안전).
  //   몹 격리 부수효과: 몹 이동(_step)이 groundAt 게이트라 "타일 없는 곳=이동 불가" → 바닥을 walkable 셀에만
  //   깔면 몹이 벽 밖으로 못 나감(바닥 여유분 확장 금지 — 확장하면 벽 관통 보행 구멍 생김).
  //   반환: { entry:{x,z,yaw}, mobSpots:[{x,z,r}...](월드좌표) }
  // ══════════════════════════════════════════════════════════════════════
  function buildDungeon(kit, c, D, gate){
    const CELL = kit.CELL;
    const dsize = tier <= 2 ? 'small' : tier === 3 ? 'medium' : 'large';   // ★티어→템플릿 크기(소/중/대)
    const lay = genLayout({ size: dsize, grid: D.grid, rooms: D.rooms });
    const G = lay.G;
    root = new THREE.Group(); root.position.set(c.x, c.y, c.z);
    floorGrp = new THREE.Group();               // 바닥 전용(collide 등록 단위)
    const solidGrp = new THREE.Group();         // 벽/문틀/기둥(trimesh 차단, collide 미등록)
    const decoGrp  = new THREE.Group();         // 장식(시각 전용 · 애니메이션 있는 것 포함 → 병합 금지)
    // ★2026-07-22 성능 — **정적 장식 전용 그룹**. 천장 타일·장식 벽처럼 움직이지도 사라지지도 않는 것만 넣는다.
    //   decoGrp에 같이 넣으면 병합 대상에서 빼야 해서 드로우콜이 안 준다(천장만 1,100장이다).
    const ceilGrp  = new THREE.Group();
    root.add(floorGrp); root.add(solidGrp); root.add(decoGrp); root.add(ceilGrp);
    const L  = g => (g - G / 2) * CELL;         // 그리드좌표 → 루트 로컬(던전 중심=루트 원점)
    const CC = g => L(g + 0.5);                 // 셀 중심
    const place = (name, parent, x, z, rotY, y) => {
      const m = kit[name].clone(true);
      m.position.set(x, y || 0, z); if(rotY) m.rotation.y = rotY;
      parent.add(m); return m;
    };
    const WALL_H = kit.WALL_H || 4, ROWS = 2;   // ★벽 2단(≈8m) — 사령관 "벽 더 높게 + 위 닫기"
    // ★보물상자 발광(사령관 "상자 살짝 빛나야 끌림") — additive 헤일로 스프라이트(저비용) + 미끼상자만 광원 1개.
    const glowSpot = (x, z, withLight) => {
      const gm = new THREE.MeshBasicMaterial({ color:0xffe2a6, transparent:true, opacity:0.34, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
      const sp = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), gm); sp.rotation.x = -Math.PI/2; sp.position.set(x, 0.5, z); decoGrp.add(sp);
      sp.userData._chestGlow = true;   // 루프에서 은은한 펄스
      if(withLight){ const lp = new THREE.PointLight(0xffcf72, 5, 11, 2); lp.position.set(x, 1.1, z); root.add(lp); }
      return sp;
    };
    const dgChests = [];   // ★상자 [E] 등록(보물방·불의통로 보상=reward · 미끼=bait). 루프가 처리.
    // ★[2] 2층 물리 계획 — 방 가장자리 '함정셀' + 그 밖 void로 곧게 뻗는 하층 통로(바로 아래 -DROP). 함정셀엔 상층 바닥 생략=구멍.
    const DROP = 8;
    let twoLv = null;
    // ★다층 그리드(칸 높이 사용)면 구 낙하함정·손제작 하층 터널을 쓰지 않는다 — 하강은 그리드 복도가 담당(2026-07-21).
    //   (이 구형 경로가 살아있으면 손으로 판 터널이 천장 없이 지어져 구멍이 남는다 — 기밀검사로 확진)
    let hasDepth = false; for(let i=0;i<lay.hgt.length;i++) if(lay.hgt[i] !== 0){ hasDepth = true; break; }
    if(!lay.hallRoom && !lay.lowerSpec && !hasDepth){   // ★큰 홀 or 2층 그리드(lowerSpec) or 다층그리드면 구 낙하함정 생략
      // 함정셀 = 비-입구 방의 한쪽 가장자리. 하층 통로는 그 방 '바로 아래'로 안쪽 CL칸(항상 생성 — void 불필요, 겹침).
      const r = lay.trapRoom || lay.rooms.find(rr => rr !== lay.entrance) || lay.rooms[0];   // ★템플릿 2층 진입방 우선
      if(r){
        // ★버그 수정(2026-07-17, 사령관 "나무바닥이 입구 바로 앞이라 다시 지나가면 또 떨어져서 못 감"):
        //   기존엔 항상 서/북 변 고정 배치 — 이 방의 유일한 문이 하필 같은 변이면 함정 구멍이 유일한 출입로를 막아버림
        //   (사다리로 되돌아와도 다시 나가려면 그 구멍을 또 지나야 함 = 진행 불가). 문이 있는 변의 "반대편"에 함정을 둬서
        //   문↔함정 사이엔 항상 안전한 바닥이 남게(사다리로 복귀한 뒤 그대로 문까지 안전하게 걸어 나갈 수 있음).
        // ★2026-07-17(레버방=숏컷 게이트 추가로 문이 2개) — 북쪽(dir2) 숏컷 문은 제외하고 실제 진입 동선(동쪽 본선 문)을 우선 채택.
        //   (숏컷은 레버 당기기 전엔 잠겨있어 애초에 이 문으로 먼저 들어올 수 없음 — 함정 배치 기준으로 부적합)
        const rDoor = lay.doorEdges.find(ed => ed.rid === r.id && ed.dir !== 2) || lay.doorEdges.find(ed => ed.rid === r.id);
        const doorSide = rDoor ? (rDoor.dir + 2) % 4 : null;   // 문 에지의 dir은 "복도→방" 방향이라 +2(반대)가 방 기준 문이 붙은 변
        // ★2026-07-17(사령관 "지하로 떨어지면 바로 올라오는게 아니라 밑에도 맵이 더 길게 있어야 함") — 통로 길이 5→최대 9.
        //   하층 자체(터널 중간)는 상층과 완전히 분리된 고립 포켓(DROP=8 아래 전용 층)이라 길어져도 안전하지만,
        //   사다리 출구 칸(i=CL-1)만은 상층 바닥에 "구멍"을 뚫는 지점이라 — 그 자리가 이 방 내부이거나 진짜 빈 칸(void)일 때만
        //   안전(다른 방·연결복도 위에 얹히면 그쪽에 의도치 않은 구멍이 생김). safeLen()으로 매 칸 실측해 안전한 최대치까지만 늘린다.
        const UL = 9;
        const safeLen = (tx0, tz0, dx0, dz0) => { let n = 1;
          for(let i = 1; i < UL; i++){ const xx = tx0 + dx0*i, zz = tz0 + dz0*i;
            if(xx < 0 || zz < 0 || xx >= lay.G || zz >= lay.G) break;
            const t = lay.type[lay.idx(xx, zz)], rid = lay.roomId[lay.idx(xx, zz)];
            if(t === 0 || (t === 1 && rid === r.id)) n = i + 1; else break; }
          return Math.max(3, n); };
        if(doorSide === 3)      twoLv = { tx: r.x + r.w - 1, tz: r.cz, dx: -1, dz: 0 };   // 문=서 → 함정=동
        else if(doorSide === 1) twoLv = { tx: r.x,           tz: r.cz, dx: 1,  dz: 0 };   // 문=동 → 함정=서
        else if(doorSide === 0) twoLv = { tx: r.cx, tz: r.z + r.h - 1, dx: 0, dz: -1 };   // 문=북 → 함정=남
        else if(doorSide === 2) twoLv = { tx: r.cx, tz: r.z,           dx: 0, dz: 1  };   // 문=남 → 함정=북
        else { const horiz = r.w >= r.h;   // 문을 못 찾은 예외 상황 — 기존 기본값(방 가로/세로 비율 기준)
          twoLv = { tx: horiz ? r.x : r.cx, tz: horiz ? r.cz : r.z, dx: horiz ? 1 : 0, dz: horiz ? 0 : 1 }; }
        twoLv.CL = safeLen(twoLv.tx, twoLv.tz, twoLv.dx, twoLv.dz);
      }
    }
    // 🌋 용암 셀 = 상층 바닥 구멍(타일 생략) — 프리팹 'L' 위치를 그리드 좌표로 환산해 미리 수집(①보다 먼저 필요).
    const lavaPits = [];   // ★2026-07-23 다중 용암 지대 지원(용암 점프맵 + 🌋보스 링 아레나 공존). 이전엔 단일 lavaPitInfo였다.
    // ★2026-07-23 — 프리팹에 'L'이 있는 **모든 방**의 용암 셀을 구멍 처리(바닥 타일 생략). 전엔 role==='lava'만 봐서
    //   보스 링 아레나(role 'bossarena')의 용암이 바닥에 덮였다. buildLavaPit이 그 자리를 용암+밀폐림으로 채운다.
    const lavaHoles = new Set();
    for(const r of lay.rooms){
      const set = ROOM_PREFABS[r.role]; if(!set) continue;
      const pf = set[r.pfIdx || 0] || set[0]; if(!pf || !pf.grid) continue;
      for(let j=0;j<pf.h;j++){ const row = pf.grid[j]||''; for(let i=0;i<pf.w;i++) if(row[i]==='L') lavaHoles.add((r.x+i)+','+(r.z+j)); }
    }
    // 🏛️ 큰 홀 셀 = 상층 평바닥 생략(①에서 제외) — buildGrandHall이 직접 램프/랜딩 바닥을 짓는다(구멍 아님, 방 인테리어 단계에서 채움).
    // 🏔️ 폭포 대홀 셀 = 평바닥 생략 — buildCascadeHall이 진입 턱·절벽 돌길·물웅덩이를 직접 짓는다(구멍 아님).
    const cascadeHoles = new Set();
    { const cr = lay.rooms.find(r => r.role === 'cascade');
      if(cr) for(let i=0;i<cr.w;i++) for(let j=0;j<cr.h;j++) cascadeHoles.add((cr.x+i)+','+(cr.z+j)); }
    const hallHoles = new Set();
    if(lay.hallRoom){ const hr = lay.hallRoom;
      for(let i=0;i<hr.w;i++) for(let j=0;j<hr.h;j++) hallHoles.add((hr.x+i)+','+(hr.z+j)); }
    // 🪜 [10차] 계단실 샤프트 구멍 — 지하로 내려가는 경사 계단 통로(바닥 생략=구멍, 아래 Stage3에서 경사로 배치). 파이프라인 네이티브 구멍이라 충돌도 안 생김.
    //   경사로 폭(8m)·run(±7m)을 덮도록 x 3칸 × z 5칸 스트립으로 뚫음.
    const stairHoles = new Set();
    if(lay.lowerSpec && lay.stairRoom){ const sr = lay.stairRoom;
      for(let dx=-1;dx<=1;dx++) for(let dz=-2;dz<=2;dz++) stairHoles.add((sr.cx+dx)+','+(sr.cz+dz)); }
    // ① 바닥 — walkable 셀마다 타일 1장(윗면 ≈ 셀 높이 hgt). 복도는 흙바닥 변주 섞기(광산 정체성).
    //   ★다층화: 타일 아래에 라이저 박스(두께 SEAL)를 깔아 인접 칸과 높이차가 있어도 그 수직면이 막히게 한다(계단 옆구리 구멍 방지).
    const SEAL = 2.6;   // 라이저/천장밀폐 두께 — 최대 단차(계단 1칸 rise=2m)보다 크게 잡아 인접 칸끼리 항상 겹치게(틈 0)
    const sealMat = new THREE.MeshStandardMaterial({ color:0x2a2622, roughness:0.98 });
    // ★2026-07-21 11차 — 계단칸(type 3)은 평타일 대신 KayKit `stairs` 조각을 놓는다. 진행 방향(이전 칸 → 이 칸)으로 하강.
    //   지금까지 `stairs`는 로드만 하고 한 번도 안 쓰던 애셋(치수 실측 용도로만 존재).
    const wellInfo = lay.well || null;
    const stairAt = new Map();   // "x,z" → {y, corner, prev}
    if(wellInfo) for(const sc of wellInfo.stairCells) stairAt.set(sc.x + ',' + sc.z, sc);
    // ★kit.stairs 방향 실측 확정(2026-07-21, 사령관 "내려가는 계단이 반대로 되어있음"):
    //   높은 쪽 끝이 로컬 **z=0**(피벗), 낮은 쪽이 z=4다. 즉 로컬 +z 가 **내려가는** 방향.
    //   → 로컬 +z 를 진행 방향에 그대로 맞추고(yaw 보정 0), 피벗(높은 쪽)을 칸의 **가까운 쪽 모서리**(이전 칸과의 경계)에 둔다.
    const STAIR_YAW = 0;
    // ★2026-07-22 칸별 테마 조회 — 방 칸은 그 방 role의 테마, 복도는 깊이로 판단(지상=암반갱도 / 지하=천연 대공동).
    //   바닥 타일과 장식 벽이 이걸 보고 재료를 고른다 ⇒ 걸어가며 재료가 바뀌어 "같은 방 재탕" 인상이 사라진다.
    const themeAtCell = (x, z) => {
      const k = lay.idx(x, z), rid = lay.roomId[k];
      if(rid != null && rid >= 0 && lay.rooms && lay.rooms[rid]) return ROOM_THEMES[ROLE_THEME[lay.rooms[rid].role]] || null;
      return ROOM_THEMES[(lay.hgt[k] < -1) ? 'cavern' : 'mine'];
    };
    const safeKit = (n, dflt) => (n && kit[n] ? n : dflt);
    const DIRV_IN = [[0,1],[-1,0],[0,-1],[1,0]];   // 벽 dir → 방 **안쪽** 단위벡터(EDGE 회전 규약에서 유도)
    for(let z = 0; z < G; z++) for(let x = 0; x < G; x++){
      const t = lay.type[lay.idx(x, z)]; if(!t) continue;
      if(lavaHoles.has(x+','+z)) continue;   // 🌋 용암 구멍 — 바닥 없음(아래는 용암)
      if(hallHoles.has(x+','+z)) continue;   // 🏛️ 큰 홀 구멍 — 평바닥 대신 buildGrandHall 전용 바닥
      if(cascadeHoles.has(x+','+z)) continue;   // 🏔️ 폭포 대홀 — 평바닥 대신 buildCascadeHall 전용 기하
      if(stairHoles.has(x+','+z)) continue;   // 🪜 계단실 샤프트 구멍(사다리 통로)
      if(twoLv){ const lcx = twoLv.tx + twoLv.dx*(twoLv.CL-1), lcz = twoLv.tz + twoLv.dz*(twoLv.CL-1);
        if((x === twoLv.tx && z === twoLv.tz) || (x === lcx && z === lcz)) continue; }   // ★함정 구멍(i0) + 사다리 구멍(iCL-1)
      const hy = lay.hgt[lay.idx(x, z)];
      const sc = stairAt.get(x + ',' + z);
      if(sc && !sc.corner && sc.prev && kit.stairs){
        // 계단 1칸 — 이전 칸(높은 쪽)에서 이 칸(낮은 쪽)으로 내려온다.
        // ★kit.stairs 실측(2026-07-21): 폭 x 5.0 / 런 z 0→4 / 라이즈 y 0→5.1. 피벗이 중앙이 아니라 **높은 쪽 끝(z=0)**.
        //   피벗을 칸의 **가까운 쪽 모서리**(이전 칸과의 경계 = 높은 쪽)에 두고 로컬 +z 를 진행 방향에 맞추면
        //   계단이 칸을 정확히 채우면서 진행 방향으로 내려간다.
        const dx = x - sc.prev[0], dz = z - sc.prev[1];
        // ★2026-07-22 정렬 재계산 — 스케일 기준을 bbox 높이(5.10, 밑판 포함)에서 **밟는 면 낙차**(STAIR_DROP≈4.00)로 교체.
        //   그래야 높은 쪽 윗면이 이전 칸 바닥(hy+rise)과, 낮은 쪽 윗면이 이 칸 바닥(hy)과 **정확히** 맞는다.
        //   (전엔 낮은 쪽이 hy+0.43에 떠서 칸 경계마다 43cm 단이 생겼고 난간 기준면도 같이 어긋났다.)
        const st = kit.stairs.clone(true);
        const rise = wellInfo.rise || 2;
        const sy = rise / (kit.STAIR_DROP || kit.STAIR_RISE || 4);
        st.position.set(CC(x) - dx * CELL / 2, hy - (kit.STAIR_LOW || 0) * sy, CC(z) - dz * CELL / 2);
        st.rotation.y = Math.atan2(dx, dz) + STAIR_YAW;
        st.scale.y = sy;
        if(kit.STAIR_RUN)  st.scale.z = CELL / kit.STAIR_RUN;
        st.scale.x = CELL / 5.0;   // 조각 폭 5m > 칸 4m — 좌우로 삐져나와 벽을 뚫던 것 보정
        floorGrp.add(st); st.userData._cell = t;
      } else {
        // ★2026-07-22 바닥도 테마 팔레트에서 뽑는다(전엔 tile_large / dirt_rocky 2종 고정 = 던전 전체가 같은 바닥이었음).
        //   ⚠️후보는 **윗면 높이가 비슷한 4×4 타일만** 실측으로 골라 넣었다 — 높이가 다르면 칸마다 단차가 생겨 보행이 걸린다.
        const th = themeAtCell(x, z);
        const pick = th ? pickWeighted(th.floors, 'floor_tile_large')
                        : (kit.dirtOk && Math.random() < (t === 2 ? 0.3 : 0.12) ? 'floor_dirt_large_rocky' : 'floor_tile_large');
        const tile = place(safeKit(pick, 'floor_tile_large'), floorGrp, CC(x), CC(z),
          ((Math.random() * 4) | 0) * Math.PI / 2, hy);   // 4방 랜덤 회전 — 타일 반복감 완화(정사각 대칭이라 이음새 무변)
        tile.userData._cell = t;
      }
      const riser = new THREE.Mesh(new THREE.BoxGeometry(CELL, SEAL, CELL), sealMat);
      riser.position.set(CC(x), hy - SEAL/2, CC(z)); solidGrp.add(riser);   // trimesh만(collide 미등록 — groundAt은 타일이 담당)
    }
    // ② 벽 — walkable↔void 경계 에지마다 wall 1장. 회전 규약: 로컬 +z(두께축)가 walkable 셀 안쪽을 향함
    //    → 배너/횃불을 같은 위치·회전으로 겹치면 자동으로 "안쪽 벽면" 장식이 됨.
    //    dir: 0=N(z-1) rotY 0 · 1=E(x+1) rotY -π/2 · 2=S(z+1) rotY π · 3=W(x-1) rotY π/2
    const EDGE = [
      d => ({ rot: 0,            ex: 0.5, ez: 0   }),   // N: 에지 중점 (CC(x), L(z))
      d => ({ rot: -Math.PI / 2, ex: 1,   ez: 0.5 }),   // E: (L(x+1), CC(z))
      d => ({ rot: Math.PI,      ex: 0.5, ez: 1   }),   // S: (CC(x), L(z+1))
      d => ({ rot: Math.PI / 2,  ex: 0,   ez: 0.5 }),   // W: (L(x), CC(z))
    ];
    const edgePos = e => { const s = EDGE[e.dir](); return { x: L(e.x + s.ex), z: L(e.z + s.ez), rot: s.rot }; };
    // ★벽 2단 적층(≈8m) — 각 경계 에지마다 아래·위 두 장. 위층이 하늘/횃빛 유출을 막고 폐쇄감을 준다.
    //   ★다층화: 벽 밑단을 그 에지 칸의 높이(e.y)에서 시작 — 아래로 SEAL만큼 더 내려 깔아 계단 옆구리도 막는다.
    //   ★11차: 낮은 쪽 칸은 높은 쪽 이웃의 천장까지 닿게 `up`만큼 더 쌓는다(그 사이 수직 틈이 뚫리던 것 방지).
    //   ★11차: 계단실 바깥 벽(wellWall)은 최하부 바닥에서 계단실 천장까지 통짜 — 계단 밑 빈 공간이 바깥으로 새지 않게.
    const wellCeilY = wellInfo ? wellInfo.topY + ROWS * WALL_H : 0;
    // ★방별 벽 단수 — rid로 조회. 지정 없으면 기본 ROWS(2단).
    const roomRows = (rid) => { const rm = (rid != null && rid >= 0 && lay.rooms) ? lay.rooms[rid] : null; return (rm && rm.rows) ? rm.rows : ROWS; };
    for(const e of lay.wallEdges){ const p = edgePos(e), ey = e.y || 0;
      let rows = roomRows(e.rid) + Math.ceil((e.up || 0) / WALL_H);
      if(e.wellWall) rows = Math.max(ROWS, Math.ceil((wellCeilY - ey) / WALL_H));
      for(let r = 0; r < rows; r++) place('wall', solidGrp, p.x, p.z, p.rot, ey + r * WALL_H);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(CELL, SEAL, 0.5), sealMat);   // 벽 밑 치마(높이차 이웃 사이 틈 밀폐)
      skirt.position.set(p.x, ey - SEAL/2, p.z); skirt.rotation.y = p.rot; solidGrp.add(skirt);
      // ★2026-07-22 장식 벽 덧대기 — 팩의 벽 변형 17종을 실제로 쓴다.
      //   ⚠️**대체가 아니라 덧대기**인 이유: arched/broken/window_open 같은 변형은 구멍이 뚫려 있어
      //     밀폐 벽을 대체해버리면 기밀검사(구멍 0) 불변식이 깨진다. 위 `wall`을 그대로 두고 그 안쪽에 겹치면
      //     구멍 너머로 뒤의 밀폐 벽이 보일 뿐이라 불변식·충돌 둘 다 그대로다(decoGrp = 충돌 미등록).
      //   같은 두께(1.0m)끼리 면이 정확히 겹치면 z-fighting → 안쪽으로 0.03m 밀어 항상 앞서게 한다.
      //   눈높이인 **아래 단(row 0)에만** 얹는다 — 위 단까지 얹으면 시끄럽고 draw call만 2배.
      const wth = themeAtCell(e.x, e.z);
      if(wth && wth.walls && Math.random() < (wth.wallRate || 0.5)){
        const nm = safeKit(pickWeighted(wth.walls, null), null);
        if(nm){ const dv = DIRV_IN[e.dir];
          place(nm, ceilGrp, p.x + dv[0]*0.03, p.z + dv[1]*0.03, p.rot, ey); }   // ★정적 → 병합 대상(ceilGrp)
      } }
    // ★계단실 출입구 밑막이 — 통행 높이는 안 건드리고 그 아래(최하부 바닥까지)만 채운다.
    for(const e of (lay.sealEdges || [])){ const p = edgePos(e), hh = (e.y1 - e.y0);
      if(hh > 0.05){   // ① 출입구 바닥 밑
        const b = new THREE.Mesh(new THREE.BoxGeometry(CELL, hh, 0.8), sealMat);
        b.position.set(p.x, e.y0 + hh/2, p.z); b.rotation.y = p.rot; solidGrp.add(b); }
      const y2 = (e.nH || 0) + ROWS * WALL_H, y3 = wellCeilY;   // ② 바깥 복도 천장 위 ~ 계단실 천장
      if(y3 - y2 > 0.05){
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(CELL, y3 - y2, 0.8), sealMat);
        b2.position.set(p.x, y2 + (y3 - y2)/2, p.z); b2.rotation.y = p.rot; solidGrp.add(b2); } }
    // ★🌀 계단실 안쪽 면 마감 (사령관 "계단 마지막 내려오면 뚫려있는 공간 있음", 2026-07-21)
    //   전엔 링의 안쪽에 아무것도 안 세워서 **계단 밑이 통째로 빈 공간**이었다 → 최하부 홀에 서면 계단 아래로
    //   검은 구멍들이 뻥뻥 뚫려 보였음(기밀검사는 "바깥으로 새는가"만 보므로 통과했었다 = 검사로 못 잡는 종류).
    //   ① 소핏(계단 밑면) = 최하부 바닥 ~ 그 칸 바닥까지 안쪽 면을 막아 진짜 계단실 벽처럼 보이게
    //   ② 난간 = 계단 경사를 따라 1.1m 파라펫(콜라이더) — 샤프트로 떨어지는 것도 막는다. 서면 너머로 아래가 보이는 높이.
    if(wellInfo){
      const DIRV = [[0,-1],[1,0],[0,1],[-1,0]];
      const rail = new THREE.MeshStandardMaterial({ color:0x6d7079, roughness:0.9 });
      const RAIL_H = 1.1, TH = 0.42;
      for(const sc of wellInfo.stairCells){
        const hy = sc.y;
        for(let d=0; d<4; d++){
          const nx = sc.x + DIRV[d][0], nz = sc.z + DIRV[d][1];
          if(!wellInfo.inner.has(nx + ',' + nz)) continue;          // 안쪽(샤프트) 면만
          const nh = lay.hgt[lay.idx(nx, nz)];
          if(Math.abs(nh - hy) < 0.05) continue;                    // 같은 높이 = 최하부로 이어지는 통로 → 막지 않는다
          const s = EDGE[d](), ex = L(sc.x + s.ex), ez = L(sc.z + s.ez), rot = s.rot;
          // ① 소핏 — 최하부 바닥에서 이 칸 바닥까지. 시각은 KayKit 벽 타일(던전 전체와 통일), 뒤에 밀폐 박스 1장.
          const sh = hy - wellInfo.botY;
          if(sh > 0.05){
            // ★★2026-07-22 사령관 "계단 난간 아직도 솟아나 있음" — 진범은 난간이 아니라 **이 소핏 벽**이었다.
            //   소핏은 4m짜리 wall 타일로 쌓는데 필요한 높이(sh)는 rise=2 배수다. 옛 조건 `r*WALL_H < sh`는
            //   마지막 타일이 sh를 **최대 4m까지 넘겨** 쌓게 해서, 계단 바닥이 -2m인 칸에선 소핏이 0m까지 솟았다
            //   → 계단 옆으로 2m가 튀어나오고 난간은 그 안에 파묻힘. (난간 좌표 자체는 _railprobe.mjs 실측 결과 전부 정상이었다.)
            //   ⇒ 꽉 차는 단만 온전한 타일로 쌓고, 남는 높이는 마지막 한 장을 그만큼 **눌러서** 정확히 맞춘다.
            //   ★2026-07-22 재수정 (사령관 "찢겨진 부분 있고") — 위 방식은 남는 높이를 **마지막 타일을 눌러서**(scale.y) 맞췄다.
            //   sh가 rise=2 배수라 절반의 칸에서 2m로 눌린 타일이 생겼고, **벽돌 결이 세로로 찌그러져** 옆 칸과 안 맞았다.
            //   그게 "찢어진" 것처럼 보인 정체다. ⇒ 누르지 말고 **위에서 아래로** 온전한 타일만 쌓는다.
            //   맨 아래 한 장이 최하부 바닥 밑으로 삐져나가는 건 무해하다(바닥판에 가려 안 보임). 윗면은 항상 계단면과 정확히 일치.
            for(let y = hy - WALL_H; y > wellInfo.botY - WALL_H - 0.05; y -= WALL_H)
              place('wall', solidGrp, ex, ez, rot, y);
            const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, sh, 0.7), sealMat);
            m.position.set(ex, wellInfo.botY + sh/2, ez); m.rotation.y = rot; solidGrp.add(m);
}
          // ② 파라펫(난간) — ★2026-07-22 3차. 사령관 "계단 난간 아직도 솟아나 있음".
          //   폐기 이력: ⓐ회색 BoxGeometry(기준 어긋나 파묻힘/뜸) → ⓑKayKit `barrier`를 계단 경사에 맞춰 기울여 얹기.
          //   ⓑ는 _railprobe.mjs 실측상 좌표가 전부 정확했는데도(오차 3cm) 눈으로 보면 **계단 옆에 뜬 막대**로 보였다.
          //   원인: 계단 조각에 이미 옆판(스트링거)이 있어서, 그 위에 별도 막대를 얹으면 두 겹이 어긋나 보인다.
          //   ⇒ **별도 난간을 없애고 소핏 벽을 그대로 파라펫 높이까지 이어 올린다.** 계단과 같은 2m 단위 계단식이라
          //     구조적으로 뜰 수가 없고, 재료도 던전 벽과 동일하다. 1.1m라 서면 너머로 샤프트 아래가 보인다(사령관 확정 형태 유지).
          // ⛔2026-07-22 난간 **완전 제거** — 사령관 "난간도 이상해 · 제대로 못할 거면 계단만 만들던가".
          //   시도 이력: ⓐ회색 BoxGeometry 파라펫 → 계단면과 기준이 어긋나 뜸/파묻힘
          //             ⓑKayKit barrier 를 경사에 맞춰 기울임 → 좌표는 실측상 정확했는데도 계단 옆에 뜬 막대로 보임
          //             ⓒ소핏 벽을 1.15m 파라펫으로 이어 올림 → 벽 한 장을 눌러 쓰니 벽돌결이 찌그러져 "찢어진" 것처럼 보임
          //   세 번 다 실패했으므로 **난간 자체를 없앤다.** 계단과 소핏(밑면)만 남는다.
          //   ⚠️드롭 쪽이 트여 있으므로 떨어질 수 있다 — 이건 사령관 지시(계단만)에 따른 의도된 상태다.
          // (구) 기울인 barrier 막대 — 아래 블록은 사령관 지적으로 비활성. 되살릴 일 있으면 이 주석째 참고.
          if(false){   // eslint-disable-line no-constant-condition
          //   폐기: 회색 BoxGeometry 파라펫. 게다가 중심 y를 `hy + rise/2 + RAIL_H/2`로 잡아
          //         높은 쪽에선 계단에 파묻히고 낮은 쪽에선 57cm 떠 있었다(계단 밟는 면과 기준이 어긋남).
          //   신설: KayKit `barrier`(실측 4.0×1.10, 피벗=밑면 중앙) — 던전 나머지와 같은 조각·같은 톤.
          //   ★밟는 면 기준: 계단칸은 near(높은 쪽)=hy+rise → far(낮은 쪽)=hy. 칸 중앙 = hy + rise/2.
          //     barrier 피벗이 밑면이라 position.y = 그 중앙값 그대로 두고 길이축(x)만 경사 길이로 늘린다.
          const isRun = !sc.corner && sc.prev;
          const rise = isRun ? (wellInfo.rise || 2) : 0;
          const bw = kit.BARRIER_W || CELL;
          const br = kit.barrier.clone(true);
          br.position.set(ex, hy + rise / 2, ez); br.rotation.y = rot;
          br.scale.x = (Math.hypot(CELL, rise) + 0.12) / bw;   // 경사면 실길이(대각)만큼 늘려 이음새 없이 이어짐
          if(isRun){   // 진행축이 이 변과 나란할 때만 기울임(수직이면 참처럼 수평)
            const along = (d === 0 || d === 2) ? Math.abs(sc.x - sc.prev[0]) : Math.abs(sc.z - sc.prev[1]);
            if(along){ const sgn = ((d === 0 || d === 2) ? (sc.x - sc.prev[0]) : (sc.z - sc.prev[1]));
              br.rotateZ((d === 1 || d === 3 ? -1 : 1) * Math.sign(sgn) * Math.atan2(rise, CELL)); }
          }
          br.userData._rail = { gx: sc.x, gz: sc.z, d, hy, rise, corner: !!sc.corner };   // 🔧 검증 훅(_railprobe.mjs가 읽음)
          decoGrp.add(br);   // 시각 전용 — 충돌은 아래 보이지 않는 박스가 담당(난간 살 사이로 빠지는 것 방지)
          // ★충돌체 — barrier는 살 사이가 뚫린 조각이라 trimesh로 쓰면 틈으로 밀려 나갈 수 있다.
          //   같은 자리에 보이지 않는 판 1장(높이 RAIL_H)을 solidGrp에 넣어 확실히 막는다.
          const col = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(CELL, rise) + 0.12, RAIL_H, TH), rail);
          col.position.copy(br.position); col.rotation.copy(br.rotation);
          col.position.y += RAIL_H / 2;   // 박스는 중심 피벗 — 밑면을 밟는 면에 맞춤
          col.visible = false;            // addTrimeshMesh는 visible을 보지 않으므로 충돌은 그대로 유효
          solidGrp.add(col);
          }   // ← if(false) 끝 (구 barrier 방식 비활성)
        }
      }
    }
    // ③ 문틀 — 방↔복도 접점(1폭 관 진입부)에 wall_doorway(문짝 제거된 열린 아치). 통행 폭 ≈1.6m.
    //   아래층=아치(통행), 위층=solid wall(아치 위 구멍 폐합 → 천장까지 이어짐).
    for(const e of lay.doorEdges){ const p = edgePos(e), ey = e.y || 0;
      place('wall_doorway', solidGrp, p.x, p.z, p.rot, ey);
      for(let r = 1; r < roomRows(e.rid); r++) place('wall', solidGrp, p.x, p.z, p.rot, ey + r * WALL_H); }
    // ★천장 — walkable 셀마다 바닥 타일을 벽 상단(ROWS·WALL_H)에 뒤집어 덮어 하늘·햇빛을 차단(사령관 "위도 닫혀야").
    //   ⚠️collide/trimesh 미등록 — 몹 스폰·groundAt(위→아래 레이 fromY 600)이 천장을 바닥으로 오인하면 안 됨.
    //   플레이어는 8m 천장에 닿지 못하므로 물리 불요 = 순수 시각(차폐)용. decoGrp(장식) 소속.
    //   ★다층화: 천장도 칸 높이를 따라간다(hgt + ROWS·WALL_H). 인접 칸과 높이차가 나도 밀폐 박스(두께 SEAL)가 겹쳐 틈이 없다.
    const ceilY = ROWS * WALL_H;
    for(let z = 0; z < G; z++) for(let x = 0; x < G; x++){
      if(!lay.type[lay.idx(x, z)]) continue;
      if(wellInfo && wellInfo.cells.has(x + ',' + z)) continue;   // ★계단실은 칸별 천장 금지 — 덮으면 가운데가 안 뚫림
      const cy = lay.hgt[lay.idx(x, z)] + roomRows(lay.roomId[lay.idx(x, z)]) * WALL_H;
      const c = place('floor_tile_large', ceilGrp, CC(x), CC(z), 0, cy);
      c.rotation.x = Math.PI;   // 뒤집어 타일 윗면이 아래(실내)를 향함
      c.userData._ceil = 1;     // 🔧 검수 훅 — 방별 렌더(_room_shot.mjs)가 천장을 꺼야 방 안을 내려다볼 수 있다
      const seal = new THREE.Mesh(new THREE.BoxGeometry(CELL, SEAL*2, CELL), sealMat);
      // ★2026-07-22 — 밀폐판을 천장 **위**에만 두면 벽 상단(=천장 높이)과 정확히 맞닿아 머리카락 틈이 생긴다
      //   (대전당을 16m로 올린 뒤 기밀검사에서 1발 샘). 천장선을 **가운데 두고 걸치게** 해서 위아래로 겹친다.
      seal.position.set(CC(x), cy, CC(z)); seal.userData._ceil = 1; ceilGrp.add(seal);   // 천장 밀폐(겹침)
    }
    // ★🌀 계단실 천장 — 링 전체(size×size)를 최상단 한 장으로 덮는다. 칸별 천장을 안 쓰므로 계단을 돌며
    //   가운데 20m 아래 최하부 홀이 그대로 내려다보인다(사령관 확정 형태). 위는 이 한 장이 완전히 차단.
    if(wellInfo) for(let i = 0; i < wellInfo.size; i++) for(let j = 0; j < wellInfo.size; j++){
      const wx = wellInfo.x + i, wz = wellInfo.z + j;
      const c = place('floor_tile_large', ceilGrp, CC(wx), CC(wz), 0, wellCeilY);
      c.rotation.x = Math.PI; c.userData._ceil = 1;
      const seal = new THREE.Mesh(new THREE.BoxGeometry(CELL, SEAL, CELL), sealMat);
      seal.position.set(CC(wx), wellCeilY + SEAL/2, CC(wz)); seal.userData._ceil = 1; ceilGrp.add(seal);
    }
    // ④ 코너 기둥 — 수평·수직 벽이 만나는 격자점에 pillar(4m 벽과 동고) → 벽 맞물림 이음새 은폐.
    //    (wall_corner/wall_endcap 조각은 하프월 조합 전제라 4m 풀월 타일링과 안 맞음 — pillar가 정합적 대체)
    const cornerMap = new Map();   // "cx,cz" → {h,v}
    for(const e of lay.wallEdges){
      const horiz = (e.dir === 0 || e.dir === 2);
      const cz0 = e.z + (e.dir === 2 ? 1 : 0), cx0 = e.x + (e.dir === 1 ? 1 : 0);
      const pts = horiz ? [[e.x, cz0], [e.x + 1, cz0]] : [[cx0, e.z], [cx0, e.z + 1]];
      for(const [px, pz] of pts){
        const k = px + ',' + pz;
        const rec = cornerMap.get(k) || { h: false, v: false, y: Infinity, top: -Infinity };
        if(horiz) rec.h = true; else rec.v = true;
        // ★11차 — 기둥도 벽처럼 칸 높이를 따라간다(전엔 전부 y=0 고정이라 지하 -20 방의 코너 기둥이 지상에 떠 있었음).
        //   한 코너에 높이가 다른 벽이 만나면 가장 낮은 밑단 ~ 가장 높은 상단을 전부 덮는다.
        const ey = e.y || 0, rows = e.wellWall ? Math.max(ROWS, Math.ceil((wellCeilY - ey) / WALL_H)) : ROWS + Math.ceil((e.up || 0) / WALL_H);
        rec.y = Math.min(rec.y, ey); rec.top = Math.max(rec.top, ey + rows * WALL_H);
        cornerMap.set(k, rec);
      }
    }
    // ★문 바로 옆 코너엔 기둥 금지 — 문 폭이 좁아(1칸) 코너 기둥이 통행을 막을 수 있음(사령관 "입구 충돌체" 지적, 2026-07-16 3차).
    //   문에 인접한 방 칸의 네 격자점을 전부 제외 대상으로 등록.
    const _EDIRS = [[0,-1],[1,0],[0,1],[-1,0]];   // 0=N/1=E/2=S/3=W(genLayout DIRS와 동일 규약, 스코프 달라 로컬 재정의)
    const doorCorners = new Set();
    for(const e of lay.doorEdges){ const rx = e.x + _EDIRS[e.dir][0], rz = e.z + _EDIRS[e.dir][1];
      doorCorners.add(rx+','+rz); doorCorners.add((rx+1)+','+rz); doorCorners.add(rx+','+(rz+1)); doorCorners.add((rx+1)+','+(rz+1)); }
    let nPillar = 0;
    for(const [k, rec] of cornerMap){
      if(!(rec.h && rec.v) || nPillar >= 120 || doorCorners.has(k)) continue;   // 코너(교차)만 + 상한(드로우콜, ★11차 맵확대로 40→120 — 40에서 걸려 미설치 코너에 대각 슬릿이 남았음[기밀검사 확인]) + 문 인접 제외
      const [px, pz] = k.split(',').map(Number);
      const by = isFinite(rec.y) ? rec.y : 0, ty = isFinite(rec.top) ? rec.top : ROWS * WALL_H;
      const pil = place('pillar', solidGrp, L(px), L(pz), 0, by); pil.scale.y = Math.max(ROWS, (ty - by) / WALL_H); nPillar++;   // ★벽 높이(칸 높이 추종)에 맞춰 기둥도 늘림
    }
    // ★문 인접 코너는 기둥을 못 세우지만(통행 방해) 그 격자점에 벽 두 장이 만나는 수직 이음새가 남는다 →
    //   기둥보다 훨씬 가는 밀폐 기둥(0.36m)만 세워 슬릿을 막는다. 문 중심에서 2m 떨어진 지점이라 통행 폭에 영향 없음.
    for(const [k, rec] of cornerMap){
      if(!(rec.h && rec.v) || !doorCorners.has(k)) continue;
      const [px, pz] = k.split(',').map(Number);
      const by = isFinite(rec.y) ? rec.y : 0, ty = isFinite(rec.top) ? rec.top : ROWS * WALL_H;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.36, ty - by, 0.36), sealMat);
      s.position.set(L(px), by + (ty - by) / 2, L(pz)); solidGrp.add(s);
    }
    // ⑤ 방 인테리어 = 손 설계 프리팹(ROOM_PREFABS). 바닥은 ① 재사용(noFloor), 여기선 내부(엄폐·소품·몹·상자·포탈·횃불)만 얹음.
    //   소품엔 충돌체(뚫기 방지) — additive(불꽃/글로우) 제외. 마커(몹/상자/포탈)는 월드 좌표로 수집.
    torches = []; hallTorches = []; torchSpots = []; torchPool = [];
    const pfMobSpots = [], pfChests = [], pfGroups = []; let pfPortal = null, hallResult = null, hallFloorCol = null;
    let cascadeResult = null, cascadeFloorCol = null;   // 🏔️ 폭포 대홀(지하 2층)
    for(const r of lay.rooms){
      const role = r.role || 'combat';
      // 🏛️ 큰 홀 — ROOM_PREFABS ASCII 그리드 대신 buildGrandHall(코드로 직접 램프/랜딩) 사용. 방 인테리어 파이프라인(pfGroups=충돌체·torches)엔 그대로 합류.
      if(role === 'hall'){
        const wx = (r.x + r.w/2 - G/2) * CELL, wz = (r.z + r.h/2 - G/2) * CELL;
        // ── 봉인방 = 엘리베이터 수직 상승 도착점. 🏛️10차-B: 홀중심 + 뱀형 막장 오프셋(13,12셀) = 지하 막장(52,48) 바로 위. ──
        //   (레버 당기면 봉인방의 보스쪽 벽이 부서지며 열림 — buildGrandHall 막장이 exitLocal=(52,48) 바로 아래, 엘리베이터가 수직 상승)
        //   보스방(4)이 봉인방 북쪽(작은 z)에 인접 → 봉인벽 face='N'(부서지면 보스방 쪽으로 개방). 좌표 검증=verify_surface.mjs.
        const alcCx = (r.x + (r.w>>1)) + 13, alcCz = (r.z + (r.h>>1)) + 12;   // 봉인방 중심 셀좌표 = 홀중심 +(13,12)
        const alc = { face: 'N' };
        const alcWX = CC(alcCx), alcWZ = CC(alcCz);   // 봉인방 중심(월드-로컬)
        const exitLocal = { x: alcWX - wx, z: alcWZ - wz };   // = (52,48) (뱀형 막장 고정 오프셋과 일치 → 무회전 수직도달)
        const o = buildGrandHall(r, CELL, kit, { exitLocal });
        o.grp.position.set(wx, 0, wz); decoGrp.add(o.grp); pfGroups.push(o.grp);
        // ★10차-B 지하 바닥 콜라이더 — trimesh(보행 물리) + collide(레이캐스트 groundAt: 몹 이동 높이). 벽과 분리라 groundAt 오인 없음.
        if(o.floorCol){ o.floorCol.position.set(wx, 0, wz); decoGrp.add(o.floorCol); pfGroups.push(o.floorCol); hallFloorCol = o.floorCol; }
        // ★하강 입구 개통 — 1층 홀 벽 파이프라인(위 wallEdges)이 하강 램프가 빠져나가는 변까지 막아 "내려가는 길 없음"이 됨.
        //   buildGrandHall이 준 descentMouth(홀-로컬) 위치의 1층 벽 메시를 제거해 램프 입구를 뚫는다(반경=램프폭 CW 여유). (2026-07-20 확진·수정)
        if(o.descentMouth){ const mx = wx + o.descentMouth.x, mz = wz + o.descentMouth.z;
          for(let i = solidGrp.children.length - 1; i >= 0; i--){ const wmesh = solidGrp.children[i];
            // ★아래 단(y<WALL_H)만 제거 = 램프가 지나갈 통로. 위 단은 남겨 "입구 위가 뻥 뚫리는" 것 방지(2026-07-21 인클로저 수정).
            if(wmesh.position.y < WALL_H - 0.1 && Math.hypot(wmesh.position.x - mx, wmesh.position.z - mz) < 4) solidGrp.remove(wmesh); } }
        if(o.visGrp){ o.visGrp.position.set(wx, 0, wz); decoGrp.add(o.visGrp); }   // ★진짜 KayKit 시각(벽·바닥·소품 — pfGroups 미등록=충돌 안 건드림)
        for(const s of o.mobSpots) pfMobSpots.push({ x: c.x + wx + s.x, z: c.z + wz + s.z, r: 1.6, y: s.y });   // ★y=로컬 깊이(스폰 높이 보정용)
        for(const lp of o.torches){ lp.userData._wx = c.x + wx + lp.position.x; lp.userData._wz = c.z + wz + lp.position.z; hallTorches.push(lp); }   // ★순차 점등 — 별도 배열(MAX_TORCH 무관, 루프가 깊이·거리 게이팅으로 켬)
        if(o.chestLocal) pfChests.push({ x: c.x + wx + o.chestLocal.x, z: c.z + wz + o.chestLocal.z, kind:'reward', gold: 100 + ((Math.random()*80)|0), soul: 6, y: o.chestLocal.y });
        hallResult = { wx, wz, leverLocal: o.leverLocal, elevatorLocal: o.elevatorLocal, surfaceLocal: o.surfaceLocal, entryLocal: o.entryLocal, bottomY: o.bottomY, lavaCrackU: o.lavaCrackU || null,
          alcove: { cx: alcCx, cz: alcCz, wx: alcWX, wz: alcWZ, face: alc.face } };
        ctx.__dgZig = { wx, wz, cx: c.x, cy: c.y, cz: c.z, rooms: o.rooms || [], mouth: o.descentMouth };   // 🔧 디버그 훅(지하 뱀형 헤드리스 렌더 검증) — __dgHall은 아래 1630행이 별용도로 씀
        continue;
      }
      // 🏔️ 폭포 대홀(지하 2층) — ASCII 격자 대신 buildCascadeHall(코드로 직접 짓는 커스텀 기하).
      //   방 셀 높이(ry) = 진입 턱. 대홀 로컬 y=0 은 물웅덩이 바닥이므로 grp를 (ry - drop) 만큼 내려 앉힌다.
      if(role === 'cascade'){
        const wx = (r.x + r.w/2 - G/2) * CELL, wz = (r.z + r.h/2 - G/2) * CELL;
        const ry = lay.hgt[lay.idx(r.cx, r.cz)] || 0;
        const CS = Object.assign({}, (BAL.dungeon.setpiece && BAL.dungeon.setpiece.cascade) || {},
          { w: r.w * CELL, d: r.h * CELL });   // 발판은 방 칸수에서 실제로 계산(상수와 어긋나면 벽이 어긋난다)
        const o = buildCascadeHall(CS, kit, gate);
        const baseY = ry - CS.drop;            // 물웅덩이 바닥의 방-로컬 높이
        o.grp.position.set(wx, baseY, wz); decoGrp.add(o.grp); pfGroups.push(o.grp);
        if(o.floorCol){ o.floorCol.position.set(wx, baseY, wz); decoGrp.add(o.floorCol); pfGroups.push(o.floorCol); cascadeFloorCol = o.floorCol; }
        // ★게이트 개통 — 대홀 동벽과 보스방이 맞닿아 있고, 그 경계는 파이프라인이 벽으로 막아버린다.
        //   게이트 자리(물웅덩이 높이)의 벽 메시만 걷어내 통로를 뚫는다(buildGrandHall descentMouth와 같은 수법).
        const gx = wx + o.gateLocal.x, gz = wz + o.gateLocal.z, gy = baseY + o.gateLocal.y;
        for(let i = solidGrp.children.length - 1; i >= 0; i--){ const wm = solidGrp.children[i];
          if(Math.abs(wm.position.y - gy) < 10 && Math.hypot(wm.position.x - gx, wm.position.z - gz) < 9) solidGrp.remove(wm); }
        for(const s of o.mobSpots) pfMobSpots.push({ x: c.x + wx + s.x, z: c.z + wz + s.z, r: 1.6, y: baseY + s.y, rid: r.id });
        for(const lp of o.torches){ torchSpots.push({ x: wx + lp.position.x, y: baseY + lp.position.y, z: wz + lp.position.z, base: lp.intensity || 16 });
          if(lp.parent) lp.parent.remove(lp); }   // ⚡실제 광원 제거 — 풀이 대신한다(좌표만 남김)
        cascadeResult = { wx, wz, baseY, entry: o.entryLocal, gate: o.gateLocal, fallSpot: o.fallSpot,
          poolY: o.poolY, topY: o.topY, fallY: o.fallY, W: o.W, D: o.D, fx: o.fx };
        ctx.__dgCascade = { wx: c.x + wx, wz: c.z + wz, baseY: c.y + baseY, ry,
          entry: o.entryLocal, gate: o.gateLocal, fallSpot: o.fallSpot, drop: CS.drop, W: o.W, D: o.D, pathPts: o.pathPts };   // 🔧 검수 훅
        continue;
      }
      const set = ROOM_PREFABS[role] || ROOM_PREFABS.combat;
      const pf = set[r.pfIdx || 0] || set[0];
      // ★이 방의 실제 벽 존재 칸(lay.wallEdges, 절대좌표) 조회셋 — "문이 아니면 벽"이라는 역추정 대신 벽 유무를 직접 확인.
      //   문도 벽도 아닌 개방경계(코너·폭 안 맞는 접점 등)까지 전부 걸러내 벽부착 장식(횃불/배너) 오배치 근절.
      const wallSet = new Set();
      for(const e of lay.wallEdges) if(e.rid === r.id) wallSet.add(e.x+','+e.z+','+e.dir);
      const wallAt = (i, j, dir) => wallSet.has((r.x+i)+','+(r.z+j)+','+dir);
      const o = buildPrefabRoom(kit, pf, CELL, { noFloor: true, wallAt, theme: ROOM_THEMES[ROLE_THEME[role]] || null, pillarRows: r.rows || 2 });
      const wx = (r.x + r.w/2 - G/2) * CELL, wz = (r.z + r.h/2 - G/2) * CELL;   // 방 footprint 중심(로컬)
      // ★다층화(2026-07-21): 방 인테리어를 그 방의 칸 높이만큼 내린다. 안 하면 지하방 소품/몹/상자가 전부
      //   지상(y=0)에 떠서 렌더되고, 그 위에서 위를 보면 천장이 없어 뻥 뚫린다(기밀검사로 확진).
      const ry = lay.hgt[lay.idx(r.cx, r.cz)] || 0;
      o.grp.position.set(wx, ry, wz); decoGrp.add(o.grp); pfGroups.push(o.grp);
      for(const s of o.mobSpots) pfMobSpots.push({ x: c.x + wx + s.x, z: c.z + wz + s.z, r: 1.4, y: ry, rid: r.id });   // ★rid = 방별 라운드로빈 분배용
      if(o.chest) pfChests.push({ x: c.x + wx + o.chest.x, z: c.z + wz + o.chest.z, kind:'reward', gold: 80 + ((Math.random()*60)|0), soul: 5, y: ry });
      if(o.portal) pfPortal = { x: c.x + wx + o.portal.x, z: c.z + wz + o.portal.z, lx: wx + o.portal.x, lz: wz + o.portal.z, y: ry };
      for(const lp of o.torches){ torchSpots.push({ x: wx + lp.position.x, y: ry + lp.position.y, z: wz + lp.position.z, base: lp.intensity || 16 });
        if(lp.parent) lp.parent.remove(lp); }   // ⚡실제 광원 제거 — 풀이 대신한다(좌표만 남김)
      // 🌋 용암 지대 — 'L' 셀 bounds(방 로컬) → buildLavaPit. 바닥은 아래 lavaHoles로 이미 생략(구멍).
      if(o.lavaCells && o.lavaCells.length){
        let ax=1e9, bx=-1e9, az=1e9, bz=-1e9;
        for(const lc of o.lavaCells){ ax=Math.min(ax,lc.x); bx=Math.max(bx,lc.x); az=Math.min(az,lc.z); bz=Math.max(bz,lc.z); }
        const H = CELL*0.5;   // 셀 중심 → 셀 경계까지
        const isBossArena = (r.role === 'bossarena');   // ★2026-07-23 보스 링 아레나 = 발판 없는 평평 용암(steps:0) + 즉사
        const LP = isBossArena
          ? { depth:7, steps:0, dropPerStep:0, padW:0, pathLen:0, pathW:0, lethal:dcfg.traps.lavaLethal, dmg:dcfg.traps.majorDamage, reward:{gold:0,soul:0} }
          : ((BAL.dungeon.setpiece && BAL.dungeon.setpiece.lava) || { depth:9, steps:5, dropPerStep:1.35, padW:2, pathLen:5.2, pathW:1.6, reward:{gold:140,soul:8} });
        const pit = buildLavaPit(wx+ax-H, wx+bx+H, wz+az-H, wz+bz+H, LP, kit);
        // ★2026-07-21 11차 버그수정 — 용암 지대가 방 깊이(ry)를 안 따라가 지상 y=0에 떠 있었다(기밀검사 87발의 정체).
        //   지하 용암방 바닥이 -20인데 발판·용암면이 0에 있어 방 위가 통째로 뚫려 있었음. 소품 인테리어(o.grp)와 동일한 계열 버그.
        pit.grp.position.y = ry;
        decoGrp.add(pit.grp);
        for(const s of pit.solids) if(ctx.terrain && ctx.terrain.addTrimeshMesh) ctx.terrain.addTrimeshMesh(s, root);   // 발판 = 밟히는 실제 콜라이더
        // 맨 아래 발판 보상 상자(욕심의 대가) — 점프맵만. 보스 아레나는 발판·상자 없음(링에서 보스전).
        if(!isBossArena){ const csY = (pit.chestSpot.y || 0) + ry;
          const bc = kit['chest_gold'].clone(true); bc.position.set(pit.chestSpot.x, csY+0.22, pit.chestSpot.z); decoGrp.add(bc);
          pfChests.push({ x: c.x + pit.chestSpot.x, z: c.z + pit.chestSpot.z, kind:'reward', gold: LP.reward.gold, soul: LP.reward.soul, y: csY }); }
        lavaPits.push({ U: pit.U, lavaY: pit.lavaY + ry, lethal: LP.lethal !== false, dmg: LP.dmg || 40,
          x0: c.x + pit.minX, x1: c.x + pit.maxX, z0: c.z + pit.minZ, z1: c.z + pit.maxZ });
        // 🧱 **바닥 섬 옆구리(스커트)** — 2026-07-24 신설. 용암이 방 **가장자리**가 아니라 **전체**를 덮는 배치
        //   (보스 아레나 = 용암 바다 위 코즈웨이+원반)에서는 걷는 바닥이 용암면보다 7m 위에 **떠 있는 판**이 된다.
        //   버팀이 없으면 ⓐ옆에서 보면 타일 한 장이 공중에 뜬 것으로 보이고 ⓑ판 아래로 수평 광선이 그대로 지나가
        //   기밀검사가 샌다. ⇒ 용암과 맞닿는 바닥 칸마다 용암면 아래까지 내려가는 석재 옆구리를 세운다.
        //   (안쪽 칸은 영원히 안 보이므로 생략 = 드로우콜 절약. 위는 바닥 타일이 이미 막는다.)
        {
          const isLava = (i, j) => { if(i<0||j<0||i>=pf.w||j>=pf.h) return false; return (pf.grid[j]||'')[i] === 'L'; };
          const skirtH = LP.depth + 1.5;   // 방 바닥 → 용암면 아래까지(용암에 확실히 잠기게)
          for(let j=0;j<pf.h;j++) for(let i=0;i<pf.w;i++){
            if(isLava(i,j)) continue;
            if(!(isLava(i-1,j) || isLava(i+1,j) || isLava(i,j-1) || isLava(i,j+1))) continue;
            const sx = wx + (i - (pf.w-1)/2) * CELL, sz = wz + (j - (pf.h-1)/2) * CELL;
            const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, skirtH, CELL), sealMat);
            m.position.set(sx, ry - skirtH/2, sz); solidGrp.add(m);
          }
        }
      }
    }
    // ★2026-07-16 어두운 무드 — 상공 미광을 대폭 낮춰 횃불이 주광원이 되게(완전 암전만 방지). 천장 아래로 내림.
    const dim = new THREE.PointLight(0x4a3e5a, 0.4, G * CELL * 1.1, 2.2);   // ★더 어둡게 — 완전 암전만 방지
    dim.position.set(0, ceilY - 1.5, 0); root.add(dim);
    // ⑦ 상자/포탈 — 프리팹 마커 기준(보상 상자='x'→dgChests · 포탈=보스방 'P'). 상자더미·소품은 프리팹 소관.
    const tr = lay.treasure, tlx = CC(tr.cx), tlz = CC(tr.cz);
    for(const ch of pfChests) dgChests.push(ch);
    const portalLX = pfPortal ? pfPortal.lx : tlx, portalLZ = pfPortal ? pfPortal.lz : tlz;
    portal = buildPortal(portalLX, portalLZ);
    portal.position.y = pfPortal ? (pfPortal.y || 0) : (lay.hgt[lay.idx(tr.cx, tr.cz)] || 0);   // ★11차 — 보스방이 지하로 내려가면서 필수(안 하면 출구 포탈만 지상 y=0에 뜸)
    root.add(portal);
    // ★[3] 잠긴 보스문 — 보스방 문틀을 solid wall로 막음(bossDoorOwner=레버 시 개별 제거) + 대형 게이트 장식(buildGateDecor)
    const bossDoorOwner = new THREE.Group(); root.add(bossDoorOwner);
    const bossDoorMeshes = [];
    if(lay.bossRoom) for(const e of lay.doorEdges.filter(ed => ed.rid === lay.bossRoom.id)){ const p = edgePos(e);
      for(let rr = 0; rr < ROWS; rr++){ const w = place('wall', bossDoorOwner, p.x, p.z, p.rot, rr * WALL_H); bossDoorMeshes.push(w); }
      // ★사령관 "진짜 큰 게이트문 같은게 있어야" — 교차 판자(2026-07-17 1차 수정) 폐기 → 대형 석조 기둥+철제 이중문+브라지어.
      //   물리 차단은 그대로 위 flat wall(bossDoorOwner)이 담당 — 레버로 열리면 그 wall+문짝(leaves)이 함께 사라지고
      //   기둥/상인방/브라지어는 영구 장식으로 남아 "진짜 열린 성문" 통로가 된다.
      const gate = buildGateDecor(WALL_H, 0xb02418);
      gate.grp.position.set(p.x, 0, p.z); gate.grp.rotation.y = p.rot; decoGrp.add(gate.grp);
      for(const leaf of gate.leaves) bossDoorMeshes.push(leaf);
    }
    // ★[3+숏컷] 레버 + 레버방↔입구 지름길 게이트 — 레버방 좌표를 먼저 구해 buildLever와 함께 배치.
    //   🏛️ 큰 홀(hallResult) 있으면 레버는 방 중앙이 아니라 지하1층 도착 랜딩(leverLocal)에 배치 — 숏컷 게이트는
    //   짓지 않는다(그 자리는 이제 엘리베이터가 대신함, 아래 [4] 참조).
    let leverInfo = null;
    // ★2층 그리드면 지상 레버·숏컷 생략 — 레버는 지하 막장에 배치(아래 Stage3 지하 블록에서 leverInfo 설정, 보스문 개방).
    // ★2026-07-23 레버 폐지(사령관 "레버는 빼") — 단 **대전당+게이트 레이아웃(HANDCRAFT.small)** 에만 적용. 게이트 [E]로 직접 연다.
    //   구형 FLOWS(medium/large)는 게이트/bossEnter가 없어 레버가 유일한 보스문 개방 → 그대로 유지(불변).
    const _gateDirect = lay.rooms.some(r => r.role === 'grandhall');
    const lr = (_gateDirect || lay.lowerSpec) ? null : (lay.hallRoom || lay.leverRoom || lay.trapRoom || lay.rooms.find(r => r !== lay.entrance && r !== lay.bossRoom));   // ★10차-B: hall방 우선 → 레버가 지하 막장(leverLocal)에 배치
    if(lr && lr.role === 'hall' && hallResult){
      const lx = hallResult.wx + hallResult.leverLocal.x, lz = hallResult.wz + hallResult.leverLocal.z, ly = hallResult.leverLocal.y;
      const lev = buildLever(); lev.position.set(lx, ly, lz); decoGrp.add(lev);
      leverInfo = { x: c.x + lx, z: c.z + lz, mesh: lev, pulled: false };
    } else if(lr){ const lx = CC(lr.cx), lz = CC(lr.cz); const lev = buildLever(); lev.position.set(lx, 0, lz); decoGrp.add(lev);
      leverInfo = { x: c.x + lx, z: c.z + lz, mesh: lev, pulled: false }; }   // ★레버 유혹 발광 제거(사령관 "흰 동그라미 없애줘" — 상자만 유혹 필요, 레버는 불필요)
    // ★2026-07-17(사령관 "레버 내리면 숏컷 가는 길이 입구로") — 레버방의 '북쪽'(입구 방향) 문 에지 = 지름길 게이트.
    //   FLOWS 좌표 설계상 레버방은 항상 입구 바로 아래(같은 cx)에 배치돼 dir===2(코드→방 남향 진입, 즉 코드가 방 북쪽에 있음)로
    //   본선 연결 문(항상 동쪽=dir3)과 겹치지 않고 유일하게 식별된다. ★큰 홀 방식(hallResult)엔 적용 안 함(엘리베이터가 대체).
    const shortcutDoorOwner = new THREE.Group(); root.add(shortcutDoorOwner);
    const shortcutMeshes = [];
    if(lr && lr.role !== 'hall' && !lay.lowerSpec) for(const e of lay.doorEdges.filter(ed => ed.rid === lr.id && ed.dir === 2)){ const p = edgePos(e);   // ★2층 그리드에선 숏컷 게이트 생략(연결 깨짐 방지)
      for(let rr = 0; rr < ROWS; rr++){ const w = place('wall', shortcutDoorOwner, p.x, p.z, p.rot, rr * WALL_H); shortcutMeshes.push(w); }
      const gate = buildGateDecor(WALL_H, 0x4aa8ff);   // ★차가운 청색 브라지어로 보스문(붉은색)과 시각 구분
      gate.grp.position.set(p.x, 0, p.z); gate.grp.rotation.y = p.rot; decoGrp.add(gate.grp);
      for(const leaf of gate.leaves) shortcutMeshes.push(leaf);
    }
    // ★[4] 엘리베이터(지하 막장 → 시작지점 옆 봉인방, 수직 상승) — 2026-07-20 9차 재설계(사령관 "레버 당기면 엘리베이터가
    //   수직상승해서 시작지점 옆에 방이 하나 열리는 느낌"). 막장(F)이 봉인방 바로 아래 라우팅돼 있어 진짜 수직으로 오른다.
    //   레버 당기면 → 엘리베이터 점등 + 봉인방의 입구쪽 벽(alcoveDoorOwner)이 부서짐(파편) → 타면 시작지점 옆으로 나옴.
    const alcoveDoorOwner = new THREE.Group(); root.add(alcoveDoorOwner);
    const alcoveMeshes = [];
    let elevatorInfo = null;
    if(lr && lr.role === 'hall' && hallResult && hallResult.alcove){
      const A = hallResult.alcove, aWX = A.wx, aWZ = A.wz, aHalf = CELL;
      // 봉인방 바닥(1층 y0, walkable) — 엘리베이터 도착 발판. floorGrp 등록(보행 콜라이더+레이).
      for(const ox of [-1,1]) for(const oz of [-1,1]) place('floor_tile_large', floorGrp, aWX+ox*CELL/2, aWZ+oz*CELL/2, ((Math.random()*4)|0)*Math.PI/2);
      // 봉인방 천장(하늘/쉘 차폐) — 벽 상단에 바닥타일 뒤집어 덮음.
      for(const ox of [-1,1]) for(const oz of [-1,1]){ const ct = place('floor_tile_large', solidGrp, aWX+ox*CELL/2, aWZ+oz*CELL/2, 0, ROWS*WALL_H); ct.rotation.x = Math.PI; }
      // 4벽 — face(입구쪽) = 부서지는 봉인벽(alcoveDoorOwner), 나머지 3면 = 영구벽(solidGrp)
      const sides = [
        { face:'N', x:aWX,        z:aWZ-aHalf, rot:0,           along:'x' },
        { face:'S', x:aWX,        z:aWZ+aHalf, rot:Math.PI,     along:'x' },
        { face:'E', x:aWX+aHalf,  z:aWZ,       rot:-Math.PI/2,  along:'z' },
        { face:'W', x:aWX-aHalf,  z:aWZ,       rot:Math.PI/2,   along:'z' },
      ];
      for(const s of sides){ const owner = (s.face === A.face) ? alcoveDoorOwner : solidGrp;
        for(const off of [-CELL/2, CELL/2]){ const wx2 = s.along==='x' ? s.x+off : s.x, wz2 = s.along==='z' ? s.z+off : s.z;
          for(let rr=0; rr<ROWS; rr++){ const w = place('wall', owner, wx2, wz2, s.rot, rr*WALL_H); if(owner===alcoveDoorOwner) alcoveMeshes.push(w); } } }
      // 봉인벽 대형 게이트 장식(부서지는 문) — 붉은 브라지어(시각 강조). 부서지면 문짝도 함께 사라짐.
      { const gs = sides.find(s => s.face === A.face);
        const gate = buildGateDecor(WALL_H, 0xb02418); gate.grp.position.set(gs.x, 0, gs.z); gate.grp.rotation.y = gs.rot; decoGrp.add(gate.grp);
        for(const leaf of gate.leaves) alcoveMeshes.push(leaf); }
      // 엘리베이터 발판(막장 바닥) + 수직 상승 도착점(봉인방 바닥, 같은 x/z)
      const ex = hallResult.wx + hallResult.elevatorLocal.x, ez = hallResult.wz + hallResult.elevatorLocal.z, ey = hallResult.elevatorLocal.y;
      const sx = hallResult.wx + hallResult.surfaceLocal.x, sz = hallResult.wz + hallResult.surfaceLocal.z, sy = hallResult.surfaceLocal.y;
      const elev = buildElevator(); elev.position.set(ex, ey, ez); decoGrp.add(elev);
      const alcLamp = new THREE.PointLight(0x9fd8ff, 5, 14, 2); alcLamp.position.set(aWX, sy+2.6, aWZ); root.add(alcLamp);
      elevatorInfo = { x: c.x + ex, z: c.z + ez, mesh: elev, active: false,
        rideFrom: { x: c.x+ex, y: c.y+ey, z: c.z+ez }, rideTo: { x: c.x+sx, y: c.y+sy, z: c.z+sz } };
    }
    const bossBounds = lay.bossRoom ? { x0: c.x + L(lay.bossRoom.x)-1, x1: c.x + L(lay.bossRoom.x + lay.bossRoom.w)+1, z0: c.z + L(lay.bossRoom.z)-1, z1: c.z + L(lay.bossRoom.z + lay.bossRoom.h)+1 } : null;

    // ★던전 외곽 쉘(사령관 "카메라 바깥 바다 안 보이게") — 벽/문/천장 틈으로 밝은 하늘·바다가 새어 보이지 않게
    //   어두운 구(BackSide, 불투명, fog무관)로 던전을 통째 감싼다. collide/trimesh 미등록 = 순수 시각 차폐.
    // ★버그 수정(2026-07-17, 사령관 "눈앞에 이상한 투명 검정막") — 반지름 72는 구(旧) 소형 그리드(G=30~50) 기준 고정값.
    //   2차 재설계로 G가 42~58까지 커지면서 방이 원점에서 최대 ~130유닛까지 벌어져 쉘 밖으로 튀어나감 → 그 방에서는
    //   쉘 오목면 안쪽이 바로 눈앞에 시커멓게 보임. 그리드 크기(G·CELL)에 비례하도록 동적 계산 + 최소 72 유지.
    const shellR = Math.max(72, G * CELL * 0.85);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(shellR, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x04050a, side: THREE.BackSide, fog: false, depthWrite: true }));
    shell.position.set(0, ROWS * WALL_H * 0.5, 0); shell.renderOrder = -2; shell.userData._dgShell = true; root.add(shell);   // 🔧 _dgShell = 기밀검사(_airtight.mjs)용 태그: 광선이 이걸 먼저 맞으면 "샜다"
    ctx.__dgRoot = root;   // 🔧 기밀검사/전경렌더용 루트 참조
    // 🔧 기밀검사용 그리드 메타 — 월드좌표 → 칸(x,z) 역산해서 "어느 칸이 뚫렸는지" 특정
    ctx.__dgGrid = { G, CELL, cx: c.x, cy: c.y, cz: c.z,
      type: Array.from(lay.type), hgt: Array.from(lay.hgt),
      // 🔧 방 목록 — 방별 렌더 검수(`scripts/_room_shot.mjs`)가 카메라를 앉히는 데 쓴다.
      //   (사령관 "너가 방 하나씩 스크린샷 찍으면서 다 꾸며" — 방마다 눈으로 보고 고치기 위한 훅)
      rooms: (lay.rooms || []).map(r => ({ id:r.id, role:r.role, x:r.x, z:r.z, w:r.w, h:r.h, cx:r.cx, cz:r.cz,
        y: lay.hgt[lay.idx(r.cx, r.cz)] || 0, theme: ROLE_THEME[r.role] || null })) };
    // 🔧 계단실 디버그 훅 — 계단칸 순서·높이·참 여부(육안 렌더 `scripts/_stairwell_shot.mjs`가 사용)
    ctx.__dgWell = wellInfo ? { x: wellInfo.x, z: wellInfo.z, size: wellInfo.size, topY: wellInfo.topY, botY: wellInfo.botY,
      rise: wellInfo.rise, stairCells: wellInfo.stairCells.map(s => ({ x:s.x, z:s.z, y:s.y, corner:s.corner })) } : null;

    // 🚪 보스 게이트 — 대전당 남쪽 문 자리에 bossgate.glb + 포탈 막을 세운다.
    //   ⚠️문이 바라보는 축은 **실측**했다: 문짝 4장 합친 크기가 X1104 · Y839 · Z451 → 가장 얇은 축이 Z
    //     = 문 면이 ±Z를 향한다. (폭포 대홀 때는 이걸 안 재고 -90° 돌려서 틀렸다.)
    //   대전당(z26~39) → 복도(z40~41) → 보스방(z42~) 이므로 문은 회전 없이 그대로 ±Z를 보면 맞는다.
    if(gate && gate.scene){
      const gr = lay.rooms.find(r => r.role === 'grandhall');
      if(gr){
        const ry = lay.hgt[lay.idx(gr.cx, gr.cz)] || 0;
        // ★★게이트 자리 = 대전당 남쪽 변의 **열린 개구부 중앙**.
        //   ⚠️2026-07-24 앵커 재작성 — 전엔 `doorEdge`(문 에지)에서 가져왔는데, 게이트 앞을 3칸 포켓으로 넓히면
        //     doorEdge 생성 조건("복도가 1폭 관")이 깨져 **에지가 아예 안 생긴다** → 게이트가 방 중앙 민벽에 서 버린다.
        //     ⇒ 남쪽 변 칸들 중 **바깥이 walkable인 칸**(=진짜 뚫린 자리)을 직접 스캔해 그 중앙을 잡는다.
        //       문이 1칸이든 3칸이든 동일하게 맞고, doorEdge 유무와 무관하다.
        const zOut = gr.z + gr.h;
        const openXs = [];
        for(let x = gr.x; x < gr.x + gr.w; x++)
          if(zOut >= 0 && zOut < lay.G && lay.type[lay.idx(x, zOut)] > 0) openXs.push(x);
        let gx = CC(gr.x + (gr.w >> 1));
        const gz = L(zOut);
        let openHalf = CELL * 0.5 + 0.15;               // 벽을 뚫어도 되는 최대 반폭 = 실제 개구부. 이보다 넓게 뚫으면 **바깥이 허공**이다.
        if(openXs.length){
          const xa = openXs[0], xb = openXs[openXs.length - 1];
          gx = (CC(xa) + CC(xb)) / 2;
          openHalf = (CC(xb) - CC(xa)) / 2 + CELL * 0.5 + 0.15;
        }
        const gg = gate.scene.clone(true);
        // ★★스케일·위치는 **클론을 직접 재서** 잡는다. 미리 잰 값(gate.aperture)을 쓰고 `scale.setScalar`로 덮으면
        //   모델 루트에 원래 걸려 있던 스케일이 지워져 크기가 폭주한다(실제로 0.3m짜리 문이 들어갔다).
        //   ⇒ 클론의 현재 개구부를 월드 기준으로 재고, 필요한 배율만큼 **곱한다**(multiplyScalar). 루트 스케일이 뭐든 항상 맞는다.
        //   ★★2026-07-24 개구부 실측 정정 — `Door_down` 문짝을 **뺀다.**
        //     GLB 원본 좌표를 직접 뜯어 재보니(scripts 없이 glTF 접근자 파싱) 문짝 4장의 바인드 자세가 이렇다:
        //       left  y −6.4~−2.0 · right y −6.4~−2.0 · up y −6.4~−2.0   ← 실제 통로 띠
        //       down  y −10.4~−6.1                                        ← **이미 아래로 물러난(열린) 자세**
        //     4장을 다 합치면 개구부가 y −10.4~−2.0(8.4)이 되어 **중심이 2.1만큼 아래로** 끌려 내려간다.
        //     그 결과 포탈·차단판·벽 뚫는 범위가 전부 **바닥보다 1.75m 아래**에서 시작했다 —
        //     이게 사령관이 본 "그냥 바닥 뚫림"의 정체다. down을 빼면 개구부 y −6.4~−2.0(4.4)로 정상화된다.
        //     교차검증: 이렇게 잡으면 개구부 밑변이 모델 자체 계단 상단(아래 STAIR_TOP_U)과 10cm 안에서 일치한다.
        const apOf = (o) => { const bb = new THREE.Box3(); let n = 0;
          o.updateMatrixWorld(true);
          o.traverse(x => { if(/^Door[_ ](up|left|right)[_ ]gameasset$/.test(x.name || '')){ bb.union(new THREE.Box3().setFromObject(x)); n++; } });
          if(!n || bb.isEmpty()){ bb.setFromObject(o); const s2 = bb.getSize(new THREE.Vector3()); bb.expandByVector(s2.multiplyScalar(-0.2)); }
          return { size: bb.getSize(new THREE.Vector3()), center: bb.getCenter(new THREE.Vector3()) }; };
        // 개구부 목표 높이(m). ⚠️구 7.0은 **잘못 잰 8.4짜리 개구부** 기준이라 실효 배율 0.833이었다.
        //   정정된 4.4 기준으로 같은 덩치를 유지하려면 4.0 (문틀 전체 ≈15.2m, 대전당 천장 16m 안쪽).
        const wantH = 4.0;
        let a0 = apOf(gg);
        gg.scale.multiplyScalar(wantH / Math.max(0.001, a0.size.y));   // 높이 기준(사람이 지나가는 문) — 폭은 따라온다
        const ap = apOf(gg);                                            // 스케일 반영 후 다시 실측
        // 개구부 바닥이 바닥면(ry)에, 개구부 중심이 문 자리(gx,gz)에 오도록 역보정
        gg.position.set(gg.position.x + (gx - ap.center.x),
                        gg.position.y + (ry - (ap.center.y - ap.size.y/2)),
                        gg.position.z + (gz - ap.center.z));
        // ★정면이 홀 쪽(-Z)을 보게 180° 돌린다. 문 면이 ±Z인 건 실측했지만 **앞뒤 중 어느 쪽인지는 bbox로 알 수 없다**
        //   (계단 조각 때와 같은 함정). 렌더로 확인한 결과 뒷면이 홀을 보고 있어 뒤집는다.
        gg.rotation.y = Math.PI;
        // ★★배치 마무리 — **전체 bbox 중심**을 문 자리에 맞춘다.
        //   개구부 중심만 맞췄더니 180° 회전 후 게이트가 **통째로 벽 뒤로** 밀려나 16m 벽돌 벽에 완전히 가려졌다
        //   (실측: bbox z 420.9~429.2 인데 벽이 z=420). 회전·모델 원점이 어디에 있든 항상 벽에 걸치게 하려면
        //   회전까지 반영된 최종 bbox로 다시 맞춰야 한다.
        gg.updateMatrixWorld(true);
        let frameH = 0, frameMinZ = 0, frameMinX = 0, frameMaxX = 0;   // ★아래 계단 콜라이더가 쓰는 문틀 실측값
        { const fb = new THREE.Box3().setFromObject(gg), fc = fb.getCenter(new THREE.Vector3());
          gg.position.x += (gx - fc.x);
          gg.position.z += (gz - fc.z);
          gg.updateMatrixWorld(true);
          // (z는 아래에서 **문틀 뒷면 = 벽면**으로 다시 맞춘다 — 2026-07-24. 중심 정렬이면 게이트가 벽을 절반 뚫고 나가
          //  그 자리 벽을 넓게 뜯어내야 했고, 뜯긴 옆칸 너머는 허공이라 **떨어지는 구멍**이 됐다.)
          // ★높이 — **보이는 메시의 최저점**을 바닥에 붙인다.
          //   ⚠️이전엔 개구부 밑변에 맞췄는데 게이트가 통째로 2m 떠 있었다(사령관 "아직도 공중에 떠 있음").
          //     그때 재본 값은 `updateWorldMatrix(true,false)`로 **자식 행렬을 갱신 안 해서** 틀렸다.
          //     Box3.setFromObject 는 내부에서 행렬을 제대로 갱신하므로 이걸 쓴다.
          //   ⚠️★기준은 **문틀 본체**여야 한다. "보이는 메시 중 최저"로 잡았더니 아래로 늘어진 문짝(Door_down)이
          //     기준이 되어 **문틀이 1.78m 공중에 떴다**(실측: 문틀 밑 253.36 vs 바닥 251.58 — 사령관 스샷의 그것).
          //     문짝은 여닫히는 부품이라 바닥 기준이 될 수 없다. 문짝 계열을 제외한 나머지(=문틀)만으로 잰다.
          gg.updateMatrixWorld(true);
          const isPanel = (o) => { let q = o; while(q && q !== gg){ if(/^Door[_ ](up|down|left|right)[_ ]gameasset$/.test(q.name || '')) return true; q = q.parent; } return false; };
          const frameBB = new THREE.Box3();
          gg.traverse(x => { if(x.isMesh && !isPanel(x)) frameBB.union(new THREE.Box3().setFromObject(x)); });
          if(!frameBB.isEmpty()) gg.position.y += (ry - frameBB.min.y);
          // ★★2026-07-24 z 재정렬 — 게이트를 **벽 앞(대전당 안쪽)에 통째로** 세운다.
          //   구 방식(전체 bbox 중심 = 벽면)은 게이트가 벽을 반쯤 뚫고 나가 있어서, 포탈이 보이게 하려고
          //   **개구부 폭(10m)만큼 벽을 뜯어야** 했다. 그런데 그 폭은 통로 1칸(4m)보다 넓어 **옆칸 벽까지 뜯겼고**,
          //   옆칸 너머는 방이 아니라 허공이라 그리로 걸어 들어가면 그대로 떨어졌다
          //   (사령관 "게이트 옆에 바닥으로 떨어지는 공간도 있음"). ⇒ 벽은 **한 장도 안 건드린다.**
          //   문틀 뒷면을 벽면(gz)에 붙이면 게이트 전체가 홀 안쪽(z<gz)에 서고, 포탈도 벽보다 앞이라 그냥 보인다.
          if(!frameBB.isEmpty()) gg.position.z += (gz - frameBB.max.z);
          gg.updateMatrixWorld(true);
          { const fb2 = new THREE.Box3(); gg.traverse(x => { if(x.isMesh && !isPanel(x)) fb2.union(new THREE.Box3().setFromObject(x)); });
            if(!fb2.isEmpty()){ frameH = fb2.max.y - fb2.min.y; frameMinZ = fb2.min.z; frameMinX = fb2.min.x; frameMaxX = fb2.max.x; } }
        }
        decoGrp.add(gg);
        // ★★2026-07-24 실측 바닥 — 게이트 자리(대전당↔아레나 경계)의 진짜 바닥을 레이캐스트로 찾는다.
        //   ry(대전당 중심 깊이)를 믿었더니 여기 실제 바닥과 8m 어긋나 프레임·포탈이 통째로 파묻혔다(헤드리스 렌더 확인).
        //   floorGrp는 이 시점에 개별 타일로 존재(병합은 아래). 이 아래 게이트 전부 ry 대신 gFloor 사용.
        let gFloor = ry;
        try{ floorGrp.updateWorldMatrix(true,true);
          const _rc = new THREE.Raycaster(new THREE.Vector3(gx, ry+30, gz), new THREE.Vector3(0,-1,0), 0, 70);
          const _hit = _rc.intersectObjects(floorGrp.children, true);
          if(_hit.length) gFloor = _hit[0].point.y;
        }catch(_){}
        if(Math.abs(gFloor - ry) > 0.05){ gg.position.y += (gFloor - ry); gg.updateMatrixWorld(true); }   // 프레임을 진짜 바닥으로
        console.log('[dungeonrun] 🚪 게이트 바닥 — ry', ry.toFixed(1), '→ 실측', gFloor.toFixed(1), '(Δ', (gFloor-ry).toFixed(1)+')');
        // 🪜 **게이트 계단 콜라이더** — 2026-07-24 신설 (사령관 "glb 보면 계단인데 그냥 바닥 뚫림 … 계단처럼 올라가게끔").
        //   `bossgate.glb` 문틀 본체에는 문지방까지 올라가는 **단 기단**이 조각돼 있는데, 게이트는 `decoGrp`(장식 전용)
        //   소속이라 **충돌체가 하나도 없다.** 즉 계단은 눈에만 보이고 몸은 그대로 통과했다.
        //   ⇒ 계단 형상만큼 보이지 않는 단을 세워 실제로 밟고 올라가게 한다.
        //   ★수치는 GLB 정점을 직접 파싱해 실측한 값(모델 단위, 문틀 높이 16.70 기준):
        //     · 기단 윗면(문지방) = 문틀 밑면 +1.99   · 계단 앞(낮은 쪽) = 문틀 앞면 +0.30   · 계단 끝(높은 쪽) = +2.80
        //     교차검증: 이 문지방 높이가 정정된 개구부 밑변과 10cm 안에서 일치한다(→ 두 실측이 서로를 확인).
        //   ⚠️문틀 bbox에서 **매번 다시 환산**한다(상수 m 값 하드코딩 금지 — wantH가 바뀌면 같이 따라와야 한다).
        let gateStepY = gFloor;
        if(frameH > 0){
          const S = frameH / 16.70;                       // 모델 단위 → m
          const topY = gFloor + 1.99 * S;                 // 문지방
          const zFoot = frameMinZ + 0.30 * S;             // 홀 쪽(낮은 쪽)
          const zTop  = frameMinZ + 2.80 * S;             // 문틀 쪽(높은 쪽)
          const wHalf = (frameMaxX - frameMinX) / 2;
          const N = 5;
          for(let i = 0; i < N; i++){                     // 계단 — 각 단은 바닥까지 꽉 찬 솔리드(밑이 뚫리지 않게)
            const z0 = zFoot + (zTop - zFoot) * (i / N), z1 = zFoot + (zTop - zFoot) * ((i + 1) / N);
            const h = (topY - gFloor) * ((i + 1) / N);
            const m = new THREE.Mesh(new THREE.BoxGeometry(wHalf * 2, h, Math.max(0.05, z1 - z0)), sealMat);
            m.position.set((frameMinX + frameMaxX) / 2, gFloor + h / 2, (z0 + z1) / 2);
            m.visible = false; solidGrp.add(m);           // 시각은 GLB 기단이 담당 — 콜라이더만 보탠다
          }
          { const h = topY - gFloor, z0 = zTop, z1 = gz + 0.8;   // 문지방 단(문 안쪽까지) — 여기 서서 [E]
            const m = new THREE.Mesh(new THREE.BoxGeometry(wHalf * 2, h, Math.max(0.05, z1 - z0)), sealMat);
            m.position.set((frameMinX + frameMaxX) / 2, gFloor + h / 2, (z0 + z1) / 2);
            m.visible = false; solidGrp.add(m); }
          gateStepY = topY;
        }
        const mixer = (gate.animations && gate.animations.length) ? new THREE.AnimationMixer(gg) : null;
        // ★★2026-07-24 6차 — **아치 개구부를 광선으로 직접 실측.** GLB 내부 수치(문짝 bbox·계단 실측)로 포탈 높이를
        //   추정한 게 5번 다 틀렸다(사령관 "아직도 파묻힘" 반복 — 포탈이 아치 밑동에만 걸림). 이제 추정을 버린다:
        //   프레임(gg)을 관통하는 수평 광선을 높이별로 쏴서 **뻥 뚫린 구간(= 아치 구멍)** 을 찾는다. 그게 진짜 개구부다.
        let archLo = gFloor, archHi = gFloor + 5;
        try{
          gg.updateMatrixWorld(true);
          const dir = new THREE.Vector3(0,0,1);   // 홀(-z) → 보스(+z)
          // ★정면 슬래브만 테스트 — 짧은 광선(3m). 통행 통로가 아니라 **보이는 아치 구멍**을 잰다.
          const zStart = frameMinZ - 1.0;
          const ys = [], y0 = gFloor - 1, y1 = gFloor + 12, step = 0.2;
          for(let yy = y0; yy <= y1; yy += step){
            const rc = new THREE.Raycaster(new THREE.Vector3(gx, yy, zStart), dir, 0, 3.0);
            const open = rc.intersectObject(gg, true).length === 0;   // 정면 프레임에 안 막히면 = 아치 구멍
            ys.push({ y:yy, open });
          }
          // 가장 긴 연속 open 구간 = 아치 통로
          let best=null, cur=null;
          for(const s of ys){ if(s.open){ if(!cur) cur={lo:s.y,hi:s.y}; else cur.hi=s.y; }
            else { if(cur && (!best || (cur.hi-cur.lo)>(best.hi-best.lo))) best=cur; cur=null; } }
          if(cur && (!best || (cur.hi-cur.lo)>(best.hi-best.lo))) best=cur;
          if(best && (best.hi-best.lo) > 1.0){ archLo = Math.max(best.lo, gateStepY - 0.3); archHi = best.hi; }
        }catch(_){}
        console.log('[dungeonrun] 🚪 아치 개구부 실측 — lo', archLo.toFixed(1), '~ hi', archHi.toFixed(1), '(바닥', gFloor.toFixed(1)+')');
        // 🌀 포탈 막 — **최종 배치 후 개구부를 다시 재서** 그 자리에 채운다(회전·재배치로 좌표가 다 바뀌었다).
        //   정본 = gate.js(fbm 스크롤 + 다층 ShaderMaterial + 코어/림). ⛔단색 판 금지.
        const apF = apOf(gg);
        // ★문짝 4장을 숨긴다 — 사령관 지시가 "게이트 안에 포탈 같은 느낌 · E 누르면 보스방 진입"이므로
        //   이 게이트는 여닫는 문이 아니라 **항상 일렁이는 관문**이다. 문짝이 닫혀 있으면 포탈이 그 뒤에 가려 안 보인다.
        gg.traverse(x => { if(/^Door[_ ](up|down|left|right)[_ ]gameasset$/.test(x.name || '')) x.visible = false; });
        // ★★2026-07-24 포탈 높이 기준 변경 (사령관 "계단은 됐는데 포탈이 밑으로 내려가버림 — 포탈 올려야 함").
        //   구 기준 = 문짝 bbox 중심(`apF.center.y`). 그런데 이 GLB의 문짝 4장은 바인드 자세가 제각각 물러나 있어서
        //   (down은 아래, up은 뒤쪽) **어떻게 조합해도 개구부 중심이 안 맞는다.** 정적 분석으로도 문틀의 진짜 구멍을
        //   특정하지 못했다(정면 슬래브 점유맵·중앙 단면 둘 다 애매). ⇒ **모델 내부에 의존하지 않는 기준으로 바꾼다.**
        //   ⇒ **계단 위(문지방 = gateStepY)에 포탈 밑변을 얹는다.** 계단은 사령관이 실제로 밟고 올라가는 걸 확인한
        //     검증된 기준면이므로, 그 위에 세우면 "계단 올라가면 눈앞이 관문"이 물리적으로 보장된다.
        // ★★2026-07-24 3차 — 포탈 Y를 **바닥(ry) 기준 절대값**으로 못박는다. GLB 내부(문짝 bbox·계단 실측)에
        //   의존한 앞선 두 번(apF.center.y / gateStepY)이 다 틀려서 바닥에 파묻혔다(사령관 반복 지적).
        //   createPortal은 PlaneGeometry(원점 중심)라 group.y = 세로 중심. 밑변을 바닥에 놓으려면 = ry + 높이/2.
        //   여기에 문지방 높이만큼(있으면) 더 얹어 계단 위 관문으로 보이게. 무슨 일이 있어도 바닥 아래로 안 내려간다.
        // ★★2026-07-24 7차 — 이 GLB는 **실제 뚫린 통로가 낮고 위 아치는 장식 relief**라 광선이 계속 낮게 잡혔다.
        //   추정 그만: 문지방(gateStepY=계단 top) 위에 **넉넉한 고정 크기**로 세워 보이는 아치를 채운다. 미세조정은 __gateY.
        const portalH = 4.6, portalW = 3.2;                    // 아치 개구부에 들어앉는 크기(프레임이 둘러싸게)
        const portalY = gateStepY + portalH / 2 - 0.3;         // ★밑변 ≈ 문지방(계단 위)
        const portal = createPortal({ w: portalW, h: portalH,
          glow: 0x63e0ff, deep: 0x1b2f8a, shape: 6.0, lightIntensity: 18 });
        // ★★2026-07-24 8차 (진짜 원인) — 포탈이 프레임 **터널 안쪽**에 있어서 아치 장식 relief가 위쪽을 가렸다.
        //   그래서 아무리 키워도 낮은 통로만 청록으로 보였다(사령관 "아직도 파묻힘"). ⇒ 포탈을 **프레임 앞면(홀 쪽)** 으로 뺀다.
        //   frameMinZ = 프레임 정면(홀 쪽 min z). 그 살짝 앞에 세우면 아치 relief에 안 가리고 전체가 홀을 향해 일렁인다.
        const portalZ = frameMinZ + 1.3;   // 아치 개구부 안쪽(프레임 앞기둥이 좌우로 둘러싸게)
        portal.group.position.set(apF.center.x, portalY, portalZ);
        portal.setOpen(1);   // 보스방 관문이므로 항상 일렁인다(레버는 문짝 애니를 연다)
        decoGrp.add(portal.group);
        // 🧱 뒷막음판 — 뚫은 자리 너머로 검은 빈 공간이 보이면 게이트가 허공에 뜬 것처럼 읽힌다.
        //   포탈 바로 뒤에 어두운 석재 판을 대 시야를 막는다(통행은 어차피 [E] 진입이라 지장 없음).
        {
          const back = new THREE.Mesh(new THREE.BoxGeometry(portalW * 1.3, portalH * 1.4, 0.5), sealMat);
          back.position.set(apF.center.x, portalY, portalZ + 0.9);   // 포탈 바로 뒤
          decoGrp.add(back);
        }
        // 🧱 포탈 충돌체 — 사령관 "게이트 포탈 충돌체로 막아주고 E키 눌러야 들어갈 수 있게".
        //   걸어서 통과하면 [E] 진입 연출이 무의미해진다. 보이지 않는 판으로 막는다.
        //   ⚠️addTrimeshMesh는 visible을 보지 않으므로 visible=false 여도 충돌은 유효하다.
        {
          const blk = new THREE.Mesh(new THREE.BoxGeometry(portalW * 1.1, portalH * 1.3, 0.6), sealMat);
          blk.position.set(apF.center.x, portalY, apF.center.z);   // 포탈과 같은 높이
          blk.visible = false; solidGrp.add(blk);
        }
        // 🔧 라이브 튜너 — 콘솔에서 바로 올리고 내린다. `__gateY(0.5)` = 50cm 위로, `__gateY()` = 현재값.
        //   (모델 기하가 불확실해 기준을 못 박은 만큼, 사령관이 눈으로 보고 즉시 맞출 수 있어야 한다.)
        try{ window.__gateY = (dy) => { if(dy != null) portal.group.position.y += +dy;
          return '포탈 y = ' + portal.group.position.y.toFixed(2) + ' (실측바닥 기준 +' + (portal.group.position.y - gFloor).toFixed(2) + 'm)'; }; }catch(_){}
        // ⛔ **벽 뚫기 폐지(2026-07-24).** 게이트가 이제 벽 앞에 통째로 서므로 뚫을 이유가 사라졌다.
        //   구 코드는 개구부 폭(10m)만큼 벽 메시를 지웠는데, 통로는 1칸(4m)뿐이라 **양옆 칸 벽까지** 지워졌고
        //   그 너머는 방이 아니라 허공(void)이었다 = 사령관이 밟고 떨어진 그 구멍. 여는 대신 **안 막힌 자리에 세운다.**
        //   ⚠️되살릴 일이 있으면 반드시 `openHalf`(= 실제 walkable 개구부 반폭) 이내로 제한할 것.
        void openHalf;
        // 🚪 [E] 보스방 진입 — 개구부 앞에 서면 프롬프트, E로 보스방 중앙으로 이동.
        //   (통로를 걸어서 들어가게 하지 않는 이유: 게이트가 곧 "보스방 진입" 연출이라 사령관 지시대로 E 진입으로 통일)
        {
          const br = lay.rooms.find(r2 => r2.role === 'bossarena' || r2.role === 'boss');
          if(br){ const bry = lay.hgt[lay.idx(br.cx, br.cz)] || 0;
            // ★2026-07-23 🌋링 아레나 — 중앙은 용암(즉사)이라 텔레포트 목적지를 **북쪽 링 입구**(br.z+1행)로. 중앙 착지 금지.
            bossEnter = { x: c.x + apF.center.x, z: c.z + apF.center.z,
              to: { x: c.x + CC(br.cx), y: c.y + bry + 1.6, z: c.z + CC(br.z + 1) } }; }
        }
        // 게이트 전용 상주 광원 1개 — 대전당은 어둡고 게이트는 검은 석재라 조명 없으면 벽과 구분이 안 된다.
        const glp = new THREE.PointLight(0xbfe4ff, 22, 46, 2); glp.position.set(gx, gFloor + 4.0, gz - 6); decoGrp.add(glp);   // 포탈 색과 맞춘 청백광 — 검은 석재 문틀이 어둠에 묻히던 것 보정
        bossGateFx = { mixer, clips: gate.animations || [], portal, opened: false, t: 0 };
        ctx.__dgGate = { x: c.x + gx, y: c.y + ry, z: c.z + gz,
          aperture: [+ap.size.x.toFixed(1), +ap.size.y.toFixed(1)],     // 🔧 검수 훅 — 실측 개구부(m)
          // 🔧 2026-07-24 추가 — 계단·개구부 정합 검증용. stepY(문지방 콜라이더 높이)와 apBottom(개구부 밑변)이
          //   서로 10cm 안이어야 "계단 올라가면 바로 관문" 이 성립한다. 어긋나면 계단 위에서 허공/벽에 막힌다.
          stepY: +(gateStepY - ry).toFixed(2), apBottom: +(apF.center.y - apF.size.y/2 - ry).toFixed(2),
          frameH: +frameH.toFixed(2), openHalf: +openHalf.toFixed(2) };
      }
    }
    ctx.scene.add(root);
    root.updateWorldMatrix(true, true);
    // ⚡ 정적 병합 — **반드시 여기서**. 위쪽에서 게이트/램프 입구 뚫느라 solidGrp에서 벽 메시를 빼는 작업이 이미 끝났고,
    //   아래 trimesh/레이캐스트 등록은 아직 안 했다. 순서가 어긋나면 뚫은 구멍이 도로 메워지거나 충돌체가 안 붙는다.
    { const a = mergeStaticGroup(floorGrp, '바닥'), b = mergeStaticGroup(solidGrp, '벽·기둥'), c2 = mergeStaticGroup(ceilGrp, '천장·장식벽');
      console.log('[dungeonrun] ⚡ 정적 메시 ' + (a.before + b.before + c2.before) + ' → ' + (a.after + b.after + c2.after)
        + ' (드로우콜 급감 — 사령관 "프레임 드랍이 너무 심함" 대응)');
      root.updateWorldMatrix(true, true); }
    // 물리(보행/차단): 바닥+벽+문틀+기둥 trimesh — 바디는 root.userData._bodies에 모임(removeTrimesh로 일괄 해제)
    if(ctx.terrain && ctx.terrain.addTrimeshMesh){
      floorGrp.traverse(o => ctx.terrain.addTrimeshMesh(o, root));
      solidGrp.traverse(o => ctx.terrain.addTrimeshMesh(o, root));
      // ★프리팹 소품 충돌체(불꽃/글로우=additive 제외) — root 월드행렬 갱신 후 등록
      for(const g of pfGroups) g.traverse(t2 => { if(t2.isMesh && !(t2.material && t2.material.blending === THREE.AdditiveBlending)) ctx.terrain.addTrimeshMesh(t2, root); });
      bossDoorOwner.traverse(o => ctx.terrain.addTrimeshMesh(o, bossDoorOwner));   // ★잠긴 보스문(개별 owner=레버 시 제거)
      shortcutDoorOwner.traverse(o => ctx.terrain.addTrimeshMesh(o, shortcutDoorOwner));   // ★잠긴 숏컷 게이트(개별 owner=레버 시 제거)
      alcoveDoorOwner.traverse(o => ctx.terrain.addTrimeshMesh(o, alcoveDoorOwner));   // ★봉인방 벽(개별 owner=레버 당기면 부서짐)
    }
    // 레이캐스트(groundAt/스폰/드롭): 바닥 그룹만 등록(push 래핑으로 BVH 자동)
    if(ctx.terrain && ctx.terrain.collide){ ctx.terrain.collide.push(floorGrp);
      if(hallFloorCol) ctx.terrain.collide.push(hallFloorCol);
      if(cascadeFloorCol) ctx.terrain.collide.push(cascadeFloorCol); }   // ★10차-B 지하 바닥 + 🏔️대홀 돌길/물웅덩이도 collide(몹 이동·groundAt 인식)

    // ⑧ 배치 정보 — 입장점(입구 방 중앙, 던전 안쪽을 바라봄) + 몹 스폰 스팟(입구 제외 방들, 깊은 방 우선)
    const ex = c.x + CC(lay.entrance.cx), ez = c.z + CC(lay.entrance.cz);
    let lookX = CC(lay.treasure.cx), lookZ = CC(lay.treasure.cz);   // 기본: 보물방 방향
    const entDoor = lay.doorEdges.find(e => e.rid === lay.entrance.id);
    if(entDoor){ const p = edgePos(entDoor); lookX = p.x; lookZ = p.z; }   // 입구 방 문이 있으면 그쪽
    const entryYaw = Math.atan2((c.x + lookX) - ex, -((c.z + lookZ) - ez));   // player forward=(sinYaw,-cosYaw)
    const mobRooms = lay.rooms.filter(r => r !== lay.entrance)
      .sort((a, b) => lay.dist[lay.idx(b.cx, b.cz)] - lay.dist[lay.idx(a.cx, a.cz)]);   // 깊은 방부터
    // ★몹 스폰 = 프리팹 'm' 마커(없으면 방 중앙 폴백)
    // ★2026-07-21 몹 분배 근본수정 (사령관 "몹 숫자가 다 별로임 · 지하에는 몹이 거의 다 없고")
    //   원인: 스폰 루프가 `mobSpots[i % len]`로 **배열 앞에서부터** N마리만 뽑는데, 배열이 방 순서대로 쌓여
    //         지상 첫 방들이 전부 가져가고 지하는 0마리였다. → **방별 라운드로빈**으로 재배열해 모든 방이
    //         한 마리씩 채워진 뒤에야 두 번째 마리가 들어가게 한다(지하 포함 전 방 균등).
    const byRoom = new Map();
    for(const s of pfMobSpots){ const k = (s.rid == null ? -1 : s.rid); if(!byRoom.has(k)) byRoom.set(k, []); byRoom.get(k).push(s); }
    // ★2026-07-22 라운드로빈 **순서** 보정 (사령관 "지하 넓은 홀에비해 몬스터가 적음")
    //   1패스는 모든 방이 1마리씩으로 공평하지만, 2패스부터는 Map 삽입순(=방 번호순)이라 **또 지상 방들이 먼저** 가져갔다.
    //   ⇒ 매 패스를 **마커 많은 방(=넓은 방) 우선**으로 돌린다. 잡몹이 방 수보다 많을 때 대공동이 먼저 채워진다.
    const roomArrs = [...byRoom.values()].sort((a, b) => b.length - a.length);
    const rrSpots = [];
    for(let i = 0, more = true; more; i++){ more = false;
      for(const arr of roomArrs) if(i < arr.length){ rrSpots.push(arr[i]); more = true; } }
    const spots = rrSpots.length ? rrSpots : (mobRooms.length ? mobRooms : [lay.entrance]).map(r => ({
      x: c.x + CC(r.cx), z: c.z + CC(r.cz), r: Math.max(1.5, Math.min(r.w, r.h) * CELL * 0.3),
      y: lay.hgt[lay.idx(r.cx, r.cz)] || 0,
    }));
    // ★보스 스폿 = 보스방 'P' 마커(없으면 보물방 중앙). y=방 깊이 — 보스방이 지하로 내려가면서 필수가 됨(없으면 지상에 스폰).
    const bossSpot = pfPortal ? { x: pfPortal.x, z: pfPortal.z, r: 1.0, y: pfPortal.y || 0 }
      : { x: c.x + CC(lay.treasure.cx), z: c.z + CC(lay.treasure.cz), r: 1.0, y: lay.hgt[lay.idx(lay.treasure.cx, lay.treasure.cz)] || 0 };
    // ★함정(스파이크) — 복도 셀에 배치하되 한쪽 벽으로 치우쳐(±CELL*0.28) 반대편에 통과 레인을 남긴다.
    //   사령관 "함정 있으면 우회할 수 있어야" — 복도 폭 4m 중 스파이크가 한쪽 ~2m만 덮고, 반대편 ~2m로 지나감.
    //   decoGrp(collide/trimesh 미등록: 스폰레이·보행 무간섭) · 판정은 좌표 거리(루프에서 envHurt).
    const walkC = (x, z) => x >= 0 && z >= 0 && x < G && z < G && lay.type[lay.idx(x, z)] > 0;
    const corr = [];
    for(let z = 0; z < G; z++) for(let x = 0; x < G; x++) if(lay.type[lay.idx(x, z)] === 2) corr.push([x, z]);
    for(let i = corr.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; const t = corr[i]; corr[i] = corr[j]; corr[j] = t; }
    const trapSpots = []; const nTrap = Math.min(D.spikes, corr.length);   // ★티어별 스파이크 수
    const spikeH = (kit.SPIKE_TOP || 1.2) * 0.85;             // 실측 가시높이(스케일 반영)
    for(let i = 0; i < nTrap; i++){ const [gx, gz] = corr[i];
      const horiz = walkC(gx - 1, gz) || walkC(gx + 1, gz);   // 진행축이 x면 z로 치우침(그 반대)
      const side = Math.random() < 0.5 ? 1 : -1;
      const offX = horiz ? 0 : side * CELL * 0.28, offZ = horiz ? side * CELL * 0.28 : 0;
      const sp = place('floor_tile_big_spikes', decoGrp, CC(gx) + offX, CC(gz) + offZ, 0);
      sp.scale.set(0.6, 0.85, 0.6);   // 한쪽만 덮게 축소(반대편 레인 확보)
      // ★11차 — 칸 높이 추종(전엔 y=0 고정이라 지하 -20 복도의 스파이크가 지상 높이에 떠 있었음. 기밀검사 10발의 정체).
      const thy = lay.hgt[lay.idx(gx, gz)] || 0;
      const upY = thy + 0.02, downY = thy - (spikeH + 0.3);   // 나옴/들어감(바닥 아래로 완전히 숨김)
      sp.position.y = downY;                                   // 시작=들어감(숨김)
      // ★스파이크 2종(번갈아): mode='timed'(자동 반복, 타이밍 통과) / 'pressure'(밟으면 솟음). 둘 다 점프·옆레인 우회 가능.
      const mode = (i % 2 === 0) ? 'timed' : 'pressure';
      trapSpots.push({ x: c.x + CC(gx) + offX, z: c.z + CC(gz) + offZ, r: CELL * 0.24, triggerR: CELL * 0.5,
        mesh: sp, upY, downY, spikeH, baseY: thy, mode, state: 'idle', t: 0, phase: Math.random() * 2.4 });
    }
    // ★불 함정(엘든링식) — 스파이크와 다른 복도 셀에 1~2개. 화염이 복도 진행축으로 뻗어 주기적으로 화르르.
    const fireTraps = [];
    for(let i = nTrap; i < Math.min(nTrap + D.fire, corr.length); i++){ const [gx, gz] = corr[i];   // ★티어별 불함정 수
      const horiz = walkC(gx - 1, gz) || walkC(gx + 1, gz);   // 통로 진행축
      // ★분출구는 진행축에 '수직'인 벽에 부착 → 통로를 가로질러 쏜다. (진행축으로 쏘면 그 방향이 벽일 때 불이 벽으로=반대로 나갔음)
      //   벽면 = 걷기 불가한 perp 쪽에 부착, 반대 perp(통로 안쪽)로 발사.
      const openPlus = horiz ? walkC(gx, gz+1) : walkC(gx+1, gz);   // +perp이 열려있나?
      const sgn = openPlus ? -1 : 1;                                // 열린 쪽 반대(벽)에서 쏨
      const fdx = horiz ? 0 : sgn, fdz = horiz ? sgn : 0;           // 발사 방향(가로지름)
      const len = CELL, yaw = Math.atan2(fdx, fdz);
      const wx = CC(gx) - fdx * CELL * 0.5, wz = CC(gz) - fdz * CELL * 0.5;   // 쏘는 반대쪽 벽면(부착부)
      const fhy = lay.hgt[lay.idx(gx, gz)] || 0;   // ★11차 — 칸 높이 추종(지하 복도의 불함정이 지상에 떠 있던 것 수정)
      const emitter = buildFireEmitter(); emitter.position.set(wx, fhy, wz); emitter.rotation.y = yaw; decoGrp.add(emitter);
      const mz = emitter.userData.muzzleZ || 1.1, mux = wx + fdx*mz, muz = wz + fdz*mz;   // 주둥이
      const grp = buildFireJet(len - mz); grp.position.set(mux, fhy, muz); grp.rotation.y = yaw; decoGrp.add(grp);
      const lp = new THREE.PointLight(0xff6414, 0, 15, 2.0); lp.position.set(mux, fhy + 1.1, muz); root.add(lp);
      fireTraps.push({ ex: c.x + mux, ez: c.z + muz, dx: fdx, dz: fdz, len: len - mz, grp, light: lp, emitter, phase: Math.random() * 5 });
    }
    // ══ 불의 통로 — 각 통로 셀에 수직 화염 제트(왼→오 파도로 훑음). 좌우 알코브=안전. 끝=보상. ══
    let gauntFire = null;
    if(lay.gauntlet && lay.gauntlet.cells.length){
      const gl = lay.gauntlet, jets = [];
      const jetCells = gl.cells.slice(0, Math.max(1, gl.cells.length - 1));   // ★마지막(보상) 칸 제외 = 상자 앞은 불 없음(안전 개봉)
      for(const [gx, gz] of jetCells){
        const ghy = lay.hgt[lay.idx(gx, gz)] || 0;   // ★11차 — 불의 통로도 칸 높이 추종
        const jet = buildFireJet(3.6); jet.rotation.x = -Math.PI/2; jet.position.set(CC(gx), ghy + 0.9, CC(gz)); decoGrp.add(jet);
        const lp = new THREE.PointLight(0xff5a14, 0, 14, 2.0); lp.position.set(CC(gx), ghy + 1.4, CC(gz)); root.add(lp);
        jets.push({ x: c.x + CC(gx), z: c.z + CC(gz), jet, light: lp });
      }
      const alcoves = gl.alcoves.map(([ax, az]) => ({ x: c.x + CC(ax), z: c.z + CC(az) }));
      const [rx, rz] = gl.reward;
      const rchest = place('chest_gold', decoGrp, CC(rx), CC(rz), 0, lay.hgt[lay.idx(rx, rz)] || 0); rchest.position.y += 0.22;
      glowSpot(CC(rx), CC(rz), false);   // 상자 발광(유혹)
      dgChests.push({ x: c.x + CC(rx), z: c.z + CC(rz), kind:'reward', gold: 60 + ((Math.random()*60)|0), soul: 3 });   // ★불의 통로 끝 [E] 개봉
      place('coin_stack_medium', decoGrp, CC(rx) + 0.7, CC(rz) + 0.5, Math.random() * 6.28);
      gauntFire = { jets, alcoves, r: CELL * 0.55, ar: CELL * 0.5, reward: { x: c.x + CC(rx), z: c.z + CC(rz) }, claimed: false, waveT: 0 };
    }
    // ══ [2] 2층 (물리 겹침) — 함정셀 '바로 아래' 좁은 벽 통로. 함정 밟으면 콜라이더 제거+파편(와르르)=진짜 낙하 · 사다리 실제 등반 · 광맥 파밍 ══
    let lower = null;
    if(twoLv){
      const { tx, tz, dx, dz, CL } = twoLv;                       // 통로 칸(i=0=함정셀 아래, i>=1=방 아래 안쪽)
      const low = new THREE.Group(); low.position.set(0, -DROP, 0); root.add(low);
      const loFloor = new THREE.Group(), loSolid = new THREE.Group(); low.add(loFloor); low.add(loSolid);
      const cellX = i => CC(tx + dx*i), cellZ = i => CC(tz + dz*i);
      const px = -dz, pz = dx, HALF = 1;                          // px/pz=폭 방향 단위, HALF=반폭 → 폭 2*HALF+1=3칸
      // ★2026-07-17 3차 재설계(사령관 "밑에서 좁은 복도만 지나가다 끝나는거 아니냐") — 평평한 3칸폭 직선 바닥 폐기.
      //   리서치(블라이트타운 절벽 스캐폴딩·스톰빌 성문 경사로·실제 광산 나선 데클라인) 결론: "경사로 자체가 콘텐츠".
      //   진행축을 따라 계속 내려가는 완만한 경사 바닥(atan≈10~17°, KCC maxSlopeClimbAngle=55°(player.js:89)에
      //   여유 있게 안전 — 엔진 변경 없음) + 경사면 위 화염 함정으로 "그냥 지나가는 길"이 아니게 만든다.
      const totalDescent = Math.min(CL - 1, 8) * 1.1;             // 최대 ~8.8 유닛 추가 하강
      const cellY = i => -totalDescent * (CL > 1 ? i / (CL - 1) : 0);   // i=0(함정 낙하 지점)=0 · i=CL-1(사다리)=최심부
      const rampAngle = Math.atan2(totalDescent, Math.max(1, CL - 1) * CELL);
      const rampW = (2*HALF+1)*CELL, runLen = CL*CELL;
      const midX = (cellX(0)+cellX(CL-1))/2, midZ = (cellZ(0)+cellZ(CL-1))/2, midY = -totalDescent/2;
      const floorMat = new THREE.MeshStandardMaterial({ color:0x362f26, roughness:0.96 });
      const rampFloor = new THREE.Mesh(new THREE.BoxGeometry(dx?runLen:rampW, 0.35, dx?rampW:runLen), floorMat);
      rampFloor.position.set(midX, midY, midZ);
      if(dx) rampFloor.rotation.z = -Math.sign(dx)*rampAngle; else if(dz) rampFloor.rotation.x = Math.sign(dz)*rampAngle;
      loFloor.add(rampFloor);
      // 벽(양 옆 폭 바깥 + 양 끝) — 칸마다 경사 높이(cellY)를 따라가며 붙여 계단식으로 단차 최소화(완만해서 거의 안 보임).
      const wm = new THREE.MeshStandardMaterial({ color:0x201f26, roughness:0.97 });
      const WH = 6, off = (HALF+0.5)*CELL, wWide = (2*HALF+1)*CELL;
      const bwall=(cx,cz,yOff,w,d)=>{ const m=new THREE.Mesh(new THREE.BoxGeometry(w,WH,d),wm); m.position.set(cx,yOff+WH/2,cz); loSolid.add(m); };
      for(let i=0;i<CL;i++){
        bwall(cellX(i)+px*off, cellZ(i)+pz*off, cellY(i), dx?CELL:0.35, dz?CELL:0.35);
        bwall(cellX(i)-px*off, cellZ(i)-pz*off, cellY(i), dx?CELL:0.35, dz?CELL:0.35);
      }
      bwall(cellX(CL-1)+dx*CELL*0.5, cellZ(CL-1)+dz*CELL*0.5, cellY(CL-1), dx?0.35:wWide, dz?0.35:wWide);   // 끝벽(최심부)
      bwall(cellX(0)-dx*CELL*0.5, cellZ(0)-dz*CELL*0.5, cellY(0), dx?0.35:wWide, dz?0.35:wWide);            // 입구쪽 막이
      // 천장 = 상층 방 바닥이 대신함(경사로가 내려갈수록 실제 층고만 더 넉넉해짐 — 간섭 없음).
      // ★조명 톤 대비(리서치: 지층 깊이별 색이 방향감각을 줌) — 시작=따뜻한 횃불색, 최심부=차가운 청색.
      const l1=new THREE.PointLight(0xffb060,6,20,2); l1.position.set(cellX(0),cellY(0)+2.4,cellZ(0)); low.add(l1);
      const l2=new THREE.PointLight(0x8fb0ff,5,24,2); l2.position.set(cellX(CL-1),cellY(CL-1)+2.6,cellZ(CL-1)); low.add(l2);
      // ★경사면 위 화염 함정 — "경사로=이동수단+위협"(리서치 결론). 중간 지점 근처, 진행축에 수직으로 분출.
      if(CL >= 5){
        const hi = Math.floor(CL*0.55), openSide = Math.random()<0.5 ? 1 : -1;
        const fdx = px*openSide, fdz = pz*openSide, hy = cellY(hi);
        const hx0 = cellX(hi) - fdx*off, hz0 = cellZ(hi) - fdz*off, hyaw = Math.atan2(fdx, fdz);
        const emitter = buildFireEmitter(); emitter.position.set(hx0, hy, hz0); emitter.rotation.y = hyaw; low.add(emitter);
        const mz = emitter.userData.muzzleZ || 1.1, mux = hx0 + fdx*mz, muz = hz0 + fdz*mz;
        const jetGrp = buildFireJet(wWide - mz); jetGrp.position.set(mux, hy, muz); jetGrp.rotation.y = hyaw; low.add(jetGrp);
        const flp = new THREE.PointLight(0xff6414, 0, 15, 2.0); flp.position.set(mux, hy+1.1, muz); low.add(flp);
        fireTraps.push({ ex: c.x+mux, ez: c.z+muz, dx: fdx, dz: fdz, len: wWide - mz, grp: jetGrp, light: flp, emitter, phase: Math.random()*5 });
      }
      // 사다리 = 통로 '끝'(i=CL-1, 경사로 최심부) → 상층 바닥 구멍으로.
      const li = CL - 1;
      const ladder = buildLadder(DROP + totalDescent + 1.6); ladder.position.set(cellX(li), cellY(li), cellZ(li)); ladder.rotation.y = Math.atan2(-dx,-dz); low.add(ladder);
      const ladWorld = { x:c.x+cellX(li), z:c.z+cellZ(li), yBot:c.y-DROP-totalDescent, yTop:c.y, ex:-dx*CELL, ez:-dz*CELL };
      // 함정 나무(약한 타일, i=0=경사 시작점=원래 DROP 높이) — 개별 콜라이더 owner. 미끼 상자 + 발광.
      const trapOwner = new THREE.Group(); root.add(trapOwner);
      const weak = kit.floor_wood_large.clone(true); weak.position.set(CC(tx),0.02,CC(tz)); decoGrp.add(weak);
      const baitChest = place('chest_gold', decoGrp, CC(tx), CC(tz), Math.random()*6.28); baitChest.position.y = 0.22;
      glowSpot(CC(tx), CC(tz), true);
      dgChests.push({ x: c.x + CC(tx), z: c.z + CC(tz), kind:'bait' });   // ★미끼 상자 [E] = 함정 발동
      // 광맥(i>=1 = 밖 void 아래) — 경사로를 따라 깊이(shift)도 함께 보간.
      const oreRefs = [], oreCells = [];
      for(let i=1;i<CL-1 && oreCells.length<D.nodes;i++){ const w = (i%2) ? HALF : -HALF;
        oreCells.push({ x:c.x+cellX(i)+px*CELL*w, z:c.z+cellZ(i)+pz*CELL*w, shift: DROP - cellY(i), key:D.nodeOres[(i-1)%D.nodeOres.length] }); }
      root.updateWorldMatrix(true, true);
      if(ctx.terrain && ctx.terrain.addTrimeshMesh){
        loFloor.traverse(o=>ctx.terrain.addTrimeshMesh(o, root)); loSolid.traverse(o=>ctx.terrain.addTrimeshMesh(o, root));
        // ★버그 수정(2026-07-17, 사령관 "상자 안 눌렀는데 떨어짐"): weak=kit.floor_wood_large.clone(true)는 GLTF Group이라
        //   Mesh 아님 → addTrimeshMesh가 o.isMesh 아니면 조용히 no-op이라 콜라이더가 애초에 안 생겼음(항상 뚫린 구멍).
        //   다른 바닥/벽처럼 .traverse()로 실제 Mesh 자손까지 순회해야 진짜 콜라이더가 생김.
        weak.traverse(o=>ctx.terrain.addTrimeshMesh(o, trapOwner));   // ★함정 타일 = 개별 owner
      }
      if(ctx.terrain && ctx.terrain.collide) ctx.terrain.collide.push(loFloor);
      if(ctx.mine && ctx.mine.registerNode){
        for(const oc of oreCells){ const mk=new THREE.Object3D(); mk.position.set(oc.x, c.y-DROP, oc.z); mk.userData.ore=ORE_KO[oc.key]||'돌';
          try{ const R=ctx.mine.registerNode(mk); if(R){ oreRefs.push(R);
            // ★겹침: registerNode가 groundAt(상층 바닥)에 광맥을 놓음 → 하층 실제 깊이(oc.shift)만큼 내림(메시+콜라이더).
            try{ if(R.obj) R.obj.position.y -= oc.shift; const bd = R.col && R.col.parent(); if(bd){ const tr=bd.translation(); bd.setTranslation({ x:tr.x, y:tr.y-oc.shift, z:tr.z }, true); } }catch(_){}
          } }catch(e){} }
      }
      ctx.ladders = ctx.ladders || []; ctx.ladders.push(ladWorld);   // ★실제 사다리 등록
      lower = { drop:DROP, maxDepth: DROP + totalDescent, loFloor, trapOwner, weak, baitChest, trapWorld:{ x:c.x+CC(tx), z:c.z+CC(tz) }, ladWorld, oreRefs, sprung:false, debris:null };
    }
    // ══ [10차 Stage3] 지하 그리드 층 — 지상 아래 yB에 독립 그리드(같은 파이프라인). 계단실 샤프트 사다리로 연결, 레버는 막장. ══
    let lowerGrid = null;
    if(lay.lowerSpec && lay.stairRoom){
      const yB = -12;
      const low = assembleHandcraft(lay.lowerSpec);
      const lowG = low.G, idx2 = (x,z)=>z*lowG+x, Llow = g => (g-lowG/2)*CELL, CClow = g => Llow(g+0.5);
      const lwe=[], lde=[];
      { const walk2=(x,z)=>x>=0&&z>=0&&x<lowG&&z<lowG&&low.type[idx2(x,z)]>0; const D4=[[0,-1],[1,0],[0,1],[-1,0]];
        for(let z=0;z<lowG;z++) for(let x=0;x<lowG;x++){ if(!walk2(x,z)) continue;
          for(let d=0;d<4;d++){ const nx=x+D4[d][0], nz=z+D4[d][1];
            if(!walk2(nx,nz)){ lwe.push({x,z,dir:d,rid:low.roomId[idx2(x,z)]}); continue; }
            if(low.type[idx2(x,z)]===2 && low.type[idx2(nx,nz)]===1){ const px=D4[(d+1)%4][0], pz=D4[(d+1)%4][1];
              if(!walk2(x+px,z+pz) && !walk2(x-px,z-pz)) lde.push({x,z,dir:d,rid:low.roomId[idx2(nx,nz)]}); } } } }
      const edgePosL = e => { const s=EDGE[e.dir](); return { x:Llow(e.x+s.ex), z:Llow(e.z+s.ez), rot:s.rot }; };
      const sf = low.rooms[low.stairfootIdx], sr = lay.stairRoom;
      const offX = CC(sr.cx)-CClow(sf.cx), offZ = CC(sr.cz)-CClow(sf.cz);   // 계단밑 중심을 계단실 샤프트 바로 아래로
      const low2 = new THREE.Group(); low2.position.set(offX, yB, offZ); root.add(low2);
      const loFloor2=new THREE.Group(), loSolid2=new THREE.Group(), loCeil2=new THREE.Group(), loProps2=new THREE.Group();
      low2.add(loFloor2); low2.add(loSolid2); low2.add(loCeil2); low2.add(loProps2);
      const placeL=(name,parent,x,z,rotY,y)=>{ const m=kit[name].clone(true); m.position.set(x,y||0,z); if(rotY)m.rotation.y=rotY; parent.add(m); return m; };
      const ceilHole=new Set(); ceilHole.add(sf.cx+','+sf.cz); ceilHole.add(sf.cx+','+(sf.cz+1)); ceilHole.add((sf.cx-1)+','+sf.cz); ceilHole.add((sf.cx)+','+(sf.cz-1));
      // 바닥(거친 암반 — 지상 석재와 대비)
      for(let z=0;z<lowG;z++) for(let x=0;x<lowG;x++){ if(!low.type[idx2(x,z)]) continue;
        placeL(Math.random()<0.6?'floor_dirt_large_rocky':'floor_tile_large', loFloor2, CClow(x), CClow(z), ((Math.random()*4)|0)*Math.PI/2); }
      // 벽 2단 + 문틀
      for(const e of lwe){ const p=edgePosL(e); for(let r=0;r<ROWS;r++) placeL('wall', loSolid2, p.x, p.z, p.rot, r*WALL_H); }
      for(const e of lde){ const p=edgePosL(e); placeL('wall_doorway', loSolid2, p.x, p.z, p.rot, 0); for(let r=1;r<ROWS;r++) placeL('wall', loSolid2, p.x, p.z, p.rot, r*WALL_H); }
      // 천장(샤프트 구멍 제외)
      for(let z=0;z<lowG;z++) for(let x=0;x<lowG;x++){ if(!low.type[idx2(x,z)] || ceilHole.has(x+','+z)) continue;
        const ct=placeL('floor_tile_large', loCeil2, CClow(x), CClow(z), 0, ROWS*WALL_H); ct.rotation.x=Math.PI; }
      // 방 인테리어(몹·상자·소품·횃불)
      for(const r of low.rooms){ const set=ROOM_PREFABS[r.role]||ROOM_PREFABS.combat; const pf=set[r.pfIdx||0]||set[0];
        const wallSet=new Set(); for(const e of lwe) if(e.rid===r.id) wallSet.add(e.x+','+e.z+','+e.dir);
        const o=buildPrefabRoom(kit, pf, CELL, { noFloor:true, wallAt:(i,j,dir)=>wallSet.has((r.x+i)+','+(r.z+j)+','+dir) });
        const wx=(r.x+r.w/2-lowG/2)*CELL, wz=(r.z+r.h/2-lowG/2)*CELL; o.grp.position.set(wx,0,wz); loProps2.add(o.grp);
        for(const s of o.mobSpots) pfMobSpots.push({ x:c.x+offX+wx+s.x, z:c.z+offZ+wz+s.z, r:1.5, y:yB });
        if(o.chest) dgChests.push({ x:c.x+offX+wx+o.chest.x, z:c.z+offZ+wz+o.chest.z, kind:'reward', gold:120+((Math.random()*80)|0), soul:6 });
        for(const lp2 of o.torches){ lp2.userData._base=lp2.intensity; torches.push(lp2); }
      }
      // 🪜 사다리(계단실 샤프트) — 계단밑(yB) ↔ 계단실 바닥(y0)
      const lad=buildLadder(-yB+1.6); lad.position.set(CC(sr.cx), yB, CC(sr.cz)); root.add(lad);
      ctx.ladders=ctx.ladders||[]; ctx.ladders.push({ x:c.x+CC(sr.cx), z:c.z+CC(sr.cz), yBot:c.y+yB, yTop:c.y, ex:0, ez:CELL });
      // 🔧 레버(막장) → 보스문 개방(지상 임시 레버 대체) — lowerSpec(2층 그리드) 경로 전용(HANDCRAFT.small 아님)
      if(low.leverIdx!=null && low.rooms[low.leverIdx]){ const dr=low.rooms[low.leverIdx]; const lvx=offX+CClow(dr.cx), lvz=offZ+CClow(dr.cz);
        const lev=buildLever(); lev.position.set(lvx, yB, lvz); root.add(lev);
        leverInfo={ x:c.x+lvx, z:c.z+lvz, mesh:lev, pulled:false }; }
      // 지하 앰비언트(더 깊고 차가운 미광 — 완전 암전만 방지)
      const ldim=new THREE.PointLight(0x33465e, 0.5, lowG*CELL, 2.2); ldim.position.set(0, ROWS*WALL_H-1.5, 0); low2.add(ldim);
      // 충돌 등록(지하 자체 — 상층 등록과 별개)
      root.updateWorldMatrix(true,true);
      if(ctx.terrain && ctx.terrain.addTrimeshMesh){
        loFloor2.traverse(o=>ctx.terrain.addTrimeshMesh(o,root));
        loSolid2.traverse(o=>ctx.terrain.addTrimeshMesh(o,root));
        loProps2.traverse(o=>{ if(o.isMesh && !(o.material && o.material.blending===THREE.AdditiveBlending)) ctx.terrain.addTrimeshMesh(o,root); });
        lad.traverse(o=>ctx.terrain.addTrimeshMesh(o,root));
      }
      if(ctx.terrain && ctx.terrain.collide) ctx.terrain.collide.push(loFloor2);
      lowerGrid = { low2, loFloor2, yB };
      console.log('[dungeonrun] 지하 그리드 — 방 '+low.rooms.length+' · 벽 '+lwe.length+' · 문 '+lde.length+' · 몹슬롯 '+low.rooms.reduce((a,r)=>a,0)+' @yB'+yB);
    }
    // ★프리워밍(사령관 "보스 죽을 때 갑자기 멈춤") — 출구 포탈(buildPortal)이 invisible로 시작해 클리어 시 처음 visible=true 되는 순간
    //   ShaderMaterial(소용돌이 fbm)이 첫 렌더에서 GPU 컴파일돼 그 프레임에 멈칫함(campfire/cannon/mine과 동일 클래스 버그).
    //   던전 입장 로딩(이미 로딩 중인 타이밍)에 한 번에 컴파일해 보스 처치 순간의 히칫을 제거.
    try{ if(ctx.renderer && ctx.camera) ctx.renderer.compile(ctx.scene, ctx.camera); }catch(e){ console.warn('[dungeonrun] portal prewarm', e && e.message); }
    console.log('[dungeonrun] 던전 생성 — 방 ' + lay.rooms.length + ' · 벽 ' + lay.wallEdges.length + '×' + ROWS
      + ' · 문 ' + lay.doorEdges.length + ' · 기둥 ' + nPillar + ' · 횃불 ' + torchSpots.length + '(광원풀 ' + TORCH_POOL + ')'
      + ' · 스파이크 ' + trapSpots.length + ' · 불함정 ' + fireTraps.length + ' · 불의통로 ' + (gauntFire?gauntFire.jets.length:0)
      + ' · 하층광맥 ' + (lower?lower.oreRefs.length:0) + ' · 천장 O · CELL ' + CELL);
    return { entry: { x: ex, z: ez, yaw: entryYaw }, mobSpots: spots, bossSpot, trapSpots, fireTraps, gauntFire, lower, dgChests,
      bossDoor: { owner: bossDoorOwner, meshes: bossDoorMeshes },
      shortcutDoor: { owner: shortcutDoorOwner, meshes: shortcutMeshes },
      alcoveDoor: { owner: alcoveDoorOwner, meshes: alcoveMeshes },
      lever: leverInfo, elevator: elevatorInfo, bossBounds, lavaPits, cascade: cascadeResult,
      hallFx: hallResult ? hallResult.lavaCrackU : null,
      exitR: shellR + 20 };   // ★외부 이탈 판정 반경 — 쉘보다 20 더 여유(쉘 안쪽 끝까지는 정상 플레이 영역)
  }

  function disposeArena(){
    if(!root) return;
    try{ if(ctx.terrain && ctx.terrain.removeTrimesh) ctx.terrain.removeTrimesh(root); }catch(_){}
    try{ const cl = ctx.terrain && ctx.terrain.collide; if(cl){ const i = cl.indexOf(floorGrp); if(i >= 0) cl.splice(i, 1); } }catch(_){}
    try{ ctx.scene.remove(root); }catch(_){}
    // 지오메트리/재질 dispose — 반복 입장 GPU 누수 방지.
    // ★D4b: KayKit 클론은 프로토타입과 geometry/material 공유(_kaykitShared) → dispose 제외(세션 캐시 상수 메모리).
    //   던전 전용 생성물(불꽃/포탈 링·글로우)만 파괴. clone 노드 자체는 씬 제거로 GC.
    try{ root.traverse(o => { if(o.isMesh && !o.userData._kaykitShared){
      o.geometry && o.geometry.dispose && o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if(m && m.dispose) m.dispose(); }); } }); }catch(_){}
    root = null; floorGrp = null; portal = null; torches = []; hallTorches = []; torchSpots = []; torchPool = [];
  }

  // ── 오버월드 몹 동결/복원 — "그대로 멈춤"이 목표: 배열에서 빼면 tick이 안 돌아 hp/위치/어그로 전부 보존 ──
  function freezeOverworldMobs(){
    frozen.length = 0;
    if(!ctx.monsters) return;
    for(let i=ctx.monsters.length-1;i>=0;i--){ const mn=ctx.monsters[i];
      if(mn.dead) continue;                      // 사망 진행 중(시체)은 남겨 자연 소거
      ctx.monsters.splice(i,1);
      try{ ctx.ai && ctx.ai.tokenRelease && ctx.ai.tokenRelease(mn); }catch(_){}
      try{ ctx.scene.remove(mn.grp); }catch(_){}
      frozen.push(mn); }
    if(frozen.length) console.log('[dungeonrun] 오버월드 몹', frozen.length, '마리 동결(복귀 시 원상복귀)');
  }
  function unfreezeOverworldMobs(){
    if(!frozen.length) return;
    for(const mn of frozen){ try{ ctx.scene.add(mn.grp); }catch(_){} if(ctx.monsters) ctx.monsters.push(mn); }
    console.log('[dungeonrun] 오버월드 몹', frozen.length, '마리 복귀');
    frozen.length = 0;
  }

  // ── enter(isl): 오버월드 저장 → (조각 로드 대기) → 던전 빌드 → 텔레포트 → 웨이브 예약 ──
  //   ★D4b: GLTF 로드는 비동기 — 스냅샷/동결/일시정지는 즉시, 텔레포트·스폰은 전 조각 로드 완료 후.
  //   (부분 로드 상태로 플레이어를 허공에 던지지 않음. 로드 중 center=null → 업데이트 루프 대기.)
  function enter(isl){
    if(active) return false;
    if(!ctx.player || !ctx.terrain || !ctx.spawnMonster || !ctx.scene){ toast('던전을 열 수 없습니다 — 시스템이 준비되지 않았습니다'); return false; }
    if(ctx.combat && ctx.combat.isDead && ctx.combat.isDead()) return false;
    const pp = ctx.player.pos;
    // ① 복귀 스냅샷(정확 복원용) — 위치/시점/조타/습격 게이트
    saved = {
      pos:{ x:pp.x, y:pp.y, z:pp.z },
      yaw:(ctx.player.yaw||0), pitch:(ctx.player.pitch||0),
      boarded: !!(ctx.ship && ctx.ship.boarded),
      raidEnabled: (ctx.raid && ctx.raid.status) ? !!ctx.raid.status().enabled : null,
      islName: (isl && isl.name) || null,
    };
    if(ctx.ship) ctx.ship.boarded = false;                       // 조타 스냅백 방지(reviveAtHarbor 관례)
    if(ctx.raid && ctx.raid.setEnabled) ctx.raid.setEnabled(false);   // ② 습격 일시정지(타이머 동결, exit 시 복원)
    freezeOverworldMobs();                                       // ③ 오버월드 몹 동결
    // ④ 던전 좌표(수평 +380/+380 · 수직 +240 — 오버월드 지형/스트리밍과 안 겹치는 상공 폐쇄 공간)
    const cy = Math.min(500, Math.max(0, pp.y) + OFF_Y);          // 상한 500 — 몹 스폰 groundAt(fromY=600)보다 반드시 아래
    const target = { x: pp.x + OFF_XZ, y: cy, z: pp.z + OFF_XZ };
    center = null;                                               // 빌드 완료 전 루프 무동작(사망 감시는 유지)
    cleared = false; active = true;
    pending = []; expected = 0; waitT = 0; seenMobs.clear(); tag = null;
    bossPhase = false; bossSpawned = false; bossRef = null; bossSpot = null; bossKey = null;   // ★보스 상태 리셋
    trapSpots = []; trapCd = 0; fireTraps = []; fireCd = 0; gauntFire = null; lower = null; onLower = false; dgChests = []; _chestEPrev = false;   // ★함정·불의통로·2층·상자 리셋
    try{ if(_chestDlg) _chestDlg.dispose(); }catch(_){} _chestDlg = null;   // ★상자 대화창 열린 채 퇴장 시 화면 잔존 방지
    bossDoor = null; shortcutDoor = null; alcoveDoor = null; lever = null; elevator = null; bossBounds = null; bossDoorOpen = false; _leverEPrev = false; _elevEPrev = false;   // ★레버/보스문/숏컷/봉인방/엘리베이터 리셋
    elevRiding = false; elevT = 0; hallFx = null; alcoveDebris = null;
    lavaPits = [];   // 🌋 용암 지대 리셋(메시/셰이더 dispose는 disposeArena가 root 통째로 처리)
    bossEnter = null; _gateEPrev = false;
    bossGateFx = null;   // 🚪 게이트 리셋(재입장 시 옛 믹서를 계속 굴리면 안 된다)
    cascade = null;   // 🏔️ 폭포 대홀 리셋 — 재입장 때 옛 런의 셰이더/믹서를 계속 굴리면 안 된다
    // ★어두운 던전 무드 — 씬 fog/배경을 어둡게 스왑(복원용 스냅샷). 조명(sun/hemi/amb/fill)은 루프에서 매 프레임 하향(sky 이후 실행이라 이김).
    moodSaved = { fog: ctx.scene.fog, bg: ctx.scene.background };
    ctx.scene.fog = dungeonFog;
    if(ctx.scene.background && ctx.scene.background.isColor) ctx.scene.background = new THREE.Color(0x05060a);
    // 포인터락은 버튼 클릭 제스처 안에서(동기) 요청 — await 뒤엔 제스처 소실
    try{ ctx.renderer && ctx.renderer.domElement && ctx.renderer.domElement.requestPointerLock && ctx.renderer.domElement.requestPointerLock(); }catch(_){}
    const myRun = ++runSeq;
    refreshTier(); dcfg = BAL.dungeon.get(tier);                 // ★티어 config 확정(몹수·함정·보상·광물·규모)
    Promise.all([loadKit(), loadBossGate()]).then(([kit, gate]) => {
      if(!active || myRun !== runSeq) return;                    // 로드 중 사망/[O] 이탈/재입장 — 뒤늦은 빌드 폐기
      const info = buildDungeon(kit, target, dcfg, gate);
      center = target;
      // ⑤ 플레이어 입장(입구 방 중앙, 던전 안쪽을 바라봄)
      ctx.player.setSpawn(info.entry.x, center.y + 1.6, info.entry.z);
      if(ctx.player.setYaw) ctx.player.setYaw(info.entry.yaw);
      if(ctx.player.setPitch) ctx.player.setPitch(0);
      // ⑥ 웨이브 예약 — 레벨 티어 매칭 풀(gates SSOT), 6~10마리, 간격 스폰(히칫 분산).
      //    ★D4b: 스폰 위치=입구 제외 방들에 분산(깊은 방부터 순환). 배회(wander)로 방을 지키다 접근 시 교전.
      const pool = pickPool();
      expected = dcfg.mobs;   // ★티어별 잡몹 수(BAL.dungeon) — 전멸 후 보스 등장
      pending = []; seenMobs.clear(); tag = { dg:true, t:Date.now() };   // 런별 유니크 태그(mn._outpostTag)
      for(let i=0;i<expected;i++){
        const sp = info.mobSpots[i % info.mobSpots.length];
        // ★잡몹 수 > 마커 수면 같은 마커를 다시 쓴다 — 좌표가 완전히 겹쳐 한 자리에 포개지므로 2바퀴째부터 흩뿌린다.
        const lap = (i / info.mobSpots.length) | 0;
        const jx = lap ? (Math.random() - 0.5) * 3.2 : 0, jz = lap ? (Math.random() - 0.5) * 3.2 : 0;
        pending.push({ x: sp.x + jx, z: sp.z + jz, r: sp.r, y: sp.y, k: pool[(Math.random()*pool.length)|0] });   // ★y=로컬 깊이(큰 홀처럼 floorGrp 밖 스폰 시 groundAt이 못 찾아 1층으로 오폴백하는 것 보정)
        try{ ctx.preloadMonster && ctx.preloadMonster(pending[i].k); }catch(_){}
      }
      // ★보스/함정 정보 확보 + 보스 모델 프리로드(잡몹 처치 동안 미리 로드)
      bossSpot = info.bossSpot; trapSpots = info.trapSpots || []; fireTraps = info.fireTraps || []; bossKey = pickBossKey();
      gauntFire = info.gauntFire || null;   // ★불의 통로
      lower = info.lower || null; onLower = false; transferCd = 0;   // ★2층 정보
      dgChests = info.dgChests || []; _chestEPrev = false; _chestDlg = null;   // ★상자 [E]
      bossDoor = info.bossDoor || null; shortcutDoor = info.shortcutDoor || null; alcoveDoor = info.alcoveDoor || null; lever = info.lever || null; elevator = info.elevator || null; bossBounds = info.bossBounds || null; bossDoorOpen = false; _leverEPrev = false; _elevEPrev = false;   // ★[3] 레버/보스문/숏컷/봉인방 + [4] 엘리베이터
      elevRiding = false; elevT = 0; hallFx = info.hallFx || null;
      dgExitR = info.exitR || 150;   // ★그리드 크기별 외부 이탈 반경(고정 150이면 대형 던전서 정상 플레이 중에도 오발동)
      lavaPits = info.lavaPits || [];   // 🌋 용암 지대들(있는 흐름에만)
      cascade = info.cascade || null;   // 🏔️ 폭포 대홀(지하 2층)
      try{ ctx.__dgLower = lower; ctx.__dgGaunt = gauntFire; ctx.__dgBoss = { lx: lever?lever.x:null, lz: lever?lever.z:null, bb: bossBounds, get open(){ return bossDoorOpen; } }; }catch(_){}   // (디버그) 검증용
      try{ ctx.__dgHall = { center: { x:center.x, y:center.y, z:center.z }, lever: lever?{x:lever.x,z:lever.z}:null, elevator: elevator?{x:elevator.x,z:elevator.z, rideTo:elevator.rideTo}:null, mobSpots: (info.mobSpots||[]).map(s=>({x:s.x,z:s.z,y:s.y})) }; }catch(_){}   // (디버그) 지하 검증 — 레버/엘리베이터/스폰 월드좌표
      try{ ctx.preloadMonster && ctx.preloadMonster(bossKey); }catch(_){}
      spawnT = 1.2; waitT = 0;
      // ★2026-07-22 BGM 재구성(사령관 확정) — 기본=dnd1/dnd2 앰비언트 순환 · 시네마틱=bgm_cave('The Deep Below') · 전환=지하 도달 순간.
      //   전엔 입장하자마자 'dungeon'을 force로 걸어서 그 곡 1회 재생 뒤 영영 무음이었다(사령관 "던전 노래도 계속 나오는 게 아니라").
      //   여기선 force를 풀어 sound.js의 기본 앰비언트 순환에 맡기고, 시네마틱은 아래 deepCue()가 한 번만 건다.
      deepCued = false;
      try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.set(null); }catch(_){}
      // 🏷️ 입장 알림 = **지역 진입 배너**(uikit locationReveal, worldstream 섬 진입과 같은 UI).
      //   ⛔구 토스트 폐기 사유 2가지(사령관 2026-07-24): ①이모지 금지 ②"몬스터를 처치하면 우두머리가 나타납니다"는
      //     **구정보** — 레버·잡몹 전멸 조건은 폐기됐고 지금은 대전당 보스 게이트 [E]로 직접 들어간다.
      //   장소 진입은 토스트(정보 전달)가 아니라 배너(장소 각인)가 정본 UI다.
      try{ ukLocation({ name:'광산 던전', band: tier + '단계 갱도' }); }catch(_){}
      console.log('[dungeonrun] 입장 — tier'+tier, '잡몹', expected, '· 보스', bossKey, '· 함정', trapSpots.length, '@', target.x.toFixed(0), target.y.toFixed(0), target.z.toFixed(0));
    }).catch(e => {
      console.warn('[dungeonrun] KayKit 조각 로드 실패 — 입장 취소', e && e.message);
      if(active && myRun === runSeq) exit({ teleport:false, silent:true });   // 플레이어는 이동 전 — 위치 복원 불필요
      toast('던전 생성에 실패했습니다 — 잠시 후 다시 시도해 주세요', { accent:'red', ms:4200 });
    });
    return true;
  }

  // ── 클리어: 보상(골드+영혼+XP+광물) + 출구 포탈 활성 ──
  function doClear(){
    if(cleared) return; cleared = true;
    const R = (dcfg && dcfg.reward) ? dcfg.reward : { gold:80*tier, soul:4*tier, xp:25*tier };   // ★티어별 클리어 보상(BAL.dungeon)
    const gold = R.gold + ((Math.random()*40)|0);
    const soul = R.soul, xp = R.xp;
    if(ctx.inventory && ctx.inventory.addGold) ctx.inventory.addGold(gold);
    if(ctx.combat && ctx.combat.addSoul) ctx.combat.addSoul(soul);
    if(ctx.combat && ctx.combat.addXp) ctx.combat.addXp(xp);
    // 희귀 광물(개인 인벤, 무게 초과 시 해당 광물만 미지급) — 티어별 드롭(BAL.dungeon.drop) · id=inventory.MATERIALS SSOT
    const ores = (dcfg && dcfg.drop) ? dcfg.drop : [['iron', 1+tier], ['copper', 1+(tier>>1)]];
    const got = [];
    for(const [id,n] of ores){ if(ctx.inventory && ctx.inventory.add && ctx.inventory.add(id, n)) got.push(((MATERIALS[id]&&MATERIALS[id].name)||id)+' ×'+n); }
    if(portal){ if(portal.userData.disc) portal.userData.disc.visible = true; if(portal.userData.pts) portal.userData.pts.visible = true;
      if(portal.userData.light) portal.userData.light.intensity = 12; }   // ★그룹 자체는 항상 visible(조명 카운트 고정용) — 원반·파티클만 여기서 켬
    if(ctx.updHotbar) ctx.updHotbar();
    updHud(0);
    toast('광산 던전 클리어!', { accent:'gold', ms:5200, emphasis:true,
      speaker:'금화 +'+gold+' · 영혼 +'+soul+' · 경험치 +'+xp+(got.length?(' · '+got.join(' · ')):'') });
    // 🌀 석판 조각 — 이 던전 등급의 조각을 드롭(사령관 확정 2026-08-07: **밤 던전이 조각의 유일한 공급원**).
    //   4개 모으면 같은 등급 차원문 석판이 되어, 밤을 기다리지 않고 그 등급에 재도전할 수 있다.
    try{
      const GS = BAL.gateSlab || { shardsPerSlab:4, shardDrop:1, shardDropBonus:0.35 };
      const sid = 'shard' + Math.max(1, Math.min(5, tier|0 || 1));
      let n = GS.shardDrop|0; if(Math.random() < GS.shardDropBonus) n++;
      if(n>0 && ctx.inventory && ctx.inventory.add && ctx.inventory.add(sid, n)){
        const nm = (MATERIALS[sid]&&MATERIALS[sid].name)||sid;
        const have = ctx.inventory.count(sid);
        toast(`${nm} ×${n} 획득 — ${have}/${GS.shardsPerSlab}`, { accent:'cyan', ms:4200,
          speaker: have>=GS.shardsPerSlab ? '석판을 제작할 수 있습니다 ([제작] → [차원문])' : '4개를 모으면 차원문 석판이 됩니다' });
      }
    }catch(e){ console.warn('[dungeonrun] 석판 조각 드롭', e && e.message); }
    toast('출구 포탈이 열렸습니다 — 보물방의 초록 포탈에 다가가면 지상으로 복귀합니다', { accent:'cyan', ms:4600 });
    // 🗡️ 던전 정복의 전리품 = 이번 런에서 쓰러뜨린 몹 중 최강 1종이 굴복해 용병으로 합류(mercenary.js).
    //   보스는 제외(처치 대상). 실패해도 클리어 보상에는 영향 없음 — 조용히 넘어간다.
    try{ if(ctx.mercenary && ctx.mercenary.captureFrom) ctx.mercenary.captureFrom([...seenMobs], tier); }
    catch(e){ console.warn('[dungeonrun] 용병 영입', e && e.message); }
    console.log('[dungeonrun] 클리어 — 금화+'+gold, '영혼+'+soul, 'XP+'+xp, got.join(','));
  }

  // ── exit(opts): 던전 정리 + 오버월드 정확 복원. opts.teleport=false → 위치 복원 생략(사망/외부 이탈) ──
  function exit(opts){
    opts = opts || {};
    if(!active) return false;
    active = false; pending = [];
    // 잔여 던전 몹 정리(포기/사망 이탈 — 시체 포함 전부)
    if(ctx.monsters && tag){ for(let i=ctx.monsters.length-1;i>=0;i--){ const mn=ctx.monsters[i];
      if(mn._outpostTag !== tag) continue;
      ctx.monsters.splice(i,1);
      try{ ctx.ai && ctx.ai.tokenRelease && ctx.ai.tokenRelease(mn); }catch(_){}
      try{ ctx.scene.remove(mn.grp); }catch(_){} } }
    seenMobs.clear(); tag = null;
    // ★2층 정리 — 광맥 해제 + 하층 바닥 collide 제거 + 트랩도어 콜라이더/사다리 등록/파편 정리
    if(lower){
      try{ if(ctx.mine && ctx.mine.unregisterNode) for(const R of lower.oreRefs){ ctx.mine.unregisterNode(R.srcMesh || R.obj); } }catch(_){}
      try{ const cl = ctx.terrain && ctx.terrain.collide; if(cl && lower.loFloor){ const i = cl.indexOf(lower.loFloor); if(i>=0) cl.splice(i,1); } }catch(_){}
      try{ if(!lower.sprung && ctx.terrain && ctx.terrain.removeTrimesh && lower.trapOwner) ctx.terrain.removeTrimesh(lower.trapOwner); }catch(_){}
      try{ if(ctx.ladders && lower.ladWorld){ const i = ctx.ladders.indexOf(lower.ladWorld); if(i>=0) ctx.ladders.splice(i,1); } }catch(_){}
      try{ if(lower.debris) for(const d of lower.debris){ if(d.m){ ctx.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); } } }catch(_){}
    }
    lower = null; onLower = false;
    // ★잠긴 보스문/숏컷 게이트 콜라이더 해제(레버로 안 열렸으면 — 둘 다 bossDoorOpen 한 플래그를 공유)
    try{ if(bossDoor && !bossDoorOpen && ctx.terrain && ctx.terrain.removeTrimesh && bossDoor.owner) ctx.terrain.removeTrimesh(bossDoor.owner); }catch(_){}
    try{ if(shortcutDoor && !bossDoorOpen && ctx.terrain && ctx.terrain.removeTrimesh && shortcutDoor.owner) ctx.terrain.removeTrimesh(shortcutDoor.owner); }catch(_){}
    bossDoor = null; shortcutDoor = null; lever = null; elevator = null; bossBounds = null; bossDoorOpen = false;
    elevRiding = false; elevT = 0; hallFx = null;
    disposeArena();                                              // geometry/material/light 정리(반복 입장 누수 금지)
    unfreezeOverworldMobs();                                     // 오버월드 몹 원상복귀
    if(ctx.raid && ctx.raid.setEnabled && saved && saved.raidEnabled!=null) ctx.raid.setEnabled(saved.raidEnabled);
    if(opts.teleport !== false && saved && ctx.player && ctx.player.setSpawn){
      ctx.player.setSpawn(saved.pos.x, saved.pos.y + 0.3, saved.pos.z);   // 입장 지점 정확 복귀(+0.3 안착 여유)
      if(ctx.player.setYaw) ctx.player.setYaw(saved.yaw);
      if(ctx.player.setPitch) ctx.player.setPitch(saved.pitch);
      // boarded는 복원하지 않음 — 복원 시 매 프레임 헬름 스냅으로 위치 복귀가 무효화됨(reviveAtHarbor와 동일 판단).
      //   배는 정박 상태 그대로이므로, 갑판 위에서 입장했다면 같은 갑판 좌표로 돌아간다.
      if(opts.silent !== true) toast('지상으로 복귀했습니다', { accent:'cyan', ms:2600 });
    }
    try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.set(null); }catch(_){}
    // ★어두운 무드 복원 — 오버월드 fog/배경 되돌림(조명은 sky가 다음 프레임에 시간대로 자동 복원)
    if(moodSaved){ try{ ctx.scene.fog = moodSaved.fog; if(moodSaved.bg) ctx.scene.background = moodSaved.bg; }catch(_){} moodSaved = null; }
    hud.style.display = 'none';
    saved = null; center = null;
    console.log('[dungeonrun] 퇴장 — 오버월드 복원 완료');
    return true;
  }

  // ── 보스 등장(잡몹 전멸 후 1회) — 등급별 우버몹 boss:true → monsters.js 스탯 승격 + combat.js 상단 체력바 자동 ──
  function spawnBoss(){
    if(bossSpawned) return; bossSpawned = true; bossPhase = true;
    const s = bossSpot || { x: center.x, z: center.z, r: 1 };
    // ★atY 에 보스방 깊이(s.y)를 더한다 — 11차에서 보스방이 지하 -20으로 내려가, 안 하면 보스가 지상에 스폰된다.
    try{ ctx.spawnMonster({ k: bossKey, at:{ x:s.x, z:s.z }, atR:s.r||1, atY: center.y + (s.y || 0), fixedY: !!s.y, ignoreMax:true, aggro:true, boss:true,
      visualScaleMul:dcfg.boss.visualScaleMul,bossHpTarget:dcfg.boss.hpTarget,bossAtkTarget:dcfg.boss.atkTarget,xpReward:dcfg.boss.killXp,soulReward:dcfg.boss.killSoul,dgBoss:true,auraColor: bossColor(), tag }); }
    catch(e){ console.warn('[dungeonrun] 보스 스폰 실패', e && e.message); }
    // ★프리워밍(사령관 "보스 죽을 때 멈춤" 재확인 — WebGL linkProgram 계측으로 실측: 죽는 순간 신규 셰이더 프로그램 다수 컴파일로 5~6초 히칫).
    //   applyBossAura(monsters.js)가 붙이는 오라 ShaderMaterial(_cyc×3+_swirl×2)은 몹 템플릿 프리로드(preloadMonster)가 커버 못함 —
    //   템플릿엔 없고 매 스폰마다 새로 만들어지는 인스턴스 전용 머티리얼이라, 지금까지 첫 렌더(=대개 사망 직후 프레임)에서야 컴파일됐음.
    //   스폰 직후(전투 시작 전) 한 번 강제 컴파일해 히칫을 죽는 순간에서 등장 순간으로 이동.
    try{ if(ctx.renderer && ctx.camera) ctx.renderer.compile(ctx.scene, ctx.camera); }catch(e){ console.warn('[dungeonrun] boss aura prewarm', e && e.message); }
    // ★2026-07-22 — 보스 등장 = 전투곡(사령관 확정 배치도의 마지막 칸). once로 걸어 곡이 끝나면 기본 앰비언트로 복귀한다
    //   (set으로 걸면 loop=false + force 잔류 때문에 곡이 끝난 뒤 던전 내내 무음이 됐다).
    try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.once && ctx.sound.bgm.once('battle'); }catch(_){}
    toast('우두머리가 나타났다', { accent:'red', ms:4600, emphasis:true, speaker:'광산 던전' });
    console.log('[dungeonrun] 보스 등장 —', bossKey);
  }

  // ── 함정 발동(미끼 상자 [E]) — 트랩도어 콜라이더 제거 + 파편(와르르) + 하층 드롭인 + 붕괴 사운드 ──
  function springTrap(){
    if(!lower || lower.sprung) return; lower.sprung = true;
    const t = lower.trapWorld;
    try{ if(ctx.terrain && ctx.terrain.removeTrimesh && lower.trapOwner) ctx.terrain.removeTrimesh(lower.trapOwner); }catch(_){}
    try{ if(lower.weak) lower.weak.visible = false; }catch(_){}
    try{ if(lower.baitChest) lower.baitChest.visible = false; }catch(_){}
    try{ ctx.player.setSpawn(t.x, center.y - lower.drop + 1.3, t.z); }catch(_){}   // KCC 자유낙하 한계 → 하층 드롭인(붕괴 연출이 낙하감)
    const dbg = [];
    for(let i=0;i<8;i++){ const s = 0.3 + Math.random()*0.45;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s*0.4, s), new THREE.MeshStandardMaterial({ color:0x5a3a1e, roughness:0.9, transparent:true }));
      m.position.set(t.x + (Math.random()-0.5)*2.2, center.y + 0.1, t.z + (Math.random()-0.5)*2.2); ctx.scene.add(m);
      dbg.push({ m, vx:(Math.random()-0.5)*2.4, vy:-1-Math.random()*2, vz:(Math.random()-0.5)*2.4, rx:(Math.random()-0.5)*7, rz:(Math.random()-0.5)*7, life:2.2 }); }
    lower.debris = dbg;
    try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/crash.mp3', 0.7); }catch(_){}
    toast('바닥이 무너진다!', { accent:'red', ms:2400 });
  }

  // ── 메인 루프: 스폰 페이싱 · 생존 집계 · 클리어/출구/사망/이탈 판정 · 횃불 플리커 ──
  ctx.onUpdate((dt)=>{
    if(!active) return;
    dt = dt || 0.016;
    // 사망 → 즉시 던전 정리(게임오버 화면 위, reviveAtHarbor가 위치를 처리 — 지하 데드락 금지)
    if(ctx.combat && ctx.combat.isDead && ctx.combat.isDead()){ exit({ teleport:false,reason:'player_defeated' }); return; }
    const pp = ctx.player && ctx.player.pos; if(!pp || !center) return;   // center=null → 조각 로드 대기 중
    // ★어두운 던전 무드 유지 — sky.js가 매 프레임 조명/fog/배경을 시간대로 세팅하므로, 던전 루프(초기화 순서상 sky 뒤)가
    //   매 프레임 덮어써 이긴다(초기화: initSky→initDungeonRun). 횃불 PointLight가 주광원이 되도록 전역광 대폭 하향.
    // ★2026-07-17 재조정(사령관 "전체적으로 너무 어두움") — 2026-07-16엔 반대로 "바닥 너무 잘 보임"이라 극단적으로 낮췄던 값.
    //   전역광을 완전히 죽이는 대신 횃불이 여전히 주광원인 선에서 소폭 상향(코너/복도 암전 완화). 제안값 — 실플레이 재확인 필요.
    // ★2026-07-20 재조정(사령관 "던전인데 너무 밝다 — 횃불이 주광원이어야") — 앰비언트는 다시 낮춰 어두운 무드 복원.
    //   대신 "길이 안 보이던" 문제는 밝기가 아니라 (1)하강 입구가 벽에 막혀 있던 것 (2)입구에 횃불이 없던 것이 원인이라 그쪽을 수정함(descentMouth 개통+상시 횃불).
    if(ctx.sun)  ctx.sun.intensity  = 0.10;
    if(ctx.hemi) ctx.hemi.intensity = 0.13;
    if(ctx.amb)  ctx.amb.intensity  = 0.06;
    if(ctx.fill) ctx.fill.intensity = 0.0;
    if(ctx.scene.fog !== dungeonFog) ctx.scene.fog = dungeonFog;
    dungeonFog.color.setHex(0x05060a); dungeonFog.near = 5; dungeonFog.far = 44;   // 어두운 무드(횃불 주광원). 횃불 base·도달반경(42)·접근점등으로 통로를 밝힌다.
    if(ctx.scene.background && ctx.scene.background.isColor) ctx.scene.background.setHex(0x05060a);
    // 외부 이탈(메뉴 '근처 섬 복귀' 등 타 시스템 텔레포트) → 위치는 두고 던전만 정리
    if(Math.hypot(pp.x-center.x, pp.z-center.z) > dgExitR){ exit({ teleport:false, silent:true }); return; }
    // 던전 밖 추락(비정상 탈출) → 입장 지점으로 안전 복귀. ★하층(−DROP) 있으면 그만큼 아래까지 허용(하층에서 지상복귀 오발동 방지).
    const _fallLim = lower ? (center.y - (lower.maxDepth || lower.drop) - 16) : (center.y - 40);   // ★경사 통로 최심부까지 여유(2026-07-17)
    if(pp.y < _fallLim){ exit({ teleport:true }); return; }
    // 스폰 페이싱 — ★D4b: 방 중심 스캐터(atR) + 배회(wander, 홈=자기 방). groundAt 게이트가 타일 밖 재시도 차단.
    if(pending.length){ spawnT -= dt;
      if(spawnT <= 0){ spawnT = SPAWN_GAP; const s = pending.shift();
        try{ ctx.spawnMonster({ k:s.k, at:{ x:s.x, z:s.z }, atR:s.r, atY: s.y!=null ? center.y+s.y : center.y, fixedY: s.y!=null && s.y<0, ignoreMax:true,
          wander:true, home:{ x:s.x, z:s.z, r:s.r }, tag }); }   // ★fixedY: 지하 스폰(s.y<0)은 groundAt 우회(지상 오폴백 방지)
        catch(e){ console.warn('[dungeonrun] 스폰 실패', e && e.message); } } }
    // 생존 집계(스폰은 비동기 로드 — 실제 등장분만 집계)
    let alive = 0;
    if(ctx.monsters && tag){
      for(const mn of ctx.monsters){ if(mn._outpostTag === tag && !seenMobs.has(mn)) seenMobs.add(mn); }
      for(const mn of seenMobs){ if(!mn.dead && ctx.monsters.indexOf(mn) >= 0) alive++; }
    }
    // ★함정(압력판 스파이크) — 밟으면 솟음(telegraph) → 잠깐 나옴 → 들어감 → 쿨다운. 우회 3방식:
    //   ①점프로 넘기(공중=피해 없음) ②옆 레인(offset 반대쪽=트리거/피해 반경 밖) ③솟은 뒤 벗어나기.
    if(trapSpots.length){ trapCd -= dt;
      const feetY = (pp.y || 0) - center.y;                    // 바닥 대비 발 높이(점프 판정)
      const grounded = (ctx.player && ctx.player.onGround != null) ? ctx.player.onGround : (feetY < 0.6);
      for(const t of trapSpots){
        const dxz = Math.hypot(pp.x - t.x, pp.z - t.z);
        const my = t.mesh ? t.mesh.position : null;
        // ── 타이머형: 자동으로 솟았다 들어감(주기 2.4s, ~45% 솟음). 타이밍 맞춰 통과 ──
        if(t.mode === 'timed'){
          t.phase += dt; const p = (t.phase % 2.4) / 2.4; const up = p < 0.45;
          if(up && !t._snd){ t._snd = true; const d = Math.hypot(pp.x-t.x, pp.z-t.z); if(d < 20){ try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/가시함정.mp3', Math.max(0.12, 0.5*(1-d/20))); }catch(_){} } }
          else if(!up) t._snd = false;
          if(my) my.y += ((up ? t.upY : t.downY) - my.y) * Math.min(1, dt * 12);
          if(up && my && my.y > t.upY - 0.15 && dxz < t.r && grounded && (feetY - (t.baseY || 0)) < t.spikeH * 0.7 && trapCd <= 0){
            try{ ctx.combat && ctx.combat.envHurt && ctx.combat.envHurt(dcfg.traps.minorDamage, 'fire'); }catch(_){}
            trapCd = 0.7;
          }
          continue;
        }
        // ── 압력판형: 밟으면 솟음 ──
        if(t.state === 'idle'){
          if(my) my.y += (t.downY - my.y) * Math.min(1, dt * 10);
          if(dxz < t.triggerR && grounded){ t.state = 'rising'; t.t = 0;   // ★밟으면(압력) 발동
            const d = Math.hypot(pp.x-t.x, pp.z-t.z); if(d < 20){ try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/가시함정.mp3', Math.max(0.12, 0.5*(1-d/20))); }catch(_){} } }
        } else if(t.state === 'rising'){
          t.t += dt; if(my) my.y += (t.upY - my.y) * Math.min(1, dt * 16);    // 빠르게 솟음(telegraph ~0.2s)
          if(!my || my.y > t.upY - 0.05){ t.state = 'up'; t.t = 0; }
        } else if(t.state === 'up'){
          t.t += dt; if(my) my.y = t.upY;
          // 피해: 위(damageR) + 바닥 근처(점프로 안 넘음) + 쿨다운. 공중이거나 옆 레인이면 안 맞음.
          if(dxz < t.r && grounded && (feetY - (t.baseY || 0)) < t.spikeH * 0.7 && trapCd <= 0){
            try{ ctx.combat && ctx.combat.envHurt && ctx.combat.envHurt(dcfg.traps.minorDamage, 'fire'); }catch(_){}
            trapCd = 0.7;
          }
          if(t.t > 1.1){ t.state = 'retract'; t.t = 0; }
        } else if(t.state === 'retract'){
          t.t += dt; if(my) my.y += (t.downY - my.y) * Math.min(1, dt * 8);
          if(t.t > 0.6){ t.state = 'cooldown'; t.t = 0; }
        } else {   // cooldown — 트리거 반경 밖으로 나가야 재무장(제자리 연타 방지)
          t.t += dt; if(t.t > 0.7 && dxz > t.triggerR) t.state = 'idle';
        }
      }
    }
    // ★불 함정(화염 제트) — 주기(5s): 꺼짐→경고→화르르(피해)→사그라듦. 꺼졌을 때 통과, 뿜을 때 화염 경로 피해.
    if(fireTraps.length){ fireCd -= dt; const P = 5.0;
      for(const f of fireTraps){
        f.phase += dt; const p = (f.phase % P) / P;
        // k(세기): 0~0.6 꺼짐 · 0.6~0.72 경고(약) · 0.72~0.92 최대(피해) · 0.92~1 사그라듦
        let k = 0, dmgOn = false;
        if(p < 0.6) k = 0;
        else if(p < 0.72) k = (p - 0.6) / 0.12 * 0.35;                 // 경고 글로우(피해 없음)
        else if(p < 0.92){ k = 1; dmgOn = true; }                     // 최대 분출 + 피해
        else k = 1 - (p - 0.92) / 0.08;                               // 사그라듦
        if(f.grp && f.grp.userData.update) f.grp.userData.update(k, dt);
        if(f.emitter && f.emitter.userData.setHot) f.emitter.userData.setHot(k);   // 주둥이 달아오름
        if(f.light) f.light.intensity = 16 * k * (0.8 + 0.2 * Math.sin(flickerT * 26));
        // ★화염 분출음(엣지 1회, 거리 볼륨) — 드래곤 브레스 음원 재사용(사령관 힌트)
        if(dmgOn && !f._fired){ f._fired = true; const d = Math.hypot(pp.x - f.ex, pp.z - f.ez);
          if(d < 24){ try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/dragon_breath.mp3', Math.max(0.12, 0.5 * (1 - d / 24))); }catch(_){} } }
        else if(!dmgOn && p < 0.5) f._fired = false;
        // 피해: 화염 경로(분출점→진행축 len, 폭≈0.9m) 안 + 분출 중 + 쿨다운
        if(dmgOn && fireCd <= 0){
          const rx = pp.x - f.ex, rz = pp.z - f.ez;
          const along = rx * f.dx + rz * f.dz;                         // 진행축 투영
          if(along > -0.3 && along < f.len){
            const perp = Math.hypot(rx - along * f.dx, rz - along * f.dz);
            if(perp < 1.0){ try{ ctx.combat && ctx.combat.envHurt && ctx.combat.envHurt(dcfg.traps.majorDamage, 'fire'); }catch(_){}
              fireCd = 0.5; }
          }
        }
      }
    }
    // ★불의 통로 — 화염 파도가 왼→오 훑음. 파도 칸만 화염+피해. 알코브 안=안전. 끝 보상 1회.
    if(gauntFire && gauntFire.jets.length){
      gauntFire.waveT += dt; const N = gauntFire.jets.length, CYCLE = 3.2 + N*0.35;
      const wavePos = ((gauntFire.waveT % CYCLE)/CYCLE) * (N + 2) - 1;   // -1 → N+1 훑음(양끝 여백)
      let inAlcove = false; for(const a of gauntFire.alcoves){ if(Math.hypot(pp.x-a.x, pp.z-a.z) < gauntFire.ar){ inAlcove = true; break; } }
      for(let i=0;i<N;i++){ const jw = gauntFire.jets[i];
        const k = Math.max(0, 1 - Math.abs(i - wavePos)/1.1);
        if(jw.jet.userData.update) jw.jet.userData.update(k, dt);
        if(jw.light) jw.light.intensity = 16 * k;
        if(k > 0.5 && !inAlcove && fireCd <= 0 && Math.hypot(pp.x-jw.x, pp.z-jw.z) < gauntFire.r){
          try{ ctx.combat && ctx.combat.envHurt && ctx.combat.envHurt(dcfg.traps.majorDamage, 'fire'); }catch(_){}
          fireCd = 0.5;
        }
      }
      // (불의 통로 끝 보상 상자는 통합 상자 [E] 시스템(dgChests)이 처리)
    }
    // ★상자 [E] 상호작용 — 미끼(bait)=함정 발동(붕괴+낙하) / 보상(reward)=대화창 개봉+상자오픈 사운드. 자동 아님.
    //   ★[5] 대화창식 UI(사령관 확정 2026-07-16): 토스트 → uikit dialog(advanceKey:'KeyE').
    //   포인터락 유지 = 전투 중 개봉해도 안전. 대화창 열린 동안 상자·레버 [E] 재입력 차단(아래 !_chestDlg 게이트).
    if(dgChests.length && !_chestDlg){
      const eNow = !!(ctx.player && ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
      let near = null;
      for(const ch of dgChests){ if(!ch.done && Math.hypot(pp.x-ch.x, pp.z-ch.z) < 2.0){ near = ch; break; } }
      if(near){
        if(!near._prompted){ near._prompted = true; toast('[E] 상자 열기', { accent:'gold', ms:1500 }); }
        if(eNow && !_chestEPrev){
          near.done = true;
          if(near.kind === 'bait'){ springTrap(); }
          else {
            const gv = near.gold || 60, sv = near.soul || 3;
            if(ctx.inventory && ctx.inventory.addGold) ctx.inventory.addGold(gv);
            if(ctx.combat && ctx.combat.addSoul) ctx.combat.addSoul(sv);
            try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/상자오픈.mp3', 0.7); }catch(_){}
            _chestDlg = ukDialog({ speaker:'보물상자', accent:'gold', advanceKey:'KeyE',
              lines:['금화 +'+gv+' · 영혼 +'+sv], onDone:()=>{ _chestDlg = null; } });
          }
        }
      } else { for(const ch of dgChests) ch._prompted = false; }
      _chestEPrev = eNow;
    }
    if(lower && lower.debris){ let alive = false;
      for(const d of lower.debris){ if(!d.m) continue; d.vy -= 22*dt;
        d.m.position.x += d.vx*dt; d.m.position.y += d.vy*dt; d.m.position.z += d.vz*dt;
        d.m.rotation.x += d.rx*dt; d.m.rotation.z += d.rz*dt; d.life -= dt;
        if(d.m.material) d.m.material.opacity = Math.max(0, Math.min(1, d.life/0.8));
        if(d.life<=0 || d.m.position.y < center.y - lower.drop - 2){ try{ ctx.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }catch(_){} d.m = null; } else alive = true; }
      if(!alive) lower.debris = null;
    }
    if(alcoveDebris){ let alive = false;
      for(const d of alcoveDebris){ if(!d.m) continue; d.vy -= 20*dt;
        d.m.position.x += d.vx*dt; d.m.position.y += d.vy*dt; d.m.position.z += d.vz*dt;
        d.m.rotation.x += d.rx*dt; d.m.rotation.z += d.rz*dt; d.life -= dt;
        if(d.m.material) d.m.material.opacity = Math.max(0, Math.min(1, d.life/1.1));
        if(d.life<=0){ try{ ctx.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }catch(_){} d.m = null; } else alive = true; }
      if(!alive) alcoveDebris = null;
    }
    // 🌋 용암 지대 — 표면 흐름(uTime) + 접촉 즉사. 발판에서 미끄러져 lavaY 근처까지 떨어지면 사망(사령관 확정 2026-07-16).
    //   판정은 '용암면 바로 위'에서만 → 발판 위 정상 플레이엔 절대 안 걸림. center.y = 던전 로컬 원점.
    if(lavaPits && lavaPits.length){
      const ly = pp.y - center.y;
      for(const lp of lavaPits){
        if(lp.U) lp.U.uTime.value += dt;
        if(pp.x > lp.x0 && pp.x < lp.x1 && pp.z > lp.z0 && pp.z < lp.z1 && ly < lp.lavaY + 1.1){
          try{ ctx.combat && ctx.combat.envHurt && ctx.combat.envHurt(lp.dmg, 'fire'); }catch(_){}
        }
      }
    }
    if(hallFx) hallFx.uTime.value += dt;   // 🏛️ 큰 홀 용암 균열 셰이더(순수 시각)
    // 🚪 [E] 보스방 진입 — 게이트 개구부 앞
    if(bossEnter && !_chestDlg){
      const near = Math.hypot(pp.x - bossEnter.x, pp.z - bossEnter.z) < 4.5;
      if(near && !bossEnter._prompted){ bossEnter._prompted = true; toast('[E] 게이트를 열고 들어간다', { accent:'red', ms:2200 }); }
      else if(!near) bossEnter._prompted = false;
      const eNow = !!(ctx.player && ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
      if(near && eNow && !_gateEPrev){
        // ★2026-07-23 레버 폐지 — 게이트 [E] 한 번에 개방(문 갈라짐 애니 + 포탈 막) + 보스방 진입 + 게이팅 해제.
        bossDoorOpen = true;
        try{
          const GF = bossGateFx || (cascade && cascade.fx && cascade.fx.gate);
          if(GF && !GF.opened){ GF.opened = true; GF.t = 0;
            if(GF.mixer && GF.clips && GF.clips.length){ const a = GF.mixer.clipAction(GF.clips[0]);
              a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); } }
        }catch(_){}
        try{ if(bossDoor && ctx.terrain && ctx.terrain.removeTrimesh && bossDoor.owner) ctx.terrain.removeTrimesh(bossDoor.owner); }catch(_){}
        if(bossDoor) for(const m of bossDoor.meshes) m.visible = false;
        try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/crash.mp3', 0.5); }catch(_){}
        try{ ctx.player.setSpawn(bossEnter.to.x, bossEnter.to.y, bossEnter.to.z); }catch(_){}
        toast('보스방', { accent:'red', ms:2600, emphasis:true, speaker:'광산 던전' });
      }
      _gateEPrev = eNow;
    }
    // 🚪 보스 게이트 — 문 애니메이션 + 포탈 막 차오름
    if(bossGateFx){
      if(bossGateFx.mixer) bossGateFx.mixer.update(dt);
      if(bossGateFx.portal){ bossGateFx.portal.update(dt);
        if(bossGateFx.opened){ bossGateFx.t = Math.min(1, bossGateFx.t + dt / 2.2); bossGateFx.portal.setOpen(bossGateFx.t); } }
    }
    // 🏔️ 폭포 대홀 — 물결/폭포/문 애니. ⚠️여기서 안 굴리면 셰이더 uTime이 멈춰 **물이 정지화면**이 된다.
    if(cascade && cascade.fx){
      const F = cascade.fx;
      if(F.pool) F.pool.update(dt);
      if(F.fall) F.fall.update(dt);
      if(F.gate){
        if(F.gate.mixer) F.gate.mixer.update(dt);
        if(F.gate.portal){
          F.gate.portal.update(dt);
          // 문이 갈라지는 동안 포탈 막이 차오른다(문 애니 길이에 맞춰 0→1).
          if(F.gate.opened){ F.gate.t = Math.min(1, F.gate.t + dt / 2.2); F.gate.portal.setOpen(F.gate.t); }
        }
      }
    }
    // 🎵 지하 도달 시네마틱 — 계단실을 다 내려와 지상층 아래로 확실히 내려갔을 때 런당 1회.
    //   판정은 '입장 높이(center.y) 대비 낙차'로만 — 계단실 총 하강 -20m의 절반(-10m)을 넘으면 지하로 본다.
    //   (레이아웃 상수나 wellInfo를 안 봐도 되므로 medium/large 흐름에서도 그대로 동작한다.)
    if(!deepCued && pp.y < center.y - 10){
      deepCued = true;
      try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.once && ctx.sound.bgm.once('dungeon'); }catch(_){}
    }
    // ★[3] 레버 — [E]로 당기면 잠긴 보스문 개방. (_chestDlg = 상자 대화창 닫는 [E]가 레버를 같이 당기는 것 차단)
    if(lever && !lever.pulled && !_chestDlg){
      const near = Math.hypot(pp.x-lever.x, pp.z-lever.z) < 2.2;
      if(near && !lever._prompted){ lever._prompted = true; toast('[E] 레버를 당긴다', { accent:'gold', ms:1600 }); }
      else if(!near) lever._prompted = false;
      const eNow = !!(ctx.player && ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
      if(near && eNow && !_leverEPrev){
        lever.pulled = true; bossDoorOpen = true;
        if(lever.mesh && lever.mesh.userData.pull) lever.mesh.userData.pull();
        // 🚪 폭포 대홀 보스 게이트 — 문짝 4장이 갈라지는 내장 애니(`Door downAction`) 재생 + 포탈 막 차오름.
        //   ⚠️LoopOnce + clampWhenFinished 가 필수. 안 걸면 문이 열렸다 도로 닫히고 무한 반복한다.
        try{
          const GF = bossGateFx || (cascade && cascade.fx && cascade.fx.gate);
          if(GF && !GF.opened){
            GF.opened = true; GF.t = 0;
            if(GF.mixer && GF.clips && GF.clips.length){
              const a = GF.mixer.clipAction(GF.clips[0]);
              a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
            }
            toast('먼 곳에서 거대한 문이 갈라지는 소리가 들린다', { accent:'gold', ms:4200, speaker:'광산 던전' });
          }
        }catch(_){}
        try{ if(bossDoor && ctx.terrain && ctx.terrain.removeTrimesh && bossDoor.owner) ctx.terrain.removeTrimesh(bossDoor.owner); }catch(_){}
        if(bossDoor) for(const m of bossDoor.meshes) m.visible = false;
        // ★2026-07-17(사령관 "레버 내리면 숏컷 가는 길이 입구로") — 보스문과 동시에 입구行 지름길 게이트도 개방.
        //   (숏컷 게이트는 FLOWS 기반 medium/large 전용 — 큰 홀 방식(elevator)엔 애초에 지어지지 않아 no-op)
        try{ if(shortcutDoor && ctx.terrain && ctx.terrain.removeTrimesh && shortcutDoor.owner) ctx.terrain.removeTrimesh(shortcutDoor.owner); }catch(_){}
        if(shortcutDoor) for(const m of shortcutDoor.meshes) m.visible = false;
        // ★[4] 엘리베이터 점등+탑승 가능화 + 시작지점 옆 봉인방 벽 파괴("레버 당기면 엘리베이터 수직상승 → 시작지점 옆 방이 부서지며 열림")
        if(elevator){ elevator.active = true; if(elevator.mesh && elevator.mesh.userData.activate) elevator.mesh.userData.activate(); }
        // 봉인방 벽 부서짐 — 콜라이더 제거 + 파편(각 조각을 튀는 debris로 전환) + 메시 숨김.
        try{ if(alcoveDoor && ctx.terrain && ctx.terrain.removeTrimesh && alcoveDoor.owner) ctx.terrain.removeTrimesh(alcoveDoor.owner); }catch(_){}
        if(alcoveDoor && alcoveDoor.meshes){
          const deb = [];
          for(const m of alcoveDoor.meshes){ if(!m) continue;
            const wp = new THREE.Vector3(); try{ m.getWorldPosition(wp); }catch(_){}
            const frag = new THREE.Mesh(new THREE.BoxGeometry(0.6+Math.random()*0.7, 0.6+Math.random()*0.7, 0.5), new THREE.MeshStandardMaterial({ color:0x3a3a40, roughness:0.9, transparent:true, opacity:1 }));
            frag.position.copy(wp); ctx.scene.add(frag);
            deb.push({ m:frag, vx:(Math.random()-0.5)*5, vy:2+Math.random()*4, vz:(Math.random()-0.5)*5, rx:(Math.random()-0.5)*6, rz:(Math.random()-0.5)*6, life:1.1 });
            m.visible = false;
          }
          alcoveDebris = deb;
        }
        try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/crash.mp3', 0.5); }catch(_){}
        toast(alcoveDoor ? '레버를 당기자 엘리베이터가 깨어난다 — 지상 어딘가의 벽이 무너지는 소리'
                         : (elevator ? '멀리서 보스문이 열리는 소리가 들린다 — 엘리베이터가 가동되기 시작했다'
                                     : '멀리서 보스문이 열리는 소리가 들린다 — 입구로 가는 지름길도 뚫렸다'),
          { accent:'cyan', ms:3600, speaker:'광산 던전' });
      }
      _leverEPrev = eNow;
    }
    // ★[4] 엘리베이터(큰 홀) — 레버로 가동된 뒤 [E]로 탑승하면 실제로 발판+플레이어가 지하1층→1층 진입 랜딩까지
    //   ELEV_DUR초에 걸쳐 위로 이동(2026-07-17 재설계, 사령관 "순간이동 말고 실제로 올라가야지"). 탑승 중엔 위치를
    //   강제로 경로에 고정(다른 [E] 상호작용 차단) — 도착 시 자동 하차.
    const ELEV_DUR = 4.2;
    if(elevRiding && elevator && elevator.rideFrom && elevator.rideTo){
      elevT += dt / ELEV_DUR;
      const t = Math.min(1, elevT), k = t*t*(3-2*t);   // smoothstep
      const fx = elevator.rideFrom, tx = elevator.rideTo;
      const cx = fx.x + (tx.x-fx.x)*k, cy = fx.y + (tx.y-fx.y)*k, cz = fx.z + (tx.z-fx.z)*k;
      try{ ctx.player.setSpawn(cx, cy + 1.3, cz); }catch(_){}
      if(elevator.mesh) elevator.mesh.position.set(cx - center.x, cy - center.y, cz - center.z);
      if(t >= 1){ elevRiding = false; elevT = 0; toast('엘리베이터가 도착했다', { accent:'cyan', ms:2000 }); }
    } else if(elevator && elevator.active && !_chestDlg){
      const nearE = Math.hypot(pp.x-elevator.x, pp.z-elevator.z) < 2.4;
      if(nearE && !elevator._prompted){ elevator._prompted = true; toast('[E] 엘리베이터 탑승', { accent:'cyan', ms:1600 }); }
      else if(!nearE) elevator._prompted = false;
      const eNow2 = !!(ctx.player && ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
      if(nearE && eNow2 && !_elevEPrev){
        elevRiding = true; elevT = 0;
        try{ ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/crash.mp3', 0.3); }catch(_){}
        toast('엘리베이터가 올라가기 시작한다', { accent:'cyan', ms:2000 });
      }
      _elevEPrev = eNow2;
    }
    // ★[3] 보스방 진입(문 열린 뒤) → 보스 등장. "몹 전멸=보스" 폐지.
    if(!bossPhase && bossDoorOpen && bossBounds && !bossSpawned
       && pp.x > bossBounds.x0 && pp.x < bossBounds.x1 && pp.z > bossBounds.z0 && pp.z < bossBounds.z1){ spawnBoss(); }
    if(!cleared){
      if(!bossPhase){
        // ── 잡몹 웨이브 단계 — 탐험 중 처치(보스는 문/진입으로 게이팅) ──
        if(!pending.length && seenMobs.size < expected){
          waitT += dt;   // 템플릿 로드 지연/실패 대기 — 상한 후 실등장분만 기대
          if(waitT > SPAWN_WAIT_MAX && seenMobs.size > 0){ expected = seenMobs.size; }
        }
      } else {
        // ── 보스 단계 — 보스 처치 = 클리어 ──
        if(!bossRef) bossRef = (ctx.monsters||[]).find(m => m.isBoss && m._outpostTag === tag) || null;
        if(bossSpawned && bossRef && (bossRef.dead || (ctx.monsters && ctx.monsters.indexOf(bossRef) < 0))) doClear();
      }
    } else if(portal){
      // 출구 포탈 접근 판정 + 신규 포탈 애니메이션(회전/입자). (포탈=root 직속 자식 → world = center + portal.position)
      if(portal.userData.spin) portal.userData.spin(dt);
      const fy = 2.3;   // 포탈 중심 높이(buildPortal face.y)
      const pw = { x:center.x + portal.position.x, y:center.y + portal.position.y + fy, z:center.z + portal.position.z };
      if(Math.hypot(pp.x-pw.x, pp.z-pw.z) < 2.6 && Math.abs((pp.y||0) - pw.y) < 4){ exit({ teleport:true }); return; }
    }
    // ⚡ 횃불 광원 풀 — 고정 6개가 **플레이어에게 가장 가까운 횃불 자리**로 옮겨 다닌다.
    //   횃불 조각·불꽃 메시는 전부 그대로 있고(시각), 실제 PointLight만 6개다.
    //   ⇒ 눈에 보이는 밝기는 그대로인데 셰이더 광원 개수가 22 → 6으로 준다. 개수가 고정이라 재컴파일도 없다.
    flickerT += dt;
    if(torchSpots.length && root){
      if(!torchPool.length){   // 최초 1회 생성(입장 때 한 번 = 컴파일도 그때 한 번)
        for(let i=0;i<TORCH_POOL;i++){ const L = new THREE.PointLight(0xffb86b, 0, 34, 2); L.position.set(0,-9999,0); root.add(L); torchPool.push(L); }
      }
      // 가장 가까운 것부터 — 매 프레임 전수 정렬은 낭비라 0.2초마다 갱신
      _torchPick -= dt;
      if(_torchPick <= 0){ _torchPick = 0.2;
        const px = pp.x - center.x, py = pp.y - center.y, pz = pp.z - center.z;
        for(const s of torchSpots) s._d = (s.x-px)*(s.x-px) + (s.z-pz)*(s.z-pz) + (s.y-py)*(s.y-py)*0.25;
        torchSpots.sort((a,b) => a._d - b._d);
      }
      for(let i=0;i<torchPool.length;i++){
        const s = torchSpots[i], L = torchPool[i];
        if(!s){ L.intensity = 0; continue; }
        L.position.set(s.x, s.y, s.z);
        L.intensity = (s.base || 16) + Math.sin(flickerT*9 + i*2.1)*1.4;
      }
    }
    // ★지하 순차 점등(사령관 "내려갈 때 불이 하나씩 켜진다") — 플레이어가 그 횃불 깊이보다 내려오면 불꽃 표시 + 점등.
    //   포인트라이트는 근거리(≤34m)일 때만 실제 밝기 부여(멀리 켜진 것은 불꽃만 = 라이트 수 관리). 깊이 = pp.y - center.y.
    if(hallTorches.length && center){
      const depth = pp.y - center.y;
      for(let i=0;i<hallTorches.length;i++){ const lp = hallTorches[i], ud = lp.userData;
        const d = Math.hypot(pp.x-(ud._wx!=null?ud._wx:lp.position.x), pp.z-(ud._wz!=null?ud._wz:lp.position.z));
        // ★점등 조건 = 깊이(내려옴) OR 수평 접근(d<30) — 어둠 속으로 먼저 들어가야 켜지던 문제 해소(내려가는 길이 미리 보임, 2026-07-20)
        const lit = depth < (ud._litY!=null?ud._litY:0) + 1.6 || d < 30;
        if(lit && !ud._on){ ud._on = true; if(ud._flame) ud._flame.visible = true; }
        if(!ud._on){ lp.intensity = 0; continue; }
        const near = d < 42;   // 도달 반경 상향(방 1등이라 좁으면 반대편이 암흑)
        const target = near ? (ud._base||9) + Math.sin(flickerT*9 + i*2.1)*1.3 : 0;
        lp.intensity += (target - lp.intensity) * Math.min(1, dt*6);   // 부드러운 fade-in
      }
    }
  });

  // [O] = 던전 나가기(클리어 후=즉시 복귀 / 클리어 전=포기) — 입력 라우터 중앙 등록(모드 게이트 자동)
  if(ctx.input && ctx.input.register){
    ctx.input.register('KeyO', ()=>{ if(!cleared) toast('던전을 포기하고 지상으로 복귀합니다', { accent:'red', ms:2600 }); exit({ teleport:true, silent:cleared?false:true }); }, { when: ()=>active });
  }

  // ── ⛏️ 광산 건물 앞 [E] 직접 입장 — N메뉴를 거치지 않고도 항구/레버/상자와 동일하게 건물 앞에서 바로 진입.
  //   기존엔 empire.js N메뉴 안에서만 버튼이 떴음(사령관 "광산 지어놓았는데 왜 입구가 배선 안 됨" — 실누락). ──
  let dgLeft = 3, _dgPrompted = null, _dgEPrev = false;   // 하루 3회(세션) — empire.js N메뉴 버튼과 useDaily() 공유
  function useDaily(){ if(dgLeft<=0) return false; dgLeft--; return true; }
  ctx.onUpdate((dt)=>{
    if(active){ _dgPrompted = null; return; }   // 던전 안에선 무관
    const pp = ctx.player && ctx.player.pos; if(!pp || !ctx.claimed) return;
    let near = null;
    for(const isl of ctx.claimed){ if(isl.owner!=='player' || !isl.buildings) continue;
      for(const b of isl.buildings){ if(b.id==='mine' && Math.hypot(pp.x-b.x, pp.z-b.z) < 4){ near = isl; break; } }
      if(near) break; }
    if(!near){ _dgPrompted = null; return; }
    if(_dgPrompted !== near){ _dgPrompted = near;
      toast(dgLeft>0 ? '[E] 던전 입장' : '오늘 던전 입장 소진(하루 3회)', { accent: dgLeft>0?'gold':'red', ms:1600 }); }
    const eNow = !!(ctx.player.keysSet && ctx.player.keysSet.has('KeyE'));
    if(eNow && !_dgEPrev && document.pointerLockElement===ctx.renderer.domElement && useDaily()) enter(near);
    _dgEPrev = eNow;
  });

  // ★프리로드(사령관 "광산 입장 로딩 중 렉") — 기존엔 첫 입장([E]) 순간에야 GLTFLoader가 KayKit 조각 13종을 fetch+파싱해 그 자리서 히칫.
  //   loadKit()은 _kitPromise로 캐시되므로, 부팅 몇 초 후 미리 한 번 호출해두면 실제 입장 시엔 캐시 적중(즉시 resolve).
  // 🛠️ 던전 디버그 이동 — 콘솔에서 바로. __ctx.__dgGate 는 **던전 입장 후에만** 생기므로
  //   밖에서 치면 undefined 오류가 난다(사령관이 겪음). 여기서 안전하게 감싼다.
  //   __gate()   보스 게이트 앞으로 · __hall()  대전당 중앙으로 · __dgInfo()  현재 던전 정보
  try{
    window.__gate = () => { const G = ctx.__dgGate;
      if(!G) return '던전에 먼저 들어가십시오(게이트는 대전당에 있습니다)';
      ctx.player.setSpawn(G.x, G.y + 2, G.z - 14); return '게이트 앞으로 이동'; };
    window.__hall = () => { const M = ctx.__dgGrid;
      if(!M || !M.rooms) return '던전에 먼저 들어가십시오';
      const r = M.rooms.find(r => r.role === 'grandhall'); if(!r) return '대전당 없음';
      ctx.player.setSpawn(M.cx + (r.cx + 0.5 - M.G/2) * M.CELL, M.cy + r.y + 2, M.cz + (r.cz + 0.5 - M.G/2) * M.CELL);
      return '대전당 중앙으로 이동'; };
    window.__dgInfo = () => { const M = ctx.__dgGrid;
      if(!M) return '던전 밖'; return { 방: (M.rooms||[]).map(r => r.role + '@' + r.y), 게이트: ctx.__dgGate || null }; };
  }catch(_){}

  setTimeout(() => { loadKit().catch(() => {}); }, 4000);
  //   🚪 보스 게이트(50MB)도 같은 이유로 미리 받아둔다 — 입장 순간에 받으면 그 자리서 멎는다. KayKit보다 늦게 시작(대역폭 양보).
  setTimeout(() => { loadBossGate().catch(() => {}); }, 12000);

  ctx.dungeon = {
    enter, exit, useDaily,
    get active(){ return active; },
    get cleared(){ return cleared; },
    get dgLeft(){ return dgLeft; },
    status: ()=>({ active, cleared, tier, alive: seenMobs.size, expected, pending: pending.length }),
  };
  console.log('[dungeonrun] ⛏️ 광산 던전 등록 — empire 광산 패널 "던전 입장" → ctx.dungeon.enter(isl)');
  return ctx.dungeon;
}

// [근거]
// 확정(출처):
//  - 진입 계약 = empire.js _dungeonPanel/_wireFnPanel: ctx.dungeon.enter(isl) 호출(반환값 미소비 — enter 내부 비동기 안전),
//    _dgLeft 3회 제한은 empire 소유.
//  - 몹 스폰/태그 = monsters.js spawn(opts): at/atR/atY/k/ignoreMax/wander/home/tag(mn._outpostTag) 실시그니처.
//    스캐터는 groundAt(x,z,600)>0.8 요구 → 타일 깔린 셀에서만 성공(14회 재시도) — 벽 밖 스폰 구조적 차단.
//    몹 이동(_step)도 groundAt 게이트 → 타일 없는 void로 못 나감 = 바닥을 walkable 셀에만 깐 것이 곧 몹 격리.
//  - despawn 거리 = BAL.monsters.spawn.despawn(90m) > 던전 최대 대각(12셀×4m≈68m) — 배회 몹 소실 없음.
//  - 티어/풀 = balance.js BAL.level.tierForLevel + BAL.gates[grade].pool (gate.js와 동일 SSOT 소비).
//  - 텔레포트 = ctx.player.setSpawn/setYaw/setPitch. yaw 규약 = player.js forward=(sinYaw,-cosYaw) → atan2(dx,-dz).
//  - 물리/레이캐스트 = ctx.terrain.addTrimeshMesh/removeTrimesh + collide.push(BVH 자동 래핑) — terrain.js 실코드.
//    D4 규칙 유지: collide=바닥만(천장/벽 오염 금지 — groundAt fromY=600 하향 레이), trimesh=바닥+벽류.
//  - KayKit 치수 = gltf accessor 실측: floor_tile_large 4×4(윗면 +0.05) · wall 4L×4H×1T(중심 피벗) ·
//    wall_doorway 동형(문짝 노드 wall_doorway_door 별도 — 로드 시 제거) · pillar 1.5×1.5×4 — CELL은 로드 후 Box3 재실측.
//  - 사망 정합 = combat.js: 부활석은 dead 미설정(제자리 부활=던전 계속), 진짜 사망만 isDead()=true →
//    본 모듈이 즉시 정리, 위치는 reviveAtHarbor(마지막 항구)가 처리 — 지하 데드락 없음.
//  - 습격 일시정지 = ctx.raid.setEnabled (raid.js 공개 API). 자동저장 보류 = save.js write() 선두 가드(ctx.dungeon.active).
//    게이트 개방 보류 = gate.js 자정 재시도 루프 가드. (D4 그대로 — 미변경)
// 제안(작성자 판단):
//  - 그리드 12×12·방 4~6(3~5×3~4셀)·복도 폭1 L자 체인 = 사령관 "미로형" 선택 반영, 규모는 성능 제약 준수.
//  - wall_corner/wall_endcap 미사용 — 하프월 조합 전제 조각이라 4m 풀월 에지 타일링과 치수 불합(이음새 구멍 위험).
//    코너 격자점 pillar(동고 4m)로 벽 맞물림을 덮는 정합적 대체. 막다른 복도는 3면 벽 폐합이라 endcap 불요.
//  - 문짝 제거 아치 = 통행 보장(폭 ≈1.6m). 배너/횃불 = 벽과 동일 transform(+z=안쪽 규약)으로 안쪽 면 부착.
//  - 조명 예산: 횃불 PointLight ≤7 + 미광 1 + 포탈 1 = ≤9(구 아레나 6 대비 +3 — 셰이더 재컴파일 폭탄 방지).
//  - 클론 공유 자산(_kaykitShared)은 dispose 제외 — 세션 1회 로드 상수 메모리(누수 아님), 재입장 재로드/재업로드 제거.
//  - 로드 대기 중 이탈 안전망: runSeq + active 이중 가드 — 뒤늦은 then()이 유령 던전을 짓지 않음.
