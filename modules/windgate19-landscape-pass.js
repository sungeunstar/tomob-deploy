/** Windgate 19 — authored route composition.
 * The terrain now carries the large-scale occlusion; this pass composes vegetation and rock
 * shoulders so the player reads one outdoor "room" at a time instead of the whole route.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BUILDINGS,SUMMIT} from './aurora-refuge-field-v19.js';

const seeded=(()=>{let s=180928;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();
const TREE_FILES=['Tree_1_A_Color1.gltf','Tree_2_A_Color1.gltf','Tree_3_B_Color1.gltf','Tree_4_A_Color1.gltf'];

export async function authorWindgate19(ctx,island){
  const root=new THREE.Group();
  root.name='Windgate 19 / authored exploration rooms';
  island.root.add(root);

  const ownedG=new Set(),ownedM=new Set(),hidden=[];
  const mat=(color,opts={})=>{const m=new THREE.MeshStandardMaterial({color,roughness:.96,flatShading:true,...opts});ownedM.add(m);return m;};
  const rockMat=mat('#718078'),darkRock=mat('#5f6f68'),mossMat=mat('#6b8051'),soilMat=mat('#82775f');
  const rockG=new THREE.DodecahedronGeometry(1,0),boxG=new THREE.BoxGeometry(1,1,1);
  ownedG.add(rockG);ownedG.add(boxG);

  const add=(g,m,x,y,z,s=[1,1,1],ry=0)=>{
    const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=ry;o.castShadow=o.receiveShadow=true;root.add(o);return o;
  };
  const nearBuilding=(x,z,pad=0)=>BUILDINGS.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+pad);
  const safeGround=(x,z)=>island.groundAt(x,z,120);

  // Remove the "outlined route" cue from v7. The terrain and footprints still remain.
  island.root.traverse(o=>{
    if(o===root)return;
    if(o.name==='Old trail kerbstones'){
      o.visible=false;hidden.push(o);
    }
  });

  // Native KayKit foliage, used deliberately instead of random scatter.
  const loader=new GLTFLoader();
  async function treeProto(file){
    const gltf=await loader.loadAsync(new URL('../kaykit_nature/'+file,import.meta.url).href);
    const scene=gltf.scene;
    scene.updateMatrixWorld(true);
    const bb=new THREE.Box3().setFromObject(scene),size=bb.getSize(new THREE.Vector3()),center=bb.getCenter(new THREE.Vector3());
    const wrap=new THREE.Group();
    scene.position.set(-center.x,-bb.min.y,-center.z);
    wrap.add(scene);
    wrap.scale.setScalar(1/Math.max(.001,size.y));
    scene.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});
    return wrap;
  }
  let protos=[];
  try{protos=await Promise.all(TREE_FILES.map(treeProto));}
  catch(e){island.assets.errors.push('Windgate19 foliage: '+e.message);}

  // Belts sit to the side of the walkable line. They block route previews, not movement.
  const BELTS=[
    {id:'harbor-throat-W',a:[-64,91],b:[-40,76],side:-1,count:14,off:6.5,spread:4.5,h:[8,13]},
    {id:'harbor-throat-E',a:[-58,88],b:[-31,75],side: 1,count:12,off:7.0,spread:4.0,h:[7,12]},
    {id:'forest-turn-W',a:[-31,73],b:[-23,49],side:-1,count:15,off:5.8,spread:4.2,h:[9,14]},
    {id:'forest-turn-E',a:[-31,70],b:[-16,55],side: 1,count:12,off:6.1,spread:4.5,h:[8,13]},
    {id:'forest-inner',a:[-24,50],b:[-45,35],side: 1,count:14,off:6.0,spread:4.8,h:[8,14]},
    {id:'falls-exit',a:[-58,27],b:[-30,19],side:-1,count:10,off:6.3,spread:4.0,h:[7,11]},
    {id:'ruins-screen',a:[-5,-1],b:[29,-20],side: 1,count:12,off:7.5,spread:4.0,h:[7,12]},
    {id:'grove-fold',a:[44,-40],b:[30,-58],side:-1,count:12,off:6.5,spread:4.8,h:[8,13]},
    {id:'ascent-curtain',a:[-7,-52],b:[-22,-76],side:1,count:15,off:6.0,spread:5.0,h:[8,14]},
    {id:'summit-west-bowl',a:[-24,-78],b:[-10,-101],side:-1,count:12,off:6.5,spread:4.2,h:[7,11]},
    {id:'summit-east-bowl',a:[7,-102],b:[20,-79],side: 1,count:11,off:7.0,spread:4.0,h:[6,10]}
  ];
  let treeCount=0;
  if(protos.length){
    for(const belt of BELTS){
      const dx=belt.b[0]-belt.a[0],dz=belt.b[1]-belt.a[1],len=Math.hypot(dx,dz)||1,nx=-dz/len,nz=dx/len;
      for(let i=0;i<belt.count;i++){
        const t=(i+.45+(seeded()-.5)*.28)/belt.count;
        const along=(seeded()-.5)*3.4;
        const lateral=belt.side*(belt.off+seeded()*belt.spread);
        const x=belt.a[0]+dx*t+dx/len*along+nx*lateral;
        const z=belt.a[1]+dz*t+dz/len*along+nz*lateral;
        if(island.field.nearPath(x,z).d<3.8||nearBuilding(x,z,3.0)||Math.hypot(x-SUMMIT.x,z-SUMMIT.z)<14)continue;
        if(island.field.slope(x,z)>.85)continue;
        const y=safeGround(x,z),h=belt.h[0]+seeded()*(belt.h[1]-belt.h[0]);
        const o=protos[Math.floor(seeded()*protos.length)].clone(true);
        o.position.set(x,y,z);o.rotation.y=seeded()*Math.PI*2;o.scale.multiplyScalar(h);
        o.name='windgate19/tree-belt/'+belt.id;
        root.add(o);treeCount++;
      }
    }
  }

  // Rock shoulders mark terrain folds and prevent long, gamey sightlines.
  const OUTCROPS=[
    {id:'forest-west',x:-41,z:54,rx:12,rz:16,count:14,scale:[1.1,2.5]},
    {id:'forest-east',x:0,z:47,rx:12,rz:15,count:13,scale:[1.2,2.7]},
    {id:'falls-frame',x:-53,z:18,rx:15,rz:10,count:13,scale:[1.0,2.5]},
    {id:'ruins-fold',x:15,z:-14,rx:16,rz:11,count:14,scale:[1.0,2.3]},
    {id:'grove-fold',x:31,z:-56,rx:13,rz:10,count:12,scale:[1.1,2.6]},
    {id:'ascent-west',x:-33,z:-86,rx:11,rz:20,count:15,scale:[1.2,3.0]},
    {id:'summit-east',x:25,z:-81,rx:11,rz:19,count:14,scale:[1.2,2.8]}
  ];
  let outcropCount=0;
  for(const zone of OUTCROPS){
    for(let i=0;i<zone.count;i++){
      const a=seeded()*Math.PI*2,r=Math.sqrt(seeded());
      const x=zone.x+Math.cos(a)*zone.rx*r,z=zone.z+Math.sin(a)*zone.rz*r;
      if(island.field.nearPath(x,z).d<4.5||nearBuilding(x,z,2.5)||Math.hypot(x-SUMMIT.x,z-SUMMIT.z)<13.5)continue;
      const y=safeGround(x,z),s=zone.scale[0]+seeded()*(zone.scale[1]-zone.scale[0]);
      const o=add(rockG,seeded()<.30?darkRock:rockMat,x,y-.30*s,z,[s*(.8+seeded()*.45),s*(.65+seeded()*.55),s*(.85+seeded()*.50)],seeded()*6.28);
      o.name='windgate19/outcrop/'+zone.id;
      if(seeded()<.55){
        const m=add(rockG,mossMat,x+(seeded()-.5)*.4,y+s*.20,z+(seeded()-.5)*.4,[s*.62,.08+s*.03,s*.55],seeded()*6.28);
        m.castShadow=false;
      }
      outcropCount++;
    }
  }

  // Blend generic building plateaus into the island with asymmetric foundation skirts.
  let skirtCount=0;
  for(const b of BUILDINGS){
    if(b.id==='mine')continue; // v17 already hand-authored the mine cut.
    const sides=b.id==='harbor'?[-2.55,-1.9,-.9,.15]:[-2.7,-1.85,-.7,.35,1.3];
    for(let i=0;i<sides.length;i++){
      const a=sides[i]+(seeded()-.5)*.18,r=b.r*(.78+seeded()*.16);
      const x=b.x+Math.cos(a)*r,z=b.z+Math.sin(a)*r;
      if(island.field.nearPath(x,z).d<3.3)continue;
      const y=safeGround(x,z),s=.8+seeded()*1.25;
      const o=add(rockG,i%3?rockMat:darkRock,x,y-.25,z,[s*1.2,s*.7,s],a);
      o.name='windgate19/poi-skirt/'+b.id;skirtCount++;
    }
  }

  // Waterfall reveal: low foreground stones frame the water but keep the opening clean.
  for(const [x,z,s] of [[-65,29,1.35],[-61,23,1.05],[-55,31,1.25],[-51,25,.9]]){
    if(island.field.nearPath(x,z).d<3.0)continue;
    const y=safeGround(x,z);
    const o=add(rockG,darkRock,x,y-.15,z,[s*1.35,s*.72,s],seeded()*6.28);
    o.name='windgate19/falls-frame';
  }

  // Sparse broken trail stones only at decision points. No full breadcrumb line.
  const markers=[[-50,83],[-24,49],[-58,27],[-17,5],[32,-23],[-18,-68],[5,-103],[3,-70]];
  for(let i=0;i<markers.length;i++){
    const [x,z]=markers[i],y=safeGround(x,z);
    const o=add(boxG,i%2?darkRock:soilMat,x+(i%2?.7:-.65),y+.04,z,[.55+.15*(i%3),.07,.38+.08*(i%2)],(i*.61)%2.4-1.2);
    o.name='windgate19/decision-stone';
  }

  island.field.points.push(
    {id:'forest-room18',name:'굽은 숲 · 시야 차단 구간',x:-24,y:safeGround(-24,49),z:49,r:6,target:[-38,17,39]},
    {id:'ascent18',name:'마지막 바위 고개 · 시야 차단 구간',x:-18,y:safeGround(-18,-68),z:-68,r:6,target:[-9,63,-82]}
  );
  island.landscape19={
    authoredRooms:true,
    routeKerbstonesHidden:hidden.length,
    treeBelts:BELTS.map(x=>x.id),
    trees:treeCount,
    outcrops:outcropCount,
    poiSkirts:skirtCount,
    routeClearance:3.8,
    collisionPolicy:'visual composition only; terrain remains gameplay SSOT'
  };
  island.qualityVersion='aurora-v18-authored-exploration-rooms';

  const prev=island.dispose;let dead=false;
  island.dispose=()=>{
    if(dead)return;dead=true;
    hidden.forEach(o=>o.visible=true);
    root.removeFromParent();
    ownedG.forEach(g=>g.dispose());
    ownedM.forEach(m=>m.dispose());
    prev();
  };
  return island.landscape19;
}
