// raidtuto.js — 첫 습격 방어 튜토리얼. 채집튜토(gathertuto.js)·전투튜토와 동일 팝업 패턴.
//   짝: questline Q6~Q8 = 점령(공격) 튜토 / 이 파일 = 방어(습격) 튜토. 첫 섬 점령 → 150초 뒤 첫 습격이 "지키는 법" 가르칠 타이밍.
//   ★raid.js 무수정 원칙: ctx.raid.status() 폴링으로 예고→상륙→종료(격퇴/상실) 상태전환만 감지(사령관이 raid.js 편집 중 → 충돌 회피).
//   흐름: [warn 예고] 곧 상륙, 깃발 근처 대비 → [defend 상륙] 습격병 전멸=격퇴 / 깃발 방치 시 섬 상실 → [결과] 격퇴 or 상실 안내 후 닫힘. localStorage 1회.
//
//   [상태감지 근거 — 코드 확인]
//     raid.status() = { enabled, nextT, active:{tribe,phase,living}|null }  (raid.js:60)
//       phase 'warn'  = 예고 배너(warnLeadSec 뒤 상륙) / 'active' = 습격병 상륙 완료
//     소유 판정: ctx.claimed.filter(owner==='player').length  (capture.flipOwner가 등록/제거)

const LS_KEY = 'mas_raid_tuto_done';

const STEPS = {
  warn: { title:'습격 예고 — 거점을 지켜라',
    text:`<p>적대 부족이 네가 점령한 섬을 노린다. <b style="color:#f0d9a8">곧 상륙</b>한다.</p>
          <p>섬의 <b>깃발 거점</b> 근처에서 대비하라. 거점을 비우면 적이 그 자리를 차지해 <b style="color:#e0806a">섬을 빼앗긴다.</b></p>`,
    keys:[['W','A','S','D','거점으로 이동']],
    foot:'곧 상륙한다 — 깃발 거점 근처에서 대비하라' },
  defend: { title:'방어 — 습격병을 전멸시켜라',
    text:`<p>습격병이 상륙했다. <b style="color:#f0d9a8">전부 처치</b>하면 습격을 격퇴하고 보상을 받는다.</p>
          <p>단, 네가 깃발 거점을 <b>비우면</b> 적이 그 자리에서 점령 게이지를 채워 <b style="color:#e0806a">섬을 빼앗는다.</b> 거점을 등지지 마라.</p>`,
    keys:[['LMB','공격 — 습격병 처치'],['W','A','S','D','거점을 지키며 이동']],
    foot:'습격병을 전멸시켜 거점을 지켜라' },
};

export function initRaidTuto(ctx){
  try { if(localStorage.getItem(LS_KEY)) { const noop=()=>{}; ctx.raidTuto={ close:noop }; return ctx.raidTuto; } } catch(_){}

  const ownedCount = () => (ctx.claimed ? ctx.claimed.filter(c=>c&&c.owner==='player').length : 0);

  // ── Pretendard(엘든 톤) 주입 ──
  if(!document.querySelector('link[href*="pretendard"]')){
    const f=document.createElement('link'); f.rel='stylesheet';
    f.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(f);
  }

  // ── CSS (gathertuto #gtuto 이식, id=#rtuto — 충돌 방지. 방어=붉은 톤 액센트) ──
  if(!document.getElementById('_raidtuto-css')){
    const css=document.createElement('style'); css.id='_raidtuto-css';
    css.textContent=`
      #rtuto{position:fixed;left:50%;top:60px;transform:translateX(-50%);z-index:60;width:min(700px,86vw);
        background:linear-gradient(180deg,rgba(20,14,14,.91),rgba(14,10,10,.87));
        border:1px solid rgba(196,120,96,.46);border-radius:6px;
        box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.5);
        color:#e9dfd2;pointer-events:none;overflow:hidden;font:13px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;
        opacity:0;transition:opacity .45s ease, transform .45s ease;}
      #rtuto.show{opacity:1;}
      #rtuto .x{position:absolute;top:9px;right:11px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
        color:#9a877d;font-size:15px;cursor:pointer;border-radius:5px;border:1px solid rgba(196,120,96,.24);
        background:rgba(0,0,0,.25);transition:color .15s,border-color .15s,background .15s;z-index:2;pointer-events:auto;}
      #rtuto .x:hover{color:#f0c0a8;border-color:rgba(196,120,96,.55);background:rgba(0,0,0,.45);}
      #rtuto .k.active{color:#1a0e0e;background:linear-gradient(180deg,#f5c0ab,#dc9a7c);border-color:#f5c0ab;
        box-shadow:0 0 11px rgba(245,171,150,.65);transform:translateY(1px);}
      #rtuto .keys .row{transition:opacity .42s ease, max-height .42s ease, margin .42s ease, transform .42s ease;
        overflow:hidden;max-height:44px;}
      #rtuto .keys .row.done{opacity:0;max-height:0;margin:0;transform:translateX(8px);}
      #rtuto .ti{text-align:center;font-size:19px;font-weight:600;letter-spacing:.04em;color:#f0c9a8;padding:15px 20px 13px;position:relative;}
      #rtuto .ti::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;background:linear-gradient(90deg,transparent,rgba(196,120,96,.5),transparent);}
      #rtuto .bd{padding:18px 26px 8px;}
      #rtuto .tx{font-size:14.5px;line-height:1.85;color:#d8cabf;}
      #rtuto .tx p{margin:0 0 10px;}
      #rtuto .keys{padding:4px 26px 4px;font-size:14px;color:#cfbeb2;}
      #rtuto .keys .row{display:flex;align-items:center;gap:9px;margin:7px 0;}
      #rtuto .k{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;
        background:linear-gradient(180deg,#362c2c,#201919);border:1px solid #5a4741;border-bottom-width:2px;border-radius:5px;
        color:#f0d6cf;font:700 13px/1 ui-monospace,Consolas,monospace;box-shadow:0 1px 0 rgba(0,0,0,.5);}
      #rtuto .ft{text-align:center;font-size:12.5px;color:#9a877d;letter-spacing:.03em;padding:11px 20px 14px;margin-top:6px;position:relative;}
      #rtuto .ft::before{content:"";position:absolute;left:8%;right:8%;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(196,120,96,.34),transparent);}
      #rtuto .ft.win{color:#7af0a0;}
      #rtuto .ft.lose{color:#f0806a;}
    `;
    document.head.appendChild(css);
  }

  // ── DOM ──
  const el=document.createElement('div'); el.id='rtuto';
  el.innerHTML=`
    <div class="x" title="닫기">✕</div>
    <div class="ti"></div>
    <div class="bd"><div class="tx"></div></div>
    <div class="keys"></div>
    <div class="ft"></div>`;
  document.body.appendChild(el);
  const $ti=el.querySelector('.ti'), $tx=el.querySelector('.tx'), $keys=el.querySelector('.keys'), $ft=el.querySelector('.ft'), $x=el.querySelector('.x');

  let started=false, done=false, phase=null, hidden=false, ownedAtStart=0;
  // 🎯 중앙 팝업 단일 슬롯(tutoslot.js) 경유 — raid=우선순위 3(위협). 채집(1)을 선점.
  const _slotShow = () => { if(ctx.tutoSlot) ctx.tutoSlot.show('raid', 3, el); else el.classList.add('show'); };
  const _slotHide = () => { if(ctx.tutoSlot) ctx.tutoSlot.hide('raid', el); else el.classList.remove('show'); };
  function open(){ hidden=false; _slotShow(); }
  function close(){ hidden=true; _slotHide(); }
  $x.addEventListener('click', close);

  // ── 키칩 글로우(누르는 동안 붉은 하이라이트) — Digit/문자키/LMB 모두 지원 ──
  const _chipKey=e=>{ if(!e.code) return null;
    if(e.code.startsWith('Digit')) return e.code.slice(5);   // Digit2→'2'
    if(e.code.startsWith('Key')) return e.code.slice(3);     // KeyW→'W'
    return null; };
  const _glow=(sel,on)=>$keys.querySelectorAll(sel).forEach(c=>c.classList.toggle('active',on));
  window.addEventListener('keydown', e=>{ const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', true); });
  window.addEventListener('keyup',   e=>{ const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', false); });
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
      return `<div class="row">${ks}<span style="color:#b8a89a">${r[r.length-1]}</span></div>`;
    }).join('');
    $ft.className='ft'; $ft.innerHTML=`${s.foot} <span style="opacity:.5">·</span> <span style="opacity:.7">[X] 닫기</span>`;   // ❎ X 닫기 안내
    if(!hidden) _slotShow();
  }
  function goPhase(step){ if(done) return; phase=step; hidden=false; render(step); try{window.__rtutoPhase=step;}catch(_){}}
  function fadeRows(){ $keys.querySelectorAll('.row').forEach(r=>{ if(!r.dataset.done){ r.dataset.done='1'; r.classList.add('done'); } }); }

  // ── 결과(격퇴/상실) 안내 후 닫고 완료 기록 ──
  function finishResult(){
    if(done) return; done=true;
    const won = ownedCount() >= ownedAtStart;   // 소유 섬 유지=격퇴 / 감소=상실
    phase='result'; hidden=false;
    $ti.textContent = won ? '격퇴 — 섬을 지켰다' : '거점 상실 — 다음엔 지켜라';
    $tx.innerHTML = won
      ? `<p>습격병을 전멸시켜 습격을 <b style="color:#7af0a0">격퇴</b>했다. 격퇴 보상이 지급된다.</p>
         <p>섬을 점령할수록 습격은 더 잦아진다. 자리를 비울 섬엔 <b style="color:#f0d9a8">수비대(그롬 주둔)</b>를 배치해 자동 방어시키고, 방어타워·대포로 거점을 요새화하라.</p>`
      : `<p>거점을 비운 사이 적이 점령 게이지를 채워 <b style="color:#f0806a">섬을 빼앗겼다.</b></p>
         <p>다음엔 습격이 끝날 때까지 깃발 거점 근처를 지켜라. 되찾으려면 다시 상륙해 점령하라.</p>`;
    $keys.innerHTML='';
    $ft.className='ft '+(won?'win':'lose'); $ft.textContent = won ? '방어 성공' : '거점을 되찾아라';
    hidden=false; _slotShow();
    setTimeout(()=>{ hidden=true; _slotHide(); try{localStorage.setItem(LS_KEY,'1');}catch(_){} }, 5200);
    try{ window.__rtutoPhase='result'; }catch(_){}
  }

  // ── 상태 폴링: 첫 습격 감지 → 예고/상륙/종료 자동전환 ──
  let _wasActive=false;
  ctx.onUpdate(()=>{
    if(done) return;
    const st = (ctx.raid && ctx.raid.status) ? ctx.raid.status() : null;
    const act = st && st.active;
    if(!started){
      if(act){ started=true; ownedAtStart=ownedCount(); _wasActive=true; goPhase(act.phase==='active'?'defend':'warn'); }
      return;
    }
    if(act){
      _wasActive=true;
      if(act.phase==='active' && phase==='warn'){ fadeRows(); setTimeout(()=>{ if(!done && phase==='warn') goPhase('defend'); }, 500); }
    } else if(_wasActive){
      finishResult();   // 습격 종료(active→null) = 격퇴 또는 상실
    }
  });

  ctx.raidTuto={ close,
    // 디버그/검증: 강제로 각 단계 표시
    _show(step){ if(step==='result'){ finishResult(); return; } started=true; ownedAtStart=ownedCount(); goPhase(step||'warn'); } };
  window.__raidTuto={ close, show:(s)=>ctx.raidTuto._show(s), reset:()=>{ try{localStorage.removeItem(LS_KEY);}catch(_){} location.reload(); } };
  console.log('[raidtuto] 방어 튜토 등록 — 첫 습격 시 자동(ctx.raid.status 폴링). window.__raidTuto.show("warn"|"defend"|"result")로 미리보기.');
  return ctx.raidTuto;
}
