/** Windgate 17 — reset art pass.
 * Stable v7 outdoor island + hand-authored POI dressing.
 * No terrain carving, no mine interior, no gameplay collider on decorative props.
 */
import * as THREE from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {BUILDINGS,SUMMIT} from './aurora-refuge-field.js';

const KIT=new URL('../mine-kit/',import.meta.url).href;
const MINE_FILES={
  crate:'Models/Props/Crate.fbx',planks:'Models/Props/Planks.fbx',lantern:'Models/Props/Lantern.fbx',
  ore:'Models/Rocks/Ore.fbx',rock1:'Models/Rocks/Rock1.fbx',rock2:'Models/Rocks/Rock2.fbx'
};
const TEX={
  wood:['Models/Props/Materials/Wood_AlbedoSmoothness.png','Models/Props/Materials/Wood_Normal.png'],
  crate:['Models/Props/Materials/Crate_Albedo.png','Models/Props/Materials/Crate_Normal.png'],
  lantern:['Models/Props/Materials/Lantern_AlbedoTransparency.png','Models/Props/Materials/Lantern_Normal.png'],
  rock:['Models/Rocks/Materials/Rock1_AlbedoSmoothness.png','Models/Rocks/Materials/Rock1_Normal.png']
};
const rng=(()=>{let s=170927;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export async function authorWindgate17(ctx,island){
  const root=new THREE.Group();root.name='Windgate 17 / authored exterior POIs';island.root.add(root);
  const loader=new FBXLoader(),texLoader=new THREE.TextureLoader(),cache=new Map(),mats={},ownedTex=new Set(),ownedMat=new Set(),lights=[];
  async function tex(path,srgb=true){const t=await texLoader.loadAsync(new URL(path,KIT).href);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;ownedTex.add(t);return t;}
  for(const [k,[a,n]] of Object.entries(TEX)){const [map,normalMap]=await Promise.all([tex(a,true),tex(n,false)]);const m=new THREE.MeshStandardMaterial({map,normalMap,roughness:k==='lantern'?.72:.9,metalness:k==='rock'?.04:.01,transparent:k==='lantern',alphaTest:k==='lantern'?.12:0});ownedMat.add(m);mats[k]=m;}
  async function proto(key){if(!cache.has(key)){const o=await loader.loadAsync(new URL(MINE_FILES[key],KIT).href);o.scale.setScalar(.01);o.updateMatrixWorld(true);const bb=new THREE.Box3().setFromObject(o),c=bb.getCenter(new THREE.Vector3());o.position.x-=c.x;o.position.z-=c.z;o.position.y-=bb.min.y;o.updateMatrixWorld(true);cache.set(key,o);}return cache.get(key).clone(true);}
  async function place(key,x,z,yaw=0,kind='rock',scale=1,yOffset=0){
    const o=await proto(key);const y=island.groundAt(x,z,100)+yOffset;o.position.set(x,y,z);o.rotation.y=yaw;o.scale.multiplyScalar(scale);o.name='windgate17/'+key;root.add(o);
    o.traverse(m=>{if(m.isMesh){m.material=mats[kind]||mats.rock;m.castShadow=m.receiveShadow=true;}});return o;
  }
  function mat(c,o={}){const m=new THREE.MeshStandardMaterial({color:c,roughness:.92,...o});ownedMat.add(m);return m;}
  const dark=mat('#1d2826',{roughness:1}),iron=mat('#4d5659',{metalness:.36,roughness:.62}),earth=mat('#756a56');
  function box(x,y,z,s,m,yaw=0){const g=new THREE.BoxGeometry(1,1,1),o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=yaw;o.castShadow=o.receiveShadow=true;root.add(o);return o;}
  function railLine(points){
    for(let i=0;i<points.length-1;i++){
      const a=new THREE.Vector3(...points[i]),b=new THREE.Vector3(...points[i+1]),d=b.clone().sub(a),len=d.length(),yaw=Math.atan2(d.x,d.z),n=new THREE.Vector3(-Math.cos(yaw),0,Math.sin(yaw));
      for(const side of[-.58,.58]){const p=a.clone().add(b).multiplyScalar(.5).addScaledVector(n,side);box(p.x,p.y+.07,p.z,[.08,.06,len/2],iron,yaw);}
      const ties=Math.max(2,Math.floor(len/1.15));for(let j=0;j<=ties;j++){const t=j/ties,p=a.clone().lerp(b,t);box(p.x,p.y+.02,p.z,[1.45,.06,.14],earth,yaw);}
    }
  }

  // --- Mine yard: one authored composition, no tunnel outside the mountain.
  const mine=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48,y:35,yaw:.55};
  const approach=island.field.points.find(p=>p.id==='cave')||{x:-97,z:-34,y:33};
  const dx=mine.x-approach.x,dz=mine.z-approach.z,L=Math.hypot(dx,dz)||1,fx=dx/L,fz=dz/L,sx=-fz,sz=fx,yaw=Math.atan2(fx,fz);
  const entryX=mine.x-fx*5.1,entryZ=mine.z-fz*5.1,entryY=island.groundAt(entryX,entryZ,100);
  // dark recess just behind the existing building opening; purely visual.
  const recess=new THREE.Mesh(new THREE.PlaneGeometry(4.6,4.1),dark);recess.position.set(entryX,entryY+2.05,entryZ);recess.rotation.y=yaw;recess.name='Mine visual recess';root.add(recess);
  railLine([
    [approach.x,island.groundAt(approach.x,approach.z,100)+.02,approach.z],
    [mine.x-fx*8.5,island.groundAt(mine.x-fx*8.5,mine.z-fz*8.5,100)+.02,mine.z-fz*8.5],
    [mine.x-fx*3.8,island.groundAt(mine.x-fx*3.8,mine.z-fz*3.8,100)+.02,mine.z-fz*3.8]
  ]);
  // Outer rock shoulders make the building read as embedded in a cut, not placed on grass.
  for(const [sideSign,dist,scale] of [[-1,4.9,1.35],[-1,7.1,1.0],[1,5.2,1.45],[1,7.4,.95]]){
    const x=mine.x+sx*sideSign*dist-fx*.4,z=mine.z+sz*sideSign*dist-fz*.4;
    await place(rng()<.5?'rock1':'rock2',x,z,yaw+rng()*.4-.2,'rock',scale);
  }
  // Working yard clusters, deliberately asymmetric and kept off the walking line.
  await place('planks',mine.x+sx*5.7-fx*6.8,mine.z+sz*5.7-fz*6.8,yaw+.2,'wood',1.0);
  await place('crate',mine.x-sx*5.9-fx*5.5,mine.z-sz*5.9-fz*5.5,yaw-.25,'crate',.9);
  await place('crate',mine.x-sx*7.0-fx*4.2,mine.z-sz*7.0-fz*4.2,yaw+.35,'crate',.72);
  // Exposed ore seam around the entrance tells the player why this mine exists.
  const ores=[
    ['#677688',mine.x+sx*4.3-fx*1.7,mine.z+sz*4.3-fz*1.7,.82],
    ['#b7643a',mine.x-sx*4.6-fx*1.2,mine.z-sz*4.6-fz*1.2,.74],
    ['#d5a93b',mine.x+sx*5.6+fx*.5,mine.z+sz*5.6+fz*.5,.52]
  ];
  for(const [color,x,z,scale] of ores){const o=await place('ore',x,z,yaw+(rng()-.5)*.7,'rock',scale);const om=mats.rock.clone();ownedMat.add(om);om.color.set(color);om.emissive=new THREE.Color(color).multiplyScalar(.04);om.emissiveIntensity=.12;o.traverse(m=>{if(m.isMesh)m.material=om;});}
  // Warm light inside, no giant signboard.
  const lp=new THREE.Vector3(entryX,entryY+2.4,entryZ).add(new THREE.Vector3(fx,0,fz).multiplyScalar(.8));const lantern=await place('lantern',lp.x,lp.z,yaw,'lantern',.82,2.0);
  const light=new THREE.PointLight('#f4b56d',8,12,1.7);light.position.copy(lp);root.add(light);lights.push(light);

  // --- Harbor: only small lived-in clusters; leave open space around movement and dock.
  const harbor=BUILDINGS.find(b=>b.id==='harbor');
  if(harbor){
    const hy=island.groundAt(harbor.x,harbor.z,100);
    await place('crate',harbor.x-8.3,harbor.z+5.2,-.2,'crate',.76);
    await place('planks',harbor.x-6.9,harbor.z+7.0,.35,'wood',.85);
    const hg=new THREE.PlaneGeometry(3.5,2.2),hm=mat('#9c8664',{side:THREE.DoubleSide});
    const awning=new THREE.Mesh(hg,hm);awning.position.set(harbor.x+6.2,hy+3.1,harbor.z+3.5);awning.rotation.x=-Math.PI/2+.16;awning.rotation.z=.12;root.add(awning);
  }

  // --- Summit: reduce clutter, add only a few weathered stones beyond the existing portal.
  for(const [a,r,s] of [[.7,12.2,1.15],[2.3,11.5,.85],[4.7,13.0,1.0]]){
    const x=SUMMIT.x+Math.cos(a)*r,z=SUMMIT.z+Math.sin(a)*r;await place('rock2',x,z,a,'rock',s);
  }

  island.field.points.push({id:'mine-yard17',name:'바위그늘 광산 앞마당',x:approach.x,y:island.groundAt(approach.x,approach.z,100),z:approach.z,r:6,target:[mine.x,mine.y+2,mine.z],text:'암맥을 따라 만들어진 작업 광산'});
  island.authored17={mineYard:true,harborCluster:true,summitRestraint:true,terrainCarved:false,decorativeColliders:false};
  island.qualityVersion='aurora-v17-reset-authored-exterior';
  const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;root.removeFromParent();ownedTex.forEach(t=>t.dispose());ownedMat.forEach(m=>m.dispose());lights.forEach(l=>l.removeFromParent());prev();};
  return island.authored17;
}
