// physics.js — Rapier 물리 world. 한 책임: 물리 시뮬 스텝.
// 출처: voyage/index.html:164-165, 532 (world.step). await RAPIER.init() 필수.
import RAPIER from 'https://esm.sh/@dimforge/rapier3d-compat@0.14.0';

export async function initPhysics(ctx, { gravity=-22 }={}){
  await RAPIER.init();
  const world = new RAPIER.World({ x:0, y:gravity, z:0 });
  ctx.RAPIER = RAPIER;
  ctx.world = world;
  // ★ world.step()은 캐릭터 이동 계산 '뒤'에 와야 하므로 자동 등록하지 않음.
  //   game.html에서 player init 뒤에 ctx.onUpdate(()=>world.step())로 마지막에 등록.
  ctx.stepPhysics = ()=>world.step();
  return { RAPIER, world };
}
