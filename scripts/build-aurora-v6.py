from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
p=ROOT/'modules/aurora-artpass.js'
s=p.read_text()
a=s.index('const SIZE=284,N=200;');b=s.index('const NOISE=')
s=s[:a]+'''import {SIZE,N,BUILDINGS,BASINS,fallAxes,basinRadius,axisDistance,SUMMIT,DOCK,BRIDGE,clamp,smooth,mix,createExpeditionField,inspectSightlines} from './aurora-expedition-layout.js';
const random=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const HX='KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/blue/';
'''+s[b:]
s=s.replace("import { createIslandField } from './aurora-island.js';\n",'')
s=s.replace('initAuroraArtpass','initAuroraExpedition').replace('field=createIslandField(),rng=random(260926),buildings=sculptTerrain(field)', 'field=createExpeditionField(),rng=random(260926),buildings=BUILDINGS.map(b=>({...b}))')
s=s.replace('Aurora 05 / authored environments','Aurora 06 / reveal-and-discover island').replace('aurora05','aurora06')
s=s.replace("Math.hypot(x+9,z+41)","Math.hypot(x-SUMMIT.x,z-SUMMIT.z)")
s=s.replace("const nearWater=", """// Preserve a cone around selected landmark views; terrain still occludes hidden views.
 const sightTests=inspectSightlines(field);
 const corridors=[['landing',[3,76,-84]],['grove',[3,76,-84]],['falls',[-79,37,-23]]].map(([id,t])=>({p:field.points.find(p=>p.id===id),t}));
 function viewReserve(x,z,r=4){return corridors.some(({p,t})=>{const a=axisDistance([p.x,p.z,t[0],t[2]],x,z);return a.t>0&&a.t<1&&a.d<r;});}
 const nearWater=""")
s=s.replace('cliffs.length<140','cliffs.length<210').replace('(rng()-.5)*224','(rng()-.5)*300').replace('(rng()-.5)*205','(rng()-.5)*308')
s=s.replace('field.nearPath(x,z).d<7||excluded(x,z,2)','field.nearPath(x,z).d<7||viewReserve(x,z,5)||excluded(x,z,2)')
a=s.index(' // Extended to dry bank');b=s.index(' // Water is clipped',a)
s=s[:a]+''' // One continuous walkable deck across the gorge. The river is not filled in.
 const bridgeY=field.bridgeY,bp=[],bi=[],steps=92;
 for(let i=0;i<=steps;i++){const x=mix(BRIDGE.x0,BRIDGE.x1,i/steps),y=bridgeY(x);bp.push(x,y,BRIDGE.z-BRIDGE.width/2,x,y,BRIDGE.z+BRIDGE.width/2);if(i<steps){const k=i*2;bi.push(k,k+1,k+2,k+1,k+3,k+2);box(x+.23,y-.1,BRIDGE.z,[.45,.2,BRIDGE.width],i%5?wood:wood2);}}
 const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute(bp,3));bg.setIndex(bi);bg.computeVertexNormals();const invisible=mat('#fff');invisible.visible=false;mesh(bg,invisible,0,0,0,[1,1,1],true,false);
 for(const z of[BRIDGE.z-2.2,BRIDGE.z+2.2])for(let i=0;i<=12;i++){const x=mix(BRIDGE.x0,BRIDGE.x1,i/12),y=bridgeY(x);beam([x,y,z],[x,y+1.15,z]);if(i<12){const x2=mix(BRIDGE.x0,BRIDGE.x1,(i+1)/12);beam([x,y+1.03,z],[x2,bridgeY(x2)+1.03,z],.045);}}
'''+s[b:]
a=s.index(' // Summit:');b=s.index(' const atlasURL=',a)
summit=s[a:b]
summit=summit.replace('const py=46,cx=-9,cz=-41;', 'const py=SUMMIT.y,cx=SUMMIT.x,cz=SUMMIT.z;')
summit=summit.replace('y:46.635','y:py+.635').replace('baseY=46.62,springY=50.75','baseY=py+.62,springY=py+6.65')
summit=summit.replace('baseY+.72+i*.76','baseY+1+i*1.064').replace('[1.04,.73,1.38]','[1.04,1.025,1.38]').replace('box(x,50.6,cz','box(x,py+6.44,cz')
summit=summit.replace('cx,springY,cz,[1,1,1],true','cx,springY,cz,[1,1.4,1],true').replace('h:7.0','h:9.8').replace('cx,50.13,cz+.02','cx,py+5.782,cz+.02')
summit=summit.replace("[[-18,-37,3.2],[.8,-35,1.8],[-19,-49,2.1],[1,-49,4.0]]", "[[cx-9,cz+4,3.2],[cx+9.8,cz+6,1.8],[cx-10,cz-8,2.1],[cx+10,cz-8,4.0]]")
summit=summit.replace('x,46+h/2,z','x,py+h/2,z').replace('x,46+h,z','x,py+h,z').replace('z>-31&&Math.abs(x+9)<3','z>cz+10&&Math.abs(x-cx)<3').replace('46.685','py+.685').replace('const y=47+rng()*6.9','const y=py+1+rng()*10.0')
s=s[:a]+summit+s[b:]
s=s.replace("scaleVsV4:+(b.size/b.old).toFixed(3),", "targetSpan:b.size,")
# Dock relocation, keeping the original OBJ and real deck detection.
s=s.replace('h.position.set(-48,4.85-sz.y*.98,108)', 'h.position.set(DOCK.x,DOCK.deck-sz.y*.98,DOCK.z)')
s=s.replace('for(let z=87;z<108&&!anchor;z+=.5)', 'for(let z=DOCK.z-DOCK.span/2;z<DOCK.z&&!anchor;z+=.5)')
s=s.replace('new THREE.Vector3(-48,20,z)', 'new THREE.Vector3(DOCK.x,25,z)').replace('new THREE.Vector3(-48,field.height(-48,82)+.08,82)', 'new THREE.Vector3(DOCK.x,field.height(DOCK.x,DOCK.shoreZ)+.08,DOCK.shoreZ)')
# Broader forest masses on the new island; reserve main tread and view cones.
s=s.replace('i<9000&&placements.length<225','i<19000&&placements.length<430').replace('(rng()-.5)*212','(rng()-.5)*282').replace('(rng()-.5)*188','(rng()-.5)*288')
s=s.replace('field.nearPath(x,z).d<5.5||Math.hypot(x+25,z-10)<9', 'field.nearPath(x,z).d<5.2||viewReserve(x,z,8)')
s=s.replace('const h=6+rng()*5.8', 'const h=7.5+rng()*7.5')
s=s.replace('(rng()-.5)*214', '(rng()-.5)*280').replace('stones.length<65', 'stones.length<90')
s=s.replace('(rng()-.5)*219', '(rng()-.5)*288').replace('(rng()-.5)*190', '(rng()-.5)*290').replace('i<13000&&grassItems.length<3200','i<16000&&grassItems.length<3800')
s=s.replace('spawn:{x:-43,y:field.height(-43,66)+2.3,z:66},radius:145','spawn:{x:-64,y:field.height(-64,108)+2.3,z:108},radius:180')
s=s.replace("바람의 차원문 섬 · 05", "바람의 차원문 섬 · 06").replace("qualityVersion:'aurora-v5b-artpass'", "qualityVersion:'aurora-v6-expedition',sightlines:sightTests")
# Re-establish distinct authored pockets, rather than randomly putting more buildings on flat land.
a=s.index(' const ray=new THREE.Raycaster(),origin=')
s=s[:a]+''' // The abandoned gate on the middle route frames a brief summit glimpse.
 const relics=[];for(const [x,z,h]of[[38,-47,3.8],[48,-48,2.8],[39,-35,1.4]]){const y=field.height(x,z);mesh(new THREE.CylinderGeometry(.55,.72,h,7),stone,x,y+h/2,z,[1,1,1],true);box(x,y+h,z,[1.6,.25,1.5],dark,true);}
 for(let i=0;i<25;i++){const x=38+rng()*15,z=-49+rng()*18;if(field.nearPath(x,z).d<3.5)continue;relics.push({x,y:field.height(x,z)+.1,z,s:[.35+rng()*.55,.2+rng()*.25,.3+rng()*.45],rot:rng()*6.28});}inst(rockG,stone,relics,'Broken wayside sanctuary');
 // Short rail fragment uses the existing mine as its endpoint; it is not a fake tunnel.
 for(const x of[-105.5,-104.2])for(let i=0;i<7;i++){const z=-37-i*.9,y=field.height(x,z)+.10;box(x,y,z,[.055,.07,.92],bronze);if(x===-105.5)box(x+.65,y-.04,z,[2.0,.10,.18],wood2);}
 // A sheltered optional beach gets a natural arch and an appropriately small camp.
 const beachArchX=116,beachArchZ=86,beachY=field.height(beachArchX,beachArchZ);
 for(let i=0;i<9;i++){const a=i/8*Math.PI;const x=beachArchX+Math.cos(a)*6,y=beachY+Math.sin(a)*7.5;mesh(rockG,stone,x,y+1,beachArchZ,[2.2,2.1,2.6],true);}
 // Small signposts identify choices without drawing the full route across the map.
 for(const [x,z]of[[-58,30],[-101,7],[37,2],[59,13],[31,-28]]){const y=field.height(x,z);beam([x,y,z],[x,y+1.7,z],.065);box(x+.28,y+1.45,z,[.85,.22,.12],wood);}
'''+s[a:]
s='''/** Aurora 06: a new sightline-led map using the existing native game modules.
 * The source of terrain geometry is aurora-expedition-layout.js, not an imported island asset.
 * Native player/physics/water/portal and original KayKit/wharf files are not modified.
 */\n'''+s[s.index("import * as THREE"):]
a=s.index(' for(const a of fallAxes)for(let i=0;i<5;i++)');b=s.index(' hulls(inst(rockG,dark,bankRocks',a);s=s[:a]+s[b:]
(ROOT/'modules/aurora-expedition.js').write_text(s, encoding='utf-8')
