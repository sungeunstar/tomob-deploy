// terrain.js — 맵에디터에서 만든 섬(세션) 로드 + Rapier trimesh 충돌체 + 텍스처 폴백.
// 에디터 저장형식: localStorage.voyageSessions[name]={grid,name,objs:[{url,x,y,z,rotY,scale}]}, voyageMapV2=마지막.
// 출처: voyage/walk.html getModule/loadMap 재작성 + Rapier trimesh.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
// ColladaLoader(.dae)는 지연 import — CDN 503 등으로 이 로더가 실패해도 게임 전체 로딩이 끊기지 않게.

const LOWPOLY_TERRAIN=new Set(['Islands','Terrain','Mountains','River','Water','Ice','Clouds']);
const TARGET={ Trees:8, Props:1.6, Minerals:2.6 };

export async function initTerrain(ctx, { session=null, offset=null, targetSpan=null }={}){
  // ★홈섬 캐논 배치 오프셋(2026-07-10) — worldstream(캐논×WORLD_SCALE 글로벌 좌표계)에 맞춰 로컬 지형 전체를
  //   해당 isSpawn 섬의 캐논 위치로 밀어 넣는다. 없으면(샌드박스·구모드) 원점 그대로(기존 동작 100% 보존).
  const off = offset || { x:0, z:0 };
  const { THREE, scene, RAPIER, world } = ctx;
  // ★이전 지형 정리 — 이중로드(?sys=terrain + 하드코딩)·맵전환 시 "섬 위에 섬" 겹침 방지.
  if(ctx.terrain && Array.isArray(ctx.terrain._allObjs)){
    for(const grp of ctx.terrain._allObjs){
      const bs=(grp.userData&&grp.userData._bodies)||[]; for(const b of bs){ try{ world.removeRigidBody(b); }catch(e){} }
      try{ scene.remove(grp); }catch(e){}
      // ★2026-07-13 메모리 누수 수정(사령관 버그#2): 재초기화 시 scene.remove만 하고 dispose를 안 해 반복 호출마다
      //   GPU 지오메트리/재질 버퍼가 누적됐다. getModule의 cache는 initTerrain 호출마다 새로 만들어지므로(지역 변수)
      //   이전 지형 오브젝트 전체를 한꺼번에 버리는 이 경로에선 조건 없이 dispose해도 안전. (배열 재질도 처리)
      try{ grp.traverse(o=>{ if(o.isMesh){ o.geometry&&o.geometry.dispose&&o.geometry.dispose();
        if(o.material){ if(Array.isArray(o.material)) o.material.forEach(m=>m&&m.dispose&&m.dispose()); else o.material.dispose&&o.material.dispose(); } } }); }catch(e){}
    }
    console.log('[terrain] 이전 지형', ctx.terrain._allObjs.length, '개 정리(겹침 방지)');
  }
  const [t,a]=await Promise.all([
    fetch('/terrain-index.json').then(r=>r.json()).catch(()=>[]),
    fetch('/asset-index.json').then(r=>r.json()).catch(()=>[]),
  ]);
  const byUrl=new Map(); [...t,...a].forEach(m=>byUrl.set(m.url,m));

  const tl=new THREE.TextureLoader();
  const atlas=tl.load('/obj/lowpoly_terrain/Terrain_Assets/Textures/CPT_Terrain_Texture_Atlas_01.png');
  atlas.colorSpace=THREE.SRGBColorSpace; atlas.flipY=false;   // 텍스처 못 잡은 지형 폴백
  const fbx=new FBXLoader(); fbx.setResourcePath('/obj/lowpoly_terrain/Terrain_Assets/Textures/');
  const cache=new Map();
  function normalize(root,fmt,cat){ root.traverse(o=>{ if(o.isMesh){ const ms=Array.isArray(o.material)?o.material:[o.material];
    o.receiveShadow=true;   // 🌑 Phase 1: 세션/홈섬 지형이 나무·캐릭터 그림자를 받게(구름은 아래에서 예외 아님 — 하늘이라 그림자 안 닿음)
    if(cat!=='Clouds') o.castShadow=true;   // 큰 지형(산·언덕)은 그림자도 던짐. 구름 제외.
    ms.forEach(m=>{ if(!m)return; m.side=THREE.DoubleSide; if(m.map)m.map.colorSpace=THREE.SRGBColorSpace; if(fmt==='obj'&&m.color)m.color.convertLinearToSRGB();
      // ★2026-07-13(사령관 ref/버그문제.png "멀리서 초록 구름") — 구름(Clouds)은 잔디/땅 아틀라스(초록 위주)를 못 쓴다.
      //   자기 텍스처 없는 지형류는 전부 이 아틀라스로 폴백했는데, 원래 무늬 없는 흰 구름 메시까지 걸려 잔디색을 뒤집어썼음.
      if(cat==='Clouds'&&!m.map){ if(m.color)m.color.set(0xffffff); m.needsUpdate=true; }
      else if((LOWPOLY_TERRAIN.has(cat)||!cat)&&!m.map){ m.map=atlas; if(m.color)m.color.set(0xffffff); m.needsUpdate=true; } }); } }); }
  function getModule(url){ return new Promise((res,rej)=>{ if(cache.has(url)){ res(cache.get(url).clone()); return; }
    const it=byUrl.get(url), fmt=it?it.fmt:'fbx', cat=it?it.category:''; const enc=encodeURI(url);
    const done=obj=>{ const root=obj.scene||obj; normalize(root,fmt,cat);
      // ★동굴입구 에셋: 회색 강제 + 25m 정규화(에디터와 동일). 0.01배면 0.3m로 쪼그라듦.
      const isEnt=/rock-mountain-with-cave/i.test(url);
      if(isEnt){ root.traverse(o=>{ if(o.isMesh){ o.material=new THREE.MeshStandardMaterial({color:0x8a8478, roughness:0.95, flatShading:true, side:THREE.DoubleSide}); } });
        const b=new THREE.Box3().setFromObject(root),s=new THREE.Vector3(); b.getSize(s); root.scale.multiplyScalar(25/(s.y||1)); }
      else if(LOWPOLY_TERRAIN.has(cat)||!cat){ root.scale.setScalar(0.01); }
      else { const b=new THREE.Box3().setFromObject(root),s=new THREE.Vector3(); b.getSize(s); const h=s.y||Math.max(s.x,s.z)||1; root.scale.setScalar((TARGET[cat]||3)/h); }
      const w=new THREE.Group(); w.add(root); cache.set(url,w); res(w.clone()); };
    if(fmt==='obj'){ const mu=enc.replace(/\.obj$/i,'.mtl'); new MTLLoader().load(mu,mats=>{ mats.preload(); new OBJLoader().setMaterials(mats).load(enc,done,undefined,()=>new OBJLoader().load(enc,done,undefined,rej)); },undefined,()=>new OBJLoader().load(enc,done,undefined,rej)); }
    else if(fmt==='dae'){ import('three/addons/loaders/ColladaLoader.js').then(({ColladaLoader})=>new ColladaLoader().load(enc,d=>done(d),undefined,rej)).catch(rej); }
    else fbx.load(enc,done,undefined,rej); }); }

  // 세션 결정: 인자 > 세션선택(여러개) > 세션1개 > voyageMapV2
  function pickSession(ss,ks){ return new Promise(res=>{
    const ov=document.createElement('div'); ov.style.cssText='position:fixed;inset:0;z-index:50;background:#0a1622;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font:15px system-ui,"Malgun Gothic";overflow:auto;padding:30px';
    const h=document.createElement('div'); h.textContent='섬 선택 ('+ks.length+'개)'; h.style.cssText='font-size:19px;color:#ffe07a;margin-bottom:12px'; ov.appendChild(h);
    ks.forEach(k=>{ const cnt=(ss[k].objs&&ss[k].objs.length)||0; const b=document.createElement('button');
      b.textContent=`${k}  ·  ${cnt}개 오브젝트`; b.style.cssText='padding:11px 26px;font-size:15px;border-radius:8px;border:1px solid #2a3a50;background:#1a2638;color:#cfe;cursor:pointer;min-width:280px';
      b.onmouseenter=()=>b.style.background='#2e6b46'; b.onmouseleave=()=>b.style.background='#1a2638';
      b.onclick=()=>{ ov.remove(); res(ss[k]); }; ov.appendChild(b); });
    document.body.appendChild(ov);
  }); }
  let data=session;
  if(!data){ let ss={}; try{ ss=JSON.parse(localStorage.getItem('voyageSessions')||'{}'); }catch(e){}
    const ks=Object.keys(ss);
    if(ks.length>=2){ data=await pickSession(ss,ks); }      // 여러 섬 → 사령관이 선택
    else if(ks.length===1){ data=ss[ks[0]]; }
    else { const s=localStorage.getItem('voyageMapV2'); if(s) try{ data=JSON.parse(s); }catch(e){} }
  }
  if(!data || !Array.isArray(data.objs) || !data.objs.length){
    console.warn('[terrain] 섬 데이터 없음'); ctx.terrain={ collide:[], spawn:{x:0,y:30,z:0}, groundAt:()=>0 }; return ctx.terrain;
  }
  // ★2026-07-10(사령관 실측: 미니맵은 섬 위에 있는데 M맵은 바다 한가운데) — 프리팹 원본 좌표는 세션 저장 당시
  //   에디터 캔버스 아무 데나 놓였던 raw 좌표라, 그 프리팹 "중심"이 (0,0)이 아닐 수 있다. worldstream.js는 이미
  //   prefabCenter()로 이 중심을 빼고 배치하는데 terrain.js(홈섬 로컬 로드)만 안 그래서, 실제 렌더된 지형이
  //   캐논 그리드상 "정식 위치"(off)에서 프리팹 중심만큼(수백 유닛) 어긋나 있었음 — M맵 섬 아이콘은 off 기준으로
  //   찍히는데 실제 지형은 그보다 떨어진 곳에 서 있었던 것. worldstream과 동일하게 프리팹 중심을 빼서 정렬.
  //   ★offset이 없는(레거시/샌드박스) 경로는 pc=0 고정 — 원점 배치 기존 동작 그대로, 구캐릭터 좌표 안 건드림.
  let pc = { x:0, z:0 };
  if(offset){
    let _pcx=0,_pcz=0,_pcn=0;
    for(const o of data.objs){ if(/\/Clouds\//i.test(o.url)) continue; _pcx+=o.x; _pcz+=o.z; _pcn++; }
    pc = { x: _pcn?_pcx/_pcn:0, z: _pcn?_pcz/_pcn:0 };
  }

  const isTerr=o=>{ const it=byUrl.get(o.url); return it && LOWPOLY_TERRAIN.has(it.category); };
  const collide=[], allObjs=[]; let bigArea=0,bigX=0,bigZ=0,n=0,fail=0;   // allObjs = 정리용(지형+데코 전부)

  // ── ⚡ BVH 가속 raycast(three-mesh-bvh) — groundAt이 collide 전체를 '삼각형 전수검사'로 훑던 게
  //    항구 고스트(seaDir 버스트)·건설·전투·보행 등 모든 groundAt 호출의 렉 원인. O(log n) 가속.
  //    스트리밍 섬·항구·대장간·포대 등 collide에 나중에 push되는 메시도 push 래핑으로 자동 가속
  //    (모듈 6곳을 안 고치고 한 곳에서 전부 커버). import 실패 시 기존 raycast 그대로(안전).
  let _bvh=null; const _bvhSeen=new WeakSet();
  function bvhize(target){
    if(!_bvh || !target) return;
    const walk=o=>{ if(o&&o.traverse) o.traverse(m=>{ if(m.isMesh&&m.geometry&&m.geometry.attributes.position
      && !m.geometry.boundsTree && !m.geometry.morphAttributes?.position && !_bvhSeen.has(m.geometry)){
      _bvhSeen.add(m.geometry);
      if(m.geometry.attributes.position.count>=96){ try{ m.geometry.computeBoundsTree(); }catch(_){} } } }); };
    (Array.isArray(target)?target:[target]).forEach(walk);
  }
  import('three-mesh-bvh').then(m=>{
    if(!THREE.BufferGeometry.prototype.computeBoundsTree){
      THREE.BufferGeometry.prototype.computeBoundsTree=m.computeBoundsTree;
      THREE.BufferGeometry.prototype.disposeBoundsTree=m.disposeBoundsTree;
      THREE.Mesh.prototype.raycast=m.acceleratedRaycast;   // boundsTree 있는 메시만 가속, 없으면 기본(안전)
    }
    _bvh=m; bvhize(collide);   // 로드 시점까지 쌓인 지형 일괄 가속
    console.log('[terrain] ⚡BVH 가속 raycast — groundAt/보행/조준 전역');
  }).catch(e=>console.warn('[terrain] BVH 미적용(기본 raycast):', e&&e.message));
  { const _push=collide.push.bind(collide);
    collide.push=(...items)=>{ const r=_push(...items); try{ bvhize(items); }catch(_){} return r; }; }

  // ⚡ 스트림-인 분산(최적화 ③)용 메시 단위 헬퍼 — worldstream이 섬 로드 히칫 방지를 위해 프레임당 1메시씩 호출.
  function addTrimeshMesh(o, grp){
    if(!(o.isMesh&&o.geometry&&o.geometry.attributes.position)) return;
    grp.userData._bodies=grp.userData._bodies||[];
    const g=o.geometry, pos=g.attributes.position, mw=o.matrixWorld, tmp=new THREE.Vector3(), v=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++){ tmp.fromBufferAttribute(pos,i).applyMatrix4(mw); v[i*3]=tmp.x; v[i*3+1]=tmp.y; v[i*3+2]=tmp.z; }
    let idx; if(g.index) idx=new Uint32Array(g.index.array); else { idx=new Uint32Array(pos.count); for(let i=0;i<pos.count;i++) idx[i]=i; }
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    try{ world.createCollider(RAPIER.ColliderDesc.trimesh(v,idx), b); grp.userData._bodies.push(b); }catch(e){ console.warn('[terrain] trimesh fail',e&&e.message); }
  }
  function addTrimesh(grp){ grp.updateWorldMatrix(true,true); grp.userData._bodies=grp.userData._bodies||[];
    grp.traverse(o=>addTrimeshMesh(o, grp)); }
  // 충돌체 재생성용(동굴 카빙 등) — 그룹의 기존 트라이메시 바디 제거 후 새 메시로 재생성
  function removeTrimesh(grp){ const bs=grp.userData._bodies||[]; for(const b of bs){ try{ world.removeRigidBody(b); }catch(e){} } grp.userData._bodies=[]; }

  for(const o of data.objs.filter(isTerr)){
    try{ const grp=await getModule(o.url); grp.position.set(o.x-pc.x+off.x,o.y||0,o.z-pc.z+off.z); grp.rotation.y=o.rotY||0; grp.scale.multiplyScalar(o.scale||1);
      scene.add(grp); collide.push(grp); allObjs.push(grp); addTrimesh(grp);
      const b=new THREE.Box3().setFromObject(grp), s=new THREE.Vector3(); b.getSize(s); const area=s.x*s.z;
      if(area>bigArea){ bigArea=area; bigX=o.x-pc.x+off.x; bigZ=o.z-pc.z+off.z; } n++; }catch(e){ fail++; console.warn('[terrain] fail',o.url,e&&e.message); }
  }
  // 홈섬도 스트리밍 섬과 동일하게 canon 반경을 실제 합성 바운딩 크기의 SSOT로 사용한다.
  // 프리팹마다 내부 좌표폭이 275~3150m로 제각각이어도 게임 월드에서는 tier 크기가 일관된다.
  let _fitK=1, _fitCX=off.x, _fitCZ=off.z;
  if(targetSpan>0 && collide.length){
    try{
      const fb=new THREE.Box3(); for(const g of collide) fb.expandByObject(g);
      const fs=fb.getSize(new THREE.Vector3()), fc=fb.getCenter(new THREE.Vector3());
      const span=Math.max(fs.x,fs.z);
      if(isFinite(span)&&span>0){
        _fitK=targetSpan/span; _fitCX=fc.x; _fitCZ=fc.z;
        // ★BUG-A1 수정(2026-08-07, 사령관 "산이 공중에 떠있음"). 결함: x·z는 fit 중심 기준으로 재정렬하면서
        //   **y는 손대지 않았다.** 그런데 scale.multiplyScalar는 y도 곱한다 → 지형 조각은 세로로 줄어드는데
        //   조각의 원점 높이는 그대로라, 높은 곳에 얹힌 산 조각이 낮아진 지면 위 허공에 남았다.
        //   → x·z와 **같은 규칙**으로 y도 재정렬한다. 기준면은 합성 바운딩의 바닥(fb.min.y) — 지면 높이를 보존하고
        //     수직 적층(산 높이)이 수평 축소와 같은 비율로 따라온다.
        //   ⛔[[voyage-terrain-procgen-distrust]] — 새 스케일 정책을 지어내는 게 아니라, 빠져 있던 y축을 채우는 수정.
        //     스케일은 여전히 균일(비균일 스케일·bottomAlign 재도입 아님).
        // 🔬 실측 훅(부양/침수 원인 규명용) — 콘솔 window.__fitDbg 로 조회. 추측 튜닝 금지 원칙.
        try{ window.__fitDbg={ targetSpan, span, fitK:_fitK, bboxMinY:fb.min.y, bboxMaxY:fb.max.y, cx:fc.x, cz:fc.z, n:collide.length,
          before:collide.slice(0,40).map(g=>({ y:+g.position.y.toFixed(2), sy:+g.scale.y.toFixed(4) })) }; }catch(_){}
        for(const g of collide){
          removeTrimesh(g);
          g.position.x=off.x+(g.position.x-_fitCX)*_fitK;
          g.position.z=off.z+(g.position.z-_fitCZ)*_fitK;
          // ★BUG-A1 수정(2026-08-07) — **실측으로 기준면 확정**. 콘솔 실측값(카브 홈섬, fitK=0.456):
          //    지형 꼭대기 world y=10.45인데 산 바닥이 13.24/14.07 → 약 2.8m 부양.
          //    원본(축소 전)에선 산이 지형에 9m 파묻혀 있었는데, 조각 **스케일만 줄고 y 위치는 그대로**라 떠버린 것.
          //    → x·z가 중심(_fitCX,_fitCZ) 기준인 것과 짝을 맞춰 y는 **해수면 y=0** 기준으로 같은 비율 축소한다.
          //      (앵커점 = (_fitCX, 0, _fitCZ). 세 축이 한 점 기준이라 균일 닮음변환 = 접촉 관계가 그대로 보존된다.)
          //    검산: 산 y 12.8×0.456=5.84 → 바닥이 지형 top 아래 4.2m에 안착. 원본 파묻힘 9m×0.456=4.1m과 일치.
          //    ⛔1차 시도에서 기준면을 fb.min.y(해수면보다 한참 아래)로 잡아 지면이 끌려 내려가 **바다가 섬을 덮었다**
          //      (사령관 "물이 넘쳐서 섬에 올라옴"). 같은 실수 반복 금지 — 기준면은 반드시 해수면.
          g.position.y = g.position.y * _fitK;
          g.scale.multiplyScalar(_fitK); g.updateWorldMatrix(true,true); addTrimesh(g);
        }
        bigX=off.x+(bigX-_fitCX)*_fitK; bigZ=off.z+(bigZ-_fitCZ)*_fitK;
      }
    }catch(e){ console.warn('[terrain] 홈섬 크기 정규화 실패',e&&e.message); }
  }
  const _fitXZ=(x,z)=>({x:off.x+(x-_fitCX)*_fitK,z:off.z+(z-_fitCZ)*_fitK});
  // 🌊 저지대 섬 침수 방지 리프트(worldstream.js와 동일 규칙) — 데코·스폰 레이캐스트 전에 적용해야 그 위에 얹힌다.
  //   자기-스케일: 이미 높은 섬(대부분의 시작섬)은 lift≈0, 소형섬3처럼 납작한 저지대 섬만 최대 5유닛 상승.
  try {
    const _sea=(ctx.water&&ctx.water.level!=null)?ctx.water.level:0;
    let _crest=0; if(ctx.water&&ctx.water.heightAt){ for(let i=0;i<80;i++){ const h=ctx.water.heightAt((i*131)%4000-2000,(i*197)%4000-2000)-_sea; if(h>_crest)_crest=h; } }
    _crest=_crest>0.5?_crest:3;
    const _bx=new THREE.Box3(); for(const g of collide) _bx.expandByObject(g);
    if(isFinite(_bx.max.y)&&isFinite(_bx.min.y)){
      const _c=_bx.getCenter(new THREE.Vector3()), _s=_bx.getSize(new THREE.Vector3());
      const _rc=new THREE.Raycaster(); _rc.far=(_bx.max.y-_bx.min.y)+200; const _dn=new THREE.Vector3(0,-1,0); const _N=13, _dry=[];
      for(let ix=0;ix<_N;ix++)for(let iz=0;iz<_N;iz++){ const x=_c.x+(ix/(_N-1)-0.5)*_s.x*0.96, z=_c.z+(iz/(_N-1)-0.5)*_s.z*0.96;
        _rc.set(new THREE.Vector3(x,_bx.max.y+50,z),_dn); const hh=_rc.intersectObjects(collide,true); if(hh.length&&hh[0].point.y>_sea) _dry.push(hh[0].point.y); }
      if(_dry.length>=4){ _dry.sort((a,b)=>a-b); const _shore=_dry[Math.floor((_dry.length-1)*0.15)];
        const _lf=Math.max(0, Math.min(5,(_sea+_crest+1)-_shore));
        if(_lf>0.05){ for(const g of collide){ g.position.y+=_lf; g.updateWorldMatrix(true,true); removeTrimesh(g); addTrimesh(g); } console.log('[terrain] 🌊 저지대 리프트 +'+_lf.toFixed(2)); }
      }
    }
  } catch(e){ console.warn('[terrain] 리프트 계산 실패', e&&e.message); }
  // 데코(나무/바위/소품) — 충돌 없이 표면 위
  for(const o of data.objs.filter(o=>!isTerr(o))){
    try{ const grp=await getModule(o.url), fp=_fitXZ(o.x-pc.x+off.x,o.z-pc.z+off.z); const r=new THREE.Raycaster(); r.set(new THREE.Vector3(fp.x,5000,fp.z),new THREE.Vector3(0,-1,0));
      const h=r.intersectObjects(collide,true); grp.position.set(fp.x,(h.length?h[0].point.y:(o.y||0)),fp.z); grp.rotation.y=o.rotY||0; grp.scale.multiplyScalar((o.scale||1)*_fitK); scene.add(grp); allObjs.push(grp); }catch(e){}
  }

  // 세션이 명시한 스폰을 우선한다. 테스트/수작업 섬은 가장 큰 메시 중심이 정상이나 산일 수 있어
  // 해안 진입점을 데이터로 고정해야 한다. 기존 세션은 spawn이 없으므로 종전 bigX/bigZ 동작을 그대로 유지한다.
  const _hasSpawn=data.spawn && Number.isFinite(data.spawn.x) && Number.isFinite(data.spawn.z);
  const _fsp=_hasSpawn ? _fitXZ(data.spawn.x-pc.x+off.x,data.spawn.z-pc.z+off.z) : {x:bigX,z:bigZ};
  const sx=_fsp.x, sz=_fsp.z;
  const r=new THREE.Raycaster(); r.set(new THREE.Vector3(sx,5000,sz),new THREE.Vector3(0,-1,0)); const h=r.intersectObjects(collide,true);
  const spawn={ x:sx, y:(h.length?h[0].point.y:40)+3, z:sz };
  // ★바닥 조회 = THREE 레이캐스트(collide). 물리 castRay 시도했으나(2026-07-03) 배 갑판(kinematic)을
  //   바닥으로 오인해 항해 붕괴 + 스트림 섬 지오메트리를 물리/THREE 둘 다 놓치는 사전문제 → 원복해 실게임 복구.
  //   ※토대·빌딩 큐보이드도 collide에 있으므로 THREE로 그대로 잡힘(물리 콜라이더는 보행용으로 별도 유지).
  const _dn=new THREE.Vector3(0,-1,0);
  // ⚡ 레이캐스터 재사용(호출마다 new 금지) + firstHitOnly(BVH 메시당 최근접 1히트만 — groundAt은 첫 히트만 씀).
  //   boundsTree 없는 메시는 firstHitOnly 무시하고 기존과 동일 동작 → 의미 불변, 속도만.
  const _gr=new THREE.Raycaster(); _gr.firstHitOnly=true;
  const _gro=new THREE.Vector3();
  function groundAt(x,z,fromY){
    _gro.set(x,fromY==null?5000:fromY,z); _gr.set(_gro, _dn);
    const hh=_gr.intersectObjects(collide,true);
    return hh.length ? hh[0].point.y : (ctx.seabed ? ctx.seabed.level : 0);   // ★섬/구조물 없으면 해저(seabed) 높이 — "0=애매" 제거
  }
  // ★ctx.terrain.offset = "raw 로컬 좌표에 실제로 적용된 총 이동량"(off - pc) — opening.js 카메라 보정 등 외부 소비자가
  //   이 값만 더하면 되게. off만 노출하면 pc(프리팹 중심 보정)를 빠뜨린 소비자가 다시 어긋난다(2026-07-10 카메라버그 원인).
  ctx.terrain={ collide, spawn, data, getModule, addTrimesh, addTrimeshMesh, removeTrimesh, _allObjs:allObjs, groundAt, bvhize,
    offset:{ x: off.x-pc.x, z: off.z-pc.z } };
  // 🏝️ R5-P1: 세션 섬(시작섬)도 아일랜드 레지스트리에 등록 — 스트림 섬과 동일 장부에서 조회 가능
  if(ctx.islands){ const rr=Math.max(60, Math.sqrt(bigArea||0)/2);
    ctx.islands.register({ id:'session:'+(data.name||'home'), name:data.name||'시작섬', x:bigX, z:bigZ, r:rr, kind:'session' }); }
  console.log(`[terrain] 지형 ${n}개(실패 ${fail}) · 스폰`, spawn);
  return ctx.terrain;
}
