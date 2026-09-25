// raid.js — 습격 이벤트 (Phase 5, 위협 엔진). 점령 섬을 적대 종족이 주기적으로 습격.
//   흐름: 점령 섬 보유 → (유예) → 습격 예고 배너 → 상륙(습격병 스폰, 내 깃발 노림) → 방어 →
//         전멸=격퇴 보상 / 곁을 안 지키면 capture.js가 깃발 넘겨 섬 상실.
//   콘센트: ctx.claimed(내 섬)·ctx.capture(방어 거점·역방향 게이지)·ctx.raiders(습격병)·ctx.monsters·ctx.inventory. 이 파일만 수정.
import { BAL } from '/tomob-deploy/modules/balance.js';
import { tribeById, raiderTribes } from '/tomob-deploy/modules/tribes.js';
import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';

export function initRaid(ctx){
  const R = BAL.raid;
  let enabled = true, nextT = R.firstDelaySec, active = null;
  const toast = (t,acc='red') => ukToast(t, { accent:acc, ms:3000 });
  const PFAC = (new URLSearchParams(location.search).get('faction')||'').trim();

  // ★시작섬(홈 반경) = 습격 대상/카운트 제외(사령관: 시작 섬에선 습격 X, 실제 정복 섬만).
  const HOME = (ctx.terrain && ctx.terrain.spawn) ? { x:ctx.terrain.spawn.x, z:ctx.terrain.spawn.z } : { x:0, z:0 };
  const isStartIsland = c => Math.hypot((c.x||0)-HOME.x, (c.z||0)-HOME.z) < 900;
  const ownedIslands = () => (ctx.claimed||[]).filter(c => c.owner==='player' && !isStartIsland(c));
  // 🎯 습격 표적 선정 — 🌱**안정도(growth.stability)가 낮은 섬이 더 자주 노려진다.**
  //   감사 B2(2026-07-22): stability는 settlement/trade/combat/seaevents가 **쓰기만 하고 아무도 읽지 않는 죽은 축**이었다.
  //   여기 연결해 "막사·궁수장·우물을 짓고 근처를 토벌하면 그 섬이 덜 습격당한다"는 인과를 만든다.
  //   가중치 = 1/(1 + stability/STAB_HALF) → 안정 0=1.0배 / 40=0.5배 / 120=0.25배. 0이 되지는 않는다(완전 면역 금지).
  const STAB_HALF = 40;
  const stabW = c => 1 / (1 + Math.max(0, (c.growth && c.growth.stability) || 0) / STAB_HALF);
  function pickTarget(owned){
    if(!owned.length) return null;
    let total = 0; const w = owned.map(c => { const v = stabW(c); total += v; return v; });
    if(!(total > 0)) return owned[(Math.random()*owned.length)|0];
    let r = Math.random() * total;
    for(let i=0;i<owned.length;i++){ r -= w[i]; if(r <= 0) return owned[i]; }
    return owned[owned.length-1];
  }
  function pickTribe(){ const rs=raiderTribes(); const hostile=rs.filter(t=>t.lean!==PFAC); const pool=hostile.length?hostile:rs; return pool[(Math.random()*pool.length)|0]; }
  const partySize = n => Math.min(R.partyMax, R.partyBase + R.partyPerIsle*Math.max(0, n-1));

  function livingUnits(){ if(!active||!ctx.monsters) return 0; let n=0; for(const m of ctx.monsters){ if(m.raider && !m.dead && m.tribe===active.tribe) n++; } return n; }
  const islandStillMine = () => !!active && ownedIslands().some(c => c===active.island || Math.hypot(c.x-active.island.x, c.z-active.island.z) < 8);

  function startRaid(owned, immediate, skipPrewarn){
    const island = pickTarget(owned); if(!island) return;
    const tribe = pickTribe();
    if(ctx.raiders && ctx.raiders.preloadRaider) ctx.raiders.preloadRaider(tribe.id);   // ★배 접근 동안 종족 모델 프리로드 → 상륙 시 clone만(프레임드랍 방지)
    if(ctx.capture && ctx.capture.ensureOutpost) ctx.capture.ensureOutpost(island.x, island.z, 'player');   // 방어 거점(역방향 게이지 표적) 보장
    active = { tribe:tribe.id, tribeKo:tribe.ko, island, phase:'prewarn', t:0, spawned:false, seen:0, count:partySize(owned.length), usingShip:false };
    if(immediate){ toast(''+tribe.ko+' 상륙!'); doSpawn(); return; }   // 디버그 강제(즉시)만 배 없이
    // ★1분 사전 경보(사령관 2026-07-15): 습격선 접근(warn) 전에 preWarnSec 예고 → 방어 준비 시간 부여. skipPrewarn=디버그.
    const lead = Math.max(0, R.preWarnSec|0);
    if(skipPrewarn || lead <= 0){ beginApproach(); return; }
    toast('⚠ '+Math.round(lead)+'초 후 '+tribe.ko+' 부족의 습격 — '+(island.name||'거점')+' 방어 준비!', 'red');
  }
  // 습격선 접근 개시(사전 경보 종료 후 or preWarnSec=0). 기존 warn 로직을 분리.
  function beginApproach(){
    if(!active) return;
    active.phase='warn'; active.t=0;
    // ★배 상륙 필수(사령관): 적 NPC가 배 타고 상륙 — 갑자기 스폰 금지. raidship 준비 안 됐으면(proto 미로드/바다없음) 습격 연기.
    if(ctx.raidship && ctx.raidship.approach){
      const app = ctx.raidship.approach(active.island, { dur:R.warnLeadSec, onLanded:()=>{ if(active && !active.spawned) doSpawn(); } });
      if(app){ active.usingShip=true; toast(''+active.tribeKo+' 부족의 습격선이 다가온다 — '+(active.island.name||'거점')); }
      else { active=null; nextT=Math.max(20, R.warnLeadSec); }   // 배 못 띄움 → 잠시 후 재시도(배 없이 스폰 안 함)
    } else { active=null; nextT=Math.max(20, R.warnLeadSec); }
  }
  function doSpawn(){
    if(!active) return;
    if(ctx.raiders && ctx.raiders.spawnRaidParty) ctx.raiders.spawnRaidParty(active.tribe, { at:{ x:active.island.x, z:active.island.z }, count:active.count });
    active.phase='active'; active.spawned=true;
    toast(''+active.tribeKo+' 상륙! 거점을 지켜라 ('+active.count+'명)');
  }
  function endRaid(coolN, sink){ if(ctx.raidship && ctx.raidship.depart) ctx.raidship.depart(!!sink);   // 격퇴=격침 / 상실·타임아웃=퇴각
    // ★섬 많을수록 잦아지되 하한 15분(사령관: 하루 1번). ÷섬수 → ÷√섬수로 완만하게(2섬=×0.71, 4섬=×0.5).
    active=null; nextT = Math.max(900, R.intervalSec / Math.max(1, Math.sqrt(coolN))); }

  ctx.onUpdate(dt=>{
    if(!enabled) return;
    if(active){
      active.t += dt;
      if(active.phase==='prewarn'){
        // ★사전 경보 카운트다운. 이 동안 섬을 잃으면 습격 취소. 종료 시 습격선 접근 개시.
        if(!islandStillMine()){ endRaid(ownedIslands().length, false); return; }
        if(active.t >= Math.max(0, R.preWarnSec|0)) beginApproach();
        return; }
      if(active.phase==='warn'){
        // ★배 상륙(raidship onLanded)이 유일한 스폰 트리거(갑자기 스폰 폐지). 상륙이 너무 오래 실패하면 습격 취소(무한 warn 방지).
        if(!active.spawned && active.t >= R.warnLeadSec + 20){ endRaid(ownedIslands().length, false); }
        return; }
      const living = livingUnits(); active.seen = Math.max(active.seen, living);
      // ★E3(2026-07-15): 궁수장(archeryrange) defArchers 배선 — 습격 중 그 섬 궁수장 수만큼 가장 가까운 습격병에게
      //   초당 소량 자동 딜(타워 자동포격 축소판). effectSum 재사용. 소량(궁수1당 5/s, 습격병 hp150≈30s) — 난이도 붕괴 방지·수비 보조.
      if(active.spawned && ctx.monsters){
        const na = ctx.settlement?.effectSum ? (ctx.settlement.effectSum(active.island, 'defArchers')||0) : 0;
        if(na > 0){ active.arch = (active.arch||0) + dt;
          if(active.arch >= 1){ active.arch -= 1; const dmg = 5*na;
            let best=null, bd=1e9; for(const m of ctx.monsters){ if(!m.raider || m.dead || m.tribe!==active.tribe) continue;
              const q=m.grp.position, d=(q.x-active.island.x)*(q.x-active.island.x)+(q.z-active.island.z)*(q.z-active.island.z); if(d<bd){ bd=d; best=m; } }
            if(best){ best.hp -= dmg; if(best.hp<=0 && best.kill) best.kill(); }
          }
        }
      }
      if(!islandStillMine()){ toast(''+active.tribeKo+'에게 거점을 빼앗겼다…'); endRaid(ownedIslands().length, false); return; }   // 상실 → 배 퇴각
      if(active.spawned && active.seen>0 && living===0){                                                                    // 전멸 = 격퇴 → 배 격침
        const gold=R.repelGold; ctx.inventory?.addGold?.(gold);
        toast(''+active.tribeKo+' 습격 격퇴! +'+gold+' 금화 (습격선 격침)', 'cyan'); endRaid(ownedIslands().length, true); return; }
      if(active.t > 360) endRaid(ownedIslands().length, false);   // 안전 타임아웃
      return;
    }
    const owned = ownedIslands();
    if(owned.length < 2){ nextT = R.firstDelaySec; return; }   // ★섬 2개 이상 정복해야 습격(사령관: 시작섬 제외, 2개 되기 전 X)
    nextT -= dt;
    if(nextT<=0) startRaid(owned, false);
  });

  ctx.raid = {
    setEnabled:v=>{ enabled=!!v; },
    status:()=>({ enabled, nextT:Math.round(nextT), active: active?{ tribe:active.tribe, phase:active.phase, living:livingUnits() }:null }),
    // 디버그(검증/테스트): 즉시 습격(예고 생략, 바로 상륙)
    _forceRaid(withShip){ const owned=ownedIslands(); if(!owned.length){ console.warn('[raid] 점령 섬 없음 — 습격 불가'); return false; } if(active) endRaid(owned.length); startRaid(owned, !withShip, true); return true; },   // withShip=true면 배 접근 연출(사전경보 생략=디버그 즉시)
  };
  console.log('[raid] 습격 이벤트 등록 — 첫 습격 유예', R.firstDelaySec+'s · 간격', R.intervalSec+'s÷섬수 · 점령 섬 있을 때만.');
  return ctx.raid;
}
