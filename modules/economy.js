// economy.js — voyage 가벼운 가짜경제(_GAME_DESIGN §6 "가벼운 가짜경제부터"). 정본 맵 위에 얹는 데이터 레이어.
//   입력: worldMap(generateWorldMap 결과/정본). 출력: { prices, merchants, territory } — 전부 결정론(seed).
//   ★데모용: 영토(territory)는 "가장 가까운 스폰에 귀속"한 가짜 소유권(실제 게임은 서버 점령 상태로 대체).

export const GOODS = [
  { k:'rum',   ko:'럼',     base:30 },
  { k:'silk',  ko:'비단',   base:80 },
  { k:'spice', ko:'향신료', base:60 },
  { k:'gem',   ko:'보석',   base:120 },
];

// ── M4 동적 재고경제 (18_교역경제_재고depth_스프링.md §1·§2) ──
//   가격 = basePrice × stockFactor(stock/ref) × repMod. 재고↑=쌈(factor↓). depth=거래가 stock을 밂.
export const STOCK_REF = 100;                   // 보통항 기준재고(ratio 1.0 = basePrice)
const STOCK_SOURCE = 180;                       // 산지 초기재고(ratio 1.8 → factor~0.55, 싸게 매수처)
const STOCK_SINK   = 40;                         // 소비항 초기재고(ratio 0.4 → clamp 상한, 비싸게 매도처)
export const STOCK_FLOOR = 5, STOCK_CAP = 300;  // 재고 하한/상한(0·무한 방지)
// 품목별 clamp[floor,ceil] — 차익 배율 차등(보석 독주 억제, doc §6-1). 럼 4배 / 보석 2.1배
export const GOOD_CLAMP = { rum:[0.5,2.0], spice:[0.6,1.8], silk:[0.6,1.8], gem:[0.8,1.35] };   // 보석 독주 억제(차익 1.69x)

// 가격계수 = clamp(ref/stock, floor, ceil). 재고 많을수록(stock↑) factor↓(쌈).
export function stockFactor(stock, goodKey){
  const c = GOOD_CLAMP[goodKey] || [0.5, 2.0];
  const s = Math.max(STOCK_FLOOR, stock || 0);
  const f = STOCK_REF / s;                       // = 1/ratio
  return f < c[0] ? c[0] : (f > c[1] ? c[1] : f);
}

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

export function generateEconomy(world, { seed=1, merchantCount=26 } = {}){
  const rnd = mulberry32(((seed||1)*2246822519) >>> 0);
  const byId = new Map(world.islands.map(i=>[i.id,i]));

  // ── 항구 시세: 항구(비-얼음)별 good 가격 = base × 섬해시(0.6~1.5). 섬마다 싸고 비싼 게 다름 → 차익 ──
  const ports = world.islands.filter(i=>i.hasPort);
  const prices = {};
  for(const p of ports){
    prices[p.id] = {};
    for(const g of GOODS){ const h=Math.abs(Math.sin(p.x*0.0131 + p.z*0.0173 + g.base*0.7)); prices[p.id][g.k]=Math.round(g.base*(0.6+h*0.9)); }
  }

  // ── NPC 경제 상선: 항로(routes) 중 골라 배치. 진행도·화물·속도·방향(살아있는 바다) ──
  //   ★speed(progress/초)는 항로 실거리에 반비례 — 고정값이면 맵 스케일(ringStep)이 줄 때마다 화면상 속도감이
  //   비례 없이 빨라짐(사령관 2026-07-09 "너무 빠른데" 피드백). ROUTE_PACE=캔버스 유닛/초 기준 페이스.
  const ROUTE_PACE = 58;
  const merchants = [];
  for(let i=0;i<merchantCount && world.routes.length;i++){
    const r = world.routes[(rnd()*world.routes.length)|0];
    const A = byId.get(r.from), B = byId.get(r.to);
    if(!A || !B) continue;
    const dist = Math.hypot(A.x-B.x, A.z-B.z);
    const speed = (ROUTE_PACE*(0.8+rnd()*0.4)) / Math.max(1, dist);
    merchants.push({ id:'npc'+i, from:r.from, to:r.to, progress:rnd(), speed, dir: rnd()<0.5?1:-1, cargo:GOODS[(rnd()*GOODS.length)|0].k, qty:20 });
  }

  // ── 영토(데모): 거대항·얼음 제외, 각 섬을 가장 가까운 스폰에 귀속(Voronoi) → 색칠하면 영토 블롭 ──
  const spawns = world.spawns.map(s=>({ slot:s.slot, isle:byId.get(s.islandId) })).filter(s=>s.isle);
  const territory = {};
  for(const isle of world.islands){
    if(isle.tier==='large' || isle.tier==='ice') continue;          // 거대항·얼음 = 중립
    let best=null, bd=1e18;
    for(const sp of spawns){ const dx=isle.x-sp.isle.x, dz=isle.z-sp.isle.z, d=dx*dx+dz*dz; if(d<bd){ bd=d; best=sp; } }
    if(best) territory[isle.id]=best.slot;
  }

  // ── 항구별 good 재고(M4): 결정론 역할 배정(산지/소비항/보통) → 초기 stock. stockFactor가 산지=쌈·소비항=비쌈 자연 발생 ──
  //   ★기존 rnd 시퀀스(merchants/territory 배치) 보존 위해 stock 전용 PRNG(별도 seed offset) 사용.
  const rndS = mulberry32((((seed||1) * 0x9E3779B1) ^ 0x5A17) >>> 0);
  const stock = {};
  for(const p of ports){
    stock[p.id] = {};
    for(const g of GOODS){
      const r = rndS();
      const srcChance = (g.k === 'gem') ? 0.07 : 0.30;     // 산지 비율(보석 산지 희소 — doc §6-1, 독주 억제로 7%)
      if(r < srcChance)               stock[p.id][g.k] = STOCK_SOURCE;   // 산지(과잉=쌈)
      else if(r < srcChance + 0.30)   stock[p.id][g.k] = STOCK_SINK;     // 소비항(부족=비쌈)
      else                            stock[p.id][g.k] = STOCK_REF;      // 보통항(basePrice)
    }
  }

  return { GOODS, prices, merchants, territory, stock, spawnCount: spawns.length };
}

// 슬롯(플레이어) → 색. 0..n-1 균등 hue.
export function slotColor(slot, n){ const h=((slot-1)*360/Math.max(1,n))%360; return `hsl(${h.toFixed(0)},62%,56%)`; }
export function slotColorA(slot, n, a){ const h=((slot-1)*360/Math.max(1,n))%360; return `hsla(${h.toFixed(0)},62%,56%,${a})`; }

// [근거]
// 확정: 가벼운 가짜경제(시세+NPC상선 데이터만, 풀 시뮬 X) — _GAME_DESIGN §6. 결정론 seed — §1-A 서버권위.
// 제안(작성자): 시세 해시 0.6~1.5, NPC 26척, 영토=최근접 스폰 Voronoi(데모) — 시각 검증용 초기값.
//   실제 게임: territory는 서버 점령 상태, prices는 항로 수급 연동으로 교체(§9 빌드순서).
