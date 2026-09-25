// faction.js — 축5 세력 선언 시스템 (향후방향.md §13 / 향후방향_v2 최종 축).
//   축1(평판 3축)·축2(섬 성장)·축3(연결)·축4(추종자 로스터)·축6(종족섬)이 누적된 결과를
//   "당신의 이름으로 깃발을 세우겠습니까?"라는 단일 이벤트로 수렴시키는 마지막 신규 시스템.
//
//   §13.1 5개 선언 조건(전부 만족해야 선언 가능):
//     1) 인구      — 플레이어 소유 섬 growth.pop 합계 >= 50
//     2) 성장 거점 — 플레이어 소유 섬 중 growth.lv >= 2(작은마을 이상) 3개 이상
//     3) 교역로    — worldmap.routes 중 양 끝이 모두 내 섬(canonId 매칭)인 항로 2개 이상(claim.js가 점령 시 canonId 기록)
//     4) 추종자    — crew.roster.length >= 5 (crew.MAX_CREW=6로 상향해 충족 여지 확보)
//     5) 평판      — trust/infamy/honor 중 최댓값 >= 150
//
//   §13.2 세력 유형 — 평판 지배축으로 결정, 근소하면 혼합형:
//     신뢰중심 / 악명중심 / 명예중심 / 혼합형 각 3개 후보 중 무작위 명명.
//
//   ★이번 축은 "선언 이벤트 + 이름 부여"까지만. 세력별 게임플레이 효과(버프/전용임무 등)는 향후 과제.
//   ★한 번 선언하면 불변(declared=true). 재선언/이름변경 없음.
//   ★위치 게이트 없음 — 전역 성취라 항구 근처 같은 조건 없이 화면 상단 배너로 상시 노출.

import { toast } from '/tomob-deploy/modules/uikit.js';

// ───────── 밸런스 상수(한 곳에 모음) ─────────
const REQ = {
  POP:        50,   // §13.1 인구
  BASES:       3,   // §13.1 성장한 거점 수
  BASE_LV:     2,   // "성장한" 기준 = Lv2(작은마을) 이상. Lv1 전초기지는 미달.
  ROUTES:      2,   // §13.1 안정 교역로 수
  FOLLOWERS:   5,   // §13.1 추종자 수
  REP:       150,   // 평판 3축 중 최댓값 임계(제안값)
};
const CHECK_INTERVAL = 7;    // 초 — 조건 재계산 주기(매 프레임 X, dt 누적기)
const DOMINANCE_GAP  = 40;   // 평판 1위-2위 격차가 이 미만이면 특정 성향 없음 → 혼합형

// §13.2 세력 유형별 이름 후보(원문 표 그대로)
const FACTION_NAMES = {
  trust:  ['상단연맹', '자유항구', '무역동맹'],
  infamy: ['해적왕국', '검은무역단', '약탈함대'],
  honor:  ['사냥꾼길드', '신성원정대', '괴수토벌단'],
  mixed:  ['망명자들의도시', '바다개척단', '중립항로연합'],
};
const TYPE_LABEL = { trust:'신뢰 중심', infamy:'악명 중심', honor:'명예 중심', mixed:'혼합형' };

export function initFaction(ctx){
  // state = 순수 data(멀티/세이브 왕복 대비 — reputation.js와 동일 관례)
  const state = { declared:false, name:'', type:'' };

  // ── 조건 판정 헬퍼(전부 크래시 세이프: 없는 시스템은 0으로 처리) ──
  function playerIslands(){
    const arr = Array.isArray(ctx.claimed) ? ctx.claimed : [];
    return arr.filter(c => c && c.owner === 'player');
  }
  function repAxes(){
    const r = ctx.reputation || {};
    return { trust: r.trust||0, infamy: r.infamy||0, honor: r.honor||0 };
  }
  // 안정 교역로 — worldmap.routes(섬 id 쌍)에서 양 끝이 모두 내 섬인 항로 수.
  //   ★ctx.worldmap은 game.html에서 initNpc가 채워둠(npc.js T-03 자급) — initFaction은 initNpc 뒤에 등록되므로 실제로 채워져 있음.
  //   ★claim.js가 점령 시 island.canonId(가장 가까운 canon 섬 id)를 기록해둠 — 이 필드로 매칭(2026-07-10 추가).
  function countStableRoutes(isl){
    const wm = ctx.worldmap;
    if(!wm || !Array.isArray(wm.routes) || !wm.routes.length) return 0;
    const ids = new Set(isl.map(c => c.canonId).filter(v => v != null));
    if(!ids.size) return 0;
    let n = 0;
    for(const r of wm.routes){ if(r && ids.has(r.from) && ids.has(r.to)) n++; }
    return n;
  }

  // 5개 조건 각각의 현재값/필요값/충족여부(디버그·향후 UI용 공개 API)
  function conditions(){
    const isl  = playerIslands();
    const pop  = isl.reduce((s,c) => s + ((c.growth && c.growth.pop) || 0), 0);
    const bases= isl.filter(c => ((c.growth && c.growth.lv) || 0) >= REQ.BASE_LV).length;
    const rts  = countStableRoutes(isl);
    const foll = (ctx.crew && ctx.crew.roster && ctx.crew.roster.length) || 0;
    const ax   = repAxes();
    const peak = Math.max(ax.trust, ax.infamy, ax.honor);
    return {
      population: { have:pop,   need:REQ.POP,       ok: pop  >= REQ.POP },
      bases:      { have:bases, need:REQ.BASES,     ok: bases>= REQ.BASES },
      routes:     { have:rts,   need:REQ.ROUTES,    ok: rts  >= REQ.ROUTES },
      followers:  { have:foll,  need:REQ.FOLLOWERS, ok: foll >= REQ.FOLLOWERS },
      reputation: { have:peak,  need:REQ.REP,       ok: peak >= REQ.REP },
    };
  }
  function canDeclare(){
    if(state.declared) return false;
    const c = conditions();
    return c.population.ok && c.bases.ok && c.routes.ok && c.followers.ok && c.reputation.ok;
  }

  // ── 세력 유형 판정 — 지배축(1위)이 2위보다 DOMINANCE_GAP 이상 앞서면 그 성향, 아니면 혼합형 ──
  function pickType(){
    const ax = repAxes();
    const sorted = [['trust',ax.trust], ['infamy',ax.infamy], ['honor',ax.honor]].sort((a,b)=> b[1]-a[1]);
    const top = sorted[0], second = sorted[1];
    if((top[1] - second[1]) < DOMINANCE_GAP) return 'mixed';   // 근소 = 뚜렷한 성향 없음
    return top[0];
  }

  // ── declare(): 세력 확정(1회성) ──
  function declare(){
    if(state.declared) return null;
    if(!canDeclare()) return null;
    const type = pickType();
    const pool = FACTION_NAMES[type] || FACTION_NAMES.mixed;
    const name = pool[(Math.random()*pool.length)|0];
    state.declared = true; state.type = type; state.name = name;
    try{ toast(`당신의 이름으로 깃발을 세웠다 — ${name} (${TYPE_LABEL[type]})`, { accent:'gold', ms:5200 }); }catch(_){}
    try{ ctx.events && ctx.events.emit && ctx.events.emit('factionDeclared', { name, type }); }catch(_){}
    hideBanner(); closeConfirm();
    console.log('[faction] 세력 선언 —', name, '·', type);
    return { name, type };
  }

  // ── UI: 상시 상단 중앙 배너(선언 가능 시 표시) — 다른 패널과 겹치지 않게 top 배치 ──
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:60;display:none;cursor:pointer;'
    + 'padding:9px 22px;background:linear-gradient(180deg,rgba(52,40,14,.94),rgba(30,22,8,.94));'
    + 'border:1px solid rgba(255,215,120,.55);border-radius:24px;'
    + "color:#ffe9a8;font:bold 15px Pretendard,system-ui,'Malgun Gothic';white-space:nowrap;"
    + 'box-shadow:0 4px 18px rgba(0,0,0,.45);text-shadow:0 1px 2px #000;user-select:none';
  banner.textContent = '⚑ 세력 선언 가능 — 클릭하여 선언';
  banner.addEventListener('click', openConfirm);
  document.body.appendChild(banner);
  function hideBanner(){ banner.style.display = 'none'; }

  // ── 확인 팝업(간단 DOM — settlement 패널 수준) ──
  let popup = null;
  function openConfirm(){
    if(state.declared || !canDeclare() || popup) return;
    popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;inset:0;z-index:61;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    const box = document.createElement('div');
    box.style.cssText = 'min-width:320px;max-width:420px;background:rgba(16,22,30,.98);border:2px solid rgba(255,215,120,.5);'
      + "border-radius:16px;padding:24px 26px;color:#eef2f6;font:15px Pretendard,system-ui,'Malgun Gothic';"
      + 'text-align:center;box-shadow:0 14px 44px rgba(0,0,0,.55)';
    box.innerHTML =
      '<div style="font:bold 20px Pretendard,system-ui;color:#ffe07a;margin-bottom:12px">⚑ 세력 선언</div>'
      + '<div style="line-height:1.75;color:#cfdae6;margin-bottom:20px">당신의 이름으로 깃발을 세우겠습니까?'
      + '<br><span style="font-size:12px;color:#8a97a5">한 번 선언하면 되돌릴 수 없습니다.</span></div>'
      + '<div style="display:flex;gap:10px;justify-content:center">'
      + '<button id="fac-yes" style="padding:9px 18px;border-radius:9px;border:1px solid rgba(255,215,120,.6);background:rgba(120,92,24,.85);color:#fff2cf;font:bold 14px inherit;cursor:pointer">깃발을 세운다</button>'
      + '<button id="fac-no" style="padding:9px 18px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:rgba(40,48,58,.8);color:#cbd4de;font:14px inherit;cursor:pointer">취소</button>'
      + '</div>';
    popup.appendChild(box);
    document.body.appendChild(popup);
    try{ document.exitPointerLock && document.exitPointerLock(); }catch(_){}
    box.querySelector('#fac-yes').addEventListener('click', declare);
    box.querySelector('#fac-no').addEventListener('click', closeConfirm);
    popup.addEventListener('click', e => { if(e.target === popup) closeConfirm(); });
  }
  function closeConfirm(){ if(popup){ popup.remove(); popup = null; } }

  // ── 주기 체크(dt 누적기 — settlement.tickIncome/tickGrowth 패턴) ──
  let _acc = 0;
  ctx.onUpdate(dt => {
    _acc += dt || 0;
    if(_acc < CHECK_INTERVAL) return;
    _acc = 0;
    if(state.declared){ hideBanner(); return; }
    banner.style.display = canDeclare() ? 'block' : 'none';
  });

  // ── 직렬화 왕복(세이브/멀티 — reputation.js와 동일 패턴) ──
  function serialize(){ return { declared:state.declared, name:state.name, type:state.type }; }
  function restore(snap){
    if(!snap) return;
    state.declared = !!snap.declared;
    state.name = String(snap.name || '');
    state.type = String(snap.type || '');
    if(state.declared) hideBanner();
  }

  // ── ctx 등록(공개 API) ──
  ctx.faction = {
    get declared(){ return state.declared; },
    get name(){ return state.name; },
    get type(){ return state.type; },
    canDeclare, declare, conditions, serialize, restore,
  };
  console.log('[faction] 세력 선언 시스템 등록 — 5조건(인구'+REQ.POP+'/거점'+REQ.BASES+'/교역로'+REQ.ROUTES+'/추종자'+REQ.FOLLOWERS+'/평판'+REQ.REP+') 주기'+CHECK_INTERVAL+'s 체크');
  return ctx.faction;
}

// [근거]
// 확정:
//  - 5개 선언 조건 수치(인구 50·거점 3·교역로 2·추종자 5·평판축 1개 일정 이상) = 향후방향.md §13.1 원문.
//  - 세력 유형 4분류(신뢰/악명/명예/혼합)·유형별 이름 후보 3개씩 = 향후방향.md §13.2 표 그대로.
//  - "성장한 거점" = Lv2(작은마을) 이상 = settlement.js recalcLv 임계(Lv1→2: pop>=10) 정합.
//  - 추종자 5명 = crew.MAX_CREW 4→6 상향 후 충족 가능(crew.js 동반 수정).
//  - island.growth={pop,stability,prosperity,influence,lv} 참조 = settlement.js 축2 필드.
//  - worldmap.routes={from,to} 섬 id 쌍 = worldmap.js generateWorldMap 산출.
// 제안:
//  - 평판 임계 150 = 앤 제안값(reputation은 상한 없는 누적 게이지 → 유의미한 위상 도달 지점 추정).
//  - 혼합형 판정 = 1위-2위 격차 < 40이면 mixed = 제안(뚜렷한 성향 부재를 격차로 정의).
//  - 체크 주기 7s = 제안(매 프레임 회피 + 반응성 절충).
// 미정:
//  - 세력별 게임플레이 효과(버프/전용 임무/전용 UI) — 이번 축 범위 밖(향후 과제).
// 추가 수정(앤, 2026-07-10): 교역로 조건이 실제로는 항상 0이던 버그 발견·수정.
//  - 원인: claim.js가 점령섬 객체에 canon 섬 id를 전혀 기록 안 해서(id 필드 자체가 없었음) countStableRoutes의
//    ids 집합이 항상 비어 조건이 영구 미충족이었음(ctx.worldmap 미등록 문제가 아니라 — initNpc가 initFaction보다
//    먼저 실행되므로 ctx.worldmap 자체는 이미 채워져 있었음).
//  - 수정: claim.js에 nearestCanonId(x,z)(3D→canon 좌표 변환 후 최근접 canon 섬 탐색) 추가, 점령 시 island.canonId에
//    기록. 이 파일은 c.id 대신 c.canonId로 매칭하도록 변경. claim.js가 WORLD_SCALE(islands.js)을 신규 참조.
