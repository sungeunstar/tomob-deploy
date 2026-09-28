/** Windgate 20 — section detail pass.
 * Incremental on top of v19: hand-placed erosion, lived-in harbor detail, waterfall framing,
 * mine transition, and a non-engineered final ascent. Large terrain shape stays in field-v20.
 */
import * as THREE from 'three';
import {BUILDINGS,SUMMIT} from './aurora-refuge-field-v20.js';

const rand=(()=>{let s=200929;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorWindgate20(ctx,island){
  const root=new THREE.Group();root.name='Windgate 20 / section detail pass';island.root.add(root);
  const G=new Set(),M=new Set();
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.96,flatShading:true,...o});M.add(m);return m;};
  const stone=mat('#75827a'),dark=mat('#5f6c67'),soil=mat('#82755f'),moss=mat('#6f8054'),wood=mat('#745b42'),weathered=mat('#8e856f');
  const rockG=new THREE.DodecahedronGeometry(1,0),boxG=new THREE.BoxGeometry(1,1,1),cylG=new THREE.CylinderGeometry(1,1,1,7);
  G.add(rockG);G.add(boxG);G.add(cylG);
  const ground=(x,z)=>island.groundAt(x,z,140);
  const add=(g,m,x,y,z,s=[1,1,1],ry=0,name='windgate20/detail')=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=ry;o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);return o;};
  const rock=(x,z,sx,sy,sz,ry=0,m=stone,name='windgate20/rock')=>add(rockG,m,x,ground(x,z)-sy*.18,z,[sx,sy,sz],ry,name);
  const slab=(x,z,w,d,ry=0,m=weathered,yoff=.05,name='windgate20/slab')=>add(boxG,m,x,ground(x,z)+yoff,z,[w,.08,d],ry,name);

  // --- A. Harbor: human work meets irregular coast. Keep the central movement line open.
  const harbor=BUILDINGS.find(b=>b.id==='harbor');
  if(harbor){
    const clusters=[
      [-96,103,1.2,.8,1.0],[-94,107,.8,.55,.9],[-82,111,1.1,.7,.9],
      [-78,105,.7,.55,.8],[-101,96,1.35,.75,1.0],[-73,98,.85,.6,.75]
    ];
    clusters.forEach(([x,z,sx,sy,sz],i)=>rock(x,z,sx,sy,sz,i*.61, i%3?stone:dark,'windgate20/harbor-foundation'));
    for(const [x,z,ry] of [[-94,97,.2],[-91,95,-.18],[-77,102,.5],[-75,99,.35]]){
      const y=ground(x,z);add(boxG,wood,x,y+.24,z,[1.1,.22,.18],ry,'windgate20/harbor-timber');
      add(boxG,wood,x+.45*Math.cos(ry+1.57),y+.16,z+.45*Math.sin(ry+1.57),[.65,.13,.14],ry+.35,'windgate20/harbor-timber');
    }
  }

  // --- B. Forest: roots / low stones create pockets without drawing a breadcrumb path.
  const forestPockets=[
    {x:-38,z:67,r:7,n:8},{x:-18,z:56,r:8,n:9},{x:-36,z:43,r:7,n:8},{x:-15,z:37,r:7,n:7}
  ];
  for(const p of forestPockets){
    for(let i=0;i<p.n;i++){
      const a=(i/p.n)*Math.PI*2+rand()*.45,r=p.r*(.58+rand()*.42),x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;
      if(island.field.nearPath(x,z).d<3.0)continue;
      const s=.45+rand()*.8;rock(x,z,s*1.15,s*.55,s,.4+rand()*2.4,rand()<.35?moss:stone,'windgate20/forest-floor');
    }
  }

  // --- C. Waterfall / gorge: wet foreground framing and fractured ledges.
  const falls=[
    [-67,28,1.5,1.05,1.4],[-64,22,1.0,.75,1.25],[-55,29,1.4,.85,1.0],
    [-50,21,1.1,.7,1.45],[-59,16,.9,.65,1.1],[-47,16,1.2,.85,1.1]
  ];
  falls.forEach(([x,z,sx,sy,sz],i)=>rock(x,z,sx,sy,sz,.2+i*.49,i%2?dark:stone,'windgate20/falls-fracture'));
  for(const [x,z,s] of [[-66,27,.9],[-55,28,.75],[-50,20,.65]])rock(x,z,s,.08,s*.75,rand()*6.2,moss,'windgate20/wet-moss');

  // --- D. Mine transition: scattered cribbing and spoil piles, not a new fake tunnel.
  const mine=BUILDINGS.find(b=>b.id==='mine');
  if(mine){
    for(const [x,z,s] of [[-102,-39,.8],[-105,-44,.65],[-118,-38,.75],[-120,-48,.9],[-108,-54,.6]]){
      if(island.field.nearPath(x,z).d<2.8)continue;
      rock(x,z,s*1.25,s*.65,s,rand()*6.2,dark,'windgate20/mine-spoil');
    }
    for(const [x,z,ry] of [[-102,-42,.55],[-117,-42,-.25],[-119,-52,.3]]){
      const y=ground(x,z);add(boxG,wood,x,y+.16,z,[1.25,.13,.14],ry,'windgate20/mine-cribbing');
      add(boxG,wood,x-.45*Math.sin(ry),y+.62,z+.45*Math.cos(ry),[.11,.72,.11],ry,'windgate20/mine-cribbing');
    }
  }

  // --- E/F. Final ascent: authored knuckles and interrupted old pilgrimage masonry.
  // Rocks are intentionally one-sided in each bend; never mirror them across the trail.
  const ascentRocks=[
    [-10,-58,1.6,2.4,1.5,-.25],[-4,-62,.9,1.35,1.1,.32],
    [-34,-70,2.0,3.0,1.7,.20],[-38,-78,1.3,2.2,1.5,-.42],
    [-37,-91,2.3,3.5,2.0,.12],[-30,-101,1.2,1.8,1.55,.55],
    [-10,-109,1.8,2.4,1.7,-.18],[1,-113,1.1,1.55,1.3,.35],
    [20,-107,1.55,2.35,1.55,.18],[29,-97,2.0,3.0,1.7,-.28],
    [31,-82,1.7,2.5,1.6,.38],[27,-71,1.0,1.5,1.1,-.20]
  ];
  ascentRocks.forEach(([x,z,sx,sy,sz,ry],i)=>rock(x,z,sx,sy,sz,ry,i%4===0?dark:stone,'windgate20/ascent-bedrock'));

  // Broken pilgrimage remnants: isolated, misaligned and partially buried.
  const pilgrim=[
    [-15,-65,1.05,.45,-.18],[-23,-73,.75,.52,.32],[-28,-84,.9,.42,-.08],
    [-20,-95,.72,.56,.21],[-7,-103,1.0,.48,-.26],[8,-104,.82,.52,.16],
    [20,-96,.74,.42,-.35],[23,-83,.9,.46,.12],[17,-74,.72,.48,-.14]
  ];
  pilgrim.forEach(([x,z,w,d,ry],i)=>slab(x,z,w,d,ry,i%3===0?dark:weathered,.015,'windgate20/pilgrimage-fragment'));

  // Tiny stacked cairns mark history, not navigation arrows.
  for(const [x,z] of [[-33,-80],[25,-91],[-8,-111]]){
    const y=ground(x,z);
    for(let i=0;i<3;i++)add(rockG,i===2?moss:stone,x+(i-1)*.08,y+.13+i*.18,z+(i%2?-.07:.06),[.34-i*.06,.18,.30-i*.05],rand()*6.2,'windgate20/wind-cairn');
  }

  // Last threshold: sparse fallen masonry links ascent to sanctuary without a clean staircase.
  const threshold=[
    [-4,-71,1.05,.42,-.12],[2,-73,.88,.46,.10],[7,-76,.72,.42,-.20],
    [-2,-78,.62,.36,.28],[5,-80,.56,.34,-.08]
  ];
  threshold.forEach(([x,z,w,d,ry],i)=>slab(x,z,w,d,ry,i%2?dark:weathered,.025,'windgate20/summit-threshold'));

  // Wind-scoured summit edge: only small accents, centre stays readable.
  for(const [x,z,s] of [[-9,-80,.8],[10,-81,.7],[-8,-89,.65],[11,-91,.75]]){
    if(Math.hypot(x-SUMMIT.x,z-SUMMIT.z)<7.4)continue;
    rock(x,z,s*1.25,s*.55,s,rand()*6.2,rand()<.5?moss:stone,'windgate20/summit-edge');
  }

  island.field.points.push(
    {id:'ascent-turn-a20',name:'마지막 등정 · 첫 굽이',x:-18,y:ground(-18,-68),z:-68,r:5,target:[-31,61,-88]},
    {id:'ascent-turn-b20',name:'마지막 등정 · 바위 틈',x:-13,y:ground(-13,-98),z:-98,r:5,target:[8,65,-103]},
    {id:'summit-threshold20',name:'성소 직전 · 무너진 순례길',x:3,y:ground(3,-70),z:-70,r:5,target:[3,70,-84]}
  );

  island.section20={
    authored:true,
    ascentRocks:ascentRocks.length,
    pilgrimageFragments:pilgrim.length,
    forestPockets:forestPockets.length,
    waterfallFractures:falls.length,
    harborHumanized:!!harbor,
    mineTransition:!!mine
  };

  const prev=island.dispose;let dead=false;
  island.dispose=()=>{if(dead)return;dead=true;root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.section20;
}
