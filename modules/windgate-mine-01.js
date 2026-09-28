/** TOMOB · Windgate Mine 01
 * Hand-authored small mine level: entrance -> hub -> optional ore pocket -> main loop -> deep workroom -> hub.
 * Native player.js/physics.js remain unchanged. Props are visual; collision is simple authored floor/wall/ceiling.
 */
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';

const KIT=new URL('../mine-kit/',import.meta.url).href;
const FILES={
 support1:'Models/Props/Support1.fbx',support2:'Models/Props/Support2.fbx',lantern:'Models/Props/Lantern.fbx',
 crate:'Models/Props/Crate.fbx',planks:'Models/Props/Planks.fbx',ore:'Models/Rocks/Ore.fbx',
 rock1:'Models/Rocks/Rock1.fbx',rock2:'Models/Rocks/Rock2.fbx'
};
const TEX={
 wood:['Models/Props/Materials/Wood_AlbedoSmoothness.png','Models/Props/Materials/Wood_Normal.png'],
 crate:['Models/Props/Materials/Crate_Albedo.png','Models/Props/Materials/Crate_Normal.png'],
 lantern:['Models/Props/Materials/Lantern_AlbedoTransparency.png','Models/Props/Materials/Lantern_Normal.png'],
 rock:['Models/Rocks/Materials/Rock1_AlbedoSmoothness.png','Models/Rocks/Materials/Rock1_Normal.png']
};
const rnd=(()=>{let s=180928;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export async function initWindgateMine01(ctx){
 const {scene,world,RAPIER:R}=ctx,root=new THREE.Group();root.name='Windgate Mine 01';scene.add(root);
 const gs=new Set(),ms=new Set(),ts=new Set(),colliders=[],proxy=[],oreNodes=[],lights=[],cache=new Map(),loader=new FBXLoader(),texLoader=new THREE.TextureLoader();
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,...o});ms.add(m);return m;};
 const ground=mat('#6f6656'),rock=mat('#65736a',{flatShading:true}),rockDark=mat('#47534e',{flatShading:true}),timber=mat('#74583f'),railM=mat('#4d5559',{metalness:.35,roughness:.6}),runeM=new THREE.LineBasicMaterial({color:'#5faaa2',transparent:true,opacity:.55});ms.add(runeM);
 const proxyMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,colorWrite:false});ms.add(proxyMat);
 const rockG=new THREE.DodecahedronGeometry(1,0);gs.add(rockG);
 const boxG=new THREE.BoxGeometry(1,1,1);gs.add(boxG);

 function qYaw(yaw){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);return{x:q.x,y:q.y,z:q.z,w:q.w};}
 function addCollider(x,y,z,hx,hy,hz,yaw=0){
   const c=world.createCollider(R.ColliderDesc.cuboid(hx,hy,hz).setTranslation(x,y,z).setRotation(qYaw(yaw)).setFriction(.96));colliders.push(c);
   const m=new THREE.Mesh(new THREE.BoxGeometry(hx*2,hy*2,hz*2),proxyMat);gs.add(m.geometry);m.position.set(x,y,z);m.rotation.y=yaw;m.name='mine01 proxy';root.add(m);proxy.push(m);return c;
 }
 function visBox(x,y,z,s,m=ground,yaw=0){const o=new THREE.Mesh(boxG,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=yaw;o.castShadow=o.receiveShadow=true;root.add(o);return o;}
 function seg(a,b,width=6.4,height=5.1){
   const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=Math.hypot(d.x,d.z),yaw=Math.atan2(d.x,d.z),mid=A.clone().add(B).multiplyScalar(.5);
   // floor and ceiling
   addCollider(mid.x,-.18,mid.z,width/2,.18,len/2+.08,yaw);
   addCollider(mid.x,height+.18,mid.z,width/2,.18,len/2+.08,yaw);
   visBox(mid.x,-.10,mid.z,[width/2,.10,len/2],ground,yaw);
   visBox(mid.x,height+.10,mid.z,[width/2,.14,len/2],rockDark,yaw);
   // side walls: visual and physics share the same transform.
   const nx=-Math.cos(yaw),nz=Math.sin(yaw),off=width/2+.18;
   for(const side of[-1,1]){
     const wx=mid.x+nx*side*off,wz=mid.z+nz*side*off;
     addCollider(wx,height/2,wz,.25,height/2,len/2+.12,yaw);
     visBox(wx,height/2,wz,[.24,height/2,len/2+.10],rock,yaw);
   }
   // irregular rock dressing on both sides
   const count=Math.max(3,Math.floor(len/2.2));
   for(let i=0;i<=count;i++){const t=i/count,p=A.clone().lerp(B,t);for(const side of[-1,1]){if(rnd()<.18)continue;const o=new THREE.Mesh(rockG,rnd()<.3?rockDark:rock);o.position.set(p.x+nx*side*(width/2+.45+(rnd()-.5)*.4),.55+rnd()*1.4,p.z+nz*side*(width/2+.45+(rnd()-.5)*.4));const s=.75+rnd()*1.25;o.scale.set(s,1.1+rnd()*1.5,s*.9);o.rotation.set((rnd()-.5)*.2,rnd()*6.28,(rnd()-.5)*.16);o.castShadow=o.receiveShadow=true;root.add(o);}}
   // ceiling chunks; sparse enough to avoid a perfect tube
   for(let i=1;i<count;i+=2){const t=i/count,p=A.clone().lerp(B,t),o=new THREE.Mesh(rockG,rockDark);o.position.set(p.x,height-.25,p.z);o.scale.set(2.4+rnd()*1.2,.65+rnd()*.4,2.0+rnd()*1.0);o.rotation.y=rnd()*6.28;o.castShadow=o.receiveShadow=true;root.add(o);}
   return {yaw,len};
 }
 function room(x,z,w,d,openings={}){
   addCollider(x,-.18,z,w/2,.18,d/2);visBox(x,-.10,z,[w/2,.10,d/2],ground);
   addCollider(x,5.3,z,w/2,.18,d/2);visBox(x,5.22,z,[w/2,.14,d/2],rockDark);
   // wall helper with a central 4m opening if requested
   const wall=(side,open)=>{
     if(side==='north'||side==='south'){
       const zz=z+(side==='north'?d/2+.18:-d/2-.18),len=w;
       if(open){const part=(len-4.2)/4;for(const s of[-1,1]){const xx=x+s*(2.1+part);addCollider(xx,2.55,zz,part,2.55,.25);visBox(xx,2.55,zz,[part,2.55,.24],rock);}}
       else {addCollider(x,2.55,zz,w/2,2.55,.25);visBox(x,2.55,zz,[w/2,2.55,.24],rock);}
     } else {
       const xx=x+(side==='east'?w/2+.18:-w/2-.18),len=d;
       if(open){const part=(len-4.2)/4;for(const s of[-1,1]){const zz=z+s*(2.1+part);addCollider(xx,2.55,zz,.25,2.55,part);visBox(xx,2.55,zz,[.24,2.55,part],rock);}}
       else {addCollider(xx,2.55,z,.25,2.55,d/2);visBox(xx,2.55,z,[.24,2.55,d/2],rock);}
     }
   };
   wall('north',openings.north);wall('south',openings.south);wall('east',openings.east);wall('west',openings.west);
   // boulders sit outside the walkable footprint
   for(let i=0;i<18;i++){const side=Math.floor(rnd()*4),o=new THREE.Mesh(rockG,rnd()<.25?rockDark:rock),pad=.5+rnd()*.8;let px=x,pz=z;if(side===0){px=x+(rnd()-.5)*w;pz=z-d/2-pad;}if(side===1){px=x+(rnd()-.5)*w;pz=z+d/2+pad;}if(side===2){px=x-w/2-pad;pz=z+(rnd()-.5)*d;}if(side===3){px=x+w/2+pad;pz=z+(rnd()-.5)*d;}o.position.set(px,.6+rnd()*1.4,pz);const s=.7+rnd()*1.3;o.scale.set(s,1+rnd()*1.4,s);o.rotation.y=rnd()*6.28;o.castShadow=o.receiveShadow=true;root.add(o);}
 }
 // Layout: entrance -> hub -> optional left pocket; main route loops back to hub.
 seg([0,0,0],[0,0,16],6.3);
 room(0,22,12,12,{south:true,east:true,west:true,north:true});
 seg([6,0,22],[14,0,22],6.0);seg([14,0,22],[14,0,40],6.0);
 room(14,46,12,12,{south:true,west:true});
 seg([8,0,46],[4,0,46],5.8);seg([4,0,46],[0,0,38],5.8);seg([0,0,38],[0,0,28],5.8);
 // optional ore pocket
 seg([-6,0,22],[-18,0,22],5.6);room(-23,22,10,9,{east:true});

 // Actual mine props are visual only.
 async function tex(path,srgb=true){const t=await texLoader.loadAsync(new URL(path,KIT).href);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;ts.add(t);return t;}
 const mats={};for(const [k,[a,n]] of Object.entries(TEX)){const [map,normalMap]=await Promise.all([tex(a,true),tex(n,false)]);const m=new THREE.MeshStandardMaterial({map,normalMap,roughness:k==='lantern'?.72:.9,transparent:k==='lantern',alphaTest:k==='lantern'?.12:0});ms.add(m);mats[k]=m;}
 async function proto(key){if(!cache.has(key)){const o=await loader.loadAsync(new URL(FILES[key],KIT).href);o.scale.setScalar(.01);o.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(o),c=bb.getCenter(new THREE.Vector3());o.position.x-=c.x;o.position.z-=c.z;o.position.y-=bb.min.y;o.updateMatrixWorld(true);cache.set(key,o);}return cache.get(key).clone(true);}
 async function prop(key,x,z,yaw=0,kind='wood',scale=1,y=.02){const o=await proto(key);o.position.set(x,y,z);o.rotation.y=yaw;o.scale.multiplyScalar(scale);o.name='mine01/'+key;root.add(o);o.traverse(m=>{if(m.isMesh){m.material=mats[kind]||mats.rock;m.castShadow=m.receiveShadow=true;}});return o;}
 for(const [x,z,yaw,key] of [[0,7,0,'support1'],[0,14,0,'support2'],[8,22,Math.PI/2,'support1'],[14,29,0,'support2'],[14,37,0,'support1'],[5,46,Math.PI/2,'support2'],[0,33,0,'support1'],[-12,22,Math.PI/2,'support1']])await prop(key,x,z,yaw,'wood',1);
 for(const [x,z] of [[0,10],[14,31],[6,46],[-15,22]]){await prop('lantern',x+2.35,z,0,'lantern',.9,2.1);const l=new THREE.PointLight('#ffc176',9,14,1.7);l.position.set(x+2.35,2.7,z);root.add(l);lights.push(l);}
 await prop('crate',-3.8,20,.2,'crate',.85);await prop('planks',4.4,24,-.2,'wood',.9);await prop('crate',17.5,44,-.4,'crate',.75);

 // Rails define the main production loop, but optional branch is foot-only.
 function rails(points){for(let i=0;i<points.length-1;i++){const A=new THREE.Vector3(...points[i]),B=new THREE.Vector3(...points[i+1]),d=B.clone().sub(A),len=Math.hypot(d.x,d.z),yaw=Math.atan2(d.x,d.z),n=new THREE.Vector3(-Math.cos(yaw),0,Math.sin(yaw)),mid=A.clone().add(B).multiplyScalar(.5);for(const side of[-.52,.52]){const p=mid.clone().addScaledVector(n,side);visBox(p.x,.08,p.z,[.06,.045,len/2],railM,yaw);}const ties=Math.max(2,Math.floor(len/1.1));for(let j=0;j<=ties;j++){const p=A.clone().lerp(B,j/ties);visBox(p.x,.035,p.z,[.72,.04,.08],timber,yaw);}}}
 rails([[0,0,0],[0,0,16],[0,0,22],[6,0,22],[14,0,22],[14,0,40],[14,0,46],[8,0,46],[4,0,46],[0,0,38],[0,0,28],[0,0,22]]);

 // Ores: optional pocket is common metal, deep room is rarer ore.
 const oreDefs=[
  ['철광석',0x6d7785,-25,20,1.0],['구리',0xb9673d,-22,25,.9],
  ['석탄',0x26282b,16.9,42,.95],['코발트',0x3458cc,18.2,47,1.05],['금',0xdfb33f,11.0,49,.82]
 ];
 for(const [name,color,x,z,scale] of oreDefs){const o=await prop('ore',x,z,rnd()*6.28,'rock',scale,.05),m=mats.rock.clone();ms.add(m);m.color.setHex(color);m.metalness=name==='금'?.85:name==='석탄'?.04:.5;m.roughness=name==='석탄'?.75:.35;m.emissive=new THREE.Color(color).multiplyScalar(.06);m.emissiveIntensity=.1;o.userData.ore=name;o.traverse(q=>{if(q.isMesh){q.material=m;q.userData.ore=name;}});oreNodes.push(o);}

 // Old-world trace in deep room: understated submerged-civilization masonry/rune.
 for(const [x,z,s] of [[10.2,50.2,[1.4,.22,.9]],[8.6,49.1,[.9,.18,1.2]],[17.5,50.6,[1.0,.18,.8]]])visBox(x,.14,z,s,rockDark,(rnd()-.5)*.4);
 const rp=[];for(let i=0;i<24;i++){const a=i/24*Math.PI*2,r=2.15;rp.push(14+Math.cos(a)*r,.23,46+Math.sin(a)*r,14+Math.cos(a+.12)*r,.23,46+Math.sin(a+.12)*r);}const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(rp,3));gs.add(rg);root.add(new THREE.LineSegments(rg,runeM));

 // Entrance/exit prompt.
 const prompt=document.createElement('div');prompt.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border:1px solid #ffffff70;border-radius:6px;background:#0d2025e8;font-weight:700;margin-right:10px">E</span><span>섬으로 나가기</span>';Object.assign(prompt.style,{position:'fixed',left:'50%',bottom:'92px',transform:'translateX(-50%)',zIndex:'45',display:'none',alignItems:'center',padding:'10px 14px',background:'#132a30e8',border:'1px solid #ffffff2b',borderRadius:'8px',color:'#efe8d5',font:'14px system-ui,sans-serif',boxShadow:'0 10px 30px #0007',pointerEvents:'none'});document.body.appendChild(prompt);
 const fade=document.createElement('div');Object.assign(fade.style,{position:'fixed',inset:'0',zIndex:'9999',background:'#050707',opacity:'0',transition:'opacity 180ms ease',pointerEvents:'none'});document.body.appendChild(fade);
 let exitActive=false,busy=false;
 const exitPos={x:0,z:1.4,r:3.0};
 const canExit=()=>{const p=ctx.player?.pos;return !!p&&Math.hypot(p.x-exitPos.x,p.z-exitPos.z)<exitPos.r;};
 const hook=ctx.onUpdate(()=>{exitActive=canExit();prompt.style.display=exitActive&&!busy?'flex':'none';});
 async function leave(){if(!canExit()||busy)return;busy=true;prompt.style.display='none';fade.style.opacity='1';await new Promise(r=>setTimeout(r,220));const q=new URLSearchParams(location.search),ret=q.get('return')||sessionStorage.getItem('tomob:instance-return')||'./sandbox-aurora-v18.html?place=mine-yard17&from=mine';location.href=ret;}
 const offE=ctx.input?.register?ctx.input.register('KeyE',()=>leave(),{when:()=>canExit()}):(()=>{const h=e=>{if(e.code==='KeyE'&&!e.repeat)leave();};addEventListener('keydown',h);return()=>removeEventListener('keydown',h);})();

 // Camera collision against authored proxy walls.
 const ray=new THREE.Raycaster(),eye=new THREE.Vector3(),dir=new THREE.Vector3();ray.firstHitOnly=true;let cameraCorrections=0;
 const camHook=ctx.onUpdate(()=>{if(!ctx.player?.third)return;const p=ctx.player.pos;eye.set(p.x,p.y+.48,p.z);dir.copy(ctx.camera.position).sub(eye);const len=dir.length();if(len<.2)return;ray.set(eye,dir.normalize());ray.far=len+.2;const h=ray.intersectObjects(proxy,true).find(h=>h.distance>.08);if(h&&h.distance<len+.1){ctx.camera.position.copy(eye).addScaledVector(dir,Math.max(.25,h.distance-.25));cameraCorrections++;}});

 const routes={
  main:[[0,2],[0,22],[14,22],[14,46],[8,46],[0,38],[0,22],[0,2]],
  pocket:[[0,22],[-18,22],[-23,22],[-18,22],[0,22]]
 };
 async function testRoute(name='main',step=1/60){
   const pts=routes[name];if(!pts)throw new Error('Unknown route '+name);
   const emit=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),old=ctx.getRenderOverride(),result={name,pass:true,failed:null,travel:0};ctx.setRenderOverride(()=>{});
   try{const s=pts[0];ctx.player.setSpawn(s[0],1.55,s[1]);for(let i=0;i<30;i++)ctx.tick(step);emit('keydown','KeyW');emit('keydown','ShiftLeft');let prev={...ctx.player.pos};
     for(let j=1;j<pts.length;j++){const t=pts[j];let n=0;while(Math.hypot(t[0]-ctx.player.pos.x,t[1]-ctx.player.pos.z)>.72&&n<120){const p=ctx.player.pos;ctx.player.setYaw(Math.atan2(t[0]-p.x,p.z-t[1]));ctx.tick(step);n++;const q=ctx.player.pos;result.travel+=Math.hypot(q.x-prev.x,q.z-prev.z);prev={...q};if(!Number.isFinite(q.y)||q.y<-5){result.pass=false;result.failed={j,reason:'fell',pos:{...q}};break;}}if(!result.pass)break;if(n>=120){result.pass=false;result.failed={j,reason:'blocked',pos:{...ctx.player.pos},target:t};break;}}
   }finally{emit('keyup','KeyW');emit('keyup','ShiftLeft');ctx.setRenderOverride(old);ctx.renderer.render(scene,ctx.camera);}result.travel=+result.travel.toFixed(2);return result;
 }

 const spawn={x:0,y:1.55,z:3.2};
 const api={root,spawn,collide:proxy,oreNodes,routes,testRoute,groundAt:()=>0,canExit,get cameraCorrections(){return cameraCorrections;},dispose(){
   ctx.offUpdate(hook);ctx.offUpdate(camHook);offE?.();prompt.remove();fade.remove();root.removeFromParent();
   for(const c of colliders)try{world.removeCollider(c,true);}catch{}gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());lights.forEach(l=>l.removeFromParent());
 }};
 ctx.terrain=api;ctx.mine=api;return api;
}