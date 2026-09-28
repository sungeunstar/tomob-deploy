/** Windgate 16 — Exterior <-> Interior mine zone.
 * Island terrain is never carved. The mine lives in a separate world-space pocket.
 * Native player.js is reused unchanged; only zone teleport/lighting/colliders are added.
 */
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {BUILDINGS} from './aurora-expedition-layout.js';

const KIT=new URL('../mine-kit/',import.meta.url).href;
const FILES={
 t1:'Models/Base/Tunnel1.fbx',t2:'Models/Base/Tunnel2.fbx',t3:'Models/Base/Tunnel3.fbx',
 support1:'Models/Props/Support1.fbx',support2:'Models/Props/Support2.fbx',
 lantern:'Models/Props/Lantern.fbx',crate:'Models/Props/Crate.fbx',planks:'Models/Props/Planks.fbx',
 ore:'Models/Rocks/Ore.fbx',rock1:'Models/Rocks/Rock1.fbx',rock2:'Models/Rocks/Rock2.fbx'
};
const TEX={
 stone:['Models/Base/Materials/Stone_AlbedoSmoothness.png','Models/Base/Materials/Stone_Normal.png'],
 wood:['Models/Props/Materials/Wood_AlbedoSmoothness.png','Models/Props/Materials/Wood_Normal.png'],
 crate:['Models/Props/Materials/Crate_Albedo.png','Models/Props/Materials/Crate_Normal.png'],
 lantern:['Models/Props/Materials/Lantern_AlbedoTransparency.png','Models/Props/Materials/Lantern_Normal.png'],
 rock:['Models/Rocks/Materials/Rock1_AlbedoSmoothness.png','Models/Rocks/Materials/Rock1_Normal.png']
};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

export async function initMineInterior16(ctx,island){
 const {scene,world,RAPIER:R}=ctx;
 const root=new THREE.Group();root.name='Windgate 16 / Mine Interior';root.visible=false;scene.add(root);
 const mine=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48,y:35};
 const approach=island.field.points.find(p=>p.id==='cave')||{x:-97,z:-34,y:33};
 const dx=mine.x-approach.x,dz=mine.z-approach.z,L=Math.hypot(dx,dz)||1,fx=dx/L,fz=dz/L;
 const exteriorDoor={x:mine.x-fx*9.7,z:mine.z-fz*9.7};
 const exteriorReturn={x:mine.x-fx*14.2,z:mine.z-fz*14.2};
 const ORIGIN=new THREE.Vector3(720,26,720);
 const pathPoints=[
  new THREE.Vector3(720,26,720),
  new THREE.Vector3(720,26,732),
  new THREE.Vector3(718,26,744),
  new THREE.Vector3(711,26,754),
  new THREE.Vector3(700,26,760),
  new THREE.Vector3(688,26,760),
  new THREE.Vector3(678,26,755)
 ];
 const curve=new THREE.CatmullRomCurve3(pathPoints,false,'centripetal');
 const samples=Array.from({length:41},(_,i)=>{const u=i/40,p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();return{u,p,t,n:new THREE.Vector3(-t.z,0,t.x)};});
 const entranceSpawn=curve.getPoint(.06),exitTrigger=new THREE.Vector3(720,26,717.8),oreRoom=curve.getPoint(.92);
 const colliders=[],proxyMeshes=[],lights=[],ownedGeo=new Set(),ownedMat=new Set(),ownedTex=new Set(),cache=new Map(),oreNodes=[];
 const loader=new FBXLoader(),texLoader=new THREE.TextureLoader();
 const proxyMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false});ownedMat.add(proxyMat);

 function qYaw(yaw){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);return{x:q.x,y:q.y,z:q.z,w:q.w};}
 function colliderBox(x,y,z,hx,hy,hz,yaw=0,friction=.95){
  const d=R.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setRotation(qYaw(yaw)).setFriction(friction);
  const c=world.createCollider(d);colliders.push(c);
  const g=new THREE.BoxGeometry(hx*2,hy*2,hz*2);ownedGeo.add(g);const m=new THREE.Mesh(g,proxyMat);m.position.set(x,y,z);m.rotation.y=yaw;m.name='mine16 collision proxy';root.add(m);proxyMeshes.push(m);island.collide.push(m);return c;
 }
 async function tex(path,srgb=true){const t=await texLoader.loadAsync(new URL(path,KIT).href);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;ownedTex.add(t);return t;}
 const mats={};
 for(const [k,[mapPath,normPath]] of Object.entries(TEX)){
  const [map,normalMap]=await Promise.all([tex(mapPath,true),tex(normPath,false)]);
  const m=new THREE.MeshStandardMaterial({map,normalMap,roughness:k==='lantern'?.72:.9,metalness:k==='rock'?.06:.02,transparent:k==='lantern',alphaTest:k==='lantern'?.1:0,side:THREE.DoubleSide});
  ownedMat.add(m);mats[k]=m;
 }
 async function proto(key){
  if(!cache.has(key)){
   const o=await loader.loadAsync(new URL(FILES[key],KIT).href);o.scale.setScalar(.01);o.updateMatrixWorld(true);
   const bb=new THREE.Box3().setFromObject(o),c=bb.getCenter(new THREE.Vector3());
   o.position.x-=c.x;o.position.z-=c.z;o.position.y-=bb.min.y;o.updateMatrixWorld(true);cache.set(key,o);
  }
  return cache.get(key).clone(true);
 }
 async function place(key,p,yaw=0,kind='stone',scale=1){
  const o=await proto(key);o.position.copy(p);o.rotation.y=yaw;o.scale.multiplyScalar(scale);o.name='mine16/'+key;root.add(o);
  o.traverse(m=>{if(m.isMesh){m.material=mats[kind]||mats.stone;m.castShadow=m.receiveShadow=true;}});
  return o;
 }
 function segmentPose(a,b){
  const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),yaw=Math.atan2(dx,dz),cx=(a.x+b.x)/2,cz=(a.z+b.z)/2;return{len,yaw,cx,cz};
 }
 // Simple collision corridor: floor/ceiling + side walls. Props never block movement.
 for(let i=0;i<samples.length-1;i++){
  const a=samples[i].p,b=samples[i+1].p,{len,yaw,cx,cz}=segmentPose(a,b);
  const halfW=3.25;
  colliderBox(cx,25.84,cz,halfW,.16,len/2+.08,yaw,1.0);
  const nx=-Math.cos(yaw),nz=Math.sin(yaw);
  for(const side of[-1,1])colliderBox(cx+nx*side*(halfW+.18),28.05,cz+nz*side*(halfW+.18),.25,2.35,len/2+.12,yaw,.9);
  colliderBox(cx,30.52,cz,halfW+.25,.18,len/2+.08,yaw,.9);
 }
 // Close the ore-room end; leave the entrance open.
 {const r=samples[samples.length-1],yaw=Math.atan2(r.t.x,r.t.z);colliderBox(r.p.x+r.t.x*1.0,28.0,r.p.z+r.t.z*1.0,3.35,2.2,.28,yaw,.9);}
 // Actual mine-kit tunnel visuals. Slight overlap hides bends without creating physics blockers.
 const visualUs=[.08,.24,.40,.56,.72,.88],visualKeys=['t1','t2','t3','t1','t2','t3'];
 for(let i=0;i<visualUs.length;i++){
  const u=visualUs[i],p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();const yaw=Math.atan2(t.x,t.z);
  await place(visualKeys[i],p,yaw,'stone',1.05);
 }
 // Timber supports, lights and clutter are visual-only.
 for(const [u,key] of [[.16,'support1'],[.34,'support2'],[.52,'support1'],[.70,'support2'],[.84,'support1']]){
  const p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();await place(key,p,Math.atan2(t.x,t.z),'wood',1);
 }
 for(const [u,side] of [[.22,-1],[.49,1],[.76,-1]]){
  const p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();const n=new THREE.Vector3(-t.z,0,t.x),yaw=Math.atan2(t.x,t.z),lp=p.clone().addScaledVector(n,side*2.45);
  await place('lantern',lp,yaw+(side<0?.15:-.15),'lantern',.9);
  const l=new THREE.PointLight('#ffc47a',10,14,1.8);l.position.set(lp.x,28.4,lp.z);root.add(l);lights.push(l);
 }
 const propDefs=[['crate',.12,-2.55,'crate',.85,.2],['crate',.32,2.55,'crate',.72,-.25],['planks',.60,-2.52,'wood',1,.35],['rock1',.80,2.65,'rock',.95,.1]];
 for(const [key,u,side,kind,scale,off] of propDefs){const p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();const n=new THREE.Vector3(-t.z,0,t.x);await place(key,p.clone().addScaledVector(n,side),Math.atan2(t.x,t.z)+off,kind,scale);}
 // Rails/ties on centre path.
 const railMat=new THREE.MeshStandardMaterial({color:'#54595d',metalness:.4,roughness:.55}),tieMat=new THREE.MeshStandardMaterial({color:'#6f5137',roughness:.92});ownedMat.add(railMat);ownedMat.add(tieMat);
 const railG=new THREE.BoxGeometry(.09,.07,1.55),tieG=new THREE.BoxGeometry(1.65,.08,.18);ownedGeo.add(railG);ownedGeo.add(tieG);
 for(let i=2;i<39;i+=2){const r=samples[i],yaw=Math.atan2(r.t.x,r.t.z);for(const side of[-.55,.55]){const p=r.p.clone().addScaledVector(r.n,side);const m=new THREE.Mesh(railG,railMat);m.position.set(p.x,26.10,p.z);m.rotation.y=yaw;root.add(m);}const tie=new THREE.Mesh(tieG,tieMat);tie.position.set(r.p.x,26.05,r.p.z);tie.rotation.y=yaw;root.add(tie);}
 // Ore nodes use the game's existing Ore FBX + mine.js ore names.
 const oreTypes=[['철광석',0x6b7686,.68,.38],['구리',0xc16a38,.82,.34],['코발트',0x2f55d4,.55,.28],['석탄',0x25272b,.06,.74],['금',0xe6b73a,.94,.24]];
 for(const [idx,u,side,scale] of [[0,.30,1,1],[1,.43,-1,.9],[2,.61,1,1.02],[3,.75,-1,.9],[4,.90,1,1.05]]){
  const [name,color,metalness,roughness]=oreTypes[idx],p=curve.getPoint(u),t=curve.getTangent(u);t.y=0;t.normalize();const n=new THREE.Vector3(-t.z,0,t.x),op=p.clone().addScaledVector(n,side*2.75);
  const o=await proto('ore');o.position.set(op.x,26.05,op.z);o.rotation.y=Math.atan2(t.x,t.z)+side*.45;o.scale.multiplyScalar(scale);o.name='mine16 ore / '+name;o.userData.ore=name;
  const om=mats.rock.clone();om.color.setHex(color);om.metalness=metalness;om.roughness=roughness;om.emissive=new THREE.Color(color).multiplyScalar(.06);om.emissiveIntensity=.12;ownedMat.add(om);
  o.traverse(m=>{if(m.isMesh){m.material=om;m.castShadow=m.receiveShadow=true;m.userData.ore=name;}});root.add(o);oreNodes.push(o);
 }
 // Local ambient keeps the interior readable without changing the island.
 const hemi=new THREE.HemisphereLight('#8b8f87','#171918',.48);root.add(hemi);
 const entryLight=new THREE.PointLight('#ffd09a',7,12,1.7);entryLight.position.set(720,28.4,724);root.add(entryLight);lights.push(entryLight);

 // Fade overlay hides the coordinate swap.
 const fade=document.createElement('div');Object.assign(fade.style,{position:'fixed',inset:'0',background:'#070908',opacity:'0',pointerEvents:'none',transition:'opacity 160ms ease',zIndex:'9999'});document.body.appendChild(fade);
 let zone='island',busy=false,cooldown=0,cameraCorrections=0;
 const saved={background:scene.background,fog:scene.fog,hemi:ctx.hemi?.intensity,sun:ctx.sun?.intensity,fill:ctx.fill?.intensity,amb:ctx.amb?.intensity};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function swap(fn,instant=false){
  if(busy)return;busy=true;
  if(!instant){fade.style.opacity='1';await wait(175);}
  fn();ctx.stepPhysics?.();
  if(!instant){await wait(80);fade.style.opacity='0';await wait(190);}
  busy=false;cooldown=.75;
 }
 function setMineLook(){scene.background=new THREE.Color('#0b0d0c');scene.fog=new THREE.Fog('#0b0d0c',8,48);if(ctx.hemi)ctx.hemi.intensity=.16;if(ctx.sun)ctx.sun.intensity=.10;if(ctx.fill)ctx.fill.intensity=.08;if(ctx.amb)ctx.amb.intensity=.08;}
 function restoreLook(){scene.background=saved.background;scene.fog=saved.fog;if(ctx.hemi&&saved.hemi!=null)ctx.hemi.intensity=saved.hemi;if(ctx.sun&&saved.sun!=null)ctx.sun.intensity=saved.sun;if(ctx.fill&&saved.fill!=null)ctx.fill.intensity=saved.fill;if(ctx.amb&&saved.amb!=null)ctx.amb.intensity=saved.amb;}
 async function enterMine({instant=false}={}){
  if(zone==='mine')return;
  await swap(()=>{root.visible=true;zone='mine';setMineLook();ctx.player.setSpawn(entranceSpawn.x,27.45,entranceSpawn.z);ctx.player.setYaw(Math.PI);ctx.player.setPitch(.06);document.getElementById('location')&&(document.getElementById('location').textContent='바위그늘 광산 · 내부');},instant);
 }
 async function exitMine({instant=false}={}){
  if(zone!=='mine')return;
  await swap(()=>{zone='island';restoreLook();root.visible=false;const y=island.groundAt(exteriorReturn.x,exteriorReturn.z,100)+1.5;ctx.player.setSpawn(exteriorReturn.x,y,exteriorReturn.z);ctx.player.setYaw(Math.atan2(-fx,fz));ctx.player.setPitch(.10);document.getElementById('location')&&(document.getElementById('location').textContent='바위그늘 광산');},instant);
 }
 function exteriorDistance(){const p=ctx.player.pos;return Math.hypot(p.x-exteriorDoor.x,p.z-exteriorDoor.z);}
 // Camera correction only inside the mine and only against interior collision proxies.
 const ray=new THREE.Raycaster(),eye=new THREE.Vector3(),dir=new THREE.Vector3();
 const hook=ctx.onUpdate(dt=>{
  cooldown=Math.max(0,cooldown-dt);
  const p=ctx.player?.pos;if(!p||busy)return;
  if(zone==='island'&&cooldown<=0&&exteriorDistance()<2.15){enterMine();}
  else if(zone==='mine'&&cooldown<=0&&Math.hypot(p.x-exitTrigger.x,p.z-exitTrigger.z)<1.5){exitMine();}
  if(zone==='mine'&&ctx.player.third){eye.set(p.x,p.y+.48,p.z);dir.copy(ctx.camera.position).sub(eye);const length=dir.length();if(length>.2){ray.set(eye,dir.normalize());ray.far=length+.2;const hit=ray.intersectObjects(proxyMeshes,true).find(h=>h.distance>.08);if(hit&&hit.distance<length+.12){ctx.camera.position.copy(eye).addScaledVector(dir,Math.max(.25,hit.distance-.25));cameraCorrections++;}}}
 });
 async function testMineRoute(reverse=false){
  const emit=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),old=ctx.getRenderOverride(),pts=(reverse?samples.slice().reverse():samples).filter((_,i)=>i%4===0||i===samples.length-1),result={reverse,pass:true,failed:null,travel:0};
  try{
   root.visible=true;zone='mine';setMineLook();const s=pts[0].p;ctx.player.setSpawn(s.x,27.45,s.z);for(let i=0;i<50;i++)ctx.tick(1/60);ctx.setRenderOverride(()=>{});emit('keydown','KeyW');let prev={...ctx.player.pos};
   for(let j=1;j<pts.length;j++){const t=pts[j].p;let n=0;while(Math.hypot(t.x-ctx.player.pos.x,t.z-ctx.player.pos.z)>.72&&n<220){const p=ctx.player.pos;ctx.player.setYaw(Math.atan2(t.x-p.x,p.z-t.z));ctx.tick(1/60);n++;const q=ctx.player.pos;result.travel+=Math.hypot(q.x-prev.x,q.z-prev.z);prev={...q};if(!Number.isFinite(q.y)||q.y<20){result.pass=false;result.failed={j,reason:'fell',pos:{...q}};break;}}if(!result.pass)break;if(n>=220){result.pass=false;result.failed={j,reason:'blocked',pos:{...ctx.player.pos},target:[t.x,t.z]};break;}}
  }finally{emit('keyup','KeyW');ctx.setRenderOverride(old);ctx.renderer.render(scene,ctx.camera);}
  result.travel=+result.travel.toFixed(2);return result;
 }
 const previousDispose=island.dispose;island.dispose=()=>{ctx.offUpdate(hook);fade.remove();restoreLook();root.removeFromParent();for(const c of colliders)try{world.removeCollider(c,true);}catch{}for(const m of proxyMeshes){const i=island.collide.indexOf(m);if(i>=0)island.collide.splice(i,1);}ownedGeo.forEach(g=>g.dispose());ownedMat.forEach(m=>m.dispose());ownedTex.forEach(t=>t.dispose());previousDispose();};
 const api={get current(){return zone;},root,enterMine,exitMine,testMineRoute,exteriorDoor,exteriorReturn,interiorSpawn:entranceSpawn,oreRoom,oreNodes,samples,get cameraCorrections(){return cameraCorrections;}};
 ctx.zone=api;island.zone=api;island.mineOreNodes=oreNodes;island.qualityVersion='aurora-v16-interior-zone';
 return api;
}
