// tribes.js — 세계의 9종족 (=추종자, FOLLOWER_ROSTER 기반). 사령관 확정(2026-07-03):
//   ★12보석부족 폐지 → 추종자 종족을 세력으로. "내가 영입하는 추종자 = 세계의 종족 = 섬 주인"(정체성 1레이어).
//   ★2진영(남은자/파수꾼)은 이념축으로 유지 — 각 종족이 한쪽에 lean → 우호/적대 판정.
//   ★정체성 = 종족 모델(각기 다름). 깃발/배지 = 진영 문양(remnant/watch, 에셋 있음). 교역 특화 = 종족 출신.
//   모션 검증(_follower_anim_chk): 8종=내장 애니(idle/walk/attack/die) / 밀수꾼=외부 Rig_Medium(kaykit) / Polyart 3종=roles 매핑.
//   데이터 전용. raiders/capture/worldstream 이 import. 콘센트: ctx.tribes 노출(호환 위해 이름 유지).

const CHAR='/tomob-deploy/KayKit_Adventurers_2.0_FREE/Characters/gltf/';
const GRV ='/assets/kenney_all_in_one_3.4.0/3D assets/Graveyard Kit/Models/GLB format/';
const DUN ='/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Mini Dungeon/Models/GLB format/';
const MINI='/tomob-deploy/assets/kenney_mini-characters/Models/GLB format/';
const ARN ='/tomob-deploy/assets/kenney_all_in_one_3.4.0/3D assets/Mini Arena/Models/GLB format/';

// 진영별 색·문양(섬 깃발/배지). neutral은 전용 문양 없음(모델이 정체성).
const FCOL  = { remnant:'#9cc46a', watch:'#6aa0d8', neutral:'#b0a494' };
const FCREST= { remnant:'/tomob-deploy/assets/sigils/remnant.png', watch:'/tomob-deploy/assets/sigils/watch.png', neutral:null };

// Polyart 커스텀 클립명 → 표준명(monsters.js roles). 검증된 실제 클립명.
const RL_TINY = { idle:'Idle_Normal_SwordAndShield', walk:'MoveFWD_Normal_InPlace_SwordAndShield', attack:'Attack01_SwordAndShiled', die:'Die01_SwordAndShield' };
const RL_DOG  = { idle:'Idle_Battle', walk:'WalkForwardBattle', attack:'Attack01', die:'Die' };
const RL_GRUNT= { idle:'Idle', walk:'Walk', attack:'Attack01', die:'Die' };

// ── 9종족 (role: raider=습격 / trade=교역 / guard=수비) ──
const _P = [
  { id:'smuggler',   ko:'밧모 밀수꾼',    en:'Patmos Smuggler', model:CHAR+'Rogue.glb',           anim:'kaykit',                 lean:'remnant', icon:'🗡', trait:'암거래·희귀품', role:'raider',
    desc:'후드를 벗은 밧모의 밀수꾼. 어둠 속 거래에 능하다. 남은 자의 물길을 잇는다.' },
  { id:'outlander',  ko:'이방 용병',      en:'Outlander',       model:DUN+'character-orc.glb',    anim:'kenney',                 lean:'remnant', icon:'🪓', trait:'무기·용병',    role:'raider',
    desc:'먼 봉우리에서 온 이방인 용병. 갑판의 방패이자 앞장서는 창이다.' },
  { id:'brawler',    ko:'봉우리 투사',    en:'Peak Brawler',    model:'/tomob-deploy/GruntPolyart.glb',        anim:'polyart', roles:RL_GRUNT,lean:'remnant', icon:'💪', trait:'전투물자',     role:'raider',
    desc:'먼 봉우리에서 온 거친 전사. 앞장서 적을 들이받는다.' },
  { id:'drifter',    ko:'떠돌이 검사',    en:'Drifter',         model:'/tomob-deploy/TinyHero.glb',            anim:'polyart', roles:RL_TINY, lean:'remnant', icon:'🌫', trait:'잡화·용병',    role:'raider',
    desc:'아라랏으로 흘러든 이름 없는 떠돌이. 어디에도 매이지 않는다.' },
  { id:'trader',     ko:'봉우리 상인',    en:'Peak Trader',     model:DUN+'character-human.glb',  anim:'kenney',                 lean:'neutral', icon:'⚖', trait:'교역품·시세',  role:'trade',
    desc:'밧모 해역을 떠도는 봉우리 상인. 시세를 읽어 값을 매긴다.' },
  { id:'castaway',   ko:'표류자',         en:'Castaway',        model:MINI+'character-male-b.glb',anim:'kenney',                 lean:'neutral', icon:'🌊', trait:'생필품·식량',  role:'trade',
    desc:'차오르는 바다를 피해 아라랏으로 온 피난민. 살아남는 법을 판다.' },
  { id:'warden',     ko:'스올 문지기',    en:'Sheol Warden',    model:GRV+'character-keeper.glb', anim:'kenney',                 lean:'watch',   icon:'🔗', trait:'유물·영혼',    role:'guard',
    desc:'스올의 문을 지키던 자. 망자의 길과 안개를 안다. 별을 지키는 파수꾼.' },
  { id:'strayknight',ko:'들개 기사',      en:'Stray Knight',    model:'/tomob-deploy/DogPolyart.glb',          anim:'polyart', roles:RL_DOG,  lean:'watch',   icon:'🐕', trait:'방어구·충성',  role:'guard',
    desc:'주인 잃은 봉우리의 충직한 기사. 맡은 봉우리를 끝까지 지킨다.' },
  { id:'sunkenguard',ko:'잠긴 왕국 병사', en:'Sunken Guard',    model:ARN+'character-soldier.glb',anim:'kenney',                 lean:'watch',   icon:'⚔', trait:'무기·갑옷',    role:'guard',
    desc:'바다에 잠긴 봉우리 왕국의 최후 병사. 무너진 맹세를 아직 지킨다.' },
];
// 종족별 특산 교역품(그 섬에서 싸게 매수 → 타지에 매도 = 차익). 현 교역품 4종(rum/silk/spice/gem)에 매핑.
//   ※동일섬 매수=매도 대칭가라 exploit 없음(그 섬은 그 품목이 그냥 쌈). 추후 종족 테마 전용 교역품으로 확장 여지.
const GOOD = { smuggler:'gem', outlander:'spice', brawler:'rum', drifter:'silk', trader:'silk', castaway:'rum', warden:'gem', strayknight:'silk', sunkenguard:'spice' };

// ── 추종자 영입(축4): role → 평판 축 매핑 + role 그룹 내 계단식 영입 문턱값 ──
//   crew.js/capture.js가 import. trade=신뢰(trust) / raider=악명(infamy) / guard=명예(honor).
//   문턱값: 각 role 그룹 안에서 배열 순서대로 30 → 55 → 80 → 105 계단식(첫 종족이 제일 쉽게 합류).
export const ROLE_AXIS = { trade:'trust', raider:'infamy', guard:'honor' };
const RECRUIT_BASE = 30, RECRUIT_STEP = 25;

// 색·문양·특산 파생 + role 그룹 내 순번 기반 recruitThreshold 주입(capture.js가 .gem/.recruitThreshold 참조).
const _roleSeen = {};
export const TRIBES = _P.map(p => {
  const n = (_roleSeen[p.role] = (_roleSeen[p.role] || 0) + 1) - 1;   // role 그룹 내 0-based 순번
  return { ...p, gem: FCOL[p.lean], crest: FCREST[p.lean], good: GOOD[p.id],
    recruitThreshold: RECRUIT_BASE + n * RECRUIT_STEP };
});

// ── 2진영 (voyage ?faction=remnant/watch) ──
export const FACTIONS = {
  remnant: { id:'remnant', ko:'남은 자', en:'THE REMNANT',  color:FCOL.remnant, crest:FCREST.remnant, goal:'열두 분깃을 모아 별을 부순다',
    note:'별을 부숴 가라앉은 대륙을 되돌리려는 자들. 차오르는 바다와 시간을 다툰다.' },
  watch:   { id:'watch',   ko:'파수꾼',  en:'THE WATCHMEN', color:FCOL.watch,   crest:FCREST.watch,   goal:'분깃을 흩어 심판을 기다린다',
    note:'첫 별을 지키고 둘째 별의 심판을 기다리는 자들. 정해진 종말을 거스르지 않는다.' },
};

// ── 습격 세력: role==='raider' 종족(남은자 성향 4종) ──
export const RAIDER_TRIBE_IDS = TRIBES.filter(t => t.role === 'raider').map(t => t.id);

// ── 헬퍼(기존 이름 유지 — raiders/capture/worldstream 호환) ──
const _byId = Object.fromEntries(TRIBES.map(t => [t.id, t]));
export function tribeById(id){ return _byId[id] || null; }
export function sigilUrl(id){ const t=_byId[id]; return t ? t.crest : null; }   // 진영 문양(없으면 null=모델이 정체성)
export function factionColor(lean){ return FCOL[lean] || FCOL.neutral; }
export function tribesByLean(lean){ return TRIBES.filter(t => t.lean === lean); }
export function raiderTribes(){ return TRIBES.filter(t => t.role === 'raider'); }

export function initTribes(ctx){
  ctx.tribes = { TRIBES, FACTIONS, RAIDER_TRIBE_IDS, ROLE_AXIS, tribeById, sigilUrl, factionColor, tribesByLean, raiderTribes };
  console.log('[tribes] 9종족(추종자) + 2진영 등록 — 습격', RAIDER_TRIBE_IDS.join(','), '· 교역', TRIBES.filter(t=>t.role==='trade').map(t=>t.id).join(','), '· 수비', TRIBES.filter(t=>t.role==='guard').map(t=>t.id).join(','));
  return ctx.tribes;
}
