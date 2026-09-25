// trader.js — 교역소 NPC (_GAME_DESIGN §6 ① 기능 NPC "1순위"). 점령 항구에 상인을 세우고 E키로 교역창을 연다.
//   기획 흐름: 섬 점령(claim.js) → 항구에 교역소 NPC 스폰 → 플레이어 접근 E키 → trade.js 교역창(그 항구 시세=npc.priceAt).
//   ★T키 직접 교역(trade.js)·claim 타워키 충돌 폐기 → NPC 상호작용으로 일원화.
//   콘센트: ctx.claimed(점령 섬, claim.js)·ctx.trade(교역창)·ctx.terrain(지면)·ctx.player. 이 파일만 수정.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

const CHAR = '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/Mage.glb';            // 상인 = 로브 입은 메이지(상인 느낌)
const ANIM = '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/Rig_Medium_General.glb';   // idle 애니(같은 Rig_Medium)
const TALK_RANGE = 5.0;   // 상호작용 반경(m)
const NPC_HEIGHT = 1.8;   // 캐릭터 키 정규화(m)

export async function initTrader(ctx){
  const { scene } = ctx;
  const loader = new GLTFLoader();

  // ── 캐릭터 + idle 애니 로드(1회, 점령 항구마다 clone) ──
  const [charG, animG] = await Promise.all([
    new Promise((res)=>loader.load(CHAR, res, undefined, ()=>res(null))),
    new Promise((res)=>loader.load(ANIM, res, undefined, ()=>res(null))),
  ]);
  let proto = null, SCALE = 1, FOOT = 0, idleClip = null;
  if(charG && charG.scene){
    proto = charG.scene;
    const box = new THREE.Box3().setFromObject(proto), sz = new THREE.Vector3(); box.getSize(sz);
    SCALE = NPC_HEIGHT / (sz.y || 1); FOOT = box.min.y;     // 발 바닥 정렬용
    proto.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
  } else { console.warn('[trader] 캐릭터 로드 실패 — 폴백 박스 상인'); }
  if(animG && animG.animations) idleClip = animG.animations.find(a=>/idle/i.test(a.name)) || animG.animations[0];
  console.log('[trader] 교역소 NPC 준비 —', proto?'KayKit Mage':'폴백', idleClip?('idle:'+idleClip.name):'정적');

  const npcs = [];   // [{group, mixer, island, label}]
  const groundY = (x,z)=> ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0;

  // ── 머리 위 라벨 스프라이트(⚓ 교역소) ──
  function makeLabel(text){
    const c=document.createElement('canvas'); c.width=300; c.height=72; const g=c.getContext('2d');
    g.fillStyle='rgba(10,18,28,.82)'; g.beginPath(); g.roundRect(6,8,288,52,12); g.fill();
    g.strokeStyle='rgba(120,200,235,.55)'; g.lineWidth=2; g.stroke();
    g.font='bold 30px system-ui,"Malgun Gothic"'; g.textAlign='center'; g.textBaseline='middle';
    g.fillStyle='#ffe07a'; g.fillText(text, 150, 36);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthTest:false, depthWrite:false }));
    sp.scale.set(4.2, 1.0, 1); sp.renderOrder=10; return sp;
  }

  // 폴백 박스 상인(캐릭터 로드 실패 시)
  function fallbackBody(){ const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.4,0.9,4,8), new THREE.MeshLambertMaterial({color:0x6a4ea0}));
    body.position.y=0.9; g.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.32,12,10), new THREE.MeshLambertMaterial({color:0xe8c9a0}));
    head.position.y=1.7; g.add(head); return g; }

  // ── 점령 항구에 NPC 스폰 ──
  //   ⛔ 사령관 2026-08-07 "항구관리 NPC 빼고" — 항구에 세우던 상인/추종자 피규어를 폐지한다.
  //     항구 관리·교역 진입은 부두 근처 [E] 프롬프트(아래 onUpdate)가 이미 담당하므로 기능 손실 없음.
  //     ⚠️추종자를 교역 NPC로 징발하던 분기도 같이 멈춘다 → 추종자가 크루로 계속 남는다(setLandOrder('wait') 고정 안 함).
  //     되살리려면 이 가드만 지우면 됨(스폰 로직은 아래 그대로 보존).
  const TRADER_NPC = false;
  function spawn(isl){
    if(!TRADER_NPC) return;
    const x = isl.x, z = isl.z;
    let y = groundY(x, z);
    const wl = ctx.water ? ctx.water.level : 0;
    if(y < wl + 0.5) y = wl + 1.2;   // 부두(물 위 데크)에 세울 때 잠김 방지
    // ★첫 교역 NPC = 깨어남 추종자(사령관): 별도 상인 대신 추종자가 깨어난 자리에서 이 지점으로 걸어와 교역을 맡는다.
    //   2026-07-10: ctx.follower가 이제 crew.js 피규어와 동일 객체 — 여기서 수동으로 걷는 동안 crew 자체 FSM이
    //   위치를 못 건드리게(다투지 않게) 'wait'로 고정. 이후 이 캐릭터는 항구에 정착(크루에서 은퇴, 로스터는 유지).
    if(ctx.follower && ctx.follower.group && !ctx.follower._used){
      try{ ctx.crew && ctx.crew.setLandOrder && ctx.crew.setLandOrder('wait'); }catch(_){}
      ctx.follower._used = true;
      const rec = { group:ctx.follower.group, mixer:ctx.follower.mixer||null, island:isl, x, z, walking:true, targetY:y, isFollower:true };
      isl._trader = rec; npcs.push(rec);
      console.log('[trader] 교역 NPC = 추종자 — 항구로 이동', `(${x.toFixed(0)},${z.toFixed(0)})`);
      return;
    }
    const g = proto ? skClone(proto) : fallbackBody();
    if(proto) g.scale.setScalar(SCALE);
    g.position.set(x, y - (proto? FOOT*SCALE : 0), z);
    g.rotation.y = (isl._faceYaw != null) ? isl._faceYaw : Math.random()*Math.PI*2;
    scene.add(g);
    const mixer = (proto && idleClip) ? new THREE.AnimationMixer(g) : null;
    if(mixer){ mixer.clipAction(idleClip).play(); }
    const rec = { group:g, mixer, island:isl, x, z };   // 팻말은 건물 위(아래 1b)로 — NPC 머리 위 라벨 제거
    isl._trader = rec; npcs.push(rec);
    console.log('[trader] 교역소 NPC 스폰 — 점령섬', isl.name, `(${x.toFixed(0)},${z.toFixed(0)})`);
  }

  // ── 상호작용 프롬프트 ──
  const prompt = document.createElement('div');
  prompt.style.cssText = 'position:fixed;left:50%;bottom:30%;transform:translateX(-50%);z-index:25;background:rgba(10,16,24,.85);color:#eaf4ff;padding:9px 20px;border-radius:9px;font:15px system-ui,"Malgun Gothic";display:none;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.5)';
  prompt.innerHTML = '<b style="color:#ffe07a">[E]</b> 항구 관리';
  document.body.appendChild(prompt);
  let nearNpc = null;

  // ── 매 프레임: 점령 항구 감시(새 NPC 스폰) + idle 애니 + 근접 프롬프트 ──
  ctx.onUpdate((dt)=>{
    // 1) ★섬 중앙 자동 스폰 폐지 — 교역 NPC는 항구 건물 문 앞 하나로 일원화(아래 1b). 추종자가 그리로 걸어옴(사령관).
    // if(ctx.claimed){ for(const isl of ctx.claimed){ if(!isl._trader && isl.owner==='player') spawn(isl); } }
    // 1b) ★항구 건물 완성 시 건물 문 앞에 교역소 NPC 생성(= 추종자)
    //   ★SIM-B4 수정: 기존 게이트=ctx.smithyObj(대장간)였으나 smithy 시스템 폐지(2026-07-04)로 죽은 경로였음.
    //   → wharf 항구 건물(ctx.wharf) 기준으로 일원화(2026-07-12 smithy 잔재 완전 제거).
    const _hb = ctx.wharf && ctx.wharf.obj && ctx.wharf.pos ? ctx.wharf : null;
    if(_hb && !_hb._trader){
      const o = _hb.obj, yw = (o && o.rotation && o.rotation.y) || 0;
      const fx = Math.sin(yw), fz = Math.cos(yw);   // 건물 정면(문) 방향
      let dist = 6;
      const box = o ? new THREE.Box3().setFromObject(o) : null;
      if(box){ const sz=box.getSize(new THREE.Vector3()); dist = Math.max(sz.x, sz.z)*0.5 + 3; }   // 건물 절반 + 3m = 문 밖
      spawn({ x: _hb.pos.x + fx*dist, z: _hb.pos.z + fz*dist, name:'항구', owner:'player', r:30 });
      // ★팻말 "⚓ 항구" = 항구 건물 위 — 철거 회수(removeNear) 가능하게 NPC 레코드에 부착
      const sign = makeLabel('항구'); sign.scale.set(7, 1.7, 1);
      sign.position.set(_hb.pos.x, (box ? box.max.y : _hb.pos.y||0) + 2.5, _hb.pos.z); scene.add(sign);
      const _rec = npcs[npcs.length-1]; if(_rec) _rec.sign = sign;
      _hb._trader = true;
    }
    // 2) idle 애니 + 플레이어 바라보기(상인이 손님 향함 — 문을 등지고 플레이어 쪽)
    const pp = ctx.player && ctx.player.pos;
    for(const n of npcs){ if(n.mixer) n.mixer.update(dt);
      if(n.walking){   // ★추종자가 깨어난 자리 → 항구 문 앞으로 걸어옴(도착하면 정지·손님 향함)
        const gp=n.group.position, dx=n.x-gp.x, dz=n.z-gp.z, d=Math.hypot(dx,dz);
        if(d<0.4){ n.walking=false; gp.set(n.x, (n.targetY!=null?n.targetY:groundY(n.x,n.z)), n.z); }
        else { const sp=Math.min(d, 5.5*dt); gp.x+=dx/d*sp; gp.z+=dz/d*sp; gp.y=groundY(gp.x,gp.z); n.group.rotation.y=Math.atan2(dx,dz); }
        continue;
      }
      if(pp){ const dx=pp.x-n.x, dz=pp.z-n.z; if(dx*dx+dz*dz>0.04) n.group.rotation.y = Math.atan2(dx, dz); } }
    // 3) 근접 판정 — 가장 가까운 교역소 NPC가 TALK_RANGE 안이면 프롬프트
    nearNpc = null;
    if(pp){ let bd = TALK_RANGE;
      for(const n of npcs){ const d = Math.hypot(n.x-pp.x, n.z-pp.z); if(d < bd){ bd = d; nearNpc = n; } } }
    prompt.style.display = (nearNpc && ctx.trade) ? 'block' : 'none';
  });

  // ── E키 = 교역창 열기(근처 교역소 NPC 있을 때만) ──
  addEventListener('keydown', e=>{
    if(e.code !== 'KeyE') return;
    if(ctx.harbor && ctx.harbor.isOpen && ctx.harbor.isOpen()){ ctx.harbor.close(); return; }   // 열려있으면 닫기
    if(nearNpc && ctx.harbor && ctx.harbor.openAt){ ctx.harbor.openAt(nearNpc); }                // 근처 NPC → 항구 관리 허브
  });

  ctx.trader = {
    npcs, spawn,
    // ★SIM-B3(항구 철거) — 반경 내 교역 NPC/팻말 회수. 추종자 NPC는 씬에 남기고(사람 삭제 금지) 교역 역할만 해제(재건 시 재배정).
    removeNear(x, z, r=40){ let n=0;
      for(let i=npcs.length-1;i>=0;i--){ const p=npcs[i]; if(Math.hypot(p.x-x, p.z-z)>r) continue;
        if(p.sign) try{ scene.remove(p.sign); }catch(_){}
        if(p.isFollower){ if(ctx.follower) ctx.follower._used=false; }
        else { try{ scene.remove(p.group); }catch(_){} }
        if(p.island) p.island._trader=null;
        npcs.splice(i,1); n++; }
      return n; },
    // 디버그: 임의 위치에 교역소 NPC 스폰(점령 없이 테스트). 헤드리스/단독 검증용.
    _devSpawn(x, z){ if(x==null || z==null){ const pp=ctx.player?.pos||{x:0,z:0}, yw=ctx.player?.yaw||0;
        x=pp.x - Math.sin(yw)*4; z=pp.z - Math.cos(yw)*4; }   // 플레이어 발 앞 4m(겹침 방지)
      const isl={ x, z, name:'테스트항구', owner:'player', r:30 }; spawn(isl); return isl; },
    nearNpc:()=>nearNpc,
  };
  console.log('[trader] 교역소 NPC 시스템 등록 — 점령 항구에 상인 자동 스폰 · 근처 E키로 교역창');
  return ctx.trader;
}
