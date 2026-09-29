// Windgate 20b: preserve v20 terrain/gameplay and apply one more hand-authored polish pass.
import {initAuroraRefuge as initV20} from './aurora-refuge-v20.js?v=20a';
import {authorWindgate20b} from './windgate20b-polish.js?v=20b';

export async function initAuroraRefuge(ctx,options={}){
  const island=await initV20(ctx,options);
  const baseReady=island.ready;
  island.ready=baseReady.then(async()=>{
    authorWindgate20b(ctx,island);
    island.qualityVersion='aurora-v20b-hand-polished';
    return island;
  });
  return island;
}
