// skillbar.js — 우하단 스킬바 (ref/화면/스킬바.png 패드 배치 재현 + 키보드 키 라벨). 캐릭터(직업)마다 스킬셋.
//   combat.js가 import → combat과 함께 항상 로드(별도 sys 아님).
//   ref 배치: 우상단 RB→RT(어깨), 좌중 보라(궁극), 우중 검(메인), 하단 대시. 계단식 arc.
//   role 로 ref 슬롯 위치에 매핑. 아이콘=이모지 placeholder(이미지 주면 img로 교체).

// ref 5(워더링웨이브류): 스킬을 우하단에 가로로 단순하게 깔아둠. 표시순서 = 이 배열.
const ORDER = ['dodge','extra','attack','special','ultimate'];   // 왼→오른쪽 (메인/특수/궁극이 오른쪽으로)

// ── 직업별 스킬셋 (role = ref 슬롯 매핑). k=키표기 ic=이모지 lb=라벨 cd=쿨다운소스 img=이미지(선택) ──
const SK='/';   // 스킬 아이콘 경로(루트). 기본공격 아이콘은 아직 없어 이모지 placeholder.
const DODGE_IMG=SK+'dash_transparent.png';
const CLASS_SKILLS = {
  knight:       { name:'기사', skills:[
    { role:'attack',  k:'좌클릭', lb:'베기',   cd:'atk', img:encodeURI(SK+'베기.png') },
    { role:'special', k:'우클릭', lb:'가드',   cd:'skill', img:SK+'01_shield_guard.png' },
    { role:'ultimate',k:'Q', lb:'충격파', charge:'guard', img:encodeURI(SK+'충격파.png') },   // ★가드로 막아 게이지 충전 → 가득 시 Q 발동(방패 충격파)
    { role:'dodge',   k:'더블탭', lb:'회피', img:DODGE_IMG } ] },
  barbarian:    { name:'전사', skills:[
    { role:'attack',  k:'좌클릭', lb:'휘두르기', cd:'atk', img:encodeURI(SK+'휘두루기.png') },
    { role:'special', k:'우클릭', lb:'휠윈드', cd:'skill', img:SK+'02_whirlwind.png' },
    { role:'dodge',   k:'더블탭', lb:'회피', img:DODGE_IMG } ] },
  mage:         { name:'마법사', skills:[
    { role:'attack',  k:'좌클릭', lb:'마법탄', img:encodeURI(SK+'마법탄.png') },   // 기본 마법탄(약함)
    { role:'special', k:'우클릭 (Q전환)', lb:'스킬', cd:'skill', live:true, img:SK+'05_firebolt.png', imgFire:SK+'05_firebolt.png', imgIce:SK+'06_icebolt.png' }, // Q로 불↔얼음 라이브 전환
    { role:'dodge',   k:'더블탭', lb:'회피', img:DODGE_IMG } ] },
  ranger:       { name:'레인저', skills:[
    { role:'attack',  k:'좌클릭', lb:'사격',   cd:'atk', img:encodeURI(SK+'사격.png') },
    { role:'special', k:'우클릭', lb:'조준',   cd:'skill', img:SK+'03_aimed_shot.png' },
    { role:'dodge',   k:'더블탭', lb:'회피', img:DODGE_IMG } ] },
  rogue_hooded: { name:'로그', skills:[
    { role:'attack',  k:'좌클릭', lb:'쌍수',   cd:'atk', img:encodeURI(SK+'쌍수베기.png') },
    { role:'special', k:'우클릭', lb:'은신',   cd:'skill', img:SK+'04_stealth.png' },
    { role:'dodge',   k:'더블탭', lb:'회피', img:DODGE_IMG } ] },
};
CLASS_SKILLS.rogue = CLASS_SKILLS.rogue_hooded;

export function initSkillBar(ctx){
  if(typeof document==='undefined' || document.getElementById('skillbar')) return;
  const charKey = (new URLSearchParams(location.search).get('char')||'knight').toLowerCase();
  const cls = CLASS_SKILLS[charKey] || CLASS_SKILLS.knight;
  const isMage = charKey==='mage';   // 활성 광원은 마법사만

  // 기존 단일 RMB 스킬 슬롯(_cb_skill) 숨김 — 스킬바가 대체
  const oldSkill = document.getElementById('_cb_skill'); if(oldSkill && oldSkill.parentElement) oldSkill.parentElement.style.display='none';

  const bar = document.createElement('div'); bar.id='skillbar';
  // ★평소 숨김(아래로 내려가 투명) → 전투모드 ON 시 올라오며 등장. 어그로 풀리면 다시 내려감.
  bar.style.cssText = `position:fixed;right:24px;bottom:26px;z-index:24;pointer-events:none;
    display:flex;flex-direction:row;align-items:flex-end;gap:11px;
    font:11px Pretendard,system-ui,sans-serif;color:#eaf4ff;user-select:none;
    opacity:0;transform:translateY(30px) scale(.92);will-change:opacity,transform;
    transition:opacity .28s ease, transform .36s cubic-bezier(.18,.85,.28,1.12)`;
  document.body.appendChild(bar);
  ctx.inCombat = false;   // 전투모드 플래그(다른 모듈서 ctx.inCombat 참조 가능)

  // 표시 순서대로 정렬(없는 role은 건너뜀). special=메인보다 약간 큼(ref R 느낌)
  const ordered = ORDER.map(r=>cls.skills.find(s=>s.role===r)).filter(Boolean)
    .concat(cls.skills.filter(s=>!ORDER.includes(s.role)));
  const _W = (typeof innerWidth!=='undefined'?innerWidth:1280);
  const slots = ordered.map(sk=>{
    const sz = Math.round(_W * ((sk.role==='special'||sk.role==='ultimate') ? 0.042 : 0.037));   // ref 크기 맞춤(축소): 화면폭 ~3.7%, 특수/궁극 ~4.2%
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;align-items:center;gap:3px';
    const circle=document.createElement('div');
    circle.style.cssText=`position:relative;width:${sz}px;height:${sz}px;border-radius:50%;
      background:rgba(9,13,20,.5);border:1px solid rgba(201,168,90,.28);
      display:flex;align-items:center;justify-content:center;overflow:hidden`;
    const icon=document.createElement('div');
    icon.style.cssText=`font-size:${Math.round(sz*0.48)}px;line-height:1;filter:drop-shadow(0 1px 2px #000)`;
    if(sk.img) icon.innerHTML=`<img src="${sk.img}" style="width:${Math.round(sz*0.72)}px;height:${Math.round(sz*0.72)}px;object-fit:contain">`;
    else icon.textContent=sk.ic;
    circle.appendChild(icon);
    const cd=document.createElement('div');
    cd.style.cssText='position:absolute;inset:0;border-radius:50%;background:conic-gradient(rgba(255,255,255,.42) 0deg, transparent 0deg);pointer-events:none';
    circle.appendChild(cd);
    const secs=document.createElement('div');
    secs.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;text-shadow:0 1px 3px #000';
    circle.appendChild(secs);
    const lbl=document.createElement('div');   // ★아래 = 스킬명
    lbl.style.cssText='font-size:10px;font-weight:800;color:#fff;text-shadow:0 1px 2px #000,0 0 3px #000;white-space:nowrap';
    lbl.textContent=sk.lb||sk.k;
    const keyEl=document.createElement('div');   // ★단축키(ref처럼)
    keyEl.style.cssText='font-size:9px;font-weight:700;color:#ffe28a;text-shadow:0 1px 2px #000;white-space:nowrap;margin-top:-1px';
    keyEl.textContent=sk.k;
    wrap.appendChild(circle); wrap.appendChild(lbl); wrap.appendChild(keyEl); bar.appendChild(wrap);
    return { sk, circle, cd, secs, icon, lbl };
  });

  let _shown=false, _combatUntil=0;   // _shown=현재 등장상태 / _combatUntil=어그로 끊긴 뒤 전투 유지 만료시각
  ctx.onUpdate(()=>{
    const P=ctx.player; if(!P) return;
    // ── 전투모드 감지: 살아있는 몬스터 중 하나라도 어그로 → 전투 ON. 마지막 어그로 이후 3s 유예(깜빡임 방지) ──
    const _now=performance.now();
    if((ctx.monsters||[]).some(m=>!m.dead && m.aggro) || P.weaponOut) _combatUntil=_now+3000;   // ⚔️ 몬스터 어그로 or V 발도(전투모드) = 스킬바 표시(사령관: V 켰는데 스킬창 안 뜸)
    const inCombat=_now<_combatUntil;
    if(inCombat!==_shown){ _shown=inCombat; ctx.inCombat=inCombat;
      bar.style.opacity   = inCombat ? '1' : '0';
      bar.style.transform = inCombat ? 'translateY(0) scale(1)' : 'translateY(30px) scale(.92)'; }   // 등장(↑)/퇴장(↓)
    if(!inCombat) return;   // 비전투 = 숨김 + 슬롯 갱신 스킵
    for(const s of slots){
      // ── 충전형 슬롯(기사 충격파): 가드 게이지 차오름 표시 + 가득 시 발광 ──
      if(s.sk.charge==='guard'){ const C=ctx.combat; const cur=C?C.guardCharge:0, mx=(C&&C.guardMax)||100; const rdy=cur>=mx;
        const pct=Math.round(Math.min(1,cur/mx)*100);
        s.cd.style.background='transparent'; s.secs.textContent='';   // ★배경이 차는 게 아니라 아이콘(스킬) 자체가 흰색으로 채워짐
        const baseImg=s.icon.querySelector('img');
        // 흰색 채움 오버레이 = 같은 아이콘을 순백으로 겹쳐, clip-path로 밑에서 pct%만 드러냄(차오름)
        if(!s._fill && baseImg){ const fi=baseImg.cloneNode(true);
          fi.style.cssText=baseImg.style.cssText+';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;';
          s.icon.style.position='relative'; s.icon.appendChild(fi); s._fill=fi; }
        if(baseImg){ baseImg.style.opacity='1'; baseImg.style.filter='brightness(.3) grayscale(1)'; }   // 빈 부분 = 어두운 윤곽
        if(s._fill) s._fill.style.clipPath=`inset(${100-pct}% 0 0 0)`;                                   // 흰색은 밑에서부터 차오름
        if(rdy){ const pulse=0.5+0.5*Math.sin(performance.now()/170); const g=16+pulse*18;
          s.circle.style.boxShadow=`0 0 ${g}px ${4+pulse*6}px rgba(255,198,64,${0.85+pulse*0.15}), 0 0 ${g*2.0}px rgba(255,140,30,.6), 0 2px 7px rgba(0,0,0,.55)`;
          s.circle.style.background='rgba(28,18,4,.72)'; s.circle.style.border=`2px solid rgba(255,214,90,${0.8+pulse*0.2})`; s.circle.style.transform=`scale(${1+pulse*0.08})`;
          if(s._fill) s._fill.style.filter='brightness(0) invert(1) drop-shadow(0 0 6px rgba(255,221,120,1))'; }   // 완료 = 전체 흰색 + 금빛 발광
        else { s.circle.style.boxShadow='inset 0 0 9px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.45)'; s.circle.style.background='rgba(9,13,20,.66)'; s.circle.style.border='1px solid rgba(255,255,255,.16)'; s.circle.style.transform='scale(1)';
          if(s._fill) s._fill.style.filter='brightness(0) invert(1) drop-shadow(0 0 2px rgba(190,225,255,.7))'; }   // 충전중 = 흰색(어두운 배경 대비)
        continue; }
      let st=null;
      if(s.sk.cd==='atk') st=P.atkCD; else if(s.sk.cd==='skill') st=P.skillCD;
      const ready = st ? (st.ready!==false) : true;   // cd 없는 슬롯=항상 준비
      // 쿨다운 흰 오버레이 + 남은초
      if(st && !ready){ const t=(st.t==null?1:st.t), deg=Math.round((1-t)*360);
        s.cd.style.background=`conic-gradient(rgba(255,255,255,.42) ${deg}deg, transparent ${deg}deg)`;
        s.secs.textContent=(st.secs&&st.secs>0.1)?st.secs.toFixed(1):''; }
      else { s.cd.style.background='transparent'; s.secs.textContent=''; }
      // 쿨다운=어둡게 / 준비=밝게. ★활성 광원(글로우)은 마법사만.
      if(!ready){ s.circle.style.boxShadow='0 2px 6px rgba(0,0,0,.45)'; s.icon.style.opacity='.5'; s.icon.style.filter='grayscale(.7) brightness(.5) drop-shadow(0 1px 2px #000)'; }
      else if(isMage){ const active=st&&st.active;
        s.circle.style.boxShadow = active ? '0 0 16px 3px rgba(255,212,90,.85), 0 2px 6px rgba(0,0,0,.45)' : '0 0 13px 2px rgba(150,200,255,.6), 0 2px 6px rgba(0,0,0,.45)';
        s.icon.style.opacity='1'; s.icon.style.filter = active ? 'drop-shadow(0 0 6px rgba(255,220,120,.95))' : 'drop-shadow(0 0 6px rgba(150,200,255,.85)) drop-shadow(0 1px 2px #000)'; }
      else { s.circle.style.boxShadow='0 2px 6px rgba(0,0,0,.45)'; s.icon.style.opacity='1'; s.icon.style.filter='drop-shadow(0 1px 2px #000)'; }   // 비마법사=광원 없음
      // 라이브(마법사 스킬): Q전환 시 이름·이미지 갱신
      if(s.sk.live && st){ if(st.label) s.lbl.textContent=st.label;
        if(s.sk.imgFire){ const im=s.icon.querySelector('img'); if(im) im.src=(st.icon==='🧊')?s.sk.imgIce:s.sk.imgFire; }
        else if(st.icon && !s.sk.img) s.icon.textContent=st.icon; }
    }
  });
  // 라이브 튜닝 훅 — 콘솔서 배경 투명도/크기 즉시 조정. 예: __sbTune({bg:0.2}) / __sbTune({size:50})
  if(typeof window!=='undefined') window.__sbTune=(o={})=>{ for(const s of slots){ if(o.bg!=null) s.circle.style.background=`rgba(8,12,20,${o.bg})`; if(o.size){ s.circle.style.width=o.size+'px'; s.circle.style.height=o.size+'px'; } } return 'ok'; };

  // ── 🧪 테스트용 클래스 스위처 (sandbox 전용) — 숫자키 3~7로 직업 변경(?char= 리로드). 상단 단축키 바 표시. ──
  if((location.pathname||'').includes('sandbox')){
    const CLS=[['knight','기사','3'],['barbarian','전사','4'],['mage','마법사','5'],['ranger','레인저','6'],['rogue_hooded','로그','7']];
    const switchTo=c=>{ const u=new URL(location.href); u.searchParams.set('char',c); location.href=u.toString(); };
    const top=document.createElement('div'); top.id='_clsswitch';
    top.style.cssText=`position:fixed;top:88px;left:50%;transform:translateX(-50%);z-index:60;display:flex;gap:6px;
      font:11px Pretendard,system-ui,sans-serif;pointer-events:auto;user-select:none`;
    top.innerHTML=`<span style="align-self:center;color:#9fb6d4;margin-right:4px">클래스</span>`+
      CLS.map(([k,nm,key])=>{ const on=(k===charKey)||(k==='rogue_hooded'&&charKey==='rogue');
        return `<button data-c="${k}" style="cursor:pointer;border:1px solid ${on?'#ffe28a':'rgba(255,255,255,.25)'};
          background:${on?'rgba(255,226,138,.18)':'rgba(20,28,40,.55)'};color:${on?'#ffe28a':'#cfe6ff'};
          border-radius:6px;padding:3px 9px;font-weight:700;font-size:11px">[${key}] ${nm}</button>`; }).join('');
    document.body.appendChild(top);
    top.querySelectorAll('button').forEach(b=>b.onclick=()=>switchTo(b.dataset.c));
    addEventListener('keydown',e=>{ if(e.repeat || !window.__testMode) return; const m={Digit3:'knight',Digit4:'barbarian',Digit5:'mage',Digit6:'ranger',Digit7:'rogue_hooded'};   // ⌨️ 캐릭터 전환=테스트모드(Ctrl+Shift+K) 전용 — 일반 게임 Digit3~7 퀵슬롯과 겹치던 것 차단
      if(m[e.code]) switchTo(m[e.code]); });
  }
  console.log('[skillbar] '+cls.name+' ('+cls.skills.length+'슬롯, ref 배치)');
}
