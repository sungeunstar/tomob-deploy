/**
 * TOMOB Aurora v3 — existing game architecture, reauthored landmark dressing.
 * Shared v1/v2 heightfield and routes; native player/input/physics remain external.
 * No save, economy, mining or world-streaming state is changed by this module.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createIslandField } from './aurora-island.js';

const SIZE=284,N=200;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const rngFor=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const HX='KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/blue/';
export const AURORA_BUILDINGS=[
 {id:'mine',file:'building_mine_blue.fbx',name:'기존 광산',x:64,z:13,size:14,yaw:0,r:8.1},
 {id:'harbor',file:'building_tavern_blue.fbx',name:'선착장 선술집',x:-58,z:63,size:12,yaw:.28,r:7.4},
 {id:'home',file:'building_home_A_blue.fbx',name:'항구의 집',x:-23,z:59,size:8.8,yaw:-.35,r:5.5},
 {id:'mill',file:'building_watermill_blue.fbx',name:'폭포 물방앗간',x:-72,z:18,size:11,yaw:-Math.PI/2,r:6.7},
 {id:'workshop',file:'building_blacksmith_blue.fbx',name:'광산 작업장',x:81,z:24,size:9.5,yaw:-.6,r:5.8},
 {id:'lookout',file:'building_tower_A_blue.fbx',name:'동쪽 망루',x:76,z:-32,size:12,yaw:0,r:6},
 {id:'shrine',file:'building_church_blue.fbx',name:'정상의 옛 성소',x:-9,z:-43,size:13.5,yaw:0,r:7.5}
];
function rockGeometry(){
 const sides=8,heights=[-1,-.58,-.12,.42,.83,1],radii=[.72,.98,.94,1,.84,.58],v=[],ix=[];
 for(let k=0;k<heights.length;k++)for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2,r=radii[k]*(1+.075*Math.sin(j*4.6+k*.7));v.push(Math.cos(a)*r,heights[k]+.025*Math.sin(j*2.8),Math.sin(a)*r);}
 for(let k=0;k<heights.length-1;k++)for(let j=0;j<sides;j++){const a=k*sides+j,b=k*sides+(j+1)%sides,c=a+sides,d=b+sides;ix.push(a,c,b,b,c,d);}
 for(let j=1;j<sides-1;j++){ix.push(0,j,j+1);const b=(heights.length-1)*sides;ix.push(b,b+j+1,b+j);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(ix);g.computeVertexNormals();return g;
}
function grainTexture(){
 const size=128,rng=rngFor(73266),c=document.createElement('canvas');c.width=c.height=size;const x=c.getContext('2d'),im=x.createImageData(size,size);
 for(let z=0;z<size;z++)for(let u=0;u<size;u++){const h=128+18*Math.sin(u*.47)*Math.cos(z*.39)+(rng()-.5)*38;im.data.set([h,h,h,255],(z*size+u)*4);}x.putImageData(im,0,0);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(72,72);t.anisotropy=4;return t;
}
export async function initAuroraRefined(ctx,options={}){
 if(!ctx.scene||!ctx.world||!ctx.RAPIER)throw new Error('Aurora v3 requires the native core and physics.');
 if(ctx.terrain)throw new Error('Unload the previous terrain explicitly before loading Aurora v3.');
 const {scene,world,RAPIER:R}=ctx,root=new THREE.Group(),field=createIslandField(),rng=rngFor(92725),base=options.assetRoot||new URL('../',import.meta.url).href;
 root.name='Aurora v3 — native asset island';scene.add(root);
 const colliders=[],collide=[],walkSurfaces=[],placements=[],batches=[],textures=new Set(),materials=new Set(),geometries=new Set(),updaters=[];
 const assets={trees:0,rocks:0,buildings:[],fallback:0,errors:[]};let disposed=false,elapsed=0,updateHook=null;
 const mat=(color,more={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.94,...more});materials.add(m);return m;};
 const stone=mat('#9aa59a',{flatShading:true}),darkStone=mat('#737f78',{flatShading:true}),moss=mat('#69874c'),wood=mat('#8b7050'),woodDark=mat('#64543f'),sandMat=mat('#d2c3a1');
 const cube=new THREE.BoxGeometry(1,1,1),rockG=rockGeometry();geometries.add(cube);geometries.add(rockG);
 const spec=AURORA_BUILDINGS.map(b=>({...b,y:b.id==='shrine'?46:field.height(b.x,b.z)}));
 // Flatten only building footprints. The surrounding terrain blends back into the shared field.
 for(let iz=0;iz<=N;iz++)for(let ix=0;ix<=N;ix++){const i=iz*(N+1)+ix,x=(ix/N-.5)*SIZE,z=(iz/N-.5)*SIZE;for(const b of spec){const d=Math.hypot(x-b.x,z-b.z),a=1-smooth(b.r*.76,b.r+2.2,d);field.heights[i]+=(b.y-field.heights[i])*a;}
  // The whole terrace, not only the chapel, shares one support elevation.
  const px=Math.max(0,Math.abs(x+9)-9),pz=Math.max(0,Math.abs(z+39)-8.5),plaza=1-smooth(0,3,Math.hypot(px,pz));field.heights[i]+=(46-field.heights[i])*plaza;
 }
 const names={cave:'돌산 광산',shrine:'정상의 옛 성소',lookout:'동쪽 망루',falls:'폭포와 오래된 다리'};
 for(const p of field.points){p.name=names[p.id]||p.name;if(p.id==='cave'){p.x=64;p.z=27;}if(p.id==='shrine'){p.x=-9;p.z=-31;}if(p.id==='lookout'){p.x=76;p.z=-23;}p.y=field.height(p.x,p.z);}
 field.points.push({id:'harbor',name:'선착장 선술집',sub:'출항 전 잠깐의 휴식',x:-48,z:63,y:field.height(-48,63),r:6},{id:'mill',name:'물방앗간',sub:'계곡을 따라 난 샛길',x:-65,z:18,y:field.height(-65,18),r:6});
 function addCollider(desc){const c=world.createCollider(desc.setFriction(.9));colliders.push(c);return c;}
 function addTrimesh(o,ground=true){o.updateWorldMatrix(true,false);const p=o.geometry.attributes.position,vs=new Float32Array(p.count*3),v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);vs.set([v.x,v.y,v.z],i*3);}const idx=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);addCollider(R.ColliderDesc.trimesh(vs,idx));collide.push(o);if(ground)walkSurfaces.push(o);return o;}
 function mesh(g,m,x,y,z,s=[1,1,1],solid=false,batch=true){geometries.add(g);materials.add(m);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.castShadow=o.receiveShadow=true;root.add(o);if(solid)addTrimesh(o);if(batch&&!m.transparent&&!m.isShaderMaterial)batches.push(o);return o;}
 const box=(x,y,z,s,m=wood,solid=false)=>mesh(cube,m,x,y,z,s,solid);
 function beam(a,b,r=.1,m=woodDark){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),o=mesh(new THREE.CylinderGeometry(r,r,d.length(),6),m,...av.add(bv).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
 function instances(g,m,items,name,shadow=true){if(!items.length)return null;geometries.add(g);materials.add(m);const im=new THREE.InstancedMesh(g,m,items.length),d=new THREE.Object3D();items.forEach((p,i)=>{d.position.set(p.x,p.y,p.z);d.rotation.set(p.rx||0,p.rot||0,p.rz||0);d.scale.set(...p.s);d.updateMatrix();im.setMatrixAt(i,d.matrix);if(p.color)im.setColorAt(i,new THREE.Color(p.color));});im.instanceMatrix.needsUpdate=true;im.computeBoundingSphere();im.castShadow=shadow;im.receiveShadow=true;im.name=name;root.add(im);return im;}
 const pos=[],col=[],uv=[],indices=[],cGrass=new THREE.Color('#7b9d57'),cLight=new THREE.Color('#a6b876'),cSand=new THREE.Color('#e0d1a9'),cRock=new THREE.Color('#9ca597'),cPath=new THREE.Color('#c6b68c');
 for(let iz=0;iz<=N;iz++)for(let ix=0;ix<=N;ix++){const i=iz*(N+1)+ix,x=(ix/N-.5)*SIZE,z=(iz/N-.5)*SIZE,y=field.heights[i];pos.push(x,y,z);uv.push(ix/N,iz/N);const v=.5+.25*(Math.sin(x*.12+z*.17)+Math.cos(z*.1-x*.05)),c=cGrass.clone().lerp(cLight,v*.48);if(y<7)c.lerp(cSand,1-smooth(4.7,7,y));c.lerp(cRock,smooth(.5,1.3,field.slope(x,z))*.85);c.lerp(cPath,(1-smooth(1.7,2.8,field.paths[i]))*.82);c.multiplyScalar(.96+.035*Math.sin(x*.75+z*.49));col.push(c.r,c.g,c.b);if(ix<N&&iz<N)indices.push(i,i+N+1,i+1,i+1,i+N+1,i+N+2);}
 const landG=new THREE.BufferGeometry();landG.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));landG.setAttribute('color',new THREE.Float32BufferAttribute(col,3));landG.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));landG.setIndex(indices);landG.computeVertexNormals();
 const grain=grainTexture();textures.add(grain);const landMat=mat('#ffffff',{vertexColors:true,bumpMap:grain,bumpScale:.07}),land=mesh(landG,landMat,0,0,0,[1,1,1],true,false);land.name='Shared Aurora heightfield / visual and Rapier SSOT';walkSurfaces.splice(walkSurfaces.indexOf(land),1);
 const excluded=(x,z,pad=0)=>spec.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+pad)||Math.hypot(x+49,z-1)<24;
 // Layered rocks are kept outside routes and footprints; geometry and collision agree.
 const cliffs=[];for(let n=0;n<2800&&cliffs.length<175;n++){const x=(rng()-.5)*224,z=(rng()-.5)*206,y=field.height(x,z);if(y<8||field.slope(x,z)<.72||field.nearPath(x,z).d<7||excluded(x,z,3))continue;cliffs.push({x,y:y-2.5,z,s:[2+rng()*2.8,3.6+rng()*3.4,2+rng()*2],rot:rng()*6.28});}
 const cliff=instances(rockG,stone,cliffs,'Layered cliffs');
 if(cliff){const a=new THREE.Matrix4(),p=rockG.attributes.position,v=new THREE.Vector3();for(let i=0;i<cliff.count;i++){cliff.getMatrixAt(i,a);const points=new Float32Array(p.count*3);for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(a);points.set(v.toArray(),j*3);}const d=R.ColliderDesc.convexHull(points);if(d)addCollider(d);}collide.push(cliff);walkSurfaces.push(cliff);}
 // Human-scale dock and continuous bridge deck, without individual plank collision gaps.
 box(-48,4.05,93,[5.6,.34,18],wood,true);for(let i=0;i<34;i++)box(-48,4.245,84.3+i*.52,[5.65,.055,.46],i%4?wood:woodDark);
 for(const x of[-50.5,-45.5])for(const z of[86,92,100]){box(x,3,z,[.3,5.8,.3],woodDark);beam([x,5.25,z],[x,5.4,z],.21,wood);}
 const bridgeTop=x=>11.25-.65*Math.sin(clamp((x+64)/34)*Math.PI),pv=[],pi=[];
 for(let i=0;i<=68;i++){const x=-64+i*.5,y=bridgeTop(x);pv.push(x,y,1.7,x,y,6.3);if(i<68){const k=i*2;pi.push(k,k+1,k+2,k+1,k+3,k+2);box(x+.23,y-.11,4,[.44,.2,4.7],i%5?wood:woodDark);}}
 const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(pv,3));bg.setIndex(pi);bg.computeVertexNormals();const bm=mat('#ffffff');bm.visible=false;mesh(bg,bm,0,0,0,[1,1,1],true,false);
 for(const z of[1.8,6.2])for(let i=0;i<=10;i++){const x=-64+i*3.4,y=bridgeTop(x);beam([x,y-.1,z],[x,y+1.12,z],.08);if(i<10)beam([x,y+1,z],[x+3.4,bridgeTop(x+3.4)+1,z],.044);}
 function ribbon(points,width,material,name,solid=false){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),ps=[],uv=[],ix=[],steps=Math.max(24,points.length*12);for(let i=0;i<=steps;i++){const t=i/steps,p=curve.getPoint(t),tan=curve.getTangent(t),side=new THREE.Vector3(-tan.z,0,tan.x).normalize();if(side.lengthSq()<.01)side.set(1,0,0);const w=typeof width==='function'?width(t):width;for(const s of[-1,1]){const v=p.clone().addScaledVector(side,w*.5*s);if(name==='Short approach to existing building')v.y=field.height(v.x,v.z)+.045;else if(/cascade|Spring running/.test(name))v.y=Math.max(v.y,field.height(v.x,v.z)+.12);ps.push(v.x,v.y,v.z);uv.push((s+1)/2,t);}if(i<steps){const k=i*2;ix.push(k,k+1,k+2,k+1,k+3,k+2);}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();const o=mesh(g,material,0,0,0,[1,1,1],solid,false);o.name=name;return o;}
 // Side paths are draped on the actual ground; the main shared paths stay unchanged.
 const connections=[[[ -48,66],[-53,63]], [[-29,51],[-23,54]], [[-64,4],[-66,11],[-66,18]],[[64,27],[73,29],[79,29]]];
 const pathMat=mat('#c2b18c',{side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});for(const path of connections)ribbon(path.map(([x,z])=>[x,field.height(x,z)+.035,z]),2.3,pathMat,'Short approach to existing building');
 // Old circular ring is gone: a small stone terrace anchors the existing chapel.
 const sy=field.height(-9,-43);box(-9,sy+.12,-39,[18,.24,17],stone,true);for(let i=0;i<4;i++)box(-9,field.height(-9,-28-i*.7)+.12,-28-i*.7,[4.2,.22,.7],stone,true);
 for(const[x,z]of[[-17,-32],[-1,-32],[-17,-46]]){const y=field.height(x,z);mesh(rockG,stone,x,y+1,z,[.7,1.3,.7],true);}
 // A small non-floating grove monument, with a clear walkable forecourt.
 const gy=field.height(-3,16);mesh(new THREE.CylinderGeometry(2.6,2.9,.35,10),stone,-3,gy+.175,16,[1,1,1],true);mesh(rockG,darkStone,-3,gy+1.1,16,[.7,1.05,.65],true);
 const cove=field.points.find(p=>p.id==='cove');box(cove.x,cove.y+.4,cove.z,[1.4,.8,.85],wood,true);box(cove.x,cove.y+.84,cove.z,[1.45,.1,.9],woodDark);
 // Native KayKit building catalogue. One shared atlas, original colours, no fabricated copies.
 const atlasURL=new URL(HX+'hexagons_medieval.png',base).href,manager=new THREE.LoadingManager();manager.setURLModifier(u=>/\.(png|jpe?g)(\?|$)/i.test(u)?atlasURL:u);
 const fbx=new FBXLoader(manager),gltf=new GLTFLoader();fbx.setResourcePath(new URL(HX,base).href);
 const atlas=await new THREE.TextureLoader().loadAsync(atlasURL);atlas.colorSpace=THREE.SRGBColorSpace;atlas.flipY=true;atlas.anisotropy=4;textures.add(atlas);const buildingMat=mat('#ffffff',{map:atlas,roughness:.91});
 async function building(b){try{const raw=await fbx.loadAsync(new URL(HX+b.file,base).href);if(disposed)return;raw.updateMatrixWorld(true);let bb=new THREE.Box3().setFromObject(raw),size=bb.getSize(new THREE.Vector3());const scale=b.size/Math.max(size.x,size.y,size.z);raw.scale.multiplyScalar(scale);raw.updateMatrixWorld(true);bb=new THREE.Box3().setFromObject(raw);const c=bb.getCenter(new THREE.Vector3());raw.position.sub(new THREE.Vector3(c.x,bb.min.y,c.z));const h=new THREE.Group();h.name=b.name;h.userData.nativeAsset=HX+b.file;h.add(raw);h.rotation.y=b.yaw;h.position.set(b.x,b.y+(b.id==='shrine'?.26:0),b.z);root.add(h);h.updateMatrixWorld(true);raw.traverse(o=>{if(!o.isMesh)return;o.material=buildingMat;o.castShadow=o.receiveShadow=true;geometries.add(o.geometry);addTrimesh(o);});const bounds=new THREE.Box3().setFromObject(h);assets.buildings.push({id:b.id,file:b.file,size:bounds.getSize(new THREE.Vector3()).toArray().map(n=>+n.toFixed(2)),x:b.x,y:+h.position.y.toFixed(2),z:b.z});return h;}catch(e){assets.errors.push(b.file+': '+e.message);console.error('[aurora-v3 asset]',b.file,e);}}
 const buildingJobs=spec.map(building);
 // Waterfall: a spring-backed rock face, two cascades, an irregular terrain-fitted pool.
 const waterClock={value:0},pondY=8.03;
 const followSurface=(x,z)=>[x,Math.max(pondY+.08,field.height(x,z)+.18),z];
 const wetStone=mat('#798f85',{roughness:.68});
 // Rock banks flank the water; no tall opaque rock wall cuts across the stream.
 for(const[cx,cz]of[[-38,-25],[-41,-20],[-44,-15]])for(const side of[-1,1]){
  const x=cx+side*3.7,z=cz,ground=field.height(x,z);mesh(rockG,wetStone,x,ground+.7,z,[1.3,1.6,1.65],true);
 }
 const sheetMat=new THREE.MeshStandardMaterial({color:'#a9dcd6',roughness:.27,metalness:.06,transparent:true,opacity:.87,side:THREE.DoubleSide,depthWrite:false});materials.add(sheetMat);
 const prev=sheetMat.onBeforeCompile;sheetMat.onBeforeCompile=function(shader,renderer){prev?.call(this,shader,renderer);shader.uniforms.auroraWaterTime=waterClock;shader.vertexShader='varying vec2 vCascadeUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvCascadeUv=uv;');shader.fragmentShader='varying vec2 vCascadeUv; uniform float auroraWaterTime;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 float lane=sin(vCascadeUv.x*83.0+sin(vCascadeUv.y*13.0-auroraWaterTime*2.0)*1.4);
 float flow=.5+.5*sin(vCascadeUv.y*69.0-auroraWaterTime*8.0+lane);
 float edge=smoothstep(0.0,.09,vCascadeUv.x)*(1.0-smoothstep(.88,1.0,vCascadeUv.x));
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.89,.98,.94),.18+flow*.22+max(0.0,lane)*.12);
 diffuseColor.a*=edge*(.72+.24*flow);
 `);};sheetMat.customProgramCacheKey=()=> 'aurora-v3-cascade';
 ribbon([[-35,-29],[-37,-26],[-39,-24]].map(([x,z])=>followSurface(x,z)),2.5,sheetMat,'Spring running over rock lip');
 ribbon([[-39,-24],[-40,-22],[-42,-19],[-43,-16.5]].map(([x,z])=>followSurface(x,z)),t=>2.6+Math.sin(t*Math.PI)*.4,sheetMat,'Upper cascade');
 ribbon([[-43,-16.5],[-44,-15.4],[-46,-12],[-47,-9.5]].map(([x,z])=>followSurface(x,z)),t=>2.9+t*.9,sheetMat,'Lower cascade');
 const lakeMat=mat('#58a9a3',{roughness:.32,metalness:.16,transparent:true,opacity:.91,side:THREE.DoubleSide,depthWrite:false});
 const lp=[-49,pondY,1],li=[],outline=[];for(let i=0;i<=96;i++){const a=i/96*Math.PI*2;let r=2;for(;r<25;r+=.25){const x=-49+Math.cos(a)*r,z=1+Math.sin(a)*r;if(field.height(x,z)>=pondY-.08)break;}r=Math.max(2,r-.15);const p=[-49+Math.cos(a)*r,pondY,1+Math.sin(a)*r];lp.push(...p);outline.push(p);if(i<96)li.push(0,i+2,i+1);}
 const lakeG=new THREE.BufferGeometry();lakeG.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));lakeG.setIndex(li);lakeG.computeVertexNormals();mesh(lakeG,lakeMat,0,0,0,[1,1,1],false,false).castShadow=false;
 const foamMat=new THREE.MeshBasicMaterial({color:'#d7ece1',transparent:true,opacity:.38,side:THREE.DoubleSide,depthWrite:false});materials.add(foamMat);const foam=[];for(let i=0;i<45;i++){const a=rng()*6.28,r=.5+rng()*3;foam.push({x:-47+Math.cos(a)*r,y:pondY+.06,z:-9.5+Math.sin(a)*r*.7,s:[.16+rng()*.5,.05,.15+rng()*.4],rot:rng()*6.28});}instances(new THREE.IcosahedronGeometry(1,0),foamMat,foam,'Cascade foam',false);
 const mistC=document.createElement('canvas');mistC.width=mistC.height=64;const mx=mistC.getContext('2d'),grad=mx.createRadialGradient(32,32,0,32,32,31);grad.addColorStop(0,'rgba(255,255,255,.65)');grad.addColorStop(1,'rgba(255,255,255,0)');mx.fillStyle=grad;mx.fillRect(0,0,64,64);const mistT=new THREE.CanvasTexture(mistC);textures.add(mistT);
 const mistP=[];for(let i=0;i<70;i++)mistP.push(-47+(rng()-.5)*5,pondY+.25+rng()*2,-10+(rng()-.5)*4);const mistG=new THREE.BufferGeometry();mistG.setAttribute('position',new THREE.Float32BufferAttribute(mistP,3));geometries.add(mistG);const mistMat=new THREE.PointsMaterial({color:'#e3f0e7',map:mistT,size:1.25,transparent:true,opacity:.27,depthWrite:false});materials.add(mistMat);const mist=new THREE.Points(mistG,mistMat);root.add(mist);
 updaters.push(t=>{waterClock.value=t;mist.position.y=Math.sin(t*.45)*.2;});
 // Same existing tree and rock models; never spawn them over buildings, paths or waterfall.
 async function prototype(path,fit='height'){const data=await gltf.loadAsync(new URL(path,base).href);data.scene.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(data.scene),s=bb.getSize(new THREE.Vector3()),c=bb.getCenter(new THREE.Vector3()),scale=1/(fit==='height'?s.y:Math.max(s.x,s.y,s.z)),parts=[];data.scene.traverse(o=>{if(o.isMesh){const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);g.translate(-c.x,-bb.min.y,-c.z);g.scale(scale,scale,scale);const mats=(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.clone());for(const m of mats){materials.add(m);if(m.map){m.map.colorSpace=THREE.SRGBColorSpace;textures.add(m.map);}}parts.push({g,m:Array.isArray(o.material)?mats:mats[0]});}});return parts;}
 const trees=[[],[],[],[]];for(let i=0;i<8500&&placements.filter(p=>p.type==='tree').length<235;i++){const x=(rng()-.5)*213,z=(rng()-.5)*187,y=field.height(x,z);if(y<7||field.slope(x,z)>.47||field.nearPath(x,z).d<5.4||excluded(x,z,4)||field.points.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+2))continue;if(placements.some(p=>Math.hypot(x-p.x,z-p.z)<3.8))continue;const h=5.8+rng()*5.7,k=Math.floor(rng()*4),p={type:'tree',x,y,z,s:[h,h,h],rot:rng()*6.28};trees[k].push(p);placements.push(p);addCollider(R.ColliderDesc.cylinder(h*.3,.3).setTranslation(x,y+h*.3,z));}
 const treeJobs=['Tree_1_A','Tree_2_A','Tree_3_B','Tree_4_A'].map(async(n,k)=>{try{const parts=await prototype(`kaykit_nature/${n}_Color1.gltf`);if(disposed)return;for(const p of parts)instances(p.g,p.m,trees[k],n);assets.trees+=trees[k].length;}catch(e){assets.errors.push(n+': '+e.message);}});
 const stones=[];for(let i=0;i<1500&&stones.length<70;i++){const x=(rng()-.5)*218,z=(rng()-.5)*192,y=field.height(x,z);if(y<4||field.slope(x,z)>.55||field.nearPath(x,z).d<5||excluded(x,z,3)||field.points.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+1))continue;const s=.7+rng()*1.8;stones.push({x,y,z,s:[s,s*.8,s],rot:rng()*6.28});placements.push({type:'rock',x,y,z});addCollider(R.ColliderDesc.ball(s*.43).setTranslation(x,y+s*.3,z));}
 const stoneJob=prototype('kaykit_nature/Rock_1_A_Color1.gltf','max').then(parts=>{if(disposed)return;for(const p of parts)instances(p.g,p.m,stones,'Existing KayKit rocks');assets.rocks=stones.length;}).catch(e=>assets.errors.push('Rock: '+e.message));
 const grass=[],shrubs=[],pebbles=[],flowers=[],blades=[];for(let i=0;i<6;i++){const a=i/6*Math.PI*2,x=Math.cos(a)*.14,z=Math.sin(a)*.14;blades.push(x-.1,0,z,x+.1,0,z,x+Math.cos(a)*.18,.5+i%3*.12,z+Math.sin(a)*.18);}
 const grassG=new THREE.BufferGeometry();grassG.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));grassG.computeVertexNormals();const grassMat=mat('#ffffff',{side:THREE.DoubleSide});
 const oldGrass=grassMat.onBeforeCompile;grassMat.onBeforeCompile=function(shader,renderer){oldGrass?.call(this,shader,renderer);shader.uniforms.auroraGrassTime=waterClock;shader.vertexShader='uniform float auroraGrassTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 #ifdef USE_INSTANCING
 transformed.x+=sin(auroraGrassTime*1.7+instanceMatrix[3].x*.13+instanceMatrix[3].z*.12)*position.y*position.y*.13;
 #endif
 `);};grassMat.customProgramCacheKey=()=> 'aurora-v3-grass';
 for(let i=0;i<7500&&grass.length<1550;i++){const x=(rng()-.5)*219,z=(rng()-.5)*193,y=field.height(x,z);if(y<7||field.slope(x,z)>.58||field.nearPath(x,z).d<3.3||excluded(x,z,2)||field.points.some(p=>Math.hypot(x-p.x,z-p.z)<p.r*.8))continue;const s=.45+rng()*.4;grass.push({x,y,z,s:[s,s,s],rot:rng()*6.28,color:rng()<.22?'#a3b873':'#698c4d'});if(i%9===0)shrubs.push({x,y:y+.1,z,s:[s,s*.5,s],rot:rng()*6.28});if(i%5===0)flowers.push({x,y:y+.2,z,s:[.12,.12,.12],color:rng()<.7?'#e8dca8':'#b2a2c8'});}
 instances(grassG,grassMat,grass,'Meadow tufts',false);instances(new THREE.IcosahedronGeometry(1,1),moss,shrubs,'Low undergrowth',false);instances(new THREE.IcosahedronGeometry(1,0),mat('#ffffff'),flowers,'Small wildflowers',false);
 for(let i=0;i<2200&&pebbles.length<250;i++){const x=(rng()-.5)*224,z=(rng()-.5)*205,y=field.height(x,z);if(y<2.8||y>6.6||field.slope(x,z)>.5||field.nearPath(x,z).d<2.6||excluded(x,z,1))continue;const s=.1+rng()*.17;pebbles.push({x,y:y+.035,z,s:[s,s*.5,s*1.3],rot:rng()*6.28});}instances(new THREE.IcosahedronGeometry(1,0),sandMat,pebbles,'Shore pebbles',false);
 root.updateMatrixWorld(true);const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),origin=new THREE.Vector3();ray.firstHitOnly=true;
 const api={root,field,collide,assets,placementPoints:placements,spawn:{x:-43,y:field.height(-43,66)+2.3,z:66},radius:145,offset:{x:0,z:0},data:{name:'바람의 유적섬 · 기존 에셋 v3',objs:[]},_allObjs:[root],qualityVersion:'aurora-v3b-native-assets',detailStats:{grass:grass.length,undergrowth:shrubs.length,beachStones:pebbles.length,cliffSolids:cliffs.length},addTrimesh,
 groundAt(x,z,fromY=5000){const start=Number.isFinite(fromY)?fromY:5000,h=field.height(x,z);let y=h<=start+.001?h:-8;origin.set(x,start,z);ray.set(origin,down);ray.far=Math.max(0,start+12);const hit=ray.intersectObjects(walkSurfaces,true)[0];if(hit)y=Math.max(y,hit.point.y);return y;},
 placeOnGround(o,x,z,{offset=0,fromY=5000}={}){o.position.set(x,api.groundAt(x,z,fromY)+offset,z);return o;},
 dispose(){if(disposed)return;disposed=true;ctx.offUpdate?.(updateHook);for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();for(const g of geometries){g.disposeBoundsTree?.();g.dispose();}for(const m of materials)if(Array.isArray(m))m.forEach(x=>x.dispose());else m.dispose();for(const t of textures)t.dispose();if(ctx.terrain===api)delete ctx.terrain;}};
 ctx.terrain=api;updateHook=ctx.onUpdate(dt=>{if(disposed)return;elapsed+=dt;for(const f of updaters)f(elapsed);});
 api.ready=Promise.all([...buildingJobs,...treeJobs,stoneJob]).then(async()=>{if(disposed)return;root.updateMatrixWorld(true);
  const byMat=new Map();for(const o of batches){if(!o.visible||o.material.visible===false)continue;if(!byMat.has(o.material))byMat.set(o.material,[]);byMat.get(o.material).push(o);}for(const[m,objects]of byMat){if(objects.length<3)continue;const gs=objects.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(gs,false);gs.forEach(g=>g.dispose());if(g){objects.forEach(o=>o.visible=false);mesh(g,m,0,0,0,[1,1,1],false,false).name='Batched static island dressing';}}
  try{const bvh=await import('three-mesh-bvh');if(disposed)return;if(!THREE.BufferGeometry.prototype.computeBoundsTree){THREE.BufferGeometry.prototype.computeBoundsTree=bvh.computeBoundsTree;THREE.BufferGeometry.prototype.disposeBoundsTree=bvh.disposeBoundsTree;}THREE.Mesh.prototype.raycast=bvh.acceleratedRaycast;for(const o of collide){if(o.isInstancedMesh)continue;o.traverse(m=>{if(m.isMesh&&m.geometry?.attributes?.position?.count>=96&&!m.geometry.boundsTree)m.geometry.computeBoundsTree();});}api.bvh=true;}catch(e){api.bvh=false;assets.errors.push('BVH: '+e.message);}root.updateMatrixWorld(true);return api;
 });
 return api;
}
