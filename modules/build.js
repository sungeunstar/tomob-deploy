// build.js — 건설 시스템 모듈 (WoodFrameBuildsSet). 셀 바닥/천장 평면스냅 + 변 벽 + 계단 + 라디얼 썸네일 + 휠높이.
// 출처: voyage/walk.html 빌드 v6 → ctx 기반 모듈 재작성. 의존: ctx.{THREE,scene,camera,renderer,terrain(collide,groundAt)}.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function initBuild(ctx, { woodBase='/obj/WoodFrameBuildsSet_Itch(FREE)/' }={}){
  const { scene, camera, renderer } = ctx;
  const collide = ctx.terrain.collide;
  const groundAt = (x,z,fromY)=>ctx.terrain.groundAt(x,z,fromY);
  const GRID=2, FSCALE=0.01;
  // 던전팩(LowPolyDungeonsLite) — unitypackage 추출분. 별도 base + 단일 아틀라스 텍스처 + 자동 그리드핏(fit).
  const DBASE='/obj/LowPolyDungeonsLite/Models/', DTEX='/obj/LowPolyDungeonsLite/Textures/LowPolyDungeonsLite_Texture_01.png';
  // Kenney 킷(GLB, 임베드 머티리얼) — 사령관 선택 팔레트(_thumb_select). glb=전체경로, gfit=목표 최대치수(m) 자동핏.
  const KAIO='/assets/kenney_all_in_one_3.4.0/3D assets/', KSURV='/assets/kenney_survival-kit/Models/GLB format/';
  const PIECES={
    floor: {label:'바닥/천장', file:'WoodFloor/WoodFloor1',    cost:4, kind:'cell', floorKind:true},
    wall:  {label:'벽',        file:'WoodFence/WoodFence1',     cost:4, kind:'edge'},
    door:  {label:'문',        file:'WoodDoorway/WoodDoorway1', cost:4, kind:'edge'},
    window:{label:'창',        file:'WoodWindow/WoodWindow1',   cost:4, kind:'edge'},
    stairs:{label:'계단',      file:'WoodStairs/WoodStairs2',   cost:5, kind:'cell'},
    // nscale = 네이티브→2m 모듈 정규화 스케일(LowPolyDungeonsLite는 4유닛 모듈 설계 → 구조물 ×0.5면 정확히 2m, 끝이 딱 맞물림).
    // 🧱 구조(던전, 그리드 스냅). nscale = 4유닛 모듈 ×0.5 = 2m.
    dfloor: {label:'던전바닥',   cat:'구조', base:DBASE, file:'Ground_01', tex:DTEX, nscale:0.5, cost:4, kind:'cell', floorKind:true},
    dfloor2:{label:'던전바닥B',  cat:'구조', base:DBASE, file:'Ground_03', tex:DTEX, nscale:1.0, cost:4, kind:'cell', floorKind:true},
    dwall:  {label:'던전벽',     cat:'구조', base:DBASE, file:'Wall_27',   tex:DTEX, nscale:0.5, cost:4, kind:'edge'},
    dcol:   {label:'던전기둥',   cat:'구조', base:DBASE, file:'Column_01', tex:DTEX, nscale:0.5, cost:3, kind:'cell'},
    // 🪑 가구
    dtable: {label:'던전테이블', cat:'가구', base:DBASE, file:'Table_01',  tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dchair: {label:'던전의자',   cat:'가구', base:DBASE, file:'Chair_05',  tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dbench: {label:'벤치',       cat:'가구', glb:KAIO+'Holiday Kit/Models/GLB format/bench.glb',          gfit:1.6, cost:1, kind:'cell'},
    // 📦 수납
    dbox:   {label:'던전상자',   cat:'수납', base:DBASE, file:'Box_02',    tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dbarrel:{label:'술통',       cat:'수납', glb:KAIO+'Pirate Kit/Models/GLB format/barrel.glb',          gfit:1.1, cost:1, kind:'cell'},
    dchest: {label:'궤짝',       cat:'수납', glb:KAIO+'Pirate Kit/Models/GLB format/chest.glb',           gfit:1.1, cost:1, kind:'cell'},
    dcrate: {label:'나무상자',   cat:'수납', glb:KAIO+'Pirate Kit/Models/GLB format/crate-bottles.glb',   gfit:1.1, cost:1, kind:'cell'},
    // 🏺 소품
    dpot:   {label:'던전항아리', cat:'소품', base:DBASE, file:'Pot_01',    tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    djug:   {label:'던전주전자', cat:'소품', base:DBASE, file:'Jug_02',    tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dbook:  {label:'던전책',     cat:'소품', base:DBASE, file:'Book_09',   tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dbottle:{label:'던전병',     cat:'소품', base:DBASE, file:'Bottle_05', tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dcandle:{label:'던전촛불',   cat:'소품', base:DBASE, file:'Candle_01', tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dlight: {label:'던전조명',   cat:'소품', base:DBASE, file:'Light_08',  tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    drock:  {label:'던전바위',   cat:'소품', base:DBASE, file:'Rock_01',   tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    dmud:   {label:'던전진흙',   cat:'소품', base:DBASE, file:'Mud_04',    tex:DTEX, nscale:1.0, cost:1, kind:'cell'},
    // 🚪 개구부(Kenney)
    ddoor:  {label:'문',         cat:'개구부', glb:KAIO+'Castle Kit/Models/GLB format/door.glb',          gfit:2.0, cost:1, kind:'cell'},
    dgate:  {label:'성문',       cat:'개구부', glb:KAIO+'Castle Kit/Models/GLB format/gate.glb',          gfit:2.2, cost:1, kind:'cell'},
    dfence: {label:'울타리',     cat:'개구부', glb:KAIO+'Pirate Kit/Models/GLB format/structure-fence.glb',gfit:1.8, cost:1, kind:'cell'},
    // 🚩 깃발(Kenney)
    dflag:  {label:'깃발',       cat:'깃발', glb:KAIO+'Castle Kit/Models/GLB format/flag.glb',            gfit:2.0, cost:1, kind:'cell'},
    dpennant:{label:'페넌트',    cat:'깃발', glb:KAIO+'Castle Kit/Models/GLB format/flag-pennant.glb',    gfit:2.0, cost:1, kind:'cell'},
    dpflag: {label:'해적기',     cat:'깃발', glb:KAIO+'Pirate Kit/Models/GLB format/flag-pirate.glb',     gfit:2.0, cost:1, kind:'cell'},
    // 🛡️ 방어(Kenney)
    dballista:{label:'발리스타', cat:'방어', glb:KAIO+'Tower Defense Kit/Models/GLB format/weapon-ballista.glb', gfit:2.0, cost:1, kind:'cell'},
    dsignpost:{label:'표지판',   cat:'방어', glb:KSURV+'signpost.glb',     gfit:1.6, cost:1, kind:'cell'},
    dtent:  {label:'텐트',       cat:'방어', glb:KSURV+'tent-canvas.glb',  gfit:2.2, cost:1, kind:'cell'},
  };
  // 라디얼(B키)은 wood 전용 유지. 던전 부품은 인벤토리 제작 탭에서 진입(ctx.build.piece).
  const RADIAL=['floor','wall','door','window','stairs'];
  let selId='floor', ghostRot=0, wood=Infinity, buildMode=false, buildLift=0;
  const floorCells=new Map(), stairsSet=new Set(), wallSet=new Set(), buildHistory=[];
  let ghost=null, ghostMats=[];
  const G_OK=0x4ade5a, G_NO=0xff4040;
  const storyH=()=> (PIECES.floor.h||0.16)+(PIECES.wall.h||2);

  // ── UI 주입(CSS + 라디얼 DOM + 모드표시) ──
  const st=document.createElement('style'); st.textContent=`
    #b_mode{position:fixed;left:14px;top:64px;z-index:6;color:#7af0a0;font:13px system-ui,'Malgun Gothic';text-shadow:0 1px 3px #000;pointer-events:none}
    #b_radial{position:fixed;left:50%;top:50%;width:300px;height:300px;margin:-150px 0 0 -150px;z-index:8;display:none;pointer-events:none}
    #b_radial::before{content:'';position:absolute;left:50%;top:50%;width:280px;height:280px;margin:-140px 0 0 -140px;border-radius:50%;background:radial-gradient(circle,rgba(12,22,34,.30) 38%,rgba(12,22,34,.62) 62%);border:2px solid rgba(255,255,255,.14)}
    #b_radial .ri{position:absolute;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:rgba(28,40,54,.85);border:2px solid rgba(255,255,255,.16);overflow:hidden;transition:transform .09s,background .09s}
    #b_radial .ri img{width:64px;height:64px;object-fit:contain}
    #b_radial .ri.sel{background:rgba(62,166,106,.95);border-color:#aef0c8;transform:scale(1.22)}
    #b_rc{position:absolute;left:50%;top:50%;width:130px;height:130px;margin:-65px 0 0 -65px;border-radius:50%;background:rgba(10,18,28,.88);border:2px solid rgba(255,255,255,.22);display:flex;flex-direction:column;align-items:center;justify-content:center}
    #b_rc img{width:88px;height:88px;object-fit:contain} #b_rcn{color:#fff;font-weight:800;font-size:14px;text-shadow:0 1px 2px #000}`;
  document.head.appendChild(st);
  const modeEl=document.createElement('div'); modeEl.id='b_mode'; document.body.appendChild(modeEl);
  const radialEl=document.createElement('div'); radialEl.id='b_radial';
  radialEl.innerHTML='<div id="b_rc"><img id="b_rcimg" alt=""><div id="b_rcn"></div></div>'; document.body.appendChild(radialEl);
  function setMode(){ modeEl.textContent = buildMode ? '건설 — '+PIECES[selId].label+(buildLift?` (높이 +${buildLift.toFixed(2)}m)`:'')+' · B꾹=휠 · 휠=높이 · R회전 · 좌클릭 · Ctrl+Z · B종료' : ''; }

  // ── FBX/GLB 프리로드 + 썸네일 ──
  const _fbx=new FBXLoader(); const _glb=new GLTFLoader();   // FBX 임베드 헛경로 404는 core.js 전역 URLModifier가 일괄 교정
  const _texL=new THREE.TextureLoader(), _texCache={};
  function loadTex(url){ if(_texCache[url]) return _texCache[url]; const t=_texL.load(encodeURI(url)); t.colorSpace=THREE.SRGBColorSpace; t.flipY=false; _texCache[url]=t; return t; }
  // 던전 FBX: 단일 아틀라스 텍스처 입히고, 명시 정규화 스케일(nscale)로 2m 모듈에 정확히 맞춘 뒤
  //   원점 정규화(수평중심 + 바닥 y=0)해서 셀/변 그리드에 끝이 딱 맞물리게 함.
  function fitDungeon(o,p){
    const tx=loadTex(p.tex); o.traverse(c=>{ if(c.isMesh){ const ms=Array.isArray(c.material)?c.material:[c.material];
      ms.forEach(m=>{ if(m){ m.map=tx; if(m.color)m.color.setHex(0xffffff); m.needsUpdate=true; } }); } });
    o.scale.setScalar(p.nscale||1);
    const bb=new THREE.Box3().setFromObject(o); const c=bb.getCenter(new THREE.Vector3()), mn=bb.min.clone();
    const holder=new THREE.Group(); o.position.set(-c.x, -mn.y, -c.z); holder.add(o); return holder;
  }
  // Kenney GLB: 임베드 머티리얼 유지, 최대치수=gfit(m)로 자동핏 + 원점정규화(수평중심·바닥 y=0).
  function fitGLB(o,p){
    let bb=new THREE.Box3().setFromObject(o), s=bb.getSize(new THREE.Vector3());
    const md=Math.max(s.x,s.y,s.z)||1, sc=(p.gfit||1.2)/md; o.scale.setScalar(sc);
    bb=new THREE.Box3().setFromObject(o); const c=bb.getCenter(new THREE.Vector3()), mn=bb.min.clone();
    const holder=new THREE.Group(); o.position.set(-c.x, -mn.y, -c.z); holder.add(o); return holder;
  }
  function prep(o){ o.traverse(c=>{ if(c.isMesh){ c.castShadow=true; const ms=Array.isArray(c.material)?c.material:[c.material]; ms.forEach(m=>{ if(m){ m.side=THREE.DoubleSide; if(m.map)m.map.colorSpace=THREE.SRGBColorSpace; } }); } }); }
  let _thumbR=null;   // ★썸네일용 공유 렌더러(1개). 조각마다 new WebGLRenderer→dispose는 컨텍스트를 즉시 반환 안 해, 조각 16개↑면 WebGL 한도 초과→메인 렌더러 Context Lost(흰화면). 재사용으로 해결.
  function renderThumb(proto,px=128){ if(!_thumbR){ _thumbR=new THREE.WebGLRenderer({antialias:true,alpha:true}); _thumbR.setClearColor(0,0); }
    const r=_thumbR; r.setSize(px,px);
    const s=new THREE.Scene(); s.add(new THREE.HemisphereLight(0xffffff,0x556070,1.35)); const dl=new THREE.DirectionalLight(0xffffff,1.1); dl.position.set(2,4,3); s.add(dl);
    const o=proto.clone(true); const bb=new THREE.Box3().setFromObject(o); const c=bb.getCenter(new THREE.Vector3()),sz=bb.getSize(new THREE.Vector3()); o.position.sub(c); s.add(o);
    const rad=Math.max(sz.x,sz.y,sz.z)||1, cam=new THREE.PerspectiveCamera(38,1,0.01,1000), d=rad*1.9; cam.position.set(d*0.75,d*0.62,d); cam.lookAt(0,0,0);
    r.render(s,cam); const u=r.domElement.toDataURL('image/png'); return u; }   // ★dispose 안 함(공유 렌더러 재사용)
  async function preload(){ for(const id in PIECES){ const p=PIECES[id];
    // FBX 자산 누락(체크아웃/오프라인)이 게임 부팅 전체를 막지 않게 — veg.js와 동일하게 비치명적 처리.
    try{
      let o;
      if(p.glb){ const g=await new Promise((rs,rj)=>_glb.load(encodeURI(p.glb),rs,undefined,rj)); o=fitGLB(g.scene||g,p); prep(o); }   // Kenney GLB: 임베드텍스처+자동핏
      else { const base=p.base||woodBase;
        o=await new Promise((rs,rj)=>_fbx.load(encodeURI(base+p.file+'.fbx'),rs,undefined,rj));
        if(p.base){ o=fitDungeon(o,p); prep(o); }                    // 던전 FBX: 아틀라스+정규화
        else { o.scale.setScalar(FSCALE); if(p.kind==='edge') o.scale.x*=1.10; prep(o); } }
      const bb=new THREE.Box3().setFromObject(o),s=new THREE.Vector3(); bb.getSize(s); p.proto=o; p.h=s.y;
      try{ p.thumb=renderThumb(o); }catch(e){}
    }catch(e){ console.warn('[build] 에셋 누락 스킵:', p.file||p.glb, e&&e.message); }
  }
    buildRadial(); }
  function buildRadial(){ [...radialEl.querySelectorAll('.ri')].forEach(n=>n.remove());
    const n=RADIAL.length,R=108; RADIAL.forEach((id,i)=>{ const a=(-90+i*360/n)*Math.PI/180; const d=document.createElement('div'); d.className='ri';
      d.style.left=(150+Math.cos(a)*R)+'px'; d.style.top=(150+Math.sin(a)*R)+'px';
      if(PIECES[id].thumb){ const im=document.createElement('img'); im.src=PIECES[id].thumb; d.appendChild(im); } else d.textContent=PIECES[id].label;
      radialEl.appendChild(d); }); }

  function makeGhost(){ if(ghost){ scene.remove(ghost); } const p=PIECES[selId]; if(!p.proto) return;
    ghost=p.proto.clone(true); ghostMats=[]; ghost.traverse(o=>{ if(o.isMesh){ const src=Array.isArray(o.material)?o.material:[o.material];
      const cl=src.map(m=>{ const n=m.clone(); n.transparent=true; n.opacity=0.5; n.depthWrite=false; ghostMats.push(n); return n; }); o.material=Array.isArray(o.material)?cl:cl[0]; } });
    ghost.renderOrder=999; ghost.visible=false; scene.add(ghost); }
  function tint(v){ const c=v?G_OK:G_NO; ghostMats.forEach(m=>{ if(m.color)m.color.setHex(c); }); }

  const aimRC=new THREE.Raycaster(); let aimOverride=null;
  function aimPoint(){ if(aimOverride) return aimOverride.clone(); aimRC.setFromCamera({x:0,y:0},camera); const h=aimRC.intersectObjects(collide,true); return h.length?h[0].point:null; }

  // 🚩 거점 반경 게이트(2026-08-07) — 팰월드式: 깃발을 꽂은 거점 안에서만 건설.
  //   outpost 모듈이 없거나(구 세이브·테스트맵) 거점을 아직 하나도 안 세웠으면 제한하지 않는다(첫 깃발 세우기 전 잠김 방지).
  function inOutpost(x,z){
    const op=ctx.outpost; if(!op || !op.outpostAt) return true;
    if(op.used<=0) return true;              // 거점 0개 = 아직 샌드박스 자유건설(첫 깃발 전)
    return !!op.outpostAt(x,z);
  }
  function computeSnap(){
    const P=PIECES[selId], FT=PIECES.floor.h||0.16, STORY=storyH(), lift=isFinite(buildLift)?buildLift:0;
    // 던전 부품은 인벤토리 보유량으로 게이팅(wood 자원 아님). wood 부품은 기존 wood 비용.
    const afford = P&&P.base ? ((ctx.inventory&&ctx.inventory.count(selId))>0) : (wood>=(P?P.cost:0));
    if(P.kind==='cell'){
      let gx,gz,cx,cz,baseY,L;
      if(aimOverride){ const pt=aimOverride; gx=Math.round(pt.x/GRID); gz=Math.round(pt.z/GRID); cx=gx*GRID; cz=gz*GRID;
        const c=floorCells.get(gx+','+gz); if(c) baseY=c.baseY; else { baseY=null; for(const[dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]){const nn=floorCells.get((gx+dx)+','+(gz+dz));if(nn){baseY=nn.baseY;break;}} if(baseY===null){const g=groundAt(cx,cz,pt.y+4);if(g<=0.6)return{valid:false,pos:new THREE.Vector3(cx,1,cz)};baseY=g;} }
        L=Math.round((pt.y-baseY)/STORY); if(L<0)L=0;
      } else { const ro=camera.position, rd=new THREE.Vector3(); camera.getWorldDirection(rd);
        let nb=null,nd=1e9; for(const c of floorCells.values()){ const d=(c.gx*GRID-ro.x)**2+(c.gz*GRID-ro.z)**2; if(d<nd){nd=d;nb=c;} }
        let by=nb?nb.baseY:groundAt(ro.x,ro.z,ro.y+2); if(by<=0.6)by=0; let best=null,bt=1e9;   // ★눈높이서 아래로(봉우리·오버행 대신 발밑 지면)
        for(let k=0;k<=4;k++){ const py=by+k*STORY+lift; const dy=Math.abs(rd.y)<1e-4?1e-4:rd.y; const tt=(py-ro.y)/dy; if(tt>0.4&&tt<bt&&tt<70){bt=tt;best={k,x:ro.x+rd.x*tt,z:ro.z+rd.z*tt};} }
        if(!best) return {valid:false,pos:null};
        gx=Math.round(best.x/GRID); gz=Math.round(best.z/GRID); cx=gx*GRID; cz=gz*GRID; L=best.k;
        const c=floorCells.get(gx+','+gz); if(L===0&&!c){ const g=groundAt(cx,cz,ro.y+2); if(g<=0.6)return{valid:false,pos:new THREE.Vector3(cx,1,cz)}; baseY=g; } else baseY=c?c.baseY:by; }
      if(L<0)L=0; const y=baseY+L*STORY+lift; const c2=floorCells.get(gx+','+gz);
      const occ=P.floorKind?(c2&&c2.levels.has(L)):stairsSet.has(gx+','+gz+'|'+L);
      return {valid:!occ&&afford&&inOutpost(cx,cz),pos:new THREE.Vector3(cx,y,cz),rotY:ghostRot*Math.PI/180,key:gx+','+gz,gx,gz,baseY,L};
    }
    const pt=aimPoint(); if(!pt) return {valid:false,pos:null};
    let best=null,bd=1e9; for(const f of floorCells.values()){ const d=(f.gx*GRID-pt.x)**2+(f.gz*GRID-pt.z)**2; if(d<bd){bd=d;best=f;} }
    if(!best||bd>(GRID*1.6)**2) return {valid:false,pos:pt.clone()};
    const cx=best.gx*GRID,cz=best.gz*GRID,dx=pt.x-cx,dz=pt.z-cz; let edge,ex=cx,ez=cz,rotY=0;
    if(Math.abs(dx)>=Math.abs(dz)){ edge=dx>=0?'E':'W'; ex=cx+(dx>=0?GRID/2:-GRID/2); rotY=Math.PI/2; } else { edge=dz>=0?'N':'S'; ez=cz+(dz>=0?GRID/2:-GRID/2); rotY=0; }
    // ★변(벽) 층 결정: buildLift(높이휠)로 목표 level을 먼저 정하고 그 level의 점유를 검사(셀 분기와 동일 순서).
    //   과거엔 '가장 낮은 빈 슬롯'을 고른 뒤 그 슬롯을 점유검사 → 항상 false라 점유검사가 무의미했고,
    //   buildLift는 시각 y에만 반영돼 데이터층(level)과 시각층이 어긋나 같은 변에 중복 벽이 겹쳐 생겼음.
    let level=Math.round(lift/STORY); if(level<0)level=0;
    const occ=wallSet.has(best.gx+','+best.gz+'|'+edge+'|'+level);
    const y=best.baseY+FT+level*STORY;
    return {valid:!occ&&afford&&inOutpost(ex,ez),pos:new THREE.Vector3(ex,y,ez),rotY,key:best.gx+','+best.gz,edge,level,wall:true};
  }
  function place(){ const s=computeSnap(); if(!s.valid) return; const p=PIECES[selId]; if(!p.proto) return;
    const mesh=p.proto.clone(true); mesh.position.copy(s.pos); mesh.rotation.y=s.rotY||0; scene.add(mesh); collide.push(mesh); wood-=p.cost;
    ctx.sound?.play?.('build_place');   // ★배치음(나무 쿵)
    const matId = p.base ? selId : null;                       // 던전 부품 = 인벤 아이템 id(차감·환급)
    if(matId && ctx.inventory){ ctx.inventory.remove(matId,1); if(ctx.updHotbar)ctx.updHotbar(); }
    // ★물리 콜라이더 = 솔리드 큐보이드(걸어다니는 진짜 바닥 + groundAt 물리 인식). AABB 기반(빌드 회전=90°라 타이트).
    let _body=null;
    if(ctx.RAPIER && ctx.world){ try{
      mesh.updateWorldMatrix(true,true);
      const bb=new THREE.Box3().setFromObject(mesh), c=bb.getCenter(new THREE.Vector3()), sz=bb.getSize(new THREE.Vector3());
      _body=ctx.world.createRigidBody(ctx.RAPIER.RigidBodyDesc.fixed().setTranslation(c.x,c.y,c.z));
      ctx.world.createCollider(ctx.RAPIER.ColliderDesc.cuboid(Math.max(sz.x/2,0.05),Math.max(sz.y/2,0.05),Math.max(sz.z/2,0.05)), _body);
    }catch(e){} }
    const rmBody=()=>{ if(_body && ctx.world){ try{ ctx.world.removeRigidBody(_body); }catch(_){} _body=null; } };
    if(ctx.destruct) ctx.destruct.makeBreakable(mesh, { hp: p.kind==='cell' ? 45 : 28, onBreak:rmBody });   // 부서지면 물리도 제거(고스트 콜라이더 방지)
    if(p.kind==='cell'){ if(p.floorKind){ let c=floorCells.get(s.key); if(!c){c={gx:s.gx,gz:s.gz,baseY:s.baseY,levels:new Set()};floorCells.set(s.key,c);} c.levels.add(s.L); buildHistory.push({kind:'floor',key:s.key,L:s.L,mesh,cost:p.cost,matId,rmBody}); }
      else { const sk=s.key+'|'+s.L; stairsSet.add(sk); buildHistory.push({kind:'stairs',sk,mesh,cost:p.cost,matId,rmBody}); } }
    else { const wk=s.key+'|'+s.edge+'|'+s.level; wallSet.add(wk); buildHistory.push({kind:'wall',wk,mesh,cost:p.cost,matId,rmBody}); }
    // 던전 부품 보유 소진 시 자동 배치모드 종료
    if(matId && ctx.inventory && ctx.inventory.count(matId)<=0){ buildMode=false; if(ghost)ghost.visible=false; setMode(); if(ctx.updHotbar)ctx.updHotbar(); } }
  function undo(){ const h=buildHistory.pop(); if(!h)return; scene.remove(h.mesh); const ci=collide.indexOf(h.mesh); if(ci>=0)collide.splice(ci,1); wood+=h.cost;
    if(h.rmBody) h.rmBody();   // ★물리 바디 제거
    if(h.matId && ctx.inventory){ ctx.inventory.add(h.matId,1); if(ctx.updHotbar)ctx.updHotbar(); }   // 던전 부품 환급
    if(h.kind==='floor'){ const c=floorCells.get(h.key); if(c){c.levels.delete(h.L); if(c.levels.size===0)floorCells.delete(h.key);} } else if(h.kind==='stairs') stairsSet.delete(h.sk); else wallSet.delete(h.wk); }

  // 🔨 망치 철거: 조준한 내 건축물(던전 부품/목조)을 부수고(던전 부품=재료 1개 환급) 그리드 등록 해제. undo의 "대상 지정판".
  function demolishAimed(range=9){ const meshes=buildHistory.map(h=>h.mesh); if(!meshes.length) return false;
    aimRC.setFromCamera({x:0,y:0},camera); const hits=aimRC.intersectObjects(meshes,true);
    if(!hits.length || hits[0].distance>range) return false;
    let o=hits[0].object; const roots=new Set(meshes); while(o&&!roots.has(o)) o=o.parent; if(!o) return false;
    const hi=buildHistory.findIndex(h=>h.mesh===o); if(hi<0) return false;
    const h=buildHistory.splice(hi,1)[0];
    scene.remove(h.mesh); const ci=collide.indexOf(h.mesh); if(ci>=0)collide.splice(ci,1); wood+=h.cost;
    if(h.rmBody) h.rmBody();   // 물리 바디 제거(고스트 콜라이더 방지)
    const brk=h.mesh.userData&&h.mesh.userData.breakable;   // destruct 등록 해제(제거된 메시가 breakables에 스테일로 남지 않게)
    if(brk&&ctx.destruct&&ctx.destruct.breakables){ const bi=ctx.destruct.breakables.indexOf(brk); if(bi>=0)ctx.destruct.breakables.splice(bi,1); }
    if(h.matId && ctx.inventory){ ctx.inventory.add(h.matId,1); if(ctx.updHotbar)ctx.updHotbar(); }   // 던전 부품 환급(목조는 wood 자원=환급 무의미)
    if(h.kind==='floor'){ const c=floorCells.get(h.key); if(c){c.levels.delete(h.L); if(c.levels.size===0)floorCells.delete(h.key);} }
    else if(h.kind==='stairs') stairsSet.delete(h.sk); else if(h.kind==='wall') wallSet.delete(h.wk);
    ctx.sound?.play?.('destroy');
    if(ctx.invui&&ctx.invui.toast) ctx.invui.toast(''+((PIECES[h.matId]||{}).label||'건축물')+' 철거'+(h.matId?' (+1)':''));
    return true; }

  // 라디얼
  let radialOpen=false, radSel=0, _rax=0,_ray=0,_bDown=false,_bTimer=0;
  // ★D3(2026-07-15): 구 openRadial() 제거 — B키 라디얼 폐기 후 호출부 0건(dead code). radialOpen은 항상 false로 유지(아래 가드 무해).
  function radialMove(dx,dy){ _rax+=dx;_ray+=dy; if(_rax*_rax+_ray*_ray>100){ let deg=Math.atan2(_ray,_rax)*180/Math.PI; let bi=0,bd=1e9; for(let i=0;i<RADIAL.length;i++){ let ia=-90+i*360/RADIAL.length; let d=Math.abs(((deg-ia+540)%360)-180); if(d<bd){bd=d;bi=i;} } radSel=bi; updateRadial(); } }
  function updateRadial(){ const its=radialEl.querySelectorAll('.ri'); its.forEach((c,i)=>c.classList.toggle('sel',i===radSel)); const id=RADIAL[radSel]; const im=document.getElementById('b_rcimg'); if(im&&PIECES[id]&&PIECES[id].thumb){im.src=PIECES[id].thumb;im.style.display='';}else if(im)im.style.display='none'; const nm=document.getElementById('b_rcn'); if(nm)nm.textContent=PIECES[id]?PIECES[id].label:''; }
  function closeRadial(pick){ radialOpen=false; radialEl.style.display='none'; if(pick){ selId=RADIAL[radSel]; buildMode=true; buildLift=0; makeGhost(); setMode(); } }

  // ★B키 건설 트리거 제거(사령관 2026-07-10 "B키 건설 빼도 될거같음 제작/건설은 퀵슬롯키로만") — 라디얼·빌드모드 토글 전부 폐기.
  //   부품 선택+배치 진입은 이제 오직 퀵슬롯(player.js selectSlot → ctx.build.startPlace)만 담당. ★D3(2026-07-15): openRadial/closeRadial 미사용 export 제거.
  addEventListener('keydown',e=>{
    if(e.code==='Escape'&&radialOpen){ closeRadial(false); return; } if(!buildMode) return;
    // ★Digit1~5 옛 부품선택 핫키 제거 — 퀵슬롯(player.js selectSlot)과 충돌해 3=문 등으로 덮어쓰던 버그. 부품 선택은 퀵슬롯이 담당.
    if(e.code==='KeyR'){ghostRot=(ghostRot+90)%360;} else if(e.code==='KeyZ'&&(e.ctrlKey||e.metaKey)){e.preventDefault();undo();} });
  renderer.domElement.addEventListener('mousedown',e=>{ if(e.button===0&&buildMode&&!radialOpen&&document.pointerLockElement===renderer.domElement) place(); });
  addEventListener('wheel',e=>{ if(!buildMode||radialOpen)return; e.preventDefault(); buildLift+=(e.deltaY<0?0.25:-0.25); if(buildLift<0)buildLift=0; setMode(); },{passive:false});

  ctx.onUpdate(()=>{ if(!buildMode||radialOpen||!ghost){ if(ghost)ghost.visible=false; return; } const s=computeSnap(); if(!s.pos){ghost.visible=false;return;} ghost.visible=true; ghost.position.copy(s.pos); ghost.rotation.y=s.rotY||0; tint(s.valid); });

  await preload();
  // ── 프리워밍(사령관 "첫 건설 프레임 드랍") — 건물 프로토 + 고스트(반투명) 머티리얼 셰이더 컴파일을 로드 시점으로 ──
  try{
    const protos=Object.keys(PIECES).map(id=>PIECES[id].proto).filter(Boolean).map(pr=>{ const c=pr.clone(true); c.position.set(0,-990,0); scene.add(c); return c; });
    makeGhost();   // 고스트 반투명 머티리얼 클론 경로 워밍(현재 selId)
    if(ctx.renderer && ctx.camera) ctx.renderer.compile(scene, ctx.camera);
    protos.forEach(c=>scene.remove(c));
  }catch(e){ console.warn('[build] prewarm', e&&e.message); }
  ctx.build={ radialOpen:()=>radialOpen, isBuilding:()=>buildMode, radialMove,   /* ★D3(2026-07-15): openRadial/closeRadial export 제거(호출부 0건) */
    mode:b=>{buildMode=b;if(b&&!ghost)makeGhost();if(!b&&ghost)ghost.visible=false;setMode();}, piece:id=>{selId=id;makeGhost();setMode();},
    // 인벤토리 제작 탭에서 호출: 부품 선택 + 배치모드 진입 + 포인터락(즉시 건설). 미존재 id면 false.
    startPlace:id=>{ if(!PIECES[id]) return false;
      if(PIECES[id].base && ctx.inventory && ctx.inventory.count(id)<=0) return false;   // 보유 없으면 배치 불가
      selId=id; buildMode=true; buildLift=0; ghostRot=0; makeGhost(); setMode();
      const el=renderer.domElement; if(el&&el.requestPointerLock) el.requestPointerLock(); return true; },
    aim:(x,y,z)=>{aimOverride=new THREE.Vector3(x,y,z);}, clearAim:()=>{aimOverride=null;}, snap:()=>computeSnap(), place, undo, demolishAimed,
    // ★집 실내 판정(sound.js home BGM 등): 플레이어가 지은 토대(바닥) 위 + 머리 위 천장(다음 층 바닥=지붕) = 둘러싸인 집.
    //   항구/점령지는 집 아님(사령관). 지붕 없는 열린 플랫폼도 집 아님.
    inHouse:(pos)=>{ if(!pos) return false;
      const gx=Math.round(pos.x/GRID), gz=Math.round(pos.z/GRID);
      const c=floorCells.get(gx+','+gz); if(!c) return false;                 // 토대 위 아님
      const STORY=storyH(); let L=Math.round((pos.y-c.baseY)/STORY); if(L<0)L=0;
      return c.levels.has(L) && c.levels.has(L+1); },                          // 발밑 바닥 + 머리 위 천장
    stat:()=>{let f=0;floorCells.forEach(c=>f+=c.levels.size);return{f,w:wallSet.size,s:stairsSet.size,hist:buildHistory.length};} };
  return ctx.build;
}
