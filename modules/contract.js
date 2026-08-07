// contract.js — 📜 배송 계약(데스 스트랜딩식). 항구에서 "저 위험 해역 너머 X섬까지 배송" 의뢰를 받고 도달 시 보상.
//   ★사령관 설계(2026-07-03): 위험할수록·멀수록 보상↑. 목표 해역 위험도(중심 근접도)와 거리로 보수 스케일.
//   흐름: 항구 근접(승선 항해 중) → [B] 의뢰 수락 → 목표섬 마커(❗) → 도달 → 골드+평판(+영혼) 보상 → 쿨다운.
//   위험도 = seaevents.riskAt(중심 근접도) 공유(opts.riskAt 주입). 미주입 시 자체 폴백(동일식).
//   의존: ctx.worldmap.islands(항구 목록) · ctx.ship/ctx.player · ctx.inventory · ctx.reputation · ctx.combat.addSoul · ctx.camera.
//   수치 SSOT = balance.js BAL.contracts. 미탑재 시 아래 DEF 폴백(SSOT 이관 전 안전).
import * as THREE from 'three';
import { toast, compass as ukCompass } from './uikit.js';

const DEF = { baseGold: 80, riskMul: 3.0, distMul: 0.04, soulReward: 10, cooldownSec: 20,
              offerRange: 140, arrivePad: 70, minDist: 500, maxDist: 3400 };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function initContract(ctx, opts = {}){
  const rng = opts.rng || Math.random;
  const CFG = () => Object.assign({}, DEF, ctx.balance && ctx.balance.contracts);
  // 위험도(0=외곽~1=중심). seaevents와 동일 축 — 주입 우선, 없으면 자체 계산(riskMax 4200 폴백).
  const riskAt = opts.riskAt || ((x, z) => { const rm = (ctx.balance && ctx.balance.naval && ctx.balance.naval.encounter && ctx.balance.naval.encounter.riskMax) || 4200; return 1 - clamp(Math.hypot(x, z) / rm, 0, 1); });

  const ports = ((ctx.worldmap && ctx.worldmap.islands) || []).filter(i => i.hasPort);
  if(!ports.length) console.warn('[contract] 항구 섬 없음 — 계약 비활성(worldmap 필요)');

  let _active = null;       // { target, reward, soul, originId }
  let _cooldown = 0;
  let _offerPort = null;    // 현재 근접 항구(의뢰 발주처)
  let _offer = null;        // 이 항구에서의 목표/보상 미리보기

  const pp = () => ctx.player && ctx.player.pos;

  // ── 목표 항구 선정: 원점보다 안쪽(위험)이고 minDist~maxDist 거리대. 위험·거리 가중 랜덤(데스 스트랜딩=험지행). ──
  function pickTarget(origin){
    const c = CFG();
    const cand = [];
    for(const t of ports){
      if(t === origin || t.id === (origin && origin.id)) continue;
      const d = Math.hypot(t.x - origin.x, t.z - origin.z);
      if(d < c.minDist || d > c.maxDist) continue;
      const w = 0.4 + riskAt(t.x, t.z) * 1.6;   // 위험한(중심) 목표일수록 뽑힐 확률↑
      cand.push({ t, d, w });
    }
    if(!cand.length) return null;
    let tot = 0; for(const o of cand) tot += o.w;
    let r = rng() * tot; let sel = cand[0];
    for(const o of cand){ r -= o.w; if(r <= 0){ sel = o; break; } }
    return sel;
  }

  function makeOffer(origin){
    const sel = pickTarget(origin);
    if(!sel) return null;
    const c = CFG();
    const tRisk = riskAt(sel.t.x, sel.t.z);
    const gold = Math.round(c.baseGold * (1 + c.riskMul * tRisk) + sel.d * c.distMul);
    const soul = Math.round(c.soulReward * (0.5 + tRisk));
    return { target: sel.t, dist: sel.d, risk: tRisk, gold, soul, originId: origin.id };
  }

  function accept(){
    if(_active || !_offer) return;
    _active = _offer; _offer = null;
    hideOffer();
    _cmp.setVisible(true);
    const rk = _active.risk > 0.66 ? '극위험' : _active.risk > 0.33 ? '위험' : '평이';
    toast(`배송 의뢰 수락 — 목표 [${rk}] 해역 · 보상 ${_active.gold}골드`, { ms: 4200, accent: 'gold' });
  }

  function complete(){
    const a = _active; _active = null; _cooldown = CFG().cooldownSec;
    _cmp.setVisible(false);
    if(ctx.inventory && ctx.inventory.addGold) ctx.inventory.addGold(a.gold);
    if(ctx.reputation && ctx.reputation.applyAction) ctx.reputation.applyAction('QUEST_DONE');   // +25
    if(a.soul > 0 && ctx.combat && ctx.combat.addSoul) ctx.combat.addSoul(a.soul);
    toast(`배송 완수 — +${a.gold}골드 · +영혼 ${a.soul} · 평판 상승`, { ms: 4200, accent: 'gold' });
  }

  // ── 의뢰 프롬프트(항구 근접 시) ──
  const offer = document.createElement('div');
  offer.style.cssText = 'position:fixed;left:50%;bottom:172px;transform:translateX(-50%);z-index:55;display:none;'
    + 'background:rgba(10,14,20,.88);border:1px solid rgba(255,210,120,.5);color:#f4ead0;'
    + 'font:600 13px Pretendard,system-ui;padding:9px 16px;border-radius:11px;pointer-events:none;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,.45);letter-spacing:.01em;white-space:nowrap;text-align:center';
  document.body.appendChild(offer);
  function showOffer(o){ const rk = o.risk > 0.66 ? '극위험' : o.risk > 0.33 ? '위험' : '평이'; offer.innerHTML = `배송 의뢰 — <b style="color:#ffd27a">[B]</b> 수락 <span style="color:#8f8">·</span> <span style="color:#c7bfa8">[${rk}] 해역 · ~${o.gold}골드</span>`; offer.style.display = 'block'; }
  function hideOffer(){ offer.style.display = 'none'; }

  // ── 목표 마커 — uikit.compass(상단 나침반 바) 재사용(2026-07-10, questline.js와 동일 사유: 화면 투영식은
  //   마우스룩할 때마다 화면 안을 널뛰어서 "마우스 따라다닌다"는 지적. 절대 방위만 계산해서 넘기면 컴포넌트가 처리. ──
  const _camDir = new THREE.Vector3();
  const _bearing = (dx,dz) => ((Math.atan2(dx,dz)*180/Math.PI)+360)%360;
  const _cmp = ukCompass({
    getHeading(){ if(!ctx.camera) return 0; ctx.camera.getWorldDirection(_camDir); return _bearing(_camDir.x,_camDir.z); },
    getMarkers(){
      const a=_active, p=pp(); if(!a || !p) return [];
      const d = Math.hypot(p.x - a.target.x, p.z - a.target.z);
      return [{ bearing:_bearing(a.target.x-p.x, a.target.z-p.z), dist:Math.round(d)+'m', accent:'gold' }];
    },
  });
  _cmp.setVisible(false);

  const _onKey = e => { if((e.code === 'KeyB' || e.key === 'b' || e.key === 'B') && _offer && !_active) accept(); };
  addEventListener('keydown', _onKey);

  const _disp = ctx.onUpdate(dt => {
    if(!dt || dt <= 0) return;
    if(_cooldown > 0) _cooldown -= dt;
    const s = ctx.ship, p = pp();
    if(!p){ hideOffer(); return; }

    if(_active){
      // 방향 마커(_cmp)는 uikit.compass 자체 rAF 루프가 getMarkers()로 매프레임 갱신 — 별도 호출 불필요.
      const d = Math.hypot(p.x - _active.target.x, p.z - _active.target.z);
      if(d <= _active.target.r + CFG().arrivePad) complete();   // 목표 항구 도달 = 완수
      hideOffer();
      return;
    }

    // 계약 없음 → 항구 근접 시 의뢰 제안(항해 중 + 쿨다운 지난 뒤)
    if(_cooldown > 0 || !s || !s.boarded || !ports.length){ hideOffer(); return; }
    const c = CFG();
    let near = null, bd = c.offerRange;
    for(const port of ports){ const d = Math.hypot(p.x - port.x, p.z - port.z); if(d < bd){ bd = d; near = port; } }
    if(!near){ hideOffer(); _offerPort = null; return; }
    if(near !== _offerPort){ _offerPort = near; _offer = makeOffer(near); }   // 새 항구 진입 = 의뢰 1건 생성
    if(_offer) showOffer(_offer); else hideOffer();
  });

  console.log('[contract] 초기화 — 항구', ports.length, '곳 배송 계약 활성([B] 수락). baseGold', CFG().baseGold);

  return {
    get active(){ return _active; },
    accept, complete,
    dispose(){ removeEventListener('keydown', _onKey); ctx.offUpdate && ctx.offUpdate(_disp); offer.remove(); _cmp.dispose(); },
  };
}

// [근거]
// 확정: 항구 발주 배송 = 데스 스트랜딩식(위험 해역·거리↑ → 보상↑). (출처: 사령관 2026-07-03)
// 확정: 완수 평판 = REP_ACTIONS.QUEST_DONE(+25) 재사용 · 영혼 = ctx.combat.addSoul. (출처: reputation.js:34 / combat.js:1033)
// 확정: 목표 마커 = uikit.compass() 상단 나침반 바(2026-07-10~). (출처: questline.js 동일 컴포넌트 사용)
// 제안: baseGold80·riskMul3.0·distMul0.04·soul10, 수락키 [B]. balance.js SSOT 이관 전 폴백(사령관 튜닝 대기).
// 미정: 계약을 trader NPC 교역창(ctx.trade)에 통합 = 후속(현재는 항구 근접 독립 프롬프트).
