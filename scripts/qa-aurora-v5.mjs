import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
const output='artifacts';await fs.mkdir(output,{recursive:true});
const ref=process.env.GITHUB_SHA||'main',remote='https://raw.githubusercontent.com/sungeunstar/tomob-deploy/'+ref+'/';
const cache=new Map(),external={},captures=[],mime={html:'text/html',js:'application/javascript',json:'application/json',gltf:'model/gltf+json',glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',wasm:'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.replace(/^\/tomob-deploy\//,'').replace(/^\//,'');if(!cache.has(name))cache.set(name,fetch(remote+name).then(async r=>({status:r.status,body:Buffer.from(await r.arrayBuffer())})));const file=await cache.get(name);res.writeHead(file.status,{'Content-Type':mime[name.split('.').pop()]||'application/octet-stream'});res.end(file.body);}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v5.html',errors=[],reports={sourceCommit:ref,testOrigin:'commit-pinned local static server'};let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{const u=r.url();if(!/^https:\/\/(cdn\.jsdelivr\.net|esm\.sh)\//.test(u)||r.status()!==200)return;captures.push((async()=>{try{const bytes=await r.body(),file='external/'+crypto.createHash('sha256').update(u).digest('hex');await fs.mkdir(output+'/runtime/external',{recursive:true});await fs.writeFile(output+'/runtime/'+file,bytes);external[u]={file,type:r.headers()['content-type']||'application/javascript'};}catch{}})());});
 await page.goto(base+'?view=overview&qa=1&shot=1&dpr=1',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});reports.overview=await page.evaluate(()=>window.__auroraQA.report());
 for(const place of ['overview','falls','shrine','workshop','dock']){
  const data=await page.evaluate(place=>{const a=window.__auroraQA;a.ctx.setRenderOverride(()=>{});if(place!=='overview')a.go(place);a.aim();a.ctx.renderer.render(a.ctx.scene,a.ctx.camera);return a.ctx.renderer.domElement.toDataURL('image/png');},place);
  const png=Buffer.from(data.split(',')[1],'base64');await fs.writeFile(output+'/'+place+'.png',png);await sharp(png).resize({width:320}).jpeg({quality:60}).toFile(output+'/'+place+'-thumb.jpg');
 }
 await page.goto(base+'?qa=1&shot=1&dpr=.75',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});
 await page.locator('summary').click();await page.locator('#native-test').click();await page.waitForFunction(()=>window.__auroraQA.testResult!==null,{},{timeout:60000});reports.native=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('body > canvas').click({position:{x:550,y:440}});const before=await page.evaluate(()=>({p:{...ctx.player.pos},locked:document.pointerLockElement===ctx.renderer.domElement}));await page.keyboard.down('w');await page.waitForTimeout(2500);await page.keyboard.up('w');const after=await page.evaluate(()=>({p:{...ctx.player.pos},animation:window.__curAnim?.()}));reports.manual={before,after};
 // Teleport ONLY for initial fixture setup. During each passage every step uses native input/KCC.
 reports.passages=await page.evaluate(()=>{const a=window.__auroraQA,c=a.ctx,p=c.player,old=c.getRenderOverride(),out=[];if(document.pointerLockElement!==c.renderer.domElement)return {inconclusive:'pointer lock missing'};const emit=(t,k)=>dispatchEvent(new KeyboardEvent(t,{code:k,bubbles:true}));c.setRenderOverride(()=>{});try{for(const [name,start,end]of[['bridge',[-74,4],[-22,4]],['portal',[-9,-28],[-9,-47]],['dock-approach',[-48,81],[-48,a.island.assets.dock.anchor[2]]]]){p.setSpawn(start[0],a.island.groundAt(start[0],start[1],65)+2.3,start[1]);for(let i=0;i<45;i++)c.tick(1/60);const initial={...p.pos};let completed=false,minY=p.pos.y,maxY=p.pos.y,steps=0,stuck=0,last={...p.pos};emit('keydown','KeyW');for(;steps<1500;steps++){const q=p.pos,dx=end[0]-q.x,dz=end[1]-q.z;if(Math.hypot(dx,dz)<.55){completed=true;break;}p.setYaw(Math.atan2(dx,-dz));c.tick(1/60);const v=p.pos;minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);if(Math.hypot(v.x-last.x,v.z-last.z)<.001)stuck++;else stuck=0;last={...v};if(stuck>90)break;}emit('keyup','KeyW');for(let i=0;i<10;i++)c.tick(1/60);out.push({name,completed,steps,initial,final:{...p.pos},minY,maxY,ground:a.island.groundAt(p.pos.x,p.pos.z,p.pos.y+.2)});}return out;}finally{emit('keyup','KeyW');c.setRenderOverride(old);}});
 // Eye-level review uses unchanged native player/camera, not the overview camera.
 for(const [name,x,z,tx,ty,tz]of[['falls-eye',-31,0,-45,19,-24],['shrine-eye',-9,-28,-9,50,-41],['workshop-eye',80,42,88,12,31]]){
  const data=await page.evaluate(([x,z,tx,ty,tz])=>{const a=window.__auroraQA,c=a.ctx,p=c.player,old=c.getRenderOverride();c.setRenderOverride(()=>{});p.setSpawn(x,a.island.groundAt(x,z,70)+2.3,z);p.setThird(true);p.setYaw(Math.atan2(tx-x,-(tz-z)));p.setPitch(Math.atan2(ty-p.pos.y,Math.hypot(tx-x,tz-z))*.65);for(let i=0;i<40;i++)c.tick(1/60);c.renderer.render(c.scene,c.camera);const data=c.renderer.domElement.toDataURL('image/png');c.setRenderOverride(old);return data;},[x,z,tx,ty,tz]);await fs.writeFile(output+'/'+name+'.png',Buffer.from(data.split(',')[1],'base64'));
 }
 await page.keyboard.press('Escape');reports.errors=[...new Set(errors)];await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));console.log('AURORA_REPORT:'+JSON.stringify(reports));if(reports.native.errors.length||reports.native.assets.errors.length)process.exitCode=1;
}catch(e){reports.fatal=e.stack;reports.errors=errors;await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));console.log('AURORA_REPORT:'+JSON.stringify(reports));process.exitCode=1;}
finally{
 await Promise.all(captures);for(const [name,p]of cache){const f=await p.catch(()=>null);if(!f||f.status!==200)continue;const safe=decodeURIComponent(name);if(safe.includes('..'))continue;const destination=output+'/runtime/site/'+safe;await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,f.body);}await fs.mkdir(output+'/runtime',{recursive:true});await fs.writeFile(output+'/runtime/external-index.json',JSON.stringify(external,null,2));await browser?.close();server.close();
}
