// player.js — 3인칭/1인칭 캐릭터 컨트롤러. Rapier 캡슐 + 마우스 궤도 카메라 + WASD(카메라 기준) 이동.
// 표준 공식: forward=(sinYaw,0,-cosYaw), right=(cosYaw,0,sinYaw). 3인칭은 캐릭터가 "이동방향"을 바라봄.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (무기 데미지·스태미나)
import { comboHit, comboEnd } from '/tomob-deploy/modules/uikit.js';   // 그로기 난타 콤보 카운터 UI

// KayKit 캐릭터 + Rig_Medium 공용 애니(전 캐릭터 공유). 캐릭터 교체는 charUrl 한 줄.
const KAY_ANIM_BASE='/tomob-deploy/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/';
const KAY_ANIM_SETS=['Rig_Medium_General.glb','Rig_Medium_MovementBasic.glb','Rig_Medium_MovementAdvanced.glb',
  'Rig_Medium_Tools.glb','Rig_Medium_CombatMelee.glb','Rig_Medium_CombatRanged.glb','Rig_Medium_Simulation.glb'];   // 전 모션(idle/이동/점프/도구/전투/마법/생활)
const PICK_URL='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/tool-pickaxe.glb';
const PICK_COLORMAP='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/Textures/colormap.png';
const HAMMER_URL='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/tool-hammer-upgraded.glb';   // 🔨 철거 도구(kenney 생존킷, colormap 공유)
// 선택 가능한 플레이어 캐릭터(전부 Rig_Medium 공유 — 동일 애니/도구 설정). 캐릭터 선택 화면에서 이 중 택1.
export const KAY_CHARS = {
  knight:      '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Knight.glb',       // 아른(남) — 균형·제작
  rogue_hooded:'/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Rogue_Hooded.glb', // 아른(여) — 기민·채집
  barbarian:   '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Barbarian.glb',    // 켈드 — 전투·야간생존
  mage:        '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Mage.glb',         // 고른 — 채굴·공장
  ranger:      '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Ranger.glb',       // 베른 — 항해·점령
};
// 직업→전투 무기(스킬은 캐릭터 고정. 퀵슬롯 무기와 무관하게 직업 무기로 전투). ?char= 로 선택.
export const CLASS_WEAPON = { knight:'sword', barbarian:'axe2h', mage:'staff', ranger:'bow', rogue_hooded:'duals', rogue:'duals' };
// ── 퀵슬롯 장착표(설정표 — voyage _PROJECT.md / _GAME_DESIGN §7-B) ──
const KW='/tomob-deploy/KayKit_Adventurers_2.0_FREE/Assets/gltf/';   // KayKit 무기
// ── 무기 클래스별 콤보(공격 순서)·점프공격·공격속도 ── (KayKit CombatMelee)
// ★밸런스 숫자(speed/dmg/stam/hit) = balance.js(BAL.weapons) 단일 소스. 여기선 콤보/점프 애니만.
const COMBOS = {
  '1h':   { combo:['Melee_1H_Attack_Chop','Melee_1H_Attack_Slice_Diagonal','Melee_1H_Attack_Slice_Horizontal','Melee_1H_Attack_Stab'], jump:'Melee_1H_Attack_Jump_Chop', ...BAL.weapons['1h'] },   // 한손검=균형
  '1hf':  { combo:['Melee_1H_Attack_Stab','Melee_1H_Attack_Slice_Horizontal','Melee_1H_Attack_Slice_Diagonal'], jump:'Melee_1H_Attack_Jump_Chop', ...BAL.weapons['1hf'] },    // 단검=빠르고 약함
  '2h':   { combo:['Melee_2H_Attack_Chop','Melee_2H_Attack_Slice','Melee_2H_Attack_Stab'], jump:'Melee_2H_Attack_Chop', ...BAL.weapons['2h'] },   // 양손=느리고 묵직. 점프=내려찍기(Chop). 스핀은 RMB 전용
  'unarmed':{ combo:['Melee_Unarmed_Attack_Punch_A','Melee_Unarmed_Attack_Kick'], jump:'Melee_Unarmed_Attack_Kick', ...BAL.weapons['unarmed'] },   // 맨손 = 약하고 빠름(펀치→킥)
  'dualwield':{ combo:['Melee_Dualwield_Attack_Chop','Melee_Dualwield_Attack_Slice','Melee_Dualwield_Attack_Stab'], jump:'Melee_Dualwield_Attack_Chop', ...BAL.weapons['dualwield'] },   // 쌍수 = 빠른 연타. RMB=킥(스턴)
  // hit = 칼이 닿는 임팩트 시점(애니 길이 대비 비율) → 이때 sword_hit + 데미지숫자. whoosh는 스윙 시작.
};
export const LOADOUT = {
  none:    { key:'0', label:'빈손', cls:'unarmed' },   // 좌클릭=펀치/킥 콤보, 우클릭=박치기(useRight)
  pickaxe: { key:'1', label:'곡괭이', url:PICK_URL, slot:'r', kenney:true, scale:5, rot:[0,Math.PI,0], anim:'Pickaxing', cycle:true, timeScale:1.8, swing:'chop' },
  axe:     { key:'2', label:'도끼',  url:KW+'axe_1handed.gltf', slot:'r', rot:[0,Math.PI,0], anim:'Chopping', swing:'chop' },   // 벌목 도구
  torch:   { key:'3', label:'횃불',  url:'/tomob-deploy/torch_simple.glb', slot:'r', scale:0.4, rot:[0,0,0] },   // 🔥 생산도구 = 밤 조명(torch.js가 불빛). 전투무기 아님(cls 없음). ★torch_simple=Y축 세로 1.57m → scale0.4≈0.63m.
  hammer:  { key:'4', label:'망치',  url:HAMMER_URL, slot:'r', kenney:true, scale:5, rot:[0,Math.PI,0], anim:'Chopping', swing:'chop' },   // 🔨 철거 도구 — 내가 지은 축성블록/던전건축물을 조준·좌클릭으로 부숨(재료 1개 환급). 전투무기 아님(cls 없음).
  sword:   { key:'3', label:'검+방패', url:KW+'sword_1handed.gltf', slot:'r', cls:'1h', offhand:KW+'shield_round.gltf', offhandPos:[0,0.039,0.145], swing:'slash' },
  sword2h: { key:'4', label:'양손검', url:KW+'sword_2handed.gltf', slot:'r', cls:'2h', swing:'heavy' },
  axe2h:   { key:'5', label:'양손도끼', url:KW+'axe_2handed.gltf', slot:'r', rot:[0,Math.PI,0], cls:'2h', swing:'heavy' },
  dagger:  { key:'6', label:'단검(도적)', url:KW+'dagger.gltf', slot:'r', cls:'1hf', swing:'stab' },   // 도적: 좌=빠른 콤보, RMB=은신
  bow:     { key:'7', label:'활',    url:KW+'bow_withString.gltf', slot:'l', rot:[0,0,Math.PI], anim:'Ranged_Bow_Draw', morph:true, ranged:'bow', holdDraw:true, swing:'draw' },
  duals:   { key:'8', label:'쌍수단검(로그)', url:KW+'dagger.gltf', slot:'r', cls:'dualwield', offhand:KW+'dagger.gltf', offhandPos:[0,0.02,0.1], swing:'stab',
             vmOffhand:{ pos:[-0.22,-0.17,-0.5], rot:[0.2,0.45,-0.6], size:0.44 } },   // 로그: 좌=쌍수콤보, RMB=킥(스턴). 양손 단검. vmOffhand=1인칭 왼손 단검(VIEWMODEL.duals의 X미러)
  staff:   { key:'9', label:'지팡이', url:KW+'staff.gltf', slot:'r', rot:[0,0,0], anim:'Ranged_Magic_Shoot', magic:true, swing:'draw' },   // 마법 시전(스킬 전환=magic.js 휠/키)
};
const SLOT_ORDER=['pickaxe','axe','none'];   // ★무기(검/양손/단검/활/쌍수/지팡이) 퀵슬롯에서 제외 — 도구(곡괭이·도끼)+빈손만. 전투는 직업무기(CLASS_WEAPON) 고정
// ── 1인칭 viewmodel(카메라 기준). 모델을 size(최대변 m)로 정규화 + pivot 배치. mine.js 곡괭이 기준값을 베이스로. ──
//   __vmTune/__vmDump 또는 _vmtune.html로 잡고 여기 반영. (size=화면상 크기, 무기별로만 다름)
const VIEWMODEL = {
  _default:{ pos:[0.30,-0.30,-0.55], rot:[0,0,0], size:0.5 },
  pickaxe: { pos:[0.34,-0.28,-0.5],  rot:[0.32,-0.68,0.74], size:0.5 },
  axe:     { pos:[0.34,-0.28,-0.5],  rot:[0.29,-1.1,0.75],  size:0.5 },
  torch:   { pos:[0.32,-0.26,-0.5],  rot:[0.1,0,0.15],  size:0.62 },   // 🔥 1인칭 횃불(torch_simple, Y세로). _vmtune로 미세튜닝
  hammer:  { pos:[0.34,-0.28,-0.5],  rot:[0.29,-1.1,0.75],  size:0.55 },   // 🔨 1인칭 망치(도끼 그립 준용). _vmtune로 미세튜닝
  sword:   { pos:[0.34,-0.28,-0.5],  rot:[0.35,-0.62,0.75], size:0.7 },
  sword2h: { pos:[0.42,-0.1,-0.44],  rot:[0.59,-1.01,0.68], size:0.85 },
  axe2h:   { pos:[0.53,-0.18,-0.58], rot:[0.41,-0.55,0.53], size:0.75 },
  dagger:  { pos:[0.34,-0.16,-0.5],  rot:[0.15,-0.55,0.75], size:0.62 },
  duals:   { pos:[0.22,-0.17,-0.5],  rot:[0.2,-0.45,0.6],   size:0.44 },   // 쌍수 메인(오른손). vmOffhand가 미러
  bow:     { pos:[0.36,-0.11,-0.33], rot:[1.67,3.15,-1.37], size:0.71 },
  crossbow:{ pos:[0.39,-0.22,-0.5],  rot:[0.26,3.15,-0.17], size:0.6 },
  staff:   { pos:[0.34,-0.20,-0.5],  rot:[0.2,-0.3,0.5],    size:0.8 },
};
// ── 1인칭 스윙 프리셋(클래스별) — 준비→타격→hold→복귀 호. mine.js 곡괭이 chop 베이스 + 베기/찌르기/묵직/당기기 ──
const VM_ss=t=>t*t*(3-2*t);
const VM_QID=new THREE.Quaternion(), VM_VZ=new THREE.Vector3();
const _qe=(x,y,z)=>new THREE.Quaternion().setFromEuler(new THREE.Euler(x,y,z));
const VM_SWINGS={
  chop:  { qUp:_qe(0.95,0.18,0.06), qStrike:_qe(-1.25,-0.08,-0.03), pUp:new THREE.Vector3(0.12,0.14,0.06),  pStrike:new THREE.Vector3(-0.06,-0.20,-0.14), tUp:0.42,tStrike:0.60,tHold:0.70,speed:3.0 }, // 곡괭이·도끼 내려치기
  slash: { qUp:_qe(0.25,0.95,0.45), qStrike:_qe(-0.10,-1.05,-0.55), pUp:new THREE.Vector3(0.14,0.10,0.02), pStrike:new THREE.Vector3(-0.22,-0.05,-0.10), tUp:0.24,tStrike:0.46,tHold:0.54,speed:4.4 }, // 한손검 횡베기
  stab:  { qUp:_qe(0.10,-0.18,0.0), qStrike:_qe(-0.05,0.08,0.0),   pUp:new THREE.Vector3(0.0,0.05,0.12),  pStrike:new THREE.Vector3(0.0,-0.02,-0.36), tUp:0.26,tStrike:0.42,tHold:0.50,speed:5.2 }, // 단검 찌르기
  heavy: { qUp:_qe(1.15,0.28,0.10), qStrike:_qe(-1.45,-0.10,-0.05), pUp:new THREE.Vector3(0.16,0.20,0.08), pStrike:new THREE.Vector3(-0.10,-0.28,-0.20), tUp:0.50,tStrike:0.68,tHold:0.78,speed:2.3 }, // 양손 묵직
  draw:  { qUp:_qe(0,0.15,0), qStrike:_qe(0,0.22,0), pUp:new THREE.Vector3(0,0,0.04), pStrike:new THREE.Vector3(0,0,0.10), tUp:0.4,tStrike:0.6,tHold:0.72,speed:2.6 }, // 활/석궁(임시 — 당기기는 활 작업서 정식)
};

export function initPlayer(ctx, { spawn={x:0,y:60,z:0}, charUrl='/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Knight.glb' }={}){
  if(ctx.player) return ctx.player;   // ★중복 init 방지 — sandbox가 자동 init하므로 ?sys=player 중복 시 아바타·viewmodel·핫바·입력이 두 번 생기는 버그 차단
  const { THREE, scene, camera, renderer, RAPIER, world } = ctx;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x,spawn.y,spawn.z));
  const col  = world.createCollider(RAPIER.ColliderDesc.capsule(0.7,0.45), body);
  const ctrl = world.createCharacterController(0.05);
  ctrl.enableAutostep(1.2,0.2,true); ctrl.enableSnapToGround(0.7);
  ctrl.setMaxSlopeClimbAngle(55*Math.PI/180); ctrl.setMinSlopeSlideAngle(62*Math.PI/180);
  ctrl.setApplyImpulsesToDynamicBodies(true);

  // ── 아바타 (KayKit) + 퀵슬롯 장착 시스템 ──
  let avatar=null, mixer=null, clips=null, actIdle=null, actWalk=null, actRun=null, actJump=null, actCrawl=null, curAct=null, _useUntil=0;
  let actBowIdle=null, actBowRun=null, _dead=false;   // 활 든 자세(idle/이동) + 사망 상태(이동애니 잠금)
  let slotR=null, slotL=null, headBone=null, useAction=null, bowMorph=null, _colormap=null, currentTool='none';
  let drawing=false, drawT=0, drawStart=0, vmBowMorph=null, vmArrow=null;   // 활 당기기(hold/release, drawStart=실제 시작시각) + 1인칭 활 모프·nocking 화살
  const DRAW_TIME=0.55;   // 풀당김까지(초)
  let _atkLock=0, _atkStart=0, _atkAnimUntil=0, _comboI=0, _comboReset=0, _dualHand=0;   // 공격 쿨다운(끝/시작) / 공격모션 끝시각 / 콤보 인덱스 / 콤보 리셋 / 쌍수 1인칭 교대손(0=오른,1=왼)
  const heldM={r:null,l:null,arrow:null};
  // ── 1인칭 viewmodel(카메라 자식) — 메인무기(vmSwingG, 스윙) + 오프핸드 방패(vmOff, 고정) ──
  const vmRig=new THREE.Group(); const vmSwingG=new THREE.Group(); const vmOff=new THREE.Group(); vmRig.add(vmSwingG); vmRig.add(vmOff);
  let vmModel=null, vmOffModel=null, heldSwing=0, vmToolId=null; const vmRest=new THREE.Vector3(0.34,-0.28,-0.5);
  const VM_SHIELD={ pos:[-0.33,-0.26,-0.42], rot:[0.1,1.0,0.05], size:0.42 };   // 왼손 방패(1인칭). _vmTuneOff(px,py,pz,rx,ry,rz,size)로 조정
  const _vq=new THREE.Quaternion(), _vv=new THREE.Vector3();
  const vmOffRest=new THREE.Vector3(); let vmOffSwing=false, curSwingM=null;   // 오프핸드(쌍수 왼손) 스윙: 휴식위치 + 활성여부 + 미러 스윙 프리셋
  const _vq2=new THREE.Quaternion(), _vv2=new THREE.Vector3();
  let curSwing=VM_SWINGS.chop;   // 현재 무기 스윙 프리셋(setViewmodel에서 설정)
  camera.add(vmRig); if(!camera.parent) scene.add(camera);
  function applyVMPose(p){ const T=curSwing;
    if(p<T.tUp){ const k=VM_ss(p/T.tUp); _vq.copy(VM_QID).slerp(T.qUp,k); _vv.copy(VM_VZ).lerp(T.pUp,k); }
    else if(p<T.tStrike){ const k=(p-T.tUp)/(T.tStrike-T.tUp); _vq.copy(T.qUp).slerp(T.qStrike,k*k); _vv.copy(T.pUp).lerp(T.pStrike,k*k); }
    else if(p<T.tHold){ _vq.copy(T.qStrike); _vv.copy(T.pStrike); }
    else { const k=(p-T.tHold)/(1-T.tHold); const e=1-(1-k)*(1-k); _vq.copy(T.qStrike).slerp(VM_QID,e); _vv.copy(T.pStrike).lerp(VM_VZ,e); }
    vmSwingG.quaternion.copy(_vq); vmSwingG.position.copy(vmRest).add(_vv); }
  // ── 쌍수 오프핸드(왼손) 미러 스윙 — 메인 스윙을 X축 반전해 양손 동시 공격 ──
  const _mEu=new THREE.Euler();
  const _mirrorQ=q=>{ _mEu.setFromQuaternion(q,'XYZ'); _mEu.y=-_mEu.y; _mEu.z=-_mEu.z; return new THREE.Quaternion().setFromEuler(_mEu); };   // YZ평면 미러
  const _mirrorV=v=>new THREE.Vector3(-v.x, v.y, v.z);
  function buildSwingMirror(T){ return { tUp:T.tUp, tStrike:T.tStrike, tHold:T.tHold, speed:T.speed,
    qUp:_mirrorQ(T.qUp), qStrike:_mirrorQ(T.qStrike), pUp:_mirrorV(T.pUp), pStrike:_mirrorV(T.pStrike) }; }
  function applyVMOffPose(p){ const T=curSwingM||curSwing;
    if(p<T.tUp){ const k=VM_ss(p/T.tUp); _vq2.copy(VM_QID).slerp(T.qUp,k); _vv2.copy(VM_VZ).lerp(T.pUp,k); }
    else if(p<T.tStrike){ const k=(p-T.tUp)/(T.tStrike-T.tUp); _vq2.copy(T.qUp).slerp(T.qStrike,k*k); _vv2.copy(T.pUp).lerp(T.pStrike,k*k); }
    else if(p<T.tHold){ _vq2.copy(T.qStrike); _vv2.copy(T.pStrike); }
    else { const k=(p-T.tHold)/(1-T.tHold); const e=1-(1-k)*(1-k); _vq2.copy(T.qStrike).slerp(VM_QID,e); _vv2.copy(T.pStrike).lerp(VM_VZ,e); }
    vmOff.quaternion.copy(_vq2); vmOff.position.copy(vmOffRest).add(_vv2); }
  const _loader=new GLTFLoader(); const _load=u=>new Promise((res,rej)=>_loader.load(encodeURI(u),res,undefined,rej));
  (async()=>{
    let g; try{ g=await _load(charUrl); }catch(e){ console.warn('[player] char load fail', e&&e.message); return; }
    const m=g.scene; m.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){ o.frustumCulled=false; o.castShadow=true; } });
    const box=new THREE.Box3().setFromObject(m); const sz=new THREE.Vector3(); box.getSize(sz); const _natH=sz.y||1;
    const fit=h=>{ m.scale.setScalar(h/_natH); const b2=new THREE.Box3().setFromObject(m); m.position.y-=b2.min.y; };
    fit(1.35);   // 몸높이 1.35m(기존 영웅 기준). __heroScale(h)로 튜닝
    avatar=new THREE.Group(); avatar.rotation.order='YXZ'; avatar.add(m); scene.add(avatar); m.updateMatrixWorld(true);   // YXZ: Y=heading 위에 X=수영 수평틸트 합성
    window.__heroScale=h=>{ m.position.y=0; fit(h); };
    m.traverse(o=>{ if(o.isBone&&o.name==='handslotr') slotR=o; if(o.isBone&&o.name==='handslotl') slotL=o; if(o.isBone&&o.name==='head') headBone=o; });   // 양손 슬롯 + 머리(1인칭 숨김용)
    // 애니(전 세트 공용) + kenney colormap
    mixer=new THREE.AnimationMixer(m); clips=new Map();
    for(const s of KAY_ANIM_SETS){ try{ const ag=await _load(KAY_ANIM_BASE+s); for(const c of ag.animations) if(!clips.has(c.name)) clips.set(c.name,c); }catch(e){} }
    const mk=n=>{ const c=clips.get(n); return c?mixer.clipAction(c):null; };
    actIdle=mk('Idle_A')||mk('Idle_B'); actWalk=mk('Walking_A'); actRun=mk('Running_A'); actJump=mk('Jump_Idle')||mk('Jump_Full_Long');
    actCrawl=mk('Crawling');   // 🏊 수영 = Crawling 클립을 몸통 수평틸트로 눕혀 유영(전용 수영 클립 부재)
    actBowIdle=mk('Ranged_Bow_Idle'); actBowRun=mk('Running_HoldingBow');   // 활/석궁 장착 시 손 자세(3인칭 어색함 해결)
    _colormap=new THREE.TextureLoader().load(encodeURI(PICK_COLORMAP)); _colormap.flipY=false; _colormap.colorSpace=THREE.SRGBColorSpace;
    if(actIdle){ actIdle.play(); curAct=actIdle; }
    window.__playAnim=(name,once=true)=>{ const c=clips.get(name); if(!c||!mixer) return '없음: '+name;
      const a=mixer.clipAction(c); a.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat, once?1:Infinity); a.clampWhenFinished=true;
      _useUntil=performance.now()+(once?c.duration*1000+200:6e5);
      if(curAct&&curAct!==a) curAct.fadeOut(0.12); a.reset().fadeIn(0.1).play(); curAct=a; return '재생: '+name; };
    window.__animList=()=>[...clips.keys()];
    window.__curAnim=()=> (curAct&&curAct.getClip)? curAct.getClip().name : null;   // 현재 재생 클립명(검증/디버그)
    window.__mineSpeed=x=>{ if(useAction&&currentTool==='pickaxe') useAction.timeScale=x; };
    // 기본 장착 = 캐릭터 직업 무기(스킬=캐릭터 고정). ?char= 없으면 곡괭이.
    const _ck=(typeof location!=='undefined'&&new URLSearchParams(location.search).get('char')||'').toLowerCase();
    await equipTool(CLASS_WEAPON[_ck]||'pickaxe');
    buildHotbar();
  })();
  // 손슬롯에 모델 부착(공용). kenney면 colormap 적용.
  async function _attach(url, slotKey, {scale=1, pos=[0,0,0], rot=[0,0,0], kenney=false}={}){
    const slot=(slotKey==='l')?slotL:slotR; if(!slot) return null;
    const g=await _load(url); const t=g.scene;
    t.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.castShadow=true;
      if(kenney){ o.material=o.material.clone(); o.material.map=_colormap; o.material.color.set(0xffffff); o.material.needsUpdate=true; } } });
    const w=new THREE.Group(); w.add(t); w.scale.setScalar(scale||1); w.position.set(...pos); w.rotation.set(...rot); slot.add(w); return {w,t};
  }
  // ── 1인칭 viewmodel 세팅(카메라 부착) — equipTool에서 호출 ──
  async function setViewmodel(id){
    vmToolId=id;
    while(vmSwingG.children.length) vmSwingG.remove(vmSwingG.children[0]); vmModel=null;
    while(vmOff.children.length) vmOff.remove(vmOff.children[0]); vmOffModel=null;
    vmOff.position.set(0,0,0); vmOff.quaternion.identity(); vmOffSwing=false; curSwingM=null;   // 오프핸드 스윙 상태 초기화
    if(vmArrow){ vmArrow.parent&&vmArrow.parent.remove(vmArrow); vmArrow=null; } vmBowMorph=null; drawing=false; drawT=0;
    const cfg=LOADOUT[id]; if(!cfg||!cfg.url) return;
    const vm=VIEWMODEL[id]||VIEWMODEL._default;
    let g; try{ g=await _load(cfg.url); }catch(e){ return; }
    if(vmToolId!==id) return;   // 그새 교체됨
    const t=g.scene;
    t.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.renderOrder=950;
      if(cfg.kenney){ o.material=o.material.clone(); o.material.map=_colormap; o.material.color.set(0xffffff); o.material.needsUpdate=true; }
      else { const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>{ if(m&&m.map)m.map.colorSpace=THREE.SRGBColorSpace; }); } } });
    // 정규화: bbox 중심→원점 + 최대변=size. 모델은 swingG 안 원점(스윙은 vmRest 기준 회전).
    const bb=new THREE.Box3().setFromObject(t), c=bb.getCenter(new THREE.Vector3()), bs=new THREE.Vector3(); bb.getSize(bs);
    const maxd=Math.max(bs.x,bs.y,bs.z)||1; t.position.sub(c);
    const w=new THREE.Group(); w.add(t); w.userData.maxd=maxd; w.scale.setScalar((vm.size||0.5)/maxd); w.position.set(0,0,0); w.rotation.set(...vm.rot);
    vmSwingG.add(w); vmModel=w;
    vmRest.set(...vm.pos); vmSwingG.position.copy(vmRest); vmSwingG.quaternion.identity();
    curSwing = VM_SWINGS[cfg.swing] || VM_SWINGS.chop;   // 무기 클래스별 스윙
    // 활/석궁: 시위 Draw 모프 캡처 + 시위에 nocking 화살(카메라 공간 -z 앞으로)
    if(cfg.morph) w.traverse(o=>{ if(o.morphTargetInfluences&&o.morphTargetInfluences.length) vmBowMorph=o; });
    if(cfg.ranged){ const aUrl = cfg.ranged==='crossbow' ? KW+'arrow_crossbow.gltf' : KW+'arrow_bow.gltf';
      let ag; try{ ag=await _load(aUrl); }catch(e){}
      if(ag && vmToolId===id){ const at=ag.scene; at.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.renderOrder=951; const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>{ if(m&&m.map)m.map.colorSpace=THREE.SRGBColorSpace; }); } });
        const ab=new THREE.Box3().setFromObject(at), ac=ab.getCenter(new THREE.Vector3()), asz=new THREE.Vector3(); ab.getSize(asz); const amd=Math.max(asz.x,asz.y,asz.z)||1; at.position.sub(ac);
        const aw=new THREE.Group(); aw.add(at); aw.scale.setScalar(0.5/amd);
        aw.position.set(0.26,-0.10,-0.5); aw.lookAt(0.26,-0.10,-3);   // 카메라 앞(-z)으로 눕힘
        aw.userData.baseZ=-0.5; aw.visible=false; vmRig.add(aw); vmArrow=aw; } }
    // 오프핸드 — 방패(고정, 스윙X) 또는 쌍수 왼손무기(미러 스윙). cfg.vmOffhand 있으면 쌍수.
    if(cfg.offhand){ let og; try{ og=await _load(cfg.offhand); }catch(e){}
      if(og && vmToolId===id){ const ot=og.scene;
        ot.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; o.castShadow=false; o.renderOrder=950; const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>{ if(m&&m.map)m.map.colorSpace=THREE.SRGBColorSpace; }); } });
        const ob=new THREE.Box3().setFromObject(ot), oc=ob.getCenter(new THREE.Vector3()), os=new THREE.Vector3(); ob.getSize(os); const omd=Math.max(os.x,os.y,os.z)||1; ot.position.sub(oc);
        const VO=cfg.vmOffhand||VM_SHIELD;
        const ow=new THREE.Group(); ow.add(ot); ow.userData.maxd=omd; ow.scale.setScalar(VO.size/omd);
        if(cfg.vmOffhand){   // 쌍수: 모델 방향만 ow에, 휴식위치는 vmOff 그룹 → 미러 스윙
          ow.position.set(0,0,0); ow.rotation.set(...VO.rot);
          vmOffRest.set(...VO.pos); vmOff.position.copy(vmOffRest); vmOff.quaternion.identity();
          curSwingM=buildSwingMirror(curSwing); vmOffSwing=true;
        } else {   // 방패: 기존대로 ow에 위치+방향, vmOff 그룹 고정
          ow.position.set(...VO.pos); ow.rotation.set(...VO.rot);
        }
        vmOff.add(ow); vmOffModel=ow; } }
  }
  // 오프핸드(방패) 튜닝 훅
  window.__vmTuneOff=(px,py,pz,rx,ry,rz,size)=>{ if(!vmOffModel) return '없음'; vmOffModel.position.set(px,py,pz); vmOffModel.rotation.set(rx,ry,rz); if(size)vmOffModel.scale.setScalar(size/vmOffModel.userData.maxd); return 'ok'; };
  // 튜닝 훅 (pos=손 위치, rot=무기 각도, size=화면상 최대변 m)
  window.__vmTune=(px,py,pz,rx,ry,rz,size)=>{ if(!vmModel) return '없음'; vmRest.set(px,py,pz); vmSwingG.position.copy(vmRest); vmModel.rotation.set(rx,ry,rz); if(size)vmModel.scale.setScalar(size/vmModel.userData.maxd); return 'ok'; };
  window.__vmDump=()=>vmModel?({pos:vmRest.toArray().map(n=>+n.toFixed(3)),rot:[vmModel.rotation.x,vmModel.rotation.y,vmModel.rotation.z].map(n=>+n.toFixed(3)),size:+(vmModel.scale.x*vmModel.userData.maxd).toFixed(3)}):null;
  window.__vmInfo=()=>({ rigIdxInCam:camera.children.indexOf(vmRig), rigChildren:vmRig.children.length, swingChildren:vmSwingG.children.length, camChildren:camera.children.length });
  // 🛠️ 디버그 이동 — "막힌 곳 있음"을 확인/통과할 때. 이동 루프의 __noclipOn 분기가 실제 처리.
  //   __noclip()        노클립 켜기/끄기 (벽·바닥 전부 통과, 중력 없음. Space=위 · Shift=아래)
  //   __noclip(6)       속도 배율 지정하며 켜기
  //   __tp(x,y,z)       그 좌표로 순간이동
  //   __where()         현재 좌표(막힌 지점 보고용 — 이 값을 알려주시면 그 자리를 바로 잡습니다)
  window.__noclip=(spd)=>{ if(spd!=null) window.__noclipSpeed=+spd;
    window.__noclipOn=!window.__noclipOn;
    console.log('%c[noclip] '+(window.__noclipOn?'ON — 벽 통과·비행 (Space 위 / Shift 아래)':'OFF — 정상 충돌'),
      'font-weight:bold;color:'+(window.__noclipOn?'#8fe0f0':'#ffa0a0'));
    return window.__noclipOn; };
  window.__tp=(x,y,z)=>{ ctx.player.setSpawn(+x,+y,+z); return '이동 → '+[x,y,z].join(', '); };
  window.__where=()=>{ const p=ctx.player.pos; const o={ x:+p.x.toFixed(1), y:+p.y.toFixed(1), z:+p.z.toFixed(1) };
    console.log('현재 좌표', JSON.stringify(o)); return o; };
  // ★3인칭 손에 든 무기(오른손) 회전/위치 라이브 튜너 — 석궁 등 방향 맞출 때. 값 정해지면 LOADOUT.rot/pos에 반영.
  window.__heldTune=(rx,ry,rz,px,py,pz)=>{ const w=heldM.r||heldM.l; if(!w) return '든 무기 없음'; if(rx!=null)w.rotation.set(rx,ry,rz); if(px!=null)w.position.set(px,py,pz); return {tool:currentTool, rot:[w.rotation.x,w.rotation.y,w.rotation.z].map(n=>+n.toFixed(3)), pos:w.position.toArray().map(n=>+n.toFixed(3))}; };
  window.__heldDump=()=>{ const w=heldM.r||heldM.l; return w?{tool:currentTool,rot:[w.rotation.x,w.rotation.y,w.rotation.z].map(n=>+n.toFixed(3)),pos:w.position.toArray().map(n=>+n.toFixed(3))}:'없음'; };
  // ── 퀵슬롯: 손도구/무기 교체(LOADOUT 설정표) ──
  async function equipTool(id){
    currentTool=id;
    for(const k of ['r','l','arrow']){ if(heldM[k]){ heldM[k].parent&&heldM[k].parent.remove(heldM[k]); heldM[k]=null; } }
    bowMorph=null; useAction=null;
    const _rm=w=>{ if(w&&w.parent) w.parent.remove(w); };
    const cfg=LOADOUT[id]; if(cfg&&cfg.url&&slotR){
      const main=await _attach(cfg.url, cfg.slot, {scale:cfg.scale, pos:cfg.pos, rot:cfg.rot, kenney:cfg.kenney});
      if(currentTool!==id){ _rm(main&&main.w); return; }   // ★그새 다른 무기로 교체됨 → 늦게 온 것 제거(검+활 동시 버그 방지)
      if(main){ heldM[cfg.slot==='l'?'l':'r']=main.w;
        if(cfg.morph) main.t.traverse(o=>{ if(o.morphTargetInfluences&&o.morphTargetInfluences.length) bowMorph=o; }); }
      if(cfg.offhand){ const off=await _attach(cfg.offhand,'l',{pos:cfg.offhandPos}); if(currentTool!==id){ _rm(off&&off.w); return; } if(off) heldM.l=off.w; }
      if(cfg.arrow){ const ar=await _attach(cfg.arrow,'r',{}); if(currentTool!==id){ _rm(ar&&ar.w); return; } if(ar) heldM.arrow=ar.w; }
      if(cfg.anim){ let clip=clips.get(cfg.anim);
        if(clip){ if(cfg.cycle) clip=THREE.AnimationUtils.subclip(clip,'use_'+id,0,Math.round(clip.duration/2*30),30);
          useAction=mixer.clipAction(clip); useAction.setLoop(THREE.LoopOnce,1); useAction.clampWhenFinished=true; if(cfg.timeScale) useAction.timeScale=cfg.timeScale; } }
    }
    setViewmodel(id);   // 1인칭 viewmodel 동기화
    updHotbar();
  }
  // ── ⚔ 발도/납도 (V) — 무기 꺼내기↔넣기 수동 토글. 자동발도는 "적이 실제로 공격해올 때"(combat.hitPlayer)만. ──
  const _classChar=(typeof location!=='undefined'&&new URLSearchParams(location.search).get('char')||'').toLowerCase();
  const _combatWeapon=CLASS_WEAPON[_classChar]||'sword';        // 직업 전투무기(없으면 검)
  const _isCombatW=id=>{ const c=LOADOUT[id]; return !!(c&&(c.ranged||c.magic||(c.cls&&c.cls!=='unarmed'))); };   // 전투무기 = 원거리/마법/근접무기. ★빈손(cls:unarmed)·도구(cls없음) 제외.
  let _drawn=false;              // 무기 뽑은 상태 플래그
  let _toolSlot='none';          // 납도(도구모드) 시 드는 생산도구 — 핫바 선택으로 갱신
  const _weaponOut=()=>_drawn||_isCombatW(currentTool);         // 현재 무기 들고 있나(초기 직업무기 장착도 포함)
  function drawWeapon(){ if(_weaponOut()){ _drawn=true; return; } _toolSlot=currentTool; _drawn=true; equipTool(_combatWeapon); }   // 발도: 현재 도구 기억 → 무기로
  function sheatheWeapon(){ if(!_weaponOut()) return; _drawn=false; equipTool(_toolSlot||'none'); }                                  // 납도: 기억한 도구(없으면 빈손)로
  function toggleWeapon(){ _weaponOut()?sheatheWeapon():drawWeapon(); }
  function setAction(a){ if(!a||a===curAct||!mixer) return; if(curAct) curAct.fadeOut(0.18); a.reset().fadeIn(0.18).play(); curAct=a; }
  // ── ★검격 리본 트레일 샘플링(재제작 2026-07-02) — 3인칭 무기 본(slotR)에 붙은 칼날의 tip/hilt 월드좌표를
  //    스윙 중(공격모션) 매 프레임 hitfx로 push → hitfx가 실제 궤적을 리본 메시로 그림(크레센트/SDF 아님).
  //    ★칼축 판정 = heldM.r(무기 메시)의 bbox를 slotR 로컬프레임에서 산출 → 최장축=칼날 방향, 본 원점서 먼 끝=tip.
  //    (bbox·본상대 로컬프레임은 포즈 무관하게 일정 → 무기당 1회 계산 후 캐시.)
  const _m4b=new THREE.Matrix4(), _tmpDir=new THREE.Vector3();
  let _bladeCache=null, _bladeCacheTool=null;
  function _computeBladeEndpoints(){
    if(!slotR || !heldM.r) return null;
    slotR.updateWorldMatrix(true,false); heldM.r.updateWorldMatrix(true,true);
    const inv=_m4b.copy(slotR.matrixWorld).invert();   // 월드 → slotR 로컬
    const box=new THREE.Box3(); box.makeEmpty(); const v=new THREE.Vector3();
    heldM.r.traverse(o=>{ if(o.isMesh && o.geometry){
      if(!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const bb=o.geometry.boundingBox; if(!bb) return;
      for(let xi=0;xi<2;xi++)for(let yi=0;yi<2;yi++)for(let zi=0;zi<2;zi++){   // 8코너 → 월드 → slotR로컬 → 확장
        v.set(xi?bb.max.x:bb.min.x, yi?bb.max.y:bb.min.y, zi?bb.max.z:bb.min.z);
        v.applyMatrix4(o.matrixWorld).applyMatrix4(inv); box.expandByPoint(v); } } });
    if(box.isEmpty()) return null;
    const size=box.getSize(new THREE.Vector3()), c=box.getCenter(new THREE.Vector3());
    let ax='y'; if(size.x>=size.y && size.x>=size.z) ax='x'; else if(size.z>=size.x && size.z>=size.y) ax='z';   // 최장축=칼날
    const half=size[ax]*0.5; const hilt=c.clone(), tip=c.clone(); hilt[ax]=c[ax]-half; tip[ax]=c[ax]+half;
    if(hilt.lengthSq()>tip.lengthSq()){ const t=hilt.clone(); hilt.copy(tip); tip.copy(t); }   // 손(본 원점)서 먼 끝=칼끝
    return { hilt, tip };
  }
  function _sampleBlade(){
    if(_bladeCacheTool!==currentTool){ _bladeCache=_computeBladeEndpoints(); _bladeCacheTool=currentTool; }   // 무기 바뀌면 재계산
    if(!_bladeCache || !slotR) return;
    slotR.updateWorldMatrix(true,false);   // mixer.update 직후 → 본 최신 포즈
    const wh=_bladeCache.hilt.clone().applyMatrix4(slotR.matrixWorld);   // 월드 밑동
    const wt=_bladeCache.tip.clone().applyMatrix4(slotR.matrixWorld);    // 월드 칼끝
    const S=BAL.feel.slash; _tmpDir.subVectors(wt,wh); const l=_tmpDir.length()||1; _tmpDir.multiplyScalar(1/l);
    wt.addScaledVector(_tmpDir, (S.tipLen||0));   // 칼끝 살짝 연장(아크 크게/볼드)
    ctx.hitfx?.bladeSample?.(wh, wt);
  }
  // ── 피격/사망 애니 (combat.js가 호출) ──
  function playHit(){ if(!mixer||_dead) return;
    if(performance.now() < _atkAnimUntil) return;   // ★공격 모션 중엔 플린치로 안 끊김(공격 끝까지 진행)
    const c=clips.get('Hit_A')||clips.get('Hit_B'); if(!c) return;   // 짧은 플린치 → 곧 이동/대기 복귀
    const a=mixer.clipAction(c); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=false; a.timeScale=1.5;
    if(curAct&&curAct!==a) curAct.fadeOut(0.06); a.reset().fadeIn(0.05).play(); curAct=a;
    _useUntil=performance.now()+(c.duration/1.5)*1000*0.7; }
  function playDeath(){ if(!mixer) return; _dead=true; const c=clips.get('Death_A')||clips.get('Death_B'); if(!c) return;   // 쓰러진 자세 유지(부활까지)
    const a=mixer.clipAction(c); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true;
    if(curAct&&curAct!==a) curAct.fadeOut(0.12); a.reset().fadeIn(0.12).play(); curAct=a;
    _useUntil=performance.now()+6e5; }
  function reviveAnim(){ _dead=false; _useUntil=0; if(actIdle) setAction(actIdle); }   // 부활 → 이동/대기 복귀
  // ── 우클릭(3인칭) = 무기별 특수 액션. 활/석궁=조준(홀드) · 검방패=가드(홀드) · 양손=스핀 · 단검=투명 · 지팡이=아이스볼트. 특수는 쿨다운. ──
  const _rcd = {};                  // 우클릭 액션별 쿨다운 끝시각
  let _guarding=false, _stealthUntil=0, _blockHitUntil=0, _mageSpell='fire';   // _mageSpell=현재 선택 마법(Q로 fire↔ice 전환, 좌클릭 시전)
  let _windMode=false, _windCdUntil=0;   // ★레인저 Q 바람모드(활성 중 발사=유도 바람화살 다발). _windCdUntil=발사 후 5초 쿨다운 종료시각
  // ═══ 바람 오라 = Curl-Noise 유동장(divergence-free, Bridson 2007)으로 공기 위습을 몸 주위에 흘려 난류로 휘감아 상승시키고,
  //     각 궤적을 카메라 향하는 리본 트레일로 렌더 + 리본 길이방향 흐름 노이즈. (파티클/블레이드/원통 재탕 아님) ═══
  const _WISPS=16, _PTS=22;   // 위습 수 · 위습당 트레일 점 수
  let _windGrp=null, _wisps=[], _windT=0;
  // ── JS 3D value noise → 벡터 포텐셜의 curl로 divergence-free 유동장 ──
  const _fr=(n)=>{ n=(n<<13)^n; return 1.0-((n*(n*n*15731+789221)+1376312589)&0x7fffffff)/1073741824.0; };
  function _vn3(x,y,z){ const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z), xf=x-xi,yf=y-yi,zf=z-zi;
    const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
    const h=(a,b,c)=>_fr((xi+a)*374761+(yi+b)*668265+(zi+c)*1274126|0);
    const lx=(a,b,t)=>a+(b-a)*t;
    const y0=lx(lx(h(0,0,0),h(1,0,0),u),lx(h(0,1,0),h(1,1,0),u),v);
    const y1=lx(lx(h(0,0,1),h(1,0,1),u),lx(h(0,1,1),h(1,1,1),u),v);
    return lx(y0,y1,w); }
  const _pA=(x,y,z)=>_vn3(x,y,z), _pB=(x,y,z)=>_vn3(x+31.4,y-19.1,z+7.7), _pC=(x,y,z)=>_vn3(x-8.2,y+53.3,z-27.5);
  function _curl3(x,y,z,out){ const e=0.4, k=1/(2*e);   // 벡터 포텐셜 Ψ=(pA,pB,pC), v=∇×Ψ (유한차분)
    const dCdy=(_pC(x,y+e,z)-_pC(x,y-e,z))*k, dBdz=(_pB(x,y,z+e)-_pB(x,y,z-e))*k;
    const dAdz=(_pA(x,y,z+e)-_pA(x,y,z-e))*k, dCdx=(_pC(x+e,y,z)-_pC(x-e,y,z))*k;
    const dBdx=(_pB(x+e,y,z)-_pB(x-e,y,z))*k, dAdy=(_pA(x,y+e,z)-_pA(x,y-e,z))*k;
    out.set(dCdy-dBdz, dAdz-dCdx, dBdx-dAdy); }
  // 리본 셰이더 — 길이방향 스크롤 노이즈(흐르는 공기 결) + 폭 페이드 + 꼬리/머리 페이드
  const _RIB_FRAG=[
    'precision highp float; varying vec2 vUv; uniform float uT; uniform float uFade;',
    'float h1(float n){ return fract(sin(n)*43758.5453); }',
    'float n1(float x){ float i=floor(x),f=fract(x); return mix(h1(i),h1(i+1.0),f*f*(3.0-2.0*f)); }',
    'void main(){ float t=vUv.x;',                                          // t: 0=머리(최신) .. 1=꼬리
    '  float edge=smoothstep(0.0,0.5,vUv.y)*smoothstep(1.0,0.5,vUv.y);',    // 리본 폭 소프트 엣지
    '  float flow=0.4+0.75*n1(t*10.0 - uT*3.2);',                          // 길이 따라 흐르는 결
    '  float head=smoothstep(0.0,0.08,t);',                                // 머리 살짝 페이드
    '  float tail=smoothstep(1.0,0.55,t);',                                // 꼬리 소멸
    '  float a=edge*flow*head*tail*uFade;',
    '  if(a<0.004) discard;',
    '  vec3 col=mix(vec3(0.45,0.88,1.0), vec3(0.96,1.0,0.99), flow*0.7);',  // 청록 → 흰빛 심
    '  gl_FragColor=vec4(col, a); }'].join('\n');
  const _RIB_VERT='varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  const _wV=new THREE.Vector3(), _wVel=new THREE.Vector3(), _wTan=new THREE.Vector3(), _wSide=new THREE.Vector3(), _wView=new THREE.Vector3(), _camW=new THREE.Vector3();
  function _spawnWisp(w){ const a=Math.random()*6.283, r=0.44+Math.random()*0.4;   // 몸 주위 랜덤 각/반경(넓게, 바깥쪽 포함)/높이에서 발생
    w.hx=Math.cos(a)*r; w.hz=Math.sin(a)*r; w.hy=0.1+Math.random()*0.5; w.seed=Math.random()*40;
    for(let i=0;i<_PTS;i++){ const p=w.trail[i]; p.x=w.hx; p.y=w.hy; p.z=w.hz; } w.fade=0; }
  function windAura(on){
    if(on){
      if(_windGrp || typeof THREE==='undefined' || !ctx.scene) return;
      _windGrp=new THREE.Group(); ctx.scene.add(_windGrp); _wisps=[];
      // 트라이앵글 스트립 인덱스(공용) — (2i,2i+1,2i+2)+(2i+1,2i+3,2i+2)
      const idx=[]; for(let i=0;i<_PTS-1;i++){ const b=i*2; idx.push(b,b+1,b+2, b+1,b+3,b+2); }
      for(let k=0;k<_WISPS;k++){
        const trail=[]; for(let i=0;i<_PTS;i++) trail.push({x:0,y:0,z:0});
        const geo=new THREE.BufferGeometry();
        const pos=new Float32Array(_PTS*2*3), uv=new Float32Array(_PTS*2*2);
        for(let i=0;i<_PTS;i++){ const t=i/(_PTS-1); uv[(i*2)*2]=t; uv[(i*2)*2+1]=0; uv[(i*2+1)*2]=t; uv[(i*2+1)*2+1]=1; }
        geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv,2));
        geo.setIndex(idx);
        const mat=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
          uniforms:{ uT:{value:0}, uFade:{value:0} }, vertexShader:_RIB_VERT, fragmentShader:_RIB_FRAG });
        const mesh=new THREE.Mesh(geo, mat); mesh.frustumCulled=false; _windGrp.add(mesh);
        const w={ trail, geo, pos, mesh, mat, hx:0,hy:0,hz:0, seed:0, fade:0 }; _spawnWisp(w); _wisps.push(w);
      }
    } else if(_windGrp){
      ctx.scene.remove(_windGrp);
      _windGrp.traverse(o=>{ if(o.geometry)o.geometry.dispose&&o.geometry.dispose(); if(o.material)o.material.dispose&&o.material.dispose(); });
      _windGrp=null; _wisps=[];
    }
  }
  function _updateWindAura(dt){
    if(!_windGrp||!avatar) return; _windT+=dt;
    _windGrp.position.set(avatar.position.x, avatar.position.y-1.02, avatar.position.z);
    (ctx.camera||camera).getWorldPosition(_camW);
    const step=Math.min(0.05,dt), F=1.05, T=_windT*0.6;
    for(const w of _wisps){
      // 1) 헤드를 curl 유동장으로 전진 + 휘감김(접선) + 상승 + 반경 스프링(몸 근처 유지)
      _curl3(w.hx*F+w.seed, w.hy*F+T, w.hz*F, _wVel);
      const r=Math.hypot(w.hx,w.hz)||1e-3;
      const rt=0.62*(1.0-Math.max(0,Math.min(0.55,(w.hy-1.7)/2.2)));   // ★목표반경 넓게 유지(바깥쪽), 머리 위(1.7m+)에서만 완만히 조임(깔때기)
      const swirl=1.3+Math.max(0,(w.hy-1.6))*0.75;                      // 위로 갈수록 회전 가속(조여드는 볼텍스)
      _wVel.x += (-w.hz/r)*swirl + (w.hx/r)*(rt-r)*2.2;
      _wVel.z += ( w.hx/r)*swirl + (w.hz/r)*(rt-r)*2.2;
      _wVel.y += 1.75 + Math.max(0,(w.hy-1.4))*0.7;                     // ★상승 강화 → 머리 위까지 확실히 올라감
      _wVel.multiplyScalar(1.35);
      w.hx += _wVel.x*step; w.hy += _wVel.y*step; w.hz += _wVel.z*step;
      if(w.hy>3.3 || Math.hypot(w.hx,w.hz)>1.55){ _spawnWisp(w); }   // 머리 한참 위(3.3m)까지 올라간 뒤 재생
      // 2) 트레일 시프트(꼬리→머리로 값 밀기) 후 헤드 삽입
      const tr=w.trail; for(let i=_PTS-1;i>0;i--){ const a=tr[i],b=tr[i-1]; a.x=b.x; a.y=b.y; a.z=b.z; }
      tr[0].x=w.hx; tr[0].y=w.hy; tr[0].z=w.hz;
      // 3) 리본 지오메트리 재구성(카메라 향) — 각 점 접선⊥시선 방향으로 폭 확장, 꼬리로 갈수록 얇게
      const pos=w.pos, gx=_windGrp.position;
      for(let i=0;i<_PTS;i++){ const p=tr[i], a=tr[Math.max(0,i-1)], b=tr[Math.min(_PTS-1,i+1)];
        _wTan.set(b.x-a.x,b.y-a.y,b.z-a.z); if(_wTan.lengthSq()<1e-8)_wTan.set(0,1,0); _wTan.normalize();
        _wView.set(_camW.x-(gx.x+p.x), _camW.y-(gx.y+p.y), _camW.z-(gx.z+p.z)).normalize();
        _wSide.crossVectors(_wTan,_wView); if(_wSide.lengthSq()<1e-8)_wSide.set(1,0,0); _wSide.normalize();
        const t=i/(_PTS-1), wd=0.085*(1.0-t)*(0.4+0.6*Math.sin(Math.min(1,t*3.0)*1.5708));   // 머리~중간 굵고 꼬리 0
        const o=i*6; pos[o]=p.x+_wSide.x*wd; pos[o+1]=p.y+_wSide.y*wd; pos[o+2]=p.z+_wSide.z*wd;
        pos[o+3]=p.x-_wSide.x*wd; pos[o+4]=p.y-_wSide.y*wd; pos[o+5]=p.z-_wSide.z*wd; }
      w.geo.attributes.position.needsUpdate=true; w.geo.computeBoundingSphere();
      w.mat.uniforms.uT.value=_windT; w.fade=Math.min(1,w.fade+dt*2.6); w.mat.uniforms.uFade.value=w.fade;
    }
  }
  function rcdOK(key, ms){ const now=performance.now(); if(now<(_rcd[key]||0)) return false; _rcd[key]=now+ms; return true; }
  function actOf(name){ const c=clips&&clips.get(name); return c?mixer.clipAction(c):null; }
  function playOnce(a, fade=0.07){ if(!a) return 0; a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=false; if(curAct&&curAct!==a)curAct.fadeOut(fade); a.reset().fadeIn(fade).play(); curAct=a; const d=a.getClip().duration*1000; _useUntil=performance.now()+d*0.9; return d; }
  function useRight(down){
    if((ctx.ship && ctx.ship.boarded) || ctx.noPointerLock) return;   // ⚓ 조타 중 / 컷신 중엔 무기 특수·스킬 금지
    // ★1·3인칭 모두 무기별 특수 동작 작동(조준 줌인 카메라만 3인칭 한정 — onUpdate에서 처리).
    const cfg=LOADOUT[currentTool]; if(!cfg) return;
    if(cfg.ranged){ if(down){ _aiming=!_aiming; showXhair(_aiming); if(_aiming) ctx.sound?.play?.('ranger_aim'); } return; }   // ★활 = 조준 토글(RMB 탁=ON/OFF) + 조준 진입음(레인저 특수)
    if(cfg.cls==='dualwield'){ if(down) stealth(); return; }             // ★로그(쌍수) = 은신 — offhand 있어도 가드 아님(먼저 체크)
    if(cfg.offhand){ if(down) guardStart(); else guardEnd(); return; }    // 전사(검+방패) = 가드(홀드)
    if(!down) return;                                                     // 아래는 누름 순간(쿨다운)
    if(cfg.magic){ const ok=ctx.magic?.castSpell?.(_mageSpell);   // ★마법사 우클릭 = 강스킬(현재 속성). 속성전환은 Q.
      if(ok&&useAction){ const now=performance.now(); if(curAct&&curAct!==useAction)curAct.fadeOut(0.08); useAction.reset().setEffectiveWeight(1).fadeIn(0.05).play(); curAct=useAction; _useUntil=now+(useAction.getClip().duration*1000*0.9+100); } return; }
    if(cfg.cls==='2h'){ spinAttack(); return; }                          // 양손검·도끼 = 스핀
    if(currentTool==='dagger'){ stealth(); return; }                     // 도적(단검) = 은신(투명)
    if(currentTool==='none'){ headbutt(); return; }                      // 맨손 = 박치기(헤드번트 클립 없어 강펀치로 대용)
  }
  function kickStun(){ if(_dead) return; if(!rcdOK('kick',1400)) return;
    ctx.sound?.play?.('sword_attack');
    playOnce(actOf('Melee_Unarmed_Attack_Kick')||useAction, 0.05);
    setTimeout(()=>{ ctx.combat?.meleeHit?.(BAL.skills.kick); ctx.combat?.stunNearest?.(BAL.skills.kickStun); }, 170); }   // 킥 명중 + 스턴 ★C(2026-07-15): 8/2000 → BAL.skills
  function headbutt(){ if(_dead) return; if(!rcdOK('headbutt',1100)) return;
    ctx.sound?.play?.('sword_attack');
    playOnce(actOf('Melee_Unarmed_Attack_Punch_A')||useAction, 0.05);
    setTimeout(()=>ctx.combat?.meleeHit?.(BAL.skills.headbutt), 150); }                   // 강한 일격 ★C: 10 → BAL.skills.headbutt
  function playBlockPose(){ const a=actOf('Melee_Blocking')||actOf('Melee_Block'); if(a){ a.setLoop(THREE.LoopRepeat,Infinity); a.clampWhenFinished=false; if(curAct&&curAct!==a)curAct.fadeOut(0.12); a.reset().fadeIn(0.12).play(); curAct=a; _useUntil=performance.now()+6e5; } }
  function guardStart(){ if(_dead||_guarding) return; _guarding=true; playBlockPose(); }
  function guardEnd(){ if(!_guarding) return; _guarding=false; _useUntil=0; if(actIdle) setAction(actIdle); }
  // ★가드 중 피격 = Melee_Block_Hit 반응 후 다시 막기 자세
  function playBlockHit(){ if(!mixer||_dead||!_guarding) return; const c=clips.get('Melee_Block_Hit'); if(!c){ return; }
    const a=mixer.clipAction(c); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=false; a.timeScale=1.3;
    if(curAct&&curAct!==a)curAct.fadeOut(0.05); a.reset().fadeIn(0.04).play(); curAct=a;
    _blockHitUntil=performance.now()+c.duration/1.3*1000;   // 이 시각까지 Block_Hit 재생(게이트가 안 덮음) → 후엔 막기자세 복귀(게이트)
  }
  function spinAttack(){ if(_dead) return; if(!rcdOK('spin',BAL.skills.spinCd)) return;   // ★C(2026-07-15): 쿨 4000 → BAL.skills.spinCd
    ctx.sound?.play?.('sword_attack');
    const DUR=3000, HITS=BAL.skills.spinHits;   // ★C: 타수 7 → BAL.skills.spinHits(인터벌 divisor도 동일 사용=타이밍 정합)
    // ★휠윈드: Melee_2H_Attack_Spinning(이름이 Spinning인 클립) 반복.
    const a=actOf('Melee_2H_Attack_Spinning');
    if(a){ a.setLoop(THREE.LoopRepeat,Infinity); a.timeScale=1.6; if(curAct&&curAct!==a)curAct.fadeOut(0.06); a.reset().setEffectiveWeight(1).fadeIn(0.05).play(); curAct=a; }
    _useUntil=performance.now()+DUR;
    // 3초간 반복 360° 타격(약 7회) + 회전 내내 휙휙 사운드(휠윈드)
    let n=0; const iv=setInterval(()=>{ if(_dead||n++>=HITS){ clearInterval(iv); return; } ctx.combat?.spinHit?.(BAL.skills.spinHit); ctx.sound?.play?.('sword_attack',{vol:0.4}); }, DUR/HITS);   // ★C: 타격 11·타수 → BAL.skills
    windVFX(DUR); }
  // ★휠윈드 바람 = 토네이도형 소용돌이 파티클(three.js Points) — 깔때기 모양으로 나선 상승·회전, additive 청백색.
  let _windTex=null;
  function _softTex(){ if(_windTex) return _windTex; const cv=document.createElement('canvas'); cv.width=cv.height=48; const c=cv.getContext('2d');
    const g=c.createRadialGradient(24,24,0,24,24,24); g.addColorStop(0,'rgba(225,242,255,1)'); g.addColorStop(0.4,'rgba(190,225,255,0.6)'); g.addColorStop(1,'rgba(190,225,255,0)');
    c.fillStyle=g; c.beginPath(); c.arc(24,24,24,0,7); c.fill(); _windTex=new THREE.CanvasTexture(cv); return _windTex; }
  // 블레이드 크레센트 지오메트리 — 반경 r 둘레로 arcSpan(rad)만큼 휘어진 칼날 잔상. 꼬리=얇고 선단=두꺼운 초승달. u=꼬리0→선단1, v=폭(안0→밖1).
  function _bladeArcGeo(r, halfW, arcSpan, segs){
    const pos=new Float32Array((segs+1)*2*3), uv=new Float32Array((segs+1)*2*2); const idx=[];
    for(let i=0;i<=segs;i++){ const t=i/segs, a=-arcSpan*0.5+arcSpan*t, ca=Math.cos(a), sa=Math.sin(a), k=i*2;
      const w=halfW*(0.10+0.90*t), ri=r-w, ro=r+w;             // 꼬리로 갈수록 가늘어짐(초승달 칼날)
      pos[k*3]=ca*ri; pos[k*3+1]=0; pos[k*3+2]=sa*ri;             uv[k*2]=t; uv[k*2+1]=0;
      pos[(k+1)*3]=ca*ro; pos[(k+1)*3+1]=0; pos[(k+1)*3+2]=sa*ro; uv[(k+1)*2]=t; uv[(k+1)*2+1]=1; }
    for(let i=0;i<segs;i++){ const k=i*2; idx.push(k,k+1,k+2, k+1,k+3,k+2); }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.BufferAttribute(uv,2)); g.setIndex(idx); return g; }
  // ★휠윈드 재작성(2026-07-02, ref/휠윈드.gif) = 쿨 화이트-블루 빛 리본 사이클론. 강철 크레센트/바닥링/칼날파편 전부 폐기.
  //   다층 나선 아크 리본(comet-tail 흐름 셰이더) 배럴 + 얼음 크리스탈 소수 + 살짝 상승 호흡. 경량 sin 흐름(fbm 없음), Points 없음. done+안전타임아웃 잔류0.
  function windVFX(dur){ if(typeof THREE==='undefined'||!avatar||!ctx.scene) return;
    const grp=new THREE.Group(); ctx.scene.add(grp); let done=false; const trash=[];
    const cleanup=()=>{ if(done) return; done=true; ctx.scene.remove(grp); trash.forEach(f=>{ try{ f(); }catch(_){} }); };
    // 빛 리본 셰이더 — vU.x=길이(0꼬리→1선단), vU.y=폭. 길이방향 흐름(빛 결) + comet 선단 + 꼬리 페이드. 청→흰 코어.
    const ribMat=(seed)=>new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      uniforms:{ uA:{value:0}, uT:{value:0}, uSeed:{value:seed} },
      vertexShader:'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:[
        'varying vec2 vU; uniform float uA,uT,uSeed;',
        'void main(){',
        '  float head=smoothstep(0.5,1.0,vU.x);',                             // 선단(밝은 코어)
        '  float tail=smoothstep(0.0,0.55,vU.x);',                           // 꼬리 페이드
        '  float wid=smoothstep(0.0,0.34,vU.y)*smoothstep(1.0,0.66,vU.y);',  // 폭 소프트 엣지
        '  float flow=0.62+0.38*sin(vU.x*20.0 - uT*12.0 + uSeed*6.283);',    // 길이방향 흐름(빛 결)
        '  float al=(tail*0.7+head*3.2)*wid*flow*uA;',                        // ★밀도·밝기 강화(레퍼=빽빽한 백열 토네이도)
        '  vec3 col=mix(vec3(0.45,0.74,1.0), vec3(1.0,1.0,1.0), head*head);', // 청 → 순백 코어
        '  if(al<0.004) discard; gl_FragColor=vec4(col, al);',
        '}'].join('\n') });
    // ① 배럴형 다층 나선 리본 — 높이별 반경(중간 넓고 상하 좁은 배럴) + 방향 교대 고속 회전. 긴 아크(span>π)로 감기는 나선.
    const ribs=[]; const NR=30;                                             // ★빽빽하게(레퍼=수십 겹 오버랩)
    for(let i=0;i<NR;i++){ const hf=(i%15)/14; const y=0.1+hf*2.25;          // 15겹×2세트 = 높이별 중첩
      const bar=0.5+0.5*Math.sin(hf*Math.PI);                               // 배럴 프로파일(상하 좁고 중간 넓음)
      const r=(1.35+0.75*bar)+(Math.random()-0.5)*0.28;
      const span=4.2+Math.random()*3.4;                                     // 한바퀴 이상 감기는 긴 나선
      const hw=0.11+Math.random()*0.12, spd=(18+Math.random()*13)*(i%2?-1:1), tilt=(Math.random()-0.5)*0.34;
      const m=ribMat(Math.random()); const mesh=new THREE.Mesh(_bladeArcGeo(r,hw,span,60), m);
      const pg=new THREE.Group(); pg.position.y=y; pg.rotation.y=Math.random()*6.283; pg.rotation.x=tilt; pg.add(mesh); grp.add(pg);
      ribs.push({pg,m,spd}); trash.push(()=>{ mesh.geometry.dispose(); m.dispose(); }); }
    // ② 얼음 크리스탈 소수 — 소용돌이에 섞여 궤도 회전 + 자전. 쿨 발광(additive).
    const icoGeo=new THREE.IcosahedronGeometry(0.07,0), icoMat=new THREE.MeshBasicMaterial({color:0xd4eeff, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false});
    const crystals=[];
    for(let i=0;i<10;i++){ const m=new THREE.Mesh(icoGeo,icoMat); m.scale.setScalar(0.5+Math.random()*0.7); grp.add(m);
      crystals.push({m, a:Math.random()*6.283, r:1.4+Math.random()*0.8, y:0.4+Math.random()*1.9, spd:(2.6+Math.random()*2.0)*(i%2?-1:1), rx:(Math.random()-0.5)*9, rz:(Math.random()-0.5)*9}); }
    trash.push(()=>{ icoGeo.dispose(); icoMat.dispose(); });
    const start=performance.now(); let last=start;
    const step=()=>{ if(done) return; const now=performance.now(); const dt=Math.min(0.05,(now-last)/1000); last=now; const t=(now-start)/dur, tS=(now-start)/1000;
      if(t>=1){ cleanup(); return; }
      const fade = t<0.08 ? t/0.08 : (t>0.85 ? (1-t)/0.15 : 1);              // 페이드 인/아웃
      const risY = Math.sin(t*Math.PI)*0.35;                                 // 살짝 상승 후 하강(토네이도 호흡)
      for(const b of ribs){ b.pg.rotation.y+=b.spd*dt; b.m.uniforms.uA.value=fade; b.m.uniforms.uT.value=tS; }
      for(const c of crystals){ c.a+=c.spd*dt; c.m.position.set(Math.cos(c.a)*c.r, c.y+risY, Math.sin(c.a)*c.r); c.m.rotation.x+=c.rx*dt; c.m.rotation.z+=c.rz*dt; }
      icoMat.opacity=0.9*fade;
      grp.position.set(avatar.position.x, avatar.position.y+risY*0.4, avatar.position.z);
      requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(cleanup, dur+400);   // ★안전 타임아웃 — rAF 정지 시에도 잔류 0
  }
  // ★기사 궁극기 = 방패 내려치기(Melee_Block_Attack) + 충격파 링 + AoE(combat.shieldSlam). 가드게이지 가득일 때만 Q.
  function shieldSlamMove(){ if(_dead) return; if(!ctx.combat?.guardReady) return;
    ctx.sound?.play?.('shockwave');   // ★사령관 지정 "충격파" 음성 (기존 sword_attack 교체)
    const a=actOf('Melee_Block_Attack'); if(a) playOnce(a,0.06);
    if(third){ faceYaw=Math.atan2(Math.sin(yaw),-Math.cos(yaw)); _faceLockUntil=performance.now()+650; }
    setTimeout(()=>{ ctx.combat?.shieldSlam?.(); shockwaveVFX(); }, 320); }   // 임팩트 시점에 광역타격 + 충격파 VFX (풀스크린 왜곡 제거 — 프레임드랍 해결)
  // (shockwaveDistort 제거 2026-07-02 — 풀스크린 이중렌더 = 프레임드랍 주범 + 렌더오버라이드 백업/복원이 흰색 잔상 원인. 충격파 VFX는 shockwaveVFX 단독, 풀스크린 패스 없음.)
  // ★충격파 VFX — 레퍼런스 ref/화면/충격파1~3(웜골드 지면강타 폭발) 재현. 전부 커스텀 GLSL(fbm 난류·보로노이 균열·유동 셰이더) + 실제 파편 mesh.
  //   Points/PointsMaterial/gradient-스프라이트 일절 없음(OP_09 뻔한효과 금지). 풀스크린 패스 없음. done 플래그 + 안전 타임아웃으로 잔류 0 보장.
  //   ⚠️ prewarm=true → 메시만 만들어 renderer.compile로 셰이더 컴파일(6프로그램)한 뒤 즉시 정리. 첫 시전 컴파일 히칫(=프레임드랍)을 로드 시점으로 이동.
  function shockwaveVFX(prewarm){ if(typeof THREE==='undefined'||!avatar||!ctx.scene) return;
    const ox=avatar.position.x, oy=avatar.position.y+0.04, oz=avatar.position.z;
    const DUR=920, S=ctx.scene, cam=ctx.camera; const trash=[]; let done=false;
    const cleanup=()=>{ if(done) return; done=true; trash.forEach(f=>{ try{ f(); }catch(_){} }); };
    // 공용 GLSL 헤더 — value noise + fbm(난류 연기·균열 왜곡용)
    const NOISE = [
      'float h21(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }',
      'vec2 h22(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }',
      'float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);',
      '  float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }',
      'float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; } return s; }'].join('\n');
    const GV='varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';

    // ── ① 저공 난류 연기 스윕(fbm 셰이더·돔 대체) — 중심서 바깥으로 낮게 휩쓸리는 금빛 난류 연기. 다크앰버→골드. ──
    const smokeMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0},uT:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;',
        'uniform float uP,uT;',
        'void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p); float ang=atan(p.y,p.x);',
        '  vec2 q=vec2(ang*1.7, r*3.2 - uT*1.3);',                            // 각도-반경 좌표를 바깥으로 흘림
        '  float n=fbm(q + vec2(fbm(q*0.5+uT*0.2),0.0));',                    // 도메인 워핑 난류
        '  float ann=smoothstep(uP*1.12+0.18, uP*1.12-0.4, r)*smoothstep(0.02,0.28,r);', // 확장하는 도넛(가운데 뚫림)
        '  float smoke=pow(max(n,0.0),1.7)*ann;',
        '  float fade=1.0-smoothstep(0.35,1.0,uP);',
        '  float al=smoke*fade*1.15; if(r>1.0) al=0.0;',
        '  vec3 col=mix(vec3(0.55,0.30,0.09), vec3(1.0,0.80,0.40), pow(n,1.3));', // 그을린 앰버 → 밝은 금빛
        '  gl_FragColor=vec4(col*al, al);',
        '}'].join('\n') });
    const smoke=new THREE.Mesh(new THREE.PlaneGeometry(17,17), smokeMat); smoke.rotation.x=-Math.PI/2; smoke.position.set(ox,oy+0.015,oz); S.add(smoke);
    trash.push(()=>{ S.remove(smoke); smoke.geometry.dispose(); smokeMat.dispose(); });

    // ── ② 지면 보로노이 균열망 — 중심서 바깥으로 번지는 발광 균열. 확장 선단은 흰-금 핫, 안쪽은 골드로 식음. ──
    const crackMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;',
        'uniform float uP;',
        'void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p);',
        '  vec2 gp=p*4.5; vec2 g=floor(gp), f=fract(gp);',
        '  float d1=9.0,d2=9.0;',
        '  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 o=vec2(float(x),float(y)); vec2 pt=o+h22(g+o)-f; float d=dot(pt,pt); if(d<d1){d2=d1;d1=d;} else if(d<d2){d2=d;} }',
        '  float edge=sqrt(d2)-sqrt(d1);',                                    // 셀 경계 ~0 = 균열선
        '  float cr=smoothstep(0.14,0.0,edge);',
        '  float front=uP*1.1;',
        '  float reveal=smoothstep(front,front-0.22,r);',                    // 균열이 선단까지만 드러남(번짐)
        '  float hot=smoothstep(0.32,0.0,abs(r-front));',                    // 확장 선단이 가장 뜨거움
        '  float fade=1.0-smoothstep(0.5,1.0,uP);',
        '  float al=cr*reveal*fade*(0.55+hot*1.5); if(r>1.0) al=0.0;',
        '  vec3 col=mix(vec3(0.95,0.62,0.20), vec3(1.0,0.97,0.88), hot);',
        '  gl_FragColor=vec4(col*al, al);',
        '}'].join('\n') });
    const crack=new THREE.Mesh(new THREE.PlaneGeometry(15,15), crackMat); crack.rotation.x=-Math.PI/2; crack.position.set(ox,oy+0.03,oz); S.add(crack);
    trash.push(()=>{ S.remove(crack); crack.geometry.dispose(); crackMat.dispose(); });

    // ── ③ 지면 난류 링 — 빠르게 확장하는 웜골드 충격 선단(1차 임팩트). ──
    const ringMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;',
        'uniform float uP;',
        'void main(){',
        '  vec2 p=vU-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x);',
        '  float wob=0.045*sin(a*12.0+uP*5.0)+0.028*sin(a*23.0-uP*3.0);',
        '  float R=0.05+uP*1.15+wob; float dist=abs(r-R);',
        '  float edge=smoothstep(0.05,0.0,dist);',
        '  float band=smoothstep(0.22,0.0,dist);',
        '  float fade=1.0-smoothstep(0.5,1.0,uP);',
        '  float al=(edge*1.5+band*0.42)*fade; if(r>1.3) al=0.0;',
        '  vec3 col=mix(vec3(0.98,0.70,0.26), vec3(1.0,0.98,0.90), edge);',
        '  gl_FragColor=vec4(col,al);',
        '}'].join('\n') });
    const ring=new THREE.Mesh(new THREE.PlaneGeometry(13,13), ringMat); ring.rotation.x=-Math.PI/2; ring.position.set(ox,oy+0.045,oz); S.add(ring);
    trash.push(()=>{ S.remove(ring); ring.geometry.dispose(); ringMat.dispose(); });

    // ── ④ 세로 광선 기둥 — 발밑서 솟구치는 화염/광선 컬럼. 교차 2평면 = 전방향 부피감. fbm 플리커 + 상단 페이드. ──
    const pillarMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0},uT:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;',
        'uniform float uP,uT;',
        'void main(){',
        '  float x=abs(vU.x-0.5)*2.0; float y=vU.y;',
        '  float flick=fbm(vec2(x*3.0, y*7.0-uT*4.5));',                     // 세로로 흐르는 난류(불꽃 흔들림)
        '  float core=smoothstep(1.0,0.0, x + flick*0.35*y);',              // 위로 갈수록 흔들리며 가늘어짐
        '  float taper=smoothstep(1.0,0.12,y)*smoothstep(0.0,0.06,y);',
        '  float rise=smoothstep(0.0,0.12,uP)*(1.0-smoothstep(0.42,0.9,uP));',
        '  float al=core*taper*(0.55+flick*0.6)*rise*1.2;',
        '  vec3 col=mix(vec3(0.98,0.64,0.22), vec3(1.0,0.98,0.92), core*taper);',
        '  gl_FragColor=vec4(col*al, al);',
        '}'].join('\n') });
    const pgeo=new THREE.PlaneGeometry(2.3,7.0,1,1); pgeo.translate(0,3.5,0);   // 밑변을 지면에
    const pil1=new THREE.Mesh(pgeo,pillarMat); pil1.position.set(ox,oy,oz);
    const pil2=new THREE.Mesh(pgeo,pillarMat); pil2.position.set(ox,oy,oz); pil2.rotation.y=Math.PI/2;
    S.add(pil1); S.add(pil2);
    trash.push(()=>{ S.remove(pil1); S.remove(pil2); pgeo.dispose(); pillarMat.dispose(); });

    // ── ⑤ 방사 상승 샤드(레퍼 시그니처) — 중심서 위+바깥으로 부챗살처럼 뻗는 뾰족한 빛줄기 다발. 공용 geo/mat, 밑에서 위로 성장. ──
    const stMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;',
        'uniform float uP;',
        'void main(){',
        '  float x=abs(vU.x-0.5)*2.0; float y=vU.y;',
        '  float w=smoothstep(1.0,0.0,x);',                                  // 중심선 밝음
        '  float len=smoothstep(1.0,0.0,y)*smoothstep(0.0,0.05,y);',        // 선단 페이드
        '  float life=smoothstep(0.0,0.09,uP)*(1.0-smoothstep(0.3,0.78,uP));',
        '  float al=w*len*life*1.45;',
        '  vec3 col=mix(vec3(0.95,0.60,0.20), vec3(1.0,0.98,0.92), w*len);',
        '  gl_FragColor=vec4(col*al, al);',
        '}'].join('\n') });
    const stGeo=new THREE.PlaneGeometry(0.72,4.8,1,1); stGeo.translate(0,2.4,0);
    const streaks=[];
    for(let i=0;i<26;i++){ const m=new THREE.Mesh(stGeo,stMat); const a=(i/26)*6.283+(Math.random()-0.5)*0.28;
      m.position.set(ox,oy+0.08,oz); m.rotation.order='YXZ'; m.rotation.y=a; m.rotation.x=0.62+Math.random()*0.5;   // 바깥으로 기울인 분수형
      const sx=0.75+Math.random()*0.8, sy=0.85+Math.random()*0.85; S.add(m); streaks.push({m,sx,sy}); }
    trash.push(()=>{ streaks.forEach(s=>S.remove(s.m)); stGeo.dispose(); stMat.dispose(); });

    // ── ⑥ 중앙 핫 코어(빌보드 GLSL) — 강타 순간 터지는 흰-금 백열. 카메라 향해 회전, 초반에만 짧게. ──
    const coreMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;',
        'uniform float uP;',
        'void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p);',
        '  float glow=smoothstep(1.0,0.0,r); float hot=pow(glow,3.5);',
        '  float life=smoothstep(0.0,0.05,uP)*(1.0-smoothstep(0.1,0.42,uP));',
        '  float al=(glow*0.4+hot*1.3)*life;',
        '  vec3 col=mix(vec3(1.0,0.72,0.30), vec3(1.0,0.99,0.95), hot);',
        '  gl_FragColor=vec4(col*al, al);',
        '}'].join('\n') });
    const core=new THREE.Mesh(new THREE.PlaneGeometry(4.4,4.4), coreMat); core.position.set(ox,oy+1.2,oz); S.add(core);
    trash.push(()=>{ S.remove(core); core.geometry.dispose(); coreMat.dispose(); });

    // ── ⑦ 실제 파편(돌조각) — 웜톤 발광 림, 바깥+위로 튀고 중력 낙하 + 회전(레퍼의 텀블링 암석). ──
    const shGeo=new THREE.TetrahedronGeometry(0.18), shMat=new THREE.MeshStandardMaterial({color:0x6f5b3e, emissive:0x4a2c0a, emissiveIntensity:0.55, roughness:1, flatShading:true});
    const shards=[];
    for(let i=0;i<18;i++){ const m=new THREE.Mesh(shGeo,shMat); const a=Math.random()*6.28, sp=4+Math.random()*6.5;
      m.position.set(ox,oy+0.2,oz); m.scale.setScalar(0.55+Math.random()*1.0); S.add(m);
      shards.push({m, vx:Math.cos(a)*sp, vy:3.5+Math.random()*4.5, vz:Math.sin(a)*sp, rx:(Math.random()-0.5)*13, rz:(Math.random()-0.5)*13}); }
    trash.push(()=>{ shards.forEach(s=>S.remove(s.m)); shGeo.dispose(); shMat.dispose(); });

    if(prewarm){ try{ ctx.renderer?.compile?.(S, cam||ctx.camera); }catch(_){} cleanup(); return; }   // 로드 시 6셰이더 프로그램 컴파일만 하고 정리(첫 시전 히칫 제거)
    const start=performance.now(); let last=start;
    const step=()=>{ if(done) return; const now=performance.now(), e=now-start, t=e/DUR, tS=e/1000; const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(t>=1){ cleanup(); return; }
      ringMat.uniforms.uP.value=t; crackMat.uniforms.uP.value=t; stMat.uniforms.uP.value=t; coreMat.uniforms.uP.value=t;
      smokeMat.uniforms.uP.value=t; smokeMat.uniforms.uT.value=tS;
      pillarMat.uniforms.uP.value=t; pillarMat.uniforms.uT.value=tS;
      const pg=Math.min(1,t*7); pil1.scale.y=pg; pil2.scale.y=pg;                       // 기둥 솟구침
      for(const s of streaks){ s.m.scale.set(s.sx, s.sy*Math.min(1,t*6.5), 1); }        // 샤드 위로 성장
      if(cam){ core.quaternion.copy(cam.quaternion); const cs=1.0+t*1.6; core.scale.setScalar(cs); }   // 코어 빌보드+팽창
      for(const s of shards){ s.vy-=16*dt; s.m.position.x+=s.vx*dt; s.m.position.y=Math.max(oy+0.05, s.m.position.y+s.vy*dt); s.m.position.z+=s.vz*dt; s.m.rotation.x+=s.rx*dt; s.m.rotation.z+=s.rz*dt; }
      requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(cleanup, DUR+500);   // ★안전 타임아웃 — rAF 정지(탭 백그라운드 등) 시에도 잔류 0 보장
  }
  // ★프레넬 은폐막 — 몸은 거의 투명(눈·안쪽 안 보임), 가장자리만 청록빛 셰이머(장막/Predator 클로크 느낌).
  function _cloakOn(m){
    if(m.__cloak) return;
    m.__cloak={ transparent:m.transparent, opacity:(m.opacity==null?1:m.opacity), depthWrite:m.depthWrite, side:m.side, obc:m.onBeforeCompile, cpck:m.customProgramCacheKey };
    m.transparent=true; m.opacity=0.10;
    m.depthWrite=true; m.side=THREE.FrontSide;   // ★앞면이 깊이 기록 → 뒤·안쪽(빈 머리 속 얼굴/눈) 가림(x-ray 방지). 뒷면 컬링.
    m.customProgramCacheKey=()=>'mas_cloak';   // ★캐시키 변경 — 안 하면 onBeforeCompile(프레넬 림)이 무시됨
    m.onBeforeCompile=(sh)=>{
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec3 vClkN; varying vec3 vClkV;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvClkN = normalize(normalMatrix * normal); vClkV = normalize(-mvPosition.xyz);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>','#include <common>\nvarying vec3 vClkN; varying vec3 vClkV;')
        .replace('#include <dithering_fragment>',
          'float _fres = pow(1.0 - abs(dot(normalize(vClkN), normalize(vClkV))), 2.0);\n'+
          'gl_FragColor.rgb += vec3(0.35,0.75,1.0) * _fres * 1.7;\n'+              // 청록 림 발광
          'gl_FragColor.a = clamp(0.06 + _fres * 0.8, 0.0, 1.0);\n'+              // 가장자리만 또렷, 면은 거의 투명
          '#include <dithering_fragment>');
    };
    m.needsUpdate=true;
  }
  function _cloakOff(m){ if(!m.__cloak) return; const c=m.__cloak; m.transparent=c.transparent; m.opacity=c.opacity; m.depthWrite=c.depthWrite; m.side=c.side; m.onBeforeCompile=c.obc||function(){}; m.customProgramCacheKey=c.cpck||function(){return '';}; m.__cloak=null; m.needsUpdate=true; }
  function stealth(){ if(_dead) return; if(!rcdOK('stealth',8000)) return;
    _stealthUntil=performance.now()+5000; ctx.combat?.dropAggro?.();
    ctx.sound?.play?.('stealth_on');   // ★은신 진입음(로그)
    if(avatar) avatar.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material];
      for(const m of ms){ try{ _cloakOn(m); }catch(e){ if(m.__op0==null)m.__op0=(m.opacity==null?1:m.opacity); m.transparent=true; m.opacity=0.1; m.depthWrite=false; } } } }); }
  function endStealth(){ _stealthUntil=0; ctx.sound?.play?.('stealth_off');   // ★은신 해제음(투명 풀림)
    if(avatar) avatar.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material];
    for(const m of ms){ _cloakOff(m); if(m.__op0!=null){ m.opacity=m.__op0; m.transparent=m.__op0<1; m.depthWrite=true; m.__op0=null; } } } }); }

  function use(){ if((ctx.ship && ctx.ship.boarded) || ctx.noPointerLock) return;   // ⚓ 조타 중 / 컷신 중엔 공격·시전 금지
    if(!mixer) return;
    // 🔨 망치 = 철거 도구: 조준한 내 건설물(축성 블록 → 던전/목조 건축물 → 항구 순)을 부수고 재료/골드 환급. 전투/채광 아님.
    if(currentTool==='hammer'){ heldSwing=1;
      let ok=false;
      if(ctx.fortify&&ctx.fortify.demolishAimed) ok=ctx.fortify.demolishAimed();
      if(!ok && ctx.build&&ctx.build.demolishAimed) ok=ctx.build.demolishAimed();
      if(!ok && ctx.wharfBuild&&ctx.wharfBuild.demolishAimed) ok=ctx.wharfBuild.demolishAimed();   // ⚓ 항구 철거(SIM-B3 — 점령 유지·골드 50% 환급)
      if(useAction){ const d=useAction.getClip().duration/(useAction.timeScale||1); _useUntil=performance.now()+d*1000+120;
        if(curAct&&curAct!==useAction) curAct.fadeOut(0.08); useAction.reset().setEffectiveWeight(1).fadeIn(0.06).play(); curAct=useAction; }
      return; }
    if(heldSwing<=0) heldSwing=1; const cfg=LOADOUT[currentTool];
    if(third){ faceYaw = Math.atan2(Math.sin(yaw), -Math.cos(yaw)); _faceLockUntil = performance.now()+550; }   // ★3인칭: 공격/시전 시 보는(조준)방향으로 회전 + 0.55s 고정(S로 뒤로 걸어도 이동facing이 안 덮음)
    // ── 마법(지팡이·완드): magic.js가 쿨다운·스킬·VFX 소유. 시전 성공 시 시전 애니만 재생 ──
    if(cfg && cfg.magic){ heldSwing=0;
      const ok = ctx.magic?.castBasic?.(_mageSpell);   // ★좌클릭 = 기본 마법탄(약함). 속성=Q전환, 강스킬=우클릭
      if(ok && useAction){ const now=performance.now();
        if(curAct&&curAct!==useAction) curAct.fadeOut(0.08);
        useAction.reset().setEffectiveWeight(1).fadeIn(0.05).play(); curAct=useAction;
        _useUntil = now + (useAction.getClip().duration*1000*0.9 + 100); }
      return; }
    // ── 원거리(활·석궁): draw 애니 + 발사 프레임에 투사체 ──
    if(cfg && cfg.ranged){ const now=performance.now();
      if(now < _atkLock) return;
      heldSwing=0;
      if(cfg.holdDraw){                                          // 활: 당기기(hold) → 놓을 때 발사
        if(drawing) return;
        drawing=true; drawT=0; drawStart=now;   // drawStart=실제 시작(프레임 누적 drawT와 별개 — throttle/저fps서도 발사 보장)
        if(vmArrow) vmArrow.visible=true;
        _useUntil = now + 99999;                                 // 당기는 동안 idle 애니로 안 덮이게
        const drawA = actOf(pitch>0.15?'Ranged_Bow_Draw_Up':'Ranged_Bow_Draw') || useAction;   // ★위로 조준=_Up 당기기 모션
        if(drawA){ if(curAct&&curAct!==drawA) curAct.fadeOut(0.08); drawA.reset().setEffectiveWeight(1).fadeIn(0.05).play(); curAct=drawA; }
      } else {                                                   // 석궁: 즉발(그 자리서 바로 발사)
        const rel = 150;
        _atkStart = now; _atkLock = now + 520; _useUntil = now + 600;
        if(vmArrow){ vmArrow.visible=true; setTimeout(()=>{ if(vmArrow) vmArrow.visible=false; }, rel+150); }
        if(useAction){ if(curAct&&curAct!==useAction) curAct.fadeOut(0.08); useAction.reset().setEffectiveWeight(1).fadeIn(0.05).play(); curAct=useAction; }
        { const _crit=_aiming; setTimeout(()=>{ ctx.combat?.fireArrow?.(cfg.ranged, {crit:_crit}); }, rel); }   // 우클릭 조준 중 발사 = 크리100%
      }
      return; }
    const cb = cfg ? (cfg.combo ? cfg : (cfg.cls ? COMBOS[cfg.cls] : null)) : null;   // 무기 클래스→콤보 해석
    // ── 무기(콤보): 공격속도 쿨다운 + 순서 콤보 + 점프공격 ──
    if(cb && cb.combo){ const now=performance.now();
      if(now<_atkLock) return;                       // 현재 공격 애니 진행 중 → 무시(공격속도)
      if(ctx.combat && !ctx.combat.useStamina(cb.stam||12)) return;   // ★스태미나 부족 → 공격 무산
      // ★근접 공격 = 캐릭터를 '카메라(조준) 방향'으로 즉시 돌림 → 휘두르는 모션과 meleeHit(camLook) 판정 방향 일치.
      //   (3인칭 비조준 시 캐릭터는 이동방향을 보지만, 공격 순간엔 보는 쪽을 치도록 통일 → 데미지/히트스캔 정상)
      if(third) faceYaw = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
      if(now>_comboReset) _comboI=0;                 // 한동안 안 치면 콤보 처음으로
      _dualHand = _comboI % 2;                        // ★쌍수 1인칭: 공격마다 오른→왼 교대(순차)
      let name;
      if(!onGround && cb.jump){ name=cb.jump; }       // 공중 = 점프공격
      else { name=cb.combo[_comboI%cb.combo.length]; _comboI++; }
      const clip=clips.get(name); if(!clip) return;
      const a=mixer.clipAction(clip); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true; a.timeScale=cb.speed||1;
      const dur=clip.duration/(cb.speed||1);
      _atkStart=now; _atkLock=now+dur*1000*0.78;     // 다음 공격은 78% 지점부터(콤보 체이닝 窓)
      _atkAnimUntil=now+dur*1000;                    // ★이 시각까지 = 공격 모션 중 → 피격 플린치로 안 끊김
      _comboReset=now+dur*1000+600;                  // 끝나고 0.6s 안 누르면 콤보 리셋
      _useUntil=now+dur*1000+100;
      ctx.combat?.meleeSwing?.();                    // ★휘두름 whoosh = 스윙 시작 즉시
      const _dmg=cb.dmg||8;                          // ★임팩트(칼 닿는 정점)에 sword_hit+데미지숫자 — 무기별 cb.hit
      setTimeout(()=>{ ctx.combat?.meleeHit?.(_dmg); }, Math.max(120, dur*1000*(cb.hit||0.55)));
      if(curAct&&curAct!==a) curAct.fadeOut(0.05); a.reset().setEffectiveWeight(1).fadeIn(0.04).play(); curAct=a; return; }
    // ── 도구(곡괭이·도끼·활): 단일 useAction ──
    if(!useAction) return;
    const d=useAction.getClip().duration/(useAction.timeScale||1); _useUntil=performance.now()+d*1000+120;
    if(curAct&&curAct!==useAction) curAct.fadeOut(0.08);
    useAction.reset().setEffectiveWeight(1).fadeIn(0.06).play(); curAct=useAction; }
  // ── ★타격감 D: 그로기 난타(E 연타) — 정면 그로기 대상 1타/입력, mashCd 게이팅. 좌클릭(use)은 평타 유지. ──
  //   각 타 = damageMonster 단일통로(히트스톱·스파크·데미지숫자) + ★타격음=치명타음(crit_hit, 사령관). 데미지=mashDmgMul(크리배수 아님). 스태미나 면제.
  let _mashLock=0, _mashRibbonUntil=0, _combo=0, _comboEndT=0;
  function mashTap(){ if(_dead||!mixer) return false;
    const gt = ctx.combat?.frontGroggyTarget?.(); if(!gt) return false;   // 정면 그로기 대상 없으면 미발동(각 모듈 상호작용 유지)
    const now=performance.now(); if(now<_mashLock) return true;           // mashCd 상한(연타 rate) — true=E 소비(상호작용 억제)
    _mashLock = now + BAL.feel.groggy.mashCd;
    // ★검격 리본 = 그로기 난타 때만 + 근접 클래스만(사령관). staff=아케인 볼트·bow=화살 처형이라 검 리본 없음.
    //   (기존엔 staff에도 리본이 그려져 지팡이 본을 따라 거대한 시안 블룸이 플레이어에 뜨던 버그 — 원거리 처형과 충돌)
    const _meleeRibbon = (currentTool==='sword'||currentTool==='axe2h'||currentTool==='duals');
    if(_meleeRibbon){ _mashRibbonUntil = now + BAL.feel.groggy.mashCd + 90; ctx.hitfx?.bladeTrailBegin?.(); }
    if(third){ faceYaw = Math.atan2(Math.sin(yaw), -Math.cos(yaw)); _faceLockUntil = now+300; }   // 조준방향으로 돌기
    const cfg=LOADOUT[currentTool]; const cb = cfg ? (cfg.combo ? cfg : (cfg.cls ? COMBOS[cfg.cls] : null)) : null;
    if(currentTool==='bow'){
      // ★헌터 = 활 조준→발사 모션으로 연사(사령관 "활조준하는 상태에서 나가야지"). 근접 스윙/whoosh 대신 활 릴리즈 + 발사음.
      const a=actOf(pitch>0.15?'Ranged_Bow_Release_Up':'Ranged_Bow_Release') || actBowIdle;
      if(a) playOnce(a, 0.03);
      ctx.sound?.play?.('bow_attack');
    } else {
      if(cb && cb.combo){ const name=cb.combo[_comboI%cb.combo.length]; _comboI++; const clip=clips.get(name);   // 빠른 콤보 스윙(짧게)
        if(clip){ const a=mixer.clipAction(clip); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true; a.timeScale=Math.max(cb.speed||1,1.7);
          if(curAct&&curAct!==a) curAct.fadeOut(0.03); a.reset().setEffectiveWeight(1).fadeIn(0.03).play(); curAct=a;
          _useUntil=now+(clip.duration/a.timeScale)*1000+50; } }
      ctx.combat?.meleeSwing?.();                                    // 휘두름 whoosh(근접만)
      ctx.sound?.play?.('crit_hit');                                 // ★그로기 난타음 = 치명타음(근접만)
    }
    const _dmg=((cb&&cb.dmg)||8) * BAL.feel.groggy.mashDmgMul;       // 난타 1타 데미지(다타=약하게)
    ctx._mashMode=true;                                              // ★난타 플래그 — damageMonster가 짧은 히트스톱(끊김방지)+크리급 화려 임팩트 적용
    ctx.combat?._damageMonster?.(gt, _dmg);                          // 단일통로 즉시 명중(스파크·데미지숫자). 짧은 히트스톱으로 매끄러운 다다다
    ctx._mashMode=false;
    // ★콤보 카운터 — E 난타 1타=콤보+1(scale-punch 상승·에스컬레이션). endMs 무입력/그로기 종료 시 "N HIT!" 마무리+리셋.
    _combo++;
    const _cc=BAL.feel.groggy.combo||{tierAt:[5,10,15],endMs:900};
    comboHit(_combo, {tierAt:_cc.tierAt, endMs:_cc.endMs});
    clearTimeout(_comboEndT); _comboEndT=setTimeout(()=>{ comboEnd(_combo, {tierAt:_cc.tierAt}); _combo=0; }, _cc.endMs);
    return true; }
  // 활/석궁 놓기 = 발사(당긴 정도≥최소면). 시위 화살 숨기고 투사체 발사.
  function releaseArrow(){ if(!drawing) return; const cfg=LOADOUT[currentTool]; drawing=false;
    if(vmArrow) vmArrow.visible=false;
    _useUntil = performance.now();                            // 당긴 자세 고정 해제 → idle/이동 복귀
    if(!cfg||!cfg.ranged) return;
    if(performance.now()-drawStart < 110) return;             // ★실제 경과시간 기준(프레임 누적 drawT는 throttle/저fps서 0 → 발사 취소되던 버그)
    if(cfg.ranged==='bow'){ const a=actOf(pitch>0.15?'Ranged_Bow_Release_Up':'Ranged_Bow_Release'); if(a) playOnce(a,0.04); }   // ★발사 모션(위로 조준=_Up)
    if(_windMode){ _windMode=false; windAura(false); _aiming=false; showXhair(false); _windCdUntil=performance.now()+5000; ctx.combat?.fireWindVolley?.(); return; }   // ★바람모드 발사 = 유도 바람화살 8발 → 조준·오라 해제(크로스헤어 사라짐) + 기본화살 복귀 + 5초 쿨다운
    ctx.combat?.fireArrow?.(cfg.ranged, { crit:_aiming });     // 우클릭 조준(_aiming, RMB 스킬) 중 쏘면 크리100%
    _atkStart = performance.now(); _atkLock = performance.now() + (cfg.ranged==='crossbow'?520:300);   // 재장전 쿨다운
  }
  // ── 퀵슬롯 HUD (10칸: 도구 + 건축부품. null=빈칸) ──
  let hotEl=null;
  const QKEYS=['1','2','3','4','5','6','7','8','9','0'];
  const quickslots = ctx.quickslots = [
    {type:'tool',id:'pickaxe'}, {type:'tool',id:'axe'}, {type:'tool',id:'torch'}, null,null,null,null,null,null,
    {type:'tool',id:'none'},
  ];
  let selSlot=0;
  // ★D2(2026-07-15): 도구 내구도 — 세션 상태(save 미저장, 좌절 최소화). 채광(mine.js)/벌목(axetree.js) 1회당 wear.
  //   0 도달 = 하드 파손 아님 → 경고 1회 + 무뎌짐(한 타 걸러 유효 = 효율 절반). 맨손 채집 폴백(currentTool==='none') 존재 → 데드락 없음.
  const _tdMax=(BAL.durability&&BAL.durability.tool)||{ pickaxe:120, axe:100 };
  const toolDur=ctx.toolDur={
    max:{ pickaxe:_tdMax.pickaxe, axe:_tdMax.axe },
    cur:{ pickaxe:_tdMax.pickaxe, axe:_tdMax.axe },
    _warned:{}, _glance:{},
    get(id){ return this.cur[id]; },
    isBroken(id){ return this.cur[id]!=null && this.cur[id]<=0; },
    reset(id){ if(this.max[id]!=null){ this.cur[id]=this.max[id]; this._warned[id]=false; if(ctx.updHotbar)ctx.updHotbar(); } },   // 새 도구 제작/수리 시 호출용(현재 수동·디버그)
    // 1회 사용. 반환 true=정상(채집 진행) / false=무뎌짐 헛손질(이번 타 스킵=효율 절반).
    wear(id){ if(this.cur[id]==null) return true;
      if(this.cur[id]>0){ this.cur[id]=Math.max(0, this.cur[id]-((BAL.durability&&BAL.durability.wearPerUse)||1));
        if(this.cur[id]<=0 && !this._warned[id]){ this._warned[id]=true; const ko=id==='pickaxe'?'곡괭이':'도끼';
          if(ctx.invui&&ctx.invui.toast) ctx.invui.toast(ko+' 내구도 소진 — 무뎌져 채집 효율이 절반입니다(새 '+ko+' 제작 권장)'); }
        if(ctx.updHotbar) ctx.updHotbar(); return true; }
      this._glance[id]=(this._glance[id]||0)+1; return (this._glance[id]%2)===0;   // 소진 상태 = 한 타 걸러 유효
    },
  };
  if(typeof window!=='undefined') window.__toolrepair=(id)=>{ if(id) toolDur.reset(id); else { toolDur.reset('pickaxe'); toolDur.reset('axe'); } return toolDur.cur; };
  const _bIcon=id=>(ctx.invui&&ctx.invui.icon)?ctx.invui.icon(id):null;
  const _bName=id=>(ctx.inventory&&ctx.inventory.MATERIALS&&ctx.inventory.MATERIALS[id]&&ctx.inventory.MATERIALS[id].name)||id;
  const _bCount=id=>(ctx.inventory&&ctx.inventory.count)?ctx.inventory.count(id):0;
  function selectSlot(i){ if(i<0||i>=quickslots.length) return; const s=quickslots[i];
    if(!s) return;                                   // 빈칸 = 무동작
    selSlot=i;
    if(ctx.fortify&&ctx.fortify.exit) ctx.fortify.exit();   // 슬롯 전환 = 축성 배치모드 해제(벽블록이면 아래서 재진입)
    if(s.type==='tool'){ if(ctx.build&&ctx.build.isBuilding&&ctx.build.isBuilding()&&ctx.build.mode) ctx.build.mode(false); _toolSlot=s.id; _drawn=false; equipTool(s.id); updHotbar(); return; }   // ★도구 선택 = 납도(도구모드) + 기억
    if(s.type==='build'){
      if(_bCount(s.id)<=0){   // 보유 0 → 그 부품 1개 제작(재료 있으면). 재료 부족이면 invui가 알림.
        if(ctx.invui&&ctx.invui.craftBuild) ctx.invui.craftBuild(s.id);
        else if(ctx.invui&&ctx.invui.toast) ctx.invui.toast(_bName(s.id)+' 보유 없음');
        updHotbar(); return; }
      if(ctx.gate&&ctx.gate.startPlace&&ctx.gate.startPlace(s.id)){}   // 🌀 차원문 석판(slab1~5) — 즉시 개방(고스트 없음)
      else if(ctx.outpost&&ctx.outpost.startPlace&&ctx.outpost.startPlace(s.id)){}   // 🚩 거점 깃발(banner) — build.js보다 먼저(전용 id)
      else if(ctx.build&&ctx.build.startPlace&&ctx.build.startPlace(s.id)){}   // build.js 그리드 부품
      else if(ctx.fortify&&ctx.fortify.startPlace&&ctx.fortify.startPlace(s.id)){}   // 🧱 축성 블록(벽/타워)
      else if(ctx.campfire&&ctx.campfire.startPlace) ctx.campfire.startPlace(s.id);   // 🔥 모닥불 등 자유설치 프롭
      updHotbar(); return; } }
  function assignQuickslot(i, item){ if(i<0||i>=quickslots.length) return; quickslots[i]=item||null; updHotbar(); }
  function firstFreeSlot(){ for(let i=0;i<quickslots.length;i++) if(!quickslots[i]) return i; return -1; }
  ctx.selectSlot=selectSlot; ctx.assignQuickslot=assignQuickslot; ctx.firstFreeSlot=firstFreeSlot;
  ctx.updHotbar=()=>updHotbar(); ctx.quickslots=quickslots;
  function buildHotbar(){ if(typeof document==='undefined'||hotEl) return;
    // ── mas game.html #hotbar 디자인 그대로 (slot 60×62, 골드 활성+부양) ──
    if(!document.getElementById('mas_hotbar_css')){ const st=document.createElement('style'); st.id='mas_hotbar_css'; st.textContent=`
      #hotbar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:12;display:flex;gap:6px;font-family:'Pretendard',system-ui,sans-serif;pointer-events:none;user-select:none}
      #hotbar .slot{position:relative;width:51px;height:53px;background:rgba(9,13,20,.5);backdrop-filter:blur(6px);border:1px solid rgba(201,168,90,.28);border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;transition:border-color .12s,transform .12s;pointer-events:auto;cursor:pointer}
      #hotbar .slot.on{border-color:#f3d978;border-width:2px;box-shadow:0 0 10px rgba(240,207,128,.55);transform:translateY(-4px)}
      #hotbar .slot.empty{background:rgba(9,13,20,.28);border-style:dashed;border-color:rgba(201,168,90,.16)}
      #hotbar .slot.dragOver{border-color:#8fe0f0;box-shadow:0 0 8px rgba(120,210,235,.5)}
      #hotbar .slot .num{position:absolute;top:2px;left:5px;font-size:10px;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums}
      #hotbar .slot .pic{width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:17px;line-height:1}
      #hotbar .slot .pic img{width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
      #hotbar .slot .cnt{position:absolute;right:4px;bottom:2px;font-size:11px;font-weight:800;color:#ffe7a0;text-shadow:0 1px 2px #000,0 0 3px #000;font-variant-numeric:tabular-nums}
      #hotbar .slot .nm{font-size:9px;letter-spacing:.04em;color:#cfe6ff;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
      document.head.appendChild(st); }
    hotEl=document.createElement('div'); hotEl.id='hotbar';
    document.body.appendChild(hotEl); updHotbar(); }
  function updHotbar(){ if(!hotEl) return; hotEl.innerHTML='';
    const building = !!(ctx.build && ctx.build.isBuilding && ctx.build.isBuilding());
    quickslots.forEach((s,i)=>{ const key=QKEYS[i]; let on=false, icon='', nm='', cnt='', durBar='';
      if(s && s.type==='tool'){ const cfg=LOADOUT[s.id]||{label:'빈손'}; const lbl=cfg.label||'', m=lbl.match(/^(\S+)\s+(.*)$/); nm=m?m[2]:lbl;   // ★공백 없으면 라벨 전체가 이름(빈손 등) — 아이콘 칸에 텍스트 노출 방지
        const url=(s.id==='pickaxe'||s.id==='axe'||s.id==='torch')?_bIcon(s.id):(s.id==='none'?'/tomob-deploy/ui/icons/icon_fist.png':null);   // 🛠️ 도구=GLB썸네일 · 맨주먹=주먹아이콘(ui/icons)
        icon = url ? `<img src="${url}" alt="" onerror="this.remove()">` : (m?m[1]:''); on=(s.id===currentTool)&&!building;
        // ★D2(2026-07-15): 곡괭이·도끼 내구도 바(아이콘 하단). 초록>50%·노랑>20%·빨강. 소진 시 빨강 0%.
        if((s.id==='pickaxe'||s.id==='axe') && ctx.toolDur){ const c=ctx.toolDur.get(s.id), mx=ctx.toolDur.max[s.id]||1, f=Math.max(0,Math.min(1,c/mx));
          const col=f>0.5?'#7fe39a':(f>0.2?'#f3d978':'#ff8a8a');
          durBar=`<span style="position:absolute;left:4px;right:4px;bottom:1px;height:3px;border-radius:2px;background:rgba(0,0,0,.55)"><span style="display:block;height:100%;width:${(f*100).toFixed(0)}%;border-radius:2px;background:${col}"></span></span>`; } }   // 아이콘 없으면 빈 칸(onerror=미존재 시 제거)
      else if(s && s.type==='build'){ const url=_bIcon(s.id); icon=url?`<img src="${url}" alt="">`:'🧱'; nm=_bName(s.id); cnt=_bCount(s.id); on=(building||(ctx.campfire&&ctx.campfire.placing))&&i===selSlot; }
      const b=document.createElement('div'); b.className='slot'+(on?' on':'')+(s?'':' empty'); b.dataset.slot=i;
      b.innerHTML=`<span class="num">${key}</span><span class="pic">${icon}</span><span class="nm">${nm}</span>`+(cnt!==''?`<span class="cnt">${cnt}</span>`:'')+durBar;
      b.addEventListener('click',()=>selectSlot(i));
      b.addEventListener('dragover',e=>{ if(window.__qsDrag!=null){ e.preventDefault(); b.classList.add('dragOver'); } });
      b.addEventListener('dragleave',()=>b.classList.remove('dragOver'));
      b.addEventListener('drop',e=>{ e.preventDefault(); b.classList.remove('dragOver'); if(window.__qsDrag!=null) assignQuickslot(i,{type:'build',id:window.__qsDrag}); });
      hotEl.appendChild(b); }); }

  // ── 입력/상태 ──
  let yaw=0, pitch=0, vy=0, onGround=false, run=false, third=true, fly=false, _airTime=0, _sitting=false;   // _sitting=바닥앉기(C, 땅에서만)
  let _flyMul=1;   // ✈️ 비행 속도배율(__fly로 조정). 기본 1 = 기존 J/L 비행속(2.4×보행).
  // ✈️ 테스트 비행 콘솔(사령관) — 벽·바닥 통과 자유비행. Space=위 · C/Ctrl=아래.
  //   __fly()   토글  ·  __fly(6)  속도 6배로 켜기(빠르게 날아 멀리 테스트)  ·  다시 __fly() 끄기
  if(typeof window!=='undefined') window.__fly=(mult)=>{
    if(mult!=null){ _flyMul=Math.max(0.2,+mult); fly=true; } else fly=!fly;
    _sitting=false;
    console.log('%c[fly] '+(fly?'ON ×'+_flyMul+' — 벽 통과 자유비행 (Space 위 / C 아래)':'OFF'),'font-weight:bold;color:'+(fly?'#8fe0f0':'#ffa0a0'));
    return { fly, speedMul:_flyMul };
  };
  let _tpReq=null;   // ★텔레포트 요청 큐(setSpawn/recall/부활). kinematic 바디는 setTranslation이 즉시 반영 안 돼 pp가 옛값을 읽던 것 → 이동루프가 이 요청으로 pp를 강제.
  let _shipView=0, _wasBoarded=false;   // ★조타 중 F 시점 3단(0=1인칭 / 1=3인칭 근접 / 2=더 멀리)
  let _steerPrevTool=null;   // ⚓ 조타 진입 시 들고 있던 무기/도구 기억 → 조타 중엔 맨손 고정, 조타 종료 시 복원(사령관 "무기 들고 운전 이상함")
  let _cannonYawOff=0, _cannonPitchAim=0.12; const _cannonDir=new THREE.Vector3();   // ⚔️ 대포 조준(현측 기준 상대각·협소·1인칭)
  let _steerYaw=0, _steerPitch=0, _rmb=false, _navAiming=false;   // ★조타 3인칭 카메라 우클릭 = 해전 조준(줌인). _navAiming=navalcombat이 읽음
  let _aimSide=null, _aimYaw=0;   // ⚔️ Q=좌현 / E=우현 대포 조준 현측(null=조준 안 함). _aimYaw=조준 중 마우스 좌우(현측 기준 제한각).
  let _aimInboard=-0.4, _aimH=3.7, _aimPitchBase=-0.14, _aimLookDist=14;   // ⚔️ 대포 조준 카메라 튜닝(사령관 확정값) — 앵커=배 중심. inboard 음수=대포 라인 살짝 넘어 바짝(대포 전경 크게)·갑판 위 높이(h)·내려봄(pitch)·바깥 응시거리(look). window.__aimCam(inboard,h,pitch,look)로 실시간 조정.
  const _steerOrbit = () => (ctx.ship && ctx.ship.boarded && _shipView>0);   // 조타 3인칭이면 우클릭=카메라 회전(조준 아님)
  let _helmFwd=-1.9;                              // 조타 시 캐릭터 위치: 조타륜에서 뱃머리(+)/선미(-) 오프셋. 음수=뒤로(선미). __helmTune로 조정
  let _steerNear=11, _steerFar=24, _steerH=6;   // 조타 3인칭 카메라 거리/높이 — 캐릭터(헬름) 기준 절대 m. __steerCam(near,far,h)로 조정
  // 🎥 승선 카메라 스프링 상태(2026-07-22, 감사 M8) — 선체에 용접돼 있던 시점을 상하만 지연시켜 "배가 밑에서 움직이는" 감각을 만든다.
  //   계수 SSOT = BAL.sailing.cam. 하선/재승선 시 _camY=null로 리셋해 첫 프레임 튀는 것 방지.
  const BAL_SAIL = BAL.sailing || null;
  let _camY=null, _camVY=0;   // 쉐이크는 기존 camShake() 시스템 재사용(중복 구현 금지 — 1123줄)
  if(typeof window!=='undefined'){
    window.__helmTune=(v)=>{ if(v!=null)_helmFwd=v; return {helmFwd:_helmFwd}; };   // 예) __helmTune(-2) = 더 뒤로
    window.__steerCam=(n,f,h)=>{ if(n!=null)_steerNear=n; if(f!=null)_steerFar=f; if(h!=null)_steerH=h; return {near:_steerNear,far:_steerFar,h:_steerH}; };
    window.__aimCam=(inboard,h,pitch,look)=>{ if(inboard!=null)_aimInboard=inboard; if(h!=null)_aimH=h; if(pitch!=null)_aimPitchBase=pitch; if(look!=null)_aimLookDist=look; return {inboard:_aimInboard,h:_aimH,pitchBase:_aimPitchBase,look:_aimLookDist}; };   // ⚔️ 대포 조준 카메라 튜닝(배 중심 앵커 — inboard·높이·내려봄·응시거리)
  }
  let _aiming=false; const _camRight=new THREE.Vector3(), _UPv=new THREE.Vector3(0,1,0);   // 3인칭 오버숄더+우클릭 조준
  let faceYaw=0;   // 캐릭터가 바라보는 방향(이동방향으로 부드럽게 회전)
  let _faceLockUntil=0;   // 이 시각까지 = facing을 조준방향에 고정(공격/시전 중 이동facing 무시)
  let _dashUntil=0, _dashVX=0, _dashVZ=0; const DODGE_SPEED=12, SPRINT_COST=22;   // 구르기 대시 / 스프린트 초당 스태미나 소모
  let _knockUntil=0, _knockVX=0, _knockVZ=0, _knockSpeed=0;   // ★2026-07-23 넉백(보스 밀치기) — 대시와 같은 KCC 추진(벽 충돌 존중 · 용암 구멍으론 밀려 떨어짐)
  const _fxList=[];   // 간단 일회성 VFX(회피 먼지 등)
  function dodgeFx(){   // 회피 시 발밑 먼지 링 — 빠르게 커지며 페이드
    const geo=new THREE.RingGeometry(0.18,0.5,22), mat=new THREE.MeshBasicMaterial({color:0xe6eeff, transparent:true, opacity:0.5, side:THREE.DoubleSide, depthWrite:false});
    const ring=new THREE.Mesh(geo,mat); ring.rotation.x=-Math.PI/2; const pp=body.translation(); ring.position.set(pp.x, pp.y-FOOT+0.06, pp.z); scene.add(ring);
    let t=0; _fxList.push({update(dt){ t+=dt; const k=Math.min(1,t/0.34); ring.scale.setScalar(1+k*2.8); mat.opacity=0.5*(1-k); if(k>=1){ scene.remove(ring); geo.dispose(); mat.dispose(); return false; } return true; }}); }
  let _shipRef=null, _local=new THREE.Vector3(), _inWater=false, _climbLock=null;   // _climbLock = 등반 중인 사다리(진동 방지 sticky)
  let _onLadder=null, _ladderEPrev=false, _ladderGrabT=0;   // 지상 사다리: [E]로 잡고(_onLadder) W로 오름. _ladderGrabT=잡기 모션 타이머
  // 🏊 수영: 물 진입 시 상태(부력·시선 유영) + Crawling 수평틸트 애니. SWIM_TILT=눕힘각 / HSPEED=수평감속 / VSPEED=수직속도
  let _swimming=false, _swimTilt=0, _swimPanel=null;
  let SWIM_TILT=THREE.MathUtils.degToRad(34), SWIM_MAX=THREE.MathUtils.degToRad(87);   // 눕힘각/상한 = 사령관 샌드박스 튜닝 확정값(2026-07-04). 페이더로 재조절 가능.
  const SWIM_HSPEED=0.62;
  if(typeof window!=='undefined'){
    const R2D=THREE.MathUtils.radToDeg, D2R=THREE.MathUtils.degToRad;
    window.__swimTilt=(d)=>{ if(d!=null)SWIM_TILT=D2R(d); return +R2D(SWIM_TILT).toFixed(1); };   // 콘솔 라이브 조절도 유지
    window.__swimMax =(d)=>{ if(d!=null)SWIM_MAX =D2R(d); return +R2D(SWIM_MAX ).toFixed(1); };
    // 🏊 수영 튜닝 페이더 패널 (샌드박스/테스트 __testMode 전용). 물에서 Esc로 포인터 풀고 드래그 → 3인칭 실시간 반영.
    const _sp=document.createElement('div'); _sp.id='swimTune';
    _sp.style.cssText='position:fixed;right:12px;top:96px;z-index:30;display:none;width:224px;padding:11px 13px;'
      +'background:rgba(12,16,22,.92);border:1px solid rgba(120,180,230,.42);border-radius:8px;color:#dbeafe;'
      +"font:12px 'Pretendard',system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:auto;user-select:none;";
    const _rows=[
      { k:'tilt', label:'눕힘각',        min:0,  max:90,  step:1,    get:()=>+R2D(SWIM_TILT).toFixed(0), set:v=>SWIM_TILT=D2R(v), unit:'°' },
      { k:'max',  label:'상한(뒤집힘방지)', min:45, max:110, step:1,    get:()=>+R2D(SWIM_MAX ).toFixed(0), set:v=>SWIM_MAX =D2R(v), unit:'°' },
      { k:'sign', label:'시선영향',       min:-1, max:1,   step:0.1,  get:()=>(window.__swimSign??1),     set:v=>window.__swimSign=v, unit:'' },
      { k:'lift', label:'띄우기',         min:0,  max:2,   step:0.05, get:()=>(window.__swimLift??0.35),  set:v=>window.__swimLift=v, unit:'' },
    ];
    let _html='<div style="font-weight:600;color:#93c5fd;margin-bottom:8px">수영 튜닝</div>';
    _rows.forEach(r=>{ _html+=`<div style="margin:8px 0"><div style="display:flex;justify-content:space-between"><span>${r.label}</span><span id="sv_${r.k}" style="color:#93c5fd">${r.get()}${r.unit}</span></div>`
      +`<input type="range" id="sr_${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" value="${r.get()}" style="width:100%;accent-color:#60a5fa"></div>`; });
    _html+='<div style="opacity:.55;margin-top:6px;font-size:11px">물에서 Esc로 포인터 풀고 드래그</div>';
    _sp.innerHTML=_html; document.body.appendChild(_sp); _swimPanel=_sp;   // onUpdate가 수영 중 표시 제어
    _rows.forEach(r=>{ const inp=_sp.querySelector('#sr_'+r.k), lbl=_sp.querySelector('#sv_'+r.k);
      inp.addEventListener('input',()=>{ const v=parseFloat(inp.value); r.set(v); lbl.textContent=v+r.unit; }); });
    const _syncSwimPanel=()=>{ _sp.style.display = window.__testMode ? 'block' : 'none'; };
    _syncSwimPanel();
    addEventListener('keydown',e=>{ if(e.code==='KeyK'&&e.ctrlKey&&e.shiftKey) setTimeout(_syncSwimPanel,0); });   // Ctrl+Shift+K 토글 후 표시 동기화
  }
  const keys=new Set();
  renderer.domElement.addEventListener('click',()=>{ if(ctx.noPointerLock) return; renderer.domElement.requestPointerLock(); });   // ⛔ 컷신 중(ctx.noPointerLock)엔 재잠금 금지 — 대사창 클릭이 캔버스로 새던 것 방지
  // ★포인터락(플레이 중) = 하단 "클릭해 시점잠금" 안내 숨김(반투명 퀵바 뒤로 비치던 문제 해소)
  document.addEventListener('pointerlockchange',()=>{ const h=document.getElementById('hint');
    if(h) h.style.display = (document.pointerLockElement===renderer.domElement) ? 'none' : ''; });
  renderer.domElement.addEventListener('pointerdown',e=>{ if(e.button===0 && (document.pointerLockElement===renderer.domElement || _aiming)){   // ★조준 중(_aiming)이면 락 없이도 당기기 허용(조준선만 뜨고 당기기 안 되던 버그)
    if(ctx.input && ctx.input.blocks('MouseLeft')) return;   // ⌨️ 조타/UI/컷신 중 좌클릭 공격 차단
    if(ctx.build && ctx.build.isBuilding && ctx.build.isBuilding()) return;   // 빌드 모드 중엔 공격 안 함(빌드 확정 우선)
    if(ctx.claim && ctx.claim.isPlacing && ctx.claim.isPlacing()) return;     // 대포 배치 중엔 공격 안 함(설치 클릭 우선)
    if(ctx.fortify && ctx.fortify.isPlacing && ctx.fortify.isPlacing()) return;   // 🧱 블록 배치모드 중엔 좌클릭 공격 안 함(블록 건설=우클릭)
    if(ctx.wharfBuild && ctx.wharfBuild.placing && ctx.wharfBuild.placing()) return;   // ⚓ 항구 고스트 배치 중엔 좌클릭=건설 확정(공격 안 함)
    if(ctx.settlement && ctx.settlement.ghostActive && ctx.settlement.ghostActive()) return;   // 🏛️ 내섬 건물 고스트 배치 중엔 좌클릭=건설 확정(공격 안 함)
    use(); } });   // 좌클릭=사용(채광/공격) · 활은 당기기 시작
  renderer.domElement.addEventListener('pointerup',e=>{ if(e.button===0) releaseArrow(); });   // 좌클릭 놓기 = 활 발사
  // ── 우클릭 = 3인칭 조준 모드(크로스헤어 + 카메라 줌인). 1인칭은 그대로. ──
  renderer.domElement.addEventListener('pointerdown',e=>{ if(e.button===2){ if(ctx.fortify && ctx.fortify.isPlacing && ctx.fortify.isPlacing()) return;   // 🧱 블록 배치모드 = 우클릭이 건설(fortify가 처리) → 무기특수 안 함
    if(_steerOrbit()) _rmb=true; else useRight(true); } });    // ★우클릭: 조타3인칭=카메라회전 / 그외=무기특수(조준·가드·스핀…)
  renderer.domElement.addEventListener('pointerup',e=>{ if(e.button===2){ _rmb=false; useRight(false); } });   // 가드 해제 + 오빗 종료
  addEventListener('pointerup',e=>{ if(e.button===2){ _rmb=false; useRight(false); } });   // 락 밖 안전망
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
  // ★mousedown/up 폴백 — 일부 환경서 멀티버튼 pointerdown 누락 보완(drawing/_atkLock 가드로 중복 무해)
  renderer.domElement.addEventListener('mousedown',e=>{ if(e.button===2){ if(ctx.fortify && ctx.fortify.isPlacing && ctx.fortify.isPlacing()) return;   // 🧱 블록 배치=우클릭 건설
    if(_steerOrbit()) _rmb=true; else useRight(true); return; }
    if(e.button===0 && (document.pointerLockElement===renderer.domElement || _aiming)){
      if(ctx.input && ctx.input.blocks('MouseLeft')) return;   // ⌨️ 조타/UI/컷신 중 좌클릭 공격 차단(폴백 경로)
      if(ctx.build && ctx.build.isBuilding && ctx.build.isBuilding()) return;
      if(ctx.claim && ctx.claim.isPlacing && ctx.claim.isPlacing()) return;
      if(ctx.fortify && ctx.fortify.isPlacing && ctx.fortify.isPlacing()) return;   // 🧱 블록 배치모드 중 좌클릭 공격 안 함
      if(ctx.wharfBuild && ctx.wharfBuild.placing && ctx.wharfBuild.placing()) return;   // ⚓ 항구 고스트 배치 중엔 좌클릭=건설 확정
      if(ctx.settlement && ctx.settlement.ghostActive && ctx.settlement.ghostActive()) return;   // 🏛️ 내섬 건물 고스트 배치 중엔 좌클릭=건설 확정
      use(); } });
  addEventListener('mouseup',e=>{ if(e.button===0) releaseArrow(); else if(e.button===2){ _rmb=false; useRight(false); } });
  // 크로스헤어(4코너 괄호) — 조준 시만 표시
  let _xhair=null;
  function buildXhair(){ if(typeof document==='undefined'||_xhair) return;
    const C='rgba(255,255,255,.92)';
    const cn=(p,b1,b2)=>`<div style="position:absolute;${p};width:9px;height:9px;border-${b1}:2px solid ${C};border-${b2}:2px solid ${C};filter:drop-shadow(0 0 2px #000)"></div>`;
    _xhair=document.createElement('div'); _xhair.id='xhair';
    _xhair.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:14;pointer-events:none;width:30px;height:30px;display:none';
    _xhair.innerHTML=cn('top:0;left:0','top','left')+cn('top:0;right:0','top','right')+cn('bottom:0;right:0','bottom','right')+cn('bottom:0;left:0','bottom','left')+
      `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:3px;height:3px;border-radius:50%;background:${C};filter:drop-shadow(0 0 2px #000)"></div>`;
    document.body.appendChild(_xhair); }
  function showXhair(on){ if(_xhair) _xhair.style.display=on?'block':'none'; }
  buildXhair();
  addEventListener('pointerup',e=>{ if(e.button===0 && drawing) releaseArrow(); });            // 포인터락 밖 release 안전망
  addEventListener('mousemove',e=>{ if(document.pointerLockElement!==renderer.domElement) return;
    // ★창 전환(#16) 방어: 포인터락 재획득 직후 첫 mousemove의 delta가 폭발(브라우저가 그동안 누적분을 한 번에 전달)
    //   → 카메라가 확 돌아 목적지 ❗마커가 마우스 쪽으로 튀던 것. 비정상적으로 큰 한 프레임 delta는 무시.
    if(Math.abs(e.movementX)>180 || Math.abs(e.movementY)>180) return;
    if(ctx.crew && ctx.crew.radialOpen && ctx.crew.radialOpen()){ ctx.crew.radialMove(e.movementX,e.movementY); return; }   // [U] 크루 지시 라디얼
    if(ctx.build && ctx.build.radialOpen && ctx.build.radialOpen()){ ctx.build.radialMove(e.movementX,e.movementY); return; }
    if(_aimSide!=null && ctx.ship && ctx.ship.boarded && third && _shipView>0){   // ⚔️ Q/E 대포 조준 중(★조타 중일 때만 — 하선 후 _aimSide 잔존해도 육상 시점 회전 막지 않게). 좌우=제한각(±aimYawMax) 조준 스윙 / 상하=탄도 사거리(steerPitch→aimAngle 재사용, 상하 반전 유지). 카메라·밴드·실탄도 동일 방향.
      const _ym=BAL.naval.aimYawMax;
      _aimYaw     = Math.max(-_ym, Math.min(_ym, _aimYaw - e.movementX*0.0022));
      _steerPitch = Math.max(-0.7, Math.min(0.9, _steerPitch - e.movementY*0.004));
      return; }
    if(_rmb && _steerOrbit()){ _steerYaw -= e.movementX*0.005; _steerPitch=Math.max(-0.7,Math.min(0.9,_steerPitch - e.movementY*0.005)); return; }   // ★조타 우클릭 — 항해 시점 회전(조준 아닐 때만). 상하 반전(마우스 아래=아래를 봄)
    // ⚔️ 대포 1인칭 조준 = 현측 기준 상대각(협소) + 감도↓(SoT식). 좌우=현측 ±40°, 위아래=사거리. (전역 yaw/pitch는 안 건드림)
    const _atCannon = ctx.crew && ctx.crew.isPlayerAt && ctx.crew.isPlayerAt('cannon');
    if(_atCannon){
      _cannonYawOff   = Math.max(-0.7,  Math.min(0.7,  _cannonYawOff   + e.movementX*0.0011));
      _cannonPitchAim = Math.max(-0.15, Math.min(0.5,  _cannonPitchAim - e.movementY*0.0011));
    } else {
      yaw   += e.movementX*0.0024;                                  // 마우스 우 → 시점 우
      pitch  = Math.max(-1.3, Math.min(1.0, pitch - e.movementY*0.0024));
    } });
  addEventListener('keydown',e=>{ keys.add(e.code); if(e.code==='ShiftLeft')run=true;
    // ⚔️ 1인 크루 스테이션(SoT식 위치 상호작용) — 배 위에서 [Z]. (E는 방향타와 겹쳐 폐지·사령관 2026-07-04)
    //   갑판 보행 중 조타륜/대포 근처 [Z] = 진입 / 조종 중 [Z] = 나가기(갑판 복귀). 대포 진입 = 1인칭 조준 고정.
    if(e.code==='KeyZ' && ctx.crew && ctx.player && ctx.player._onShip){
      if(ctx.ship && ctx.ship.boarded){ ctx.crew.exit(); _aimSide=null; _aimYaw=0; return; }   // ⚔️ 조타 종료 = 대포 조준 상태도 해제(잔존 방지)
      const entered = ctx.crew.tryInteract(ctx.player.pos);
      if(entered){ if(entered==='cannon'){ _shipView=0; third=false; _cannonYawOff=0; _cannonPitchAim=0.12; } return; }
      // 근처 스테이션 없음 → 흘려보냄
    }
    // ⚔️ 조타 3인칭 중 Q=좌현 / E=우현 대포 조준 카메라 토글 — ★반드시 게이트 앞(ship 모드 blocks에 KeyQ/KeyE가 있어 게이트 뒤면 차단됨).
    //   Q/E는 배 조종 미사용(A/D=방향타, W/S=돛). 다시 누르면 조준 해제(토글).
    if((e.code==='KeyQ'||e.code==='KeyE') && !e.repeat && (ctx.ship&&ctx.ship.boarded) && third && _shipView>0
       && !(ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon')){
      const want = e.code==='KeyQ' ? 'port' : 'starboard';
      _aimSide = (_aimSide===want) ? null : want;
      if(_aimSide){ _aimYaw=0; _steerPitch=0; }   // 조준 진입 = 현측 정면·수평(직사)부터
      else { _steerYaw=0; _steerPitch=0; }         // ★조준 해제 = 항해 정면·수평 복귀(뱃머리). steerPitch는 조준 탄도에 공유돼 오염됨 → 리셋 안 하면 해제 후 현측에 고정.
      e.preventDefault(); return; }
    // ⌨️ 입력 모드 게이트 — 키는 이미 Set에 넣었으므로(ship.js 조타가 keys.has로 읽음) 여기서 막아도
    //   WASD(돛·방향타)는 살고, 아래 플레이어 액션(스킬·발도·앉기·점프·이모트)만 차단된다.
    if(ctx.input && ctx.input.blocks(e.code)) return;
    if(e.code==='Space'&&onGround){ vy=9; onGround=false; _sitting=false; }
    if(e.code==='KeyF'){ if(ctx.ship && ctx.ship.boarded){
                           if(ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon'){ _shipView=0; third=false; }   // 포 스테이션 = 1인칭 고정(시점순환 X)
                           else { _shipView=(_shipView+1)%3; third=(_shipView!==0); } }   // ★조타 중: 1인칭→3인칭→더 멀리
                         else third=!third; }   // 그 외 = 1/3인칭 토글 (상선/하선은 E키로 이관 — 사령관: F 겹침)
    if(e.code==='KeyV' && !e.repeat){ toggleWeapon(); }                                   // ★V = 발도/납도 토글(무기 꺼내기↔넣기)
    if((e.code==='KeyJ'||e.code==='KeyL') && !e.repeat && window.__testMode){ fly=!fly; _sitting=false; }    // ★비행 = 디버그(테스트모드 K) 전용. 일반 게임에선 비활성. L도 동일 트리거(사령관 요청, 2026-07-14) — ⚠️KeyL은 fortify.js 축성모드 토글과 겹침(테스트모드 중 L을 누르면 비행+축성모드가 동시에 토글됨).
    if(e.code==='KeyC' && !e.repeat && onGround && !fly && !_inWater){   // ★앉기(바닥) 토글: Sit_Floor_Down↔StandUp. 물속·비행은 기존 하강 유지
      if(_sitting){ _sitting=false; const a=actOf('Sit_Floor_StandUp'); if(a) playOnce(a,0.1); else _useUntil=0; }
      else { _sitting=true; const a=actOf('Sit_Floor_Down'); if(a) playOnce(a,0.15); } }
    if(e.code==='KeyQ' && !e.repeat){ if(currentTool==='staff') _mageSpell=(_mageSpell==='fire'?'ice':'fire');   // ★지팡이 Q = 불↔얼음 속성전환
      else if(currentTool==='bow'){   // ★레인저 Q = 바람모드 토글. 쿨다운 중엔 아무 동작 안 함(바람모드 활성 X).
        if(_windMode){ useRight(true); _windMode=false; windAura(false); }                            // 다시 Q = 취소(조준 토글·발사 안 함·쿨다운 없음)
        else if(performance.now()>=_windCdUntil){ useRight(true); _windMode=true; windAura(true); } }  // 쿨다운 아니면 Q = 바람모드 ON(조준·발사 전까지 유지)
      else if(LOADOUT[currentTool]&&LOADOUT[currentTool].offhand && ctx.combat?.guardReady) shieldSlamMove();   // ★기사: 게이지 가득 → Q = 방패충격파 궁극기
      else useRight(true); }   // 그 외 Q = 우클릭(조준/스킬) 키보드 대체
    if(e.code==='KeyE' && ctx.combat?.frontGroggyTarget?.()) mashTap();   // ★타격감 D: 정면 그로기 대상 = E 난타 우선. 대상 없으면 각 모듈 상호작용(harbor/forge/NPC) 유지.
    if(e.code==='KeyY'){   // ⚓ 상선/하선 전용키(사령관: F=시점·E=상호작용과 겹쳐 전용키 Y로). 배 위=하선 / 배 근처=상선. (튜토/컷신은 board/disembark 내부 가드로 차단)
      if(_shipRef) ctx.player.disembark(); else ctx.player.board(); }
    const SLOTKEY={Digit1:0,Digit2:1,Digit3:2,Digit4:3,Digit5:4,Digit6:5,Digit7:6,Digit8:7,Digit9:8,Digit0:9};   // 퀵슬롯 10칸(도구+건축부품)
    if(SLOTKEY[e.code]!=null) selectSlot(SLOTKEY[e.code]); });
  // ★창 전환(alt-tab/blur) 시 눌린 키·우클릭 상태 초기화(사령관 #16) — 복귀 후 유령 입력(키 유지 이동·조준 잔존)으로
  //   시점/목표가 마우스 따라 도는 현상 방어. 포인터락은 사용자가 다시 클릭해 재획득.
  addEventListener('blur',()=>{ keys.clear(); _rmb=false; try{ useRight(false); }catch(_){} });
  addEventListener('keyup',e=>{ keys.delete(e.code); _tapArmed[e.code]=true; if(e.code==='ShiftLeft')run=false; if(e.code==='KeyQ' && currentTool!=='staff') useRight(false); });   // ★키 떼면 다음 탭 arm(더블탭 성립엔 뗌 필수). Q 떼면 가드 해제.

  // ── 🤸 회피롤(더블탭 WASD, 무적) + 👋 이모트(P) ──
  let _iframeUntil=0; const _lastTap={}, _tapArmed={};   // _tapArmed[code]=이 키가 keyup으로 떼어져 다음 '누름'이 진짜 2번째 탭인지. keydown 연발/중복발동으로 단일탭에 대시 나가던 것 차단.
  const _DODGE={KeyW:'Dodge_Forward',KeyS:'Dodge_Backward',KeyA:'Dodge_Left',KeyD:'Dodge_Right'};
  function doDodge(code){ if(_dead||fly||_inWater||performance.now()<_atkLock) return;   // onGround는 경사·물리로 자주 false → 비행/수영만 제외(회피 막히던 버그)
    if(ctx.combat && !ctx.combat.useStamina(16)) return;     // 스태미나 소모
    // 카메라 기준 입력방향 → 그쪽으로 캐릭터 돌리고 앞구르기 1종 + 대시 추진(방향대로 멀리)
    const sinY=Math.sin(yaw), cosY=Math.cos(yaw); let dx=0,dz=0;
    if(code==='KeyW'){dx=sinY;dz=-cosY;} else if(code==='KeyS'){dx=-sinY;dz=cosY;}
    else if(code==='KeyA'){dx=-cosY;dz=-sinY;} else if(code==='KeyD'){dx=cosY;dz=sinY;}
    const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L;
    _dashVX=dx; _dashVZ=dz; _dashUntil=performance.now()+360; faceYaw=Math.atan2(dx,dz); _faceLockUntil=0;
    const a=actOf('Dodge_Forward')||actOf(_DODGE[code]); if(a) playOnce(a,0.05);   // 항상 앞구르기(방향은 회전으로)
    dodgeFx();   // 발밑 먼지 이펙트
    // ★구르기음 — 성별 분기(여캐=마법사·도적 / 남캐=기사·전사·레인저)
    const _female = /rogue|mage/.test((typeof location!=='undefined' && new URLSearchParams(location.search).get('char') || '').toLowerCase());
    ctx.sound?.play?.(_female ? 'dodge_roll' : 'dodge_roll_m');
    _iframeUntil=performance.now()+420; }   // 회피 중 무적 0.42s
  addEventListener('keydown',e=>{ if(_dead||e.repeat) return;
    if(ctx.input && !ctx.input.isFoot()) return;   // ⌨️ 회피롤·이모트는 도보(foot)에서만 — 조타 중 돛조절(WASD) 더블탭이 회피 오발되던 것 차단
    if(_DODGE[e.code]){ const now=performance.now(); if(_tapArmed[e.code] && now-(_lastTap[e.code]||0)<300) doDodge(e.code); _lastTap[e.code]=now; _tapArmed[e.code]=false; }   // ★진짜 2번째 '누름'(직전 뗌 있음)만 대시. 연발·중복 keydown은 arm=false라 무시.
    else if(e.code==='KeyP'){ if(onGround){ const a=actOf('Waving'); if(a) playOnce(a,0.12); } }   // 👋 손 흔들기(구 H → 포션과 겹쳐 P로 이관)
  });

  const EYE=1.6, FOOT=1.15;            // 캡슐 중심~바닥 = 0.7+0.45
  let camDist=3.1, camUp=0.9, camShoulder=0.95, camLookH=1.85;    // 3인칭 오버숄더(레퍼런스 1.png 검증값). 카메라는 조준방향을 봄→camUp=카메라높이(캐릭터 상하위치). __camTune(거리,높이,어깨,_).
  // ── 시네마틱(곡 재생 등): 카메라 살짝 pull-back. cinematic(ms) 호출 → 멀어졌다 복귀 ──
  let _cineZoom=1, _cineTarget=1, _cineUntil=0;
  function cinematic(ms=6500){ _cineTarget=1.35; _cineUntil=performance.now()+ms; }   // ×1.35 = 살짝 멀어짐
  // ── 타격감 A3: 카메라 킥/흔들림 — 명중 시 임펄스, 매 프레임 지수감쇠(반감기 ~decayMs). _cineZoom과 별개 가산. ──
  let _camShake=0; const _shakeV=new THREE.Vector3();   // 진폭(m) — camShake(amount)로 임펄스, 카메라 위치 확정 후 랜덤 오프셋 가산
  function camShake(amount){ _camShake = Math.max(_camShake, amount||0); }   // 겹치면 큰 값 유지(연타 시 폭주 방지)
  // ── 🎥 임팩트 카메라 컷인(해전 Phase4, navalcombat이 호출) — 격침='sink'(FOV 좁힘+시선방향 당김) / 큰피격='hit'(흔들림 위주). ──
  //   ★1차 구현 = 0.28~0.35s smoothstep 보간(하드컷 아님). 사령관이 실플레이로 하드컷 선호 시 _impactDur을 0에 가깝게.
  //   ⚠️[[voyage-light-recompile-trap]]: 트랩 원인은 라이트 add/remove. 여기 FOV만 바꾸므로 무관할 것으로 판단 —
  //     실플레이서 프레임드랍 관찰되면 아래 FOV 라인 주석처리(위치 당김만 유지)로 대체(주석: fallback).
  let _impactT=0, _impactDur=0, _impactKind=null, _impactFovBase=null; const _impF=new THREE.Vector3();
  function navImpactCam(kind='sink'){
    _impactKind=kind; _impactDur=(kind==='hit')?0.35:0.28; _impactT=_impactDur;
    if(_impactFovBase==null && camera && camera.isPerspectiveCamera) _impactFovBase=camera.fov;
  }
  if(typeof window!=='undefined') window.__camTune=(d,u,s,h)=>{ if(d!=null)camDist=d; if(u!=null)camUp=u; if(s!=null)camShoulder=s; if(h!=null)camLookH=h; return {camDist,camUp,camShoulder,camLookH}; };
  const _shipRC=new THREE.Raycaster(), _dn=new THREE.Vector3(0,-1,0), _lvTmp=new THREE.Vector3();

  let _swWarmed=false;   // 충격파 셰이더 프리워밍(1회) — 로드 후 첫 프레임에 컴파일
  ctx.onUpdate(dt=>{
    if(!_swWarmed && avatar && ctx.renderer && ctx.scene){ _swWarmed=true; try{ shockwaveVFX(true); }catch(_){} }   // 첫 시전 히칫 제거
    // ── 입력 → 카메라 기준 수평 이동벡터 ──
    const fwd    = _dead ? 0 : (keys.has('KeyW')?1:0) - (keys.has('KeyS')?1:0);   // ★사망 시 이동 잠금(_dead)
    const strafe = _dead ? 0 : (keys.has('KeyD')?1:0) - (keys.has('KeyA')?1:0);
    const sinY=Math.sin(yaw), cosY=Math.cos(yaw);
    let dx = sinY*fwd + cosY*strafe;     // forward=(sinY,-cosY), right=(cosY,sinY)
    let dz = -cosY*fwd + sinY*strafe;
    const len=Math.hypot(dx,dz); if(len>0){ dx/=len; dz/=len; }
    let moving = len>1e-4;
    const _dashing = performance.now()<_dashUntil;                 // 구르기 대시 중
    const _knocking = performance.now()<_knockUntil && !_dashing;   // ★넉백 중(구르기 우선) — 입력 무관 밀림
    if(_dashing){ dx=_dashVX; dz=_dashVZ; moving=true; }           // 입력 무관 = 구르는 방향으로 추진
    else if(_knocking){ dx=_knockVX; dz=_knockVZ; moving=true; }   // ★밀치기 방향으로 추진(입력 무시)
    if(_dashing) faceYaw = Math.atan2(dx,dz);                      // ★구르는 방향을 바라봄(앞구르기 1종이 그쪽으로)
    else if(performance.now()<_faceLockUntil) faceYaw = Math.atan2(Math.sin(yaw),-Math.cos(yaw));   // ★공격/시전 직후 = 조준방향 고정(S로 뒤로 걸어도 공격은 앞)
    else if(moving) faceYaw = Math.atan2(dx,dz);   // 평소: 캐릭터는 이동방향을 바라봄(모델 정면 +z)
    // ★스프린트 = Shift + 탈진 아님. 이동 중 지속 소모, 0되면 탈진(100% 회복까지 못 뜀 — 엘든링식)
    run = keys.has('ShiftLeft') && !(ctx.combat && ctx.combat.exhausted);
    if(run && moving && !_dashing && onGround && !fly && !_inWater && ctx.combat) ctx.combat.drainSprint(SPRINT_COST*dt);
    let sp=(_sitting?0:(_dashing?DODGE_SPEED:(_knocking?_knockSpeed:(run?9:4.5))));   // 구르기=대시속도 / 넉백=밀치기속도 / 앉으면 0
    // ★공격 모션 중 이동: 공중(점프공격)=앞으로 도약 유지(살짝만 감속) / 지상=미끄럼 방지 감속. 구르기 제외.
    //   ("하늘로 뜸"은 수평속도가 아니라 KCC 상승 문제 → 아래 mv.y 클램프로 별도 차단)
    if(!_dashing && performance.now() < _atkAnimUntil) sp *= (onGround ? BAL.feel.commit.moveSlowGround : BAL.feel.commit.moveSlowAir);   // ★B: 커밋 이동감속 SSOT(balance.js feel.commit) — 하드코딩 0.5/0.85 이관(G4)
    let pp=body.translation();
    if(_tpReq){ pp={ x:_tpReq.x, y:_tpReq.y, z:_tpReq.z }; body.setTranslation(pp,true); vy=0; onGround=false; _tpReq=null; }   // ★텔레포트 소비 — pp를 목표로 강제(다음 np가 여기서 출발) → recall/부활/저장복원 실제 이동

    // 🏊 수영 판정 + 수평 감속. 수직(부력·잠수)은 KCC 이동 후 아래 수영블록이 전담(vy 관여 안 함).
    const _wl0=(ctx.water?ctx.water.level:0);
    const _gBelow0 = ctx.terrain ? ctx.terrain.groundAt(pp.x, pp.z, pp.y+3) : -1e4;   // 발밑 지면(수영은 실제 물기둥 위에서만)
    if(_gBelow0 < _wl0-0.4 && (pp.y-FOOT)<_wl0){ vy=0; sp*=SWIM_HSPEED; }   // 물속(땅 아님): 수직 리셋 + 수평 헤엄 감속
    else { vy -= 22*dt; if(vy<-50) vy=-50; }          // 공기중/땅위: 정상 중력

    // 발밑 배 감지(현재 프레임 로컬좌표) + 🪜 사다리 승선 제한
    let ship=null;
    if(ctx.ships) for(const s of ctx.ships){ const lp=new THREE.Vector3(pp.x,pp.y,pp.z).applyMatrix4(s.curMatrix.clone().invert());
      const inBox = Math.abs(lp.x-(s.deckCx||0))<s.deckW/2+0.5 && Math.abs(lp.z-(s.deckCz||0))<s.deckL/2+0.5 && lp.y>-1 && lp.y<(s.deckTop||10)+1;
      if(!inBox) continue;
      if(_shipRef===s){ ship=s; break; }                       // 이미 탑승 중 → 갑판 어디든 자유 보행(내릴 땐 박스를 벗어남)
      if(s.ladders && s.ladders.length){                       // 사다리 있는 배 = 물에서 측면 기어오름 차단(사다리에서만)
        const nearLadder = s.ladders.some(L=> Math.hypot(lp.x-L.x, lp.z-L.z) < 3.5);
        const aboveDeck  = lp.y > (s.deckLocalY!=null?s.deckLocalY:0) - 0.6;   // 갑판 높이/위(위에서 내려옴·갑판 보행) → 허용
        if(nearLadder || aboveDeck){ ship=s; break; }          // 물높이 측면(사다리 아님)만 거부
      } else { ship=s; break; }                                // 사다리 데이터 없는 배 = 기존대로 제한 없음
    }

    let np;
    if(fly){                                          // ── 비행(V): 중력/충돌 무시 ──
      _shipRef=null; if(ctx.player) ctx.player._onShip=null;
      const up=(keys.has('Space')?1:0)-((keys.has('KeyC')||keys.has('ControlLeft'))?1:0);
      const fsp=sp*2.4*_flyMul; np={ x:pp.x+dx*fsp*dt, y:pp.y+up*fsp*dt, z:pp.z+dz*fsp*dt }; onGround=false; vy=0;
    } else if(ship){                                  // ── 배 위: 로컬좌표 carry + 갑판 raycast 안착 ──
      if(ctx.player) ctx.player._onShip=ship;
      if(_shipRef!==ship){ _shipRef=ship; _local.set(pp.x,pp.y,pp.z).applyMatrix4(ship.curMatrix.clone().invert()); }
      const rotInv=new THREE.Matrix4().extractRotation(ship.curMatrix).invert();
      const moveL=(ship.boarded?new THREE.Vector3():new THREE.Vector3(dx*sp*dt,0,dz*sp*dt)).applyMatrix4(rotInv);
      // ── ⚓ 조타 중: 캐릭터 헬름에 완전 고정(이동·회전 X) + 시점 초기화 ──
      if(ship.boarded){
        if(!_wasBoarded){ const _atC = ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon';
          _shipView = _atC ? 0 : 1; third = !_atC; _steerYaw=0; _steerPitch=0; _aimSide=null; _aimYaw=0;
          _camY=null; _camVY=0;   // 🎥 승선 순간 카메라 스프링 리셋 — 안 하면 직전 지상 높이에서 스프링이 출발해 첫 프레임이 튄다
          // ⚓ 조타 진입 = 맨손 고정(사령관). 들고 있던 무기/도구 기억 후 빈손으로. 하선 시 복원.
          if(currentTool!=='none'){ _steerPrevTool=currentTool; equipTool('none'); } }
        // ⚔️ 스테이션별 스냅: 조타=헬름(선미쪽 오프셋) / 대포=그 대포 슬롯(1인칭 조준 자리).
        const _atCannon = ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon';
        const _anchor = _atCannon ? (ctx.crew.activeCannonLocal && ctx.crew.activeCannonLocal()) : ship.helmLocal;
        if(_anchor){
          const hw=_anchor.clone().applyMatrix4(ship.curMatrix).addScaledVector(ship.forward, _atCannon?0:_helmFwd);
          const sl=hw.applyMatrix4(new THREE.Matrix4().copy(ship.curMatrix).invert());
          _local.x=sl.x; _local.z=sl.z;
        }
        faceYaw=Math.atan2(ship.forward.x, ship.forward.z);       // 뱃머리 향함 — 마우스로 몸 안 돌아감(대포는 1인칭이라 시각 무관)
        _faceLockUntil=performance.now()+200;
      }
      else if(_wasBoarded && _steerPrevTool!=null){   // ⚓ 조타 종료(하선/헬름 이탈) 순간 — 조타 진입 때 넣어둔 무기 복원
        equipTool(_steerPrevTool); _steerPrevTool=null; }
      _wasBoarded=ship.boarded;
      const _oldLx=_local.x, _oldLz=_local.z;
      // 🪜 사다리 등반 판정(이동 전 위치 기준): 사다리 xz 1.9m 내 + W(오름)/S(내림), 조타중 제외. 등반 중엔 수평이동 무시(사다리 고정 — 진동 방지).
      // 🪜 등반 = Space(상승)/C(하강) 전용 — 보행(WASD)과 분리. '사다리 근처서 W가 위로 날아감/앞으로 못 감' 방지.
      const _footY0=pp.y-FOOT, _wantClimb=keys.has('Space')||keys.has('KeyC')||keys.has('ControlLeft');
      let _ladder=null, _nearLadder=false;
      if(ship.ladders) for(const L of ship.ladders){ if(L.yTop==null) continue;
        let dL, _ltY;
        if(ship.deckLevels){   // ★회전·스케일 프레임(queen 등): 사다리 '월드' 위치 vs 플레이어 월드 = 프레임 무관(로컬거리는 어긋남)
          const _lwt=_lvTmp.set(L.x,L.yTop,L.z).applyMatrix4(ship.curMatrix); _ltY=_lwt.y;
          const _lwb=new THREE.Vector3(L.x,L.yBot,L.z).applyMatrix4(ship.curMatrix);
          dL=Math.hypot(pp.x-(_lwt.x+_lwb.x)/2, pp.z-(_lwt.z+_lwb.z)/2);
        } else {               // 기존(caravel 등): 로컬좌표 거리(검증된 동작 유지)
          dL=Math.hypot(_oldLx-L.x, _oldLz-L.z);
          _ltY=new THREE.Vector3(L.x,L.yTop,L.z).applyMatrix4(ship.curMatrix).y;
        }
        if(dL<3.6) _nearLadder=true;                 // 접근 구역(넓힘): 벽 차단 해제 + 표식 근처면 안내
        if(dL<2.8 && !_ladder){                       // 사다리 2.8m(넓힘 — 빛기둥 근처서 쉽게 잡힘) + 상단보다 약간 위 이하 = 등반 대상
          if(_footY0 < _ltY+0.5) _ladder=L; } }
      const _climbing = _ladder && !ship.boarded && _wantClimb;
      if(ctx.player){ ctx.player._climbing=_climbing; ctx.player._nearLadder=_nearLadder; }   // 디버그 노출
      if(!_climbing){
        const _cx=ship.deckCx||0, _cz=ship.deckCz||0;   // 갑판 중심오프셋(bake 후 비대칭 갑판 — 가장자리 물빠짐 방지)
        _local.x=Math.max(_cx-ship.deckW/2+0.2, Math.min(_cx+ship.deckW/2-0.2, _local.x+moveL.x));   // 뱃머리 끝까지
        _local.z=Math.max(_cz-ship.deckL/2+0.3, Math.min(_cz+ship.deckL/2-0.3, _local.z+moveL.z));
        const mr=Math.hypot(_local.x,_local.z); if(mr<0.7&&mr>1e-3){ _local.x/=mr*1.43; _local.z/=mr*1.43; }  // 돛대(중앙 0.7m)만 충돌
      }
      if(_climbing){
        _local.x=_ladder.x; _local.z=_ladder.z;                                    // 사다리에 스냅
        // 사다리 상/하단을 ship.curMatrix로 월드 변환(파도·틸트 반영 — buoyY 직접쓰면 어긋남).
        const lwB=new THREE.Vector3(_ladder.x,_ladder.yBot,_ladder.z).applyMatrix4(ship.curMatrix);
        const lwT=new THREE.Vector3(_ladder.x,_ladder.yTop,_ladder.z).applyMatrix4(ship.curMatrix);
        const yBotW=lwB.y-0.8, yTopW=lwT.y+1.3;                                     // 등반 상/하 한계(상단 +1.3m=선미루 갑판 높이, 솟구침 방지)
        const dir=keys.has('Space')?1:-1; let nf=(pp.y-FOOT)+dir*3.0*dt;            // Space=상승 / C·Ctrl=하강, 3.0m/s
        nf=Math.max(yBotW, Math.min(yTopW, nf));
        np={ x:lwT.x, y:nf+FOOT, z:lwT.z }; onGround=true; vy=0;
      } else {
      // ★갑판 높이 = 발밑 메시 raycast로 자동 추종(다층 갑판, 사령관 "걸으면 알아서 높이 조절").
      //   단일 deckLocalY는 XZ 기준점/폴백으로만. 천·밧줄은 걷는 면 아니라 제외. 계단높이(MAXUP) 이하 최상단면을 밟음.
      _local.y = (ship.deckLocalY!=null?ship.deckLocalY:0); let w=_local.clone().applyMatrix4(ship.curMatrix);
      const footY=pp.y-FOOT, MAXUP=1.8;
      // 메시 식별 = object 이름 + material 이름(둘 다). caravel처럼 술통·대포가 같은 material(DeckStuff)을 공유해도 object 이름(Barrel001 등)으로 구분.
      const nmOf=(o)=>{ const m=o.material, mn=(Array.isArray(m)?m[0]:m); return (o.name||'')+' '+((mn&&mn.name)||''); };
      const SKIP=/sail|rope|flag|cloth/i;                     // 걷는 면 아님(통과 — 그 아래 갑판을 밟음)
      const OBST=/barrel|box|crate|cannon|anchor|bollard/i;   // 못 밟고 옆으로 막히는 장애물(술통·상자·대포 등)
      const scanDeck=()=>{ let dY=null;
        _shipRC.set(new THREE.Vector3(w.x, footY+MAXUP+(ship.deckTop||40), w.z), _dn);
        // ★deckLevels(queen 등 무명메시 다층): 실제 지오메트리(계단·모든 갑판) 따라걷기. 발(footY)에 '가장 가까운' up면 디딤.
        //   발 위는 STEP_UP(계단 한 칸)까지만 → 멀리 위 잡동사니(돛대·높은 난간) 제외해 떨림 방지. 계단(완만 경사)도 밟음.
        //   bake로 좌표 정렬 + 오프셋 클램프(물빠짐 방지) + 벽충돌off가 깔려 있어 이 방식이 안정적으로 동작.
        if(ship.deckLevels && ship.deckLevels.length){
          // ★다른 배 방식: '발+STEP_UP 이내 최상단 up면' = 올라가는 계단(발 위 칸)도 밟아 오름 + 발 아래 최상단으로 내려감(양방향).
          //   STEP_UP은 갑판층 간격(1.8)보다 작게(1.0) → 위층/위갑판을 천장으로 안 잡음(밑층빠짐·튐 방지).
          const STEP_UP=1.0;
          let best=null;
          for(const h of _shipRC.intersectObject(ship.mesh,true)){
            if(!(h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y>0.45)) continue;  // up면(계단 디딤판 포함)
            if(h.point.y > footY+STEP_UP) continue;       // 발+STEP_UP 위 = 위층/천장 → 제외
            if(best==null || h.point.y > best) best=h.point.y;   // 그 이하 '최상단'(계단 위 칸 우선 → 오르기)
          }
          return best;
        }
        // ★flatDeck(무명메시 단층): 추종 끄고 '단일평면' 고정. 높이=flatDeckY 우선, 없으면 deckLocalY.
        if(ship.flatDeck){ const fy=(ship.flatDeckY!=null?ship.flatDeckY:(ship.deckLocalY||0));
          return _local.clone().setY(fy).applyMatrix4(ship.curMatrix).y; }
        for(const h of _shipRC.intersectObject(ship.mesh,true)){
          const nm=nmOf(h.object);
          if(SKIP.test(nm) || OBST.test(nm)) continue;        // 천·밧줄·깃발 + 장애물(술통 등) = 걷는 면 아님 → 그 아래 갑판을 밟음
          const up=h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y>0.5;
          if(up && h.point.y<=footY+MAXUP){ dY=h.point.y; break; } }   // 발+계단높이 이하 최상단 갑판면
        return dY; };
      let deckTopY=scanDeck();
      // 갑판면 못 찾거나(null) 물까지 추락할 깊이(>7m 아래)면 → 현재 높이 유지(물 빠짐 방지). 층 하강(≤7)은 허용(가만 두면 못 움직임).
      // ★SIM-M3(BUG-2) 수정: 이 폴백(deckTopY=footY)이 '접지'로 취급되면 점프 정점이 새 접지면이 되어
      //   Space 연타마다 고도가 누적(실측 +8.47m 공중부양). → 폴백 여부를 기억해 접지(onGround) 판정에서 제외.
      //   높이 유지(물 빠짐 방지)는 그대로, 점프 재장전만 차단.
      let _deckNoFace = (deckTopY==null || deckTopY < footY-7.0);
      if(_deckNoFace) deckTopY = footY;
      // ★수평 충돌 2단: ① 걸음높이 위(footY+2.0) = 선실벽·돛대(밧줄·천 제외) ② 발 근처(footY+0.5) = 낮은 장애물(술통·상자·대포)만.
      //   ②가 낮은 술통을 막아 '술통 밟고 오르기/관통'을 방지. 갑판·계단 단차는 ②에서 OBST만 보므로 통과(보행 유지).
      const _mvx=w.x-pp.x, _mvz=w.z-pp.z, _mvd=Math.hypot(_mvx,_mvz);
      // ★flatDeck/deckLevels: 무명메시라 난간·화물이 다 '벽'으로 잡혀 옆삐짐 유발 → 수평 벽충돌 끔.
      //   갑판 밖 이탈은 위 deckW/deckL 클램프(_local.x/z)가 막으므로 물 빠짐 없음.
      if(_mvd>1e-4 && !_nearLadder && !ship.flatDeck){    // 사다리 접근 구역(3.5m)에선 벽 차단 해제 → 선미루 앞벽 통과해 사다리로
        const _dir=new THREE.Vector3(_mvx/_mvd,0,_mvz/_mvd);
        _shipRC.set(new THREE.Vector3(pp.x, footY+2.0, pp.z), _dir);   // ① 가슴높이 = 선체/선실벽(낮은 대포는 이 위 안 걸려 통과). deckLevels 배 '벽 뚫림' 방지.
        let wall=_shipRC.intersectObject(ship.mesh,true).find(h=>{ if(h.distance>_mvd+0.5) return false; return !SKIP.test(nmOf(h.object)); });
        if(!wall && !ship.deckLevels){ _shipRC.set(new THREE.Vector3(pp.x, footY+0.5, pp.z), _dir);   // ② 낮은 장애물 — deckLevels(무명메시) 배는 스킵(잡동사니 옆삐짐 방지)
          wall=_shipRC.intersectObject(ship.mesh,true).find(h=>{ if(h.distance>_mvd+0.5) return false; return OBST.test(nmOf(h.object)); }); }
        if(wall && wall.face){   // ★face 없는 히트(Line/화살표 등)는 무시 — face.normal null 참조 에러 방지
          // ★벽 슬라이드(끼임 방지): 벽 법선(수평) 성분만 제거 → 벽/돛을 따라 미끄러짐. 정면이면 정지.
          const wn=wall.face.normal.clone().transformDirection(wall.object.matrixWorld); wn.y=0;
          const _cx=ship.deckCx||0, _cz=ship.deckCz||0;   // 갑판 중심오프셋(비대칭 갑판 클램프)
          if(wn.lengthSq()>1e-6){ wn.normalize(); const dot=_mvx*wn.x+_mvz*wn.z;
            const sx=_mvx-dot*wn.x, sz=_mvz-dot*wn.z;                  // 벽 평면으로 투영
            const tl=new THREE.Vector3(pp.x+sx,0,pp.z+sz).applyMatrix4(ship.curMatrix.clone().invert());
            _local.x=Math.max(_cx-ship.deckW/2+0.2,Math.min(_cx+ship.deckW/2-0.2,tl.x));
            _local.z=Math.max(_cz-ship.deckL/2+0.3,Math.min(_cz+ship.deckL/2-0.3,tl.z));
          } else { _local.x=_oldLx; _local.z=_oldLz; }
          w=_local.clone().applyMatrix4(ship.curMatrix);
          deckTopY=scanDeck(); _deckNoFace=(deckTopY==null||deckTopY<footY-7.0); if(_deckNoFace) deckTopY=footY;
        }
      }
      // ★SIM-M2(BUG-1) 수정 — 갑판보행은 Rapier를 안 타서 갑판 위에 세운 fortify 블록·건축물 콜라이더를
      //   관통하던 것(실측 점유 17~66틱). 수평 이동 적용 전 물리 레이 1발(발높이+1.0, 이동방향)로 차단.
      //   배 자신(갑판 콜라이더)·플레이어 바디는 제외 — 기존 ship.mesh 벽 raycast(선실/돛대)는 그대로 병행.
      { const _pdx=w.x-pp.x, _pdz=w.z-pp.z, _pd=Math.hypot(_pdx,_pdz);
        if(_pd>1e-4 && world && RAPIER){
          const _pray=new RAPIER.Ray({ x:pp.x, y:footY+1.0, z:pp.z }, { x:_pdx/_pd, y:0, z:_pdz/_pd });
          // ★재진입 버그 수정(2026-07-04): 필터 콜백 안에서 c2.parent()(Rapier 호출) = castRay 빌림 중 재진입 → 물리월드 오염
          //   → 배 setNextKinematicTranslation 예외 → 배 안 움직임. 콜백 제거: 플레이어는 내장 excludeRigidBody(7번째)로 제외,
          //   배 판정은 castRay 끝난 뒤(월드 미빌림) 안전하게.
          const _phit=world.castRay(_pray, _pd+0.45, true, undefined, undefined, undefined, body);   // body=플레이어 바디 제외
          if(_phit){
            let _b2=null; try{ _b2=_phit.collider&&_phit.collider.parent?_phit.collider.parent():null; }catch(_){}
            const _bh=_b2?_b2.handle:-2, _isShip=(ship&&ship.body&&_bh===ship.body.handle);   // 배 자기 갑판 콜라이더면 통과
            if(!_isShip){ w.x=pp.x; w.z=pp.z;   // 벽(fortify 블록 등) = 수평 정지
              deckTopY=scanDeck(); _deckNoFace=(deckTopY==null||deckTopY<footY-7.0); if(_deckNoFace) deckTopY=footY; }
          }
        } }
      if(vy>0 || footY>deckTopY+0.06){          // 점프 중 or 갑판 위로 떠 있음 → 물리 낙하/착지
        vy-=22*dt; let ny=pp.y+vy*dt;
        // ★폴백면(_deckNoFace) 위 '착지'는 접지 아님 — 높이만 붙잡고 onGround=false(점프 재장전 차단 = 래칫 방지)
        if(ny-FOOT<=deckTopY){ ny=deckTopY+FOOT; vy=0; onGround=!_deckNoFace; } else onGround=false;
        np={ x:w.x, y:ny, z:w.z };
      } else {                                  // 갑판에 디딤 → 즉시 스냅 (폴백면이면 접지 아님)
        np={ x:w.x, y:deckTopY+FOOT, z:w.z }; onGround=!_deckNoFace; vy=0;
      }
      }   // ← 사다리 등반(_climbing) else: 갑판 추종 닫기
    } else if(window.__noclipOn){
      // 🛠️ 노클립(디버그) — 충돌·중력 무시하고 자유 비행. 막힌 곳 확인/통과용.
      //   콘솔: __noclip()  토글 · __noclip(2) 속도배율 · Space=상승 · Shift=하강(또는 달리기키와 겸용)
      _shipRef=null; if(ctx.player) ctx.player._onShip=null;
      const nsp = sp * (window.__noclipSpeed || 3);
      let uy = 0;
      if(keys.has('Space')) uy += 1;
      if(keys.has('ShiftLeft') || keys.has('ShiftRight')) uy -= 1;
      np = { x: pp.x + dx*nsp*dt, y: pp.y + uy*nsp*dt, z: pp.z + dz*nsp*dt };
      vy = 0; onGround = true; _inWater = false;
    } else {                                          // ── 지면/물: Rapier 캐릭터 컨트롤러 ──
      _shipRef=null; if(ctx.player) ctx.player._onShip=null;
      ctrl.computeColliderMovement(col, { x:dx*sp*dt, y:vy*dt, z:dz*sp*dt });
      const mv=ctrl.computedMovement(); onGround=ctrl.computedGrounded();
      // ★공중 상승 중(vy>0) 수평이동이 KCC autostep/경사를 타고 추가로 위로 밀어올리는 것 차단 → 점프공격 "하늘로 뜸" 버그.
      //   의도한 상승치(vy*dt)보다 크면 잘라냄. 앞으로 도약(mv.x/z)은 유지. 지상 계단 오르기(onGround)엔 영향 없음.
      if(!onGround && vy>0 && mv.y > vy*dt + 1e-4) mv.y = vy*dt;
      if(!onGround && vy<0 && mv.y > vy*dt*0.5) onGround=true;   // 아래로 가려는데 막힘 = 땅(trimesh서 grounded 누락 보정 → 떠보임·낙하애니 방지)
      if(onGround&&vy<0)vy=0;
      np={ x:pp.x+mv.x, y:pp.y+mv.y, z:pp.z+mv.z };
      const WL=(ctx.water?ctx.water.level:0); _inWater=false;
      // 🏊 공중 수영 버그(사령관 2026-07-10) 방지: 발이 수면 높이 아래여도 그 지점 아래에 '실제 물기둥'이 있을 때만 수영.
      //   지면(groundAt)이 수면보다 높으면 = 땅/해변 위 공중이라 수영 발동 금지(onGround 깜빡임 시 잘못 뜨던 것).
      const _gBelow = ctx.terrain ? ctx.terrain.groundAt(np.x, np.z, np.y+3) : -1e4;
      const _openWater = _gBelow < WL - 0.4;
      if(!onGround && _openWater && (np.y-FOOT) < WL){ _inWater=true; vy=0;
        const footY=np.y-FOOT;
        // 🏊 수직 유영: Space=상승 / C·Ctrl=잠수 / 아니면 시선 pitch 방향 유영(W 전진 시 위·아래) + 수면 부력 복원
        let rise;
        if(keys.has('Space')) rise=3.0;
        else if(keys.has('KeyC')||keys.has('ControlLeft')) rise=-2.6;
        else {
          const climb = Math.sin(pitch) * fwd * (run?4.2:3.0);              // pitch>0(위봄)+W=상승 / 아래봄+W=하강
          const buoy  = Math.max(-0.8, Math.min(1.4, ((WL-0.6) - footY)*1.5));  // 완만한 수면 부력(어깨가 수면 근처)
          rise = climb + buoy;
        }
        np.y += rise*dt;
        const cap=WL-0.3+FOOT; if(rise>0 && np.y>cap) np.y=cap;             // 수면 위로 안 솟음
        const floorY=(ctx.seabed?ctx.seabed.level:-1e4)+FOOT+0.1; if(np.y<floorY) np.y=floorY;   // 해저 바닥 아래로 안 뚫음
      }
      // 🪜 지상 사다리(던전 등 — ctx.ladders 등록분). [E]로 잡고(mount) → W=오름 / S=내림. 잡는 순간 grab 모션.
      if(ctx.ladders && ctx.ladders.length && !_inWater && !fly){
        const fY=np.y-FOOT; let lad=null, bd=1e9;
        for(const L of ctx.ladders){ const d=Math.hypot(np.x-L.x, np.z-L.z);
          if(d<2.4 && fY<L.yTop+1.6 && fY>L.yBot-1.6 && d<bd){ bd=d; lad=L; } }   // ★2026-07-17(사령관 "다가갔을 때 E 안됨"): 1.8→2.4 — 던전 하층 통로가 3칸 폭이라 중앙 사다리에서 살짝만 벗어나도 반경 밖이었음(상자2.0/레버2.2보다도 좁았음)
        if(lad && !_onLadder && !lad._prompted){ lad._prompted=true; if(ctx.invui&&ctx.invui.toast) ctx.invui.toast('[E] 사다리를 잡는다'); }   // ★사다리 [E] 안내(누락돼 있던 것 — 상자/레버와 동일 패턴)
        const eNow = keys.has('KeyE');
        // [E] 엣지 → 잡기(근처 사다리) / 놓기(등반 중)
        if(eNow && !_ladderEPrev){
          if(_onLadder) _onLadder=null;
          else if(lad){ _onLadder=lad; _ladderGrabT=0.35; np={ x:lad.x, y:np.y, z:lad.z }; }
        }
        _ladderEPrev = eNow;
        // 잡은 사다리 범위 이탈 시 자동 해제
        if(_onLadder && Math.hypot(np.x-_onLadder.x, np.z-_onLadder.z) > 2.6) _onLadder=null;
        if(_onLadder){
          const L=_onLadder;
          if(_ladderGrabT>0) _ladderGrabT=Math.max(0,_ladderGrabT-dt);   // 잡기 모션 동안엔 살짝 정지감
          const dir = keys.has('KeyW')?1 : (keys.has('KeyS')?-1 : 0);    // W=오름 / S=내림
          const sp = _ladderGrabT>0 ? 1.2 : 3.2;
          let nf = fY + dir*sp*dt; nf = Math.max(L.yBot-0.3, Math.min(L.yTop+1.5, nf));
          np={ x:L.x, y:nf+FOOT, z:L.z }; onGround=true; vy=0;
          if(ctx.player) ctx.player._climbing=true;
          // 꼭대기 도달 → 하차. 사다리 칸은 상층 바닥 '구멍'이라 제자리에 놓으면 재낙하 → ex/ez(단단한 바닥)로 내보냄.
          if(nf >= L.yTop+1.3 && dir>0){ _onLadder=null;
            if(L.ex!==undefined){ np={ x:L.x+L.ex, y:L.yTop+FOOT+0.15, z:L.z+L.ez };
              // ★착지 위치(ex/ez)로 몸을 반대방향으로 밀어내면서 시야는 그대로라 "뒤로 착지"하는 것처럼 보이던 것 — 착지 방향을 바라보게 정렬(2026-07-16)
              const _exYaw = Math.atan2(L.ex, -L.ez); yaw = _exYaw; faceYaw = _exYaw; } }
        } else if(ctx.player) ctx.player._climbing=false;
        if(ctx.player){ ctx.player._nearLadder = !!lad && !_onLadder; ctx.player._onLadder = !!_onLadder; }   // UI 프롬프트/검증용(매 프레임 객체 할당 금지)
      } else { _onLadder=null; if(ctx.player){ ctx.player._nearLadder=false; ctx.player._onLadder=false; } }
    }
    body.setNextKinematicTranslation(np);

    // ── 카메라 ── (look = 마우스 yaw/pitch 방향)
    const look=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch));
    const eye=new THREE.Vector3(np.x, np.y+EYE-FOOT, np.z);
    if(third){
      if(headBone) headBone.scale.setScalar(1);
      // ── 오버숄더(어깨 너머) — 카메라를 우측으로 오프셋(캐릭터 화면 좌측에). 조준 시 줌인. ──
      _camRight.crossVectors(look, _UPv).normalize();
      // 시네마틱 pull-back 보간(곡 재생 중 살짝 멀어짐)
      if(performance.now()>_cineUntil) _cineTarget=1;
      _cineZoom += (_cineTarget-_cineZoom)*Math.min(1,dt*2.5);
      // 조준(우클릭): 줌인 + 캐릭터 11시(좌상단)로 = 어깨↑ + 카메라 낮춰(캐릭터 화면 위로) → 다리 더 잘림
      const _dist = (_aiming ? camDist*0.7 : camDist) * _cineZoom;   // ×_cineZoom = 시네마틱 pull-back
      const _sh   = _aiming ? camShoulder*1.6 : camShoulder;   // 조준 시 캐릭터 더 왼쪽(11시)
      const _up   = _aiming ? camUp-0.35 : camUp;              // 조준 시 카메라↓ → 캐릭터 화면 위로(11시 상단)
      camera.position.copy(eye).addScaledVector(look,-_dist).addScaledVector(_camRight,_sh); camera.position.y += _up;
      // ★표준 TPS: 카메라는 '조준 방향(look)' 자체를 본다 → 화면중앙=크로스헤어, 캐릭터는 어깨오프셋으로 좌측 고정(pitch 무관 안정)
      camera.lookAt(camera.position.x+look.x, camera.position.y+look.y, camera.position.z+look.z);
      if(avatar){ avatar.visible=true;
        // ★마우스로 카메라만 공전 — 캐릭터는 '이동방향(faceYaw)'을 봄(정지 시 가만, W로 움직일 때만 그쪽으로 회전).
        //   조준(우클릭) 중에만 카메라 정면(yaw)을 봐서 조준 방향과 일치.
        const _tgt = _aiming ? Math.atan2(Math.sin(yaw), -Math.cos(yaw)) : faceYaw;
        const d=((_tgt-avatar.rotation.y+Math.PI)%(2*Math.PI))-Math.PI;
        avatar.rotation.y += d*Math.min(1,dt*16); }
    } else {
      // 1인칭 = viewmodel(무기 손코너, 항상 보임). 진짜 콤보 애니는 3인칭(F)에서.
      if(headBone) headBone.scale.setScalar(1);
      camera.position.copy(eye); camera.lookAt(eye.clone().add(look));
      if(avatar){ avatar.visible=false; avatar.rotation.y=yaw; }
    }
    if(avatar) avatar.position.set(np.x, np.y-FOOT, np.z);
    // ── ⚓ 조타 카메라: 선미 뒤·위에서 '뱃머리 앞'을 봄(블랙플래그식 — 항해·전투 항상). 마우스(우클릭)로 뷰 회전=조준. ──
    _navAiming=false;
    const _sh = ship || ctx.ship;   // 조타 중엔 갑판 박스 감지(ship)와 무관하게 ctx.ship 사용
    if(_sh && _sh.boarded && third && _shipView>0 && _sh.forward){
      const canAim = !(ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon');
      _navAiming = canAim && _aimSide!=null;   // ⚔️ Q/E 대포 조준 = 밴드·발사 트리거 + 카메라를 선택 현측으로 회전(사령관 확정 — 현측 대포 방향을 본다).
      const cx=np.x, cy=(np.y-FOOT)+2.4, cz=np.z;
      if(_navAiming){
        // ⚔️ 대포 조준 카메라 — 앵커=배 중심(조타수 아님). 현측 대포 라인 위에서 바깥·아래를 봐 대포가 화면 하단에 걸침(블랙플래그식). __aimCam(inboard,h,pitch,look)로 튜닝.
        const S = _sh;                                              // ★배 중심(x,z)·갑판 높이 기준 (np=선미 조타수 앵커 폐기 — top-down 원인)
        const deckY = (S.mesh?S.mesh.position.y:0) + S.deckLocalY;  // 갑판 월드 높이(≈3)
        const sv = (_aimSide==='port') ? S.portSide : S.starboardSide;
        const az = Math.atan2(sv.x, sv.z) + _aimYaw;               // 현측 바깥 방위 + 마우스 좌우 스윙(밴드·실탄도와 동일 각)
        const ox = Math.sin(az), oz = Math.cos(az);                // 바깥 수평 단위벡터(=sv + swing)
        camera.position.set(S.x - ox*_aimInboard, deckY + _aimH, S.z - oz*_aimInboard);   // 중심에서 현측 반대로 물러서·위 → 대포가 카메라 앞에 옴
        const ph = _aimPitchBase, cph=Math.cos(ph), look=_aimLookDist;
        camera.lookAt(S.x + ox*cph*look, deckY + Math.sin(ph)*look, S.z + oz*cph*look);   // 현측 바깥·살짝 아래로 응시
        if(avatar) avatar.visible=true;
      } else {
        const fwd=_sh.forward;
        const far=_shipView===2;
        const az=Math.atan2(fwd.x,fwd.z)+_steerYaw, ph=_steerPitch;        // 항해/자유 시점(우클릭 회전)
        const dist=(far?_steerFar:_steerNear), h=(far?_steerH*1.1:_steerH*0.7);
        const cph=Math.cos(ph), ldx=Math.sin(az)*cph, ldy=Math.sin(ph), ldz=Math.cos(az)*cph;
        // 🎥 ── 승선 카메라 스프링(2026-07-22, 감사 M8) ──────────────────────────────
        //   예전엔 camera.position을 선체 좌표로 **매 프레임 직접 대입**해 카메라가 선체에 용접돼 있었다.
        //   시점이 선체와 1:1로 움직이면 "배가 내 밑에서 움직인다"는 감각이 생기지 않는다(= 인위적).
        //   상하(heave)만 스프링-댐퍼로 지연시키고 좌우/전후는 그대로 둔다(멀미·조준 정확도 보호).
        //   ship.js의 _pitchGain을 2.2→1.0으로 정직화하면서 잃는 극적 연출을 여기서 되찾는다.
        const _CAM=(BAL_SAIL&&BAL_SAIL.cam)||null;
        const tgtY = cy - ldy*dist + h;
        let outY = tgtY;
        if(_CAM){
          if(_camY==null){ _camY=tgtY; _camVY=0; }
          const _cdt=Math.min(dt,0.05);
          _camVY += ((tgtY-_camY)*_CAM.heaveK - _camVY*_CAM.heaveC)*_cdt;   // 스프링-댐퍼(선체를 뒤늦게 따라감)
          _camY  += _camVY*_cdt;
          if(_camY > tgtY+_CAM.heaveMax) _camY = tgtY+_CAM.heaveMax;        // 지연 상한 — 물속/공중으로 튀지 않게
          if(_camY < tgtY-_CAM.heaveMax) _camY = tgtY-_CAM.heaveMax;
          outY = _camY;
          // 착수 충격 → 쉐이크. ship.js가 물보라와 같은 순간에 landImpact를 세팅하고 여기서 **소비(0으로 리셋)** 한다.
          //   ⚠️전용 쉐이크를 새로 만들지 않는다 — 기존 camShake()(타격감 A3)가 이미 임펄스+지수감쇠를 처리하고
          //     아래 1517줄에서 카메라 위치 확정 후 오프셋을 가산한다. 두 벌이면 감쇠가 이중으로 걸린다.
          if(_sh.landImpact){ camShake(_sh.landImpact*_CAM.shakeOnLand); _sh.landImpact=0; }
        }
        camera.position.set(cx - ldx*dist, outY, cz - ldz*dist);
        camera.lookAt(cx + ldx*dist, cy + ldy*dist, cz + ldz*dist);
        // 뱅크(좌우 기울기) 일부만 시야에 반영 — 1:1이면 멀미, 0이면 배가 안 기운 것처럼 보인다.
        //   ⚠️이 코드베이스는 축 이름이 뒤집혀 있다: bs.pitchA=좌우(뱅크) / bs.roll=앞뒤. heel(선회)은 좌우에 합산됨.
        if(_CAM && _CAM.rollFollow) camera.rotateZ(((_sh.pitchA||0)+(_sh.heel||0))*_CAM.rollFollow);
        if(avatar) avatar.visible=true;
      }
    }
    // ⚔️ 대포 1인칭 조준 카메라 — 대포 슬롯에 고정(발밑 raycast 떨림 제거) + 포 뒤·위에서 봄(포신이 화면에 보임). look=조준·발사 방향과 일치.
    else if(_sh && _sh.boarded && !third && ctx.crew && ctx.crew.playerStation && ctx.crew.playerStation()==='cannon' && ctx.crew.activeCannonLocal){
      const cl = ctx.crew.activeCannonLocal();
      if(cl){ const base=cl.clone().applyMatrix4(_sh.curMatrix);            // 대포 월드 위치(배 출렁만 따라감)
        // 현측(좌/우현) 기준 + 마우스 오프셋(협소각) = 조준·발사 방향(dir). 배가 돌아도 현측 상대 유지.
        const sv = (ctx.crew.activeCannonIsLeft && ctx.crew.activeCannonIsLeft()) ? _sh.portSide : _sh.starboardSide;
        const aimA = Math.atan2(sv.z, sv.x) + _cannonYawOff, cp = Math.cos(_cannonPitchAim);
        _cannonDir.set(Math.cos(aimA)*cp, Math.sin(_cannonPitchAim), Math.sin(aimA)*cp);
        // ★1인칭 포수 시점: 대포 바로 뒤(0.9m)·눈높이(1.3m) → 포신이 화면 앞에 보임(사령관: 3인칭 아니라 1인칭)
        const cx=base.x - _cannonDir.x*0.9, cy=base.y + 1.3, cz=base.z - _cannonDir.z*0.9;
        camera.position.set(cx, cy, cz);
        camera.lookAt(cx + _cannonDir.x, cy + _cannonDir.y, cz + _cannonDir.z);   // 정확히 dir(발사 방향 일치)
        if(avatar) avatar.visible=false; }
    }
    // ── 🎥 임팩트 카메라 컷인 적용(모든 카메라 모드 위에 덧씌움 — 위치 확정 후) ──
    if(_impactT>0 && camera && camera.isPerspectiveCamera){
      _impactT-=dt;
      const k=Math.max(0,_impactT/Math.max(1e-4,_impactDur)), ease=k*k*(3-2*k);   // smoothstep: 초반 강하게→끝에서 원복
      if(_impactFovBase!=null){ const narrow=(_impactKind==='hit')?5:15; camera.fov=_impactFovBase-narrow*ease; camera.updateProjectionMatrix(); }
      camera.getWorldDirection(_impF);
      if(_impactKind==='hit'){ camera.position.x+=(Math.random()*2-1)*0.5*ease; camera.position.y+=(Math.random()*2-1)*0.5*ease; camera.position.z+=(Math.random()*2-1)*0.5*ease; }   // 피격 = 흔들림 위주
      else camera.position.addScaledVector(_impF, 3.2*ease);   // 격침 = 시선방향 돌리인(타이트 구도)
      if(_impactT<=0){ if(_impactFovBase!=null){ camera.fov=_impactFovBase; camera.updateProjectionMatrix(); } _impactFovBase=null; _impactKind=null; }
    }
    // ── 타격감 A3: 카메라 킥 적용 — ★반드시 맨 마지막(걷기/조타/조준/대포1인칭/임팩트 모든 camera.position.set 이후). 앞에 두면 ship 분기가 킥을 덮어써 조타/조준 발사 흔들림이 사라졌음(사령관 확정 버그). 랜덤 오프셋 가산 후 지수감쇠. ──
    if(_camShake > 0.0005){
      _shakeV.set(Math.random()*2-1, Math.random()*2-1, Math.random()*2-1).multiplyScalar(_camShake);
      camera.position.add(_shakeV);   // 최종 위치에 얹음 = 모든 모드에서 화면이 툭 튀는 킥(조준방향 유지)
      _camShake *= Math.pow(0.5, (dt*1000)/BAL.feel.camShake.decayMs);   // 반감기 decayMs 지수감쇠
      if(_camShake < 0.0005) _camShake = 0;
    }
    // 1인칭 viewmodel: FP에서만 표시 + 클래스별 스윙 + 활 당기기
    vmRig.visible = !third && !(ctx.ship&&ctx.ship.boarded);   // ★조타 중(boarded)엔 무기 뷰모델 off — 배 몰 때 검+방패 들고 있던 것 제거(사령관)
    if(drawing) drawT += dt;   // 당긴 시간 누적
    if(!third){
      if(drawing){ vmSwingG.quaternion.identity(); vmSwingG.position.copy(vmRest);   // 당길 땐 스윙 X(고정)
        if(vmArrow){ const dp=Math.min(1,drawT/DRAW_TIME); vmArrow.position.z=(vmArrow.userData.baseZ||-0.5)+dp*0.13; } }   // 화살 시위 따라 뒤로
      else if(heldSwing>0){ heldSwing=Math.max(0, heldSwing - dt*curSwing.speed); const p=1-heldSwing;
        if(vmOffSwing){   // 쌍수: 번갈아 — _dualHand 손만 스윙, 반대손은 휴식자세 유지
          if(_dualHand===1){ applyVMOffPose(p); vmSwingG.quaternion.identity(); vmSwingG.position.copy(vmRest); }
          else { applyVMPose(p); vmOff.quaternion.identity(); vmOff.position.copy(vmOffRest); }
        } else applyVMPose(p);
      }
      else { vmSwingG.quaternion.identity(); vmSwingG.position.copy(vmRest);
        if(vmOffSwing){ vmOff.quaternion.identity(); vmOff.position.copy(vmOffRest); } }
    }

    // 애니메이션 — 사용모션(_useUntil) 중엔 안 덮음. 공중(0.15s↑ 진짜 점프)=점프, 아니면 이동/대기.
    const _restY = Math.abs(np.y - pp.y) < 0.06;         // 수직 이동 거의 0 = 바닥 디딤(trimesh서 grounded 누락돼도 낙하자세·떠보임 방지)
    _airTime = (onGround||_inWater||_restY) ? 0 : _airTime+dt;   // onGround 한프레임 깜빡임 디바운스(달리며 회전 시 점프자세 튐 방지)
    const bowEq=(currentTool==='bow'||currentTool==='crossbow');
    if((_inWater||fly) && _sitting) _sitting=false;   // 물속·비행 진입 시 일어남
    const _locked = performance.now() < _useUntil;   // 액션/지속상태(공격·당기기·가드) 모션 진행 중
    // 🏊 수영 상태 = 물에 떠 있음(발 물속·바닥 안딛음·배 아님·비행 아님). 몸통 피치 lerp(진입/이탈 부드럽게).
    //   ★몸통 피치 = 마우스 시선(pitch) 추종 → 시선 방향으로 유영(구버전 고정 82° 엎드림 폐지, 사령관 "앞으로 가도 바닥으로 기울어짐").
    //     시선 수평(pitch 0)=정면 유영 / 시선 아래(pitch<0)=다이브 / 시선 위(pitch>0)=상승. 부호(±pitch)는 실측으로 확정.
    // ★2026-07-10(사령관 "배 위에서 움직이는데 수영모션이 나왔다안나왔다함") — 예전엔 ctx.ship.boarded(조타/대포를
    //   실제로 잡고 있을 때만 true)로 제외해서, 그냥 갑판 위를 걸어다닐 땐(스테이션 미점유) 파도에 갑판이 잠깐 물밑으로
    //   내려갈 때마다 수영판정이 껐다켜졌다 했음. "이 배 위에 서있다" 자체를 나타내는 _onShip으로 교체.
    _swimming = _inWater && !onGround && !fly && !ctx.player._onShip;
    if(_swimPanel) _swimPanel.style.display = window.__testMode ? 'block' : 'none';   // 🏊 튜닝 페이더 = 테스트모드(샌드박스/Ctrl+Shift+K)에서만. 본편 실플레이어에겐 안 뜸.
    const _swimTarget = _swimming ? THREE.MathUtils.clamp(SWIM_TILT - pitch*(window.__swimSign??1), 0.2, SWIM_MAX) : 0;   // 상한(SWIM_MAX)=수평 직전. ≥90°면 몸이 뒤집혀 머리 처박힘 → 방지. 슬라이더 '상한'과 연동.
    _swimTilt += (_swimTarget - _swimTilt) * Math.min(1, dt*7);
    if(avatar){ avatar.rotation.x = _swimTilt;
      // ★엎드린 몸을 수면으로 띄움(사령관 "캐릭터가 바다에 처박힘 / 머리 처박고 수영"). 발끝 피벗 회전이라 머리가 물속으로 가라앉던 것 보정.
      //   리프트 = 틸트로 내려간 상체 높이만큼 위로. window.__swimLift(기본 0.75)로 라이브 튜닝 가능.
      if(_swimTilt>0.05) avatar.position.y += (window.__swimLift ?? 0.35) * Math.sin(_swimTilt);
    }
    if(!_dead && ctx.ship && ctx.ship.boarded){
      setAction(actOf('Fishing_Struggling')||actIdle);   // ⚓ 조타 포즈 — 조타륜 잡고 씨름하듯(사령관 지정)
    }
    else if(!_dead && _swimming){   // 🏊 수영: Crawling 클립(수평틸트로 유영) — 이동=빠른 스트로크 / 정지=느린 treading
      if(actCrawl){ actCrawl.timeScale = moving ? 1.35 : 0.5; setAction(actCrawl); }
      else setAction(moving ? (actWalk||actIdle) : actIdle);
    }
    else if(!_dead && _sitting){
      // ★바닥 앉기(C): 움직이거나 공중이면 일어섬(StandUp), 아니면 앉은 자세 유지(Sit_Floor_Idle).
      if(moving || _airTime>0.15){ _sitting=false; const a=actOf('Sit_Floor_StandUp'); if(a) playOnce(a,0.1); }
      else if(performance.now()>=_useUntil) setAction(actOf('Sit_Floor_Idle')||actIdle);
    }
    else if(!_dead && _guarding){
      // ★가드: Block_Hit 재생 중엔 유지 / 이동하면 걷기·달리기(슬라이딩X) / 멈추면 즉시 막기 자세
      if(performance.now() < _blockHitUntil){ /* Block_Hit 진행 — 그대로 */ }
      else if(moving) setAction(run && actRun ? actRun : (actWalk||actIdle));
      else setAction(actOf('Melee_Blocking')||actOf('Melee_Block')||actIdle);
    }
    else if(!_dead && !_locked){
      // 잠금 풀림 = 평소 이동/대기/점프. (활 당기기 drawing은 _locked라 여기 안 들어와 → 당기는 자세 유지)
      if(_airTime>0.15 && actJump && !_locked) setAction(actJump);
      else if(moving){
        if(bowEq&&actBowRun) setAction(actBowRun);
        else if(_aiming && Math.abs(strafe)>Math.abs(fwd)+0.01) setAction(strafe>0 ? (actOf('Running_Strafe_Right')||actRun||actWalk) : (actOf('Running_Strafe_Left')||actRun||actWalk));   // ★조준하며 옆걸음
        else setAction(run && actRun ? actRun : (actWalk||actIdle));
      }
      else {   // ★무기별 대기 포즈: 활/석궁=Bow_Idle / 양손=2H_Idle / 맨손=Unarmed_Idle / 횃불=Holding_A / 그 외=Idle_A
        let idleAct = actIdle;
        if(bowEq && actBowIdle) idleAct = actBowIdle;
        else if(LOADOUT[currentTool]&&LOADOUT[currentTool].cls==='2h') idleAct = actOf('Melee_2H_Idle')||actIdle;
        else if(currentTool==='torch') idleAct = actOf('Holding_A')||actIdle;   // 🔥 횃불 = 드는 자세(Tools 세트, 사령관 지정)
        else if(currentTool==='none') idleAct = actOf('Melee_Unarmed_Idle')||actIdle;
        setAction(idleAct);
      }
    }
    // 활 시위(Draw 모프) — 당긴 시간 비례(아바타·viewmodel 둘 다). 안 당기면 0.
    const _drawAmt = drawing ? Math.min(1, drawT/DRAW_TIME) : 0;
    if(bowMorph) bowMorph.morphTargetInfluences[0]=_drawAmt;
    if(vmBowMorph) vmBowMorph.morphTargetInfluences[0]=_drawAmt;
    if(_stealthUntil && performance.now()>_stealthUntil) endStealth();   // 투명 5초 만료 → 복원
    if(_windGrp) _updateWindAura(dt);   // 바람 오라 유동장 advection + 리본 재구성(매 프레임). 쏠 때까지 유지(releaseArrow에서 해제)
    for(let i=_fxList.length-1;i>=0;i--){ if(!_fxList[i].update(dt)) _fxList.splice(i,1); }   // 회피 등 일회성 VFX
    if(mixer) mixer.update(dt);
    // ★검격 리본 = 그로기 난타(E) 때만(사령관 "기본공격 빼고 그로기 때만"). mash 창(_mashRibbonUntil) 동안만 slotR 칼날 샘플링.
    if(mixer && slotR && heldM.r && performance.now() < _mashRibbonUntil) _sampleBlade();
  });

  // ── ⚔ 자동 발도: 사령관 지시(2026-07-02) — 어그로(inCombat)만으로는 발도 안 함. 도구 들고 자유 활동.
  //    "적이 실제로 공격해올 때만" 안전 자동발도 → combat.js hitPlayer()가 ctx.player.drawWeapon() 호출.
  //    평소 발도/납도는 V 수동토글. 자동 납도(전투 종료 복귀)는 없음(수동 유지).

  ctx.player={ body, col, ctrl,
    // ★2026-07-23 넉백(보스 밀치기) — 방향(dx,dz)으로 speed(m/s) × durMs 동안 밀림. KCC 추진이라 벽은 못 뚫고, 용암 구멍으론 밀려 떨어질 수 있다.
    knockback(dx,dz,speed,durMs){ const d=Math.hypot(dx||0,dz||0)||1; _knockVX=dx/d; _knockVZ=dz/d; _knockSpeed=speed||10; _knockUntil=performance.now()+(durMs||260); },
    get pos(){return body.translation();}, get yaw(){return yaw;}, get pitch(){return pitch;},
    get camLook(){return new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));},
    setSpawn(x,y,z){ _tpReq={x:+x,y:+y,z:+z}; body.setNextKinematicTranslation({x:+x,y:+y,z:+z}); body.setTranslation({x:+x,y:+y,z:+z},true); }, keysSet:keys,   // ★_tpReq 큐 → 이동루프가 소비해 실제 이동(setTranslation만으론 kinematic 바디가 안 옮겨짐)
    // ⚓ 상선/하선(사령관 #9): 배 옆 물/부두에서 갑판으로 못 오르던 문제 → 근처 배 갑판 위로 텔레포트 / 배 위면 현측 물·해안으로.
    board(){ if(ctx.noPointerLock) return false;   // ★오프닝/컷신(튜토리얼) 중 상선 차단(사령관)
      if(!ctx.ships||!ctx.ships.length) return false;
      const p=body.translation(); let best=null,bd=1e9;
      for(const s of ctx.ships){ if(s._sunk) continue; const d=Math.hypot(s.x-p.x,s.z-p.z); if(d<bd){bd=d;best=s;} }
      if(!best||bd>50) return false;   // 너무 멀면 상선 불가
      const w=new THREE.Vector3(best.deckCx||0,(best.deckLocalY||0)+1.4,best.deckCz||0).applyMatrix4(best.curMatrix);
      body.setNextKinematicTranslation({x:w.x,y:w.y,z:w.z}); body.setTranslation({x:w.x,y:w.y,z:w.z},true); return true; },
    disembark(){ if(ctx.noPointerLock) return false; if(!_shipRef) return false; const s=_shipRef;
      const sx=(s.starboardSide&&s.starboardSide.x)||1, sz=(s.starboardSide&&s.starboardSide.z)||0;
      const fx=(s.forward&&s.forward.x)||0, fz=(s.forward&&s.forward.z)||1;
      const wl=ctx.water?ctx.water.level:0, half=(s.deckW||20)*0.5;
      // ★2026-07-23 끼임 방지(사령관 "하선 시 상대 점령섬에 끼임"): 하선점이 섬/요새 충돌체 안이면 버리고,
      //   배 주변 여러 방향(우현·좌현·선수·선미+대각)·거리 중 **캡슐이 어떤 충돌체와도 안 겹치는 첫 지점**에 내린다.
      //   테스트 캡슐 중심을 지면+1.4에 두어 평지 착지(바닥면만 접촉)는 통과, 벽/절벽/요새 내부는 차단.
      const _clear=(x,z)=>{ const gy=ctx.terrain?ctx.terrain.groundAt(x,z,120):wl; const y=Math.max(gy,wl)+1.4;
        let ok=true; try{ ok = world.intersectionWithShape({x,y,z},{w:1,x:0,y:0,z:0},new RAPIER.Capsule(0.7,0.45),undefined,undefined,undefined,body)==null; }catch(_){ ok=true; }
        return ok ? {x,y,z} : null; };
      const dirs=[[sx,sz],[-sx,-sz],[fx,fz],[-fx,-fz],[sx+fx,sz+fz],[sx-fx,sz-fz],[-sx+fx,-sz+fz],[-sx-fx,-sz-fz]];
      let land=null;
      for(const dist of [half+5, half+8, half+13, half+20]){
        for(const [dx,dz] of dirs){ const L=Math.hypot(dx,dz)||1; const spot=_clear(s.x+dx/L*dist, s.z+dz/L*dist); if(spot){ land=spot; break; } }
        if(land) break; }
      if(!land){ const ex=s.x+sx*(half+5), ez=s.z+sz*(half+5); const gy=ctx.terrain?ctx.terrain.groundAt(ex,ez,120):wl; land={x:ex,y:Math.max(gy,wl)+1.4,z:ez}; }   // 폴백: 구 동작(우현 5m)
      _shipRef=null; if(ctx.player) ctx.player._onShip=null;
      _aimSide=null; _aimYaw=0;   // ⚔️ 하선 = 대포 조준 상태 해제(잔존 시 육상 마우스 시점 회전 막힘 — 회귀 방어)
      ctx.navalcombat?.dispose?.();   // ★버그④ 방어선: 하선 시 HUD/배너 정리(본체 대응 = seaevents.js runBattle 상륙 종료조건)
      body.setNextKinematicTranslation(land); body.setTranslation(land,true); return true; },
    nearShip(){ if(!ctx.ships) return null; const p=body.translation(); for(const s of ctx.ships){ if(!s._sunk && Math.hypot(s.x-p.x,s.z-p.z)<18) return s; } return null; },
    get onShipRef(){ return _shipRef; },
    setThird:v=>{third=v;}, setFly:v=>{fly=v;}, setYaw:v=>{yaw=v; faceYaw=Math.atan2(Math.sin(v),-Math.cos(v));}, setPitch:v=>{pitch=v;}, get onShip(){return _shipRef;}, get avatar(){return avatar;},
    get onGround(){return onGround;}, get flying(){return fly;}, get running(){return run;}, get third(){return third;},
    use, playMine:use, equipTool, get currentTool(){return currentTool;}, useRight, mashTap,   // ★그로기 E 난타(검수/디버그 직접호출용 노출)
    drawWeapon, sheatheWeapon, toggleWeapon, get weaponOut(){return _weaponOut();},   // ★발도/납도(V·피격 자동발도·검수용)
    get heldR(){return heldM.r;}, get vmModel(){return vmModel;}, get isThird(){return third;},   // 🔥 횃불 불꽃이 손/뷰모델 tip에 붙게 노출
    __torchTune:(y,z,s)=>{ if(ctx.torch&&ctx.torch.tune) return ctx.torch.tune(y,z,s); },   // 불꽃 위치·크기 라이브 튜닝
    get guarding(){return _guarding;}, get stealthed(){return _stealthUntil>0;},
    playHit, playDeath, playBlockHit, reviveAnim, cinematic, camShake, navImpactCam, get dead(){return _dead;},
    releaseArrow, get aiming(){return _aiming;}, get navAiming(){return _navAiming;}, get navAimSide(){return _aimSide;}, get navAimYaw(){return _aimYaw;}, get invuln(){return performance.now()<_iframeUntil;},   // navAiming=Q/E 대포 조준 · navAimSide=선택 현측(port/starboard) · navAimYaw=마우스 좌우 조준 스윙(navalcombat이 밴드·발사에 반영)
    get steerPitch(){return _steerPitch;},   // ★해전 조준 중 마우스 위/아래(카메라 피치, -0.7~0.9) → navalcombat이 대포 사거리로 매핑
    // ── HUD 쿨다운: 공격(중앙 차지바) ── t=0(방금 공격)→1(준비완료)
    get atkCD(){ const now=performance.now(); if(now>=_atkLock) return {ready:true,t:1};
      const span=_atkLock-_atkStart; return {ready:false, t: span>0?Math.max(0,Math.min(1,(now-_atkStart)/span)):1}; },
    // ── HUD 쿨다운: 현재 무기 우클릭 특수스킬(우하단 슬롯) ──
    get skillCD(){ const cfg=LOADOUT[currentTool]; if(!cfg) return null; const now=performance.now();
      const fromRcd=(icon,label,key,dur)=>{ const end=_rcd[key]||0; const ready=now>=end; return {icon,label,ready, t: ready?1:Math.max(0,1-(end-now)/dur), secs: ready?0:(end-now)/1000}; };
      if(cfg.cls==='2h')          return fromRcd('🌀','스핀','spin',900);
      if(cfg.cls==='dualwield')   return fromRcd('👻','은신','stealth',8000);
      if(currentTool==='dagger')  return fromRcd('👻','은신','stealth',8000);
      if(currentTool==='none')    return fromRcd('🤜','박치기','headbutt',1100);
      if(cfg.magic){ const m=ctx.magic; const id=_mageSpell==='fire'?'fireball':'icebolt'; const dur=5000; const end=(m&&m._cdMap&&m._cdMap[id])||0; const ready=now>=end;
        return {icon:_mageSpell==='fire'?'🔥':'🧊', label:(_mageSpell==='fire'?'파이어볼':'아이스볼트'), ready, t: ready?1:Math.max(0,1-(end-now)/dur), secs: ready?0:(end-now)/1000}; }
      if(cfg.offhand)             return {icon:'🛡',label:'가드',ready:_guarding?false:true, t:1, hold:true, active:_guarding, secs:0};
      if(cfg.ranged)             return {icon:'🎯',label:'조준',ready:true, t:1, hold:true, active:_aiming, secs:0};
      return null; } };

  // ⚓ 상선/하선 안내 버튼(사령관 #9) — 배 근처면 상선, 배 위(비조타)면 하선. 실행은 F키(포인터락 중), 포인터락 아닐 땐 클릭도 가능.
  const _boardBtn=document.createElement('button');
  _boardBtn.style.cssText='position:fixed;left:50%;bottom:210px;transform:translateX(-50%);z-index:32;display:none;padding:9px 20px;border-radius:10px;border:1px solid rgba(201,168,90,.6);background:linear-gradient(180deg,rgba(20,28,38,.94),rgba(12,18,26,.94));color:#f0e0b0;font:700 14px Pretendard,system-ui,"Malgun Gothic";cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5)';
  document.body.appendChild(_boardBtn);
  _boardBtn.onclick=()=>{ if(_shipRef) ctx.player.disembark(); else ctx.player.board(); };
  ctx.onUpdate(()=>{
    // ★배 바깥(배 안 탔고 근처)일 때만 상선 버튼(사령관 "계속 떠있지 말고 배 바깥에서만"). 배 위·조타·컷신엔 숨김 — 하선은 Y키.
    const showBoard = !_shipRef && !(ctx.ship&&ctx.ship.boarded) && !ctx.noPointerLock && ctx.player.nearShip && ctx.player.nearShip();
    if(showBoard){ if(_boardBtn.dataset.m!=='on'){ _boardBtn.dataset.m='on'; _boardBtn.innerHTML='상선 <span style="opacity:.55">[Y]</span>'; } _boardBtn.style.display='block'; }
    else if(_boardBtn.style.display!=='none') _boardBtn.style.display='none';
  });

  return ctx.player;
}
