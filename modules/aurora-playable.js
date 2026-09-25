/** Aurora v2: game-context terrain. No secondary controller or save changes. */
import * as THREE from 'three';
import { initAuroraIsland } from './aurora-island.js';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
function random(seed=9252026){return()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}
const distance=(x,z,p)=>Math.hypot(x-p.x,z-p.z);
function cliffGeometry(){
 const n=9,levels=[-1,-.58,-.12,.39,.79,1],radii=[.81,1,.92,1.03,.88,.67],v=[],indices=[];
 for(let k=0;k<levels.length;k++)for(let j=0;j<n;j++){const a=j/n*Math.PI*2,r=radii[k]*(1+.09*Math.sin(j*4.6+k*.7));v.push(Math.cos(a)*r,levels[k]+.035*Math.sin(j*2.8),Math.sin(a)*r);}
 for(let k=0;k<levels.length-1;k++)for(let j=0;j<n;j++){const a=k*n+j,b=k*n+(j+1)%n,c=a+n,d=b+n;indices.push(a,c,b,b,c,d);}
 for(let j=1;j<n-1;j++){indices.push(0,j,j+1);const b=(levels.length-1)*n;indices.push(b,b+j+1,b+j);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function grainTexture(seed){
 const r=random(seed),size=128,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const cx=canvas.getContext('2d'),data=cx.createImageData(size,size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const h=Math.round(123+19*Math.sin(x*.47)*Math.cos(y*.39)+(r()-.5)*44),i=(y*size+x)*4;data.data.set([h,h,h,255],i);}
 cx.putImageData(data,0,0);const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(82,82);t.anisotropy=4;return t;
}
const noiseGLSL=`float aurHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float aurNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(aurHash(i),aurHash(i+vec2(1,0)),f.x),mix(aurHash(i+vec2(0,1)),aurHash(i+vec2(1,1)),f.x),f.y);}`;
function surfaceDetail(material,kind,clock){
 if(!material?.isMeshStandardMaterial||material.userData.auroraDetail)return;material.userData.auroraDetail=true;const previous=material.onBeforeCompile;
 material.onBeforeCompile=function(shader,renderer){previous?.call(this,shader,renderer);shader.uniforms.auroraTime=clock;
 shader.vertexShader='varying vec3 vAuroraP; varying float vAuroraUp;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
 vec4 aurP=vec4(transformed,1.0);vec3 aurN=normal;
 #ifdef USE_INSTANCING
 aurP=instanceMatrix*aurP;aurN=mat3(instanceMatrix)*aurN;
 #endif
 vAuroraP=(modelMatrix*aurP).xyz;vAuroraUp=normalize(mat3(modelMatrix)*aurN).y;`);
 shader.fragmentShader='varying vec3 vAuroraP; varying float vAuroraUp;\n'+noiseGLSL+shader.fragmentShader;
 let details='';
 if(kind==='ground')details=`float aurLarge=aurNoise(vAuroraP.xz*.19),aurFine=aurNoise(vAuroraP.xz*4.8);diffuseColor.rgb*=.91+.13*aurLarge+.085*aurFine;`;
 else if(kind==='stone')details=`float aurPatch=aurNoise(vAuroraP.xz*.53+vAuroraP.yy*.21);float aurLayer=sin(vAuroraP.y*3.9+aurNoise(vAuroraP.xz*.31)*3.0);diffuseColor.rgb*=.94+.055*aurLayer+.055*aurPatch;float aurMoss=smoothstep(.35,.8,vAuroraUp)*smoothstep(.40,.73,aurPatch)*.53;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.25,.085),aurMoss);`;
 else details=`float aurGrain=sin(vAuroraP.x*26.0+aurNoise(vAuroraP.zy*.32)*5.0);diffuseColor.rgb*=.95+.04*aurGrain+.055*aurNoise(vAuroraP.xz*3.0);`;
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n'+details);};
 material.customProgramCacheKey=()=>`aurora-surface-v2-${kind}`;material.needsUpdate=true;
}
export async function initAuroraPlayable(ctx,options={}){
 if(!ctx.scene||!ctx.world||!ctx.RAPIER)throw new Error('Aurora requires game core and physics before terrain.');
 if(ctx.terrain)throw new Error('Aurora needs an empty terrain slot; unload previous terrain explicitly.');
 const api=await initAuroraIsland(ctx,{...options,registerTerrain:true});const {root,field}=api,{world,RAPIER:R}=ctx,clock={value:0},rng=random();
 const extras=[],cleanup=[],detail=new THREE.Group();detail.name='Aurora v2 / ground dressing';root.add(detail);let disposed=false;
 const land=root.children.find(o=>o.isMesh&&o.geometry?.attributes?.position?.count===field.heights.length);
 if(!land){api.dispose();throw new Error('Aurora terrain geometry not found.');}
 land.name='Aurora terrain / visual and collision surface';land.material.flatShading=false;land.material.roughness=.97;const grain=grainTexture(6326);land.material.bumpMap=grain;land.material.bumpScale=.07;surfaceDetail(land.material,'ground',clock);
 // Native water owns the ocean; remove only the original demonstration ocean.
 if(ctx.water&&options.nativeWater!==false){const ownOcean=root.children.find(o=>o.isMesh&&o.material?.uniforms?.depthMap);if(ownOcean){root.remove(ownOcean);ownOcean.geometry.dispose();ownOcean.material.dispose();}}
 const matSet=new Set();root.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])matSet.add(m);});
 for(const m of matSet){if(!m.isMeshStandardMaterial||!m.color||m===land.material)continue;const h=m.color.getHex();if(h===0x819593||h===0xd4cfb5)surfaceDetail(m,'stone',clock);if(h===0x806044||h===0x4b4033)surfaceDetail(m,'wood',clock);}
 const stoneMat=new THREE.MeshStandardMaterial({color:0x9baca1,roughness:.94,flatShading:true}),mossMat=new THREE.MeshStandardMaterial({color:0x628750,roughness:1}),grassMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide,vertexColors:true}),goldMat=new THREE.MeshStandardMaterial({color:0xa69358,metalness:.45,roughness:.58});surfaceDetail(stoneMat,'stone',clock);
 function instances(geometry,material,items,name,shadow=false){if(!items.length)return null;const o=new THREE.Object3D(),im=new THREE.InstancedMesh(geometry,material,items.length);for(let i=0;i<items.length;i++){const p=items[i];o.position.set(p.x,p.y,p.z);o.rotation.set(p.rx||0,p.rot||0,p.rz||0);o.scale.set(...(p.s||[1,1,1]));o.updateMatrix();im.setMatrixAt(i,o.matrix);if(p.color)im.setColorAt(i,new THREE.Color(p.color));}im.instanceMatrix.needsUpdate=true;im.computeBoundingSphere();im.castShadow=shadow;im.receiveShadow=true;im.name=name;detail.add(im);return im;}
 const cliffMesh=root.children.find(o=>o.isInstancedMesh&&o.geometry?.type==='DodecahedronGeometry'&&o.count>90);let cliffSolids=0;
 if(cliffMesh){cliffMesh.geometry=cliffGeometry();cliffMesh.material=stoneMat;cliffMesh.name='Layered sea cliffs';cliffMesh.computeBoundingSphere();root.updateMatrixWorld(true);const matrix=new THREE.Matrix4(),combined=new THREE.Matrix4(),v=new THREE.Vector3(),positions=cliffMesh.geometry.attributes.position;
 for(let i=0;i<cliffMesh.count;i++){cliffMesh.getMatrixAt(i,matrix);combined.multiplyMatrices(cliffMesh.matrixWorld,matrix);const points=new Float32Array(positions.count*3);for(let j=0;j<positions.count;j++){v.fromBufferAttribute(positions,j).applyMatrix4(combined);points.set([v.x,v.y,v.z],j*3);}const desc=R.ColliderDesc.convexHull(points);if(desc){extras.push(world.createCollider(desc.setFriction(.85)));cliffSolids++;}}api.collide.push(cliffMesh);}
 const grass=[],ferns=[],pebbles=[],moss=[],pavers=[];
 for(let i=0;i<7200&&grass.length<1700;i++){const x=(rng()-.5)*213,z=(rng()-.5)*190,y=field.height(x,z),path=field.nearPath(x,z).d;if(y<7||field.slope(x,z)>.6||path<3.15||Math.hypot(x+49,z-1)<22||distance(x,z,{x:64,z:13})<12)continue;if(field.points.some(p=>distance(x,z,p)<p.r*.77))continue;const patch=Math.sin(x*.13+Math.sin(z*.1))*Math.cos(z*.12);if(patch<-.25)continue;const s=.38+rng()*.46;grass.push({x,y:y-.02,z,s:[s,s*(.7+rng()*.4),s],rot:rng()*6.28,color:rng()<.25?'#a6b872':'#6b9954'});if(i%9===0)ferns.push({x,y:y+.1,z,s:[s*1.5,s*.65,s*1.5],rot:rng()*6.28,color:'#4f7850'});}
 const blades=[],bladeColors=[];for(let i=0;i<6;i++){const a=i*Math.PI/3,cx=Math.cos(a)*.13,cz=Math.sin(a)*.13,w=.1,h=.58+(i%3)*.13;blades.push(cx-w,0,cz,cx+w,0,cz,cx+Math.cos(a)*.18,h,cz+Math.sin(a)*.18);bladeColors.push(.59,.73,.44,.64,.78,.49,.94,1,.72);}
 const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(blades,3));gg.setAttribute('color',new THREE.Float32BufferAttribute(bladeColors,3));gg.computeVertexNormals();
 grassMat.onBeforeCompile=function(shader,renderer){THREE.Material.prototype.onBeforeCompile.call(this,shader,renderer);shader.uniforms.auroraTime=clock;shader.vertexShader='uniform float auroraTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
 #ifdef USE_INSTANCING
 transformed.x+=sin(auroraTime*1.7+instanceMatrix[3].x*.13+instanceMatrix[3].z*.12)*position.y*position.y*.16;
 #endif`);};grassMat.customProgramCacheKey=()=> 'aurora-grass-wind-v2';instances(gg,grassMat,grass,'Wind grass / decorative, no collision');
 instances(new THREE.SphereGeometry(1,7,4,0,Math.PI*2,0,Math.PI/2),mossMat,ferns,'Undergrowth / route edges');
 for(let i=0;i<1900&&pebbles.length<280;i++){const x=(rng()-.5)*222,z=(rng()-.5)*204,y=field.height(x,z),d=field.nearPath(x,z).d;if(y<2.8||y>8||field.slope(x,z)>.5||d<2.4)continue;const s=.08+rng()*.21;pebbles.push({x,y:y+.025,z,s:[s,s*.6,s*1.4],rot:rng()*6.28,color:rng()<.5?'#b6c1b6':'#cfbf9c'});}instances(new THREE.IcosahedronGeometry(1,0),stoneMat,pebbles,'Tide-polished beach stones');
 for(let i=0;i<field.lines.length;i+=3){const[a,b]=field.lines[i],x=(a[0]+b[0])*.5,z=(a[1]+b[1])*.5,y=field.height(x,z);if(y<19||Math.hypot(x+9,z+39)<12||Math.hypot(x-64,z-13)<12)continue;const dx=b[0]-a[0],dz=b[1]-a[1],d=Math.hypot(dx,dz)||1;for(const side of[-1,1]){const px=x+side*dz/d*(2.5+rng()*.2),pz=z-side*dx/d*(2.5+rng()*.2);pavers.push({x:px,y:field.height(px,pz)+.035,z:pz,s:[.33,.10,.62],rot:Math.atan2(dx,dz),color:'#aeb8a2'});}}instances(new THREE.BoxGeometry(1,1,1),stoneMat,pavers,'Old trail kerbstones');
 const sy=field.height(-9,-39),rings=[];for(let i=0;i<32;i++){const a=i*Math.PI*2/32;rings.push({x:-9+Math.cos(a)*8.65,y:sy+.97,z:-39+Math.sin(a)*8.65,s:[.12,.025,.66],rot:-a+Math.PI/2});if(i%2===0)moss.push({x:-9+Math.cos(a)*10.1,y:sy+.29,z:-39+Math.sin(a)*10.1,s:[.55,.045,.42],rot:a,color:'#718951'});}
 instances(new THREE.BoxGeometry(1,1,1),goldMat,rings,'Weathered rune inlays');instances(new THREE.IcosahedronGeometry(1,1),mossMat,moss,'Moss around the ancient dais');
 for(const radius of[7.9,9.15]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.024,4,96),goldMat);ring.rotation.x=-Math.PI/2;ring.position.set(-9,sy+.955,-39);detail.add(ring);}
 const vines=[];for(let i=0;i<24;i++){const a=i/23*Math.PI,x=64+Math.cos(a)*5.45,y=11+Math.sin(a)*6.2;vines.push({x,y,z:24.65,s:[.22,.36,.12],rot:a,color:i%3?'#657f48':'#9aab69'});}instances(new THREE.IcosahedronGeometry(1,0),mossMat,vines,'Cave-mouth vegetation');
 root.traverse(o=>{if(o.isPoints&&o.material?.isPointsMaterial){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,31);g.addColorStop(0,'rgba(255,255,255,.8)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,64,64);const tex=new THREE.CanvasTexture(c);o.material.map=tex;o.material.size=1.15;o.material.opacity=.28;o.material.depthWrite=false;o.material.needsUpdate=true;}});
 // Respect fromY: cave-floor queries must not snap to the roof.
 root.updateMatrixWorld(true);const structures=api.collide.filter(o=>o!==land),ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),origin=new THREE.Vector3();ray.firstHitOnly=true;
 api.groundAt=(x,z,fromY=5000)=>{const y0=Number.isFinite(fromY)?fromY:5000,gy=field.height(x,z);let y=gy<=y0+.001?gy:-8;origin.set(x,y0,z);ray.set(origin,down);ray.far=Math.max(0,y0+12);const hits=ray.intersectObjects(structures,true);if(hits.length)y=Math.max(y,hits[0].point.y);return y;};
 api.radius=145;api.qualityVersion='aurora-v2-native';api.data.name='바람의 유적섬 · 본편 샌드박스';api.spawn={x:-43,y:field.height(-43,66)+2.3,z:66};
 api.placeOnGround=(object,x,z,{offset=0,fromY=5000}={})=>{object.position.set(x,api.groundAt(x,z,fromY)+offset,z);return object;};
 api.detailStats={grass:grass.length,undergrowth:ferns.length,beachStones:pebbles.length,trailStones:pavers.length,cliffSolids};
 let elapsed=0;const update=dt=>{if(disposed)return;elapsed+=dt;clock.value=elapsed;api.update(elapsed);};ctx.onUpdate(update);cleanup.push(()=>ctx.offUpdate?.(update));
 api.bvhReady=import('three-mesh-bvh').then(bvh=>{if(disposed)return;if(!THREE.BufferGeometry.prototype.computeBoundsTree){THREE.BufferGeometry.prototype.computeBoundsTree=bvh.computeBoundsTree;THREE.BufferGeometry.prototype.disposeBoundsTree=bvh.disposeBoundsTree;}THREE.Mesh.prototype.raycast=bvh.acceleratedRaycast;for(const mesh of api.collide)mesh.traverse(o=>{if(o.isMesh&&o.geometry?.attributes?.position?.count>=96&&!o.geometry.boundsTree)o.geometry.computeBoundsTree();});api.bvh=true;}).catch(e=>{api.bvh=false;console.warn('[aurora] BVH optional:',e.message);});
 const oldDispose=api.dispose;api.dispose=()=>{if(disposed)return;disposed=true;cleanup.forEach(f=>f());for(const c of extras){try{world.removeCollider(c,true);}catch{}}for(const mesh of api.collide)mesh.traverse(o=>o.geometry?.disposeBoundsTree?.());oldDispose();};
 api.ready=Promise.all([api.ready,api.bvhReady]);return api;
}
