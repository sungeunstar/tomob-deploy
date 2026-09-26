/** Aurora 05 — art pass, not a new game controller.
 * Native field/routes, player, physics, portal and asset catalogue are retained.
 * Every visible bank is part of the collidable terrain; water polygons are clipped
 * against that SAME triangle-interpolated field. No floating pond discs.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createIslandField } from './aurora-island.js';
import { createPortal } from './portalfx.js';
const SIZE=284,N=200;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const random=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const HX='KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/blue/';
export const BUILDINGS=[
 {id:'mine',file:'building_mine_blue.fbx',name:'돌산 광산',x:69,z:11,size:19.36,old:22,r:11.7,yaw:0},
 {id:'harbor',file:'building_tavern_blue.fbx',name:'선착장 선술집',x:-66,z:62,size:17.09,old:19.2,r:10.8,yaw:.2},
 {id:'home',file:'building_home_A_blue.fbx',name:'항구의 집',x:-17,z:64,size:12.55,old:14.1,r:8.4,yaw:-.3},
 {id:'mill',file:'building_watermill_blue.fbx',name:'계곡 물방앗간',x:-77,z:20,size:15.66,old:17.6,r:9.7,yaw:-Math.PI/2},
 {id:'workshop',file:'building_blacksmith_blue.fbx',name:'광산 작업장',x:88,z:31,size:13.07,old:15.2,r:8.2,yaw:-.5},
 {id:'lookout',file:'building_tower_A_blue.fbx',name:'동쪽 망루',x:77,z:-33,size:16.02,old:18,r:8,yaw:0}
];
export const BASINS=[
 {id:'source',x:-43,z:-34,rx:8.7,rz:6.3,level:27,depth:2.4,spillZ:-28},
 {id:'shelf',x:-45,z:-21,rx:6.5,rz:4.6,level:15.2,depth:1.9,spillZ:-17},
 {id:'lagoon',x:-50,z:.5,rx:16.3,rz:17.8,level:7.9,depth:3.1}
];
function basinRadius(b,x,z){const a=Math.atan2((z-b.z)/b.rz,(x-b.x)/b.rx);return Math.hypot((x-b.x)/b.rx,(z-b.z)/b.rz)/(1+.065*Math.sin(3*a+.7)+.035*Math.cos(7*a));}
const fallAxes=[[-43,-28,-45,-24,27,15.2,3.8],[-45,-17,-49,-12,15.2,7.9,4.6]];
function axisDistance(a,x,z){const dx=a[2]-a[0],dz=a[3]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz));return {t,d:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)};}
export function sculptTerrain(field){
 const buildings=BUILDINGS.map(b=>({...b,y:field.height(b.x,b.z)}));
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE;let h=field.heights[k];
  // Subtle stratification belongs to terrain, not a wall of floating decoration.
  const road=field.paths[k];if(h>13&&road>7&&!buildings.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+4)&&Math.hypot(x+9,z+41)>18){const relief=(.55*Math.sin(h*1.23+x*.045)+.18*Math.sin(z*.27+x*.17))*smooth(7,13,road);h+=relief;}
  for(const b of buildings){const d=Math.hypot(x-b.x,z-b.z);h=mix(h,b.y,1-smooth(b.r*.83,b.r+3.4,d));}
  const pr=Math.hypot((x+9)/14,(z+41)/13);h=mix(h,46,1-smooth(.95,1.32,pr));
  // Lowest bowl first: a lower basin must never erase the upper basin's banks.
  for(const b of [...BASINS].reverse()){const r=basinRadius(b,x,z);if(r<1.6){const bowl=b.level-b.depth+(b.depth+1.35)*smooth(.2,1.19,r);h=mix(h,bowl,1-smooth(1.19,1.60,r));}}
  for(const a of fallAxes){const v=axisDistance(a,x,z);if(v.d<a[6]+2){const bed=mix(a[4],a[5],smooth(.08,.87,v.t))-.6;h=mix(h,bed,1-smooth(a[6]*.48,a[6]*.48+2.2,v.d));}}
  field.heights[k]=h;
 }
 const defs=[['landing','옛 부두',-48,82],['harbor','선착장 선술집',-49,62],['falls','이끼 협곡과 폭포',-31,0],['mill','계곡 물방앗간',-64,20],['grove','고요한 숲',-3,16],['cave','돌산 광산',65,29],['workshop','광산 작업장',81,41],['lookout','동쪽 망루',76,-20],['shrine','바람의 차원문',-9,-28],['cove','숨겨진 조개 만',67,66]];
 field.points=defs.map(([id,name,x,z])=>({id,name,x,z,y:field.height(x,z),r:6}));return buildings;
}
const NOISE=`
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return .57*noise21(p)+.28*noise21(p*2.03+4.7)+.15*noise21(p*4.07+11.3);}
`;
function stoneGeometry(){
 const g=new THREE.IcosahedronGeometry(1,1),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=1+.12*Math.sin(x*9+y*6+z*4);p.setXYZ(i,x*n,Math.round(y*4)/4*.86+y*.14,z*n);}
 g.computeVertexNormals();return g;
}
export async function initAuroraArtpass(ctx,options={}){
 if(!ctx.scene||!ctx.world||!ctx.RAPIER||!ctx.water?.mat?.uniforms)throw new Error('Initialize native core/physics/water first.');
 if(ctx.terrain)throw new Error('Aurora requires a fresh terrain context.');
 const {scene,world,RAPIER:R}=ctx,root=new THREE.Group(),field=createIslandField(),rng=random(260926),buildings=sculptTerrain(field);
 const base=options.assetRoot||new URL('../',import.meta.url).href,url=p=>new URL(p,base).href;
 const G=new Set(),M=new Set(),T=new Set(),colliders=[],collide=[],supports=[],batch=[],jobs=[],ticks=[],cleanup=[];
 const assets={trees:0,rocks:0,buildings:[],dock:null,errors:[]},placements=[],waterRegions=[],basinQA=[];
 let disposed=false,hook=null;root.name='Aurora 05 / authored environments';scene.add(root);
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.93,...o});M.add(m);return m;};
 const stone=mat('#a1aaa0',{flatShading:true}),dark=mat('#627e77',{flatShading:true}),moss=mat('#658349'),wood=mat('#876a49'),wood2=mat('#594d3a'),bronze=mat('#ac9563',{metalness:.33,roughness:.6});
 // Shared stone shader: world-space mineral layers; no per-object maps.
 for(const m of [stone,dark]){const prior=m.onBeforeCompile;m.onBeforeCompile=function(s,r){prior?.call(this,s,r);s.vertexShader='varying vec3 artWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>',`vec4 artP=vec4(transformed,1.);
 #ifdef USE_INSTANCING
 artP=instanceMatrix*artP;
 #endif
 artWorld=(modelMatrix*artP).xyz;
 #include <project_vertex>
 `);s.fragmentShader='varying vec3 artWorld;\n'+NOISE+'\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
 float mineral=fbm(artWorld.xz*.58+artWorld.y*.23);
 float strata=.5+.5*sin(artWorld.y*7.2+mineral*2.3);
 diffuseColor.rgb*=.87+.16*mineral+.08*strata;
 `);};m.customProgramCacheKey=()=> 'aurora05-weathered-stone';}
 const rockG=stoneGeometry(),boxG=new THREE.BoxGeometry(1,1,1);G.add(rockG);G.add(boxG);
 function fixed(d){const c=world.createCollider(d.setFriction(.9));colliders.push(c);return c;}
 function solid(o,walk=true){o.updateWorldMatrix(true,false);const p=o.geometry.attributes.position,v=new Float32Array(p.count*3),q=new THREE.Vector3();for(let i=0;i<p.count;i++){q.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);v.set(q.toArray(),i*3);}const ix=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);fixed(R.ColliderDesc.trimesh(v,ix));collide.push(o);if(walk)supports.push(o);return o;}
 function mesh(g,m,x=0,y=0,z=0,s=[1,1,1],isSolid=false,doBatch=true){G.add(g);M.add(m);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.castShadow=o.receiveShadow=true;root.add(o);if(isSolid)solid(o);if(doBatch&&!m.transparent&&!m.isShaderMaterial)batch.push(o);return o;}
 const box=(x,y,z,s,m=wood,isSolid=false)=>mesh(boxG,m,x,y,z,s,isSolid);
 function beam(a,b,r=.07,m=wood2){const v=new THREE.Vector3(...a),w=new THREE.Vector3(...b),d=w.clone().sub(v),o=mesh(new THREE.CylinderGeometry(r,r,d.length(),6),m,...v.add(w).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
 function inst(g,m,ps,name,shadow=true){if(!ps.length)return null;G.add(g);M.add(m);const o=new THREE.InstancedMesh(g,m,ps.length),d=new THREE.Object3D();ps.forEach((p,i)=>{d.position.set(p.x,p.y,p.z);d.rotation.set(p.rx||0,p.rot||0,p.rz||0);d.scale.set(...p.s);d.updateMatrix();o.setMatrixAt(i,d.matrix);if(p.c)o.setColorAt(i,new THREE.Color(p.c));});o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=shadow;o.receiveShadow=true;o.name=name;root.add(o);return o;}
 function hulls(o){if(!o)return;const m=new THREE.Matrix4(),v=new THREE.Vector3(),p=o.geometry.attributes.position;for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);const a=new Float32Array(p.count*3);for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(m);a.set(v.toArray(),j*3);}const d=R.ColliderDesc.convexHull(a);if(d)fixed(d);}collide.push(o);supports.push(o);}
 const nearWater=(x,z,pad=0)=>BASINS.some(b=>basinRadius(b,x,z)<1.4+pad*.08)||fallAxes.some(a=>axisDistance(a,x,z).d<5+pad);
 const excluded=(x,z,pad=0)=>buildings.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+pad)||nearWater(x,z,pad)||Math.hypot(x+9,z+41)<16+pad;
 const positions=[],colors=[],uvs=[],indices=[];
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,y=field.heights[k],sl=field.slope(x,z),v=.5+.25*(Math.sin(x*.13+z*.08)+Math.cos(z*.14-x*.04));
  const c=new THREE.Color('#658849').lerp(new THREE.Color('#a4af66'),v*.65);c.lerp(new THREE.Color('#e0cda4'),1-smooth(4.2,7.2,y));c.lerp(new THREE.Color('#8c9a91'),smooth(.55,1.15,sl)*.94);
  if(!nearWater(x,z))c.lerp(new THREE.Color('#baa782'),(1-smooth(1.5,3.1,field.paths[k]))*.94);
  if(nearWater(x,z))c.lerp(new THREE.Color('#587e70'),.22);
  if(Math.hypot(x+9,z+41)<14)c.lerp(new THREE.Color('#89938a'),.4);
  c.multiplyScalar(.96+.055*Math.sin(x*.69+z*.51));positions.push(x,y,z);colors.push(c.r,c.g,c.b);uvs.push(i/N,j/N);if(i<N&&j<N)indices.push(k,k+N+1,k+1,k+1,k+N+1,k+N+2);
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
 const image=new Uint8Array(128*128);for(let i=0;i<image.length;i++)image[i]=100+rng()*55;const grain=new THREE.DataTexture(image,128,128,THREE.RedFormat);grain.wrapS=grain.wrapT=THREE.RepeatWrapping;grain.repeat.set(90,90);grain.magFilter=grain.minFilter=THREE.LinearFilter;grain.needsUpdate=true;T.add(grain);
 const land=mesh(geo,mat('#ffffff',{vertexColors:true,bumpMap:grain,bumpScale:.055}),0,0,0,[1,1,1],false,false);land.name='Sculpted terrain / visual and physics SSOT';solid(land,false);
 const cliffs=[];for(let i=0;i<4000&&cliffs.length<140;i++){const x=(rng()-.5)*224,z=(rng()-.5)*205,y=field.height(x,z);if(y<9||field.slope(x,z)<.77||field.nearPath(x,z).d<7||excluded(x,z,2))continue;cliffs.push({x,y:y-1.5,z,s:[2.4+rng()*2.3,2.8+rng()*2.8,2.2+rng()*2],rot:rng()*6.28,c:rng()<.3?'#94a48f':'#71867e'});}hulls(inst(rockG,stone,cliffs,'Stratified buttresses'));
 // Extended to dry bank on each end; continuous collider has no plank-gap catches.
 const bridgeY=x=>11.25-.65*Math.sin(clamp((x+72)/48)*Math.PI),bp=[],bi=[];
 for(let i=0;i<=96;i++){const x=-72+i*.5,y=bridgeY(x);bp.push(x,y,1.7,x,y,6.3);if(i<96){const k=i*2;bi.push(k,k+1,k+2,k+1,k+3,k+2);box(x+.23,y-.1,4,[.45,.2,4.7],i%5?wood:wood2);}}
 const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(bp,3));bg.setIndex(bi);bg.computeVertexNormals();const invisible=mat('#fff');invisible.visible=false;mesh(bg,invisible,0,0,0,[1,1,1],true,false);
 for(const z of[1.8,6.2])for(let i=0;i<=12;i++){const x=-72+i*4,y=bridgeY(x);beam([x,y,z],[x,y+1.15,z]);if(i<12)beam([x,y+1.03,z],[x+4,bridgeY(x+4)+1.03,z],.045);}
 // Water is clipped against the same terrain triangles. No radial fan over a slope.
 const U=ctx.water.mat.uniforms,clock=U.uTime;
 const waterMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{t:clock,nA:U.uNormA,nB:U.uNormB,shallow:U.uShallow,deep:U.uDeep,sun:U.uSunDir},
 vertexShader:`attribute float depth;varying float dep;varying vec3 wp;void main(){dep=depth;wp=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`,
 fragmentShader:NOISE+`uniform float t;uniform sampler2D nA,nB;uniform vec3 shallow,deep,sun;varying float dep;varying vec3 wp;
 void main(){vec2 a=texture2D(nA,wp.xz*.115+vec2(t*.016,t*.008)).xy*2.-1.;vec2 b=texture2D(nB,wp.xz*.067-vec2(t*.007,t*.012)).xy*2.-1.;vec3 N=normalize(vec3((a.x+b.x)*.27,1.,(a.y+b.y)*.27));vec3 V=normalize(cameraPosition-wp);float f=pow(1.-max(0.,dot(N,V)),4.);float d=clamp(dep/2.5,0.,1.);vec3 c=mix(mix(shallow,vec3(.12,.29,.24),.38),deep,d*.62);c=mix(c,vec3(.50,.69,.72),f*.65);float glint=pow(max(0.,dot(reflect(-V,N),normalize(sun))),100.);c+=glint*.35;float ca=pow(max(0.,1.-abs(sin(wp.x*.9+a.x)+sin(wp.z*.85+b.y))),11.);c+=ca*.10*(1.-d);float edge=(1.-smoothstep(.02,.23,dep))*(.45+.25*noise21(wp.xz*3.+t*.08));c=mix(c,vec3(.60,.73,.65),edge*.35);gl_FragColor=vec4(c,smoothstep(0.,.18,dep)*(.60+d*.34));
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});M.add(waterMat);
 const clipPoly=poly=>{const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ina=a.d>0,inb=b.d>0;if(ina)out.push(a);if(ina!==inb){const t=a.d/(a.d-b.d);out.push({x:mix(a.x,b.x,t),z:mix(a.z,b.z,t),d:0});}}return out;};
 const clipSpill=(poly,limit)=>{if(limit==null)return poly;const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],ia=a.z<=limit,ib=b.z<=limit;if(ia)out.push(a);if(ia!==ib){const t=(limit-a.z)/(b.z-a.z);out.push({x:mix(a.x,b.x,t),z:limit,d:mix(a.d,b.d,t)});}}return out;};
 for(const b of BASINS){const ps=[],ds=[],edge=[],step=SIZE/N;const x0=-SIZE/2+Math.floor((b.x-b.rx*1.5+SIZE/2)/step)*step,z0=-SIZE/2+Math.floor((b.z-b.rz*1.5+SIZE/2)/step)*step;
  for(let z=z0;z<b.z+b.rz*1.5;z+=step)for(let x=x0;x<b.x+b.rx*1.5;x+=step){const v=[[x,z],[x+step,z],[x,z+step],[x+step,z+step]].map(([x,z])=>({x,z,d:b.level-field.height(x,z)-.035}));if(basinRadius(b,x,z)>1.2)continue;for(const ids of[[0,2,1],[1,2,3]]){const poly=clipSpill(clipPoly(ids.map(i=>v[i])),b.spillZ);for(let i=1;i<poly.length-1;i++)for(const p of[poly[0],poly[i],poly[i+1]]){ps.push(p.x,b.level,p.z);ds.push(Math.max(0,p.d));if(p.d===0)edge.push(p);}}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('depth',new THREE.Float32BufferAttribute(ds,1));g.computeVertexNormals();const o=mesh(g,waterMat,0,0,0,[1,1,1],false,false);o.castShadow=o.receiveShadow=false;o.name=b.id+' / terrain-clipped water';
  const contains=(x,z)=>(b.spillZ==null||z<=b.spillZ)&&basinRadius(b,x,z)<1.2&&field.height(x,z)<b.level-.035;waterRegions.push({...b,contains});let maxGap=0;for(const p of edge)maxGap=Math.max(maxGap,Math.abs(b.level-field.height(p.x,p.z)-.035));basinQA.push({id:b.id,triangles:ps.length/9,bankEdgeError:+maxGap.toFixed(3)});
 }
 const oldHeight=ctx.water.heightAt;const inlandHeight=(x,z)=>{for(const b of waterRegions)if(b.contains(x,z))return b.level;return oldHeight.call(ctx.water,x,z);};ctx.water.heightAt=inlandHeight;cleanup.push(()=>{if(ctx.water.heightAt===inlandHeight)ctx.water.heightAt=oldHeight;});
 const fallMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{t:clock,nA:U.uNormA},vertexShader:`uniform float t;varying vec2 v;varying vec3 wp;void main(){v=uv;vec3 p=position;p.x+=sin(v.y*36.-t*5.+v.x*9.)*.025;wp=(modelMatrix*vec4(p,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`,
 fragmentShader:NOISE+`uniform float t;uniform sampler2D nA;varying vec2 v;varying vec3 wp;void main(){float n=fbm(vec2(v.x*16.,v.y*5.-t*1.7));float lanes=fbm(vec2(v.x*37.,v.y*2.8-t*1.1));float rough=texture2D(nA,vec2(v.x*2.,v.y*1.3-t*.17)).y;float edge=smoothstep(0.,.10,v.x)*(1.-smoothstep(.90,1.,v.x));edge*=smoothstep(.16,.35,n+lanes*.15);float impact=smoothstep(.75,1.,v.y);float foam=smoothstep(.42,.75,n*.5+lanes*.5);vec3 c=mix(vec3(.10,.34,.31),vec3(.72,.86,.80),.28+foam*.43+impact*.18);float alpha=edge*(.40+.36*rough+impact*.14);gl_FragColor=vec4(c,alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});M.add(fallMat);
 function flow(a){const ps=[],uv=[],ix=[],nx=12,ny=58;for(let j=0;j<=ny;j++){const t=j/ny,curve=t*t*(3-2*t),x=mix(a[0],a[2],t),z=mix(a[1],a[3],t),y=mix(a[4],a[5],curve);for(let i=0;i<=nx;i++){const u=i/nx,w=a[6]*(.95+.055*Math.sin(t*16)+.025*Math.sin(t*41));ps.push(x+(u-.5)*w,y+.055*Math.sin(u*13+t*18),z+.08*Math.sin(u*7+t*11));uv.push(u,t);if(i<nx&&j<ny){const k=j*(nx+1)+i;ix.push(k,k+nx+1,k+1,k+1,k+nx+1,k+nx+2);}}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();const o=mesh(g,fallMat,0,0,0,[1,1,1],false,false);o.name='Cascading water / native normals and clock';o.castShadow=false;}
 fallAxes.forEach(flow);
 const bankRocks=[],bankMoss=[];for(const b of BASINS)for(let i=0;i<45;i++){if(rng()<.2)continue;const a=(i+rng()*.6)/45*Math.PI*2,r=1.05+rng()*.15,x=b.x+Math.cos(a)*b.rx*r,z=b.z+Math.sin(a)*b.rz*r;if(fallAxes.some(a=>axisDistance(a,x,z).d<a[6]*.7))continue;const y=field.height(x,z),s=.7+rng()*1.3;bankRocks.push({x,y:y-.23,z,s:[s,s*.55,s*.85],rot:rng()*6.28,c:rng()<.5?'#728d7b':'#92a08d'});bankMoss.push({x,y:y+s*.25,z,s:[s*.8,.15,s*.6],rot:rng()*6.28});}
 for(const a of fallAxes)for(let i=0;i<5;i++)for(const side of[-1,1]){const t=i/4,x=mix(a[0],a[2],t)+side*(a[6]*.55+.6),z=mix(a[1],a[3],t),y=field.height(x,z);bankRocks.push({x,y:y-.8,z,s:[1.35,1.65,1.6],rot:.15*side});}
 hulls(inst(rockG,dark,bankRocks,'Wet gorge banks'));inst(rockG,moss,bankMoss,'Bank-top moss',false);
 const sprayMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{t:clock},vertexShader:`uniform float t;attribute float seed;varying float a;void main(){float f=fract(seed+t*.23);vec3 p=position;p.x+=sin(seed*27.)*f*1.4;p.y+=sin(f*3.14159)*1.4;p.z+=cos(seed*19.)*f;a=sin(f*3.14159)*.23;vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(150./max(1.,-v.z),1.,38.);}`,fragmentShader:`varying float a;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.8,.90,.83,a*(1.-smoothstep(.1,1.,r)));}`});M.add(sprayMat);
 const sp=[],se=[];for(const a of fallAxes)for(let i=0;i<65;i++){sp.push(a[2]+(rng()-.5)*a[6],a[5]+.1,a[3]+(rng()-.5)*1.5);se.push(rng());}const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));sg.setAttribute('seed',new THREE.Float32BufferAttribute(se,1));G.add(sg);root.add(new THREE.Points(sg,sprayMat));
 const foamMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{t:clock},vertexShader:`varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:NOISE+`uniform float t;varying vec2 v;void main(){vec2 p=(v-.5)*2.;float r=length(p);float n=fbm(p*7.-t*.2);float ring=pow(max(0.,sin(r*21.-t*2.+n*3.)),7.)*.2;float a=(1.-smoothstep(.2,1.,r))*(smoothstep(.4,.75,n)*.36+ring);gl_FragColor=vec4(.79,.87,.78,a);}`});M.add(foamMat);
 for(const a of fallAxes){const g=new THREE.PlaneGeometry(a[6]*2,a[6]*1.4);g.rotateX(-Math.PI/2);const o=mesh(g,foamMat,a[2],a[5]+.045,a[3]+.55,[1,1,1],false,false);o.castShadow=false;}
 // Summit: irregular platform outline and segmented, bevelled masonry.
 const py=46,cx=-9,cz=-41;
 for(let i=0;i<3;i++){const g=new THREE.CylinderGeometry(10.7-i*.6,11-i*.6,.22,32),p=g.attributes.position;for(let j=0;j<p.count;j++){const x=p.getX(j),z=p.getZ(j),a=Math.atan2(z,x),q=1+.024*Math.sin(a*7+.3)+.014*Math.cos(a*11);p.setXYZ(j,x*q,p.getY(j),z*q);}g.computeVertexNormals();mesh(g,i===0?dark:stone,cx,py+.11+i*.20,cz,[1,1,1],true);}
 const pavers=[];for(let i=0;i<65;i++){const x=cx+(rng()-.5)*18,z=cz+(rng()-.5)*16;if(Math.hypot(x-cx,z-cz)>8.9)continue;pavers.push({x,y:46.635,z,s:[.85+rng()*.6,.07,.7+rng()*.4],rot:(rng()-.5)*.14,c:rng()<.3?'#8f9b8b':'#b2b7a7'});}inst(boxG,stone,pavers,'Weathered floor pavers');
 function archStone(a0,a1,ri,ro){const s=new THREE.Shape();s.absarc(0,0,ro,a0,a1,false);s.absarc(0,0,ri,a1,a0,true);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth:1.30,bevelEnabled:true,bevelSize:.07,bevelThickness:.06,bevelSegments:1,steps:1,curveSegments:4});g.translate(0,0,-.65);return g;}
 const radius=3.25,baseY=46.62,springY=50.75;
 for(const x of[cx-radius-.39,cx+radius+.39]){box(x,baseY+.17,cz,[1.55,.34,1.9],dark,true);for(let i=0;i<5;i++){const o=box(x,baseY+.72+i*.76,cz,[1.04,.73,1.38],i%3?stone:dark);o.rotation.y=(i%2?1:-1)*.035;solid(o);}box(x,50.6,cz,[1.55,.34,1.78],stone,true);}
 for(let i=0;i<15;i++){const a0=i/15*Math.PI+.014,a1=(i+1)/15*Math.PI-.014;mesh(archStone(a0,a1,radius,radius+.82),i%5?stone:dark,cx,springY,cz,[1,1,1],true);}
 const portal=createPortal({w:5.65,h:7.0,shape:2.8,glow:0x62bdba,deep:0x12273f,light:true,lightIntensity:8});portal.group.position.set(cx,50.13,cz+.02);portal.group.name='Native portal / sheltered arch';root.add(portal.group);portal.setOpen(1);ticks.push(dt=>portal.update(dt));cleanup.push(()=>portal.dispose());
 const ruinBits=[];for(const [x,z,h]of[[-18,-37,3.2],[.8,-35,1.8],[-19,-49,2.1],[1,-49,4.0]]){mesh(new THREE.CylinderGeometry(.46,.65,h,8),stone,x,46+h/2,z,[1,1,1],true);box(x,46+h,z,[1.4,.26,1.4],dark);}for(let i=0;i<65;i++){const a=rng()*6.28,r=9.2+rng()*3.5,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;if(z>-31&&Math.abs(x+9)<3)continue;ruinBits.push({x,y:field.height(x,z)+.1,z,s:[.3+rng()*.6,.2+rng()*.35,.3+rng()*.7],rot:rng()*6.28});}inst(rockG,stone,ruinBits,'Fallen arch fragments');
 const runeMat=new THREE.LineBasicMaterial({color:'#7fb2a4',transparent:true,opacity:.6});M.add(runeMat);const rp=[];
 for(let i=0;i<32;i++){const a=i/32*Math.PI*2,r=6.8,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;rp.push(x,46.685,z,x+Math.cos(a)*.6,46.685,z+Math.sin(a)*.6,x,46.685,z,x+Math.cos(a+.8)*.45,46.685,z+Math.sin(a+.8)*.45);}const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(rp,3));G.add(rg);root.add(new THREE.LineSegments(rg,runeMat));
 const ivy=[];for(const side of[-1,1])for(let i=0;i<65;i++){const y=47+rng()*6.9,x=cx+side*(3.8+.35*Math.sin(y*1.7)),z=cz+.8+rng()*.12;ivy.push({x,y,z,s:[.18+rng()*.17,.07,.27],rot:rng()*6.28,rx:rng()*.8,c:rng()<.3?'#8c9a54':'#536e48'});}inst(rockG,moss,ivy,'Ivy on ancient stone',false);
 const atlasURL=url(HX+'hexagons_medieval.png'),manager=new THREE.LoadingManager();manager.setURLModifier(u=>/\.(png|jpe?g)(\?|$)/i.test(u)?atlasURL:u);const fbx=new FBXLoader(manager),gltf=new GLTFLoader();fbx.setResourcePath(url(HX));
 const atlas=await new THREE.TextureLoader().loadAsync(atlasURL);atlas.colorSpace=THREE.SRGBColorSpace;atlas.flipY=true;atlas.anisotropy=4;T.add(atlas);const buildingMat=mat('#f4f2e6',{map:atlas});
 async function loadBuilding(b){try{const raw=await fbx.loadAsync(url(HX+b.file));if(disposed)return;raw.updateMatrixWorld(true);let bb=new THREE.Box3().setFromObject(raw),s=bb.getSize(new THREE.Vector3());raw.scale.multiplyScalar(b.size/Math.max(s.x,s.y,s.z));raw.updateMatrixWorld(true);bb.setFromObject(raw);const c=bb.getCenter(new THREE.Vector3());raw.position.set(-c.x,-bb.min.y,-c.z);const holder=new THREE.Group();holder.name=b.name;holder.userData.nativeAsset=HX+b.file;holder.add(raw);holder.position.set(b.x,b.y,b.z);holder.rotation.y=b.yaw;root.add(holder);holder.updateMatrixWorld(true);raw.traverse(o=>{if(o.isMesh){o.material=buildingMat;G.add(o.geometry);o.castShadow=o.receiveShadow=true;solid(o);}});bb.setFromObject(holder);assets.buildings.push({id:b.id,scaleVsV4:+(b.size/b.old).toFixed(3),dimensions:bb.getSize(new THREE.Vector3()).toArray(),source:HX+b.file});}catch(e){assets.errors.push(b.id+': '+e.message);}}
 jobs.push(...buildings.map(loadBuilding));
 function crate(x,z,s=.85){const y=field.height(x,z);box(x,y+s*.5,z,[s,s,s],wood,true);for(const a of[-1,1]){box(x+a*s*.42,y+s*.51,z,[.075,s*1.05,s*1.04],wood2);box(x,y+s*.51,z+a*s*.42,[s*1.04,s*1.05,.075],wood2);}box(x,y+s+.03,z,[s,.055,s],wood2);}
 function barrel(x,z,s=.65){const y=field.height(x,z);mesh(new THREE.CylinderGeometry(s*.45,s*.42,s,10),wood,x,y+s*.5,z,[1,1,1],true);for(const dy of[.15,.79])mesh(new THREE.CylinderGeometry(s*.465,s*.465,.05,10),wood2,x,y+s*dy,z);}
 const props=[];for(const b of buildings){const sign=b.x<0?-1:1;for(let i=0;i<3;i++){const x=b.x+sign*(b.r*.83+1.5),z=b.z+3.3+i*1.2;crate(x,z,.72+(i%2)*.22);props.push([x,z]);}barrel(b.x-sign*b.r*.85,b.z+4.3,.90);barrel(b.x-sign*b.r*.85,b.z+5.5,.76);}
 const pathStones=[];for(let i=0;i<field.lines.length;i+=6){const [a,b]=field.lines[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;for(const side of[-1,1]){const x=a[0]-dz/l*side*(2.1+rng()*.4),z=a[1]+dx/l*side*(2.1+rng()*.4),y=field.height(x,z);if(y<4||excluded(x,z,1)||field.slope(x,z)>.7)continue;pathStones.push({x,y:y+.07,z,s:[.25+rng()*.35,.12,.25+rng()*.25],rot:rng()*6.28});}}inst(rockG,stone,pathStones,'Old trail kerbstones',false);
 async function dock(){try{const raw=await new OBJLoader().loadAsync(url('the-wharf/source/model/Untitled 1.obj'));const tl=new THREE.TextureLoader();const tex=async(f,srgb)=>{const t=await tl.loadAsync(url('the-wharf/textures/'+f));if(srgb)t.colorSpace=THREE.SRGBColorSpace;T.add(t);return t;};const [wm,wn,tm,tn]=await Promise.all([tex('Untitled_1_Mat_1_BaseColor.png',true),tex('Untitled_1_Mat_1_Normal.png',false),tex('Car_Tire_BaseColor.png',true),tex('Car_Tire_Normal.png',false)]);if(disposed)return;
  const mats=[mat('#e6e1cc',{map:wm,normalMap:wn,side:THREE.DoubleSide}),mat('#fff',{map:tm,normalMap:tn,side:THREE.DoubleSide})];raw.traverse(o=>{if(o.isMesh){o.material=mats[/tire/i.test(o.name)?1:0];G.add(o.geometry);o.castShadow=o.receiveShadow=true;}});raw.updateMatrixWorld(true);let bb=new THREE.Box3().setFromObject(raw),sz=bb.getSize(new THREE.Vector3());if(sz.x>sz.z)raw.rotation.y=Math.PI/2;raw.scale.setScalar(42/Math.max(sz.x,sz.z));raw.updateMatrixWorld(true);bb.setFromObject(raw);sz=bb.getSize(new THREE.Vector3());const c=bb.getCenter(new THREE.Vector3());raw.position.set(-c.x,-bb.min.y,-c.z);const h=new THREE.Group();h.name='Existing 42m wharf';h.add(raw);h.position.set(-48,4.85-sz.y*.98,108);root.add(h);h.updateMatrixWorld(true);raw.traverse(o=>{if(o.isMesh)solid(o);});const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);let anchor=null;for(let z=87;z<108&&!anchor;z+=.5){ray.set(new THREE.Vector3(-48,20,z),down);const hits=ray.intersectObject(h,true);const hit=hits.find(x=>x.point.y>3&&x.point.y<6);if(hit)anchor=hit.point.clone();}if(!anchor)throw new Error('Could not identify a walkable deck');const a=new THREE.Vector3(-48,field.height(-48,82)+.08,82),b=anchor.clone(),ps=[a.x-2,a.y,a.z,a.x+2,a.y,a.z,b.x-2,b.y,b.z,b.x+2,b.y,b.z],g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ps,3));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();mesh(g,wood,0,0,0,[1,1,1],true);assets.dock={source:'the-wharf/source/model/Untitled 1.obj',anchor:anchor.toArray(),span:42};field.points.push({id:'dock',name:'옛 부두 갑판',x:anchor.x,y:anchor.y,z:anchor.z,r:4});
 }catch(e){assets.errors.push('Dock: '+e.message);}}
 jobs.push(dock());
 async function prototype(path,fit='height'){const g=await gltf.loadAsync(url(path));g.scene.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(g.scene),s=bb.getSize(new THREE.Vector3()),c=bb.getCenter(new THREE.Vector3()),scale=1/(fit==='height'?s.y:Math.max(s.x,s.y,s.z)),parts=[];g.scene.traverse(o=>{if(o.isMesh){const geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);geo.translate(-c.x,-bb.min.y,-c.z);geo.scale(scale,scale,scale);G.add(geo);const mats=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const a=m.clone();if(a.color)a.color.multiplyScalar(.94);M.add(a);for(const t of Object.values(a))if(t?.isTexture)T.add(t);return a;});parts.push({g:geo,m:Array.isArray(o.material)?mats:mats[0]});}});return parts;}
 const trees=[[],[],[],[]];for(let i=0;i<9000&&placements.length<225;i++){const x=(rng()-.5)*212,z=(rng()-.5)*188,y=field.height(x,z);if(y<7||field.slope(x,z)>.5||field.nearPath(x,z).d<5.5||Math.hypot(x+25,z-10)<9||excluded(x,z,3)||placements.some(p=>Math.hypot(x-p.x,z-p.z)<3.7))continue;const h=6+rng()*5.8,k=Math.floor(rng()*4),p={type:'tree',x,y,z,s:[h,h,h],rot:rng()*6.28};trees[k].push(p);placements.push(p);fixed(R.ColliderDesc.cylinder(h*.30,.32).setTranslation(x,y+h*.30,z));}
 ['Tree_1_A','Tree_2_A','Tree_3_B','Tree_4_A'].forEach((n,k)=>jobs.push(prototype('kaykit_nature/'+n+'_Color1.gltf').then(parts=>{if(disposed)return;for(const p of parts)inst(p.g,p.m,trees[k],n);assets.trees+=trees[k].length;}).catch(e=>assets.errors.push(n+': '+e.message))));
 const stones=[];for(let i=0;i<1400&&stones.length<65;i++){const x=(rng()-.5)*214,z=(rng()-.5)*188,y=field.height(x,z);if(y<4||field.slope(x,z)>.55||field.nearPath(x,z).d<5||excluded(x,z,2))continue;const s=.7+rng()*1.6;stones.push({x,y,z,s:[s,s*.8,s],rot:rng()*6.28});placements.push({type:'rock',x,y,z});fixed(R.ColliderDesc.ball(s*.43).setTranslation(x,y+s*.3,z));}jobs.push(prototype('kaykit_nature/Rock_1_A_Color1.gltf','max').then(parts=>{if(disposed)return;for(const p of parts)inst(p.g,p.m,stones,'Native rocks');assets.rocks=stones.length;}).catch(e=>assets.errors.push('Rocks: '+e.message)));
 const blades=[],ferns=[],grassItems=[],flowers=[],shore=[],groundMoss=[];
 for(let i=0;i<7;i++){const a=i/7*6.28,x=Math.cos(a)*.12,z=Math.sin(a)*.12;blades.push(x-.06,0,z,x+.06,0,z,x+Math.cos(a)*.17,.42+(i%3)*.14,z+Math.sin(a)*.17);}
 for(let i=0;i<9;i++){const a=i/9*6.28,x=Math.cos(a),z=Math.sin(a);for(let j=0;j<5;j++){const t=(j+1)/6,hw=.12*(1-t);ferns.push(x*t-hw,Math.sin(t*Math.PI)*.37,z*t,x*t+hw,Math.sin(t*Math.PI)*.37,z*t,x*(t+.19),Math.sin((t+.19)*Math.PI)*.37,z*(t+.19));}}
 for(let i=0;i<13000&&grassItems.length<3200;i++){const x=(rng()-.5)*219,z=(rng()-.5)*190,y=field.height(x,z);if(y<6.7||field.slope(x,z)>.62||field.nearPath(x,z).d<3.2||buildings.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+.7)||Math.hypot(x+9,z+41)<12||BASINS.some(b=>basinRadius(b,x,z)<1.02)||fallAxes.some(a=>axisDistance(a,x,z).d<3))continue;const s=.55+rng()*.5,p={x,y,z,s:[s,s,s],rot:rng()*6.28,c:rng()<.25?'#9eab62':'#678b49'};grassItems.push(p);if(i%5===0)groundMoss.push({...p,s:[s*1.5,s*1.2,s*1.5]});if(i%9===0)flowers.push({...p,y:y+.2,s:[.1,.1,.1],c:rng()<.7?'#d9c98c':'#b39bca'});}
 const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));gg.computeVertexNormals();const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(ferns,3));fg.computeVertexNormals();const gm=mat('#fff',{side:THREE.DoubleSide}),previous=gm.onBeforeCompile;
 gm.onBeforeCompile=function(s,r){previous?.call(this,s,r);s.uniforms.auroraTime=clock;s.vertexShader='uniform float auroraTime;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed.x+=sin(auroraTime*1.6+instanceMatrix[3].x*.15+instanceMatrix[3].z*.11)*position.y*position.y*.15;\n#endif\n');};gm.customProgramCacheKey=()=> 'aurora05-grass';inst(gg,gm,grassItems,'Wind grass',false);inst(fg,gm,groundMoss,'Fern understorey',false);inst(new THREE.IcosahedronGeometry(1,0),mat('#fff'),flowers,'Sparse wildflowers',false);
 for(let i=0;i<1900&&shore.length<240;i++){const x=(rng()-.5)*224,z=(rng()-.5)*205,y=field.height(x,z);if(y<2.2||y>6.4||field.nearPath(x,z).d<2.3)continue;const s=.12+rng()*.2;shore.push({x,y:y+.015,z,s:[s,s*.45,s],rot:rng()*6.28});}inst(rockG,stone,shore,'Tide-worn beach pebbles',false);
 const cove=field.points.find(p=>p.id==='cove');crate(cove.x,cove.z,1);barrel(cove.x+1.4,cove.z+.4,.8);
 const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0);ray.firstHitOnly=true;
 const api={root,field,collide,assets,portal,waterRegions,basinQA,placementPoints:placements,spawn:{x:-43,y:field.height(-43,66)+2.3,z:66},radius:145,offset:{x:0,z:0},data:{name:'바람의 차원문 섬 · 05',objs:[]},_allObjs:[root],qualityVersion:'aurora-v5b-artpass',detailStats:{grass:grassItems.length,ferns:groundMoss.length,bankRocks:bankRocks.length,cliffs:cliffs.length,ruinFragments:ruinBits.length,pathStones:pathStones.length,props:props.length},addTrimesh:solid,
 groundAt(x,z,fromY=5000){const top=Number.isFinite(fromY)?fromY:5000,h=field.height(x,z);let y=h<=top+.001?h:-8;origin.set(x,top,z);ray.set(origin,down);ray.far=Math.max(0,top+12);const hit=ray.intersectObjects(supports,true)[0];if(hit)y=Math.max(y,hit.point.y);return y;},
 dispose(){if(disposed)return;disposed=true;ctx.offUpdate?.(hook);cleanup.forEach(f=>f());for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>{g.disposeBoundsTree?.();g.dispose();});M.forEach(m=>Array.isArray(m)?m.forEach(a=>a.dispose()):m.dispose());T.forEach(t=>t.dispose());if(ctx.terrain===api)delete ctx.terrain;}};
 ctx.terrain=api;hook=ctx.onUpdate(dt=>{if(!disposed)ticks.forEach(f=>f(dt));});
 api.ready=Promise.all(jobs).then(async()=>{if(disposed)return api;root.updateMatrixWorld(true);const groups=new Map();for(const o of batch){if(o.material.visible===false)continue;if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(o);}for(const [m,os]of groups){if(os.length<3)continue;const gs=os.map(o=>{const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const a of Object.keys(g.attributes))if(!['position','normal','uv'].includes(a))g.deleteAttribute(a);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(gs,false);gs.forEach(g=>g.dispose());if(g){os.forEach(o=>o.visible=false);mesh(g,m,0,0,0,[1,1,1],false,false).name='Batched static dressing';}}
  try{const bvh=await import('three-mesh-bvh');if(disposed)return api;if(!THREE.BufferGeometry.prototype.computeBoundsTree){THREE.BufferGeometry.prototype.computeBoundsTree=bvh.computeBoundsTree;THREE.BufferGeometry.prototype.disposeBoundsTree=bvh.disposeBoundsTree;}THREE.Mesh.prototype.raycast=bvh.acceleratedRaycast;for(const o of collide)if(!o.isInstancedMesh)o.traverse(m=>{if(m.isMesh&&m.geometry?.attributes.position?.count>=96&&!m.geometry.boundsTree)m.geometry.computeBoundsTree();});api.bvh=true;}catch(e){assets.errors.push('BVH: '+e.message);}root.updateMatrixWorld(true);return api;});
 return api;
}
