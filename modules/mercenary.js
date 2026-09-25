// mercenary.js — 🗡️ 몬스터 용병. 사령관 확정 2026-08-07 "그 던전을 점령하면 던전 몬스터를 용병으로 영입".
//   던전을 클리어하면 그 안에서 실제로 쓰러뜨린 몬스터 중 가장 강한 1종이 굴복해 용병 명부에 들어온다.
//   명부의 용병은 내 거점(깃발)에 배치하면 그 몬스터 모델 그대로 수비병이 되어 순찰·방어한다.
//
//   [기존 시스템 재사용 — 새 전투 AI를 또 만들지 않는다]
//     배치 = garrison.placeDef(island, def) — 기존 용병(수비대) 경로 그대로. 정찰·교전·피격·저장이 전부 공유된다.
//     차이는 모델과 이름이 MERCS 고정 4종이 아니라 "내가 잡은 몬스터"라는 것뿐.
//   ★던전 클리어 = 유일한 획득 경로(골드로 살 수 없음). 던전을 도는 이유 = 용병 풀이 늘어나는 것.
//   수치 SSOT = BAL.mercenary (balance.js).
import { BAL } from '/tomob-deploy/modules/balance.js';
import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';

export function initMercenary(ctx){
  const M = () => BAL.mercenary;
  const toast = (t, accent='gold') => { try{ ukToast(t, { accent, ms:3200 }); }catch(_){} };

  // 명부: [{ k, ko, url, h, tier, deployed }] — deployed = 배치된 거점 이름(null이면 대기).
  const roster = [];

  // ── 던전 클리어 시 호출: 이번 런에서 쓰러뜨린 몹 중 1종을 용병으로 포섭 ──
  //   mobs = 이번 런의 몬스터 인스턴스 배열(mn.def에 k/ko/url/scale 보유). tier = 던전 티어.
  function captureFrom(mobs, tier){
    if(!Array.isArray(mobs) || !mobs.length) return null;
    if(roster.length >= M().cap){ toast(`용병 명부가 가득 찼습니다 (${M().cap}명) — 배치하거나 해고하세요`, 'red'); return null; }

    // 후보 = 이번 런에서 본 몹의 def를 종류별로 1개씩. 보스는 굴복시키지 못한다(설계: 보스는 처치 대상).
    const byKind = new Map();
    for(const mn of mobs){
      const d = mn && mn.def; if(!d || !d.url || !d.k) continue;
      if(mn.isBoss || d.type === 'dragonboss') continue;
      if(!byKind.has(d.k)) byKind.set(d.k, d);
    }
    // 이미 명부에 있는 종은 제외(같은 종 중복 영입 금지 — 던전을 여러 곳 돌 이유)
    for(const r of roster) byKind.delete(r.k);
    const cands = [...byKind.values()];
    if(!cands.length) return null;

    // 가장 강한 종(hp+공격력 기준) 1종이 굴복 — "정복"의 전리품이라 랜덤보다 성취에 비례하게.
    cands.sort((a,b)=> ((b.hp||0) + (b.atk||0)*8) - ((a.hp||0) + (a.atk||0)*8));
    const d = cands[0];
    const rec = {
      k: d.k, ko: d.ko || d.k, url: d.url,
      h: Math.max(M().minHeight, Math.min(M().maxHeight, (d.scale || 1.8) * M().heightScale)),
      tier: tier || 1, deployed: null,
    };
    roster.push(rec);
    toast(`${rec.ko}이(가) 굴복했습니다 — 용병으로 합류 (명부 ${roster.length}/${M().cap})`, 'gold');
    toast('거점 반경 안에서 제작 → [거점] → 용병 배치로 수비병으로 세울 수 있습니다', 'cyan');
    if(ctx.events) ctx.events.emit('mercenaryCaptured', rec);
    console.log('[mercenary] 용병 영입 —', rec.k, rec.ko, 'tier', rec.tier, '· 명부', roster.length + '/' + M().cap);
    return rec;
  }

  // ── 배치: 대기 중인 용병 1명을 지정 거점의 수비병으로 ──
  function deploy(island, idx){
    if(!island || island.owner !== 'player') return { ok:false, reason:'거점이 아닙니다' };
    const i = (idx != null) ? idx : roster.findIndex(r => !r.deployed);
    const r = roster[i];
    if(!r) return { ok:false, reason:'배치할 수 있는 용병이 없습니다 — 던전을 정복해 영입하세요' };
    if(r.deployed) return { ok:false, reason:`${r.ko}은(는) 이미 ${r.deployed}에 배치돼 있습니다` };
    if(!ctx.garrison || !ctx.garrison.placeDef) return { ok:false, reason:'수비대 시스템을 사용할 수 없습니다' };

    // 거점당 수비 상한 = 기본 + 막사 효과(기존 recruit과 같은 규칙 — 이원화 금지)
    const gar = ctx.settlement?.effectSum ? (ctx.settlement.effectSum(island, 'garrison') || 0) : 0;
    const cap = (BAL.economy?.mercCap ?? 4) + gar;
    if(ctx.garrison.mercCount && ctx.garrison.mercCount(island) >= cap)
      return { ok:false, reason:`이 거점의 수비 상한에 도달했습니다 (${cap}명)` };

    const ok = ctx.garrison.placeDef(island, { url:r.url, nm:r.ko, h:r.h }, { patrol:true });
    if(!ok) return { ok:false, reason:'배치 위치를 찾지 못했습니다' };
    r.deployed = island.name || '거점';
    toast(`${r.ko} 배치 — ${r.deployed}을(를) 지킵니다`, 'green');
    if(ctx.events) ctx.events.emit('mercenaryDeployed', r, island);
    return { ok:true, merc:r };
  }

  // 내가 지금 서 있는 거점에 배치(제작 탭 [거점] 항목이 호출 — 섬 고르는 UI 없이 현재 위치 기준)
  function deployHere(){
    const op = ctx.outpost, p = ctx.player && ctx.player.pos;
    const isl = (op && op.outpostAt && p) ? op.outpostAt(p.x, p.z) : null;
    if(!isl) return { ok:false, reason:'거점 반경 안에서만 배치할 수 있습니다 — 깃발을 세운 곳으로 가세요' };
    return deploy(isl, null);
  }

  const waiting = () => roster.filter(r => !r.deployed).length;

  // ── 💾 저장/복원 ──
  //   배치된 개체(3D)는 garrison.serialize가 이미 왕복시킨다 — 여기선 명부(누구를 영입했나)만 저장.
  function snapshot(){ return roster.map(r=>({ k:r.k, ko:r.ko, url:r.url, h:r.h, tier:r.tier, deployed:r.deployed || null })); }
  function restore(arr){
    if(!Array.isArray(arr)) return;
    roster.length = 0;
    for(const r of arr){ if(r && r.k && r.url) roster.push({ ...r, deployed: r.deployed || null }); }
  }

  ctx.mercenary = { roster, captureFrom, deploy, deployHere, snapshot, restore,
    waiting, cap: ()=>M().cap, count: ()=>roster.length };
  window.__merc = ctx.mercenary;   // 콘솔 실측용
  console.log('[mercenary] 몬스터 용병 등록 — 던전 클리어 시 최강 1종 굴복. 명부 상한', M().cap);
  return ctx.mercenary;
}
