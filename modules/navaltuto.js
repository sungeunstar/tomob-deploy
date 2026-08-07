// navaltuto.js — 해전/항해 튜토리얼. 첫 배 탑승(조타 스테이션 점유) 시 엘든링식 팝업으로 항해·포격 조작 안내.
//   구조 = combattuto.js 패턴 이식(#ntuto DOM/CSS + 단계 게이팅 + 실제 액션 감지 자동전환 + X토글 + localStorage 1회).
//   발동 = 첫 갑판 승선(ctx.player._onShip===ctx.ship, 아직 비조타). 저장 = localStorage['mas_naval_tuto_done'] → 최초 1회만.
//   단계: ①조타 진입([Z]=키 잡기→boarded) → ②방향타([A]/[D]) → ③좌현 포격 시점([Q]=카메라 좌현 회전→좌클릭 발사)
//         → ④우현 포격 시점([E]) → ⑤전력항해([Shift]).
//     ★사령관 확정(2026-07-14): 순서 재구성 Z→A/D→Q→E→Shift. 돛 펴기/접기(W/S)는 안내 제외.
//     ★사령관 확정(2026-07-13): Q/E는 발사키가 아니라 '카메라 시점 전환' 키. 발사는 좌클릭. 튜토가 이걸 명확히 안내.
//   game.html에서 initSeaevents/initCrew 뒤에 initNavalTuto(ctx) 호출.

const LS_KEY = 'mas_naval_tuto_done';

// 단계별 튜토 내용 (엘든링식: 제목 + 설명문단 + 키안내 + 하단 안내). keys 각 행: [칩..., 라벨].
const TUTO_STEPS = {
  helm: { title:'조타 — 키를 잡아라',
    text:`<p>갑판 위에서 조타륜 앞으로 다가가 <b style="color:#f0d9a8">Z</b>를 누르면 <b>키를 잡고</b> 배를 직접 몬다.</p><p>조타 중 다시 <b style="color:#f0d9a8">Z</b>를 누르면 갑판 보행으로 돌아온다. 우선 조타륜 앞에서 Z로 키를 잡아라.</p>`,
    keys:[['Z','조타 스테이션 진입']],
    foot:'조타륜 앞에서 [Z]로 키 잡기' },
  steer: { title:'방향타 — 뱃머리를 돌려라',
    text:`<p>조타 중 <b style="color:#f0d9a8">A</b>·<b style="color:#f0d9a8">D</b>로 방향타를 꺾어 뱃머리를 <b>좌우로</b> 돌린다.</p><p>원하는 침로로 배를 몰아라. 급선회는 속도를 잃으니 완만하게 감아라.</p>`,
    keys:[['A','좌현타 — 왼쪽으로'],['D','우현타 — 오른쪽으로']],
    foot:'A·D로 뱃머리를 좌우로' },
  portview: { title:'좌현 포격 — 왼쪽 대포',
    text:`<p>조타 중 <b style="color:#f0d9a8">Q</b>를 누르면 카메라가 <b>좌현(왼쪽) 대포</b> 방향으로 돌아간다.</p><p>시점이 돌아가면 조준선이 나타난다. <b>마우스</b>로 겨누고 <b style="color:#f0d9a8">좌클릭</b>으로 일제사격하라.</p>`,
    keys:[['Q','좌현 대포 시점 전환'],['LMB','발사']],
    foot:'Q로 좌현을 보고 좌클릭으로 발사' },
  starboardview: { title:'우현 포격 — 오른쪽 대포',
    text:`<p><b style="color:#f0d9a8">E</b>는 <b>우현(오른쪽) 대포</b> 시점이다. Q·E로 좌우 현측을 번갈아 겨눈다.</p><p>조준 중 <b>마우스 좌우</b>는 미세조준, <b>마우스 상하</b>는 탄착 거리(사거리)를 조절한다. <b style="color:#f0d9a8">좌클릭</b> 발사.</p>`,
    keys:[['E','우현 대포 시점 전환'],['LMB','발사']],
    foot:'E로 우현을 보고 좌클릭으로 발사' },
  boost: { title:'전력 항해 — 속도를 내라',
    text:`<p>돛을 펴고 <b style="color:#f0d9a8">Shift</b>를 누르면 배가 <b>전속력</b>으로 질주한다.</p><p>급하게 적을 따돌리거나 따라잡을 때 쓴다. 전력 항해는 스태미나를 소모하니 게이지를 보며 아껴 써라.</p>`,
    keys:[['Shift','전력 항해 — 전속력 전진']],
    foot:'[Shift]로 전속력 전진' },
};

export function initNavalTuto(ctx){
  // ── 최초 1회: 이미 본 적 있으면 스킵 ──
  try { if(localStorage.getItem(LS_KEY)) return; } catch(_){}

  // ── Pretendard(엘든 톤) — game.html head엔 없음 → 주입(combattuto와 중복 무해) ──
  if(!document.querySelector('link[href*="pretendard"]')){
    const f=document.createElement('link'); f.rel='stylesheet';
    f.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(f);
  }

  // ── CSS 주입 (combattuto #tuto 이식 — id만 #ntuto로 분리해 동시 존재 가능) ──
  if(!document.getElementById('_navaltuto-css')){
    const css=document.createElement('style'); css.id='_navaltuto-css';
    css.textContent=`
      #ntuto{position:fixed;left:50%;top:46px;transform:translateX(-50%);z-index:60;width:min(720px,86vw);
        background:linear-gradient(180deg,rgba(14,16,20,.90),rgba(10,12,16,.86));
        border:1px solid rgba(120,180,255,.42);border-radius:6px;
        box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.5);
        color:#e9e2d2;pointer-events:none;overflow:hidden;font:13px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;
        opacity:0;transition:opacity .45s ease, transform .45s ease;}
      #ntuto.show{opacity:1;}
      #ntuto .x{position:absolute;top:9px;right:11px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
        color:#9a917d;font-size:15px;cursor:pointer;border-radius:5px;border:1px solid rgba(120,180,255,.22);
        background:rgba(0,0,0,.25);transition:color .15s,border-color .15s,background .15s;z-index:2;pointer-events:auto;}
      #ntuto .x:hover{color:#bfe0ff;border-color:rgba(120,180,255,.55);background:rgba(0,0,0,.45);}
      #ntuto .k.active{color:#0e1420;background:linear-gradient(180deg,#bfe0ff,#7fb0ee);border-color:#bfe0ff;
        box-shadow:0 0 11px rgba(140,200,255,.65);transform:translateY(1px);}
      #ntuto .keys .row{transition:opacity .42s ease, max-height .42s ease, margin .42s ease, transform .42s ease;
        overflow:hidden;max-height:44px;}
      #ntuto .keys .row.done{opacity:0;max-height:0;margin:0;transform:translateX(8px);}
      #ntuto .ti{text-align:center;font-size:19px;font-weight:600;letter-spacing:.04em;color:#bfe0ff;
        padding:15px 20px 13px;position:relative;}
      #ntuto .ti::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;
        background:linear-gradient(90deg,transparent,rgba(120,180,255,.5),transparent);}
      #ntuto .bd{display:flex;gap:20px;padding:18px 26px 8px;align-items:stretch;}
      #ntuto .tx{flex:1;font-size:14.5px;line-height:1.85;color:#d8d0bf;}
      #ntuto .tx p{margin:0 0 10px;}
      #ntuto .keys{padding:4px 26px 4px;font-size:14px;color:#cfc6b2;}
      #ntuto .keys .row{display:flex;align-items:center;gap:9px;margin:7px 0;}
      #ntuto .k{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;
        background:linear-gradient(180deg,#2c3036,#191c20);border:1px solid #46556e;border-bottom-width:2px;border-radius:5px;
        color:#e6eefc;font:700 13px/1 ui-monospace,Consolas,monospace;box-shadow:0 1px 0 rgba(0,0,0,.5);}
      #ntuto .ft{text-align:center;font-size:12.5px;color:#9a917d;letter-spacing:.03em;
        padding:11px 20px 14px;margin-top:6px;position:relative;}
      #ntuto .ft::before{content:"";position:absolute;left:8%;right:8%;top:0;height:1px;
        background:linear-gradient(90deg,transparent,rgba(120,180,255,.34),transparent);}
    `;
    document.head.appendChild(css);
  }

  // ── 팝업 DOM ──
  const tuto=document.createElement('div'); tuto.id='ntuto';
  tuto.innerHTML=`
    <div class="x" title="닫기 (X)">✕</div>
    <div class="ti"></div>
    <div class="bd"><div class="tx"></div></div>
    <div class="keys"></div>
    <div class="ft"></div>`;
  document.body.appendChild(tuto);
  const tutoTi=tuto.querySelector('.ti'), tutoTx=tuto.querySelector('.tx'),
        tutoKeys=tuto.querySelector('.keys'), tutoFt=tuto.querySelector('.ft'), tutoX=tuto.querySelector('.x');

  // ── 열기/닫기 (tutoslot 단일 슬롯 경유 — naval=우선순위 3(위협)) ──
  let _tutoHidden=false, _tutoDone=false;
  const _slotShow = () => { if(window.__noTuto) return; if(ctx.tutoSlot) ctx.tutoSlot.show('naval', 3, tuto); else tuto.classList.add('show'); };
  const _slotHide = () => { if(ctx.tutoSlot) ctx.tutoSlot.hide('naval', tuto); else tuto.classList.remove('show'); };
  function closeTuto(){ _tutoHidden=true; _slotHide(); }
  function openTuto(){ _tutoHidden=false; _slotShow(); }
  function toggleTuto(){ _tutoHidden ? openTuto() : closeTuto(); }
  function markDone(){ _tutoDone=true; closeTuto(); try{ localStorage.setItem(LS_KEY,'1'); }catch(_){}}
  tutoX.addEventListener('click', markDone);   // ★X로 닫으면 영구 완료(사령관 "전투튜토 또 나옴") — 다음 세션 재출현 방지

  // ── 키칩 글로우 피드백 ──
  const _chipKey=e=>{ if(e.code==='ShiftLeft'||e.code==='ShiftRight') return 'Shift'; return (e.code && e.code.startsWith('Key')) ? e.code.slice(3) : null; };
  const _glow=(sel,on)=>tutoKeys.querySelectorAll(sel).forEach(c=>c.classList.toggle('active',on));
  window.addEventListener('keydown', e=>{
    if(e.code==='KeyX'){ if(e.repeat) return; if(!_tutoDone) toggleTuto(); return; }
    const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', true);
  });
  window.addEventListener('keyup', e=>{ const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', false); });
  window.addEventListener('mousedown', e=>{ if(e.button===0) _glow('.k[data-k="LMB"]', true); }, true);
  window.addEventListener('mouseup',   e=>{ if(e.button===0) _glow('.k[data-k="LMB"]', false); }, true);

  // ── 단계 렌더 ──
  function showTuto(step){
    if(_tutoDone) return;
    const s=TUTO_STEPS[step]; if(!s) return;
    tutoTi.textContent=s.title;
    tutoTx.innerHTML=s.text;
    tutoKeys.innerHTML=s.keys.map(r=>{
      const keys=r.slice(0,-1);
      const ks=keys.map(k=>`<span class="k" data-k="${k}">${chipLabel(k)}</span>`).join(' ');
      return `<div class="row">${ks}<span style="color:#b8af9a">${r[r.length-1]}</span></div>`;
    }).join('');
    tutoFt.innerHTML=`${s.foot} <span style="opacity:.5">·</span> <span style="opacity:.7">[X] 닫기</span>`;
    if(!_tutoHidden) _slotShow();
  }
  window.showNavalTuto=showTuto;   // 디버그/검증 훅

  // ── 단계 전환: 현재 단계의 '실제 조작' 감지 → 행 페이드 후 다음 단계 ──
  let _phase=null;
  function goPhase(step){ if(_tutoDone) return; _phase=step; _tutoHidden=false; showTuto(step); try{window.__ntutoPhase=step;}catch(_){}}
  function fadeRows(){ tutoKeys.querySelectorAll('.row').forEach(r=>{ if(!r.dataset.done){ r.dataset.done='1'; r.classList.add('done'); } }); }
  function advance(next){ if(_tutoDone) return; fadeRows(); setTimeout(()=>{ if(!_tutoDone) goPhase(next); }, 720); }
  function completeAll(){ if(_tutoDone) return; fadeRows(); setTimeout(()=>markDone(), 720); }

  // 액션 감지 — ②방향타=A/D / ③좌현시점=Q / ④우현시점=E / ⑤전력항해=Shift
  //   (①조타진입=Z는 키 자체가 아니라 boarded 상태 전환으로 감지 — 아래 onUpdate)
  window.addEventListener('keydown', e=>{
    if(_tutoDone || e.repeat) return;
    if((e.code==='KeyA'||e.code==='KeyD') && _phase==='steer' && ctx.ship && ctx.ship.boarded) advance('portview');
    else if(e.code==='KeyQ' && _phase==='portview') advance('starboardview');
    else if(e.code==='KeyE' && _phase==='starboardview') advance('boost');
    else if((e.code==='ShiftLeft'||e.code==='ShiftRight') && _phase==='boost') completeAll();
  });

  // ── 발동: 첫 갑판 승선(비조타) 감시 → ①조타 진입 단계 시작 ──
  //   오프닝 컷신(먼바다 caravel 전투→난파) 중엔 발동 금지 — 각성 후 실제 갑판 승선부터.
  //   ①→②: Z로 실제 조타를 잡아 boarded===true가 되면 방향타 단계로 전환(Z는 crew.js가 소비, 여기선 상태만 감지).
  let _started=false, _helmAdvanced=false;
  ctx.onUpdate(()=>{
    if(_tutoDone) return;
    if(ctx.opening && ctx.opening.active && ctx.opening.active()) return;   // 오프닝 중 스킵
    if(!_started){
      const onDeck = ctx.ship && ctx.player && ctx.player._onShip===ctx.ship;
      if(onDeck && !ctx.ship.boarded){ _started=true; goPhase('helm'); }               // 갑판 위(비조타) = 조타 진입 안내
      else if(ctx.ship && ctx.ship.boarded){ _started=true; _helmAdvanced=true; goPhase('steer'); } // 이미 조타 중이면 방향타부터
      return;
    }
    // ①→②: Z로 조타 잡음(boarded===true) → 방향타 단계. 매 프레임 재발동 방지 래치.
    if(!_helmAdvanced && _phase==='helm' && ctx.ship && ctx.ship.boarded){ _helmAdvanced=true; advance('steer'); }
  });

  console.log('[navaltuto] 해전/항해 튜토 등록 — 첫 갑판 승선 시 Z→A/D→Q→E→Shift 안내(최초 1회).');
  return { showTuto, goPhase, markDone, close:closeTuto };
}

// 키칩 표시 라벨(마우스는 아이콘성 텍스트)
function chipLabel(k){
  if(k==='LMB') return '좌클릭';
  if(k==='RMB') return '우클릭';
  return k;
}
