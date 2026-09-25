// trade.js — 교역(저가매수·고가매도). mas main.js 3754~(교역품 산지/타지 가격차) 핵심.
// ★v2 콘센트 갱신: 자체 gold/carried 폐기 → ctx.inventory(화물칸·금화) + ctx.reputation(가격 보정) 연동.
//   §2 경제: 섬 A 저가 매수 → 섬 B 고가 매도 차익. 교역품 = TRADE_GOODS(럼·비단·향신료·보석).
//   §5 평판: 섬 시세에 ctx.reputation.getTradeModifier()(0.5~1.5) 곱 → 평판 높을수록 절대 차익 증폭.
//   교역 완료 시 ctx.reputation.applyAction('TRADE_DONE')(+3, §5 표). 콘센트 구조는 호출만(수정 금지).
import { TRADE_GOODS, MATERIALS } from '/tomob-deploy/modules/inventory.js';   // basePrice/name 단일 출처(읽기 전용 참조)
import { BAL } from '/tomob-deploy/modules/balance.js';   // 🔮 영혼 상점 가격/효과 SSOT (soulShop)
import { tribeById } from '/tomob-deploy/modules/tribes.js';   // 🏴 섬 소유 종족 → 특산품 시세

export function initTrade(ctx){
  // 교역 4종(§2 명시: 럼·비단·향신료·보석) + 🏭 가공 교역품(P6: 판재·벽돌 — 채집→가공→판매 마진). basePrice는 콘센트 카탈로그에서.
  const GOODS = ['rum','silk','spice','gem','plank','brick'].map(k => ({ k, name: TRADE_GOODS[k].name, base: TRADE_GOODS[k].basePrice, personal:false }));
  // ★BUG-009 수정(2026-07-13): 채광 광물은 화물칸이 아니라 개인 인벤(personal)에 쌓임 — GOODS에 없어 판매 불가였음.
  //   personal:true 항목은 화물칸이 아니라 개인 인벤 재고를 팔며(구매 불가, 채광 전용), buy/sell/cargoCount가 이 플래그로 분기.
  const ORE_KEYS = ['iron','copper','tin','cobalt','gold','silver','coal'];
  for(const k of ORE_KEYS){ const m = MATERIALS[k]; if(m && m.basePrice != null) GOODS.push({ k, name: m.name, base: m.basePrice, personal:true }); }

  // 인벤토리 콘센트 필수(금화·화물칸 보유처). 없으면 교역 불가 — 경고만(크래시 금지).
  if(!ctx.inventory){ console.warn('[trade] ctx.inventory 없음 — 교역 비활성(인벤 콘센트 먼저 로드 필요).'); return null; }
  const inv = ctx.inventory;

  // ── 평판 보정계수(0.5~1.5). reputation 미로드 시 1.0(중립) ──
  const mod = () => ctx.reputation ? ctx.reputation.getTradeModifier() : 1.0;

  // ── 섬별 시세: basePrice × 섬해시(0.55~1.55) × 평판보정. 매수=매도 동일가(같은 섬 차익 0 → 섬 간 차익만) ──
  function isleFactor(g, isle){ const s=Math.sin(isle.ix*12.9+isle.iz*78.2+g.base*3.1)*43758.5; return 0.55+(s-Math.floor(s)); }
  // ★시세 출처: npc(살아있는 수급) 있으면 npc.priceAt(가장 가까운 항구) × 평판보정. 없으면 자체 해시(sandbox 단독 폴백).
  function priceOf(g, isle){
    let base;
    if(ctx.npc && ctx.npc.priceAt && isle && isle.portId){ const p=ctx.npc.priceAt(isle.portId, g.k); base = (p!=null) ? p*mod() : g.base*isleFactor(g,isle)*mod(); }
    else base = g.base * isleFactor(g, isle) * mod();
    // 🏴 부족 특산품: 그 종족 섬에선 그 품목이 싸다(매수·매도 대칭 → 동일섬 차익 없음, 타지 매도로만 이득)
    if(isle && isle.tribe){ const t=tribeById(isle.tribe); if(t && t.good===g.k) base *= 0.6; }
    return Math.max(1, Math.round(base));
  }

  // ── 현재 발밑 섬(육지에서만 교역). groundAt<1 → 바다 → null. npc 있으면 가장 가까운 항구 id 부착 ──
  // 이 좌표 섬의 소유/종족 판정 — 내 영토(ctx.claimed) 우선, 아니면 가장 가까운 부족 거점(ctx.outposts).
  function islandInfoAt(x, z){
    if(ctx.claimed){ for(const c of ctx.claimed){ if(c.owner==='player' && Math.hypot(c.x-x,c.z-z) < (c.r||40)+20) return { owner:'player', tribe:null }; } }
    if(ctx.outposts){ let best=null,bd=1e9; for(const o of ctx.outposts){ const d=Math.hypot(o.x-x,o.z-z); if(d<bd){ bd=d; best=o; } }
      if(best && bd < 250) return { owner:best.owner, tribe:best.tribe }; }   // 250m 내 거점 = 이 섬의 종족
    return { owner:null, tribe:null };
  }
  function isleAt(){ const pp=ctx.player.pos; const gy=ctx.terrain?ctx.terrain.groundAt(pp.x,pp.z,pp.y+6):0; if(gy<1) return null;
    const r={ ix:Math.round(pp.x/25)*25, iz:Math.round(pp.z/25)*25 };
    if(ctx.npc && ctx.npc.nearestPort) r.portId=ctx.npc.nearestPort(pp.x, pp.z);
    const info=islandInfoAt(pp.x, pp.z); r.tribe=info.tribe; r.owner=info.owner;   // 🏴 종족·소유 부착
    return r; }

  // ── 거래 실행(패널 버튼 + 검증 스크립트 공용 API) ──
  //   매수: 금화 차감 + 화물 적재(loadCargo). 화물칸/금화 부족 시 거부.
  function buy(k){ const g=GOODS.find(x=>x.k===k); if(!g||!isle) return { ok:false, reason:'no-isle' };   // isle = 교역창 연 항구(NPC/발밑)
    if(g.personal){ flash('채광 전용 — 구매 불가'); return { ok:false, reason:'not-buyable' }; }   // 광물은 채광으로만 획득
    const price=priceOf(g, isle);
    if(!inv.canLoad(k,1)){ flash('화물칸 가득'); return { ok:false, reason:'cargo-full', price }; }
    if(inv.gold < price){ flash('금화 부족'); return { ok:false, reason:'no-gold', price }; }
    inv.addGold(-price); inv.loadCargo(k,1);                  // 금화↓ + 화물↑
    if(ctx.reputation) ctx.reputation.applyAction('TRADE_DONE');   // 평판 +소량(§5 TRADE_DONE)
    if(ctx.settlement && ctx.settlement.nearestOwned && ctx.settlement.bumpGrowth){   // 🌱 축3 연결: 내 섬 근처 거래 → 그 섬 성장(소유 섬 없으면 no-op)
      const owned = ctx.settlement.nearestOwned(isle.ix, isle.iz);
      if(owned){ ctx.settlement.bumpGrowth(owned, 'prosperity', 2); ctx.settlement.bumpGrowth(owned, 'pop', 1); }
    }
    if(ctx.npc && ctx.npc.applyPlayerTrade && isle.portId) ctx.npc.applyPlayerTrade(isle.portId, k, true);   // 매수→그 항구 수요↑(시세↑)
    refreshHud(); render(); flash(`${g.name} 매수 −${price}`); ctx.sound?.play?.('success'); return { ok:true, price };   // ★성공음
  }
  //   매도: 화물 하선(unloadCargo) + 금화 가산. 재고 없으면 거부.
  function sell(k){ const g=GOODS.find(x=>x.k===k); if(!g||!isle) return { ok:false, reason:'no-isle' };   // isle = 교역창 연 항구(NPC/발밑)
    const have = g.personal ? inv.count(k) : inv.cargoCount(k);
    if(have<=0){ flash('재고 없음'); return { ok:false, reason:'no-stock' }; }
    const mkt = ctx.settlement?.sellMulAt ? ctx.settlement.sellMulAt(isle.ix, isle.iz) : 1;   // 🏛️ 시장 건물 = 그 섬 판매가↑ (거점 특화)
    const price = Math.round(priceOf(g, isle) * mkt);
    if(g.personal) inv.remove(k,1); else inv.unloadCargo(k,1); inv.addGold(price);   // 개인인벤↓ 또는 화물↓ + 금화↑
    if(ctx.reputation) ctx.reputation.applyAction('TRADE_DONE');
    if(ctx.settlement && ctx.settlement.nearestOwned && ctx.settlement.bumpGrowth){   // 🌱 축3 연결: 내 섬 근처 거래 → 그 섬 성장(소유 섬 없으면 no-op)
      const owned = ctx.settlement.nearestOwned(isle.ix, isle.iz);
      if(owned){ ctx.settlement.bumpGrowth(owned, 'prosperity', 2); ctx.settlement.bumpGrowth(owned, 'pop', 1); }
    }
    if(ctx.npc && ctx.npc.applyPlayerTrade && isle.portId) ctx.npc.applyPlayerTrade(isle.portId, k, false);  // 매도→그 항구 공급↑(시세↓)
    refreshHud(); render(); flash(`${g.name} 매도 +${price}`); ctx.sound?.play?.('success'); return { ok:true, price };   // ★성공음
  }

  // ── 🔮 영혼 상점: 토모브의 영혼(soul)으로 힐포션/부활석 구매 (교역소 추종자 판매). BAL.soulShop. ──
  function buySoul(kind){ const cb=ctx.combat; if(!cb){ flash('전투 시스템 없음'); return { ok:false }; }
    const cfg = kind==='potion' ? BAL.soulShop.potion : BAL.soulShop.revive;
    const itemId = kind==='potion' ? 'potion' : 'revivestone', nm = kind==='potion' ? '힐링 포션' : '부활석';
    if(cb.soul < cfg.price){ flash('영혼 부족 ('+cb.soul+'/'+cfg.price+')'); return { ok:false, reason:'no-soul' }; }
    if(!inv.canCarry(itemId,1)){ flash('소지 무게 초과'); return { ok:false, reason:'weight' }; }
    if(!cb.spendSoul(cfg.price)){ flash('영혼 부족'); return { ok:false }; }
    inv.add(itemId,1); if(ctx.updHotbar)ctx.updHotbar();
    render(); flash(''+nm+' 구매 −'+cfg.price+' 영혼'); ctx.sound?.play?.('success'); return { ok:true }; }

  // ── 교역 패널 ──
  let panel=null, open=false, isle=null;
  function render(){ if(!panel||!isle) return;
    const m=mod();
    let h='<div style="font:bold 16px system-ui;color:#ffe07a;margin-bottom:4px;">교역소 (섬 '+isle.ix+','+isle.iz+')</div>'
      +'<div style="font:12px system-ui;color:#8aa;margin-bottom:10px;">◎ 금화 '+inv.gold+' · 평판보정 ×'+m.toFixed(2)+' · 화물 '+inv.cargoWeight.toFixed(1)+'/'+inv.cargoCapacity+'</div>';
    for(const g of GOODS){ const pr=priceOf(g, isle), have=(g.personal?inv.count(g.k):inv.cargoCount(g.k));
      h+='<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font:13px system-ui;color:#cfe0f0;">'
        +'<span style="width:80px;">'+g.name+'</span><span style="width:78px;color:#f0d060;">'+pr+' 금화</span><span style="width:54px;color:#9aa;">보유 '+have+'</span>'
        +(g.personal ? '<span style="width:74px;font:11px system-ui;color:#678;">채광 전용</span>' : '<button data-buy="'+g.k+'" style="padding:4px 12px;border-radius:6px;border:1px solid #3a6b46;background:#1d3a28;color:#bfe;cursor:pointer;">사기</button>')
        +'<button data-sell="'+g.k+'" style="padding:4px 12px;border-radius:6px;border:1px solid #6b3a3a;background:#3a1d1d;color:#ecb;cursor:pointer;">팔기</button></div>'; }
    h+='<div style="margin-top:10px;color:#8aa;font:12px system-ui;">싸게 사서 다른 섬에서 비싸게 팔면 차익 · 평판↑ 차익 증폭 · T/ESC 닫기</div>';
    // 🔮 영혼 상점(추종자 판매) — 토모브의 영혼으로 소모품 구매
    const soulN = ctx.combat ? ctx.combat.soul : 0;
    h+='<div style="margin-top:14px;padding-top:11px;border-top:1px solid #2a3a4a;font:bold 14px system-ui;color:#c9b6ff;">영혼 상점 <span style="font-weight:400;color:#8aa;font-size:12px;">— 토모브의 영혼 '+soulN+'</span></div>';
    for(const it of [{k:'potion',nm:'힐링 포션',pr:BAL.soulShop.potion.price,dsc:'HP+'+BAL.soulShop.potion.heal+' · H키',have:inv.count('potion')},
                     {k:'revive',nm:'부활석',   pr:BAL.soulShop.revive.price,dsc:'사망 시 제자리 부활 '+Math.round(BAL.soulShop.revive.hpPct*100)+'%',have:inv.count('revivestone')}]){
      h+='<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font:13px system-ui;color:#cfe0f0;">'
        +'<span style="width:96px;">'+it.nm+'</span><span style="width:70px;color:#c9b6ff;">'+it.pr+' 영혼</span><span style="width:150px;color:#9aa;font-size:12px;">'+it.dsc+' · 보유'+it.have+'</span>'
        +'<button data-soul="'+it.k+'" style="padding:4px 12px;border-radius:6px;border:1px solid #4a3a6b;background:#241d3a;color:#dcd;cursor:pointer;">구매</button></div>'; }
    panel.querySelector('#tradeWin').innerHTML=h;
    panel.querySelectorAll('[data-buy]').forEach(btn=>btn.onclick=()=>buy(btn.dataset.buy));
    panel.querySelectorAll('[data-sell]').forEach(btn=>btn.onclick=()=>sell(btn.dataset.sell));
    panel.querySelectorAll('[data-soul]').forEach(btn=>btn.onclick=()=>buySoul(btn.dataset.soul));
  }
  function ensurePanel(){ if(!panel){ panel=document.createElement('div'); panel.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:31;background:rgba(12,20,30,.95);border:2px solid #3a4a60;border-radius:14px;padding:20px 26px;min-width:430px;box-shadow:0 8px 30px rgba(0,0,0,.6);';
    // ★X 닫기 버튼(사령관: 교역창 X 없어서 못 닫음). openPanel은 #tradeWin만 갱신하므로 X는 형제로 유지됨. ESC도 병행.
    panel.innerHTML='<div id="tradeCloseX" title="닫기 (ESC)" style="position:absolute;top:8px;right:10px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#9fb2c4;font:16px system-ui;border:1px solid #3a4a60;border-radius:7px;background:rgba(0,0,0,.3);user-select:none;">✕</div><div id="tradeWin"></div>';
    document.body.appendChild(panel);
    panel.querySelector('#tradeCloseX').addEventListener('click', close);
  } }
  function openPanel(){ ensurePanel(); open=true; panel.style.display='block'; document.exitPointerLock&&document.exitPointerLock(); render(); }
  function toggle(){ if(open){ close(); return; } isle=isleAt(); if(!isle){ flash('육지(섬)에서만 교역'); return; } openPanel(); }
  // ★교역소 NPC 경유 — 그 NPC가 선 항구(x,z)의 시세로 교역창. 발밑 육지 판정 우회(기획: 점령 항구 NPC를 통해 거래).
  function openWith(x, z){ if(open){ close(); return; }
    isle = { ix:Math.round(x/25)*25, iz:Math.round(z/25)*25 };
    if(ctx.npc && ctx.npc.nearestPort) isle.portId = ctx.npc.nearestPort(x, z);
    { const info=islandInfoAt(x,z); isle.tribe=info.tribe; isle.owner=info.owner; }   // 🏴 종족·소유
    openPanel(); }
  function close(){ open=false; if(panel)panel.style.display='none'; }

  // 거래 후 HUD 갱신(인벤 금화/화물) — inventory 콘센트에 갱신 함수 있으면 호출, 없으면 no-op(정의 누락 ReferenceError 방지).
  function refreshHud(){ if(ctx.inventory && typeof ctx.inventory.refreshHud === 'function') ctx.inventory.refreshHud(); }

  // ── 거래 결과 토스트 ──
  let flashEl; function flash(t){ if(!flashEl){ flashEl=document.createElement('div'); flashEl.style.cssText='position:fixed;left:50%;top:28%;transform:translateX(-50%);z-index:31;background:rgba(10,16,24,.85);color:#ffe07a;padding:9px 20px;border-radius:9px;font:14px system-ui;pointer-events:none'; document.body.appendChild(flashEl);} flashEl.textContent=t; flashEl.style.display='block'; clearTimeout(flashEl._t); flashEl._t=setTimeout(()=>flashEl.style.display='none',1800); }

  // ★교역창은 교역소 NPC 상호작용(trader.js E키)으로 연다 — T키 직접 열기 폐기(claim 타워키와 충돌 + 기획: 점령 항구 NPC 경유). ESC 닫기만 유지.
  addEventListener('keydown',e=>{ if(e.code==='Escape'&&open){ close(); } });

  // ── ctx 등록(콘센트 아님 — 시스템 모듈. gold/carried는 ctx.inventory가 진실) ──
  // 현재 교역 대상 항구 지정(패널 안 띄우고 isle만) — harbor 허브 교역 탭이 buy/sell/priceOf 전에 호출.
  function setIsle(x, z){ isle = { ix:Math.round(x/25)*25, iz:Math.round(z/25)*25 }; if(ctx.npc && ctx.npc.nearestPort) isle.portId = ctx.npc.nearestPort(x, z);
    const info=islandInfoAt(x,z); isle.tribe=info.tribe; isle.owner=info.owner; }   // 🏴 종족·소유
  ctx.trade = {
    GOODS,
    get gold(){ return inv.gold; },              // ★자체 보유 없음 — 인벤 위임
    cargoCount: k => { const g=GOODS.find(x=>x.k===k); return (g&&g.personal) ? inv.count(k) : inv.cargoCount(k); },   // personal(광물) 보유는 개인인벤에서 조회(BUG-009)
    priceOf: k => { const g=GOODS.find(x=>x.k===k); return (g&&isle)?priceOf(g,isle):null; },   // 모듈 isle(setIsle/openWith가 설정)
    isleAt, buy, sell, buySoul, toggle, openWith, setIsle,   // 🔮 buySoul = 영혼 상점 구매(포션/부활석)
    get open(){ return open; },   // 교역창 열림 상태(trader.js 토글·검증에서 참조)
  };
  console.log('[trade] 초기화 완료 — ctx.inventory(화물/금화)+ctx.reputation(보정) 연동. T로 교역소.');
  return ctx.trade;
}

// [근거]
// 확정(출처):
//  - 매수=화물 loadCargo + 금화 차감 / 매도=unloadCargo + 금화 가산 — 작업 지시 "loadCargo/unloadCargo + gold 증감".
//  - 교역품 4종(럼·비단·향신료·보석) — 작업 지시 "TRADE_GOODS(럼·비단·향신료·보석)" + _GAME_DESIGN §2.
//  - 가격 × getTradeModifier() — 작업 지시 "가격에 getTradeModifier() 곱" + §5 평판→교역가격 보정(0.5~1.5).
//  - 교역 완료 시 평판 +소량 — 작업 지시 "applyAction('TRADE') (평판 +소량)" → 콘센트 실제 키 TRADE_DONE(+3, reputation.js REP_ACTIONS).
//  - 섬별 시세 차이(저가매수→고가매도) — 작업 지시 + §2 "섬 A 저가 → 섬 B 고가". 기존 trade.js islePrice 해시 계승.
//  - 자체 gold/carried 제거 → ctx.inventory 위임 — 작업 지시 "기존 자체 gold/carried는 ctx.inventory로 대체(중복 제거)".
//  - basePrice/name = inventory.js TRADE_GOODS 단일 출처 — 콘센트 카탈로그 읽기 전용 참조(구조 수정 없음).
// 미정(비워둠):
//  - 섬별 시세 구체 밸런스(시세 폭·갱신 주기) — §14 미정. 해시 0.55~1.55 폭은 기존값 계승.
//  - timber/stone 교역(채집 잉여분 판매 §2-4) — 작업 지시는 4종만 명시 → 패널 제외(필요 시 GOODS에 추가만 하면 됨).
// 제안(작성자 판단):
//  - applyAction('TRADE') → 'TRADE_DONE'으로 호출 — reputation.js 카탈로그 실제 키. 'TRADE'는 unknown action 경고+no-op이라 계약 키 사용.
//  - 매수=매도 동일가(평판·섬해시만 반영) — 같은 섬 즉시차익(exploit) 차단. 차익은 섬 간 시세차로만, 평판이 절대 차익을 증폭(§5 "평판 높을수록 유리").
//  - ctx.trade.buy/sell/priceOf 노출 — 패널 버튼 + 헤드리스 검증 공용 API(자기검증 아님, 증거 스크립트가 호출).
