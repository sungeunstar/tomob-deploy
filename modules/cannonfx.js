// cannonfx.js — ⚓ 대포 "제대로" VFX (격리 하네스 _vfx_cannon.html 승인본 이식, 사령관 2026-07-10)
//   · 머즐 = 회백 화약연기(늘어남+난류) + 소수 잔불
//   · 착탄 = 묵직: 어두운 먼지폭발(무게 핵심) + 큰 판자 조각 + 작은 파편 + 소수 잔불 + 뒤이은 연기 + 화면 킥
//   ★규칙 준수(feedback_threejs_no_cheap_fx): 파편·판자·잔불 = 실제 메시(속도·중력·회전 적분).
//     연기 = 노이즈 알파 텍스처 빌보드(비균일 stretch + 난류 churn + 저불투명 다중겹침). 싸구려 Points/균일원 아님.
//   ★라이트 재컴파일 함정(voyage-light-recompile-trap) 회피 — 새 PointLight 안 만듦. 발광은 additive + (게임 블룸 있으면)블룸.
//   재사용: ctx.scene · ctx.onUpdate · ctx.player.camShake · ctx.water.level.
import * as THREE from 'three';

export function initCannonFx(ctx){
  const scene = ctx.scene;
  const active = [];
  ctx.onUpdate(dt=>{ for(let i=active.length-1;i>=0;i--){ if(!active[i].update(dt)) active.splice(i,1); } });
  const WL = ()=> (ctx.water ? (ctx.water.level||0) : 0);
  const kick = a => { try{ ctx.player && ctx.player.camShake && ctx.player.camShake(a); }catch(_){} };

  // ── 텍스처 ──
  function radial(size, stops){
    const cv=document.createElement('canvas'); cv.width=cv.height=size;
    const g=cv.getContext('2d'); const gr=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    for(const [o,c] of stops) gr.addColorStop(o,c); g.fillStyle=gr; g.fillRect(0,0,size,size);
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  function smokeTex(size=256){   // 불규칙 구름(깨끗한 원 탈피) — 소프트 블롭 다중 겹침 + 가장자리 페이드
    const cv=document.createElement('canvas'); cv.width=cv.height=size;
    const g=cv.getContext('2d'); const cx=size/2, cy=size/2;
    for(let i=0;i<52;i++){ const a=Math.random()*Math.PI*2, rad=Math.pow(Math.random(),0.55)*size*0.42;
      const x=cx+Math.cos(a)*rad, y=cy+Math.sin(a)*rad, r=size*(0.05+Math.random()*0.17);
      const al=0.05+Math.random()*0.11, gr=g.createRadialGradient(x,y,0,x,y,r);
      gr.addColorStop(0,`rgba(255,255,255,${al})`); gr.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=gr; g.fillRect(x-r,y-r,r*2,r*2); }
    const mask=g.createRadialGradient(cx,cy,size*0.08,cx,cy,size*0.5);
    mask.addColorStop(0,'rgba(0,0,0,1)'); mask.addColorStop(0.65,'rgba(0,0,0,0.65)'); mask.addColorStop(1,'rgba(0,0,0,0)');
    g.globalCompositeOperation='destination-in'; g.fillStyle=mask; g.fillRect(0,0,size,size);
    g.globalCompositeOperation='source-over';
    const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
  }
  const TEX_SMOKE=smokeTex(256), TEX_GLOW=radial(128,[[0,'rgba(255,255,255,1)'],[0.3,'rgba(255,220,150,0.95)'],[0.7,'rgba(255,120,40,0.5)'],[1,'rgba(120,30,0,0)']]);

  // ── 풀(전부 씬 상주·visible 토글, add/remove 없음) ──
  const mkPool=(n,maker)=>{ const arr=[]; for(let i=0;i<n;i++){ const o=maker(); o.visible=false; scene.add(o); arr.push(o); } let i=0; return ()=>arr[i++%n]; };
  const grabSmoke = mkPool(260, ()=>new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_SMOKE, transparent:true, depthWrite:false, opacity:0 })));
  const grabFlash = mkPool(16,  ()=>new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_GLOW, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, color:0xffe0a8 })));
  const sparkGeo=new THREE.BoxGeometry(0.05,0.05,0.55);
  const grabSpark = mkPool(220, ()=>new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending })));
  const splGeoA=new THREE.BoxGeometry(0.09,0.09,0.7), splGeoB=new THREE.BoxGeometry(0.22,0.06,0.32);
  let _si=0; const splArr=[]; for(let i=0;i<200;i++){ const m=new THREE.Mesh(i%2?splGeoB:splGeoA, new THREE.MeshStandardMaterial({ roughness:0.95 })); m.visible=false; scene.add(m); splArr.push(m); }
  const grabSpl=()=>splArr[_si++%splArr.length];
  const chunkGeo=new THREE.BoxGeometry(0.34,0.12,1.2);
  const grabChunk = mkPool(48, ()=>new THREE.Mesh(chunkGeo, new THREE.MeshStandardMaterial({ roughness:0.95 })));
  const WOOD=[0x7a5230,0x6b4a2b,0x8a6238,0x5a3d22,0x9a7040];

  const _spUp=new THREE.Vector3(0,0,1), _spDir=new THREE.Vector3();

  // ── 연기 기둥 — 비균일 stretch + 난류 + 저불투명 다중겹침 ──
  function smokePlume(pos, { count=14, dark=0.55, rise=2.2, spread=1.6, size=[1.2,3.0], life=[1.7,3.0], drift=null }={}){
    for(let i=0;i<count;i++){ const s=grabSmoke(); s.visible=true;
      const ang=Math.random()*Math.PI*2, r=Math.random()*spread;
      s.position.set(pos.x+Math.cos(ang)*r, pos.y+(Math.random()-0.2)*spread*0.5, pos.z+Math.sin(ang)*r);
      const s0=size[0]+Math.random()*(size[1]-size[0]), asp=0.62+Math.random()*0.7, L=life[0]+Math.random()*(life[1]-life[0]);
      const vx=(drift?drift.x:0)+(Math.random()-0.5)*1.1, vy=rise*(0.5+Math.random()*0.8), vz=(drift?drift.z:0)+(Math.random()-0.5)*1.1;
      const rot0=Math.random()*Math.PI*2, rotV=(Math.random()-0.5)*0.55, ph=Math.random()*6, peak=0.30+Math.random()*0.16;
      const g0=dark+(Math.random()-0.5)*0.14; s.material.color.setRGB(g0,g0*0.99,g0*0.96);
      let t=0;
      active.push({ update(dt){ t+=dt; const k=t/L; const turb=Math.sin(t*1.7+ph)*0.6;
        s.position.x+=(vx+turb)*dt; s.position.y+=vy*dt*(1-k*0.4); s.position.z+=(vz+Math.cos(t*1.5+ph)*0.6)*dt;
        const gs=s0*(0.42+k*2.1); s.scale.set(gs*asp, gs/asp, 1); s.material.rotation=rot0+rotV*t;
        s.material.opacity = k<0.15 ? (k/0.15)*peak : Math.max(0,peak*(1-(k-0.15)/0.85));
        if(k>=1){ s.visible=false; return false; } return true; } }); }
  }
  // ── 묵직한 먼지 폭발(무게 핵심) — 짙고 어두운 먼지 급감속 ──
  function dustBurst(pos, dir, count=15){
    const n=dir.clone().normalize();
    for(let i=0;i<count;i++){ const s=grabSmoke(); s.visible=true;
      s.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*1.2,(Math.random()-0.2)*1.0,(Math.random()-0.5)*1.2));
      const s0=1.4+Math.random()*2.4, asp=0.6+Math.random()*0.8, L=0.75+Math.random()*0.9;
      const out=n.clone().multiplyScalar(6+Math.random()*11).addScaledVector(new THREE.Vector3(0,1,0),1+Math.random()*3);
      out.x+=(Math.random()-0.5)*6; out.z+=(Math.random()-0.5)*6;
      const rot0=Math.random()*6, rotV=(Math.random()-0.5)*0.8, g0=0.24+Math.random()*0.12, peak=0.5+Math.random()*0.22;
      s.material.color.setRGB(g0*1.08,g0*0.9,g0*0.74); let t=0;
      active.push({ update(dt){ t+=dt; const k=t/L; const damp=Math.max(0,1-k*1.7);
        s.position.x+=out.x*dt*damp; s.position.y+=out.y*dt*damp*0.7; s.position.z+=out.z*dt*damp;
        const gs=s0*(0.6+k*2.3); s.scale.set(gs*asp, gs/asp, 1); s.material.rotation=rot0+rotV*t;
        s.material.opacity = k<0.08 ? (k/0.08)*peak : Math.max(0,peak*(1-(k-0.08)/0.92));
        if(k>=1){ s.visible=false; return false; } return true; } }); }
  }
  // ── 잔불(엠버 스트릭) — 속도방향 늘어난 발광 조각, 무겁게 떨어짐(불꽃놀이 X) ──
  function sparkBurst(pos, dir, count=8){
    const n=dir.clone().normalize(), up=new THREE.Vector3(0,1,0);
    let tan=new THREE.Vector3().crossVectors(n,up); if(tan.lengthSq()<0.05) tan.set(1,0,0); tan.normalize();
    const bit=new THREE.Vector3().crossVectors(n,tan).normalize();
    for(let i=0;i<count;i++){ const m=grabSpark(); m.visible=true; m.position.copy(pos);
      const spd=7+Math.random()*15;
      const v=n.clone().multiplyScalar(0.5+Math.random()).addScaledVector(tan,(Math.random()-0.5)*1.1).addScaledVector(bit,(Math.random()-0.5)*1.1).addScaledVector(up,0.2+Math.random()*0.7).normalize().multiplyScalar(spd);
      let vy=v.y,t=0; const L=0.24+Math.random()*0.4, len=0.5+Math.random()*1.0;
      active.push({ update(dt){ t+=dt; const k=t/L; vy-=46*dt; v.y=vy;
        m.position.x+=v.x*dt; m.position.y+=v.y*dt; m.position.z+=v.z*dt;
        _spDir.set(v.x,v.y,v.z); const sp=_spDir.length()||1; _spDir.multiplyScalar(1/sp);
        m.quaternion.setFromUnitVectors(_spUp,_spDir); m.scale.set(1,1,len*Math.min(2.0,sp/13));
        const c=1-k; m.material.color.setRGB(1,0.42+0.4*c,0.06+0.2*c); m.material.opacity=Math.max(0,c*0.8);
        if(k>=1){ m.visible=false; return false; } return true; } }); }
  }
  // ── 작은 나무 파편 ──
  function splinterBurst(pos, dir, count=16){
    const n=dir.clone().normalize(), up=new THREE.Vector3(0,1,0);
    let tan=new THREE.Vector3().crossVectors(n,up); if(tan.lengthSq()<0.1) tan.set(1,0,0); tan.normalize();
    const bit=new THREE.Vector3().crossVectors(n,tan).normalize(); const wl=WL();
    for(let i=0;i<count;i++){ const m=grabSpl(); m.visible=true;
      m.material.color.setHex(WOOD[(Math.random()*WOOD.length)|0]);
      m.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*1.4,(Math.random()-0.5)*1.4,(Math.random()-0.5)*1.4));
      m.rotation.set(Math.random()*6,Math.random()*6,Math.random()*6); m.scale.setScalar(0.7+Math.random());
      const v=n.clone().multiplyScalar(4+Math.random()*10).addScaledVector(tan,(Math.random()-0.5)*10.5).addScaledVector(bit,(Math.random()-0.5)*10.5).addScaledVector(up,3+Math.random()*9);
      const av=new THREE.Vector3((Math.random()-0.5)*18,(Math.random()-0.5)*18,(Math.random()-0.5)*18);
      let t=0, vy=v.y, settled=false; const life=1.6+Math.random()*1.2;
      active.push({ update(dt){ t+=dt;
        if(!settled){ vy-=18*dt; m.position.x+=v.x*dt; m.position.y+=vy*dt; m.position.z+=v.z*dt;
          m.rotation.x+=av.x*dt; m.rotation.y+=av.y*dt; m.rotation.z+=av.z*dt;
          if(m.position.y<=wl+0.15){ m.position.y=wl+0.15; settled=true; waterSplash(m.position.x,m.position.z,3,0.55); } }
        else { m.position.y=wl+0.12+Math.sin(t*2+i)*0.06; m.rotation.z+=0.3*dt; }
        if(t>=life){ const k=(t-life)/0.5; if(k>=1){ m.visible=false; return false; } }
        return true; } }); }
  }
  // ── 큰 판자 조각(무거운 잔해) ──
  function chunkBurst(pos, dir, count=4){
    const n=dir.clone().normalize(), up=new THREE.Vector3(0,1,0); const wl=WL();
    for(let i=0;i<count;i++){ const m=grabChunk(); m.visible=true;
      m.material.color.setHex(WOOD[(Math.random()*WOOD.length)|0]);
      m.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*1.8,(Math.random()-0.5)*1.2,(Math.random()-0.5)*1.8));
      m.rotation.set(Math.random()*6,Math.random()*6,Math.random()*6); m.scale.setScalar(0.8+Math.random()*0.8);
      const v=n.clone().multiplyScalar(3+Math.random()*7).addScaledVector(up,2.5+Math.random()*6);
      v.x+=(Math.random()-0.5)*5; v.z+=(Math.random()-0.5)*5;
      const av=new THREE.Vector3((Math.random()-0.5)*9,(Math.random()-0.5)*9,(Math.random()-0.5)*9);
      let vy=v.y,t=0,settled=false; const life=2.0+Math.random()*1.2;
      active.push({ update(dt){ t+=dt;
        if(!settled){ vy-=20*dt; m.position.x+=v.x*dt; m.position.y+=vy*dt; m.position.z+=v.z*dt;
          m.rotation.x+=av.x*dt; m.rotation.y+=av.y*dt; m.rotation.z+=av.z*dt;
          if(m.position.y<=wl+0.2){ m.position.y=wl+0.2; settled=true; waterSplash(m.position.x,m.position.z,12,1.4); } }
        else { m.position.y=wl+0.16+Math.sin(t*1.6+i)*0.05; m.rotation.z+=0.2*dt; }
        if(t>=life){ const k=(t-life)/0.6; if(k>=1){ m.visible=false; return false; } }
        return true; } }); }
  }
  // ── 섬광(짧은 발광 팝) ──
  function flash(pos, size, life){ const s=grabFlash(); s.position.copy(pos); s.visible=true; let t=0;
    active.push({ update(dt){ t+=dt; const k=t/life; s.scale.setScalar(size*(0.6+k*1.6)); s.material.opacity=Math.max(0,1-k);
      if(k>=1){ s.visible=false; return false; } return true; } }); }
  // ── 💦 수면 물보라 — 평면 확산 링 아님. 위로 튀는 흰 물보라 ──
  function waterSplash(x,z,n=9,sc=1){ const wl=WL();
    for(let i=0;i<n;i++){ const s=grabSmoke(); s.visible=true;
      s.position.set(x+(Math.random()-0.5)*0.9*sc, wl+0.1, z+(Math.random()-0.5)*0.9*sc);
      const s0=(0.35+Math.random()*0.65)*sc; let yv=(3+Math.random()*4.5)*Math.sqrt(sc);
      const vx=(Math.random()-0.5)*2.6*sc, vz=(Math.random()-0.5)*2.6*sc, L=0.4+Math.random()*0.45; let t=0;
      s.material.rotation=Math.random()*6; s.material.color.setRGB(0.87,0.94,1.0);
      active.push({ update(dt){ t+=dt; const k=t/L; yv-=15*dt; s.position.x+=vx*dt; s.position.y+=yv*dt; s.position.z+=vz*dt;
        const gs=s0*(0.7+k*0.7); s.scale.set(gs, gs*1.25, 1);
        s.material.opacity=Math.max(0,(k<0.2?k/0.2:1-(k-0.2)/0.8)*0.72);
        if(k>=1){ s.visible=false; return false; } return true; } }); }
  }

  // ── 합성 이벤트 ──
  //   muzzle: 포연(회백)+소수 잔불 (+shake=플레이어 발사만)
  function muzzle(pos, dir, shake=0, scale=1){   // scale=머즐 크기(섬광·포연·잔불 비례 확대). 4번째 인자 = 기존 호출 무영향.
    const fp=pos.clone().addScaledVector(dir,1.0);
    flash(fp, 2.4*scale, 0.10);
    smokePlume(fp, { count:Math.round(9*scale), dark:0.66, rise:1.8*scale, spread:1.2*scale, size:[1.2*scale,2.6*scale], life:[1.3,2.3], drift:{x:dir.x*5,z:dir.z*5} });
    sparkBurst(fp, dir, Math.round(5*scale));
    if(shake) kick(shake);
  }
  //   impact: 먼지폭발+큰판자+파편+소수잔불+연기 (+shake)
  function impact(pos, dir, shake=0){
    const back=dir.clone().negate(), up=new THREE.Vector3(0,0.4,0);
    flash(pos, 1.6, 0.09);
    dustBurst(pos, back.clone().add(up), 15);
    chunkBurst(pos, back.clone().add(up), 4);
    splinterBurst(pos, back.clone().add(new THREE.Vector3(0,0.3,0)), 15);
    sparkBurst(pos, back.clone().add(new THREE.Vector3(0,0.5,0)), 8);
    smokePlume(pos, { count:11, dark:0.34, rise:1.8, spread:1.6, size:[1.8,3.6], life:[1.9,3.0] });
    if(shake) kick(shake);
  }

  ctx.cannonfx = { muzzle, impact, waterSplash, smokePlume, dustBurst, sparkBurst, splinterBurst, chunkBurst };
  console.log('[cannonfx] 대포 VFX 이식 — 머즐/착탄(먼지·판자·파편·잔불·연기) + 화면킥. 하네스 _vfx_cannon.html 승인본.');
  return ctx.cannonfx;
}
