import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const once=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('Missing reviewed finish hook: '+a.slice(0,75));return s.replace(a,b);};
let v=await fs.readFile('modules/windgate10-vault-runtime.js','utf8'),source=await fs.readFile('modules/aurora-passage.js','utf8'),page=await fs.readFile('sandbox-aurora-v10.html','utf8');
const start=v.indexOf('function vaultSDF('),end=v.indexOf('export function prepareVault',start);if(start<0||end<0)throw new Error('SDF hook missing');
v=v.slice(0,start)+`function vaultSDF(x,y,z){const q=vaultSample(x,z),r=3.5,a=rows[0],b=rows[rows.length-1],before=-((x-a.p.x)*a.t.x+(z-a.p.z)*a.t.z),after=(x-b.p.x)*b.t.x+(z-b.p.z)*b.t.z,roof=q.y+2.2+3.05*Math.sqrt(Math.max(0,1-(q.d/r)**2));return Math.max(q.d-r,q.y-.38-y,y-roof,before,after);}\n`+v.slice(end);
v=once(v,'field.vaultReserve=vaultReserve;',`field.vaultReserve=vaultReserve;
 const n=field.segments,sz=field.size;
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const x=(i/n-.5)*sz,z=(j/n-.5)*sz,k=j*(n+1)+i;for(const ri of[0,120]){const r=rows[ri],d=Math.hypot(x-r.p.x,z-r.p.z);if(d>6.5)continue;const fade=1-clamp((d-3.8)/2.7),h=field.heights[k];if(h<r.p.y)field.heights[k]=mix(h,r.p.y,fade*fade*(3-2*fade));}}
`);
v=once(v,"const cube=new THREE.BoxGeometry(1,1,1)",`// World-space mineral variation joins smooth tunnel walls to the weathered island.
 for(const m of[rock,masonry,dark,floorMat]){m.onBeforeCompile=s=>{s.vertexShader='varying vec3 wgP;\\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>','wgP=(modelMatrix*vec4(transformed,1.)).xyz;\\n#include <project_vertex>');s.fragmentShader='varying vec3 wgP;\\nfloat wgHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.54);}\\nfloat wgNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wgHash(i),wgHash(i+vec2(1,0)),f.x),mix(wgHash(i+vec2(0,1)),wgHash(i+vec2(1,1)),f.x),f.y);}\\n'+s.fragmentShader;s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\\nfloat broad=wgNoise(wgP.xz*.8+wgP.y*.15);float fine=wgNoise(vec2(wgP.x+wgP.z*.7,wgP.y)*7.);float seam=pow(max(0.,sin(wgP.y*3.8+wgNoise(wgP.xz*.25)*4.)),16.);diffuseColor.rgb*=.78+.21*broad+.13*fine-seam*.11;\\n');};m.customProgramCacheKey=()=> 'windgate10-weathered-vault';}
 const cube=new THREE.BoxGeometry(1,1,1)`);
v=once(v,"dark=mat('#505b50')","dark=mat('#656e60')");
v=once(v,'for(let i=0;i<75;i++){const r=rows','for(let i=0;i<43;i++){const r=rows');
v=once(v,'const shell=add(geometry(wp,wc,wu,inside),rock',`// Clip complete wall triangles against terrain, preserving UVs and colour.
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
 const shell=add(clippedShell(),rock`);
source=once(source,'if(y<6.7||field.slope(x,z)>.62','if(vaultReserve(x,z,2)||y<6.7||field.slope(x,z)>.62');
const stamp=(process.env.GITHUB_SHA||'local-review').slice(0,10);source=source.replaceAll('?v=10b','?v='+stamp);page=page.replaceAll('?v=10b','?v='+stamp);
const outputs={'modules/windgate10-vault-runtime.js':v,'modules/aurora-passage.js':source,'sandbox-aurora-v10.html':page};
for(const[p,s]of Object.entries(outputs)){await fs.writeFile(p,s);await fs.writeFile('artifacts/source/'+p,s);}
const paths=[...Object.keys(outputs),'modules/windgate10-polish.js'],hashes={};for(const p of paths){const s=await fs.readFile(p);hashes[p]=crypto.createHash('sha1').update('blob '+s.length+'\0').update(s).digest('hex');}
await fs.writeFile('artifacts/build.json',JSON.stringify(hashes,null,2));
console.log('Applied physical-mouth and real-capture visual corrections.');
