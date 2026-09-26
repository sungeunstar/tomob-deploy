/** Windgate 07: proposed refugee-island history, protected native routes. */
import * as L from './aurora-expedition-layout.js';
export * from './aurora-expedition-layout.js';
const {SIZE,N,BUILDINGS,BASINS,fallAxes,SUMMIT,smooth,mix,clamp,axisDistance,basinRadius}=L;
const hash=(x,z)=>{const v=Math.sin(x*127.1+z*311.7)*43758.5453;return v-Math.floor(v);};
export function terrainNoise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
export const OUTFLOW=[[-83,21,17],[-91,38,13.5],[-112,55,8.3],[-132,76,2.8],[-140,99,-.12]];
export function riverSample(x,z){let result={d:Infinity,y:0,t:0};for(let i=0;i<OUTFLOW.length-1;i++){const a=OUTFLOW[i],b=OUTFLOW[i+1],q=axisDistance([a[0],a[1],b[0],b[1]],x,z);if(q.d<result.d)result={...q,y:mix(a[2],b[2],q.t)};}return result;}
export function ecology(x,z,y){const wet=Math.min(...BASINS.map(b=>Math.max(0,(basinRadius(b,x,z)-1)*Math.min(b.rx,b.rz))),riverSample(x,z).d);const cluster=terrainNoise(x*.026+9,z*.026-4)*.64+terrainNoise(x*.071,z*.071)*.36;return {wet,cluster,wind:clamp((y-36)/31),coast:y<7};}
export function createExpeditionField(){
 const field=L.createExpeditionField(),before=field.heights.slice();
 for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){
  const k=j*(N+1)+i,x=(i/N-.5)*SIZE,z=(j/N-.5)*SIZE,y=before[k],path=field.paths[k];
  let protect=1-smooth(5.3,10,path);
  for(const b of BUILDINGS)protect=Math.max(protect,1-smooth(b.r*.96,b.r+5,Math.hypot(x-b.x,z-b.z)));
  for(const b of BASINS)protect=Math.max(protect,1-smooth(1.16,1.6,basinRadius(b,x,z)));
  for(const a of fallAxes)protect=Math.max(protect,1-smooth(a[6]*.7,a[6]+5,axisDistance(a,x,z).d));
  protect=Math.max(protect,1-smooth(14,25,Math.hypot(x-SUMMIT.x,z-SUMMIT.z)));
  protect=Math.max(protect,1-smooth(13,23,Math.hypot(x+64,z-114)),1-smooth(7,14,Math.hypot(x+12,z+73)));
  const wx=x+9*(terrainNoise(x*.028,z*.028)-.5),wz=z+7*(terrainNoise(x*.033+21,z*.033)-.5);
  const macro=(terrainNoise(wx*.036,wz*.028)-.5)*7.2+(terrainNoise(wx*.078+4,wz*.069)-.5)*2.8;
  const erosion=Math.sin(y*.73+x*.039+z*.025)*(1.0+terrainNoise(x*.08,z*.07))+(terrainNoise(x*.18,z*.18)-.5)*.65;
  let h=y+(macro+erosion*smooth(8,22,y))*(1-protect)*smooth(-7,3,y);
  const exposed=smooth(52,115,x)*(1-smooth(36,85,z));
  h-=exposed*(1-protect)*smooth(-2,4,y)*(1-smooth(9,19,y))*(2+3*terrainNoise(x*.07,z*.09));
  // The shore shelf follows an irregular island boundary, not the square sample grid.
  const bound=field.boundary(x,z),outer=Math.max(smooth(1.06,1.40,bound),smooth(156,177,Math.max(Math.abs(x),Math.abs(z))));
  if(y<2&&path>8)h=mix(h,-85,outer);
  const river=riverSample(x,z),bowlSafe=BASINS.every(b=>basinRadius(b,x,z)>1.03);
  if(river.d<7&&path>6.5&&bowlSafe){const bed=river.y-.72+.13*Math.sin(z*.6);h=mix(h,bed,1-smooth(1.7,5.8,river.d));}
  // A real eroded saddle restores only the intentional harbor-to-summit glimpse.
  // Do not remove the final pass, the forest curtain, or a walkable path.
  const glimpse=axisDistance([-64,108,3,-84],x,z);
  if(glimpse.t>.06&&glimpse.t<.58&&glimpse.d<11&&path>4.8){const ceiling=mix(7.15,76,glimpse.t)-1.5;h=mix(h,Math.min(h,ceiling),1-smooth(4.5,11,glimpse.d));}
  field.heights[k]=h;
 }
 field.ecology=(x,z)=>ecology(x,z,field.height(x,z));field.outflow=OUTFLOW;
 field.history={theme:'submerged sanctuary / refugee harbor',eraLabels:['침수 이전의 돌길','다시 세운 피난민 항구','최근 깨어난 성소']};
 field.points=field.points.map(p=>({...p,y:field.height(p.x,p.z)}));
 field.points.push({id:'sunken',name:'바다로 사라진 옛길',x:-29,z:124,y:field.height(-29,124),r:7,target:[-12,3,150],text:'아래 도시로 이어지던 길'});
 field.points.find(p=>p.id==='harbor').name='난파목으로 다시 세운 항구';
 field.points.find(p=>p.id==='grove').name='잠긴 왕국의 옛 순례길';
 field.points.find(p=>p.id==='shrine').name='깨어난 첫 별의 성소';
 field.naturalization={protectedRouteWidth:10.6,oldVertices:before.length,sharedCollisionGrid:true,outletToSea:true,irregularDeepShelf:true,physicalHarborSaddle:true};
 return field;
}
