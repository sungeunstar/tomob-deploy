/** Windgate 07 visual correction pass, based on real WebGL captures.
 * No native controller patches. New solid geological surfaces use the terrain adapter.
 */
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {SUMMIT,BUILDINGS,BASINS,fallAxes,axisDistance,basinRadius} from './aurora-refuge-field-v14.js';
const rndFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const NOISE=`
float rHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float rNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(rHash(i),rHash(i+vec2(1.,0.)),f.x),mix(rHash(i+vec2(0.,1.)),rHash(i+1.),f.x),f.y);}
float rFbm(vec2 p){return .57*rNoise(p)+.29*rNoise(p*2.03+7.)+.14*rNoise(p*4.1-5.);}
`;
export async function polishRefuge(ctx,island){
 const rng=rndFor(270927),field=island.field,root=new THREE.Group(),gs=new Set(),ms=new Set(),staticMeshes=[];root.name='Windgate / cliff integration and atmosphere';island.root.add(root);
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,...o});ms.add(m);return m;};
 const cliffMat=mat('#8c9b8c',{flatShading:true}),rootMat=mat('#5b513c'),leafMat=mat('#60774a',{side:THREE.DoubleSide});
 function add(g,m,x,y,z,solid=false,batch=true){gs.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;root.add(o);if(solid)island.addTrimesh(o);if(batch)staticMeshes.push(o);return o;}
 // Fragment-level stratum colour crosses the smooth base mesh and its large buttresses.
 function surface(m){const old=m.onBeforeCompile;m.onBeforeCompile=function(s,r){old?.call(this,s,r);s.vertexShader='varying vec3 rWorld; varying vec3 rNormal;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>',`rWorld=(modelMatrix*vec4(transformed,1.)).xyz;rNormal=normalize(mat3(modelMatrix)*normal);
#include <project_vertex>
`);s.fragmentShader='varying vec3 rWorld; varying vec3 rNormal;\n'+NOISE+'\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
float rSteep=1.-smoothstep(.50,.83,abs(normalize(rNormal).y));
float rBroad=rFbm(rWorld.xz*.105+rWorld.y*.018);
float rStrata=.5+.5*sin(rWorld.y*1.1+rFbm(rWorld.xz*.15)*5.0);
float rFine=rFbm(vec2(rWorld.x+rWorld.z*.35,rWorld.y)*1.9);
diffuseColor.rgb*=mix(.80+.34*rBroad,.72+.18*rBroad+.05*rStrata+.13*rFine,rSteep);
float rDeep=1.-smoothstep(-80.,-5.,rWorld.y);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.024,.075,.078),rDeep);
`);};m.customProgramCacheKey=()=> 'windgate07-integrated-strata';m.needsUpdate=true;}
 surface(cliffMat);const land=island.root.getObjectByName('Sculpted terrain / visual and physics SSOT');if(land)surface(land.material);
 // Ivy is attached to masonry rather than a chain of rock-shaped dots in the air.
 const oldIvy=island.root.getObjectByName('Ivy on ancient stone');if(oldIvy)oldIvy.visible=false;
 const leafG=new THREE.BufferGeometry();leafG.setAttribute('position',new THREE.Float32BufferAttribute([0,.20,0,-.14,.04,.01,-.10,-.13,0,0,.20,0,-.10,-.13,0,.10,-.12,.01,0,.20,0,.10,-.12,.01,.16,.06,0],3));leafG.computeVertexNormals();gs.add(leafG);
 const leaves=[],cx=SUMMIT.x,cz=SUMMIT.z,py=SUMMIT.y;
 for(const side of[-1,1]){
  const pts=[[cx+side*6.1,py+.7,cz+2.1],[cx+side*4.05,py+1.7,cz+.78],[cx+side*3.83,py+3.5,cz+.76],[cx+side*3.48,py+5.2,cz+.75],[cx+side*3.35,py+6.4,cz+.72]].map(p=>new THREE.Vector3(...p));
  const curve=new THREE.CatmullRomCurve3(pts);add(new THREE.TubeGeometry(curve,28,.05,5,false),rootMat,0,0,0);
  for(let i=0;i<62;i++){const p=curve.getPoint(.15+rng()*.85);p.x+=(rng()-.5)*.45;p.z+=.035+rng()*.1;leaves.push({p,s:.65+rng()*.7,rz:(rng()-.5)*2.3,ry:(rng()-.5)*.8});}
 }
 const ivy=new THREE.InstancedMesh(leafG,leafMat,leaves.length),dummy=new THREE.Object3D();leaves.forEach((v,i)=>{dummy.position.copy(v.p);dummy.rotation.set((rng()-.5)*.6,v.ry,v.rz);dummy.scale.setScalar(v.s);dummy.updateMatrix();ivy.setMatrixAt(i,dummy.matrix);});ivy.computeBoundingSphere();ivy.receiveShadow=true;ivy.name='Ivy rooted in the actual arch';root.add(ivy);
 // Broad fractured wedges overlap the cliff, rather than decorating it with pebbles.
 const slabG=new THREE.CylinderGeometry(1,.98,1,7,4,false),sp=slabG.attributes.position;
 for(let i=0;i<sp.count;i++){const x=sp.getX(i),y=sp.getY(i),z=sp.getZ(i),q=1+.11*Math.sin(y*18+x*3+z*2);sp.setXYZ(i,x*q,y+.025*Math.sin(x*5+z*7),z*q);}slabG.computeVertexNormals();gs.add(slabG);
 const views=[[-64,108,3,-84],[-62,34,-79,-23],[45,-42,3,-84]],placed=[];
 for(let i=0;i<8000&&placed.length<132;i++){
  const x=(rng()-.5)*284,z=(rng()-.5)*286,y=field.height(x,z),sl=field.slope(x,z);
  if(y<8||sl<1.1||field.nearPath(x,z).d<11||BUILDINGS.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+6)||views.some(v=>axisDistance(v,x,z).d<8)||BASINS.some(b=>basinRadius(b,x,z)<1.03)||fallAxes.some(a=>axisDistance(a,x,z).d<a[6]*.5+3)||placed.some(p=>Math.hypot(p.x-x,p.z-z)<5))continue;
  const dx=field.height(x+1,z)-field.height(x-1,z),dz=field.height(x,z+1)-field.height(x,z-1),h=6+rng()*9,w=3.6+rng()*3.8;
  const o=add(slabG,cliffMat,x,y-h*.32,z);o.scale.set(w,h,2.5+rng()*2.4);o.rotation.y=Math.atan2(dx,dz)+(rng()-.5)*.14;o.rotation.z=(rng()-.5)*.13;o.updateMatrixWorld(true);island.addTrimesh(o);placed.push({x,z});
 }
 // The large old rock's exposed edges share weathering but not the same perfect outline.
 const columnG=new THREE.CylinderGeometry(.10,1.35,1,7,4,false);gs.add(columnG);
 for(const [x,z,h,w]of[[-240,-140,36,12],[-260,64,19,9],[245,102,24,11],[217,-196,41,14],[-178,209,16,7]]){const o=add(columnG,cliffMat,x,-4+h*.5,z);o.scale.set(w,h,w*.73);o.rotation.y=rng()*6.28;}
 // Complete the distant ocean around the native detailed 3000m mesh; no surface over ponds.
 const pos=[],ix=[];function rect(x0,x1,z0,z1,nx,nz){const start=pos.length/3;for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++)pos.push(x0+(x1-x0)*i/nx,0,z0+(z1-z0)*j/nz);for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const k=start+j*(nx+1)+i;ix.push(k,k+nx+1,k+1,k+1,k+nx+1,k+nx+2);}}
 rect(-7500,7500,-7500,-1500,36,20);rect(-7500,7500,1500,7500,36,20);rect(-7500,-1500,-1500,1500,20,12);rect(1500,7500,-1500,1500,20,12);
 const og=new THREE.BufferGeometry();og.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));og.setIndex(ix);og.computeVertexNormals();gs.add(og);const distant=new THREE.Mesh(og,ctx.water.mat);distant.name='Native ocean / distant continuation';distant.renderOrder=-2;root.add(distant);
 const floorG=new THREE.CircleGeometry(7200,72).rotateX(-Math.PI/2),floor=add(floorG,mat('#244b4d'),0,-85.1,0,false,false);floor.castShadow=false;
 // An atmospheric sky, not a flat clear-colour background. No postprocessing pass.
 const skyM=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{t:ctx.water.mat.uniforms.uTime,top:{value:new THREE.Color('#729cb2')},horizon:{value:new THREE.Color('#b9cecc')}},vertexShader:'varying vec3 skyDir;void main(){skyDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:NOISE+`uniform float t;uniform vec3 top,horizon;varying vec3 skyDir;void main(){vec3 d=normalize(skyDir);float h=clamp(d.y,0.,1.);vec3 c=mix(horizon,top,pow(h,.5));vec2 q=d.xz/max(.19,d.y+.19);float n=rFbm(q*2.1+vec2(t*.0016,0.));float clouds=smoothstep(.55,.76,n)*smoothstep(.015,.12,d.y)*(1.-smoothstep(.65,.95,d.y));c=mix(c,vec3(.88,.91,.88),clouds*.65);gl_FragColor=vec4(c,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});ms.add(skyM);const skyG=new THREE.SphereGeometry(7000,32,18);gs.add(skyG);const sky=new THREE.Mesh(skyG,skyM);sky.name='Refuge sky atmosphere';sky.renderOrder=-100;sky.frustumCulled=false;root.add(sky);
 // Native portal shaders unchanged; restrain the sample's overexposed glow only.
 island.portal.U.uGlow.value.set('#4fa3af');island.portal.U.uDeep.value.set('#102242');island.portal.setOpen(.95);

 // Phase 4: rework the shrine back route as a natural wind-cleft, not an exposed artificial tunnel.
 const passStone=mat('#859186',{flatShading:true}),passDark=mat('#5f685f',{flatShading:true}),passFloor=mat('#746c61',{flatShading:true});
 const passRock=new THREE.DodecahedronGeometry(1,0); gs.add(passRock);
 function addPassRock(x,y,z,sx,sy,sz,ry=0,solid=true){const o=add(passRock,passStone,x,y,z,solid,false);o.scale.set(sx,sy,sz);o.rotation.y=ry;return o;}
 function carveNaturalCleft(){
   const pts=[
    new THREE.Vector3(SUMMIT.x+6.3,field.height(SUMMIT.x+6.3,SUMMIT.z+5.0)+.10,SUMMIT.z+4.8),
    new THREE.Vector3(SUMMIT.x+8.4,field.height(SUMMIT.x+8.4,SUMMIT.z+8.0)+.06,SUMMIT.z+8.3),
    new THREE.Vector3(SUMMIT.x+10.2,field.height(SUMMIT.x+10.2,SUMMIT.z+11.2)+.04,SUMMIT.z+11.8),
    new THREE.Vector3(SUMMIT.x+9.1,field.height(SUMMIT.x+9.1,SUMMIT.z+14.8)+.06,SUMMIT.z+15.4),
    new THREE.Vector3(SUMMIT.x+6.8,field.height(SUMMIT.x+6.8,SUMMIT.z+18.0)+.08,SUMMIT.z+18.8),
    new THREE.Vector3(SUMMIT.x+4.7,field.height(SUMMIT.x+4.7,SUMMIT.z+21.8)+.10,SUMMIT.z+22.8)
   ];
   const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal');
   const floor=[],uv=[],ix=[]; let row=0;
   for(let i=0;i<=38;i++){
     const t=i/38,p=curve.getPoint(t),n=curve.getTangent(Math.min(.999,t+.01));
     const side=new THREE.Vector3(-n.z,0,n.x).normalize();
     const half=1.55+.18*Math.sin(t*Math.PI*2.0)+.10*Math.sin(t*Math.PI*5.0);
     const lip=.18+.06*Math.sin(t*Math.PI*3.0);
     const left=p.clone().addScaledVector(side,-half), right=p.clone().addScaledVector(side,half);
     floor.push(left.x,p.y+lip,left.z,right.x,p.y-lip*.4,right.z); uv.push(0,t*5.5,1,t*5.5);
     if(i<38){const k=row*2; ix.push(k,k+1,k+2,k+1,k+3,k+2);} row++;
     const cliffInset=half+.55;
     for(const sign of[-1,1]){
       const base=p.clone().addScaledVector(side,sign*cliffInset);
       addPassRock(base.x,p.y+.55,base.z,1.2,1.9+.25*Math.sin(t*6+sign),1.45,.4+t+sign*.15,true);
       addPassRock(base.x+side.x*sign*.25,p.y+1.7,base.z+side.z*sign*.25,1.55,1.15,1.35,.9+t*1.2,true);
       addPassRock(base.x+side.x*sign*.45,p.y+2.55,base.z+side.z*sign*.45,1.35,1.0,1.15,.5+t*1.4,true);
     }
     if(i>3 && i<35){
       const close=0.75+.18*Math.sin(t*Math.PI*4.0);
       const roofY=p.y+3.08+.18*Math.sin(t*8.0);
       addPassRock(p.x,p.y+2.95,p.z,1.65,0.48,1.55,.8+t,true);
       addPassRock(p.x+side.x*close,roofY,p.z+side.z*close,1.18,.62,1.12,.3+t,true);
       addPassRock(p.x-side.x*close,roofY-.08,p.z-side.z*close,1.18,.60,1.14,.8+t,true);
     }
   }
   const fg=new THREE.BufferGeometry(); fg.setAttribute('position',new THREE.Float32BufferAttribute(floor,3)); fg.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); fg.setIndex(ix); fg.computeVertexNormals(); gs.add(fg);
   const path=add(fg,passFloor,0,0,0,true,false); path.name='Shrine rear wind-cleft floor';
   // entrance / exit shaping: irregular natural lips, never a free-floating arch.
   const ends=[pts[0],pts[pts.length-1]];
   ends.forEach((p,idx)=>{
     const dir=curve.getTangent(idx?.97:.03),side=new THREE.Vector3(-dir.z,0,dir.x).normalize();
     for(const sign of[-1,1]) addPassRock(p.x+side.x*sign*2.0,p.y+1.1,p.z+side.z*sign*2.0,1.6,2.1,1.5,.4+sign*.1,true);
     addPassRock(p.x,p.y+2.95,p.z,2.4,.72,1.7,.3,true);
     addPassRock(p.x+dir.x*1.3,p.y+1.2,p.z+dir.z*1.3,1.8,1.0,1.35,.8,true);
     for(let i=0;i<4;i++) addPassRock(p.x+(rng()-.5)*2.8,p.y+.12,p.z+(rng()-.5)*2.4,.38+rng()*.45,.18+rng()*.28,.34+rng()*.42,rng()*6.28,false);
   });
   // collapsed old trail hints, not a clean engineered corridor.
   for(const t of[.22,.48,.74]){const p=curve.getPoint(t),n=curve.getTangent(Math.min(.999,t+.01)),side=new THREE.Vector3(-n.z,0,n.x).normalize();
     const slab=add(new THREE.BoxGeometry(1.18,.10,.72),passDark,p.x+side.x*.15,p.y+.08,p.z+side.z*.12,true,false); slab.rotation.y=Math.atan2(n.x,n.z)+(.05*Math.sin(t*20));
     if(t!==.48){const slab2=add(new THREE.BoxGeometry(.92,.10,.58),passDark,p.x-side.x*.48,p.y+.16,p.z-side.z*.44,true,false); slab2.rotation.y=Math.atan2(n.x,n.z)-.08;}
   }
   // extra seam cloaking around the outside lips.
   for(const [x,z] of [[SUMMIT.x+6.4,SUMMIT.z+5.2],[SUMMIT.x+4.9,SUMMIT.z+22.7],[SUMMIT.x+8.7,SUMMIT.z+12.1]]){
     const y=field.height(x,z);
     for(let i=0;i<5;i++){
       const ox=(rng()-.5)*1.4, oz=(rng()-.5)*1.4;
       const rr=add(new THREE.DodecahedronGeometry(.22+rng()*.28,0),cliffMat,x+ox,y+.08+rng()*.1,z+oz,true,false); rr.scale.set(1,.74+rng()*.18,1);
     }
   }
 }
 carveNaturalCleft();
// Soften obvious route edges with shrubs and wayfinding stakes around awkward openings.
 const shrubG=new THREE.IcosahedronGeometry(1,0); gs.add(shrubG); const shrubM=mat('#6f8b57');
 for(const [x,z] of [[-58,30],[-101,7],[37,2],[59,13],[31,-28],[SUMMIT.x+6,SUMMIT.z+5],[SUMMIT.x+5,SUMMIT.z+22],[SUMMIT.x+9,SUMMIT.z+13]]){const y=field.height(x,z); for(let i=0;i<3;i++){const ox=(rng()-.5)*1.8,oz=(rng()-.5)*1.8; const o=add(shrubG,shrubM,x+ox,y+.35,z+oz,false,false); o.scale.set(.35+rng()*.35,.28+rng()*.22,.35+rng()*.35);} }

 // Phase 2: route-specific softening so branch points feel discovered, not editor-stamped.
 const markerStone=mat('#9d9584',{flatShading:true}), stakeWood=mat('#6d5941'), clothTag=mat('#8e7755',{side:THREE.DoubleSide});
 function brokenSteps(points,width=1.45){
   for(let i=0;i<points.length-1;i++){
     const [x0,z0]=points[i], [x1,z1]=points[i+1];
     const dx=x1-x0,dz=z1-z0,len=Math.hypot(dx,dz)||1,steps=Math.max(3,Math.ceil(len/1.6));
     for(let j=0;j<steps;j++){
       const t=(j+.5)/steps, x=x0+dx*t, z=z0+dz*t, y=field.height(x,z)+.05, ang=Math.atan2(dx,dz);
       const slab=add(new THREE.BoxGeometry(width*(.7+.18*Math.sin(j)),.16,.88+.12*Math.cos(j)), markerStone,x,y,z,true,false);
       slab.rotation.y=ang+(.08*Math.sin(j*1.7));
       slab.rotation.z=(rng()-.5)*.05;
       if(j%3===0){const side=(j%2?1:-1); const peb=add(new THREE.DodecahedronGeometry(.28,0),cliffMat,x+Math.cos(ang+Math.PI/2)*side*1.1,y+.06,z+Math.sin(ang+Math.PI/2)*side*1.1,true,false); peb.scale.set(1,.55,1.1);}
     }
   }
 }
 function routeMarker(x,z,dir=0,kind='stakes'){
   const y=field.height(x,z);
   if(kind==='stakes' || kind==='all'){
     for(const off of[-.55,.55]){const sx=x+Math.cos(dir+Math.PI/2)*off, sz=z+Math.sin(dir+Math.PI/2)*off; const sy=field.height(sx,sz); const stake=add(new THREE.CylinderGeometry(.04,.05,1.22,5),stakeWood,sx,sy+.58,sz,true,false); stake.rotation.z=(rng()-.5)*.12;}
     const rail=add(new THREE.BoxGeometry(1.35,.08,.12),stakeWood,x,y+1.0,z,false,false); rail.rotation.y=dir; rail.rotation.z=.06;
   }
   if(kind==='cloth' || kind==='all'){
     const tag=add(new THREE.PlaneGeometry(.22,.36,2,4),clothTag,x+.14,y+1.02,z+.08,false,true); tag.rotation.y=dir+.35;
   }
   for(let i=0;i<4;i++){const r=.45+rng()*.45,a=rng()*Math.PI*2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r,py=field.height(px,pz)+.12; const cairn=add(new THREE.DodecahedronGeometry(.18+.05*i,0),markerStone,px,py,pz,true,false); cairn.scale.set(1,.7,1);}  
 }
 // Broken remnant steps at the harbor rise, falls approach, and the old sanctuary branch.
 brokenSteps([[-70,98],[-63,90],[-57,82]],1.55);
 brokenSteps([[-84,2],[-77,-8],[-73,-19]],1.34);
 brokenSteps([[31,-28],[35,-35],[39,-42]],1.28);
 // Small route markers to guide but not over-explain the spaces.
 routeMarker(-61,78,-.72,'all');
 routeMarker(-80,-12,-.88,'stakes');
 routeMarker(42,-45,.12,'cloth');
 routeMarker(SUMMIT.x+9,SUMMIT.z+21,.42,'all');
 // Transition rubble around path/terrain seams to kill hard edges.
 const seamCoords=[[-65,87],[-58,31],[-96,6],[36,1],[57,13],[28,-26],[-79,-5],[SUMMIT.x+6,SUMMIT.z+5],[SUMMIT.x+9,SUMMIT.z+12],[SUMMIT.x+5,SUMMIT.z+22]];
 for(const [x,z] of seamCoords){const y=field.height(x,z); for(let i=0;i<5;i++){const ox=(rng()-.5)*1.9,oz=(rng()-.5)*1.9; const r=add(new THREE.DodecahedronGeometry(.22+rng()*.26,0),cliffMat,x+ox,y+.06+rng()*.1,z+oz,true,false); r.scale.set(1,.72+rng()*.2,1); if(i<2){const s=add(shrubG,shrubM,x+ox*.7,y+.23,z+oz*.7,false,false); s.scale.set(.24+rng()*.2,.18+rng()*.15,.24+rng()*.2);} }}

 // Phase 3b: use the game's actual mine-kit instead of hand-built placeholder tunnel geometry.
 const KIT=new URL('../mine-kit/',import.meta.url).href,kitLoader=new FBXLoader(),kitTexLoader=new THREE.TextureLoader(),kitTextures=new Set(),kitCache=new Map();
 const KIT_FILES={t1:'Models/Base/Tunnel1.fbx',t2:'Models/Base/Tunnel2.fbx',t3:'Models/Base/Tunnel3.fbx',turnL:'Models/Base/TurnL.fbx',support1:'Models/Props/Support1.fbx',support2:'Models/Props/Support2.fbx',lantern:'Models/Props/Lantern.fbx',crate:'Models/Props/Crate.fbx',planks:'Models/Props/Planks.fbx',ore:'Models/Rocks/Ore.fbx',rock1:'Models/Rocks/Rock1.fbx',rock2:'Models/Rocks/Rock2.fbx'};
 async function kitTexture(path,srgb=true){const t=await kitTexLoader.loadAsync(new URL(path,KIT).href);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;kitTextures.add(t);return t;}
 const [stoneMap,stoneN,woodMap,woodN,crateMap,crateN,lanternMap,lanternN,rockMap,rockN]=await Promise.all([
  kitTexture('Models/Base/Materials/Stone_AlbedoSmoothness.png'),kitTexture('Models/Base/Materials/Stone_Normal.png',false),
  kitTexture('Models/Props/Materials/Wood_AlbedoSmoothness.png'),kitTexture('Models/Props/Materials/Wood_Normal.png',false),
  kitTexture('Models/Props/Materials/Crate_Albedo.png'),kitTexture('Models/Props/Materials/Crate_Normal.png',false),
  kitTexture('Models/Props/Materials/Lantern_AlbedoTransparency.png'),kitTexture('Models/Props/Materials/Lantern_Normal.png',false),
  kitTexture('Models/Rocks/Materials/Rock1_AlbedoSmoothness.png'),kitTexture('Models/Rocks/Materials/Rock1_Normal.png',false)
 ]);
 const kitMats={stone:mat('#dedbd0',{map:stoneMap,normalMap:stoneN,roughness:.92}),wood:mat('#e7d5b9',{map:woodMap,normalMap:woodN,roughness:.9}),crate:mat('#e0c5a7',{map:crateMap,normalMap:crateN,roughness:.88}),lantern:mat('#fff1d0',{map:lanternMap,normalMap:lanternN,transparent:true,alphaTest:.12,roughness:.72}),rock:mat('#d3d0c4',{map:rockMap,normalMap:rockN,roughness:.9})};
 async function loadKit(key){if(!kitCache.has(key)){const raw=await kitLoader.loadAsync(new URL(KIT_FILES[key],KIT).href);raw.scale.setScalar(.01);raw.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(raw),c=bb.getCenter(new THREE.Vector3());raw.position.x-=c.x;raw.position.z-=c.z;raw.position.y-=bb.min.y;raw.updateMatrixWorld(true);kitCache.set(key,raw);}return kitCache.get(key).clone(true);}
 async function placeKit(key,x,z,yaw=0,type='stone',solid=true,scale=1){const o=await loadKit(key);o.name='mine-kit/'+key;o.position.set(x,field.height(x,z),z);o.rotation.y=yaw;o.scale.multiplyScalar(scale);root.add(o);o.updateMatrixWorld(true);o.traverse(m=>{if(m.isMesh){m.material=kitMats[type]||kitMats.stone;m.castShadow=m.receiveShadow=true;if(solid)island.addTrimesh(m);}});return o;}
 const mineB=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48,yaw:.55},minePoint=field.points.find(p=>p.id==='cave')||{x:-97,z:-34};
 const dx=mineB.x-minePoint.x,dz=mineB.z-minePoint.z,dl=Math.hypot(dx,dz)||1,forward=new THREE.Vector2(dx/dl,dz/dl),mineYaw=Math.atan2(forward.x,forward.y),side=new THREE.Vector2(-forward.y,forward.x),oreNodes=[];
 const segments=[{key:'t1',d:2.2,yaw:mineYaw},{key:'t2',d:8.5,yaw:mineYaw},{key:'turnL',d:14.0,yaw:mineYaw},{key:'t3',d:19.0,yaw:mineYaw+.58},{key:'t2',d:25.0,yaw:mineYaw+.58}];
 for(let i=0;i<segments.length;i++){const q=segments[i],turn=i>=3?.58:0,v=new THREE.Vector2(Math.sin(mineYaw+turn),Math.cos(mineYaw+turn)),bendBase=i>=3?new THREE.Vector2(mineB.x+forward.x*14,mineB.z+forward.y*14):new THREE.Vector2(mineB.x,mineB.z),localD=i>=3?q.d-14:q.d,x=i>=3?bendBase.x+v.x*localD:mineB.x+forward.x*q.d,z=i>=3?bendBase.y+v.y*localD:mineB.z+forward.y*q.d;await placeKit(q.key,x,z,q.yaw,'stone',true,1);if(i!==2)await placeKit(i%2?'support2':'support1',x,z,q.yaw,'wood',true,1);if(i===1||i===3){const lx=x+Math.cos(q.yaw)*2.0,lz=z-Math.sin(q.yaw)*2.0;await placeKit('lantern',lx,lz,q.yaw,'lantern',false,.92);const light=new THREE.PointLight('#ffc27a',8.5,13,1.8);light.position.set(lx,field.height(lx,lz)+2.45,lz);root.add(light);}}
 const oreTypes=[['철광석',0x6b7686,.65,.38],['구리',0xc16a38,.82,.34],['코발트',0x2f55d4,.55,.28],['석탄',0x282a2d,.08,.72],['금',0xe6b73a,.92,.24]];
 async function placeOre(name,color,metalness,roughness,x,z,yaw=0,scale=1){const o=await loadKit('ore');o.position.set(x,field.height(x,z)+.03,z);o.rotation.y=yaw;o.scale.multiplyScalar(scale);o.name='mine ore / '+name;o.userData.ore=name;root.add(o);o.updateMatrixWorld(true);const oreMat=mat(color,{map:rockMap,normalMap:rockN,metalness,roughness,flatShading:true,emissive:new THREE.Color(color).multiplyScalar(.09),emissiveIntensity:.16});o.traverse(m=>{if(m.isMesh){m.material=oreMat;m.castShadow=m.receiveShadow=true;m.userData.ore=name;}});oreNodes.push(o);return o;}
 const oreStations=[{d:7.6,s:1,type:0,side:1},{d:10.2,s:.9,type:1,side:-1},{d:17.2,s:1.05,type:2,side:1},{d:20.4,s:.82,type:3,side:-1},{d:23.5,s:.9,type:4,side:1}];
 for(const q of oreStations){const turn=q.d>14?.58:0,v=new THREE.Vector2(Math.sin(mineYaw+turn),Math.cos(mineYaw+turn)),base=q.d>14?new THREE.Vector2(mineB.x+forward.x*14,mineB.z+forward.y*14):new THREE.Vector2(mineB.x,mineB.z),dd=q.d>14?q.d-14:q.d,sx=-v.y,sz=v.x,x=base.x+v.x*dd+sx*q.side*2.15,z=base.y+v.y*dd+sz*q.side*2.15,t=oreTypes[q.type];await placeOre(t[0],t[1],t[2],t[3],x,z,mineYaw+turn+rng()*.7,q.s);}
 for(const [key,ox,oz,yaw,scale] of [['crate',-3.6,-2.8,.2,.95],['crate',-4.4,-1.5,-.3,.78],['planks',3.1,-2.2,.55,1],['rock1',3.4,1.2,.1,1.1],['rock2',-3.3,1.8,-.3,.9]]){const x=mineB.x+side.x*ox-forward.x*oz,z=mineB.z+side.y*ox-forward.y*oz;await placeKit(key,x,z,mineYaw+yaw,key==='crate'?'crate':key==='planks'?'wood':'rock',key.startsWith('rock'),scale);}
 const rearStart=new THREE.Vector2(mineB.x+forward.x*14,mineB.z+forward.y*14),rearDir=new THREE.Vector2(Math.sin(mineYaw+.58),Math.cos(mineYaw+.58));
 for(let i=0;i<9;i++){const d=27+i*1.2,x=rearStart.x+rearDir.x*(d-14),z=rearStart.y+rearDir.y*(d-14),y=field.height(x,z)+.05,slab=add(new THREE.BoxGeometry(1.35,.11,.72),markerStone,x,y,z,true,false);slab.rotation.y=mineYaw+.58+.04*Math.sin(i);if(i%3===0){const c=add(new THREE.DodecahedronGeometry(.23,0),markerStone,x+side.x*.72,y+.11,z+side.y*.72,true,false);c.scale.set(1,.7,1);}}
 for(const [ox,oz] of [[-3.1,1.4],[3.0,1.6],[-2.7,-2.4],[2.6,-2.0]]){const x=mineB.x+side.x*ox+forward.x*oz,z=mineB.z+side.y*ox+forward.y*oz,y=field.height(x,z),rr=add(new THREE.DodecahedronGeometry(.45,0),cliffMat,x,y+.15,z,true,false);rr.scale.set(1.25,.78,1.1);const sh=add(shrubG,shrubM,x+side.x*.35,y+.22,z+side.y*.35,false,false);sh.scale.set(.3,.22,.32);}
 island.mineOreNodes=oreNodes;island.mineKit={segments:segments.length,oreNodes:oreNodes.length,usesNativeAssets:true,facade:'building_mine_blue.fbx'};

// Compact static batching preserves the original collision proxies.
 root.updateMatrixWorld(true);const groups=new Map();for(const o of staticMeshes){if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(o);}for(const [m,os]of groups){if(os.length<2)continue;const temp=os.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(temp,false);temp.forEach(g=>g.dispose());if(g){os.forEach(o=>o.visible=false);gs.add(g);const o=new THREE.Mesh(g,m);o.name='Batched integrated geology';o.castShadow=o.receiveShadow=true;root.add(o);}}
 const hook=ctx.onUpdate(()=>{sky.position.copy(ctx.camera.position);distant.position.copy(ctx.water.mesh.position);});
 const prev=island.dispose;let disposed=false;island.dispose=()=>{if(disposed)return;disposed=true;ctx.offUpdate(hook);root.removeFromParent();gs.forEach(g=>{g.disposeBoundsTree?.();g.dispose();});ms.forEach(m=>m.dispose());kitTextures.forEach(t=>t.dispose());prev();};
 for(const o of island.collide)if(!o.isInstancedMesh)o.traverse(m=>{if(m.isMesh&&m.geometry?.attributes.position?.count>=96&&m.geometry.computeBoundsTree&&!m.geometry.boundsTree)m.geometry.computeBoundsTree();});
 island.polishStats={cliffWedges:placed.length,rootedLeaves:leaves.length,offshoreStacks:5,distantWater:'native material',nativePortalShader:true,phase2Softening:true,minePass:true,mineOre:true,cleftRework:true,nativeMineKit:true};
 return island.polishStats;
}