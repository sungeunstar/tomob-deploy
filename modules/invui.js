// invui.js — 인벤토리 + 제작 통합 패널 (생존게임식, _CRAFT_INV.md 스펙).
//   레이아웃 = 젤다 BotW(레퍼런스 voyage/ref/인벤토리) : 뒤 게임화면 블러 + 그 위에 반투명 박스.
//     상단중앙 탭 + 탭 밑 라인 / 좌 그리드 박스 / 우 상세 박스 / 하단 핫바.
//   ★배경은 "게임 화면"이 비치는 것(backdrop blur). 이미지(map2.png 등) 깔지 않는다. 컬러만 해도 톤(네이비/골드/청록).
//   탭3 = 🎒재료(개인) / ⚓화물(교역품) / 🔨제작(레시피). [I]키. inventory.js(동결) 읽기/차감만 + claim 배치 연동.
//   ★아이콘 = 실제 3D 모델 자동 렌더(오프스크린 1개 공유 + dataURL 캐시). 모델 없는 재료는 stone 틴팅/이모지 폴백.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';   // 보유배 3D — oseberg 배(OBJ)
import { KAY_CHARS } from '/tomob-deploy/modules/player.js';   // 중앙 3D 캐릭터 뷰어 — 클래스별 GLB 경로
import { BAL } from '/tomob-deploy/modules/balance.js';        // 배 내구도 최대값(보유배 화면)
import { BUILDINGS as SETTLE_BUILDINGS } from '/tomob-deploy/modules/settlement.js';   // 🏛️ 거점 건물 카탈로그 — 제작 탭 [거점]에 편입(정의는 settlement.js가 SSOT)
import { SHIPS as SHIPYARD_SHIPS } from '/tomob-deploy/modules/shipyard.js';           // 🚢 배 카탈로그 — 제작 탭 [선박]에 편입(정의는 shipyard.js가 SSOT)

// ── 아이템 아이콘 = 3D 모델 자동 렌더 (모듈 1회 셋업, 결과 dataURL 캐시) ──
const _STONE='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/resource-stone.glb';
const _PLAT='/assets/kenney_all_in_one_3.4.0/3D assets/Platformer Kit/Models/GLB format/';   // 디스크 확인됨(추출 O)
const _DUN='/tomob-deploy/obj/LowPolyDungeonsLite/Models/', _DUNTEX='/tomob-deploy/obj/LowPolyDungeonsLite/Textures/LowPolyDungeonsLite_Texture_01.png';
const _KAIO='/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/', _KSURV='/tomob-deploy/assets/kenney_survival-kit/Models/GLB format/';   // Kenney 빌드 GLB(임베드 머티)
const _KRB='/tomob-deploy/KayKit_ResourceBits_1.0_FREE/KayKit_ResourceBits_1.0_FREE/Assets/gltf/';   // 🪨 KayKit ResourceBits(광물 너겟·바·통나무) — 텍스처 gltf폴더에 복사됨
const ICON_MODELS={
  // ★timber/stone/gem/rum = 크래프트 2D 아이콘(ui/icons/) 사용 → ICON_MODELS 썸네일 제외(pv 우선). timber는 통나무 모델 부재로 크레이트 placeholder였음.
  // 🪨 광물 = KayKit ResourceBits 실제 너겟/바 모델(전엔 전부 똑같은 틴팅 stone). tin/coal/cobalt은 전용 모델 없어 틴팅 유지.
  iron  :{ path:_KRB+'Iron_Nugget_Medium.gltf' }, copper:{ path:_KRB+'Copper_Nugget_Medium.gltf' }, tin:{ path:_STONE, tint:0xa8afb7 },
  coal  :{ path:_STONE, tint:0x26282d }, steel :{ path:_KRB+'Iron_Bar.gltf' }, cobalt:{ path:_STONE, tint:0x3a63e0 },
  bronze:{ path:_KRB+'Copper_Bar.gltf' },
  gold  :{ path:_KRB+'Gold_Nugget_Medium.gltf' },
  silver:{ path:_KRB+'Silver_Nugget_Medium.gltf' },
  cannon:{ path:'/tomob-deploy/obj/pirateship/Cannon_00.fbx', tint:0x3a3f45 },
  // 🛠️ 손도구(퀵슬롯 썸네일 — player.js LOADOUT과 동일 GLB)
  pickaxe:{ path:_KSURV+'tool-pickaxe.glb', rot:[0.15,-0.5,0.35] },
  axe    :{ path:'/tomob-deploy/KayKit_Adventurers_2.0_FREE/Assets/gltf/axe_1handed.gltf', rot:[0.15,-0.5,0.35] },
  torch  :{ path:'/tomob-deploy/torch_simple.glb', rot:[0.1,-0.3,0.15] },
  hammer :{ path:_KSURV+'tool-hammer-upgraded.glb', rot:[0.15,-0.5,0.35] },   // 🔨 철거 도구 썸네일
  woodblock:{ path:'/tomob-deploy/KayKit_BlockBits_1.0_FREE/KayKit_BlockBits_1.0_FREE/Assets/gltf/wood.gltf' },    // 🧱 축성 티어1
  wallblock:{ path:'/tomob-deploy/KayKit_BlockBits_1.0_FREE/KayKit_BlockBits_1.0_FREE/Assets/gltf/stone.gltf' },   // 🧱 축성 티어2
  ironblock:{ path:'/tomob-deploy/KayKit_BlockBits_1.0_FREE/KayKit_BlockBits_1.0_FREE/Assets/gltf/metal.gltf' },   // 🧱 축성 티어3
  cannonblock:{ path:'/tomob-deploy/obj/pirateship/Cannon_00.fbx', tint:0x3a3f45 },   // 🔫 포대 = 대포 모델 썸네일
  // 던전 건축 부품 = 실제 모델 + 단일아틀라스 텍스처 렌더(이모지 아님)
  dfloor  :{ path:_DUN+'Ground_01.fbx',    tex:_DUNTEX },
  dfloor2 :{ path:_DUN+'Ground_03.fbx',    tex:_DUNTEX },
  dwall   :{ path:_DUN+'Wall_27.fbx',      tex:_DUNTEX },
  dcol    :{ path:_DUN+'Column_01.fbx',    tex:_DUNTEX },
  dtable  :{ path:_DUN+'Table_01.fbx',     tex:_DUNTEX }, dchair :{ path:_DUN+'Chair_05.fbx',  tex:_DUNTEX },
  dbox    :{ path:_DUN+'Box_02.fbx',       tex:_DUNTEX }, dpot   :{ path:_DUN+'Pot_01.fbx',    tex:_DUNTEX },
  djug    :{ path:_DUN+'Jug_02.fbx',       tex:_DUNTEX }, dbook  :{ path:_DUN+'Book_09.fbx',   tex:_DUNTEX },
  dbottle :{ path:_DUN+'Bottle_05.fbx',    tex:_DUNTEX }, dcandle:{ path:_DUN+'Candle_01.fbx', tex:_DUNTEX },
  dlight  :{ path:_DUN+'Light_08.fbx',     tex:_DUNTEX }, drock  :{ path:_DUN+'Rock_01.fbx',   tex:_DUNTEX },
  dmud    :{ path:_DUN+'Mud_04.fbx',       tex:_DUNTEX },
  // Kenney GLB(임베드 머티 — tex 없음)
  campfire:{ path:_KSURV+'campfire-pit.glb' },   // 🔥 모닥불 = 실제 모델 썸네일
  dbench  :{ path:_KAIO+'Holiday Kit/Models/GLB format/bench.glb' },
  dbarrel :{ path:_KAIO+'Pirate Kit/Models/GLB format/barrel.glb' },
  dchest  :{ path:_KAIO+'Pirate Kit/Models/GLB format/chest.glb' },
  dcrate  :{ path:_KAIO+'Pirate Kit/Models/GLB format/crate-bottles.glb' },
  ddoor   :{ path:_KAIO+'Castle Kit/Models/GLB format/door.glb' },
  dgate   :{ path:_KAIO+'Castle Kit/Models/GLB format/gate.glb' },
  dfence  :{ path:_KAIO+'Pirate Kit/Models/GLB format/structure-fence.glb' },
  dflag   :{ path:_KAIO+'Castle Kit/Models/GLB format/flag.glb' },
  dpennant:{ path:_KAIO+'Castle Kit/Models/GLB format/flag-pennant.glb' },
  dpflag  :{ path:_KAIO+'Pirate Kit/Models/GLB format/flag-pirate.glb' },
  dballista:{ path:_KAIO+'Tower Defense Kit/Models/GLB format/weapon-ballista.glb' },
  dsignpost:{ path:_KSURV+'signpost.glb' },
  dtent   :{ path:_KSURV+'tent-canvas.glb' },
  // 🚩 거점 깃발(outpost.js와 같은 모델 — 제작 항목과 실제 설치물이 일치해야 알아본다)
  banner  :{ path:_KAIO+'Castle Kit/Models/GLB format/flag.glb' },
  // 🗡️ 용병 배치 — 명부 항목이라 고정 모델이 없다. 대표 아이콘으로 검을 쓴다(이모지 금지).
  merc_deploy:{ path:'/tomob-deploy/KayKit_Adventurers_2.0_FREE/Assets/gltf/sword_1handed.gltf', rot:[0.15,-0.5,0.35] },
};
// 🏛️ 거점 건물 썸네일 — BUG-A3(사령관 "특수건물 ui 실제 glb 불러와서 보여줘야함").
//   이모지 대신 실제 건물 FBX를 렌더한다. settlement.js가 쓰는 것과 같은 에셋(KayKit Medieval Hexagon,
//   단일 아틀라스 hexagons_medieval.png) — cfg.tex 경로가 이미 아틀라스 주입을 지원하므로 그대로 얹는다.
//   ★썸네일 렌더러는 _iconRenderer() 공유 1개 — 항목마다 새 WebGLRenderer를 만들면 컨텍스트 한도를 넘겨
//     메인 렌더러가 Context Lost(흰 화면)로 죽는다(build.js가 이미 겪은 함정).
const _HEXB='/tomob-deploy/KayKit_Medieval_Hexagon_Pack_1.0_FREE/KayKit_Medieval_Hexagon_Pack_1.0_FREE/Assets/fbx/buildings/yellow/';
for(const [_id, _b] of Object.entries(SETTLE_BUILDINGS)){
  ICON_MODELS['settle_'+_id] = { path:_HEXB+_b.file+'_yellow.fbx', tex:_HEXB+'hexagons_medieval.png' };
}
// ⚓🚢 항구·배 썸네일(BUG-A4) — 배는 shipyard SSOT의 실제 GLB를 그대로 쓴다(제작 항목 = 실제 건조물 일치).
//   항구는 현재 선술집 모델을 재활용 중이라 그 모델로 표시(부두 모델 교체 시 이 경로만 바꾸면 됨).
// ⚓ 항구 = 실제 부두 모델(the-wharf OBJ). wharf.js가 배치하는 것과 같은 에셋 — 제작 항목과 결과물 일치.
ICON_MODELS['wharf_build'] = { path:'/tomob-deploy/the-wharf/source/model/Untitled 1.obj', tex:'/tomob-deploy/the-wharf/textures/Untitled_1_Mat_1_BaseColor.png' };
for(const _s of SHIPYARD_SHIPS){
  if(_s && _s.ship && _s.ship.objUrl) ICON_MODELS['ship_'+_s.key] = { path:_s.ship.objUrl, rot:[0.22, Math.PI*0.18, 0] };
}
let _iconR=null,_iconScene=null,_iconCam=null;
const _modelCache={}, _iconCache={};
function _iconRenderer(){
  if(_iconR) return _iconR;
  _iconR=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
  _iconR.setSize(512,512); _iconR.setClearColor(0x000000,0);   // 고해상도(상세 확대 대비 — 그리드는 다운스케일)
  _iconScene=new THREE.Scene();
  _iconScene.add(new THREE.HemisphereLight(0xffffff,0x4a5566,1.55));
  const dl=new THREE.DirectionalLight(0xffffff,1.45); dl.position.set(2.5,4,3); _iconScene.add(dl);
  _iconCam=new THREE.PerspectiveCamera(36,1,0.01,1000);
  return _iconR;
}
const _glb=new GLTFLoader(), _fbx=new FBXLoader();   // FBX 임베드 헛경로 404는 core.js 전역 URLModifier가 일괄 교정
// 🚢 DRACO 디코더 연결(2026-08-07, BUG-A4 실렌더 확인 중 발견) — 배 GLB(optimized.glb)는 DRACO 압축이라
//   그냥 GLTFLoader로 열면 "No DRACOLoader instance provided"로 실패해 썸네일이 이모지로 폴백됐다.
//   아래 보유배 3D 뷰어가 쓰던 것과 동일한 디코더 경로. 지연 import라 로드 실패해도 다른 아이콘엔 영향 없음.
import('three/addons/loaders/DRACOLoader.js').then(({ DRACOLoader })=>{
  const d=new DRACOLoader(); d.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
  _glb.setDRACOLoader(d);
}).catch(e=>console.warn('[invui] DRACO 디코더 연결 실패(배 썸네일 제한)', e&&e.message));
const _texL=new THREE.TextureLoader(), _texCache={};
async function _loadTex(url){ if(_texCache[url]) return _texCache[url]; const t=await _texL.loadAsync(encodeURI(url)); t.colorSpace=THREE.SRGBColorSpace; t.flipY=false; _texCache[url]=t; return t; }
function _loadModel(path){
  if(_modelCache[path]) return _modelCache[path];
  const url=encodeURI(path);
  const lp=path.toLowerCase();
  _modelCache[path]= lp.endsWith('.fbx')
    ? new Promise((rs,rj)=>_fbx.load(url,rs,undefined,rj))
    // ⚓ OBJ 지원(2026-08-07) — 부두(the-wharf)가 OBJ라 이 분기가 없으면 GLTFLoader가 열다 실패해 이모지로 폴백된다.
    : lp.endsWith('.obj')
      ? new Promise((rs,rj)=>new OBJLoader().load(url,rs,undefined,rj))
      : new Promise((rs,rj)=>_glb.load(url,g=>rs(g.scene),undefined,rj));
  return _modelCache[path];
}
function renderIcon(id){
  if(id in _iconCache) return Promise.resolve(_iconCache[id]);
  const cfg=ICON_MODELS[id]; if(!cfg){ _iconCache[id]=null; return Promise.resolve(null); }
  const p=(async()=>{
    const src=await _loadModel(cfg.path);
    const o=src.clone(true);
    if(cfg.tint) o.traverse(m=>{ if(m.isMesh) m.material=new THREE.MeshStandardMaterial({color:cfg.tint,metalness:0.35,roughness:0.55}); });
    else if(cfg.tex){ const tx=await _loadTex(cfg.tex); o.traverse(m=>{ if(m.isMesh){ const ms=Array.isArray(m.material)?m.material:[m.material]; ms.forEach(mm=>{ if(mm){ mm.map=tx; if(mm.color)mm.color.setHex(0xffffff); mm.needsUpdate=true; } }); } }); }
    else o.traverse(m=>{ if(m.isMesh){ const ms=Array.isArray(m.material)?m.material:[m.material]; ms.forEach(mm=>{ if(mm&&mm.map) mm.map.colorSpace=THREE.SRGBColorSpace; }); } });
    const r=_iconRenderer();
    const bb=new THREE.Box3().setFromObject(o), c=bb.getCenter(new THREE.Vector3()), s=bb.getSize(new THREE.Vector3());
    o.position.sub(c);
    const holder=new THREE.Group(); holder.add(o);
    if(cfg.rot) holder.rotation.set(cfg.rot[0],cfg.rot[1],cfg.rot[2]); else holder.rotation.set(0.32,Math.PI*0.2,0);
    _iconScene.add(holder);
    const rad=Math.max(s.x,s.y,s.z)||1, d=rad*1.68;   // 타이트 프레이밍(프레임 꽉 채워 해상도 활용)
    _iconCam.position.set(d*0.62,d*0.58,d); _iconCam.lookAt(0,0,0);
    r.render(_iconScene,_iconCam);
    const url=r.domElement.toDataURL('image/png');
    _iconScene.remove(holder);
    return url;
  })().catch(e=>{ console.warn('[invui] 아이콘 렌더 실패',id,e&&e.message); return null; });
  _iconCache[id]=p;
  p.then(url=>{ _iconCache[id]=url; });
  return p;
}

export function initInvui(ctx){
  const inv = ctx.inventory;
  if(!inv){ console.warn('[invui] ctx.inventory 없음'); return; }
  let open=false, topTab='inv', subTab='mat', tab='mat', selId=null;   // topTab=1뎁스, subTab=인벤토리 서브, tab=유효 컨텐츠탭(render에서 파생)
  // ── 슬롯 시스템(생존게임식) — inventory.js(동결) 위에 invui가 칸/순서 레이어 ──
  const SLOT_COUNT=30, STACK=99;            // 고정 칸 수 + 칸당 스택 상한(표시)
  const orders={ mat:[], cargo:[] };        // 탭별 아이템 표시 순서(드래그로 재배치, 세션 유지)
  let dragSrc=null;                          // {tab, slot}
  function reconcileOrder(t, ids){ const o=orders[t];
    for(let i=o.length-1;i>=0;i--) if(!ids.includes(o[i])) o.splice(i,1);   // 없어진 것 제거
    for(const id of ids) if(!o.includes(id)) o.push(id);                    // 새 것 끝에 추가
    return o; }
  function moveSlot(t, from, to){ const o=orders[t]; if(from===to) return;
    const item=o[from]; if(item==null) return;
    o.splice(from,1); let dest = to>from ? to-1 : to; if(dest>o.length) dest=o.length; if(dest<0) dest=0;
    o.splice(dest,0,item); renderGrid(); }
  function attachDrag(cell, t){
    cell.addEventListener('dragstart',e=>{ dragSrc={t,slot:+cell.dataset.slot}; e.dataTransfer.effectAllowed='move'; cell.classList.add('dragging'); });
    cell.addEventListener('dragend',()=>cell.classList.remove('dragging'));
    cell.addEventListener('dragover',e=>{ if(dragSrc&&dragSrc.t===t){ e.preventDefault(); e.dataTransfer.dropEffect='move'; cell.classList.add('dragOver'); } });
    cell.addEventListener('dragleave',()=>cell.classList.remove('dragOver'));
    cell.addEventListener('drop',e=>{ e.preventDefault(); cell.classList.remove('dragOver');
      if(dragSrc&&dragSrc.t===t) moveSlot(t, dragSrc.slot, +cell.dataset.slot); dragSrc=null; });
  }

  // ── 2단 탭(팰월드식): 상단 1뎁스 [인벤토리][제작][보유배] + 인벤토리 서브 [재료][화물] ──
  const TOP_TABS=[
    { key:'inv',   label:'인벤토리', img:'/tomob-deploy/ui/cat_mat.png',   icon:'🎒' },
    { key:'craft', label:'제작',     img:'/tomob-deploy/ui/cat_craft.png', icon:'🔨' },
    { key:'ship',  label:'보유배',   img:'/tomob-deploy/ui/icons/icon_sail.png', icon:'⚓' },
  ];
  // ★화물은 배에 실리는 것 → '보유배' 화면으로 이동. 인벤토리 = 재료(개인)만.
  const SUB_TABS=[
    { key:'mat', label:'재료' },   // 개인 인벤(재료·광물·먹을거) — 우측 상태창 있음
  ];
  const CAT_DESC={
    mat:'채집·채광으로 모은 제작 재료와 먹을거 (개인 소지 · 무게제)',
    cargo:'배에 싣고 항구에서 사고파는 교역품 (배 화물칸)',
    craft:'재료로 도구·구조물·합금을 제작 (핸드크래프트 · 스테이션)',
    ship:'보유한 배 — 종류·내구도 확인',
  };
  // 클래스 표시명(스킬바 CLASS_SKILLS 기준) — 우측 스탯 패널 캐릭터 이름용
  const CLS_NAME={ knight:'기사', barbarian:'전사', mage:'마법사', ranger:'레인저', rogue:'로그', rogue_hooded:'로그', default:'모험가' };
  const TINT={ iron:'#6b7686',copper:'#c16a38',tin:'#9ba2aa',cobalt:'#2f55d4',gold:'#e6b73a',silver:'#d6dade',gem:'#d83a5e',coal:'#202227',stone:'#9a9286',timber:'#8a6240',leaf:'#5a9a3e',steel:'#8893a0',bronze:'#b87333' };
  const ICON={ timber:'🪵',leaf:'🍃',stone:'🪨',rope:'🪢',iron:'⛏️',copper:'🟫',tin:'⬜',cobalt:'🟦',gold:'🟡',silver:'⬜',gem:'💎',coal:'⬛',steel:'⚙️',bronze:'🟧',rum:'🍺',silk:'🧵',spice:'🌶️',ration:'🍖',potion:'🧪',revivestone:'💠',
    dfloor:'🟫',dfloor2:'🟫',dwall:'🧱',dcol:'🟤',
    dtable:'🪑',dchair:'🪑',dbox:'📦',dpot:'🏺',djug:'🏺',dbook:'📖',dbottle:'🍾',dcandle:'🕯️',dlight:'🔦',drock:'🪨',dmud:'🟫',
    dbench:'🪑',dbarrel:'🛢️',dchest:'🧰',dcrate:'📦',ddoor:'🚪',dgate:'🚪',dfence:'🪵',dflag:'🚩',dpennant:'🚩',dpflag:'🏴',dballista:'🏹',dsignpost:'🪧',dtent:'⛺' };
  // ★아이콘 이미지 스왑(GPT 생성 → ui/icons/). 매핑 있는 id는 <img>, 없으면 이모지 폴백.
  //   컨테이너별 CSS(.cell .pv img / .dPic img / .cRow .ci img / .scIcon img)가 크기 처리.
  const ICON_IMG={ potion:'potion', revivestone:'revive', rum:'rum', silk:'silk', spice:'spice', gem:'gem', timber:'timber', stone:'stone',
    iron:'iron', copper:'copper', tin:'tin', cobalt:'cobalt', gold:'gold', silver:'silver', coal:'coal', leaf:'leaf', rope:'rope', steel:'steel', bronze:'bronze', ration:'ration', plank:'plank', brick:'brick' };
  const pv=(id)=>{ const n=ICON_IMG[id]; return n?`<img src="/tomob-deploy/ui/icons/icon_${n}.png" alt="">`:(ICON[id]||'📦'); };
  // 제작 아이템 아이콘: ICON_IMG 매핑 있으면 png(강철·청동·밧줄·판재·벽돌 등), 없으면 CRAFTABLES 고유 이모지(토대🧱·대포💣 등) 유지.
  const pvc=(rc)=>{ const n=ICON_IMG[rc.id]; return n?`<img src="/tomob-deploy/ui/icons/icon_${n}.png" alt="">`:rc.icon; };
  const DESC={ iron:'대포 강화·철물의 핵심 금속',copper:'주석과 합쳐 청동',tin:'청동 합금 재료',cobalt:'고급 합금',gold:'화폐·고가 교역',silver:'화폐·교역',gem:'최희귀 교역품',coal:'제련 연료',timber:'건축·제작 기본 통나무',leaf:'벌목 부산물 — 밧줄 재료',stone:'건축 석재',rope:'나뭇잎으로 꼬아 만든 밧줄 — 깃발·텐트·돛',steel:'철광석 제련 — 강화',bronze:'구리+주석 합금',rum:'교역품',silk:'교역품',spice:'교역품',ration:'비상식량' };

  const CRAFTABLES=[
    // ── 🚩 거점 깃발(outpost.js) — 꽂은 자리가 내 거점 중심. 섬당 1개. 반경 안에서만 거점 건물 건설. ──
    // ★재료 사슬 정합(2026-08-07): 구 레시피는 밧줄2를 요구했는데 온보딩 채집 단계엔 밧줄이 없어(2026-07-05 폐지)
    //   튜토대로 모아도 깃발을 못 만드는 소프트락이었다. 사령관 "기본재료로 하는 게 무난" → 목재·돌만으로 단순화.
    //   수량은 questline GOAL(목재8·돌4)과 정확히 일치시킨다 — 채집 완료 = 곧바로 깃발 제작 가능.
    { id:'banner', name:'거점 깃발', icon:'🚩', cat:'거점', cost:{ timber:8, stone:4 }, build:'banner',
      desc:'내 거점을 선포하는 깃발. 섬 아무 곳에나 꽂으면 그 자리를 중심으로 원형 경계가 생기고, 그 안에서 거점 건물을 지을 수 있다. 섬당 1개만 세울 수 있다.' },
    { id:'foundation', name:'토대(포좌)', icon:'🧱', cat:'방어', station:'거점 설치', cost:{ stone:6 },
      desc:'돌 받침대. 위에 대포/석궁을 얹는다. 토대 위에 토대를 쌓아 높일 수 있다(사거리·시야↑).', place:'foundation' },
    { id:'cannon', name:'대포', icon:'💣', cat:'방어', station:'거점 설치', cost:{ iron:2, timber:4 },
      desc:'방어용 자동 함포. 토대 위/지면에 설치 — 사거리 내 몬스터를 자동 조준·포격(강함·느림=대함).', place:'cannon' },
    { id:'crossbow', name:'석궁 포좌', icon:'🏹', cat:'방어', station:'거점 설치', cost:{ timber:6, stone:2 },
      desc:'대인 방어 발리스타. 토대 위/지면에 설치 — 빠른 연사로 상륙병을 저지(약함·빠름=대인).', place:'crossbow' },
    { id:'steel',  name:'강철', icon:'⚙️', station:'제련소', cost:{ iron:2, coal:1 },
      desc:'쇠를 석탄으로 제련해 얻는 강철. 대포·도구 강화에 쓰인다.', out:['steel',1] },
    { id:'bronze', name:'청동', icon:'🟧', station:'제련소', cost:{ copper:2, tin:1, coal:1 },
      desc:'구리와 주석을 녹여 만든 합금. 함포 주조에 쓰인다.', out:['bronze',1] },
    { id:'rope',   name:'밧줄', icon:'🪢', station:'핸드크래프트', cost:{ leaf:3 },
      desc:'나뭇잎을 꼬아 만든 밧줄. 깃발·텐트 등 천 구조물에 쓰인다.', out:['rope',1] },
    // ── 🏭 가공 교역품(P6): 원자재→고부가 교역품. 화물칸으로 직행 제작(toCargo) → 항구서 판매. "캐서 가공해 팔면 이득". ──
    { id:'plank',  name:'판재', icon:'🪚', station:'핸드크래프트', cost:{ timber:2 }, out:['plank',1], toCargo:true,
      desc:'통나무를 켜서 만든 판재. 원목(2)보다 비싼 교역품(30). 화물칸으로 제작 → 시장 있는 섬서 팔면 마진.' },
    { id:'brick',  name:'벽돌', icon:'🧱', station:'핸드크래프트', cost:{ stone:3 }, out:['brick',1], toCargo:true,
      desc:'돌을 다듬은 벽돌. 밀도 높은 교역품(26). 화물칸으로 제작 → 교역.' },
    // ── 🔨 도구(제작=퀵슬롯 장착. out/build 아닌 tool: 출력) ──
    { id:'axe',    name:'도끼',   icon:'🪓', station:'핸드크래프트', cost:{}, tool:'axe',   // ★생존도구 무료(사령관 2026-07-05 — 튜토 진입장벽 제거)
      desc:'나무를 베는 도끼. 만들면 퀵슬롯에 장착된다(벌목 도구). 재료 불필요.' },
    { id:'pickaxe',name:'곡괭이', icon:'⛏', station:'핸드크래프트', cost:{}, tool:'pickaxe',   // ★생존도구 무료(동일)
      desc:'돌·광물을 캐는 곡괭이. 만들면 퀵슬롯에 장착된다(채광 도구). 재료 불필요.' },
    { id:'torch',  name:'횃불',   icon:'🔥', station:'핸드크래프트', cost:{ timber:1, leaf:2 }, tool:'torch',
      desc:'밤을 밝히고 몸을 녹이는 횃불. 만들면 퀵슬롯에 장착된다(밤 조명·온기).' },   // ★횃불도 제작(사령관) — 시작템 아님
    { id:'hammer', name:'망치',   icon:'🔨', station:'핸드크래프트', cost:{ timber:2, iron:1 }, tool:'hammer',
      desc:'내가 지은 축성 블록·던전 건축물을 부수는 철거 도구. 만들면 퀵슬롯에 장착된다. 든 채로 건설물을 조준하고 좌클릭하면 철거 + 재료 1개 환급.' },
    // ── 던전/빌드 제작템 (cat=카테고리 · 재료=자원분포 밸런스: 목재·돌 풍부 / 철=금속 / 강철=방어. 은·금·보석 제외) ──
    // 🔥 야영 — 자유설치(campfire.js), 밤 추위 방지
    { id:'campfire', name:'모닥불', icon:'🔥', cat:'방어', cost:{timber:3,stone:2}, build:'campfire', desc:'장작에 불을 피워 밤 추위를 막는다. 설치하면 불이 타오르고 주변이 따뜻해진다(집·모닥불 근처만 밤에 따뜻).' },
    { id:'woodblock', name:'나무방책', icon:'🪵', cat:'방어', cost:{timber:1}, out:['woodblock',3], desc:'급조 방어 블록(티어1). 싸지만 약하다(HP15). 초반 급습 저지용. 목재 1 → 3개.' },
    { id:'wallblock', name:'돌벽',   icon:'🧱', cat:'방어', cost:{stone:1}, out:['wallblock',3], desc:'표준 방어 블록(티어2). 쌓아 성벽·타워(HP30). 퀵슬롯 장착 후 조준·클릭. 돌 1 → 3개.' },
    { id:'ironblock', name:'철벽',   icon:'⬛', cat:'방어', cost:{stone:1,iron:1}, out:['ironblock',2], desc:'철 보강 방어 블록(티어3). 비싸지만 대포 포화에 오래 버틴다(HP65). 돌1+철1 → 2개.' },
    { id:'cannonblock', name:'포대', icon:'🔫', cat:'방어', cost:{stone:2,iron:2,bronze:1}, out:['cannonblock',1], desc:'타워 위에 얹는 자동 대포. 사거리 내 습격병을 자동 조준·포격(높이 올릴수록 멀리 닿음). 돌2+철2+청동1.' },
    // 🧱 구조
    { id:'dfloor',  name:'던전바닥',  icon:'🟫', cat:'구조', cost:{stone:2}, build:'dfloor',  desc:'석조 던전 바닥. 그리드 토대.' },
    { id:'dfloor2', name:'던전바닥B', icon:'🟫', cat:'구조', cost:{stone:2}, build:'dfloor2', desc:'다른 무늬 석조 바닥.' },
    { id:'dwall',   name:'던전벽',    icon:'🧱', cat:'구조', cost:{stone:3}, build:'dwall',   desc:'석조 벽. 셀 변에 세워짐.' },
    { id:'dcol',    name:'던전기둥',  icon:'🟤', cat:'구조', cost:{stone:2}, build:'dcol',    desc:'석조 기둥.' },
    // 🪑 가구
    { id:'dtable',  name:'던전테이블', icon:'🪑', cat:'가구', cost:{timber:4}, build:'dtable', desc:'나무 테이블.' },
    { id:'dchair',  name:'던전의자',   icon:'🪑', cat:'가구', cost:{timber:2}, build:'dchair', desc:'나무 의자.' },
    { id:'dbench',  name:'벤치',       icon:'🪑', cat:'가구', cost:{timber:3}, build:'dbench', desc:'나무 벤치.' },
    // 📦 수납
    { id:'dbox',    name:'던전상자',   icon:'📦', cat:'수납', cost:{timber:2}, build:'dbox',   desc:'나무 상자.' },
    { id:'dbarrel', name:'술통',       icon:'🛢️', cat:'수납', cost:{timber:2}, build:'dbarrel',desc:'나무 술통.' },
    { id:'dchest',  name:'궤짝',       icon:'🧰', cat:'수납', cost:{timber:3,iron:1}, build:'dchest', desc:'쇠 장식 궤짝.' },
    { id:'dcrate',  name:'나무상자',   icon:'📦', cat:'수납', cost:{timber:2}, build:'dcrate', desc:'화물 나무상자.' },
    // 🏺 소품
    { id:'dpot',    name:'던전항아리', icon:'🏺', cat:'소품', cost:{stone:1}, build:'dpot',   desc:'도기 항아리.' },
    { id:'djug',    name:'던전주전자', icon:'🏺', cat:'소품', cost:{timber:1}, build:'djug',  desc:'주전자.' },
    { id:'dbook',   name:'던전책',     icon:'📖', cat:'소품', cost:{timber:1}, build:'dbook', desc:'고서.' },
    { id:'dbottle', name:'던전병',     icon:'🍾', cat:'소품', cost:{timber:1}, build:'dbottle',desc:'유리병.' },
    { id:'dcandle', name:'던전촛불',   icon:'🕯️', cat:'소품', cost:{timber:1}, build:'dcandle',desc:'촛불.' },
    { id:'dlight',  name:'던전조명',   icon:'🔦', cat:'소품', cost:{timber:1,coal:1}, build:'dlight', desc:'조명/횃불대.' },
    { id:'drock',   name:'던전바위',   icon:'🪨', cat:'소품', cost:{stone:2}, build:'drock',  desc:'바위.' },
    { id:'dmud',    name:'던전진흙',   icon:'🟫', cat:'소품', cost:{stone:1}, build:'dmud',   desc:'진흙더미.' },
    // 🚪 개구부
    { id:'ddoor',   name:'문',         icon:'🚪', cat:'개구부', cost:{timber:3,iron:1}, build:'ddoor', desc:'성 나무문.' },
    { id:'dgate',   name:'성문',       icon:'🚪', cat:'개구부', cost:{timber:4,iron:2}, build:'dgate', desc:'대형 성문.' },
    { id:'dfence',  name:'울타리',     icon:'🪵', cat:'개구부', cost:{timber:2}, build:'dfence', desc:'나무 울타리.' },
    // 🚩 깃발
    { id:'dflag',   name:'깃발',       icon:'🚩', cat:'깃발', cost:{timber:1,rope:1}, build:'dflag',  desc:'장대에 천을 단 성 깃발.' },
    { id:'dpennant',name:'페넌트',     icon:'🚩', cat:'깃발', cost:{timber:1,rope:1}, build:'dpennant',desc:'삼각 천 페넌트.' },
    { id:'dpflag',  name:'해적기',     icon:'🏴', cat:'깃발', cost:{timber:1,rope:1}, build:'dpflag', desc:'천 해적 깃발.' },
    // 🛡️ 방어
    { id:'dballista',name:'발리스타',  icon:'🏹', cat:'방어', cost:{timber:4,steel:2}, build:'dballista', desc:'대형 석궁 방어물. 교역소 강철로 보강.' },
    { id:'dsignpost',name:'표지판',    icon:'🪧', cat:'방어', cost:{timber:2}, build:'dsignpost', desc:'나무 표지판.' },
    { id:'dtent',   name:'텐트',       icon:'⛺', cat:'방어', cost:{timber:2,rope:2}, build:'dtent',  desc:'장대와 천으로 세운 천막 텐트.' },
  ];
  // ── 🏛️ 거점 건물을 제작 탭 [거점] 카테고리에 편입(2026-08-07) ──
  //   구 N키 내 섬 관리 메뉴 대신 제작 탭에서 바로 짓는다(사령관 확정). 카탈로그·비용·효과는 settlement.js/BAL이 SSOT —
  //   여기선 그 정의를 읽어 제작 항목으로 비추기만 한다(수치 중복 정의 금지). settle 필드 = settlement.ghostShow 라우팅 키.
  //   ★재료가 아니라 골드로 짓는다 → cost는 비우고 gold 필드로 따로 표기(canAfford가 재료 0개면 항상 true라 gold는 craft()에서 검사).
  for(const [id, b] of Object.entries(SETTLE_BUILDINGS)){
    if(b.hidden) continue;   // harbor = G키 해안 전용(항구는 거점 건물 목록에 안 띄움)
    const cfg = (BAL.buildings || {})[id] || {};
    CRAFTABLES.push({ id:'settle_'+id, name:b.name, icon:'🏛️', cat:'거점', cost:{}, settle:id, gold:cfg.cost|0,
      desc:`${b.desc} — 거점 반경 안에만 지을 수 있습니다. 건설비 ${cfg.cost|0} 금화.` });
  }
  // 🗡️ 몬스터 용병 배치 — 던전 정복으로 영입한 용병을 지금 서 있는 거점의 수비병으로 세운다(골드 무료, 명부 소모).
  CRAFTABLES.push({ id:'merc_deploy', name:'용병 배치', icon:'🗡️', cat:'거점', cost:{}, merc:true,
    desc:'던전을 정복해 굴복시킨 몬스터 용병을 이 거점의 수비병으로 세웁니다. 배치된 용병은 거점 주변을 순찰하며 습격을 막습니다. 용병은 던전 클리어로만 얻을 수 있습니다.' });
  // 🌀 차원문 석판 — 같은 등급 조각 4개 → 석판 1개. 석판을 쓰면 밤을 안 기다리고 그 등급 차원문을 직접 연다.
  //   조각은 밤 던전 클리어로만 얻는다(dungeonrun.doClear) — 등급 = 조각 등급이 그대로 결정(사령관 확정).
  {
    const GS = BAL.gateSlab || { shardsPerSlab:4 };
    const GRADE = ['하급','중급','상급','심연','심층'];
    for(let t=1; t<=5; t++){
      const cost = {}; cost['shard'+t] = GS.shardsPerSlab|0;
      CRAFTABLES.push({ id:'slab'+t, name:`${GRADE[t-1]} 차원문 석판`, icon:'🌀', cat:'차원문', cost, build:'slab'+t,
        desc:`${GRADE[t-1]} 던전(티어 ${t})으로 통하는 차원문을 직접 엽니다. 퀵슬롯에서 선택하면 서 있는 자리에 차원문이 열립니다. 조각은 같은 등급 밤 던전을 클리어해야 나옵니다.` });
    }
  }
  // 📈 거점 확장(레벨업) — 골드+토모브의 영혼 소모 + 명예 문턱. 성공하면 세울 수 있는 거점 수가 +1.
  //   API는 outpost.js가 이미 갖고 있고(expand/canExpand/expandCost) 여기선 진입점만 연결한다.
  //   N키가 아니라 제작탭에 두는 이유 = 원칙-1(거점 조작 단일 진입점) + 비용 표시 UI 재사용.
  CRAFTABLES.push({ id:'outpost_expand', name:'거점 확장', icon:'📈', cat:'거점', cost:{}, expand:true,
    desc:'세울 수 있는 거점 수를 하나 늘립니다. 금화와 토모브의 영혼을 소모하며, 일정 이상의 명예가 필요합니다. 확장하면 다른 섬에도 깃발을 세울 수 있습니다.' });
  // ⚓ 항구(부두) — BUG-A4. 구 G키 즉시건설을 제작탭으로 흡수(원칙-1: 모든 건물 제작은 제작탭 단일 진입점).
  //   거점(깃발)과 별개 시스템이라 반경 밖 해안에도 지을 수 있다. 해안 판정·고스트·회전은 wharf.js가 그대로 담당.
  CRAFTABLES.push({ id:'wharf_build', name:'항구(부두)', icon:'⚓', cat:'거점', cost:{}, wharf:true,
    desc:'바닷가에 부두를 세워 배를 정박·건조할 수 있게 합니다. 해안에 서서 바다를 보고 지으세요. 항구가 있어야 배를 건조할 수 있습니다.' });
  // 🚢 배 건조 — BUG-A4. 구 K키 드라이독을 제작탭으로 흡수. 항구 건설이 해금 조건(shipyard.enter가 이미 게이트).
  for(const s of SHIPYARD_SHIPS){
    CRAFTABLES.push({ id:'ship_'+s.key, name:s.name, icon:'🚢', cat:'선박', cost:{}, ship:s.key, gold:s.gold|0,
      desc:`부두 근처에 ${s.name}을(를) 건조합니다. 항구(부두)를 먼저 지어야 건조할 수 있습니다. 건조비 ${s.gold|0} 금화.` });
  }
  // 제작 탭 카테고리(단순화). 잡다한 9개 → 6개 그룹. 원본 cat은 아래 CAT_GROUP으로 묶음.
  //   도구 = 정련품·도구(cat 없음: 강철·청동·밧줄·도끼·곡괭이) / 건설 = 구조+개구부(바닥·벽·기둥·문·울타리) / 인테리어 = 가구+수납+소품+깃발 / 방어
  //   ★거점(2026-08-07) = 깃발 + 거점 건물. 구 N키 내 섬 관리를 제작 탭으로 흡수(사령관 확정: "제작 탭이 더 직관적").
  const CRAFT_CATS=['전체','도구','건설','인테리어','방어','거점','선박','차원문'];
  const CAT_GROUP={ 구조:'건설', 개구부:'건설', 가구:'인테리어', 수납:'인테리어', 소품:'인테리어', 깃발:'인테리어', 방어:'방어', 거점:'거점', 선박:'선박', 차원문:'차원문' };
  const groupOf=rc=> rc.cat ? (CAT_GROUP[rc.cat]||rc.cat) : '도구';   // cat 없음 = 도구/정련품
  let craftCat='전체';
  let craftMakeableOnly=false;   // ★제작 가능한 것만 보기 필터

  const QSLOTS=[['1','⛏','곡괭이'],['2','🪓','도끼'],['3','⚔','검+방패'],['4','🗡','양손검'],['5','🪓','양손도끼'],['6','🗡','단검'],['7','🏹','활'],['0','🤚','빈손']];
  const TOOLKEYS=['pickaxe','axe','sword','sword2h','axe2h','dagger','bow','none'];

  // ── CSS — 뒤 게임화면 블러 + 반투명 박스(이미지 배경 없음). 팔레트만 해도 톤(네이비/골드/청록) ──
  const st=document.createElement('style'); st.textContent=`
    #inventory{position:fixed;inset:0;z-index:75;display:none;align-items:center;justify-content:center;
      background:rgba(6,11,18,.42);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
      font-family:'Pretendard',system-ui,sans-serif;color:#e9e2cf}
    #inventory.open{display:flex}
    #inventory .invWrap{position:relative;width:100%;height:100%;
      background:transparent;padding:clamp(22px,4vh,46px) clamp(30px,6vw,110px) clamp(18px,3vh,34px);display:flex;flex-direction:column;gap:16px}
    /* 헤더 */
    #inventory .invHd{display:flex;align-items:center;justify-content:space-between;gap:20px}
    #inventory .invTitle{font-size:25px;font-weight:800;letter-spacing:.22em;color:#f3e8ca;text-shadow:0 2px 8px #000;padding-left:4px;border-left:3px solid #e7c878;line-height:1.1;padding-left:12px}
    #inventory .invHdR{display:flex;align-items:center;gap:18px}
    #inventory .invGold{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:800;color:#f3d978;font-variant-numeric:tabular-nums;text-shadow:0 1px 3px #000;background:rgba(8,14,22,.6);border:1px solid rgba(201,168,90,.4);border-radius:20px;padding:6px 14px 6px 10px}
    #inventory .invGold .gic{width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffe9a3,#caa033 70%,#8a6a1e);box-shadow:0 0 6px rgba(243,217,120,.55)}
    #inventory .invClose{color:#d9c89a;cursor:pointer;font-size:20px;line-height:1;text-shadow:0 1px 3px #000;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(201,168,90,.32);border-radius:8px;background:rgba(8,14,22,.5)}
    #inventory .invClose:hover{color:#ffe28a;border-color:rgba(201,168,90,.6)}
    /* 탭 + 밑줄 라인 */
    #inventory .invTabs{display:flex;justify-content:flex-start;gap:8px;border-bottom:1.5px solid rgba(201,168,90,.5);padding-left:2px}
    #inventory .ivtab{display:flex;align-items:center;gap:9px;padding:9px 20px 12px;cursor:pointer;color:rgba(228,220,196,.5);font-size:16px;font-weight:700;letter-spacing:.05em;border-bottom:3px solid transparent;margin-bottom:-1.5px;transition:.12s;text-shadow:0 1px 3px #000}
    #inventory .ivtab:hover{color:#ded2ad;background:rgba(255,255,255,.03)}
    #inventory .ivtab.on{color:#ffeab2;border-bottom-color:#f0cf80;text-shadow:0 0 10px rgba(240,207,128,.55)}
    #inventory .ivtab .tc{font-size:21px;filter:saturate(.9) drop-shadow(0 1px 2px #000)}
    #inventory .ivtab .ticon{width:26px;height:26px;object-fit:contain;opacity:.5;transition:.12s;filter:drop-shadow(0 1px 2px #000)}
    #inventory .ivtab:hover .ticon{opacity:.8}
    #inventory .ivtab.on .ticon{opacity:1;filter:drop-shadow(0 0 6px rgba(240,207,128,.75))}
    #inventory .catDesc{font-size:13px;color:#9fbac4;letter-spacing:.03em;min-height:18px;padding-left:4px;text-shadow:0 1px 2px #000}
    /* 본문: 좌 그리드박스 / 우 상세박스 (둘 다 반투명) */
    #inventory .invBody{flex:1;display:flex;gap:18px;min-height:0}
    #inventory .invGrid{flex:0.92;display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:max-content;gap:9px;overflow-y:auto;align-content:start;
      padding:15px;background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;box-shadow:inset 0 0 40px rgba(0,0,0,.35)}
    #inventory .cell{position:relative;aspect-ratio:1/1;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.1s}
    #inventory .cell:hover{background:rgba(130,195,220,.14);border-color:rgba(150,210,230,.45)}
    #inventory .cell.sel{border-color:#8fe0f0;box-shadow:0 0 0 1px #8fe0f0,0 0 13px rgba(120,210,235,.55);background:rgba(70,140,165,.32)}
    #inventory .cell .pv{font-size:clamp(18px,2.4vw,30px);filter:drop-shadow(0 2px 3px #000);display:flex;align-items:center;justify-content:center;width:100%;height:100%}
    #inventory .cell .pv img{width:84%;height:84%;object-fit:contain;filter:drop-shadow(0 3px 4px rgba(0,0,0,.7))}
    #inventory .dPic img{width:92%;height:92%;object-fit:contain;filter:drop-shadow(0 4px 8px rgba(0,0,0,.7))}
    #inventory .cRow .ci img{width:22px;height:22px;object-fit:contain;vertical-align:middle;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    #inventory .scIcon img{width:24px;height:24px;object-fit:contain;vertical-align:middle;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    #inventory .cell .cnt{position:absolute;right:5px;bottom:3px;font-size:12px;font-weight:800;color:#ffe7a0;text-shadow:0 1px 2px #000,0 0 3px #000;font-variant-numeric:tabular-nums}
    #inventory .cell .dot{position:absolute;left:5px;top:5px;width:8px;height:8px;border-radius:50%;border:1px solid rgba(0,0,0,.55)}
    #inventory .cell .mk{position:absolute;left:4px;top:2px;font-size:12px;text-shadow:0 1px 2px #000}
    #inventory .cell.no{opacity:.5;filter:grayscale(.4)}
    #inventory .cell.slotEmpty{background:rgba(255,255,255,.022);border-style:dashed;border-color:rgba(255,255,255,.07);cursor:default}
    #inventory .cell.slotEmpty:hover{background:rgba(255,255,255,.035)}
    #inventory .cell[draggable=true]{cursor:grab}
    #inventory .cell.dragging{opacity:.35}
    #inventory .cell.dragOver{border-color:#8fe0f0;box-shadow:0 0 0 1px #8fe0f0;background:rgba(70,140,165,.25)}
    #inventory .empty{grid-column:1/-1;font-size:13px;color:rgba(232,222,188,.5);padding:42px 4px;text-align:center}
    #inventory .invDetail{flex:1.28;min-width:280px;background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;padding:18px 22px 16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:inset 0 0 40px rgba(0,0,0,.35)}
    #inventory .dPic{width:clamp(150px,21vh,225px);height:clamp(150px,21vh,225px);margin:4px auto 12px;display:flex;align-items:center;justify-content:center;font-size:clamp(74px,10.5vh,108px);text-shadow:0 3px 8px #000;background:radial-gradient(circle,rgba(50,95,115,.42),transparent 68%);border-radius:50%}
    #inventory .dTitle{font-size:30px;font-weight:800;color:#f0e0b0;letter-spacing:.02em;text-shadow:0 2px 4px #000}
    #inventory .dRare{font-size:15px;color:#7fc0d0;margin:5px 0 18px;letter-spacing:.06em}
    #inventory .dDesc{font-size:14.5px;line-height:1.7;color:#d2c8aa;margin-bottom:14px;border-top:1px solid rgba(201,168,90,.18);padding-top:13px}
    #inventory .dStat{display:flex;justify-content:space-between;font-size:15px;color:#cdc29e;border-bottom:1px solid rgba(201,168,90,.15);padding:8px 0}
    #inventory .dStat b{color:#f2e6c2;font-weight:700;font-variant-numeric:tabular-nums}
    /* ── 아이템 호버 툴팁(재료 탭 — 커서 근처에 떠오름, BotW식) ── */
    #inventory .invPopup{position:absolute;left:0;top:0;transform:scale(.97);transform-origin:top left;
      width:288px;max-height:calc(100% - 32px);z-index:12;pointer-events:none;opacity:0;
      display:flex;flex-direction:column;overflow:hidden;
      background:linear-gradient(180deg,rgba(14,22,34,.94),rgba(9,15,24,.95));backdrop-filter:blur(10px);
      border:1px solid rgba(201,168,90,.44);border-radius:12px;padding:16px 18px 14px;
      box-shadow:0 16px 40px rgba(0,0,0,.6),inset 0 0 34px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,231,160,.14);
      transition:opacity .1s ease,transform .12s cubic-bezier(.2,.85,.3,1)}
    #inventory .invPopup.show{opacity:1;transform:scale(1)}
    #inventory .invPopup::before{content:"";position:absolute;left:14px;right:14px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,231,160,.5),transparent)}
    #inventory .invPopup .dPic{width:clamp(110px,15vh,150px);height:clamp(110px,15vh,150px);font-size:clamp(56px,8vh,76px)}
    #inventory .invPopup .dTitle{font-size:23px}
    #inventory .invPopup .dRare{margin:4px 0 12px}
    #inventory .cReq{font-size:12px;color:#8ab0bb;letter-spacing:.08em;margin:2px 0 8px}
    #inventory .cRow{display:flex;align-items:center;gap:9px;font-size:14px;padding:7px 0;border-bottom:1px solid rgba(201,168,90,.13)}
    #inventory .cRow .ci{font-size:17px}
    #inventory .cRow .cn{flex:1}
    #inventory .cRow .cq{font-weight:800;font-variant-numeric:tabular-nums}
    #inventory .craftBtn{margin-top:15px;padding:13px;background:linear-gradient(180deg,#ecc962,#a9842f);color:#241a06;border:1px solid #ffe9a3;border-radius:9px;cursor:pointer;font-family:inherit;font-weight:800;font-size:15px;letter-spacing:.04em;transition:filter .12s}
    #inventory .craftBtn:hover{filter:brightness(1.12)}
    #inventory .craftBtn:disabled{background:rgba(70,76,84,.5);border-color:rgba(150,150,150,.25);color:#8b8b8b;cursor:not-allowed}
    #inventory .craftCatBar{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px;padding-bottom:8px;border-bottom:1px solid rgba(201,168,90,.18)}
    #inventory .ccBtn{padding:5px 11px;font-size:12px;font-weight:700;color:#bcd2dc;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;cursor:pointer;font-family:inherit;transition:.1s}
    #inventory .ccBtn:hover{background:rgba(255,255,255,.1);color:#e9e2cf}
    #inventory .ccBtn.on{background:rgba(236,201,98,.92);border-color:#ffe9a3;color:#241a06}
    #inventory .ccFilter{margin-left:auto;border-color:rgba(120,210,235,.4);color:#9fdcec}
    #inventory .ccFilter.on{background:rgba(95,200,235,.9);border-color:#bfeeff;color:#08222b}
    #inventory .craftProg{margin-top:12px}
    #inventory .craftProg .cpTop{display:flex;justify-content:space-between;font-size:12px;color:#bcd2dc;margin-bottom:5px;text-shadow:0 1px 2px #000}
    #inventory .craftProg .cpTop b{color:#ffe28a}
    #inventory .craftProg .cpBar{height:9px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);border-radius:6px;overflow:hidden}
    #inventory .craftProg #iv_progfill{height:100%;width:0;background:linear-gradient(90deg,#ecc962,#7af0a0);transition:width .06s linear}
    #inventory .dEmpty{margin:auto;color:rgba(232,222,188,.45);font-size:13px;text-align:center;line-height:1.7}
    /* 푸터 + 핫바 */
    #inventory .invFt{display:flex;align-items:center;gap:10px;padding:0 2px}
    #inventory .invFt .wic{font-size:15px;flex:none;opacity:.85;filter:drop-shadow(0 1px 2px #000)}
    #inventory .invFt .wTxt{font-size:12px;color:#e0d3ac;white-space:nowrap;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000}
    #inventory .invFt .wBar{position:relative;flex:1;max-width:320px;height:11px;border-radius:6px;overflow:hidden;background:rgba(6,12,18,.75);border:1px solid rgba(201,168,90,.4)}
    #inventory .invFt .wFill{position:absolute;left:0;top:0;height:100%;width:0;background:linear-gradient(180deg,#3a8a9a,#1e5663)}
    #inventory .invFt .hint{margin-left:auto;font-size:11px;color:rgba(228,218,188,.5);letter-spacing:.04em;text-shadow:0 1px 2px #000}
    #inventory .invHot{display:flex;gap:6px;justify-content:center}
    #inventory .mslot{position:relative;width:52px;height:54px;border-radius:8px;background:rgba(9,16,26,.6);border:1px solid rgba(201,168,90,.22);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
    #inventory .mslot.on{border-color:#8fe0f0;box-shadow:0 0 8px rgba(120,210,235,.45)}
    #inventory .mslot.mEmpty{background:rgba(9,16,26,.32);border-style:dashed;border-color:rgba(255,255,255,.1)}
    #inventory .mslot.dragOver{border-color:#8fe0f0;box-shadow:0 0 8px rgba(120,210,235,.5)}
    #inventory .mslot .num{position:absolute;top:2px;left:5px;font-size:9px;color:rgba(228,218,188,.5)}
    #inventory .mslot .pic{font-size:17px}
    #inventory .mslot .pic img{width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    #inventory .mslot .nm{font-size:8px;letter-spacing:.03em;color:#bfe0ec;max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #inventory .mslot .qcnt{position:absolute;right:4px;bottom:2px;font-size:10px;font-weight:800;color:#ffe7a0;text-shadow:0 1px 2px #000;font-variant-numeric:tabular-nums}
    #inventory .cell.buildItem{outline:1px solid rgba(143,224,240,.25)}
    #inventory .ivToast{position:absolute;left:50%;top:14%;transform:translateX(-50%);background:rgba(8,16,24,.94);color:#ffe7a0;padding:9px 20px;border:1px solid rgba(201,168,90,.5);border-radius:9px;font-size:14px;font-weight:700;opacity:0;transition:opacity .2s;pointer-events:none;text-shadow:0 1px 2px #000}
    #inventory .ivToast.show{opacity:1}`;
  document.head.appendChild(st);

  const panel=document.createElement('div'); panel.id='inventory';
  panel.innerHTML=`<div class="invWrap">
    <div class="invHd">
      <div class="invTitle">인벤토리</div>
      <div class="invHdR">
        <div class="invGold"><span class="gic"></span><span id="iv_gold">0</span></div>
        <div class="invClose" id="iv_close">✕</div>
      </div>
    </div>
    <div class="invTabs" id="iv_tabs"></div>
    <div class="invSubTabs" id="iv_subtabs"></div>
    <div class="catDesc" id="iv_catdesc"></div>
    <div class="invBody">
      <div class="invGrid" id="iv_grid"></div>
      <div class="invChar" id="iv_char"></div>
      <div class="invStats" id="iv_stats"></div>
      <div class="invDetail" id="iv_detail"></div>
      <div class="invShip" id="iv_ship"></div>
      <div class="invPopup" id="iv_popup"></div>
    </div>
    <div class="invFt">
      <span class="wic">⚖</span><span class="wTxt" id="iv_wtxt"></span>
      <div class="wBar"><div class="wFill" id="iv_wfill"></div></div>
      <span class="hint">I·Esc 닫기</span>
    </div>
    <div class="invHot" id="iv_hot"></div>
    <div class="ivToast" id="iv_toast"></div>
  </div>`;
  document.body.appendChild(panel);
  // ── 상태 탭(캐릭터시트) 전용 CSS (기존 거대 템플릿 분리) ──
  const stStatus=document.createElement('style'); stStatus.textContent=`
    /* ── 팰월드식 3구역: [좌 그리드][중앙 3D캐릭터][우 스탯패널] ── */
    #inventory .invChar{flex:1.1;display:none;position:relative;min-width:0;border-radius:12px;overflow:hidden;
      background:linear-gradient(180deg,rgba(30,42,60,.42),rgba(9,14,22,.30));border:1px solid rgba(201,168,90,.14)}
    #inventory .charCanvas{width:100%;height:100%;display:block}
    #inventory .invStats{flex:0 0 372px;display:none;flex-direction:column;gap:14px;min-height:0;overflow-y:auto}
    /* 레벨 박스 */
    #inventory .psLvlBox{display:flex;align-items:stretch;gap:12px;background:rgba(9,16,26,.6);border:1px solid rgba(201,168,90,.24);border-radius:10px;padding:12px 15px}
    #inventory .psLvlNum{font-size:40px;font-weight:900;line-height:1;color:#eaf6ff;display:flex;align-items:center;padding-right:12px;border-right:2px solid rgba(90,170,220,.45);text-shadow:0 2px 6px #000}
    #inventory .psLvlR{flex:1;display:flex;flex-direction:column;justify-content:center;gap:5px;min-width:0}
    #inventory .psLvlLbl{font-size:12px;font-weight:800;letter-spacing:.12em;color:#7fd0ea}
    #inventory .psXpRow{display:flex;justify-content:space-between;font-size:11px;color:#9fb2c0;font-variant-numeric:tabular-nums}
    #inventory .psXpBar{height:6px;border-radius:3px;overflow:hidden;background:rgba(6,12,18,.8)}
    #inventory .psXpFill{height:100%;background:linear-gradient(90deg,#3aa8c8,#63d3ec);border-radius:3px;transition:width .2s}
    /* HP/기력 게이지 */
    #inventory .psGauges{display:flex;flex-direction:column;gap:9px}
    #inventory .psGRow{display:flex;align-items:center;gap:10px}
    #inventory .psGLbl{flex:0 0 34px;font-size:12px;font-weight:800;text-shadow:0 1px 2px #000}
    #inventory .psBar{flex:1;height:16px;border-radius:5px;overflow:hidden;background:rgba(6,12,18,.8);border:1px solid rgba(255,255,255,.08)}
    #inventory .psFill{height:100%;border-radius:5px;transition:width .2s}
    #inventory .psGVal{flex:0 0 auto;min-width:78px;text-align:right;font-size:12px;font-weight:800;color:#eae0c6;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000}
    /* 스탯 카드 */
    #inventory .psCard{background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;padding:14px 16px;box-shadow:inset 0 0 30px rgba(0,0,0,.3)}
    #inventory .psName{font-size:19px;font-weight:800;color:#f3e8ca;letter-spacing:.06em;text-shadow:0 2px 6px #000;margin-bottom:4px}
    #inventory .psTitle{font-size:11px;font-weight:800;letter-spacing:.16em;color:#8aa;border-bottom:1px solid rgba(201,168,90,.25);padding-bottom:8px;margin-bottom:10px}
    #inventory .psStat{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0}
    #inventory .psSLbl{display:flex;align-items:center;gap:7px;font-size:13.5px;color:#d8cca8}
    #inventory .psSLbl img{height:17px;width:auto;filter:drop-shadow(0 0 4px rgba(140,120,255,.7))}
    #inventory .psSVal{font-size:14px;font-weight:800;color:#f2e6c2;font-variant-numeric:tabular-nums}
    /* ── 서브탭 (인벤토리 > 재료/화물) ── */
    #inventory .invSubTabs{display:flex;gap:6px;padding-left:2px}
    #inventory .ivsub{padding:6px 16px;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:.04em;color:rgba(228,220,196,.55);border-radius:7px;background:rgba(255,255,255,.04);border:1px solid rgba(201,168,90,.18);transition:.12s}
    #inventory .ivsub:hover{color:#ded2ad;background:rgba(255,255,255,.08)}
    #inventory .ivsub.on{color:#0f1620;background:linear-gradient(180deg,#f0cf80,#d8b45a);border-color:#f0cf80;font-weight:800}
    /* ── 보유배 화면 ── */
    #inventory .invShip{flex:1;display:none;gap:18px;min-height:0}
    #inventory .shipEmpty{margin:auto;color:rgba(228,218,188,.5);font-size:14px}
    #inventory .shipListCol{flex:0 0 372px;display:flex;flex-direction:column;gap:9px;overflow-y:auto;background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;padding:14px;box-shadow:inset 0 0 30px rgba(0,0,0,.3)}
    #inventory .shipListTitle{font-size:12px;font-weight:800;letter-spacing:.14em;color:#e7c878;margin-bottom:4px}
    #inventory .shipRow{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:9px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);transition:.12s}
    #inventory .shipRow:hover{background:rgba(255,255,255,.08)}
    #inventory .shipRow.on{background:rgba(90,170,220,.16);border-color:rgba(120,200,240,.7);box-shadow:0 0 0 1px rgba(120,200,240,.4)}
    #inventory .shipRowInfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
    #inventory .shipRowName{font-size:15px;font-weight:800;color:#f2e6c2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #inventory .shipDur{height:8px;border-radius:4px;overflow:hidden;background:rgba(6,12,18,.8)}
    #inventory .shipDurFill{height:100%;border-radius:4px;transition:width .2s}
    #inventory .shipRowType{font-size:11px;color:#9fbac4}
    #inventory .shipRowThumb{flex:0 0 46px;height:46px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;background:linear-gradient(160deg,rgba(46,64,90,.5),rgba(10,16,26,.85));border:1px solid rgba(201,168,90,.25)}
    #inventory .shipRowThumb img{width:34px;height:34px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    #inventory .shipViewCol{flex:1;display:flex;flex-direction:column;gap:14px;min-width:0}
    #inventory .shipStage{flex:0 0 40%;position:relative;border-radius:12px;overflow:hidden;background:linear-gradient(180deg,rgba(30,42,60,.42),rgba(9,14,22,.30));border:1px solid rgba(201,168,90,.14)}
    #inventory .shipStats{flex:0 0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(201,168,90,.14);border:1px solid rgba(201,168,90,.22);border-radius:10px;overflow:hidden}
    #inventory .shipStat{display:flex;flex-direction:column;gap:3px;padding:10px 15px;background:rgba(9,16,26,.72)}
    #inventory .ssLbl{font-size:11px;color:#9fbac4;letter-spacing:.03em}
    #inventory .ssVal{font-size:17px;font-weight:800;color:#f2e6c2;font-variant-numeric:tabular-nums}
    #inventory .shipStageHd{position:absolute;top:0;left:0;right:0;z-index:2;display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:11px 16px;background:linear-gradient(180deg,rgba(6,11,18,.55),transparent);pointer-events:none}
    #inventory .shipStageHd b{font-size:17px;font-weight:800;color:#f3e8ca;text-shadow:0 1px 3px #000}
    #inventory .shipStageHd span{font-size:12px;color:#cbd8e2;text-shadow:0 1px 2px #000}
    #inventory .shipStagePlaceholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;color:rgba(228,218,188,.35)}
    #inventory .shipStagePlaceholder img{width:88px;height:88px;object-fit:contain;opacity:.5;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))}
    #inventory .shipCanvas{position:absolute;inset:0;width:100%;height:100%;display:block}
    #inventory .shipCargo{flex:1;min-height:0;display:flex;flex-direction:column;gap:9px;background:rgba(9,16,26,.55);border:1px solid rgba(201,168,90,.2);border-radius:10px;padding:14px 16px;box-shadow:inset 0 0 30px rgba(0,0,0,.3)}
    #inventory .shipCargoHd{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
    #inventory .shipCargoTitle{font-size:14px;font-weight:800;letter-spacing:.06em;color:#e7c878}
    #inventory .shipCargoSub{font-size:11px;font-weight:600;color:#9fbac4;letter-spacing:0}
    #inventory .shipCargoWt{font-size:12px;color:#cbd8e2;font-variant-numeric:tabular-nums}
    #inventory .shipCargoBar{height:8px;border-radius:4px;overflow:hidden;background:rgba(6,12,18,.8)}
    #inventory .shipCargoFill{height:100%;border-radius:4px;background:linear-gradient(90deg,#3a8a9a,#1e5663);transition:width .2s}
    #inventory .shipCargoGrid{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;align-content:start;margin-top:2px}
    #inventory .scCell{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
    #inventory .scDot{width:9px;height:9px;border-radius:3px;flex:none}
    #inventory .scIcon{font-size:16px}
    #inventory .scName{flex:1;font-size:13px;color:#e8eef2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #inventory .scQ{font-size:13px;font-weight:800;color:#ffe7a0;font-variant-numeric:tabular-nums}
    #inventory .scEmpty{grid-column:1/-1;color:rgba(228,218,188,.45);font-size:13px;padding:10px 2px}`;
  document.head.appendChild(stStatus);
  const tabsEl=panel.querySelector('#iv_tabs'), subtabsEl=panel.querySelector('#iv_subtabs'),
        gridEl=panel.querySelector('#iv_grid'), detailEl=panel.querySelector('#iv_detail'),
        charEl=panel.querySelector('#iv_char'), statsEl=panel.querySelector('#iv_stats'), shipEl=panel.querySelector('#iv_ship'), popupEl=panel.querySelector('#iv_popup'),
        hotEl=panel.querySelector('#iv_hot'), wtxt=panel.querySelector('#iv_wtxt'), wfill=panel.querySelector('#iv_wfill'),
        goldEl=panel.querySelector('#iv_gold'), toastEl=panel.querySelector('#iv_toast'), catDescEl=panel.querySelector('#iv_catdesc');

  const nameOf=id=>(inv.MATERIALS[id]||inv.TRADE_GOODS[id]||inv.FOODS?.[id]||{}).name||id;
  const priceOf=id=>(inv.TRADE_GOODS[id]||{}).basePrice;
  const weightOf=id=>(inv.MATERIALS[id]||inv.TRADE_GOODS[id]||inv.FOODS?.[id]||{}).weight;
  function personalItems(){ const o=[]; for(const id in inv.state.personal) if(inv.state.personal[id].qty>0) o.push(id); return o; }
  function cargoItems(){ const o=[]; for(const id in inv.state.cargo) if(inv.state.cargo[id].qty>0) o.push(id); return o; }
  //   🏛️ 거점 건물(settle)은 재료가 아니라 골드 — cost가 비어 있어 재료 검사만으론 항상 true가 된다. 골드도 같이 본다.
  const hasHarbor=()=>!!(ctx.wharf && ctx.wharf.pos);   // ⚓ 배 건조 해금 조건(shipyard.enter의 게이트와 동일 기준)
  const canAfford=rc=>Object.entries(rc.cost).every(([m,n])=>inv.count(m)>=n) && (!rc.settle || inv.gold>=(rc.gold|0))
    && (!rc.merc || (ctx.mercenary ? ctx.mercenary.waiting()>0 : false))   // 🗡️ 용병 배치 = 대기 중인 용병이 있어야 활성
    && (!rc.wharf || inv.gold>=((ctx.settlement&&ctx.settlement.harborCost&&ctx.settlement.harborCost())||0))   // ⚓ 항구 = 골드
    && (!rc.expand || !!(ctx.outpost && ctx.outpost.canExpand && ctx.outpost.canExpand().ok))   // 📈 거점 확장 = 골드+영혼+명예
    && (!rc.ship || (hasHarbor() && inv.gold>=(rc.gold|0)));   // 🚢 배 = 항구 선행 + 골드

  let toastT;
  function toast(t){ toastEl.textContent=t; toastEl.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>toastEl.classList.remove('show'),1600); }

  function buildTabs(){ tabsEl.innerHTML='';
    TOP_TABS.forEach(t=>{ const el=document.createElement('div'); el.className='ivtab'+(t.key===topTab?' on':''); el.dataset.key=t.key;
      el.innerHTML=`${t.img?`<img class="ticon" src="${t.img}" alt="">`:`<span class="tc">${t.icon}</span>`}${t.label}`;
      el.onclick=()=>{ topTab=t.key; selId=null; render(); };
      tabsEl.appendChild(el); }); }
  function buildSubTabs(){ subtabsEl.innerHTML='';
    SUB_TABS.forEach(s=>{ const el=document.createElement('div'); el.className='ivsub'+(s.key===subTab?' on':''); el.dataset.key=s.key;
      el.textContent=s.label;
      el.onclick=()=>{ subTab=s.key; selId=null; render(); };
      subtabsEl.appendChild(el); }); }

  function renderGrid(){ gridEl.innerHTML=''; let n=0;
    if(tab==='craft'){
      // 카테고리 서브탭(전체/도구/건축/가구·수납/장식/방어) + 제작가능만 필터 토글
      const bar=document.createElement('div'); bar.className='craftCatBar';
      CRAFT_CATS.forEach(ct=>{ const b=document.createElement('button'); b.className='ccBtn'+(ct===craftCat?' on':''); b.textContent=ct;
        b.onclick=()=>{ craftCat=ct; renderGrid(); }; bar.appendChild(b); });
      const ft=document.createElement('button'); ft.className='ccBtn ccFilter'+(craftMakeableOnly?' on':'');
      ft.textContent='제작가능만';
      ft.onclick=()=>{ craftMakeableOnly=!craftMakeableOnly; renderGrid(); }; bar.appendChild(ft);
      gridEl.appendChild(bar);
      const items=CRAFTABLES.filter(rc=> (craftCat==='전체' ? true : groupOf(rc)===craftCat) && (!craftMakeableOnly || canAfford(rc)));
      for(const rc of items){ const can=canAfford(rc);
        const cell=document.createElement('div'); cell.className='cell'+(selId===rc.id?' sel':'')+(can?'':' no'); cell.dataset.id=rc.id;
        cell.innerHTML=`${can?'<span class="mk">🔨</span>':''}<span class="pv">${pvc(rc)}</span>`;
        cell.onclick=()=>{ selId=rc.id; markSel(); renderDetail(); };
        gridEl.appendChild(cell); applyIcon(cell, rc.id); n++; }
      if(!n){ const e=document.createElement('div'); e.className='empty'; e.textContent='이 카테고리에 항목 없음'; gridEl.appendChild(e); }
      return;
    }
    const isCargo=tab==='cargo';
    const ids = isCargo ? cargoItems() : personalItems();
    const qOf = isCargo ? (id=>inv.cargoCount(id)) : (id=>inv.count(id));
    const ord = reconcileOrder(tab, ids);                       // 드래그 순서 반영
    const slots = Math.max(SLOT_COUNT, ord.length);             // 아이템 많으면 칸 확장
    for(let i=0;i<slots;i++){ const id=ord[i];
      const cell=document.createElement('div'); cell.dataset.slot=i;
      if(id){ const tint=TINT[id], q=qOf(id), isBuild=!!(inv.MATERIALS&&inv.MATERIALS[id]&&inv.MATERIALS[id].build);
        cell.className='cell'+(selId===id?' sel':'')+(isBuild?' buildItem':''); cell.dataset.id=id; cell.draggable=true;
        cell.innerHTML=`${tint?`<span class="dot" style="background:${tint}"></span>`:''}<span class="pv">${pv(id)}</span><span class="cnt">${q>STACK?STACK+'+':q}</span>`;
        cell.onclick=()=>{ selId=id; markSel(); renderDetail(); };
        if(topTab==='inv' && subTab==='mat'){   // 재료 탭 = 호버 시 커서 근처 상세 툴팁
          cell.addEventListener('mouseenter',ev=>showPopup(id, ev.clientX, ev.clientY));
          cell.addEventListener('mousemove', ev=>{ if(popupEl.classList.contains('show')) positionPopup(ev.clientX, ev.clientY); });
          cell.addEventListener('mouseleave',hidePopup);
        }
        attachDrag(cell, tab); gridEl.appendChild(cell); applyIcon(cell, id);
        if(isBuild){   // 건축부품 = 퀵슬롯 등록(드래그 → 핫바 칸 / 우클릭 → 빈 칸 자동)
          cell.addEventListener('dragstart',()=>{ window.__qsDrag=id; });
          cell.addEventListener('dragend',()=>{ window.__qsDrag=null; });
          cell.addEventListener('contextmenu',e=>{ e.preventDefault(); const fi=ctx.firstFreeSlot?ctx.firstFreeSlot():-1;
            if(fi<0){ toast('퀵슬롯이 가득 찼습니다'); return; }
            ctx.assignQuickslot && ctx.assignQuickslot(fi,{type:'build',id}); toast(`${nameOf(id)} → 퀵슬롯 ${fi===9?'0':fi+1}`); renderHotbar(); });
        }
      } else { cell.className='cell slotEmpty'; attachDrag(cell, tab); gridEl.appendChild(cell); }
    }
  }
  function markSel(){ [...gridEl.children].forEach(c=>c.classList.toggle('sel',c.dataset.id===selId)); }
  // 셀/상세에 실제 3D 렌더 아이콘 적용(준비되면 이모지→img 교체). modelId = 재료id 또는 레시피id.
  function applyIcon(rootEl, modelId){ const pv=rootEl.querySelector('.pv,.dPic'); if(!pv) return;
    renderIcon(modelId).then(url=>{ if(url && pv.isConnected) pv.innerHTML=`<img src="${url}" alt="">`; }); }

  // 재료 탭(캐릭터 뷰) = 마우스 호버 시 커서 근처에 상세 툴팁(BotW식). 그 외 탭 = 우측 상세 컬럼.
  function hidePopup(){ popupEl.classList.remove('show'); }
  function positionPopup(mx,my){   // 커서 근처 배치 — 오른쪽 우선, 넘치면 왼쪽. invWrap 안으로 클램프.
    const wr=panel.querySelector('.invWrap').getBoundingClientRect();
    const pw=popupEl.offsetWidth||288, ph=popupEl.offsetHeight||300;
    let left=(mx-wr.left)+18, top=(my-wr.top)+14;
    if(left+pw>wr.width-8) left=(mx-wr.left)-pw-18;               // 오른쪽 넘침 → 커서 왼쪽
    left=Math.max(8, Math.min(left, wr.width-pw-8));
    top =Math.max(8, Math.min(top,  wr.height-ph-8));
    popupEl.style.left=left+'px'; popupEl.style.top=top+'px';
  }
  function showPopup(id,mx,my){
    const q=inv.count(id), pr=priceOf(id), w=weightOf(id), tint=TINT[id];
    popupEl.innerHTML=`<div class="dPic">${pv(id)}</div>`
      +`<div class="dTitle" ${tint?`style="color:${tint==='#202227'?'#9aa':tint}"`:''}>${nameOf(id)}</div>`
      +`<div class="dRare">재료</div>`
      +`<div class="dDesc">${DESC[id]||''}</div>`
      +`<div class="dStat"><span>보유</span><b>${q}</b></div>`
      +`<div class="dStat"><span>개당 무게</span><b>${w!=null?w:'-'}</b></div>`
      +(pr!=null?`<div class="dStat"><span>기준 시세</span><b>◎ ${pr}</b></div>`:'');
    popupEl.classList.add('show');
    applyIcon(popupEl, id);
    positionPopup(mx,my);
  }
  function renderDetail(){
    if(topTab==='inv' && subTab==='mat'){ hidePopup(); return; }   // 재료 탭 = 호버 툴팁(선택 상세 아님)
    hidePopup();
    if(!selId){ detailEl.innerHTML=`<div class="dEmpty">${tab==='craft'?'제작할 항목을 선택하세요':'아이템을 선택하세요'}</div>`; return; }
    if(tab==='craft'){ const rc=CRAFTABLES.find(r=>r.id===selId); if(!rc){ detailEl.innerHTML='<div class="dEmpty">—</div>'; return; }
      const can=canAfford(rc);
      let rows=Object.entries(rc.cost).map(([m,need])=>{ const have=inv.count(m), ok=have>=need;
        return `<div class="cRow"><span class="ci">${pv(m)}</span><span class="cn">${nameOf(m)}</span><span class="cq" style="color:${ok?'#9fe3a0':'#ff9a9a'}">${have} / ${need}</span></div>`; }).join('');
      // 🏛️ 거점 건물 = 골드 비용(재료 아님) — 재료 행 대신 금화 행을 같은 포맷으로 보여준다.
      if(rc.settle){ const need=rc.gold|0, have=inv.gold, ok=have>=need;
        rows = `<div class="cRow"><span class="ci">◎</span><span class="cn">금화</span><span class="cq" style="color:${ok?'#9fe3a0':'#ff9a9a'}">${have} / ${need}</span></div>`; }
      // 🗡️ 용병 배치 = 재료·골드 대신 "명부" — 누가 대기 중이고 누가 어디 배치됐는지 그대로 보여준다.
      // ⚓🚢 항구·배 = 골드 비용(+배는 항구 선행 조건도 한 줄로 보여준다).
      if(rc.wharf){ const need=((ctx.settlement&&ctx.settlement.harborCost&&ctx.settlement.harborCost())||0), have=inv.gold, ok=have>=need;
        rows = `<div class="cRow"><span class="ci">◎</span><span class="cn">금화</span><span class="cq" style="color:${ok?'#9fe3a0':'#ff9a9a'}">${have} / ${need}</span></div>`; }
      if(rc.ship){ const need=rc.gold|0, have=inv.gold, okG=have>=need, okH=hasHarbor();
        rows = `<div class="cRow"><span class="ci">◎</span><span class="cn">금화</span><span class="cq" style="color:${okG?'#9fe3a0':'#ff9a9a'}">${have} / ${need}</span></div>`
             + `<div class="cRow"><span class="ci">⚓</span><span class="cn">항구(부두)</span><span class="cq" style="color:${okH?'#9fe3a0':'#ff9a9a'}">${okH?'건설됨':'필요'}</span></div>`; }
      // 📈 거점 확장 = 골드 + 토모브의 영혼 + 명예(문턱, 소모 안 함). 세 줄을 재료 행과 같은 포맷으로.
      if(rc.expand){ const op=ctx.outpost;
        const c = op && op.expandCost ? op.expandCost() : null;
        if(!c){ rows = `<div class="cRow"><span class="ci">—</span><span class="cn" style="opacity:.6">${op?'확장 한도에 도달했습니다':'거점 시스템 없음'}</span><span class="cq"></span></div>`; }
        else {
          const gold=inv.gold, soul=(ctx.combat&&ctx.combat.soul)||0, honor=(ctx.reputation&&ctx.reputation.honor)||0;
          const row=(ic,nm,have,need,suffix)=>`<div class="cRow"><span class="ci">${ic}</span><span class="cn">${nm}</span>`
            +`<span class="cq" style="color:${have>=need?'#9fe3a0':'#ff9a9a'}">${have} / ${need}${suffix||''}</span></div>`;
          rows = row('◎','금화',gold,c.gold) + row('◆','토모브의 영혼',soul,c.soul) + row('✦','명예',honor,c.honor,' (소모 안 함)');
        }
      }
      if(rc.merc){ const mr=(ctx.mercenary&&ctx.mercenary.roster)||[];
        rows = mr.length
          ? mr.map(m=>`<div class="cRow"><span class="ci">🗡️</span><span class="cn">${m.ko}<span style="opacity:.55;font-size:11px"> T${m.tier}</span></span>`
              +`<span class="cq" style="color:${m.deployed?'#8fa8c8':'#9fe3a0'}">${m.deployed?m.deployed:'대기'}</span></div>`).join('')
          : `<div class="cRow"><span class="ci">—</span><span class="cn" style="opacity:.6">영입한 용병 없음 — 던전을 정복하세요</span><span class="cq"></span></div>`; }
      const outId = rc.build ? rc.id : (rc.out ? rc.out[0] : null);   // 제작 결과 아이템
      const owned = outId!=null ? inv.count(outId) : null;
      detailEl.innerHTML=`<div class="dPic">${pvc(rc)}</div>`
        +`<div class="dTitle">${rc.name}</div><div class="dRare">제작 · ${rc.cat||rc.station||''}</div>`
        +`<div class="dDesc">${rc.desc}</div>`
        +(owned!=null?`<div class="dStat"><span>보유</span><b id="iv_owned">${owned}</b></div>`:'')
        +`<div class="cReq">${
            rc.expand ? `확장 비용 (거점 ${(ctx.outpost?ctx.outpost.used:0)}/${(ctx.outpost?ctx.outpost.slots:0)})`
          : rc.merc ? `용병 명부 (${(ctx.mercenary?ctx.mercenary.count():0)}/${(ctx.mercenary?ctx.mercenary.cap():0)})`
          : rc.ship ? '건조 조건' : (rc.wharf||rc.settle) ? '건설 비용' : '필요 재료'}</div>${rows}`
        +`<button class="craftBtn" id="iv_make" ${can?'':'disabled'}>${
            can ? (rc.expand?'거점 확장' : rc.merc?'이 거점에 배치' : rc.ship?'부두에 건조' : rc.wharf?'해안에 건설' : rc.settle?'거점에 건설' : rc.place?'제작 후 설치':'제작')
                : (rc.expand?((ctx.outpost&&ctx.outpost.canExpand&&ctx.outpost.canExpand().reason)||'확장 불가')
                  : rc.merc?'대기 중인 용병 없음' : rc.ship?(hasHarbor()?'금화 부족':'항구 먼저 필요') : (rc.wharf||rc.settle)?'금화 부족':'재료 부족')
          }</button>`
        +`<div id="iv_progwrap" class="craftProg" style="display:none">`
        +  `<div class="cpTop"><span id="iv_progname"></span><span>대기 <b id="iv_qn">0</b></span></div>`
        +  `<div class="cpBar"><div id="iv_progfill"></div></div></div>`;
      const mk=detailEl.querySelector('#iv_make'); if(mk) mk.onclick=()=>craft(rc);
      applyIcon(detailEl, rc.id);
      updateCraftBar();
      return;
    }
    const isCargo=tab==='cargo', q=isCargo?inv.cargoCount(selId):inv.count(selId), pr=priceOf(selId), w=weightOf(selId), tint=TINT[selId];
    detailEl.innerHTML=`<div class="dPic">${pv(selId)}</div>`
      +`<div class="dTitle" ${tint?`style="color:${tint==='#202227'?'#9aa':tint}"`:''}>${nameOf(selId)}</div>`
      +`<div class="dRare">${isCargo?'교역품':'재료'}</div>`
      +`<div class="dDesc">${DESC[selId]||''}</div>`
      +`<div class="dStat"><span>보유</span><b>${q}</b></div>`
      +`<div class="dStat"><span>개당 무게</span><b>${w!=null?w:'-'}</b></div>`
      +(pr!=null?`<div class="dStat"><span>기준 시세</span><b>◎ ${pr}</b></div>`:'');
    applyIcon(detailEl, selId);
  }

  // ── 펠월드식 제작 큐 + 게이지 (1개당 고정시간, 완료마다 인벤 +1 누적) ──
  const CRAFT_SEC=1.5;
  let cq=[], cprog=0, ctimer=null, _ctlast=0;     // 큐(레시피id) · 진행도0~1 · 타이머
  const craftQ=rc=>cq.filter(x=>x===rc.id).length; // 이 레시피 대기 개수
  function enqueue(rc){
    if(!canAfford(rc)){ toast('재료 부족'); return; }
    const _disc = ctx.settlement?.craftDisc ? ctx.settlement.craftDisc() : 0;   // 🔧 대장간 건물 = 제작 시 확률적 재료 무상
    if(_disc>0 && Math.random()<_disc){ toast('대장간: 재료 없이 제작'); }
    else for(const [m,n] of Object.entries(rc.cost)) inv.remove(m,n);  // 큐 등록 시 즉시 차감(펠월드)
    cq.push(rc.id);
    if(!ctimer){ _ctlast=Date.now(); ctimer=setInterval(tickCraft,60); }
    render();
  }
  function tickCraft(){
    if(!cq.length){ clearInterval(ctimer); ctimer=null; cprog=0; updateCraftBar(); return; }
    const now=Date.now(); cprog += (now-_ctlast)/1000/CRAFT_SEC; _ctlast=now;
    if(cprog>=1){ const id=cq.shift(); cprog=0; completeCraft(id); }
    updateCraftBar();
  }
  function completeCraft(id){ const rc=CRAFTABLES.find(r=>r.id===id); if(!rc) return;
    ctx.sound?.play?.('craft_done');   // ★제작 완료 전용음(제작완료.mp3, 사령관 신규). invui만 빠져 있던 것 배선.
    // ★도구 = 인벤 아이템/건축부품이 아니라 퀵슬롯 도구로 지급(곡괭이→0번·도끼→1번, 그 외 첫 빈칸).
    if(rc.tool){
      const slot = rc.tool==='pickaxe'?0 : rc.tool==='axe'?1 : (ctx.firstFreeSlot?ctx.firstFreeSlot():-1);
      const already = ctx.quickslots && ctx.quickslots.some(s=>s&&s.type==='tool'&&s.id===rc.tool);
      if(!already && ctx.assignQuickslot && slot>=0) ctx.assignQuickslot(slot, {type:'tool', id:rc.tool});
      else if(ctx.updHotbar) ctx.updHotbar();
      toast(`${rc.name} 제작 완료 — 퀵슬롯 장착`);
      ctx.events.emit('toolCrafted', rc.tool);   // R2: 이벤트 버스
      if(open) render();
      return;
    }
    const outId = rc.build ? rc.id : (rc.out ? rc.out[0] : rc.id);
    const outQty = rc.out ? rc.out[1] : 1;
    if(rc.toCargo){ if(!inv.loadCargo(outId, outQty)) toast('화물칸 가득 — 가공품 적재 실패'); }   // 🏭 가공 교역품 = 화물칸 직행(가득이면 실패 알림)
    else inv.add(outId, outQty);
    // ★건축 부품 = 퀵슬롯이 비었을 때 자동 등록(아직 슬롯에 없고 + 빈 칸 있으면). 슬롯 가득이면 인벤에만.
    if(rc.build && ctx.quickslots && ctx.assignQuickslot){
      const already = ctx.quickslots.some(s=>s && s.id===outId);
      if(!already){ const fi = ctx.firstFreeSlot ? ctx.firstFreeSlot() : -1; if(fi>=0){ ctx.assignQuickslot(fi,{type:'build',id:outId}); } }
      else if(ctx.updHotbar) ctx.updHotbar();      // 수량만 갱신
    }
    toast(`${rc.name} +${outQty}`);
    if(open) render();                              // 보유 수량·대기수 갱신
  }
  // 진행바/대기수/보유 라이브 업데이트(전체 재렌더 없이 — 60ms 틱마다)
  function updateCraftBar(){
    const wrap=document.getElementById('iv_progwrap'); if(wrap) wrap.style.display=cq.length?'block':'none';
    const fill=document.getElementById('iv_progfill'); if(fill) fill.style.width=(Math.min(1,cprog)*100).toFixed(1)+'%';
    const nm=document.getElementById('iv_progname'); if(nm){ const rc=CRAFTABLES.find(r=>r.id===cq[0]); nm.textContent=rc?`제작 중 · ${rc.name}`:''; }
    const qn=document.getElementById('iv_qn'); if(qn) qn.textContent=cq.length;
    const own=document.getElementById('iv_owned'); if(own){ const rc=CRAFTABLES.find(r=>r.id===selId); const oid=rc&&(rc.build?rc.id:(rc.out?rc.out[0]:null)); if(oid!=null) own.textContent=inv.count(oid); }
  }

  function craft(rc){
    // 📈 거점 확장 — 골드·영혼 차감은 outpost.expand가 원자적으로 처리(실패 시 되돌림).
    if(rc.expand){
      if(!ctx.outpost || !ctx.outpost.expand){ toast('거점 시스템을 사용할 수 없습니다'); return; }
      const r = ctx.outpost.expand();
      if(!r.ok){ toast(r.reason || '확장할 수 없습니다'); return; }
      render();   // 다음 단계 비용·진행도 갱신
      return;
    }
    // ⚓ 항구(부두) 건설 — 구 G키 흐름을 그대로 호출(해안 판정·고스트·R 회전·좌클릭 확정은 wharf.js 담당).
    if(rc.wharf){
      if(!ctx.wharfBuild || !ctx.wharfBuild.start){ toast('항구 건설을 사용할 수 없습니다'); return; }
      close();
      const ok = ctx.wharfBuild.start();
      if(ok === false) toast('해안에서만 지을 수 있습니다 — 바다가 보이는 물가로 가세요');
      else toast('항구 — 바다를 보고 좌클릭 · [R] 회전 · [Esc] 취소');
      return;
    }
    // 🚢 배 건조 — 항구 선행. 구 K키 드라이독 흐름을 그대로 호출(부두 근처 좌클릭 확정은 shipyard.js 담당).
    if(rc.ship){
      if(!hasHarbor()){ toast('먼저 항구(부두)를 지어야 배를 건조할 수 있습니다'); return; }
      if(!ctx.shipyard || !ctx.shipyard.enter){ toast('조선소를 사용할 수 없습니다'); return; }
      close();
      ctx.shipyard.enter(rc.ship);
      toast(`${rc.name} — 부두 근처를 보고 좌클릭 · [Esc] 취소`);
      return;
    }
    // 🗡️ 몬스터 용병 배치 — 지금 서 있는 거점에 대기 중 용병 1명을 수비병으로.
    if(rc.merc){
      if(!ctx.mercenary){ toast('용병 시스템을 사용할 수 없습니다'); return; }
      const r = ctx.mercenary.deployHere();
      if(!r.ok){ toast(r.reason); return; }
      render();   // 남은 대기 인원 반영
      return;
    }
    // 🏛️ 거점 건물(settle) — 재료가 아니라 골드. 내가 선 자리를 품는 거점 반경 안에서만, settlement 고스트로 배치.
    if(rc.settle){
      const op = ctx.outpost;
      const pos = ctx.player && ctx.player.pos;
      const isl = (op && op.outpostAt && pos) ? op.outpostAt(pos.x, pos.z) : null;
      if(!isl){ toast('거점 반경 안에서만 지을 수 있습니다 — 깃발을 세운 곳으로 가세요'); return; }
      if(inv.gold < rc.gold){ toast(`금화 부족 (${inv.gold} / ${rc.gold})`); return; }
      const st = ctx.settlement;
      if(!st || !st.ghostShow){ toast('건설 시스템을 사용할 수 없습니다'); return; }
      const cap = st.freeSlot ? st.freeSlot(isl) : 0;
      if(cap < 0){ toast('거점 건물 슬롯이 가득 찼습니다 — 거점 Lv를 올리세요'); return; }
      if(st.maxOf && st.count && st.count(isl, rc.settle) >= st.maxOf(rc.settle)){ toast(`${rc.name} 상한에 도달했습니다`); return; }
      // 마우스 조준 고스트 → [R] 회전 → 좌클릭 확정(골드 차감은 settlement.build). async라 결과를 기다려 실패 사유를 그대로 보여준다.
      const REASON={ 'not-loaded':'섬이 아직 로드되지 않았습니다 — 가까이 가세요', 'max-kind':`${rc.name} 상한에 도달했습니다`,
                     'no-slot':'거점 건물 슬롯이 가득 찼습니다 — 거점 Lv를 올리세요', 'load-fail':'건물 모델을 불러오지 못했습니다', 'bad':'이 거점에는 지을 수 없습니다' };
      close();
      st.ghostShow(isl, rc.settle).then(r=>{
        if(r && r.ok) toast(`${rc.name} — 위치를 보고 좌클릭 · [R] 회전 · [Esc] 취소`);
        else toast(REASON[r && r.reason] || '건설을 시작할 수 없습니다');
      });
      return;
    }
    // 대포·석궁·토대 등 즉시 배치형(place='cannon'|'crossbow'|'foundation')은 배치 흐름.
    if(rc.place){
      if(!canAfford(rc)) return;
      for(const [m,n] of Object.entries(rc.cost)) inv.remove(m,n);
      const refund=()=>{ for(const [m,n] of Object.entries(rc.cost)) inv.add(m,n); };
      const kind = (typeof rc.place==='string') ? rc.place : 'cannon';
      const starter = ctx.claim && ({ cannon:ctx.claim.startCannonPlace, crossbow:ctx.claim.startCrossbowPlace, foundation:ctx.claim.startFoundationPlace }[kind]);
      const ok = starter ? starter({ onCancel:refund }) : false;
      if(ok){ close(); } else { refund(); toast('배치를 시작할 수 없습니다'); render(); }
      return;
    }
    enqueue(rc);   // 던전 부품·강철·청동 = 게이지 제작 → 인벤 누적
  }

  const TOOLLABEL={ pickaxe:['⛏','곡괭이'], axe:['🪓','도끼'], hammer:['🔨','망치'], none:['🤚','빈손'] };
  const QK10=['1','2','3','4','5','6','7','8','9','0'];
  // 하단 핫바 = 공용 ctx.quickslots 10칸 동기화 + 드래그/우클릭 등록 타깃.
  function renderHotbar(){ hotEl.innerHTML='';
    const qs=ctx.quickslots||[]; const cur=ctx.player&&ctx.player.currentTool;
    for(let i=0;i<10;i++){ const s=qs[i]; let on=false, icon='', nm='', cnt='';
      if(s&&s.type==='tool'){ const L=TOOLLABEL[s.id]||['🤚','빈손']; icon=L[0]; nm=L[1]; on=(s.id===cur); }
      else if(s&&s.type==='build'){ const u=_iconCache[s.id]; icon=(typeof u==='string')?`<img src="${u}" alt="">`:(ICON[s.id]||'🧱'); nm=nameOf(s.id); cnt=inv.count(s.id); }
      const el=document.createElement('div'); el.className='mslot'+(on?' on':'')+(s?'':' mEmpty'); el.dataset.qslot=i;
      el.innerHTML=`<span class="num">${QK10[i]}</span><span class="pic">${icon}</span><span class="nm">${nm}</span>`+(cnt!==''?`<span class="qcnt">${cnt}</span>`:'');
      el.addEventListener('dragover',e=>{ if(window.__qsDrag!=null){ e.preventDefault(); el.classList.add('dragOver'); } });
      el.addEventListener('dragleave',()=>el.classList.remove('dragOver'));
      el.addEventListener('drop',e=>{ e.preventDefault(); el.classList.remove('dragOver'); if(window.__qsDrag!=null && ctx.assignQuickslot){ ctx.assignQuickslot(i,{type:'build',id:window.__qsDrag}); renderHotbar(); } });
      el.addEventListener('contextmenu',e=>{ e.preventDefault(); if(s && ctx.assignQuickslot){ ctx.assignQuickslot(i,null); renderHotbar(); } });   // 우클릭=칸 비우기
      hotEl.appendChild(el); } }

  // ── 중앙 실시간 3D 캐릭터 뷰어 (팰월드 인벤 중앙). player.js와 동일 모델/스케일/Idle_A. ──
  const CHAR_GLB={ knight:KAY_CHARS.knight, barbarian:KAY_CHARS.barbarian, mage:KAY_CHARS.mage, ranger:KAY_CHARS.ranger,
    rogue:KAY_CHARS.rogue_hooded, rogue_hooded:KAY_CHARS.rogue_hooded, default:KAY_CHARS.knight };
  const IDLE_GLB='/tomob-deploy/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/Rig_Medium_General.glb';
  let cv=null;   // {canvas,renderer,scene,camera,mixer,clock,model,idleClip,cls,raf,running}
  const _cvLoad=u=>new Promise((res,rej)=>new GLTFLoader().load(encodeURI(u),res,undefined,rej));
  let _cvInit=null;
  function ensureCharViewer(){
    if(_cvInit) return _cvInit;
    _cvInit=(async()=>{
      const canvas=document.createElement('canvas'); canvas.className='charCanvas'; charEl.appendChild(canvas);
      const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
      renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); renderer.outputColorSpace=THREE.SRGBColorSpace;
      const scene=new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff,0x2a3040,1.55));
      const kl=new THREE.DirectionalLight(0xfff2d8,2.1); kl.position.set(2,4,3); scene.add(kl);
      const rl=new THREE.DirectionalLight(0x88aaff,1.1); rl.position.set(-3,2.5,-2); scene.add(rl);
      const camera=new THREE.PerspectiveCamera(32,1,0.1,100); camera.position.set(0,1.02,6.1); camera.lookAt(0,1.02,0);   // 수평 시선(머리 안 잘림) + 거리 6.1로 캐릭터 작게 + 중앙 정렬. 브라우저 검증값(2026-07-03).
      cv={canvas,renderer,scene,camera,mixer:null,clock:new THREE.Clock(),model:null,idleClip:null,cls:null,raf:0,running:false};
      window.__invCV=()=>cv;   // 디버그: 카메라 프레이밍 라이브 튜닝용
      try{ const ig=await _cvLoad(IDLE_GLB); cv.idleClip=ig.animations.find(a=>a.name==='Idle_A')||ig.animations.find(a=>/idle/i.test(a.name))||ig.animations[0]||null; }
      catch(e){ console.warn('[invui] idle 애니 로드 실패', e&&e.message); }
      return cv;
    })();
    return _cvInit;
  }
  async function setCharClass(cls){
    await ensureCharViewer();
    if(cv.cls===cls) return;
    cv.cls=cls;
    let g; try{ g=await _cvLoad(CHAR_GLB[cls]||CHAR_GLB.default); }
    catch(e){ console.warn('[invui] 캐릭터 GLB 로드 실패', cls, e&&e.message); return; }
    if(cv.model){ cv.scene.remove(cv.model); }
    const m=g.scene; m.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh) o.frustumCulled=false; });
    const box=new THREE.Box3().setFromObject(m); const sz=new THREE.Vector3(); box.getSize(sz); const natH=sz.y||1;
    m.scale.setScalar(1.35/natH); const b2=new THREE.Box3().setFromObject(m); m.position.y-=b2.min.y;   // 높이 1.35m + 바닥정렬(player.js 동일)
    m.rotation.y=-0.35;   // 살짝 3/4 정면
    cv.scene.add(m); cv.model=m;
    cv.mixer=new THREE.AnimationMixer(m);
    if(cv.idleClip) cv.mixer.clipAction(cv.idleClip).reset().play();
  }
  function cvResize(){ if(!cv) return; const w=charEl.clientWidth||360, h=charEl.clientHeight||520;
    if(w<2||h<2) return; cv.renderer.setSize(w,h,false); cv.camera.aspect=w/h; cv.camera.updateProjectionMatrix(); }
  function cvTick(){ if(!cv||!cv.running) return;
    const dt=cv.clock.getDelta(); if(cv.mixer) cv.mixer.update(dt);
    cv.renderer.render(cv.scene,cv.camera); cv.raf=requestAnimationFrame(cvTick); }
  function cvStart(){ if(!cv||cv.running) return; cv.running=true; cvResize(); cv.clock.getDelta(); cvTick(); }
  function cvStop(){ if(!cv) return; cv.running=false; if(cv.raf) cancelAnimationFrame(cv.raf); cv.raf=0; }
  function renderChar(){ const cls=(ctx.combat&&ctx.combat.cls)||'default';
    ensureCharViewer().then(()=>setCharClass(cls)).then(()=>{ cvResize(); cvStart(); }); }

  // ── 우측 레벨/스탯 패널 (팰월드 인벤 우측). 있는 데이터만 — 방어·작업속도 등 없는 건 넣지 않음. ──
  const _psBar=(pct,col)=>`<div class="psBar"><div class="psFill" style="width:${Math.max(0,Math.min(100,pct))}%;background:${col}"></div></div>`;
  function renderStats(){
    const c=ctx.combat||{};
    const cls=c.cls||'default', clsName=CLS_NAME[cls]||'모험가';
    const hp=c.hp??0, maxHp=c.maxHp??1, stam=c.stamina??0, maxStam=c.maxStamina??1;
    const lvl=c.level??1, xp=c.xp??0, xpMax=c.xpMax??1, soul=c.soul??0;
    const atk=(c.atkMul!=null)?c.atkMul:null;
    const w=inv.currentWeight, mw=inv.maxWeight, gold=inv.gold??0;
    const rows=[
      ['공격', atk!=null?('×'+atk.toFixed(2)):'—'],
      // ★소지중량 제거 — 개인 인벤 무게 제한 폐지(사령관: 무게는 배 화물칸에나). 배 화물칸 무게는 보유배 화면에서 표시.
      ['토모브의 영혼', String(soul), '#ffe6a0', '/tomob-deploy/tomobsoul.png'],
      ['◎ 소지금', gold.toLocaleString(), '#f3d978'],
    ];
    statsEl.innerHTML=`
      <div class="psLvlBox">
        <div class="psLvlNum">${lvl}</div>
        <div class="psLvlR">
          <div class="psLvlLbl">PLAYER LEVEL</div>
          <div class="psXpRow"><span>NEXT</span><span class="psXpVal">${Math.round(xp)} / ${xpMax}</span></div>
          <div class="psXpBar"><div class="psXpFill" style="width:${xp/xpMax*100}%"></div></div>
        </div>
      </div>
      <div class="psGauges">
        <div class="psGRow"><span class="psGLbl" style="color:#54d35a">HP</span>${_psBar(hp/maxHp*100,'#54d35a')}<span class="psGVal">${Math.round(hp)} / ${maxHp}</span></div>
        <div class="psGRow"><span class="psGLbl" style="color:#f0a32e">기력</span>${_psBar(stam/maxStam*100,'#f0a32e')}<span class="psGVal">${Math.round(stam)} / ${maxStam}</span></div>
      </div>
      <div class="psCard">
        <div class="psName">${clsName}</div>
        <div class="psTitle">스테이터스</div>
        ${rows.map(r=>`<div class="psStat"><span class="psSLbl">${r[3]?`<img src="${r[3]}" alt="">`:''}${r[0]}</span><b class="psSVal" ${r[2]?`style="color:${r[2]}"`:''}>${r[1]}</b></div>`).join('')}
      </div>`;
  }

  // ── 보유배 화면(보유펠식): 좌 함대 리스트 + 중앙 3D 배(Task9) + 배 정보 ──
  const SHIP_TYPE={ longship:'롱십', caravel:'캐러벨' };
  let shipSel=0;
  function fleetData(){
    const durMax=(BAL.ship&&BAL.ship.durMax)||100, fleet=ctx.fleet||[];
    let ships=fleet.map(f=>({ name:f.name, key:f.key, dur:(f.bs&&f.bs.durability!=null)?f.bs.durability:durMax }));
    if(!ships.length && ctx.ship) ships=[{ name:ctx.ship.name||'현재 배', key:ctx.ship.key||'', dur:ctx.ship.durability!=null?ctx.ship.durability:durMax }];
    return { ships, durMax };
  }
  function renderShip(){
    const { ships, durMax }=fleetData();
    if(!ships.length){ shipEl.innerHTML='<div class="shipEmpty">보유한 배가 없습니다 · 항구 관리 → 배 관리 → 제작에서 건조하세요</div>'; cvShipStop(); return; }
    if(shipSel>=ships.length) shipSel=0;
    const listHtml=ships.map((s,i)=>{ const pct=Math.round(s.dur/durMax*100), dcol=pct>60?'#7fdc9a':pct>30?'#e2c46a':'#dc7f7f';
      return `<div class="shipRow${i===shipSel?' on':''}" data-i="${i}">
        <div class="shipRowInfo"><div class="shipRowName">${s.name||'—'}</div>
          <div class="shipDur"><div class="shipDurFill" style="width:${pct}%;background:${dcol}"></div></div>
          <div class="shipRowType">${SHIP_TYPE[s.key]||'배'} · 내구도 ${pct}%</div></div>
        <div class="shipRowThumb"><img src="/tomob-deploy/ui/icons/icon_sail.png" alt=""></div></div>`; }).join('');
    const sel=ships[shipSel], pct=Math.round(sel.dur/durMax*100), dcol=pct>60?'#7fdc9a':pct>30?'#e2c46a':'#dc7f7f';
    // ── 이 배에 실린 화물 (현재 화물칸 = inv.cargo) ──
    const cargoIds=cargoItems();
    const cargoCells = cargoIds.length ? cargoIds.map(id=>{ const tint=TINT[id];
      return `<div class="scCell">${tint?`<span class="scDot" style="background:${tint}"></span>`:''}<span class="scIcon">${pv(id)}</span><span class="scName">${nameOf(id)}</span><span class="scQ">${inv.cargoCount(id)}</span></div>`;
    }).join('') : '<div class="scEmpty">실린 화물이 없습니다</div>';
    const cw=inv.cargoWeight||0, cc=inv.cargoCapacity||0, cwPct=cc>0?Math.min(100,cw/cc*100):0;
    // ── 배 스탯 (실제 있는 값만. ★함포/HP는 해전 골든패스[3] 전용 미통합 → 제외, 거짓표시 안 함) ──
    const cap=(inv.CARGO_CAPACITY&&inv.CARGO_CAPACITY[sel.key])||inv.cargoCapacity||0;
    const shipStats=[
      ['내구도', pct+'%', dcol],
      ['최대 속도', ((BAL.ship&&BAL.ship.maxSpeed)||0).toFixed(1)],
      ['화물 용량', String(cap)],
    ];
    const statsHtml=shipStats.map(s=>`<div class="shipStat"><span class="ssLbl">${s[0]}</span><b class="ssVal"${s[2]?` style="color:${s[2]}"`:''}>${s[1]}</b></div>`).join('');
    shipEl.innerHTML=`
      <div class="shipListCol"><div class="shipListTitle">보유 배 (${ships.length})</div>${listHtml}</div>
      <div class="shipViewCol">
        <div class="shipStage" id="iv_shipstage">
          <div class="shipStageHd"><b>${sel.name||'—'}</b><span>${SHIP_TYPE[sel.key]||'배'} · 내구도 <b style="color:${dcol}">${pct}%</b></span></div>
          <div class="shipStagePlaceholder" id="iv_shipph"><img src="/tomob-deploy/ui/icons/icon_sail.png" alt=""></div>
        </div>
        <div class="shipStats">${statsHtml}</div>
        <div class="shipCargo">
          <div class="shipCargoHd"><span class="shipCargoTitle">화물 <span class="shipCargoSub">· 이 배에 실린 교역품</span></span>
            <span class="shipCargoWt">보유 ${cargoIds.length}종 · 무게 ${cw.toFixed(1)} / ${cc}</span></div>
          <div class="shipCargoBar"><div class="shipCargoFill" style="width:${cwPct}%"></div></div>
          <div class="shipCargoGrid">${cargoCells}</div>
        </div>
      </div>`;
    [...shipEl.querySelectorAll('.shipRow')].forEach(r=>r.onclick=()=>{ shipSel=+r.dataset.i; renderShip(); });
    renderShipModel(sel.key);   // 3D 배 (persistent 캔버스를 스테이지에 마운트)
  }

  // ── 보유배 3D 뷰어 (persistent 캔버스를 스테이지에 재부착). 배별 모델: caravel=GLB(draco), 그 외=oseberg OBJ. ──
  const SHIP_MODELS={
    caravel:{ url:'/tomob-deploy/obj/caravel-ship/optimized.glb', type:'glb' },
    _default:{ url:'/tomob-deploy/obj/oseberg-ship/_ex/oseberg.1.8.obj', tex:'/tomob-deploy/obj/oseberg-ship/textures/Body-wood-texture.png', type:'obj' },
  };
  let sv=null, _svInit=null;
  function ensureShipViewer(){
    if(_svInit) return _svInit;
    _svInit=(async()=>{
      const canvas=document.createElement('canvas'); canvas.className='shipCanvas';
      const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
      renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); renderer.outputColorSpace=THREE.SRGBColorSpace;
      const scene=new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe8ff,0x2a3040,1.6));
      const kl=new THREE.DirectionalLight(0xfff2d8,2.1); kl.position.set(3,5,4); scene.add(kl);
      const rl=new THREE.DirectionalLight(0x88aaff,0.9); rl.position.set(-4,3,-3); scene.add(rl);
      const camera=new THREE.PerspectiveCamera(35,1,0.1,2000);
      sv={canvas,renderer,scene,camera,holder:null,key:'__none__',raf:0,running:false,rot:0.5};
      window.__invSV=()=>sv;
      return sv;
    })();
    return _svInit;
  }
  async function loadShipObj(key){
    const cfg=SHIP_MODELS[key]||SHIP_MODELS._default;
    if(cfg.type==='glb'){
      const { DRACOLoader }=await import('three/addons/loaders/DRACOLoader.js');
      const draco=new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
      const gl=new GLTFLoader(); gl.setDRACOLoader(draco);
      const g=await new Promise((rs,rj)=>gl.load(encodeURI(cfg.url),rs,undefined,rj)); return g.scene;
    }
    const obj=await new Promise((rs,rj)=>new OBJLoader().load(encodeURI(cfg.url),rs,undefined,rj));
    if(cfg.tex){ const tex=new THREE.TextureLoader().load(encodeURI(cfg.tex)); tex.colorSpace=THREE.SRGBColorSpace;
      obj.traverse(o=>{ if(o.isMesh) o.material=new THREE.MeshStandardMaterial({ map:tex, roughness:0.82, metalness:0 }); }); }
    return obj;
  }
  async function setShipModelClass(key){
    await ensureShipViewer();
    if(sv.key===key) return;
    sv.key=key;
    let obj; try{ obj=await loadShipObj(key); }catch(e){ console.warn('[invui] 배 모델 로드 실패', key, e&&e.message); sv.key='__fail__'; return; }
    if(sv.holder){ sv.scene.remove(sv.holder); }
    obj.traverse(o=>{ if(o.isMesh) o.frustumCulled=false; });
    const box=new THREE.Box3().setFromObject(obj), c=new THREE.Vector3(), sz=new THREE.Vector3();
    box.getCenter(c); box.getSize(sz); const s=3/(Math.max(sz.x,sz.y,sz.z)||1);
    obj.scale.setScalar(s); obj.position.set(-c.x*s,-c.y*s,-c.z*s);   // 스케일 정규화 + 중심 원점
    const holder=new THREE.Group(); holder.add(obj); sv.scene.add(holder); sv.holder=holder;
    sv.camera.position.set(3.4,2.1,3.8); sv.camera.lookAt(0,0,0);
  }
  function svResize(stage){ if(!sv||!stage) return; const w=stage.clientWidth||400, h=stage.clientHeight||300;
    if(w<2||h<2) return; sv.renderer.setSize(w,h,false); sv.camera.aspect=w/h; sv.camera.updateProjectionMatrix(); }
  function cvShipTick(){ if(!sv||!sv.running) return;
    if(sv.holder){ sv.rot+=0.004; sv.holder.rotation.y=sv.rot; }
    sv.renderer.render(sv.scene,sv.camera); sv.raf=requestAnimationFrame(cvShipTick); }
  function cvShipStart(stage){ if(!sv) return; svResize(stage); if(!sv.running){ sv.running=true; cvShipTick(); } }
  function cvShipStop(){ if(!sv) return; sv.running=false; if(sv.raf) cancelAnimationFrame(sv.raf); sv.raf=0; }
  function renderShipModel(key){
    const stage=document.getElementById('iv_shipstage'); if(!stage) return;
    ensureShipViewer().then(()=>{
      if(sv.canvas.parentNode!==stage) stage.appendChild(sv.canvas);
      const ph=document.getElementById('iv_shipph');
      return setShipModelClass(key).then(()=>{
        if(sv.key==='__fail__'){ if(ph) ph.style.display=''; sv.canvas.style.display='none'; cvShipStop(); }
        else { if(ph) ph.style.display='none'; sv.canvas.style.display='block'; cvShipStart(stage); }
      });
    });
  }

  function renderFooter(){ const w=inv.currentWeight, mw=inv.maxWeight;
    // ★버그 수정(2026-07-15, 사령관): 골드 갱신을 무게 조기 return보다 앞으로 이동.
    //   개인 무게 무제한(Infinity)이면 아래 return에 걸려 골드 갱신(구 위치)이 스킵돼 I-패널이 초기값 0으로 고착했음.
    goldEl.textContent=inv.gold.toLocaleString();
    if(mw===Infinity){   // ★개인 무게 제한 없음 → footer 무게 표시(⚖·바) 숨김(사령관)
      wtxt.style.display='none'; const wb=wfill.parentElement; if(wb) wb.style.display='none';
      const ic=wtxt.previousElementSibling; if(ic&&ic.classList&&ic.classList.contains('wic')) ic.style.display='none';
      return; }
    wtxt.textContent=`${w.toFixed(1)} / ${mw}`; wfill.style.width=Math.min(100,w/mw*100)+'%'; }

  function render(){
    tab = (topTab==='inv') ? 'mat' : topTab;   // 유효 컨텐츠탭: 인벤토리=재료, 아니면 topTab(craft/ship). 화물은 보유배로 이동.
    catDescEl.textContent=CAT_DESC[tab]||'';
    // 탭 하이라이트(상단). 서브탭은 항목 2개 이상일 때만 노출(현재 재료뿐 → 숨김)
    [...tabsEl.children].forEach(c=>c.classList.toggle('on',c.dataset.key===topTab));
    subtabsEl.style.display = (topTab==='inv' && SUB_TABS.length>1) ? 'flex' : 'none';
    [...subtabsEl.children].forEach(c=>c.classList.toggle('on',c.dataset.key===subTab));
    const isShip = (topTab==='ship');
    const showChar = (topTab==='inv' && subTab==='mat');   // ★상태창(캐릭터+스탯)은 재료 탭에서만
    if(!showChar) popupEl.classList.remove('show');        // 재료 탭 떠나면 선택 팝업 닫기
    // 존 표시
    gridEl.style.display   = isShip?'none':'';
    detailEl.style.display = (isShip||showChar)?'none':'';   // 재료=상태창 / 화물·제작=상세 컬럼 / 보유배=배화면
    charEl.style.display   = showChar?'flex':'none';
    statsEl.style.display  = showChar?'flex':'none';
    shipEl.style.display   = isShip?'flex':'none';
    if(isShip){ cvStop(); renderShip(); }
    else { cvShipStop(); renderGrid(); renderDetail(); if(showChar){ renderChar(); renderStats(); } else cvStop(); }
    renderHotbar(); renderFooter(); }
  // wantTab = 열면서 특정 상단탭으로 진입('inv'|'craft'|'ship'). 없으면 마지막 탭 유지(기존 I키 동작 그대로).
  //   ★settlement.js 대장간 건물 [E] → open('craft') (감사 B4 장소화). 잘못된 키는 무시(방어).
  function openInv(wantTab){
    if(wantTab && TOP_TABS.some(t=>t.key===wantTab) && topTab!==wantTab){ topTab=wantTab; selId=null; }
    open=true; panel.classList.add('open'); render(); if(document.exitPointerLock) document.exitPointerLock(); }
  function close(){ open=false; panel.classList.remove('open'); cvStop(); cvShipStop(); }   // 인벤 닫으면 3D 렌더루프(캐릭터·배) 정지(성능)

  panel.querySelector('#iv_close').onclick=close;
  panel.addEventListener('click',e=>{ if(e.target===panel) close(); });
  addEventListener('keydown', e=>{ if(e.code==='KeyI' && document.pointerLockElement===ctx.renderer.domElement && !open) openInv();
    else if((e.code==='KeyI'||e.code==='Escape') && open) close(); });
  buildTabs(); buildSubTabs();
  // 아이콘 미리 렌더(열기 전 백그라운드 캐시 — 열었을 때 즉시 표시)
  Object.keys(ICON_MODELS).forEach(id=>renderIcon(id));
  // 🛠️ 도구 아이콘(퀵슬롯) = 준비되면 핫바 갱신(이모지→GLB 썸네일 교체)
  ['pickaxe','axe','torch','hammer'].forEach(id=>{ const r=renderIcon(id); if(r&&r.then) r.then(u=>{ if(u&&ctx.updHotbar) ctx.updHotbar(); }); });

  // icon(id) = 렌더된 아이콘 dataURL(준비됐으면) — player.js 퀵슬롯 핫바가 사용. toast = 공용 알림.
  // craftBuild(id) = 퀵슬롯에서 보유 0일 때 호출 → 그 부품 1개 제작 큐에 추가(게이지 진행 → 인벤 누적).
  ctx.invui={ open:openInv, close, isOpen:()=>open, render, toast,
    icon:id=>{ const v=_iconCache[id]; return (typeof v==='string')?v:null; },
    craftBuild:id=>{ const rc=CRAFTABLES.find(r=>r.id===id && r.build); if(rc){ enqueue(rc); toast(`${rc.name} 제작 중…`); } } };
  console.log('[invui] 인벤+제작 통합 — BotW식(게임화면 블러 위 반투명 박스) · 탭3(재료/화물/제작) · 레시피(대포·강철·청동).');
  return ctx.invui;
}
