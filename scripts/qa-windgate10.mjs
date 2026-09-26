import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const out='artifacts';await fs.mkdir(out,{recursive:true});
const ref=process.env.GITHUB_SHA||'main',remote='https://raw.githubusercontent.com/sungeunstar/tomob-deploy/'+ref+'/',root=process.cwd(),cache=new Map();
const mime={html:'text/html',js:'application/javascript',json:'application/json',gltf:'model/gltf+json',glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',wasm:'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const n=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,''),p=path.resolve(root,n);if(!p.startsWith(root+'/')||n.includes('node_modules')||n.startsWith('.git/')){res.writeHead(403);return res.end();}let body,status=200;try{body=await fs.readFile(p);}catch{if(!cache.has(n))cache.set(n,fetch(remote+n.split('/').map(encodeURIComponent).join('/')).then(async r=>({status:r.status,body:Buffer.from(await r.arrayBuffer())})));const f=await cache.get(n);body=f.body;status=f.status;}res.writeHead(status,{'Content-Type':mime[n.split('.').pop()]||'application/octet-stream'});res.end(body);}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const report={commit:ref,method:'commit-pinned native modules; generated sample; actual Chromium WebGL'},errors=[],requests=[];let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});page.setDefaultTimeout(120000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)requests.push({url:r.url(),status:r.status()});});
 const base='http://127.0.0.1:8787/sandbox-aurora-v10.html';
 async function ready(){await page.waitForFunction(()=>window.__auroraQA?.report().ready,null,{timeout:180000});await page.evaluate(()=>ctx.setRenderOverride(()=>{}));}
 async function shot(name){const data=await page.evaluate(()=>{const a=window.__auroraQA;a.aim();ctx.renderer.render(ctx.scene,ctx.camera);return ctx.renderer.domElement.toDataURL('image/png');});await fs.writeFile(out+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'));}
 await page.goto(base+'?view=overview&shot=1&dpr=1',{waitUntil:'domcontentloaded'});await ready();report.overview=await page.evaluate(()=>window.__auroraQA.report());await shot('overview');
 for(const id of['vault-entry','vault-turn','vault-exit','harbor','falls']){await page.evaluate(id=>window.__auroraQA.go(id),id);await shot(id+'-overview');}
 await page.goto(base+'?qa=1&shot=1&dpr=1',{waitUntil:'domcontentloaded'});await ready();
 await page.locator('summary').click();await page.locator('#native-test').click();await page.waitForFunction(()=>window.__auroraQA.testResult!==null);report.native=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('canvas').first().click({position:{x:640,y:480},force:true});await page.waitForFunction(()=>document.pointerLockElement!==null);
 report.routes=[];
 for(const id of['vault','vault-return','main','gorge','mine','mill','workshop','lookout','cove','harbor']){
  const r=await page.evaluate(id=>window.__auroraQA.routeTest(id),id);report.routes.push(r);if(!r.pass)await shot('blocked-'+id);console.log('ROUTE',id,r.pass,r.failed||r.travelMetres);
 }
 report.sightlines=await page.evaluate(()=>window.__auroraQA.actualSightlines());
 report.vaultGeometry=await page.evaluate(async()=>{const THREE=await import('three'),a=window.__auroraQA,v=a.island.vault,ray=new THREE.Raycaster();ray.firstHitOnly=true;const samples=[];
  for(const i of[26,42,58,74,90]){const p=v.rows[i];ray.set(new THREE.Vector3(p[0],p[1]+.2,p[2]),new THREE.Vector3(0,1,0));ray.far=15;const hit=ray.intersectObjects(a.island.collide,true)[0];samples.push({i,ceiling:hit?.distance,object:hit?.object.name});}
  const a0=v.rows[14],b0=v.rows[104],start=new THREE.Vector3(a0[0],a0[1]+1.6,a0[2]),end=new THREE.Vector3(b0[0],b0[1]+1.6,b0[2]),d=end.clone().sub(start);ray.set(start,d.normalize());ray.far=start.distanceTo(end)-.2;const blockers=ray.intersectObjects(a.island.collide,true);
  return{samples,directViewBlocked:blockers.length>0,blocker:blockers[0]?.object.name,cut:v.cut,length:v.length};
 });
 async function eye(name,u,reverse=false){await page.evaluate(({u,reverse})=>{const a=window.__auroraQA,v=a.island.vault,rows=v.rows,i=Math.round(u*(rows.length-1)),p=rows[i],t=rows[Math.max(0,Math.min(rows.length-1,i+(reverse?-14:14)))];ctx.player.setSpawn(p[0],p[1]+1.45,p[2]);ctx.player.setThird(true);ctx.player.setYaw(Math.atan2(t[0]-p[0],p[2]-t[2]));ctx.player.setPitch(.015);for(let j=0;j<55;j++)ctx.tick(1/60);}, {u,reverse});await shot(name);}
 await eye('passage-entrance-eye',.02);await eye('passage-bend-eye',.35);await eye('passage-interior-eye',.59);await eye('passage-exit-eye',.88);await eye('passage-return-eye',.8,true);
 for(const id of['forest','bridge','grove','shrine','harbor','falls']){await page.evaluate(id=>{window.__auroraQA.go(id);for(let j=0;j<60;j++)ctx.tick(1/60);},id);await shot(id+'-eye');}
 report.errors=[...new Set(errors)];report.httpErrors=requests;report.final=await page.evaluate(()=>window.__auroraQA.report());
 report.accepted=!!report.native.nativeTest?.pass&&report.routes.every(r=>r.pass)&&report.sightlines.every(r=>r.pass)&&report.errors.length===0&&report.final.assets.errors.length===0&&report.vaultGeometry.directViewBlocked&&report.vaultGeometry.samples.every(s=>s.ceiling>3.5&&s.ceiling<9);
 console.log('WINDGATE10_SUMMARY',JSON.stringify({accepted:report.accepted,routes:report.routes.map(r=>[r.id,r.pass]),sightlines:report.sightlines,vault:report.vaultGeometry,errors:report.errors,http:requests}));
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;report.accepted=false;process.exitCode=1;console.error(e);}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}
