// navalcombat.js — 해적선 대 해적선 전투 시스템. (오프닝 골든패스 [3] 해적선 전투)
//   ★격리 하네스(_navalcombat.html) 전용으로 먼저 제작·검증 → 검증 후 [3] 본 씬에 통합.
//   기존 재료를 "엮기만" 한다 (새 물리/대포/배 안 만듦):
//     · ship.js   — 다중 배(ctx.ships), sideToward()/forward/starboardSide/portSide, curMatrix, 매프레임 mesh 동기화
//     · cannon.js  — ctx.cannon.fire(fx,fy,fz,tx,ty,tz) + projectiles[] + explode()
//     · destruct.js — ctx.destruct.makeBreakable()/_debugHit() (three-pinata voronoi + Rapier 파편) = 격침 시 부서짐
//
//   ★축 규약(ship.js, 직관과 반대): deckW=길이축(x,전진) / deckL=폭축(z,현측).
//   ★headOff(라디안): 모델 시각 뱃머리가 forward와 어긋난 보정값. caravel 0 / queen π(180° 반대).
//     → 적 배가 '선미부터 후진'하던 버그 해결: 이동/조준을 '시각 뱃머리(bowDir)' 기준으로.
//   ★호출 순서: ship.js initShip 들이 onUpdate를 먼저 등록한 뒤 initNavalcombat 호출.
import * as THREE from 'three';

import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (해전 대포·적선·AI 기본값)

// ── 현측 일제사격 본체(모듈 공용) — ★2026-07-12 "공격 = 바로 전투" 통일(사령관): ──
//   조우 인스턴스(broadside)와 자유항해 상시 발사(initFreeFire)가 같은 발사 경로를 공유.
//   ★실탄도: 자동조준 없음 — '현측 바깥' 고정 사거리 직사(중력 아크). 포문은 fireGap 간격 순차(파파파팍).
//   수치·산포·VFX = 기존 조우 broadside와 동일(추출만, 동작 불변).
export function fireBroadside(ctx, sh, side, opts = {}) {
  if (!sh || sh._sunk || !ctx.cannon) return false;
  const guns  = opts.guns  || BAL.naval.gunsPerSide;
  const reach = opts.reach || BAL.naval.gunReach;
  const spr   = opts.spread || 1;                                  // 산포 배율(적 배는 >1)
  const GAP   = (opts.gap != null) ? opts.gap : BAL.naval.fireGap;
  sh._fireCd = (opts.cd != null) ? opts.cd : BAL.naval.reload;     // 쿨다운 즉시(연사·중복 트리거 방지)
  const shipLen = sh.deckW || 40, shipBeam = sh.deckL || 12;
  const waterY = ctx.water ? (ctx.water.level || 0) : 0;
  const kick = (opts.kick != null) ? opts.kick : (sh === ctx.ship ? 0.22 : 0);   // 반동킥 = 내 배 발사만(사령관: 0.03→0.15→0.22 더 묵직하게)
  // 한 포문 발사 — 발사 시점의 현측/뱃머리/포구를 그때그때 계산(배가 회전·출렁여도 정확).
  const fireGun = (i) => {
    if (sh._sunk) return;
    const sideVec = (side === 'starboard') ? sh.starboardSide : sh.portSide;
    const fwd = sh.forward;
    const muzzleY = (sh.mesh ? sh.mesh.position.y : 0) + sh.deckLocalY + 1.2;
    const t = (guns === 1) ? 0 : (i / (guns - 1) - 0.5);
    const along = t * shipLen * 0.55;
    const fx = sh.x + fwd.x * along + sideVec.x * (shipBeam * 0.5);
    const fz = sh.z + fwd.z * along + sideVec.z * (shipBeam * 0.5);
    const rch = reach * (1.0 + (Math.random() - 0.5) * 0.32 * spr);   // 거리 산포
    const lat = (Math.random() - 0.5) * shipLen * 0.5 * spr;          // 길이축 산포
    const tx = fx + sideVec.x * rch + fwd.x * lat;
    const tz = fz + sideVec.z * rch + fwd.z * lat;
    ctx.cannon.fire(fx, muzzleY, fz, tx, waterY, tz);            // 포물선 포탄(발사음·트레이서 포함)
    ctx.cannon.muzzleFlash?.(fx, muzzleY, fz, sideVec.x, sideVec.z);   // 🎯 포구 섬광(기존 광원)
    // ⚓ 승인 VFX: 포연(회백)+잔불 (+플레이어 발사만 약한 반동킥)
    ctx.cannonfx?.muzzle(new THREE.Vector3(fx, muzzleY, fz), new THREE.Vector3(sideVec.x, 0.06, sideVec.z), kick, 3.0);   // scale 3.0 = 머즐·연기 더 크게(사령관: 연기 더더)
    const pr = ctx.cannon.projectiles[ctx.cannon.projectiles.length - 1];
    if (pr) pr.owner = sh;
  };
  for (let i = 0; i < guns; i++) {
    if (i === 0) fireGun(0);                             // 첫 발은 즉시(입력 반응성)
    else setTimeout(() => fireGun(i), i * GAP * 1000);   // 나머지는 순차(파파파팍)
  }
  return true;
}

// ── ⚓ 상시 함포(자유 항해) — 좌클릭 = 조우(navalcombat) 없이도 broadside 발사. ──
//   ★2026-07-12 사령관 확정 "공격 = 바로 전투": 발사가 조우 생명주기(mousedown init~dispose)에 갇혀
//   자유 항해 중 좌클릭이 무반응이던 옛 설계를 뒤집음. 게임 시작 시 1회 바인딩(seaevents가 호출).
//   · 조우 활성 + 스테이션(boarded) = 조우 인스턴스 playerFire가 처리 → 여기선 패스(이중발사 방지).
//   · 조타/스테이션 점유(boarded) 중에만 발사. 쿨다운 = sh._fireCd 공유
//     (조우 진입 시 enroll이 이어받고, 조우 활성 중엔 조우 루프가 감쇠 — 이중 감쇠 없음).
//   ★2026-07-13 버그수정: 예전엔 갑판 위(ctx.player._onShip===sh)이기만 해도 발사돼서
//     조타 중이 아닐 때(그냥 갑판 위를 걸어다닐 때)도 좌클릭하면 대포가 나가던 버그 — boarded 단일조건으로 교체.
// ── ⚔️ 자유 항해 중 Q/E 조준 밴드 — 정식 조우(navalcombat) 없이도 밴드가 뜨고 정밀사격 가능. ──
//   ★2026-07-13 버그수정: 조준 밴드가 정식 전투(조우: 해적 함대) 중에만 떴고, 자유 항해(상선 조준용)에선
//   Q/E를 눌러도 카메라만 돌고 밴드가 안 떴음(사령관: "전투중에만 나오는게 아니라 그래야 상선공격하지").
//   수식(발사각·궤적·밴드 형상)은 조우 버전(initNavalcombat)과 100% 동일 값 재사용 — 락온(적 목록)만 없음
//   (상선은 조우 enemies 배열에 없어 히트박스 매칭 불가 → 밴드는 뜨되 락온 없이 수동 조준만).
const NAV_G = BAL.naval.projGravity;
function _freeAimAngle(ctx) {
  const p = (ctx.player && ctx.player.steerPitch);
  const t = THREE.MathUtils.clamp(((p == null ? 0 : p) + 0.7) / 1.6, 0, 1);
  return BAL.naval.aimAngMin + (BAL.naval.aimAngMax - BAL.naval.aimAngMin) * t * t;
}
function _freeLandTime(th, v0, H) { const vv = v0 * Math.sin(th); return (vv + Math.sqrt(vv * vv + 2 * NAV_G * H)) / NAV_G; }
const _FREE_INTERIOR = 0.22;
const _freeSmooth = (a, b, x) => { x = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
function _freeBuildBandGeo(th, v0, H) {
  const vh = v0 * Math.cos(th), vv = v0 * Math.sin(th), T = _freeLandTime(th, v0, H), N = 28, M = 5;
  const angN = THREE.MathUtils.clamp((th - BAL.naval.aimAngMin) / (BAL.naval.aimAngMax - BAL.naval.aimAngMin), 0, 1);
  const W0 = BAL.naval.bandBaseW * (1 - BAL.naval.bandFarNarrow * angN);
  const pos = new Float32Array((N + 1) * M * 3), col = new Float32Array((N + 1) * M * 4), idx = [];
  const frac = [-1, -0.5, 0, 0.5, 1];
  for (let i = 0; i <= N; i++) { const s = i / N, t = T * s;
    const cx = vh * t, cy = vv * t - 0.5 * NAV_G * t * t;
    const hw = Math.max(0.4, W0 * (1 - BAL.naval.bandTaper * s));
    const aLen = _freeSmooth(0.0, 0.85, s);
    for (let m = 0; m < M; m++) { const b = i * M + m, f = frac[m];
      pos[b * 3 + 0] = cx; pos[b * 3 + 1] = cy; pos[b * 3 + 2] = f * hw;
      const edge = _freeSmooth(0.35, 1.0, Math.abs(f));
      const aCross = _FREE_INTERIOR + (1.0 - _FREE_INTERIOR) * edge;
      const a = aLen * aCross;
      col[b * 4 + 0] = 1; col[b * 4 + 1] = 1; col[b * 4 + 2] = 1; col[b * 4 + 3] = a; } }
  for (let i = 0; i < N; i++) { for (let m = 0; m < M - 1; m++) { const a = i * M + m, b = i * M + m + 1, c = (i + 1) * M + m, d = (i + 1) * M + m + 1; idx.push(a, b, c, b, d, c); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

let _freeFireBound = false;
export function initFreeFire(ctx) {
  if (_freeFireBound) return; _freeFireBound = true;
  const _cd = new THREE.Vector3();

  // ── 조준 밴드 메시(씬 상주, 자유항해 전용 — 조우 밴드와 별개 인스턴스) ──
  const _bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, opacity: 0.85, side: THREE.DoubleSide });
  const _band = new THREE.Mesh(_freeBuildBandGeo(BAL.naval.aimAngMin, BAL.naval.muzzleSpeed, 4), _bandMat);
  _band.renderOrder = 4; _band.visible = false; ctx.scene.add(_band);
  let _bandKey = '';
  function refreshBand(th, H) { const k = th.toFixed(3) + '_' + H.toFixed(1); if (k === _bandKey) return; _bandKey = k;
    const g = _band.geometry; _band.geometry = _freeBuildBandGeo(th, BAL.naval.muzzleSpeed, H); if (g) g.dispose(); }

  function muzzleHeight(sh) {
    const waterY = ctx.water ? (ctx.water.level || 0) : 0;
    const my = (sh.mesh ? sh.mesh.position.y : 0) + sh.deckLocalY + 1.2;
    return Math.max(1.5, my - waterY);
  }
  // 조준 정보(현측+마우스 좌우 스윙+발사각 → 착탄거리) — 조우 navAim()과 동일, 락온만 없음(lock:null 고정).
  function navAim(sh) {
    const side = ctx.player && ctx.player.navAimSide;
    if (!side) return null;
    const sv = (side === 'port') ? sh.portSide : sh.starboardSide;
    if (!sv) return null;
    _cd.set(sv.x, 0, sv.z); if (_cd.lengthSq() < 1e-4) return null; _cd.normalize();
    const yaw = (ctx.player && ctx.player.navAimYaw) || 0;
    if (yaw) { const cs = Math.cos(yaw), sn = Math.sin(yaw), x = _cd.x, z = _cd.z; _cd.set(x * cs + z * sn, 0, z * cs - x * sn); }
    const th = _freeAimAngle(ctx), v0 = BAL.naval.muzzleSpeed, H = muzzleHeight(sh);
    const vh = v0 * Math.cos(th), T = _freeLandTime(th, v0, H), reach = vh * T;
    return { dir: new THREE.Vector3(_cd.x, 0, _cd.z), th, v0, H, reach, lock: null };
  }
  // 정밀 사격(조준 방향 그대로) — 조우 fireNav()와 동일 로직(락온 산포 보정만 제외).
  function fireNav(sh) {
    if (sh._sunk || sh._fireCd > 0) return false;
    const a = navAim(sh); if (!a) return false;
    const fwd = sh.forward, aimAng = Math.atan2(a.dir.x, a.dir.z), fwdAng = Math.atan2(fwd.x, fwd.z);
    let rel = aimAng - fwdAng; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
    const ar = Math.abs(rel); let sector;
    if (ar < Math.PI / 4) sector = 'bow'; else if (ar > 3 * Math.PI / 4) sector = 'stern';
    else { const ds = a.dir.x * sh.starboardSide.x + a.dir.z * sh.starboardSide.z; sector = ds > 0 ? 'starboard' : 'port'; }
    const hl = (sh.deckW || 40) * 0.42, bm = (sh.deckL || 12) * 0.5, spanL = (sh.deckW || 40) * 0.5;
    const guns = (sector === 'bow' || sector === 'stern') ? 2 : BAL.naval.gunsPerSide;
    const ax = (sector === 'bow' || sector === 'stern') ? sh.starboardSide : sh.forward;
    const dx = a.dir.x, dz = a.dir.z;
    const vh = a.v0 * Math.cos(a.th), vv = a.v0 * Math.sin(a.th);
    const doFire = (i) => { if (sh._sunk) return;
      const muzzleY = (sh.mesh ? sh.mesh.position.y : 0) + sh.deckLocalY + 1.2;
      let bx, bz;
      if (sector === 'bow') { bx = sh.x + sh.forward.x * hl; bz = sh.z + sh.forward.z * hl; }
      else if (sector === 'stern') { bx = sh.x - sh.forward.x * hl; bz = sh.z - sh.forward.z * hl; }
      else { const sv = (sector === 'starboard') ? sh.starboardSide : sh.portSide; bx = sh.x + sv.x * bm; bz = sh.z + sv.z * bm; }
      const off = (guns === 1) ? 0 : (i / (guns - 1) - 0.5), fx = bx + ax.x * off * spanL * 0.8, fz = bz + ax.z * off * spanL * 0.8;
      const jitter = (Math.random() - 0.5) * 0.06, cs = Math.cos(jitter), sn = Math.sin(jitter);
      const ddx = dx * cs - dz * sn, ddz = dx * sn + dz * cs;
      const dvh = vh * (1 + (Math.random() - 0.5) * 0.05), dvv = vv * (1 + (Math.random() - 0.5) * 0.04);
      ctx.cannon.fireVel(fx, muzzleY, fz, ddx * dvh, dvv, ddz * dvh);
      ctx.cannonfx?.muzzle(new THREE.Vector3(fx, muzzleY, fz), new THREE.Vector3(ddx, 0.06, ddz), i === 0 ? 0.24 : 0.08, 3.0);
      const pr = ctx.cannon.projectiles[ctx.cannon.projectiles.length - 1]; if (pr) pr.owner = sh;
    };
    const GAP = BAL.naval.fireGap * 1000;
    for (let i = 0; i < guns; i++) { if (i === 0) doFire(0); else setTimeout(() => doFire(i), i * GAP); }
    sh._fireCd = BAL.naval.reload;
    return true;
  }

  // ★2026-07-13 버그수정(사령관 "3인칭 상태에서 나가는건 없애야할듯 무조건 Q,E에서만 대포나가게"):
  //   조타 중(3인칭, 조준 안 함)이면 보는 현측으로 자동 일제사격되던 옛 동작 제거 — Q/E 조준 중일 때만 발사.
  function fireFree() {
    const sh = ctx.ship;
    if (!sh || sh._sunk || !ctx.cannon) return;
    const nc = ctx.navalcombat;
    if (nc && !nc._disposed && sh.boarded) return;   // 조우 중 스테이션 발사 = navalcombat 담당(중복 방지)
    if (!sh.boarded) return;   // 조타/스테이션 점유 중에만(갑판 위 도보만으로는 발사 안 함)
    if (sh._fireCd > 0) return;
    if (!(ctx.player && ctx.player.navAiming)) return;   // Q/E 조준 중이 아니면 발사 없음(3인칭 블라인드 자동발사 폐지)
    fireNav(sh);
  }
  addEventListener('mousedown', e => { if (e.button === 0) fireFree(); });
  // 쿨다운 감쇠 — 조우 활성 중엔 navalcombat 메인 루프가 감쇠하므로 스킵(이중 감쇠 방지)
  // + 밴드 표시(조우 비활성 + 조타 + Q/E 조준 중일 때만 — 조우 활성 중엔 조우 자체 밴드가 담당).
  ctx.onUpdate(dt => {
    const sh = ctx.ship;
    if (!sh) { _band.visible = false; return; }
    const nc = ctx.navalcombat;
    const ncActive = nc && !nc._disposed;
    if (!ncActive && sh._fireCd > 0) sh._fireCd -= dt;
    if (ncActive || !sh.boarded || !(ctx.player && ctx.player.navAiming)) { _band.visible = false; return; }
    const a = navAim(sh);
    if (!a) { _band.visible = false; return; }
    refreshBand(a.th, a.H);
    const waterY = ctx.water ? (ctx.water.level || 0) : 0;
    const _hb = (sh.deckL || 13) * 0.5;
    _band.position.set(sh.x + a.dir.x * _hb, waterY + a.H, sh.z + a.dir.z * _hb);
    _band.rotation.y = Math.atan2(-a.dir.z, a.dir.x);
    _band.visible = true;
  });
  console.log('[navalcombat] 상시 함포(freefire) — 갑판/조타 좌클릭 = broadside, Q/E 조준 시 밴드+정밀사격(조우 무관)');
}

export function initNavalcombat(ctx, opts = {}) {
  const playerShip = opts.playerShip || (ctx.ships && ctx.ships[0]);
  // 다중 적 지원: enemyShips 배열 우선, 없으면 enemyShip 단일, 없으면 ctx.ships 나머지.
  const enemies = opts.enemyShips ? opts.enemyShips.slice() : (opts.enemyShip ? [opts.enemyShip] : (ctx.ships ? ctx.ships.slice(1) : []));
  const enemyShip = enemies[0];   // 대표(HUD·배너 기본)
  if (!playerShip || !enemyShip) { console.warn('[navalcombat] player/enemy 배 없음 — 전투 비활성'); return null; }

  // ── 파라미터(밸런스) ──
  // ★기본값 = balance.js(BAL.naval) 단일 소스. opts로 개별 override(튜토리얼 너프 등) 유지.
  const MAX_HP        = opts.maxHp        || BAL.naval.enemyMaxHp;
  const PLAYER_MAX_HP = opts.playerMaxHp  || BAL.naval.playerMaxHp;   // ★내 배만 HP 분리(튜토 완화)
  const HIT_DMG       = opts.hitDmg       || BAL.naval.cannonDmg;
  const GUNS_PER_SIDE = opts.gunsPerSide  || BAL.naval.gunsPerSide;
  const FIRE_CD       = opts.fireCd       || BAL.naval.reload;   // 공속(쿨다운)
  const ENEMY_FIRE_CD = opts.enemyFireCd  || FIRE_CD;   // ★적 발사 간격만 분리(튜토는 더 길게=덜 쏨). 기본=FIRE_CD
  const ENEMY_SPREAD  = opts.enemySpread  || BAL.naval.enemySpread;  // ★적 조준 산포 배율(튜토는 >1=잘 빗나감)
  const GUN_REACH     = opts.gunReach     || BAL.naval.gunReach; // 포탄 도달거리(현측 정면, 고정)
  const FIRE_RANGE    = opts.fireRange    || BAL.naval.fireRange;
  const AI_STANDOFF   = opts.aiStandoff   || BAL.naval.aiStandoff;
  const AI_SPEED      = opts.aiSpeed      || BAL.naval.aiSpeed;
  const AI_TURN       = opts.aiTurn       || BAL.naval.aiTurn;   // 최대 선회속도(rad/s)
  const AI_ACCEL      = opts.aiAccel      || 0.7;   // 속도 가감속(관성)
  const RESPAWN_DELAY = opts.respawnDelay || BAL.naval.enemyRespawn;   // 적 격침 후 재출현까지(초)
  const RESPAWN_DIST  = opts.respawnDist  || 145;   // 재출현 거리
  let   DO_RESPAWN    = opts.respawn !== false;     // 적 계속 리스폰. G키로 토글(테스트용)

  const _bow = new THREE.Vector3(), _inv = new THREE.Matrix4(), _lp = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();

  // ── 전투 배 등록 ──
  function enroll(sh, team, headOff, invincible, hp) {
    const h = hp || MAX_HP;
    sh.hp = h; sh.maxHp = h; sh.team = team;
    sh.headOff = headOff || 0; sh.invincible = !!invincible;
    sh._sunk = false; sh._sinkT = 0; sh._fireCd = 0; sh._hitFlash = 0;
    sh.combat = true;
    return sh;
  }
  enroll(playerShip, 'player', opts.playerHeadOff || 0, opts.playerInvincible !== false, PLAYER_MAX_HP);   // ★내 배 = 무적(기본) · HP=PLAYER_MAX_HP
  // 적 배별 headOff: enemyHeadOffs 배열 우선, 없으면 enemyHeadOff(단일) 또는 π 기본.
  const _headOffs = opts.enemyHeadOffs || null;
  enemies.forEach((E, i) => {
    const ho = _headOffs ? (_headOffs[i] != null ? _headOffs[i] : 0)
                         : (opts.enemyHeadOff != null ? opts.enemyHeadOff : Math.PI);
    enroll(E, 'enemy', ho, false);
    // 적 배는 ship.js 바람추진 끄고(furl=1) AI가 x/z/yaw 직접 굴림. ship.js가 mesh/forward/curMatrix 동기화.
    E.furl = 1; E.boarded = false;
    E.yaw = (E.headOff || 0) - Math.atan2(playerShip.z - E.z, playerShip.x - E.x);   // 시작 방향: 시각 뱃머리를 플레이어로
    E._aiSpd = 0; E._circDir = (i % 2 === 0) ? 1 : -1;   // 원선회 방향 번갈아(여럿이 한쪽으로 안 몰리게)
  });
  const ships = [playerShip, ...enemies];
  let enemyKills = 0;
  // 가장 가까운 살아있는 적
  function nearestEnemy() { let t = null, bd = Infinity; for (const E of enemies) { if (E._sunk) continue; const d = Math.hypot(E.x - playerShip.x, E.z - playerShip.z); if (d < bd) { bd = d; t = E; } } return { e: t, d: bd }; }

  // ── 🎵 전투 BGM (battle.mp3): 적 접근 시 반복재생, 멀어지면 정지(히스테리시스) ──
  const BATTLE_ON  = opts.battleOn  || 140;   // 이 거리 안 = 전투 시작(음악 ON)
  const BATTLE_OFF = opts.battleOff || 210;   // 이 거리 밖 = 전투 종료(음악 OFF). ON보다 멀게 둬서 떨림 방지
  // 🎵 전투 BGM은 sound.js BGM 매니저 SSOT로 위임(bgm.set('battle') force → 최우선, sail/storm보다 먼저). 파일=bgm_battle.mp3.
  let _battleOn = false;
  const ENEMY_NAME = opts.enemyName || "Queen Anne's Revenge";

  // ── ⚔️ 전투 개시 배너(전투개시에셋.png) — 사정권 진입 시 가운데에 진입한 배 이름 얹어 등장 ──
  const banner = document.createElement('div');
  banner.id = 'nc-battlebanner';
  banner.style.cssText = 'position:fixed;left:50%;top:16%;transform:translate(-50%,-14px);z-index:30;width:min(720px,62vw);aspect-ratio:1680/540;'
    + "background:url('" + encodeURI('/tomob-deploy/전투개시에셋.png') + "') center/contain no-repeat;"
    + 'pointer-events:none;opacity:0;transition:opacity .45s ease,transform .45s ease;filter:drop-shadow(0 8px 24px rgba(0,0,0,.6))';
  // 진입한 배 이름 = 단검 사이 가운데(에셋 세로 ~57% 지점)
  banner.innerHTML = `<div id="nc-bn-name" style="position:absolute;left:50%;top:56.5%;transform:translate(-50%,-50%);width:46%;text-align:center;
    font:700 clamp(15px,2.0vw,30px) Pretendard,system-ui,serif;color:#ffe6a8;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    text-shadow:0 0 10px rgba(255,180,80,.55),0 2px 4px #000"></div>`;
  document.body.appendChild(banner);
  const $bnName = banner.querySelector('#nc-bn-name');
  let _bnTimer = null, _bnHideTimer = null;
  const BANNER_HOLD = opts.bannerHold || 10000;   // 배너 유지 시간(ms) — 사령관 지정 10초
  function showBattleBanner(name) {
    $bnName.textContent = name || ENEMY_NAME;
    banner.style.opacity = '1'; banner.style.transform = 'translate(-50%,0)';
    clearTimeout(_bnTimer); clearTimeout(_bnHideTimer);
    _bnTimer = setTimeout(() => { banner.style.opacity = '0'; banner.style.transform = 'translate(-50%,-14px)'; }, BANNER_HOLD);   // 유지 후 페이드아웃
  }

  function updateBattleBgm() {
    const { e, d } = nearestEnemy();
    const want = !!e && d < (_battleOn ? BATTLE_OFF : BATTLE_ON);   // 가장 가까운 적 기준. 켜진 뒤엔 OFF거리까지 유지
    if (want && !_battleOn) { _battleOn = true; try { ctx.sound?.bgm?.set('battle'); } catch (e2) {}
      try { ctx.player?.cinematic?.(1600); } catch (e3) {}   // 🎥 전투 시작 시네마틱 카메라(사령관 2026-07-23) — 첫 교전 시 잠깐 pull-back
      showBattleBanner(ENEMY_NAME); }
    else if (!want && _battleOn) { _battleOn = false; try { ctx.sound?.bgm?.set(null); } catch (e2) {} }
  }

  // ── 시각 뱃머리 방향(forward를 headOff만큼 회전) ──
  function bowDir(sh) {
    const off = sh.headOff || 0, c = Math.cos(off), s = Math.sin(off);
    _bow.set(sh.forward.x * c - sh.forward.z * s, 0, sh.forward.x * s + sh.forward.z * c);
    return _bow;
  }
  function bowAngle(sh) { const b = bowDir(sh); return Math.atan2(b.z, b.x); }
  function angDiff(a, b) { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

  // ── 현측 일제사격(broadside) — ★실탄도: 적을 자동조준하지 않고 '현측 바깥'으로 고정 사거리 직사(중력 아크) ──
  //   (SoT/AC 방식) 게임이 안 맞혀줌 → 플레이어가 거리·각도·리드를 맞춰야 명중. 적 배도 동일(공평).
  //   ★2026-07-12: 발사 본체는 모듈 함수 fireBroadside()로 추출(자유항해 상시 발사 initFreeFire와 공용) — 수치·동작 동일.
  function broadside(sh, side, target) {
    if (sh._sunk || (target && target._sunk)) return false;
    return fireBroadside(ctx, sh, side, {
      cd: FIRE_CD, guns: GUNS_PER_SIDE, reach: GUN_REACH,
      spread: (sh.team === 'enemy') ? ENEMY_SPREAD : 1,   // ★적은 산포 배율↑(튜토 완화 시 잘 빗나감)
      kick: sh === playerShip ? 0.03 : 0,
    });
  }

  // ── 포탄 ↔ 배 명중 판정 ──
  function hitTest() {
    const projs = ctx.cannon && ctx.cannon.projectiles;
    if (!projs || !projs.length) return;
    // ⚡ 배별 역행렬 = 프레임당 1회 캐시 (기존: 포탄×배 조합마다 invert 반복)
    for (const sh of ships) { if (sh._sunk) continue; (sh._invM || (sh._invM = new THREE.Matrix4())).copy(sh.curMatrix).invert(); }
    for (const pr of projs) {
      if (pr.t <= 0) continue;
      const p = pr.mesh.position;
      for (const sh of ships) {
        if (sh._sunk || pr.owner === sh) continue;
        _lp.copy(p).applyMatrix4(sh._invM);
        const hl = (sh.deckW || 40) * 0.5 + 3;
        const hw = (sh.deckL || 12) * 0.5 + 2.5;
        const yLo = sh.deckLocalY - 5, yHi = sh.deckLocalY + (sh.deckTop || 10) * 0.6 + 4;
        if (Math.abs(_lp.x) < hl && Math.abs(_lp.z) < hw && _lp.y > yLo && _lp.y < yHi) {
          pr.t = 0;
          if (sh._sunk || sh._wrecking) break;   // ★2026-07-12(사령관): 이미 침몰한 배엔 피격FX/굉음 재생 안 함 — 잔해에 잔여 포탄이 계속 맞아 "가라앉는 소리가 자꾸 들리던" 버그 방지.
          const dir = new THREE.Vector3(pr.vx || 0, 0, pr.vz || 0);
          if (dir.lengthSq() > 1e-4) dir.normalize(); else dir.set(0, 0, 1);
          // ⚓ 승인 VFX(먼지폭발·큰판자·파편·잔불·연기) — 무적/피해 무관 항상. 화면킥 = 내 배 피격만 크게.
          ctx.cannonfx?.impact(p.clone(), dir, sh === playerShip ? 0.11 : 0.02);
          ctx.sound?.play?.('ship_crash', { vol: sh.invincible ? 0.35 : 0.45 });
          if (!sh.invincible) {                // ★무적 배는 데미지 0
            // ★D1(2026-07-15): 대포 업그레이드 배율 — 내 배(playerShip)가 쏜 포탄만 데미지 ×(1+mult×lv).
            const _upCan = (pr.owner === playerShip && ctx.shipUpgrades) ? (1 + BAL.ship.upgrades.cannon.mult*(ctx.shipUpgrades.cannon||0)) : 1;
            const dmg = HIT_DMG * (pr.dmgMul || 1) * _upCan;   // 🎯 정렬 명중 = 데미지 보너스(fireNav pr.dmgMul)
            sh.hp = Math.max(0, sh.hp - dmg);
            sh._hitFlash = 0.18;
            // 🎥 Phase4: 내 배가 maxHp 대비 큰 단발 피격 시 임팩트 카메라(흔들림 위주). 무적이면 여기 안 옴.
            if (sh === playerShip && dmg >= sh.maxHp * BAL.naval.impactHitFrac) ctx.player?.navImpactCam?.('hit');
            if (sh.hp > 0 && ctx.shipwreck) ctx.shipwreck.damage(sh, p.clone(), dir);   // 지속 화재/데미지 누적(격침 연출용)
            if (sh.hp <= 0 && !sh._sunk) sink(sh);
          }
          break;
        }
      }
    }
  }

  // ── 격침: destruct(three-pinata voronoi + Rapier) 파편으로 부서짐 + 폭연 ──
  function spawnDebris(sh) {
    if (!ctx.destruct || !ctx.destruct.makeBreakable) return;
    const fwd = sh.forward, shipLen = sh.deckW || 40, beam = sh.deckL || 12;
    const baseY = (sh.mesh ? sh.mesh.position.y : 0) + sh.deckLocalY;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95, metalness: 0.0 });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1.0 });
    const hullH = Math.max(4, (sh.deckTop || 10) * 0.4);
    // 선체 길이축을 따라 3덩어리 → 각각 voronoi 파편화(destruct는 프레임당 최대 3개 파괴)
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * shipLen * 0.3;
      const cx = sh.x + fwd.x * a, cz = sh.z + fwd.z * a;
      const box = new THREE.Mesh(new THREE.BoxGeometry(shipLen * 0.28, hullH, beam * 0.85), woodMat);
      box.position.set(cx, baseY + hullH * 0.3, cz);
      box.rotation.y = Math.atan2(fwd.x, -fwd.z);
      ctx.scene.add(box);
      ctx.destruct.makeBreakable(box, { mat: woodMat, inner: innerMat, hp: 1, buoy: true });   // buoy=수면에 떠서 잔해로 남음
      ctx.destruct._debugHit(box, 999);   // 즉시 파괴 → 파편이 Rapier 물리로 흩어짐
    }
  }

  // ★플레이어 배 완파 = 침몰이 아니라 '반파'(사령관 2026-07-04): 내구도 0·조타 불가·화재 —
  //   선체는 남고, 항구 수리 전까지 출항 불가. (구버전: 통째 침몰 → 게임오버도 없고 호출하면 불탄 채 소환되던 버그)
  function cripple(sh) {
    if (sh._crippled) return;
    sh._sunk = true;                        // 전투 판정용(패배 감지 + 적 타겟 제외) — 시각 침몰은 안 함
    sh._crippled = true; sh.boarded = false; sh.speed = 0; sh.yawVel = 0;
    sh.anchored = true; sh.furl = 1; sh.sail = 0;
    sh.durability = 0;                      // ⚓ 수리 필요(항구 🔧 — BAL.ship.repairCostPerDur)
    try { if (ctx.shipwreck && sh.mesh) {   // 반파 연출 = 갑판 화재 2점(수리 시 소화)
      const p = sh.mesh.position, dy = (sh.deckLocalY != null ? sh.deckLocalY : 3) + 1;
      for (let i = 0; i < 2; i++) ctx.shipwreck.damage(sh,
        new THREE.Vector3(p.x + (Math.random() - 0.5) * 6, p.y + dy, p.z + (Math.random() - 0.5) * 3),
        new THREE.Vector3(0, 0, 1));
    } } catch (_) {}
    try { ukToast('배가 반파됐다 — 항해 종료', { accent: 'red', ms: 3000 }); } catch (_) {}
    try { if (ctx.combat && ctx.combat.gameOver) ctx.combat.gameOver(); } catch (_) {}   // ⚔️ 반파 = 게임오버(사령관 2026-07-04)
  }
  function sink(sh) {
    if (sh._sunk) return;
    if (sh.team === 'player' && !sh.invincible) return cripple(sh);   // ★플레이어 배 = 반파 경로
    sh._sunk = true; sh._sinkT = 0; sh.boarded = false; sh.speed = 0;
    // ★격침 = 사령관 침몰 시스템(두 동강 절단 + 부력 침몰 + 화재/굉음). shipwreck가 기하 baking 후 절단 — visible=false는 그 다음.
    if (ctx.shipwreck) {
      ctx.shipwreck.sink(sh);                 // 절단+화재+연기+굉음+물보라까지 shipwreck가 처리
    } else {                                   // 폴백: shipwreck 없으면 구 보로노이 파편
      spawnDebris(sh);
      const fwd = sh.forward, shipLen = sh.deckW || 40;
      const baseY = (sh.mesh ? sh.mesh.position.y : 0) + sh.deckLocalY;
      for (let i = 0; i < 5; i++) { const a = (i / 4 - 0.5) * shipLen * 0.6;
        ctx.cannon.explode(sh.x + fwd.x * a, baseY + 1 + Math.random() * 2, sh.z + fwd.z * a); }
    }
    if (sh.mesh) sh.mesh.visible = false;   // 원본 선체 숨김(절단 덩이가 대신 보임)
    if (sh.team === 'enemy') { enemyKills++; ctx.player?.navImpactCam?.('sink'); }   // 🎥 Phase4: 적 격침 순간 카메라 컷인(FOV 좁힘+당김)
  }

  // ── 적 리스폰(테스트용 — 격침 후 새 배로 재출현) ──
  function respawnEnemy() {
    const E = enemyShip, P = playerShip;
    const ang = (enemyKills * 1.7) % (Math.PI * 2);   // 킬마다 다른 방향(Math.random 대신 결정적 변주)
    E.x = P.x + Math.cos(ang) * RESPAWN_DIST;
    E.z = P.z + Math.sin(ang) * RESPAWN_DIST;
    E.yaw = (E.headOff || 0) - Math.atan2(P.z - E.z, P.x - E.x);   // 뱃머리를 플레이어로
    E.speed = 0; E.furl = 1; E.boarded = false; E._fireCd = 0; E._aiSpd = 0;
    E.hp = E.maxHp; E._sunk = false; E._sinkT = 0; E._respawnT = 0; E._wrecking = false; E._wreckRoll = 0; E._fires = [];   // 재격침 가능하게
    // 부력 평형으로 정착
    if (ctx.water && ctx.water.heightAt) { E.buoyY = ctx.water.heightAt(E.x, E.z) - E.deckLocalY * 0.4; E.pitchA = 0; E.roll = 0; }
    if (E.mesh) { E.mesh.visible = true; E.mesh.position.y = E.buoyY; }
  }

  // ── 적 배 AI: "배처럼" 항해 — 선회속도 제한(넓은 조타 곡선)+관성, 교전권선 플레이어 중심 원선회(현측 사격) ──
  function aiUpdate(dt, E) {
    const P = playerShip;
    if (!E || E._sunk) return;
    const dx = P.x - E.x, dz = P.z - E.z, dist = Math.hypot(dx, dz) || 1e-6;
    const toPlayer = Math.atan2(dz, dx);   // 월드 각도(플레이어 방향)
    if (E._circDir == null) E._circDir = 1;   // 원선회 방향(좌/우현 — 한쪽으로 돌며 현측 유지)

    // 원하는 뱃머리(월드각)
    let wantBow;
    if (dist > AI_STANDOFF * 1.5) {
      wantBow = toPlayer;                                          // 멀면 접근(회전 느려 넓게 돌아 들어옴 = 호밍 아님)
    } else {
      const tangent = toPlayer + E._circDir * (Math.PI / 2);      // 플레이어 접선 = 원선회(현측이 적을 향함)
      const radialErr = (dist - AI_STANDOFF) / AI_STANDOFF;       // + 너무 멈 / - 너무 가까움
      wantBow = tangent - E._circDir * THREE.MathUtils.clamp(radialErr, -0.7, 0.7);   // 거리유지(살짝 안/밖으로 조타)
    }

    // ★조타 느낌: 선회속도 제한 → 제자리 회전 불가, 넓은 곡선으로 돈다.
    const targetYaw = (E.headOff || 0) - wantBow;
    E.yaw += THREE.MathUtils.clamp(angDiff(targetYaw, E.yaw), -AI_TURN * dt, AI_TURN * dt);

    // ★관성: 목표 속도로 가감속(급출발/급정지 없음)
    const targetSpd = AI_SPEED * (dist > AI_STANDOFF * 0.6 ? 1 : 0.45);
    E._aiSpd = (E._aiSpd || 0) + (targetSpd - (E._aiSpd || 0)) * Math.min(1, dt * AI_ACCEL);

    // 항상 '시각 뱃머리' 방향으로 전진 → 회전이 느려 직선 호밍이 아니라 곡선 항해
    const bd = bowDir(E);
    E.x += bd.x * E._aiSpd * dt; E.z += bd.z * E._aiSpd * dt;

    // 사격: 현측이 플레이어에 정렬되면
    if (E._fireCd <= 0 && dist < FIRE_RANGE) {
      const s = E.sideToward(P.x, P.z);
      if (s.align > 0.5 && broadside(E, s.side, P)) E._fireCd = ENEMY_FIRE_CD;   // ★적 발사 간격 = ENEMY_FIRE_CD(튜토는 더 길게)
    }
  }

  // ── 🧭 조준 현측 판정 — 카메라(뷰) 수평 방향이 향하는 현(좌/우) ──
  //   ★블랙플래그식: 조타 3인칭 뷰 방향(뱃머리 기준 _steerYaw 회전)을 그대로 조준선으로 씀.
  //   뷰를 좌현 빔으로 돌리면 좌현, 우현 빔으로 돌리면 우현 일제사격. 카메라 코드 무수정.
  const _camDir = new THREE.Vector3();
  function aimSide() {
    if (ctx.camera) {
      ctx.camera.getWorldDirection(_camDir);
      const tx = playerShip.x + _camDir.x * GUN_REACH, tz = playerShip.z + _camDir.z * GUN_REACH;
      return playerShip.sideToward(tx, tz).side;
    }
    const { e } = nearestEnemy();                          // 폴백: 가장 가까운 적 쪽 현
    return e ? playerShip.sideToward(e.x, e.z).side : 'starboard';
  }

  // ── 플레이어 사격 입력(좌클릭) ──
  //   · Q/E 조준 중 = ⚔️ 밴드와 일치하는 정밀사격(fireNav)
  //   · 포 스테이션(크루, 대포 슬롯 점유) = 카메라 방향 단발 정밀 직사(기존 §C)
  //   ★2026-07-13 버그수정(사령관 "3인칭 상태에서 나가는건 없애야할듯 무조건 Q,E에서만 대포나가게"):
  //   조타 중(3인칭, 조준 안 함)이면 보는 현측으로 자동 일제사격되던 옛 동작(2026-07-10 개편) 제거.
  //   대포는 이제 ①Q/E 조준(navAiming) ②포 스테이션(카메라 조준) 두 경우에만 나간다. 그 외 좌클릭=무반응.
  const _aimDir = new THREE.Vector3(), _aimPos = new THREE.Vector3();
  function playerFire() {
    if (!playerShip.boarded) return;   // ★배 조종(스테이션 점유) 중에만
    if (playerShip._sunk || playerShip._fireCd > 0) return;
    // ⚔️ Q/E 조준 중 = 4방향(선두/선미/좌현/우현) 정밀사격 + 락온 자동명중
    if (ctx.player && ctx.player.navAiming) { fireNav(); return; }
    // 💣 포 스테이션(크루 시스템, 대포 슬롯 점유): 카메라(조준) 방향 단발 — ★포탄은 '대포 포구'에서 나감(눈높이 아님)
    if (ctx.crew && ctx.crew.isPlayerAt('cannon') && ctx.camera) {
      ctx.camera.getWorldDirection(_aimDir);
      // 포구 = 대포 슬롯 월드 위치(카메라=눈높이가 아니라 실제 대포 자리에서 발사 → "위에서 나감" 해소)
      const cl = ctx.crew.activeCannonLocal && ctx.crew.activeCannonLocal();
      if (cl && playerShip.curMatrix) _aimPos.copy(cl).applyMatrix4(playerShip.curMatrix);
      else ctx.camera.getWorldPosition(_aimPos);
      const mx = _aimPos.x + _aimDir.x * 2.2, my = _aimPos.y + 1.0 + _aimDir.y * 2.2, mz = _aimPos.z + _aimDir.z * 2.2;   // 포신 끝(대포 위 1m·앞 2.2m)
      const reach = GUN_REACH;                                    // 조준선 따라 도달거리 지점 = 탄도 목표(중력 아크)
      const tx = mx + _aimDir.x * reach, ty = my + _aimDir.y * reach, tz = mz + _aimDir.z * reach;
      ctx.cannon.fire(mx, my, mz, tx, ty, tz);
      ctx.cannon.muzzleFlash?.(mx, my, mz, _aimDir.x, _aimDir.z);
      const pr = ctx.cannon.projectiles[ctx.cannon.projectiles.length - 1]; if (pr) pr.owner = playerShip;
      playerShip._fireCd = FIRE_CD;
      return;
    }
    // 그 외(3인칭 조타 중·조준 안 함·포 스테이션 아님) = 발사 없음
  }
  // ── ⚔️ 크루 자동 포격(crew.js 호출) — 플레이어가 조타 스테이션일 때 안 잡은 포를 크루가 맡음. ──
  //   현측 정렬 시 자동 일제사격(플레이어 좌클릭 발사와 동일 broadside). sh = 플레이어 배.
  function autoCrewFire(sh) {
    if (!sh || sh._sunk || sh._fireCd > 0) return;
    const { e } = nearestEnemy();
    if (!e) return;
    const s = sh.sideToward(e.x, e.z);
    if (s.align > 0.5) broadside(sh, s.side, e);   // 정렬(현측이 적 향함) 시에만
  }
  // ── 적 리젠(리스폰) 토글 — G키 (테스트용: 해적선 계속 나오는 거 켜고 끄기) ──
  function toggleRespawn(force) {
    DO_RESPAWN = (force != null) ? !!force : !DO_RESPAWN;
    toast(`적 리젠 ${DO_RESPAWN ? 'ON' : 'OFF'} ${DO_RESPAWN ? '(격침 시 재출현)' : '(더 안 나옴)'}`);
    return DO_RESPAWN;
  }
  // ★토스트 = uikit 공통(전투 = red). 디자인 시스템 단일 출처.
  function toast(msg) { ukToast(msg, { accent:'red', ms:1600 }); }
  const _onKey = e => { if (e.code === 'KeyG') toggleRespawn(); };   // 사격은 좌클릭 전용(F 제거)
  const _onMouse = e => { if (e.button === 0) playerFire(); };
  addEventListener('keydown', _onKey);
  addEventListener('mousedown', _onMouse);

  // ── HUD ──
  const hud = document.createElement('div');
  hud.id = 'navalHud';
  hud.style.cssText = 'position:fixed;inset:0;z-index:7;pointer-events:none;font:13px Pretendard,system-ui,sans-serif;color:#f2ead6';
  hud.innerHTML = `
    <div id="nc-enemy" style="position:absolute;left:50%;top:18px;transform:translateX(-50%);width:min(420px,70vw);text-align:center">
      <div style="font:600 13px Pretendard;letter-spacing:.08em;color:#ff9a8a;text-shadow:0 1px 3px #000;margin-bottom:5px">적 해적선 — Queen Anne's Revenge <span id="nc-kills" style="color:#ffd98a"></span></div>
      <div style="height:15px;background:rgba(0,0,0,.55);border:1px solid rgba(255,120,90,.55);border-radius:8px;overflow:hidden">
        <div id="nc-ehp" style="height:100%;width:100%;background:linear-gradient(90deg,#e8503a,#ff7a4a);transition:width .15s"></div></div>
      <div id="nc-estat" style="font:11px ui-monospace,Consolas,monospace;color:#bdb4a0;margin-top:3px"></div>
    </div>
    <div id="nc-me" style="position:absolute;left:18px;bottom:112px;width:min(300px,40vw)">
      <!-- ★2026-07-10(사령관 "내 배 체력바랑 캐릭터 체력바 겹침") — 원래 bottom:18px가 combat.js #_cbhud(플레이어 HP/스태미나, 동일 left:18px bottom:16px)와 완전히 겹쳤음. 그 위로 올림. -->
      <div style="font:600 12px Pretendard;letter-spacing:.06em;color:#8fd0ff;text-shadow:0 1px 3px #000;margin-bottom:4px">내 배 — Caravel <span id="nc-pinv" style="color:#7dffb0"></span></div>
      <div style="height:14px;background:rgba(0,0,0,.55);border:1px solid rgba(120,180,255,.55);border-radius:8px;overflow:hidden">
        <div id="nc-php" style="height:100%;width:100%;background:linear-gradient(90deg,#3a86e8,#5ab0ff)"></div></div>
    </div>
    <div id="nc-fire" style="position:absolute;right:18px;bottom:18px;text-align:right;text-shadow:0 1px 3px #000">
      <div style="font:600 13px Pretendard;color:#ffd98a;display:flex;align-items:center;justify-content:flex-end;gap:4px"><img src="/tomob-deploy/ui/icons/icon_cannon.png" style="height:18px;filter:drop-shadow(0 1px 1px #000)">사격 <span class="k">좌클릭</span> <span style="color:#bdb4a0;font-weight:400">현측 직사</span></div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:4px"><img src="/tomob-deploy/ui/icons/icon_reload.png" style="height:15px;filter:drop-shadow(0 1px 1px #000)"><span id="nc-cd" style="font:12px ui-monospace,Consolas,monospace;color:#9fe">준비됨</span></div>
      <div id="nc-side" style="font:12px Pretendard;color:#bdb4a0;margin-top:2px"></div>
      <div style="font:11px Pretendard;color:#8a8170;margin-top:5px"><span class="k">G</span> 적 리젠 ON/OFF</div>
    </div>
    <!-- ⚓ 조준 레티클 + 조준 현측(조타 사격 시만 표시) — Phase1: 어느 현이 발사되는지 -->
    <div id="nc-reticle" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border:2px solid rgba(242,234,214,.8);border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,.8),inset 0 0 3px rgba(0,0,0,.6);display:none"></div>
    <div id="nc-aimside" style="position:absolute;left:50%;top:calc(50% + 20px);transform:translateX(-50%);font:700 13px Pretendard;letter-spacing:.04em;text-shadow:0 1px 3px #000;white-space:nowrap;display:none"></div>
    <!-- 🎯 거리 정렬(초록 체크) — 목표거리↔적거리 tolerance 이내 + 락온 시 등장(발사 준비) -->
    <div id="nc-aimcheck" style="position:absolute;left:calc(50% + 16px);top:calc(50% - 9px);font:800 16px Pretendard;color:#7dffa0;text-shadow:0 0 7px rgba(60,255,140,.65),0 1px 3px #000;display:none">✓</div>
    <style>#navalHud .k{display:inline-block;padding:1px 6px;background:rgba(0,0,0,.5);border:1px solid #6a5f48;border-bottom-width:2px;border-radius:5px;color:#f0e6cf;font:700 12px ui-monospace,Consolas,monospace}</style>`;
  document.body.appendChild(hud);
  const $ehp = hud.querySelector('#nc-ehp'), $php = hud.querySelector('#nc-php');
  const $cd = hud.querySelector('#nc-cd'), $side = hud.querySelector('#nc-side');
  const $kills = hud.querySelector('#nc-kills'), $estat = hud.querySelector('#nc-estat');
  const $pinv = hud.querySelector('#nc-pinv');
  const $reticle = hud.querySelector('#nc-reticle'), $aimside = hud.querySelector('#nc-aimside');
  const $aimcheck = hud.querySelector('#nc-aimcheck');
  let _wasAligned = false;   // 초록체크 진입(rising edge)에 사운드 큐 — 매프레임 재생 방지

  // ══ ⚔️ 해전 조준(우클릭) — 폭 있는 반투명 곡면 밴드 + 실탄도 100% 일치 + 파파파팍 순차 ══
  //   ★2026-07-12 레퍼런스(블랙플래그 리싱크드 mp4) 재구현. 이전 "가느다란 튜브 선"은 폐기.
  //   레퍼런스: 조준 시 포구에서 앞바다로 뻗는 "폭 있는 반투명 흰 곡면 리본"(앞 넓고 착탄쪽 좁음)이 뜬다.
  //   마우스 위/아래 = 발사각 θ. 아래=직사(밴드 평평·정점 낮음·근거리 착탄) / 위=곡사(밴드 위로 크게 휨·멀리 착탄).
  //   fireVel()로 밴드와 동일 θ·v0로 발사 → 눈에 보이는 곡선 그대로 포탄이 날아간다.
  const NAV_G = BAL.naval.projGravity;   // 24 — cannon PROJ_G와 동일해야 밴드=실탄도
  const _cd = new THREE.Vector3();
  // 마우스 피치(-0.7~0.9, 위로 볼수록 큼) → 발사각. 위=곡사(max) / 아래=직사(min).
  function aimAngle(){
    const p = (ctx.player && ctx.player.steerPitch);
    const t = THREE.MathUtils.clamp(((p==null?0:p) + 0.7) / 1.6, 0, 1);
    return BAL.naval.aimAngMin + (BAL.naval.aimAngMax - BAL.naval.aimAngMin) * t * t;   // 제곱=대부분 직사, 위로 많이 올려야 곡사
  }
  // 포구 높이 H(수면 위)에서 발사각 θ·총구속도 v0 → 수면(y=-H) 착탄까지 비행시간 T.
  function landTime(th, v0, H){ const vv=v0*Math.sin(th); return (vv + Math.sqrt(vv*vv + 2*NAV_G*H)) / NAV_G; }
  function muzzleHeight(){   // 포구가 수면 위 얼마나 높은지(실측) — 밴드 시작점 = 실제 포구
    const waterY = ctx.water ? (ctx.water.level||0) : 0;
    const my = (playerShip.mesh?playerShip.mesh.position.y:0) + playerShip.deckLocalY + 1.2;
    return Math.max(1.5, my - waterY);
  }
  // 폭 있는 곡면 리본 지오메트리. 로컬 +X=조준 수평방향, y=포구(0)에서 시작, z=좌우 폭.
  // ⚔️ 레퍼런스(ref/해상전투1~3, AC 리코드) = 넓은 밴드 + 밝은 흰 가장자리(테두리) + 안쪽 옅게 채움. 근거리 거의 투명 → 착탄쪽으로 차오름.
  //   구현 = 밴드 필에 2D 알파 그라디언트(정점 RGBA, three r160 vertexColors 알파 USE_COLOR_ALPHA). 색·전체 알파(BASE)는 재질에서(락온 틴트용).
  const INTERIOR = 0.22;   // 안쪽(중앙) 옅은 채움 알파 — 완전 투명 아님(사령관: 서서히 배경 생김). 가장자리는 1.0(밝은 흰 테두리).
  const _bandMat = new THREE.MeshBasicMaterial({ color:0xffffff, vertexColors:true, transparent:true, depthWrite:false, opacity:0.85, side:THREE.DoubleSide });
  const _smooth = (a,b,x)=>{ x=THREE.MathUtils.clamp((x-a)/(b-a),0,1); return x*x*(3-2*x); };   // smoothstep(a,b,x)
  function buildBandGeo(th, v0, H){
    const vh=v0*Math.cos(th), vv=v0*Math.sin(th), T=landTime(th,v0,H), N=28, M=5;   // M=단면 5정점(-1,-0.5,0,0.5,1) — 가장자리 rim 부드럽게(하드선 방지). 위치/폭/궤적은 불변, 단면 세분만.
    const angN = THREE.MathUtils.clamp((th-BAL.naval.aimAngMin)/(BAL.naval.aimAngMax-BAL.naval.aimAngMin),0,1);
    const W0 = BAL.naval.bandBaseW * (1 - BAL.naval.bandFarNarrow*angN);   // 원거리(고각)=전체 폭 좁음
    const pos=new Float32Array((N+1)*M*3), col=new Float32Array((N+1)*M*4), idx=[];
    const frac=[-1,-0.5,0,0.5,1];   // 단면 폭방향 정규좌표(-1~1)
    for(let i=0;i<=N;i++){ const s=i/N, t=T*s;
      const cx=vh*t, cy=vv*t - 0.5*NAV_G*t*t;                    // 포물선 중심선(불변)
      const hw=Math.max(0.4, W0*(1 - BAL.naval.bandTaper*s));    // 반폭(불변) — 앞 넓고 착탄쪽 좁음
      const aLen=_smooth(0.0, 0.85, s);                          // 길이: 근거리 거의0 → 착탄쪽 차오름 ★사령관 핵심
      for(let m=0;m<M;m++){ const b=i*M+m, f=frac[m];
        pos[b*3+0]=cx; pos[b*3+1]=cy; pos[b*3+2]=f*hw;
        const edge=_smooth(0.35, 1.0, Math.abs(f));              // 중앙0 → 가장자리1 (부드럽게)
        const aCross=INTERIOR + (1.0-INTERIOR)*edge;             // 중앙=옅은 채움 / 가장자리=1.0(밝은 흰 테두리)
        const a=aLen*aCross;                                     // 최종 = 길이 × 단면
        col[b*4+0]=1; col[b*4+1]=1; col[b*4+2]=1; col[b*4+3]=a; } }   // RGB=흰색(틴트는 _bandMat.color) · A=그라디언트
    for(let i=0;i<N;i++){ for(let m=0;m<M-1;m++){ const a=i*M+m, b=i*M+m+1, c=(i+1)*M+m, d=(i+1)*M+m+1; idx.push(a,b,c, b,d,c); } }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    g.setAttribute('color', new THREE.BufferAttribute(col,4));   // ★itemSize 4 = RGBA → USE_COLOR_ALPHA(r160)로 정점 알파가 최종 알파에 곱해짐
    g.setIndex(idx);
    return g;
  }
  const _band = new THREE.Mesh(buildBandGeo(BAL.naval.aimAngMin, BAL.naval.muzzleSpeed, 4), _bandMat);
  _band.renderOrder=4; _band.visible=false; ctx.scene.add(_band);
  let _bandKey='';   // (θ,H) 캐시 — 유의미 변화 시만 재생성(매프레임 아님)
  function refreshBand(th, H){ const k=th.toFixed(3)+'_'+H.toFixed(1); if(k===_bandKey) return; _bandKey=k;
    const g=_band.geometry; _band.geometry=buildBandGeo(th, BAL.naval.muzzleSpeed, H); if(g) g.dispose(); }   // θ·H 변화 시 지오+RGBA 그라디언트 재계산
  // 🎯 정렬: 밴드 착탄거리(reach) ↔ 최근접 적 실거리가 tolerance 이내 + 락온 → 초록 체크·밴드 빨강.
  function bandAligned(a){ if(!a || !a.lock) return false; const ne=nearestEnemy(); return !!ne.e && Math.abs(a.reach - ne.d) <= BAL.naval.bandAlignTol; }
  // 조준 정보: 대포 현측(Q=좌현/E=우현) 방향 + 마우스 좌우(navAimYaw) 스윙 + 발사각 → 착탄거리 reach + 락온 적.
  //   ★카메라 = 현측 방향 + navAimYaw로 회전(player.js). 밴드(_band.rotation.y)·실탄도(fireNav a.dir)가 이 방향과 정확히 일치.
  function navAim(){
    const side = ctx.player && ctx.player.navAimSide;
    if(!side) return null;
    const sv = (side==='port') ? playerShip.portSide : playerShip.starboardSide;
    if(!sv) return null;
    _cd.set(sv.x, 0, sv.z); if(_cd.lengthSq()<1e-4) return null; _cd.normalize();   // 현측 바깥 방향
    const _y = (ctx.player && ctx.player.navAimYaw) || 0;   // ⚔️ 마우스 좌우 조준 스윙(±aimYawMax) — 카메라와 동일하게 Y축 회전
    if(_y){ const cs=Math.cos(_y), sn=Math.sin(_y), x=_cd.x, z=_cd.z; _cd.set(x*cs+z*sn, 0, z*cs-x*sn); }   // az+=_y 회전(카메라 az=atan2(sv.x,sv.z)+_aimYaw와 부호 일치)
    const th=aimAngle(), v0=BAL.naval.muzzleSpeed, H=muzzleHeight();
    const vh=v0*Math.cos(th), T=landTime(th,v0,H), reach=vh*T;   // 수면 착탄 수평거리(= 밴드 끝)
    const lx=playerShip.x, lz=playerShip.z;
    // 🔴 락온 = 조준선이 '실제 적 선체'에 닿고 착탄거리 안일 때만.
    let lock=null, lockD=Infinity;
    for(const E of enemies){ if(E._sunk) continue;
      const rx=E.x-lx, rz=E.z-lz, along=rx*_cd.x+rz*_cd.z; if(along<8 || along>reach*1.25) continue;
      const lat=Math.abs(rx*(-_cd.z)+rz*_cd.x);
      const hitR=(E.deckL||10)*0.55 + (E.deckW||30)*0.12;   // 적 선체 반경 근사
      if(lat > hitR) continue;
      if(along<lockD){ lockD=along; lock=E; } }
    return { dir:new THREE.Vector3(_cd.x,0,_cd.z), th, v0, H, reach, lock };
  }
  // 4방향 사격(선두/선미/좌현/우현) — 조준 섹터 대포를 파파파팍 순차 발사. 밴드와 동일 θ·v0(fireVel) → 보이는 곡선 그대로 날아감.
  function fireNav(){
    if(playerShip._sunk || playerShip._fireCd>0) return false;
    const a=navAim(); if(!a) return false;
    const fwd=playerShip.forward, aimAng=Math.atan2(a.dir.x,a.dir.z), fwdAng=Math.atan2(fwd.x,fwd.z);
    let rel=aimAng-fwdAng; while(rel>Math.PI)rel-=2*Math.PI; while(rel<-Math.PI)rel+=2*Math.PI;
    const ar=Math.abs(rel); let sector;
    if(ar<Math.PI/4) sector='bow'; else if(ar>3*Math.PI/4) sector='stern';
    else { const ds=a.dir.x*playerShip.starboardSide.x+a.dir.z*playerShip.starboardSide.z; sector=ds>0?'starboard':'port'; }
    const hl=(playerShip.deckW||40)*0.42, bm=(playerShip.deckL||12)*0.5, spanL=(playerShip.deckW||40)*0.5;
    const guns=(sector==='bow'||sector==='stern')?2:GUNS_PER_SIDE;
    const ax=(sector==='bow'||sector==='stern')?playerShip.starboardSide:playerShip.forward;   // 포문 배치축
    const dx=a.dir.x, dz=a.dir.z, lock=a.lock, aligned=bandAligned(a);   // ★값 캡처(_cd는 공유 temp)
    const vh=a.v0*Math.cos(a.th), vv=a.v0*Math.sin(a.th);   // 밴드와 동일 초기속도(수평·수직 성분)
    const doFire=(i)=>{ if(playerShip._sunk) return;
      const muzzleY=(playerShip.mesh?playerShip.mesh.position.y:0)+playerShip.deckLocalY+1.2;
      let bx,bz;   // 발사 시점 포구 위치 재계산(순차 중 배 이동 반영)
      if(sector==='bow'){ bx=playerShip.x+playerShip.forward.x*hl; bz=playerShip.z+playerShip.forward.z*hl; }
      else if(sector==='stern'){ bx=playerShip.x-playerShip.forward.x*hl; bz=playerShip.z-playerShip.forward.z*hl; }
      else { const sv=(sector==='starboard')?playerShip.starboardSide:playerShip.portSide; bx=playerShip.x+sv.x*bm; bz=playerShip.z+sv.z*bm; }
      const off=(guns===1)?0:(i/(guns-1)-0.5), fx=bx+ax.x*off*spanL*0.8, fz=bz+ax.z*off*spanL*0.8;
      // 산탄: 좌우 각(yaw)·속도에 소량 지터. 락온·정렬 시 축소. 발사각(밴드 곡률) 자체는 유지.
      let sp=(lock?0.5:1.0); if(aligned) sp*=BAL.naval.bandAlignSpreadMul;
      const yaw=(Math.random()-0.5)*0.06*sp, cs=Math.cos(yaw), sn=Math.sin(yaw);
      const ddx=dx*cs - dz*sn, ddz=dx*sn + dz*cs;                       // 조준 수평방향 + 좌우 지터
      const dvh=vh*(1+(Math.random()-0.5)*0.05*sp), dvv=vv*(1+(Math.random()-0.5)*0.04*sp);
      ctx.cannon.fireVel(fx,muzzleY,fz, ddx*dvh, dvv, ddz*dvh);         // ★밴드와 동일 물리로 발사
      ctx.cannonfx?.muzzle(new THREE.Vector3(fx,muzzleY,fz), new THREE.Vector3(ddx,0.06,ddz), i===0?0.24:0.08, 3.0);   // 첫 포 묵직·나머지 약한 킥 + 머즐·연기 3.0배(사령관 타격감·연기 더 강화)
      const pr=ctx.cannon.projectiles[ctx.cannon.projectiles.length-1]; if(pr){ pr.owner=playerShip; if(aligned) pr.dmgMul=BAL.naval.bandAlignDmgMul; }
    };
    const GAP=BAL.naval.fireGap*1000;
    for(let i=0;i<guns;i++){ if(i===0) doFire(0); else setTimeout(()=>doFire(i), i*GAP); }   // ⚡ 파파파팍 순차
    playerShip._fireCd=FIRE_CD;
    return true;
  }

  // ── 메인 루프 ──
  ctx.onUpdate(dt => {
    if (api._disposed) return;   // ★P3: dispose 후엔 전투 루프 정지(AI·hitTest·BGM폴링·HUD 갱신이 영원히 돌던 것 — 승리 후~컷신 내내 부담)
    for (const sh of ships) { if (sh._fireCd > 0) sh._fireCd -= dt; if (sh._hitFlash > 0) sh._hitFlash -= dt; }
    for (const E of enemies) aiUpdate(dt, E);   // 적 전부 AI
    hitTest();
    for (const sh of ships) if (sh.hp <= 0 && !sh.invincible && !sh._sunk) sink(sh);
    // 격침된 적 → 리스폰 (단일 적 모드에서만; 다중은 격침 후 그대로)
    if (enemies.length === 1 && enemyShip._sunk) {
      enemyShip._respawnT = (enemyShip._respawnT || 0) + dt;
      if (DO_RESPAWN && enemyShip._respawnT >= RESPAWN_DELAY) respawnEnemy();
    }
    updateBattleBgm();   // 🎵 전투 음악 ON/OFF + 배너

    // HUD — 가장 가까운 적 기준 + 남은 적 수
    const aliveN = enemies.filter(e => !e._sunk).length;
    const { e: ne, d: nd } = nearestEnemy();
    $ehp.style.width = ne ? (ne.hp / ne.maxHp * 100).toFixed(1) + '%' : '0%';
    // 내 배 HP — 무적이면 ∞, 격침 가능(playerInvincible:false)이면 실제 HP 바·숫자 표시
    if (playerShip.invincible) { $php.style.width = '100%'; if ($pinv) $pinv.textContent = '∞ 무적'; }
    else {
      $php.style.width = (playerShip.hp / playerShip.maxHp * 100).toFixed(1) + '%';
      $php.style.background = playerShip.hp / playerShip.maxHp < 0.3 ? 'linear-gradient(90deg,#e8503a,#ff7a4a)' : 'linear-gradient(90deg,#3a86e8,#5ab0ff)';
      if ($pinv) { $pinv.textContent = `HP ${Math.ceil(playerShip.hp)}/${playerShip.maxHp}`; $pinv.style.color = playerShip.hp / playerShip.maxHp < 0.3 ? '#ff9a8a' : '#8fd0ff'; }
    }
    $kills.textContent = `${enemyKills > 0 ? `· 격침 ${enemyKills}` : ''}${enemies.length > 1 ? ` · 남은 적 ${aliveN}` : ''}`;
    $cd.textContent = playerShip._fireCd > 0 ? `재장전 ${playerShip._fireCd.toFixed(1)}s` : '준비됨';
    $cd.style.color = playerShip._fireCd > 0 ? '#ffae6a' : '#9fe';
    if (!ne) {
      $side.textContent = enemies.length > 1 ? '적 전멸' : '';
      $estat.textContent = (enemies.length === 1 && enemyShip._sunk) ? `격침됨 — 재출현 ${Math.max(0, RESPAWN_DELAY - (enemyShip._respawnT || 0)).toFixed(1)}s` : '적 전멸';
    } else {
      const s = playerShip.sideToward(ne.x, ne.z);
      const inReach = Math.abs(nd - GUN_REACH) < GUN_REACH * 0.28;   // 포탄 도달거리 근처면 명중 유리
      $side.textContent = `적 ${nd.toFixed(0)}m · ${s.side === 'starboard' ? '우현' : '좌현'} 정렬 ${(s.align * 100).toFixed(0)}% · 사거리 ${GUN_REACH}m ${inReach ? '호기' : (nd > GUN_REACH ? '↓접근' : '↑이격')}`;
      $side.style.color = inReach && s.align > 0.55 ? '#9effa0' : '#bdb4a0';
      $estat.textContent = '';
    }
    // ── ⚔️ 조준(우클릭): 폭 있는 곡면 밴드(마우스↕=발사각) + 레티클(락온=빨강) / 아니면 조타 현측 표시 ──
    const aiming = ctx.player && ctx.player.navAiming;
    if (aiming) {
      const a = navAim();
      if (a) {
        refreshBand(a.th, a.H);   // 발사각·포구높이 변하면 곡면 재생성(캐시)
        const muzzleY = (ctx.water ? (ctx.water.level||0) : 0) + a.H;
        const _hb = (playerShip.deckL||13) * 0.5;   // 반빔 = 배 중심 → 조준 현측 대포 라인
        _band.position.set(playerShip.x + a.dir.x*_hb, muzzleY, playerShip.z + a.dir.z*_hb);   // ★밴드 시각 원점 = 현측 대포(중심 아님). reach/lock은 중심 기준 유지(거리 계산 불변).
        _band.rotation.y = Math.atan2(-a.dir.z, a.dir.x);          // +X 로컬 → 조준 수평방향
        _band.visible = true;
        const aligned = bandAligned(a);   // 🎯 착탄거리 정렬 + 락온
        // 그라디언트(길이·폭 페이드)는 정점 알파에 고정. 락온 피드백 = 재질 색(약한 붉은빛) + 전체 알파(BASE)만 조정. 구조는 불변.
        if (aligned) { _bandMat.color.setRGB(1, 0.5, 0.42); _bandMat.opacity = 0.95; }
        else { _bandMat.color.setRGB(1, 1, 1); _bandMat.opacity = 0.85; }
        $reticle.style.display = $aimside.style.display = 'block';
        $reticle.style.borderColor = a.lock ? 'rgba(255,80,60,.95)' : 'rgba(242,234,214,.9)';
        $aimside.textContent = (a.lock ? '🔴 조준 명중권' : '조준') + ` · 착탄 ${a.reach.toFixed(0)}m · 마우스↕ 탄도`;
        $aimside.style.color = a.lock ? '#ff6a5a' : '#eaf6ff';
        $aimcheck.style.display = aligned ? 'block' : 'none';
        _wasAligned = aligned;   // 락온 진입 사운드('띠링') 제거(사령관). 녹색 체크 ✓ 시각만 유지.
      } else { _band.visible = false; $aimcheck.style.display = 'none'; _wasAligned = false; }
    } else {
      _band.visible = false; $aimcheck.style.display = 'none'; _wasAligned = false;
      const atHelmFire = playerShip.boarded && !playerShip._sunk && !(ctx.crew && ctx.crew.isPlayerAt('cannon'));
      if (atHelmFire) {
        const side = aimSide(), loaded = playerShip._fireCd <= 0;
        $reticle.style.display = $aimside.style.display = 'block';
        $reticle.style.borderColor = loaded ? 'rgba(242,234,214,.85)' : 'rgba(255,150,90,.7)';
        $aimside.textContent = (side === 'port' ? '◀ 좌현' : '우현 ▶') + ' · 우클릭=조준';
        $aimside.style.color = loaded ? '#f2ead6' : '#ffae6a';
      } else if ($reticle.style.display !== 'none') {
        $reticle.style.display = $aimside.style.display = 'none';
      }
    }
  });

  // ── 외부 API/검증·튜닝 훅 ──
  const api = {
    playerShip, enemyShip, enemies, ships, broadside, playerFire, autoCrewFire, respawnEnemy,
    forceSink: which => {   // 검증/디버그: 'player' / 'all' / 인덱스(번호) / 기본=대표 적
      if (which === 'player') sink(playerShip);
      else if (which === 'all') enemies.forEach(E => sink(E));
      else if (typeof which === 'number') { if (enemies[which]) sink(enemies[which]); }
      else sink(enemyShip);
    },
    toggleRespawn,                                                            // G키와 동일: 적 리젠 ON/OFF
    setRespawn: v => toggleRespawn(v),
    get respawn() { return DO_RESPAWN; },
    setEnemyHeadOff: deg => { enemyShip.headOff = deg * Math.PI / 180; },   // 시각 뱃머리 라이브 튜닝(도)
    state: () => ({
      pHp: playerShip.hp, eHp: enemyShip.hp,
      pSunk: playerShip._sunk, eSunk: enemyShip._sunk, kills: enemyKills,
      dist: Math.hypot(enemyShip.x - playerShip.x, enemyShip.z - playerShip.z),
    }),
    showBattleBanner,   // 디버그: __naval.showBattleBanner('이름')
    dispose() { api._disposed = true; removeEventListener('keydown', _onKey); removeEventListener('mousedown', _onMouse); hud.remove(); banner.remove();
      try { ctx.scene.remove(_band); _band.geometry?.dispose?.(); _bandMat.dispose(); } catch (e) {}   // ⚔️ 밴드 씬 제거·지오/재질 dispose(누수 방지)
      try { if (_battleOn) { _battleOn = false; ctx.sound?.bgm?.set(null); } } catch (e) {} },   // ★P3/P12: 루프 정지 + 전투 중 dispose면 BGM auto 복귀(force 해제)
  };
  ctx.navalcombat = api;
  window.__navalTune = api.setEnemyHeadOff;   // 콘솔서 __navalTune(180) 등으로 뱃머리 보정 조정
  console.log('[navalcombat] 해적선 전투 — player(무적) vs enemy(리스폰). HP', MAX_HP, 'enemyHeadOff', (enemyShip.headOff * 180 / Math.PI).toFixed(0) + '°');
  return api;
}

// [근거]
// 확정:
//  - queen 시각 뱃머리 = forward 반대(π) — top-down 스크린샷(_shots/naval_topdown.png) 직접 확인 + _WIP_배작업.md "queen forward 미해결". (출처: 본 검증)
//  - ship.js 축 deckW=길이·deckL=폭 / 다중배 ctx.ships / sideToward·forward·curMatrix. (출처: modules/ship.js)
//  - cannon.fire/projectiles/explode, destruct.makeBreakable/_debugHit(voronoi+Rapier). (출처: modules/cannon.js, destruct.js)
// 제안:
//  - HP120·1발7·5문·쿨2.6s·사거리120·교전52·AI속도6.5·리스폰3s/145m = MVP 밸런스 제안값(실플레이 조정).
//  - 내 배 무적·적 리스폰 = 사령관 테스트 요청(opts.playerInvincible/respawn로 끌 수 있음).
//  - 격침 연출 = destruct 3덩어리 voronoi 파편 + 폭연 + 원본 숨김.
// 수정(2026-06-29 밤 2차 — 사령관 포그라운드 미해결 4건):
//  - 🔊 선체피격/격침음: sfxOne('crash')=crash.ogg가 404(dev서버 curl 확인) → sfxPath('/tomob-deploy/w2.mp3')로 교체. canon.mp3는 200(발사음 정상).
//  - 🎯 머즐 플래시: cannon.muzzleFlash(섬광 스프라이트+점광원+연기) broadside 각 포구서 호출(현측 바깥 방향).
//  - 💥 피격 가시성: cannon.explode에 점광원+불꽃 크기 강화.
//  - 🌊 격침 파편 부력: destruct makeBreakable({buoy:true}) → 물리 바닥 없는 바다서 가라앉던 파편을 수면(WL)에 부유시켜 잔해로 남김.
// 수정(2026-07-12 — 사령관 확정 "공격 = 바로 전투" Phase A):
//  - 발사 본체를 모듈 함수 fireBroadside(ctx,sh,side,opts)로 추출 — 조우 인스턴스 broadside와 동일 수치·VFX(동작 불변).
//  - initFreeFire(ctx) 신설: 좌클릭 = 조우 없이도 상시 broadside(갑판/조타 중, 내 배). seaevents가 게임 시작 시 1회 호출.
//    이중발사 방지 = 조우 활성+boarded면 조우 playerFire에 양보 / 쿨다운 sh._fireCd 공유(조우 활성 중 감쇠는 조우 루프 담당).
// 미정:
//  - 침몰 시 잔해 회전 흔들림·물 묻은 음영 등 디테일은 추후.
