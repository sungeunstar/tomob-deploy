// class-progression.js — 🗡️ 플레이어 직업 정체성 SSOT.
//   ⚠️복구 파일(2026-08-07): 트랙03(직업 유지·성장 정합)이 이 모듈을 만들고 select.html이 import하도록 바꿨는데,
//     이후 롤백이 이 파일만 지우고 select.html의 import 줄은 남겨둬서 **select.html 전체 스크립트가 죽어 있었다**
//     (모듈 404 → `<script type="module">` 미실행 → 배경만 뜨고 캐릭터 선택 UI가 안 나옴 = "게임 실행이 안 됨").
//     값은 git HEAD의 select.html CLASS_ROSTER 원본에서 그대로 복원 — 새로 지어내지 않았다.
//
//   ★코드 id는 불변(knight/barbarian/mage/ranger/rogue_hooded) — 모델·애니·궁극기·`?char=` 배선이 전부 이 id를 쓴다.
//     표시명만 사령관 확정값(2026-06-30): 기사→팔라딘 · 전사→버서커 · 마법사→룬마스터 · 레인저→헌터 · 로그→쉐도우블레이드.

export const CLASSES = {
  knight:       { id:'knight',       name:'팔라딘',       en:'Paladin',     subtitle:'점령 · 방어' },
  barbarian:    { id:'barbarian',    name:'버서커',       en:'Berserker',   subtitle:'약탈 · 돌파' },
  mage:         { id:'mage',         name:'룬마스터',     en:'Runemaster',  subtitle:'해상 포격 · 주술' },
  ranger:       { id:'ranger',       name:'헌터',         en:'Hunter',      subtitle:'항해 · 정찰' },
  rogue_hooded: { id:'rogue_hooded', name:'쉐도우블레이드', en:'Shadowblade', subtitle:'교역 · 밀수' },
};

// 구 저장분·URL 별칭 → 현재 코드 id. 'rogue'는 rogue_hooded로 이관(플레이어 직업은 후드형 하나).
const ALIAS = { rogue:'rogue_hooded', rogue_hood:'rogue_hooded', hooded:'rogue_hooded' };

/** 알 수 없는/구버전 직업 id를 현재 id로 정규화. 매칭 실패 시 knight 폴백(부팅을 막지 않는다). */
export function normalizeClassId(id){
  const k = String(id || '').trim().toLowerCase();
  if(CLASSES[k]) return k;
  if(ALIAS[k] && CLASSES[ALIAS[k]]) return ALIAS[k];
  return 'knight';
}

/** 정규화된 직업 정의 조회(항상 유효한 객체 반환). */
export function classOf(id){ return CLASSES[normalizeClassId(id)]; }

export const CLASS_IDS = Object.keys(CLASSES);
