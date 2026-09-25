// siegefort.js — 🏰 첫 섬 요새 공성전(사령관 확정 2026-07-15, 샌드박스 _fortress.html 검증본 이식).
//   구성 = KayKit Medieval Hexagon 건물세트(=N키 거점건물과 동일): 중앙 building_castle + building_tower_catapult(투석기 방어탑).
//   공성: 함포 명중 = 직격(풀데미지) + 넓은 스플래시 + 붕괴 연쇄 → 링 전체가 바다쪽부터 무너짐.
//         본성은 방어탑 전멸 전까지 무적. 본성 격파 = 요새 함락(전투 종료). 파괴=building_destroyed 폐허 + three-pinata 실메시 파쇄.
//   게이트: 각 건물 = capture.js 호환 핸들 {hp,maxHp,dead,x,z,damage(d)} → o.towers 등록(towersAlive 게이트).
//   훅: game.html initSiegeFort(ctx) · worldstream(온보딩 타겟서 build) · cannon.js(포탄 impact).
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DestructibleMesh, FractureOptions } from 'three-pinata';
import { tribeById } from '/tomob-deploy/modules/tribes.js';
import { toast as ukToast, locationReveal as ukLocation } from '/tomob-deploy/modules/uikit.js';

const HXBASE = '/tomob-deploy/KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings';
const hxDir = (col)=>`${HXBASE}/${col}/`;
const COL_BY_LEAN = { watch:'blue', remnant:'red', neutral:'yellow' };
// 사령관 확정 수치(샌드박스): 성 크기·탑 수/크기·반경·호각도
const CASTLE_M=90, TOWER_M=33, RING_R=33, SPAN_DEG=310;   // ★2026-07-23 성 스케일 ×1.5(60/22/22→90/33/33): 사령관 "성 같지 않다·크기 비율 작다". 성·탑·링반경 동일 배율로 레이아웃 유지한 채 전체 확대.
const CASTLE_HP=8, TOWER_HP=3;
const DIRECT=1.0, SPLASH=0.9, SPLASH_R=80, CHAIN=0.8, CHAIN_R=40;   // ★2026-07-23 성 ×1.5(RING_R 22→33)에 맞춰 스플래시 52→80·연쇄 26→40 확대. 사령관 "성 키우니 대포 스플래시가 뒤 타워까지 안 닿음". 착탄점서 반대편 링 타워(≈성footprint+2×RING_R)까지 감쇠 스플래시가 닿도록 여유.
const TOWER_RANGE=240, TOWER_RELOAD=4.5, TOWER_DMG=6, PROJ_G=26;   // 요새 반격(대포→배): 사거리(플레이어 함포~245m와 균형)·재장전·피해·중력. ★560→240(사령관 "무한사거리")

export function initSiegeFort(ctx){
  const scene = ctx.scene;
  const fbxL = new FBXLoader(), texL = new THREE.TextureLoader();
  const _atlas = {}, _proto = {};
  const _innerMat = new THREE.MeshStandardMaterial({ color:0x8f857a, roughness:1, flatShading:true });
  const frags = [];            // 파쇄 조각(간이 중력 낙하 → 잔해로 잔존)
  let fort = null;             // 현재 요새 {group, buildings:[handle], done, hpbar, col, center}

  function atlas(col){ if(!_atlas[col]){ const t=texL.load(encodeURI(hxDir(col)+'hexagons_medieval.png')); t.flipY=true; t.colorSpace=THREE.SRGBColorSpace; _atlas[col]=t; } return _atlas[col]; }
  // FBX 프로토 로드(단위 정규화: 최대치수=1, 바닥중앙 피벗). settlement.js 패턴.
  function loadProto(file, col){
    const isNeutral=(file==='building_destroyed'); const uc=isNeutral?'neutral':col; const key=file+'_'+col;
    if(_proto[key]) return _proto[key];
    _proto[key]=new Promise(res=>{
      fbxL.load(encodeURI(hxDir(uc)+file+(isNeutral?'':'_'+col)+'.fbx'), (o)=>{
        const tx=atlas(uc);
        o.traverse(c=>{ if(c.isMesh){ c.castShadow=true; c.receiveShadow=true;
          const ms=Array.isArray(c.material)?c.material:[c.material]; ms.forEach(m=>{ if(m){ m.map=tx; if(m.color)m.color.setHex(0xffffff); m.needsUpdate=true; } }); } });
        let bb=new THREE.Box3().setFromObject(o), s=bb.getSize(new THREE.Vector3()); const md=Math.max(s.x,s.y,s.z)||1; o.scale.setScalar(1/md);
        bb=new THREE.Box3().setFromObject(o); const c2=bb.getCenter(new THREE.Vector3()), mn=bb.min.clone();
        const holder=new THREE.Group(); o.position.set(-c2.x,-mn.y,-c2.z); holder.add(o);
        _proto[key]={ obj:holder }; res(_proto[key]);
      }, undefined, e=>{ console.warn('[siegefort] FBX 로드 실패', file, uc, e&&e.message); res(null); });
    });
    return _proto[key];
  }
  const inst=(file,col)=>{ const p=_proto[file+'_'+col]; return (p&&p.obj)?p.obj.clone(true):null; };
  // 성벽 대포(투석기 대신) — 단위정규화 프로토
  let _cannonProto=null;
  function loadCannon(){ if(_cannonProto!==null) return Promise.resolve(_cannonProto);
    return new Promise(res=>{ new GLTFLoader().load('/tomob-deploy/intro/ship-cannon/cannon.glb', g=>{
      const s=g.scene; s.traverse(o=>{ if(o.isMesh){ o.castShadow=true; } });
      let bb=new THREE.Box3().setFromObject(s), sz=bb.getSize(new THREE.Vector3()); const md=Math.max(sz.x,sz.y,sz.z)||1; s.scale.setScalar(1/md);
      bb=new THREE.Box3().setFromObject(s); const c2=bb.getCenter(new THREE.Vector3()), mn=bb.min.clone(); s.position.set(-c2.x,-mn.y,-c2.z);
      const h=new THREE.Group(); h.add(s); _cannonProto=h; res(h);
    }, undefined, e=>{ console.warn('[siegefort] 대포 로드 실패', e&&e.message); _cannonProto=false; res(null); }); }); }
  const instCannon=()=>(_cannonProto&&_cannonProto.clone)?_cannonProto.clone(true):null;
  const colorFor=(tribe)=>{ const t=tribe?tribeById(tribe):null; return COL_BY_LEAN[t?t.lean:'neutral']||'red'; };
  const groundY=(x,z)=> ctx.terrain?ctx.terrain.groundAt(x,z,5000):0;

  // ── 요새 건설: 중앙 성 + 투석기 방어탑 링(바다면 향함). 각 건물=capture 호환 핸들 반환. ──
  async function build(opts={}){
    if(fort){ dispose(); }
    const cx=opts.x||0, cz=opts.z||0, col=colorFor(opts.tribe);
    // 바다 방향 = 섬중심→건설점(외향). 성문이 이쪽(바다)을 보게.
    const ic=opts.islandCenter||{x:cx,z:cz};
    let sx=cx-ic.x, sz=cz-ic.z; const sl=Math.hypot(sx,sz)||1; sx/=sl; sz/=sl;
    const seaYaw=Math.atan2(sx,sz);   // +Z 기준 바다 방향 각
    await Promise.all([ ...['building_castle','building_tower_A','building_tower_B','building_destroyed'].map(f=>loadProto(f,col)), loadCannon() ]);

    const group=new THREE.Group(); scene.add(group);
    const buildings=[];
    const gy=(x,z)=>Math.max(ctx.water?ctx.water.level:0, groundY(x,z));
    function place(file, wx, wz, scl, yaw, isCastle){
      const m=inst(file,col); if(!m) return null;
      const g0=gy(wx,wz);
      m.scale.setScalar(scl); m.position.set(wx, g0, wz); m.rotation.y=yaw; group.add(m);
      const box=new THREE.Box3().setFromObject(m); const topH=box.max.y-g0;   // 지면 위 높이
      const h={ group:m, box, isCastle:!!isCastle, x:wx, z:wz, hp:isCastle?CASTLE_HP:TOWER_HP, maxHp:isCastle?CASTLE_HP:TOWER_HP, dead:false,
        fireY:topH*0.9, reloadT:0.5+Math.random()*TOWER_RELOAD, cannonMesh:null, body:null,
        damage(d){ applyDamage(h, d); } };   // capture.js 호환 핸들
      // 🧱 충돌체(고정 Rapier cuboid) — 캐릭터가 성/탑을 뚫지 못하게. 파괴 시 제거.
      if(ctx.RAPIER && ctx.world){ const c=box.getCenter(new THREE.Vector3()), sz=box.getSize(new THREE.Vector3());
        try{ const body=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(c.x,c.y,c.z));
          ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(Math.max(0.5,sz.x*0.42), Math.max(0.5,sz.y*0.5), Math.max(0.5,sz.z*0.42)), body); h.body=body; }catch(_){} }
      // 방어탑 = 성벽 대포(투석기 대신). 탑 위에 대포 얹어 바다 향함.
      if(!isCastle){ const cn=instCannon(); if(cn){ cn.scale.setScalar(scl*0.34); cn.position.set(wx, g0+topH*0.86, wz); cn.rotation.y=yaw; group.add(cn); h.cannonMesh=cn; } }
      m.userData.fortHandle=h; buildings.push(h); return h;
    }
    // 중앙 성 — 건설점서 약간 내륙(성문=바다 향함)
    place('building_castle', cx - sx*8, cz - sz*8, CASTLE_M, seaYaw+Math.PI, true);
    // 방어탑 링 — 바다면 중심 부채꼴. 일반탑(A/B) + 대포(투석기 대신).
    const n=opts.towers||9, span=SPAN_DEG*Math.PI/180;
    for(let i=0;i<n;i++){ const a=n===1?0:-span/2+span*(i/(n-1)); const wa=seaYaw+a;
      const wx=cx+Math.sin(wa)*RING_R - sx*8, wz=cz+Math.cos(wa)*RING_R - sz*8;
      place(i%2===0?'building_tower_A':'building_tower_B', wx, wz, TOWER_M, wa+Math.PI, false);
    }
    fort={ group, buildings, done:false, engaged:false, col, center:new THREE.Vector3(cx,gy(cx,cz),cz) };
    makeHpBar();
    ctx.siegeFort.active=true;
    console.log('[siegefort] 🏰 요새 건설 — 성+방어탑'+n+'기('+col+') @', cx.toFixed(0), cz.toFixed(0));
    return buildings;   // worldstream이 o.towers.push(...handles)
  }

  const towersAlive=()=> fort && fort.buildings.some(b=>!b.isCastle && !b.dead && b.hp>0);

  // ── 데미지 적용(+파괴·연쇄). 본성은 방어탑 전멸 전 무적. ──
  function applyDamage(b, amount, isChain){
    if(!fort || !b || b.dead || b.hp<=0) return;
    if(b.isCastle && towersAlive()) return;   // 본성 무적
    b.hp-=amount;
    if(b.hp<=0){
      b.hp=0; b.dead=true;
      fractureBuilding(b);
      b.group.visible=false; b.box=null; if(b.cannonMesh) b.cannonMesh.visible=false;
      if(b.body){ try{ ctx.world.removeRigidBody(b.body); }catch(_){} b.body=null; }   // 충돌체 제거(잔해 위 이동 가능)
      try{ ctx.sound&&ctx.sound.play&&ctx.sound.play(b.isCastle?'fortCastle':'fortTower'); }catch(_){}   // 🔊 타워/성 파괴음(사령관 신규)
      if(b.isCastle){ spawnRuin(b); fort.done=true; try{ ukToast('본성 붕괴 — 요새 함락', {accent:'gold', ms:2800}); }catch(_){}
        try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.set(null); }catch(_){}   // 함락 = 전투 BGM 해제(항해 BGM 복귀)
      } else {
        const wp=new THREE.Vector3(); b.group.getWorldPosition(wp);
        if(!isChain){ for(const s of fort.buildings){ if(s!==b && !s.dead && s.hp>0 && !s.isCastle && s.box){ const c=new THREE.Vector3(); s.box.getCenter(c);
          const d=c.distanceTo(wp); if(d<CHAIN_R) applyDamage(s, CHAIN*(1-d/CHAIN_R), true); } } }
      }
    }
    updateHpBar();
  }
  // 포탄 명중(cannon.js가 지형보다 먼저 호출) — 건물 직격 or 요새 근처 지면 착탄이면 처리(직격+스플래시). 명중 시 true(포탄 소멸).
  function impact(point){
    if(!fort || fort.done) return false;
    let hit=null, hitD=1e9, nearMin=1e9; const c=new THREE.Vector3();
    for(const b of fort.buildings){ if(b.dead||!b.box) continue;
      const d=b.box.distanceToPoint(point); if(d<hitD){ hitD=d; if(d<2.5) hit=b; }   // 박스 2.5m 이내 = 직격
      b.box.getCenter(c); const cd=c.distanceTo(point); if(cd<nearMin) nearMin=cd;
    }
    const onGround = point.y <= groundY(point.x,point.z)+2.0;
    if(!hit && !(onGround && nearMin<SPLASH_R)) return false;   // 직격도 아니고 요새 근처 착탄도 아니면 통과(공중·먼 곳)
    if(!fort.engaged){   // ★공성 개시 순간 = 전투 BGM + 발할라식 배너("뭔가 시작된 느낌", 사령관)
      fort.engaged=true;
      try{ ctx.sound && ctx.sound.bgm && ctx.sound.bgm.set('battle'); }catch(_){}
      try{ ukLocation({ name:'요새 공성', band:'방어탑을 격파하고 본성을 무너뜨려라' }); }catch(_){}
    }
    if(hit){ if(hit.isCastle && towersAlive()){ try{ ukToast('방어탑을 먼저 격파하라',{accent:'red', ms:1600}); }catch(_){} } else applyDamage(hit, DIRECT); }
    for(const b of fort.buildings){ if(b===hit||b.dead||b.hp<=0||!b.box) continue; b.box.getCenter(c); const d=c.distanceTo(point);
      if(d<SPLASH_R) applyDamage(b, SPLASH*(1-d/SPLASH_R)); }   // 감쇠 스플래시(성 뒤 타워도)
    updateHpBar();
    return true;
  }

  // ── three-pinata 실메시 파쇄(샌드박스 검증본): 건물 메시 병합→voronoi→조각 낙하·잔존 ──
  function mergeSegGeo(seg){
    seg.updateWorldMatrix(true,true); const geos=[];
    seg.traverse(m=>{ if(m.isMesh&&m.geometry){ let g=m.geometry.clone(); if(g.index) g=g.toNonIndexed();
      const pos=g.getAttribute('position'), nrm=g.getAttribute('normal'), uv=g.getAttribute('uv');
      const ng=new THREE.BufferGeometry(); ng.setAttribute('position',pos.clone());
      if(nrm) ng.setAttribute('normal',nrm.clone()); else ng.computeVertexNormals();
      ng.setAttribute('uv', uv?uv.clone():new THREE.BufferAttribute(new Float32Array(pos.count*2),2));
      ng.applyMatrix4(m.matrixWorld); geos.push(ng); } });
    if(!geos.length) return null; let merged=null; try{ merged=mergeGeometries(geos,false); }catch(_){} geos.forEach(g=>g.dispose()); return merged;
  }
  const FRAG_CAP=140;   // 파편 총 상한(초과 시 가장 오래된 것 제거) — 전투 중 누적 성능저하 방지
  // ★박스 프록시 voronoi 파쇄(게임 destruct.js 방식) — 실메시 파쇄는 복잡메시라 ~265ms 프레임 멈춤(사령관 "전투 중 멈춤").
  //   박스(소수 삼각형)는 파쇄 ~10ms라 전투 끊김 없음. 텍스처 얹어 돌덩이 느낌 유지. 조각 개수도 제어됨.
  function fractureBuilding(b){
    const box=new THREE.Box3().setFromObject(b.group); const bsz=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const h=b.isCastle?CASTLE_M:TOWER_M, impR=Math.max(bsz.x,bsz.y,bsz.z);
    const geo=new THREE.BoxGeometry(bsz.x*0.9, bsz.y*0.9, bsz.z*0.9);
    let out;
    try{ const dm=new DestructibleMesh(geo, new THREE.MeshStandardMaterial({ map:atlas(fort.col), roughness:1 }), _innerMat); dm.position.copy(center);
      out=dm.fracture(new FractureOptions({ fractureMethod:'voronoi', fragmentCount:b.isCastle?16:9, voronoiOptions:{ mode:'3D', impactPoint:new THREE.Vector3(0,0,0), impactRadius:impR } })); }
    catch(e){ console.warn('[siegefort] fracture 실패', e&&e.message); geo.dispose(); return; }
    geo.dispose();
    for(const fr of out){ fort.group.add(fr); fr.castShadow=true;
      const off=fr.position.clone().sub(center);
      const dir=off.clone().setY(0); if(dir.length()<0.01) dir.set(Math.random()-.5,0,Math.random()-.5); dir.normalize();
      const sp=1.4+Math.random()*1.6;
      const vel=new THREE.Vector3(dir.x*sp+off.x*0.6, Math.abs(off.y)*0.5+h*0.12+Math.random()*h*0.14, dir.z*sp+off.z*0.6);
      frags.push({ mesh:fr, vel, rot:new THREE.Vector3((Math.random()-.5)*5,(Math.random()-.5)*5,(Math.random()-.5)*5), rest:groundY(fr.position.x,fr.position.z)+0.2, settled:false }); }
    while(frags.length>FRAG_CAP){ const f=frags.shift(); try{ fort.group.remove(f.mesh); f.mesh.geometry&&f.mesh.geometry.dispose(); }catch(_){} }
  }
  function spawnRuin(b){ const r=inst('building_destroyed', fort.col); if(!r) return; const wp=new THREE.Vector3(); b.group.getWorldPosition(wp);
    r.scale.setScalar(CASTLE_M*0.85); r.position.set(wp.x, groundY(wp.x,wp.z), wp.z); fort.group.add(r); }

  // ── 본성 체력바(게임 해전 적 체력바 스타일) — 방어탑 전멸 후 등장 ──
  function makeHpBar(){ if(fort.hpbar) return;
    const el=document.createElement('div'); el.id='siegeHp';
    el.style.cssText='position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:8;width:min(420px,70vw);text-align:center;pointer-events:none;display:none;font:13px Pretendard,system-ui';
    el.innerHTML='<div style="font:600 13px Pretendard;letter-spacing:.08em;color:#ff9a8a;text-shadow:0 1px 3px #000;margin-bottom:5px">본성 — 요새 심장부</div>'
      +'<div style="height:15px;background:rgba(0,0,0,.55);border:1px solid rgba(255,120,90,.55);border-radius:8px;overflow:hidden">'
      +'<div id="siegeHpFill" style="height:100%;width:100%;background:linear-gradient(90deg,#e8503a,#ff7a4a);transition:width .15s"></div></div>';
    document.body.appendChild(el); fort.hpbar=el;
  }
  function updateHpBar(){ if(!fort||!fort.hpbar) return; const castle=fort.buildings.find(b=>b.isCastle);
    const engaged=!towersAlive() && !fort.done && castle && !castle.dead;
    fort.hpbar.style.display=engaged?'block':'none';
    if(engaged){ const f=fort.hpbar.querySelector('#siegeHpFill'); if(f) f.style.width=(100*Math.max(0,castle.hp)/castle.maxHp).toFixed(0)+'%'; }
  }

  function dispose(){ if(!fort) return; if(fort.engaged && !fort.done){ try{ ctx.sound&&ctx.sound.bgm&&ctx.sound.bgm.set(null); }catch(_){} }   // 이탈 = 전투 BGM 해제
    try{ scene.remove(fort.group); }catch(_){} try{ fort.hpbar&&fort.hpbar.remove(); }catch(_){}
    for(const f of frags){ try{ fort.group.remove(f.mesh); }catch(_){} } frags.length=0;
    for(const b of fort.buildings){ if(b.body){ try{ ctx.world.removeRigidBody(b.body); }catch(_){} b.body=null; } }   // 충돌체 정리
    fort=null; ctx.siegeFort.active=false; }

  // ── 요새 반격(투석기 방어탑 → 플레이어 배) ──
  const _tproj=[]; const _tballGeo=new THREE.SphereGeometry(0.75,10,10); const _tballMat=new THREE.MeshStandardMaterial({color:0x352d28,roughness:0.75,metalness:0.05});
  function fireTower(t, bs){
    const S=new THREE.Vector3(t.x, groundY(t.x,t.z)+t.fireY, t.z);
    const WL=ctx.water?ctx.water.level:0;
    const T=new THREE.Vector3(bs.x, WL+2, bs.z);
    const dist=S.distanceTo(T), tt=Math.max(1.2, dist/62), g=PROJ_G;
    const vel=T.clone().sub(S).divideScalar(tt); vel.y+=0.5*g*tt;
    vel.x+=(Math.random()-0.5)*5; vel.z+=(Math.random()-0.5)*5;   // 산포(피할 여지)
    const mesh=new THREE.Mesh(_tballGeo,_tballMat); mesh.castShadow=true; mesh.position.copy(S); fort.group.add(mesh);
    _tproj.push({ mesh, vel, life:6 });
    // 🎇 발사 이팩트 = 플레이어 함포와 동일(머즐 섬광·연기). 포구 방향=바다쪽.
    const _d=T.clone().sub(S).setY(0); if(_d.lengthSq()<1e-4) _d.set(0,0,1); _d.normalize();
    try{ ctx.cannonfx && ctx.cannonfx.muzzle && ctx.cannonfx.muzzle(S.clone(), new THREE.Vector3(_d.x,0.08,_d.z), 0.18, 2.6); }catch(_){}
    try{ ctx.cannon && ctx.cannon.muzzleFlash && ctx.cannon.muzzleFlash(S.x,S.y,S.z, _d.x,_d.z); }catch(_){}
  }
  function hitShip(bs, at){
    // 전투 HP(hp)와 내구도(durability) 둘 다 차감 — 피격이 확실히 먹히게(사령관 "피격 안 됨")
    if(bs.hp!=null){ bs.hp=Math.max(0, bs.hp-TOWER_DMG); }
    bs.durability=Math.max(0,(bs.durability||0)-TOWER_DMG);
    // 🎥 피격 피드백 — 카메라 컷(빨간 플래시)+흔들림+폭발·파편 FX+선체 피격음
    try{ ctx.player&&ctx.player.navImpactCam&&ctx.player.navImpactCam('hit'); }catch(_){}
    try{ ctx.player&&ctx.player.camShake&&ctx.player.camShake(0.22); }catch(_){}
    try{ ctx.cannonfx&&ctx.cannonfx.impact&&ctx.cannonfx.impact(at, new THREE.Vector3(0,1,0), 0.2); }catch(_){}
    try{ ctx.cannon&&ctx.cannon.explode&&ctx.cannon.explode(at.x,at.y,at.z); }catch(_){}
    try{ ctx.sound&&ctx.sound.play&&ctx.sound.play('ship_crash'); }catch(_){}
    if((bs.durability||0)<=0 && !bs._crippled){ bs._crippled=true; try{ ukToast('배 반파 — 항구에서 수리 필요', {accent:'red', ms:2600}); }catch(_){} }
  }

  ctx.onUpdate(dt=>{ dt=Math.min(0.05,dt);
    const bs=ctx.ship, WL=ctx.water?ctx.water.level:0;
    // 요새 반격 발사(방어탑만, 본성 제외). ★플레이어가 먼저 공격(engaged)한 뒤 + 배가 사거리 내일 때만.
    if(fort && !fort.done && fort.engaged && bs){
      const inR=Math.hypot(bs.x-fort.center.x, bs.z-fort.center.z)<TOWER_RANGE;
      for(const t of fort.buildings){ if(t.dead||t.hp<=0||t.isCastle) continue; t.reloadT-=dt;
        if(inR && t.reloadT<=0){ t.reloadT=TOWER_RELOAD*(0.8+Math.random()*0.5); fireTower(t, bs); } }
    }
    // 반격 발사체 물리 + 배 명중
    for(let i=_tproj.length-1;i>=0;i--){ const p=_tproj[i]; p.vel.y-=PROJ_G*dt; p.mesh.position.addScaledVector(p.vel,dt); p.life-=dt;
      const m=p.mesh.position;
      if(bs && Math.hypot(m.x-bs.x,m.z-bs.z)<16 && m.y<WL+11){ hitShip(bs, m.clone()); fort.group.remove(p.mesh); _tproj.splice(i,1); continue; }
      if(m.y<WL || p.life<=0){ try{ctx.cannon&&ctx.cannon.splash&&ctx.cannon.splash(m.x,m.z);}catch(_){} fort.group.remove(p.mesh); _tproj.splice(i,1); }
    }
    // 파쇄 조각 물리(중력 낙하 → 지면서 정지 → 잠시 잔해로 남았다가 축소·소멸, 사령관 "부서지고 다시 사라지는거").
    for(let i=frags.length-1;i>=0;i--){ const f=frags[i];
      if(f.settled){ f.fadeT-=dt;   // 안착 후 잔존 타이머 → 끝나면 축소 소멸(바닥 클리어 = 점령 접근 쉽게)
        if(f.fadeT<0.6){ const s=Math.max(0.001, f.fadeT/0.6); f.mesh.scale.setScalar(s); }
        if(f.fadeT<=0){ fort.group.remove(f.mesh); f.mesh.geometry&&f.mesh.geometry.dispose(); frags.splice(i,1); }
        continue; }
      f.vel.y-=26*dt; f.mesh.position.addScaledVector(f.vel,dt);
      f.mesh.rotation.x+=f.rot.x*dt; f.mesh.rotation.z+=f.rot.y*dt;
      if(f.mesh.position.y<f.rest){ f.mesh.position.y=f.rest; f.vel.set(f.vel.x*0.35,0,f.vel.z*0.35); f.rot.multiplyScalar(0.5);
        if(Math.abs(f.vel.x)+Math.abs(f.vel.z)<0.3){ f.settled=true; f.fadeT=3.0+Math.random()*1.5; } } }   // 안착 후 3~4.5초 뒤 소멸
  });

  // 점령 완료 = 무너진 성/잔해 정리(사령관 "점령했는데 무너진 성이 안 없어짐"). 파괴된 요새(fort.done)만.
  try{ ctx.events && ctx.events.on && ctx.events.on('outpostCaptured', ()=>{ if(fort && fort.done) setTimeout(()=>{ try{ dispose(); }catch(_){} }, 1500); }); }catch(_){}

  ctx.siegeFort={ build, impact, dispose, active:false, isActive:()=>!!(fort&&!fort.done), towersAlive };
  return ctx.siegeFort;
}
