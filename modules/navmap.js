// navmap.js — ① 우상단 원형 미니맵(기존) + ② M키 "맵 교역창"(전체완성본 맵(교역).png 재현).
//   ★맵 교역창 = 월드맵 전략 오버레이: 해도 배경(map.png) 위에 영토색·항로·섬 스프라이트·마커
//     + 섬정보 패널(좌상) · 시즌/영토/랭크 패널(우상) · 레전드(좌하) · 독바(하단) · 나침반/줌(우하) · 금화(좌하).
//   데이터: worldmap.canon.json(203섬·항로·스폰) + economy(시세·NPC상선·영토). 3D 씬과 독립(전략 레이어).
//   레퍼런스: voyage/애셋/전체완성본 맵(교역).png. UI 자산: voyage/ui/*.png (애셋에서 복사).
//   game.html 호환: initNavMap export 유지(미니맵). 샌드박스 ?sys=navmap = initNavmap 별칭.
import * as THREE from 'three';
import { filterCanonIslands } from './islands.js';   // 🧭 R6 — worldstream과 동일 필터 공유(지도엔 있는데 실제론 없는 섬 방지, 사령관 2026-07-09)

// ── UI 자산 경로(voyage/ui/) ──
const UI = '/ui/';
const ASSET = (n)=> UI + n;
const IMG_LIST = {
  bg:ASSET('map_bg.png'), fog:ASSET('map_fog.png'),
  legend:ASSET('legend_a.png'), dock:ASSET('dock_a.png'),
  zin:ASSET('btn_zoomin_a.png'), zout:ASSET('btn_zoomout_a.png'), locate:ASSET('btn_locate_a.png'), close:ASSET('btn_close_a.png'),
  panelTall:ASSET('panel_tall_a.png'), panelWide:ASSET('panel_wide_a.png'), shield:ASSET('shield_a.png'),
  isleLarge:ASSET('isle_large_a.png'), isleMid:ASSET('isle_mid_a.png'), isleSmall:ASSET('isle_small_a.png'), isleIce:ASSET('isle_ice_a.png'),
  shipYou:ASSET('ship_you_a.png'), shipPlayer:ASSET('ship_player_a.png'), harbor:ASSET('harbor_a.png'),
  flagYou:ASSET('flag_you_a.png'), flagEnemy:ASSET('flag_enemy_a.png'), flagNeutral:ASSET('flag_neutral_a.png'),
  ring:ASSET('ring_a.png'), portMajor:ASSET('port_major_a.png'),
};

// 티어→스프라이트 키 + 프리렌더 박스 px(섬 점 크기). 얼음은 소형 스프라이트를 청록 틴트.
// 소형=초록 섬 스케일다운(09_57_1 석호는 흰사각형으로 읽혀 제외). 얼음=전용 얼음섬 애셋.
const TIER_SPR = { large:'isleLarge', mid:'isleMid', small:'isleMid', ice:'isleIce' };
const TIER_PX  = { large:136, mid:104, small:76, ice:80 };

// ── 섬 다이아몬드 마커(발할라 World맵 톤 — 영토색 심볼, "이미지 느낌" 제거) ──
//   회전 사각(◆) + 발광 + 흰 외곽선. 영토색(내=시안/적=레드/중립=회청). 줌 무관 고정 크기.
// 젤다/발할라 톤 — 작은 고정 다이아 심볼(속 빈 외곽 + 십자 + 발광 + 중앙점). 짜치지 않게 작게.
//   크기 가늠 = 티어 차등(대형>중형>소형) + 선택 시 강조(별도). 줌 무관 일정.
function drawIsleMarker(g, cx, cy, tier, col, sz){
  const r = tier==='large'?13 : tier==='mid'?10 : tier==='ice'?9 : 9;
  const dia=(rad)=>{ g.beginPath(); g.moveTo(cx,cy-rad); g.lineTo(cx+rad,cy); g.lineTo(cx,cy+rad); g.lineTo(cx-rad,cy); g.closePath(); };
  g.save();
  // 은은한 채움 + 발광(속을 살짝만 — 문양은 외곽선 위주)
  g.shadowColor=col; g.shadowBlur=Math.max(8, r*0.45);
  dia(r); g.globalAlpha=0.22; g.fillStyle=col; g.fill(); g.globalAlpha=1;
  // 굵은 외곽 다이아(문양 본체) — 두께도 크기 비례
  g.lineJoin='round'; g.lineWidth=Math.max(2, r*0.13); g.strokeStyle=col; dia(r); g.stroke();
  g.restore();
  // 내부 십자(+) 문양 — 발할라 퀘스트 마커
  g.lineCap='round'; g.lineWidth=1.5; g.strokeStyle=col;
  g.beginPath(); g.moveTo(cx,cy-r*0.52); g.lineTo(cx,cy+r*0.52); g.moveTo(cx-r*0.52,cy); g.lineTo(cx+r*0.52,cy); g.stroke();
  // 중앙 흰점
  g.beginPath(); g.arc(cx,cy,Math.max(1.4,r*0.13),0,7); g.fillStyle='#fff'; g.fill();
  // 대형 = 외곽 한 겹 더(거대항 위계)
  if(tier==='large'){ g.lineWidth=1; g.strokeStyle=col; dia(r*1.32); g.stroke(); }
}

// 플레이어/내 배 방향 화살촉 — 발할라 톤(시안 채움 + 흰 외곽 + 발광). headRad: 0=북(위), 시계방향.
function drawPlayerArrow(g, cx, cy, headRad, size){
  g.save(); g.translate(cx,cy); g.rotate(headRad||0);
  g.beginPath(); g.moveTo(0,-size); g.lineTo(size*0.64,size*0.72); g.lineTo(0,size*0.34); g.lineTo(-size*0.64,size*0.72); g.closePath();
  g.shadowColor='rgba(70,200,235,.85)'; g.shadowBlur=9; g.fillStyle='#46cfe6'; g.fill();
  g.shadowBlur=0; g.lineJoin='round'; g.lineWidth=1.6; g.strokeStyle='#eafcff'; g.stroke();
  g.restore();
}

// 영토색(진영별): 내 영토=시안 / 남은자=적 / 파수꾼=청 / 중립부족=회녹 / 무소유(대형·얼음)=회청.
//   ★맵 전용 색 — 전략맵에선 남은자(습격세력)=적색. 부족 gem색(tribes FCOL)과 별개(그건 3D 깃발/문양용).
const TERR = { you:'#36d6e0', remnant:'#e0533a', watch:'#5b8fd8', tneutral:'#7fae90', neutral:'#7d93a6', enemy:'#e0533a' };

function loadImg(src){ return new Promise(res=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; }); }

// ── SVG 아이콘 세트(퍼블리싱 — 이미지 따넣지 않고 코드로) ──
const ICON={
  plus:'<path d="M12 6v12M6 12h12"/>', minus:'<path d="M6 12h12"/>',
  locate:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3.6M12 17.9v3.6M2.5 12h3.6M17.9 12h3.6"/>',
  close:'<path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4"/>',
  filters:'<path d="M4 7h8M16 7h4M4 12h4M12 12h8M4 17h11M19 17h1"/><circle cx="14" cy="7" r="2.1"/><circle cx="10" cy="12" r="2.1"/><circle cx="17" cy="17" r="2.1"/>',
  flag:'<path d="M6 21V4M6 4h10.5l-2 3.6 2 3.6H6"/>',
  routes:'<circle cx="5.5" cy="6.5" r="2.1"/><circle cx="18.5" cy="17.5" r="2.1"/><circle cx="17" cy="6.5" r="1.7"/><path d="M7.3 7.6l9 8.4M7.4 6.6 15 6.5"/>',
  ship:'<path d="M3.5 14h17l-2.4 5H5.9zM12 3.2v8.6M12 6l5.2 4.2M12 6 6.8 10.2"/>',
  anchor:'<circle cx="12" cy="4.6" r="2.1"/><path d="M12 6.7V20M5.4 13a6.6 6.6 0 0 0 13.2 0M3.8 13h3.1M17.1 13h3.1"/>',
  crown:'<path d="M3 18.6h18M4 18 5.7 8.6l4.1 4.3L12 6l2.2 6.9 4.1-4.3L20 18"/>',
  lock:'<rect x="5.4" y="10.4" width="13.2" height="9.2" rx="2.2"/><path d="M8.4 10.4V7a3.6 3.6 0 0 1 7.2 0v3.4"/>',
  shield:'<path d="M12 2.4 20 5.3v6.3c0 5.1-3.7 8.4-8 11-4.3-2.6-8-5.9-8-11V5.3z"/>',
  swords:'<path d="M5 5l8.5 8.5M14.5 14.5 19 19M19 5l-8.5 8.5M9.5 14.5 5 19"/>',
  hammer:'<path d="M13.5 5 19 10.5M16 7.5 8 15.5l-3.5 3.5-2-2L6 13.5 14 5.5"/>',
  cargo:'<path d="M3.5 8 12 3.5 20.5 8 12 12.5zM3.5 8v8L12 20.5 20.5 16V8M12 12.5V20"/>',
  star:'<path d="M12 3.2l2.5 5.6 6 .6-4.5 4 1.3 6L12 16.8 6.7 19.4 8 13.4l-4.5-4 6-.6z"/>',
};
const SVG=(name,attr='')=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${attr}>${ICON[name]||''}</svg>`;
const DIAMOND=(c)=>`<svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12z" fill="${c}" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/></svg>`;
const SVG2=(name)=>`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:.85">${ICON[name]||''}</svg>`;

// ── 디자인 시스템(완성본 톤: 다크 틸 글래스 + 시안 액센트) ──
const NM_CSS=`
.nm-root *{box-sizing:border-box;margin:0}
.nm-card{position:absolute;background:linear-gradient(168deg,rgba(12,28,42,.93),rgba(6,15,25,.95));border:1px solid rgba(84,170,205,.30);border-radius:15px;box-shadow:0 16px 48px rgba(0,0,0,.5),inset 0 1px 0 rgba(135,210,245,.14);backdrop-filter:blur(16px);pointer-events:auto;color:#cfe0f0;overflow:hidden}
.nm-card::before{content:'';position:absolute;left:16px;right:16px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(95,215,245,.75),transparent)}
.nm-lbl{font:600 10px/1 system-ui;letter-spacing:.16em;color:#6f8a9e;text-transform:uppercase}
.nm-div{height:1px;background:linear-gradient(90deg,rgba(64,116,142,.55),rgba(64,116,142,.04));margin:12px 0}
.nm-row{display:flex;align-items:center;gap:8px}
.nm-ico{display:inline-flex;color:#7fc4e0}.nm-ico svg{width:16px;height:16px;display:block}
/* 버튼 */
.nm-btn{width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 36% 28%,rgba(30,70,96,.95),rgba(7,18,28,.97));border:1px solid rgba(95,200,235,.45);box-shadow:0 5px 16px rgba(0,0,0,.5),inset 0 1px 2px rgba(135,215,245,.28);color:#bfe9ff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.14s;pointer-events:auto}
.nm-btn:hover{border-color:#5ee0ff;box-shadow:0 0 18px rgba(70,210,245,.55),inset 0 1px 3px rgba(135,215,245,.5);color:#f0ffff}
.nm-btn svg{width:21px;height:21px}
.nm-close{position:absolute;right:16px;top:16px;width:34px;height:34px;z-index:5}
.nm-close svg{width:15px;height:15px}
/* 독바 */
.nm-dock{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);display:flex;gap:6px;padding:8px 10px;background:linear-gradient(168deg,rgba(12,28,42,.95),rgba(6,15,25,.96));border:1px solid rgba(84,170,205,.30);border-radius:16px;box-shadow:0 14px 40px rgba(0,0,0,.5),inset 0 1px 0 rgba(135,210,245,.14);backdrop-filter:blur(16px);pointer-events:auto}
.nm-di{display:flex;flex-direction:column;align-items:center;gap:5px;width:70px;padding:9px 0 7px;border-radius:11px;cursor:pointer;color:#7a93a4;transition:.14s}
.nm-di svg{width:22px;height:22px}.nm-di span{font:600 11px/1 system-ui}
.nm-di:hover{color:#dff4ff;background:rgba(60,140,180,.12)}
.nm-di.on{color:#bfeaff;background:linear-gradient(180deg,rgba(45,130,170,.32),rgba(45,130,170,.06));box-shadow:inset 0 0 0 1px rgba(95,200,235,.3)}
/* 레전드 */
.nm-leg{display:flex;flex-direction:column;gap:1px}
.nm-leg .nm-lbl{margin:8px 0 3px}.nm-leg .nm-lbl:first-child{margin-top:0}
.nm-lr{display:flex;align-items:center;gap:8px;font:11px/1 system-ui;color:#b3c4d2;padding:1.5px 0}
.nm-lr svg{width:14px;height:14px}
.nm-sw{width:13px;height:13px;border-radius:3px;flex:none;box-shadow:0 0 5px rgba(0,0,0,.4)}
.nm-line{width:18px;height:0;border-top:2px;flex:none}
/* 줌/나침반 컨트롤 */
.nm-ctl{position:absolute;right:22px;bottom:24px;display:flex;flex-direction:column;align-items:center;gap:11px;pointer-events:auto}
.nm-compass{filter:drop-shadow(0 4px 10px rgba(0,0,0,.5))}
/* 텍스트 */
.nm-h{font:700 16px/1.2 system-ui;color:#eaf4ff}
.nm-sub{font:11px/1.3 system-ui;color:#8fb0c2}
.nm-mut{color:#7d97ab}
.nm-val{font:700 13px ui-monospace,monospace;color:#eaf4ff}
.nm-bar{height:6px;background:rgba(15,32,44,.9);border-radius:4px;overflow:hidden}
.nm-bar>i{display:block;height:100%;border-radius:4px}
`;

// ── 미니맵 탑다운 텍스처 프리렌더 ──────────────────────────────────
//   섬 메시(isleMeshes+groundMeshes)를 OrthographicCamera로 위에서 1회 RT 렌더 → 오프스크린 캔버스.
//   layer 격리(섬+조명만 LAYER 7) + scene.background/fog 임시 off → 물=투명·섬=실제 지형색. readPixels y반전 보정.
//   반환 { canvas, cx, cz, RR(월드 반경), SIZE } / 실패 null.
function buildMiniTex(ctx){
  try{
    const R=ctx.renderer, scene=ctx.scene, e=ctx.environment;
    const SIZE=512, RR=(e.ISLE_R||300)*1.3, cx=e.SPAWN.x, cz=e.SPAWN.z, LAYER=7;
    const objs=[...(e.isleMeshes||[]), ...(e.groundMeshes||[])];
    const lights=[ctx.sun, ctx.hemi, ctx.amb, ctx.fill].filter(Boolean);
    if(!objs.length) return null;
    objs.forEach(o=> o.traverse && o.traverse(ch=>ch.layers.enable(LAYER)));
    lights.forEach(l=> l.layers.enable(LAYER));
    const cam=new THREE.OrthographicCamera(-RR,RR,RR,-RR,1,4000);
    cam.position.set(cx,2000,cz); cam.up.set(0,0,-1); cam.lookAt(cx,0,cz); cam.layers.set(LAYER);
    const rt=new THREE.WebGLRenderTarget(SIZE,SIZE);
    const oRT=R.getRenderTarget(), oC=R.getClearColor(new THREE.Color()), oA=R.getClearAlpha();
    const oBg=scene.background, oFog=scene.fog; scene.background=null; scene.fog=null;
    R.setRenderTarget(rt); R.setClearColor(0x000000,0); R.clear(); R.render(scene,cam);
    const buf=new Uint8Array(SIZE*SIZE*4); R.readRenderTargetPixels(rt,0,0,SIZE,SIZE,buf);
    R.setRenderTarget(oRT); R.setClearColor(oC,oA); scene.background=oBg; scene.fog=oFog;
    objs.forEach(o=> o.traverse && o.traverse(ch=>ch.layers.disable(LAYER)));
    lights.forEach(l=> l.layers.disable(LAYER));
    rt.dispose();
    // WebGL bottom-up → 캔버스 top-down 뒤집기 (위=북=-z)
    const cv=document.createElement('canvas'); cv.width=cv.height=SIZE;
    const g=cv.getContext('2d'); const img=g.createImageData(SIZE,SIZE);
    for(let y=0;y<SIZE;y++){ const sy=SIZE-1-y; for(let x=0;x<SIZE;x++){ const s=(sy*SIZE+x)*4, d=(y*SIZE+x)*4;
      img.data[d]=buf[s]; img.data[d+1]=buf[s+1]; img.data[d+2]=buf[s+2]; img.data[d+3]=buf[s+3]; } }
    g.putImageData(img,0,0);
    return { canvas:cv, cx, cz, RR, SIZE };
  }catch(err){ console.warn('[navmap] miniTex 실패', err); return null; }
}

// ★버그수정(2026-07-13 밤, "섬 이미지가 실제 크기랑 다름·잘리는 곳 있음"): 캡처 반경(_captureVisibleTex)과
//   그릴 때 쓰는 폭(아래 _drawIslands visitedTex 분기)이 서로 다른 배율(1.35 vs 2.6/2=1.3)을 써서 어긋났고,
//   그 여유폭도 실제 섬 메시 발치(canon r은 논리값이라 실제 지형 외곽과 다를 수 있음)를 못 덮어 잘렸었음.
//   캡처·드로우 두 곳 다 이 상수 하나로 통일(여유도 넉넉히 키움).
const VISIT_TEX_MARGIN = 1.8;   // 반경 배율(half-width) — 캡처 RR과 드로우 w가 반드시 같은 배율을 써야 함
// ── M맵 방문 섬 실제 텍스처(2026-07-13, 사령관 확정: 홈섬처럼 방문한 섬도 실제 렌더로) ──
//   buildMiniTex와 동일 원리(탑다운 RT 1회) but 임의 월드좌표(cx,cz)·임의 메시(group/trees) 파라미터화.
//   worldstream이 로드해둔 섬 group을 그대로 찍는다 — 홈섬 전용 buildMiniTex는 건드리지 않음(회귀 위험 최소화).
function buildIsleTexFromGroup(ctx, group, trees, cx, cz, RR, SIZE=256){
  try{
    const R=ctx.renderer, scene=ctx.scene, LAYER=7;
    const objs=[group, trees].filter(Boolean);
    const lights=[ctx.sun, ctx.hemi, ctx.amb, ctx.fill].filter(Boolean);
    if(!objs.length) return null;
    objs.forEach(o=> o.traverse && o.traverse(ch=>ch.layers.enable(LAYER)));
    lights.forEach(l=> l.layers.enable(LAYER));
    const cam=new THREE.OrthographicCamera(-RR,RR,RR,-RR,1,4000);
    cam.position.set(cx,2000,cz); cam.up.set(0,0,-1); cam.lookAt(cx,0,cz); cam.layers.set(LAYER);
    const rt=new THREE.WebGLRenderTarget(SIZE,SIZE);
    const oRT=R.getRenderTarget(), oC=R.getClearColor(new THREE.Color()), oA=R.getClearAlpha();
    const oBg=scene.background, oFog=scene.fog; scene.background=null; scene.fog=null;
    R.setRenderTarget(rt); R.setClearColor(0x000000,0); R.clear(); R.render(scene,cam);
    const buf=new Uint8Array(SIZE*SIZE*4); R.readRenderTargetPixels(rt,0,0,SIZE,SIZE,buf);
    R.setRenderTarget(oRT); R.setClearColor(oC,oA); scene.background=oBg; scene.fog=oFog;
    objs.forEach(o=> o.traverse && o.traverse(ch=>ch.layers.disable(LAYER)));
    lights.forEach(l=> l.layers.disable(LAYER));
    rt.dispose();
    const cv=document.createElement('canvas'); cv.width=cv.height=SIZE;
    const g=cv.getContext('2d'); const img=g.createImageData(SIZE,SIZE);
    for(let y=0;y<SIZE;y++){ const sy=SIZE-1-y; for(let x=0;x<SIZE;x++){ const s=(sy*SIZE+x)*4, d=(y*SIZE+x)*4;
      img.data[d]=buf[s]; img.data[d+1]=buf[s+1]; img.data[d+2]=buf[s+2]; img.data[d+3]=buf[s+3]; } }
    g.putImageData(img,0,0);
    return { canvas:cv, cx, cz, RR, SIZE };
  }catch(err){ console.warn('[navmap] isleTex 실패', err); return null; }
}

export function initNavMap(ctx){
  // ══════════════════ ① 미니맵(기존 유지 — game.html 호환) ══════════════════
  const wrap=document.createElement('div'); wrap.style.cssText='position:fixed;right:14px;top:14px;width:210px;height:210px;z-index:6;pointer-events:none';
  document.body.appendChild(wrap);
  const mini=document.createElement('canvas'); mini.width=mini.height=204;
  mini.style.cssText='position:absolute;left:3px;top:3px;width:204px;height:204px;border-radius:50%;box-shadow:0 0 0 3px rgba(20,40,60,.6),0 4px 14px rgba(0,0,0,.5)';
  wrap.appendChild(mini); const mg=mini.getContext('2d');
  // ★플레이어 방향 화살촉(레퍼런스 발할라 톤 — 시안 채움 + 흰 외곽). heading은 transform rotate.
  const parrow=document.createElement('div'); parrow.style.cssText='position:absolute;left:50%;top:50%;width:22px;height:24px;margin:-12px 0 0 -11px;transform-origin:50% 50%;filter:drop-shadow(0 0 3px rgba(0,0,0,.85));pointer-events:none;z-index:2';
  parrow.innerHTML='<svg width="22" height="24" viewBox="0 0 22 24"><path d="M11 1 L19 21 L11 16 L3 21 Z" fill="#46cfe6" stroke="#eafcff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  wrap.appendChild(parrow);
  const hint=document.createElement('div'); hint.textContent='M 전체지도'; hint.style.cssText='position:absolute;left:50%;bottom:-20px;transform:translateX(-50%);color:#9fe;font:11px ui-monospace;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none'; wrap.appendChild(hint);

  // 섬 탑다운 텍스처(lazy build — environment 준비 후 1회). null=미시도 / false=실패.
  let MM=null;
  function ensureMM(){ if(MM!==null) return; const e=ctx.environment;
    if(!e||!e.isleMeshes||!e.SPAWN) return;   // 아직 준비 안 됨 → 다음 프레임 재시도
    MM = buildMiniTex(ctx) || false; ctx._miniTex = MM; }   // ★M 전체맵과 공유(home 섬 실렌더)

  // ⛏️2026-07-22 던전 미니맵 (사령관 "미니맵도 던전 안에서 뜨게 해야지")
  //   던전은 오버월드에서 +380/+240m 떨어진 상공에 지어지므로 섬 미니맵으론 아무것도 안 나온다(바다만 보임).
  //   ⇒ 던전 안에선 **격자(__dgGrid)를 직접 그린다**. 방=밝은 칸 · 복도=어두운 칸 · 계단실=파란 칸.
  //   깊이(지상/지하)로 색을 갈라 지금 어느 층인지 한눈에 보이게 한다.
  // ⛏️던전 실제 지형을 **위에서 정사영으로 한 번 구워** 텍스처로 만든다(섬 미니맵 isleTex와 같은 방식).
  //   사령관 "실제 불러줘, 맵 형태를 그리지 말고" — 격자를 도형으로 그리던 걸 실제 렌더로 교체.
  //   ⚠️천장을 켜둔 채 위에서 보면 천장만 찍힌다 → 굽는 동안만 천장(_ceil)을 숨긴다.
  let DGTEX = null, _dgTexKey = null;
  function dungeonTex(){
    try{
      const M = ctx.__dgGrid, root = ctx.__dgRoot; if(!M || !root) return null;
      const key = M.cx + ',' + M.cz + ',' + M.G;
      if(DGTEX && _dgTexKey === key) return DGTEX;
      const RR = M.G * M.CELL * 0.5, SIZE = 1024, LAYER = 7;
      const hidden = [];
      root.traverse(o => { if(o.userData && o.userData._ceil && o.visible){ o.visible = false; hidden.push(o); } });
      root.traverse(o => o.layers.enable(LAYER));
      const lights = [];
      { const A = new THREE.AmbientLight(0xffffff, 2.6); A.layers.set(LAYER); ctx.scene.add(A); lights.push(A);
        const D = new THREE.DirectionalLight(0xffffff, 1.2); D.position.set(0.4, 1, 0.25); D.layers.set(LAYER); ctx.scene.add(D); lights.push(D); }
      const cam = new THREE.OrthographicCamera(-RR, RR, RR, -RR, 1, 4000);
      cam.position.set(M.cx, M.cy + 900, M.cz); cam.up.set(0, 0, -1); cam.lookAt(M.cx, M.cy, M.cz); cam.layers.set(LAYER);
      const R = ctx.renderer, rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
      const oRT = R.getRenderTarget(), oC = R.getClearColor(new THREE.Color()), oA = R.getClearAlpha();
      const oBg = ctx.scene.background, oFog = ctx.scene.fog; ctx.scene.background = null; ctx.scene.fog = null;
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(ctx.scene, cam);
      const buf = new Uint8Array(SIZE*SIZE*4); R.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
      R.setRenderTarget(oRT); R.setClearColor(oC, oA); ctx.scene.background = oBg; ctx.scene.fog = oFog;
      root.traverse(o => o.layers.disable(LAYER));
      for(const l of lights) ctx.scene.remove(l);
      for(const o of hidden) o.visible = true;
      rt.dispose();
      const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
      const g = cv.getContext('2d'), img = g.createImageData(SIZE, SIZE);
      for(let y=0;y<SIZE;y++){ const sy=SIZE-1-y; for(let x=0;x<SIZE;x++){ const a=(sy*SIZE+x)*4, d=(y*SIZE+x)*4;
        img.data[d]=buf[a]; img.data[d+1]=buf[a+1]; img.data[d+2]=buf[a+2]; img.data[d+3]=buf[a+3]; } }
      g.putImageData(img, 0, 0);
      DGTEX = { canvas: cv, cx: M.cx, cz: M.cz, RR, SIZE }; _dgTexKey = key;
      console.log('[navmap] 던전 미니맵 텍스처 구움 — 반경 ' + RR.toFixed(0) + 'm');
      return DGTEX;
    }catch(e){ console.warn('[navmap] 던전 텍스처 실패', e); return null; }
  }

  function drawMiniDungeon(){
    const W=204, cx=102, cy=102, Rad=100;
    const M = ctx.__dgGrid; if(!M) return false;
    const T = dungeonTex(); if(!T) return false;
    const pp = ctx.player ? ctx.player.pos : {x:0,y:0,z:0};
    const RANGE = 26;                                    // ★확대 — 반경 26m면 방 하나가 화면을 채운다(사령관 "그 방만 보이게")
    const sc = Rad / RANGE;
    const yaw = (ctx.player && ctx.player.yaw) || 0;     // ★캐릭터가 보는 방향이 항상 위(헤딩업)
    mg.clearRect(0,0,W,W); mg.save(); mg.beginPath(); mg.arc(cx,cy,Rad,0,7); mg.clip();
    mg.fillStyle='#07090d'; mg.fillRect(0,0,W,W);
    mg.translate(cx,cy);
    mg.rotate(yaw);                                      // 월드를 반대로 돌려 = 내가 보는 쪽이 위
    // 실제 던전 렌더 텍스처를 플레이어 중심으로 확대해서 얹는다
    { const tpm = T.SIZE/(2*T.RR), s2 = sc/tpm;
      const ux = (pp.x-(T.cx-T.RR))*tpm, uy = (pp.z-(T.cz-T.RR))*tpm;
      mg.save(); mg.scale(s2,s2); mg.imageSmoothingEnabled=true; mg.drawImage(T.canvas, -ux, -uy); mg.restore(); }
    // 특수 방 표식(보스/레버/보물/대전당)은 회전된 좌표계 위에 그대로 얹는다
    for(const r of (M.rooms||[])){
      const wx = M.cx + (r.cx+0.5-M.G/2)*M.CELL, wz = M.cz + (r.cz+0.5-M.G/2)*M.CELL;
      const ax=(wx-pp.x)*sc, ay=(wz-pp.z)*sc; if(ax*ax+ay*ay > Rad*Rad) continue;
      const col = r.role==='boss' ? '#e8503a' : (r.role==='deadend' ? '#ffcf5a'
                : (/treasure/.test(r.role) ? '#ffe28a' : (r.role==='grandhall' ? '#8fe0f0' : null)));
      if(!col) continue;
      mg.fillStyle=col; mg.beginPath(); mg.arc(ax,ay,3.2,0,7); mg.fill();
    }
    mg.restore();
    // 플레이어는 회전 밖에서 — 헤딩업이라 항상 위를 향한 고정 화살표
    mg.save(); mg.translate(cx,cy); drawPlayerArrow(mg, 0, 0, 0, 8); mg.restore();
    mg.fillStyle='rgba(180,210,235,.9)'; mg.font='bold 11px system-ui'; mg.textAlign='center';
    mg.fillText((pp.y - M.cy) < -6 ? '지하' : '지상', cx, 19);
    return true;
  }

  function drawMini(){ ensureMM();
    if(ctx.dungeon && ctx.dungeon.active && drawMiniDungeon()) return;   // ⛏️던전 안 = 전용 미니맵
    const W=204,cx=102,cy=102,Rad=100, RANGE=600, sc=Rad/RANGE;   // ★RANGE↑(200→600): 근처 스트리밍 섬이 미니맵에 들어오게
    mg.clearRect(0,0,W,W); mg.save(); mg.beginPath(); mg.arc(cx,cy,Rad,0,7); mg.clip();
    mg.fillStyle='#0c2331'; mg.fillRect(0,0,W,W);            // 바다 배경
    const pp=ctx.player?ctx.player.pos:{x:0,y:0,z:0}; mg.translate(cx,cy);
    // 섬 텍스처 — 플레이어 중심. 텍스처 위=북(-z) / 미니맵도 -(z-pz)로 북이 위(노스업).
    if(MM){ const tpm=MM.SIZE/(2*MM.RR), s=sc/tpm;
      const ux=(pp.x-(MM.cx-MM.RR))*tpm, uy=(pp.z-(MM.cz-MM.RR))*tpm;
      mg.save(); mg.scale(s,s); mg.imageSmoothingEnabled=true; mg.drawImage(MM.canvas, -ux, -uy); mg.restore(); }
    const inR=(ax,ay)=> ax*ax+ay*ay <= Rad*Rad;
    const e=ctx.environment;
    if(e){
      // 나무(진녹 점)
      if(e.TREES) { mg.fillStyle='#3e7d39'; for(const t of e.TREES){ const p=t.obj&&t.obj.position; if(!p)continue;
        const ax=(p.x-pp.x)*sc, ay=(p.z-pp.z)*sc; if(!inR(ax,ay))continue; mg.beginPath(); mg.arc(ax,ay,1.7,0,7); mg.fill(); } }
      // 광물(금빛 점 + 외곽)
      if(e.ORE_NODES) for(const o of e.ORE_NODES){ const p=o.position||o; const ax=(p.x-pp.x)*sc, ay=(p.z-pp.z)*sc; if(!inR(ax,ay))continue;
        mg.fillStyle='#f0b53a'; mg.beginPath(); mg.arc(ax,ay,2.3,0,7); mg.fill(); mg.lineWidth=0.7; mg.strokeStyle='rgba(0,0,0,.55)'; mg.stroke(); }
    }
    // 🏝 근처 스트리밍 섬 — 링 안=실좌표 다이아(방문해 실텍스처 캐시된 섬은 실제 지형 렌더) / 링 밖=림에 방향 블립(진영색).
    const ws=ctx.worldstream;
    if(ws&&ws.islands){ const WS=ws.WORLD_SCALE||1.5, texCache=ctx._isleTexCache;
      for(const isle of ws.islands){
        // ★2026-07-13 밤(사령관 "미니맵엔 보이지도 않음"): M맵에서만 쓰던 방문 섬 실텍스처(_isleTexCache)를
        //   미니맵에도 적용. 텍스처 자체 실측 cx/cz/RR(월드좌표) 기준 — isle.x/z(캐논)와 어긋날 수 있어 안 씀.
        const tex = texCache && texCache.get(isle.id);
        if(tex){
          const tax=(tex.cx-pp.x)*sc, tay=(tex.cz-pp.z)*sc;
          if(Math.hypot(tax,tay) > Rad+40) continue;   // 화면 훨씬 밖이면 생략(성능)
          const wpx=Math.max(6, tex.RR*2*sc);
          mg.drawImage(tex.canvas, tax-wpx/2, tay-wpx/2, wpx, wpx);
          continue;
        }
        const ax=(isle.x*WS-pp.x)*sc, ay=(isle.z*WS-pp.z)*sc;
        const rr=Math.hypot(ax,ay); if(rr<6||rr>Rad*5) continue;                        // 발밑 섬/너무 먼 섬 생략
        const t=ctx.tribes&&ctx.tribes.tribeById&&ws.islandTribe&&ctx.tribes.tribeById(ws.islandTribe(isle));
        const col=(t&&t.gem)||'#7d93a6'; const rim=rr>Rad-7;
        let x=ax,y=ay; if(rim){ const k=(Rad-7)/rr; x=ax*k; y=ay*k; }                    // 림 클램프(방향 블립)
        const s=rim?2.3:3.2;
        mg.save(); mg.globalAlpha=rim?0.85:1;
        mg.beginPath(); mg.moveTo(x,y-s); mg.lineTo(x+s,y); mg.lineTo(x,y+s); mg.lineTo(x-s,y); mg.closePath();
        mg.fillStyle=col; mg.fill(); mg.lineWidth=0.7; mg.strokeStyle='rgba(0,0,0,.55)'; mg.stroke(); mg.restore(); }
    }
    // 내 배(연한 금색 사각)
    if(ctx.ship){ const ax=(ctx.ship.x-pp.x)*sc, ay=(ctx.ship.z-pp.z)*sc; if(inR(ax,ay)){ mg.fillStyle='#e8d5a0'; mg.fillRect(ax-2.5,ay-2.5,5,5); } }
    // 🏴 부족 거점(진영색 마름모) — 어느 종족이 점령한 섬인지
    if(ctx.outposts && ctx.tribes && ctx.tribes.tribeById) for(const o of ctx.outposts){ if(o.owner==='player') continue;
      const ax=(o.x-pp.x)*sc, ay=(o.z-pp.z)*sc; if(!inR(ax,ay))continue;
      const t=ctx.tribes.tribeById(o.tribe); const col=t?t.gem:'#b0a494';
      mg.fillStyle=col; mg.beginPath(); mg.moveTo(ax,ay-3.2); mg.lineTo(ax+2.6,ay); mg.lineTo(ax,ay+3.2); mg.lineTo(ax-2.6,ay); mg.closePath(); mg.fill();
      mg.lineWidth=0.6; mg.strokeStyle='rgba(0,0,0,.6)'; mg.stroke(); }
    // 점령 영토(적색)
    if(ctx.claimed) for(const cc of ctx.claimed){ const ax=(cc.x-pp.x)*sc, ay=(cc.z-pp.z)*sc; if(!inR(ax,ay))continue; mg.fillStyle='#e0533a'; mg.fillRect(ax-2,ay-2.5,4,7); }
    mg.restore();
    // 화살촉 방향 — 배 탑승 = 뱃머리(forward) 진행방향 / 도보 = 카메라가 보는 방위.
    let headDeg=0;
    const onShip = ctx.ship && ctx.player && (ctx.player.onShip===ctx.ship || ctx.ship.boarded);
    if(onShip && ctx.ship.forward){ const f=ctx.ship.forward; headDeg=Math.atan2(f.x,-f.z)*180/Math.PI; }
    else if(ctx.camera){ const d=ctx.camera.getWorldDirection(new THREE.Vector3()); headDeg=Math.atan2(d.x,-d.z)*180/Math.PI; }
    parrow.style.transform='rotate('+headDeg.toFixed(1)+'deg)';
  }
  let _t=0; ctx.onUpdate(dt=>{ _t+=dt; if(_t<0.12)return; _t=0; drawMini(); });

  // ══════════════════ ② 맵 교역창(M키) ══════════════════
  const W = new MapWindow(ctx);
  // ★포그 탐험 확장 — 맵이 닫혀 있어도 방문/스트리밍된 섬 id를 누적(0.4s 스로틀). 다음에 M 열면 공개돼 있음.
  let _vt=0; ctx.onUpdate(dt=>{ _vt+=dt; if(_vt<0.4) return; _vt=0; W._scanVisited(); W._captureVisibleTex(); });
  addEventListener('keydown',e=>{ if(e.code==='KeyM'){ W.toggle(); } else if(e.code==='Escape'&&W.open){ W.close(); } });

  ctx.navmap = { get open(){return W.open;}, toggle:()=>W.toggle(), open_:()=>W.show(), close:()=>W.close(),
    setQuestTarget:t=>{ W.questTarget=t?{...t}:null; if(W.open)W.draw(); },
    portalMarkers:()=>ctx.portals?.markers?.()||[], win:W };
  return ctx.navmap;
}
export { initNavMap as initNavmap };   // 샌드박스 ?sys=navmap 로더용 별칭

// ───────────────────────── 맵 교역창 클래스 ─────────────────────────
class MapWindow{
  constructor(ctx){
    this.ctx=ctx; this.open=false; this.ready=false; this.loading=false;
    this.img={}; this.spr={};            // 로드 이미지 / 프리렌더 섬 스프라이트
    this.data=null; this.econ=null;
    this.view={ cx:0, cz:0, scale:1 };
    this.questTarget=null;             // 온보딩 차원문 {x,z} 월드좌표
    this.sel=null;                       // 선택 섬
    this.layers={ territory:true, routes:true, ships:true };
    this.bounds=null;
    this._visited=new Set();   // ★방문/스트리밍된 섬 id 누적(포그 공개용). 맵 로드 전에도 onUpdate가 축적.
    this._buildDOM();
  }

  // ── 게임 위 오버레이 창(딤 배경으로 게임 비침) + 중앙 윈도우 프레임 ──
  _buildDOM(){
    const root=document.createElement('div'); this.root=root; root.className='nm-root';   // 딤 백드롭(게임 비침 = 인게임 창)
    root.style.cssText='position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;background:rgba(3,9,16,.55);backdrop-filter:blur(2px);font:13px system-ui,"Malgun Gothic",sans-serif;color:#cfe0f0;user-select:none';
    const st=document.createElement('style'); st.textContent=NM_CSS; root.appendChild(st);   // 퍼블리싱 디자인 시스템
    const win=document.createElement('div'); this.win=win;       // 중앙 윈도우(게임 맵 창)
    win.style.cssText='position:relative;width:90vw;height:88vh;max-width:1480px;max-height:940px;border-radius:16px;overflow:hidden;border:1px solid rgba(90,200,235,.5);box-shadow:0 18px 60px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.5),inset 0 0 60px rgba(20,80,120,.18)';
    root.appendChild(win);
    // 맵 캔버스(윈도우 채움)
    const cv=document.createElement('canvas'); this.cv=cv; this.g=cv.getContext('2d');
    cv.style.cssText='position:absolute;inset:0;cursor:grab;display:block';
    win.appendChild(cv);
    // 패널 레이어(애셋 이미지 위 정보 — 윈도우 기준 배치)
    const ov=document.createElement('div'); this.ov=ov; ov.style.cssText='position:absolute;inset:0;pointer-events:none';
    ov.innerHTML = this._panelsHTML();
    win.appendChild(ov);
    document.body.appendChild(root);

    // 상호작용(좌표는 캔버스 로컬)
    cv.addEventListener('mousedown', e=>this._down(e));
    addEventListener('mousemove', e=>this._move(e));
    addEventListener('mouseup', ()=>this._up());
    cv.addEventListener('wheel', e=>{ e.preventDefault(); const [lx,ly]=this._local(e); this._zoomAt(lx,ly, e.deltaY<0?1.16:1/1.16); }, {passive:false});
    cv.addEventListener('click', e=>this._click(e));
    addEventListener('resize', ()=>{ if(this.open){ this._resize(); this.draw(); } });
  }
  _local(e){ const r=this.cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; }
  get W(){ return this.cv.width; }  get H(){ return this.cv.height; }

  _panelsHTML(){
    return `
    <div id="nm-info" class="nm-card" style="left:18px;top:18px;width:256px;padding:18px"></div>
    <div id="nm-season" class="nm-card" style="right:18px;top:18px;width:264px;padding:17px 18px"></div>
    <div id="nm-legend" class="nm-card nm-leg" style="left:18px;bottom:62px;width:188px;padding:13px 15px"></div>
    <div id="nm-dock" class="nm-dock"></div>
    <div class="nm-ctl">
      <div id="nm-zin" class="nm-btn" title="확대">${SVG('plus')}</div>
      <div id="nm-zout" class="nm-btn" title="축소">${SVG('minus')}</div>
      <div id="nm-loc" class="nm-btn" title="내 위치">${SVG('locate')}</div>
    </div>
    <div id="nm-gold" style="position:absolute;left:20px;bottom:22px;display:flex;gap:18px;align-items:center;pointer-events:none"></div>
    <div id="nm-npc" class="nm-card" style="display:none;width:166px;padding:11px 13px;z-index:4;pointer-events:none"></div>
    <div id="nm-close" class="nm-btn nm-close" title="닫기 (M/ESC)">${SVG('close')}</div>
    <div id="nm-load" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9fe;font-size:16px;pointer-events:none">해도 로드 중…</div>`;
  }

  async toggle(){ this.open ? this.close() : this.show(); }
  close(){ this.open=false; this.root.style.display='none'; }

  async show(){
    this.open=true; document.exitPointerLock&&document.exitPointerLock();   // ★게임 마우스룩 락 해제 → 맵에서 마우스 자유
    this.root.style.display='flex'; this._resize();
    if(!this.ready){ if(!this.loading) await this._load(); }
    if(this.ready){ this._resize(); this._centerOnPlayer(); this.draw(); this._startAnim(); }   // ★열 때마다 내 섬 중심+적정 줌
  }

  // ── ⚓ 항구 위치 표시(사령관 2026-07-13): M맵에 항상 — 밝혀진 항구섬마다 항구/도킹 지점 마커 ──
  //   홈섬=실제 부둣가(ctx.wharf) · 내 점령섬=거점 좌표 · 그 외 항구섬(비얼음)=섬 id 해시 각도의 해안점(랜덤 아님·항상 같은 자리).
  _portPoint(isle){
    const ws=this.ctx.worldstream, WS=(ws&&ws.WORLD_SCALE)||1.5;
    const home=this._homeIsland&&this._homeIsland();
    if(home && isle.id===home.id && this.ctx.wharf && this.ctx.wharf.pos){
      return { x:this.ctx.wharf.pos.x/WS, z:this.ctx.wharf.pos.z/WS }; }
    if(Array.isArray(this.ctx.claimed)){ const wx=isle.x*WS, wz=isle.z*WS, rr=(isle.r||120)*WS*1.15;   // 내 점령섬 실좌표
      for(const c of this.ctx.claimed){ if(c && Math.hypot(c.x-wx,c.z-wz) < rr) return { x:c.x/WS, z:c.z/WS }; } }
    let h=2166136261>>>0; for(let i=0;i<isle.id.length;i++){ h^=isle.id.charCodeAt(i); h=Math.imul(h,16777619); }   // id 해시 → 안정된 해안 각도
    const ang=((h>>>0)%360)*Math.PI/180, rr=(isle.r||120)*0.82;
    return { x:isle.x+Math.cos(ang)*rr, z:isle.z+Math.sin(ang)*rr };
  }
  // 밝혀진(revealed) 항구섬(비얼음)마다 항구 마커 — M맵 열려있는 동안 항상 표시(포그 밖은 숨김).
  _drawPorts(g){
    const d=this.data; if(!d) return;
    const him=this.img.harbor, rev=this._revIds;
    for(const isle of d.islands){ if(isle.tier==='ice' || isle.hasPort===false) continue;
      if(rev && !rev.has(isle.id)) continue;   // 포그: 밝혀진 섬만(DEC-012)
      const p=this._portPoint(isle), px=this.X(p.x), py=this.Y(p.z);
      if(him){ const s=20; g.globalAlpha=0.96; g.drawImage(him, px-s/2, py-s*0.82, s, s); g.globalAlpha=1; }
      else { g.save(); g.shadowColor='#ffcf5a'; g.shadowBlur=5; g.fillStyle='#ffd66a'; g.beginPath(); g.arc(px,py,3.4,0,7); g.fill(); g.restore(); }
    }
  }

  // NPC 상선 진행 + 재그리기(살아있는 바다). 열려있을 때만.
  _startAnim(){ if(this._anim) return; let last=performance.now(), acc=0;
    const tick=(now)=>{ this._anim=requestAnimationFrame(tick);
      const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(!this.open||!this.ready) return;
      this._t=(this._t||0)+dt;
      // npc 동기화 시엔 npc.js 가 게임루프(ctx.onUpdate)에서 위치를 굴리므로 여기선 그리기만. 단독일 때만 자체 progress 애니.
      if(!this.useNpc && this.econ&&this.econ.merchants){ for(const m of this.econ.merchants){ m.progress+=m.speed*m.dir*dt*0.22;
        if(m.progress>=1){m.progress=1;m.dir=-1;} else if(m.progress<=0){m.progress=0;m.dir=1;} } }
      acc+=dt; if(acc>=0.08){ acc=0; this.draw(); } };
    this._anim=requestAnimationFrame(tick); }

  // ── 데이터 + 자산 로드(최초 1회) ──
  async _load(){
    this.loading=true;
    try{
      // 1) 정본 맵 + 경제
      const [res, bres] = await Promise.all([
        fetch('/worldmap.canon.json?t='+Date.now()),
        fetch('/voyage_islands_backup.json?t='+Date.now())
      ]);
      this.data = await res.json();
      // R6: worldstream(3D 렌더)과 동일 필터 적용 — 원본 203섬 그대로 쓰면 실제 게임엔 없는 섬(~106개)이 지도에 표시됨(사령관 2026-07-09)
      try{ const backup = await bres.json(); this.data.islands = filterCanonIslands(this.data.islands, backup.sessions); }
      catch(e){ console.warn('[navmap] 섬 필터 로드 실패 — 원본 목록 사용(실제 월드와 어긋날 수 있음)', e&&e.message); }
      try{ const ec = await import('./economy.js'); this.econ = ec.generateEconomy(this.data, { seed:this.data.seed||1 }); this.GOODS=ec.GOODS; }
      catch(e){ console.warn('[navmap] economy 로드 실패 — 영토/시세 없이 진행', e&&e.message); this.econ={territory:{},prices:{},merchants:[]}; this.GOODS=[]; }
      // ★3D npc 상선과 동기화 — npc.js 가 굴리는 실제 상선(같은 위치·실제 항해속도)을 읽어 그림. 없으면(sandbox 단독) economy 자체.
      this.useNpc = !!(this.ctx.npc && Array.isArray(this.ctx.npc.merchants) && this.ctx.npc.merchants.length);
      this.merchants = this.useNpc ? this.ctx.npc.merchants : this.econ.merchants;
      if(this.useNpc) console.log('[navmap] npc 상선 동기화 ON —', this.merchants.length, '척(실제 항해 위치/속도)');

      // 2) 이미지 자산
      const keys=Object.keys(IMG_LIST);
      const imgs=await Promise.all(keys.map(k=>loadImg(IMG_LIST[k])));
      keys.forEach((k,i)=> this.img[k]=imgs[i]);

      // 3) 섬 스프라이트 프리렌더 — ★PNG는 이미 흰배경 투명화(*_a.png, 플러드필). 바로 다운스케일.
      for(const tier of ['large','mid','small','ice']){
        const src=this.img[TIER_SPR[tier]]; if(!src) continue;
        const px=TIER_PX[tier], c=document.createElement('canvas'); c.width=c.height=px;
        const cg=c.getContext('2d'); cg.imageSmoothingQuality='high'; cg.drawImage(src,0,0,px,px);
        this.spr[tier]=c;
      }

      // 4) 영토 분류(실소유 연동, 2026-07-03): 데모 슬롯 폐기 → 실제 소유(내 점령섬 + worldstream 부족 점령).
      //   내 섬(ctx.claimed)=you / 중립 아닌 부족(남은자·파수꾼)=enemy / 그 외=neutral.
      //   islandFaction=id 해시(전 섬 계산 가능, 스트림 안 된 섬도 OK). ws 없으면(스트림 off) 내 섬 외 전부 중립.
      this.terrOf = (id)=>{ const t=this.data.islands.find(i=>i.id===id);
        if(!t || t.tier==='large' || t.tier==='ice') return 'neutral';
        const c=this.ctx, ws=c&&c.worldstream, WS=(ws&&ws.WORLD_SCALE)||1.5;
        if(c && Array.isArray(c.claimed)){ const wx=t.x*WS, wz=t.z*WS;   // 1) 내 점령섬(월드좌표) 근접 매칭 → you
          for(const cl of c.claimed){ if(cl && cl.owner==='player' && Math.hypot(cl.x-wx, cl.z-wz) < (t.r||120)+140) return 'you'; } }
        const f = ws && ws.islandFaction ? ws.islandFaction({ id }) : null;   // 2) 부족 진영별 색
        if(f==='remnant') return 'remnant';   // 남은 자(습격세력) = 적
        if(f==='watch')   return 'watch';     // 파수꾼 = 청
        if(f==='neutral') return 'tneutral';  // 중립 성향 부족도 '점령됨' = 회녹
        return 'neutral'; };   // ws 없음(스트림 off) = 무소유

      // 5) 월드 바운드 + 초기 뷰. ★얼음(±18000 밖)은 핏에서 제외 → 핵심 군도가 화면을 채움
      //   (레퍼런스도 얼음은 위/아래 가장자리 띠 = 배경 map.png가 담당).
      const cluster=this.data.islands.filter(i=>i.tier!=='ice');
      let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
      for(const i of cluster){ minX=Math.min(minX,i.x-i.r);maxX=Math.max(maxX,i.x+i.r);minZ=Math.min(minZ,i.z-i.r);maxZ=Math.max(maxZ,i.z+i.r); }
      // 정사각에 가깝게 패딩(배경 정사각 해도 비율 맞춤)
      const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2, half=Math.max(maxX-minX,maxZ-minZ)/2*1.04;
      this.bounds={minX:cx-half,maxX:cx+half,minZ:cz-half,maxZ:cz+half};

      // ★포그 오브 워: 시작 = 내 홈 섬만 공개. 나머지는 실제 방문/스트리밍(_syncReveal)해야 열림.
      //   (구버전은 지도상 최근접 6개 섬을 방문 안 해도 미리 열어 새 캐릭에도 "탐험 흔적"처럼 보였음 — 사령관. 이제 진짜 다녀온 곳만 공개.)
      const home=this._homeIsland(); this.revealed=[]; this.homeWorld=home?{x:home.x,z:home.z}:null;
      this._revIds=new Set(); this._byId=new Map(this.data.islands.map(i=>[i.id,i]));   // 포그 중복공개 방지 + id→섬
      if(home){ this.revealed.push({x:home.x,z:home.z,r:Math.max(1600,(home.r||300)*2.4)}); this._revIds.add(home.id); }
      // ★버그#3 수정(사령관 2026-07-09): 시작(스폰)섬은 모두에게 알려진 랜드마크 → 포그에서 항상 공개.
      //   포그를 "홈섬만" 공개로 바꾼 뒤 시작섬 위치가 전부 사라졌었음. 스폰섬(isSpawn)만 되살림(일반섬은 방문해야 공개 유지).
      for(const isle of this.data.islands){ if(isle.isSpawn && !this._revIds.has(isle.id)){
        this.revealed.push({x:isle.x,z:isle.z,r:Math.max(1350,(isle.r||300)*2.4)}); this._revIds.add(isle.id); } }
      // ★탐험 기반 포그 롤백(사령관 2026-07-10 "예전처럼 탐험에 따라 지도 밝혀지는 걸로 롤백, 근처 소형섬까지만"):
      //   2026-07-10 "섬 다 보이게" 테스트용 전체공개 for문을 제거 → 홈섬 + 스폰섬(랜드마크) + 실제 방문/스트리밍한 곳만 공개.
      //   근처 섬은 _scanVisited(플레이어 반경 접근 시 누적) + 스트리밍(worldstream.loaded)으로 다가가며 자연히 드러난다.
      this._syncReveal();       // ★맵 열기 전 이미 방문/스트리밍한 섬을 포그에서 공개(진짜 다녀온 곳)
      this._centerOnPlayer();   // 기본 뷰 = 내 위치 주변 크게

      // 6) 정적 패널 채우기
      this._fillStatic();
      this._fillSeasonOnce();
      this.sel = home || this.data.islands.find(i=>i.tier==='large') || this.data.islands[0];
      this._fillInfo();

      this.ready=true;
      const ld=this.ov.querySelector('#nm-load'); if(ld) ld.style.display='none';
      console.log('[navmap] 맵 교역창 준비 —', this.data.islands.length, '섬');
    }catch(e){ console.warn('[navmap] 맵 교역창 로드 실패', e&&e.message); const ld=this.ov.querySelector('#nm-load'); if(ld) ld.textContent='맵 로드 실패: '+(e&&e.message); }
    this.loading=false;
  }

  _resize(){ const r=this.win.getBoundingClientRect(); this.cv.width=Math.round(r.width); this.cv.height=Math.round(r.height); }

  _fit(){ const b=this.bounds, W=this.W, H=this.H, pad=70;
    const sx=(W-pad*2)/(b.maxX-b.minX), sy=(H-pad*2)/(b.maxZ-b.minZ);
    this.view.scale=Math.min(sx,sy); this.view.cx=(b.minX+b.maxX)/2; this.view.cz=(b.minZ+b.maxZ)/2; }

  // ★2026-07-10(사령관 "깃발이 있는 데가 아니라 진짜 시작섬이 다른 데") — "slot 1"은 캐논 생성 순서상 첫 번째 스폰섬일 뿐,
  //   이 캐릭터가 실제 랜덤배정받은 섬(ctx.homeIslandId, 어제 도입)과 무관했음. 있으면 그걸로, 없으면(레거시/샌드박스) slot1 폴백.
  _homeIsland(){
    const hid=this.ctx && this.ctx.homeIslandId;
    if(hid){ const byId=this.data.islands.find(i=>i.id===hid); if(byId) return byId; }
    const h=(this.data.spawns||[]).find(s=>s.slot===1); return h? this.data.islands.find(i=>i.id===h.islandId):null; }
  // ★플레이어의 실제 3D 위치를 canon 좌표에 매핑(마커/센터링 공용). player 없으면 null.
  //   _drawPlayerMarker 와 동일 식 — 센터가 마커와 정확히 일치하도록 한 곳에서 계산.
  //   ★2026-07-10 수정(사령관 "카브에 있는데 동쪽 섬이 서쪽으로 나옴"): worldstream(stream=1) 활성 시 플레이어 3D 좌표는
  //     이미 "canon×WORLD_SCALE" 글로벌 좌표계다(다른 섬들도 전부 이 좌표계) — 홈섬 SPAWN 기준 로컬변환을 얹으면 이중 변환이 되어
  //     완전히 엉뚱한 위치가 나옴(카브처럼 SPAWN 로컬 프레임과 무관한 곳에 있을 때 특히 심함). worldstream 있으면 단순 역스케일만 적용.
  _playerWorld(){ const pp=this.ctx.player&&this.ctx.player.pos; if(!pp) return null;
    const ws=this.ctx.worldstream;
    if(ws && ws.WORLD_SCALE){ return { x:pp.x/ws.WORLD_SCALE, z:pp.z/ws.WORLD_SCALE }; }   // 글로벌 좌표계 → canon 역스케일
    const e=this.ctx.environment, hi=this._homeIsland&&this._homeIsland();
    if(!(e&&e.SPAWN&&hi)) return null;
    const sc=(hi.r||300)/(e.ISLE_R||300);                     // 로컬 3D → canon 스케일(스트리밍 없는 구모드/샌드박스 폴백)
    return { x:hi.x+(pp.x-e.SPAWN.x)*sc, z:hi.z+(pp.z-e.SPAWN.z)*sc }; }
  // ★기본 뷰: 내 실제 위치를 화면 중앙에 두고 넉넉히 줌. (버그#1 수정, 사령관 2026-07-09)
  //   기존엔 홈(시작)섬 좌표(h.x,h.z)에 고정 → 멀리 항해해도 M 열 때마다 시작섬으로 되돌아갔음.
  _centerOnPlayer(){ const h=this._homeIsland(), p=this._playerWorld();
    if(!p && !h){ this._fit(); return; }
    this.view.cx = p?p.x:h.x; this.view.cz = p?p.z:h.z;       // 플레이어 위치 우선, 없으면 홈섬 폴백
    // ★2026-07-10(사령관 "M 열면 빈 바다") 버그수정 — 예전엔 반경으로 h.r(섬 자체 물리반지름, 스폰섬은 항상 80)를 썼는데,
    //   80*1.7=136 기준 줌이면 scale≈3.5까지 치솟아 캔버스 밖으로 죄다 튕겨나가 지도가 텅 비어 보였음(월드는 ~1만 유닛 폭).
    //   "내 주변 탐색 반경"은 섬 자체 크기가 아니라 근처 몇 개 섬이 보일 만한 고정값으로 — _fit() 전체뷰 배율의 상한도 같이 걸어 안전.
    const r=1800;
    const fitScale=Math.min((this.W-140)/(this.bounds.maxX-this.bounds.minX), (this.H-140)/(this.bounds.maxZ-this.bounds.minZ));
    this.view.scale=Math.max(0.12, Math.min(Math.min(this.W,this.H)*0.5/r, fitScale*6)); }

  // 밝혀진(탐험한) 영역의 월드 바운드 — 팬/줌 제한에 사용
  _revealedBounds(){ if(!this.revealed||!this.revealed.length) return null;
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
    for(const r of this.revealed){ minX=Math.min(minX,r.x-r.r);maxX=Math.max(maxX,r.x+r.r);minZ=Math.min(minZ,r.z-r.r);maxZ=Math.max(maxZ,r.z+r.r); }
    return {minX,maxX,minZ,maxZ}; }
  // ★뷰를 밝혀진 영역 안으로 제한 — 안개 너머(미탐험)로 스크롤 금지. 탐험할수록 범위 확장.
  _clampView(){ const b=this._revealedBounds(); if(!b) return; const m=700;
    const hw=this.W/2/this.view.scale, hh=this.H/2/this.view.scale;
    const loX=b.minX-m+hw, hiX=b.maxX+m-hw; this.view.cx = loX<=hiX ? Math.max(loX,Math.min(hiX,this.view.cx)) : (b.minX+b.maxX)/2;
    const loZ=b.minZ-m+hh, hiZ=b.maxZ+m-hh; this.view.cz = loZ<=hiZ ? Math.max(loZ,Math.min(hiZ,this.view.cz)) : (b.minZ+b.maxZ)/2; }

  X(x){ return this.W/2 + (x-this.view.cx)*this.view.scale; }
  // ★버그#2 수정(사령관 2026-07-09): canon +z = 남(南, 3D 북=-z). 미니맵은 +z를 아래로 그려 노스업인데
  //   여기선 +z를 위로(H/2 - …) 그려 M맵만 남북이 뒤집혀 있었다 → 실이동(남서)이 맵엔 북서로 보였음.
  //   미니맵/3D/홈섬 텍스처(위=북)와 일치하도록 +z=아래(H/2 + …)로 통일. worldAt/드래그/줌 부호도 함께 반전.
  Y(z){ return this.H/2 + (z-this.view.cz)*this.view.scale; }
  // ★해도 배경 = 장식. 전체 이미지를 100% 보이게(contain) 정적 배치 — 줌 무관(픽셀 안 깨짐), 나침반 문양 포함.
  _coverRect(img){ const W=this.W,H=this.H, s=Math.min(W/img.width,H/img.height), iw=img.width*s, ih=img.height*s;
    return { x:(W-iw)/2, y:(H-ih)/2, w:iw, h:ih }; }
  worldAt(px,py){ return { x:this.view.cx+(px-this.W/2)/this.view.scale, z:this.view.cz+(py-this.H/2)/this.view.scale }; }   // Y() +z=아래 반전에 맞춰 부호 반전(버그#2)

  // ── 메인 렌더 ──
  draw(){
    if(!this.ready) return;
    this._syncReveal();   // ★탐험 중 새로 방문/스트리밍된 섬을 포그에 반영(뷰클램프/줌하한도 자동 확장)
    const g=this.g, W=this.W, H=this.H, d=this.data;
    g.clearRect(0,0,W,H);
    // 윈도우 여백 = 어두운 바다(장식맵이 정사각이라 좌우 여백 생김)
    g.fillStyle='#06121e'; g.fillRect(0,0,W,H);

    // 1) 해도 배경(map2 밝혀진) = 장식. 전체 100% 정적 배치. 이후 모든 콘텐츠를 이 맵 영역 안으로 클립.
    const bg=this.img.bg, mr=this._coverRect(bg||this.img.fog||{width:1,height:1});
    this._mapRect=mr;
    g.save(); g.beginPath(); g.rect(mr.x,mr.y,mr.w,mr.h); g.clip();   // ★장식맵 안에만 그림
    if(bg) g.drawImage(bg, mr.x,mr.y,mr.w,mr.h);

    const byId=new Map(d.islands.map(i=>[i.id,i]));

    // 2) 영토 글로우 — 은은하게(링 도배 금지, 레퍼런스처럼 부드러운 빛만)
    if(this.layers.territory){
      for(const i of d.islands){ const tr=this.terrOf(i.id); if(tr==='neutral') continue;
        const cx=this.X(i.x), cy=this.Y(i.z), rr=Math.max(16, i.r*this.view.scale*2.0);
        const rg=g.createRadialGradient(cx,cy,0,cx,cy,rr);
        rg.addColorStop(0, hexA(TERR[tr], tr==='you'?0.30:0.20)); rg.addColorStop(0.6, hexA(TERR[tr],0.06)); rg.addColorStop(1, hexA(TERR[tr],0));
        g.fillStyle=rg; g.beginPath(); g.arc(cx,cy,rr,0,7); g.fill(); }
    }

    // 3) 항로 — 지선(점선) 먼저, 간선(굵은 시안) 위에
    if(this.layers.routes){
      const major=t=>t==='large'||t==='mid';
      for(const pass of [0,1]){
        g.setLineDash(pass? [] : [4,7]);
        for(const r of d.routes){ const a=byId.get(r.from),bb=byId.get(r.to); if(!a||!bb) continue;
          const mj=major(a.tier)||major(bb.tier); if((pass===1)!==mj) continue;
          g.strokeStyle= mj? 'rgba(110,225,255,.82)':'rgba(130,205,240,.55)'; g.lineWidth= mj?2.6:1.6;
          if(mj){ g.shadowColor='rgba(90,210,250,.6)'; g.shadowBlur=4; }
          g.beginPath(); g.moveTo(this.X(a.x),this.Y(a.z)); g.lineTo(this.X(bb.x),this.Y(bb.z)); g.stroke(); g.shadowBlur=0; }
      }
      g.setLineDash([]);
    }

    // 3b) 선택 NPC 항로(섬보다 아래) — 얇고 절제된 흐르는 점선 + 목적지 표시
    if(this.selNpc){ const m=this.selNpc, a=byId.get(m.from), bb=byId.get(m.to);
      if(a&&bb){ const dest=this.useNpc?bb:(m.dir>0?bb:a), src=this.useNpc?a:(m.dir>0?a:bb);
        const sx=this.X(src.x),sy=this.Y(src.z),dx=this.X(dest.x),dy=this.Y(dest.z);
        g.strokeStyle='rgba(140,235,255,.9)'; g.lineWidth=1.8; g.lineCap='round';
        g.setLineDash([7,7]); g.lineDashOffset=-((this._t||0)*26)%14;
        g.beginPath(); g.moveTo(sx,sy); g.lineTo(dx,dy); g.stroke(); g.setLineDash([]); g.lineDashOffset=0;
        this._arrowHead(sx,sy,dx,dy,'#bdf3ff');
        const pr=Math.max(13,(dest._sz||30)*0.4), ph=((this._t||0)*1.2)%1;     // 목적지 작은 펄스
        g.strokeStyle=`rgba(150,240,255,${(0.7*(1-ph)).toFixed(2)})`; g.lineWidth=1.6;
        g.beginPath(); g.arc(dx,dy,pr+ph*7,0,7); g.stroke(); }
    }

    // 4) 섬 — home 섬(내 섬)은 실제 지형 텍스처(미니맵과 동일), 나머지 canon 섬은 다이아 마커.
    const TMIN={large:128,mid:96,small:70,ice:78};
    const _tex=this.ctx._miniTex, _hi=this._homeIsland&&this._homeIsland(), _homeId=_hi?_hi.id:null;
    const _isleTexCache=this.ctx._isleTexCache;
    for(const i of d.islands){ const cx=this.X(i.x), cy=this.Y(i.z);
      const sz=Math.max(TMIN[i.tier]||58, i.r*this.view.scale*3.6); i._cx=cx; i._cy=cy; i._sz=sz;
      const tr=this.terrOf(i.id);
      const visitedTex = i.id!==_homeId && _isleTexCache && _isleTexCache.get(i.id);
      if(_tex && _tex.canvas && i.id===_homeId){
        // ★실제 지형 텍스처(탑다운 렌더) — 섬 화면크기에 맞춰. 물 영역은 투명이라 해도 비침.
        const w=Math.max(sz, i.r*this.view.scale*2.6);
        g.drawImage(_tex.canvas, cx-w/2, cy-w/2, w, w);
        // ★2026-07-15(사령관): 홈/시작섬 실텍스처 둘레의 '영토 외곽 링'(동그라미 테두리) 제거 — 텍스처만 표시.
      } else if(visitedTex){
        // ★방문한 섬 실제 텍스처(2026-07-13, 사령관 확정) — worldstream 스트리밍 시 백그라운드 캡처(_captureVisibleTex)
        //   ★버그수정(2026-07-13 밤): i.r/i.x,i.z(캐논 논리값)로 폭·위치를 다시 계산하면 실측 캡처 중심·반경과
        //     어긋나 잘림 — 텍스처에 저장된 실측 cx/cz/RR(월드좌표)을 그대로 캔버스 좌표로 환산해 그린다.
        const WS=(this.ctx.worldstream&&this.ctx.worldstream.WORLD_SCALE)||1.5;
        const cxT=this.X(visitedTex.cx/WS), cyT=this.Y(visitedTex.cz/WS);
        const w=Math.max(sz, (visitedTex.RR/WS)*this.view.scale*2);
        g.drawImage(visitedTex.canvas, cxT-w/2, cyT-w/2, w, w);
        // ★2026-07-15(사령관): 방문섬 실텍스처 둘레의 '영토 외곽 링'(동그라미 테두리) 제거 — 텍스처만 표시.
      } else {
        drawIsleMarker(g, cx, cy, i.tier, TERR[tr]||TERR.neutral, sz);
      }
    }

    // 4b) 점령/거점 — claimed(내 섬=금색) · outposts(부족 거점=진영색). 월드좌표 → canon 환산.
    this._drawClaims(g);

    // 5) 영토 거점 깃발 — ★사령관 지시로 일단 비활성(영토는 다이아몬드 색으로 표현). 복원 시 주석 해제.
    /* const FLAG={you:'flagYou',enemy:'flagEnemy',neutral:'flagNeutral'};
    for(const i of d.islands){ const tr=this.terrOf(i.id), cx=i._cx, cy=i._cy, sz=i._sz;
      const major=i.tier==='large'||i.tier==='mid'||i.isSpawn;
      if(!major) continue;
      if(tr==='neutral' && i.tier!=='large') continue;
      const key=(i.tier==='large'&&tr==='you')?'portMajor':FLAG[tr];
      const fimg=this.img[key]; if(!fimg) continue;
      const fs=Math.max(20, sz*(i.tier==='large'?0.5:0.4));
      g.drawImage(fimg, cx-fs/2, cy-fs*0.78, fs, fs);
    } */

    // 6) 선택 섬 → 섬에 딱 붙는 작고 절제된 선택 인디케이터(펄스)
    if(this.sel){ const i=this.sel, cx=this.X(i.x), cy=this.Y(i.z);
      const r0=Math.max(15, i._sz*0.34);                 // 섬을 살짝 감쌈
      const ph=(this._t||0)%1, pr=r0+3+ph*6, pa=0.5*(1-ph);
      g.strokeStyle=`rgba(130,235,255,${pa.toFixed(2)})`; g.lineWidth=1.4; g.beginPath(); g.arc(cx,cy,pr,0,7); g.stroke();   // 확산 펄스
      g.strokeStyle='rgba(150,240,255,.95)'; g.lineWidth=1.8; g.beginPath(); g.arc(cx,cy,r0,0,7); g.stroke();                // 본 링
      // 4방향 작은 마커
      g.fillStyle='rgba(170,245,255,.95)';
      for(const a of [-Math.PI/2,0,Math.PI/2,Math.PI]){ const x=cx+Math.cos(a)*r0, y=cy+Math.sin(a)*r0;
        g.beginPath(); g.moveTo(x+Math.cos(a)*3,y+Math.sin(a)*3); g.lineTo(x+Math.cos(a+2.3)*2.6,y+Math.sin(a+2.3)*2.6); g.lineTo(x+Math.cos(a-2.3)*2.6,y+Math.sin(a-2.3)*2.6); g.closePath(); g.fill(); }
    }

    // 8) 포그 오브 워 — 밝힌 영역만 보이고 나머지는 안개(map3). (탐험 시 reveal 추가)
    //   ★상선·내 배보다 먼저 그림 → 이 둘은 안개 위에 항상 표시(아래).
    this._drawFog(W,H);

    // 온보딩 차원문은 미탐험 포그 위에도 보장 노출한다. 좌표는 월드→canon 단위로 변환.
    if(this.questTarget){ const S=this.ctx.worldstream?.WORLD_SCALE||1.5;
      const qx=this.X(this.questTarget.x/S), qy=this.Y(this.questTarget.z/S), pulse=7+Math.sin((this._t||0)*4)*2;
      g.save();g.shadowColor='#63f0c1';g.shadowBlur=14;g.strokeStyle='#baffea';g.lineWidth=2;
      g.beginPath();g.arc(qx,qy,pulse,0,Math.PI*2);g.stroke();g.fillStyle='#63f0c1';g.beginPath();g.arc(qx,qy,3,0,Math.PI*2);g.fill();g.restore(); }

    // 활성 차원문은 최소 전략 정보만 표시한다. 랜덤=청록, 제작=금색.
    { const S=this.ctx.worldstream?.WORLD_SCALE||1.5;
      for(const p of this.ctx.portals?.markers?.()||[]){const x=this.X(p.x/S),y=this.Y(p.z/S),pulse=6+Math.sin((this._t||0)*4+p.tier)*1.5;
        const col=p.source==='crafted'?'#f4c966':'#69e6dc';g.save();g.shadowColor=col;g.shadowBlur=10;g.strokeStyle=col;g.lineWidth=1.8;
        g.beginPath();g.arc(x,y,pulse,0,Math.PI*2);g.stroke();g.fillStyle=col;g.beginPath();g.moveTo(x,y-4);g.lineTo(x+4,y);g.lineTo(x,y+4);g.lineTo(x-4,y);g.closePath();g.fill();g.restore();} }

    // 9) NPC 상선 — 선박 애셋. 선택 시 강조.
    //   ★포그 위에 그림(교역로 정보 = 안개 무관 항상 표시, 사령관 2026-07-04): 미탐험 해역 상선도 맵에 여러 척 보이게.
    if(this.layers.ships && this.merchants){ const nimg=this.img.shipYou;
      for(const m of this.merchants){
        if(m._pirated || m._removed) continue;   // ★2026-07-13(사령관 "전투 끝나고 상선 무더기") — 약탈전투 중인 상선은 3D에서 숨겨진 채 원위치에 얼어붙는데, 이 필터가 없어 지도엔 계속 정상 상선처럼 그려져 유령이 쌓였다.
        let wx, wz;
        if(this.useNpc && m.pos){ wx=m.pos.x; wz=m.pos.z; }   // npc 실제 항해 위치(섬회피·실속도 반영)
        else { const a=byId.get(m.from),bb=byId.get(m.to); if(!a||!bb) continue; wx=a.x+(bb.x-a.x)*m.progress; wz=a.z+(bb.z-a.z)*m.progress; }
        const x=this.X(wx), y=this.Y(wz); m._sx=x; m._sy=y;
        const sel=this.selNpc===m, s=sel?56:44;
        if(nimg){ g.globalAlpha=sel?1:.95; g.drawImage(nimg, x-s/2, y-s*0.72, s, s); g.globalAlpha=1; }
        if(sel){ g.strokeStyle='#aef2ff'; g.lineWidth=2; g.beginPath(); g.arc(x,y-s*0.2,s*0.62,0,7); g.stroke(); }
      }
    }

    // 10) 내 배 — 방향 화살촉(레퍼런스 발할라 톤, 시안 + 흰 외곽 + 발광). ★포그 위(항상 보임).
    //   ★버그#14 수정: 이전엔 스폰1 섬 좌표+고정 픽셀오프셋에만 그려 플레이어가 움직여도 마커가 안 따라옴.
    //   실제 플레이어 3D 위치(environment.SPAWN 기준 로컬)를 canon 홈섬 좌표에 매핑 → 열린 동안 _startAnim rAF가 재그려 실시간 추종.
    this._drawPorts(g);   // ⚓ 항구 위치 — 밝혀진 항구섬마다(M맵 항상 표시)
    this._drawPlayerMarker(g, byId, d);

    g.restore();   // 장식맵 클립 해제
    this._fillGold();
    if(this.selNpc) this._posNpc();   // NPC 툴팁이 움직이는 배 추종
  }

  // 포그: 가려진 지도(map3)를 전체에 덮고, 밝혀진 영역만 부드럽게 뚫어 밝은 지도(map2)+섬이 드러남.
  _drawFog(W,H){ if(!this.revealed||!this.revealed.length) return;
    const fimg=this.img.fog; const b=this.bounds;
    const fc=this._fog||(this._fog=document.createElement('canvas'));
    if(fc.width!==W||fc.height!==H){ fc.width=W; fc.height=H; }
    const fg=fc.getContext('2d'); fg.clearRect(0,0,W,H);
    // 가려진 지도(map3)를 밝은 지도와 동일 커버 좌표에 배치(같은 _coverRect → 정확히 겹침)
    if(fimg){ const r=this._coverRect(fimg); fg.drawImage(fimg, r.x,r.y,r.w,r.h); }
    else { fg.fillStyle='rgba(3,9,16,.95)'; fg.fillRect(0,0,W,H); }
    // 밝혀진 원 펀치(부드러운 가장자리) → 밝은 지도 드러남
    fg.globalCompositeOperation='destination-out';
    for(const rv of this.revealed){ const cx=this.X(rv.x), cy=this.Y(rv.z), r=rv.r*this.view.scale;
      const rg=fg.createRadialGradient(cx,cy,r*0.62, cx,cy,r);
      rg.addColorStop(0,'rgba(0,0,0,1)'); rg.addColorStop(1,'rgba(0,0,0,0)');
      fg.fillStyle=rg; fg.beginPath(); fg.arc(cx,cy,r,0,7); fg.fill(); }
    fg.globalCompositeOperation='source-over';
    this.g.drawImage(fc,0,0);
  }

  // ── 포그 탐험 확장 — 방문/스트리밍된 섬 id를 누적(맵 닫혀 있어도 onUpdate가 호출). worldstream 좌표계 기준. ──
  //   판정: (a) worldstream이 3D로 로딩한 섬(loaded)=플레이어 근처 / (b) 플레이어 canon 위치와 섬 canon 거리 근접.
  _scanVisited(){ const ws=this.ctx.worldstream; if(!ws||!this._visited) return;
    if(ws.loaded&&ws.loaded.forEach) ws.loaded.forEach((_r,id)=>this._visited.add(id));   // 스트림 로딩된 섬=근처
    const pp=this.ctx.player&&this.ctx.player.pos, list=ws.islands;
    if(pp&&list){ const WS=ws.WORLD_SCALE||1.5, pcx=pp.x/WS, pcz=pp.z/WS;                   // 월드 → canon
      for(const isle of list){ if(this._visited.has(isle.id)) continue;
        if(Math.hypot(isle.x-pcx,isle.z-pcz) < (isle.r||300)+900) this._visited.add(isle.id); } }
  }
  // 누적 방문 섬을 revealed 포그 원으로 반영(중복 방지). data 로드 이후에만 유효(this._byId 존재 시).
  _syncReveal(){ if(!this.revealed||!this._visited||!this._byId) return;
    this._revIds=this._revIds||new Set();
    for(const id of this._visited){ if(this._revIds.has(id)) continue;
      const isle=this._byId.get(id); if(!isle){ this._revIds.add(id); continue; }
      this._revIds.add(id); this.revealed.push({x:isle.x,z:isle.z,r:Math.max(1350,(isle.r||300)*2.4)}); }
  }
  // ── M맵 실제 텍스처 캐시(2026-07-13, 사령관 확정) — 방문한 섬도 홈섬처럼 실제 지형 렌더로 보이게. ──
  //   worldstream이 로드해둔(=플레이어가 실제로 그 자리 다녀온) 섬을 캐논맵 열림 여부와 무관하게 백그라운드에서 1회 스냅샷.
  //   ctx._isleTexCache에 id별로 영구 캐싱(언로드 후에도 유지) — 한 틱(0.4s)에 최대 1개만 캡처(렌더타겟 스왑 프레임드랍 방지).
  _captureVisibleTex(){
    const ctx=this.ctx, ws=ctx.worldstream; if(!ws || !ws.loaded || !this.data) return;
    if(!ctx._isleTexCache) ctx._isleTexCache=new Map();
    const home=this._homeIsland&&this._homeIsland(), homeId=home?home.id:null;
    for(const [id, rec] of ws.loaded){
      if(id===homeId || ctx._isleTexCache.has(id)) continue;
      if(!rec || !rec.group || rec.fade<1) continue;   // 완전히 페이드인된 섬만(로딩 중 반투명 텍스처 방지)
      const isle=ws.islands.find(i=>i.id===id); if(!isle) continue;
      const WS=ws.WORLD_SCALE||1.5;
      // ★버그수정(2026-07-13 밤, "아직도 잘림" 라이브 픽셀실측으로 확정): canon isle.x/z는 논리 좌표라 실제
      //   섬 메시 중심과 어긋날 수 있음(worldstream scatterTrees와 동일 원인) → 캡처 전 픽셀 alpha 검사 결과
      //   여러 섬에서 가장자리에 불투명(육지) 픽셀이 닿아있어 확정. rec.group 실측 바운딩박스 중심·반경 사용.
      let cx=isle.x*WS, cz=isle.z*WS, RR=(isle.r||120)*WS*VISIT_TEX_MARGIN;
      try{
        const bbox=new THREE.Box3().setFromObject(rec.group);
        if(!bbox.isEmpty()){
          const bsize=bbox.getSize(new THREE.Vector3()), bctr=bbox.getCenter(new THREE.Vector3());
          const measured=Math.max(bsize.x,bsize.z)/2*1.15;   // 실측 최댓값 기준 + 여유15% — 잘림보다 여백 낫다
          if(measured>10 && isFinite(measured)){ cx=bctr.x; cz=bctr.z; RR=measured; }
        }
      }catch(_){}
      const tex=buildIsleTexFromGroup(ctx, rec.group, rec.trees, cx, cz, RR);
      if(tex) ctx._isleTexCache.set(id, tex);
      break;
    }
  }

  // ── 점령/거점 마커(전략맵) — ctx.claimed(내 섬)·ctx.outposts(부족 거점). 월드좌표를 canon으로 환산해 표시. ──
  //   내 것=금색 깃발 / 부족=진영색(tribeById.gem) 깃발. 읽기 전용(claimed/outposts/tribes 수정 없음).
  _drawClaims(g){
    const ws=this.ctx.worldstream, WS=(ws&&ws.WORLD_SCALE)||1.5;
    const flag=(cx,cy,col)=>{ g.save(); g.lineCap='round'; g.lineJoin='round';
      g.shadowColor=col; g.shadowBlur=7; g.strokeStyle=col; g.lineWidth=2;
      g.beginPath(); g.moveTo(cx,cy+7); g.lineTo(cx,cy-11); g.stroke();                        // 깃대
      g.beginPath(); g.moveTo(cx,cy-11); g.lineTo(cx+12,cy-7); g.lineTo(cx,cy-3); g.closePath();
      g.globalAlpha=0.9; g.fillStyle=col; g.fill(); g.globalAlpha=1; g.stroke();                // 삼각 깃발
      g.shadowBlur=0; g.beginPath(); g.arc(cx,cy+7,2,0,7); g.fillStyle=col; g.fill(); g.restore(); };   // 밑동
    const tb=this.ctx.tribes&&this.ctx.tribes.tribeById;
    // 부족 거점(진영색)
    if(Array.isArray(this.ctx.outposts)) for(const o of this.ctx.outposts){ if(!o||o.owner==='player') continue;
      const t=tb&&tb(o.tribe), col=(t&&t.gem)||'#b0a494'; flag(this.X(o.x/WS), this.Y(o.z/WS), col); }
    // 내 섬(claimed) + 내 거점 = 금색
    const GOLD='#ffd24a';
    if(Array.isArray(this.ctx.claimed)) for(const c of this.ctx.claimed){ if(!c) continue; flag(this.X(c.x/WS), this.Y(c.z/WS), GOLD); }
    if(Array.isArray(this.ctx.outposts)) for(const o of this.ctx.outposts){ if(!o||o.owner!=='player') continue; flag(this.X(o.x/WS), this.Y(o.z/WS), GOLD); }
  }

  // ── 플레이어 마커 — 실제 3D 위치를 canon 홈섬 좌표에 매핑해 그림(움직이면 열린 동안 rAF가 재그려 추종) ──
  //   3D 씬은 홈섬 로컬공간(원점≈environment.SPAWN, 지형반경≈ISLE_R). canon 홈섬은 (hi.x,hi.z) 반경 hi.r.
  //   → 플레이어의 SPAWN 기준 오프셋을 (hi.r/ISLE_R) 스케일로 canon에 얹는다. player/environment 없으면 스폰1 데모 폴백.
  _drawPlayerMarker(g, byId, d){
    const g0=g||this.g;
    const p=this._playerWorld();                                  // ★센터링과 동일 좌표(버그#1)
    if(p){
      const cx=this.X(p.x), cy=this.Y(p.z);
      // heading — 배 탑승 시 뱃머리 forward, 도보 시 카메라 방위(미니맵 규약과 동일: 0=북, 시계방향, 라디안).
      let head=0;
      const onShip=this.ctx.ship&&this.ctx.player&&(this.ctx.player.onShip===this.ctx.ship||this.ctx.ship.boarded);
      if(onShip&&this.ctx.ship.forward){ const f=this.ctx.ship.forward; head=Math.atan2(f.x,-f.z); }
      else if(this.ctx.camera){ const dv=this.ctx.camera.getWorldDirection(new THREE.Vector3()); head=Math.atan2(dv.x,-dv.z); }
      drawPlayerArrow(g0, cx, cy, head, 15);
      return;
    }
    // 폴백(샌드박스 등 player ctx 없음) — 기존 스폰1 근처 데모 배치
    const home=d.spawns.find(s=>s.slot===1); const shi=home&&byId.get(home.islandId);
    if(shi){ const cx=this.X(shi.x)+44, cy=this.Y(shi.z)-34;
      const head=this.ctx.ship?(this.ctx.ship.bowYaw||0):0; drawPlayerArrow(g0, cx, cy, head, 15); }
  }

  // 화살촉(NPC 항로 방향)
  _arrowHead(x0,y0,x1,y1,color){ const g=this.g, a=Math.atan2(y1-y0,x1-x0), L=11;
    g.save(); g.translate(x1,y1); g.rotate(a); g.fillStyle=color;
    g.beginPath(); g.moveTo(2,0); g.lineTo(-L,L*0.55); g.lineTo(-L,-L*0.55); g.closePath(); g.fill(); g.restore(); }

  // ── 정적 크롬(레전드·독·버튼·나침반) — 전부 퍼블리싱(HTML/CSS/SVG) ──
  _fillStatic(){
    const q=s=>this.ov.querySelector(s);
    // 닫기·줌·위치 버튼
    q('#nm-close').onclick=()=>this.close();
    // ★2026-07-10 수정(사령관 "축소해도 다른 섬이 안 보임"): 1.25배씩이라 minScale까지(약 29배 차이) 15번+ 눌러야 해서
    //   사실상 도달 불가 — 1.6배로 키워 5~6번이면 전체 지도(91섬)까지 축소 가능하게.
    q('#nm-zin').onclick=()=>this._zoomAt(this.W/2,this.H/2,1.6);
    q('#nm-zout').onclick=()=>this._zoomAt(this.W/2,this.H/2,1/1.6);
    q('#nm-loc').onclick=()=>{ this._centerOnPlayer(); this.draw(); };
    // (나침반은 맵 배경의 장식 나침반 문양 사용 — 별도 SVG 제거)
    // 독바
    const dock=q('#nm-dock'); dock.innerHTML='';
    const items=[['필터','filters','filters'],['영토','territory','flag'],['항로','routes','routes'],['선박','ships','ship']];
    for(const [ko,key,icon] of items){ const on=key==='filters'?false:this.layers[key];
      const b=document.createElement('div'); b.className='nm-di'+(on?' on':'');
      b.innerHTML=`${SVG(icon)}<span>${ko}</span>`;
      b.onclick=()=>{ if(key!=='filters'){ this.layers[key]=!this.layers[key]; this._fillStatic(); this.draw(); } };
      dock.appendChild(b); }
    // 레전드(퍼블리싱)
    this._fillLegend();
  }

  _fillLegend(){ const el=this.ov.querySelector('#nm-legend'); if(!el) return;
    const sw=c=>`<span class="nm-sw" style="background:${c}"></span>`;
    const line=(c,dash)=>`<span class="nm-line" style="border-top:2px ${dash?'dashed':'solid'} ${c}"></span>`;
    const ic=(n,c)=>`<span class="nm-ico" style="color:${c}">${SVG(n)}</span>`;
    el.innerHTML=`
      <div class="nm-lbl" style="color:#9fd2e8;letter-spacing:.18em;margin-bottom:4px">맵 범례</div>
      <div class="nm-lbl">영토</div>
      <div class="nm-lr">${sw(TERR.you)}내 영토</div>
      <div class="nm-lr">${sw(TERR.enemy)}적 영토</div>
      <div class="nm-lr">${sw(TERR.neutral)}중립</div>
      <div class="nm-lbl">섬 종류</div>
      <div class="nm-lr">${DIAMOND('#e8b04a')}대형섬 / 거대항</div>
      <div class="nm-lr">${DIAMOND('#6f9a4e')}중형섬 / 거점</div>
      <div class="nm-lr">${DIAMOND('#aebf6f')}소형섬</div>
      <div class="nm-lr">${DIAMOND('#bfe3f0')}얼음섬</div>
      <div class="nm-lbl">선박 · 항로</div>
      <div class="nm-lr">${ic('ship','#ffe07a')}내 배</div>
      <div class="nm-lr">${ic('ship','#cda968')}NPC 상선</div>
      <div class="nm-lr">${line('rgba(95,220,250,.85)')}간선 항로</div>
      <div class="nm-lr">${line('rgba(150,200,230,.7)',true)}지선 항로</div>
      <div class="nm-lbl">거점</div>
      <div class="nm-lr">${ic('flag',TERR.you)}스폰 / 점령 깃발</div>
      <div class="nm-lr">${ic('anchor','#7fb8d8')}항구 / 교역</div>`;
  }

  _fillInfo(){ const el=this.ov.querySelector('#nm-info'); if(!el||!this.sel) return; const i=this.sel;
    const tierKo={large:'대형섬 · 거대항',mid:'중형섬 · 거점',small:'소형섬 · 전초',ice:'얼음섬'}[i.tier];
    const tr=this.terrOf(i.id), owner={you:'나',remnant:'남은 자',watch:'파수꾼',tneutral:'중립 부족',neutral:'중립'}[tr]||'중립';
    const pr=this.econ.prices[i.id], def=i.tier==='large'?5:i.tier==='mid'?3:1;
    const held = tr==='neutral' ? null : (3 + (Math.abs(Math.round(Math.sin(i.x*0.011+i.z*0.017)*60))%42));   // 점령일수(데모 결정론)
    const goods = pr&&this.GOODS&&this.GOODS.length
      ? `<div style="display:flex;justify-content:space-between;margin-top:7px">${this.GOODS.map(gd=>`<div style="text-align:center"><div class="nm-val" style="color:#ffd24a;font-size:14px">${pr[gd.k]||'-'}</div><div style="color:#7d97ab;font-size:10px;margin-top:2px">${gd.ko}</div></div>`).join('')}</div>`
      : `<div class="nm-mut" style="font-size:11px;margin-top:6px">항구 없음 (중립 변경)</div>`;
    const facil = i.tier==='large'?['anchor','swords','hammer','cargo']:i.tier==='mid'?['anchor','hammer','cargo']:['anchor'];
    el.innerHTML=`
      <div class="nm-row" style="gap:12px;margin-bottom:13px">
        <canvas id="nm-thumb" width="68" height="68" style="width:58px;height:58px;border-radius:11px;background:radial-gradient(circle at 50% 40%,rgba(30,80,105,.55),rgba(10,28,40,.6));border:1px solid rgba(95,200,235,.32);flex:none"></canvas>
        <div style="min-width:0;flex:1">
          <div class="nm-row" style="gap:5px"><span class="nm-h" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.prefab||i.id}</span><span class="nm-ico" style="color:#ffd24a;flex:none">${SVG('star','width=14 height=14')}</span></div>
          <div class="nm-sub" style="margin-top:3px">${tierKo}</div>
        </div>
      </div>
      <div class="nm-div"></div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:9px 14px;font-size:12px;align-items:center">
        <span class="nm-mut nm-row" style="gap:6px">${SVG2('crown')}소유</span><span class="nm-row" style="gap:6px"><span class="nm-sw" style="width:9px;height:9px;background:${TERR[tr]}"></span>${owner}</span>
        <span class="nm-mut nm-row" style="gap:6px">${SVG2('lock')}상태</span><span style="color:#bfe9ff">${i.isSpawn?'스폰 (불가침)':'정상'}</span>
        <span class="nm-mut">점령일수</span><span class="nm-val">${held==null?'<span style="color:#5b7b8a">—</span>':held+'일'}</span>
        <span class="nm-mut nm-row" style="gap:6px">${SVG2('shield')}방어</span><span style="color:#5fd0e0;letter-spacing:2px">${'◆'.repeat(def)}<span style="color:#2c4656">${'◇'.repeat(5-def)}</span></span>
      </div>
      <div class="nm-lbl" style="margin:14px 0 2px">교역품 시세</div>
      ${goods}
      <div class="nm-lbl" style="margin:14px 0 7px">시설</div>
      <div class="nm-row" style="gap:9px">${facil.map(f=>`<span class="nm-ico" style="color:#7fb8d8">${SVG(f)}</span>`).join('')}</div>`;
    const th=el.querySelector('#nm-thumb'); if(th&&this.spr[i.tier]){ const tg=th.getContext('2d'); tg.clearRect(0,0,68,68); tg.drawImage(this.spr[i.tier], 5, 11, 58, 48); }
  }

  _fillGold(){ const el=this.ov.querySelector('#nm-gold'); if(!el) return;
    const inv=this.ctx.inventory; const gold=inv?inv.gold:3424; const cargo=inv?Math.round(inv.cargoWeight):0;
    el.innerHTML=`<span class="nm-row" style="gap:7px;color:#ffd24a;font:700 14px ui-monospace;text-shadow:0 1px 4px #000">
        <span class="nm-ico" style="color:#ffd24a">${SVG('star')}</span>${gold.toLocaleString()}</span>
      <span class="nm-row" style="gap:7px;color:#9fcfe0;font:700 13px ui-monospace;text-shadow:0 1px 4px #000">
        <span class="nm-ico" style="color:#9fcfe0">${SVG('cargo')}</span>${cargo}</span>`; }

  // 시즌/영토/랭크 카드 — 점유 게이지 + 영토 막대 + SVG 계급 실드
  _fillSeasonOnce(){ const el=this.ov.querySelector('#nm-season'); if(!el||!this.data) return;
    let you=0,enemy=0,neu=0; for(const i of this.data.islands){ const t=this.terrOf(i.id); if(t==='you')you++; else if(t==='neutral')neu++; else enemy++; }   // 부족 점령(남은자·파수꾼·중립부족) = 타 세력으로 합산
    const tot=you+enemy+neu, ctrl=Math.round(you/Math.max(1,tot)*100), C=2*Math.PI*17, off=C*(1-ctrl/100);
    const rows=[['내 영토',you,TERR.you],['적 영토',enemy,TERR.enemy],['중립',neu,TERR.neutral]];
    el.innerHTML=`
      <div class="nm-row" style="gap:10px">
        <span class="nm-ico" style="color:#ffd24a">${SVG('star')}</span>
        <div style="flex:1"><div class="nm-h" style="font-size:15px">시즌 3</div><div class="nm-sub" style="margin-top:2px">14일 6시간 남음</div></div>
        <svg width="46" height="46" viewBox="0 0 40 40" style="margin-right:30px"><circle cx="20" cy="20" r="17" fill="none" stroke="rgba(20,40,52,.9)" stroke-width="4"/>
          <circle cx="20" cy="20" r="17" fill="none" stroke="#36d6e0" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 20 20)"/>
          <text x="20" y="23" text-anchor="middle" font-family="ui-monospace" font-size="11" font-weight="700" fill="#9fe9f5">${ctrl}%</text></svg>
      </div>
      <div class="nm-div"></div>
      <div class="nm-lbl" style="margin-bottom:9px">영토 개요</div>
      ${rows.map(([k,v,c])=>`<div class="nm-row" style="margin:7px 0">
        <span class="nm-sw" style="width:11px;height:11px;background:${c}"></span>
        <span style="color:#b3c4d2;font-size:12px;width:50px">${k}</span>
        <span class="nm-bar" style="flex:1"><i style="width:${Math.round(v/Math.max(1,tot)*100)}%;background:${c}"></i></span>
        <span class="nm-val" style="width:30px;text-align:right">${v}</span></div>`).join('')}
      <div class="nm-div"></div>
      <div class="nm-lbl" style="margin-bottom:9px">계급</div>
      <div class="nm-row" style="gap:12px">
        <span style="position:relative;flex:none;width:40px;height:40px;display:flex;align-items:center;justify-content:center">
          <span class="nm-ico" style="color:#3a9bc4;position:absolute">${SVG('shield','width=40 height=40')}</span>
          <span style="position:relative;color:#eaf6ff;font:700 12px system-ui">I</span></span>
        <div style="flex:1">
          <div class="nm-h" style="font-size:14px">선장 I</div>
          <div class="nm-bar" style="margin-top:6px"><i style="width:62%;background:linear-gradient(90deg,#1f7fa6,#36d6e0)"></i></div>
          <div class="nm-sub" style="margin-top:4px;font-size:10px">1,250 / 2,000 XP</div></div></div>`; }

  // ── 상호작용(캔버스 로컬 좌표) ──
  _down(e){ const [lx,ly]=this._local(e); this.drag={x:lx,y:ly,cx:this.view.cx,cz:this.view.cz,moved:false}; this.cv.style.cursor='grabbing'; }
  _move(e){ if(!this.drag) return; const [lx,ly]=this._local(e); const dx=lx-this.drag.x, dy=ly-this.drag.y;
    if(Math.abs(dx)+Math.abs(dy)>3) this.drag.moved=true;
    this.view.cx=this.drag.cx - dx/this.view.scale; this.view.cz=this.drag.cz - dy/this.view.scale; this._clampView(); this.draw(); }   // cz 부호 반전(Y() +z=아래, 버그#2)
  _up(){ if(this.drag) this.cv.style.cursor='grab'; this.drag=null; }
  _zoomAt(px,py,f){ const w=this.worldAt(px,py); this.view.scale*=f;
    this.view.scale=Math.max(this.view.scale, this._minScale());                        // ★축소 하한 = 밝혀진 영역까지만
    this.view.scale=Math.min(this.view.scale, Math.max(8, this._minScale()*8));           // 확대 상한 (home 섬 텍스처 자세히 줌인 허용 — 초기 줌 3.45보다 높게)
    this.view.cx=w.x-(px-this.W/2)/this.view.scale; this.view.cz=w.z-(py-this.H/2)/this.view.scale; this._clampView(); this.draw(); }   // cz 부호 반전(Y() +z=아래, 버그#2)
  _fitScale(){ const b=this.bounds; return Math.min((this.W-140)/(b.maxX-b.minX),(this.H-140)/(b.maxZ-b.minZ)); }
  // 축소 하한 — 밝혀진(탐험한) 영역이 화면에 꽉 차는 스케일(그 이상 축소 금지). 탐험할수록 더 축소 가능.
  _minScale(){ const b=this._revealedBounds(); if(!b) return this._fitScale(); const m=500;
    return Math.min((this.W-80)/((b.maxX-b.minX)+m*2),(this.H-80)/((b.maxZ-b.minZ)+m*2)); }
  _click(e){ if(this.drag&&this.drag.moved) return; const [lx,ly]=this._local(e);
    // ① NPC 배 먼저(작은 마커 우선) → 항로/목적지 표시
    if(this.layers.ships && this.merchants){ let nh=null,nd=1e9;
      for(const m of this.merchants){ if(m._sx==null) continue; const d=Math.hypot(m._sx-lx,m._sy-ly); if(d<17&&d<nd){nd=d;nh=m;} }
      if(nh){ this.selNpc=nh; this.sel=null; this._fillNpc(); this.draw(); return; } }
    // ② 섬 클릭 → 선택 링 + 반경 + 정보
    let hit=null,hd=1e9;
    for(const i of this.data.islands){ const d=Math.hypot(this.X(i.x)-lx,this.Y(i.z)-ly); const rr=Math.max(20,i.r*this.view.scale*0.95); if(d<rr&&d<hd){hd=d;hit=i;} }
    if(hit){ this.sel=hit; this.selNpc=null; this._hideNpc(); this._fillInfo(); this.draw(); }
    else { this.selNpc=null; this._hideNpc(); this.draw(); }   // 빈 바다 = 해제
  }

  _fillNpc(){ const el=this.ov.querySelector('#nm-npc'); const m=this.selNpc; if(!el||!m) return;
    const byId=new Map(this.data.islands.map(i=>[i.id,i]));
    const a=byId.get(m.from),bb=byId.get(m.to), dest=this.useNpc?bb:(m.dir>0?bb:a), src=this.useNpc?a:(m.dir>0?a:bb);
    const gd=this.GOODS&&this.GOODS.find(x=>x.k===m.cargo);
    el.innerHTML=`<div class="nm-row" style="gap:7px;margin-bottom:7px"><span class="nm-ico" style="color:#9fe9f5">${SVG('ship')}</span><span class="nm-h" style="font-size:13px">NPC 상선</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:5px 10px;font-size:11.5px">
        <span class="nm-mut">화물</span><span class="nm-val" style="color:#ffd24a">${gd?gd.ko:m.cargo}</span>
        <span class="nm-mut">출발</span><span style="color:#bcd">${src?src.prefab:'-'}</span>
        <span class="nm-mut">목적지</span><span style="color:#aef2ff">${dest?dest.prefab:'-'} →</span></div>`;
    el.style.display='block'; this._posNpc();
  }
  _posNpc(){ const el=this.ov.querySelector('#nm-npc'); const m=this.selNpc; if(!el||!m||m._sx==null) return;
    el.style.left=Math.min(this.W-180, Math.max(8, m._sx+18))+'px'; el.style.top=Math.min(this.H-110, Math.max(8, m._sy-14))+'px'; }
  _hideNpc(){ this.selNpc=null; const el=this.ov.querySelector('#nm-npc'); if(el) el.style.display='none'; }
}

// 자산 배경 헬퍼(빈 문자열 안전)
function ASSET_OR(s){ return s||''; }
function hexA(hex,a){ const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16); return `rgba(${r},${g},${b},${a})`; }

// [근거]
// 확정(출처):
//  - 맵 교역창 레이아웃(좌상 섬정보·우상 시즌/영토/랭크·좌하 레전드·하단 독바·우하 나침반/줌·금화·닫기) — voyage/애셋/전체완성본 맵(교역).png.
//  - UI 자산(레전드·줌±·위치·닫기·독바·패널·실드·섬스프라이트·내배·항구) — voyage/애셋/ 사령관 제공 → voyage/ui/ 복사.
//  - 데이터(203섬·항로·스폰) — worldmap.canon.json(정본, seed17/20명). 시세·NPC상선·영토 — economy.js generateEconomy(데모).
//  - 미니맵(우상단 원형·북고정·플레이어 화살표) — 기존 navmap.js 계승(game.html initNavMap 호환).
//  - 영토 3색(내=시안/적=레드/중립=회청)·간선/지선 항로·거대항 강조·스폰 깃발 — mapview.html 렌더 패턴 + 전체완성본.
// 미정(비워둠):
//  - 인구/방어/시설 실수치 — 기획 미정 → 티어 기반 데모 표시(인구 1250 등 placeholder).
//  - 시즌 카운트다운·XP 실수치 — 정본 미정, placeholder.
//  - 내 배 전략맵 좌표 — ★버그#14 수정: ctx.player.pos(3D 홈섬 로컬)를 canon 홈섬 좌표에 스케일 매핑해 실시간 추종. player ctx 없으면 스폰1 데모 폴백.
// 제안(작성자=앤):
//  - 영토 분류 데모(스폰1=나/타슬롯=적/거대항·얼음=중립) — economy.territory(Voronoi) 위 3색 매핑. 실게임은 서버 점령상태로 교체.
//  - 섬 스프라이트 티어별 1종 프리렌더+영토 글로우 — 203개 개별 PNG 대신 성능/단순. 얼음=소형 청록 틴트.
//  - 정적/동적 분리 대신 팬·줌·토글 시 즉시 redraw(203섬 프리렌더 블릿이라 가벼움).
