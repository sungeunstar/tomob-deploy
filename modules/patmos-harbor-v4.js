/** PATMOS Hidden Harbor v4
 * Focused 360m authored slice. This is intentionally NOT the full 1.4km landmark.
 * Goal: prove the visual language before scaling:
 *   custom cliff mesh + carved shelves + real medieval building assets + short bridges + cave market.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const rngFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const rng=rngFor(300930);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

const KAY='/tomob-deploy/KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/gltf/';
const ASSET={
  homeA:KAY+'buildings/red/building_home_A_red.gltf',
  homeB:KAY+'buildings/red/building_home_B_red.gltf',
  tavern:KAY+'buildings/red/building_tavern_red.gltf',
  market:KAY+'buildings/red/building_market_red.gltf',
  towerA:KAY+'buildings/red/building_tower_A_red.gltf',
  towerB:KAY+'buildings/red/building_tower_B_red.gltf',
  scaffold:KAY+'buildings/neutral/building_scaffolding.gltf',
  destroyed:KAY+'buildings/neutral/building_destroyed.gltf',
  bridgeA:KAY+'buildings/neutral/building_bridge_A.gltf',
};

function makeLoftGeometry(rings,{closeTop=true,closeBottom=true}={}){
  // rings = [{y, pts:[[x,z], ...]}], all same point count, same winding.
  const P=rings[0].pts.length,verts=[],idx=[];
  for(const r of rings)for(const [x,z] of r.pts)verts.push(x,r.y,z);
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<P;i++){
    const a=j*P+i,b=j*P+(i+1)%P,c=(j+1)*P+i,d=(j+1)*P+(i+1)%P;
    idx.push(a,c,b,b,c,d);
  }
  if(closeTop){
    const ci=verts.length/3,cx=rings.at(-1).pts.reduce((s,p)=>s+p[0],0)/P,cz=rings.at(-1).pts.reduce((s,p)=>s+p[1],0)/P;
    verts.push(cx,rings.at(-1).y,cz);
    const base=(rings.length-1)*P;
    for(let i=0;i<P;i++)idx.push(ci,base+i,base+(i+1)%P);
  }
  if(closeBottom){
    const ci=verts.length/3,cx=rings[0].pts.reduce((s,p)=>s+p[0],0)/P,cz=rings[0].pts.reduce((s,p)=>s+p[1],0)/P;
    verts.push(cx,rings[0].y,cz);
    for(let i=0;i<P;i++)idx.push(ci,(i+1)%P,i);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();return g;
}

function makeWedgeGeometry(front,back,y0,y1){
  // front/back are irregular quads in XZ for a thick ledge embedded into rock.
  return makeLoftGeometry([{y:y0,pts:front},{y:y1,pts:back}],{closeTop:true,closeBottom:true});
}

function makeArchTunnel(length=42,width=24,height=19,segments=10,ringPts=12){
  // Local tunnel axis +X. Mesh is an arched interior shell; visible from both sides.
  const verts=[],idx=[];
  for(let s=0;s<=segments;s++){
    const x=s/segments*length;
    for(let i=0;i<ringPts;i++){
      const t=i/(ringPts-1);
      const ang=Math.PI*t; // left floor -> crown -> right floor
      const y=Math.sin(ang)*height;
      const z=Math.cos(ang)*width*.5;
      // slight natural irregularity, deterministic
      const wob=(Math.sin(i*2.4+s*.71)*.55+Math.sin(i*.9-s*.43)*.3);
      verts.push(x,y+wob,z);
    }
  }
  for(let s=0;s<segments;s++)for(let i=0;i<ringPts-1;i++){
    const a=s*ringPts+i,b=a+1,c=(s+1)*ringPts+i,d=c+1;
    idx.push(a,b,c,b,d,c);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();return g;
}

export async function initPatmosHarborV4(ctx){
  const {scene,world,RAPIER:R}=ctx;
  const root=new THREE.Group();root.name='PATMOS / hidden harbor handcrafted v4';scene.add(root);
  const G=new Set(),M=new Set(),colliders=[],supports=[],loadedAssets=[],lights=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.96,flatShading:true,...o});M.add(m);return m;};
  const cliff=mat('#66716a',{side:THREE.DoubleSide}),cliffDark=mat('#46534f',{side:THREE.DoubleSide}),cliffWet=mat('#3f5652',{side:THREE.DoubleSide}),cliffLight=mat('#808b81',{side:THREE.DoubleSide});
  const stone=mat('#858a7d'),stoneDark=mat('#61685f'),wood=mat('#705039'),woodDark=mat('#493529'),iron=mat('#4a5251',{metalness:.22,roughness:.75});
  const cloth=mat('#743a35',{side:THREE.DoubleSide}),moss=mat('#536c47'),sand=mat('#9b8a65');
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
  function add(g,m,x=0,y=0,z=0,s=[1,1,1],ry=0,rx=0,rz=0,isSolid=false,name=''){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);if(isSolid)solid(o,true);return o;
  }
  const box=(x,y,z,s,m=wood,ry=0,isSolid=false,name='')=>add(boxG,m,x,y,z,s,ry,0,0,isSolid,name);
  function beam(a,b,r=.10,m=woodDark,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.9,r,len,6);G.add(g);
    const o=add(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,false,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;
  }

  // --- 1) HAND-AUTHORED CLIFF MASSES ------------------------------------------------
  // All silhouettes are explicitly drawn. Upper rings offset from lower rings to create
  // real undercuts and overhangs that a heightfield cannot represent.
  const westRings=[
    {y:-18,pts:[[-205,150],[-170,205],[-108,215],[-88,180],[-82,120],[-94,62],[-122,5],[-160,-25],[-208,-4],[-235,55]]},
    {y:28, pts:[[-210,142],[-178,198],[-120,204],[-96,173],[-93,121],[-104,70],[-132,18],[-164,-10],[-202,4],[-228,58]]},
    {y:67, pts:[[-200,130],[-173,184],[-129,192],[-103,164],[-106,122],[-118,83],[-146,38],[-171,16],[-194,29],[-215,70]]},
    {y:104,pts:[[-184,118],[-162,167],[-132,174],[-113,150],[-120,121],[-135,94],[-160,58],[-176,48],[-190,60],[-200,84]]},
    {y:132,pts:[[-162,111],[-150,151],[-132,156],[-119,141],[-132,119],[-146,103],[-160,80],[-172,76],[-177,89],[-179,100]]},
  ];
  const eastRings=[
    {y:-18,pts:[[205,150],[171,204],[110,214],[89,181],[83,121],[96,60],[126,4],[162,-25],[209,-2],[236,55]]},
    {y:25, pts:[[211,142],[180,197],[122,204],[99,173],[94,122],[106,69],[135,18],[167,-8],[204,7],[229,59]]},
    {y:61, pts:[[202,130],[175,185],[130,192],[106,163],[108,121],[122,82],[149,39],[173,17],[196,30],[216,70]]},
    {y:96, pts:[[186,117],[165,168],[134,174],[116,149],[122,120],[138,94],[162,58],[180,48],[193,62],[201,84]]},
    {y:122,pts:[[165,110],[153,152],[134,156],[121,141],[134,119],[148,102],[163,80],[174,76],[179,89],[181,100]]},
  ];
  const rearRings=[
    {y:-12,pts:[[-150,30],[-118,-18],[-60,-48],[0,-58],[63,-47],[120,-17],[151,30],[131,67],[75,83],[0,88],[-74,82],[-131,66]]},
    {y:42, pts:[[-144,24],[-112,-22],[-58,-50],[0,-66],[61,-50],[113,-21],[145,26],[126,62],[73,78],[0,83],[-72,77],[-126,61]]},
    {y:91, pts:[[-132,17],[-102,-24],[-54,-50],[0,-72],[56,-51],[104,-23],[134,18],[118,54],[69,70],[0,74],[-68,69],[-118,53]]},
    {y:137,pts:[[-113,11],[-87,-23],[-48,-48],[0,-70],[49,-48],[88,-22],[114,12],[103,46],[62,61],[0,66],[-61,60],[-103,45]]},
    {y:164,pts:[[-88,8],[-69,-19],[-38,-39],[0,-55],[39,-39],[70,-18],[89,9],[82,36],[50,49],[0,54],[-49,48],[-82,35]]},
  ];
  // V4: the old single rear mass blocked the entire composition and made the harbor
  // read like a boxed canyon. Keep the flanking cliffs, then build the rear as architecture + smaller shoulders.
  function densifyRings(rings,amp=3.6){
    return rings.map((r,ri)=>{
      const pts=[];
      for(let i=0;i<r.pts.length;i++){
        const a=r.pts[i],b=r.pts[(i+1)%r.pts.length];
        pts.push(a);
        const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1,nx=-dz/L,nz=dx/L;
        const wob=Math.sin((i+1)*2.17+ri*.93)*amp*(.55+ri*.08);
        pts.push([(a[0]+b[0])*.5+nx*wob,(a[1]+b[1])*.5+nz*wob]);
      }
      return {y:r.y,pts};
    });
  }
  const cliffMeshes=[];
  for(const [rings,m,name] of [[densifyRings(westRings),cliff,'West cliff'],[densifyRings(eastRings),cliff,'East cliff']]){
    const g=makeLoftGeometry(rings);G.add(g);const o=add(g,m,0,0,0,[1,1,1],0,0,0,false,name);solid(o,false);cliffMeshes.push(o);
  }

  // Giant shoreline buttresses hide polygon transitions and reinforce natural mass.
  const buttress=[
    [-103,10,181,24,42,26],[-89,30,134,22,34,20],[-111,58,91,26,41,22],[-138,82,38,25,42,20],
    [103,10,181,24,42,26],[91,28,134,22,34,20],[113,56,89,26,41,22],[140,80,38,25,42,20],
    [-78,112,-8,22,35,20],[77,110,-9,22,35,20],[-36,142,-40,25,29,24],[38,141,-40,25,29,24]
  ];
  for(const [x,y,z,sx,sy,sz] of buttress)add(rockG,rng()<.33?cliffDark:cliff,x,y,z,[sx,sy,sz],rng()*Math.PI,0,(rng()-.5)*.14,false,'Cliff buttress');

  // Wet dark rock ring at the waterline = contact with ocean.
  for(const side of[-1,1])for(let i=0;i<8;i++){
    const z=175-i*23,x=side*(96+Math.sin(i*.8)*18);
    add(rockG,cliffWet,x,1.0,z,[13+rng()*5,6+rng()*5,12+rng()*5],rng()*Math.PI,0,(rng()-.5)*.16,false,'Wet shoreline rock');
  }

  // --- 2) CARVED NATURAL SHELVES -----------------------------------------------------
  // Irregular wedge meshes penetrate 12-20m into rock. These are not floating platforms.
  const shelves=[
    {id:'W1',front:[[-106,152],[-82,145],[-75,116],[-105,109]],back:[[-136,149],[-112,142],[-105,114],[-134,107]],y0:17,y1:20},
    {id:'W2',front:[[-126,91],[-92,85],[-91,53],[-126,49]],back:[[-156,88],[-120,82],[-119,54],[-154,50]],y0:43,y1:47},
    {id:'W3',front:[[-145,29],[-111,26],[-115,-8],[-146,-5]],back:[[-174,26],[-139,23],[-142,-7],[-171,-4]],y0:71,y1:76},
    {id:'E1',front:[[106,147],[80,140],[77,111],[108,107]],back:[[136,145],[110,137],[108,111],[136,106]],y0:20,y1:23},
    {id:'E2',front:[[128,86],[94,81],[93,49],[128,47]],back:[[158,84],[122,78],[122,51],[157,48]],y0:49,y1:53},
    {id:'E3',front:[[145,25],[111,22],[114,-10],[146,-6]],back:[[174,23],[140,20],[142,-8],[172,-5]],y0:77,y1:82},
    {id:'R1',front:[[-69,-28],[-30,-43],[1,-46],[2,-15]],back:[[-86,-31],[-43,-53],[3,-56],[4,-16]],y0:99,y1:103},
    {id:'R2',front:[[8,-47],[52,-39],[80,-21],[60,2]],back:[[8,-57],[58,-50],[94,-27],[70,7]],y0:112,y1:116},
  ];
  const shelfMap={};
  for(const s of shelves){
    const g=makeWedgeGeometry(s.front,s.back,s.y0,s.y1);G.add(g);const o=add(g,stoneDark,0,0,0,[1,1,1],0,0,0,true,'Embedded stone shelf '+s.id);shelfMap[s.id]=s;
    // chipped cap layer
    const cx=s.front.reduce((a,p)=>a+p[0],0)/4,cz=s.front.reduce((a,p)=>a+p[1],0)/4;
    add(rockG,stone,cx,s.y1-.7,cz,[15,1.4,10],rng()*Math.PI,0,0,false,'Shelf chipped stone');
  }

  // --- 3) REAL MEDIEVAL ASSETS -------------------------------------------------------
  const loader=new GLTFLoader();
  const proto={};
  async function loadProto(k){
    const g=await loader.loadAsync(ASSET[k]);
    g.scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(g.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    // Keep normalization on a CHILD scene so placement can move the wrapper without
    // destroying the bottom-alignment offset.
    g.scene.position.set(-center.x,-box.min.y,-center.z);
    g.scene.traverse(o=>{if(o.isMesh){o.castShadow=o.receiveShadow=true;o.material=o.material.clone();loadedAssets.push(o.material);}});
    const wrap=new THREE.Group();wrap.add(g.scene);
    proto[k]={scene:wrap,size};return proto[k];
  }
  await Promise.all(Object.keys(ASSET).map(loadProto));

  function placeAsset(k,x,y,z,targetH=12,ry=0,name=''){
    const p=proto[k],o=p.scene.clone(true),scale=targetH/(p.size.y||1);
    o.position.set(x,y,z);o.scale.setScalar(scale);o.rotation.y=ry;o.name=name||('Patmos '+k);
    o.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true;}});root.add(o);return o;
  }

  // Building clusters are authored as neighborhoods. Back row embeds into cliff by 15-30%.
  const buildings=[];
  function B(k,x,y,z,h,ry=0){const o=placeAsset(k,x,y,z,h*1.38,ry,'Patmos building '+k);buildings.push(o);return o;}
  // West lower: 6 buildings, not isolated.
  B('tavern',-111,20,136,17,.16);B('homeA',-91,20,126,13,-.06);B('homeB',-116,20,117,14,.11);
  B('scaffold',-133,20,136,15,.04);B('homeA',-126,20,126,12,-.11);B('market',-94,20,145,13,.08);
  // West middle.
  B('homeB',-132,47,76,16,.08);B('homeA',-108,47,70,13,-.06);B('tavern',-137,47,57,16,.10);
  B('scaffold',-151,47,71,14,-.04);B('homeA',-113,47,56,12,.06);
  // West high / cave neighborhood.
  B('market',-151,76,11,18,.08);B('homeB',-127,76,7,15,-.05);B('homeA',-152,76,-5,13,.10);
  B('destroyed',-169,76,8,12,.02);
  // East lower.
  B('homeB',111,23,131,15,-.13);B('homeA',91,23,121,13,.05);B('tavern',119,23,113,16,-.08);
  B('scaffold',136,23,132,15,-.02);B('market',94,23,142,13,-.08);
  // East middle.
  B('homeA',130,53,73,13,-.06);B('homeB',106,53,66,16,.08);B('tavern',139,53,55,16,-.1);
  B('scaffold',153,53,70,14,.03);B('homeA',112,53,52,12,-.04);
  // East high.
  B('towerA',148,82,9,25,-.06);B('homeB',125,82,8,15,.04);B('homeA',151,82,-6,13,-.06);B('destroyed',169,82,10,12,0);

  // V4 vertical density: larger mid/high silhouettes visible from the pier.
  B('towerB',-122,52,42,21,.06);B('homeB',-145,52,30,17,-.08);B('tavern',-111,52,27,18,.09);
  B('towerA',122,58,40,22,-.06);B('homeB',145,58,28,17,.08);B('tavern',111,58,25,18,-.08);
  B('homeA',-132,82,-18,15,.05);B('market',-108,82,-13,17,-.07);
  B('homeA',132,88,-20,15,-.05);B('market',108,88,-14,17,.07);
  // Rear elevated quarter.
  B('towerB',-54,103,-36,28,.08);B('homeB',-28,103,-39,15,-.03);B('homeA',-7,103,-37,13,.04);
  B('market',35,116,-36,17,-.05);B('homeA',58,116,-29,13,.05);B('towerA',75,116,-16,25,-.08);

  // V4 rear reveal: smaller rock shoulders frame a visible upper city instead of a giant central boulder.
  const rearShoulders=[
    [-92,56,-43,25,64,30],[-118,82,-65,28,58,32],[-146,105,-89,24,48,28],
    [92,54,-43,25,62,30],[119,80,-66,28,56,32],[146,103,-90,24,46,28]
  ];
  for(const [x,y,z,sx,sy,sz] of rearShoulders)
    add(rockG,rng()<.4?cliffDark:cliff,x,y,z,[sx,sy,sz],rng()*Math.PI,0,(rng()-.5)*.16,false,'Rear framing rock');

  // Old stone retaining court that reads from the spawn as a second depth plane.
  box(0,91,-58,[126,8,40],stoneDark,0,true,'Upper city retaining court');
  box(0,95.3,-58,[118,.7,36],stone,0,true,'Upper city court cap');
  // Large central gate: not final citadel, only the visible target beyond the harbor.
  for(const x of[-31,31]){
    box(x,112,-83,[14,38,15],stone,0,false,'Old gate pier');
    box(x,134,-83,[19,5,20],stoneDark,0,false,'Old gate capital');
  }
  box(0,137,-83,[78,9,18],stoneDark,0,false,'Old gate crown');
  // a broken central arch silhouette
  for(const x of[-17,17]) box(x,119,-81,[9,28,12],stone,0,false,'Inner gate pier');

  // Densify the far neighborhood so the harbor view reads as a CITY, not two isolated houses.
  B('tavern',-42,96,-55,19,.07);B('homeB',-16,96,-55,17,-.04);B('homeA',14,96,-54,16,.05);
  B('market',43,96,-53,19,-.06);B('scaffold',-68,95,-48,17,.04);B('scaffold',69,95,-47,17,-.04);
  B('towerA',-78,96,-70,24,.03);B('towerB',78,96,-70,26,-.03);

  // --- 4) SHORT, HIDDEN CONNECTORS --------------------------------------------------
  // Path system is mostly stone stair-runs hugging the cliff. Bridges only cross real gaps.
  function ramp(a,b,w=7,m=stoneDark,name='Stone stair'){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    add(boxG,m,mid.x,mid.y-.8,mid.z,[w,1.5,len],yaw,pitch,0,true,name);
    for(let i=1;i<6;i++){const p=A.clone().lerp(B,i/6);box(p.x,p.y+.08,p.z,[w*.55,.35,1.3],stone,yaw,false,'Stair tread');}
  }
  ramp([-80,7,176],[-91,20,150],8);ramp([-116,23,108],[-121,47,88],7);
  ramp([-135,50,46],[-137,76,28],7);ramp([80,7,172],[91,23,148],8);
  ramp([116,26,107],[121,53,87],7);ramp([136,56,44],[137,82,28],7);

  function shortBridge(a,b,w=5.5){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),mid=A.clone().add(B).multiplyScalar(.5);
    const horiz=Math.hypot(d.x,d.z),len=d.length(),yaw=Math.atan2(d.x,d.z),pitch=-Math.atan2(d.y,horiz);
    add(boxG,woodDark,mid.x,mid.y-.35,mid.z,[w,.7,len],yaw,pitch,0,true,'Short rope bridge');
    const nx=-d.z/(horiz||1),nz=d.x/(horiz||1);
    for(const side of[-1,1])beam([A.x+nx*side*w*.6,A.y+1.2,A.z+nz*side*w*.6],[B.x+nx*side*w*.6,B.y+1.2,B.z+nz*side*w*.6],.055,iron,'Bridge rope');
  }
  shortBridge([-78,22,125],[77,25,120],6.5);
  shortBridge([-91,50,62],[91,56,60],6.0);

  // --- 5) CAVE MARKET: real interior shell, not a black rectangle -------------------
  const caveG=makeArchTunnel(46,28,21,11,14);G.add(caveG);
  const cave=add(caveG,cliffDark,-145,76,7,[1,1,1],Math.PI,0,0,false,'Cave market tunnel');
  cave.material.side=THREE.DoubleSide;
  // cave floor penetrates west cliff
  box(-173,75.2,7,[45,1.2,21],stoneDark,0,true,'Cave floor');
  B('market',-181,76,7,14,Math.PI/2);B('scaffold',-199,76,-2,12,.2);B('homeA',-201,76,12,11,-.2);
  for(const [x,z] of[[-165,-5],[-178,15],[-193,2],[-204,16]]){
    const l=new THREE.PointLight('#ff9b55',3.7,30,1.7);l.position.set(x,82,z);root.add(l);lights.push(l);
  }

  // --- 6) HARBOR FOREGROUND ---------------------------------------------------------
  // Broad central water is kept clear. Docks are asymmetrical and physically attached to shoreline.
  box(-62,6.0,171,[38,1.6,7],woodDark,-.10,true,'West quay');
  box(62,6.0,164,[36,1.6,7],wood,.08,true,'East quay');
  box(0,6.2,214,[5.5,1.8,36],woodDark,0,true,'Arrival pier');
  for(const [x,z] of[[-78,177],[-54,169],[-31,164],[31,160],[55,166],[79,170],[-3,233],[3,211],[0,190]])beam([x,0,z],[x,7,z],.22,woodDark,'Harbor piling');
  // Old drowned masonry under the quays.
  box(-68,2.2,178,[45,4.4,11],stoneDark,-.10,false,'Drowned quay wall');
  box(68,2.2,171,[44,4.4,11],stoneDark,.08,false,'Drowned quay wall');

  // Harbor warehouse mass made from real models.
  B('tavern',-74,8,151,16,.12);B('market',67,8,146,15,-.08);
  B('scaffold',-98,7,163,14,.04);B('scaffold',96,7,154,13,-.05);

  // Props made geometrically only where shape is structural: crane / ropes / awnings.
  function crane(x,y,z,side=1){
    beam([x,y,z],[x,y+17,z],.3,woodDark,'Crane mast');beam([x,y+15,z],[x+side*13,y+15,z-3],.24,woodDark,'Crane arm');
    beam([x+side*10,y+15,z-2],[x+side*10,y+4,z-2],.055,iron,'Crane rope');
  }
  crane(-86,8,165,-1);crane(88,8,157,1);
  for(const [x,y,z,w,d] of[[-63,18,151,18,10],[61,18,147,17,10],[-116,34,124,17,9],[112,37,118,16,9]]){
    const g=new THREE.PlaneGeometry(w,d,3,2);g.rotateX(-Math.PI/2);G.add(g);add(g,cloth,x,y,z,[1,1,1],0,0,(rng()-.5)*.12,false,'Patmos awning');
  }

  // --- 7) CONTACT DETAILS ------------------------------------------------------------
  // Rock clutter is only used to merge authored shelves into cliff.
  for(const s of shelves){
    const c=s.back.reduce((a,p)=>[a[0]+p[0]/4,a[1]+p[1]/4],[0,0]);
    for(let i=0;i<5;i++){
      const x=c[0]+(rng()-.5)*28,z=c[1]+(rng()-.5)*22;
      add(rockG,rng()<.35?cliffDark:cliff,x,s.y0-2+rng()*3,z,[4+rng()*5,3+rng()*5,4+rng()*5],rng()*Math.PI,0,(rng()-.5)*.16,false,'Shelf seam rock');
    }
  }
  // Moss tongues in cracks, not uniform grass carpet.
  for(let i=0;i<28;i++){
    const side=i%2?-1:1,x=side*(84+rng()*62),z=10+rng()*150,y=lerp(18,88,rng());
    add(rockG,rng()<.5?moss:cliff,x,y,z,[2+rng()*3,.16,1.5+rng()*2.8],rng()*Math.PI,0,0,false,'Cliff moss tongue').castShadow=false;
  }
  // Warm lights define neighborhoods after sunset.
  const lit=[[-105,27,132],[-130,54,70],[-146,83,6],[105,30,128],[130,60,68],[146,89,5],[-30,110,-34],[45,123,-30],[-73,15,150],[66,15,146]];
  for(const p of lit){const l=new THREE.PointLight('#ff9d5c',2.8,27,1.65);l.position.set(...p);root.add(l);lights.push(l);}

  // --- 8) QA / PLAYER ---------------------------------------------------------------
  const points=[
    {id:'harbor',name:'숨은 밧모 항구',x:0,y:9,z:218,target:[0,55,45]},
    {id:'westLower',name:'서쪽 하층 골목',x:-99,y:22,z:132,target:[-125,47,70]},
    {id:'bridge',name:'항구 중앙 다리',x:0,y:24,z:122,target:[-126,49,67]},
    {id:'cave',name:'암시장 동굴',x:-160,y:78,z:8,target:[-186,82,8]},
    {id:'upper',name:'상층 감시지구',x:126,y:86,z:8,target:[25,120,-38]},
  ];
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),org=new THREE.Vector3();
  function groundAt(x,z,fromY=260){
    org.set(x,fromY,z);ray.set(org,down);ray.far=400;
    const hit=ray.intersectObjects(supports,true)[0];
    return hit?hit.point.y:-30;
  }
  const api={
    root,points,spawn:{x:0,y:9,z:224},size:360,qualityVersion:'patmos-hidden-harbor-v4',
    groundAt,field:{points,height:()=>-30,support:groundAt},
    stats:{focusMeters:360,cliffMasses:2,rearArchitecture:true,shelves:shelves.length,realBuildings:buildings.length,bridges:2,caveTunnel:true,lights:lights.length},
    dispose(){for(const c of colliders)try{world.removeCollider(c,true);}catch{}root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());for(const m of loadedAssets)try{m.dispose();}catch{}}
  };
  ctx.terrain=api;
  return api;
}
