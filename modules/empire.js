// empire.js — 🏛️ "내 섬" 전체뷰(N키). 풀스크린 마스터-디테일 레이아웃.
//   ★2026-07-10 UI 재작업(사령관 레퍼런스=ref/내섬메뉴샘플[Dragon's Dogma2]·내섬메뉴샘플2[LotR]):
//     기존 중앙 모달 카드 → 풀스크린 오버레이 + 상단 타이틀바 + 좌(섬 레일)·중(건물 카탈로그)·우(상세) 3분할.
//   ★진입점(사령관 2026-07-09): N키로 언제든 여는 제국 관리 화면. 위치 무관(목록/열람) — 건설만 그 섬 항구 근처.
//   ★건설 게이트: 건물 슬롯은 그 섬 지형에 앉혀야 하므로 섬이 3D 로드(=근처)된 상태에서만 건설(settlement.canBuildAt).
//   데이터 소유 없음(콘센트): ctx.claimed(소유 섬) · ctx.settlement(BUILDINGS/build/growthOf/ghost*) · ctx.invui.toast 읽기·호출.
//   톤 = 샘플 공통(다크 파치먼트 + 골드, 마스터-디테일). harbor.js 글래스 계열과 정합.
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 건물 비용/슬롯 상한 SSOT(settlement.js와 동일 출처)
import { TRIBES, ROLE_AXIS } from '/tomob-deploy/modules/tribes.js';   // 🏨 여관 건물 추종자 후보(종족·영입 축·문턱값) — 항구 여관탭에서 이관

export function initEmpire(ctx){
  if(typeof document === 'undefined') return null;
  const B = () => BAL.buildings || {};
  // 🔢 슬롯/상한은 settlement.js가 SSOT — 여기서 다시 계산하지 않는다(감사 2026-07-22: 계산 이원화 방지).
  const slotCap = (isl) => (ctx.settlement && ctx.settlement.slotN) ? ctx.settlement.slotN(isl) : (B().slotCount || 8);
  const slotTop = () => (ctx.settlement && ctx.settlement.slotMax) ? ctx.settlement.slotMax() : (B().slotCount || 8);
  const maxOf   = (id) => (ctx.settlement && ctx.settlement.maxOf) ? ctx.settlement.maxOf(id) : Infinity;
  // 🌱 Lv 임계(settlement.recalcLv와 동일 정의) — "다음 Lv까지 무엇이 필요한가"를 화면에 보여주기 위한 표시용 사본.
  //   ⚠️수치를 바꾸려면 settlement.js recalcLv와 **함께** 바꿔야 한다(감사 B2: 현재는 숫자 4개만 떠서 용도 불명이었음).
  const LV_REQ = [
    { lv:1, label:'전초기지', need:[{ k:'bld',  n:1  }] },
    { lv:2, label:'작은마을', need:[{ k:'pop',  n:10 }] },
    { lv:3, label:'항구마을', need:[{ k:'pop',  n:25 }, { k:'stability',  n:20 }] },
    { lv:4, label:'항구도시', need:[{ k:'pop',  n:50 }, { k:'prosperity', n:40 }] },
    { lv:5, label:'세력중심', need:[{ k:'pop',  n:80 }, { k:'influence',  n:30 }, { k:'prosperity', n:60 }] },
  ];
  const STAT_KO = { pop:'인구', stability:'안정', prosperity:'번영', influence:'영향', bld:'건물' };

  // ── 다크 파치먼트 + 골드 마스터-디테일 (레퍼런스 ref/내섬메뉴샘플2[LotR]: 박스 없이 배경 위로 흐르는 3구역 + 강한 골드 선택바 + 히어로 상세) ──
  const st = document.createElement('style'); st.textContent = `
    #ep_panel{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;
      background:linear-gradient(180deg,#17120b 0%,#0f0b07 55%,#0a0806 100%);
      font-family:Pretendard,system-ui,'Malgun Gothic';color:#e8dcc0}
    #ep_panel::before{content:"";position:absolute;inset:0;pointer-events:none;
      background:radial-gradient(130% 92% at 50% 36%,rgba(60,44,22,.16),transparent 50%),radial-gradient(120% 90% at 50% 40%,transparent 46%,rgba(0,0,0,.68) 100%)}
    /* 상단 탭바 — 샘플 상단 가로바(활성 탭 골드 밑줄 + 좌우 룰) */
    #ep_top{position:relative;flex:0 0 auto;display:flex;align-items:flex-end;justify-content:center;gap:20px;padding:24px 40px 0}
    .ep_lr{margin-bottom:14px;color:#b6a578;font:800 11px Pretendard;letter-spacing:.04em;border:1px solid rgba(201,168,90,.4);border-radius:5px;padding:3px 8px;background:rgba(20,16,10,.4)}
    #ep_topline{position:absolute;left:6%;right:6%;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,90,.42) 18%,rgba(201,168,90,.42) 82%,transparent)}
    #ep_titw{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding-bottom:13px}
    #ep_titw::after{content:"";position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:78%;height:2px;background:linear-gradient(90deg,transparent,#e7c878,transparent);box-shadow:0 0 10px rgba(231,200,120,.5)}
    #ep_title{font-size:20px;font-weight:800;letter-spacing:.22em;color:#f5e8c2;text-shadow:0 2px 9px rgba(0,0,0,.65)}
    #ep_title::before,#ep_title::after{content:"◆";color:#c9a85c;font-size:9px;vertical-align:middle;margin:0 13px;opacity:.85}
    #ep_sub{font-size:10.5px;letter-spacing:.28em;color:#9c8a63;text-transform:uppercase}
    #ep_x{position:absolute;right:34px;top:22px;color:#cbb98a;cursor:pointer;font-size:17px;width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;border:1px solid rgba(201,168,90,.3);border-radius:8px;background:rgba(20,16,10,.4);transition:.12s}
    #ep_x:hover{color:#ffe28a;border-color:rgba(201,168,90,.65)}
    /* 본문 3구역 — 박스 없음. 얇은 골드 헤어라인으로만 분리 */
    #ep_main{position:relative;flex:1;min-height:0;display:flex;padding:14px clamp(28px,6vw,96px) 34px;
      max-width:1440px;width:100%;margin:0 auto;box-sizing:border-box}
    .ep_col{display:flex;flex-direction:column;min-height:0}
    #ep_rail{flex:0 0 210px;border-right:1px solid rgba(201,168,90,.16);padding-right:18px}
    #ep_center{flex:1;min-width:0;padding:0 22px;border-right:1px solid rgba(201,168,90,.16)}
    #ep_detail{flex:0 0 clamp(340px,30vw,428px);padding-left:22px}
    .ep_h{display:flex;align-items:center;gap:10px;padding:6px 4px 13px;font-size:11px;letter-spacing:.18em;color:#a89264;text-transform:uppercase;font-weight:700;flex:0 0 auto;white-space:nowrap}
    .ep_h::before{content:"◆";color:#c9a85c;font-size:8px}
    .ep_h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,90,.42),transparent)}
    .ep_scroll{overflow:auto;padding:2px 2px 8px;flex:1;min-height:0}
    .ep_scroll::-webkit-scrollbar{width:7px}.ep_scroll::-webkit-scrollbar-thumb{background:rgba(201,168,90,.24);border-radius:8px}
    /* 좌: 섬 목록 — 슬림 행, 선택=골드 바 */
    .ep_isle{position:relative;display:flex;align-items:center;gap:11px;padding:11px 12px;margin:3px 0;cursor:pointer;border-radius:9px;transition:.12s}
    .ep_isle:hover{background:rgba(70,56,30,.28)}
    .ep_isle.sel{background:linear-gradient(100deg,rgba(224,184,96,.96),rgba(176,136,52,.94));box-shadow:0 5px 18px rgba(150,110,40,.34)}
    .ep_isle.sel .nm,.ep_isle.sel .meta{color:#2a1d06}
    .ep_isle.sel .emb{background:rgba(42,29,6,.22);border-color:transparent;color:#2a1d06}
    .ep_isle.sel .ep_lv{background:rgba(42,29,6,.2);border-color:transparent;color:#2a1d06}
    .ep_isle .emb{flex:0 0 30px;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;
      background:rgba(201,168,90,.12);border:1px solid rgba(201,168,90,.25);color:#e7c878;font-size:15px}
    .ep_isle .txt{flex:1;min-width:0}
    .ep_isle .nm{font:800 14px Pretendard;color:#eddcae;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ep_isle .meta{font-size:11px;color:#93835f;margin-top:2px;font-variant-numeric:tabular-nums}
    .ep_lv{font:800 10.5px Pretendard;color:#f0d89a;background:rgba(201,168,90,.16);border:1px solid rgba(201,168,90,.3);border-radius:12px;padding:2px 8px;flex:0 0 auto}
    /* 중: 건물 목록 — 썸네일 타일 + 선택 강조 */
    .ep_bldg{display:flex;align-items:center;gap:14px;padding:12px 14px;margin:4px 0;cursor:pointer;border-radius:10px;
      border-left:3px solid transparent;transition:.12s}
    .ep_bldg:hover{background:rgba(70,56,30,.24)}
    .ep_bldg.sel{background:linear-gradient(100deg,rgba(80,63,33,.66),rgba(52,42,24,.5));border-left-color:#e7c878}
    .ep_bldg .ic{flex:0 0 46px;height:46px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:#e7c878;
      background:radial-gradient(circle at 40% 32%,rgba(60,48,26,.9),rgba(24,20,13,.9));border:1px solid rgba(201,168,90,.28);
      filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}
    .ep_bldg.sel .ic{color:#f7e6b6;border-color:rgba(231,200,120,.6)}
    .ep_bldg .ic svg,.ep_isle .emb svg,.ep_heroEmb svg,.ep_dsec svg{display:block}
    .ep_bldg .info{flex:1;min-width:0}
    .ep_bldg .bn{font:700 15px Pretendard;color:#eddcae}
    .ep_bldg .bd{font-size:12px;color:#8c7f5c;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ep_bldg .have{color:#8fe0a0;font-weight:700;font-size:12.5px;margin-left:5px}
    .ep_bldg .cost{color:#f3d978;font-weight:800;font-variant-numeric:tabular-nums;font-size:14px;flex:0 0 auto}
    /* 우: 상세 — 히어로 배너 + 스탯 + 선택 건물 */
    .ep_dwrap{overflow:auto;padding:2px 4px 10px;flex:1;min-height:0}
    .ep_dwrap::-webkit-scrollbar{width:7px}.ep_dwrap::-webkit-scrollbar-thumb{background:rgba(201,168,90,.24);border-radius:8px}
    .ep_hero{position:relative;display:flex;align-items:center;gap:14px;padding:20px 18px;border-radius:13px;margin-bottom:16px;overflow:hidden;
      background:linear-gradient(120deg,rgba(74,57,28,.72),rgba(30,24,15,.7));border:1px solid rgba(201,168,90,.32)}
    .ep_hero::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 140% at 88% 20%,rgba(231,200,120,.16),transparent 55%)}
    .ep_heroEmb{flex:0 0 52px;height:52px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:26px;
      background:rgba(20,16,10,.5);border:1px solid rgba(201,168,90,.4);color:#f0d89a}
    .ep_herotx{flex:1;min-width:0}
    .ep_dtitle{font:800 22px Pretendard;color:#f6ead0;text-shadow:0 2px 9px rgba(0,0,0,.6)}
    .ep_drow{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px;margin-top:5px;color:#c3b184;font-size:12.5px;letter-spacing:.02em}
    .ep_herolv{flex:0 0 auto;font:800 13px Pretendard;color:#2a1d06;background:linear-gradient(180deg,#ecc962,#c19a3c);border-radius:16px;padding:5px 13px;box-shadow:0 2px 8px rgba(160,120,40,.4)}
    .ep_stats{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:0 0 16px}
    .ep_stat{background:linear-gradient(180deg,rgba(40,32,19,.5),rgba(22,18,12,.5));border:1px solid rgba(201,168,90,.18);border-radius:10px;padding:11px 13px}
    .ep_stat .k{font-size:11px;color:#93835f;letter-spacing:.06em}
    .ep_stat .v{font:800 21px Pretendard;color:#eddcae;font-variant-numeric:tabular-nums;margin-top:3px}
    .ep_sep{height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,90,.32),transparent);margin:16px 0}
    .ep_dsec{display:flex;align-items:center;gap:9px;font-size:11px;letter-spacing:.16em;color:#a89264;text-transform:uppercase;font-weight:700;margin:2px 0 10px;white-space:nowrap}
    .ep_dsec::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(201,168,90,.34),transparent)}
    .ep_ddesc{font-size:13px;line-height:1.7;color:#c9bd99}
    .ep_dcost{display:flex;align-items:center;justify-content:space-between;margin:14px 0 10px;
      padding:12px 15px;background:linear-gradient(180deg,rgba(40,32,19,.5),rgba(22,18,12,.5));border:1px solid rgba(201,168,90,.2);border-radius:10px}
    .ep_dcost .k{font-size:12.5px;color:#b6a578}
    .ep_dcost .v{font:800 18px Pretendard;color:#f3d978;font-variant-numeric:tabular-nums}
    .ep_build{width:100%;background:linear-gradient(180deg,#f0cf72,#b8912f);color:#2a1d06;border:1px solid #e0bd58;border-radius:10px;
      padding:13px 16px;font:800 15px Pretendard;letter-spacing:.04em;cursor:pointer;box-shadow:0 4px 14px rgba(180,140,50,.34);transition:.12s}
    .ep_build:hover{filter:brightness(1.08)}
    .ep_build:disabled{background:#2c281f;color:#7a6f55;border-color:#443d2f;box-shadow:none;cursor:default;filter:none}
    .ep_warn{margin:12px 0;padding:11px 14px;border-radius:10px;background:rgba(120,64,40,.24);border:1px solid rgba(230,150,90,.38);color:#f2c79c;font-size:12.5px;line-height:1.55}
    .ep_ph{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:220px;text-align:center;padding:44px 22px;color:#8a7d5e}
    .ep_ph .t{font-size:16px;color:#c8b98c;margin-bottom:8px}.ep_ph .d{font-size:12.5px;line-height:1.6}`;
  document.head.appendChild(st);

  const panel = document.createElement('div'); panel.id = 'ep_panel';
  panel.innerHTML = `
    <div id="ep_top">
      <div id="ep_topline"></div>
      <div id="ep_titw"><div id="ep_title">내 섬</div><div id="ep_sub">Dominion</div></div>
      <div id="ep_x">✕</div>
    </div>
    <div id="ep_main">
      <div class="ep_col" id="ep_rail"><div class="ep_h">영토 · 소유 섬</div><div class="ep_scroll" id="ep_railList"></div></div>
      <div class="ep_col" id="ep_center"><div class="ep_h" id="ep_centerH">건설</div><div class="ep_scroll" id="ep_centerList"></div></div>
      <div class="ep_col" id="ep_detail"><div class="ep_h">상세</div><div class="ep_dwrap" id="ep_detailBody"></div></div>
    </div>`;
  document.body.appendChild(panel);
  // 🏗️ 고스트 배치 프롬프트(harbor hb_prompt 톤) — 패널 닫고 3D 씬에 고스트 띄운 상태에서 표시.
  const prompt = document.createElement('div'); prompt.id = 'ep_ghost_prompt';
  prompt.textContent = 'R 회전 · 좌클릭(또는 E) 건설 · ESC 취소';
  prompt.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:62;background:rgba(8,14,22,.82);color:#ffe28a;padding:9px 22px;border-radius:9px;border:1px solid rgba(201,168,90,.5);font:14px Pretendard,system-ui,"Malgun Gothic";display:none;pointer-events:none;text-shadow:0 1px 3px #000;box-shadow:0 4px 16px rgba(0,0,0,.5)';
  document.body.appendChild(prompt);

  const railList = panel.querySelector('#ep_railList');
  const centerH  = panel.querySelector('#ep_centerH');
  const centerList = panel.querySelector('#ep_centerList');
  const detailBody = panel.querySelector('#ep_detailBody');
  const subEl = panel.querySelector('#ep_sub');

  let open = false, curIsland = null, focusBld = null;   // curIsland=선택 섬 / focusBld=상세에 띄운 건물 id

  function ownedIslands(){
    if(ctx.settlement && ctx.settlement.ownedIslands) return ctx.settlement.ownedIslands();
    return (ctx.claimed || []).filter(c => c && c.owner === 'player');
  }
  function growthOf(isl){
    if(ctx.settlement && ctx.settlement.growthOf){ return ctx.settlement.growthOf(isl) || {}; }
    return isl.growth || { pop:0, stability:0, prosperity:0, influence:0, lv:0 };
  }
  const toast = t => { if(ctx.invui && ctx.invui.toast) ctx.invui.toast(t); };
  const isleName = (isl, i) => isl.name || ('점령 거점 ' + ((i < 0 ? 0 : i) + 1));
  const islandIdx = isl => ownedIslands().indexOf(isl);   // ★감사 A6: 중앙/상세가 인덱스 0을 하드코딩해 전부 "점령 거점 1"로 보였다.
  // 🌱 다음 Lv 요구조건 — 현재 수치 대비 진행률(0~1)과 미달 항목을 함께 돌려준다.
  function nextLvInfo(isl, g){
    const lv = g.lv || 0;
    const step = LV_REQ.find(r => r.lv === lv + 1);
    if(!step) return null;   // Lv5 = 최대
    const cur = k => (k === 'bld') ? (isl.buildings || []).length : Math.floor(g[k] || 0);
    const rows = step.need.map(n => ({ k:n.k, have:cur(n.k), need:n.n, ok:cur(n.k) >= n.n }));
    const prog = rows.reduce((s, r) => s + Math.min(1, r.need ? r.have / r.need : 1), 0) / rows.length;
    return { lv:step.lv, label:step.label, rows, prog };
  }

  // ── 🎨 라인아이콘(이모지 전면 폐지, 사령관 2026-07-10) — 라디얼과 동일 톤. 고품질 채색본은 GPT 생성 후 PNG 배선 예정 ──
  const _svg = (inner, sz) => '<svg viewBox="0 0 24 24" width="'+(sz||24)+'" height="'+(sz||24)+'" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+inner+'</svg>';
  const EMB_ISLE = '<path d="M6.5 21V4"/><path d="M6.5 4.5h10l-2 3 2 3h-10"/>';   // 섬 깃발
  const BLD_ICONS = {
    market:      '<path d="M4 10.5V20h16v-9.5"/><path d="M3 10.5l1.6-4.5h14.8L21 10.5z"/><path d="M3 10.5h18"/><path d="M9.5 20v-4.5h5V20"/>',
    mine:        '<path d="M4 20l8.4-8.4"/><path d="M5.6 11.2c3.2-3 8.2-3 11.4 0"/><path d="M8.4 8.3c2.3-.8 4.8-.8 7.1 0"/>',
    lumbermill:  '<circle cx="8" cy="12" r="4.2"/><path d="M8 7.8v8.4M3.8 12h8.4M5.1 9.1l5.8 5.8M5.1 14.9l5.8-5.8"/><path d="M13.5 7.8H20v8.4h-6.5"/>',
    home_A:      '<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
    windmill:    '<circle cx="12" cy="9" r="1"/><path d="M12 9V2.5M12 9l5.6 3.2M12 9L6.4 12.2"/><path d="M7 20v-8.5M17 20v-8.5M5 20h14"/>',
    watermill:   '<circle cx="9" cy="13" r="5.4"/><path d="M9 7.6v10.8M3.6 13h10.8M5.2 9.2l7.6 7.6M5.2 16.8l7.6-7.6"/><path d="M15.5 7.6H20V19"/>',
    blacksmith:  '<path d="M4 8h12a4 4 0 0 1-4 3H9l-1.5 3H5l1.5-3A3 3 0 0 1 4 8z"/><path d="M8 14h4v3.2H8z"/>',
    church:      '<path d="M12 2.2v3M10.5 3.7h3"/><path d="M6 21V10l6-3.8L18 10v11"/><path d="M10 21v-4.5h4V21"/>',
    barracks:    '<path d="M12 3l7 2.5v5.4c0 4.8-3 7.6-7 9.6-4-2-7-4.8-7-9.6V5.5z"/><path d="M9 11.2l2 2 4-4"/>',
    well:        '<path d="M5.5 10.5h13"/><path d="M6.7 10.5L8 20h8l1.3-9.5"/><path d="M8 6.5l4-2.5 4 2.5"/><path d="M12 4v6.5"/><path d="M10 13.5h4v3h-4z"/>',
    inn:         '<path d="M6.5 8h8v10.5a1.5 1.5 0 0 1-1.5 1.5H8a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M14.5 10h2.4a2 2 0 0 1 0 4h-2.4"/><path d="M8.2 4.6v2M11 4.6v2"/>',
  };
  const bldIcon = (id, sz) => _svg(BLD_ICONS[id] || '<rect x="4" y="4" width="16" height="16" rx="2"/>', sz);

  // ── 🏗️ 지어진 건물 기능(사령관 2026-07-10: 항구 탭 → 내섬 건물로 이관) ──
  //   막사=용병 모집(garrison) · 여관=추종자 영입(crew) · 광산=던전 입장. 항구 관리에선 제거(교역/배관리만).
  const FN_HINT = { barracks:'용병을 모집할 수 있습니다', inn:'추종자를 영입할 수 있습니다', mine:'광산 던전에 입장할 수 있습니다' };
  const _AXIS_KO = { trust:'신뢰', infamy:'악명', honor:'명예' };
  let _innCands = null, _innKey = '';   // 여관 추종자 후보 + 그 후보를 뽑은 시드 키
  // ★던전 입장 잔여 카운트는 ctx.dungeon(dungeonrun.js)이 SSOT — 광산 건물 앞 [E] 직접입장과 공유(2026-07-16 3차).
  // ── 🎲 후보 추첨 = **결정론 시드**(감사 B3, 2026-07-22) ──
  //   구현: 예전엔 openPanel마다 _innCands=null로 리셋하고 Math.random으로 뽑아서, **N을 껐다 켜기만 하면 재추첨**됐다.
  //   = 원하는 종족이 나올 때까지 무한 리롤 → 랜덤이 의미를 잃음.
  //   시드 = (섬 좌표 + 교대 슬롯). 같은 섬·같은 슬롯이면 몇 번을 열어도 동일 후보. 슬롯이 바뀌면 자연히 새 얼굴.
  const INN_ROTATE_MS = 6 * 60 * 1000;   // 후보 교대 주기(6분) — 다음 슬롯까지 기다리면 새 얼굴
  function _mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function _innSeedKey(isl){
    const slot = Math.floor(Date.now() / INN_ROTATE_MS);
    return Math.round(isl.x)+'_'+Math.round(isl.z)+'_'+slot;
  }
  function _pickInnCands(isl){
    const crew = ctx.crew;
    const inRoster = tid => !!(crew && crew.roster && crew.roster.some(r => r.tribeId === tid));
    const pool = TRIBES.filter(t => !inRoster(t.id));
    const key = _innSeedKey(isl);
    let h = 2166136261; for(let i=0;i<key.length;i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rnd = _mulberry32(h);
    for(let i=pool.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; const tmp=pool[i]; pool[i]=pool[j]; pool[j]=tmp; }
    return pool.slice(0, Math.min(pool.length, 2 + ((rnd()*2)|0)));   // 2~3명
  }
  // 건물별 기능 패널 HTML(지어진 경우에만 호출)
  function _fnPanel(isl, id, loaded){
    if(id === 'barracks') return _mercPanel(isl, loaded);
    if(id === 'inn')      return _innPanel(isl, loaded);
    if(id === 'mine')     return _dungeonPanel(isl, loaded);
    return '';
  }
  function _mercPanel(isl, loaded){
    if(!ctx.garrison || !ctx.garrison.recruit) return '';
    const cap=(BAL.economy && BAL.economy.mercCap)||4, cost=(BAL.economy && BAL.economy.mercCost)||300;
    const n = ctx.garrison.mercCount ? ctx.garrison.mercCount(isl) : 0, gold = ctx.inventory ? ctx.inventory.gold : 0;
    const names = (ctx.garrison.list||[]).filter(gg=>gg.island===isl && gg.patrol).map(gg=>gg.nm).join(' · ') || '—';
    const can = loaded && n<cap && gold>=cost;
    return `<div class="ep_sep"></div><div class="ep_dsec">용병 모집 · 항구 수비대</div>
      <div class="ep_ddesc">용병이 이 섬 항구 주변을 정찰하고, 습격이 오면 자동으로 맞섭니다. 모집비 1회 — 유지비 없음.</div>
      <div class="ep_dcost"><span class="k">주둔 용병</span><span class="v">${n}/${cap}</span></div>
      <div style="font-size:12px;color:#8f8567;margin:-4px 0 10px">${names}</div>
      <button class="ep_build" id="ep_fnMerc" ${can?'':'disabled'}>${!loaded?'섬 근처로 이동 필요':n>=cap?`용병 상한 (${cap}명)`:gold<cost?'골드 부족':`용병 모집 (◎${cost})`}</button>`;
  }
  function _dungeonPanel(isl, loaded){
    if(!ctx.dungeon || !ctx.dungeon.enter) return '';
    const dgLeft = ctx.dungeon.dgLeft;
    const can = loaded && dgLeft>0;
    return `<div class="ep_sep"></div><div class="ep_dsec">광산 던전</div>
      <div class="ep_ddesc">희귀 광물 + 몬스터. 하루 <b style="color:#f0e0b0">${dgLeft}/3</b>회 입장할 수 있습니다. 건물 앞에서 [E]로도 바로 입장할 수 있습니다.</div>
      <button class="ep_build" id="ep_fnDg" ${can?'':'disabled'}>${!loaded?'섬 근처로 이동 필요':dgLeft<=0?'오늘 입장 소진':'던전 입장'}</button>`;
  }
  function _innPanel(isl, loaded){
    const crew = ctx.crew;
    if(!crew || !crew.recruit) return '';
    const key = _innSeedKey(isl);
    if(!_innCands || _innKey !== key){ _innCands = _pickInnCands(isl); _innKey = key; }   // 시드 동일 → 재추첨 없음(리롤 차단)
    let h = `<div class="ep_sep"></div><div class="ep_dsec">여관 · 추종자 영입</div>
      <div class="ep_ddesc">항구를 떠도는 이들. 평판이 무르익은 자를 곁에 둘 수 있습니다. 크루 <b style="color:#f0e0b0">${(crew.roster||[]).length}/${crew.MAX_CREW}</b>.</div>`;
    if(!_innCands.length){ h += `<div style="font-size:12.5px;color:#8f8567;margin-top:8px">지금은 영입할 만한 이가 없습니다 — 나중에 다시 들르세요.</div>`; return h; }
    for(const t of _innCands){
      const axis = ROLE_AXIS[t.role], have = Math.floor((ctx.reputation && ctx.reputation[axis])||0), need = t.recruitThreshold, ok = have>=need && loaded;
      h += `<div style="display:flex;gap:11px;align-items:flex-start;padding:11px 12px;margin:8px 0;background:rgba(20,18,14,.5);border:1px solid rgba(201,168,90,.2);border-radius:10px">
        <span style="flex:0 0 auto;color:#c9b78a;display:flex">${_svg('<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20v-1.2A6.5 6.5 0 0 1 18.5 18.8V20"/>', 22)}</span>
        <span style="flex:1;min-width:0"><b style="color:#f0e0b0;font-size:14.5px">${t.ko}</b> <span style="font-size:11px;color:#8f8567">${t.trait||''}</span>
          <div style="font-size:12px;color:#9a8c68;margin:3px 0 4px;line-height:1.5">${t.desc||''}</div>
          <span style="font-size:12px;color:${have>=need?'#7fe08a':'#f3d978'}">${_AXIS_KO[axis]||'평판'} ${have}/${need}${have>=need?' ✓':''}</span></span>
        <button class="ep_build" data-recruit="${t.id}" ${ok?'':'disabled'} style="flex:0 0 auto;width:auto;padding:8px 14px;font-size:13px">영입</button></div>`;
    }
    return h;
  }
  function _wireFnPanel(isl, loaded){
    const merc = detailBody.querySelector('#ep_fnMerc');
    if(merc) merc.onclick = () => { if(ctx.garrison.recruit(isl)) renderDetail(); };
    const dg = detailBody.querySelector('#ep_fnDg');
    if(dg) dg.onclick = () => { if(!loaded || !ctx.dungeon.useDaily()) return; close(); ctx.dungeon.enter(isl); };
    detailBody.querySelectorAll('[data-recruit]').forEach(b => b.onclick = () => {
      const tid = b.dataset.recruit, t = TRIBES.find(x => x.id === tid); if(!t) return;
      const axis = ROLE_AXIS[t.role], have = Math.floor((ctx.reputation && ctx.reputation[axis])||0);
      if(have < t.recruitThreshold){ toast('아직 ' + (_AXIS_KO[axis]||'평판') + '이(가) 부족합니다 (' + have + '/' + t.recruitThreshold + ')'); return; }
      const res = ctx.crew.recruit(tid);
      if(res && res.ok){ toast((t.ko||'추종자') + ' 합류! — 크루 ' + ctx.crew.roster.length + '/' + ctx.crew.MAX_CREW); ctx.sound && ctx.sound.play && ctx.sound.play('success'); _innCands = null; _innKey = ''; renderDetail(); }   // 영입 성공 시에만 재추첨(로스터가 바뀜)
      else if(res && res.reason === 'full') toast('크루가 꽉 찼습니다 (' + ctx.crew.MAX_CREW + '명)');
      else if(res && res.reason === 'dup') toast((t.ko||'추종자') + '은(는) 이미 합류했습니다');
      else toast('영입 실패');
    });
  }

  // ── 좌: 소유 섬 레일 ──
  function renderRail(){
    const isles = ownedIslands();
    subEl.textContent = isles.length ? (isles.length + ' Territories') : 'Dominion';
    if(!isles.length){ railList.innerHTML = `<div class="ep_ph"><div class="t">점령한 섬 없음</div><div class="d">깃발 거점을 점령하면<br>여기서 관리할 수 있습니다</div></div>`; return; }
    if(!curIsland || isles.indexOf(curIsland) < 0) curIsland = isles[0];   // 자동 선택(마스터-디테일 채움)
    let h = '';
    isles.forEach((isl, i) => {
      const g = growthOf(isl), lv = g.lv || 0, nb = (isl.buildings || []).length;
      const sel = isl === curIsland ? ' sel' : '';
      h += `<div class="ep_isle${sel}" data-i="${i}">
        <span class="emb">${_svg(EMB_ISLE, 17)}</span>
        <span class="txt"><span class="nm">${isleName(isl, i)}</span>
          <span class="meta">인구 ${Math.floor(g.pop||0)} · 슬롯 ${nb}/${slotCap(isl)}</span></span>
        <span class="ep_lv">Lv ${lv}</span></div>`;
    });
    railList.innerHTML = h;
    railList.querySelectorAll('.ep_isle').forEach(el => el.onclick = () => {
      curIsland = isles[+el.dataset.i]; focusBld = null; renderRail(); renderCenter(); renderDetail();
    });
  }

  // ── 중: 선택 섬 건물 카탈로그 ──
  // ⚓ 항구 현황 행 — ★BUG-A2(2026-08-07): 구 "여기서 항구 건설" 진입을 제거하고 **열람 + 제작탭 안내**로 바꿈.
  //   건설은 인벤토리 [제작] → [거점] → 항구(부두). 이 화면은 상태창이다.
  function harborRow(){
    const built = !!(ctx.wharf && ctx.wharf.pos);
    return `<div class="ep_bldg ep_harborBuild" data-harbor="1" style="opacity:.75">
      <span class="ic">${bldIcon('harbor', 26)}</span>
      <span class="info"><span class="bn">항구(부두) <span class="have">${built?'건설됨':'미건설'}</span></span></span>
      <span class="cost">[제작] → [거점]</span></div>`;
  }
  function wireHarborRow(){
    const hb = centerList.querySelector('.ep_harborBuild');
    if(hb) hb.onclick = () => toast('항구는 인벤토리 [제작] → [거점] 탭에서 짓습니다 — 해안으로 가세요');
  }
  function renderCenter(){
    const isl = curIsland;
    if(!ctx.settlement || !ctx.settlement.BUILDINGS){ centerH.textContent = '건설'; centerList.innerHTML = harborRow() + `<div class="ep_ph"><div class="t">건설 불가</div><div class="d">settlement.js 연결 필요</div></div>`; wireHarborRow(); return; }
    // ★BUG-A2(2026-08-07 사령관): **N키는 상태창을 보는 것**이고 건설은 제작탭에서만.
    //   목록은 "현재 보유 현황" 열람으로 남기고, 클릭 시 건설이 아니라 제작탭으로 안내한다(원칙-1: 건설 진입점 단일화).
    centerH.textContent = isl ? `건물 현황 · ${isleName(isl, islandIdx(isl))}` : '건물 현황';
    const BUILDINGS = ctx.settlement.BUILDINGS, bb = B();
    let h = harborRow(), first = null;   // ⚓ 항구 건설을 맨 위에(섬 점령 진입점)
    for(const id in BUILDINGS){
      const d = BUILDINGS[id]; if(d.hidden) continue;   // 항구(harbor)는 위 harborRow 전용 항목으로 처리 → 일반 목록 제외
      if(first === null) first = id;
      const cost = (bb[id] && bb[id].cost) || 0;
      const have = isl ? (isl.buildings || []).filter(b => b.id === id).length : 0;
      const mx = maxOf(id), full = isl && have >= mx;   // 🔢 동일 건물 상한 도달(감사 B1)
      const locked = !isl;   // 소유 섬 없음 = 회색 비활성(항구로 점령 먼저)
      const sel = (isl && focusBld === id) ? ' sel' : '';
      h += `<div class="ep_bldg${sel}" data-id="${id}"${(full||locked)?' style="opacity:.45"':''}>
        <span class="ic">${bldIcon(id, 26)}</span>
        <span class="info"><span class="bn">${d.name}${have ? `<span class="have">×${have}${isFinite(mx)?`/${mx}`:''}</span>` : ''}</span></span>
        <span class="cost">${locked ? '섬 점령 필요' : full ? '최대' : '◎'+cost}</span></div>`;   // ★리스트는 이름만 — 설명은 우측 상세에
    }
    centerList.innerHTML = h;
    if(isl && focusBld === null) focusBld = first;   // 기본 상세 = 첫 건물(섬 있을 때만)
    centerList.querySelectorAll('.ep_bldg[data-id]').forEach(el => el.onclick = () => {
      if(!curIsland){ toast('거점이 없습니다 — 인벤토리 [제작] → [거점]에서 거점 깃발을 세우세요'); return; }
      focusBld = el.dataset.id; renderCenter(); renderDetail();
    });
    wireHarborRow();
  }

  // ── 우: 상세(섬 성장 요약 + 선택 건물 상세) ──
  function renderDetail(){
    const isl = curIsland;
    if(!isl){ detailBody.innerHTML = `<div class="ep_ph"><div class="t">—</div><div class="d">섬을 선택하면<br>영토 정보가 표시됩니다</div></div>`; return; }
    const g = growthOf(isl), lv = g.lv || 0;
    const nb = (isl.buildings || []).length, cap = slotCap(isl);
    const loaded = !ctx.settlement || !ctx.settlement.canBuildAt || ctx.settlement.canBuildAt(isl);
    const gold = ctx.inventory ? ctx.inventory.gold : 0;
    let h = `<div class="ep_hero"><div class="ep_heroEmb">${_svg(EMB_ISLE, 26)}</div>
        <div class="ep_herotx"><div class="ep_dtitle">${isleName(isl, islandIdx(isl))}</div>
          <div class="ep_drow"><span>슬롯 <b style="color:#f0e0b0">${nb}/${cap}</b>${cap<slotTop()?`<span style="color:#8a7d5e"> (Lv${lv})</span>`:''}</span><span>·</span><span>보유 <b style="color:#f3d978">◎${gold}</b></span></div></div>
        <div class="ep_herolv">Lv ${lv}</div></div>
      <div class="ep_stats">
        <div class="ep_stat"><div class="k">인구</div><div class="v">${Math.floor(g.pop||0)}</div></div>
        <div class="ep_stat"><div class="k">안정</div><div class="v">${Math.floor(g.stability||0)}</div></div>
        <div class="ep_stat"><div class="k">번영</div><div class="v">${Math.floor(g.prosperity||0)}</div></div>
        <div class="ep_stat"><div class="k">영향</div><div class="v">${Math.floor(g.influence||0)}</div></div>
      </div>`;
    // 🌱 다음 Lv 진행 — 감사 B2: 예전엔 위 숫자 4개만 떠서 "왜 올리는지" 알 수 없었다. 목표·보상을 같이 보여준다.
    {
      const nx = nextLvInfo(isl, g);
      if(nx){
        const rows = nx.rows.map(r => `<span style="color:${r.ok?'#7fe08a':'#c3b184'}">${STAT_KO[r.k]||r.k} ${r.have}/${r.need}${r.ok?' ✓':''}</span>`).join('<span style="color:#5f5744"> · </span>');
        const nextCap = Math.min(slotTop(), ((B().slotByLv||[])[nx.lv] != null) ? B().slotByLv[nx.lv] : cap);
        h += `<div style="margin:-4px 0 16px;padding:12px 14px;background:linear-gradient(180deg,rgba(40,32,19,.42),rgba(22,18,12,.42));border:1px solid rgba(201,168,90,.18);border-radius:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
            <span style="font-size:11.5px;letter-spacing:.1em;color:#a89264;font-weight:700">다음 단계 · Lv${nx.lv} ${nx.label}</span>
            ${nextCap>cap?`<span style="font-size:11.5px;color:#f3d978">슬롯 ${cap} → ${nextCap}</span>`:''}</div>
          <div style="height:6px;border-radius:4px;background:rgba(0,0,0,.42);overflow:hidden;margin-bottom:7px">
            <div style="height:100%;width:${Math.round(nx.prog*100)}%;background:linear-gradient(90deg,#b8912f,#f0cf72)"></div></div>
          <div style="font-size:12px;line-height:1.6">${rows}</div></div>`;
      } else {
        h += `<div style="margin:-4px 0 16px;font-size:12px;color:#8a7d5e;text-align:center">최고 단계 — 세력 중심지</div>`;
      }
    }
    if(!loaded) h += `<div class="ep_warn">이 섬이 아직 멀리 있어 건설할 수 없습니다. <b>배로 이 섬 항구 근처까지 이동</b>하면 건물을 지을 수 있습니다.</div>`;

    const BUILDINGS = ctx.settlement && ctx.settlement.BUILDINGS;
    const d = BUILDINGS && focusBld && BUILDINGS[focusBld];
    if(d){
      const bb = B(), cost = (bb[focusBld] && bb[focusBld].cost) || 0;
      const have = (isl.buildings || []).filter(b => b.id === focusBld).length;
      const mx = maxOf(focusBld), kindFull = have >= mx;   // 🔢 동일 건물 상한(감사 B1)
      const full = nb >= cap, afford = gold >= cost && !full && !kindFull && loaded;
      const hint = FN_HINT[focusBld] ? `<div style="font-size:12px;color:#9a8c68;margin-top:6px">${have ? '아래에서 ' : '지으면 '}${FN_HINT[focusBld]}</div>` : '';
      const actHint = (d.act && have) ? `<div style="font-size:12px;color:#9a8c68;margin-top:6px">건물 앞에서 <b style="color:#f0e0b0">[E]</b> — ${d.act}</div>` : '';
      h += `<div class="ep_sep"></div>
        <div class="ep_dsec">${bldIcon(focusBld, 15)} ${d.name}${have ? ` · 보유 ×${have}${isFinite(mx)?`/${mx}`:''}` : ''}</div>
        <div class="ep_ddesc">${d.desc || ''}</div>${hint}${actHint}
        <div class="ep_dcost"><span class="k">건설 비용</span><span class="v">◎${cost}</span></div>
        <button class="ep_build" id="ep_buildBtn" disabled>${kindFull ? `이 섬 최대 (${mx}채)` : full ? `슬롯 가득 참 (Lv${lv} = ${cap})` : '건설은 [제작] → [거점] 탭에서'}</button>`;   // ★BUG-A2: N키는 열람만, 건설 진입 제거
      if(have > 0) h += _fnPanel(isl, focusBld, loaded);   // ★지어진 건물 → 기능 패널(용병/추종자/던전)
    }
    detailBody.innerHTML = h;
    // ★BUG-A2: 건설 버튼은 비활성 안내 전용(클릭 배선 없음). 실제 건설은 인벤토리 [제작] → [거점] 탭.
    //   startPlace/confirmGhost 경로는 남겨둔다 — 세이브 복원·기능 패널이 같은 고스트 API를 공유하므로 제거하면 회귀.
    _wireFnPanel(isl, loaded);   // 기능 버튼(모집·입장) 배선
  }

  function renderAll(){ renderRail(); renderCenter(); renderDetail(); }

  // ── 🏗️ 건설 고스트 배치 흐름(wharf.js G키 패턴 이식) — 배치 클릭 → 패널 닫고 슬롯에 고스트 → [E] 확정 / [ESC] 취소 ──
  //   (모달이 전체화면이라 열린 채로는 3D 고스트가 안 보임 → close()로 씬을 드러내고 [E] 확정.)
  let ghosting = false;
  function buildFailToast(reason){
    toast(reason === 'no-gold' ? '골드 부족' : reason === 'no-slot' ? '슬롯이 가득 찼습니다' : reason === 'max-kind' ? '이 섬에는 더 지을 수 없는 건물입니다' : reason === 'not-loaded' ? '이 섬 항구 근처로 이동해야 건설할 수 있습니다' : reason === 'load-fail' ? '건물 로드 실패' : reason === 'bad-spot' ? '여기에는 지을 수 없습니다' : '건설할 수 없습니다');
  }
  async function startPlace(isl, id){
    if(!isl || !id) return;
    if(!ctx.settlement || !ctx.settlement.ghostShow){   // 구버전 폴백 — 고스트 API 없으면 즉시 건설
      const r = await ctx.settlement.build(isl, id);
      if(!r || !r.ok) buildFailToast(r && r.reason);
      if(open && curIsland === isl) renderAll();
      return;
    }
    const r = await ctx.settlement.ghostShow(isl, id);
    if(!r || !r.ok){ toast((r && r.reason) === 'not-loaded' ? '이 섬 항구 근처로 이동해야 건설할 수 있습니다' : (r && r.reason) === 'no-slot' ? '슬롯이 가득 찼습니다' : (r && r.reason) === 'load-fail' ? '건물 로드 실패' : '미리보기를 띄울 수 없습니다'); return; }
    ghosting = true; close();   // ★패널 닫아 3D 씬의 고스트가 보이게
    prompt.style.display = 'block';
    // ★사령관 "G키 항구건설처럼 R로 돌리고 좌클릭으로 건설"(2026-07-17) — wharf.js/build.js와 동일하게 포인터락 재획득.
    //   패널 오픈 시 exitPointerLock()된 채라 마우스가 자유커서라 시점을 못 돌렸음 → 락 재획득으로 시점 회전+R회전+좌클릭 확정 통일.
    const el = ctx.renderer && ctx.renderer.domElement; if(el && el.requestPointerLock) el.requestPointerLock();
  }
  async function confirmGhost(){
    if(!ghosting) return; ghosting = false; prompt.style.display = 'none';
    const r = ctx.settlement.ghostConfirm ? await ctx.settlement.ghostConfirm() : null;
    if(!r || !r.ok) buildFailToast(r && r.reason);   // 성공 시 build()가 자체 토스트
    // ★건설 후 인게임 복귀(사령관 2026-07-23) — 관리 메뉴로 되돌아가지 않는다. 다시 보려면 N.
  }
  function cancelGhost(){
    if(!ghosting) return; ghosting = false; prompt.style.display = 'none';
    if(ctx.settlement.ghostCancel) ctx.settlement.ghostCancel();
    openPanel();
  }

  function openPanel(){ open = true; panel.style.display = 'flex'; if(document.exitPointerLock) document.exitPointerLock(); renderAll(); }   // ★_innCands 리셋 제거(감사 B3 — 열 때마다 재추첨=무한 리롤이었음)
  // 🚪 건물 앞 [E] → 그 섬·그 건물 상세로 바로 열기(settlement.js runAct가 호출). 3-1 장소화.
  function openAt(island, bldId){
    if(island) curIsland = island;
    if(bldId) focusBld = bldId;
    openPanel();
  }
  function close(){ open = false; panel.style.display = 'none'; }
  function toggle(){ if(open) close(); else openPanel(); }

  panel.querySelector('#ep_x').onclick = close;
  panel.addEventListener('click', e => { if(e.target === panel || e.target.id === 'ep_main' || e.target.id === 'ep_top') close(); });
  addEventListener('keydown', e => { if(e.code === 'Escape' && open){ close(); } });
  // 🏗️ 고스트 배치 중 회전([R])/확정([E]·좌클릭)/취소([ESC]) — 패널 닫힌 상태(open=false)라 위 Escape 핸들러와 충돌 없음.
  //   wharf.js(G키 항구건설)와 동일 조작으로 통일(사령관 2026-07-17): R=회전, 좌클릭=건설.
  addEventListener('keydown', e => {
    if(!ghosting || e.repeat) return;
    if(e.code === 'KeyE'){ e.preventDefault(); confirmGhost(); }
    else if(e.code === 'KeyR'){ if(ctx.settlement.ghostRotate) ctx.settlement.ghostRotate(); }
    else if(e.code === 'Escape'){ cancelGhost(); }
  });
  ctx.renderer && ctx.renderer.domElement && ctx.renderer.domElement.addEventListener('mousedown', e => {
    if(e.button === 0 && ghosting && document.pointerLockElement === ctx.renderer.domElement) confirmGhost();
  });
  // ★진입 = N키. 위치 무관 — 언제든 열림. 입력 라우터(UI/컷신 차단) 존중.
  addEventListener('keydown', e => {
    if(e.code !== 'KeyN' || e.repeat) return;
    if(ghosting) return;   // 고스트 배치 중엔 N키 무시(패널 재오픈 방지)
    if(ctx.input && ctx.input.blocks && ctx.input.blocks('KeyN')) return;
    // 다른 모달이 떠 있으면 양보(겹침 방지)
    if(!open && ((ctx.harbor && ctx.harbor.isOpen && ctx.harbor.isOpen()) || (ctx.trade && ctx.trade.open) || (ctx.settlement && ctx.settlement.isOpen && ctx.settlement.isOpen()))) return;
    toggle();
  });

  ctx.empire = { open: openPanel, openAt, close, toggle, isOpen: () => open };
  console.log('[empire] 내 섬 전체뷰(N키) — 풀스크린 마스터-디테일(섬 레일·건물 카탈로그·상세). 원격 건설(settlement.build). 슬롯=Lv연동·건물별 상한 표시.');
  return ctx.empire;
}

// [근거]
// 확정(출처):
//  - 소유 섬 = ctx.claimed(owner='player') / ctx.settlement.ownedIslands — settlement.js·claim.js 실코드.
//  - 4수치(pop/stability/prosperity/influence)·Lv = island.growth(settlement.js 성장 엔진), growthOf로 안전 조회.
//  - 건물 카탈로그·비용 = ctx.settlement.BUILDINGS + BAL.buildings[id].cost — settlement.js render()와 동일 조회 방식.
//  - 건설 = ctx.settlement.ghostShow/ghostConfirm/build — 기존 고스트 배치 흐름 그대로(위치 체크 canBuildAt 포함).
//  - 슬롯 상한 = BAL.buildings.slotCount(=8) — settlement slotN()과 동일 SSOT.
//  - hidden(harbor) 건물 목록 제외 = settlement render()와 동일 규칙(G키 전용).
//  - 레이아웃(상단 타이틀바·좌 레일·중 카탈로그·우 상세) = ref/내섬메뉴샘플(DD2)·내섬메뉴샘플2(LotR) 마스터-디테일 패턴.
// 제안(작성자 판단):
//  - N키 진입(사령관 확정 "KeyN, 위치 무관"), ESC 닫기, 다른 모달 열림 시 양보(겹침 방지).
//  - 섬/건물 자동 선택(첫 항목) — 마스터-디테일 빈 화면 방지.
//  - 성공 토스트는 build() 내부 것에 위임, 실패만 이 화면에서 토스트(중복 방지).
//
// 🔍 내 섬 감사 반영(2026-07-22, `_내섬_감사.md`):
//  - A6 isleName(isl, 0) 인덱스 하드코딩 → islandIdx(isl). 이름 없는 섬이 전부 "점령 거점 1"로 보이던 버그.
//  - B1 동일 건물 상한: 카탈로그 ×have/max 표시 + 상한 도달 시 리스트 흐림·버튼 "이 섬 최대 (N채)".
//       상한값은 settlement.maxOf(=BAL.buildings[id].max)에서만 읽는다(계산 이원화 금지).
//  - B2 성장 노출: 4수치 아래 **다음 Lv 게이지 + 미달 항목 + 슬롯 보상(cap→nextCap)**. 임계 사본 LV_REQ는
//       settlement.recalcLv와 함께 수정해야 한다(주석 명시).
//  - B3 여관 리롤 차단: openPanel의 _innCands=null 제거 + (섬 좌표 + 6분 교대 슬롯) 결정론 시드(mulberry32).
//       영입 성공 시에만 재추첨(로스터가 실제로 바뀌므로).
//  - B4 openAt(island, bldId): 건물 앞 [E](settlement.runAct)가 해당 건물 상세로 바로 열게 하는 진입점.
