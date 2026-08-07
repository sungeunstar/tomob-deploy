// claim.js — 점령(claim) 시스템. _GAME_DESIGN §3-A + 25번 빌딩 + 21번 E 점령전 정본.
//   ★빈 섬 점령 = "항구 고스트에 재료 채우기"(목16·돌10) → 게이지 차오르면 완성 = 내 영토.
//   ★방어 타워(목6·돌8) = HP180, 적 배 접근 시 자동 반격(broadside cannon 연동 자리).
//   ★남의 섬 탈취 = claimIsland(id,owner) 인터페이스(naval 전투 연계 자리).
//   콘센트: ctx.inventory(재료 차감)·ctx.reputation(점령 평판)·ctx.terrain(지형/충돌)·ctx.water. + ctx.worldmap(축5 canonId 매칭용, 읽기만).
//   ※ inventory/reputation/build/terrain/worldmap 은 호출·읽기만. 이 파일만 수정.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT (구조물 HP)
import { WORLD_SCALE } from './islands.js';   // 🧭 canon↔3D 좌표 변환(축5 세력선언 교역로 조건 — 점령섬↔canon id 매칭용)

const FLAG = encodeURI('/assets/kenney_all_in_one_3.4.0/3D assets/Pirate Kit/Models/GLB format/flag-pirate.glb');

// 점령 건물 재료(정본 16번 §3-1 / 25번 §2-2). [확정 출처: 25_빌딩_건축.md]
const HARBOR_COST = BAL.structures.harborCost;   // 항구(점령 핵심) — balance.js SSOT. ※G 건설은 wharf.js 전담, 여기선 디버그헬퍼용 잔존
const TOWER_COST  = { timber: 6,  stone: 8  };   // 방어 타워(돌 위주)
const TOWER_HP    = BAL.structures.towerHp;        // ⚖️ balance.js
const TOWER_RANGE = 40;                           // 21번 E-3 타워 사거리
const CANNON_COST  = { iron: 2, timber: 4 };      // 대포(인벤 [제작] 탭) — _PROJECT.md 확정값 철2·목4
const CANNON_HP    = BAL.structures.cannonHp;      // ⚖️ balance.js
const CANNON_RANGE = 38;                           // 대포 자동 포격 사거리 [제안]
const CANNON_RELOAD = 2.6;                          // 대포 재장전(느림·강함 = 대함)
// ── 석궁 타워(상륙병 전용 방어 — 빠름·약함, 대포와 역할 분리): 대포=배 / 석궁=사람 ──
const CROSSBOW_COST   = { timber: 6, stone: 2 };    // 목재 위주(싸다)
const CROSSBOW_HP     = BAL.structures.crossbowHp || 70;
const CROSSBOW_RANGE  = 46;                          // 사거리 길게(상륙 전 저지)
const CROSSBOW_RELOAD = 1.0;                         // 빠른 연사(대인)
// ── 토대(포좌): 돌 받침대. 위에 대포/석궁을 얹는다. 쌓아 올려 높일 수 있음(사거리·시야↑). ──
const FOUNDATION_COST = { stone: 6 };
const FOUNDATION_HP   = 200;
const FOUNDATION_H    = 2.4;   // 받침 높이(상단 = 대포 얹는 면)
// ── 🏰 곡선 해안 방벽(적 거점 방어시설, AC4 리싱크드式): 바다쪽 한 면만 부채꼴로 두르는 복셀 벽 + 개별 포대 ──
//   원기둥 돌탑 대신 fortify 복셀(wallblock)로 호를 두르고, 균등 간격 cannonblock N개를 얹어 하나씩 격파(함포로만) → 상륙.
const RAMPART_R      = 26;    // 거점 중심~방벽 기준 반경
const RAMPART_ARC    = 1.4;   // 부채꼴 기준 전체 각(rad, ≈80°) — 티어로 가감
const RAMPART_LAYERS = 2;     // 벽 높이(블록 층) — 그 위 층에 포대
const SHORE_DIST  = 32;                            // 해안 판정 반경(이 안에 바다 있어야 항구 가능)
const BUILD_TICK  = 0.22;                          // 게이지 1단위(재료 1개) 투입 간격(초)
const SITE_RADIUS = 8;                             // 이 반경 안에 있으면 재료 투입(게이지 차오름)

import { toast as ukToast } from './uikit.js';
export function initClaim(ctx){
  const { scene } = ctx;
  const loader = new GLTFLoader();
  const claimed = []; ctx.claimed = claimed;        // [{x,z,name,r,owner}]
  // 🧭 점령 지점(3D world x,z) → 가장 가까운 canon 섬 id(축5 세력선언 "안정 교역로" 조건이 worldmap.routes와 매칭할 열쇠).
  //   canon 좌표는 3D의 1/WORLD_SCALE(§islands.js) — ctx.worldmap 없으면(아직 npc 미init 등) null(크래시 금지, 조건은 그냥 미충족 처리).
  function nearestCanonId(x, z){
    const wm = ctx.worldmap; if(!wm || !Array.isArray(wm.islands) || !wm.islands.length) return null;
    const cx = x / WORLD_SCALE, cz = z / WORLD_SCALE;
    let best = null, bd = Infinity;
    for(const isl of wm.islands){ const d = Math.hypot(isl.x-cx, isl.z-cz); if(d < bd){ bd = d; best = isl; } }
    return best ? best.id : null;
  }
  const towers  = [];                               // [{group,hp,maxHp,x,z,range,reloadT}]
  const foundations = [];                           // [{group,x,z,topY}] — 토대(포좌). 대포가 이 위에 얹힘.
  let infiniteMaterials = false;                    // ★테스트: 재료 무한(건설 게이지 차감 스킵). 기본 OFF(본게임 정상).
  let activeSite = null;                            // 건설 중인 고스트 {kind,cost,paid,group,mats,dir,x,z,baseY}
  let cannonGhost = null, cannonValid = false, cannonOnCancel = null;   // 대포 제작 배치 상태

  // ── 토스트 ──
  // ★토스트 = uikit 공통(점령·정보 = cyan)
  const toast = t => ukToast(t, { accent:'cyan', ms:2200 });

  // ── 게이지 HUD(건설 진행도) ──
  const gauge = document.createElement('div');
  gauge.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:30;width:280px;display:none;font:12px system-ui,"Malgun Gothic";color:#e6eef6;text-align:center';
  gauge.innerHTML = '<div id="cl_lbl" style="margin-bottom:5px;text-shadow:0 1px 2px #000"></div>'
    + '<div style="height:14px;border-radius:8px;background:rgba(8,14,22,.8);border:1px solid rgba(255,255,255,.2);overflow:hidden">'
    + '<div id="cl_bar" style="height:100%;width:0%;background:linear-gradient(90deg,#4ade5a,#a6f0c8);transition:width .12s"></div></div>';
  document.body.appendChild(gauge);
  const barEl = gauge.querySelector('#cl_bar'), lblEl = gauge.querySelector('#cl_lbl');
  function showGauge(site){
    if(!site){ gauge.style.display='none'; return; }
    const need = site.cost.timber + site.cost.stone, got = site.paid.timber + site.paid.stone;
    barEl.style.width = Math.round(got/need*100) + '%';
    const nm = site.kind==='harbor' ? '항구 건설' : '방어 타워 건설';
    lblEl.innerHTML = `${nm} &nbsp; <b>목재 ${site.paid.timber}/${site.cost.timber} · 돌 ${site.paid.stone}/${site.cost.stone}</b>`;
    gauge.style.display = 'block';
  }

  // ── 지형/해안 헬퍼 ──
  const waterLevel = ()=> ctx.water ? ctx.water.level : 0;
  function groundY(x,z){ return ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0; }
  function onLand(x,z){ return groundY(x,z) > waterLevel()+0.6; }
  // 해안 근처? + 바다 방향 반환(없으면 null). 8방향 샘플 중 물(육지 아님)인 가장 가까운 방향.
  function seaDirection(x,z){
    let best=null, bestD=1e9;
    for(let i=0;i<16;i++){
      const a = i/16*Math.PI*2;
      for(let d=6; d<=SHORE_DIST; d+=4){
        const sx=x+Math.cos(a)*d, sz=z+Math.sin(a)*d;
        if(!onLand(sx,sz)){ if(d<bestD){ bestD=d; best={x:Math.cos(a),z:Math.sin(a),dist:d}; } break; }
      }
    }
    return best;
  }

  // ── 절차생성 메시 ──────────────────────────────────────────
  const woodMat  = new THREE.MeshLambertMaterial({ color:0x8a6240 });
  const wood2Mat = new THREE.MeshLambertMaterial({ color:0x6f4d31 });
  const stoneMat = new THREE.MeshLambertMaterial({ color:0x8d8f93 });

  // ── 실제 대포 모델 (pirateship 키트) — 타워 상단에 얹음 ──
  let _cannonProto = null;
  new FBXLoader().load('/obj/pirateship/Cannon_00.fbx', obj=>{   // FBX 임베드 원본 '.vox' 참조 404는 core.js 전역 URLModifier가 빈 이미지로 교정
    obj.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(obj), sz=new THREE.Vector3(); box.getSize(sz);
    obj.scale.setScalar(2.6/(Math.max(sz.x,sz.y,sz.z)||1));   // 높이 ~2.6m 정규화
    obj.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.material=new THREE.MeshLambertMaterial({color:0x33373c}); } });   // 텍스처 404 → 짙은 철 회색 대포
    _cannonProto = obj;
    console.log('[claim] 대포 모델 로드 완료');
  }, undefined, e=>console.warn('[claim] Cannon_00.fbx 로드 실패', e&&e.message));
  const roofMat  = new THREE.MeshLambertMaterial({ color:0x7a3b2e });

  // 항구: 물 방향으로 뻗는 판자 부두 + 지지기둥 + 창고 + 정박 포인트. (mat 교체 가능하게 ghost 지원)
  function buildHarbor(x, baseY, z, dir, ghost){
    const g = new THREE.Group();
    const mk=(geo,mat,px,py,pz,ry=0)=>{ const m=new THREE.Mesh(geo, ghost?ghostMat(mat):mat); m.position.set(px,py,pz); if(ry)m.rotation.y=ry; m.castShadow=!ghost; g.add(m); return m; };
    const ang = Math.atan2(dir.z, dir.x);
    // 부두 데크(물 쪽으로 5칸)
    const deckTop = baseY + 0.5;
    const planks = [];
    for(let i=0;i<5;i++){
      const px = x + dir.x*(3 + i*3.6), pz = z + dir.z*(3 + i*3.6);
      const dk = mk(new THREE.BoxGeometry(4.2, 0.4, 3.4), woodMat, px, deckTop, pz, ang);
      planks.push(dk);
      // 지지 기둥(수면까지)
      mk(new THREE.CylinderGeometry(0.28,0.28, deckTop-waterLevel()+3, 7), wood2Mat, px+1.6, (deckTop+waterLevel())/2-1, pz);
      mk(new THREE.CylinderGeometry(0.28,0.28, deckTop-waterLevel()+3, 7), wood2Mat, px-1.6, (deckTop+waterLevel())/2-1, pz);
    }
    // 창고(육지쪽)
    mk(new THREE.BoxGeometry(6,4,6), woodMat, x - dir.x*2.5, baseY+2, z - dir.z*2.5);
    mk(new THREE.ConeGeometry(4.8,2.6,4), roofMat, x - dir.x*2.5, baseY+5.3, z - dir.z*2.5, Math.PI/4);
    g.userData.deckMeshes = planks;
    g.userData.dockPoint = { x: x + dir.x*(3+4*3.6), y: deckTop, z: z + dir.z*(3+4*3.6) };  // 배 정박/스폰
    scene.add(g); return g;
  }

  // 방어 타워: 돌탑 + 흉벽 + 대포(상단). 자동 반격 주체.
  function buildTower(x, baseY, z, ghost){
    const g = new THREE.Group();
    const mk=(geo,mat,px,py,pz)=>{ const m=new THREE.Mesh(geo, ghost?ghostMat(mat):mat); m.position.set(px,py,pz); m.castShadow=!ghost; g.add(m); return m; };
    mk(new THREE.CylinderGeometry(2.4,2.8,7,10), stoneMat, x, baseY+3.5, z);       // 탑신
    mk(new THREE.CylinderGeometry(3.0,2.4,1.4,10), stoneMat, x, baseY+7.4, z);      // 상단 확장
    // 흉벽(crenellation)
    for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; mk(new THREE.BoxGeometry(0.8,1.2,0.8), stoneMat, x+Math.cos(a)*2.7, baseY+8.4, z+Math.sin(a)*2.7); }
    if(!ghost && _cannonProto){ const cn=_cannonProto.clone(); cn.position.set(x, baseY+9.2, z); g.add(cn); g.userData.cannonMesh=cn; }   // 실제 대포 모델(흉벽 위·조준 회전)
    else mk(new THREE.CylinderGeometry(0.4,0.5,3,8), wood2Mat, x, baseY+8.6, z);     // 폴백/고스트 = 상징 포신
    scene.add(g); return g;
  }

  // 대포(자동 포대): 나무 받침 + 실제 대포 모델. 타워와 같은 자동발사 주체(towers에 등록).
  //   ghost=true → 배치 미리보기(반투명). 메시는 (x,z) 기준 절대 배치(고스트는 원점 0,0,0에 만들고 group.position으로 이동).
  function buildCannon(x, baseY, z, ghost){
    const g = new THREE.Group();
    const mk=(geo,mat,px,py,pz)=>{ const m=new THREE.Mesh(geo, ghost?ghostMat(mat):mat); m.position.set(px,py,pz); m.castShadow=!ghost; g.add(m); return m; };
    mk(new THREE.CylinderGeometry(1.5,1.8,1.2,8), woodMat,  x, baseY+0.6,  z);   // 나무 받침
    mk(new THREE.BoxGeometry(2.8,0.5,2.8),         wood2Mat, x, baseY+1.25, z);   // 상판
    if(!ghost && _cannonProto){ const cn=_cannonProto.clone(); cn.position.set(x, baseY+1.9, z); cn.castShadow=true; g.add(cn); g.userData.cannonMesh=cn; }
    else mk(new THREE.CylinderGeometry(0.42,0.52,2.6,8), stoneMat, x, baseY+2.0, z);   // 폴백/고스트 = 상징 포신
    scene.add(g); return g;
  }

  // 석궁 타워(대인 방어): 나무 망루 + 발리스타(석궁대). 빠른 연사, 상륙병 저지.
  function buildCrossbow(x, baseY, z, ghost){
    const g = new THREE.Group();
    const mk=(geo,mat,px,py,pz)=>{ const m=new THREE.Mesh(geo, ghost?ghostMat(mat):mat); m.position.set(px,py,pz); m.castShadow=!ghost; g.add(m); return m; };
    for(const [dx,dz] of [[1,1],[1,-1],[-1,1],[-1,-1]]) mk(new THREE.BoxGeometry(0.4,4.4,0.4), wood2Mat, x+dx*1.1, baseY+2.2, z+dz*1.1);   // 기둥 4
    mk(new THREE.BoxGeometry(3.2,0.4,3.2), woodMat, x, baseY+4.5, z);                                                                       // 사대
    for(let i=0;i<4;i++){ const a=i/4*Math.PI*2; mk(new THREE.BoxGeometry(0.5,0.7,0.5), wood2Mat, x+Math.cos(a)*1.4, baseY+5.0, z+Math.sin(a)*1.4); }  // 흉벽
    const ball = new THREE.Group();   // 발리스타 = 자동조준 회전부(userData.cannonMesh)
    const bmat = ghost?ghostMat(wood2Mat):wood2Mat, smat = ghost?ghostMat(woodMat):woodMat;
    const limb=new THREE.Mesh(new THREE.BoxGeometry(2.6,0.22,0.22), bmat); ball.add(limb);                     // 활대(가로)
    const stock=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.28,1.9), smat); stock.position.z=0.4; ball.add(stock);   // 몸통(전방=+z)
    ball.traverse(o=>{ if(o.isMesh) o.castShadow=!ghost; });
    ball.position.set(x, baseY+5.3, z); g.add(ball); g.userData.cannonMesh = ball;
    scene.add(g); return g;
  }
  function registerCrossbow(x, baseY, z){
    const g = buildCrossbow(x, baseY, z, false);
    const t = { group:g, hp:CROSSBOW_HP, maxHp:CROSSBOW_HP, x, z, cannonY:baseY+5.3, range:CROSSBOW_RANGE, reloadT:0, reload:CROSSBOW_RELOAD, kind:'crossbow',
      damage(d){ t.hp-=d; if(t.hp<=0) destroyTower(t); } };
    towers.push(g.userData.tower = t);
    let near=null,nd=1e9; for(const c of claimed){ const dd=Math.hypot(c.x-x,c.z-z); if(dd<nd){nd=dd;near=c;} }
    if(near && near.towers) near.towers.push(t);
    if(ctx.destruct) ctx.destruct.makeBreakable(g, { hp:CROSSBOW_HP, onBreak:()=>destroyTower(t) });
    return t;
  }

  // 토대(포좌): 돌 받침 + 상단 테두리. 상단면 = 대포/석궁이 얹히는 높이(topY). collide 등록 → 조준·스택 가능.
  function buildFoundation(x, baseY, z, ghost){
    const g = new THREE.Group();
    const mk=(geo,mat,px,py,pz)=>{ const m=new THREE.Mesh(geo, ghost?ghostMat(mat):mat); m.position.set(px,py,pz); m.castShadow=m.receiveShadow=!ghost; g.add(m); return m; };
    mk(new THREE.BoxGeometry(3.4, FOUNDATION_H, 3.4), stoneMat, x, baseY+FOUNDATION_H/2, z);       // 받침 몸통
    mk(new THREE.BoxGeometry(3.9, 0.4, 3.9),          stoneMat, x, baseY+FOUNDATION_H+0.2, z);      // 상단 테두리(대포 얹는 면)
    g.userData.topY = baseY + FOUNDATION_H + 0.4;   // 대포가 얹힐 높이
    scene.add(g); return g;
  }
  function registerFoundation(x, baseY, z){
    const g = buildFoundation(x, baseY, z, false);
    if(ctx.terrain && ctx.terrain.collide) g.traverse(o=>{ if(o.isMesh) ctx.terrain.collide.push(o); });   // THREE 조준(대포 고스트)
    // ★물리 = 솔리드 큐보이드(박스 트라이메시는 수직 castRay 누수 → 큐보이드로 확실한 물리 바닥: 보행·groundAt·대포 물리 일치)
    let body=null;
    if(ctx.RAPIER && ctx.world){ try{
      const hy=(g.userData.topY - baseY)/2;
      body=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(x, baseY+hy, z));
      ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(1.95, hy, 1.95), body);
    }catch(e){ console.warn('[claim] 토대 물리 실패', e&&e.message); } }
    const rec = { group:g, x, z, topY:g.userData.topY, body };
    foundations.push(rec);
    if(ctx.destruct) ctx.destruct.makeBreakable(g, { hp:FOUNDATION_HP, onBreak:()=>{ const i=foundations.indexOf(rec); if(i>=0) foundations.splice(i,1);
      if(ctx.terrain&&ctx.terrain.collide) g.traverse(o=>{ const ci=ctx.terrain.collide.indexOf(o); if(ci>=0) ctx.terrain.collide.splice(ci,1); });
      if(rec.body && ctx.world){ try{ ctx.world.removeRigidBody(rec.body); }catch(_){} }
      scene.remove(g); } });
    return g;
  }

  function ghostMat(base){ const m = base.clone(); m.transparent=true; m.opacity=0.32; m.depthWrite=false; m.color.setHex(0x4ade5a); return m; }
  function setGhostOpacity(group, p){ group.traverse(o=>{ if(o.isMesh && o.material && o.material.transparent){ o.material.opacity = 0.18 + p*0.5; o.material.color.setHex(p>=1?0x4ade5a:0x6fd0ff); } }); }

  // ── 점령 시작(고스트 배치) ───────────────────────────────
  function startSite(kind){
    if(activeSite){ toast('이미 건설 중'); return; }
    if(!ctx.terrain){ return; }
    const pp = ctx.player.pos;
    if(!onLand(pp.x, pp.z)){ toast('육지에서만 건설'); return; }
    for(const c of claimed){ if(Math.hypot(c.x-pp.x,c.z-pp.z) < 28){ toast(kind==='harbor'?'이미 점령한 섬':'타워 설치'); if(kind==='harbor') return; } }
    const baseY = groundY(pp.x, pp.z);
    let dir = { x:1, z:0 };
    if(kind==='harbor'){
      const sea = seaDirection(pp.x, pp.z);
      if(!sea){ toast('항구는 바닷가 근처에만 (해안에서 점령)'); return; }
      dir = sea;
    }
    const cost = kind==='harbor' ? HARBOR_COST : TOWER_COST;
    const group = kind==='harbor' ? buildHarbor(pp.x, baseY, pp.z, dir, true) : buildTower(pp.x, baseY, pp.z, true);
    activeSite = { kind, cost, paid:{timber:0,stone:0}, group, dir, x:pp.x, z:pp.z, baseY, t:0 };
    setGhostOpacity(group, 0);
    showGauge(activeSite);
    toast(kind==='harbor' ? '항구 터 — 곁에서 재료를 채워라 (목재·돌)' : '타워 터 — 재료를 채워라');
  }

  function cancelSite(){
    if(!activeSite) return;
    scene.remove(activeSite.group);
    // 투입한 재료 환급(절반) — 정본 미정, 너그럽게 절반 반환
    ctx.inventory?.add('timber', Math.floor(activeSite.paid.timber/2));
    ctx.inventory?.add('stone',  Math.floor(activeSite.paid.stone/2));
    activeSite = null; showGauge(null); toast('건설 취소 (재료 일부 환급)');
  }

  // ── 방어 타워 완성 공통 처리(플레이어 건설 / 비플레이어 스폰 공용) ──
  //   buildTower + 타워 객체 생성 + towers 등록 + breakable(배 포탄으로 파괴) 등록.
  //   owner: 'player'(내 타워 → 몹 표적) / 그 외 부족 id(적 타워 → 내 배 표적).
  function finishTower(x, baseY, z, owner){
    const g = buildTower(x, baseY, z, false);
    const t = { group:g, hp:TOWER_HP, maxHp:TOWER_HP, x, z, cannonY:baseY+8.6, range:TOWER_RANGE, reloadT:0,
      owner: owner || 'player',   // ★소유주 — 자동사격 표적 분기(내 타워=몹 / 적 타워=플레이어 배)
      homeList: null,             // ★소속 towers 배열(파괴 시 자동 제거용). 호출측이 지정 가능.
      damage(d){ t.hp-=d; if(t.hp<=0) destroyTower(t); } };
    towers.push(g.userData.tower = t);
    if(ctx.destruct) ctx.destruct.makeBreakable(g, { hp:TOWER_HP, onBreak:()=>destroyTower(t) });   // 배 대포로 격파 시 destruct 처리
    return t;
  }

  // ── 비플레이어(부족·적대) 방어 타워 스폰 공개 API ──
  //   capture/worldstream에서 호출: const t=ctx.claim.spawnDefenseTower(x,z,tribeId); outpost.towers.push(t); t.homeList=outpost.towers;
  //   재료 차감 없음(적 방어시설). baseY는 groundY로 자동. 타워 객체 반환.
  function spawnDefenseTower(x, z, owner){
    const baseY = groundY(x, z);
    return finishTower(x, baseY, z, owner || 'enemy');
  }

  // ── 🏰 곡선 해안 방벽(적 거점 방어시설) — fortify 복셀로 조립. worldstream에서 티어별 호출. ──
  //   거점(x,z)을 중심으로 바다쪽 부채꼴을 wallblock 벽으로 두르고, 균등 간격 cannonblock(포대)을 얹는다.
  //   반환: cannonblock 살아있는 핸들 배열(= outpost.towers에 push → capture 점령 게이트). 함포로 전부 부숴야 상륙.
  function buildCoastalRampart(opts={}){
    const { x, z, islandCenter, tier=1, tribe } = opts;
    if(!ctx.fortify || !ctx.fortify.placeStatic || tier<=0) return null;
    const { BW, BH } = ctx.fortify.dims();
    // 바다 방향(부채꼴 중심각): ground.seaDir 실측 우선, 없으면 거점→섬중심 반대 근사.
    const cx = islandCenter ? islandCenter.x : x, cz = islandCenter ? islandCenter.z : z;
    const sea = ctx.ground && ctx.ground.seaDir ? ctx.ground.seaDir(x, z) : null;
    const dir = sea ? Math.atan2(sea.z, sea.x) : Math.atan2(z - cz, x - cx);
    const half = Math.min(RAMPART_ARC * (0.6 + tier * 0.25), Math.PI * 0.9) / 2;   // 티어 클수록 호 길게
    const step = BW / RAMPART_R * 0.5;   // 그리드 갭 방지(촘촘히 스캔 → placeStatic이 중복 셀 무시)
    const nCannon = Math.max(1, tier);
    const cannonAngles = [];
    for(let k=0;k<nCannon;k++){ const f = nCannon===1 ? 0.5 : k/(nCannon-1); cannonAngles.push(dir - half + f*2*half); }
    const wl = waterLevel();
    const handles = [];
    const MARCH_MAX = 240;   // 스트림 섬 실제 반경(~180)까지 — 육지점이 중심으로 잡혀도 해안 도달
    for(let a = dir-half; a <= dir+half+1e-4; a += step){
      // 육지점에서 이 방위로 바깥 행진 → 육지→물 경계(실제 해안선)를 찾아 벽을 해안 살짝 안쪽에 세운다.
      //   ★버그수정(2026-07-12): 구버전은 고정 반경 RAMPART_R[16~34]만 훑음 → 해안점이면 바다로 나가 0개,
      //     중심점(대형섬 findLand 폴백)이면 내륙 반경34에 묻힘. 실제 섬(반경~180)·해안점 어디서도 벽이 안 서던 원인.
      let lx=null, lz=null;
      for(let r=0; r<=MARCH_MAX; r+=BW){ const sx=x+Math.cos(a)*r, sz=z+Math.sin(a)*r;
        if(groundY(sx,sz) > wl+0.6){ lx=sx; lz=sz; }   // 육지면 계속 바깥으로 갱신
        else if(lx!=null) break; }                      // 육지 뒤 첫 물 = 해안 넘음 → 마지막 육지=해안선
      if(lx==null) continue;
      const px = lx - Math.cos(a)*BW, pz = lz - Math.sin(a)*BW, baseY = groundY(px,pz);   // 해안선서 BW 안쪽(물턱 회피)
      if(baseY <= wl+0.6) continue;
      for(let L=0; L<RAMPART_LAYERS; L++) ctx.fortify.placeStatic('wallblock', px, baseY, pz, { layer:L, owner:tribe||'enemy' });
      const isCannon = cannonAngles.some(ca => Math.abs(((a-ca+Math.PI) % (2*Math.PI)) - Math.PI) < step);
      if(isCannon){ const h = ctx.fortify.placeStatic('cannonblock', px, baseY, pz, { layer:RAMPART_LAYERS, owner:tribe||'enemy' });
        if(h) handles.push(h); }   // 컬럼 중복이면 null(이미 포대 있음) → 스킵
    }
    return handles.length ? handles : null;
  }

  // ── 건설 완료 ─────────────────────────────────────────────
  function completeSite(){
    const s = activeSite; activeSite = null; showGauge(null);
    scene.remove(s.group);
    if(s.kind==='harbor'){
      const g = buildHarbor(s.x, s.baseY, s.z, s.dir, false);
      // 부두 데크를 충돌체에 등록(보행 가능)
      if(ctx.terrain.collide && g.userData.deckMeshes) for(const dk of g.userData.deckMeshes) ctx.terrain.collide.push(dk);
      // 깃발
      loader.load(FLAG, gl=>{ const f=gl.scene; let b=new THREE.Box3().setFromObject(f),sz=new THREE.Vector3(); b.getSize(sz);
        f.scale.setScalar(4.5/(sz.y||1)); b=new THREE.Box3().setFromObject(f); f.position.set(s.x, s.baseY-b.min.y, s.z); f.rotation.y=Math.random()*6.28;
        f.traverse(o=>{ if(o.isMesh)o.castShadow=true; }); scene.add(f); }, undefined, ()=>{});
      const island = { x:s.x, z:s.z, name:'점령섬 '+(claimed.length+1), r:40, owner:'player', dockPoint:g.userData.dockPoint, towers:[], buildings:[], hasHarbor:true, canonId:nearestCanonId(s.x,s.z) };   // 🏛️ buildings=거점 건물(settlement.js). hasHarbor=실제 항구 건물 존재(harbor.js 게이트). canonId=축5 교역로 조건 매칭용
      claimed.push(island); ctx.claimReg = island;
      ctx.reputation?.applyAction('CLAIM_EMPTY');   // 무인도 점령 +8 (동결)
      // 항구 = 부술 수 있는 거점(21번 E-2 항구 HP300). 배 대포 broadside로 격파 시 점령 상실.
      if(ctx.destruct) ctx.destruct.makeBreakable(g, { hp:300, onBreak:()=>{ island.owner='neutral';
        const ix=claimed.indexOf(island); if(ix>=0) claimed.splice(ix,1); toast('항구 파괴 — 점령 상실'); } });
      toast('섬 점령 완료! 항구 건설 (총 '+claimed.length+'개)');
    } else {
      // 플레이어 타워 완성 = finishTower(owner:'player' → 몹/적 표적). breakable 등록도 내부 처리.
      const t = finishTower(s.x, s.baseY, s.z, 'player');
      // 가까운 점령섬에 소속(파괴 시 그 섬 towers에서도 자동 제거)
      let near=null,nd=1e9; for(const c of claimed){ const dd=Math.hypot(c.x-s.x,c.z-s.z); if(dd<nd){nd=dd;near=c;} }
      if(near && near.towers){ near.towers.push(t); t.homeList = near.towers; }
      toast('방어 타워 완성 (HP '+TOWER_HP+') — 적 배 접근 시 자동 반격');
    }
  }

  function destroyTower(t){
    t.dead = true;   // ★E2(2026-07-15): 파괴 표시 — capture.towersAlive가 claimed[].towers에 남은 죽은 참조(cannon/crossbow는 homeList 미설정으로 잔존)를 유령 타워로 세지 않도록. destruct onBreak 경로는 t.hp를 안 깎으므로 hp>0 필터만으론 부족 → dead 플래그로 확실히 제외.
    const i = towers.indexOf(t); if(i>=0) towers.splice(i,1);
    if(t.homeList){ const j = t.homeList.indexOf(t); if(j>=0) t.homeList.splice(j,1); }   // 소속 towers 배열(섬/거점 outpost.towers)에서도 제거
    scene.remove(t.group);
    // TODO(naval/M3): three-pinata 보로노이 분쇄 연출(21번 F-3). 지금은 제거만.
    toast('방어 타워 파괴됨');
  }

  // ── 점령권 이전 인터페이스(naval 탈취 연계 자리) ──
  function claimIsland(islandId, owner){
    const isl = claimed.find(c=>c.name===islandId) || claimed[islandId];
    if(!isl) return false;
    isl.owner = owner;
    if(owner!=='player') ctx.reputation?.applyAction('CLAIM_ENEMY');  // 타 진영 섬 점령 -8
    return true;
  }
  // ── 통행세(점령 수입) — 섬 소유 메리트. 점령 섬 수 × BAL.economy.islandTaxPerMin, 분당 자동 지급. ──
  let _taxT = 0;
  ctx.onUpdate(dt=>{
    if(!ctx.inventory || !ctx.inventory.addGold) return;
    const owned = (ctx.claimed||[]).filter(c=>c.owner==='player').length;
    if(owned <= 0){ _taxT = 0; return; }
    _taxT += dt;
    if(_taxT >= 60){ _taxT -= 60; const gain = Math.round((BAL.economy?.islandTaxPerMin || 25) * owned);
      ctx.inventory.addGold(gain); toast('통행세 +'+gain+' 금화 (점령 '+owned+'섬)'); }
  });
  function collectTax(){ const owned=(ctx.claimed||[]).filter(c=>c.owner==='player').length; return Math.round((BAL.economy?.islandTaxPerMin||25)*owned); }   // 분당 예상 수입

  // ── 대포 제작 배치 (인벤토리 [제작] 탭에서 호출) ─────────────
  //   재료 차감은 invui([제작])이 한다. 여기선 고스트 미리보기 + 좌클릭 설치만.
  //   설치된 대포 = towers에 등록 → 기존 자동발사 루프가 조준·포격 처리.
  const _placeRC = new THREE.Raycaster();
  function cannonAim(){
    if(!ctx.camera || !ctx.terrain || !ctx.terrain.collide) return null;
    _placeRC.setFromCamera({ x:0, y:0 }, ctx.camera);          // 화면 중앙 조준
    const h = _placeRC.intersectObjects(ctx.terrain.collide, true);
    return h.length ? h[0].point : null;
  }
  const _BUILDERS = { cannon:buildCannon, crossbow:buildCrossbow, foundation:buildFoundation };
  const _PLACE_MSG = { cannon:'대포 배치 — 토대 위/지면에 좌클릭 설치 · 우클릭 취소', crossbow:'석궁 배치 — 토대 위/지면에 좌클릭 설치 · 우클릭 취소', foundation:'토대 배치 — 지면/토대 위(쌓기)에 좌클릭 · 우클릭 취소' };
  function startCannonPlace(a='cannon', b={}){
    if(cannonGhost) return false;                              // 이미 배치 중
    const kind = (typeof a==='string') ? a : 'cannon';        // 하위호환: startCannonPlace({onCancel}) = 대포
    const opts = (typeof a==='object' && a) ? a : b;
    cannonGhost = (_BUILDERS[kind]||buildCannon)(0,0,0,true); cannonGhost.visible=false; cannonGhost.userData.placeKind=kind;
    cannonOnCancel = opts.onCancel || null; cannonValid=false;
    toast(_PLACE_MSG[kind] || _PLACE_MSG.cannon);
    return true;
  }
  function endCannonPlace(){ if(cannonGhost){ scene.remove(cannonGhost); cannonGhost=null; } cannonOnCancel=null; cannonValid=false; }
  function cancelCannonPlace(){ if(!cannonGhost) return; const cb=cannonOnCancel; endCannonPlace(); if(cb) cb(); toast('대포 제작 취소 (재료 환급)'); }
  function registerCannon(x, baseY, z){
    const g = buildCannon(x, baseY, z, false);
    const t = { group:g, hp:CANNON_HP, maxHp:CANNON_HP, x, z, cannonY:baseY+2.6, range:CANNON_RANGE, reloadT:0, kind:'cannon',
      damage(d){ t.hp-=d; if(t.hp<=0) destroyTower(t); } };
    towers.push(g.userData.tower = t);
    let near=null,nd=1e9; for(const c of claimed){ const dd=Math.hypot(c.x-x,c.z-z); if(dd<nd){nd=dd;near=c;} }
    if(near && near.towers) near.towers.push(t);
    if(ctx.destruct) ctx.destruct.makeBreakable(g, { hp:CANNON_HP, onBreak:()=>destroyTower(t) });
    return t;
  }
  function placeCannon(){
    if(!cannonGhost || !cannonValid) return false;
    const gp=cannonGhost.position, baseY=gp.y;   // ★조준한 표면 높이(토대 위/build 바닥 위/지면)에 얹음 — groundY 강제 폐기
    const kind = cannonGhost.userData.placeKind || 'cannon';
    const REG = { cannon:registerCannon, crossbow:registerCrossbow, foundation:registerFoundation };
    (REG[kind]||registerCannon)(gp.x, baseY, gp.z);
    endCannonPlace();
    toast(kind==='crossbow' ? '석궁 설치 완료' : kind==='foundation' ? '토대 완성 — 위에 대포/석궁을 얹어라' : '대포 배치 완료 — 사거리 내 자동 포격');
    return true;
  }
  // ★BUG-010 수정(2026-07-13): 토대(foundation)는 raw 지면 레이캐스트 높이를 그대로 써서 놓을 때마다 topY가
  //   제각각이었음(경사·굴곡 지형) → x·z를 상단폭(3.9) 그리드로 스냅 + 인접 토대가 있으면 그 baseY로 높이 정렬.
  const FOUND_PITCH = 3.9;   // buildFoundation 상단 테두리 폭(197행)과 동일 — 이웃과 변이 딱 맞물림
  function snapFoundation(pt){
    const sx = Math.round(pt.x / FOUND_PITCH) * FOUND_PITCH, sz = Math.round(pt.z / FOUND_PITCH) * FOUND_PITCH;
    let by = pt.y, nd = Infinity;
    for(const f of foundations){ const d = Math.hypot(f.x-sx, f.z-sz); if(d < nd){ nd = d; by = f.topY - FOUNDATION_H - 0.4; } }
    if(nd > FOUND_PITCH*1.5) by = pt.y;   // 인접 그리드칸(직교·대각)에 이웃 없으면 원 지형 높이 사용
    return { x:sx, y:by, z:sz };
  }
  // 고스트 따라가기 + 유효성(육지) 색
  ctx.onUpdate(()=>{
    if(!cannonGhost) return;
    const pt = cannonAim();
    if(pt){ cannonGhost.visible=true;
      const snapped = cannonGhost.userData.placeKind==='foundation' ? snapFoundation(pt) : pt;
      cannonGhost.position.set(snapped.x, snapped.y, snapped.z);
      cannonValid = onLand(snapped.x, snapped.z);
      cannonGhost.traverse(o=>{ if(o.isMesh && o.material && o.material.transparent) o.material.color.setHex(cannonValid?0x4ade5a:0xff4040); });
    } else { cannonGhost.visible=false; cannonValid=false; }
  });
  ctx.renderer.domElement.addEventListener('pointerdown', e=>{
    if(!cannonGhost) return;
    if(document.pointerLockElement !== ctx.renderer.domElement) return;
    if(e.button===0) placeCannon();
    else if(e.button===2) cancelCannonPlace();
  });

  // ── 입력 ──
  addEventListener('keydown', e=>{
    if(cannonGhost && e.code==='Escape'){ cancelCannonPlace(); return; }
    if(document.pointerLockElement !== ctx.renderer.domElement) return;
    // ★G(항구 점령·건설) = wharf.js가 the-wharf 모델로 전담(사령관 2026-07-03).
    //   claim의 절차생성 부두(buildHarbor)는 G 바인딩 폐기 → the-wharf 모델과 이중 생성되던 버그 수정.
    //   startSite/completeSite는 디버그 헬퍼(ctx.claim._debugBuild 등)로만 잔존. claimed 등록은 wharf가 이관.
    // ★방어타워 T키 즉석 건설 폐기(사령관 2026-06-29) — 방어타워·대포는 인벤 [제작] 탭에서만 제작·배치.
    if(e.code==='KeyX' && activeSite) cancelSite();
  });

  // ── 업데이트 루프 ─────────────────────────────────────────
  ctx.onUpdate(dt=>{
    // 1) 건설 게이지: 플레이어가 터 근처면 보유 재료를 한 단위씩 투입
    if(activeSite){
      const s = activeSite, pp = ctx.player.pos;
      const near = Math.hypot(pp.x-s.x, pp.z-s.z) < SITE_RADIUS;
      if(near){
        s.t += dt;
        if(s.t >= BUILD_TICK){
          s.t = 0;
          let put = false;
          const inf = infiniteMaterials;   // 무한 모드면 인벤 차감 없이 게이지만 채움(테스트)
          if(s.paid.timber < s.cost.timber && (inf || ctx.inventory?.count('timber') > 0)){ if(inf || ctx.inventory.remove('timber',1)){ s.paid.timber++; put=true; } }
          else if(s.paid.stone < s.cost.stone && (inf || ctx.inventory?.count('stone') > 0)){ if(inf || ctx.inventory.remove('stone',1)){ s.paid.stone++; put=true; } }
          if(put){
            const p = (s.paid.timber+s.paid.stone)/(s.cost.timber+s.cost.stone);
            setGhostOpacity(s.group, p); showGauge(s);
            if(s.paid.timber>=s.cost.timber && s.paid.stone>=s.cost.stone) completeSite();
          }
        }
      }
    }
    // (구 "2) 방어 타워 자동 반격" 블록 삭제 — 아래 완성형 자동 발사 루프와 완전 중복이었음.
    //  ★버그: 두 루프가 같은 t.reloadT를 각각 -=dt(2배속 재장전) + 같은 표적에 이중 포격 + ctx.enemies는
    //    어디서도 생성 안 되는 죽은 인터페이스. 포신 조준·최근접 표적·hp체크가 있는 아래 루프만 남긴다.
  });

  // ── 방어 타워 자동 발사 ── 타워 owner에 따라 표적 분기:
  //   내 타워(owner='player'/미지정) → 사거리 내 가장 가까운 몬스터
  //   적 타워(owner≠'player', 부족 방어시설) → 플레이어 배(ctx.ship)
  //   조준 후 타워 대포(cannonY)에서 cannon.fire → 포탄 → 폭발.
  ctx.onUpdate(dt=>{
    if(!ctx.cannon || !towers.length) return;
    for(const t of towers){
      if(t.hp<=0) continue;
      const enemy = t.owner && t.owner!=='player';   // 적대 타워면 플레이어 배 표적
      let best=null, bd=t.range, tx=0, ty=0, tz=0;
      if(enemy){
        const sh = ctx.ship;                          // 플레이어 배(navmap 관례: ctx.ship.x/z)
        if(sh && sh.x!=null && sh.z!=null && (sh.durability==null || sh.durability>0)){
          const d = Math.hypot(sh.x-t.x, sh.z-t.z);
          if(d<bd){ bd=d; best=sh; tx=sh.x; tz=sh.z; ty=(sh.mesh?sh.mesh.position.y:waterLevel())+1.2; }
        }
      } else if(ctx.monsters){
        for(const mn of ctx.monsters){ if(mn.dead) continue; const q=mn.grp.position;
          const d=Math.hypot(q.x-t.x, q.z-t.z); if(d<bd){ bd=d; best=mn; tx=q.x; ty=q.y+0.8; tz=q.z; } }
      }
      const cm=t.group.userData.cannonMesh;
      if(best && cm){ cm.rotation.y=Math.atan2(tx-t.x, tz-t.z); }   // 포신 조준(타깃 향해 회전)
      t.reloadT -= dt;
      if(t.reloadT<=0 && best){
        ctx.cannon.fire(t.x, t.cannonY, t.z, tx, ty, tz); t.reloadT = t.reload || CANNON_RELOAD; }   // 발사(석궁=빠른 연사)
    }
  });

  ctx.claim = { startSite, cancelSite, claimIsland, collectTax, claimed, towers,
    nearestCanonId,   // 🧭 3D좌표→canon 섬 id (wharf.js 섬당 1개 가드가 섬 정체성으로 판정하게 노출, 2026-07-23)
    spawnDefenseTower,   // ★비플레이어(부족·적대) 방어 타워 스폰 API — capture/worldstream 연동
    buildCoastalRampart, // 🏰 곡선 해안 방벽(복셀) 스폰 API — worldstream 티어별 호출, 핸들=점령 게이트
    HARBOR_COST, TOWER_COST, CANNON_COST,
    setInfinite:(b)=>{ infiniteMaterials=!!b; console.log('[claim] 재료 무한 모드', infiniteMaterials?'ON(테스트)':'OFF'); },  // 테스트: 재료 무한
    get infiniteMaterials(){ return infiniteMaterials; },
    // 대포/석궁 제작 배치(인벤 [제작] 탭 연동). 석궁=대인(빠름), 대포=대함(강함).
    startCannonPlace, cancelCannonPlace, isPlacing:()=>!!cannonGhost,
    startCrossbowPlace:(opts={})=>startCannonPlace('crossbow', opts),
    startFoundationPlace:(opts={})=>startCannonPlace('foundation', opts),   // 🧱 토대 배치(위에 대포 얹기)
    CROSSBOW_COST, FOUNDATION_COST, foundations,
    // 디버그: 토대 즉시 설치.
    _devFoundation(x,z){ x=(x==null?(ctx.player?.pos.x||0):x); z=(z==null?(ctx.player?.pos.z||0):z); let baseY=groundY(x,z);
      if(baseY<0.8){ outer: for(let r=10;r<90;r+=8) for(let a=0;a<6.283;a+=0.5){ const px=x+Math.cos(a)*r, pz=z+Math.sin(a)*r, gy=groundY(px,pz); if(gy>0.8){ x=px; z=pz; baseY=gy; break outer; } } }
      const g=registerFoundation(x, baseY, z); return { topY:g.userData.topY, x, z }; },
    // 디버그: 석궁 타워 즉시 설치(재료 무시) — 자동사격 검증용.
    _devCrossbow(x,z){ x=(x==null?(ctx.player?.pos.x||0):x); z=(z==null?(ctx.player?.pos.z||0):z); let baseY=groundY(x,z);
      if(baseY<0.8){ outer: for(let r=10;r<90;r+=8) for(let a=0;a<6.283;a+=0.5){ const px=x+Math.cos(a)*r, pz=z+Math.sin(a)*r, gy=groundY(px,pz); if(gy>0.8){ x=px; z=pz; baseY=gy; break outer; } } }
      return registerCrossbow(x, baseY, z); },
    // 디버그: 임의 지점에 대포 즉시 설치(재료 무시) — 헤드리스 검증용. 바다면 근처 육지 탐색.
    _devPlaceCannon(x,z){ x=(x==null?(ctx.player?.pos.x||0):x); z=(z==null?(ctx.player?.pos.z||0):z); let baseY=groundY(x,z);
      if(baseY<0.8){ outer: for(let r=10;r<90;r+=8) for(let a=0;a<6.283;a+=0.5){ const px=x+Math.cos(a)*r, pz=z+Math.sin(a)*r, gy=groundY(px,pz); if(gy>0.8){ x=px; z=pz; baseY=gy; break outer; } } }
      return registerCannon(x, baseY, z); },
    // 디버그: 방어 타워 즉시 생성(재료 무시) — 자동발사 테스트용. player가 바다면 근처 섬 지점 탐색.
    _devTower(){ const pp=ctx.player.pos; let tx=pp.x, tz=pp.z, baseY=groundY(tx,tz);
      if(baseY<0.8){ outer: for(let r=10;r<90;r+=8) for(let a=0;a<6.283;a+=0.5){ const x=pp.x+Math.cos(a)*r, z=pp.z+Math.sin(a)*r, gy=groundY(x,z); if(gy>0.8){ tx=x; tz=z; baseY=gy; break outer; } } }
      const g=buildTower(tx,baseY,tz,false);
      const t={group:g,hp:TOWER_HP,maxHp:TOWER_HP,x:tx,z:tz,cannonY:baseY+8.6,range:TOWER_RANGE,reloadT:0,damage(d){t.hp-=d;if(t.hp<=0)destroyTower(t);}};
      towers.push(g.userData.tower=t); return t; },
    // 디버그(헤드리스 검증용): 재료 없이 즉시 완성
    _debugFill(){ if(activeSite){ activeSite.paid.timber=activeSite.cost.timber; activeSite.paid.stone=activeSite.cost.stone; completeSite(); } },
    // 디버그: player 위치에 site 생성 + 보유 재료 실제 차감하며 완성(near 우회). 재료 부족 시 false.
    _debugBuild(kind){ startSite(kind); if(!activeSite) return false; const s=activeSite;
      while(s.paid.timber<s.cost.timber || s.paid.stone<s.cost.stone){
        if(s.paid.timber<s.cost.timber && ctx.inventory?.count('timber')>0){ ctx.inventory.remove('timber',1); s.paid.timber++; }
        else if(s.paid.stone<s.cost.stone && ctx.inventory?.count('stone')>0){ ctx.inventory.remove('stone',1); s.paid.stone++; }
        else return false; }
      completeSite(); return true; } };
  console.log('[claim] 점령 시스템 등록 — G:항구 점령 / X:취소 · 방어타워·대포=인벤 [제작] 탭. 항구', HARBOR_COST, '대포', CANNON_COST);
  return ctx.claim;
}
