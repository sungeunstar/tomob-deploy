/** Windgate 20 — hand-authored ruin scene.
 * Rebuilds the grove/wayside sanctuary as one collapsed structure with a readable history:
 * arrival court -> broken sanctuary -> framed departure toward the summit.
 */
import * as THREE from 'three';

const rng=(()=>{let s=201029;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorRuins20(ctx,island){
  const root=new THREE.Group();root.name='Windgate 20 / authored ruins scene';island.root.add(root);
  const G=new Set(),M=new Set(),hidden=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.96,flatShading:true,...o});M.add(m);return m;};
  const limestone=mat('#8c9387'),oldStone=mat('#737d75'),deepStone=mat('#596762'),moss=mat('#687b4f'),earth=mat('#847861'),rune=mat('#76998e',{emissive:'#315e56',emissiveIntensity:.16});
  const boxG=new THREE.BoxGeometry(1,1,1),columnG=new THREE.CylinderGeometry(.5,.58,1,8),rockG=new THREE.DodecahedronGeometry(1,0);
  G.add(boxG);G.add(columnG);G.add(rockG);
  const ground=(x,z)=>island.groundAt(x,z,140);
  const add=(g,m,x,y,z,s=[1,1,1],ry=0,name='windgate20/ruin')=>{
    const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=ry;o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);return o;
  };
  const solid=(o)=>{try{island.addTrimesh?.(o,false);}catch(e){island.assets.errors.push('Ruins20 collider: '+e.message);}return o;};
  const slab=(x,z,w,d,ry=0,m=oldStone,yoff=.05)=>add(boxG,m,x,ground(x,z)+yoff,z,[w,.09,d],ry,'windgate20/ruin-floor');
  const rock=(x,z,sx,sy,sz,ry=0,m=oldStone)=>add(rockG,m,x,ground(x,z)-sy*.15,z,[sx,sy,sz],ry,'windgate20/ruin-rubble');

  // Hide the old procedural wayside sanctuary primitives inside this scene only.
  island.root.updateMatrixWorld(true);
  island.root.traverse(o=>{
    if(!o.isMesh||o.parent===root)return;
    const p=new THREE.Vector3();o.getWorldPosition(p);
    if(Math.hypot(p.x-44,p.z+43)>18)return;
    if(o.name==='Broken wayside sanctuary'||o.name==='windgate19/outcrop/ruins-fold'){
      // These legacy pieces are visual-only. Keep old solid pillars visible so their
      // existing Rapier colliders never become invisible walls.
      o.visible=false;hidden.push(o);
    }
  });

  // --- 1. Arrival court: floor exists as fragments, never as one perfect plaza.
  const floor=[
    [42.5,-39.0,2.4,1.5,-.10],[46.4,-40.2,1.8,1.35,.12],[39.0,-42.2,1.55,1.1,.18],
    [44.1,-44.2,2.1,1.45,-.08],[48.0,-45.0,1.4,1.0,.24],[40.2,-47.0,1.45,1.05,-.18],
    [45.0,-48.1,1.7,1.15,.08],[36.9,-44.8,1.2,.9,.26],[50.4,-40.7,1.0,.82,-.23]
  ];
  floor.forEach(([x,z,w,d,ry],i)=>slab(x,z,w,d,ry,i%4===0?limestone:oldStone,.03));

  // Two partly buried curb lines imply the former footprint without outlining it completely.
  for(const [a,b,n] of [
    [[35.5,-38.0],[37.2,-49.2],5],
    [[52.0,-38.8],[51.1,-48.8],4]
  ]){
    for(let i=0;i<n;i++){
      if(i===2&&n===5)continue;
      const t=(i+.45)/n,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,y=ground(x,z);
      add(boxG,i%2?oldStone:limestone,x,y+.22,z,[.7,.34,.45],Math.atan2(b[0]-a[0],b[1]-a[1])+(rng()-.5)*.18,'windgate20/ruin-curb');
    }
  }

  // --- 2. Main surviving wall: asymmetrical, broken top, visually heavy on the east side.
  const wallYaw=-.38;
  const wallOrigin=[51.4,-43.7],wallLen=11.5,blocks=6;
  for(let i=0;i<blocks;i++){
    const t=(i+.5)/blocks-.5;
    const x=wallOrigin[0]+Math.sin(wallYaw)*t*wallLen,z=wallOrigin[1]+Math.cos(wallYaw)*t*wallLen;
    const base=ground(x,z),h=[3.6,4.5,5.2,4.7,3.1,1.9][i];
    const lower=add(boxG,i%3===0?deepStone:oldStone,x,base+h*.25,z,[1.05,h*.50,.58],wallYaw+(rng()-.5)*.045,'windgate20/main-ruin-wall');
    solid(lower);
    if(h>3.4){
      const top=add(boxG,limestone,x+(rng()-.5)*.15,base+h*.72,z+(rng()-.5)*.12,[.94,h*.34,.54],wallYaw+(rng()-.5)*.08,'windgate20/main-ruin-wall-top');
      solid(top);
    }
  }

  // Wall buttress / collapsed corner makes the wall read as architecture, not a line of boxes.
  for(const [x,z,sx,sy,sz,ry] of [
    [54.5,-39.4,1.4,1.3,1.25,-.15],[55.1,-40.8,1.05,.8,1.1,.22],
    [48.6,-49.2,1.55,1.0,1.35,.44],[49.7,-50.2,1.0,.65,.9,-.28]
  ])rock(x,z,sx,sy,sz,ry,deepStone);

  // --- 3. Broken colonnade on the opposite side; human scale and irregular survival.
  const columns=[
    [36.8,-40.7,3.8],[36.2,-44.5,2.65],[36.9,-48.4,4.35]
  ];
  columns.forEach(([x,z,h],i)=>{
    const y=ground(x,z);
    const base=solid(add(boxG,deepStone,x,y+.14,z,[.9,.28,.9],-.12+i*.05,'windgate20/column-base'));
    const col=solid(add(columnG,i===1?oldStone:limestone,x,y+.28+h*.5,z,[1, h,1],0,'windgate20/broken-column'));
    if(i!==1)add(boxG,oldStone,x+(i?-.12:.15),y+h+.38,z,[1.05,.24,1.0],.08-i*.06,'windgate20/column-cap');
  });

  // Fallen fourth column, rotated into the rubble field.
  {
    const x=34.7,z=-46.6,y=ground(x,z)+.45;
    const o=add(columnG,oldStone,x,y,z,[1,4.0,1],.22,'windgate20/fallen-column');
    o.rotation.z=Math.PI*.47;o.rotation.x=.12; // deliberately collapsed
  }

  // --- 4. Broken processional arch toward the summit. Opening remains wide and passable.
  const ax=40.1,az=-51.0,ay=Math.max(ground(ax-2.7,az),ground(ax+2.7,az)),archYaw=-.58;
  for(const side of[-1,1]){
    const x=ax+Math.cos(archYaw)*side*3.0,z=az-Math.sin(archYaw)*side*3.0;
    const h=side<0?4.2:3.5;
    solid(add(boxG,side<0?oldStone:limestone,x,ground(x,z)+h*.5,z,[.72,h,.78],archYaw,'windgate20/processional-arch-pier'));
    add(boxG,deepStone,x,ground(x,z)+.16,z,[1.15,.30,1.1],archYaw,'windgate20/processional-arch-base');
  }
  // Off-centre surviving lintel fragment; the gap still frames the route.
  {
    const lintel=solid(add(boxG,oldStone,42.1,ay+4.18,-49.8,[2.6,.48,.78],archYaw+.03,'windgate20/processional-lintel'));
    lintel.rotation.z=-.075;
  }

  // --- 5. Altar / portal archaeology: small, rear-right, partially reclaimed.
  const altar=[
    [48.2,-52.3,2.5,1.5,.0],[48.0,-52.4,1.75,1.05,.0],[47.8,-52.55,1.05,.75,.0]
  ];
  altar.forEach(([x,z,w,d,ry],i)=>{
    const y=ground(x,z);
    add(boxG,i===2?rune:(i?oldStone:deepStone),x,y+.12+i*.24,z,[w,.22,d],ry,'windgate20/old-altar');
  });

  // Partial rune line: enough to link this place to the summit sanctuary without making a magic circle.
  const runePts=[
    [45.9,-50.5],[46.8,-51.0],[47.6,-51.3],[48.5,-51.1],[49.2,-50.6]
  ];
  runePts.forEach(([x,z],i)=>slab(x,z,.38,.16,-.35+i*.12,rune,.08));

  // --- 6. Collapse logic: rubble fans away from the surviving wall, with larger pieces near the source.
  const rubble=[];
  for(let i=0;i<34;i++){
    const t=i/33,a=-2.5+rand()*1.75,r=2.5+Math.pow(rand(),.65)*10.5;
    const x=49.5+Math.cos(a)*r,z=-44.5+Math.sin(a)*r;
    if(Math.hypot(x-44,z+43)<3.6)continue;
    if(island.field.nearPath(x,z).d<2.2)continue;
    const s=.32+(1-t)*.55+rand()*.35;
    rubble.push([x,z,s]);
  }
  rubble.forEach(([x,z,s],i)=>rock(x,z,s*(.8+rand()*.7),s*.45,s*(.7+rand()*.55),rand()*6.28,i%5===0?limestone:oldStone));

  // Moss is concentrated where stone meets ground, not sprayed uniformly.
  for(const [x,z,s] of [[36.5,-44.2,.65],[51.2,-47.0,.8],[48.7,-52.1,.62],[39.4,-50.5,.55],[53.0,-42.0,.5]]){
    rock(x,z,s,.08,s*.75,rng()*6.28,moss);
  }

  // Inspection anchors describe the scene beats.
  island.field.points.push(
    {id:'ruins-entry20',name:'잠긴 왕국 폐허 · 진입 마당',x:42,y:ground(42,-38),z:-38,r:5,target:[46,ground(46,-44)+3,-44]},
    {id:'ruins-center20',name:'잠긴 왕국 폐허 · 무너진 성소',x:44,y:ground(44,-44),z:-44,r:5,target:[50,ground(50,-45)+3,-45]},
    {id:'ruins-exit20',name:'잠긴 왕국 폐허 · 정상으로 열린 틈',x:40,y:ground(40,-50),z:-50,r:5,target:[3,76,-84]}
  );

  island.ruins20={
    authoredScene:true,
    hiddenLegacy:hidden.length,
    floorFragments:floor.length,
    mainWallBlocks:blocks,
    survivingColumns:columns.length,
    rubble:rubble.length,
    processionalArch:true,
    altarFragments:altar.length,
    collision:'major wall and column masses only'
  };

  const prev=island.dispose;let dead=false;
  island.dispose=()=>{
    if(dead)return;dead=true;
    hidden.forEach(o=>o.visible=true);
    root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());
    prev();
  };
  return island.ruins20;
}
