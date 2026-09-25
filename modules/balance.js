// balance.js — ⚖️ 전 게임 밸런스 단일 소스(SSOT). 사령관 튜닝 지점은 오직 여기.
//   설계(2026-07-01, 사령관 자율위임): 그동안 수치가 60개 모듈에 산발 → 한 곳으로 통합.
//   원칙: asset URL·애니 배열·VFX 지오메트리는 각 모듈에 남기고, "밸런스 숫자"만 이 파일이 소유.
//   각 모듈은 `import { BAL } from '/tomob-deploy/modules/balance.js'`로 읽는다. 런타임 노출: ctx.balance = BAL.
// ══════════════════════════════════════════════════════════════
//  1. 플레이어 코어 (combat.js)
// ══════════════════════════════════════════════════════════════
const player = {
  atkReach: 3.8,      // 근접 사거리(m)
  atkDot:   0.3,      // 정면 부채꼴 판정(±72°)
  atkCd:    0.45,     // 근접 공격 쿨다운(s)
  regen:    3,        // 초당 HP 재생
  regenDelay: 5,      // 피격 후 재생 시작까지(s)
  respawn:  2.5,      // 사망 후 부활(s)
  stamMax:  100,
  stamRegen: 26,      // 초당 스태미나 회복
  stamDelay: 0.55,    // 공격/스프린트 후 회복 지연(s)
  sprintCost: 22,     // 스프린트 초당 스태미나 소모
  dodgeCost: 16,      // 회피롤 스태미나 소모
  critChance: 0.18,   // 근접/화살 기본 크리 확률
  critMul:    1.8,    // 크리 배수
  guardMax:   100,    // 기사 방패 게이지
  guardReduce: 0.2,   // 가드 시 받는 피해 배수(0.2 = 80%감소)
};

// ══════════════════════════════════════════════════════════════
//  2. 레벨 성장곡선 ★신설 — 레벨업이 실제 성장을 준다 (combat.js가 소비)
//     클래스 = ?char= (knight/barbarian/mage/ranger/rogue). 미지정=default.
// ══════════════════════════════════════════════════════════════
const level = {
  cap: 30,
  // 클래스별 기본 HP + 레벨당 HP 증가 (탱커>근접>원거리>암살>마법)
  hpBase:   { knight:130, barbarian:115, ranger:100, rogue:92, mage:85, default:100 },
  hpPerLvl: { knight:14,  barbarian:12,  ranger:9,   rogue:8,  mage:7,  default:10 },
  // 클래스 공격 친화(무기/스펠 기본 데미지에 곱). 전사=묵직, 도적=빠르지만 약함.
  atkAff:   { knight:1.0, barbarian:1.12, ranger:1.06, rogue:0.96, mage:1.0, default:1.0 },
  atkPerLvl: 0.06,        // 레벨당 공격 +6% (L30 ≈ ×2.74)
  stamPerLvl: 0,          // 스태미나 성장(현재 0, 예약)
  xpBase: 100, xpGrow: 1.26,   // xpForNext(l) = round(xpBase * xpGrow^(l-1)) ★1.32→1.26(2026-07-02): 티어경계 그라인드 벽 제거(L13/14/18/19 42~67킬→24~30킬). cap30 유지(L20~30=미래콘텐츠 여지)

  _cls(c){ c = (c||'').toLowerCase(); if(c==='rogue_hooded') c='rogue';
    return (this.hpBase[c] !== undefined) ? c : 'default'; },
  _lv(l){ return Math.max(1, Math.min(this.cap, l|0)); },
  hpAt(cls, l){ cls=this._cls(cls); l=this._lv(l); return Math.round(this.hpBase[cls] + this.hpPerLvl[cls]*(l-1)); },
  atkMul(cls, l){ cls=this._cls(cls); l=this._lv(l); return (this.atkAff[cls]||1) * (1 + this.atkPerLvl*(l-1)); },
  xpForNext(l){ return Math.round(this.xpBase * Math.pow(this.xpGrow, this._lv(l)-1)); },
  // 권장 레벨(플레이어)에 대해 상대 가능한 몬스터 최대 티어 — 스폰 게이팅/안내용
  tierForLevel(l){ l=this._lv(l); return l<4?1 : l<9?2 : l<15?3 : l<20?4 : 5; },
};

// ══════════════════════════════════════════════════════════════
//  3. 무기 (player.js WEAP — 근접) / 원거리 (combat.js ARROW)
//     ※ 레벨/클래스 스케일은 combat.damageMonster에서 atkMul 곱해 일괄 적용.
// ══════════════════════════════════════════════════════════════
const weapons = {
  '1h':       { dmg:9,  stam:14, speed:1.3, hit:0.55 },   // 한손검(기사) = 균형
  '1hf':      { dmg:5,  stam:9,  speed:1.7, hit:0.50 },   // 단검 = 빠르고 약함
  '2h':       { dmg:16, stam:22, speed:1.0, hit:0.62 },   // 양손(전사) = 느리고 묵직
  'unarmed':  { dmg:4,  stam:8,  speed:1.4, hit:0.50 },   // 맨손
  'dualwield':{ dmg:9,  stam:10, speed:1.5, hit:0.55 },   // 쌍수(로그) = 빠른 연타 ★6→7(2026-07-02)→9(2026-07-15 감사): 로그 3중 최약(HP92·aff0.96·무기딜) → T3+서 "처치>2체사망" 역전. raw DPS 10.1→13.0으로 역전 해소(여전히 근접 하위지만 성립).
};
const ranged = {
  bow:      { speed:46, dmg:18, range:65 },
  crossbow: { speed:64, dmg:30, range:75 },
  arrowHit: 1.15,     // 명중 반경(m)
  arrowGrav: 0.45,    // 포물선 중력계수
};
// 근접 특수기(combat.js) — 무기 특수/스킬 고정 데미지(atkMul 적용됨)
const skills = {
  spinHit: 11, spinHits: 7, spinCd: 4000,        // 양손 스핀
  shieldSlam: 48, shieldSlamRadius: 5.8, shieldSlamStun: 1600,   // 기사 궁
  kick: 8, kickStun: 2000, headbutt: 10,
};

// ══════════════════════════════════════════════════════════════
//  4. 마법 (magic.js) — 스펠별 밸런스 숫자. magic.js가 override 병합.
//     el/kind/sound/name 등 비수치 필드는 magic.js 유지.
// ══════════════════════════════════════════════════════════════
const magic = {
  slowFactor: 0.25,   // 둔화 배수(0.25 = 75%감속)
  burnTick: 1.0,      // 화상 DoT 틱 간격(s)
  skills: {
    basic_fire:  { dmg:5,  speed:38, range:55, cd:230 },   // ★4→5(2026-07-02): basic_ice(5+슬로우)에 완전열위였음 → 딜 동일(불=순수딜/얼음=슬로우)
    basic_ice:   { dmg:5,  speed:40, range:55, cd:230 },
    fireball:    { dmg:10, speed:24, range:70, cd:5000, dot:4, dotDur:4 },
    icebolt:     { dmg:11, speed:28, range:75, cd:5000, slow:2.0 },
    firespray:   { dmg:9,  reach:9,  arc:0.55, cd:240 },   // ★cd160→240(2026-07-02): 56DPS/타겟(무자원 콘AoE) 아웃라이어 → 37.5DPS로 하향. 여전히 AoE 강함, 플레임스로워 정체성 유지
    icebarrage:  { dmg:12, speed:50, range:70, shots:3, spread:0.10, cd:780 },
    firebuff:    { mult:1.6, dur:8, cd:9000 },
    icefreeze:   { dmg:10, speed:26, range:60, slow:3.0, cd:2600 },
    icewall:     { dur:7,  cd:4000 },
    rockwall:    { dur:10, cd:4000 },
    meteor:      { dmg:40, radius:5, cd:5200 },
  },
};

// ══════════════════════════════════════════════════════════════
//  5. 몬스터 (monsters.js) — 스탯 + 티어/권장레벨. ★상향 재조정(2026-07-01)
//     성장한 플레이어(레벨 HP·공격↑)와 정합되도록 HP/공격 재설계.
//     scale(키)·url·type·ko = monsters.js 유지. 여기선 밸런스 숫자만.
//     lvl = 권장 플레이어 레벨 · tier = 난이도군(1약~5보스).
// ══════════════════════════════════════════════════════════════
const monsters = {
  spawn: { max:6, min:18, max_dist:46, despawn:90 },
  stats: {
    // ── Tier 1 (권장 Lv1~3) 잡몹 — 갓 침몰한 망자 ──
    bat:       { hp:20,  speed:3.6, atkCD:1.0, atk:5,  aggro:16, lvl:1,  tier:1 },   // 흡혈 밤짐승(비행)
    ghost:     { hp:22,  speed:3.2, atkCD:0.9, atk:6,  aggro:16, lvl:2,  tier:1 },   // 떠도는 원혼
    mummy:     { hp:28,  speed:1.8, atkCD:1.3, atk:7,  aggro:12, lvl:2,  tier:1 },   // 썩은 미라
    zombie:    { hp:30,  speed:2.0, atkCD:1.3, atk:7,  aggro:14, lvl:2,  tier:1 },   // 다곤의 익사자
    skeleton:  { hp:30,  speed:2.6, atkCD:1.1, atk:8,  aggro:14, lvl:3,  tier:1 },   // 마른 뼈다귀
    // ── Tier 2 (Lv4~8) 표준 ──
    sk_minion: { hp:44,  speed:2.8, atkCD:1.0, atk:11, aggro:14, lvl:4,  tier:2 },   // 해골 졸개
    slime:     { hp:52,  speed:1.9, atkCD:1.2, atk:11, aggro:12, lvl:5,  tier:2 },   // 오염된 슬라임
    nghost:    { hp:60,  speed:3.0, atkCD:1.4, atk:14, aggro:20, lvl:6,  tier:2, ranged:true },  // 통곡하는 망령(원거리 볼트)
    vampire:   { hp:78,  speed:3.2, atkCD:1.0, atk:18, aggro:16, lvl:8,  tier:2 },   // 피주린 뱀파이어
    // ── Tier 3 (Lv9~14) 강 — 아바돈의 정예 ──
    imp:       { hp:110, speed:3.4, atkCD:0.8, atk:22, aggro:18, lvl:9,  tier:3 },   // 붉은 세이림
    boom:      { hp:45,  speed:2.8, atkCD:0.0, atk:55, aggro:20, lvl:10, tier:3, selfdestruct:true },  // 폭렬 감시안(접근→자폭)
    sk_rogue:  { hp:130, speed:3.6, atkCD:0.7, atk:24, aggro:18, lvl:10, tier:3 },   // 아바돈의 무덤 도굴꾼
    sk_mage:   { hp:120, speed:2.4, atkCD:1.3, atk:26, aggro:22, lvl:12, tier:3, ranged:true },  // 아바돈의 강령술사(원거리 스태프)
    sk_warrior:{ hp:160, speed:2.6, atkCD:1.1, atk:28, aggro:14, lvl:13, tier:3 },   // 아바돈의 백골검사
    // ── 부족 습격병 (raiders.js — 살아있는 사람. KayKit 어드벤처러 몸 + 스폰 시 부족 색/문양 주입) ──
    raider_warrior:{ hp:150, speed:2.9, atkCD:1.1, atk:24, aggro:22, lvl:12, tier:3 },  // 부족 전사(근접 주력·약탈, 어그로 큼=거점 쇄도)
    raider_rogue:  { hp:105, speed:3.5, atkCD:0.9, atk:18, aggro:24, lvl:10, tier:2 },   // 부족 약탈꾼(빠른 침투)
    // ── Tier 4 (Lv15~20) 준보스 ──
    creep:     { hp:270, speed:3.2, atkCD:0.9, atk:36, aggro:20, lvl:15, tier:4 },   // 아바돈의 포식귀(4족보행)
    darkskel:  { hp:290, speed:2.7, atkCD:1.0, atk:38, aggro:16, lvl:16, tier:4 },   // 스올의 흑골 파수병
    turtle:    { hp:420, speed:1.4, atkCD:1.5, atk:34, aggro:14, lvl:16, tier:4 },   // 라합의 갑주귀(느린 탱커)
    foe:       { hp:330, speed:2.4, atkCD:1.2, atk:42, aggro:18, lvl:18, tier:4 },   // 외눈 아나킴
    golem:     { hp:380, speed:1.5, atkCD:1.8, atk:44, aggro:18, lvl:19, tier:4 },   // 몰록의 우상(5m)
    // ── Tier 5 보스 (Lv20+) ──
    dragon:    { hp:1400,speed:5.5, atkCD:2.5, atk:60, aggro:60, lvl:20, tier:5 },   // 레비아탄, 첫 별의 짐승 ★hp1000→1400(2026-07-15 감사): 최종보스가 grade4 골렘보스(EHP)보다 약하던 난이도 역전 해소 — 단조 곡선 최정점.
  },
  // 드래곤 공격풀(monsters.js dragonAtks) 튜닝 참고값 — 현재 monsters.js에 하드코딩.
  //   (향후 이관 예정. atkMul 대상 아님 = 몬스터 공격이라 플레이어 레벨 무관)
  dragon: { bite:40, heavy1:40, heavy2:36, tail:44, dive:60, breathTickP1:0.28, breathTickP2:0.40, phaseHp:0.5, phaseCdScale:0.6 },
};

// ══════════════════════════════════════════════════════════════
//  4-B. 타격감(Combat Feel) ★신설 — 스프린트 A "묵직함 3종" SSOT (2026-07-01)
//     히트스톱·경직/넉백/피격플래시·카메라킥 수치의 단일 소스.
//     combat.js/core.js/monsters.js/player.js는 이 값을 "참조만" (하드코딩 금지).
//     근거: _타격감_개선.md §2-①②③, _DOD_타격감A.md §1.
// ══════════════════════════════════════════════════════════════
const feel = {
  // A1 히트스톱(ms) — 명중 순간 전역 timeScale을 떨어뜨렸다 복귀. 처치>크리>평타.
  hitStop: { normal:70, crit:130, kill:180, scale:0.05 },   // scale = 히트스톱 중 timeScale(0=완전정지, 0.05=슬로우)
  // A2 경직/넉백 (피격 임팩트 연출은 hitfx로 분리 — 아래 hitfx 섹션)
  flinch: {
    stunMs:150, critStunMs:180,       // 평타/크리 경직 지속(ms) — 짧게(몹 바보화 방지)
    knockK:0.45,                        // 미세 넉백 거리 계수(m) — shieldSlam 패턴 재사용
    // poise(경직 면역) 대상 — 아무 때나 안 밀림. 사령관 확정(2026-07-01):
    //   tier5(dragon) + dragonboss(type) + tier4 golem(kind). tier4 전체가 아니라 골렘만.
    //   ★shieldSlam(궁극기) 넉백·스턴도 이 목록이면 skip(재작업 2026-07-02, G8 정합).
    poiseTiers:[5], poiseTypes:['dragonboss'], poiseKinds:['golem'],
  },
  // A2 피격 임팩트(hitfx.js) — ★펠월드 레퍼런스 2장(ref/화면/타격효과.png·타격효과2.png) 정밀 재현(사령관 2026-07-02 강화).
  //   레퍼1 = 접촉점 흰금빛 코어 + 촘촘한 가는 금빛 태양버스트(sunburst) 방사. 레퍼2 = 굵은 금빛 불티(ember) 튐 + 흰 슬래시.
  //   ★"방향은 맞다. 단 너무 성기고 작다" → 훨씬 촘촘·밝게·크게. 스파크 2종(태양버스트+불티) 분리.
  //   폐기(재도입 금지): 큰 크로매틱 충격파 링·화면 방사블러/색수차 포스트·큰 슬래시·Points 파티클·SphereGeometry·radial-gradient 스프라이트.
  //   전부 커스텀 GLSL SDF quad. ★모든 강도 수치 여기 노출(슬라이더). 하드코딩 0(G4). hitfx.js는 참조만.
  //   ◆태양버스트(주력, 카메라평면 촘촘 needle) / ◆불티 샤드(보조, 3D anisotropic 스트레치) / ◆코어 플래시 / ◆히트팝 / ◆미세 warm 림.
  hitfx: {
    critMul:1.7,          // 크리/처치 시 강도 배율(버스트/불티 수↑·크기↑·코어화이트↑·팝·림)
    // ── origin 배치(같은 위치 고착 방지 + 접촉면 정렬) ──
    originJitter:0.14,       // 접촉점 미세 랜덤 지터(m) — 매 명중 위치 다르게(같은점 버그 방지)
    contactPull:0.55,        // 몹중심→플레이어 방향 표면쪽으로 당기는 비율(×몹반경). 0=중심, 1=반경만큼(접촉면)
    // ── ◆ 태양버스트(주력) — 접촉점 중심 카메라평면 2D 방사, 가는 금빛 needle 다수, 아주 짧고 밝게. 레퍼1 재현 ──
    burstCount:60,           // 버스트당 needle 가닥수 (원복 — 사령관 "스파크 원래대로")
    burstLen:1.35,           // needle 길이(m) (원복)
    burstWidth:0.06,         // needle 폭(m) (원복)
    burstLenVar:0.6,         // 길이 편차(비율, ±) — 길고 짧은 광선 섞여 유기적
    burstLifeSec:0.14,       // needle 수명(s) (원복)
    burstGlow:4.0,           // 발광 배율 (원복)
    // ── ◆ 불티 샤드(보조) — 3D 바깥+위로 흩뿌려짐, 중력, 버스트보다 길게 흩날림. 레퍼2 재현 ──
    emberCount:15,           // 불티 개수 (원복)
    emberLen:0.6,            // 불티 길이(m) (원복)
    emberWidth:0.1,          // 불티 폭(m) (원복)
    emberSpeed:8.0,          // 초기 방사 속도(m/s) (원복)
    emberSpeedVar:0.6,       // 속도 편차(비율, ±)
    emberGravity:15.0,       // 중력 가속(m/s^2) — 포물선으로 떨어짐
    emberLifeSec:0.38,       // 불티 수명(s) (원복)
    emberSpread:0.7,         // 상승 편향(0=수평 방사, 1=위로 많이 튐)
    emberGlow:2.1,           // 발광 배율 (원복)
    // ── ◆ 코어 플래시 — SDF 별/십자 quad, 접촉점 흰금빛 뜨거운 코어, 짧게(레퍼보다 크고 밝게) ──
    coreSize:0.85,           // 플래시 크기(m) (원복)
    coreMs:95,               // 플래시 지속(ms) (원복)
    coreBoost:1.0,           // 흰 코어 강조 (원복)
    // ── ◆ 색(공통) — 흰금빛 코어 → 금색 → 주황. warm·additive ──
    colCore:0xfff6d8,        // 흰금빛 코어(뿌리, 가장 뜨거움)
    colMid:0xffcc44,         // 금색
    colTip:0xff7a1e,         // 주황(식는 끝)
    // ── ◆ 히트 팝(squash & stretch) — 몹 grp 스케일 임펄스(셰이더 아님). 미세하게 ──
    popScale:0.12,           // 스쿼시 진폭 (원복)
    popMs:120,               // 팝 지속(ms)
    // ── ◆ 미세 warm 림 틴트(선택) — fresnel×u_hit emissive 가산(몹별 clone=흰색고착 근본해결). 아주 옅게. 0=끔 ──
    // ── ◆ 몹 피격 솔리드 실루엣 플래시 — ★폐기(사령관 "몸이 흰색으로 바뀌는 게 아니라"). flashStrength 0=끔 ──
    flashColor:0xffffff,     // (미사용)
    flashStrength:0,         // 0=끔(솔리드 실루엣 플래시 비활성)
    flashMs:90,              // (미사용)
  },
  // A3 카메라 킥/흔들림 — 명중 시 임펄스, 지수감쇠. crit>평타, shieldSlam 최대.
  camShake: { normal:0, crit:0.02, shieldSlam:0.05, decayMs:150 },   // ★사령관 확정(2026-07-02): 평타는 안 흔들림, 크리·궁만 약하게(액션게임 표준·펠월드 톤). 손맛=히트스톱+스파크+넉백. (이력 0.03/0.08/0.15→0.016/0.04/0.09→현재)
  // B1 공격 커밋(무게) ★스프린트 B(2026-07-02) — 공격 모션 중 이동감속 SSOT. player.js:850이 참조만(하드코딩 0, G4).
  //   난사 차단 1순위는 스태미나 고갈(BAL.weapons[*].stam + BAL.player.stamRegen/stamDelay) — 속도 하향 아님(답답 회피).
  //   근거: _DOD_타격감B.md §1-B1-① / _타격감_개선.md §2-④. (기존 하드코딩 0.5/0.85 이관 — 동작 불변)
  commit: {
    moveSlowGround: 0.5,    // 지상 공격 모션 중 이동속도 배율(묵직=발묶임)
    moveSlowAir:    0.85,   // 공중(점프공격) 이동 배율(도약 유지 위해 약하게)
  },
  // ★검격 리본 트레일(blade ribbon) — 재제작(2026-07-02, 사령관 "기존 크레센트에서 만들지 마라, 새롭게 만들어라").
  //   크레센트/SDF quad 완전 폐기. 휘두르는 칼날이 실제로 쓸고 지난 궤적을 3D 리본 메시로 그린다(Genshin/펠월드식 소드 트레일).
  //   player.js가 3인칭 무기 본(slotR)에 붙은 칼날의 tip/hilt 월드좌표를 스윙 중 매 프레임 hitfx로 push →
  //   연속 (hilt,tip) 엣지를 삼각스트립 quad로 이어 리본 생성. 오래된 구간=alpha↓(꼬리 페이드), 스윙 끝=소멸.
  //   ★골드 임팩트 스파크와 별개·다른 쿨톤(시안화이트). 커스텀 GLSL + additive + bloom 레이어. 레퍼=ref/화면/타격효과2.png 흰 아크.
  slash: {
    color:     0x8fdcff,   // 리본 본체색(쿨 시안 = 골드 임팩트와 대비)
    edgeColor: 0xffffff,   // 칼끝(tip)쪽 밝은 흰 코어
    samples:   16,         // 궤적 히스토리 길이(프레임 수) — 리본을 잇는 최대 샘플 수
    fadeMs:    150,        // 꼬리 페이드/소멸 시간(ms) — 기존 롤백
    tipLen:    0.35,       // 칼끝 연장(m) — 기존 롤백
    minStep:   0.02,       // 새 샘플 최소 이동(m) — 칼끝이 거의 안 움직이면 중복 샘플 스킵
    glow:      0.9,        // additive 발광 배율 — 기존 롤백(사령관 "검격은 기존으로". 문제는 보라 임팩트가 덮던 것)
  },
  // D 그로기(무력화) ★스프린트 D(2026-07-02) — 몹 체력바 밑 보라 게이지 누적→full→초고속 난타→0리셋→반복.
  //   ★그로기 면역 ≠ poise(경직) 면역: 그로기는 tier5(dragon)+dragonboss만 면역(tier4 golem은 그로기 허용!).
  //   ★피니셔/처형 없음(사령관 명시 제외). window 종료 시 생존 몹 정상 복귀.
  //   전 수치 여기 SSOT. combat/monsters/player/hitfx는 참조만(하드코딩 0, G7). 근거: _DOD_타격감D.md §0·§1-D0.
  groggy: {
    gaugeMax:     80,       // 그로기 진입 임계치 ★100→80(2026-07-02): 크리감안 ≈5.8타. 임계선을 T2(뱀파 죽음 5.3타)와 T3(임프 7.2타) 사이에 배치 → 잡몹은 죽기전=그로기 제외 / 정예(T3)부터 확실히 그로기. "그로기는 전체(정예+)" 실현. 1차=패서 올리기 유지
    gaugePerHit:  12,       // 평타 1회 누적량(gaugeMax 80 기준 ≈5.8타에 그로기)
    critMul:      1.8,      // 크리 시 누적 배율(×)
    decayPerSec:  8,        // 미교전 시 초당 게이지 감쇠
    windowMs:     3200,     // 그로기 지속(ms)
    rangedReach:  30,       // ★원거리 클래스(룬마스터 staff·헌터 bow) 그로기 E 처형 사거리(m) — 붙지 않고 멀리서 시전(사령관 2026-07-02). 근접(knight/barbarian/rogue)은 ATK_REACH 유지

    // ★그로기 난타 전용 임팩트(사령관 2026-07-02 전면 신설): 골드 평타 스파크(spawnBurst/Ember/Core)와 코드·비주얼 완전 별개.
    //   레퍼런스(ref/화면/타격효과.png) = ①중앙 방사광선(불꽃처럼 확 퍼지는 선) + ②바깥 큰 원(팽창하는 링). 보라색·밝고 화려.
    //   hitfx.js의 신설 함수 groggyImpact(pos,mul)가 이 값들만 참조(하드코딩 0, G4/G7). spawnBurst 재활용 아님.
    impactColCore:0xf6e2ff, // 방사광선 코어(뿌리, 흰보라 — 가장 뜨거움)
    impactColMid: 0xc060ff, // 방사광선 본체(보라)
    impactColTip: 0x8624dd, // 방사광선 끝(짙은 보라)
    impactScale:  0.8,      // 임팩트 전체 크기 배율 ★1.2→0.8(더 줄임 — 검격 안 묻히게, 사령관)
    impactGlow:   0.85,     // 발광 배율 ★1.0→0.85(더 줄임)
    // ── ① 중앙 방사광선(radial spikes) — 접촉점 중심서 삼각 스파이크가 불꽃처럼 확 뻗음(base=hot core, tip=뾰족) ──
    rayCount:     26,       // 방사광선 가닥수
    rayLen:       1.7,      // 광선 길이(m, ×impactScale)
    rayLenVar:    0.55,     // 길이 편차(±비율) — 길고 짧은 선 섞여 불꽃처럼 유기적
    rayWidth:     0.13,     // 광선 뿌리 반폭(m, ×impactScale) — 삼각형 base 폭
    rayLifeSec:   0.17,     // 광선 수명(s) — 확 떴다 사라지는 짧은 플래시
    rayGlow:      2.2,      // 광선 발광 배율 ★3.2→2.2(밝기 줄임)
    // ── ② 외곽 큰 링(expanding ring) — 카메라빌보드 quad annulus. 작게 떴다 크게 팽창하며 페이드(레퍼 "바깥 큰 동그라미") ──
    ringSize:     1.7,      // 링 quad 월드 크기(m, ×impactScale) ★2.2→1.7(더 줄임)
    ringLifeSec:  0.32,     // 링 수명(s) — 광선보다 살짝 길게(팽창 잔상)
    ringRad0:     0.16,     // 링 시작 반경(quad half 기준 0..1)
    ringRad1:     0.94,     // 링 끝 반경(팽창 도달점)
    ringThick0:   0.15,     // 링 시작 두께(0..1) — 처음 굵게
    ringThick1:   0.03,     // 링 끝 두께(팽창하며 얇아짐)
    ringGlow:     1.7,      // 링 발광 배율 ★2.6→1.7(밝기 줄임)
    ringColCore:  0xecc8ff, // 링 밝은 코어(흰보라 엣지)
    ringColGlow:  0xa63cf5, // 링 본체(선명 보라)
    // ★★[룬마스터 전용 아케인 처형 VFX — 리그 신설 2026-07-02] 마법사(staff)가 그로기 몹 E연타 시 발동.
    //   레퍼런스: ref/마법느낌.jpg(파란-시안 아케인 볼트: 흰-시안 hot 코어 + 휘감는 플라스마 + 날카로운 선단) +
    //             ref/마법진.webp(룬 마법진 — 원본 주황불꽃 → 파랑-시안 틴트, 중앙 화염기둥 마스크로 죽이고 룬링만).
    //   hitfx.js의 신설 함수 arcaneStrike(pos,mul)/arcaneCircleEnsure(mn)가 이 값만 참조(하드코딩 0, G4/G7).
    //   ★타클래스 처형(보라 groggyImpact)과 완전 별개 — 색·셰이더·코드 재활용 아님. 볼트=풀링(개수 캡), 마법진=단일 quad 1개.
    arcane: {
      // ── ① 파란 아케인 볼트(에너지 스트라이크) — E 한 타마다 접촉점에 다다다 꽂힘 ──
      boltCore:      0xeaffff, // 볼트 hot 코어(흰-시안, 가장 뜨거움/선단)
      boltMid:       0x38d0ff, // 볼트 본체(시안 플라스마)
      boltEdge:      0x1f6bff, // 볼트 엣지(파랑, 바깥 휘감는 에너지)
      boltLifeSec:   0.22,     // 볼트 수명(s) — 짧고 강하게(확 꽂혔다 소멸)
      boltLen:       2.6,      // 볼트 길이(m, ×szMul) — 선단→꼬리 스트릭
      boltWidth:     0.95,     // 볼트 폭 envelope(m, ×szMul) — 플라스마 오라 포함
      boltGlow:      2.4,      // 볼트 additive 발광 배율
      boltNoise:     0.9,      // curl/fbm 플라스마 강도(넘실대는 에너지 tendril)
      boltPool:      12,       // ★볼트 풀 크기(draw call 상한 — 연타해도 이 수 이하)
      boltPerHit:    1,        // E 1타당 볼트 수(1=날렵, 2=겹쳐 두껍게)
      boltSpreadDeg: 24,       // 입사각 랜덤 범위(±deg) — 매 타 방향 변주(다다다)
      // ── ② 발밑 룬 마법진(마법느낌.jpg가 아니라 마법진.webp) — 처형 지속 동안 1개 유지, 회전+발광+페이드 ──
      circleSize:        2.9,      // 마법진 지름(m, ×몹scale)
      circleTint:        0x35ccff, // 파랑-시안 틴트(원본 주황을 휘도기반 틴트로 치환)
      circleGlow:        1.4,      // 마법진 발광 배율
      circleOp:          0.95,     // 마법진 최대 불투명도
      circleRot:         0.5,      // 회전 속도(rad/s) — 천천히
      circleHoldMs:      700,      // 마지막 E타 후 유지시간(ms) — 무입력 시 이 후 페이드아웃
      circleFadeIn:      0.16,     // 페이드 인(s)
      circleFade:        0.5,      // 페이드 아웃(s)
      circleInner:       0.19,     // 중앙 화염기둥 마스크 시작반경(0..1) — 안쪽 죽임(룬링만)
      circleInnerFeather:0.14,     // 마스크 페더(부드러운 경계)
      // ── ③ 몹에게 꽂히는 "맞는이펙트" 임팩트(레퍼런스 ref/맞는이펙트.jpg — 청백 전기폭발+지면 룬서클+흰 감싸는 아크) ──
      //     E 1타마다 몹 위치에 발생. hitfx.arcaneImpact(pos,mul)가 이 값만 참조. 마법진(①)은 시전자 발밑, 이건 몹 몸에.
      impSpikeCount:   7,        // 중앙서 방사되는 전기 스파이크 수(레퍼런스=사방 번개)
      impSpikeLen:     1.6,      // 스파이크 길이(m)
      impSpikeWidth:   0.62,     // 스파이크 폭(m)
      impSpikeLifeSec: 0.24,     // 스파이크 수명(s) — 짧고 강하게
      impSpikeGlow:    1.4,      // ★스파이크 발광 — 단발 볼트(boltGlow 2.4)와 분리. 연타로 겹쳐 밝던 것 낮춤(2026-07-02 사령관 "너무밝아")
      impCoreScale:    1.05,     // 중앙 코어 플래시 크기 배율(spawnCore) ★1.25→1.05 축소
      impCoreColHot:   0xf2ffff, // 코어 hot(흰-시안)
      impCoreColMid:   0x36ccff, // 코어 mid(시안)
      impCircleSize:   2.3,      // 몹 지면 임팩트 룬서클 지름(m, ×몹scale)
      impCircleLifeSec:0.42,     // 임팩트 서클 수명(s) — 확 떴다 사라짐(캐스팅서클과 별개)
      impCircleGlow:   1.1,      // 임팩트 서클 발광 ★1.6→1.1
      impArcCount:     2,        // 흰 감싸는 아크 수(레퍼런스=좌/우 2개)
      impArcColor:     0xffffff, // 아크 색(흰 브러시 스트로크)
      impArcRadius:    0.72,     // 아크 반경(빌보드 uv 0..1 기준, 0.72≈스피어 감쌈)
      impArcThick:     0.11,     // 아크 두께(반경방향)
      impArcSpanDeg:   130,      // 아크 각폭(도, 크레센트 호)
      impArcLifeSec:   0.28,     // 아크 수명(s)
      impArcSpin:      6.0,      // 아크 회전(rad/s) — 감싸며 도는 느낌
      impArcGlow:      1.4,      // 아크 발광 ★2.2→1.4(2026-07-02 사령관 "너무밝아")
      impArcSize:      2.8,      // 아크 빌보드 전체 크기(m)
    },
    // ★헌터(bow) 그로기 처형 = 화살비 + 박힘 물리 임팩트(2026-07-02 사령관). 마법사와 정반대=물리·건조·마법진 없음.
    //   combat.execArrowVolley(mn) + hitfx.arrowEmbedImpact(pos)가 이 값만 참조. 박힘 임팩트=groggyImpact 구조 물리색 재활용(다른 클래스만큼 무게).
    arrow: {
      // ── ★에너지 애로우(레퍼런스 ref/활.webp) — 파란-흰 집중 빔 + 발사 조리개 링. hitfx.energyArrow가 참조. ──
      beamWid:        0.5,     // 빔 폭(m) — 얇고 날카롭게
      beamLifeSec:    0.18,    // 빔 수명(s) — 짧게 번쩍
      beamGlow:       2.4,     // 빔 발광(bloom)
      beamMid:        0x8fdcff,// 빔/조리개 시안
      beamEdge:       0x2f7bff,// 빔 엣지 파랑(스파클 tip)
      launchRingSize: 2.3,     // 발사 활곡선 전체 크기(m)
      launchRingLifeSec: 0.24, // 활곡선 수명(s)
      launchArcSpan:  1.25,    // 활 곡선 각폭(rad, half-span) — π=full ring
      launchArcR0:    0.66,    // 활 곡선 반경(좌우 끝 뾰족한 렌즈)
      launchArcThick: 0.06,    // 활 곡선 두께
      launchFlashScale: 1.1,   // 발사 섬광 크기 배율
      impFlashScale:  1.0,     // 몹 임팩트 섬광 크기 배율
      emberScale:     1.15,    // 임팩트 스파클 파편 크기
      launchY:        0.55,    // ★발사 높이(플레이어 pos.y 기준 오프셋) — 1.4=머리에서 나가던 것 낮춤(활 든 손 높이). 사령관 "머리에서나감"
      launchFwd:      1.3,      // ★발사 지점 전방 오프셋(m, 조준방향) — 몸에서 뜨던 걸 활 앞쪽으로. 사령관 "이펙트가 앞에서떠야지"
      impactYMul:     0.35,    // 몹 임팩트 높이(몹scale 배, 0.5=상체→0.35 몸통 중앙쪽)
      // ── (구 물리 화살 파라미터 — 현재 에너지 애로우로 대체됨. 잔존 execArrowVolley가 참조) ──
      count:        3,        // E 1타당 화살 수(볼륨)
      instantRange: 9,        // <이 거리(m)=즉발 박힘 / ≥=투사체 날아가 꽂힘("둘 다 섞기")
      travelSpeed:  95,       // 투사체 속도(m/s) — 빠르게(다다다 유지)
      spreadDeg:    12,       // 목표 퍼짐(몹 몸 주변 랜덤)
      stickSec:     0.12,     // 몹에 박혀있는 시간(s) 후 소멸
      // 박힘 물리 임팩트 색(흰-탄, 마법 글로우 아님. bloom 미사용=건조):
      impCore:      0xfff4e0, // 사방광선 코어(흰-탄)
      impMid:       0xffd9a0, // 본체(탄/모래빛)
      impTip:       0xffffff, // 선단(흰)
      impRingCore:  0xfff0d8, // 외곽 링 코어
      impRingGlow:  0xffcf8a, // 외곽 링 발광색
      impGlowMul:   1.6,      // 발광 배율 ★0.9→1.6 + bloom ON(2026-07-02 사령관 "다른 클래스보다 별로"): 룬마스터급 광채로 끌어올림
      coreCol:      0xfff6ea, // 중앙 코어 플래시(흰)
      coreScale:    1.2,      // 코어 플래시 크기 배율
      emberScale:   1.15,     // kinetic 불티(꽂히며 튀는 흰-골드 샤드) 크기 배율
      pinCount:     5,        // ★꽂힌 화살 다발(핀쿠션) 수 — 활 고유 화려함(임팩트 순간 사방서 몹에 박힘)
      pinStickSec:  0.16,     // 핀쿠션 화살 박혀있는 시간(s)
      pinSpread:    0.55,     // 핀쿠션 반경(몹 몸 주변 분산, ×몹R)
    },
    // ★그로기 난타 콤보 카운터(2026-07-02 신설, DMC/베요네타 스타일랭크 레퍼런스): E 난타 1타=콤보+1.
    //   uikit.comboHit(n)/comboEnd(n)가 이 값만 참조(순수 스타일 상수는 uikit 내부 COMBO). 하드코딩 0(G7).
    combo: {
      tierAt:  [5, 10, 15],  // 에스컬레이션 임계(카운트 도달 시 색·크기 단계 상승: 흰→골드→주황→레드핫+셰이크)
      endMs:   900,          // 마지막 난타 후 이 시간 무입력(or 그로기 종료) = 콤보 종료 → 마무리 "N HIT!" 후 페이드
    },
    mashCd:       90,       // 난타 1타 간격(ms) — "다다다다"
    mashDmgMul:   0.6,      // 난타 1타 데미지 배율(연타=다타이므로 타당 낮춤)
    mashHitStop:  14,       // ★난타 전용 짧은 히트스톱(ms) — 평타 64ms를 90ms 연타에 겹치면 프리즈 반복=끊김 → 다다다다는 거의 안 멈추게(매끄러운 flurry)
    mashFxCrit:   true,     // ★난타 임팩트=크리급 화려하게(flashHit critMul 버스트) (사령관 "조금 더 화려")
    barColor:     0xa855f7, // 보라 그로기 게이지 바 색
    downTilt:     0.5,      // 다운(기울임) 포즈 각도(rad) — 그로기 진입 시 grp.rotation.x
    starCount:    3,        // 머리 위 별 개수
    starScale:    0.95,     // 별 quad 크기(m) — 밝은 배경 대비 위해 크게(F2 재작업)
    starHeadY:    1.5,      // 별 궤도 높이(×몹scale, 머리+DOM 어그로아이콘 위로 — 머리 바로 위 크라운)
    starOrbitR:   0.7,      // 별 궤도 반경(×몹scale) — DOM HP바/아이콘 폭 밖으로 벌리되 머리 위 밀집
    starGlow:     2.2,      // 별 additive 발광 배율 — 3.6은 코어 blow-out으로 4갈래 뭉갬(프레임 지적) → 2.2로 실루엣 선명(밤 배경 판독 유지)
    immuneTiers:  [5],      // 보스 그로기 불가(tier5 dragon)
    immuneTypes:  ['dragonboss'],
  },
};

// ══════════════════════════════════════════════════════════════
//  5-B. 차원문 게이트 등급 (gate.js) — ★게이트 자체에 등급 부여(사령관 A안, 2026-07-01)
//     등급별로 "적정 레벨대" 몬스터만 팝업. pool = BAL.monsters.stats 키.
//     등급이 곧 지역/월드 난이도 → 플레이어가 진행할수록 상위 등급 게이트를 만남.
//     ±1 티어를 약간 섞어 단조로움 방지(range = 권장 레벨대). color/ko = 게이트 연출.
// ══════════════════════════════════════════════════════════════
// ★게이트 = 보스 던전(2026-07-02, 사령관): 등급별 보스(bossKey) 1마리 스폰 → 보스 처치 = 토벌.
//   bossKey = 해당 등급 최강 몹을 보스로 승격(bossGate.mul 배율). 잡몹은 pool에서 웨이브.
const gates = {
  grade1: { ko:'하급 차원문', grade:1, color:0x46e88a, lvl:'1~3',   pool:['bat','ghost','mummy','zombie','skeleton','sk_minion'],   count:16, interval:1.8, bossKey:'sk_minion' },   // ★색=intro warp 초록(2026-07-14 사령관: 차원문=intro와 동일 초록). 구 파랑 0x8ad0ff
  grade2: { ko:'중급 차원문', grade:2, color:0x46e88a, lvl:'4~8',   pool:['skeleton','sk_minion','slime','nghost','vampire'],       count:16, interval:1.9, bossKey:'vampire' },
  grade3: { ko:'상급 차원문', grade:3, color:0x7bffd6, lvl:'9~14',  pool:['vampire','imp','boom','sk_rogue','sk_mage','sk_warrior'], count:16, interval:2.0, bossKey:'sk_warrior' },
  grade4: { ko:'정예 차원문', grade:4, color:0xff8a3c, lvl:'15~19', pool:['sk_warrior','creep','darkskel','turtle','foe','golem'],  count:12, interval:2.4, bossKey:'golem' },
  boss:   { ko:'보스 차원문', grade:5, color:0xff3a3a, lvl:'20+',   pool:['dragon'],                                               count:1,  interval:3.0, boss:true, bossKey:'dragon' },
};
// 게이트 보스 승격·토벌 보상 (gate.js·monsters.js 참조)
const bossGate = {
  mul:    { hp:2.8, atk:1.5, scale:1.3 },       // 보스 승격 배율(grade1~4). tier5(dragon)=네이티브 보스라 미적용. ★hp 4.5→2.8(2026-07-15 감사): grade4 골렘보스 EHP 1890>dragon 1000 역전·grade3→4 ×2.6 급점프 해소. 이제 grade EHP 단조(123<218<448<1176<dragon1400).
  // ★xpPerGrade(2026-07-13 추가, 사령관 지시 "클리어하면 추가 경험치") — 첫 도입값, 라이브 확인 후 조정 필요(xpForNext(1)=100 기준 잡음).
  reward: { goldPerGrade:150, soulPerGrade:20, xpPerGrade:60 },// 토벌 보상(등급 비례). ★기본 XP·영혼 드롭은 보스 def.hp(×4.5) 스케일로 이미 자동 4.5배 — xpPerGrade는 "클리어 완료" 별도 보너스
};

// ⛏️ 광산 던전 SSOT (dungeonrun.js) — 레벨 tierForLevel(1~5)별 규모·몹·함정·파밍·보상·무드. ★제안값(2026-07-16 재설계), 라이브 튜닝.
//   보스/잡몹 풀은 gates[grade](SSOT) 재활용, 완료 보너스는 bossGate.reward 재활용.
const dungeon = {
  tiers: {
    // grid=상층 그리드 폭 · rooms=[min,max] · mobs=잡몹수 · spikes/fire=함정수 · nodes=하층 광맥수 · nodeOres=광맥 광물(가치순) · drop=클리어 광물드롭 · reward=클리어 보너스 · mood=무드색
    // ★2026-07-21 잡몹 수 대폭 상향 (사령관 "몹 숫자가 다 별로임"). 11차 던전은 방이 14개(지상 7 + 지하 7)라
    //   기존 5~9마리로는 방 하나당 0.5마리도 안 됐다. 방별 라운드로빈 분배(dungeonrun)와 세트로 동작한다.
    // ★2026-07-22 재상향 (사령관 "지하 넓은 홀에비해 몬스터가 적음") — 20마리를 14방에 라운드로빈하면 대공동(13×11)에도
    //   1~2마리뿐이었다. 마커 증설(dungeonrun ROOM_PREFABS: 대공동 8·심연 7·동굴 8)과 세트로 총량도 올린다. ★라이브 튜닝값.
    1: { grid:14, rooms:[4,5],  mobs:28, spikes:2, fire:1, nodes:2, nodeOres:['coal','tin'],           drop:[['tin',1],['coal',2]],           reward:{gold:80,  soul:4,  xp:25},  mood:0x46e88a },
    2: { grid:16, rooms:[5,6],  mobs:33, spikes:2, fire:1, nodes:3, nodeOres:['copper','iron'],         drop:[['copper',2],['iron',1]],        reward:{gold:130, soul:8,  xp:50},  mood:0x46e88a },
    3: { grid:18, rooms:[6,7],  mobs:38, spikes:3, fire:2, nodes:3, nodeOres:['iron','silver'],         drop:[['iron',2],['silver',1]],        reward:{gold:190, soul:12, xp:75},  mood:0x7bffd6 },
    4: { grid:20, rooms:[7,8],  mobs:44, spikes:3, fire:2, nodes:4, nodeOres:['silver','cobalt'],       drop:[['silver',2],['cobalt',1]],      reward:{gold:260, soul:16, xp:100}, mood:0xff8a3c },
    5: { grid:22, rooms:[8,10], mobs:50, spikes:4, fire:3, nodes:5, nodeOres:['gold','gem','cobalt'],   drop:[['gold',2],['gem',1],['cobalt',1]], reward:{gold:360, soul:24, xp:140}, mood:0xff3a3a },
  },
  get(tier){ return this.tiers[tier] || this.tiers[1]; },
  // ★Phase 2 세트피스 — 용암 방(사령관 확정 2026-07-16): 방 중앙 바닥을 들어낸 큰 용암 지대 + 그 위 좁고 긴 길·발판을
  //   지그재그로 낮아지게 배치 → 점프로 내려가 맨 아래 보상. 떨어지면 즉사(체력 무관). 가장자리 링은 안전(선택적 도전).
  //   ★전부 제안값 — 라이브 튜닝 대상.
  setpiece: {
    lava: {
      depth: 9,          // 방 바닥(y=0) 아래 용암면까지(m) — 낙하 체감
      steps: 5,          // 지그재그 발판 단 수(위→아래)
      dropPerStep: 1.35, // 단당 하강(m) — 점프(9m/s)로 되올라가기 애매한 높이 = 하강 압박
      padW: 2.0,         // 발판 한 변(m) — "좁은 느낌"의 근원
      pathLen: 5.2,      // 길다란 좁은 길 구간 길이(m)
      pathW: 1.6,        // 그 길의 폭(m)
      lethal: true,      // 용암 접촉 = 즉사(사령관 확정. false면 아래 dmg 적용)
      dmg: 40,           // lethal:false일 때 접촉 피해
      reward: { gold: 140, soul: 8 },   // 맨 아래 발판 보상 상자
    },
    // 🏔️ 폭포 대홀 = 지하 2층(사령관 확정 2026-07-22) — "홀이라기보다 산에 구멍 뚫려 있는 보스방 느낌".
    //   진입 턱에 서면 홀 전경이 한눈에 → 절벽 지그재그 돌길로 하강 → 폭포와 물웅덩이 → 맨 밑 보스 게이트.
    //   ⚠️격자(heightfield)로는 못 만든다(한 칸=높이 하나) → dungeonrun.buildCascadeHall 이 손으로 짜는 커스텀 기하.
    cascade: {
      w: 48, d: 48,       // 동공 발판(m)
      drop: 30,           // 진입 턱 → 물웅덩이 낙차(m). 사령관 확정: -20m 진입 → -50m 바닥
      runs: 6,            // 지그재그 스위치백 구간 수 (구간당 drop/runs 만큼 하강)
      pathW: 5.0,         // 돌길 폭(m) — ⛔드롭 쪽엔 난간 없음(사령관 선택안 "난간 없고 한쪽이 뚝")
      runLen: 20,         // 한 구간 길이(m)
      ledgeW: 12,         // 진입 턱 폭(m)
      ledgeD: 8,          // 진입 턱 깊이(m)
      ceil: 12,           // 물웅덩이 기준 천장 높이 여유(m) — 진입 턱 위로 이만큼 더 트임
      poolDeep: 0.9,      // 물웅덩이 수심(m) — 무릎 정도, 걸어서 건넌다
      fallDmg: 45,        // 돌길에서 떨어져 물에 처박힐 때 피해(즉사 아님 — 물이 받아준다)
    },
  },
};
// 🔮 영혼 상점 (교역소 추종자 판매 — trade.js). 토모브의 영혼(soul, 몬스터 처치 드롭)으로 구매 = 첫 소울 싱크.
const soulShop = {
  potion: { price: 15, heal: 50 },      // 🧪 힐링 포션: 영혼15 → 즉시 HP+50 (H키 사용)
  revive: { price: 40, hpPct: 0.5 },    // 💠 부활석: 영혼40 → 소지 중 사망 시 자동 소모 → 제자리 부활(HP 50%)
};

// ══════════════════════════════════════════════════════════════
//  6. 배 / 항해 (ship.js)
// ══════════════════════════════════════════════════════════════
const ship = {
  durMax:   100,      // 내구도 최대(항해 마모/충돌로 감소, HP와 별개)
  wearSail: 0.08,     // 항해 마모: -wearSail × 속도 × dt
  wearHit:  0.06,     // 충돌 마모: 프레임당 감소(육지/부두)
  maxSpeed: 12.0,     // 최대 목표속도(바람 정규화 전). ★2026-07-23 사령관 "너무 느림" → 8.0→12.0(+50%). 근접·폭풍도 비례 상승. 라이브: window.__topspd(v).
  boostMult: 1.55,    // ⚡ Shift 전력항해 배속(스태미나 소모) — 도보 달리기의 배 버전
  boostDrain: 5.0,    // 부스트 스태미나 소진 시간(초, 1→0)
  boostRegen: 8.0,    // 부스트 스태미나 회복 시간(초, 0→1)
  tiltMax:  0.4,      // 파도 최대 기울기(rad)
  repairCostPerDur: 5,  // 항구 수리비 = (durMax-내구도) × 이 값 (harbor.js)
  deathPenalty: 30,     // ★게임오버(사망) 시 배 내구도 감소 페널티 (combat.js reviveAtHarbor). 항구 복귀 후 수리=골드 싱크
  // ★D1(2026-07-15): 항구 배 업그레이드 SSOT — 속도/대포/돛 각 3레벨. cost=레벨별 골드, mult=레벨당 배율.
  //   적용: speed→ship.maxSpeed(항해속도, ship.js) · cannon→해전 포격 데미지(navalcombat.js) · sail→전력항해(Shift) 부스트(ship.js).
  //   레벨 저장 = ctx.shipUpgrades{speed,cannon,sail}(save.js 왕복). 값은 완만(3렙 만렙 시 속도/돛 +24%·대포 +30%).
  upgrades: {
    speed:  { max:3, cost:[300,600,1000], mult:0.08 },
    cannon: { max:3, cost:[350,700,1100], mult:0.10 },
    sail:   { max:3, cost:[300,600,1000], mult:0.08 },
  },
};

// ══════════════════════════════════════════════════════════════
//  6.5 항해 물리 (ship.js) — 폴라곡선·추진/항력·파도 surge·복원·힐
// ══════════════════════════════════════════════════════════════
//   ★2026-07-22 신설. 사령관 "배 타는 느낌이 안 들어 — 인위적인 느낌" → 물리 재설계.
//   유도·검산 정본 = `_바다물리_수식.md`(Fable 유도, 앤 독립 검산 12개 값 오차 0).
//   ⚠️여기 수치를 바꾸면 `node scripts/_sail_e2e.mjs`로 재검증할 것(종단속도·폴라 목표점이 하드 검사).
const sailing = {
  // ── 폴라 곡선: catchF(θ). θ=0 맞바람(irons) / π/2 빔리치(최대) / π 순풍.
  //   lobe 4계수는 목표점 4개(45°=0.55·90°=1.00·135°=0.90·180°=0.70)를 통과하는 연립방정식의 정확해.
  //   ⚠️raw 피크가 102.5°에서 1.0246 → **1.0 클램프 필수**(안 하면 빔리치보다 브로드리치가 빨라짐).
  polar:   { c0:0.75295, c1:-0.20103, c2:-0.24705, c3:0.00693,
             noGoStart:0.5585, noGoWidth:0.2793,   // 32°에서 시작해 16° 폭으로 smoothstep 해제
             floor:0.05 },                          // irons에서도 최소 조종성(0=완전정지, 답답함 방지)
  // ── 추진/항력 (질량 m=1 정규화): dv/dt = thrust − (k1·v + k2·v²)
  //   maxThrust = k1·V + k2·V² (V=ship.maxSpeed) 로 **역산**되므로 기존 최고속 8.0이 정확히 보존된다.
  //   k1/k2 조합: (0.08,0.003)=기민 t63 8.8s · (0.06,0.004)=권장 9.6s · (0.04,0.005)=묵직 10.6s
  drag:    { k1:0.05, k2:0.003 },   // ★2026-07-23 maxSpeed 8→12로 thrust 역산값이 커져 t63가 7.96s로 빨라짐 → k1/k2 하향해 굼뜬 범선 가속(t63~9.5s) 복원.
  coastMin: 0.012,   // 이하 속도는 0으로 스냅(부동소수 잔류 제거) — 기존 값 유지
  // ── 🌬️ 풍속 반영(감사 M7: wind.strength가 추진에 안 쓰이던 것) — 기준풍속 대비 배율.
  //   ⚠️기준값은 **추측 금지**. wind.js 실제 식(2026-07-22 실측):
  //     base = 0.12 + distF*0.6   (섬 근처 0.12 ~ 먼바다 0.72)
  //     strength = base * (raining ? 1.7 : 1.0) + sin(t*0.25)*0.05
  //   ⇒ 실제 구간: 섬근처 맑음 0.12 · **먼바다 맑음 0.72** · 먼바다 비 1.22
  //   기준 = **먼바다·맑음(0.72)** 로 잡아야 "탁 트인 바다에서 빔리치 = 기존 최고속 8.0"이 정확히 보존된다.
  //   (1차에 0.4로 잘못 잡아 먼바다가 상한 1.35에 붙어버렸다 → 최고속 9.96 + 비가 와도 속도 불변.)
  //   결과: 섬 근처 = 0.65배(바람 그늘, 5.8 m/s) / 먼바다 맑음 = 1.00배(8.0) / 폭풍 = 1.35배(10.0).
  windRefStrength: 0.72, windMulMin: 1.0, windMulMax: 1.6,   // ★2026-07-23 사령관 "섬에서 속도가 안나온다" → 바람그늘 penalty 제거(하한 0.65→1.0). 이제 배율은 [1.0,1.6] = 기준속은 어디서나 보장, 바람(폭풍/강풍)은 위로만 보너스. "기본값=제일 빠른 속도 / 바람 잘 받으면 더 빠르게" 지시 정합.
  sailBonus: 0.5,   // ★2026-07-23 돛효율 = 항상 100%(1.0) + 바람 정렬도(_polar)×이 값 만큼 추가. 0.5 = 빔리치서 최대 +50%. 역풍이라도 기준속 100% 보장(사령관 "돛효율 항상 100% 고정, 바람 맞으면 추가"). window.__sailbonus로 조정.
  // ── 🌊 파도 surge: a = −g·kSurge·clamp(진행방향 수면경사)
  //   실측(WAVES 12항 몬테카를로 20만): 경사 RMS 0.076(4.4°)·최대 0.269(15.1°).
  //   분산 기여 = 너울 5.3% / **중파 61.5%(주 성분)** / 잔물결 33.2%(선체 길이로 평균화돼 대부분 소거).
  //   k=0.6 → RMS 0.45 m/s² · 중파 마루 0.94 m/s² ⇒ 속도 ±10~19% 맥동(파도 등을 타넘는 가감속).
  kSurge:  0.6,      // 범위 0.3~0.8 (1.0=무마찰 경사 활강 상한)
  surgeSlopeClamp: 0.35,   // 경사 클램프(폭풍 중첩 스파이크 방호)
  lateralPush: 0.35,       // 좌우 경사에 의한 옆밀림(카오스) — 구 _wp(차원 불일치)를 경사 기반으로 교체
  // ── 복원 모멘트(메타센터/wall-sided GZ 근사): −ω₀²·sinφ·(1+β·tan²φ) − 2ζω₀·φ̇
  //   선형 스프링이던 것 → 각도가 커질수록 경화(0.4rad에서 +32%). tan² 클램프로 발산 차단.
  restore: { w0sq:1.6, beta:2.0, zeta:0.35, tan2Clamp:0.35 },   // ω₀²=1.6 → 롤 고유주기 ≈5.0s
  waveTorqueGain: 0.025,   // 파도 강제 토크 게인 — 복원항 신설로 이중 스프링이 되므로 구 0.05에서 절반으로
  // ── 선회 힐: heel = −scale·atan(yawVel·speed/g). atan 포화라 과속에도 발산 없음.
  //   상한 조합(0.24rad/s × 8m/s) = 11.07°. scale 1.355에서 15°에 닿으므로 그 이하만 허용.
  heelScale: 0.85, heelResponse: 2.5,   // 구 3.5 → 2.5(질량감). ★2026-07-23 1.0→0.85: maxSpeed 12로 올리며 고속 선회 힐 보정(0.24×12 → 13.9° < 15° 유지).
  // ── 🎥 조타 카메라(player.js) — 선체에 용접돼 있던 것을 스프링으로 분리(감사 M8).
  //   _pitchGain을 2.2→1.0으로 정직화하면서 잃는 극적 연출을 여기서 되찾는다.
  cam: { heaveK:9.0, heaveC:5.5, heaveMax:1.6, rollFollow:0.55, shakeOnLand:0.35 },
};

// ══════════════════════════════════════════════════════════════
//  6.6 날씨 (wind.js) — 자동 폭풍 스케줄러
// ══════════════════════════════════════════════════════════════
//   ★2026-07-24 신설. 사령관 "비가 안 내림" → 진단 결과 **자동 트리거가 아예 없었다**
//     (ctx.wind.raining을 켜는 곳은 R키[__testMode 전용]와 검증 스크립트뿐).
//   상태머신: clear ──> warn(예고) ──> storm ──> clear
//   ⚠️발생 금지: 던전 중(ctx.dungeon.active) · 오프닝/튜토 중 · __testMode(수동 A/B 판정 방해 금지).
//   ⚠️세이브 안 함(휘발) — 이어하기는 항상 clear로 시작.
const weather = {
  enabled: true,
  // ── 주기(초). 하루=1200초(20분, sky.js DAY_LENGTH)이므로 게임 내 하루에 약 1회.
  //   ★2026-07-24 사령관 확정: 15~30분 간격 / 2.5~4.5분 지속.
  clearMin: 900,  clearMax: 1800,   // 맑음 지속 15~30분
  stormMin: 150,  stormMax: 270,    // 폭풍 지속 2.5~4.5분
  // 첫 폭풍까지는 짧게 — 세션 시작 후 15분을 기다리면 실플레이 판정이 불가능하다.
  firstDelayMin: 300, firstDelayMax: 600,   // 5~10분
  // ── 예고(warn): 토스트 1회 + 먹구름이 먼저 낀다. 폭풍은 이 시간 뒤 본격 시작.
  warnSec: 45,
  warnAmt: 0.22,   // 예고 중 rainAmt 목표(먹구름·가랑비. 1.0=완전 폭풍)
  // ── 🌊 [B단계] 폭풍 파고 게인 — uSwell(너울+중파, 진폭합 9.10)을 날씨에 연동한다.
  //   ⚠️현재 0 = 기존 동작 그대로(폭풍이 잔물결 uWaveAmp만 키워 총 파고 +6.5%에 그침).
  //   사령관이 window.__swellStorm(값)으로 판정한 뒤 확정값을 여기 박는다. 후보 0.35 / 0.6 / 1.0.
  swellStormGain: 0,
  //   섬 근처 감쇠: uSwell은 거리와 무관하므로 이 항이 없으면 폭풍 때 항구에서도 파고가 폭발한다.
  //   실효 게인 = swellStormGain × rainAmt × (swellNearFloor + (1-swellNearFloor)×distF)
  swellNearFloor: 0.25,
};

// ══════════════════════════════════════════════════════════════
//  7. 해전 (navalcombat.js / cannon.js) — 배 대포·적선
// ══════════════════════════════════════════════════════════════
const naval = {
  playerMaxHp: 120,   // 플레이어 배 HP(전투)
  enemyMaxHp:  120,
  cannonDmg:   7,     // 대포 발당 피해(배 HP 차감)
  reload:      4.8,   // 대포 재장전(s)
  gunsPerSide: 5,     // 현측 포문 수
  gunReach:    82,    // 발사 사거리
  fireRange:   120,   // 발사 시도 최대거리(AI·HUD)
  enemySpread: 1.0,   // 적 산포(>1=명중률 낮음, 튜토리얼 너프용)
  aiStandoff:  52,    // 적 AI 선호 교전거리
  aiTurn:      0.55,  // 적 AI 최대 선회(rad/s)
  aiSpeed:     6.5,   // 적 AI 순항속도
  enemyRespawn: 3.0,  // 적 격침 후 재등장(s, 단일모드)
  projGravity: 24,    // 포탄 중력
  projSpeed:   22,    // 포탄 수평속도

  // ── 🎯 조준 밴드(발사각 방식, 2026-07-12 레퍼런스 재구현) — 마우스 위/아래 = 발사각 θ. ──
  //   아래로 볼수록 직사(평평·정점 낮음·근거리 착탄) / 위로 볼수록 곡사(위로 크게 떠 멀리 착탄).
  //   밴드 = 폭 있는 반투명 흰 곡면 리본(앞 넓고 착탄쪽 좁음). 밴드 곡률 = 실제 포탄 궤적과 100% 일치(fireVel).
  muzzleSpeed:       78,    // 총구 속도(m/s) — 밴드 곡면·실제 포탄 공통. (중력=projGravity 24 공유) ★60→78(사령관 "공성 사거리 짧다"): 최대 ~150m→~245m. 마우스 위로 조준=더 멀리.
  aimAngMin:         0.02,  // 최저 발사각(rad≈1°) = 직사. 마우스 아래로 볼 때. 정점 거의 0·가까이 착탄(직선).
  aimAngMax:         0.80,  // 최고 발사각(rad≈46°) = 곡사. 마우스 위로 볼 때. 위로 크게 떠 멀리 착탄.
  bandBaseW:         20,    // 밴드 시작(포구쪽) 반폭(m) — 좌우 산탄 폭. 사령관: 레퍼런스처럼 넓게(9→20)
  bandTaper:         0.3,   // 착탄쪽으로 좁아지는 비율(0~1) = 앞 넓고 끝 좁음(레퍼런스). 0.6→0.3 = 착탄쪽 덜 좁아짐
  bandFarNarrow:     0.18,  // 원거리(높은각)일수록 전체 폭 축소 — 0.45→0.18 = 원거리에서 덜 좁아짐(레퍼런스 넓은 폭)
  aimYawMax:         0.44,  // ⚔️ 대포 조준 좌우 제한각(rad≈25°) — Q/E 조준 중 마우스 좌우 스윙 한계(카메라·밴드·실탄도 공통)
  fireGap:           0.11,  // ⚡ 포문 간 발사 간격(s) — "파파파팍" 순차(기존 45ms는 너무 빨라 동시로 보였음)
  bandAlignTol:      12,    // 밴드 착탄거리 ↔ 적 실제거리 허용오차(m). 이내 + 락온 = 초록 체크(정렬 확정)
  bandAlignSpreadMul: 0.5,  // 정렬(거리+락온) 발사 시 산포 배율(↓=더 정확)
  bandAlignDmgMul:   1.25,  // 정렬(거리+락온) 명중 데미지 배율(소폭 보너스)
  impactHitFrac:     0.04,  // 내 배 단발 피해가 maxHp의 이 비율 이상이면 피격 임팩트 카메라(흔들림) 발동

  // ── 🌊 해역 위험도 이벤트 (seaevents.js) — 위험도 = 1 - clamp(원점거리/riskMax). 중심(0,0 거대항)=1 ──
  //   ① 해적 랜덤 조우: 항해 중 확률 발동. 중심으로 갈수록 자주(centerBoost) + 함대 규모↑.
  encounter: {
    ratePerMin:  0.5,   // 항해 1분당 기본 조우 확률(외곽 기준). 위험도로 최대 (1+centerBoost)배
    centerBoost: 2.5,   // 중심 최근접 시 확률 배율(외곽 대비 최대 ×3.5) + 척수 1→2→3
    riskMax:     4200,  // 위험도 정규화 반경(m) — 이 거리 밖 = 위험도 0(외곽 안전)
    cooldownSec: 90,    // 조우 종료 후 재조우 유예(s)
    minGapSec:   20,    // 승선(항해 시작) 직후 유예(s)
  },
  //   ② 상선 약탈: near 상선 [E] → 그 자리에 약체 전투배 스폰 → 격침 시 화물 노획.
  merchant: {
    lootRange:   60,    // 약탈 프롬프트 표시 반경(m)
    promptRange: 90,    // 최근접 상선 탐지 반경(m)
    hp:          55,    // 약탈 대상(상선) 전투 HP — 해적선(120)보다 약함
    dropRate:    0.6,   // 화물 노획율(상선 적재량 대비). 화물칸 만재 시 골드 환산
    goldPer:     8,     // 노획 화물 1개당 추가 골드
    enemyFireCd: 9,     // 상선 반격 발사 간격(s, 길다=거의 안 쏨. 상선=경무장)
    enemySpread: 2.4,   // 상선 반격 산포(크다=잘 못 맞힘)
    // ── 상선 인구 유지(npc.js, 2026-07-04): 약탈해도 고갈 안 되게 + 플레이어 근처 밀도 보장(약탈 기회) ──
    fleetTarget:  32,   // 유지 목표 총 상선 수(약탈/이탈 시 이 수까지 respawn). ★26→32(전맵 밀도↑)
    hardCap:      48,   // 절대 상한(근처 밀도 스폰 폭주 방지)
    nearRadius:   550,  // 플레이어 '근처' 판정 반경(m) — 이 안 상선 수를 셈
    nearMin:      2,    // 항해 중 근처에 최소 유지할 상선 수(미만이면 근처 항로에 스폰) → 늘 약탈감 있음
    cullRadius:   1600, // target 초과분 정리 반경 — 이보다 멀고 안 보이는 상선만 순환 제거
    popIntervalSec: 2.5,// 인구 점검 주기(s)
  },
};

// ══════════════════════════════════════════════════════════════
//  7-B. 📜 배송 계약 (contract.js) — 데스 스트랜딩식. 항구 발주 → 위험 해역 목표섬 배송 → 보상.
//     보상 = baseGold × (1 + riskMul × 목표위험도) + 거리 × distMul  (+평판 QUEST_DONE +25 · 영혼)
//     위험할수록·멀수록 보수↑. 위험도 축 = 위 encounter.riskMax 공유(seaevents.riskAt).
// ══════════════════════════════════════════════════════════════
const contracts = {
  baseGold:    80,    // 기본 보수(골드)
  riskMul:     3.0,   // 목표 해역 위험도 보너스 배율(극위험 목표 = 최대 ×4 골드)
  distMul:     0.04,  // 거리(m)당 추가 골드
  soulReward:  10,    // 완수 영혼 보상(목표 위험도로 0.5~1.5배 가감)
  cooldownSec: 20,    // 완수 후 다음 의뢰 유예(s)
  offerRange:  140,   // 항구 근접 의뢰 제안 반경(m)
  arrivePad:   70,    // 목표 항구 도달 판정 여유(목표섬 반경 + 이 값)
  minDist:     500,   // 목표 최소 거리(m) — 너무 가까운 목표 제외
  maxDist:     3400,  // 목표 최대 거리(m) — 너무 먼 목표 제외
};

// ══════════════════════════════════════════════════════════════
//  8. 방어 구조물 (claim.js / destruct.js)
// ══════════════════════════════════════════════════════════════
const structures = {
  towerHp:      180,
  cannonHp:     90,
  crossbowHp:   70,    // 석궁 타워(대인 방어 — 빠름·약함)
  harborHp:     300,
  cannonShotDmg: 55,  // 공성 대포 발당 피해(구조물)
  // ── 건설 재료비(claim/wharf 아이템 투입) — SSOT. 무게=목재3·돌4/개, 소지한도 100 ──
  //   항구=거점 플래그십(방어타워 목6·돌8=무게50 > 이므로 그보다 크게). 목재 위주=부두 목조 정합.
  harborCost:   { timber: 6, stone: 4 },   // ★2026-07-04 채집 퀘스트 목표(목6·돌4=questline GOAL)와 일치 — 캔 그대로 바로 항구(사령관: 재채집 비효율 해소)
};

// ══════════════════════════════════════════════════════════════
//  8.5 점령 경제 (claim.js 통행세 — 섬 소유 메리트)
// ══════════════════════════════════════════════════════════════
const economy = {
  islandTaxPerMin: 15,   // 점령 섬 1개당 분당 금화(통행세=교역 트래픽 추상화). 소유의 지속 보상. ★25→15(2026-07-15 감사): 영구·복리 수동수입 vs 1회성 소비처 불균형 → 후반 골드 사장 완화.
  startGold: 1000,       // 🧭 시작 골드(튜토 스킵 무관 공통) — 항구 250 + 첫 배 건조 + 여유(사령관 기획 2026-07-05)
  mercCost: 300,         // 🛡 용병 모집비(항구 수비 탭) — 골드 싱크. 유지비 없음(v1, 사령관 컨펌: 모집비 1회만)
  mercCap: 4,            // 섬당 용병 상한
  mercHp: 140,           // 용병 체력 — 습격병(atk 기준)과 수 합 싸움이 성립하는 선(전사 가능 = 소모품 긴장감)
};

// ══════════════════════════════════════════════════════════════
//  8.6 습격 이벤트 (raid.js — 점령 섬 위협)
// ══════════════════════════════════════════════════════════════
const raid = {
  // ★사령관 2026-07-03: 습격은 하루(게임 하루 DAY_LENGTH=1200s=20분)에 1번 정도. 섬 2개 이상 정복해야 발동(raid.js).
  firstDelaySec: 300,   // 2섬 달성 후 첫 습격까지 유예(준비 5분)
  intervalSec:   1200,  // 습격 간격 = 게임 하루(20분). 섬 많아도 endRaid에서 하한 15분 보장.
  warnLeadSec:   14,    // 예고(배 상륙 항해) 시간
  preWarnSec:    60,    // ★사전 경보(사령관 2026-07-15): 습격선 접근(warnLeadSec) 전 이 시간만큼 미리 예고 배너 → 방어 준비(용병 모집·귀환) 시간. 0=끔(기존 동작=접근부터 예고).
  partyBase:     3,     // 기본 습격병 수
  partyPerIsle:  1,     // 점령 섬당 +습격병
  partyMax:      8,     // 상한
  repelGold:     60,    // 격퇴 보상(습격병 전멸) 금화 — 골드 인플레 완화(120→60)
};

// ══════════════════════════════════════════════════════════════
//  9. 온도 생존 (temperature.js) — 기존 CFG를 여기로 이관
// ══════════════════════════════════════════════════════════════
const temp = {
  SAFE_MIN: 8,  SAFE_MAX: 28,
  COLD_DPS: 2,  HOT_DPS: 2,
  RANGE_MIN: -12, RANGE_MAX: 42,
  ALT_LAPSE: 0.05,
  DAY_AMP: 9,
  SMOOTH: 0.5,
  BIOME: { ice:-4, small:17, mid:17, large:18 },
  WARN_EVERY: 6,
};

// ══════════════════════════════════════════════════════════════
//  예약 — 툴/무기 내구도(미구현). 구현 시 이 값 사용.
// ══════════════════════════════════════════════════════════════
const durability = {
  permanentTools:true,
  tool: { pickaxe:Infinity, axe:Infinity },
  wearPerUse: 0,
};

// ══════════════════════════════════════════════════════════════
//  8.7 거점 건물 (settlement.js — owned 섬 항구 근처에 골드로 건설, 그 섬 패시브 효과)
// ══════════════════════════════════════════════════════════════
//   ★재료 아님 = 골드 싱크(교역으로 번 골드의 소비처. economy.islandTaxPerMin과 별개로 능동 투자).
//   effect key: sellMul(교역 판매가 +) · mineMul(채광 +) · woodMul(벌목 +) · goldPerMin(패시브 수입)
//               · craftDisc(제작비 -) · repBonus(평판) · garrison(수비대 +) · defArchers(궁수 방어)
//               · guardRegen(수비대 회복 hp/s — 우물). 전부 이 파일에서만 조정.
//   ★max = 섬당 동일 건물 상한(2026-07-22 감사 B1). 없으면 무제한 → "제일 싼 goldPerMin 도배"가 최적해가 됐다.
//     합계 상한 = 1+2+2+3+1+1+1+1+2+2+1+1 = 18 ≥ 슬롯 8 → 조합의 자유는 남기되 단일 도배는 막는다.
// ══════════════════════════════════════════════════════════════
//  🏝️ 섬 크기 (worldstream.js 스트리밍 섬 · game.html 홈섬) — 유일한 조정 손잡이.
//     배경: 프리팹 배치폭이 50~5300으로 100배 편차라, canon 지름에 맞춰 축소하지 않으면 서로 겹친다.
//       (사령관 "가운데 중앙섬이 너무 크다보니까 서로 겹쳐져서 수정한 거였음")
//     그런데 x1.0(=canon 지름에 딱 맞춤)은 과했다 — 실측: 홈섬이 fit 0.456으로 눌려
//       **수면 아래 0.28m / 수면 위 30.4m**(원본 비율 1:5.9 → 1:108). 섬이 물에 박힌 게 아니라 얹혀 보인다.
//       (사령관 "섬은 해수면 바닥 밑에 깔려있으면서도 높이가 높아야 섬 아님?" — 맞는 지적)
//     겹침 실측(canon 95섬·4465쌍): x1.0=6쌍(0.13%) / x1.5=13쌍(0.29%) / x2.0=22쌍(0.49%).
//       → 1.5배까지 키워도 겹침은 0.3% 미만. 여유가 있다.
//     ⛔[[voyage-terrain-procgen-distrust]] 비균일 스케일·bottomAlign 재도입 금지. 스케일은 균일,
//       기준면은 해수면(y=0) — 그래야 해안선이 제자리에 남고 수중 뿌리 비율이 보존된다.
//     ★사령관 확정(2026-08-07): "대형섬은 가운데 겹쳐서 완전 엉망이었음. **소형섬 중형섬은 괜찮은데
//       거기서 대형섬만 줄이라니까**" → 전 tier 일괄 축소는 과잉. **large·ice만** 축소하고 small·mid는 원본 유지.
//     프리팹 배치폭 실측: large 2075~3150 · ice 4975~5300 (겹침 주범) / mid 50~550 · small 50~325 (문제없음).
//     겹침 실측(large·ice만 축소 시): x1.0=6쌍 / x1.5=8쌍 / x2.0=9쌍 / x3.0=16쌍 (총 4465쌍).
// ══════════════════════════════════════════════════════════════
//  🌫️ 원경 대기 (core.js — 안개). 사령관 확정 2026-08-07 "멀리서는 조금 흐리게 실루엣만 보여야 하지 않나?
//     아니면 엘든링 나무처럼 확실한 랜드마크는 멀리서도 보이는 형태로" → **B안(안개 + 랜드마크 관통)** 선택.
//     구 설정: Fog(sky, 600, 4000) 선형 — 2000m에서도 35%밖에 안 흐려져 원경이 또렷했다.
//     신 설정: FogExp2(거리 제곱) + **높이 기반 감쇠**. 대기는 해수면 근처가 짙으므로 산 봉우리는 안개 위로
//       솟아 실루엣이 남는다 = 엘든링 황금나무 방식. 별도 오브젝트 지정 없이 지형 높이만으로 자동 성립.
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  🌀 차원문 진입 2종 (gate.js · dungeonrun.js) — 사령관 확정 2026-08-07.
//    ① 밤에 열리는 차원문: 자정에 근처 섬 개방 + 몹 스폰(기존 동작) → [E] 입장.
//       클리어 시 **그 등급 석판 조각**이 드롭 = 조각의 유일한 공급원.
//    ② 석판으로 직접 열기: 같은 등급 조각 4개 → 석판 1개 제작 → 사용하면 그 자리에 그 등급 차원문 개방.
//       밤을 기다리지 않고 원하는 등급에 재도전할 수 있다(팰월드 던전 소환 방식).
// ══════════════════════════════════════════════════════════════
const gateSlab = {
  shardsPerSlab: 4,     // 석판 1개에 필요한 동일 등급 조각 수
  shardDrop:     1,     // 밤 던전 클리어 1회당 조각 드롭 수
  shardDropBonus: 0.35, // 추가 1개가 더 나올 확률(운 요소 — 4번 안에 못 모을 수도, 3번에 모을 수도)
};

const atmosphere = {
  //   ★높이값은 **실측 기준**(2026-08-07): 맵 재생성 후 섬의 수면 위 높이 = 스트리밍 38.8m · 홈섬 64.5m.
  //     1차에 heightRange를 260으로 잡았다가 관통량이 최대 13%밖에 안 나와 화면에 아무 변화가 없었다
  //     (극단값 0↔1 비교 캡처로 확인). 섬 실제 높이대에 맞춰 재설정.
  density:     0.00035,   // FogExp2 밀도. 클수록 빨리 흐려짐(0.0002=맑음 / 0.0005=자욱)
  heightStart: 12,        // 이 높이(m)부터 안개가 옅어지기 시작 — 해수면~해안 저지대는 안개 그대로(실루엣 바닥이 녹음)
  heightRange: 45,        // 이만큼 더 올라가면 감쇠 최대(12→57m ≈ 섬 봉우리 높이대). 넘으면 전부 최대 감쇠
  heightRelief: 0.72,     // 최대 감쇠율 0~1. 0=효과없음 / 1=완전 관통. 0.72=봉우리가 흐릿하게 비쳐 보임
};

// ★2026-08-07 맵 정본 재생성 완료(scripts/_island_rebuild.mjs) — canon r이 **실제 목표 반경**이 됐다.
//   기준 R = 소형섬 실측 중앙값 270m, tier 배수 small 1 / mid 2 / large 3 / ice 3.
//   재생성 전 실물 기준 겹침 86쌍(최악 2882) → 재배치 후 **0쌍**.
//   canon과 실물이 일치하므로 tier별 예외(구 shrinkTiers)·임의 배율(구 sizeMul)은 **필요 없다**.
//   런타임은 "프리팹 실측 반경 → canon 반경" 한 번만 맞추면 되고, 나무·광석 산포도 같은 값을 쓴다.
const island = {
  fitToCanon: true,   // 프리팹 렌더 크기를 canon 반경에 맞춘다(전 섬 동일 규칙). false=원본 크기(디버그용)
  scatterR:   0.92,   // 나무·광석 산포 반경 = canon 반경 × 이 값(가장자리 여유). ⚠️월드 단위로 환산해 쓸 것
};

// ══════════════════════════════════════════════════════════════
//  🚩 거점 깃발 (outpost.js — 팰월드式). 깃발을 꽂은 자리가 거점 중심, 반경 안에서만 거점 건물 건설.
//     섬당 1개 제한(탐험 동기) · 거점 레벨업으로 "설치 가능 깃발 수" 증가.
//     ★사령관 확정(2026-08-07): 깃발=기본재료 제작 / 섬 아무 곳에나 / 반경 경계선 표시 / 레벨업=골드+영혼+평판.
// ══════════════════════════════════════════════════════════════
const outpost = {
  cost:      { timber: 8, stone: 4, rope: 2 },   // 🚩 깃발 제작비(기본재료만 — 던전 클리어 선행조건 없음)
  radius:    46,     // 거점 반경(m) — 이 안에서만 거점 건물 건설. 건물 슬롯 링(slotRadius 18)을 여유 있게 포함
  startSlots: 1,     // 시작 거점 수(첫 섬 1개)
  maxSlots:   6,     // 절대 상한(레벨업을 다 해도 이 이상 불가)
  minGap:    140,    // 거점 간 최소 간격(m) — 같은 섬 재설치 방지 + 섬 없는 좌표계 폴백
  // 📈 거점 확장 레벨업 비용 — index = 현재 보유 슬롯 수(startSlots부터). 골드 + 토모브의 영혼 + 평판(honor) 문턱.
  //    평판은 소모하지 않고 "문턱"으로만 쓴다(신뢰/명예는 행동으로 쌓는 것이라 화폐화하면 어색).
  expand: [
    null,                                        // idx0 미사용(슬롯 0)
    { gold: 1200, soul: 20, honor: 10 },         // 1 → 2번째 거점
    { gold: 2400, soul: 45, honor: 25 },         // 2 → 3
    { gold: 4200, soul: 80, honor: 45 },         // 3 → 4
    { gold: 6800, soul: 130, honor: 70 },        // 4 → 5
    { gold: 10000, soul: 200, honor: 100 },      // 5 → 6
  ],
};

// ══════════════════════════════════════════════════════════════
//  🗡️ 몬스터 용병 (mercenary.js) — 던전 정복 시 그 던전 최강 몹 1종이 굴복해 용병 명부에 합류.
//     골드로 살 수 없는 유일 획득 경로 = 던전을 도는 이유. 배치는 garrison(수비대) 경로 공유.
// ══════════════════════════════════════════════════════════════
const mercenary = {
  cap:        8,     // 명부 상한(영입 보관 수). 배치해도 명부에는 남는다(어디 있는지 추적).
  heightScale: 0.9,  // 몬스터 원본 scale → 용병 키 배율. 야생보다 살짝 작게(아군 위압감 조절)
  minHeight:  1.6,   // 너무 작은 종(박쥐 0.75)도 알아볼 수 있게 하한
  maxHeight:  4.2,   // 대형종(골렘 5.0)도 거점을 가리지 않게 상한
};

const buildings = {
  slotRadius: 18,   // 항구(dockPoint) 중심 배치 링 반경(m)
  slotCount:  8,    // 섬당 건물 슬롯 수(상한 = Lv5). 실제 사용 가능 슬롯은 slotByLv[lv].
  // 🌱 Lv 연동 슬롯(2026-07-22 감사 B2) — Lv를 올릴 실질 이유. index = growth.lv(0~5).
  //   Lv0=4(전초기지 전) → Lv5=8. 구세이브가 상한 초과 건물을 갖고 있어도 복원은 막지 않는다(신규 건설만 차단).
  slotByLv: [4, 4, 5, 6, 7, 8],
  market:      { cost: 800,  max: 1, effect:{ sellMul: 0.15 } },   // 판매가 +15% (교역 허브 — 두 교역 길 다 이득)
  mine:        { cost: 1000, max: 2, effect:{ mineMul: 0.25 } },   // 채광 산출 +25% (생산 기지 — 생산자 길)
  lumbermill:  { cost: 900,  max: 2, effect:{ woodMul: 0.25 } },   // 벌목·목재 +25%
  home_A:      { cost: 600,  max: 3, effect:{ goldPerMin: 18 } },  // 인구 세수(패시브)
  windmill:    { cost: 700,  max: 1, effect:{ goldPerMin: 24 } },
  watermill:   { cost: 700,  max: 1, effect:{ goldPerMin: 24 } },
  blacksmith:  { cost: 1100, max: 1, effect:{ craftDisc: 0.15 } }, // 제작 비용 -15%
  church:      { cost: 800,  max: 1, effect:{ repBonus: 1 } },
  harbor:      { cost: 250,  max: 1, effect:{} },                  // ⚓ 항구 = G키 해안 즉시건설(골드 싱크). 섬 점령+배 정박/교역 관문. 효과값 없음(관문 자체가 가치)
  barracks:    { cost: 1200, max: 2, effect:{ garrison: 1 } },     // 수비대 +1 · 막사 1채당 상주 수비병 1명(garrison.place)
  archeryrange:{ cost: 1000, max: 2, effect:{ defArchers: 1 } },   // 습격 시 자동 궁수
  well:        { cost: 400,  max: 1, effect:{ guardRegen: 2 } },   // 🪣 수비대(용병·수비병) 비전투 시 회복 2hp/s — 습격 후 재건 비용 절감(감사 B5, 빈 효과 회수)
  inn:         { cost: 700,  max: 1, effect:{} },                  // 🏨 여관 = 추종자(정예 크루) 영입 거점(empire.js, crew.recruit). 패시브 효과 없음(기능 자체가 가치)
};

// ══════════════════════════════════════════════════════════════
//  🧠 AI 코어 (ai.js — 지각·공격 토큰·디렉터). 사령관 컨펌 2026-07-05 "실제 게임처럼".
// ══════════════════════════════════════════════════════════════
const ai = {
  perception: {
    fovDeg:       150,   // 시야각(도) — 이 밖(등 뒤)은 못 봄. 초근접 발소리는 예외
    noticeCloseM: 3.5,   // 발소리 반경(m) — 이 안이면 방향 무관 감지
    noticeSec:    0.5,   // 발각 딜레이(s) — 시야에 들어와도 이 시간 누적돼야 어그로(멈춰서 바라봄)
    memorySec:    6,     // 기억(s) — 시야 잃고 이 시간까지 마지막 목격지점 수색, 지나면 망각
  },
  tokens: {
    maxAttackers: 2,     // 동시 공격 허용 몹 수(아캄/둠 토큰). 나머지는 링 견제 배회
    orbitGap:     2.4,   // 비보유자 견제 링 추가 반경(m) — 근접사거리 + 이 값에서 배회
  },
  director: {
    navalMinIslands: 2,  // 해적 조우 발동 최소 점령 섬 수(§E 공정 난이도). 튜토 중엔 무조건 억제
  },
};

// ══════════════════════════════════════════════════════════════
//  🧑‍✈️ 크루 육상 지시 (crew.js — G/U 라디얼 "날 따라와/적들을 공격해/대기해")
// ══════════════════════════════════════════════════════════════
const crew = {
  // 따라와: 히스테리시스 — 멀어지면(Far) 추격 시작, 가까워지면(Near) 멈춰 자유행동/주변감시. 바짝 안 붙음(사령관 2026-07-10 "ai처럼").
  landFollowFar:  11,    // 이 거리보다 멀어지면 추격 개시(m)
  landFollowNear: 5,     // 이 거리까지 좁혀지면 추격 중단 → 대기·감시(m). Far>Near = 붙었다 떨어졌다 안 함
  landRunSpd:     4.2,   // 육상 추격 속도(m/s) — 플레이어 도보보다 살짝 빠르게(따라잡기)
  // BUG-011 제안값(2026-07-13, 라이브 미확인): Running_A는 제자리(in-place) 클립 — 재생속도가 landRunSpd 이동과
  //   안 맞으면 발이 미끄러지며(문워크 착시) "뒤로 걷는" 것처럼 보일 수 있음. crew.js가 이 배율로 run 클립
  //   timeScale을 보정. window.__crewGait(콘솔)로 실플레이 중 실시간 조정 가능 — 1.0=원래 재생속도(보정 없음).
  landGaitScale:  0.85,
  landWatchTurn:  0.7,   // 대기 중 주변 감시 회전 속도(rad/s 추종률 게인)
  landAtkRange:   36,    // 공격해: 이 반경 내 최근접 몬스터 탐색(m)
  landMeleeR:     2.6,   // 공격 사거리(m) — 이 안이면 타격 시작
  landAtkInterval:1.15,  // 타격 간격(s)
  landAtkDmg:     9,     // 타격당 기본 데미지(atkMul 적용 전, combat.damageMonster 통로 그대로 통과) — weapons.1h(9) 동급
};

export const BAL = { player, level, weapons, ranged, skills, magic, feel, monsters, gates, bossGate, dungeon, soulShop, ship, sailing, weather, naval, structures, economy, raid, temp, durability, buildings, island, atmosphere, gateSlab, outpost, mercenary, contracts, ai, crew };
export default BAL;
