// perfprobe.js — 프레임 드랍 원인 계측기. 사령관 "전투 프레임 드랍 어떡할 건데"(2026-07-22).
// ─────────────────────────────────────────────────────────────────────────────
// 왜 필요한가: 헤드리스에서는 **전투를 재현할 수 없다**(포인터락이 없어 몹 스폰/게임 루프가 안 돈다).
//   즉 앤이 전투 렉을 직접 측정할 방법이 없어 추측만 하게 된다. 그래서 **사령관 기계에서 실제로 재는** 도구를 넣는다.
//
// 핵심으로 보는 것 — 프레임이 튀는 원인은 대개 이 셋 중 하나다:
//   ① 셰이더 컴파일: `renderer.info.programs` 가 늘어나는 프레임 = 그 자리에서 컴파일 = 수십~수백 ms 히칫.
//      ⚠️three.js는 **광원 개수가 바뀌면 관련 머티리얼을 전부 재컴파일**한다(라이트 add/remove·visible 토글이 주범).
//   ② 그리기 양: draw call / 삼각형이 갑자기 늘어남.
//   ③ 순수 CPU: 위 둘이 그대로인데 프레임만 느림 = 물리·AI·애니메이션.
// 튄 프레임마다 **그 순간의 스냅샷 차이**를 같이 찍어야 셋 중 무엇인지 갈린다. 그래서 매 프레임 델타를 들고 있는다.
//
// 사용(브라우저 콘솔):
//   __perf()        — 12초간 측정 후 요약. 전투 시작하고 바로 치면 됨.
//   __perf(20)      — 20초간
//   __perf.stop()   — 중단
export function initPerfProbe(ctx){
  let on = false, until = 0, frames = [], spikes = [];
  let prev = null;

  const snap = () => {
    const i = ctx.renderer.info;
    let lights = 0;
    ctx.scene.traverse(o => { if(o.isLight && o.visible && o.intensity > 0.001) lights++; });
    return { calls: i.render.calls, tris: i.render.triangles,
             programs: i.programs ? i.programs.length : 0,
             geo: i.memory.geometries, tex: i.memory.textures, lights };
  };

  ctx.onUpdate((dt) => {
    if(!on) return;
    const ms = (dt || 0.016) * 1000;
    frames.push(ms);
    const s = snap();
    // 33ms(=30fps) 넘게 걸린 프레임만 원인 후보와 함께 기록
    if(prev && ms > 33){
      spikes.push({ ms: +ms.toFixed(1),
        프로그램: s.programs - prev.programs, 광원: s.lights - prev.lights,
        드로우콜: s.calls - prev.calls, 지오메트리: s.geo - prev.geo, 텍스처: s.tex - prev.tex });
    }
    prev = s;
    if(performance.now() >= until) finish();
  });

  function finish(){
    on = false;
    if(!frames.length){ console.log('[perf] 표본 없음'); return; }
    const f = frames.slice().sort((a,b) => a-b);
    const q = (p) => f[Math.min(f.length-1, Math.floor(f.length*p))];
    const fps = (ms) => (1000/ms).toFixed(0);
    console.log('%c══ 프레임 측정 결과 ══', 'font-weight:bold;color:#8fe0f0');
    console.log('프레임 ' + f.length + '개 · 중앙값 ' + q(0.5).toFixed(1) + 'ms(' + fps(q(0.5)) + 'fps)'
      + ' · 하위5% ' + q(0.95).toFixed(1) + 'ms(' + fps(q(0.95)) + 'fps)'
      + ' · 최악 ' + f[f.length-1].toFixed(1) + 'ms(' + fps(f[f.length-1]) + 'fps)');
    const cur = snap();
    console.log('현재: 드로우콜 ' + cur.calls + ' · 삼각형 ' + cur.tris.toLocaleString()
      + ' · 셰이더 프로그램 ' + cur.programs + ' · 켜진 광원 ' + cur.lights);
    if(!spikes.length){ console.log('✅ 33ms 넘는 튄 프레임 없음'); }
    else {
      const compile = spikes.filter(s => s.프로그램 > 0);
      const lightChg = spikes.filter(s => s.광원 !== 0);
      console.log('⚠️ 튄 프레임 ' + spikes.length + '개 (33ms 초과)');
      console.log('   그중 셰이더 컴파일 동반 ' + compile.length + '개'
        + (compile.length ? '  ← 주범일 가능성 높음(그 자리서 컴파일)' : ''));
      console.log('   그중 광원 수 변동 동반 ' + lightChg.length + '개'
        + (lightChg.length ? '  ← 광원 add/remove·visible 토글이 셰이더 재컴파일을 부른다' : ''));
      console.table(spikes.slice(0, 15));
    }
    frames = []; spikes = []; prev = null;
  }

  const start = (sec) => {
    frames = []; spikes = []; prev = snap(); on = true;
    until = performance.now() + (sec || 12) * 1000;
    console.log('%c[perf] ' + (sec || 12) + '초간 측정 시작 — 지금 전투하십시오', 'color:#ffe7a0;font-weight:bold');
  };
  start.stop = () => { if(on) finish(); else console.log('[perf] 측정 중 아님'); };
  try{ window.__perf = start; }catch(_){}
  console.log('[perfprobe] 준비 — 콘솔에 __perf() 입력 시 12초 측정(전투 중에 치면 원인이 갈립니다)');
}
