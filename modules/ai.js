// ai.js — 🧠 공용 AI 코어 v1: 지각(Perception)·공격 토큰(Coordination)·디렉터(Director).
//   실제 게임 AI 파이프라인의 축소판 (사령관 지시 2026-07-05 "게임처럼, 짜치는 시스템 금지"):
//   ① 지각 — 전지(全知) 어그로 폐지. FOV+거리+발각딜레이+기억으로 "AI가 아는 것"만 행동 근거.
//       등 뒤 접근 가능 · 발각 전 0.5초 "멈춰서 바라봄" · 시야 잃으면 마지막 목격지점 수색 후 망각.
//   ② 공격 토큰 — 동시 타격자 상한(아캄/둠 방식). 토큰 없는 몹은 링에서 견제 배회(떼몹 짜부 방지).
//       공격 1회 종료 시 반납 = 자연 교대.
//   ③ 디렉터 — 전투 발동 게이팅(L4D 디렉터 축소판). 튜토(온보딩 questline) 중 해상 조우 억제
//       + 점령 섬 2개 미만이면 해적 조우 미발동(_해전비전.md §E 공정 난이도).
//   수치 SSOT = balance.js BAL.ai. 에이전트 지각 상태는 agent.bb(블랙보드)에만 기록 — 런타임 전용(save 무관).
//   소비처: monsters.js(지각·토큰) · seaevents.js(디렉터). 없는 환경(샌드박스)은 각자 기존 로직 폴백.
import { BAL } from '/tomob-deploy/modules/balance.js';

export function initAI(ctx){
  const P  = () => BAL.ai.perception;
  const TK = () => BAL.ai.tokens;

  // ── ① 지각 — agent = 몬스터 mn 그대로({grp, def, dead...}). 매 프레임 sense(agent, dt) → agent.bb 갱신.
  //   bb: { aware(발각됨) · noticeT(발각 게이지 0~noticeSec) · lastSeen{x,z}(마지막 목격지점) · lostT(시야 잃은 경과) }
  function sense(agent, dt){
    const bb = agent.bb || (agent.bb = { aware:false, noticeT:0, lastSeen:null, lostT:0 });
    const cp = ctx.player && ctx.player.pos; if(!cp) return bb;
    const g = agent.grp, dx = cp.x - g.position.x, dz = cp.z - g.position.z, dist = Math.hypot(dx, dz) || 1e-6;
    const range = (agent.def && agent.def.aggro) || 14;
    // 은신(도적 투명) = 지각 자체가 불가 + 즉시 망각
    if(ctx.player.stealthed){ bb.aware = false; bb.noticeT = 0; bb.lastSeen = null; bb.lostT = 0; return bb; }
    // 시야 판정: 인식 범위 내 + (FOV 안 or 초근접=발소리 반경)
    let inSight = false;
    if(dist < range){
      if(dist < P().noticeCloseM) inSight = true;   // 발소리 — 방향 무관
      else {
        const yaw = g.rotation.y, fx = Math.sin(yaw), fz = Math.cos(yaw);
        inSight = (fx*dx + fz*dz) / dist > Math.cos(P().fovDeg * Math.PI / 360);   // cos(fov/2)
      }
    }
    if(bb.aware){
      // 교전 락: 시야 안이거나 아주 근거리(교전권)면 목격지점 실시간 갱신
      if(inSight || dist < range * 1.6){ bb.lastSeen = { x:cp.x, z:cp.z }; bb.lostT = 0; }
      else { bb.lostT += dt; if(bb.lostT > P().memorySec){ bb.aware = false; bb.noticeT = 0; } }   // 기억 소진 → 망각
    } else {
      if(inSight){
        bb.noticeT += dt * (dist < range * 0.4 ? 2.5 : 1);   // 가까울수록 빨리 발각
        if(bb.noticeT >= P().noticeSec){ bb.aware = true; bb.lastSeen = { x:cp.x, z:cp.z }; bb.lostT = 0; }
      }
      else bb.noticeT = Math.max(0, bb.noticeT - dt * 1.5);   // 시야 이탈 → 게이지 감쇠
    }
    return bb;
  }
  // 강제 발각 — 피격·웨이브·경보 전파용. pos 생략 시 플레이어 현위치.
  function alert(agent, pos){
    const bb = agent.bb || (agent.bb = { aware:false, noticeT:0, lastSeen:null, lostT:0 });
    const cp = ctx.player && ctx.player.pos;
    bb.aware = true; bb.lostT = 0;
    bb.lastSeen = { x:(pos && pos.x != null) ? pos.x : (cp ? cp.x : 0), z:(pos && pos.z != null) ? pos.z : (cp ? cp.z : 0) };
    return bb;
  }
  function forget(agent){ if(agent.bb){ agent.bb.aware = false; agent.bb.noticeT = 0; agent.bb.lastSeen = null; agent.bb.lostT = 0; } }

  // ── ② 공격 토큰 — 동시 공격자 상한. 홀더가 죽거나 어그로 잃으면 자동 회수(lazy 청소).
  const _holders = new Set();
  function tokenRequest(agent){
    if(_holders.has(agent)) return true;
    for(const h of _holders){ if(h.dead || !h.bb || !h.bb.aware) _holders.delete(h); }   // 죽은/망각 홀더 청소
    if(_holders.size < TK().maxAttackers){ _holders.add(agent); return true; }
    return false;
  }
  const tokenRelease = agent => { _holders.delete(agent); };
  const tokenHeld    = agent => _holders.has(agent);

  // ── ③ 디렉터 — 전투 발동 게이팅. questline(온보딩)이 window.__questStep 세팅('done'=완료).
  function tutoActive(){ const s = (typeof window !== 'undefined') && window.__questStep; return !!s && s !== 'done'; }
  // 오프닝(P4-B 골든패스) 중에도 튜토와 동일하게 전투 트리거를 차단해야 함 — 오프닝 중엔 __questStep이 아직
  // 세팅 전이라 tutoActive()만으론 감지 불가 (버그②). ctx.opening.active() = 오프닝 승패 미결정 동안 true.
  function tutoOrOpening(){ return tutoActive() || !!(ctx.opening && ctx.opening.active && ctx.opening.active()); }
  function ownedIslands(){ return (ctx.claimed || []).filter(c => c.owner === 'player').length; }
  function navalAllowed(){
    const D = BAL.ai.director || {};
    return !tutoActive() && ownedIslands() >= (D.navalMinIslands != null ? D.navalMinIslands : 2);
  }

  ctx.ai = { sense, alert, forget, tokenRequest, tokenRelease, tokenHeld,
             director: { tutoActive, tutoOrOpening, ownedIslands, navalAllowed } };
  console.log('[ai] 코어 등록 — 지각(FOV ' + P().fovDeg + '°/발각 ' + P().noticeSec + 's/기억 ' + P().memorySec + 's) · 공격토큰 상한 ' + TK().maxAttackers + ' · 디렉터(튜토억제+점령섬 게이팅)');
  return ctx.ai;
}

export { initAI as initAi };   // sandbox.html ?sys=ai 로더 컨벤션(init+Camel: 'ai'→initAi) 별칭

// [근거]
// 확정: 전지 어그로 폐지·FOV/발각딜레이/기억/토큰/디렉터 구조 = 사령관 "실제 게임처럼" 컨펌 (출처: 2026-07-05 대화 + /plan "잡고 진행해")
// 확정: 해적 조우 게이팅 = 섬 2개 이상 점령 + 튜토 중 억제 (출처: work.md 예정목록 3·4번, 사령관 지시 2026-07-04)
// 확정: 온보딩 진행 판정 = window.__questStep ('done'=완료) (출처: questline.js:242)
// 제안: fov 150°·notice 0.5s·기억 6s·토큰 2 = v1 제안값(BAL.ai, 실플레이 튜닝 대상)
// 미정: 소리 전파(전투음에 주변 몹 경보)·시야 차폐(지형 가림) — v2 후보
