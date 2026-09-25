// combat.js — 전투 코어. 플레이어 HP + 근접 공격(히트판정) + 몬스터 피격 데미지 + HP HUD.
//   monsters.js 연동: 좌클릭 근접공격 → 카메라 정면 부채꼴 내 몬스터 hp 차감/처치(mn.kill).
//   몬스터 attack 시 monsters.js가 ctx.combat.hitPlayer(dmg) 호출 → 플레이어 피격.
//   ?sys=combat (보통 ?sys=...,monsters,combat 같이).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initSkillBar } from '/tomob-deploy/modules/skillbar.js';   // 우측 직업 스킬바(combat과 함께 로드)
import { SOUL_PTS } from '/tomob-deploy/modules/_soulpts.js';        // firelings 굽기 좌표(영혼 드롭 파티클)
import { UI, keycapHtml, keycap, compass as ukCompass, keyhints as ukKeyhints, toast } from '/tomob-deploy/modules/uikit.js';   // ★디자인 시스템 토큰 + 나침반 + 단축키힌트 + 토스트
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (레벨 성장·플레이어 스탯)

const KW='/tomob-deploy/KayKit_Adventurers_2.0_FREE/Assets/gltf/';
// 원거리 화살 설정(활/석궁) — 모델·속도·데미지·사거리. [수치 제안]
const ARROW = {
  bow:      { model:KW+'arrow_bow.gltf',      ...BAL.ranged.bow,      scale:1 },
  crossbow: { model:KW+'arrow_crossbow.gltf', ...BAL.ranged.crossbow, scale:1 },
};
const ARROW_HIT = BAL.ranged.arrowHit;    // 명중 반경(m)
const ARROW_GRAV = BAL.ranged.arrowGrav;  // 중력 계수(포물선 드롭)

// ★밸런스 상수 = balance.js(BAL) 단일 소스. 여기선 별칭만. (maxHp·ATK_DMG=25 폐지: HP는 클래스+레벨 가변, 근접뎀=무기별)
const ATK_REACH = BAL.player.atkReach;    // 근접 사거리(m)
const ATK_DOT   = BAL.player.atkDot;      // 정면 부채꼴(±72°)
const ATK_CD    = BAL.player.atkCd;       // 공격 쿨다운(s)
const REGEN     = BAL.player.regen;       // 초당 HP 재생(피격 후 REGEN_DELAY 경과 시)
const REGEN_DELAY = BAL.player.regenDelay;// 피격 후 재생 시작까지(s)
const RESPAWN_T = BAL.player.respawn;      // 사망 후 부활까지(s)
const STAM_MAX = BAL.player.stamMax, STAM_REGEN = BAL.player.stamRegen, STAM_DELAY = BAL.player.stamDelay;

export function initCombat(ctx){
  const { scene, camera } = ctx;
  ctx.balance = BAL;   // ⚖️ 런타임 튜닝/디버그 노출 — 콘솔서 __ctx.balance로 전 밸런스 접근
  // ★테스트 모드: sandbox에선 기본 ON(플레이어 무적 + 몬스터 체력 ×배). game.html 본편은 OFF.
  //   ★토글 = Ctrl+Shift+K (사령관 버그: 기존 K단독이 배 건조[shipyard]·드래곤소환과 충돌 → 배 건조하려다 testMode 켜져 J비행·땅뚫림). 디버그 조합으로 격리.
  if(window.__testMode===undefined) window.__testMode = (location.pathname||'').includes('sandbox');
  if(typeof window!=='undefined') addEventListener('keydown', e=>{ if(e.code==='KeyK' && e.ctrlKey && e.shiftKey){ window.__testMode=!window.__testMode;
    for(const m of (ctx.monsters||[])) if(!m.dead) m.hp=(m.def?.hp||12)*(window.__testMode?12:1);
    console.log('[combat] 테스트모드(무적+몹체력) =', window.__testMode); } });
  // ── 클래스/레벨 성장 (BAL.level) — ?char=로 클래스 결정, 레벨업이 최대HP·공격을 실제로 올린다 ──
  const _cls = (typeof location!=='undefined' && new URLSearchParams(location.search).get('char') || '').toLowerCase();
  let level = 1, xp = 0, xpMax = BAL.level.xpForNext(1);   // ★레벨/경험치 — 파란 분절바(ref/hud). 처치로 획득.
  let maxHp = BAL.level.hpAt(_cls, level);                 // ★클래스+레벨 가변 최대HP (고정 100 폐지)
  const atkMul = () => BAL.level.atkMul(_cls, level);      // ★플레이어 공격 배수(레벨·클래스) → damageMonster에 일괄 곱
  let hp = maxHp, atkCD = 0, hurtFlash = 0, regenWait = 0;
  let guardCharge = 0; const GUARD_MAX = BAL.player.guardMax;   // ★기사 방패충격파 게이지 — 가드로 막을 때 충전, 꽉 차면 Q로 발동
  let _blockSndT = 0;   // 막기음 throttle(연사 방지)
  let _missSndT = 0;    // 미스음 throttle(연사 방지)
  let _hurtSndT = 0;    // 피격 기합 throttle(연타 방지)
  let soul = 0;   // 토모브의 영혼 — 몬스터 처치 드롭, 선원 NPC 버프에 사용 (§6-A)
  let stamina = STAM_MAX, stamWait = 0, _exhausted = false;   // 스태미나(공격·스프린트 소모). _exhausted=0되면 100%까지 잠금(엘든링식)
  let dead = false, respawnT = 0;
  const _fwd = new THREE.Vector3(), _to = new THREE.Vector3();
  const _spawn = new THREE.Vector3();
  let spawnSet = false;

  // ─────── HUD (좌하단) — 레이아웃=ref/hud/체력바.png(하트+바+체인+다이얼, 초상화 없음) / 색=DS 톤 ───────

  // ★ref/hud/체력바.png 정확 재현: 평평한 사각바 + 흰 SVG 아이콘 + 컬러 바늘 게이지 + 초승달+차오르는 링.
  const _hudCss = document.createElement('style'); _hudCss.id='_cbhud-css'; _hudCss.textContent=`
    #_cbhud{position:fixed;left:18px;bottom:16px;z-index:25;display:flex;align-items:center;gap:12px;
      pointer-events:none;font-family:${UI.font};transform:scale(.98);transform-origin:left bottom}
    #_cbhud .cb-bars{display:flex;flex-direction:column;gap:5px;width:224px}
    #_cbhud .cb-row{display:flex;align-items:center;gap:7px}
    #_cbhud .cb-ic{width:18px;height:18px;flex:none;display:flex;align-items:center;justify-content:center;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,.75))}
    #_cbhud .cb-lv{width:18px;flex:none;text-align:center;font:800 11px/1 ${UI.font};
      color:${UI.role.cyan.ink};text-shadow:0 1px 2px #000}
    #_cbhud .cb-track{flex:1;position:relative;border-radius:4px;overflow:hidden;
      background:rgba(13,19,28,.82);box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4)}
    #_cbhud .cb-track.xp{height:10px}
    #_cbhud .cb-track.hp{height:20px}
    #_cbhud .cb-track.stam{height:12px}
    #_cbhud .cb-fill{height:100%;border-radius:3px;transition:width .18s,background-color .3s}
    #_cbhud .cb-seg{position:absolute;inset:0;pointer-events:none;
      background:repeating-linear-gradient(90deg,transparent 0,transparent calc(16.66% - 1.5px),rgba(13,19,28,.85) calc(16.66% - 1.5px),rgba(13,19,28,.85) 16.66%)}
    #_cbhud .cb-num{position:absolute;inset:0;display:flex;align-items:center;padding-left:10px;
      font:800 13px/1 ${UI.font};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9)}
    #_cbhud .cb-num i{color:rgba(255,255,255,.55);font-style:normal;font-weight:700;margin-left:3px}
    #_cbhud .cb-soul{display:flex;align-items:center;gap:4px;font:700 12px/1 ${UI.font};color:${UI.role.gold.ink};
      text-shadow:0 1px 2px #000;margin-top:2px;padding-left:23px}
    #_cbhud .cb-soul .cb-soulic{height:18px;width:auto;filter:drop-shadow(0 0 5px rgba(140,120,255,.8));margin-right:1px}
    #_cbhud .cb-soul .cb-soullbl{color:#cbb98a;letter-spacing:.03em;font-weight:700}
    #_cbhud .cb-dials{display:flex;align-items:center;gap:8px;margin-left:5px}
    #_cbhud .cb-temp{position:relative;width:54px;height:54px;flex:none}
    @keyframes cb-tempwarn{0%,100%{filter:none}50%{filter:drop-shadow(0 0 9px rgba(255,80,60,.95))}}
    #_cbhud .cb-temp.warn{animation:cb-tempwarn .85s ease-in-out infinite}
    #_cbhud .cb-tempscale{position:absolute;inset:2px;border-radius:50%;opacity:.9;
      background:conic-gradient(from 225deg,#4aa8ff 0deg,#86cadb 100deg,#e6d7a4 195deg,#ff6a58 270deg,transparent 270deg 360deg);
      filter:drop-shadow(0 1px 3px rgba(0,0,0,.6))}
    #_cbhud .cb-tempneedle-svg{position:absolute;inset:0}
    #_cbhud .cb-time{position:relative;width:54px;height:54px;flex:none}
    #_cbhud .cb-timeicon{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font-size:22px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.65))}`;
  document.head.appendChild(_hudCss);

  const HEART_SVG='<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#f1f4f6" d="M12 21s-7.4-4.6-9.7-9C.9 8.6 2.4 5 5.9 5c2 0 3.4 1.2 4.4 2.7C11.3 6.2 12.7 5 14.6 5 18.1 5 19.6 8.6 17.9 12c-2.3 4.4-9.9 9-9.9 9z"/></svg>';
  const STAM_SVG='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#f1f4f6" stroke-width="2.2" stroke-linecap="round"><path d="M10 13.5a3 3 0 0 1 0-4l1.7-1.7a3 3 0 0 1 4.2 4.2l-1 1"/><path d="M14 10.5a3 3 0 0 1 0 4l-1.7 1.7a3 3 0 0 1-4.2-4.2l1-1"/></svg>';
  // 흰색 해/달 아이콘(이모지 아님 — Windows서 ☀ 흑백글리프로 검게 나와서 SVG로 직접).
  const SUN_ICON='<svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="#f5f8fa" stroke-width="2" stroke-linecap="round" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))"><circle cx="13" cy="13" r="4.4" fill="#f5f8fa" stroke="none"/><line x1="13" y1="2.6" x2="13" y2="5.2"/><line x1="13" y1="20.8" x2="13" y2="23.4"/><line x1="2.6" y1="13" x2="5.2" y2="13"/><line x1="20.8" y1="13" x2="23.4" y2="13"/><line x1="5.7" y1="5.7" x2="7.5" y2="7.5"/><line x1="18.5" y1="18.5" x2="20.3" y2="20.3"/><line x1="20.3" y1="5.7" x2="18.5" y2="7.5"/><line x1="7.5" y1="18.5" x2="5.7" y2="20.3"/></svg>';
  const MOON_ICON='<svg width="26" height="26" viewBox="0 0 26 26" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))"><path fill="#f5f8fa" d="M16.5 4.2a9 9 0 1 0 0 17.6 7.4 7.4 0 0 1 0-17.6z"/></svg>';
  // 온도 다이얼 = ★배경 투명 + 컬러 파이 스케일(추위 파랑 왼쪽 / 더위 빨강 오른쪽 / 중간 안전) + 흰 볼팁 바늘.
  //   양끝 = 위험존(추위/더위). 바늘이 위험존 가면 데미지(생존 메커닉).
  const TEMP_HTML=`<div class="cb-temp" id="_cb_temp">
      <div class="cb-tempscale"></div>
      <svg class="cb-tempneedle-svg" width="54" height="54" viewBox="0 0 48 48" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.85))">
        <g id="_cb_tempneedle" transform="rotate(315 24 24)">
          <line x1="24" y1="24" x2="24" y2="10.5" stroke="#f7f9fb" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="24" cy="10.5" r="3" fill="#f7f9fb"/></g>
        <circle cx="24" cy="24" r="3" fill="#f7f9fb"/></svg>
    </div>`;
  // 시간 = ★배경 투명(살짝만 어둡게) + 링 트랙 + 차오르는 크림 링 + 흰 해/달.
  const TIME_SVG=`<svg width="54" height="54" viewBox="0 0 50 50" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.85))">
      <circle cx="25" cy="25" r="22" fill="rgba(6,10,16,.34)"/>
      <circle cx="25" cy="25" r="19.5" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3.2"/>
      <circle id="_cb_timering" cx="25" cy="25" r="19.5" fill="none" stroke="#f0e4b8" stroke-width="3.2" stroke-linecap="round"
        stroke-dasharray="122.5" stroke-dashoffset="122.5" transform="rotate(-90 25 25)"
        style="filter:drop-shadow(0 0 3px rgba(240,228,184,.6))"/></svg>`;

  const hud = _el('div'); hud.id='_cbhud';
  hud.innerHTML = `
    <div class="cb-bars">
      <div class="cb-row"><span class="cb-lv" id="_cb_lvl">1</span>
        <div class="cb-track xp"><div class="cb-fill" id="_cb_xp" style="width:0%;background:linear-gradient(90deg,#3aa8c8,${UI.role.cyan.ink})"></div><div class="cb-seg"></div></div></div>
      <div class="cb-row"><span class="cb-ic">${HEART_SVG}</span>
        <div class="cb-track hp"><div class="cb-fill" id="_cb_fill" style="width:100%;background:${UI.gauge.hp}"></div><span class="cb-num" id="_cb_num">100<i>/ 100</i></span></div></div>
      <div class="cb-row"><span class="cb-ic">${STAM_SVG}</span>
        <div class="cb-track stam"><div class="cb-fill" id="_cb_stam" style="width:100%;background:${UI.gauge.stamina}"></div></div></div>
      <div class="cb-soul"><img class="cb-soulic" src="/tomob-deploy/tomobsoul.png" alt=""><span class="cb-soullbl">토모브의 영혼</span> <b id="_cb_soul" style="color:${UI.role.gold.ink}">0</b></div>
    </div>
    <div class="cb-dials">
      ${TEMP_HTML}
      <div class="cb-time">${TIME_SVG}<div class="cb-timeicon" id="_cb_timeicon">${SUN_ICON}</div></div>
    </div>`;
  document.body.appendChild(hud);

  // ─────── 상단 보스 HP바 (게이트 보스전) — 긴 바 + HP(빨강) + 그로기 게이지(보라, 크게) ───────
  const _bossCss=document.createElement('style'); _bossCss.id='_cbboss-css'; _bossCss.textContent=`
    #_cb_boss{position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:26;width:min(640px,66vw);
      display:none;flex-direction:column;gap:5px;pointer-events:none;font-family:${UI.font};text-align:center}
    #_cb_boss .bb-name{font:800 15px/1 ${UI.font};color:#fff;letter-spacing:.05em;
      text-shadow:0 1px 3px #000,0 0 12px rgba(255,64,64,.55)}
    #_cb_boss .bb-hp{position:relative;height:19px;border-radius:4px;overflow:hidden;
      background:rgba(13,19,28,.85);box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.55),0 1px 5px rgba(0,0,0,.55)}
    #_cb_boss .bb-hpfill{height:100%;width:100%;border-radius:3px;background:linear-gradient(90deg,#b0271b,#ff5a48);transition:width .18s}
    #_cb_boss .bb-hpnum{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font:800 11px/1 ${UI.font};color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.9)}
    #_cb_boss .bb-grog{position:relative;height:8px;border-radius:3px;overflow:hidden;opacity:.35;transition:opacity .2s;
      background:rgba(13,19,28,.72);box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
    #_cb_boss .bb-grogfill{height:100%;width:0%;border-radius:3px;background:#${BAL.feel.groggy.barColor.toString(16).padStart(6,'0')};transition:width .12s}`;
  document.head.appendChild(_bossCss);
  const bossBar=_el('div'); bossBar.id='_cb_boss';
  bossBar.innerHTML=`<div class="bb-name" id="_bb_name">보스</div>
    <div class="bb-hp"><div class="bb-hpfill" id="_bb_hpfill"></div><span class="bb-hpnum" id="_bb_hpnum"></span></div>
    <div class="bb-grog" id="_bb_grog"><div class="bb-grogfill" id="_bb_grogfill"></div></div>`;
  document.body.appendChild(bossBar);
  const _bbName=bossBar.querySelector('#_bb_name'), _bbHpFill=bossBar.querySelector('#_bb_hpfill'),
        _bbHpNum=bossBar.querySelector('#_bb_hpnum'), _bbGrog=bossBar.querySelector('#_bb_grog'),
        _bbGrogFill=bossBar.querySelector('#_bb_grogfill');
  // aggro된 보스(isBoss) 1마리 감지 → 상단바 표시(HP+그로기). 없거나 사망 시 숨김.
  function refreshBossBar(){
    let b=null; const ms=ctx.monsters||[];
    for(const mn of ms){ if(mn.isBoss && !mn.dead && mn.aggro){ b=mn; break; } }
    if(!b){ if(bossBar.style.display!=='none') bossBar.style.display='none'; return; }
    bossBar.style.display='flex';
    const mx=b.maxHp||b.def?.hp||1;
    _bbHpFill.style.width=Math.max(0,Math.min(1,b.hp/mx))*100+'%';
    _bbHpNum.textContent=Math.max(0,Math.ceil(b.hp))+' / '+Math.round(mx);
    _bbName.textContent=b.def?.ko||'보스';
    const gm=BAL.feel.groggy.gaugeMax, inG=b.groggyUntil&&performance.now()<b.groggyUntil;
    const gg=inG?1:Math.max(0,Math.min(1,(b.groggyGauge||0)/gm));
    _bbGrogFill.style.width=gg*100+'%'; _bbGrog.style.opacity=(gg>0.001||inG)?'1':'.35';
  }
  ctx.onUpdate(refreshBossBar);

  // 중앙 — 공격 쿨다운(레퍼런스처럼 얇게 휜 곡선 한 줄 ")" 모양). 아래→위로 차오르고 꽉 차면 발광=공격가능.
  const _CDPATH = 'M14 8 Q33 77 14 146';   // 오른쪽으로 볼록하게 휜 세로 곡선
  const atkWrap = _el('div', `position:fixed;left:50%;top:50%;transform:translate(40px,16px);z-index:23;pointer-events:none`);   // 정중앙서 오른쪽으로 살짝 이동(크로스헤어·조준과 안 겹치게)
  atkWrap.innerHTML = `<svg id="_cb_atksvg" width="44" height="154" viewBox="0 0 44 154" style="filter:drop-shadow(0 1px 4px rgba(0,0,0,.7))">
      <defs><linearGradient id="_cb_atkgrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#5bbcff"/><stop offset="1" stop-color="#eaf6ff"/></linearGradient></defs>
      <path d="${_CDPATH}" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="8" stroke-linecap="round"/>
      <path id="_cb_atkfill" d="${_CDPATH}" fill="none" stroke="url(#_cb_atkgrad)" stroke-width="6.5" stroke-linecap="round"
        pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/>
    </svg>`;
  document.body.appendChild(atkWrap);

  // 우하단 — 현재 무기 우클릭 특수스킬 슬롯(크게·밝게). RMB 배지 + 라벨 + 쿨다운 sweep + 남은초.
  const skillWrap = _el('div', `position:fixed;right:30px;bottom:96px;z-index:25;pointer-events:none;
    display:flex;flex-direction:column;align-items:center;gap:6px;font:12px ${UI.font};color:#eaf4ff`);
  skillWrap.innerHTML = `
    <div id="_cb_skill" style="position:relative;width:78px;height:78px;border-radius:50%;
      background:rgba(20,28,40,.62);border:1px solid rgba(201,168,90,.34);
      box-shadow:0 4px 16px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.14);
      display:flex;align-items:center;justify-content:center;font-size:34px;overflow:hidden">
      <span id="_cb_skill_icon">🛡</span>
      <div id="_cb_skill_cd" style="position:absolute;inset:0;background:conic-gradient(rgba(0,0,0,.72) 0deg, transparent 0deg)"></div>
      <span id="_cb_skill_sec" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800;color:#fff;text-shadow:${UI.shadow.text}"></span>
    </div>
    <div style="display:flex;align-items:center;gap:5px">
      ${keycapHtml('RMB')}
      <span id="_cb_skill_lbl" style="text-shadow:${UI.shadow.text};font-weight:700">가드</span>
    </div>`;
  document.body.appendChild(skillWrap);
  keycap('');   // keycapHtml('RMB') .uk-key CSS 주입 보장(uikit ensureCss 트리거 — 반환 엘리먼트 미사용)

  const fill = document.getElementById('_cb_fill'), num = document.getElementById('_cb_num');
  const soulEl = document.getElementById('_cb_soul'), stamEl = document.getElementById('_cb_stam');
  const xpEl = document.getElementById('_cb_xp'), lvlEl = document.getElementById('_cb_lvl');
  const tempNeedle = document.getElementById('_cb_tempneedle'), tempEl = document.getElementById('_cb_temp');
  const timeRing = document.getElementById('_cb_timering'), timeIcon = document.getElementById('_cb_timeicon');
  const atkFill = document.getElementById('_cb_atkfill'), atkSvg = document.getElementById('_cb_atksvg');
  const skillBox = document.getElementById('_cb_skill'), skillIcon = document.getElementById('_cb_skill_icon'),
        skillCd = document.getElementById('_cb_skill_cd'), skillLbl = document.getElementById('_cb_skill_lbl'),
        skillSec = document.getElementById('_cb_skill_sec');
  const _ATKH = 146;   // SVG 세로바 높이
  // 쿨다운 HUD 갱신(중앙 세로 캡슐 = 아래→위 차오름 / 우하단 스킬 = sweep+남은초)
  function refreshCooldownHud(){
    const P = ctx.player; if(!P) return;
    // ★가운데 세로 곡선 = 스태미나(왼쪽 바와 같은 값 · 크로스헤어 근처라 잘 보임). 원래 공격쿨다운 → 스태미나로 변경(사령관).
    const sr = Math.max(0, Math.min(1, stamina / STAM_MAX));
    atkFill.setAttribute('stroke-dashoffset', ((1 - sr) * 100).toFixed(1));
    const sc = _exhausted ? '#8f97a0' : '#eef2f5';   // ★가운데=흰색(주황은 튐 — 사령관). 탈진=회색. 값은 왼쪽 주황 바와 동일.
    atkFill.setAttribute('stroke', sc);
    atkSvg.style.filter = (!_exhausted && sr < 0.4) ? 'drop-shadow(0 0 8px rgba(255,120,90,.9))' : 'drop-shadow(0 1px 4px rgba(0,0,0,.7))';   // 낮을 때만 붉은 발광 경고
    const s = P.skillCD;
    if(s){ skillBox.style.display='flex'; skillIcon.textContent=s.icon; skillLbl.textContent=s.label;
      const deg = Math.round((1-(s.t==null?1:s.t))*360);
      skillCd.style.background = `conic-gradient(rgba(0,0,0,.72) ${deg}deg, transparent ${deg}deg)`;
      skillSec.textContent = (s.secs>0.1) ? s.secs.toFixed(1) : '';
      skillBox.style.borderColor = s.active ? UI.role.gold.ink : (s.ready ? UI.gauge.hp : 'rgba(201,168,90,.34)');
      skillBox.style.boxShadow = s.ready||s.active ? `0 4px 16px rgba(0,0,0,.6),0 0 14px -2px ${s.active?UI.role.gold.glow:UI.gauge.hp}` : '0 4px 16px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.14)';
    } else { skillBox.style.display='none'; }
  }
  ctx.onUpdate(()=>refreshCooldownHud());
  function refreshSoul(){ soulEl.textContent = soul; }
  function addSoul(n){ soul += n; refreshSoul(); if(n>0) ctx.sound?.play?.('item_in'); }   // ★영혼 흡수음(사령관 "토모브의 영혼도 마찬가지") — 아이템 들어오는 소리 공용
  function refreshStam(){ stamEl.style.width = Math.max(0, stamina) / STAM_MAX * 100 + '%';
    stamEl.style.background = _exhausted ? '#8f97a0' : UI.gauge.stamina; }   // 탈진=회색 / 평소=주황(평평)

  // ── 레벨/경험치(파란 분절바) ──
  function refreshXp(){ if(xpEl) xpEl.style.width = Math.max(0,Math.min(1, xp/xpMax))*100 + '%';
    if(lvlEl) lvlEl.textContent = level; }
  function addXp(n){ xp += n;
    while(xp >= xpMax && level < BAL.level.cap){ xp -= xpMax; level++; xpMax = BAL.level.xpForNext(level);
      const nm = BAL.level.hpAt(_cls, level); hp += Math.max(0, nm - maxHp); maxHp = nm;   // ★레벨업 = 최대HP↑ + 상승분 즉시 회복
      ctx.sound?.play?.('levelup'); refreshHud();   // ★레벨업음(사령관 mp3)
      try{ toast(`레벨 ${level} — 최대 HP ${maxHp}`, { accent:'gold', ms:2400 }); }catch(e){}
    }
    if(level >= BAL.level.cap) xp = Math.min(xp, xpMax);   // 레벨캡 도달 = XP 오버플로 방지
    refreshXp(); }
  refreshXp();

  // ── 온도(温)·시간 다이얼 — 온도=시간+고도/바다, 시간=sky.dayTime. 매프레임 갱신(가벼움). ──
  let _dialT = 0;
  function updateDials(dt){
    _dialT += (dt ?? 0.016); if(_dialT < 0.2) return; _dialT = 0;
    const sky = ctx.sky;
    const dayTime = sky ? sky.dayTime : 0.25;                 // 0=일출·0.25=정오·0.5=일몰·0.75=자정
    const night = sky ? (sky.night ?? 0) : 0;                 // 0(낮)~1(밤)
    // 시간 = 크림 링이 하루 진행만큼 차오름(테두리 채움) + 가운데 해/달
    if(timeRing){ const circ = 122.5; timeRing.setAttribute('stroke-dashoffset', (circ*(1-dayTime)).toFixed(1)); }
    if(timeIcon) timeIcon.innerHTML = night > 0.5 ? MOON_ICON : SUN_ICON;
    // 온도 = ★표시만. 계산·데미지는 temperature.js(ctx.temp). 없으면 중립(0.5).
    const tr = ctx.temp ? ctx.temp.ratio() : 0.5;
    if(tempNeedle) tempNeedle.setAttribute('transform', `rotate(${(225 + tr*270).toFixed(1)} 24 24)`);
    if(tempEl) tempEl.classList.toggle('warn', !!(ctx.temp && ctx.temp.zone !== 'safe'));   // 위험존 = 붉은 펄스
  }
  ctx.onUpdate(updateDials);

  // ── 단축키 힌트(★우하단, Palworld ref/화면/1.png 위치) — 디버그 인벤 패널 대체. 필요한 조작만. ──
  if(!ctx.keyhints){ ctx.keyhints = ukKeyhints([
    { label:'인벤토리', key:'I' }, { label:'지도', key:'M' }, { label:'건축', key:'B' }, { label:'상호작용', key:'E' },
  ], { pos:'right:20px;bottom:210px' }); }

  // ── 상단 나침반(uikit 발할라형) — game.html 외(sandbox/tutorial)에도 적용. 이미 있으면 스킵. ──
  if(!ctx.compass && ctx.camera){ const _cv = new THREE.Vector3();
    ctx.compass = ukCompass({
      getHeading:()=>{ ctx.camera.getWorldDirection(_cv); return (Math.atan2(_cv.x,-_cv.z)*180/Math.PI+360)%360; },
      getMarkers:()=>{ const s=ctx.ship, pl=ctx.player&&ctx.player.pos; if(!s||!pl) return [];
        const sx=(s.x??s.pos?.x), sz=(s.z??s.pos?.z); if(sx==null||sz==null) return [];
        const dx=sx-pl.x, dz=sz-pl.z, d=Math.hypot(dx,dz); if(!isFinite(d)||d<8) return [];
        return [{ bearing:(Math.atan2(dx,-dz)*180/Math.PI+360)%360, dist:d<1000?Math.round(d)+'m':(d/1000).toFixed(1)+'km', accent:'gold' }]; }
    });
  }

  // 피격 붉은 비네트
  const vig = _el('div', `position:fixed;inset:0;z-index:24;pointer-events:none;opacity:0;
    box-shadow:inset 0 0 160px 40px rgba(190,0,0,.75);transition:opacity .12s`);
  document.body.appendChild(vig);

  // 사망 오버레이
  const dover = _el('div', `position:fixed;inset:0;z-index:55;display:none;
    align-items:center;justify-content:center;flex-direction:column;gap:14px;
    background:rgba(8,0,0,.7);backdrop-filter:blur(4px);
    font:${UI.font};color:${UI.role.red.ink}`);
  dover.innerHTML = `<div style="font-size:34px;font-weight:800;letter-spacing:.05em;text-shadow:0 2px 12px rgba(0,0,0,.7),0 0 22px ${UI.role.red.glow}">쓰러졌다</div>
    <div id="_cb_resp" style="font-size:15px;color:#caa">부활 중…</div>`;
  document.body.appendChild(dover);
  const respMsg = dover.querySelector('#_cb_resp');

  function refreshHud(){
    const pct = Math.max(0, hp) / maxHp * 100;
    fill.style.width = pct + '%';
    // 정상=녹 / 중간=주황 / 위험=적 (평평한 단색 — ref 스타일)
    fill.style.background = pct > 50 ? UI.gauge.hp : pct > 25 ? UI.gauge.stamina : UI.role.red.ink;
    num.innerHTML = `${Math.max(0, Math.ceil(hp))}<i>/ ${maxHp}</i>`;
  }
  refreshHud();
  initSkillBar(ctx);   // 우측 직업 스킬바(캐릭터별)

  // ── 몬스터 머리 위 체력바 (ref 5) — 빨간 HP바 + 이름. 월드→스크린 투영 DOM 오버레이 ──
  const _hpLayer = _el('div','position:fixed;inset:0;z-index:22;pointer-events:none;overflow:hidden;font:700 11px Pretendard,system-ui,sans-serif');
  document.body.appendChild(_hpLayer);
  const _hpMap = new Map(); const _hpV = new THREE.Vector3();
  const _AGGRO_SRC = encodeURI('/tomob-deploy/어그로.png');
  function _makeHpBar(){
    const wrap=_el('div','position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:2px;will-change:left,top');
    const aggro=_el('img','width:24px;height:24px;object-fit:contain;display:none;margin-bottom:1px;filter:drop-shadow(0 0 7px rgba(255,45,25,1)) drop-shadow(0 0 15px rgba(255,20,8,.9)) drop-shadow(0 0 24px rgba(255,0,0,.6))'); aggro.src=_AGGRO_SRC;
    const name=_el('div','color:#fff;text-shadow:0 1px 2px #000,0 0 3px #000;font-size:10px;white-space:nowrap');
    const barbg=_el('div','width:54px;height:6px;border-radius:3px;background:rgba(0,0,0,.6);border:1px solid rgba(0,0,0,.7);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.5)');
    const fill=_el('div','height:100%;width:100%;background:linear-gradient(180deg,#ff6155,#d6261b);transition:width .12s');
    barbg.appendChild(fill);
    // ★타격감 D: 보라 그로기 게이지 바(HP바 밑) — 게이지 있을 때만 표시. 색=BAL.feel.groggy.barColor(하드코딩 회피).
    const _ggcol='#'+BAL.feel.groggy.barColor.toString(16).padStart(6,'0');
    const ggbg=_el('div','width:54px;height:4px;border-radius:2px;background:rgba(0,0,0,.6);border:1px solid rgba(0,0,0,.7);overflow:hidden;margin-top:1px;display:none');
    const ggfill=_el('div','height:100%;width:0%;transition:width .1s'); ggfill.style.background=_ggcol;
    ggbg.appendChild(ggfill);
    wrap.appendChild(aggro); wrap.appendChild(name); wrap.appendChild(barbg); wrap.appendChild(ggbg); _hpLayer.appendChild(wrap);
    return {wrap,name,fill,aggro,ggbg,ggfill};
  }
  // ★2026-07-16(사령관 "벽 뒤에 몬스터 체력바 보이면 안 됨 — 위치 파악되니까"): 카메라↔몹 사이 물리 콜라이더(벽/지형)가
  //   막으면 체력바 숨김(위치 노출 차단). Rapier 레이(gate.colliderGroundY와 동일 API), 화면 안(vis) 몹만 검사 = 저비용.
  function _occluded(mn){
    const R=ctx.RAPIER, w=ctx.world; if(!R||!w||!camera) return false;
    const c=camera.position, H=mn.def?.scale||1.7;
    let dx=mn.grp.position.x-c.x, dy=(mn.grp.position.y+H*0.8)-c.y, dz=mn.grp.position.z-c.z;
    const dist=Math.hypot(dx,dy,dz); if(dist<0.8) return false;
    dx/=dist; dy/=dist; dz/=dist;
    try{
      const ray=new R.Ray({x:c.x,y:c.y,z:c.z},{x:dx,y:dy,z:dz});
      const hit=w.castRay(ray, dist-0.7, true, undefined, undefined, ctx.player?.col||undefined);
      if(!hit) return false;
      const toi=(hit.toi!==undefined)?hit.toi:hit.timeOfImpact;
      return toi < dist-0.9;   // 몹 도달 전에 막힘 = 벽 뒤(가림)
    }catch(e){ return false; }
  }
  ctx.onUpdate(()=>{
    const ms=ctx.monsters||[]; const live=new Set(ms);
    for(const [mn,el] of _hpMap){ if(!live.has(mn)||mn.dead){ el.wrap.remove(); _hpMap.delete(mn); } }
    const pp=ctx.player?.pos;
    for(const mn of ms){ if(mn.dead||!mn.grp) continue;
      // 어그로 = 아이콘만 빨간 글로우(몹 몸통은 안 빛남 — 사령관 지시)
      mn._hpMax=Math.max(mn._hpMax||0, mn.hp, mn.def?.hp||0);
      const H=mn.def?.scale||1.7;
      _hpV.set(mn.grp.position.x, mn.grp.position.y+H*1.12, mn.grp.position.z);
      const d=pp?Math.hypot(_hpV.x-pp.x,_hpV.y-pp.y,_hpV.z-pp.z):0;
      _hpV.project(camera);
      let vis = _hpV.z<1 && _hpV.x>-1.05 && _hpV.x<1.05 && _hpV.y>-1.05 && _hpV.y<1.05 && d<55;
      if(vis && _occluded(mn)) vis=false;   // ★벽 뒤 가림
      let el=_hpMap.get(mn);
      if(!vis){ if(el) el.wrap.style.display='none'; continue; }
      if(!el){ el=_makeHpBar(); el.name.textContent=mn.def?.ko||''; _hpMap.set(mn,el); }
      el.wrap.style.display='flex';
      el.wrap.style.left=((_hpV.x*0.5+0.5)*innerWidth)+'px';
      el.wrap.style.top=((-_hpV.y*0.5+0.5)*innerHeight)+'px';
      el.fill.style.width=(Math.max(0,Math.min(1, mn.hp/(mn._hpMax||1)))*100)+'%';
      if(el.aggro) el.aggro.style.display = mn.aggro ? 'block' : 'none';   // 어그로 아이콘
      // ★타격감 D: 보라 그로기 게이지 바 — 게이지>0 또는 그로기 중일 때만 표시(평소 숨김 → HUD 깔끔)
      if(el.ggbg){ const _gm=BAL.feel.groggy.gaugeMax;
        const _gg=Math.max(0,Math.min(1,(mn.groggyGauge||0)/_gm));
        const _inG=mn.groggyUntil && performance.now()<mn.groggyUntil;
        el.ggbg.style.display=(_gg>0||_inG)?'block':'none';
        el.ggfill.style.width=(_inG?100:_gg*100)+'%'; }
    }
  });

  // ─────── 히트 이펙트 ───────
  //   ★재작업(2026-07-02): 스파크/플래시 임팩트 연출은 hitfx.js 전용 모듈로 이관.
  //   combat은 damageMonster 단일 통로에서 ctx.flashHit(mn, hitPos, crit)만 호출(배선 1곳 유지 — G8).

  // ─────── 토모브의 영혼 드롭(물리 픽업) ───────
  //  몬스터 처치 시 지면에 영혼 파티클 덩어리가 피어올라 둥실 떠오름 → 플레이어 접근 시 빨려들어가 +N 💀 적립.
  //  ★최적화: glb·물리엔진·믹서 0. firelings 좌표를 구운 Points 클러스터(드롭 1개=드로우콜 1, 공유 머티리얼).
  //  ★연출값(사령관 승인): 색 #6e5dee · 흰코어 0.65 · 움직임 1.4 · 크기 0.22 · 밝기 1.4.
  const SOUL_MAX = 14;          // 동시 드롭 상한(초과 시 최고참 자동 흡입)
  const SOUL_VAC_R = 4.5;       // 흡입 시작 거리(m)
  const SOUL_PICK_R = 1.0;      // 흡수 완료 거리(m)
  const SOUL_TTL = 22;          // 미수집 자동 흡입까지(s) — 바닥 누적 방지
  const SOUL_N = SOUL_PTS.length/3;
  const SOUL_COLOR = new THREE.Color(0x6e5dee), SOUL_CORE=0.65, SOUL_MOTION=1.4, SOUL_BRIGHT=1.4;
  const SOUL_SCALE = 1.15, SOUL_FLOAT = 0.62;
  const _soulCoreF = new Float32Array(SOUL_N), _soulSeed = new Float32Array(SOUL_N);   // 중심밝기·위상(전 드롭 공유)
  for(let i=0;i<SOUL_N;i++){ const r=Math.hypot(SOUL_PTS[i*3],SOUL_PTS[i*3+1],SOUL_PTS[i*3+2]);
    _soulCoreF[i]=Math.max(0,1-r/0.55); _soulSeed[i]=Math.random()*6.283; }
  const _soulMat = new THREE.PointsMaterial({ size:0.22, vertexColors:true, transparent:true,
    depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
  new THREE.TextureLoader().load('/tomob-deploy/spellfx/textures/gradient_radial_01.png',
    t=>{ t.colorSpace=THREE.SRGBColorSpace; _soulMat.map=t; _soulMat.needsUpdate=true; });
  const soulDrops = [];         // {pts, gy, t, age, n, vac}
  function spawnSoulDrop(pos, n){
    const x=pos.x, z=pos.z;
    const gy = ctx.terrain ? ctx.terrain.groundAt(x, z, pos.y+2.5) : pos.y;
    if(gy < 0.5){ addSoul(n); return; }   // 물/허공이면 드롭 유실 방지 → 즉시 적립
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SOUL_PTS), 3));   // 드롭별 애니 버퍼
    g.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(SOUL_N*3), 3));
    const pts=new THREE.Points(g, _soulMat);
    pts.position.set(x, gy+SOUL_FLOAT, z); pts.scale.setScalar(0.0001);   // 0에서 팝(피어오름)
    pts.layers.enable(1);   // BLOOM_LAYER
    scene.add(pts);
    soulDrops.push({ pts, gy, t:Math.random()*6.283, age:0, n, vac:false });
    if(soulDrops.length > SOUL_MAX) soulDrops[0].vac = true;
  }
  const _sv = new THREE.Vector3();
  ctx.onUpdate(dt=>{
    dt = dt ?? 0.016; if(!soulDrops.length) return;
    const pp = ctx.player?.pos;
    for(let i=soulDrops.length-1; i>=0; i--){
      const s=soulDrops[i], pts=s.pts; s.age+=dt; s.t+=dt; const lt=s.t;
      const grow = Math.min(1, s.age/0.3);                  // 스폰 팝(0.3s)
      if(s.age > SOUL_TTL) s.vac = true;
      // 입자 애니(드리프트+반짝임+코어) — 승인 연출값
      const P=pts.geometry.attributes.position.array, C=pts.geometry.attributes.color.array, mo=SOUL_MOTION;
      for(let k=0;k<SOUL_N;k++){ const ph=_soulSeed[k];
        P[k*3]  =SOUL_PTS[k*3]  +(Math.sin(lt*2.3+ph)*0.05  + Math.cos(lt*1.1+ph*2.0)*0.03)*mo;
        P[k*3+1]=SOUL_PTS[k*3+1]+(Math.sin(lt*2.7+ph*1.4)*0.055 + Math.sin(lt*0.9)*0.05)*mo;
        P[k*3+2]=SOUL_PTS[k*3+2]+(Math.cos(lt*2.3+ph)*0.05  + Math.sin(lt*1.1+ph*2.0)*0.03)*mo;
        const tw=0.7+0.25*Math.sin(lt*5.5+ph*6), br=tw*(0.6+_soulCoreF[k]*SOUL_CORE)*SOUL_BRIGHT;
        C[k*3]=SOUL_COLOR.r*br; C[k*3+1]=SOUL_COLOR.g*br; C[k*3+2]=SOUL_COLOR.b*br; }
      pts.geometry.attributes.position.needsUpdate=true; pts.geometry.attributes.color.needsUpdate=true;
      pts.rotation.y = lt*0.5*mo;
      if(pp){
        const dx=pp.x-pts.position.x, dy=(pp.y||0)+0.9-pts.position.y, dz=pp.z-pts.position.z;
        const dxz=Math.hypot(dx,dz);
        if(!s.vac && dxz < SOUL_VAC_R) s.vac = true;
        if(s.vac){
          const d3=Math.hypot(dx,dy,dz)||1, sp=6+18*(1-Math.min(1,dxz/SOUL_VAC_R));
          pts.position.x+=dx/d3*sp*dt; pts.position.y+=dy/d3*sp*dt; pts.position.z+=dz/d3*sp*dt;
          if(d3 < SOUL_PICK_R){   // 흡수 완료 → 적립
            addSoul(s.n);
            soulPopup(_sv.copy(pp).setY((pp.y||0)+1.6), s.n);
            ctx.sound?.play?.('coin');   // 픽업음(있으면 재생, 없으면 무시)
            scene.remove(pts); pts.geometry.dispose(); soulDrops.splice(i,1); continue;
          }
        } else pts.position.y = s.gy + SOUL_FLOAT + Math.sin(lt*1.5)*0.1;   // 둥실(bob)
      }
      pts.scale.setScalar(grow * SOUL_SCALE);
    }
  });

  // 데미지 숫자 팝업 — ★CSS 키프레임 애니(호출 시점 무관 확실 재생). transition+rAF는 setTimeout 호출(근접)에서
  //   opacity:1이 화면에 그려지기 전에 0이 돼 순간소멸 → 근접 숫자 안 보이던 버그. 키프레임은 그 영향 없음.
  let _dmgKf=window.__dmgKf;
  if(!_dmgKf){ _dmgKf=document.createElement('style'); _dmgKf.textContent='@keyframes dmgFloat{0%{opacity:0;transform:translate(-50%,4px) scale(.5)}12%{opacity:1;transform:translate(-50%,-6px) scale(1.2)}45%{opacity:1;transform:translate(-50%,-30px) scale(1)}100%{opacity:0;transform:translate(-50%,-80px) scale(.95)}}'; document.head.appendChild(_dmgKf); window.__dmgKf=_dmgKf; }
  function dmgPopup(worldPos, amount, crit){
    // 흰색 폰트 + 깔끔한 외곽선/그림자. 크리는 살짝 크고 '!'. 몬스터 근처 랜덤 산포(겹침 방지).
    const el = _el('div', `position:fixed;z-index:27;pointer-events:none;
      font:800 ${crit?'30px':'23px'} Pretendard,system-ui;color:#fff;letter-spacing:.01em;
      text-shadow:0 1px 3px rgba(0,0,0,.8);
      animation:dmgFloat .9s ease-out forwards`);
    el.textContent = crit ? amount+'!' : ''+amount;
    document.body.appendChild(el);
    const v = _to.copy(worldPos); v.project(camera);
    const behind = v.z > 1;
    let sx = (v.x*0.5+0.5)*innerWidth  + (Math.random()-0.5)*48;   // 몬스터 근처 좌우 랜덤
    let sy = (-v.y*0.5+0.5)*innerHeight + (Math.random()-0.5)*30;  // 상하 랜덤
    sx = Math.max(30, Math.min(innerWidth-30, sx));
    sy = Math.max(60, Math.min(innerHeight-80, behind?innerHeight-80:sy));
    el.style.left = `${sx}px`;
    el.style.top  = `${sy}px`;
    setTimeout(()=>el.remove(), 950);
  }
  function soulPopup(worldPos, n){
    const el = _el('div', `position:fixed;z-index:26;pointer-events:none;
      font:bold 15px Pretendard;color:#cab6ff;text-shadow:0 1px 3px #000;
      transition:transform .6s,opacity .6s;transform:translate(-50%,0)`);
    el.textContent = `+${n} 💀`;
    document.body.appendChild(el);
    const v = _to.copy(worldPos); v.project(camera);
    el.style.left = `${(v.x*0.5+0.5)*innerWidth}px`;
    el.style.top  = `${(-v.y*0.5+0.5)*innerHeight - 18}px`;
    requestAnimationFrame(()=>{ el.style.transform='translate(-50%,-58px)'; el.style.opacity='0'; });
    setTimeout(()=>el.remove(), 620);
  }

  // ─────── 근접 히트 판정 ───────
  //   좌클릭 입력·콤보·공격속도는 player.js use()가 소유. 콤보 타격 프레임에 이 meleeHit을 호출한다.
  //   dmg = 무기 데미지(콤보 타당). 정면 부채꼴 내 가장 가까운 몬스터 1체 타격.
  let _dualTog=0;
  const _femaleV = /rogue|mage/.test(_cls);   // 성별(기합음) — 마법사·도적=여, 기사·전사·레인저=남
  // 휘두름(whoosh) — 스윙 시작에 1회(명중 무관). ★도적 쌍수(duals)=sword_attack↔도적공격참고 교대 재생 → 양손 무기가 각각 소리내는 느낌(사령관)
  function meleeSwing(){ if(dead) return;
    if(ctx.player?.currentTool==='none'){ ctx.sound?.play?.('punch'); }   // 🥊 맨손 = 펀치음(칼 소리 대신, 사령관)
    else if(ctx.player?.currentTool==='duals'){ ctx.sound?.play?.((_dualTog++ & 1) ? 'rogue_attack' : 'sword_attack'); }
    else ctx.sound?.play?.('sword_attack');
    if(Math.random()<0.34) ctx.sound?.play?.(_femaleV ? 'dodge_roll' : 'dodge_roll_m', {vol:0.42});   // ★공격 기합 = 3번에 1번(사령관), 성별 그런트 풀 공용
    // ★검격 리본은 기본 공격에선 안 나옴(사령관 "기본공격에 빼줘"). 그로기 난타(E)에서만 → player.js mashTap이 bladeTrailBegin + 샘플링.
  }
  function meleeHit(dmg, reach = ATK_REACH){
    if(dead) return 0;
    // ★whoosh는 meleeSwing()이 스윙 시작에 재생. 여기선 임팩트(칼 닿는 순간)만 — sword_hit + 데미지숫자.
    // ★판정 방향 = 플레이어 실제 조준(camLook). 3인칭 오버숄더 카메라는 캐릭터 뒤·우측 어깨라 camera.getWorldDirection이 캐릭터 조준과 어긋나 몬스터가 부채꼴 밖→ 데미지/숫자 안 뜨던 버그. (화살 fireArrow와 동일하게 camLook 사용)
    const _cl = ctx.player?.camLook; if(_cl) _fwd.copy(_cl); else camera.getWorldDirection(_fwd);
    _fwd.y = 0; _fwd.normalize();
    const pp = ctx.player?.pos; if(!pp) return 0;
    const ms = ctx.monsters || [];
    const py = (pp.y||0);
    const _hits = [];   // ★클리브 — 스윙 부채꼴+사거리 안의 몹 전부(1마리 제한 아님, 사령관)
    for(const mn of ms){
      if(mn.dead) continue;
      const gp = mn.grp.position;
      // 수직 게이트 — 공중/한참 높은 것만 제외(지형 경사·키차 관대). 너무 빡빡하면 평지서도 안 맞음.
      if(gp.y > py + 3.2 || gp.y + monH(mn) < py - 1.8) continue;
      _to.set(gp.x - pp.x, 0, gp.z - pp.z);
      const d = _to.length(); if(d > reach + monR(mn) || d < 0.01) continue;
      _to.normalize();
      if(_fwd.dot(_to) < ATK_DOT) continue;   // 정면 부채꼴 밖
      _hits.push(mn);
    }
    if(!_hits.length){ const _n=performance.now(); if(_n-_missSndT>200 && ctx.player?.currentTool!=='none'){ _missSndT=_n; ctx.sound?.play?.('melee_miss'); } return 0; }   // 헛스윙 = 미스음(맨손은 whoosh=punch로 충분 → 스킵)
    if(ctx.player?.currentTool!=='none') ctx.sound?.play?.('sword_hit');   // 명중음(맨손은 punch가 타격음 겸 — 칼소리 중복 방지)
    for(const mn of _hits) damageMonster(mn, dmg);   // ★범위 내 전부 타격 — 각자 flashHit·히트스톱·데미지숫자(단일 통로)
    return _hits.length;
  }
  // ★스턴 — 정면 가장 가까운 몬스터를 ms동안 행동불가(쌍수 킥). meleeHit과 동일 판정.
  function stunNearest(ms=2000, reach=ATK_REACH){
    if(dead) return false;
    const _cl=ctx.player?.camLook; if(_cl) _fwd.copy(_cl); else camera.getWorldDirection(_fwd); _fwd.y=0; _fwd.normalize();
    const pp=ctx.player?.pos; if(!pp) return false; const py=(pp.y||0);
    let best=null,bestD=reach;
    for(const mn of (ctx.monsters||[])){ if(mn.dead) continue; const gp=mn.grp.position;
      if(gp.y>py+3.2 || gp.y+monH(mn)<py-1.8) continue;
      _to.set(gp.x-pp.x,0,gp.z-pp.z); const d=_to.length(); if(d>reach+monR(mn)||d<0.01) continue;
      _to.normalize(); if(_fwd.dot(_to)<ATK_DOT) continue; if(d<bestD){bestD=d;best=mn;} }
    if(best){ if(_isPoise(best.def)) return false;   // ★A1(2026-07-15): poise/보스(tier5·dragonboss·golem)는 킥 스턴 면역 — 드래곤 무한 스턴 익스플로잇 차단. damageMonster/shieldSlam과 정합.
      best.stunUntil=performance.now()+ms; return true; } return false;
  }
  // ★타격감 D: 난타(mash) 대상 판정 — 정면 최근접 몹이 그로기 중이면 그 몹 반환(meleeHit 판정 재사용). 아니면 null.
  //   player.js use()가 이걸로 초고속 난타 게이트를 켠다(신규 명중통로 없음 — 여전히 meleeHit→damageMonster 단일통로).
  function frontGroggyTarget(reach = ATK_REACH){
    // ★원거리 클래스(룬마스터 staff·헌터 bow)는 붙지 않고 멀리서 그로기 처형 — 사거리 확장(사령관). 근접은 기존 ATK_REACH.
    const _t = ctx.player?.currentTool;
    if(reach === ATK_REACH && (_t==='staff' || _t==='bow')) reach = BAL.feel.groggy.rangedReach || 30;
    const _cl = ctx.player?.camLook; if(_cl) _fwd.copy(_cl); else camera.getWorldDirection(_fwd);
    _fwd.y = 0; _fwd.normalize();
    const pp = ctx.player?.pos; if(!pp) return null; const py = (pp.y||0);
    let best = null, bestD = reach;
    for(const mn of (ctx.monsters||[])){ if(mn.dead) continue; const gp = mn.grp.position;
      if(gp.y > py + 3.2 || gp.y + monH(mn) < py - 1.8) continue;
      _to.set(gp.x - pp.x, 0, gp.z - pp.z); const d = _to.length(); if(d > reach + monR(mn) || d < 0.01) continue;
      _to.normalize(); if(_fwd.dot(_to) < ATK_DOT) continue; if(d < bestD){ bestD = d; best = mn; } }
    return (best && best.groggyUntil && performance.now() < best.groggyUntil) ? best : null;
  }
  // 몬스터 크기(스폰 시 def.scale 높이로 정규화됨) → 타격 중심높이·반경
  const monH = mn => (mn.def?.scale || 1.7);                 // 대략 높이(m)
  const monCY = mn => mn.grp.position.y + monH(mn) * 0.5;    // 몸통 중심 y
  const monR = mn => Math.max(0.85, monH(mn) * 0.45);        // 타격 반경(크기 비례)
  // ★타격감 A2: poise(경직 면역) 판정 — 아무 때나 안 밀림. 대상 목록은 BAL.feel.flinch(SSOT).
  //   사령관 확정(2026-07-01): tier5(dragon) + dragonboss(type) + tier4 golem(kind).
  const _isPoise = def => { const f = BAL.feel.flinch;
    return f.poiseTiers.includes(def?.tier) || f.poiseTypes.includes(def?.type) || f.poiseKinds.includes(def?.k); };
  // ★타격감 D: 그로기(무력화) 면역 판정 — ★poise와 별개! 그로기는 tier5(dragon)+dragonboss만 면역.
  //   (poise는 tier4 golem 포함이지만 그로기는 tier4 허용 — 사령관 "tier4 포함". 두 목록 혼동 금지.)
  const _isGroggyImmune = def => { const g = BAL.feel.groggy;
    return g.immuneTiers.includes(def?.tier) || g.immuneTypes.includes(def?.type); };
  // 몬스터 데미지·처치 공통(근접·화살 공유). hitPos 없으면 몬스터 중심.
  function damageMonster(mn, dmg, hitPos, forceCrit, opts){
    if(!mn || mn.dead) return 0;
    const globalFeel = !opts || opts.feel !== false;   // ★A5(2026-07-15): DoT(화상 틱)·크루 육상 공격은 feel:false — 전역 히트스톱/카메라킥/크리사운드는 플레이어 능동 타격만. 몹별 스파크·데미지숫자는 유지.
    mn.aggro = true; ctx.ai?.alert?.(mn);   // ★피격 시 즉시 어그로(지각 블랙보드도 강제 발각 — 등 뒤 기습 후 반격)
    const crit = forceCrit || Math.random() < BAL.player.critChance;   // forceCrit=활/석궁 조준샷 100%
    const base = dmg * atkMul();   // ★레벨·클래스 공격 스케일 — 근접·화살·마법 전부 이 통로 통과(단일 적용점)
    const out = Math.round(crit ? base * BAL.player.critMul : base);
    mn.hp -= out;
    const hp = mn.grp.position.clone().setComponent(1, mn.grp.position.y + monH(mn) * 0.75);   // ★몬스터 몸통(가슴) — 플레이어 시선이 가는 곳. 너무 위로 띄우면 시선 밖이라 못 봄.
    dmgPopup(hp, out, crit);   // 스파크/임팩트 플래시는 아래 ctx.flashHit(hitfx.js)가 담당(중복배선 방지)
    if(crit && globalFeel) ctx.sound?.play?.('crit_hit');   // ★치명타음 — 플레이어 능동 타격만(DoT/크루 제외). 근접·화살·마법 공통 통로(사령관 mp3)
    // ══ 타격감 스프린트 A (묵직함 3종) — 근접·화살·범위 명중이 전부 여기를 지남(단일 통로, 중복배선 금지) ══
    {
      const F = BAL.feel, willKill = mn.hp <= 0;
      // A1 히트스톱: 처치>크리>평타 (더 긴 히트스톱이 진행 중이면 core.hitStop이 max로 유지)
      //   ★D: 그로기 난타(_mashMode) 중엔 짧은 mashHitStop — 90ms 연타에 64ms 프리즈 겹쳐 끊기던 것 방지(매끄러운 다다다).
      if(globalFeel) ctx.hitStop?.(ctx._mashMode ? F.groggy.mashHitStop : (willKill ? F.hitStop.kill : (crit ? F.hitStop.crit : F.hitStop.normal)), F.hitStop.scale);
      // A3 카메라 킥: crit>평타 (shieldSlam은 자체 0.15로 별도 1회 호출) — DoT/크루는 제외(globalFeel)
      if(globalFeel) ctx.player?.camShake?.(crit ? F.camShake.crit : F.camShake.normal);
      // A2 피격 임팩트 — 흰 휘도 플래시 + 스파크 버스트 + 임팩트 플래시(hitfx.js). poise 무관, 모든 피격에 적용.
      //   ★재작업(2026-07-02): 붉은 몸 틴트 폐기 → 색 무관 임팩트. hitPos(hp)·crit 전달로 크리 강화·명중지점 정확.
      ctx.flashHit?.(mn, hp, crit || (ctx._mashMode && F.groggy.mashFxCrit));   // ★D: 난타는 크리급 임팩트로 화려하게(사령관)
      // A2 경직 + 미세 넉백 — poise 대상/처치 시엔 skip(죽는 몹 밀 필요 없음). ★D: 그로기 중엔 skip(이미 다운=더 강한 CC. 난타가 넉백으로 사거리 밖 밀려 끊기는 것 방지, 非그로기 거동 불변=A 무회귀).
      if(!willKill && !_isPoise(mn.def) && !(mn.groggyUntil && performance.now()<mn.groggyUntil)){
        mn.stunUntil = performance.now() + (crit ? F.flinch.critStunMs : F.flinch.stunMs);
        const gp = mn.grp.position, src = ctx.player?.pos;   // 피격 방향 = 플레이어→몹(바깥). shieldSlam 넉백 패턴 재사용.
        if(src){ const dx = gp.x - src.x, dz = gp.z - src.z, d = Math.hypot(dx, dz);
          if(d > 0.01){ const k = F.flinch.knockK; gp.x += dx/d*k; gp.z += dz/d*k;
            const gy = ctx.terrain?.groundAt?.(gp.x, gp.z, gp.y + 2.5); if(gy != null && gy > 0.5) gp.y = gy; } }   // 지형 재안착
      }
      // ══ 타격감 D: 그로기(무력화) 게이지 누적 + full 시 진입 ══
      //   면역 = tier5+dragonboss만(_isGroggyimmune ≠ _isPoise). 이미 그로기 중/처치 시 skip. kill()/mn.dead 절대 미오염.
      if(!willKill && !_isGroggyImmune(mn.def) && !(mn.groggyUntil && performance.now()<mn.groggyUntil)){
        const G = F.groggy;
        mn.groggyGauge = (mn.groggyGauge||0) + G.gaugePerHit * (crit ? G.critMul : 1);
        if(mn.groggyGauge >= G.gaugeMax){
          mn.groggyGauge = 0;                              // ★게이지 0 리셋(G3)
          mn.groggyUntil = performance.now() + G.windowMs; // ★그로기 진입(G2)
          mn.atk = null;                                   // 진행 중 몹 공격 취소(다운)
          ctx.hitfx?.groggyStars?.(mn, true);              // ★머리 위 별표시 ON(D4)
        }
      }
    }
    if(mn.hp <= 0){
      mn.kill?.();
      const drop = Math.max(1, Math.ceil((mn.def?.hp || 4) / 6));
      spawnSoulDrop(mn.grp.position, drop);   // ★즉시적립 → 물리 영혼 드롭(접근 시 흡입·적립)
      addXp(Math.max(5, Math.round((mn.def?.hp || 8) * 0.6)));   // ★경험치 획득(파란 분절바)
      ctx.combat?._onKill?.(mn, drop);
      ctx.reputation?.applyAction?.('KILL_MONSTER');   // 🌱 축3 연결: 몬스터 토벌 → 명예+5
      if(ctx.settlement && ctx.settlement.nearestOwned && ctx.settlement.bumpGrowth){   // 내 섬 근처 토벌 → 그 섬 안정도↑(소유 섬 없으면 no-op)
        const gp = mn.grp.position;
        const owned = ctx.settlement.nearestOwned(gp.x, gp.z);
        if(owned) ctx.settlement.bumpGrowth(owned, 'stability', 3);
      }
    }
    return out;
  }

  // ─────── 원거리: 화살 투사체(활·석궁) ───────
  const arrows = [];                 // {g, vel, life, dmg}
  const _execArrows = [];            // ★헌터 그로기 처형용 화살(코스메틱) — {g, vel?, target?, arrive, stick, lead, mn}. dmg는 damageMonster가 이미 적용(중복X).
  const _rc = new THREE.Raycaster(); const _C2 = new THREE.Vector2();   // 크로스헤어 조준
  const _arrowProto = {};            // type → 모델(클론용)
  const _gltf = new GLTFLoader();
  function preloadArrow(type){ const cfg = ARROW[type]; if(!cfg || _arrowProto[type]) return;
    _gltf.load(cfg.model, g=>{ const o=g.scene; o.traverse(m=>{ if(m.isMesh){ m.castShadow=true; const ms=Array.isArray(m.material)?m.material:[m.material]; ms.forEach(x=>{ if(x&&x.map)x.map.colorSpace=THREE.SRGBColorSpace; }); } }); _arrowProto[type]=o; }, undefined, ()=>{}); }
  preloadArrow('bow'); preloadArrow('crossbow');
  const _fallbackArrow=()=>{ const m=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.7,6), new THREE.MeshStandardMaterial({color:0x8a5a2b})); m.rotation.x=Math.PI/2; return m; };
  // 화살 발사 — player.js use()가 발사 프레임에 호출. type='bow'|'crossbow'.
  function fireArrow(type='bow', opts={}){
    if(dead) return false;
    const cfg = ARROW[type] || ARROW.bow; const pp = ctx.player?.pos; if(!pp) return false;
    // ★표준 2단계 조준(TPS): ①카메라→크로스헤어(화면중앙) 레이로 월드 조준점 ②무기(가슴/시선)에서 그 점으로 발사 → 1·3인칭 조준 일치.
    _rc.setFromCamera(_C2.set(0,0), camera);
    const targets = (ctx.terrain && ctx.terrain.collide ? ctx.terrain.collide.slice() : []);
    if(ctx.monsters) for(const mn of ctx.monsters){ if(!mn.dead && mn.grp) targets.push(mn.grp); }
    const hits = targets.length ? _rc.intersectObjects(targets, true) : [];
    const aim = hits.length ? hits[0].point.clone() : _rc.ray.origin.clone().addScaledVector(_rc.ray.direction, 150);
    const origin = (ctx.player && ctx.player.third)
      ? new THREE.Vector3(pp.x, (pp.y||0)+1.4, pp.z)                          // 3인칭=가슴
      : _rc.ray.origin.clone().addScaledVector(_rc.ray.direction, 0.5);      // 1인칭=시선 앞
    const dir = aim.sub(origin); if(dir.lengthSq()<1e-4) dir.copy(_rc.ray.direction); dir.normalize();
    const g = new THREE.Group();
    const proto = _arrowProto[type];
    const mesh = proto ? proto.clone(true) : _fallbackArrow();
    if(proto && cfg.scale!==1) mesh.scale.setScalar(cfg.scale);
    g.add(mesh); g.position.copy(origin); g.lookAt(origin.clone().add(dir)); scene.add(g);
    // ★크리(조준)샷 = 크게 + 빠르게 + 금색 글로우(화려한 강타)
    if(opts.crit){ mesh.scale.multiplyScalar(1.6);
      const glow=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8), new THREE.MeshBasicMaterial({color:0xffd24d, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false}));
      const tail=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.9,8), new THREE.MeshBasicMaterial({color:0xffe28a, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false}));
      tail.rotation.x=-Math.PI/2; tail.position.z=-0.5; g.add(glow); g.add(tail); }
    arrows.push({ g, vel: dir.multiplyScalar(cfg.speed*(opts.crit?1.5:1)), life: cfg.range/cfg.speed + 0.3, dmg: opts.dmg || cfg.dmg, crit: opts.crit||false });
    ctx.sound?.play?.('bow_attack');   // 발사음(활·석궁)
    return true;
  }
  // ─────── 레인저 Q 궁극기 = 바람화살 유도 다발 (8발, 근처 몹 전부에 유도 분배·1마리면 8발 다 꽂힘) ───────
  //   ★수치는 임시 상수(추후 balance.js BAL.skills로 이관). WIND_N=발수 · WIND_SPD=속도 · WIND_TURN=선회율 · WIND_DMG_MUL=발당 배수.
  const WIND_N=8, WIND_SPD=44, WIND_TURN=7.0, WIND_DMG_MUL=0.6, WARROW_PTS=16;
  // 바람화살 리본 셰이더 — 궤적 길이방향 흐름 노이즈(바람 결) + 폭/꼬리 페이드. (바람 오라와 동일 기법)
  const _WA_FRAG=[
    'precision highp float; varying vec2 vUv; uniform float uT; uniform float uFade;',
    'float h1(float n){ return fract(sin(n)*43758.5453); }',
    'float n1(float x){ float i=floor(x),f=fract(x); return mix(h1(i),h1(i+1.0),f*f*(3.0-2.0*f)); }',
    'void main(){ float t=vUv.x;',                                          // t: 0=머리(화살촉) .. 1=꼬리
    '  float edge=smoothstep(0.0,0.5,vUv.y)*smoothstep(1.0,0.5,vUv.y);',    // 폭 소프트 엣지
    '  float flow=0.45+0.75*n1(t*11.0 - uT*4.0);',                        // 길이 따라 빠르게 흐르는 결
    '  float tail=smoothstep(1.0,0.5,t);',                                // 꼬리 소멸
    '  float a=edge*flow*tail*uFade;',
    '  if(a<0.004) discard;',
    '  vec3 col=mix(vec3(0.45,0.9,1.0), vec3(0.97,1.0,0.99), flow*0.7);',   // 청록 → 흰빛 심
    '  gl_FragColor=vec4(col, a); }'].join('\n');
  const _WA_VERT='varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  const _waTan=new THREE.Vector3(), _waSide=new THREE.Vector3(), _waView=new THREE.Vector3(), _waCam=new THREE.Vector3();
  let _waTime=0;
  function _windArrow(){   // 머리=청록 글로우 코어 + 월드공간 리본 트레일(카메라 향, 매 프레임 재구성)
    const g=new THREE.Group();
    const core=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,10), new THREE.MeshBasicMaterial({color:0xd6fff0,transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false})); g.add(core);
    const geo=new THREE.BufferGeometry();
    const pos=new Float32Array(WARROW_PTS*2*3), uv=new Float32Array(WARROW_PTS*2*2), idx=[];
    for(let i=0;i<WARROW_PTS;i++){ const t=i/(WARROW_PTS-1); uv[(i*2)*2]=t; uv[(i*2)*2+1]=0; uv[(i*2+1)*2]=t; uv[(i*2+1)*2+1]=1; }
    for(let i=0;i<WARROW_PTS-1;i++){ const b=i*2; idx.push(b,b+1,b+2, b+1,b+3,b+2); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv,2)); geo.setIndex(idx);
    const mat=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, uniforms:{ uT:{value:0}, uFade:{value:1} }, vertexShader:_WA_VERT, fragmentShader:_WA_FRAG });
    const rmesh=new THREE.Mesh(geo, mat); rmesh.frustumCulled=false; scene.add(rmesh);
    return { g, rmesh, rgeo:geo, rmat:mat, rpos:pos };
  }
  function fireWindVolley(){
    if(dead) return false; const pp=ctx.player?.pos; if(!pp) return false;
    const ms=(ctx.monsters||[]).filter(m=>!m.dead&&m.grp);
    const origin=new THREE.Vector3(pp.x,(pp.y||0)+1.5,pp.z);
    _rc.setFromCamera(_C2.set(0,0),camera); const fwd=_rc.ray.direction.clone();
    const baseDmg=Math.max(3, Math.round((ARROW.bow?.dmg||8)*WIND_DMG_MUL));
    for(let k=0;k<WIND_N;k++){
      const tgt = ms.length ? ms[k%ms.length] : null;
      let dir = tgt ? new THREE.Vector3(tgt.grp.position.x, monCY(tgt), tgt.grp.position.z).sub(origin).normalize() : fwd.clone();
      dir.x+=(Math.random()-0.5)*0.5; dir.y+=0.14+(Math.random()-0.5)*0.25; dir.z+=(Math.random()-0.5)*0.5; dir.normalize();   // 발사 순간 흩뿌림 → 유도로 다시 모임
      const wa=_windArrow(); wa.g.position.copy(origin); wa.g.lookAt(origin.clone().add(dir)); scene.add(wa.g);
      const trail=[]; for(let j=0;j<WARROW_PTS;j++) trail.push({x:origin.x,y:origin.y,z:origin.z});   // 궤적 초기화(전부 발사점)
      arrows.push({ g:wa.g, vel:dir.multiplyScalar(WIND_SPD), life:3.4, dmg:baseDmg, crit:false, homing:true, wind:true, _target:tgt, _turn:WIND_TURN,
        trail, rmesh:wa.rmesh, rgeo:wa.rgeo, rmat:wa.rmat, rpos:wa.rpos });
    }
    ctx.sound?.play?.('bow_attack');
    return true;
  }
  const _delArrow=(a)=>{ scene.remove(a.g); if(a.rmesh){ scene.remove(a.rmesh); a.rgeo&&a.rgeo.dispose(); a.rmat&&a.rmat.dispose(); } };
  // ─────── 헌터 그로기 처형 = 화살비(다다다) + 박힘 물리 임팩트 ───────
  //   hitfx.flashHit의 bow 분기가 E 1타마다 호출. 가까우면(instantRange 미만) 즉발로 몹에 박힘, 멀면 실제 투사체가 날아가 꽂힘(사령관 "둘 다 섞기").
  //   박힘 임팩트=ctx.hitfx.arrowEmbedImpact(다른 클래스만큼 무게, 물리색). 데미지는 damageMonster가 이미 처리(여긴 비주얼·사운드만).
  function execArrowVolley(mn){ if(dead || !mn || !mn.grp) return;
    const R = BAL.feel.groggy.arrow || {}; const pp = ctx.player?.pos; if(!pp) return;
    preloadArrow('bow');
    const cnt = Math.max(1, (R.count|0)||3);
    const tx=mn.grp.position.x, ty=monCY(mn), tz=mn.grp.position.z;
    const ox=pp.x, oy=(pp.y||0)+1.4, oz=pp.z;                 // 가슴에서 발사
    const dist=Math.hypot(tx-ox, tz-oz);
    const instant = dist < (R.instantRange ?? 9);
    const spd=(R.travelSpeed||95);
    const rr=monR(mn)*0.5;
    for(let i=0;i<cnt;i++){
      const g=new THREE.Group();
      const mesh=_arrowProto['bow'] ? _arrowProto['bow'].clone(true) : _fallbackArrow();
      if(_arrowProto['bow']){ const sc=(ARROW.bow&&ARROW.bow.scale)||1; if(sc!==1) mesh.scale.setScalar(sc); }
      g.add(mesh); scene.add(g);
      const tgt=new THREE.Vector3(tx+(Math.random()*2-1)*rr, ty+(Math.random()*2-1)*rr*0.7, tz+(Math.random()*2-1)*rr);
      const lead=(i===0);   // 첫 화살=임팩트 트리거(타당 1회 = 근접 groggyImpact와 동일 빈도, GC/블룸 폭주 방지)
      if(instant){
        g.position.copy(tgt); g.lookAt(tgt.clone().add(new THREE.Vector3(tx-ox, ty-oy, tz-oz)));
        _execArrows.push({ g, arrive:true, stick:(R.stickSec||0.12), mn, lead });
        if(lead){ ctx.hitfx?.arrowEmbedImpact?.(tgt.clone()); ctx.sound?.play?.('bow_hit'); }
      } else {
        g.position.set(ox,oy,oz);
        const dir=tgt.clone().sub(g.position); if(dir.lengthSq()<1e-4) dir.set(tx-ox,0,tz-oz); dir.normalize();
        g.lookAt(g.position.clone().add(dir));
        _execArrows.push({ g, vel:dir.multiplyScalar(spd), target:tgt, arrive:false, stick:(R.stickSec||0.12), mn, lead });
      }
    }
    if(!instant) ctx.sound?.play?.('bow_attack');            // 투사체=발사음(즉발은 박힘음만)
  }
  function updateExecArrows(dt){
    for(let i=_execArrows.length-1;i>=0;i--){ const a=_execArrows[i];
      if(!a.arrive){
        a.g.position.addScaledVector(a.vel, dt);
        a.g.lookAt(a.g.position.clone().add(a.vel));
        const t=a.target; const dx=t.x-a.g.position.x, dy=t.y-a.g.position.y, dz=t.z-a.g.position.z;
        a.life=(a.life||0)+dt;   // ★A2(2026-07-15): 수명/지나침 가드 — 이산 샘플이 0.6m 반경을 건너뛰면 영구 잔류하던 버그 차단.
        const overshoot=(dx*a.vel.x + dy*a.vel.y + dz*a.vel.z) < 0;   // 목표 통과(속도·목표방향 역전)
        if(dx*dx+dy*dy+dz*dz < 0.36 || overshoot || a.life>2 || (a.mn && a.mn.dead)){
          a.arrive=true; a.g.position.copy(t); a.stick=(BAL.feel.groggy.arrow?.stickSec)||0.12;
          if(a.lead){ ctx.hitfx?.arrowEmbedImpact?.(t.clone()); ctx.sound?.play?.('bow_hit'); }
        }
      } else {
        a.stick-=dt; if(a.stick<=0){ scene.remove(a.g); _execArrows.splice(i,1); }
      }
    }
  }
  function updateArrows(dt){
    updateExecArrows(dt);
    if(!arrows.length) return; const ms = ctx.monsters || []; _waTime+=dt;
    for(let i=arrows.length-1;i>=0;i--){ const a=arrows[i]; a.life-=dt;
      if(a.homing){   // ★바람화살 = 유도. 타겟 몹으로 매 프레임 선회(죽었으면 가장 가까운 몹으로 재지정). 중력 없음.
        if(!a._target || a._target.dead){ let best=null,bd=1e9; for(const mn of ms){ if(mn.dead)continue; const gp=mn.grp.position; const d=(gp.x-a.g.position.x)**2+(gp.z-a.g.position.z)**2; if(d<bd){bd=d;best=mn;} } a._target=best; }
        if(a._target){ const gp=a._target.grp.position; const want=_to.set(gp.x-a.g.position.x, monCY(a._target)-a.g.position.y, gp.z-a.g.position.z);
          if(want.lengthSq()>1e-4){ want.normalize(); const spd=a.vel.length()||WIND_SPD; a.vel.lerp(want.multiplyScalar(spd), Math.min(1,(a._turn||6)*dt)); const s2=a.vel.length()||spd; a.vel.multiplyScalar(spd/s2); } }
        a.g.position.addScaledVector(a.vel, dt);
        a.g.lookAt(a.g.position.clone().add(a.vel));
        // 바람 리본 트레일 — 궤적 시프트 후 카메라 향 리본 재구성(머리 굵고 꼬리 0)
        if(a.trail){ const tr=a.trail; for(let j=WARROW_PTS-1;j>0;j--){ const p=tr[j],q=tr[j-1]; p.x=q.x;p.y=q.y;p.z=q.z; }
          tr[0].x=a.g.position.x; tr[0].y=a.g.position.y; tr[0].z=a.g.position.z;
          camera.getWorldPosition(_waCam); const rp=a.rpos;
          for(let j=0;j<WARROW_PTS;j++){ const p=tr[j], pa=tr[Math.max(0,j-1)], pb=tr[Math.min(WARROW_PTS-1,j+1)];
            _waTan.set(pb.x-pa.x,pb.y-pa.y,pb.z-pa.z); if(_waTan.lengthSq()<1e-8)_waTan.set(0,1,0); _waTan.normalize();
            _waView.set(_waCam.x-p.x,_waCam.y-p.y,_waCam.z-p.z).normalize();
            _waSide.crossVectors(_waTan,_waView); if(_waSide.lengthSq()<1e-8)_waSide.set(1,0,0); _waSide.normalize();
            const t=j/(WARROW_PTS-1), wd=0.12*(1.0-t);   // 화살촉 굵고 꼬리로 갈수록 0
            const o=j*6; rp[o]=p.x+_waSide.x*wd; rp[o+1]=p.y+_waSide.y*wd; rp[o+2]=p.z+_waSide.z*wd;
            rp[o+3]=p.x-_waSide.x*wd; rp[o+4]=p.y-_waSide.y*wd; rp[o+5]=p.z-_waSide.z*wd; }
          a.rgeo.attributes.position.needsUpdate=true; a.rgeo.computeBoundingSphere(); a.rmat.uniforms.uT.value=_waTime; }
      } else {
        a.vel.y -= 9.8*dt*ARROW_GRAV;
        a.g.position.addScaledVector(a.vel, dt);
        a.g.lookAt(a.g.position.clone().add(a.vel));
      }
      let hit=null;
      for(const mn of ms){ if(mn.dead) continue; const gp=mn.grp.position;
        const r=monR(mn)+0.3, dx=gp.x-a.g.position.x, dy=monCY(mn)-a.g.position.y, dz=gp.z-a.g.position.z;
        if(dx*dx+dy*dy+dz*dz < r*r){ hit=mn; break; } }
      if(hit){ ctx.sound?.play?.('bow_hit'); damageMonster(hit, a.dmg, a.g.position.clone(), a.crit); _delArrow(a); arrows.splice(i,1); continue; }
      if(a.life<=0 || a.g.position.y<-3){ _delArrow(a); arrows.splice(i,1); }
    }
  }
  // 스태미나 (1단계: 공격 소모만. 회피롤은 2단계)
  function useStamina(cost){ if(dead || _exhausted || stamina < cost) return false; stamina -= cost; stamWait = STAM_DELAY; if(stamina<=0)_exhausted=true; refreshStam(); return true; }
  function drainSprint(amt){ if(_exhausted) return false; stamina=Math.max(0, stamina-amt); stamWait=STAM_DELAY; if(stamina<=0)_exhausted=true; refreshStam(); return !_exhausted; }   // 스프린트 지속 소모. false=탈진(스프린트 중단)

  // ─────── 플레이어 피격 (monsters.js가 호출) ───────
  function hitPlayer(dmg){
    if(dead) return;
    ctx.player?.drawWeapon?.();      // ★적이 실제로 공격해오면 안전 자동발도(사령관 2026-07-02). 이후 납도는 V 수동.
    if(ctx.player?.invuln) return;  // ★회피롤 중 = 완전 무효(가드/충전도 없음)
    let d = dmg ?? 8;
    let guarded = false;
    if(ctx.player?.guarding){                                 // ★검방패 가드 = 맞을 때마다 스태미나 소모(피해 비례) — 테스트 무적이어도 충전은 됨
      const cost = Math.max(5, Math.ceil(d * 0.8));
      if(stamina >= cost){ stamina -= cost; stamWait = STAM_DELAY; refreshStam();
        guardCharge = Math.min(GUARD_MAX, guardCharge + Math.max(15, d));   // ★막을수록 충격파 게이지 충전(막기 전 피해 비례)
        d *= BAL.player.guardReduce; guarded = true;   // ★C(2026-07-15): 0.2 → BAL.player.guardReduce(가드 피해감소 SSOT, 동작 불변)
        { const _n=performance.now(); if(_n-_blockSndT>180){ _blockSndT=_n; ctx.sound?.play?.('sword_block'); } }   // ★막는소리 — 180ms throttle(연타 시 따다닥 연사 방지)
        ctx.player?.playBlockHit?.(); }   // 막음 = 80%↓ + 막는소리 + Block_Hit 반응
      else { stamina = 0; refreshStam(); }                    // 스태미나 고갈 = 가드 붕괴(풀 데미지·플린치)
    }
    if(window.__testMode) return;   // ★테스트 모드 = HP는 안 깎임(위 가드/충전·스태미나는 정상 처리)
    hp -= d;
    regenWait = REGEN_DELAY;
    vig.style.boxShadow = 'inset 0 0 160px 40px rgba(190,0,0,.75)';   // 피격 = 붉은 비네트
    hurtFlash = 1; vig.style.opacity = '1';
    refreshHud();
    if(hp <= 0){ hp = 0; die(); }
    else if(!guarded){ ctx.player?.playHit?.();   // 막아냈을 때만 플린치 X(가드 붕괴 시엔 플린치)
      const _n=performance.now(); if(_n-_hurtSndT>450){ _hurtSndT=_n; ctx.sound?.play?.(_femaleV?'dodge_roll':'dodge_roll_m',{vol:0.5, rate:0.92}); } }   // ★피격 기합(성별, 450ms throttle)

  }
  // ─────── 환경 피해(온도 등) — temperature.js가 위험존에서 호출. 가드 무시, 추위=파랑/더위=적 비네트 ───────
  function envHurt(d, kind){
    if(dead) return;
    vig.style.boxShadow = kind === 'cold'
      ? 'inset 0 0 150px 44px rgba(90,160,235,.5)'    // 혹한 = 파란 서리
      : 'inset 0 0 150px 44px rgba(220,90,40,.5)';    // 혹서 = 붉은 열기
    hurtFlash = Math.max(hurtFlash, 0.55); vig.style.opacity = '0.6';
    if(window.__testMode) return;                     // 테스트 무적 = HP 유지(경고 연출만)
    hp -= d; regenWait = REGEN_DELAY; refreshHud();
    if(hp <= 0){ hp = 0; die(); }
  }
  // ─────── 양손 스핀 = 360° 광역(부채꼴 없이 반경 내 전부) ───────
  function spinHit(dmg, reach = ATK_REACH){
    if(dead) return 0;
    const pp = ctx.player?.pos; if(!pp) return 0;
    const py = (pp.y||0); let n = 0;
    for(const mn of (ctx.monsters||[])){
      if(mn.dead) continue; const gp = mn.grp.position;
      if(gp.y > py + 2.2 || gp.y + monH(mn) < py - 0.3) continue;
      const d = Math.hypot(gp.x - pp.x, gp.z - pp.z);
      if(d > reach + monR(mn)) continue;
      damageMonster(mn, dmg); n++;
    }
    return n;
  }
  // ─────── 기사 방패 충격파(궁극기) = 게이지 가득 시, 360° 광역 + 넉백 + 스턴 ───────
  function shieldSlam(dmg = BAL.skills.shieldSlam, radius = BAL.skills.shieldSlamRadius){   // ★C(2026-07-15): 하드코딩 48/5.8 → BAL.skills(동작 불변)
    if(dead || guardCharge < GUARD_MAX) return false;   // 충전 안 됐으면 발동 불가
    guardCharge = 0;
    const pp = ctx.player?.pos; if(!pp) return false; const py = (pp.y||0);
    ctx.sound?.play?.('sword_block'); ctx.sound?.play?.('sword_hit');   // 묵직한 임팩트(레이어)
    ctx.player?.camShake?.(BAL.feel.camShake.shieldSlam);   // ★타격감 A3: 궁극기 = 강한 카메라 킥 1회(0.15, SSOT)
    let n = 0;
    for(const mn of (ctx.monsters||[])){
      if(mn.dead) continue; const gp = mn.grp.position;
      if(gp.y > py + 3.2 || gp.y + monH(mn) < py - 2.2) continue;   // 충격파=바닥 광역 → 수직 게이트 관대(경사지서도 다 맞게)
      const dx = gp.x - pp.x, dz = gp.z - pp.z, d = Math.hypot(dx, dz);
      if(d > radius + monR(mn)) continue;
      damageMonster(mn, dmg);
      // ★타격감 A2(재작업 2026-07-02): poise 대상(tier5 dragon·dragonboss·tier4 golem)은 궁극기에도 안 밀림·스턴 면역(G8 정합).
      //   기존엔 damageMonster는 poise를 존중했지만 shieldSlam 넉백·스턴이 무조건 적용돼 우회했음 → 여기서도 skip.
      if(!_isPoise(mn.def)){
        if(d > 0.01){ const k = 4.5; gp.x += dx/d*k; gp.z += dz/d*k;   // 바깥으로 넉백
          const gy = ctx.terrain?.groundAt?.(gp.x, gp.z, gp.y + 2.5); if(gy != null && gy > 0.5) gp.y = gy; }   // 지형에 안착
        mn.stunUntil = performance.now() + BAL.skills.shieldSlamStun;   // 스턴(넉백 자세 유지) ★C: 1600 → BAL.skills.shieldSlamStun
      }
      n++;
    }
    return true;
  }
  // ─────── 투명(도적) = 전 몬스터 어그로 해제 ───────
  function dropAggro(){ for(const mn of (ctx.monsters||[])){ if(!mn.dead){ mn.aggro = false; if(mn._target!=null) mn._target = null; ctx.ai?.forget?.(mn); ctx.ai?.tokenRelease?.(mn); } } }   // 🧠 지각 망각+토큰 반납 동반

  function die(){
    // 💠 부활석(교역소 구매) 소지 시 자동 소모 → 제자리 부활(게임오버 스킵). BAL.soulShop.revive.hpPct.
    if(ctx.inventory && ctx.inventory.count('revivestone')>0){
      ctx.inventory.remove('revivestone',1); if(ctx.updHotbar)ctx.updHotbar();
      hp = Math.max(1, Math.floor(maxHp * BAL.soulShop.revive.hpPct)); regenWait = REGEN_DELAY;
      hurtFlash = 0; vig.style.opacity = '0'; refreshHud();
      ctx.player?.reviveAnim?.();
      ctx.invui?.toast?.('부활석 발동 — 제자리 부활!');
      ctx.sound?.play?.('levelup');   // 부활 효과음(있으면)
      return;
    }
    dead = true;
    if(ctx.ship && ctx.ship.boarded){ ctx.ship.boarded=false; ctx.ship.speed=0; ctx.ship.furl=1; ctx.ship.rudder=0; }   // ★배 위 사망 = 하선+정지(조타 계속·부활 스냅백 버그)
    ctx.player?.playDeath?.();             // 쓰러지는 애니
    ctx.sound?.play?.(_femaleV?'dodge_roll':'dodge_roll_m', {vol:0.7, rate:0.72});   // ★사망 기합(성별, 피치 다운=묵직)
    gameOver();                            // ★사망 = 게임오버(부활석 없으면) — 다시 시도=항구 부활
  }
  // 🧪 힐링 포션 사용(H키) — BAL.soulShop.potion.heal 만큼 즉시 회복(교역소 구매 소모품).
  function usePotion(){
    if(dead) return false;
    if(!ctx.inventory || ctx.inventory.count('potion')<=0){ ctx.invui?.toast?.('힐링 포션 없음 — 교역소에서 구매'); return false; }
    if(hp>=maxHp){ ctx.invui?.toast?.('HP 가득 참'); return false; }
    ctx.inventory.remove('potion',1); if(ctx.updHotbar)ctx.updHotbar();
    hp = Math.min(maxHp, hp + BAL.soulShop.potion.heal); regenWait = 0; refreshHud();
    ctx.sound?.play?.('success');
    ctx.invui?.toast?.('+'+BAL.soulShop.potion.heal+' HP');
    return true;
  }
  addEventListener('keydown', e=>{ if(e.code==='KeyH' && !e.repeat){ if(ctx.input && ctx.input.blocks('KeyH')) return; usePotion(); } });   // H = 힐링 포션(⌨️ 조타/UI/컷신 중 차단)
  // ── GAME OVER 화면 (튜토 gameOver 이식, 본겜 사망에 적용) — GAMEOVER.png 엠블럼 + 침몰/VOYAGE ENDED + 5초 후 다시 시도 ──
  let _gameOverShown = false;
  function gameOver(){
    if(_gameOverShown) return; _gameOverShown = true;
    try{ document.exitPointerLock && document.exitPointerLock(); }catch(_){}
    try{ ctx.player?.setThird && ctx.player.setThird(false); }catch(_){}   // 1인칭 강제(쓰러진 아바타 숨김)
    ['_cbhud','hotbar','_cb_boss','hint','_cbcd'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display='none'; });
    document.querySelectorAll('.uk-compass,.uk-keyhints').forEach(e=>{ e.style.display='none'; });
    if(dover) dover.style.display='none';
    const st=document.createElement('style'); st.id='goStyle';
    st.textContent=`
      #gameOver{position:fixed;inset:0;z-index:650;display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:radial-gradient(120% 100% at 50% 46%,rgba(5,4,6,.92),rgba(0,0,1,.99));
        font-family:'Pretendard',system-ui,sans-serif;text-align:center;opacity:0;transition:opacity 1.6s ease;}
      #gameOver.on{opacity:1;}
      #gameOver .goEmblem{position:relative;width:min(480px,66vw);aspect-ratio:1/1;
        background:url('/tomob-deploy/GAMEOVER.png') center/contain no-repeat;animation:goPulse 3.6s ease-in-out infinite;}
      @keyframes goPulse{0%,100%{filter:brightness(1.18) saturate(1.28) drop-shadow(0 0 18px rgba(220,34,28,.5)) drop-shadow(0 0 7px rgba(255,90,66,.5));}
        50%{filter:brightness(1.26) saturate(1.35) drop-shadow(0 0 34px rgba(240,46,40,.72)) drop-shadow(0 0 13px rgba(255,100,76,.6));}}
      #gameOver .goCtr{position:absolute;left:0;right:0;top:51%;transform:translateY(-50%);}
      #gameOver .goBack{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);width:70%;height:52%;border-radius:50%;
        background:radial-gradient(ellipse at center,rgba(0,0,0,.96) 0%,rgba(0,0,0,.9) 40%,rgba(0,0,0,.55) 66%,transparent 84%);filter:blur(7px);}
      #gameOver .goTitle{position:relative;font-size:clamp(40px,5.6vw,66px);font-weight:900;color:#ff5142;letter-spacing:.03em;line-height:1;
        text-shadow:0 0 2px rgba(0,0,0,.95),0 0 5px rgba(0,0,0,.85),0 0 14px rgba(255,80,60,.95),0 0 28px rgba(230,32,22,.55);}
      #gameOver .goSub{position:relative;margin-top:9px;font-size:clamp(10px,1.18vw,14px);font-weight:800;letter-spacing:.2em;
        color:#ff7a68;text-shadow:0 0 2px rgba(0,0,0,.9),0 0 9px rgba(255,80,62,.7);padding-left:.2em;}
      #gameOver .goSub::before{content:'~ ';opacity:.5;} #gameOver .goSub::after{content:' ~';opacity:.5;}
      #gameOver .goDesc{margin-top:14px;font-size:15px;color:#c7baa6;text-shadow:0 1px 3px #000;}
      #gameOver .goWait{margin-top:24px;font-size:15px;color:#9a8e7c;letter-spacing:.04em;}
      #gameOver .goWait b{color:#ffd98a;font-size:21px;font-weight:800;margin:0 3px;}
      #gameOver .goBtn{margin-top:16px;font:700 15px Pretendard,system-ui;letter-spacing:.12em;color:#6a5f50;padding:13px 42px;
        border:1px solid rgba(120,80,70,.35);border-radius:6px;background:linear-gradient(180deg,rgba(24,16,16,.85),rgba(12,8,8,.92));
        transition:.25s;pointer-events:none;opacity:.55;cursor:default;}
      #gameOver .goBtn.ready{pointer-events:auto;cursor:pointer;opacity:1;color:#e7d6b8;border-color:rgba(190,60,50,.55);
        background:linear-gradient(180deg,rgba(40,15,15,.9),rgba(17,8,8,.95));}
      #gameOver .goBtn.ready:hover{color:#fff;border-color:rgba(232,72,60,.9);box-shadow:0 0 24px -6px rgba(232,52,42,.7);}`;
    document.head.appendChild(st);
    const ov=document.createElement('div'); ov.id='gameOver';
    ov.innerHTML=`
      <div class="goEmblem"><div class="goCtr">
        <div class="goBack"></div>
        <div class="goTitle">침몰</div>
        <div class="goSub">VOYAGE ENDED</div>
      </div></div>
      <div class="goDesc">선장이 쓰러졌고, 항해는 표류를 시작했다.</div>
      <div class="goWait" id="goWait">다시 시도까지 <b>5</b> 초</div>
      <button class="goBtn" id="goRetry">다시 시도</button>`;
    document.body.appendChild(ov);
    requestAnimationFrame(()=>ov.classList.add('on'));
    const $wait=ov.querySelector('#goWait'), $waitN=$wait.querySelector('b'), $btn=ov.querySelector('#goRetry');
    let _n=5;
    const tick=()=>{ _n--; if(_n>0){ $waitN.textContent=_n; setTimeout(tick,1000); }
      else { $wait.style.display='none'; $btn.classList.add('ready'); } };
    setTimeout(tick,1000);
    $btn.addEventListener('click',()=>{ if($btn.classList.contains('ready')) reviveAtHarbor(); });
  }
  // ★게임오버 "다시 시도" = 리로드 아님 → 마지막 출항 항구로 부활(진행상황 유지). 항구 없으면 시작지점.
  function reviveAtHarbor(){
    document.getElementById('gameOver')?.remove();
    document.getElementById('goStyle')?.remove();
    _gameOverShown = false;
    ['_cbhud','hotbar','_cb_boss','hint','_cbcd'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display=''; });   // HUD 복원
    document.querySelectorAll('.uk-compass,.uk-keyhints').forEach(e=>{ e.style.display=''; });
    dead = false; hp = maxHp; regenWait = 0; refreshHud();
    if(ctx.ship) ctx.ship.boarded = false;                                  // ★하선 보장(안 하면 매프레임 배 헬름으로 스냅백 → 텔레포트 무효+냉기위치 어긋남)
    ctx.player?.reviveAnim?.();
    try{ ctx.player?.setThird && ctx.player.setThird(true); }catch(_){}     // 3인칭 복귀
    const tgt = ctx.lastHarbor || (spawnSet ? {x:_spawn.x, z:_spawn.z, y:_spawn.y} : null);   // 마지막 출항 항구(없으면 시작지점)
    if(tgt && ctx.player?.body?.setTranslation){
      let ty = tgt.y;
      if(ty==null && ctx.terrain?.groundAt) ty = ctx.terrain.groundAt(tgt.x, tgt.z, 800);
      if(ty==null || ty<=0) ty = ctx.player.pos?.y ?? 5;
      ctx.player.body.setTranslation({ x:tgt.x, y:ty+1.2, z:tgt.z }, true);   // Rapier 바디 순간이동(teleport 함수 부재)
    }
    // ★페널티 = 배 내구도 감소(항구 복귀 후 수리 필요 → 골드 싱크). BAL.ship.deathPenalty
    if(ctx.ship){ const DM=BAL.ship.durMax, pen=BAL.ship.deathPenalty||0;
      ctx.ship.durability = Math.max(0, (ctx.ship.durability!=null?ctx.ship.durability:DM) - pen); }
    try{ ctx.renderer?.domElement?.requestPointerLock?.(); }catch(_){}      // 포인터락 재획득(버튼 클릭=제스처)
  }
  function respawn(){
    dead = false; hp = maxHp; regenWait = 0;
    dover.style.display = 'none';
    refreshHud();
    ctx.player?.reviveAnim?.();            // 이동/대기 애니로 복귀
    // 시작 위치로 복귀(가능하면)
    if(spawnSet && ctx.player?.teleport) ctx.player.teleport(_spawn.x, _spawn.z);
  }

  // ─────── 업데이트 ───────
  ctx.onUpdate(dt => {
    dt = dt ?? 0.016;
    if(!spawnSet && ctx.player?.pos){ _spawn.copy(ctx.player.pos); spawnSet = true; }
    if(atkCD > 0) atkCD -= dt;
    updateArrows(dt);
    if(hurtFlash > 0){ hurtFlash -= dt*3; if(hurtFlash <= 0) vig.style.opacity = '0'; }
    if(dead){ return; }   // ★게임오버 = 부활 없음(gameOver 화면의 "다시 시도"=reload) — 사령관
    // HP 재생
    if(regenWait > 0) regenWait -= dt;
    else if(hp < maxHp){ hp = Math.min(maxHp, hp + REGEN*dt); refreshHud(); }
    // 스태미나 회복
    if(stamWait > 0) stamWait -= dt;
    else if(stamina < STAM_MAX){ stamina = Math.min(STAM_MAX, stamina + STAM_REGEN*dt); if(stamina>=STAM_MAX)_exhausted=false; refreshStam(); }   // 100% 회복 시 탈진 해제
  });

  // ─────── 공개 인터페이스 ───────
  ctx.combat = {
    hitPlayer,
    gameOver,                    // ⚔️ 외부 게임오버 트리거(배 반파 등 — navalcombat)
    envHurt,                     // 환경 피해(온도 위험존 등) — temperature.js가 호출
    meleeSwing,                  // 휘두름 whoosh = 스윙 시작 즉시
    meleeHit,                    // 임팩트(칼 닿는 순간) = sword_hit + 데미지숫자
    spinHit,                     // 양손 우클릭 스핀(360° 광역)
    shieldSlam,                  // 기사 Q 궁극기 = 방패 충격파(게이지 가득 시)
    get guardCharge(){ return guardCharge; },
    guardMax: GUARD_MAX,
    get guardReady(){ return guardCharge >= GUARD_MAX; },
    stunNearest,                 // 쌍수 킥 = 정면 몬스터 스턴
    frontGroggyTarget,           // ★타격감 D: 정면 그로기 몹(난타 게이트) — player.js use()가 사용
    dropAggro,                   // 단검 투명 시 어그로 해제
    fireArrow,                   // 원거리 발사(활·석궁) — player.js use()가 발사 프레임에 호출
    execArrowVolley,             // ★헌터 그로기 처형 화살비(hitfx.flashHit bow 분기가 호출)
    fireWindVolley,              // 레인저 Q 궁극기 = 바람화살 유도 8발
    _arrows: arrows,             // 디버그
    _soulDrops: soulDrops,       // 디버그 — 영혼 물리 드롭 목록
    _spawnSoulDrop: spawnSoulDrop,
    _damageMonster: damageMonster,
    useStamina,                  // 공격/회피 전 스태미나 소모 시도 (false=부족)
    drainSprint,                 // 스프린트 지속 소모 (false=탈진)
    get exhausted(){ return _exhausted; },
    get stamina(){ return stamina; },
    maxStamina: STAM_MAX,
    get hp(){ return hp; },
    set hp(v){ hp = Math.max(0, Math.min(maxHp, v)); refreshHud(); },
    get maxHp(){ return maxHp; },   // ★레벨 성장으로 가변 → 게터
    get atkMul(){ return atkMul(); },   // 현재 공격 배수(디버그·HUD)
    get level(){ return level; },   // 🌙 게이트(gate.js)가 등급 선택(레벨 매칭)에 사용
    get cls(){ return BAL.level._cls(_cls); },
    isDead(){ return dead; },
    heal(v){ hp = Math.min(maxHp, hp + v); refreshHud(); },
    usePotion,   // 🧪 힐링 포션 사용(H키·UI 버튼)
    get hasRevive(){ return !!(ctx.inventory && ctx.inventory.count('revivestone')>0); },   // 💠 부활석 소지 여부(HUD 표시용)
    // ── 레벨/경험치 ──
    get level(){ return level; }, get xp(){ return xp; }, get xpMax(){ return xpMax; },
    addXp,
    // ── 세이브 복원(레벨·경험치·HP·영혼) — save.js restore가 호출. maxHp는 레벨 파생이라 재계산. ──
    applySave(sv){ if(!sv) return;
      if(sv.level!=null) level=Math.max(1, Math.min(BAL.level.cap, sv.level|0));
      xpMax=BAL.level.xpForNext(level); if(sv.xp!=null) xp=Math.max(0, sv.xp);
      maxHp=BAL.level.hpAt(_cls, level); hp=(sv.hp!=null)?Math.max(0, Math.min(maxHp, sv.hp)):maxHp;
      if(sv.soul!=null) soul=Math.max(0, sv.soul|0);
      try{ refreshHud(); }catch(_){} try{ refreshSoul(); }catch(_){} },
    // ── 토모브의 영혼 (재화) ──
    get soul(){ return soul; },
    addSoul,
    spendSoul(n){ if(soul < n) return false; soul -= n; refreshSoul(); return true; },
    /** 처치 콜백 자리 (보상/퀘스트 연동) — 외부에서 덮어쓰기. (mn, soulDrop) */
    _onKill: null,
    onKill(fn){ this._onKill = fn; },
    /** 부활 스폰 갱신 — 깨어남(카브 해안) 시 호출. 오프닝이 첫 프레임 caravel 갑판(바다) 위치를 잡던 것 교정(사령관: 추위사망 후 바다 위 부활 버그). */
    setSpawn(x,y,z){ _spawn.set(x,y,z); spawnSet=true; },
  };
  console.log('[combat] 초기화 — 좌클릭 근접공격, HP', maxHp);
  return ctx.combat;
}

function _el(tag, css){ const e = document.createElement(tag); if(css) e.style.cssText = css.replace(/\s+/g,' ').trim(); return e; }
