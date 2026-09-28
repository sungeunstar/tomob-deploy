// Generated from pinned v6 template; authoring recipe: scripts/build-aurora-refuge07.mjs.
import {dressRefuge} from './aurora-refuge-history.js';
import {polishRefuge} from './aurora-refuge-polish-v15.js';
import {prepareMine15,carveMineTerrain15,mineReserve15,dressMine15} from './windgate15-mine-runtime.js?v=15d';
/** Aurora 06: a new sightline-led map using the existing native game modules.
 * The source of terrain geometry is aurora-refuge-field.js, not an imported island asset.
 * Native player/physics/water/portal and original KayKit/wharf files are not modified.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPortal } from 'https://sungeunstar.github.io/tomob-deploy/modules/portalfx.js?rev=v14';
import {SIZE,N,BUILDINGS,BASINS,fallAxes,basinRadius,axisDistance,SUMMIT,DOCK,BRIDGE,clamp,smooth,mix,createExpeditionField,inspectSightlines} from './aurora-refuge-field-v14.js';
const random=s=>()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
const HX='KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/blue/';
const NOISE=`
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return .57*noise21(p)+.28*noise21(p*2.03+4.7)+.15*noise21(p*4.07+11.3);}
`;
function stoneGeometry(){
 const g=new THREE.DodecahedronGeometry(1,0),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=1+.12*Math.sin(x*9+y*6+z*4);p.setXYZ(i,x*n,Math.round(y*4)/4*.86+y*.14,z*n);}
 g.computeVertexNormals();return g;
}
export async function initAuroraRefuge(ctx,options={}){
 if(!ctx.scene||!ctx.world||!ctx.RAPIER||!ctx.water?.mat?.uniforms)throw new Error('Initialize native core/physics/water first.');
 if(ctx.terrain)throw new Error('Aurora requires a fresh terrain context.');
 const {scene,world,RAPIER:R}=ctx,root=new THREE.Group(),field=prepareMine15(createExpeditionField()),rng=random(260926),buildings=BUILDINGS.map(b=>({...b}));
 const base=options.assetRoot||new URL('../',import.meta.url).href,url=p=>new URL(p,base).href;
 const G=new Set(),M=new Set(),T=new Set(),colliders=[],collide=[],supports=[],batch=[],jobs=[],ticks=[],cleanup=[];
 const assets={trees:0,rocks:0,buildings:[],dock:null,errors:[]},placements=[],waterRegions=[],basinQA=[];
 let disposed=false,hook=null;root.name='Windgate 07 / drowned sanctuary';scene.add(root);
 const mat=(c,o={})=>{const m=new THREE.MeshStandardMaterial({color:c,roughness:.93,...o});M.add(m);return m;};
 const stone=mat('#a1aaa0',{flatShading:true}),dark=mat('#627e77',{flatShading:true}),moss=mat('#658349'),wood=mat('#876a49'),wood2=mat('#594d3a'),bronze=mat('#ac9563',{metalness:.33,roughness:.6});
 // Shared stone shader: world-space mineral layers; no per-object maps.
 for(const m of [stone,dark]){const prior=m.onBeforeCompile;m.onBeforeCompile=function(s,r){prior?.call(this,s,r);s.vertexShader='varying vec3 artWorld;\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>',`vec4 artP=vec4(transformed,1.);
 #ifdef USE_INSTANCING