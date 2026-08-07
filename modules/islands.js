// islands.js — 🏝️ 아일랜드 레지스트리 SSOT (리팩토링 R5-P1 — 근거=_REFACTOR_점검.md R5)
// 문제: 섬의 '존재'가 3곳(terrain 세션섬 / worldstream 스트림섬 / opening 자체 해안)에 흩어져 서로 모름 →
//       미니맵·채집·전투·항구가 "어떤 섬이 지금 세계에 있는가"를 물어볼 곳이 없었다(QA#20 계열의 구조 원인).
// 해결: 섬의 등록/해제가 여기 한 곳을 지나고, ctx.events('islandLoaded'/'islandUnloaded')로 시스템이 구독한다.
//       ISLE = { id, name, x, z, r, kind:'session'|'stream'|'opening', tribe?, faction?, group?, rec? } (월드좌표)
// 사용: initIslands(ctx) → ctx.islands.{register,unregister,get,at,nearest,all,count}
// 🧭 canon 단위 → 월드 미터 변환 SSOT (구 worldstream 소유 → R5 승격).
//   ⚠️ 좌표공간 규약: 경제/2D지도(navmap·npc 상태머신) = canon 원단위 / 3D 씬 = canon×WORLD_SCALE.
//   3D에 놓이는 모든 것(섬·상선 메시·조우 스폰)은 반드시 ×WORLD_SCALE — 안 하면 "상선이 엉뚱한 섬 앞에 뭉침"(사령관 2026-07-04 실측).
export const WORLD_SCALE = 1.5;

// 🧭 canon.json 원본(203섬) → 실제 게임에 존재하는 섬만 걸러내는 SSOT 필터 (R6 — 사령관 2026-07-09 실측).
//   문제: worldstream(3D 렌더)은 이 필터를 거쳐 ~97섬만 그리는데, navmap(지도/전략맵)은 203섬 원본을 그대로 써서
//         "지도엔 있는데 실제 게임엔 없는 섬"이 표시됨. 두 소비처가 반드시 이 함수 하나만 거쳐야 함.
// ★2026-07-10 수정(사령관 "소형섬이 맵에 안뜨네"): 1500은 구 맵(ringStep 2000대) 기준값 — 지금 맵은 ringStep=700이라
//   클러스터 내 소형섬 간격(400~600대)이 전부 1500 미만이라 거의 다 솎아지고 있었음(navmap·worldstream 공용 필터라 3D에도 영향).
//   새 스케일에 맞춰 최소 간격을 실제 섬 반지름(소형80)보다 살짝 큰 값으로 축소 — 겹침만 막고 클러스터 촘촘함은 유지.
export const MIN_SPACING = 120;   // 근접 섬 솎기(canon 단위) — 이 간격 이내로 붙은 섬 제거. 0=솎기 없음
export function filterCanonIslands(canonIslands, backupSessions){
  // ①prefab 3D 데이터 없는 섬 제외 ②원점(0,0) 유령섬 제외(canon 생성 아티팩트, 사령관 2026-07-04) ③근접 솎기
  const _all = (canonIslands||[]).filter(i => backupSessions && backupSessions[i.prefab] && !(i.x===0 && i.z===0));
  const out = [];
  for(const isle of _all){
    let ok = true;
    if(MIN_SPACING > 0) for(const k of out){ if(Math.hypot(isle.x-k.x, isle.z-k.z) < MIN_SPACING){ ok=false; break; } }
    if(ok) out.push(isle);
  }
  return out;
}

export function initIslands(ctx){
  const list = new Map();   // id → ISLE

  function register(isle){
    if(!isle || !isle.id) return null;
    if(list.has(isle.id)) return list.get(isle.id);   // 중복 등록 무해(기존 레코드 유지)
    list.set(isle.id, isle);
    if(ctx.events) ctx.events.emit('islandLoaded', isle);
    return isle;
  }
  function unregister(id){
    const isle = list.get(id); if(!isle) return false;
    list.delete(id);
    if(ctx.events) ctx.events.emit('islandUnloaded', isle);
    return true;
  }
  const at = (x, z) => { for(const i of list.values()){ if(Math.hypot(i.x-x, i.z-z) <= (i.r||120)+20) return i; } return null; };
  const nearest = (x, z) => { let b=null, bd=1e9;
    for(const i of list.values()){ const d=Math.hypot(i.x-x, i.z-z); if(d<bd){ bd=d; b=i; } }
    return b ? { isle:b, dist:bd } : null; };

  ctx.islands = { register, unregister, at, nearest, get:id=>list.get(id)||null, all:()=>[...list.values()], count:()=>list.size };
  console.log('[islands] 아일랜드 레지스트리 SSOT 등록 — islandLoaded/Unloaded 이벤트로 시스템 연동');
  return ctx.islands;
}
