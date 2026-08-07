// netcode.js — 멀티 위치 릴레이 클라(폴링). 타 플레이어 고스트 아바타 + 서버 권위 시간 동기.
//   서버=scripts/serve.mjs 의 /mp/state(보고)·/mp/states(수신)·/mp/world(시간). 무의존·짧은 폴링.
//   설계(향후방향_v2 §4): 체감은 솔로. 타 플레이어는 배경 레이어 = 위치 고스트만. 점령/건설 공유는 후속.
//   file:// 에선 서버가 없으므로 no-op.
export function initNetcode(ctx){
  const proto = location.protocol;
  if(proto !== 'http:' && proto !== 'https:'){ console.log('[net] file:// — 멀티 비활성'); return; }
  const THREE = ctx.THREE, scene = ctx.scene;
  if(!THREE || !scene){ console.warn('[net] THREE/scene 없음 — 멀티 스킵'); return; }

  const myId = 'p_' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36);
  const qp = new URLSearchParams(location.search);

  function myMeta(){
    let name = qp.get('name') || (window.__save && window.__save.acct && '') || '표류자';
    try { if(ctx.playerName) name = ctx.playerName; } catch(_){}
    name = String(name || '표류자').slice(0,16);
    let char = -1; const c = qp.get('char'); if(c!=null && c!=='') { const n = Number(c); if(!Number.isNaN(n)) char = n; }
    let fac = null; try { if(ctx.faction && ctx.faction.serialize){ const f = ctx.faction.serialize(); if(f && f.declared) fac = f.name || null; } } catch(_){}
    return { name, char, fac };
  }
  const M = myMeta();

  // ── 내 위치 보고(스로틀) ──
  const REPORT_MS = 120; let _rep = 0;
  ctx.onUpdate((dt)=>{
    _rep += dt*1000; if(_rep < REPORT_MS) return; _rep = 0;
    const p = ctx.player && ctx.player.pos; if(!p) return;
    const boat = !!(ctx.ship && ctx.ship.boarded) || !!(ctx.player && ctx.player.onShipRef);
    const body = { id:myId, x:+p.x.toFixed(2), y:+p.y.toFixed(2), z:+p.z.toFixed(2),
      yaw:+((ctx.player.yaw||0).toFixed(3)), name:M.name, mode:boat?'ship':'foot', boat, char:M.char, fac:M.fac };
    try { fetch('/mp/state', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).catch(()=>{}); } catch(_){}
  });

  // ── 타 플레이어 고스트 ──
  const ghosts = new Map();   // id -> { group, target, yaw, name, boat }
  function colorFor(id){ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return new THREE.Color().setHSL((h%360)/360, 0.55, 0.55); }
  function makeLabel(text){
    const cv = document.createElement('canvas'); cv.width=256; cv.height=64; const g=cv.getContext('2d');
    g.font='bold 34px Pretendard, sans-serif'; g.textAlign='center'; g.textBaseline='middle';
    g.lineWidth=6; g.strokeStyle='rgba(0,0,0,0.85)'; g.strokeText(text,128,32);
    g.fillStyle='#fff'; g.fillText(text,128,32);
    const tex=new THREE.CanvasTexture(cv); tex.anisotropy=2;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, depthTest:false, transparent:true }));
    sp.scale.set(3.2,0.8,1); sp.renderOrder=999; return sp;
  }
  function makeGhost(s){
    const grp = new THREE.Group();
    const col = colorFor(s.id);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5,1.1,4,8), new THREE.MeshStandardMaterial({ color:col, roughness:0.7 }));
    body.position.y = 1.1; grp.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42,12,10), new THREE.MeshStandardMaterial({ color:col, roughness:0.7 }));
    head.position.y = 2.05; grp.add(head);
    const label = makeLabel(s.name || '표류자'); label.position.y = 2.9; grp.add(label);
    grp.position.set(s.x, s.y, s.z);
    scene.add(grp);
    return { group:grp, target:new THREE.Vector3(s.x,s.y,s.z), yaw:s.yaw||0, name:s.name, boat:!!s.boat, label };
  }
  function disposeGhost(g){ scene.remove(g.group);
    g.group.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ if(o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }

  async function pollStates(){
    try{
      const r = await fetch('/mp/states?id='+encodeURIComponent(myId), { cache:'no-store' }); if(!r.ok) return;
      const list = await r.json(); if(!Array.isArray(list)) return;
      const seen = new Set();
      for(const s of list){ if(!s || !s.id) continue; seen.add(s.id);
        let g = ghosts.get(s.id); if(!g){ g = makeGhost(s); ghosts.set(s.id, g); }
        g.target.set(s.x, s.y, s.z); g.yaw = s.yaw||0; g.boat = !!s.boat;
      }
      for(const [id,g] of ghosts){ if(!seen.has(id)){ disposeGhost(g); ghosts.delete(id); } }
    }catch(_){}
  }
  setInterval(pollStates, 200);
  // 프레임마다 고스트를 목표로 부드럽게 보간
  ctx.onUpdate((dt)=>{ const k = Math.min(1, dt*8);
    for(const g of ghosts.values()){ g.group.position.lerp(g.target, k); g.group.rotation.y = g.yaw||0; } });

  // ── 시즌 변경 감지 → 로컬 전부 초기화 후 새 시즌 재시작 (사령관: 시즌 리셋=전부 초기화) ──
  const SEASON_KEY = 'voyageSeason'; let _seasonBusy = false;
  function checkSeason(sid){
    if(typeof sid !== 'number' || _seasonBusy) return;
    let local = null; try{ const v = localStorage.getItem(SEASON_KEY); local = v==null ? null : +v; }catch(_){}
    if(local == null || Number.isNaN(local)){ try{ localStorage.setItem(SEASON_KEY, String(sid)); }catch(_){} return; }   // 첫 접속 = 초기화 없이 채택
    if(sid !== local){ _seasonBusy = true;
      console.warn('[net] 시즌 변경 감지', local, '→', sid, '— 로컬 세이브 초기화 후 새 시즌 재시작');
      try{ if(window.__save && window.__save.wipeForSeason) window.__save.wipeForSeason(); else if(window.__save && window.__save.clear) window.__save.clear(); }catch(_){}
      try{ localStorage.setItem(SEASON_KEY, String(sid)); }catch(_){}
      try{ location.href = 'select.html'; }catch(_){ location.reload(); }   // ★캐릭터 선택 시작점(index.html은 데모, 게임 아님)
    }
  }

  // ── 서버 권위 시간 동기(best-effort, 젠틀) + 시즌 감지 ──
  async function pollWorld(){
    try{ const r = await fetch('/mp/world', { cache:'no-store' }); if(!r.ok) return; const w = await r.json();
      if(typeof w.dayTime === 'number' && ctx.sky && typeof ctx.sky.setTime === 'function') ctx.sky.setTime(w.dayTime);
      checkSeason(w.seasonId);
    }catch(_){}
  }
  pollWorld(); setInterval(pollWorld, 5000);

  // 디버그 훅
  window.__net = { id:myId, ghosts, meta:M, count:()=>ghosts.size };
  console.log('[net] 멀티 활성 — id='+myId+' · name='+M.name+' · /mp 폴링 시작');
}
