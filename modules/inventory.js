// inventory.js — 콘센트 ② 인벤토리. (리그, 게임팀)
import { BAL } from '/tomob-deploy/modules/balance.js';   // 🧭 시작 골드 SSOT(BAL.economy.startGold — 튜토 스킵 무관 공통, 사령관 2026-07-05)
// _GAME_DESIGN.md §9 확정 구조: 개인 인벤(personal) + 배 화물칸(cargo) 2분할, 둘 다 무게제. 금화(gold)는 무게 없음.
//   personal = 재료(목재·돌 등) + 먹을거. maxWeight 무게제. 제작 재료는 여기서 remove로 차감(§3-B).
//   cargo    = 교역품(럼·비단·향신료·보석·목재·돌). cargoCapacity 무게제, 배별 차등.
//   gold     = 별도 스칼라, 무게 계산 제외.
// ★서버 권위 전제(§1-A): 상태는 JSON 직렬화 가능한 plain object(ctx.inventory.state). 메서드는 ctx.inventory에.
//   클라이언트가 직접 state를 만지지 않고 메서드(=액션)를 통해서만 변경 → 추후 서버 검증·broadcast 자리.
// ★개인 강화/장비 슬롯 없음(§9). 인벤은 "재료·먹을거·교역품 보유" 단순 유지.

// ── 교역품 카탈로그 (화물칸용) — §9 + 사령관 확정 6종(럼·비단·향신료·보석·목재·돌) ──
export const TRADE_GOODS = {
  rum:    { name: '럼',     weight: 2,   basePrice: 30  },
  silk:   { name: '비단',   weight: 1,   basePrice: 80  },
  spice:  { name: '향신료', weight: 1,   basePrice: 60  },
  gem:    { name: '보석',   weight: 0.5, basePrice: 120 },
  timber: { name: '목재',   weight: 3,   basePrice: 10  },  // 재료이면서 교역도 가능(§2 채집 잉여분 판매)
  stone:  { name: '돌',     weight: 4,   basePrice: 8   },
  // ── 🏭 가공 교역품(P6 채집→가공→교역 마진): 원자재를 제재/석공으로 가공 = 원가 대비 고부가. 캐서 가공해 팔면 이득(vs 사서 팔기). ──
  plank:  { name: '판재',   weight: 2,   basePrice: 30  },  // 통나무2 → 판재1 (raw 20 → 30, 마진)
  brick:  { name: '벽돌',   weight: 3,   basePrice: 26  },  // 돌3 → 벽돌1 (raw 24 → 26+가공, 밀도↑=적재효율)
};

// ── 재료 카탈로그 (개인 인벤용 — 제작 소비, §3-B 연동) ──
export const MATERIALS = {
  timber: { name: '목재',   weight: 3 },  // 채집(벌목) 연동 — 통나무
  leaf:   { name: '나뭇잎', weight: 1 },  // 벌목 부산물 → 밧줄 제작 재료
  stone:  { name: '돌',     weight: 4 },  // 채집(채석) 연동 + 광물(잡석)
  rope:   { name: '밧줄',   weight: 1 },  // 나뭇잎3 → 밧줄1 제작(핸드) — 깃발·텐트 천재료
  iron:   { name: '쇠',   weight: 5, basePrice: 18 },  // 철광석 제련(대포 강화·철물)
  // ── 광물 9종 (채광 = mine.js, 2026-06-26 사령관 확정) ──
  // basePrice = trade.js 개인인벤 직접판매용(BUG-009, 2026-07-13 추가) — 라이브 밸런스 미확정 제안값.
  copper: { name: '구리',   weight: 4, basePrice: 24 },  // 청동(구리+주석)·대포
  tin:    { name: '주석',   weight: 4, basePrice: 24 },  // 청동 합금
  cobalt: { name: '코발트', weight: 4, basePrice: 38 },  // 고급 합금
  gold:   { name: '금',     weight: 6, basePrice: 110 },  // 화폐·고가 교역
  silver: { name: '은',     weight: 5, basePrice: 65 },  // 화폐·교역
  gem:    { name: '보석',   weight: 0.5 },// 최희귀 교역(보석급 시세) — TRADE_GOODS.gem(화물)과 키 중복이라 판매는 화물 경로만 사용
  coal:   { name: '석탄',   weight: 3, basePrice: 12 },  // 제련 연료
  // ── 제련 결과(주괴/합금 — forge.js 화로) ──
  steel:  { name: '강철',   weight: 5 },  // 철광석 제련 → 대포·도구 강화
  bronze: { name: '청동',   weight: 4 },  // 구리+주석 제련 → 함포
  // ── 소모품(교역소 추종자에게 영혼으로 구매 — trade.js) ──
  potion:      { name: '힐링 포션', weight: 1 },   // 🧪 H키 = 즉시 HP+50 (BAL.soulShop.potion)
  revivestone: { name: '부활석',    weight: 1 },   // 💠 소지 중 사망 = 자동 소모 제자리 부활(BAL.soulShop.revive)
  // ── 건축 부품(제작 → 개인 인벤 누적, build.js 스냅 배치로 소비. build:true 플래그) ──
  banner:  { name: '거점 깃발',  weight: 6, build: true },   // 🚩 자유설치(outpost.js) — 꽂은 자리가 거점 중심(섬당 1개)
  // ── 🌀 차원문 석판(사령관 확정 2026-08-07) ── 밤 던전 클리어 시 그 등급 **조각**이 드롭 → 4개 모으면 **석판** 1개.
  //   석판을 쓰면 밤을 기다리지 않고 그 등급 차원문을 직접 연다(팰월드 던전 소환 방식). 등급 = 조각 등급이 결정.
  //   조각은 밤 던전에서만 나온다 = 밤 던전을 도는 이유가 유지된다(사령관: "몬스터가 어차피 던전에서만 나오니까").
  shard1:  { name: '하급 석판 조각', weight: 1 }, shard2: { name: '중급 석판 조각', weight: 1 },
  shard3:  { name: '상급 석판 조각', weight: 1 }, shard4: { name: '심연 석판 조각', weight: 1 },
  shard5:  { name: '심층 석판 조각', weight: 1 },
  slab1:   { name: '하급 차원문 석판', weight: 4, build: true }, slab2: { name: '중급 차원문 석판', weight: 4, build: true },
  slab3:   { name: '상급 차원문 석판', weight: 4, build: true }, slab4: { name: '심연 차원문 석판', weight: 4, build: true },
  slab5:   { name: '심층 차원문 석판', weight: 4, build: true },
  campfire:{ name: '모닥불',     weight: 4, build: true },   // 🔥 자유설치(campfire.js) — 밤 온기+조명
  dfloor:  { name: '던전바닥',   weight: 3, build: true },
  dfloor2: { name: '던전바닥B',  weight: 3, build: true },
  dwall:   { name: '던전벽',     weight: 3, build: true },
  dcol:    { name: '던전기둥',   weight: 2, build: true },
  woodblock:{ name: '나무방책',  weight: 1, build: true },   // 🧱 축성 티어1 — 싸고 약함(timber)
  wallblock:{ name: '돌벽',      weight: 2, build: true },   // 🧱 축성 티어2 — 중간(stone)
  ironblock:{ name: '철벽',      weight: 3, build: true },   // 🧱 축성 티어3 — 비쌈·튼튼(stone+iron)
  cannonblock:{ name: '포대',    weight: 5, build: true },   // 🔫 축성 — 타워 위 자동 대포
  // ── 던전 장식 프롭 ──
  dtable:  { name: '던전테이블', weight: 3, build: true },
  dchair:  { name: '던전의자',   weight: 2, build: true },
  dbox:    { name: '던전상자',   weight: 2, build: true },
  dpot:    { name: '던전항아리', weight: 2, build: true },
  djug:    { name: '던전주전자', weight: 1, build: true },
  dbook:   { name: '던전책',     weight: 1, build: true },
  dbottle: { name: '던전병',     weight: 1, build: true },
  dcandle: { name: '던전촛불',   weight: 1, build: true },
  dlight:  { name: '던전조명',   weight: 1, build: true },
  drock:   { name: '던전바위',   weight: 4, build: true },
  dmud:    { name: '던전진흙',   weight: 2, build: true },
  // ── Kenney 빌드 팔레트(가구/수납/개구부/깃발/방어) ──
  dbench:  { name: '벤치',       weight: 3, build: true },
  dbarrel: { name: '술통',       weight: 2, build: true },
  dchest:  { name: '궤짝',       weight: 3, build: true },
  dcrate:  { name: '나무상자',   weight: 2, build: true },
  ddoor:   { name: '문',         weight: 3, build: true },
  dgate:   { name: '성문',       weight: 5, build: true },
  dfence:  { name: '울타리',     weight: 2, build: true },
  dflag:   { name: '깃발',       weight: 1, build: true },
  dpennant:{ name: '페넌트',     weight: 1, build: true },
  dpflag:  { name: '해적기',     weight: 1, build: true },
  dballista:{ name: '발리스타',  weight: 5, build: true },
  dsignpost:{ name: '표지판',    weight: 2, build: true },
  dtent:   { name: '텐트',       weight: 4, build: true },
};

// ── 먹을거 카탈로그 (개인 인벤용 — 요리, §3-B + 생존 연동) ──
//   §9 FOODS는 "미정: 요리 레시피·식량 종류". 생존(배고픔) 연동 자리만 둔다(nutrition = 배고픔 해소량).
export const FOODS = {
  ration: { name: '비상식량', weight: 1, nutrition: 20 },  // 제안: 기본 식량(레시피 미정 → 자리만)
};

// itemId → { name, weight } 조회. 개인 인벤은 재료+먹을거, 화물칸은 교역품 카탈로그.
function lookupPersonal(itemId){
  return MATERIALS[itemId] || FOODS[itemId] || null;
}
function lookupCargo(goodsId){
  return TRADE_GOODS[goodsId] || null;
}

// 배별 화물칸 기본 용량(무게 단위). §9 cargoCapacity. 배별 차등.
//   값 출처 = 16_밸런스수치_스프링.md §1-2 [제안(플레이테스트 전 잠정)]. oseberg=20만 §9 [확정].
//   ★배종 식별자(galleon/longship)는 스프링 문서 명칭. 실제 obj(queen=갤리온풍/pirate 등)와의
//     매핑은 vessel.js 빌드 시 확정 — 그때 키를 obj에 맞춰 정렬할 것.
// ★키 = 실제 배 식별자(shipyard SHIPS[].key / fleet 등록 key). 3티어 진행형(사령관 확정 2026-07-03).
//   invui.js:706 `CARGO_CAPACITY[sel.key]`로 조회 → 키 불일치 시 default(20) 폴백되므로 정렬 필수.
export const CARGO_CAPACITY = {
  oseberg:  20,   // 시작배(무료·§9 기본·확정). 첫 배는 답답 → 업그레이드 동기
  caravel:  40,   // T1 건조 600g: 시작배 2배
  empty:    60,   // T2 건조 1500g: 중형 범선
  queen:    80,   // T3 건조 3000g: 대형 갤리온(교역 특화)
  default:  20,
};
const DEFAULT_MAX_WEIGHT = Infinity;   // ★개인 인벤 무게 제한 제거(사령관: 무게는 배 화물칸에나 필요, 캐릭터 개인 소지엔 불필요) — 목재 무게초과로 안 들어오던 버그 해소. 무게는 배 cargo(CARGO_CAPACITY)만.

export function initInventory(ctx, opts = {}){
  // ── 직렬화 가능한 순수 상태(plain object) — 서버 동기화 대비(§1-A) ──
  //   items는 plain object<itemId,{qty,weight}>. (Map은 JSON.stringify 불가 → object 사용)
  const state = {
    personal: {},                                              // { itemId: { qty, weight } }
    maxWeight: opts.maxWeight ?? DEFAULT_MAX_WEIGHT,
    currentWeight: 0,                                          // personal 합산(자동 계산)
    cargo: {},                                                 // { goodsId: { qty, weight } }
    cargoCapacity: opts.cargoCapacity ?? CARGO_CAPACITY.default,
    cargoWeight: 0,                                            // cargo 합산(자동 계산)
    gold: opts.gold ?? (BAL.economy?.startGold ?? 0),          // 무게 없음. 기본=시작 골드 1000(항구250+첫배+여유, 사령관 2026-07-05)
  };

  // 합산 무게 재계산(상태 변경 후 호출). 자동 계산 필드 일관성 유지.
  function recalc(){
    let pw = 0; for(const id in state.personal) pw += state.personal[id].qty * state.personal[id].weight;
    let cw = 0; for(const id in state.cargo)    cw += state.cargo[id].qty    * state.cargo[id].weight;
    state.currentWeight = +pw.toFixed(3);
    state.cargoWeight   = +cw.toFixed(3);
  }

  // ── 개인 인벤: 무게 초과 여부(추가 가능?) ──
  function canCarry(itemId, qty = 1){
    const def = lookupPersonal(itemId);
    if(!def || qty <= 0) return false;
    return state.currentWeight + def.weight * qty <= state.maxWeight + 1e-9;
  }
  // ── 화물칸: 용량 초과 여부(적재 가능?) ──
  function canLoad(goodsId, qty = 1){
    const def = lookupCargo(goodsId);
    if(!def || qty <= 0) return false;
    return state.cargoWeight + def.weight * qty <= state.cargoCapacity + 1e-9;
  }

  // ── 개인 인벤 추가(무게 검사) — 성공 true / 무게초과·미정의 false ──
  function add(itemId, qty = 1){
    const def = lookupPersonal(itemId);
    if(!def || qty <= 0) return false;
    if(!canCarry(itemId, qty)) return false;
    const slot = state.personal[itemId] || (state.personal[itemId] = { qty: 0, weight: def.weight });
    slot.qty += qty;
    recalc(); refreshHud();
    return true;
  }
  // ── 개인 인벤 차감(제작 재료 소비 = 여기서) — 보유 부족 시 false ──
  function remove(itemId, qty = 1){
    const slot = state.personal[itemId];
    if(!slot || qty <= 0 || slot.qty < qty) return false;
    slot.qty -= qty;
    if(slot.qty <= 0) delete state.personal[itemId];
    recalc(); refreshHud();
    return true;
  }
  // ── 화물 적재(cargoCapacity 검사) ──
  function loadCargo(goodsId, qty = 1){
    const def = lookupCargo(goodsId);
    if(!def || qty <= 0) return false;
    if(!canLoad(goodsId, qty)) return false;
    const slot = state.cargo[goodsId] || (state.cargo[goodsId] = { qty: 0, weight: def.weight });
    slot.qty += qty;
    recalc(); refreshHud();
    return true;
  }
  // ── 화물 하선(보유 부족 시 false) ──
  function unloadCargo(goodsId, qty = 1){
    const slot = state.cargo[goodsId];
    if(!slot || qty <= 0 || slot.qty < qty) return false;
    slot.qty -= qty;
    if(slot.qty <= 0) delete state.cargo[goodsId];
    recalc(); refreshHud();
    return true;
  }
  // ── 금화 가감(무게 없음). 음수로 떨어지면 false(잔액 부족) ──
  function addGold(amount){
    if(state.gold + amount < 0) return false;
    state.gold += amount;
    refreshHud();
    return true;
  }
  // ── 화물칸 용량 변경(증설 등). cargoCapacity는 getter-only라 대입 불가 — 이 메서드로 갱신 ──
  function setCargoCapacity(n){
    state.cargoCapacity = n;
    recalc(); refreshHud();
    return state.cargoCapacity;
  }
  // ── 보유 수량 조회(편의) ──
  function count(itemId){ return (state.personal[itemId]?.qty) || 0; }
  function cargoCount(goodsId){ return (state.cargo[goodsId]?.qty) || 0; }

  // ── 직렬화/복원(서버 동기화 대비 §1-A) — state는 순수 object라 그대로 왕복 가능 ──
  function serialize(){ return JSON.parse(JSON.stringify(state)); }
  function load(snapshot){
    if(!snapshot || typeof snapshot !== 'object') return false;
    state.personal      = snapshot.personal      || {};
    state.maxWeight     = snapshot.maxWeight     ?? state.maxWeight;
    state.cargo         = snapshot.cargo         || {};
    state.cargoCapacity = snapshot.cargoCapacity ?? state.cargoCapacity;
    state.gold          = snapshot.gold          ?? 0;
    recalc(); refreshHud();
    return true;
  }

  // ── (제거됨) 디버그 인벤 HUD — 우상단 개인/화물/금화 패널. uikit keyhints(단축키 힌트)로 대체(combat.js). ──
  //   hud=null 유지 → refreshHud는 자동 no-op(다른 호출처 무해). 금화 등 필요 정보는 인벤 패널·교역소서 확인.
  let hud = null;
  function buildHud(){ /* no-op — 플레이어용 아닌 디버그 표시 제거(사령관) */ }
  function refreshHud(){
    if(!hud) return;
    const pList = Object.keys(state.personal).map(id =>
      `${lookupPersonal(id)?.name || id}×${state.personal[id].qty}`).join(' ') || '(빈)';
    const cList = Object.keys(state.cargo).map(id =>
      `${lookupCargo(id)?.name || id}×${state.cargo[id].qty}`).join(' ') || '(빈)';
    hud.innerHTML =
      `<b style="color:#ffe07a">인벤토리</b><br>`
      + `개인 ${state.currentWeight.toFixed(1)}/${state.maxWeight} <span style="color:#9aa">${pList}</span><br>`
      + `화물 ${state.cargoWeight.toFixed(1)}/${state.cargoCapacity} <span style="color:#9aa">${cList}</span><br>`
      + `<span style="color:#f0d060">◎ 금화 ${state.gold}</span>`;
  }
  buildHud();
  recalc(); refreshHud();

  // ── ctx 등록(콘센트) — 메서드는 여기, 상태는 state(직렬화 가능)로 분리 ──
  ctx.inventory = {
    state,                       // 직렬화 가능한 순수 상태(서버 동기화 대상)
    // 카탈로그(읽기 전용 참조)
    TRADE_GOODS, MATERIALS, FOODS, CARGO_CAPACITY,
    // §9 확정 메서드
    add, remove, loadCargo, unloadCargo, canCarry, canLoad,
    addGold, setCargoCapacity, count, cargoCount,
    serialize, load,
    // 직렬화 필드 getter(편의 — state 직접 접근도 가능)
    get personal(){ return state.personal; },
    get cargo(){ return state.cargo; },
    get gold(){ return state.gold; },
    get currentWeight(){ return state.currentWeight; },
    get maxWeight(){ return state.maxWeight; },
    get cargoWeight(){ return state.cargoWeight; },
    get cargoCapacity(){ return state.cargoCapacity; },
  };

  console.log('[inventory] 콘센트 ② 등록 완료 — personal/cargo 2분할 무게제 + gold. '
    + `maxWeight=${state.maxWeight} cargoCapacity=${state.cargoCapacity}`);
  return ctx.inventory;
}

// [근거]
// 확정:
//  - 개인/화물 2분할 + 둘 다 무게제 + 금화 무게 없음 — _GAME_DESIGN.md §9 확정 구조표.
//  - 메서드 add/remove/loadCargo/unloadCargo/canCarry/canLoad — §9 ctx.inventory 메서드 명세.
//  - TRADE_GOODS(럼·비단·향신료·보석) 수치(weight/basePrice) — §9 TRADE_GOODS 카탈로그.
//  - 목재·돌 교역품 추가(6종) — 작업 지시 "TRADE_GOODS(럼·비단·향신료·보석·목재·돌)".
//  - MATERIALS(목재3·돌4·밧줄1·쇠5) — §9 MATERIALS 카탈로그.
//  - 제작 재료는 personal에서 remove로 차감, 화물은 제작에 안 씀 — §3-B 데이터 흐름.
//  - JSON 직렬화 가능 plain object(state) + 메서드 분리 — §1-A / §9 서버 권위 전제.
//  - 개인 강화/장비 슬롯 없음 — §9 "개인 강화/장비 제작 = 없음".
//  - cargoCapacity 기본 20 / maxWeight 기본 100 — §9 데이터 구조 초안 기본값.
// 미정(비워둠):
//  - FOODS 요리 레시피·식량 종류(§9 "미정") — ration 1종만 자리로 둠.
// 제안(작성자 판단) 추가:
//  - cargoCapacity 배별 차등(caravel40·galleon80·longship30) — 16_밸런스수치_스프링.md §1-2 [제안].
//    플레이테스트 전 잠정값. oseberg20만 §9 확정. 배종 키↔obj 매핑은 vessel.js 빌드 시 정렬.
//  - maxWeight 밸런스 수치(§9 "미정: 밸런스 조정").
//  - 밧줄·쇠 획득 방법(§9 "미정").
// 제안(작성자 판단):
//  - FOODS.ration(nutrition 20) — 생존 연동 자리 확보용 기본 식량. 레시피 미정이라 1종만.
//  - timber/stone을 TRADE_GOODS에도 등재 — §2 "채집 잉여분 판매" 보조 수입원 대응. basePrice는 낮게.
//  - addGold/count/cargoCount/serialize/load — §9 미명시이나 교역(금화 가감)·서버 동기화에 필요해 추가.
