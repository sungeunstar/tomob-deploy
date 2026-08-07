// crew.js — 1인 크루 해전 (해전비전 §B/§C) + 갑판 생활 AI (사령관 컨펌 2026-07-05).
//   ★SoT식 위치 기반 스테이션: 갑판을 걸어다니다 조타륜/대포 앞에 가서 [Z]로 진입.
//     - 대포 앞 [Z] → 나 1인칭 포 조준 · 크루가 조타(자동 항해)
//     - 조타륜 앞 [Z] → 나 조타 · 크루가 대포(자동 포격)
//     내가 안 잡은 스테이션을 크루가 맡는다. [Z] 다시 = 갑판 보행 복귀.
//   ★갑판 생활(잡일) FSM — 역할 없을 땐 로컬 웨이포인트(뱃머리 망보기·돛대 정비·선미 휴식)를 걸어서 순회.
//     레이캐스트 없음: 전부 배 로컬 고정점 + 배 mesh 자식 부착(파도 흔들림 자동 추종) — "갑판 못 잡는" 실패 모드 원천 제거.
//   ★[E] 역할 지시 — 크루 곁에서 [E]: 자유행동 → 조타 → 포격 순환. 지시 = 고정 배정(내가 스테이션 안 잡아도 수행).
//     조타 지시 + 나는 갑판 보행 = 크루가 무인 조타(순항 유지·전투 시 원선회). ship.js 물리는 boarded 무관하게
//     bs.rudder/furl 소비(자동항해 선례) — 단 bs.autopilot(항구 호출)·anchored(닻)·플레이어 하선 시 양보.
//   ★actor-agnostic: 점유자를 문자열('player'|'crew')로 관리 → 멀티(MP) 대비.
//   재활용: ship.js(bs.boarded/rudder/furl/forward/sideToward/helmLocal/cannonSlots/mesh) · navalcombat.js(broadside/autoCrewFire/enemies)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { toast as ukToast } from './uikit.js';
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT — 육상 지시(따라와/공격해/대기해) 수치

// ★크루 외형 = 사령관이 고른 추종자(?follower=) 모델. opening.js/game.html FOLLOWER_MODELS와 1:1 동기화.
//   ★KayKit 클래스 6종 한정(사령관 지시 2026-07-05) — 전부 자체 애니 0 → Rig_Medium 공용 클립 리타깃(아래).
//   구 id(keeper 등 비-KayKit 저장분)는 rogue 폴백.
const KAY_DIR = '/KayKit_Adventurers_2.0_FREE/Characters/gltf/';
const FOLLOWER_MODELS = {
  rogue:        KAY_DIR+'Rogue.glb',
  knight:       KAY_DIR+'Knight.glb',
  barbarian:    KAY_DIR+'Barbarian.glb',
  mage:         KAY_DIR+'Mage.glb',
  ranger:       KAY_DIR+'Ranger.glb',
  rogue_hooded: KAY_DIR+'Rogue_Hooded.glb',
};
// Rig_Medium 공용 애니 세트(player.js와 동일 리그) — 잡일 FSM용 idle/walk/run + 선택 클립(sit/interact/wave).
const RIG_DIR = '/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/';
// ★2026-07-13(사령관 "추종자 공격할땐 무기 꺼내서 공격해야지") — CombatMelee 세트 추가.
//   player.js가 이미 이 파일에서 Melee_1H_Attack_Chop 등 실제 스윙 클립을 검증된 방식으로 씀(동일 리그) — 그대로 재사용.
const RIG_SETS = ['Rig_Medium_General.glb', 'Rig_Medium_MovementBasic.glb', 'Rig_Medium_Simulation.glb', 'Rig_Medium_CombatMelee.glb'];

const STATION_R    = 4.5;         // 스테이션 상호작용 반경(갑판 로컬 xz, m)
const ORDER_R      = 2.8;         // [E] 크루 지시 반경(월드, m)
const STANDOFF_MIN = 35, STANDOFF_MAX = 140, STANDOFF_DEF = 75;   // ⚔️ 크루 자동 교전거리(W/S로 조절)
const CREW_TURN    = 0.7;         // ⚔️ 크루 조타 민첩도 — ↓일수록 서툴게(사령관 "AI가 너무 잘 움직이면 안됨"). rudder 게인.
const CREW_REACT   = 1.4;         // 크루 조타 반응 속도(/s) — 목표 rudder를 천천히 추종(즉각 X = 서툰 느낌)
const WALK_SPD     = 1.5;         // 갑판 잡일 보행 속도(로컬 m/s)
const RUN_SPD      = 3.2;         // 전투/역할 이동 속도(로컬 m/s)
const ARRIVE_R     = 0.5;         // 웨이포인트/스테이션 도착 반경(로컬 m)

export function initCrew(ctx){
  // ── 크루 로스터(축4: 다인원화) — 논리 목록만. 현재 활성 조작은 여전히 "1명" 개념(스테이션/[E] 지시). ──
  //   roster[0] = 게임 시작 시 ?follower= 로 고른 첫 크루원(외형·동작은 기존 그대로). 이후 recruit()로 최대 4명.
  //   원소: { tribeId, joinedAt }. 중복 tribeId 방지는 recruit()에서 처리. 향후 개별 지시 UI 확장 여지로 배열만 노출.
  const MAX_CREW = 6;   // 축5 정합: 세력선언 '추종자 5명 이상' 조건(향후방향 §13.1) 충족 여지 + 약간의 여유.
  const _followerId = (typeof location !== 'undefined'
    ? (new URLSearchParams(location.search).get('follower') || '').toLowerCase() : '') || 'rogue';
  const roster = [{ tribeId: _followerId, joinedAt: 0 }];
  function recruit(tribeId){
    if(!tribeId) return { ok:false, reason:'invalid' };
    if(roster.some(r => r.tribeId === tribeId)) return { ok:false, reason:'dup' };
    if(roster.length >= MAX_CREW) return { ok:false, reason:'full' };
    roster.push({ tribeId, joinedAt: roster.length });
    console.log('[crew] 추종자 합류 —', tribeId, '· 로스터', roster.length + '/' + MAX_CREW);
    return { ok:true };
  }

  // ── 스테이션 점유 상태 (crew = 단일 소유자. boarded도 crew가 세팅) ──
  let _playerStation = null;   // null(갑판 보행) | 'helm' | 'cannon'
  let _activeCannon  = -1;     // 플레이어가 잡은 대포 슬롯 인덱스
  let _assign        = null;   // ★[E] 역할 지시(고정 배정): null(자유행동) | 'helm' | 'cannon'

  const boarded       = () => !!(ctx.ship && ctx.ship.boarded);
  const playerStation = () => boarded() ? _playerStation : null;
  const isPlayerAt    = st => boarded() && _playerStation === st;

  // 크루의 유효 역할 — 우선순위: [E] 지시(플레이어 점유 시 반대쪽 양보) > 플레이어 승선 보완 > 전투 자동 > 자유행동(null).
  function _combatActive(){ const nc = ctx.navalcombat;
    return !!(nc && nc.enemies && nc.enemies.some(e => !e._sunk)); }
  function crewRole(){
    if(!ctx.ship) return null;
    let a = _assign;
    if(a && playerStation() === a) a = (a === 'helm' ? 'cannon' : 'helm');   // 지시 스테이션을 내가 잡음 → 반대쪽 양보
    if(a) return a;
    if(boarded()) return _playerStation === 'helm' ? 'cannon' : 'helm';     // 승선 보완(기존 동작)
    if(_combatActive()) return 'helm';                                      // 전투 발발 + 아무도 조종 안 함 → 크루가 키부터
    return null;                                                            // 자유행동(잡일)
  }
  // 스테이션 담당자 조회 — 'player' | 'crew' | null. (승선 여부와 무관 — [E] 지시 크루는 무인 상태서도 담당)
  const who = st => {
    if(!ctx.ship) return null;
    if(playerStation() === st) return 'player';
    if(crewRole() === st && _crewManned) return 'crew';   // 크루는 '도착해서 잡았을 때'만 담당(걸어가는 중엔 null)
    return null;
  };

  function _toast(st){ try{ ukToast(
    st==='helm' ? '⚓ 조타 — WASD/QE 항해 · 좌클릭 = 보는 현측 일제사격 ([Z] 나가기)' : '💣 대포 — 좌클릭 단발 정밀, 크루가 조타 ([Z] 나가기)',
    { accent: st==='helm' ? 'cyan' : 'red', ms: 1900 }); }catch(_){}}

  // 갑판 로컬좌표 기준 가장 가까운 스테이션(반경 내) 판정. worldPos = 플레이어 월드 위치.
  const _inv = new THREE.Matrix4(), _lpv = new THREE.Vector3();
  function nearestStation(ship, worldPos){
    if(!ship || !ship.curMatrix) return null;
    _inv.copy(ship.curMatrix).invert();
    _lpv.copy(worldPos).applyMatrix4(_inv);
    let best = null, bd = STATION_R;
    if(ship.helmLocal){ const d = Math.hypot(_lpv.x - ship.helmLocal.x, _lpv.z - ship.helmLocal.z); if(d < bd){ bd = d; best = { station:'helm', idx:-1 }; } }
    // ★2026-07-12(사령관): 대포 스테이션 제거 — 플레이어는 조타([Z])만. 조타 중 우클릭 조준+좌클릭으로 직접 사격(navalcombat playerFire).
    //   크루 자동 포격(autoCrewFire)은 그대로 유지. 대포 슬롯 진입 루프 삭제.
    return best;
  }

  // 배 로컬 yaw(face) → 월드 yaw. curMatrix 회전만 추출(스케일1·pos 무시).
  const _yq=new THREE.Quaternion(), _yv=new THREE.Vector3(), _ys=new THREE.Vector3(), _ye=new THREE.Euler();
  function _shipWorldYaw(ship){ ship.curMatrix.decompose(_yv,_yq,_ys); _ye.setFromQuaternion(_yq,'YXZ'); return _ye.y; }
  function enter(station, idx){
    _playerStation = station; _activeCannon = (station === 'cannon') ? idx : -1;
    if(ctx.ship){
      ctx.ship.boarded = true;   // 스테이션 점유 = 배 조종 세션
      // (버그①) 조타를 잡는 순간 옛 "호출" autopilot 목표를 폐기 — 안 지우면 boarded=false로 돌아갈 때(조타 해제)
      //   되살아나 옛 호출 지점으로 자동항해 재개(사령관 2026-07-09 실측). harbor.js:186이 유일한 세팅 지점.
      if(station === 'helm') ctx.ship.autopilot = null;
      // ★2026-07-10(사령관 "조타/대포 서있는 방향이 이상함, 옆으로 서있음") — 예전엔 진입해도 플레이어 아바타 방향을
      //   전혀 안 돌려서 걸어온 각도 그대로 서 있었음. 스테이션 정면을 보게 스냅.
      try{
        const ship=ctx.ship; let localFace=null;
        if(station==='helm'){ const o=(typeof window!=='undefined'&&window.__crewOff)||{}; localFace=(o.yaw!=null?o.yaw:90)*Math.PI/180; }
        else if(station==='cannon'){ const s=(ship.cannonSlots||[])[idx]; if(s) localFace=(s.z<(ship.deckCz||0)?Math.PI/2:-Math.PI/2); }
        if(localFace!=null && ctx.player && ctx.player.setYaw) ctx.player.setYaw(_shipWorldYaw(ship)+localFace);
      }catch(_){}
    }
    _toast(station);
  }
  function exit(){
    _playerStation = null; _activeCannon = -1;
    if(ctx.ship) ctx.ship.boarded = false;
  }
  // 갑판 보행 중 [Z]: 근처 스테이션 진입. 진입한 스테이션 문자열 반환(없으면 null).
  function tryInteract(worldPos){
    if(!ctx.ship) return null;
    const near = nearestStation(ctx.ship, worldPos);
    if(!near) return null;
    enter(near.station, near.idx);
    return near.station;
  }
  function activeCannonLocal(){
    const s = (ctx.ship && ctx.ship.cannonSlots) ? ctx.ship.cannonSlots[_activeCannon] : null;
    return s ? new THREE.Vector3(s.x, s.y, s.z) : null;
  }
  function activeCannonIsLeft(){   // 잡은 대포가 좌현(true)/우현(false) — player.js 조준 기준(현측 방향)
    const s = (ctx.ship && ctx.ship.cannonSlots) ? ctx.ship.cannonSlots[_activeCannon] : null;
    return s ? !!s.isLeft : false;
  }

  // ══════════ 크루 캐릭터 피규어 + Rig_Medium 애니 세트 ══════════
  let _rig = null, _fig = null, _mixer = null, _figMinY = 0, _attachedShip = null;
  let _acts = {};          // { idle, walk, run, sit?, interact?, wave? } — AnimationAction
  let _curAct = null;      // 현재 재생 액션 키
  (async () => {
    try{
      const L = new GLTFLoader();
      const load = u => new Promise((res, rej) => L.load(encodeURI(u), res, undefined, rej));
      const _fid = (typeof location!=='undefined' ? (new URLSearchParams(location.search).get('follower')||'') : '').toLowerCase();
      const url = FOLLOWER_MODELS[_fid] || FOLLOWER_MODELS.rogue;   // 구 id(비-KayKit 저장분) = rogue 폴백
      const charG = await load(url);
      // Rig_Medium 공용 클립 수집(KayKit 클래스 = 자체 애니 0) — idle/walk/run 필수 + sit/interact/wave 선택.
      const clips = [];
      for(const set of RIG_SETS){
        try{ const ag = await load(RIG_DIR+set); for(const c of (ag.animations||[])) clips.push(c); }
        catch(e){ console.warn('[crew] 애니 세트 로드 실패', set, e && e.message); }
      }
      const pick = (...res) => { for(const re of res){ const c = clips.find(a => re.test(a.name)); if(c) return c; } return null; };
      _rig = { scene: charG.scene, clips:{
        idle:     pick(/^Idle_A$/i, /idle/i),
        walk:     pick(/^Walking_A$/i, /walk/i),
        run:      pick(/^Running_A$/i, /run|sprint/i),
        sit:      pick(/^Sit.*(Idle|Loop)/i, /sit/i),           // 선미 휴식(없으면 idle 폴백)
        interact: pick(/interact|use_item|pick.?up|work/i),     // 돛대 정비(없으면 idle 폴백)
        climb:    pick(/climb/i),                               // 사다리 등반(없으면 walk 폴백)
        // ★2026-07-13: 육상 전투(공격해 지시) 전용 — player.js와 동일 클립명(Melee_1H_Attack_Chop), 없으면 맨손 펀치.
        attack:   pick(/^Melee_1H_Attack_Chop$/i, /^Melee_Unarmed_Attack_Punch_A$/i, /melee.*attack/i),
        wave:     pick(/^Waving/i),
      } };
      _makeFigure();
      console.log('[crew] 크루 로드 —', _fid||'rogue(폴백)',
        '· 클립 idle:'+!!_rig.clips.idle, 'walk:'+!!_rig.clips.walk, 'run:'+!!_rig.clips.run,
        'sit:'+!!_rig.clips.sit, 'interact:'+!!_rig.clips.interact, 'attack:'+!!_rig.clips.attack);
    }catch(e){ console.warn('[crew] 크루 로드 실패', e && e.message); }
  })();

  function _makeFigure(){
    if(!_rig) return;
    _fig = cloneSkeleton(_rig.scene);
    _fig.traverse(o => { if(o.isMesh || o.isSkinnedMesh){ o.frustumCulled = false; o.castShadow = true; } });
    const sz = new THREE.Vector3(); new THREE.Box3().setFromObject(_fig).getSize(sz);
    _fig.scale.setScalar(1.35 / (sz.y || 1));
    _figMinY = new THREE.Box3().setFromObject(_fig).min.y;
    _mixer = new THREE.AnimationMixer(_fig);
    _acts = {};
    for(const k in _rig.clips){ const c = _rig.clips[k]; if(c){ _acts[k] = _mixer.clipAction(c); _acts[k].setLoop(THREE.LoopRepeat, Infinity); } }
    _play('idle', 0);
  }
  // 애니 크로스페이드 — 없는 클립은 idle 폴백.
  function _play(name, fade){
    const nk = _acts[name] ? name : 'idle';
    if(_curAct === nk || !_acts[nk]) return;
    const prev = _acts[_curAct];
    const nx = _acts[nk];
    nx.enabled = true; nx.reset(); nx.setEffectiveWeight(1); nx.play();
    if(prev && fade !== 0) nx.crossFadeFrom(prev, fade == null ? 0.25 : fade, false);
    else if(prev) prev.stop();
    _curAct = nk;
  }

  // ══════════ 갑판 로컬 웨이포인트(잡일 지점) — 레이캐스트 없음, 배 치수 비례 + 배별 오버라이드 ══════════
  //   ship.crewWaypoints = [{x,z,act,dur:[min,max],face?}] 지정 시 그대로 사용(배별 손 튜닝 여지).
  //   act: 'watch'(망보기/idle) · 'tend'(정비/interact) · 'rest'(휴식/sit). face=도착 후 바라볼 로컬 yaw(rad).
  //   ★층 혼합 금지(2026-07-05 사령관 "위로 올라갔다 내려갔다" 버그): 다층 갑판 배(queen 5.5/7.3 등)에서
  //     deckLocalY 단일값·helm 층 혼입이 공중 보행을 만들었음 → 기준층 = 대포 슬롯 y(사령관 실측 검증된 로컬 좌표),
  //     x 범위도 슬롯 실측 스팬(±여유)으로 — 같은 층 위에서만 순회. 층이 다른 조타 옆 지점은 제외.
  function _deckRefY(ship){
    const slots = ship.cannonSlots || [];
    if(slots.length) return slots[0].y;
    if(ship.helmLocal) return ship.helmLocal.y;
    return ship.deckLocalY != null ? ship.deckLocalY : 0;
  }
  function _waypoints(ship){
    if(ship._crewWps) return ship._crewWps;
    if(Array.isArray(ship.crewWaypoints) && ship.crewWaypoints.length){ ship._crewWps = ship.crewWaypoints; return ship._crewWps; }
    const dw = ship.deckW || 30, cx0 = ship.deckCx || 0, cz = ship.deckCz || 0, dy = _deckRefY(ship);
    // x 스팬: 대포 슬롯 실측 범위(검증된 갑판 위 좌표) ±여유. 슬롯 없으면 deckW 비례 폴백.
    let xMin = cx0 - dw*0.24, xMax = cx0 + dw*0.30;
    const slots = ship.cannonSlots || [];
    if(slots.length){ let mn=Infinity, mx=-Infinity; for(const s of slots){ mn=Math.min(mn,s.x); mx=Math.max(mx,s.x); }
      xMin = mn - 2.0; xMax = mx + 4.0; }
    const xMid = (xMin+xMax)/2;
    const wps = [
      { x: xMax, z: cz,       y: dy, act:'watch', dur:[5,9],  face: Math.PI/2 },   // 뱃머리쪽 망보기(전방 +x)
      { x: xMid, z: cz - 1.8, y: dy, act:'tend',  dur:[4,7],  face: -Math.PI/2 },  // 중갑판 좌측 정비(안쪽 향함)
      { x: xMid, z: cz + 1.8, y: dy, act:'tend',  dur:[4,7],  face: Math.PI/2 },
      { x: xMin, z: cz,       y: dy, act:'rest',  dur:[6,10], face: Math.PI/2 },   // 후방 휴식(전방 바라봄)
    ];
    // 조타 옆 대기 지점은 '같은 층'일 때만(층 다르면 공중 보행 — 계단 체인은 후속)
    if(ship.helmLocal && Math.abs(ship.helmLocal.y - dy) < 0.8)
      wps.push({ x: ship.helmLocal.x - 1.4, z: ship.helmLocal.z + 1.2, y: ship.helmLocal.y, act:'watch', dur:[4,7], face: Math.PI/2 });
    ship._crewWps = wps;
    console.log('[crew] 잡일 웨이포인트', wps.length + '점 — x ' + xMin.toFixed(1) + '~' + xMax.toFixed(1) + ' · y ' + dy.toFixed(2) + ' (기준=' + (slots.length?'대포슬롯':'helm/deck') + ')');
    return wps;
  }
  const _ACT_ANIM = { watch:'idle', tend:'interact', rest:'sit' };   // 클립 없으면 _play가 idle 폴백

  // ══════════ 크루 행동 상태 (잡일 FSM + 역할 이동/수행) ══════════
  //   mode: 'walk'(목적지로 보행) | 'do'(잡일 수행) | 'man'(스테이션 담당) — 목적지는 전부 배 로컬 고정점.
  let _cw = { mode:'do', wp:null, t:0, target:null, run:false, path:[], pathKey:'' };
  let _crewManned = false;    // 역할 스테이션 도착·담당 중(steer/fire AI 활성 조건)
  // 🪜 층 차이 이동 경로 — bs.ladders(자동탐지+수동) 경유: [사다리 밑 보행 → 수직 등반 → 목적지].
  //   사다리 없으면 [목적지] 단독(경사 보행 폴백). 사령관 "2층 조타대는 계단 타고 올라가야지" (2026-07-05).
  function _planPath(ship, dest){
    const cy = _fig.position.y + _figMinY;
    const dy = dest.y != null ? dest.y : cy;
    if(Math.abs(dy - cy) <= 0.9 || !(ship.ladders && ship.ladders.length)) return [dest];
    const lo = Math.min(cy, dy), hi = Math.max(cy, dy);
    let best = null, bd = 1e9;
    for(const L of ship.ladders){
      if((L.yBot != null && L.yBot > lo + 1.0) || (L.yTop != null && L.yTop < hi - 1.0)) continue;   // 두 층을 못 잇는 사다리 제외
      const d = Math.hypot(L.x - _fig.position.x, L.z - _fig.position.z);
      if(d < bd){ bd = d; best = L; }
    }
    if(!best) return [dest];
    return [ { x:best.x, z:best.z, y:cy },               // 사다리 밑까지 보행
             { x:best.x, z:best.z, y:dy, climb:true },   // 🪜 수직 등반
             dest ];
  }
  const _turnLocal = (fig, ty, dt, rate) => { let d = ty - fig.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); fig.rotation.y += d * Math.min(1, dt*(rate||8)); };
  // 헬름 '바닥' 층 — helmLocal은 조타륜 휠 메시 중심(휠 높이)이라 그대로 서면 공중부양(사령관 "점프한 상태로 키 잡음").
  //   deckLevels(다층) 중 helmLocal.y 이하 최고층 = 조타대가 놓인 갑판 바닥. 없으면 deckLocalY(주갑판).
  function _helmFloorY(ship){
    const hy = ship.helmLocal ? ship.helmLocal.y : 0;
    const est = hy - 1.15;   // 휠 메시 중심 ≈ 자기 갑판 +1.15m(타륜 절반) — 추정 바닥
    const lvs = (Array.isArray(ship.deckLevels) && ship.deckLevels.length) ? ship.deckLevels : null;
    if(lvs){ let best = null; for(const v of lvs){ if(v <= hy + 0.15 && (best == null || v > best)) best = v; }
      if(best != null && hy - best < 2.4) return best; }   // 휠 바로 아래 층만 채택(멀면 데이터 불신)
    // ★deckLevels 없는 배: deckLocalY=최저 갑판이라 그리로 스냅하면 선미루 조타대 아래 '파묻힘'(사령관 2026-07-05)
    //   → 휠 높이 기반 추정과 최저 갑판 중 높은 쪽.
    const dly = (ship.deckLocalY != null ? ship.deckLocalY : est);
    return Math.max(dly, est);
  }
  function _stationPoint(ship, st){
    if(st === 'helm' && ship.helmLocal){
      // ★조타 스탠스 — 사령관 실측(2026-07-04): 왼쪽 90° + 선미쪽 1.0. window.__crewOff={back,side,yaw°,up}로 라이브 튜닝(D단계).
      const o = (typeof window !== 'undefined' && window.__crewOff) || {};
      const back = (o.back != null ? o.back : 1.0), side = (o.side != null ? o.side : 0);
      return { x: ship.helmLocal.x - back, z: ship.helmLocal.z + side, y: _helmFloorY(ship) + (o.up != null ? o.up : 0),
               face: ((o.yaw != null ? o.yaw : 90) * Math.PI/180) };
    }
    const slots = ship.cannonSlots || [];
    if(st === 'cannon' && slots.length){ const s = slots[0];
      return { x: s.x, z: s.z, y: s.y, face: (s.z < (ship.deckCz||0) ? Math.PI/2 : -Math.PI/2) }; }
    const dw = ship.deckW || 30, dly = (ship.deckLocalY != null ? ship.deckLocalY : 0);
    return { x: dw*0.18, z: ship.deckCz || 0, y: dly, face: Math.PI/2 };
  }
  // ══════════ 육상 지시 — 배 밖(디스임바크)일 때 필드에서 플레이어를 따르는 FSM ══════════
  //   [R] 라디얼(배 밖 컨텍스트)에서 지시. 기본값=follow(따라와). 크루 = 세계좌표(ctx.scene) 부착으로 전환(갑판 로컬 → 월드).
  let _landMode = 'follow';   // 'follow' | 'attack' | 'wait'
  let _landAtkT = 0;
  let _landChasing = false;   // 따라와 히스테리시스: Far 넘으면 true(추격), Near까지 좁히면 false(대기·감시)
  let _watchT = 0, _watchYaw = 0;   // 대기 중 주변 감시(가끔 두리번)
  const _LAND_ORDER_LINE = { follow:'예! 따라가겠습니다.', attack:'적을 쓸어버리겠습니다!', wait:'여기서 대기하겠습니다.' };
  const _LAND_ORDER_NAME = { follow:'따라와', attack:'공격해', wait:'대기해' };
  function _setLandOrder(mode){
    _landMode = mode;
    try{ ukToast('“'+_LAND_ORDER_LINE[mode]+'”', { accent: mode==='attack' ? 'red' : 'cyan', ms: 2200, speaker: _LAND_ORDER_NAME[mode] }); }catch(_){}   // 대사체: 지시명(화자줄) + 대사(자막)
    try{ ctx.events && ctx.events.emit && ctx.events.emit('crewLandOrder', mode); }catch(_){}   // ★2026-07-12: 튜토(questline)가 "따라오기" 지시 완료를 감지(D 단계).
  }
  function _tickLand(dt){
    if(_fig.parent !== ctx.scene){   // 배(또는 미부착)에서 막 전환 — 플레이어 옆에 스냅(갱웨이 연출 없음, v1)
      if(_fig.parent) _fig.parent.remove(_fig);
      ctx.scene.add(_fig);
      if(ctx.player){ const pp = ctx.player.pos;
        const gy = ctx.terrain?.groundAt(pp.x - 2, pp.z - 2, 200) ?? (pp.y || 0);
        _fig.position.set(pp.x - 2, Math.max(gy, (ctx.water?.level ?? 0) + 0.2), pp.z - 2);
      }
      _crewManned = false;
    }
    _crewManned = false;
    if(!ctx.player) return;
    const pp = ctx.player.pos;
    let dest = null, atkTarget = null;
    if(_landMode === 'attack'){
      let best = null, bd = BAL.crew.landAtkRange;
      for(const mn of (ctx.monsters || [])){
        if(mn.dead || !mn.grp) continue;
        const d = Math.hypot(mn.grp.position.x - _fig.position.x, mn.grp.position.z - _fig.position.z);
        if(d < bd){ bd = d; best = mn; }
      }
      if(best){ if(bd > BAL.crew.landMeleeR) dest = best.grp.position; else atkTarget = best; }
      else dest = { x: pp.x, z: pp.z };   // 주변 적 없음 → 따라와로 폴백
    } else if(_landMode === 'follow'){
      const d = Math.hypot(pp.x - _fig.position.x, pp.z - _fig.position.z);
      // 히스테리시스: 멀어지면 추격 시작, Near까지 좁히면 멈춤(바짝 안 붙음). 멈춘 뒤엔 그 자리서 자유행동·주변감시.
      if(_landChasing){ if(d <= BAL.crew.landFollowNear) _landChasing = false; }
      else { if(d > BAL.crew.landFollowFar) _landChasing = true; }
      if(_landChasing){
        // 플레이어 정위치가 아니라 Near 거리 지점까지만 접근(겹침 방지)
        const ux = (pp.x - _fig.position.x)/d, uz = (pp.z - _fig.position.z)/d;
        dest = { x: pp.x - ux*BAL.crew.landFollowNear, z: pp.z - uz*BAL.crew.landFollowNear };
      }
    }
    // 'wait'/대기 = dest/atkTarget 둘 다 null → 제자리서 주변 감시(두리번)
    if(atkTarget){
      _turnLocal(_fig, Math.atan2(atkTarget.grp.position.x - _fig.position.x, atkTarget.grp.position.z - _fig.position.z), dt, 9);
      _landAtkT -= dt;
      if(_landAtkT <= 0){
        _landAtkT = BAL.crew.landAtkInterval;
        const hp = atkTarget.grp.position.clone(); hp.y += 1.1;
        ctx.combat?._damageMonster?.(atkTarget, BAL.crew.landAtkDmg, hp, false, {feel:false});   // ★A5(2026-07-15): 크루 공격 — 전역 히트스톱/크리사운드는 플레이어만(스파크·데미지숫자는 유지)
        _play('attack', 0.1);   // ★2026-07-13: interact(정비 동작) → 실제 무기 스윙 클립으로 교체
      } else _play('idle');
    } else if(dest){
      const dx = dest.x - _fig.position.x, dz = dest.z - _fig.position.z, d = Math.hypot(dx, dz) || 1e-6;
      const mv = Math.min(d, BAL.crew.landRunSpd*dt);
      _fig.position.x += dx/d*mv; _fig.position.z += dz/d*mv;
      const gy = ctx.terrain?.groundAt(_fig.position.x, _fig.position.z, 200);
      if(gy != null) _fig.position.y += (Math.max(gy, (ctx.water?.level ?? 0) + 0.2) - _fig.position.y) * Math.min(1, dt*6);
      _turnLocal(_fig, Math.atan2(dx, dz), dt, 9);   // ⛔ 회전식 건드리지 말 것(2026-07-12 진단: atan2(dx,dz) 정면전진 확인됨)
      _play('run');
      // ★BUG-011(2026-07-13): Running_A는 제자리(in-place) 클립 — landRunSpd 이동과 재생속도가 안 맞으면
      //   발 미끄러짐(문워크 착시)이 "뒤로 걷는" 것처럼 보일 수 있다는 가설. 회전은 그대로 두고 재생속도만 보정.
      //   기본 BAL.crew.landGaitScale(제안값, 라이브 미확인) · window.__crewGait로 실플레이 중 조정.
      if(_acts.run) _acts.run.timeScale = window.__crewGait ?? BAL.crew.landGaitScale ?? 1;
    } else {
      // 🧭 대기/근접 = 자유행동·주변 감시(사령관 "ai처럼 주변 감시") — 가까운 몹 있으면 그쪽 경계, 없으면 가끔 두리번.
      _watchT -= dt;
      if(_watchT <= 0){
        _watchT = 2.2 + Math.random()*2.6;
        let look = null, bd = 24;
        for(const mn of (ctx.monsters || [])){ if(mn.dead || !mn.grp) continue;
          const d = Math.hypot(mn.grp.position.x - _fig.position.x, mn.grp.position.z - _fig.position.z);
          if(d < bd){ bd = d; look = mn.grp.position; } }
        if(look) _watchYaw = Math.atan2(look.x - _fig.position.x, look.z - _fig.position.z);
        else _watchYaw = Math.atan2(pp.x - _fig.position.x, pp.z - _fig.position.z) + (Math.random()-0.5)*2.4;   // 대체로 선장 쪽 ± 두리번
      }
      _turnLocal(_fig, _watchYaw, dt, BAL.crew.landWatchTurn * 6);
      _play('idle');
    }
  }

  function _tickFigure(dt){
    if(!_fig) return;
    const ship = ctx.ship;
    _fig.visible = true;
    if(!_onDeck()){ _tickLand(dt); return; }   // 배 밖 = 육상 FSM(따라와/공격해/대기해)
    if(_fig.parent !== ship.mesh){   // 육상(월드좌표)→배(로컬좌표) 전환 — 부모만 바꾸면 옛 월드좌표가 로컬로 오인식돼 배 밖으로 튕겨나감(사령관 2026-07-10 "배 탈 때 같이 안 따라들어옴").
      if(_fig.parent) _fig.parent.remove(_fig); ship.mesh.add(_fig); _attachedShip = ship;
      const sp = _stationPoint(ship, 'free'); _fig.position.set(sp.x, sp.y, sp.z);   // 갑판 기본 지점으로 즉시 스냅(탑승 = 같이 승선)
      _cw = { mode:'do', wp:null, t:0.5, target:null, run:false, path:[], pathKey:'' }; _crewManned = false; }
    const role = crewRole();
    // ── 목적지 결정 ──
    let dest = null, destFace = 0, run = false;
    if(role){ const sp = _stationPoint(ship, role); dest = sp; destFace = sp.face; run = _combatActive(); }   // 전투면 뛰어감
    else {
      _crewManned = false;
      if(_cw.mode === 'do'){
        _cw.t -= dt;
        if(_cw.t <= 0){ // 다음 잡일 선택(현 위치 제외 랜덤)
          const wps = _waypoints(ship);
          const cand = wps.filter(w => w !== _cw.wp);
          _cw.wp = cand[(Math.random()*cand.length)|0] || wps[0];
          _cw.mode = 'walk';
        }
      }
      if(_cw.mode === 'walk' && _cw.wp){ dest = _cw.wp; destFace = (_cw.wp.face != null ? _cw.wp.face : Math.PI/2); }
    }
    // ── 이동/도착 실행 (전부 배 로컬 공간) — 층 차이는 사다리 경유(_planPath), 없으면 경사 보행 폴백 ──
    if(dest){
      const dKey = dest.x.toFixed(1)+'_'+dest.z.toFixed(1)+'_'+(dest.y!=null?dest.y.toFixed(1):'');
      if(_cw.pathKey !== dKey){ _cw.pathKey = dKey; _cw.path = _planPath(ship, dest); }
      const node = _cw.path[0] || dest;
      const curY = _fig.position.y + _figMinY;
      if(node.climb){
        // 🪜 사다리 등반 — 수평은 사다리에 스냅, 수직 1.3m/s. climb 클립 없으면 walk 폴백.
        _crewManned = false;
        _fig.position.x += (node.x - _fig.position.x)*Math.min(1, dt*10);
        _fig.position.z += (node.z - _fig.position.z)*Math.min(1, dt*10);
        const dyy = node.y - curY;
        _fig.position.y += Math.sign(dyy)*Math.min(Math.abs(dyy), 1.3*dt);
        _play(_acts.climb ? 'climb' : 'walk');
        if(Math.abs(dyy) < 0.12) _cw.path.shift();
      } else {
        const dx = node.x - _fig.position.x, dz = node.z - _fig.position.z, d = Math.hypot(dx, dz);
        const isFinal = _cw.path.length <= 1;
        if(d > ARRIVE_R){
          _crewManned = false;
          const spd = run ? RUN_SPD : WALK_SPD, mv = Math.min(d, spd*dt);
          _fig.position.x += dx/d*mv; _fig.position.z += dz/d*mv;
          if(node.y != null){ const ty = node.y - _figMinY;   // 같은 층=유지 / 층차 폴백=경사 보행(부드럽게)
            _fig.position.y += (ty - _fig.position.y)*Math.min(1, dt*6); }
          _turnLocal(_fig, Math.atan2(dx, dz), dt, 9);
          _play(run ? 'run' : 'walk');
        } else if(!isFinal) _cw.path.shift();   // 경유 노드 도착 → 다음
        else {
          _fig.position.x = node.x; _fig.position.z = node.z;
          _fig.position.y = (node.y != null ? node.y : curY) - _figMinY;
          _turnLocal(_fig, destFace, dt, 7);
          if(role){ _crewManned = true; _play('idle'); }   // 스테이션 담당(포즈=idle, 조타/포격은 AI 로직이 수행)
          else if(_cw.mode === 'walk'){ // 잡일 도착 → 수행 시작
            _cw.mode = 'do'; const dur = _cw.wp && _cw.wp.dur ? _cw.wp.dur : [4,7];
            _cw.t = dur[0] + Math.random()*(dur[1]-dur[0]);
            _play(_ACT_ANIM[_cw.wp && _cw.wp.act] || 'idle');
          }
          else if(_cw.mode === 'do' && _cw.wp){ _play(_ACT_ANIM[_cw.wp.act] || 'idle'); }
        }
      }
    } else if(!role && _cw.mode === 'do' && !_cw.wp){ _play('idle'); }   // 웨이포인트 확정 전 대기
  }

  // ══════════ [E] 역할 지시 — 크루 곁에서 자유행동 → 조타 → 포격 순환 ══════════
  const _ORDER_SEQ  = [null, 'helm', 'cannon'];
  const _ORDER_LINE = { helm:'예! 키를 잡겠습니다.', cannon:'포격은 맡겨주십쇼!', free:'알겠습니다 — 하던 일 마저 하겠습니다.' };
  const _ORDER_NAME = { helm:'조타 담당', cannon:'포격 담당', free:'자유행동' };
  function _figWorld(v){ if(!_fig || !_fig.parent) return null; return _fig.getWorldPosition(v || new THREE.Vector3()); }
  const _fwv = new THREE.Vector3();
  function _nearCrew(){
    if(!_fig || !ctx.player || !ctx.ship) return false;
    if(ctx.player._onShip !== ctx.ship) return false;         // 같은 배 갑판 위에서만 지시
    if(boarded()) return false;                                // 스테이션 조종 중엔 지시 UI 안 띄움
    const w = _figWorld(_fwv); if(!w) return false;
    const pp = ctx.player.pos;
    return Math.hypot(pp.x - w.x, pp.z - w.z) < ORDER_R && Math.abs((pp.y||0) - w.y) < 3.5;
  }
  function assign(role){   // 외부(멀티/퀘스트)에서도 호출 가능한 공개 API
    _assign = (role === 'helm' || role === 'cannon') ? role : null;
    const key = _assign || 'free';
    try{ ukToast('“'+_ORDER_LINE[key]+'”', { accent: _assign ? (_assign==='helm'?'cyan':'red') : 'gold', ms: 2400, speaker: _ORDER_NAME[key] }); }catch(_){}   // 대사체: 지시명(화자줄) + 대사(자막)
    try{ ctx.sound?.play?.('ui_click'); }catch(_){}
  }
  addEventListener('keydown', e => {
    if(e.code !== 'KeyE' || e.repeat) return;
    if(ctx.input && ctx.input.blocks && ctx.input.blocks('KeyE')) return;   // 입력 모드 라우터 존중(UI/컷신 중 차단)
    if(!_nearCrew()) return;
    const i = _ORDER_SEQ.indexOf(_assign);
    assign(_ORDER_SEQ[(i+1) % _ORDER_SEQ.length]);
  });

  // ══════════ [R] 크루 지시 라디얼 — 근접 불필요(사령관 2026-07-10 "어디서나 열리는걸로") ══════════
  //   키 홀드=열림, 마우스로 항목 조준, 키 뗌=확정(ESC=취소). U→R로 변경(사령관 2026-07-10, U는 발견성 낮음).
  //   컨텍스트 3종: ①배 위·크루 조타담당 아닐 때=자유롭게해/조타로가/대포잡아 ②크루가 조타 담당 중=방향지시(선회·거리) ③배 밖(필드)=따라와/공격해/대기해.
  //   ★2026-07-10 디자인 재작업(사령관 레퍼런스=ref/라디얼메뉴ui.png) — 파이 웨지(부채꼴) + 선택 조각 금색 글로우 +
  //     중앙 원에 현재 선택 라벨. 예전 알약 라벨 원형배치 폐기.
  const RAD_CX=150, RAD_CY=150, RAD_R0=64, RAD_R1=140, RAD_GAP=0.05;   // 반경(px)·조각 사이 갭(rad) — 허브 확대(긴 한글 라벨 수용)
  function _wedgePath(a0, a1){
    const pt=(r,a)=>[RAD_CX+Math.cos(a)*r, RAD_CY+Math.sin(a)*r];
    const [ox0,oy0]=pt(RAD_R1,a0), [ox1,oy1]=pt(RAD_R1,a1), [ix1,iy1]=pt(RAD_R0,a1), [ix0,iy0]=pt(RAD_R0,a0);
    const large=(a1-a0)>Math.PI?1:0;
    return `M${ox0},${oy0} A${RAD_R1},${RAD_R1} 0 ${large} 1 ${ox1},${oy1} L${ix1},${iy1} A${RAD_R0},${RAD_R0} 0 ${large} 0 ${ix0},${iy0} Z`;
  }
  // ★2026-07-12(사령관): 라디얼 인라인 SVG 아이콘 전부 제거 — 각 조각에 텍스트 라벨만 표시. "이상한 표시" 대신 글자.
  const _radCss = document.createElement('style');
  _radCss.textContent =
    '#crRadial{position:fixed;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;z-index:22;display:none;pointer-events:none;'
      + "font-family:'Pretendard',system-ui,'Malgun Gothic',sans-serif;filter:drop-shadow(0 14px 34px rgba(0,0,0,.6))}"
    + '#crRadial svg{position:absolute;inset:0;overflow:visible}'
    + '#crRadial .ring{fill:none;stroke:rgba(201,168,90,.16)}'
    + '#crRadial .spoke{stroke:rgba(201,168,90,.12);stroke-width:1}'
    + '#crRadial .wedge{fill:rgba(15,20,28,.66);stroke:rgba(201,168,90,.28);stroke-width:1;transition:fill .1s}'
    + '#crRadial .wedge.sel{fill:url(#crRadGold);stroke:#ffe9b0;stroke-width:1.5;filter:drop-shadow(0 0 10px rgba(245,210,130,.6))}'
    + '#crRadial .hubring{fill:none;stroke:rgba(201,168,90,.5);stroke-width:1.5}'
    + "#crRadial .icn{position:absolute;transform:translate(-50%,-50%);color:#e7dcc0;pointer-events:none;transition:color .1s;filter:drop-shadow(0 1px 2px rgba(0,0,0,.85));"
      + "font:800 13.5px 'Pretendard',system-ui,'Malgun Gothic',sans-serif;white-space:nowrap;word-break:keep-all;text-align:center}"
    + '#crRadial .icn.sel{color:#2a1d06;filter:none}'
    + "#crRadial .badge{position:absolute;transform:translate(-50%,-50%);width:19px;height:19px;border-radius:5px;background:rgba(8,12,19,.9);border:1px solid rgba(201,168,90,.5);"
      + "display:flex;align-items:center;justify-content:center;color:#f0d9a8;font:800 11px 'Pretendard',system-ui;pointer-events:none;transition:.1s}"
    + '#crRadial .badge.sel{background:#2a1d06;border-color:#2a1d06;color:#f5e0ab}'
    + "#crRadial .ctr{position:absolute;left:50%;top:50%;width:"+(RAD_R0*2-8)+"px;height:"+(RAD_R0*2-8)+"px;margin:"+(-(RAD_R0-4))+"px 0 0 "+(-(RAD_R0-4))+"px;"
      + 'border-radius:50%;background:radial-gradient(circle,rgba(22,28,38,.94),rgba(9,13,19,.97));border:1px solid rgba(201,168,90,.5);'
      + "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;padding:6px;overflow:hidden;"
      + 'box-shadow:inset 0 0 16px rgba(0,0,0,.65),0 0 0 4px rgba(10,14,20,.5)}'
    + '#crRadial .ctrIcn{color:#f0d9a8;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}'
    + '#crRadial .ctrIcn svg{width:26px;height:26px;display:block}'
    + "#crRadial .ctrLbl{color:#f5e6bf;font:800 12px 'Pretendard',system-ui;letter-spacing:0;line-height:1.2;max-width:100px;white-space:normal;word-break:keep-all;text-shadow:0 1px 3px rgba(0,0,0,.8)}";
  document.head.appendChild(_radCss);
  const _radEl = document.createElement('div'); _radEl.id = 'crRadial';
  _radEl.innerHTML = `<svg viewBox="0 0 300 300"><defs><radialGradient id="crRadGold" cx="50%" cy="50%" r="72%">
    <stop offset="0%" stop-color="#f7e6b6"/><stop offset="60%" stop-color="#e0b866"/><stop offset="100%" stop-color="#a9842f"/></radialGradient></defs>
    <circle class="ring" cx="150" cy="150" r="146"/><circle class="ring" cx="150" cy="150" r="${RAD_R1+3}"/>
    <g class="spokes"></g><g class="wedges"></g>
    <circle class="hubring" cx="150" cy="150" r="${RAD_R0}"/></svg>
    <div class="ctr"><div class="ctrIcn"></div><div class="ctrLbl"></div></div>`;
  document.body.appendChild(_radEl);
  const _radWedges=_radEl.querySelector('.wedges'), _radSpokes=_radEl.querySelector('.spokes'),
        _radCtrIcn=_radEl.querySelector('.ctrIcn'), _radCtrLbl=_radEl.querySelector('.ctrLbl');

  let _radOpen = false, _radItems = [], _radSel = 0, _rax = 0, _ray = 0;
  function _onDeck(){ const ship = ctx.ship; return !!(ship && ship.mesh && ctx.player && ctx.player._onShip === ship); }
  function _buildRadialDom(items){
    _radWedges.innerHTML = ''; _radSpokes.innerHTML = '';
    [..._radEl.querySelectorAll('.icn,.badge')].forEach(e=>e.remove());
    const n = items.length, step=2*Math.PI/n, Rm=(RAD_R0+RAD_R1)/2, Rb=RAD_R1-14;
    items.forEach((it, i) => {
      const c = -Math.PI/2 + i*step, a0=c-step/2+RAD_GAP/2, a1=c+step/2-RAD_GAP/2;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', _wedgePath(a0,a1)); path.setAttribute('class','wedge');
      _radWedges.appendChild(path);
      // 조각 경계 장식 스포크(허브 → 외곽 링)
      const sa=c-step/2, sp=document.createElementNS('http://www.w3.org/2000/svg','line');
      sp.setAttribute('x1',RAD_CX+Math.cos(sa)*RAD_R0); sp.setAttribute('y1',RAD_CY+Math.sin(sa)*RAD_R0);
      sp.setAttribute('x2',RAD_CX+Math.cos(sa)*146);    sp.setAttribute('y2',RAD_CY+Math.sin(sa)*146);
      sp.setAttribute('class','spoke'); _radSpokes.appendChild(sp);
      // ★텍스트 라벨(조각 중앙) — 아이콘 대신 글자. it.short(짧은 표기) 우선, 없으면 label.
      const ic=document.createElement('div'); ic.className='icn';
      ic.style.left=(RAD_CX+Math.cos(c)*Rm)+'px'; ic.style.top=(RAD_CY+Math.sin(c)*Rm)+'px';
      ic.textContent=(it.short || it.label || ''); _radEl.appendChild(ic);
    });
  }
  function _updateRadialSel(){
    [..._radWedges.children].forEach((w,i)=>w.classList.toggle('sel', i===_radSel));
    [..._radEl.querySelectorAll('.icn')].forEach((l,i)=>l.classList.toggle('sel', i===_radSel));
    const it=_radItems[_radSel];
    _radCtrIcn.innerHTML = '';   // 중앙 허브는 라벨만(각 조각에 이미 아이콘 있음 — 중앙 아이콘은 라벨과 겹쳐 제거)
    _radCtrLbl.textContent = (it && it.label) || '';
  }
  function openCrewRadial(items){
    if(!items || !items.length) return;
    _radItems = items; _radSel = Math.max(0, Math.min(items.length-1, items.def || 0)); _rax = 0; _ray = 0;
    _buildRadialDom(items); _updateRadialSel();
    _radEl.style.display = 'block'; _radOpen = true;
  }
  function crewRadialMove(dx, dy){
    if(!_radOpen) return;
    _rax += dx; _ray += dy;
    if(_rax*_rax + _ray*_ray > 100){
      const deg = Math.atan2(_ray, _rax) * 180/Math.PI;
      let bi = 0, bd = 1e9;
      for(let i=0;i<_radItems.length;i++){ const ia = -90 + i*360/_radItems.length; const d = Math.abs(((deg-ia+540)%360)-180); if(d < bd){ bd = d; bi = i; } }
      _radSel = bi; _updateRadialSel();
    }
  }
  function closeCrewRadial(execute){
    if(!_radOpen) return;
    _radOpen = false; _radEl.style.display = 'none';
    const it = _radItems[_radSel]; _radItems = [];
    if(execute && it && it.act) it.act();
  }
  // 컨텍스트별 항목 — def=마우스 안 움직이고 뗐을 때 기본 선택(현재 상태 유지, 실수 방지)
  function _crewRadialItems(){
    if(!_onDeck()){
      const items = [
        { id:'follow', short:'따라오기', label:'따라오기', act:() => _setLandOrder('follow') },
        { id:'attack', short:'공격하기', label:'공격하기', act:() => _setLandOrder('attack') },
        { id:'wait',   short:'대기하기', label:'대기하기', act:() => _setLandOrder('wait') },
      ];
      items.def = Math.max(0, items.findIndex(it => it.id === _landMode));
      return items;
    }
    if(crewRole() === 'helm' && _crewManned){
      // ★2026-07-10(사령관 "조타상태에서 R눌러서 좌현/우현 가도 안됨") — 예전엔 ship._crewCirc만 세팅했는데,
      //   이건 전투 원선회(_crewSteerAuto) 전용 변수라 평시 순항(_crewCruise)은 항상 rudder→0(직진)으로 무시하고 있었음.
      //   평시에도 적용되는 별도 상태(_cruiseTurn)를 같이 세팅 + '직진 유지'로 해제.
      const items = [
        { id:'left',    short:'좌현 선회', label:'좌현 선회', act:() => { if(ctx.ship) ctx.ship._crewCirc=-1; _cruiseTurn=-1; } },
        { id:'right',   short:'우현 선회', label:'우현 선회', act:() => { if(ctx.ship) ctx.ship._crewCirc=1; _cruiseTurn=1; } },
        { id:'straight',short:'직진 유지', label:'직진 유지', act:() => { _cruiseTurn=null; } },
        { id:'closer',  short:'거리 좁혀', label:'거리 좁혀', act:() => { _standoff = Math.max(STANDOFF_MIN, _standoff - 20); } },
        { id:'farther', short:'거리 벌려', label:'거리 벌려', act:() => { _standoff = Math.min(STANDOFF_MAX, _standoff + 20); } },
      ];
      items.def = 2;
      return items;
    }
    const items = [
      { id:'free',   short:'자유행동', label:'자유롭게 해', act:() => assign(null) },
      { id:'helm',   short:'조타로 가', label:'조타로 가',   act:() => assign('helm') },
    ];   // ★2026-07-12: "대포 잡아" 제거 — 대포는 플레이어가 직접 조준·발사(스테이션 폐지). 크루는 자유/조타만 지시.
    items.def = Math.max(0, items.findIndex(it => it.id === (_assign || 'free')));
    return items;
  }
  addEventListener('keydown', e => {
    if(e.code !== 'KeyR' || e.repeat) return;
    if(ctx.input && ctx.input.blocks && ctx.input.blocks('KeyR')) return;
    if(_radOpen) return;
    openCrewRadial(_crewRadialItems());
  });
  addEventListener('keyup', e => { if(e.code === 'KeyR') closeCrewRadial(true); });
  addEventListener('keydown', e => { if(e.code === 'Escape' && _radOpen) closeCrewRadial(false); });

  // ── 상호작용 프롬프트(UI) ──
  const _hint = document.createElement('div');
  _hint.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:20;display:none;'
    + 'padding:6px 16px;background:rgba(10,16,24,.82);border:1px solid rgba(150,190,230,.5);border-radius:8px;'
    + "color:#dff0ff;font:14px Pretendard,system-ui,'Malgun Gothic';pointer-events:none;white-space:nowrap;text-shadow:0 1px 2px #000";
  document.body.appendChild(_hint);
  // ★조준점(크로스헤어) 미표시 — 사령관 지시: SoT처럼 포신 각도(마우스 상하)로 거리를 눈대중 조준. 화면 십자 없음.

  // ── ⚔️ 전술 HUD — 대포 상태에서 크루 자동 항해 명령(A/D 선회방향 · W/S 거리) 표시 ──
  let _standoff = STANDOFF_DEF;
  let _cruiseTurn = null;   // ★평시 순항 중 R라디얼 좌현/우현 지시(-1|1|null=직진) — 전투용 ship._crewCirc와 별개(2026-07-10)
  const _tacEl = document.createElement('div');
  _tacEl.style.cssText = 'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:20;display:none;'
    + "padding:5px 15px;background:rgba(10,16,24,.6);border:1px solid rgba(150,190,230,.35);border-radius:20px;"
    + "color:#bcd6f0;font:12px Pretendard,system-ui,'Malgun Gothic';pointer-events:none;white-space:nowrap;text-shadow:0 1px 2px #000";
  document.body.appendChild(_tacEl);

  // ── 루프 ──
  let _wasBoarded = false;
  function _nearestEnemy(ship, enemies){ let t=null, bd=Infinity;
    for(const e of enemies){ if(e._sunk) continue; const d=Math.hypot(e.x-ship.x, e.z-ship.z); if(d<bd){ bd=d; t=e; } } return t; }
  // 크루 자동 조타 — 적 중심 원선회로 현측 유지. ★일부러 서툴게: 낮은 게인(CREW_TURN) + 느린 반응(CREW_REACT).
  function _crewSteerAuto(dt, ship, enemy, standoff, circ){
    const dx=enemy.x-ship.x, dz=enemy.z-ship.z, dist=Math.hypot(dx,dz)||1e-6, toE=Math.atan2(dz,dx);
    const tangent = toE + circ*(Math.PI/2);
    const wantBow = tangent - circ*THREE.MathUtils.clamp((dist-standoff)/standoff, -0.7, 0.7);
    const bx=ship.forward.x, bz=ship.forward.z, tx=Math.cos(wantBow), tz=Math.sin(wantBow);
    const turn = Math.atan2(bx*tz - bz*tx, bx*tx + bz*tz);                 // ship.js autopilot 부호식
    const targetRud = THREE.MathUtils.clamp(turn*CREW_TURN, -1, 1);
    ship.rudder += (targetRud - ship.rudder) * Math.min(1, dt*CREW_REACT); // 즉각 X = 느린 반응(서툰 크루)
    ship.furl = Math.max(0, (ship.furl||0) - dt*1.5);
  }
  // 크루 무인 순항(조타 지시 + 나는 갑판 보행) — 침로 유지·돛 관리. autopilot(항구 호출)·닻과 충돌 금지.
  function _crewCruise(dt, ship){
    if(ship.autopilot || ship.anchored) return;
    const onDeck = ctx.player && ctx.player._onShip === ship;
    if(!onDeck){ ship.furl = Math.min(1, (ship.furl||0) + dt*0.8); ship.rudder += (0-ship.rudder)*Math.min(1, dt*CREW_REACT); return; }   // 선장 하선 = 돛 접고 대기(배 유실 방지)
    // ★2026-07-10 — R라디얼 좌현/우현 지시(_cruiseTurn) 반영. 예전엔 항상 rudder→0(직진 고정)이라 평시 지시가 씹혔음.
    const targetRudder = _cruiseTurn ? _cruiseTurn*0.55 : 0;
    ship.rudder += (targetRudder - ship.rudder) * Math.min(1, dt*CREW_REACT);
    ship.furl = Math.max(0, (ship.furl||0) - dt*0.8);                // 돛 펴고 순항
  }

  ctx.onUpdate(dt => {
    const b = boarded();
    if(b && !_wasBoarded){ if(_playerStation === null) _playerStation = 'helm'; }   // Z(외부)로 조타 진입 시 기본 helm
    else if(!b && _wasBoarded){ _playerStation = null; _activeCannon = -1; }
    _wasBoarded = b;
    if(_mixer) _mixer.update(dt);
    _tickFigure(dt);

    const ship = ctx.ship, nc = ctx.navalcombat;
    const role = crewRole();

    // ── 프롬프트: 크루 지시([E]) 우선 → 스테이션([Z]) ──
    let hint = '';
    if(_nearCrew()){
      const cur = _assign ? _ORDER_NAME[_assign] : _ORDER_NAME.free;
      hint = `[E] 크루 지시 — 현재: ${cur}`;
    }
    else if(b){ hint = _playerStation==='cannon' ? '[Z] 대포에서 나가기' : '[Z] 조타에서 나가기'; }
    else if(ship && ctx.player && ctx.player._onShip === ship){
      const near = nearestStation(ship, ctx.player.pos);
      if(near) hint = near.station==='helm' ? '[Z] 조타' : '[Z] 대포';
    }
    _hint.textContent = hint; _hint.style.display = hint ? 'block' : 'none';
    // ★조타 중(boarded)엔 하단 boatHud(나침로배지+다이얼+효율/전력/러더바, 실측 ~250~300px)와 겹치므로
    //   힌트를 그 위로 올린다. #boatHud 실제 높이를 런타임 측정(bottom:74px 기준) + 여유 10px. 못 재면 350px 폴백.
    //   조타 중이 아닐 땐(갑판 보행 등) 기존 118px 유지.
    if(hint){
      let hb = 118;
      if(b){ hb = 350; const hud = document.getElementById('boatHud');
        if(hud){ const r = hud.getBoundingClientRect(); if(r && r.height > 0) hb = Math.round(74 + r.height + 10); } }
      _hint.style.bottom = hb + 'px';
    }

    if(!ship){ _tacEl.style.display = 'none'; return; }

    // ── ⚔️ 크루 조타(도착·담당 중일 때만) — 전투=원선회 / 평시=무인 순항(지시) ──
    if(who('helm') === 'crew'){
      if(ship.anchored){ ship.rudder = 0; }
      else {
        const e = (nc && nc.enemies) ? _nearestEnemy(ship, nc.enemies) : null;
        if(e){
          // 전술 명령(A/D 선회 · W/S 거리)은 내가 대포 조종 중일 때만(갑판 보행 A/D=이동과 충돌 방지)
          if(b && _playerStation === 'cannon'){
            const keys = ctx.player && ctx.player.keysSet;
            if(ship._crewCirc == null) ship._crewCirc = 1;
            if(keys && keys.has('KeyA')) ship._crewCirc = -1;                                        // 좌현 원선회
            else if(keys && keys.has('KeyD')) ship._crewCirc = 1;                                    // 우현 원선회
            if(keys && keys.has('KeyW')) _standoff = Math.max(STANDOFF_MIN, _standoff - dt*30);      // 거리 좁힘
            else if(keys && keys.has('KeyS')) _standoff = Math.min(STANDOFF_MAX, _standoff + dt*30); // 벌림
            _tacEl.textContent = (ship._crewCirc<0 ? '◀ 좌현 선회' : '우현 선회 ▶') + '  (A/D) · 목표거리 ' + Math.round(_standoff) + 'm (W/S)';
            _tacEl.style.display = 'block';
          } else _tacEl.style.display = 'none';
          if(ship._crewCirc == null) ship._crewCirc = 1;
          _crewSteerAuto(dt, ship, e, _standoff, ship._crewCirc);
        }
        else { _tacEl.style.display = 'none'; _crewCruise(dt, ship); }
      }
    } else _tacEl.style.display = 'none';

    // ── 💣 크루 포격(도착·담당 중 + 전투) ──
    //   ★2026-07-10 해전 개편: 내가 조타 스테이션이면 이제 '내가' 조준 사격(navalcombat.playerFire=현측 일제사격)
    //     → 크루 자동포격은 '저절로 쏘는' 느낌을 만들므로 조타 중엔 끔. 무인/[E]지시 크루 자동포격만 유지.
    if(who('cannon') === 'crew' && !isPlayerAt('helm') && _combatActive() && nc && nc.autoCrewFire) nc.autoCrewFire(ship);
  });

  ctx.crew = { playerStation, isPlayerAt, who, tryInteract, exit, activeCannonLocal, activeCannonIsLeft,
    assign, assignment: () => _assign,
    roster, recruit, MAX_CREW,   // 축4: 다인원 로스터(읽기) + 영입 API
    radialOpen: () => _radOpen, radialMove: crewRadialMove,   // [R] 지시 라디얼(player.js mousemove가 호출)
    landOrder: () => _landMode, setLandOrder: _setLandOrder,   // ★2026-07-10: opening.js/trader.js가 재사용(중복 추종자 통합)
    figureGroup: () => _fig, figureMixer: () => _mixer,        // ★2026-07-10: 오프닝 컷신이 별도 GLTF 안 만들고 이 피규어를 그대로 씀
    stationLabel: () => (playerStation()==='cannon' ? '포' : (playerStation()==='helm' ? '조타' : '')) };
  console.log('[crew] 스테이션([Z] 진입) + 갑판 잡일 FSM(웨이포인트) + [E] 역할 지시(자유→조타→포격) + [R] 지시 라디얼(어디서나) — __crewOff{back,side,yaw}로 조타 스탠스 튜닝');
  return ctx.crew;
}

// [근거]
// 확정:
//  - 갑판 위치 = 레이캐스트 인식 아닌 배 로컬 고정점(웨이포인트) + mesh 자식 부착. (출처: 사령관 "갑판 완벽 인식 가능?" 논의 → 로컬 웨이포인트 방식 컨펌 2026-07-05)
//  - [E] 지시 = 자유행동→조타→포격 순환·고정 배정, 기본은 자동 보완 유지(하이브리드). (출처: 사령관 "E로 조종/대포 맡기는 게 자연스럽지 않을까" + /plan 컨펌)
//  - 크루 외형 = KayKit 클래스 6종 한정, 구 id는 rogue 폴백. (출처: 사령관 지시 2026-07-05 + AskUser 컨펌 "6종 전부")
//  - 무인 조타 가능 = ship.js 물리가 boarded 무관하게 rudder/furl 소비(autopilot 선례 582행). autopilot·anchored 시 크루 양보.
//  - 크루 조타 부호식 = ship.js autopilot 검증식(cross/dot→turn→rudder). (출처: ship.js onUpdate autopilot — 기존 코드 유지)
// 제안:
//  - 웨이포인트 기본값 = 배 치수(deckW/deckCz) 비례 4~5점. ship.crewWaypoints로 배별 오버라이드 가능(실측 튜닝 여지).
//  - WALK 1.5 · RUN 3.2 m/s, 잡일 지속 4~10s = 제안값(실플레이 조정).
//  - 선장 하선 시 크루 돛 접고 대기(배 유실 방지) = 제안. 사령관 실플레이 판단.
// 미정:
//  - 정비(tend)/휴식(rest) 전용 클립 존재 여부 — Rig_Medium 세트에서 regex 탐색, 없으면 idle 폴백(로그로 확인 가능).
//  - 다층 갑판(계단) 이동 — v1은 주갑판 한 층만. 층 체인 웨이포인트는 후속.
