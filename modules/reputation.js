// reputation.js — 콘센트 ③ 평판/현상금 (3축 체제). _GAME_DESIGN.md §5 + 향후방향_v2 §13 반영.
//
//   ctx.reputation — 플레이어의 해양 사회적 위상. 단일 score(-100~+100) 폐기 → 3축 누적 게이지로 대체.
//   • trust   : 신뢰 — 교역/평화적 확장으로 누적 (0부터 상승, 감소 없음)
//   • infamy  : 악명 — 약탈/침략/배신으로 누적 (페널티: 현상금·입항거부·거래불이익 유발)
//   • honor   : 명예 — 토벌/의뢰 완수로 누적
//   • bounty     : 현상금액(gold 단위) — 악명에서 파생
//   • bountyActive: 현상금 사냥꾼 활성 여부 — 악명에서 파생
//   • lastAction : 마지막 평판 변동 원인(로그용)
//   각 축은 독립적으로 0부터 누적되는 게이지(제로섬 아님). 한 행동은 정확히 1개 축만 올린다.
//   하한 0, 상한 없음(값 자체는 무제한 누적) — UI/모디파이어 계산에서만 AXIS_MAX로 클램프.
//   메서드: applyAction(key) / change(delta,reason) / canEnterPort(portId) / getTradeModifier() / serialize / restore
//
// ★서버 권위 전제(§1-A·§9): 데이터(state)는 JSON 직렬화 가능한 plain object만.
//   메서드는 ctx.reputation에 붙지만 "진실"은 state. 멀티에서는 서버가 state를 broadcast하고
//   클라이언트는 받은 state로 restore 하면 됨(메서드는 서버 측 동일 로직 재사용).
//   → serialize()/restore()로 직렬화 왕복을 명시적으로 보장.

// ───────── 밸런스 상수 (조정 쉽게 한 곳에 모음) ─────────
export const REP = {
  AXIS_MIN:          0,   // 각 축 하한 (누적 게이지라 실제로 0 밑으로 안 감; 안전용)
  AXIS_MAX:        100,   // 각 축 표시/보정 계산용 상한 (실제 누적값은 무제한, 클램프는 표시·모디파이어에만)
  BASE:              0,   // 시작값 (세 축 모두 0)
  BOUNTY_THRESHOLD: 30,   // 악명 이 값 "이상"이면 현상금 발동 (§5)
  PORT_REFUSE:      50,   // 악명 이 값 "이상"이면 항구 입항 거부 (§5 연쇄패널티 1)
  BOUNTY_K:          5,   // 현상금 = infamy * k  (§5)
};

// ───────── 영향 메카닉 (§5 표) — 3축 재분류 ─────────
// 각 행동은 axis(신뢰/악명/명예) 1개에 amount(양수)만 누적. 기존 단일축 delta의 부호는 폐기,
// 크기(소량/중/대/극대)는 유지하며 "어느 축을 올리는가"로 성격을 표현한다.
//   축 매핑 근거:
//   - trust  : 정상 거래·비폭력 확장 = 사회적 신뢰 축적
//   - infamy : 침략·약탈·배신 = 악명 축적 (기존 음수 delta 행동이 여기로 흡수)
//   - honor  : 해적 토벌·의뢰 완수 = 영웅적 명예 축적
export const REP_ACTIONS = {
  TRADE_DONE:      { axis:'trust',  amount:  3, label:'교역 완료' },        // 신뢰+소량 — 정상 거래
  CLAIM_EMPTY:     { axis:'trust',  amount:  8, label:'무인도 점령' },      // 신뢰+중   — 평화적 개발/확장
  CLAIM_ENEMY:     { axis:'infamy', amount:  8, label:'타 진영 섬 점령' },  // 악명+중   — 적대적 침략(기존 -8)
  ATTACK_MERCHANT: { axis:'infamy', amount: 20, label:'일반 상선 공격' },   // 악명+대   — 약탈(기존 -20)
  ATTACK_ALLY:     { axis:'infamy', amount: 40, label:'아군 상선 공격' },   // 악명+극대 — 배신(기존 -40)
  KILL_PIRATE:     { axis:'honor',  amount: 10, label:'해적선 격파' },      // 명예+중   — 토벌(해전 전용)
  KILL_MONSTER:    { axis:'honor',  amount:  5, label:'몬스터 처치' },      // 명예+소   — 일반 몬스터 토벌(ctx.monsters, 축3 연결)
  QUEST_DONE:      { axis:'honor',  amount: 25, label:'의뢰 완수' },        // 명예+대   — CTA/의뢰 = 영웅적 행위
};

// 교역 가격 보정계수 범위 (§5: getTradeModifier 0.5~1.5)
const TRADE_MOD_MIN = 0.5;
const TRADE_MOD_MAX = 1.5;
const AXES = ['trust','infamy','honor'];

const clamp = (v,a,b)=> v<a?a : v>b?b : v;

export function initReputation(ctx){
  // ── state: JSON 직렬화 가능한 plain object (메서드 없음, 숫자/문자/불리언만) ──
  const state = {
    trust:       REP.BASE,
    infamy:      REP.BASE,
    honor:       REP.BASE,
    bounty:      0,
    bountyActive:false,
    lastAction:  '',
  };

  // ── bounty 재계산 (악명 축에서 파생) ──
  function recalcBounty(){
    if(state.infamy >= REP.BOUNTY_THRESHOLD){
      state.bountyActive = true;
      state.bounty = Math.round(state.infamy * REP.BOUNTY_K);
    } else {
      state.bountyActive = false;
      state.bounty = 0;
    }
  }

  // ── changeAxis(axis, amount, reason): 지정 축에 양수 누적 (내부 진짜 mutator) ──
  function changeAxis(axis, amount, reason=''){
    if(!AXES.includes(axis)){ console.warn('[reputation] unknown axis:', axis); return; }
    // ★E3(2026-07-15): 교회(church) repBonus 배선 — 좋은 평판(신뢰·명예) 획득 시 제국 전체 교회 수만큼 소량 가산.
    //   effectGlobal 재사용(craftDisc와 동일 패턴, 위치 무관). 악명(infamy)엔 미적용 — 평판↑만. 정수 유지(누적 관례).
    const rb = (amount>0 && (axis==='trust'||axis==='honor') && ctx.settlement?.effectGlobal) ? (ctx.settlement.effectGlobal('repBonus')||0) : 0;
    const gain = amount + rb;
    state[axis] = Math.max(REP.AXIS_MIN, state[axis] + gain);   // 하한 0, 상한 없음
    state.lastAction = reason || '';
    recalcBounty();
    refreshHud();
    console.log(`[reputation] ${axis} +${gain}${rb?`(교회+${rb})`:''} (${reason||'?'}) → trust=${state.trust} infamy=${state.infamy} honor=${state.honor} bounty=${state.bounty} active=${state.bountyActive}`);
  }

  // ── change(delta, reason): 레거시 호환 시그니처 유지용 shim (§ 외부 호출부 없음, 인터페이스 동결만) ──
  //   3축 체제엔 단일 delta 개념이 없다. 옛 의미(양수=선행, 음수=악행)를 최대한 보존해
  //   delta>0 → 신뢰, delta<0 → 악명(절대값)으로 라우팅한다. 신규 코드는 applyAction 사용 권장.
  function change(delta, reason=''){
    const d = Number(delta)||0;
    if(d >= 0) changeAxis('trust',  d,        reason);
    else       changeAxis('infamy', Math.abs(d), reason);
  }

  // ── applyAction(key): §5 표의 이름있는 행동을 해당 축에 누적 ──
  //   교역/점령/전투 시스템이 reputation 내부 수치를 몰라도 의미만으로 호출 가능(콘센트 동결).
  function applyAction(key){
    const a = REP_ACTIONS[key];
    if(!a){ console.warn('[reputation] unknown action:', key); return; }
    changeAxis(a.axis, a.amount, a.label);
  }

  // ── canEnterPort(portId): 입항 가능 여부 (§5 연쇄패널티 1: 악명 ≥ 50 거부) ──
  //   portId는 인터페이스 동결용 인자(섬별 차등은 미정 — 현재는 전역 게이트만).
  function canEnterPort(portId){
    return state.infamy < REP.PORT_REFUSE;   // 악명 50 "이상" 거부 → 50 미만이어야 입항
  }

  // ── getTradeModifier(): 교역 가격 보정계수 0.5~1.5 (§5 연쇄패널티 2) ──
  //   신뢰 높을수록 유리(+0.5까지), 악명 높을수록 불리(-0.5까지). 표시상한 AXIS_MAX 기준 정규화.
  //   신뢰100/악명0 → 1.5, 신뢰0/악명0 → 1.0, 신뢰0/악명100 → 0.5.
  function getTradeModifier(){
    const t = clamp(state.trust,  0, REP.AXIS_MAX) / REP.AXIS_MAX;   // 0~1
    const i = clamp(state.infamy, 0, REP.AXIS_MAX) / REP.AXIS_MAX;   // 0~1
    const mod = 1.0 + t*0.5 - i*0.5;
    return clamp(mod, TRADE_MOD_MIN, TRADE_MOD_MAX);
  }

  // ── 직렬화 왕복 (멀티 서버 동기화 대비 — §1-A JSON 직렬화 전제) ──
  function serialize(){ return JSON.parse(JSON.stringify(state)); }   // 순수 data object
  function restore(snap){
    if(!snap) return;
    state.trust  = Math.max(REP.AXIS_MIN, Number(snap.trust)||0);
    state.infamy = Math.max(REP.AXIS_MIN, Number(snap.infamy)||0);
    state.honor  = Math.max(REP.AXIS_MIN, Number(snap.honor)||0);
    state.lastAction = String(snap.lastAction||'');
    recalcBounty();   // bounty/bountyActive는 악명에서 재파생(신뢰 가능)
    refreshHud();
  }

  // ── 평판 HUD 데이터 (표시는 인벤토리 '상태' 탭으로 흡수 — 디버그 박스는 숨김. refreshHud 로직은 유지) ──
  const hud = document.createElement('div');
  hud.style.cssText = 'display:none;position:fixed;right:12px;top:520px;z-index:7;background:rgba(10,16,24,.78);color:#cfe0f0;font:bold 12px system-ui;padding:6px 12px;border-radius:9px;pointer-events:none;line-height:1.6;min-width:150px';
  document.body.appendChild(hud);
  function refreshHud(){
    // ★E1(2026-07-15): 평시엔 숨김, 악명이 페널티 임계(현상금 발동선) 이상일 때만 노출 — 플레이어가 페널티를 실제로 인지.
    hud.style.display = (state.infamy >= REP.BOUNTY_THRESHOLD) ? 'block' : 'none';
    const port = canEnterPort('*') ? '입항 가능' : '입항 거부';
    hud.innerHTML =
      `신뢰 <b style="color:#7fe39a">${state.trust}</b>`
      + ` · 악명 <b style="color:#ff8a8a">${state.infamy}</b>`
      + ` · 명예 <b style="color:#ffd060">${state.honor}</b><br>`
      + `<span style="color:#8aa">×${getTradeModifier().toFixed(2)} 거래 · ${port}</span><br>`
      + (state.bountyActive
          ? `<span style="color:#ff7a7a">현상금 ${state.bounty}</span>`
          : `<span style="color:#6a8">현상금 없음</span>`)
      + (state.lastAction ? `<br><span style="color:#789;font-weight:normal">최근: ${state.lastAction}</span>` : '');
  }
  refreshHud();

  // ── ctx 등록 (계약 동결 인터페이스) ──
  ctx.reputation = {
    // 3축 개별 getter (읽기 — 다른 시스템/세력선언 §13이 참조)
    get trust(){ return state.trust; },
    get infamy(){ return state.infamy; },
    get honor(){ return state.honor; },
    // 파생 상태 getter
    get bounty(){ return state.bounty; },
    get bountyActive(){ return state.bountyActive; },
    get lastAction(){ return state.lastAction; },
    // 메서드 (동결 인터페이스 §5)
    change, canEnterPort, getTradeModifier,
    // 보조
    applyAction,            // §5 표 행동 적용(TRADE_DONE 등)
    actions: REP_ACTIONS,   // 행동 카탈로그 노출(읽기)
    consts: REP,            // 임계 상수 노출(읽기)
    serialize, restore,     // JSON 직렬화 왕복(멀티 동기화)
    toJSON: serialize,      // JSON.stringify(ctx.reputation) 시 순수 data
  };

  console.log('[reputation] 초기화 완료 — ctx.reputation 등록(3축). trust/infamy/honor=0, 임계:',
    `현상금 악명>=${REP.BOUNTY_THRESHOLD}, 입항거부 악명>=${REP.PORT_REFUSE}, k=${REP.BOUNTY_K}`);
  return ctx.reputation;
}
