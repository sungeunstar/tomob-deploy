// campfire.js — 🔥 모닥불: 제작(나무3·돌2) → 퀵슬롯 장착 → 지면 설치. 불꽃VFX+불빛+밤 온기(추위 방지).
//   ★설치 방식: 기존 B그리드건설과 별개. 퀵슬롯 'campfire' 선택 → 지면 고스트 → 좌클릭 배치(인벤 1 소모).
//   ★온기: temperature.js가 ctx.campfire.warmth(pos)로 근처 모닥불 온도를 더함 → 밤에 얼지 않음.
//   불꽃 = volfire.js 볼류메트릭(레이마칭 GLSL, 열 램프). 불빛 = 따뜻한 PointLight(깜빡임).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeVolFire } from '/tomob-deploy/modules/volfire.js';

const MODEL='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/campfire-pit.glb';

export async function initCampfire(ctx){
  const { scene, camera } = ctx;

  // ── 모닥불 장작 프로토타입 ──
  let proto=null;
  try{ const g=await new GLTFLoader().loadAsync(MODEL); proto=g.scene;
    proto.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; const ms=Array.isArray(o.material)?o.material:[o.material]; ms.forEach(m=>{ if(m&&m.map)m.map.colorSpace=THREE.SRGBColorSpace; }); } });
  }catch(e){ console.warn('[campfire] 모델 로드 실패', e&&e.message); }

  const fires=[];   // {grp, light, vf, pos}
  const WARM_R=7.0;     // 온기 반경(m)
  const WARM_DEG=16;    // 중심 온기(°C 가산) — 밤 추위 상쇄
  const MODEL_SCALE=5;  // campfire-pit 원본 0.28m → ×5 ≈ 1.4m(케니 킷은 초소형이라 확대)
  const FIRE_Y=0.95;                       // 불 박스 중심 높이(장작 위)
  const FIRE_SCALE=new THREE.Vector3(1.4,1.85,1.4);   // 모닥불 불 크기(가로,세로,가로)
  const BURN_R=1.3, BURN_DUR=3.0, BURN_DPS=6;   // 🔥 불 속 반경 / 나온 뒤 잔불 지속(s) / 화상 DPS
  let _burnUntil=0, _burnAcc=0, _burning=false;

  // 🔥 라이트 풀(상주·intensity 0=꺼짐) + 볼륨불 셰이더 프리워밍 — 모닥불마다 PointLight를 새로 scene.add하면
  //   씬 전체 셰이더 재컴파일 히칫([[voyage-light-recompile-trap]]). 풀에서 대여(개수 불변) + 첫 불 셰이더 미리 컴파일.
  const POOL=3, lightPool=[];   // ⚡2026-07-22 6→3 — 노는 광원도 셰이더에 들어가 픽셀마다 계산된다(전투 프레임 드랍 주원인)
  for(let i=0;i<POOL;i++){ const L=new THREE.PointLight(0xffa24a,0,18,2.0); L.castShadow=false; L.visible=true; scene.add(L); lightPool.push(L); }
  let _warmed=false;

  function spawnFire(x,y,z){
    const grp=new THREE.Group(); grp.position.set(x,y,z);
    if(proto){ const m=proto.clone(true); m.scale.setScalar(MODEL_SCALE); grp.add(m); }
    // 🔥 볼류메트릭 불(레이마칭) — 바닥 흰코어 → 주황 → 붉은 끝
    const vf=makeVolFire({ color:0xfff0dc, iterations:20, exposure:1.5 });
    vf.scale.copy(FIRE_SCALE); vf.position.set(0,FIRE_Y,0);
    grp.add(vf);
    scene.add(grp);
    const light=lightPool[fires.length % POOL];   // ★풀 대여(새 add 없음=재컴파일 없음). 모닥불은 static이라 월드 위치 1회 고정.
    light.position.set(x, y+0.8, z);
    const fire={ grp, light, vf, pos:new THREE.Vector3(x,y,z) };
    fires.push(fire); return fire;
  }

  // ── 설치(퀵슬롯 'campfire' 선택 시) ──
  let placing=false; let ghost=null;
  const _rc=new THREE.Raycaster(), _fwd=new THREE.Vector3();
  function groundMeshes(){ return (ctx.environment&&ctx.environment.groundMeshes) || (ctx.terrain&&ctx.terrain.collide) || []; }
  function aimGround(){ camera.getWorldDirection(_fwd); _rc.set(camera.position,_fwd); _rc.far=60;
    const hit=_rc.intersectObjects(groundMeshes(),true); return hit.length?hit[0].point:null; }
  function makeGhost(){ if(ghost) return; ghost=proto?proto.clone(true):new THREE.Group();
    ghost.scale.setScalar(MODEL_SCALE);
    ghost.traverse(o=>{ if(o.isMesh){ o.material=o.material.clone?o.material.clone():o.material; if(o.material){o.material.transparent=true; o.material.opacity=0.55;} } });
    ghost.visible=false; scene.add(ghost); }
  function startPlace(id){ if(id!=='campfire') return false;
    if(ctx.inventory && ctx.inventory.count('campfire')<=0) return false;
    placing=true; makeGhost();
    const el=ctx.renderer.domElement; if(el&&el.requestPointerLock) el.requestPointerLock();
    return true; }
  function stopPlace(){ placing=false; if(ghost)ghost.visible=false; }
  function doPlace(){ if(!placing) return; const p=aimGround(); if(!p) return;
    spawnFire(p.x,p.y,p.z);
    ctx.sound?.play?.('build_place');
    if(ctx.inventory){ ctx.inventory.remove('campfire',1); if(ctx.updHotbar)ctx.updHotbar(); }
    if(ctx.inventory && ctx.inventory.count('campfire')<=0) stopPlace();   // 소진 → 배치 종료
  }
  ctx.renderer.domElement.addEventListener('mousedown',e=>{ if(e.button===0 && placing){ doPlace(); } });
  addEventListener('keydown',e=>{ if(e.code==='Escape'&&placing) stopPlace(); });

  // ── 매 프레임: 고스트 + 불꽃/불빛 애니 ──
  let t=0;
  ctx.onUpdate(dt=>{ dt=dt??0.016; t+=dt;
    // 🔥 볼륨불 셰이더 프리워밍(1회) — 첫 모닥불서 레이마칭 셰이더 컴파일 멈칫 제거.
    if(!_warmed && ctx.renderer && camera){ _warmed=true;
      try{ const w=makeVolFire({color:0xfff0dc,iterations:20,exposure:1.5}); w.scale.copy(FIRE_SCALE); w.position.set(0,-9999,0); scene.add(w);
        ctx.renderer.compile(scene, camera); scene.remove(w); if(w.geometry)w.geometry.dispose(); }catch(_){}
    }
    if(placing && ghost){ const p=aimGround(); if(p){ ghost.visible=true; ghost.position.copy(p); } else ghost.visible=false; }
    const flick=0.82+Math.sin(t*7.0)*0.11+Math.sin(t*12.3+1.1)*0.05+(Math.random()-0.5)*0.06;
    for(const fr of fires){ fr.light.intensity=11*flick;
      fr.vf.update(t);   // 🔥 볼류메트릭 불 시간·역행렬 갱신
    }
    // 🔥 불 속 진입 = 화상: 몸에 불붙는 VFX(magic.burnPlayer) + DoT(envHurt). 나온 뒤에도 BURN_DUR 동안 잔불.
    if(ctx.player && fires.length){
      const pp=ctx.player.pos; let inFire=false;
      for(const fr of fires){ const dx=pp.x-fr.pos.x, dz=pp.z-fr.pos.z; if(dx*dx+dz*dz<BURN_R*BURN_R){ inFire=true; break; } }
      if(inFire) _burnUntil = t + BURN_DUR;
      if(t < _burnUntil){
        _burnAcc += BURN_DPS*dt;
        if(_burnAcc>=1 && ctx.combat && !ctx.combat.isDead?.()){ const d=Math.floor(_burnAcc); _burnAcc-=d; ctx.combat.envHurt?.(d,'fire'); }
        if(!_burning){ _burning=true; ctx.magic?.burnPlayer?.(true); }
      } else if(_burning){ _burning=false; _burnAcc=0; ctx.magic?.burnPlayer?.(false); }
    }
  });

  // ── 온기: temperature.js가 호출. 가장 가까운 모닥불 반경 내면 거리비례 온도 가산 ──
  function warmth(pos){ if(!pos||!fires.length) return 0; let best=0;
    for(const fr of fires){ const dx=pos.x-fr.pos.x, dz=pos.z-fr.pos.z, d=Math.hypot(dx,dz);
      if(d<WARM_R){ const w=WARM_DEG*(1-d/WARM_R); if(w>best) best=w; } }
    return best; }

  ctx.campfire={ startPlace, stopPlace, spawnFire, warmth, get placing(){return placing;}, get count(){return fires.length;} };
  console.log('[campfire] 모닥불 준비 — 제작(나무3·돌2)→퀵슬롯→지면 설치. 온기 반경', WARM_R);
  return ctx.campfire;
}
