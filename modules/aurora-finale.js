/** TOMOB island study 04. Native assets, native portal, native water materials.
 * Additive sample: call before initPlayer on a fresh ctx. No economy/save writes.
 * Existing field/routes are retained; all new scene/physics resources have owners.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createIslandField } from './aurora-island.js';
import { createPortal } from './portalfx.js';

const SIZE=284, N=200, POND=8.03;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const random=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const HX='KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/blue/';
export const BUILDINGS=[
 {id:'mine',file:'building_mine_blue.fbx',name:'돌산 광산',x:69,z:11,size:22,previous:14,r:12.6,yaw:0},
 {id:'harbor',file:'building_tavern_blue.fbx',name:'선착장 선술집',x:-66,z:62,size:19.2,previous:12,r:11.7,yaw:.2},
 {id:'home',file:'building_home_A_blue.fbx',name:'항구의 집',x:-17,z:64,size:14.1,previous:8.8,r:8.8,yaw:-.3},
 {id:'mill',file:'building_watermill_blue.fbx',name:'계곡 물방앗간',x:-77,z:18,size:17.6,previous:11,r:10.4,yaw:-Math.PI/2},
 {id:'workshop',file:'building_blacksmith_blue.fbx',name:'광산 작업장',x:90,z:31,size:15.2,previous:9.5,r:8.7,yaw:-.5},
 {id:'lookout',file:'building_tower_A_blue.fbx',name:'동쪽 망루',x:77,z:-33,size:18,previous:12,r:8.5,yaw:0}
];

/** In-place height edits preserve the original triangle-interpolated field.height. */
export function planTerrain(field){
 const buildings=BUILDINGS.map(b=>({...b,y:field.height(b.x,b.z)}));
 const sourceY=Math.max(21,Math.min(30,field.height(-42,-29))),middleY=14.6;
 for(let iz=0;iz<=N;iz++)for(let ix=0;ix<=N;ix++){
  const i=iz*(N+1)+ix,x=(ix/N-.5)*SIZE,z=(iz/N-.5)*SIZE;let h=field.heights[i];
  for(const b of buildings){const d=Math.hypot(x-b.x,z-b.z);h+=(b.y-h)*(1-smooth(b.r*.82,b.r+3,d));}
  const px=Math.max(0,Math.abs(x+9)-12),pz=Math.max(0,Math.abs(z+40)-12);
  h+=(46-h)*(1-smooth(0,4,Math.hypot(px,pz)));
  const a=Math.hypot((x+42)/6.7,(z+29)/5.2);
  h+=(sourceY-.85-h)*(1-smooth(.64,1.1,a));
  const m=Math.hypot((x+45)/5.5,(z+19)/4.7);
  h+=(middleY-.85-h)*(1-smooth(.64,1.15,m));
  if(z>=-27&&z<=-11){
   const t=clamp((z+27)/16),cx=-42-6*t,width=2.4+.5*t;
   let bed=z< -24?sourceY-.35:z< -21?sourceY+(middleY-sourceY)*smooth(-24,-21,z)-.3:z< -17?middleY-.4:middleY+(POND-middleY)*smooth(-17,-12,z)-.35;
   h+=(bed-h)*(1-smooth(width,width+1.8,Math.abs(x-cx)));
  }
  field.heights[i]=h;
 }
 const points=[
  {id:'landing',name:'옛 부두',x:-48,z:82,r:6},
  {id:'harbor',name:'선착장 선술집',x:-50,z:62,r:6},
  {id:'falls',name:'두 단 폭포와 구름다리',x:-32,z:4,r:6},
  {id:'mill',name:'계곡 물방앗간',x:-63,z:18,r:6},
  {id:'grove',name:'고요한 숲의 제단',x:-3,z:16,r:6},
  {id:'cave',name:'돌산 광산',x:66,z:29,r:6},
  {id:'lookout',name:'동쪽 망루',x:76,z:-20,r:6},
  {id:'shrine',name:'바람의 차원문',x:-9,z:-27,r:8},
  {id:'cove',name:'숨겨진 조개 만',x:67,z:66,r:6}
 ].map(p=>({...p,y:field.height(p.x,p.z)}));
 field.points=points;
 return {buildings,sourceY,middleY};
}

function layeredRock(){
 const sides=8,levels=[-1,-.55,-.08,.46,.83,1],radii=[.75,.96,.94,1,.83,.56],p=[],idx=[];
 for(let k=0;k<levels.length;k++)for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2,r=radii[k]*(1+.06*Math.sin(j*4.6+k*.7));p.push(Math.cos(a)*r,levels[k]+.025*Math.sin(j*2.8),Math.sin(a)*r);}
 for(let k=0;k<levels.length-1;k++)for(let j=0;j<sides;j++){const a=k*sides+j,b=k*sides+(j+1)%sides,c=a+sides,d=b+sides;idx.push(a,c,b,b,c,d);}
 for(let j=1;j<sides-1;j++){idx.push(0,j,j+1);const b=(levels.length-1)*sides;idx.push(b,b+j+1,b+j);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return g;
}

export async function initAuroraFinale(ctx,options={}){
 if(!ctx.scene||!ctx.world||!ctx.RAPIER||!ctx.water?.mat?.uniforms)throw new Error('Initialize native core, physics and water before Aurora 04.');
 if(ctx.terrain)throw new Error('Aurora 04 requires a fresh terrain context.');
 const {scene,world,RAPIER:R}=ctx,root=new THREE.Group(),rng=random(92725);
 const field=createIslandField(),plan=planTerrain(field),base=options.assetRoot||new URL('../',import.meta.url).href;
 const ownedG=new Set(),ownedM=new Set(),ownedT=new Set(),colliders=[],collide=[],supports=[],batch=[],animations=[],cleanups=[];
 const assets={trees:0,rocks:0,buildings:[],dock:null,portal:'modules/portalfx.js:createPortal',errors:[]};
 const waterRegions=[];let disposed=false,time=0,hook=null;
 root.name='TOMOB — 바람의 차원문 섬 04';scene.add(root);
 const url=p=>new URL(p,base).href;
 const material=(c,extra={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.93,...extra});ownedM.add(m);return m;};
 const wood=material('#8b7151'),darkwood=material('#554737'),stone=material('#a5ad9e'),darkstone=material('#76877e'),moss=material('#607d47'),gold=material('#b79b63',{metalness:.28,roughness:.55});
 const cube=new THREE.BoxGeometry(1,1,1),rockG=layeredRock();ownedG.add(cube);ownedG.add(rockG);
 function fixed(desc){const c=world.createCollider(desc.setFriction(.9));colliders.push(c);return c;}
 function addTrimesh(o,walk=true){
  o.updateWorldMatrix(true,false);const p=o.geometry.attributes.position,v=new Float32Array(p.count*3),tmp=new THREE.Vector3();
  for(let i=0;i<p.count;i++){tmp.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);v.set([tmp.x,tmp.y,tmp.z],i*3);}
  const idx=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);
  fixed(R.ColliderDesc.trimesh(v,idx));collide.push(o);if(walk)supports.push(o);return o;
 }
 function mesh(g,m,x=0,y=0,z=0,s=[1,1,1],solid=false,batching=true){
  ownedG.add(g);ownedM.add(m);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.castShadow=o.receiveShadow=true;root.add(o);
  if(solid)addTrimesh(o);if(batching&&!m.transparent&&!m.isShaderMaterial)batch.push(o);return o;
 }
 const box=(x,y,z,s,m=wood,solid=false)=>mesh(cube,m,x,y,z,s,solid);
 function beam(a,b,r=.08,m=darkwood){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),o=mesh(new THREE.CylinderGeometry(r,r,d.length(),6),m,...av.add(bv).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
 function instances(g,m,items,name,shadow=true){
  if(!items.length)return null;ownedG.add(g);ownedM.add(m);const im=new THREE.InstancedMesh(g,m,items.length),o=new THREE.Object3D();
  items.forEach((p,i)=>{o.position.set(p.x,p.y,p.z);o.rotation.set(p.rx||0,p.rot||0,p.rz||0);o.scale.set(...p.s);o.updateMatrix();im.setMatrixAt(i,o.matrix);if(p.color)im.setColorAt(i,new THREE.Color(p.color));});
  im.instanceMatrix.needsUpdate=true;im.computeBoundingSphere();im.castShadow=shadow;im.receiveShadow=true;im.name=name;root.add(im);return im;
 }
 const p=[],colors=[],uv=[],indices=[],grass=new THREE.Color('#7d9d59'),lit=new THREE.Color('#a5b876'),sand=new THREE.Color('#ddd0a6'),rock=new THREE.Color('#9ca69b'),path=new THREE.Color('#c3b187');
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,y=field.heights[k],c=grass.clone().lerp(lit,(.5+.25*(Math.sin(x*.12+z*.17)+Math.cos(z*.1-x*.05)))*.52);
  c.lerp(sand,1-smooth(4.6,7,y));c.lerp(rock,smooth(.5,1.3,field.slope(x,z))*.88);c.lerp(path,(1-smooth(1.7,2.85,field.paths[k]))*.84);
  p.push(x,y,z);colors.push(c.r,c.g,c.b);uv.push(i/N,j/N);if(i<N&&j<N)indices.push(k,k+N+1,k+1,k+1,k+N+1,k+N+2);
 }
 const landG=new THREE.BufferGeometry();landG.setAttribute('position',new THREE.Float32BufferAttribute(p,3));landG.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));landG.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));landG.setIndex(indices);landG.computeVertexNormals();
 const grainData=new Uint8Array(128*128);for(let i=0;i<grainData.length;i++)grainData[i]=108+rng()*40;
 const grain=new THREE.DataTexture(grainData,128,128,THREE.RedFormat);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(65,65);grain.needsUpdate=true;ownedT.add(grain);
 const land=mesh(landG,material('#ffffff',{vertexColors:true,bumpMap:grain,bumpScale:.055}),0,0,0,[1,1,1],false,false);land.name='Aurora shared terrain';addTrimesh(land,false);
 const excluded=(x,z,pad=0)=>plan.buildings.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+pad)||Math.hypot(x+49,z-1)<24||Math.hypot(x+44,z+24)<12||Math.hypot(x+9,z+40)<19;
 const cliffs=[];for(let n=0;n<3500&&cliffs.length<155;n++){const x=(rng()-.5)*224,z=(rng()-.5)*206,y=field.height(x,z);if(y<8||field.slope(x,z)<.75||field.nearPath(x,z).d<7||excluded(x,z,3))continue;cliffs.push({x,y:y-2.5,z,s:[2+rng()*2.7,3.4+rng()*3,2+rng()*2],rot:rng()*6.28});}
 const cliff=instances(rockG,darkstone,cliffs,'Stratified cliff faces');
 if(cliff){const matrix=new THREE.Matrix4(),a=rockG.attributes.position,v=new THREE.Vector3();for(let i=0;i<cliff.count;i++){cliff.getMatrixAt(i,matrix);const pts=new Float32Array(a.count*3);for(let k=0;k<a.count;k++){v.fromBufferAttribute(a,k).applyMatrix4(matrix);pts.set(v.toArray(),k*3);}const d=R.ColliderDesc.convexHull(pts);if(d)fixed(d);}collide.push(cliff);supports.push(cliff);}
 const bridgeY=x=>11.25-.65*Math.sin(clamp((x+64)/34)*Math.PI),bp=[],bi=[];
 for(let i=0;i<=68;i++){const x=-64+i*.5,y=bridgeY(x);bp.push(x,y,1.7,x,y,6.3);if(i<68){const k=i*2;bi.push(k,k+1,k+2,k+1,k+3,k+2);box(x+.23,y-.1,4,[.45,.2,4.7],i%5?wood:darkwood);}}
 const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(bp,3));bg.setIndex(bi);bg.computeVertexNormals();const invisible=material('#ffffff');invisible.visible=false;mesh(bg,invisible,0,0,0,[1,1,1],true,false);
 for(const z of[1.8,6.2])for(let i=0;i<=10;i++){const x=-64+i*3.4,y=bridgeY(x);beam([x,y,z],[x,y+1.12,z]);if(i<10)beam([x,y+1,z],[x+3.4,bridgeY(x+3.4)+1,z],.04);}
 for(let i=0;i<3;i++)box(-9,46.1+i*.16,-41,[18-i*1.1,.2,15-i*.85],stone,true);
 for(const x of[-13.5,-4.5])for(let i=0;i<5;i++){box(x,46.55+.52+i*1.04,-42,[1.55,1,2],i%3?stone:darkstone,true);}
 for(let i=0;i<=14;i++){const a=i/14*Math.PI,o=box(-9+4.5*Math.cos(a),51.75+4.5*Math.sin(a),-42,[1.06,1.65,2],stone);o.rotation.z=a-Math.PI/2;addTrimesh(o);}
 for(const [x,z,h]of[[-18,-36,3.9],[1,-37,2.9],[-19,-49,2.1],[2,-48,4.6]]){
  mesh(new THREE.CylinderGeometry(.48,.68,h,7),stone,x,46+h/2,z,[1,1,1],true);box(x,46+h,z,[1.5,.3,1.5],stone);
 }
 const ruinRubble=[];for(let i=0;i<32;i++){const a=rng()*Math.PI*2,r=9+rng()*3;ruinRubble.push({x:-9+Math.cos(a)*r,y:46.4,z:-42+Math.sin(a)*r,s:[.3+rng()*.4,.16+rng()*.3,.3+rng()*.5],rot:rng()*6.28});}instances(rockG,darkstone,ruinRubble,'Weathered ruins');
 const portal=createPortal({w:7.05,h:8.4,shape:2.5,glow:0x65ddd0,deep:0x173862,light:true});
 portal.group.name='Native TOMOB portal / portalfx.js';portal.group.position.set(-9,50.75,-41.92);root.add(portal.group);portal.setOpen(1);animations.push(dt=>portal.update(dt));cleanups.push(()=>portal.dispose());
 const ay=field.height(-3,16);mesh(new THREE.CylinderGeometry(2.7,3.1,.35,8),stone,-3,ay+.17,16,[1,1,1],true);
 for(let i=0;i<4;i++){const a=i*Math.PI/2;mesh(new THREE.CylinderGeometry(.22,.3,1.4,6),stone,-3+Math.sin(a)*2.4,ay+.8,16+Math.cos(a)*2.4);}
 // Same native shader/maps/time; do not initialize a second ocean.
 const nativeMat=ctx.water.mat,U=nativeMat.uniforms,oldWaterHeight=ctx.water.heightAt;
 function poolMaterial(){const m=new THREE.ShaderMaterial({vertexShader:nativeMat.vertexShader,fragmentShader:nativeMat.fragmentShader,uniforms:{...U,uSwell:{value:0},uWaveAmp:{value:0},uGerstner:{value:0},uWaveN:{value:8},uFoam:{value:.12},uStreak:{value:.04},uWakeArea:{value:new THREE.Vector4(0,0,0,0)}},transparent:true,depthWrite:false,side:THREE.DoubleSide});ownedM.add(m);return m;}
 const pondMaterial=poolMaterial();
 function pond(cx,cz,level,maxR,name){
  const vertices=[cx,level,cz],idx=[],outline=[];
  for(let i=0;i<=96;i++){const a=i/96*Math.PI*2;let r=.5;for(;r<maxR;r+=.15)if(field.height(cx+Math.cos(a)*r,cz+Math.sin(a)*r)>=level-.09)break;r=Math.max(.45,r-.08);const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;vertices.push(x,level,z);outline.push({x,z});if(i<96)idx.push(0,i+2,i+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(idx);g.computeVertexNormals();const o=mesh(g,pondMaterial,0,0,0,[1,1,1],false,false);o.name=name;o.castShadow=o.receiveShadow=false;o.renderOrder=0;
  const contains=(x,z)=>{let inside=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if(((a.z>z)!==(b.z>z))&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;};
  waterRegions.push({name,level,contains});return o;
 }
 pond(-49,1,POND,25,'Woodland lagoon — native water.js material');pond(-42,-29,plan.sourceY,7,'Spring pool — native water.js material');pond(-45,-19,plan.middleY,6,'Cascade shelf — native water.js material');
 ctx.water.heightAt=(x,z)=>{for(const r of waterRegions)if(r.contains(x,z))return r.level;return oldWaterHeight.call(ctx.water,x,z);};
 cleanups.push(()=>{ctx.water.heightAt=oldWaterHeight;});
 // Falling flow uses the same normal maps and palette, with gravity-aligned UVs.
 const fallMat=new THREE.ShaderMaterial({uniforms:{uTime:U.uTime,uNormA:U.uNormA,uNormB:U.uNormB,uShallow:U.uShallow,uDeep:U.uDeep,uSun:U.uSun},side:THREE.DoubleSide,transparent:true,depthWrite:false,
 vertexShader:`varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`uniform float uTime;uniform sampler2D uNormA,uNormB;uniform vec3 uShallow,uDeep,uSun;varying vec2 vU;
 void main(){vec2 q=vec2(vU.x*1.7,vU.y*3.3-uTime*.32);vec3 a=texture2D(uNormA,q).rgb;vec3 b=texture2D(uNormB,q*1.83+vec2(.2,-uTime*.13)).rgb;float n=clamp(a.x*.6+b.y*.4,0.,1.);float edge=smoothstep(0.,.11,vU.x)*(1.-smoothstep(.86,1.,vU.x));float air=smoothstep(.34,.78,n);float fall=smoothstep(.06,.35,vU.y);float broken=smoothstep(.16,.3,n+.17);vec3 c=mix(uDeep,uShallow,.7);c=mix(c,vec3(.81,.92,.89),air*.6+fall*.2);gl_FragColor=vec4(c,edge*broken*(.58+.3*air));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});ownedM.add(fallMat);
 function flow(points,width,name){const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal'),p=[],u=[],idx=[],steps=80;
  for(let i=0;i<=steps;i++){const t=i/steps,v=curve.getPoint(t),d=curve.getTangent(t),side=new THREE.Vector3(-d.z,0,d.x).normalize();if(side.lengthSq()<.01)side.set(1,0,0);const w=width*(.94+.08*Math.sin(t*21)+.05*Math.sin(t*47));for(const s of[-1,1]){const q=v.clone().addScaledVector(side,s*w*.5);p.push(q.x,q.y,q.z);u.push((s+1)/2,t);}if(i<steps){const k=i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));g.setIndex(idx);g.computeVertexNormals();const m=mesh(g,fallMat,0,0,0,[1,1,1],false,false);m.name=name;m.castShadow=false;return m;
 }
 flow([[-42,plan.sourceY,-27],[-42.4,plan.sourceY-.2,-24.3],[-43.2,plan.sourceY-1.4,-23.1],[-44,plan.middleY+2,-21.8],[-45,plan.middleY+.05,-20.5]],3.2,'Upper broken cascade');
 flow([[-45,plan.middleY,-17],[-45.6,plan.middleY-.4,-16.1],[-46.4,plan.middleY-2,-15],[-47.6,POND+1.1,-12.6],[-48,POND+.06,-11]],3.65,'Lower broken cascade');
 for(const [x,z]of[[-42,-26],[-43,-23],[-44.8,-20],[-45.5,-16],[-47,-13]])for(const side of[-1,1]){const xx=x+side*(2.4+rng()*.5);mesh(rockG,darkstone,xx,field.height(xx,z)-.25,z,[1.4,2.1,1.5],true);}
 const sprayMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{t:U.uTime},vertexShader:`uniform float t;attribute float seed;varying float a;void main(){vec3 p=position;float f=fract(seed+t*.23);p.y+=sin(f*3.14159)*1.1;p.x+=sin(seed*17.)*f*.8;a=sin(f*3.14159)*.24;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=min(32.,110./max(1.,-mv.z));}`,fragmentShader:`varying float a;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.85,.95,.91,a*(1.-smoothstep(.05,1.,d)));}`});ownedM.add(sprayMat);
 const sp=[],se=[];for(const [x,y,z]of[[-45,plan.middleY,-20.5],[-48,POND,-11]])for(let i=0;i<45;i++){sp.push(x+(rng()-.5)*4,y+.15,z+(rng()-.5)*2);se.push(rng());}const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));sg.setAttribute('seed',new THREE.Float32BufferAttribute(se,1));ownedG.add(sg);root.add(new THREE.Points(sg,sprayMat));
 let finishAtlas;const atlasReady=new Promise(resolve=>{finishAtlas=resolve;});
 const atlasURL=url(HX+'hexagons_medieval.png'),atlas=new THREE.TextureLoader().load(atlasURL,()=>finishAtlas(),undefined,e=>{assets.errors.push('Building atlas load failed');finishAtlas();});atlas.colorSpace=THREE.SRGBColorSpace;atlas.flipY=true;ownedT.add(atlas);
 const buildingMat=material('#ffffff',{map:atlas});const manager=new THREE.LoadingManager();manager.setURLModifier(u=>/\.(png|jpe?g)(\?|$)/i.test(u)?atlasURL:u);const fbx=new FBXLoader(manager);fbx.setResourcePath(url(HX));const gltf=new GLTFLoader();
 async function building(b){try{const raw=await fbx.loadAsync(url(HX+b.file));if(disposed)return;raw.updateMatrixWorld(true);let bb=new THREE.Box3().setFromObject(raw),sz=bb.getSize(new THREE.Vector3());raw.scale.multiplyScalar(b.size/Math.max(sz.x,sz.y,sz.z));raw.updateMatrixWorld(true);bb.setFromObject(raw);const c=bb.getCenter(new THREE.Vector3());raw.position.set(-c.x,-bb.min.y,-c.z);const holder=new THREE.Group();holder.add(raw);holder.position.set(b.x,b.y,b.z);holder.rotation.y=b.yaw;holder.name=b.name;holder.userData.nativeAsset=HX+b.file;root.add(holder);holder.updateMatrixWorld(true);raw.traverse(o=>{if(!o.isMesh)return;ownedG.add(o.geometry);o.material=buildingMat;o.castShadow=o.receiveShadow=true;addTrimesh(o);});bb.setFromObject(holder);assets.buildings.push({id:b.id,file:b.file,scaleVsV3:+(b.size/b.previous).toFixed(2),dimensions:bb.getSize(new THREE.Vector3()).toArray().map(n=>+n.toFixed(2)),position:[b.x,b.y,b.z]});}catch(e){assets.errors.push(b.id+': '+e.message);}}
 const jobs=[atlasReady,...plan.buildings.map(building)];
 async function dock(){try{
  const raw=await new OBJLoader().loadAsync(url('the-wharf/source/model/Untitled 1.obj'));if(disposed)return;
  const tl=new THREE.TextureLoader(),tex=async(f,srgb)=>{const t=await tl.loadAsync(url('the-wharf/textures/'+f));if(srgb)t.colorSpace=THREE.SRGBColorSpace;ownedT.add(t);return t;};
  const [wm,wn,tm,tn]=await Promise.all([tex('Untitled_1_Mat_1_BaseColor.png',true),tex('Untitled_1_Mat_1_Normal.png',false),tex('Car_Tire_BaseColor.png',true),tex('Car_Tire_Normal.png',false)]);if(disposed)return;
  const mats=[material('#ffffff',{map:wm,normalMap:wn,roughness:.88,side:THREE.DoubleSide}),material('#ffffff',{map:tm,normalMap:tn,roughness:.95,side:THREE.DoubleSide})];
  raw.traverse(o=>{if(o.isMesh){o.material=mats[/tire/i.test(o.name)?1:0];o.castShadow=o.receiveShadow=true;ownedG.add(o.geometry);}});
  raw.updateMatrixWorld(true);let bb=new THREE.Box3().setFromObject(raw),s=bb.getSize(new THREE.Vector3());if(s.x>s.z)raw.rotation.y=Math.PI/2;raw.scale.setScalar(42/Math.max(s.x,s.z));raw.updateMatrixWorld(true);bb.setFromObject(raw);s=bb.getSize(new THREE.Vector3());const c=bb.getCenter(new THREE.Vector3());raw.position.set(-c.x,-bb.min.y,-c.z);
  const holder=new THREE.Group();holder.name='Native the-wharf / 42m';holder.add(raw);holder.position.set(-48,4.85-s.y*.98,108);root.add(holder);holder.updateMatrixWorld(true);raw.traverse(o=>{if(o.isMesh)addTrimesh(o);});
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let anchor=null;
  for(const dz of[-16,-12,-8,-4,0]){for(const dx of[0,-3,3,-6,6]){ray.set(new THREE.Vector3(-48+dx,30,108+dz),down);const hit=ray.intersectObject(holder,true)[0];if(hit&&hit.point.y>2&&hit.point.y<7){anchor=hit.point.clone();break;}}if(anchor)break;}
  if(!anchor)throw new Error('Native wharf deck anchor not found; do not assume a walkable deck.');
  const start=new THREE.Vector3(-48,field.height(-48,83)+.08,83),end=anchor.clone();end.y+=.03;const direction=end.clone().sub(start),side=new THREE.Vector3(-direction.z,0,direction.x).normalize().multiplyScalar(2.05),verts=[];
  for(const q of[start,end])for(const sign of[-1,1])verts.push(...q.clone().addScaledVector(side,sign).toArray());
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));g.setIndex([0,1,2,1,3,2]);g.computeVertexNormals();const ramp=mesh(g,mats[0],0,0,0,[1,1,1],true,false);ramp.name='Shore to native wharf access ramp';
  for(let i=0;i<=7;i++){const q=start.clone().lerp(end,i/7);for(const sign of[-1,1]){const x=q.clone().addScaledVector(side,sign);beam(x.toArray(),x.clone().add(new THREE.Vector3(0,.95,0)).toArray(),.065);}}
  assets.dock={file:'the-wharf/source/model/Untitled 1.obj',span:42,anchor:anchor.toArray(),deckTop:4.85,bottom:holder.position.y};field.points.push({id:'dock',name:'옛 부두 갑판',x:anchor.x,z:anchor.z,y:anchor.y,r:4});
 }catch(e){assets.errors.push('Dock: '+e.message);}}
 jobs.push(dock());
 async function prototype(file,fit='height'){
  const data=await gltf.loadAsync(url(file));data.scene.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(data.scene),s=bb.getSize(new THREE.Vector3()),c=bb.getCenter(new THREE.Vector3()),scale=1/(fit==='height'?s.y:Math.max(s.x,s.y,s.z)),parts=[];
  data.scene.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);g.translate(-c.x,-bb.min.y,-c.z);g.scale(scale,scale,scale);ownedG.add(g);const ms=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const a=m.clone();ownedM.add(a);for(const t of Object.values(a))if(t?.isTexture)ownedT.add(t);return a;});parts.push({g,m:Array.isArray(o.material)?ms:ms[0]});});return parts;
 }
 const placements=[],trees=[[],[],[],[]];
 for(let i=0;i<9500&&placements.length<235;i++){const x=(rng()-.5)*213,z=(rng()-.5)*187,y=field.height(x,z);if(y<7||field.slope(x,z)>.47||field.nearPath(x,z).d<5.4||excluded(x,z,4)||field.points.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+2)||placements.some(p=>Math.hypot(x-p.x,z-p.z)<3.8))continue;const h=5.8+rng()*5.7,k=Math.floor(rng()*4),p={type:'tree',x,y,z,s:[h,h,h],rot:rng()*6.28};trees[k].push(p);placements.push(p);fixed(R.ColliderDesc.cylinder(h*.3,.3).setTranslation(x,y+h*.3,z));}
 ['Tree_1_A','Tree_2_A','Tree_3_B','Tree_4_A'].forEach((n,k)=>jobs.push(prototype('kaykit_nature/'+n+'_Color1.gltf').then(parts=>{if(disposed)return;for(const p of parts)instances(p.g,p.m,trees[k],n);assets.trees+=trees[k].length;}).catch(e=>assets.errors.push(n+': '+e.message))));
 const stones=[];for(let i=0;i<1700&&stones.length<65;i++){const x=(rng()-.5)*214,z=(rng()-.5)*188,y=field.height(x,z);if(y<4||field.slope(x,z)>.55||field.nearPath(x,z).d<5||excluded(x,z,3)||field.points.some(p=>Math.hypot(x-p.x,z-p.z)<p.r+1))continue;const s=.7+rng()*1.8;stones.push({x,y,z,s:[s,s*.8,s],rot:rng()*6.28});placements.push({type:'rock',x,y,z});fixed(R.ColliderDesc.ball(s*.43).setTranslation(x,y+s*.3,z));}
 jobs.push(prototype('kaykit_nature/Rock_1_A_Color1.gltf','max').then(parts=>{if(disposed)return;for(const p of parts)instances(p.g,p.m,stones,'Existing harvest rock models');assets.rocks=stones.length;}).catch(e=>assets.errors.push('Rock: '+e.message)));
 const blades=[],tufts=[],flowers=[],shrubs=[];for(let i=0;i<5;i++){const a=i*Math.PI*2/5,x=Math.cos(a)*.12,z=Math.sin(a)*.12;blades.push(x-.07,0,z,x+.07,0,z,x+.14,.45+i%3*.09,z+.09);}
 for(let i=0;i<6500&&tufts.length<1500;i++){const x=(rng()-.5)*216,z=(rng()-.5)*190,y=field.height(x,z);if(y<7||field.slope(x,z)>.55||field.nearPath(x,z).d<3.2||excluded(x,z,2))continue;const s=.55+rng()*.4;tufts.push({x,y,z,s:[s,s,s],rot:rng()*6.28,color:rng()<.25?'#a7b977':'#688b4d'});if(i%8===0)shrubs.push({x,y:y+.15,z,s:[s*.7,s*.35,s*.65],rot:rng()*6.28});if(i%4===0)flowers.push({x,y:y+.17,z,s:[.11,.11,.11],color:rng()<.65?'#e4d6a2':'#b5a6cf'});}
 const tg=new THREE.BufferGeometry();tg.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));tg.computeVertexNormals();const gm=material('#ffffff',{side:THREE.DoubleSide}),prior=gm.onBeforeCompile;
 gm.onBeforeCompile=function(shader,renderer){prior?.call(this,shader,renderer);shader.uniforms.auroraTime=U.uTime;shader.vertexShader='uniform float auroraTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x+=sin(auroraTime*1.7+instanceMatrix[3].x*.13+instanceMatrix[3].z*.12)*position.y*position.y*.13;\n#endif\n');};gm.customProgramCacheKey=()=> 'aurora04-grass';
 instances(tg,gm,tufts,'Wind meadow',false);instances(new THREE.IcosahedronGeometry(1,0),moss,shrubs,'Low ferns',false);instances(new THREE.IcosahedronGeometry(1,0),material('#ffffff'),flowers,'Small wildflowers',false);
 const pebbles=[];for(let i=0;i<2200&&pebbles.length<240;i++){const x=(rng()-.5)*224,z=(rng()-.5)*205,y=field.height(x,z);if(y<2.2||y>6.4||field.nearPath(x,z).d<2.5||excluded(x,z,1))continue;const s=.08+rng()*.2;pebbles.push({x,y:y+.035,z,s:[s,s*.5,s*1.3],rot:rng()*6.28});}instances(new THREE.IcosahedronGeometry(1,0),material('#c7bea7'),pebbles,'Tide stones',false);
 const treasure=field.points.find(p=>p.id==='cove');box(treasure.x,treasure.y+.4,treasure.z,[1.4,.8,.9],wood,true);box(treasure.x,treasure.y+.85,treasure.z,[1.45,.12,.95],gold);
 const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0);ray.firstHitOnly=true;
 const api={root,field,collide,assets,plan,portal,waterRegions,waterProof:{sharedClock:pondMaterial.uniforms.uTime===U.uTime,sameVertexShader:pondMaterial.vertexShader===nativeMat.vertexShader,sameFragmentShader:pondMaterial.fragmentShader===nativeMat.fragmentShader,sharedNormals:pondMaterial.uniforms.uNormA===U.uNormA,cascadeSharedNormals:fallMat.uniforms.uNormA===U.uNormA},placementPoints:placements,spawn:{x:-43,y:field.height(-43,66)+2.3,z:66},radius:145,offset:{x:0,z:0},data:{name:'바람의 차원문 섬 · 04',objs:[]},_allObjs:[root],qualityVersion:'aurora-v4-native-portal-water-wharf',detailStats:{grass:tufts.length,cliffs:cliffs.length,shoreStones:pebbles.length},addTrimesh,
 groundAt(x,z,fromY=5000){const top=Number.isFinite(fromY)?fromY:5000,h=field.height(x,z);let y=h<=top+.001?h:-8;origin.set(x,top,z);ray.set(origin,down);ray.far=Math.max(0,top+12);const hit=ray.intersectObjects(supports,true)[0];if(hit)y=Math.max(y,hit.point.y);return y;},
 dispose(){if(disposed)return;disposed=true;ctx.offUpdate?.(hook);for(const fn of cleanups)try{fn();}catch{}for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();for(const g of ownedG){g.disposeBoundsTree?.();g.dispose();}for(const m of ownedM)if(Array.isArray(m))m.forEach(a=>a.dispose());else m.dispose();for(const t of ownedT)t.dispose();if(ctx.terrain===api)delete ctx.terrain;}};
 ctx.terrain=api;hook=ctx.onUpdate(dt=>{if(disposed)return;time+=dt;for(const fn of animations)fn(dt,time);});
 api.ready=Promise.all(jobs).then(async()=>{
  if(disposed)return api;root.updateMatrixWorld(true);const byMat=new Map();for(const o of batch){if(o.material.visible===false)continue;if(!byMat.has(o.material))byMat.set(o.material,[]);byMat.get(o.material).push(o);}
  for(const [m,objects]of byMat){if(objects.length<3)continue;const gs=objects.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(gs,false);gs.forEach(g=>g.dispose());if(g){objects.forEach(o=>o.visible=false);mesh(g,m,0,0,0,[1,1,1],false,false).name='Batched static masonry / bridge';}}
  try{const bvh=await import('three-mesh-bvh');if(disposed)return api;if(!THREE.BufferGeometry.prototype.computeBoundsTree){THREE.BufferGeometry.prototype.computeBoundsTree=bvh.computeBoundsTree;THREE.BufferGeometry.prototype.disposeBoundsTree=bvh.disposeBoundsTree;}THREE.Mesh.prototype.raycast=bvh.acceleratedRaycast;for(const o of collide)if(!o.isInstancedMesh)o.traverse(m=>{if(m.isMesh&&m.geometry?.attributes.position?.count>=96&&!m.geometry.boundsTree)m.geometry.computeBoundsTree();});api.bvh=true;}catch(e){assets.errors.push('BVH: '+e.message);}
  root.updateMatrixWorld(true);return api;
 });
 return api;
}
