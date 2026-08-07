// harbor.js — 항구 관리 허브 (invui 톤 통일: 다크 네이비 글래스 + 골드/청록, 백드롭 블러).
//   ★진입: 교역소 NPC(trader.js) 앞 [E] → openAt / 점령 항구(claim) 근처 [E] → open.
//   탭: 🏪교역(구매·판매, ctx.trade 살아있는 시세) / 🔧배 수리 / ⚓업그레이드 / 🕳️던전 / 🏗️건설.
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT (내구도 최대·수리비)
export function initHarbor(ctx){
  const NEAR=16;
  ctx.shipUpgrades = ctx.shipUpgrades || { speed:0, cannon:0, sail:0 };   // ★D1(2026-07-15): 배 업그레이드 레벨(save.js 왕복). 적용=ship.js(속도·돛)·navalcombat.js(대포).
  let open=false, near=null, curTab='trade', tradeMode='buy', vesselMode='fleet', curTip='';

  // ── invui 톤 스타일 ──
  const st=document.createElement('style'); st.textContent=`
    #hb_prompt{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:25;background:rgba(8,14,22,.82);color:#ffe28a;padding:9px 22px;border-radius:9px;border:1px solid rgba(201,168,90,.5);font:14px Pretendard,system-ui,'Malgun Gothic';display:none;pointer-events:none;text-shadow:0 1px 3px #000;box-shadow:0 4px 16px rgba(0,0,0,.5)}
    #hb_panel{position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:rgba(6,11,18,.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-family:Pretendard,system-ui,'Malgun Gothic'}
    #hb_card{width:min(760px,93vw);background:linear-gradient(180deg,rgba(13,20,30,.94),rgba(8,12,19,.96));border:1px solid rgba(201,168,90,.45);border-radius:14px;overflow:hidden;box-shadow:0 26px 80px rgba(0,0,0,.7),inset 0 0 40px rgba(40,70,90,.08)}
    #hb_head{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid rgba(201,168,90,.3)}
    #hb_title{color:#f3e8ca;font-size:21px;font-weight:800;letter-spacing:.1em;border-left:3px solid #e7c878;padding-left:12px;text-shadow:0 2px 6px #000}
    #hb_gold{display:flex;align-items:center;gap:8px;font:800 16px Pretendard;color:#f3d978;font-variant-numeric:tabular-nums;background:rgba(8,14,22,.6);border:1px solid rgba(201,168,90,.4);border-radius:20px;padding:5px 14px}
    #hb_gold .gic{width:16px;height:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe9a3,#caa033 70%)}
    #hb_x{color:#d9c89a;cursor:pointer;font-size:20px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(201,168,90,.32);border-radius:8px;background:rgba(8,14,22,.5)}#hb_x:hover{color:#ffe28a}
    #hb_tabs{display:flex;gap:8px;padding:14px 24px 0;border-bottom:1.5px solid rgba(201,168,90,.5)}
    .hb_tab{display:flex;align-items:center;gap:7px;padding:9px 18px 12px;cursor:pointer;color:rgba(228,220,196,.5);font:700 15px Pretendard;letter-spacing:.03em;border:none;background:none;border-bottom:3px solid transparent;margin-bottom:-1.5px;transition:.12s;text-shadow:0 1px 3px #000}
    .hb_tab:hover{color:#ded2ad}
    .hb_tab.on{color:#ffeab2;border-bottom-color:#f0cf80;text-shadow:0 0 10px rgba(240,207,128,.55)}
    /* ⬍ 스크롤(사령관 2026-08-07 "스크롤로 위아래 조절 가능하게") — 교역 품목·배 목록이 길어지면 카드 밖으로 잘리던 것.
       카드가 overflow:hidden이라 본문에서 직접 세로 스크롤을 받는다. 높이는 화면 비례 상한(작은 화면에서도 안 넘침). */
    #hb_body{padding:22px 24px;min-height:240px;max-height:min(66vh,620px);overflow-y:auto;overscroll-behavior:contain;color:#d8cba8}
    #hb_body::-webkit-scrollbar{width:9px}
    #hb_body::-webkit-scrollbar-track{background:rgba(8,14,22,.5);border-radius:5px}
    #hb_body::-webkit-scrollbar-thumb{background:rgba(201,168,90,.42);border-radius:5px}
    #hb_body::-webkit-scrollbar-thumb:hover{background:rgba(201,168,90,.65)}
    .hb_seg{display:flex;gap:6px;margin-bottom:16px}
    .hb_segb{flex:1;padding:11px;text-align:center;cursor:pointer;border-radius:9px;font:700 15px Pretendard;color:rgba(228,220,196,.6);background:rgba(255,255,255,.04);border:1px solid rgba(201,168,90,.22);transition:.12s}
    .hb_segb.on{color:#ffeab2;background:rgba(70,140,165,.2);border-color:rgba(150,210,230,.5);box-shadow:0 0 12px rgba(120,210,235,.22)}
    .hb_row{display:flex;align-items:center;gap:14px;padding:11px 14px;margin:7px 0;background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;box-shadow:inset 0 0 30px rgba(0,0,0,.32)}
    .hb_row .hbic{filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))}
    .hb_row .nm{width:80px;font:700 15px Pretendard;color:#f0e0b0}
    .hb_row .pr{width:96px;color:#f3d978;font-variant-numeric:tabular-nums;font-weight:700}
    .hb_row .hv{width:64px;color:#9fbac4;font-size:13px}
    .hb_act{margin-left:auto;background:linear-gradient(180deg,#ecc962,#a9842f);color:#2a1d06;border:1px solid #d8b24e;border-radius:8px;padding:8px 18px;font:800 14px Pretendard;cursor:pointer;box-shadow:0 2px 8px rgba(180,140,50,.3)}
    .hb_act:hover{filter:brightness(1.1)}
    .hb_act.sell{background:linear-gradient(180deg,#7fc0d0,#3a7d92);color:#06222a;border-color:#8fe0f0;box-shadow:0 2px 8px rgba(80,170,200,.3)}
    .hb_act:disabled{background:#332f24;color:#7a6f55;border-color:#4a4233;box-shadow:none;cursor:default;filter:none}
    .hb_btn{background:linear-gradient(180deg,#ecc962,#a9842f);color:#2a1d06;border:1px solid #d8b24e;border-radius:9px;padding:12px 24px;font:800 15px Pretendard;cursor:pointer;box-shadow:0 3px 12px rgba(180,140,50,.3)}
    .hb_btn:hover{filter:brightness(1.1)}.hb_btn:disabled{background:#332f24;color:#7a6f55;cursor:default}
    .hb_ph{text-align:center;padding:40px 0;color:#8a7d5e}`;
  document.head.appendChild(st);

  const prompt=document.createElement('div'); prompt.id='hb_prompt'; prompt.textContent='[E] 항구 관리'; document.body.appendChild(prompt);
  const panel=document.createElement('div'); panel.id='hb_panel';
  panel.innerHTML=`<div id="hb_card">
    <div id="hb_head"><div id="hb_title"><span id="hb_isle">항구</span> 관리</div>
      <div style="display:flex;align-items:center;gap:14px"><div id="hb_gold"><span class="gic"></span><span id="hb_goldn">0</span></div><div id="hb_x">✕</div></div></div>
    <div id="hb_tabs">
      <button class="hb_tab" data-t="trade">교역</button>
      <button class="hb_tab" data-t="vessel">배 관리</button>
    </div>
    <div id="hb_body"></div></div>`;
  document.body.appendChild(panel);
  const body=panel.querySelector('#hb_body'), isleEl=panel.querySelector('#hb_isle'), goldEl=panel.querySelector('#hb_goldn');

  function ph(t,d){ return `<div class="hb_ph"><div style="font-size:22px;margin-bottom:8px">${t}</div><div style="font-size:13px">${d}</div></div>`; }
  function refreshGold(){ if(goldEl) goldEl.textContent=(ctx.inventory?ctx.inventory.gold:0).toLocaleString(); }

  function renderTab(t){
    curTab=t;
    panel.querySelectorAll('.hb_tab').forEach(b=>b.classList.toggle('on', b.dataset.t===t));
    if(t==='vessel') renderVessel();
    else renderTrade();   // 항구 관리 = 교역 + 배관리만(사령관 2026-07-10: 수비/여관/던전은 내섬 건물로 이관)
    refreshGold();
  }

  // ── 추종자 시세 대사 — 전 항구 priceAt 비교 → 차익 최대 품목의 싼항/비싼항을 방위+거리로(반말, 추종자 톤). ──
  //   항구가 무명(좌표만)이라 플레이어 기준 8방위+거리로 지목. 교역소 열 때마다(openPanel) 재계산 → 매번 다른 소식.
  const _TG=[['rum','럼'],['silk','비단'],['spice','향신료'],['gem','보석']];
  const _DIRS=['북','북동','동','남동','남','남서','서','북서'];
  function _dir(a,b){ const t=Math.atan2(b.x-a.x,-(b.z-a.z)); return _DIRS[Math.round(((t+Math.PI*2)%(Math.PI*2))/(Math.PI/4))%8]; }
  function _dist(a,b){ const d=Math.hypot(b.x-a.x,b.z-a.z); return d>=1000?(d/1000).toFixed(1)+'km':Math.round(d)+'m'; }
  function _josa(w){ const c=w.charCodeAt(w.length-1); return (c>=0xAC00&&c<=0xD7A3&&(c-0xAC00)%28!==0)?'이':'가'; }
  function _marketTip(){
    const npc=ctx.npc, wm=ctx.worldmap, pp=ctx.player&&ctx.player.pos;
    if(!npc||!npc.priceAt||!wm||!pp) return '바닷길 소식은 아직 못 들었어. 항구를 더 둘러보자.';
    const ports=wm.islands.filter(i=>i.hasPort); let best=null;
    for(const [k,ko] of _TG){ let lo=null,hi=null;
      for(const p of ports){ const pr=npc.priceAt(p.id,k); if(pr==null) continue;
        if(!lo||pr<lo.pr)lo={p,pr}; if(!hi||pr>hi.pr)hi={p,pr}; }
      if(!lo||!hi||lo.p===hi.p) continue; const sp=hi.pr-lo.pr; if(!best||sp>best.sp)best={ko,lo,hi,sp}; }
    if(!best) return '요즘 시세는 잠잠해. 잠시 뒤에 다시 와.';
    const {ko,lo,hi,sp}=best;
    return `${_dir(pp,lo.p)}쪽 ${_dist(pp,lo.p)} 항구에 ${ko}${_josa(ko)} 싸 (${Math.round(lo.pr)}금). `
         + `${_dir(pp,hi.p)}쪽 ${_dist(pp,hi.p)} 항구로 가져가면 ${Math.round(hi.pr)}금에 팔려. 차익 약 ${Math.round(sp)}금!`;
  }
  // 추종자 대사 박스(시안=정보 톤). 화자 이름 = select.html이 넘긴 ?followerName= (opening/questline과 동일 소스), 없으면 '추종자'.
  // ⛔ 추종자(NPC) 대사 박스 폐지 — 사령관 2026-08-07 "항구관리 NPC 빼고".
  //   시세 계산(_tipText)은 남겨둔다: 나중에 다른 곳(툴팁·항해 안내 등)에서 재사용할 수 있고, 제거하면 회귀 위험만 커진다.
  function _tipBox(){ return ''; }

  // 🏪 교역 — 구매하기 / 판매하기 (ctx.trade 살아있는 시세)
  function renderTrade(){
    // ★E1(2026-07-15): 입항 게이트 — 악명이 임계 이상이면(reputation.canEnterPort) 교역만 거부. 정박·배 수리는 계속 허용 → 완전 데드락 방지.
    if(ctx.reputation && ctx.reputation.canEnterPort && !ctx.reputation.canEnterPort(near&&near.id)){
      if(ctx.invui?.toast) ctx.invui.toast('악명이 높아 이 항구는 당신을 거부한다 — 교역 불가(배 수리·정박은 가능)');
      body.innerHTML=ph('교역 거부','악명이 높아 이 항구 상인들이 거래를 거부합니다.<br>「배 관리」 탭에서 수리·정박·함대 관리는 계속 이용할 수 있습니다.');
      return;
    }
    if(!ctx.trade){ body.innerHTML=ph('교역','trade.js 연결 필요'); return; }
    if(near) ctx.trade.setIsle(near.x, near.z);   // 이 항구 시세로
    const goods=ctx.trade.GOODS||[];
    const rows=goods.map(g=>{
      const pr=ctx.trade.priceOf(g.k)||0, have=ctx.trade.cargoCount(g.k);
      if(tradeMode==='buy'){
        const can=ctx.inventory && ctx.inventory.gold>=pr && ctx.inventory.canLoad(g.k,1);
        return `<div class="hb_row"><span class="nm">${g.name}</span><span class="pr">${pr} 금화</span><span class="hv">보유 ${have}</span><button class="hb_act" data-buy="${g.k}" ${can?'':'disabled'}>사기</button></div>`;
      }
      return `<div class="hb_row"><span class="nm">${g.name}</span><span class="pr">${pr} 금화</span><span class="hv">보유 ${have}</span><button class="hb_act sell" data-sell="${g.k}" ${have>0?'':'disabled'}>팔기</button></div>`;
    }).join('');
    // ★화물칸 표시(사령관 버그: 교역 중 화물칸 얼마 찼는지 안 보임) — trade.js render()의 '화물 X.X/Y' 패턴 이식.
    const inv=ctx.inventory;
    const cargoLine = inv ? `<div style="text-align:right;font-size:12.5px;color:#9fbac4;margin-bottom:10px">화물칸 <b style="color:${inv.cargoWeight>=inv.cargoCapacity?'#ff9a80':'#f0e0b0'}">${inv.cargoWeight.toFixed(1)}/${inv.cargoCapacity}</b></div>` : '';
    body.innerHTML=`${_tipBox()}${cargoLine}<div class="hb_seg"><div class="hb_segb ${tradeMode==='buy'?'on':''}" data-m="buy">구매하기</div><div class="hb_segb ${tradeMode==='sell'?'on':''}" data-m="sell">판매하기</div></div>${rows}<div style="margin-top:12px;font-size:12px;color:#7d97ab">싸게 사서 다른 항구에서 비싸게 — 같은 품목을 거래하면 시세가 움직입니다</div>`;
    body.querySelectorAll('.hb_segb').forEach(b=>b.onclick=()=>{ tradeMode=b.dataset.m; renderTrade(); });
    body.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ ctx.trade.buy(b.dataset.buy); renderTrade(); refreshGold(); });
    body.querySelectorAll('[data-sell]').forEach(b=>b.onclick=()=>{ ctx.trade.sell(b.dataset.sell); renderTrade(); refreshGold(); });
  }

  // 🚢 배 관리 — 제작 / 업그레이드 / 수리 / 화물칸 증설 (하위 세그먼트)
  function renderVessel(){
    const subs=[['fleet','내 함대'],['craft','제작'],['repair','수리'],['cargo','화물칸'],['upgrade','⬆️ 업글']];
    const seg=subs.map(([k,l])=>`<div class="hb_segb ${vesselMode===k?'on':''}" data-vm="${k}">${l}</div>`).join('');
    let inner='';
    if(vesselMode==='fleet'){
      const fleet=ctx.fleet||[];
      if(!fleet.length) inner=ph('내 함대','아직 배가 없습니다 — 🔨제작에서 건조하세요');
      else inner=fleet.map((f,i)=>{ const cur=ctx.ship===f.bs, ko=f.key==='caravel'?'캐러벨':'롱십';
        return `<div class="hb_row"><span class="nm" style="width:auto;min-width:88px">${cur?'▸ ':''}${f.name}</span><span style="flex:1;font-size:13px;color:#9fbac4">${ko}</span><button class="hb_act sell" data-call="${i}">호출</button><button class="hb_act" data-board="${i}">탑승</button></div>`;
      }).join('')+`<div style="margin-top:10px;font-size:12px;color:#7d97ab">호출 = 멀리서 이 항구로 자동항해 정박 · 탑승 = 그 배로 전환</div>`;
    }
    else if(vesselMode==='repair'){
      const DM=BAL.ship.durMax, bs=ctx.ship, dur=bs?Math.round(bs.durability!=null?bs.durability:DM):DM, cost=Math.round((DM-dur)*BAL.ship.repairCostPerDur);
      inner=`<div style="margin-bottom:8px;font-size:15px">현재 배 내구도 <b style="color:${dur>50?'#aef0c8':(dur>20?'#f3d978':'#ff9090')}">${dur} / ${DM}</b></div>
        <div style="height:14px;background:rgba(8,14,22,.7);border:1px solid rgba(201,168,90,.3);border-radius:7px;overflow:hidden;margin-bottom:16px"><div style="height:100%;width:${dur}%;background:linear-gradient(90deg,#3a7d92,#7fc0d0);transition:width .2s"></div></div>
        <button class="hb_btn" id="hb_repair" ${(dur>=DM||!bs)?'disabled':''}>수리 (${cost} 금화)</button>
        <div style="margin-top:10px;font-size:12px;color:#7d97ab">항해·충돌로 닳습니다 · 항구에서 금화로 수리</div>`;
    }
    else if(vesselMode==='cargo'){
      const cap=ctx.inventory?(ctx.inventory.cargoCapacity||20):20, cost=200, can=ctx.inventory&&ctx.inventory.gold>=cost;
      inner=`<div style="margin-bottom:6px;font-size:15px">현재 화물칸 용량 <b style="color:#f0e0b0">${cap}</b></div>
        <div style="margin-bottom:16px;font-size:13px;color:#9fbac4">증설 시 +10 — 교역품을 더 많이 싣습니다</div>
        <button class="hb_btn" id="hb_cargo" ${can?'':'disabled'}>화물칸 증설 (${cost} 금화)</button>`;
    }
    else if(vesselMode==='upgrade'){
      // ★D1(2026-07-15): 배 업그레이드 — 속도/대포/돛 각 3레벨. 현재 조종 배에 적용(ctx.shipUpgrades, BAL.ship.upgrades SSOT).
      ctx.shipUpgrades = ctx.shipUpgrades || { speed:0, cannon:0, sail:0 };
      const U=BAL.ship.upgrades, lv=ctx.shipUpgrades, gold=ctx.inventory?ctx.inventory.gold:0;
      const defs=[['speed','속도','⛵','항해 최대속도 상승'],['cannon','대포','💥','해전 포격 위력 상승'],['sail','돛','🌬️','전력항해(Shift) 부스트 상승']];
      inner=defs.map(([k,label,ic,desc])=>{
        const u=U[k], cur=lv[k]||0, atMax=cur>=u.max, cost=atMax?0:u.cost[cur], pct=Math.round(u.mult*100);
        const pips=Array.from({length:u.max},(_,i)=>`<span style="display:inline-block;width:16px;height:8px;border-radius:2px;margin-right:4px;background:${i<cur?'#f0cf80':'rgba(255,255,255,.12)'}"></span>`).join('');
        const btn=atMax?`<button class="hb_act" disabled>MAX</button>`:`<button class="hb_act" data-up="${k}" ${gold>=cost?'':'disabled'}>${cost} 금화</button>`;
        return `<div class="hb_row"><span class="hbic" style="font-size:20px">${ic}</span><span class="nm" style="width:auto;min-width:56px">${label}</span>
          <div style="flex:1"><div style="font-size:12px;color:#9fbac4;margin-bottom:5px">${desc} · Lv ${cur}/${u.max} <span style="color:#f0e0b0">(레벨당 +${pct}%)</span></div><div>${pips}</div></div>${btn}</div>`;
      }).join('')+`<div style="margin-top:12px;font-size:12px;color:#7d97ab">업그레이드는 지금 조종 중인 배에 적용됩니다</div>`;
    }
    else if(vesselMode==='craft'){
      if(!ctx.shipyard) inner=ph('배 제작','드라이독 — shipyard 연결 필요');
      else inner=ctx.shipyard.SHIPS.map(s=>`<div class="hb_row"><span class="nm" style="width:92px">${s.name}</span><span style="flex:1;font-size:13px;color:#f3d978">◎${s.gold} 금화</span><button class="hb_act" data-build="${s.key}">건설</button></div>`).join('')+`<div style="margin-top:10px;font-size:12px;color:#7d97ab">건설 → 바로 이름 짓고 건조(부두 옆 바다에 배치)</div>`;
    }
    body.innerHTML=`<div class="hb_seg" style="flex-wrap:wrap">${seg}</div>${inner}`;
    body.querySelectorAll('[data-vm]').forEach(b=>b.onclick=()=>{ vesselMode=b.dataset.vm; renderVessel(); });
    const cb=body.querySelector('#hb_cargo'); if(cb) cb.onclick=()=>{ const cost=200;
      if(ctx.inventory && ctx.inventory.gold>=cost){ ctx.inventory.addGold(-cost); ctx.inventory.setCargoCapacity((ctx.inventory.cargoCapacity||20)+10); renderVessel(); refreshGold(); } };
    body.querySelectorAll('[data-build]').forEach(b=>b.onclick=()=>{ close(); ctx.shipyard&&ctx.shipyard.build(b.dataset.build); });   // ★즉시 건조(바로 이름짓기, 고스트·좌클릭 없음 — 사령관)
    // ★D1(2026-07-15): 배 업그레이드 구매 — 골드 차감(inventory.addGold) 후 레벨+1. 상한(MAX) 도달 시 버튼 비활성.
    body.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{ const k=b.dataset.up, u=BAL.ship.upgrades[k]; const lv=ctx.shipUpgrades=(ctx.shipUpgrades||{speed:0,cannon:0,sail:0});
      const cur=lv[k]||0; if(cur>=u.max) return; const cost=u.cost[cur];
      if(ctx.inventory && ctx.inventory.gold>=cost && ctx.inventory.addGold(-cost)){ lv[k]=cur+1;
        if(ctx.save && ctx.save.write) try{ ctx.save.write(); }catch(_){}   // 즉시 저장(구매 직후 이탈해도 유지)
        if(ctx.invui&&ctx.invui.toast) ctx.invui.toast(({speed:'속도',cannon:'대포',sail:'돛'}[k]||'배')+' 업그레이드 Lv'+(cur+1)+' 완료');
        renderVessel(); refreshGold(); } });
    // 함대: 호출(자동항해 정박) / 탑승(그 배로 전환)
    // ★완파 상태 정규화(사령관 버그: "터진 배 호출하니 불탄 채 소환") — 구식 침몰(_sunk·mesh 숨김)로 남은 배를
    //   반파(_crippled·내구도0)로 승격: 선체 복원(절단 전 원본), 화재는 유지 → 수리해야 출항.
    const _normalizeWreck = bs => { if(!bs) return;
      if(bs._sunk && !bs._crippled){ bs._crippled=true; bs.durability=0; bs._wrecking=false;
        if(bs.mesh) bs.mesh.visible=true; }
      if(bs._crippled){ bs.boarded=false; bs.speed=0; bs.autopilot=null; } };
    body.querySelectorAll('[data-call]').forEach(b=>b.onclick=()=>{ const f=(ctx.fleet||[])[+b.dataset.call];
      _normalizeWreck(f&&f.bs);
      if(f&&f.bs&&near){   // ★멀리서 팝업 → 이 항구 정박점까지 자동항해 → 닻(harbor 개편 2026-07-04)
        const isle=near, dp=isle.dockPoint||{x:isle.x,z:isle.z};
        let ox=dp.x-isle.x, oz=dp.z-isle.z; const ol=Math.hypot(ox,oz)||1; ox/=ol; oz/=ol;   // 섬중심→정박점 = 바다쪽
        f.bs.x=dp.x+ox*55; f.bs.z=dp.z+oz*55;      // 정박점 바다쪽 55m서 팝업
        f.bs.yaw=Math.atan2(oz, -ox);              // 뱃머리를 정박점 쪽으로(U턴 최소화)
        f.bs.boarded=false; f.bs.speed=0; f.bs.anchored=false; f.bs.furl=0;
        f.bs.autopilot={ x:dp.x, z:dp.z, r:14 };   // 🧭 ship.js 자동항해 → 도착 시 닻
        if(ctx.invui?.toast) ctx.invui.toast(''+(f.name||'배')+'가 항구로 항해해 옵니다');
      }
      renderVessel(); });
    body.querySelectorAll('[data-board]').forEach(b=>b.onclick=()=>{ const f=(ctx.fleet||[])[+b.dataset.board];
      _normalizeWreck(f&&f.bs);
      if(f&&f.bs){ ctx.ship=f.bs;   // 그 배로 전환 + 갑판 위로 텔레포트(player.pos 직접수정은 물리 body라 무효 → setSpawn)
        if(ctx.player&&ctx.player.setSpawn){ const dy=(f.bs.buoyY!=null?f.bs.buoyY:0)+(f.bs.deckLocalY||2)+0.7; ctx.player.setSpawn(f.bs.x, dy, f.bs.z); } }
      close(); });
    // 배 수리: 현재 배 내구도 회복(금화). ★반파(_crippled — 해전 완파) 배는 수리 시 반파 해제+화재 소화+출항 재개(사령관 2026-07-04)
    const rp=body.querySelector('#hb_repair'); if(rp) rp.onclick=()=>{ const bs=ctx.ship; if(!bs) return;
      const DM=BAL.ship.durMax, dur=bs.durability!=null?bs.durability:DM, cost=Math.round((DM-dur)*BAL.ship.repairCostPerDur);
      if(ctx.inventory && ctx.inventory.gold>=cost){ ctx.inventory.addGold(-cost); bs.durability=DM;
        if(bs._crippled){ bs._crippled=false; bs._sunk=false; bs.hp=bs.maxHp||bs.hp;
          try{ ctx.shipwreck && ctx.shipwreck.extinguish && ctx.shipwreck.extinguish(bs); }catch(_){}
          if(ctx.invui?.toast) ctx.invui.toast('수리 완료 — 다시 출항할 수 있습니다'); }
        renderVessel(); refreshGold(); } };
  }

  function openPanel(){ if(!near) return; open=true; curTip=_marketTip(); isleEl.textContent=near.name||'항구'; panel.style.display='flex'; renderTab(curTab); if(document.exitPointerLock) document.exitPointerLock();
    // ★마지막 정박 항구 = 게임오버 부활지점(combat.js). ★2026-07-23 버그수정: near.x/z는 섬 중심이라 groundAt이 항구 건물 지붕을 짚어 "건물 위 스폰"이 됐다.
    //   → 패널 열 때 플레이어는 이미 걸어서 항구 앞 **바닥**에 서 있으므로 그 실좌표(x,z,y)를 그대로 부활점으로 저장. 배 위(boarded)면 dockPoint(접안점) 폴백.
    { const _py=ctx.player?.pos; const _onFoot=!(ctx.ship&&ctx.ship.boarded);
      ctx.lastHarbor = (_onFoot && _py)
        ? { x:_py.x, z:_py.z, y:_py.y, name:near.name||'항구' }
        : { x:(near.dockPoint?.x??near.x), z:(near.dockPoint?.z??near.z), y:(near.y!=null?near.y:(_py?_py.y:null)), name:near.name||'항구' }; }
  }
  function openAt(isle){ near=isle; openPanel(); }     // ★교역소 NPC(trader) 진입점
  function close(){ open=false; panel.style.display='none'; }
  panel.querySelector('#hb_x').onclick=close;
  panel.addEventListener('click',e=>{ if(e.target===panel) close(); });
  panel.querySelectorAll('.hb_tab').forEach(b=>b.onclick=()=>renderTab(b.dataset.t));
  addEventListener('keydown',e=>{ if(e.code==='Escape'&&open) close(); });

  // 점령 항구(claim) 근처 자동 프롬프트 — NPC 진입은 trader.js가 openAt 호출.
  //   ★Phase C-1(사령관 확정 2026-07-12): 관리 프롬프트 = **owner==='player' 항구만**. 기존 `||c.dockPoint`는
  //   소유권이 넘어간(claimIsland 등) 레코드도 dockPoint만 있으면 관리창을 열어줬음 → 점령 완료 전 관리·교역 불가 원칙으로 게이트.
  //   ★2026-07-13 추가: owner==='player'만으로는 건물 0개인 맨 깃발 점령 직후에도 관리창이 뜸(사령관 실측 버그) —
  //   hasHarbor(직접 건설한 실제 항구, 또는 상속 건물이 있는 점령 거점)까지 확인. hasHarbor 없으면 관리할 게 없다.
  ctx.onUpdate(()=>{ if(open) return; near=null; const pp=ctx.player&&ctx.player.pos, list=ctx.claimed||[];
    if(pp) for(const c of list){ if(c.owner==='player' && c.hasHarbor && Math.hypot(pp.x-c.x,pp.z-c.z)<NEAR){ near=c; break; } }
    prompt.style.display = near?'block':'none'; });
  addEventListener('keydown',e=>{ if(e.code==='KeyE'&&!open&&near&&document.pointerLockElement===ctx.renderer.domElement) openPanel(); });

  ctx.harbor={ open:openPanel, openAt, close, isOpen:()=>open, _setNear:c=>{near=c;} };
  console.log('[harbor] 항구 관리 허브(invui톤) — 교역(구매/판매)/배관리(제작·수리·화물·업글)만. 용병·추종자·던전은 내섬 건물로 이관. NPC E(openAt) 또는 항구 근처 E.');
  return ctx.harbor;
}
