// ⌨️ 입력 모드 라우터 (INPUT SSOT) — 전수표=voyage/_입력키맵.md
// 문제: 65개 파일이 각자 window keydown → 서로 모른 채 동시 발동(조타 중 Q=스킬+타 동시 등).
// 해결: "지금 무슨 상황이냐(모드)"를 하나로 판정 → 각 핸들러가 ctx.input.blocks(code)로 게이트.
// 키를 쪼개지 않는다. 핸들러는 그대로 두고 최상단에 게이트 1줄만 삽입한다.
//
// 모드 우선순위(높→낮): cutscene > ui > build > ship > foot
//  - cutscene: window.__cutscene===true (오프닝/컷신 훅). wake.js는 자체 하드블록(capture).
//  - ui:       포인터락 풀림 = 패널/메뉴가 입력을 가져감(inv·trade·harbor·forge·settlement·navmap·menu). blur도 포함(안전).
//  - build:    건설/배치 고스트 활성(build.isBuilding · fortify.isPlacing · 등록된 'build').
//  - ship:     ctx.ship.boarded = 조타 중.
//  - foot:     기본(도보 전투).
//
// blocks(code)는 "player.js·combat.js·wind.js 등 게임플레이 핸들러가 이 키를 삼켜야 하나?"를 답한다.
// ★핵심: player.js 메인 keydown은 keys.add(e.code) '직후'에 게이트 → 키는 Set에 들어가되(=ship.js 조타 읽음)
//   플레이어 액션(스킬·발도 등)만 차단. 즉 조타 Q/E/WASD는 살고 스킬만 죽는다.
export function initInput(ctx){
  const _reg = new Set();   // 수동 등록 컨텍스트(게터 없는 배치모드용): 'build' 등

  function _uiOpen(){
    const dom = ctx.renderer && ctx.renderer.domElement;
    return !!(dom && document.pointerLockElement !== dom);
  }
  function _buildOn(){
    return !!( (ctx.build && ctx.build.isBuilding && ctx.build.isBuilding())      // 건축 부품 고스트
            || (ctx.fortify && ctx.fortify.isPlacing && ctx.fortify.isPlacing())  // 축성 블록 배치
            || (ctx.claim && ctx.claim.isPlacing && ctx.claim.isPlacing())        // 대포 배치 고스트
            || (ctx.campfire && ctx.campfire.placing)                             // 모닥불 고스트(getter)
            || (ctx.settlement && ctx.settlement.ghostActive && ctx.settlement.ghostActive())  // 🏗️ 내섬(empire N메뉴) 건물 고스트 배치 — 이게 빠져서 배치 중 R이 크루 라디얼을 열었음(사령관 2026-07-10)
            || (ctx.wharfBuild && ctx.wharfBuild.placing && ctx.wharfBuild.placing())          // ⚓ 항구 고스트 배치 — 누락 시 배치 중 R이 회전 대신 크루 라디얼을 열었음(사령관 2026-07-13)
            || _reg.has('build') );
  }
  function mode(){
    if(typeof window!=='undefined' && window.__cutscene===true) return 'cutscene';
    if(_uiOpen())   return 'ui';
    if(_buildOn())  return 'build';
    if(ctx.ship && ctx.ship.boarded) return 'ship';
    return 'foot';
  }

  // 모드별 차단 키(플레이어 액션 관점). 'MouseLeft'=좌클릭 공격.
  // ship: 조타 중 도보 전투키 차단. F(시점)·Y(하선)·숫자(퀵슬롯)·WASD 이동은 허용.
  const A = 'ALL';
  const BLOCK = {
    foot:     new Set(),
    ship:     new Set(['KeyQ','KeyE','KeyV','KeyC','Space','KeyH','KeyP','MouseLeft']),
    build:    new Set(['KeyQ','KeyV','KeyR','KeyP','MouseLeft']),   // R=비토글(wind) 차단·스킬 차단. R회전은 build 자체 핸들러가 처리
    ui:       A,
    cutscene: A,
  };
  const ALWAYS_ALLOW = new Set(['KeyF']);   // 시점(1/3인칭) 토글 = 해롭지 않고 튜닝·관전에 필요 → 어느 모드(포인터 풀림 ui 포함)든 허용
  function blocks(code){
    if(ALWAYS_ALLOW.has(code)) return false;
    const b = BLOCK[mode()];
    return b===A ? true : b.has(code);
  }

  let _suppressPause = false;   // X 닫기로 합성 Escape 발동 중 = menu.js 일시정지 열림 억제(X는 절대 pause 안 염)

  ctx.input = {
    mode, blocks,
    enter: t=>_reg.add(t),
    exit:  t=>_reg.delete(t),
    isFoot: ()=>mode()==='foot',
    suppressingPause: ()=>_suppressPause,   // menu.js가 참조 — X 합성 Escape 동안 pause 양보
    emoteKey: 'KeyP',   // 손 흔들기 이모트(구 H → 포션과 겹쳐 이관)
    // ★R3(2026-07-04) 중앙 키 등록 — 모듈이 window에 keydown을 직접 다는 대신 이걸 쓴다.
    //   모드 게이트(blocks) 자동 적용 + when(상황 게이트) + dispose 함수 반환(리스너 누수 방지).
    //   기존 44개 산발 리스너는 해당 코드를 만질 때 점진 이관(R6 방식 — 빅뱅 금지). 신규 키는 반드시 이걸로.
    register(code, fn, { when, allowRepeat=false }={}){
      const h = e => { if(e.code!==code) return; if(!allowRepeat && e.repeat) return;
        if(blocks(code)) return; if(when && !when()) return; fn(e); };
      addEventListener('keydown', h);
      return () => removeEventListener('keydown', h);   // dispose
    },
  };

  // ── ❎ X = 닫기/취소 버튼 ──
  // ①튜토 팝업 ②고스트(건설·축성·대포·대장간·모닥불) **직접 취소** ③패널·컷신 합성 Escape.
  //  · 고스트: Esc는 브라우저 포인터락을 풀어 못 씀 → X로 취소. build/fortify는 Esc 핸들러 자체가 없어 직접 취소 필수(합성 Escape로 안 됨).
  //  · 튜토: gather/raid는 자체 X핸들러 없어 tutoSlot.dismiss()로. combattuto/opening 중복 X는 stopImmediatePropagation로 차단.
  function _cancelGhost(){   // 활성 배치 고스트를 각 모듈 취소 메서드로 직접 해제(각각 미활성이면 no-op)
    let hit=false;
    try{ if(ctx.build?.isBuilding?.()){ ctx.build.mode(false); hit=true; } }catch(_){}
    try{ if(ctx.fortify?.isPlacing?.()){ ctx.fortify.exit(); hit=true; } }catch(_){}
    try{ if(ctx.claim?.isPlacing?.()){ ctx.claim.cancelCannonPlace(); hit=true; } }catch(_){}
    try{ if(ctx.campfire && ctx.campfire.placing){ ctx.campfire.stopPlace(); hit=true; } }catch(_){}
    try{ if(ctx.wharfBuild?.placing?.()){ ctx.wharfBuild.cancel(); hit=true; } }catch(_){}   // ⚓ 항구 고스트도 X 취소 대상(일관성)
    return hit;
  }
  if(typeof window!=='undefined'){
    addEventListener('keydown', e=>{
      if(e.code!=='KeyX' || e.repeat) return;
      if(ctx.tutoSlot && ctx.tutoSlot.active && ctx.tutoSlot.active()){   // ① 튜토 팝업 닫기
        ctx.tutoSlot.dismiss && ctx.tutoSlot.dismiss();
        e.stopImmediatePropagation();
        return;
      }
      if(_cancelGhost()){ e.stopImmediatePropagation(); return; }         // ② 고스트 직접 취소(Esc 불필요·포인터락 유지)
      const m = mode();                                                   // ③ 패널·컷신 닫기(합성 Escape)
      if(m==='ui' || m==='cutscene'){
        _suppressPause = true;
        try{ dispatchEvent(new KeyboardEvent('keydown', { code:'Escape', key:'Escape', bubbles:true })); }
        finally{ _suppressPause = false; }
      }
    });
    // ❎ [X] 취소 힌트 — 고스트(배치) 상태 동안 표시. Esc는 포인터락 풀려 못 쓰므로 X 안내.
    const _xh=document.createElement('div'); _xh.id='ghostCancelHint';
    _xh.style.cssText='position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:6;display:none;'
      +'padding:5px 13px;background:rgba(12,16,22,.82);border:1px solid rgba(220,120,110,.5);border-radius:20px;'
      +"color:#ffd7d0;font:12px 'Pretendard',system-ui,sans-serif;pointer-events:none;letter-spacing:.02em;white-space:nowrap;";
    _xh.innerHTML='<b style="color:#ff9b8e">X</b> 취소';
    document.body.appendChild(_xh);
    if(ctx.onUpdate) ctx.onUpdate(()=>{ _xh.style.display = _buildOn() ? 'block' : 'none'; });
  }
  return ctx.input;
}
