/** Windgate 07 visual correction pass, based on real WebGL captures.
 * No native controller patches. New solid geological surfaces use the terrain adapter.
 */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {SUMMIT,BUILDINGS,BASINS,fallAxes,axisDistance,basinRadius} from './aurora-refuge-field.js';
const rndFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const NOISE=`
float rHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float rNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(rHash(i),rHash(i+vec2(1.,0.)),f.x),mix(rHash(i+vec2(0.,1.)),rHash(i+1.),f.x),f.y);}
float rFbm(vec2 p){return .57*rNoise(p)+.29*rNoise(p*2.03+7.)+.14*rNoise(p*4.1-5.);}
`;
export function polishRefuge(ctx,island){
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
 island.portal.U.uGlow.value.set('#57b8c5');island.portal.U.uDeep.value.set('#102242');island.portal.setOpen(.95);
 // Compact static batching preserves the original collision proxies.
 root.updateMatrixWorld(true);const groups=new Map();for(const o of staticMeshes){if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(o);}for(const [m,os]of groups){if(os.length<2)continue;const temp=os.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(temp,false);temp.forEach(g=>g.dispose());if(g){os.forEach(o=>o.visible=false);gs.add(g);const o=new THREE.Mesh(g,m);o.name='Batched integrated geology';o.castShadow=o.receiveShadow=true;root.add(o);}}
 const hook=ctx.onUpdate(()=>{sky.position.copy(ctx.camera.position);distant.position.copy(ctx.water.mesh.position);});
 const prev=island.dispose;let disposed=false;island.dispose=()=>{if(disposed)return;disposed=true;ctx.offUpdate(hook);root.removeFromParent();gs.forEach(g=>{g.disposeBoundsTree?.();g.dispose();});ms.forEach(m=>m.dispose());prev();};
 for(const o of island.collide)if(!o.isInstancedMesh)o.traverse(m=>{if(m.isMesh&&m.geometry?.attributes.position?.count>=96&&m.geometry.computeBoundsTree&&!m.geometry.boundsTree)m.geometry.computeBoundsTree();});
 island.polishStats={cliffWedges:placed.length,rootedLeaves:leaves.length,offshoreStacks:5,distantWater:'native material',nativePortalShader:true};
 return island.polishStats;
}
