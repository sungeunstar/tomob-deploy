/** Windgate 15 — carved natural mine interior using native mine props/ore assets.
 * The terrain cut and Rapier terrain collider share the same geometry.
 */
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {BUILDINGS,clamp,mix} from './aurora-expedition-layout.js';

const MINE=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48,y:35};
const APPROACH={x:-97,z:-34,y:33};
const dx=MINE.x-APPROACH.x,dz=MINE.z-APPROACH.z,len=Math.hypot(dx,dz)||1,fx=dx/len,fz=dz/len;
const controls=[
 // Start at the actual front face of the existing mine facade, then continue through its open doorway.
 [MINE.x-fx*7.2,MINE.z-fz*7.2,MINE.y+.02],
 [MINE.x-fx*1.8,MINE.z-fz*1.8,MINE.y+.06],
 [MINE.x+fx*4.8,MINE.z+fz*4.8,MINE.y+.14],
 [MINE.x+fx*10.8-1.2,MINE.z+fz*10.8+.8,MINE.y+.28],
 [MINE.x+fx*16.0-3.2,MINE.z+fz*16.0+2.2,MINE.y+.44],
 [MINE.x+fx*20.8-2.9,MINE.z+fz*20.8+4.7,MINE.y+.60],
 [MINE.x+fx*24.8-.9,MINE.z+fz*24.8+6.8,MINE.y+.72]
];
const curve=new THREE.CatmullRomCurve3(controls.map(([x,z,y])=>new THREE.Vector3(x,y,z)),false,'centripetal');
export const mineRows=Array.from({length:91},(_,i)=>{const p=curve.getPoint(i/90),t=curve.getTangent(i/90);t.y=0;t.normalize();return{p,t,n:new THREE.Vector3(-t.z,0,t.x),u:i/90};});

export function mineSample15(x,z){
 let best={d:Infinity,u:0,y:MINE.y,side:0};
 for(let i=0;i<mineRows.length-1;i++){
  const a=mineRows[i].p,b=mineRows[i+1].p,ddx=b.x-a.x,ddz=b.z-a.z,den=ddx*ddx+ddz*ddz||1,t=clamp(((x-a.x)*ddx+(z-a.z)*ddz)/den);
  const px=mix(a.x,b.x,t),pz=mix(a.z,b.z,t),d=Math.hypot(x-px,z-pz);
  if(d<best.d){const ll=Math.hypot(ddx,ddz)||1;best={d,u:(i+t)/90,y:mix(a.y,b.y,t),side:((x-px)*-ddz+(z-pz)*ddx)/ll};}
 }
 return best;
}
export function mineReserve15(x,z,pad=0){const q=mineSample15(x,z);return q.d<5.6+pad&&q.u>=0&&q.u<=1;}
function mineSDF(x,y,z){
 const q=mineSample15(x,z),r=3.25;
 const a=mineRows[0],b=mineRows[mineRows.length-1];
 const before=-((x-a.p.x)*a.t.x+(z-a.p.z)*a.t.z);
 const after=(x-b.p.x)*b.t.x+(z-b.p.z)*b.t.z;
 const arch=Math.sqrt(Math.max(0,1-(q.d/r)**2));
 const roof=q.y+1.75+2.55*arch;
 return Math.max(q.d-r,q.y-.05-y,y-roof,before,after);
}
export function prepareMine15(field){
 field.mine15={rows:mineRows,curve};
 const oldSupport=field.support.bind(field);
 field.support=(x,z)=>{const q=mineSample15(x,z);return q.d<2.95&&q.u>.01&&q.u<.99?q.y:oldSupport(x,z);};
 const routeRows=mineRows.filter((_,i)=>i%5===0||i===mineRows.length-1),pts=routeRows.map(r=>[r.p.x,r.p.z,r.p.y]);
 field.segmentsList=field.segmentsList.slice();
 for(let i=0;i<pts.length-1;i++)field.segmentsList.push({a:pts[i],b:pts[i+1],id:'mine15',width:5.6,bridge:true});
 for(let i=pts.length-1;i>0;i--)field.segmentsList.push({a:pts[i],b:pts[i-1],id:'mine15-return',width:5.6,bridge:true});
 field.routeDefs=field.routeDefs.slice();field.routeDefs.push({id:'mine15',name:'바위그늘 광산 내부',width:5.6,points:pts});
 const stations=[['mine-mouth','광산 입구',.025],['mine-bend','광산 안쪽 굽이',.50],['mine-room','광물 작업실',.88]];
 for(const [id,name,u] of stations){const p=curve.getPoint(u),q=curve.getPoint(clamp(u+.09));field.points.push({id,name,x:p.x,y:p.y,z:p.z,r:5,target:[q.x,q.y+1.5,q.z],text:'산 아래로 이어지는 실제 작업갱'});}
 return field;
}
export function carveMineTerrain15(geo,field){
 const attrs=['position','normal','color','uv'],sizes=[3,3,3,2],src=attrs.map(k=>geo.attributes[k]),out=attrs.map(()=>[]);let cut=0,refined=0;
 const read=i=>src.flatMap(a=>Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize)));
 const interp=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
 const emit=tri=>{for(const v of tri){let k=0;for(let j=0;j<attrs.length;j++){out[j].push(...v.slice(k,k+sizes[j]));k+=sizes[j];}}};
 const val=v=>mineSDF(v[0],v[1],v[2]);
 function clip(tri){const poly=[];for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],fa=val(a),fb=val(b);if(fa>=0)poly.push(a);if((fa>=0)!==(fb>=0)){let lo=0,hi=1;for(let j=0;j<16;j++){const t=(lo+hi)/2;if((val(interp(a,b,t))>=0)===(fa>=0))lo=t;else hi=t;}poly.push(interp(a,b,(lo+hi)/2));}}if(poly.length!==3||tri.some(v=>val(v)<0))cut++;for(let i=1;i<poly.length-1;i++)emit([poly[0],poly[i],poly[i+1]]);}
 function split(tri,depth){if(!depth){clip(tri);return;}const ab=interp(tri[0],tri[1],.5),bc=interp(tri[1],tri[2],.5),ca=interp(tri[2],tri[0],.5);split([tri[0],ab,ca],depth-1);split([ab,tri[1],bc],depth-1);split([ca,bc,tri[2]],depth-1);split([ab,bc,ca],depth-1);}
 const ix=geo.index.array;
 for(let i=0;i<ix.length;i+=3){const tri=[read(ix[i]),read(ix[i+1]),read(ix[i+2])],x=(tri[0][0]+tri[1][0]+tri[2][0])/3,z=(tri[0][2]+tri[1][2]+tri[2][2])/3,q=mineSample15(x,z);if(q.d<6.1&&q.u>=0&&q.u<=1){refined++;split(tri,2);}else emit(tri);}
 geo.setIndex(null);attrs.forEach((k,i)=>geo.setAttribute(k,new THREE.Float32BufferAttribute(out[i],sizes[i])));geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
 field.mine15.cut={removedOrClippedTriangles:cut,localRefinedTriangles:refined,renderAndPhysicsSameGeometry:true};
 return geo;
}
export async function dressMine15(ctx,island){
 const field=island.field,root=new THREE.Group();root.name='Windgate 15 / carved mine';island.root.add(root);
 const gs=new Set(),ms=new Set(),ts=new Set(),lights=[],oreNodes=[],wallMeshes=[];
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.92,...o});ms.add(m);return m;};
 const wallMat=mat('#626a61',{side:THREE.DoubleSide,flatShading:true}),floorMat=mat('#72695b',{side:THREE.DoubleSide}),woodFallback=mat('#75553b'),metal=mat('#555b5f',{metalness:.35,roughness:.58});
 const add=(g,m,p=[0,0,0],s=[1,1,1],rot=[0,0,0],solid=false)=>{gs.add(g);const o=new THREE.Mesh(g,m);o.position.set(...p);o.scale.set(...s);o.rotation.set(...rot);o.castShadow=o.receiveShadow=true;root.add(o);o.updateWorldMatrix(true,false);if(solid)island.addTrimesh(o);return o;};
 const toWorld=(r,l,y)=>[r.p.x+r.n.x*l,r.p.y+y,r.p.z+r.n.z*l];
 // Continuous floor.
 const fp=[],fu=[],fi=[],width=3.20;
 for(let i=0;i<mineRows.length;i++){const r=mineRows[i];for(let j=0;j<=8;j++){const l=(j/8*2-1)*width;fp.push(...toWorld(r,l,.0));fu.push(j/8,r.u*8);if(i<mineRows.length-1&&j<8){const k=i*9+j;fi.push(k,k+1,k+9,k+1,k+10,k+9);}}}
 const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(fp,3));fg.setAttribute('uv',new THREE.Float32BufferAttribute(fu,2));fg.setIndex(fi);fg.computeVertexNormals();add(fg,floorMat,[0,0,0],[1,1,1],[0,0,0],true).name='Mine continuous floor';
 // Rock shell.
 const cross=[[-3.38,-.28],[-3.38,1.72]];for(let j=1;j<18;j++){const a=j/18*Math.PI;cross.push([-3.38*Math.cos(a),1.72+2.58*Math.sin(a)]);}cross.push([3.38,1.72],[3.38,-.28]);
 const wp=[],wu=[],wi=[];
 for(let i=0;i<mineRows.length;i++){const r=mineRows[i];for(let j=0;j<cross.length;j++){const [l,y]=cross[j];wp.push(...toWorld(r,l,y));wu.push(j/cross.length,r.u*7);if(i<mineRows.length-1&&j<cross.length-1){const k=i*cross.length+j;wi.push(k,k+1,k+cross.length,k+1,k+cross.length+1,k+cross.length);}}}
 const wg=new THREE.BufferGeometry();wg.setAttribute('position',new THREE.Float32BufferAttribute(wp,3));wg.setAttribute('uv',new THREE.Float32BufferAttribute(wu,2));wg.setIndex(wi);wg.computeVertexNormals();const shell=add(wg,wallMat,[0,0,0],[1,1,1],[0,0,0],true);shell.name='Mine rock walls and ceiling';wallMeshes.push(shell);
 // The uncut mountain beyond the last row is the natural back wall; no duplicate collider here.
 const end=mineRows[mineRows.length-1];
 // Mine-kit props only: supports, lanterns, crates, planks and ores.
 const KIT=new URL('../mine-kit/',import.meta.url).href,loader=new FBXLoader(),texLoader=new THREE.TextureLoader(),cache=new Map();
 const files={support1:'Models/Props/Support1.fbx',support2:'Models/Props/Support2.fbx',lantern:'Models/Props/Lantern.fbx',crate:'Models/Props/Crate.fbx',planks:'Models/Props/Planks.fbx',ore:'Models/Rocks/Ore.fbx',rock1:'Models/Rocks/Rock1.fbx'};
 async function tex(path,srgb=true){const t=await texLoader.loadAsync(new URL(path,KIT).href);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;ts.add(t);return t;}
 const [woodMap,woodN,lanMap,lanN,crateMap,crateN,rockMap,rockN]=await Promise.all([
  tex('Models/Props/Materials/Wood_AlbedoSmoothness.png'),tex('Models/Props/Materials/Wood_Normal.png',false),
  tex('Models/Props/Materials/Lantern_AlbedoTransparency.png'),tex('Models/Props/Materials/Lantern_Normal.png',false),
  tex('Models/Props/Materials/Crate_Albedo.png'),tex('Models/Props/Materials/Crate_Normal.png',false),
  tex('Models/Rocks/Materials/Rock1_AlbedoSmoothness.png'),tex('Models/Rocks/Materials/Rock1_Normal.png',false)
 ]);
 const props={wood:mat('#fff',{map:woodMap,normalMap:woodN}),lantern:mat('#fff',{map:lanMap,normalMap:lanN,transparent:true,alphaTest:.1}),crate:mat('#fff',{map:crateMap,normalMap:crateN}),rock:mat('#fff',{map:rockMap,normalMap:rockN})};
 async function proto(key){if(!cache.has(key)){const o=await loader.loadAsync(new URL(files[key],KIT).href);o.scale.setScalar(.01);o.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(o),c=bb.getCenter(new THREE.Vector3());o.position.x-=c.x;o.position.z-=c.z;o.position.y-=bb.min.y;o.updateMatrixWorld(true);cache.set(key,o);}return cache.get(key).clone(true);}
 async function placeAtRow(key,ri,lateral=0,kind='wood',scale=1,solid=false,yawOffset=0){const r=mineRows[ri],o=await proto(key),p=toWorld(r,lateral,0);o.position.set(...p);o.rotation.y=Math.atan2(r.t.x,r.t.z)+yawOffset;o.scale.multiplyScalar(scale);o.name='mine-kit/'+key;root.add(o);o.traverse(m=>{if(m.isMesh){m.material=props[kind]||woodFallback;m.castShadow=m.receiveShadow=true;if(solid)island.addTrimesh(m);}});return o;}
 for(const [ri,key] of [[10,'support1'],[24,'support2'],[39,'support1'],[55,'support2'],[70,'support1']])await placeAtRow(key,ri,0,'wood',.92,false);
 for(const [ri,side] of [[17,-1],[45,1],[67,-1]]){const r=mineRows[ri],o=await placeAtRow('lantern',ri,side*2.55,'lantern',.9,false,side<0?.15:-.15),p=o.position;const l=new THREE.PointLight('#ffc47a',9,13,1.7);l.position.set(p.x,r.p.y+2.45,p.z);root.add(l);lights.push(l);}
 await placeAtRow('crate',8,-2.72,'crate',.9,false,.2);await placeAtRow('crate',12,2.68,'crate',.72,false,-.3);await placeAtRow('planks',28,-2.72,'wood',1,false,.4);
 const oreTypes=[['철광석',0x6b7686,.68,.38],['구리',0xc16a38,.82,.34],['코발트',0x2f55d4,.55,.28],['석탄',0x25272b,.06,.74],['금',0xe6b73a,.94,.24]];
 for(const [idx,ri,side,scale] of [[0,22,1,.68],[1,34,-1,.62],[2,52,1,.70],[3,66,-1,.62],[4,79,1,.66]]){const [name,color,metalness,roughness]=oreTypes[idx],r=mineRows[ri],o=await proto('ore'),p=toWorld(r,side*2.82,.05);o.position.set(...p);o.rotation.y=Math.atan2(r.t.x,r.t.z)+side*.45;o.scale.multiplyScalar(scale);o.name='mine ore / '+name;o.userData.ore=name;const om=props.rock.clone();om.color.setHex(color);om.metalness=metalness;om.roughness=roughness;om.emissive=new THREE.Color(color).multiplyScalar(.07);om.emissiveIntensity=.12;ms.add(om);o.traverse(m=>{if(m.isMesh){m.material=om;m.userData.ore=name;m.castShadow=m.receiveShadow=true;}});root.add(o);oreNodes.push(o);}
 // Low rails guide the eye, not the collision route.
 const railG=new THREE.BoxGeometry(.09,.07,1.2),tieG=new THREE.BoxGeometry(1.45,.07,.16);gs.add(railG);gs.add(tieG);
 for(let ri=5;ri<82;ri+=3){const r=mineRows[ri],ang=Math.atan2(r.t.x,r.t.z);for(const side of[-.52,.52])add(railG,metal,toWorld(r,side,.08),[1,1,1],[0,ang,0],false);add(tieG,woodFallback,toWorld(r,0,.025),[1,1,1],[0,ang,0],false);}
 root.updateMatrixWorld(true);
 // Retract the third-person camera when a physical mine wall sits between camera and avatar.
 const ray=new THREE.Raycaster(),eye=new THREE.Vector3(),dir=new THREE.Vector3();ray.firstHitOnly=true;let cameraCorrections=0;
 const cameraHook=ctx.onUpdate(()=>{if(!ctx.player?.third)return;const p=ctx.player.pos;if(!mineReserve15(p.x,p.z,7))return;eye.set(p.x,p.y+.48,p.z);dir.copy(ctx.camera.position).sub(eye);const length=dir.length();if(length<.25)return;ray.set(eye,dir.normalize());ray.far=length+.3;const hit=ray.intersectObjects(island.collide,true).find(h=>h.distance>.08);if(hit&&hit.distance<length+.12){ctx.camera.position.copy(eye).addScaledVector(dir,Math.max(.25,hit.distance-.28));cameraCorrections++;}});
 const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;ctx.offUpdate(cameraHook);root.removeFromParent();gs.forEach(g=>{g.disposeBoundsTree?.();g.dispose();});ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());lights.forEach(l=>l.removeFromParent());prev();};
 island.mine15={rows:mineRows.map(r=>r.p.toArray()),sample:mineSample15,cut:field.mine15.cut,length:curve.getLength(),oreNodes,wallMeshes,get cameraCorrections(){return cameraCorrections;}};
 island.mineOreNodes=oreNodes;island.qualityVersion='aurora-v15d-open-mouth';
 return island.mine15;
}