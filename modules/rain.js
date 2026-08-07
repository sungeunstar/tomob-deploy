// rain.js — 폭풍/비 VFX (재사용 모듈).
//   ★오프닝 골든패스 [3]→[4]: 해적선 전투 승리 후 "비 내리면서 표류" 연출용.
//   값싼 카메라-로컬 빗줄기(LineSegments) — 드롭을 카메라 주변 박스 안에 두고 카메라를 따라다니게 함.
//     · 각 빗줄기 = 세그먼트(상단점→하단점, 살짝 비스듬). 로컬 Y로 낙하 → 바닥 닿으면 위로 재활용.
//     · group.position = camera.position 매프레임 → 비는 어디서나 둘러쌈(전형적 저비용 기법).
//   API: const rain = initRain(ctx, opts); rain.start(); rain.stop();
//   의존: ctx.scene · ctx.camera · ctx.onUpdate.
import * as THREE from 'three';

export function initRain(ctx, opts = {}) {
  const N      = opts.count    || 1600;   // 빗줄기 수
  const RAD    = opts.radius   || 70;     // 카메라 주변 수평 반경
  const TOP    = opts.top      || 60;     // 위쪽 생성 높이
  const BOT    = opts.bottom   || -16;    // 이 아래로 내려가면 재활용
  const SPEED  = opts.speed    || 90;     // 낙하 속도(u/s)
  const LEN    = opts.streak   || 2.4;    // 빗줄기 길이
  const SLANT  = opts.slant    || 0.22;   // 바람에 기운 정도(수평 성분)
  const COLOR  = opts.color    || 0xb9d2e2;
  const MAXOP  = opts.opacity  || 0.5;
  const FADE   = opts.fadeTime || 1.4;    // 페이드 인/아웃(초)

  // 세그먼트 = 점 2개. position 버퍼는 카메라-로컬 오프셋(group이 카메라 위치로 이동).
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 6);
  const off = new Float32Array(N);        // 줄기별 속도 변주
  const sx = SLANT * (Math.random() < 0.5 ? 1 : -1), sz = SLANT * 0.3;   // 일정한 바람 방향
  for (let i = 0; i < N; i++) {
    const x = (Math.random() - 0.5) * RAD * 2;
    const y = BOT + Math.random() * (TOP - BOT);
    const z = (Math.random() - 0.5) * RAD * 2;
    pos[i * 6]     = x;        pos[i * 6 + 1] = y;            pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x + sx * LEN; pos[i * 6 + 4] = y - LEN; pos[i * 6 + 5] = z + sz * LEN;
    off[i] = 0.82 + Math.random() * 0.4;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.renderOrder = 5;
  ctx.scene.add(rain);

  let on = false, fade = 0;
  const arr = geo.attributes.position.array;

  ctx.onUpdate(dt => {
    // 페이드 상태 갱신(켜짐=올라가고, 꺼짐=내려감)
    if (on && fade < 1) fade = Math.min(1, fade + dt / FADE);
    else if (!on && fade > 0) fade = Math.max(0, fade - dt / FADE);
    mat.opacity = MAXOP * fade;
    rain.visible = fade > 0.002;
    if (!rain.visible) return;

    // 카메라 추종 — 비가 시야를 항상 둘러쌈
    if (ctx.camera) rain.position.copy(ctx.camera.position);

    // 낙하 + 재활용
    for (let i = 0; i < N; i++) {
      const v = SPEED * off[i] * dt;
      let y0 = arr[i * 6 + 1] - v;
      let y1 = arr[i * 6 + 4] - v;
      if (y1 < BOT) {                       // 바닥 통과 → 위로 재배치(수평도 새 위치)
        const nx = (Math.random() - 0.5) * RAD * 2;
        const nz = (Math.random() - 0.5) * RAD * 2;
        y0 = TOP; y1 = TOP - LEN;
        arr[i * 6]     = nx;            arr[i * 6 + 2] = nz;
        arr[i * 6 + 3] = nx + sx * LEN; arr[i * 6 + 5] = nz + sz * LEN;
      }
      arr[i * 6 + 1] = y0; arr[i * 6 + 4] = y1;
    }
    geo.attributes.position.needsUpdate = true;
  });

  const api = {
    start() { on = true; },
    stop()  { on = false; },
    get active() { return on; },
    dispose() { try { ctx.scene.remove(rain); geo.dispose(); mat.dispose(); } catch (_) {} },
  };
  ctx.rain = api;   // ★ctx에 노출(sandbox ?sys=rain 등에서 ctx.rain.start() 접근용)
  return api;
}

// [근거]
// 확정: 카메라-로컬 빗줄기 LineSegments = three.js 저비용 비 정석(group을 카메라로 이동 + 로컬 낙하/재활용). (출처: three.js 패턴)
// 확정: [3] 승리 후 "비 내리면서 내구도 깎여 표류" — 사령관 2026-06-29.
// 제안: count 1600·반경70·속도90·기울기0.22 = 폭풍 분위기 기본값(실플레이 조정).
