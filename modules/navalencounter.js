// navalencounter.js — 배 전투 "조우" 시스템 (재사용 모듈).
//   ★사령관 설계: 항해 중 적 함대가 랜덤 카운트(1:1 / 2:1 / 3:1)로 정면 멀리서 등장 → 접근 → 전투개시.
//   하는 일: 랜덤 N(1~3)척 적 배를 플레이어 정면 멀리 스폰(숨김) → (선택)지연 후 등장 → initNavalcombat 연결.
//   게임 본체(game.html)는 startNavalEncounter(ctx, opts) 한 번만 호출하면 됨.
//   의존: ship.js(initShip) · navalcombat.js(initNavalcombat) · ctx.ship(플레이어 배) · ctx.water.
import * as THREE from 'three';
import { initShip } from './ship.js';
import { initNavalcombat } from './navalcombat.js';

// 적 배 풀 (sandbox SHIP_PROFILES 기반). headOff = 시각 뱃머리 보정(후진 버그용). name = 전투개시 배너 표기.
export const ENEMY_POOL = {
  queen:   { headOff: Math.PI, name: "Queen Anne's Revenge",
             opt: { objUrl:'/tomob-deploy/obj/queen-annes-revenge/optimized.glb', length:45, center:true, standUp:true, calmBuoy:true, deckLevels:[5.5,7.3], ovDeckW:31, ovDeckL:7.5, deckCx:3.5, deckCz:1.25, showSides:false } },
  caravel: { headOff: 0, name: 'Caravel',
             opt: { objUrl:'/tomob-deploy/obj/caravel-ship/optimized.glb', length:56, albedoDir:'/obj/caravel-ship/textures/', stripRig:true, center:true, useModelHelm:true, flip:true, clothSail:true, showSides:false } },
  empty:   { headOff: 0, name: 'Derelict',
             opt: { objUrl:'/tomob-deploy/obj/empty-ship/optimized.glb', length:56, helmX:-17, clothSail:'all', showSides:false } },
  egyptian:{ headOff: 0, name: 'Egyptian Ship',
             opt: { objUrl:'/tomob-deploy/obj/egyptian-ship/optimized.glb', length:24, center:true, flip:true, helmX:-8, helmScale:1.2, rawPBR:{dir:'/obj/egyptian-ship/textures/', base:'Egyptian_Ships_Ship'}, showSides:false } },
  // ★2026-07-13(사령관 확인): oseberg(바이킹 롱십)를 타던 상선을 때리면 여지껏 egyptian으로 폴백 — 모양이 완전히 바뀌어 보임.
  //   objUrl/texUrl은 initShip(ship.js) 기본값과 동일(oseberg가 원래 그 함수의 기본 모델 — 가장 오래·안정적으로 검증된 경로).
  //   headOff/flip 등은 캐러벨·empty와 같은 "보정 불필요" 계열 기준(대칭 롱십이라 npc.js buildTemplate도 뱃머리 보정 스킵함).
  //   ⚠️ 실플레이 미검증 — 카메라 방향(headOff)·helm 위치가 어색하면 F5 후 조정 필요.
  oseberg: { headOff: 0, name: 'Viking Longship',
             opt: { objUrl:'/tomob-deploy/obj/oseberg-ship/_ex/oseberg.1.8.obj', texUrl:'/tomob-deploy/obj/oseberg-ship/textures/Body-wood-texture.png', length:24, showSides:false } },
  shipx:   { headOff: 0, name: 'Ship X',
             opt: { objUrl:'/tomob-deploy/obj/ship-x-sail-opaque/optimized.glb', length:70, center:true, bakeFrame:true, deckLevels:[0.9,2.8], ovDeckW:46, ovDeckL:13, deckCx:7, deckCz:-0.5, useModelHelm:true, showSides:false } },
};

const LAT = [0, -62, 64, -124, 126];   // 좌우 벌림(중앙→양옆 교대). count만큼 사용.

// ctx, opts: { pool:['queen',...], min:1, max:3, count:고정수, far:250, revealDelay:0, naval:{navalcombat 옵션}, rng:()=>0~1 }
export async function startNavalEncounter(ctx, opts = {}) {
  const player = opts.playerShip || ctx.ship;
  if (!player) { console.warn('[navalencounter] ctx.ship(플레이어 배) 없음 — 조우 취소'); return null; }
  const rng = opts.rng || Math.random;
  const pool = opts.pool || ['queen', 'caravel', 'empty'];
  const min = opts.min || 1, max = opts.max || 3;
  const count = Math.max(1, Math.min(max, opts.count != null ? opts.count : (min + Math.floor(rng() * (max - min + 1)))));   // 1~3 랜덤
  const FAR = (opts.far != null) ? opts.far : 250;   // ★far:0 허용(falsy-zero 버그 수정) — 상선 약탈=대상 자리 그대로 스폰

  // 스폰 기준점: 기본=플레이어 위치. opts.at={x,z} 주면 그 지점 기준(상선 약탈=대상 상선 근처에 근접 스폰).
  const originX = (opts.at && opts.at.x != null) ? opts.at.x : player.x;
  const originZ = (opts.at && opts.at.z != null) ? opts.at.z : player.z;
  // 플레이어 정면(forward) 먼 곳에 좌우로 벌려 스폰
  const f = player.forward ? player.forward.clone() : new THREE.Vector3(1, 0, 0); f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(1, 0, 0); f.normalize();
  const sx = -f.z, sz = f.x;   // 현측(수평 직교) = 좌우 벌림 방향

  const enemies = [], heads = [], names = [];
  for (let i = 0; i < count; i++) {
    const key = (opts.keys && opts.keys[i]) || pool[(rng() * pool.length) | 0] || pool[0];   // opts.keys=특정 배 지정(없으면 랜덤)
    const prof = ENEMY_POOL[key] || ENEMY_POOL.queen;
    const lat = LAT[i] || ((i % 2 ? 1 : -1) * (60 + i * 30));
    const x = originX + f.x * FAR + sx * lat;
    const z = originZ + f.z * FAR + sz * lat + i * 6;
    const E = await initShip(ctx, Object.assign({ spawn: { x, z }, helmsman: true, current: false }, prof.opt));   // ★적 배 = current:false(ctx.ship 안 덮음 — 구 복원 해킹 폐지)
    if (ctx.water && ctx.water.heightAt) { E.buoyY = ctx.water.heightAt(x, z) - E.deckLocalY * 0.4; E.pitchA = 0; E.roll = 0; if (E.mesh) E.mesh.position.y = E.buoyY; }
    if (opts.hidden !== false && E.mesh) E.mesh.visible = false;   // 등장 연출용 숨김(기본). hidden:false면 즉시 보임.
    enemies.push(E); heads.push(prof.headOff); names.push(prof.name);
  }
  // 전투개시 배너 대표 이름 = 가장 강한(queen 우선) 또는 첫 배
  const repName = names.find(n => /queen/i.test(n)) || names[0] || '적 함대';

  const naval = initNavalcombat(ctx, Object.assign({
    playerShip: player, enemyShips: enemies, enemyHeadOffs: heads,
    enemyName: count > 1 ? `${repName} 外 ${count - 1}척` : repName, respawn: false,
    playerInvincible: false,   // ★실제 게임 = 플레이어 배도 격침 가능(무적 해제, 사령관 지시)
  }, opts.naval || {}));

  function reveal() { for (const E of enemies) if (E.mesh) E.mesh.visible = true; }
  let _revealed = false, _t = 0, _disp = null;
  if (opts.revealDelay && opts.revealDelay > 0) {
    _disp = ctx.onUpdate(dt => { if (_revealed) return; _t += dt; if (_t >= opts.revealDelay) { _revealed = true; reveal(); ctx.offUpdate?.(_disp); } });
  } else { reveal(); _revealed = true; }

  console.log(`[navalencounter] 조우 ${count}:1 — ${names.join(', ')} (대표 ${repName}, far ${FAR}, revealDelay ${opts.revealDelay || 0}s)`);
  return { count, enemies, naval, reveal, get revealed() { return _revealed; } };
}

// [근거]
// 확정: 배 전투 = 적 함대 랜덤 카운트(1:1/2:1/3:1)로 정면 멀리서 등장. (출처: 사령관 2026-06-29)
// 확정: 적 배 풀 = sandbox SHIP_PROFILES(queen·caravel·empty). 격침=shipwreck 두 동강+부력 침몰(navalcombat 연동).
// 제안: far 250·revealDelay 0(즉시) 기본. 게임 본체는 랜덤 타이머로 startNavalEncounter 호출.
// 미정: empty headOff(0 추정) · 더 많은 적 배 풀(oseberg/egyptian/shipxsail 추가 가능).
