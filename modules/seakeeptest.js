// seakeeptest.js — Sea Keep "Lonely Watcher" 완성 씬을 단일 테스트 섬으로 로드.
// ?testMap=sea-keep 전용. 본편 월드/세션은 변경하지 않는다.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const MODEL = '/island/sea-keep-lonely-watcher/source/Stronghold.fbx';
const TEXTURES = '/island/sea-keep-lonely-watcher/textures/';
const TARGET_SPAN = 520;

function materialsOf(mesh){
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
}

function isSceneBackdrop(mesh){
  const parts = [mesh.name];
  for(const mat of materialsOf(mesh)){
    parts.push(mat.name, mat.map?.name, mat.alphaMap?.name);
  }
  const label = parts.filter(Boolean).join(' ');
  // 원본 FBX는 배경 하늘 이름이 `skydome`처럼 구분자 없이 붙어 있다.
  // 단어 경계만 검사하면 이 메시가 남아 본편 하늘을 통째로 덮는다.
  return /(^|[_.\s-])(sea|sky|ocean|water)([_.\s-]|$)/i.test(label)
    || /sky\s*dome|skydome|sea\s*(plane|mesh|surface)|ocean\s*(plane|mesh|surface)/i.test(label);
}

function tuneMaterial(mat){
  if(mat.map){
    mat.map.colorSpace = THREE.SRGBColorSpace;
    // FBX의 legacy diffuse 색이 검정이면 텍스처가 정상이어도 최종색이
    // texture * color = black이 된다. 본편 PBR 에셋처럼 텍스처 원색을 기준으로 정규화한다.
    // 본편의 전역 색감은 건드리지 않고, 원본 알베도가 어두운 Sea Keep 재질만 보정한다.
    // linear multiplier라 텍스처의 색상 관계는 유지되고 본편 하늘·바다에는 영향이 없다.
    if(mat.color) mat.color.setRGB(1.35, 1.35, 1.35);
  }
  if(mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
  if(mat.emissive) mat.emissive.set(0x000000);
  if('opacity' in mat) mat.opacity = 1;
  if('metalness' in mat) mat.metalness = 0;
  if('roughness' in mat) mat.roughness = Math.max(0.72, mat.roughness || 0);
  if('shininess' in mat) mat.shininess = Math.min(18, mat.shininess ?? 18);
  mat.side = THREE.DoubleSide;
  if(mat.alphaMap){ mat.transparent = false; mat.alphaTest = Math.max(mat.alphaTest || 0, 0.35); }
  else { mat.transparent = false; mat.alphaTest = 0; }
  mat.needsUpdate = true;
}

function removeOldTestBase(terrain, scene){
  const old = Array.isArray(terrain?._allObjs) ? terrain._allObjs.slice() : [];
  for(const obj of old){
    const i = terrain.collide?.indexOf(obj) ?? -1;
    if(i >= 0) terrain.collide.splice(i, 1);
    try{ terrain.removeTrimesh?.(obj); }catch(_){}
    obj.visible = false;
    scene.remove(obj);
  }
  if(terrain) terrain._allObjs = [];
}

function chooseSpawn(root, box, waterLevel){
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const zBands = [0.12, 0.2, 0.3, 0.42];
  const xBands = [0, -0.12, 0.12, -0.25, 0.25];
  for(const zf of zBands){
    for(const xf of xBands){
      const x = center.x + size.x * xf;
      const z = box.min.z + size.z * zf;
      rc.set(new THREE.Vector3(x, box.max.y + 100), down);
      rc.far = size.y + 300;
      const hit = rc.intersectObject(root, true).find(h => h.point.y > waterLevel + 1.2);
      if(hit) return { x:hit.point.x, y:hit.point.y + 3, z:hit.point.z };
    }
  }
  rc.set(new THREE.Vector3(center.x, box.max.y + 100, center.z), down);
  rc.far = size.y + 300;
  const hit = rc.intersectObject(root, true).find(h => h.point.y > waterLevel + 1.2);
  return hit ? { x:hit.point.x, y:hit.point.y + 3, z:hit.point.z }
    : { x:center.x, y:box.max.y + 3, z:center.z };
}

export async function initSeaKeepTest(ctx, opts={}){
  const loader = new FBXLoader();
  loader.setResourcePath(TEXTURES);
  const root = await loader.loadAsync(encodeURI(MODEL));
  root.name = 'SeaKeep_LonelyWatcher';

  const removed = [];
  let meshes = 0, triangles = 0;
  root.traverse(obj => {
    if(!obj.isMesh) return;
    meshes++;
    triangles += obj.geometry?.index ? obj.geometry.index.count / 3 : (obj.geometry?.attributes?.position?.count || 0) / 3;
    if(isSceneBackdrop(obj)){ removed.push(obj); return; }
    for(const mat of materialsOf(obj)) tuneMaterial(mat);
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = true;
  });
  for(const obj of removed) obj.parent?.remove(obj);

  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  const rawSize = box.getSize(new THREE.Vector3());
  const span = Math.max(rawSize.x, rawSize.z) || 1;
  const scale = TARGET_SPAN / span;
  root.scale.setScalar(scale);
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.x += opts.position?.x || 0;
  root.position.z += opts.position?.z || 0;
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);

  if(opts.replaceBase !== false) removeOldTestBase(ctx.terrain, ctx.scene);
  ctx.scene.add(root);
  root.updateWorldMatrix(true, true);
  ctx.terrain.collide.push(root);
  ctx.terrain._allObjs.push(root);
  root.userData._bodies = [];
  root.traverse(obj => {
    if(!obj.isMesh || !obj.visible || isSceneBackdrop(obj)) return;
    try{ ctx.terrain.addTrimeshMesh?.(obj, root); }catch(e){ console.warn('[sea-keep] collision skip', obj.name, e?.message); }
  });
  ctx.terrain.bvhize?.(root);

  const waterLevel = ctx.water?.level ?? 0;
  const islandSpawn = chooseSpawn(root, box, waterLevel);
  if(opts.replaceBase !== false) ctx.terrain.spawn = islandSpawn;
  const size = box.getSize(new THREE.Vector3());
  const info = {
    root, meshes:meshes-removed.length, removed:removed.length,
    triangles:Math.round(triangles), scale,
    size:{ x:size.x, y:size.y, z:size.z }, spawn:{...islandSpawn}, embedded:opts.replaceBase === false
  };
  ctx.seaKeepTest = info;
  window.__seaKeep = info;
  console.log('[sea-keep] Lonely Watcher 테스트 섬 로드', info);
  return info;
}
