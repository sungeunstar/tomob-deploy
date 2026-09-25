// uikit.js — voyage 게임 공통 UI 키트 (디자인 시스템 단일 출처)
//   색 역할: 🟡골드=재화/메뉴 · 🔵시안=맵/항해/정보 · 🔴레드=전투/위험 · ⚪흰=본문
//   형태: 무테두리 시네마틱(발할라·엘든링·젤다) — 테두리·박스감 제거, 가장자리 페이드 + 발광 텍스트.
//   레퍼런스: voyage/ref/ 디자인시스템1~3 · 화면/ · map design.
//   사용: import { UI, toast, keycap } from './uikit.js';
//
// ── UI 사운드 훅 (sound.js가 setUiSound로 주입 — uikit은 ctx 없이 저수준이라 함수 참조로 배선) ──
let _uiSnd=null;
export function setUiSound(fn){ _uiSnd=fn; }
const uiSnd=(ev)=>{ try{ _uiSnd&&_uiSnd(ev); }catch(_){} };

// ── 토큰 ──────────────────────────────────────────────────────────
export const UI = {
  font: "'Pretendard',system-ui,'Malgun Gothic',sans-serif",
  ink:'#f6efdd', text:'#ece3cf', sub:'#9fb2bd',
  bg:{ glass:'rgba(8,11,16,.72)', box:'rgba(10,14,20,.82)', deep:'rgba(5,7,11,.86)' },
  blur:'blur(7px)',
  radius:{ pill:'999px', lg:'12px', md:'8px', sm:'6px' },
  shadow:{
    text:'0 1px 3px #000',
    glow:'0 2px 9px #000,0 0 22px rgba(0,0,0,.85),0 0 3px rgba(0,0,0,.95)',
    drop:'0 14px 44px rgba(0,0,0,.5)',
  },
  // 역할색: ink=글자, line=강조선, glow=발광
  role:{
    gold : { ink:'#f3d978', line:'rgba(201,168,90,.9)',  glow:'rgba(240,207,128,.5)' },
    cyan : { ink:'#7fe0f0', line:'rgba(95,215,245,.9)',   glow:'rgba(110,225,250,.5)' },
    red  : { ink:'#ff6a58', line:'rgba(230,90,70,.9)',    glow:'rgba(240,90,70,.5)' },
    white: { ink:'#f6efdd', line:'rgba(255,255,255,.72)', glow:'rgba(255,255,255,.32)' },
  },
  gauge:{ hp:'#54d35a', stamina:'#f0a32e', mana:'#5aa8e0', xp:'#ecc962' },
};
const role = (k)=> UI.role[k] || UI.role.white;

// ── 스타일 1회 주입 ────────────────────────────────────────────────
function ensureCss(){
  if(document.getElementById('uikit-css')) return;
  const s=document.createElement('style'); s.id='uikit-css';
  s.textContent=`
  @keyframes uk-toast-in{from{opacity:0}to{opacity:1}}
  @keyframes uk-arr-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
  /* 토스트 = 엘든링식 가로 밴드(레퍼런스 토스트디자인1/2). 좌우 페이드 검정 오퍼시티 그라디언트 + 가운데 정렬 글자. 무테두리. */
  /* ★중앙정렬 transform은 클래스에 상시 고정(애니로 옮기면 fill 종료 시 정렬 깨짐) */
  .uk-toast{position:fixed;left:50%;top:13%;transform:translateX(-50%);z-index:40;pointer-events:none;
    display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;
    padding:11px 96px;font-family:${UI.font};transition:opacity .45s ease;}
  .uk-toast::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;   /* 가로 오퍼시티 그라디언트 밴드(양끝 페이드) */
    background:linear-gradient(90deg, transparent, rgba(3,4,7,.62) 26%, rgba(3,4,7,.62) 74%, transparent);}
  .uk-toast::after{content:'';position:absolute;left:15%;right:15%;bottom:3px;height:1px;   /* 은은한 밑선(엘든링 밴드) */
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.26),transparent);}
  .uk-toast .uk-spk{font:800 11px/1 ${UI.font};letter-spacing:.26em;text-transform:uppercase;opacity:.9;text-shadow:0 1px 3px #000;}
  .uk-toast .uk-body{white-space:nowrap;color:#f4efe2;font:600 clamp(17px,1.9vw,25px)/1.3 ${UI.font};letter-spacing:.02em;
    text-shadow:0 1px 4px rgba(0,0,0,.92);}
  .uk-toast .uk-arr{display:none;}
  /* 강조 토스트(ENEMY FELLED식): 화면 중앙 · 큰 골드 가운데정렬 · 넓은 밴드 · 밑선 없음 */
  .uk-toast.emph{top:43%;padding:18px 130px;gap:4px;}
  .uk-toast.emph::before{background:linear-gradient(90deg, transparent, rgba(2,2,4,.66) 18%, rgba(2,2,4,.66) 82%, transparent);}
  .uk-toast.emph::after{display:none;}
  .uk-toast.emph .uk-spk{font-size:12.5px;letter-spacing:.3em;}
  .uk-toast.emph .uk-body{font:800 clamp(30px,4vw,52px)/1.15 ${UI.font};letter-spacing:.05em;
    text-shadow:0 2px 12px rgba(0,0,0,.95),0 0 20px rgba(0,0,0,.55);}
  /* 키캡 = 발할라/엘든링식 둥근 사각 칩 */
  .uk-key{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;
    font:800 11px/1 ${UI.font};color:#e9eef2;background:rgba(18,22,28,.92);
    border:1px solid rgba(255,255,255,.22);border-radius:5px;box-shadow:0 1px 2px rgba(0,0,0,.6);
    letter-spacing:.02em;vertical-align:middle;}
  /* 나침반 = 발할라형 상단 가로 바: 양끝 페이드(무테두리) + 방위눈금 + 중앙 인디케이터 + 마커 */
  .uk-compass{position:fixed;top:16px;left:50%;transform:translateX(-50%);width:560px;height:54px;z-index:38;
    pointer-events:none;font-family:${UI.font};
    -webkit-mask:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);
            mask:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);}
  .uk-compass::after{content:'';position:absolute;left:0;right:0;bottom:16px;height:1px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.38),transparent);}
  .uk-compass .uk-cmp-track{position:absolute;left:0;right:0;bottom:0;height:36px;}
  .uk-compass .uk-cmp-tick{position:absolute;bottom:0;transform:translateX(-50%);text-align:center;}
  .uk-compass .uk-cmp-tick i{display:block;width:1px;height:8px;margin:0 auto;background:rgba(255,255,255,.42);}
  .uk-compass .uk-cmp-tick.maj i{height:12px;background:rgba(255,255,255,.72);}
  .uk-compass .uk-cmp-card{display:block;font:800 16.5px/1 ${UI.font};color:#f6efdd;
    text-shadow:0 1px 3px #000;margin-bottom:4px;letter-spacing:.05em;}
  .uk-compass .uk-cmp-card.gold{color:#f3d978;}
  .uk-compass .uk-cmp-ctr{position:absolute;left:50%;top:-3px;transform:translateX(-50%);width:0;height:0;
    border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #fff;
    filter:drop-shadow(0 1px 2px #000);z-index:2;}
  .uk-compass .uk-cmp-mk{position:absolute;left:0;right:0;top:0;height:20px;}
  .uk-compass .uk-cmp-mark{position:absolute;top:0;transform:translateX(-50%);text-align:center;text-shadow:0 1px 3px #000;}
  .uk-compass .uk-cmp-dia{display:block;font-size:13px;line-height:1;}
  .uk-compass .uk-cmp-dist{display:block;font:700 10px/1 ${UI.font};color:#dfe7ec;margin-top:1px;}
  /* 그로기 난타 콤보 카운터 — DMC/베요네타식: 한 타마다 scale-punch 상승 + 콤보↑ 색/크기 에스컬레이션 + 마무리 "N HIT!" */
  @keyframes uk-combo-pop{0%{transform:scale(1.45)}55%{transform:scale(.93)}100%{transform:scale(1)}}
  @keyframes uk-combo-fin{0%{transform:scale(1)}28%{transform:scale(1.55)}100%{transform:scale(1.22)}}
  .uk-combo{position:fixed;left:57%;top:40%;transform:translateX(-50%);z-index:41;pointer-events:none;font-family:${UI.font};
    opacity:0;transition:opacity .34s ease;text-align:center;user-select:none;}   /* ★가운데서 살짝 우측(몹 근처, 사령관) */
  .uk-combo .uk-combo-n{display:inline-flex;align-items:baseline;gap:.1em;font-weight:900;line-height:1;
    transform-origin:center center;will-change:transform;}
  .uk-combo .uk-combo-n .v{font-variant-numeric:tabular-nums;}
  .uk-combo .uk-combo-n .x{font-size:.42em;font-weight:800;letter-spacing:.14em;opacity:.9;}
  `;
  document.head.appendChild(s);
}

// ── toast(msg, opts) — 엘든링식 가로 밴드 캡션 ───────────────
//   opts: { accent:'gold'|'cyan'|'red'|'white', ms, speaker, emphasis }
//   emphasis:true = ENEMY FELLED式 화면 중앙 큰 골드/강조(레벨업·보스처치 등). 기본=상단 밴드(Limgrave式).
let _toastEl=null, _toastT=0;
export function toast(msg, opts={}){
  ensureCss();
  const { accent='white', ms=2800, speaker=null, emphasis=false } = opts;
  const r=role(accent);
  if(!_toastEl){
    _toastEl=document.createElement('div'); _toastEl.className='uk-toast';
    _toastEl.innerHTML='<div class="uk-spk"></div><div class="uk-body"></div><div class="uk-arr">▽</div>';
    document.body.appendChild(_toastEl);
  }
  _toastEl.classList.toggle('emph', !!emphasis);   // 강조/기본 전환
  const spk=_toastEl.querySelector('.uk-spk'),
        body=_toastEl.querySelector('.uk-body'),
        arr=_toastEl.querySelector('.uk-arr');
  spk.textContent=speaker||''; spk.style.display=speaker?'block':'none'; spk.style.color=r.ink;
  body.textContent=msg;
  body.style.color=emphasis ? r.ink : ((accent==='white')?'#f4efe2':r.ink);   // 강조=역할색 / 기본 흰=아이보리. 그림자는 CSS
  arr.style.display='none';
  _toastEl.style.opacity='1'; _toastEl.style.animation='uk-toast-in .4s ease';
  clearTimeout(_toastT); if(ms>0) _toastT=setTimeout(()=>{ _toastEl.style.opacity='0'; }, ms);
  return _toastEl;
}
export function hideToast(){ if(_toastEl) _toastEl.style.opacity='0'; }

// ── 그로기 난타 콤보 카운터 (comboHit/comboEnd) — DMC/베요네타식 랭크 ─────────
//   comboHit(n, opts): 한 타마다 호출. 카운트 n 표시 + scale-punch + 콤보↑ 색/크기 에스컬레이션.
//   comboEnd(n): 난타 종료 시 "N HIT!" 마무리 강조 후 페이드. opts.tierAt=[5,10,15](색·크기 단계).
let _comboEl=null, _comboHideT=0;
const _COMBO_COLS=['#f6efdd','#ffe08a','#ffd23a','#fff24a'];   // 흰→소프트골드→골드→밝은 황금노랑(사령관: 빨강 대신 광원 생긴 노랑). 고콤보=강한 발광(comboHit textShadow가 tier로 ↑)
function _comboRoot(){ ensureCss();
  if(!_comboEl){ _comboEl=document.createElement('div'); _comboEl.className='uk-combo';
    _comboEl.innerHTML='<div class="uk-combo-n"><span class="v">0</span><span class="x">HIT</span></div>';
    document.body.appendChild(_comboEl); }
  return _comboEl; }
function _comboTier(n, tiers){ let t=0; for(let i=0;i<tiers.length;i++) if(n>=tiers[i]) t=i+1; return Math.min(t,3); }
export function comboHit(n, opts={}){
  const tiers=opts.tierAt||[5,10,15]; const el=_comboRoot();
  const box=el.querySelector('.uk-combo-n'), v=el.querySelector('.v'), x=el.querySelector('.x');
  const t=_comboTier(n, tiers), col=_COMBO_COLS[t];
  v.textContent=n; x.textContent='HIT';
  box.style.color=col;
  box.style.fontSize=`clamp(${40+t*10}px, ${6+t*1.4}vw, ${74+t*16}px)`;
  box.style.textShadow=`0 2px 10px #000, 0 0 ${14+t*16}px ${col}, 0 0 ${5+t*7}px ${col}`;   // ★고콤보=강한 광원(이중 글로우)
  box.style.animation='none'; void box.offsetWidth; box.style.animation=`uk-combo-pop ${0.15+t*0.012}s ease-out`;
  el.style.opacity='1';
  clearTimeout(_comboHideT); _comboHideT=setTimeout(()=>{ el.style.opacity='0'; }, opts.endMs||900);
  uiSnd('combo');
}
export function comboEnd(n, opts={}){
  if(!_comboEl) return;
  // ★마무리 커짐/강조 제거(사령관 "강조하는 게 이상함") — 마지막 콤보 커진 상태 그대로 자연스럽게 페이드아웃.
  clearTimeout(_comboHideT); _comboHideT=setTimeout(()=>{ if(_comboEl) _comboEl.style.opacity='0'; }, 140);
}

// ── keycap(key) — 키 표시 칩(HUD·튜토·스킬바 공통). HTMLElement 반환 ──
export function keycap(key){
  ensureCss();
  const el=document.createElement('span'); el.className='uk-key'; el.textContent=key; return el;
}
export function keycapHtml(key){ return `<span class="uk-key">${key}</span>`; }

// ── keyhints(items, opts) — 우측 단축키 힌트 리스트(Palworld/발할라식: "라벨 [키캡]"). ──
//   items: [{label, key}]. 반환 { el, dispose, setVisible }. HUD 조작 안내 전용(디버그 패널 대체).
export function keyhints(items=[], { mount=document.body, pos='right:16px;top:238px' }={}){
  ensureCss();
  const el=document.createElement('div'); el.className='uk-keyhints';   // 게임오버 등에서 일괄 숨김용
  el.style.cssText=`position:fixed;${pos};z-index:24;display:flex;flex-direction:column;align-items:flex-end;gap:8px;`
    +`pointer-events:none;font-family:${UI.font}`;
  el.innerHTML=items.map(it=>`<div style="display:flex;align-items:center;gap:8px">`
    +`<span style="font:600 13px/1 ${UI.font};color:#e9e2cf;text-shadow:0 1px 3px #000,0 0 4px rgba(0,0,0,.6)">${it.label}</span>`
    +keycapHtml(it.key)+`</div>`).join('');
  mount.appendChild(el);
  return { el, dispose(){ el.remove(); }, setVisible(v){ el.style.display=v?'flex':'none'; } };
}

// ── nowPlaying({title,artist,note,ms}) — 데스스트랜딩식 우측 now-playing (BGM 전환 시 곡명 표시). ──
//   박스 없음 · 우측정렬 · 곡명("...")+아티스트(대문자)+label. 페이드 인/아웃. 단일 엘리먼트 재사용.
let _npEl=null, _npT=0, _npLb=null;
function ensureNpCss(){
  if(document.getElementById('uikit-np-css')) return;
  const s=document.createElement('style'); s.id='uikit-np-css';
  s.textContent=`
  @keyframes uk-np-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  #uk-np{position:fixed;left:5%;top:41%;z-index:36;pointer-events:none;text-align:left;max-width:42vw;
    font-family:${UI.font};opacity:0;transition:opacity 1.1s ease;text-shadow:0 1px 5px rgba(0,0,0,.75),0 0 12px rgba(0,0,0,.45);}
  #uk-np .uk-np-title{color:#f5f6f7;font:500 clamp(23px,2.1vw,32px)/1.32 ${UI.font};letter-spacing:.01em;}
  #uk-np .uk-np-artist{color:rgba(242,244,247,.85);font:600 clamp(14px,1.15vw,17px)/1.5 ${UI.font};
    letter-spacing:.16em;text-transform:uppercase;margin-top:4px;}
  #uk-np .uk-np-note{color:rgba(228,231,235,.52);font:400 italic clamp(11px,.9vw,13px)/1.5 ${UI.font};
    letter-spacing:.03em;margin-top:3px;}
  /* ★시네마틱 레터박스 — 곡 뜰 때 위아래 검정 바 슬라이드인(항해 시네마틱 느낌) */
  #uk-np-lb i{position:fixed;left:0;right:0;height:8.5vh;background:#000;z-index:35;pointer-events:none;
    transition:transform 1.3s cubic-bezier(.4,0,.2,1);}
  #uk-np-lb i.t{top:0;transform:translateY(-101%);}
  #uk-np-lb i.b{bottom:0;transform:translateY(101%);}
  #uk-np-lb.on i.t,#uk-np-lb.on i.b{transform:translateY(0);}`;
  document.head.appendChild(s);
}
function _npLetterbox(show){
  if(!_npLb){ _npLb=document.createElement('div'); _npLb.id='uk-np-lb';
    _npLb.innerHTML='<i class="t"></i><i class="b"></i>'; document.body.appendChild(_npLb); }
  _npLb.classList.toggle('on', !!show);
}
export function nowPlaying({ title='', artist='', note='', ms=6500, cinematic=true }={}){
  ensureNpCss();
  if(!_npEl){ _npEl=document.createElement('div'); _npEl.id='uk-np';
    _npEl.innerHTML='<div class="uk-np-title"></div><div class="uk-np-artist"></div><div class="uk-np-note"></div>';
    document.body.appendChild(_npEl); }
  _npEl.querySelector('.uk-np-title').textContent = title ? `“${title}”` : '';
  const ar=_npEl.querySelector('.uk-np-artist'); ar.textContent=artist; ar.style.display=artist?'block':'none';
  const nt=_npEl.querySelector('.uk-np-note'); nt.textContent=note; nt.style.display=note?'block':'none';
  _npEl.style.animation='uk-np-in 1.1s ease'; _npEl.style.opacity='1';
  if(cinematic) _npLetterbox(true);   // 위아래 검정 바 슬라이드인
  clearTimeout(_npT); if(ms>0) _npT=setTimeout(()=>{ hideNowPlaying(); }, ms);
  return _npEl;
}
export function hideNowPlaying(){ if(_npEl) _npEl.style.opacity='0'; _npLetterbox(false); }

// ── compass({getHeading,getMarkers,mount}) — 발할라형 상단 나침반 바 ──
//   getHeading: ()=>deg (0=N, 시계방향 E=90)  — 보통 카메라 월드방위.
//   getMarkers: ()=>[{bearing, dist, accent, label}]  — 목표 방위(deg)·거리(표시문자열).
//   반환: { el, dispose(), setVisible(v) }. 자체 rAF로 매프레임 갱신(ctx 비의존).
const CMP={ W:560, SPAN:160 };   // 바 폭(px) / 보이는 방위 범위(±80°)
const BEAR8=[['N',0,'gold'],['NE',45,''],['E',90,''],['SE',135,''],['S',180,''],['SW',225,''],['W',270,''],['NW',315,'']];
function angDiff(b,h){ let d=b-h; return ((d+540)%360)-180; }   // [-180,180]
let _cmpSingleton = null;   // ★상단 나침반은 하나만(사령관 2026-07-10 "동서남북 2개가 뜸")
export function compass({ getHeading, getMarkers=()=>[], mount=document.body }={}){
  ensureCss();
  // ★싱글톤: combat/questline/contract가 각자 바를 만들어 3개가 겹쳐 방위 라벨이 중복됐음. 첫 호출만 실제 바를
  //   만들고, 이후 호출은 마커 소스(getMarkers)만 공유 바에 얹는다. heading은 첫 것(전부 카메라기준이라 동일).
  if(_cmpSingleton){
    // 비오너: 마커 소스만 공유 바에 얹는다. setVisible은 "내 마커 소스"만 껐다 켠다 — 공유 root를 건드리지 않음.
    //   (contract가 부팅 직후 setVisible(false)로 공유 바 전체를 꺼 방위가 통째로 사라지던 버그 차단.)
    const item={ getMarkers, active:true };
    _cmpSingleton.srcs.push(item);
    return { el:_cmpSingleton.root,
      dispose(){ const i=_cmpSingleton.srcs.indexOf(item); if(i>=0) _cmpSingleton.srcs.splice(i,1); },
      setVisible(v){ item.active=!!v; } };
  }
  const root=document.createElement('div'); root.className='uk-compass';
  root.innerHTML='<div class="uk-cmp-ctr"></div><div class="uk-cmp-track"></div><div class="uk-cmp-mk"></div>';
  mount.appendChild(root);
  const srcs=[{ getMarkers, active:true }];   // 여러 모듈이 공유하는 마커 소스 목록({소스,활성})
  const track=root.querySelector('.uk-cmp-track'), mk=root.querySelector('.uk-cmp-mk');
  // 눈금 1회 생성: 15° 간격, 8주요방위는 글자
  const ticks=[];
  for(let a=0;a<360;a+=15){
    const maj=BEAR8.find(b=>b[1]===a);
    const el=document.createElement('div'); el.className='uk-cmp-tick'+(maj?' maj':'');
    el.innerHTML = maj ? `<span class="uk-cmp-card${maj[2]?' '+maj[2]:''}">${maj[0]}</span>` : '<i></i>';
    track.appendChild(el); ticks.push({a,el});
  }
  // ⚡ 마커 엘리먼트 풀 — 기존엔 매 프레임 mk.innerHTML 문자열 재구성+파싱(DOM 재생성). 재사용으로 전환.
  const _mkEls=[];
  function _newMk(){ const el=document.createElement('div'); el.className='uk-cmp-mark';
    el.innerHTML='<span class="uk-cmp-dia">◆</span><span class="uk-cmp-dist"></span>';
    el._dist=el.querySelector('.uk-cmp-dist'); mk.appendChild(el); _mkEls.push(el); return el; }
  function update(){
    const h=(getHeading&&getHeading())||0;
    for(const t of ticks){
      const d=angDiff(t.a,h);
      if(Math.abs(d)<=CMP.SPAN/2){ t.el.style.display='block';
        t.el.style.left=(CMP.W/2 + d*(CMP.W/CMP.SPAN))+'px';
        t.el.style.opacity=String(Math.max(.2, 1-Math.abs(d)/(CMP.SPAN*0.62))); }
      else t.el.style.display='none';
    }
    let n=0;
    for(const src of srcs){ if(src.active===false) continue;
      let list; try{ list=src.getMarkers()||[]; }catch(_){ list=[]; }
      for(const m of list){
        const d=angDiff(m.bearing,h); if(Math.abs(d)>CMP.SPAN/2) continue;
        const x=CMP.W/2 + d*(CMP.W/CMP.SPAN), r=role(m.accent||'cyan');
        const el=_mkEls[n]||_newMk(); n++;
        el.style.display=''; el.style.left=x+'px'; el.style.color=r.ink;
        if(m.dist!=null){ el._dist.style.display='';
          const ds=String(m.dist); if(el._dist.textContent!==ds) el._dist.textContent=ds; }
        else el._dist.style.display='none';
      }
    }
    for(let i=n;i<_mkEls.length;i++) _mkEls[i].style.display='none';
  }
  // ⚡ 숨김 시 rAF 정지 — 기존엔 setVisible(false)여도 루프가 계속 돌며 전 DOM 쓰기 실행.
  let raf=0, _vis=true;
  function _loop(){ update(); raf=requestAnimationFrame(_loop); }
  raf=requestAnimationFrame(_loop);
  const _setVisible=(v)=>{ v=!!v; if(v===_vis) return; _vis=v; root.style.display=v?'block':'none';
    if(v){ if(!raf) raf=requestAnimationFrame(_loop); }
    else { cancelAnimationFrame(raf); raf=0; } };
  _cmpSingleton = { root, srcs, setVisible:_setVisible };
  return { el:root,
    dispose(){ cancelAnimationFrame(raf); raf=0; root.remove(); if(_cmpSingleton && _cmpSingleton.root===root) _cmpSingleton=null; },
    setVisible:_setVisible };
}

// ── gauge({label, icon, accent, value, max, width, mount}) — 발할라형 가로 게이지 바 ──
//   icon:'ship' → 잔여율에 따라 기울고 침수되는 배 실루엣(내구도용). accent: UI.gauge 키(hp/stamina/mana/xp) 또는 hex.
//   반환: { el, set(v), setMax(m), dispose() }. el에 .show 클래스 토글로 페이드 인/아웃.
function ensureGaugeCss(){
  if(document.getElementById('uikit-gauge-css')) return;
  const s=document.createElement('style'); s.id='uikit-gauge-css';
  s.textContent=`
  .uk-gauge{position:fixed;z-index:39;display:flex;align-items:center;gap:10px;pointer-events:none;
    font-family:${UI.font};opacity:0;transition:opacity .5s ease;}
  .uk-gauge.show{opacity:1;}
  .uk-g-ship{position:relative;width:32px;height:28px;overflow:hidden;flex:none;
    filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));}
  .uk-g-ship svg{position:absolute;left:50%;bottom:3px;width:28px;height:23px;
    transform-origin:50% 86%;transform:translateX(-50%);transition:transform .35s ease;}
  .uk-g-ship svg path,.uk-g-ship svg rect{fill:#e3ebf0;}
  .uk-g-water{position:absolute;left:0;right:0;bottom:0;height:0;
    background:linear-gradient(180deg,rgba(120,185,235,.5),rgba(40,92,142,.82));
    box-shadow:inset 0 1px 0 rgba(180,220,250,.6);transition:height .35s ease;}
  .uk-g-col{display:flex;flex-direction:column;gap:4px;}
  .uk-g-label{font:800 10px/1 ${UI.font};letter-spacing:.15em;text-transform:uppercase;
    color:#cfd8de;text-shadow:${UI.shadow.text};}
  .uk-g-bar{position:relative;width:var(--ukw,200px);height:8px;border-radius:999px;
    background:rgba(8,11,16,.72);box-shadow:inset 0 0 0 1px rgba(0,0,0,.4);overflow:hidden;}
  .uk-g-fill{height:100%;width:100%;border-radius:999px;
    box-shadow:0 0 8px -1px currentColor;transition:width .3s ease,background-color .3s ease;}
  .uk-g-num{font:800 11px/1 ${UI.font};color:#e7eef3;text-shadow:${UI.shadow.text};margin-left:2px;align-self:flex-end;}
  /* 위험(낮음) = 적색 정적(깜빡임은 화면 전체 데미지 플래시로 — 피격 비네트). */
  .uk-gauge.low .uk-g-fill{box-shadow:0 0 10px 0 #ff5142;}
  .uk-gauge.low .uk-g-label{color:#ff6a58;}
  .uk-gauge.low .uk-g-ship svg path,.uk-gauge.low .uk-g-ship svg rect{fill:#ff8a78;}
  `;
  document.head.appendChild(s);
}
const SHIP_SVG='<svg viewBox="0 0 28 24"><path d="M3 15 L25 15 L21.5 20.5 L6.5 20.5 Z"/><rect x="13.2" y="3.5" width="1.5" height="12.5"/><path d="M15 4.5 L22.5 15 L15 15 Z"/></svg>';
export function gauge({ label='', icon=null, accent='hp', value=100, max=100, width=200,
                       pos='left:24px;bottom:66px', mount=document.body }={}){
  ensureCss(); ensureGaugeCss();
  const baseCol = UI.gauge[accent] || (typeof accent==='string' && accent[0]==='#' ? accent : UI.gauge.hp);
  const root=document.createElement('div'); root.className='uk-gauge'; root.style.cssText=pos;
  root.innerHTML =
    (icon==='ship' ? `<div class="uk-g-ship">${SHIP_SVG}<div class="uk-g-water"></div></div>` : '')
    + `<div class="uk-g-col"><div class="uk-g-label">${label}</div>`
    + `<div style="display:flex;align-items:center;gap:7px"><div class="uk-g-bar" style="--ukw:${width}px"><div class="uk-g-fill"></div></div><span class="uk-g-num"></span></div></div>`;
  mount.appendChild(root);
  const fill=root.querySelector('.uk-g-fill'), num=root.querySelector('.uk-g-num');
  const svg=root.querySelector('.uk-g-ship svg'), water=root.querySelector('.uk-g-water');
  let _max=max;
  function set(v){
    const val=Math.max(0,Math.min(_max,v)), r=_max>0?val/_max:0;
    fill.style.width=(r*100).toFixed(1)+'%';
    const low = r < 0.4;
    fill.style.backgroundColor = low ? UI.role.red.ink : baseCol;   // 낮으면 적색 경고
    root.classList.toggle('low', low);
    if(low) root.style.setProperty('--blink', (0.28 + r*0.95).toFixed(2)+'s');   // 0에 가까울수록 빠른 깜빡임(다급)
    if(num) num.textContent=Math.round(val);
    if(svg){ const tilt=(1-r)*32, sink=(1-r)*7;
      svg.style.transform=`translateX(-50%) rotate(${tilt}deg) translateY(${sink}px)`; }
    if(water) water.style.height=((1-r)*72).toFixed(0)+'%';   // 잔여 낮을수록 침수 상승
  }
  set(value);
  return { el:root, set, setMax(m){ _max=m; }, dispose(){ root.remove(); } };
}

// ── dialog({lines, speaker, accent, hint, onLine, onDone}) — 젤다(BoTW)형 대화창 (레퍼런스: ref/디자인시스템1.jpg) ──
//   캡슐 다크박스 + 화자명(흰색, 박스 위 좌측) + 흰 볼드 이탤릭 중앙 텍스트 + ▽(아래 중앙) + 양끝 ‹ › 장식. 클릭 진행(타이핑 중 클릭=즉시완성).
function ensureDialogCss(){
  if(document.getElementById('uikit-dialog-css')) return;
  const s=document.createElement('style'); s.id='uikit-dialog-css';
  s.textContent=`
  .uk-dialog{position:fixed;left:0;right:0;bottom:14vh;z-index:600;display:flex;justify-content:center;
    pointer-events:auto;cursor:pointer;font-family:${UI.font};opacity:0;transition:opacity .45s ease;}
  .uk-dialog.show{opacity:1;}
  .uk-dlg-box{position:relative;width:min(760px,82vw);padding:21px 74px;text-align:center;
    background:linear-gradient(180deg,rgba(28,36,30,.8),rgba(13,19,16,.9));border-radius:999px;
    box-shadow:0 14px 44px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.16),inset 0 0 46px rgba(0,0,0,.34);}
  .uk-dlg-box::before{content:'‹';position:absolute;left:30px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.34);font:400 24px/1 serif;}
  .uk-dlg-box::after{content:'›';position:absolute;right:30px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.34);font:400 24px/1 serif;}
  .uk-dlg-spk{position:absolute;left:9%;top:-24px;font:600 16px/1 ${UI.font};color:#fff;text-shadow:0 2px 7px #000;letter-spacing:.01em;}
  .uk-dlg-tx{color:#fff;font:800 italic clamp(18px,2vw,27px)/1.35 ${UI.font};text-shadow:0 2px 9px rgba(0,0,0,.78);min-height:30px;}
  .uk-dlg-arr{position:absolute;left:50%;bottom:-19px;transform:translateX(-50%);font-size:15px;color:#fff;opacity:.85;animation:uk-arr-bob 1.1s ease-in-out infinite;}
  `;
  document.head.appendChild(s);
}
// ★advanceKey='KeyE' 지정 = 클릭 대신 키로 넘기는 대화창(2026-07-16 사령관 확정).
//   포인터락을 안 풀어 전투 중에도 안전 — 좌클릭=공격과 겹치는 곳(던전 상자 등)은 반드시 이 방식.
//   미지정 시 기존 클릭 방식 그대로(오프닝 대사 등 컷신용) — 호출부 무영향.
export function dialog({ lines=[], speaker='', accent='gold', hint='', advanceKey='', onLine=null, onDone=null, mount=document.body }={}){
  ensureCss(); ensureDialogCss();
  const r=role(accent);
  const el=document.createElement('div'); el.className='uk-dialog';
  const arr = advanceKey ? keycapHtml(hint || advanceKey.replace(/^(Key|Digit)/,'')) : '▽';
  el.innerHTML=`<div class="uk-dlg-box">${speaker?'<div class="uk-dlg-spk"></div>':''}<div class="uk-dlg-tx"></div><div class="uk-dlg-arr">${arr}</div></div>`;
  mount.appendChild(el);
  const spk=el.querySelector('.uk-dlg-spk'), tx=el.querySelector('.uk-dlg-tx');
  if(spk){ spk.textContent=speaker; }   // 화자명 = 흰색 고정(젤다 레퍼런스)
  requestAnimationFrame(()=>el.classList.add('show'));
  let i=-1, busy=false, _iv=0, _kh=null;
  function type(str){ tx.textContent=''; busy=true; let k=0; clearInterval(_iv);
    _iv=setInterval(()=>{ tx.textContent=str.slice(0,++k); if(k>=str.length){ clearInterval(_iv); busy=false; } }, 30); }
  function advance(){
    if(busy){ clearInterval(_iv); tx.textContent=lines[i]; busy=false; return; }   // 타이핑 중 클릭 = 즉시 완성
    i++;
    if(i>=lines.length){ dispose(); try{ onDone&&onDone(); }catch(_){} return; }
    type(lines[i]); try{ onLine&&onLine(i); }catch(_){}
  }
  function dispose(){ clearInterval(_iv); if(_kh){ removeEventListener('keydown',_kh); _kh=null; }   // ★키 리스너 누수 방지
    el.classList.remove('show'); setTimeout(()=>el.remove(),400); }
  if(advanceKey){
    el.style.pointerEvents='none'; el.style.cursor='default';   // 좌클릭(공격)이 대화창에 안 먹히게
    _kh = e=>{ if(e.code!==advanceKey || e.repeat) return; advance(); };   // repeat=꾹 누름 무시(한 번 눌러 한 줄)
    addEventListener('keydown', _kh);
  } else el.addEventListener('click', advance);
  advance();
  return { el, advance, dispose };
}

// ── locationReveal({name, band}) — WoW/발할라식 지역 진입 배너 (레퍼런스: ref/화면/공고토스트.jpg) ──
//   ★발할라 구조: 위 = 띠(밴드, 양끝 뾰족) 안에 소형 해역/Arc 라벨 / 아래 = 큰 흰 세리프 지역명. 4.4s 페이드.
let _locEl=null;
function ensureLocCss(){
  if(document.getElementById('uikit-loc-css')) return;
  const s=document.createElement('style'); s.id='uikit-loc-css';
  s.textContent=`
  @font-face{ font-family:'ChosunNm'; src:url('/tomob-deploy/ChosunNm.ttf') format('truetype'); font-display:swap; }
  @keyframes uk-loc-in{0%{opacity:0;transform:translateY(-16px)}14%{opacity:1;transform:none}78%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-8px)}}
  @keyframes uk-loc-name{0%{letter-spacing:.5em}16%{letter-spacing:.04em}100%{letter-spacing:.04em}}
  #uk-loc{position:fixed;top:17vh;left:0;right:0;text-align:center;z-index:604;pointer-events:none;opacity:0;
    font-family:'Pretendard',system-ui,sans-serif;}
  #uk-loc.show{animation:uk-loc-in 4.4s ease both;}
  /* 위 띠(밴드) — 양끝 뾰족, 다크 반투명 + 위아래 흰 가는선 + 소형 라벨 */
  #uk-loc .zband{display:inline-block;font-family:'Pretendard',system-ui,sans-serif;
    font-size:clamp(12px,1.15vw,16px);font-weight:700;letter-spacing:.42em;text-transform:uppercase;color:#f1ece0;
    padding:8px 46px;margin-bottom:18px;text-shadow:0 1px 6px rgba(0,0,0,.85);
    background:linear-gradient(180deg,rgba(16,18,22,.4),rgba(8,10,14,.66));
    border-top:1px solid rgba(255,255,255,.36);border-bottom:1px solid rgba(255,255,255,.36);
    clip-path:polygon(0 0,100% 0,calc(100% - 16px) 50%,100% 100%,0 100%,16px 50%);}
  /* 아래 큰 지역명 — 흰 세리프, 크게 */
  #uk-loc .zn{font-size:clamp(48px,7vw,92px);font-weight:800;color:#fff;line-height:1.04;
    text-shadow:0 3px 36px rgba(0,0,0,.9),0 0 24px rgba(255,255,255,.24);}
  #uk-loc.show .zn{animation:uk-loc-name 4.4s ease both;}
  `;
  document.head.appendChild(s);
}
export function locationReveal({ name='', band='', sub='' }={}){
  ensureLocCss();
  if(!_locEl){ _locEl=document.createElement('div'); _locEl.id='uk-loc';
    _locEl.innerHTML='<div class="zband"></div><div class="zn"></div>';
    document.body.appendChild(_locEl); }
  const b=band||sub||'';
  const $b=_locEl.querySelector('.zband'); $b.textContent=b; $b.style.display=b?'inline-block':'none';
  _locEl.querySelector('.zn').textContent=name;
  _locEl.classList.remove('show'); void _locEl.offsetWidth;   // 리플로우 → 애니 재시작(재진입 시)
  _locEl.classList.add('show');
  return _locEl;
}

// ── panel — 게임 공통 패널 골격 (정본 톤: invui 인벤 + navmap 맵에서 추출) ──
//   레시피: 뒤 게임화면 블러 + 다크 네이비 반투명 그라디언트 + 옅은 역할색 테두리
//     + 상단 역할색 헤어라인 글로우 + 드롭섀도/내부 비네트 + 역할색 헤딩(좌측 바).
//   accent: 'gold'(재화/인벤·제작) · 'cyan'(맵/항해/정보) · 'red'(전투). 역할색만 스왑.
//   ★"두꺼운 박스=웹사이트감"의 반례 — 테두리는 .3 알파로 옅게, 배경은 블러 위 반투명.
const PANEL={   // 역할별 패널 톤 (invui 골드 · navmap 시안 실측값)
  gold:{ border:'rgba(201,168,90,.30)', hair:'rgba(240,207,128,.62)', head:'#f3e8ca', accent:'#f3d978' },
  cyan:{ border:'rgba(84,170,205,.34)', hair:'rgba(95,215,245,.72)',  head:'#eaf4ff', accent:'#8fe0f0' },
  red :{ border:'rgba(226,96,78,.34)',  hair:'rgba(240,120,100,.66)', head:'#f6e3dd', accent:'#ff8a78' },
};
function ensurePanelCss(){
  if(document.getElementById('uikit-panel-css')) return;
  const s=document.createElement('style'); s.id='uikit-panel-css';
  let acc='';
  for(const k in PANEL){ const p=PANEL[k];
    acc+=`.uk-panel.${k}{border-color:${p.border};}
    .uk-panel.${k}::before{background:linear-gradient(90deg,transparent,${p.hair},transparent);}
    .uk-panel.${k} .uk-p-title{color:${p.head};border-left-color:${p.accent};}
    .uk-panel.${k} .uk-p-title .uk-p-sub{color:${p.accent};}\n`;
  }
  s.textContent=`
  /* 전체화면 스크림 = 뒤 게임화면 블러(모달 패널 배경). invui #inventory 레시피 */
  .uk-scrim{position:fixed;inset:0;z-index:75;display:none;align-items:center;justify-content:center;
    background:rgba(6,11,18,.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    font-family:${UI.font};color:${UI.text};}
  .uk-scrim.show{display:flex;}
  /* 패널 카드 = 다크 네이비 반투명 그라디언트 + 옅은 역할색 테두리 + 상단 헤어라인 + 비네트 */
  .uk-panel{position:relative;background:linear-gradient(168deg,rgba(12,20,30,.82),rgba(6,12,20,.9));
    border:1px solid rgba(201,168,90,.30);border-radius:14px;overflow:hidden;
    backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    box-shadow:0 16px 48px rgba(0,0,0,.5),inset 0 1px 0 rgba(160,205,240,.12),inset 0 0 46px rgba(0,0,0,.32);
    font-family:${UI.font};color:${UI.text};}
  .uk-panel::before{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(240,207,128,.62),transparent);pointer-events:none;}
  /* 헤더 = 역할색 헤딩(좌측 강조 바) + 우측 슬롯 */
  .uk-panel .uk-p-hd{display:flex;align-items:center;justify-content:space-between;gap:18px;
    padding:16px 20px 13px;}
  .uk-panel .uk-p-title{font:800 19px/1.1 ${UI.font};letter-spacing:.18em;color:#f3e8ca;
    padding-left:12px;border-left:3px solid #f3d978;text-shadow:0 2px 8px #000;}
  .uk-panel .uk-p-title .uk-p-sub{display:block;font:600 11px/1.3 ${UI.font};letter-spacing:.05em;
    margin-top:4px;opacity:.85;border:0;}
  .uk-panel .uk-p-hdr{display:flex;align-items:center;gap:14px;}
  .uk-panel .uk-p-x{width:32px;height:32px;flex:none;display:flex;align-items:center;justify-content:center;
    color:#d9c89a;cursor:pointer;font-size:18px;line-height:1;border-radius:8px;
    background:rgba(8,14,22,.5);border:1px solid rgba(201,168,90,.28);text-shadow:0 1px 3px #000;transition:.12s;}
  .uk-panel .uk-p-x:hover{color:#ffe28a;border-color:rgba(201,168,90,.6);}
  .uk-panel .uk-p-body{padding:4px 20px 20px;}
  /* 액션 버튼 = 골드 그라디언트(invui craftBtn 정본) */
  .uk-btn{padding:12px 18px;background:linear-gradient(180deg,#ecc962,#a9842f);color:#241a06;
    border:1px solid #ffe9a3;border-radius:9px;cursor:pointer;font:800 15px/1 ${UI.font};letter-spacing:.04em;
    transition:filter .12s;}
  .uk-btn:hover{filter:brightness(1.12);}
  .uk-btn:disabled{background:rgba(70,76,84,.5);border-color:rgba(150,150,150,.25);color:#8b8b8b;cursor:not-allowed;}
  .uk-btn.ghost{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.14);color:#dfe7ec;}
  .uk-btn.ghost:hover{background:rgba(255,255,255,.1);filter:none;}
  ${acc}`;
  document.head.appendChild(s);
}
// panel({accent, title, sub, closable, wide, scrim, mount}) → { el, body, scrimEl, setTitle, show, hide, remove }
//   scrim:true → 전체화면 블러 배경 안에 중앙 배치(모달). scrim:false → el만 반환(HUD/도킹 직접 배치).
export function panel({ accent='gold', title='', sub='', closable=true, width='min(880px,92vw)',
                        scrim=false, onClose=null, mount=document.body }={}){
  ensureCss(); ensurePanelCss();
  const card=document.createElement('div'); card.className='uk-panel '+(PANEL[accent]?accent:'gold');
  card.style.width=width;
  card.innerHTML =
    `<div class="uk-p-hd"><div class="uk-p-title">${title}${sub?`<span class="uk-p-sub">${sub}</span>`:''}</div>`
    + `<div class="uk-p-hdr">${closable?'<div class="uk-p-x">✕</div>':''}</div></div>`
    + `<div class="uk-p-body"></div>`;
  const body=card.querySelector('.uk-p-body');
  let scrimEl=null;
  if(scrim){ scrimEl=document.createElement('div'); scrimEl.className='uk-scrim'; scrimEl.appendChild(card); mount.appendChild(scrimEl);
    scrimEl.addEventListener('click',e=>{ if(e.target===scrimEl) hide(); }); }
  else mount.appendChild(card);
  function show(){ if(scrimEl) scrimEl.classList.add('show'); else card.style.display=''; uiSnd('ui_click'); return api; }   // 패널 열기음
  function hide(){ if(scrimEl) scrimEl.classList.remove('show'); else card.style.display='none'; uiSnd('fall'); try{ onClose&&onClose(); }catch(_){} return api; }   // 닫기(X/스크림)음
  function remove(){ (scrimEl||card).remove(); }
  const x=card.querySelector('.uk-p-x'); if(x) x.onclick=hide;
  const api={ el:card, body, scrimEl, show, hide, remove,
    setTitle(t,s){ const el=card.querySelector('.uk-p-title'); el.innerHTML=t+(s?`<span class="uk-p-sub">${s}</span>`:''); } };
  return api;
}
// panelCss() — 기존 모듈이 클래스만 빌려쓰도록 CSS 주입(엘리먼트는 각자 관리). 반환: PANEL 톤 맵.
export function panelCss(){ ensureCss(); ensurePanelCss(); return PANEL; }

// ── 골격(다음 단계) ── mapMarker()= 맵 벡터 섬 마커. 3차.
