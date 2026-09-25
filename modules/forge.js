// forge.js — 화로(제련소). mas 발칸 타이머 제련 방식 + 레퍼1 레이아웃 + map 톤.
//   ★화로 근처 [E] → 제련 UI. 좌측=제련 레시피 / 우측=재료·진행바·[제련 시작]. (레퍼1)
//   ★타이머 제련: 광물+석탄 차감 → 시간 경과(진행바) → 주괴/합금. 동시 1개(mas SMELT).
//   화로 = 거점에 기본 비치(발칸 옆 컨셉). 의존: ctx.inventory·ctx.terrain·ctx.scene.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export function initForge(ctx){
  const inv = ctx.inventory;
  if(!inv){ console.warn('[forge] ctx.inventory 없음'); return; }
  const NEAR = 6;
  let open=false, sel=null;

  // 제련 레시피 (mas SMELT_PER 시간감) — 광물+석탄 → 합금/주괴
  const SMELT = [
    { id:'steel',  name:'강철',  icon:'⚙️', in:[['iron',2],['coal',2]],             out:['steel',1],  ms:30000, note:'철광석 제련 — 대포·도구 강화' },
    { id:'bronze', name:'청동',  icon:'🟧', in:[['copper',2],['tin',1],['coal',1]], out:['bronze',1], ms:45000, note:'구리+주석 합금 — 함포' },
    { id:'goldbar',name:'금 정련', icon:'🟡', in:[['gold',2],['coal',1]],            out:['gold',2],   ms:60000, note:'금 정련 — 순도↑ 고가 교역' },
  ];
  let job=null;  // { r, elapsed, ms }

  // 레시피 아이콘 스왑(ui/icons PNG). 매핑 있으면 <img>, 없으면 이모지 폴백.
  const RIC={ steel:'steel', bronze:'bronze', goldbar:'gold' };
  const ric=(r)=>{ const n=RIC[r.id]; return n?`<img src="/ui/icons/icon_${n}.png" alt="">`:r.icon; };

  // ── 화로 메시 (용광로) — 거점 비치 ──
  let furnace=null, smithyTpl=null;
  // 대장간 생성(깃발 옆 육지). 항구 건설(wharf) 시 호출. 지면 정확 안착.
  function spawnSmithy(x,z){
    if(!ctx.terrain || furnace) return;
    const gy=ctx.terrain.groundAt(x,z,5000);
    furnace={x,y:gy,z};
    const tx=new THREE.TextureLoader().load(encodeURI('/tomob-deploy/stylized-weaponsmith/textures/Weaponsmith_Base_color.png'));
    tx.colorSpace=THREE.SRGBColorSpace; tx.flipY=false;
    new FBXLoader().load(encodeURI('/tomob-deploy/stylized-weaponsmith/source/weaponsmith.fbx'), obj=>{
      obj.traverse(o=>{ if(o.isMesh){ o.material=new THREE.MeshStandardMaterial({ map:tx, roughness:0.85, metalness:0.1, flatShading:true }); o.castShadow=o.receiveShadow=true; } });
      const bb=new THREE.Box3().setFromObject(obj), s=bb.getSize(new THREE.Vector3());
      obj.scale.setScalar(9/Math.max(s.x,s.z));
      const bb2=new THREE.Box3().setFromObject(obj);
      obj.position.set(x, gy-bb2.min.y, z); ctx.scene.add(obj);   // ★바닥을 지면(gy)에 안착
      if(ctx.terrain.addTrimesh){ try{ ctx.terrain.addTrimesh(obj); }catch(e){} }
      furnace.group=obj;
      console.log('[forge] 대장간 배치 ('+x.toFixed(0)+','+z.toFixed(0)+') gy='+gy.toFixed(1));
    }, undefined, e=>console.warn('[forge] weaponsmith 로드 실패:', e&&e.message));
  }
  // ※자동배치 제거 — 항구 건설(깃발) 시 깃발 옆에 생성됨

  // ── 스타일 (invui와 같은 map 톤) ──
  if(!document.getElementById('hb_font')){ const lf=document.createElement('link'); lf.id='hb_font'; lf.rel='stylesheet'; lf.href='https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&display=swap'; document.head.appendChild(lf); }
  const MAP_BG = encodeURI('/tomob-deploy/애셋/map3.png');
  const st=document.createElement('style'); st.textContent=`
    #fg_prompt{position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:25;background:rgba(20,16,9,.8);color:#ffe28a;padding:8px 20px;border-radius:8px;border:1px solid rgba(201,168,90,.5);font:14px Pretendard,system-ui;display:none;pointer-events:none;text-shadow:0 1px 3px #000}
    #fg_panel{position:fixed;inset:0;z-index:42;display:none;align-items:center;justify-content:center;background:rgba(3,7,12,.74);backdrop-filter:blur(4px);font-family:Pretendard,system-ui,'Malgun Gothic'}
    #fg_card{position:relative;width:min(820px,94vw);height:min(500px,88vh);display:flex;flex-direction:column;
      background:linear-gradient(180deg,rgba(9,20,30,.94),rgba(5,12,20,.97)),url('${MAP_BG}') center/cover no-repeat,#08111c;
      border:1px solid #c9a85a;border-radius:12px;overflow:hidden;box-shadow:0 30px 90px rgba(0,0,0,.8),inset 0 0 0 1px rgba(201,168,90,.16),inset 0 0 80px rgba(16,46,60,.3)}
    #fg_card::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.4;background:repeating-linear-gradient(0deg,transparent 0 47px,rgba(201,168,90,.06) 47px 48px),repeating-linear-gradient(90deg,transparent 0 47px,rgba(201,168,90,.06) 47px 48px)}
    #fg_head{position:relative;display:flex;align-items:center;padding:13px 20px;background:linear-gradient(180deg,rgba(40,20,10,.6),rgba(12,8,6,.5));border-bottom:1px solid rgba(201,168,90,.4);z-index:1}
    #fg_title{color:#ffb070;font-size:19px;font-weight:700;font-family:'Cinzel',Georgia,serif;letter-spacing:.03em;text-shadow:0 2px 6px #000}
    #fg_x{margin-left:auto;color:#86a6b6;cursor:pointer;font-size:20px}#fg_x:hover{color:#ffe28a}
    #fg_main{position:relative;flex:1;display:flex;min-height:0;z-index:1}
    #fg_left{flex:1.3;padding:16px;overflow-y:auto;border-right:1px solid rgba(201,168,90,.3)}
    .fg_rc{display:flex;align-items:center;gap:11px;background:linear-gradient(180deg,rgba(18,40,52,.5),rgba(6,16,26,.6));border:1px solid rgba(201,168,90,.28);border-radius:9px;padding:12px 13px;margin-bottom:8px;cursor:pointer;transition:all .1s}
    .fg_rc:hover{border-color:rgba(90,200,220,.6)}
    .fg_rc.sel{border-color:#5ad0e0;box-shadow:0 0 12px rgba(90,208,224,.4)}
    .fg_rc .ri{font-size:26px}.fg_rc .ri img{height:30px;vertical-align:-6px;filter:drop-shadow(0 1px 1px #000)}.fg_rc .rn{font-weight:700;color:#ffe6b0;font-size:15px}.fg_rc .rt{font-size:11px;color:#8fb4b4;margin-top:2px}
    #fg_right{flex:1;min-width:260px;padding:22px 20px;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(10,24,34,.5),rgba(5,12,20,.6))}
    #fg_dt_empty{margin:auto;color:#5d7884;font-size:13px;text-align:center}
    #fg_dt_ic{font-size:54px;text-align:center;margin:6px 0}#fg_dt_ic img{height:56px;filter:drop-shadow(0 2px 2px #000)}
    #fg_dt_nm{font-size:18px;font-weight:800;color:#ffb070;text-align:center;font-family:'Cinzel',Georgia,serif}
    #fg_dt_note{font-size:12px;color:#aac4ba;text-align:center;margin:10px 0 16px;line-height:1.6}
    .fg_ing{display:flex;justify-content:space-between;font-size:12px;color:#bcd0c4;padding:5px 0;border-top:1px solid rgba(201,168,90,.16)}
    .fg_ing b.ok{color:#7fe39a}.fg_ing b.no{color:#ff8a8a}
    #fg_prog{height:18px;border-radius:9px;background:linear-gradient(180deg,#07111a,#122436);border:1px solid rgba(201,168,90,.4);overflow:hidden;margin:16px 0 6px;position:relative}
    #fg_progfill{height:100%;width:0;background:linear-gradient(90deg,#ff8a3a,#ffd040);transition:width .2s}
    #fg_progtext{position:absolute;inset:0;text-align:center;font-size:11px;line-height:18px;color:#fff;text-shadow:0 1px 2px #000}
    #fg_btn{margin-top:auto;background:linear-gradient(180deg,#ecc962,#a9842f);color:#2a1d06;border:1px solid #d8b24e;border-radius:8px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit}
    #fg_btn:hover{filter:brightness(1.1)}#fg_btn:disabled{background:#2a3540;color:#6a7f8a;border-color:#3a4a55;cursor:default}`;
  document.head.appendChild(st);

  const prompt=document.createElement('div'); prompt.id='fg_prompt'; prompt.textContent='[E] 화로 — 제련'; document.body.appendChild(prompt);
  const panel=document.createElement('div'); panel.id='fg_panel';
  panel.innerHTML=`<div id="fg_card">
    <div id="fg_head"><span id="fg_title">화로 · 제련</span><span id="fg_x">✕</span></div>
    <div id="fg_main"><div id="fg_left"></div><div id="fg_right"></div></div>
  </div>`;
  document.body.appendChild(panel);
  const leftEl=panel.querySelector('#fg_left'), rightEl=panel.querySelector('#fg_right');

  function nameOf(id){ return (inv.MATERIALS[id]||{}).name || id; }
  function canSmelt(r){ return !job && r.in.every(([m,n])=> inv.count(m)>=n); }

  function renderLeft(){
    leftEl.innerHTML = SMELT.map(r=>{
      const active = job && job.r.id===r.id;
      return `<div class="fg_rc ${sel===r.id?'sel':''}" data-r="${r.id}"><span class="ri">${ric(r)}</span><div><div class="rn">${r.name}${active?' <span style="color:#ffd040;font-size:11px">⏳ 제련중</span>':''}</div><div class="rt">${(r.ms/1000)|0}초 · ${r.in.map(([m,n])=>nameOf(m)+n).join('+')}</div></div></div>`;
    }).join('');
    leftEl.querySelectorAll('.fg_rc').forEach(c=> c.onclick=()=>{ sel=c.dataset.r; render(); });
  }
  function renderRight(){
    const r=SMELT.find(x=>x.id===sel);
    if(!r){ rightEl.innerHTML=`<div id="fg_dt_empty">제련할 항목을 선택하세요</div>`; return; }
    const active = job && job.r.id===r.id;
    const pct = active ? Math.min(100, job.elapsed/job.ms*100) : 0;
    const ok=canSmelt(r);
    rightEl.innerHTML=`<div id="fg_dt_ic">${ric(r)}</div><div id="fg_dt_nm">${r.name}</div><div id="fg_dt_note">${r.note}</div>
      ${r.in.map(([m,n])=>`<div class="fg_ing"><span>${nameOf(m)}</span><b class="${inv.count(m)>=n?'ok':'no'}">${inv.count(m)}/${n}</b></div>`).join('')}
      <div id="fg_prog"><div id="fg_progfill" style="width:${pct}%"></div><div id="fg_progtext">${active?Math.ceil((job.ms-job.elapsed)/1000)+'초 남음':'대기'}</div></div>
      <button id="fg_btn" ${ok?'':'disabled'}>${job?(active?'제련 중…':'화로 사용 중'):'제련 시작'}</button>`;
    const bt=rightEl.querySelector('#fg_btn');
    if(bt && ok) bt.onclick=()=>{ r.in.forEach(([m,n])=>inv.remove(m,n)); job={ r, elapsed:0, ms:r.ms }; render(); };
  }
  function render(){ renderLeft(); renderRight(); }

  function openForge(){ open=true; panel.style.display='flex'; render(); if(document.exitPointerLock) document.exitPointerLock(); }
  function close(){ open=false; panel.style.display='none'; }
  panel.querySelector('#fg_x').onclick=close;
  panel.addEventListener('click',e=>{ if(e.target===panel) close(); });

  let near=false;
  addEventListener('keydown', e=>{
    if(e.code==='KeyE' && !open && near && document.pointerLockElement===ctx.renderer.domElement) openForge();
    else if(e.code==='Escape' && open) close();
  });

  ctx.onUpdate(dt=>{
    // 화로 근처 판정
    if(furnace && !open){ const pp=ctx.player.pos; near = Math.hypot(pp.x-furnace.x, pp.z-furnace.z) < NEAR; prompt.style.display = near?'block':'none'; }
    // 제련 진행
    if(job){ job.elapsed += dt*1000;
      if(job.elapsed >= job.ms){ inv.add(job.r.out[0], job.r.out[1]); const done=job.r; job=null; if(open) render(); console.log('[forge] 제련 완료:', done.name); }
      else if(open) renderRight();
    }
  });

  ctx.forge={ open:openForge, close, isOpen:()=>open, _near:()=>{near=true;}, furnace:()=>furnace, SMELT };
  console.log('[forge] 화로 제련 등록 — 화로 근처 [E]. 타이머 제련(강철/청동/금). 레퍼1+map 톤.');
  return ctx.forge;
}
