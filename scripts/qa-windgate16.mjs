import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const out='artifacts/windgate16';await fs.mkdir(out,{recursive:true});
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
 const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v16.html';
 await page.goto(base+'?qa=1&zone=mine',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패')||window.__auroraErrors?.length>0,null,{timeout:60000});
 report.boot=await page.evaluate(()=>({ready:document.body.dataset.ready,note:document.getElementById('load-note')?.textContent,errors:window.__auroraErrors,r:window.__auroraQA?.report()}));
 if(report.boot.ready!=='true')throw new Error('BOOT '+JSON.stringify(report.boot));
 report.forward=await page.evaluate(()=>window.__auroraQA.island.zone.testMineRoute(false));
 report.reverse=await page.evaluate(()=>window.__auroraQA.island.zone.testMineRoute(true));
 report.transition=await page.evaluate(async()=>{
   const z=window.__auroraQA.island.zone,a=window.__auroraQA.island;
   await z.exitMine({instant:true});const outside=z.current;
   await z.enterMine({instant:true});const inside=z.current;
   await z.exitMine({instant:true});const outside2=z.current;
   return{outside,inside,outside2,pass:outside==='island'&&inside==='mine'&&outside2==='island'};
 });
 async function shot(name,at){
   await page.evaluate(async at=>{const z=window.__auroraQA.island.zone;await z.enterMine({instant:true});const p=z.samples[Math.max(0,Math.min(z.samples.length-1,at))],n=z.samples[Math.min(z.samples.length-1,at+4)];ctx.player.setSpawn(p.p.x,27.45,p.p.z);ctx.player.setThird(true);ctx.player.setYaw(Math.atan2(n.p.x-p.p.x,p.p.z-n.p.z));ctx.player.setPitch(.05);for(let i=0;i<45;i++)ctx.tick(1/60);ctx.renderer.render(ctx.scene,ctx.camera);},at);await page.screenshot({path:out+'/'+name+'.png'});}
 await shot('mine-entry',3);await shot('mine-bend',20);await shot('mine-ore-room',35);
 report.final=await page.evaluate(()=>window.__auroraQA.report());
 report.accepted=report.forward.pass&&report.reverse.pass&&report.transition.pass&&report.final.zone?.oreNodes===5&&report.errors.length===0&&report.final.assets.errors.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}