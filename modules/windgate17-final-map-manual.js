/** Windgate 17 final map manual pass f1.
 * Finishes mine integration, route reveals, harbor landing and island silhouettes.
 * Visual-only: native terrain, route heights and collision remain unchanged.
 */
import * as THREE from 'three';
import {BUILDINGS,DOCK,SUMMIT,BASINS,fallAxes,axisDistance,basinRadius} from './aurora-refuge-field.js';

const rngFor=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

export function authorFinalMap17(ctx,island){
  const rng=rngFor(290926),field=island.field;
  const root=new THREE.Group();root.name='Windgate 17 / final map hand pass f1';island.root.add(root);
  const G=new Set(),M=new Set();
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.97,flatShading:true,...o});M.add(m);return m;};
  const rock=mat('#697970'),rockDark=mat('#566861'),rockPale=mat('#879288'),soil=mat('#776c57'),soilDark=mat('#625a4c');
  const timber=mat('#6b543d'),timberDark=mat('#514536'),iron=mat('#4a5353',{metalness:.18,roughness:.78});
  const trunkMat=mat('#5b513e'),leafMat=mat('#586f49'),leafDark=mat('#465d43'),sand=mat('#9a896c'),oldStone=mat('#818b80');
  const boxG=new THREE.BoxGeometry(1,1,1),rockG=new THREE.DodecahedronGeometry(1,0),trunkG=new THREE.CylinderGeometry(.42,.58,1,6),leafG=new THREE.IcosahedronGeometry(1,1);
  G.add(boxG);G.add(rockG);G.add(trunkG);G.add(leafG);

  function add(g,m,x,y,z,s=[1,1,1],ry=0,rx=0,rz=0,name=''){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);
    o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);return o;
  }
  function beam(a,b,r=.08,m=timber,name=''){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),len=d.length();
    const g=new THREE.CylinderGeometry(r*.88,r,len,6);G.add(g);
    const o=add(g,m,...A.clone().add(B).multiplyScalar(.5).toArray(),[1,1,1],0,0,0,name);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;
  }
  function stone(x,z,sx,sy,sz,m=rock,yOff=-.15,ry=rng()*Math.PI,name='windgate17/final rock'){
    return add(rockG,m,x,field.height(x,z)+yOff,z,[sx,sy,sz],ry,(rng()-.5)*.08,(rng()-.5)*.10,name);
  }
  function patch(points,m,yOff=.025,name='windgate17/ground patch'){
    const verts=[],ix=[],c=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
    verts.push(c[0],field.height(c[0],c[1])+yOff,c[1]);
    for(const [x,z] of points)verts.push(x,field.height(x,z)+yOff,z);
    for(let i=0;i<points.length;i++)ix.push(0,i+1,(i+1)%points.length+1);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(ix);g.computeVertexNormals();G.add(g);
    const o=add(g,m,0,0,0,[1,1,1],0,0,0,name);o.castShadow=false;return o;
  }
  function tree(x,z,h=5.5,spread=2.0,dark=false){
    const y=field.height(x,z),lean=(rng()-.5)*.10;
    add(trunkG,trunkMat,x,y+h*.42,z,[.52,h*.84,.52],rng()*Math.PI,0,lean,'windgate17/screen tree trunk');
    const lm=dark?leafDark:leafMat;
    add(leafG,lm,x+lean*h*.35,y+h*.78,z,[spread,1.65,spread*.92],rng()*Math.PI,0,(rng()-.5)*.08,'windgate17/screen canopy');
    add(leafG,lm,x-.35+lean*h*.2,y+h*.54,z+.15,[spread*.78,1.15,spread*.75],rng()*Math.PI,0,(rng()-.5)*.10,'windgate17/screen canopy');
  }
  const nearWater=(x,z,pad=0)=>BASINS.some(b=>basinRadius(b,x,z)<1.22+pad)||fallAxes.some(a=>axisDistance(a,x,z).d<a[6]+pad);
  const clearRoute=(x,z,pad=4.8)=>field.nearPath(x,z).d>pad&&!nearWater(x,z,.8)&&Math.hypot(x-SUMMIT.x,z-SUMMIT.z)>19;

  // --- 1) Mine integration: the mine is carved into a scarred rock cut, not placed on turf.
  const mine=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48,y:35,yaw:.55};
  const cave=field.points.find(p=>p.id==='cave')||{x:-97,z:-34};
  const mdx=mine.x-cave.x,mdz=mine.z-cave.z,mL=Math.hypot(mdx,mdz)||1,mfx=mdx/mL,mfz=mdz/mL,msx=-mfz,msz=mfx;
  const mineStats={cutFaces:0,tailings:0,timbers:0,cartParts:0};

  // Broad irregular spoil scar under the yard.
  patch([
    [mine.x+msx*7-mfx*8,mine.z+msz*7-mfz*8],[mine.x+msx*3-mfx*12,mine.z+msz*3-mfz*12],
    [mine.x-msx*4-mfx*12,mine.z-msz*4-mfz*12],[mine.x-msx*8-mfx*7,mine.z-msz*8-mfz*7],
    [mine.x-msx*7-mfx*2,mine.z-msz*7-mfz*2],[mine.x+msx*7-mfx*1,mine.z+msz*7-mfz*1]
  ],soilDark,.018,'windgate17/mine excavated yard');

  // Layered cut faces sit behind both shoulders and make the building read as embedded.
  for(const side of[-1,1]){
    for(let row=0;row<3;row++){
      for(let i=0;i<4;i++){
        const back=1.0+row*2.0+i*.55,lateral=5.8+row*1.25+(i%2)*1.1;
        const x=mine.x+msx*side*lateral+mfx*back,z=mine.z+msz*side*lateral+mfz*back;
        const s=1.45+row*.42+(i%2)*.24;
        stone(x,z,s*1.28,s*(1.05+row*.22),s*.86,row===2?rockDark:rock,-.45,Math.atan2(mfx,mfz)+(rng()-.5)*.30,'windgate17/mine cut face');
        mineStats.cutFaces++;
      }
    }
  }
  // Tailings run downhill away from the entrance rather than forming random piles.
  for(const side of[-1,1]){
    for(let i=0;i<9;i++){
      const t=i/8,lat=side*(6.5+4.2*t+(rng()-.5)*1.0),back=-4.5-6.5*t;
      const x=mine.x+msx*lat+mfx*back,z=mine.z+msz*lat+mfz*back,s=.28+rng()*.56;
      if(field.nearPath(x,z).d<4.6)continue;
      stone(x,z,s*1.5,s*.46,s*(.8+rng()*.4),rng()<.22?rockPale:rockDark,-.10,rng()*Math.PI,'windgate17/mine tailings');
      mineStats.tailings++;
    }
  }
  // Rough timber bracing around the rock cut. The main opening remains unobstructed.
  const entryX=mine.x-mfx*5.0,entryZ=mine.z-mfz*5.0,entryY=field.height(entryX,entryZ);
  for(const side of[-1,1]){
    const x=entryX+msx*side*2.7,z=entryZ+msz*side*2.7;
    beam([x,entryY-.05,z],[x,entryY+4.0,z],.13,side<0?timberDark:timber,'windgate17/mine support');
    mineStats.timbers++;
  }
  beam([entryX+msx*2.7,entryY+3.72,entryZ+msz*2.7],[entryX-msx*2.7,entryY+3.62,entryZ-msz*2.7],.15,timberDark,'windgate17/mine support lintel');mineStats.timbers++;
  beam([mine.x+msx*7.4-mfx*7,mine.y+.15,mine.z+msz*7.4-mfz*7],[mine.x+msx*4.7-mfx*9.4,mine.y+.45,mine.z+msz*4.7-mfz*9.4],.12,timber,'windgate17/fallen mine timber');mineStats.timbers++;

  // One broken handcart silhouette at the yard edge.
  const cartX=mine.x-msx*6.7-mfx*6.8,cartZ=mine.z-msz*6.7-mfz*6.8,cartY=field.height(cartX,cartZ),cartYaw=Math.atan2(mfx,mfz)+.34;
  add(boxG,timberDark,cartX,cartY+.48,cartZ,[1.25,.58,.78],cartYaw,0,.10,'windgate17/broken ore cart');mineStats.cartParts++;
  const wheelG=new THREE.TorusGeometry(.42,.07,5,10);G.add(wheelG);
  for(const side of[-.72,.72]){
    const x=cartX+Math.cos(cartYaw)*side,z=cartZ-Math.sin(cartYaw)*side;
    add(wheelG,iron,x,cartY+.40,z,[1,1,1],cartYaw,Math.PI/2,.08,'windgate17/cart wheel');mineStats.cartParts++;
  }

  // --- 2) Route reveal gates: hide the next room, then reopen it after the turn.
  const criticalViews=[[-64,108,3,-84],[45,-42,3,-84],[-62,34,-79,-23]];
  const revealGates=[
    {x:-46,z:80,dx:.78,dz:-.62,w:7.2,trees:3,rocks:2,name:'harbor-to-forest'},
    {x:-22,z:57,dx:-.45,dz:-.89,w:6.7,trees:4,rocks:2,name:'forest-turn'},
    {x:-48,z:35,dx:-.92,dz:-.18,w:6.8,trees:3,rocks:3,name:'waterfall-reveal'},
    {x:4,z:-1,dx:.98,dz:-.10,w:7.0,trees:2,rocks:3,name:'ruin-threshold'},
    {x:31,z:-27,dx:.55,dz:-.84,w:6.8,trees:2,rocks:3,name:'grove-turn'},
    {x:-17,z:-72,dx:-.25,dz:-.97,w:6.3,trees:2,rocks:3,name:'final-ascent'}
  ];
  let revealTrees=0,revealRocks=0;
  for(const g of revealGates){
    const L=Math.hypot(g.dx,g.dz)||1,dx=g.dx/L,dz=g.dz/L,nx=-dz,nz=dx;
    for(const side of[-1,1]){
      const bx=g.x+nx*side*g.w,bz=g.z+nz*side*g.w;
      for(let i=0;i<g.rocks;i++){
        const x=bx+dx*((i-(g.rocks-1)/2)*1.65)+(rng()-.5)*.65,z=bz+dz*((i-(g.rocks-1)/2)*1.65)+(rng()-.5)*.65;
        if(!clearRoute(x,z,4.7)||criticalViews.some(v=>axisDistance(v,x,z).d<5.4))continue;
        const s=1.0+rng()*1.1;stone(x,z,s*1.3,s*(.7+rng()*.45),s, rng()<.30?rockDark:rock,-.32,rng()*Math.PI,'windgate17/reveal shoulder');revealRocks++;
      }
      for(let i=0;i<g.trees;i++){
        const x=bx+nx*side*(1.6+i*.75)+dx*((i-(g.trees-1)/2)*1.5)+(rng()-.5)*.8;
        const z=bz+nz*side*(1.6+i*.75)+dz*((i-(g.trees-1)/2)*1.5)+(rng()-.5)*.8;
        if(!clearRoute(x,z,5.5)||criticalViews.some(v=>axisDistance(v,x,z).d<6.3))continue;
        tree(x,z,4.8+rng()*2.4,1.45+rng()*.65,rng()<.34);revealTrees++;
      }
    }
  }

  // Path edges receive occasional inherited paving fragments, never a continuous border.
  const pavingSites=[
    [-50,82,.22],[-30,76,-.16],[-22,51,.18],[-43,38,-.20],[-39,22,.16],
    [-8,1,-.18],[19,-7,.14],[39,-31,-.20],[-10,-54,.18],[-24,-79,-.12]
  ];
  let routeFragments=0;
  for(const [x,z,ry] of pavingSites){
    if(field.slope(x,z)>.85)continue;
    const y=field.height(x,z);
    for(let i=0;i<3;i++){
      const side=i%2?1:-1,ox=Math.cos(ry)*side*(3.0+i*.30),oz=-Math.sin(ry)*side*(3.0+i*.30);
      add(boxG,i===0?oldStone:rockPale,x+ox,y+.10,z+oz,[.64+.12*i,.11,.52+.08*(i%2)],ry+(rng()-.5)*.12,0,(rng()-.5)*.05,'windgate17/old route fragment');
      routeFragments++;
    }
  }

  // --- 3) Harbor/landing: a repaired refuge port with a damaged inherited edge.
  const harborStats={dockPosts:0,driftwood:0,seawall:0,cargo:0};
  const postZ=[113,118,123,128,133];
  for(const z of postZ){
    for(const side of[-1,1]){
      const x=DOCK.x+side*6.1,y=field.height(DOCK.x,Math.min(z,DOCK.shoreZ));
      const h=2.0+(z%3)*.18;
      beam([x,y-.55,z],[x+(rng()-.5)*.12,y+h,z+(rng()-.5)*.14],.13,z>126?timberDark:timber,'windgate17/harbor weathered post');
      harborStats.dockPosts++;
    }
  }
  // One sagging rope between surviving posts.
  const ropePts=[];
  for(let i=0;i<=18;i++){const t=i/18,x=DOCK.x-6.0,z=114+t*13,y=7.15-.75*Math.sin(Math.PI*t);ropePts.push(new THREE.Vector3(x,y,z));}
  const ropeCurve=new THREE.CatmullRomCurve3(ropePts),ropeG=new THREE.TubeGeometry(ropeCurve,32,.035,5,false);G.add(ropeG);add(ropeG,timberDark,0,0,0,[1,1,1],0,0,0,'windgate17/harbor sagging rope');

  const drift=[
    [-80,112,4.4,.16],[-77,115,3.3,-.22],[-51,112,3.8,.24],[-48,116,2.9,-.18],
    [-86,105,3.1,.12],[-44,106,2.8,-.15]
  ];
  for(const [x,z,len,ry] of drift){
    const y=field.height(x,z)+.16;
    const dx=Math.sin(ry)*len*.5,dz=Math.cos(ry)*len*.5;
    beam([x-dx,y,z-dz],[x+dx,y+.10,z+dz],.14,rng()<.25?timberDark:timber,'windgate17/washed timber');harborStats.driftwood++;
  }
  // Interrupted old seawall: enough to imply a former stone harbor, broken where refugees rebuilt in wood.
  for(const [x,z,w,ry] of[[-94,108,3.2,.12],[-90,111,2.2,.18],[-39,112,2.8,-.15],[-35,109,2.1,-.10]]){
    const y=field.height(x,z);
    add(boxG,oldStone,x,y+.20,z,[w,.36,.62],ry,0,(rng()-.5)*.04,'windgate17/broken seawall');harborStats.seawall++;
    if(rng()>.35){stone(x+(rng()-.5)*2,z+(rng()-.5)*1.2,.7,.32,.55,rockPale,-.05,rng()*Math.PI,'windgate17/seawall rubble');harborStats.seawall++;}
  }
  // Cargo kept to the margins of spawn.
  const cargo=[
    [-72,104,1.05,.72,.82,.08],[-75,102,.82,.58,.72,-.14],[-54,104,.92,.62,.80,.11]
  ];
  for(const [x,z,sx,sy,sz,ry] of cargo){const y=field.height(x,z);add(boxG,timber,x,y+sy*.48,z,[sx,sy,sz],ry,'','','windgate17/harbor cargo');harborStats.cargo++;}

  // Sand and trampled shore patches tie timber objects back into the ground.
  patch([[-82,109],[-75,107],[-70,111],[-74,115],[-81,114]],sand,.018,'windgate17/harbor shore scar');
  patch([[-58,108],[-50,108],[-47,112],[-53,115],[-60,113]],soil,.018,'windgate17/harbor work scar');

  // --- 4) Silhouette pass: sparse crown masses reinforce physical ridges without drawing a wall.
  const crowns=[
    [-12,43,3],[-6,38,2],[-45,14,3],[-38,9,2],[13,16,3],[20,19,2],
    [-91,-27,3],[-102,-29,2],[84,31,3],[91,42,2]
  ];
  let crownRocks=0,crownTrees=0;
  for(const [x,z,n] of crowns){
    if(field.nearPath(x,z).d<7||criticalViews.some(v=>axisDistance(v,x,z).d<6.0))continue;
    for(let i=0;i<n;i++){
      const px=x+(rng()-.5)*5,pz=z+(rng()-.5)*5;
      if(field.nearPath(px,pz).d<6.5)continue;
      if(i%2===0){const s=1.3+rng()*1.3;stone(px,pz,s*1.45,s*(1.1+rng()*.7),s,rockDark,-.55,rng()*Math.PI,'windgate17/ridge crown');crownRocks++;}
      else{tree(px,pz,5.5+rng()*2.5,1.5+rng()*.65,true);crownTrees++;}
    }
  }

  // Small wind-scoured patches make exposed route rooms feel authored rather than uniformly grassy.
  const scars=[
    [[-60,31],[-55,29],[-52,32],[-55,35]],[[12,-5],[18,-7],[22,-4],[18,-1]],
    [[39,-44],[46,-46],[49,-41],[43,-38]],[[-28,-84],[-22,-87],[-18,-83],[-22,-79]]
  ];
  for(let i=0;i<scars.length;i++)patch(scars[i],i%2?soilDark:soil,.022,'windgate17/wind scoured ground');

  // Update checkpoint copy to match the finished environmental storytelling.
  const landing=field.points.find(p=>p.id==='landing');if(landing)landing.text='수리된 나무 부두 뒤로 오래된 석축의 흔적이 남아 있다';
  const cavePoint=field.points.find(p=>p.id==='cave');if(cavePoint)cavePoint.text='암맥을 따라 파낸 절개면과 버려진 채굴 앞마당';
  const forestPoint=field.points.find(p=>p.id==='forest');if(forestPoint)forestPoint.text='바위와 수목이 다음 구간을 가렸다가 모퉁이에서 길을 연다';
  const grovePoint=field.points.find(p=>p.id==='grove');if(grovePoint)grovePoint.text='옛길의 잔해 사이로 정상의 방향이 다시 열린다';

  island.finalMap17={
    manual:true,version:'f1',terrainCarved:false,newGameplayColliders:0,
    mine:mineStats,routeReveal:{gates:revealGates.length,trees:revealTrees,rocks:revealRocks,paving:routeFragments},
    harbor:harborStats,silhouette:{crownRocks,crownTrees,clusters:crowns.length},groundScars:scars.length
  };
  const prev=island.dispose;let dead=false;
  island.dispose=()=>{if(dead)return;dead=true;root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.finalMap17;
}
