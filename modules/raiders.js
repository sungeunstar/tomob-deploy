// raiders.js — 부족(종족) 습격병 스폰 오케스트레이션 (Phase 2, 9종족 개편).
//   ★습격병 = 그 종족의 실제 모델(추종자 모델)로 스폰 → ctx.monsters 등록 → 타워 자동포격·전투 자동연동.
//     정체성 = 종족 모델(각기 다름) + 진영 문양 배지. 스탯은 공용(BAL.raider_warrior), 모델/애니만 종족별.
//   콘센트: ctx.spawnMonster(monsters.js — opts.def 지원)·ctx.tribes(tribes.js) 읽기/호출만. 이 파일만 수정.
import { tribeById, sigilUrl, raiderTribes, RAIDER_TRIBE_IDS } from '/tomob-deploy/modules/tribes.js';
import { BAL } from '/tomob-deploy/modules/balance.js';

const BASE = BAL.monsters.stats.raider_warrior;   // 습격병 공용 스탯(어그로 큼=거점 쇄도)

// 종족 → monsters.js 스폰용 def(모델·애니타입·roles + 공용 스탯).
function peopleDef(pe){
  return { k:'raider_'+pe.id, ko:pe.ko+' 습격병', url:pe.model, scale:1.8, raider:true,
    ...BASE,
    ...(pe.anim==='kaykit' ? { type:'kaykit' } : {}),   // 밀수꾼 = 외부 Rig_Medium
    ...(pe.roles ? { roles:pe.roles } : {}) };          // Polyart = 커스텀 클립명 매핑
}

export function initRaiders(ctx){
  if(!ctx.spawnMonster) console.warn('[raiders] ctx.spawnMonster 없음 — monsters.js 먼저 로드 필요.');

  // 습격병 1기 — 그 종족 모델로.
  function spawnRaider(peopleId, opts={}){
    const pe = tribeById(peopleId) || raiderTribes()[0];
    if(!pe || !ctx.spawnMonster) return false;
    ctx.spawnMonster({ def:peopleDef(pe), at:opts.at, atR:opts.atR, aggro:(opts.aggro!==false), ignoreMax:(opts.ignoreMax!==false),
      wander:(opts.wander!==false),   // ★2026-07-10(사령관 "종족들이 겹쳐서 정지"): 거점 방어병은 기본 배회 — 겹침·고정 방지
      sigil:sigilUrl(pe.id), tribe:pe.id, raider:true, tag:opts.tag });   // 배지=진영 문양(모델이 주 정체성이라 틴트는 생략) · ★BUG-018 tag=스폰 소스 거점 참조 그대로 전달
    return true;
  }

  // ★종족 모델 프리로드 — 습격 발동 순간 GLB/FBX+애니세트+텍스처+셰이더 콜드로드가 프레임드랍 원인.
  //   raid.js가 배 접근(warn) 시 호출 → 상륙 땐 캐시 clone만.
  function preloadRaider(peopleId){ const pe=tribeById(peopleId)||raiderTribes()[0]; if(pe && ctx.preloadMonster) ctx.preloadMonster(peopleDef(pe)); }

  // 습격 파티(같은 종족 N기).
  function spawnRaidParty(peopleId, opts={}){
    const pe = tribeById(peopleId) || raiderTribes()[0];
    if(!pe) return 0;
    const count = Math.max(1, opts.count||4);
    if(ctx.preloadMonster) ctx.preloadMonster(peopleDef(pe));   // 프리로드(이미 됐으면 no-op)
    // ★스폰 스태거 — 8명 동시 skeletonClone+Box3×2+AnimationMixer가 한 프레임에 몰려 드랍 → 프레임당 1명씩 분산.
    let n=0, acc=0; const disp=ctx.onUpdate(dt=>{ acc+=dt;
      if(acc>=0.06){ acc=0; if(n<count){ spawnRaider(pe.id, { at:opts.at, atR:opts.atR, aggro:opts.aggro, ignoreMax:true, wander:opts.wander, tag:opts.tag }); n++; }   // ★BUG-018 tag 전파
        else if(ctx.offUpdate){ ctx.offUpdate(disp); } } });
    console.log('[raiders] 습격 파티 —', pe.ko, count+'기(스태거)', opts.at?('@ '+Math.round(opts.at.x)+','+Math.round(opts.at.z)):'(플레이어 주변)');
    return count;
  }

  ctx.raiders = { spawnRaider, spawnRaidParty, preloadRaider, RAIDER_TRIBE_IDS,
    // 디버그(검증): 플레이어 주변에 습격 파티 즉시 투입
    _debugRaid(peopleId, count){ const at=ctx.player?.pos ? { x:ctx.player.pos.x, z:ctx.player.pos.z } : null;
      return spawnRaidParty(peopleId||RAIDER_TRIBE_IDS[0], { at, count:count||4 }); } };
  console.log('[raiders] 부족 습격병 등록 — 습격종족', RAIDER_TRIBE_IDS.join(','));
  return ctx.raiders;
}
