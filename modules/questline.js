// questline.js — 1차 퀘스트라인(오프닝 골든패스 직후 "정착" 온보딩).
//   구조 = combattuto.js 패턴 이식(오버레이 DOM/CSS + 단계 게이팅 + 행동/카운터 감지 자동전환 + localStorage 1회).
//   ★흐름 재설계(2026-08-07, BUG-A5 — 사령관 "내가 있는 섬에 거점 자체가 없는데 왜 부족섬으로 가라는 거야?"):
//     깨어남·탐색 → 도구 제작 → 자재 채집 → **[신규] 거점 깃발로 이 섬을 거점화** → 거점에 항구(부두)
//     → 첫 배 건조 → 첫 출항 → 항해·섬 발견 → **차원문 던전 정복(용병 굴복)**.
//     구 흐름의 "[N] 내 섬 관리 → 항구 건설로 점령"과 "요새 공성 점령"은 폐기(마스터 플랜 제외 확정).
//     건설 안내는 전부 [제작] 탭 기준(원칙-1: 모든 건물 제작은 제작탭 단일 진입점).
//   발동 = ?quest=1 (증분③에서 튜토 핸드오프가 이 파라미터로 진입). game.html initWharf 뒤에 initQuestline(ctx).
//   ※ 첫 섬 점령(Q7~Q8)은 ?stream=1(worldstream) 활성이 전제 — select.html 출항 URL에 stream=1 포함.
//   ★온보딩 첫 정복 섬(홈 최근접 부족섬 1곳)은 본편과 동일한 정식 공성전 — worldstream이 ?quest=1일 때 그 섬만 방벽·포대(tier2)를
//     세운다(DEC-013 예외). 방금 배운 현측포격(Q/E)으로 방벽을 부순 뒤에야 상륙·점령 가능(capture.towersAlive 게이트). 그 외 근거리 섬은 tier0 평화점령 유지.
//
//   [실 트리거 근거 — 추론 아님, 코드 확인]
//     Q2 채집: ctx.inventory.count('timber')/('stone')  — 벌목=timber3+leaf2(axetree.js:180), 채광=stone(mine.js)
//     Q3 제작: ctx.inventory.count('rope')              — 밧줄 레시피 {leaf:3}→rope1 (invui.js:151)
//     Q4 항구: ctx.onWharfBuilt(p) 훅                    — G키 항구 확정 시 발동 (wharf.js:67)
//     Q5 배  : ctx.onShipBuilt 훅 (증분②에서 조선소 flow가 발동)
//     Q6 출항: ctx.ship(bs.x/z, boarded) 이 항구(ctx.wharf.pos)에서 220m 이탈
//     Q7 발견: 가장 가까운 부족 거점/섬(ctx.capture.outposts owner!=='player' 또는 ctx.worldstream.islands) 340m 진입
//     Q8 점령: ctx.onOutpostCaptured(o) 훅 — capture.js flipOwner('player') 시 발동

import * as THREE from 'three';
import { toast as ukToast, compass as ukCompass } from './uikit.js';

// ★캐릭터별 완료 플래그(사령관: 이전 캐릭터 완료 → 새 캐릭터도 퀘스트 스킵되던 버그). cid(세이브)·name 폴백.
//   ★버그③(2026-07-13): 오프닝 URL엔 cid가 없어(select.html) — 예전엔 이 값이 모듈 top-level에서 '한 번만'
//   계산돼 URL이 나중에 replaceState로 cid를 얻어도 반영이 안 됐음(같은 이름으로 과거 완료 시 조용히 스킵되던 원인).
//   → 함수로 바꿔 initQuestline() 호출 시점마다(+명시적 cid 인자 우선) 재계산.
function lsKey(explicitCid){
  const qp = new URLSearchParams(location.search);
  const cid = (explicitCid || qp.get('cid') || qp.get('name') || '').trim() || 'default';
  return 'mas_questline1_done:' + cid;
}

// 채집·제작 목표치 [제안·잠정 — 구 _GOLDENPATH_DOD §4-1 목재6·돌4 계승, 플레이테스트 전]
// ★2026-08-07: 목재 6→8. 다음 단계(거점 깃발 = 목재8·돌4)를 채집 완료 즉시 만들 수 있게 정확히 일치시킴.
//   구값(6)이면 튜토대로 모아도 재료가 모자라 깃발을 못 만드는 소프트락이었다. 수량 변경 시 invui banner 레시피와 함께 볼 것.
const GOAL = { timber:8, stone:4 };   // ★밧줄(rope) 튜토 폐지 — 항구가 골드 비용이라 사슬 끊김(사령관 2026-07-05)

export function initQuestline(ctx, opts = {}){
  // ── 발동 게이트: ?quest=1 일 때만(증분③ 핸드오프가 이 파라미터로 진입). 완료 기록 있으면 스킵. ──
  const force = new URLSearchParams(location.search).get('quest')==='1';
  if(!force) return null;
  const LS_KEY = lsKey(opts.cid);   // ★버그③: 호출 시점 cid(오프닝 완료 시 opts.cid로 주입) 우선, 없으면 URL cid→name→'default'
  try { if(localStorage.getItem(LS_KEY)) { /* 완료자: 조용히 스킵 */ return null; } } catch(_){}

  const count = id => (ctx.inventory && ctx.inventory.count) ? ctx.inventory.count(id) : 0;
  // ★버그 수정(2026-07-13): 도끼·곡괭이는 인벤 카운트 아이템이 아니라 퀵슬롯 도구(invui.js completeCraft: rc.tool)라
  //   실제 보유 여부는 ctx.quickslots에서 확인해야 정확함(invui.js:630 already 체크와 동일 패턴). intro 단계에서
  //   미리 제작했거나 세이브 복원(save.js:147~150이 goStep보다 먼저 quickslots를 채움)으로 이미 도구를 가진 경우
  //   toolCrafted 이벤트가 다시 발생하지 않아 _toolsMade만으론 영구 정체 — onUpdate 폴링에서 실보유 상태로 판정.
  const hasTool = id => !!(ctx.quickslots && ctx.quickslots.some(s=>s && s.type==='tool' && s.id===id));
  const toast = (t,accent='gold') => { try{ ukToast(t,{accent,ms:2600}); }catch(_){}}

  // ── 이름 (select.html → ?name=캐릭터명 / ?followerName=동료명. 없으면 폴백). ──
  //   사령관 지시: "선장님" 대신 캐릭터 아이디(이름)로. 안내는 동료(추종자)가 대사로 이끈다.
  const qp = new URLSearchParams(location.search);
  const PNAME = (qp.get('name')||'').trim() || '선장';        // 플레이어 캐릭터명
  const FNAME = (qp.get('followerName')||'').trim() || '동료';  // 추종자(교역소 동료)명
  const _toolsMade = new Set();   // 제작 완료 도구(도끼·곡괭이) — crafttools 단계 진행

  // ── 단계 정의 (obj는 문자열 또는 매 프레임 갱신되는 함수) ──
  //   narr = 동료(FNAME)가 플레이어(PNAME)에게 건네는 대사. UI는 화자명 + 따옴표 대사체로 표시.
  const STEPS = [
    { id:'intro',  title:'표류자 — 낯선 해안',
      narr:`자, ${PNAME}님. 일어서셨으면 우선 몸을 좀 움직여 보세요. 이 섬이 어떤 곳인지 천천히 둘러보세요.`,
      obj:'WASD로 움직여 섬을 둘러보세요',
      hint:'WASD 이동 · 마우스 시점' },
    { id:'crafttools', title:'맨손의 시작 — 도구 만들기', reward:{gold:20},
      narr:'우선 도끼와 곡괭이부터 만들어요 — 살아남으려면 이 둘이 손발이에요. 재료는 안 들어요, 인벤토리만 열면 됩니다.',   // ★도구 무료(사령관 2026-07-05 — 생존도구 코스트 제거)
      obj:()=>`도구 제작 ${(hasTool('axe')?1:0)+(hasTool('pickaxe')?1:0)}/2 (도끼·곡괭이)`,
      hint:'[I] 인벤토리 → 제작 탭에서 도끼·곡괭이를 만드세요 (무료)' },
    { id:'gather', title:'생존의 시작 — 자재 모으기', reward:{gold:80},
      narr:'배가 산산조각 났어요. 다시 지으려면 목재와 돌이 필요해요. 도끼로 나무를 베고, 곡괭이로 돌을 캐 와 주세요.',
      obj:()=>`목재 ${count('timber')}/${GOAL.timber} · 돌 ${count('stone')}/${GOAL.stone}`,
      hint:'도끼(벌목)·곡괭이(채광)를 들고 자원에 다가가 좌클릭하세요' },
    // ★BUG-A5 재설계(2026-08-07 사령관): "지금 내가 있는 섬에 거점 자체가 없는데" — 남의 섬 정복보다
    //   **내가 선 섬에 거점을 세우는 게 먼저**다. 새 순서 = 깃발로 거점 선포 → 그 안에 항구 → 배.
    //   원칙-1(모든 건물 제작은 제작탭 단일 진입점)에 맞춰 안내 문구도 [제작]→[거점]으로 통일. 구 [N]키 건설 안내 폐기.
    { id:'outpost', title:'첫 거점 — 깃발을 세워라', reward:{gold:110},
      narr:`이 섬을 우리 것으로 삼아요, ${PNAME}님. 모아 온 목재와 돌로 깃발을 만들어 땅에 꽂으면, 그 둘레가 우리 거점이 돼요. 거기 안에서만 건물을 지을 수 있어요.`,
      obj:()=>`거점 깃발을 세우세요 (${(ctx.outpost&&ctx.outpost.used)||0}/1)`,
      hint:'[I] 인벤토리 → [제작] → [거점] 탭 → 거점 깃발 제작 (목재8·돌4·밧줄2) → 퀵슬롯 선택 → 땅을 보고 좌클릭' },
    { id:'harbor', title:'정착 — 거점에 항구 세우기', reward:{gold:110},
      narr:'거점이 생겼으니 이제 바다로 나갈 문이 필요해요. 해안으로 가서 부두를 세워요 — 배는 항구가 있어야 건조할 수 있어요.',
      obj:'해안에 항구(부두)를 건설하세요',
      hint:'해안에 서서 [I] → [제작] → [거점] → 항구(부두) → 바다를 보고 좌클릭 · [R] 회전' },
    { id:'ship',   title:'첫 항해를 위하여 — 배 건조하기',
      narr:`항구가 완성됐어요! 그동안 모은 자재와 여정에서 받은 삯으로 첫 배를 건조해요, ${PNAME}님. 이 배로 우리 항해가 시작돼요.`,
      obj:'첫 배(캐러벨)를 건조하세요',
      hint:'[I] → [제작] → [선박] 탭 → 캐러벨 (금화 600) → 부두 근처를 보고 좌클릭' },
    { id:'setsail', title:'닻을 올리고 — 첫 출항',
      narr:`배가 완성됐어요, ${PNAME}님! 이제 진짜 항해예요. 배 갑판에 올라 조타륜을 잡고([Z]) 돛을 펴([W]) 먼바다로 나가 봐요. 급할 땐 [Shift]로 전력질주할 수 있어요.`,
      obj:()=>{ const d=_shipDist(); return d>4 ? `바다로 항해 (${Math.round(d)} / 220m)` : '배에 올라 [Z] 조타하고 바다로 나가세요'; },
      hint:'배 갑판에 올라 [Z] 조타 · [W] 돛 펴기 · [Shift] 전력질주 · [T] 닻 올림/내림' },
    // ★BUG-A5(사령관 "왜 부족섬으로 가라는 거야?"): 목적지를 '부족의 섬 정복'에서 **차원문이 열린 섬**으로 교체.
    //   내 거점은 이미 세웠으니 다음은 남의 땅을 뺏는 게 아니라 차원문 원정을 나가는 것(새 핵심 루프).
    { id:'voyage', title:'미지의 바다 — 차원문이 열린 섬으로',
      narr:'거점은 우리 것이 됐어요. 이제 바깥으로 나가요 — 저 너머 섬에 차원문이 열려 있어요. 화면의 표식을 따라 뱃머리를 돌려요.',
      obj:()=>{ const d=_tgtDist(); return d!=null ? `차원문의 섬으로 항해 (${Math.round(d)}m)` : '차원문이 열린 섬을 찾아 항해하세요'; },
      hint:'상단 나침반의 금색 표식 방향으로 항해 · 가까워지면 배에서 내려 상륙' },
    // ★BUG-A5: 구 conquer(요새 공성 점령) 폐기 — 마스터 플랜에서 "공성 성채·해안 방벽·타워 파괴 점령은
    //   핵심 루프에서 제외" 확정됨. 새 정복 = **차원문 던전 클리어**(그 보상으로 몬스터 용병이 굴복해 합류).
    { id:'conquer', title:'첫 정복 — 차원문 너머로', reward:{gold:100},
      narr:'저 섬에 차원문이 열려 있어요. 그 안의 던전을 정복하면, 쓰러진 짐승 중 가장 강한 놈이 무릎을 꿇고 우리 용병이 돼요. 거점을 지킬 힘은 거기서 나와요.',
      obj:'섬에 상륙해 차원문 던전을 클리어하세요',
      hint:'상륙 후 [R]로 크루에게 "따라오기" 지시 · 차원문에 다가가 [E] 입장 → 던전의 몹을 전멸시키면 클리어 · 굴복한 용병은 [제작]→[거점]→용병 배치로 거점에 세웁니다' },
  ];
  const idx = id => STEPS.findIndex(s=>s.id===id);

  // ── Pretendard(엘든 톤) — game.html head에 없으면 주입 ──
  if(!document.querySelector('link[href*="pretendard"]')){
    const f=document.createElement('link'); f.rel='stylesheet';
    f.href='https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css';
    document.head.appendChild(f);
  }

  // ── CSS 주입 (좌측 상시 퀘스트 트래커) ──
  if(!document.getElementById('_questline-css')){
    const css=document.createElement('style'); css.id='_questline-css';
    css.textContent=`
      #quest{position:fixed;left:14px;top:50%;z-index:55;width:min(310px,80vw);
        background:linear-gradient(180deg,rgba(14,16,20,.90),rgba(10,12,16,.84));
        border:1px solid rgba(176,148,96,.42);border-radius:7px;
        box-shadow:0 14px 44px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.45);
        color:#e9e2d2;pointer-events:none;overflow:hidden;
        font:13px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;
        opacity:0;transform:translate(-10px,-50%);transition:opacity .5s ease, transform .5s ease;}
      #quest.show{opacity:1;transform:translate(0,-50%);}
      #quest.flash{animation:qflash .9s ease;}
      @keyframes qflash{0%{box-shadow:0 0 0 0 rgba(245,224,171,0)}
        30%{box-shadow:0 0 0 3px rgba(245,224,171,.55), 0 14px 44px rgba(0,0,0,.5)}
        100%{box-shadow:0 14px 44px rgba(0,0,0,.5)}}
      #quest .qlabel{display:flex;align-items:center;gap:7px;padding:9px 14px 7px;
        font-size:11px;letter-spacing:.22em;color:#c9a95a;text-transform:uppercase;}
      #quest .qlabel .qidx{margin-left:auto;letter-spacing:.06em;color:#8a836f;}
      #quest .qti{padding:2px 14px 8px;font-size:15.5px;font-weight:600;color:#f0d9a8;letter-spacing:.02em;
        border-bottom:1px solid rgba(176,148,96,.22);}
      #quest .qspk{display:flex;align-items:center;gap:6px;padding:10px 14px 0;
        font-size:11.5px;font-weight:600;letter-spacing:.03em;color:#c9a95a;}
      #quest .qspk::before{content:"";width:5px;height:5px;border-radius:50%;background:#c9a95a;box-shadow:0 0 6px rgba(201,169,90,.8);}
      #quest .qnarr{padding:5px 14px 6px;font-size:12.5px;line-height:1.75;color:#cdc4b0;font-style:italic;}
      #quest .qobj{display:flex;align-items:center;gap:8px;padding:8px 14px;font-size:13.5px;color:#eadfc6;}
      #quest .qobj::before{content:"◇";color:#c9a95a;font-size:12px;}
      #quest.done-step .qobj::before{content:"◆";color:#7af0a0;}
      #quest .qhint{padding:8px 14px 12px;margin-top:2px;font-size:11.5px;color:#8f887a;
        border-top:1px solid rgba(176,148,96,.16);}
      #quest .qhint b{color:#d8c898;}
    `;
    document.head.appendChild(css);
  }

  // ── 패널 DOM ──
  const el=document.createElement('div'); el.id='quest';
  el.innerHTML=`
    <div class="qlabel">◆ 1차 항해 <span class="qidx"></span></div>
    <div class="qti"></div>
    <div class="qspk"></div>
    <div class="qnarr"></div>
    <div class="qobj"></div>
    <div class="qhint"></div>`;
  document.body.appendChild(el);
  const $ti=el.querySelector('.qti'), $spk=el.querySelector('.qspk'), $narr=el.querySelector('.qnarr'),
        $obj=el.querySelector('.qobj'), $hint=el.querySelector('.qhint'), $idx=el.querySelector('.qidx');

  let cur=null, done=false;

  // ── 🧭 목표 방향 마커 — 상단 나침반 바(uikit.compass) 재사용. 예전엔 화면에 떠다니는 ❗ 리티클을 직접 그렸는데,
  //   "마우스 움직이면 목표가 따라다닌다"는 지적(사령관 2026-07-10) — 카메라 방위를 그대로 화면좌표로 쓰다 보니
  //   마우스룩할 때마다 화면 아무데나 널뛰었음. 발할라식 상단 고정 바 + 그 위를 미끄러지는 핀으로 교체 — 위치가
  //   화면 안에서 안정적으로 한정되고, 디자인도 uikit 공통 톤이라 기존 ❗보다 게임 전체와 어울림.

  // ── 🧭 Q6~Q8 위치 헬퍼 (함수 선언 = 호이스팅되어 STEPS obj에서 참조 가능) ──
  function groundY(x,z){ return (ctx.terrain && ctx.terrain.groundAt) ? ctx.terrain.groundAt(x,z,5000) : 0; }
  let _harborRef=null;         // 출항 기준점(항구 좌표) — setsail 진입 시 고정
  let _target=null;            // 현 항해 목표 {x,z} (부족 거점 또는 canon 섬, 월드 좌표)
  function shipPos(){ const b=ctx.ship; return b ? { x:b.x, z:b.z } : (ctx.player&&ctx.player.pos ? { x:ctx.player.pos.x, z:ctx.player.pos.z } : null); }
  function _shipDist(){ const s=shipPos(), h=_harborRef; if(!s||!h) return 0; return Math.hypot(s.x-h.x, s.z-h.z); }
  function pickTarget(){   // 가장 가까운 부족 거점(있으면) → 없으면 가장 가까운 canon 섬(아직 스트림 전이어도 방향은 즉시 제공)
    const pp = ctx.player && ctx.player.pos; if(!pp) return null;
    let best=null, bd=Infinity;
    const caps = (ctx.capture && ctx.capture.outposts) || [];
    for(const o of caps){ if(o.owner==='player') continue; const d=Math.hypot(pp.x-o.x, pp.z-o.z); if(d<bd){ bd=d; best={ x:o.x, z:o.z }; } }
    if(best) return best;
    const ws = ctx.worldstream;
    if(ws && ws.islands && ws.islands.length){ const S = ws.WORLD_SCALE || 1;
      for(const isle of ws.islands){ const x=isle.x*S, z=isle.z*S; const d=Math.hypot(pp.x-x, pp.z-z); if(d<bd){ bd=d; best={ x, z }; } } }
    return best;
  }
  function _tgtDist(){ if(!_target) return null; const pp=ctx.player&&ctx.player.pos; if(!pp) return null; return Math.hypot(pp.x-_target.x, pp.z-_target.z); }
  const _mv=new THREE.Vector3(), _vv=new THREE.Vector3();
  // ★2026-07-10 — uikit.compass()(발할라식 상단 나침반 바) 사용으로 교체. 절대 방위(atan2(dx,dz), N=0·시계방향)만
  //   getHeading/getMarkers로 넘기면 컴포넌트가 알아서 상대위치·클램프·rAF 루프를 처리 — 여기선 절대각만 정확히 계산.
  const _camDir=new THREE.Vector3();
  const _bearing=(dx,dz)=> ((Math.atan2(dx,dz)*180/Math.PI)+360)%360;
  const _questCmp = ukCompass({
    getHeading(){ if(!ctx.camera) return 0; ctx.camera.getWorldDirection(_camDir); return _bearing(_camDir.x,_camDir.z); },
    getMarkers(){
      if(done || !_target || (cur!=='voyage' && cur!=='conquer')) return [];
      const org = (ctx.player && ctx.player.pos) ? ctx.player.pos : (ctx.camera ? ctx.camera.position : null);
      if(!org) return [];
      const d=_tgtDist();
      return [{ bearing:_bearing(_target.x-org.x, _target.z-org.z), dist:(d!=null?Math.round(d)+'m':''), accent:'gold' }];
    },
  });

  function render(step){
    const s=STEPS[idx(step)]; if(!s) return;
    $ti.textContent=s.title;
    $spk.textContent=FNAME;
    $narr.textContent=`"${s.narr}"`;
    $hint.innerHTML=s.hint.replace(/\[([^\]]+)\]/g,'[<b>$1</b>]');
    $idx.textContent=`${idx(step)+1} / ${STEPS.length}`;
    updObj();
    el.classList.remove('done-step');
    el.classList.add('show');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function updObj(){
    const s=STEPS[idx(cur)]; if(!s) return;
    $obj.textContent = (typeof s.obj==='function') ? s.obj() : s.obj;
  }

  let _advancing=false;   // ★SIM-H1/H2 수정 — advance()가 cur를 즉시 안 바꿔(전환은 900ms 후 goStep) 폴링(onUpdate)·훅 이중발동이
                          //   그 창에서 advance를 재호출 → 보상 다중지급(실측 +10,640골드=133배). 전환 대기 중 재진입 차단.
  function goStep(step){
    if(done) return;
    _advancing=false;   // 외부 점프(세이브 복원·__quest.go) = 진행 중이던 전환 취소
    cur=step; render(step);
    if(step==='gather' && ctx.gatherTuto) try{ ctx.gatherTuto.start(); }catch(_){}   // 🪓⛏️ 채집 단계 = 벌목·채광 튜토 팝업 발동
    if(step==='setsail'){ _harborRef = (ctx.wharf && ctx.wharf.pos) ? { x:ctx.wharf.pos.x, z:ctx.wharf.pos.z } : (ctx.ship ? { x:ctx.ship.x, z:ctx.ship.z } : shipPos()); }   // 출항 기준점 = 항구
    if(step==='voyage'){ _target=null; }   // 항해 목표 재선정
    try{ window.__questStep=step; }catch(_){}
  }
  function advance(){
    if(done||_advancing) return;
    _advancing=true;
    const _from=cur;
    const i=idx(cur);
    el.classList.add('done-step');
    toast('목표 달성', 'green');
    // ★단계 보상 = 골드 지급 (사령관: 보상을 골드로). #11 골드 인플레 대응 하향:
    //   crafttools20·gather80·craft40·harbor110 = 250(온보딩 합계) → 캐러벨 600이 실목표(부족분은 교역/습격으로). conquer100=정복 보상.
    const rw = STEPS[i] && STEPS[i].reward;
    if(rw && rw.gold && ctx.inventory && ctx.inventory.addGold){
      ctx.inventory.addGold(rw.gold);
      setTimeout(()=>{ toast('보상 +'+rw.gold+' 금화', 'gold'); ctx.sound?.play?.('reward'); }, 700);   // ★보상획득음(사령관 신규)
    }
    const next=STEPS[i+1];
    if(!next){ complete(); return; }
    setTimeout(()=>{ _advancing=false; if(!done && cur===_from) goStep(next.id); }, 900);   // cur 변경(외부 go) 시 전환 포기 — 이중전환 방지
  }
  function complete(){
    done=true;
    try{ ctx.questBeam=null; }catch(_){}   // 🗼 온보딩 완료 → 목표 빛기둥 소거
    el.classList.add('done-step');
    _questCmp.setVisible(false);
    $ti.textContent='첫 섬 정복 — 항해가 시작된다';
    $obj.textContent='첫 섬을 점령했다. 이제 온 세계가 무대다.';
    try{ localStorage.setItem(LS_KEY,'1'); }catch(_){}
    try{ window.__questStep='done'; }catch(_){}
    // ── #21: 온보딩 종료 → 좌측 퀘스트 트래커 정리 ──
    //   완료 문구를 잠시 노출한 뒤 fade-out(#quest.show 제거 → opacity/transform .5s) → DOM 제거.
    //   정착→첫 섬 점령 온보딩이 끝났으니 트래커는 화면에서 사라진다.
    setTimeout(()=>{
      el.classList.remove('show');
      let _cleaned=false;
      const cleanup=()=>{ if(_cleaned) return; _cleaned=true; try{ el.remove(); }catch(_){} try{ _questCmp.dispose(); }catch(_){} };
      el.addEventListener('transitionend', cleanup, { once:true });
      setTimeout(cleanup, 800);   // transitionend 미발생 대비 폴백
    }, 4000);
  }

  // ── Q1 intro → gather : 첫 WASD 이동 감지 ──
  let moved=false;
  function onMoveKey(e){
    if(moved||cur!=='intro') return;
    if(e.code==='KeyW'||e.code==='KeyA'||e.code==='KeyS'||e.code==='KeyD'){
      moved=true; window.removeEventListener('keydown',onMoveKey);
      setTimeout(()=>{ if(cur==='intro') advance(); }, 600);   // 잠깐 둘러본 뒤 다음 목표
    }
  }
  window.addEventListener('keydown', onMoveKey);

  // ── R2: 이벤트 버스 구독(구 "prev 저장→호출" 수제 체인 폐지 — 한 곳이라도 잊으면 조용히 끊기던 것) ──
  // crafttools → gather : 도끼·곡괭이 둘 다
  ctx.events.on('toolCrafted', (id)=>{
    if(id==='axe'||id==='pickaxe') _toolsMade.add(id);
    if(cur==='crafttools' && _toolsMade.has('axe') && _toolsMade.has('pickaxe')) advance(); });
  // 🚩 outpost → harbor : 깃발 설치(outpost.js가 발행)
  ctx.events.on('outpostPlaced', ()=>{ if(cur==='outpost') advance(); });
  // Q4 harbor → ship
  ctx.events.on('wharfBuilt', ()=>{ if(cur==='harbor') advance(); });
  // Q5 ship → setsail (조선소가 발동)
  ctx.events.on('shipBuilt', ()=>{ if(cur==='ship') advance(); });
  // crewfollow → conquer : 상륙 후 [R] 라디얼로 "따라오기" 지시(crew.js _setLandOrder → crewLandOrder 이벤트)
  ctx.events.on('crewLandOrder', (mode)=>{ if(cur==='crewfollow' && mode==='follow') advance(); });
  // Q8 conquer → done. ★BUG-A5: 완료 조건을 **차원문 던전 클리어**로 교체(구 요새 점령 폐기).
  //   mercenaryCaptured = dungeonrun.doClear가 용병 영입 시 발행 → "정복했다"의 실제 신호.
  ctx.events.on('mercenaryCaptured', ()=>{ if(cur==='conquer') advance(); });
  //   용병 영입이 실패해도(중복 종·명부 만석) 던전은 클리어된 것 → 구 점령 이벤트도 완료로 인정(안전망).
  ctx.events.on('outpostCaptured', ()=>{ if(cur==='conquer') advance(); });

  // ── 폴링 루프 : 목표 텍스트 라이브 갱신 + 채집/제작 자동전환 ──
  ctx.onUpdate(()=>{
    if(done||!cur) return;
    updObj();   // 함수형 목표(도구·채집·밧줄·거리 카운터) 매 프레임 갱신
    // ★crafttools 폴링(2026-07-13 버그 수정) — gather 단계와 동일 패턴. toolCrafted 이벤트에만 의존하면
    //   intro 단계에서 미리 도구를 만들었거나 세이브 복원으로 이미 도구를 보유한 채 이 단계에 진입한 경우
    //   이벤트가 다시 안 터져 영구 정체(소프트락)했음 — 실보유 상태(hasTool)로 매프레임 완료 판정.
    if(cur==='crafttools' && hasTool('axe') && hasTool('pickaxe')) advance();
    else if(cur==='gather' && count('timber')>=GOAL.timber && count('stone')>=GOAL.stone) advance();
    // 🚩 깃발 폴링(이벤트 누락·세이브 복원으로 이미 거점을 가진 채 이 단계에 들어온 경우 소프트락 방지 — crafttools와 같은 패턴)
    else if(cur==='outpost' && ctx.outpost && ctx.outpost.used>0) advance();
    else if(cur==='harbor' && ctx.wharf && ctx.wharf.pos) advance();   // 항구도 동일 안전장치
    // (밧줄 craft 스텝 폐지 — 2026-07-05)
    else if(cur==='setsail'){ if(ctx.ship && _shipDist()>220) advance(); }   // 항구서 220m 이탈 = 출항
    else if(cur==='voyage'){ if(!_target) _target=pickTarget(); const d=_tgtDist(); if(d!=null && d<340) advance(); }   // 부족 섬 340m 진입 = 발견
    // 🗼 목표 하늘 빛기둥(questfx가 읽음) — 첫 목적지(부족 섬) 위치 발행. voyage/conquer 동안만, 그 외 단계·완료 시 소거.
    ctx.questBeam = (cur==='voyage' || cur==='conquer') && _target ? { x:_target.x, z:_target.z } : null;
    // 방향 마커(_questCmp)는 uikit.compass 자체 rAF 루프가 getMarkers()로 매프레임 알아서 갱신(self-gate) — 별도 호출 불필요.
  });

  // ── 디버그/검증 훅 ──
  window.__quest={ go:goStep, advance, reset:()=>{ try{localStorage.removeItem(LS_KEY);}catch(_){} location.reload(); }, steps:STEPS.map(s=>s.id) };

  // ── 시작: 첫 프레임에 Q1 오픈 ──
  //   ★이어하기(save.restore)가 이미 단계를 세팅했으면(cur!=null) intro로 덮지 않는다 — 안 그러면 진행도가 항상 intro로 역행(사령관 "1차 항해로 돌아감").
  let _kick=false;
  ctx.onUpdate(()=>{ if(_kick) return; _kick=true; if(!cur) goStep('intro'); });

  console.log('[questline] 1차 퀘스트라인 활성(?quest=1) — Q1 깨어남부터. window.__quest 로 제어.');
  return { goStep, advance, complete, steps:STEPS };
}
