/** Windgate 12: actual cut-through vault, not a decorative shell on uncut terrain.
 * Owns only additive sample resources. World-space geometry is shared with Rapier.
 */
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BUILDINGS,BASINS,basinRadius,fallAxes,axisDistance} from './aurora-refuge-field.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const rndFor=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const controls=[[-18,-68,55],[-23,-75,55.7],[-26,-82,56.7],[-22,-89,58.2],[-14,-94,60],[-4,-96,61.1],[7,-93,61.6],[14,-88,61.4]];
const curve=new THREE.CatmullRomCurve3(controls.map(([x,z,y])=>new THREE.Vector3(x,y,z)),false,'centripetal');
const rows=Array.from({length:121},(_,i)=>{const p=curve.getPoint(i/120),t=curve.getTangent(i/120);t.y=0;t.normalize();return {p,t,n:new THREE.Vector3(-t.z,0,t.x),u:i/120};});
export function vaultSample(x,z){
 let best={d:Infinity};
 for(let i=0;i<rows.length-1;i++){const a=rows[i].p,b=rows[i+1].p,dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz));const px=mix(a.x,b.x,t),pz=mix(a.z,b.z,t),d=Math.hypot(x-px,z-pz);
  if(d<best.d){const len=Math.hypot(dx,dz);best={d,side:((x-px)*-dz+(z-pz)*dx)/len,y:mix(a.y,b.y,t),u:(i+t)/120};}}
 return best;
}
export function vaultReserve(x,z,pad=0){return x>-32-pad&&x<22+pad&&z>-103-pad&&z<-61+pad&&vaultSample(x,z).d<6.4+pad;}
function vaultSDF(x,y,z){const q=vaultSample(x,z),r=3.5,a=rows[0],b=rows[rows.length-1],before=-((x-a.p.x)*a.t.x+(z-a.p.z)*a.t.z),after=(x-b.p.x)*b.t.x+(z-b.p.z)*b.t.z,roof=q.y+2.2+3.05*Math.sqrt(Math.max(0,1-(q.d/r)**2));return Math.max(q.d-r,q.y-.035-y,y-roof,before,after);}
export function prepareVault(field){
 field.vaultReserve=vaultReserve;
 const n=field.segments,sz=field.size;
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const x=(i/n-.5)*sz,z=(j/n-.5)*sz,k=j*(n+1)+i;for(const ri of[0,120]){const r=rows[ri],d=Math.hypot(x-r.p.x,z-r.p.z);if(d>6.5)continue;const fade=1-clamp((d-3.8)/2.7),h=field.heights[k];if(h<r.p.y)field.heights[k]=mix(h,r.p.y,fade*fade*(3-2*fade));}}

 // Blend the two mouths into the canyon floor instead of leaving a clipped terrain seam.
 for(const ri of[0,rows.length-1]){
  const r=rows[ri],sign=ri===0?-1:1;
  for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
   const x=(i/n-.5)*sz,z=(j/n-.5)*sz,k=j*(n+1)+i;
   const vx=x-r.p.x,vz=z-r.p.z,along=(vx*r.t.x+vz*r.t.z)*sign,side=Math.abs(vx*r.n.x+vz*r.n.z);
   if(along<0||along>9||side>7.2)continue;
   const a=1-clamp(along/9),b=1-clamp((side-3.7)/3.5),w=a*a*(3-2*a)*b*b*(3-2*b);
   const shoulder=r.p.y+.03+Math.max(0,side-3.5)*.10+along*.055;
   field.heights[k]=mix(field.heights[k],shoulder,w*.82);
  }
 }
 field.vaultRows=rows;
 const points=rows.map(r=>[r.p.x,r.p.z,r.p.y]);field.segmentsList=field.segmentsList.slice();field.routeDefs=field.routeDefs.slice();
 for(let i=0;i<points.length-1;i++)field.segmentsList.push({a:points[i],b:points[i+1],id:'vault',width:6.4,bridge:true});
 field.routeDefs.push({id:'vault',name:'마지막 바위 고개 → 성소 뒤편 바람굴',width:6.4,points});for(let i=points.length-1;i>0;i--)field.segmentsList.push({a:points[i],b:points[i-1],id:'vault-return',width:6.4,bridge:true});
 const stations=[['vault-entry','마지막 바위 고개 · 굴 입구',0],['vault-turn','성소 아래 굽이',.48],['vault-exit','성소 뒤편 굴 출구',1]];
 for(const[id,name,u]of stations){const p=curve.getPoint(u),q=curve.getPoint(clamp(u+.13));field.points.push({id,name,x:p.x,y:p.y,z:p.z,r:5,target:[q.x,q.y+1.6,q.z],text:'산 아래를 돌아서 통과하는 옛길'});}
 return field;
}
/** Adaptively split only a small local patch, clip out the tunnel void, keep original roof. */
export function carveVaultTerrain(geo,field){
 const attrs=['position','normal','color','uv'],sizes=[3,3,3,2],src=attrs.map(k=>geo.attributes[k]),out=attrs.map(()=>[]);let cut=0,refined=0;
 const read=i=>src.flatMap(a=>Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize)));
 const interp=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
 const emit=t=>{for(const v of t){let k=0;for(let j=0;j<attrs.length;j++){out[j].push(...v.slice(k,k+sizes[j]));k+=sizes[j];}}};
 const val=v=>vaultSDF(v[0],v[1],v[2]);
 function clip(t){let p=[];for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],fa=val(a),fb=val(b);if(fa>=0)p.push(a);if((fa>=0)!==(fb>=0)){let lo=0,hi=1;for(let j=0;j<16;j++){const mid=(lo+hi)/2,f=val(interp(a,b,mid));if((f>=0)===(fa>=0))lo=mid;else hi=mid;}p.push(interp(a,b,(lo+hi)/2));}}
  if(p.length!==3||t.some(v=>val(v)<0))cut++;for(let i=1;i<p.length-1;i++)emit([p[0],p[i],p[i+1]]);
 }
 function split(t,depth){if(!depth){clip(t);return;}const ab=interp(t[0],t[1],.5),bc=interp(t[1],t[2],.5),ca=interp(t[2],t[0],.5);split([t[0],ab,ca],depth-1);split([ab,t[1],bc],depth-1);split([ca,bc,t[2]],depth-1);split([ab,bc,ca],depth-1);}
 const ix=geo.index.array;
 for(let i=0;i<ix.length;i+=3){const t=[read(ix[i]),read(ix[i+1]),read(ix[i+2])],x=(t[0][0]+t[1][0]+t[2][0])/3,z=(t[0][2]+t[1][2]+t[2][2])/3;
  if(x>-31&&x<21&&z>-102&&z<-62&&vaultSample(x,z).d<6.3){refined++;split(t,2);}else emit(t);}
 geo.setIndex(null);attrs.forEach((k,i)=>geo.setAttribute(k,new THREE.Float32BufferAttribute(out[i],sizes[i])));geo.computeBoundingBox();geo.computeBoundingSphere();
 field.vaultCut={removedOrClippedTriangles:cut,localRefinedTriangles:refined,renderAndPhysicsSameGeometry:true,originalSummitRoofRetained:true};
 return geo;
}
export function dressWindgate10(ctx,island){
 const field=island.field,root=new THREE.Group();root.name='Windgate 12 / portal-back canyon passage';island.root.add(root);
 const rnd=rndFor(100926),gs=new Set(),ms=new Set(),ts=new Set(),staticMeshes=[],wallMeshes=[],lights=[],signs=[];
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.94,...o});ms.add(m);return m;};
 const rock=mat('#697367',{vertexColors:true,side:THREE.DoubleSide}),masonry=mat('#8e9481'),dark=mat('#656e60'),wood=mat('#67513a'),iron=mat('#45483f',{metalness:.3});
 const floorMat=mat('#8b8270',{vertexColors:true,side:THREE.DoubleSide}),mossMat=mat('#627747'),leafMat=mat('#778b56',{side:THREE.DoubleSide});
 // World-space mineral variation joins smooth tunnel walls to the weathered island.
 for(const m of[rock,masonry,dark,floorMat]){m.onBeforeCompile=s=>{s.vertexShader='varying vec3 wgP;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>','wgP=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>');s.fragmentShader='varying vec3 wgP;\nfloat wgHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.54);}\nfloat wgNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wgHash(i),wgHash(i+vec2(1,0)),f.x),mix(wgHash(i+vec2(0,1)),wgHash(i+vec2(1,1)),f.x),f.y);}\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nfloat broad=wgNoise(wgP.xz*.8+wgP.y*.15);float fine=wgNoise(vec2(wgP.x+wgP.z*.7,wgP.y)*7.);float seam=pow(max(0.,sin(wgP.y*3.8+wgNoise(wgP.xz*.25)*4.)),16.);diffuseColor.rgb*=.78+.21*broad+.13*fine-seam*.11;\n');};m.customProgramCacheKey=()=> 'windgate10-weathered-vault';}
 const cube=new THREE.BoxGeometry(1,1,1),stoneG=new THREE.DodecahedronGeometry(1,0);gs.add(cube);gs.add(stoneG);
 function add(g,m,p=[0,0,0],s=[1,1,1],rot=[0,0,0],solid=false,batch=true){gs.add(g);const o=new THREE.Mesh(g,m);o.position.set(...p);o.scale.set(...s);o.rotation.set(...rot);o.castShadow=o.receiveShadow=true;root.add(o);o.updateWorldMatrix(true,false);if(solid)island.addTrimesh(o);if(batch)staticMeshes.push(o);return o;}
 const box=(p,s,m=masonry,rot=[0,0,0],solid=false)=>add(cube,m,p,s,rot,solid);
 const toWorld=(r,l,y)=>[r.p.x+r.n.x*l,r.p.y+y,r.p.z+r.n.z*l];
 const pos=[],colors=[],uv=[],ix=[],width=3.60;
 for(let i=0;i<rows.length;i++){const r=rows[i];for(let j=0;j<=10;j++){const l=(j/10*2-1)*width,edge=Math.abs(l)/width;pos.push(...toWorld(r,l,-.01+edge*edge*.06));const shade=.58+.3*Math.abs(r.u-.5)*2;colors.push(shade,shade,shade);uv.push(j/10,r.u*18);if(i<rows.length-1&&j<10){const k=i*11+j;ix.push(k,k+1,k+11,k+1,k+12,k+11);}}}
 function geometry(p,c,u,i){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));if(c)g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));if(u)g.setAttribute('uv',new THREE.Float32BufferAttribute(u,2));g.setIndex(i);g.computeVertexNormals();return g;}
 const floor=add(geometry(pos,colors,uv,ix),floorMat,[0,0,0],[1,1,1],[0,0,0],true,false);floor.name='Vault continuous walkable floor';
 // Grounded shoulders join the floor ribbon to the exterior terrain at both mouths.
 const ap=[],ac=[];
 for(const [lo,hi] of [[0,24],[97,120]])for(let i=lo;i<hi;i++)for(const side of[-1,1]){
  const a=rows[i],b=rows[i+1],v=[];
  for(const r of[a,b]){const inner=toWorld(r,side*3.45,.025),outer=toWorld(r,side*5.1,0);outer[1]=field.height(outer[0],outer[2])+.022;v.push(inner,outer);}
  if(v[1][1]>a.p.y+.8||v[3][1]>b.p.y+.8)continue;
  for(const k of [0,2,1,1,2,3]){ap.push(...v[k]);const c=k%2?.9:.8;ac.push(c,c,c);}
 }
 const ag=new THREE.BufferGeometry();ag.setAttribute('position',new THREE.Float32BufferAttribute(ap,3));ag.setAttribute('color',new THREE.Float32BufferAttribute(ac,3));ag.computeVertexNormals();
 add(ag,floorMat,[0,0,0],[1,1,1],[0,0,0],true,false).name='Mouth embankments grounded into terrain';
 // Wider stone aprons hide the cut boundary and carry the original canyon surface into each opening.
 for(const ri of[0,rows.length-1]){
  const r=rows[ri],outDir=ri===0?-1:1,verts=[],inds=[];
  for(let k=0;k<=8;k++){
   const along=k*1.0*outDir;
   for(const side of[-1,1]){
    const lateral=side*(3.35+k*.23);
    const x=r.p.x+r.t.x*along+r.n.x*lateral,z=r.p.z+r.t.z*along+r.n.z*lateral;
    const fy=field.height(x,z),y=mix(r.p.y+.03,fy,clamp(k/8));
    verts.push(x,y,z);
   }
   if(k<8){const q=k*2;inds.push(q,q+2,q+1,q+1,q+2,q+3);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.setIndex(inds);g.computeVertexNormals();
  add(g,floorMat,[0,0,0],[1,1,1],[0,0,0],true,false).name='Canyon mouth seam apron';
  for(const side of[-1,1])for(let k=1;k<7;k+=2){
   const along=k*.95*outDir,lateral=side*(4.5+k*.18),x=r.p.x+r.t.x*along+r.n.x*lateral,z=r.p.z+r.t.z*along+r.n.z*lateral,y=field.height(x,z);
   add(stoneG,k%4?masonry:dark,[x,y+.18,z],[.7+k*.03,.42+.07*k,.85+k*.04],[.03,rnd()*6.28,.02],true);
  }
 }
 // Open-ended inward-facing rock shell clipped where it meets the exterior landscape.
 const wp=[],wc=[],wu=[],wi=[],cross=[[-3.52,-.32],[-3.52,2.2]];
 for(let j=1;j<20;j++){const a=j/20*Math.PI;cross.push([-3.52*Math.cos(a),2.2+3.09*Math.sin(a)]);}cross.push([3.52,2.2],[3.52,-.32]);
 for(let i=0;i<rows.length;i++){const r=rows[i];for(let j=0;j<cross.length;j++){const[l,y]=cross[j];const p=toWorld(r,l,y),shade=.38+.18*(Math.abs(l)/3.52)+.23*Math.abs(r.u-.5)*2;wp.push(...p);wc.push(shade,shade,shade);wu.push(j/cross.length,r.u*10);
  if(i<rows.length-1&&j<cross.length-1){const k=i*cross.length+j;wi.push(k,k+1,k+cross.length,k+1,k+cross.length+1,k+cross.length);}}}
 const inside=[];for(let i=0;i<wi.length;i+=3){const a=wi.slice(i,i+3),x=a.reduce((s,k)=>s+wp[k*3],0)/3,y=a.reduce((s,k)=>s+wp[k*3+1],0)/3,z=a.reduce((s,k)=>s+wp[k*3+2],0)/3;if(field.height(x,z)>y-.05 && !(vaultSample(x,z).u<.19 && field.nearPath(x,z).d<2.2))inside.push(...a);}
 // Clip complete wall triangles against terrain, preserving UVs and colour.
 function clippedShell(){const op=[],oc=[],ou=[];
  const point=k=>[...wp.slice(k*3,k*3+3),...wc.slice(k*3,k*3+3),...wu.slice(k*2,k*2+2)];
  const value=p=>{const q=vaultSample(p[0],p[2]);return Math.min(field.height(p[0],p[2])-p[1]+.055,Math.max(q.u-.19,field.nearPath(p[0],p[2]).d-2.6));};
  const lerp=(a,b,t)=>a.map((x,k)=>mix(x,b[k],t));
  for(let i=0;i<wi.length;i+=3){const tri=[point(wi[i]),point(wi[i+1]),point(wi[i+2])],poly=[];
   for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],fa=value(a),fb=value(b);if(fa>=0)poly.push(a);if((fa>=0)!==(fb>=0)){let lo=0,hi=1;for(let k=0;k<14;k++){const t=(lo+hi)/2;if((value(lerp(a,b,t))>=0)===(fa>=0))lo=t;else hi=t;}poly.push(lerp(a,b,(lo+hi)/2));}}
   for(let j=1;j<poly.length-1;j++)for(const p of[poly[0],poly[j],poly[j+1]]){op.push(...p.slice(0,3));oc.push(...p.slice(3,6));ou.push(...p.slice(6,8));}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(op,3));g.setAttribute('color',new THREE.Float32BufferAttribute(oc,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(ou,2));g.computeVertexNormals();return g;
 }
 const shell=add(clippedShell(),rock,[0,0,0],[1,1,1],[0,0,0],true,false);shell.name='Vault rock walls and actual ceiling';wallMeshes.push(shell);
 // Broken masonry ribs spaced at authored turns, not a sequence of identical doorways.
 for(const [ri,complete]of[[17,true],[41,false],[68,true],[99,false]]){const r=rows[ri],angle=Math.atan2(-r.n.z,r.n.x);for(const sign of[-1,1])for(let j=0;j<3;j++)box(toWorld(r,sign*3.18,.45+j*.7),[.5,.67,.8],j%2?masonry:dark,[0,angle,sign*.018],true);
  if(complete)for(let j=0;j<11;j++){const a=(j+.5)/11*Math.PI,l=-3.2*Math.cos(a),y=2.17+2.8*Math.sin(a),o=box(toWorld(r,l,y),[.83,.44,.7],masonry,[0,angle,0],false);o.rotateZ(Math.PI/2-a);o.updateWorldMatrix(true,false);island.addTrimesh(o);}
 }
 // Lanterns make the bend legible; no transparent screen-space doorway tricks.
 for(const[ri,side]of[[18,-1],[49,1],[77,-1],[104,1]]){const r=rows[ri],p=toWorld(r,side*2.9,1.85);box([p[0],p[1]-.17,p[2]],[.13,.6,.17],wood);box([p[0],p[1]+.2,p[2]],[.33,.45,.3],iron);const glow=mat('#ffdb8a',{emissive:'#ff9b37',emissiveIntensity:1.25});add(new THREE.SphereGeometry(.13,7,6),glow,[p[0],p[1]+.23,p[2]],[1,1.6,1],[0,0,0],false,false);const light=new THREE.PointLight('#ffc47b',12,12,1.5);light.position.set(p[0]-r.n.x*side*.4,p[1]+.35,p[2]-r.n.z*side*.4);root.add(light);lights.push(light);}
 // Entrance rock strata anchor the opening, but never put rocks on the centre line.
 for(const ri of[9,105]){const r=rows[ri];for(const sign of[-1,1])for(let j=0;j<4;j++){const l=sign*(4.25+j*.3),p=toWorld(r,l,1+j*1.18);if(p[1]>field.height(p[0],p[2])+.5)continue;add(stoneG,masonry,p,[1.05,1.1,1.4],[.04,ri*.1+j*.3,.05],true);}}
 // Fallen fragments sit only against walls, with a clear >5m central traversal envelope.
 for(let i=0;i<43;i++){const r=rows[10+Math.floor(rnd()*100)],side=rnd()<.5?-1:1,p=toWorld(r,side*(2.92+rnd()*.25),.06);add(stoneG,i%3?dark:masonry,p,[.12+rnd()*.2,.1,.19+rnd()*.18],[0,rnd()*6.28,0],false);}
 // Direction boards share a single atlas, face actual branches and sit outside the path.
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const c=canvas.getContext('2d');c.fillStyle='#66523a';c.fillRect(0,0,1024,512);
 const labels=['성소','광산','망루','해변','옛 순례굴','항구','협곡','옛길'];
 labels.forEach((label,i)=>{const x=i%2*512,y=Math.floor(i/2)*128;c.fillStyle=i%2?'#796247':'#695239';c.fillRect(x,y,512,128);c.strokeStyle='#433824';c.lineWidth=3;for(let j=0;j<8;j++){c.beginPath();c.moveTo(x+12,y+12+j*14);c.bezierCurveTo(x+160,y+j*14+20,x+310,y+j*14+5,x+500,y+12+j*14);c.stroke();}c.fillStyle='#eee0b2';c.font='600 58px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(label,x+247,y+66);});
 const atlas=new THREE.CanvasTexture(canvas);atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;ts.add(atlas);const signMat=mat('#fff',{map:atlas});
 function board(x,z,target,label,level){const y=field.height(x,z),dx=target[0]-x,dz=target[1]-z,angle=-Math.atan2(dz,dx),shape=new THREE.Shape();shape.moveTo(-.56,-.14);shape.lineTo(.40,-.14);shape.lineTo(.61,0);shape.lineTo(.40,.14);shape.lineTo(-.56,.14);shape.closePath();const g=new THREE.ExtrudeGeometry(shape,{depth:.075,bevelEnabled:true,bevelSize:.015,bevelThickness:.01,bevelSegments:1,steps:1});g.translate(0,0,-.038);const u=g.attributes.uv,p=g.attributes.position,idx=labels.indexOf(label);for(let i=0;i<u.count;i++){const xx=clamp((p.getX(i)+.56)/1.17),yy=clamp((p.getY(i)+.14)/.28);u.setXY(i,(idx%2+(p.getZ(i)<0?1-xx:xx))/2,1-(Math.floor(idx/2)+1-yy)/4);}add(g,signMat,[x,y+level,z],[1,1,1],[0,angle,0],false);signs.push({label,x,z,pointsTo:target,angle});}
 function sign(x,z,entries){const y=field.height(x,z);add(new THREE.CylinderGeometry(.067,.095,1.83,6),wood,[x,y+.83,z],[1,1,1],[0,0,.025],true);for(let i=0;i<entries.length;i++)board(x,z,entries[i][1],entries[i][0],1.47-i*.36);for(let i=0;i<4;i++){const a=i*1.7;add(stoneG,dark,[x+Math.cos(a)*.16,y-.015,z+Math.sin(a)*.16],[.19,.16,.18],[0,a,0]);}}
 sign(-55.5,28,[['광산',[-58,11]],['성소',[-44,22]]]);sign(34,-2.5,[['망루',[62,-6]],['해변',[55,14]]]);sign(-109,2.5,[['광산',[-107,-18]],['항구',[-102,11]]]);sign(-18.5,-72.5,[['옛 순례굴',[-11,-73]],['옛길',[-25,-83]]]);
 // Route-specific shoulders: short remnants, roots and fern patches instead of obstacles.
 const fern=new THREE.BufferGeometry(),fp=[];for(let i=0;i<7;i++){const a=i/7*Math.PI*2;fp.push(0,0,0,Math.cos(a)*.29,.18,Math.sin(a)*.29,Math.cos(a+.14)*.48,.25,Math.sin(a+.14)*.48);}fern.setAttribute('position',new THREE.Float32BufferAttribute(fp,3));fern.computeVertexNormals();gs.add(fern);
 let shoulders=0;
 for(let i=0;i<field.lines.length;i+=5){if(rnd()>.7)continue;const[a,b]=field.lines[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;for(const side of[-1,1]){const off=3.1+rnd()*1.2,x=a[0]-dz/len*side*off,z=a[1]+dx/len*side*off,y=field.height(x,z);
  if(y<6||field.slope(x,z)>.62||field.nearPath(x,z).d<2.8||vaultReserve(x,z,1)||BUILDINGS.some(b=>Math.hypot(x-b.x,z-b.z)<b.r+1)||BASINS.some(b=>basinRadius(b,x,z)<1.4)||fallAxes.some(a=>axisDistance(a,x,z).d<6))continue;
  const s=.65+rnd()*.55;add(fern,leafMat,[x,y+.02,z],[s,s,s],[0,rnd()*6.28,0],false);if(rnd()<.4)add(stoneG,masonry,[x+.18,y+.03,z],[.25,.1,.33],[0,rnd()*6.28,0],false);shoulders++;}}
 // Folded geological shoulders break the tall flat pass face without narrowing the trail.
 for(const[x,z]of[[-8,-69],[-2,-73],[-1,-79],[-15,-77],[-14,-85]]){const q=vaultSample(x,z);if(q.d<4.5||field.nearPath(x,z).d<4.8)continue;const y=field.height(x,z);for(let j=0;j<3;j++){const p=[x,y-.7+j*1.6,z];if(vaultSDF(...p)<1)continue;add(stoneG,masonry,p,[1.4,1.6,1.5],[.1,j*.17,.04],true);}}
 root.updateMatrixWorld(true);
 const groups=new Map();for(const o of staticMeshes){if(!groups.has(o.material))groups.set(o.material,[]);groups.get(o.material).push(o);}for(const[m,os]of groups){const temp=os.map(o=>{let g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});const g=mergeGeometries(temp,false);temp.forEach(g=>g.dispose());if(g){gs.add(g);os.forEach(o=>o.visible=false);const o=new THREE.Mesh(g,m);o.castShadow=o.receiveShadow=true;o.name='Vault and path dressing batch';root.add(o);}}
 for(const o of island.collide)if(!o.isInstancedMesh&&o.geometry?.computeBoundsTree&&!o.geometry.boundsTree)o.geometry.computeBoundsTree();
 // This sample adapter only retracts the camera when a physical wall is between it and the avatar.
 const ray=new THREE.Raycaster(),eye=new THREE.Vector3(),dir=new THREE.Vector3();ray.firstHitOnly=true;let cameraCorrections=0;
 const hook=ctx.onUpdate(()=>{if(!ctx.player?.third||new URLSearchParams(location.search).get('view')==='overview')return;const p=ctx.player.pos;if(!vaultReserve(p.x,p.z,8))return;eye.set(p.x,p.y+.45,p.z);dir.copy(ctx.camera.position).sub(eye);const length=dir.length();if(length<.2)return;ray.set(eye,dir.normalize());ray.far=length+.22;const hit=ray.intersectObjects(island.collide,true).find(h=>h.distance>.08);if(hit&&hit.distance<length+.15){ctx.camera.position.copy(eye).addScaledVector(dir,Math.max(.2,hit.distance-.24));cameraCorrections++;}});
 const previous=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;ctx.offUpdate(hook);root.removeFromParent();gs.forEach(g=>{g.disposeBoundsTree?.();g.dispose();});ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());previous();};
 island.qualityVersion='aurora-v12-portalback';island.vault={rows:rows.map(r=>r.p.toArray()),sample:vaultSample,cut:field.vaultCut,length:curve.getLength(),signs,shoulders,root,wallMeshes,get cameraCorrections(){return cameraCorrections;}};
 return island.vault;
}