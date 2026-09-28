import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const out='artifacts/windgate15';await fs.mkdir(out,{recursive:true});
const root=process.cwd(),mime={html:'text/html',js:'application/javascript',png:'image/png',jpg:'image/jpeg',fbx:'application/octet-stream'};
const server=http.createServer(async(req,res)=>{try{const n=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\//,'').replace(/^tomob-deploy\//,''),p=path.resolve(root,n);if(!p.startsWith(root+'/')){res.writeHead(403);return res.end();}const b=await fs.readFile(p);res.writeHead(200,{'Content-Type':mime[n.split('.').pop()]||'application/octet-stream'});res.end(b);}catch(e){res.writeHead(404);res.end(String(e));}});
await new Promise(r=>server.listen(8787,'127.0.0.1',r));
const report={errors:[],http:[]};let browser,page;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(90000);
 page.on('pageerror',e=>report.errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.http.push({url:r.url(),status:r.status()});});
 const base='http://127.0.0.1:8787/tomob-deploy/sandbox-aurora-v15.html';
 await page.goto(base+'?view=overview&place=mine-mouth',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패')||window.__auroraErrors?.length>0,null,{timeout:60000});
 const boot=await page.evaluate(()=>({ready:document.body.dataset.ready,note:document.getElementById('load-note')?.textContent,errors:window.__auroraErrors,report:window.__auroraQA?.report()}));
 report.boot=boot;if(boot.ready!=='true')throw new Error('BOOT '+JSON.stringify(boot));
 async function shot(id){await page.evaluate(id=>{window.__auroraQA.go(id);window.__auroraQA.aim();ctx.renderer.render(ctx.scene,ctx.camera);},id);await page.screenshot({path:out+'/'+id+'.png'});}
 for(const id of['mine-mouth','mine-bend','mine-room'])await shot(id);
 report.geometry=await page.evaluate(async()=>{const THREE=await import('three'),a=window.__auroraQA,m=a.island.mine15,ray=new THREE.Raycaster();ray.firstHitOnly=true;const ceilings=[];
  for(const i of[12,30,48,66]){const p=m.rows[i];ray.set(new THREE.Vector3(p[0],p[1]+.2,p[2]),new THREE.Vector3(0,1,0));ray.far=12;const h=ray.intersectObjects(a.island.collide,true)[0];ceilings.push({i,d:h?.distance,obj:h?.object.name});}
  const s=m.rows[8],e=m.rows[80],A=new THREE.Vector3(s[0],s[1]+1.5,s[2]),B=new THREE.Vector3(e[0],e[1]+1.5,e[2]),d=B.clone().sub(A);ray.set(A,d.normalize());ray.far=A.distanceTo(B)-.2;
  return{ceilings,directViewBlocked:ray.intersectObjects(a.island.collide,true).length>0,oreCount:m.oreNodes.length,cut:m.cut,length:m.length,cameraCorrections:m.cameraCorrections};});

 await page.goto(base+'?qa=1&place=mine-mouth',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.body.dataset.ready==='true'||document.getElementById('load-note')?.textContent.includes('초기화 실패')||window.__auroraErrors?.length>0,null,{timeout:60000});
 const play=await page.evaluate(()=>({ready:document.body.dataset.ready,errors:window.__auroraErrors}));
 if(play.ready!=='true')throw new Error('PLAY_BOOT '+JSON.stringify(play));
 await page.locator('canvas').first().click({position:{x:640,y:450},force:true});await page.waitForFunction(()=>document.pointerLockElement!==null);
 await page.evaluate(()=>ctx.player.setThird(false));
 report.walk=await page.evaluate(()=>{
   const a=window.__auroraQA,m=a.island.mine15,rows=m.rows;
   const emit=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true}));
   const old=ctx.getRenderOverride();ctx.setRenderOverride(()=>{});
   const samples=[],run=(indices,label)=>{
     const start=rows[indices[0]];ctx.player.setSpawn(start[0],start[1]+1.45,start[2]);for(let k=0;k<50;k++)ctx.tick(1/60);
     emit('keydown','KeyW');let fail=null,total=0;
     for(let j=1;j<indices.length;j++){
       const target=rows[indices[j]];let n=0;
       while(Math.hypot(target[0]-ctx.player.pos.x,target[2]-ctx.player.pos.z)>1.05&&n<170){
         const p=ctx.player.pos;ctx.player.setYaw(Math.atan2(target[0]-p.x,p.z-target[2]));ctx.tick(1/60);n++;total++;
       }
       samples.push({label,index:indices[j],ticks:n,pos:{x:+ctx.player.pos.x.toFixed(2),y:+ctx.player.pos.y.toFixed(2),z:+ctx.player.pos.z.toFixed(2)}});
       if(n>=170){fail={label,index:indices[j],pos:{x:ctx.player.pos.x,y:ctx.player.pos.y,z:ctx.player.pos.z}};break;}
     }
     emit('keyup','KeyW');return{pass:!fail,fail,total};
   };
   try{
     const forward=run([3,18,33,48,63,78,87],'forward');
     const reverse=forward.pass?run([87,72,57,42,27,12,3],'reverse'):{pass:false,fail:{reason:'forward failed'},total:0};
     return{pass:forward.pass&&reverse.pass,forward,reverse,samples,method:'native W input + player yaw + fixed-step Rapier; six authored checkpoints each way'};
   }finally{emit('keyup','KeyW');ctx.setRenderOverride(old);}
 });

 report.final=await page.evaluate(()=>window.__auroraQA.report());
 report.accepted=report.geometry.oreCount===5&&report.geometry.directViewBlocked&&report.geometry.ceilings.every(x=>x.d>2&&x.d<9)&&report.walk.pass&&report.errors.length===0&&report.final.assets.errors.length===0;
 if(!report.accepted)process.exitCode=1;
}catch(e){report.fatal=e.stack;process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});}catch{}}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await browser?.close();server.close();}