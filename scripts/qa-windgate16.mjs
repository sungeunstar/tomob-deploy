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
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(60000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.http.push({url:r.url(),status:r.status()});});
 // 1) Isolated native player/physics traversal.
 await page.goto('http://127.0.0.1:8787/tomob-deploy/sandbox-mine16-isolated.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.body.dataset.fail==='true',null,{timeout:45000});
 const isolated=await page.evaluate(()=>({ready:document.body.dataset.ready,fail:document.body.dataset.fail,report:window.__mine16?.report(),errors:window.__errors}));
 if(isolated.ready!=='true')throw new Error('ISOLATED BOOT '+JSON.stringify(isolated));
 report.forward=await page.evaluate(()=>window.__mine16.zone.testMineRoute(false,1/60));
 report.reverse=await page.evaluate(()=>window.__mine16.zone.testMineRoute(true,1/60));
 report.isolated=await page.evaluate(()=>window.__mine16.report());
 await page.screenshot({path:out+'/isolated-interior.png'});
 // 2) Full island integration only verifies boot + zone switch + real render, not thousands of island physics steps.
 await page.goto('http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v16.html?zone=mine',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패')||window.__auroraErrors?.length>0,null,{timeout:60000});
 report.full=await page.evaluate(()=>({ready:document.body.dataset.ready,note:document.getElementById('load-note')?.textContent,errors:window.__auroraErrors,r:window.__auroraQA?.report()}));
 if(report.full.ready!=='true')throw new Error('FULL BOOT '+JSON.stringify(report.full));
 await page.screenshot({path:out+'/full-island-mine.png'});
 report.accepted=report.forward.pass&&report.reverse.pass&&report.isolated.oreNodes===5&&report.full.r?.zone?.current==='mine'&&report.errors.length===0&&report.full.r?.assets?.errors?.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}