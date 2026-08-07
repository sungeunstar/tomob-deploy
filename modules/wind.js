// wind.js — 실시간 바람(방향/세기) + 거리 기반 파도(섬 근처 잔잔→먼바다 너울) + 비 날씨(폭풍).
// 바람 세기 = base(플레이어~섬 거리) × 날씨(비). water.uWaveAmp를 매 프레임 구동 → 파도가 바람 따라.
// 비는 임시 파티클(rain.unitypackage 추출은 추후). R키 토글.
import * as THREE from 'three';
import { BAL } from './balance.js';
import { toast as ukToast } from './uikit.js';

export function initWind(ctx){
  const { scene, camera } = ctx;
  ctx.wind = { dir:0, strength:0.4, raining:false };
  let t=0;
  const toast = s => { try{ ukToast(s, { accent:'gold', ms:3200 }); }catch(_){} };

  // 🌩️ 자동 폭풍 스케줄러(2026-07-24 신설) — 사령관 "비가 안 내림".
  //   진단: ctx.wind.raining을 켜는 곳이 R키(__testMode 전용)와 검증 스크립트뿐이라
  //   본편(game.html)에서는 **구조적으로 비가 올 수 없었다**. 미구현이지 고장이 아니었음.
  //   상태머신 clear → warn(예고) → storm → clear. 수치 SSOT = BAL.weather.
  const W = BAL.weather || { enabled:false };
  const _rnd = (a,b) => a + Math.random()*(b-a);
  let wxState = 'clear';
  let wxTimer = _rnd(W.firstDelayMin || 300, W.firstDelayMax || 600);   // 첫 폭풍은 짧게(판정 가능하게)
  // 발생 금지 구간 — 던전(오버월드 수평 380m 하늘공간)·오프닝/튜토(rain.js가 자체 연출 소유).
  const _wxBlocked = () => {
    if(ctx.dungeon && ctx.dungeon.active) return true;
    const d = ctx.ai && ctx.ai.director;
    if(d && d.tutoOrOpening && d.tutoOrOpening()) return true;
    return false;
  };
  const _wxSet = st => {
    wxState = st;
    if(st === 'storm'){ wxTimer = _rnd(W.stormMin, W.stormMax); ctx.wind.raining = true; }
    else if(st === 'warn'){ wxTimer = W.warnSec; ctx.wind.raining = false; }
    else { wxTimer = _rnd(W.clearMin, W.clearMax); ctx.wind.raining = false; }
  };

  // 비 = 세로 빗줄기 LineSegments (동그라미 점 아님)
  const N=3800, rainGeo=new THREE.BufferGeometry(), rpos=new Float32Array(N*6);
  for(let i=0;i<N;i++){ const x=(Math.random()-0.5)*240, y=Math.random()*90, z=(Math.random()-0.5)*240, len=1.3+Math.random()*1.1;
    rpos[i*6]=x; rpos[i*6+1]=y; rpos[i*6+2]=z; rpos[i*6+3]=x+0.25; rpos[i*6+4]=y-len; rpos[i*6+5]=z; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rpos,3));
  const rainMat=new THREE.LineBasicMaterial({ color:0xc2d4e4, transparent:true, opacity:0.5 });
  const rain=new THREE.LineSegments(rainGeo, rainMat);
  rain.visible=false; scene.add(rain);
  // 빗줄기 색: 낮=밝은 회청(0xc2d4e4), 밤=은청빛(0x8fb4e0, 더 밝게) → 밤 어둠 속에서도 보이게.
  const _rainDay=new THREE.Color(0xc2d4e4), _rainNight=new THREE.Color(0xaecdf2);
  const storm=new Audio('/sfx/storm.mp3'); storm.loop=true; storm.volume=0; storm.preload='auto';   // mas 폭풍 소리
  // 비 시 어두운 폭풍 효과(하늘/안개/햇빛) — 초기값 저장
  const _sky0=scene.background.clone(), _fogC0=scene.fog?scene.fog.color.clone():null, _fn0=scene.fog?scene.fog.near:600, _ff0=scene.fog?scene.fog.far:4000, _sun0=ctx.sun?ctx.sun.intensity:1.6, _hemi0=ctx.hemi?ctx.hemi.intensity:1.15;
  const _dark=new THREE.Color(0x232a31);   // 폭풍 하늘(많이 어둡게)
  const flash=new THREE.PointLight(0x9ec4ff, 0, 800, 1.6); flash.position.set(0,300,0); scene.add(flash);   // 천둥 번개(threejs-rain-thunder 이식)
  // 바다색 날씨 연동 — 맑음(초기) → 폭풍(어두운 청회) lerp
  let rainAmt=0;   // 부드러운 폭풍 강도 0~1
  const _wsh=ctx.water?ctx.water.mat.uniforms.uShallow.value.clone():null, _wdp=ctx.water?ctx.water.mat.uniforms.uDeep.value.clone():null, _wsk=ctx.water?ctx.water.mat.uniforms.uSky.value.clone():null;
  const _shStorm=new THREE.Color(0x2b4654), _dpStorm=new THREE.Color(0x071d28), _skStorm=new THREE.Color(0x3a4652);

  // 🧭 WIND 패널 (바람UI완성본.png 재현) — 세로 다크+골드 더블베젤. 풍향 화살 + 방위 + 깃발 + 풍속(kn).
  //   ※ 이모지 금지(OP_09-F) → SVG 화살/깃발. 값은 매 프레임 갱신. 화살 회전은 SVG transform 속성(견고).
  const windUI=document.createElement('div'); windUI.id='windHud';
  windUI.style.cssText='position:fixed;right:16px;top:252px;z-index:7;width:84px;padding:11px 8px 12px;'
    +'display:flex;flex-direction:column;align-items:center;gap:7px;pointer-events:none;'
    +'background:linear-gradient(160deg,#1a2129,#0c1116);border-radius:9px;'
    +'border:2px solid #b9923f;box-shadow:0 6px 20px rgba(0,0,0,.55),inset 0 0 0 3px rgba(0,0,0,.55),inset 0 0 0 4px rgba(185,146,63,.5);'
    +'color:#d8c79c;font:11px/1.2 Georgia,"Times New Roman",serif;text-align:center;';
  windUI.innerHTML=
     '<div style="font-weight:700;letter-spacing:.22em;font-size:11px;color:#e3cf9a;text-shadow:0 1px 2px #000;">WIND</div>'
    +'<div style="position:relative;width:62px;height:62px;">'
    +'  <svg width="62" height="62" viewBox="0 0 62 62">'
    +'    <circle cx="31" cy="31" r="29" fill="rgba(0,0,0,.35)" stroke="rgba(185,146,63,.45)" stroke-width="1"/>'
    +'    <g stroke="rgba(185,146,63,.55)" stroke-width="1">'
    +'      <line x1="31" y1="4" x2="31" y2="11"/><line x1="31" y1="51" x2="31" y2="58"/>'
    +'      <line x1="4" y1="31" x2="11" y2="31"/><line x1="51" y1="31" x2="58" y2="31"/>'
    +'    </g>'
    +'    <g id="windArrowG" transform="rotate(0 31 31)">'
    +'      <polygon points="31,8 38,40 31,33 24,40" fill="#e9cf86" stroke="#7a5e23" stroke-width="0.6"/>'
    +'    </g>'
    +'  </svg>'
    +'</div>'
    +'<div id="windBearing" style="font-weight:700;font-size:14px;letter-spacing:.1em;color:#efe2bb;text-shadow:0 1px 2px #000;">N</div>'
    +'<svg width="34" height="20" viewBox="0 0 34 20"><line x1="4" y1="2" x2="4" y2="19" stroke="#b9923f" stroke-width="1.4"/>'
    +'<path d="M4 3 q7 -2 14 1 q7 3 12 0 l0 8 q-5 3 -12 0 q-7 -3 -14 -1 z" fill="rgba(216,199,156,.78)" stroke="#7a5e23" stroke-width="0.5"/></svg>'
    +'<div><b id="windKn" style="font-size:17px;color:#efe2bb;text-shadow:0 1px 2px #000;">0</b> <span style="font-size:10px;color:#b6a572;">kn</span></div>';
  document.body.appendChild(windUI);
  const BEAR8=['N','NE','E','SE','S','SW','W','NW'];
  const _isleBB=new WeakMap();   // ⚡ 섬 그룹 → {cx,cz,r} 바운딩 캐시(아래 onUpdate 참조)

  ctx.onUpdate(dt=>{ t+=dt;
    // ★풍향 드리프트(사령관 2026-06-24): 바람 맞추기가 핵심 플레이 → 조금씩 꾸준히 바뀌게(예전 너무 느림).
    //   두 사인 합성으로 단조 주기감 없이 자연스럽게 떠돎. ~10초마다 눈에 띄게 바뀌어 A/D 재트림 유도.
    ctx.wind.dir += (Math.sin(t*0.11) + 0.5*Math.sin(t*0.043+1.7))*dt*0.06;
    // 거리: 플레이어 ~ 가장 가까운 섬 가장자리
    // ⚡ 섬 바운딩 캐시 — 기존엔 매 프레임 setFromObject(그룹 전 정점 traverse × 로드된 섬 수 = 스트리밍 시 매 프레임 수십만 정점).
    //   지형은 정적이므로 그룹당 1회만 계산해 중심·반경 캐시(WeakMap — 언로드된 그룹은 GC와 함께 자동 소멸).
    let distF=1;
    if(ctx.terrain && ctx.terrain.collide && ctx.terrain.collide.length && ctx.player){ const pp=ctx.player.pos; let md=1e9;
      for(const g of ctx.terrain.collide){ let c=_isleBB.get(g);
        if(!c){ const b=new THREE.Box3().setFromObject(g);
          c={ cx:(b.min.x+b.max.x)/2, cz:(b.min.z+b.max.z)/2, r:Math.max(b.max.x-b.min.x,b.max.z-b.min.z)/2 }; _isleBB.set(g,c); }
        const d=Math.max(0, Math.hypot(pp.x-c.cx, pp.z-c.cz)-c.r); if(d<md) md=d; }
      distF=Math.max(0, Math.min(1, md/180)); }                     // 섬 0~180m: 0(잔잔)~1(너울)
    const base = 0.12 + distF*0.6;                                  // 섬근처 0.12(잔잔) ~ 먼바다 0.72(센 너울)

    // 🌩️ 자동 폭풍 스케줄러 — 상태 진행(rainAmt/풍속 계산보다 **먼저** 돌아야 이번 프레임에 반영된다).
    const _inDg = !!(ctx.dungeon && ctx.dungeon.active);
    if(W.enabled){
      if(_wxBlocked()){
        if(wxState !== 'clear') _wxSet('clear');                    // 던전 진입·튜토 진입 = 즉시 갬
      } else if(!(typeof window!=='undefined' && window.__testMode)){   // ⚙️테스트모드는 R키 수동 판정 우선
        wxTimer -= dt;
        if(wxTimer <= 0){
          if(wxState === 'clear'){ _wxSet('warn');  toast('먹구름이 몰려온다 — 폭풍이 다가온다'); }
          else if(wxState === 'warn'){ _wxSet('storm'); }
          else { _wxSet('clear'); toast('폭풍이 지나갔다'); }
        }
      }
    }

    // 🌧️ 폭풍 강도 rainAmt — 모든 폭풍 요소가 이 하나를 따른다(어느 요소도 먼저 튀지 않게).
    //   ★점진 강화: 시정수 dt*0.22 ≈4.5s. R 켜면 ~6초에 걸쳐 먹구름 모이고·비 짙어지고·바다/조명 어두워짐.
    //   ★target은 ctx.wind.raining이 SSOT(검증 스크립트가 직접 세팅하는 경로 보존) + warn 단계만 부분값을 얹는다.
    const target = ctx.wind.raining ? 1 : (wxState === 'warn' ? (W.warnAmt || 0) : 0);
    rainAmt += (target-rainAmt)*Math.min(1, dt*0.22);
    if(rainAmt<0.0008 && target===0) rainAmt=0;                         // 완전 갬 스냅(미세 잔여 제거)
    if(_inDg) rainAmt = 0;   // ⛏️던전 = 하늘 없는 실내. 연출 전부 즉시 해제(아래 비/번개/사운드 가드와 세트)

    // 🌬️ 풍속 — ★2026-07-24 `raining?1.7:1.0` 불리언 점프를 rainAmt 비례로 연속화.
    //   불리언이면 폭풍 시작 순간 풍속이 1.7배로 튀어 배 속도가 툭 끊긴다(자동 발생 전엔 안 드러났던 것).
    //   rainAmt=1에서 base*1.7 = 기존 값과 정확히 동일 → `_sail_e2e`의 폭풍 구간 검사(0.72*1.7) 불변.
    ctx.wind.strength = base*(1 + 0.7*rainAmt) + Math.sin(t*0.25)*0.05;
    if(ctx.water && ctx.water.mat.uniforms) ctx.water.mat.uniforms.uWaveAmp.value = ctx.wind.strength;
    // WIND 패널 갱신: 화살=풍향(절대, SVG rotate), 방위 라벨(8방위), 풍속 kn(strength 환산)
    const deg=((ctx.wind.dir*180/Math.PI)%360+360)%360;
    const wg=document.getElementById('windArrowG'); if(wg) wg.setAttribute('transform','rotate('+deg.toFixed(0)+' 31 31)');
    const wbear=document.getElementById('windBearing'); if(wbear) wbear.textContent=BEAR8[Math.round(deg/45)%8];
    const wkn=document.getElementById('windKn'); if(wkn) wkn.textContent=Math.round(ctx.wind.strength*28);

    if(ctx.sky&&ctx.sky.setStorm) ctx.sky.setStorm(rainAmt);            // sky 조명/exposure/볼류먹구름/water uStorm 전파(rainAmt 따라 점진)
    if(ctx.water&&ctx.water.mat.uniforms&&_wsh){ const wu=ctx.water.mat.uniforms;
      wu.uShallow.value.copy(_wsh).lerp(_shStorm,rainAmt); wu.uDeep.value.copy(_wdp).lerp(_dpStorm,rainAmt); wu.uSky.value.copy(_wsk).lerp(_skStorm,rainAmt); }
    // 밤 강도(sky.js가 매 프레임 갱신) — 비/번개를 밤에 더 잘 보이게 조정
    const nightK = (ctx.sky && ctx.sky._night!=null) ? ctx.sky._night : 0;

    // 🌫️ 안개/배경/조명 어둡기 — rainAmt 비례로 폭풍값을 향해 동반 페이드(맑음=sky.js 톤, 폭풍=어둠).
    //   sky 있으면 색은 sky.js(day-night)이 소유하므로 wind는 폭풍 어둠만 "겹쳐" 보간한다.
    if(scene.fog){
      // near/far: 맑음(_fn0/_ff0) ↔ 폭풍(60/700)을 rainAmt로 직접 보간(점진).
      scene.fog.near = _fn0 + (60-_fn0)*rainAmt;
      scene.fog.far  = _ff0 + (700-_ff0)*rainAmt;
    }
    // 색(배경/안개): sky 없으면 wind가 _dark로, 있으면 sky가 칠한 색 위에 _dark를 rainAmt만큼 겹침.
    if(!ctx.sky){
      scene.background.copy(_sky0).lerp(_dark, rainAmt);
      if(scene.fog&&_fogC0) scene.fog.color.copy(_fogC0).lerp(_dark, rainAmt);
    } else if(rainAmt>0.001){
      // sky.js가 이미 이번 프레임 fog/background 색을 시간대 톤으로 칠함(applyDayNight). 그 위에 폭풍 어둠 겹침.
      scene.background.lerp(_dark, rainAmt*0.85);
      if(scene.fog) scene.fog.color.lerp(_dark, rainAmt*0.85);
    }
    // 햇빛/주변광: sky가 매 프레임 _sunBase/_hemiBase로 시간대 밝기를 적용 → wind는 폭풍 어둠을 rainAmt로 겹침.
    if(ctx.sky && ctx.sky._sunBase!=null){
      if(ctx.sun) ctx.sun.intensity  = ctx.sky._sunBase  + (0.12 - ctx.sky._sunBase )*rainAmt;
      if(ctx.hemi) ctx.hemi.intensity = ctx.sky._hemiBase + (0.32 - ctx.sky._hemiBase)*rainAmt;
    } else {
      if(ctx.sun) ctx.sun.intensity  = _sun0  + (0.12 - _sun0 )*rainAmt;
      if(ctx.hemi) ctx.hemi.intensity = _hemi0 + (0.32 - _hemi0)*rainAmt;
    }

    // 🌧️ 비 입자 — rainAmt>임계일 때만 렌더, 불투명도를 rainAmt로 페이드인/아웃(갑자기 안 나타남).
    const RAIN_VIS = 0.02;
    rain.visible = !_inDg && rainAmt > RAIN_VIS;   // ⛏️던전 안엔 비가 오면 안 된다(카메라 추종이라 실내까지 따라옴)
    if(rain.visible){
      rain.position.set(camera.position.x, 0, camera.position.z);
      const a=rainGeo.attributes.position.array; for(let i=0;i<N;i++){ a[i*6+1]-=dt*70; a[i*6+4]-=dt*70; if(a[i*6+1]<0){ a[i*6+1]+=90; a[i*6+4]+=90; } } rainGeo.attributes.position.needsUpdate=true;
      // 🌧️ 밤 빗줄기 가시성: 밤일수록 은청빛 + 불투명도↑. ★rainAmt를 곱해 비가 짙어질수록 진하게(페이드).
      rainMat.color.copy(_rainDay).lerp(_rainNight, nightK);
      const baseOpa = 0.5 + nightK*0.42;                               // 낮 0.5 ~ 밤 0.92
      rainMat.opacity = baseOpa * THREE.MathUtils.clamp((rainAmt-RAIN_VIS)/(1-RAIN_VIS),0,1);   // 0→full 페이드
    }
    // 🔊 폭풍 소리 — 볼륨도 rainAmt 비례(갑자기 안 켜짐). rainAmt 거의 0이면 정지.
    if(!_inDg && rainAmt>0.01){ if(storm.paused){ storm.play().catch(()=>{}); } storm.volume = 0.6*rainAmt; }
    else { if(!storm.paused) storm.pause(); }
    // ⚡ 번개 — 폭풍이 충분히 짙을 때만(rainAmt 비례 빈도·강도). 갬과 함께 자연 소멸.
    if(!_inDg && rainAmt>0.45){
      const flashThresh = (0.985 - nightK*0.006) - (rainAmt-0.45)*0.01; // 폭풍 깊을수록 빈도 약간↑
      const flashPeak   = (4.0 + nightK*4.0) * rainAmt;                 // 비 짙을수록 섬광 강도↑
      if(flash.intensity<0.3 && Math.random()>flashThresh){ flash.position.set(camera.position.x+(Math.random()-0.5)*200, 220+Math.random()*120, camera.position.z+(Math.random()-0.5)*200); flash.intensity=flashPeak+Math.random()*7; }
    }
    flash.intensity*=0.86;                                              // 잔광 감쇠(항상) — 갬 시 부드럽게 꺼짐
  });
  // R = 비 토글 ⚙️ 샌드박스/테스트 전용(일반 게임 R 미사용) + 건설 중 R회전 우선.
  //   ★2026-07-24: 상태머신을 직접 밀어 자동 스케줄러와 어긋나지 않게 함(구 raining 직접 토글은 다음 만료에 되돌려짐).
  addEventListener('keydown',e=>{ if(e.code!=='KeyR') return; if(!window.__testMode) return;
    if(ctx.input && ctx.input.mode()==='build') return;
    _wxSet(wxState==='storm' ? 'clear' : 'storm'); });

  // 🎛️ 라이브 훅 — 사령관 실플레이 판정용(헤드리스 아님, 콘솔에서 즉시).
  try{
    window.__storm = v => {   // __storm(1)=즉시 폭풍 / __storm(0)=즉시 갬 / 인자 없으면 토글
      const on = (v==null) ? !(wxState==='storm') : !!(+v);
      _wxSet(on ? 'storm' : 'clear'); return wxState;
    };
    window.__weather = () => ({ state:wxState, nextInSec:+wxTimer.toFixed(1), rainAmt:+rainAmt.toFixed(3),
      raining:ctx.wind.raining, strength:+ctx.wind.strength.toFixed(3),
      blocked:_wxBlocked(), testMode:!!window.__testMode,
      swell: ctx.water&&ctx.water.mat.uniforms ? +ctx.water.mat.uniforms.uSwell.value.toFixed(3) : null,
      waveAmp: ctx.water&&ctx.water.mat.uniforms ? +ctx.water.mat.uniforms.uWaveAmp.value.toFixed(3) : null });
  }catch(_){}
  return ctx.wind;
}
