import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const out='artifacts/windgate17';await fs.mkdir(out,{recursive:true});
const root=process.cwd(),mime={html:'text/html',js:'application/javascript',png:'image/png',jpg:'image/jpeg',fbx:'application/octet-stream',wasm:'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const n=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\//,'').replace(/^tomob-deploy\//,''),p=path.resolve(root,n);if(!p.startsWith(root+'/')){res.writeHead(403);return res.end();}const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':mime[n.split('.').pop()]||'application/octet-stream'});res.end(b);}catch(e){res.writeHead(404);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const report={errors:[],http:[]};let browser,page;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.http.push({url:r.url(),status:r.status()});});
 const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v17.html';
 await page.goto(base+'?view=overview&place=summit17',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패')||window.__auroraErrors?.length>0,null,{timeout:65000});
 report.overview=await page.evaluate(()=>({ready:document.body.dataset.ready,note:document.getElementById('load-note')?.textContent,errors:window.__auroraErrors,r:window.__auroraQA?.report()}));
 if(report.overview.ready!=='true')throw new Error('OVERVIEW '+JSON.stringify(report.overview));
 await page.screenshot({path:out+'/summit-overview.png'});
 await page.goto(base+'?qa=1&place=summit17',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:65000});
 report.play=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('canvas').first().click({position:{x:640,y:460},force:true});await page.waitForFunction(()=>document.pointerLockElement!==null);
 report.move=await page.evaluate(()=>{
   const emit=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true})),old=ctx.getRenderOverride(),start={...ctx.player.pos};
   ctx.setRenderOverride(()=>{});emit('keydown','KeyW');for(let i=0;i<35;i++)ctx.tick(1/60);emit('keyup','KeyW');ctx.setRenderOverride(old);ctx.renderer.render(ctx.scene,ctx.camera);
   const p=ctx.player.pos;return{moved:Math.hypot(p.x-start.x,p.z-start.z),start,end:{...p},pass:Math.hypot(p.x-start.x,p.z-start.z)>.18&&Number.isFinite(p.y)};
 });
 await page.screenshot({path:out+'/summit-player.png'});
 const a=report.play.authored,s=report.play.summit;
 report.accepted=!!a&&a.mineYard===true&&a.terrainCarved===false&&a.decorativeColliders===false&&!!s&&s.manual===true&&s.terrainCarved===false&&s.newGameplayColliders===0&&s.approachStairs===5&&report.move.pass&&report.errors.length===0&&report.play.assets.errors.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}