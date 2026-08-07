// npc.js — voyage NPC AI 시스템. (DoD: voyage/_tasks/npc_ai.md / 리그, 게임팀)
//   ★단계 a+b+c: 상태머신 코어 + 자동교역/수급 시세 + 3D LOD 표현. (d 도망·해적 = 후속 단계, 미구현)
//   economy.generateEconomy 가 만든 NPC 상선(merchants)을 실제 상태머신 행동체로 실체화.
//   상태: SAILING → DOCKING → TRADING(매도·매수=수급변동) → DECIDING → DEPARTING → SAILING (항로 그래프 순회).
//   교역 = 살아있는 경제: 입항 시 화물 매도(supply↓)+최저가 매수(supply↑) → 항구별 시세(priceAt) 변동. drift 로 자연 회복.
//   3D LOD(단계 c): 플레이어 거리별 near=로우폴리 메시 / mid=빌보드 스프라이트 / far=데이터만.
//   (c 보강) near 풀메시에만 ship.js식 항해감: 4점 프로브 부력(출렁/roll·pitch) + 돛 펄럭임 셰이더. mid/far 는 현행 직선.
//   ctx.onUpdate(dt) 콜백으로 매 프레임 전 상선 상태 + 수급 drift + LOD 거리 체크 + near 부력/돛 갱신.
import { generateEconomy, GOODS, stockFactor, STOCK_FLOOR, STOCK_CAP } from './economy.js';
import { WORLD_SCALE as WS } from './islands.js';   // 🧭 canon→월드 SSOT — ★상태머신/경제는 canon 원단위 유지, 3D 접점(메시·스프라이트·거리)만 ×WS
                                                    //   (버그: 상선 메시가 canon 원좌표에 놓여 ×1.5 시각세계와 어긋나 "엉뚱한 섬 앞 뭉침" — 사령관 2026-07-04)
import { TRADE_GOODS } from './inventory.js';   // basePrice 단일 출처(동결 콘센트, 읽기만)
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

// ── 밸런스 수치 (npc_ai.md §2-A 수치표 단일 출처) ──
const CRUISE_SPEED  = 5;      // u/s — 상선 순항속도(플레이어 8보다 느림). progress 증분 기준
const DOCK_WAIT     = 3.0;    // s   — 입항 체류(DOCKING 대기) 시간
// 경제(M4 동적 재고 — 18_교역경제_재고depth_스프링.md): 가격=basePrice×stockFactor(stock/ref). NPC가 stock을 qty 단위로 운반.
const NPC_QTY = 20;   // NPC 상선 1척 적재량(재고 단위, doc §3-4). economy merchant.qty 기본과 동일
const HOME_DRIFT = 0.004;   // /s — 항구 성격재고(homeStock) 방향 회귀율(시정수 ~250s). 산지 재충전·소비항 재고갈 → 차익루트 재개. doc §3-4 [제안] 플레이테스트 수정(밸런스)
// LOD 표현(단계 c) — §2-A LOD·표현 수치표
const NEAR      = 2200;   // u — 풀메시 전환. 이 거리 안은 진짜 메시(이미지 아님). 빌보드는 그 너머 먼 배만
const MID       = 4000;   // u — 스프라이트(빌보드) 표시 상한. 멀리 있는 배만 작은 이미지로. 초과 = 데이터만(FAR)
const NEAR_MAX  = 8;      // 척 — 동시 풀메시 상한. 초과분 스프라이트 폴백
const SHIP_LEN  = 22;     // u — 상선 메시 길이(ship.js oseberg 기본과 동일 스케일)
const NPC_DRAFT = 2;      // u — 흘수(선체 하부가 수면 아래로 살짝 잠김)
// ── (c 보강) near 풀메시 항해감: 부력(4점 프로브 + 스프링댐퍼) + 돛 펄럭임. ship.js 부력/flutter 패턴 참조(읽기만) ──
const HEAVE_F   = 12;     // heave 추종률(/s) — buoyY → 목표 수면. ship.js _yf 계열(빠른 추종)
const TILT_F    = 9;      // roll/pitch 추종률(/s). ship.js _tf 계열
const MAX_TILT  = 0.35;   // rad — 최대 기울기(±20°). ship.js MAX_TILT
const clampT = (v) => v < -MAX_TILT ? -MAX_TILT : (v > MAX_TILT ? MAX_TILT : v);

// ── (T-02) ship.js applyLowpolyTone 로컬 재정의(복사) — ship.js named export 없어 모듈 수정 대신 내부 복사 ──
//   리얼/PBR 텍스처를 oseberg 우드 클레이 팔레트로 통일. 메시/머티리얼 이름 키워드 → 파트색 + 약발광.
function applyLowpolyTone(obj, THREE){
  const pick=(nm)=>{ nm=(nm||'').toLowerCase();
    if(/sail|cloth/.test(nm))   return 0xd9c7a0;
    if(/flag/.test(nm))         return 0xb24a3a;
    if(/rope|rigging|pulley|boom|rig/.test(nm)) return 0x5f4f37;
    if(/mast|pole|poker/.test(nm)) return 0x7a5d39;
    if(/deck|poop|hatch|floor|plank/.test(nm)) return 0xb48a52;
    if(/hull|keel|rudder|border|plate/.test(nm)) return 0x8a6a44;
    if(/cannon|anchor|wheel|bollard|ladder|fence|barrel|box|housing|lever|ratchet|support|stuff/.test(nm)) return 0x6e573a;
    return 0x836240; };
  obj.traverse(o=>{ if(o.isMesh){
    const onm=o.name||'', ms=Array.isArray(o.material)?o.material:[o.material];
    const nm2=ms.map(m=>{ const mnm=(m&&m.name)||''; const col=pick(onm+' '+mnm);
      const n=new THREE.MeshLambertMaterial({ color:col, side:THREE.DoubleSide, flatShading:true });
      n.emissive=new THREE.Color(col).multiplyScalar(0.16); n.name=mnm; return n; });
    o.material = Array.isArray(o.material) ? nm2 : nm2[0];
  }});
}

// 빌보드 스프라이트용 텍스처(코드 생성) — 거리(mid) 상선 마커. 단순 배 실루엣(선체+돛).
function makeSpriteTexture(THREE){
  const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d');
  g.clearRect(0,0,64,64);
  g.fillStyle='#e9dcc0'; g.beginPath(); g.moveTo(34,8); g.lineTo(34,40); g.lineTo(54,30); g.closePath(); g.fill();   // 돛(파치먼트)
  g.fillStyle='#5a3f28'; g.fillRect(33,8,2,38);                                                                       // 돛대
  g.fillStyle='#7a5532'; g.beginPath(); g.moveTo(12,42); g.lineTo(52,42); g.lineTo(46,54); g.lineTo(18,54); g.closePath(); g.fill();  // 선체
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.needsUpdate=true; return t;
}

// (버그① 수정) mid 빌보드 텍스처 = 실제 oseberg 모델을 측면 오프스크린 렌더 → near 풀메시와 톤·실루엣 일치.
//   navmap.js 섬 스프라이트 프리렌더 발상. 1회 렌더해 캐시(매 프레임 X). 실패 시 코드 텍스처 폴백.
function makeShipBillboard(THREE, renderer, tmpl){
  if(!renderer || !tmpl) return null;
  try {
    const RW=256, RH=144;
    const rt=new THREE.WebGLRenderTarget(RW, RH, { minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter });
    const sc=new THREE.Scene();
    const ship=tmpl.clone(true); sc.add(ship);
    sc.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl=new THREE.DirectionalLight(0xffffff, 0.85); dl.position.set(0.6, 1.4, 0.8); sc.add(dl);
    const box=new THREE.Box3().setFromObject(ship), sz=new THREE.Vector3(), ctr=new THREE.Vector3();
    box.getSize(sz); box.getCenter(ctr);
    const halfL=sz.z*0.5*1.08, halfH=sz.y*0.5*1.08;                  // 측면뷰: 길이축 z=가로 / 높이 y=세로
    const cam=new THREE.OrthographicCamera(-halfL, halfL, halfH, -halfH, 0.1, 4000);
    cam.position.set(ctr.x + Math.max(sz.x, 80)*2, ctr.y, ctr.z); cam.lookAt(ctr);   // +x 현측에서 촬영
    const pRT=renderer.getRenderTarget(), pCol=new THREE.Color(); renderer.getClearColor(pCol); const pA=renderer.getClearAlpha();
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
    renderer.setRenderTarget(pRT); renderer.setClearColor(pCol, pA);
    return { tex: rt.texture, aspect: halfL / Math.max(halfH, 0.01) };
  } catch(e){ console.warn('[npc] 빌보드 렌더 실패 → 코드 텍스처 폴백', e && e.message); return null; }
}

// oseberg 로드 실패 시 폴백 — 간단 로우폴리 보트(선체 박스 + 돛). 뱃머리 +z.
function fallbackBoat(THREE){
  const g=new THREE.Group();
  const hull=new THREE.Mesh(new THREE.BoxGeometry(6,2.2,SHIP_LEN), new THREE.MeshLambertMaterial({ color:0x8a6a44, flatShading:true }));
  hull.position.y=1.1; g.add(hull);
  const sail=new THREE.Mesh(new THREE.PlaneGeometry(5,7), new THREE.MeshLambertMaterial({ color:0xd9c7a0, side:THREE.DoubleSide }));
  sail.position.set(0,5,0); g.add(sail);
  return g;
}

// 5상태 (npc_ai.md ① 코어 AI 상태머신)
const STATES = { SAILING:'SAILING', DOCKING:'DOCKING', TRADING:'TRADING', DECIDING:'DECIDING', DEPARTING:'DEPARTING' };

// ── 🌱 항구별 누적 거래량 카운터(축6 종족섬 자동성장) ── portId → 누적치(부호 무관 |delta| 합).
//   플레이어 거래(applyPlayerTrade)·NPC 상선 운반(TRADING) 양쪽이 addStock 을 거치므로 여기 한 곳에서만 집계.
//   capture.js 가 ctx.npc.tradeVolume[portId] 를 읽어 임계값 도달 시 종족섬을 자동 성장(향후방향_v2 §5·§6).
const tradeVolume = {};

// 결정론 PRNG (다음 목적지 선택용 — economy/worldmap 과 동일 계열)
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// economy merchant.speed(0.05~0.13) → 순항 배율 0.8~1.2 정규화(±20% 개체변주, §2-A "속도 개체변주")
function speedMul(speed){ const m = 0.8 + ((speed - 0.05) / 0.08) * 0.4; return Math.max(0.7, Math.min(1.3, m)); }

export async function initNpc(ctx){
  // ── 1. worldMap 확보 — ctx.worldmap(게임 통합 시 initWorldMap 선행) 우선, 없으면 정본 canon.json ──
  //   (T-03) sandbox 는 worldmap 을 로드하지 않으므로 npc 가 정본을 직접 읽어 자급. ctx.worldmap 비었을 때만 채움.
  let worldMap = ctx.worldmap;
  if(!worldMap){
    try { worldMap = await fetch('/worldmap.canon.json?t='+Date.now()).then(r=>r.json()); }
    catch(e){ console.error('[npc] worldmap 로드 실패 — 중단', e && e.message); return null; }
    if(ctx) ctx.worldmap = worldMap;   // ctx 콘센트 슬롯 채움(파일 수정 아님). 게임 통합 시엔 이미 채워져 있어 건너뜀.
  }
  if(!worldMap || !Array.isArray(worldMap.islands) || !Array.isArray(worldMap.routes)){
    console.error('[npc] worldmap 데이터 불완전(islands/routes 없음) — 중단'); return null;
  }

  // ── 2. economy 결정론 상선 데이터(추론·하드코딩 금지 — generateEconomy 직접 구동) ──
  let economy;
  try { economy = generateEconomy(worldMap, { seed: worldMap.seed || 1 }); }
  catch(e){ console.error('[npc] economy.generateEconomy 실패 — 중단', e && e.message); return null; }

  const byId = new Map(worldMap.islands.map(i => [i.id, i]));

  // ── 2-b. 재고 상태 stock[portId][goodKey] (M4 동적 — doc 18 §1·§2) ──
  //   economy.stock(산지180/소비항40/보통100 결정론 분포)을 npc 인스턴스로 복사(이후 NPC운반·플레이어거래로 변동).
  const goodKeys = (GOODS && GOODS.length ? GOODS : economy.GOODS).map(g => g.k);   // ['rum','silk','spice','gem']
  const stock = {}, homeStock = {};   // stock=변동 / homeStock=항구 성격재고(불변 기준선, 회귀 목표)
  for(const portId in economy.stock){ stock[portId] = { ...economy.stock[portId] }; homeStock[portId] = { ...economy.stock[portId] }; }
  // 가격 = basePrice(동결) × stockFactor(stock/ref). 재고 많을수록 쌈. 평판보정(repMod)은 trade.js 에서 곱.
  function priceAt(portId, goodKey){
    const ps = stock[portId];
    if(!ps || ps[goodKey] == null) return null;       // 비-항구 또는 미지 good → null(에러 없이)
    const base = TRADE_GOODS[goodKey] && TRADE_GOODS[goodKey].basePrice;
    if(base == null) return null;
    return Math.max(1, base * stockFactor(ps[goodKey], goodKey));
  }
  // 재고 가감(하한 floor / 상한 cap). port 가 stock 에 없으면 무시. depth(플레이어 ∓1)·NPC운반(∓qty) 공용.
  function addStock(portId, goodKey, delta){
    const ps = stock[portId];
    if(!ps || ps[goodKey] == null) return;
    let v = ps[goodKey] + delta;
    if(v < STOCK_FLOOR) v = STOCK_FLOOR; else if(v > STOCK_CAP) v = STOCK_CAP;
    ps[goodKey] = v;
    // 🌱 축6: 이 항구에서 교역 활동 발생 → 누적 거래량 집계(사고팔고·NPC운반 전부 |delta| 절대값). capture.js 자동성장 트리거.
    tradeVolume[portId] = (tradeVolume[portId] || 0) + Math.abs(delta);
  }
  // 이 항구 최저가 good(priceAt 기준) — NPC 매수 대상("싼 데서 산다")
  function cheapestGood(portId){
    let best = goodKeys[0], bp = Infinity;
    for(const k of goodKeys){ const p = priceAt(portId, k); if(p != null && p < bp){ bp = p; best = k; } }
    return best;
  }

  // ── (T-01 교역 연동) 좌표 → 가장 가까운 항구 id + 플레이어 거래 반영 ──
  //   trade.js 가 플레이어 위치의 항구 시세(priceAt)를 쓰고, 매수/매도로 supply 를 움직여 NPC와 같은 시장에 참여.
  const portList = worldMap.islands.filter(i => i.hasPort);
  function nearestPort(x, z){   // (x,z=★월드좌표 — trade.js가 플레이어 위치로 호출) → canon 항구와 월드 공간 비교
    let best = null, bd = Infinity;
    for(const p of portList){ const dx = p.x*WS - x, dz = p.z*WS - z, d = dx*dx + dz*dz; if(d < bd){ bd = d; best = p; } }
    return best ? best.id : null;
  }
  //   플레이어 거래 → 재고 depth(doc §2): 매수 1단위=stock−1(살수록 비쌈) / 매도 1단위=stock+1(팔수록 쌈).
  function applyPlayerTrade(portId, goodKey, isBuy){ addStock(portId, goodKey, isBuy ? -1 : +1); }

  // 항로 그래프 인접목록(무방향) — DECIDING 에서 현재 항구에 연결된 다음 목적지 후보 조회
  const adj = new Map();
  const link = (a, b) => { if(!adj.has(a)) adj.set(a, []); if(!adj.get(a).includes(b)) adj.get(a).push(b); };
  for(const r of worldMap.routes){ if(byId.has(r.from) && byId.has(r.to)){ link(r.from, r.to); link(r.to, r.from); } }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

  // ── (버그② 수정) 섬 회피 — 항로 직선이 섬을 관통하지 않게. 출발/도착 섬은 접근 허용(입항). ──
  //   상선 pos 가 섬 반경+여유 안에 들면 섬 중심 반대로 밀어내 물 위로(전 LOD 데이터 레벨 공통).
  const AVOID_MARGIN = SHIP_LEN;   // 선체 길이만큼 여유
  // ★섬 회피 반경(사령관 2026-07-10 "상선이 섬을 뚫고감"): canon isle.r(=80)은 옛 정규화 크기라, 계속10에서
  //   섬을 원본 크기(반경~180 canon)로 렌더하게 바뀐 뒤 실제 섬보다 2배 이상 작아졌다 → 상선이 섬 테두리를 뚫었음.
  //   worldstream이 프리팹별 실측 footprint 반경을 ctx.islandEffR(canon 단위)에 채운다. 그걸 우선 쓰고, 아직 미측정(원거리
  //   미스트림) 섬은 isle.r×2.3 폴백(관측 비율≈2.25). ISLE_SAFE는 비원형 여백만(effR이 이미 실제 크기라 소량).
  const ISLE_SAFE = 1.1;
  //   ★미실측 섬 국소 안전마진(사령관 2026-07-11 "아직도 관통 목격"): effR 실측(worldstream)은 상선이 근처를 지나가야 채워진다.
  //   상선 항로가 아직 안 가본 먼 섬 옆을 지날 때 effR이 원형근사 폴백(r×2.3)뿐이라, 길쭉/비정형 섬에서 여백이 모자랄 수 있다.
  //   → 실측된 섬은 1.1 유지, 미실측 폴백 섬만 1.35로 보수 확대(대형섬 항로 과우회 없이 관통만 방지).
  const ISLE_SAFE_EST = 1.35;
  function isMeasured(isle){ const m = ctx && ctx.islandEffR; const v = m && m.get(isle.prefab); return !!(v && v > 0); }
  function effR(isle){ const m = ctx && ctx.islandEffR; const v = m && m.get(isle.prefab); return (v && v > 0) ? v : (isle.r || 80) * 2.3; }
  const safeF = (isle) => isMeasured(isle) ? ISLE_SAFE : ISLE_SAFE_EST;
  // ⚡ 항로별 후보 섬 프리컴퓨트 — 기존엔 상선(26척)마다 매 프레임 전 섬(~200)×최대 4회 전수 스캔(프레임당 ~2만 hypot).
  //   항로 = from→to 직선(lerp)이므로, 직선 회랑(섬 반경+여유+밀어내기 최대 이탈폭) 안에 드는 섬만 검사하면 결과 동일.
  //   항로당 1회 계산해 캐시(섬 데이터·항로 그래프는 정적). 후보는 보통 0~수 개 → 프레임 비용 ~수십 hypot.
  const _routeIsles = new Map();   // "from>to" → 후보 섬 배열
  function _distToSeg(px, pz, ax, az, bx, bz){
    const dx = bx - ax, dz = bz - az; const L2 = dx*dx + dz*dz || 1;
    let t = ((px - ax)*dx + (pz - az)*dz) / L2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx*t), pz - (az + dz*t));
  }
  const AVOID_CORRIDOR = 420;      // 밀어내기 최대 이탈폭 여유(큰 섬 r+margin 커버 — 보수적)
  let _effVer = -1;   // ★stale 캐시 무효화(2026-07-12): worldstream 이 effR 실측을 새로 채우면(ctx.islandEffRVer 증가) 후보 목록 재계산.
  //   기존엔 영구 캐시라, 폴백 반경 기준 "회랑 밖" 판정으로 빠진 섬이 나중에 실측으로 커져도 회피 대상에 영영 못 들어왔음.
  function routeIslands(fromId, toId){
    const ver = (ctx && ctx.islandEffRVer) || 0;
    if(ver !== _effVer){ _effVer = ver; _routeIsles.clear(); }
    const key = fromId + '>' + toId; let arr = _routeIsles.get(key); if(arr) return arr;
    const a = byId.get(fromId), b = byId.get(toId); arr = [];
    if(a && b){
      // 회랑 폭 += 끝점 앵커·출항호의 중심선 최대 이탈폭(anchorR) — 앵커/호 구간이 회랑 밖 섬과 닿는 후보 누락 방지
      const ringMax = Math.max(anchorR(a, AVOID_MARGIN), anchorR(b, AVOID_MARGIN));
      for(const isle of worldMap.islands){
        if(!isle.r || isle.id === fromId || isle.id === toId) continue;
        if(_distToSeg(isle.x, isle.z, a.x, a.z, b.x, b.z) < effR(isle)*safeF(isle) + AVOID_MARGIN + AVOID_CORRIDOR + ringMax) arr.push(isle);
      }
    }
    _routeIsles.set(key, arr); return arr;
  }
  //   ★가장 깊이 침범한 섬부터 그 밖으로 밀어내기를 반복(최대 4회) — 여러 섬 순차 적용의 상호 상쇄(큰 섬 안으로 복귀) 방지.
  //   margin = 그 상선 개체의 실제 크기 기반 여백(hullMarginOf). 기본값 AVOID_MARGIN(오세베르그 기준) 폴백.
  function avoidIslands(pos, fromId, toId, margin){
    const cand = routeIslands(fromId, toId);
    if(!cand.length) return pos;
    const mg = (margin != null ? margin : AVOID_MARGIN);
    for(let iter = 0; iter < 4; iter++){
      let worst = null, worstPen = 0, wd = 0;
      for(const isle of cand){
        const d = Math.hypot(pos.x - isle.x, pos.z - isle.z), keep = effR(isle)*safeF(isle) + mg;
        if(d < keep){ const pen = keep - d; if(pen > worstPen){ worstPen = pen; worst = isle; wd = d; } }
      }
      if(!worst) break;                                   // 침범 섬 없음 → 종료
      const keep = effR(worst)*safeF(worst) + mg;
      if(wd > 0.01){ const f = keep / wd; pos.x = worst.x + (pos.x - worst.x) * f; pos.z = worst.z + (pos.z - worst.z) * f; }
      else { pos.x = worst.x + keep; }                    // 정중심 → 임의 방향으로 탈출
    }
    return pos;
  }
  //   ★근본수정(2026-07-12 "아직도 관통"): 기존 항로 끝점 = 섬 '정중심'(lerp(fromI,toI))이었고 from/to 는 회피 후보에서
  //   제외되므로, 출발·도착 구간(중심↔해안선 effR, 편도 ~180 canon)을 매번 육지 위로 항해했다 — 관통의 주범.
  //   또 구 dockAnchor 반경이 canon isle.r(=80) 기준이라 실측 footprint(~2.25×)보다 안쪽 = 정박점 자체가 뭍 위였다.
  //   → 항로 끝점을 '섬 가장자리 앵커'(effR 링 위)로 바꾸고, 반경은 회피 keep 과 동일한 effR×safeF+margin 을 쓴다.
  //   앵커 = 방향(지터 포함, 레그 시작 시 1회 확정: e._aDir/_bDir) × 반경(매 프레임 live effR — 실측 갱신 자동 추종).
  function anchorDir(isle, refIsle, rng){   // isle 중심→refIsle 방향 단위벡터 + ±약 27° 지터(같은 섬 배들 겹침 방지)
    let dx = (refIsle ? refIsle.x : isle.x + 1) - isle.x;
    let dz = (refIsle ? refIsle.z : 0) - isle.z;
    let len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const jitter = (rng ? rng() : Math.random()) * Math.PI * 0.6 - Math.PI * 0.3;
    const cos = Math.cos(jitter), sin = Math.sin(jitter);
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  }
  const anchorR = (isle, margin) => effR(isle)*safeF(isle) + (margin != null ? margin : AVOID_MARGIN);   // 회피 keep 과 동일 반경(SSOT)
  function anchorPos(isle, dir, margin){ const r = anchorR(isle, margin); return { x: isle.x + dir.x * r, z: isle.z + dir.z * r }; }

  // ── 상선 개체 → 배정된 모델 템플릿 엔트리(setRender 메시 배정식과 동일 SSOT) + 회피 여백 조회 ──
  //   여백 = 그 모델의 실제 최장 치수(entry.margin). 원거리(메시 미생성) 상선도 여기서 산출·1회 캐시 → 클리핑 방지.
  function entryFor(e){
    if(!templates.length) return null;
    return templates[Math.min(templates.length - 1, Math.floor((e._modelPick != null ? e._modelPick : 0) * templates.length))];
  }
  function hullMarginOf(e){
    if(e._hullMargin != null) return e._hullMargin;
    const entry = entryFor(e);
    const m = (entry && entry.margin != null) ? entry.margin : AVOID_MARGIN;
    if(templates.length) e._hullMargin = m;   // 템플릿 로드된 뒤에만 캐시(초기 프레임 폴백값 고정 방지)
    return m;
  }
  // ── 이 상선에 배정된 모델 → navalencounter ENEMY_POOL 키(약탈 전투배 크기 정합). 미상 시 'empty' 폴백. ──
  function modelKeyOf(e){ const entry = entryFor(e); return (entry && entry.enemyKey) || 'empty'; }

  // ── 3. 상선 = 상태머신 엔티티로 실체화 (economy 데이터 위에 런타임 상태 얹기) ──
  const merchants = [];
  economy.merchants.forEach((m, i) => {
    const fromI = byId.get(m.from), toI = byId.get(m.to);
    if(!fromI || !toI) return;   // 잘못된 항로 → 스킵(economy 가 거른 뒤라 정상적으론 없음)
    const e = {
      id: m.id, from: m.from, to: m.to,
      progress: m.progress,             // economy 초기 진행도(결정론)
      speed: m.speed,                   // economy 개체 속도(정규화 출처)
      dir: m.dir, cargo: m.cargo,       // economy 화물(교역 stub 표시용)
      state: STATES.SAILING,            // 전부 SAILING 으로 시작
      pos: lerp(fromI, toI, m.progress),// lerp(from, to, progress)
      _dockT: 0,                        // DOCKING 체류 타이머
      _rng: mulberry32(((worldMap.seed||1) * 2654435761 + i * 0x9E3779B1) >>> 0),
      // (버그①) 상선 모델 변주용 결정론 픽(0~1). _rng 시퀀스를 건드리지 않게 index 해시로 산출 → 라우팅 결정론 보존.
      _modelPick: (((i * 2654435761) >>> 0) / 4294967296),
    };
    merchants.push(e);
  });

  // 상태 전이 로그(검증용) — [npc:npc0] SAILING → DOCKING 형식
  const trans = (e, next, extra='') => { console.log(`[npc:${e.id}] ${e.state} → ${next}${extra?' '+extra:''}`); e.state = next; };
  let _hdAcc = 0;   // ⚡ home-drift 0.5s 틱 누적기(아래 onUpdate)

  // ── 4. 매 프레임 상태 갱신 (ctx.onUpdate — setInterval/rAF 직접 사용 금지) ──
  ctx.onUpdate((dt) => {
    if(!dt || dt <= 0) return;
    for(const e of merchants){
      const fromI = byId.get(e.from), toI = byId.get(e.to);
      if(!fromI || !toI) continue;

      switch(e.state){
        case STATES.SAILING: {
          const mg = hullMarginOf(e);
          // ★근본수정(버그A): 항로 = 가장자리 앵커 A(출발섬 링)→B(도착섬 링) 직선. 끝점이 섬 중심이 아니므로
          //   출발·도착 구간 육지 항해가 구조적으로 사라진다. 방향은 레그당 1회(지터), 반경은 live effR(실측 갱신 추종).
          if(!e._aDir || !e._bDir){ e._aDir = anchorDir(fromI, toI, e._rng); e._bDir = anchorDir(toI, fromI, e._rng); }
          // ★출항 호(버그B): DEPARTING 이 예약 — 정박점→출발앵커를 섬 링을 따라 활주(순간이동 스냅 대신 연속 이동).
          if(e._arc){
            const arc = e._arc, r1 = anchorR(fromI, mg);
            const step = (CRUISE_SPEED * speedMul(e.speed) * dt) / Math.max(r1, 1);   // 각속도 = v/r
            const rem = arc.tgt - arc.ang, dd = Math.sign(rem) * Math.min(Math.abs(rem), step);
            arc.ang += dd;
            // 진행률 t = 남은 각도 기준(누적합 방식은 float 오차로 1 직전에서 영원히 멈출 수 있음 — 각도 도달 = 확정 종료)
            const t = arc.total > 1e-6 ? Math.max(0, Math.min(1, 1 - Math.abs(arc.tgt - arc.ang) / arc.total)) : 1;
            const r = arc.r0 + (r1 - arc.r0) * t;   // 반경도 현재값→링 반경 보간(정박 중 effR 실측 갱신 흡수)
            e.pos = { x: fromI.x + Math.cos(arc.ang) * r, z: fromI.z + Math.sin(arc.ang) * r };
            if(t >= 1) e._arc = null;
            avoidIslands(e.pos, e.from, e.to, mg);   // 호 도중 제3의 섬 침범만 보정(from/to 는 후보 제외)
            break;
          }
          const A = anchorPos(fromI, e._aDir, mg), B = anchorPos(toI, e._bDir, mg);
          const routeDist = Math.max(1, dist(A, B));
          // progress 증분 = (CRUISE_SPEED × 개체배율 × dt) / routeDist → 항로 길이 무관 실제 u/s 일정(§2-A)
          e.progress += (CRUISE_SPEED * speedMul(e.speed) * dt) / routeDist;
          if(e.progress >= 1){
            e.progress = 1;
            e.pos = { x: B.x, z: B.z };   // 도착 = 정확히 앵커 B(직전 프레임 위치의 연속 — 스냅 점프 없음)
            e._dockT = 0;
            trans(e, STATES.DOCKING, `docking at ${e.to}`);
          } else {
            e.pos = lerp(A, B, e.progress);   // 매 프레임 위치 갱신(앵커→앵커)
            avoidIslands(e.pos, e.from, e.to, mg);   // (버그②) 경로상 섬 관통 방지 — 개체 크기 여백으로 밀어냄
          }
          break;
        }
        case STATES.DOCKING: {
          e._dockT += dt;
          if(e._dockT >= DOCK_WAIT) trans(e, STATES.TRADING);
          break;
        }
        case STATES.TRADING: {
          // ★M4 재고운반(doc §3): 도착항(e.to)에 ① 싣고 온 화물 하역(stock+qty=가격↓) ② 이 항 최저가 good 적재(stock−qty=가격↑) → 다음 항으로 운반.
          const port = e.to, qty = e.qty || NPC_QTY;
          const sold = e.cargo;
          if(sold != null) addStock(port, sold, +qty);   // 하역 → 그 항구 재고↑(시세↓)
          const bought = cheapestGood(port);             // 이 항 최저가 good(재고多=산지) 적재("싼 데서 산다")
          addStock(port, bought, -qty);                  // 적재 → 재고↓(시세↑)
          e.cargo = bought;                              // 다음 화물 = 적재품
          console.log(`[npc:${e.id}] carry ${sold}→${bought} at ${port}`
            + ` (stock ${sold}=${stock[port]?.[sold]??'-'} / ${bought}=${stock[port]?.[bought]??'-'})`);
          trans(e, STATES.DECIDING);
          break;
        }
        case STATES.DECIDING: {
          // 현재 항구(도착항 = e.to)에 연결된 항로 후보에서 다음 목적지 선택. 직전 출발지 즉시 회항은 가능한 한 회피.
          const port = e.to;
          const neighbors = adj.get(port) || [];
          let cands = neighbors.filter(n => n !== e.from);
          if(cands.length === 0) cands = neighbors.slice();   // 막다른 항로 → 회항 허용
          if(cands.length === 0){
            // 고립 항구(연결 없음) — 제자리 유지(에러 없이). 다음 프레임 재시도.
            break;
          }
          // ★M4 라우팅(doc §3-2): 현재 화물(e.cargo)을 가장 비싸게 팔 항(소비항)으로 = 저가→고가 운반 → 시세 수렴.
          //   20% 탐험(무작위)로 한 항 쏠림·교착 완화(개체 결정론 PRNG e._rng).
          let next;
          if(e.cargo && e._rng() > 0.2){
            let best = null, bp = -Infinity;
            for(const n of cands){ const p = priceAt(n, e.cargo); if(p != null && p > bp){ bp = p; best = n; } }
            next = best != null ? best : cands[(e._rng() * cands.length) | 0];
          } else {
            next = cands[(e._rng() * cands.length) | 0];
          }
          e._next = { from: port, to: next };
          trans(e, STATES.DEPARTING, `next ${port}→${next}`);
          break;
        }
        case STATES.DEPARTING: {
          // from/to 교체 + progress=0 → SAILING 복귀. ★근본수정(버그B "슈웅" 순간이동): pos 를 여기서 건드리지 않는다 —
          //   구 코드는 '새 목적지 방향 앵커'로 즉시 스냅해 섬 반대편까지 한 프레임에 날아갔고, 다음 SAILING 프레임의
          //   lerp(fromI,toI,~0)가 다시 '섬 정중심'으로 되돌려(2차 점프) 출발 구간 전체를 육지 위로 항해했다(버그A 겸).
          //   → 정박점→새 출발앵커를 섬 링을 따라 도는 '출항 호'를 예약, SAILING 이 연속으로 활주.
          const nx = e._next || { from: e.to, to: e.from };
          e.from = nx.from; e.to = nx.to; e._next = null;
          e.progress = 0;
          const f2 = byId.get(e.from), t2 = byId.get(e.to);
          if(f2 && t2){
            const mg = hullMarginOf(e);
            e._aDir = anchorDir(f2, t2, e._rng);   // 새 레그 출발 앵커 방향(목적지 쪽 가장자리 + 지터)
            e._bDir = anchorDir(t2, f2, e._rng);   // 새 레그 도착 앵커 방향(출발지 쪽 가장자리 + 지터)
            const a0 = Math.atan2(e.pos.z - f2.z, e.pos.x - f2.x);           // 현재 정박 각도(섬 중심 기준)
            const a1 = Math.atan2(e._aDir.z, e._aDir.x);                     // 출발 앵커 각도
            let dA = a1 - a0; dA = Math.atan2(Math.sin(dA), Math.cos(dA));   // 최단 방향 랩
            const r0 = Math.hypot(e.pos.x - f2.x, e.pos.z - f2.z) || anchorR(f2, mg);
            e._arc = (Math.abs(dA) > 0.03 || Math.abs(r0 - anchorR(f2, mg)) > 1)
              ? { ang: a0, tgt: a0 + dA, r0, total: Math.abs(dA) } : null;
          } else { e._aDir = e._bDir = null; e._arc = null; }
          trans(e, STATES.SAILING);
          break;
        }
        default:
          e.state = STATES.SAILING;
      }
    }

    // ── (M4 밸런스) home-drift 회귀 — stock을 항구 성격재고(homeStock) 방향으로 비율 회귀. ──
    //   산지(home180)는 털려도 다시 차고 / 소비항(home40)은 채워져도 다시 빔 → 차익 루트 재개("살아있는 시장").
    //   생산시설·관리 아님(앰비언트 재생). doc §3-4 "재생 0, NPC만" [제안]을 플레이테스트(산지 회복 불가)로 수정.
    //   ⚡0.5s 틱 스로틀 — dt 누적분을 한 번에 적용(적분 동일)해 전 항구×전 품목 순회를 프레임→틱으로(비용 1/30).
    _hdAcc += dt;
    if(_hdAcc >= 0.5){
      const hd = HOME_DRIFT * _hdAcc; _hdAcc = 0;
      for(const p in stock){ const ps = stock[p], hs = homeStock[p]; if(!hs) continue;
        for(const k in ps){ const cur = ps[k], home = hs[k]; if(cur === home) continue;
          let nv = cur + (home - cur) * hd;
          ps[k] = nv < STOCK_FLOOR ? STOCK_FLOOR : (nv > STOCK_CAP ? STOCK_CAP : nv);
        }
      }
    }
  });

  // ── 4-c. 3D LOD 표현 (단계 c) ──
  const THREE = ctx.THREE, scene = ctx.scene;
  let spriteTex = scene ? makeSpriteTexture(THREE) : null;   // 폴백(코드 텍스처). template 로드 후 oseberg 빌보드로 교체.
  let spriteAspect = 1.7;
  // ── (버그① 수정) 상선 모델 로스터 — 기존엔 oseberg 단일 템플릿만 로드해 26척 전부 동일 외형이었음. ──
  //   업라이트(+y-up·standUp 불필요)로 navalencounter가 실사용/검증한 모델만 채택(queen·ship-x=눕힘 필요 → 제외).
  //   각 상선은 _modelPick(결정론)으로 아래 중 하나를 배정. 로드/빌드 실패 모델은 스킵(빈 배열이면 폴백 보트).
  //   enemyKey = navalencounter ENEMY_POOL 매핑(약탈 전투배가 이 상선과 같은 크기로 스폰되게 — seaevents.startPiracy).
  //   ★2026-07-13: oseberg 전용 ENEMY_POOL 항목 추가됨(navalencounter.js) — 이전엔 'egyptian' 폴백이라 때리면 모양이 바뀌어 보였음.
  const NPC_MODELS = [
    { url:'/obj/oseberg-ship/_ex/oseberg.1.8.obj', type:'obj', enemyKey:'oseberg' },   // 바이킹 롱십(기존)
    { url:'/obj/caravel-ship/optimized.glb',       type:'glb', enemyKey:'caravel' },    // 캐러벨
    { url:'/obj/empty-ship/optimized.glb',         type:'glb', enemyKey:'empty' },      // 범선
    { url:'/obj/egyptian-ship/optimized.glb',      type:'glb', enemyKey:'egyptian' },   // 이집트풍
  ];
  let template = null, templateReady = false, templates = [];      // templates[]={tpl,hullHL,hullHW,draft} · template=대표(빌보드/폴백)
  let hullHL = SHIP_LEN * 0.5, hullHW = SHIP_LEN * 0.25;   // 대표 프로브 반길이/반폭(모델별 값은 templates[].에)
  let DRAFT = NPC_DRAFT;                                    // 대표 흘수 — ship.js draftEq=deckLocalY*0.4 정합. 갑판이 물 위에 오게.
  const flutterMats = [];                                  // 돛 펄럭임 셰이더 머티리얼(clone 공유 → uTime 1회 갱신)
  // 모델 1개 로드 → THREE.Object3D. glb=GLTF+DRACO(navalencounter/invui.js 패턴), obj=OBJLoader(기존).
  async function loadNpcModel(m){
    if(m.type === 'glb'){
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js') ]);
      const draco = new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
      const gl = new GLTFLoader(); gl.setDRACOLoader(draco);
      const g = await new Promise((res, rej) => gl.load(encodeURI(m.url), res, undefined, rej));
      return g.scene;
    }
    return await new Promise((res, rej) => new OBJLoader().load(m.url, res, undefined, rej));
  }
  // 로드 모델 → near 풀메시 템플릿(스케일 정규화·y=0 착지·톤·자동정렬·부력프로브·흘수·돛flutter). {tpl,hullHL,hullHW,draft}.
  function buildTemplate(obj){
    obj.updateMatrixWorld(true);
    const s0 = new THREE.Vector3(); new THREE.Box3().setFromObject(obj).getSize(s0);
    obj.scale.multiplyScalar(SHIP_LEN / Math.max(s0.x, s0.z, 0.01));   // 길이 ~22u 로 정규화(모델 무관 동일 스케일)
    obj.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(obj); obj.position.y -= b2.min.y;   // 바닥 y=0
    applyLowpolyTone(obj, THREE);                                                 // (T-02) 로컬 톤(모델 무관 우드 클레이 통일)
    // (버그① 자동정렬) 긴 수평축(용골)을 +z(뱃머리)로 → 모델별 네이티브 축차 흡수(옆으로 눕지 않음). oseberg=x축 긴 배 → -90°.
    obj.rotation.y = (s0.x >= s0.z) ? -Math.PI / 2 : 0;   // heading=atan2(dir.x,dir.z) 정합(DoD ③ yaw)
    // ★뱃머리 앞/뒤 판별(사령관 2026-07-10 "일부 상선이 뒤로 감"): 위 정렬은 긴 축만 +z로 맞출 뿐 앞/뒤는 모른다.
    //   정렬 후 양 끝 20% 구간의 선체 폭 비교 → 좁은(뾰족한) 쪽=뱃머리가 +z로 오게 뒤집는다. 강한 비대칭일 때만(1.5배↑)
    //   적용 → 대칭 롱십(oseberg 등)은 무영향, egyptian처럼 뾰족끝이 -z인 모델만 180° 교정(오작동 방지). (라이브 폭 실측 근거)
    try { obj.updateMatrixWorld(true);
      const _bb=new THREE.Box3().setFromObject(obj); const _z0=_bb.min.z, _zr=(_bb.max.z-_bb.min.z)||1;
      const _v=new THREE.Vector3(); let pMx=-1e9,pMn=1e9,nMx=-1e9,nMn=1e9,pc=0,nc=0;
      obj.traverse(o=>{ if(o.isMesh&&o.geometry&&o.geometry.attributes.position){ const p=o.geometry.attributes.position;
        for(let k=0;k<p.count;k+=Math.max(1,(p.count/500)|0)){ _v.fromBufferAttribute(p,k); o.localToWorld(_v);
          const zt=(_v.z-_z0)/_zr;
          if(zt>=0.8){ if(_v.x>pMx)pMx=_v.x; if(_v.x<pMn)pMn=_v.x; pc++; }
          else if(zt<=0.2){ if(_v.x>nMx)nMx=_v.x; if(_v.x<nMn)nMn=_v.x; nc++; } } } });
      const wPlus=(pc?pMx-pMn:0), wMinus=(nc?nMx-nMn:0);   // +z 끝 폭 vs -z 끝 폭
      if(wPlus>0 && wMinus>0 && wPlus > wMinus*1.5){ obj.rotation.y += Math.PI; }   // +z 끝이 뭉툭 = 뱃머리가 -z → 뒤집어 뱃머리를 +z로
    } catch(_){}
    const tpl = new THREE.Group(); tpl.add(obj);
    tpl.updateMatrixWorld(true);
    // 프로브 반치수(부력) — 그룹 로컬: 길이=z, 폭=x
    const ts = new THREE.Vector3(); new THREE.Box3().setFromObject(tpl).getSize(ts);
    let hl = ts.z * 0.5 * 0.75, hw = ts.x * 0.5 * 0.7, draft = NPC_DRAFT;
    // ── 흘수 = 갑판 로컬 y × 0.4 (ship.js draftEq 정합). 갑판이 물 위에 오게 ──
    //   갑판면 raycast: 선체 위 여러 지점 ↓레이 → 메시높이 10~55% 범위의 up면(돛/돛대 제외) 중앙값 = 갑판.
    try {
      const rc = new THREE.Raycaster(); const cands = [];
      for(const [lx,lz] of [[0,0],[hw*0.6,0],[-hw*0.6,0],[0,hl*0.5],[0,-hl*0.5]]){
        rc.set(new THREE.Vector3(lx, ts.y+20, lz), new THREE.Vector3(0,-1,0));
        const hits = rc.intersectObject(tpl, true);
        for(const h of hits){ if(h.point.y > ts.y*0.08 && h.point.y < ts.y*0.55){ cands.push(h.point.y); break; } }
      }
      const deckLocalY = cands.length ? cands.sort((a,b)=>a-b)[cands.length>>1] : ts.y*0.30;
      draft = deckLocalY * 0.4;
    } catch(e){ draft = ts.y*0.12; }
    // ★흘수 클램프(사령관 2026-07-10 "상선이 바다에 잠겨서 감"): 갑판 raycast가 높은 데크/돛을 잡으면 draft 과대 → 선체가
    //   수면 아래로 깊이 잠겨 보임. 갑판이 물 위에 오는 정상 범위로 제한(모델 무관 안전).
    draft = Math.max(0.5, Math.min(2.2, draft));
    // (c 보강) 돛 펄럭임 — ship.js applyAlbedoTone/_isSail 패턴. 돛 메시(sail/cloth/plane) 머티리얼만 flutter.
    obj.traverse(o => { if(o.isMesh && /sail|cloth|plane/i.test(o.name||'')){
      const sz0 = new THREE.Vector3(); new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).getSize(sz0);
      if(Math.max(sz0.x, sz0.y, sz0.z) < 1.5) return;   // 작은 plane 제외(돛 패널만)
      const _bb = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for(const mm of mats){ if(!mm || mm.userData.isFlutter) continue;
        mm.userData.isFlutter = true;
        mm.onBeforeCompile = (sh) => { sh.uniforms.uTime = { value:0 }; sh.uniforms.uDepth = { value:1.0 };
          sh.uniforms.uYmin = { value:_bb.min.y }; sh.uniforms.uYmax = { value:_bb.max.y };
          sh.uniforms.uZmin = { value:_bb.min.z }; sh.uniforms.uZmax = { value:_bb.max.z };
          sh.vertexShader = 'uniform float uTime,uDepth,uYmin,uYmax,uZmin,uZmax;\n' + sh.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n float zr=(position.z-uZmin)/max(uZmax-uZmin,0.001); float yr=(uYmax-position.y)/max(uYmax-uYmin,0.001);\n float ytop=smoothstep(0.0,0.12,yr);\n float bdepth=0.7+0.3*sin(uTime*0.8);\n float billow=sin(zr*3.14159)*ytop*bdepth;\n float flut=(sin(zr*5.0+uTime*3.0)*0.3 + sin(zr*3.0-uTime*2.4+yr*3.0)*0.3)*ytop;\n transformed.x -= (billow*1.4 + flut*0.18)*uDepth*(uYmax-uYmin)*0.05;');
          mm.userData.flutterSh = sh; };
        mm.customProgramCacheKey = () => 'npcsailflutter';
        flutterMats.push(mm);
      }
    }});
    // 회피 여백 = 이 모델의 실제 최장 수평 치수(정규화로 ~SHIP_LEN, 더 큰 모델이면 그만큼 큼). 하한 SHIP_LEN(기존 안전여백 보존).
    const margin = Math.max(ts.x, ts.z, SHIP_LEN);
    return { tpl, hullHL:hl, hullHW:hw, draft, margin };
  }
  if(scene){
    // 병렬 로드(네트워크 오버랩) → 각각 빌드. 실패는 스킵(null).
    const loaded = await Promise.all(NPC_MODELS.map(m =>
      loadNpcModel(m)
        .then(obj => { try { const t = buildTemplate(obj); if(t) t.enemyKey = m.enemyKey; return t; } catch(e){ console.warn('[npc] 템플릿 빌드 실패 → 스킵', m.url, e && e.message); return null; } })
        .catch(e => { console.warn('[npc] 모델 로드 실패 → 스킵', m.url, e && e.message); return null; })));
    templates = loaded.filter(Boolean);
    if(!templates.length){ templates.push({ tpl: fallbackBoat(THREE), hullHL: SHIP_LEN*0.5, hullHW: SHIP_LEN*0.25, draft: NPC_DRAFT, margin: SHIP_LEN }); }
    template = templates[0].tpl; templateReady = true;
    hullHL = templates[0].hullHL; hullHW = templates[0].hullHW; DRAFT = templates[0].draft;
    // mid 빌보드 = 대표(0번) 모델 측면 오프스크린 렌더. 실패 시 코드 텍스처 유지. (원거리 스프라이트는 단일 실루엣 허용)
    const _bill = makeShipBillboard(THREE, ctx.renderer, templates[0].tpl);
    if(_bill){ spriteTex = _bill.tex; spriteAspect = _bill.aspect; console.log(`[npc] mid 빌보드 = 측면 렌더 적용(aspect ${_bill.aspect.toFixed(2)})`); }
    console.log(`[npc] 상선 모델 ${templates.length}종 로드(변주) · 대표 프로브 HL${hullHL.toFixed(1)}/HW${hullHW.toFixed(1)} · 흘수 ${DRAFT.toFixed(2)} · 돛 flutter ${flutterMats.length}개`);
  }

  const lodCounts = { near:0, mid:0, far:0, meshInScene:0, spriteInScene:0 };
  let _sailT = 0;                                                // 돛 flutter 시간 누적

  // 상선 e 의 3D 표현 전환(메시/스프라이트/없음). 풀링 — 메시·스프라이트는 1회 생성 후 add/remove 재사용.
  function setRender(e, render){
    if(e._render === render) return;
    if(e._render === 'mesh' && e._mesh) scene.remove(e._mesh);
    else if(e._render === 'sprite' && e._sprite) scene.remove(e._sprite);
    if(render === 'mesh'){
      if(!e._mesh){
        // (버그①) 상선별 배정 모델 clone — _modelPick(결정론)으로 로스터에서 선택. 프로브/흘수도 그 모델 값을 개체에 캐시.
        const entry = entryFor(e);
        const tpl = entry ? entry.tpl : template;
        if(tpl){ e._mesh = tpl.clone(true); e._mesh.userData.npcId = e.id; e._mesh.userData.npcLOD = 'near';
          e._hl = entry ? entry.hullHL : hullHL; e._hw = entry ? entry.hullHW : hullHW; e._draft = entry ? entry.draft : DRAFT;
          e._hullMargin = (entry && entry.margin != null) ? entry.margin : AVOID_MARGIN; }
      }
      if(e._mesh) scene.add(e._mesh); else render = 'none';   // 템플릿 없으면 표시 안 함
    } else if(render === 'sprite'){
      if(!e._sprite){ const sm = new THREE.SpriteMaterial({ map:spriteTex, transparent:true, depthTest:true });
        e._sprite = new THREE.Sprite(sm); e._sprite.scale.set(18 * spriteAspect, 18, 1);   // 빌보드 가로:세로 비율(작게 — 거리감)
        e._sprite.userData.npcId = e.id; e._sprite.userData.npcLOD = 'mid'; }
      scene.add(e._sprite);
    }
    e._render = render;
  }

  // near 메시 항해감(c 보강) — ship.js식 부력 4점 프로브 + 스프링댐퍼 + heading 합성. near 풀메시에만.
  const W = () => (ctx.water && ctx.water.heightAt) ? ctx.water : null;
  function sailMesh(e, dt, now){
    const m = e._mesh; if(!m) return;
    // heading — ★실제 이동방향 기반(사령관 2026-07-10 "기이하게 움직임"). 섬 회피로 항로가 휘면 from→to 직선을 향한 채
    //   옆으로 미끄러지는(게걸음) 것처럼 보였음 → 프레임 간 실제 위치 변화(canon)로 뱃머리를 돌린다. 정지 시 from→to 폴백.
    const fI = byId.get(e.from), tI = byId.get(e.to);
    let heading = e._heading;
    if(heading == null){ heading = (fI && tI) ? Math.atan2(tI.x - fI.x, tI.z - fI.z) : 0; e._heading = heading; }
    if(e._pcx != null){
      const vdx = e.pos.x - e._pcx, vdz = e.pos.z - e._pcz;
      if(vdx*vdx + vdz*vdz > 1e-4){ const tgt = Math.atan2(vdx, vdz);   // 로컬 +z=뱃머리, canon xz 진행방향
        let dH = tgt - heading; dH = Math.atan2(Math.sin(dH), Math.cos(dH));
        heading += dH * Math.min(1, dt*3); e._heading = heading; }   // 부드럽게 선회(급회전 X)
    }
    e._pcx = e.pos.x; e._pcz = e.pos.z;
    const sinH = Math.sin(heading), cosH = Math.cos(heading);
    const fwx = sinH, fwz = cosH;          // 뱃머리 월드방향(+z 로컬)
    const rgx = cosH, rgz = -sinH;         // 우현 월드방향(+x 로컬)
    const wa = W();
    const hl = e._hl || hullHL, hw = e._hw || hullHW, dr = (e._draft != null ? e._draft : DRAFT);   // (버그①) 개체 배정 모델의 프로브/흘수
    const ex = e.pos.x * WS, ez = e.pos.z * WS;   // 🧭 3D 월드 좌표(canon×WS)
    let yTarget, pitchTarget, rollTarget;
    if(wa){
      const HA = wa.heightAt;
      const sC    = HA(ex, ez);
      const sBow  = HA(ex + fwx*hl, ez + fwz*hl);
      const sStern= HA(ex - fwx*hl, ez - fwz*hl);
      const sStar = HA(ex + rgx*hw, ez + rgz*hw);
      const sPort = HA(ex - rgx*hw, ez - rgz*hw);
      yTarget     = sC - dr;                                        // 평균수면−흘수(갑판이 물 위, ship.js 정합)
      pitchTarget = clampT(Math.atan2(sBow - sStern, hl * 1.5));    // 앞뒤 경사(뱃머리/선미 파도차) — Euler X
      rollTarget  = clampT(Math.atan2(sStar - sPort, hw * 1.4));    // 좌우 경사(현측 파도차) — Euler Z
    } else {
      // 폴백: water.heightAt 없음 → 가벼운 사인 bob(개체 위상)
      const ph = (e._phase != null) ? e._phase : (e._phase = ((e.id.length * 1.7) % 6.283));
      const t = (now || 0) * 0.001;
      yTarget     = -dr + Math.sin(t*1.2 + ph) * 0.4;
      pitchTarget = clampT(Math.sin(t*0.9 + ph) * 0.05);
      rollTarget  = clampT(Math.sin(t*1.1 + ph*1.7) * 0.06);
    }
    if(e._buoyY == null){ e._buoyY = yTarget; e._pitch = pitchTarget; e._roll = rollTarget; }
    const yf = Math.min(1, dt * HEAVE_F), tf = Math.min(1, dt * TILT_F);   // 1차 스프링댐퍼(폭발 없는 추종)
    e._buoyY += (yTarget     - e._buoyY) * yf;
    e._pitch += (pitchTarget - e._pitch) * tf;
    e._roll  += (rollTarget  - e._roll ) * tf;
    m.position.set(ex, e._buoyY, ez);   // 🧭 월드 좌표(×WS)
    m.rotation.order = 'YXZ';                 // YXZ: heading(Y) 위에 pitch(X)/roll(Z) 가산. .set → quaternion 자동 동기
    m.rotation.set(e._pitch, heading, e._roll);
  }

  // LOD: 매 프레임 플레이어 거리 체크 → near=메시(동시 NEAR_MAX 상한·부력항해) / mid=스프라이트 / far=데이터만.
  //   (거리 상수는 위 NEAR/MID/NEAR_MAX 실제값을 따름)
  const _lodArr = merchants.map(e => ({ e, d: 0 }));   // ⚡프레임 재사용 버퍼(할당 0)
  const _nearBuf = [], _meshSet = new Set();
  ctx.onUpdate((dt, now) => {
    if(!scene) return;
    if(dt && dt > 0){ _sailT += dt;   // 돛 flutter uTime 갱신(셰이더 컴파일 후에만 uniform 존재)
      for(const m of flutterMats){ const sh = m.userData.flutterSh; if(sh && sh.uniforms && sh.uniforms.uTime) sh.uniforms.uTime.value = _sailT; } }
    const player = ctx.player;
    if(!player || !player.pos){   // 방어(T-04): 플레이어 없음 → 전부 데이터만(메시 제거)
      for(const e of merchants){ if(e._render && e._render !== 'none'){ setRender(e, 'none'); } e._lod = 'far'; }
      lodCounts.near = 0; lodCounts.mid = 0; lodCounts.far = merchants.length; lodCounts.meshInScene = 0; lodCounts.spriteInScene = 0;
      return;
    }
    const px = player.pos.x, pz = player.pos.z;
    // near 후보 거리순 정렬 → 가까운 NEAR_MAX 만 풀메시, 초과분 스프라이트
    // ⚡재사용 버퍼 — 기존 map/filter/sort/slice/map + new Set 체인이 매 프레임 배열·객체·Set을 새로 할당(GC 압박).
    for(const o of _lodArr) o.d = Math.hypot(o.e.pos.x*WS - px, o.e.pos.z*WS - pz);   // 🧭 LOD 거리 = 월드 공간
    _nearBuf.length = 0;
    for(const o of _lodArr) if(o.d <= NEAR) _nearBuf.push(o);
    _nearBuf.sort((a, b) => a.d - b.d);
    _meshSet.clear();
    for(let i = 0; i < _nearBuf.length && i < NEAR_MAX; i++) _meshSet.add(_nearBuf[i].e);
    const meshSet = _meshSet;
    let nNear = 0, nMid = 0, nFar = 0, nMesh = 0, nSpr = 0;
    for(const { e, d } of _lodArr){
      if(e._pirated || e._removed){ if(e._render && e._render !== 'none') setRender(e, 'none'); e._lod = 'far'; continue; }   // 🏴 약탈 중(전투배가 대신 섬)/격침 = 렌더 숨김
      let lod, render;
      if(d <= NEAR){ lod = 'near'; render = meshSet.has(e) ? 'mesh' : 'sprite'; }
      else if(d <= MID){ lod = 'mid'; render = 'sprite'; }
      else { lod = 'far'; render = 'none'; }
      e._lod = lod;
      setRender(e, render);
      if(e._render === 'mesh' && e._mesh){
        sailMesh(e, dt || 0.016, now);   // ★near 풀메시 = 부력 출렁/기울 + heading (mid/far 미적용)
      } else if(e._render === 'sprite' && e._sprite){
        const sx=e.pos.x*WS, sz=e.pos.z*WS;   // 🧭 월드 좌표
        const seaY = (ctx.water && ctx.water.heightAt) ? ctx.water.heightAt(sx, sz) : 0;
        e._sprite.position.set(sx, seaY + 7, sz);   // 빌보드(직선 이동 — 현행 유지)
      }
      if(lod === 'near') nNear++; else if(lod === 'mid') nMid++; else nFar++;
      if(e._render === 'mesh') nMesh++; else if(e._render === 'sprite') nSpr++;
    }
    lodCounts.near = nNear; lodCounts.mid = nMid; lodCounts.far = nFar; lodCounts.meshInScene = nMesh; lodCounts.spriteInScene = nSpr;
  });

  // ── 5. 공개 API (ctx.npc) — 외부에서 상선 배열·상태·수급·시세·LOD 읽기 ──
  //   merchants: 상태머신 상선 / pirates: 단계 d2(빈 배열) / supply·priceAt: 단계 b / lodCounts·LOD: 단계 c
  // 🏴 상선 약탈 지원(seaevents.js) — 전투 중 대상 상선 숨김 토글 + 격침 시 영구 제거.
  function setPirated(e, on){ if(!e) return; e._pirated = !!on; }
  function removeMerchant(e){
    if(!e) return;
    if(e._render && e._render !== 'none') setRender(e, 'none');   // 메시/스프라이트 씬에서 제거
    e._removed = true;
    const i = merchants.indexOf(e); if(i >= 0) merchants.splice(i, 1);   // 상태머신·LOD 순회에서 제외
    const j = _lodArr.findIndex(o => o.e === e); if(j >= 0) _lodArr.splice(j, 1);
  }
  // (x,z=★월드좌표) 최근접 near-메시 상선 반환(약탈 대상 후보). maxDist(월드 m) 밖이면 null.
  function nearestMerchant(x, z, maxDist){
    let best = null, bd = (maxDist != null ? maxDist : 1e9);
    for(const e of merchants){ if(e._pirated || e._removed) continue; const d = Math.hypot(e.pos.x*WS - x, e.pos.z*WS - z); if(d < bd){ bd = d; best = e; } }   // 🧭 월드 공간 비교
    return best ? { e: best, dist: bd } : null;
  }

  // ── 🚢 상선 인구 유지(2026-07-04): 약탈/이탈 respawn + 플레이어 근처 밀도 보장(약탈 기회 없음 방지) ──
  //   ★사령관: 26척 전맵 분산이면 near에 1척뿐 → 약탈 불가. 항해 중 주변에 최소 밀도 유지 + 총량 respawn.
  //   수치 SSOT = balance.js BAL.naval.merchant.{fleetTarget,hardCap,nearRadius,nearMin,cullRadius,popIntervalSec}. 폴백 아래.
  let _spawnSeq = 100000;   // respawn id 시드(초기 npc0.. 와 충돌 방지)
  function spawnMerchant(nearPlayer){
    const routes = worldMap.routes; if(!routes || !routes.length) return null;
    let route = null, prog = Math.random();
    if(nearPlayer && ctx.player && ctx.player.pos){
      const px = ctx.player.pos.x, pz = ctx.player.pos.z;   // 🧭 플레이어 = 월드 좌표
      // ── (버그② 수정) 뭉침 방지 ──
      //   기존: '가장 가까운 항로 1개의 최근접점(t)'에만 반복 스폰 → 한 틱에 2~3척이 정확히 같은 점에 겹쳐 스폰(뭉침).
      //   수정: (a) 근처 항로 후보군에서 매 호출 무작위 1개 선택 + (b) prog 를 ±0.2 지터 → 항로선 위로 분산.
      //         (좌표 단위도 canon↔world 혼용 버그 교정 — 항로/거리 전부 월드(×WS)로 통일해 nearRadius 가 문서대로 '월드 m'.)
      const cand = [];
      for(const r of routes){ const a = byId.get(r.from), b = byId.get(r.to); if(!a || !b) continue;
        const ax = a.x*WS, az = a.z*WS, bx = b.x*WS, bz = b.z*WS;
        const dx = bx - ax, dz = bz - az, L2 = dx*dx + dz*dz || 1;
        let t = ((px - ax)*dx + (pz - az)*dz) / L2; t = t < 0.08 ? 0.08 : t > 0.92 ? 0.92 : t;
        const cx = ax + dx*t, cz = az + dz*t, d = Math.hypot(cx - px, cz - pz);
        if(d < 1200) cand.push({ r, t, d });   // 월드 1.2km 안 항로만 후보
      }
      if(cand.length){
        cand.sort((x, y) => x.d - y.d);
        const pool = cand.slice(0, Math.min(6, cand.length));            // 가까운 후보 최대 6개
        const pick = pool[(Math.random() * pool.length) | 0];           // 매 호출 무작위 1개 → 여러 항로로 분산
        route = pick.r; prog = Math.min(0.95, Math.max(0.05, pick.t + (Math.random() - 0.5) * 0.4));   // ±0.2 지터
      }
    }
    if(!route){ route = routes[(Math.random()*routes.length)|0]; prog = Math.random(); }
    const a = byId.get(route.from), b = byId.get(route.to); if(!a || !b) return null;
    const e = {
      id: 'npcR' + (_spawnSeq++), from: route.from, to: route.to, progress: prog,
      speed: 0.05 + Math.random()*0.08, dir: Math.random() < 0.5 ? 1 : -1,
      cargo: GOODS[(Math.random()*GOODS.length)|0].k, qty: NPC_QTY,
      state: STATES.SAILING, pos: lerp(a, b, prog), _dockT: 0,
      _rng: mulberry32((_spawnSeq * 2654435761) >>> 0),
      _modelPick: Math.random(),   // (버그①) respawn 상선도 모델 변주
    };
    merchants.push(e); _lodArr.push({ e, d: 0 });
    return e;
  }
  const _popCfg = () => { const m = (ctx.balance && ctx.balance.naval && ctx.balance.naval.merchant) || {};
    return { target: m.fleetTarget||32, hardCap: m.hardCap||48, nearR: m.nearRadius||550, nearMin: m.nearMin||2, cullR: m.cullRadius||1600, iv: m.popIntervalSec||2.5 }; };
  let _popAcc = 0;
  ctx.onUpdate((dt) => {
    if(!dt || dt <= 0) return;
    _popAcc += dt; const cfg = _popCfg(); if(_popAcc < cfg.iv) return; _popAcc = 0;
    // 1) 총량 유지 — 약탈/제거로 target 미만이면 보충(전 맵 분산)
    let guard = 0;
    while(merchants.length < cfg.target && merchants.length < cfg.hardCap && guard++ < 8){ if(!spawnMerchant(false)) break; }
    // 2) 근처 밀도 보장 — 항해 중 주변 nearR 안 상선 < nearMin 이면 근처 항로에 스폰(약탈 기회)
    // ★버그②: 튜토/오프닝 중엔 플레이어 근처 밀도 스폰을 skip — 명중 게이트(seaevents.js checkMerchantHits)만으론
    //   막을 수 없는 "근처에 상선이 계속 나타나 사실상 공격을 유도"하는 상황 자체를 줄임. 전역 보충(위 1)은 유지.
    const s = ctx.ship, pp = ctx.player && ctx.player.pos;
    const _tutoOrOpening = ctx.ai && ctx.ai.director && ctx.ai.director.tutoOrOpening && ctx.ai.director.tutoOrOpening();
    if(s && s.boarded && pp && merchants.length < cfg.hardCap && !_tutoOrOpening){
      // 🧭 (버그②) 거리 비교 = 월드 공간(상선 canon×WS vs 플레이어 월드) — 기존 canon↔world 혼용 버그 교정. nearR=월드 m.
      let nearCnt = 0; for(const e of merchants){ if(e._pirated || e._removed) continue; if(Math.hypot(e.pos.x*WS - pp.x, e.pos.z*WS - pp.z) < cfg.nearR) nearCnt++; }
      let g2 = 0;
      while(nearCnt < cfg.nearMin && merchants.length < cfg.hardCap && g2++ < 3){ if(spawnMerchant(true)) nearCnt++; else break; }
    }
    // 3) 순환 — target 초과분은 멀리(cullR 밖, 플레이어 안 보이는 곳) 1척 정리
    if(pp && merchants.length > cfg.target){
      let far = null, fd = cfg.cullR;
      for(const e of merchants){ if(e._pirated || e._removed) continue; const d = Math.hypot(e.pos.x*WS - pp.x, e.pos.z*WS - pp.z); if(d > fd){ fd = d; far = e; } }   // 🧭 월드 공간
      if(far) removeMerchant(far);
    }
  });

  ctx.npc = {
    merchants,
    setPirated, removeMerchant, nearestMerchant, modelKeyOf,   // 🏴 약탈 지원 API(modelKeyOf=전투배 크기 정합)
    pirates: [],        // ④-B 적대 해적 — 단계 d2. 현재 초기 빈 배열만.
    stock,              // stock[portId][goodKey] = 재고 카운터(M4). priceAt=basePrice×stockFactor(stock/ref)
    tradeVolume,        // 🌱 tradeVolume[portId] = 누적 거래량(|delta| 합). capture.js 종족섬 자동성장(축6) 읽기용
    priceAt,            // (portId, goodKey) → 재고 반영 시세(trade.js 교역창 연동)
    nearestPort,        // (x,z) → 가장 가까운 항구 id (T-01 교역 위치 매핑)
    applyPlayerTrade,   // (portId, goodKey, isBuy) → 플레이어 거래로 supply 변동(NPC와 같은 시장)
    lodCounts,          // { near, mid, far, meshInScene, spriteInScene } — 매 프레임 갱신
    LOD: { NEAR, MID, NEAR_MAX },
    templateReady,
    sailFlutterCount: flutterMats.length,   // (c 보강) 돛 펄럭임 셰이더 머티리얼 수
    STATES,
    stage: 'c',
    merchantCount: merchants.length,
  };

  console.log(`[npc] 초기화 완료 — 상선 ${merchants.length}척 · 항구 ${Object.keys(stock).length}곳 재고(M4) · LOD(near${NEAR}/mid${MID}/cap${NEAR_MAX}) (단계 c: 3D LOD)`);
  return ctx.npc;
}

// 샌드박스 ?sys=npc 로더(initFnName('npc')==='initNpc')용 = 기본. + DoD 게이트 명칭 initNPC 별칭.
export { initNpc as initNPC };

// [근거]
// 확정(출처 명시):
//  - (2026-07-12 관통·순간이동 근본수정) 원인①: 항로 끝점=섬 정중심 + from/to 회피 제외 → 출발·도착 구간(중심↔해안 effR)을 육지 위로 항해.
//    원인②: DEPARTING 스냅(dockAnchor)이 다음 SAILING 프레임 lerp(fromI,toI,~0)=중심으로 덮여 2중 점프("슈웅") + dockAnchor 반경이
//    canon r(=80) 기준이라 실측 footprint(~2.25×) 안쪽. 원인③: _routeIsles 영구 캐시가 effR 실측 갱신을 반영 못 함(stale).
//    수정: 항로=가장자리 앵커 A→B(anchorDir 지터×live anchorR=effR·safeF+margin) / DEPARTING=pos 유지+출항 호(링 활주) /
//    routeIslands=ctx.islandEffRVer 버전 무효화+회랑폭에 ringMax 가산. worldstream 실측=섬 원점 기준 축별 최대거리(중심 오프셋 포함)+버전 증가.
//    — 본 파일 SAILING/DEPARTING·routeIslands·worldstream.js loadIsland 실코드 추적 근거.
//  - (버그① 상선 외형 고정) 원인: 기존 npc.js 는 oseberg OBJ 단일 template 만 로드(모델 배열·인덱스 없음) → 전 상선 동일 clone.
//    수정: NPC_MODELS 로스터(oseberg+caravel+empty+egyptian) 병렬 로드 → templates[] · 상선별 _modelPick(결정론)으로 배정 clone.
//    채택 모델 = navalencounter.js SHIP_PROFILES 에서 standUp 불필요(업라이트)로 실사용 검증된 것만(queen·ship-x=눕힘 필요 → 제외).
//    자동정렬: 로드 bbox 의 긴 수평축(용골)을 +z 로 회전 → 모델별 네이티브 축차 흡수(옆으로 눕는 오배치 방지). 로드/빌드 실패 모델은 스킵.
//  - (버그② 상선 뭉침) 원인: spawnMerchant(nearPlayer) 가 '가장 가까운 항로 1개의 최근접점 t'에만 반복 스폰 → 한 틱 2~3척이 정확히 같은 점에 겹침.
//    + 인구/컬 거리비교가 canon(e.pos) vs world(player.pos) 단위 혼용(×WS 누락).
//    수정: 근처 항로 후보군(월드 1.2km)에서 매 호출 무작위 1개 + prog ±0.2 지터로 분산 · 거리비교 전부 월드(×WS) 통일(nearRadius=문서대로 월드 m).
//  - 상선 데이터 구조 {id,from,to,progress,speed,dir,cargo} + 기본 26척 — economy.js generateEconomy (L14·L28~31) 직접 구동.
//  - 항로 그래프 routes=[{from,to}] 무방향 — worldmap.js generateWorldMap (L76~82) / worldmap.canon.json(232 항로) 직접 확인.
//  - 모듈 규약 export function initX(ctx) + ctx.onUpdate(fn) — core.js ctx._updaters/onUpdate (L28·L37) + _GUIDE.md 공통 규칙.
//  - 정본 맵 worldmap.canon.json(seed17·203섬·232항로·20스폰) — 파일 직접 확인. sandbox 미로드 → npc 자급(T-03).
//  - 5상태 순환 SAILING→DOCKING→TRADING→DECIDING→DEPARTING→SAILING — npc_ai.md ① 코어 AI 상태머신.
//  - 수치 CRUISE_SPEED=5u/s · DOCK_WAIT=3.0s · 속도 개체변주 ±20% · progress증분=(CRUISE×dt)/routeDist — npc_ai.md §2-A 수치표.
//  - initFnName('npc')→'initNpc'(기본) / DoD 게이트 initNPC(별칭) — sandbox.html loadSysModule (L61~64) 직접 확인.
//  - (단계 b) 기준가 = economy.prices[port][good] = base×섬해시 — economy.js generateEconomy (L21~24) 읽기 전용 참조(수정 금지).
//  - (단계 b) 수급 수치 DELTA_BUY+0.06 · DELTA_SELL-0.06 · SUPPLY_WEIGHT 0.35 · DRIFT 0.004/s · 클램프±1.0 — npc_ai.md §2-A 경제 수급표.
//  - (단계 b) priceAt = 기준가×(1+supply×WEIGHT) / 매수 supply↑ / 매도 supply↓ / drift 0방향 회복 — npc_ai.md ② 자동교역.
//  - (단계 c) LOD NEAR 400u / MID 1500u / NEAR_MAX 6척 · 목표 dt<25ms — npc_ai.md §2-A LOD·표현 수치표.
//  - (단계 c) 3티어 near=풀메시 / mid=스프라이트 / far=데이터만, yaw=atan2(이동방향) — npc_ai.md ③ 3D LOD 표현.
//  - (단계 c) applyLowpolyTone 로컬 재정의(복사) — ship.js L19~36 직접 복사(named export 없음, T-02). oseberg OBJ 경로 = ship.js 기본.
//  - (c 보강) 부력 = 4점 프로브(bow/stern/port/star) water.heightAt 샘플 + 평형y(수면−흘수) + roll/pitch + 1차 스프링댐퍼 — ship.js L370~433 패턴 참조(읽기만).
//  - (c 보강) 돛 펄럭임 = onBeforeCompile billow+flutter 셰이더(uTime) + customProgramCacheKey — ship.js applyAlbedoTone sail 분기(L54~60) 패턴. near 메시 돛 머티리얼에만.
// 미정(비워둠 — 후속 단계, 이번 빌드 범위 아님):
//  - ④-A 도망 AI(attackMerchant/killMerchant) · ④-B 적대 해적(pirates 스폰·추격·약탈) (단계 d1/d2).
//  - trade.js ↔ ctx.npc.priceAt 플레이어 교역창 연동 (통합 단계, 앤 — T-01). npc.js 는 priceAt API 노출만.
// 제안(작성자=리그):
//  - ctx.worldmap 비었을 때만 npc 가 정본 자급 + ctx.worldmap 슬롯 채움 — sandbox 단독 검증 위함(파일 수정 아님, ctx 콘센트 사용).
//  - DECIDING 다음 목적지 = 인접 항로 중 직전 출발지 회피 후 결정론 rng 선택 — 26척이 항로 그래프를 실제 순회(제자리 진동 방지).
//  - 상태 전이 콘솔 로그 [npc:id] A → B / TRADING 교역 로그 traded sold→bought — 검증(playwright 콘솔 수집)용.
//  - supply = "가격 압력"(+면 시세↑/−면 시세↓). 매도→하락·매수→상승 방향은 §2-A 의도("매도 잦은 항구 시세 하락")로 정합.
//  - priceAt 하한 max(1,...) — supply 음수 누적 시 가격 0/음수 방지(교역 안전). cheapestGood = priceAt 최저 good 매수.
//  - (단계 c) 템플릿 길이축 +x→+z 회전(−90°) → DoD ③ yaw=atan2(dir.x,dir.z) 식과 정합. 메시·스프라이트 풀링(1회 생성 후 add/remove).
//  - (단계 c) 스프라이트 텍스처 = 코드 생성 배 실루엣(별도 png 에셋 없이). near 초과분(>6)·mid = 스프라이트. far = scene 무객체.
