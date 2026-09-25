// seaevents.js — 🌊 해역 위험도 이벤트: ① 해적 랜덤 조우(중심 근접 가중) + ② 상선 약탈.
//   ★사령관 설계(2026-07-03 → 2026-07-12 개정 "공격 = 바로 전투"): 옛 설계(자유 항해 중 대포 발사는
//     navalcombat 조우 안에만 존재)를 폐기 — 좌클릭 함포는 상시 발사(navalcombat.initFreeFire, 본 모듈이 부팅).
//     ① 해적 조우 = 확률 발동 → startNavalEncounter(적선). 맵 중심(0,0 거대항)으로 갈수록 확률·척수↑.
//     ② 상선 약탈 = 플레이어 포탄이 상선에 '명중'하면 그 자리서 즉시 전투배 스폰(약체) → 격침 시 화물 드랍+골드+평판↓.
//        ([E] 확인 게이트 폐지 — 프롬프트는 안내문으로만 유지. 첫 명중탄 데미지는 전투배 HP로 이월.)
//   공통 축: 위험도 = 1 - clamp(원점거리/riskMax). 세 시스템(조우·약탈·계약)이 이 값 하나를 공유.
//   의존: ctx.ship(플레이어 배) · ctx.npc(상선) · ctx.inventory · ctx.reputation · navalencounter.startNavalEncounter.
//   수치 SSOT = balance.js BAL.naval.encounter / BAL.naval.merchant. 미탑재 시 아래 DEF 폴백(SSOT 이관 전 안전).
import { startNavalEncounter } from '/tomob-deploy/modules/navalencounter.js';
import { initFreeFire } from '/tomob-deploy/modules/navalcombat.js';   // ⚓ 상시 함포(좌클릭 = 조우 무관 broadside) — 2026-07-12 통일
import { toast } from '/tomob-deploy/modules/uikit.js';
import { WORLD_SCALE as WS } from '/tomob-deploy/modules/islands.js';   // 🧭 상선 pos=canon 원단위 → 3D 스폰은 ×WS(좌표공간 규약)

// balance.js 이관 전 폴백 기본값(탑재되면 ctx.balance.naval.* 우선).
const DEF = {
  // evadeDist/evadeHoldSec: 조우 이탈(도망) 판정 — far 스폰거리(≤230)보다 넉넉히 커야 스폰 접근단계와 안 겹침.
  encounter: { ratePerMin: 0.5, centerBoost: 2.5, riskMax: 4200, cooldownSec: 90, minGapSec: 20, evadeDist: 500, evadeHoldSec: 5, ashoreHoldSec: 1.2 },
  merchant:  { lootRange: 60, promptRange: 90, hp: 55, dropRate: 0.6, goldPer: 8, enemyFireCd: 9, enemySpread: 2.4 },
};
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function initSeaevents(ctx, opts = {}){
  const rng = opts.rng || Math.random;
  initFreeFire(ctx);   // ⚓ 상시 함포 바인딩(1회) — 자유 항해 중 좌클릭 = broadside(조우 불필요)
  const ENC = () => Object.assign({}, DEF.encounter, ctx.balance && ctx.balance.naval && ctx.balance.naval.encounter);
  const MER = () => Object.assign({}, DEF.merchant,  ctx.balance && ctx.balance.naval && ctx.balance.naval.merchant);

  // 위험도(0=외곽 안전 ~ 1=중심 거대항). 원점(0,0) = 맵 정중앙(worldmap 대형섬1 고정).
  function riskAt(x, z){ const c = ENC(); return 1 - clamp(Math.hypot(x, z) / (c.riskMax || 4200), 0, 1); }

  let _cooldown = 0, _sinceBoard = 0, _busy = false;

  // ── navalcombat 승패까지 대기(Promise) — ★승리 = 적 '전멸'(사령관 버그: 대표선만 잡으면 나머지가 영구 잔존하던 것)
  //    / 플레이어 완파(pSunk — navalcombat이 반파 처리)=lose ──
  function runBattle(enc){
    return new Promise(resolve => {
      if(!enc || !enc.naval){ resolve(null); return; }
      const c = ENC();
      let evade = 0;   // 살아있는 적선과 멀어진 채 유지된 누적 시간(초)
      let ashore = 0;  // 하선+육지 상태 유지된 누적 시간(초) — 버그④ 상륙 종료조건
      let noShip = 0;  // ctx.ship이 연속 null로 유지된 누적 시간(초) — 버그BUG-017 타임아웃 가드
      const poll = ctx.onUpdate((dt) => {
        const st = enc.naval.state && enc.naval.state();
        if(!st) return;
        if(enc.enemies && enc.enemies.length && enc.enemies.every(E => E._sunk)){ ctx.offUpdate && ctx.offUpdate(poll); resolve('win'); return; }
        if(st.pSunk){ ctx.offUpdate && ctx.offUpdate(poll); resolve('lose'); return; }
        // ★이탈(evaded) 판정 — 없으면 도망 시 Promise 영구 미완 → _busy 고착 + cleanup/dispose 누락(유령 배 누적).
        //   살아있는 적선과의 최소거리가 evadeDist 이상으로 evadeHoldSec 지속 → 종료. 그 전엔 리셋(스폰 접근단계 오판 방지).
        // ★버그BUG-017: ctx.ship이 여러 프레임 연속 null이면(배 해체/재생성 트랜지션 등 엣지케이스) 아래 evade/ashore
        //   판정이 전부 스킵된 채 return만 반복 → 승패도 안 나면 이 Promise가 영영 resolve 안 됨 → await하는 startPiracy/
        //   startPirateEncounter가 _busy=false를 못 돌려 _busy 영구 고착 → 이후 checkMerchantHits가 게이트에 막혀
        //   상선을 명중해도 조용히 무시됨. ship이 shipLostSec(기본4초) 이상 연속 없으면 evaded로 강제 종료(정상 경로와 동일 정리).
        const s = ctx.ship;
        if(!s){ noShip += (dt || 0.016); if(noShip >= (c.shipLostSec || 4)){ ctx.offUpdate && ctx.offUpdate(poll); resolve('evaded'); } return; }
        noShip = 0;   // ship 복귀 시 누적 리셋(순간 null 오판 방지)
        let minD = Infinity;
        for(const E of enc.enemies){ if(E._sunk) continue; const d = Math.hypot(E.x - s.x, E.z - s.z); if(d < minD) minD = d; }
        if(minD >= (c.evadeDist || 500)){ evade += (dt || 0.016); if(evade >= (c.evadeHoldSec || 5)){ ctx.offUpdate && ctx.offUpdate(poll); resolve('evaded'); } }
        else evade = 0;
        // ★버그④: 육상 하선 종료조건 — 배에서 내려 육지에 서 있으면 진행 중 해전을 종료(그 전엔 미해결 Promise가
        //   영구 남아 navalcombat.dispose() 미호출 → 배 HP바+격침배너가 잔존). 순간 오판 방지로 짧은 유예(ashoreHoldSec) 지속 확인.
        if(ctx.ship && !ctx.ship.boarded && ctx.ground && ctx.ground.isLand && ctx.player && ctx.player.pos){
          const pp = ctx.player.pos;
          if(ctx.ground.isLand(pp.x, pp.z)){ ashore += (dt || 0.016); if(ashore >= (c.ashoreHoldSec || 1.2)){ ctx.offUpdate && ctx.offUpdate(poll); resolve('ashore'); } }
          else ashore = 0;
        } else ashore = 0;
      });
    });
  }
  // 전투 종료 후 잔존 적선 정리 — 패배 시 살아남은 적선이 AI 정지 상태로 바다에 영구 방치되던 것 → 침몰 처리
  function cleanupEnemies(enc){
    try { if(enc && enc.enemies) for(const E of enc.enemies){ if(!E._sunk && enc.naval && enc.naval.forceSink) enc.naval.forceSink(enc.enemies.indexOf(E)); } } catch(_){}
    // ★버그①: 격침 잔해(shipwreck.chunks)가 새 전투/전환 시 정리 안 돼 무한 물소리 원인 → 전투 종료마다 회수
    try { ctx.shipwreck && ctx.shipwreck.clear && ctx.shipwreck.clear(); } catch(_){}
  }

  // ══════════════════════════════════════════════════════════
  //  ① 해적 랜덤 조우 — 항해 중 확률 발동, 중심 근접할수록 자주 + 다수
  // ══════════════════════════════════════════════════════════
  async function startPirateEncounter(risk){
    _busy = true; _cooldown = ENC().cooldownSec;
    let cnt = risk > 0.66 ? 3 : risk > 0.33 ? 2 : 1;   // 중심(위험)일수록 함대 규모↑
    // ★E1(2026-07-15): 현상금 발동 시 사냥꾼 1척 합류(기존 조우 강화, 신규 함대 스폰 아님). navalencounter가 max=3으로 클램프 → 완만.
    if(ctx.reputation && ctx.reputation.bountyActive) cnt += 1;
    toast(`수평선에 적 해적선 ${cnt}척!`, { ms: 4200, accent: 'red' });
    const enc = await startNavalEncounter(ctx, {
      count: cnt, keys: ['queen', 'caravel', 'empty'].slice(0, cnt),
      far: 230, revealDelay: 0, naval: { respawn: false },
    });
    const r = await runBattle(enc);
    if(r === 'win'){
      ctx.reputation && ctx.reputation.applyAction && ctx.reputation.applyAction('KILL_PIRATE');
      if(ctx.settlement && ctx.settlement.nearestOwned && ctx.settlement.bumpGrowth && ctx.player?.pos){   // 🌱 축3 연결: 내 섬 근처 해전 승리 → 그 섬 안정도↑(소유 섬 없으면 no-op)
        const owned = ctx.settlement.nearestOwned(ctx.player.pos.x, ctx.player.pos.z);
        if(owned) ctx.settlement.bumpGrowth(owned, 'stability', 3);
      }
      toast('적 함대 전멸 — 평판 상승', { ms: 3200, accent: 'gold' });
    }
    else if(r === 'evaded') toast('적을 따돌렸다 — 시야에서 벗어남', { ms: 3000, accent: 'cyan' });
    cleanupEnemies(enc);   // ★패배/이탈 시 잔존 적선 침몰 처리(유령 배 방지)
    try { enc && enc.naval && enc.naval.dispose && enc.naval.dispose(); } catch(_){}
    _busy = false; _cooldown = ENC().cooldownSec;
  }

  // ══════════════════════════════════════════════════════════
  //  ② 상선 약탈 — near 상선 접근 → [E] 확인 → 그 자리에 약체 전투배 → 격침 시 노획
  // ══════════════════════════════════════════════════════════
  function lootMerchant(m){
    const c = MER();
    const inv = ctx.inventory;
    const qty = Math.max(1, Math.round((m.qty || 20) * c.dropRate));
    const gold = Math.round(qty * c.goldPer);
    // 화물(rum/silk/spice/gem)은 화물칸(loadCargo)에. 꽉 차면 골드로 환산 보상(전리품 유실 방지).
    let loaded = false;
    if(inv && inv.loadCargo) loaded = inv.loadCargo(m.cargo, qty);
    if(inv && inv.addGold) inv.addGold(loaded ? gold : gold + Math.round(qty * c.goldPer * 1.5));
    if(ctx.reputation && ctx.reputation.applyAction) ctx.reputation.applyAction('ATTACK_MERCHANT');   // -20 (평판 하락)
    toast(loaded ? `약탈 성공 — ${m.cargo} ×${qty} 노획 · 평판 하락`
                 : `약탈 성공 — 화물칸 가득참 → 골드 환산 · 평판 하락`, { ms: 3600, accent: 'gold' });
  }

  async function startPiracy(m, firstHitDmg){
    _busy = true; _cooldown = ENC().cooldownSec;
    if(ctx.npc && ctx.npc.setPirated) ctx.npc.setPirated(m, true);   // 원 상선 숨김(전투배가 대신 섬)
    const c = MER();
    const key = (ctx.npc && ctx.npc.modelKeyOf) ? ctx.npc.modelKeyOf(m) : 'empty';   // ★전투배 모델=원 상선과 동일 크기(하드코딩 'empty' → 배 크기 급변 버그)
    const enc = await startNavalEncounter(ctx, {
      count: 1, keys: [key], at: { x: m.pos.x*WS, z: m.pos.z*WS }, far: 0, revealDelay: 0,   // 🧭 canon→월드. ★far:0=상선 자리 그대로(새 배 먼바다 등장 버그 수정 — 2026-07-12 상시발사 개편에서도 유지)
      naval: { respawn: false, enemyMaxHp: c.hp, enemyFireCd: c.enemyFireCd, enemySpread: c.enemySpread, aiTurn: 0.4 },
    });
    // ★전투 개시 명중탄 데미지 이월([E] 폐지 — "때리면 바로 전투"의 그 한 발). 최소 1 남김 = 개시 즉시 침몰 방지.
    if(firstHitDmg && enc && enc.enemies && enc.enemies[0]){
      const E = enc.enemies[0]; E.hp = Math.max(1, E.hp - firstHitDmg);
    }
    const r = await runBattle(enc);
    cleanupEnemies(enc);   // ★잔존 적선 정리
    try { enc && enc.naval && enc.naval.dispose && enc.naval.dispose(); } catch(_){}
    if(r === 'win'){ lootMerchant(m); if(ctx.npc && ctx.npc.removeMerchant) ctx.npc.removeMerchant(m); }   // 격침 = 노획 + 상선 소멸
    else {                                                        // 실패(반파)/이탈(도망) = 상선 복귀
      if(ctx.npc && ctx.npc.setPirated) ctx.npc.setPirated(m, false);
      if(r === 'evaded') toast('추격 중단 — 상선을 놓쳤다', { ms: 3000, accent: 'cyan' });
    }
    _busy = false; _cooldown = ENC().cooldownSec;
  }

  // ── 약탈 안내 프롬프트(near 상선 감지 시 표시) — ★[E] 발동 폐지(2026-07-12): 포격 명중 = 즉시 전투. 안내문만. ──
  const prompt = document.createElement('div');
  prompt.id = 'piracy-prompt';
  prompt.style.cssText = 'position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:55;display:none;'
    + 'background:rgba(14,10,10,.86);border:1px solid rgba(255,90,90,.55);color:#ffdede;'
    + 'font:600 13px Pretendard,system-ui;padding:9px 16px;border-radius:11px;pointer-events:none;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,.45);letter-spacing:.01em;white-space:nowrap';
  document.body.appendChild(prompt);
  function showPrompt(m){ prompt.innerHTML = `상선 — <b style="color:#ff8a8a">함포 좌클릭</b> 명중 시 약탈 전투 <span style="color:#c99">(평판 하락)</span>`; prompt.style.display = 'block'; }
  function hidePrompt(){ prompt.style.display = 'none'; }

  // ── ★플레이어 포탄 ↔ 상선 명중 판정 — 명중 = 그 자리서 즉시 약탈 전투(첫 발 데미지 이월) ──
  //   내 배(owner===ctx.ship) 포탄만. 수평 반경 + 수면 위 높이 근사(돛대 위 통과탄 제외). npc.nearestMerchant = 월드좌표·_pirated/_removed 제외.
  const MERCH_HIT_R = 20;   // 명중 반경(월드 m) — 상선 선체(길이 24~56) 절반 + 여유 근사
  function checkMerchantHits(s){
    // ★버그②: 튜토/오프닝 중엔 상선 명중해도 본편 전투(startPiracy) 미발동 — navalAllowed()는 재사용 금지
    //   (ownedIslands>=2 조건까지 걸려 튜토 이후 정상 약탈까지 과차단됨). 통합 술어만 사용.
    if(ctx.ai && ctx.ai.director && ctx.ai.director.tutoOrOpening && ctx.ai.director.tutoOrOpening()) return false;
    if(!ctx.cannon || !ctx.npc || !ctx.npc.nearestMerchant) return false;
    const projs = ctx.cannon.projectiles;
    if(!projs || !projs.length) return false;
    const wl = ctx.water ? ctx.water.level : 0;
    for(const pr of projs){
      if(pr.t <= 0 || pr.owner !== s) continue;
      const p = pr.mesh.position;
      if(p.y > wl + 16) continue;   // 선체 높이 위 통과탄 무시
      const near = ctx.npc.nearestMerchant(p.x, p.z, MERCH_HIT_R);
      if(!near || !near.e) continue;
      pr.t = 0;                                             // 포탄 소거(다음 cannon 루프서 정리)
      if(ctx.cannon.explode) ctx.cannon.explode(p.x, p.y, p.z);   // 명중 폭발 연출
      hidePrompt();
      const dmg = (ctx.balance && ctx.balance.naval && ctx.balance.naval.cannonDmg) || 7;
      startPiracy(near.e, dmg);                             // 즉시 전투 개시(_busy 즉시 true — async 첫 줄)
      return true;
    }
    return false;
  }

  // ── 매 프레임: 조우 확률 누적 + 약탈 프롬프트 근접 판정 ──
  const _disp = ctx.onUpdate(dt => {
    if(window.__noNaval){ hidePrompt(); return; }   // 🧪 임시 테스트: 적선 조우·상선약탈 OFF (game.html 토글, 복구 ?combat=1)
    if(!dt || dt <= 0) return;
    const s = ctx.ship;
    if(_busy){ hidePrompt(); return; }
    if(_cooldown > 0) _cooldown -= dt;
    if(s && checkMerchantHits(s)) return;   // ★포탄 명중 → 즉시 약탈 전투(조타 여부 무관 — 갑판 상시발사 포함)
    if(!s || !s.boarded){ _sinceBoard = 0; hidePrompt(); return; }   // 이하 조우 확률·안내 프롬프트는 조타(항해) 중에만
    _sinceBoard += dt;

    // ② 약탈 프롬프트 — 가장 가까운 near 상선이 promptRange 안이면 표시
    const c = MER();
    const near = ctx.npc && ctx.npc.nearestMerchant ? ctx.npc.nearestMerchant(s.x, s.z, c.promptRange) : null;
    if(near && near.dist <= c.lootRange) showPrompt(near.e); else hidePrompt();

    // ① 해적 조우 — 쿨다운·최소유예 지나면 위험도 가중 확률
    // 🧠 디렉터 게이팅(ai.js): 튜토(온보딩) 중이거나 점령 섬 < 2면 조우 미발동 (사령관 2026-07-04 지시 — §E 공정 난이도 + 튜토 중 전투 강제시작 버그 해소).
    //   상선 약탈(위 ②)은 플레이어 주도라 게이트 안 함.
    if(ctx.ai && ctx.ai.director && !ctx.ai.director.navalAllowed()) return;
    const e = ENC();
    if(_cooldown > 0 || _sinceBoard < e.minGapSec) return;
    const risk = riskAt(s.x, s.z);
    // ★E1(2026-07-15): 현상금 발동 시 해적 조우 확률 가중(×1.5) — 헌터 압박을 기존 확률에 곱하기만(완만, 좌절 방지).
    const bountyMul = (ctx.reputation && ctx.reputation.bountyActive) ? 1.5 : 1;
    const p = (e.ratePerMin / 60) * (1 + e.centerBoost * risk) * bountyMul * dt;
    if(rng() < p){
      // ★섬 근처(200m 내 육지)면 해적 조우 안 함 — 먼 해역에서만(사령관). 확률 통과 시에만 8방향 샘플(비용↓).
      const wl = ctx.water ? ctx.water.level : 0; let nearLand = false;
      for(let a=0;a<8;a++){ const ang=a/8*6.283;
        if(ctx.terrain && ctx.terrain.groundAt(s.x+Math.cos(ang)*200, s.z+Math.sin(ang)*200, 400) > wl+0.4){ nearLand = true; break; } }
      if(!nearLand) startPirateEncounter(risk);   // 섬 200m 밖 = 먼 해역 → 조우
    }
  });

  console.log('[seaevents] 초기화 — ① 해적 랜덤 조우(중심가중) + ② 상선 약탈(포격 명중 = 즉시 전투) + 상시 함포. riskMax', ENC().riskMax);

  return {
    riskAt,                       // 위험도 조회(계약 시스템 contract.js 공유)
    startPirateEncounter, startPiracy,   // 수동 트리거(디버그/계약 연계)
    dispose(){ ctx.offUpdate && ctx.offUpdate(_disp); prompt.remove(); },
  };
}

// [근거]
// 확정(2026-07-12 개정): "공격 = 바로 전투" — 좌클릭 함포 상시 발사(navalcombat.initFreeFire를 본 모듈이 부팅)
//   + 상선은 [E] 없이 포탄 명중 = 즉시 전투(첫 발 데미지 이월). (출처: 사령관 Phase A 지시 2026-07-12)
// 확정(구): 자유항해 대포 발사는 navalcombat(조우) 내부에만 존재 → ①②를 조우 엔진 재사용으로 구현 — 위 개정으로 폐기. (출처: navalcombat.js 구버전)
// 확정: 위험도 = 원점(0,0) 근접도. 맵 중앙 = 대형섬1(거대항) 고정. (출처: worldmap.js:44 add(0,0,'large'))
// 확정: 약탈 평판 -20 = REP_ACTIONS.ATTACK_MERCHANT / 계약 완수 +25 = QUEST_DONE. (출처: reputation.js:31,34 — 기존 액션 재사용)
// 제안: 조우 확률 0.5/분·중심 ×3.5, 약탈 상선 hp55·드랍율0.6·골드8/개. balance.js SSOT 이관 전 폴백값(사령관 튜닝 대기).
// 미정: 다중 함대(3척) 완전 격침 판정은 현재 대표선(eSunk) 기준 — 잔여선 처리 후속.
