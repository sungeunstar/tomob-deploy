// gathertuto.js — 채집 튜토리얼(벌목·채광). 전투 튜토(combattuto.js)와 동일 패턴.
//   사령관 지시: 돌채광·나무벌목도 항해튜토·전투튜토처럼 튜토리얼 팝업으로.
//   구조 = combattuto.js 이식(#gtuto 중앙팝업 + 키칩 글로우 + 행동감지 자동전환 + localStorage 1회).
//   단계: ①벌목(도끼 장착[2] → 좌클릭, 나무 쓰러뜨린 뒤 통나무 패기) → ②채광(곡괭이 장착[1] → 좌클릭).
//   발동 = 퀘스트 Q2에서 ctx.gatherTuto.start() 호출 / 비퀘스트 자유플레이는 채집도구(axe·pickaxe) 첫 장착 시 자동.
//
//   [행동감지 근거 — 코드 확인]
//     도구: ctx.player.currentTool = 'axe'/'pickaxe' (player.js LOADOUT: 1=곡괭이·2=도끼)
//     벌목 성공: ctx.inventory.count('timber') 증가 (axetree.js:180 pickup.spawn 'timber')
//     채광 성공: 광물(stone 등) count 증가 (mine.js)

const LS_KEY = 'mas_gather_tuto_done';
const ORE = ['stone','copper','coal','iron','tin','cobalt','gold','silver','gem'];

const STEPS = {
  chop: { title:'벌목 — 도끼로 나무를 베어라',
    text:`<p>배를 다시 지으려면 <b>목재</b>가 필요하다. <b style="color:#f0d9a8">도끼</b>를 들고 나무 앞에서 <b>좌클릭</b>하라.</p>
          <p>서 있는 나무는 먼저 <b>쓰러지고</b>, 쓰러진 <b>통나무를 한 번 더</b> 치면 통나무와 나뭇잎이 쏟아진다. 다가가면 몸으로 빨려든다.</p>`,
    keys:[['2','도끼 장착 (퀵슬롯)'],['LMB','도끼질 — 쓰러뜨린 뒤 통나무 패기']],
    foot:'도끼(퀵슬롯 2)를 들고 나무를 베어라' },
  mine: { title:'채광 — 곡괭이로 돌을 캐라',
    text:`<p>이제 <b>돌</b>이 필요하다. <b style="color:#f0d9a8">곡괭이</b>로 바꿔 들고(퀵슬롯 <b>1</b>) 바위·광맥에 다가가 <b>좌클릭</b>하라.</p>
          <p>광물이 부서져 바닥에 쏟아지면 다가가 주워라.</p>`,
    keys:[['1','곡괭이 장착 (퀵슬롯)'],['LMB','채광 — 바위·광맥 캐기']],
    foot:'곡괭이(퀵슬롯 1)를 들고 돌을 캐라' },
};

export function initGatherTuto(ctx){
  try { if(localStorage.getItem(LS_KEY)) { const noop=()=>{}; ctx.gatherTuto={ start:noop, close:noop }; return ctx.gatherTuto; } } catch(_){}

  const count = id => (ctx.inventory && ctx.inventory.count) ? ctx.inventory.count(id) : 0;
  const oreSum = () => ORE.reduce((s,id)=>s+count(id),0);

  // ── Pretendard(엘든 톤) 주입 ──
  if(!document.querySelector('link[href*="pretendard"]')){
    const f=document.createElement('link'); f.rel='stylesheet';
    f.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(f);
  }

  // ── CSS (combattuto #tuto 이식, id=#gtuto — 충돌 방지) ──
  if(!document.getElementById('_gathertuto-css')){
    const css=document.createElement('style'); css.id='_gathertuto-css';
    css.textContent=`
      #gtuto{position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:60;width:min(700px,86vw);
        background:linear-gradient(180deg,rgba(14,16,20,.90),rgba(10,12,16,.86));
        border:1px solid rgba(176,148,96,.42);border-radius:6px;
        box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.5);
        color:#e9e2d2;pointer-events:none;overflow:hidden;font:13px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;
        opacity:0;transition:opacity .45s ease, transform .45s ease;}
      #gtuto.show{opacity:1;}
      #gtuto .x{position:absolute;top:9px;right:11px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
        color:#9a917d;font-size:15px;cursor:pointer;border-radius:5px;border:1px solid rgba(176,148,96,.22);
        background:rgba(0,0,0,.25);transition:color .15s,border-color .15s,background .15s;z-index:2;pointer-events:auto;}
      #gtuto .x:hover{color:#f0d9a8;border-color:rgba(176,148,96,.55);background:rgba(0,0,0,.45);}
      #gtuto .k.active{color:#1a160e;background:linear-gradient(180deg,#f5e0ab,#dcbb7c);border-color:#f5e0ab;
        box-shadow:0 0 11px rgba(245,224,171,.65);transform:translateY(1px);}
      #gtuto .keys .row{transition:opacity .42s ease, max-height .42s ease, margin .42s ease, transform .42s ease;
        overflow:hidden;max-height:44px;}
      #gtuto .keys .row.done{opacity:0;max-height:0;margin:0;transform:translateX(8px);}
      #gtuto .ti{text-align:center;font-size:19px;font-weight:600;letter-spacing:.04em;color:#f0d9a8;padding:15px 20px 13px;position:relative;}
      #gtuto .ti::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(176,148,96,.5),transparent);}
      #gtuto .bd{padding:18px 26px 8px;}
      #gtuto .tx{font-size:14.5px;line-height:1.85;color:#d8d0bf;}
      #gtuto .tx p{margin:0 0 10px;}
      #gtuto .keys{padding:4px 26px 4px;font-size:14px;color:#cfc6b2;}
      #gtuto .keys .row{display:flex;align-items:center;gap:9px;margin:7px 0;}
      #gtuto .k{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;
        background:linear-gradient(180deg,#2c3036,#191c20);border:1px solid #5a5141;border-bottom-width:2px;border-radius:5px;
        color:#f0e6cf;font:700 13px/1 ui-monospace,Consolas,monospace;box-shadow:0 1px 0 rgba(0,0,0,.5);}
      #gtuto .ft{text-align:center;font-size:12.5px;color:#9a917d;letter-spacing:.03em;padding:11px 20px 14px;margin-top:6px;position:relative;}
      #gtuto .ft::before{content:"";position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(176,148,96,.34),transparent);}
    `;
    document.head.appendChild(css);
  }

  // ── DOM ──
  const el=document.createElement('div'); el.id='gtuto';
  el.innerHTML=`
    <div class="x" title="닫기 (X)">✕</div>
    <div class="ti"></div>
    <div class="bd"><div class="tx"></div></div>
    <div class="keys"></div>
    <div class="ft"></div>`;
  document.body.appendChild(el);
  const $ti=el.querySelector('.ti'), $tx=el.querySelector('.tx'), $keys=el.querySelector('.keys'), $ft=el.querySelector('.ft'), $x=el.querySelector('.x');

  let started=false, done=false, phase=null, hidden=false;
  // 🎯 중앙 팝업 단일 슬롯(tutoslot.js) 경유 — gather=우선순위 1(passive). 슬롯 없으면 직접 토글(폴백).
  const _slotShow = () => { if(ctx.tutoSlot) ctx.tutoSlot.show('gather', 1, el); else el.classList.add('show'); };
  const _slotHide = () => { if(ctx.tutoSlot) ctx.tutoSlot.hide('gather', el); else el.classList.remove('show'); };
  function open(){ hidden=false; _slotShow(); }
  function close(){ hidden=true; _slotHide(); }
  $x.addEventListener('click', close);

  // ── 키칩 글로우(누르는 동안 금빛) ──
  const _num=e=>(e.code&&e.code.startsWith('Digit'))?e.code.slice(5):null;   // 'Digit2'→'2'
  const _glow=(sel,on)=>$keys.querySelectorAll(sel).forEach(c=>c.classList.toggle('active',on));
  window.addEventListener('keydown', e=>{ const n=_num(e); if(n) _glow('.k[data-k="'+n+'"]', true); });
  window.addEventListener('keyup',   e=>{ const n=_num(e); if(n) _glow('.k[data-k="'+n+'"]', false); });
  window.addEventListener('mousedown', e=>{ if(e.button===0) _glow('.k[data-k="LMB"]', true); }, true);
  window.addEventListener('mouseup',   e=>{ if(e.button===0) _glow('.k[data-k="LMB"]', false); }, true);

  function render(step){
    if(done) return;
    const s=STEPS[step]; if(!s) return;
    $ti.textContent=s.title;
    $tx.innerHTML=s.text;
    $keys.innerHTML=s.keys.map(r=>{
      const keys=r.slice(0,-1);
      const ks=keys.map(k=>`<span class="k" data-k="${k}">${k==='LMB'?'좌클릭':k}</span>`).join(' ');
      return `<div class="row">${ks}<span style="color:#b8af9a">${r[r.length-1]}</span></div>`;
    }).join('');
    $ft.innerHTML=`${s.foot} <span style="opacity:.5">·</span> <span style="opacity:.7">[X] 닫기</span>`;   // ❎ X 닫기 안내(첫 튜토 창)
    if(!hidden) _slotShow();
  }
  function goPhase(step){ if(done) return; phase=step; hidden=false; render(step); try{window.__gtutoPhase=step;}catch(_){}}
  function fadeRows(){ $keys.querySelectorAll('.row').forEach(r=>{ if(!r.dataset.done){ r.dataset.done='1'; r.classList.add('done'); } }); }
  function advance(next){ if(done) return; fadeRows(); setTimeout(()=>{ if(!done) goPhase(next); }, 720); }
  function complete(){ if(done) return; done=true; fadeRows(); setTimeout(()=>{ close(); try{localStorage.setItem(LS_KEY,'1');}catch(_){} }, 720); }

  // ── 시작 ──
  let baseTimber=0, baseOre=0;
  function start(){
    if(started||done) return;
    started=true; baseTimber=count('timber'); baseOre=oreSum(); goPhase('chop');
    console.log('[gathertuto] 채집 튜토 시작 — 벌목→채광');
  }

  // ── 행동감지: 벌목(timber↑) → 채광(광물↑) → 완료 ──
  ctx.onUpdate(()=>{
    if(!started||done) return;
    if(phase==='chop' && count('timber')>baseTimber){ baseOre=oreSum(); advance('mine'); }
    else if(phase==='mine' && oreSum()>baseOre){ complete(); }
  });

  // ── 비퀘스트 자유플레이: 채집도구 첫 장착 시 자동 발동 ──
  const questMode = new URLSearchParams(location.search).get('quest')==='1';
  if(!questMode){
    ctx.onUpdate(()=>{ if(started||done) return; const t=ctx.player&&ctx.player.currentTool; if(t==='axe'||t==='pickaxe') start(); });
  }

  ctx.gatherTuto={ start, close, goPhase };
  window.__gatherTuto={ start, close, reset:()=>{ try{localStorage.removeItem(LS_KEY);}catch(_){} location.reload(); } };
  console.log('[gathertuto] 채집 튜토 등록 — ctx.gatherTuto.start() 또는 도구 장착 자동.');
  return ctx.gatherTuto;
}
