/** PATMOS Hidden Harbor v6
 * Composition-first proof slice for the final 1km+ landmark.
 * Visual rule:
 *   LEFT  = dense cliff city / retaining walls / stacked housing
 *   RIGHT = mostly natural cliff / watch infrastructure
 *   REAR  = closed black-market cavern + old gate
 * The harbor must read as an enclosed smuggler basin, never a symmetric canyon.
 */
import * as THREE from 'three';

const rngFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const rng=rngFor(301001);

function loftGeometry(rings){
  const P=rings[0].pts.length,verts=[],idx=[];
  for(const r of rings)for(const [x,z] of r.pts)verts.push(x,r.y,z);
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<P;i++){
    const a=j*P+i,b=j*P+(i+1)%P,c=(j+1)*P+i,d=(j+1)*P+(i+1)%P;
    idx.push(a,c,b,b,c,d);
  }
  let ci=verts.length/3,cx=rings[0].pts.reduce((s,p)=>s+p[0],0)/P,cz=rings[0].pts.reduce((s,p)=>s+p[1],0)/P;
  verts.push(cx,rings[0].y,cz);for(let i=0;i<P;i++)idx.push(ci,(i+1)%P,i);
  const last=rings.length-1;ci=verts.length/3;cx=rings[last].pts.reduce((s,p)=>s+p[0],0)/P;cz=rings[last].pts.reduce((s,p)=>s+p[1],0)/P;
  verts.push(cx,rings[last].y,cz);for(let i=0;i<P;i++)idx.push(ci,last*P+i,last*P+(i+1)%P);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function irregularRock(w,d,h,seed,leanX=0,leanZ=0){
  const rr=rngFor(seed);
  const base=[[-.50,-.38],[-.28,-.55],[.03,-.60],[.34,-.50],[.53,-.28],[.58,.03],[.46,.34],[.19,.55],[-.13,.59],[-.40,.48],[-.57,.23],[-.60,-.06]];
  const rings=[0,.22,.48,.74,1].map((t,ri)=>{
    const sc=1-ri*.065+(ri===2?.025:0);
    return {y:h*t,pts:base.map(([x,z],i)=>[
      x*w*sc+leanX*t+(rr()-.5)*w*.04,
      z*d*sc+leanZ*t+(rr()-.5)*d*.04
    ])};
  });
  return loftGeometry(rings);
}
function ledgeGeometry(points,yTop,thick=4){
  return loftGeometry([{y:yTop-thick,pts:points.map(([x,z])=>[x*.985,z*.985])},{y:yTop,pts:points}]);
}
function prismRoofGeometry(w,d,h){
  const v=[-w/2,0,-d/2,w/2,0,-d/2,-w/2,0,d/2,w/2,0,d/2,-w/2,h,0,w/2,h,0];
  const i=[0,1,4,1,5,4,2,4,3,3,4,5,0,4,2,1,3,5,0,2,3,0,3,1];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;
}
function archGeometry(w,h,thick=1.8,depth=1.7){
  const r=w/2,spring=h-r,iw=w-thick*2,ir=iw/2,ispring=spring+thick*.35;
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(-w/2,spring);shape.absarc(0,spring,r,Math.PI,0,false);shape.lineTo(w/2,0);shape.lineTo(-w/2,0);
  const hole=new THREE.Path();hole.moveTo(-iw/2,0);hole.lineTo(-iw/2,ispring);hole.absarc(0,ispring,ir,Math.PI,0,false);hole.lineTo(iw/2,0);hole.lineTo(-iw/2,0);shape.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});g.computeVertexNormals();return g;
}

export async function initPatmosHarborV6(ctx){
  const {scene,world,RAPIER:R}=ctx;
  const root=new THREE.Group();root.name='PATMOS / hidden harbor composition v6';scene.add(root);
  const G=new Set(),M=new Set(),colliders=[],supports=[],lights=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,flatShading:true,...o});M.add(m);return m;};
  const rock=mat('#68736c'),rock2=mat('#56625d'),rockDark=mat('#414f4b'),rockWet=mat('#38504d');
  const stone=mat('#898c7e'),stone2=mat('#626960'),stoneDark=mat('#4f5852');
  const plaster=mat('#9a8c70'),wood=mat('#75523a'),wood2=mat('#906545'),woodDark=mat('#49362a'),roof=mat('#5b4336');
  const cloth=mat('#803f36',{side:THREE.DoubleSide}),iron=mat('#495151',{metalness:.22,roughness:.72});
  const windowM=mat('#ffca80',{emissive:'#ff9b52',emissiveIntensity:2.8,roughness:.55});
  const dark=mat('#111918',{side:THREE.DoubleSide}),moss=mat('#536c47');
  const boxG=new THREE.BoxGeometry(1,1,1),rockG=new THREE.DodecahedronGeometry(1,0),cylG=new THREE.CylinderGeometry(1,1,1,7);
  G.add(boxG);G.add(rockG);G.add(cylG);

  function fixed(desc){const c=world.createCollider(desc.setFriction(.94));colliders.push(c);return c;}
  function solid(o,walk=true){
    o.updateWorldMatrix(true,false);
    const p=o.geometry.attributes.position,verts=new Float32Array(p.count*3),q=new THREE.Vector3();
    for(let i=0;i<p.count;i++){q.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);verts.set(q.toArray(),i*3);}
    const ii=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);
    fixed(R.ColliderDesc.trimesh(verts,ii));if(walk)supports.push(o);return o;
  }
  function mesh(g,m,x=0,y=0,z=0,s=[1,1,1],ry=0,rx=0,rz=0,walk=false,name=''){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);if(walk)solid(o,true);return o;
  }
  function collideOnly(o){solid(o,false);return o;}
  const box=(x,y,z,s,m=wood,ry=0,walk=false,name='')=>mesh(boxG,m,x,y,z,s,ry,0,0,walk,name);
  function collideOnly(o){solid(o,false);return o;}
  function beam(a,b,r=.08,m=woodDark,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.88,r,len,6);G.add(g);
    const o=mesh(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,false,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;
  }
  function placeGroup(g,x,y,z,ry=0,name=''){g.position.set(x,y,z);g.rotation.y=ry;g.name=name;root.add(g);return g;}

  // ---------------------------------------------------------------------------
  // 1) U-SHAPED HARBOR GEOLOGY — asymmetrical by design
  // ---------------------------------------------------------------------------
  const leftChunks=[
    [-74,-8,82,72,78,76,101,5,-10],[-83,-10,23,78,72,105,107,4,-8],[-80,-12,-42,70,66,124,113,6,-5],
    [-57,18,-82,60,54,104,127,3,-6]
  ];
  const rightChunks=[
    [73,-9,70,66,86,92,201,-5,-8],[82,-11,5,74,78,118,211,-5,-5],[77,-12,-58,67,68,132,223,-4,-4]
  ];
  const rearChunks=[
    [-51,-13,-103,64,58,128,301,4,-4],[53,-14,-104,68,60,126,311,-4,-4]
  ];
  for(const [x,y,z,w,d,h,seed,lx,lz] of leftChunks){
    const g=irregularRock(w,d,h,seed,lx,lz);G.add(g);collideOnly(mesh(g,seed%2?rock:rock2,x,y,z,[1,1,1],0,0,0,false,'left city cliff'));
  }
  for(const [x,y,z,w,d,h,seed,lx,lz] of rightChunks){
    const g=irregularRock(w,d,h,seed,lx,lz);G.add(g);collideOnly(mesh(g,seed%2?rock2:rock,x,y,z,[1,1,1],0,0,0,false,'right natural cliff'));
  }
  for(const [x,y,z,w,d,h,seed,lx,lz] of rearChunks){
    const g=irregularRock(w,d,h,seed,lx,lz);G.add(g);collideOnly(mesh(g,rockDark,x,y,z,[1,1,1],0,0,0,false,'rear harbor cliff'));
  }

  // smaller rock masses break every skyline and erase the "one polygon wall" look
  const breakers=[
    [-52,10,108,19,25,29],[-45,34,72,18,23,25],[-57,61,25,18,25,31],[-63,84,-21,20,27,30],
    [-45,100,-65,20,25,24],[56,10,100,18,25,31],[60,36,51,21,27,34],[67,68,2,19,28,32],
    [54,94,-50,21,27,29],[-23,92,-94,17,24,25],[24,91,-96,17,24,25]
  ];
  for(const [x,y,z,sx,sy,sz] of breakers)mesh(rockG,rng()<.4?rock2:rock,x,y,z,[sx,sy,sz],rng()*Math.PI,0,(rng()-.5)*.14,false,'cliff breaker');

  // dark wet rock line at the basin edge
  for(const side of[-1,1])for(let i=0;i<7;i++){
    const z=108-i*29,x=side*(55+Math.sin(i*.87)*8);
    mesh(rockG,rockWet,x,1.8,z,[8+rng()*4,5+rng()*4,8+rng()*4],rng()*Math.PI,0,(rng()-.5)*.16,false,'wet shoreline');
  }

  // ---------------------------------------------------------------------------
  // 2) LARGE-SCALE URBAN INFRASTRUCTURE — the missing middle scale
  // ---------------------------------------------------------------------------
  function retainingBlock(points,y,thick,name){
    const g=ledgeGeometry(points,y,thick);G.add(g);mesh(g,stone2,0,0,0,[1,1,1],0,0,0,true,name);return g;
  }
  // left lower quay city base
  retainingBlock([[-91,93],[-42,92],[-37,56],[-86,54]],18,7,'left lower retaining mass');
  // left mid city base
  retainingBlock([[-94,48],[-45,47],[-43,8],[-91,7]],47,8,'left middle retaining mass');
  // left upper city base
  retainingBlock([[-89,-1],[-43,-4],[-41,-43],[-84,-46]],77,8,'left upper retaining mass');
  // rear market court
  retainingBlock([[-40,-73],[40,-73],[43,-112],[-43,-113]],74,8,'rear market court');
  // right lower service shelf — much smaller than the left
  retainingBlock([[44,86],[77,84],[79,54],[47,56]],17,6,'right service ledge');

  // Left retaining facade with repeated arches = city block, not individual shelf.
  function arcadeRow(x0,y,z,count,spacing,w=9,h=11,ry=0){
    for(let i=0;i<count;i++){
      const x=x0+i*spacing;
      const ag=archGeometry(w,h,1.25,1.4);G.add(ag);mesh(ag,stone,x,y,z,[1,1,1],ry,0,0,false,'retaining arcade arch');
      box(x,y+h*.38,z-1.1,[w*.65,h*.52,1.0],dark,ry,false,'arcade darkness').castShadow=false;
    }
  }
  arcadeRow(-82,18,-55?0:0,0,0); // no-op kept out by count=0; below are the real rows
  // front-facing facades, one row per city level
  arcadeRow(-80,18,54,5,9.2,8,10,0);
  arcadeRow(-80,47,7,5,9.2,8,10,0);
  arcadeRow(-76,77,-43,4,9.5,8.5,11,0);

  // Massive stair tower / lane linking the three left city levels.
  box(-89,33,46,[12,30,13],stoneDark,.06,false,'left stair tower mass');
  box(-86,63,-2,[12,30,13],stoneDark,-.05,false,'left stair tower mass');

  // ---------------------------------------------------------------------------
  // 3) BESPOKE BUILDING CLUSTERS — intentionally different silhouettes
  // ---------------------------------------------------------------------------
  function house({w=12,d=8,h=8,floors=1,plasterBody=false,balcony=true,awning=false,lean=0}={}){
    const g=new THREE.Group();
    const base=new THREE.Mesh(boxG,plasterBody?plaster:stone2);base.scale.set(w,4.4,d);base.position.y=2.2;g.add(base);
    for(let f=0;f<floors;f++){
      const fy=4.4+f*h*.72;
      const body=new THREE.Mesh(boxG,plasterBody?plaster:wood);body.scale.set(w*.93,h*.68,d*.93);body.position.set(lean*f,fy+h*.34,0);g.add(body);
      // strong timber frame on facade
      for(const sx of[-.38,0,.38]){const b=new THREE.Mesh(boxG,woodDark);b.scale.set(.22,h*.64,.22);b.position.set(sx*w+lean*f,fy+h*.34,d*.47);g.add(b);}
      const bh1=new THREE.Mesh(boxG,woodDark);bh1.scale.set(w*.9,.22,.22);bh1.position.set(lean*f,fy+h*.16,d*.47);g.add(bh1);
      const bh2=bh1.clone();bh2.position.y=fy+h*.55;g.add(bh2);
      for(const sx of[-.22,.22]){const win=new THREE.Mesh(boxG,windowM);win.scale.set(1.25,1.55,.13);win.position.set(sx*w+lean*f,fy+h*.36,d*.485);g.add(win);}
    }
    const rg=prismRoofGeometry(w*1.08,d*1.1,4.0);G.add(rg);const r=new THREE.Mesh(rg,roof);r.position.set(lean*Math.max(0,floors-1),4.4+floors*h*.72,0);g.add(r);
    if(balcony){
      const by=5.7+Math.max(0,floors-1)*h*.72,bx=lean*Math.max(0,floors-1);
      const deck=new THREE.Mesh(boxG,woodDark);deck.scale.set(w*.94,.42,2.4);deck.position.set(bx,by,d*.62);g.add(deck);
      for(const sx of[-.42,-.14,.14,.42]){const p=new THREE.Mesh(boxG,woodDark);p.scale.set(.16,1.35,.16);p.position.set(bx+sx*w,by+.9,d*.72);g.add(p);}
      const rail=new THREE.Mesh(boxG,woodDark);rail.scale.set(w*.92,.16,.16);rail.position.set(bx,by+1.45,d*.72);g.add(rail);
    }
    if(awning){
      const ag=new THREE.PlaneGeometry(w*.7,3.8,3,1);ag.rotateX(-Math.PI/2);G.add(ag);const a=new THREE.Mesh(ag,cloth);a.position.set(0,6.2,d*.78);a.rotation.z=.06;g.add(a);
    }
    g.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});return g;
  }
  function carvedShop({w=12,h=10,d=7}={}){
    const g=new THREE.Group();
    const back=new THREE.Mesh(boxG,dark);back.scale.set(w*.72,h*.56,.35);back.position.set(0,h*.36,-d*.46);g.add(back);
    const floor=new THREE.Mesh(boxG,stone2);floor.scale.set(w,1,d);floor.position.set(0,.5,0);g.add(floor);
    const ag=archGeometry(w*.72,h*.8,1.2,1.15);G.add(ag);const a=new THREE.Mesh(ag,stone);a.position.set(0,0,d*.48);g.add(a);
    const l=new THREE.PointLight('#ff9c58',2.4,18,1.7);l.position.set(0,4,d*.2);g.add(l);return g;
  }
  function P(g,x,y,z,ry=0,name=''){g.position.set(x,y,z);g.rotation.y=ry;g.name=name;root.add(g);return g;}

  // LEFT LOWER DISTRICT — dense, irregular and largest
  P(house({w:17,d:11,h:9,floors:2,plasterBody:true,balcony:true,awning:true,lean:-.7}),-74,20,73,.04,'left lower tavern');
  P(house({w:13,d:9,h:8,floors:1,balcony:true,awning:false}),-55,20,74,-.07,'left lower house');
  P(house({w:15,d:10,h:8,floors:2,balcony:true,awning:false,lean:.4}),-45,20,61,.08,'left lower tall house');
  P(carvedShop({w:12,h:10,d:8}),-84,20,61,0,'left lower carved shop');
  P(carvedShop({w:10,h:9,d:7}),-65,20,57,0,'left lower carved shop');

  // LEFT MID DISTRICT
  P(house({w:16,d:10,h:9,floors:2,plasterBody:false,balcony:true,awning:false,lean:.5}),-77,49,28,.05,'left mid tall house');
  P(house({w:13,d:9,h:8,floors:2,plasterBody:true,balcony:true,awning:true}),-58,49,26,-.05,'left mid house');
  P(house({w:12,d:8,h:8,floors:1,balcony:true,awning:false}),-47,49,14,.09,'left mid house');
  P(carvedShop({w:12,h:10,d:8}),-86,49,13,0,'left mid carved room');

  // LEFT UPPER DISTRICT
  P(house({w:15,d:10,h:9,floors:2,plasterBody:true,balcony:true,awning:false,lean:-.5}),-75,79,-22,.04,'left upper tall house');
  P(house({w:12,d:8,h:8,floors:1,balcony:true,awning:true}),-57,79,-20,-.06,'left upper house');
  P(house({w:14,d:9,h:8,floors:2,balcony:true,awning:false}),-47,79,-35,.08,'left upper house');

  // RIGHT = sparse service architecture only
  P(house({w:14,d:10,h:8,floors:1,plasterBody:true,balcony:false,awning:true}),57,19,70,-.06,'right warehouse');
  P(carvedShop({w:11,h:9,d:7}),72,19,62,Math.PI,'right storage arch');

  // watchtower on the natural right cliff
  function watchTower(x,y,z,h=28){
    for(const sx of[-4.5,4.5])for(const sz of[-4.5,4.5])beam([x+sx,y,z+sz],[x+sx,y+h,z+sz],.34,woodDark,'watch leg');
    box(x,y+h,z,[14,1.7,14],woodDark,0,true,'watch deck');beam([x,y+h,z],[x,y+h+12,z],.2,woodDark,'watch mast');
    const fg=new THREE.PlaneGeometry(9,4.5);G.add(fg);const f=mesh(fg,cloth,x+4.5,y+h+8,z,[1,1,1],0,0,0,false,'watch flag');f.rotation.y=Math.PI/2;
  }
  watchTower(69,76,-12,26);

  // ---------------------------------------------------------------------------
  // 4) REAR MARKET CAVERN + OLD GATE — closes the basin
  // ---------------------------------------------------------------------------
  // broad rear court in front of the gate
  retainingBlock([[-43,-72],[43,-72],[46,-112],[-46,-113]],74,8,'rear black market court');
  // giant dark arch opening, framed in old masonry
  const caveArch=archGeometry(38,35,3.0,4.0);G.add(caveArch);mesh(caveArch,stone,0,74,-102,[1,1,1],0,0,0,false,'black market monumental arch');
  box(0,92,-106,[28,31,3],dark,0,false,'black market darkness').castShadow=false;
  // tall gate towers make a 40-60m urban infrastructure scale
  box(-29,96,-100,[16,44,18],stone2,0,false,'old gate tower');
  box(29,96,-100,[16,44,18],stone2,0,false,'old gate tower');
  box(0,121,-100,[74,8,20],stoneDark,0,false,'old gate crown');
  // current buildings parasitize the old gate
  P(house({w:15,d:9,h:8,floors:2,plasterBody:false,balcony:true,awning:false}),-31,76,-81,.03,'gate parasite house');
  P(house({w:14,d:9,h:8,floors:2,plasterBody:true,balcony:true,awning:false}),31,76,-81,-.03,'gate parasite house');
  P(house({w:12,d:8,h:8,floors:1,plasterBody:false,balcony:true,awning:true}),0,76,-76,0,'gate market house');
  // cave lanterns deeper in
  for(const x of[-12,0,12]){const l=new THREE.PointLight('#ff9855',3.2,28,1.6);l.position.set(x,84,-104);root.add(l);lights.push(l);}

  // ---------------------------------------------------------------------------
  // 5) PATHS — mostly stone against the cliff; ONE visible bridge
  // ---------------------------------------------------------------------------
  function ramp(a,b,w=5,m=stone2,name='stone stairs'){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    mesh(boxG,m,mid.x,mid.y-.55,mid.z,[w,1.1,len],yaw,pitch,0,true,name);
    for(let i=1;i<7;i++){const p=A.clone().lerp(B,i/7);box(p.x,p.y+.04,p.z,[w*.58,.25,1.0],stone,yaw,false,'stair tread');}
  }
  // harbour to left district
  ramp([-24,7,110],[-43,18,91],5.6);ramp([-83,21,54],[-86,47,42],5.2);ramp([-84,50,5],[-84,77,-7],5.0);
  // rear access
  ramp([-62,80,-46],[-40,74,-73],5.0);ramp([35,76,-70],[20,74,-78],4.8);
  // right service path
  ramp([25,7,105],[48,18,88],5.2);

  function bridge(a,b,w=5.2){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    mesh(boxG,woodDark,mid.x,mid.y-.3,mid.z,[w,.65,len],yaw,pitch,0,true,'single harbor bridge');
    const nx=-d.z/(horiz||1),nz=d.x/(horiz||1);
    for(const side of[-1,1])beam([A.x+nx*side*w*.58,A.y+1.3,A.z+nz*side*w*.58],[B.x+nx*side*w*.58,B.y+1.3,B.z+nz*side*w*.58],.052,iron,'bridge rope');
  }
  bridge([-43,49,22],[22,52,4],5.4); // angled, not a horizontal line across the whole scene

  // ---------------------------------------------------------------------------
  // 6) HARBOR FOREGROUND — small arrival pier, asymmetric working quays
  // ---------------------------------------------------------------------------
  box(0,6.1,137,[4.4,1.5,23],woodDark,0,true,'arrival pier');
  box(-36,5.6,115,[24,1.3,5.5],woodDark,-.09,true,'busy west quay');
  box(39,5.4,108,[18,1.2,5.2],wood,.06,true,'small east quay');
  box(-38,2.0,118,[29,4.0,9],stone2,-.09,false,'old west seawall');
  box(40,1.8,111,[23,3.8,8],stone2,.06,false,'old east seawall');
  for(const [x,z] of[[-48,118],[-36,114],[-24,111],[31,106],[41,109],[50,111],[-2,156],[2,137],[0,117]])beam([x,0,z],[x,6.6,z],.18,woodDark,'harbor piling');
  function crane(x,y,z,side){
    beam([x,y,z],[x,y+13,z],.24,woodDark,'crane mast');beam([x,y+11,z],[x+side*9,y+11,z-2],.19,woodDark,'crane arm');beam([x+side*7,y+11,z-2],[x+side*7,y+3,z-2],.042,iron,'crane rope');
  }
  crane(-47,6,112,-1);crane(50,6,106,1);

  // awnings only in the busy left city
  for(const [x,y,z,w,d,r] of[[-69,29,74,13,4.5,.07],[-52,28,62,12,4,-.06],[-70,58,26,12,4,.05],[-55,58,15,11,4,-.04]]){
    const g=new THREE.PlaneGeometry(w,d,3,1);g.rotateX(-Math.PI/2);G.add(g);mesh(g,cloth,x,y,z,[1,1,1],0,0,r,false,'left market awning');
  }

  // moss / rock seams soften the architecture-rock join
  for(let i=0;i<34;i++){
    const left=i<25,side=left?-1:1,x=side*(48+rng()*28),z=-55+rng()*150,y=12+rng()*75;
    mesh(rockG,rng()<.45?moss:rock2,x,y,z,[2+rng()*3,.15+rng()*.12,2+rng()*3],rng()*Math.PI,0,(rng()-.5)*.08,false,'cliff seam detail').castShadow=false;
  }

  // neighbourhood light hierarchy
  const lit=[[-73,28,73],[-52,28,62],[-76,57,26],[-56,57,15],[-70,86,-23],[-49,87,-34],[57,27,70],[-31,89,-82],[31,89,-82]];
  for(const p of lit){const l=new THREE.PointLight('#ff9b58',2.8,28,1.65);l.position.set(...p);root.add(l);lights.push(l);}

  // ---------------------------------------------------------------------------
  // 7) QA / PLAYER
  // ---------------------------------------------------------------------------
  const points=[
    {id:'harbor',name:'숨은 밧모 항구',x:0,y:8,z:143,target:[-20,60,-28]},
    {id:'leftLower',name:'밀집 하층 시가지',x:-34,y:18,z:103,target:[-67,47,28]},
    {id:'leftMid',name:'중층 골목',x:-54,y:49,z:38,target:[-70,77,-22]},
    {id:'bridge',name:'도시 연결 다리',x:-18,y:52,z:14,target:[-55,62,-20]},
    {id:'market',name:'암시장 성문',x:0,y:77,z:-67,target:[0,96,-104]},
    {id:'watch',name:'동쪽 감시 절벽',x:48,y:20,z:86,target:[69,102,-12]},
  ];
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),org=new THREE.Vector3();
  function groundAt(x,z,fromY=260){org.set(x,fromY,z);ray.set(org,down);ray.far=400;const hit=ray.intersectObjects(supports,true)[0];return hit?hit.point.y:-30;}
  const api={
    root,points,spawn:{x:0,y:8,z:145},size:220,qualityVersion:'patmos-hidden-harbor-v6',
    groundAt,field:{points,height:()=>-30,support:groundAt},
    stats:{focusMeters:220,leftCityMasses:3,rightNaturalDominant:true,visibleBridges:1,rearCavern:true,oldGate:true,lights:lights.length},
    dispose(){for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());}
  };
  ctx.terrain=api;return api;
}
