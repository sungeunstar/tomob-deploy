// sound.js — TOMOB 사운드 통합 SSOT. 상황별 BGM(bgm_*) + 바다 ambient(suimo_ocean) + 배소리(boat) + 수영(swim) + 물splash + 발소리 + 이벤트 효과음 테이블(SFX_DIR).
// 출처: mas game.html <audio> 요소(bgm/sfxWave/sfxBoat/sfxSwim/sfxSplash) + main.js sfxToggle(1277)/sfxBoat(6863)/sfxOne(1283).
// 브라우저 정책: 첫 클릭/키 입력 후 재생 시작.
import { setUiSound, nowPlaying } from '/tomob-deploy/modules/uikit.js';   // 패널 사운드 훅 + 데스스트랜딩식 now-playing 위젯
const RPG=encodeURI('/tomob-deploy/kenney_rpg-audio/Audio/');

export function initSound(ctx){
  const mk=(src,loop,vol)=>{ const a=new Audio(encodeURI(src)); a.loop=loop; a.volume=vol; a.preload='auto'; return a; };
  // ── BGM 매니저 — 상황별 배경음악(노래) 크로스페이드(우선순위 battle>cave>home>항해풀). 예전 voxel 게임 이식(사령관) ──
  //   home(smithbgm)=집/안전지대 · cave=동굴 · battle=해상전투 · 항해풀(sail/viking…)=배 1분+ 랜덤 · intro=타이틀. ※폭풍=빗소리(wind.js), 노래 아님.
  // ★storm(폭풍)은 시네마틱 BGM 아님 — 노래가 아니라 빗소리(ambient)라서 wind.js가 /sfx/storm.mp3 루프로 처리. now-playing 위젯은 '노래'에만.
  const BGM_SRC={ sail:'/tomob-deploy/bgm_main.mp3', viking:'/tomob-deploy/bgm_viking.mp3', silence:'/tomob-deploy/bgm_silence.mp3', cave:'/tomob-deploy/sfx/bgm_cave.mp3', home:'/tomob-deploy/sfx/bgm_home.mp3', battle:'/tomob-deploy/bgm_battle.mp3', intro:'/tomob-deploy/bgm_intro.mp3',
    // ★2026-07-16(사령관): 던전 BGM = 동굴 음원(bgm_cave) 재사용 · dnd1/dnd2 = 상시 기본 앰비언트(순환)
    dungeon:'/tomob-deploy/sfx/bgm_cave.mp3', dnd1:'/tomob-deploy/dnd1.mp3', dnd2:'/tomob-deploy/dnd2.mp3' };
  const BGM_VOL={ sail:0.30, viking:0.30, silence:0.30, cave:0.32, home:0.34, battle:0.40, intro:0.40,
    dungeon:0.34, dnd1:0.24, dnd2:0.24 };
  const SAIL_POOL=['sail','viking','silence'];   // 항해 랜덤 풀 — 1분+ 항해 후 arm 시 이 중 1곡 랜덤. 곡 추가 시 여기만 늘리면 됨.
  const AMBIENT=['dnd1','dnd2'];   // ★기본 배경음 — 상황곡 없을 때. ★1곡 끝 → 무음 쿨타임 → 다음곡(사령관: 연속재생 금지).
  let _ambIdx=0, _ambState='playing', _ambT=0;
  const AMB_COOL={ min:18, max:36 };   // 곡 사이 무음 쿨타임(초) — 제안값, 라이브 튜닝
  // ── 트랙 표시명(데스스트랜딩식 now-playing) — 제목=영문 · 아티스트=TOMOB · 부제=한글. ★곡명은 사령관 확정 시 교체 ──
  //   title=영문 곡명("...") · artist=TOMOB · note=한글 부제(이탤릭). title 없으면 위젯 안 뜸.
  const BGM_META={
    sail:  { title:'The First Star',      artist:'TOMOB', note:'첫 번째 별' },   // 메인 테마
    viking:{ title:'The Long Ships',      artist:'TOMOB', note:'긴 배' },       // 항해 랜덤 풀(바이킹) ★곡명 사령관 확정 시 교체
    silence:{title:'The Second Silence',  artist:'TOMOB', note:'파도 아래의 성가' }, // 항해 랜덤 풀(Hymn Beneath the Waves)
    cave:  { title:'Where Light Forgets', artist:'TOMOB', note:'빛이 잊은 곳' },   // 동굴
    home:  { title:'Embers',              artist:'TOMOB', note:'남은 불씨' },      // 집/안식처
    battle:{ title:'Ashen Blades',        artist:'TOMOB', note:'잿빛 칼날' },      // 전투
    dungeon:{ title:'The Deep Below',     artist:'TOMOB', note:'광산 깊은 곳' },   // ★던전(광산 던전 BGM)
    intro: null,   // 타이틀 화면은 now-playing 미표시
    // dnd1/dnd2 = 앰비언트 기본곡 → BGM_META 미등록(now-playing 위젯 안 뜸, 순환마다 시네마틱 스팸 방지)
  };
  const bgmTracks={};   // name → Audio(loop). 지연 생성.
  // ★노래(BGM)=1회 재생(사령관: 무한반복 금지). loop=false면 끝나도 _bgmCur이 그대로라 bgmSet 동일-이름 early-return으로 재생 안 됨 → 상황(집→동굴 등)이 바뀌어야 새 곡. 같은 곳 재진입 시엔 다시 1회 재생.
  const bgmAudio=(name)=>{ let a=bgmTracks[name]; if(!a){ a=mk(BGM_SRC[name], false, 0); bgmTracks[name]=a; } return a; };
  let _bgmCur=null, _bgmForce=null, _bgmAuto=true, _homeFlag=false, _stormFlag=false;
  let _sailT=0, _sailArmed=false, _sailPick=null;   // 항해 BGM=1분 이상 지속 후 랜덤 발동(풀에서 1곡). 배 내리거나 멈추면 리셋.
  const _cineCd={};                 // 트랙별 마지막 시네마틱 시각(ms). 재진입 반복 억제용.
  const CINE_COOLDOWN=10*60*1000;   // ★같은 곡 시네마틱은 10분에 1번만(사령관): 집/항구 재진입마다 시네마틱 뜨던 것 제거. 음악은 계속 재생되되 연출만 억제.
  function bgmSet(name){ if(_bgmCur===name) return; _bgmCur=name;
    if(name){ const a=bgmAudio(name); if(a.paused) a.play().catch(()=>{});
      const m=BGM_META[name];
      // ★트랙 전환 = 시네마틱(곡명 위젯 nowPlaying + 레터박스 + 카메라 살짝 pull-back).
      //   ①같은 곡은 10분에 1번만(재진입 반복 방지) ②그 안에서도 60% 확률(사령관). 억제 시엔 조용히 곡만 페이드 교체.
      const now=performance.now(), last=_cineCd[name];
      const cdOk = (last===undefined) || (now-last >= CINE_COOLDOWN);
      if(m && m.title && cdOk && Math.random() < 0.6){ const CINE=7000;
        _cineCd[name]=now;
        try{ nowPlaying({ ...m, ms:CINE }); }catch(_){}
        try{ ctx.player?.cinematic?.(CINE); }catch(_){}
      }
    }
  }
  // ctx.sound.bgm API (기존 bgm 참조 호환 위해 객체 유지)
  // ★2026-07-22(사령관 "기본 던전BGM 나오다가 중간쯤 시네마틱으로 노래가 나오든가") — 시네마틱 1회 재생 후 기본 앰비언트 자동 복귀.
  //   ⚠️ set()만으로는 안 된다: 노래는 loop=false인데 곡이 끝나도 _bgmForce/_bgmCur이 그대로 남아
  //      bgmSet 동일-이름 early-return에 걸려 **그 뒤로 영영 무음**이 된다(던전 입장 후 노래가 한 번 나오고 끊기던 원인).
  //   once()는 ended에서 force를 풀어 want 계산이 다시 돌게 하고, 앰비언트(dnd1/dnd2) 순환으로 되돌아간다.
  const _onceBound={};
  function bgmOnce(name){
    if(!BGM_SRC[name]) return;
    const a=bgmAudio(name);
    if(!_onceBound[name]){ _onceBound[name]=true;
      a.addEventListener('ended', ()=>{ if(_bgmForce===name) _bgmForce=null; }); }
    try{ a.currentTime=0; }catch(_){}
    _bgmForce=name;
  }
  const bgm={ set:(n)=>{ _bgmForce=n; }, once:bgmOnce, auto:(on)=>{ _bgmAuto=on!==false; }, home:(on)=>{ _homeFlag=!!on; }, storm:(on)=>{ _stormFlag=!!on; }, play:(n)=>bgmSet(n), _tracks:bgmTracks };
  // ★앰비언트 1곡 종료 → 무음 쿨타임 진입 + 다음 곡 예약(다음엔 쿨타임 경과 후 재생).
  AMBIENT.forEach(nm=>{ const a=bgmAudio(nm); a.addEventListener('ended', ()=>{
    if(_bgmCur===nm){ _ambState='cooldown'; _ambT = AMB_COOL.min + Math.random()*(AMB_COOL.max-AMB_COOL.min);
      _ambIdx=(_ambIdx+1)%AMBIENT.length; try{ a.currentTime=0; }catch(_){} } }); });
  const ocean = mk('/tomob-deploy/suimo_ocean.wav', true, 0.28);  // 바다 ambient(파도) — loop
  const boat  = mk('/tomob-deploy/sfx/boat.mp3', true, 0);        // 배 항해 소리 — 속도 비례
  const swim  = mk('/tomob-deploy/sfx/swim.mp3', true, 0);        // 수영 중 — loop
  // ── 지속(loop) 상태음 — volume 0/양수로 페이드 인·아웃. 트리거는 각 모듈이 API로 켬. (사령관 신규 mp3) ──
  const heart   = mk('/tomob-deploy/sfx_heartbeat.mp3', true, 0);  // 위험존(추위/더위) 체력 드레인 중 심장박동
  const dive    = mk('/tomob-deploy/sfx_diving.mp3', true, 0);     // 머리까지 잠긴 수중
  const iceWind = mk('/tomob-deploy/sfx_icewind.mp3', true, 0);    // 얼음섬 지역 ambient
  const LOOPS=[heart,dive,iceWind];

  let started=false, sailSecs=0;
  // ★ocean이 실제로 재생된 뒤에만 started=true — 첫 play()가 autoplay/타이밍으로 거부돼도 다음 제스처에 재시도(예전엔 즉시 잠가서 바다소리가 영영 안 나던 버그, 사령관)
  function start(){
    if(started) return;
    ocean.play().then(()=>{ started=true; boat.play().catch(()=>{}); swim.play().catch(()=>{}); LOOPS.forEach(a=>a.play().catch(()=>{})); }).catch(()=>{});
  }
  // ★첫 제스처 캡처 — 캡처단계 + 여러 이벤트(클릭/키/포인터/터치) → 다른 핸들러의 stopPropagation·오버레이에 막혀도 ocean 시작 보장
  ['pointerdown','mousedown','click','keydown','touchstart'].forEach(ev=> addEventListener(ev, start, { capture:true }));

  // 일회성 효과음 풀 (kenney ogg: footstep / 루트 wav·mp3: splash 등)
  const pools={};
  const SAME_THROTTLE=55;   // 같은 음원을 이 간격(ms) 안에 다시 부르면 1회로 합침(겹침/위상충돌 방지 — 일제사격 5문 → 한 방)
  function play1(src, vol, rate){ let p=pools[src]; if(!p){ p={arr:[],i:0,last:-1e9}; for(let k=0;k<4;k++){ const a=new Audio(encodeURI(src)); a.preload='auto'; p.arr.push(a); } pools[src]=p; }
    const now=performance.now(); if(now - p.last < SAME_THROTTLE) return; p.last=now;
    const a=p.arr[p.i]; p.i=(p.i+1)%p.arr.length; try{ a.volume=Math.max(0,Math.min(1,vol)); a.playbackRate=rate||1; a.currentTime=0; a.play().catch(()=>{}); }catch(e){} }   // rate<1 = 피치 다운(둔탁)
  const sfxOne=(name,vol=0.5)=>play1(RPG+name+'.ogg', vol);   // 발소리 등 kenney
  const sfxPath=(path,vol=0.5)=>play1(path, vol);             // splash 등 루트
  // ★버그 수정(2026-07-14): storm.mp3(60s 폭풍 앰비언트)를 opening.js stormDecay가 "1회 효과음"으로 sfxPath 재생(배 부서짐 굉음) →
  //   재생은 끝까지 60초 이어지는데 그 사이 오프닝(표류→깨어남)이 먼저 끝나버려 상륙 후에도 비/폭풍 소리가 계속 남는 문제.
  //   play1은 fire-and-forget이라 되돌릴 참조가 없으므로, 풀(pools[path]) 전체를 pause+currentTime 리셋하는 명시적 정지 API를 추가.
  function stopPath(path){ const p=pools[path]; if(!p) return; p.arr.forEach(a=>{ try{ a.pause(); a.currentTime=0; }catch(_){} }); }

  // ── 게임 이벤트 사운드 테이블 (사령관 선별 WAV) — play(event)로 호출 ──
  const W='/tomob-deploy/WAV Files/';
  const SFX_DIR={  // 이벤트 → {files:[상대경로…], vol}. 변형 여럿이면 랜덤 1개.
    // 마법(스펠)
    spell_fire:      { files:['SFX/Spells/Fireball 1.wav','SFX/Spells/Fireball 3.wav'], vol:0.55 },
    spell_ice:       { files:['SFX/Spells/Ice Throw 1.wav'], vol:0.55 },
    spell_firespray: { files:['SFX/Spells/Firespray 1.wav','SFX/Spells/Firespray 2.wav'], vol:0.5 },
    spell_icebarrage:{ files:['SFX/Spells/Ice Barrage 1.wav'], vol:0.5 },
    spell_firebuff:  { files:['SFX/Spells/Firebuff 1.wav'], vol:0.6 },
    spell_icefreeze: { files:['SFX/Spells/Ice Freeze 1.wav'], vol:0.55 },
    spell_icewall:   { files:['SFX/Spells/Ice Wall 1.wav'], vol:0.6 },
    spell_rockwall:  { files:['SFX/Spells/Rock Wall 1.wav','SFX/Spells/Rock Wall 2.wav'], vol:0.6 },
    spell_meteor:    { files:['SFX/Spells/Rock Meteor Swarm 2.wav'], vol:0.65 },
    spell_crit:      { files:['SFX/Spells/Spell Impact 1.wav'], vol:0.6 },   // ★크리티컬 명중음(사령관)
    // 전투(활/검) — 4단계에서 연결
    bow_attack:  { files:['SFX/Attacks/Bow Attacks Hits and Blocks/Bow Attack 1.wav','SFX/Attacks/Bow Attacks Hits and Blocks/Bow Attack 2.wav'], vol:0.5 },
    bow_hit:     { files:['SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 2.wav','SFX/Attacks/Bow Attacks Hits and Blocks/Bow Impact Hit 3.wav'], vol:0.5 },
    sword_attack:{ files:['SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 1.wav','SFX/Attacks/Sword Attacks Hits and Blocks/Sword Attack 2.wav'], vol:0.5 },
    sword_hit:   { files:['SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 1.wav','SFX/Attacks/Sword Attacks Hits and Blocks/Sword Impact Hit 2.wav'], vol:0.55, rate:0.82 },   // ★B(2026-07-02): 피치 다운 = 저역 무게("퍽"). sword_block(rate:0.72) 선례. vol 0.5→0.55(저역 보강). 크리는 crit_hit 별도라 차등 보존.
    sword_block: { files:['SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 1.wav','SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 2.wav','SFX/Attacks/Sword Attacks Hits and Blocks/Sword Blocked 3.wav'], vol:0.7, rate:0.72 },   // ★3종 랜덤 + 피치 다운 = 둔탁한 방패 막기감
    chest_open:  { files:['SFX/Doors Gates and Chests/Chest Open 1.wav'], vol:0.6 },
    chest_close: { files:['SFX/Doors Gates and Chests/Chest Close 1.wav'], vol:0.6 },
    door_open:   { files:['SFX/Doors Gates and Chests/Door Open 1.wav'], vol:0.6 },
    door_close:  { files:['SFX/Doors Gates and Chests/Door Close 1.wav'], vol:0.6 },
    coin:        { files:['/tomob-deploy/kenney_rpg-audio/Audio/handleCoins.ogg','/tomob-deploy/kenney_rpg-audio/Audio/handleCoins2.ogg'], vol:0.5 },   // 아이템/재화 획득(무음이던 것 — 커버리지 채움)
    // ── 대포·선박·구조물 (구 하드코딩 경로 흡수 — 볼륨은 호출부 opts.vol로 조정) ──
    cannon_fire: { files:['/tomob-deploy/canon.mp3'], vol:0.55 },              // 대포 발사
    ship_crash:  { files:['/tomob-deploy/crash.mp3'], vol:0.5 },               // 선체 피격/격침
    big_splash:  { files:['/tomob-deploy/suimo_bigsplash.wav'], vol:0.7 },     // 대형 물기둥(격침)
    destroy:     { files:['/tomob-deploy/w2.mp3'], vol:0.6 },           // 구조물 파괴
    fortTower:   { files:['/tomob-deploy/타워부서짐.mp3'], vol:0.7 },   // 🏰 요새 방어탑 파괴(사령관 신규)
    fortCastle:  { files:['/tomob-deploy/성부서짐.mp3'], vol:0.8 },     // 🏰 요새 본성 파괴(사령관 신규)
    build_place: { files:['SFX/Footsteps/Wood/Wood Land.wav'], vol:0.6 },   // 구조물 배치(나무 쿵)
    // ── 사령관 신규 mp3 (voyage 루트 절대경로 — '/'로 시작하면 W 접두 안 붙음) ──
    crit_hit:    { files:['/tomob-deploy/sfx_crit.mp3'], vol:0.7 },              // 크리티컬(근접·화살·마법 공통 통로 damageMonster)
    melee_miss:  { files:['/tomob-deploy/sfx_miss.mp3'], vol:0.4 },              // 근접 헛스윙(명중 0)
    punch:       { files:['/tomob-deploy/펀치.mp3'], vol:0.55 },                 // 🥊 맨손 공격(사령관 — 칼 소리 대신 펀치)
    rogue_attack:{ files:['/tomob-deploy/sfx_rogue_attack.mp3'], vol:0.5 },      // 도적(단검) 좌클릭 공격
    stealth_on:  { files:['/tomob-deploy/sfx_stealth_on.mp3'], vol:0.55 },       // 로그 은신 진입(투명)
    stealth_off: { files:['/tomob-deploy/sfx_stealth_off.mp3'], vol:0.55 },      // 로그 은신 해제(투명 풀림)
    ranger_aim:  { files:['/tomob-deploy/sfx_ranger_aim.mp3'], vol:0.55 },       // 레인저 특수키(활 조준 진입)
    shockwave:   { files:['/tomob-deploy/충격파.mp3'], vol:0.8 },                // 기사 궁극기(방패 충격파) 발동 음성 — 사령관 지정
    // 구르기/공격 기합 — 원본에서 앞 5개 그런트 컷(매 재생 랜덤). 구르기=매번 · 공격=1/3(호출부 확률).
    dodge_roll:  { files:['/tomob-deploy/sfx_dodge_f1.mp3','/tomob-deploy/sfx_dodge_f2.mp3','/tomob-deploy/sfx_dodge_f3.mp3','/tomob-deploy/sfx_dodge_f4.mp3','/tomob-deploy/sfx_dodge_f5.mp3'], vol:0.5 },   // 여캐(도적)
    dodge_roll_m:{ files:['/tomob-deploy/sfx_dodge_m1.mp3','/tomob-deploy/sfx_dodge_m2.mp3','/tomob-deploy/sfx_dodge_m3.mp3','/tomob-deploy/sfx_dodge_m4.mp3','/tomob-deploy/sfx_dodge_m5.mp3'], vol:0.5 },   // 남캐(기사·전사·마법사·레인저)
    levelup:     { files:['/tomob-deploy/sfx_levelup.mp3'], vol:0.6 },           // 레벨업
    buff:        { files:['/tomob-deploy/sfx_buff.mp3'], vol:0.55 },             // 버프 스킬 발동
    success:     { files:['/tomob-deploy/sfx_success.mp3'], vol:0.55 },          // 거래·대장간 성공(공용)
    ui_click:    { files:['/tomob-deploy/button.mp3'], vol:0.4 },                // UI 버튼 클릭
    craft_done:  { files:['/tomob-deploy/제작완료.mp3'], vol:0.6 },              // ★제작 완료 전용(사령관 신규)
    reward:      { files:['/tomob-deploy/보상획득.mp3'], vol:0.6 },              // ★보상·금화 획득(사령관 신규)
    item_in:     { files:['/tomob-deploy/아이템들어오는소리.mp3'], vol:0.5 },     // ★아이템 흡수(채광·벌목 조각/영혼 개당 1소리, 사령관 신규)
    anchor:      { files:['/tomob-deploy/닻내릴떄.mp3'], vol:0.6 },               // ★닻 내림(T, ship.js, 사령관 신규)
    boom:        { files:['/tomob-deploy/boom.mp3'], vol:0.6 },                  // 폭발
    fall:        { files:['/tomob-deploy/fall.mp3'], vol:0.5 },                  // 낙하/추락 피해
    drown:       { files:['/tomob-deploy/sfx_drown.mp3'], vol:0.5 },             // 물에 빠짐
    mon_ghost:   { files:['/tomob-deploy/sfx_ghost.mp3'], vol:0.5 },             // 유령 몹
    // ── 기존 몬스터 사운드 (mas/sfx/mon/ — 통합 흡수, 변형 여럿=랜덤) ──
    mon_death:   { files:['/tomob-deploy/sfx/mon/death1.wav','/tomob-deploy/sfx/mon/death2.wav'], vol:0.5 },   // 사망
    mon_growl:   { files:['/tomob-deploy/sfx/mon/growl1.wav','/tomob-deploy/sfx/mon/growl2.wav'], vol:0.5 },   // 추격 개시
    mon_atk:     { files:['/tomob-deploy/sfx/mon/atk1.wav','/tomob-deploy/sfx/mon/atk2.wav'], vol:0.6 },       // 공격 명중
    mon_grunt:   { files:['/tomob-deploy/sfx/mon/grunt1.wav'], vol:0.5 },   // 미사용 자산 — 둔중한 몹(골렘/거북) 배정 후보
    mon_hiss:    { files:['/tomob-deploy/sfx/mon/hiss1.wav'], vol:0.5 },    // 미사용 자산 — 뱀파이어/슬라임 후보
    mon_moan:    { files:['/tomob-deploy/sfx/mon/moan1.wav'], vol:0.5 },    // 미사용 자산 — 좀비 후보
    // ── 드래곤 보스 (DRG_SFX 흡수 — 거리감쇠는 호출부 drgVol이 opts.vol로 전달) ──
    drg_breath:  { files:['/tomob-deploy/dragon_breath.mp3'], vol:0.95 },   // 브레스
    drg_roar:    { files:['/tomob-deploy/dragon_roar.mp3'], vol:0.7 },   // 헤비/착지 포효
    drg_epicroar:{ files:['/tomob-deploy/dragon_epicroar.mp3'], vol:1.0 },   // 진입/페이즈2
    drg_growl:   { files:['/tomob-deploy/dragon_growl.mp3'], vol:0.6 },   // 근접 예비동작
    drg_claw:    { files:['/tomob-deploy/dragon_claw.mp3'], vol:0.7 },   // 발톱 명중
    drg_wings:   { files:['/tomob-deploy/dragon_wings.mp3'], vol:0.85 },   // 상승/비행
    drg_hurt:    { files:['/tomob-deploy/dragon_hurt.mp3'], vol:0.75 },   // 피격
    drg_roar2:   { files:['/tomob-deploy/dragon_roar2.mp3'], vol:0.7 },   // ⏸백로그 — roar 변형(현재 미사용, 등록만)
    drg_wings2:  { files:['/tomob-deploy/dragon_wings2.mp3'], vol:0.85 },   // ⏸백로그 — 날갯짓 변형(현재 미사용, 등록만)
    // ⏸ 보류 — 게임(monsters.js) 미편입 몹. 편입 시 트리거 연결.
    mon_creep:   { files:['/tomob-deploy/sfx_creep.mp3'], vol:0.5 },             // 크립(monter/out/mon1) — 미편입
    mon_woman:   { files:['/tomob-deploy/sfx_woman_mob.mp3'], vol:0.5 },         // 여성형 몹 — 미편입
  };
  // 이벤트 사운드 1회 재생. opts.vol로 볼륨 덮어쓰기. files 경로가 '/'로 시작하면 절대(신규 mp3), 아니면 W(WAV Files) 접두.
  function play(event, opts={}){ const e=SFX_DIR[event]; if(!e) return; const rel=e.files[(Math.random()*e.files.length)|0]; const src=rel[0]==='/'?rel:W+rel; play1(src, opts.vol ?? e.vol ?? 0.5, opts.rate ?? e.rate); }

  // ── 지속 상태음 API — 각 모듈이 on/off. (온도: heartbeat / 수중: diving / 지역: iceWind) ──
  const setLoop=(a,on,vol)=>{ a.volume = on ? vol : 0; };
  const loops={
    heartbeat:(on)=>setLoop(heart, on, 0.6),   // temperature.js 위험존 데미지 중
    diving:   (on)=>setLoop(dive, on, 0.5),     // sound.js onUpdate 수중 판정(아래)
    iceWind:  (on,vol=0.4)=>setLoop(iceWind, on, vol),   // 지역 진입 시 environment/장소 모듈
  };

  ctx.sound={ sfxOne, sfxPath, stopPath, play, ...loops, _sfxTable:SFX_DIR, bgm, ocean, boat };
  setUiSound((ev)=>play(ev));   // uikit 패널 열기/닫기음 배선
  // ★모든 UI 클릭음(button.mp3) — 사령관 "버튼이나 그런거 소리없는거 다". <button>뿐 아니라 클릭형 UI 전부(탭·슬롯·링크·data-클릭·role=button + pointer 커서 요소). 게임 캔버스(월드 클릭)만 제외.
  addEventListener('mousedown', e=>{ const t=e.target; if(!t || !t.closest) return;
    if(t.closest('canvas')) return;   // 게임 월드/조준 클릭 제외(공격·건조 등)
    let ui = !!t.closest('button, a, [role="button"], [data-call], [data-board], [data-tab], [data-slot], [data-recipe], [data-ship], [data-act]');
    if(!ui){ try{ ui = getComputedStyle(t).cursor==='pointer'; }catch(_){} }   // 그 외엔 pointer 커서 = 클릭형 UI로 간주
    if(ui) play('ui_click'); }, true);

  const FOOT=1.15; let stepT=0, wasInWater=false;
  // ── 지면별 발걸음 (물→Water·갑판→Wood·동굴→Stone·지상→Dirt) + 걷기/달리기, 변형 1~5 랜덤 ──
  const FS='/tomob-deploy/WAV Files/SFX/Footsteps/';
  function surfaceOf(pl, onShip){
    if(onShip) return 'Wood';
    if(ctx.cave && ctx.cave.inside && ctx.cave.inside()) return 'Stone';   // 동굴(모듈 있을 때만)
    const WL=(ctx.water?ctx.water.level:0);
    if((pl.pos.y-FOOT) < WL+0.4) return 'Water';                           // 발이 수면 바로 위(얕은 물가)
    return 'Dirt';
  }
  function footstep(surf, running){
    const kind = running ? 'Run' : 'Walk';
    const n = 1 + (Math.random()*5|0);   // 1~5
    sfxPath(`${FS}${surf}/${surf} ${kind} ${n}.wav`, 0.32);
  }
  ctx.onUpdate(dt=>{ const pl=ctx.player; if(!pl) return; const pp=pl.pos;
    // 지면/물 상태 먼저 판정(발걸음·splash 공용)
    const onShip = ctx.ship && (ctx.ship.boarded || pl.onShip===ctx.ship);
    const WL=(ctx.water?ctx.water.level:0); const inW=(pp.y-FOOT)<WL && !onShip;
    // 발소리 — 지면별 + 걷기/달리기 (비행·수영 중 제외)
    const moving = pl.keysSet.has('KeyW')||pl.keysSet.has('KeyS')||pl.keysSet.has('KeyA')||pl.keysSet.has('KeyD');
    if(moving && pl.onGround && !pl.flying && !inW){ stepT-=dt; if(stepT<=0){ stepT=pl.running?0.30:0.46; footstep(surfaceOf(pl, onShip), pl.running); } } else stepT=0;
    // 배 소리: 항해 중 속도 비례. ★버그 수정(사령관 2026-07-15): opening이 표류/기상 컷신서 boat를 muted+pause하는데
    //   이후 복구가 없어 항해해도 소리가 안 났음 → 소리가 필요할 때(속도>0.4) muted 해제 + 재생 복구(self-healing).
    const spd = onShip ? Math.abs(ctx.ship.speed||0) : 0;
    const _bv = spd>0.4 ? Math.min(0.55, spd*0.08) : 0;
    boat.volume = _bv;
    if(_bv>0 && started){ if(boat.muted) boat.muted=false; if(boat.paused) boat.play().catch(()=>{}); }
    // 수영/물 splash (물 진입) — ★ctx.sound.noWater면 완전 차단(튜토리얼: 배 부서져 물 빠질 때 수영음 계속 이어지던 것 제거, 사령관)
    const _noWater = ctx.sound && ctx.sound.noWater;
    swim.volume = (inW && !pl.onGround && !_noWater) ? 0.3 : 0;   // ★실제 수영(물속+땅 안 밟음)일 때만. 얕은 물에 '서 있으면'(onGround) 수영음 안 남(사령관).
    if(inW && !wasInWater && !_noWater){ sfxPath('/suimo_splash'+(1+(Math.random()*3|0))+'.wav', 0.5); play('drown',{vol:0.4}); }   // 입수 splash + 물에빠짐(사령관)
    wasInWater=inW;
    // 잠수(머리까지 수중) — pl.pos.y가 수면 아래로 완전히 잠기면 diving loop ON
    ctx.sound.diving(!_noWater && !onShip && !pl.onGround && pp.y < WL - 0.3);   // ★땅 밟으면 잠수음도 끔(사령관)
    // 얼음섬 바람 ambient — 얼음 바이옴(environment.tier==='ice') + 배 아닐 때
    // ★2026-07-16(사령관 "배경소리 너무 많다"): 던전(바다 위 +240m) 중엔 오버월드 앰비언트(파도·얼음바람) 차단 → 지하 폐쇄 무드.
    const _inDungeon = !!(ctx.dungeon && ctx.dungeon.active);
    ocean.volume = _inDungeon ? 0 : 0.28;
    ctx.sound.iceWind(ctx.environment?.tier==='ice' && !onShip && !_inDungeon);
    // ── BGM 상황 판정 + 크로스페이드 (started 이후. 우선순위 battle>cave>home>항해풀) ──
    if(started){
      let want=_bgmForce;
      if(want===null && _bgmAuto){
        const inCave = !!(ctx.cave && ctx.cave.inside && ctx.cave.inside());
        const sailing = onShip && spd>0.4;   // arm 타이머 누적 조건 — 실제로 나아갈 때만(긴 항해의 보상)
        // 🎵 항해 BGM = 1분 이상 실제 항해 후 랜덤 발동(늘 깔리지 않고 긴 항해의 보상처럼) + SAIL_POOL에서 랜덤 1곡.
        //    60초 넘으면 매 프레임 낮은 확률 롤(dt*0.15 → 1분 지난 뒤 평균 ~7초 안에 arm).
        if(sailing){ _sailT += dt; if(_sailT>=60 && !_sailArmed && Math.random()<dt*0.15){ _sailArmed=true; _sailPick=SAIL_POOL[Math.floor(Math.random()*SAIL_POOL.length)]; } }
        // ★버그#15 수정(사령관): 한 번 곡이 arm 되면 배에 타고 있는 한 계속 재생.
        //   예전엔 배가 멈추거나(속도<0.4)·표류·방향전환으로 sailing=false 되는 즉시 리셋 → 노래가 끊겼음.
        //   이제 리셋은 '배에서 내렸을 때(!onShip)'만. 멈춰도·표류해도·그 구역 벗어나도 항해곡 유지.
        //   (battle/cave/home 등 우선순위 상황은 아래 want 계산과 _bgmForce가 그대로 처리 → 전투 시 battle 정상.)
        if(!onShip){ _sailT=0; _sailArmed=false; _sailPick=null; }
        const sailBgm = onShip && _sailArmed ? _sailPick : null;
        const atHome = _homeFlag || !!(ctx.build && ctx.build.inHouse && ctx.build.inHouse(pp));   // ★집=내가 토대로 지어 지붕에 둘러싸인 실내(build.inHouse). 항구/점령지는 집 아님(사령관).
        // ★storm(폭풍)은 여기서 트리거 안 함 — 빗소리 ambient는 wind.js가 /sfx/storm.mp3 루프로 처리(시네마틱 아님).
        // ★battle BGM은 해상전투(navalcombat.js)가 bgm.set('battle') force로 최우선 트리거. 필드전투(몹 어그로)는 아직 미구현(사령관).
        want = inCave ? 'cave' : atHome ? 'home' : sailBgm || null;
        // ★dnd1/dnd2 = 던전 전용 기본 앰비언트(사령관 2026-07-23 "바다서 던전음악 들림" → dnd는 던전에서만).
        //   바다·육지 평상시엔 기본 앰비언트 무음(파도 ambient·상황곡만). 던전(ctx.dungeon.active)에서만 dnd 순환.
        if(want===null && _inDungeon){
          if(_ambState==='cooldown'){ _ambT -= dt; if(_ambT<=0) _ambState='playing'; /* want=null 유지=무음 */ }
          else want = AMBIENT[_ambIdx];
        }
      }
      bgmSet(want);
      for(const nm in bgmTracks){ const a=bgmTracks[nm]; const tgt=(nm===_bgmCur)?(BGM_VOL[nm]||0.3):0;
        if(a.volume<tgt) a.volume=Math.min(tgt, a.volume+dt*0.4);           // 페이드 인
        else if(a.volume>tgt){ a.volume=Math.max(tgt, a.volume-dt*0.3);     // 페이드 아웃
          if(a.volume<=0.005 && nm!==_bgmCur && !a.paused) a.pause(); }
        if(nm===_bgmCur && a.paused) a.play().catch(()=>{}); }
    }
  });
  return ctx.sound;
}
