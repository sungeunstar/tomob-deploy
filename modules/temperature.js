// temperature.js — 체감온도 생존 시스템 (게임 밸런스 · 로직). combat.js HUD는 ctx.temp를 "표시만".
//   소스: sky.dayTime(시간대) + environment.tier(바이옴) + player 고도. → 위험존이면 HP 드레인.
//   ?sys=...,temperature 로 로드. ★밸런스 값은 전부 CFG 한 곳(사령관 튜닝 지점).
//   노출: ctx.temp = { value(°C), zone('cold'|'safe'|'hot'), ratio()(0=최한 1=최열), CFG }.
import { toast } from './uikit.js';
import { BAL } from './balance.js';   // ⚖️ 밸런스 SSOT (온도 CFG)
const TORCH_WARM = 14;   // 🔥 든 횃불 온기(밤 추위 상쇄) — 횃불 들고 있으면 몸이 녹는다(사령관)
export function initTemperature(ctx){
  const CFG = BAL.temp;   // ★튜닝 지점 = balance.js BAL.temp (SAFE_MIN/MAX·DPS·BIOME 등)
  let temp = 18, zone = 'safe', _dmgAcc = 0, _warnT = 0;

  function targetTemp(){
    const dayTime = ctx.sky ? ctx.sky.dayTime : 0.25;             // 0=일출·0.25=정오·0.75=자정
    const warmth  = Math.cos((dayTime - 0.25) * Math.PI * 2);     // +1 정오 / −1 자정
    const base    = CFG.BIOME[ctx.environment?.tier] ?? 17;       // 바이옴 기준
    const seaLv   = ctx.water ? ctx.water.level : 0;
    const alt     = Math.max(0, (ctx.player?.pos?.y || 0) - seaLv);
    const fire    = ctx.campfire ? ctx.campfire.warmth(ctx.player?.pos) : 0;   // 🔥 근처 모닥불 온기(밤 추위 상쇄)
    const torch   = (ctx.torch && ctx.torch.lit) ? TORCH_WARM : 0;             // 🔥 손에 든 횃불 온기
    return base + warmth * CFG.DAY_AMP - alt * CFG.ALT_LAPSE + fire + torch;
  }

  // ── 🌙 밤 추위 튜토(캐릭터별 최초 1회, 비차단 상단팝업) — 밤에 처음 추워지면 "횃불/모닥불로 몸 녹여라" 안내(사령관) ──
  //   ★버그#10 수정: 이전엔 localStorage 'mas_cold_tuto' 전역 저장 → 한 번 본 뒤 새 캐릭터/새 게임에서도 다시 안 떴다.
  //   캐릭터 id(URL ?cid= = 세이브 cid, 폴백 ?char=/?name=)별 키로 저장 → 새 캐릭터면 다시 안내. id 없으면 세션 한정(새 게임마다 1회).
  let _coldTutoDone = false, _coldTutoKey = null;
  try {
    const _q = new URLSearchParams(location.search);
    const _cid = _q.get('cid') || _q.get('char') || _q.get('name');
    if(_cid){ _coldTutoKey = 'mas_cold_tuto:' + _cid;
      if(localStorage.getItem(_coldTutoKey)) _coldTutoDone = true; }
    // cid 없음(새 게임 초기 진입 등) → 영구 저장 안 함. 세션 메모리 플래그로만 1회 표시.
  } catch(_){}
  function showColdTuto(){
    if(_coldTutoDone) return; _coldTutoDone = true;
    if(_coldTutoKey){ try { localStorage.setItem(_coldTutoKey,'1'); } catch(_){} }
    const st=document.createElement('style'); st.id='coldTutoStyle';
    st.textContent="#coldTuto{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:57;width:min(560px,88vw);"
      +"background:linear-gradient(180deg,rgba(12,18,28,.94),rgba(9,13,20,.92));border:1px solid rgba(120,170,220,.5);border-radius:10px;"
      +"box-shadow:0 16px 50px rgba(0,0,0,.55);color:#e7eef6;font-family:'Pretendard',system-ui,'Malgun Gothic',sans-serif;"
      +"opacity:0;transition:opacity .6s ease;pointer-events:none;overflow:hidden}#coldTuto.show{opacity:1}";
    document.head.appendChild(st);
    const el=document.createElement('div'); el.id='coldTuto';
    el.innerHTML="<div style=\"padding:13px 20px 9px;font-size:16px;font-weight:700;color:#bfe0ff;letter-spacing:.02em;border-bottom:1px solid rgba(120,170,220,.22)\">밤이 깊어 추워졌다</div>"
      +"<div style=\"padding:12px 20px 6px;font-size:14px;line-height:1.75;color:#cdd7e2\">체온이 떨어지고 있어요. 몸을 녹이지 않으면 얼어붙어요 — 다음 중 하나로 버티세요:</div>"
      +"<div style=\"padding:4px 20px 16px;font-size:13.5px;line-height:1.9;color:#eadfc6\">"
      +"<b style=\"color:#ffd98a\">횃불</b> — 인벤 제작(목재1·나뭇잎2) 후 <b>손에 들면</b> 몸이 따뜻해진다<br>"
      +"<b style=\"color:#ffd98a\">모닥불</b> — 제작(목재3·돌2) 후 지면에 설치하면 <b>근처가 따뜻해진다</b>(안식처)</div>";
    document.body.appendChild(el); requestAnimationFrame(()=>el.classList.add('show'));
    setTimeout(()=>{ el.classList.remove('show'); setTimeout(()=>{ try{ el.remove(); st.remove(); }catch(_){} }, 800); }, 11000);
  }

  ctx.onUpdate(dt => {
    dt = dt ?? 0.016;
    temp += (targetTemp() - temp) * Math.min(1, dt * CFG.SMOOTH);
    zone = temp < CFG.SAFE_MIN ? 'cold' : temp > CFG.SAFE_MAX ? 'hot' : 'safe';
    // ★사령관 2026-07-10: 밤 추위 위험존이 일반 섬(small/mid/large, 기준온도 17~18)에서도 밤엔 DAY_AMP(9)만큼 떨어져
    //   SAFE_MIN(8) 근처까지 내려가 오작동 — 원래 "얼음맵에서만" 위험해야 하므로 ice 바이옴에서만 피해 적용.
    if(zone !== 'safe' && ctx.environment?.tier === 'ice' && ctx.combat && !ctx.combat.isDead?.()){
      if(zone === 'cold') showColdTuto();   // 🌙 첫 추위 = 몸 녹이는 법 안내(1회)
      // 위험존 = 환경 피해(가드 무시). HP는 combat이 소유 → envHurt 위임.
      _dmgAcc += (zone === 'cold' ? CFG.COLD_DPS : CFG.HOT_DPS) * dt;
      if(_dmgAcc >= 1){ const d = Math.floor(_dmgAcc); _dmgAcc -= d; ctx.combat.envHurt?.(d, zone); }
      _warnT -= dt;
      if(_warnT <= 0){ _warnT = CFG.WARN_EVERY;
        toast(zone === 'cold' ? '너무 춥다 — 체온이 떨어진다' : '너무 덥다 — 열기에 지친다',
          { accent: zone === 'cold' ? 'cyan' : 'red', ms:2600 }); }
      ctx.sound?.heartbeat?.(true);    // ★위험존 체력 드레인 중 심장박동(사령관 mp3)
    } else { _dmgAcc = 0; _warnT = 0; ctx.sound?.heartbeat?.(false); }
  });

  ctx.temp = {
    get value(){ return temp; },
    get zone(){ return zone; },
    ratio(){ return Math.max(0, Math.min(1, (temp - CFG.RANGE_MIN) / (CFG.RANGE_MAX - CFG.RANGE_MIN))); },
    CFG,
  };
  console.log(`[temperature] 체감온도 — 안전 ${CFG.SAFE_MIN}~${CFG.SAFE_MAX}° · 위험존 ${CFG.COLD_DPS}/s · 바이옴`, CFG.BIOME);
  return ctx.temp;
}
