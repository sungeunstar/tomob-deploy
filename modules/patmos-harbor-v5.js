/** PATMOS Hidden Harbor v5
 * Quality-first 180m authored scene.
 * No procedural island. No prefab houses as the visual backbone.
 * The city is built from integrated cliff-city modules:
 * rock mass -> carved stone room -> timber upper floor -> balcony/awning -> stairs.
 */
import * as THREE from 'three';

const rngFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const rng=rngFor(300931);

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
function prismRoofGeometry(w,d,h){
  // local front/back = +/-Z, ridge along X
  const v=[-w/2,0,-d/2, w/2,0,-d/2, -w/2,0,d/2, w/2,0,d/2, -w/2,h,0, w/2,h,0];
  const i=[0,1,4,1,5,4, 2,4,3,3,4,5, 0,4,2, 1,3,5, 0,2,3,0,3,1];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(i);g.computeVertexNormals();return g;
}
function archGeometry(w,h,thick=1.3,depth=1.3){
  const r=w/2,spring=h-r,iw=w-thick*2,ir=iw/2,ispring=spring+thick*.35;
  const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(-w/2,spring);shape.absarc(0,spring,r,Math.PI,0,false);shape.lineTo(w/2,0);shape.lineTo(-w/2,0);
  const hole=new THREE.Path();hole.moveTo(-iw/2,0);hole.lineTo(-iw/2,ispring);hole.absarc(0,ispring,ir,Math.PI,0,false);hole.lineTo(iw/2,0);hole.lineTo(-iw/2,0);shape.holes.push(hole);
  const g=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,steps:1});g.computeVertexNormals();return g;
}
function ledgeGeometry(points,yTop,thick){
  return loftGeometry([{y:yTop-thick,pts:points.map(([x,z])=>[x*.98,z*.98])},{y:yTop,pts:points}]);
}
function rockChunkGeometry(w,d,h,leanX=0,leanZ=0,seed=1){
  const rr=rngFor(seed),base=[[-.48,-.45],[-.05,-.55],[.46,-.43],[.55,-.04],[.45,.46],[.02,.55],[-.48,.44],[-.56,.02]];
  const rings=[0,.35,.7,1].map((t,ri)=>{
    const scale=1-ri*.07+(ri===2?.035:0),ox=leanX*t,oz=leanZ*t;
    return {y:h*t,pts:base.map(([x,z],i)=>[
      x*w*scale+ox+(rr()-.5)*w*.035,
      z*d*scale+oz+(rr()-.5)*d*.035
    ])};
  });
  return loftGeometry(rings);
}

export async function initPatmosHarborV5(ctx){
  const {scene,world,RAPIER:R}=ctx;
  const root=new THREE.Group();root.name='PATMOS / integrated cliff city v5';scene.add(root);
  const G=new Set(),M=new Set(),colliders=[],supports=[],lights=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,flatShading:true,...o});M.add(m);return m;};
  const rock=mat('#65716b'),rock2=mat('#53615c'),rockWet=mat('#3d5552'),stone=mat('#8a8d7e'),stone2=mat('#646b61');
  const wood=mat('#76543b'),wood2=mat('#946c49'),woodDark=mat('#4b382b'),roof=mat('#514138');
  const cloth=mat('#7e4038',{side:THREE.DoubleSide}),iron=mat('#4c5454',{metalness:.22,roughness:.72});
  const windowM=mat('#ffc47a',{emissive:'#ff9b52',emissiveIntensity:2.8,roughness:.55});
  const caveM=mat('#18201f',{side:THREE.DoubleSide}),moss=mat('#566e49');
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
  const box=(x,y,z,s,m=wood,ry=0,walk=false,name='')=>mesh(boxG,m,x,y,z,s,ry,0,0,walk,name);
  function beam(a,b,r=.08,m=woodDark,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.88,r,len,6);G.add(g);
    const o=mesh(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,false,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;
  }

  // ---------- reusable authored building pieces ----------
  function addWindow(g,x,y,z,w=1.5,h=1.7,front=1){
    const o=box(x,y,z,[w,h,.16],windowM,0,false,'lit window');g.add(o);root.remove(o);o.position.set(x,y,z);return o;
  }
  function makeTimberHouse({w=12,d=8,h=8,floors=1,balcony=true,awning=false}={}){
    const g=new THREE.Group();
    // stone/plaster lower body
    const lower=new THREE.Mesh(boxG,stone2);lower.scale.set(w,4.2,d);lower.position.y=2.1;lower.castShadow=lower.receiveShadow=true;g.add(lower);
    // upper timber bodies
    for(let f=0;f<floors;f++){
      const y=4.2+f*h*.72;
      const body=new THREE.Mesh(boxG,wood);body.scale.set(w*.92,h*.66,d*.92);body.position.y=y+h*.33;body.castShadow=body.receiveShadow=true;g.add(body);
      // front timber frame
      for(const sx of[-1,0,1]){
        const b=new THREE.Mesh(boxG,woodDark);b.scale.set(.24,h*.62,.22);b.position.set(sx*w*.35,y+h*.34,d*.47);g.add(b);
      }
      for(const yy of[-.18,.18]){
        const b=new THREE.Mesh(boxG,woodDark);b.scale.set(w*.88,.22,.22);b.position.set(0,y+h*(.34+yy),d*.47);g.add(b);
      }
      for(const sx of[-.22,.22]){
        const win=new THREE.Mesh(boxG,windowM);win.scale.set(1.35,1.6,.15);win.position.set(sx*w,y+h*.36,d*.485);g.add(win);
      }
    }
    const rg=prismRoofGeometry(w*1.06,d*1.08,4.2);G.add(rg);const r=new THREE.Mesh(rg,roof);r.position.y=4.2+floors*h*.72;r.castShadow=r.receiveShadow=true;g.add(r);
    if(balcony){
      const y=4.2+Math.max(0,floors-1)*h*.72+1.2;
      const deck=new THREE.Mesh(boxG,woodDark);deck.scale.set(w*.92,.45,2.6);deck.position.set(0,y,d*.61);g.add(deck);
      for(const sx of[-.42,-.14,.14,.42]){const b=new THREE.Mesh(boxG,woodDark);b.scale.set(.18,1.55,.18);b.position.set(sx*w,y+1.0,d*.73);g.add(b);}
      const rail=new THREE.Mesh(boxG,woodDark);rail.scale.set(w*.92,.18,.18);rail.position.set(0,y+1.65,d*.73);g.add(rail);
    }
    if(awning){
      const ag=new THREE.PlaneGeometry(w*.72,4,3,1);ag.rotateX(-Math.PI/2);G.add(ag);const a=new THREE.Mesh(ag,cloth);a.position.set(0,6.0,d*.78);a.rotation.z=.06;g.add(a);
    }
    g.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;}});
    return g;
  }
  function makeCarvedRoom({w=13,h=11,d=7}={}){
    // open-front stone room with depth, arch frame, and dark interior.
    const g=new THREE.Group();
    const back=new THREE.Mesh(boxG,caveM);back.scale.set(w*.78,h*.62,.35);back.position.set(0,h*.34,-d*.52);g.add(back);
    const floor=new THREE.Mesh(boxG,stone2);floor.scale.set(w,1,d);floor.position.set(0,.5,-d*.05);g.add(floor);
    const left=new THREE.Mesh(boxG,stone2),right=left.clone(),top=left.clone();
    left.scale.set(1.3,h,d);left.position.set(-w*.44,h*.5,0);right.scale.set(1.3,h,d);right.position.set(w*.44,h*.5,0);
    top.scale.set(w,2,d);top.position.set(0,h-.8,0);g.add(left,right,top);
    const archG=archGeometry(w*.68,h*.78,1.15,1.0);G.add(archG);const arch=new THREE.Mesh(archG,stone);arch.position.set(0,0,d*.51);g.add(arch);
    const lamp=new THREE.PointLight('#ff9b55',2.4,18,1.7);lamp.position.set(0,4,d*.2);g.add(lamp);
    return g;
  }
  function placeGroup(g,x,y,z,ry=0,name=''){g.position.set(x,y,z);g.rotation.y=ry;g.name=name;root.add(g);return g;}

  // ---------- integrated cliff-city module ----------
  function cliffCityModule(cfg){
    const {side,x,z,baseY,rockW,rockD,rockH,seed,levels=2,frontYaw=0}=cfg;
    // rock mass first
    const rg=rockChunkGeometry(rockW,rockD,rockH,side*6,-5,seed);G.add(rg);
    mesh(rg,seed%2?rock:rock2,x,baseY,z,[1,1,1],0,0,0,false,'urban cliff mass');

    // authored natural/stone shelf intersecting the rock by 30-40%.
    for(let lv=0;lv<levels;lv++){
      const y=baseY+14+lv*22;
      const zOff=z-lv*10;
      const innerX=x-side*(rockW*.34);
      const pts=[
        [innerX-side*18,zOff+15],[innerX+side*10,zOff+13],[innerX+side*13,zOff-12],[innerX-side*15,zOff-15]
      ];
      const lg=ledgeGeometry(pts,y,4.2);G.add(lg);mesh(lg,stone2,0,0,0,[1,1,1],0,0,0,true,'embedded urban ledge');

      // room is pushed into rock; only arch and front edge are exposed.
      const room=makeCarvedRoom({w:12+(lv%2)*2,h:10+(lv%2)*2,d:8});
      const roomX=innerX-side*5, roomZ=zOff-2;
      placeGroup(room,roomX,y,roomZ,frontYaw,'carved stone room');

      // timber house grows out of the carved room, slightly offset.
      const house=makeTimberHouse({w:11+(lv%2)*2,d:8,h:8,floors:lv===0?1:2,balcony:true,awning:lv===0});
      placeGroup(house,roomX+side*(lv?1.5:-1),y+8.4,roomZ+3,frontYaw,'timber cliff house');

      // seam rocks hide exact join.
      for(let i=0;i<5;i++){
        const rx=innerX-side*(9+rng()*8),rz=zOff+(rng()-.5)*26;
        mesh(rockG,rng()<.4?rock2:rock,rx,y-1+rng()*3,rz,[3+rng()*4,3+rng()*4,3+rng()*4],rng()*Math.PI,0,(rng()-.5)*.16,false,'cliff seam');
      }
      // small lantern
      const l=new THREE.PointLight('#ff9b55',2.4,24,1.7);l.position.set(roomX+side*3,y+12,roomZ+7);root.add(l);lights.push(l);
    }
  }

  // ---------- composition: six cliff-city modules ----------
  // Harbour-facing yaw: left faces +X, right faces -X, rear faces +Z.
  cliffCityModule({side:-1,x:-64,z:74,baseY:-5,rockW:54,rockD:58,rockH:64,seed:11,levels:2,frontYaw:Math.PI/2});
  cliffCityModule({side:-1,x:-70,z:10,baseY:-7,rockW:60,rockD:62,rockH:88,seed:17,levels:3,frontYaw:Math.PI/2});
  cliffCityModule({side:-1,x:-62,z:-48,baseY:-9,rockW:58,rockD:55,rockH:105,seed:23,levels:2,frontYaw:Math.PI/2});
  cliffCityModule({side:1,x:62,z:68,baseY:-6,rockW:52,rockD:56,rockH:60,seed:31,levels:2,frontYaw:-Math.PI/2});
  cliffCityModule({side:1,x:69,z:5,baseY:-7,rockW:60,rockD:64,rockH:90,seed:37,levels:3,frontYaw:-Math.PI/2});
  cliffCityModule({side:1,x:61,z:-52,baseY:-10,rockW:56,rockD:54,rockH:102,seed:43,levels:2,frontYaw:-Math.PI/2});

  // rear upper-city rock shoulders, leaving a real open gate/void in the middle.
  const rearL=rockChunkGeometry(48,55,118,4,-4,51),rearR=rockChunkGeometry(48,55,113,-5,-3,57);G.add(rearL);G.add(rearR);
  mesh(rearL,rock2,-48,-8,-88,[1,1,1],0,0,0,false,'rear left shoulder');mesh(rearR,rock,49,-8,-90,[1,1,1],0,0,0,false,'rear right shoulder');

  // rear stone court and old gate read as the distant goal.
  const courtPts=[[-42,-63],[42,-63],[47,-93],[-48,-94]];
  const courtG=ledgeGeometry(courtPts,78,6);G.add(courtG);mesh(courtG,stone2,0,0,0,[1,1,1],0,0,0,true,'upper stone court');
  // monumental arch
  const gateG=archGeometry(30,32,3.2,3.2);G.add(gateG);mesh(gateG,stone,0,78,-89,[1,1,1],0,0,0,false,'old harbor gate');
  const gateBack=box(0,92,-93,[22,25,2],caveM,0,false,'gate darkness');gateBack.castShadow=false;
  // buildings around the gate are bespoke, larger than foreground houses.
  placeGroup(makeTimberHouse({w:16,d:10,h:9,floors:2,balcony:true,awning:false}),-28,80,-74,0,'rear upper house');
  placeGroup(makeTimberHouse({w:17,d:10,h:9,floors:2,balcony:true,awning:false}),30,80,-74,0,'rear upper house');
  placeGroup(makeTimberHouse({w:13,d:9,h:8,floors:1,balcony:true,awning:true}),0,80,-68,0,'rear upper market');

  // ---------- walkways hugging the cliff ----------
  function ramp(a,b,w=5,m=stone2,name='stone stairs'){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    mesh(boxG,m,mid.x,mid.y-.55,mid.z,[w,1.1,len],yaw,pitch,0,true,name);
    for(let i=1;i<7;i++){const p=A.clone().lerp(B,i/7);box(p.x,p.y+.04,p.z,[w*.58,.25,1.0],stone,yaw,false,'stair tread');}
  }
  // arrival to lower shelves
  ramp([-12,7,118],[-37,16,93],5.5);ramp([12,7,114],[37,16,89],5.5);
  // side climbs
  ramp([-43,18,80],[-49,38,47],5);ramp([-51,40,35],[-52,60,15],4.6);ramp([-52,61,-2],[-51,80,-25],4.5);
  ramp([43,18,75],[49,38,44],5);ramp([51,40,32],[52,60,12],4.6);ramp([52,61,-5],[51,80,-29],4.5);
  // rear approach
  ramp([-40,82,-45],[-22,78,-65],5);ramp([40,82,-48],[22,78,-65],5);

  function shortBridge(a,b,w=4.6){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    mesh(boxG,woodDark,mid.x,mid.y-.3,mid.z,[w,.6,len],yaw,pitch,0,true,'short bridge');
    const nx=-d.z/(horiz||1),nz=d.x/(horiz||1);
    for(const side of[-1,1])beam([A.x+nx*side*w*.58,A.y+1.2,A.z+nz*side*w*.58],[B.x+nx*side*w*.58,B.y+1.2,B.z+nz*side*w*.58],.05,iron,'bridge rope');
  }
  shortBridge([-39,39,31],[39,41,29],5);
  shortBridge([-38,61,-10],[38,63,-12],4.8);

  // ---------- foreground harbor ----------
  // narrow arrival pier, side quays, and old submerged masonry.
  box(0,6.0,128,[4.8,1.5,28],woodDark,0,true,'arrival pier');
  box(-42,5.5,108,[28,1.3,6],woodDark,-.08,true,'west quay');
  box(42,5.5,104,[27,1.3,6],wood,.07,true,'east quay');
  box(-44,2.0,111,[34,4,10],stone2,-.08,false,'drowned masonry');box(44,2.0,107,[33,4,10],stone2,.07,false,'drowned masonry');
  for(const [x,z] of[[-55,111],[-42,108],[-29,104],[29,101],[42,104],[55,107],[-2,147],[2,126],[0,107]])beam([x,0,z],[x,6.5,z],.19,woodDark,'pier post');
  // cranes
  function crane(x,y,z,side){
    beam([x,y,z],[x,y+14,z],.25,woodDark,'crane mast');beam([x,y+12,z],[x+side*10,y+12,z-2],.2,woodDark,'crane arm');beam([x+side*8,y+12,z-2],[x+side*8,y+4,z-2],.045,iron,'crane rope');
  }
  crane(-55,6,107,-1);crane(55,6,102,1);

  // market awnings on lower neighborhood
  for(const [x,y,z,w,d,rot] of[[-47,25,80,14,5,.08],[47,25,76,14,5,-.07],[-52,46,30,13,5,.05],[52,46,27,13,5,-.05]]){
    const g=new THREE.PlaneGeometry(w,d,3,1);g.rotateX(-Math.PI/2);G.add(g);mesh(g,cloth,x,y,z,[1,1,1],0,0,rot,false,'awning');
  }

  // shoreline contact rocks; large enough to break straight waterline, not random pebble noise.
  for(const side of[-1,1])for(let i=0;i<7;i++){
    const z=115-i*24,x=side*(52+Math.sin(i*.9)*9);
    mesh(rockG,rockWet,x,2,z,[7+rng()*4,4+rng()*4,7+rng()*3],rng()*Math.PI,0,(rng()-.5)*.15,false,'wet harbor rock');
  }
  // sparse moss seams
  for(let i=0;i<24;i++){
    const side=i%2?-1:1,x=side*(45+rng()*25),z=-45+rng()*145,y=15+rng()*70;
    mesh(rockG,moss,x,y,z,[1.5+rng()*2,.12,1.5+rng()*2],rng()*Math.PI,0,0,false,'moss seam').castShadow=false;
  }

  // ---------- QA / player ----------
  const points=[
    {id:'harbor',name:'숨은 밧모 항구',x:0,y:8,z:135,target:[0,58,-25]},
    {id:'left',name:'서쪽 절벽 골목',x:-38,y:18,z:92,target:[-52,55,18]},
    {id:'mid',name:'중층 다리',x:0,y:42,z:30,target:[0,80,-70]},
    {id:'right',name:'동쪽 상층 구역',x:44,y:62,z:-6,target:[20,82,-70]},
    {id:'gate',name:'옛 성문',x:0,y:81,z:-58,target:[0,94,-90]},
  ];
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),org=new THREE.Vector3();
  function groundAt(x,z,fromY=240){org.set(x,fromY,z);ray.set(org,down);ray.far=360;const hit=ray.intersectObjects(supports,true)[0];return hit?hit.point.y:-30;}
  const api={
    root,points,spawn:{x:0,y:8,z:138},size:180,qualityVersion:'patmos-hidden-harbor-v5',
    groundAt,field:{points,height:()=>-30,support:groundAt},
    stats:{focusMeters:180,integratedModules:6,bridges:2,customBuildings:true,oldGate:true,lights:lights.length},
    dispose(){for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());}
  };
  ctx.terrain=api;return api;
}
