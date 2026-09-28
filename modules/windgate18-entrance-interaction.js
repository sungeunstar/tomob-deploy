/** Windgate 18 — generic "E to enter instance" interaction for the mine entrance. */
import * as THREE from 'three';
import {BUILDINGS} from './aurora-expedition-layout.js';

export function initMineEntranceInteraction18(ctx,island){
  const mine=BUILDINGS.find(b=>b.id==='mine')||{x:-112,z:-48};
  const approach=island.field.points.find(p=>p.id==='mine-yard17')||island.field.points.find(p=>p.id==='cave')||{x:-97,z:-34};
  const dx=mine.x-approach.x,dz=mine.z-approach.z,L=Math.hypot(dx,dz)||1,fx=dx/L,fz=dz/L;
  const trigger={x:mine.x-fx*7.1,z:mine.z-fz*7.1,r:4.2};
  const wrap=document.createElement('div');
  wrap.innerHTML='<span style="display:inline-grid;place-items:center;width:30px;height:30px;border:1px solid #ffffff70;border-radius:6px;background:#0d2025e8;font-weight:700;margin-right:10px">E</span><span>바위그늘 광산 들어가기</span>';
  Object.assign(wrap.style,{position:'fixed',left:'50%',bottom:'92px',transform:'translateX(-50%)',zIndex:'45',display:'none',alignItems:'center',padding:'10px 14px',background:'#132a30e8',border:'1px solid #ffffff2b',borderRadius:'8px',color:'#efe8d5',font:'14px system-ui,sans-serif',boxShadow:'0 10px 30px #0007',pointerEvents:'none'});
  document.body.appendChild(wrap);
  const fade=document.createElement('div');Object.assign(fade.style,{position:'fixed',inset:'0',zIndex:'9999',background:'#050707',opacity:'0',transition:'opacity 180ms ease',pointerEvents:'none'});document.body.appendChild(fade);
  let active=false,busy=false;
  const canEnter=()=>{const p=ctx.player?.pos;return !!p&&Math.hypot(p.x-trigger.x,p.z-trigger.z)<trigger.r;};
  const hook=ctx.onUpdate(()=>{if(busy)return;active=canEnter();wrap.style.display=active?'flex':'none';});
  async function enter(){
    if(!canEnter()||busy)return;busy=true;wrap.style.display='none';fade.style.opacity='1';
    const ret='./sandbox-aurora-v18.html?place=mine-yard17&from=mine';
    sessionStorage.setItem('tomob:last-instance','windgate-mine-01');
    sessionStorage.setItem('tomob:instance-return',ret);
    await new Promise(r=>setTimeout(r,220));
    location.href='./mine-windgate-01.html?return='+encodeURIComponent(ret);
  }
  const onKey=e=>{if(e.code!=='KeyE'||e.repeat||!canEnter())return;const mode=ctx.input?.mode?.();if(mode&&mode!=='foot')return;e.preventDefault();enter();};addEventListener('keydown',onKey);const offE=()=>removeEventListener('keydown',onKey);
  const prev=island.dispose;let dead=false;island.dispose=()=>{if(dead)return;dead=true;ctx.offUpdate(hook);offE?.();wrap.remove();fade.remove();prev();};
  island.mineEntrance18={trigger,enter,canEnter,get active(){return canEnter();}};
  return island.mineEntrance18;
}