// magic.js — 마법 엔진. 지팡이(staff) 장착 시 좌클릭=시전, 휠/[]키=스킬 전환.
//   player.js use()가 cfg.magic이면 ctx.magic.cast() 호출(쿨다운·스킬·VFX·사운드는 여기 소유).
//   combat.js 재사용: ctx.combat._damageMonster(mn, dmg, hitPos). 몬스터 = ctx.monsters.
//   VFX = Spell Effects 텍스처(voyage/spellfx/textures) 빌보드(AdditiveBlending) + PointLight + 파티클.
//   ?sys=...,monsters,combat,magic
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BAL } from '/tomob-deploy/modules/balance.js';   // ⚖️ 밸런스 SSOT (스펠 데미지·쿨다운)
import { createLightPool } from '/tomob-deploy/modules/fxpool.js';   // R1: 라이트 풀 공용화(개수 8·수치 불변)

const BLOOM_LAYER = 1;   // 이 레이어 객체(마법 VFX)만 블룸. 하늘·지형·물은 제외.

const TEX='/tomob-deploy/spellfx/textures/';
const EL = {  // 속성별 색(텍스처는 흰색 → color 곱). [제안]
  fire: { core:0xffd27a, glow:0xff5a14, light:0xff7a30 },
  ice:  { core:0xcaf4ff, glow:0x39c8e6, light:0x57d0ee },
  rock: { core:0xe8d2a8, glow:0xb07a40, light:0xc89a5a },
};
// ── 스킬 정의 — el/kind/sound/name(비수치)는 여기, 밸런스 숫자(dmg/cd/range 등)는 balance.js(BAL.magic.skills)가 override. ──
const _RAW_SKILLS = [
  // ── 기본 마법탄(좌클릭) = 약함·짧은 쿨다운. 속성은 Q로 전환 ──
  { id:'basic_fire', name:'마법탄', el:'fire', kind:'basic', dmg:4, speed:38, range:55, cd:230, sound:'spell_fire' },
  { id:'basic_ice',  name:'마법탄', el:'ice',  kind:'basic', dmg:5, speed:40, range:55, cd:230, sound:'spell_ice' },
  // ── 스킬(우클릭) = 강함·쿨다운. 데미지 하향(2026-06-29) ──
  { id:'fireball',  name:'파이어볼',   el:'fire', kind:'projectile', dmg:10, speed:24, range:70, cd:5000, sound:'spell_fire', dot:4, dotDur:4 },   // 직격10 + 화상. 특수스킬 5초쿨
  { id:'icebolt',   name:'얼음창',     el:'ice',  kind:'projectile', dmg:11, speed:28, range:75, cd:5000, sound:'spell_ice', slow:2.0 },          // 직격11 + 둔화. 특수스킬 5초쿨
  { id:'firespray', name:'화염분사',   el:'fire', kind:'cone',  dmg:9,  reach:9,  arc:0.55, cd:160, sound:'spell_firespray' },
  { id:'icebarrage',name:'아이스 연사',el:'ice',  kind:'burst', dmg:12, speed:50, range:70, shots:3, spread:0.10, cd:780, sound:'spell_icebarrage' },
  { id:'firebuff',  name:'화염강화',   el:'fire', kind:'buff',  mult:1.6, dur:8,   cd:9000, sound:'spell_firebuff' },
  { id:'icefreeze', name:'빙결',       el:'ice',  kind:'projectile', dmg:10, speed:26, range:60, slow:3.0, cd:2600, sound:'spell_icefreeze' },
  { id:'icewall',   name:'얼음벽',     el:'ice',  kind:'wall',  dur:7,  cd:4000, sound:'spell_icewall' },
  { id:'rockwall',  name:'바위벽',     el:'rock', kind:'wall',  dur:10, cd:4000, sound:'spell_rockwall' },
  { id:'meteor',    name:'메테오',     el:'rock', kind:'fall',  dmg:40, radius:5, cd:5200, sound:'spell_meteor' },
];
// ★밸런스 override 병합 — BAL.magic.skills[id]의 수치가 최종값(단일 튜닝 지점).
const SKILLS = _RAW_SKILLS.map(s => ({ ...s, ...(BAL.magic.skills[s.id] || {}) }));

export function initMagic(ctx){
  const { scene, camera } = ctx;
  // ── 블룸(마법만 발광) — 항상 동일 렌더 경로 → 마법 유무 무관 톤 일정(마법 쏠 때 맵 안 변함) ──
  //   완전분리 overlay(맵 100% 원본)는 three.js 렌더 상태 충돌 버그로 보류. 현재는 OutputPass 경로(원본보다 극미하게 밝지만 일정).
  try {
    const r = ctx.renderer;
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.38, 0.0);   // 강도 절제(파이어볼 "너무 밝게 지나감" 완화, 2026-06-29). 블룸레이어만 글로우.
    const bloomComposer = new EffectComposer(r); bloomComposer.renderToScreen=false;
    bloomComposer.addPass(new RenderPass(scene, camera)); bloomComposer.addPass(bloomPass);
    // ── 블룸 글로우를 base 위에 덧칠하는 풀스크린 additive 오버레이 ──
    //   ★완전분리: base(맵+마법)는 renderer.render로 '직접' 그림 → 색/밝기 절대 불변(finalComposer/OutputPass 경유 X).
    //    블룸 텍스처(마법만 밝음)를 그 위에 AdditiveBlending 풀스크린 쿼드로 덧칠 → 마법만 글로우, 맵은 100% 원본.
    const _glowQuad = new FullScreenQuad(new THREE.MeshBasicMaterial({
      map:bloomComposer.renderTarget2.texture, blending:THREE.AdditiveBlending, transparent:true, depthTest:false, depthWrite:false }));
    //   성능/안전: VFX(파티클·투사체·벽) 없을 땐 기본 renderer.render만 → 맵 원본 100%.
    // ⛔2026-07-24 "던전 상시 블룸 ON" 시도 → **철회**(사령관 "어디에서나 노란 장판 보임").
    //   이 게임의 선택적 블룸은 **레이어1 객체만 그리고 벽은 안 그리는** 패스다(마법 VFX처럼 작고 순간적인 것 전제).
    //   여기에 **크고 상주하는 용암면**을 올렸더니, 블룸 패스엔 가릴 벽이 없어서 **벽 뒤 멀리 있는 용암의 노란 블룸이
    //   벽을 뚫고 화면 전체에 덧칠**됐다. = 그 "노란 장판". ⇒ 용암은 블룸 레이어에서 뺐고(아래 buildLavaPit) 이 조건도 원복.
    //   진짜 블룸 글로우를 원하면 **오클루전 블룸**(벽을 검게 함께 렌더)이 필요 — 별도 작업.
    const _bloomActive = () => (_ps.active.length > 0 || projectiles.length > 0 || walls.length > 0 || !!ctx.hitfx?.arcaneActive?.());   // ★hitfx 일반 임팩트는 bloom 제거 / 룬마스터 아케인 처형(볼트+마법진)만 예외로 bloom(마법은 밝아도 OK)
    const _ccTmp = new THREE.Color(), _ccGet = new THREE.Color();   // clearColor 저장/복원용
    ctx.setRenderOverride(() => {
      if(!_bloomActive()){ r.render(scene, camera); return; }              // VFX 없음 → 기본 렌더(원본+성능)
      // ② 먼저 '마법만' 블룸 → renderTarget2 (렌더타겟을 바꾸므로 base보다 먼저)
      const _mask = camera.layers.mask, _bg = scene.background;
      const _cc = _ccTmp.copy(r.getClearColor(_ccGet)), _ca = r.getClearAlpha();
      scene.background = null; camera.layers.set(BLOOM_LAYER);             // 마법 레이어만 (하늘 제외)
      r.setClearColor(0x000000, 0);                                       // ★배경 검정 — 안 그러면 하늘색으로 클리어돼 화면 전체가 블룸됨
      bloomComposer.render();
      r.setClearColor(_cc, _ca);                                          // clearColor 복원
      camera.layers.mask = _mask; scene.background = _bg;                  // 복원
      // ① base: 맵+마법 '직접' 렌더.
      //   ★2026-07-24 그레이딩(grade.js) 연동: 화면(null) 대신 grade RT가 있으면 거기로 그린다.
      //     grade.js가 이 RT를 받아 컬러 그레이딩 후 화면에 출력한다. RT 없으면(grade 미로드) 기존대로 화면 직접 = 불변.
      r.setRenderTarget(ctx._gradeRT ?? null);
      r.render(scene, camera);
      // ③ 블룸 글로우를 base 위에 additive 덧칠
      const _ac = r.autoClear; r.autoClear = false;
      _glowQuad.render(r);
      r.autoClear = _ac;
    });
    addEventListener('resize', ()=>{ bloomComposer.setSize(innerWidth,innerHeight); });
    ctx._bloom = bloomPass;
    console.log('[magic] 블룸 완전분리(오버레이) — 마법만 글로우, 맵 원본');
  } catch(e){ console.warn('[magic] 블룸 통합 실패 — 기본 렌더 유지', e&&e.message); }
  const _tl = new THREE.TextureLoader();
  const tex = name => { const t=_tl.load(encodeURI(TEX+name+'.png')); t.colorSpace=THREE.SRGBColorSpace; return t; };
  const T = { flare:tex('flare_01'), glow:tex('gradient_radial_01'), trail:tex('trail_01'), impact:tex('impact_01'), noise:tex('noise_03') };

  // ── 스프라이트시트 애니메이션(brackeys) — 진짜 타오르는 불꽃/폭발 ──
  const VFX='/tomob-deploy/vfx/sheets/';
  const SHEET = {   // file + 그리드(cols×rows)
    fire_point:{file:'fire_point_6x5.png',c:6,r:5}, fire_ring:{file:'fire_ring_6x5.png',c:6,r:5},
    explosion:{file:'explosion_6x5.png',c:6,r:5},   star:{file:'star_explosion_6x5.png',c:6,r:5},
    wavy_blue:{file:'wavy_blue_6x5.png',c:6,r:5},    wavy_purple:{file:'wavy_purple_6x5.png',c:6,r:5},
    big_hit:{file:'big_hit_6x5.png',c:6,r:5},        vortex:{file:'vortex_6x5.png',c:6,r:5},
    charge:{file:'charge_7x6.png',c:7,r:6},          dfire:{file:'dithered_fire_6x5.png',c:6,r:5},
  };
  const _sheetBase={};
  for(const k in SHEET){ const t=_tl.load(encodeURI(VFX+SHEET[k].file), x=>{x.colorSpace=THREE.SRGBColorSpace;}); t.colorSpace=THREE.SRGBColorSpace; _sheetBase[k]=t; }
  // 속성별 시트(코어=루프, hit=1회). tint=흰색이면 시트 원색 유지.
  const EL_SHEET = {
    fire: { core:'fire_point', hit:'explosion',  tint:0xffffff },
    ice:  { core:'wavy_blue',  hit:'big_hit',    tint:0xddf6ff },
    rock: { core:'dfire',      hit:'explosion',  tint:0xc98f55 },
  };
  const sheetAnims=[];
  function sheetSprite(key, color, size, { loop=true, fps=30 }={}){
    const meta=SHEET[key]; const t=_sheetBase[key].clone(); t.needsUpdate=true;
    t.repeat.set(1/meta.c, 1/meta.r); t.offset.set(0, 1-1/meta.r);
    const m=new THREE.SpriteMaterial({ map:t, color, blending:THREE.AdditiveBlending, depthWrite:false, transparent:true });   // 검은 배경 시트 → additive로 검정 제거(테두리 없음). 색 포화는 크기/tint로 관리.
    const s=new THREE.Sprite(m); s.scale.setScalar(size);
    s.userData={ meta, t, frame:0, fps, loop, acc:0, done:false }; return s;
  }
  function updateSheet(s, dt){ const u=s.userData; u.acc+=dt; const fr=1/u.fps, total=u.meta.c*u.meta.r;
    while(u.acc>=fr){ u.acc-=fr; u.frame++;
      if(u.frame>=total){ if(u.loop) u.frame=0; else { u.done=true; u.frame=total-1; break; } }
      const col=u.frame%u.meta.c, row=(u.frame/u.meta.c)|0; u.t.offset.set(col/u.meta.c, 1-(row+1)/u.meta.r); } }

  let skillI = 0, _cd = 0;          // 현재 스킬 인덱스 / 쿨다운 끝나는 시각
  let _buffUntil = 0, _buffMult = 1;
  const projectiles = [];           // {grp, vel, life, dmg, el, slow, light}
  const _dotSet = new Set(), _slowSet = new Set();   // ⚡화상/슬로우 활성 몹 추적(평시 전 몹 순회 제거)
  const fx = [];                    // 일회성 VFX {update(dt)->bool}
  const walls = [];                 // {mesh, until}
  const _rc = new THREE.Raycaster(), _C2 = new THREE.Vector2();

  // ⚡ 스펠 라이트 풀 상주 — 투사체/착탄/버프/메테오마다 PointLight를 add/remove하면 라이트 개수 변동
  //   = 씬 전체 셰이더 재컴파일(마법 전투 프레임드랍 주범 — cannon/shipwreck/monsters와 동일 병·동일 처방).
  //   라이트는 씬 루트 상주(intensity 0), 색/거리 변경은 재컴파일 무관. 투사체엔 부착하지 않고 위치 추종.
   // ⚡2026-07-22 축소: three.js는 `visible`인 광원을 **intensity 0이어도 픽셀마다 계산**한다.
   //   놀고 있는 풀 광원이 씬에 30개 있었고, 이게 전투 프레임 드랍의 주원인이었다(실측: 광원 38개 제외 시 렌더 584→10ms).
   //   동시에 실제로 필요한 개수만 남긴다. 고갈 시엔 빛만 생략되고 이펙트는 그대로 나온다(기존 정책 유지).
  const spellLightPool=createLightPool(scene, 4, { color:0xffffff, distance:10 });   // 8→4
  const grabSpellLight=()=>spellLightPool.grab();   // 고갈 시 빛 생략(VFX만)
  const releaseSpellLight=s=>spellLightPool.release(s);

  // ── 몬스터 타격 헬퍼(combat과 동일 규칙) ──
  const monH  = mn => (mn.def?.scale || 1.7);
  const monCY = mn => mn.grp.position.y + monH(mn)*0.5;
  const monR  = mn => Math.max(0.85, monH(mn)*0.45);

  // ── 공용 VFX ──
  function sprite(texture, color, size, blend=THREE.AdditiveBlending){
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, color, blending:blend, depthWrite:false, transparent:true }));
    m.scale.setScalar(size); m.layers.enable(BLOOM_LAYER); return m;   // 마법 스프라이트=블룸
  }

  // ── GPU 파티클 시스템 (THREE.Points + 셰이더, additive 발광) — 트레일/폭발 ember ──
  const PT='/tomob-deploy/vfx/particles/';
  const ptex = n => { const t=_tl.load(encodeURI(PT+n+'.png')); t.colorSpace=THREE.SRGBColorSpace; return t; };
  const TEX_EMBER=ptex('embers'), TEX_FLARE=ptex('flare'), TEX_GLOW=ptex('radial1'), TEX_SHAPE=ptex('radial2');
  function makeParticles(tex, max){
    const g=new THREE.BufferGeometry();
    const pos=new Float32Array(max*3), col=new Float32Array(max*3), life=new Float32Array(max), siz=new Float32Array(max);
    const A=(n,a,d)=>{ const at=new THREE.BufferAttribute(a,d); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n,at); };
    A('position',pos,3); A('aColor',col,3); A('aLife',life,1); A('aSize',siz,1);
    const m=new THREE.ShaderMaterial({
      uniforms:{ map:{value:tex} },
      vertexShader:`attribute float aLife; attribute float aSize; attribute vec3 aColor; varying float vLife; varying vec3 vCol;
        void main(){ vLife=aLife; vCol=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize*(300.0/max(0.001,-mv.z))*(0.35+0.65*aLife); gl_Position=projectionMatrix*mv; }`,
      fragmentShader:`uniform sampler2D map; varying float vLife; varying vec3 vCol;
        void main(){ if(vLife<=0.001) discard; vec4 t=texture2D(map, gl_PointCoord); gl_FragColor=vec4(vCol*vLife,1.0)*t; }`,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:true });
    const pts=new THREE.Points(g,m); pts.frustumCulled=false; pts.layers.enable(BLOOM_LAYER); scene.add(pts);
    return { g, pos, col, life, siz, max, head:0, active:[] };
  }
  const _ps = makeParticles(TEX_EMBER, 4000);
  function emit(x,y,z, vx,vy,vz, color, size, lifeT, grav=0){
    const s=_ps, i=s.head; s.head=(s.head+1)%s.max;
    s.pos[i*3]=x; s.pos[i*3+1]=y; s.pos[i*3+2]=z;
    s.col[i*3]=((color>>16)&255)/255; s.col[i*3+1]=((color>>8)&255)/255; s.col[i*3+2]=(color&255)/255;
    s.siz[i]=size; s.life[i]=1; s.active.push({ i, vx,vy,vz, grav, t:lifeT, mt:lifeT, sz0:size });
  }
  function updateParticles(dt){ const s=_ps;
    for(let k=s.active.length-1;k>=0;k--){ const a=s.active[k]; a.t-=dt;
      if(a.t<=0){ s.life[a.i]=0; s.active.splice(k,1); continue; }
      a.vy-=a.grav*dt; const i=a.i*3; s.pos[i]+=a.vx*dt; s.pos[i+1]+=a.vy*dt; s.pos[i+2]+=a.vz*dt;
      const lr=a.t/a.mt; s.life[a.i]=lr; s.siz[a.i]=a.sz0*(0.4+0.6*lr); }
    s.g.attributes.position.needsUpdate=true; s.g.attributes.aColor.needsUpdate=true;
    s.g.attributes.aLife.needsUpdate=true; s.g.attributes.aSize.needsUpdate=true;
  }
  // ── 셰이더 파이어볼(pizza3) — 둥근 머리(구체) + 늘어지는 꼬리(원뿔). bloom과 결합. ──
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
  const _fbN = {   // 노이즈 텍스처(pizza3 asset). 셰이더 노이즈 스크롤용.
    perlin:_tl.load('/tomob-deploy/vfx/pizza3/noise9.jpg'),       // 로컬화(외부 GitHub 400 방지 + 파이어볼 디테일 안정)
    spark:_tl.load('/tomob-deploy/vfx/pizza3/sparklenoise.jpg'),
    water:_tl.load('/tomob-deploy/vfx/pizza3/water-min.jpg') };
  // 속성별 셰이더볼 색 (color2=코어밝음, color1=중간, color4=꼬리불꽃, color5=꼬리바깥)
  const FB_OPT_EL={
    fire:{ color0:[0,0,0], color1:[120,28,8],  color2:[235,180,45],  color3:[66,66,66], color4:[245,150,55], color5:[95,38,6] },
    ice: { color0:[0,0,0], color1:[8,50,135],  color2:[70,180,255],  color3:[66,66,66], color4:[80,190,255],  color5:[16,65,150] },
    rock:{ color0:[0,0,0], color1:[70,45,18],  color2:[210,160,90],  color3:[66,66,66], color4:[190,130,70], color5:[75,48,20] },
  };
  const _V3=a=>new THREE.Vector3(...a);
  function makeFireball(el='fire'){
    const O=FB_OPT_EL[el]||FB_OPT_EL.fire; const lc=(EL[el]||EL.fire).light;
    const head_m=new THREE.ShaderMaterial({ uniforms:{ time:{value:0}, perlinnoise:{value:_fbN.perlin}, sparknoise:{value:_fbN.spark},
      color5:{value:_V3(O.color5)}, color4:{value:_V3(O.color4)}, color3:{value:_V3(O.color3)}, color2:{value:_V3(O.color2)}, color1:{value:_V3(O.color1)}, color0:{value:_V3(O.color0)}, resolution:{value:new THREE.Vector2(innerWidth,innerHeight)} }, vertexShader:FB_VERT, fragmentShader:FB_FRAG });
    const head=new THREE.Mesh(new THREE.SphereGeometry(1,30,30), head_m); head.scale.setScalar(0.78); head.position.set(1,0,0);
    const tail_m=new THREE.ShaderMaterial({ uniforms:{ perlinnoise:{value:_fbN.water}, color4:{value:_V3(O.color4)}, time:{value:0}, noise:{value:_fbN.perlin} }, vertexShader:FB_VCYL, fragmentShader:FB_FCYL, transparent:true, depthWrite:false, side:THREE.DoubleSide });
    const tail=new THREE.Mesh(new THREE.CylinderGeometry(1.11,0,5.3,40,40,true), tail_m); tail.rotation.set(0,0,-Math.PI/2); tail.position.set(1-4.05,0,0); tail.scale.set(1.5,1.7,1.5);
    const flame_m=new THREE.ShaderMaterial({ uniforms:{ perlinnoise:{value:_fbN.water}, color4:{value:_V3(O.color4)}, time:{value:0}, noise:{value:_fbN.perlin} }, vertexShader:FB_VFLAME, fragmentShader:FB_FFLAME, transparent:true, depthWrite:false, side:THREE.DoubleSide });
    const flame=new THREE.Mesh(new THREE.CylinderGeometry(1,0,5.3,40,40,true), flame_m); flame.rotation.set(0,0,-Math.PI/2); flame.position.set(1-4.78,0,0); flame.scale.set(2,2,2);
    head.layers.enable(BLOOM_LAYER); tail.layers.enable(BLOOM_LAYER); flame.layers.enable(BLOOM_LAYER);   // 셰이더볼 메시=블룸
    const inner=new THREE.Group(); inner.add(head); inner.add(tail); inner.add(flame); inner.rotation.y=-Math.PI/2;   // 머리(+x)→진행축(+z)
    const holder=new THREE.Group(); holder.add(inner); holder.scale.setScalar(0.7);
    // ⚡라이트는 holder에 안 붙임(개수 변동=재컴파일) — fireProjectile이 풀 슬롯을 잡아 위치 추종
    return { holder, mats:[head_m,tail_m,flame_m], lightColor:lc };
  }

  // 투사체 코어 = 밝은 flare 코어 + 부드러운 글로우 + 강한 빛(트레일은 update에서 emit)
  function orb(el, size){
    const c = EL[el]; const g = new THREE.Group();
    const core = sprite(TEX_FLARE, c.core, size*2.4); g.add(core);   // 밝은 별빛 코어
    const glow = sprite(TEX_GLOW, c.glow, size*4.2); g.add(glow);    // 부드러운 발광 헤일로
    // ⚡라이트는 그룹에 안 붙임(개수 변동=재컴파일) — 쓰는 쪽(메테오)이 풀 슬롯으로 위치 추종
    g.userData = { el, size, core, glow, _t:0 }; return g;
  }
  // 명중/착탄 폭발 = 섬광 + 충격파 글로우 + ember 파티클 폭발 + 강한 빛
  function burst(pos, el, scale=2.2){
    const c = EL[el];
    const core  = sprite(TEX_GLOW, c.core, scale*1.2); core.position.copy(pos); scene.add(core);    // 밝은 코어(부드러운 원)
    const shock = sprite(TEX_GLOW, c.glow, scale*0.7); shock.position.copy(pos); scene.add(shock);  // 충격파(커지며 페이드)
    const ls=grabSpellLight();   // ⚡풀 슬롯(착탄마다 add/remove = 재컴파일이던 것)
    if(ls){ ls.light.color.setHex(c.light); ls.light.distance=scale*15; ls.light.intensity=6; ls.light.position.copy(pos); }
    let t=0; const dur=0.4;
    fx.push({ update(dt){ t+=dt; const k=Math.min(1,t/dur);
      core.material.opacity=Math.max(0,1-k*1.5); core.scale.setScalar(scale*1.2*(1+k*0.7));
      shock.scale.setScalar(scale*0.7*(1+k*4.5)); shock.material.opacity=Math.max(0,0.8-k*0.8);
      if(ls) ls.light.intensity=6*(1-k);
      if(t>=dur){ scene.remove(core);scene.remove(shock); releaseSpellLight(ls); core.material.dispose();shock.material.dispose(); return false; } return true; } });
    // ember 파티클 폭발(사방으로 터짐)
    const N=Math.round(22*scale);
    for(let n=0;n<N;n++){ const a=Math.random()*Math.PI*2, e=(Math.random()-0.5)*Math.PI, sp=2+Math.random()*6*scale*0.5;
      emit(pos.x,pos.y,pos.z, Math.cos(a)*Math.cos(e)*sp, Math.abs(Math.sin(e))*sp*0.6+1.5, Math.sin(a)*Math.cos(e)*sp,
        Math.random()<0.5?c.core:c.glow, 0.28+Math.random()*0.38, 0.45+Math.random()*0.5, 7); }
  }
  // ── 상태효과 VFX: 몬스터가 불타는(DoT)·어는(슬로우) 동안 몸에 붙는 효과(grp 자식 → 따라다님) ──
  function startBurnFx(mn){ if(mn._burnFx) return; const H=monH(mn); const g=new THREE.Group(); const sprites=[];
    // ★작은 불꽃 여러 개를 몸 전체(높이·둘레)에 흩뿌림 = "여러 군데 불붙은" 느낌(큰 사각 quad 회피)
    const N=7;
    for(let i=0;i<N;i++){ const s=sheetSprite(i%2?'dfire':'fire_point', 0xc25e1e, H*(0.15+Math.random()*0.13), {fps:18+Math.random()*12});   // 어두운 주황(가산+블룸이라 흰색은 너무 밝음)
      const a=Math.random()*6.283, r=H*(0.08+Math.random()*0.22);
      s.position.set(Math.cos(a)*r, H*(0.18+Math.random()*1.05), Math.sin(a)*r);   // 다리~머리, 둘레 분산
      s.userData.frame=(Math.random()*30)|0; s.layers.enable(BLOOM_LAYER); g.add(s); sprites.push(s); sheetAnims.push(s); }
    mn.grp.add(g); mn._burnFx={ g, sprites }; }
  function stopBurnFx(mn){ const f=mn._burnFx; if(!f) return;
    for(const s of f.sprites){ const k=sheetAnims.indexOf(s); if(k>=0) sheetAnims.splice(k,1); if(s.material) s.material.dispose(); }
    if(f.g.parent) f.g.parent.remove(f.g); mn._burnFx=null; }
  // ── 🔥 플레이어 화상 VFX(모닥불 등) — 몬스터 burn과 동일 fire_point 스프라이트를 아바타에 부착 ──
  let _playerBurn=null;
  function burnPlayer(on){ const av=ctx.player&&ctx.player.avatar; if(!av) return;
    if(on){ if(_playerBurn) return; const H=1.35, g=new THREE.Group(), sprites=[];
      for(let i=0;i<7;i++){ const s=sheetSprite(i%2?'dfire':'fire_point', 0xc25e1e, H*(0.15+Math.random()*0.13), {fps:18+Math.random()*12});
        const a=Math.random()*6.283, r=H*(0.08+Math.random()*0.22);
        s.position.set(Math.cos(a)*r, H*(0.18+Math.random()*1.05), Math.sin(a)*r);
        s.userData.frame=(Math.random()*30)|0; s.layers.enable(BLOOM_LAYER); g.add(s); sprites.push(s); sheetAnims.push(s); }
      av.add(g); _playerBurn={ g, sprites }; }
    else { if(!_playerBurn) return; for(const s of _playerBurn.sprites){ const k=sheetAnims.indexOf(s); if(k>=0) sheetAnims.splice(k,1); if(s.material) s.material.dispose(); }
      if(_playerBurn.g.parent) _playerBurn.g.parent.remove(_playerBurn.g); _playerBurn=null; } }
  let _iceGeo=null, _iceMat=null;
  function startFreezeFx(mn){ if(mn._freezeFx) return; const H=monH(mn);
    if(!_iceGeo){ _iceGeo=new THREE.IcosahedronGeometry(1,0); _iceMat=new THREE.MeshStandardMaterial({ color:0xa8e8ff, emissive:0x2f7bd6, emissiveIntensity:0.55, transparent:true, opacity:0.72, roughness:0.15, metalness:0.0, flatShading:true }); }
    const g=new THREE.Group();
    for(let i=0;i<5;i++){ const m=new THREE.Mesh(_iceGeo,_iceMat); const a=Math.random()*6.283, r=H*(0.18+Math.random()*0.16);
      m.position.set(Math.cos(a)*r, H*(0.15+Math.random()*0.95), Math.sin(a)*r); m.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);
      m.scale.setScalar(H*(0.10+Math.random()*0.12)); g.add(m); }
    mn.grp.add(g); mn._freezeFx={ g }; }
  function stopFreezeFx(mn){ const f=mn._freezeFx; if(!f) return; if(f.g.parent) f.g.parent.remove(f.g); mn._freezeFx=null; }
  // 2단계 조준(TPS): 카메라→크로스헤어 월드점, 무기서 그 점으로
  function aim(){
    // ★화면중앙(크로스헤어) 2단계 조준 — 카메라→크로스헤어 월드점, 무기서 그 점으로. 조준선과 발사 일치.
    _rc.setFromCamera(_C2.set(0,0), camera);
    const targets = (ctx.terrain && ctx.terrain.collide ? ctx.terrain.collide.slice() : []);
    if(ctx.monsters) for(const mn of ctx.monsters){ if(!mn.dead && mn.grp) targets.push(mn.grp); }
    const hits = targets.length ? _rc.intersectObjects(targets, true) : [];
    const point = hits.length ? hits[0].point.clone() : _rc.ray.origin.clone().addScaledVector(_rc.ray.direction, 150);
    const pp = ctx.player?.pos || {x:0,y:0,z:0};
    const origin = (ctx.player && ctx.player.third)
      ? new THREE.Vector3(pp.x, (pp.y||0)+1.4, pp.z)                          // 3인칭: 가슴(투사체 출발)
      : _rc.ray.origin.clone().addScaledVector(_rc.ray.direction, 0.6);      // 1인칭: 시선 앞
    const dir = point.clone().sub(origin); if(dir.lengthSq()<1e-4) dir.copy(_rc.ray.direction); dir.normalize();
    return { origin, dir, point };
  }

  // ── 메커니즘 ──
  function fireProjectile(sk, origin, dir){
    // ★셰이더볼(머리+꼬리 메시) — 모든 투사체/연사 스킬(속성별 색)
    const fb=makeFireball(sk.el); if(sk.scale) fb.holder.scale.multiplyScalar(sk.scale); fb.holder.position.copy(origin); fb.holder.lookAt(origin.clone().add(dir)); scene.add(fb.holder);
    const ls=grabSpellLight();   // ⚡풀 슬롯 — update 루프가 투사체 위치 추종, 소멸 시 반납
    if(ls){ ls.light.color.setHex(fb.lightColor); ls.light.distance=26; ls.light.intensity=3.2; ls.light.position.copy(origin); }
    projectiles.push({ grp:fb.holder, ls, mats:fb.mats, shader:true, vel:dir.clone().multiplyScalar(sk.speed), life:sk.range/sk.speed+0.4, dmg:sk.dmg*_buffMult, el:sk.el, slow:sk.slow||0, dot:sk.dot||0, dotDur:sk.dotDur||0, _t:0 });
  }
  function castProjectile(sk){ const {origin,dir}=aim(); fireProjectile(sk, origin, dir); }
  // ── 단순 마법 화살(좌클릭 기본탄) — 가는 발광 다트 + 꼬리 + 헤일로 + 짧은 트레일 ──
  function magicArrow(el){ const c=EL[el]||EL.fire; const g=new THREE.Group();
    const dart=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.55,6), new THREE.MeshBasicMaterial({color:c.core}));
    dart.rotation.x=Math.PI/2; dart.layers.enable(BLOOM_LAYER); g.add(dart);                 // 뾰족 끝 +z(진행방향)
    const tail=new THREE.Mesh(new THREE.ConeGeometry(0.06,0.45,6), new THREE.MeshBasicMaterial({color:c.glow, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false}));
    tail.rotation.x=-Math.PI/2; tail.position.z=-0.34; tail.layers.enable(BLOOM_LAYER); g.add(tail);   // 뒤로 흐르는 꼬리
    const glow=sprite(TEX_GLOW, c.glow, 0.5); g.add(glow); return g; }                        // 부드러운 헤일로
  function castBasicArrow(sk){ const {origin,dir}=aim();
    const g=magicArrow(sk.el); g.position.copy(origin); g.lookAt(origin.clone().add(dir)); scene.add(g);
    projectiles.push({ grp:g, arrow:true, vel:dir.clone().multiplyScalar(sk.speed), life:sk.range/sk.speed+0.3, dmg:sk.dmg*_buffMult, el:sk.el, slow:0, dot:0, dotDur:0, _t:0 }); }
  function castBurst(sk){ const {origin,dir}=aim();
    const shoot=()=>{ const d=dir.clone();
      d.x+=(Math.random()-0.5)*sk.spread; d.y+=(Math.random()-0.5)*sk.spread; d.z+=(Math.random()-0.5)*sk.spread; d.normalize();
      fireProjectile(sk, origin.clone(), d); };
    shoot();   // 첫발 즉시
    for(let i=1;i<(sk.shots||3);i++) setTimeout(shoot, i*110); }
  function castCone(sk){ const {origin,dir}=aim();
    // 전방 부채꼴 즉시 다단 + 콘 VFX
    const c=EL[sk.el]; for(let i=0;i<10;i++){ const s=sprite(T.flare,c.core,0.5+Math.random()*0.4);
      const dist=1+Math.random()*sk.reach; s.position.copy(origin).addScaledVector(dir,dist).add(new THREE.Vector3((Math.random()-0.5)*1.6,(Math.random()-0.5)*1.2,(Math.random()-0.5)*1.6)); scene.add(s);
      let t=0; fx.push({update(dt){ t+=dt; s.material.opacity=Math.max(0,1-t/0.35); s.scale.multiplyScalar(1.03); if(t>=0.35){scene.remove(s);s.material.dispose();return false;} return true;}}); }
    const fwd=dir.clone(); const pp=ctx.player?.pos;
    for(const mn of (ctx.monsters||[])){ if(mn.dead) continue; const gp=mn.grp.position;
      const to=new THREE.Vector3(gp.x-origin.x, monCY(mn)-origin.y, gp.z-origin.z); const d=to.length();
      if(d>sk.reach+monR(mn)) continue; to.normalize(); if(fwd.dot(to)<(1-sk.arc)) continue;
      ctx.combat?._damageMonster?.(mn, sk.dmg*_buffMult, gp.clone().setComponent(1,monCY(mn))); }
  }
  function castBuff(sk){ _buffUntil=performance.now()+sk.dur*1000; _buffMult=sk.mult;
    const c=EL[sk.el]; const pp=ctx.player?.pos||{x:0,y:0,z:0}; const center=new THREE.Vector3(pp.x,(pp.y||0)+1,pp.z);
    for(let i=0;i<14;i++){ const ang=i/14*Math.PI*2; const s=sprite(T.flare,c.core,0.5);
      s.position.copy(center).add(new THREE.Vector3(Math.cos(ang)*1.1,0,Math.sin(ang)*1.1)); scene.add(s);
      let t=0; fx.push({update(dt){ t+=dt; const p=ctx.player?.pos; if(p)s.position.set(p.x+Math.cos(ang+t*3)*1.1,(p.y||0)+0.3+t*1.6,p.z+Math.sin(ang+t*3)*1.1);
        s.material.opacity=Math.max(0,1-t/1.0); if(t>=1.0){scene.remove(s);s.material.dispose();return false;} return true;}}); }
    const ls=grabSpellLight(); let lt=0;   // ⚡풀 슬롯(버프 시전마다 add/remove = 재컴파일이던 것)
    if(ls){ ls.light.color.setHex(c.light); ls.light.distance=8; ls.light.intensity=3; }
    fx.push({update(dt){ lt+=dt; const p=ctx.player?.pos; if(ls){ if(p)ls.light.position.set(p.x,(p.y||0)+1,p.z); ls.light.intensity=3*Math.max(0,1-lt/1.0); } if(lt>=1.0){releaseSpellLight(ls);return false;} return true;}});
  }
  function castWall(sk){ const {point}=aim(); const c=EL[sk.el];
    const mat=new THREE.MeshStandardMaterial({ color:c.glow, transparent:true, opacity:sk.el==='ice'?0.6:0.95, roughness:sk.el==='ice'?0.2:0.95, metalness:0, emissive:c.glow, emissiveIntensity:sk.el==='ice'?0.4:0.1 });
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,2.4,0.5), mat);
    const pp=ctx.player?.pos||{x:0,y:0,z:0}; const dir=new THREE.Vector3(point.x-pp.x,0,point.z-pp.z); if(dir.lengthSq()<1e-3)dir.set(0,0,1); dir.normalize();
    mesh.position.set(point.x, point.y+1.0, point.z); mesh.lookAt(point.x+dir.x, point.y+1.0, point.z+dir.z);
    mesh.scale.y=0.01; scene.add(mesh); walls.push({ mesh, until:performance.now()+sk.dur*1000, born:performance.now() });
    burst(new THREE.Vector3(point.x,point.y+0.2,point.z), sk.el, 1.6);
  }
  function castMeteor(sk){ const {point}=aim(); const c=EL[sk.el];
    const start=new THREE.Vector3(point.x+2, point.y+26, point.z-2);
    const g=orb('rock',1.1); const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(0.8,0), new THREE.MeshStandardMaterial({color:0x6b4a2a,roughness:1,emissive:0xff4500,emissiveIntensity:0.5}));
    g.add(rock); g.position.copy(start); scene.add(g);
    const ls=grabSpellLight();   // ⚡풀 슬롯(구 orb 내장 라이트 대체) — 낙하 궤적 추종
    if(ls){ ls.light.color.setHex(c.light); ls.light.distance=1.1*24; ls.light.intensity=3.2; ls.light.position.copy(start); }
    const dur=0.9, from=start.clone(), to=new THREE.Vector3(point.x,point.y+0.3,point.z); let t=0;
    fx.push({ update(dt){ t+=dt; const k=Math.min(1,t/dur); g.position.lerpVectors(from,to,k*k); rock.rotation.x+=dt*9; rock.rotation.y+=dt*7;
      if(ls) ls.light.position.copy(g.position);
      if(k>=1){ scene.remove(g); releaseSpellLight(ls); burst(to.clone(), 'rock', 3.4); ctx.sound?.play?.('spell_crit');
        for(const mn of (ctx.monsters||[])){ if(mn.dead) continue; const gp=mn.grp.position; const dx=gp.x-to.x, dz=gp.z-to.z;
          if(dx*dx+dz*dz < sk.radius*sk.radius) ctx.combat?._damageMonster?.(mn, sk.dmg*_buffMult, gp.clone().setComponent(1,monCY(mn))); }
        return false; } return true; } });
  }

  // ── 시전(player.js use()가 호출) ──
  const _cdMap = {};   // 스킬별 독립 쿨다운(좌=파이어볼/우=아이스볼트 따로)
  function castSkill(id){
    const k=SKILLS.findIndex(s=>s.id===id); if(k<0) return false;
    const sk=SKILLS[k]; const now=performance.now();
    if(now < (_cdMap[id]||0)) return false;   // 해당 스킬 쿨다운 중
    _cdMap[id] = now + sk.cd;
    skillI = k;   // VFX/HUD 표시용
    if(_buffUntil && now>_buffUntil){ _buffUntil=0; _buffMult=1; }   // 버프 만료
    ctx.sound?.play?.(sk.sound);
    switch(sk.kind){
      case 'basic':      castBasicArrow(sk); break;
      case 'projectile': castProjectile(sk); break;
      case 'burst':      castBurst(sk); break;
      case 'cone':       castCone(sk); break;
      case 'buff':       castBuff(sk); break;
      case 'wall':       castWall(sk); break;
      case 'fall':       castMeteor(sk); break;
    }
    updHud(); return true;
  }
  function cast(){ return castSkill(SKILLS[skillI].id); }   // 기존 호환(휠 선택 스킬)
  function castFire(){ return castSkill('fireball'); }      // 강스킬 — 파이어볼(DoT)
  function castIce(){ return castSkill('icebolt'); }        // 강스킬 — 아이스볼트(슬로우)
  function castBasic(el){ return castSkill(el==='ice'?'basic_ice':'basic_fire'); }   // 좌클릭 = 기본 마법탄(약함, 속성=Q전환)
  function castSpell(el){ return castSkill(el==='ice'?'icebolt':'fireball'); }        // 우클릭 = 강스킬(현재 속성)
  function cycle(d){ skillI=(skillI+d+SKILLS.length)%SKILLS.length; updHud(); }

  // ── 스킬 전환 입력(지팡이 장착 시) ──
  addEventListener('wheel', e=>{ if(ctx.player?.currentTool==='staff'){ e.preventDefault(); cycle(e.deltaY>0?1:-1); } }, { passive:false });
  addEventListener('keydown', e=>{ if(ctx.player?.currentTool!=='staff') return;
    if(e.code==='BracketRight') cycle(1); else if(e.code==='BracketLeft') cycle(-1); });

  // ── HUD(현재 스킬) ──
  let hud=null;
  function buildHud(){ if(typeof document==='undefined'||hud) return;
    hud=document.createElement('div'); hud.id='magic_hud';
    hud.style.cssText='position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:13;display:none;align-items:center;gap:10px;padding:8px 16px;border-radius:12px;background:rgba(14,20,30,.78);border:1px solid rgba(201,168,90,.4);backdrop-filter:blur(6px);font:13px Pretendard,system-ui,sans-serif;color:#e9e2cf;pointer-events:none;user-select:none';
    document.body.appendChild(hud); updHud(); }
  function updHud(){ if(!hud) return; const sk=SKILLS[skillI]; const c=EL[sk.el];
    const hex='#'+c.glow.toString(16).padStart(6,'0');
    hud.innerHTML=`<span style="font-size:11px;color:#9fbac4">마법 (휠/[ ] 전환)</span>
      <b style="color:${hex};font-size:15px;text-shadow:0 0 8px ${hex}">${sk.name}</b>
      <span style="font-size:11px;color:#7f8a98">${skillI+1}/${SKILLS.length}</span>`;
  }
  buildHud();

  // ── 업데이트 ──
  ctx.onUpdate(dt=>{ dt=dt??0.016;
    // 옛 중앙 마법 HUD = 숨김(스킬바가 대체. 휠 사이클은 레거시)
    if(hud) hud.style.display = 'none';
    // 투사체
    for(let i=projectiles.length-1;i>=0;i--){ const a=projectiles[i]; a.life-=dt;
      a.grp.position.addScaledVector(a.vel, dt);
      if(a.ls) a.ls.light.position.copy(a.grp.position);   // ⚡상주 라이트가 투사체 추종
      if(a.shader){   // 셰이더 파이어볼: 진행방향 정렬 + 셰이더 time 갱신
        a._t+=dt; a.grp.lookAt(a.grp.position.clone().add(a.vel));
        for(const m of a.mats){ m.uniforms.time.value = m.uniforms.sparknoise ? -a._t/2 : -a._t/6; }
      } else if(a.arrow){   // 단순 마법 화살: 진행방향 정렬 + 가벼운 트레일
        a.grp.lookAt(a.grp.position.clone().add(a.vel));
        const p=a.grp.position, c=EL[a.el]||EL.fire;
        emit(p.x,p.y,p.z, -a.vel.x*0.05+(Math.random()-0.5)*0.5,(Math.random()-0.3)*0.5,-a.vel.z*0.05+(Math.random()-0.5)*0.5,
          Math.random()<0.6?c.core:c.glow, 0.1+Math.random()*0.08, 0.16+Math.random()*0.1, 0.5);
      } else {
        const ud=a.grp.userData; ud._t=(ud._t||0)+dt; const pulse=1+Math.sin(ud._t*30)*0.22;
        if(ud.core) ud.core.scale.setScalar(ud.size*2.4*pulse);
        if(ud.glow) ud.glow.material.rotation+=dt*1.5;
        // (구 ud.light 상시점등 — 라이트는 이제 풀 슬롯 a.ls가 추종)
        const p=a.grp.position, c=EL[a.el];   // ember 트레일(뒤로 흩뿌림+떠오름)
        for(let n=0;n<3;n++) emit(p.x+(Math.random()-0.5)*0.25, p.y+(Math.random()-0.5)*0.25, p.z+(Math.random()-0.5)*0.25,
          -a.vel.x*0.04+(Math.random()-0.5)*1.6, (Math.random()-0.2)*1.4, -a.vel.z*0.04+(Math.random()-0.5)*1.6,
          Math.random()<0.6?c.core:c.glow, 0.22+Math.random()*0.28, 0.3+Math.random()*0.2, 2.5);
      }
      let hit=null;
      for(const mn of (ctx.monsters||[])){ if(mn.dead) continue; const gp=mn.grp.position;
        const r=monR(mn)+0.4, dx=gp.x-a.grp.position.x, dy=monCY(mn)-a.grp.position.y, dz=gp.z-a.grp.position.z;
        if(dx*dx+dy*dy+dz*dz < r*r){ hit=mn; break; } }
      if(hit){ ctx.combat?._damageMonster?.(hit, a.dmg, a.grp.position.clone());
        // ★def 오염 수정: 같은 종 몹은 def 객체를 공유(스폰이 참조 공유) → speed 직접 변조 시 전 동종이 느려짐.
        //   첫 슬로우에 def를 인스턴스 복제(보스 승격과 동일 패턴) 후 변조 → 교차 영향 0. _spd0 복원 로직 그대로 유효.
        if(a.slow){ hit._slowUntil=performance.now()+a.slow*1000;
          if(hit.def && hit._spd0==null){ hit.def=Object.assign({},hit.def); hit._spd0=hit.def.speed; }
          if(hit.def) hit.def.speed=(hit._spd0||hit.def.speed)*BAL.magic.slowFactor; _slowSet.add(hit); }   // ★C(2026-07-15): 0.25 → BAL.magic.slowFactor(동작 불변)
        if(a.dot){ const nw=performance.now(); hit._dotUntil=nw+a.dotDur*1000; hit._dotDps=a.dot; hit._dotNext=nw+BAL.magic.burnTick*1000; _dotSet.add(hit); }   // 화상 도트(틱 간격=BAL.magic.burnTick, ★C 하드코딩 1000→BAL)
        ctx.sound?.play?.('spell_crit'); burst(a.grp.position.clone(), a.el, 2.4);
        scene.remove(a.grp); releaseSpellLight(a.ls); projectiles.splice(i,1); continue; }
      if(a.life<=0 || a.grp.position.y<-3){ burst(a.grp.position.clone(), a.el, 1.4); scene.remove(a.grp); releaseSpellLight(a.ls); projectiles.splice(i,1); }
    }
    // 화상 DoT — 몸을 휩싸는 화염(붙는 스프라이트) + 솟는 불씨 + 초당 데미지
    // ⚡활성 Set만 순회 — 기존엔 화상 몹 0마리여도 매 프레임 전 몹 순회. 적용 시 _dotSet.add, 만료/사망 시 delete.
    if(_dotSet.size){ const nw=performance.now();
      for(const mn of _dotSet){
        if(mn.dead || !mn._dotUntil || nw>=mn._dotUntil){
          if(mn._dotUntil) mn._dotUntil=0; if(mn._burnFx) stopBurnFx(mn); _dotSet.delete(mn); continue; }
        if(!mn._burnFx) startBurnFx(mn);
        const gp=mn.grp.position, cy=monCY(mn);
        if(Math.random()<0.7) emit(gp.x+(Math.random()-0.5)*0.5, cy+(Math.random()-0.15)*0.9, gp.z+(Math.random()-0.5)*0.5,
          (Math.random()-0.5)*0.6, 1.5+Math.random()*1.4, (Math.random()-0.5)*0.6,
          Math.random()<0.6?EL.fire.core:EL.fire.glow, 0.15+Math.random()*0.15, 0.3+Math.random()*0.18, 1.8);
        if(nw>=mn._dotNext){ mn._dotNext+=BAL.magic.burnTick*1000;   // ★C(2026-07-15): 틱 간격 하드코딩 1000→BAL.magic.burnTick
          ctx.combat?._damageMonster?.(mn, mn._dotDps, gp.clone().setComponent(1,cy), false, {feel:false}); }   // ★A5(2026-07-15): 화상 DoT 틱 — 전역 히트스톱/크리사운드 오염 방지(플레이어 미조작 슬로모 제거)
      } }
    // 슬로우 = 얼음 결정 박힘 + 청색 발광 틴트 + 떠다니는 서리 입자 / 만료 시 복구 (⚡활성 Set만 순회)
    if(_slowSet.size){ const nw=performance.now();
      for(const mn of _slowSet){
        const slowed = mn._slowUntil && nw<mn._slowUntil && !mn.dead;
        if(slowed){
          if(!mn._freezeFx) startFreezeFx(mn);
          const gp=mn.grp.position; if(Math.random()<0.5) emit(gp.x+(Math.random()-0.5)*0.6, monCY(mn)+(Math.random()-0.5)*1.0, gp.z+(Math.random()-0.5)*0.6, 0,0.25,0, (EL.ice&&EL.ice.core)||EL.fire.core, 0.14, 0.6, 1.0);
          if(!mn._frost){ mn._frost=true; mn.grp.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material]; for(const m of ms){ if(m.emissive){ if(m.__fe==null) m.__fe=m.emissive.getHex(); m.emissive.setHex(0x3a7bff); } } } }); }
        } else {
          if(mn._slowUntil){ mn._slowUntil=0; if(mn.def&&mn._spd0!=null) mn.def.speed=mn._spd0; }
          if(mn._freezeFx) stopFreezeFx(mn);
          if(mn._frost){ mn._frost=false; mn.grp.traverse(o=>{ if(o.isMesh&&o.material){ const ms=Array.isArray(o.material)?o.material:[o.material]; for(const m of ms){ if(m.emissive&&m.__fe!=null){ m.emissive.setHex(m.__fe); m.__fe=null; } } } }); }
          _slowSet.delete(mn);
        }
      } }
    // 벽 솟아오름/소멸
    for(let i=walls.length-1;i>=0;i--){ const w=walls[i]; const age=(performance.now()-w.born)/1000;
      w.mesh.scale.y=Math.min(1, age/0.3);   // 0.3s 솟음
      if(performance.now()>w.until){ const k=(performance.now()-w.until)/600; w.mesh.material.opacity*=0.92; if(k>1){ scene.remove(w.mesh); w.mesh.geometry.dispose(); w.mesh.material.dispose(); walls.splice(i,1); } } }
    // GPU 파티클 업데이트(트레일·폭발 ember)
    updateParticles(dt);
    // 상태효과 화염 스프라이트 애니(불타는 몬스터). parent 끊기면 self-clean.
    for(let i=sheetAnims.length-1;i>=0;i--){ const s=sheetAnims[i]; if(!s.parent){ sheetAnims.splice(i,1); continue; } updateSheet(s, dt); }
    // 일회성 fx
    for(let i=fx.length-1;i>=0;i--){ if(!fx[i].update(dt)) fx.splice(i,1); }
  });

  ctx.magic = { cast, castFire, castIce, castBasic, castSpell, cycle, get skill(){ return SKILLS[skillI]; }, get skills(){ return SKILLS; }, setSkill(id){ const k=SKILLS.findIndex(s=>s.id===id); if(k>=0){skillI=k;updHud();} return k>=0; },
    burnPlayer,   // 🔥 플레이어 화상 VFX(모닥불 등에서 호출)
    _projectiles:projectiles, _walls:walls, _cdMap, _resetCd(){ for(const k in _cdMap) delete _cdMap[k]; },
    _burst:(el='fire',scale=2.5)=>{ const pp=ctx.player?.pos||{x:0,y:0,z:0}; const o=new THREE.Vector3(pp.x,(pp.y||0)+1.4,pp.z).addScaledVector(ctx.player.camLook,4.5); burst(o,el,scale); } };   // 디버그: 앞 4.5m 폭발
  console.log('[magic] 초기화 — 지팡이(9) 좌클릭 시전, 휠/[ ] 스킬전환. 스킬', SKILLS.length);
  return ctx.magic;
}
