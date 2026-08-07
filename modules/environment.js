// environment.js — 섬별 환경 자원 자동배치(나무·잔디·배경돌·광석). game.html 통합용.
//   출처: _island_spawn.html 인라인 환경 시스템을 그대로 이식(코드 변경 없이 scene/ground/loop 출처만 ctx 배선).
//   ★v1 = 배치(populate)만. 벌목(axe viewmodel/cutTree)·조준 아웃라인(OutlinePass)은 v2 보류.
//   - 티어(섬이름 소형/중형/대형/얼음)별 자원 프로필 → 나무수·광석·잔디·돌.
//   - ground 출처 = ctx.terrain.collide (terrain.js가 만든 지형 Group, Rapier 충돌체 포함).
//   - 나무 줄기 충돌 = axetree.js와 동일 Rapier 실린더 패턴.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DestructibleMesh } from 'three-pinata';

const LOWPOLY_TERRAIN=new Set(['Islands','Terrain','Mountains','River','Water','Ice','Clouds']);

export async function initEnvironment(ctx){
  const { scene, terrain } = ctx;
  if(!terrain || !terrain.collide || !terrain.collide.length){ console.warn('[env] 지형 없음 — 스폰 스킵'); ctx.environment={ trees:0, ores:0 }; return ctx.environment; }
  const capMat=new THREE.MeshStandardMaterial({color:0xcea463,roughness:0.85,side:THREE.DoubleSide});

  // ── 티어 판정 (섬 세션 이름) ──
  const ISLE_NAME=(terrain.data && terrain.data.name) || '';
  const TIER = /얼음/.test(ISLE_NAME)?'ice' : /대형/.test(ISLE_NAME)?'large' : /중형/.test(ISLE_NAME)?'mid' : /소형/.test(ISLE_NAME)?'small' : 'mid';
  const ICE = TIER==='ice';
  const CFG = ({
    small: { trees:35,  oreRing:10, oreExtra:12, grass:true,  bareOnly:false, oreW:'common', rock:0 },
    mid:   { trees:75,  oreRing:18, oreExtra:24, grass:true,  bareOnly:false, oreW:'normal', rock:0 },   // ★배경 돌 제거(rock 0) — 채광 가능 '돌' 광석과 헷갈려서(사령관)   // ★시작섬(카브)=mid·산1개뿐 → 산 근처에만 광석 뭉치던 것 해소: 섬 전역 산개(oreExtra) 대폭↑ (사령관: 돌 광물 너무 없음)
    large: { trees:150, oreRing:24, oreExtra:36, grass:true,  bareOnly:false, oreW:'rich',   rock:0 },   // ★전체 섬 전역 산개 통일(사령관) — large도 산 근처만 아니라 섬 전역에 광석
    ice:   { trees:22,  oreRing:30, oreExtra:18, grass:false, bareOnly:true,  oreW:'veins',  rock:0 },
  })[TIER];

  // ── ctx.terrain.collide → groundMeshes / isleMeshes / mountains 어댑터 (terrain.js와 동일 카테고리 분류) ──
  //   terrain.js는 data.objs.filter(isTerr) 순서로 collide[]에 push. 같은 isTerr를 재현해 zip → 각 group 카테고리 식별.
  const groundMeshes=terrain.collide.slice();   // 보행/배치 raycast 대상(섬+산)
  const isleMeshes=[];                            // 나무·잔디 배치 대상(섬 평지만, 산 제외)
  const mountains=[];                             // {x,z,r} 산 footprint
  try{
    const [ti,ai]=await Promise.all([
      fetch('/terrain-index.json').then(r=>r.json()).catch(()=>[]),
      fetch('/asset-index.json').then(r=>r.json()).catch(()=>[]),
    ]);
    const byUrl=new Map(); [...ti,...ai].forEach(m=>byUrl.set(m.url,m));
    const isTerr=o=>{ const it=byUrl.get(o.url); return it && LOWPOLY_TERRAIN.has(it.category); };
    const terrObjs=(terrain.data.objs||[]).filter(isTerr);
    for(let i=0;i<terrObjs.length && i<groundMeshes.length;i++){
      const o=terrObjs[i], grp=groundMeshes[i];
      const isIce=/\/Ice\//i.test(o.url), isMtn=/\/Mountains\//i.test(o.url), isIsle=/\/Islands\//i.test(o.url)||isIce;
      const bb=new THREE.Box3().setFromObject(grp), s=bb.getSize(new THREE.Vector3()), c=bb.getCenter(new THREE.Vector3());
      if(isMtn) mountains.push({ x:c.x, z:c.z, r:Math.max(s.x,s.z)*0.5 });
      if(isIsle) isleMeshes.push(grp);
    }
  }catch(e){ console.warn('[env] 카테고리 분류 실패 — 전체를 섬으로 간주', e&&e.message); }
  if(!isleMeshes.length) isleMeshes.push(...groundMeshes);   // 분류 실패 폴백

  // 가장 큰 섬 중심 = 배치 기준점
  const SPAWN=new THREE.Vector3(terrain.spawn.x,0,terrain.spawn.z); let ISLE_R=200;
  { let big=0; for(const m of isleMeshes){ const bb=new THREE.Box3().setFromObject(m), s=bb.getSize(new THREE.Vector3()), c=bb.getCenter(new THREE.Vector3());
      const area=s.x*s.z; if(area>big){ big=area; SPAWN.set(c.x,0,c.z); ISLE_R=Math.max(s.x,s.z)*0.5; } } }

  // 지면 높이 raycast (full hit — .uv/.face 필요)
  const _dn=new THREE.Vector3(0,-1,0), _rc=new THREE.Raycaster();
  function groundAt(x,z,meshes){ _rc.set(new THREE.Vector3(x,800,z),_dn); _rc.far=2000; const h=_rc.intersectObjects(meshes||groundMeshes,true); return h.length?h[0]:null; }
  const WATER_Y=2.0;

  // 지형 아틀라스 색 샘플 → 초록(잔디)에만 (노란 모래·회색 바위 제외)
  let _ac=null, FLIPV=true;
  await new Promise(res=>{ const im=new Image(); im.onload=()=>{ try{ const cv=document.createElement('canvas'); cv.width=im.width; cv.height=im.height; const cx=cv.getContext('2d',{willReadFrequently:true}); cx.drawImage(im,0,0); _ac={cx,w:cv.width,h:cv.height}; }catch(e){} res(); }; im.onerror=()=>res(); im.src='/obj/lowpoly_terrain/Terrain_Assets/Textures/CPT_Terrain_Texture_Atlas_01.png'; });
  function isGreen(h){ if(!_ac || !h || !h.uv) return true; let u=h.uv.x-Math.floor(h.uv.x), v=h.uv.y-Math.floor(h.uv.y); if(FLIPV) v=1-v;
    const px=Math.min(_ac.w-1,Math.max(0,(u*_ac.w)|0)), py=Math.min(_ac.h-1,Math.max(0,(v*_ac.h)|0));
    const d=_ac.cx.getImageData(px,py,1,1).data; return d[1]>d[0]+8 && d[1]>d[2]+14 && d[1]>60; }

  // ── KayKit 나무 프로토타입 20종 (높이1 정규화, 밑동 y=0) ──
  const TYPES=['Tree_1_A','Tree_1_B','Tree_1_C','Tree_2_A','Tree_2_B','Tree_2_C','Tree_2_D','Tree_2_E',
    'Tree_3_A','Tree_3_B','Tree_3_C','Tree_4_A','Tree_4_B','Tree_4_C',
    'Tree_Bare_1_A','Tree_Bare_1_B','Tree_Bare_1_C','Tree_Bare_2_A','Tree_Bare_2_B','Tree_Bare_2_C'];
  const gl=new GLTFLoader(); const PROTOS=[];
  await Promise.all(TYPES.map(name=> gl.loadAsync(`/kaykit_nature/${name}_Color1.gltf`).then(g=>{
    let src=null; g.scene.updateMatrixWorld(true); g.scene.traverse(o=>{ if(o.isMesh && !src) src=o; });
    let geo=src.geometry.index?src.geometry.toNonIndexed():src.geometry.clone();
    src.updateMatrixWorld(true); geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox(); let bb=geo.boundingBox; const s=1/(bb.max.y-bb.min.y);
    geo.scale(s,s,s); geo.computeBoundingBox(); bb=geo.boundingBox; geo.translate(0,-bb.min.y,0);
    const mat=Array.isArray(src.material)?src.material[0]:src.material; mat.side=THREE.DoubleSide; if(mat.map)mat.map.colorSpace=THREE.SRGBColorSpace; mat.needsUpdate=true;
    PROTOS.push({name,geo,mat});
  }).catch(e=>console.warn('proto',name,e&&e.message)) ));

  // ── 🪨 배경 돌 프로토타입(KayKit Rock, 최대변 1로 정규화) ──
  const ROCKS_T=['Rock_1_A','Rock_1_D','Rock_1_H','Rock_2_A','Rock_2_C','Rock_3_A','Rock_3_D','Rock_3_H'];
  const ROCKS=[];
  await Promise.all(ROCKS_T.map(name=> gl.loadAsync(`/kaykit_nature/${name}_Color1.gltf`).then(g=>{
    let src=null; g.scene.updateMatrixWorld(true); g.scene.traverse(o=>{ if(o.isMesh && !src) src=o; });
    let geo=src.geometry.index?src.geometry.toNonIndexed():src.geometry.clone();
    src.updateMatrixWorld(true); geo.applyMatrix4(src.matrixWorld);
    geo.computeBoundingBox(); const s=geo.boundingBox.getSize(new THREE.Vector3()); const mx=Math.max(s.x,s.y,s.z)||1;
    geo.scale(1/mx,1/mx,1/mx); geo.computeBoundingBox(); geo.translate(0,-geo.boundingBox.min.y,0);
    const mat=Array.isArray(src.material)?src.material[0]:src.material; mat.side=THREE.DoubleSide; if(mat.map)mat.map.colorSpace=THREE.SRGBColorSpace; mat.needsUpdate=true;
    ROCKS.push({name,geo,mat});
  }).catch(e=>console.warn('rock',name,e&&e.message)) ));

  // ── 🌳 나무 배치 (평지만: 수면위 + 경사완만 + 산 footprint 제외, 결정론 시드) ──
  const TREES=[];
  const SOLIDS=[];        // 충돌체 {x,z,r} — 나무·돌·광석
  const ORE_NODES=[];     // 광석 메시 (조준/채광 v2용)
  let _seed=20260629>>>0; const rnd=()=>{ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296; };
  function inMountain(x,z){ for(const m of mountains){ const dx=x-m.x,dz=z-m.z; if(dx*dx+dz*dz < (m.r*0.95)*(m.r*0.95)) return true; } return false; }
  const TREE_POOL = CFG.bareOnly ? PROTOS.filter(p=>/Bare/i.test(p.name)) : PROTOS;
  function placeTrees(target){
    const R=ISLE_R; let tries=0, placed=0;
    while(placed<target && tries<target*12){ tries++;
      const a=rnd()*6.283, rr=Math.sqrt(rnd())*R; const x=SPAWN.x+Math.cos(a)*rr, z=SPAWN.z+Math.sin(a)*rr;
      if(inMountain(x,z)) continue;
      const h=groundAt(x,z,isleMeshes); if(!h) continue;
      if(h.point.y < WATER_Y+0.5) continue;
      if(h.face){ const nr=h.face.normal.clone().transformDirection(h.object.matrixWorld); if(nr.y<0.85) continue; }
      if(!ICE && !isGreen(h)) continue;
      const dx=x-SPAWN.x,dz=z-SPAWN.z; if(dx*dx+dz*dz<64) continue;
      const proto=TREE_POOL[(rnd()*TREE_POOL.length)|0]; if(!proto) continue;
      const H=15 + Math.pow(rnd(),1.1)*15;
      const dm=new DestructibleMesh(proto.geo.clone(), proto.mat, capMat);
      dm.scale.setScalar(H); dm.position.set(x,h.point.y,z); dm.rotation.y=rnd()*6.283; dm.castShadow=true; dm.receiveShadow=false; scene.add(dm);   // 🌑 Phase1: 그림자 던지되 안 받음(flat 캐노피 self-shadow 지저분 방지 — 로우폴리 정석)
      const T={ obj:dm, name:proto.name, H, gy:h.point.y, chops:0, state:'stand', shake:0, hitY:h.point.y+H*0.4, parts:[], stumps:[], fellAt:0, fallDir:new THREE.Vector3(rnd()-0.5,0,rnd()-0.5).normalize() };
      TREES.push(T);
      const sr=0.6+H*0.04;
      SOLIDS.push({x,z,r:sr,tree:T});
      // 줄기 충돌체 (axetree.js와 동일 Rapier 실린더 패턴 — 서있는 나무는 통과 못 함)
      if(ctx.world && ctx.RAPIER){
        const cb=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x,h.point.y+H/2,z));
        ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cylinder(H/2,sr), cb); T.standCol=cb;
      }
      placed++;
    }
    return placed;
  }
  scene.updateMatrixWorld(true);
  const nPlaced=placeTrees(CFG.trees);
  // ★산 파묻힘 정리 — 산 메시가 env init 후 늦게 로드/등록돼(init 시점 terrain.groundAt이 산 미반영) 산 footprint 경계의 나무가 산 속에 박히는 케이스.
  //   실제 지형(terrain.groundAt)이 밑동보다 2m+ 높으면 파묻힘 → 메시·Rapier충돌체·SOLIDS·TREES 정리. 함수 추출(자동 rAF 스윕 + 하네스 직접 호출용).
  function sweepBuried(){
    if(!ctx.terrain || !ctx.terrain.groundAt) return 0;
    let rm=0;
    for(let i=TREES.length-1;i>=0;i--){ const t=TREES[i], p=t.obj.position;
      // ⚠️ environment 자기 나무(scene 직속)만 정리 — worldstream 스트림 나무(wst 그룹의 자식)는 worldstream이 소유·언로드.
      //   여길 건드리면 스윕이 스트림 나무 바디를 제거→나중 섬 언로드 때 worldstream이 같은 바디 재제거→Rapier 패닉("recursive use") 크래시.
      if(t.obj.parent !== scene) continue;
      const tg=ctx.terrain.groundAt(p.x,p.z,5000);
      if(typeof tg==='number' && tg > p.y+2){
        scene.remove(t.obj);
        if(t.standCol && ctx.world){ try{ ctx.world.removeRigidBody(t.standCol); }catch(_){} t.standCol=null; }   // ★null = 재제거 방지
        const si=SOLIDS.findIndex(s=>s.tree===t); if(si>=0) SOLIDS.splice(si,1);
        TREES.splice(i,1); rm++;
      } }
    return rm;
  }
  { let _swT=0, _passes=0, _stop=false;   // 로드 안정화 후 ~8초간 4회 자동 스윕(산 늦게 로드까지 커버)
    ctx.onUpdate(dt=>{ if(_stop) return; _swT+=dt||0.016; if(_swT<2) return; _swT=0; _passes++;
      const rm=sweepBuried(); if(rm) console.log('[env] 산 파묻힘 나무 '+rm+'그루 제거(스윕 '+_passes+')');
      if(_passes>=4) _stop=true;
    });
  }

  // ── 🌿 섬 잔디 = 빽빽한 패치 instance + 청크 분할(프러스텀/거리 컬링) ──
  let grassMat=null; const grassChunks=[]; const GRASS_MAXD=95;
  (function buildGrass(){
    if(!CFG.grass){ console.log('[grass] off (',TIER,')'); return; }
    const bb=new THREE.Box3(); isleMeshes.forEach(m=>bb.expandByObject(m));
    const minX=bb.min.x,maxX=bb.max.x,minZ=bb.min.z,maxZ=bb.max.z;
    const GW=120, cx=(maxX-minX)/GW, cz=(maxZ-minZ)/GW;
    const gyA=new Float32Array(GW*GW), gok=new Uint8Array(GW*GW);
    for(let i=0;i<GW;i++) for(let j=0;j<GW;j++){ const x=minX+(i+0.5)*cx, z=minZ+(j+0.5)*cz;
      const h=groundAt(x,z,isleMeshes); let ok=0,y=0;
      if(h && h.point.y>WATER_Y+0.5 && !inMountain(x,z) && isGreen(h)){ y=h.point.y; const nr=h.face?h.face.normal.clone().transformDirection(h.object.matrixWorld):null; ok=(!nr||nr.y>0.78)?1:0; }
      gyA[i*GW+j]=y; gok[i*GW+j]=ok; }
    const BL=40, RAD=1.7, segs=3; const pos=[],aH=[],idx=[]; let vb=0; let r=98765; const rr=()=>{ r=(r*9301+49297)%233280; return r/233280; };
    for(let b=0;b<BL;b++){ const a=rr()*6.283, rad=Math.sqrt(rr())*RAD, bx=Math.cos(a)*rad, bz=Math.sin(a)*rad;
      const H=0.21+rr()*0.18, w=0.05*(1+rr()*0.5), az=rr()*6.283, ca=Math.cos(az), sa=Math.sin(az), lean=0.05+rr()*0.16;
      for(let i=0;i<=segs;i++){ const t=i/segs, y=t*H, ww=w*(1-t*0.85), bzz=t*t*lean;
        for(const s of [-1,1]){ const lx=s*ww; pos.push(bx+lx*ca-bzz*sa, y, bz+lx*sa+bzz*ca); aH.push(t); } }
      for(let i=0;i<segs;i++){ const k=vb+i*2; idx.push(k,k+1,k+2, k+1,k+3,k+2); } vb+=(segs+1)*2; }
    const posAttr=new THREE.Float32BufferAttribute(pos,3), aHAttr=new THREE.Float32BufferAttribute(aH,1), idxAttr=new THREE.Uint16BufferAttribute(idx,1);
    grassMat=new THREE.ShaderMaterial({ side:THREE.DoubleSide, uniforms:{uTime:{value:0}, uCamPos:{value:new THREE.Vector3()}, uLight:{value:1}},
      vertexShader:`uniform float uTime; uniform vec3 uCamPos; attribute vec3 iOffset; attribute float iAngle; attribute float iScale; attribute float iTint; attribute float aH; varying float vH; varying float vT;
        void main(){ vH=aH; vT=iTint; float s=sin(iAngle),c=cos(iAngle); vec3 q=position*iScale; q=vec3(q.x*c-q.z*s,q.y,q.x*s+q.z*c);
          vec4 wb=modelMatrix*vec4(iOffset,1.0); float camd=distance(uCamPos.xz, wb.xz);
          float hs=mix(0.4,1.0,smoothstep(2.0,8.0,camd));
          q.y*=hs;
          float w=sin(uTime*1.3+iOffset.x*0.4+iOffset.z*0.5)+0.4*sin(uTime*2.3+iOffset.x*0.8); float bend=w*0.12*aH*aH*hs; q.x+=bend*c; q.z+=bend*s+bend*0.3;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(q+iOffset,1.0); }`,
      fragmentShader:`varying float vH; varying float vT; uniform float uLight;
        // 🌿 2026-07-24 형광 라임→SoT 올리브(소스 수정, 전역 후처리 대신). 리서치 ★3(잔디 네온 방지).
        //   구 tip(0.48,0.64,0.28)=G 압도적 형광 라임 → R 올리고 G 낮춰 올리브(SoT 잔디 #517023 톤). 채도↓.
        void main(){ vec3 base=vec3(0.25,0.33,0.14), tip=vec3(0.42,0.50,0.20); vec3 col=mix(base,tip,vH); col*=0.95+vT*0.1; col*=0.82+0.18*vH;
          col*=uLight;                                    // ☀️ 낮/밤·폭풍 감광(씬 sun/hemi 실측값 주입)
          gl_FragColor=vec4(col,1.0); }` });
    const STEP=2.7;
    const CHUNK=30, buckets=new Map();
    for(let x=minX;x<maxX;x+=STEP) for(let z=minZ;z<maxZ;z+=STEP){
      const jx=x+(Math.random()-0.5)*STEP, jz=z+(Math.random()-0.5)*STEP;
      const i=Math.min(GW-1,Math.max(0,(jx-minX)/cx|0)), j=Math.min(GW-1,Math.max(0,(jz-minZ)/cz|0));
      if(!gok[i*GW+j]) continue;
      const ng=Math.sin(jx*0.055)*Math.sin(jz*0.05) + Math.sin(jx*0.12+jz*0.08)*0.6;
      if(ng < -0.78) continue;
      const ck=Math.floor(jx/CHUNK), cl=Math.floor(jz/CHUNK), key=ck+','+cl;
      let bk=buckets.get(key); if(!bk){ bk={ ccx:(ck+0.5)*CHUNK, ccz:(cl+0.5)*CHUNK, off:[],ang:[],scl:[],tnt:[] }; buckets.set(key,bk); }
      bk.off.push(jx-bk.ccx, gyA[i*GW+j], jz-bk.ccz); bk.ang.push(rr()*6.283); bk.scl.push(0.85+rr()*0.5); bk.tnt.push(rr()); }
    let total=0;
    for(const bk of buckets.values()){ const n=bk.ang.length; if(!n)continue; total+=n;
      const g=new THREE.InstancedBufferGeometry(); g.setAttribute('position',posAttr); g.setAttribute('aH',aHAttr); g.setIndex(idxAttr);
      g.setAttribute('iOffset',new THREE.InstancedBufferAttribute(new Float32Array(bk.off),3));
      g.setAttribute('iAngle',new THREE.InstancedBufferAttribute(new Float32Array(bk.ang),1));
      g.setAttribute('iScale',new THREE.InstancedBufferAttribute(new Float32Array(bk.scl),1));
      g.setAttribute('iTint',new THREE.InstancedBufferAttribute(new Float32Array(bk.tnt),1));
      g.instanceCount=n; g.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,0.4,0), CHUNK*0.75+RAD+0.8);
      const mesh=new THREE.Mesh(g,grassMat); mesh.position.set(bk.ccx,0,bk.ccz); mesh.frustumCulled=true; scene.add(mesh); grassChunks.push(mesh); }
    console.log('[grass] 패치', total, '× 풀잎', BL, '=', total*BL, '/ 청크', grassChunks.length);
  })();

  // ── 🪨 배경 돌 배치 ──
  (function placeRocks(){
    const per=ROCKS.map(()=>[]); const _e=new THREE.Euler(),_q2=new THREE.Quaternion(); const R=ISLE_R*1.05; let placed=0,tries=0;
    while(placed<CFG.rock && tries<CFG.rock*22){ tries++;
      const a=rnd()*6.283, rr=Math.sqrt(rnd())*R, x=SPAWN.x+Math.cos(a)*rr, z=SPAWN.z+Math.sin(a)*rr;
      const h=groundAt(x,z,groundMeshes); if(!h || h.point.y<WATER_Y+0.3) continue;
      let nm=false; for(const m of mountains){ const dx=x-m.x,dz=z-m.z; if(dx*dx+dz*dz<(m.r*1.6)*(m.r*1.6)){nm=true;break;} } if(nm) continue;
      const ng=Math.sin(x*0.055)*Math.sin(z*0.05)+Math.sin(x*0.12+z*0.08)*0.6;
      const grassy = isGreen(h) && ng>=-0.78; if(grassy && rnd()<0.88) continue;
      const k=(rnd()*ROCKS.length)|0; if(!ROCKS[k]) continue;
      const s=0.7+Math.pow(rnd(),1.6)*3.3;
      _e.set(0,rnd()*6.283,0); _q2.setFromEuler(_e);
      per[k].push(new THREE.Matrix4().compose(new THREE.Vector3(x,h.point.y-0.15,z),_q2,new THREE.Vector3(s,s,s)));
      SOLIDS.push({x,z,r:Math.max(0.5,s*0.8)});
      placed++; }
    for(let k=0;k<ROCKS.length;k++){ const arr=per[k]; if(!arr.length)continue;
      const im=new THREE.InstancedMesh(ROCKS[k].geo, ROCKS[k].mat, arr.length); arr.forEach((m,i)=>im.setMatrixAt(i,m));
      im.instanceMatrix.needsUpdate=true; im.castShadow=true; im.receiveShadow=true; scene.add(im); }
    console.log('[rocks] placed', placed);
  })();

  // ── ⛏️ 광물(광석) 9종 — 산 근처에만 배치 ──
  await (async function buildOres(){
    const O='/obj/', U='/unity/Polytope Studio/Lowpoly_Environments/Sources/Meshes/Rocks/';
    const GEO_SRC={ ruda:{type:'objmtl',dir:O+'minerals/source/_unr/',obj:'Ruda_final.obj',mtl:'Ruda_final.mtl'},
      crystal:{type:'obj',dir:O+'stylized-crystals/source/',obj:'ChristalUV.obj'},
      limonite:{type:'objmtl',dir:O+'limonite/source/_unz/',obj:'model.obj',mtl:'model.mtl'},
      desert:{type:'obj',dir:O+'low-poly-desert-rock/source/',obj:'Rocky_The_LowPoly_Rock.obj'},
      orerock:{type:'fbx',url:U+'PT_Ore_Rock_01.fbx'} };
    const ORES=[
      {name:'돌',    w:10, src:'desert',lp:{color:0x9a9286,metalness:0,roughness:0.95,env:0.3}},
      {name:'석탄',  w:8,  src:'orerock',lp:{color:0x202227,metalness:0.05,roughness:0.7,env:0.25}},
      {name:'철광석',w:7,  src:'ruda',lp:{color:0x6b7686,shiny:true,metalness:0.72,roughness:0.42,clearcoat:0.4,emissive:0x202a36,emissiveIntensity:0.08}},
      {name:'구리',  w:5,  src:'ruda',lp:{color:0xc16a38,shiny:true,metalness:0.85,roughness:0.34,clearcoat:0.5,emissive:0x3a1c0c,emissiveIntensity:0.08}},
      {name:'주석',  w:4,  src:'limonite',lp:{color:0x9ba2aa,metalness:0.55,roughness:0.5,env:0.4}},
      {name:'은',    w:2.5,src:'ruda',lp:{color:0xd6dade,shiny:true,metalness:0.95,roughness:0.2,clearcoat:0.6}},
      {name:'코발트',w:1.5,src:'crystal',lp:{color:0x2f55d4,shiny:true,metalness:0.6,roughness:0.28,clearcoat:0.9,emissive:0x162f8c,emissiveIntensity:0.18}},
      {name:'금',    w:1,  src:'ruda',lp:{color:0xe6b73a,shiny:true,metalness:0.95,roughness:0.22,clearcoat:0.6,emissive:0x4a3408,emissiveIntensity:0.12}},
      {name:'보석',  w:0.6,src:'crystal',lp:{color:0xd83a5e,shiny:true,metalness:0.15,roughness:0.1,clearcoat:1,emissive:0x7a1830,emissiveIntensity:0.2}},
    ];
    const RARITY={
      common:{돌:20,석탄:8,철광석:6,구리:3,주석:2,은:0,코발트:0,금:0,보석:0},
      normal:{돌:24,석탄:8,철광석:7,구리:5,주석:4,은:2.5,코발트:1.5,금:1,보석:0.6},   // ★초반 섬 '돌' 비중 대폭↑(10→24) — stone은 '돌' 광석에서만 나와 튜토리얼서 부족하던 것 해소(사령관). 돌≈45%.
      rich:  {돌:5, 석탄:5,철광석:6,구리:6,주석:5,은:5,  코발트:4,  금:3,보석:2.5},
      veins: {돌:2, 석탄:6,철광석:9,구리:7,주석:4,은:6,  코발트:5,  금:4,보석:3},
    };
    const WT=ORES.map(o=>RARITY[CFG.oreW][o.name]||0), _wsum=WT.reduce((s,w)=>s+w,0);
    function pickOre(){ let t=rnd()*_wsum; for(let i=0;i<ORES.length;i++){ if((t-=WT[i])<=0) return ORES[i]; } return ORES[0]; }
    function matFromLp(lp){ const col=new THREE.Color(lp.color??0x8a8378); let mat;
      if(lp.shiny) mat=new THREE.MeshPhysicalMaterial({color:col,flatShading:true,metalness:lp.metalness??0.8,roughness:lp.roughness??0.22,clearcoat:lp.clearcoat??1,clearcoatRoughness:0.15});
      else mat=new THREE.MeshStandardMaterial({color:col,flatShading:true,roughness:lp.roughness??0.9,metalness:lp.metalness??0.05});
      if(lp.emissive!=null){ mat.emissive=new THREE.Color(lp.emissive); mat.emissiveIntensity=lp.emissiveIntensity??0.1; } mat.side=THREE.DoubleSide; return mat; }
    function ensureAttrs(g){ if(g.index) g=g.toNonIndexed(); for(const k of Object.keys(g.attributes)){ if(k!=='position'&&k!=='normal') g.deleteAttribute(k); } if(!g.getAttribute('normal')) g.computeVertexNormals(); return g; }
    function toSingleGeo(o,target){ o.updateMatrixWorld(true); const gs=[]; o.traverse(m=>{ if(m.isMesh){ let g=m.geometry.clone(); g.applyMatrix4(m.matrixWorld); gs.push(ensureAttrs(g)); } });
      let geo=gs.length>1?mergeGeometries(gs,false):gs[0]; geo.computeBoundingBox(); const sz=geo.boundingBox.getSize(new THREE.Vector3()),c=geo.boundingBox.getCenter(new THREE.Vector3());
      const s=target/Math.max(sz.x,sz.y,sz.z); geo.translate(-c.x,-c.y,-c.z); geo.scale(s,s,s); geo.computeVertexNormals(); geo.computeBoundingBox(); geo.translate(0,-geo.boundingBox.min.y,0); return geo; }
    async function loadRaw(it){ if(it.type==='objmtl'){ const mtl=await new MTLLoader().setPath(it.dir).loadAsync(it.mtl); mtl.preload(); return await new OBJLoader().setMaterials(mtl).setPath(it.dir).loadAsync(it.obj); }
      if(it.type==='obj') return await new OBJLoader().setPath(it.dir).loadAsync(it.obj);
      return await new FBXLoader().loadAsync(encodeURI(it.url)); }
    const cache={};
    for(const k in GEO_SRC){ try{ cache[k]=toSingleGeo(await loadRaw(GEO_SRC[k]),3.0); }catch(e){ console.warn('[ore] geo fail',k,e&&e.message); } }
    const HEAVY=5000, light=cache.orerock;
    if(light) for(const k in cache){ if(cache[k] && cache[k].getAttribute('position').count/3>HEAVY && k!=='orerock') cache[k]=light.clone(); }
    for(const ore of ORES){ ore.geo=cache[ore.src]?cache[ore.src].clone():null; ore.mat=matFromLp(ore.lp); }
    let n=0; const cnt={};
    function placeOre(x,z){ const h=groundAt(x,z,groundMeshes); if(!h || h.point.y<WATER_Y+0.3) return false;
      const ore=pickOre(); if(!ore.geo) return false; cnt[ore.name]=(cnt[ore.name]||0)+1;
      const s=0.7+rnd()*0.7, mesh=new THREE.Mesh(ore.geo, ore.mat.clone());
      mesh.scale.setScalar(s); mesh.position.set(x,h.point.y-0.1,z); mesh.rotation.y=rnd()*6.283; mesh.castShadow=mesh.receiveShadow=true; scene.add(mesh);
      mesh.userData.ore=ore.name; SOLIDS.push({x,z,r:Math.max(0.7,s*1.2)}); ORE_NODES.push(mesh); n++; return true; }
    for(const m of mountains){ const RING=CFG.oreRing;
      for(let i=0;i<RING;i++){ const a=(i/RING)*6.283 + rnd()*0.35, rr=m.r*(0.85+rnd()*0.55); placeOre(m.x+Math.cos(a)*rr, m.z+Math.sin(a)*rr); } }
    for(let i=0,tries=0; i<CFG.oreExtra && tries<CFG.oreExtra*18; tries++){
      const a=rnd()*6.283, rr=Math.sqrt(rnd())*ISLE_R*0.85; if(placeOre(SPAWN.x+Math.cos(a)*rr, SPAWN.z+Math.sin(a)*rr)) i++; }
    console.log('[ore]',TIER,'placed',n,'/ mtn',mountains.length,JSON.stringify(cnt));
  })();

  // ── 매 프레임: 잔디 바람 + 거리 컬링 ──
  ctx.onUpdate(()=>{
    if(grassMat){ const cam=ctx.camera; grassMat.uniforms.uTime.value=performance.now()*0.001; grassMat.uniforms.uCamPos.value.copy(cam.position);
      // ☀️ 낮/밤·폭풍 밝기 — 커스텀 셰이더라 씬 조명 자동수신 X. sun/hemi 실측 광량으로 수동 감광(wind.js가 밤+폭풍 반영해 매프레임 갱신 → 둘 다 자동 연동).
      if(ctx.sky){ const sun=ctx.sun?ctx.sun.intensity:1.55, hemi=ctx.hemi?ctx.hemi.intensity:1.15;
        grassMat.uniforms.uLight.value = THREE.MathUtils.clamp((hemi*0.6+sun*0.5)/1.65, 0.22, 1.12); }
      const cp=cam.position, md=GRASS_MAXD*GRASS_MAXD; for(const m of grassChunks){ const dx=m.position.x-cp.x, dz=m.position.z-cp.z; m.visible=(dx*dx+dz*dz)<md; } }
  });

  ctx.environment={ tier:TIER, trees:TREES.length, ores:ORE_NODES.length, rocks:CFG.rock, grassChunks:grassChunks.length,
    TREES, ORE_NODES, SOLIDS, mountains, isleMeshes, groundMeshes, groundAt, isGreen, SPAWN, ISLE_R, sweepBuried };
  console.log(`[env] ${ISLE_NAME||'(이름없음)'} [${TIER}] · 나무 ${TREES.length} · 광석 ${ORE_NODES.length} · 잔디청크 ${grassChunks.length} · 산 ${mountains.length}`);
  return ctx.environment;
}
