// pickup.js — 공용 드롭 + 마그넷 픽업 시스템 (마크/발헤임 손맛).
//   자원 파괴(벌목·채광·상자·전리품)가 ctx.pickup.spawn(id,qty,pos)를 호출하면:
//     아이템이 물리 아크로 툭 튀어나옴 → 바닥에 둥실 → 플레이어가 다가오면 자동 흡수(마그넷) → 인벤 적재.
//   의존: ctx.{THREE,scene,onUpdate,player,inventory,terrain(groundAt)}. 물리는 자체 경량 아크(Rapier 불필요, 드롭 수백개도 가벼움).
import * as THREE from 'three';

export function initPickup(ctx, opts={}){
  const { scene } = ctx;
  const MAG_R     = opts.magnetR  ?? 4.5;   // 흡수 시작 반경(m)
  const COLLECT_R = opts.collectR ?? 1.35;  // 획득 반경(m)
  const GRAV      = opts.grav     ?? -22;
  const GRACE     = opts.grace    ?? 0.4;   // ★갓 튄 조각 흡수 유예(s) — 코앞서 부숴도 먼저 튀어 흩어진 뒤 흘러들어옴(즉시흡수 방지, 손맛)
  const MAX_NUG   = opts.nuggets  ?? 4;      // 한 번에 흩뿌릴 최대 덩이 수(나머지는 한 덩이에 몰아담음)
  // 아이템 색(invui TINT 계열). 없으면 회색 돌.
  const TINT={ timber:0x8a6240,leaf:0x5a9a3e,stone:0x9a9286,iron:0x6b7686,copper:0xc16a38,tin:0x9ba2aa,
    cobalt:0x2f55d4,gold:0xe6b73a,silver:0xd6dade,gem:0xd83a5e,coal:0x2a2c31,rope:0xc9a86a,steel:0x8893a0,bronze:0xb87333 };
  const drops=[]; let _geo=null;
  const geo=()=> _geo||(_geo=new THREE.IcosahedronGeometry(0.24,0));
  const matFor=id=>{ const c=TINT[id]??0x9a9286; return new THREE.MeshStandardMaterial({color:c,emissive:c,emissiveIntensity:0.3,metalness:0.25,roughness:0.55}); };

  // ── 픽업 알림 피드 (뭘 주웠는지 — 우측, 색점+"＋N 이름", 같은 아이템 집계·페이드) ──
  const _itemName=id=>{ const inv=ctx.inventory; return (inv?.MATERIALS?.[id]?.name)||(inv?.FOODS?.[id]?.name)||(inv?.TRADE_GOODS?.[id]?.name)||id; };
  let _pkFeed=null; const _pkAgg={};
  function notifyPickup(id, qty){
    if(qty<=0 || typeof document==='undefined') return;
    if(!_pkFeed){ _pkFeed=document.createElement('div');
      _pkFeed.style.cssText='position:fixed;right:22px;bottom:120px;z-index:30;display:flex;flex-direction:column-reverse;gap:6px;pointer-events:none;align-items:flex-end;font-family:Pretendard,system-ui,sans-serif';
      document.body.appendChild(_pkFeed); }
    const now=performance.now(), c='#'+(TINT[id]??0x9a9286).toString(16).padStart(6,'0'), a=_pkAgg[id];
    if(a && a.el.parentNode && now-a.t<2600){ a.qty+=qty; a.t=now; a.fade=now+1900;
      a.el.querySelector('.pk-q').textContent='＋'+a.qty; a.el.style.opacity='1';
      a.el.style.transform='scale(1.07)'; setTimeout(()=>{ if(a.el)a.el.style.transform='scale(1)'; },90); }
    else { const el=document.createElement('div');
      el.style.cssText='display:flex;align-items:center;gap:10px;background:rgba(13,19,27,.84);border:1px solid rgba(255,255,255,.13);border-radius:10px;padding:9px 18px 9px 14px;box-shadow:0 2px 9px rgba(0,0,0,.55);transition:opacity .55s ease,transform .12s;opacity:1';
      el.innerHTML=`<span style="width:14px;height:14px;border-radius:4px;background:${c};box-shadow:0 0 8px ${c}aa;flex:none"></span><span class="pk-q" style="font:800 19px/1 inherit;color:#8fe3a8">＋${qty}</span><span style="font:600 18px/1 inherit;color:#e8eef2">${_itemName(id)}</span>`;
      _pkFeed.appendChild(el); _pkAgg[id]={el,qty,t:now,fade:now+1900}; }
  }
  function _fadeFeed(){ const now=performance.now();
    for(const id in _pkAgg){ const a=_pkAgg[id]; if(!a.el) continue;
      if(now>a.fade){ a.el.style.opacity='0'; if(now>a.fade+650){ a.el.remove(); delete _pkAgg[id]; } } }
  }

  // id 아이템 qty개를 pos에서 드롭. 최대 MAX_NUG 덩이로 흩뿌리고 각 덩이가 몫을 나눠 가짐(합=qty).
  //   o.geo/o.mat = 실제 조각 모양(광석 geo·나무색 등, 없으면 색 정20면체). o.scale = 기준 크기(조각마다 ±편차).
  function spawn(id, qty=1, pos, o={}){
    if(!id || qty<=0 || !pos) return;
    const N=Math.max(1, Math.min(o.nuggets??MAX_NUG, qty));
    const y0=(pos.y??0)+0.6, useGeo=o.geo||geo(), base=o.scale??1;
    for(let k=0;k<N;k++){
      const share=Math.floor(qty/N)+(k<qty%N?1:0); if(share<=0) continue;
      const mat=o.mat?o.mat.clone():matFor(id);
      const m=new THREE.Mesh(useGeo, mat); m.castShadow=true;
      m.rotation.set(Math.random()*6.28,Math.random()*6.28,Math.random()*6.28);
      const sc=base*(0.8+Math.random()*0.5);   // 조각마다 크기 편차
      m.position.set(pos.x, y0, pos.z); m.scale.setScalar(0.001);
      scene.add(m);
      const ang=Math.random()*6.283, sp=(1.4+Math.random()*1.6)*(o.pop??1);   // ★o.pop=바깥 튀김 배율(벌목=코앞이라 세게 튀겨 흩어진 뒤 마그넷)
      drops.push({ id, qty:share, m, sc, vx:Math.cos(ang)*sp, vy:(3.2+Math.random()*2)*(o.pop?1.15:1), vz:Math.sin(ang)*sp,
        grounded:false, baseY:0, born:0, phase:Math.random()*6.283, pop:0 });
    }
  }

  function collect(d,i){
    const ok = ctx.inventory ? ctx.inventory.add(d.id, d.qty) : true;   // 무게초과면 false → 월드에 남겨둠
    if(ok===false) return false;
    scene.remove(d.m); d.m.material.dispose(); drops.splice(i,1);
    ctx.sound?.play?.('item_in');   // ★조각 흡수음 — 조각(nugget)이 하나씩 날아들 때마다 개당 1소리(연속). 채광·벌목 손맛(사령관).
    notifyPickup(d.id, d.qty);   // ★픽업 알림(뭘 주웠는지 우측 피드)
    if(ctx.updHotbar) ctx.updHotbar();
    if(ctx.pickup && ctx.pickup.onCollect) try{ ctx.pickup.onCollect(d.id,d.qty); }catch(e){}
    return true;
  }

  function tick(dt){
    _fadeFeed();   // ★픽업 알림 페이드(드롭 없어도 실행)
    if(!drops.length) return;
    const pl = ctx.player && ctx.player.pos;
    for(let i=drops.length-1;i>=0;i--){ const d=drops[i], m=d.m; d.born+=dt;
      if(d.pop<1){ d.pop=Math.min(1,d.pop+dt*6); m.scale.setScalar((0.55+0.45*d.pop)*(d.sc||1)); }
      m.rotation.y+=dt*2.4; m.rotation.x+=dt*0.8;
      let magnet=false;
      if(pl && d.born>GRACE){ const px=pl.x, py=(pl.y??0), pz=pl.z;   // ★유예(GRACE) 지난 조각만 흡수 → 코앞서 부숴도 먼저 튀어 흩어진 뒤 흘러들어옴
        const dx=px-m.position.x, dz=pz-m.position.z, dist=Math.hypot(dx,dz);
        if(dist<COLLECT_R && Math.abs(py+0.6-m.position.y)<3.5){ if(collect(d,i)) continue; }
        else if(dist<MAG_R){ magnet=true;
          const pull=(0.35+(MAG_R-dist)/MAG_R)*22*dt;
          m.position.x+=dx/(dist||1)*pull; m.position.z+=dz/(dist||1)*pull;
          m.position.y+=((py+0.7)-m.position.y)*Math.min(1,7*dt);
          d.grounded=true; d.vy=0;
        }
      }
      if(!magnet){
        if(!d.grounded){ d.vy+=GRAV*dt; m.position.x+=d.vx*dt; m.position.z+=d.vz*dt; m.position.y+=d.vy*dt;
          const gy = ctx.terrain ? ctx.terrain.groundAt(m.position.x, m.position.z, m.position.y+2) : 0;
          if(m.position.y<=gy+0.26){ m.position.y=gy+0.26; d.grounded=true; d.baseY=gy+0.26; d.vx=d.vy=d.vz=0; }
        } else { m.position.y = d.baseY + 0.07+0.05*Math.sin(d.born*2.6+d.phase); }   // 바닥서 둥실
      }
    }
  }
  ctx.onUpdate(tick);

  ctx.pickup={ spawn, count:()=>drops.length, _tick:tick,   // _tick=결정론 검증용(rAF 스로틀 우회)
    clear:()=>{ for(const d of drops){ scene.remove(d.m); d.m.material.dispose(); } drops.length=0; },
    onCollect:null };   // onCollect(id,qty) 훅(사운드·토스트 등 붙일 자리)
  console.log('[pickup] 드롭+마그넷 픽업 시스템 — ctx.pickup.spawn(id,qty,pos)');
  return ctx.pickup;
}
