import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const out='artifacts/windgate20b';await fs.mkdir(out,{recursive:true});
const root=process.cwd(),mime={html:'text/html',js:'application/javascript',png:'image/png',jpg:'image/jpeg',fbx:'application/octet-stream',wasm:'application/wasm',bin:'application/octet-stream'};
const server=http.createServer(async(req,res)=>{try{const n=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\//,'').replace(/^tomob-deploy\//,''),p=path.resolve(root,n);if(!p.startsWith(root+'/')){res.writeHead(403);return res.end();}const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':mime[n.split('.').pop()]||'application/octet-stream'});res.end(b);}catch(e){res.writeHead(404);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));

const report={errors:[],http:[]};let browser,page;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.http.push({url:r.url(),status:r.status()});});
 const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v20b.html';

 await page.goto(base+'?view=overview&place=ascent-blind20b',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패'),null,{timeout:70000});
 report.overview=await page.evaluate(()=>({ready:document.body.dataset.ready,errors:window.__auroraErrors,r:window.__auroraQA?.report()}));
 if(report.overview.ready!=='true')throw new Error('OVERVIEW '+JSON.stringify(report.overview));
 await page.screenshot({path:out+'/ascent-blind-overview.png'});
 await page.evaluate(()=>{window.__auroraQA.go('ruins-detail20b');window.__auroraQA.aim();ctx.renderer.render(ctx.scene,ctx.camera);});
 await page.waitForTimeout(250);
 await page.screenshot({path:out+'/ruins-detail-overview.png'});

 await page.goto(base+'?qa=1&place=ascent-blind20b',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:70000});
 report.play=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('canvas').first().click({position:{x:640,y:450},force:true});
 await page.waitForFunction(()=>document.pointerLockElement!==null);
 report.route=await page.evaluate(()=>window.__auroraQA.routeTest('main'));
 await page.evaluate(()=>{window.__auroraQA.go('ascent-blind20b');for(let i=0;i<40;i++)ctx.tick(1/60);ctx.renderer.render(ctx.scene,ctx.camera);});
 await page.screenshot({path:out+'/ascent-player.png'});

 const p=report.play.polish20b;
 report.accepted=report.play.build==='aurora-v20b-hand-polished'&&!!p&&p.authored===true&&p.terrainCarved===false&&p.sharedNativeRoute===true&&p.mineInteriorCreated===false&&p.ascentMasses>=8&&p.ruinBlocks>=4&&report.route.pass===true&&report.errors.length===0&&report.play.assets.errors.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});}catch{}}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}
