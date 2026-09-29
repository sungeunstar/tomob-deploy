/** Windgate 17 waterfall manual pass w1.
 * Visual-only art direction around the two cascade axes and three basins.
 * Native terrain, water clipping and gameplay collision remain the SSOT.
 */
import * as THREE from 'three';
import {BASINS,fallAxes,axisDistance,basinRadius} from './aurora-refuge-field.js';

const makeRng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);

export function authorWaterfall17(ctx,island){
  const rng=makeRng(170929);
  const root=new THREE.Group();root.name='Windgate 17 / waterfall hand pass w1';island.root.add(root);
  const G=new Set(),M=new Set();
  const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.98,flatShading:true,...o});M.add(m);return m;};
  const wetRock=mat('#536a63'),deepWet=mat('#405750'),dryRock=mat('#718178'),moss=mat('#5e744d'),mossDark=mat('#4b6445');
  const silt=mat('#746b58'),paleStone=mat('#879187');
  const rockG=new THREE.DodecahedronGeometry(1,0),boxG=new THREE.BoxGeometry(1,1,1);G.add(rockG);G.add(boxG);

  function add(g,m,x,y,z,s=[1,1,1],ry=0,rx=0,rz=0,name=''){
    G.add(g);const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.rotation.set(rx,ry,rz);
    o.castShadow=o.receiveShadow=true;o.name=name;root.add(o);return o;
  }
  function rock(x,z,sx,sy,sz,m=wetRock,yOff=-.12,ry=rng()*Math.PI){
    const y=island.field.height(x,z)+yOff;
    return add(rockG,m,x,y,z,[sx,sy,sz],ry,(rng()-.5)*.08,(rng()-.5)*.12,'windgate17/waterfall rock');
  }

  // Dark rock curtains immediately behind and beside each fall stop the water sheets
  // from reading as floating planes while leaving the visible centre open.
  const shoulders=[];
  for(let fi=0;fi<fallAxes.length;fi++){
    const a=fallAxes[fi],dx=a[2]-a[0],dz=a[3]-a[1],len=Math.hypot(dx,dz)||1;
    const tx=dx/len,tz=dz/len,nx=-tz,nz=tx;
    for(let i=0;i<7;i++){
      const t=.05+i/6*.90,px=a[0]+dx*t,pz=a[1]+dz*t;
      const ySpan=Math.abs(a[4]-a[5]),scale=1.25+(i%3)*.30+(fi*.15);
      for(const side of[-1,1]){
        const lateral=a[6]*(.68+.08*(i%2))+side*(.28+rng()*.22);
        const x=px+nx*side*lateral,z=pz+nz*side*lateral;
        const sy=1.65+scale*.55+ySpan*.045;
        rock(x,z,1.35+scale*.35,sy,1.1+scale*.25,(i+fi)%3===0?deepWet:wetRock,-.28,Math.atan2(tx,tz)+(rng()-.5)*.35);
        shoulders.push([x,z]);
      }
    }

    // Broken lips at top and landing. They are asymmetric so the fall never reads like a cut slot.
    for(const end of[0,1]){
      const t=end?.92:.08,px=a[0]+dx*t,pz=a[1]+dz*t;
      for(let j=0;j<5;j++){
        const side=j%2?1:-1,lateral=a[6]*(.48+.11*j)+side*(.2+rng()*.5);
        const x=px+nx*side*lateral+tx*((rng()-.5)*1.2),z=pz+nz*side*lateral+tz*((rng()-.5)*1.2);
        const s=.72+rng()*.72;
        rock(x,z,s*1.35,s*.62,s, end?wetRock:dryRock,-.20,rng()*Math.PI);
      }
    }
  }

  // Basin rims get distinct identities: high source = exposed rock, shelf = mossy,
  // lagoon = broader silt/pebbles. Existing generated bank rocks stay underneath.
  const basinStats={source:0,shelf:0,lagoon:0};
  for(const b of BASINS){
    const count=b.id==='lagoon'?34:24;
    for(let i=0;i<count;i++){
      const a=(i/count)*Math.PI*2+.09*Math.sin(i*2.17),r=1.02+.055*Math.sin(i*1.31)+(rng()-.5)*.055;
      const x=b.x+Math.cos(a)*b.rx*r,z=b.z+Math.sin(a)*b.rz*r;
      if(fallAxes.some(f=>axisDistance(f,x,z).d<f[6]*.56))continue;
      const s=b.id==='lagoon'?.46+rng()*.58:.62+rng()*.72;
      const material=b.id==='source'?(rng()<.58?dryRock:wetRock):b.id==='shelf'?(rng()<.62?moss:wetRock):(rng()<.52?silt:wetRock);
      rock(x,z,s*1.35,s*.48,s*(.82+rng()*.26),material,-.20,rng()*Math.PI);
      basinStats[b.id]++;
    }
  }

  // Moss tongues grow from splash zones outward, not uniformly around all water.
  const mossPatches=[];
  for(const a of fallAxes){
    const dx=a[2]-a[0],dz=a[3]-a[1],len=Math.hypot(dx,dz)||1,tx=dx/len,tz=dz/len,nx=-tz,nz=tx;
    for(let i=0;i<14;i++){
      const t=.42+rng()*.58,side=rng()<.5?-1:1;
      const x=a[0]+dx*t+nx*side*(a[6]*(.8+rng()*.65)),z=a[1]+dz*t+nz*side*(a[6]*(.8+rng()*.65));
      if(island.field.slope(x,z)>1.65)continue;
      const y=island.field.height(x,z)+.035,s=.45+rng()*.78;
      const o=add(rockG,rng()<.35?mossDark:moss,x,y,z,[s,.055,s*(.62+rng()*.25)],rng()*Math.PI,0,(rng()-.5)*.08,'windgate17/splash moss');
      o.castShadow=false;mossPatches.push(o);
    }
  }

  // Wet rock stains trace a rough downstream spine without filling the channel.
  const stainSites=[
    [-81.7,-24.2,1.7,.10,2.7,-.18],[-76.0,-22.4,1.35,.08,2.1,.14],
    [-82.4,-8.2,1.9,.09,2.5,.20],[-75.8,-6.8,1.45,.08,2.2,-.17],
    [-86.8,2.5,2.1,.07,2.7,.13],[-70.8,5.2,1.8,.07,2.2,-.15]
  ];
  for(const [x,z,w,h,d,ry] of stainSites){
    const y=island.field.height(x,z)+.035;
    const o=add(rockG,deepWet,x,y,z,[w,h,d],ry,0,(rng()-.5)*.05,'windgate17/wet stone stain');o.castShadow=false;
  }

  // A few pale impact stones at the lower plunge pool give readable scale to the cascade.
  const landing=fallAxes[fallAxes.length-1],lx=landing[2],lz=landing[3];
  const impact=[
    [-4.8,3.8,1.45,.48,1.15],[-2.6,5.2,.92,.36,.78],[3.8,4.3,1.20,.44,.95],
    [5.5,6.2,.85,.30,.74],[-6.2,7.1,.72,.28,.62]
  ];
  for(const [ox,oz,sx,sy,sz] of impact)rock(lx+ox,lz+oz,sx,sy,sz,rng()<.45?paleStone:wetRock,-.22,rng()*Math.PI);

  // Low, irregular soil shelves soften the transition from lagoon to the walking route.
  const shelves=[
    [-67.5,15.0,3.7,.06,1.45,-.18],[-63.8,18.5,2.9,.05,1.20,.12],
    [-91.5,14.7,3.4,.05,1.35,.16],[-94.0,18.6,2.7,.05,1.05,-.10]
  ];
  for(const [x,z,w,h,d,ry] of shelves){
    const y=island.field.height(x,z)+.025;
    const o=add(boxG,silt,x,y,z,[w,h,d],ry,0,(rng()-.5)*.025,'windgate17/lagoon erosion shelf');o.castShadow=false;
  }

  const point=island.field.points.find(p=>p.id==='falls');
  if(point){
    point.name='두 단 폭포가 열리는 협곡';
    point.text='숲길 끝에서 한 번에 드러나는 두 단 폭포와 젖은 암벽';
  }

  island.waterfall17={
    manual:true,version:'w1',terrainCarved:false,newGameplayColliders:0,
    fallShoulders:shoulders.length,basinRim:basinStats,splashMoss:mossPatches.length,
    wetStains:stainSites.length,impactStones:impact.length,lagoonShelves:shelves.length
  };

  const prev=island.dispose;let dead=false;
  island.dispose=()=>{
    if(dead)return;dead=true;root.removeFromParent();G.forEach(g=>g.dispose());M.forEach(m=>m.dispose());prev();
  };
  return island.waterfall17;
}
