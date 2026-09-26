import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import sharp from 'sharp';
const output='artifacts';await fs.mkdir(output,{recursive:true});
const ref=process.env.GITHUB_SHA||'main';const remote='https://raw.githubusercontent.com/sungeunstar/tomob-deploy/'+ref+'/';
const cache=new Map(),mime={html:'text/html',js:'application/javascript',json:'application/json',gltf:'model/gltf+json',glb:'model/gltf-binary',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',wasm:'application/wasm'};
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname.replace(/^\/tomob-deploy\//,'').replace(/^\//,'');if(!cache.has(path))cache.set(path,fetch(remote+path).then(async r=>({status:r.status,body:Buffer.from(await r.arrayBuffer())})));const file=await cache.get(path);res.writeHead(file.status,{'Content-Type':mime[path.split('.').pop()]||'application/octet-stream'});res.end(file.body);}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v5.html';
const errors=[],reports={sourceCommit:ref,testOrigin:'commit-pinned local static server'};let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1000,height:680},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(base+'?view=overview&qa=1&shot=1&dpr=1',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});
 reports.overview=await page.evaluate(()=>window.__auroraQA.report());
 for(const place of ['overview','falls','shrine','workshop','dock']){
  const data=await page.evaluate(place=>{const a=window.__auroraQA;a.ctx.setRenderOverride(()=>{});if(place!=='overview')a.go(place);a.aim();a.ctx.renderer.render(a.ctx.scene,a.ctx.camera);return a.ctx.renderer.domElement.toDataURL('image/png');},place);
  const png=Buffer.from(data.split(',')[1],'base64');await fs.writeFile(output+'/'+place+'.png',png);
  const thumb=await sharp(png).resize({width:280}).jpeg({quality:42}).toBuffer();await fs.writeFile(output+'/'+place+'-thumb.jpg',thumb);console.log('AURORA_CAPTURE_'+place.toUpperCase()+':'+thumb.toString('base64'));
 }
 await page.goto(base+'?qa=1&shot=1&dpr=.75',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});
 await page.locator('summary').click();await page.locator('#native-test').click();
 await page.waitForFunction(()=>window.__auroraQA.testResult!==null,{},{timeout:60000});reports.native=await page.evaluate(()=>window.__auroraQA.report());
 await page.locator('body > canvas').click({position:{x:500,y:400}});
 const before=await page.evaluate(()=>({p:{...ctx.player.pos},locked:document.pointerLockElement===ctx.renderer.domElement}));
 await page.keyboard.down('w');await page.waitForTimeout(2500);await page.keyboard.up('w');
 const after=await page.evaluate(()=>({p:{...ctx.player.pos},animation:window.__curAnim?.()}));reports.manual={before,after};
 await page.keyboard.press('Escape');reports.errors=[...new Set(errors)];await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));console.log('AURORA_REPORT:'+JSON.stringify(reports));
 if(reports.native.errors.length||reports.native.assets.errors.length)process.exitCode=1;
}catch(e){reports.fatal=e.stack;reports.errors=errors;await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));console.log('AURORA_REPORT:'+JSON.stringify(reports));process.exitCode=1;}
finally{await browser?.close();server.close();}
