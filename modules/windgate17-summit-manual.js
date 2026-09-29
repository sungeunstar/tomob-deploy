/** Windgate 17 summit s4 — hand-authored terrain patch around the portal.
 * Visual terrain integration only. Existing stable collision surfaces remain unchanged.
 */
import * as THREE from 'three';
import {SUMMIT} from './aurora-refuge-field.js';

const rng=(()=>{let s=171104;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorSummit17(ctx,island){
  const root=new THREE.Group();root.name='Windgate 17 / summit hand terrain s4';island.root.add(root);
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
    manual:true,version:'s4',hiddenLegacy:hidden.length,terrainCarved:false,newGameplayColliders:0,
    irregularSlab:true,approachSteps:approach.length,edgeClusters:clusters.length,giantBoulders:false
  };
  const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;hidden.forEach(o=>o.visible=true);root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.summit17;
}
