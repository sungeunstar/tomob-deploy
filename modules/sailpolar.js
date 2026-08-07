// sailpolar.js — ⛵ 범선 폴라 곡선(순수 수학). **의존성 = balance.js 하나뿐**(three 없음).
//   ★분리 이유(2026-07-22): ship.js는 three를 import 하는데 이 프로젝트는 three를 브라우저 임포트맵으로만 쓴다
//     (node_modules에 없음) → ship.js 안에 두면 **Node 검증 하네스에서 import가 불가능**하다.
//     순수 함수만 여기로 빼서 `scripts/_sail_e2e.mjs`가 브라우저 없이 직접 검사한다.
//   유도·검산 정본 = `_바다물리_수식.md`(Fable 유도 + 앤 독립 수치검산 12개 값 오차 0).
import { BAL } from './balance.js';

// ── 각도 규약 ─────────────────────────────────────────────────────────────────
//   ⚠️`wd`(= ctx.wind.dir)는 **바람이 불어가는 방향**이다. 코드 실측으로 확정:
//     구식 추진식이 `cos(bowYaw + sailAngle − wd)`로 wd 정렬에서 최대였고(=순풍 최대),
//     sailhud.js의 트림 다이얼도 같은 규약(`windRel = windDir − bowYaw`)으로 그려진다.
//   따라서 "바람을 거슬러 가는 각" θ = π − |bowYaw − wd| 이며 θ=0 맞바람(irons) / θ=π 순풍(running).
//   → 규약을 바꾸면 sailhud 다이얼과 어긋난다. 바꿀 거면 둘을 같이 고칠 것.
export function windAngleOff(bowYaw, wd){
  let d = (bowYaw - wd + Math.PI) % (Math.PI * 2);
  if(d < 0) d += Math.PI * 2;
  d -= Math.PI;                       // [-π, π]
  return Math.PI - Math.abs(d);       // [0, π]
}

// ── 폴라 곡선 catchF(θ) ───────────────────────────────────────────────────────
//   구식: max(0, cos(뱃머리 − 풍향)) → **순풍이 최대**. 실제 범선은 정반대에 가깝다.
//   신식: no-go 게이트(smoothstep) × 코사인 급수 로브.
//     로브 4계수 = 목표점 4개(45°=0.55 · 90°=1.00 · 135°=0.90 · 180°=0.70)를 통과하는 연립방정식의 정확해.
//     게이트 경계(32°/48°)는 catchF(35°)≈0.05(바닥에 흡수) · catchF(45°)=0.55를 동시에 만족하도록 역산.
//   ⚠️**1.0 클램프 필수** — raw 로브의 피크는 102.5°에서 1.0246이라, 클램프를 빼면
//     브로드리치가 빔리치보다 빨라져 "빔리치가 최대"라는 설계 의도가 깨진다(_sail_e2e가 이걸 검사한다).
export function polarCatch(theta, P){
  const p = P || (BAL.sailing && BAL.sailing.polar);
  if(!p) return Math.max(0, Math.cos(Math.PI - theta));   // BAL 없음 → 구식 폴백(안전)
  const u = Math.min(1, Math.max(0, (theta - p.noGoStart) / p.noGoWidth));
  const gate = u * u * (3 - 2 * u);                        // smoothstep — irons 구간을 부드럽게 차단
  const lobe = p.c0 + p.c1 * Math.cos(theta) + p.c2 * Math.cos(2 * theta) + p.c3 * Math.cos(3 * theta);
  return Math.min(1, Math.max(p.floor, gate * lobe));
}

// [근거]
// 확정: 각도 규약은 ship.js 구 추진식 + sailhud.js 다이얼 코드 실측(추측 아님).
// 확정: 목표 폴라값(45/90/135/180°)은 사령관 컨펌 계획서 수치.
// 제안: floor(0.05)·게이트 폭(16°)은 플레이 편의값 — BAL.sailing.polar에서 조정.
