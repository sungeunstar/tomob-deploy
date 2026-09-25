// modules/opening.js — 오프닝 골든패스 (voyage 첫 퀘스트라인 진입 연출)
//   caravel 갑판 스폰 → 조타/돛 튜토 → 해적선 전투 → 난파 → 표류 → 깨어남 컷신.
//   tutorial.html과 game.html(P4)이 공유. ctx는 core/physics/water/wind/sailhud + terrain(stub 또는 실섬) 셋업 완료 상태로 받는다.
//   호출: await initOpening(ctx, { setLoad, onComplete });
//     · setLoad(text)   — 로딩 문구 갱신(옵션)
//     · onComplete()    — 깨어남 대사 종료 후 실행(옵션). 없으면 내장 showDriftHandoff(game.html?quest=1 페이지 이동).
//   ⚠️ 이 파일은 tutorial.html에서 추출된 것(P4-A). 동작 무변경이 원칙.
import * as THREE from 'three';
import { GLTFLoader as _CutGLTF } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader as _CutFBX } from 'three/addons/loaders/FBXLoader.js';
import { initShip, preloadShip, preloadHelmRig } from '/tomob-deploy/modules/ship.js';
import { initPlayer, KAY_CHARS } from '/tomob-deploy/modules/player.js';
import { initSound }    from '/tomob-deploy/modules/sound.js';
import { initCannon }   from '/tomob-deploy/modules/cannon.js';
import { initDestruct } from '/tomob-deploy/modules/destruct.js';
import { initShipwreck } from '/tomob-deploy/modules/shipwreck.js';
import { startNavalEncounter } from '/tomob-deploy/modules/navalencounter.js';
import { initRain }     from '/tomob-deploy/modules/rain.js';
import { initEnvironment } from '/tomob-deploy/modules/environment.js';
import { initNightSky } from '/tomob-deploy/modules/nightsky.js';
import { initSky }      from '/tomob-deploy/modules/sky.js';
import { toast as ukToast, gauge as ukGauge, dialog as ukDialog, locationReveal as ukLocation } from '/tomob-deploy/modules/uikit.js';

// ── 엘든링식 튜토 팝업 CSS/DOM (tutorial.html에 이미 있으면 no-op — game.html 등 없는 곳에만 주입) ──
const TUTO_CSS = `
  #tuto{position:fixed;left:50%;top:46px;transform:translateX(-50%);z-index:8;width:min(720px,86vw);
    background:linear-gradient(180deg,rgba(14,16,20,.90),rgba(10,12,16,.86));
    border:1px solid rgba(176,148,96,.42);border-radius:6px;
    box-shadow:0 18px 60px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.5);
    color:#e9e2d2;pointer-events:none;overflow:hidden;
    opacity:0;transition:opacity .45s ease, transform .45s ease;}
  #tuto.show{opacity:1;}
  #tuto .x{position:absolute;top:9px;right:11px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
    color:#9a917d;font-size:15px;cursor:pointer;border-radius:5px;border:1px solid rgba(176,148,96,.22);
    background:rgba(0,0,0,.25);transition:color .15s,border-color .15s,background .15s;z-index:2;}
  #tuto .x:hover{color:#f0d9a8;border-color:rgba(176,148,96,.55);background:rgba(0,0,0,.45);}
  #tuto .k.active{color:#1a160e;background:linear-gradient(180deg,#f5e0ab,#dcbb7c);border-color:#f5e0ab;
    box-shadow:0 0 11px rgba(245,224,171,.65);transform:translateY(1px);}
  #tuto .keys .row{transition:opacity .42s ease, max-height .42s ease, margin .42s ease, transform .42s ease;
    overflow:hidden;max-height:44px;}
  #tuto .keys .row.done{opacity:0;max-height:0;margin:0;transform:translateX(8px);}
  #tuto .ti{text-align:center;font-size:19px;font-weight:600;letter-spacing:.04em;color:#f0d9a8;
    padding:15px 20px 13px;position:relative;}
  #tuto .ti::after{content:"";position:absolute;left:8%;right:8%;bottom:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(176,148,96,.5),transparent);}
  #tuto .bd{display:flex;gap:20px;padding:18px 26px 8px;align-items:stretch;}
  #tuto .tx{flex:1;font-size:14.5px;line-height:1.85;color:#d8d0bf;}
  #tuto .tx p{margin:0 0 10px;}
  #tuto .img{width:40%;min-height:150px;border-radius:4px;background:#0a0d11 center/cover no-repeat;
    border:1px solid rgba(176,148,96,.28);box-shadow:inset 0 0 30px rgba(0,0,0,.6);}
  #tuto .keys{padding:4px 26px 4px;font-size:14px;color:#cfc6b2;}
  #tuto .keys .row{display:flex;align-items:center;gap:9px;margin:7px 0;}
  #tuto .k{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;
    background:linear-gradient(180deg,#2c3036,#191c20);border:1px solid #5a5141;border-bottom-width:2px;border-radius:5px;
    color:#f0e6cf;font:700 13px/1 ui-monospace,Consolas,monospace;box-shadow:0 1px 0 rgba(0,0,0,.5);}
  #tuto .ft{text-align:center;font-size:12.5px;color:#9a917d;letter-spacing:.03em;
    padding:11px 20px 14px;margin-top:6px;position:relative;}
  #tuto .ft::before{content:"";position:absolute;left:8%;right:8%;top:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(176,148,96,.34),transparent);}
`;
function ensureTutoDom(){
  if(document.getElementById('tuto')) return;   // tutorial.html 등 이미 있으면 그대로 사용(무변경)
  const st=document.createElement('style'); st.id='tutoStyle'; st.textContent=TUTO_CSS; document.head.appendChild(st);
  const el=document.createElement('div'); el.id='tuto';
  el.innerHTML=`
  <div class="x" title="닫기 (X)">✕</div>
  <div class="ti">항해 — 키를 잡아라</div>
  <div class="bd"><div class="tx"></div><div class="img"></div></div>
  <div class="keys"></div>
  <div class="ft">갑판을 걸어 조타륜으로 향하라</div>`;
  document.body.appendChild(el);
}

// 단계별 튜토 내용 (엘든링식: 제목 + 설명문단 + 키안내 + 우측 이미지 + 하단 안내)
// ★튜토 리뉴얼(사령관 기획 2026-07-05 / 2026-07-12 개편): "직접 알아내라" → "추종자가 알려주는" 안내체.
//   ★2026-07-12 대포 스테이션 폐지 — 흐름: steer(조타 잡기)→sail(돛)→navigate(A/D)→[적 등장]→combat(조타 유지한 채 우클릭 조준+좌클릭 직접 발사).
//   추종자는 조타를 인수하지 않는다(대사 안내만). 플레이어가 조타하며 직접 조준·사격.
const TUTO_STEPS = {
  steer: { title:'추종자 — "키를 잡아보세요"',
    text:`<p>"바람이 좋아요. 우선 <b style="color:#f0d9a8">조타륜</b>부터 잡아보세요."</p><p>"선미의 조타륜 앞으로 가서 키를 잡으면, 이 배는 선장님 것이 됩니다."</p>`,
    keys:[['Z','조타륜을 잡는다 / 놓는다']],
    img:'/tomob-deploy/ui/tuto_steer.png',
    foot:'갑판을 걸어 조타륜으로 — [Z]' },
  sail: { title:'추종자 — "돛을 펴보세요"',
    text:`<p>"좋아요, 키를 잡으셨네요. 이제 <b style="color:#f0d9a8">돛</b>을 펴서 바람을 받아보세요."</p><p>"활짝 펼수록 빨라져요. 멈추고 싶으면 접으면 됩니다."</p>`,
    keys:[['W','돛을 편다'],['S','돛을 접는다']],
    img:'/tomob-deploy/ui/tuto_sail.png',
    foot:'W를 눌러 돛을 끝까지 펴 보세요' },
  navigate: { title:'추종자 — "방향을 틀어보세요"',
    text:`<p>"바람을 탔어요! 이제 원하는 곳으로 방향을 틀어보세요."</p><p>"키는 <b style="color:#f0d9a8">A/D</b>로 돌립니다. 배는 천천히 도니까 미리미리 트세요."</p>`,
    keys:[['A','왼쪽으로 조타'],['D','오른쪽으로 조타'],['Z','키를 놓는다']],
    img:'/tomob-deploy/ui/tuto_navigate.png',
    foot:'A/D로 자유롭게 항해해 보세요' },
  combat: { title:'추종자 — "직접 쏘세요!"',
    // ★2026-07-15(사령관): 옛 '우클릭 조준' 스킴 → 실제 조작인 Q/E 현측 조준 스킴으로 교체.
    //   현재 발사 경로는 Q/E 조준 중이 아니면 발사 자체가 안 됨(navalcombat.js) → 우클릭 안내는 오조작.
    text:`<p>"<span style="color:#ff9a8a">적 해적선이에요!</span> <b style="color:#f0d9a8">Q</b>(좌현)·<b style="color:#f0d9a8">E</b>(우현)로 겨눌 현측을 정하면 조준선(탄도 곡선)이 나타나요."</p><p>"마우스로 겨누고 <b style="color:#f0d9a8">좌클릭</b>이면 그쪽 현측 대포가 일제사격해요. <b>A/D</b>로 뱃머리를 돌려 적 옆구리를 노리고, 급하면 <b>Shift</b>로 전력항해하세요. <span style="color:#ff9a8a">적도 쏩니다 — 오래 끌지 마세요!</span>"</p>`,
    keys:[['Q','E','좌·우현 조준 시점'],['좌클릭','현측 일제사격'],['A','D','조타(뱃머리)'],['Shift','전력 항해']],
    img:'/tomob-deploy/ui/tuto_combat.png',
    foot:'Q·E로 현측 조준 · 좌클릭 발사 · A/D로 적 옆구리를 노려라' },
};

export async function initOpening(ctx, opts={}){
  const setLoad = opts.setLoad || (()=>{});
  const M = opts.mode==='game';   // ★P4-B: game.html 단일 진입 모드(오세베르그 없이, 깨어남=이미 로딩된 월드 지형, 페이지 이동 없음)
  let _cutDone=false;             // 깨어나 일어선 뒤 = 컷신 카메라 핀 해제 플래그
  ensureTutoDom();
  const tuto = document.getElementById('tuto');
  const tutoTi = tuto.querySelector('.ti');
  const tutoTx = tuto.querySelector('.tx');
  const tutoKeys = tuto.querySelector('.keys');
  const tutoImg = tuto.querySelector('.img');
  const tutoFt = tuto.querySelector('.ft');
  const tutoX = tuto.querySelector('.x');
  // ★오버레이 닫기/열기 — ✕클릭 또는 X키로 토글. 닫으면 단계 전환돼도 안 뜸(존중).
  let _tutoHidden = false, _tutoDone = false;   // _tutoDone = 튜토리얼 1세트 전 단계 완료 → 영구 닫힘
  function closeTuto(){ _tutoHidden = true; tuto.classList.remove('show'); }
  function openTuto(){ _tutoHidden = false; tuto.classList.add('show'); }
  function toggleTuto(){ _tutoHidden ? openTuto() : closeTuto(); }
  tutoX.addEventListener('click', closeTuto);
  // ★키 입력 피드백 — 그 조작 키를 누르면 칩이 활성화(글로우)되고, 떼면 그 힌트가 사라짐(배운 조작 제거).
  const _chipKey = e => (e.code && e.code.startsWith('Key')) ? e.code.slice(3) : null;   // 'KeyQ'→'Q'
  window.addEventListener('keydown', e=>{
    if(e.code==='KeyX'){ if(e.repeat) return; toggleTuto(); return; }   // ★키 반복(누름 유지)으로 토글 흔들리던 것 방지
    const k=_chipKey(e); if(!k || _tutoHidden) return;
    tutoKeys.querySelectorAll('.k[data-k="'+k+'"]').forEach(chip=>chip.classList.add('active'));   // 누르는 동안 활성화
  });
  window.addEventListener('keyup', e=>{
    const k=_chipKey(e); if(!k) return;
    tutoKeys.querySelectorAll('.k[data-k="'+k+'"]').forEach(chip=>{
      chip.classList.remove('active');
      const row=chip.closest('.row');
      if(row && !row.dataset.done){ row.dataset.done='1'; row.classList.add('done'); }   // 한 번 써본 조작 → 힌트 페이드아웃
    });
  });
  function showTuto(step){
    if(_tutoDone) return;   // ★튜토리얼 1세트(전 단계) 완료 → 영구 닫힘.
    const s = TUTO_STEPS[step]; if(!s) return;
    tutoTi.textContent = s.title;
    tutoTx.innerHTML = s.text;
    tutoKeys.innerHTML = s.keys.map(r=>{
      const keys = r.slice(0,-1);
      const ks = keys.map(k=>`<span class="k" data-k="${k}">${k}</span>`).join(' ');
      return `<div class="row" data-keys="${keys.join('')}">${ks}<span style="color:#b8af9a">${r[r.length-1]}</span></div>`;
    }).join('');
    tutoImg.style.backgroundImage = `url('${s.img}')`;
    tutoFt.innerHTML = `${s.foot} <span style="opacity:.5">·</span> <span style="opacity:.7">[X] 닫기</span>`;
    if(!_tutoHidden) tuto.classList.add('show');   // 유저가 닫았으면 단계 전환돼도 강제로 안 띄움(내용만 갱신)
  }
  window.showTuto = showTuto;   // 디버그/검증 훅

  // ── [3] 해적선 전투 재료(대포·파괴물리·침몰) — _navalcombat.html 정본 순서 그대로 ──
  setLoad('대포 장전 중…');
  if(!M) initCannon(ctx);   // game 모드: game.html이 이미 initCannon 함(중복 방지)
  try { initDestruct(ctx); } catch(e){ console.warn('[opening] destruct 실패(파편 비활성)', e&&e.message); }
  try { initShipwreck(ctx); } catch(e){ console.warn('[opening] shipwreck 실패(격침=폴백)', e&&e.message); }
  // ⚡ 적선(queen GLB+DRACO wasm)·조타수 리그 백그라운드 프리로드 — 전투 개시 순간 콜드 로드 히칫 제거.
  //   (await 안 함 = 로딩 비차단. 인카운트는 navigate 10초 뒤라 시간 충분 — 캐시 적중으로 즉시 스폰)
  preloadShip('/tomob-deploy/obj/queen-annes-revenge/optimized.glb').catch(e=>console.warn('[opening] queen 프리로드 실패(전투 시 로드)', e&&e.message));
  preloadHelmRig().catch(e=>console.warn('[opening] 조타수 프리로드 실패(전투 시 로드)', e&&e.message));

  // ── caravel — open water에. game 모드는 이미 로딩된 섬(카브)에서 멀리 떨어진 먼 바다에 띄운다(원점 겹침 방지). ──
  setLoad('배(caravel) 띄우는 중…');
  const _isSp = (ctx.terrain && ctx.terrain.spawn) ? ctx.terrain.spawn : { x:0, z:0 };
  const shipSpawn = M ? { x:_isSp.x + 1500, z:_isSp.z + 1500 } : { x:0, z:0 };
  const ship = await initShip(ctx, {
    spawn:shipSpawn, objUrl:'/tomob-deploy/obj/caravel-ship/source/model.fbx', length:56,
    albedoDir:'/tomob-deploy/obj/caravel-ship/textures/', stripRig:true, center:true,
    useModelHelm:true, flip:true, clothSail:true,
    cannonStations:true,   // ★2026-07-10(사령관 "Z눌러도 대포조준 안됨") — 빠져있어서 시작 캐러벨엔 대포 스테이션 자체가 없었음(shipyard 건조배만 true였음).
  });
  // ── ★스폰 출렁임 방지(오프닝 전용): 배 부력을 평형 흘수로 미리 정착 ──
  if(ctx.water && ctx.water.heightAt){
    const sC = ctx.water.heightAt(ship.x, ship.z);
    ship.buoyY = sC - ship.deckLocalY*0.4;   // 평형 흘수
    ship.pitchA = 0; ship.roll = 0;
    if(ship.mesh) ship.mesh.position.y = ship.buoyY;
  }
  // ── 플레이어 = caravel 갑판 위에 1인칭으로 스폰 ──
  const deckWorldY = ship.mesh.position.y + ship.deckLocalY;   // 갑판 윗면 월드 높이(평형 정착 후)
  setLoad('갑판에 오르는 중…');
  const _selChar=(new URLSearchParams(location.search).get('char')||'').toLowerCase();
  if(M){
    // ★game 모드: game.html이 이미 만든 ctx.player 재사용 → caravel 갑판으로 텔레포트(중복 initPlayer 금지)
    try { ctx.player.setSpawn(ship.x + 3, deckWorldY + 1, ship.z); } catch(_){}
  } else {
    initPlayer(ctx, { spawn:{ x:ship.x + 3, y:deckWorldY + 1, z:ship.z },
                      charUrl: KAY_CHARS[_selChar] || KAY_CHARS.knight });
  }
  ctx.player.setThird(false);   // ★오프닝 = 1인칭 고정
  if(ship.starArrow) ship.starArrow.visible=false;
  if(ship.portArrow) ship.portArrow.visible=false;
  // (B) 첫 경험 친절: 시작 배를 바람 방향에 정렬 → 돛만 펴면 바로 전진(catchF≈1).
  { const wd = (ctx.wind && ctx.wind.dir!=null) ? ctx.wind.dir : 0;
    ship.yaw = -Math.PI/2 + wd;
  }
  // ── 첫 시점 = 조타륜(선미) 쪽을 바라보게 ──
  requestAnimationFrame(()=>{
    const s=ctx.ship;
    if(s && s.helmLocal && s.curMatrix){
      const hw = s.helmLocal.clone().applyMatrix4(s.curMatrix);
      const p = ctx.player.pos;
      ctx.player.setYaw(Math.atan2(hw.x - p.x, -(hw.z - p.z)));
    }
  });
  // ── 곡괭이 → 맨손 시작 (항해 튜토엔 도구 불필요) ──
  { let _t=0; const bare=()=>{ _t++;
      if(ctx.player.currentTool==='pickaxe'){ ctx.player.equipTool('none'); return; }
      if(_t<60) setTimeout(bare,100); };
    setTimeout(bare,120); }

  // ── 사운드 + 비 VFX(초기 OFF) ──
  if(!M) try { initSound(ctx); } catch(e){ console.warn('[opening] sound 실패', e&&e.message); }   // game 모드: game.html이 이미 initSound
  try { if(ctx.sound) ctx.sound.noWater = true; } catch(_){}   // ★오프닝 = 수영/입수 사운드 OFF (game 모드는 깨어난 뒤 finishWake서 복구)
  const rain = initRain(ctx);

  // ── 물리 스텝(항상 마지막) — game 모드는 game.html이 등록(중복 방지) ──
  if(!M) ctx.onUpdate(()=> ctx.stepPhysics());

  // ── 튜토 팝업: 조타 상태에 따라 단계 전환 ──
  showTuto('steer');
  let _phase = 'steer', _wasBoarded = false;
  // ★2026-07-10(사령관 "배 타니까 튜토리얼 되고 한번더 배가 파괴됨") — 이 핸들러가 offUpdate 없이 등록돼 있어서
  //   window.__noNaval(기본 ON, 해상전투 스킵) 경로에선 _outcome이 끝까지 null로 남아 오프닝 종료 후에도 평생 살아남았음.
  //   그 결과 나중에 진짜 배를 새로 타고 대포 스테이션에 서면 이 핸들러가 오프닝 전투 튜토를 다시 띄웠음(finishWake에서 해제).
  const _tutoUpd = ctx.onUpdate(()=>{
    const s = ctx.ship; if(!s) return;
    if(s.boarded && !_wasBoarded && s.forward){
      ctx.player.setYaw(Math.atan2(s.forward.x, -s.forward.z));   // 뱃머리(forward) 방향을 바라봄
    }
    _wasBoarded = s.boarded;
    if(_outcome){ return; }
    if(_encStarted){
      // ★2026-07-12 대포 스테이션 폐지: 적 등장 → 곧바로 combat(조타 유지한 채 우클릭 조준+좌클릭 직접 발사).
      //   더 이상 대포 앞으로 가서 [Z] 잡을 필요 없음. 추종자 조타 인수도 없음.
      if(_phase!=='combat'){ _phase='combat'; _tutoHidden=false; showTuto('combat'); }
      return;
    }
    const next = !s.boarded ? 'steer' : ((s.furl||0) > 0.45 ? 'sail' : 'navigate');
    if(next!==_phase){ _phase=next; _tutoHidden=false; showTuto(next); }
  });
  // ★navigate 단계: 조타(A/D — 2026-07-04 키 개편) 한 번 해보면 1.5s 뒤 안내 자동 닫힘
  let _navHideArmed=false;
  window.addEventListener('keyup', e=>{
    if(_phase==='navigate' && !_encStarted && !_navHideArmed && (e.code==='KeyA'||e.code==='KeyD')){
      _navHideArmed=true;
      setTimeout(()=>{ if(_phase==='navigate' && !_encStarted) closeTuto(); }, 1500);
    }
  });

  // ════════════════════════════════════════════════════════════════
  //  [3] 해적선 전투 → [4] 표류
  // ════════════════════════════════════════════════════════════════
  let _enc=null, _encStarted=false, _outcome=null, _navTimer=0;
  const _spawnX=ship.x, _spawnZ=ship.z;

  function ncToast(msg, ms=2800, accent='white'){ ukToast(msg, { ms, accent }); }

  async function startEncounter(){
    _tutoHidden=false;
    ncToast('적 해적선 출현! — Q·E로 좌/우현 조준, 좌클릭으로 현측 일제사격!', 4600, 'red');
    const _closeOnFire = e=>{ if(e.button===0 && _phase==='combat'){ _tutoDone=true; closeTuto(); window.removeEventListener('mousedown', _closeOnFire, true); } };
    window.addEventListener('mousedown', _closeOnFire, true);
    _enc = await startNavalEncounter(ctx, {
      count:1, keys:['queen'], far:230, revealDelay:0,
      naval:{ respawn:false, playerMaxHp:180, enemyFireCd:7.5, enemySpread:2.2, aiTurn:0.36 },
    });
    if(!_enc || !_enc.naval){ console.warn('[opening] 인카운트 실패'); return; }
    const _pollWL = ctx.onUpdate(()=>{          // 승패 폴링 — 판정 후 자기해제(콜백 누적 방지)
      if(_outcome || !_enc) return;
      const st=_enc.naval.state();
      if(st.pSunk){ _outcome='lose'; ctx.offUpdate?.(_pollWL); onLose(); }
      else if(st.eSunk){ _outcome='win'; ctx.offUpdate?.(_pollWL); onWin(); }
    });
  }

  // 인카운트 트리거 — navigate 후 10초 경과 시 적선 등장 (발동 후 자기해제)
  const _pollEnc = ctx.onUpdate(dt=>{
    if(_encStarted){ ctx.offUpdate?.(_pollEnc); return; }
    const s=ctx.ship; if(!s) return;
    if(_phase==='navigate' && s.boarded){
      _navTimer += dt;
      // 🧪 임시 테스트: 적선 OFF면 오프닝 전투 스킵 → 바로 난파·표류·깨어남(onWin 재사용). 복구 ?combat=1
      if(_navTimer > 10){ _encStarted=true; if(window.__noNaval){ onWin(); } else startEncounter(); }
    }
  });

  // 폭풍 화면 틴트
  function addStormTint(){
    if(document.getElementById('stormTint')) return;
    const t=document.createElement('div'); t.id='stormTint';
    t.style.cssText='position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;transition:opacity 2.4s ease;'
      +'background:radial-gradient(120% 90% at 50% 0%,rgba(40,52,66,.12),rgba(12,18,26,.56));';
    document.body.appendChild(t); requestAnimationFrame(()=>{ t.style.opacity='1'; });
  }

  // ★실제 플레이어(아바타+무기 뷰모델) 완전 숨김 — 컷신은 전용 prop 캐릭터를 쓰므로 본체는 안 보여야 함.
  let _actorHidden=false, _actorHideReg=false;
  function setActorHidden(v){
    _actorHidden=v;
    if(v){ try{ ctx.player.setThird(true); }catch(_){}
           try{ if(ctx.player && ctx.player.avatar) ctx.player.avatar.visible=false; }catch(_){} }
    if(!_actorHideReg){ _actorHideReg=true;
      ctx.onUpdate(()=>{ if(_actorHidden){ try{ if(ctx.player && ctx.player.avatar) ctx.player.avatar.visible=false; }catch(_){} } }); }
  }

  // ── 승리: 5초 항해 → 내구도 게이지 감소(빨간 번쩍) → 0이면 두 동강 → 표류 ──
  function onWin(){
    closeTuto();
    if(_enc && _enc.naval) try{ _enc.naval.dispose(); }catch(_){}
    const s=ctx.ship;
    let dur0 = (s && s.durability!=null) ? Math.min(s.durability, 60) : 60;
    if(s) s.durability = dur0;
    ncToast('적선 격침!', 3000, 'gold');
    // ★승리 소보상(사령관 기획 2026-07-05 — 이기든 지든 난파하지만 이긴 값은 챙겨줌)
    try{ if(ctx.inventory && ctx.inventory.addGold){ ctx.inventory.addGold(150); setTimeout(()=>ncToast('전리품 회수 — 금화 +150', 3200, 'gold'), 3100); } }catch(_){}
    // ★2026-07-12(사령관): 비가 먼저 서서히 내리기 시작(rain fade-in 1.4s) → 하늘 어두워짐 → 폭풍 심화 → 난파.
    //   기존엔 비 한 방울 없이 폭풍 틴트가 갑툭 떴음("바로 비가 안 내리는데 폭풍이 와서 이상함").
    setTimeout(()=>{ try{ rain.start(); }catch(_){} ncToast('하늘이 어두워진다 — 비바람이 몰려온다…', 3600, 'white'); }, 1800);   // 격침 직후: 비 시작
    setTimeout(()=>{
      addStormTint();   // 비가 자리잡은 뒤에야 폭풍(붉은 비네트)
      ncToast('폭풍이다! 배가 버티지 못한다 — 수리가 필요합니다', 3800, 'red');
      setTimeout(()=> stormDecay(s, dur0), 2800);
    }, 6500);   // 5000→6500: 비 빌드업 시간 확보(비→폭풍 순서)
  }
  function stormDecay(s, dur0){
    let dur = dur0;
    ncToast('내구도가 손상되어 수리가 필요합니다 — 폭풍에 배가 버티지 못한다', 4600, 'red');
    const dg = ukGauge({ label:'내구도', icon:'ship', accent:'hp', value:dur, max:100, width:210 });
    requestAnimationFrame(()=> dg.el.classList.add('show'));
    const vig=document.createElement('div'); vig.id='stormVig';
    vig.style.cssText='position:fixed;inset:0;z-index:24;pointer-events:none;opacity:0;box-shadow:inset 0 0 160px 40px rgba(190,0,0,.82);transition:opacity .14s ease';
    document.body.appendChild(vig);
    function stormFlash(strength){
      vig.style.transition='opacity .09s ease'; vig.style.opacity=String(Math.min(1,strength));
      setTimeout(()=>{ vig.style.transition='opacity .42s ease'; vig.style.opacity='0'; }, 100);
      try { ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/tomob-deploy/w2.mp3', 0.28*strength); } catch(_){}
    }
    let broke=false, _flashAcc=0;
    ctx.onUpdate(dt=>{
      if(broke) return;
      dur = Math.max(0, dur - dt*(60/12));
      if(s) s.durability = dur;
      dg.set(dur);
      const r = dur/60;
      _flashAcc += dt;
      if(_flashAcc >= (1.4 + r*1.8)){ _flashAcc=0; stormFlash(0.4 + (1-r)*0.5); }
      if(dur <= 0){
        broke = true;
        ncToast('배가 부서진다…', 2400, 'red');
        stormFlash(1);
        setActorHidden(true);
        try { if(ctx.ship){ ctx.ship.boarded=false; ctx.ship.speed=0; ctx.ship.furl=1; } } catch(_){}
        try { ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/tomob-deploy/storm.mp3', 0.7); } catch(_){}
        try { ctx.shipwreck && ctx.shipwreck.sink(s); } catch(e){ console.warn('[opening] 배 부서짐 실패', e&&e.message); }
        setTimeout(()=>{ vig.remove(); dg.el.classList.remove('show'); setTimeout(()=>dg.dispose(), 600); }, 1200);
        setTimeout(()=> driftWake('win'), 3000);
      }
    });
  }
  // ── 패배: 내 배 부서짐 ── ★오프닝은 튜토리얼 골든패스 → 게임오버(리로드로 튜토 재시작) 아님.
  //   져도 이겨도 배가 부서지면 똑같이 표류→깨어남으로 이어진다(사령관 "다르게 발동" — 본편 게임오버와 구분. Raft식 온보딩=오프닝 실패 없음).
  function onLose(){
    closeTuto();
    if(_enc && _enc.naval) try{ _enc.naval.dispose(); }catch(_){}
    try { if(ctx.ship){ ctx.ship.boarded=false; ctx.ship.speed=0; ctx.ship.furl=1; } } catch(_){}
    try { if(ctx.shipwreck && ctx.ship) ctx.shipwreck.sink(ctx.ship); } catch(_){}   // 아직 안 부서졌으면 침몰 연출
    setActorHidden(true);
    setTimeout(()=> driftWake('lose'), 2400);   // 난파 → 깨어남 (게임오버 화면 없음)
  }
  // ── ESC 메뉴 "튜토리얼 건너뛰기"(사령관 2026-07-10) — onLose와 동일한 검증된 파이프(sink→driftWake)를 즉시 트리거.
  //   승패 미결정 상태(!_outcome)에서만 허용 — 이미 침몰 진행 중이면 자연 흐름과 충돌 방지. 좀비 핸들러(_tutoUpd/_pollEnc)도 여기서 확실히 해제.
  function skipToGame(){
    if(_outcome) return false;
    _outcome='win'; _encStarted=true;
    closeTuto(); _tutoDone=true;
    try{ ctx.offUpdate?.(_tutoUpd); }catch(_){}
    try{ ctx.offUpdate?.(_pollEnc); }catch(_){}
    if(_enc && _enc.naval) try{ _enc.naval.dispose(); }catch(_){}
    try { if(ctx.ship){ ctx.ship.boarded=false; ctx.ship.speed=0; ctx.ship.furl=1; } } catch(_){}
    try { if(ctx.shipwreck && ctx.ship) ctx.shipwreck.sink(ctx.ship); } catch(_){}
    setActorHidden(true);
    setTimeout(()=> driftWake('win'), 800);   // 짧은 침몰 컷 뒤 표류→깨어남(★터짐 즉시 워프는 씬 상태 리스크가 커서 안 함)
    return true;
  }
  // ── GAME OVER 화면 ──
  function gameOver(){
    try { document.exitPointerLock && document.exitPointerLock(); } catch(_){}
    try { ctx.player.setThird && ctx.player.setThird(false); } catch(_){}
    rain.stop();
    // ★버그 수정(2026-07-14): 배 부서짐 시 stormDecay가 튼 storm.mp3(60초 폭풍 굉음)는 fire-and-forget 1회 재생이라
    //   rain.stop()으로는 안 꺼짐 — 게임오버 진입 시 확실히 정지.
    try { ctx.sound && ctx.sound.stopPath && ctx.sound.stopPath('/tomob-deploy/storm.mp3'); } catch(_){}
    ['helmDbg','fps','boatHud','windHud','hotbar','cross','badge','tuto','tuto-toast'].forEach(id=>{const e=document.getElementById(id); if(e)e.style.display='none';});
    const st=document.createElement('style'); st.id='goStyle';
    st.textContent=`
      #gameOver{position:fixed;inset:0;z-index:650;display:flex;flex-direction:column;align-items:center;justify-content:center;
        background:radial-gradient(120% 100% at 50% 46%,rgba(5,4,6,.92),rgba(0,0,1,.99));
        font-family:'Pretendard',system-ui,sans-serif;text-align:center;opacity:0;transition:opacity 1.6s ease;}
      #gameOver.on{opacity:1;}
      #gameOver .goEmblem{position:relative;width:min(480px,66vw);aspect-ratio:1/1;
        background:url('/tomob-deploy/GAMEOVER.png') center/contain no-repeat;
        animation:goPulse 3.6s ease-in-out infinite;}
      @keyframes goPulse{0%,100%{filter:brightness(1.18) saturate(1.28) drop-shadow(0 0 18px rgba(220,34,28,.5)) drop-shadow(0 0 7px rgba(255,90,66,.5));}
        50%{filter:brightness(1.26) saturate(1.35) drop-shadow(0 0 34px rgba(240,46,40,.72)) drop-shadow(0 0 13px rgba(255,100,76,.6));}}
      #gameOver .goCtr{position:absolute;left:0;right:0;top:51%;transform:translateY(-50%);}
      #gameOver .goBack{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);width:70%;height:52%;border-radius:50%;
        background:radial-gradient(ellipse at center,rgba(0,0,0,.96) 0%,rgba(0,0,0,.9) 40%,rgba(0,0,0,.55) 66%,transparent 84%);filter:blur(7px);}
      #gameOver .goTitle{position:relative;font-size:clamp(40px,5.6vw,66px);font-weight:900;color:#ff5142;letter-spacing:.03em;line-height:1;
        text-shadow:0 0 2px rgba(0,0,0,.95),0 0 5px rgba(0,0,0,.85),0 0 14px rgba(255,80,60,.95),0 0 28px rgba(230,32,22,.55);}
      #gameOver .goSub{position:relative;margin-top:9px;font-size:clamp(10px,1.18vw,14px);font-weight:800;letter-spacing:.2em;
        color:#ff7a68;text-shadow:0 0 2px rgba(0,0,0,.9),0 0 9px rgba(255,80,62,.7);padding-left:.2em;}
      #gameOver .goSub::before{content:'~ ';opacity:.5;} #gameOver .goSub::after{content:' ~';opacity:.5;}
      #gameOver .goDesc{margin-top:14px;font-size:15px;color:#c7baa6;text-shadow:0 1px 3px #000;}
      #gameOver .goWait{margin-top:24px;font-size:15px;color:#9a8e7c;letter-spacing:.04em;}
      #gameOver .goWait b{color:#ffd98a;font-size:21px;font-weight:800;margin:0 3px;}
      #gameOver .goBtn{margin-top:16px;font:700 15px Pretendard,system-ui;letter-spacing:.12em;
        color:#6a5f50;padding:13px 42px;border:1px solid rgba(120,80,70,.35);border-radius:6px;
        background:linear-gradient(180deg,rgba(24,16,16,.85),rgba(12,8,8,.92));transition:.25s;
        pointer-events:none;opacity:.55;cursor:default;}
      #gameOver .goBtn.ready{pointer-events:auto;cursor:pointer;opacity:1;color:#e7d6b8;border-color:rgba(190,60,50,.55);
        background:linear-gradient(180deg,rgba(40,15,15,.9),rgba(17,8,8,.95));}
      #gameOver .goBtn.ready:hover{color:#fff;border-color:rgba(232,72,60,.9);box-shadow:0 0 24px -6px rgba(232,52,42,.7);}
    `;
    document.head.appendChild(st);
    const ov=document.createElement('div'); ov.id='gameOver';
    ov.innerHTML=`
      <div class="goEmblem"><div class="goCtr">
        <div class="goBack"></div>
        <div class="goTitle">침몰</div>
        <div class="goSub">VOYAGE ENDED</div>
      </div></div>
      <div class="goDesc">선장이 쓰러졌고, 항해는 표류를 시작했다.</div>
      <div class="goWait" id="goWait">부활 가능까지 <b>5</b> 초</div>
      <button class="goBtn" id="goRetry">다시 시도</button>`;
    document.body.appendChild(ov);
    requestAnimationFrame(()=>ov.classList.add('on'));
    const $wait=ov.querySelector('#goWait'), $waitN=$wait.querySelector('b'), $btn=ov.querySelector('#goRetry');
    let _n=5;
    const tick=()=>{ _n--; if(_n>0){ $waitN.textContent=_n; setTimeout(tick,1000); }
      else { $wait.style.display='none'; $btn.classList.add('ready'); } };
    setTimeout(tick,1000);
    // ★사령관 2026-07-10: 튜토 중 배 터지면 "다시 시도"가 location.reload()로 튜토를 처음부터 재시작했음(안 넘어감).
    //   오프닝은 실패 없는 Raft식 온보딩(라인 361~) → 새로고침이 아니라 onLose와 동일한 표류→깨어남으로 게임 진입시킨다.
    $btn.addEventListener('click',()=>{ if(!$btn.classList.contains('ready')) return;
      try{ ov.remove(); const _st=document.getElementById('goStyle'); _st&&_st.remove(); }catch(_){}
      try{ ctx.offUpdate?.(_tutoUpd); ctx.offUpdate?.(_pollEnc); }catch(_){}
      driftWake('lose'); });
  }

  // ── 표류 기상 컷신 ──
  let _cutCam=null, _cutsceneActive=false;
  async function driftWake(result){
    if(_cutsceneActive) return;
    _cutsceneActive=true;
    // ★2026-07-12(사령관): 검정화면~전체 섬 전경 사이엔 해역 배너 억제 — 홈섬 스폰(검정 뒤)에서 배너가 검정 위에 먼저 뜨던 것 방지.
    //   검정 걷히고 깜빡임+전경 나올 때 해제 → worldstream이 그 순간 배너 발동(아래 5)단계).
    try{ ctx._suppressBanner = true; }catch(_){}
    // ★오프닝 배 정리 — 적선(queen)·내 배(caravel)를 씬에서 제거(깨어난 뒤 배가 떠있던 것, 사령관). 난파 연출은 이미 끝난 뒤 호출됨.
    try { if(_enc && _enc.enemies) _enc.enemies.forEach(E=>{ try{ if(E&&E.mesh) ctx.scene.remove(E.mesh); }catch(_){} }); } catch(_){}
    try { if(ship && ship.mesh) ctx.scene.remove(ship.mesh); } catch(_){}
    try { if(_enc && _enc.naval && _enc.naval.dispose) _enc.naval.dispose(); } catch(_){}
    // ★버그①: 오프닝 침몰 잔해가 정리 안 된 채 게임 씬(다른 지형/수면고도)에 넘어가면 FADE_DEPTH 도달 못해 물소리 무한재생 → 표류 전환 시 회수
    try { ctx.shipwreck && ctx.shipwreck.clear && ctx.shipwreck.clear(); } catch(_){}
    ctx.noPointerLock=true;
    try { document.exitPointerLock && document.exitPointerLock(); } catch(_){}
    rain.stop();
    // ★버그 수정(2026-07-14): stormDecay(onWin 배 부서짐)에서 sfxPath('/tomob-deploy/storm.mp3')로 튼 60초 폭풍 굉음은
    //   fire-and-forget 1회 재생이라 rain.stop()(시각 VFX만 정지)으로는 안 꺼짐 → 표류→깨어남 전환 시 상륙 후에도
    //   비/폭풍 소리가 계속 들리던 원인. 표류 컷신 진입 시 확실히 정지.
    try { ctx.sound && ctx.sound.stopPath && ctx.sound.stopPath('/tomob-deploy/storm.mp3'); } catch(_){}
    try { if(ctx.ship){ ctx.ship.boarded=false; ctx.ship.speed=0; ctx.ship.furl=1; ctx.ship.rudder=0; } } catch(_){}
    try { if(ctx.sound){ ['boat','swim'].forEach(k=>{ if(ctx.sound[k]){ ctx.sound[k].muted=true; ctx.sound[k].pause(); } }); } } catch(_){}
    const _aRamp=(a,to,ms)=>{ if(!a)return; const from=a.volume||0, t0=performance.now();
      const st=setInterval(()=>{ const k=Math.min(1,(performance.now()-t0)/ms); a.volume=Math.max(0,Math.min(1,from+(to-from)*k)); if(k>=1){ clearInterval(st); if(to<=0){ try{a.pause();}catch(_){} } } }, 50); };
    try { if(ctx.sound){ _aRamp(ctx.sound.ocean, 0.2, 900); _aRamp(ctx.sound.bgm, 0, 900);
      const _oc=ctx.sound.ocean; if(_oc){ _oc.muted=false; if(_oc.paused) _oc.play&&_oc.play().catch(()=>{}); } } } catch(_){}
    try { const _st=document.getElementById('stormTint'); if(_st) _st.remove(); } catch(_){}
    try { if(ctx.scene && ctx.scene.fog){ ctx.scene.fog.near=600; ctx.scene.fog.far=2600; } } catch(_){}
    // 1) 검정 3초 + 바다소리 먼저
    const black=document.createElement('div');
    black.style.cssText='position:fixed;inset:0;z-index:600;background:#000;opacity:0;transition:opacity 1.1s ease';
    document.body.appendChild(black); requestAnimationFrame(()=>black.style.opacity='1');
    // ★검정이 완전히 덮인 뒤에 섬 셋업(카메라 wide 점프 포함) — 반투명 페이드인 중 섬이 살짝 비쳤다 사라지던 flash 제거(사령관 지적)
    await new Promise(r=>setTimeout(r, 1150));   // 페이드인(1.1s) 완료 대기
    // 2) 검정 뒤에서 섬 본 씬 셋업
    try { await buildIslandWake(); } catch(e){ console.warn('[opening] 섬 씬 실패', e&&e.message); }
    await new Promise(r=>setTimeout(r, 1850));   // 나머지 유지(총 검정 ~3초)
    // 3) 검정 페이드아웃 + 시네마틱 레터박스 + 눈 깜빡
    black.style.opacity='0'; setTimeout(()=>black.remove(), 1200);
    _cinFrame = cinematicFrame();
    await customBlink();
    try { const oc=ctx.sound&&ctx.sound.ocean; if(oc){ oc.muted=false; if(oc.paused) oc.play&&oc.play().catch(()=>{}); _aRamp(oc, 0.28, 2000); } } catch(_){}
    // 4) 지역 reveal — ★2026-07-12(사령관 F): 검정화면이 아니라, 깜빡임 직후 "전체 섬 전경"이 보일 때 해역 배너가 떠야 한다.
    //    여기서 억제 해제 → worldstream regionBanner(홈섬='고향의 섬 / 내 영해')가 다음 프레임(전경 시점)에 자연 발동.
    //    (opening 자체 배너는 안 띄움 — worldstream 일원화. 튜토리얼 한정 = driftWake만 _suppressBanner를 씀.)
    try{ ctx._suppressBanner = false; }catch(_){}
    // 5) 카메라 무빙
    await new Promise(r=>setTimeout(r, 2600));
    const _qp=new URLSearchParams(location.search);
    const _pname=(_qp.get('name')||'').trim()||'선장';
    const _fname=(_qp.get('followerName')||'').trim()||'추종자';
    // ★깨어나 일어서기 — 컷신 정리 + 1인칭 복귀 + onComplete(게임 시작). 페이지 이동 없음(game 모드).
    // ★추종자 = 퀘스트 giver. 일어선 직후 곁의 동료가 '퀘스트 수락' 패널을 띄우고, 수락해야 퀘스트라인 시작 (사령관: RPG 퀘스트 수락식).
    const offerFollowerQuest = ()=>{
      const _qp=new URLSearchParams(location.search);
      const fnm=(_qp.get('followerName')||'').trim()||'동료';
      const pnm=(_qp.get('name')||'').trim()||'선장';
      const start = ()=>{ ctx.noPointerLock=false; (opts.onComplete || showDriftHandoff)(); };   // 수락 = 퀘스트라인 시작
      if(!_cutFol || !_cutFol.group){ start(); return; }   // 추종자 없으면 폴백=즉시 시작
      // ── 추종자 머리 위 퀘스트 마커 + 바라보면 수락 패널 — RPG 표준(WoW식 '!' 마커·근접+시선 상호작용, 웹리서치 근거) ──
      //   ★2026-07-13 수정: 옛 화면투영 ❗이모지 대신 questfx.js의 실제 퀘스트 아이콘(3D 빌보드)을 그대로 사용.
      //   force(true)=말 걸기 전부터 상시 표시, [E]로 말 걸면 force(false)로 소거 → 수락 후엔 questline이 __questStep으로 다시 이어받음.
      try{ ctx.questfx && ctx.questfx.force(true); }catch(_){}
      const hint=document.createElement('div'); hint.id='folQuestHint';
      hint.style.cssText="position:fixed;left:0;right:0;bottom:13%;z-index:58;text-align:center;pointer-events:none;font-family:'Pretendard',system-ui,sans-serif;font-size:14px;color:#e9dcc0;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .5s";
      hint.innerHTML="곁의 <b style=\"color:#8fd3ff\">"+fnm+"</b>에게 다가가 바라보라";
      document.body.appendChild(hint);
      requestAnimationFrame(()=>{ hint.style.opacity='1'; });
      const _fp=new THREE.Vector3(); let opened=false, near=false;
      ctx.onUpdate(()=>{
        if(opened) return;
        if(!_cutFol||!_cutFol.group) return;
        _cutFol.group.getWorldPosition(_fp);
        const pp=ctx.player.pos; near = Math.hypot(pp.x-_fp.x, pp.z-_fp.z) < 5;   // 근접(5m)이면 말 걸기 가능
        hint.style.opacity='1';
        hint.innerHTML = near ? "<b style=\"color:#f0d9a8\">[E]</b> "+fnm+"에게 말 걸기"
                              : "곁의 <b style=\"color:#8fd3ff\">"+fnm+"</b>에게 다가가세요";
      });
      // ★E키로 말 걸기(근접 시) — 앞에 가서 자동 아님(사령관). 다가가 E로 대화→퀘스트 수락.
      const _onE=(e)=>{ if(e.code!=='KeyE'||e.repeat||opened||!near) return;
        opened=true; try{ ctx.questfx && ctx.questfx.force(false); }catch(_){} try{ hint.remove(); }catch(_){}
        removeEventListener('keydown', _onE); open(); };
      addEventListener('keydown', _onE);
      const open = ()=>{
        try{ document.exitPointerLock && document.exitPointerLock(); }catch(_){}
        ctx.noPointerLock=true;   // 패널 동안 재잠금/조작 차단
        const ov=document.createElement('div'); ov.id='folQuestPanel';
        ov.style.cssText="position:fixed;inset:0;z-index:620;display:flex;align-items:center;justify-content:center;pointer-events:auto;"
          +"background:radial-gradient(120% 100% at 50% 60%,rgba(6,9,14,.5),rgba(4,6,10,.74));opacity:0;transition:opacity .5s ease;font-family:'Pretendard',system-ui,sans-serif";
        ov.innerHTML="<div style=\"width:min(470px,88vw);background:linear-gradient(180deg,rgba(16,18,23,.97),rgba(11,13,18,.97));border:1px solid rgba(176,148,96,.5);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.6);overflow:hidden\">"
          +"<div style=\"padding:15px 20px 11px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(176,148,96,.22)\"><span style=\"width:6px;height:6px;border-radius:50%;background:#c9a95a;box-shadow:0 0 8px #c9a95a\"></span><b style=\"color:#8fd3ff;font-size:14px\">"+fnm+"</b></div>"
          +"<div style=\"padding:15px 20px;font-size:14px;line-height:1.85;color:#d8d0bf;font-style:italic\">\""+pnm+"님, 여기서 다시 살아가려면 준비가 필요해요. 도구를 만들고 자재를 모아 — 우리만의 항구와 배를 지어요.\"</div>"
          +"<div style=\"margin:2px 20px 6px;padding:12px 14px;background:rgba(0,0,0,.3);border:1px solid rgba(176,148,96,.28);border-radius:8px\">"
          +"<div style=\"font-size:12px;letter-spacing:.14em;color:#c9a95a;margin-bottom:7px\">◆ 1차 항해 · 표류자의 정착</div>"
          +"<div style=\"font-size:13px;color:#eadfc6;line-height:1.75\">도구 제작 → 자재 채집 → 밧줄 제작 → 첫 항구 → 첫 배</div></div>"
          +"<div style=\"padding:14px 20px 18px;display:flex;justify-content:flex-end\"><button id=\"folAccept\" style=\"padding:11px 28px;font:800 14px Pretendard,system-ui;letter-spacing:.06em;color:#1a160e;background:linear-gradient(180deg,#f5e0ab,#dcbb7c);border:1px solid #f5e0ab;border-radius:8px;cursor:pointer;box-shadow:0 6px 18px rgba(245,224,171,.3)\">퀘스트 수락</button></div>"
          +"</div>";
        document.body.appendChild(ov); requestAnimationFrame(()=>ov.style.opacity='1');
        ov.querySelector('#folAccept').addEventListener('click', ()=>{ try{ ov.remove(); }catch(_){} start(); });
      };
    };
    const finishWake = ()=>{
      if(_cutDone) return; _cutDone=true;
      try { ctx.offUpdate?.(_tutoUpd); } catch(_){}   // ★오프닝 튜토 핸들러 해제(위 2026-07-10 주석) — 이후 진짜 배 승선 시 재발동 방지
      try { if(_cinFrame) _cinFrame.dispose(); } catch(_){}
      try { if(_cutPlayer&&_cutPlayer.group) ctx.scene.remove(_cutPlayer.group); } catch(_){}   // 엎드린 나(prop)만 제거 — 실제 플레이어가 일어서므로
      // ★추종자(_cutFol)는 남긴다 — 깨어난 뒤에도 곁에 서 있어야 함(사령관). 제거 금지.
      //   2026-07-10: _cutFol = crew 피규어(통합) → 컷신 배치 중 걸어뒀던 'wait'를 풀어 실제 게임에서 다시 따라다니게.
      try { ctx.crew && ctx.crew.setLandOrder && ctx.crew.setLandOrder('follow'); } catch(_){}
      _actorHidden=false;                                    // 실제 플레이어 아바타 다시 보임
      try { ctx.player.setThird(false); } catch(_){}         // 1인칭 복귀
      try { if(ctx.player && ctx.player.avatar) ctx.player.avatar.visible=true; } catch(_){}
      ctx.noPointerLock=false;                               // 포인터락/조작 허용
      try { if(M && ctx.sound) ctx.sound.noWater=false; } catch(_){}   // game 모드: 수영 사운드 복구
      try { if(M) ctx.ship=null; } catch(_){}                // ★난파했으니 보유배 없음 — 인벤 '보유배' 폴백(ctx.ship 표시) 제거(사령관)
      if(M) offerFollowerQuest();                            // ★게임: 곁의 추종자에게 퀘스트 수락받고 시작
      else (opts.onComplete || showDriftHandoff)();          // tutorial: 기존 페이지 이동
    };
    // ★"일어나세요" 대사 뒤 — '클릭하여 일어나기' 프롬프트(사령관: 클릭 글자로 알려주기). 클릭=그 자리에서 일어나 게임 시작.
    const showWakePrompt = ()=>{
      const st=document.createElement('style'); st.id='wakePromptStyle';
      st.textContent='@keyframes wakePulse{0%,100%{opacity:.62;box-shadow:0 0 0 rgba(240,217,168,0)}50%{opacity:1;box-shadow:0 0 20px -4px rgba(240,217,168,.6)}}';
      document.head.appendChild(st);
      const p=document.createElement('div'); p.id='wakePrompt';
      p.style.cssText='position:fixed;left:0;right:0;bottom:15%;z-index:610;display:flex;flex-direction:column;align-items:center;gap:10px;'
        +"font-family:'Pretendard',system-ui,sans-serif;pointer-events:auto;cursor:pointer;opacity:0;transition:opacity .8s ease";
      p.innerHTML='<div style="font-size:15px;color:#e9dcc0;letter-spacing:.04em;text-shadow:0 2px 8px #000">몸을 일으켜 볼까요</div>'
        +'<div style="font-size:13px;font-weight:700;letter-spacing:.18em;color:#f0d9a8;border:1px solid rgba(240,217,168,.5);border-radius:20px;padding:8px 22px;animation:wakePulse 1.4s ease-in-out infinite">클릭하여 일어나기</div>';
      document.body.appendChild(p); requestAnimationFrame(()=>p.style.opacity='1');
      const go=()=>{ p.removeEventListener('click',go); window.removeEventListener('mousedown',go,true);
        try{ p.remove(); st.remove(); }catch(_){} finishWake(); };
      p.addEventListener('click', go);
      window.addEventListener('mousedown', go, true);   // 화면 아무 곳 클릭도 허용
    };
    const _showDlg = ()=> ukDialog({
      speaker:_fname, accent:'cyan',
      lines:[`일어나보세요, ${_pname}님!!`, '정신이 드세요? 파도가 우릴 낯선 섬까지 밀어 올렸어요.', '…살아남으셨군요. 다행입니다.'],
      onDone: showWakePrompt,   // ★대사 끝 → '클릭하여 일어나기' → finishWake(그 자리에서 게임 시작)
    });
    // 6) 카메라 무빙이 완전히 끝난 뒤에 추종자 대사
    if(_cutCam){ _cutCam.onArrive = _showDlg; _cutCam.start(); }
    else _showDlg();
  }

  // 추종자 id→모델 (select.html FOLLOWER_ROSTER와 1:1) — ★KayKit 클래스 6종 한정(사령관 지시 2026-07-05).
  //   구 id(keeper·tinyhero 등)는 아래 폴백(KAY_CHARS.ranger)으로 흡수. 전부 KayKit = loadCutChar Rig_Medium 리타깃 경로 공통.
  const _KAY_DIR = '/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/';
  const FOLLOWER_MODELS = {
    rogue:        _KAY_DIR+'Rogue.glb',
    knight:       _KAY_DIR+'Knight.glb',
    barbarian:    _KAY_DIR+'Barbarian.glb',
    mage:         _KAY_DIR+'Mage.glb',
    ranger:       _KAY_DIR+'Ranger.glb',
    rogue_hooded: _KAY_DIR+'Rogue_Hooded.glb',
  };
  // ★섬별 깨어남 연출 지정 (소형섬1~5)
  //   2026-07-10(사령관 "섬 보여주고 바다로 감" 버그): 아래 cam/look 좌표는 옛 고정 "카브" 월드좌표(~4000대) 기준으로
  //   캡처된 값인데, 실제 각 프리팹의 원본 오브젝트 좌표는 x:100~325/z:150~550 범위(전혀 다른 좌표계)다.
  //   오늘 추가한 오프셋 보정(off-pc)을 이 엉뚱한 값에 적용하면 카메라가 섬에서 수천 유닛 떨어진 바다로 튄다.
  //   재보정 전까지는 비워두고, 아래 자동 계산되는 해안 지점 pov/lookP(라인 706~) 폴백을 그대로 쓴다.
  const DRIFT_SETUP = {};
  const _camLS='mas_drift_cam';
  function loadDriftCam(key){ try{ return (JSON.parse(localStorage.getItem(_camLS)||'{}'))[key]||null; }catch(_){ return null; } }
  // ★저장 시엔 오프셋을 빼서 항상 "그 섬 로컬 기준"으로 정규화(불러올 땐 그때의 오프셋을 더해 복원 — 위 _camCfg 보정과 대칭).
  function saveDriftCam(key, cam, look){ try{ const off=(ctx.terrain&&ctx.terrain.offset)?ctx.terrain.offset:{x:0,z:0};
    cam={x:cam.x-off.x,y:cam.y,z:cam.z-off.z}; look={x:look.x-off.x,y:look.y,z:look.z-off.z};
    const m=JSON.parse(localStorage.getItem(_camLS)||'{}'); const r=n=>+n.toFixed(1);
    m[key]={ cam:{x:r(cam.x),y:r(cam.y),z:r(cam.z)}, look:{x:r(look.x),y:r(look.y),z:r(look.z)} };
    localStorage.setItem(_camLS, JSON.stringify(m)); }catch(_){} }
  // ── 3D 섬 본 씬: 섬 메시 + 엎드린 플레이어 + 추종자(Waving) + 카메라 와이드→POV ──
  async function buildIslandWake(){
    let _isleKey='';
    const sea = ctx.water ? (ctx.water.level||0) : 0;
    let IX, IZ, CX, CZ, CY=sea+2, WD=0, IR=70;
    if(M){
      // ★game 모드: 이미 로딩된 월드 지형(홈섬)에서 깨어남 — 프리팹 로드 안 함(추가 섬 생성 X)
      //   2026-07-10(카브 특수취급 폐지): 홈섬은 isSpawn 중 랜덤배정이라 프리팹이 매번 다름 — ?s=로 실제 로드된 프리팹명을 그대로 키로 사용
      //   (DRIFT_SETUP에 해당 키 없으면 아래서 자동으로 계산된 해안 지점 폴백, 사령관 튜닝은 있으면 적용).
      const sp = (ctx.terrain && ctx.terrain.spawn) ? ctx.terrain.spawn : { x:0, z:0 };
      IX=sp.x; IZ=sp.z; IR=120; _isleKey=decodeURIComponent(new URLSearchParams(location.search).get('s')||'')||'카브'; _cutIsle=null;
      const g=(x,z)=> (ctx.terrain && ctx.terrain.groundAt) ? ctx.terrain.groundAt(x,z,5000) : sea;
      // 섬 중심(spawn)서 바깥으로 방사 march → 물가 직전 마른 해안 채택
      let bx=sp.x, bz=sp.z, by=Math.max(g(sp.x,sp.z), sea+1), wdir=0, found=false;
      for(let a=0; a<Math.PI*2 && !found; a+=Math.PI/8){
        let last=null;
        for(let d=10; d<420; d+=8){
          const x=sp.x+Math.cos(a)*d, z=sp.z+Math.sin(a)*d, y=g(x,z);
          if(y>sea+0.4 && y<sea+3.5){ last={x,y,z}; }
          else if(y<=sea+0.2 && last){ bx=last.x; by=last.y; bz=last.z; wdir=a; found=true; break; }
        }
      }
      CX=bx; CZ=bz; CY=by; WD=wdir;
    } else if(_preIsland && _preIsland.r){
      IX=_preIsland.loc.x; IZ=_preIsland.loc.z;
      _cutIsle=_preIsland.r.group;
      CX=_preIsland.r.spawnX; CZ=_preIsland.r.spawnZ; CY=_preIsland.r.spawnY; WD=_preIsland.r.waterDir||0; IR=_preIsland.r.isleR||70; _isleKey=_preIsland.r.key||'';
      try { ctx.terrain=_preIsland.terrain; } catch(_){}
      try { (_preIsland.hidden||[]).forEach(o=>{ o.visible=true; o.matrixWorldAutoUpdate=true; o.updateMatrixWorld(true); }); } catch(_){}
    } else {
      IX=ctx.player.pos.x+260; IZ=ctx.player.pos.z+260; CX=IX; CZ=IZ;
      try { const r = await loadRealIsland(IX, IZ, sea); if(r){ _cutIsle=r.group; CX=r.spawnX; CZ=r.spawnZ; CY=r.spawnY; WD=r.waterDir||0; IR=r.isleR||70; _isleKey=r.key||''; } }
      catch(e){ console.warn('[opening] 실제 섬 로드 실패 → 폴백', e&&e.message); }
    }
    try { let _dx=IX-CX, _dz=IZ-CZ; const _dl=Math.hypot(_dx,_dz)||1; _dx/=_dl; _dz/=_dl;
      if(ctx.terrain && ctx.terrain.groundAt){
        for(let s=3; s<=22; s+=3){ const gx=CX+_dx*s, gz=CZ+_dz*s, gy=ctx.terrain.groundAt(gx,gz,5000);
          if(gy>sea+0.7){ CX=gx; CZ=gz; CY=gy; break; } }
      }
    } catch(_){}
    const _setup = _isleKey ? DRIFT_SETUP[_isleKey] : null;
    if(_setup && _setup.spawn){ CX=_setup.spawn.x; CY=_setup.spawn.y; CZ=_setup.spawn.z; }
    try { ctx.player.setSpawn(CX, CY+1, CZ); } catch(_){}
    try { ctx.combat?.setSpawn?.(CX, CY+1, CZ); } catch(_){}   // ★부활 스폰도 깨어난 해안으로 — 항구 없이 사망(추위 등) 시 바다가 아닌 이 해안서 부활(사령관)
    try { if(!M && ctx.water && ctx.water.mesh){ const wm=ctx.water.mesh; wm.position.x=IX; wm.position.z=IZ; wm.scale.x=5; wm.scale.z=5; wm.updateMatrixWorld(true); } } catch(_){}   // game 모드는 게임 물평면 안 건드림
    try { if(!ctx.nightsky){ initNightSky(ctx, { fast:true }); initSky(ctx); } } catch(e){ console.warn('[opening] 하늘 모듈 실패', e&&e.message); }
    if(!M && !_cutIsle){
      const isle = new THREE.Group();
      const sand = new THREE.Mesh(new THREE.CylinderGeometry(30, 46, 12, 44), new THREE.MeshStandardMaterial({ color:0xd9c894, roughness:1 })); sand.position.y=sea+1; isle.add(sand);
      const grass = new THREE.Mesh(new THREE.CylinderGeometry(23, 31, 4.5, 44), new THREE.MeshStandardMaterial({ color:0x6f944f, roughness:1 })); grass.position.y=sea+7; isle.add(grass);
      isle.position.set(IX, 0, IZ); ctx.scene.add(isle); _cutIsle = isle; CX=IX; CZ=IZ; CY=sea+9;
    }
    const wx=Math.cos(WD), wz=Math.sin(WD);
    const faceWater = Math.atan2(wx, wz);
    setActorHidden(true);
    try { closeTuto(); const tEl=document.getElementById('tuto'); if(tEl) tEl.style.display='none'; } catch(_){}
    // 엎드린 플레이어
    try {
      const _selChar2=(new URLSearchParams(location.search).get('char')||'').toLowerCase();
      const pc = await loadCutChar(KAY_CHARS[_selChar2] || KAY_CHARS.knight, 'Death_A_Pose');
      pc.group.position.set(CX, CY, CZ); pc.group.rotation.y = faceWater;
      ctx.scene.add(pc.group); _cutPlayer = pc;
    } catch(e){ console.warn('[opening] 엎드린 플레이어 로드 실패', e&&e.message); }
    // 추종자 — 내륙쪽에서 Waving.
    //   ★2026-07-10(사령관 "추종자가 2명이 보임" 버그수정): 예전엔 여기서 별도 GLTF를 또 로드해 컷신 전용 소품을 만들고
    //   그걸 finishWake()에서 영구히 남겼는데, game.html이 이미 initCrew(ctx)로 "진짜" 추종자(ctx.crew 피규어)를
    //   먼저 로딩해두므로 그 둘이 각자 따로 존재해 캐릭터가 2명으로 보였음. crew 피규어를 그대로 재사용해 하나로 통합.
    try {
      let figGroup=null, figMixer=null;
      if(ctx.crew && ctx.crew.figureGroup){
        for(let i=0; i<20 && !figGroup; i++){ figGroup=ctx.crew.figureGroup(); if(!figGroup) await new Promise(r=>setTimeout(r,100)); }
        figMixer = ctx.crew.figureMixer ? ctx.crew.figureMixer() : null;
      }
      // ★2026-07-10(사령관 "튜토 섬 넘어가면 추종자가 땅에 파묻힘"): 추종자는 CX,CZ에서 2.2유닛 내륙(더 높은 지면)에
      //   서는데 Y를 플레이어 지면(CY) 그대로 썼음 → 그 지점 실제 지면보다 낮아 파묻혔다. 추종자 위치의 지면을 다시 샘플링.
      const _fgx = CX - wx*2.2, _fgz = CZ - wz*2.2; let _fgy = CY;
      try{ if(ctx.terrain && ctx.terrain.groundAt){ const _g = ctx.terrain.groundAt(_fgx, _fgz, 5000); if(_g > sea - 2) _fgy = _g; } }catch(_){}
      if(figGroup){
        try{ ctx.crew.setLandOrder && ctx.crew.setLandOrder('wait'); }catch(_){}   // 컷신 배치 동안 크루 자체 FSM이 위치를 못 건드리게
        if(figGroup.parent !== ctx.scene){ if(figGroup.parent) figGroup.parent.remove(figGroup); ctx.scene.add(figGroup); }
        figGroup.position.set(_fgx, _fgy, _fgz); figGroup.rotation.y = faceWater;
        _cutFol = { group: figGroup, mixer: figMixer };
        ctx.follower = { group: figGroup, mixer: figMixer };   // ★항구 완성 시 교역 NPC로 달려옴(trader.js가 사용) — crew와 동일 객체
      } else {
        // 폴백(크루 모듈 없음/로드 실패 등 예외 상황) — 기존 방식대로 컷신 전용 모델
        const _folId=(new URLSearchParams(location.search).get('follower')||'').toLowerCase();
        const _folUrl = FOLLOWER_MODELS[_folId] || KAY_CHARS.ranger || KAY_CHARS.knight;
        const fol = await loadCutChar(_folUrl, 'Waving');
        fol.group.position.set(_fgx, _fgy, _fgz); fol.group.rotation.y = faceWater;
        ctx.scene.add(fol.group); _cutFol = fol;
        ctx.follower = { group: fol.group, mixer: fol.mixer };
      }
    } catch(e){ console.warn('[opening] 추종자 로드 실패', e&&e.message); }
    // 카메라
    const wide  = new THREE.Vector3(IX + wx*IR*3.4, sea + Math.max(130, IR*1.7), IZ + wz*IR*3.4);
    const lookW = new THREE.Vector3(IX, sea + IR*0.22, IZ);
    ctx.camera.position.copy(wide); ctx.camera.lookAt(lookW);
    let started=false, t=0; const DUR=9.0;
    const px=-wz, pz=wx;
    const mx=CX - wx*1.1, mz=CZ - wz*1.1;
    const pov  = new THREE.Vector3(mx + wx*11 + px*3.5, CY + 9, mz + wz*11 + pz*3.5);
    const lookP= new THREE.Vector3(mx, CY + 0.8, mz);
    const _camCfg = loadDriftCam(_isleKey) || _setup;
    // ★2026-07-10(카브 특수취급 폐지 후폭풍) — DRIFT_SETUP/loadDriftCam 좌표는 오프셋이 없던 시절에 캡처된
    //   "로컬(그 섬 프리팹 자체 기준)" 좌표다. 지금은 홈섬이 캐논 좌표로 오프셋되어 로드되므로, 그대로 쓰면
    //   카메라가 옛 원점(사실상 옛 카브) 근방을 봐서 실제 지형과 어긋남 — off를 더해 같은 글로벌 프레임으로 보정.
    const _camOff = (ctx.terrain && ctx.terrain.offset) ? ctx.terrain.offset : { x:0, z:0 };
    if(_camCfg){
      if(_camCfg.cam)  pov.set(_camCfg.cam.x+_camOff.x, _camCfg.cam.y, _camCfg.cam.z+_camOff.z);
      if(_camCfg.look) lookP.set(_camCfg.look.x+_camOff.x, _camCfg.look.y, _camCfg.look.z+_camOff.z);
    }
    const tgt = new THREE.Vector3(mx, CY + 1.0, mz);
    const sv = wide.clone().sub(tgt), ev = pov.clone().sub(tgt);
    const sR = Math.hypot(sv.x, sv.z), eR = Math.hypot(ev.x, ev.z), sH = wide.y, eH = pov.y;
    const sA = Math.atan2(sv.z, sv.x);
    let dA = Math.atan2(ev.z, ev.x) - sA; while(dA>Math.PI) dA-=2*Math.PI; while(dA<-Math.PI) dA+=2*Math.PI;
    const bulge = (dA>=0?1:-1) * Math.PI*0.4;
    const _l=new THREE.Vector3(); let _arrived=false, _onArrive=null, _restPos=null, _fly=false; const _restLook=new THREE.Vector3();
    ctx.onUpdate(dt=>{
      if(_cutDone) return;   // ★깨어나 일어선 뒤 = 플레이어 카메라에 양보(핀 해제)
      if(_fly) return;
      if(_arrived){ if(_restPos){ ctx.camera.position.copy(_restPos); ctx.camera.lookAt(_restLook); } return; }
      if(!started){ ctx.camera.position.copy(wide); ctx.camera.lookAt(lookW); return; }
      t = Math.min(DUR, t + dt); const k=t/DUR, e=k*k*(3-2*k), eh=k*k;
      const A=sA + dA*e + Math.sin(k*Math.PI)*bulge, R=sR+(eR-sR)*e, H=sH+(eH-sH)*eh;
      ctx.camera.position.set(tgt.x+Math.cos(A)*R, H, tgt.z+Math.sin(A)*R);
      try { if(ctx.terrain && ctx.terrain.groundAt){ const cgy=ctx.terrain.groundAt(ctx.camera.position.x, ctx.camera.position.z, 5000);
        if(ctx.camera.position.y < cgy+3) ctx.camera.position.y = cgy+3; } } catch(_){}
      _l.lerpVectors(lookW, lookP, e); ctx.camera.lookAt(_l);
      if(t>=DUR && !_arrived){ _arrived=true; _restPos=ctx.camera.position.clone(); _restLook.copy(_l); if(_onArrive) try{ _onArrive(); }catch(_){} }
    });
    _cutCam = { start(){ started=true; }, set onArrive(f){ _onArrive=f; if(_arrived) f(); } };
    // ── 튜닝 헬퍼(콘솔) ──
    window.__wakeTune = {
      cam(px,py,pz, lx,ly,lz){ _restPos=new THREE.Vector3(px,py,pz); if(lx!=null)_restLook.set(lx,ly,lz); _arrived=true; ctx.camera.position.copy(_restPos); ctx.camera.lookAt(_restLook); return this.dump(); },
      look(lx,ly,lz){ _restLook.set(lx,ly,lz); return this.dump(); },
      spawn(x,y,z){ CX=x;CY=y;CZ=z; if(_cutPlayer)_cutPlayer.group.position.set(x,y,z); if(_cutFol)_cutFol.group.position.set(x - wx*2.2, y, z - wz*2.2); return this.dump(); },
      dump(){ const c=ctx.camera.position, l=_restLook, r=n=>+n.toFixed(1);
        const o={ spawn:{x:r(CX),y:r(CY),z:r(CZ)}, cam:{x:r(c.x),y:r(c.y),z:r(c.z)}, look:{x:r(l.x),y:r(l.y),z:r(l.z)} };
        console.log("'"+_isleKey+"': "+JSON.stringify(o).replace(/"(\w+)":/g,'$1:')+','); return o; },
    };
    // ── 🎥 자유 카메라(튜닝): [C] 토글 ──
    const _flyKeys=new Set(); let _flyYaw=0, _flyPitch=-0.3;
    const _camTune = new URLSearchParams(location.search).get('camtune')==='1';
    addEventListener('keydown', e=>{
      if(e.code==='KeyC' && _camTune && !e.repeat){ _fly=!_fly;
        if(_fly){ const d=new THREE.Vector3(); ctx.camera.getWorldDirection(d); _flyYaw=Math.atan2(d.x,d.z); _flyPitch=Math.asin(Math.max(-1,Math.min(1,d.y)));
          console.log('[flycam] ON — WASD 이동·Q/E 하강상승·화살표 시선·C 끄기. 구도 잡고 __wakeTune.dump()'); }
        else console.log('[flycam] OFF'); return; }
      if(_fly && /^(Key[WASDQE]|Arrow(Up|Down|Left|Right))$/.test(e.code)){ _flyKeys.add(e.code); e.preventDefault(); }
    });
    addEventListener('keyup', e=>_flyKeys.delete(e.code));
    ctx.onUpdate(dt=>{
      if(!_fly) return; dt=Math.min(dt||0.016,0.05);
      const rot=1.7*dt, mv=30*dt;
      if(_flyKeys.has('ArrowLeft')) _flyYaw+=rot; if(_flyKeys.has('ArrowRight')) _flyYaw-=rot;
      if(_flyKeys.has('ArrowUp')) _flyPitch=Math.min(1.45,_flyPitch+rot); if(_flyKeys.has('ArrowDown')) _flyPitch=Math.max(-1.45,_flyPitch-rot);
      const cp=Math.cos(_flyPitch), dir=new THREE.Vector3(Math.sin(_flyYaw)*cp, Math.sin(_flyPitch), Math.cos(_flyYaw)*cp);
      const fwd=new THREE.Vector3(Math.sin(_flyYaw),0,Math.cos(_flyYaw)), right=new THREE.Vector3(Math.cos(_flyYaw),0,-Math.sin(_flyYaw));
      const p=ctx.camera.position;
      if(_flyKeys.has('KeyW')) p.addScaledVector(fwd,mv); if(_flyKeys.has('KeyS')) p.addScaledVector(fwd,-mv);
      if(_flyKeys.has('KeyD')) p.addScaledVector(right,mv); if(_flyKeys.has('KeyA')) p.addScaledVector(right,-mv);
      if(_flyKeys.has('KeyE')) p.y+=mv; if(_flyKeys.has('KeyQ')) p.y-=mv;
      ctx.camera.lookAt(p.x+dir.x, p.y+dir.y, p.z+dir.z);
      _restLook.set(p.x+dir.x*8, p.y+dir.y*8, p.z+dir.z*8);
    });
  }
  let _cutIsle=null, _cutFol=null, _cutPlayer=null, _preIsland=null;

  // ★표류 섬 프리로드 — 첫 로딩 화면서 먼 곳에 미리 빌드. 컷신 땐 끊김 0.
  async function preloadDriftIsland(){
    const sea = ctx.water ? (ctx.water.level||0) : 0;
    const DLOC = { x: 4000, z: 4000 };
    const saved = ctx.terrain;
    const _before = new Set(ctx.scene.children);
    let r=null; try { r = await loadRealIsland(DLOC.x, DLOC.z, sea); } catch(e){ console.warn('[preload] 섬 로드 실패', e&&e.message); }
    const _added = ctx.scene.children.filter(c=>!_before.has(c));
    _added.forEach(o=>{ try{ o.updateMatrixWorld(true); o.visible=false; o.matrixWorldAutoUpdate=false; }catch(_){} });
    if(r){ _preIsland = { r, terrain: ctx.terrain, loc: DLOC, sea, hidden:_added }; }
    ctx.terrain = saved;
    console.log('[preload] 표류 섬 프리로드 — 전투 중 숨김 객체', _added.length, '개(매 프레임 비용 제거)');
    return _preIsland;
  }

  // ★우리 맵 실제 섬(voyage_islands_backup.json 프리팹) — 소형 중 랜덤
  async function loadRealIsland(IX, IZ, sea){
    const data = await fetch('/tomob-deploy/voyage_islands_backup.json').then(r=>r.json());
    const keys = Object.keys(data.sessions||{});
    const small = keys.filter(k=>/소형/.test(k));
    const pool = small.length ? small : keys.filter(k=>!/얼음/.test(k));
    if(!pool.length) return null;
    const _forced=(new URLSearchParams(location.search).get('drift')||'').trim();
    const pick = (_forced && pool.includes(_forced)) ? _forced : pool[Math.floor(Math.random()*pool.length)];
    const sess = data.sessions[pick]; if(!sess || !Array.isArray(sess.objs)) return null;
    console.log('[cutscene] 표류 섬 =', pick);
    const atlas = new THREE.TextureLoader().load('/tomob-deploy/obj/lowpoly_terrain/Terrain_Assets/Textures/CPT_Terrain_Texture_Atlas_01.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    const fbx = new _CutFBX(); fbx.setResourcePath('/tomob-deploy/obj/lowpoly_terrain/Terrain_Assets/Textures/');
    const group = new THREE.Group();
    const isleMeshes=[], roots=[]; let bigArea=0, spawnX=0, spawnZ=0, isleR=40;
    for(const o of sess.objs){
      if(/\/Clouds\//i.test(o.url)) continue;
      const isIce=/\/Ice\//i.test(o.url);
      const isMtn=/\/Mountains\//i.test(o.url), isIsle=/\/Islands\//i.test(o.url)||isIce;
      if(!isMtn && !isIsle && !/\/(Terrain|River|Water|Ice)\//i.test(o.url)) continue;
      let root; try{ root=await fbx.loadAsync(o.url); }catch(e){ continue; }
      root.position.set(o.x, o.y||0, o.z); root.rotation.y=o.rotY||0; root.scale.setScalar(0.01*(o.scale||1));
      root.traverse(m=>{ if(m.isMesh){ m.receiveShadow=true;
        const ms=Array.isArray(m.material)?m.material:[m.material];
        ms.forEach(mm=>{ if(!mm)return; mm.side=THREE.DoubleSide;
          if(mm.map) mm.map.colorSpace=THREE.SRGBColorSpace;
          else { mm.map=atlas; if(mm.color)mm.color.set(0xffffff); mm.needsUpdate=true; } });
        if(isIsle) isleMeshes.push(m); }});
      group.add(root); roots.push(root);
      const bb=new THREE.Box3().setFromObject(root), s=bb.getSize(new THREE.Vector3()), c=bb.getCenter(new THREE.Vector3());
      if(isIsle){ const area=s.x*s.z; if(area>bigArea){ bigArea=area; spawnX=c.x; spawnZ=c.z; isleR=Math.max(s.x,s.z)*0.5; } }
    }
    if(!group.children.length) return null;
    group.position.set(IX - spawnX, 0, IZ - spawnZ);
    ctx.scene.add(group); group.updateMatrixWorld(true);
    try {
      // ⚠️R5-P2 격리: 이 ctx.terrain 통째 교체는 **레거시(tutorial.html 단독) 전용** — game.html(M)에선 도달 불가
      //   (preloadDriftIsland·이 함수 호출부 전부 !M 게이트). 계약 절반짜리 어댑혹(addTrimesh 없음·BVH 없음)이라
      //   game 경로에 절대 노출 금지. 게임 본편의 섬 등록은 islands.js/worldstream(자가치유 포함)이 담당.
      ctx.terrain = { collide: roots, data:{ name: pick, objs: sess.objs }, spawn:{ x:IX, z:IZ },
        groundAt:(x,z)=>{ const _r=new THREE.Raycaster(); _r.set(new THREE.Vector3(x,(sea||0)+400,z), new THREE.Vector3(0,-1,0)); const h=_r.intersectObjects(roots,true); return h.length?h[0].point.y:(sea||0); } };
      await initEnvironment(ctx).catch(e=>console.warn('[cutscene] initEnvironment 실패', e&&e.message));
    } catch(e){ console.warn('[cutscene] env 세팅 실패', e&&e.message); }
    const _ray=new THREE.Raycaster();
    const gy=(x,z)=>{ _ray.set(new THREE.Vector3(x,(sea||0)+400,z), new THREE.Vector3(0,-1,0)); const h=_ray.intersectObjects(isleMeshes,true); return h.length?h[0].point.y:null; };
    let beach=null, waterDir=0;
    for(let a=0; a<Math.PI*2 && !beach; a+=Math.PI/6){
      let last=null;
      for(let d=isleR*0.25; d<isleR*1.7; d+=Math.max(2,isleR*0.05)){
        const x=IX+Math.cos(a)*d, z=IZ+Math.sin(a)*d, y=gy(x,z);
        if(y!=null && y>=(sea||0)+0.2 && y<=(sea||0)+2.8){ last={x,y,z}; }
        else if((y==null || y<(sea||0)+0.1) && last){ beach=last; waterDir=a; break; }
      }
      if(!beach && last){ beach=last; waterDir=a; }
    }
    if(!beach){ const y=gy(IX,IZ); beach={ x:IX, y:(y!=null?Math.max(y,(sea||0)+1):(sea||0)+1), z:IZ }; }
    { const off=Math.max(14, isleR*0.2);
      const inX=beach.x-Math.cos(waterDir)*off, inZ=beach.z-Math.sin(waterDir)*off, inY=gy(inX,inZ);
      if(inY!=null && inY>=(sea||0)+0.6) beach={ x:inX, y:inY, z:inZ }; }
    return { group, spawnX:beach.x, spawnZ:beach.z, spawnY:beach.y, isleR, waterDir, key:pick };
  }

  // KayKit 캐릭터 로드 + 지정 클립 재생(컷신용)
  async function loadCutChar(charUrl, clipName){
    const L=new _CutGLTF(); const load=u=>new Promise((res,rej)=>L.load(encodeURI(u),res,undefined,rej));
    const g=await load(charUrl); const model=g.scene;
    model.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){ o.frustumCulled=false; o.castShadow=true; } });
    let bb=new THREE.Box3().setFromObject(model), sz=new THREE.Vector3(); bb.getSize(sz);
    model.scale.setScalar(1.35/(sz.y||1)); bb=new THREE.Box3().setFromObject(model); model.position.y-=bb.min.y;
    const group=new THREE.Group(); group.add(model);
    let clip=null; const base='/tomob-deploy/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/';
    for(const set of ['Rig_Medium_General.glb','Rig_Medium_Simulation.glb']){
      try{ const ag=await load(base+set); const c=ag.animations.find(a=>new RegExp(clipName,'i').test(a.name)); if(c){ clip=c; break; } }catch(_){}
    }
    let mixer=null;
    if(clip){ mixer=new THREE.AnimationMixer(model); mixer.clipAction(clip).setLoop(THREE.LoopRepeat,Infinity).play(); ctx.onUpdate(dt=>mixer.update(dt)); }
    return { group, model, mixer };
  }

  // 시네마틱 프레임: 상하 레터박스 + 비네트 그레이딩
  let _cinFrame=null;
  function cinematicFrame(){
    const st=document.createElement('style'); st.id='cinStyle';
    st.textContent='#cinFrame{position:fixed;inset:0;z-index:585;pointer-events:none}'
      +'#cinFrame .vig{position:absolute;inset:0;box-shadow:inset 0 0 240px 40px rgba(0,0,0,.55);opacity:0;transition:opacity 1.6s ease}'
      +'#cinFrame .bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height 1.5s cubic-bezier(.4,0,.2,1)}'
      +'#cinFrame .bar.t{top:0}#cinFrame .bar.b{bottom:0}'
      +'#cinFrame.on .bar{height:11vh}#cinFrame.on .vig{opacity:1}';
    document.head.appendChild(st);
    const el=document.createElement('div'); el.id='cinFrame';
    el.innerHTML='<div class="vig"></div><div class="bar t"></div><div class="bar b"></div>';
    document.body.appendChild(el); requestAnimationFrame(()=>el.classList.add('on'));
    return { el, dispose(){ el.classList.remove('on'); setTimeout(()=>{ el.remove(); st.remove(); },1500); } };
  }

  // 투명 눈꺼풀 깜빡(라이브 3D 씬이 비치도록)
  function customBlink(){
    return new Promise(res=>{
      const st=document.createElement('style'); st.id='cblStyle';
      st.textContent='#cbl{position:fixed;inset:0;z-index:590;pointer-events:none}#cbl .cl{position:absolute;left:0;right:0;height:50%;background:#000}#cbl .ct{top:0}#cbl .cb{bottom:0}';
      document.head.appendChild(st);
      const ov=document.createElement('div'); ov.id='cbl';
      ov.innerHTML='<div class="cl ct"></div><div class="cl cb"></div>'; document.body.appendChild(ov);
      const t=ov.querySelector('.ct'), b=ov.querySelector('.cb');
      const lidH=p=>{ if(p<.14)return .5*(1-p/.14); if(p<.34)return 0; if(p<.42)return .5*((p-.34)/.08); if(p<.50)return .5*(1-(p-.42)/.08); if(p<.72)return 0; if(p<.77)return .45*((p-.72)/.05); if(p<.82)return .45*(1-(p-.77)/.05); return 0; };
      const DUR=3400, t0=performance.now();
      const frame=now=>{ const p=Math.min(1,(now-t0)/DUR); const h=(lidH(p)*100).toFixed(1)+'%'; t.style.height=h; b.style.height=h;
        if(p<1) requestAnimationFrame(frame); else { ov.remove(); st.remove(); res(); } };
      requestAnimationFrame(frame);
    });
  }
  function showDriftHandoff(){
    // ★핸드오프: 오프닝 → 1차 퀘스트라인(game.html?quest=1). 캐릭터 선택값 전부 전달.
    //   2026-07-10(카브 특수취급 폐지): s=/home=은 이미 현재 URL(select.html이 랜덤배정한 홈섬)에 실려 있음 — 재설정하면
    //   랜덤배정을 덮어써서 항상 카브로 되돌아가던 버그였음. 그대로 이어받기만 한다.
    const params=new URLSearchParams(location.search); params.set('quest','1');
    const nextUrl='game.html?'+params.toString();
    try{ if(document.exitPointerLock) document.exitPointerLock(); }catch(_){}
    const ov=document.createElement('div'); ov.id='driftHandoff';
    ov.style.cssText='position:fixed;inset:0;z-index:600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;'
      +'background:radial-gradient(120% 100% at 50% 30%,rgba(12,16,22,.9),rgba(4,6,10,.97));color:#e9dcc0;'
      +"font-family:'Pretendard',system-ui,sans-serif;text-align:center;opacity:0;transition:opacity 1s ease;";
    ov.innerHTML=`<div style="font-size:clamp(26px,4vw,46px);font-weight:800;letter-spacing:.2em;color:#f0d9a8">표류 끝에, 낯선 해안</div>
      <div style="font-size:15px;line-height:1.9;color:#b8af9a;max-width:540px">부서진 배와 함께 낯선 섬의 해안에 떠밀려 왔다.<br>여기서, 당신의 진짜 항해가 시작된다.</div>
      <button id="_goQuest" style="margin-top:8px;padding:13px 32px;font-family:inherit;font-size:15px;font-weight:700;letter-spacing:.08em;color:#1a160e;background:linear-gradient(180deg,#f5e0ab,#dcbb7c);border:1px solid #f5e0ab;border-radius:8px;cursor:pointer;box-shadow:0 6px 20px rgba(245,224,171,.35)">이어서 시작하기 →</button>
      <div style="margin-top:4px;font-size:11px;color:#6f6a59;letter-spacing:.05em">잠시 뒤 자동으로 이어집니다…</div>`;
    document.body.appendChild(ov); requestAnimationFrame(()=>ov.style.opacity='1');
    let went=false; const go=()=>{ if(went)return; went=true; location.href=nextUrl; };
    ov.querySelector('#_goQuest').addEventListener('click', go);
    setTimeout(go, 9000);
  }

  // ★표류 섬 미리 로드 (첫 로딩서 — 컷신 중 로딩 0). game 모드는 이미 로딩된 월드 지형에서 깨어나므로 프리로드 없음.
  if(!M){
    setLoad('표류 섬 준비 중… (첫 로딩만 깁니다)');
    try { await preloadDriftIsland(); } catch(e){ console.warn('[opening] 섬 프리로드 실패 → 컷신서 로드 폴백', e&&e.message); }
  }

  // ★ESC 메뉴(menu.js)가 참조 — "튜토리얼 건너뛰기" 버튼 노출 여부 + 클릭 시 실행(2026-07-10, 사령관).
  ctx.opening = { skip: skipToGame, active: ()=> !_outcome };

  // ── 검증/디버그 훅 ──
  window.__tutorial = { ready:true, ship:!!ship,
    player(){ const p=ctx.player.pos; return { x:p.x, y:p.y, z:p.z }; },
    onShip(){ return ctx.player.onShip===ctx.ship; } };
  window.__tut = {
    encounter(){ if(!_encStarted){ _encStarted=true; startEncounter(); } return 'encounter started'; },
    get enc(){ return _enc; },
    forceSink(which){ return _enc&&_enc.naval ? _enc.naval.forceSink(which||'enemy') : 'no enc'; },
    win(){ if(!_outcome){ _outcome='win'; onWin(); } return 'win'; },
    lose(){ if(!_outcome){ _outcome='lose'; onLose(); } return 'lose'; },
    rainOn(){ rain.start(); return 'rain on'; },
    cutscene(){ _cutsceneActive=false; if(!_outcome) _outcome='win'; driftWake('win'); return 'cutscene'; },
    state(){ return { phase:_phase, encStarted:_encStarted, outcome:_outcome, dur:(ctx.ship&&ctx.ship.durability), naval:_enc&&_enc.naval&&_enc.naval.state() }; },
  };

  return { ship };
}
