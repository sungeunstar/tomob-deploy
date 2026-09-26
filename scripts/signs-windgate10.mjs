import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('Sign placement hook mismatch: '+a);return s.replace(a,b);};
let v=await fs.readFile('modules/windgate10-vault-runtime.js','utf8');
for(const[a,b]of[['sign(-53,29,','sign(-55.5,28,'],['sign(36,5,','sign(34,-2.5,'],['sign(-103,-3,','sign(-109,2.5,'],['sign(-22,-66,','sign(-18.5,-72.5,']])v=once(v,a,b);
v=once(v,'u.setXY(i,(idx%2+xx)/2','u.setXY(i,(idx%2+(p.getZ(i)<0?1-xx:xx))/2');
await fs.writeFile('modules/windgate10-vault-runtime.js',v);await fs.writeFile('artifacts/source/modules/windgate10-vault-runtime.js',v);
const hashes=JSON.parse(await fs.readFile('artifacts/build.json','utf8'));hashes['modules/windgate10-vault-runtime.js']=crypto.createHash('sha1').update('blob '+Buffer.byteLength(v)+'\0').update(v).digest('hex');await fs.writeFile('artifacts/build.json',JSON.stringify(hashes,null,2));
let qa=await fs.readFile('scripts/qa-windgate10.mjs','utf8');
qa=once(qa,'report.errors=[...new Set(errors)];report.httpErrors=requests;report.final=',`report.signViews=await page.evaluate(async()=>{
 const THREE=await import('three'),a=window.__auroraQA,f=a.island.field,ray=new THREE.Raycaster();ray.firstHitOnly=true;const out=[];
 for(const index of[0,2,4,6]){const s=a.island.vault.signs[index],target=new THREE.Vector3(s.x,f.height(s.x,s.z)+1.35,s.z),candidates=[];
  for(const [p,q]of f.lines){const x=(p[0]+q[0])/2,z=(p[1]+q[1])/2,y=f.height(x,z)+1.65,d=Math.hypot(x-s.x,z-s.z);if(d<2.7||d>7)continue;const eye=new THREE.Vector3(x,y,z),dir=target.clone().sub(eye),len=dir.length();ray.set(eye,dir.normalize());ray.far=len-.85;if(ray.intersectObjects(a.island.collide,true).some(h=>h.distance>.12))continue;const face=(Math.sin(s.angle)*(x-s.x)+Math.cos(s.angle)*(z-s.z))/d;candidates.push({eye:eye.toArray(),target:target.toArray(),score:Math.abs(face)*3-Math.abs(d-4)*.15,face});}
  candidates.sort((a,b)=>b.score-a.score);out.push({index,label:s.label,x:s.x,z:s.z,slope:f.slope(s.x,s.z),pathDistance:f.nearPath(s.x,s.z).d,pass:candidates.length>0,view:candidates[0]||null});
 }
 return out;
});
for(const s of report.signViews){if(!s.view)continue;await page.evaluate(v=>{ctx.camera.fov=45;ctx.camera.updateProjectionMatrix();ctx.camera.position.set(...v.eye);ctx.camera.lookAt(...v.target);},s.view);await shot('sign-path-'+s.index);}
report.errors=[...new Set(errors)];report.httpErrors=requests;report.final=`);
qa=once(qa,'report.accepted=!!report.native.nativeTest?.pass','report.accepted=report.signViews.every(s=>s.pass&&s.pathDistance>1.8)&&!!report.native.nativeTest?.pass');
await fs.writeFile('scripts/qa-windgate10.mjs',qa);
await fs.copyFile('scripts/signs-windgate10.mjs','artifacts/source/signs-windgate10.mjs');
console.log('Direction signs moved from cliff faces to actual path shoulders, front/back lettering corrected. Road-eye visibility checks enabled.');
