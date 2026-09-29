/** PATMOS Landmark v2
 * Rebuild after visual QA:
 * - no canyon-box walls
 * - S-bend sea inlet + reveal
 * - stone ledges embedded in cliff
 * - dense architectural clusters, not floating plank lines
 * - cavern market, upper watch quarter, ancient citadel
 */
import * as THREE from 'three';

const SIZE=1400,N=180;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const rngFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const rng=rngFor(290930);
const v2=(x,z)=>({x,z});

function hash(x,z){const v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);}
function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
function mound(x,z,cx,cz,rx,rz,h,base=-30,inner=.46){
  const r=Math.hypot((x-cx)/rx,(z-cz)/rz);
  return base+(h-base)*(1-smooth(inner,1.03,r));
}
function segDist(a,b,x,z){
  const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1));
  return {d:Math.hypot(x-a.x-dx*t,z-a.z-dz*t),t};
}

const INLET=[v2(82,680),v2(25,575),v2(-42,485),v2(18,390),v2(-35,305),v2(8,230)];
function inletSample(x,z){
  let best={d:1e9,t:0,seg:0};
  for(let i=0;i<INLET.length-1;i++){
    const q=segDist(INLET[i],INLET[i+1],x,z);
    if(q.d<best.d)best={d:q.d,t:(i+q.t)/(INLET.length-1),seg:i};
  }
  return best;
}

export function patmosV2Height(x,z){
  let h=-30;
  // Left and right surviving ridge systems are composed of overlapping masses;
  // no single giant ellipse is allowed to become a smooth canyon wall.
  const masses=[
    [-300,350,260,315,112],[-345,145,250,300,178],[-325,-90,245,290,235],[-245,-315,285,245,302],
    [300,365,245,310,105],[350,160,260,300,165],[330,-85,250,285,224],[245,-305,290,250,285],
    [-470,60,120,210,142],[465,40,120,205,132],[0,-420,390,230,328],
    [-165,-470,190,155,270],[175,-470,190,155,264]
  ];
  for(const m of masses)h=Math.max(h,mound(x,z,...m));

  // Natural shoulders / spurs that break the skyline.
  h=Math.max(h,mound(x,z,-155,80,115,125,92));
  h=Math.max(h,mound(x,z,175,70,120,130,86));
  h=Math.max(h,mound(x,z,-145,-125,120,135,144));
  h=Math.max(h,mound(x,z,155,-150,130,140,152));

  // S-bend approach channel. Width expands only near the hidden inner harbor.
  const q=inletSample(x,z);
  const channelW=mix(38,70,smooth(.20,.82,q.t));
  if(q.d<channelW+46 && z>205){
    const bank=smooth(channelW,channelW+46,q.d);
    const floor=mix(-21,-10,smooth(680,225,z));
    h=mix(floor,h,bank);
  }

  // Inner harbor chamber.
  const hb=Math.hypot(x/155,(z-145)/155);
  if(hb<1.15)h=Math.min(h,mix(-12,h,smooth(.76,1.15,hb)));

  // Two side coves make the basin irregular instead of circular.
  for(const c of [[-115,160,80,72],[115,130,76,82]]){
    const r=Math.hypot((x-c[0])/c[2],(z-c[1])/c[3]);
    if(r<1.12)h=Math.min(h,mix(-8,h,smooth(.70,1.12,r)));
  }

  // Cliff-bay notches create real ledges for architecture.
  const ledges=[
    [-190,105,100,80,34],[-210,15,92,72,58],[-178,-78,100,76,86],
    [195,92,100,82,38],[214,-10,96,75,66],[184,-105,100,80,102],
    [-120,-195,110,80,128],[120,-215,112,82,148]
  ];
  for(const [cx,cz,rx,rz,level] of ledges){
    const r=Math.hypot((x-cx)/rx,(z-cz)/rz);
    if(r<1.0)h=mix(h,Math.min(h,level+(noise(x*.05,z*.05)-.5)*2.2),1-smooth(.55,1.0,r));
  }

  // Back-bay saddle where the old city climbs toward the citadel.
  const back=Math.hypot(x/165,(z+300)/190);
  if(back<1.0)h=mix(h,Math.min(h,170+(noise(x*.025,z*.025)-.5)*6),1-smooth(.55,1.0,back));

  // Fractured geology. Keep shoreline/channel readable.
  if(h>6){
    const n=(noise(x*.013+8,z*.014-2)-.5)*18+(noise(x*.041,z*.043+13)-.5)*6+(noise(x*.095+3,z*.088)-.5)*2.2;
    const wetProtect=Math.max(1-smooth(40,92,q.d),1-smooth(1.0,1.28,hb));
    h+=n*smooth(12,75,h)*(1-wetProtect*.82);
  }
  return h;
}

export async function initPatmosLandmarkV2(ctx){
  const {scene,world,RAPIER:R}=ctx;
  const root=new THREE.Group();root.name='PATMOS / landmark cliff city v2';scene.add(root);
  const G=new Set(),M=new Set(),colliders=[],supports=[],lights=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,flatShading:true,...o});M.add(m);return m;};
  const rock=mat('#66736d'),rockDark=mat('#4b5955'),rockPale=mat('#89948b');
  const oldStone=mat('#858c80'),oldStoneDark=mat('#626b63'),stoneWet=mat('#485d59');
  const soil=mat('#766b57'),wood=mat('#74543b'),wood2=mat('#8a6747'),woodDark=mat('#4d392b');
  const cloth=mat('#7a3c36',{side:THREE.DoubleSide}),iron=mat('#4c5556',{metalness:.22,roughness:.74});
  const glow=mat('#ef9b55',{emissive:'#ef9b55',emissiveIntensity:2.2,roughness:.6});
  const caveDark=mat('#101719',{roughness:1}),moss=mat('#506a46'),moss2=mat('#657a4d');
  const waterFall=mat('#a9d1cf',{transparent:true,opacity:.58,side:THREE.DoubleSide,depthWrite:false,roughness:.25});

  const boxG=new THREE.BoxGeometry(1,1,1),rockG=new THREE.DodecahedronGeometry(1,0),cylG=new THREE.CylinderGeometry(1,1,1,7);
  G.add(boxG);G.add(rockG);G.add(cylG);

  function fixed(desc){const c=world.createCollider(desc.setFriction(.92));colliders.push(c);return c;}
  function solid(o,walk=true){
    o.updateWorldMatrix(true,false);
    const p=o.geometry.attributes.position,v=new Float32Array(p.count*3),tmp=new THREE.Vector3();
    for(let i=0;i<p.count;i++){tmp.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);v.set(tmp.toArray(),i*3);}
    const idx=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);
    fixed(R.ColliderDesc.trimesh(v,idx));if(walk)supports.push(o);return o;
  }
  function add(g,m,x,y,z,s=[1,1,1],ry=0,rx=0,rz=0,isSolid=false,name=''){
    G.add(g);M.add(m);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);
    o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);if(isSolid)solid(o,true);return o;
  }
  const box=(x,y,z,s,m=wood,ry=0,isSolid=false,name='')=>add(boxG,m,x,y,z,s,ry,0,0,isSolid,name);
  function beam(a,b,r=.10,m=woodDark,isSolid=false,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.9,r,len,6);G.add(g);
    const o=add(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,false,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());o.updateWorldMatrix(true,false);if(isSolid)solid(o,true);return o;
  }

  // --- Terrain SSOT
  const pos=[],cols=[],idx=[];
  const cGrass=new THREE.Color('#788463'),cSoil=new THREE.Color('#8c7b5c'),cRock=new THREE.Color('#67736d'),cDark=new THREE.Color('#4d5a56');
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
    const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,y=patmosV2Height(x,z);
    pos.push(x,y,z);
    const sl=Math.hypot(patmosV2Height(x+3,z)-patmosV2Height(x-3,z),patmosV2Height(x,z+3)-patmosV2Height(x,z-3))/6;
    let c=cGrass.clone().lerp(cSoil,1-smooth(10,38,y)).lerp(cRock,smooth(.35,.9,sl)).lerp(cDark,smooth(1.0,1.9,sl)*.58);
    c.multiplyScalar(.92+.13*noise(x*.04,z*.04));cols.push(c.r,c.g,c.b);
    if(i<N&&j<N)idx.push(k,k+N+1,k+1,k+1,k+N+1,k+N+2);
  }
  const terrainG=new THREE.BufferGeometry();terrainG.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));terrainG.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));terrainG.setIndex(idx);terrainG.computeVertexNormals();G.add(terrainG);
  const terrain=add(terrainG,mat('#fff',{vertexColors:true,roughness:.99}),0,0,0,[1,1,1],0,0,0,false,'Patmos v2 terrain');
  solid(terrain,true);

  // --- Geology: broad vertical slabs around steep zones, sparse enough to read as cliff strata.
  const slabG=new THREE.CylinderGeometry(1,.92,1,7,2,false);G.add(slabG);
  const cliffSlabs=[];
  for(let n=0;n<7000&&cliffSlabs.length<115;n++){
    const x=(rng()-.5)*920,z=(rng()-.5)*850-70,y=patmosV2Height(x,z);
    const sl=Math.hypot(patmosV2Height(x+4,z)-patmosV2Height(x-4,z),patmosV2Height(x,z+4)-patmosV2Height(x,z-4))/8;
    const hb=Math.hypot(x/175,(z-145)/175);
    if(y<30||sl<.85||hb<1.18||Math.abs(x)<80&&z>210)continue;
    if(cliffSlabs.some(p=>Math.hypot(p.x-x,p.z-z)<20))continue;
    cliffSlabs.push({x,z,y,h:18+rng()*34,w:5+rng()*6});
  }
  for(const p of cliffSlabs){
    const dx=patmosV2Height(p.x+3,p.z)-patmosV2Height(p.x-3,p.z),dz=patmosV2Height(p.x,p.z+3)-patmosV2Height(p.x,p.z-3);
    add(slabG,rng()<.30?rockDark:rock,p.x,p.y-p.h*.34,p.z,[p.w,p.h,p.w*.62],Math.atan2(dx,dz)+(rng()-.5)*.22,0,(rng()-.5)*.08,false,'Patmos cliff stratum');
  }

  // --- Harbor. Keep open water dominant; docks hug the sides instead of spanning the basin.
  const dockY=9;
  box(-58,dockY-1.0,210,[54,1.8,10],woodDark,-.09,true,'West harbor quay');
  box(57,dockY-1.0,188,[48,1.8,9],wood,.08,true,'East harbor quay');
  box(8,dockY-1.0,285,[12,1.8,62],woodDark,-.03,true,'Arrival pier');
  for(const [x,z] of[[-82,216],[-54,208],[-24,200],[36,190],[62,185],[86,178],[1,315],[6,282],[11,250]]){
    beam([x,1,z],[x,dockY,z],.24,woodDark,false,'Harbor post');
  }
  // Small cargo clusters only at quay edges.
  for(const [x,z,s] of[[-70,198,1],[-48,205,.85],[54,176,.9],[74,182,.72]]){
    box(x,dockY+.35,z,[4*s,3*s,4*s],wood2,rng()*.4,false,'Harbor cargo');
  }

  // --- Stone ledges. These are the core city masses, visibly embedded into rock.
  const terraces=[
    {id:'westLower',x:-165,y:34,z:116,w:105,d:52,ry:-.08},
    {id:'eastLower',x:164,y:40,z:96,w:96,d:48,ry:.08},
    {id:'westMid',x:-205,y:67,z:8,w:92,d:48,ry:.05},
    {id:'eastMid',x:207,y:76,z:-10,w:92,d:48,ry:-.06},
    {id:'market',x:-155,y:105,z:-108,w:118,d:58,ry:.03},
    {id:'eastHigh',x:153,y:126,z:-132,w:105,d:54,ry:-.04},
    {id:'upperWest',x:-105,y:158,z:-225,w:112,d:58,ry:.06},
    {id:'upperEast',x:105,y:177,z:-245,w:110,d:56,ry:-.05},
    {id:'citadelApproach',x:12,y:211,z:-320,w:132,d:64,ry:.01},
  ];
  function terrace(t){
    // Thick stone plinth, plus irregular toe rocks that visually bury it into the cliff.
    box(t.x,t.y-3.0,t.z,[t.w,6,t.d],oldStoneDark,t.ry,true,'Patmos stone terrace '+t.id);
    box(t.x,t.y+.02,t.z,[t.w*.96,.7,t.d*.95],oldStone,t.ry,true,'Patmos terrace floor '+t.id);
    for(let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2,r=.45+.22*rng(),x=t.x+Math.cos(a)*t.w*r,z=t.z+Math.sin(a)*t.d*r;
      add(rockG,rng()<.4?rockDark:rock,x,t.y-3.2,z,[5+rng()*5,4+rng()*6,5+rng()*5],rng()*Math.PI,0,(rng()-.5)*.12,false,'Terrace embedded rock');
    }
  }
  terraces.forEach(terrace);

  const T=Object.fromEntries(terraces.map(t=>[t.id,t]));
  function stoneRamp(a,b,w=13){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    const o=add(boxG,oldStoneDark,mid.x,mid.y-1.4,mid.z,[w,2.8,len],yaw,pitch,0,true,'Patmos stone stair-ramp');
    // break the silhouette with small cap stones.
    for(let i=1;i<5;i++){const p=A.clone().lerp(B,i/5);box(p.x,p.y+.25,p.z,[w*.52,.42,1.8],oldStone,yaw,false,'Old stair tread');}
    return o;
  }

  // Harbor -> west lower -> west mid -> market -> upper west -> citadel approach -> citadel.
  stoneRamp([-72,12,181],[-132,34,140],15);
  stoneRamp([-182,37,92],[-205,67,32],14);
  stoneRamp([-206,70,-14],[-174,103,-82],14);
  stoneRamp([-132,108,-136],[-116,158,-198],13);
  stoneRamp([-78,161,-248],[-8,211,-305],14);
  // East branch for visual / alternate exploration.
  stoneRamp([72,12,168],[135,40,118],14);
  stoneRamp([182,43,76],[207,76,12],13);
  stoneRamp([205,79,-30],[168,126,-106],13);
  stoneRamp([135,129,-156],[108,177,-216],13);
  stoneRamp([75,180,-265],[25,211,-306],13);

  // Only three short cross-cliff bridges. Stone masses remain dominant.
  function woodBridge(a,b,w=7){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    add(boxG,woodDark,mid.x,mid.y-.55,mid.z,[w,1.1,len],yaw,pitch,0,true,'Patmos short bridge');
    const nx=-d.z/(horiz||1),nz=d.x/(horiz||1);
    for(const side of[-1,1])beam([A.x+nx*side*w*.55,A.y+1.1,A.z+nz*side*w*.55],[B.x+nx*side*w*.55,B.y+1.1,B.z+nz*side*w*.55],.07,iron,false,'Bridge rope');
  }
  woodBridge([-112,39,108],[116,44,95],8);
  woodBridge([-145,109,-112],[118,132,-136],7);
  woodBridge([-54,163,-227],[64,181,-246],7);

  // --- Buildings: stone ground floor + timber upper floors + balconies. Large enough to read as architecture.
  function house(x,y,z,s=1,ry=0,stories=1){
    const w=(12+rng()*5)*s,d=(10+rng()*4)*s;
    box(x,y+2.2,z,[w,4.4,d],oldStoneDark,ry,false,'Patmos masonry base');
    for(let st=0;st<stories;st++){
      const yy=y+5.6+st*6.2;
      box(x+(rng()-.5)*1.2,yy,z+(rng()-.5)*.8,[w*.9,5.6,d*.88],st%2?wood2:wood,ry,false,'Patmos timber house');
      // balcony faces harbor.
      const front=z+Math.cos(ry)*d*.50;
      box(x,yy-.8,front,[w*.96,.45,3.2],woodDark,ry,false,'Patmos balcony');
    }
    const roofY=y+5.6+(stories-1)*6.2+4.1;
    const rg=new THREE.ConeGeometry(1,1,4);G.add(rg);
    add(rg,woodDark,x,roofY,z,[w*.64,5.0,d*.64],ry+Math.PI/4,0,0,false,'Patmos roof');
    // one warm window toward harbor
    box(x,y+6.1,z+d*.46,[2.2,2.2,.18],glow,ry,false,'Patmos warm window');
  }
  function cluster(t,layout){
    for(const p of layout)house(t.x+p[0],t.y+.7,t.z+p[1],p[2]||1,(p[3]||0)+t.ry,p[4]||1);
    // canopy + crates make each terrace feel occupied.
    const cg=new THREE.PlaneGeometry(t.w*.36,t.d*.30,3,2);cg.rotateX(-Math.PI/2);G.add(cg);
    add(cg,cloth,t.x+t.w*.18,t.y+8,t.z-t.d*.12,[1,1,1],0,0,.06,false,'Patmos canopy');
  }
  cluster(T.westLower,[[-30,-10,1.15,.08,2],[3,-7,.9,-.1,1],[29,8,1.0,.12,2],[-10,13,.85,0,1]]);
  cluster(T.eastLower,[[-26,-8,1.0,-.08,1],[4,-6,1.1,.08,2],[27,10,.9,-.1,1]]);
  cluster(T.westMid,[[-24,-8,1.0,.1,2],[10,-7,.88,-.08,1],[26,10,1.0,.04,1],[-10,12,.82,.12,1]]);
  cluster(T.eastMid,[[-22,-8,.95,-.1,1],[9,-6,1.05,.08,2],[28,10,.82,0,1]]);
  cluster(T.market,[[-34,-9,1.0,.04,1],[-8,-12,1.15,-.06,2],[26,-7,.9,.08,1],[39,11,.82,-.05,1],[-23,13,.9,.08,1]]);
  cluster(T.eastHigh,[[-30,-7,1.1,.08,2],[2,-9,.9,-.05,1],[31,8,1.05,.06,2],[-9,12,.82,-.08,1]]);
  cluster(T.upperWest,[[-31,-8,1.1,-.05,2],[2,-9,1.0,.08,2],[34,8,.88,-.08,1],[-14,13,.9,.05,1]]);
  cluster(T.upperEast,[[-31,-8,1.0,.08,2],[1,-10,1.05,-.06,2],[33,8,.88,.08,1],[-12,13,.85,-.05,1]]);

  // --- Market cave: oval darkness embedded in a rock pocket, never a rectangle.
  const caveX=T.market.x-8,caveZ=T.market.z-34,caveY=T.market.y+24;
  const caveG=new THREE.CircleGeometry(1,48);G.add(caveG);
  const cave=add(caveG,caveDark,caveX,caveY,caveZ,[32,26,1],0,0,0,false,'Patmos cavern mouth');
  cave.castShadow=false;
  // irregular boulder rim hides the planar edge.
  for(let i=0;i<16;i++){
    const a=Math.PI*(i/15),x=caveX+Math.cos(a)*34,z=caveZ+1,y=caveY+Math.sin(a)*27;
    add(rockG,i%4===0?rockDark:rock,x,y,z,[5+rng()*4,6+rng()*5,5+rng()*3],rng()*Math.PI,0,(rng()-.5)*.18,false,'Cavern rim rock');
  }
  for(const [ox,oz] of[[-18,11],[0,10],[19,8],[-8,25],[13,23]]){
    box(caveX+ox,T.market.y+2,caveZ+oz,[11,1.0,7],wood2,(rng()-.5)*.2,false,'Market stall');
    const l=new THREE.PointLight('#ff9b57',4.5,34,1.7);l.position.set(caveX+ox,T.market.y+8,caveZ+oz+4);root.add(l);lights.push(l);
  }

  // --- Old-world architecture: aqueduct fragments + high citadel, much larger than current huts.
  function oldPillar(x,y,z,h=30,w=7){
    box(x,y+h*.5,z,[w,h,w],oldStone,rng()*.08,false,'Old stone pillar');
    box(x,y+h+.8,z,[w*1.35,1.6,w*1.35],oldStoneDark,0,false,'Old pillar capital');
  }
  for(const x of[-310,-270,-230])oldPillar(x,patmosV2Height(x,-230),-230,46,8);
  // connecting aqueduct beams on the left skyline
  box(-270,210,-230,[96,8,13],oldStoneDark,0,false,'Ancient aqueduct crown');

  // Citadel sits on a real back ridge and is visible from the harbor as a distant goal.
  const citY=257,citZ=-405;
  box(0,citY-4,citZ,[150,8,96],oldStoneDark,0,true,'Citadel foundation');
  box(0,citY+.5,citZ,[142,1.0,90],oldStone,0,true,'Citadel court');
  for(const x of[-54,54]){
    box(x,citY+24,citZ-18,[24,48,28],oldStone,0,false,'Citadel tower');
    const rg=new THREE.ConeGeometry(1,1,6);G.add(rg);add(rg,woodDark,x,citY+53,citZ-18,[18,18,18],0,0,0,false,'Citadel tower roof');
  }
  box(0,citY+24,citZ-38,[64,42,22],oldStone,0,false,'Citadel keep');
  // monumental gate frame
  for(const x of[-26,26])box(x,citY+18,citZ+28,[11,36,12],oldStone,0,false,'Citadel gate pier');
  box(0,citY+38,citZ+28,[62,8,14],oldStoneDark,0,false,'Citadel gate lintel');

  // Watch towers at outer lips.
  function tower(x,z,h=30){
    const y=patmosV2Height(x,z)+1;
    for(const sx of[-5,5])for(const sz of[-5,5])beam([x+sx,y,z+sz],[x+sx,y+h,z+sz],.38,woodDark,false,'Watch leg');
    box(x,y+h,z,[16,2,16],woodDark,0,true,'Watch deck');
    beam([x,y+h,z],[x,y+h+14,z],.22,woodDark,false,'Flag mast');
    const fg=new THREE.PlaneGeometry(10,5);G.add(fg);const f=add(fg,cloth,x+5,y+h+10,z,[1,1,1],0,0,0,false,'Patmos banner');f.rotation.y=Math.PI/2;
  }
  tower(-300,330,30);tower(300,300,32);tower(225,-110,26);

  // Waterfall: narrow ribbon tucked between rock masses, not the main structure.
  const fg=new THREE.PlaneGeometry(18,150,5,24);G.add(fg);
  const fp=fg.attributes.position;for(let i=0;i<fp.count;i++)fp.setZ(i,.5*Math.sin(fp.getY(i)*.14)+.2*Math.sin(fp.getX(i)*.6));
  const fall=add(fg,waterFall,96,158,-285,[1,1,1],0,0,0,false,'Patmos high waterfall');fall.castShadow=false;

  // Vegetation only on ledges / shoulders.
  for(let i=0;i<115;i++){
    const x=(rng()-.5)*760,z=(rng()-.5)*650-80,y=patmosV2Height(x,z),sl=Math.hypot(patmosV2Height(x+2,z)-patmosV2Height(x-2,z),patmosV2Height(x,z+2)-patmosV2Height(x,z-2))/4;
    if(y<18||sl>.65||Math.hypot(x,z-130)<160)continue;
    add(rockG,rng()<.45?moss:moss2,x,y+.05,z,[1.3+rng()*2,.10,1+rng()*1.8],rng()*Math.PI,0,0,false,'Patmos ledge moss').castShadow=false;
  }

  // City lights mark occupied clusters.
  const lightPts=[
    [-165,47,115],[164,53,96],[-205,81,8],[207,90,-10],[-155,119,-108],[153,140,-132],
    [-105,172,-225],[105,191,-245],[0,276,-405]
  ];
  for(const [x,y,z] of lightPts){const l=new THREE.PointLight('#ff9b58',3.2,42,1.7);l.position.set(x,y,z);root.add(l);lights.push(l);}

  // --- QA/inspection points
  const points=[
    {id:'approach',name:'S자 바닷길',x:25,y:8,z:500,target:[0,50,170]},
    {id:'harbor',name:'숨은 밧모 항구',x:8,y:12,z:275,target:[0,78,-20]},
    {id:'lower',name:'절벽 하층 도시',x:-128,y:39,z:140,target:[-190,82,-20]},
    {id:'market',name:'암시장 동굴',x:-125,y:110,z:-70,target:[caveX,caveY,caveZ]},
    {id:'upper',name:'상층 감시 지구',x:110,y:182,z:-220,target:[0,252,-390]},
    {id:'citadel',name:'옛 성채',x:12,y:263,z:-340,target:[0,282,-420]},
  ];

  const ray=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0);
  function groundAt(x,z,fromY=900){
    const h=patmosV2Height(x,z);let y=h<=fromY+.01?h:-30;
    origin.set(x,fromY,z);ray.set(origin,down);ray.far=Math.max(1,fromY+80);
    const hit=ray.intersectObjects(supports,true)[0];if(hit)y=Math.max(y,hit.point.y);return y;
  }

  const api={
    root,points,spawn:{x:8,y:dockY+2.5,z:305},size:SIZE,qualityVersion:'patmos-landmark-v2',
    field:{height:patmosV2Height,points,support:groundAt},groundAt,
    stats:{terrainMeters:SIZE,cliffSlabs:cliffSlabs.length,stoneTerraces:terraces.length,bridges:3,cityClusters:8,lights:lights.length},
    dispose(){for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());}
  };
  ctx.terrain=api;
  return api;
}
