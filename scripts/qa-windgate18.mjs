import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const out='artifacts/windgate18';await fs.mkdir(out,{recursive:true});
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

 const island='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v18.html?place=mine-yard17&qa=1';
 await page.goto(island,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패'),null,{timeout:65000});
 report.island=await page.evaluate(()=>({ready:document.body.dataset.ready,build:window.__auroraQA?.report().build,errors:window.__auroraErrors,trigger:window.__auroraQA?.island.mineEntrance18?.trigger}));
 if(report.island.ready!=='true')throw new Error('ISLAND BOOT '+JSON.stringify(report.island));
 await page.evaluate(()=>{const a=window.__auroraQA.island.mineEntrance18.trigger;ctx.player.setSpawn(a.x,window.__auroraQA.island.groundAt(a.x,a.z,100)+1.5,a.z);for(let i=0;i<45;i++)ctx.tick(1/60);});
 const triggerVisible=await page.evaluate(()=>[...document.querySelectorAll('div')].some(x=>x.textContent.includes('바위그늘 광산 들어가기')&&getComputedStyle(x).display!=='none'));
 report.entryPrompt=triggerVisible;
 if(!triggerVisible)throw new Error('Mine E prompt not visible at entrance trigger');
 await page.locator('canvas').first().click({position:{x:640,y:450},force:true});await page.waitForFunction(()=>document.pointerLockElement!==null);
 const nav=page.waitForURL(/mine-windgate-01\.html/,{timeout:15000,waitUntil:'domcontentloaded'});await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e',bubbles:true})));await nav;

 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.body.dataset.fail==='true',null,{timeout:55000});
 report.mineBoot=await page.evaluate(()=>({ready:document.body.dataset.ready,fail:document.body.dataset.fail,r:window.__mineQA?.report(),errors:window.__mineErrors}));
 if(report.mineBoot.ready!=='true')throw new Error('MINE BOOT '+JSON.stringify(report.mineBoot));
 report.main=await page.evaluate(()=>window.__mineQA.testRoute('main',1/30));
 report.pocket=await page.evaluate(()=>window.__mineQA.testRoute('pocket',1/30));
 await page.evaluate(()=>{const m=window.__mineQA.mine;ctx.player.setSpawn(14,1.55,46);ctx.player.setThird(true);ctx.player.setYaw(Math.PI*.65);for(let i=0;i<50;i++)ctx.tick(1/60);ctx.renderer.render(ctx.scene,ctx.camera);});
 await page.evaluate(()=>{ctx.player.setSpawn(-23,1.55,22);ctx.player.setYaw(Math.PI/2);for(let i=0;i<45;i++)ctx.tick(1/60);ctx.renderer.render(ctx.scene,ctx.camera);});

 // Exit interaction.
 await page.evaluate(()=>{ctx.player.setSpawn(0,1.55,1.4);for(let i=0;i<45;i++)ctx.tick(1/60);});
 const exitVisible=await page.evaluate(()=>[...document.querySelectorAll('div')].some(x=>x.textContent.includes('섬으로 나가기')&&getComputedStyle(x).display!=='none'));
 report.exitPrompt=exitVisible;
 if(!exitVisible)throw new Error('Mine exit E prompt not visible');
 await page.locator('canvas').first().click({position:{x:640,y:450},force:true});await page.waitForFunction(()=>document.pointerLockElement!==null);
 const back=page.waitForURL(/sandbox-aurora-v18\.html/,{timeout:15000,waitUntil:'domcontentloaded'});await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE',key:'e',bubbles:true})));await back;

 report.accepted=report.entryPrompt&&report.main.pass&&report.pocket.pass&&report.exitPrompt&&report.mineBoot.r?.oreNodes===5&&report.errors.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;void 0}
finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}