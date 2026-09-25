// capture.js — 깃발 점령(caputre point) 시스템 (Phase 3). 사령관 확정 메커닉:
//   ★배로 방어타워 무력화 → 상륙 → 깃발 근처 게이지 점령. 공/수 대칭.
//     · 플레이어가 부족 거점 근처 체류 → 게이지 → 내 영토(ctx.claimed 등록).
//     · 부족 습격병(ctx.monsters.raider)이 내 거점 근처 체류 → 게이지 → 거점 상실.
//   ★게이트: 거점 방어타워가 살아있으면 점령 불가("먼저 무력화"). towers=참조배열(.dead/.hp).
//   콘센트: ctx.scene/terrain/player/monsters/claimed/reputation 읽기·호출만. + (축6) ctx.npc.tradeVolume/nearestPort · ctx.settlement.placeFree/BUILDINGS 읽기·호출. 이 파일만 수정.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tribeById, sigilUrl, TRIBES } from '/tomob-deploy/modules/tribes.js';   // ★ROLE_AXIS 제거 — 야외 영입 로직 폐지(항구 여관 탭으로 이관). TRIBES는 tickSeasonDrift가 계속 사용.
import { toast as ukToast } from '/tomob-deploy/modules/uikit.js';

const FLAG = encodeURI('/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Pirate Kit/Models/GLB format/flag-pirate.glb');
const CAP_R    = 16;    // 깃발 점령 반경(이 안에 있으면 게이지)
const CAP_TIME = 5;     // 점령 소요(초, 1x 기여 기준)
const DECAY    = 0.6;   // 비접전 시 게이지 감쇠 배율

export function initCapture(ctx){
  const { scene } = ctx;
  const loader = new GLTFLoader();
  const outposts = []; ctx.outposts = outposts;
  const toast = (t,acc='cyan') => ukToast(t, { accent:acc, ms:2400 });
  function groundY(x,z){ return ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0; }
  // ★일부 캐릭터 GLB(예: /TinyHero.glb)는 씬 루트에 남/여 캐릭터 2개가 같은 원점에 겹쳐 들어있음(node 0=MaleCharacterPolyart · node 52=FemaleCharacterPolyart).
  //   통째로 렌더하면 남/여가 겹쳐 보임(사령관 2026-07-10 "타이니히어로 남자여자 겹쳐서있음"). → 캐릭터 루트가 2개 이상이면 하나만 남긴다.
  //   ('Female' 있으면 그것부터 제거해 Male 유지. 없으면 두 번째 이후 루트 제거.) 단일 캐릭터 GLB(Grunt/Dog 등)엔 무영향.
  function pruneDualCharacter(scene){
    const roots = scene.children.filter(c => /character|male|female|polyart/i.test(c.name||''));
    if(roots.length < 2) return;
    const females = roots.filter(c => /female/i.test(c.name||''));
    const drop = females.length ? females : roots.slice(1);   // 여성 루트 우선 제거, 없으면 첫 캐릭터만 남기고 나머지
    for(const c of drop){ if(c.parent) c.parent.remove(c); }
  }

  // ── 게이지 HUD (claim/wharf 톤) ──
  const gauge = document.createElement('div');
  gauge.style.cssText = 'position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:30;width:300px;display:none;font:12px Pretendard,system-ui,"Malgun Gothic";color:#e6eef6;text-align:center';
  gauge.innerHTML = '<div id="cap_lbl" style="margin-bottom:5px;text-shadow:0 1px 2px #000"></div>'
    + '<div style="height:14px;border-radius:8px;background:rgba(8,14,22,.8);border:1px solid rgba(255,255,255,.2);overflow:hidden">'
    + '<div id="cap_bar" style="height:100%;width:0%;transition:width .1s"></div></div>';
  document.body.appendChild(gauge);
  const capBar = gauge.querySelector('#cap_bar'), capLbl = gauge.querySelector('#cap_lbl');
  let _shown = null;
  function showGauge(o, dir, label, color){ _shown=o; capBar.style.width=Math.round(o.p*100)+'%'; capBar.style.background=color;
    capLbl.innerHTML = label; gauge.style.display='block'; }
  function hideGauge(o){ if(_shown===o||!o){ gauge.style.display='none'; _shown=null; } }

  // ── 부족 문양 빌보드 스프라이트 ──
  const _sigCache={}; const _tl=new THREE.TextureLoader();
  function sigilSprite(tribeId){ const url=sigilUrl(tribeId); if(!url) return null;   // 중립 종족=진영 문양 없음 → 배지 생략(모델이 정체성)
    if(!_sigCache[url]){ const tx=_tl.load(url); tx.colorSpace=THREE.SRGBColorSpace; _sigCache[url]=new THREE.SpriteMaterial({ map:tx, transparent:true, depthWrite:false }); }
    const sp=new THREE.Sprite(_sigCache[url]); sp.scale.set(3.4,3.4,1); sp.renderOrder=6; sp.frustumCulled=false; return sp; }

  // ── 거점 깃발(+문양) 세우기 ──
  function plantFlag(o){
    loader.load(FLAG, gl=>{
      const wl=()=>ctx.water?ctx.water.level:0;
      const doPlace=(tries)=>{
        if(o._removed) return;
        const gy = groundY(o.x, o.z);
        if(gy <= wl()+0.3 && tries<24){ setTimeout(()=>doPlace(tries+1), 150); return; }   // ★유효 지면 나올 때까지 재시도(스트림 직후 물리 미스텝→y0 물속 방지)
        const f=gl.scene.clone(true); let b=new THREE.Box3().setFromObject(f), sz=new THREE.Vector3(); b.getSize(sz);
        f.scale.setScalar(5.0/(sz.y||1)); b=new THREE.Box3().setFromObject(f); f.position.set(o.x, gy-b.min.y, o.z); f.rotation.y=0.6;
        const tint = o.tribe ? new THREE.Color(tribeById(o.tribe)?.gem || '#c0392b') : null;
        f.traverse(m=>{ if(m.isMesh){ m.castShadow=true; if(tint && m.material){ const mm=m.material.clone(); if(mm.color) mm.color.lerp(tint,0.55); m.material=mm; } } });
        scene.add(f); o.flag=f;
        if(o.tribe){ const sp=sigilSprite(o.tribe); if(sp){ sp.position.set(o.x, gy+7.5, o.z); scene.add(sp); o.sigil=sp; } }
      };
      doPlace(0);
    }, undefined, ()=>{});
  }
  function updateSigil(o){   // 소유 변경 시 문양 갱신(부족→표시 / 플레이어→제거)
    if(o.sigil){ scene.remove(o.sigil); o.sigil=null; }
    const gy=groundY(o.x,o.z);
    if(o.tribe){ const sp=sigilSprite(o.tribe); if(sp){ sp.position.set(o.x, gy+7.5, o.z); scene.add(sp); o.sigil=sp; } }
  }

  // ── 거점 등록: 부족 거점(점령 대상) 또는 플레이어 거점(방어 대상) ──
  function registerOutpost(tribeId, opts={}){
    const o = { x:opts.x, z:opts.z, r:opts.r||CAP_R, owner:tribeId||'neutral', tribe:tribeId||null,
      towers:opts.towers||[], p:0, by:null, hintT:0 };
    plantFlag(o); outposts.push(o);
    return o;
  }

  // ★E2(2026-07-15): 플레이어가 claim.js로 지은 방어타워는 섬별 ctx.claimed[i].towers에 등록된다(capture의 o.towers와 별개 배열).
  //   플레이어 거점(owner==='player')이면 같은 좌표의 claimed 섬 towers도 합산해 점령 게이트가 실제 방어타워를 인식하게 한다.
  //   (적 NPC 거점은 worldstream/buildCoastalRampart가 o.towers를 채우므로 기존 경로 그대로 — 건드리지 않음.)
  //   죽은 참조(destroyTower가 t.dead=true 표시, 또는 hp<=0)는 걸러 유령 타워 저지를 막는다.
  function towersAlive(o){
    const set = new Set(o.towers || []);
    if(o.owner === 'player' && Array.isArray(ctx.claimed)){
      let near = null, nd = 1e9;
      for(const c of ctx.claimed){ if(c.owner!=='player' || !c.towers) continue; const d = Math.hypot(c.x-o.x, c.z-o.z); if(d < nd){ nd = d; near = c; } }
      if(near && nd < 60) for(const t of near.towers) set.add(t);   // 거점~섬 근접(섬 반경~40+여유) 시에만 합산
    }
    let n = 0; for(const t of set){ if(t && !t.dead && (t.hp==null || t.hp>0)) n++; }
    return n;
  }

  // ★적대 판정(사령관 #18): 부족 lean ≠ 내 진영(PFAC) 이고 중립 아님 = 적대 섬 → 교역 대신 전투.
  const PFAC = (new URLSearchParams(location.search).get('faction')||'').trim();
  function isHostile(o){ if(!o || o.owner==='player' || !o.tribe) return false;
    const t = tribeById(o.tribe); const lean = t ? t.lean : 'neutral';
    return lean !== 'neutral' && lean !== PFAC; }

  function flipOwner(o, target, opts={}){
    o.owner = target;
    if(target === 'player'){
      o.tribe = null; updateSigil(o);
      // ★BUG-018(2026-07-13): wharf.js commitHarbor가 이미 자기 claimed 레코드를 만든 뒤 claimEmpty(o)로 이 경로를
      //   호출하는 경우(opts.silent) — 여기서 또 claimed 항목·평판·토스트를 중복 발생시키면 안 된다(이중 보상 방지).
      if(!opts.silent && ctx.claimed && !ctx.claimed.find(c => Math.hypot(c.x-o.x, c.z-o.z) < 6)){
        // ★dockPoint = 깃발(해안) 근처 바다쪽(사령관 #19) — 배가 정박·소환될 수 있게. 기존엔 깃발 중앙 육지라 배 접근 불가.
        const wl = ctx.water ? (ctx.water.level||0) : 0;
        let dx=o.x, dz=o.z;
        outer: for(let d=8; d<=48; d+=6){ for(let a=0;a<16;a++){ const ang=a/16*Math.PI*2, sx=o.x+Math.cos(ang)*d, sz=o.z+Math.sin(ang)*d;
          if(groundY(sx,sz) <= wl+0.5){ dx=sx; dz=sz; break outer; } } }
        // ★Phase C-2 항구+건물 상속(사령관 확정 2026-07-12): NPC가 지어놓은 건물(o.buildings — 축6 tickTribeGrowth 산출물)을
        //   파괴·재건설 없이 소유권만 이전. claimed 레코드가 o.buildings **같은 배열을 참조** → settlement의
        //   effectSum(교역/채집 배율)·tickGrowth(섬 성장)·freeSlot(추가 건설)이 상속 시설 위에서 즉시 이어진다.
        //   (건물 메시는 부족 진영색 그대로 유지 — 재도색은 재생성이라 상속 원칙 위배, 유지.)
        //   towers는 []: o.towers의 방벽 포대(fortify 핸들)는 점령 게이트상 전부 격파된 잔해 — 플레이어 타워 목록에 승계 안 함.
        if(!o.buildings) o.buildings = [];
        // ★hasHarbor = 상속받은 건물이 있을 때만 true(harbor.js [E] 항구 관리 게이트). 맨 깃발(건물 0개)만 점령한 상태론
        //   관리할 게 없으니 항구 UI가 뜨면 안 된다 — 사령관 실측(2026-07-13) "항구건물 없는데 깃발에서 항구관리 뜬다".
        const isl = { x:o.x, z:o.z, name:'점령 거점 '+((ctx.claimed.length||0)+1), r:40, owner:'player',
          dockPoint:{ x:dx, y:wl+1, z:dz }, towers:[], buildings:o.buildings, hasHarbor:o.buildings.length>0 };
        ctx.claimed.push(isl); o.claimedIsle = isl;
      }
      if(!opts.silent){ ctx.reputation?.applyAction?.('CLAIM_EMPTY'); toast('거점 점령 완료! — 내 영토', 'cyan'); }
      ctx.events.emit('outpostCaptured', o);   // R2: 이벤트 버스 — 🧭 퀘스트라인 Q9 완료 훅 (silent 여부와 무관하게 항상 발행)
    } else {   // 부족에게 상실
      o.tribe = target; updateSigil(o);
      if(ctx.claimed){ const i=ctx.claimed.findIndex(c => Math.hypot(c.x-o.x, c.z-o.z) < 6); if(i>=0) ctx.claimed.splice(i,1); }
      o.claimedIsle = null;   // ★상속 레코드 해제 — 건물은 o.buildings에 그대로 남아 NPC 성장(tickTribeGrowth) 재개(대칭 상속)
      const tk = tribeById(target); toast(''+(tk?tk.ko:'부족')+'에게 거점을 빼앗겼다!', 'red');
    }
  }

  // ── 점령 판정 루프 ──
  ctx.onUpdate(dt=>{
    const pp = ctx.player?.pos; if(!pp || !outposts.length) return;
    let activeShown = false;
    for(const o of outposts){
      const playerNear = Math.hypot(pp.x-o.x, pp.z-o.z) < o.r;
      // ★적대 섬 수비대(사령관 #18-B): 플레이어가 적대 거점 근처(넓게) 진입 시 1회 수비병 스폰 → 침입 저지(교역 대신 전투).
      //   ★사령관 2026-07-13 재확정(BUG-018 정책): 건물 0개(진짜 무인도)는 NPC 자체가 없어야 한다 — o.buildings 있을 때만(=tickTribeGrowth로 실제 정착이 자란 "방어섬") 수비대 스폰.
      if(isHostile(o) && o.buildings && o.buildings.length>0 && !o._defSpawned && Math.hypot(pp.x-o.x, pp.z-o.z) < o.r*3+40){
        o._defSpawned = true;
        if(ctx.raiders && ctx.raiders.spawnRaidParty){ ctx.raiders.spawnRaidParty(o.tribe, { at:{x:o.x, z:o.z}, count:3, atR:25, tag:o });   // ★atR: 넓게 분산(겹침 버그 수정 — 3명이 한 점에 겹쳐 서던 것) · ★BUG-018 tag:o = 이 수비대를 outpost 객체에 참조 연결(언로드 시 정리용)
          toast(''+(tribeById(o.tribe)?.ko||'부족')+' 수비대가 몰려온다!', 'red'); }
      }
      // 습격병(부족) 근처?
      let raiderTribe = null;
      if(ctx.monsters){ for(const m of ctx.monsters){ if(m.raider && !m.dead && Math.hypot(m.grp.position.x-o.x, m.grp.position.z-o.z) < o.r){ raiderTribe = m.tribe || o.owner; break; } } }

      // 누가 점령 시도? (플레이어=남의 거점 뺏기 / 습격병=내 거점 뺏기, 단 내가 지키면 저지)
      let target = null;
      if(playerNear && o.owner !== 'player') target = 'player';
      else if(raiderTribe && o.owner === 'player' && !playerNear) target = raiderTribe;

      const alive = towersAlive(o);
      if(target && alive === 0){
        o.p += dt / CAP_TIME;
        const toPlayer = (target === 'player');
        showGauge(o, target, toPlayer ? '거점 점령 중…' : (''+(tribeById(target)?.ko||'부족')+' 습격 — 거점 빼앗기는 중!'),
          toPlayer ? 'linear-gradient(90deg,#4ade5a,#a6f0c8)' : 'linear-gradient(90deg,#e0533a,#ff9a80)');
        activeShown = true;
        if(o.p >= 1){ flipOwner(o, target); o.p = 0; hideGauge(o); }
      } else {
        if(target && alive > 0){   // 게이트: 방어타워 먼저 무력화
          o.hintT -= dt; if(o.hintT <= 0){ o.hintT = 3.0; toast('방어타워를 먼저 무력화하라 ('+alive+'기 남음)', 'gold'); }
        }
        o.p = Math.max(0, o.p - dt / CAP_TIME * DECAY);
        if(_shown === o && o.p <= 0) hideGauge(o);
      }
    }
    if(!activeShown && _shown) hideGauge(_shown);
  });

  // 내 섬(wharf 건설/점령) 방어 거점 보장 — 습격(raid.js) 표적. 이미 있으면 재사용, 없으면 데이터만 등록(깃발은 이미 있음).
  function ensureOutpost(x, z, owner='player'){
    let o = outposts.find(o => Math.hypot(o.x-x, o.z-z) < 30);
    if(!o){ o = { x, z, r:CAP_R, owner, tribe:(owner==='player'?null:owner), towers:[], p:0, by:null, hintT:0 }; outposts.push(o); }
    else o.owner = owner;
    return o;
  }

  // ── 🌱 종족섬 자동성장(축6, 향후방향_v2 §5·§6) ── AI 판단 없는 정적 배경. 항구 누적 거래량이 임계값 넘으면
  //   settlement 카탈로그에서 건물 1채를 무료·무소유(placeFree)로 자동 배치. 소유권 변경·습격·알림 없음(경량 배경).
  //   상한은 settlement slotN()=8 이 자연히 캡(꽉 차면 placeFree 조용히 no-op). 점령 루프와 관심사 분리 → 별도 onUpdate.
  //   ★Phase C-3(사령관 확정 2026-07-12): 여기 쌓인 o.buildings가 점령 시 flipOwner의 **상속 대상** —
  //   NPC 섬이 오래 성장할수록 점령 시 더 값진 시설(교역/채집 배율·성장 Lv·패시브 수입)을 그대로 얻는다.
  const GROWTH_THRESHOLD = 500;   // 항구 누적 거래량 임계값. 도달 시 건물 1채 + 임계값만큼 차감(리셋 아님 → 넘친 만큼 이월).
  let _tgAcc = 0;
  async function tickTribeGrowth(dt){
    _tgAcc += (dt || 0); if(_tgAcc < 60) return; _tgAcc -= 60;   // 60s 주기(tickIncome/tickGrowth 패턴)
    const npc = ctx.npc, st = ctx.settlement;
    if(!npc || !npc.tradeVolume || !npc.nearestPort || !st || !st.placeFree || !st.BUILDINGS) return;
    const ids = Object.keys(st.BUILDINGS).filter(id => !st.BUILDINGS[id].hidden);   // 숨김(harbor) 제외
    if(!ids.length) return;
    for(const o of outposts){
      if(o.owner === 'player' || !o.tribe) continue;   // 종족(NPC) 소유 거점만
      if(!o.buildings) o.buildings = [];               // placeBuilding 이 push 하므로 lazy 초기화
      const portId = npc.nearestPort(o.x, o.z);
      if(!portId) continue;
      if((npc.tradeVolume[portId] || 0) >= GROWTH_THRESHOLD){
        npc.tradeVolume[portId] -= GROWTH_THRESHOLD;   // 차감(이월) — 여러 번 연속 트리거 가능
        const id = ids[(Math.random() * ids.length) | 0];   // 결정론 아닌 랜덤 선택(배경 다양성)
        await st.placeFree(o, id);
      }
    }
  }
  ctx.onUpdate(dt => { tickTribeGrowth(dt); });

  // ── ⚔️ 경량 시즌 드리프트(축7, 향후방향_v2 §5·§6) ── AI 판단 없는 사전정의 이벤트 + 확률 굴림.
  //   5분마다 15% 확률로 배경 종족 거점 하나의 소유 종족을 다른 종족으로 교체(순수 연출).
  //   플레이어 소유 섬·건물(o.buildings)·owner·towers·게이지(o.p)는 절대 안 건드림 — 오직 o.tribe 라벨 + 문양만 교체.
  //   성장(tickTribeGrowth)과 관심사 분리 → 별도 onUpdate·별도 dt 누적기.
  const DRIFT_PERIOD = 300;    // 체크 주기(초, 5분)
  const DRIFT_CHANCE = 0.15;   // 체크 시 발동 확률
  let _sdAcc = 0;
  function tickSeasonDrift(dt){
    _sdAcc += (dt || 0); if(_sdAcc < DRIFT_PERIOD) return; _sdAcc -= DRIFT_PERIOD;
    if(Math.random() >= DRIFT_CHANCE) return;   // 발동 안 함
    const cands = outposts.filter(o => o.owner !== 'player' && o.tribe);   // 배경 종족 거점만
    if(!cands.length) return;
    const o = cands[(Math.random() * cands.length) | 0];
    const from = tribeById(o.tribe);
    const pool = TRIBES.filter(t => t.id !== o.tribe);   // 현재와 다른 종족
    if(!pool.length) return;
    const to = pool[(Math.random() * pool.length) | 0];
    o.tribe = to.id;   // 라벨만 교체 — owner/buildings/towers/p 불변
    updateSigil(o);
    toast(((from&&from.ko)||'부족')+'이(가) '+(to.ko||'부족')+'에게 거점을 빼앗겼다', 'red');
  }
  ctx.onUpdate(dt => { tickSeasonDrift(dt); });

  // ── 부족 섬 주민 NPC(시각 연출 전용) ──
  //   ★Phase C-1 Bug D 제거(사령관 확정 2026-07-12, 증거 ref/잔재.png "점령 중인데 교역창 열림"):
  //   미점령 중립 거점 근처 [E] 직거래 프롬프트·교역창(trade.openWith) 경로 전면 제거 — **점령 완료 전에는 교역·관리 불가**.
  //   모든 교역은 점령 후 항구(harbor.js, ctx.claimed owner='player')로 일원화. NPC 모델 스폰은 섬 생활감 연출로만 유지.
  const NPC_R = 70;   // NPC 모델 스폰 반경
  let activeTrader = null, _loadingOutpost = null;   // activeTrader={outpost,group,mixer} · _loadingOutpost=비동기 로드 중 거점(재진입 가드)
  function despawnTrader(){ if(activeTrader){ scene.remove(activeTrader.group); activeTrader=null; } _loadingOutpost=null; }
  function spawnTrader(o){
    despawnTrader(); const pe = tribeById(o.tribe); if(!pe || !pe.model) return;
    _loadingOutpost = o;   // ★로딩 시작 표시 — 로드 완료까지 판정루프의 재호출 차단(같은 자리 중첩 스폰 버그)
    loader.load(pe.model, g=>{
      _loadingOutpost = null;   // 로딩 종료
      if(o.owner==='player'){ return; }   // 사이에 점령됨
      const m=g.scene;
      pruneDualCharacter(m);   // ★TinyHero.glb 등 씬 루트에 남/여 2캐릭터가 겹쳐 든 팩 → 하나만 남김(사령관 2026-07-10)
      let box=new THREE.Box3().setFromObject(m), sz=new THREE.Vector3(); box.getSize(sz);
      const s=1.8/(sz.y||1); m.scale.setScalar(s); const foot=box.min.y*s;
      m.traverse(n=>{ if(n.isMesh) n.castShadow=true; });
      // ★섬 NPC 물 잠김 방지(사령관 2026-07-10): 배치점(깃발 옆)에서 지면을 재고, 물이면 검증된 거점 육지점으로 폴백.
      //   기존엔 o.x에서 지면을 재고 o.x+2.6에 세워 오프셋이 물에 걸리면 잠기던 것 + 물 가드 자체가 없었음.
      const wl = ctx.water ? ctx.water.level : 0;
      let px=o.x+2.6, pz=o.z+2.6, gy=groundY(px,pz);
      if(gy <= wl+0.3){ px=o.x; pz=o.z; gy=groundY(px,pz); }   // 오프셋 지점이 물 → 거점(육지 검증된 지점) 자체로
      if(gy <= wl+0.3) gy = wl+0.3;                            // 그래도 물이면 최소 수면 위(스트림 미완성 프레임 방어)
      const grp=new THREE.Group(); grp.add(m); grp.position.set(px, gy-foot, pz);   // 깃발 옆(육지)
      let mixer=null;
      if(g.animations && g.animations.length){ mixer=new THREE.AnimationMixer(m);
        const idleName=(pe.roles&&pe.roles.idle)||null;
        const clip = (idleName && g.animations.find(a=>a.name===idleName)) || g.animations.find(a=>/idle/i.test(a.name)) || g.animations[0];
        if(clip) mixer.clipAction(clip).play(); }
      if(activeTrader){ scene.remove(activeTrader.group); }   // ★방어: 남은 이전 상인 먼저 제거(고아 방지)
      scene.add(grp); activeTrader={ outpost:o, group:grp, mixer };
    }, undefined, ()=>{ _loadingOutpost=null; });   // 로드 실패 시에도 플래그 해제
  }
  ctx.onUpdate(dt=>{
    const pp=ctx.player?.pos; if(!pp) return;
    // NPC 모델 = 가장 가까운 부족(★비적대) 거점(스폰 반경 내) — 적대 섬엔 상인 대신 수비대.
    //   ★C-1: 교역 프롬프트·[E] 직거래는 제거됨(점령 전 교역 불가) — 이 NPC는 순수 시각 연출.
    //   ★BUG-018 정책(2026-07-13): 건물 0개(무인도)엔 상인도 없어야 한다 — buildings 자란 거점만 대상.
    let sp=null, sd=NPC_R;
    for(const o of outposts){ if(o.owner==='player'||!o.tribe||isHostile(o)||!o.buildings||!o.buildings.length) continue; const d=Math.hypot(o.x-pp.x,o.z-pp.z); if(d<sd){ sd=d; sp=o; } }
    const _curTrader = (activeTrader&&activeTrader.outpost) || _loadingOutpost;   // ★로딩 중 거점도 "현재"로 인지(중복 스폰 차단)
    if(sp !== _curTrader){ if(sp) spawnTrader(sp); else despawnTrader(); }
    if(activeTrader){ if(activeTrader.mixer) activeTrader.mixer.update(dt);
      const g=activeTrader.group; const dx=pp.x-g.position.x, dz=pp.z-g.position.z; if(dx*dx+dz*dz>0.04) g.rotation.y=Math.atan2(dx,dz); }   // 손님 향함
  });

  // ── 🤝 추종자 영입(축4) 재설계(사령관 2026-07-09): 야외 종족거점 근처 [E] 영입 → 항구 "여관" 탭(harbor.js)으로 완전 이관.
  //   이전 recruitPrompt DOM · KeyE 영입 리스너 · near 판정 로직 전부 제거됨. 영입은 이제 harbor.renderInn()가 담당.
  //   (축6 tickTribeGrowth · 축7 tickSeasonDrift는 영입과 무관 — 그대로 유지.)

  // 거점 제거(섬 스트림 언로드 시 깃발·문양 정리) — 메모리 회수.
  function removeOutpost(o){ const i=outposts.indexOf(o); if(i<0) return;
    o._removed=true;   // 재시도 중이던 깃발 배치 취소(고아 방지)
    outposts.splice(i,1);
    if(o.flag) scene.remove(o.flag);
    if(o.sigil) scene.remove(o.sigil);
    // ★C-3 정합: 성장 건물(tickTribeGrowth 산출) 메시도 정리 — 스트림 언로드 후 재등록된 새 거점이
    //   같은 슬롯에 다시 지어 고아 메시와 겹치던 것 방지. (owner='player' 상속분은 worldstream이
    //   removeOutpost를 호출하지 않으므로(unloadIsland의 owner!=='player' 가드) 상속 시설은 안전.)
    if(o.buildings){ for(const b of o.buildings){ if(b && b.mesh) scene.remove(b.mesh); } o.buildings.length=0; }
    // ★BUG-018 정합(사령관 재현: 적대 무인도 재방문 시 수비대 겹쳐 스폰): 이 거점(o)이 스폰한 수비대(raider)를 함께 정리.
    //   outpost↔raider 참조는 spawnRaidParty(...,{tag:o})로 심어둔 m._outpostTag===o 로 매칭. 언로드 후 재등록되는
    //   새 outpost 객체는 _defSpawned=false라 또 3명을 스폰하는데, 이전 방문분이 씬에 살아남아 같은 자리에 겹치던 것을 차단.
    //   제거는 표준 사망 처리 mn.kill() 재사용 → 애니믹서/씬 정리·배열 splice는 monsters.js 업데이트 루프가 마무리(XP·영혼 미지급 = damageMonster 통로 밖).
    if(ctx.monsters){ for(const m of ctx.monsters){ if(m && !m.dead && m._outpostTag===o && m.kill) m.kill(); } }
    if(activeTrader && activeTrader.outpost===o) despawnTrader();
  }

  ctx.capture = { registerOutpost, ensureOutpost, removeOutpost, outposts, CAP_R, CAP_TIME,
    // ★BUG-018 정책(2026-07-13, 사령관): 건물 0개(무인도) 거점은 게이지 점령 없이 G키 항구건설(wharf.js)이 곧 거점화.
    //   wharf.js commitHarbor가 성공 직후 건물 0개인 근처 foe outpost를 발견하면 이 함수로 소유권만 넘긴다(flipOwner 재사용).
    claimEmpty(o){ if(o && o.owner!=='player') flipOwner(o, 'player', { silent:true }); },
    // 디버그(검증): 플레이어 앞 육지에 부족 거점 세우기. towers=[{hp}] 주면 점령 게이트 테스트.
    _debugOutpost(tribeId, opts={}){ const pp=ctx.player?.pos||{x:0,z:0};
      const x=(opts.x!=null?opts.x:pp.x+(opts.off||6)), z=(opts.z!=null?opts.z:pp.z);
      return registerOutpost(tribeId||'yahalom', { x, z, towers:opts.towers||[] }); } };
  console.log('[capture] 깃발 점령 시스템 등록 — 반경', CAP_R, '· 점령', CAP_TIME+'s · 타워게이트 ON. 공/수 대칭.');
  return ctx.capture;
}
