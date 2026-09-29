/** Windgate 20b — hand polish pass.
 * Visual/collision-safe refinement on top of v20.
 * Goals: break the engineered-cut look of the ascent, hide long route reveals,
 * stitch authored sections together, and give the ruins a more believable collapse history.
 */
import * as THREE from 'three';

const rng=(()=>{let s=20093021;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorWindgate20b(ctx,island){
  const root=new THREE.Group();
  root.name='Windgate 20b / hand polish';
  island.root.add(root);

  const G=new Set(),M=new Set();
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.97,flatShading:true,...o});M.add(m);return m;};
  const bedrock=mat('#6d7973'),bedrockDark=mat('#59665f'),soil=mat('#81735d'),moss=mat('#64774d'),lichen=mat('#8c9870');
  const oldStone=mat('#7b8279'),paleStone=mat('#96988b'),wood=mat('#6d543d'),iron=mat('#4f5552',{metalness:.2,roughness:.82});
  const rockG=new THREE.DodecahedronGeometry(1,0),icoG=new THREE.IcosahedronGeometry(1,1),boxG=new THREE.BoxGeometry(1,1,1),cylG=new THREE.CylinderGeometry(1,1,1,7);
  [rockG,icoG,boxG,cylG].forEach(g=>G.add(g));

  const ground=(x,z)=>island.groundAt(x,z,140);
  const pathDist=(x,z)=>island.field.nearPath(x,z).d;
  const add=(g,m,x,y,z,s=[1,1,1],r=[0,0,0],name='windgate20b/detail')=>{
    const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(r[0]||0,r[1]||0,r[2]||0);
    o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);return o;
  };
  const makeSolid=o=>{try{island.addTrimesh?.(o,false);}catch(e){island.assets.errors.push('Windgate20b collider: '+e.message);}return o;};
  const rock=(x,z,sx,sy,sz,ry=0,m=bedrock,name='windgate20b/rock',solid=false)=>{
    const o=add(rockG,m,x,ground(x,z)-sy*.19,z,[sx,sy,sz],[rng()*.08-.04,ry,rng()*.08-.04],name);
    return solid?makeSolid(o):o;
  };
  const slab=(x,z,w,h,d,ry=0,m=oldStone,yoff=0,name='windgate20b/slab')=>add(boxG,m,x,ground(x,z)+h*.5+yoff,z,[w,h,d],[0,ry,(rng()-.5)*.035],name);
  const beam=(a,b,r=.08,m=wood,name='windgate20b/beam')=>{
    const v=new THREE.Vector3(...a),w=new THREE.Vector3(...b),d=w.clone().sub(v),o=add(cylG,m,0,0,0,[r,d.length(),r],[0,0,0],name);
    o.position.copy(v.clone().add(w).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;
  };

  // 1) Final ascent: two blind corners + asymmetric geology around the native route.
  const outcropClusters=[
    {x:-31,z:-72,n:7,spread:[8,8],tall:3.8},
    {x:-37,z:-88,n:8,spread:[8,10],tall:4.6},
    {x:-14,z:-108,n:6,spread:[10,5],tall:3.2},
    {x:23,z:-101,n:7,spread:[8,7],tall:4.0},
    {x:30,z:-84,n:7,spread:[7,9],tall:4.2}
  ];
  let ascentMasses=0,solidMasses=0;
  for(const c of outcropClusters){
    for(let i=0;i<c.n;i++){
      const a=rng()*Math.PI*2,rad=.8+Math.pow(rng(),.7)*Math.max(c.spread[0],c.spread[1]),x=c.x+Math.cos(a)*rad*(c.spread[0]/10),z=c.z+Math.sin(a)*rad*(c.spread[1]/10);
      const d=pathDist(x,z);if(d<3.0)continue;
      const k=.75+rng()*1.15,sy=(i===0?c.tall:1.2+rng()*2.0)*k*.72,sx=(1.0+rng()*1.55)*k,sz=(.9+rng()*1.45)*k;
      const major=i===0&&d>4.7;
      rock(x,z,sx,sy,sz,(rng()-.5)*1.2,i%4===0?bedrockDark:bedrock,'windgate20b/ascent-outcrop',major);
      ascentMasses++;if(major)solidMasses++;
    }
  }

  const edgeTongues=[
    [-16,-61,2.7,.28,1.5,-.25],[-28,-76,3.2,.34,1.35,.38],[-31,-96,2.9,.30,1.55,-.18],
    [-9,-105,3.0,.27,1.4,.21],[16,-106,2.8,.31,1.5,-.34],[25,-92,3.2,.33,1.45,.18],[24,-75,2.7,.26,1.35,-.25]
  ];
  let edgeCount=0;
  for(const [x,z,w,h,d,ry] of edgeTongues){
    if(pathDist(x,z)<2.15)continue;
    const o=slab(x,z,w,h,d,ry,rng()<.35?soil:bedrock,-h*.33,'windgate20b/eroded-bedrock-tongue');
    o.rotation.x=(rng()-.5)*.05;edgeCount++;
  }

  let scree=0;
  for(const c of outcropClusters){
    for(let i=0;i<13;i++){
      const a=rng()*Math.PI*2,r=3+Math.pow(rng(),.62)*8,x=c.x+Math.cos(a)*r,z=c.z+Math.sin(a)*r;
      if(pathDist(x,z)<2.55)continue;
      const s=.18+rng()*.42;
      rock(x,z,s*(.9+rng()),s*.38,s*(.8+rng()*.7),rng()*6.28,rng()<.14?lichen:bedrock,'windgate20b/ascent-scree');scree++;
    }
  }

  const oldEdge=[
    [-19,-67,1.0,.24,.42,-.26],[-26,-79,.85,.22,.38,.33],[-29,-88,.72,.19,.34,-.10],
    [-21,-99,.9,.22,.40,.24],[-5,-107,.86,.20,.36,-.32],[11,-106,.74,.19,.34,.15],
    [22,-95,.82,.22,.38,-.30],[24,-82,.72,.18,.32,.12]
  ];
  let edgeMasonry=0;
  for(const [x,z,w,h,d,ry] of oldEdge){if(pathDist(x,z)<2.05)continue;slab(x,z,w,h,d,ry,rng()<.25?bedrockDark:oldStone,-h*.25,'windgate20b/buried-pilgrimage-edge');edgeMasonry++;}

  const thresholdRocks=[[-8,-76,1.2,1.1,1.1,-.2],[10,-78,.95,.85,1.0,.35],[-8,-85,.8,.65,.9,.15],[10,-87,.9,.72,.85,-.25]];
  for(const [x,z,sx,sy,sz,ry] of thresholdRocks){if(pathDist(x,z)>2.6)rock(x,z,sx,sy,sz,ry,rng()<.3?moss:bedrock,'windgate20b/summit-throat');}

  // 2) Ruins: secondary wall return, displaced courses, fallen beams and rubble gradient.
  const wallReturn=[
    [52.7,-47.9,1.10,.72,.60,-.58],[51.8,-49.0,1.05,.65,.58,-.54],[50.7,-50.0,.94,.58,.56,-.50],
    [49.5,-50.9,.88,.48,.54,-.47],[48.3,-51.7,.78,.40,.50,-.44]
  ];
  let ruinBlocks=0;
  for(const [x,z,w,h,d,ry] of wallReturn){
    if(pathDist(x,z)<2.0)continue;
    const o=slab(x,z,w,h,d,ry,rng()<.25?paleStone:oldStone,.02,'windgate20b/ruin-wall-return');
    o.position.y=ground(x,z)+h*.5;ruinBlocks++;
  }

  const upperCourse=[[50.9,-44.0,.92,.42,.58,-.39],[52.1,-42.8,.82,.38,.54,-.34],[49.8,-45.2,.72,.34,.50,-.43],[53.0,-41.6,.68,.30,.46,-.28]];
  for(const [x,z,w,h,d,ry] of upperCourse){
    const y=ground(x,z)+2.8+rng()*1.2;add(boxG,rng()<.45?paleStone:oldStone,x,y,z,[w,h,d],[(rng()-.5)*.18,ry,(rng()-.5)*.16],'windgate20b/displaced-upper-course');ruinBlocks++;
  }

  const ruinBeams=[
    [[52.4,ground(52.4,-46.4)+.45,-46.4],[47.2,ground(47.2,-49.8)+.65,-49.8],.12],
    [[39.0,ground(39.0,-43.0)+.38,-43.0],[44.6,ground(44.6,-46.6)+.48,-46.6],.10],
    [[46.7,ground(46.7,-51.0)+.28,-51.0],[50.6,ground(50.6,-53.2)+.33,-53.2],.09]
  ];
  ruinBeams.forEach(([a,b,r],i)=>beam(a,b,r,i===2?iron:wood,'windgate20b/fallen-ruin-beam'));

  let ruinRubble=0;
  for(let i=0;i<28;i++){
    const t=i/27,a=-2.25+rng()*.9,r=2.2+Math.pow(rng(),.65)*8.0,x=50.5+Math.cos(a)*r,z=-49.2+Math.sin(a)*r;
    if(pathDist(x,z)<2.1)continue;
    const s=.24+(1-t)*.46+rng()*.18;
    rock(x,z,s*(.9+rng()*.6),s*.38,s*(.8+rng()*.5),rng()*6.28,i%6===0?paleStone:oldStone,'windgate20b/ruin-secondary-rubble');ruinRubble++;
  }

  const roots=[
    [[52.7,ground(52.7,-45.4)+.08,-45.4],[50.9,ground(50.9,-46.7)+.10,-46.7]],
    [[37.0,ground(37,-47.6)+.06,-47.6],[39.0,ground(39,-48.7)+.08,-48.7]],
    [[48.1,ground(48.1,-52.4)+.06,-52.4],[46.6,ground(46.6,-53.2)+.07,-53.2]]
  ];
  roots.forEach(([a,b])=>beam(a,b,.045,moss,'windgate20b/root-reclamation'));

  const buriedThreshold=[[46.6,-53.5,1.05,.13,.72,-.06],[45.2,-54.0,.82,.11,.62,.08],[43.9,-54.2,.64,.10,.54,-.10]];
  let thresholdFragments=0;
  for(const [x,z,w,h,d,ry] of buriedThreshold){if(pathDist(x,z)<1.85)continue;slab(x,z,w,h,d,ry,oldStone,-h*.48,'windgate20b/buried-threshold');thresholdFragments++;}

  // 3) Section stitching.
  for(const [x,z] of [[-99,100],[-84,108],[-77,101]]){
    const y=ground(x,z);beam([x-1.3,y+.18,z-.5],[x+1.1,y+.22,z+.65],.085,wood,'windgate20b/harbor-wrack');
  }

  for(const [a,b] of [[[-41,ground(-41,56)+.35,56],[-33,ground(-33,60)+.42,60]],[[-8,ground(-8,43)+.30,43],[-1,ground(-1,49)+.38,49]]]){
    if(pathDist(a[0],a[2])>3.0&&pathDist(b[0],b[2])>3.0)beam(a,b,.17,wood,'windgate20b/fallen-forest-trunk');
  }

  for(const [x,z,w,d,ry] of [[-66,24,2.0,1.0,.25],[-58,19,1.7,.9,-.18],[-51,25,1.6,.85,.32]]){
    if(pathDist(x,z)>2.5)slab(x,z,w,.16,d,ry,rng()<.45?bedrockDark:moss,-.08,'windgate20b/wet-ledge');
  }

  const railA=[-113,ground(-113,-45)+.10,-45],railB=[-106,ground(-106,-42)+.12,-42];
  const railC=[-113.7,railA[1]+.02,-43.9],railD=[-106.7,railB[1]+.02,-40.9];
  beam(railA,railB,.035,iron,'windgate20b/mine-rail');beam(railC,railD,.035,iron,'windgate20b/mine-rail');
  for(let i=0;i<5;i++){
    const t=i/4,x=railA[0]+(railB[0]-railA[0])*t,z=railA[2]+(railB[2]-railA[2])*t;
    slab(x,z,.58,.08,.13,-.38,wood,-.02,'windgate20b/mine-sleeper');
  }

  island.field.points.push(
    {id:'ascent-blind20b',name:'마지막 등정 · 가려진 굽이',x:-27,y:ground(-27,-82),z:-82,r:5,target:[23,ground(23,-98)+5,-98]},
    {id:'ruins-detail20b',name:'잠긴 왕국 폐허 · 붕괴 흔적',x:47,y:ground(47,-49),z:-49,r:5,target:[52,ground(52,-44)+4,-44]}
  );

  island.polish20b={
    authored:true,terrainCarved:false,sharedNativeRoute:true,
    ascentMasses,solidMasses,edgeTongues:edgeCount,scree,pilgrimageEdge:edgeMasonry,
    ruinBlocks,ruinRubble,thresholdFragments,mineInteriorCreated:false,
    goal:'hide engineered cuts with asymmetric authored geology and make ruin collapse legible'
  };

  const prev=island.dispose;let dead=false;
  island.dispose=()=>{if(dead)return;dead=true;root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.polish20b;
}
