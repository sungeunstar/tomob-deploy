// mine.js — 샌드박스 광물 채광(1인칭 곡괭이). ?sys=mine (인벤 연계: ?sys=inventory,mine)
//   FP는 player.js. 여기선 섬에 광맥 배치 + 곡괭이 viewmodel(카메라 자식) + 클릭 carve(CSG, 이카루스식 조금씩 파임)
//   → CARVE_MAX 누적 시 조각남(split 공통 그루터기 + 광물색 파편 폭발) + ctx.inventory 적재.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

export async function initMine(ctx, opts={}){
  // external=true → 자체 광석 스캐터 대신 ctx.environment.ORE_NODES(본편 광석) 위치에 Brush 광맥을 세우고 원본 메시 교체.
  //   (mine은 CSG Brush로 광석을 다루는데 environment 광석은 일반 메시 → 위치·광물종류만 재활용해 교체.)
  const EXTERNAL = !!opts.external;
  const { scene, camera, terrain, world, RAPIER, renderer } = ctx;
  const groundY=(x,z)=> (terrain&&terrain.groundAt)?terrain.groundAt(x,z):0;
  const CARVE_MAX=8, CARVE_R=0.2;   // 구멍 반경(작게 — 너무 큰 동그라미 방지)

  // 광물 머티리얼 전용 환경맵(scene.environment는 안 건드림 — 게임 다른 오브젝트 영향 방지)
  let envTex=null; try{ const pm=new THREE.PMREMGenerator(renderer); envTex=pm.fromScene(new RoomEnvironment(),0.04).texture; }catch(e){ console.warn('[mine] env skip', e&&e.message); }

  // 로우폴리 머티리얼 팩토리 — shiny=반사 반짝(철광석·크리스탈), 아니면 무광
  function matFromLp(lp){ lp=lp||{}; const col=new THREE.Color(lp.color??0x8a8378); let mat;
    if(lp.shiny){ mat=new THREE.MeshPhysicalMaterial({color:col,flatShading:true,metalness:lp.metalness??0.8,roughness:lp.roughness??0.22,clearcoat:lp.clearcoat??1,clearcoatRoughness:lp.clearcoatRoughness??0.15,envMapIntensity:lp.env??1.6}); }
    else { mat=new THREE.MeshStandardMaterial({color:col,flatShading:true,roughness:lp.roughness??0.9,metalness:lp.metalness??0.05,envMapIntensity:lp.env??0.7}); }
    if(lp.emissive!=null){ mat.emissive=new THREE.Color(lp.emissive); mat.emissiveIntensity=lp.emissiveIntensity??0.1; }
    if(envTex) mat.envMap=envTex; mat.side=THREE.DoubleSide; return mat; }
  function ensureAttrs(g){ if(g.index) g=g.toNonIndexed(); for(const k of Object.keys(g.attributes)){ if(k!=='position'&&k!=='normal'&&k!=='uv') g.deleteAttribute(k); }
    if(!g.getAttribute('normal')) g.computeVertexNormals(); if(!g.getAttribute('uv')){ const n=g.getAttribute('position').count; g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2)); } return g; }
  function toSingleGeo(o,target){ o.updateMatrixWorld(true); const geos=[]; o.traverse(m=>{ if(m.isMesh){ let g=m.geometry.clone(); g.applyMatrix4(m.matrixWorld); geos.push(ensureAttrs(g)); } });
    let geo=geos.length>1?mergeGeometries(geos,false):geos[0]; geo.computeBoundingBox(); const sz=geo.boundingBox.getSize(new THREE.Vector3()),c=geo.boundingBox.getCenter(new THREE.Vector3());
    const s=target/Math.max(sz.x,sz.y,sz.z); geo.translate(-c.x,-c.y,-c.z); geo.scale(s,s,s); geo.computeVertexNormals(); geo.computeBoundingBox(); geo.translate(0,-geo.boundingBox.min.y,0); return geo; }

  // ── 광물 정의 (인벤 item: 철광석→iron, 나머지→stone) ──
  const O='/obj/', U='/unity/Polytope Studio/Lowpoly_Environments/Sources/Meshes/Rocks/';
  // ── geo 소스(메시) 6종 — 광물 9종이 공유. 사령관: "기존 거 텍스처 느낌·색만 변경" ──
  const GEO_SRC = {
    ruda:    { type:'objmtl', dir:O+'minerals/source/_unr/',       obj:'Ruda_final.obj', mtl:'Ruda_final.mtl' },  // 금속 결정질
    crystal: { type:'obj',    dir:O+'stylized-crystals/source/',    obj:'ChristalUV.obj' },                        // 보석 결정
    pyrite:  { type:'objmtl', dir:O+'pyrite/source/_unz/',          obj:'model.obj', mtl:'model.mtl' },            // 덩어리
    limonite:{ type:'objmtl', dir:O+'limonite/source/_unz/',        obj:'model.obj', mtl:'model.mtl' },            // 덩어리
    desert:  { type:'obj',    dir:O+'low-poly-desert-rock/source/', obj:'Rocky_The_LowPoly_Rock.obj' },           // 바위
    orerock: { type:'fbx',    url:U+'PT_Ore_Rock_01.fbx' },                                                        // 잡석(가벼움)
  };
  // ── 광물 9종 (2026-06-26 사령관 확정) — geoSrc=공유 메시 / lp=색·재질 / item=인벤 아이템 ──
  const ORES=[
    {key:'iron',   name:'철광석', item:'iron',   geoSrc:'ruda',     lp:{color:0x6b7686,shiny:true,metalness:0.72,roughness:0.42,clearcoat:0.4,emissive:0x202a36,emissiveIntensity:0.08}},
    {key:'copper', name:'구리',   item:'copper', geoSrc:'ruda',     lp:{color:0xc16a38,shiny:true,metalness:0.85,roughness:0.34,clearcoat:0.5,emissive:0x3a1c0c,emissiveIntensity:0.08}},
    {key:'tin',    name:'주석',   item:'tin',    geoSrc:'limonite', lp:{color:0x9ba2aa,metalness:0.55,roughness:0.5,env:0.4}},
    {key:'cobalt', name:'코발트', item:'cobalt', geoSrc:'crystal',  lp:{color:0x2f55d4,shiny:true,metalness:0.6,roughness:0.28,clearcoat:0.9,emissive:0x162f8c,emissiveIntensity:0.18}},
    {key:'gold',   name:'금',     item:'gold',   geoSrc:'ruda',     lp:{color:0xe6b73a,shiny:true,metalness:0.95,roughness:0.22,clearcoat:0.6,emissive:0x4a3408,emissiveIntensity:0.12}},
    {key:'silver', name:'은',     item:'silver', geoSrc:'ruda',     lp:{color:0xd6dade,shiny:true,metalness:0.95,roughness:0.2,clearcoat:0.6}},
    {key:'gem',    name:'보석',   item:'gem',    geoSrc:'crystal',  lp:{color:0xd83a5e,shiny:true,metalness:0.15,roughness:0.1,clearcoat:1,emissive:0x7a1830,emissiveIntensity:0.2}},
    {key:'stone',  name:'돌',     item:'stone',  geoSrc:'desert',   lp:{color:0x9a9286,metalness:0,roughness:0.95,env:0.3}},
    {key:'coal',   name:'석탄',   item:'coal',   geoSrc:'orerock',  lp:{color:0x202227,metalness:0.05,roughness:0.7,env:0.25}},
  ];
  const SPLIT_URL=U+'PT_Ore_Rock_01_split.fbx';
  async function loadRaw(it){ if(it.type==='objmtl'){ const mtl=await new MTLLoader().setPath(it.dir).loadAsync(it.mtl); mtl.preload(); return await new OBJLoader().setMaterials(mtl).setPath(it.dir).loadAsync(it.obj); }
    if(it.type==='obj') return await new OBJLoader().setPath(it.dir).loadAsync(it.obj);
    if(it.type==='fbx') return await new FBXLoader().loadAsync(encodeURI(it.url)); }
  // geo 소스 6종만 로드(캐시) → 광물 9종이 clone해 공유. 색·재질만 lp로 다르게.
  const _geoCache={};
  for(const k in GEO_SRC){ const o=await loadRaw(GEO_SRC[k]); _geoCache[k]=toSingleGeo(o,3.0);
    console.log('[mine] geoSrc', k, Math.round(_geoCache[k].getAttribute('position').count/3)+'tri'); }
  // ★고폴리(포토스캔) 소스는 프레임 드랍+CSG 지연 → 가벼운 공용 바위(orerock)로 교체
  const HEAVY=5000, lightGeo=_geoCache.orerock;
  if(lightGeo) for(const k in _geoCache){ const tri=_geoCache[k].getAttribute('position').count/3;
    if(tri>HEAVY && k!=='orerock'){ console.log('[mine] geoSrc '+k+' 고폴리('+Math.round(tri)+'tri)→공용바위'); _geoCache[k]=lightGeo.clone(); } }
  for(const ore of ORES){ ore.geo=_geoCache[ore.geoSrc].clone(); ore.mat=matFromLp(ore.lp);
    ore.tri=ore.geo.getAttribute('position').count/3; }
  const splitGeo=toSingleGeo(await new FBXLoader().loadAsync(encodeURI(SPLIT_URL)),3.0); const splitMat=matFromLp({color:0x4c5058,metalness:0.15,roughness:0.82,env:0.3});
  console.log('[mine] geo split', Math.round(splitGeo.getAttribute('position').count/3)+'tri');
  const ev=new Evaluator(); ev.useGroups=false; const carveSphereGeo=new THREE.SphereGeometry(0.5,16,12);
  // 균열(금) — 표면에 납작하게 붙는 데칼(canvas로 갈라진 금 그림). 칠 때마다 누적, 깨질 때 제거.
  const crackPlaneGeo=new THREE.PlaneGeometry(1,1);
  function makeCrackTex(){ const cv=document.createElement('canvas'); cv.width=cv.height=128; const x=cv.getContext('2d');
    x.clearRect(0,0,128,128); x.strokeStyle='rgba(12,12,14,0.92)'; x.lineCap='round';
    const cx=64,cy=64, arms=4+Math.floor(Math.random()*3);
    for(let i=0;i<arms;i++){ let px=cx,py=cy,a=Math.random()*6.28; x.lineWidth=1.4+Math.random()*1.6; x.beginPath(); x.moveTo(px,py);
      const seg=2+Math.floor(Math.random()*3); for(let s=0;s<seg;s++){ const len=12+Math.random()*22; a+=(Math.random()-0.5)*1.1; px+=Math.cos(a)*len; py+=Math.sin(a)*len; x.lineTo(px,py); } x.stroke(); }
    const t=new THREE.CanvasTexture(cv); t.needsUpdate=true; return t; }
  // ★균열 머티리얼 풀 — 매 채광마다 텍스처 생성/GPU업로드하던 것(첫 채광 히칭)을 로드 시점 5종 사전생성으로. 균열은 개별 페이드 없어(제거만) 공유 안전.
  const _crackMats=Array.from({length:5},()=>new THREE.MeshBasicMaterial({map:makeCrackTex(),transparent:true,depthWrite:false}));
  function addCrack(R, point, dir){ const m=new THREE.Mesh(crackPlaneGeo, _crackMats[(Math.random()*_crackMats.length)|0]);
    const sz=0.45+Math.random()*0.35; m.scale.set(sz,sz,1);
    m.position.copy(point).add(new THREE.Vector3((Math.random()-0.5)*0.18,(Math.random()-0.5)*0.18,(Math.random()-0.5)*0.18)).addScaledVector(dir,-0.03);
    m.lookAt(point.clone().addScaledVector(dir,-1)); m.rotateZ(Math.random()*6.28);   // 표면 밖(-dir) 향해 납작하게
    scene.add(m); R.cracks.push(m); }

  // ── 1인칭 손+곡괭이 viewmodel — 스윙 재설계(애니 원리: 준비→타격→복귀, pitch 호 중심) ──
  const DEG=Math.PI/180, SWING_PIVOT=new THREE.Vector3(0.34,-0.28,-0.5);
  // 무게감: 준비 묵직(길게)→타격 휙(짧게)→임팩트 멈칫(hold)→복귀 느리게.
  // tUp=올리기 끝, tStrike=내려찍기 끝(바닥), tHold=임팩트 멈칫 끝. 내려찍기를 넓혀(0.42~0.60) 눈에 보이게 + 전체 느리게=무게감.
  const _swT={ tUp:0.42, tStrike:0.60, tHold:0.70, speed:3.0 };
  let heldSwing=0,_impactDone=false; const _ss=t=>t*t*(3-2*t);
  const _q=new THREE.Quaternion(), _QID=new THREE.Quaternion();
  // ★sweep 확인: rx 양수=위로 들림, rx 음수=앞아래로 내려침. (부호 반대로 넣어 "뒤로 치던" 것 수정)
  const Q_UP=new THREE.Quaternion().setFromEuler(new THREE.Euler(0.95, 0.18, 0.06));        // 준비: 위로 크게 들어올림
  const Q_STRIKE=new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.25, -0.08, -0.03)); // 타격: 앞·아래로 깊게 내려찍기
  // ★위치 이동(쓸기) — 회전만이면 제자리 까딱이라 어색. 준비=우상 뒤로, 타격=좌하·앞으로 쓸고 내려옴.
  const P_UP=new THREE.Vector3(0.12,0.14,0.06), P_STRIKE=new THREE.Vector3(-0.06,-0.20,-0.14), _VZERO=new THREE.Vector3(), _v=new THREE.Vector3();
  const heldGroup=new THREE.Group(), swingGroup=new THREE.Group(); swingGroup.position.copy(SWING_PIVOT);
  const inner=new THREE.Group(); inner.position.copy(SWING_PIVOT).multiplyScalar(-1);
  const armG=(()=>{ const g=new THREE.Group(); const sk=new THREE.MeshLambertMaterial({color:0xe6a878}),sl=new THREE.MeshLambertMaterial({color:0x4a6a8a});
    const f=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.30),sl);f.position.set(0,0,0.08); const h=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.11),sk);h.position.set(0,0,-0.13); g.add(f);g.add(h); return g; })();
  armG.position.set(0.22,-0.36,-0.6); armG.rotation.set(0.55,-0.5,0.12);
  const toolG=new THREE.Group(); inner.add(armG); inner.add(toolG); swingGroup.add(inner); heldGroup.add(swingGroup); camera.add(heldGroup); if(!camera.parent) scene.add(camera);
  new GLTFLoader().load(encodeURI('/assets/kenney_survival-kit/Models/GLB format/tool-pickaxe.glb'), g=>{ armG.visible=false;
    const m=g.scene.clone(true); m.traverse(o=>{ if(o.isMesh){ o.frustumCulled=false; const s=Array.isArray(o.material)?o.material[0]:o.material;
      o.material=new THREE.MeshLambertMaterial({map:(s&&s.map)?s.map:null,color:(s&&s.map)?0xffffff:0xb9b9b9}); }});
    const bb=new THREE.Box3().setFromObject(m); const bs=Math.max(bb.max.x-bb.min.x,bb.max.y-bb.min.y,bb.max.z-bb.min.z)||1;
    const c=bb.getCenter(new THREE.Vector3()); m.position.sub(c); const w=new THREE.Group(); w.add(m);
    w.scale.setScalar(0.5/bs); w.position.copy(SWING_PIVOT); w.rotation.set(0.15,-0.55,0.75); toolG.add(w);   // 원래 자세(사령관: 아까가 나음)
    window.__toolW=w;   // 잡은 자세 조정용(sweep)
  }, undefined, ()=>{ armG.visible=true; });
  function swing(){ if(heldSwing<=0) heldSwing=1; }   // 1인칭 viewmodel 스윙(아바타 애니는 player.js use가 처리)

  // ── 칩(광물색)/sfx ──
  function sfx(u,v){ let a=null; try{a=new Audio(u);a.volume=v;}catch(e){} return ()=>{try{if(a){const n=a.cloneNode();n.volume=v;n.play().catch(()=>{});}}catch(e){}}; }
  // 곡괭이 광석 타격음 — a-pickaxe-hitting-an-ore.wav에서 3개 잘라 랜덤 재생(단조로움 방지)
  const _hits=['/ore_hit1.mp3','/ore_hit2.mp3','/ore_hit3.mp3'].map(u=>sfx(u,0.75));
  const sfxHit=()=>_hits[(Math.random()*_hits.length)|0](); const sfxBreak=sfx('/ore_break.mp3',0.9);   // 광석 깨짐=rubble crash
  const chips=[]; const chipGeo=new THREE.BoxGeometry(0.12,0.08,0.14); const _chipMat=new Map();
  function chipMatFor(c){ const k=(c==null)?'def':c; if(_chipMat.has(k))return _chipMat.get(k); const m=new THREE.MeshStandardMaterial({color:(c==null)?0x8d8a86:c,roughness:0.85,flatShading:true}); _chipMat.set(k,m); return m; }
  function spawnChips(p,n=8,color){ const mat=chipMatFor(color); for(let i=0;i<n;i++){ const m=new THREE.Mesh(chipGeo,mat); m.position.copy(p); m.castShadow=true; scene.add(m);
    chips.push({m,v:new THREE.Vector3((Math.random()-0.5)*5,2+Math.random()*4,(Math.random()-0.5)*5),life:1.3}); } }

  // ── 광맥 배치(섬 위 결정론 scatter) ──
  const ROCKS=[]; const oreCount={};
  let _seed=20260626>>>0; const _rnd=()=>{ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296; };
  function makeRock(x,z,idx){ const ore=ORES[idx]; const gy=groundY(x,z);
    const brush=new Brush(ore.geo.clone(), ore.mat.clone()); brush.rotation.y=_rnd()*Math.PI*2; brush.position.set(x,gy,z); brush.castShadow=brush.receiveShadow=true; brush.updateMatrixWorld(true); scene.add(brush);
    const bb=new THREE.Box3().setFromObject(brush); const h=bb.max.y-bb.min.y, r=Math.max(0.6,(bb.max.x-bb.min.x)*0.45);
    let col=null; if(world&&RAPIER){ const cb=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,gy+h/2,z)); col=world.createCollider(RAPIER.ColliderDesc.cylinder(h/2,r),cb); }
    const R={obj:brush,ore,carves:0,state:'solid',x,z,gy,col,debris:[],cracks:[],stump:null,brokeAt:0,hitY:gy+h*0.5,srcMesh:null};
    ROCKS.push(R); return R; }
  // 광물명(userData.ore)→ORES 인덱스 매핑(등록 API 공용)
  const nameIdx={}; ORES.forEach((o,i)=>nameIdx[o.name]=i); const stoneIdx=nameIdx['돌']!=null?nameIdx['돌']:0;
  // ── 런타임 광석 등록: userData.ore(광물명)를 가진 THREE.Mesh(environment.js 형식) → Brush 광맥으로 교체 후 ROCKS 편입(즉시 채광 대상). 원본 메시는 씬에서 제거. ──
  function registerOreNode(mesh){
    if(!mesh||!mesh.position) return null;
    const nm=(mesh.userData&&mesh.userData.ore)||'돌'; const idx=nameIdx[nm]!=null?nameIdx[nm]:stoneIdx;
    const R=makeRock(mesh.position.x, mesh.position.z, idx);
    if(mesh.parent) mesh.parent.remove(mesh); else scene.remove(mesh);
    R.obj.userData.ore=nm; R.srcMesh=mesh; return R;   // ★광물명 유지(근접 이름표용) + 원본 메시 참조(해제용)
  }
  // ── 섬 언로드 시 해제: 원본 메시 또는 Brush 광맥으로 ROCK 찾아 ROCKS에서 제거 + Rapier/mesh 정리 ──
  function unregisterOreNode(mesh){
    if(!mesh) return false;
    const i=ROCKS.findIndex(r=>r.srcMesh===mesh || r.obj===mesh);
    if(i<0) return false; const R=ROCKS[i];
    if(R.col){ try{ world.removeRigidBody(R.col.parent()); }catch(e){} R.col=null; }
    if(R.obj) scene.remove(R.obj);
    if(R.stump) scene.remove(R.stump);
    for(const c of R.cracks) scene.remove(c); R.cracks.length=0;
    for(const d of R.debris){ scene.remove(d.m); if(d.body){ try{ world.removeRigidBody(d.body); }catch(e){} d.body=null; } } R.debris.length=0;
    ROCKS.splice(i,1); return true;
  }
  if(EXTERNAL && ctx.environment && ctx.environment.ORE_NODES){
    // 본편: environment 광석노드 → mine Brush 광맥으로 교체(위치 재활용 + 이름→광물 매핑). navmap 마커 유지 위해 ORE_NODES를 광맥 메시로 치환.
    const nodes=ctx.environment.ORE_NODES; let rep=0;
    for(let i=0;i<nodes.length;i++){ const R=registerOreNode(nodes[i]); if(R){ nodes[i]=R.obj; rep++; } }
    console.log('[mine] 본편 광석노드', rep, '개 → Brush 광맥 교체');
  } else {
    for(let i=0;i<ORES.length;i++){ const a=(i/ORES.length)*Math.PI*2, r=7+_rnd()*7; makeRock(Math.cos(a)*r, Math.sin(a)*r, i); }   // 샌드박스: 9종 한 바퀴 배치
  }
  // 쓰러진/터진 파편 받칠 지면 collider (샌드박스 전용 — 본편은 실제 지형이 받침)
  if(!EXTERNAL && world&&RAPIER){ const gb=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0,((terrain&&terrain.topY)||0)-0.5,0)); world.createCollider(RAPIER.ColliderDesc.cuboid(70,0.5,70),gb); }

  // ── carve(CSG 작은 구 누적) + 조각남 ──
  function carveRock(R, point, dir){
    // 조준점 주변을 얕게 갉음(관통 방지 — 깊이 누적하면 광맥 관통→조준선이 구멍으로 빠져 4번째부터 miss).
    // 랜덤 오프셋으로 같은 조준점도 매번 새 부피가 깎임 → 계속 파이고, 8번이면 그 부위가 넓게 패여 깨짐.
    const sp=CARVE_R*0.7; const center=point.clone().addScaledVector(dir, CARVE_R*0.4)
      .add(new THREE.Vector3((Math.random()-0.5)*sp,(Math.random()-0.5)*sp,(Math.random()-0.5)*sp));
    const sb=new Brush(carveSphereGeo, R.obj.material); sb.scale.setScalar(CARVE_R/0.5); sb.position.copy(center); sb.updateMatrixWorld(true);
    let result; try{ result=ev.evaluate(R.obj, sb, SUBTRACTION); }catch(e){ console.warn('[mine] CSG 실패', e&&e.message); return; }
    result.material=R.obj.material; result.castShadow=result.receiveShadow=true; result.updateMatrixWorld(true);
    scene.remove(R.obj); R.obj=result; scene.add(result);
    R.carves++; if(R.carves>=CARVE_MAX) breakRock(R, point);   // (균열 데칼 제거 — 사령관)
  }
  function physDebris(mesh,pos,power=1,rad=0.3){ mesh.position.copy(pos); mesh.castShadow=true; scene.add(mesh);
    if(!(world&&RAPIER)) return null;
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x,pos.y,pos.z).setLinearDamping(0.25).setAngularDamping(0.4));
    world.createCollider(RAPIER.ColliderDesc.ball(rad).setDensity(0.5).setFriction(0.85).setRestitution(0.25), body);
    const m=body.mass(); body.applyImpulse({x:(Math.random()-0.5)*3.0*power*m,y:(2.5+Math.random()*2.5)*power*m,z:(Math.random()-0.5)*3.0*power*m},true);
    body.applyTorqueImpulse({x:(Math.random()-0.5)*0.7*m,y:(Math.random()-0.5)*0.7*m,z:(Math.random()-0.5)*0.7*m},true); return body; }
  function breakRock(R,p){
    if(R.col){ try{world.removeRigidBody(R.col.parent());}catch(e){} R.col=null; }
    for(const c of R.cracks) scene.remove(c); R.cracks.length=0;   // 금 선 제거(깨졌으니)
    scene.remove(R.obj); R.state='broke'; R.brokeAt=performance.now(); sfxBreak(); spawnChips(p,20, R.ore.lp.color);
    const base=new THREE.Vector3(R.x, R.hitY, R.z);
    // ★바닥 그루터기 = split 애셋(모든 광물 공통) + 광물색(철광석=파랑/황철석=금빛…). 나무 그루터기처럼 영구(fade 안 함).
    const stump=new THREE.Mesh(splitGeo, R.ore.mat.clone()); stump.castShadow=stump.receiveShadow=true;
    stump.scale.setScalar(0.95); stump.position.set(R.x,R.gy,R.z); stump.rotation.y=Math.random()*Math.PI*2;
    const sb=new THREE.Box3().setFromObject(stump); stump.position.y+=R.gy-sb.min.y+0.12; scene.add(stump); R.stump=stump;   // 지면 위로 살짝(묻힘 방지)
    const mineMul = ctx.settlement?.mineMulAt ? ctx.settlement.mineMulAt(R.x, R.z) : 1;   // ⛏️ 광산 건물 = 그 섬 채광 산출↑ (생산 기지)
    const drop=Math.round(7*mineMul);
    oreCount[R.ore.key]=(oreCount[R.ore.key]||0)+drop;
    // ★채광 산물 = 부서진 광석 조각 그 자체가 튀어나와 몸으로 빨려듦(마그넷). 조각 모양=광석 geo·광물색.
    if(ctx.pickup){ ctx.pickup.spawn(R.ore.item, drop, {x:R.x, y:R.hitY, z:R.z}, { geo:R.ore.geo, mat:R.ore.mat, scale:0.22, nuggets:6, pop:2.6 }); console.log('[mine] 조각 튐', R.ore.name, drop); }   // ★pop=세게 튀겨 흩어진 뒤 흘러들어옴(코앞 채광 즉시흡수 방지)
    else { const ok = ctx.inventory ? ctx.inventory.add(R.ore.item, drop) : false;   // 픽업 없으면 즉시 적재(폴백)
      console.log('[mine] +'+R.ore.name, drop, ctx.inventory?(ok?('보유 '+R.ore.item+' '+ctx.inventory.count(R.ore.item)):'(무게초과)'):'(인벤없음)'); }
  }

  // ── 조준(크로스헤어) 광맥에 곡괭이 임팩트 ──
  //   ★거리·근접은 카메라가 아닌 "플레이어" 기준 → 3인칭(카메라 뒤 6.5m)에서도 동작.
  const ray=new THREE.Raycaster(), _ppv=new THREE.Vector3();
  function aimed(){ const pp=ctx.player?ctx.player.pos:camera.position; _ppv.set(pp.x,pp.y,pp.z);
    ray.setFromCamera(new THREE.Vector2(0,0), camera); let best=null,bd=1e9;     // 크로스헤어(화면중앙) 방향
    for(const R of ROCKS){ if(R.state!=='solid')continue; const h=ray.intersectObject(R.obj,true)[0];
      if(h&&h.point.distanceTo(_ppv)<5&&h.distance<bd){ bd=h.distance; best={R,h}; } }   // 플레이어 반경 5m 내(리치)
    if(best) return best;
    // 폴백: 크로스헤어 miss여도 플레이어 근접(4m) solid 광맥을 계속 친다(곡괭이=근접)
    let nr=null,nd=4;
    for(const R of ROCKS){ if(R.state!=='solid')continue; const dist=Math.hypot(R.x-_ppv.x, R.hitY-_ppv.y, R.z-_ppv.z); if(dist<nd){ nd=dist; nr=R; } }
    if(nr) return { R:nr, h:{ point:new THREE.Vector3(nr.x,nr.hitY,nr.z), face:null } };
    return null; }
  function onImpact(){ if(ctx.player&&ctx.player.currentTool&&ctx.player.currentTool!=='pickaxe') return;   // 곡괭이 장착 때만 채광
    const a=aimed(); if(!a) return; const {R,h}=a; const p=h.point;
    spawnChips(p,6, R.ore.lp.color); sfxHit(); R.hitY=p.y;
    if(ctx.toolDur && !ctx.toolDur.wear('pickaxe')) return;   // ★D2(2026-07-15): 곡괭이 내구도 소모 — 무뎌지면 헛손질(carve 스킵=효율 절반). VFX/사운드는 위에서 이미 재생.
    carveRock(R, p, ray.ray.direction.clone().normalize()); }   // 시선 방향으로 파고듦
  addEventListener('pointerdown', e=>{ if(e.button===0) swing(); });

  // ── 🖐️ 맨손 채광(사령관): 곡괭이 없을 때 광맥을 부수지 않고 누르는 동안 5초당 광물 1개(돌 등). 도구 분실 대비 최소 채집. ──
  let _bareHeld=false, _bareT=0;
  addEventListener('pointerdown', e=>{ if(e.button===0) _bareHeld=true; });
  addEventListener('pointerup',   e=>{ if(e.button===0) _bareHeld=false; });
  addEventListener('blur', ()=>{ _bareHeld=false; });

  // 스윙 포즈를 p(0~1)에 맞춰 swingGroup에 적용 — 라이브 애니/프리즈 캡처 공용.
  function applyPose(p){ const T=_swT;
    if(p<T.tUp){ const k=_ss(p/T.tUp); _q.copy(_QID).slerp(Q_UP,k); _v.copy(_VZERO).lerp(P_UP,k); }                       // 준비: 묵직하게 들어올림+우상 뒤로
    else if(p<T.tStrike){ const k=(p-T.tUp)/(T.tStrike-T.tUp); _q.copy(Q_UP).slerp(Q_STRIKE,k*k); _v.copy(P_UP).lerp(P_STRIKE,k*k); } // 타격: 가속 내려찍기+좌하 앞으로 쓸기
    else if(p<T.tHold){ _q.copy(Q_STRIKE); _v.copy(P_STRIKE); }                                                          // 임팩트 멈칫(무게감)
    else { const k=(p-T.tHold)/(1-T.tHold); const e=1-(1-k)*(1-k); _q.copy(Q_STRIKE).slerp(_QID,e); _v.copy(P_STRIKE).lerp(_VZERO,e); } // 복귀: 느리게
    swingGroup.quaternion.copy(_q); swingGroup.position.copy(SWING_PIVOT).add(_v); }

  // ── 매 프레임: 스윙 애니 + 파편 동기화 + 페이드 + 칩 (물리 step은 sandbox가 담당) ──
  ctx.onUpdate(dt=>{
    // 곡괭이 1인칭 viewmodel은 player.js가 통합 관리 → player 있으면 비표시(단독 ?sys=mine 테스트 때만 폴백)
    heldGroup.visible = !ctx.player && true;
    // 🖐️ 맨손 채광 — 곡괭이 미장착 + 좌클릭 유지 + 광맥 조준 시 5초당 광물 1(부수지 않음)
    if(_bareHeld && ctx.player && ctx.player.currentTool==='none'){
      const ba=aimed();
      if(ba){ _bareT+=dt;
        if(_bareT>=5){ _bareT=0; const R=ba.R, p=ba.h.point;
          if(ctx.pickup) ctx.pickup.spawn(R.ore.item, 1, {x:p.x,y:p.y,z:p.z}, { geo:R.ore.geo, mat:R.ore.mat, scale:0.22, nuggets:1, pop:2.2 });
          else if(ctx.inventory) ctx.inventory.add(R.ore.item, 1);
          spawnChips(p, 4, R.ore.lp.color); sfxHit(); } }
      else _bareT=0;
    } else if(_bareT){ _bareT=0; }
    if(window.__freezeP!=null){ applyPose(window.__freezeP); }                     // 검증용: 포즈 고정(드리프트 없음)
    else if(window.__testQ){ swingGroup.quaternion.copy(window.__testQ); }
    else if(heldSwing>0){ heldSwing=Math.max(0,heldSwing-dt*_swT.speed); const p=1-heldSwing;
      applyPose(p);
      if(!_impactDone&&p>=_swT.tStrike){_impactDone=true; onImpact();} }
    else { swingGroup.quaternion.identity(); swingGroup.position.copy(SWING_PIVOT); _impactDone=false; }
    const now=performance.now();
    for(const R of ROCKS){ if(R.state==='broke'){ for(const d of R.debris){ if(d.body){ const t=d.body.translation(),q=d.body.rotation(); d.m.position.set(t.x,t.y,t.z); d.m.quaternion.set(q.x,q.y,q.z,q.w); } }
      const age=(now-R.brokeAt)/1000;   // 광물 드롭만 7s 후 fade(주워짐). 그루터기는 남김.
      if(age>7){ const o=Math.max(0,1-(age-7)*0.7); for(const d of R.debris){ d.m.traverse(x=>{ if(x.material){const ms=Array.isArray(x.material)?x.material:[x.material]; ms.forEach(mt=>{mt.transparent=true;mt.opacity=o;mt.depthWrite=false;});} }); }
        if(age>8.5){ for(const d of R.debris){ scene.remove(d.m); if(d.body){try{world.removeRigidBody(d.body);}catch(e){}d.body=null;} } R.debris.length=0; R.state='mined'; } } } }
    for(let i=chips.length-1;i>=0;i--){ const c=chips[i]; c.v.y-=16*dt; c.m.position.addScaledVector(c.v,dt); c.life-=dt; if(c.life<0){scene.remove(c.m);chips.splice(i,1);} }
    if(window.__dc){ ctx.camera.position.set(...window.__dc.p); ctx.camera.lookAt(...window.__dc.t); }   // 검수용 카메라(player 덮어쓰기 뒤)
  });

  // ── 프리워밍(사령관 "첫 채광 프레임 드랍") — split·균열·광석 조각 머티리얼 셰이더 컴파일을 로드 시점으로 ──
  try{
    const warm=[ new THREE.Mesh(splitGeo, splitMat), new THREE.Mesh(crackPlaneGeo, _crackMats[0]) ];
    if(ORES[0] && ORES[0].mat) warm.push(new THREE.Mesh(splitGeo, ORES[0].mat.clone()));   // 조각=R.ore.mat.clone() 경로 워밍
    warm.forEach(m=>{ m.position.set(0,-990,0); scene.add(m); });
    if(ctx.renderer && ctx.camera) ctx.renderer.compile(scene, ctx.camera);
    warm.forEach(m=>scene.remove(m));
  }catch(e){ console.warn('[mine] prewarm', e&&e.message); }

  ctx.mine={ rocks:ROCKS.length, swing, registerNode:registerOreNode, unregisterNode:unregisterOreNode };
  window.__sbmine={ swing,
    mineNow:idx=>{ const R=ROCKS.filter(r=>r.state==='solid')[idx||0]; if(R){ breakRock(R,new THREE.Vector3(R.x,R.hitY,R.z)); return [R.x,R.gy,R.z,R.ore.key]; } },
    carveN:(idx,n)=>{ const R=ROCKS.filter(r=>r.state==='solid')[idx||0]; if(!R)return 0; const dn=new THREE.Vector3(0,-1,0);
      for(let i=0;i<(n||1)&&R.state==='solid';i++){ const pt=new THREE.Vector3(R.x+(Math.random()-0.5)*0.7, R.hitY+0.8, R.z+(Math.random()-0.5)*0.7); carveRock(R, pt, dn); } return R.carves; },
    look:(p)=>{ const gy=(p&&p[1])||0; window.__dc={ p:[p[0]+3.2,gy+2.4,p[2]+3.2], t:[p[0],gy+1.2,p[2]] }; },
    aimHit:()=>{ const a=aimed(); onImpact(); return a?{ore:a.R.ore.key,carves:a.R.carves,state:a.R.state}:{miss:true}; },   // 현재 시선으로 타격(정조준 반복 재현)
    poseAt:(p)=>{ window.__freezeP=p; _impactDone=true; },   // 스윙 포즈를 p(0~1) 시점에 진짜 고정(드리프트 없음, 검증용)
    poseOff:()=>{ window.__freezeP=null; },
    testPose:(rx,ry,rz)=>{ window.__testQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(rx,ry,rz||0)); },   // pitch sweep 확인용
    testOff:()=>{ window.__testQ=null; },
    toolPose:(rx,ry,rz)=>{ if(window.__toolW) window.__toolW.rotation.set(rx,ry,rz); },   // 잡은 자세 sweep
    state:()=>({rocks:ROCKS.map(r=>({ore:r.ore.key,carves:r.carves,state:r.state,x:r.x,z:r.z,gy:r.gy,stump:!!r.stump,debris:r.debris.length})), ores:{...oreCount}, inv:ctx.inventory?ctx.inventory.serialize().personal:null}) };
  console.log('[mine]', ROCKS.length, '광맥 — 클릭으로 채광(조금씩 파다 조각남)');
  return ctx.mine;
}
