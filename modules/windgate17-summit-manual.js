/** Windgate 17 — hand-authored summit pass.
 * Visual replacement only: native portal + existing stable Rapier surfaces remain unchanged.
 */
import * as THREE from 'three';
import {SUMMIT} from './aurora-refuge-field.js';

const rng=(()=>{let s=171027;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);})();

export function authorSummit17(ctx,island){
  const root=new THREE.Group();root.name='Windgate 17 / hand-authored summit';island.root.add(root);
  const G=new Set(),M=new Set(),hidden=[];
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.95,...o});M.add(m);return m;};
  const stone=mat('#879287',{flatShading:true}),dark=mat('#667269',{flatShading:true}),moss=mat('#718157',{flatShading:true}),soil=mat('#827a64',{flatShading:true});
  const rockG=new THREE.DodecahedronGeometry(1,0),boxG=new THREE.BoxGeometry(1,1,1);G.add(rockG);G.add(boxG);
  const cx=SUMMIT.x,cz=SUMMIT.z,py=SUMMIT.y;

  function add(g,m,x,y,z,s=[1,1,1],ry=0){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.y=ry;o.castShadow=o.receiveShadow=true;root.add(o);return o;
  }
  // Hide only summit visuals that make the place read like a placed circular prop.
  island.root.updateMatrixWorld(true);
  island.root.traverse(o=>{
    if(!o.isMesh||o.parent===root)return;
    const p=new THREE.Vector3();o.getWorldPosition(p);
    if(Math.hypot(p.x-cx,p.z-cz)>15.5)return;
    if(o.name==='Weathered floor pavers'||o.name==='Fallen arch fragments'||o.name==='windgate17/rock2'){
      o.visible=false;hidden.push(o);return;
    }
    if(o.geometry?.type==='CylinderGeometry'){
      const bb=new THREE.Box3().setFromObject(o),sz=bb.getSize(new THREE.Vector3());
      if(sz.x>15&&sz.z>15&&sz.y<1.2){o.visible=false;hidden.push(o);}
    }
  });

  // Irregular stone terrace skin over the stable invisible/legacy walk surface.
  const seg=28,top=[],low=[],positions=[],indices=[];
  for(let i=0;i<seg;i++){
    const a=i/seg*Math.PI*2;
    const front=Math.abs(THREE.MathUtils.euclideanModulo(a-Math.PI/2+Math.PI,Math.PI*2)-Math.PI)<.58;
    const baseR=front?10.0:10.45;
    const r=baseR+Math.sin(a*3.1+.7)*.52+Math.sin(a*7.3)*.24+(rng()-.5)*.22;
    const rt=r+.75+.18*Math.sin(a*5.2);
    const y=py+.655+.025*Math.sin(a*4.5);
    top.push([cx+Math.cos(a)*r,y,cz+Math.sin(a)*r]);
    low.push([cx+Math.cos(a)*rt,py+.18+.04*Math.sin(a*2.2),cz+Math.sin(a)*rt]);
  }
  positions.push(cx,py+.66,cz);
  for(const p of top)positions.push(...p);
  for(const p of low)positions.push(...p);
  for(let i=0;i<seg;i++){
    const n=(i+1)%seg;
    indices.push(0,1+i,1+n);
    const ti=1+i,tn=1+n,li=1+seg+i,ln=1+seg+n;
    indices.push(ti,li,tn,tn,li,ln);
  }
  const terraceG=new THREE.BufferGeometry();terraceG.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));terraceG.setIndex(indices);terraceG.computeVertexNormals();G.add(terraceG);
  const terrace=new THREE.Mesh(terraceG,stone);terrace.name='Hand-authored irregular summit terrace';terrace.castShadow=terrace.receiveShadow=true;root.add(terrace);

  // Sparse intentional pavers: route into portal, not a random tiled circle.
  const pavers=[
    [-.1,7.4,2.2,.82,.12],[.35,5.6,2.6,.78,-.08],[-.3,3.9,2.2,.90,.07],
    [.25,2.2,2.55,.85,-.05],[-.5,.4,2.15,.78,.04],
    [-4.7,2.7,1.2,.62,.18],[4.4,1.6,1.35,.60,-.12],[-5.5,-2.0,1.05,.55,-.22],[5.1,-3.3,1.10,.58,.14]
  ];
  for(const [ox,oz,w,d,ry] of pavers)add(boxG,dark,cx+ox,py+.72,cz+oz,[w,.07,d],ry);

  // Broken approach stairs blend the natural path into the sanctuary.
  const stairZ=[10.9,12.0,13.15,14.35,15.55];
  stairZ.forEach((oz,i)=>{
    const y=island.field.height(cx,cz+oz)+.08;
    const w=2.8-(i%2)*.22;
    add(boxG,i%3===0?dark:stone,cx+(i%2?-.16:.1),y,cz+oz,[w,.12,.55],(i-2)*.025);
  });

  // Low-poly bedrock shoulders. Leave the +Z approach open.
  const rocks=[
    [-2.55,12.4,2.2,1.0,1.6],[-2.05,10.5,1.65,.8,1.3],
    [-.65,11.7,1.9,.85,1.45],[.55,12.8,2.4,1.0,1.7],
    [.95,10.8,1.55,.75,1.2],[2.35,11.6,2.0,.9,1.5],
    [2.75,9.9,1.35,.65,1.0],[3.55,8.9,1.1,.55,.9]
  ];
  // angles are around the back and flanks, never directly in the walk-in slot.
  for(const [a,r,sx,sy,sz] of rocks){
    const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,y=island.field.height(x,z)-.18;
    add(rockG,a%2?dark:stone,x,y,z,[sx,sy,sz],a*.73);
  }

  // Break up portal bases with collapsed masonry that visually sinks into the terrace.
  const masonry=[
    [-4.9,.3,1.25,.38,1.1,-.12],[-5.4,-.8,.85,.30,.8,.18],
    [4.8,.5,1.35,.36,1.0,.08],[5.4,-1.0,.92,.28,.78,-.16],
    [-3.9,-4.4,1.4,.24,.8,.32],[3.7,-4.8,1.25,.23,.75,-.25]
  ];
  for(const [ox,oz,w,h,d,ry] of masonry)add(boxG,ox<0?dark:stone,cx+ox,py+.72+h*.45,cz+oz,[w,h,d],ry);

  // Edge vegetation only: sanctuary centre remains intentionally bare/wind-scoured.
  const grassMat=mat('#70824f',{side:THREE.DoubleSide}),grassG=new THREE.BufferGeometry();
  const gp=[];for(let i=0;i<7;i++){const a=i/7*Math.PI*2;gp.push(-.07,0,0,.07,0,0,Math.cos(a)*.13,.5+(i%2)*.12,Math.sin(a)*.13);}
  grassG.setAttribute('position',new THREE.Float32BufferAttribute(gp,3));grassG.computeVertexNormals();G.add(grassG);
  for(let i=0;i<28;i++){
    const a=i/28*Math.PI*2+.16*Math.sin(i*1.7),r=11.0+(i%4)*.42;
    if(Math.abs(THREE.MathUtils.euclideanModulo(a-Math.PI/2+Math.PI,Math.PI*2)-Math.PI)<.55)continue;
    const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,y=island.field.height(x,z)+.04;
    add(grassG,grassMat,x,y,z,[.55+(i%3)*.13,.65+(i%2)*.10,.55+(i%3)*.13],a);
  }
  // Moss patches around older stone joints.
  for(const [ox,oz,s] of [[-5.2,.1,1.0],[5.0,.2,.9],[-4.0,-4.1,.7],[3.7,-4.2,.65]]){
    const o=add(rockG,moss,cx+ox,py+.80,cz+oz,[s,.08,s*.72],rng()*6.28);o.castShadow=false;
  }

  // Human-scale ruined marker on the rear-left gives silhouette without giant boulder clutter.
  for(let i=0;i<3;i++){
    const x=cx-8.0+i*.55,z=cz-5.7+i*.16,h=1.7-i*.33;
    add(boxG,i===1?dark:stone,x,py+.65+h*.5,z,[.48,h,.52],-.14+i*.08);
  }
  add(boxG,dark,cx-7.45,py+2.15,cz-5.62,[1.45,.26,.58],-.09);

  island.field.points.push({id:'summit17',name:'깨어난 첫 별의 성소 · 수작업',x:cx,y:py+.7,z:cz+9.0,r:5,target:[cx,py+5.5,cz],text:'바람에 깎인 옛 성소'});
  island.summit17={manual:true,hiddenLegacy:hidden.length,terrainCarved:false,newGameplayColliders:0,approachStairs:stairZ.length,edgeRocks:rocks.length};
  const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;hidden.forEach(o=>o.visible=true);root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();};
  return island.summit17;
}