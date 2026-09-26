import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const out='artifacts',ref=process.env.GITHUB_SHA||'main',remote='https://raw.githubusercontent.com/sungeunstar/tomob-deploy/'+ref+'/';
await fs.mkdir(out,{recursive:true});const cache=new Map(),errors=[],reports={commit:ref,fixture:'generated preview + commit-pinned native runtime'};
const mime={html:'text/html',js:'application/javascript',json:'application/json',gltf:'model/gltf+json',glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',wasm:'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/tomob-deploy\//,'').replace(/^\//,'');if(name.includes('..'))throw new Error('Bad path');let body,status=200;try{body=await fs.readFile(name);}catch{if(!cache.has(name))cache.set(name,fetch(remote+encodeURI(name)).then(async r=>({status:r.status,body:Buffer.from(await r.arrayBuffer())})));const f=await cache.get(name);body=f.body;status=f.status;}res.writeHead(status,{'Content-Type':mime[name.split('.').pop()]||'application/octet-stream'});res.end(body);}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v7.html';let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(base+'?view=overview&shot=1&dpr=1',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__auroraQA?.report().ready,null,{timeout:120000});
 reports.overview=await page.evaluate(()=>window.__auroraQA.report());
 for(const place of ['overview','sunken','harbor','falls','shrine','cave','forest']){
  const data=await page.evaluate(id=>{const a=window.__auroraQA,c=a.ctx;c.setRenderOverride(()=>{});if(id!=='overview')a.go(id);for(let i=0;i<30;i++)c.tick(1/60);a.aim();c.renderer.render(c.scene,c.camera);return c.renderer.domElement.toDataURL('image/png');},place);await fs.writeFile(out+'/'+place+'.png',Buffer.from(data.split(',')[1],'base64'));
 }
 await page.goto(base+'?qa=1&shot=1&dpr=.8',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__auroraQA?.report().ready,null,{timeout:120000});
 await page.locator('summary').click();await page.locator('#native-test').click();await page.waitForFunction(()=>window.__auroraQA.testResult!==null,null,{timeout:90000});reports.native=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('summary').click();await page.locator('body > canvas').click({position:{x:640,y:510}});reports.pointerLock=await page.evaluate(()=>document.pointerLockElement===ctx.renderer.domElement);
 reports.routes=[];for(const id of ['main','gorge','mine','mill','workshop','lookout','cove','harbor'])reports.routes.push(await page.evaluate(id=>window.__auroraQA.routeTest(id),id));
 reports.sightlines=await page.evaluate(()=>window.__auroraQA.actualSightlines());
 for(const id of ['harbor','forest','falls','grove','shrine','sunken']){
  const data=await page.evaluate(id=>{const a=window.__auroraQA,c=a.ctx;c.setRenderOverride(()=>{});a.go(id);for(let i=0;i<45;i++)c.tick(1/60);c.renderer.render(c.scene,c.camera);return c.renderer.domElement.toDataURL('image/png');},id);await fs.writeFile(out+'/'+id+'-eye.png',Buffer.from(data.split(',')[1],'base64'));
 }
 // A held key with real rendering is recorded separately from deterministic route tests.
 await page.evaluate(()=>{const a=window.__auroraQA;a.go('harbor');a.ctx.setRenderOverride(null);});
 const before=await page.evaluate(()=>({...ctx.player.pos}));await page.keyboard.down('w');await page.waitForTimeout(1700);await page.keyboard.up('w');const after=await page.evaluate(()=>({...ctx.player.pos}));reports.heldKey={before,after};
 reports.errors=[...new Set(errors)];reports.final=await page.evaluate(()=>window.__auroraQA.report());
 reports.accepted=reports.native.nativeTest?.pass===true&&reports.routes.every(r=>r.pass)&&!reports.final.errors.length&&!reports.final.assets.errors.length;
 if(!reports.accepted)process.exitCode=1;
}catch(e){reports.fatal=e.stack;reports.errors=errors;process.exitCode=1;}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));await browser?.close();server.close();}
