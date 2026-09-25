// loadscreen.js — 전 페이지 공용 로딩 화면 (game / select / intro).
//   레퍼런스: ref/로딩스크린.jpg (Ashen) · 분석표: _로딩화면_레퍼런스.md
//   구성 = 검은 석판 배경 + 중앙 tomob 로고 + 하단 세계관/조작 문구 + 우하단 등불(진행률만큼 차오름).
//
//   ⛔ 진행바(게이지·퍼센트)는 없다. 사령관 확정 = "오른쪽 애셋 하나 만들고 그게 채워지는 형태".
//   ⛔ 등불은 사실적 렌더가 아니라 **플랫 아이콘**(ui/loading_lantern_icon.png)을 CSS mask로 쓴다.
//      렌더 이미지를 축소하면 뭉개진 사진이 된다(1차 폐기). 색은 그라디언트가 칠하므로 off/on 두 장이 필요 없다.
//   ⚠️ file://로 열면 mask-image가 CORS로 차단돼 아이콘이 통째로 사라진다. 반드시 http(dev 서버) 경유.
//
//   문구 출처(지어낸 설정·없는 키 없음):
//     세계·종족 = modules/tribes.js (9종족 SSOT, 2026-07-03 확정. 12보석부족은 폐지됨)
//     진영      = 향후방향_v2.md §2
//     조작      = ⛔ `_입력키맵.md`를 믿지 말 것 — 구버전이다(2026-07-22 확인).
//                 조타를 Q/E로, 건축을 B로 적어놨는데 실제는 A/D 조타(ship.js:657)이고 B 라디얼은 폐기됐다(build.js:218).
//                 조작 문구는 **코드에서 직접 확인한 것만** 넣는다.
//   톤: 서사는 확정 로어 원문이라 평서체 / 조작 안내는 존댓말.

const BG   = '/tomob-deploy/ui/loading_bg.png';
const ICON = '/tomob-deploy/ui/loading_lantern_icon.png';
const LOGO = '/tomob-deploy/intro/logo.png';

export const LOAD_TIPS = [
  // ── 세계 ──
  '바다는 지금도 차오른다. 남은 땅은 잠기지 않은 봉우리뿐이다.',
  '남은 자는 별을 부숴 잠긴 대륙을 되돌리려 하고, 파수꾼은 그 별을 지킨다.',
  '네가 영입한 추종자가 곧 이 세계의 종족이고, 섬의 주인이다.',
  // ── 9종족 ──
  '밧모 밀수꾼 — 어둠 속 거래에 능하다. 남은 자의 물길을 잇는다.',
  '이방 용병 — 먼 봉우리에서 온 이방인. 갑판의 방패이자 앞장서는 창이다.',
  '봉우리 투사 — 먼 봉우리에서 온 거친 전사. 앞장서 적을 들이받는다.',
  '떠돌이 검사 — 아라랏으로 흘러든 이름 없는 떠돌이. 어디에도 매이지 않는다.',
  '봉우리 상인 — 밧모 해역을 떠돈다. 시세를 읽어 값을 매긴다.',
  '표류자 — 차오르는 바다를 피해 아라랏으로 온 피난민. 살아남는 법을 판다.',
  '스올 문지기 — 스올의 문을 지키던 자. 망자의 길과 안개를 안다.',
  '들개 기사 — 주인 잃은 봉우리의 충직한 기사. 맡은 봉우리를 끝까지 지킨다.',
  '잠긴 왕국 병사 — 바다에 잠긴 왕국의 최후 병사. 무너진 맹세를 아직 지킨다.',
  // ── 조작 · 시스템 ──
  'WASD를 두 번 두드리면 회피합니다. 구르는 동안은 무적입니다.',
  'V로 무기를 뽑고 넣습니다.',
  '배의 키는 A와 D입니다. 속도가 붙어야 잘 돕니다.',
  '돛은 W로 펴고 S로 접습니다. 접을수록 느려집니다.',
  'Q와 E로 좌현·우현 포문을 조준하고, 좌클릭으로 사격합니다.',
  '항해 중 Shift는 전력 항해입니다. 스태미나를 소모합니다.',
  'T로 닻을 내리고, Y로 배에 오르내립니다.',
  '닻을 내리면 돛도 함께 접힙니다.',
  'G로 항구를 세우면 그 봉우리가 당신의 것이 됩니다.',
  '교역은 신뢰를, 습격은 악명을, 수비는 명예를 쌓습니다. 추종자는 그 축을 보고 합류합니다.',
];

const CSS = `
#load{position:fixed;inset:0;z-index:9999;
  background:#050505 url('${BG}') center/cover no-repeat !important;
  color:#cfc9c0 !important;font:400 13px/1.6 'Pretendard',system-ui,'Malgun Gothic',sans-serif !important;
  letter-spacing:normal !important;overflow:hidden}
#load .ls-logo{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);
  height:42vh;width:auto;filter:drop-shadow(0 0 26px rgba(0,0,0,.85));opacity:.96}
#load .ls-tip{position:absolute;left:50%;top:89%;transform:translate(-50%,-50%);
  max-width:64vw;text-align:center;font-size:2.05vh;line-height:1.6;color:#cfc9c0;
  text-shadow:0 2px 10px rgba(0,0,0,.9);transition:opacity .55s ease}
#load .ls-lamp{position:absolute;right:2.9vw;top:89%;transform:translateY(-50%);
  height:8.6vh;aspect-ratio:1/1}
#load .ls-lamp i{position:absolute;inset:0;display:block;
  -webkit-mask:url('${ICON}') center/contain no-repeat;
          mask:url('${ICON}') center/contain no-repeat;
  /* 아래=불 들어온 앰버 / 위=아직 안 켜진 흰 실루엣.
     미충전부를 투명하게 두면 검은 배경에 묻혀 아이콘이 사라진다 — 흰색으로 남기고 밝기 차로만 읽힌다. */
  background:linear-gradient(to top,
    #ffc85e               calc(var(--p,0) * 100% - 6%),
    rgba(255,190,86,.78)  calc(var(--p,0) * 100% + 1%),
    rgba(233,228,218,.46) calc(var(--p,0) * 100% + 9%));
  animation:ls-flicker 2.6s ease-in-out infinite}
/* drop-shadow를 keyframe 안에 같이 둔다 — filter는 통째로 덮어써진다 */
@keyframes ls-flicker{
  0%,100%{filter:drop-shadow(0 0 6px rgba(0,0,0,.92)) brightness(1)}
  38%    {filter:drop-shadow(0 0 7px rgba(0,0,0,.92)) brightness(1.12)}
  62%    {filter:drop-shadow(0 0 6px rgba(0,0,0,.92)) brightness(.94)}}
#load .ls-lamp::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:280%;height:220%;pointer-events:none;
  background:radial-gradient(ellipse at center,
    rgba(255,176,72,.26) 0%,rgba(255,150,50,.10) 36%,rgba(255,140,40,0) 70%);
  opacity:calc(var(--p,0) * .95);transition:opacity .5s linear}
#load .ls-stage{position:absolute;left:50%;bottom:2.2vh;transform:translateX(-50%);
  font-size:11px;color:rgba(200,192,180,.34);letter-spacing:.04em;white-space:nowrap}
`;

/**
 * @param {object} o
 *   o.expect   총 단계 수. 주면 stage 갱신마다 진행률이 오른다. 없으면 불확정 모드(등불이 천천히 반복해 차오름).
 *   o.rotate   문구 교체 주기(ms). 0이면 고정. 기본 6000.
 *   o.showStage 단계 문구를 화면에 보일지. 기본 false(?dev=1이면 자동 true).
 */
export function initLoadScreen(o = {}) {
  const rotate    = o.rotate ?? 6000;
  const showStage = o.showStage ?? new URLSearchParams(location.search).get('dev') === '1';

  if (!document.getElementById('ls-css')) {
    const s = document.createElement('style'); s.id = 'ls-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  // 기존 #load를 그대로 재사용한다 — 각 페이지의 show/hide 코드를 건드리지 않기 위해.
  let el = document.getElementById('load');
  if (!el) { el = document.createElement('div'); el.id = 'load'; document.body.appendChild(el); }
  el.textContent = '';

  const logo = document.createElement('img');
  logo.className = 'ls-logo'; logo.src = LOGO; logo.alt = 'tomob';

  const tip = document.createElement('div');
  tip.className = 'ls-tip';

  const lamp = document.createElement('div');
  lamp.className = 'ls-lamp'; lamp.appendChild(document.createElement('i'));

  const stage = document.createElement('div');
  stage.className = 'ls-stage';
  if (!showStage) stage.style.display = 'none';

  el.append(logo, tip, lamp, stage);

  // ── 문구 ──
  let ti = (Math.random() * LOAD_TIPS.length) | 0;
  tip.textContent = LOAD_TIPS[ti];
  let rotTimer = 0;
  if (rotate > 0) {
    rotTimer = setInterval(() => {
      tip.style.opacity = '0';
      setTimeout(() => { ti = (ti + 1) % LOAD_TIPS.length; tip.textContent = LOAD_TIPS[ti]; tip.style.opacity = '1'; }, 550);
    }, rotate);
  }

  // ── 진행률 ──
  let p = 0, step = 0, indetTimer = 0;
  const apply = v => { p = Math.max(0, Math.min(1, v)); el.style.setProperty('--p', p); };
  apply(0);

  if (!o.expect) {
    // 불확정: 실제 진행도를 모를 때. 등불이 반복해 차오른다(멈춘 게 아님을 보이는 역할).
    let t = 0;
    indetTimer = setInterval(() => { t = (t + 0.014) % 1.25; apply(Math.min(1, t)); }, 60);
  }

  // stage.textContent 대입을 감시해 진행률을 올린다 → 호출부의 `L.textContent='…'` 17곳을 고칠 필요가 없다.
  const mo = new MutationObserver(() => {
    if (!o.expect) return;
    step++; apply(step / o.expect);
  });
  mo.observe(stage, { childList: true, characterData: true, subtree: true });

  const api = {
    el, stage,                                   // stage = 호출부가 textContent를 넣는 대상
    setProgress: apply,
    setStage(t) { stage.textContent = t; },
    done() { if (indetTimer) { clearInterval(indetTimer); indetTimer = 0; } apply(1); },
    hide() {
      api.done();
      if (rotTimer) { clearInterval(rotTimer); rotTimer = 0; }
      mo.disconnect();
      el.style.display = 'none';
    },
    show() { el.style.display = ''; },
    // 부팅 실패 — 로딩 화면을 그대로 두고 팁 자리에 사유를 띄운다(문구 로테이션 정지).
    fail(html) {
      if (rotTimer) { clearInterval(rotTimer); rotTimer = 0; }
      if (indetTimer) { clearInterval(indetTimer); indetTimer = 0; }
      mo.disconnect();
      tip.innerHTML = html;
      tip.style.color = '#e2a893';
      lamp.style.display = 'none';
    },
  };
  return api;
}
