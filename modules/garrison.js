// garrison.js — 그롬 주둔(수비대) + 🛡 용병 모집(사령관 기획 2026-07-05).
//   ★"어디에나 있을 순 없다" 해소: 내가 없어도 주둔한 섬은 스스로 방어. 석궁타워보다 짧은 사거리·지속딜(사람).
//   ★용병 = 비-KayKit 하급 전투원(사령관 모델 원칙: KayKit=추종자 A급 / 나머지=NPC·용병·적).
//     항구 수비 탭에서 골드 모집(BAL.economy.mercCost, 섬당 mercCap) → 항구 주변 '정찰 순회'(웨이포인트 배회)
//     → 습격병이 사거리 안이면 정찰 멈추고 자동 공격(기존 수비 로직 공유). 유지비 없음(v1 — 모집비 1회).
//   기존 계약 보존: place(island)=단일 정적 수비대(barracks 효과 경로) 그대로. recruit()가 용병 경로.
//   콘센트: ctx.claimed(내 섬)·ctx.monsters(습격병)·ctx.terrain·ctx.inventory·ctx.scene. 이 파일만 수정.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';
import { BAL } from '/tomob-deploy/modules/balance.js';

const GUARD = '/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Mini Arena/Models/GLB format/character-soldier.glb';   // 잠긴 왕국 병사(내장 애니 idle/walk/attack/die)
// 🛡 용병 로스터 — 전부 자체 애니 내장 모델(리타깃 불필요). 이름=세계관(구 추종자 로스터에서 계승).
const MERCS = [
  { url:GUARD, nm:'잠긴 왕국 병사' },
  { url:'/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Mini Dungeon/Models/GLB format/character-orc.glb', nm:'이방 용병' },
  { url:'/tomob-deploy/GruntPolyart.glb',  nm:'봉우리 투사' },
  { url:'/tomob-deploy/DogPolyart.glb',    nm:'들개 기사' },
];
const RANGE = 13, CD = 1.3, DMG = 16, HEIGHT = 1.8;
const PATROL_R = 14, PATROL_SPD = 1.6;   // 정찰 반경(m)·보행 속도

export function initGarrison(ctx){
  const { scene } = ctx;
  const loader = new GLTFLoader();
  const garrison = [];
  const groundY = (x,z)=> ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0;
  const toast = (t,acc)=> ukToast(t, { accent:acc||'cyan', ms:2400 });
  const waterL = ()=> ctx.water ? ctx.water.level : 0;

  // 공용 스폰 — def{url,nm}, patrol=정찰 순회 여부, post=소속 초소(막사 rec / 없으면 섬). 완료 시 garrison[] 등록.
  function _spawn(island, x, z, def, patrol, post){
    loader.load(encodeURI(def.url), g=>{
      const m = g.scene; let box=new THREE.Box3().setFromObject(m), sz=new THREE.Vector3(); box.getSize(sz);
      // def.h = 개체별 키 override(🗡️ 몬스터 용병 — 골렘·아나킴 같은 대형종을 1.8m 인간 크기로 눌러버리면 위압감이 사라진다).
      const s = (def.h || HEIGHT)/(sz.y||1); m.scale.setScalar(s); const foot = box.min.y*s, gy = groundY(x,z);
      m.traverse(n=>{ if(n.isMesh) n.castShadow=true; });
      const grp = new THREE.Group(); grp.add(m); grp.position.set(x, gy-foot, z); scene.add(grp);
      let mixer=null, actions=null;
      if(g.animations && g.animations.length){ mixer=new THREE.AnimationMixer(m);
        const fc=(...ns)=>{ for(const n of ns){ const c=g.animations.find(a=>a.name.toLowerCase()===n); if(c)return c; } for(const n of ns){ const c=g.animations.find(a=>a.name.toLowerCase().includes(n)); if(c)return c; } return null; };
        const mk=c=>c?mixer.clipAction(c):null;
        actions={ idle:mk(fc('idle')), walk:mk(fc('walk','run','sprint')), attack:mk(fc('attack-melee-right','attack','melee')) };
        if(actions.attack){ actions.attack.setLoop(THREE.LoopOnce); }
        if(actions.idle){ actions.idle.play(); } }
      const hpMax = BAL.economy?.mercHp ?? 140;
      garrison.push({ island, post: post || island, group:grp, x, z, foot, mixer, actions, cd:0, anim:'idle', nm:def.nm, url:def.url, h:def.h||null,
        hp: hpMax, hpMax,   // 🛡 피격 가능(습격병이 타겟) — 0이면 전사. hpMax = 🪣우물 guardRegen 회복 상한
        patrol: patrol ? { hx:x, hz:z, tgt:null, pause:0.5+Math.random()*2 } : null });
    }, undefined, e=>console.warn('[garrison] 모델 로드 실패', def.url, e&&e.message));
  }
  // ⚔️ 전사 처리 — monsters.js(습격병 타격)가 호출. 씬 정리 + 목록 제거 + 알림.
  function killUnit(gr){
    const i = garrison.indexOf(gr); if(i < 0) return;
    try{ scene.remove(gr.group); }catch(_){}
    garrison.splice(i, 1);
    toast(`${gr.nm} 전사 — 수비가 얇아졌습니다`, 'red');
  }
  // 💾 세이브 직렬화/복원 — 정찰 용병만(정적 place는 barracks 효과가 재생성). 섬은 (x,z)로 매칭.
  //   ★url/h도 함께 저장(2026-08-07): 🗡️ 몬스터 용병(mercenary.js)은 MERCS 고정 4종 밖의 def라 이름만으로는 복원이 안 된다.
  //     안 하면 굴복시킨 몬스터가 리로드 한 번에 전부 '잠긴 왕국 병사'(MERCS[0])로 바뀐다.
  function serialize(){
    return garrison.filter(g=>g.patrol).map(g=>({ x:+g.x.toFixed(1), z:+g.z.toFixed(1), nm:g.nm,
      url:g.url||null, h:g.h||null,
      ix:+((g.island&&g.island.x)||g.x).toFixed(1), iz:+((g.island&&g.island.z)||g.z).toFixed(1) }));
  }
  function restore(arr){
    for(const r of (arr||[])){
      // url이 저장돼 있으면 그 def를 그대로 복원(몬스터 용병) — 없으면 구 세이브라 이름으로 MERCS 매칭.
      const def = r.url ? { url:r.url, nm:r.nm, h:r.h || undefined }
                        : (MERCS.find(m=>m.nm===r.nm) || MERCS[0]);
      let isl = null, bd = 80;   // 저장된 섬 좌표와 가장 가까운 내 점령 섬
      for(const c of (ctx.claimed||[])){ if(c.owner!=='player') continue;
        const d=Math.hypot(c.x-r.ix, c.z-r.iz); if(d<bd){ bd=d; isl=c; } }
      _spawn(isl || { x:r.ix, z:r.iz }, r.x, r.z, def, true);
    }
    if(arr && arr.length) console.log('[garrison] 용병 복원', arr.length, '명');
  }

  // ── 정적 수비대(barracks/archeryrange 효과 경로) ──
  //   ★버그수정(감사 A4, 2026-07-22): 예전엔 place(island)만 받아 **막사 위치와 무관하게 섬 중심(island.x+3)** 고정 스폰이었고,
  //     "그 섬에 정적 수비대가 이미 있으면 거부"라 **2채째 막사는 병사가 0명**이었다(효과는 용병 상한 +1만 남음).
  //   → settlement.applySideEffects가 건물 rec(좌표)을 넘긴다. 중복 판정도 섬 단위 → **건물 rec 단위**로 바꿔
  //     막사 2채 = 수비병 2명이 각자 자기 건물 앞에 선다. 복원(restore) 시 같은 rec으로 재호출돼도 중복 안 생김.
  function place(island, rec){
    if(!island) return false;
    const key = rec || island;                                        // rec 없으면 구 계약(섬 단위) 폴백
    if(garrison.some(g => g.post===key && !g.patrol)) return false;    // 같은 초소 중복 금지(토스트 없음 — 복원 시 조용히)
    // 스폰 지점 = 건물 앞 4m(건물과 안 겹치게). 좌표가 없으면 구 동작(섬 중심 근처).
    let sx = island.x+3, sz = island.z-3;
    if(rec && rec.x!=null){
      const ang = Math.atan2(island.x - rec.x, island.z - rec.z);     // 건물 → 섬 중심 방향(=건물 정면)
      sx = rec.x + Math.sin(ang)*4; sz = rec.z + Math.cos(ang)*4;
      if(groundY(sx,sz) <= waterL()+0.5){ sx = rec.x+3; sz = rec.z+3; }   // 물이면 대각 폴백
    }
    _spawn(island, sx, sz, MERCS[0], false, key);
    toast('수비대 주둔 — 습격 시 자동 방어');
    return true;
  }

  // ── 🛡 용병 모집(항구 수비 탭) — 골드 차감·섬당 상한·랜덤 로스터·정찰 순회 ──
  function mercCount(island){ return garrison.filter(g=>g.island===island && g.patrol).length; }
  function recruit(island){
    if(!island || island.x==null) { toast('점령 항구에서만 모집할 수 있습니다','red'); return false; }
    // ★E3(2026-07-15): 막사(barracks) garrison 효과 배선 — 그 섬 막사 수만큼 용병 상한↑. effectSum 재사용(정의만 되고 소비 안 되던 effect key 작동).
    const gar = ctx.settlement?.effectSum ? (ctx.settlement.effectSum(island, 'garrison')||0) : 0;
    const cap = (BAL.economy?.mercCap ?? 4) + gar, cost = BAL.economy?.mercCost ?? 300;
    if(mercCount(island) >= cap){ toast(`용병 상한 도달 (${cap}명)`,'red'); return false; }
    if(!ctx.inventory || !ctx.inventory.addGold || !ctx.inventory.addGold(-cost)){ toast(`금화 부족 — 모집비 ${cost}`,'red'); return false; }
    const def = MERCS[(Math.random()*MERCS.length)|0];
    // 스폰 위치: 항구 기준 반경 4~9m 육지 샘플(물 회피)
    let sx=island.x+4, sz2=island.z+4;
    for(let t=0;t<12;t++){ const a=Math.random()*6.283, d=4+Math.random()*5;
      const px=island.x+Math.cos(a)*d, pz=island.z+Math.sin(a)*d;
      if(groundY(px,pz) > waterL()+0.5){ sx=px; sz2=pz; break; } }
    _spawn(island, sx, sz2, def, true);
    toast(`${def.nm} 합류 — 항구 주변을 정찰합니다 (−${cost} 금화)`, 'gold');
    return true;
  }

  ctx.onUpdate(dt=>{
    if(!garrison.length) return;
    for(const gr of garrison){
      if(gr.mixer) gr.mixer.update(dt);
      // 사거리 내 가장 가까운 습격병
      let best=null, bd=RANGE;
      if(ctx.monsters) for(const mn of ctx.monsters){ if(!mn.raider || mn.dead) continue; const q=mn.grp.position; const d=Math.hypot(q.x-gr.x, q.z-gr.z); if(d<bd){ bd=d; best=mn; } }
      if(best){
        const q=best.grp.position; gr.group.rotation.y = Math.atan2(q.x-gr.x, q.z-gr.z);   // 적 향함(정찰 중단)
        gr.cd -= dt;
        if(gr.cd <= 0){ gr.cd = CD;
          best.hp -= DMG;                                    // 지속딜
          if(gr.actions && gr.actions.attack){ gr.actions.attack.reset().play(); }   // 공격 모션
          if(best.hp <= 0 && best.kill) best.kill();          // 처치
        }
        gr._rgAcc = 0;   // 전투 중엔 회복 정지
        continue;
      }
      // 🪣 우물(guardRegen) — 비전투 시 그 섬 우물 수만큼 회복. 습격 후 재건(재모집 골드) 부담을 줄이는 게 목적.
      //   감사 B5: 우물이 400골드에 effect{} 빈 껍데기였던 것을 실제 소비되는 효과로 회수.
      if(gr.hp < (gr.hpMax||140) && gr.island && ctx.settlement?.effectSum){
        gr._rgAcc = (gr._rgAcc||0) + dt;
        if(gr._rgAcc >= 1){ gr._rgAcc = 0;
          const rg = ctx.settlement.effectSum(gr.island, 'guardRegen') || 0;
          if(rg > 0) gr.hp = Math.min(gr.hpMax||140, gr.hp + rg); }
      }
      // 🛡 정찰 순회(용병) — 홈 반경 내 랜덤 육지 지점 보행 → 잠깐 경계 → 반복(몬스터 wander 패턴).
      const P = gr.patrol; if(!P) continue;
      if(P.pause > 0){ P.pause -= dt; _anim(gr,'idle'); continue; }
      if(!P.tgt){ for(let t=0;t<8;t++){ const a=Math.random()*6.283, d=3+Math.random()*PATROL_R;
          const px=P.hx+Math.cos(a)*d, pz=P.hz+Math.sin(a)*d;
          if(groundY(px,pz) > waterL()+0.5){ P.tgt={x:px,z:pz}; break; } }
        if(!P.tgt){ P.pause=2; continue; } }
      const dx=P.tgt.x-gr.x, dz=P.tgt.z-gr.z, d=Math.hypot(dx,dz);
      if(d < 0.6){ P.tgt=null; P.pause=2.5+Math.random()*3.5; _anim(gr,'idle'); continue; }
      const mv=Math.min(d, PATROL_SPD*dt);
      gr.x += dx/d*mv; gr.z += dz/d*mv;
      const gy=groundY(gr.x,gr.z);
      gr.group.position.set(gr.x, gy-gr.foot, gr.z);
      { let dy=Math.atan2(dx,dz)-gr.group.rotation.y; dy=Math.atan2(Math.sin(dy),Math.cos(dy)); gr.group.rotation.y += dy*Math.min(1,dt*7); }   // 부드러운 선회
      _anim(gr,'walk');
    }
  });
  // 애니 전환(있는 클립만, 크로스페이드) — kenney 내장 idle/walk
  function _anim(gr, name){
    if(gr.anim===name || !gr.actions) return;
    const nx=gr.actions[name], cur=gr.actions[gr.anim];
    if(!nx){ return; }
    nx.enabled=true; nx.reset(); nx.setEffectiveWeight(1); nx.play();
    if(cur && cur!==nx) nx.crossFadeFrom(cur, 0.22, false);
    gr.anim=name;
  }

  // 🗡️ 커스텀 def 배치(mercenary.js — 던전에서 굴복시킨 몬스터를 내 거점 수비병으로). 골드·상한 검사는 호출자 몫.
  //   MERCS 고정 4종 대신 임의 {url,nm,scale}를 받는 것 외에는 recruit()과 동일 경로(정찰·전투·저장 전부 공유).
  function placeDef(island, def, opts){
    if(!island || island.x==null || !def || !def.url) return false;
    opts = opts || {};
    let sx=island.x+4, sz=island.z+4;
    for(let t=0;t<12;t++){ const a=Math.random()*6.283, d=4+Math.random()*5;
      const px=island.x+Math.cos(a)*d, pz=island.z+Math.sin(a)*d;
      if(groundY(px,pz) > waterL()+0.5){ sx=px; sz=pz; break; } }
    _spawn(island, sx, sz, def, opts.patrol !== false);
    return true;
  }
  ctx.garrison = { place, placeDef, recruit, mercCount, killUnit, serialize, restore, list:garrison,
    // 디버그(검증): 내 점령 섬에 수비대 배치
    _devPlace(){ const isl=(ctx.claimed||[]).find(c=>c.owner==='player'); return isl ? place(isl) : false; } };
  console.log('[garrison] 수비대+용병 등록 — place(정적)·recruit(골드 '+(BAL.economy?.mercCost??300)+'·상한 '+(BAL.economy?.mercCap??4)+'·정찰 순회). 사거리', RANGE, '딜', DMG+'/'+CD+'s');
  return ctx.garrison;
}

// [근거]
// 확정: 용병=비-KayKit 하급 전투원, 항구 정찰+방어, 골드 싱크. (출처: 사령관 기획 2026-07-05 + "진행해" 컨펌)
// 확정: 유지비 없음(모집비 1회) — 앤 제안에 사령관 이견 없음. 수치 SSOT=BAL.economy.mercCost/mercCap.
// 확정: 기존 place() 계약 보존(barracks 효과 경로 무변경). 공격 로직=기존 수비 코드 공유.
// 제안: 모집 300골드·섬당 4명·정찰 반경 14m·보행 1.6m/s = v1 제안값(실플레이 튜닝).
// 🔍 감사 반영(2026-07-22, `_내섬_감사.md`):
//  - A4 place(island, rec): 정적 수비병이 섬 중심 고정 스폰이던 것을 **막사 건물 앞 4m**로. 중복 판정도 섬→초소(rec) 단위라
//    막사 2채 = 수비병 2명. rec 없으면 구 계약(섬 중심) 폴백 유지.
//  - B5 guardRegen: 우물(BAL.buildings.well.effect.guardRegen)이 비전투 시 수비대를 hp/s 회복. 전투 진입 시 누산기 리셋.
// 미정: 용병 피격/사망(현재 무적 — 습격병이 용병을 타겟하지 않음. 습격병 AI 타겟 확장은 후속) · 세이브 영속(재접속 시 용병 복원 — save.js 연동 후속).
