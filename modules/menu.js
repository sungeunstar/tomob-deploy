// menu.js — 인게임 메뉴(일시정지). ESC로 열고 닫음. 사령관: "메뉴바 여는 키 하나 + 근처 섬 돌아가기·캐릭터 선택 같은 거."
//   항목: 계속하기(닫기) / 근처 섬으로 돌아가기(가장 가까운 점령섬 또는 홈으로 텔레포트 — 바다에서 길 잃었을 때 복귀) / 캐릭터 선택(저장 후 로비).
//   ESC 충돌: 교역·건설창이 열려 있으면 그쪽 ESC가 먼저 닫게 양보(메뉴는 안 뜸). 그 외 ESC = 메뉴 토글.
//   콘센트: ctx.player(setSpawn/pos)·claimed·terrain·water·save 읽기/호출만. 이 파일만 수정.
import { toast as ukToast } from './uikit.js';

export function initMenu(ctx){
  let open=false;

  if(!document.getElementById('_gmenu-css')){
    const css=document.createElement('style'); css.id='_gmenu-css';
    css.textContent=`
      #gmenu{position:fixed;inset:0;z-index:120;display:none;align-items:center;justify-content:center;
        background:rgba(6,10,16,.55);backdrop-filter:blur(4px);
        font-family:'Pretendard',system-ui,'Malgun Gothic',sans-serif}
      #gmenu .gm-panel{width:min(340px,86vw);padding:26px 24px;border-radius:14px;
        background:linear-gradient(180deg,rgba(15,20,28,.97),rgba(9,13,20,.98));border:1px solid rgba(201,168,90,.5);
        box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center}
      #gmenu .gm-ti{font-size:19px;font-weight:800;letter-spacing:.1em;color:#f0d9a8;margin-bottom:4px}
      #gmenu .gm-sub{font-size:11.5px;letter-spacing:.14em;color:#8a836f;text-transform:uppercase;margin-bottom:18px}
      #gmenu .gm-btn{display:block;width:100%;margin:9px 0;padding:12px;border-radius:9px;cursor:pointer;
        font:700 15px 'Pretendard',system-ui;border:1px solid rgba(201,168,90,.35);
        background:linear-gradient(180deg,rgba(22,28,38,.92),rgba(12,17,26,.94));color:#e6dcc2;
        transition:filter .14s,border-color .14s}
      #gmenu .gm-btn:hover{filter:brightness(1.16);border-color:rgba(201,168,90,.7)}
      #gmenu .gm-resume{background:linear-gradient(180deg,#ecc962,#a9842f);color:#2a1d06;border-color:#e7c878}
      #gmenu .gm-hint{margin-top:14px;font-size:11.5px;color:#7c765f}
    `;
    document.head.appendChild(css);
  }

  const el=document.createElement('div'); el.id='gmenu';
  el.innerHTML=`<div class="gm-panel">
    <div class="gm-ti">메뉴</div><div class="gm-sub">Paused</div>
    <button class="gm-btn gm-resume" id="gm_resume">▸ 계속하기</button>
    <button class="gm-btn" id="gm_skiptuto" style="display:none">튜토리얼 건너뛰기</button>
    <button class="gm-btn" id="gm_recall">근처 섬으로 돌아가기</button>
    <button class="gm-btn" id="gm_chars">캐릭터 선택</button>
    <div class="gm-hint">ESC — 메뉴 열기 / 닫기</div>
  </div>`;
  document.body.appendChild(el);
  // 오프닝 또는 원정 온보딩 v3가 진행 중일 때 노출한다.
  const _openingActive = ()=> !!(ctx.opening && ctx.opening.active && ctx.opening.active());
  const _onboardingActive = ()=> !!(ctx.onboarding && ctx.onboarding.state && !ctx.onboarding.state().completed);
  const toast=(t,acc='gold',ms=2200)=>{ try{ ukToast(t,{accent:acc,ms}); }catch(_){}}

  function show(){ open=true; el.style.display='flex';
    el.querySelector('#gm_skiptuto').style.display = (_openingActive() || _onboardingActive()) ? 'block' : 'none';
    try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(_){} }
  function hide(){ open=false; el.style.display='none'; }

  // ⏭ 튜토리얼 건너뛰기 — 오프닝 종료 + 모든 팝업 튜토 완료 처리(사령관 2026-07-23: "건너뛰기 누르면 모든 거 다 스킵").
  //   플래그를 세팅해야 이후 채집/전투/해전/습격 팝업이 안 뜨고, 채집 게이트에 걸린 **항구 건설 잠금도 풀린다**.
  function skipTuto(){
    // opening.skip()의 완료 콜백이 같은 틱에 v3를 생성한다. 생성 전 클릭도 놓치지 않도록 부트 플래그를 남긴다.
    window.__skipOnboardingV3 = true;
    if(_openingActive()) ctx.opening.skip();
    try{ ctx.onboarding?.skip?.(); }catch(_){}
    try{ ['mas_gather_tuto_done','mas_combat_tuto_done','mas_naval_tuto_done','mas_raid_tuto_done'].forEach(k=>localStorage.setItem(k,'1')); }catch(_){}
    try{ const qp=new URLSearchParams(location.search); const cid=(qp.get('cid')||qp.get('name')||'default'); localStorage.setItem('mas_questline1_done:'+cid,'1'); }catch(_){}
    try{ ctx.gatherTuto && ctx.gatherTuto.close && ctx.gatherTuto.close(); }catch(_){}   // 이미 떠 있는 팝업 닫기
    try{ ctx.raidTuto && ctx.raidTuto.close && ctx.raidTuto.close(); }catch(_){}
    hide(); toast('튜토리얼 전체 건너뛰기','cyan');
  }

  // 🏝 근처 섬으로 — 가장 가까운 점령섬(없으면 홈=시작섬 스폰)으로 텔레포트. 바다에서 길 잃었을 때 복귀.
  function recall(){
    // ★오프닝 중엔 "근처 섬으로"를 곧장 스킵으로 대체(사령관 버그리포트 2026-07-10) — driftWake 컷신이 자체적으로
    //   홈섬에 데려다주므로, 여기서 또 텔레포트하면 컷신 카메라·좀비 튜토 핸들러와 충돌한다. 좀비 핸들러 방치가 원버그였음.
    if(_openingActive()){ ctx.opening.skip(); hide(); toast('튜토리얼을 건너뜁니다…','cyan'); return; }
    const p=ctx.player && ctx.player.pos; if(!p){ hide(); return; }
    const wl = ctx.water ? ctx.water.level : 0;
    const gAt = (x,z)=> ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0;
    let t = (ctx.terrain && ctx.terrain.spawn) ? { x:ctx.terrain.spawn.x, z:ctx.terrain.spawn.z } : { x:0, z:0 };   // 기본=홈(시작섬)
    let label='시작섬';
    const owned = (ctx.claimed||[]).filter(c=>c && c.owner==='player');
    if(owned.length){ let bd=Infinity; for(const c of owned){ const d=Math.hypot(c.x-p.x, c.z-p.z); if(d<bd){ bd=d; t={x:c.x,z:c.z}; } } label='점령섬'; }
    // ★확실한 육지 지점 탐색(나선) — 앵커가 물가/부두면 물속에 떨어져 "땅 위로 못 올라감"(사령관). 수면 위 0.6m↑ 지면을 찾는다.
    let lx=t.x, lz=t.z, ly=gAt(t.x,t.z);
    if(!(ly>wl+0.6)){ let found=false;
      for(let r=4; r<=140 && !found; r+=4){ for(let a=0;a<16;a++){ const ang=a/16*Math.PI*2;
        const sx=t.x+Math.cos(ang)*r, sz=t.z+Math.sin(ang)*r, g=gAt(sx,sz);
        if(g>wl+0.6){ lx=sx; lz=sz; ly=g; found=true; break; } } } }
    const y=(ly>wl+0.6?ly:wl)+2;
    // ★활성 플레이어는 setSpawn만으론 안 옮겨짐(스폰 초기화용) → 물리 바디 직접 이동 + 속도 0. 그래야 실제로 육지로 순간이동.
    try{ if(ctx.player.body){ ctx.player.body.setTranslation({x:lx,y,z:lz}, true); ctx.player.body.setLinvel({x:0,y:0,z:0}, true); } }catch(_){}
    if(ctx.player.setSpawn) ctx.player.setSpawn(lx, y, lz);
    hide(); toast(''+label+'으로 돌아왔습니다','cyan');
  }

  // 🎭 캐릭터 선택 — 저장 후 로비로.
  //   ★오프닝 중엔 저장이 아직 비활성(save.js markLive 전) + 바로 나가면 먼바다 상태로 세이브될 위험 → 스킵부터 완료시킴.
  function toChars(){
    if(_openingActive()){ ctx.opening.skip(); hide(); toast('튜토리얼을 건너뛰는 중… 완료 후 다시 캐릭터 선택을 눌러주세요','cyan',4200); return; }
    try{ ctx.save && ctx.save.write && ctx.save.write(); }catch(_){} location.href='select.html';
  }

  el.querySelector('#gm_resume').onclick=hide;
  el.querySelector('#gm_skiptuto').onclick=skipTuto;
  el.querySelector('#gm_recall').onclick=recall;
  el.querySelector('#gm_chars').onclick=toChars;

  // ESC 토글 — 교역/건설창/맵 열림 시 그쪽 ESC 우선(메뉴 안 뜸). capture 단계에서 처리(다른 ESC 핸들러보다 먼저 — 다른
  //   모듈의 ESC 핸들러는 bubble 단계라 여기서 먼저 open 상태를 읽어야 "이미 그쪽에서 닫혀서 상태가 false로 바뀐 뒤"를
  //   보는 경쟁 상태를 피함). 세 번째 인자 true = capture 필수(과거엔 주석만 있고 실제론 bubble이라 M맵 ESC와 겹쳐 메뉴가
  //   동시에 뜨는 버그가 있었음).
  addEventListener('keydown', e=>{
    if(e.code!=='Escape') return;
    if(open){ hide(); return; }
    // ❎ X 닫기가 쏜 합성 Escape면 양보(X는 닫기 전용 — 일시정지 안 염). 고스트/패널/튜토 취소만 하고 pause는 안 뜸.
    if(ctx.input && ctx.input.suppressingPause && ctx.input.suppressingPause()) return;
    // 다른 모달이 열려 있으면 양보(그 모달의 ESC가 닫음)
    if(ctx.navmap && ctx.navmap.open) return;
    if(ctx.trade && ctx.trade.open) return;
    if(ctx.wharfBuild && ((ctx.wharfBuild.placing && ctx.wharfBuild.placing()) || (ctx.wharfBuild.building && ctx.wharfBuild.building()))) return;
    if(ctx.shipyard && ctx.shipyard.buildMode && ctx.shipyard.buildMode()) return;
    show();
  }, true);

  ctx.menu = { show, hide, recall, isOpen:()=>open };
  console.log('[menu] 인게임 메뉴 등록 — ESC 토글 · 계속/근처섬복귀/캐릭터선택.');
  return ctx.menu;
}
