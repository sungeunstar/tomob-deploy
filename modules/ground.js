// ground.js — 🗺️ 지형 쿼리 SSOT (리팩토링 R4 — 근거=_REFACTOR_점검.md)
// 문제: 해안/육지 판정이 3벌 제각각 — wharf(seaDir: groundAt>wl+0.6) / gate(자체 물리레이+마진) / wave(절대값 0.8)
//       → 같은 지점을 두고 "여긴 육지/저긴 바다" 판정이 모듈마다 갈릴 수 있던 것. 여기 한 곳으로 통일.
// 정책 (레이캐스트 선택 기준 — R4 명시 요구):
//   · 기본 = ctx.terrain.groundAt (THREE 레이캐스트, BVH 가속, collide 배열 기반) — 보행·건설·스폰 등 전부.
//   · 예외 = gate.js colliderGroundY (Rapier 물리레이) — 게이트는 "물리 콜라이더가 실존하는 바닥"이 필요
//     (몹이 실제로 설 수 있는 지점 보장 + 스트리밍 섬의 collide/물리 등록 시차 대응). gate 내부 유지, 신규 사용 금지.
// 사용: initGround(ctx) 후 ctx.ground.{groundAt,waterLevel,isLand,seaDir,isOpenSea}. 전부 ctx 지연 참조(초기화 순서 무관).
export function initGround(ctx){
  const wl = () => ctx.water ? (ctx.water.level||0) : 0;
  const groundAt = (x, z, fromY=5000) => ctx.terrain ? ctx.terrain.groundAt(x, z, fromY) : 0;

  // 육지 판정 — 수면 + margin(기본 0.6 = 구 wharf 기준) 초과 지면. 얕은 물턱/해안 슬리버는 margin으로 걸러짐.
  const isLand = (x, z, margin=0.6) => groundAt(x, z) > wl() + margin;

  // 바다 방향 감지(해안에서 가장 가까운 물 방향) — 구 wharf.js seaDir 구현 이관(16방향×8스텝, BVH 가속).
  // 반환: { x, z, dist } (단위벡터+해안까지 거리) 또는 null(반경 32m 내 물 없음 = 내륙).
  function seaDir(x, z){
    let best=null, bd=1e9;
    for(let a=0; a<16; a++){ const ang=a/16*Math.PI*2;
      for(let d=4; d<=32; d+=4){ const sx=x+Math.cos(ang)*d, sz=z+Math.sin(ang)*d;
        if(groundAt(sx,sz) < wl()+0.6){ if(d<bd){ bd=d; best={ x:Math.cos(ang), z:Math.sin(ang), dist:d }; } break; } } }
    return best;
  }

  // 외해 판정 — "배가 정박·기동할 물 공간이 있는가". 구 wharf.js 구현 이관(정박가능성 기준 — 작은 못만 차단).
  function isOpenSea(x, z){
    const sea=seaDir(x,z); if(!sea) return false;
    const e=sea.dist; let w=0;
    for(const d of [e+16, e+40, e+70]){ if(groundAt(x+sea.x*d, z+sea.z*d) < wl()+0.4) w++; }
    return w>=2;
  }

  ctx.ground = { groundAt, waterLevel:wl, isLand, seaDir, isOpenSea };
  console.log('[ground] 지형 쿼리 SSOT 등록 — isLand/seaDir/isOpenSea 단일 구현(구 wharf·wave 3벌 통일)');
  return ctx.ground;
}
