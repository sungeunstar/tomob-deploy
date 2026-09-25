// axetree.js — 샌드박스 섬에서 LPW 나무 도끼 벌목(1인칭). ?sys=axetree
//   FP는 player.js가 담당. 여기선 섬에 나무 배치 + 1인칭 손/도끼 viewmodel(카메라 자식) + 클릭 도끼질 → 단면 잘림 + 쓰러짐.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DestructibleMesh, SliceOptions } from 'three-pinata';

export async function initAxetree(ctx, opts={}){
  const { scene, camera, terrain } = ctx;
  // external=true → 자체 나무 스폰 안 하고 ctx.environment.TREES(본편 나무)를 벌목 대상으로 사용.
  //   environment 나무도 동일 DestructibleMesh + {obj,gy,hitY,state,fallDir} 구조라 슬라이스/쓰러짐 로직 그대로 작동.
  const EXTERNAL = !!opts.external;
  const groundY=(x,z)=> (terrain&&terrain.groundAt) ? terrain.groundAt(x,z) : 0;
  const MAX_CHOPS=5;
  const WOOD_PER_TREE=3;   // 벌목 1그루 → 목재(timber) 적재량(PoC 잠정). ?sys=inventory 같이 로드 시 ctx.inventory 연계.
  const LEAF_PER_TREE=2;   // ★벌목 부산물 나뭇잎(leaf) — 밧줄 제작 재료(나뭇잎→밧줄→깃발/텐트).
  const capMat=new THREE.MeshStandardMaterial({color:0xcea463,roughness:0.85,side:THREE.DoubleSide});

  // ── 나무(KayKit Forest Nature, GLTF 단일 아틀라스) 섬 위에 몇 그루 ──
  //   KayKit = 텍스처 아틀라스(UV) 메쉬 → three-pinata 슬라이스가 UV 보존 → 쓰러진 조각도 텍스처 유지.
  //   (LPW의 vertex-color 최근접 이식 땜빵 불필요 — 검증 _axe_kaykit.html)
  const TREE_H=8, TREE_R=0.5;   // 높이 정규화(KayKit 원본 ~4m → 게임 8m) / 줄기 충돌반경(잎폭 아닌 줄기 기준)
  const _gltf=await new GLTFLoader().loadAsync('/tomob-deploy/kaykit_nature/Tree_1_A_Color1.gltf');
  let _src=null; _gltf.scene.updateMatrixWorld(true); _gltf.scene.traverse(o=>{ if(o.isMesh && !_src) _src=o; });
  let baseGeo=_src.geometry.index?_src.geometry.toNonIndexed():_src.geometry.clone();
  _src.updateMatrixWorld(true); baseGeo.applyMatrix4(_src.matrixWorld);   // gltf 노드 변환 베이크
  baseGeo.computeBoundingBox(); let _bb=baseGeo.boundingBox; const _s=TREE_H/(_bb.max.y-_bb.min.y);
  baseGeo.scale(_s,_s,_s); baseGeo.computeBoundingBox(); _bb=baseGeo.boundingBox; baseGeo.translate(0,-_bb.min.y,0);   // 밑동 y=0 정렬
  const treeMat=Array.isArray(_src.material)?_src.material[0]:_src.material;
  treeMat.side=THREE.DoubleSide; if(treeMat.map) treeMat.map.colorSpace=THREE.SRGBColorSpace; treeMat.needsUpdate=true;
  // 잘린 조각 → 월드 비인덱스 + uv 유지(텍스처 보존) + 그룹(겉0/단면1) 유지
  function prepPiece(h){ h.updateMatrixWorld(true); let g=h.geometry.clone(); g.applyMatrix4(h.matrixWorld);
    if(g.index) g=g.toNonIndexed();
    if(!g.getAttribute('normal')) g.computeVertexNormals(); g.computeBoundingBox(); return g; }
  // materialIndex별 서브지오 추출 (겉=0=텍스처 / 단면=1=목재색, 아틀라스 크레딧 글자 안 보이게) — 비인덱스 전제
  function subGeoByMat(geo, idx){
    const gs=(geo.groups&&geo.groups.length)?geo.groups:[{start:0,count:geo.getAttribute('position').count,materialIndex:0}];
    const rs=gs.filter(g=>(g.materialIndex||0)===idx); if(!rs.length) return null;
    const pos=geo.getAttribute('position'),nor=geo.getAttribute('normal'),uv=geo.getAttribute('uv');
    let total=0; rs.forEach(r=>total+=r.count);
    const P=new Float32Array(total*3),N=new Float32Array(total*3),U=new Float32Array(total*2); let o=0;
    for(const r of rs){ for(let i=0;i<r.count;i++){ const s=r.start+i;
      P[o*3]=pos.getX(s);P[o*3+1]=pos.getY(s);P[o*3+2]=pos.getZ(s);
      N[o*3]=nor.getX(s);N[o*3+1]=nor.getY(s);N[o*3+2]=nor.getZ(s);
      if(uv){U[o*2]=uv.getX(s);U[o*2+1]=uv.getY(s);} o++; } }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(P,3));
    g.setAttribute('normal',new THREE.BufferAttribute(N,3)); g.setAttribute('uv',new THREE.BufferAttribute(U,2)); return g; }
  const mergeSafe=(arr)=>{ if(!arr.length) return null; if(arr.length===1) return arr[0];
    try{ return mergeGeometries(arr,false)||arr[0]; }catch(e){ console.warn('[axe] merge',e&&e.message); return arr[0]; } };
  // ★실제 나무 벌목 = 절단면(pivot) 경첩 회전 애니. 천천히 시작→가속→눕기(자유강체보다 자연스러움). geoWorld=월드좌표.
  function animFall(geoWorld, mats, fallDir, pivot){
    geoWorld.computeBoundingBox(); const len=Math.max(2, geoWorld.boundingBox.max.y - pivot.y);   // 쓰러질 길이(착지 먼지 분포용)
    geoWorld.translate(-pivot.x,-pivot.y,-pivot.z);
    const grp=new THREE.Group(); grp.position.set(pivot.x,pivot.y,pivot.z);
    const fm=new THREE.Mesh(geoWorld, mats); fm.castShadow=true; grp.add(fm); scene.add(grp);
    const d=fallDir||{x:1,z:0}; const axis=new THREE.Vector3(d.z,0,-d.x).normalize();   // up×fallDir
    return { grp, fall:{ axis, t:0, dur:2.1, max:Math.PI*0.55, q:new THREE.Quaternion(),
      impacted:false, bt:0, pivot:{x:pivot.x,y:pivot.y,z:pivot.z}, dir:{x:d.x,z:d.z}, len } };   // ★착지 임팩트(쿵/먼지/바운스)용
  }
  // ── 착지 임팩트: 쿵(sfxFall) + 카메라 흔들림 + 먼지 (원본 _forest_chop 복원) ──
  const _dust=[]; let _dustGeo=null; const _dustG=()=>_dustGeo||(_dustGeo=new THREE.SphereGeometry(0.5,6,5));
  function _spawnDust(x,y,z){ const m=new THREE.Mesh(_dustG(), new THREE.MeshLambertMaterial({color:0xbfae90,transparent:true,opacity:0.38,depthWrite:false}));
    m.position.set(x,y,z); m.scale.setScalar(0.2); scene.add(m); _dust.push({m,life:0,max:0.7,vy:0.4+Math.random()*0.4}); }
  function treeImpact(f){ sfxFall(); ctx.player?.camShake?.(0.11);   // ★쿵 소리 + 카메라 흔들림(착지 순간)
    const len=f.len||4, d=f.dir||{x:1,z:0}, pv=f.pivot;
    for(let i=0;i<8;i++){ const t=i/7, x=pv.x+d.x*t*len+(Math.random()-0.5), z=pv.z+d.z*t*len+(Math.random()-0.5);
      const gy=ctx.terrain?.groundAt?ctx.terrain.groundAt(x,z,pv.y+2):(pv.y-len); _spawnDust(x, gy+0.3, z); } }
  // 나무 위치 — 섬 위 결정론 scatter(중심 r5 이내는 플레이어 스폰이라 비움)
  const TREES=[];
  if(!EXTERNAL){   // 샌드박스/standalone = 자체 나무 16그루 스폰. 본편(external)은 environment.TREES 사용.
    const TREE_POS=[]; let _seed=20260625>>>0; const _rnd=()=>{ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296; };
    for(let i=0;i<16;i++){ const a=_rnd()*Math.PI*2, r=6+_rnd()*12; TREE_POS.push([Math.cos(a)*r, Math.sin(a)*r]); }
    for(const [x,z] of TREE_POS){
      const dm=new DestructibleMesh(baseGeo.clone(), treeMat, capMat);   // ★슬라이스 가능 메쉬(innerMat=단면). baseGeo 밑동 y=0 정규화됨
      dm.scale.setScalar(1); const gy=groundY(x,z); dm.position.set(x,gy,z); dm.castShadow=dm.receiveShadow=true; scene.add(dm);
      let standCol=null;
      if(ctx.world && ctx.RAPIER){   // ★서있는 나무 = 통과 못 함(줄기 기둥 충돌체)
        const cb=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x,gy+TREE_H/2,z));
        ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cylinder(TREE_H/2,TREE_R), cb); standCol=cb;
      }
      TREES.push({ obj:dm, chops:0, state:'stand', shake:0, gy, hitY:gy+1.5, fallMesh:null, body:null, stump:null, standCol, fellAt:0, fallDir:new THREE.Vector3(Math.random()-0.5,0,Math.random()-0.5).normalize() });
    }
  }
  // 벌목 대상 나무 목록 — external이면 본편 environment 나무(라이브 참조 = 섬 재진입 시 갱신), 아니면 자체 TREES.
  const allTrees = ()=> EXTERNAL ? ((ctx.environment && ctx.environment.TREES) || []) : TREES;
  // 쓰러진 나무 받칠 지면 collider
  if(ctx.world && ctx.RAPIER){
    const gb=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(0,((terrain&&terrain.topY)||0)-0.5,0));
    ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(70,0.5,70), gb);
  }

  // ── 1인칭 손+도끼 viewmodel (mas game.legacy 이식, 카메라 자식) ──
  const DEG=Math.PI/180;
  const SWING_PIVOT=new THREE.Vector3(0.34,-0.28,-0.5);
  const _heldPose={ scale:0.5, rx:0.15, ry:-0.55, rz:0.75 };
  const _swingTune={ i:1,yA:45,yF:-20,zF:-20,xF:-80,yB:-45,windX:0.55,windY:-0.25,windZ:0.30,impactAt:0.30,t1:0.25,t2:0.52 };
  let _swingSpeed=4.0, heldSwing=0, _impactDone=false, _heldBaseSize=1, _heldMesh=null;
  const _XA=new THREE.Vector3(1,0,0),_YA=new THREE.Vector3(0,1,0),_ZA=new THREE.Vector3(0,0,1);
  const _q=new THREE.Quaternion(),_qt=new THREE.Quaternion(),_qWind=new THREE.Quaternion(),_qImpact=new THREE.Quaternion(),_qId=new THREE.Quaternion(),_swEuler=new THREE.Euler();
  const _ss=t=>t*t*(3-2*t);
  function _mcSeq(p,out){ const T=_swingTune,f=Math.sin(p*p*Math.PI),f1=Math.sin(Math.sqrt(p)*Math.PI),i=T.i;
    out.setFromAxisAngle(_YA,i*(T.yA+f*T.yF)*DEG); _qt.setFromAxisAngle(_ZA,i*f1*T.zF*DEG); out.multiply(_qt);
    _qt.setFromAxisAngle(_XA,f1*T.xF*DEG); out.multiply(_qt); _qt.setFromAxisAngle(_YA,i*T.yB*DEG); out.multiply(_qt); return out; }
  function buildArm(){ const g=new THREE.Group();
    const skin=new THREE.MeshLambertMaterial({color:0xe6a878}),sleeve=new THREE.MeshLambertMaterial({color:0x4a6a8a});
    const fore=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.30),sleeve); fore.position.set(0,0,0.08);
    const hand=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.11),skin); hand.position.set(0,0,-0.13);
    g.add(fore); g.add(hand); return g; }
  const heldGroup=new THREE.Group();          // 카메라 자식
  const swingGroup=new THREE.Group(); swingGroup.position.copy(SWING_PIVOT);
  const inner=new THREE.Group(); inner.position.copy(SWING_PIVOT).clone().multiplyScalar(-1); inner.position.copy(SWING_PIVOT).multiplyScalar(-1);
  const armGroup=buildArm(); armGroup.position.set(0.22,-0.36,-0.6); armGroup.rotation.set(0.55,-0.5,0.12);
  const toolGroup=new THREE.Group(); inner.add(armGroup); inner.add(toolGroup); swingGroup.add(inner); heldGroup.add(swingGroup);
  camera.add(heldGroup);
  if(!camera.parent) scene.add(camera);       // 카메라가 씬에 없으면(자식 렌더 위해)
  // 도끼 GLB
  new GLTFLoader().load(encodeURI('/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/tool-axe.glb'), g=>{
    armGroup.visible=false; const m=g.scene.clone(true);
    m.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; const src=Array.isArray(o.material)?o.material[0]:o.material;
      o.material=new THREE.MeshLambertMaterial({ map:(src&&src.map)?src.map:null, color:(src&&src.map)?0xffffff:0xb9b9b9 }); }});
    const box=new THREE.Box3().setFromObject(m); _heldBaseSize=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z)||1;
    const c=box.getCenter(new THREE.Vector3()); m.position.sub(c);
    const wrap=new THREE.Group(); wrap.add(m); _heldMesh=wrap; toolGroup.add(wrap);
    wrap.scale.setScalar(_heldPose.scale/_heldBaseSize); wrap.position.copy(SWING_PIVOT); wrap.rotation.set(_heldPose.rx,_heldPose.ry,_heldPose.rz);
  }, undefined, ()=>{ armGroup.visible=true; });

  function sfx(url,vol){ let a=null; try{a=new Audio(url);a.volume=vol;}catch(e){} return ()=>{try{if(a){const n=a.cloneNode();n.volume=vol;n.play().catch(()=>{});}}catch(e){}}; }
  const sfxChop=sfx('/tomob-deploy/w1.mp3',0.7), sfxFall=sfx('/tomob-deploy/w2.mp3',0.85);   // w1=타격, w2=쓰러짐(원래 물리 벌목 데모 음원)
  const chips=[]; const chipGeo=new THREE.BoxGeometry(0.1,0.06,0.16), chipMat=new THREE.MeshStandardMaterial({color:0x8a5a2a,roughness:1});
  function spawnChips(p){ for(let i=0;i<6;i++){ const m=new THREE.Mesh(chipGeo,chipMat); m.position.copy(p); scene.add(m);
    chips.push({m,v:new THREE.Vector3((Math.random()-0.5)*3,2+Math.random()*2,(Math.random()-0.5)*3),life:1.2}); } }
  // ★통나무 쪼개짐 물리 — 통나무 조각(짧은 원기둥)이 튕겨 흩어져 굴러 착지→페이드 (releaseLog)
  const _logChunks=[]; const _logChunkGeo=new THREE.CylinderGeometry(0.13,0.16,0.72,7);
  function spawnLogChunks(pos, dir, mat){ const d=dir||{x:1,z:0};
    for(let i=0;i<5;i++){ const m=new THREE.Mesh(_logChunkGeo, mat?mat.clone():chipMat.clone());
      m.position.set(pos.x+(Math.random()-0.5)*0.5, pos.y+0.35, pos.z+(Math.random()-0.5)*0.5);
      m.rotation.set(Math.random()*6.28,Math.random()*6.28,Math.random()*6.28); m.castShadow=true; scene.add(m);
      _logChunks.push({ m, gy:pos.y, grounded:false, life:0,
        v:new THREE.Vector3(d.x*1.4+(Math.random()-0.5)*3.2, 2.6+Math.random()*3, d.z*1.4+(Math.random()-0.5)*3.2),
        av:new THREE.Vector3((Math.random()-0.5)*11,(Math.random()-0.5)*11,(Math.random()-0.5)*11) }); } }

  // 도끼 휘두름 → 임팩트 시 조준 나무 타격
  const ray=new THREE.Raycaster();
  // 본편: 도끼(axe) 장착 시에만 벌목(전투/다른 도구 클릭과 충돌 방지). 도구 개념 없는 standalone은 무조건 허용.
  function swing(){ if(ctx.player && ctx.player.currentTool && ctx.player.currentTool!=='axe') return; if(heldSwing<=0) heldSwing=1; }
  function aimedTree(){ ray.setFromCamera(new THREE.Vector2(0,0), camera);
    let best=null,bd=1e9; for(const T of allTrees()){
      if(T.state==='stand'){ const h=ray.intersectObject(T.obj,true)[0];
        if(h && h.distance<bd && h.distance<12){ bd=h.distance; best={T,p:h.point,kind:'stand'}; } }
      else if(T.harvestable && T.fallMesh){ const h=ray.intersectObject(T.fallMesh,true)[0];   // 쓰러진 통나무도 조준 대상
        if(h && h.distance<bd && h.distance<12){ bd=h.distance; best={T,p:h.point,kind:'log'}; } }
    } return best; }
  function onImpact(){ const a=aimedTree(); if(!a) return; const {T,p,kind}=a;
    if(kind==='log'){ spawnChips(p); sfxChop(); releaseLog(T,p); return; }   // ★쓰러진 통나무 패기 → 조각 튐
    T.hitY=p.y;   // ★조준점(화면 중앙 ray) 명중 높이 → 마지막 타격 지점에서 잘림(_axe_tree와 동일)
    spawnChips(p); sfxChop(); T.shake=0.3;
    if(ctx.toolDur && !ctx.toolDur.wear('axe')) return;   // ★D2(2026-07-15): 도끼 내구도 소모 — 무뎌지면 헛손질(chops 미증가=효율 절반). VFX/사운드는 위에서 이미 재생.
    T.chops++;
    // 쓰러짐 방향 = 베는 사람 → 나무(바깥쪽). 실제 벌목처럼 베는 반대로 넘어감.
    const o=(ctx.player&&ctx.player.pos)?ctx.player.pos:camera.position;
    const dx=T.obj.position.x-o.x, dz=T.obj.position.z-o.z, L=Math.hypot(dx,dz)||1; T.fallDir.set(dx/L,0,dz/L);
    if(T.chops>=MAX_CHOPS) cutTree(T); }
  // ★찍은 높이(hitY)에서 three-pinata sliceWorld로 평면 절단 → 위(쓰러짐 물리)/아래(그루터기). 단면 cap 자동.
  // ★2단계 벌목 — 서있는 나무는 쓰러뜨리기만(산물 X). 쓰러진 통나무를 한 번 더 치면(releaseLog) 쪼개져 조각이 몸으로 빨려듦.
  function cutTree(T){
    if(T.standCol && ctx.world){ try{ ctx.world.removeRigidBody(T.standCol); }catch(e){} T.standCol=null; }  // 서있는 충돌체 제거
    const dm=T.obj; dm.updateMatrixWorld(true);
    const cx=dm.position.x, cz=dm.position.z, cutY=Math.max(T.gy+0.5, T.hitY||T.gy+1.5);
    let halves=null;
    try{ halves=dm.sliceWorld(new THREE.Vector3(0,1,0), new THREE.Vector3(cx,cutY,cz), new SliceOptions(), null, null); }
    catch(e){ console.warn('[axe] slice', e&&e.message); }
    const good=(halves||[]).filter(h=>{ const pp=h.geometry&&h.geometry.getAttribute('position'); return pp&&pp.count>6; });
    if(good.length<2){   // ★slice 실패 → 통째로 경첩 회전 애니로 쓰러짐(절단은 못해도 쓰러짐은 보장)
      dm.updateMatrixWorld(true); scene.remove(dm);
      const wg=dm.geometry.clone(); wg.applyMatrix4(dm.matrixWorld);
      const mt=Array.isArray(dm.material)?dm.material.map(m=>m.clone()):dm.material.clone();   // material clone — 공유 페이드 격리
      const af=animFall(wg, mt, T.fallDir, {x:cx,y:cutY,z:cz}); T.fallMesh=af.grp; T.fall=af.fall;
      T.state='phys'; T.fellAt=performance.now(); T.harvestable=true; sfxFall(); return;   // ★쓰러진 통나무 = 패기 가능
    }
    scene.remove(dm);
    // cutY 기준 위쪽 전부(tops)·아래쪽 전부(bots)로 분류 → 각각 한 덩어리 merge(잎 덩어리까지 같이 쓰러짐)
    // 겉(텍스처)/단면(목재색) 분리 → 단일 지오 2머티리얼 (단면에 아틀라스 글자 안 보이게). ★머티리얼 clone — 공유 페이드 격리
    const build=(outerArr,cutArr)=>{ const oM=mergeSafe(outerArr), cM=mergeSafe(cutArr);
      if(oM&&cM){ let geo; try{geo=mergeGeometries([oM,cM],true);}catch(e){geo=oM;} return {geo,mats:[treeMat.clone(),capMat.clone()]}; }
      if(oM) return {geo:oM,mats:treeMat.clone()}; if(cM) return {geo:cM,mats:capMat.clone()}; return null; };
    const tO=[],tC=[],bO=[],bC=[];
    for(const h of good){ const g=prepPiece(h); const cy=(g.boundingBox.min.y+g.boundingBox.max.y)/2;
      const oG=subGeoByMat(g,0), cG=subGeoByMat(g,1);
      if(cy>=cutY){ if(oG)tO.push(oG); if(cG)tC.push(cG); } else { if(oG)bO.push(oG); if(cG)bC.push(cG); } }
    const bot=build(bO,bC); if(bot){ const sm=new THREE.Mesh(bot.geo,bot.mats); sm.castShadow=sm.receiveShadow=true; scene.add(sm); T.stump=sm; }  // 아래 = 그루터기(고정)
    const top=build(tO,tC);
    if(top){                                                                           // 위 = 쓰러짐. 실제 나무처럼 절단면 경첩 가속 회전 애니
      const af=animFall(top.geo, top.mats, T.fallDir, {x:cx,y:cutY,z:cz}); T.fallMesh=af.grp; T.fall=af.fall;
    }
    T.state='phys'; T.fellAt=performance.now(); T.harvestable=true; sfxFall();   // ★쓰러진 통나무 = 패기 가능
  }
  // ★쓰러진 통나무를 도끼로 다시 치면 = 쪼개짐. 통나무·나뭇잎 조각이 튀어나와 몸으로 빨려듦(마그넷).
  function releaseLog(T, p){
    const fp=(T.fallMesh&&T.fallMesh.position)||T.obj.position; const dp={ x:p?p.x:fp.x, y:p?p.y:(T.gy+0.4), z:p?p.z:fp.z };
    const woodMul = ctx.settlement?.woodMulAt ? ctx.settlement.woodMulAt(dp.x, dp.z) : 1;   // 🪵 제재소 건물 = 그 섬 벌목·목재↑ (생산 기지)
    const woodQty = Math.round(WOOD_PER_TREE*woodMul);
    if(ctx.pickup){ ctx.pickup.spawn('timber', woodQty, dp, { mat:treeMat, scale:0.3, nuggets:4, pop:2.6 }); ctx.pickup.spawn('leaf', LEAF_PER_TREE, dp, { scale:0.95, pop:2.6 });   // ★pop=세게 튀겨 흩어진 뒤 빨려듦(코앞 벌목이라 즉시흡수 방지)
      console.log('[axetree] 통나무 쪼갬 → 통나무',woodQty,'나뭇잎',LEAF_PER_TREE); }
    else if(ctx.inventory){ ctx.inventory.add('timber', woodQty); ctx.inventory.add('leaf', LEAF_PER_TREE); }
    spawnLogChunks(dp, T.fallDir, capMat);   // ★쪼개짐 물리 — 통나무 조각. capMat(단면 목재색·텍스처 없음) 사용 = treeMat 아틀라스의 크레딧 글자 표면 제거(사령관 "글자있는 나무 표면")
    sfxFall();                                // 쪼개지는 소리(쿵/우지끈)
    T.harvestable=false; T.state='down';
    if(T.fallMesh){ scene.remove(T.fallMesh); T.fallMesh=null; T.fall=null; }   // 원통 통나무 사라짐(조각으로 쪼개져 나감)
  }
  addEventListener('pointerdown', e=>{ if(e.button===0) swing(); });

  // ── 🖐️ 맨손 채집(사령관): 도끼 없을 때 나무를 부수지 않고 누르는 동안 5초당 목재 1개. 도구 분실 대비 최소 생존 채집. ──
  let _bareHeld=false, _bareT=0;
  addEventListener('pointerdown', e=>{ if(e.button===0) _bareHeld=true; });
  addEventListener('pointerup',   e=>{ if(e.button===0) _bareHeld=false; });
  addEventListener('blur', ()=>{ _bareHeld=false; });

  // 매 프레임: swing 애니 + 흔들림 + 쓰러짐 + 칩
  ctx.onUpdate(dt=>{
    heldGroup.visible = !ctx.player;   // player 있으면 도끼 viewmodel은 player.js가 통합 표시(중복 방지). 벌목 로직(swing/onImpact)은 유지.
    // 🖐️ 맨손 채집 — 도끼 미장착 + 좌클릭 유지 + 나무 조준 시 5초당 목재 1(부수지 않음)
    if(_bareHeld && ctx.player && ctx.player.currentTool==='none'){
      const ba=aimedTree();
      if(ba){ _bareT+=dt; ba.T.shake=Math.max(ba.T.shake||0, 0.12);   // 살짝 흔들림 = 캐는 중 피드백
        if(_bareT>=5){ _bareT=0; const dp={ x:ba.p.x, y:ba.p.y, z:ba.p.z };
          if(ctx.pickup) ctx.pickup.spawn('timber', 1, dp, { mat:treeMat, scale:0.3, nuggets:1, pop:2.2 });
          else if(ctx.inventory) ctx.inventory.add('timber', 1);
          spawnChips(ba.p); sfxChop(); } }
      else _bareT=0;
    } else if(_bareT){ _bareT=0; }
    if(heldSwing>0){ heldSwing=Math.max(0,heldSwing-dt*_swingSpeed); const T=_swingTune,p=1-heldSwing;
      _qWind.setFromEuler(_swEuler.set(T.windX,T.windY,T.windZ)); _mcSeq(T.impactAt,_qImpact);
      if(p<T.t1)_q.copy(_qId).slerp(_qWind,_ss(p/T.t1)); else if(p<T.t2)_q.copy(_qWind).slerp(_qImpact,_ss((p-T.t1)/(T.t2-T.t1))); else _q.copy(_qImpact).slerp(_qId,_ss((p-T.t2)/(1-T.t2)));
      swingGroup.quaternion.copy(_q); if(!_impactDone&&p>=T.t2){_impactDone=true; onImpact();}
    } else { swingGroup.quaternion.identity(); _impactDone=false; }
    for(const T of allTrees()){
      if(T.shake>0){ T.shake-=dt*1.6; T.obj.rotation.z=Math.sin(performance.now()*0.05)*T.shake*0.05; if(T.shake<0){T.shake=0;T.obj.rotation.z=0;} }
      if(T.state==='phys' && T.fall && T.fallMesh){ const f=T.fall;
        if(f.t<f.dur){ f.t+=dt; const u=Math.min(1,f.t/f.dur); const e=u*u;   // 가속(ease-in) 낙하
          f.q.setFromAxisAngle(f.axis, f.max*e); T.fallMesh.quaternion.copy(f.q); }
        else if(!f.impacted){ f.impacted=true; treeImpact(f); }   // ★착지 쿵(1회) — 소리·흔들림·먼지
        else if(f.bt<0.85){ f.bt+=dt; const a=f.max+Math.sin(f.bt*19)*Math.exp(-f.bt*5.5)*(7*Math.PI/180); f.q.setFromAxisAngle(f.axis,a); T.fallMesh.quaternion.copy(f.q); } }   // 반동 바운스(감쇠)
      // ★시간 지나면 그루터기/쓰러진 나무 페이드 후 제거
      if((T.state==='phys'||T.state==='down') && T.fellAt){ const age=(performance.now()-T.fellAt)/1000;
        if(age>8){ const o=Math.max(0,1-(age-8)*0.6);
          [T.fallMesh,T.stump].forEach(mm=>{ if(mm) mm.traverse(x=>{ if(x.material){ const ms=Array.isArray(x.material)?x.material:[x.material]; ms.forEach(mt=>{mt.transparent=true; mt.opacity=o; mt.depthWrite=false;}); } }); });
          if(age>9.7){ if(T.fallMesh)scene.remove(T.fallMesh); if(T.stump)scene.remove(T.stump); T.fall=null; T.state='gone'; } } }
    }
    // ★착지 먼지 업데이트(부풀며 상승·페이드) — 나무 루프 밖(프레임당 1회)
    for(let i=_dust.length-1;i>=0;i--){ const d=_dust[i]; d.life+=dt; const u=d.life/d.max; d.m.scale.setScalar(0.2+u*1.5); d.m.position.y+=d.vy*dt; d.m.material.opacity=0.38*(1-u); if(u>=1){ scene.remove(d.m); d.m.material.dispose(); _dust.splice(i,1); } }
    // ★통나무 쪼개짐 조각 물리(튕김·회전·착지·페이드)
    for(let i=_logChunks.length-1;i>=0;i--){ const c=_logChunks[i]; c.life+=dt;
      if(!c.grounded){ c.v.y-=20*dt; c.m.position.addScaledVector(c.v,dt); c.m.rotation.x+=c.av.x*dt; c.m.rotation.y+=c.av.y*dt; c.m.rotation.z+=c.av.z*dt;
        const gy=ctx.terrain?.groundAt?ctx.terrain.groundAt(c.m.position.x,c.m.position.z,c.m.position.y+2):c.gy;
        if(c.m.position.y<=gy+0.12){ c.m.position.y=gy+0.12; c.grounded=true; c.v.set(0,0,0); c.m.rotation.x=Math.PI/2; } }   // 착지 = 옆으로 눕힘
      if(c.life>1.5){ const o=Math.max(0,1-(c.life-1.5)*1.6); const ms=Array.isArray(c.m.material)?c.m.material:[c.m.material]; ms.forEach(mt=>{mt.transparent=true; mt.opacity=o; mt.depthWrite=false;});
        if(c.life>2.2){ scene.remove(c.m); const ms2=Array.isArray(c.m.material)?c.m.material:[c.m.material]; ms2.forEach(mt=>mt.dispose()); _logChunks.splice(i,1); } } }
    for(let i=chips.length-1;i>=0;i--){ const c=chips[i]; c.v.y-=16*dt; c.m.position.addScaledVector(c.v,dt); c.life-=dt; if(c.life<0){scene.remove(c.m);chips.splice(i,1);} }
    if(window.__dc){ ctx.camera.position.set(...window.__dc.p); ctx.camera.lookAt(...window.__dc.t); }   // 검수용 카메라(player 덮어쓰기 뒤)
  });

  // ── 프리워밍(사령관 "첫 벌목 프레임 드랍") — three-pinata slice 최초 실행 + 벌목 머티리얼 셰이더 컴파일을 로드 시점으로 이동 ──
  try{
    const warm=new DestructibleMesh(baseGeo.clone(), treeMat, capMat); warm.position.set(0,-990,0); warm.updateMatrixWorld(true);
    try{ warm.sliceWorld(new THREE.Vector3(0,1,0), new THREE.Vector3(0,-988.5,0), new SliceOptions(), null, null); }catch(_){}   // slice 코드경로 워밍(가장 무거운 첫 실행)
    const wChip=new THREE.Mesh(chipGeo, chipMat); wChip.position.set(0,-990,0);
    const wDust=new THREE.Mesh(_dustG(), new THREE.MeshLambertMaterial({color:0xbfae90,transparent:true,opacity:0.38,depthWrite:false})); wDust.position.set(0,-990,0);
    scene.add(warm, wChip, wDust);
    if(ctx.renderer && ctx.camera) ctx.renderer.compile(scene, ctx.camera);
    scene.remove(warm, wChip, wDust);
  }catch(e){ console.warn('[axetree] prewarm', e&&e.message); }

  ctx.axetree={ get trees(){ return allTrees().length; }, swing };
  window.__sbaxe={ fell:(hy)=>{ const T=allTrees().find(t=>t.state==='stand'); if(T){ if(hy!=null)T.hitY=T.gy+hy; const pp=[T.obj.position.x,T.gy,T.obj.position.z]; T.chops=MAX_CHOPS; cutTree(T); return pp; } },
    chopLog:()=>{ const T=allTrees().find(t=>t.harvestable); if(T){ const fp=(T.fallMesh&&T.fallMesh.position)||T.obj.position; releaseLog(T, {x:fp.x,y:T.gy+0.4,z:fp.z}); return true; } return false; },   // 쓰러진 통나무 패기(검증용)
    logs:()=>allTrees().filter(t=>t.harvestable).length,
    look:(p)=>{ const gy=(p&&p[1])||0; window.__dc={ p:[p[0]+8,gy+5,p[2]+8], t:[p[0],gy+2,p[2]] }; } };
  console.log('[axetree]', TREES.length, '그루 — 클릭으로 도끼질');
  return ctx.axetree;
}
