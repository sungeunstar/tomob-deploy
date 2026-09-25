// monsters.js — 몬스터(좀비·해골·유령·뱀파이어·묘지기) 스폰·추적 AI·애니. mas main.js 9658-9810 이식 + Graveyard Kit 전종.
// 주변 섬 표면에 스폰 → 어그로 시 추격·공격. hp는 cannon.js 포탄/근접으로 깎임(mn.hp/mn.kill).
// ★Graveyard Kit 5종 = 공용 리그/공용 애니(idle/walk/attack-melee-right/die) → 한 배열로 전부 호환.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';   // 드래곤 보스(meshopt 압축) 디코딩
import { FBXLoader } from '../lib/FBXLoader.patched.js';   // 신규 몹 FBX(빈 트랙 스킵 패치본 — Foe 크래시 우회)
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT (몬스터 스탯·티어·스폰)
import { createLightPool, createSlotPool, radialTexture } from './fxpool.js';   // R1: 풀/텍스처 공용화(수치·개수 불변)
import { locationReveal as ukLocation } from './uikit.js';   // 🔥 던전 보스 전멸기(Ⓖ) 경고 배너

const MON_DIR=encodeURI('/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Graveyard Kit/Models/GLB format/');
const KK_SK='/tomob-deploy/KayKit_Skeletons_1.1_FREE/KayKit_Skeletons_1.1_FREE/characters/gltf/';
const KK_ADV='/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/';   // 부족 습격병 몸(살아있는 사람) — Rig_Medium 공용 애니 호환
const KK_ANIM='/tomob-deploy/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/';
const KK_ANIM_SETS=['Rig_Medium_General.glb','Rig_Medium_MovementBasic.glb','Rig_Medium_CombatMelee.glb'];
const SKEL_ANIM='/tomob-deploy/unity_glb/skel/';   // 어둠해골(Skeleton_110) — 자체 idle만 → 외부 walk/attack/die 클립(같은 rig)
const SKEL_SETS=[['idle.glb','idle'],['walk.glb','walk'],['attack.glb','attack'],['die.glb','die']];
// ── 신규 FBX 몹 에셋 경로 ──
const MON_FBX='/tomob-deploy/monter/out/', BOMB_DIR='/tomob-deploy/monter/assets_out/', IMP_DIR='/tomob-deploy/Diablillo/';
const OPT='/tomob-deploy/monter/optimized/';   // meshopt 감축 glb (_mob_convert.html 산출물)
// ★드래곤 보스 사운드(사령관 추가, voyage/ 루트)
// ★드래곤 사운드 = sound.js SFX_DIR 통합 테이블의 이벤트키(경로는 테이블 한 곳에서만 관리·사령관). 거리감쇠는 drgVol이 opts.vol로 전달.
const DRG_SFX={ breath:'drg_breath', roar:'drg_roar', epicRoar:'drg_epicroar', growl:'drg_growl', claw:'drg_claw', wings:'drg_wings', hurt:'drg_hurt' };
// 드래곤 사운드 재생 헬퍼 — 이벤트키 + 볼륨(거리감쇠)
const drgPlay=(ctx,key,vol)=>ctx.sound?.play?.(key,{vol});
// ★몹 종류별 추격(어그로) 소리 — sound.js SFX_DIR 이벤트키. 없는 종류는 mon_growl 폴백.
const MOB_SND={ ghost:'mon_ghost', zombie:'mon_moan', vampire:'mon_hiss', slime:'mon_hiss', golem:'mon_grunt', turtle:'mon_grunt' };
// 몬스터 스탯 풀세트 (_GAME_DESIGN §6-A 수치 기획, 사령관 컨펌 2026-06-27).
//   hp 체력 · speed 이동(m/s) · atkCD 공격간격(s) · atk 공격력 · aggro 인식(m) · scale 키(m).
//   type:'kaykit' = 캐릭터 glb 애니 0 → 외부 Rig_Medium 공용 애니 로드(player.js와 동일 리그).
// ★밸런스 숫자(hp/speed/atkCD/atk/aggro/lvl/tier) = balance.js(BAL.monsters.stats) 단일 소스.
//   여기선 정체성(k/ko)·에셋(scale/url/type)만 유지. S(k)=BAL 스탯 병합.
//   재조정(2026-07-01): 성장한 플레이어(레벨 HP·공격↑)와 정합되도록 HP/공격 상향 + 티어/권장레벨 부여.
const S = k => BAL.monsters.stats[k] || {};
const MONSTERS=[
  // ── Graveyard Kit (공용 리그/내장 애니) ──
  {k:'zombie',   ko:'다곤의 익사자',   ...S('zombie'),   scale:1.7,  url:MON_DIR+'character-zombie.glb'},
  {k:'skeleton', ko:'마른 뼈다귀',     ...S('skeleton'), scale:1.45, url:MON_DIR+'character-skeleton.glb'},
  {k:'ghost',    ko:'떠도는 원혼',     ...S('ghost'),    scale:1.7,  url:MON_DIR+'character-ghost.glb'},
  {k:'vampire',  ko:'피주린 뱀파이어', ...S('vampire'),  scale:1.8,  url:MON_DIR+'character-vampire.glb'},
  // ── mas 루트 Polyart ──
  {k:'golem',    ko:'몰록의 우상',     ...S('golem'),    scale:5.0,  url:'/tomob-deploy/HP_Golem.glb'},          // Tier4 준보스 (5m)
  {k:'slime',    ko:'오염된 슬라임',   ...S('slime'),    scale:1.5,  url:'/tomob-deploy/SlimePolyart.glb'},
  {k:'turtle',   ko:'라합의 갑주귀',   ...S('turtle'),   scale:1.8,  url:'/tomob-deploy/TurtleShellPolyart.glb'},
  // ── KayKit Skeletons (외부 Rig_Medium 애니) ──
  {k:'sk_warrior',ko:'아바돈의 백골검사',   ...S('sk_warrior'), scale:1.9, type:'kaykit', url:KK_SK+'Skeleton_Warrior.glb'},
  {k:'sk_rogue',  ko:'아바돈의 무덤 도굴꾼', ...S('sk_rogue'),   scale:1.8, type:'kaykit', url:KK_SK+'Skeleton_Rogue.glb'},
  {k:'sk_mage',   ko:'아바돈의 강령술사',   ...S('sk_mage'),    scale:1.9, type:'kaykit', url:KK_SK+'Skeleton_Mage.glb'},   // 원거리(스태프)
  {k:'sk_minion', ko:'해골 졸개',          ...S('sk_minion'), scale:1.6, type:'kaykit', url:KK_SK+'Skeleton_Minion.glb'},
  // ※부족 습격병은 MONSTERS 로스터에 안 넣음 — raiders.js가 종족 모델로 opts.def 스폰(야생 랜덤스폰 오염 방지). 스탯=BAL.raider_warrior.
  // ── Unity 어둠해골 (Skeleton_110 외형 + skel/ 외부 클립) ──
  {k:'darkskel',  ko:'스올의 흑골 파수병', ...S('darkskel'), scale:2.2, type:'unityskel', url:'/tomob-deploy/Skeleton_110.glb'},
  // ── 신규 FBX 몹 (패치 FBXLoader) ── roles=클립명→표준명(idle/walk/attack) 매핑
  // ★최적화 glb (meshopt 감축 + 재질/클립 구움, 표준 GLTFLoader). 원본 FBX는 _mob_convert.html로 재생성 가능.
  {k:'creep',  ko:'아바돈의 포식귀', ...S('creep'), scale:2.2,  url:OPT+'creep.glb'},               // 15.8k→5.5k
  {k:'foe',    ko:'외눈 아나킴',     ...S('foe'),   scale:3.5,  rotY:Math.PI, url:OPT+'foe.glb'},   // 7.3k→3.7k
  {k:'mummy',  ko:'썩은 미라',       ...S('mummy'), scale:1.5,  url:OPT+'mummy.glb'},               // 6.1k→3.3k
  {k:'nghost', ko:'통곡하는 망령',   ...S('nghost'),scale:3.85, fly:true, url:OPT+'nghost.glb'},    // 6.1k→3.4k
  {k:'bat',    ko:'흡혈 밤짐승',     ...S('bat'),   scale:0.75, fly:true, url:OPT+'bat.glb'},        // 5.9k→3.2k
  {k:'imp',    ko:'붉은 세이림',     ...S('imp'),   scale:1.1,  type:'fbx', fly:true, vc:true, fbxUrl:IMP_DIR+'Treading Water.fbx', clipFiles:[{f:IMP_DIR+'Standing Melee Attack Backhand.fbx', role:'attack'}]},   // Tripo 수프=감축불가, fbx 유지
  {k:'boom',   ko:'폭렬 감시안',     ...S('boom'),  scale:1.4,  url:OPT+'boom.glb'},                // 재질/drop 구움
  // ── Tier5 보스 ──
  {k:'dragon',    ko:'레비아탄, 첫 별의 짐승', ...S('dragon'),   scale:30.0, type:'dragonboss', url:'/tomob-deploy/dragon_boss.glb'},   // 비행 보스
];
// dog(마수견)·keeper(묘지기) = 추종자로 이전 → 몬스터 로스터 제외 (2026-07-01)
const MAX=BAL.monsters.spawn.max, SPAWN_MIN=BAL.monsters.spawn.min, SPAWN_MAX=BAL.monsters.spawn.max_dist, DESPAWN=BAL.monsters.spawn.despawn;

export function initMonsters(ctx){
  const { scene } = ctx; const loader=new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); const tplCache={}; const monsters=[]; ctx.monsters=monsters;
  // ── 부족 문양 스프라이트 재질 캐시(습격병 머리 위 빌보드) ──
  const _sigilCache={}; const _sigilTL=new THREE.TextureLoader();
  function _sigilMat(url){ if(!_sigilCache[url]){ const tx=_sigilTL.load(url); tx.colorSpace=THREE.SRGBColorSpace; _sigilCache[url]=new THREE.SpriteMaterial({ map:tx, transparent:true, depthWrite:false }); } return _sigilCache[url]; }
  // ★게이트 보스 오라(2026-07-02 확정, buf.gif 기반) — 발밑 화염 사이클론이 몸을 휘감아 상승 + 더블 바닥 소용돌이 + 상승 불티.
  //   등급색(opts.auraColor). grp 자식으로 붙어 보스 따라감. 하단 백열→위로 페이드=솟구침. ★THREE.Points 아님(커스텀 GLSL 나선 유동).
  const _auraMats=[];   // {mesh,mat} — uT 갱신 + grp 제거 시 정리
  const _auraEmb=[];    // {sp,mat,...} — 불티 스프라이트(dt 갱신)
  const _AN=`
    float _ah(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float _an(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(_ah(i+vec3(0,0,0)),_ah(i+vec3(1,0,0)),f.x),mix(_ah(i+vec3(0,1,0)),_ah(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(_ah(i+vec3(0,0,1)),_ah(i+vec3(1,0,1)),f.x),mix(_ah(i+vec3(0,1,1)),_ah(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float _fbm(vec3 p){ float v=0.0,a=0.55; for(int i=0;i<5;i++){ v+=a*_an(p); p=p*2.02+11.0; a*=0.5; } return v; }`;
  const _embTex=radialTexture(64, [[0,'rgba(255,255,255,1)'],[0.4,'rgba(255,255,255,0.55)'],[1,'rgba(255,255,255,0)']]);   // R1: 색스톱 그대로
  // 세로 화염 사이클론(몸 휘감아 상승, 하단 백열)
  function _cyc(grp,col,bodyR,bodyH,o){
    const g=new THREE.CylinderGeometry(o.rT,o.rB,o.h,110,40,true);
    const m=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
      uniforms:{ uT:{value:0}, uSpin:{value:o.spin}, uFreq:{value:o.freq}, uTwist:{value:o.twist}, uLanes:{value:o.lanes}, uBright:{value:o.bright}, uSeed:{value:o.seed}, uColor:{value:col} },
      vertexShader:`varying float vAng; varying float vH; void main(){ vAng=atan(position.z,position.x); vH=uv.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:_AN+`varying float vAng; varying float vH; uniform float uT,uSpin,uFreq,uTwist,uLanes,uBright,uSeed; uniform vec3 uColor;
        void main(){ float u=vAng*uFreq+vH*uTwist+uT*uSpin; float w=_fbm(vec3(u, vH*uLanes-uT*1.9, uSeed));
          float arc=pow(smoothstep(0.55,0.88,w),1.9); float rise=1.0-smoothstep(0.04,0.96,vH); float baseHot=1.0-smoothstep(0.0,0.24,vH);
          float prof=smoothstep(0.0,0.035,vH)*rise; float I=arc*prof*uBright*(1.0+5.0*baseHot);
          vec3 hot=mix(uColor,vec3(1.0,0.96,0.82),0.3+0.5*baseHot), mid=uColor, dk=uColor*0.22;
          vec3 c=mix(dk,mix(mid,hot,smoothstep(0.5,0.95,arc)),smoothstep(0.22,0.7,arc));
          gl_FragColor=vec4(c*(0.35+3.2*I),clamp(I,0.0,1.0)); }`});
    const mesh=new THREE.Mesh(g,m); mesh.position.y=o.h*0.5; mesh.frustumCulled=false; mesh.renderOrder=4; grp.add(mesh); _auraMats.push({mesh,mat:m});
  }
  // 발밑 소용돌이(더블로 2겹 호출)
  function _swirl(grp,col,y,o){
    const g=new THREE.RingGeometry(o.rIn,o.rOut,150,8);
    const m=new THREE.ShaderMaterial({ transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
      uniforms:{ uT:{value:0}, uColor:{value:col}, uSpin:{value:o.spin}, uFreq:{value:o.freq}, uSeed:{value:o.seed}, uB:{value:o.bright}, uRin:{value:o.rIn}, uRout:{value:o.rOut} },
      vertexShader:`varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:_AN+`varying vec2 vP; uniform float uT,uSpin,uFreq,uSeed,uB,uRin,uRout; uniform vec3 uColor;
        void main(){ float ang=atan(vP.y,vP.x),rad=length(vP); float rn=clamp((rad-uRin)/(uRout-uRin),0.0,1.0);
          float w=_fbm(vec3(ang*uFreq+rn*4.0+uT*uSpin, rn*2.0, uT*0.3+uSeed)); float arc=pow(smoothstep(0.46,0.83,w),1.5);
          float prof=smoothstep(0.03,0.2,rn)*(1.0-smoothstep(0.62,1.0,rn)); float I=arc*prof*uB*2.1;
          gl_FragColor=vec4(mix(uColor*0.5,mix(uColor,vec3(1.0),0.4),arc)*(0.5+5.2*I),clamp(I,0.0,1.0)); }`});
    const mesh=new THREE.Mesh(g,m); mesh.rotation.x=-Math.PI/2; mesh.position.y=y; mesh.frustumCulled=false; mesh.renderOrder=4; grp.add(mesh); _auraMats.push({mesh,mat:m});
  }
  function applyBossAura(grp, colorHex){
    const col=new THREE.Color(colorHex||0xff7a1a); grp.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(grp), sz=box.getSize(new THREE.Vector3());
    const bodyH=Math.max(sz.y,2), bodyR=Math.max(sz.x,sz.z)*0.5*1.05;
    _cyc(grp,col,bodyR,bodyH,{rB:bodyR*1.15,rT:bodyR*0.55,h:bodyH*1.35,spin:2.0, freq:6.0,twist:7.0, lanes:2.5,bright:1.1, seed:1.0});
    _cyc(grp,col,bodyR,bodyH,{rB:bodyR*0.95,rT:bodyR*0.4, h:bodyH*1.25,spin:-1.5,freq:5.0,twist:-6.0,lanes:2.5,bright:0.95,seed:6.0});
    _cyc(grp,col,bodyR,bodyH,{rB:bodyR*1.35,rT:bodyR*0.75,h:bodyH*1.15,spin:1.1, freq:4.0,twist:8.0, lanes:1.5,bright:0.75,seed:11.0});
    _swirl(grp,col,0.05,{rIn:bodyR*0.42,rOut:bodyR*1.75,spin:1.6, freq:5.0,seed:0.0,bright:1.05});   // ★더블 바닥 소용돌이
    _swirl(grp,col,0.09,{rIn:bodyR*0.30,rOut:bodyR*1.35,spin:-1.2,freq:6.5,seed:4.0,bright:0.95});
    const ecol=col.clone().lerp(new THREE.Color(0xffffff),0.35);
    for(let i=0;i<40;i++){ const mat=new THREE.SpriteMaterial({ map:_embTex, color:ecol, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
      const sp=new THREE.Sprite(mat); sp.frustumCulled=false; grp.add(sp);
      _auraEmb.push({ sp, mat, bodyR, bodyH, life:Math.random(), a:Math.random()*6.283, r:bodyR*(0.5+Math.random()*0.7), vy:1.6+Math.random()*2.2, sz:bodyR*(0.05+Math.random()*0.06), sp2:1.5+Math.random()*2.0 }); }
  }
  // ★몹 보이스 리미팅 — 여러 몹 소리가 한꺼번에 겹쳐 뭉개지지 않게 전역 쿨다운(어그로·신음·공격 공용). 겹칠 땐 최근 것만.
  let _monVoxT=0; const MON_VOX_GAP=170;   // ms
  function monVox(key, vol){ const n=performance.now(); if(n-_monVoxT < MON_VOX_GAP) return; _monVoxT=n; ctx.sound?.play?.(key, {vol}); }
  // ── 신규 FBX 몹 로더 (패치 FBXLoader) ──
  const fbxLoader=new FBXLoader(); const texLoader=new THREE.TextureLoader();
  const loadTex=(u)=>{ const t=texLoader.load(encodeURI(u)); t.colorSpace=THREE.SRGBColorSpace; return t; };
  // 오버사이즈 텍스처 캡 — 로드 시 maxSize 초과분을 캔버스로 다운스케일(VRAM 절감). 골렘 2K 등.
  function capTextures(root, maxSize){ const seen=new Set();
    root.traverse(o=>{ const mats=Array.isArray(o.material)?o.material:[o.material];
      mats.forEach(m=>{ if(!m) return; for(const key of ['map','emissiveMap','normalMap','roughnessMap','metalnessMap']){ const t=m[key];
        if(t&&t.image&&!seen.has(t)){ seen.add(t); const w=t.image.width||0, h=t.image.height||0;
          if(Math.max(w,h)>maxSize){ const s=maxSize/Math.max(w,h); const cv=document.createElement('canvas'); cv.width=Math.max(1,Math.round(w*s)); cv.height=Math.max(1,Math.round(h*s));
            try{ cv.getContext('2d').drawImage(t.image,0,0,cv.width,cv.height); t.image=cv; t.needsUpdate=true; }catch(e){} } } } }); }); }
  // FBX 템플릿 재질(발광눈·정점색·알파·발광맵·drop메시·텍스처) — 템플릿에 1회 적용(clone이 공유)
  function applyFbxMaterials(root, def){ const drop=[];
    const map=def.tex?loadTex(def.tex):null, emap=def.emissive?loadTex(def.emissive):null;
    root.traverse(o=>{ if(!(o.isMesh||o.isSkinnedMesh)) return;   // ★frustumCulled 기본값 유지(화면 밖 컬링=perf). 예전 false는 렉 유발
      const nm=(o.name||'')+' '+((Array.isArray(o.material)?o.material[0]?.name:o.material?.name)||''); const isEye=/eye/i.test(nm);
      const junk=(def.hidePlain!==false)&&o.isMesh&&!o.isSkinnedMesh&&!isEye&&/(^|\W)(plane|floor|stage|ground|scatter|grid|reference|backdrop|box|block)(\W|\d|$)/i.test(nm);
      if(junk||(def.drop&&def.drop.test(o.name||''))){ drop.push(o); return; }
      if(isEye){ o.material=new THREE.MeshStandardMaterial({color:0xffe14a,emissive:0xffcc00,emissiveIntensity:1.8,roughness:.35}); return; }   // 발광눈(미라·Foe)
      const hasVC=!!o.geometry?.attributes?.color;
      if(def.vc&&hasVC){ o.material=new THREE.MeshStandardMaterial({vertexColors:true,color:0xffffff,roughness:.7}); return; }   // 정점색(임프)
      const mat=new THREE.MeshStandardMaterial({map:map||null,roughness:.8,metalness:.05});
      if(emap){ mat.emissive=new THREE.Color(0xffffff); mat.emissiveMap=emap; mat.emissiveIntensity=3.0; }   // 발광맵(Foe)
      if(def.alpha){ mat.transparent=true; mat.alphaTest=0.5; mat.side=THREE.DoubleSide; }                    // 알파(박쥐 날개)
      if(!map&&!emap&&!(def.vc&&hasVC)) mat.color=new THREE.Color(0x9aa4b0);
      o.material=mat; });
    drop.forEach(o=>o.removeFromParent()); }   // 폭탄 라이트박스큐브·넓적돔 제거
  async function loadFbxTpl(def, cb){
    try{ const root=await fbxLoader.loadAsync(encodeURI(def.fbxUrl)); applyFbxMaterials(root, def);
      let anims=root.animations||[];
      if(def.clipFiles){ if(anims[0]) anims[0].name='idle';   // 임프: 베이스 FBX 클립 = idle
        for(const cf of def.clipFiles){ try{ const a=await fbxLoader.loadAsync(encodeURI(cf.f)); const c=a.animations&&a.animations[0]; if(c){ c.name=cf.role; anims.push(c); } }catch(e){ console.warn('[mon] fbx clip fail',cf.f,e&&e.message); } } }
      if(def.roles){ for(const role in def.roles){ const c=anims.find(a=>a.name===def.roles[role]); if(c) c.name=role; } }   // 클립명 → 표준명
      tplCache[def.k]={ scene:root, anims }; cb(tplCache[def.k]);
    }catch(e){ console.warn('[mon] fbx load fail',def.k,e&&e.message); } }
  function loadTpl(def,cb){ if(tplCache[def.k]){ cb(tplCache[def.k]); return; }
    if(def.type==='fbx'){ loadFbxTpl(def,cb); return; }
    loader.load(def.url, async g=>{
      let anims = g.animations || [];
      if(def.type==='kaykit'){   // 캐릭터 애니 0 → 외부 Rig_Medium 공용 애니 수집
        anims = [];
        for(const s of KK_ANIM_SETS){
          try{ const ag = await loader.loadAsync(KK_ANIM+s); for(const c of ag.animations) anims.push(c); }
          catch(e){ console.warn('[mon] kk anim fail',s,e&&e.message); }
        }
      } else if(def.type==='unityskel'){   // Skeleton_110 = idle만 → 외부 skel/ 클립(같은 rig)로 walk/attack/die 보강
        anims = [];
        for(const [f,nm] of SKEL_SETS){
          try{ const ag = await loader.loadAsync(SKEL_ANIM+f); const c=ag.animations[0]; if(c){ c.name=nm; anims.push(c); } }
          catch(e){ console.warn('[mon] skel anim fail',f,e&&e.message); }
        }
      } else if(def.type==='dragonboss'){   // 드래곤 클립명을 표준명으로 매핑(idle/walk/attack/die + 비행/스폰/포효)
        for(const c of anims){ const s=c.name.split('|').pop();
          if(s.includes('Battle_Stand')) c.name='idle';
          else if(s.includes('Battle_Attack01')) c.name='atk1';     // 어택 클립들(원본 복원)
          else if(s.includes('Battle_Attack02')) c.name='atk2';
          else if(s.includes('Battle_Attack03')) c.name='atk3';
          else if(s.includes('Battle_Attack04')) c.name='atk4';
          else if(s.includes('Battle_Attack06')) c.name='atk6';
          else if(s.includes('Battle_Skill03_01')) c.name='_sk3b';
          else if(s.includes('Battle_Skill03')) c.name='breath';    // 고개 좌우 스윕 = 브레스
          else if(s.includes('Battle_Skill06')) c.name='slam';      // 헤드 슬램(땅 내리찍기)
          else if(s.includes('Battle_TurnL90')) c.name='turnL';   // 제자리 회전(좌)
          else if(s.includes('Battle_TurnR90')) c.name='turnR';   // 제자리 회전(우)
          else if(s.includes('Battle_WalkL')||s.includes('Battle_WalkR')) c.name='_walkv';
          else if(s.includes('Battle_Walk')) c.name='walk';
          else if(s.includes('Battle_Down02')) c.name='_down2';
          else if(s.includes('Battle_Down')) c.name='flydown';
          else if(s.includes('Battle_Up')) c.name='flyup';
          else if(s.includes('Spawn01')) c.name='spawn';
          else if(s.includes('Neutural_Roar')) c.name='roar';
          else if(s.includes('Death01')) c.name='_death2';
          else if(s.includes('Death')) c.name='die';
        }
        // 어두운 텍스처라 그림자서 까맣게 보임 → 텍스처 자체를 발광원으로(emissiveMap) = 항상 자기색으로 빛남
        g.scene.traverse(o=>{ if(o.isMesh){ const mm=Array.isArray(o.material)?o.material:[o.material];
          mm.forEach(m=>{ if(!m)return;
            if(m.map && ('emissiveMap' in m)){ m.emissiveMap=m.map; if(m.emissive)m.emissive.setHex(0xffffff); m.emissiveIntensity=0.7; }
            if('roughness'in m)m.roughness=0.85; if('metalness'in m)m.metalness=0.0; m.needsUpdate=true; }); } });
      }
      if(def.roles){ for(const role in def.roles){ const c=anims.find(a=>a.name===def.roles[role]); if(c) c.name=role; } }   // 클립명 → 표준명(Polyart 등 커스텀 네이밍 GLB — 부족 습격병)
      // ★TinyHero.glb 등 씬 루트에 남/여 2캐릭터가 겹쳐 든 팩 → 하나만 남김(드리프터 습격병도 겹침 방지, 사령관 2026-07-10).
      {const roots=g.scene.children.filter(c=>/character|male|female|polyart/i.test(c.name||''));
       if(roots.length>=2){ const fem=roots.filter(c=>/female/i.test(c.name||'')); (fem.length?fem:roots.slice(1)).forEach(c=>c.parent&&c.parent.remove(c)); }}
      capTextures(g.scene, 1024);   // ★오버사이즈 텍스처 캡(골렘 2K→1K 등, VRAM 절감)
      tplCache[def.k]={ scene:g.scene, anims }; cb(tplCache[def.k]);
    }, undefined, ()=>console.warn('[mon] load fail',def.k)); }

  // ─────── 고퀄 스폰 VFX: 바닥 차원 룬 + 빛 플래시 + 상승 파티클 (차원문 보라색) ───────
  // ⚡ 몹 공용 라이트 풀 — 스폰FX·볼트·브레스마다 PointLight를 scene.add/remove하면 라이트 개수 변동
  //    = 씬 전체 셰이더 재컴파일 폭탄(몹 다중 소환·습격·게이트 웨이브 프레임드랍의 주범).
  //    cannon.js·shipwreck.js와 동일 처방: 씬 상주(intensity 0) + 재사용. 색/거리 변경은 재컴파일 무관.
   // ⚡2026-07-22 축소: three.js는 `visible`인 광원을 **intensity 0이어도 픽셀마다 계산**한다.
   //   놀고 있는 풀 광원이 씬에 30개 있었고, 이게 전투 프레임 드랍의 주원인이었다(실측: 광원 38개 제외 시 렌더 584→10ms).
   //   동시에 실제로 필요한 개수만 남긴다. 고갈 시엔 빛만 생략되고 이펙트는 그대로 나온다(기존 정책 유지).
  const mobLightPool=createLightPool(scene, 4, { color:0xffffff, distance:10 });   // 8→4 (동시에 피격 플래시가 4개 넘게 겹칠 일이 없다)
  const grabMobLight=()=>mobLightPool.grab();   // 고갈 시 빛 생략(FX만)
  const releaseMobLight=s=>mobLightPool.release(s);
  const _fxRing = new THREE.RingGeometry(0.55, 1.0, 56);
  const _fxTex = radialTexture(64, [[0,'rgba(255,255,255,1)'],[0.4,'rgba(224,180,255,0.85)'],[1,'rgba(176,96,255,0)']], { srgb:true });   // R1: 색스톱 그대로
  // ⚡ 스폰FX 키트 풀 — 매 스폰 지오/머티리얼 생성·dispose(GC 스파이크) 제거. 링+파티클+라이트슬롯 재사용. R1: 슬롯풀 공용화(구성·개수 불변)
  const FX_PN=44;
  const _fxKits=createSlotPool(6, ()=>{
    const ringMat=new THREE.MeshBasicMaterial({ color:0xb060ff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide });
    const ring=new THREE.Mesh(_fxRing, ringMat); ring.rotation.x=-Math.PI/2; ring.visible=false; scene.add(ring);
    const pg=new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FX_PN*3),3));
    const pmat=new THREE.PointsMaterial({ color:0xb060ff, map:_fxTex, size:0.38, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
    const pts=new THREE.Points(pg, pmat); pts.visible=false; pts.frustumCulled=false; scene.add(pts);
    return { ring, ringMat, pg, pmat, pts, pv:new Float32Array(FX_PN) };
  });
  function spawnFX(x, y, z, scaleM){
    const kit=_fxKits.grab(); if(!kit) return;   // 고갈 시 연출 생략(몹은 정상 스폰)
    const R=Math.max(1.3,(scaleM||1.7)*0.95);
    kit.ring.position.set(x,y+0.06,z); kit.ring.scale.setScalar(R*0.3); kit.ring.rotation.z=0; kit.ringMat.opacity=0; kit.ring.visible=true;
    const ls=grabMobLight();
    if(ls){ ls.light.color.setHex(0xb060ff); ls.light.distance=R*9; ls.light.position.set(x,y+1.2,z); }
    const pa=kit.pg.attributes.position.array;
    for(let i=0;i<FX_PN;i++){ const a=Math.random()*6.283, rr=Math.random()*R*0.9; pa[i*3]=x+Math.cos(a)*rr; pa[i*3+1]=y+Math.random()*0.4; pa[i*3+2]=z+Math.sin(a)*rr; kit.pv[i]=1.6+Math.random()*3.0; }
    kit.pg.attributes.position.needsUpdate=true; kit.pmat.opacity=0.95; kit.pts.visible=true;
    let t=0; const DUR=1.2; let _last=performance.now();
    (function step(){ const _now=performance.now(); const dt=Math.min(0.05,(_now-_last)/1000); _last=_now; t+=dt; const u=Math.min(1,t/DUR);   // ★프레임률 정규화(2026-07-15): 실경과시간 기반(기존 고정 0.016=144Hz 2.4배속·30Hz 절반속)
      kit.ring.scale.setScalar(R*(0.3+u*0.95)); kit.ring.rotation.z+=dt*3.2;
      kit.ringMat.opacity=(u<0.25? u/0.25 : 1-(u-0.25)/0.75)*0.95;
      if(ls) ls.light.intensity=Math.max(0,1-u)*R*11*(u<0.12? u/0.12 : 1);
      const arr=kit.pg.attributes.position.array; for(let i=0;i<FX_PN;i++) arr[i*3+1]+=kit.pv[i]*dt;
      kit.pg.attributes.position.needsUpdate=true; kit.pmat.opacity=Math.max(0,0.9*(1-u));
      if(t<DUR) requestAnimationFrame(step);
      else { kit.ring.visible=false; kit.pts.visible=false; releaseMobLight(ls); _fxKits.release(kit); }
    })();
  }

  // opts: {at:{x,z}=무리 중심, ignoreMax=상한 무시(웨이브), aggro=스폰 즉시 추격, atR=at 중심 스캐터 반경(기본 2~8)}
  function spawn(opts){ if((!opts?.ignoreMax && monsters.length>=MAX) || !ctx.terrain || !ctx.player) return;
    const base=opts?.at || ctx.player.pos;
    // ★2026-07-10(사령관 "종족들이 겹쳐서 그대로 서있음") — opts.at 스폰 기본 반경(2~8)이 대형 모델 여러 마리엔 너무 좁아
    //   다닥다닥 겹쳤음. raiders.js가 atR로 더 넓은 반경을 줄 수 있게(다른 opts.at 소비처는 기본값 그대로 안 건드림).
    let x,z,sy=-1;
    if(opts?.fixedY && opts?.atY!=null){   // ★지하 던전 스폰(2026-07-21) — top-down groundAt(fromY=600)이 지상 바닥을 먼저 맞혀 지하 스폰이 지상에 뜸.
      //   fixedY면 groundAt 우회하고 지정 높이(atY=지하 실제 y)에 XZ만 스캐터해 스폰. (지하 바닥은 collide에 등록돼 이후 이동 groundAt은 정상)
      const a=Math.random()*6.283, d=opts.atR?(opts.atR*(0.3+Math.random()*0.7)):(2+Math.random()*6);
      x=base.x+Math.cos(a)*d; z=base.z+Math.sin(a)*d; sy=opts.atY;
    } else {
      for(let t=0;t<14;t++){ const a=Math.random()*6.283, d=opts?.at?(opts.atR?(opts.atR*(0.3+Math.random()*0.7)):(2+Math.random()*6)):(SPAWN_MIN+Math.random()*(SPAWN_MAX-SPAWN_MIN));
        x=base.x+Math.cos(a)*d; z=base.z+Math.sin(a)*d; const s=ctx.terrain.groundAt(x,z,600); if(s>0.8){ sy=s; break; } }
      if(sy<0){ if(opts?.atY!=null){ x=base.x; z=base.z; sy=opts.atY; } else return; }   // ★atY = groundAt 실패 시 강제 높이(mobtest 등 — 레이캐스트 미스여도 스폰 보장)
    }
    let def = opts?.def ? opts.def                                        // opts.def = 커스텀 def(부족 습격병 = 종족별 모델·애니)
            : opts?.k ? (MONSTERS.find(m=>m.k===opts.k) || MONSTERS[(Math.random()*MONSTERS.length)|0])
                        : MONSTERS[(Math.random()*MONSTERS.length)|0];   // opts.k = 특정 몬스터 지정 스폰(디버그/보스)
    // ★게이트 보스 승격(2026-07-02): def 인스턴스 클론 후 hp/atk/scale만 배율 → HP바·XP·영혼·공격력이 def 기반이라 전부 자동 보스값(공유 def 미오염).
    //   tier5(dragon)=네이티브 보스라 승격 안 함(1000HP×4.5 방지).
    if(opts?.dgBoss && def){
      // 던전 보스는 BAL.dungeon의 절대 목표치가 정본이다. 네이티브 T5도 같은 경로로 정규화한다.
      def = { ...def,
        hp:Math.max(1,Math.round(opts.bossHpTarget||def.hp||1)),
        atk:Math.max(1,Math.round(opts.bossAtkTarget||def.atk||1)),
        scale:(def.scale||1.7)*(opts.visualScaleMul||1) };
    } else if(opts?.boss && def && (def.tier||1) < 5){ const M=BAL.bossGate.mul;
      // ★opts.scaleMul/hpMul(2026-07-23): 던전 보스 전용 추가 배율. 오버월드 게이트 보스는 미전달(=1)이라 불변.
      //   hpMul = 사령관 "보스 체력 너무 금방 달아, 더 길게" → 던전 보스만 대폭 상향(게이트 보스 EHP 단조 불변).
      def = { ...def, hp:Math.round(def.hp*M.hp*(opts.hpMul||1)), atk:Math.round((def.atk||5)*M.atk), scale:(def.scale||1.7)*M.scale*(opts.scaleMul||1) }; }
    loadTpl(def,tpl=>{ let m; try{ m=skeletonClone(tpl.scene); }catch(e){ m=tpl.scene.clone(true); }
      m.updateMatrixWorld(true); let box=new THREE.Box3().setFromObject(m), sz=new THREE.Vector3(); box.getSize(sz);
      m.scale.setScalar((def.scale||1.7)/(sz.y||1)); m.updateMatrixWorld(true); box=new THREE.Box3().setFromObject(m); m.position.y-=box.min.y;
      if(def.rotY) m.rotation.y=def.rotY;   // ★모델 내재 정면 보정(Foe = -Z 정면 → grp이 플레이어 향할 때 맞게)
      const _cast = (def.type!=='fbx') || (def.scale||1.7)>=3.0;   // 신규 고폴리 FBX 소형몹(임프·크립 등)은 그림자 off = perf
      const _tint = (opts?.tint!=null) ? new THREE.Color(opts.tint) : null;   // ★부족 습격병 = 부족 gem색 틴트(재질 복제 필수 — skeletonClone은 재질 공유)
      m.traverse(o=>{ if(o.isMesh){ o.castShadow=_cast;
        if(_tint && o.material){ const wrap=mm=>{ const c=mm.clone(); if(c.color) c.color.lerp(_tint, 0.5); return c; };
          o.material = Array.isArray(o.material) ? o.material.map(wrap) : wrap(o.material); } } });
      const grp=new THREE.Group(); grp.add(m); grp.position.set(x,sy,z); grp.rotation.y=Math.random()*6.28; scene.add(grp);
      if(opts?.sigil){ const sp=new THREE.Sprite(_sigilMat(opts.sigil)); const _sh=(def.scale||1.7); sp.scale.set(_sh*0.55,_sh*0.55,1); sp.position.y=_sh*1.5; sp.renderOrder=6; sp.frustumCulled=false; grp.add(sp); }   // 부족 문양 배지(머리 위 — 소속 식별)
      spawnFX(x, sy, z, def.scale);                              // ★고퀄 등장 연출
      const _bornH=(def.scale||1.7)*0.9; grp.position.y = sy - _bornH;   // 바닥 밑에서 시작 → 솟아오름
      let mixer=null, actions=null;
      if(tpl.anims&&tpl.anims.length){ mixer=new THREE.AnimationMixer(m);
        const fc=(...names)=>{ for(const n of names){ const c=tpl.anims.find(a=>a.name.toLowerCase()===n); if(c)return c; } for(const n of names){ const c=tpl.anims.find(a=>a.name.toLowerCase().includes(n)); if(c)return c; } return null; };
        const mk=c=>c?mixer.clipAction(c):null;
        actions={ idle:mk(fc('idle')), walk:mk(fc('walk','walking')), run:mk(fc('sprint','run','running','walk')), attack:mk(fc('attack-melee-right','attack-melee-left','attack01','melee_1h_attack_chop','attack','melee')), die:mk(fc('die','death')),
          atk1:mk(fc('atk1')), atk2:mk(fc('atk2')), atk3:mk(fc('atk3')), atk4:mk(fc('atk4')), atk6:mk(fc('atk6')),
          breath:mk(fc('breath')), slam:mk(fc('slam')), turnL:mk(fc('turnL')), turnR:mk(fc('turnR')), flyup:mk(fc('flyup')), flydown:mk(fc('flydown')), spawn:mk(fc('spawn')), roar:mk(fc('roar')) };   // 드래곤 보스 비행/스폰/포효
        for(const kk of['attack','atk1','atk2','atk3','atk4','atk6','breath','slam']){ const a=actions[kk]; if(a)a.setLoop(THREE.LoopOnce); }   // 공격류=1회재생
        if(actions.die){ actions.die.setLoop(THREE.LoopOnce); actions.die.clampWhenFinished=true; }
        for(const kk of['idle','walk','run']){ const a=actions[kk]; if(a){ a.enabled=true; a.setEffectiveWeight(kk==='idle'?1:0); a.play(); } } }
      const _hpMul = (typeof window!=='undefined' && window.__testMode) ? 12 : 1;   // ★테스트모드=체력12배(금방 안 죽게)
      const mn={ def, grp, mesh:grp, hp:def.hp*_hpMul, maxHp:def.hp*_hpMul, isBoss:!!(opts?.boss), dgBoss:!!(opts?.dgBoss),
        xpReward:Number.isFinite(+opts?.xpReward)?Math.max(0,+opts.xpReward):null,soulReward:Number.isFinite(+opts?.soulReward)?Math.max(0,+opts.soulReward):null,
        xpMul:Math.max(0,Number.isFinite(+opts?.xpMul)?+opts.xpMul:1), _aoeCd:3.0, mixer, actions, anim:'idle', aggro:false, atkCD:0, dead:false, deathT:0,
        tribe:opts?.tribe||null, raider:!!(opts?.raider||def.raider),   // ★부족 습격병 정체성(raid.js/점령 판정용)
        _outpostTag:opts?.tag||null,   // ★BUG-018: 스폰 소스 거점(outpost 객체) 참조 — capture.removeOutpost가 언로드 시 이 태그로 자기 수비대만 정리(중복 스폰 겹침 방지)
        bornT:0.9, bornDur:0.9, spawnY:sy,   // ★등장(바닥서 솟아오름) 진행값
        kill(){ if(mn.dead)return; mn.dead=true; mn.deathT= mn.raider?2.2:1.0; ctx.ai?.tokenRelease?.(mn);   // 습격병 시체는 조금 더 오래 남김 / 🎟️토큰 반납
          try{ ctx.events?.emit?.('monsterKilled', mn); }catch(_){}   // 온보딩/계약 공용 exactly-once 신호(kill의 dead 가드 뒤라 1회)
          if(mn._breath) breathStreamStop(mn);   // ★A3(2026-07-15): 브레스 분사 중 사망 시 화염 파티클(240 Points)+풀 라이트 영구 누수 차단. onEnd가 안 불리던 것 방어.
          mn.atk=null;                            // 진행 중 공격 러너 취소(사망 후 잔여 tick 방지)
          if(!mn.raider) ctx.sound?.play?.('mon_death');   // ★습격병(사람)은 몬스터 사망소리 안 냄(사령관 — 사람소리 에셋 생기면 배선)
          let hasDie=false;
          if(actions){ for(const kk of['idle','walk','run','attack']){ const a=actions[kk]; if(a)a.setEffectiveWeight(0); }
            if(actions.die){ actions.die.reset(); actions.die.setEffectiveWeight(1); actions.die.play(); hasDie=true; } }
          if(!hasDie) mn._fallDown=true;   // ★die 클립 없으면 물리로 쓰러뜨림(서있는 시체 버그, 사령관)
        } };
      if(opts?.aggro){ mn.aggro=true; mn._forceAggro=true; }   // 웨이브 = 스폰 즉시 플레이어로 쇄도(지각 우회 상시 어그로)
      if(opts?.wander){ mn.wander=true; mn.home=opts.home||{x,z,r:30};   // ★배회: 홈 주변을 천천히 돌아다님
        mn.wTarget=null; mn.wPause=Math.random()*2; }
      if(opts?.boss) applyBossAura(grp, opts.auraColor);   // ★게이트 보스 = 프레넬 오라 부착
      monsters.push(mn); });
  }
  // ★크로스페이드 전환 — 즉시 weight 교체(튀는 "뚝뚝") → 짧은 페이드로 부드럽게.
  function setAnim(mn, name, fade){ if(mn.anim===name||!mn.actions) return; const cur=mn.actions[mn.anim], nx=mn.actions[name];
    if(nx){ fade=(fade==null?0.22:fade);
      nx.enabled=true; nx.setEffectiveTimeScale(1); nx.setEffectiveWeight(1);
      if(nx.loop===THREE.LoopOnce) nx.reset();
      if(cur && fade>0 && cur!==nx){ nx.play(); nx.crossFadeFrom(cur, fade, false); }
      else { if(cur)cur.setEffectiveWeight(0); if(!nx.isRunning())nx.play(); }
    }
    mn.anim=name; }
  // ★부드러운 선회 — 즉시 스냅(rotation.y=atan2) 폐지: 최단각 보간(rate/s). 사령관 "몹들이 사방을 홱홱 쳐다봄" 지적(2026-07-05).
  function _turnTo(g, ty, dt, rate){ let d=ty-g.rotation.y; d=Math.atan2(Math.sin(d),Math.cos(d)); g.rotation.y+=d*Math.min(1,(dt||0.016)*(rate||8)); }

  // ─────── 애니 길이 기반 공격 러너 — ★클립을 끝까지 재생(중간에 안 끊음 = 뚝뚝 끊김 해결) ───────
  //   spec = { name, anim, cd, gcd, dur?, hits:[{at,dmg,range,sfx}], onStart?, onTick?, onEnd? }
  //     · anim : 공격 클립(끝까지 재생). dur 미지정 시 = 클립 길이.
  //     · hits : 데미지 시점(at=클립진행 0~1). 사거리 내면 명중(회피=그 전에 빠지기).
  //     · onTick(mn,cp,dt,u) : 매프레임(지속 VFX·이동 등) / onStart·onEnd : 1회(VFX 생성/정리)
  function startAttack(mn, spec){
    if(spec.anim) setAnim(mn, spec.anim, 0.25);
    const act=mn.actions&&mn.actions[spec.anim];
    const dur = spec.dur || (act&&act.getClip? act.getClip().duration : 0) || 1;
    mn.atk={ spec, t:0, dur, fired:[] };
    if(spec.onStart) spec.onStart(mn, ctx.player?.pos); }
  function runAttack(mn, dt, cp){ const a=mn.atk; if(!a) return false; a.t+=dt; const u=a.t/a.dur;
    if(a.spec.onTick) a.spec.onTick(mn, cp, dt, u);
    const hits=a.spec.hits||[];
    for(let i=0;i<hits.length;i++){ const h=hits[i]; if(!a.fired[i] && u>=h.at){ a.fired[i]=true;
      // 🛡 습격병이 용병(garrison)과 교전 중이면 타격 대상=용병(전사 시 garrison.killUnit). 아니면 기존대로 플레이어.
      const _mt=(mn._mercT && mn._mercT.hp>0) ? mn._mercT : null;
      const dd=Math.hypot((_mt?_mt.x:cp.x)-mn.grp.position.x, (_mt?_mt.z:cp.z)-mn.grp.position.z);
      if(dd <= (h.range||3)){
        if(_mt){ _mt.hp-=(h.dmg||5); if(_mt.hp<=0) ctx.garrison?.killUnit?.(_mt); }
        else { ctx.combat?.hitPlayer?.(h.dmg||5);
          // ★2026-07-24 넉백은 이제 **hit에 h.knock 값이 있을 때만**(Ⓑ 도약 강타 전용). 구 버전은 던전 보스의
          //   모든 근접타에 자동 넉백이라 "밀치기가 기본 스킬"처럼 됐다(사령관 "밀치기가 기본 스킬이 아니라").
          if(h.knock && ctx.player?.knockback) ctx.player.knockback(cp.x-mn.grp.position.x, cp.z-mn.grp.position.z, h.knock, 320);
        }
      }
      if(h.sfx){ if(mn.def?.type==='dragonboss') ctx.sound?.play?.(h.sfx,{vol:drgVol(mn,0.75)}); else monVox(h.sfx, 0.6); } } }   // 드래곤=직접 / 일반몹 공격음=보이스 리미팅
    if(a.t>=a.dur){ const sp=a.spec; if(sp.onEnd)sp.onEnd(mn); mn.atk=null;
      mn.acd=mn.acd||{}; mn.acd[sp.name]=(sp.cd||2.0)*(mn.cdScale||1); mn.gcd=(sp.gcd!=null?sp.gcd:0.5)*(mn.cdScale||1); return false; }
    return true; }
  function tickCD(mn, dt){ if(mn.gcd>0)mn.gcd-=dt; if(mn.acd){ for(const k in mn.acd){ if(mn.acd[k]>0)mn.acd[k]-=dt; } } }
  function atkReady(mn, name){ return (mn.gcd||0)<=0 && (!mn.acd||(mn.acd[name]||0)<=0); }
  // 잡몹 근접 = 공격 클립 끝까지 재생, 클립 중반(0.45)에 사거리 내면 명중(그 전에 빠지면 회피).
  const MOB_RANGE=2.6;
  function mobMeleeSpec(mn){ const D=mn.def; return { name:'melee', anim:'attack', cd:D.atkCD||1.1, gcd:0,
    hits:[{ at:0.45, dmg:D.atk||6, range:MOB_RANGE+0.5, sfx:'mon_atk' }],   // 통합 테이블(atk1·2 랜덤)
    onEnd:(m)=>setAnim(m,'idle',0.25) }; }

  // ═══════ 신규 몹 공격 VFX (게임 magic 스펠 텍스처 + 플립북 — 값싼 Points 아님) ═══════
  const SPT='/tomob-deploy/spellfx/textures/', VFXS='/tomob-deploy/vfx/sheets/';
  const _mt=(u)=>{ const t=texLoader.load(encodeURI(u)); t.colorSpace=THREE.SRGBColorSpace; return t; };
  const MT_GLOW=_mt(SPT+'gradient_radial_01.png'), MT_FLARE=_mt(SPT+'flare_01.png');
  const monFx=[];
  const _spr=(map,color,size,blend)=>{ const s=new THREE.Sprite(new THREE.SpriteMaterial({map,color,transparent:true,depthWrite:false,blending:blend??THREE.AdditiveBlending})); s.scale.setScalar(size); return s; };
  function monLight(pos,color,inten,life){ const s=grabMobLight(); if(!s) return;   // ⚡풀 슬롯(add/remove 금지 — 재컴파일 방지)
    s.light.color.set(color); s.light.distance=10; s.light.position.copy(pos); s.light.intensity=inten;
    monFx.push({t:'light',o:s,base:inten,life,age:0}); }
  function monBurst(pos,color){ const s=_spr(MT_GLOW,color,1.0); s.position.copy(pos); scene.add(s); monFx.push({t:'burst',o:s,life:0.35,age:0}); monLight(pos,color,5,0.3); }
  function playFlip(pos,file,c,r,size,color){ const t=texLoader.load(encodeURI(VFXS+file)); t.colorSpace=THREE.SRGBColorSpace; t.repeat.set(1/c,1/r); t.offset.set(0,1-1/r);
    const sp=_spr(t,color||0xffffff,size); sp.position.copy(pos); scene.add(sp); monFx.push({t:'flip',o:sp,map:t,c,r,total:c*r,life:(c*r)/34,age:0}); }
  function monBolt(from,target,color,dmg){ const g=new THREE.Group(); g.position.copy(from);
    g.add(_spr(MT_GLOW,color,0.9)); g.add(_spr(MT_FLARE,0xffffff,0.4)); scene.add(g);
    const ls=grabMobLight();   // ⚡풀 슬롯 — 그룹에 안 붙이고(개수 불변) 매 프레임 볼트 위치 추종
    if(ls){ ls.light.color.set(color); ls.light.distance=6; ls.light.intensity=4; ls.light.position.copy(from); }
    const dir=new THREE.Vector3().subVectors(target,from); const dist=dir.length()||1; dir.normalize();
    monFx.push({t:'bolt',o:g,ls,dir,speed:24,color,dmg,left:dist+2,age:0,life:3}); }
  function updateMonFx(dt){ for(let i=monFx.length-1;i>=0;i--){ const f=monFx[i]; f.age+=dt; const k=Math.max(0,1-f.age/(f.life||0.4));
    if(f.t==='bolt'){ const mv=f.speed*dt; f.o.position.addScaledVector(f.dir,mv); f.left-=mv;
      if(f.ls) f.ls.light.position.copy(f.o.position);   // ⚡상주 라이트가 볼트 추종
      if(f.left<=0||f.age>f.life){ const p=f.o.position.clone(); releaseMobLight(f.ls); monBurst(p,f.color);
        const cp=ctx.player?.pos; if(cp&&f.dmg){ const d=Math.hypot(cp.x-p.x,cp.z-p.z,(cp.y||0)+1-p.y); if(d<3.2) ctx.combat?.hitPlayer?.(f.dmg); }
        f.o.removeFromParent(); f.o.traverse(o=>o.material?.dispose?.()); monFx.splice(i,1); } continue; }
    if(f.t==='flip'){ const fr=Math.min(f.total-1,Math.floor(f.age/f.life*f.total)); f.map.offset.x=(fr%f.c)/f.c; f.map.offset.y=1-(Math.floor(fr/f.c)+1)/f.r; f.o.material.opacity=k;
      if(f.age>=f.life){ f.map.dispose(); f.o.removeFromParent(); f.o.material.dispose(); monFx.splice(i,1); } continue; }
    if(f.t==='burst'){ f.o.scale.setScalar(1+(1-k)*2.5); f.o.material.opacity=k; if(f.age>=f.life){ f.o.removeFromParent(); f.o.material.dispose(); monFx.splice(i,1); } continue; }
    if(f.t==='light'){ f.o.light.intensity=f.base*k; if(f.age>=f.life){ releaseMobLight(f.o); monFx.splice(i,1); } continue; }   // ⚡풀 반납
  } }
  // 원거리 몹(통곡하는 망령·강령술사) — 공격 애니 중 볼트 발사
  function rangedSpec(mn){ const D=mn.def; const col=(D.k==='sk_mage')?0x8ad8ff:0x9be8ff;
    return { name:'ranged', anim:(mn.actions?.attack?'attack':'idle'), cd:D.atkCD||1.4, gcd:0.3, dur:(mn.actions?.attack?undefined:0.7),
      onStart:(m)=>{ const cp=ctx.player?.pos; if(!cp)return; const g=m.grp;
        const from=new THREE.Vector3(g.position.x, g.position.y+(D.scale||1.7)*0.55, g.position.z);
        const target=new THREE.Vector3(cp.x,(cp.y||0)+1.0,cp.z);
        monBolt(from,target,col,Math.round(D.atk||14)); ctx.sound?.play?.(D.k==='sk_mage'?'spell_ice':'mon_ghost',{vol:0.4}); },
      onEnd:(m)=>setAnim(m,'idle',0.25) }; }
  // 자폭 몹(폭렬 감시안) — 근접 도달 시 폭발(플립북+광역뎀+자멸)
  function boomExplode(mn,cp){ if(mn._boomed)return; mn._boomed=true; const g=mn.grp;
    const p=new THREE.Vector3(g.position.x,g.position.y+0.5,g.position.z);
    playFlip(p,'explosion_6x5.png',6,5,3.2,0xffdca0); monLight(p,0xffd08a,14,0.4); monBurst(p,0xffcf8a);
    const d=Math.hypot(cp.x-g.position.x,cp.z-g.position.z); if(d<(mn.def.scale||1.4)*2.0+2.5) ctx.combat?.hitPlayer?.(Math.round(mn.def.atk||55));
    ctx.sound?.play?.('mon_death',{vol:0.7}); mn.kill?.(); }
  // 미라 강타 — 근접 + 지면 임팩트 VFX
  function mummySmashSpec(mn){ const D=mn.def; return { name:'melee', anim:'attack', cd:D.atkCD||1.3, gcd:0,
    hits:[{ at:0.4, dmg:D.atk||7, range:MOB_RANGE+0.6, sfx:'mon_atk' }],
    onStart:(m)=>{ m._smk=false; }, onTick:(m,cp,dt,u)=>{ if(!m._smk&&u>=0.4){ m._smk=true; const g=m.grp; monBurst(new THREE.Vector3(g.position.x,g.position.y+0.15,g.position.z),0xffcf8a); } },
    onEnd:(m)=>setAnim(m,'idle',0.25) }; }
  // 박쥐 머리박기 돌진 — 공격 클립 없음 → 절차 급강하(앞·아래로 처박고 복귀)
  function batDiveSpec(mn){ const D=mn.def; return { name:'dive', anim:'idle', cd:D.atkCD||1.0, gcd:0.2, dur:0.9,
    onStart:(m)=>{ m._hitd=false; }, onTick:(m,cp,dt,u)=>{ const g=m.grp; const dx=cp.x-g.position.x, dz=cp.z-g.position.z, dd=Math.hypot(dx,dz)||1;
      if(u<0.5){ g.position.x+=dx/dd*(D.speed||3)*1.5*dt; g.position.z+=dz/dd*(D.speed||3)*1.5*dt; g.rotation.x=u*0.9;
        if(!m._hitd&&dd<2.6){ m._hitd=true;const dmg=Math.round(D.atk||5);ctx.combat?.hitPlayer?.(dmg);ctx.sound?.play?.('mon_atk',{vol:0.5}); } }
      else { g.rotation.x=(1-u)*0.9; } },
    onEnd:(m)=>{ m.grp.rotation.x=0; setAnim(m,'idle',0.25); } }; }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔥 던전 보스 공격 세트 (2026-07-24 재설계) — 정본 설계=`_보스패턴_설계.md`.
  //   엘든링 원칙: ①거리별 기술 ②경직=플레이어 딜타임 ③예고→발동→경직 한 동작 ④풀에서 직전 기술 제외.
  //   기존 startAttack/runAttack 러너 재사용(anim·hits·onStart/onTick/onEnd). 넉백은 h.knock 있을 때만.
  //   ⚠️클립 이름은 KayKit 스켈레톤 기준(attack/atk1~). 없으면 'attack'로 폴백(setAnim이 처리).
  const DG = () => ({
    // Ⓐ 연격 3타 — 근접 기본기. 경직(cd) 1.5s = 주 딜타임. 마지막 타 살짝 지연.
    combo:(m)=>{ const D=m.def, atk=D.atk||30, rng=6.0;
      return { name:'combo', anim:(m.actions?.attack?'attack':'idle'), dur:1.9, cd:1.5, gcd:0.4,
        hits:[{at:0.25,dmg:Math.round(atk*0.5),range:rng,sfx:'mon_atk'},
              {at:0.50,dmg:Math.round(atk*0.5),range:rng,sfx:'mon_atk'},
              {at:0.82,dmg:Math.round(atk*0.8),range:rng+1,sfx:'mon_atk'}],   // 지연 마무리
        onStart:(mm)=>{ mm._sw=false; },
        onTick:(mm,cp,dt,u)=>{ if(!mm._sw && u>=0.80){ mm._sw=true;   // ⚔️ 마무리타에 수평 소용돌이 불꽃(ref/boss/연격.jpg)
          const g=mm.grp; dgSwirlRing(g.position.x, g.position.y, g.position.z, 6.5); } },
        onEnd:(mm)=>setAnim(mm,'idle',0.25) }; },
    // Ⓑ 도약 강타 → 밀치기 ★사령관 지시 그대로: 장판 예고 → 날아와서 쿵 → 밀침.
    //   예고(균열, 1.3s) → 도약(실제로 떠서 플레이어 위로 이동, 0.55s) → 착지 쿵(충격파+넉백) → 경직 1.8s.
    //   균열 밖이면 완전 회피(무피해·무넉백). "패턴 피하는 느낌"의 핵심.
    leap:(m)=>{ const D=m.def, atk=D.atk||30, R=5.5;
      return { name:'leap', anim:(m.actions?.attack?'attack':'idle'), dur:2.1, cd:5.5, gcd:0.6,
        onStart:(mm)=>{ const cp=ctx.player?.pos; if(!cp) return;
          mm._leap={ tx:cp.x, tz:cp.z, sx:mm.grp.position.x, sz:mm.grp.position.z, done:false };
          let gy=cp.y-0.9; try{ if(ctx.terrain?.groundAt){ const gg=ctx.terrain.groundAt(cp.x,cp.z,cp.y+3); if(gg>-1e7) gy=gg; } }catch(_){}
          mm._leap.gy=gy; spawnAoe(cp.x, gy, cp.z, R, 1.3, Math.round(atk*1.2), { style:'radial' }); },
        onTick:(mm,cp,dt,u)=>{ const L=mm._leap; if(!L) return; const g=mm.grp;
          if(u>=0.62 && u<0.90){ const t=(u-0.62)/0.28;                                     // 도약 궤적(대상 위로)
            g.position.x = L.sx + (L.tx-L.sx)*t; g.position.z = L.sz + (L.tz-L.sz)*t;
            g.position.y = (L.gy||g.position.y) + Math.sin(t*Math.PI)*4.5; }
          else if(u>=0.90 && !L.done){ L.done=true; g.position.set(L.tx, L.gy||g.position.y, L.tz);   // 착지 쿵
            dgLeapImpact(L.tx, L.gy||g.position.y, L.tz);   // 💥 크레이터+파편+스파크기둥+불링(ref/boss/도약.jpg)
            const dd=Math.hypot(cp.x-L.tx, cp.z-L.tz);
            if(dd<=R){ const dmg=Math.round(atk*1.2);ctx.combat?.hitPlayer?.(dmg);
              if(ctx.player?.knockback) ctx.player.knockback(cp.x-L.tx, cp.z-L.tz, 17, 340); } } },   // 용암 쪽으로 강한 넉백
        onEnd:(mm)=>{ mm._leap=null; if(mm.grp) mm.grp.position.y = mm.grp.position.y; setAnim(mm,'idle',0.25); } }; },
    // Ⓒ 돌진 관통 — 중거리. 예고 후 직선 돌진, 옆으로 굴러 회피.
    charge:(m)=>{ const D=m.def, atk=D.atk||30;
      return { name:'charge', anim:(m.actions?.run?'run':'idle'), dur:1.4, cd:6.5, gcd:0.5,
        onStart:(mm)=>{ const cp=ctx.player?.pos; if(!cp) return; const g=mm.grp;
          const dx=cp.x-g.position.x, dz=cp.z-g.position.z, dd=Math.hypot(dx,dz)||1;
          mm._chg={ dx:dx/dd, dz:dz/dd, hit:false }; g.rotation.y=Math.atan2(dx,dz); },
        onTick:(mm,cp,dt,u)=>{ const C=mm._chg; if(!C) return; const g=mm.grp;
          if(u>0.35 && u<0.85){ const sp=(D.speed||3)*4.2;                                   // 예고 후 가속 돌진
            const nx=g.position.x+C.dx*sp*dt, nz=g.position.z+C.dz*sp*dt;
            let gy=g.position.y; try{ if(ctx.terrain?.groundAt){ const gg=ctx.terrain.groundAt(nx,nz,g.position.y+2.5); if(gg>0.3&&gg-g.position.y<=2.0) gy=gg; } }catch(_){}
            g.position.x=nx; g.position.z=nz; g.position.y+=(gy-g.position.y)*Math.min(1,dt*10);
            const pd=Math.hypot(cp.x-g.position.x, cp.z-g.position.z);
            if(!C.hit && pd<3.0){ C.hit=true; ctx.combat?.hitPlayer?.(Math.round(atk*0.9)); dgBossSlamFx(g.position.x,g.position.y,g.position.z); } } },
        onEnd:(mm)=>{ mm._chg=null; setAnim(mm,'idle',0.25); } }; },
    // Ⓓ 균열 추격 3연 — 중거리. 플레이어 방향으로 직선 균열이 3번 뻗어옴(점점 빨라짐). 옆으로 이동해 회피.
    fissure:(m)=>{ const D=m.def, atk=D.atk||30;
      return { name:'fissure', anim:(m.actions?.attack?'attack':'idle'), dur:2.3, cd:7.0, gcd:0.5,
        onStart:(mm)=>{ mm._fis={ n:0, cd:0.15 }; },
        onTick:(mm,cp,dt,u)=>{ const F=mm._fis; if(!F || F.n>=3) return; F.cd-=dt;
          if(F.cd<=0){ F.n++; F.cd = 0.7 - F.n*0.12;                                          // 간격 점점 짧게
            const g=mm.grp; const ang=Math.atan2(cp.z-g.position.z, cp.x-g.position.x);
            const mx=(g.position.x+cp.x)/2, mz=(g.position.z+cp.z)/2;
            let gy=g.position.y; try{ if(ctx.terrain?.groundAt){ const gg=ctx.terrain.groundAt(mx,mz,g.position.y+3); if(gg>-1e7) gy=gg; } }catch(_){}
            spawnAoe(mx, gy, mz, 7.5, 0.55, Math.round(atk*0.7), { style:'line', angle:ang });
            dgEruption(cp.x, gy, cp.z); } },   // 🌋 플레이어 지점에 수직 화염 분출(ref/boss/균열.jpg)
        onEnd:(mm)=>{ mm._fis=null; setAnim(mm,'idle',0.25); } }; },
    // Ⓖ 전멸기(기둥 뒤로) — 페이즈2 1회 + 40s. 시야에 석주 없으면 즉사급. 정본=설계 §Ⓖ.
    //   판정=LOS(보스→플레이어 직선상 석주). 바닥 안전지대 데칼이 아니라 공간으로 푼다.
    nuke:(m)=>{ const D=m.def;
      return { name:'nuke', anim:(m.actions?.roar?'roar':(m.actions?.attack?'attack':'idle')), dur:4.5, cd:40, gcd:1.0,
        onStart:(mm)=>{ mm._nuke={ warned:false, blown:false };
          try{ ukLocation && ukLocation({ name:'분화', band:'석주 뒤로 숨어라' }); }catch(_){}
          const g=mm.grp; monLight({x:g.position.x,y:g.position.y+3,z:g.position.z}, 0xff5a1e, 40, 4.4); },
        onTick:(mm,cp,dt,u)=>{ const K=mm._nuke; if(!K) return; const g=mm.grp;
          // 격자 균열 예고 — 아레나 전체가 달아오름(발밑 여러 곳에 방사 균열)
          if(!K.warned && u>=0.15){ K.warned=true;
            for(let a=0;a<6;a++){ const ang=a*Math.PI/3, rx=g.position.x+Math.cos(ang)*9, rz=g.position.z+Math.sin(ang)*9;
              spawnAoe(rx, g.position.y, rz, 6, 4.5*(1-0.15), 0, { style:'radial' }); } }
          if(!K.blown && u>=0.97){ K.blown=true;
            // 발동 — LOS 판정. 보스→플레이어 직선상에 석주(solidGrp trimesh)가 있으면 안전.
            let safe=false;
            try{ const from=new THREE.Vector3(g.position.x, g.position.y+1.4, g.position.z);
              const to=new THREE.Vector3(cp.x,(cp.y||0)+1.2,cp.z);
              const dir=to.clone().sub(from); const len=dir.length(); dir.normalize();
              const rc=new THREE.Raycaster(from, dir, 0.5, len-1.0);
              const root=ctx.__dgRoot;   // dungeonrun이 세팅(2231행). 석주·벽 전부 이 아래에 있다.
              const hits=root? rc.intersectObject(root, true):[];
              safe = hits.some(h=> h.object && h.object.visible!==false);   // 뭐라도 가리면 안전
            }catch(_){}
            dgNukeBurst(g.position.x, g.position.y, g.position.z);   // ☄️ 팽창 불돔+중심 오브(ref/boss/전멸기.jpg)
            if(!safe) ctx.combat?.hitPlayer?.(9999);   // 차폐 실패 = 즉사급
            try{ ctx.sound?.sfxPath?.('/tomob-deploy/crash.mp3', 0.4); }catch(_){}
          } },
        onEnd:(mm)=>{ mm._nuke=null; setAnim(mm,'idle',0.25); } }; },
  });
  // 던전 보스 행동 선택 — 거리대 풀 + 직전 기술 제외 + 페이즈2 전멸기.
  function dgBossSpec(mn, dist){
    const P = DG(); mn.phase = (mn.hp <= mn.maxHp*0.5) ? 2 : 1;
    // 페이즈2 진입 시 전멸기 1회 강제 + 이후 40s 쿨(acd로 관리)
    if(mn.phase===2 && !mn._nukeArmed){ mn._nukeArmed=true; mn._forceNuke=true; }
    if(mn._forceNuke && atkReady(mn,'nuke')){ mn._forceNuke=false; return P.nuke(mn); }
    if(mn.phase===2 && atkReady(mn,'nuke') && Math.random()<0.12) return P.nuke(mn);
    // 거리대 풀
    let pool;
    if(dist < 8)       pool = ['combo','combo','leap','fissure'];         // 근접 = 연격 위주
    else if(dist < 22) pool = ['charge','fissure','leap'];                // 중거리
    else               pool = ['charge','fissure'];                        // 원거리 = 붙이기
    pool = pool.filter(n => n !== mn._lastAtk);                            // 직전 제외(연속 반복 금지)
    if(!pool.length) pool = ['combo'];
    // 쿨다운 걸린 것 제외(연격은 항상 가능)
    let ready = pool.filter(n => n==='combo' || atkReady(mn, n));
    if(!ready.length) ready = ['combo'];
    const pick = ready[(Math.random()*ready.length)|0];
    mn._lastAtk = pick;
    return P[pick](mn);
  }

  // ═══════ [S3] 보스 컨트롤러 (공격풀 + 페이즈) — 잡몹 FSM과 별개, 재사용 가능 ═══════
  //  지각 → 행동선택(거리·쿨다운·페이즈) → 텔레그래프(러너) → 실행 → 쿨다운 → 반복.
  //  비행 자세(피치/뱅크)는 각 공격 phase의 move가 mn.pitchTarget/bankTarget 설정 → 매프레임 lerp.
  const DR_FLYH = 55;                       // 드래곤 비행 고도(지면 위 m) — 거대해서 높게
  // [S4] 드래곤 공격풀 (엘든링식) — 지상 위주: tailswipe(기본 근접)·breath(입에서 몇 초 불뿜기). 비행=가끔 천천히.
  //   ★공격 클립을 끝까지 재생(중간 안 끊음). hits=클립 진행도(at) 시점 명중.
  // ★드래곤 소리 거리 감쇠 — sfxPath는 2D(위치 무관)라 그냥 쓰면 하늘/멀리 있어도 귀 옆처럼 풀볼륨. 플레이어~드래곤 거리로 볼륨 조정(near=풀·far=희미).
  function drgVol(m, base){ const cp=ctx.player?.pos; if(!cp||!m?.grp) return base; const g=m.grp;
    const d=Math.hypot(cp.x-g.position.x, cp.z-g.position.z), sc=(m.def?.scale||18);
    const t=Math.max(0, Math.min(1, 1-(d-sc*4)/(sc*22-sc*4)));   // ★완화: near=sc*4(풀볼륨)~far=sc*22. 착지 등 근거리 소리가 안 죽게.
    return base*(0.4+0.6*t); }   // 최소 0.4 — 멀어도 들림(기존 0.12는 착지음까지 죽였음)
  function dragonAtks(mn){ const D=mn.def;
    const RR=(mn.def?.scale||11)/6;   // 크기 비례 사거리 배율
    const bite=(clip)=>({ name:'bite', anim:clip, cd:0.8, gcd:0.15,   // ★기본 물기(atk4/6, 3.3s). 애니 실측: 머리 당김u0.33→무는 순간u0.88.
      onStart:(m)=>drgPlay(ctx, DRG_SFX.growl,drgVol(m,0.6)),   // 예비동작 으르렁
      hits:[{ at:0.85, dmg:D.atk||40, range:13*RR, sfx:DRG_SFX.claw }] });   // ★명중=무는 순간(u0.85) + 발톱 타격음
    return {
      bite4: bite('atk4'), bite6: bite('atk6'),                       // 기본 물기 2종(번갈아)
      heavy: { name:'heavy', anim:'atk1', cd:6.0, gcd:0.5,            // 긴 콤보(atk1, 8.1s) — 애니 실측: 두 번 내지름 u0.42, u0.90.
        onStart:(m)=>drgPlay(ctx, DRG_SFX.roar,drgVol(m,0.7)),
        hits:[{ at:0.42, dmg:D.atk||40, range:14*RR, sfx:DRG_SFX.claw }, { at:0.90, dmg:Math.round((D.atk||40)*0.9), range:14*RR, sfx:DRG_SFX.claw }] },
      tail: { name:'tail', anim:'atk3', cd:7.0, gcd:0.5,             // 꼬리/스핀(가끔) — 옆으로 휩쓺, 사거리 김
        onStart:(m)=>drgPlay(ctx, DRG_SFX.growl,drgVol(m,0.7)),
        hits:[{ at:0.45, dmg:Math.round((D.atk||40)*1.1), range:18*RR, sfx:DRG_SFX.claw }] },
      breath: { name:'breath', anim:'breath', cd:5.0, gcd:0.7,      // ★주력. 애니 실측: u0.33 머리 당김(흡기)→u0.42~0.62 머리 앞으로 내밈(분사)→u0.79 당김.
        onStart:(m)=>{ breathTelegraph(m); },                       // 흡기 텔레그래프(입가 글로우 차오름) — 분사 전 예고
        onTick:(m,cp,dt,u)=>{
          const fire = (u>0.40 && u<0.64);                          // ★실측 분사 구간(머리 최전방). 기존 0.22~0.85는 흡기/후딜까지 뿜어 타이밍 엉망이었음.
          if(fire && !m._breath){ breathStreamStart(m); drgPlay(ctx, DRG_SFX.breath,drgVol(m,0.95)); }   // ★소리=분사 시작에 정확히(onStart 아님)
          if(m._breath){ const inten = fire?1:Math.max(0,1-(u-0.64)/0.10); breathStreamUpdate(m,cp,dt,inten); }   // 방향=머리(mouthPos, breathStreamUpdate 내부)
          if(fire){ m._dot=(m._dot||0)-dt; if(m._dot<=0){ m._dot=0.35; const dd=Math.hypot(cp.x-m.grp.position.x,cp.z-m.grp.position.z); if(dd<(D.scale||18)*2.2) ctx.combat?.hitPlayer?.(Math.round((D.atk||40)*(m.phase===2?0.4:0.28))); } } },
        onEnd:(m)=>breathStreamStop(m) },
      dive: { name:'dive', anim:'flyup', cd:11.0, gcd:1.0, dur:6.6,   // 공중 점프(30%) — 천천히 상승→호버→내리꽂기
        onStart:(m)=>{ m._dv='ascend'; m._dvHit=false; drgPlay(ctx, DRG_SFX.wings,drgVol(m,0.85)); },
        onTick:(m,cp,dt,u)=>{ const g=m.grp, ht=m.groundY+DR_FLYH;
          if(m._dv==='ascend'){ g.position.y+=(ht-g.position.y)*Math.min(1,dt*0.85); m.pitchTarget=-0.5; m.bankTarget=0.08*Math.sin(u*7); setAnim(m,'flyup',0.3);
            if(g.position.y>=ht-3){ m._dv='hover'; m._dvT=0; } }
          else if(m._dv==='hover'){ m._dvT+=dt; g.position.y+=(ht-g.position.y)*Math.min(1,dt*1.0)+Math.sin(m._dvT*2.5)*dt*0.7; m.pitchTarget=-0.05; m.bankTarget=0.12*Math.sin(m._dvT*1.4);
            if(m._dvT>2.2){ m._dv='slam'; setAnim(m,'flydown',0.25); } }
          else if(m._dv==='slam'){ const dx=cp.x-g.position.x, dz=cp.z-g.position.z; g.position.x+=dx*Math.min(1,dt*2.0); g.position.z+=dz*Math.min(1,dt*2.0); g.position.y+=(m.groundY-g.position.y)*Math.min(1,dt*2.4); m.pitchTarget=0.7; m.bankTarget=0;
            if(g.position.y-m.groundY<1.6){ g.position.y=m.groundY; if(!m._dvHit){ m._dvHit=true; const dd=Math.hypot(dx,dz); if(dd<(D.scale||18)*0.8) ctx.combat?.hitPlayer?.(Math.round((D.atk||40)*1.5)); drgPlay(ctx, DRG_SFX.roar,drgVol(m,0.95)); } m._dv='land'; } }
          else { g.position.y=m.groundY; m.pitchTarget=0; m.bankTarget=0; setAnim(m,'idle',0.3); } },
        onEnd:(m)=>{ m.grp.position.y=m.groundY; m.pitchTarget=0; m.bankTarget=0; } },
    };
  }
  // 행동선택: ★거리별로 5종(물기·꼬리·헤비·브레스·다이브) 섞어 다채롭게. (기존엔 heavy·tail을 아예 안 골라 단조로웠음)
  function selectDragonAttack(mn, dist){ const A=mn._atks; const r=Math.random();
    // ── 근접(dist<9): 물기·꼬리·헤비 근접 3종 섞기 ──
    if(dist<9){
      if(r<0.34 && atkReady(mn,'bite'))  return (Math.random()<0.5?A.bite4:A.bite6);   // 물기(기본)
      if(r<0.58 && atkReady(mn,'tail'))  return A.tail;                                // 꼬리 휩쓸기(옆)
      if(r<0.80 && atkReady(mn,'heavy')) return A.heavy;                               // 헤비 콤보(멀티히트)
      if(atkReady(mn,'breath')) return A.breath;                                       // 근접서도 가끔 브레스
      if(atkReady(mn,'bite'))   return (Math.random()<0.5?A.bite4:A.bite6);
      return null;
    }
    // ── 중~원거리: 브레스 주력 + 공중점프 + 꼬리(사거리 김) ──
    const breathChance = mn.phase===2 ? 0.72 : 0.58;   // 페이즈2 = 브레스 더 자주
    if(r < breathChance){ if(atkReady(mn,'breath')) return A.breath; if(atkReady(mn,'dive')) return A.dive; if(atkReady(mn,'tail')) return A.tail; }
    else { if(atkReady(mn,'dive')) return A.dive; if(atkReady(mn,'breath')) return A.breath; if(atkReady(mn,'heavy')) return A.heavy; }
    if(dist<14 && atkReady(mn,'bite')) return (Math.random()<0.5?A.bite4:A.bite6);   // 다 쿨다운이면 물기로 메움
    return null;   // 접근(걸어옴)
  }
  const SKY_H = 70;   // 어그로 전 선회 고도
  function bossAI(mn, dt, cp){
    const g=mn.grp, D=mn.def;
    if(!mn._atks){ mn._atks=dragonAtks(mn); mn.maxHp=mn.hp; mn._mode='sky'; mn._skyA=Math.random()*6.28; mn._skyC={x:g.position.x,z:g.position.z}; mn._lastHp=mn.hp; }
    tickCD(mn, dt);
    if(mn._hurtT>0)mn._hurtT-=dt;
    if(mn.hp < (mn._lastHp||mn.hp)-0.1){ if((mn._hurtT||0)<=0){ drgPlay(ctx, DRG_SFX.hurt,drgVol(mn,0.75)); mn._hurtT=1.1; } }   // 피격 사운드
    mn._lastHp=mn.hp;
    const dx=cp.x-g.position.x, dz=cp.z-g.position.z, dist=Math.hypot(dx,dz)||1;
    const RR=(D.scale||18)/6, distN=dist/RR;   // ★거리 정규화(거대 용 기준) — 임계값은 distN으로 비교
    const gy=ctx.terrain?ctx.terrain.groundAt(g.position.x,g.position.z,g.position.y+8):(mn.spawnY||0);
    mn.groundY = gy>0.5?gy:(mn.spawnY||0);
    mn.pitchTarget=0; mn.bankTarget=0;
    const lr=(p,t,k)=>{ g.rotation[p]+=(t-g.rotation[p])*Math.min(1,dt*k); };
    const applyTilt=()=>{ lr('x', mn.pitchTarget, 4); lr('z', mn.bankTarget, 3); };

    // ── ① 하늘 선회(어그로 전): 빙글빙글 날다가 플레이어 접근 시 착지 모드로 ──
    if(mn._mode==='sky'){
      const ht=mn.groundY+SKY_H; mn._skyA += dt*0.45; const R=Math.max(70,(D.scale||18)*2.6);   // ★반경=크기 비례(거대 용은 크게 돌아야 자연스러움)
      g.position.x = mn._skyC.x + Math.cos(mn._skyA)*R; g.position.z = mn._skyC.z + Math.sin(mn._skyA)*R;
      g.position.y += (ht - g.position.y)*Math.min(1,dt*1.0);
      g.rotation.y = -mn._skyA;                             // ★진행방향(접선) — 위치 미분(-sinA,cosA)에 맞춘 heading. 기존 A+π/2는 옆·뒤를 보며 낢(버그)
      mn.pitchTarget=-0.05; mn.bankTarget=-0.32; setAnim(mn,'flyup',0.4);   // 반시계 선회 → 안쪽(왼쪽)으로 뱅크
      const distC = Math.hypot(cp.x-mn._skyC.x, cp.z-mn._skyC.z);   // 선회중심(영역) 기준 어그로
      if(distC < (D.aggro||34)){ mn._mode='landing'; mn._landT=0; if(mn.actions?.spawn) setAnim(mn,'spawn',0.3); drgPlay(ctx, DRG_SFX.roar,drgVol(mn,0.95)); }
      applyTilt(); return;
    }
    // ── ② 착지(어그로 순간): 스폰 애니로 플레이어 근처에 내려앉음 → 전투 시작 ──
    if(mn._mode==='landing'){
      mn._landT += dt;
      g.position.x += (cp.x - g.position.x)*Math.min(1,dt*0.7); g.position.z += (cp.z - g.position.z)*Math.min(1,dt*0.7);
      g.position.y += (mn.groundY - g.position.y)*Math.min(1,dt*0.9);
      g.rotation.y = Math.atan2(dx,dz);
      mn.pitchTarget = (g.position.y-mn.groundY>4)?0.3:0;    // 하강 중 약간 숙임
      if(g.position.y - mn.groundY < 1.0 || mn._landT>5){ g.position.y=mn.groundY; mn._mode='combat'; mn.gcd=0.6; if(mn.actions?.roar) setAnim(mn,'roar',0.3); drgPlay(ctx, DRG_SFX.epicRoar,drgVol(mn,1.0)); }   // 착지 포효
      applyTilt(); return;
    }
    // ── ③ 지상 전투 ──
    const newPhase = (mn.hp/(mn.maxHp||mn.hp) > 0.5) ? 1 : 2;
    if(newPhase!==mn.phase){ if(newPhase===2 && mn.phase===1){ drgPlay(ctx, DRG_SFX.epicRoar,drgVol(mn,1.0)); mn.gcd=0.4; if(mn.actions?.roar) setAnim(mn,'roar',0.3); } mn.phase=newPhase; }
    mn.cdScale = mn.phase===2 ? 0.6 : 1.0;
    if(mn.atk){ runAttack(mn, dt, cp); }                     // 공격 중 = 방향 고정(공격 시작 시 정면 스냅, dive는 자체 제어)
    else {
      g.position.y = mn.groundY;
      // ★부드러운 회전 — 즉시 스냅 X. 큰 회전이면 턴 애니.
      const tY=Math.atan2(dx,dz); let dY=tY-g.rotation.y; while(dY>Math.PI)dY-=6.283; while(dY<-Math.PI)dY+=6.283;
      g.rotation.y += dY*Math.min(1,dt*2.6);
      if((mn.gcd||0)<=0){ const atk=selectDragonAttack(mn, distN); if(atk){ g.rotation.y=tY; startAttack(mn, atk); } }   // 공격 시작=정면(거리 정규화)
      if(!mn.atk){   // ★얼타 방지: 공격 안 하면 항상 행동 — 멀면 접근, 크게 돌아야 하면 턴, 그 외엔 천천히 전진(정지 최소)
        if(Math.abs(dY)>0.7 && mn.actions?.turnL){ setAnim(mn, dY>0?'turnR':'turnL', 0.25); }   // 많이 틀어졌으면 제자리 턴
        else if(distN>6){ g.position.x+=Math.sin(g.rotation.y)*(D.speed||5)*dt; g.position.z+=Math.cos(g.rotation.y)*(D.speed||5)*dt; setAnim(mn,'walk',0.25); }   // 전진
        else { g.position.x+=Math.sin(g.rotation.y)*(D.speed||5)*0.25*dt; g.position.z+=Math.cos(g.rotation.y)*(D.speed||5)*0.25*dt; setAnim(mn,'walk',0.25); }   // 붙어도 살짝 전진(가만히 안 섬)
      }
    }
    applyTilt();
  }
  // ═══════ [S6] 브레스 VFX — 흡기 글로우(텔레그래프) + 화염 콘(액티브) ═══════
  let _fireTex=null;
  function fireTex(){ if(_fireTex)return _fireTex;   // R1: fxpool radialTexture(레이지 유지·색스톱 그대로)
    _fireTex=radialTexture(64, [[0,'rgba(255,255,255,1)'],[0.4,'rgba(255,200,90,0.9)'],[1,'rgba(255,90,20,0)']], { srgb:true }); return _fireTex; }
  // ★입 위치 = 실제 머리/턱 뼈 월드좌표(없으면 추정). 불은 여기서 나옴.
  function headBone(mn){ if('_head' in mn) return mn._head; let b=null;
    // ★드래곤 본체 = Bip002 스켈레톤(꼬리·발가락). Bip001은 등에 탄 라이더/장식. B_Face_Jaw는 라이더 얼굴(몸 뒤쪽 fwd-3)이라 절대 쓰면 안 됨 → 불이 등에서 남.
    mn.grp.traverse(o=>{ if(o.isBone && !b && /Bip002-Head_015$/.test(o.name)) b=o; });        // 드래곤 머리(입) = 몸 최전방(fwd+11)
    if(!b) mn.grp.traverse(o=>{ if(o.isBone && !b && /Bip002-Neck2_014$/.test(o.name)) b=o; }); // 폴백: 드래곤 목
    if(!b) mn.grp.traverse(o=>{ if(o.isBone && !b && /Head/i.test(o.name) && !/Bip001/.test(o.name)) b=o; });   // 라이더(Bip001) 제외
    mn._head=b; return b; }
  function neckBone(mn){ if('_neck' in mn) return mn._neck; let b=null;
    mn.grp.traverse(o=>{ if(o.isBone && !b && /Neck2_014$|Neck1_013$/.test(o.name)) b=o; });
    if(!b) mn.grp.traverse(o=>{ if(o.isBone && !b && /Neck/i.test(o.name)) b=o; });
    mn._neck=b; return b; }
  function mouthPos(mn){ const hb=headBone(mn);
    if(hb){ const p=new THREE.Vector3(); hb.getWorldPosition(p);
      const fwd=new THREE.Vector3(Math.sin(mn.grp.rotation.y),0,Math.cos(mn.grp.rotation.y));
      return p.add(fwd.multiplyScalar((mn.def?.scale||6)*0.10)); }   // ★머리 본 바로 앞(주둥이). 기존 0.42=입에서 12m 앞 → "너무 멀리서 나옴" 원인이라 0.10으로 축소.
    const g=mn.grp, sc=mn.def?.scale||6, fwd=new THREE.Vector3(Math.sin(g.rotation.y),0,Math.cos(g.rotation.y));
    return g.position.clone().add(fwd.multiplyScalar(sc*0.75)).add(new THREE.Vector3(0,sc*0.7,0)); }
  function breathTelegraph(mn){   // 흡기: 입가에 주황 글로우가 차오름 = "곧 브레스" 예고
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({ map:fireTex(), color:0xff7a20, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending }));
    scene.add(spr); const ls=grabMobLight();   // ⚡풀 슬롯(add/remove 재컴파일 방지)
    if(ls){ ls.light.color.setHex(0xff7a20); ls.light.distance=22; }
    let t=0; const DUR=1.0, sc=mn.def?.scale||6; let _last=performance.now();
    (function step(){ const _now=performance.now(); const dt=Math.min(0.05,(_now-_last)/1000); _last=_now; t+=dt; const u=Math.min(1,t/DUR); const mp=mouthPos(mn);   // ★프레임률 정규화(2026-07-15): 실경과시간 기반(브레스 텔레그래프)
      spr.position.copy(mp); spr.scale.setScalar(sc*0.14*(0.4+u*1.3)); spr.material.opacity=u*0.95;
      if(ls){ ls.light.position.copy(mp); ls.light.intensity=u*26; }
      if(u<1 && !mn.dead) requestAnimationFrame(step); else { scene.remove(spr); spr.material.dispose(); releaseMobLight(ls); } })();
  }
  // ★지속 화염 브레스 — 입에서 플레이어로 몇 초간 분사(파티클 풀 재활용). start→update(매프레임)→stop.
  function breathStreamStart(mn){ const N=240, sc=(mn.def?.scale||18)/6, geo=new THREE.BufferGeometry(), pa=new Float32Array(N*3), life=new Float32Array(N), vel=new Float32Array(N*3);
    const mp=mouthPos(mn); for(let i=0;i<N;i++){ pa[i*3]=mp.x; pa[i*3+1]=mp.y; pa[i*3+2]=mp.z; life[i]=Math.random(); }
    geo.setAttribute('position', new THREE.BufferAttribute(pa,3));
    const mat=new THREE.PointsMaterial({ map:fireTex(), color:0xff6a18, size:1.6*sc, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true });
    const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; scene.add(pts);
    const ls=grabMobLight();   // ⚡풀 슬롯(add/remove 재컴파일 방지)
    if(ls){ ls.light.color.setHex(0xff5a14); ls.light.distance=34; }
    mn._breath={ pts, geo, mat, life, vel, N, ls }; }
  function breathStreamUpdate(mn, cp, dt, intensity){ const b=mn._breath; if(!b) return; const mp=mouthPos(mn);
    if(b.ls){ b.ls.light.position.copy(mp); b.ls.light.intensity=28*intensity; } b.mat.opacity=0.95*intensity;
    // ★불 방향 = 항상 정면(fwd) + 머리 좌우 스윕만 반영(절대 뒤로 안 감) + 약간 아래.
    const yaw=mn.grp.rotation.y, fwd=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)), right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    let lateral=0; const jb=headBone(mn);
    if(jb){ const jp=new THREE.Vector3(); jb.getWorldPosition(jp);
      const side=(jp.x-mn.grp.position.x)*right.x + (jp.z-mn.grp.position.z)*right.z;   // 머리 좌우 오프셋
      lateral=Math.max(-0.9, Math.min(0.9, side/((mn.def?.scale||18)*0.5))); }          // 정규화·클램프(스윕)
    const dir=fwd.clone().add(right.multiplyScalar(lateral));   // 앞 + 좌우 스윕(항상 전방 성분 1)
    dir.y=-0.28; dir.normalize();
    const pa=b.geo.attributes.position.array;
    const sc=(mn.def?.scale||18)/6;
    for(let i=0;i<b.N;i++){ b.life[i]-=dt/0.7;
      if(b.life[i]<=0){ b.life[i]=1; pa[i*3]=mp.x; pa[i*3+1]=mp.y; pa[i*3+2]=mp.z;
        const v=dir.clone(); v.x+=(Math.random()-0.5)*0.45; v.y+=(Math.random()-0.5)*0.45; v.z+=(Math.random()-0.5)*0.45; v.normalize().multiplyScalar((16+Math.random()*12)*sc);
        b.vel[i*3]=v.x; b.vel[i*3+1]=v.y; b.vel[i*3+2]=v.z; }
      pa[i*3]+=b.vel[i*3]*dt; pa[i*3+1]+=b.vel[i*3+1]*dt; pa[i*3+2]+=b.vel[i*3+2]*dt; }
    b.geo.attributes.position.needsUpdate=true; }
  function breathStreamStop(mn){ const b=mn._breath; if(!b) return; scene.remove(b.pts); releaseMobLight(b.ls); b.geo.dispose(); b.mat.dispose(); mn._breath=null; }

  ctx.spawnMonster=spawn;   // 게이트(gate.js)·디버그가 호출. 평상시엔 이걸로만 스폰.
  ctx.monsterKinds=()=>MONSTERS.map(m=>m.k);   // ⚡로스터 키 목록 — wave.js가 스폰 종류를 미리 굴려 프리로드하는 용도
  // ★프리로드 API — 스폰 전에 종족/몹 템플릿(GLB/FBX+애니세트+텍스처+셰이더)을 미리 로드·캐시.
  //   습격(raid.js)이 배 접근 시 호출 → 상륙 순간엔 clone만 = 프레임드랍(모델 콜드로드+컴파일) 제거.
  //   ⚡확장(게이트용): 문자열 키('zombie' 등)도 허용 + 로드 직후 프리워밍 —
  //   템플릿을 화면 밖(y=-950)에 잠깐 넣고 renderer.compile(첫 스폰 셰이더 컴파일 히칫 제거)
  //   + initTexture(첫 렌더 텍스처 GPU 업로드 스톨 제거).
  function _prewarmTpl(tpl){ try{
    if(!ctx.renderer || !ctx.camera || tpl._warmed) return; tpl._warmed=true;
    const sc=tpl.scene, px=sc.position.x, py=sc.position.y, pz=sc.position.z;
    sc.position.set(0,-950,0); scene.add(sc);
    ctx.renderer.compile(scene, ctx.camera);
    sc.traverse(o=>{ const ms=Array.isArray(o.material)?o.material:[o.material];
      ms.forEach(m=>{ if(!m) return; for(const k of ['map','emissiveMap','normalMap']){ if(m[k]){ try{ ctx.renderer.initTexture(m[k]); }catch(_){} } } }); });
    scene.remove(sc); sc.position.set(px,py,pz);
  }catch(e){} }
  ctx.preloadMonster = (d)=>{ try{
    const def = (typeof d==='string') ? MONSTERS.find(m=>m.k===d) : d;
    if(!def) return;
    if(tplCache[def.k]){ const t=tplCache[def.k]; if(t&&t.scene) _prewarmTpl(t); return; }
    loadTpl(def, tpl=>_prewarmTpl(tpl));
  }catch(e){ console.warn('[mon] preload',e&&e.message); } };
  // ★자동 스폰 기본 OFF — 몬스터는 게이트 열릴 때만 나온다(gate.js가 spawnMonster 호출). 무조건 자동스폰 제거.
  let autoSpawn=false;
  function clearMonsters(){ for(let i=monsters.length-1;i>=0;i--){ try{ scene.remove(monsters[i].grp); }catch(e){} ctx.ai?.tokenRelease?.(monsters[i]); monsters.splice(i,1); } }
  ctx.setMonsterAutoSpawn=(on)=>{ autoSpawn=!!on; if(!on) clearMonsters(); };   // 디버그 토글
  ctx.clearMonsters=clearMonsters;
  let spawnT=3;
  let _groanT=2+Math.random()*4;   // 근처 몹 주기적 신음 타이머
  function tickMonsters(dt){ if(!ctx.player||!ctx.terrain) return; const cp=ctx.player.pos;
    updateMonFx(dt);   // 신규 몹 볼트/폭발 VFX
    if(autoSpawn){ spawnT-=dt; if(spawnT<=0){ spawnT=2.2; spawn(); } }
    // ★근처 몹 주기적 신음(분위기) — 3~8초마다 근처(42m) 1체가 종류별 소리(거리 비례 볼륨). 예전 MAS 이식.
    _groanT-=dt;
    if(_groanT<=0){ _groanT=3+Math.random()*5;
      const near=[];
      for(const m of monsters){ if(m.dead||m.bornT>0||m.raider) continue; const dx=m.grp.position.x-cp.x, dz=m.grp.position.z-cp.z; if(dx*dx+dz*dz < 1764) near.push(m); }   // 42² (★습격병=사람은 몬스터 신음 제외)
      if(near.length){ const m=near[(Math.random()*near.length)|0]; const dist=Math.hypot(m.grp.position.x-cp.x, m.grp.position.z-cp.z);
        monVox(MOB_SND[m.def?.k]||'mon_growl', Math.max(0.06, 0.55*(1-dist/42))); }   // 보이스 리미팅
    }
    // ⚡ 분리(separation)용 공간 해시 — 프레임당 1회 구축. 기존 sep()이 어그로 몹마다 전체 몹 순회(O(n²) —
    //   웨이브 수십 마리 동시 어그로 시 프레임당 수천 hypot). 셀 6m ≥ 최대 분리거리라 3×3 셀 조회 = 결과 동일.
    _sepGrid.clear();
    for(const m of monsters){ if(m.dead||!m.grp) continue;
      const fx=Math.floor(m.grp.position.x/SEP_CELL), fz=Math.floor(m.grp.position.z/SEP_CELL);
      const key=((fx&0xffff)<<16)|(fz&0xffff);
      let arr=_sepGrid.get(key); if(!arr){ arr=[]; _sepGrid.set(key,arr); } arr.push(m); }
    for(let i=monsters.length-1;i>=0;i--){ const mn=monsters[i], g=mn.grp;
      if(mn.dead){ mn.deathT-=dt;
        if(mn._fallDown){ g.rotation.x += (Math.PI*0.5 - g.rotation.x)*Math.min(1,dt*7); if(mn.deathT<0.5) g.position.y-=dt*0.3; }   // ★쓰러짐(옆으로 눕고 잔여시간에 가라앉음) — die 클립 없는 몹 서있는 시체 방지
        else g.position.y-=dt*0.3;
        if(mn.mixer)mn.mixer.update(dt); if(mn.deathT<=0){ scene.remove(g); monsters.splice(i,1); } continue; }
      if(mn.bornT>0){ mn.bornT-=dt; const u=1-Math.max(0,mn.bornT)/mn.bornDur;   // ★등장 = 바닥서 솟아오름(AI 스킵)
        g.position.y = mn.spawnY - (mn.def?.scale||1.7)*0.9*(1-u); if(mn.mixer)mn.mixer.update(dt); continue; }
      // ★타격감 D: 그로기 게이지 시간감쇠(미교전 시) — 그로기 창 중엔 gauge 0이라 무영향. 피격은 discrete라 감쇠보다 큼.
      if(mn.groggyGauge>0 && !(mn.groggyUntil && performance.now()<mn.groggyUntil))
        mn.groggyGauge = Math.max(0, mn.groggyGauge - BAL.feel.groggy.decayPerSec*dt);
      // ★타격감 D: 그로기 상태(무력화) — 이동·공격 정지 + 다운(기울임) 포즈 + 머리 위 별표시. (스턴보다 우선)
      if(mn.groggyUntil && performance.now()<mn.groggyUntil){
        mn.atk = null;   // 진행 중 공격 취소(다운)
        if(!mn._groggyActive){ mn._groggyActive=true; mn._groggyRot0=g.rotation.x; g.rotation.x=BAL.feel.groggy.downTilt;   // 기울임 다운 포즈(SSOT downTilt · die클립·kill 미사용 = mn.dead 오염 회피)
          ctx.hitfx?.groggyStars?.(mn, true); }   // 별표시 ON(위치 추종은 hitfx onUpdate)
        setAnim(mn,'idle'); if(mn.mixer)mn.mixer.update(dt); continue;
      }
      if(mn._groggyActive){   // ★그로기 종료 프레임 1회 정리 — 별표시 OFF + 기울임 포즈 원복(생존 몹 정상 복귀)
        mn._groggyActive=false; ctx.hitfx?.groggyStars?.(mn, false);
        if(mn._groggyRot0!=null){ g.rotation.x=mn._groggyRot0; mn._groggyRot0=null; } }
      if(mn.stunUntil && performance.now()<mn.stunUntil){ setAnim(mn,'idle'); if(mn.mixer)mn.mixer.update(dt); continue; }   // ★스턴 = 행동불가(쌍수 킥)
      if(mn.def?.type==='dragonboss'){ bossAI(mn, dt, cp); if(mn.mixer)mn.mixer.update(dt); continue; }   // ★보스 컨트롤러(공격풀+페이즈)
      const dx=cp.x-g.position.x, dz=cp.z-g.position.z, dist=Math.hypot(dx,dz)||1;
      // ★습격병(raider)은 despawn 예외 — 플레이어가 멀어져도 유지. (제거되면 raid가 livingUnits=0으로 "격퇴" 오판정 → 방어타워 없이 배 자동격침. 사령관)
      // ★던전 몹(_outpostTag.dg)도 despawn 예외 — 넓어진 던전(대각>90m)서 먼 방 몹이 사라져 클리어 카운트가 깨지는 것 방지(dungeonrun 소유·exit 시 일괄 정리).
      if(dist>DESPAWN && !mn.raider && !(mn._outpostTag && mn._outpostTag.dg)){ scene.remove(g); monsters.splice(i,1); ctx.ai?.tokenRelease?.(mn); continue; }
      const D=mn.def, agg=D.aggro||14;
      // 🧠 지각(ai.js) — 전지 어그로 폐지: FOV+발각딜레이+기억(마지막 목격지점 수색). 사령관 컨펌 2026-07-05.
      //   습격병(raider)·웨이브(_forceAggro)는 상시 어그로 유지(습격 밸런스 보존) → 기존 거리 로직.
      let _chase=null, _notice=false;   // _chase=기억 기반 추격 목표점(null=실좌표) · _notice=발각 전 조짐(멈춰 바라봄)
      if(ctx.ai && !mn.raider && !mn._forceAggro){
        const _was=mn.aggro, bb=ctx.ai.sense(mn, dt);
        mn.aggro=bb.aware; _chase=bb.lastSeen;
        if(bb.aware && !_was){ const _v=Math.max(0.12, 0.5*(1-dist/40));   // 발각 순간 → 몹별 소리(기존과 동일)
          monVox(MOB_SND[mn.def?.k] || 'mon_growl', _v); }
        if(!bb.aware && _was) ctx.ai.tokenRelease(mn);   // 망각 = 토큰 반납
        if(!bb.aware && bb.noticeT>0.1 && !mn.atk){ _notice=true; _turnTo(g, Math.atan2(dx,dz), dt, 5); }   // ?! 비트 — 천천히 그쪽으로 고개 돌림
      }
      else if(ctx.player?.stealthed){ mn.aggro=false; ctx.ai?.tokenRelease?.(mn); }   // ★도적 투명 중 = 인식 불가(추격 해제)
      else if(!mn.aggro){ if(dist<agg){ mn.aggro=true;   // (습격병/웨이브 폴백) 추격 시작 → 몹별 소리(거리 비례 볼륨)
        if(!mn.raider){ const _v=Math.max(0.12, 0.5*(1-dist/40));   // ★습격병=사람은 몬스터 으르렁 안 냄(사령관)
          monVox(MOB_SND[mn.def?.k] || 'mon_growl', _v); } } }   // 종류별(좀비=신음·뱀파이어/슬라임=쉭·골렘/거북=그런트·유령=고스트) / 보이스 리미팅
        else if(dist>agg*2.4 && !mn.raider && !mn._forceAggro) mn.aggro=false;   // ★습격병/웨이브는 상시 어그로 유지(668행 설계) — 예전엔 여기서 드롭돼 플레이어가 ~53m(agg22×2.4)+ 벗어나면 거점을 안 치고 홈(섬 중앙) 주변 배회로 전환. 그러면 크루 '공격해'(landAtkRange 36m, 크루 기준 최근접 탐색)도 다가오는 대상이 없어 플레이어 추종만 함 → "공격 명령 무시"처럼 보임(사령관 raid 재현 2026-07-14).
      let want='idle'; mn.atkCD-=dt; tickCD(mn, dt);   // 쿨다운 틱(전역+per-attack)
      if(!mn.aggro && mn.wander && !_notice){   // ★배회: 홈 주변 랜덤 지점으로 천천히 이동 → 도착하면 잠깐 쉼 → 반복 (조짐 중엔 정지)
        const hm=mn.home, R=hm.r||30;
        if(mn.wPause>0){ mn.wPause-=dt; }
        else {
          if(!mn.wTarget){ const a=Math.random()*6.283, rr=Math.random()*R;
            mn.wTarget={x:hm.x+Math.cos(a)*rr, z:hm.z+Math.sin(a)*rr}; }
          const tx=mn.wTarget.x-g.position.x, tz=mn.wTarget.z-g.position.z, td=Math.hypot(tx,tz);
          if(td<1.2){ mn.wTarget=null; mn.wPause=1.2+Math.random()*2.6; }   // 도착 → 쉼
          else { _turnTo(g, Math.atan2(tx,tz), dt, 4);   // 배회 = 느긋한 선회(스냅 홱돌기 제거 — 사령관 "사방 쳐다봄" 지적)
            const sp=(D.speed||2.6)*0.42, nx=g.position.x+tx/td*sp*dt, nz=g.position.z+tz/td*sp*dt;
            const gy=ctx.terrain.groundAt(nx,nz,g.position.y+2.5);
            if(gy>0.5 && Math.abs(gy-g.position.y)<=1.8){ g.position.x=nx; g.position.z=nz; g.position.y+=(gy-g.position.y)*Math.min(1,dt*10); want='walk'; }
            else { mn.wTarget=null; mn.wPause=0.5; }   // 못가는 데(물/절벽) → 새 목표
          }
        }
      }
      if(mn.aggro){
        // 🧠 추격 목표 = 지각 기억(마지막 목격지점). 시야 유지 중엔 실좌표와 동일. 습격병/웨이브=실좌표.
        // 🛡 습격병: 플레이어보다 가까운 '생존 용병'(garrison)이 있으면 그쪽과 교전 — 용병이 방패 역할(사령관 4차 2026-07-05).
        let _tx=_chase?_chase.x:cp.x, _tz=_chase?_chase.z:cp.z;
        mn._mercT=null;
        if(mn.raider && ctx.garrison && ctx.garrison.list && ctx.garrison.list.length){ let _bmd=dist;
          for(const _u of ctx.garrison.list){ if(_u.hp!=null && _u.hp<=0) continue;
            const _md=Math.hypot(_u.x-g.position.x, _u.z-g.position.z);
            if(_md<_bmd){ _bmd=_md; mn._mercT=_u; } }
          if(mn._mercT){ _tx=mn._mercT.x; _tz=mn._mercT.z; } }
        const cdx=_tx-g.position.x, cdz=_tz-g.position.z, cdist=Math.hypot(cdx,cdz)||1;
        const _sight = mn._mercT ? true : (!mn.bb || !mn.bb.lostT);   // 시야 확보 중(용병 교전=항시 유효 / 목격지점 허공 타격 방지)
        _turnTo(g, Math.atan2(cdx,cdz), dt, 10);   // 추격 = 빠르지만 부드러운 선회(전투 반응성 유지)
        // ── 분리(separation) + 이동 헬퍼(지면 클램프) — 원거리/근접 공용 ──
        const myR=Math.max(0.6,(D.scale||1.7)*0.4);
        const sep=()=>{ let sx=0,sz=0;   // ⚡공간 해시 3×3 셀 조회(전 몹 순회 폐지 — 결과 동일)
          const fx=Math.floor(g.position.x/SEP_CELL), fz=Math.floor(g.position.z/SEP_CELL);
          for(let cx=fx-1;cx<=fx+1;cx++) for(let cz=fz-1;cz<=fz+1;cz++){
            const arr=_sepGrid.get(((cx&0xffff)<<16)|(cz&0xffff)); if(!arr) continue;
            for(const o of arr){ if(o===mn||o.dead||!o.grp) continue;
              const ox=g.position.x-o.grp.position.x, oz=g.position.z-o.grp.position.z, od=Math.hypot(ox,oz);
              const minD=myR+Math.max(0.6,(o.def?.scale||1.7)*0.4);
              if(od>1e-3 && od<minD){ const w=(minD-od)/minD; sx+=ox/od*w; sz+=oz/od*w; } } }
          const standoff=myR+0.55; if(dist<standoff){ const w=(standoff-dist)/standoff; sx+=(-dx/dist)*w*2.0; sz+=(-dz/dist)*w*2.0; }
          return [sx,sz]; };
        const _step=(mx,mz,sp)=>{ const ml=Math.hypot(mx,mz); if(ml<1e-4) return; mx/=ml; mz/=ml;
          const nx=g.position.x+mx*sp*dt, nz=g.position.z+mz*sp*dt;
          const gy=ctx.terrain.groundAt(nx,nz,g.position.y+2.5);
          if(gy>0.5 && gy-g.position.y<=1.8){ g.position.x=nx; g.position.z=nz; g.position.y+=(gy-g.position.y)*Math.min(1,dt*10); } };
        if(mn.atk){ if(!runAttack(mn, dt, cp)) ctx.ai?.tokenRelease?.(mn); want=null; }   // ★공격 실행 중 = 커밋. 종료 = 토큰 반납(교대)
        else if(mn.dgBoss){   // 🔥 던전 보스 = 거리 기반 공격 선택기(근·중·원 전부). 잡몹 토큰/링 규칙 우회.
          const [sx,sz]=sep();
          if((mn.gcd||0)<=0 && _sight){ startAttack(mn, dgBossSpec(mn, cdist)); want=null; }   // 쿨 비면 거리 맞는 기술 선택
          else if(cdist>7){ _step(cdx/cdist+sx, cdz/cdist+sz, D.speed||3); want='run'; }        // 멀면 접근(연격 사거리까지)
          else { if(sx||sz)_step(sx,sz,(D.speed||3)*0.5); want='idle'; }                          // 근접 대기(쿨 회복 = 딜타임)
        }
        else if(D.ranged){   // ── 원거리(망령/강령술사): 사거리 유지 + 볼트(시야 확보 시에만 발사) ──
          const RR=20; const [sx,sz]=sep();
          if(cdist>RR){ _step(cdx/cdist+sx, cdz/cdist+sz, D.speed||2.6); want='run'; }          // 사거리 밖 → 접근(기억 지점)
          else if(dist<9){ _step(-dx/dist+sx, -dz/dist+sz, (D.speed||2.6)*0.8); want='run'; }  // 너무 가까움 → 후퇴(실좌표)
          else { if(sx||sz)_step(sx,sz,(D.speed||2.6)*0.5);
            if(_sight && atkReady(mn,'ranged')){ startAttack(mn, rangedSpec(mn)); want=null; } else want='idle'; }
        }
        else {   // ── 근접(+자폭/돌진/강타) ──
          const [sx,sz]=sep();
          // 🎟️ 공격 토큰 — 동시 타격자 상한(BAL.ai.tokens). 비보유자는 바깥 링에서 견제 배회(떼몹 짜부 방지).
          //   습격병·ai 미탑재(샌드박스)는 전원 공격(기존 동작).
          const _tok = (!ctx.ai || mn.raider || mn._forceAggro) ? true : (ctx.ai.tokenHeld(mn) || ctx.ai.tokenRequest(mn));
          const _ring = MOB_RANGE + (_tok ? 0 : (BAL.ai?.tokens?.orbitGap ?? 2.4));
          if(cdist>_ring){ _step(cdx/cdist+sx*1.5, cdz/cdist+sz*1.5, D.speed||2.6); want='run'; }   // 추격 + 분리
          else if(!_tok){   // 토큰 없음 = 링 견제 — 접선 방향으로 천천히 좌우 배회(교대 대기)
            if(!mn._orbitDir) mn._orbitDir=(Math.random()<0.5?1:-1);
            _step(-cdz/cdist*mn._orbitDir+sx, cdx/cdist*mn._orbitDir+sz, (D.speed||2.6)*0.5); want='walk'; }
          else { if(sx||sz) _step(sx, sz, (D.speed||2.6)*0.7);   // 사거리 내 — 분리만 살짝
            if(!_sight){ want='idle'; }   // 목격지점 도착했는데 플레이어 안 보임 → 두리번(기억 소진 대기)
            else if(D.selfdestruct){ boomExplode(mn, cp); want=null; }   // 폭탄 = 접근 완료 시 자폭
            else if(atkReady(mn,'melee')){ const spec = (D.k==='bat')?batDiveSpec(mn) : (D.k==='mummy')?mummySmashSpec(mn) : mobMeleeSpec(mn); startAttack(mn, spec); want=null; }
            else want='idle'; }
        }
      }
      if(D.fly){   // ── 비행 몹: 지면 위 일정 고도로 부유(둥실) ──
        const gy=ctx.terrain.groundAt(g.position.x,g.position.z,g.position.y+8); const fh=(gy>0.3?gy:mn.spawnY)+(D.flyH||1.6);
        g.position.y += (fh-g.position.y)*Math.min(1,dt*3) + Math.sin(performance.now()*0.003+g.position.x)*dt*0.25; }
      if(want!=null) setAnim(mn, want);   // 공격 중(want=null)엔 러너가 anim 제어
      // ⚡ 원거리 몹 애니 스로틀 — 60m+(비전투 거리)는 mixer를 ~10fps로(스킵분 dt 몰아서 update = 재생속도 동일).
      //   전투(어그로·공격)는 60m 안에서만 일어나므로 히트윈도/타이밍 무영향.
      if(mn.mixer){
        if(dist>60){ mn._mixAcc=(mn._mixAcc||0)+dt; if(mn._mixAcc>=0.1){ mn.mixer.update(mn._mixAcc); mn._mixAcc=0; } }
        else if(mn._mixAcc){ mn.mixer.update(dt+mn._mixAcc); mn._mixAcc=0; }   // 근접 복귀 시 잔여분 정산
        else mn.mixer.update(dt);
      }
    }
  }
  const SEP_CELL=6; const _sepGrid=new Map();   // ⚡분리용 공간 해시(위 tickMonsters서 프레임당 1회 구축)
  ctx.onUpdate(tickMonsters);
  // ★보스 오라 — uT 흐름 갱신 + 불티 상승 + grp 제거 시 자동 정리
  ctx.onUpdate((dt)=>{ dt=dt||0.016; const t=performance.now()/1000;
    for(let i=_auraMats.length-1;i>=0;i--){ const a=_auraMats[i];
      if(!a.mesh.parent){ a.mat.dispose(); a.mesh.geometry?.dispose?.(); _auraMats.splice(i,1); continue; }
      a.mat.uniforms.uT.value=t; }
    for(let i=_auraEmb.length-1;i>=0;i--){ const e=_auraEmb[i];
      if(!e.sp.parent){ e.mat.dispose(); _auraEmb.splice(i,1); continue; }
      e.life-=dt*0.4; if(e.life<=0){ e.life=1; e.a=Math.random()*6.283; e.r=e.bodyR*(0.5+Math.random()*0.7); e.vy=1.6+Math.random()*2.2; e.sz=e.bodyR*(0.05+Math.random()*0.06); e.sp2=1.5+Math.random()*2.0; }
      const tt=1-e.life, ang=e.a+tt*e.sp2, h=tt*e.vy*e.bodyH*0.9, rr=e.r*(1.0-tt*0.35);
      e.sp.position.set(Math.cos(ang)*rr, 0.1+h, Math.sin(ang)*rr); e.sp.scale.set(e.sz, e.sz*1.7, 1);
      e.mat.opacity=Math.min(1,e.life*1.5)*Math.min(1,tt*4.0); }
  });

  // ═══════ 타격감 A2: 피격 임팩트 → hitfx.js 전용 모듈로 이관(재작업 2026-07-02) ═══════
  //   ctx.flashHit(mn, hitPos, crit)는 이제 hitfx.js(initHitfx)가 등록. 붉은 emissive 틴트 폐기 → 색 무관 임팩트 연출.
  //   combat.damageMonster 단일 통로에서 호출(배선 1곳 유지 — G8). monsters.js는 스폰/AI/애니만 담당.

  // ═══════ 디버그 검증 훅 — rAF throttle 우회(자동화 탭서 시간기반 거동 검증용) ═══════
  ctx.debugStepMonsters = (dt, frames)=>{ dt=dt||0.016; frames=frames||1; for(let i=0;i<frames;i++) tickMonsters(dt); return frames+'프레임 ×'+dt+'s 진행'; };
  ctx.debugMonsterState = (k)=>{ const m=k?monsters.find(x=>x.def?.k===k):monsters[0]; if(!m) return null;
    return { k:m.def?.k, hp:+(m.hp||0).toFixed(1), maxHp:m.maxHp, phase:m.phase, anim:m.anim,
      atk: m.atk? (m.atk.spec.name + (m.atk.spec.phases ? ':'+m.atk.spec.phases[m.atk.pi].name : '') + ' t='+m.atk.t.toFixed(2)) : '(none)',   // ★dgBoss atk는 phases 없음(러너 기반) → 가드
      gcd:m.gcd!=null?+m.gcd.toFixed(2):null, acd:m.acd?Object.fromEntries(Object.entries(m.acd).map(([n,v])=>[n,+v.toFixed(2)])):null,
      pos:[m.grp.position.x|0,m.grp.position.y|0,m.grp.position.z|0], pitch:+m.grp.rotation.x.toFixed(2),
      dist: ctx.player? +Math.hypot(ctx.player.pos.x-m.grp.position.x, ctx.player.pos.z-m.grp.position.z).toFixed(1):null }; };

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔴🌋 던전 보스 스킬 VFX (2026-07-23 /vfx 규율 — 정본: hitfx premult-additive · dungeonrun DGN_NOISE 마그마 · monsters breathStream 불 Points)
  //   ① 장판 = 마그마 셰이더 디스크(fbm 균열 + 차오르는 위험링) → 폭발 시 불 Points 분출 + 백열 + 풀 광원 플래시.
  //   ② 밀치기 = 지면 충격파 셰이더 링(팽창·페이드) + 잉걸불 Points 방사 + 풀 광원 플래시.
  //   전부 파티클/셰이더/텍스처 기반(민짜 MeshBasic 금지). 광원 = grabMobLight 풀(add/remove 재컴파일 방지).
  // ═══════════════════════════════════════════════════════════════════════════
  const _DGN_NOISE = `
    float _h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float _vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      float a=_h(i),b=_h(i+vec2(1,0)),c=_h(i+vec2(0,1)),d=_h(i+vec2(1,1));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
    float _fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*_vn(p);p=p*2.03+11.7;a*=.5;}return v;}`;
  const _premult = { transparent:true, depthWrite:false, blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor };

  const _aoeZones = [], _shockRings = [], _fireBursts = [];

  // 🌋 마그마 장판 — 지면 균열 텔레그래프. ★2026-07-24 전면 재작업 (사령관 "동그라미가 올라가는 게 뭐야, VFX 너무 짜침").
  //   구 버전 = **차오르는 경계 링(fillRing)** = 게임 UI 데칼처럼 보이는 "올라가는 동그라미". 폐기.
  //   신 버전 = **지면이 중심에서 바깥으로 쩍 갈라진다**(방사형 균열이 시간에 따라 뻗어나감). 정본 규율(/vfx §4):
  //     "예고는 원반이 아니라 균열의 진행형". uFill(0→1)이 균열이 뻗어나간 정도 = 위험 반경.
  //   opts.style: 'radial'(기본, 방사 균열) · 'line'(직선 균열, Ⓓ 추격용) — angle 방향으로 길게.
  function spawnAoe(x, y, z, R, delay, dmg, opts){
    opts = opts || {};
    const style = opts.style === 'line' ? 1.0 : 0.0;
    const U = { uTime:{value:0}, uFill:{value:0}, uBlow:{value:0}, uStyle:{value:style}, uAng:{value:opts.angle||0} };
    const mat = new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
      vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: _DGN_NOISE + `
        varying vec2 vU; uniform float uTime, uFill, uBlow, uStyle, uAng;
        // 방사 균열 — 각도로 쪼갠 쐐기들이 중심에서 바깥으로 뻗는다. 균열 사이는 어둡고 틈에서 마그마가 샌다.
        void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
          float ang=atan(p.y,p.x);
          // 축 회전(직선 균열이면 방향 정렬)
          float ca=cos(uAng), sa=sin(uAng); vec2 rp=mat2(ca,-sa,sa,ca)*p;
          // ── 균열 필드 ── 방사: 각도별 쐐기(개수=고정) 흔들림 / 직선: 중앙 띠 하나
          float shards = abs(sin(ang*5.0 + _fbm(vec2(ang*2.0, r*3.0))*2.2));   // 0=균열선
          float radialCrack = 1.0 - smoothstep(0.0, 0.16, shards);
          float lineCrack = 1.0 - smoothstep(0.0, 0.18+0.12*_fbm(vec2(rp.x*4.0,uTime*0.2)), abs(rp.y));
          float crackShape = mix(radialCrack, lineCrack, uStyle);
          // 뻗어나간 정도 — uFill 안쪽만 갈라져 있고 경계는 지금 막 벌어지는 중(밝음)
          float reach = mix(r, abs(rp.x), uStyle);                       // 방사=반경 / 직선=길이축
          float spread = smoothstep(uFill+0.02, uFill-0.14, reach);      // 갈라진 안쪽
          float tip = smoothstep(0.14,0.0, abs(reach-uFill));            // 균열 선단(가장 밝음, 지금 벌어지는 곳)
          float breathe = 0.7+0.3*sin(uTime*(3.0+uFill*10.0));            // 폭발 임박 = 빠른 맥동
          float glow = crackShape * (spread*0.7 + tip*1.6*breathe);      // 균열에서만 빛
          float seep = crackShape * spread * (0.4+0.6*_fbm(rp*4.0+uTime*0.4));  // 틈새 마그마
          vec3 magma = mix(vec3(0.6,0.09,0.02), vec3(1.0,0.78,0.30), tip);
          vec3 col = magma*(seep*0.9 + glow*1.3) + uBlow*vec3(1.0,0.85,0.55)*3.4;   // 폭발 백열
          float a = clamp(glow + seep*0.7 + uBlow, 0.0, 1.0);
          gl_FragColor=vec4(col*a, a); }` });
    const geo = style>0.5 ? new THREE.PlaneGeometry(R*2.4, R*1.0) : new THREE.PlaneGeometry(R*2, R*2);
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = -Math.PI/2; if(style>0.5) disc.rotation.z = -(opts.angle||0);
    disc.position.set(x, y + 0.06, z); disc.renderOrder = 5; disc.frustumCulled = false;
    disc.layers.enable(1);   // 블룸(던전 상시 ON)
    scene.add(disc);
    _aoeZones.push({ disc, U, mat, x, y, z, R, delay, t:0, dmg, blown:false });
  }

  // 🔥 불 Points 분출 — 정본 breathStream 기법(_fireTex + premult additive + sizeAttenuation + life 순환). 위로 솟구쳐 사라짐.
  function spawnFireBurst(x, y, z, R, n){
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(n*3), vel = new Float32Array(n*3), life = new Float32Array(n);
    for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=Math.random()*R*0.9;
      pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.1+Math.random()*0.3; pos[i*3+2]=z+Math.sin(a)*rr;
      vel[i*3]=Math.cos(a)*(0.6+Math.random()*1.2); vel[i*3+1]=4.5+Math.random()*4.5; vel[i*3+2]=Math.sin(a)*(0.6+Math.random()*1.2);
      life[i]=0.35+Math.random()*0.45; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const mat = new THREE.PointsMaterial({ map:fireTex(), size:1.15, sizeAttenuation:true, ..._premult, depthTest:true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled=false; pts.renderOrder=6; scene.add(pts);
    _fireBursts.push({ pts, geo, mat, vel, life, life0:life.slice(), n, t:0, max:0.9 });
  }

  // 💥 지면 충격파 링 — 팽창하는 셰이더 annulus(SDF) + 잉걸불 방사 + 풀 광원 플래시.
  function dgBossSlamFx(x, y, z){
    const U = { uT:{value:0} };
    const mat = new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
      vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:`varying vec2 vU; uniform float uT;
        void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
          float rad=uT; float ring=smoothstep(0.16,0.0,abs(r-rad));      // 팽창하는 링
          float lead=smoothstep(0.34,0.0,abs(r-rad))*0.4;                // 번짐
          float fade=1.0-uT;
          vec3 col=mix(vec3(1.0,0.55,0.18), vec3(1.0,0.92,0.6), ring);
          float a=(ring+lead)*fade;
          gl_FragColor=vec4(col*a, a); }` });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(11,11), mat);
    disc.rotation.x=-Math.PI/2; disc.position.set(x, y+0.08, z); disc.renderOrder=6; disc.frustumCulled=false; scene.add(disc);
    disc.layers.enable(1);   // 블룸
    _shockRings.push({ disc, U, mat, t:0, dur:0.42 });
    spawnFireBurst(x, y, z, 2.2, 44);                                     // 잉걸불 방사
    monLight({ x, y:y+1.4, z }, 0xff7a2a, 26, 0.28);                      // ⚡풀 광원 플래시(add/remove 금지)
    try{ ctx.sound?.sfxPath?.('/tomob-deploy/crash.mp3', 0.3); }catch(_){}
  }

  // 💥 도약 착지 임팩트 — 레퍼런스 ref/boss/도약.jpg 재현. 정본 규율(/vfx): 리본/파티클/셰이더 조합, 민짜 금지.
  //   구성: ①방사 균열 지면 흉터(마그마) ②팽창 불 링(충격파) ③위로 솟는 스파크 기둥 ④튀는 파편 덩어리 ⑤잉걸불 ⑥풀 광원.
  const _debris = [], _sparkCols = [];
  const _rockGeo = new THREE.BoxGeometry(0.5, 0.35, 0.42);
  const _rockMat = new THREE.MeshStandardMaterial({ color:0x2b2622, roughness:1, emissive:0x812009, emissiveIntensity:0.35 });
  function dgLeapImpact(x, y, z){
    // ① 지면 균열 흉터 — 방사, 즉시 벌어졌다가 서서히 식음(텔레그래프 아님: delay 짧게, 바로 blow)
    { const U = { uTime:{value:0}, uFill:{value:1}, uBlow:{value:0.6}, uStyle:{value:0}, uAng:{value:0} };
      const mat = new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
        vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:_DGN_NOISE+`varying vec2 vU; uniform float uTime,uBlow;
          void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
            float ang=atan(p.y,p.x);
            float shards=abs(sin(ang*6.0 + _fbm(vec2(ang*2.0,r*3.0))*2.4));
            float crack=1.0-smoothstep(0.0,0.14,shards);
            float body=smoothstep(1.0,0.1,r);
            float seep=crack*body*(0.5+0.5*_fbm(p*5.0+uTime*0.5));
            vec3 magma=mix(vec3(0.7,0.12,0.02),vec3(1.0,0.8,0.32),crack*body);
            float a=clamp(seep*1.2 + uBlow*body, 0.0, 1.0);
            gl_FragColor=vec4(magma*a*(1.0+uBlow*2.0), a); }` });
      const disc=new THREE.Mesh(new THREE.PlaneGeometry(11,11), mat);
      disc.rotation.x=-Math.PI/2; disc.position.set(x,y+0.05,z); disc.renderOrder=5; disc.frustumCulled=false; disc.layers.enable(1); scene.add(disc);
      _aoeZones.push({ disc, U, mat, x,y,z, R:5.5, delay:99, t:0, dmg:0, blown:true, scar:true }); }   // scar=서서히 식는 흉터
    // ② 팽창 불 링(충격파) — 인라인(dgBossSlamFx의 큰 잉걸불 44개는 안 씀 = 흰 덩어리 방지)
    { const U={ uT:{value:0} };
      const mat=new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
        vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:`varying vec2 vU; uniform float uT;
          void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
            float rad=uT; float ring=smoothstep(0.14,0.0,abs(r-rad));
            float lead=smoothstep(0.30,0.0,abs(r-rad))*0.35; float fade=1.0-uT;
            vec3 col=mix(vec3(1.0,0.42,0.10), vec3(1.0,0.82,0.42), ring);   // 주황 위주(흰색 억제)
            float a=(ring+lead)*fade*0.9; gl_FragColor=vec4(col*a, a); }` });
      const disc=new THREE.Mesh(new THREE.PlaneGeometry(12,12), mat);
      disc.rotation.x=-Math.PI/2; disc.position.set(x,y+0.07,z); disc.renderOrder=6; disc.frustumCulled=false; disc.layers.enable(1); scene.add(disc);
      _shockRings.push({ disc, U, mat, t:0, dur:0.5 }); }
    // ③ 수직 스파크 기둥 — 작고 밝은 점(불티). ⚠️크면 fireTex가 둥근 구슬처럼 보임 → size 작게·밝게.
    { const n=40, geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), vel=new Float32Array(n*3), life=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=Math.random()*0.6;
        pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.2+Math.random()*0.4; pos[i*3+2]=z+Math.sin(a)*rr;
        vel[i*3]=Math.cos(a)*(0.4+Math.random()*0.9); vel[i*3+1]=8+Math.random()*8; vel[i*3+2]=Math.sin(a)*(0.4+Math.random()*0.9);
        life[i]=0.5+Math.random()*0.5; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      const mat=new THREE.PointsMaterial({ map:fireTex(), color:0xffd070, size:0.18, sizeAttenuation:true, ..._premult, depthTest:true });   // 작고 밝은 황금 불티
      const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; pts.renderOrder=6; pts.layers.enable(1); scene.add(pts);
      _sparkCols.push({ pts, geo, mat, vel, life, n, t:0, max:1.1 }); }
    // ③b 바닥 잉걸불 — 아주 작게 흩뿌림
    { const n=30, geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), vel=new Float32Array(n*3), life=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=Math.random()*2.0;
        pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.15+Math.random()*0.3; pos[i*3+2]=z+Math.sin(a)*rr;
        vel[i*3]=Math.cos(a)*(1.5+Math.random()*2.5); vel[i*3+1]=3+Math.random()*4; vel[i*3+2]=Math.sin(a)*(1.5+Math.random()*2.5);
        life[i]=0.4+Math.random()*0.4; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      const mat=new THREE.PointsMaterial({ map:fireTex(), color:0xffb050, size:0.15, sizeAttenuation:true, ..._premult, depthTest:true });
      const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; pts.renderOrder=6; pts.layers.enable(1); scene.add(pts);
      _sparkCols.push({ pts, geo, mat, vel, life, n, t:0, max:0.9 }); }
    // ④ 튀는 파편 덩어리 — 어두운 돌조각(가장자리 발광), 위+바깥으로 튀어 회전하며 낙하. 개수·크기 절제.
    { const n=9;
      for(let i=0;i<n;i++){ const a=Math.random()*6.283, sp=3+Math.random()*4;
        const m=new THREE.Mesh(_rockGeo, _rockMat); m.position.set(x,y+0.3,z);
        const s=0.4+Math.random()*0.7; m.scale.setScalar(s); scene.add(m);
        _debris.push({ m, vx:Math.cos(a)*sp, vy:5+Math.random()*6, vz:Math.sin(a)*sp,
          rx:(Math.random()-0.5)*12, rz:(Math.random()-0.5)*12, t:0, max:1.4 }); } }
    // ⑤⑥ 잉걸불 + 광원은 dgBossSlamFx가 이미 냄. 착지 강조 광원 하나 더.
    monLight({ x, y:y+2.0, z }, 0xff8a3c, 34, 0.4);
  }

  // 🔥 공용 — 위로 솟는 불기둥(Points, fireTex). ref/boss/균열.jpg·도약.jpg의 수직 화염.
  function fireColumn(x, y, z, opts){ opts=opts||{};
    const n=opts.n||90, up=opts.up||16, spread=opts.spread||0.9, size=opts.size||0.5, col=opts.color||0xffb040, life=opts.life||1.0;
    const geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), vel=new Float32Array(n*3), lf=new Float32Array(n);
    for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=Math.random()*spread;
      pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.2+Math.random()*0.6; pos[i*3+2]=z+Math.sin(a)*rr;
      vel[i*3]=Math.cos(a)*(0.5+Math.random()*1.0); vel[i*3+1]=up*(0.5+Math.random()*0.9); vel[i*3+2]=Math.sin(a)*(0.5+Math.random()*1.0);
      lf[i]=life*(0.6+Math.random()*0.6); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const mat=new THREE.PointsMaterial({ map:fireTex(), color:col, size, sizeAttenuation:true, ..._premult, depthTest:true });
    const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; pts.renderOrder=6; pts.layers.enable(1); scene.add(pts);
    _sparkCols.push({ pts, geo, mat, vel, life:lf, n, t:0, max:life*1.2 });
  }

  // ⚔️ 연격(Ⓐ) — 수평 소용돌이 불꽃 링(ref/boss/연격.jpg). 회전하는 불꽃 리본 annulus + 궤도 잉걸불.
  const _swirls=[];
  function dgSwirlRing(x, y, z, R){
    R=R||6;
    const U={ uT:{value:0} };
    const mat=new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
      vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:_DGN_NOISE+`varying vec2 vU; uniform float uT;
        void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
          float ang=atan(p.y,p.x);
          float spin=uT*7.0;                                        // 빠른 회전
          // 여러 겹 나선 아크 — 각도+반경에 회전 섞어 소용돌이
          float sw=_fbm(vec2(ang*2.5 + spin + r*4.0, r*3.0 - uT*2.0));
          float arc=pow(clamp(sw,0.0,1.0), 1.6);
          float band=smoothstep(0.30,0.55,r)*smoothstep(1.0,0.72,r);  // 링 두께(가운데 비고 테두리)
          float lead=smoothstep(0.9,1.0,r);                          // 선두(바깥) 밝게=백황
          float fade=smoothstep(1.0,0.0,uT);
          vec3 col=mix(vec3(0.9,0.12,0.02), vec3(1.0,0.85,0.5), arc*0.5+lead*0.7);
          float a=band*arc*1.4*fade;
          gl_FragColor=vec4(col*a, a); }` });
    const disc=new THREE.Mesh(new THREE.PlaneGeometry(R*2,R*2), mat);
    disc.rotation.x=-Math.PI/2; disc.position.set(x,y+0.12,z); disc.renderOrder=6; disc.frustumCulled=false; disc.layers.enable(1); scene.add(disc);
    _swirls.push({ disc, U, mat, t:0, dur:0.8 });
    // 궤도 잉걸불(바깥으로 흩어지며 회전)
    { const n=40, geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), vel=new Float32Array(n*3), life=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=R*(0.5+Math.random()*0.5);
        pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.3+Math.random()*0.8; pos[i*3+2]=z+Math.sin(a)*rr;
        vel[i*3]=-Math.sin(a)*6+Math.cos(a)*2; vel[i*3+1]=1+Math.random()*2; vel[i*3+2]=Math.cos(a)*6+Math.sin(a)*2;   // 접선(회전)
        life[i]=0.5+Math.random()*0.4; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      const em=new THREE.PointsMaterial({ map:fireTex(), color:0xffb040, size:0.2, sizeAttenuation:true, ..._premult, depthTest:true });
      const pts=new THREE.Points(geo,em); pts.frustumCulled=false; pts.renderOrder=6; pts.layers.enable(1); scene.add(pts);
      _sparkCols.push({ pts, geo, mat:em, vel, life, n, t:0, max:0.9 }); }
    monLight({ x, y:y+1.2, z }, 0xff7a2a, 24, 0.4);
  }

  // 🌋 균열(Ⓓ 각 지점) — 수직 화염 분출 + 바닥 방사 균열 + 백열 베이스(ref/boss/균열.jpg).
  function dgEruption(x, y, z){
    // 바닥 방사 균열(즉시 벌어져 식음) — dgLeapImpact scar 재사용 방식
    { const U={ uTime:{value:0}, uFill:{value:1}, uBlow:{value:0.7}, uStyle:{value:0}, uAng:{value:0} };
      const mat=new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
        vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:_DGN_NOISE+`varying vec2 vU; uniform float uTime,uBlow;
          void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
            float ang=atan(p.y,p.x); float shards=abs(sin(ang*7.0+_fbm(vec2(ang*2.0,r*3.0))*2.4));
            float crack=1.0-smoothstep(0.0,0.13,shards); float body=smoothstep(1.0,0.1,r);
            float seep=crack*body*(0.5+0.5*_fbm(p*5.0+uTime*0.5));
            vec3 magma=mix(vec3(0.7,0.12,0.02),vec3(1.0,0.85,0.4),crack*body);
            float a=clamp(seep*1.2+uBlow*body,0.0,1.0); gl_FragColor=vec4(magma*a*(1.0+uBlow*2.0),a); }` });
      const disc=new THREE.Mesh(new THREE.PlaneGeometry(9,9), mat);
      disc.rotation.x=-Math.PI/2; disc.position.set(x,y+0.05,z); disc.renderOrder=5; disc.frustumCulled=false; disc.layers.enable(1); scene.add(disc);
      _aoeZones.push({ disc, U, mat, x,y,z, R:4.5, delay:99, t:0, dmg:0, blown:true, scar:true }); }
    // 수직 화염 기둥(2겹: 넓은 주황 몸통 + 밝은 백황 코어)
    fireColumn(x, y, z, { n:110, up:20, spread:1.1, size:0.6, color:0xff7a20, life:1.0 });
    fireColumn(x, y, z, { n:60,  up:24, spread:0.5, size:0.4, color:0xffe090, life:0.9 });
    monLight({ x, y:y+2.5, z }, 0xffa040, 40, 0.5);
    try{ ctx.sound?.sfxPath?.('/tomob-deploy/crash.mp3', 0.22); }catch(_){}
  }

  // ☄️ 전멸기(Ⓖ) — 팽창하는 불 돔/링 + 중심 충전 오브(ref/boss/전멸기.jpg).
  const _orbs=[];
  function dgNukeBurst(x, y, z){
    // 팽창 불 링(크게)
    { const U={ uT:{value:0} };
      const mat=new THREE.ShaderMaterial({ uniforms:U, side:THREE.DoubleSide, ..._premult,
        vertexShader:`varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader:_DGN_NOISE+`varying vec2 vU; uniform float uT;
          void main(){ vec2 p=(vU-0.5)*2.0; float r=length(p); if(r>1.0) discard;
            float ang=atan(p.y,p.x); float rad=uT;
            float turb=_fbm(vec2(ang*4.0+uT*3.0, r*5.0));
            float ring=smoothstep(0.18,0.0,abs(r-rad))*(0.6+0.6*turb);
            float lead=smoothstep(0.36,0.0,abs(r-rad))*0.3;
            float fade=1.0-uT;
            vec3 col=mix(vec3(1.0,0.35,0.06), vec3(1.0,0.82,0.42), ring);
            float a=(ring+lead)*fade; gl_FragColor=vec4(col*a,a); }` });
      const disc=new THREE.Mesh(new THREE.PlaneGeometry(44,44), mat);
      disc.rotation.x=-Math.PI/2; disc.position.set(x,y+0.1,z); disc.renderOrder=6; disc.frustumCulled=false; disc.layers.enable(1); scene.add(disc);
      _shockRings.push({ disc, U, mat, t:0, dur:0.75 }); }
    // 중심 충전 오브 — 밝은 구(스프라이트 2겹) 팽창 후 폭발
    { const g=new THREE.Group(); g.position.set(x,y+2.2,z);
      g.add(_spr(MT_GLOW,0xfff0d0,3.2)); g.add(_spr(MT_FLARE,0xffffff,1.6)); g.add(_spr(MT_GLOW,0x9fd8ff,4.4));
      g.children.forEach(s=>s.layers.enable(1)); scene.add(g);
      _orbs.push({ g, t:0, dur:0.6 }); }
    fireColumn(x, y, z, { n:120, up:14, spread:3.0, size:0.5, color:0xff7a20, life:1.1 });
    // 바깥으로 퍼지는 작은 불티(큰 spawnFireBurst 대신 — 둥근 구슬 방지)
    { const n=90, geo=new THREE.BufferGeometry(), pos=new Float32Array(n*3), vel=new Float32Array(n*3), life=new Float32Array(n);
      for(let i=0;i<n;i++){ const a=Math.random()*6.283, rr=Math.random()*4;
        pos[i*3]=x+Math.cos(a)*rr; pos[i*3+1]=y+0.3+Math.random()*1.0; pos[i*3+2]=z+Math.sin(a)*rr;
        const sp=8+Math.random()*10; vel[i*3]=Math.cos(a)*sp; vel[i*3+1]=2+Math.random()*4; vel[i*3+2]=Math.sin(a)*sp;
        life[i]=0.5+Math.random()*0.5; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
      const em=new THREE.PointsMaterial({ map:fireTex(), color:0xffc060, size:0.2, sizeAttenuation:true, ..._premult, depthTest:true });
      const pts=new THREE.Points(geo,em); pts.frustumCulled=false; pts.renderOrder=6; pts.layers.enable(1); scene.add(pts);
      _sparkCols.push({ pts, geo, mat:em, vel, life, n, t:0, max:1.0 }); }
    for(let a=0;a<8;a++){ const an=a*Math.PI/4; monLight({ x:x+Math.cos(an)*8, y:y+2, z:z+Math.sin(an)*8 }, 0xff7a2a, 30, 0.5); }
    try{ ctx.sound?.sfxPath?.('/tomob-deploy/crash.mp3', 0.4); }catch(_){}
  }

  // 🔧 VFX 렌더 검수 훅(/vfx) — 4개 스킬 VFX를 한 줄로 나란히 발생(montage). 게임 로직 무영향.
  ctx.debugDgBossFx = (x,y,z)=>{ x=x||0; z=z||0;
    dgSwirlRing(x-24, y, z);      // 연격
    dgEruption(x-8, y, z);        // 균열
    dgLeapImpact(x+8, y, z);      // 도약
    dgNukeBurst(x+26, y, z);      // 전멸기
    return '연격|균열|도약|전멸기 montage @'+[x|0,y|0,z|0]; };
  // 개별 확인용
  ctx.debugDgVfx = (name, x,y,z)=>{ x=x||0; z=z||0;
    ({ swirl:dgSwirlRing, erupt:dgEruption, leap:dgLeapImpact, nuke:dgNukeBurst }[name]||dgLeapImpact)(x,y,z);
    return name+' @'+[x|0,y|0,z|0]; };
  try{ if(typeof window!=='undefined') window.__dgVfx=(n,x,y,z)=>ctx.debugDgVfx(n,x,y,z); }catch(_){}
  // 🔧 던전 보스 기술 강제 발동 — `__dgAtk('leap')` 등. 실플레이 중 특정 패턴만 반복 확인.
  ctx.debugDgAtk = (name)=>{ const b=(ctx.monsters||[]).find(m=>m.dgBoss && !m.dead); if(!b) return '보스 없음';
    const P=DG(); if(!P[name]) return '기술 목록: '+Object.keys(P).join(', ');
    b.gcd=0; b.acd={}; startAttack(b, P[name](b)); return b.def?.k+' → '+name; };
  try{ if(typeof window!=='undefined'){ window.__dgAtk=(n)=>ctx.debugDgAtk(n); } }catch(_){}

  ctx.onUpdate((dt)=>{ dt = dt || 0.016;
    // 🌋 장판 진행
    for(let i=_aoeZones.length-1; i>=0; i--){ const zn = _aoeZones[i]; zn.t += dt; zn.U.uTime.value += dt;
      if(!zn.blown){
        zn.U.uFill.value = Math.min(1, zn.t / zn.delay);
        if(zn.t >= zn.delay){ zn.blown = true; zn.t = 0; zn.U.uBlow.value = 1;
          const pp = ctx.player?.pos;
          if(pp){ const dd = Math.hypot(pp.x-zn.x, pp.z-zn.z); if(dd <= zn.R) ctx.combat?.hitPlayer?.(zn.dmg); }   // 벗어났으면 회피
          spawnFireBurst(zn.x, zn.y, zn.z, zn.R*0.85, 80);               // 🔥 용암 분출
          monLight({ x:zn.x, y:zn.y+1.6, z:zn.z }, 0xff8a30, 30, 0.32);  // ⚡풀 광원 플래시
          try{ ctx.sound?.sfxPath?.('/tomob-deploy/crash.mp3', 0.24); }catch(_){}
        }
      } else if(zn.scar){   // 🩸 도약 임팩트 균열 흉터 — 백열이 서서히 식으며 1.6s 후 소멸
        zn.U.uBlow.value = Math.max(0, 0.6 - zn.t*0.5);
        if(zn.t > 1.6){ scene.remove(zn.disc); zn.disc.geometry.dispose(); zn.mat.dispose(); _aoeZones.splice(i,1); }
      } else { zn.U.uBlow.value = Math.max(0, 1 - zn.t/0.4);             // 폭발 백열 페이드
        if(zn.t > 0.4){ scene.remove(zn.disc); zn.disc.geometry.dispose(); zn.mat.dispose(); _aoeZones.splice(i,1); }
      }
    }
    // 💥 충격파 링 진행
    for(let i=_shockRings.length-1; i>=0; i--){ const s=_shockRings[i]; s.t += dt; s.U.uT.value = Math.min(1, s.t/s.dur);
      if(s.t >= s.dur){ scene.remove(s.disc); s.disc.geometry.dispose(); s.mat.dispose(); _shockRings.splice(i,1); } }
    // 🔥 불 Points 분출 진행 (중력 낙하 + life 소멸 → 페이드아웃)
    for(let i=_fireBursts.length-1; i>=0; i--){ const b=_fireBursts[i]; b.t += dt;
      const a=b.geo.attributes.position.array;
      for(let k=0;k<b.n;k++){ b.vel[k*3+1] -= 9.0*dt;                    // 중력
        a[k*3]+=b.vel[k*3]*dt; a[k*3+1]+=b.vel[k*3+1]*dt; a[k*3+2]+=b.vel[k*3+2]*dt; b.life[k]-=dt; }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = Math.max(0, 1 - b.t/b.max);   // (premult이라 시각 영향 적지만 안전 페이드)
      if(b.t >= b.max){ scene.remove(b.pts); b.geo.dispose(); b.mat.dispose(); _fireBursts.splice(i,1); }
    }
    // 🌟 수직 스파크 기둥 진행(도약 임팩트 ③) — 위로 솟았다 중력에 흩어짐
    for(let i=_sparkCols.length-1; i>=0; i--){ const s=_sparkCols[i]; s.t += dt;
      const a=s.geo.attributes.position.array;
      for(let k=0;k<s.n;k++){ s.vel[k*3+1] -= 16.0*dt;
        a[k*3]+=s.vel[k*3]*dt; a[k*3+1]+=s.vel[k*3+1]*dt; a[k*3+2]+=s.vel[k*3+2]*dt; }
      s.geo.attributes.position.needsUpdate = true; s.mat.opacity = Math.max(0, 1 - s.t/s.max);
      if(s.t >= s.max){ scene.remove(s.pts); s.geo.dispose(); s.mat.dispose(); _sparkCols.splice(i,1); }
    }
    // 🪨 파편 덩어리 진행(도약 임팩트 ④) — 포물선 낙하 + 회전, 바닥 근처서 소멸
    for(let i=_debris.length-1; i>=0; i--){ const d=_debris[i]; d.t += dt; d.vy -= 20.0*dt;
      const p=d.m.position; p.x+=d.vx*dt; p.y+=d.vy*dt; p.z+=d.vz*dt;
      d.m.rotation.x+=d.rx*dt; d.m.rotation.z+=d.rz*dt;
      if(d.t >= d.max || p.y < -0.5){ scene.remove(d.m); _debris.splice(i,1); }
    }
    // ⚔️ 연격 소용돌이 링 진행
    for(let i=_swirls.length-1; i>=0; i--){ const s=_swirls[i]; s.t += dt; s.U.uT.value = Math.min(1, s.t/s.dur);
      if(s.t >= s.dur){ scene.remove(s.disc); s.disc.geometry.dispose(); s.mat.dispose(); _swirls.splice(i,1); } }
    // ☄️ 전멸기 중심 오브 진행 — 팽창 후 폭발 페이드
    for(let i=_orbs.length-1; i>=0; i--){ const o=_orbs[i]; o.t += dt; const u=o.t/o.dur;
      const sc = u<0.6 ? (0.4+u*1.4) : (1.24 - (u-0.6)*2.0);   // 부풀다 폭발 수축
      o.g.scale.setScalar(Math.max(0.01, sc)); o.g.children.forEach(s=>{ s.material.opacity=Math.max(0,1-u); });
      if(o.t >= o.dur){ scene.remove(o.g); o.g.traverse(m=>m.material?.dispose?.()); _orbs.splice(i,1); } }
    // ⛔2026-07-24 구 "쿨다운마다 발밑 장판 투척" 루프 폐지 — 이제 장판/균열/도약/전멸기는 전부
    //   dgBossSpec 공격 선택기(startAttack 러너) 안에서 애니·경직과 함께 발동한다. 여기서 따로 안 쏜다.
  });

  return monsters;
}
