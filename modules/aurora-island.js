/**
 * TOMOB · Aurora Island — additive terrain / exploration sandbox.
 * Three r160; same Rapier 0.14 and KayKit asset paths as tomob-game.
 * No production terrain, save, inventory, or world-streaming state is modified.
 * initAuroraIsland(ctx) exposes collide, groundAt, spawn and placementPoints.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SEA = 2, SIZE = 284, SEGMENTS = 200;
const clamp = (n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth = (a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const mix = (a,b,t)=>a+(b-a)*t;
const dist = (x,z,a,b)=>Math.hypot(x-a,z-b);
function random(seed=92725){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

/** Hand-authored route elevations, not random hills. All heights are metres. */
export function createIslandField(){
  const routes = [
    [[-48,86,4.4],[-43,66,6],[-29,47,8.5],[-10,36,11],[12,30,13],[34,16,17],[47,-8,21],[30,-25,27],[34,-44,32],[18,-59,38],[-4,-55,44],[-9,-39,46]],
    [[-26,44,9],[-43,30,10],[-33,15,11],[-30,4,11]],
    [[-64,4,11],[-74,-12,13],[-69,-32,17],[-57,-49,21]],
    [[32,17,17],[50,28,14],[64,27,11],[64,14,11],[64,0,11],[73,-18,16],[76,-31,21]],
    [[61,29,11],[78,39,8],[79,55,5],[67,66,4.5]],
    [[-9,35,11],[-3,16,15],[4,-1,18],[23,-16,24],[30,-25,27]],
  ];
  // Catmull-Rom in XZ, with monotone linear height interpolation to avoid overshoot.
  const lines=[];
  for(const route of routes){for(let i=0;i<route.length-1;i++){
    const a=route[Math.max(0,i-1)],b=route[i],c=route[i+1],d=route[Math.min(route.length-1,i+2)];
    let last=null;
    for(let j=0;j<=12;j++){
      const t=j/12, t2=t*t,t3=t2*t;
      const cm=k=>.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3);
      const p=[cm(0),cm(1),mix(b[2],c[2],t)];
      if(last)lines.push([last,p]);last=p;
    }
  }}
  const points=[
    {id:'landing',name:'달빛 선착장',sub:'여정의 시작',x:-48,z:78,y:5,r:10},
    {id:'falls',name:'안개폭포와 구름다리',sub:'물소리를 따라',x:-32,z:4,y:11,r:8},
    {id:'grove',name:'고요한 숲의 제단',sub:'나무 사이에 숨은 빛',x:-3,z:16,y:15,r:7},
    {id:'cave',name:'청금석 동굴',sub:'절벽 안쪽의 샛길',x:64,z:14,y:11,r:7},
    {id:'lookout',name:'동쪽 바람 전망대',sub:'수평선 너머를 바라보다',x:76,z:-31,y:21,r:8},
    {id:'shrine',name:'바람의 고리',sub:'섬의 가장 높은 약속',x:-9,z:-39,y:46,r:13},
    {id:'cove',name:'숨겨진 조개 만',sub:'길 끝에서 발견한 작은 보상',x:67,z:66,y:4.5,r:7},
  ];
  const nearPath=(x,z)=>{
    let dd=1e10,y=0;
    for(const [a,b] of lines){const dx=b[0]-a[0],dz=b[1]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1));
      const d=(x-a[0]-dx*t)**2+(z-a[1]-dz*t)**2;
      if(d<dd){dd=d;y=mix(a[2],b[2],t);}
    } return {d:Math.sqrt(dd),y};
  };
  function boundary(x,z){const a=Math.atan2(z/103,x/114);return Math.hypot(x/114,z/103)/(1+.075*Math.sin(a*3+.3)+.053*Math.cos(a*5-1)+.022*Math.sin(a*9));}
  function raw(x,z){
    const r=boundary(x,z), noise=Math.sin(x*.087+Math.cos(z*.04))*Math.cos(z*.07)*1.1+Math.sin(x*.19+z*.125)*.4;
    let y=-5+10*smooth(1.11,.90,r)+7*smooth(.91,.65,r)+noise*smooth(.97,.78,r);
    y+=10*smooth(70,35,dist(x,z,0,-23));
    const peak=dist(x,z,-9,-39);
    y+=12*smooth(45,35,peak)+13*smooth(29,24,peak);
    y+=10*smooth(25,15,dist(x,z,76,-31));
    y+=8*smooth(26,16,dist(x,z,-57,-49));
    // Lagoon cut; water is a separate non-solid surface. A real collidable bridge crosses it.
    const pool=Math.hypot((x+49)/18,(z-1)/20);
    y=mix(y,5.0+noise*.12,1-smooth(.72,1.12,pool));
    // Carved cave corridor, covered by separate rock geometry (not a heightmap "hole").
    const corridor=(1-smooth(4.6,8.0,Math.abs(x-64)))*(1-smooth(15,20,Math.abs(z-13)));
    y=mix(y,11,corridor);
    for(const p of points){y=mix(y,p.y,1-smooth(p.r*.72,p.r+3,dist(x,z,p.x,p.z)));}
    const path=nearPath(x,z);
    y=mix(y,path.y,1-smooth(2.4,6.7,path.d));
    return {y,r,path:path.d};
  }
  // Rendering, placement and collision share the exact same sampled vertices.
  const heights=new Float32Array((SEGMENTS+1)**2), paths=new Float32Array(heights.length);
  for(let iz=0;iz<=SEGMENTS;iz++)for(let ix=0;ix<=SEGMENTS;ix++){
    const i=iz*(SEGMENTS+1)+ix,s=raw((ix/SEGMENTS-.5)*SIZE,(iz/SEGMENTS-.5)*SIZE);heights[i]=s.y;paths[i]=s.path;
  }
  function height(x,z){
    const fx=(x/SIZE+.5)*SEGMENTS,fz=(z/SIZE+.5)*SEGMENTS;
    if(fx<0||fz<0||fx>=SEGMENTS||fz>=SEGMENTS)return -5;
    const ix=Math.floor(fx),iz=Math.floor(fz),u=fx-ix,v=fz-iz,i=iz*(SEGMENTS+1)+ix;
    const a=heights[i],b=heights[i+1],c=heights[i+SEGMENTS+1],d=heights[i+SEGMENTS+2];
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  function slope(x,z){return Math.hypot(height(x+.7,z)-height(x-.7,z),height(x,z+.7)-height(x,z-.7))/1.4;}
  return {heights,paths,height,slope,nearPath,boundary,points,routes,lines};
}

export async function initAuroraIsland(ctx,options={}){
  const {scene}=ctx, R=ctx.RAPIER,world=ctx.world;
  if(!scene)throw new Error('initAuroraIsland requires ctx.scene');
  if(options.registerTerrain!==false && ctx.terrain)throw new Error('Use a fresh scene or registerTerrain:false; existing terrain is never silently replaced.');
  const root=new THREE.Group();root.name='TOMOB_Aurora_Island';scene.add(root);
  const field=createIslandField(), rng=random(), bodies=[],collide=[],placements=[], animated=[];
  const assets={trees:0,rocks:0,fallback:0,errors:[]};
  const time={value:0};
  const color=n=>new THREE.Color(n);
  const materials={grass:new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,flatShading:true}),
    rock:new THREE.MeshStandardMaterial({color:0x819593,roughness:.96,flatShading:true}),
    wood:new THREE.MeshStandardMaterial({color:0x806044,roughness:.9}),
    darkwood:new THREE.MeshStandardMaterial({color:0x4b4033,roughness:1}),
    stone:new THREE.MeshStandardMaterial({color:0xd4cfb5,roughness:.93,flatShading:true}),
    gold:new THREE.MeshStandardMaterial({color:0xc3a45c,metalness:.45,roughness:.47}),
    crystal:new THREE.MeshStandardMaterial({color:0x73e9dc,emissive:0x12847e,emissiveIntensity:.6,metalness:.25,roughness:.25}),
    foliage:new THREE.MeshStandardMaterial({color:0x3d7855,roughness:1,flatShading:true})};
  function fixed(desc){if(!world||!R)return null;const c=world.createCollider(desc);bodies.push(c);return c;}
  function mesh(g,m,x,y,z,s=[1,1,1],solid=false){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.scale.set(...s);o.castShadow=true;o.receiveShadow=true;root.add(o);if(solid)addTrimesh(o);return o;}
  function addTrimesh(o){o.updateMatrixWorld(true);const p=o.geometry.attributes.position,arr=new Float32Array(p.count*3),v=new THREE.Vector3();
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);arr.set([v.x,v.y,v.z],i*3);}
    const idx=o.geometry.index?new Uint32Array(o.geometry.index.array):Uint32Array.from({length:p.count},(_,i)=>i);
    if(R)fixed(R.ColliderDesc.trimesh(arr,idx));collide.push(o);return o;
  }
  const positions=[],colors=[],uvs=[],indices=[],sand=color('#e6d7a0'),grass=color('#7c9c56'),lightgrass=color('#a5b764'),stone=color('#a4aaa0'),soil=color('#c6b180');
  for(let iz=0;iz<=SEGMENTS;iz++)for(let ix=0;ix<=SEGMENTS;ix++){
    const i=iz*(SEGMENTS+1)+ix,x=(ix/SEGMENTS-.5)*SIZE,z=(iz/SEGMENTS-.5)*SIZE,y=field.heights[i];
    positions.push(x,y,z);uvs.push(ix/SEGMENTS,iz/SEGMENTS);
    const sl=field.slope(x,z),v=(Math.sin(x*.16+z*.22)+Math.cos(z*.13-x*.07))*.25+.5;
    const c=grass.clone().lerp(lightgrass,clamp(v)*.72);
    if(y<6.3)c.copy(sand).lerp(grass,smooth(5.1,7,y));
    c.lerp(stone,smooth(.48,1.22,sl)*.98);
    if(field.paths[i]<2.5&&y>4)c.lerp(soil,(1-smooth(1.65,2.65,field.paths[i]))*.87);
    c.multiplyScalar(.94+.06*Math.sin(x*.77+z*.43));colors.push(c.r,c.g,c.b);
    if(ix<SEGMENTS&&iz<SEGMENTS){const a=i,b=i+1,c0=i+SEGMENTS+1,d=c0+1;indices.push(a,c0,b,b,c0,d);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
  const land=mesh(geo,materials.grass,0,0,0);land.name='Aurora terrain / collision SSOT';addTrimesh(land);
  // Terrain depth texture drives the shallow-water colour and shoreline foam.
  const depthData=new Uint8Array((SEGMENTS+1)**2*4);
  for(let i=0;i<field.heights.length;i++){const h=Math.round(clamp((field.heights[i]+8)/64)*255);depthData.set([h,h,h,255],i*4);}
  const depth=new THREE.DataTexture(depthData,SEGMENTS+1,SEGMENTS+1);depth.magFilter=depth.minFilter=THREE.LinearFilter;depth.needsUpdate=true;
  const oceanMaterial=new THREE.ShaderMaterial({uniforms:{t:time,depthMap:{value:depth},sunset:{value:0}},
    vertexShader:`uniform float t;varying vec3 p;void main(){p=position;vec3 q=position;q.y+=.14*sin(q.x*.065+t*.7)+.1*sin(q.z*.095+t*.5);gl_Position=projectionMatrix*modelViewMatrix*vec4(q,1.);}`,
    fragmentShader:`uniform float t;uniform sampler2D depthMap;uniform float sunset;varying vec3 p;void main(){vec2 uv=p.xz/${SIZE.toFixed(1)}+.5;float h=-8.+texture2D(depthMap,clamp(uv,0.,1.)).r*64.;float d=max(0.,${SEA.toFixed(1)}-h);float shallow=exp(-d*.36);vec3 c=mix(vec3(.035,.285,.43),vec3(.13,.72,.68),shallow);float a=sin(p.x*.73+sin(p.z*.31+t*.6)*2.+t*.7);float b=sin(p.z*.91+cos(p.x*.22-t*.5)*2.);float caustic=pow(max(0.,1.-abs(a+b)),9.);c+=vec3(.15,.24,.19)*caustic*shallow;float ripple=sin(p.x*.14+p.z*.08+t*.8)*sin(p.z*.12-p.x*.055+t*.55);c+=ripple*.025;float foam=(1.-smoothstep(.05,1.7,d))*(.5+.5*sin(d*10.-t*1.8+sin(p.x*.4+p.z*.25)));foam*=smoothstep(-.4,.5,d);c=mix(c,vec3(.84,.96,.87),foam*.63);c=mix(c,c*vec3(1.19,.88,.83),sunset*.65);gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>}`});
  const og=new THREE.PlaneGeometry(1800,1800,96,96);og.rotateX(-Math.PI/2);const ocean=mesh(og,oceanMaterial,0,SEA,0);ocean.castShadow=false;ocean.receiveShadow=false;ocean.renderOrder=0;
  const rockG=new THREE.DodecahedronGeometry(1,0),cube=new THREE.BoxGeometry(1,1,1);
  function box(x,y,z,s,mat=materials.wood,solid=false){return mesh(cube,mat,x,y,z,s,solid);}
  function beam(a,b,r=.1,mat=materials.darkwood){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av);const o=mesh(new THREE.CylinderGeometry(r,r,d.length(),5),mat,...av.clone().add(bv).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
  // Angular cliff buttresses, kept out of walkable paths.
  const cliffs=[];
  for(let i=0;i<2600&&cliffs.length<190;i++){const x=(rng()-.5)*226,z=(rng()-.5)*208,y=field.height(x,z);if(y<8||field.slope(x,z)<.7||field.nearPath(x,z).d<7||dist(x,z,64,13)<13)continue;cliffs.push({x,y:y-2.7,z,s:[2+rng()*3,4+rng()*4,2+rng()*2],rot:rng()*6.28});}
  function instances(g,mat,items){if(!items.length)return null;const im=new THREE.InstancedMesh(g,mat,items.length),o=new THREE.Object3D();for(let i=0;i<items.length;i++){const p=items[i];o.position.set(p.x,p.y,p.z);o.rotation.set(p.rx||0,p.rot||0,p.rz||0);o.scale.set(...p.s);o.updateMatrix();im.setMatrixAt(i,o.matrix);if(p.color)im.setColorAt(i,color(p.color));}im.castShadow=true;im.receiveShadow=true;im.computeBoundingSphere();root.add(im);return im;}
  instances(rockG,materials.rock,cliffs);
  // Driftwood dock and boat: a low, usable landing, not a floating prop.
  for(let i=0;i<23;i++)box(-48,4.15,85+i*.65,[6,.3,.57],i%3?materials.wood:materials.darkwood,true);
  for(const x of [-51, -45])for(const z of [86,92,99]){box(x,3,z,[.35,6,.35]);box(x,6.1,z,[.5,.25,.5],materials.gold);}
  for(let i=0;i<3;i++)box(-50.1,4.9+i*.02,86+i*1.2,[1.1,1.2,1],materials.wood,true);
  const boat=mesh(new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2),materials.wood,-42,2.65,95,[1.6,.9,3.2]);boat.rotation.z=Math.PI;
  beam([-42,2.2,95],[-42,9,95],.09);const sail=mesh(new THREE.PlaneGeometry(2.5,4),new THREE.MeshStandardMaterial({color:0xf1e8bf,side:THREE.DoubleSide,roughness:1}),-40.8,6.8,95);sail.rotation.y=.3;
  // Real bridge deck. Its collider is a continuous ribbon; individual planks are visual.
  const bridgeTop=x=>11.3-1.0*Math.sin(clamp((x+64)/34)*Math.PI);
  const bp=[],bi=[];
  for(let i=0;i<=42;i++){const x=-64+i*34/42,y=bridgeTop(x);bp.push(x,y,-.0,x,y,8);if(i<42){const k=i*2;bi.push(k,k+1,k+2,k+1,k+3,k+2);}if(i<42)box(x,y-.13,4,[.71,.24,7.5],i%4?materials.wood:materials.darkwood);}
  const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(bp,3));bg.setIndex(bi);bg.computeVertexNormals();const bridge=mesh(bg,new THREE.MeshStandardMaterial({visible:false}),0,0,0);addTrimesh(bridge);
  for(const z of [.3,7.7]){for(let i=0;i<=10;i++){const x=-64+3.4*i,y=bridgeTop(x);beam([x,y,z],[x,y+2,z],.12);if(i<10)beam([x,y+1.8,z],[x+3.4,bridgeTop(x+3.4)+1.8,z],.08);}}
  // Still turquoise lagoon and two falling veils, with lightweight mist particles.
  const pool=mesh(new THREE.CircleGeometry(17,48),new THREE.MeshStandardMaterial({color:0x43bbb4,metalness:.3,roughness:.26,transparent:true,opacity:.85}),-49,8.1,1,[1,1.18,1]);pool.rotation.x=-Math.PI/2;pool.castShadow=false;
  const fallMat=new THREE.ShaderMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false,uniforms:{t:time},vertexShader:`varying vec2 u;void main(){u=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 u;uniform float t;void main(){float stripe=.5+.5*sin(u.x*95.+sin(u.y*17.+t*3.));float streak=.5+.5*sin(u.y*65.+t*8.+u.x*7.);float edge=smoothstep(0.,.12,u.x)*(1.-smoothstep(.88,1.,u.x));gl_FragColor=vec4(mix(vec3(.40,.84,.83),vec3(.94,1.,.95),.4+stripe*.35+streak*.12),edge*.79);}`});
  mesh(new THREE.PlaneGeometry(6,24,4,12),fallMat,-43,20,-16).rotation.y=-.08;
  mesh(new THREE.PlaneGeometry(2.5,17,2,8),fallMat,-51,16.5,-17).rotation.y=.17;
  const mistPos=[];for(let i=0;i<90;i++)mistPos.push(-47+(rng()-.5)*12,8.7+rng()*4,-13+rng()*8);
  const mg=new THREE.BufferGeometry();mg.setAttribute('position',new THREE.Float32BufferAttribute(mistPos,3));const mist=new THREE.Points(mg,new THREE.PointsMaterial({color:0xd8fff4,size:.6,transparent:true,opacity:.38,depthWrite:false}));root.add(mist);
  // Summit: broken crescent arch, stone terraces and a suspended heart.
  const shrine=field.points.find(p=>p.id==='shrine'),sy=field.height(shrine.x,shrine.z);
  for(let i=0;i<3;i++)mesh(new THREE.CylinderGeometry(10-i*.7,10.6-i*.7,.32,32),materials.stone,-9,sy+.16+i*.3,-39,[1,1,1],true);
  for(let i=0;i<24;i++){if(i>9&&i<14)continue;const a=(i/24)*Math.PI*2+.07;const o=box(-9+Math.cos(a)*7.1,sy+8.5+Math.sin(a)*7.1,-41,[1.65,1.8,1.65],materials.stone,true);o.rotation.z=a;}
  for(const x of [-21,3])for(const z of [-31,-48]){const h=3+rng()*3;mesh(new THREE.CylinderGeometry(.65,.95,h,7),materials.stone,x,field.height(x,z)+h/2,z,[1,1,1],true);box(x,field.height(x,z)+h,z,[2,.5,2],materials.stone);}
  const heart=mesh(new THREE.OctahedronGeometry(1.4),materials.crystal,-9,sy+5,-38);animated.push(t=>{heart.rotation.y=t*.35;heart.position.y=sy+5+Math.sin(t)*.22;});
  const ring=mesh(new THREE.TorusGeometry(2,.035,6,48),materials.gold,-9,sy+5,-38);ring.rotation.x=Math.PI/2;
  // Small forest altar rewards the short uphill branch.
  const ay=field.height(-3,16);mesh(new THREE.CylinderGeometry(3.3,3.7,.4,8),materials.stone,-3,ay+.2,16,[1,1,1],true);
  for(let i=0;i<5;i++){const a=i*Math.PI*2/5;mesh(new THREE.CylinderGeometry(.24,.4,2.6,5),materials.stone,-3+Math.sin(a)*2.7,ay+1.5,16+Math.cos(a)*2.7);}
  const aCrystal=mesh(new THREE.OctahedronGeometry(.85),materials.crystal,-3,ay+2,16);animated.push(t=>{aCrystal.rotation.y=-t*.45;});
  // A genuinely passable cave: two side walls + high roof, open at both ends.
  for(const z of [5,12,19])for(const x of [58.6,69.4])mesh(rockG,materials.rock,x,13.2,z,[2.5,4.4,4.6],true);
  for(const z of [5,12,19])mesh(rockG,materials.rock,64,17.7,z,[7,2.7,4.8],true);
  for(let i=0;i<9;i++){const a=i/8*Math.PI;mesh(rockG,materials.stone,64+Math.cos(a)*4.8,11+Math.sin(a)*6,24,[1.4,1.55,1.25],true);}
  for(let i=0;i<15;i++){const x=59.5+rng()*1.4,z=4+rng()*17;mesh(new THREE.ConeGeometry(.3+rng()*.35,1.5+rng()*1.3,5),materials.crystal,x,12,z);}
  const caveLight=new THREE.PointLight(0x5af0da,12,16,1.8);caveLight.position.set(64,13.5,13);root.add(caveLight);
  // Lookout: accessible deck, low stairs, slender poles and a cloth roof.
  const ly=field.height(76,-31);
  for(let i=0;i<4;i++)box(76,ly+.2+i*.25,-23-i*.8,[4,.4+i*.5,1],materials.wood,true);
  box(76,ly+1,-31,[9,.35,9],materials.wood,true);
  for(const x of [72,80])for(const z of [-27,-35])beam([x,ly-1,z],[x,ly+7,z],.18);
  for(const x of [71.7,80.3])for(let i=0;i<5;i++)beam([x,ly+1,-35+i*2],[x,ly+2.8,-35+i*2],.085);
  const roof=mesh(new THREE.ConeGeometry(7.5,3,4),new THREE.MeshStandardMaterial({color:0x397f87,roughness:1}),76,ly+7,-31,[1,1,.82]);roof.rotation.y=Math.PI/4;
  beam([79,ly+5,-33],[79,ly+11,-33],.09);
  const flag=mesh(new THREE.PlaneGeometry(2.7,1.35,8,1),new THREE.MeshStandardMaterial({color:0xe8c777,side:THREE.DoubleSide}),80.35,ly+10,-33);const fp=flag.geometry.attributes.position;const fo=fp.array.slice();animated.push(t=>{for(let i=0;i<fp.count;i++)fp.setZ(i,Math.sin(fo[i*3]*2-t*3)*.2*(fo[i*3]/2.7+.5));fp.needsUpdate=true;});
  // Hidden beach cache, and offshore stacks give the island a distinct outline.
  const cy=field.height(67,66);box(67,cy+.55,66,[1.8,1,1.1],materials.wood,true);box(67,cy+1.1,66,[1.9,.2,1.2],materials.gold);
  for(const [x,z,h] of [[-112,-54,18],[-122,-70,25],[119,14,19],[109,83,12],[-101,72,13]]){mesh(rockG,materials.rock,x,h*.34,z,[6,h*.7,7],true);mesh(rockG,materials.foliage,x,h*.87,z,[4,1.5,4]);}
  // Existing asset placement is deterministic and excludes paths, steep slopes, POIs, pool and cave.
  const groups=[[],[],[],[]];
  for(let n=0;n<6500&&placements.filter(p=>p.type==='tree').length<250;n++){
    const x=(rng()-.5)*213,z=(rng()-.5)*187,y=field.height(x,z),path=field.nearPath(x,z).d;
    if(y<7||field.slope(x,z)>.48||path<5.3||field.points.some(p=>dist(x,z,p.x,p.z)<p.r+3)||dist(x,z,-49,1)<23||dist(x,z,64,13)<15)continue;
    if(placements.some(p=>dist(x,z,p.x,p.z)<3.6))continue;
    const h=5.5+rng()*6,kind=Math.floor(rng()*4),p={type:'tree',x,y,z,s:[h,h,h],rot:rng()*6.28,kind};groups[kind].push(p);placements.push(p);
    if(R)fixed(R.ColliderDesc.cylinder(h*.35,.32).setTranslation(x,y+h*.35,z));
  }
  const assetRoot=options.assetRoot||new URL('../',import.meta.url).href;
  const gl=new GLTFLoader();
  async function loadPrototype(url,target='height'){
    const g=await gl.loadAsync(new URL(url,assetRoot).href);g.scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(g.scene),size=bounds.getSize(new THREE.Vector3()),scale=1/(target==='height'?size.y:Math.max(size.x,size.y,size.z));
    const parts=[];g.scene.traverse(o=>{if(o.isMesh){const geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);geo.translate(-bounds.getCenter(new THREE.Vector3()).x,-bounds.min.y,-bounds.getCenter(new THREE.Vector3()).z);geo.scale(scale,scale,scale);const mat=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();for(const m of Array.isArray(mat)?mat:[mat]){m.side=THREE.FrontSide;if(m.map)m.map.colorSpace=THREE.SRGBColorSpace;}parts.push({geo,mat});}});return parts;
  }
  // Immediate attractive stand-ins; replaced atomically when the existing KayKit models load.
  const fallbackMeshes=[];
  for(let k=0;k<4;k++){
    const g=groups[k],trunks=g.map(p=>({...p,y:p.y+p.s[1]*.24,s:[p.s[1]*.035,p.s[1]*.48,p.s[1]*.035]}));
    fallbackMeshes.push(instances(new THREE.CylinderGeometry(1,1.2,1,6),materials.wood,trunks));
    const foliage=new THREE.MeshStandardMaterial({color:[0x316550,0x518052,0x729449,0xb2a050][k],roughness:1,flatShading:true});
    for(let tier=0;tier<3;tier++){const items=g.map(p=>({...p,y:p.y+p.s[1]*(.48+tier*.18),s:[p.s[1]*(.25-tier*.055),p.s[1]*.52,p.s[1]*(.25-tier*.055)]}));fallbackMeshes.push(instances(new THREE.ConeGeometry(1,1,7),foliage,items));}
  }
  assets.fallback=placements.length;
  const treeNames=['Tree_1_A','Tree_2_A','Tree_3_B','Tree_4_A'];
  const loadAssets=Promise.all(treeNames.map(async(name,k)=>{
    try{const parts=await loadPrototype(`kaykit_nature/${name}_Color1.gltf`);for(const p of parts)instances(p.geo,p.mat,groups[k]);for(let i=k*4;i<k*4+4;i++)if(fallbackMeshes[i])fallbackMeshes[i].visible=false;assets.trees+=groups[k].length;assets.fallback-=groups[k].length;}
    catch(e){assets.errors.push(name+': '+e.message);}
  }));
  const stones=[];for(let i=0;i<500&&stones.length<65;i++){const x=(rng()-.5)*208,z=(rng()-.5)*184,y=field.height(x,z);if(y<5||field.slope(x,z)>.5||field.nearPath(x,z).d<4.8||field.points.some(p=>dist(x,z,p.x,p.z)<p.r+1))continue;const s=.7+rng()*1.7;stones.push({x,y:y+.1,z,s:[s,s*.75,s],rot:rng()*6.28});if(R)fixed(R.ColliderDesc.ball(s*.45).setTranslation(x,y+s*.35,z));placements.push({type:'rock',x,y,z});}
  const stoneStandins=instances(rockG,materials.rock,stones);
  const loadRock=loadPrototype('kaykit_nature/Rock_1_A_Color1.gltf','max').then(parts=>{for(const p of parts)instances(p.geo,p.mat,stones);stoneStandins.visible=false;assets.rocks=stones.length;}).catch(e=>assets.errors.push('Rock: '+e.message));
  // Small grass tufts / warm wildflowers; instanced rather than hundreds of objects.
  const flowers=[];for(let i=0;i<2200;i++){const x=(rng()-.5)*218,z=(rng()-.5)*190,y=field.height(x,z);if(y<7||field.slope(x,z)>.48||field.nearPath(x,z).d<2.8||dist(x,z,-49,1)<21)continue;const s=.12+rng()*.15;flowers.push({x,y:y+.12,z,s:[s,s,s],color:rng()<.72?'#efdaa0':'#aaa8cf'});}
  instances(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),flowers);
  // Merge static decoration by material. Collider meshes remain hidden raycast proxies.
  root.updateMatrixWorld(true);
  const dynamic=new Set([land,ocean,pool,heart,aCrystal,flag]);
  const batches=new Map();
  for(const o of [...root.children]){
    if(!o.isMesh||o.isInstancedMesh||dynamic.has(o)||!o.visible||o.material.visible===false||o.material.transparent||o.material.isShaderMaterial||Array.isArray(o.material))continue;
    if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material).push(o);
  }
  for(const [mat,objects] of batches){if(objects.length<3)continue;
    const geos=objects.map(o=>{let g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);for(const key of Object.keys(g.attributes))if(!['position','normal','uv'].includes(key))g.deleteAttribute(key);if(!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(g.attributes.position.count*2),2));return g;});
    const merged=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());if(merged){objects.forEach(o=>o.visible=false);const m=new THREE.Mesh(merged,mat);m.castShadow=true;m.receiveShadow=true;m.name='Aurora static batch';root.add(m);}
  }
  root.updateMatrixWorld(true);
  const spawn={x:-48,y:field.height(-48,78)+1.2,z:78};
  const api={root,collide,spawn,field,assets,placementPoints:placements,data:{name:'바람의 유적섬 · 중형',objs:[]},offset:{x:0,z:0},_allObjs:[root],
    groundAt:(x,z)=>{if(x>=-64&&x<=-30&&z>=0&&z<=8)return Math.max(field.height(x,z),bridgeTop(x));return field.height(x,z);},
    addTrimesh,ready:Promise.all([loadAssets,loadRock]),update:t=>{time.value=t;for(const f of animated)f(t);},
    setSunset:v=>{oceanMaterial.uniforms.sunset.value=v;},
    dispose:()=>{for(const c of bodies)if(world)world.removeCollider(c,true);scene.remove(root);const gs=new Set(),ms=new Set(),ts=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());depth.dispose();}
  };
  if(options.registerTerrain!==false){if(ctx.terrain&&ctx.terrain!==api)throw new Error('Use a fresh scene or registerTerrain:false; existing terrain is never silently replaced.');ctx.terrain=api;}
  return api;
}

export async function launchIslandLab({assetRoot}={}){
  const $=s=>document.querySelector(s),state={mode:'overview',found:new Set(),errors:[],night:false,photo:false,physics:false,character:'fallback',time:0};
  const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;$('#viewport').appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#b9d7d8');scene.fog=new THREE.Fog('#b9d7d8',235,820);
  const camera=new THREE.PerspectiveCamera(43,innerWidth/innerHeight,.15,1400);camera.position.set(194,162,231);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,15,0);controls.enableDamping=true;controls.dampingFactor=.06;controls.minDistance=22;controls.maxDistance=460;controls.maxPolarAngle=Math.PI*.48;controls.autoRotate=false;controls.update();
  const hemi=new THREE.HemisphereLight(0xe8f5ff,0x62764c,2.2);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffefcf,3.2);sun.position.set(-120,180,105);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-145,right:145,top:145,bottom:-145,near:1,far:450});sun.shadow.normalBias=.2;sun.shadow.bias=-.00015;scene.add(sun);scene.add(sun.target);
  const rim=new THREE.DirectionalLight(0x9fdbe0,.7);rim.position.set(120,70,-70);scene.add(rim);
  const ctx={THREE,scene,camera,renderer};
  $('#loading-note').textContent='해안선과 탐험길을 만드는 중';
  let R=null,world=null;
  try{const mod=await import('https://esm.sh/@dimforge/rapier3d-compat@0.14.0');R=mod.default;await R.init();world=new R.World({x:0,y:-22,z:0});ctx.RAPIER=R;ctx.world=world;state.physics=true;}
  catch(e){state.errors.push('물리 엔진을 불러오지 못했습니다: '+e.message);$('#play').disabled=true;}
  const island=await initAuroraIsland(ctx,{assetRoot});
  const keys=new Set();let controller=null,body=null,capsule=null,velocityY=0,onGround=false,yaw=0,pitch=.25,moving=false,mouseDown=false,frame=0,accumulator=0,last=performance.now(),fpsT=0,fpsFrames=0;
  const avatar=new THREE.Group();scene.add(avatar);const fallback=new THREE.Group();avatar.add(fallback);
  const capsuleMesh=new THREE.Mesh(new THREE.CapsuleGeometry(.32,.9,4,8),new THREE.MeshStandardMaterial({color:0x275b69}));capsuleMesh.position.y=.95;fallback.add(capsuleMesh);const head=new THREE.Mesh(new THREE.SphereGeometry(.25,12,8),new THREE.MeshStandardMaterial({color:0xe5bf90}));head.position.y=1.75;fallback.add(head);
  avatar.position.set(island.spawn.x,island.spawn.y-.9,island.spawn.z);
  let mixer=null,actions={},action=null;
  if(R){body=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(island.spawn.x,island.spawn.y,island.spawn.z));capsule=world.createCollider(R.ColliderDesc.capsule(.55,.32),body);controller=world.createCharacterController(.025);controller.enableAutostep(.45,.25,false);controller.enableSnapToGround(.5);controller.setMaxSlopeClimbAngle(Math.PI/3.5);controller.setMinSlopeSlideAngle(Math.PI/3);world.step();}
  const base=assetRoot||new URL('../',import.meta.url).href,loader=new GLTFLoader();
  const characterReady=(async()=>{try{const gltf=await loader.loadAsync(new URL('KayKit_Adventurers_2.0_FREE/Characters/gltf/Ranger.glb',base).href);const model=gltf.scene,b=new THREE.Box3().setFromObject(model),h=b.getSize(new THREE.Vector3()).y;model.scale.setScalar(1.9/h);model.position.y=-b.min.y*model.scale.x;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});avatar.add(model);fallback.visible=false;state.character='KayKit Ranger';mixer=new THREE.AnimationMixer(model);
    const animations=await Promise.all(['Rig_Medium_General.glb','Rig_Medium_MovementBasic.glb'].map(n=>loader.loadAsync(new URL('KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/'+n,base).href).catch(()=>null)));
    const clips=animations.filter(Boolean).flatMap(g=>g.animations);for(const [key,pattern] of [['idle',/^Idle$/i],['walk',/^Walking_A$/i],['run',/^Running_A$/i]]){const clip=clips.find(c=>pattern.test(c.name))||clips.find(c=>c.name.toLowerCase().includes(key==='idle'?'idle':key==='walk'?'walk':'run'));if(clip)actions[key]=mixer.clipAction(clip);}actions.idle?.play();action=actions.idle;
  }catch(e){state.errors.push('캐릭터는 대체 모델로 표시 중: '+e.message);}})();
  const discovered=$('#discovered'),notification=$('#notification'),controlsNote=$('#controls-note'),map=$('#minimap'),mapCtx=map.getContext('2d');
  const mapBg=document.createElement('canvas');mapBg.width=mapBg.height=200;const mc=mapBg.getContext('2d'),image=mc.createImageData(200,200);
  for(let j=0;j<200;j++)for(let i=0;i<200;i++){const x=(i/200-.5)*260,z=(j/200-.5)*260,h=island.field.height(x,z),k=(j*200+i)*4;let c=h<2?[36,91,103]:h<6?[200,187,139]:[96+h*1.4,121+h*.8,83+h*.4];image.data.set([...c,255],k);}mc.putImageData(image,0,0);
  const locations=$('#locations');for(const p of island.field.points){const b=document.createElement('button');b.className='location';b.dataset.id=p.id;b.innerHTML=`<span class="location-dot"></span><span>${p.name}</span><span class="location-arrow">↗</span>`;b.onclick=()=>{if(state.mode==='walk')teleport(p.x,p.z);else{controls.target.set(p.x,p.y+2,p.z);camera.position.set(p.x+34,p.y+31,p.z+43);controls.update();}};locations.appendChild(b);}
  function toast(text){notification.textContent=text;notification.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>notification.classList.remove('show'),3400);}
  function teleport(x,z){const y=island.groundAt(x,z)+1.0;velocityY=0;avatar.position.set(x,y-.87,z);if(body){body.setTranslation({x,y,z},true);body.setNextKinematicTranslation({x,y,z});world.step();}yaw=0;}
  function mode(walk){if(walk&&!state.physics){toast('물리 엔진 로딩에 실패했습니다. 새로고침 후 다시 시도해 주세요.');return;}state.mode=walk?'walk':'overview';controls.enabled=!walk;$('#play').textContent=walk?'섬 전체 보기  ↗':'직접 탐험하기  ↗';$('#mode-label').textContent=walk?'EXPLORING':'ISLAND STUDY  /  01';controlsNote.textContent=walk?'W A S D 이동 · 우클릭 드래그 시점 · Shift 달리기 · Space 점프 · F 전체 보기':'드래그 회전 · 휠 확대 · 오른쪽 목록으로 장소 살펴보기';$('#crosshair').hidden=!walk;document.body.classList.toggle('walking',walk);if(walk){yaw=0;pitch=.27;}else{camera.position.set(194,162,231);controls.target.set(0,15,0);controls.update();}}
  $('#play').onclick=()=>mode(state.mode!=='walk');$('#reset').onclick=()=>{teleport(-48,78);mode(true);};
  $('#lighting').onclick=()=>{state.night=!state.night;$('#lighting').textContent=state.night?'☀  맑은 낮':'◒  황금빛 저녁';sun.color.set(state.night?0xffb47b:0xffefcf);sun.intensity=state.night?2.5:3.2;hemi.intensity=state.night?1.3:2.2;scene.background.set(state.night?'#b3a7ba':'#b9d7d8');scene.fog.color.copy(scene.background);island.setSunset(state.night?1:0);};
  $('#quality').onclick=()=>{const low=renderer.getPixelRatio()>1;renderer.setPixelRatio(low?1:Math.min(devicePixelRatio||1.5,1.5));renderer.shadowMap.enabled=!low;$('#quality').textContent=low?'화질 · 가볍게':'화질 · 높게';};
  $('#photo').onclick=()=>{state.photo=!state.photo;document.body.classList.toggle('photo',state.photo);toast('P 키로 화면 표시를 되돌릴 수 있어요.');};
  const onKey=e=>{if(/^(Key[WASDFRMP]|Space|ShiftLeft|ShiftRight|Arrow)/.test(e.code)&&!['INPUT','TEXTAREA'].includes(e.target.tagName))e.preventDefault();if(e.type==='keydown'){keys.add(e.code);if(e.repeat)return;if(e.code==='KeyF')mode(state.mode!=='walk');if(e.code==='KeyR'){teleport(-48,78);}if(e.code==='KeyM')$('#map-wrap').classList.toggle('hidden');if(e.code==='KeyP')$('#photo').click();}else keys.delete(e.code);};window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKey);window.addEventListener('blur',()=>{keys.clear();mouseDown=false;});
  renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());renderer.domElement.addEventListener('pointerdown',e=>{if(state.mode==='walk'){mouseDown=true;renderer.domElement.setPointerCapture(e.pointerId);}});renderer.domElement.addEventListener('pointerup',()=>mouseDown=false);renderer.domElement.addEventListener('pointermove',e=>{if(mouseDown&&state.mode==='walk'){yaw-=e.movementX*.004;pitch=clamp(pitch+e.movementY*.003,-.15,.95);}});
  function step(dt){if(state.mode!=='walk'||!body)return;const k=c=>keys.has(c);let x=Number(k('KeyD')||k('ArrowRight'))-Number(k('KeyA')||k('ArrowLeft')),z=Number(k('KeyS')||k('ArrowDown'))-Number(k('KeyW')||k('ArrowUp'));const length=Math.hypot(x,z);moving=length>0;if(length){x/=length;z/=length;}const run=k('ShiftLeft')||k('ShiftRight'),speed=run?10.5:6.0,dx=(x*Math.cos(yaw)-z*Math.sin(yaw))*speed*dt,dz=(x*Math.sin(yaw)+z*Math.cos(yaw))*speed*dt;
    if(k('Space')&&onGround){velocityY=8;onGround=false;keys.delete('Space');}velocityY=Math.max(-28,velocityY-22*dt);controller.computeColliderMovement(capsule,{x:dx,y:velocityY*dt,z:dz});const m=controller.computedMovement(),p=body.translation();body.setNextKinematicTranslation({x:p.x+m.x,y:p.y+m.y,z:p.z+m.z});world.timestep=dt;world.step();onGround=controller.computedGrounded();if(onGround&&velocityY<0)velocityY=-.8;const pos=body.translation();avatar.position.set(pos.x,pos.y-.87,pos.z);if(moving)avatar.rotation.y=Math.atan2(dx,dz);if(pos.y<-4){teleport(-48,78);toast('바다에 빠져 선착장으로 돌아왔어요.');}
    const next=moving?(run?actions.run:actions.walk):actions.idle;if(next&&next!==action){action?.fadeOut(.16);next.reset().fadeIn(.16).play();action=next;}
    for(const point of island.field.points)if(!state.found.has(point.id)&&dist(pos.x,pos.z,point.x,point.z)<point.r&&Math.abs(pos.y-point.y)<8){state.found.add(point.id);document.querySelector(`[data-id="${point.id}"]`)?.classList.add('found');toast(point.name+' 발견 · '+state.found.size+' / '+island.field.points.length);discovered.textContent=String(state.found.size).padStart(2,'0');}
  }
  const ray=new THREE.Raycaster(),cameraTarget=new THREE.Vector3(),wishCamera=new THREE.Vector3();
  function drawMap(){mapCtx.clearRect(0,0,200,200);mapCtx.drawImage(mapBg,0,0);for(const p of island.field.points){mapCtx.beginPath();mapCtx.arc((p.x/260+.5)*200,(p.z/260+.5)*200,2.8,0,Math.PI*2);mapCtx.fillStyle=state.found.has(p.id)?'#fff0af':'#e1e4c5';mapCtx.fill();}const p=avatar.position;mapCtx.save();mapCtx.translate((p.x/260+.5)*200,(p.z/260+.5)*200);mapCtx.rotate(yaw);mapCtx.beginPath();mapCtx.moveTo(0,-6);mapCtx.lineTo(-4,4);mapCtx.lineTo(4,4);mapCtx.closePath();mapCtx.fillStyle='#fff';mapCtx.fill();mapCtx.restore();}
  function render(now){requestAnimationFrame(render);const dt=Math.min(.05,(now-last)/1000);last=now;state.time+=dt;accumulator=Math.min(accumulator+dt,.15);while(accumulator>=1/60){step(1/60);accumulator-=1/60;}island.update(state.time);mixer?.update(dt);
    if(state.mode==='overview')controls.update();else{cameraTarget.copy(avatar.position).add(new THREE.Vector3(0,1.7,0));wishCamera.set(Math.sin(yaw)*-7.6,3+Math.sin(pitch)*6,Math.cos(yaw)*7.6).add(cameraTarget);const direction=wishCamera.clone().sub(cameraTarget),d=direction.length();ray.set(cameraTarget,direction.normalize());ray.far=d;const hit=ray.intersectObjects(island.collide,false)[0];if(hit)wishCamera.copy(cameraTarget).addScaledVector(direction,Math.max(1,hit.distance-.3));wishCamera.y=Math.max(wishCamera.y,island.field.height(wishCamera.x,wishCamera.z)+.7);camera.position.lerp(wishCamera,1-Math.exp(-dt*9));camera.lookAt(cameraTarget);}
    renderer.render(scene,camera);frame++;fpsFrames++;fpsT+=dt;if(fpsT>.7){$('#fps').textContent=Math.round(fpsFrames/fpsT)+' FPS';fpsFrames=0;fpsT=0;drawMap();}
  }
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
  window.__islandLab={state,island,renderer,scene,camera,world,body,teleport,mode,keys,step,get report(){return {mode:state.mode,physics:state.physics,character:state.character,position:body?body.translation():avatar.position,discovered:[...state.found],assets:island.assets,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,errors:[...errors,...state.errors],frames:frame};}};
  $('#loading').classList.add('done');requestAnimationFrame(render);drawMap();
  Promise.all([island.ready,characterReady]).then(()=>{$('#asset-note').textContent=island.assets.trees?'기존 KayKit 나무·돌 · 새 섬 지형':'새 섬 지형 · 대체 식생 표시 중';});
  return window.__islandLab;
}
