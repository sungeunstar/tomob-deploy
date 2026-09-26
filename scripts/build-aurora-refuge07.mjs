import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const blob=t=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(t)+'\0').update(t).digest('hex');
const source=await fs.readFile('modules/aurora-expedition.js','utf8');
const page=await fs.readFile('sandbox-aurora-v6.html','utf8');
if(blob(source)!=='2fcde2d7c64dee7617da8cb02f88c7f7f9e3faa3'||blob(page)!=='457dac85a1f14de959041573eb0e8ac035d25adb')throw new Error('Base preview changed. Review template before regenerating.');
function once(text,from,to){if(text.split(from).length!==2)throw new Error('Ambiguous or missing template hook: '+from.slice(0,80));return text.replace(from,to);}
// Idempotent migrations resulting from actual framebuffer review.
let history=await fs.readFile('modules/aurora-refuge-history.js','utf8');
history=history.split('\n').filter(line=>!line.startsWith(' const sx=SUMMIT.x,sz=SUMMIT.z;for')).join('\n');
const oldRoots='for(let i=0;i<4;i++){beam([x+(rnd()-.5),y+h*.55,z+1.8],[x+(rnd()-.5)*4,y+.08,z+3+rnd()*2],.065+i*.023,wood,true);stats.roots++;}';
if(history.includes(oldRoots))history=once(history,oldRoots,'/* Continuous masonry-root geometry is owned by the polish module. */');
const colStart='function column(x,z,base,h,r=.7,tilt=0){const count=';
if(history.includes(colStart))history=once(history,colStart,'function column(x,z,base,h,r=.7,tilt=0){const ground=field.height(x,z);if(base>ground+.2)box([x,(base+ground)/2,z],[r*1.8,base-ground,r*1.8],wet,[0,0,0],true);const count=');
await fs.writeFile('modules/aurora-refuge-history.js',history);
let polish=await fs.readFile('modules/aurora-refuge-polish.js','utf8');
polish=polish.split('\n').filter(line=>!line.includes('const darkBack=add(')).join('\n');
polish=polish.replace("island.portal.U.uGlow.value.set('#40959c')","island.portal.U.uGlow.value.set('#57b8c5')").replace('island.portal.setOpen(.82)','island.portal.setOpen(.95)');
polish=polish.replace('new THREE.CylinderGeometry(1,1.35,1,6,2,false)','new THREE.CylinderGeometry(.10,1.35,1,7,4,false)');
polish=polish.replace('rWorld.y*3.1+rFbm(rWorld.xz*.23)*2.4','rWorld.y*1.1+rFbm(rWorld.xz*.15)*5.0').replace('.66+.24*rBroad+.12*rStrata+.13*rFine','.72+.18*rBroad+.05*rStrata+.13*rFine');
await fs.writeFile('modules/aurora-refuge-polish.js',polish);
let js=source.replaceAll('aurora-expedition-layout.js','aurora-refuge-field.js').replaceAll('initAuroraExpedition','initAuroraRefuge');
js="// Generated from pinned v6 template; authoring recipe: scripts/build-aurora-refuge07.mjs.\nimport {dressRefuge} from './aurora-refuge-history.js';\nimport {polishRefuge} from './aurora-refuge-polish.js';\n"+js;
js=once(js,"if(y<7||field.slope(x,z)>.5||field.nearPath", "if(field.ecology(x,z).cluster<.33||y>60||y<7||field.slope(x,z)>.5||field.nearPath");
js=once(js,'viewReserve(x,z,8)','viewReserve(x,z,10)');
js=once(js,"(1-smooth(1.5,3.1,field.paths[k]))*.94", "(1-smooth(1.15,2.8,field.paths[k]+.60*Math.sin(x*.7+z*.4)))*.76");
js=once(js,"i<field.lines.length;i+=6", "i<field.lines.length;i+=17");
js=once(js,"const buildingMat=mat('#f4f2e6',{map:atlas});", "const buildingMat=mat('#e7e3cf',{map:atlas});");
js=once(js,"new THREE.IcosahedronGeometry(1,1),p=g.attributes.position", "new THREE.DodecahedronGeometry(1,0),p=g.attributes.position");
// Centre trees on their root contact, not on an asymmetric crown's bounding-box centre.
const rootHook="scale=1/(fit==='height'?s.y:Math.max(s.x,s.y,s.z)),parts=[];g.scene.traverse";
js=once(js,rootHook,`scale=1/(fit==='height'?s.y:Math.max(s.x,s.y,s.z)),parts=[];if(path.includes('Tree_')){let n=0,sx=0,sz=0;const q=new THREE.Vector3();g.scene.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){q.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);if(q.y<bb.min.y+s.y*.045){sx+=q.x;sz+=q.z;n++;}}});if(n){c.x=sx/n;c.z=sz/n;}}g.scene.traverse`);
js=once(js,'if(a.color)a.color.multiplyScalar(.94);M.add(a);',`if(a.color)a.color.multiplyScalar(.96);const prev=a.onBeforeCompile;a.onBeforeCompile=function(s,r){prev?.call(this,s,r);s.fragmentShader=s.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\\nfloat foliageLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb=mix(vec3(foliageLuma),diffuseColor.rgb,.76);\\n');};a.customProgramCacheKey=()=> 'windgate07-native-foliage';M.add(a);`);
js=once(js,"\n return api;\n}", "\n const baseReady=api.ready;api.ready=baseReady.then(async()=>{await dressRefuge(ctx,api);polishRefuge(ctx,api);api.qualityVersion='aurora-v7c-refuge';return api;});\n return api;\n}");
js=js.replaceAll('aurora-v6-expedition','aurora-v7c-refuge').replaceAll('Aurora 06 / reveal-and-discover island','Windgate 07 / drowned sanctuary');
await fs.writeFile('modules/aurora-refuge.js',js);
let html=page.replaceAll('바람의 차원문 섬 06','바람이 기억하는 피난섬 07').replaceAll('ISLAND STUDY 06','WINDGATE / REFUGE 07').replaceAll('<h1>바람의 차원문 섬</h1>','<h1>바람이 기억하는 섬</h1>').replaceAll('initAuroraExpedition','initAuroraRefuge').replaceAll("./modules/aurora-expedition.js?v=6","./modules/aurora-refuge.js?v=7c").replaceAll('./sandbox-aurora-v5.html','./sandbox-aurora-v6.html');
html=once(html,'const views={falls:', 'const views={sunken:{eye:[14,16,182],at:[-15,1,145]},falls:');
html=once(html,'details:island.detailStats,','details:island.detailStats,history:island.historyStats,polish:island.polishStats,naturalization:island.field.naturalization,');
html=html.replaceAll('검수용 장소 이동','장소 둘러보기').replaceAll('지형과 기존 에셋을 불러오는 중','옛 돌길과 피난민 항구를 불러오는 중').replace('ctx.camera.position.set(243,232,290)','ctx.camera.position.set(214,198,240)').replace('ctx.sun.intensity=2.6','ctx.sun.intensity=2.1');
await fs.writeFile('sandbox-aurora-v7.html',html);
await fs.mkdir('artifacts/source/modules',{recursive:true});
const files=['aurora-refuge.js','aurora-refuge-field.js','aurora-refuge-history.js','aurora-refuge-polish.js'],manifest={};
for(const f of files){await fs.copyFile('modules/'+f,'artifacts/source/modules/'+f);manifest['modules/'+f]=blob(await fs.readFile('modules/'+f,'utf8'));}
await fs.copyFile('sandbox-aurora-v7.html','artifacts/source/sandbox-aurora-v7.html');manifest['sandbox-aurora-v7.html']=blob(html);
await fs.writeFile('artifacts/build.json',JSON.stringify({baseSource:blob(source),baseHTML:blob(page),files:manifest,nativeControllersModified:false},null,2));
console.log('Refuge 07 generated; previous preview and native gameplay files unchanged.');
