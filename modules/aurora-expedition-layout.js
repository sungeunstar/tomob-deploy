/** Aurora 06: authored island layout. Metres, +Z south. No Three/DOM dependency.
 * Terrain, resource placement and Rapier use the SAME sampled triangle surface.
 * Sightline checks use physical terrain, not fog or hiding meshes by distance.
 */
export const SIZE = 360, N = 240;
export const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
export const mix = (a,b,t) => a+(b-a)*t;
export const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export const SUMMIT = {x:3,z:-84,y:64};
export const DOCK = {x:-64,z:134,shoreZ:108,deck:5.25,span:42};
export const BRIDGE = {x0:-102,x1:-56,z:11,width:4.6,level:21};
export const BUILDINGS = [
 {id:'harbor',file:'building_tavern_blue.fbx',name:'달바람 선술집',x:-87,z:100,y:6,size:16.2,r:12,yaw:.18},
 {id:'home',file:'building_home_A_blue.fbx',name:'항구의 집',x:-39,z:108,y:5.7,size:11.5,r:9,yaw:-.4},
 {id:'mill',file:'building_watermill_blue.fbx',name:'협곡 물방앗간',x:-111,z:29,y:20.5,size:14.2,r:10,yaw:-1.3},
 {id:'mine',file:'building_mine_blue.fbx',name:'바위그늘 광산',x:-112,z:-48,y:35,size:19,r:12,yaw:.55},
 {id:'workshop',file:'building_blacksmith_blue.fbx',name:'광산 작업장',x:-125,z:-15,y:26.5,size:11.4,r:9,yaw:.55},
 {id:'lookout',file:'building_tower_A_blue.fbx',name:'동쪽 바람 망루',x:112,z:-33,y:35,size:15.5,r:8,yaw:-.35}
];
export const BASINS = [
 {id:'source',x:-78,z:-34,rx:9.3,rz:7.2,level:43,depth:2.8,spillZ:-27},
 {id:'shelf',x:-79,z:-15,rx:7.4,rz:5.4,level:30,depth:2.3,spillZ:-10},
 {id:'lagoon',x:-79,z:6,rx:16,rz:15.5,level:17,depth:3.6}
];
export const fallAxes = [ [-78,-27,-79,-19,43,30,4.2], [-79,-10,-80,-4,30,17,5] ];
export function basinRadius(b,x,z){const a=Math.atan2((z-b.z)/b.rz,(x-b.x)/b.rx);return Math.hypot((x-b.x)/b.rx,(z-b.z)/b.rz)/(1+.055*Math.sin(3*a+.7)+.028*Math.cos(7*a));}
export function axisDistance(a,x,z){const dx=a[2]-a[0],dz=a[3]-a[1],t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1));return {t,d:Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)};}

// All points are [x,z,walk-height]. Branches meet at identical elevations.
export const ROUTES = [
 {id:'main',name:'항구 → 숲 → 폭포 → 폐허 → 정상',width:4.5,points:[
 [-64,108,5.5],[-64,95,6],[-50,83,8],[-31,77,10],[-17,64,11.5],[-24,49,13],[-38,39,15],[-49,36,17],[-62,34,19],[-58,27,21],
 [-44,22,23],[-27,19,25],[-17,5,28],[-1,-2,30],[17,-4,32],[32,-23,35],[45,-42,39],[34,-58,44],[14,-47,47],[-6,-51,51],[-18,-68,55],[-25,-83,58],[-13,-98,61],[5,-103,64],[19,-94,64],[21,-77,64],[3,-70,64],[3,-84,64]]},
 {id:'gorge',name:'협곡 다리',width:4.4,points:[[-58,27,21],[-56,18,21],[-56,11,21],[-102,11,21],[-107,0,23],[-107,-18,28],[-97,-34,33],[-97,-46,35],[-91,-56,36],[-73,-57,37],[-54,-47,36],[-40,-32,33],[-30,-10,30],[-17,5,28]]},
 {id:'mine',name:'광산 앞마당',width:3.8,points:[[-97,-34,33],[-102,-38,35],[-107,-35,35]]},
 {id:'mill',name:'물방앗간',width:3.4,points:[[-102,11,21],[-98,22,21],[-102,30,20.5]]},
 {id:'workshop',name:'대장간 샛길',width:3.4,points:[[-107,0,23],[-113,-5,25],[-114,-12,26.5]]},
 {id:'lookout',name:'망루 외곽길',width:3.8,points:[[17,-4,32],[40,0,32],[62,-6,33],[80,-17,34],[98,-22,35],[109,-22,35]]},
 {id:'cove',name:'숨은 만 우회길',width:3.6,points:[[40,0,32],[55,14,27],[65,29,21],[59,48,15],[78,64,9],[94,73,5],[103,83,4.5]]},
 {id:'harbor',name:'선술집 마당',width:4.2,points:[[-64,95,6],[-75,93,6],[-82,89,6]]}
];

// Named intermediate masses make rooms in an outdoor landscape.
const RIDGES = [
 {id:'forest-room',a:[-17,28],b:[-15,12],w:6,h:40},
 {id:'harbor-screen',a:[-100,65],b:[-48,65],w:13,h:20},
 {id:'forest-turn',a:[-10,45],b:[7,31],w:13,h:35},
 {id:'gorge-curtain',a:[-49,23],b:[-43,9],w:10,h:34},
 {id:'ruins-shoulder',a:[4,10],b:[20,17],w:12,h:40},
 {id:'east-wall',a:[78,23],b:[92,52],w:13,h:33},
 {id:'summit-veil',a:[-15,-73],b:[-8,-73],w:5.3,h:69},
 {id:'mine-back',a:[-127,-56],b:[-104,-72],w:12,h:48},
 {id:'gorge-spire',a:[-100,-26],b:[-99,-38],w:6,h:47}
];
export const CHECKPOINTS = [
 {id:'landing',name:'옛 부두',x:-64,z:108,target:[3,76,-84],text:'먼 정상만 먼저 보인다'},
 {id:'harbor',name:'항구 마당',x:-64,z:95,target:[-31,12,77],text:'능선 뒤의 길은 아직 보이지 않는다'},
 {id:'forest',name:'굽은 숲길',x:-24,z:49,target:[-38,16.5,39],text:'다음 모퉁이와 물소리'},
 {id:'falls',name:'폭포가 열리는 곳',x:-62,z:34,target:[-79,32,-20],text:'협곡을 돌아서 만나는 첫 전망'},
 {id:'bridge',name:'이끼 협곡 다리',x:-56,z:11,target:[-102,23,11],text:'다리 끝에 이어지는 광산 샛길'},
 {id:'cave',name:'바위그늘 광산',x:-97,z:-34,target:[-112,41,-48],text:'그늘진 작업장과 돌아 나가는 길'},
 {id:'grove',name:'옛길의 폐허',x:45,z:-42,target:[3,76,-84],text:'정상의 방향을 다시 확인한다'},
 {id:'lookout',name:'동쪽 바람 망루',x:99,z:-22,target:[112,44,-33],text:'주 동선에서 벗어난 바다 전망'},
 {id:'cove',name:'숨겨진 조개 만',x:103,z:83,target:[114,4,96],text:'절벽 뒤에 남은 작은 해변'},
 {id:'ascent',name:'마지막 바위 고개',x:-18,z:-68,target:[-9,63,-82],text:'마지막 코너 너머의 빛'},
 {id:'shrine',name:'바람의 차원문',x:3,z:-70,target:[3,69,-84],text:'정상에서 열리는 하늘과 바다'}
];

function curveSegments(){
 const segs=[];
 for(const route of ROUTES){
  const ps=route.points;
  for(let i=0;i<ps.length-1;i++){
   const a=ps[Math.max(0,i-1)],b=ps[i],c=ps[i+1],d=ps[Math.min(ps.length-1,i+2)];
   const bridge=route.id==='gorge'&&i===2;
   let last=b;
   for(let j=1;j<=10;j++){
    const t=j/10,t2=t*t,t3=t2*t;
    const cm=k=>.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3);
    // Straight bridge and its banks, curved land paths.
    const p=bridge?[mix(b[0],c[0],t),mix(b[1],c[1],t),mix(b[2],c[2],t)]:[cm(0),cm(1),mix(b[2],c[2],t)];
    segs.push({a:last,b:p,id:route.id,width:route.width,bridge});last=p;
   }
  }
 }
 return segs;
}

export function createExpeditionField(){
 const segments=curveSegments(),landSegs=segments.filter(s=>!s.bridge),count=(N+1)**2;
 function nearest(x,z,list=segments){let best=1e12,y=0,width=4,id='',bridge=false;
  for(const s of list){const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],t=clamp(((x-s.a[0])*dx+(z-s.a[1])*dz)/(dx*dx+dz*dz||1));const dd=(x-s.a[0]-dx*t)**2+(z-s.a[1]-dz*t)**2;
   if(dd<best){best=dd;y=mix(s.a[2],s.b[2],t);width=s.width;id=s.id;bridge=s.bridge;}}
  return{d:Math.sqrt(best),y,width,id,bridge};
 }
 function boundary(x,z){const a=Math.atan2(z/148,x/144);return Math.hypot(x/144,z/148)/(1+.063*Math.sin(3*a+.3)+.045*Math.cos(5*a-.7)+.024*Math.sin(9*a));}
 function plateau(x,z,cx,cz,rx,rz,h,inner=.65){const r=Math.hypot((x-cx)/rx,(z-cz)/rz);return -8+(h+8)*(1-smooth(inner,1.17,r));}
 const heights=new Float32Array(count),paths=new Float32Array(count);
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,bound=boundary(x,z);
  let h=-8+14*smooth(1.11,.90,bound);const noise=.48*Math.sin(x*.11+z*.04)*Math.cos(z*.12)+.2*Math.sin(x*.29-z*.18);
  for(const p of [[-20,49,64,61,16],[-73,54,35,24,19],[-79,-23,48,58,30],[-108,-42,32,31,36],[23,-25,64,61,38],[3,-84,40,36,64,.35],[112,-33,27,27,36],[82,53,31,38,22]])h=Math.max(h,plateau(x,z,...p));
  for(const r of RIDGES){const a=axisDistance([...r.a,...r.b],x,z);const f=1-smooth(r.w*.32,r.w*1.25,a.d);h=Math.max(h,-8+(r.h+8+noise*1.4)*f);}
  h+=noise*smooth(.96,.72,bound);
  // Protected port and coast. Ridge crests remain naturally irregular.
  for(const b of BUILDINGS){const d=Math.hypot(x-b.x,z-b.z);h=mix(h,b.y,1-smooth(b.r*.9,b.r+4,d));}
  const plaza=Math.hypot((x-SUMMIT.x)/13,(z-SUMMIT.z)/13);h=mix(h,SUMMIT.y,1-smooth(.93,1.23,plaza));
  for(const b of [...BASINS].reverse()){const r=basinRadius(b,x,z);if(r<1.43){const bowl=b.level-b.depth+(b.depth+1.4)*smooth(.2,1.18,r);h=mix(h,bowl,1-smooth(1.17,1.43,r));}}
  for(const a of fallAxes){const q=axisDistance(a,x,z);if(q.d<a[6]+1.8){const bed=mix(a[4],a[5],smooth(.08,.88,q.t))-.8;h=mix(h,bed,1-smooth(a[6]*.5,a[6]*.5+1.8,q.d));}}
  const p=nearest(x,z,landSegs);h=mix(h,p.y,1-smooth(p.width*.5,p.width*.5+3.8,p.d));
  // A short beach apron is the only linear approach to the existing wharf.
  if(z>=105&&z<=116&&Math.abs(x+64)<5)h=mix(h,5.5,(1-smooth(3,5,Math.abs(x+64)))*(1-smooth(110,116,z)));
  heights[k]=h;paths[k]=nearest(x,z).d;
 }
 function height(x,z){const fx=(x/SIZE+.5)*N,fz=(z/SIZE+.5)*N;if(fx<0||fz<0||fx>=N||fz>=N)return-8;const i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,k=j*(N+1)+i,a=heights[k],b=heights[k+1],c=heights[k+N+1],d=heights[k+N+2];return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);}
 function slope(x,z){return Math.hypot(height(x+.6,z)-height(x-.6,z),height(x,z+.6)-height(x,z-.6))/1.2;}
 const bridgeY=x=>BRIDGE.level-.45*Math.sin(clamp((x-BRIDGE.x0)/(BRIDGE.x1-BRIDGE.x0))*Math.PI);
 const support=(x,z)=>(x>=BRIDGE.x0&&x<=BRIDGE.x1&&Math.abs(z-BRIDGE.z)<=BRIDGE.width/2)?Math.max(height(x,z),bridgeY(x)):height(x,z);
 function lineOfSight(from,to,clearance=.12){const length=Math.hypot(to[0]-from[0],to[2]-from[2]),steps=Math.ceil(length/.45);let min=1e9,block=null;for(let i=2;i<steps-1;i++){const t=i/steps,x=mix(from[0],to[0],t),z=mix(from[2],to[2],t),y=mix(from[1],to[1],t),gap=y-height(x,z);if(gap<min)min=gap;if(gap<clearance&&!block)block={x:+x.toFixed(1),z:+z.toFixed(1),gap:+gap.toFixed(2)};}return{visible:!block,clearance:+min.toFixed(2),block};}
 const points=CHECKPOINTS.map(p=>({...p,y:support(p.x,p.z),r:6}));
 return{size:SIZE,segments:N,heights,paths,height,slope,boundary,nearPath:nearest,points,routes:ROUTES.map(r=>r.points),routeDefs:ROUTES,segmentsList:segments,lines:segments.map(s=>[s.a,s.b]),ridges:RIDGES,bridgeY,support,lineOfSight};
}

export function inspectSightlines(field){
 const eye=id=>{const p=field.points.find(p=>p.id===id);return[p.x,p.y+1.65,p.z];};
 const targets={summit:[3,76,-84],waterfall:[-79,37,-23],mine:[-112,40,-48],ruins:[17,35,-4],cove:[103,5.5,83]};
 const cases=[['landing','summit',true],['landing','waterfall',false],['landing','mine',false],['forest','summit',false],['forest','waterfall',false],['falls','waterfall',true],['grove','summit',true],['ascent','summit',false],['shrine','summit',true],['harbor','cove',false]];
 return cases.map(([from,target,expected])=>{const r=field.lineOfSight(eye(from),targets[target]);return{from,target,expected,...r,pass:r.visible===expected};});
}
