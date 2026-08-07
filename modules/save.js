// save.js — 게임 상태 로컬 세이브(스냅샷/복원). 사령관: "세이브 넣어야지 — 결국 멀티 될 거고, 자꾸 처음부터 하기 싫어서."
//   ★멀티 대비: 스냅샷은 THREE/함수 없는 순수 JSON(플레이어별). 지금은 localStorage, 나중에 그대로 서버 동기화로 이식.
//   저장: 플레이어(위치·시점·도구)·전투(레벨·경험치·HP·영혼)·인벤/평판(기존 serialize 재활용)·영토(claimed)·함대(배 키·위치·내구도)·퀘스트 단계.
//   제외(결정론 재생성): 스트림 3D 섬(canon+위치)·몬스터·튜토 완료(각 모듈 자체 localStorage).
//   흐름: 자동저장(주기 20s + 마일스톤 훅 + unload) → localStorage. select "이어하기" → game.html?load=1 → initSave가 restore(오프닝/정착 스킵).
//   콘센트: 각 모듈 공개 API(getter/serialize)만 읽고, 복원은 노출된 setter/hook만 호출. 이 파일 + 소량 훅(combat.applySave·shipyard.rebuild).

const KEY = 'voyageSave_v1';
const AUTOSAVE_MS = 10000;   // ★2026-07-13(사령관): 20s→10s — 이어하기 위치 오차·손실 최소화

export function initSave(ctx){
  const qp = new URLSearchParams(location.search);
  // ★자동저장 활성 여부: 오프닝(?opening=1) 진입은 깨어날 때(markLive)까지 보류 — 오프닝 컷신 중 먼바다 위치가 저장돼 이어하기 시 바다에서 시작되던 것 원천 차단.
  //   비오프닝(이어하기/직접 진입)은 즉시 활성. 깨어난 뒤부터는 언제 꺼져도 그 지점에서 재개.
  let _live = qp.get('opening')!=='1';
  let _wiping = false;   // 시즌 리셋 초기화 중 — write/서버동기 전면 차단(beforeunload 자동저장이 세이브를 되살리는 것 방지)

  // ── 스냅샷: 현재 게임 상태 → 순수 JSON ──
  function snapshot(){
    const s = { v:1, t:Date.now() };
    // 진입 메타(이어하기 URL 재구성용)
    s.meta = {
      session: decodeURIComponent(qp.get('s')||'') || (ctx.terrain && ctx.terrain.data && ctx.terrain.data.name) || '',
      homeIslandId: decodeURIComponent(qp.get('home')||'') || ctx.homeIslandId || '',   // ★캐릭터-스폰섬 바인딩(2026-07-10, 카브 특수취급 폐지)
      char: qp.get('char')||'', name: qp.get('name')||'', follower: qp.get('follower')||'',
      followerName: qp.get('followerName')||'', faction: qp.get('faction')||'',
    };
    // 플레이어
    try { const p=ctx.player; if(p){ const pos=p.pos; s.player={ x:+pos.x.toFixed(2), y:+pos.y.toFixed(2), z:+pos.z.toFixed(2),
      yaw:+(p.yaw||0).toFixed(3), tool:p.currentTool||'none',
      onShip: !!(ctx.player.onShipRef || (ctx.ship && ctx.ship.boarded)) }; } } catch(_){}   // ⚓ 배 위(항해 중) 저장 여부 — 복원 시 바다 그 자리서 재개(시작섬 폴백 방지)
    try { s.lastHarbor=ctx.lastHarbor?JSON.parse(JSON.stringify(ctx.lastHarbor)):null; } catch(_){}
    // 전투(레벨/경험치/HP/영혼)
    try { const c=ctx.combat; if(c){ s.combat={ level:c.level, xp:c.xp, hp:c.hp, soul:c.soul }; } } catch(_){}
    // 인벤/평판 — 기존 serialize 재활용(멀티 대비로 만들어둔 것)
    try { if(ctx.inventory && ctx.inventory.serialize) s.inventory = ctx.inventory.serialize(); } catch(_){}
    try { if(ctx.reputation && ctx.reputation.serialize) s.reputation = ctx.reputation.serialize(); } catch(_){}
    try { if(ctx.contract?.serialize)s.contract=ctx.contract.serialize(); } catch(_){}
    try { s.faction = (ctx.faction && ctx.faction.serialize) ? ctx.faction.serialize() : null; } catch(_){}   // ⚑ 축5 세력 선언(declared/name/type)
    // 영토(claimed) — THREE 참조(towers 등) 제거하고 데이터만
    try { s.claimed = (ctx.claimed||[]).filter(c=>c&&c.owner==='player').map(c=>({
      x:c.x, z:c.z, name:c.name||'점령 거점', r:c.r||40, owner:'player',
      byFlag: !!c.byFlag, isleId: c.isleId || null,   // 🚩 깃발 거점(outpost.js) 표식 — 복원 시 깃발·경계 시각물 재생성 + 섬당 1개 판정
      // 🏛️ 거점 건물 — 메시는 복원 시 재생성하되 **배치 좌표·회전은 반드시 왕복**시킨다.
      //   ★버그수정(감사 A1, 2026-07-22): 예전엔 {id,slot}만 저장해 restore가 항상 slotPos(항구 중심 원형 링)로 떨어졌고,
      //     사령관이 마우스로 배치한 마을이 리로드 한 번에 전부 링으로 되돌아갔다(2026-07-15 마우스 배치 지시 무효화).
      //   구세이브(x 없음)는 settlement.restore가 슬롯 폴백으로 그대로 처리 — 하위호환 유지.
      buildings: (c.buildings||[]).map(b=>({ id:b.id, slot:b.slot,
        x: b.x!=null ? +b.x.toFixed(2) : null, y: b.y!=null ? +b.y.toFixed(2) : null,
        z: b.z!=null ? +b.z.toFixed(2) : null, rotY: b.rotY!=null ? +b.rotY.toFixed(3) : 0 })),
      growth: c.growth ? { ...c.growth } : null,   // 🌱 섬 성장(인구·안정도·번영도·영향력·Lv) 왕복 — settlement.js 성장 엔진
      wharf: c.wharf ? { x:c.wharf.x, z:c.wharf.z, roty:c.wharf.roty||0 } : null,   // ⚓ 부두 변환(복원 시 wharf.rebuild로 재건) — 항구 사라짐 방지
      dockPoint: c.dockPoint ? { x:c.dockPoint.x, y:c.dockPoint.y, z:c.dockPoint.z } : null })); } catch(_){}
    // 🚩 거점 확장 슬롯 수(거점 레코드 자체는 위 claimed가 왕복 — 여기선 레벨업으로 늘린 설치 한도만)
    try { if(ctx.outpost && ctx.outpost.snapshot) s.outpost = ctx.outpost.snapshot(); } catch(_){}
    // 🗡️ 몬스터 용병 명부(누구를 영입했나). 배치된 개체의 3D는 아래 mercs(garrison)가 따로 왕복한다.
    try { if(ctx.mercenary && ctx.mercenary.snapshot) s.mercenary = ctx.mercenary.snapshot(); } catch(_){}
    // 🛡 용병(정찰 수비대) — 위치·이름·소속 섬만(3D는 복원 시 재스폰)
    try { if(ctx.garrison && ctx.garrison.serialize) s.mercs = ctx.garrison.serialize(); } catch(_){}
    // 퀵슬롯(핫바) — 제작한 도구(도끼·곡괭이)·건축부품 배치 보존. ★도구가 여기 있어 저장 안 하면 이어하기 시 사라짐(사령관).
    try { s.quickslots = (ctx.quickslots||[]).map(q => q ? { type:q.type, id:q.id } : null); } catch(_){}
    // 함대(배) — 키·위치·내구도만(3D는 복원 시 재건)
    try { s.fleet = (ctx.fleet||[]).map(f=>({ name:f.name, key:f.key,
      x:(f.bs && f.bs.x!=null) ? +f.bs.x.toFixed(2) : f.x,   // ★실시간 위치(f.x=건조위치라 항해 후 stale → 바다 종료 시 시작섬 튕김 원인). f.bs가 live.
      z:(f.bs && f.bs.z!=null) ? +f.bs.z.toFixed(2) : f.z,
      yaw:(f.bs && f.bs.yaw!=null) ? +f.bs.yaw.toFixed(3) : 0,   // ⚓ 선수각 보존(복원 시 같은 방향)
      anchored: !!(f.bs && f.bs.anchored),
      dur: (f.bs && f.bs.durability!=null) ? +f.bs.durability.toFixed(1) : null })); } catch(_){}
    try { s.activeShipKey = ctx.ship ? (ctx.fleet||[]).find(f=>f.bs===ctx.ship)?.key || null : null; } catch(_){}
    // ★D1(2026-07-15): 배 업그레이드 레벨(속도/대포/돛) — 세션 상태 ctx.shipUpgrades 왕복. 없으면 null(구 세이브 호환).
    try { s.shipUpgrades = ctx.shipUpgrades ? { speed:ctx.shipUpgrades.speed||0, cannon:ctx.shipUpgrades.cannon||0, sail:ctx.shipUpgrades.sail||0 } : null; } catch(_){}
    // 퀘스트 진행 단계
    try { s.quest = window.__questStep || null; } catch(_){}
    // 시간대(있으면)
    try { if(ctx.time && ctx.time.get) s.time = ctx.time.get(); else if(typeof ctx.dayT==='number') s.time = ctx.dayT; } catch(_){}
    return s;
  }

  // ── 멀티 슬롯 로스터(캐릭터 여러 개) — voyageRoster_v1 = [{cid, ...snapshot}]. 기존 단일 세이브는 1회 마이그레이션. ──
  const ROSTER_KEY = 'voyageRoster_v1';
  function activeCid(){ return (qp.get('cid')||'').trim() || null; }   // ?cid= 로 현재 캐릭터 지정(charselect가 넘김)
  function makeCid(s){ const nm=(s&&s.meta&&s.meta.name)||'char'; return nm+'_'+Date.now().toString(36)+Math.floor(Math.random()*1e5).toString(36); }

  // ── 서버 계정 동기화(Phase 2, 2026-07-23) — 로스터를 data/roster/<acct>.json 에 미러링. ──
  //   acct 는 추후 intro 로그인이 localStorage.voyageAcct 를 세팅한다. 그 전엔 디바이스 자동 ID.
  //   서버는 whole-array LWW(replace)라 삭제도 정상 전파. ⚠️한계: 같은 계정 다중기기 동시편집 시 배열 통째 덮어씀(테스트서버 수용, intro 로그인 때 재검토).
  const ACCT_KEY = 'voyageAcct';
  function acctKey(){ let a=null; try{ a=localStorage.getItem(ACCT_KEY); }catch(_){}
    if(!a){ a='dev_'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36); try{ localStorage.setItem(ACCT_KEY,a); }catch(_){} } return a; }
  const _hasServer = (location.protocol==='http:'||location.protocol==='https:');
  function pushRosterToServer(list){   // write-through(fire-and-forget)
    if(_wiping || !_hasServer) return;
    let season=null; try{ const v=localStorage.getItem('voyageSeason'); season = v==null?null:+v; }catch(_){}
    try{ fetch('/api/roster',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({acct:acctKey(), roster:list, season})}).catch(()=>{}); }catch(_){}   // season = 구시즌 저장을 서버가 거부(리셋 레이스 차단)
  }
  function syncRosterFromServer(){   // init 1회: 서버 로스터 fetch → 로컬과 cid별 병합(최신 t 우선) → 합집합 서버로 재반영
    if(_wiping || !_hasServer) return;
    try{ fetch('/api/roster?acct='+encodeURIComponent(acctKey()), {cache:'no-store'})
      .then(r=> r.ok ? r.json() : null)
      .then(srv=>{
        if(!Array.isArray(srv)) return;
        const local=readRoster(); const byCid=new Map(local.map(c=>[c.cid,c])); let changed=false;
        for(const s of srv){ if(!s||!s.cid) continue; const cur=byCid.get(s.cid);
          if(!cur || (s.t||0) > (cur.t||0)){ byCid.set(s.cid,s); changed=true; } }
        const merged=[...byCid.values()];
        if(changed){ try{ localStorage.setItem(ROSTER_KEY, JSON.stringify(merged)); }catch(_){}
          try{ window.dispatchEvent(new CustomEvent('save:rostersync',{detail:{count:merged.length}})); }catch(_){}
          console.log('[save] 서버 로스터 병합 →', merged.length,'개'); }
        if(merged.length && (changed || merged.length!==srv.length)) pushRosterToServer(merged);   // 로컬-only 캐릭터를 서버에 시드
      }).catch(()=>{});
    }catch(_){}
  }
  function readRoster(){
    let list=[]; try{ const raw=localStorage.getItem(ROSTER_KEY); list=raw?JSON.parse(raw):[]; }catch(_){ list=[]; }
    if(!Array.isArray(list)) list=[];
    if(!list.length){   // ★마이그레이션: 레거시 단일 세이브(voyageSave_v1) → 로스터 1캐릭터로 편입(진행도 보존)
      try{ const old=localStorage.getItem(KEY); if(old){ const s=JSON.parse(old); if(s){ if(!s.cid) s.cid=makeCid(s); list=[s]; localStorage.setItem(ROSTER_KEY, JSON.stringify(list)); console.log('[save] 레거시 세이브 → 로스터 마이그레이션'); } } }catch(_){}
    }
    return list;
  }
  function writeRoster(list){ try{const raw=JSON.stringify(list);localStorage.setItem(ROSTER_KEY,raw);
      if(localStorage.getItem(ROSTER_KEY)!==raw)throw new Error('roster verification failed');pushRosterToServer(list);return true;
    }catch(e){console.warn('[save] 로스터 저장 실패',e&&e.message);return false;} }

  function persistSnapshot(s){
    const list=readRoster(); let cid=activeCid();
    if(!cid){ const found=list.find(c=>c.meta&&c.meta.name===s.meta.name&&c.meta.char===s.meta.char); cid=found?found.cid:makeCid(s); }
    s.cid=cid; const i=list.findIndex(c=>c.cid===cid); if(i>=0)list[i]=s; else list.push(s);
    let oldRoster=null,oldKey=null,hadRoster=false,hadKey=false;
    const rollback=(key,had,raw)=>{try{if(had)localStorage.setItem(key,raw);else localStorage.removeItem(key);}catch(_){}};
    try{
      oldRoster=localStorage.getItem(ROSTER_KEY);hadRoster=oldRoster!==null;oldKey=localStorage.getItem(KEY);hadKey=oldKey!==null;
      const rosterRaw=JSON.stringify(list),keyRaw=JSON.stringify(s);
      localStorage.setItem(ROSTER_KEY,rosterRaw);if(localStorage.getItem(ROSTER_KEY)!==rosterRaw)throw new Error('roster verification failed');
      localStorage.setItem(KEY,keyRaw);if(localStorage.getItem(KEY)!==keyRaw)throw new Error('save verification failed');
      pushRosterToServer(list);return s;
    }catch(e){rollback(ROSTER_KEY,hadRoster,oldRoster);rollback(KEY,hadKey,oldKey);
      console.warn('[save] 원자 저장 실패',e&&e.message);return null;}
  }

  function write(){ try {
    if(_wiping) return null;   // 시즌 리셋 중 저장 금지
    if(ctx.dungeon && ctx.dungeon.active) return null;   // ★D4(2026-07-15 던전 신규): 던전(지하 아레나) 좌표가 저장되면 이어하기 시 허공 스폰 → 던전 중엔 저장 보류(퇴장 후 다음 주기부터 정상)
    if(ctx.combat?.isDead?.()) return null;   // 던전 사망 정리 직후(active=false)에도 부활 전 지하 좌표 저장 금지
    return persistSnapshot(snapshot());
  } catch(e){ console.warn('[save] 저장 실패', e&&e.message); return null; } }
  function read(cid){ cid=cid||activeCid(); const list=readRoster();
    if(cid){ const c=list.find(x=>x.cid===cid); if(c) return c; }
    if(list.length) return list.slice().sort((a,b)=>(b.t||0)-(a.t||0))[0];   // cid 없으면 가장 최근(레거시 이어하기)
    try{ const old=localStorage.getItem(KEY); return old?JSON.parse(old):null; }catch(_){ return null; }
  }
  function has(){ return readRoster().length>0 || !!localStorage.getItem(KEY); }
  // 로스터 요약(charselect 리스트용) — cid·이름·클래스·진영·레벨·골드·저장시각
  function listChars(){ return readRoster().map(c=>({ cid:c.cid, name:(c.meta&&c.meta.name)||'', char:(c.meta&&c.meta.char)||'',
    faction:(c.meta&&c.meta.faction)||'', session:(c.meta&&c.meta.session)||'', homeIslandId:(c.meta&&c.meta.homeIslandId)||'',
    level:(c.combat&&c.combat.level)||1, gold:(c.inventory&&c.inventory.gold)||0, t:c.t||0 }))
    .sort((a,b)=>(b.t||0)-(a.t||0)); }
  function deleteChar(cid){ let list=readRoster().filter(c=>c.cid!==cid); writeRoster(list);
    if(!list.length){ try{ localStorage.removeItem(KEY); }catch(_){} } console.log('[save] 캐릭터 삭제', cid); return true; }
  function clear(){ try { localStorage.removeItem(KEY); localStorage.removeItem(ROSTER_KEY); } catch(_){} }   // 전체 초기화

  // ★2026-07-13(사령관 "나가기→이어하기 시 섬 바닥에 깔림") — 근본원인: worldstream 스트리밍 섬은 지형 메시가
  //   비동기 로드(loadIsland)되고, 충돌 등록(collide)은 그 뒤 worldstream 자체 tick(0.4s 주기)에서 별도로 붙는다.
  //   restore()가 그 전에 groundAt(px,pz)을 재면 아직 아무 지형도 없어(seabed 높이 폴백) 낮은 y로 스폰 →
  //   직후 실제 지형이 스트림돼 들어오면 플레이어가 그 지형 속에 파묻힌 것처럼 보인다.
  //   → 저장 위치가 홈에서 먼(=스트림 섬일 가능성) 곳이면, 그 섬을 명시적으로 로드하고 충돌 등록될 때까지 잠깐 대기한 뒤 스폰 계산.
  async function _ensureIslandLoaded(px, pz){
    const ws = ctx.worldstream; if(!ws || !ws.islands || !ws.loadIsland) return;
    const WS = ws.WORLD_SCALE || 1.5, cx = px/WS, cz = pz/WS;
    let best=null, bd=Infinity;
    for(const isle of ws.islands){ const d=Math.hypot(isle.x-cx, isle.z-cz); if(d<bd){ bd=d; best=isle; } }
    if(!best || bd > (best.r||300)+250) return;   // 근처에 canon 섬 없음(홈 지형/오프닝 좌표 등) — 기존 terrain.js 경로 그대로
    if(!(ws.loaded && ws.loaded.has(best.id))){ try{ await ws.loadIsland(best); }catch(e){ console.warn('[save] 스폰섬 프리로드 실패', e&&e.message); } }
    const wl = ctx.water ? ctx.water.level : 0;
    for(let i=0; i<15; i++){   // 충돌 등록(worldstream tick) 대기 — 최대 ~1.8s, 지면 확인되면 즉시 종료
      if(ctx.terrain && ctx.terrain.groundAt(px,pz,5000) > wl+0.6) return;
      await new Promise(r=>setTimeout(r,120));
    }
  }

  // ── 복원: 스냅샷 → 현재(초기화 완료된) 게임에 적용. game.html이 ?load=1 시 호출. ──
  async function restore(snap){
    snap = snap || read(); if(!snap){ console.warn('[save] 복원할 세이브 없음'); return false; }
    // 전투(레벨/HP/영혼) — maxHp가 레벨 파생이라 combat.applySave가 재계산
    try { if(ctx.combat && ctx.combat.applySave) ctx.combat.applySave(snap.combat); } catch(e){ console.warn('[save] combat 복원', e&&e.message); }
    try { if(snap.lastHarbor)ctx.lastHarbor={...snap.lastHarbor}; } catch(_){}
    // 인벤/평판
    try { if(snap.inventory && ctx.inventory && ctx.inventory.load) ctx.inventory.load(snap.inventory); } catch(e){ console.warn('[save] inventory 복원', e&&e.message); }
    try { if(snap.reputation && ctx.reputation && ctx.reputation.restore) ctx.reputation.restore(snap.reputation); } catch(e){ console.warn('[save] reputation 복원', e&&e.message); }
    try { if(snap.contract&&ctx.contract?.restore)ctx.contract.restore(snap.contract); } catch(e){ console.warn('[save] contract 복원',e&&e.message); }
    try { if(snap.faction && ctx.faction && ctx.faction.restore) ctx.faction.restore(snap.faction); } catch(e){ console.warn('[save] faction 복원', e&&e.message); }   // ⚑ 축5 세력 선언 복원
    // 영토(claimed) — raid.js가 owner==='player'를 습격 표적으로 사용
    try { if(snap.claimed && ctx.claimed){ for(const c of snap.claimed){ if(!ctx.claimed.some(e=>Math.hypot(e.x-c.x,e.z-c.z)<6)){
      // ⚓ 부두 변환 — 신 세이브의 c.wharf만 재건. ★SIM-H4(D3) 수정: dockPoint(물속 정박좌표)로 wharf를 합성하던
      //   폴백 제거 — 깃발 점령 섬(항구 없던 거점)이 로드마다 바다 한복판에 유령 항구로 재건되던 것. 구 세이브는 데이터 거점으로 복원.
      const wharfT = c.wharf || null;
      // ★hasHarbor(2026-07-13 신규 게이트) — 구 세이브엔 없는 필드라 실제 항구 존재 여부(wharf 또는 상속건물)로 재계산.
      //   안 하면 이어하기 시 기존에 지어놓은 항구까지 [E] 관리가 영영 안 열림(harbor.js 게이트 회귀).
      const hasHarbor = !!wharfT || !!(c.buildings && c.buildings.length);
      const isl={ x:c.x, z:c.z, name:c.name, r:c.r, owner:'player', dockPoint:c.dockPoint, wharf:wharfT, towers:[], buildings:[], hasHarbor, growth: c.growth || null,
                  byFlag: !!c.byFlag, isleId: c.isleId || null };   // 🌱 섬 성장 상태 복원(구 세이브는 null → 성장 엔진이 lazy 초기화) · 🚩 깃발 거점 표식
      ctx.claimed.push(isl);
      if(c.buildings && c.buildings.length && ctx.settlement?.restore) ctx.settlement.restore(isl, c.buildings);   // 🏛️ 거점 건물 메시 재생성
      if(wharfT && ctx.wharfBuild && ctx.wharfBuild.rebuild) try{
        await _ensureIslandLoaded(isl.x, isl.z);   // ★항구도 플레이어 스폰과 같은 회귀(스트림 섬 지형 비동기 로드 전 groundAt=seabed 폴백) — 재건 전 지형·충돌 등록 대기
        await ctx.wharfBuild.rebuild(isl);
      }catch(e){ console.warn('[save] 부두 재건', e&&e.message); }   // ⚓ 부두 메시+깃발 재건(항구 사라짐 방지)
    } } } } catch(e){ console.warn('[save] claimed 복원', e&&e.message); }
    // 🚩 거점 깃발 — claimed 복원 뒤(깃발 시각물이 claimed 엔트리에 붙는다) + 확장 슬롯 수 복원
    try { if(ctx.outpost && ctx.outpost.restore) ctx.outpost.restore(snap.outpost); } catch(e){ console.warn('[save] outpost 복원', e&&e.message); }
    // 🗡️ 용병 명부 복원(배치 개체 3D는 아래 garrison.restore가 별도 재스폰)
    try { if(ctx.mercenary && ctx.mercenary.restore) ctx.mercenary.restore(snap.mercenary); } catch(e){ console.warn('[save] mercenary 복원', e&&e.message); }
    // 🛡 용병 복원(claimed 뒤 — 섬 매칭 필요)
    try { if(snap.mercs && snap.mercs.length && ctx.garrison && ctx.garrison.restore) ctx.garrison.restore(snap.mercs); } catch(e){ console.warn('[save] 용병 복원', e&&e.message); }
    // 퀵슬롯(핫바) 복원 — 도구·건축부품 배치 되살림(도끼·곡괭이 유지)
    try { if(snap.quickslots && Array.isArray(snap.quickslots) && ctx.quickslots){
      for(let i=0;i<ctx.quickslots.length && i<snap.quickslots.length;i++){ const q=snap.quickslots[i]; ctx.quickslots[i] = q ? { type:q.type, id:q.id } : null; }
      if(ctx.updHotbar) ctx.updHotbar();
    } } catch(e){ console.warn('[save] quickslots 복원', e&&e.message); }
    // 함대(배) 재건 — shipyard.rebuild(키로 initShip 재사용). active를 마지막에 세워 ctx.ship 지정.
    try { if(snap.fleet && snap.fleet.length && ctx.shipyard && ctx.shipyard.rebuild){
      ctx.fleet = ctx.fleet || [];
      const ordered = snap.fleet.slice().sort((a,b)=> (a.key===snap.activeShipKey?1:0) - (b.key===snap.activeShipKey?1:0));  // active 마지막
      for(const f of ordered){ const bs = await ctx.shipyard.rebuild(f.key, { x:f.x, z:f.z, durability:f.dur });
        if(bs){ if(f.yaw!=null) bs.yaw=f.yaw;   // ⚓ 선수각 복원(rebuild는 정박 유지 — anchored는 덮지 않음: 표류 방지)
          ctx.fleet.push({ name:f.name, key:f.key, bs, x:f.x, z:f.z }); } }
    } } catch(e){ console.warn('[save] fleet 복원', e&&e.message); }
    // 플레이어 위치·시점·도구 — 배 재건 뒤(스폰 위치 확정)
    try { const p=ctx.player; if(p && snap.player){
      let px=snap.player.x, py=snap.player.y, pz=snap.player.z, _boardShip=null;
      await _ensureIslandLoaded(px, pz);   // ★스트림 섬 지형·충돌 등록 대기(위 주석) — 아래 groundAt 판정이 정확해지게
      // ★스폰 안전화(사령관 "이어하기 시 바다에서 시작됨"): 저장 위치가 물 위면 → 배 위였으면 재건된 배로 / 아니면 가까운 해안 육지로 스냅. 바다 익사 방지.
      const wl = ctx.water ? ctx.water.level : 0;
      const gAt = (x,z)=> ctx.terrain ? ctx.terrain.groundAt(x,z,5000) : 0;
      if(gAt(px,pz) < wl + 0.4){   // 발밑 지면이 수면 아래 = 물 위
        // ⚓ 배 위(항해 중) 저장 → 재건된 배 갑판으로 = 바다 그 자리서 재개(사령관 "바다에서도 그자리"). 시작섬 폴백 안 함.
        let sh = (ctx.ship && Math.hypot(ctx.ship.x-px, ctx.ship.z-pz) < 60) ? ctx.ship : null;
        if(!sh && snap.player.onShip && ctx.ships && ctx.ships.length){   // onShip 저장인데 active 매칭 실패 → 가장 가까운 배로
          sh = ctx.ships.filter(s=>!s._sunk).sort((a,b)=>Math.hypot(a.x-px,a.z-pz)-Math.hypot(b.x-px,b.z-pz))[0] || null; }
        if(sh){   // 배 갑판 위로 스냅 — ★board()가 deckCx/deckLocalY/deckCz를 배 월드행렬로 변환해 정확히 얹음([Y]상선과 동일, 사령관). 여기선 근처에만 놓고 아래서 board() 호출.
          px=sh.x; pz=sh.z; py=wl+3; _boardShip=sh; console.log('[save] 배 위 저장 → 재건된 배로 상선(board)');
        } else {   // 가까운 해안 육지 탐색(나선)
          let land=null;
          for(let r=8; r<=200 && !land; r+=8){ for(let a=0; a<16; a++){ const ang=a/16*Math.PI*2;
            const sx=px+Math.cos(ang)*r, sz=pz+Math.sin(ang)*r; const g=gAt(sx,sz);
            if(g > wl+0.6){ land={ x:sx, y:g+2, z:sz }; break; } } }
          if(land){ px=land.x; py=land.y; pz=land.z; console.log('[save] 스폰 물 위 → 가까운 해안 육지로 스냅'); }
          else if(ctx.terrain && ctx.terrain.spawn){   // ★근처 육지 없음(먼 바다/오프닝 저장/미스트림) → 시작섬 스폰 폴백. 절대 바다에서 시작 안 함.
            const sp=ctx.terrain.spawn; px=sp.x; pz=sp.z; py=(sp.y!=null?sp.y+2:8); console.warn('[save] 스폰 물 위+근처육지없음 → 시작섬 스폰 폴백'); }
        }
      }
      if(p.setSpawn) p.setSpawn(px, py, pz);
      if(p.setYaw && snap.player.yaw!=null) p.setYaw(snap.player.yaw);
      // ⚓ 배 위 저장 = 갑판 정위치로 스냅([Y]상선 board와 동일 계산: deckCx/deckLocalY/deckCz × 배 curMatrix). THREE 미import → 행렬원소 직접 변환.
      //   배 curMatrix가 준비될 때까지(로드 직후 identity일 수 있음) 몇 프레임 재시도. board()는 noPointerLock/근접 가드에 막혀 사용 안 함.
      if(_boardShip){ const s=_boardShip;
        const snapDeck=()=>{ const e=s.curMatrix&&s.curMatrix.elements; if(!e) return false;
          if(Math.abs((e[12]||0)-s.x)>8) return false;   // curMatrix 미준비(배 위치 미반영)
          const lx=s.deckCx||0, ly=(s.deckLocalY||0)+1.4, lz=s.deckCz||0;
          const wx=e[0]*lx+e[4]*ly+e[8]*lz+e[12], wy=e[1]*lx+e[5]*ly+e[9]*lz+e[13], wz=e[2]*lx+e[6]*ly+e[10]*lz+e[14];
          if(p.setSpawn) p.setSpawn(wx,wy,wz); return true; };
        if(!snapDeck()){ let _t=0; const _iv=setInterval(()=>{ if(snapDeck()||++_t>18) clearInterval(_iv); }, 100); } }
      if(p.equipTool && snap.player.tool && snap.player.tool!=='none') p.equipTool(snap.player.tool); } } catch(e){ console.warn('[save] player 복원', e&&e.message); }
    // ★D1(2026-07-15): 배 업그레이드 레벨 복원 — 기본 0에서 스냅샷 병합(구 세이브=필드 없음→0 유지).
    try { ctx.shipUpgrades = Object.assign({ speed:0, cannon:0, sail:0 }, ctx.shipUpgrades||{}, snap.shipUpgrades||{}); } catch(_){}
    // 시간대
    try { if(snap.time!=null && ctx.time && ctx.time.set) ctx.time.set(snap.time); } catch(_){}
    // 레거시 퀘스트 단계 재개.
    //   ★역행 치유(사령관 "1차 항해로 돌아감"): 이미 항구(claimed.wharf)를 지었으면 온보딩 초반(제작·항구 튜토)은 지난 것 → 초반 단계로 저장돼 있어도 배건조/출항 단계로 보정. (기존 _kick 리셋 버그로 손상된 세이브 복구)
    try { if(snap.quest && snap.quest!=='done' && window.__quest && window.__quest.go){
      const hasHarbor = (snap.claimed||[]).some(c=>c && (c.wharf || c.dockPoint));   // 신·구 세이브 모두(구=dockPoint) 항구로 인정
      const early = ['intro','gather','craft','crafttools','outpost','harbor'];   // ★outpost 추가(2026-08-07 새 온보딩 — 깃발 거점 단계)
      let step = snap.quest;
      if(hasHarbor && early.includes(step)) step = (snap.fleet && snap.fleet.length) ? 'setsail' : 'ship';   // 항구O·배O→출항 / 항구O·배X→배건조
      window.__quest.go(step);
    } } catch(e){ console.warn('[save] quest 복원', e&&e.message); }
    console.log('[save] 복원 완료 —', JSON.stringify({ lvl:snap.combat&&snap.combat.level, claimed:(snap.claimed||[]).length, fleet:(snap.fleet||[]).length, quest:snap.quest }));
    return true;
  }

  // ── 자동저장: 주기 + 마일스톤 훅 체인 + 페이지 이탈 ──
  let _started=false;
  function markLive(){ _live=true; }   // 깨어남(오프닝 완료) = 실제 게임 시작 → 이 시점부터 자동저장 활성
  function startAutosave(){
    if(_started) return false; _started=true;
    setInterval(()=>{ if(window.__ready && _live) write(); }, AUTOSAVE_MS);   // ★_live 아니면(오프닝 중) 저장 안 함 = 먼바다 위치 저장 방지
    window.addEventListener('beforeunload', ()=>{ if(window.__ready && _live) write(); });
    // 마일스톤 — R2: 이벤트 버스 구독(구 수제 체인 폐지). 마일스톤은 깨어난 뒤에만 발생하므로 _live=true.
    const onMilestone = ()=>{ if(_live) setTimeout(write,300); };
    for(const ev of ['shipBuilt','wharfBuilt','outpostCaptured','toolCrafted']) ctx.events.on(ev, onMilestone);
    // (toolCrafted = SIM-H3/D2 수정 — 도구 제작만 마일스톤 저장서 빠져 제작 직후 이탈 시 유실 갭이던 것)
    console.log('[save] 자동저장 시작 — 주기', AUTOSAVE_MS/1000+'s + 마일스톤 + 이탈 시. live='+_live); return true;
  }

  ctx.save = { snapshot, write, read, has, clear, restore, startAutosave, markLive, KEY, ROSTER_KEY,
    listChars, deleteChar, activeCid };   // 🎭 멀티 캐릭터 로스터 API(charselect.html용) + markLive(깨어남 시 자동저장 활성)
  window.__save = { save:write, load:(cid)=>restore(read(cid)), clear, has, peek:read,
    chars:listChars, del:deleteChar,
    acct:acctKey, setAcct:(a)=>{ try{ localStorage.setItem(ACCT_KEY, String(a)); }catch(_){} syncRosterFromServer(); },   // 🔑 추후 intro 로그인이 setAcct(닉네임) 호출
    wipeForSeason:()=>{ _wiping=true; clear(); } };   // 🌐 시즌 리셋 — 저장 차단 후 로컬 전부 삭제(netcode가 호출, 이후 재시작)
  console.log('[save] 세이브 모듈 등록 — 캐릭터', listChars().length, '개 · acct='+acctKey()+' · window.__save.chars()/save()/load(cid)/del(cid)/clear()');
  syncRosterFromServer();   // 서버 계정 로스터 병합(비차단, Phase 2)
  return ctx.save;
}
