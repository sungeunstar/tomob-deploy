/** Windgate 17 summit s6 — hand-authored terrain patch around the portal.
 * Visual terrain integration only. Existing stable collision surfaces remain unchanged.
 */
import * as THREE from 'three';
import {SUMMIT} from './aurora-refuge-field.js';

const rng=(()=>{let s=171104;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorSummit17(ctx,island){
  const root=new THREE.Group();root.name='Windgate 17 / summit hand terrain s6';island.root.add(root);
  const G=new Set(),M=new Set(),hidden=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.96,flatShading:true,...o});M.add(m);return m;};
  const bedrock=mat('#7c887e'),edgeRock=mat('#68766e'),oldStone=mat('#91998e'),darkStone=mat('#606c65'),moss=mat('#6e8055'),soil=mat('#80745f');
  const boxG=new THREE.BoxGeometry(1,1,1),rockG=new THREE.DodecahedronGeometry(1,0);G.add(boxG);G.add(rockG);
  const cx=SUMMIT.x,cz=SUMMIT.z,py=SUMMIT.y;

  function add(g,m,x,y,z,s=[1,1,1],ry=0,rx=0,rz=0){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);o.castShadow=o.receiveShadow=true;root.add(o);return o;
  }

  // Remove only clearly decorative summit clutter; stable terrain/collision stays.
  island.root.updateMatrixWorld(true);
  island.root.traverse(o=>{
    if(!o.isMesh||o.parent===root)return;
    const p=new THREE.Vector3();o.getWorldPosition(p);
    if(Math.hypot(p.x-cx,p.z-cz)>17)return;
    const n=(o.name||'').toLowerCase();
    if(n.includes('windgate17/rock')||n.includes('fallen arch fragments')||n.includes('weathered floor pavers')){
      o.visible=false;hidden.push(o);return;
    }
    if((n.includes('rock1')||n.includes('rock2'))&&!n.includes('portal')){o.visible=false;hidden.push(o);return;}
    // Hide visual-only huge textured boulders around summit.
    if(o.material?.map && !n.includes('portal') && !n.includes('terrain')){
      const bb=new THREE.Box3().setFromObject(o),sz=bb.getSize(new THREE.Vector3()),mx=Math.max(sz.x,sz.y,sz.z);
      if(mx>4.2){o.visible=false;hidden.push(o);}
    }
  });

  // Irregular summit slab: hand-authored polygon, not a circular disc.
  const ring=[
    [-8.8,7.0],[-5.8,9.2],[-1.5,10.1],[3.2,9.6],[7.1,7.8],[9.4,3.5],[9.0,-1.7],
    [7.0,-6.0],[2.8,-8.8],[-2.5,-9.2],[-7.1,-7.0],[-9.3,-2.7],[-9.7,2.4]
  ];
  const topY=py+.63,verts=[cx,topY,cz],indices=[];
  for(const [x,z] of ring)verts.push(cx+x,topY+.035*Math.sin(x*.6+z*.4),cz+z);
  for(let i=0;i<ring.length;i++)indices.push(0,i+1,(i+1)%ring.length+1);
  const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));pg.setIndex(indices);pg.computeVertexNormals();G.add(pg);
  add(pg,bedrock,0,0,0);

  // Broken skirt blocks bridge the slab into the natural summit slope.
  const skirts=[
    [-8.8,4.3,3.1,.55,2.3,-.10],[-8.4,-2.5,3.5,.75,2.0,.16],[-5.5,-7.1,3.0,.60,2.6,-.18],
    [-.8,-8.8,3.6,.55,2.2,.05],[4.8,-7.4,3.3,.70,2.2,.14],[8.0,-4.3,3.0,.65,2.4,-.12],
    [8.8,1.5,2.7,.50,2.0,.18],[7.6,5.8,2.8,.58,2.0,-.14],[-6.4,7.5,2.5,.48,1.8,.10]
  ];
  for(const [ox,oz,w,h,d,ry] of skirts){
    const gy=island.field.height(cx+ox,cz+oz);
    const y=Math.min(topY-.12,gy+.22);
    add(boxG,edgeRock,cx+ox,y,cz+oz,[w,h,d],ry,0,(rng()-.5)*.05);
  }

  // Approach wedge/steps: gently lift from natural trail into the sanctuary.
  const approach=[
    [0,15.2,3.0,.16,.72,.00],[.12,13.9,3.25,.18,.75,-.03],[-.08,12.5,3.4,.20,.78,.02],
    [.18,11.15,3.55,.21,.80,-.025],[-.1,9.85,3.7,.22,.82,.018],[.08,8.6,3.8,.22,.84,-.018]
  ];
  approach.forEach(([ox,oz,w,h,d,ry],i)=>{
    const gy=island.field.height(cx+ox,cz+oz);
    const y=Math.max(gy+.04,topY-.75+i*.12);
    add(boxG,i%3===0?darkStone:oldStone,cx+ox,y,cz+oz,[w,h,d],ry);
  });

  // s5 naturalized ascent: terrain-hugging scars and irregular shoulders.
  // These are visual-only so the native walkable terrain remains the gameplay SSOT.
  function terrainPatch(points,m,yOffset=.035){
    const verts=[],ix=[];
    const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
    verts.push(center[0],island.field.height(center[0],center[1])+yOffset,center[1]);
    for(const [x,z] of points)verts.push(x,island.field.height(x,z)+yOffset,z);
    for(let i=0;i<points.length;i++)ix.push(0,i+1,(i+1)%points.length+1);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(ix);g.computeVertexNormals();G.add(g);
    const o=add(g,m,0,0,0);o.castShadow=false;return o;
  }

  // The ascent intentionally meanders. Patches overlap the old clean cut and make
  // the readable route alternate between exposed earth, bedrock and thin grass.
  const ascent=[
    {z:31.5,x:-2.4,w:5.0,d:4.5,ry:-.13},
    {z:27.6,x:-.6,w:4.2,d:3.8,ry:.09},
    {z:24.2,x:1.35,w:4.8,d:3.5,ry:.16},
    {z:20.8,x:.4,w:4.0,d:3.2,ry:-.08},
    {z:17.8,x:-1.05,w:4.3,d:3.0,ry:-.16}
  ];
  for(let i=0;i<ascent.length;i++){
    const a=ascent[i],x=cx+a.x,z=cz+a.z,c=Math.cos(a.ry),s=Math.sin(a.ry),hw=a.w/2,hd=a.d/2;
    const local=[[-hw,-hd],[hw*.92,-hd*.72],[hw,hd*.58],[hw*.45,hd],[-hw*.7,hd*.86],[-hw,hd*.12]];
    const pts=local.map(([px,pz])=>[x+px*c+pz*s,z-px*s+pz*c]);
    terrainPatch(pts,i%2?soil:bedrock,.028+i*.003);
  }

  // Break the perfectly trimmed trail silhouette with side shoulders and eroded gaps.
  const shoulders=[
    [-5.2,30.8,1.9,.62,1.45,.18],[3.9,29.5,1.45,.48,1.1,-.20],
    [-4.6,26.6,1.3,.44,1.25,-.12],[4.8,25.1,1.75,.56,1.45,.22],
    [-5.0,22.4,1.55,.52,1.2,.16],[4.2,20.2,1.25,.43,1.05,-.18],
    [-4.3,18.0,1.7,.55,1.25,-.10],[4.4,16.8,1.35,.46,1.1,.17]
  ];
  for(const [ox,oz,sx,sy,sz,ry] of shoulders){
    const x=cx+ox,z=cz+oz,gy=island.field.height(x,z);
    add(rockG,rng()<.48?edgeRock:bedrock,x,gy-.18,z,[sx,sy,sz],ry+(rng()-.5)*.22,0,(rng()-.5)*.08);
  }

  // Sparse fragments of an old retaining wall: enough history to read as ruins,
  // but deliberately incomplete so the mountain still feels dominant.
  const retaining=[
    [-5.8,27.8,1.15,.42,.50,-.10],[-4.9,26.8,.86,.34,.48,.03],
    [5.0,23.4,1.0,.38,.52,.14],[5.6,22.5,.72,.30,.45,.22],
    [-5.2,19.9,.82,.32,.46,-.16],[4.9,17.9,.94,.34,.48,.11]
  ];
  for(const [ox,oz,w,h,d,ry] of retaining){
    const x=cx+ox,z=cz+oz,y=island.field.height(x,z);
    add(boxG,rng()<.35?darkStone:oldStone,x,y+h*.22,z,[w,h,d],ry,0,(rng()-.5)*.07);
  }

  // Portal aisle: sparse old pavers only where feet would naturally pass.
  const pavers=[
    [-.35,7.1,1.45,.64,.10],[.28,5.7,1.75,.66,-.06],[-.15,4.15,1.35,.60,.05],
    [.20,2.75,1.8,.68,-.04],[-.30,1.30,1.25,.58,.08],
    [-2.8,3.6,.78,.48,.16],[2.7,2.4,.82,.50,-.13],[-3.8,-2.4,.74,.46,-.2],[3.5,-3.2,.80,.48,.17]
  ];
  for(const [ox,oz,w,d,ry] of pavers)add(boxG,oldStone,cx+ox,topY+.08,cz+oz,[w,.07,d],ry);

  // Portal foundations are partially buried in the slab instead of sitting on it.
  const foundations=[
    [-4.7,.15,1.55,.55,1.25,-.10],[4.7,.20,1.55,.55,1.25,.10],
    [-5.2,-1.1,1.05,.34,.95,.16],[5.3,-1.0,1.05,.34,.95,-.16]
  ];
  for(const [ox,oz,w,h,d,ry] of foundations)add(boxG,ox<0?darkStone:oldStone,cx+ox,topY-.05+h*.4,cz+oz,[w,h,d],ry);

  // s6 sanctuary ruin plan: the footprint of a former building should still be readable.
  // Keep the +Z approach and central portal aisle open; ruins frame the space instead of filling it.
  const ruinFloor=mat('#858b80',{roughness:1}),columnStone=mat('#8b9187');
  const drumG=new THREE.CylinderGeometry(1,1,1,8);G.add(drumG);

  function ruinStrip(ax,az,bx,bz,width=.58,y=.045,m=ruinFloor){
    const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),mx=cx+(ax+bx)/2,mz=cz+(az+bz)/2;
    const o=add(boxG,m,mx,topY+y,mz,[width,.08,len/2],Math.atan2(dx,dz));o.castShadow=false;return o;
  }
  // Foundation ghost: readable only at the edges, never a clean complete rectangle.
  ruinStrip(-6.2,-6.2,-2.1,-6.2,.50,.025);
  ruinStrip(2.0,-6.2,6.0,-6.2,.52,.025);
  ruinStrip(-6.25,-5.8,-6.25,-1.3,.48,.022);
  ruinStrip(-6.25,.4,-6.25,2.8,.46,.022);
  ruinStrip(6.05,-5.8,6.05,-2.0,.48,.022);
  ruinStrip(6.05,-.6,6.05,1.7,.44,.022);

  function brokenWall(ax,az,bx,bz,course=2,seed=.31){
    const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz),steps=Math.max(2,Math.floor(len/.92));
    const yaw=Math.atan2(dx,dz);
    for(let i=0;i<steps;i++){
      const t=(i+.5)/steps;
      if(((i+Math.floor(seed*10))%7)===3)continue;
      const x=cx+ax+dx*t,z=cz+az+dz*t;
      const hCourses=Math.max(1,course-((i+Math.floor(seed*13))%4===0?1:0));
      for(let r=0;r<hCourses;r++){
        if(r>0&&(i+Math.floor(seed*17))%5===1)continue;
        const w=.78+((i+r)%3)*.08,h=.34+((i+r)%2)*.04,d=.48;
        const o=add(boxG,(i+r)%5===0?darkStone:oldStone,x+(rng()-.5)*.08,topY+.13+r*.36,z+(rng()-.5)*.08,[w,h,d],yaw+(rng()-.5)*.06,0,(rng()-.5)*.035);
        o.name='windgate17/sanctuary broken wall';
      }
    }
  }

  // Rear wall and two side returns create the suggestion of a roofed sanctuary.
  brokenWall(-6.15,-6.0,-2.15,-6.0,2,.22);
  brokenWall(2.1,-6.0,5.95,-6.0,2,.48);
  brokenWall(-6.05,-5.55,-6.05,-1.4,2,.67);
  brokenWall(-6.05,.45,-6.05,2.55,1,.31);
  brokenWall(5.9,-5.5,5.9,-2.0,2,.53);
  brokenWall(5.9,-.55,5.9,1.55,1,.74);

  // Broken columns: some still standing, others collapsed toward the old nave.
  const columns=[
    [-4.45,-3.65,1.75,0], [4.45,-3.65,1.28,0],
    [-4.25,1.35,.92,0], [4.35,.95,.68,0]
  ];
  for(const [ox,oz,h,lean] of columns){
    add(drumG,columnStone,cx+ox,topY+h*.28,cz+oz,[.52,h*.55,.52],0,0,lean);
    add(boxG,darkStone,cx+ox,topY+.10,cz+oz,[.75,.16,.75],(rng()-.5)*.12);
  }
  // Fallen drums and lintels point toward the collapse, creating directional history.
  add(drumG,oldStone,cx-3.45,topY+.34,cz-1.95,[.50,1.20,.50],.18,0,Math.PI/2-.08);
  add(drumG,darkStone,cx+4.95,topY+.30,cz-1.10,[.46,.98,.46],-.22,0,Math.PI/2+.12);
  add(boxG,oldStone,cx-3.15,topY+.40,cz-5.15,[2.25,.34,.50],-.11,0,.08);
  add(boxG,darkStone,cx+3.25,topY+.29,cz-5.25,[1.65,.28,.46],.16,0,-.06);

  // Three collapse fans: rubble density increases close to the broken structural corners.
  const collapseFans=[
    [-5.55,-5.30,1.55,10],[5.45,-4.95,1.45,9],[-5.60,1.15,1.25,7]
  ];
  let ruinRubble=0;
  for(const [ox,oz,rad,count] of collapseFans){
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2+rng()*.7,r=.35+rng()*rad;
      const x=cx+ox+Math.cos(a)*r,z=cz+oz+Math.sin(a)*r;
      // Leave the central nave clear.
      if(Math.abs(x-cx)<2.15&&z>cz-4.8)continue;
      const s=.22+rng()*.48;
      add(rockG,rng()<.28?darkStone:oldStone,x,topY+.10+rng()*.12,z,[s,s*.45,s*.72],rng()*Math.PI,0,(rng()-.5)*.22);
      ruinRubble++;
    }
  }

  // A rear threshold and side altar fragment provide a human-scale focal hierarchy.
  add(boxG,darkStone,cx,topY+.11,cz-5.62,[1.95,.16,.62],.02);
  add(boxG,oldStone,cx-4.55,topY+.42,cz-4.95,[1.20,.58,.85],-.08);
  add(boxG,darkStone,cx-4.55,topY+.82,cz-4.95,[.88,.20,.66],-.08);

  // Small bedrock groups around the edge; never one giant isolated sphere.
  const clusters=[
    [-7.9,5.0,1.7,1.0,1.35],[-8.5,1.1,1.4,.8,1.15],[-7.2,-5.2,1.8,.95,1.5],
    [-3.7,-8.2,1.45,.72,1.25],[2.9,-8.0,1.65,.82,1.35],[7.3,-5.3,1.55,.78,1.25],
    [8.3,-.8,1.75,.9,1.45],[7.5,4.9,1.5,.78,1.25]
  ];
  for(const [ox,oz,sx,sy,sz] of clusters){
    const gy=island.field.height(cx+ox,cz+oz);
    add(rockG,rng()<.45?edgeRock:bedrock,cx+ox,Math.min(topY-.18,gy-.08),cz+oz,[sx,sy,sz],rng()*Math.PI);
    if(rng()>.5)add(rockG,edgeRock,cx+ox+(rng()-.5)*1.1,Math.min(topY-.22,gy+.05),cz+oz+(rng()-.5)*.9,[sx*.55,sy*.55,sz*.55],rng()*Math.PI);
  }

  // One low ruined marker on rear-left for silhouette.
  for(let i=0;i<3;i++){
    const h=1.55-i*.28,x=cx-7.15+i*.5,z=cz-4.9+i*.16;
    add(boxG,i===1?darkStone:oldStone,x,topY+h*.48,z,[.42,h,.46],-.12+i*.07);
  }
  add(boxG,darkStone,cx-6.65,topY+1.42,cz-4.82,[1.2,.22,.52],-.08);

  // Edge vegetation and moss, centre stays wind-scoured.
  const grassMat=mat('#708151',{side:THREE.DoubleSide}),grassG=new THREE.BufferGeometry();
  grassG.setAttribute('position',new THREE.Float32BufferAttribute([-.06,0,0,.06,0,0,0,.52,.04, -.05,0,.02,.05,0,.02,.10,.42,-.06],3));grassG.computeVertexNormals();G.add(grassG);
  for(let i=0;i<24;i++){
    const a=i/24*Math.PI*2+.13*Math.sin(i*1.9),r=10.1+(i%3)*.48;
    // Keep +Z approach open.
    if(Math.abs(a-Math.PI/2)<.48)continue;
    const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,y=island.field.height(x,z)+.04;
    add(grassG,grassMat,x,y,z,[.58+(i%2)*.12,.72+(i%3)*.08,.58+(i%2)*.12],a);
  }
  for(const [ox,oz,s] of [[-4.6,.3,.75],[4.7,.15,.70],[-6.3,-3.7,.58],[5.8,-4.0,.52],[-7.2,4.2,.46]]){
    const gy=island.field.height(cx+ox,cz+oz);
    const o=add(rockG,moss,cx+ox,Math.min(topY+.10,gy+.1),cz+oz,[s,.07,s*.72],rng()*6.28);o.castShadow=false;
  }

  // A few soil scars break up the clean edge without adding clutter.
  for(const [ox,oz,w,d,ry] of [[-6.2,6.0,2.4,1.0,.18],[6.0,5.1,2.0,.9,-.14],[-6.8,-5.3,2.2,.85,.20],[5.6,-6.0,1.8,.75,-.18]]){
    add(boxG,soil,cx+ox,topY-.18,cz+oz,[w,.05,d],ry);
  }

  const point=island.field.points.find(p=>p.id==='summit17');
  if(point){point.x=cx;point.z=cz+8.6;point.y=island.field.height(point.x,point.z);point.target=[cx,py+5.5,cz];}
  else island.field.points.push({id:'summit17',name:'깨어난 첫 별의 성소 · 수작업',x:cx,y:island.field.height(cx,cz+8.6),z:cz+8.6,r:5,target:[cx,py+5.5,cz],text:'바람에 깎인 옛 성소'});

  island.summit17={
    manual:true,version:'s6',hiddenLegacy:hidden.length,terrainCarved:false,newGameplayColliders:0,
    irregularSlab:true,approachSteps:approach.length,edgeClusters:clusters.length,giantBoulders:false,ascentNaturalized:true,retainingFragments:retaining.length,sanctuaryFootprint:true,brokenWallRuns:6,columns:columns.length,ruinRubble
  };
  const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;hidden.forEach(o=>o.visible=true);root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.summit17;
}
