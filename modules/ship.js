// ship.js — 항해 조종(돛 W/S·돛각 A/D·조타 Q/E → catchF 바람추진·속도/회전 관성)은 mas updateBaseShip(6793~) 이식.
// ⚔️ broadside(현측 전투) 인터페이스 추가: ctx.ship.starboardSide/portSide(월드 단위벡터) + sideToward(target).
//    cannon.js가 측면 정렬을 판정해 좌현/우현 일제사격에 사용. 측면 화살(우현=초록/좌현=빨강)로 시각화.
// ★부력은 mas에 없음(mas 배는 oy=SEA_LEVEL-nly 고정으로 평평하게 뜸·출렁임 없음). → 부력 물리 새 설계:
//   선체 하부 4점 프로브에서 파도높이(water.heightAt) 샘플 → 평균수면−흘수비로 평형 y 자동(흘수 추측 제거)
//   + 프로브 깊이차로 roll/pitch + 1차 스프링-댐퍼(폭발 없는 자연스러운 출렁). kinematic 유지(갑판 carry 호환).
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';   // OBJ 원본 텍스처(mtl 있는 배 — shipx 등)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';   // 스킨 메시 클론(조타수 복제용)
import { makeClothSail } from './sail.js';   // 천 물리 돛(메인급 시스템, 모든 배 공용)
import { polarCatch, windAngleOff } from './sailpolar.js';   // ⛵ 범선 폴라 곡선(순수 수학 — Node 하네스가 직접 검사)
import { KAY_CHARS } from './player.js';     // 조타수 외형(플레이어와 동일 KayKit 캐릭터 풀)
import { toast as ukToast } from './uikit.js';   // ⚓ 닻 알림
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT (배 내구도·속도·마모)

// ── ⚓ 조타수(헬름 잡는 NPC) — 모든 배 공용. KayKit 캐릭터를 헬름에 세워 player.js와 같은 'Fishing_Struggling' 재생 ──
const HELM_ANIM_URL='/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_Simulation.glb';
let _helmRig=null;   // 캐시(전 배 공용 1회 로드 후 클론)

// 🌊 승선감(ride) — 부력을 '수면 위치추종(글루)'에서 '스프링댐퍼(관성)'로. 마루서 관성으로 슈우웅 뜨고 골로 무게있게 착지(SoT/ref 파도1·2).
//   _rideK=스프링 강성(수면으로 당기는 힘) · _rideC=댐핑(낮을수록 마루서 뜨고 착지 극적=언더댐프). window.__ride(k,c) 라이브.
let _rideK=8.0, _rideC=3.0, _tiltK=11.0;   // _tiltK=기울기(pitch/roll) 스프링 강성. 댐핑은 _rideC 공유(승선감 슬라이더 하나로 상하+기울기 관성 통합).
// 🌬️ 항해 보조: _sailFloor=추진 바닥값(바람 정렬 못해도 최소 속도 — "앞으로 잘 안나감" 완화, 정렬=최대) · _sailAssist=순풍+자동돛(파도만 느끼기 모드: catchF=1·자동 펴짐·닻 자동해제).
// ★2026-07-22 물리 재설계(사령관 "배 타는 느낌이 안 들어 — 인위적인 느낌"). 진단=_바다물리_진단.md
//   _sailAssist 기본 **OFF**로 되돌림 — ON이면 catchF가 1.0으로 강제돼 **풍향·돛이 추진에 아무 영향을 못 준다**(항해가 사라짐).
//   2026-07-04에 "느껴보고싶음"으로 임시로 켠 것이 그대로 기본값으로 굳어 있었다. 이제 튜너(?tuner=1)에서만 켠다.
//   _sailFloor도 0.5→0.08: 맞바람에서 반쯤 나가던 것을 없애되, 완전정지로 갇히는 답답함만 방지.
let _sailFloor=0.08, _sailAssist=false;
let _pitchGain=1.0;   // 🌊 기울기 게인. ★2.2→1.0(정직화): 2.2는 실제 수면 경사를 뻥튀기해 **보이는 기울기와 물 표면이 어긋났고**
                      //   그 불일치가 "인위적"의 직접 원인이었다. 극적 연출은 게인이 아니라 카메라(player.js 조타 스프링)로 만든다.
if(typeof window!=='undefined'){
  window.__ride=(k,c)=>{ if(k!=null)_rideK=+k; if(c!=null)_rideC=+c; return [_rideK,_rideC]; };
  window.__sailfloor=v=>{ if(v!=null)_sailFloor=+v; return _sailFloor; };
  // ⚠️인자 없이 부르면 **조회만**(구버전은 undefined를 !!로 강제해 조용히 OFF로 만들었다 — 검증 하네스가 값을 파괴).
  window.__sail=on=>{ if(on!=null) _sailAssist=!!on; return _sailAssist; };
  window.__pitch=v=>{ if(v!=null)_pitchGain=+v; return _pitchGain; };
  // 🚤 최고속 라이브 튜너(사령관 눈/손 판정) — BAL.ship.maxSpeed 직접 조정. 추진 thrust가 매 프레임 이 값서 역산되므로 즉시 반영.
  window.__topspd=v=>{ if(v!=null) BAL.ship.maxSpeed=+v; return BAL.ship.maxSpeed; };
  // ⛵ 돛효율 바람 보너스 배율 — 0=효율 항상 100% 고정(바람 무관) · 0.5=빔리치서 +50%. 기준속은 항상 100% 보장.
  window.__sailbonus=v=>{ if(v!=null) BAL.sailing.sailBonus=Math.max(0,+v); return BAL.sailing.sailBonus; };
}

// ★R3(2026-07-04): 조타(Z)/닻(T) 키 — 전역 1회 등록. 대상 배 = ctx.player._onShip(지금 밟고 있는 배).
//   구조: 구버전은 initShip마다 window 리스너 2개 등록(격침/제거된 배 것도 영원히 잔존·건조할수록 누적).
//   조타 중엔 플레이어가 헬름에 스냅돼 _onShip=그 배 → "어디서든 Z로 해제" 동작 보존.
let _helmKeysBound=false;
function _bindHelmKeysOnce(ctx){
  if(_helmKeysBound) return; _helmKeysBound=true;
  const _hw=new THREE.Vector3();
  addEventListener('keydown', e=>{ if(e.code!=='KeyZ') return;
    if(ctx.crew) return;   // ⚔️ crew 시스템이 Z로 스테이션(조타/대포) 진입·이탈 관리(player.js). 레거시 조타 토글 비활성.
    const bs = ctx.player && ctx.player._onShip; if(!bs) return;
    if(bs.boarded){ bs.boarded=false; return; }
    if(bs._crippled){ try{ ukToast('배가 반파 상태 — 항구에서 수리해야 출항 가능', { accent:'red', ms:2600 }); }catch(_){} return; }   // ⚓ 반파 = 조타 불가(사령관 2026-07-04)
    const HELM_R=Math.max(2.5, (bs.deckW||30)*0.09);   // 반경 = 배 크기 비례(대형선은 선미루 앞·아래서도 잡히게)
    const pp=ctx.player.pos;
    _hw.copy(bs.helmLocal).applyMatrix4(bs.curMatrix);   // 조타륜 월드 위치(y 무시 — 상갑판 조타륜도 메인갑판서 잡힘)
    if(Math.hypot(pp.x-_hw.x, pp.z-_hw.z) < HELM_R) bs.boarded=true; });
  addEventListener('keydown', e=>{ if(e.code!=='KeyT'||e.repeat) return;   // ⚓ T = 닻 토글(탑승/조타 중만)
    const bs = ctx.player && ctx.player._onShip; if(!bs) return;
    bs.anchored=!bs.anchored;
    if(bs.anchored){ bs.furl=1; ctx.sound?.play?.('anchor'); }   // 닻 내림 = 돛 접힘 + 닻 소리(사령관)
    try{ ukToast(bs.anchored?'닻 내림 — 정박':'닻 올림 — 항해 준비', { accent:bs.anchored?'gold':'cyan', ms:1800 }); }catch(_){}
  });
}

// ── 🚢 배–배 충돌(전역 1회) — 선체를 '용골 선분(캡슐)'로 근사. 겹치면 서로 밀어냄. 배는 kinematic이라 Rapier 자동해결 X. ──
//   길이축=deckW(전진), 폭=deckL. 캡슐: 중심±forward*(deckW*0.38), 반경 deckL*0.55. 2D(xz) 판정.
let _shipCollBound=false;
function _bindShipCollisionOnce(ctx){
  if(_shipCollBound) return; _shipCollBound=true;
  const _c1={x:0,z:0}, _c2={x:0,z:0};
  function segSeg(ax,az,bx,bz, cx,cz, dx,dz){   // 2D 선분-선분 최근접점 → _c1(AB위)·_c2(CD위)
    const d1x=bx-ax,d1z=bz-az, d2x=dx-cx,d2z=dz-cz, rx=ax-cx,rz=az-cz;
    const a=d1x*d1x+d1z*d1z, e=d2x*d2x+d2z*d2z, f=d2x*rx+d2z*rz, c=d1x*rx+d1z*rz;
    let s=0,t=0;
    if(a<=1e-6 && e<=1e-6){ s=0; t=0; }
    else if(a<=1e-6){ t=Math.min(1,Math.max(0,f/e)); }
    else if(e<=1e-6){ s=Math.min(1,Math.max(0,-c/a)); }
    else { const b=d1x*d2x+d1z*d2z, den=a*e-b*b;
      s = den>1e-6 ? Math.min(1,Math.max(0,(b*f-c*e)/den)) : 0;
      t = (b*s+f)/e;
      if(t<0){ t=0; s=Math.min(1,Math.max(0,-c/a)); }
      else if(t>1){ t=1; s=Math.min(1,Math.max(0,(b-c)/a)); } }
    _c1.x=ax+d1x*s; _c1.z=az+d1z*s; _c2.x=cx+d2x*t; _c2.z=cz+d2z*t;
  }
  const _colState=new Map();   // 페어별 충돌 상태(온셋/지속 구분·연출 쓰로틀)
  const _cp=new THREE.Vector3(), _cn=new THREE.Vector3();
  ctx.onUpdate((dt)=>{
    const ships=ctx.ships; if(!ships || ships.length<2) return;
    const wl=ctx.water?ctx.water.level:0, fx=ctx.cannonfx;
    for(let i=0;i<ships.length;i++){ const A=ships[i]; if(!A || A._sunk || !A.forward) continue;
      const ahl=(A.deckW||30)*0.38, ar=(A.deckL||10)*0.55;
      const aBx=A.x+A.forward.x*ahl, aBz=A.z+A.forward.z*ahl, aSx=A.x-A.forward.x*ahl, aSz=A.z-A.forward.z*ahl;
      for(let j=i+1;j<ships.length;j++){ const B=ships[j]; if(!B || B._sunk || !B.forward) continue;
        const key=i+'_'+j; let st=_colState.get(key); if(!st){ st={on:false,t:0}; _colState.set(key,st); }
        const bhl=(B.deckW||30)*0.38, br=(B.deckL||10)*0.55, rad=ar+br;
        const dcx=B.x-A.x, dcz=B.z-A.z, maxR=ahl+ar+bhl+br;         // 넓은 페이즈
        if(dcx*dcx+dcz*dcz > maxR*maxR){ st.on=false; continue; }
        const bBx=B.x+B.forward.x*bhl, bBz=B.z+B.forward.z*bhl, bSx=B.x-B.forward.x*bhl, bSz=B.z-B.forward.z*bhl;
        segSeg(aSx,aSz,aBx,aBz, bSx,bSz,bBx,bBz);
        let nx=_c1.x-_c2.x, nz=_c1.z-_c2.z, d=Math.hypot(nx,nz);
        if(d>=rad){ st.on=false; continue; }                        // 안 겹침
        if(d<1e-4){ nx=dcx; nz=dcz; d=Math.hypot(nx,nz)||1; }       // 완전 겹침 폴백=중심방향
        nx/=d; nz/=d; const push=(rad-d)*0.5;                       // 각 배 절반씩 밀어냄
        A.x+=nx*push; A.z+=nz*push; B.x-=nx*push; B.z-=nz*push;
        const clos=Math.abs(A.speed||0)+Math.abs(B.speed||0);
        if(A.speed) A.speed*=0.86; if(B.speed) B.speed*=0.86;       // 접근속도 감쇠(재관통 완화)
        // ── 💥 충격 연출 — 접촉점에서 먼지·파편·갈림 스파크 + 화면킥 ──
        _cp.set((_c1.x+_c2.x)*0.5, wl+1.5, (_c1.z+_c2.z)*0.5); _cn.set(nx,0.55,nz);
        const pl=(A===ctx.ship || B===ctx.ship);                    // 내 배가 낀 충돌만 화면 흔듦
        if(!st.on){                                                 // 온셋 = 쿵! 충격
          st.on=true; st.t=0;
          if(fx){ fx.dustBurst?.(_cp,_cn,8); fx.splinterBurst?.(_cp,_cn,7); fx.sparkBurst?.(_cp,_cn,7); }
          if(pl) ctx.player?.camShake?.(Math.min(0.15, 0.05+clos*0.02));
          ctx.sound?.play?.('ship_crash', { vol:0.5 });
        } else {                                                    // 지속 = 갈림(연기 + 간헐 스파크 + 약한 진동)
          st.t+=dt;
          if(st.t>=0.12){ st.t=0;
            if(fx){ fx.smokePlume?.(_cp,{count:2,dark:0.5,rise:1.0,spread:0.6,size:[0.6,1.3],life:[0.8,1.5]}); if(clos>1) fx.sparkBurst?.(_cp,_cn,3); }
            if(pl) ctx.player?.camShake?.(0.02);
          }
        }
      }
    }
  });
}
async function _loadHelmRig(){
  if(_helmRig) return _helmRig;
  const L=new GLTFLoader(); const load=u=>new Promise((res,rej)=>L.load(encodeURI(u),res,undefined,rej));
  const charG=await load(KAY_CHARS.barbarian);   // 조타수 기본 외형(건장한 선원)
  let clip=null;
  try{ const ag=await load(HELM_ANIM_URL); clip=ag.animations.find(c=>/Fishing_Struggling/i.test(c.name))||ag.animations.find(c=>/Idle/i.test(c.name))||ag.animations[0]; }
  catch(e){ console.warn('[ship] 조타수 애니 로드 실패', e&&e.message); }
  _helmRig={ scene:charG.scene, clip };
  return _helmRig;
}
async function _addHelmsman(ctx, mesh, bs, opt={}){
  let rig; try{ rig=await _loadHelmRig(); }catch(e){ console.warn('[ship] 조타수 로드 실패', e&&e.message); return; }
  const fig=cloneSkeleton(rig.scene);
  fig.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){ o.frustumCulled=false; o.castShadow=true; } });
  // 실제 키 1.35m가 되도록 mesh 스케일 보정 후 정규화
  let bb=new THREE.Box3().setFromObject(fig), sz=new THREE.Vector3(); bb.getSize(sz);
  const ms=(mesh.scale&&mesh.scale.x)||1;
  fig.scale.setScalar((1.35/(sz.y||1))/ms);
  bb=new THREE.Box3().setFromObject(fig);
  const dx=opt.dx||0, dy=opt.dy||0, dz=opt.dz||0, yaw=(opt.yaw!=null?opt.yaw:0);
  fig.position.set(bs.helmLocal.x+dx, bs.helmLocal.y - bb.min.y + dy, bs.helmLocal.z+dz);   // 발을 갑판면에
  fig.rotation.y=yaw;
  mesh.add(fig); bs.helmsmanFig=fig;
  if(rig.clip){ const mx=new THREE.AnimationMixer(fig); mx.clipAction(rig.clip).setLoop(THREE.LoopRepeat,Infinity).play(); ctx.onUpdate(dt=>mx.update(dt)); }
  // 런타임 튜너(브라우저서 위치·방향 조정): ship.tuneHelm(dx,dy,dz,yawDeg)
  bs.tuneHelm=(ddx,ddy,ddz,yawDeg)=>{ if(ddx!=null)fig.position.x=bs.helmLocal.x+ddx; if(ddy!=null)fig.position.y=bs.helmLocal.y-bb.min.y+ddy; if(ddz!=null)fig.position.z=bs.helmLocal.z+ddz; if(yawDeg!=null)fig.rotation.y=yawDeg*Math.PI/180; return {dx:fig.position.x-bs.helmLocal.x,dy:fig.position.y-(bs.helmLocal.y-bb.min.y),dz:fig.position.z-bs.helmLocal.z,yawDeg:fig.rotation.y*180/Math.PI}; };
}

// ── 🗜️ 최적화 GLB 로더(draco 압축) — voyage/scripts/optimize-ships.mjs 산출물. DRACOLoader 필수. 전 배 공용 캐시. ──
//   ★로더 추가일 뿐, 아래 공통 후처리(standUp·bake·deckLevels·부력 등)는 FBX/OBJ와 100% 동일하게 탄다.
let _gltfShipLoader=null;
async function _getGLTFShipLoader(){
  if(_gltfShipLoader) return _gltfShipLoader;
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const draco=new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
  draco.preload();   // ⚡ wasm 디코더 즉시 프리페치 — 첫 GLB 디코드 시 콜드 다운로드 방지
  _gltfShipLoader=new GLTFLoader(); _gltfShipLoader.setDRACOLoader(draco);
  return _gltfShipLoader;
}

// ── ⚡ GLB 캐시 + 프리로드 — 같은 URL 재로드 0회. 전투 개시 순간 콜드 로드(DRACO wasm+GLB 디코드)로 인한
//    프레임 히칫 제거: 오프닝/게임 로딩 단계에서 preloadShip()을 미리 불러 캐시를 데운다.
//    사용 시엔 scene을 clone(지오메트리 공유·머티리얼은 선체별 clone → 히트플래시 등 개별 튜닝 오염 방지).
const _glbCache=new Map();   // url → Promise<gltf>
function _loadGLBCached(url){
  if(_glbCache.has(url)) return _glbCache.get(url);
  const p=(async()=>{ const gl=await _getGLTFShipLoader();
    return await new Promise((rs,rj)=>gl.load(encodeURI(url),rs,undefined,rj)); })();
  p.catch(()=>_glbCache.delete(url));   // 실패는 캐시에 남기지 않음(재시도 가능)
  _glbCache.set(url,p);
  return p;
}
function _cloneGLBScene(g){
  const obj=g.scene.clone(true);   // 지오메트리 공유(BVH boundsTree도 공유 = 재계산 0)
  const _mseen=new Map();          // 머티리얼은 선체 인스턴스별 clone(원본 캐시 보호)
  const cl=m=>{ if(!_mseen.has(m)) _mseen.set(m,m.clone()); return _mseen.get(m); };
  obj.traverse(o=>{ if(o.isMesh && o.material){ o.material=Array.isArray(o.material)? o.material.map(cl) : cl(o.material); } });
  obj.animations=g.animations||[];
  return obj;
}
export async function preloadShip(objUrl){ await _loadGLBCached(objUrl); }   // 배 GLB 프리로드(로딩 화면에서 호출)
export async function preloadHelmRig(){ await _loadHelmRig(); }              // 조타수 리그 프리로드

// ── ⚡ BVH 가속 raycast — 갑판 걷기(player.js)가 매 프레임 배 메시에 raycast → 고폴리 배(ship-x 44만tri)는 프레임드랍.
//   three-mesh-bvh로 O(log n) 가속. 폴리곤 유지(구멍 없음) + 걷기 성능 회복. importmap에 three-mesh-bvh 필요(game/sandbox 있음).
let _bvhPatched=false;
async function _enableShipBVH(THREE, mesh){
  try{
    if(!_bvhPatched){
      const bvh = await import('three-mesh-bvh');
      THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree = bvh.disposeBoundsTree;
      THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;   // boundsTree 있는 메시만 가속, 없으면 기본 raycast(안전)
      _bvhPatched=true;
    }
    let n=0; mesh.traverse(o=>{ if(o.isMesh && o.geometry && o.geometry.attributes.position && !o.geometry.boundsTree
        && !o.geometry.morphAttributes?.position){ try{ o.geometry.computeBoundsTree(); n++; }catch(_){} } });
    if(n) console.log('[ship] ⚡BVH 가속 raycast — '+n+'메시 (갑판 걷기 성능)');
  }catch(e){ console.warn('[ship] BVH 미적용(무시, 기본 raycast):', e&&e.message); }
}

// mas getShipHeadingRad 그대로
const headingRad=(bs)=>{ const c=Math.cos(bs.yaw||0), s=Math.sin(bs.yaw||0), f=bs.fwd0||[0,1]; return Math.atan2(f[0]*c+f[1]*s, -f[0]*s+f[1]*c); };

// ⛵ 범선 폴라 곡선은 `sailpolar.js`(순수 수학, three 비의존)가 소유 — 상단 import 참조.
//   여기 두지 않는 이유: ship.js는 three를 import 하는데 three는 브라우저 임포트맵으로만 존재해
//   Node 검증 하네스(`scripts/_sail_e2e.mjs`)가 이 파일을 import 할 수 없다.

// ── 로우폴리 게임 톤(tone:'lowpoly') ──
// 리얼/PBR 텍스처 배(빨강 선체·초록 돛대처럼 게임과 안 어울리는 것)를 oseberg와 같은 따뜻한 우드 클레이 팔레트로 통일.
// 메시/머티리얼 이름 키워드로 파트별 색 → MeshLambert+flatShading+약발광(그늘서도 형체 유지). ★머티리얼 name은 보존(player.js 돛/밧줄 제외 판정 호환).
function applyLowpolyTone(obj, THREE){
  const pick=(nm)=>{ nm=(nm||'').toLowerCase();
    if(/sail|cloth/.test(nm))   return 0xd9c7a0;   // 돛 천(파치먼트)
    if(/flag/.test(nm))         return 0xb24a3a;   // 깃발(붉은 천 — 포인트색)
    if(/rope|rigging|pulley|boom|rig/.test(nm)) return 0x5f4f37;   // 밧줄/삭구
    if(/mast|pole|poker/.test(nm)) return 0x7a5d39;   // 돛대
    if(/deck|poop|hatch|floor|plank/.test(nm)) return 0xb48a52;   // 갑판(밝은 우드 — 걷는 면)
    if(/hull|keel|rudder|border|plate/.test(nm)) return 0x8a6a44; // 선체
    if(/cannon|anchor|wheel|bollard|ladder|fence|barrel|box|housing|lever|ratchet|support|stuff/.test(nm)) return 0x6e573a; // 갑판 소품
    return 0x836240; };   // 기본 우드
  obj.traverse(o=>{ if(o.isMesh){
    const onm=o.name||'', ms=Array.isArray(o.material)?o.material:[o.material];
    const nm2=ms.map(m=>{ const mnm=(m&&m.name)||''; const col=pick(onm+' '+mnm);
      const n=new THREE.MeshLambertMaterial({ color:col, side:THREE.DoubleSide, flatShading:true });
      n.emissive=new THREE.Color(col).multiplyScalar(0.16); n.name=mnm; return n; });   // name 보존
    o.material = Array.isArray(o.material) ? nm2 : nm2[0];
  }});
}

// 원본 albedo 텍스처 입히기(albedoDir) — FBX가 텍스처 링크를 안 가질 때, 머티리얼 이름으로 dir/{이름}_albedo.jpeg 직접 매핑.
//   flatShading 유지 → 나무결/돛 살리되 로우폴리 게임톤. 텍스처 없으면(404) 우드색 폴백.
function applyAlbedoTone(obj, THREE, dir){
  const TL=new THREE.TextureLoader(), cache={};
  obj.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
    const _isSail=/sail|cloth|flag/i.test(o.name||'');   // 돛/천 = 부드러운 셰이딩(펄럭일 때 폴리곤 조각 안 도드라지게)
    const nm2=ms.map(m=>{ const mnm=(m&&m.name)||'Hull';
      const n=new THREE.MeshLambertMaterial({ color:0xffffff, side:THREE.DoubleSide, flatShading:!_isSail });
      if(!(mnm in cache)){ const t=TL.load(dir+mnm+'_albedo.jpeg', undefined, undefined,
        ()=>{ n.map=null; n.color.setHex(0x9a7a4c); n.needsUpdate=true; });   // 404 → 우드색 폴백
        t.colorSpace=THREE.SRGBColorSpace; cache[mnm]=t; }
      n.map=cache[mnm]; n.name=mnm;
      if(_isSail){ // ★돛: 균일색(emissiveMap, 조명 무관) + 깃발식 셰이더 플러터(위 활대 고정, 아래로 휘날림). 원본 morph는 에셋 손상이라 미사용.
        n.emissiveMap=cache[mnm]; n.emissive=new THREE.Color(0xffffff); n.emissiveIntensity=0.72; n.color.setHex(0x6f6f6f);
        const _bb=new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position);   // base 정점 범위(정규화용)
        n.userData.isFlutter=true;
        n.onBeforeCompile=(sh)=>{ sh.uniforms.uTime={value:0}; sh.uniforms.uDepth={value:1.0};
          sh.uniforms.uYmin={value:_bb.min.y}; sh.uniforms.uYmax={value:_bb.max.y}; sh.uniforms.uZmin={value:_bb.min.z}; sh.uniforms.uZmax={value:_bb.max.z};
          // 바람: 한 방향 부풂(billow, 가운데 불룩×아래로) + 불규칙 펄럭(여러 주파수) + gust(세기 변동). 규칙적 traveling wave('물결') 아님.
          sh.vertexShader='uniform float uTime,uDepth,uYmin,uYmax,uZmin,uZmax;\n'+sh.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n float zr=(position.z-uZmin)/max(uZmax-uZmin,0.001); float yr=(uYmax-position.y)/max(uYmax-uYmin,0.001);\n float ytop=smoothstep(0.0,0.12,yr);\n float bdepth=0.7+0.3*sin(uTime*0.8);\n float billow=sin(zr*3.14159)*ytop*bdepth;\n float flut=(sin(zr*5.0+uTime*3.0)*0.3 + sin(zr*3.0-uTime*2.4+yr*3.0)*0.3)*ytop;\n transformed.x -= (billow*1.4 + flut*0.18)*uDepth*(uYmax-uYmin)*0.05;');
          n.userData.flutterSh=sh; };
        n.customProgramCacheKey=()=>'sailflutter'; }
      else { n.emissive=new THREE.Color(0x161009); n.emissiveIntensity=0.35; }
      return n; });
    o.material = Array.isArray(o.material) ? nm2 : nm2[0]; }});
}

// 원본 PBR 텍스처 그대로(rawPBR) — 게임톤 변형 없이 BaseColor+Normal+Metallic+Roughness 단일 아틀라스. 사령관 "원본" 지시용.
//   머티리얼 이름이 무의미한 FBX(egyptian='Material'/noname)용. 모든 메시 동일 아틀라스 UV 가정.
function applyRawPBR(obj, THREE, dir, base){
  const TL=new THREE.TextureLoader();
  const map=TL.load(dir+base+'_BaseColor.png'); map.colorSpace=THREE.SRGBColorSpace;
  const nrm=TL.load(dir+base+'_Normal.png');
  const met=TL.load(dir+base+'_Metallic.png');
  const rgh=TL.load(dir+base+'_Roughness.png');
  obj.traverse(o=>{ if(o.isMesh){
    o.material = new THREE.MeshStandardMaterial({ map, metalnessMap:met, roughnessMap:rgh, metalness:1.0, roughness:1.0, side:THREE.DoubleSide, flatShading:true }); }});
}

// 고정점 삭구(밧줄·도르래·활대) 제거 — 로우폴리 게임엔 과한 디테일이고 렌더+갑판 raycast 부하(정점의 ~39%).
//   돛대(mast)·돛(sail)·대포는 유지. 정점 대폭↓ → 끊김 완화 + 깔끔. 제거 개수 반환.
function stripRigging(obj){
  const rm=[]; obj.traverse(o=>{ if(o.isMesh){ const n=(o.name||'').toLowerCase();
    if(/rope|rigging|pulley|boom/.test(n) && !/sail/.test(n)) rm.push(o); } });
  rm.forEach(o=>{ if(o.parent) o.parent.remove(o); o.geometry&&o.geometry.dispose&&o.geometry.dispose(); });
  return rm.length;
}

export async function initShip(ctx, { spawn={x:40,z:40}, length=22, deckBoxes=null, helmX=null, helmScale=1.6, showSides=false, tone=null, stripRig=false, center=false, useModelHelm=false, albedoDir=null, rawPBR=null, flip=false, standUp=false, bakeFrame=false, calmBuoy=false, flatDeck=false, flatDeckY=null, deckLevels=null, deckLadders=null, ovDeckW=null, ovDeckL=null, deckCx=0, deckCz=0, clothSail=false,
  mtlUrl=null, objUrl='/obj/oseberg-ship/_ex/oseberg.1.8.obj', texUrl='/obj/oseberg-ship/textures/Body-wood-texture.png',
  helmsman=false, current=true, cannonStations=false }={}){   // helmsman = 헬름에 조타수 NPC · current=false = ctx.ship 안 덮음(적선) · cannonStations = 원본 대포 메시 제거 후 우리 cannon.glb 설치(플레이어 배 스테이션)
  const { THREE, scene, RAPIER, world } = ctx; ctx.ships = ctx.ships || [];

  // oseberg 에셋(FBX/OBJ) 시각 로드 + 텍스처
  let mesh;
  try{
    let obj;
    if(/\.glb(\?|$)|\.gltf(\?|$)/i.test(objUrl)){
      // ★최적화 GLB(draco+webp base) — 로더만 다를 뿐 머티리얼 처리는 FBX 경로와 동일(면셰이딩·노멀맵 제거·플라스틱 스펙큘러 제거·약발광).
      //   방향/좌표는 원본 FBX와 맞춰 반출(변환 단계 보정) → 아래 standUp·bake·deckLevels 공통 로직이 그대로 적용된다.
      const g=await _loadGLBCached(objUrl);   // ⚡ 캐시(프리로드 적중 시 디코드 0) — scene은 clone해 사용
      obj=_cloneGLBScene(g);
      obj.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
        ms.forEach(m=>{ if(m){ m.side=THREE.DoubleSide; m.transparent=false; m.opacity=1;
          if('alphaTest' in m) m.alphaTest=0;
          m.flatShading=true; if('normalMap' in m) m.normalMap=null;
          if('metalness' in m) m.metalness=0; if('roughness' in m) m.roughness=1;
          if(m.emissive){ m.emissive.setHex(0x1a1510); m.emissiveIntensity=0.22; }
          m.needsUpdate=true; } }); } });
    } else if(/\.fbx(\?|$)/i.test(objUrl)){
      // ★FBX 배(empty-ship 등): FBXLoader + 텍스처 폴더 강제 매핑(FBX 임베드 경로 신뢰 못함 → basename만 취해 textures/로).
      //   레이아웃 가정: .../source/X.fbx + .../textures/. 단위(cm)·루트스케일은 아래 공통 bbox 정규화가 흡수.
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const _base=objUrl.replace(/[^/]*$/,''), _texDir=_base.replace(/[^/]*\/$/,'')+'textures/';
      const _mgr=new THREE.LoadingManager();
      _mgr.setURLModifier(u=> /\.(png|jpe?g)$/i.test(u) ? _texDir+u.split(/[\\/]/).pop() : u);
      obj=await new Promise((rs,rj)=>new FBXLoader(_mgr).load(objUrl,rs,undefined,rj));
      obj.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
        ms.forEach(m=>{ if(m){ m.side=THREE.DoubleSide; m.transparent=false; m.opacity=1;
          if('alphaTest' in m) m.alphaTest=0;
          // ★로우폴리 게임 톤(사령관 디렉션): 플라스틱 스펙큘러 제거 + 면 셰이딩(facet) + 노멀맵 제거(클린 로우폴리) + 그늘 죽음 방지 약발광.
          m.flatShading=true; if('normalMap' in m) m.normalMap=null;
          if('shininess' in m) m.shininess=2; if(m.specular) m.specular.setHex(0x161616);
          if(m.emissive){ m.emissive.setHex(0x1a1510); m.emissiveIntensity=0.22; }
          m.needsUpdate=true; } }); } });
    } else if(/\.dae(\?|$)/i.test(objUrl)){
      // ★Collada(.dae) 배(enchanted-ship 등): .dae 자체 머티리얼/텍스처 사용. OBJ 돛/우드 강제 로직 건너뜀.
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const col=await new Promise((rs,rj)=>new ColladaLoader().load(objUrl,rs,undefined,rj));
      obj=col.scene;
      // ★Collada 두 버그 동시 보정:
      //   ① 투명: opacity 텍스처/<transparency>를 ColladaLoader가 잘못 읽어 배 전체 투명 → 강제 불투명.
      //   ② 흰색: .dae가 albedo 텍스처를 머티리얼에 연결 안 함(hasMap:false, color 흰색) →
      //      머티리얼 이름(lambert4SG 등)으로 textures/{name}_albedo.jpg 자동 매핑.
      const _texDir=objUrl.replace(/[^/]*$/,'')+'textures/', _TL=new THREE.TextureLoader();
      obj.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
        ms.forEach(m=>{ if(m){ m.side=THREE.DoubleSide; m.transparent=false; m.opacity=1;
          m.alphaMap=null; if('alphaTest' in m) m.alphaTest=0; m.depthWrite=true;
          if(m.name && !m.map){ const t=_TL.load(_texDir+m.name+'_albedo.jpg'); t.colorSpace=THREE.SRGBColorSpace; m.map=t; if(m.color) m.color.setHex(0xffffff); }
          m.needsUpdate=true; } }); } });
    } else if(mtlUrl){
    // ★mtl 있는 OBJ(shipx 등): MTLLoader로 원본 머티리얼/텍스처 로드 → 우드 강제 안 함(원본 그대로).
    const _md=mtlUrl.replace(/[^/]*$/,'');   // mtl·텍스처 폴더(같은 폴더 가정)
    const mats=await new Promise((rs,rj)=>new MTLLoader().setPath(_md).setResourcePath(_md).load(mtlUrl.split('/').pop(),rs,undefined,rj));
    mats.preload();
    obj=await new Promise((rs,rj)=>{ const ol=new OBJLoader(); ol.setMaterials(mats); ol.load(objUrl,rs,undefined,rj); });
    obj.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
      ms.forEach(m=>{ if(m){ m.side=THREE.DoubleSide; if(m.map)m.map.colorSpace=THREE.SRGBColorSpace; m.needsUpdate=true; } }); } });
    console.log('[ship] MTL 원본 텍스처 로드:', mtlUrl.split('/').pop());
    } else {
    obj=await new Promise((rs,rj)=>new OBJLoader().load(objUrl,rs,undefined,rj));
    const tex=new THREE.TextureLoader().load(texUrl); tex.colorSpace=THREE.SRGBColorSpace;

    // ★돛 천 머티리얼(재작업1): OBJ에 MTL 텍스처가 없어 OBJLoader가 모든 메시(돛 포함)에 우드 텍스처를 강제
    //   → 돛이 '우드 텍스처 입은 검은 갈색 천'이 됐던 진짜 원인. 돛은 우드가 아니라 천(파치먼트)이어야 한다.
    //   해법: 절차적 탄/파치먼트 캔버스 텍스처(따뜻한 베이지 + 가로 줄무늬 직조감) → 천 느낌, 명도 충분, 과발광 X.
    const _sc=document.createElement('canvas'); _sc.width=_sc.height=128; const _scx=_sc.getContext('2d');
    _scx.fillStyle='#d9c7a0'; _scx.fillRect(0,0,128,128);                         // 베이스 = 따뜻한 탄/파치먼트
    for(let i=0;i<128;i+=6){ _scx.fillStyle = (i/6)%2? 'rgba(168,146,108,0.28)':'rgba(238,224,194,0.30)'; _scx.fillRect(0,i,128,3); }  // 가로 직조 줄무늬
    for(let k=0;k<420;k++){ const x=Math.random()*128,y=Math.random()*128,a=Math.random()*0.10; _scx.fillStyle=`rgba(120,100,72,${a})`; _scx.fillRect(x,y,1,1); }  // 미세 얼룩(천 질감)
    const sailTex=new THREE.CanvasTexture(_sc); sailTex.colorSpace=THREE.SRGBColorSpace; sailTex.wrapS=sailTex.wrapT=THREE.RepeatWrapping; sailTex.repeat.set(2,2);

    // 돛 메시 판별(이름 비의존·기하 기반): obj 전체 bbox 대비 (a) 큰 면(최대변≥obj최대변*0.28) (b) 얇음(최소/최대<0.2)
    //   (c) 높이 위쪽(센터 y가 obj 높이 상단 45% 위). → 돛 패널/깃발만 잡고 선체·판자는 제외.
    const _ob=new THREE.Box3().setFromObject(obj), _os=new THREE.Vector3(); _ob.getSize(_os);
    const _objH=_os.y||1;
    // ★돛 판별(재작업1·실측 기반): 돛 패널은 (a) 상단(센터 y가 배 높이 하단서 45% 위)
    //   (b) 저폴리 단순 면(삼각형 ≤40 — 상세 선체/갑판판자 Plane.001은 20808tri라 자동 제외)
    //   (c) 큰 면적(최대 단면 ≥35 — 가는 밧줄/가름대는 제외). curve진 돛(thin 0.4)도 잡힌다.
    const _faceArea=(s)=>Math.max(s.x*s.y, s.y*s.z, s.x*s.z);
    const _objFace=_faceArea(_os);   // obj 전체 최대 단면(스케일 무관 비율 기준)
    // ★돛 판별(재작업1·실측 확정): 메인 돛은 'Plane.001'(20808tri 상세 천 패널) — 저폴리 필터로 놓쳤던 진짜 돛.
    //   판별 = (a) 이름이 Plane(돛은 Plane 프리미티브로 모델됨) 또는
    //          (b) 상단(cyRel≥0.45) + 크고 평평(obj최대단면의 20%↑ + 얇음<0.45) — 보조 돛 패널/깃발.
    //   → Plane.001 메인 돛 + 높은 평면 패널을 잡고, 선체/갑판/밧줄은 제외.
    const _isSail=(o)=>{ if(/plane/i.test(o.name)) return true;
      const bb=new THREE.Box3().setFromObject(o), s=new THREE.Vector3(); bb.getSize(s); const c=new THREE.Vector3(); bb.getCenter(c);
      const cyRel=(c.y-_ob.min.y)/_objH, mn=Math.min(s.x,s.y,s.z), mx=Math.max(s.x,s.y,s.z);
      return cyRel>=0.45 && _faceArea(s)>=_objFace*0.20 && (mn/mx)<0.45; };

    obj.traverse(o=>{ if(o.isMesh){ const sail=_isSail(o); const ms=Array.isArray(o.material)?o.material:[o.material];
      const cl=ms.map(m=>{
        const n=new THREE.MeshLambertMaterial();   // Phong 스펙큘러 제거 → 어둡게 안 눌림, 로우폴리 톤
        n.side=THREE.DoubleSide; n.color.set(0xffffff);
        if(sail){
          // ★돛(재작업1 진단): 돛 패널은 얇은 curve quad → flatShading+방향광으론 카메라쪽 면 법선이 빗나가 검게 렌더됐다.
          //   해법: (1) flatShading OFF(부드러운 셰이딩 — 천이 고르게 받음) (2) emissiveMap=천텍스처·강도 0.7로
          //   조명 방향 무관하게 항상 탄/파치먼트 천색이 보이게(과발광 아님 — 부드러운 베이지). map도 천텍스처.
          n.map=sailTex; n.flatShading=false;
          n.emissive=new THREE.Color(0xb8a880); n.emissiveMap=sailTex; n.emissiveIntensity=0.7;
        } else {
          n.flatShading=true;                       // 선체/판자만 flat — 로우폴리 판자 면 또렷
          // ★선체/판자: 우드 텍스처 + 따뜻한 우드 그늘색 약발광(밤·그늘 형체 유지, 낮엔 조명이 압도).
          const baseMap=(m&&m.isMaterial&&m.map)?m.map:tex;
          n.map=baseMap||tex; n.emissive=new THREE.Color(0x2a201a); n.emissiveMap=baseMap||tex; n.emissiveIntensity=0.55;
        }
        n.needsUpdate=true; return n; });
      o.material=Array.isArray(o.material)?cl:cl[0]; } });
    }
    // ★깨진 지오메트리(NaN bbox) 메시 제거 — 전체 bbox·스케일 NaN 전파 방지.
    //   (예: caravel 'SailAnim'은 base 정점은 정상이나 morph 상대좌표가 NaN → computeBoundingBox만 잡아냄 → 안 지우면 배 전체가 사라짐).
    //   computeBoundingBox는 NaN 시 THREE가 console.error를 찍으므로, 이 탐지 패스 동안만 그 NaN 경고를 삼킨다(노이즈 0). 모든 배 공통 견고성.
    { // ★morph 메시(펄럭이는 돛 등): morph 유지(애니용) + 정규화·충돌용 bbox를 base 정점으로 고정(morph가 만드는 bbox NaN 회피) + 컬링 끔(애니로 bbox 밖 나가도 안 사라지게).
      obj.traverse(o=>{ if(o.isMesh&&o.geometry&&o.geometry.morphAttributes&&o.geometry.morphAttributes.position){ const g=o.geometry;
        g.boundingBox=new THREE.Box3().setFromBufferAttribute(g.attributes.position);
        g.boundingSphere=g.boundingBox.getBoundingSphere(new THREE.Sphere()); o.frustumCulled=false; } });
      // base 정점이 NaN인 메시만 제거(morph 무관)
      const _bad=[]; obj.traverse(o=>{ if(o.isMesh&&o.geometry&&o.geometry.attributes.position){ const a=o.geometry.attributes.position.array;
        let nan=false; for(let i=0;i<a.length;i++){ if(!Number.isFinite(a[i])){ nan=true; break; } } if(nan) _bad.push(o); } });
      _bad.forEach(o=>{ if(o.parent) o.parent.remove(o); o.geometry&&o.geometry.dispose&&o.geometry.dispose(); });
      if(_bad.length) console.warn('[ship] NaN(base) 메시 '+_bad.length+'개 제거:', _bad.map(o=>o.name||'?').join(',')); }
    if(stripRig){ const _n=stripRigging(obj); if(_n) console.warn('[ship] 삭구(밧줄/도르래/활대) '+_n+'개 제거 — 정점 경감'); }
    if(rawPBR) applyRawPBR(obj, THREE, rawPBR.dir, rawPBR.base);   // 원본 PBR 그대로(게임톤 변형 X)
    else if(albedoDir) applyAlbedoTone(obj, THREE, albedoDir);      // 원본 albedo 텍스처 + 로우폴리 셰이딩
    else if(tone==='lowpoly') applyLowpolyTone(obj, THREE);    // 단색 우드 클레이 톤
    if(standUp){ obj.rotateX(-Math.PI/2); }   // z-up 모델 세우기(마스트 수평→수직). 자동정렬 전.
    obj.updateMatrixWorld(true);
    // ★자동 정렬: 길이축이 Z면 Y 90° 회전해 길이를 X(게임 전진축=뱃머리)에 맞춤(empty-ship 등 측면향 FBX).
    {  const _b=new THREE.Box3().setFromObject(obj), _s=new THREE.Vector3(); _b.getSize(_s);
       if(_s.z > _s.x*1.15){ obj.rotation.y -= Math.PI/2; obj.updateMatrixWorld(true); }
       if(flip){ obj.rotation.y += Math.PI; obj.updateMatrixWorld(true); } }   // flip: 뱃머리/선미 180° 뒤집기(모델 앞뒤가 전진축과 반대 — 조타륜이 선미로)
    const bb=new THREE.Box3().setFromObject(obj), s=new THREE.Vector3(); bb.getSize(s);
    obj.scale.multiplyScalar(length/Math.max(s.x,s.z,0.01));   // ★setScalar→multiply: .dae 단위스케일(cm→m, ColladaLoader가 건 0.01) 보존
    obj.updateMatrixWorld(true);
    const b2=new THREE.Box3().setFromObject(obj);
    // ★center:true → 모델을 XZ 중심으로 정렬(로컬 0 = 갑판 중심). 안 하면 오프셋 모델에서 대칭 갑판 클램프가 한쪽을 잘라먹음(가장자리 막힘).
    if(center){ const _cc=new THREE.Vector3(); b2.getCenter(_cc); obj.position.x-=_cc.x; obj.position.z-=_cc.z; }
    obj.position.y-=b2.min.y;   // 바닥 y=0
    mesh=new THREE.Group(); mesh.add(obj); mesh.userData.anims=obj.animations||[]; mesh.userData.animRoot=obj;
    // ★standUp/bakeFrame 배(queen·shipx 등): obj 변환(회전·정렬·스케일·center)을 '정점에 bake' → mesh 자식 정점이
    //   곧 mesh-local(=curMatrix frame, 스케일1·회전0) = 깨끗한 월드정렬 좌표. 시각 해치/사다리/갑판층/carry 한 좌표계 정렬.
    //   ★bakeFrame: standUp 회전 없이 bake만(이미 Y-up인데 다층갑판 deckLevels·클램프 정렬이 필요한 배용 — shipx).
    if(standUp || bakeFrame){
      mesh.updateMatrixWorld(true);
      const _wInv=new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const _ms=[]; mesh.traverse(o=>{ if(o.isMesh && o.geometry) _ms.push(o); });
      const _flat=[];
      for(const o of _ms){ o.updateMatrixWorld(true);
        const g=o.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(_wInv, o.matrixWorld));
        const nm=new THREE.Mesh(g, o.material); nm.name=o.name||''; nm.castShadow=o.castShadow; nm.receiveShadow=o.receiveShadow;
        _flat.push(nm); }
      while(mesh.children.length) mesh.remove(mesh.children[0]);
      for(const nm of _flat) mesh.add(nm);
      mesh.updateMatrixWorld(true);
      console.log('[ship] 변환 bake 완료('+(standUp?'standUp':'bakeFrame')+') — '+_flat.length+'메시');
    }
  }catch(e){ console.warn('[ship] oseberg 로드 실패 → 임시박스', e&&e.message); mesh=new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(7,1.2,length), new THREE.MeshLambertMaterial({color:0x6b4a2f}))); }
  scene.add(mesh);
  // 🕳️ 버그#4(캐러벨 "구멍 뚫림/속 비침"): 원인은 showSides(현측 디버그 화살표 전용, 선체와 무관)가 아니라
  //   갑판 위(근접 카메라)에서 length56 대형 선체 단일메시(Hull_lo 등)의 boundingSphere가 프러스텀 밖으로 판정돼
  //   측면 벽이 통째로 컬링(미렌더)되어 속이 비쳐 보이던 three.js 근접-대형메시 이슈였다.
  //   배는 항상 플레이어 근처라 프러스텀 컬링 이득이 사실상 없음 → 선체 메시 컬링 OFF(그리기만 늘 뿐, 사라지던 면이
  //   되살아나므로 시각 회귀는 구조적으로 불가 — 모든 배 프로파일 공통 안전). 재료/DoubleSide는 이미 정상.
  mesh.traverse(o=>{ if(o.isMesh) o.frustumCulled=false; });
  await _enableShipBVH(THREE, mesh);   // ⚡갑판 걷기 raycast 가속(고폴리 배 프레임드랍 방지) — 폴리곤 유지

  const sb=new THREE.Box3().setFromObject(mesh), sz=new THREE.Vector3(); sb.getSize(sz);
  // ovDeckW/ovDeckL: bake 등으로 bbox가 돛까지 포함해 부정확할 때 갑판 보행폭 직접 지정(carry 클램프·승선 박스용).
  const deckW=ovDeckW!=null?ovDeckW:sz.x*0.94, deckL=ovDeckL!=null?ovDeckL:sz.z*0.5, deckY=sz.y*0.45;   // 길이축(x) 넓게 — 뱃머리 끝까지 걷기

  // ★단일 갑판높이: mesh raycast로 실제 갑판면(난간 아래) 로컬 y 1회 산출 → carry/조타륜/collider/흘수 전부 이걸 사용(제각각 방지)
  mesh.updateMatrixWorld(true);
  const _drc=new THREE.Raycaster();
  const sampleDeckLocalY=(lx,lz)=>{ _drc.set(new THREE.Vector3(mesh.position.x+lx,mesh.position.y+60,mesh.position.z+lz),new THREE.Vector3(0,-1,0));
    const hits=_drc.intersectObject(mesh,true); const ups=hits.filter(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>0.5);
    if(!ups.length) return null; return ups[0].point.y-mesh.position.y; };   // 최상단 up면(그 지점 갑판 윗면)
  // 갑판 평면 여러 점 샘플 → 돛대/돛(이상치) 제외한 갑판 윗면 최대값(좌석 윗면 = 걷는 면, 통로 바닥 아님)
  const _ds=[ [deckW*0.2,0],[deckW*0.2,deckL*0.25],[-deckW*0.2,0],[0,deckL*0.25],[0,-deckL*0.25],[deckW*0.3,0],[-deckW*0.3,deckL*0.2] ]
    .map(([x,z])=>sampleDeckLocalY(x,z)).filter(v=>v!=null && v<sz.y*0.45);   // 평면만(돛대·돛 배제)
  const deckLocalY = _ds.length ? Math.min(..._ds) : deckY;   // ★최저 갑판면(=메인 갑판 바닥). max면 갤리온 선수루/선미루(높은 상갑판)를 잡아 플레이어가 뜸.

  // mas baseship 상태. fwd0 = oseberg 길이축(x). body=kinematic + 갑판/돛대 collider.
  const bs={ x:spawn.x, z:spawn.z, yaw:0, yawVel:0, speed:0, sail:1, furl:0, sailAngle:0, rudder:0, fwd0:[1,0], catchF:0, boarded:false, anchored:false, durability:BAL.ship.durMax,
    deckW, deckL, deckY, deckLocalY, deckTop:sz.y, flatDeck, flatDeckY, deckLevels, deckCx, deckCz, mesh, body:null, curMatrix:new THREE.Matrix4(), prevMatrix:new THREE.Matrix4() };
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(bs.x,0,bs.z)); bs.body=body;
  // 갑판 충돌체(비플레이어 물리용 평면 1개). ★플레이어는 player.js에서 발밑 raycast로 다층 갑판 추종(이 collider 무관).
  world.createCollider(RAPIER.ColliderDesc.cuboid(deckW/2,0.2,deckL/2).setTranslation(0,deckLocalY-0.2,0), body);
  // ★돛 벽: 돛 메시 로컬 bbox 수집 → player.js carry가 "몸 높이가 돛과 겹칠 때만" 통과 차단(높은 돛은 밑으로 지나감).
  bs.sailWalls=[];
  mesh.traverse(o=>{ if(o.isMesh){ const m=o.material, nm=((Array.isArray(m)?m[0]:m)&&((Array.isArray(m)?m[0]:m).name)||o.name||'');
    if(/sail/i.test(nm)){ const sb2=new THREE.Box3().setFromObject(o);
      bs.sailWalls.push({ xMin:sb2.min.x-mesh.position.x, xMax:sb2.max.x-mesh.position.x,
        zMin:sb2.min.z-mesh.position.z, zMax:sb2.max.z-mesh.position.z,
        yMin:sb2.min.y-mesh.position.y, yMax:sb2.max.y-mesh.position.y }); } }});
  bs.curMatrix.compose(new THREE.Vector3(bs.x,0,bs.z), new THREE.Quaternion(), new THREE.Vector3(1,1,1)); bs.prevMatrix.copy(bs.curMatrix);
  // ★ctx.ship 소유권 정리(2026-07-04): 구버전은 initShip이 무조건 ctx.ship을 덮어써 "현재 배 = 마지막 생성"이 됨
  //   (적선 생성 시 navalencounter가 복원 해킹으로 되돌리던 스파게티). current:false(적선·연출용)면 등록만 하고 안 덮는다.
  ctx.ships.push(bs); if(current) ctx.ship=bs;

  // ── ⚔️ broadside 측면 인터페이스 (현측 일제사격용 — cannon.js가 읽는 계약) ──
  //   전진축(x, fwd0) 기준으로 좌현(port)/우현(starboard) 월드 단위벡터를 매 프레임 노출.
  //   forward × up(cross)로 산출 — 부호/좌표계 추측 없이 견고. 우현=forward×up, 좌현=−우현.
  const _UP=new THREE.Vector3(0,1,0);
  bs.forward      = new THREE.Vector3(1,0,0);   // 뱃머리(전진) 단위벡터
  bs.starboardSide= new THREE.Vector3(0,0,1);   // 우현(오른쪽) 단위벡터 — 월드, onUpdate에서 갱신
  bs.portSide     = new THREE.Vector3(0,0,-1);  // 좌현(왼쪽) 단위벡터
  // 표적이 어느 현을 향하는지 + 정렬도. target = Vector3 | {x,z} | (x,z) 모두 허용.
  //   align 1 = 정측면(완전 broadside), 0 = 정면/정후(측면 포 못 씀). side = 그 표적이 놓인 현.
  bs.sideToward=function(tx,tz){
    if(tx && typeof tx==='object'){ tz=(tx.z!=null)?tx.z:tx.y; tx=tx.x; }   // Vector3/{x,z} 흡수
    const dx=tx-bs.x, dz=tz-bs.z, d=Math.hypot(dx,dz)||1e-6, ux=dx/d, uz=dz/d;
    const dotStar=ux*bs.starboardSide.x+uz*bs.starboardSide.z;              // +면 우현쪽, −면 좌현쪽
    return { side: dotStar>=0?'starboard':'port', align:Math.abs(dotStar), dot:dotStar };
  };
  // 측면 방향 인디케이터(우현=초록 / 좌현=빨강). ★기본 OFF(사령관: 모든 배에서 현측 화살표 제거) — 디버그로 볼 때만 showSides:true.
  //   ArrowHelper는 Line 포함이라 갑판 벽 레이캐스트(player.js)가 face=null 히트를 잡아 에러 유발 → 제거로 그 에러도 해소.
  if(showSides===true){
    const _al=Math.max(8, deckW*0.85), _oy=deckLocalY+1.6;
    bs.starArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),  new THREE.Vector3(0,_oy,0), _al, 0x2ad06a, _al*0.26, _al*0.16);
    bs.portArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(0,_oy,0), _al, 0xe23a48, _al*0.26, _al*0.16);
    mesh.add(bs.starArrow); mesh.add(bs.portArrow);   // mesh 자식 → yaw 회전 자동 추종
  }

  // 🪜 승선 사다리 위치(로컬 xz) — player.js가 물→갑판 '진입'을 사다리 반경으로 제한. 사다리 없는 배는 제한 안 함(기존대로).
  bs.ladders=[]; mesh.updateMatrixWorld(true);
  mesh.traverse(o=>{ if(o.isMesh && /ladder/i.test(o.name||'')){
    const _lb=new THREE.Box3().setFromObject(o), _lc=new THREE.Vector3(); _lb.getCenter(_lc);
    bs.ladders.push({ x:_lc.x-mesh.position.x, z:_lc.z-mesh.position.z,
      yBot:_lb.min.y-mesh.position.y, yTop:_lb.max.y-mesh.position.y }); } });   // yBot/yTop = 등반 범위(player.js 사다리 오르기)
  // ★다층 갑판 수동 사다리(deckLadders): 무명메시라 자동탐지 안 되는 배 — 로컬좌표 {x,z} 직접 지정. yBot/yTop 없으면 deckLevels 최저/최고층.
  if(deckLadders && deckLadders.length){ const _lo=deckLevels?Math.min(...deckLevels):deckLocalY, _hi=deckLevels?Math.max(...deckLevels):(deckLocalY+2);
    for(const L of deckLadders){ const yB=L.yBot!=null?L.yBot:_lo, yT=L.yTop!=null?L.yTop:_hi;
      bs.ladders.push({ x:L.x, z:L.z, yBot:yB, yTop:yT });
      // 🪜 시각 표식: 사다리 위치에 '갑판 위로 높이 솟는 밝은 빛기둥' — 플레이어가 갑판 어디서든 보고 찾아옴('여기서 Space/C').
      const _grp=new THREE.Group();
      const _h=(yT-yB)+8;   // 갑판 위로 6m 솟음
      const beam=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,_h,8),
        new THREE.MeshBasicMaterial({ color:0x44eeff }));   // 밝은 청록 불투명 기둥
      beam.position.y=yB+_h/2-1; _grp.add(beam);
      const halo=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,_h,8),
        new THREE.MeshBasicMaterial({ color:0x44eeff, transparent:true, opacity:0.22, depthWrite:false }));
      halo.position.y=yB+_h/2-1; halo.renderOrder=4; _grp.add(halo);
      const ring=new THREE.Mesh(new THREE.TorusGeometry(1.4,0.12,8,20),
        new THREE.MeshBasicMaterial({ color:0xffdd33 }));   // 발밑 노란 링(여기 서라)
      ring.rotation.x=Math.PI/2; ring.position.y=yT+0.05; _grp.add(ring);
      _grp.position.set(L.x, 0, L.z); _grp.renderOrder=3; mesh.add(_grp); } }

  // 🌬️ 돛: 원본 morph 애니는 에셋 손상(찢김) → morph 0(정적). 펄럭임 = clothSail(천 물리) 또는 셰이더 플러터.
  mesh.traverse(o=>{ if(o.isMesh&&o.morphTargetInfluences) o.morphTargetInfluences.fill(0); });
  if(clothSail){
    if(typeof clothSail==='object'){
      // 수동 좌표 cloth(돛이 본체 메시에 통합된 배 — egyptian 등). 원본 돛 위에 덮음. localPos/width/height/plane 직접 지정.
      makeClothSail(ctx, { parent:mesh, localPos:clothSail.localPos, width:clothSail.width, height:clothSail.height,
        plane:clothSail.plane||'zy', pin:clothSail.pin||'square', getFurl:()=>bs.furl||0,
        getWindWorld:(out)=>{ out.copy(bs.forward||out.set(1,0,0)).multiplyScalar(32+30*(bs.catchF||0)); } });
      console.log('[ship] 수동 cloth 돛 생성', JSON.stringify(clothSail.localPos));
    } else {
    // ★천 물리 돛(메인급): sail 메시(들) → verlet cloth 생성, 원본 숨김. clothSail:true=가장 큰 1개, 'all'=모든 돛.
    const _sails=[];
    mesh.traverse(o=>{ if(o.isMesh && /sail/i.test(o.name||'') && !/rope/i.test(o.name||'')) _sails.push(o); });
    _sails.sort((a,b)=>{ const sa=new THREE.Vector3(),sb=new THREE.Vector3(); new THREE.Box3().setFromObject(a).getSize(sa); new THREE.Box3().setFromObject(b).getSize(sb); return sb.y*sb.z-sa.y*sa.z; });
    const _tgts = (clothSail==='all') ? _sails : _sails.slice(0,1);
    _tgts.forEach(_sm=>{
      const _b=new THREE.Box3().setFromObject(_sm), _c=new THREE.Vector3(), _s=new THREE.Vector3(); _b.getCenter(_c); _b.getSize(_s);
      const _map=(_sm.material&&(Array.isArray(_sm.material)?_sm.material[0]:_sm.material).map)||null;
      _sm.visible=false;
      makeClothSail(ctx, { parent:mesh, localPos:{x:_c.x-mesh.position.x, y:_c.y-mesh.position.y, z:_c.z-mesh.position.z},
        width:_s.z, height:_s.y, map:_map, pin:'square', getFurl:()=>bs.furl||0,
        getWindWorld:(out)=>{ out.copy(bs.forward||out.set(1,0,0)).multiplyScalar(32+30*(bs.catchF||0)); } });
      console.log('[ship] cloth 돛 — '+(_sm.name||'?')+' '+_s.z.toFixed(1)+'×'+_s.y.toFixed(1));
    });
    }
  } else {
    let _ft=0; const _fm=[]; mesh.traverse(o=>{ if(o.isMesh){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m&&m.userData&&m.userData.isFlutter) _fm.push(m); }); } });
    if(_fm.length){ ctx.onUpdate(dt=>{ _ft+=dt; const dep=0.5+0.8*(bs.catchF||0);
        _fm.forEach(m=>{ const sh=m.userData.flutterSh; if(sh&&sh.uniforms){ if(sh.uniforms.uTime)sh.uniforms.uTime.value=_ft; if(sh.uniforms.uDepth)sh.uniforms.uDepth.value=dep; } }); }); }
  }

  // ⚓ 조타륜: useModelHelm면 모델 '내장' 조타륜 메시 위치를 조타 지점으로(우리 GLB 안 붙임). 아니면 /ship_helm.glb 로드.
  if(useModelHelm){
    let _wc=null;
    mesh.updateMatrixWorld(true);
    mesh.traverse(o=>{ if(o.isMesh && /wheel|helm|steer|조타/i.test(o.name||'') && !/anchor|rope/i.test(o.name||'')){
      const _wb=new THREE.Box3().setFromObject(o), _wcc=new THREE.Vector3(); _wb.getCenter(_wcc);
      _wc={ x:_wcc.x-mesh.position.x, y:_wcc.y-mesh.position.y, z:_wcc.z-mesh.position.z, mesh:o }; } });
    if(_wc){ bs.helmLocal=new THREE.Vector3(_wc.x, _wc.y, _wc.z); bs.helmMesh=_wc.mesh;   // 내장 조타륜(연출용 참조)
      console.log('[ship] 모델 내장 조타륜 사용 — local', JSON.stringify({x:+_wc.x.toFixed(1),y:+_wc.y.toFixed(1),z:+_wc.z.toFixed(1)})); }
    else { bs.helmLocal=new THREE.Vector3(-deckW*0.06, deckLocalY, 0); bs.helmMesh=null; console.warn('[ship] useModelHelm이나 조타륜 메시 못 찾음 — 기본 위치'); }
  } else {
    const _helmX = (helmX!=null) ? helmX : -deckW*0.06;
    const _hrc=new THREE.Raycaster(); _hrc.set(new THREE.Vector3(mesh.position.x+_helmX, mesh.position.y+200, mesh.position.z), new THREE.Vector3(0,-1,0));
    let _helmDeckY=deckLocalY;
    for(const h of _hrc.intersectObject(mesh,true)){ const up=h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>0.5;
      if(up){ const ly=h.point.y-mesh.position.y; if(ly>1 && ly<sz.y*0.75){ _helmDeckY=ly; break; } } }   // 그 지점 실제 갑판 윗면
    bs.helmLocal=new THREE.Vector3(_helmX, _helmDeckY, 0);
    new GLTFLoader().load('/ship_helm.glb', g=>{ const h=g.scene;
      const hb=new THREE.Box3().setFromObject(h), hs=new THREE.Vector3(); hb.getSize(hs);
      h.scale.setScalar(helmScale/Math.max(hs.y,0.01));            // 사람 키 정도(helmScale로 조정)
      const hb2=new THREE.Box3().setFromObject(h);
      h.position.set(bs.helmLocal.x, _helmDeckY - hb2.min.y, bs.helmLocal.z); h.rotation.y=-Math.PI/2;   // 밑동을 실제 갑판면에. ★180° 뒤집음(플레이어가 앞면)
      mesh.add(h); bs.helmMesh=h;
    }, undefined, ()=>console.warn('[ship] helm GLB 로드 실패'));
  }

  // ⚔️ 대포 스테이션(cannonStations) — 배 모델 내장 대포 메시는 배마다 이름/위치가 제각각이라 불안정(사령관).
  //   → 원본 대포 메시를 '위치만 기록하고 제거'(stripRigging 선례) → 그 자리에 우리 cannon.glb 설치.
  //     배 모델이 뭐든 대포 위치가 자동 확보된다. 슬롯(bs.cannonSlots)은 crew.js/player.js가 'E 진입' 판정에 사용.
  bs.cannonSlots = [];
  if(cannonStations){
    mesh.updateMatrixWorld(true);
    const _origCannons = [];
    mesh.traverse(o=>{ if(o.isMesh){
      const _mn = ((Array.isArray(o.material)?o.material[0]:o.material)||{}).name || '';
      if(/cannon|gun/i.test((o.name||'')+' '+_mn) && !/anchor/i.test((o.name||'')+' '+_mn)) _origCannons.push(o); } });
    // 위치·크기 기록(로컬 = mesh 기준) — 제거 전에
    for(const c of _origCannons){ const b=new THREE.Box3().setFromObject(c), ctr=new THREE.Vector3(), s2=new THREE.Vector3(); b.getCenter(ctr); b.getSize(s2);
      bs.cannonSlots.push({ x:ctr.x-mesh.position.x, y:ctr.y-mesh.position.y, z:ctr.z-mesh.position.z, size:Math.max(s2.x,s2.y,s2.z,1) }); }
    // 원본 대포 메시 제거
    _origCannons.forEach(o=>{ if(o.parent) o.parent.remove(o); o.geometry&&o.geometry.dispose&&o.geometry.dispose(); });
    if(_origCannons.length) console.log('[ship] ⚔️ 원본 대포 메시 '+_origCannons.length+'개 제거(위치 기록)');
    // 폴백: 못 찾으면 좌/우현 갑판 중앙에 1문씩
    if(!bs.cannonSlots.length){ bs.cannonSlots.push(
      { x:deckCx, y:deckLocalY, z:deckCz-deckL*0.42, size:2 }, { x:deckCx, y:deckLocalY, z:deckCz+deckL*0.42, size:2 }); }
    // 우리 cannon.glb 설치(각 슬롯에 클론) — 현측 바깥 향함(z<0=좌현/z>0=우현). 크기는 원본 대포 크기에 맞춤.
    new GLTFLoader().load('/intro/ship-cannon/cannon.glb', g=>{
      for(const slot of bs.cannonSlots){ const c=g.scene.clone(true);
        c.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.frustumCulled=false; } });
        const cb=new THREE.Box3().setFromObject(c), cs=new THREE.Vector3(); cb.getSize(cs);
        c.scale.setScalar((slot.size||2)/Math.max(cs.x,cs.y,cs.z,0.01));
        c.position.set(slot.x, slot.y, slot.z);
        slot.isLeft = slot.z < deckCz;
        // ★현측 바깥 향함 — 사령관 실측(2026-07-04 "왼/오른쪽 대포 오른쪽으로 90° 더"): 기존 ±90°에서 시계방향 90°.
        c.rotation.y = (slot.isLeft ? Math.PI/2 : -Math.PI/2) - Math.PI/2;
        mesh.add(c); slot.mesh=c; }
      // 🔧 대포 방향 라이브 튜너 — window.__cannonYaw(왼쪽도, 오른쪽도). 실측 확정값을 위 초기식에 박음.
      if(current && typeof window!=='undefined') window.__cannonYaw=(l,r)=>{ for(const s of bs.cannonSlots){ if(s.mesh) s.mesh.rotation.y=((s.isLeft?l:r)||0)*Math.PI/180; } return {left:l,right:r}; };
      console.log('[ship] ⚔️ 대포 스테이션 '+bs.cannonSlots.length+'문 설치(cannon.glb) — 방향 튜너 window.__cannonYaw(왼,오른)');
    }, undefined, ()=>console.warn('[ship] cannon.glb 로드 실패 — 슬롯 위치만 유지'));
  }

  // ⚓ 조타수 NPC — helmsman 옵션 시 헬름에 캐릭터 세워 'Fishing_Struggling' 재생 (모든 배 공용)
  if(helmsman){ _addHelmsman(ctx, mesh, bs, (typeof helmsman==='object' ? helmsman : {})); }

  let windDir=0; const _q=new THREE.Quaternion(), _e=new THREE.Euler(), _v=new THREE.Vector3();
  // 💦 착지 물보라 — 배가 파도에 쿵 착수(하드 랜딩)할 때 흰 포말 링 확산(물 impact, 파티클 아님·풀 재사용).
  const _splGeo=new THREE.RingGeometry(0.4,1.3,26); const _splRings=[];
  for(let i=0;i<5;i++){ const m=new THREE.Mesh(_splGeo, new THREE.MeshBasicMaterial({ color:0xeaf6ff, transparent:true, opacity:0, depthWrite:false, side:THREE.DoubleSide }));
    m.rotation.x=-Math.PI/2; m.visible=false; m.position.set(0,-999,0); ctx.scene.add(m); _splRings.push({ m, t:0, life:0, op0:0, r0:1 }); }
  function _spawnSplash(x,z,y,power){
    // ★착수 물보라 = foamtrail 포말 퍼짐(불규칙·시간차 확장 — "동그라미 파장" 폐지, 사령관 2026-07-05).
    //   foamtrail 미탑재 환경(샌드박스 단독 하네스)만 기존 링 폴백.
    if(ctx.foamtrail){ ctx.foamtrail.burst(x, z, power); return; }
    const s=_splRings.find(r=>!r.m.visible); if(!s) return;
    const P=Math.min(1,power/6); s.m.position.set(x,y+0.15,z); s.r0=2+P*3; s.m.scale.setScalar(s.r0);
    s.op0=0.35+P*0.5; s.m.material.opacity=s.op0; s.m.visible=true; s.t=0; s.life=0.65+P*0.3; }
  // ── 부력 프로브(선체 하부 4점, 로컬 [lx,lz]) + 평형 흘수 + 스프링댐퍼 상태 ──
  const HL=sz.x*0.5, HW=sz.z*0.5;   // 흘수는 onUpdate에서 갑판높이 기준 동적(갑판이 물 위에 오게)
  const probes=[[HL*0.75,0],[-HL*0.75,0],[0,HW*0.7],[0,-HW*0.7]];               // bow / stern / port / star
  bs.buoyY=0; bs.buoyVY=0; bs.roll=0; bs.rollV=0; bs.pitchA=0; bs.pitchV=0;
  const HEAVE_K=10.0, HEAVE_C=0.85, TILT_K=14.0, TILT_C=0.55, MAX_TILT=0.52;   // 기울기 강하게(파도 climb — 최대 ~30°, pitchGain 증폭 헤드룸)
  ctx.onUpdate(dt=>{   // mas updateBaseShip 물리부(돛/바람/조타) + 새 부력
    bs.prevMatrix.copy(bs.curMatrix);
    const keys = ctx.player ? ctx.player.keysSet : new Set();
    const wd = ctx.wind ? ctx.wind.dir : windDir;   // 실시간 바람 방향(wind.js 관리)
    // ⚔️ 1인 크루: 플레이어가 '조타 스테이션'을 잡았을 때만 도보 조타 입력을 받는다.
    //   포 스테이션이면 이 블록을 건너뛰고 crew.js(AI 조타수)가 bs.rudder/bs.furl를 직접 세팅한다.
    bs._boostOn=false;
    if(bs.boarded && (!ctx.crew || ctx.crew.isPlayerAt('helm'))){
      // ⚔️ 조타 = A/D 방향타(사령관 2026-07-04 "바람 없어졌으니 Q/E→A/D"). Q/E는 스킬키로 반납.
      if(keys.has('KeyA')) bs.rudder=Math.max(-1,bs.rudder-dt*1.8);
      else if(keys.has('KeyD')) bs.rudder=Math.min(1,bs.rudder+dt*1.8);
      else bs.rudder += (0-bs.rudder)*Math.min(1,dt*2.2);
      // 🌬️ 돛 W=펴기(furl↓)/S=접기(furl↑) — 속도 조절. 바람 정렬 자동이라 돛각(A/D) 트림은 폐지.
      if(keys.has('KeyW')) bs.furl=Math.max(0,bs.furl-dt*0.5);
      if(keys.has('KeyS')) bs.furl=Math.min(1,bs.furl+dt*0.5);
      // ⚡ Shift = 전력 항해 부스트(도보 달리기의 배 버전) — 돛 어느정도 펴야 + 스태미나 남아야
      if((keys.has('ShiftLeft')||keys.has('ShiftRight')) && !bs.anchored && bs.furl<0.85 && bs.boost>0.02) bs._boostOn=true;
    }
    // ⚡ 부스트 스태미나: 부스트 중 소진 / 아니면 회복 (BAL.ship.boostDrain/Regen)
    if(bs.boost==null) bs.boost=1;
    bs.boost=Math.max(0,Math.min(1, bs.boost + (bs._boostOn ? -dt/BAL.ship.boostDrain : dt/BAL.ship.boostRegen)));
    // 🧭 자동항해(autopilot) — harbor '호출' 시 미승선 배가 스스로 정박점까지 항해 → 도착 후 닻. (bs.autopilot={x,z,r,onArrive})
    bs._apCruise=false;
    if(bs.autopilot && !bs.boarded){
      const tg=bs.autopilot, dx=tg.x-bs.x, dz=tg.z-bs.z, dist=Math.hypot(dx,dz);
      if(dist <= (tg.r||14)){ bs.autopilot=null; bs.anchored=true; bs.furl=1; bs.rudder=0;   // ⚓ 도착 = 정박
        if(tg.onArrive) try{ tg.onArrive(); }catch(_){}}
      else {
        bs.anchored=false; bs.furl=0;                                    // 돛 펴고 추진
        const bx0=Math.cos(bs.yaw), bz0=-Math.sin(bs.yaw);               // 현재 뱃머리(월드 x,z; fwd0=[1,0] 관례)
        const tX=dx/dist, tZ=dz/dist, cross=bx0*tZ-bz0*tX, dotp=bx0*tX+bz0*tZ;
        const turn=Math.atan2(cross, dotp);                              // 목표까지 돌려야 할 각(-π..π)
        bs.rudder=Math.max(-1, Math.min(1, turn*1.6));                   // 부호=yawVel(-rudder) 관례 (검증서 확정)
        bs._apCruise=true;                                               // 바람 무시 크루즈(갇힘 방지)
      }
    }
    // 🌬️ 항해 어시스트(느껴보기): 승선 중 자동으로 돛 폄. ★닻 내리면 정지(사령관 "닻 내렸는데 계속 움직임" 2026-07-04 — anchored 강제 해제 폐지).
    if(_sailAssist && bs.boarded && !bs.anchored){ bs.furl=Math.max(0, bs.furl-dt*1.5); }
    bs.sail=1-bs.furl;   // 펴진 정도(furl 0=완전펴짐 → sail 1). 추진은 sail에 비례.
    // ⛵ catchF = 침로가 바람에 대해 얼마나 좋은 각인가(폴라 곡선). 2026-07-22 재설계 — 위 polarCatch 주석 참조.
    //   빔리치(옆바람 90°)가 최대이고 순풍(180°)은 0.70 — 이게 범선다운 인과의 핵심이다.
    //   ⚠️bs.sailAngle은 현재 어디서도 변경되지 않는다(A/D가 조타로 재배정되며 수동 트림 폐지, 값 0 고정).
    //     따라서 트림 효율항은 곱하지 않는다 — 곱하면 트림 수단이 없는 채로 상시 감속만 걸린다.
    //     (수동 트림을 되살리려면 키 배정 + sailhud 다이얼 재활성화가 함께 필요 — 사령관 판단 사항.)
    const bowYaw=headingRad(bs);
    const _theta=windAngleOff(bowYaw, wd);
    const _polar=polarCatch(_theta);
    // 🌬️ 풍속 반영(감사 M7) — wind.strength가 파고/HUD에만 쓰이고 **추진엔 전혀 안 쓰이던 것**을 배선.
    //   기준풍속(평상시)에서 1.0이 되게 정규화 → 기존 최고속을 보존하고, 폭풍에서만 실제로 빨라진다.
    const _SL=BAL.sailing, _ws=(ctx.wind && ctx.wind.strength!=null) ? ctx.wind.strength : (_SL?_SL.windRefStrength:0.4);
    const _windMul=_SL ? Math.min(_SL.windMulMax, Math.max(_SL.windMulMin, _ws/_SL.windRefStrength)) : 1;
    // ★2026-07-23 사령관 확정: 돛효율은 **항상 100% 고정**(각도로 깎지 않음 — 역풍서 3~4로 죽던 문제) + 바람이 정렬될수록(_polar) **그 위로 추가**.
    //   catchF = 1.0(기준 100%) + sailBonus × _polar(빔리치=최대 추가). 즉 어떤 침로든 최소 기준속, 옆바람이면 더 빠르다.
    const _sailBonus=(_SL&&_SL.sailBonus!=null)?_SL.sailBonus:0.5;
    const catchF=_sailAssist ? 1.0 : (1.0 + _sailBonus*_polar);
    bs.catchF=catchF; bs.windDir=wd; bs.bowYaw=bowYaw; bs.windOff=_theta; bs.windMul=_windMul;
    // ⚓ 닻(anchored): 추진 0 → 관성으로 곧 멈춤. XZ는 speed로만 이동하므로 정지 후 바람에도 안 흘러감(제자리 정박).
    // ★D1(2026-07-15): 배 업그레이드 배율 — 속도=maxSpeed(상시)·돛=전력항해 부스트 배속. 현재 조종 배(내 배)에만 적용.
    const _up=(ctx.shipUpgrades && bs===ctx.ship) ? ctx.shipUpgrades : null;
    const _spdMul=_up ? 1 + BAL.ship.upgrades.speed.mult*(_up.speed||0) : 1;
    const _sailMul=_up ? 1 + BAL.ship.upgrades.sail.mult*(_up.sail||0) : 1;
    const _boostM=bs._boostOn ? BAL.ship.boostMult*_sailMul : 1;
    // ── 🚤 추진/항력 모델(2026-07-22) — 구 1차 lerp를 힘 모델로 교체 ──
    //   구식 `speed += (target-speed)*dt*0.6`은 질량·항력이 없어 가속 곡선이 항상 같고 **타력(관성 활주)이 없었다.**
    //   신식 dv/dt = thrust − (k1·v + k2·v²). maxThrust는 ship.maxSpeed가 정확히 종단속도가 되도록 **역산**하므로
    //   최고속 8.0은 그대로 보존된다. 부분 추진에서 속도가 선형이 아니게 되는 것(0.5추진→63%속도)이 범선다운 응답.
    //   검산: t63 = 9.62s · 타력 8→1 = 28.6s (수식 정본 `_바다물리_수식.md`, 앤 독립 수치적분 일치)
    const bdt0=Math.min(dt,0.05);   // 물리 적분 dt(헤드리스 큰 dt 안정화) — 아래 부력 블록 bdt와 동일 관례
    if(bs.anchored){
      bs.speed += (0-bs.speed)*Math.min(1,dt*1.8);                       // ⚓ 닻 = 기존 빠른 감속 유지(정박 안정)
    } else if(_SL && _SL.drag){
      const V=BAL.ship.maxSpeed, k1=_SL.drag.k1, k2=_SL.drag.k2;
      const maxThrust=k1*V + k2*V*V;                                     // ★역산 — 종단속도 = maxSpeed 보장
      const p = bs._apCruise ? 0.75 : (catchF*bs.sail*_windMul);         // 자동항해=바람 무시 고정 추진
      const thrust = maxThrust * p * _spdMul * _boostM * _boostM;        // ⚡부스트는 종단속도가 √배로만 늘어 체감이 죽음 → 제곱으로 보정
      bs.speed += (thrust - (k1*bs.speed + k2*bs.speed*bs.speed)) * bdt0;
      if(bs.speed<0) bs.speed=0;                                          // 역추진 없음(후진은 별도 계통)
    } else {
      const cruise=(bs._apCruise ? BAL.ship.maxSpeed*0.75*_spdMul : BAL.ship.maxSpeed*catchF*bs.sail*_spdMul) * _boostM;   // BAL 없음 폴백(구 동작)
      bs.speed += (cruise-bs.speed)*Math.min(1,dt*0.6);
    }
    if(bs.speed<((_SL&&_SL.coastMin)||0.012)) bs.speed=0;
    const steerEff=Math.min(1,Math.abs(bs.speed)/1.2); const targetYawVel=-bs.rudder*0.24*(0.32+0.68*steerEff);   // ⚔️ 선회속도↓(사령관 "배 도는게 너무 빠름" 2026-07-04. 0.40→0.24)
    bs.yawVel += (targetYawVel-bs.yawVel)*Math.min(1,dt*1.1); bs.yaw += bs.yawVel*dt;
    const _c=Math.cos(bs.yaw),_s=Math.sin(bs.yaw); const bowX=bs.fwd0[0]*_c+bs.fwd0[1]*_s, bowZ=-bs.fwd0[0]*_s+bs.fwd0[1]*_c;
    // ⚔️ broadside 측면 단위벡터 갱신(월드): 우현 = forward × up, 좌현 = −우현.
    bs.forward.set(bowX,0,bowZ);
    bs.starboardSide.crossVectors(bs.forward,_UP).normalize();
    bs.portSide.copy(bs.starboardSide).multiplyScalar(-1);
    // 🚤 측면 관성(용골 그립) + 부가질량 — 속도벡터가 뱃머리 방향으로 lerp: 돌면 관성으로 미끄러졌다 그립(묵직한 선회감). wave push는 아래 부력블록서 가산.
    const _keelGrip=2.4, tgVX=bowX*bs.speed, tgVZ=bowZ*bs.speed;
    if(bs._velX==null){ bs._velX=tgVX; bs._velZ=tgVZ; }
    bs._velX+=(tgVX-bs._velX)*Math.min(1,dt*_keelGrip);
    bs._velZ+=(tgVZ-bs._velZ)*Math.min(1,dt*_keelGrip);
    // 섬 충돌(물리): 뱃머리 한 점만 보던 것 → 선체 발자국 여러 점 검사(비스듬히 접근 시 선체가 섬에 얹혀 좌초되는 것 방지, 사령관 2026-07-09).
    const wl=ctx.water?ctx.water.level:0;
    const _gAt=(x,z)=> (ctx.terrain&&ctx.terrain.groundAt) ? ctx.terrain.groundAt(x,z,80) : -1e3;
    const nx=bs.x+bs._velX*dt, nz=bs.z+bs._velZ*dt;
    const perpX=-bowZ, perpZ=bowX, HLd=HL*0.95, HWd=HW*0.9;   // 선체 길이/폭 반경(현측=perp)
    // 뱃머리 끝 + 앞현측 + 중앙현측 + 선미현측 = 선체 둘레. 한 점이라도 육지면 전진 취소(섬 위로 못 넘어감).
    const _hull=[[HLd,0],[HLd*0.6,HWd*0.75],[HLd*0.6,-HWd*0.75],[0,HWd],[0,-HWd],[-HLd*0.7,HWd*0.6],[-HLd*0.7,-HWd*0.6]];
    let _land=false;
    for(const p of _hull){ if(_gAt(nx+bowX*p[0]+perpX*p[1], nz+bowZ*p[0]+perpZ*p[1])>wl+0.4){ _land=true; break; } }
    if(_land){ bs.speed*=0.15; bs._velX*=0.1; bs._velZ*=0.1;   // 섬·부두 충돌 → 튕김(관성 죽임) + 내구도 ↓
      // 8방향 지형 샘플 → '가장 깊은 물' 방향으로 밀어냄(좌초 시 제자리 오실레이션·완전 정지 대신 스스로 이탈 = 조타 중 섬에 얹혀 안 움직이던 버그 해소).
      let ex=-bowX, ez=-bowZ, bestG=1e9;
      for(let a=0;a<8;a++){ const ang=a*Math.PI/4, ox=Math.cos(ang), oz=Math.sin(ang), g=_gAt(bs.x+ox*HL*1.1, bs.z+oz*HL*1.1);
        if(g<bestG){ bestG=g; ex=ox; ez=oz; } }
      bs.x+=ex*0.6; bs.z+=ez*0.6;
      bs.durability=Math.max(0,bs.durability-BAL.ship.wearHit*dt*60); bs._hitLand=true; }   // ★프레임률 정규화(2026-07-15): *dt*60 = 60Hz 동작 보존 + 고프레임서 과마모 방지(기존 프레임당 감산 → 144Hz 2.4배 빨리 닳던 것)
    else { bs.x=nx; bs.z=nz; bs._hitLand=false; if(bs.speed>0.1) bs.durability=Math.max(0,bs.durability-bs.speed*dt*BAL.ship.wearSail); }   // 항해 마모(거리 비례)
    // ── 부력: 4점 프로브 파도높이 → 평균수면−흘수 평형 y(자동) + 깊이차 roll/pitch + 스프링댐퍼 ──
    const W=ctx.water;
    if(W&&W.heightAt){
      const cY=Math.cos(bs.yaw), sY=Math.sin(bs.yaw);
      const wx=k=>bs.x+(probes[k][0]*cY+probes[k][1]*sY), wz=k=>bs.z+(-probes[k][0]*sY+probes[k][1]*cY);
      const sBow=W.heightAt(wx(0),wz(0)), sStern=W.heightAt(wx(1),wz(1)), sPort=W.heightAt(wx(2),wz(2)), sStar=W.heightAt(wx(3),wz(3));
      const sC=W.heightAt(bs.x,bs.z);                                // 배 발밑 파도(heave) — 갑판이 항상 발밑 물 위(파도가 안 덮음)
      // 🌊 파도 surge(2026-07-22 재설계) — **"파도를 탄다"의 본체**.
      //   구식 `_wp=0.5 × 파고차(m)`는 차원이 안 맞았다(높이차에 계수를 곱해 속도에 더함 → 선체 크기에 따라 의미가 달라짐).
      //   게다가 _velX/_velZ에만 더해서 용골 그립(2.4/s)이 곧바로 지워버려 **실질적으로 지터**였고,
      //   종방향 가감속(배가 파도 등을 내려가며 빨라지고 오르며 느려지는 것)은 존재하지 않았다.
      //   신식: 프로브 간격으로 나눠 **경사(무차원)** 를 만들고 a = −g·k·경사 로 종방향 가속을 준다(선체 크기 불변).
      //   ⚠️프로브 간격(≈1.5·HL)이 저역통과 역할을 해, 선체보다 짧은 잔물결은 자동으로 소거된다(실제 배와 같음).
      //   실측: 체감 주 성분은 **너울이 아니라 중파**(경사 분산 기여 61.5%, 너울은 5.3%뿐).
      if(!bs.anchored && bs._velX!=null && _SL){
        const wpt=Math.min(dt,0.05), span=Math.max(1e-3, 1.5*HL);
        const slopeFwd=Math.max(-_SL.surgeSlopeClamp, Math.min(_SL.surgeSlopeClamp, (sBow-sStern)/span));
        bs.surgeA = -9.81*_SL.kSurge*slopeFwd;          // 오르막(앞이 높음)=감속 / 내리막=가속
        bs.speed = Math.max(0, bs.speed + bs.surgeA*wpt);
        // 좌우 경사 옆밀림(카오스)만 구 경로 유지 — 단 경사 기반으로 차원 일치시킴.
        const ss=(sPort-sStar)/Math.max(1e-3, 1.4*HW);
        bs._velX += bs.starboardSide.x*ss*_SL.lateralPush*9.81*wpt;
        bs._velZ += bs.starboardSide.z*ss*_SL.lateralPush*9.81*wpt;
      }
      const draftEq=deckLocalY*0.4;                                  // 흘수 얕게(안 가라앉음)
      const yTarget=sC-draftEq;                                      // ★발밑 파도 따라 + pitch/roll 경사로 파도면에 누움(공중 완화)
      // 축 보정: 길이축=x → 앞뒤 기울기는 Euler z(roll변수), 좌우 기울기는 Euler x(pitchA변수)
      const pitchTarget=Math.atan2(sPort-sStar, HW*1.4)*_pitchGain;   // Euler x축 = 좌우(현측) 기울기 (climb 게인)
      const rollTarget =Math.atan2(sBow-sStern, HL*1.5)*_pitchGain;   // Euler z축 = 앞뒤(뱃머리) 기울기 ★파도 climb 게인 — 마루 오를 때 뱃머리 확 들림
      // ★승선감(리서치 기반): 부력을 '수면에 각도 맞추기'가 아니라 '관성 스프링'으로 → 배가 파도에 동적 반응(뱃머리 솟구쳤다 넘어가며 고꾸라짐 = 타는 느낌).
      //   heave(상하)·pitch(뱃머리 상하)·roll(좌우) 전부 스프링댐퍼+속도(관성). 정박(닻)=수면 딱 붙음(부두 안정).
      const bdt=Math.min(dt,0.05);   // 헤드리스 큰 dt 안정화
      if(bs.anchored){
        // ⚓ 버그#3(정박 진동): 예전엔 정박 중에도 파도 4점 프로브 경사를 빠른 계수(16/13)+_pitchGain 증폭으로 추종 →
        //   매 프레임 pitch/roll이 출렁여 중심서 떨어진 조타륜(헬름)이 미친듯이 흔들리고 배가 떨렸다.
        //   정박 = 파도 경사 무시하고 수평(0)으로 부드럽게 눕힘 + heave도 완만히 → 부두처럼 사실상 안 흔들림.
        //   (항해 중 파도 흔들림은 아래 else 4점 부력 물리로 그대로 유지.)
        bs.buoyY += (yTarget-bs.buoyY)*Math.min(1,dt*(calmBuoy?5:6)); bs.buoyVY=0;
        bs.pitchA += (0-bs.pitchA)*Math.min(1,dt*2.5); bs.pitchV=0;
        bs.roll   += (0-bs.roll  )*Math.min(1,dt*2.5); bs.rollV=0;
      } else {
        // ★★ 진짜 4점 부력 힘 물리(2026-07-04, 리서치 반영) — 뱃머리/선미/좌현/우현 네 점 각자 잠긴 깊이만큼 '위로만' 밀어올림.
        //   ★핵심: 각 점을 '그 점의 수직속도'로 감쇠(per-floater damping) → 로켓발사·지터 방지 + 회전감쇠 자동. (Habrador/Vertex Fragment)
        //   순힘 합 = heave(상하) / 순힘 차 = 토크(기울기). 마루서 물 밖=부력0=중력만 → 점프. 각 점 독립 = 뱃머리 박혔다 튕겨오름.
        const kk=calmBuoy?_rideK*0.7:_rideK, dmp=calmBuoy?_rideC*1.6:_rideC, G=kk*draftEq;
        const lxB=HL*0.75, lzS=HW*0.7, sr=Math.sin(bs.roll), sp=Math.sin(bs.pitchA);   // 각 점 월드 Y = buoyY + 레버×기울기
        const vy=bs.buoyVY||0, rv=bs.rollV||0, pv=bs.pitchV||0;
        // 각 점: 부력(위로만) − 그 점의 수직속도×감쇠. 점 수직속도 = heave + 각속도×레버.
        const FB=Math.max(0, sBow -(bs.buoyY+lxB*sr))*kk - (vy+rv*lxB)*dmp;   // 뱃머리
        const FT=Math.max(0, sStern-(bs.buoyY-lxB*sr))*kk - (vy-rv*lxB)*dmp;  // 선미
        const FP=Math.max(0, sPort -(bs.buoyY+lzS*sp))*kk - (vy+pv*lzS)*dmp;  // 좌현
        const FR=Math.max(0, sStar -(bs.buoyY-lzS*sp))*kk - (vy-pv*lzS)*dmp;  // 우현
        bs.buoyVY=vy+((FB+FT+FP+FR)*0.25 - G)*bdt; bs.buoyY+=bs.buoyVY*bdt;    // heave = 평균 순힘 − 중력
        // 토크 = 파도 강제(순힘 차) + 🆕복원 모멘트 + 🆕감쇠.
        //   ★2026-07-22: 예전엔 파도 강제만 있고 **복원이 선형(사실상 없음)** 이라 큰 각도에서 "고무" 느낌이었다.
        //   메타센터(wall-sided GZ) 근사: 복원 ∝ −sinφ·(1+β·tan²φ) → 각도가 커질수록 경화(0.4rad에서 +32%).
        //   tan² 클램프로 상한이 고정돼 발산 불가. 복원항이 새로 생겼으므로 강제 게인은 절반으로 낮춘다(이중 스프링 방지).
        const _R=_SL&&_SL.restore;
        const gA=(_SL?_SL.waveTorqueGain:0.05)*_pitchGain;
        if(_R){
          const w0=Math.sqrt(_R.w0sq), dmp2=2*_R.zeta*w0;
          const rest=(phi)=>{ const t2=Math.min(Math.tan(phi)*Math.tan(phi), _R.tan2Clamp); return -_R.w0sq*Math.sin(phi)*(1+_R.beta*t2); };
          bs.rollV = rv+((FB-FT)*gA + rest(bs.roll)   - dmp2*rv)*bdt; bs.roll  +=bs.rollV*bdt;   // 앞뒤(뱃머리 상하)
          bs.pitchV= pv+((FP-FR)*gA + rest(bs.pitchA) - dmp2*pv)*bdt; bs.pitchA+=bs.pitchV*bdt;  // 좌우
        } else {
          bs.rollV =rv+((FB-FT)*gA)*bdt; bs.roll +=bs.rollV*bdt;
          bs.pitchV=pv+((FP-FR)*gA)*bdt; bs.pitchA+=bs.pitchV*bdt;
        }
        // 착지 물보라 감지(3단계 VFX 연결): 빠르게 낙하 중 입수 순간
        const sub=sC-bs.buoyY;
        if(bs.buoyVY<-2.4 && sub>0 && sub<0.6){ if(!bs._splashArmed){ bs._splashArmed=true;   // 하드 랜딩 = 뱃머리 부근에 물보라
          _spawnSplash(bs.x+bowX*HL*0.5, bs.z+bowZ*HL*0.5, sC, -bs.buoyVY);
          bs.landImpact=Math.min(1, (-bs.buoyVY)/6);   // 🎥 착수 충격(0~1) — player.js 조타 카메라가 소비해 쉐이크로 변환. 소비 후 0으로 리셋.
        } }
        else if(sub>1.2) bs._splashArmed=false;
        // 🌊 선미 웨이크 트레일(foamtrail RT) — ref/배나가는효과.png 3구조 씨앗(재작업 2026-07-05, 사령관 "거품 늘리기 아님"):
        //   선미 코어(강·좁게) + 바로 뒤 확산띠(넓·약하게) = 코어→줄무늬→얼룩 농도 프로파일. 스탬프는 진행방향 타원.
        //   + 뱃머리 V자 2줄(±20° 가는 선 — 배가 지나가며 V 형성). 강도=속도×dt(가산 누적 프레임레이트 무관).
        if(ctx.foamtrail && bs.speed>0.6){
          const _wi=Math.min(1, bs.speed/(BAL.ship.maxSpeed||8));
          const _wa=Math.atan2(bowZ,bowX), _sx=-bowZ, _sz=bowX;   // 진행각·현측 직교
          // ★사령관 실측 피드백(2026-07-05): ①웨이크는 '뱃머리 끝'서 뾰족하게 시작해 V로 벌어져야(켈빈 웨이크)
          //   ②선미 띠가 배 폭 대비 너무 넓었음 → 폭을 선폭 안쪽으로(코어 0.45·확산띠 0.7배).
          ctx.foamtrail.stamp(bs.x-bowX*HL*0.60, bs.z-bowZ*HL*0.60, HW*0.45, dt*(3.2+5.5*_wi), _wa, 2.8);          // 선미 코어(좁게)
          ctx.foamtrail.stamp(bs.x-bowX*HL*0.95, bs.z-bowZ*HL*0.95, HW*(0.70+0.25*_wi), dt*(1.0+1.8*_wi), _wa, 2.4); // 확산띠(선폭 이내)
          // 뱃머리 V — ★원점 = 스템(물 가르는 뱃머리 끝) '한 점'(사령관 "뾰족이 2개" 수정: 좌우 벌려 찍던 것 폐지).
          //   두 팔은 같은 점에서 각도만 ±19° — 배가 지나가며 한 꼭짓점서 V로 벌어짐.
          //   타원 스탬프가 뱃머리 앞으로 삐져나오지 않게 각 팔을 자기 방향으로 반길이 후퇴.
          const _bxT=bs.x+bowX*HL*0.98, _bzT=bs.z+bowZ*HL*0.98, _ll=HW*0.22*3.2;
          const _a1=_wa+0.33, _a2=_wa-0.33;
          ctx.foamtrail.stamp(_bxT-Math.cos(_a1)*_ll, _bzT-Math.sin(_a1)*_ll, HW*0.22, dt*2.4*_wi, _a1, 3.2);
          ctx.foamtrail.stamp(_bxT-Math.cos(_a2)*_ll, _bzT-Math.sin(_a2)*_ll, HW*0.22, dt*2.4*_wi, _a2, 3.2);
          // 🚢 흘수선 포말 칼라 — 배 '모양대로'(선체 타원 근사) 양현을 따라 얇게(사령관 "옆에는 안 보임" 2026-07-05).
          //   뱃머리쪽 진하고(압력파) 중앙~선미로 옅어짐. 각 점은 선체 접선 방향 타원 스탬프 = 윤곽선처럼 이어짐.
          for(let _hi=0;_hi<4;_hi++){ const _th=(0.16+_hi*0.21)*Math.PI, _ct=Math.cos(_th), _st=Math.sin(_th);
            const _hx=bowX*HL*0.90*_ct, _hz=bowZ*HL*0.90*_ct, _w8=0.35+0.65*Math.max(0,_ct);   // 뱃머리 가중
            for(const _sg of [1,-1]){
              const _px=bs.x+_hx+_sg*_sx*HW*0.95*_st, _pz=bs.z+_hz+_sg*_sz*HW*0.95*_st;
              const _dxv=-bowX*HL*_st+_sg*_sx*HW*_ct, _dzv=-bowZ*HL*_st+_sg*_sz*HW*_ct;       // 선체 접선
              ctx.foamtrail.stamp(_px, _pz, HW*0.15, dt*1.1*_wi*_w8, Math.atan2(_dzv,_dxv), 2.6);
            }
          }
        }
      }
      bs.pitchA=Math.max(-MAX_TILT,Math.min(MAX_TILT,bs.pitchA)); bs.roll=Math.max(-MAX_TILT,Math.min(MAX_TILT,bs.roll));
      bs.waveY=sC;
    }
    // 🚤 선회 힐(heel) — 방향 틀 때 원심력으로 배가 바깥으로 기욺. 파도 흔들림 위에 얹힘(조타 손맛). 정박/저속은 거의 0.
    // ★2026-07-22: 선형(×0.06)이라 고속에서 과하게 기울 수 있었다 → 원심가속 기반 atan(포화 함수라 발산 없음).
    //   검산: 상한 조합(yawVel 0.24 × speed 8) = 11.07° (15° 이내 자동 만족). scale 1.355에서 15°에 닿음.
    const _hs=(_SL&&_SL.heelScale)!=null?_SL.heelScale:1.0, _hr=(_SL&&_SL.heelResponse)||2.5;
    const _heelTgt=-_hs*Math.atan(bs.yawVel*bs.speed/9.81);
    bs.heel=(bs.heel||0)+(_heelTgt-(bs.heel||0))*Math.min(1,dt*_hr);
    _e.set(bs.pitchA+bs.heel, bs.yaw, bs.roll, 'YXZ'); _q.setFromEuler(_e); _v.set(bs.x, bs.buoyY, bs.z);
    body.setNextKinematicTranslation({x:_v.x,y:_v.y,z:_v.z}); body.setNextKinematicRotation(_q);
    if(mesh){ mesh.position.copy(_v); mesh.quaternion.copy(_q); }
    bs.curMatrix.compose(_v,_q,new THREE.Vector3(1,1,1));
    // 💦 물보라 링 애니 — 퍼지며 페이드 → 만료 시 풀 반납
    for(const s of _splRings){ if(!s.m.visible) continue; s.t+=dt; const k=s.t/s.life;
      s.m.scale.setScalar(s.r0*(1+k*3.2)); s.m.material.opacity=Math.max(0,s.op0*(1-k));
      if(k>=1){ s.m.visible=false; s.m.position.set(0,-999,0); } }
  });

  // 조타(Z)/닻(T) — ★R3: 배 1척마다 window 리스너 2개 등록하던 것(격침/제거돼도 잔존 = 유령 리스너 누적) 폐지.
  //   전역 1회 등록 + ctx.player._onShip(지금 밟고 있는 배) 참조 = 대상 배가 항상 정확하고 누수 구조적 불가.
  _bindHelmKeysOnce(ctx);
  _bindShipCollisionOnce(ctx);   // 🚢 배–배 충돌(전역 1회)
  return bs;
}

// [근거]
// 확정:
//  - 기존 항해 물리(돛각 A/D·조타 Q/E·바람정렬 catchF·4점 부력) 전부 유지 — 코드 변경 없음. (출처: 본 파일 onUpdate, 변경 전 동일)
//  - 전진 단위벡터 = 기존 onUpdate의 bowX/bowZ(yaw·fwd0 회전 결과) 재사용. (출처: 본 파일 bowX/bowZ 산출 라인)
//  - 우현=forward×up, 좌현=−우현 — three Vector3.crossVectors. (출처: 우현 관례 green / 좌현 red = 국제 항해 등화 관례)
//  - cannon.js 측 계약: 현재 cannon.js는 카메라방향 발사(broadside 미연동) → 측면 인터페이스를 새로 노출만. (출처: voyage/modules/cannon.js 정독)
// 제안:
//  - bs.sideToward(target) 시그니처(Vector3|{x,z}|(x,z) → {side,align,dot}) = cannon 빌더가 읽기 쉽게 한 제안. 합의 시 확정.
//  - 측면 화살 길이 deckW*0.85·기본 표시(showSides=true) = 시각 검증/전투 가독 위한 제안값.
// 미정:
//  - "어느 현이 '적'을 향하는지" 텍스트 HUD = 표적(적 NPC)이 sandbox에 없어 미구현. sideToward()로 배선만 두고 전투(naval) 통합 시 적 좌표 연결. (지어내지 않음)
//  - 측면 화살의 게임 최종 노출 여부(디버그 only vs 상시) = §14/사령관 판단 대기.
