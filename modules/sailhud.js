// sailhud.js — 조타 다이얼 HUD(바람-돛 맞추기). mas main.js 6868-6905 이식.
// 조타(ctx.ship.boarded) 중에만 표시: 나침반 카드(bowYaw) + 바람 화살(파랑) + 돛 화살(노랑) + 잡힘% + 러더바.
export function initSailhud(ctx){
  let hud=null, deck=null;
  const ICO=(n,sz=15)=>`<img src="/tomob-deploy/ui/icons/icon_${n}.png" style="height:${sz}px;vertical-align:-3px;margin-right:3px;filter:drop-shadow(0 1px 1px #000)">`;   // HUD 인라인 아이콘
  const BEAR16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];   // 16방위(침로 표시용)
  ctx.onUpdate(()=>{ const bs=ctx.ship; if(!bs) return;
    if(bs.boarded){
      if(!hud){ hud=document.createElement('div'); hud.id='boatHud';
        hud.style.cssText='position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:7;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;';
        hud.innerHTML=
          // ★침로 배지 = 가는 방향(16방위 + 각도). 헤딩업이라 12시=진행방향.
          '<div id="bhHeading" style="font:13px system-ui;color:#efe2bb;background:rgba(10,16,24,.78);border:1px solid rgba(185,146,63,.5);border-radius:8px;padding:3px 13px;white-space:nowrap;letter-spacing:.06em;text-shadow:0 1px 2px #000;"><span style="color:#9ab;font-size:11px;">방향</span> <b>N</b> <span style="color:#8aa;font-size:11px;">000°</span></div>'
          +'<div id="bhDial" style="position:relative;width:158px;height:158px;filter:drop-shadow(0 5px 16px rgba(0,0,0,.6));">'
          +'<img src="/tomob-deploy/dial_frame.png" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;">'
          +'<img id="bhRose" src="/tomob-deploy/dial_rose.png" style="position:absolute;left:50%;top:50%;width:70%;height:70%;transform:translate(-50%,-50%);transform-origin:50% 50%;pointer-events:none;">'
          // ★바람·돛 바늘 = 직접 그린 SVG(PNG 기본방향 제각각 문제 제거, 회전 정확 통제). 둘 다 회전 0 = 위(12시).
          //   바람화살(녹색)=풍향(12시 기준). 돛바늘=돛방향, 코드에서 +180 렌더 → 효율 100%일 때 바람 정반대(6시)를 가리킴.
          +'<svg id="bhNeedles" width="158" height="158" viewBox="0 0 158 158" style="position:absolute;inset:0;pointer-events:none;overflow:visible;">'
          // ★고정 뱃머리(진행방향) 마커 = 12시. 회전 안 함. "위 = 내가 가는 방향".
          +'  <polygon points="79,8 85,19 73,19" fill="#f2e6c2" stroke="#5a4520" stroke-width="0.9"/>'
          +'  <g id="bhDir"><polygon points="79,20 89,72 79,61 69,72" fill="#7fdc7f" stroke="#1d5a2c" stroke-width="1.2" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"/></g>'
          +'  <g id="bhSail"><line x1="79" y1="79" x2="79" y2="32" stroke="#caa86a" stroke-width="3.4" stroke-linecap="round"/>'
          +'    <path id="bhSailCloth" d="M79,36 q17,10 0,22 z" fill="#e9cf86" stroke="#7a5e23" stroke-width="0.9"/></g>'
          +'</svg>'
          +'<img src="/tomob-deploy/dial_hub.png" style="position:absolute;left:50%;top:50%;width:30px;height:30px;transform:translate(-50%,-50%);pointer-events:none;">'
          +'</div>'
          +'<div id="bhInfo" style="font:12px system-ui;color:#cfe0f0;background:rgba(10,16,24,.72);border-radius:8px;padding:3px 11px;white-space:nowrap;"></div>'
          // ⚡ 전력 항해 스태미나 게이지(Shift)
          +'<div style="display:flex;align-items:center;gap:6px;font:10px system-ui;color:#9aa;letter-spacing:.06em;"><span>⚡전력</span>'
          +'<div style="width:132px;height:8px;border-radius:5px;background:rgba(10,16,24,.8);border:1px solid rgba(120,180,255,.45);overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);">'
          +'<div id="bhBoostFill" style="height:100%;width:100%;background:linear-gradient(90deg,#3a86e8,#7fd0ff);transition:width .08s linear;"></div></div>'
          +'<span style="color:#8aa">Shift</span></div>'
          +'<div style="display:flex;align-items:center;gap:6px;font:10px system-ui;color:#9aa;letter-spacing:.08em;">'
          +'<span>◄좌현</span>'
          +'<div style="position:relative;width:128px;height:15px;border-radius:8px;background:rgba(10,16,24,.78);border:1px solid rgba(180,150,90,.55);box-shadow:inset 0 1px 4px rgba(0,0,0,.6);">'
          +'<div style="position:absolute;left:50%;top:2px;bottom:2px;width:2px;margin-left:-1px;background:rgba(255,255,255,.28);"></div>'
          +'<div id="bhRudKnob" style="position:absolute;left:50%;top:50%;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#ffe9a8,#9c6c1a);box-shadow:0 0 5px rgba(0,0,0,.7);transform:translate(-50%,-50%);transition:left .05s linear;"></div>'
          +'</div><span>우현►</span></div>';
        document.body.appendChild(hud);
      }
      const cf=bs.catchF||0, col=cf>0.7?'#7fdc7f':(cf>0.3?'#e2c46a':'#dc7f7f');
      const D=180/Math.PI, bowYaw=bs.bowYaw||0, windDir=bs.windDir||0;
      // ★수동 트림 다이얼: 바람화살=실제 풍향(뱃머리 기준 상대각), 돛바늘=현재 돛각. 둘을 맞추면 효율 100%.
      const windRel=(windDir-bowYaw)*D;          // 바람 방향(뱃머리 기준)
      const sailRel=(bs.sailAngle||0)*D;          // 돛 각도(뱃머리 기준)
      // 침로(가는 방향) = 뱃머리 절대 방위. ★N/S 반전 보정(forward −Z=북/+Z=남, E/W는 정상): 180−bowYaw.
      const headDeg=((180-bowYaw*D)%360+360)%360;
      const bh=document.getElementById('bhHeading'); if(bh) bh.innerHTML=ICO('compass',14)+'<span style="color:#9ab;font-size:11px;">방향</span> <b>'+BEAR16[Math.round(headDeg/22.5)%16]+'</b> <span style="color:#8aa;font-size:11px;">'+String(Math.round(headDeg)).padStart(3,'0')+'°</span>';
      const rk=document.getElementById('bhRudKnob'); if(rk) rk.style.left=(50+Math.max(-1,Math.min(1,bs.rudder||0))*40)+'%';
      const re=document.getElementById('bhRose'); if(re) re.style.transform='translate(-50%,-50%) rotate('+(-bowYaw*D).toFixed(1)+'deg)';
      // 바람화살 = 풍향(12시 기준). SVG rotate(각 79 79). 돛바늘 = sailRel+180 → 효율 100%(sailRel=windRel)일 때 바람 정반대.
      const dd=document.getElementById('bhDir'); if(dd) dd.setAttribute('transform','rotate('+windRel.toFixed(1)+' 79 79)');
      const se=document.getElementById('bhSail'); if(se){ se.setAttribute('transform','rotate('+(sailRel+180).toFixed(1)+' 79 79)');
        const cloth=document.getElementById('bhSailCloth'); if(cloth) cloth.setAttribute('fill', cf>0.7?'#7fdc7f':(cf>0.3?'#e2c46a':'#e9cf86')); }   // 돛 천 색 = 효율 피드백
      const anc=ICO('anchor',14)+(bs.anchored?'<b style="color:#f3d978">정박·T해제</b>':'<span style="color:#9ab">T 닻</span>');
      const ie=document.getElementById('bhInfo'); if(ie) ie.innerHTML=ICO('sail',15)+'<b style="color:#ffe2a0">돛</b> 효율 <b style="color:'+col+'">'+Math.round(cf*100)+'%</b> · 속도 '+Math.abs(bs.speed).toFixed(1)+(bs._boostOn?' <b style="color:#ffd24a">⚡전력</b>':'')+' <span style="color:#8aa">(A/D 조타 · W/S 돛 · Shift 전력 · '+anc+')</span>';
      // ⚡ 스태미나 게이지: 부스트 중=주황, 고갈 임박=빨강, 평시=파랑
      const bf=document.getElementById('bhBoostFill'); if(bf){ const b=bs.boost==null?1:bs.boost; bf.style.width=(b*100).toFixed(0)+'%';
        bf.style.background = bs._boostOn ? 'linear-gradient(90deg,#ffd24a,#ff9a3a)' : (b<0.25?'linear-gradient(90deg,#e8503a,#ff7a4a)':'linear-gradient(90deg,#3a86e8,#7fd0ff)'); }
      hud.style.display='flex';
    } else if(hud) hud.style.display='none';

    // ⚓ 갑판 위(조타 안 함) 조작 힌트 — Z 조타 / T 닻. 배에 올라탔을 때만.
    const onDeck = ctx.player && ctx.player._onShip===bs && !bs.boarded;
    if(onDeck){
      if(!deck){ deck=document.createElement('div'); deck.id='deckHint';
        deck.style.cssText='position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:7;font:13px system-ui;color:#efe2bb;background:rgba(10,16,24,.78);border:1px solid rgba(185,146,63,.5);border-radius:8px;padding:5px 14px;white-space:nowrap;letter-spacing:.04em;text-shadow:0 1px 2px #000;pointer-events:none;';
        document.body.appendChild(deck); }
      deck.innerHTML=ICO('helm')+'<b style="color:#ffe2a0">Z</b> 조타 · '+ICO('anchor')+'<b style="color:#ffe2a0">T</b> '
        + (bs.anchored?'<b style="color:#f3d978">닻 올리기(정박 중)</b>':'닻 내리기');
      deck.style.display='block';
    } else if(deck) deck.style.display='none';
  });
}
