// combattuto.js — 전투 튜토리얼. 첫 전투(첫 몬스터 aggro) 시 엘든링식 팝업으로 전투 조작 안내.
//   구조 = tutorial.html 항해 튜토 이식(#tuto DOM/CSS + TUTO_STEPS + showTuto + 키칩 피드백 + X토글 + _tutoDone 영구닫힘).
//   발동 = monsters.js mn.aggro 최초 true(첫 전투). 저장 = localStorage['mas_combat_tuto_done'] → 최초 1회만.
//   단계: ①공격(좌클릭) → ②회피(더블탭 WASD, 무적) → ③직업 핵심(기사=가드 / 그외=우클릭 스킬 + 스킬바)
//        → ④그로기 게이지(계속 공격) → ⑤E 난타 처형. ★E4(2026-07-15) 그로기/처형 안내 추가.
//   game.html에서 initCombat/initMonsters 뒤에 initCombatTuto(ctx) 호출.

const LS_KEY = 'mas_combat_tuto_done';

// 단계별 튜토 내용 (엘든링식: 제목 + 설명문단 + 키안내 + 우측 이미지 + 하단 안내)
//   keys 각 행: [칩..., 라벨] — 마지막 원소가 설명, 앞이 키칩. 마우스는 'LMB'/'RMB'.
const TUTO_STEPS = {
  attack: { title:'전투 — 무기를 들어라',
    text:`<p>적이 다가온다. <b style="color:#f0d9a8">좌클릭</b>으로 공격하라.</p><p>정면 부채꼴 안의 적을 벤다. 무기마다 사거리와 위력이 다르니 거리를 재며 휘둘러라.</p>`,
    keys:[['LMB','근접 공격 / 마법탄']],
    img:'/ui/tuto_atk.png', foot:'좌클릭으로 적을 공격하라' },
  dodge: { title:'구르기로 피하라',
    text:`<p>적의 공격엔 <b>예비동작</b>이 있다. 그 틈에 굴러 피하라.</p><p>이동키를 <b style="color:#f0d9a8">두 번 빠르게</b> 누르면 그 방향으로 구르며 잠깐 <b style="color:#f0d9a8">무적</b>이 된다.</p>`,
    keys:[['W','A','S','D','두 번 탭 = 회피 구르기(무적)']],
    img:'/ui/tuto_dodge.png', foot:'WASD 더블탭으로 굴러 회피하라' },
  // skill 단계는 initCombatTuto 안에서 ?char= 직업에 맞춰 런타임 조립(아래 buildSkillStep)
  skill: null,
  // ★E4(2026-07-15) ④그로기 게이지 안내 — 계속 공격하면 체력바 밑 보라 게이지가 차오르고 가득 차면 그로기(무력화+머리 위 별).
  groggy: { title:'그로기 게이지를 채워라',
    text:`<p>적을 계속 공격하면 체력바 아래 <b style="color:#b98cf0">보라 게이지</b>가 차오릅니다.</p><p>게이지가 가득 차면 적이 <b style="color:#f0d9a8">그로기</b> 상태가 되어 무력화되고, 머리 위에 별이 뜹니다.</p>`,
    keys:[['LMB','계속 공격해 그로기 게이지를 채우세요']],
    img:'', foot:'적을 계속 공격해 그로기 게이지를 채우세요' },
  // ★E4(2026-07-15) ⑤그로기 처형 안내 — 그로기 상태에서 E를 누르면 초고속 난타 처형(원거리는 화살비/아케인 처형).
  execute: { title:'그로기 처형!',
    text:`<p>적이 그로기 상태일 때 <b style="color:#f0d9a8">E</b>를 누르면 몰아쳐 초고속 난타로 처형합니다.</p><p>원거리 직업은 가까이 가지 않아도 멀리서 화살비/마법으로 처형할 수 있습니다.</p>`,
    keys:[['E','그로기 상태의 적을 난타로 처형하세요']],
    img:'', foot:'그로기 상태에서 E를 눌러 처형하세요' },
};

export function initCombatTuto(ctx){
  // ── 최초 1회: 이미 본 적 있으면 스킵 ──
  try { if(localStorage.getItem(LS_KEY)) return; } catch(_){}

  // ── Pretendard 폰트(엘든 톤) — game.html head엔 없음 → 주입 ──
  if(!document.querySelector('link[href*="pretendard"]')){
    const f=document.createElement('link'); f.rel='stylesheet';
    f.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(f);
  }

  // ── CSS 주입 (tutorial.html #tuto 이식) ──
  if(!document.getElementById('_combattuto-css')){
    const css=document.createElement('style'); css.id='_combattuto-css';
    css.textContent=`
      /* ── 엘든링식 튜토리얼 팝업: 상단 중앙, 크게 ── */
      #tuto{position:fixed;left:50%;top:46px;transform:translateX(-50%);z-index:60;width:min(720px,86vw);
        background:linear-gradient(180deg,rgba(14,16,20,.90),rgba(10,12,16,.86));
        border:1px solid rgba(176,148,96,.42);border-radius:6px;
        box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.5);
        color:#e9e2d2;pointer-events:none;overflow:hidden;font:13px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;
        opacity:0;transition:opacity .45s ease, transform .45s ease;}
      #tuto.show{opacity:1;}
      #tuto .x{position:absolute;top:9px;right:11px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
        color:#9a917d;font-size:15px;cursor:pointer;border-radius:5px;border:1px solid rgba(176,148,96,.22);
        background:rgba(0,0,0,.25);transition:color .15s,border-color .15s,background .15s;z-index:2;pointer-events:auto;}
      #tuto .x:hover{color:#f0d9a8;border-color:rgba(176,148,96,.55);background:rgba(0,0,0,.45);}
      #tuto .k.active{color:#1a160e;background:linear-gradient(180deg,#f5e0ab,#dcbb7c);border-color:#f5e0ab;
        box-shadow:0 0 11px rgba(245,224,171,.65);transform:translateY(1px);}
      #tuto .keys .row{transition:opacity .42s ease, max-height .42s ease, margin .42s ease, transform .42s ease;
        overflow:hidden;max-height:44px;}
      #tuto .keys .row.done{opacity:0;max-height:0;margin:0;transform:translateX(8px);}
      #tuto .ti{text-align:center;font-size:19px;font-weight:600;letter-spacing:.04em;color:#f0d9a8;
        padding:15px 20px 13px;position:relative;}
      #tuto .ti::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;
        background:linear-gradient(90deg,transparent,rgba(176,148,96,.5),transparent);}
      #tuto .bd{display:flex;gap:20px;padding:18px 26px 8px;align-items:stretch;}
      #tuto .tx{flex:1;font-size:14.5px;line-height:1.85;color:#d8d0bf;}
      #tuto .tx p{margin:0 0 10px;}
      #tuto .img{width:40%;min-height:150px;border-radius:4px;background:#0a0d11 center/cover no-repeat;
        border:1px solid rgba(176,148,96,.28);box-shadow:inset 0 0 30px rgba(0,0,0,.6);}
      #tuto.noimg .img{display:none;}
      #tuto.noimg .tx{flex:1;}
      #tuto .keys{padding:4px 26px 4px;font-size:14px;color:#cfc6b2;}
      #tuto .keys .row{display:flex;align-items:center;gap:9px;margin:7px 0;}
      #tuto .k{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;
        background:linear-gradient(180deg,#2c3036,#191c20);border:1px solid #5a5141;border-bottom-width:2px;border-radius:5px;
        color:#f0e6cf;font:700 13px/1 ui-monospace,Consolas,monospace;box-shadow:0 1px 0 rgba(0,0,0,.5);}
      #tuto .ft{text-align:center;font-size:12.5px;color:#9a917d;letter-spacing:.03em;
        padding:11px 20px 14px;margin-top:6px;position:relative;}
      #tuto .ft::before{content:"";position:absolute;left:8%;right:8%;top:0;height:1px;
        background:linear-gradient(90deg,transparent,rgba(176,148,96,.34),transparent);}
    `;
    document.head.appendChild(css);
  }

  // ── 팝업 DOM 생성 ──
  const tuto=document.createElement('div'); tuto.id='tuto';
  tuto.innerHTML=`
    <div class="x" title="닫기 (X)">✕</div>
    <div class="ti">전투 — 무기를 들어라</div>
    <div class="bd">
      <div class="tx"></div>
      <div class="img"></div>
    </div>
    <div class="keys"></div>
    <div class="ft"></div>`;
  document.body.appendChild(tuto);
  const tutoTi=tuto.querySelector('.ti'), tutoTx=tuto.querySelector('.tx'),
        tutoKeys=tuto.querySelector('.keys'), tutoImg=tuto.querySelector('.img'),
        tutoFt=tuto.querySelector('.ft'), tutoX=tuto.querySelector('.x');

  // ── 직업별 ③ 스킬/가드 단계 조립 ──
  const _cls=(new URLSearchParams(location.search).get('char')||'').toLowerCase();
  TUTO_STEPS.skill = buildSkillStep(_cls);

  // ── 열기/닫기 토글 (✕클릭 또는 X키) ──
  let _tutoHidden=false, _tutoDone=false;   // _tutoDone = 전 단계 완료 → 영구닫힘 + localStorage 기록
  // 🎯 중앙 팝업 단일 슬롯(tutoslot.js) 경유 — combat=우선순위 3(위협). 채집(1)을 선점 → 전투 끝나면 채집 복귀.
  const _slotShow = () => { if(ctx.tutoSlot) ctx.tutoSlot.show('combat', 3, tuto); else tuto.classList.add('show'); };
  const _slotHide = () => { if(ctx.tutoSlot) ctx.tutoSlot.hide('combat', tuto); else tuto.classList.remove('show'); };
  function closeTuto(){ _tutoHidden=true; _slotHide(); }
  function openTuto(){ _tutoHidden=false; _slotShow(); }
  function toggleTuto(){ _tutoHidden ? openTuto() : closeTuto(); }
  function markDone(){ _tutoDone=true; closeTuto(); try{ localStorage.setItem(LS_KEY,'1'); }catch(_){}}
  tutoX.addEventListener('click', closeTuto);

  // ── 키칩 글로우 피드백: 누르는 동안 칩 금빛(active). 행 페이드/단계전환은 '실제 액션' 감지가 구동(아래). ──
  //   tutorial.html은 keyup=행 done이었으나, 회피는 '더블탭'이 조건 → 단일 키 누름으로 잘못 넘어가지 않게 액션 감지로 분리.
  const _chipKey=e=>(e.code && e.code.startsWith('Key')) ? e.code.slice(3) : null;   // 'KeyQ'→'Q'
  const _glow=(sel,on)=>tutoKeys.querySelectorAll(sel).forEach(c=>c.classList.toggle('active',on));
  window.addEventListener('keydown', e=>{
    if(e.code==='KeyX'){ if(e.repeat) return; toggleTuto(); return; }
    const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', true);
  });
  window.addEventListener('keyup', e=>{ const k=_chipKey(e); if(k) _glow('.k[data-k="'+k+'"]', false); });
  window.addEventListener('mousedown', e=>{ const mk=e.button===0?'LMB':e.button===2?'RMB':null; if(mk) _glow('.k[data-k="'+mk+'"]', true); }, true);
  window.addEventListener('mouseup',   e=>{ const mk=e.button===0?'LMB':e.button===2?'RMB':null; if(mk) _glow('.k[data-k="'+mk+'"]', false); }, true);

  // ── 단계 렌더 ──
  function showTuto(step){
    if(_tutoDone) return;
    const s=TUTO_STEPS[step]; if(!s) return;
    tutoTi.textContent=s.title;
    tutoTx.innerHTML=s.text;
    tutoKeys.innerHTML=s.keys.map(r=>{
      const keys=r.slice(0,-1);
      const ks=keys.map(k=>`<span class="k" data-k="${k}">${chipLabel(k)}</span>`).join(' ');
      return `<div class="row" data-keys="${keys.join('')}">${ks}<span style="color:#b8af9a">${r[r.length-1]}</span></div>`;
    }).join('');
    tuto.classList.toggle('noimg', !s.img);
    if(s.img) tutoImg.style.backgroundImage=`url('${s.img}')`;
    tutoFt.innerHTML=`${s.foot} <span style="opacity:.5">·</span> <span style="opacity:.7">[X] 닫기</span>`;
    if(!_tutoHidden) _slotShow();
  }
  window.showCombatTuto=showTuto;   // 디버그/검증 훅

  // ── 단계 전환: 현재 단계의 '실제 조작'을 하면 행을 페이드하고 다음 단계로(사령관 "행동하면 자동 다음 단계") ──
  //   단계 순서: attack → dodge → skill → groggy → execute → 완료. 닫아뒀어도 다음 행동 시 자동으로 다음 안내를 띄움(goPhase가 재오픈).
  //   ★E4(2026-07-15) groggy=false → goPhase(step)에서 리셋. onUpdate 폴링이 실제 몬스터 groggyUntil을 감지해 1회만 advance.
  let _phase=null, _groggyCaught=false;
  function goPhase(step){ if(_tutoDone) return; _phase=step; _tutoHidden=false; if(step==='groggy') _groggyCaught=false; showTuto(step); try{window.__ctutoPhase=step;}catch(_){}}
  function fadeRows(){ tutoKeys.querySelectorAll('.row').forEach(r=>{ if(!r.dataset.done){ r.dataset.done='1'; r.classList.add('done'); } }); }
  function advance(next){ if(_tutoDone) return; fadeRows(); setTimeout(()=>{ if(!_tutoDone) goPhase(next); }, 720); }   // 배운 조작 사라지는 연출 후 다음
  function completeAll(){ if(_tutoDone) return; fadeRows(); setTimeout(()=>markDone(), 720); }   // 마지막(그로기 처형) 조작 = 튜토 1세트 완료 → 영구닫힘+localStorage

  // 액션 감지 — ①공격=좌클릭 / ③직업=우클릭(가드·강스킬 공통) / ②회피=WASD 더블탭(실제 구르기) / ⑤처형=E키(실제 그로기 난타 입력)
  window.addEventListener('mousedown', e=>{
    if(_tutoDone) return;
    if(e.button===0 && _phase==='attack') advance('dodge');
    else if(e.button===2 && _phase==='skill') advance('groggy');
  }, true);
  const _lastTap={}; const DTAP=320;   // 더블탭 판정창(player.js doDodge와 동일 계열)
  window.addEventListener('keydown', e=>{
    if(_tutoDone || e.repeat) return;
    const c=e.code;
    if(_phase==='dodge'){
      if(c==='KeyW'||c==='KeyA'||c==='KeyS'||c==='KeyD'){
        const now=performance.now(), last=_lastTap[c]||0;
        if(now-last < DTAP){ advance('skill'); }   // 같은 방향 두 번 빠르게 = 회피 구르기
        _lastTap[c]=now;
      }
    } else if(_phase==='execute' && c==='KeyE'){
      completeAll();   // ★E4: 그로기 상태에서 실제 E 난타 입력(player.js mashTap과 동일 키) = 처형 단계 완료
    }
  });

  // ★E4(2026-07-15) ④그로기 단계 완료 감지 — ctx.monsters를 폴링해 실제로 groggyUntil이 활성화된 몹이 있으면 다음 단계로.
  //   (attack 발동 시 ctx.monsters를 폴링하는 아래 onUpdate와 동일 패턴 — 새 판정 API 발명하지 않고 groggyUntil 필드 재사용)
  ctx.onUpdate(()=>{
    if(_tutoDone || _phase!=='groggy' || _groggyCaught) return;
    const ms=ctx.monsters; if(!ms || !ms.length) return;
    for(const m of ms){ if(m && m.groggyUntil && performance.now()<m.groggyUntil){ _groggyCaught=true; advance('execute'); break; } }
  });

  // ── 발동: 첫 몬스터 aggro 감시 → ①공격 단계 시작 ──
  let _started=false;
  ctx.onUpdate(()=>{
    if(_started) return;
    const ms=ctx.monsters; if(!ms || !ms.length) return;
    for(const m of ms){ if(m && m.aggro && !m.dead){ _started=true; goPhase('attack'); break; } }
  });

  return { showTuto, goPhase, markDone, close:closeTuto };
}

// 키칩 표시 라벨(마우스는 아이콘성 텍스트)
function chipLabel(k){
  if(k==='LMB') return '좌클릭';
  if(k==='RMB') return '우클릭';
  return k;
}

// 직업별 ③ 단계 — 기사=가드 / 마법사·레인저·로그=우클릭 스킬 / 전사=강공 스킬바
function buildSkillStep(cls){
  if(cls==='knight'){
    return { title:'방패로 막아라',
      text:`<p>기사의 힘은 <b style="color:#f0d9a8">방패</b>에 있다. <b>우클릭</b>을 눌러 막으면 적의 공격을 흘려낸다.</p><p>막을수록 방패 게이지가 차오르고, 가득 차면 <b style="color:#f0d9a8">Q</b>로 충격파를 터뜨려 반격한다.</p>`,
      keys:[['RMB','방패로 막기(가드)'],['Q','충격파 반격(게이지 충전 시)']],
      img:'/ui/tuto_guard.png', foot:'우클릭으로 막고, 게이지가 차면 Q로 반격하라' };
  }
  if(cls==='mage'){
    return { title:'마법을 시전하라',
      text:`<p>마법사의 힘은 속성에 있다. <b>우클릭</b>으로 강력한 마법 스킬을 시전한다.</p><p><b style="color:#f0d9a8">Q</b>로 속성을 전환하고, 우측 <b>스킬바</b>에서 남은 스킬과 쿨다운을 확인하라.</p>`,
      keys:[['RMB','강 마법 스킬'],['Q','속성 전환']],
      img:'', foot:'우클릭으로 강 마법을 쏘고 Q로 속성을 바꿔라' };
  }
  if(cls==='ranger'||cls==='rogue'){
    return { title:'직업 스킬을 써라',
      text:`<p>거리를 두고 싸워라. <b>우클릭</b>으로 조준·직업 스킬을 발동한다.</p><p>우측 <b style="color:#f0d9a8">스킬바</b>에서 사용 가능한 스킬과 쿨다운을 확인하며 싸워라.</p>`,
      keys:[['RMB','조준 / 직업 스킬']],
      img:'', foot:'우클릭으로 직업 스킬을 발동하라 (우측 스킬바 참고)' };
  }
  // 전사 등 기본
  return { title:'직업 스킬을 써라',
    text:`<p>우측 <b style="color:#f0d9a8">스킬바</b>에 직업 스킬이 있다. <b>우클릭</b>으로 강공/스킬을 발동해 적을 제압하라.</p><p>스킬엔 쿨다운이 있으니 스킬바를 보며 타이밍을 재라.</p>`,
    keys:[['RMB','강공 / 직업 스킬']],
    img:'', foot:'우클릭 강공으로 적을 제압하라 (우측 스킬바 참고)' };
}
