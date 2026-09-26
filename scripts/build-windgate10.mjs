import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const sha=s=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');
const read=p=>fs.readFile(p,'utf8');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw new Error('Template hook missing/ambiguous: '+a.slice(0,75));return s.replace(a,b);};
let source=await read('modules/aurora-refuge.js'),page=await read('sandbox-aurora-v7.html'),polish=await read('modules/aurora-refuge-polish.js');
if(sha(source)!=='c46353ff4debb0ca67268e5461257e10e1c98e58'||sha(page)!=='c84c979e00fe7a29122c9e0bbff7f2f7dfb062da'||sha(polish)!=='111dc4bbbf5220a9d578a9257b93bbc3f3350b5d')throw new Error('v7 source changed; review before building.');
source="import {prepareVault,carveVaultTerrain,dressWindgate10,vaultReserve} from './windgate10-vault.js';\n"+source;
source=source.replaceAll('initAuroraRefuge','initAuroraPassage').replaceAll('./aurora-refuge-polish.js','./windgate10-polish.js');
source=once(source,'field=createExpeditionField(),','field=prepareVault(createExpeditionField()),');
source=once(source,'const excluded=(x,z,pad=0)=>','const excluded=(x,z,pad=0)=>vaultReserve(x,z,pad)||');
source=once(source,'geo.setIndex(indices);geo.computeVertexNormals();','geo.setIndex(indices);geo.computeVertexNormals();carveVaultTerrain(geo,field);');
const oldSigns="for(const [x,z]of[[-58,30],[-101,7],[37,2],[59,13],[31,-28]]){const y=field.height(x,z);beam([x,y,z],[x,y+1.7,z],.065);box(x+.28,y+1.45,z,[.85,.22,.12],wood);}";
source=once(source,oldSigns,'// Replaced by the grounded directional atlas signs in dressWindgate10.');
source=once(source,'polishRefuge(ctx,api);','polishRefuge(ctx,api);dressWindgate10(ctx,api);');
source=source.replaceAll('aurora-v7c-refuge','aurora-v10-undercroft').replaceAll('Windgate 07 / drowned sanctuary','Windgate 10 / curved pilgrimage vault');
polish=once(polish,'if(y<8||sl<1.1','if(island.field.vaultReserve(x,z,4)||y<8||sl<1.1');
// This authored sample does not alter the player's controller or the preceding sample.
page=page.replaceAll('initAuroraRefuge','initAuroraPassage').replaceAll('./modules/aurora-refuge.js?v=7c','./modules/aurora-passage.js?v=10a').replaceAll('REFUGE 07','PASSAGE 10').replaceAll('피난섬 07','순례굴 섬 10').replaceAll('./sandbox-aurora-v6.html','./sandbox-aurora-v7.html?rev=7c');
if(!page.includes('aurora-passage.js'))throw new Error('Import hook did not match.');
page=once(page,'history:island.historyStats,','vault:island.vault?{length:island.vault.length,cut:island.vault.cut,signs:island.vault.signs,shoulders:island.vault.shoulders,cameraCorrections:island.vault.cameraCorrections}:null,history:island.historyStats,');
page=once(page,'const views={','const views={"vault-entry":{eye:[-29,61,-60],at:[-10,58,-75]},"vault-turn":{eye:[-7,59,-78],at:[-6,59,-86]},"vault-exit":{eye:[-22,68,-105],at:[-10,62,-93]},');
// Direction of the entrance camera looks into the first bend, not through both mouths.
page=page.replaceAll('옛 돌길과 피난민 항구를 불러오는 중','산 아래 굽은 순례굴을 불러오는 중');
let vault=await read('modules/windgate10-vault.js');
vault=once(vault,'const points=rows.map(r=>[r.p.x,r.p.z,r.p.y]);','const points=rows.map(r=>[r.p.x,r.p.z,r.p.y]);field.segmentsList=field.segmentsList.slice();field.routeDefs=field.routeDefs.slice();');
vault=once(vault,"field.routeDefs.push({id:'vault',name:'성소 아래 굽은 순례굴',width:6.4,points});","field.routeDefs.push({id:'vault',name:'성소 아래 굽은 순례굴',width:6.4,points});for(let i=points.length-1;i>0;i--)field.segmentsList.push({a:points[i],b:points[i-1],id:'vault-return',width:6.4,bridge:true});");
vault=once(vault,'ix.push(k,k+11,k+1,k+1,k+11,k+12);','ix.push(k,k+1,k+11,k+1,k+12,k+11);');
// Do not mutate the authored module on disk: corrected implementation gets its own generated path.
source=source.replaceAll('./windgate10-vault.js','./windgate10-vault-runtime.js');
const outputs={'modules/aurora-passage.js':source,'modules/windgate10-polish.js':polish,'modules/windgate10-vault-runtime.js':vault,'sandbox-aurora-v10.html':page};
await fs.mkdir('artifacts/source/modules',{recursive:true});
for(const[p,s]of Object.entries(outputs)){await fs.writeFile(p,s);await fs.writeFile('artifacts/source/'+p,s);}
await fs.copyFile('modules/windgate10-vault.js','artifacts/source/modules/windgate10-vault.js');
await fs.copyFile('modules/aurora-expedition-layout.js','artifacts/source/modules/aurora-expedition-layout.js');
await fs.writeFile('artifacts/build.json',JSON.stringify(Object.fromEntries(Object.entries(outputs).map(([p,s])=>[p,sha(s)])),null,2));
console.log('Windgate 10 generated additively. Native controllers and older previews unchanged.');
