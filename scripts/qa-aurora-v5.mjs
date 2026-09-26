import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import sharp from 'sharp';
const output='artifacts';await fs.mkdir(output,{recursive:true});
const base='https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v5.html';
const errors=[],reports={};let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1000,height:680},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 for(let attempt=0;attempt<12;attempt++){const r=await page.goto(base+'?view=overview&qa=1&shot=1&dpr=1&rev=5',{waitUntil:'domcontentloaded',timeout:60000});if(r.status()===200)break;await page.waitForTimeout(10000);}
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});
 reports.overview=await page.evaluate(()=>window.__auroraQA.report());
 // Actual framebuffer PNGs, not texture URLs. One render per view avoids remote rAF throttling.
 for(const place of ['overview','falls','shrine','workshop','dock']){
  const data=await page.evaluate(place=>{const a=window.__auroraQA;a.ctx.setRenderOverride(()=>{});if(place!=='overview')a.go(place);a.aim();a.ctx.renderer.render(a.ctx.scene,a.ctx.camera);return a.ctx.renderer.domElement.toDataURL('image/png');},place);
  const png=Buffer.from(data.split(',')[1],'base64');await fs.writeFile(output+'/'+place+'.png',png);
  const thumb=await sharp(png).resize({width:280}).jpeg({quality:42}).toBuffer();
  await fs.writeFile(output+'/'+place+'-thumb.jpg',thumb);
  console.log('AURORA_CAPTURE_'+place.toUpperCase()+':'+thumb.toString('base64'));
 }
 await page.goto(base+'?qa=1&shot=1&dpr=.75&rev=5',{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__auroraQA?.report().ready,{},{timeout:120000});
 await page.locator('summary').click();await page.locator('#native-test').click();
 await page.waitForFunction(()=>window.__auroraQA.testResult!==null,{},{timeout:60000});
 reports.native=await page.evaluate(()=>window.__auroraQA.report());
 // Manual trusted key hold, separate from the deterministic test.
 await page.locator('body > canvas').click({position:{x:500,y:400}});
 const before=await page.evaluate(()=>({p:{...ctx.player.pos},locked:document.pointerLockElement===ctx.renderer.domElement}));
 await page.keyboard.down('w');await page.waitForTimeout(2500);await page.keyboard.up('w');
 const after=await page.evaluate(()=>({p:{...ctx.player.pos},animation:window.__curAnim?.()}));reports.manual={before,after};
 await page.keyboard.press('Escape');reports.errors=[...new Set(errors)];
 await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));
 console.log('AURORA_REPORT:'+JSON.stringify(reports));
 if(reports.native.errors.length||reports.native.assets.errors.length)process.exitCode=1;
}catch(e){reports.fatal=e.stack;reports.errors=errors;await fs.writeFile(output+'/report.json',JSON.stringify(reports,null,2));console.log('AURORA_REPORT:'+JSON.stringify(reports));process.exitCode=1;}
finally{await browser?.close();}
