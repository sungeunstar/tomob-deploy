// fish.js — lowpoly 물고기 어군(Alstra PolyPack: 열대어4+상어). InstancedMesh + 거리 LOD.
//   ★카메라 추종 어군 — 수중 depth band(수면 아래 ~ 해저 위)에 스쿨 단위로 스폰, 멀어지면 카메라 근처로 재배치.
//   ★유영 = 강체 웨그(heading에 sin 요오 흔들림)+상하 bob. 저폴리 물고기는 리그 없음 → 절차적.
//   ★LOD: 근거리=매프레임 갱신 / 중거리=격프레임 / 원거리=인스턴스 스케일0(컬링). 어군은 fog·거리로 자연 소거.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE='/tomob-deploy/monter/optimized/';
// len=목표 몸길이(m). count=최대 마릿수. school=스쿨당 마리. 상어는 단독 배회.
const TYPES=[
  { file:'fish_v1', len:0.55, count:24, school:8 },
  { file:'fish_v2', len:0.60, count:20, school:7 },
  { file:'fish_v3', len:0.42, count:20, school:8 },
  { file:'fish_v4', len:0.70, count:16, school:6 },
  { file:'fish_shark', len:3.4, count:2,  school:1 },
];

export async function initFish(ctx, {
  radius=95,          // 카메라 기준 어군 활동 반경(밖으로 나가면 재배치)
  farCull=90,         // 이 거리 넘는 물고기 = 숨김(LOD 컬)
  midDist=38,         // 이 거리 넘으면 격프레임 갱신(LOD)
}={}){
  const { scene, camera, onUpdate } = ctx;
  const loader=new GLTFLoader();
  const _dummy=new THREE.Object3D(); const _up=new THREE.Vector3(0,1,0);
  const seaTop = -1.6;                                   // 어군 상한(수면 살짝 아래)
  const seaBot = (ctx.seabed?ctx.seabed.level:-25)+2.2;  // 어군 하한(해저 살짝 위)

  const groups=[];   // 타입별 { inst, fish:[], schools:[] }

  for(const T of TYPES){
    let glb; try{ glb=await new Promise((res,rej)=>loader.load(BASE+T.file+'.glb',res,undefined,rej)); }
    catch(e){ console.warn('[fish] load 실패', T.file, e&&e.message); continue; }
    // 지오메트리 병합(눈 등 서브메시 포함) + 정규화(길이=len, 중심 원점, 전방 +X)
    const geos=[]; let mat=null;
    glb.scene.updateMatrixWorld(true);
    glb.scene.traverse(o=>{ if(o.isMesh){ const g=o.geometry.clone(); g.applyMatrix4(o.matrixWorld); geos.push(g); if(!mat) mat=o.material; } });
    if(!geos.length){ continue; }
    let geo = geos.length>1 ? mergeGeometries(geos, false) : geos[0];
    if(!geo){ geo=geos[0]; }
    geo.computeBoundingBox(); const bb=geo.boundingBox, sz=new THREE.Vector3(); bb.getSize(sz);
    const s=T.len/(Math.max(sz.x,sz.y,sz.z)||1); const c=bb.getCenter(new THREE.Vector3());
    geo.translate(-c.x,-c.y,-c.z); geo.scale(s,s,s);
    const fmat=(mat?mat.clone():new THREE.MeshStandardMaterial({color:0x88aabb})); fmat.side=THREE.DoubleSide;
    const inst=new THREE.InstancedMesh(geo, fmat, T.count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); inst.frustumCulled=false; inst.renderOrder=-1;
    scene.add(inst);

    // 스쿨 + 개체 초기화(카메라 근처 무작위 배치)
    const schools=[], fish=[];
    const nSchool=Math.max(1, Math.ceil(T.count/T.school));
    for(let i=0;i<nSchool;i++){
      schools.push({ x:0,y:0,z:0, head:i*1.7, spd:(T.file==='fish_shark')?2.6:1.4+Math.random()*0.8, wt:Math.random()*6.28, seeded:false });
    }
    for(let i=0;i<T.count;i++){
      const sc=schools[i%nSchool];
      fish.push({ sc, ox:(Math.random()-0.5)*6, oy:(Math.random()-0.5)*3, oz:(Math.random()-0.5)*6,
        phase:Math.random()*6.28, bobF:0.6+Math.random()*0.5, wag:0.18+Math.random()*0.12, x:0,y:-10,z:0, tick:(i%3) });
    }
    groups.push({ T, inst, fish, schools });
  }

  // 스쿨 중심을 카메라 근처 수중에 시드/재배치
  function reseed(sc){
    const a=Math.random()*6.28, r=radius*(0.35+Math.random()*0.6);
    sc.x=camera.position.x+Math.cos(a)*r; sc.z=camera.position.z+Math.sin(a)*r;
    sc.y=seaBot + Math.random()*(seaTop-seaBot); sc.head=Math.random()*6.28; sc.seeded=true;
  }

  let _t=0, _frame=0;
  onUpdate(dt=>{
    _t+=dt; _frame++;
    const cx=camera.position.x, cz=camera.position.z;
    for(const G of groups){
      // 스쿨 이동(완만 배회) + 반경 밖이면 재배치
      for(const sc of G.schools){
        if(!sc.seeded){ reseed(sc); }
        sc.wt+=dt; sc.head += Math.sin(sc.wt*0.4+sc.x*0.01)*dt*0.6;    // 완만 선회
        sc.x += Math.cos(sc.head)*sc.spd*dt; sc.z += Math.sin(sc.head)*sc.spd*dt;
        sc.y += Math.sin(sc.wt*0.5)*dt*0.4;                            // 완만한 상하 유영
        if(sc.y>seaTop) sc.y=seaTop; if(sc.y<seaBot) sc.y=seaBot;
        if(Math.hypot(sc.x-cx, sc.z-cz) > radius) reseed(sc);          // 반경 밖 → 카메라 근처로
      }
      // 개체 갱신 + LOD
      const inst=G.inst; let anyFar=false;
      for(let i=0;i<G.fish.length;i++){
        const f=G.fish[i], sc=f.sc;
        const fx=sc.x+f.ox, fz=sc.z+f.oz;
        const dCam=Math.hypot(fx-cx, fz-cz);
        if(dCam>farCull){ // LOD 컬: 숨김(스케일0)
          _dummy.position.set(0,-9999,0); _dummy.scale.setScalar(0); _dummy.updateMatrix(); inst.setMatrixAt(i,_dummy.matrix); continue;
        }
        // 중거리 = 격프레임 갱신(LOD) — 위치 이전값 유지
        if(dCam>midDist && ((_frame + f.tick) % 3 !== 0)){ continue; }
        f.x=fx; f.z=fz; f.y=sc.y+f.oy + Math.sin(_t*f.bobF+f.phase)*0.25;    // 상하 bob
        const wag = Math.sin(_t*4.0+f.phase)*f.wag;                          // 강체 요오 웨그(꼬리 흔들 대체)
        const yaw = Math.atan2(-Math.sin(sc.head), Math.cos(sc.head)) + wag; // 전방 +X를 head 방향으로
        _dummy.position.set(f.x, f.y, f.z);
        _dummy.quaternion.setFromAxisAngle(_up, yaw);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix(); inst.setMatrixAt(i, _dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate=true;
    }
  });

  ctx.fish = { groups, reseed:()=>{ for(const G of groups) for(const sc of G.schools) sc.seeded=false; } };
  return ctx.fish;
}
