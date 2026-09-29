/** PATMOS Landmark v1
 * Large authored cliff-city sandbox for TOMOB.
 * Scale target: ~1.2km region, vertical cliff settlement, hidden harbor.
 * Gameplay: native player + Rapier terrain/walkways + native ocean.
 */
import * as THREE from 'three';

const SIZE=1200,N=160;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const rngFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const rng=rngFor(290929);

function mound(x,z,cx,cz,rx,rz,h,base=-28){
  const r=Math.hypot((x-cx)/rx,(z-cz)/rz);
  const q=1-smooth(.52,1.03,r);
  return base+(h-base)*q;
}
function hash(x,z){const v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);}
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}

function terrainHeight(x,z){
  let h=-32;
  // Three major surviving mountain masses.
  h=Math.max(h,mound(x,z,-245,15,245,420,285));
  h=Math.max(h,mound(x,z,235,25,225,400,255));
  h=Math.max(h,mound(x,z,0,-285,345,250,330));
  // Outer sea stacks / shoulders.
  h=Math.max(h,mound(x,z,-410,-80,95,180,175));
  h=Math.max(h,mound(x,z,405,-120,85,170,155));
  h=Math.max(h,mound(x,z,-355,260,90,130,115));
  h=Math.max(h,mound(x,z,345,255,85,125,105));

  // Carve the hidden inlet from the south ocean into the city.
  const t=clamp((500-z)/610);
  const center=10*Math.sin(t*2.8)-8*Math.sin(t*6.1);
  const width=mix(72,115,smooth(0,1,t));
  const d=Math.abs(x-center);
  if(z>-125 && d<width+48){
    const bank=smooth(width,width+48,d);
    const floor=mix(-20,-7,smooth(500,-80,z));
    h=mix(floor,h,bank);
  }
  // Main protected harbor basin.
  const hb=Math.hypot(x/128,(z-105)/145);
  if(hb<1.05) h=Math.min(h,mix(-10,h,smooth(.72,1.05,hb)));

  // Cave-market mouth at the back wall.
  if(z>-165&&z<-90&&Math.abs(x)<55){
    const q=smooth(18,55,Math.abs(x));
    h=Math.min(h,mix(8,h,q));
  }

  // Macro fracture/noise, suppressed near water so banks remain readable.
  const n=(noise(x*.018+7,z*.017)-.5)*13+(noise(x*.055,z*.052+11)-.5)*4;
  if(h>8)h+=n*smooth(8,55,h);
  return h;
}

export async function initPatmosLandmark(ctx){
  const {scene,world,RAPIER:R}=ctx;
  const root=new THREE.Group();root.name='PATMOS / landmark cliff city v1';scene.add(root);
  const G=new Set(),M=new Set(),colliders=[],supports=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,flatShading:true,...o});M.add(m);return m;};
  const rock=mat('#586660'),rockDark=mat('#3e4e4b'),rockPale=mat('#7e897f');
  const soil=mat('#71634e'),wood=mat('#735338'),woodDark=mat('#4a382b'),woodWarm=mat('#8e6740');
  const cloth=mat('#713934',{side:THREE.DoubleSide}),iron=mat('#4a5050',{metalness:.24,roughness:.72});
  const glow=mat('#f3a75f',{emissive:'#f3a75f',emissiveIntensity:2.2,roughness:.6});
  const dark=mat('#101719',{roughness:1}),moss=mat('#536a43');

  const boxG=new THREE.BoxGeometry(1,1,1),rockG=new THREE.DodecahedronGeometry(1,0),cylG=new THREE.CylinderGeometry(1,1,1,7);
  G.add(boxG);G.add(rockG);G.add(cylG);

  function fixed(desc){const c=world.createCollider(desc.setFriction(.92));colliders.push(c);return c;}
  function solid(o,walk=true){
    o.updateWorldMatrix(true,false);
    const p=o.geometry.attributes.position,v=new Float32Array(p.count*3),q=new THREE.Vector3();
    for(let i=0;i<p.count;i++){q.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);v.set(q.toArray(),i*3);}
    const ix=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);
    fixed(R.ColliderDesc.trimesh(v,ix));if(walk)supports.push(o);return o;
  }
  function add(g,m,x,y,z,s=[1,1,1],ry=0,rx=0,rz=0,isSolid=false,name=''){
    G.add(g);M.add(m);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);
    o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);if(isSolid)solid(o,true);return o;
  }
  function box(x,y,z,s,m=wood,ry=0,isSolid=false,name=''){return add(boxG,m,x,y,z,s,ry,0,0,isSolid,name);}
  function beam(a,b,r=.10,m=woodDark,isSolid=false,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.9,r,len,6);G.add(g);
    const o=add(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,false,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());o.updateWorldMatrix(true,false);if(isSolid)solid(o,true);return o;
  }

  // Terrain mesh + shared physics surface.
  const pos=[],col=[],ix=[];
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
    const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,y=terrainHeight(x,z);
    pos.push(x,y,z);
    const slope=Math.hypot(terrainHeight(x+3,z)-terrainHeight(x-3,z),terrainHeight(x,z+3)-terrainHeight(x,z-3))/6;
    let c=new THREE.Color('#67745b');
    c.lerp(new THREE.Color('#938461'),1-smooth(8,30,y));
    c.lerp(new THREE.Color('#65706a'),smooth(.45,1.15,slope));
    c.lerp(new THREE.Color('#4e5d59'),smooth(1.1,2.1,slope)*.6);
    c.multiplyScalar(.92+.13*noise(x*.04,z*.04));
    col.push(c.r,c.g,c.b);
    if(i<N&&j<N)ix.push(k,k+N+1,k+1,k+1,k+N+1,k+N+2);
  }
  const terrainG=new THREE.BufferGeometry();terrainG.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));terrainG.setAttribute('color',new THREE.Float32BufferAttribute(col,3));terrainG.setIndex(ix);terrainG.computeVertexNormals();G.add(terrainG);
  const terrainM=mat('#ffffff',{vertexColors:true,roughness:.98});
  const terrain=add(terrainG,terrainM,0,0,0,[1,1,1],0,0,0,false,'Patmos terrain / 1.2km');
  solid(terrain,true);

  // Cliff fracture buttresses: visual-only, integrated into steep masses.
  const cliffs=[];
  for(let n=0;n<2600&&cliffs.length<150;n++){
    const x=(rng()-.5)*940,z=(rng()-.5)*850-10,y=terrainHeight(x,z);
    const sx=Math.abs(terrainHeight(x+4,z)-terrainHeight(x-4,z))/8,sz=Math.abs(terrainHeight(x,z+4)-terrainHeight(x,z-4))/8;
    if(y<18||Math.hypot(sx,sz)<.72||Math.abs(x)<95&&z> -150)continue;
    if(Math.hypot(x,z-115)<150)continue;
    cliffs.push({x,z,y,s:2.8+rng()*5});
  }
  for(const p of cliffs){
    const o=add(rockG,rng()<.35?rockDark:rock,p.x,p.y-p.s*.45,p.z,[p.s*.8,p.s*(1.3+rng()*.9),p.s*.75],rng()*Math.PI,0,(rng()-.5)*.12,false,'Patmos cliff fracture');
    o.castShadow=true;
  }

  // Hidden harbor docks.
  const dockY=8;
  box(0,dockY-1.1,245,[18,2.1,86],woodDark,0,true,'Main harbor pier');
  for(const x of[-13,13])for(const z of[185,215,245,275,305])beam([x,1,z],[x,dockY,z],.22,woodDark,false,'Pier posts');
  for(const side of[-1,1]){
    box(side*54,dockY-1.1,185,[48,2.0,11],wood,side*.06,true,'Harbor side deck');
    for(let i=0;i<4;i++)box(side*(78+i*24),dockY-1.0,160-i*7,[21,1.8,9],i%2?woodDark:wood,side*.12,true,'Smuggler berth');
  }

  // Route helper: wide walkable plank/ramp between authored nodes.
  const routeNodes=[
    [0,8,245],[-18,12,180],[-70,27,132],[-128,46,92],[-164,68,36],[-174,92,-24],[-143,118,-78],
    [-88,138,-113],[-20,148,-128],[66,163,-130],[128,183,-155],[148,207,-208],[108,232,-264],[35,262,-307],[0,278,-330]
  ];
  function ramp(a,b,width=8){
    const A=new THREE.Vector3(a[0],a[1],a[2]),B=new THREE.Vector3(b[0],b[1],b[2]),mid=A.clone().add(B).multiplyScalar(.5),d=B.clone().sub(A);
    const len=Math.hypot(d.x,d.z),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,len);
    const o=add(boxG,woodDark,mid.x,mid.y-.45,mid.z,[width,.8,Math.hypot(len,d.y)],yaw,pitch,0,true,'Patmos climb route');
    return o;
  }
  for(let i=0;i<routeNodes.length-1;i++)ramp(routeNodes[i],routeNodes[i+1],i<3?10:8.5);

  // Large authored terraces attached to cliffs.
  const terraces=[
    [-122,48,92,55,2.0,34,-.10],[-170,70,30,48,2.0,28,.06],[-160,95,-30,54,2.0,30,-.08],
    [-116,120,-82,52,2.0,32,.08],[-58,141,-118,62,2.0,36,-.03],[15,150,-132,62,2.0,36,.02],
    [80,166,-135,58,2.0,34,-.05],[132,187,-164,50,2.0,30,.08],[145,210,-215,46,2.0,28,-.06],
    [102,235,-267,55,2.0,32,.05],[38,265,-307,62,2.0,36,-.02],[0,280,-338,72,2.2,48,0]
  ];
  for(const [x,y,z,w,h,d,ry] of terraces)box(x,y-1.0,z,[w,h,d],woodDark,ry,true,'Patmos terrace');

  // Cross-cliff suspension bridges create the iconic layered silhouette.
  const bridges=[
    [[-132,94,-32],[95,110,-50],7],
    [[-88,142,-112],[118,171,-144],6.5],
    [[-18,151,-126],[160,206,-205],6],
    [[35,266,-307],[-118,235,-285],6]
  ];
  for(const [a,b,w] of bridges){
    ramp(a,b,w);
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),dx=B.x-A.x,dz=B.z-A.z,L=Math.hypot(dx,dz)||1,nx=-dz/L,nz=dx/L;
    for(const side of[-1,1]){
      const p1=[A.x+nx*side*w*.55,A.y+1.2,A.z+nz*side*w*.55],p2=[B.x+nx*side*w*.55,B.y+1.2,B.z+nz*side*w*.55];
      beam(p1,p2,.06,iron,false,'Bridge cable');
    }
  }

  // Houses and stacked cliff settlement.
  function hut(x,y,z,s=1,ry=0){
    box(x,y,z,[8*s,5*s,7*s],wood,ry,false,'Patmos house');
    const roof=add(new THREE.ConeGeometry(1,1,4),woodDark,x,y+4.6*s,z,[6.8*s,3.1*s,6.8*s],ry+Math.PI/4,0,0,false,'Patmos roof');roof.castShadow=true;
    // warm window
    box(x+Math.sin(ry)*4.05*s,y+.4*s,z+Math.cos(ry)*4.05*s,[1.3*s,1.4*s,.16],glow,ry,false,'Warm window');
  }
  const hutSites=[
    [-145,53,83,1.0,.2],[-107,52,99,.85,-.1],[-185,76,19,1.0,.15],[-150,78,45,.8,-.18],
    [-178,100,-18,.95,.1],[-139,101,-38,.8,-.12],[-128,126,-73,1.0,.2],[-88,126,-88,.82,-.16],
    [-55,147,-105,.95,.08],[-12,156,-119,1.0,-.05],[42,156,-128,.85,.12],[78,172,-123,1.0,.18],
    [123,193,-153,1.0,-.1],[149,215,-201,.82,.16],[103,241,-257,.95,-.08],[52,270,-300,.85,.1],
    [-38,281,-328,.95,-.08],[18,285,-342,1.0,.06]
  ];
  hutSites.forEach(p=>hut(...p));

  // Market cavern: a huge black arch cut into the rear wall, with warm interior platforms.
  const archG=new THREE.CircleGeometry(1,40,0,Math.PI);G.add(archG);
  const arch=add(archG,dark,0,60,-151,[62,58,1],0,0,Math.PI,false,'Black market cavern mouth');
  // lower rectangular darkness
  box(0,31,-151,[122,62,.8],dark,0,false,'Cavern darkness');
  box(0,18,-143,[100,2.2,36],woodDark,0,true,'Cavern market floor');
  for(const x of[-38,-18,0,22,42]){
    box(x,22,-139,[12,1.1,7],woodWarm,(rng()-.5)*.15,false,'Market stall');
    const lm=new THREE.PointLight('#ff9d58',4.2,28,1.8);lm.position.set(x,27,-135);root.add(lm);
  }

  // Stone ruins inherited from the pre-flood world.
  for(const [x,y,z,h] of[[-215,115,-82,28],[205,176,-142,34],[-118,250,-284,44],[112,250,-292,36]]){
    add(cylG,rockPale,x,y+h*.45,z,[5,h*.9,5],rng()*Math.PI,0,(rng()-.5)*.04,false,'Old watch pillar');
    box(x,y+h*.9,z,[13,2.2,13],rockDark,rng()*.2,false,'Old capital');
  }
  // Ancient high arch at citadel approach.
  const ax=-22,az=-302,ay=265;
  for(const x of[ax-34,ax+34])box(x,ay+18,az,[11,38,12],rockPale,0,true,'Ancient arch pier');
  box(ax,ay+40,az,[78,8,14],rockPale,0,true,'Ancient arch lintel');

  // Upper citadel: visible from sea, but physically reached only after climbing.
  box(0,280,-345,[95,3.0,72],rockDark,0,true,'Citadel platform');
  for(const [x,z] of[[-36,-365],[36,-365],[-36,-327],[36,-327]]){
    add(cylG,rockPale,x,298,z,[10,36,10],0,0,0,false,'Citadel tower');
    const roof=add(new THREE.ConeGeometry(1,1,6),woodDark,x,320,z,[13,13,13],0,0,0,false,'Citadel roof');roof.castShadow=true;
  }
  box(0,293,-378,[64,18,10],rockPale,0,false,'Citadel keep');
  const citLight=new THREE.PointLight('#e7b16e',9,90,1.5);citLight.position.set(0,300,-355);root.add(citLight);

  // Watchtowers and flags.
  function tower(x,y,z,h=30){
    for(let i=0;i<4;i++){
      const a=i/4*Math.PI*2,px=x+Math.cos(a)*5,pz=z+Math.sin(a)*5;
      beam([px,y,pz],[px,y+h,pz],.42,woodDark,false,'Watchtower leg');
    }
    box(x,y+h,z,[16,2,16],woodDark,0,true,'Watchtower deck');
    beam([x,y+h,z],[x,y+h+13,z],.24,woodDark,false,'Flag mast');
    const flagG=new THREE.PlaneGeometry(9,5);G.add(flagG);
    const f=add(flagG,cloth,x+4.5,y+h+9,z,[1,1,1],0,0,0,false,'Patmos flag');
    f.rotation.y=Math.PI/2;
  }
  tower(-265,terrainHeight(-265,5)+2,5,34);
  tower(255,terrainHeight(255,-10)+2,-10,38);
  tower(178,214,-220,28);

  // Cloth canopies over market/lower town.
  for(const [x,y,z,w,d,rz] of[[-120,60,74,34,16,.08],[-167,82,12,30,14,-.1],[-78,150,-105,36,14,.06],[35,160,-120,34,16,-.08]]){
    const g=new THREE.PlaneGeometry(w,d,4,2);g.rotateX(-Math.PI/2);G.add(g);add(g,cloth,x,y+7,z,[1,1,1],0,0,rz,false,'Patmos canopy');
  }

  // Waterfall from the high citadel mountain into the harbor chamber.
  const waterM=new THREE.MeshBasicMaterial({color:'#b5d7d1',transparent:true,opacity:.58,side:THREE.DoubleSide,depthWrite:false});M.add(waterM);
  const fallG=new THREE.PlaneGeometry(24,225,8,28);G.add(fallG);
  const fp=fallG.attributes.position;
  for(let i=0;i<fp.count;i++){const x=fp.getX(i),y=fp.getY(i);fp.setZ(i,.7*Math.sin(y*.12)+.35*Math.sin(x*.6));}
  fallG.computeVertexNormals();
  const fall=add(fallG,waterM,72,160,-257,[1,1,1],0,0,0,false,'Patmos waterfall');fall.castShadow=false;

  // Moss / grass patches on cliff shoulders.
  for(let i=0;i<90;i++){
    const a=rng()*Math.PI*2,rad=150+rng()*330,x=Math.cos(a)*rad,z=-20+Math.sin(a)*rad*.75,y=terrainHeight(x,z);
    if(y<18||Math.abs(x)<95&&z>-150)continue;
    add(rockG,rng()<.3?moss:rock,x,y+.1,z,[1.2+rng()*2,.12,1+rng()*1.8],rng()*Math.PI,0,0,false,'Patmos moss patch').castShadow=false;
  }

  // Warm lanterns across the city make the huge settlement readable at dusk.
  const lights=[];
  for(const [x,y,z] of hutSites.filter((_,i)=>i%2===0).map(p=>[p[0],p[1]+4,p[2]+3])){
    const l=new THREE.PointLight('#ff9a55',2.6,32,1.7);l.position.set(x,y,z);root.add(l);lights.push(l);
  }

  // Named inspection points.
  const points=[
    {id:'harbor',name:'숨은 밧모 항구',x:0,y:dockY+2,z:245,target:[0,45,-95]},
    {id:'lower',name:'절벽 하층 도시',x:-145,y:54,z:92,target:[-160,105,-30]},
    {id:'market',name:'암시장 동굴',x:0,y:21,z:-105,target:[0,35,-150]},
    {id:'bridge',name:'매달린 중앙 다리',x:-20,y:150,z:-128,target:[115,177,-155]},
    {id:'watch',name:'상층 감시지구',x:145,y:212,z:-215,target:[35,285,-325]},
    {id:'citadel',name:'밧모 상층 성채',x:0,y:284,z:-320,target:[0,300,-370]},
  ];

  const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0);
  function groundAt(x,z,fromY=800){
    const h=terrainHeight(x,z);let y=h<=fromY+.01?h:-32;
    origin.set(x,fromY,z);ray.set(origin,down);ray.far=Math.max(1,fromY+60);
    const hit=ray.intersectObjects(supports,true)[0];if(hit)y=Math.max(y,hit.point.y);return y;
  }

  const api={
    root,points,spawn:{x:0,y:dockY+2.4,z:310},size:SIZE,qualityVersion:'patmos-landmark-v1',
    field:{height:terrainHeight,points,support:groundAt},groundAt,
    stats:{terrainMeters:SIZE,cliffFractures:cliffs.length,terraces:terraces.length,houses:hutSites.length,bridges:bridges.length,routeNodes:routeNodes.length,cityLights:lights.length},
    dispose(){for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());}
  };
  ctx.terrain=api;
  return api;
}
