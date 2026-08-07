// showcasefx.js — 캐릭터 선택화면(select.html) 쇼케이스 궁극기 VFX.
//   ★게임 모듈(player.js / magic.js / combat.js)의 실제 이펙트를 'verbatim 이식'한 것.
//    임시 재현(폐기된 fxShock 등) 금지 — 실제 게임에서 터지는 그 이펙트 그대로.
//   player.js  : shockwaveVFX / shockwaveDistort(기사) · windVFX(전사) · _cloakOn/_cloakOff(로그 은신)
//   magic.js   : makeFireball(마법사 궁극) · magicArrow(마법사 기본탄) · EL/FB_OPT_EL/FB 셰이더
//   combat.js  : arrow_bow.gltf 화살 투사체(레인저) + 크리 금색 글로우
//   ctx = { scene, renderer, camera, getModel():Object3D, FEET_Y, setRenderOverride, getRenderOverride }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const KW='/KayKit_Adventurers_2.0_FREE/Assets/gltf/';

// ── magic.js EL(속성색) verbatim ──
const EL = {
  fire: { core:0xffd27a, glow:0xff5a14, light:0xff7a30 },
  ice:  { core:0xcaf4ff, glow:0x39c8e6, light:0x57d0ee },
  rock: { core:0xe8d2a8, glow:0xb07a40, light:0xc89a5a },
};

export function initShowcaseFx(ctx){
  const { scene, renderer, camera } = ctx;
  const FEET_Y = ctx.FEET_Y ?? 0;
  let model = ctx.getModel ? ctx.getModel() : null;
  // ★게임의 avatar(발 높이=position.y) 대역 — 쇼케이스 모델은 발이 FEET_Y에 접지. 매 프레임 update()에서 동기화.
  const avatar = { position: new THREE.Vector3(0, FEET_Y, 0) };
  let _gen=0;   // 세대 토큰 — reset() 시 증가. 진행 중인 windVFX/충격파 RAF 루프가 즉시 자기정리하고 종료(캐릭터/단계 전환 잔상 방지).

  // ════════ 공용(player.js _softTex verbatim) ════════
  let _windTex=null;
  function _softTex(){ if(_windTex) return _windTex; const cv=document.createElement('canvas'); cv.width=cv.height=48; const c=cv.getContext('2d');
    const g=c.createRadialGradient(24,24,0,24,24,24); g.addColorStop(0,'rgba(225,242,255,1)'); g.addColorStop(0.4,'rgba(190,225,255,0.6)'); g.addColorStop(1,'rgba(190,225,255,0)');
    c.fillStyle=g; c.beginPath(); c.arc(24,24,24,0,7); c.fill(); _windTex=new THREE.CanvasTexture(cv); return _windTex; }

  // ════════ 전사 휠윈드 = WoW 블레이드스톰 — player.js windVFX verbatim ════════
  // 블레이드 크레센트 지오메트리 — 반경 r 둘레로 arcSpan(rad)만큼 휘어진 칼날 잔상. 꼬리=얇고 선단=두꺼운 초승달. u=꼬리0→선단1, v=폭(안0→밖1).
  function _bladeArcGeo(r, halfW, arcSpan, segs){
    const pos=new Float32Array((segs+1)*2*3), uv=new Float32Array((segs+1)*2*2); const idx=[];
    for(let i=0;i<=segs;i++){ const t=i/segs, a=-arcSpan*0.5+arcSpan*t, ca=Math.cos(a), sa=Math.sin(a), k=i*2;
      const w=halfW*(0.10+0.90*t), ri=r-w, ro=r+w;             // 꼬리로 갈수록 가늘어짐(초승달 칼날)
      pos[k*3]=ca*ri; pos[k*3+1]=0; pos[k*3+2]=sa*ri;             uv[k*2]=t; uv[k*2+1]=0;
      pos[(k+1)*3]=ca*ro; pos[(k+1)*3+1]=0; pos[(k+1)*3+2]=sa*ro; uv[(k+1)*2]=t; uv[(k+1)*2+1]=1; }
    for(let i=0;i<segs;i++){ const k=i*2; idx.push(k,k+1,k+2, k+1,k+3,k+2); }
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.BufferAttribute(uv,2)); g.setIndex(idx); return g; }
  // ★휠윈드 재작성(2026-07-02, ref/휠윈드.gif) = 쿨 화이트-블루 빛 리본 사이클론. 강철 크레센트/바닥링/칼날파편 전부 폐기(player.js 갱신본과 동일 이식).
  //   다층 나선 아크 리본(comet-tail 흐름 셰이더) 배럴 + 얼음 크리스탈 소수 + 살짝 상승 호흡. 경량 sin 흐름(fbm 없음), Points 없음. done+_gen+안전타임아웃 잔류0.
  function windVFX(dur){ if(typeof THREE==='undefined'||!avatar||!ctx.scene) return;
    const grp=new THREE.Group(); ctx.scene.add(grp); let done=false; const trash=[]; const myGen=_gen;
    const cleanup=()=>{ if(done) return; done=true; ctx.scene.remove(grp); trash.forEach(f=>{ try{ f(); }catch(_){} }); };
    // 빛 리본 셰이더 — vU.x=길이(0꼬리→1선단), vU.y=폭. 길이방향 흐름(빛 결) + comet 선단 + 꼬리 페이드. 청→흰 코어.
    const ribMat=(seed)=>new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      uniforms:{ uA:{value:0}, uT:{value:0}, uSeed:{value:seed} },
      vertexShader:'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:[
        'varying vec2 vU; uniform float uA,uT,uSeed;',
        'void main(){',
        '  float head=smoothstep(0.5,1.0,vU.x);',                             // 선단(밝은 코어)
        '  float tail=smoothstep(0.0,0.55,vU.x);',                           // 꼬리 페이드
        '  float wid=smoothstep(0.0,0.34,vU.y)*smoothstep(1.0,0.66,vU.y);',  // 폭 소프트 엣지
        '  float flow=0.62+0.38*sin(vU.x*20.0 - uT*12.0 + uSeed*6.283);',    // 길이방향 흐름(빛 결)
        '  float al=(tail*0.7+head*3.2)*wid*flow*uA;',                        // ★밀도·밝기 강화(레퍼=빽빽한 백열 토네이도)
        '  vec3 col=mix(vec3(0.45,0.74,1.0), vec3(1.0,1.0,1.0), head*head);', // 청 → 순백 코어
        '  if(al<0.004) discard; gl_FragColor=vec4(col, al);',
        '}'].join('\n') });
    // ① 배럴형 다층 나선 리본 — 높이별 반경(중간 넓고 상하 좁은 배럴) + 방향 교대 고속 회전. 긴 아크(span>π)로 감기는 나선.
    const ribs=[]; const NR=30;                                             // ★빽빽하게(레퍼=수십 겹 오버랩)
    for(let i=0;i<NR;i++){ const hf=(i%15)/14; const y=0.1+hf*2.25;          // 15겹×2세트 = 높이별 중첩
      const bar=0.5+0.5*Math.sin(hf*Math.PI);                               // 배럴 프로파일(상하 좁고 중간 넓음)
      const r=(1.35+0.75*bar)+(Math.random()-0.5)*0.28;
      const span=4.2+Math.random()*3.4;                                     // 한바퀴 이상 감기는 긴 나선
      const hw=0.11+Math.random()*0.12, spd=(18+Math.random()*13)*(i%2?-1:1), tilt=(Math.random()-0.5)*0.34;
      const m=ribMat(Math.random()); const mesh=new THREE.Mesh(_bladeArcGeo(r,hw,span,60), m);
      const pg=new THREE.Group(); pg.position.y=y; pg.rotation.y=Math.random()*6.283; pg.rotation.x=tilt; pg.add(mesh); grp.add(pg);
      ribs.push({pg,m,spd}); trash.push(()=>{ mesh.geometry.dispose(); m.dispose(); }); }
    // ② 얼음 크리스탈 소수 — 소용돌이에 섞여 궤도 회전 + 자전. 쿨 발광(additive).
    const icoGeo=new THREE.IcosahedronGeometry(0.07,0), icoMat=new THREE.MeshBasicMaterial({color:0xd4eeff, transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false});
    const crystals=[];
    for(let i=0;i<10;i++){ const m=new THREE.Mesh(icoGeo,icoMat); m.scale.setScalar(0.5+Math.random()*0.7); grp.add(m);
      crystals.push({m, a:Math.random()*6.283, r:1.4+Math.random()*0.8, y:0.4+Math.random()*1.9, spd:(2.6+Math.random()*2.0)*(i%2?-1:1), rx:(Math.random()-0.5)*9, rz:(Math.random()-0.5)*9}); }
    trash.push(()=>{ icoGeo.dispose(); icoMat.dispose(); });
    const start=performance.now(); let last=start;
    const step=()=>{ if(done || _gen!==myGen){ cleanup(); return; } const now=performance.now(); const dt=Math.min(0.05,(now-last)/1000); last=now; const t=(now-start)/dur, tS=(now-start)/1000;
      if(t>=1){ cleanup(); return; }
      const fade = t<0.08 ? t/0.08 : (t>0.85 ? (1-t)/0.15 : 1);              // 페이드 인/아웃
      const risY = Math.sin(t*Math.PI)*0.35;                                 // 살짝 상승 후 하강(토네이도 호흡)
      for(const b of ribs){ b.pg.rotation.y+=b.spd*dt; b.m.uniforms.uA.value=fade; b.m.uniforms.uT.value=tS; }
      for(const c of crystals){ c.a+=c.spd*dt; c.m.position.set(Math.cos(c.a)*c.r, c.y+risY, Math.sin(c.a)*c.r); c.m.rotation.x+=c.rx*dt; c.m.rotation.z+=c.rz*dt; }
      icoMat.opacity=0.9*fade;
      grp.position.set(avatar.position.x, avatar.position.y+risY*0.4, avatar.position.z);
      requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(cleanup, dur+400);   // ★안전 타임아웃 — rAF 정지 시에도 잔류 0
  }

  // ════════ 기사 화면왜곡 — player.js shockwaveDistort verbatim ════════
  function shockwaveDistort(){ if(typeof THREE==='undefined'||!ctx.renderer||!ctx.setRenderOverride||!avatar) return;
    const renderer=ctx.renderer, scene=ctx.scene, cam=ctx.camera;
    const sz=new THREE.Vector2(); renderer.getSize(sz); const dpr=renderer.getPixelRatio();
    const rt=new THREE.WebGLRenderTarget(Math.max(2,sz.x*dpr), Math.max(2,sz.y*dpr), {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter});
    const qScene=new THREE.Scene(), qCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const mat=new THREE.ShaderMaterial({ depthTest:false, depthWrite:false,
      uniforms:{ tDiffuse:{value:rt.texture}, uCenter:{value:new THREE.Vector2(0.5,0.5)}, uRadius:{value:0}, uWidth:{value:0.055}, uStrength:{value:0}, uAspect:{value:sz.x/Math.max(1,sz.y)} },
      vertexShader:'varying vec2 vU; void main(){ vU=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader:[
        'varying vec2 vU; uniform sampler2D tDiffuse; uniform vec2 uCenter; uniform float uRadius,uWidth,uStrength,uAspect;',
        'void main(){',
        '  vec2 d=vU-uCenter; d.x*=uAspect; float dist=length(d); float diff=dist-uRadius;',
        '  float ring=smoothstep(uWidth,0.0,abs(diff));',
        '  vec2 dir = dist>1e-4 ? normalize(d) : vec2(0.0); dir.x/=uAspect;',
        '  vec2 off = dir*ring*uStrength*sign(diff);',
        '  vec3 col = texture2D(tDiffuse, vU-off).rgb;',
        '  col += vec3(0.55,0.78,1.0)*ring*0.12;',
        '  col = pow(clamp(col,0.0,1.0), vec3(0.4545));',
        '  gl_FragColor=vec4(col,1.0);',
        '}'].join('\n') });
    const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat); qScene.add(quad);
    const prev=ctx.getRenderOverride?ctx.getRenderOverride():null;
    const wp=new THREE.Vector3(); const DUR=620, start=performance.now(); const myGen=_gen;
    ctx.setRenderOverride(()=>{
      wp.set(avatar.position.x, avatar.position.y+0.6, avatar.position.z).project(cam);
      mat.uniforms.uCenter.value.set(wp.x*0.5+0.5, wp.y*0.5+0.5);
      renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
      renderer.render(qScene, qCam);
    });
    const step=()=>{ const t=(performance.now()-start)/DUR;
      if(t>=1 || _gen!==myGen){ ctx.setRenderOverride(prev||null); rt.dispose(); mat.dispose(); quad.geometry.dispose(); return; }
      mat.uniforms.uRadius.value = t*0.78;
      mat.uniforms.uStrength.value = 0.11*(1.0-t)*(t<0.12? t/0.12:1.0);
      requestAnimationFrame(step); };
    requestAnimationFrame(step); }

  // ════════ 기사 충격파 — player.js shockwaveVFX verbatim ════════
  function shockwaveVFX(){ if(typeof THREE==='undefined'||!avatar||!ctx.scene) return;
    const ox=avatar.position.x, oy=avatar.position.y+0.04, oz=avatar.position.z;
    const DUR=920, S=ctx.scene, cam=ctx.camera; const trash=[]; let done=false; const myGen=_gen;
    const cleanup=()=>{ if(done) return; done=true; trash.forEach(f=>{ try{ f(); }catch(_){} }); };
    const NOISE = [
      'float h21(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }',
      'vec2 h22(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }',
      'float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);',
      '  float a=h21(i),b=h21(i+vec2(1,0)),c=h21(i+vec2(0,1)),d=h21(i+vec2(1,1)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }',
      'float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; } return s; }'].join('\n');
    const GV='varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
    // ① 저공 난류 연기 스윕(금빛)
    const smokeMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0},uT:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;','uniform float uP,uT;','void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p); float ang=atan(p.y,p.x);',
        '  vec2 q=vec2(ang*1.7, r*3.2 - uT*1.3);',
        '  float n=fbm(q + vec2(fbm(q*0.5+uT*0.2),0.0));',
        '  float ann=smoothstep(uP*1.12+0.18, uP*1.12-0.4, r)*smoothstep(0.02,0.28,r);',
        '  float smoke=pow(max(n,0.0),1.7)*ann;',
        '  float fade=1.0-smoothstep(0.35,1.0,uP);',
        '  float al=smoke*fade*1.15; if(r>1.0) al=0.0;',
        '  vec3 col=mix(vec3(0.55,0.30,0.09), vec3(1.0,0.80,0.40), pow(n,1.3));',
        '  gl_FragColor=vec4(col*al, al);','}'].join('\n') });
    const smoke=new THREE.Mesh(new THREE.PlaneGeometry(17,17), smokeMat); smoke.rotation.x=-Math.PI/2; smoke.position.set(ox,oy+0.015,oz); S.add(smoke);
    trash.push(()=>{ S.remove(smoke); smoke.geometry.dispose(); smokeMat.dispose(); });
    // ② 지면 보로노이 균열망
    const crackMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;','uniform float uP;','void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p);',
        '  vec2 gp=p*4.5; vec2 g=floor(gp), f=fract(gp);',
        '  float d1=9.0,d2=9.0;',
        '  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 o=vec2(float(x),float(y)); vec2 pt=o+h22(g+o)-f; float d=dot(pt,pt); if(d<d1){d2=d1;d1=d;} else if(d<d2){d2=d;} }',
        '  float edge=sqrt(d2)-sqrt(d1);',
        '  float cr=smoothstep(0.14,0.0,edge);',
        '  float front=uP*1.1;',
        '  float reveal=smoothstep(front,front-0.22,r);',
        '  float hot=smoothstep(0.32,0.0,abs(r-front));',
        '  float fade=1.0-smoothstep(0.5,1.0,uP);',
        '  float al=cr*reveal*fade*(0.55+hot*1.5); if(r>1.0) al=0.0;',
        '  vec3 col=mix(vec3(0.95,0.62,0.20), vec3(1.0,0.97,0.88), hot);',
        '  gl_FragColor=vec4(col*al, al);','}'].join('\n') });
    const crack=new THREE.Mesh(new THREE.PlaneGeometry(15,15), crackMat); crack.rotation.x=-Math.PI/2; crack.position.set(ox,oy+0.03,oz); S.add(crack);
    trash.push(()=>{ S.remove(crack); crack.geometry.dispose(); crackMat.dispose(); });
    // ③ 지면 난류 링(웜골드 충격 선단)
    const ringMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;','uniform float uP;','void main(){',
        '  vec2 p=vU-0.5; float r=length(p)*2.0; float a=atan(p.y,p.x);',
        '  float wob=0.045*sin(a*12.0+uP*5.0)+0.028*sin(a*23.0-uP*3.0);',
        '  float R=0.05+uP*1.15+wob; float dist=abs(r-R);',
        '  float edge=smoothstep(0.05,0.0,dist);',
        '  float band=smoothstep(0.22,0.0,dist);',
        '  float fade=1.0-smoothstep(0.5,1.0,uP);',
        '  float al=(edge*1.5+band*0.42)*fade; if(r>1.3) al=0.0;',
        '  vec3 col=mix(vec3(0.98,0.70,0.26), vec3(1.0,0.98,0.90), edge);',
        '  gl_FragColor=vec4(col,al);','}'].join('\n') });
    const ring=new THREE.Mesh(new THREE.PlaneGeometry(13,13), ringMat); ring.rotation.x=-Math.PI/2; ring.position.set(ox,oy+0.045,oz); S.add(ring);
    trash.push(()=>{ S.remove(ring); ring.geometry.dispose(); ringMat.dispose(); });
    // ④ 세로 광선 기둥(교차 2평면)
    const pillarMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0},uT:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[NOISE,
        'varying vec2 vU;','uniform float uP,uT;','void main(){',
        '  float x=abs(vU.x-0.5)*2.0; float y=vU.y;',
        '  float flick=fbm(vec2(x*3.0, y*7.0-uT*4.5));',
        '  float core=smoothstep(1.0,0.0, x + flick*0.35*y);',
        '  float taper=smoothstep(1.0,0.12,y)*smoothstep(0.0,0.06,y);',
        '  float rise=smoothstep(0.0,0.12,uP)*(1.0-smoothstep(0.42,0.9,uP));',
        '  float al=core*taper*(0.55+flick*0.6)*rise*1.2;',
        '  vec3 col=mix(vec3(0.98,0.64,0.22), vec3(1.0,0.98,0.92), core*taper);',
        '  gl_FragColor=vec4(col*al, al);','}'].join('\n') });
    const pgeo=new THREE.PlaneGeometry(2.3,7.0,1,1); pgeo.translate(0,3.5,0);
    const pil1=new THREE.Mesh(pgeo,pillarMat); pil1.position.set(ox,oy,oz);
    const pil2=new THREE.Mesh(pgeo,pillarMat); pil2.position.set(ox,oy,oz); pil2.rotation.y=Math.PI/2;
    S.add(pil1); S.add(pil2);
    trash.push(()=>{ S.remove(pil1); S.remove(pil2); pgeo.dispose(); pillarMat.dispose(); });
    // ⑤ 방사 상승 샤드(부챗살 빛줄기)
    const stMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;','uniform float uP;','void main(){',
        '  float x=abs(vU.x-0.5)*2.0; float y=vU.y;',
        '  float w=smoothstep(1.0,0.0,x);',
        '  float len=smoothstep(1.0,0.0,y)*smoothstep(0.0,0.05,y);',
        '  float life=smoothstep(0.0,0.09,uP)*(1.0-smoothstep(0.3,0.78,uP));',
        '  float al=w*len*life*1.45;',
        '  vec3 col=mix(vec3(0.95,0.60,0.20), vec3(1.0,0.98,0.92), w*len);',
        '  gl_FragColor=vec4(col*al, al);','}'].join('\n') });
    const stGeo=new THREE.PlaneGeometry(0.72,4.8,1,1); stGeo.translate(0,2.4,0);
    const streaks=[];
    for(let i=0;i<26;i++){ const m=new THREE.Mesh(stGeo,stMat); const a=(i/26)*6.283+(Math.random()-0.5)*0.28;
      m.position.set(ox,oy+0.08,oz); m.rotation.order='YXZ'; m.rotation.y=a; m.rotation.x=0.62+Math.random()*0.5;
      const sx=0.75+Math.random()*0.8, sy=0.85+Math.random()*0.85; S.add(m); streaks.push({m,sx,sy}); }
    trash.push(()=>{ streaks.forEach(s=>S.remove(s.m)); stGeo.dispose(); stMat.dispose(); });
    // ⑥ 중앙 핫 코어(빌보드)
    const coreMat=new THREE.ShaderMaterial({ uniforms:{uP:{value:0}}, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
      vertexShader:GV,
      fragmentShader:[
        'varying vec2 vU;','uniform float uP;','void main(){',
        '  vec2 p=(vU-0.5)*2.0; float r=length(p);',
        '  float glow=smoothstep(1.0,0.0,r); float hot=pow(glow,3.5);',
        '  float life=smoothstep(0.0,0.05,uP)*(1.0-smoothstep(0.1,0.42,uP));',
        '  float al=(glow*0.4+hot*1.3)*life;',
        '  vec3 col=mix(vec3(1.0,0.72,0.30), vec3(1.0,0.99,0.95), hot);',
        '  gl_FragColor=vec4(col*al, al);','}'].join('\n') });
    const core=new THREE.Mesh(new THREE.PlaneGeometry(4.4,4.4), coreMat); core.position.set(ox,oy+1.2,oz); S.add(core);
    trash.push(()=>{ S.remove(core); core.geometry.dispose(); coreMat.dispose(); });
    // ⑦ 실제 파편(돌조각)
    const shGeo=new THREE.TetrahedronGeometry(0.18), shMat=new THREE.MeshStandardMaterial({color:0x6f5b3e, emissive:0x4a2c0a, emissiveIntensity:0.55, roughness:1, flatShading:true});
    const shards=[];
    for(let i=0;i<18;i++){ const m=new THREE.Mesh(shGeo,shMat); const a=Math.random()*6.28, sp=4+Math.random()*6.5;
      m.position.set(ox,oy+0.2,oz); m.scale.setScalar(0.55+Math.random()*1.0); S.add(m);
      shards.push({m, vx:Math.cos(a)*sp, vy:3.5+Math.random()*4.5, vz:Math.sin(a)*sp, rx:(Math.random()-0.5)*13, rz:(Math.random()-0.5)*13}); }
    trash.push(()=>{ shards.forEach(s=>S.remove(s.m)); shGeo.dispose(); shMat.dispose(); });
    const start=performance.now(); let last=start;
    const step=()=>{ if(done || _gen!==myGen){ cleanup(); return; } const now=performance.now(), e=now-start, t=e/DUR, tS=e/1000; const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(t>=1){ cleanup(); return; }
      ringMat.uniforms.uP.value=t; crackMat.uniforms.uP.value=t; stMat.uniforms.uP.value=t; coreMat.uniforms.uP.value=t;
      smokeMat.uniforms.uP.value=t; smokeMat.uniforms.uT.value=tS;
      pillarMat.uniforms.uP.value=t; pillarMat.uniforms.uT.value=tS;
      const pg=Math.min(1,t*7); pil1.scale.y=pg; pil2.scale.y=pg;
      for(const s of streaks){ s.m.scale.set(s.sx, s.sy*Math.min(1,t*6.5), 1); }
      if(cam){ core.quaternion.copy(cam.quaternion); const cs=1.0+t*1.6; core.scale.setScalar(cs); }
      for(const s of shards){ s.vy-=16*dt; s.m.position.x+=s.vx*dt; s.m.position.y=Math.max(oy+0.05, s.m.position.y+s.vy*dt); s.m.position.z+=s.vz*dt; s.m.rotation.x+=s.rx*dt; s.m.rotation.z+=s.rz*dt; }
      requestAnimationFrame(step); };
    requestAnimationFrame(step);
    setTimeout(cleanup, DUR+500); }

  // ════════ 로그 은신 — player.js _cloakOn/_cloakOff/stealth verbatim ════════
  function _cloakOn(m){
    if(m.__cloak) return;
    m.__cloak={ transparent:m.transparent, opacity:(m.opacity==null?1:m.opacity), depthWrite:m.depthWrite, side:m.side, obc:m.onBeforeCompile, cpck:m.customProgramCacheKey };
    m.transparent=true; m.opacity=0.10;
    m.depthWrite=true; m.side=THREE.FrontSide;
    m.customProgramCacheKey=()=>'mas_cloak';
    m.onBeforeCompile=(sh)=>{
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec3 vClkN; varying vec3 vClkV;')
        .replace('#include <project_vertex>','#include <project_vertex>\nvClkN = normalize(normalMatrix * normal); vClkV = normalize(-mvPosition.xyz);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>','#include <common>\nvarying vec3 vClkN; varying vec3 vClkV;')
        .replace('#include <dithering_fragment>',
          'float _fres = pow(1.0 - abs(dot(normalize(vClkN), normalize(vClkV))), 2.0);\n'+
          'gl_FragColor.rgb += vec3(0.35,0.75,1.0) * _fres * 1.7;\n'+
          'gl_FragColor.a = clamp(0.06 + _fres * 0.8, 0.0, 1.0);\n'+
          '#include <dithering_fragment>');
    };
    m.needsUpdate=true;
  }
  function _cloakOff(m){ if(!m.__cloak) return; const c=m.__cloak; m.transparent=c.transparent; m.opacity=c.opacity; m.depthWrite=c.depthWrite; m.side=c.side; m.onBeforeCompile=c.obc||function(){}; m.customProgramCacheKey=c.cpck||function(){return '';}; m.__cloak=null; m.needsUpdate=true; }
  let _stealthT=0;
  function stealth(){ const av=model; if(!av) return;
    av.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material];
      for(const m of ms){ try{ _cloakOn(m); }catch(e){ if(m.__op0==null)m.__op0=(m.opacity==null?1:m.opacity); m.transparent=true; m.opacity=0.1; m.depthWrite=false; } } } });
    _stealthT=performance.now()+2600;   // 쇼케이스: 2.6s 은신 후 복귀(루프 데모)
  }
  function endStealth(){ _stealthT=0; const av=model; if(!av) return;
    av.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material];
      for(const m of ms){ _cloakOff(m); if(m.__op0!=null){ m.opacity=m.__op0; m.transparent=m.__op0<1; m.depthWrite=true; m.__op0=null; } } } }); }

  // ════════ 마법사 셰이더 파이어볼 — magic.js makeFireball verbatim ════════
  const _tl = new THREE.TextureLoader();
  const _fbN = {
    perlin:_tl.load('/vfx/pizza3/noise9.jpg'),
    spark:_tl.load('/vfx/pizza3/sparklenoise.jpg'),
    water:_tl.load('/vfx/pizza3/water-min.jpg') };
  const FB_VERT=`varying vec3 vNormal; varying vec3 camPos; varying vec2 vUv;
    void main(){ vNormal=normal; vUv=uv; camPos=cameraPosition; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
  const FB_FRAG=`uniform vec4 resolution; varying vec3 vNormal; uniform sampler2D perlinnoise; uniform sampler2D sparknoise;
    uniform float time; uniform vec3 color0; uniform vec3 color1; uniform vec3 color2; uniform vec3 color3; uniform vec3 color4; uniform vec3 color5; varying vec3 camPos; varying vec2 vUv;
    float setOpacity(float r,float g,float b,float t){ float tone=(r+g+b)/3.0; float a=1.0; if(tone<t)a=0.0; return a; }
    vec3 rgbcol(vec3 c){ return vec3(c.r/255.0,c.g/255.0,c.b/255.0); }
    vec2 UPC(vec2 UV,vec2 C,float RS,float LS){ vec2 d=UV-C; float r=length(d)*2.*RS; float a=atan(d.x,d.y)*1.0/6.28*LS; return vec2(r,a); }
    void main(){ vec2 olduv=gl_FragCoord.xy/resolution.xy; vec2 uv=vUv; olduv*=0.5+time; vec4 txt=texture2D(perlinnoise,olduv);
      float pct=distance(vUv,vec2(0.5)); vec3 c0=rgbcol(color0); vec3 c1=rgbcol(color1); vec3 c2=rgbcol(color2); vec3 c5=rgbcol(color5);
      float y=smoothstep(0.16,0.525,pct); gl_FragColor=vec4(mix(c0,c5,y),1.);
      vec2 cor=UPC(vUv,vec2(0.5),1.,1.); vec2 nUv=vec2(cor.x+time,cor.x*0.2+cor.y);
      vec3 n1=texture2D(perlinnoise,mod(nUv,1.)).rgb; vec3 n2=texture2D(sparknoise,mod(nUv,1.)).rgb;
      float t0=1.-smoothstep(0.3,0.6,n1.r); float t1=smoothstep(0.3,0.6,n2.r);
      float o0=setOpacity(t0,t0,t0,.29); float o1=setOpacity(t1,t1,t1,.49);
      if(o1>0.0){ gl_FragColor=vec4(c2,0.)*vec4(o1); } else if(o0>0.0){ gl_FragColor=vec4(c1,0.)*vec4(o0); } }`;
  const FB_VCYL=`varying vec2 vUv;
    void main(){ vUv=uv; vec3 pos=position; if(pos.y>=1.87){ pos=vec3(position.x*(sin((position.y-0.6)*1.27)-0.16),position.y,position.z*(sin((position.y-0.6)*1.27)-0.16)); } else { pos=vec3(position.x*(sin((position.y/2.-.01)*.11)+0.75),position.y,position.z*(sin((position.y/2.-.01)*.11)+0.75)); } gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0); }`;
  const FB_FCYL=`varying vec2 vUv; uniform sampler2D perlinnoise; uniform vec3 color4; uniform float time;
    vec3 rgbcol(vec3 c){ return vec3(c.r/255.0,c.g/255.0,c.b/255.0); }
    void main(){ vec3 n=texture2D(perlinnoise,mod(1.*vec2(vUv.y-time*2.,vUv.x+time*1.),1.)).rgb; gl_FragColor=vec4(n.r);
      if(gl_FragColor.r>=0.5){ gl_FragColor=vec4(rgbcol(color4),gl_FragColor.r); } else { gl_FragColor=vec4(0.); }
      gl_FragColor*=vec4(sin(vUv.y)-0.1); gl_FragColor*=vec4(smoothstep(0.3,0.628,vUv.y)); }`;
  const FB_VFLAME=`varying vec2 vUv; uniform sampler2D noise; uniform float time;
    void main(){ vUv=uv; vec3 pos=position; vec3 n=texture2D(noise,mod(1.*vec2(vUv.y-time*2.,vUv.x+time*1.),1.)).rgb;
      if(pos.y>=1.87){ pos=vec3(position.x*(sin((position.y-0.64)*1.27)-0.12),position.y,position.z*(sin((position.y-0.64)*1.27)-0.12)); } else { pos=vec3(position.x*(sin((position.y/2.-.01)*.11)+0.79),position.y,position.z*(sin((position.y/2.-.01)*.11)+0.79)); }
      pos.xz*=n.r; gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0); }`;
  const FB_FFLAME=`varying vec2 vUv; uniform sampler2D noise; uniform vec3 color4; uniform float time;
    vec3 rgbcol(vec3 c){ return vec3(c.r/255.0,c.g/255.0,c.b/255.0); }
    void main(){ vec3 n=texture2D(noise,mod(1.*vec2(vUv.y-time*2.,vUv.x+time*1.),1.)).rgb; gl_FragColor=vec4(n.r);
      if(gl_FragColor.r>=0.44){ gl_FragColor=vec4(rgbcol(color4),gl_FragColor.r); } else { gl_FragColor=vec4(0.); }
      gl_FragColor*=vec4(smoothstep(0.2,0.628,vUv.y)); }`;
  const FB_OPT_EL={
    fire:{ color0:[0,0,0], color1:[120,28,8],  color2:[235,180,45],  color3:[66,66,66], color4:[245,150,55], color5:[95,38,6] },
    ice: { color0:[0,0,0], color1:[8,50,135],  color2:[70,180,255],  color3:[66,66,66], color4:[80,190,255],  color5:[16,65,150] },
    rock:{ color0:[0,0,0], color1:[70,45,18],  color2:[210,160,90],  color3:[66,66,66], color4:[190,130,70], color5:[75,48,20] },
  };
  const _V3=a=>new THREE.Vector3(...a);
  function makeFireball(el='fire'){
    const O=FB_OPT_EL[el]||FB_OPT_EL.fire; const lc=(EL[el]||EL.fire).light;
    const head_m=new THREE.ShaderMaterial({ uniforms:{ time:{value:0}, perlinnoise:{value:_fbN.perlin}, sparknoise:{value:_fbN.spark},
      color5:{value:_V3(O.color5)}, color4:{value:_V3(O.color4)}, color3:{value:_V3(O.color3)}, color2:{value:_V3(O.color2)}, color1:{value:_V3(O.color1)}, color0:{value:_V3(O.color0)}, resolution:{value:new THREE.Vector2(innerWidth,innerHeight)} }, vertexShader:FB_VERT, fragmentShader:FB_FRAG, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false });   // ★검은 배경 제거: bloom 없는 쇼케이스용 additive(검정=투명, 불꽃만 발광)
    const head=new THREE.Mesh(new THREE.SphereGeometry(1,30,30), head_m); head.scale.setScalar(0.78); head.position.set(1,0,0);
    const tail_m=new THREE.ShaderMaterial({ uniforms:{ perlinnoise:{value:_fbN.water}, color4:{value:_V3(O.color4)}, time:{value:0}, noise:{value:_fbN.perlin} }, vertexShader:FB_VCYL, fragmentShader:FB_FCYL, transparent:true, depthWrite:false, side:THREE.DoubleSide });
    const tail=new THREE.Mesh(new THREE.CylinderGeometry(1.11,0,5.3,40,40,true), tail_m); tail.rotation.set(0,0,-Math.PI/2); tail.position.set(1-4.05,0,0); tail.scale.set(1.5,1.7,1.5);
    const flame_m=new THREE.ShaderMaterial({ uniforms:{ perlinnoise:{value:_fbN.water}, color4:{value:_V3(O.color4)}, time:{value:0}, noise:{value:_fbN.perlin} }, vertexShader:FB_VFLAME, fragmentShader:FB_FFLAME, transparent:true, depthWrite:false, side:THREE.DoubleSide });
    const flame=new THREE.Mesh(new THREE.CylinderGeometry(1,0,5.3,40,40,true), flame_m); flame.rotation.set(0,0,-Math.PI/2); flame.position.set(1-4.78,0,0); flame.scale.set(2,2,2);
    const inner=new THREE.Group(); inner.add(head); inner.add(tail); inner.add(flame); inner.rotation.y=-Math.PI/2;
    const holder=new THREE.Group(); holder.add(inner); holder.scale.setScalar(0.7);
    const light=new THREE.PointLight(lc, 11, 40); holder.add(light);   // ★광원 강화(쇼케이스엔 bloom 없으므로 빛으로 보강)
    // 발광 헤일로(additive 스프라이트) — 게임 bloom 대체
    const halo=new THREE.Sprite(new THREE.SpriteMaterial({ map:_softTex(), color:lc, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, transparent:true, opacity:0.85 }));
    halo.scale.setScalar(2.8); halo.position.set(1,0,0); inner.add(halo);
    return { holder, mats:[head_m,tail_m,flame_m] };
  }

  // ════════ 마법사 기본 마법화살 — magic.js magicArrow verbatim ════════
  const TEX_GLOW = (()=>{ const t=_tl.load('/vfx/particles/radial1.png'); t.colorSpace=THREE.SRGBColorSpace; return t; })();
  function sprite(texture, color, size){
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, color, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true }));
    m.scale.setScalar(size); return m;
  }
  function magicArrow(el){ const c=EL[el]||EL.fire; const g=new THREE.Group();
    const dart=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.55,6), new THREE.MeshBasicMaterial({color:c.core}));
    dart.rotation.x=Math.PI/2; g.add(dart);
    const tail=new THREE.Mesh(new THREE.ConeGeometry(0.06,0.45,6), new THREE.MeshBasicMaterial({color:c.glow, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false}));
    tail.rotation.x=-Math.PI/2; tail.position.z=-0.34; g.add(tail);
    const glow=new THREE.Sprite(new THREE.SpriteMaterial({ map:_softTex(), color:c.glow, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, transparent:true })); glow.scale.setScalar(0.95); g.add(glow);
    const lt=new THREE.PointLight(c.light, 6, 12); g.add(lt); return g; }   // ★마법탄 광원 보강(_softTex=검정없는 흰 radial)

  // ════════ 레인저 화살 — combat.js fireArrow 모델/크리 verbatim ════════
  const _gltf=new GLTFLoader(); let _arrowProto=null;
  _gltf.load(KW+'arrow_bow.gltf', g=>{ const o=g.scene; o.traverse(m=>{ if(m.isMesh){ const ms=Array.isArray(m.material)?m.material:[m.material]; ms.forEach(x=>{ if(x&&x.map)x.map.colorSpace=THREE.SRGBColorSpace; }); } }); _arrowProto=o; }, undefined, ()=>{});
  const _fallbackArrow=()=>{ const m=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.7,6), new THREE.MeshStandardMaterial({color:0x8a5a2b})); m.rotation.x=Math.PI/2; return m; };
  function makeArrow(crit){
    const g=new THREE.Group();
    const mesh=_arrowProto ? _arrowProto.clone(true) : _fallbackArrow(); g.add(mesh);
    if(crit){ mesh.scale.multiplyScalar(1.6);
      const glow=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8), new THREE.MeshBasicMaterial({color:0xffd24d, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false}));
      const tail=new THREE.Mesh(new THREE.ConeGeometry(0.12,0.9,8), new THREE.MeshBasicMaterial({color:0xffe28a, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false}));
      tail.rotation.x=-Math.PI/2; tail.position.z=-0.5; g.add(glow); g.add(tail); }
    return g;
  }

  // ════════ 레인저 궁극기 = 바람화살 유도 8발 — combat.js WIND_N/_WA_FRAG/_WA_VERT/_windArrow verbatim ════════
  const WIND_N=8, WIND_SPD=44, WARROW_PTS=16;
  // 바람화살 리본 셰이더 — 궤적 길이방향 흐름 노이즈(바람 결) + 폭/꼬리 페이드. (바람 오라와 동일 기법)
  const _WA_FRAG=[
    'precision highp float; varying vec2 vUv; uniform float uT; uniform float uFade;',
    'float h1(float n){ return fract(sin(n)*43758.5453); }',
    'float n1(float x){ float i=floor(x),f=fract(x); return mix(h1(i),h1(i+1.0),f*f*(3.0-2.0*f)); }',
    'void main(){ float t=vUv.x;',                                          // t: 0=머리(화살촉) .. 1=꼬리
    '  float edge=smoothstep(0.0,0.5,vUv.y)*smoothstep(1.0,0.5,vUv.y);',    // 폭 소프트 엣지
    '  float flow=0.45+0.75*n1(t*11.0 - uT*4.0);',                        // 길이 따라 빠르게 흐르는 결
    '  float tail=smoothstep(1.0,0.5,t);',                                // 꼬리 소멸
    '  float a=edge*flow*tail*uFade;',
    '  if(a<0.004) discard;',
    '  vec3 col=mix(vec3(0.45,0.9,1.0), vec3(0.97,1.0,0.99), flow*0.7);',   // 청록 → 흰빛 심
    '  gl_FragColor=vec4(col, a); }'].join('\n');
  const _WA_VERT='varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  const _waTan=new THREE.Vector3(), _waSide=new THREE.Vector3(), _waView=new THREE.Vector3(), _waCam=new THREE.Vector3();
  let _waTime=0;
  function _windArrow(){   // 머리=청록 글로우 코어 + 월드공간 리본 트레일(카메라 향, 매 프레임 재구성)
    const g=new THREE.Group();
    const core=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,10), new THREE.MeshBasicMaterial({color:0xd6fff0,transparent:true,opacity:0.92,blending:THREE.AdditiveBlending,depthWrite:false})); g.add(core);
    const geo=new THREE.BufferGeometry();
    const pos=new Float32Array(WARROW_PTS*2*3), uv=new Float32Array(WARROW_PTS*2*2), idx=[];
    for(let i=0;i<WARROW_PTS;i++){ const t=i/(WARROW_PTS-1); uv[(i*2)*2]=t; uv[(i*2)*2+1]=0; uv[(i*2+1)*2]=t; uv[(i*2+1)*2+1]=1; }
    for(let i=0;i<WARROW_PTS-1;i++){ const b=i*2; idx.push(b,b+1,b+2, b+1,b+3,b+2); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv,2)); geo.setIndex(idx);
    const mat=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, uniforms:{ uT:{value:0}, uFade:{value:1} }, vertexShader:_WA_VERT, fragmentShader:_WA_FRAG });
    const rmesh=new THREE.Mesh(geo, mat); rmesh.frustumCulled=false; scene.add(rmesh);
    return { g, rmesh, rgeo:geo, rmat:mat, rpos:pos };
  }

  // ════════ 쇼케이스 투사체 관리(마법탄·파이어볼·화살) ════════
  //   게임선 조준→몬스터 타격이지만, 쇼케이스엔 타겟이 없음 → 무기 손에서 전방-좌측으로 날아가다 소멸(데모).
  const projectiles=[];   // {grp, vel, life, t, kind, mats, grav}
  const SHOW_DIR=new THREE.Vector3(-0.22,0.05,0.97).normalize();   // ★옆이 아니라 앞쪽(관객/카메라 방향)으로
  let muzzle=null;   // 설정 시 무기 끝(지팡이 촉/활)에서 발사 — select.html setWeaponMuzzle가 주입
  function showOrigin(){
    if(muzzle){ const v=new THREE.Vector3(); muzzle.getWorldPosition(v); return v; }   // 손에 든 무기 끝
    const mx=model?model.position.x:0, mz=model?model.position.z:0;
    return new THREE.Vector3(mx+0.24, FEET_Y+0.98, mz+0.2); }
  function launch(grp, dir, speed, life, kind, mats, grav){
    const o=showOrigin(); grp.position.copy(o); grp.lookAt(o.clone().add(dir)); ctx.scene.add(grp);
    projectiles.push({ grp, vel:dir.clone().multiplyScalar(speed), life, t:0, kind, mats, grav:grav||0 });
  }
  function fireFireball(el){ const fb=makeFireball(el||'fire'); fb.holder.scale.setScalar(0.34);
    launch(fb.holder, SHOW_DIR, 5.4, 0.95, 'fb', fb.mats); }
  function fireMagicArrow(el){ launch(magicArrow(el||'fire'), SHOW_DIR, 9, 0.55, 'marrow'); }
  function fireArrow(crit){ launch(makeArrow(crit), SHOW_DIR, crit?13:11, 0.65, 'arrow', null, 0.12); }

  // ════════ 레인저 궁극기 = 바람화살 유도 8발 — combat.js fireWindVolley verbatim(발사 로직) ════════
  //   ★쇼케이스엔 몹이 없어 유도 대상 없음 → 8발이 SHOW_DIR 기준 부채꼴로 흩뿌려 날아가다 소멸(homing 생략).
  //   ★머즐(무기 끝)은 바닥에서 튀는 버그가 있어 사용 금지 — 가슴 높이(avatar.position.y+0.95)에서 직접 발사.
  function windVolley(){
    const myGen=_gen;
    const origin=new THREE.Vector3(avatar.position.x, avatar.position.y+0.95, avatar.position.z);
    for(let k=0;k<WIND_N;k++){
      const dir=SHOW_DIR.clone();
      dir.x+=(Math.random()-0.5)*0.5; dir.y+=0.14+(Math.random()-0.5)*0.25; dir.z+=(Math.random()-0.5)*0.5; dir.normalize();   // 발사 순간 흩뿌림(유도 대상 없어 그대로 부채꼴 비행)
      const wa=_windArrow(); wa.g.position.copy(origin); wa.g.lookAt(origin.clone().add(dir)); ctx.scene.add(wa.g);
      const trail=[]; for(let j=0;j<WARROW_PTS;j++) trail.push({x:origin.x,y:origin.y,z:origin.z});   // 궤적 초기화(전부 발사점)
      projectiles.push({ grp:wa.g, vel:dir.multiplyScalar(WIND_SPD), life:1.1, lifeMax:1.1, t:0, kind:'wind',
        trail, rmesh:wa.rmesh, rgeo:wa.rgeo, rmat:wa.rmat, rpos:wa.rpos, myGen });
    }
    ctx.sound?.play?.('bow_attack');
  }

  // ════════ public ════════
  function play(key, el){ switch(key){
    case 'shock':    shieldSlamShow(); break;                 // 기사 궁극 = 충격파 + 화면왜곡
    case 'whirl':    windVFX(3000); break;                    // 전사 = 휠윈드(게임 spinAttack DUR=3000과 동일 3초)
    case 'bolt':     fireMagicArrow(el||'fire'); break;       // 마법사 기본 마법탄
    case 'nova':     fireFireball('fire'); break;             // 마법사 강스킬 = 파이어볼(불)
    case 'novaIce':  fireFireball('ice'); break;              // 마법사 강스킬 = 아이스볼트(얼음)
    case 'arrow':    fireArrow(false); break;                 // 레인저 사격
    case 'arrowBig': fireArrow(true); break;                  // 레인저 강사격(크리)
    case 'windVolley': windVolley(); break;                   // 레인저 궁극 = 바람화살 유도 8발
    case 'stealth':  stealth(); break;                        // 로그 은신
  } }
  function shieldSlamShow(){ shockwaveVFX(); }   // player.js shieldSlamMove — 2026-07-02 shockwaveDistort(풀스크린 왜곡) 제거됨, 충격파 VFX 단독

  function update(dt){
    // avatar(발 높이) 동기화 — 모델 회전/위치 추종
    if(model){ avatar.position.set(model.position.x, FEET_Y, model.position.z); }
    // 은신 자동 해제(쇼케이스 루프)
    if(_stealthT && performance.now()>_stealthT) endStealth();
    // 투사체 전진
    for(let i=projectiles.length-1;i>=0;i--){ const a=projectiles[i]; a.life-=dt; a.t+=dt;
      if(a.grav) a.vel.y -= 9.8*dt*a.grav;
      a.grp.position.addScaledVector(a.vel, dt);
      a.grp.lookAt(a.grp.position.clone().add(a.vel));
      if(a.kind==='fb' && a.mats){ for(const m of a.mats){ m.uniforms.time.value = m.uniforms.sparknoise ? -a.t/2 : -a.t/6; } }
      if(a.kind==='wind'){   // 바람 리본 트레일 — combat.js updateArrows(a.homing) verbatim(궤적 시프트 후 카메라 향 리본 재구성)
        _waTime+=dt;
        const tr=a.trail; for(let j=WARROW_PTS-1;j>0;j--){ const p=tr[j],q=tr[j-1]; p.x=q.x;p.y=q.y;p.z=q.z; }
        tr[0].x=a.grp.position.x; tr[0].y=a.grp.position.y; tr[0].z=a.grp.position.z;
        camera.getWorldPosition(_waCam); const rp=a.rpos;
        for(let j=0;j<WARROW_PTS;j++){ const p=tr[j], pa=tr[Math.max(0,j-1)], pb=tr[Math.min(WARROW_PTS-1,j+1)];
          _waTan.set(pb.x-pa.x,pb.y-pa.y,pb.z-pa.z); if(_waTan.lengthSq()<1e-8)_waTan.set(0,1,0); _waTan.normalize();
          _waView.set(_waCam.x-p.x,_waCam.y-p.y,_waCam.z-p.z).normalize();
          _waSide.crossVectors(_waTan,_waView); if(_waSide.lengthSq()<1e-8)_waSide.set(1,0,0); _waSide.normalize();
          const t=j/(WARROW_PTS-1), wd=0.12*(1.0-t);   // 화살촉 굵고 꼬리로 갈수록 0
          const o=j*6; rp[o]=p.x+_waSide.x*wd; rp[o+1]=p.y+_waSide.y*wd; rp[o+2]=p.z+_waSide.z*wd;
          rp[o+3]=p.x-_waSide.x*wd; rp[o+4]=p.y-_waSide.y*wd; rp[o+5]=p.z-_waSide.z*wd; }
        a.rgeo.attributes.position.needsUpdate=true; a.rgeo.computeBoundingSphere(); a.rmat.uniforms.uT.value=_waTime;
        a.rmat.uniforms.uFade.value = a.life<0.3 ? Math.max(0,a.life/0.3) : 1;   // 소멸 직전 페이드아웃(쇼케이스=타겟 없어 유도 대신 수명으로 종료)
      }
      if(a.life<=0 || (a.myGen!=null && a.myGen!==_gen)){
        ctx.scene.remove(a.grp);
        if(a.kind==='wind'){ ctx.scene.remove(a.rmesh); a.rgeo.dispose(); a.rmat.dispose(); }
        projectiles.splice(i,1);
      }
    }
  }
  function reset(){ // 캐릭터/단계 전환 시 잔여 투사체·은신·진행중 VFX 정리
    _gen++;   // windVFX/충격파/왜곡 루프가 다음 프레임에 자기정리하고 종료
    for(const a of projectiles){ ctx.scene.remove(a.grp); if(a.kind==='wind'){ ctx.scene.remove(a.rmesh); a.rgeo.dispose(); a.rmat.dispose(); } }
    projectiles.length=0;
    if(_stealthT) endStealth();
  }
  function setModel(m){ model=m; muzzle=null; }   // 모델 교체 시 머즐 해제(이전 무기 참조 제거)
  function setMuzzle(o){ muzzle=o; }

  return { play, update, reset, setModel, setMuzzle };
}
