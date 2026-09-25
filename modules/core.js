// core.js — THREE 씬/카메라/렌더러/루프 + 공유 컨텍스트(ctx) 생성. 한 책임: 렌더 기반.
import * as THREE from 'three';
import { BAL } from './balance.js';   // 🌫️ 원경 대기(BAL.atmosphere) — 안개 밀도·랜드마크 관통 SSOT

export function initCore({ sky=0x8fc1e3 }={}){
  // ── 전역 텍스처 경로 교정 ── FBX 파일들이 내부에 박아둔 원본 소스 경로(export 시 남은 상대경로)를
  //   로더가 자동 탐색하다 404를 냄. DefaultLoadingManager URLModifier로 모든 FBXLoader에 일괄 교정(콘솔 정리 + 실텍스처 연결).
  const _BLANK_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  THREE.DefaultLoadingManager.setURLModifier(u=>{
    if(/\.vox(\?|$)/i.test(u)) return _BLANK_PNG;                                                   // 대포 등 원본 MagicaVoxel 참조(미사용) → 빈 이미지
    if(/LowPolyDungeonsLite.*Texture_01\.png/i.test(u)) return '/tomob-deploy/obj/LowPolyDungeonsLite/Textures/LowPolyDungeonsLite_Texture_01.png';   // 던전 아틀라스 실경로
    return u.replace(/\/Meshes\/Rocks\/([^\/?#]+\.png)/i, '/Textures/$1');                          // Polytope 바위: Meshes/Rocks → Textures (실텍스처 연결)
  });

  // ── 🌫️ 원경 대기: FogExp2 + **높이 기반 관통**(사령관 확정 2026-08-07 B안) ──
  //   구: Fog(sky, 600, 4000) 선형 — 2000m에서도 35%만 흐려져 원경이 또렷했다("시야가 끝까지 보이니까 이상함").
  //   신: 거리 제곱으로 흐려지되(FogExp2), **월드 y가 높을수록 안개를 덜 받는다**.
  //       대기는 해수면 근처가 짙으므로 산 봉우리만 안개 위로 솟아 실루엣이 남는다 = 엘든링 황금나무 방식.
  //       오브젝트를 따로 지정할 필요 없이 지형 높이만으로 자동 성립 → 새 랜드마크가 생겨도 배선 불필요.
  //   구현: three.js 내장 fog 셰이더 청크를 패치한다(모든 fog 사용 재질에 일괄 적용).
  //       ⚠️재질 생성보다 **먼저** 실행돼야 uniform이 포함된다 — core는 첫 모듈이라 여기가 맞는 자리.
  //       하늘·별·달·태양 스프라이트는 이미 fog:false라 영향 없음. 폭풍 중 fog 색은 wind.js가 계속 소유(색만 바꿈).
  const _ATM = (BAL.atmosphere || { density:0.00035, heightStart:30, heightRange:260, heightRelief:0.72 });
  if(!THREE.ShaderChunk.__fogHeightPatched){
    THREE.ShaderChunk.__fogHeightPatched = true;
    THREE.UniformsLib.fog.fogHeightStart  = { value: _ATM.heightStart };
    THREE.UniformsLib.fog.fogHeightRange  = { value: _ATM.heightRange };
    THREE.UniformsLib.fog.fogHeightRelief = { value: _ATM.heightRelief };
    // ⚠️필수: ShaderLib은 three.js **모듈 로드 시점**에 UniformsLib를 합쳐 이미 만들어져 있다.
    //   위처럼 UniformsLib에 키를 더해도 기존 ShaderLib 항목엔 반영되지 않아, 셰이더가 참조하는 uniform이
    //   실제로는 없어 값 0으로 떨어진다(= 높이 관통이 조용히 무효화. 실측으로 확인함).
    //   → fog를 쓰는 모든 ShaderLib 항목에 같은 uniform 객체를 직접 주입한다(같은 객체 공유 = 실시간 튜닝도 함께 먹음).
    for(const k in THREE.ShaderLib){ const u = THREE.ShaderLib[k] && THREE.ShaderLib[k].uniforms;
      if(u && u.fogColor){ u.fogHeightStart = THREE.UniformsLib.fog.fogHeightStart;
        u.fogHeightRange = THREE.UniformsLib.fog.fogHeightRange; u.fogHeightRelief = THREE.UniformsLib.fog.fogHeightRelief; } }
    // 정점: 월드 y를 프래그먼트로 넘긴다(transformed = begin_vertex가 만든 로컬 정점).
    THREE.ShaderChunk.fog_pars_vertex += '\nvarying float vFogWorldY;';
    THREE.ShaderChunk.fog_vertex      += '\nvFogWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;';
    THREE.ShaderChunk.fog_pars_fragment += '\nvarying float vFogWorldY;\nuniform float fogHeightStart;\nuniform float fogHeightRange;\nuniform float fogHeightRelief;';
    // 프래그먼트: 계산된 fogFactor에 높이 감쇠를 곱한다. 내장 청크의 mix( ..., fogFactor ) 한 줄만 교체.
    THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
      'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
      'float hAtten = 1.0 - fogHeightRelief * clamp( ( vFogWorldY - fogHeightStart ) / max( fogHeightRange, 1.0 ), 0.0, 1.0 );\n'+
      '\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * hAtten );'
    );
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.FogExp2(sky, _ATM.density);

  // 🎚️ 실시간 튜닝(사령관 눈 판정용) — 리로드 없이 콘솔에서 조절. 확정값은 BAL.atmosphere에 옮겨 적을 것.
  //   __fog()                현재 값 보기
  //   __fog(0.0005)          안개 밀도만(클수록 자욱)
  //   __fog(0.00035, 0.9)    밀도 + 랜드마크 관통(0=봉우리도 다 묻힘 / 1=봉우리 또렷)
  //   __fog(null, null, 30, 260)  관통 시작 높이 · 도달 높이차
  if(typeof window!=='undefined') window.__fog=(d, relief, hStart, hRange)=>{
    const U=THREE.UniformsLib.fog;
    if(d!=null && scene.fog) scene.fog.density=+d;
    if(relief!=null) U.fogHeightRelief.value=+relief;
    if(hStart!=null) U.fogHeightStart.value=+hStart;
    if(hRange!=null) U.fogHeightRange.value=+hRange;
    // 이미 컴파일된 재질들의 uniform 인스턴스까지 갱신(UniformsLib은 신규 재질용 원본이라 따로 반영해야 함)
    let n=0; scene.traverse(o=>{ const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
      ms.forEach(m=>{ if(m&&m.userData&&m.userData.__fogU){ const u=m.userData.__fogU;
        if(relief!=null) u.fogHeightRelief.value=+relief; if(hStart!=null) u.fogHeightStart.value=+hStart;
        if(hRange!=null) u.fogHeightRange.value=+hRange; n++; } }); });
    const r={ density:scene.fog&&+scene.fog.density.toFixed(5), relief:U.fogHeightRelief.value,
              heightStart:U.fogHeightStart.value, heightRange:U.fogHeightRange.value, 갱신된재질:n };
    console.log('%c[fog]', 'color:#8fc1e3', JSON.stringify(r)); return r;
  };
  // 컴파일된 재질의 fog uniform을 잡아둔다(위 __fog가 실시간 반영할 수 있게)
  THREE.Material.prototype.onBeforeCompile = (function(prev){
    return function(shader, renderer){
      if(this.fog && shader.uniforms && shader.uniforms.fogHeightRelief){ this.userData=this.userData||{}; this.userData.__fogU=shader.uniforms; }
      if(prev) prev.call(this, shader, renderer);
    };
  })(THREE.Material.prototype.onBeforeCompile);

  const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 8000);
  // ⚡ 렌더러 최적화(2026-07-04 사령관 승인 — 보류 목록 ①②):
  //   ①preserveDrawingBuffer = 스크린샷 캡처 전용 비용 → 하네스(playwright=navigator.webdriver)·?shot·?pdb에서만 켬.
  //     실플레이는 false = GPU가 프레임버퍼를 매 프레임 보존/복사 안 함.
  //   ②pixelRatio 캡 2.0→1.5 — 고DPI에서 픽셀 수 ~44% 감소. 선명도 원복/조정 = ?dpr=2 (사령관 눈 판정).
  //   ③고DPI 자동 감지(2026-07-05): 맥 Retina 등 devicePixelRatio>1 화면은 픽셀 필레이트 병목(맥 실측 dpr1.5=20fps→dpr1.0=45fps).
  //     고DPI면 기본 dpr을 1.0으로 하향(윈도우 dpr1은 원래도 min(1.5,1)=1.0이라 무변). 수동 조정 = ?dpr=N(선명도↔프레임 사령관 눈 판정).
  const _rq=(typeof location!=='undefined')?new URLSearchParams(location.search):new URLSearchParams('');
  const _pdb=(typeof navigator!=='undefined'&&navigator.webdriver)||_rq.has('shot')||_rq.has('pdb');
  const _dpr=(typeof devicePixelRatio!=='undefined')?devicePixelRatio:1;
  const _dprParam=parseFloat(_rq.get('dpr'));
  const _dprDefault=(_dpr>1)?1.0:1.5;                      // 고DPI(Retina 등)=1.0 / 일반=1.5
  const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:_pdb });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(_dprParam>0?_dprParam:_dprDefault, _dpr));
  // 🌑 그림자맵(2026-07-24 비주얼 오버홀 Phase 1) — 사령관 "게임이 다 떠 보임".
  //   진단: 오브젝트에 castShadow=true가 수백 개인데 renderer.shadowMap이 꺼져 전부 죽은 코드였다.
  //   태양(sky.js가 위치 갱신)을 유일 캐스터로. autoUpdate 유지(태양이 하루 곡선으로 이동).
  //   ?noshadow=1로 끄기(성능 비교/저사양 폴백). PCFSoft = SoT풍 부드러운 그림자.
  renderer.shadowMap.enabled = !_rq.has('noshadow');
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // ★아트 통일(밝은 로우폴리 판타지): hemi 지면색을 칙칙한 청회(0x557088)에서 따뜻한 모래/물빛(0x6f8a99)으로.
  //   배·캐릭터 아랫면이 차가운 죽은 청회로 깔리지 않고 장면 톤과 어울리는 따뜻한 환경광을 받음.
  // 🌑 그림자=cool 원칙(2026-07-24 리서치: warm 햇빛 ↔ cool 그림자 대비 = 스타일라이즈드 핵심, _색감_리서치.md ★2).
  //   앤이 한때 따뜻(0x8a7c62)으로 바꿨으나 **오판** — 그림자는 cool이어야 warm 태양과 대비가 산다.
  //   나무 검정은 색온도가 아니라 밝기 문제였다 → ambient(sky.js _ambBase 0.30)로 해결. 지면 바운스색은 시원한 청회 유지.
  const hemi=new THREE.HemisphereLight(0xffffff, 0x6f8a99, 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.6); sun.position.set(200,400,150); scene.add(sun);
  // 🌑 태양 그림자 설정(Phase 1) — 플레이어 추종 타이트 프러스텀(sky.js가 매 프레임 sun.position/target 갱신).
  //   ⚠️오픈월드: 플레이어가 원점에서 수천 유닛 떨어져 있어(스샷 5923,4215) 프러스텀이 플레이어를 따라가야 함.
  //   반경 SHADOW_R로 커버. 2048맵 / 반경 = px밀도(150 → 6.8px/m). 넓히면 계단, 좁히면 근처만.
  const SHADOW_R = 150;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const _sc = sun.shadow.camera;   // OrthographicCamera
  _sc.near = 10; _sc.far = 1000; _sc.left = -SHADOW_R; _sc.right = SHADOW_R; _sc.top = SHADOW_R; _sc.bottom = -SHADOW_R;
  _sc.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;       // acne 억제. 과한 음수 bias가 만든 면 번짐 완화
  sun.shadow.normalBias = 0.25;     // 1.5는 접촉 그림자를 물체에서 띄움(peter-panning). 월드 단위에 맞게 축소
  scene.add(sun.target);            // target을 씬에 넣어야 매트릭스 갱신됨(sky.js가 플레이어로 이동)
  // ★fill light(역광 음영 채우기) — 태양 반대쪽에서 비추는 약한 방향광(그림자 없음).
  //   AmbientLight를 추가하면 로우폴리 입체감이 납작해지므로, 방향성 fill로 음영만 부드럽게 채운다.
  //   색은 하늘 반사를 모사한 차분한 하늘빛(0xbcd6ec). 강도는 sky.js가 dayTime 곡선으로 갱신(낮만 켜짐).
  const fill = new THREE.DirectionalLight(0xbcd6ec, 0.0); fill.position.set(-200,180,-150); scene.add(fill);
  // ★재작업2(안쪽벽 보강): fill directional이 못 닿는 선체 내부 깊은 면을 위한 아주 약한 AmbientLight.
  //   강도 0.12(낮 한정, sky.js가 day 비례 갱신) — 입체감 죽지 않는 선에서 검정 죽음만 방지. 색은 따뜻한 하늘빛.
  const amb = new THREE.AmbientLight(0xcfe0ee, 0.0); scene.add(amb);

  const _updaters = [];
  const _removeSet = new Set();                // offUpdate 지연 제거 대기열(프레임 시작 시 일괄 반영)
  function _flushRemovals(){ if(!_removeSet.size) return;
    for(let i=_updaters.length-1;i>=0;i--){ if(_removeSet.has(_updaters[i])) _updaters.splice(i,1); }
    _removeSet.clear(); }
  const _preRender = [];                       // 씬 렌더 직전 훅(밤하늘 배경 등 — scene을 덮어쓰기 전 먼저 그림)
  let _renderOverride = null;                  // 렌더 오버라이드(포스트프로세싱 composer 등). null이면 기본 renderer.render. 게임은 미사용.
  function _renderFrame(){
    if(_preRender.length){ for(const r of _preRender){ try{ r(); }catch(e){ console.error('[preRender]', e); } } }
    if(_renderOverride){ _renderOverride(); } else { renderer.render(scene, camera); }
  }
  // ── 타격감 A1: 히트스톱(전역 시간배율) ── 명중 순간 timeScale을 잠깐 낮췄다 복귀시켜 "칼이 박히는" 멈칫을 만든다.
  //   중앙 dt 디스패치(아래 start()/tick())에서 dt *= timeScale 한 곳으로만 적용 → 물리·애니·이동 전부 동시 슬로우.
  //   setTimeout 금지: 루프 자체의 now(또는 tick 누적시간)와 _hitStopUntil 비교로 복귀 → dt 클램프·헤드리스 tick과 충돌 방지.
  let _hitStopUntil = 0;          // 이 시각(ms) 전까지 timeScale 유지
  let _hitStopScale = 1;          // 히트스톱 중 적용할 배율(호출 시 지정)
  let _hitStopTickUntil = 0;      // tick() 가상시계 기준 히트스톱 종료시각(ms)
  let _tickClock = performance.now();   // tick() 경로 전용 가상시계(rAF 없이도 히트스톱 ms가 흐르게)
  function _applyTimeScale(baseDt, nowMs){
    if(nowMs < _hitStopUntil){ ctx.timeScale = _hitStopScale; }
    else { ctx.timeScale = 1; }
    return baseDt * ctx.timeScale;
  }
  const ctx = {
    THREE, scene, camera, renderer, sun, hemi, fill, amb,
    timeScale: 1,                                             // 전역 시간배율(1=정상). 히트스톱이 잠깐 <1로 낮춤.
    onUpdate: fn => { _updaters.push(fn); return fn; },
    // ★offUpdate — 등록 해제(오프닝 폴러 등 수명 끝난 콜백 누적 방지). 루프 도중 호출돼도 안전하게
    //   지연 제거(다음 프레임 시작 시 일괄 필터) — for..of 순회 중 splice로 콜백이 건너뛰어지는 버그 방지.
    offUpdate: fn => { if(fn) _removeSet.add(fn); },
    onPreRender: fn => { _preRender.push(fn); return fn; },   // 밤하늘 배경 합성용
    // ★R2 이벤트 버스(2026-07-04) — 구 ctx.onX "prev 저장→호출" 수제 체인(4곳이 각자 래핑, 하나라도 잊으면 조용히 끊김) 폐지.
    //   레거시 ctx.on<Name> 브리지는 2026-07-12 제거(유일한 세터였던 orphan follower.js 삭제와 함께). 순수 pub/sub.
    //   이벤트명: wharfBuilt / shipBuilt / outpostCaptured / toolCrafted (신규는 여기에 등록만 하면 됨).
    events: (() => {
      const _ev = new Map();
      return {
        on(n, fn){ if(!_ev.has(n)) _ev.set(n, new Set()); _ev.get(n).add(fn); return () => _ev.get(n)?.delete(fn); },
        off(n, fn){ _ev.get(n)?.delete(fn); },
        emit(n, ...a){
          const s = _ev.get(n); if(s) for(const fn of [...s]) try{ fn(...a); }catch(e){ console.warn('[events] '+n, e&&e.message); }
        },
      };
    })(),
    setRenderOverride: fn => { _renderOverride = fn; },        // 포스트프로세싱(블룸 composer) 끼우기. null로 해제.
    getRenderOverride: () => _renderOverride,                  // 기존 오버라이드 백업/복원용(임시 효과가 빌려쓸 때)
    // ★히트스톱 트리거 — combat.damageMonster가 호출. ms=지속시간, scale=그동안의 배율(기본 BAL.feel.hitStop.scale).
    //   더 긴 히트스톱이 이미 진행 중이면 유지(짧은 평타가 긴 처치 히트스톱을 덮어쓰지 않게 max).
    hitStop(ms, scale=0.05){ const now=performance.now(); const until=now+ms;
      if(until > _hitStopUntil){ _hitStopUntil = until; _hitStopScale = scale; }
      // tick() 경로도 즉시 반영되도록 가상시계 기준으로도 기록(둘 중 큰 값 사용).
      const tuntil=_tickClock+ms; if(tuntil > _hitStopTickUntil){ _hitStopTickUntil = tuntil; } },
    start(){ let last=performance.now();
      (function loop(now){ let dt=Math.min(0.05,(now-last)/1000); last=now;
        dt = _applyTimeScale(dt, now);                        // ★A1: 히트스톱 시 전역 dt 슬로우(단일 스케일 지점)
        _flushRemovals();
        for(const u of _updaters){ try{ u(dt, now); }catch(e){ console.error('[update]', e); } }
        _renderFrame(); requestAnimationFrame(loop);
      })(performance.now());
    },
    tick(dt){ _tickClock += dt*1000; const now=performance.now();   // 헤드리스 검증용 — rAF 없이 한 프레임 강제 진행(가상시계 누적)
      // tick 경로는 실제 벽시계가 아니라 누적 가상시계(_tickClock)로 히트스톱을 판정 → 고정 dt 반복으로 ms 정밀 측정 가능.
      if(_tickClock < _hitStopTickUntil){ ctx.timeScale = _hitStopScale; } else { ctx.timeScale = 1; }
      dt = dt * ctx.timeScale;
      _flushRemovals();
      for(const u of _updaters){ try{ u(dt, now); }catch(e){ console.error('[tick]', e); } }
      _renderFrame(); },
  };
  return ctx;
}
