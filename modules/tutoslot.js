// tutoslot.js — 중앙 튜토 팝업 단일 슬롯 조정자.
//   문제: gather(#gtuto)·combat(#tuto)·raid(#rtuto) 팝업이 전부 상단 중앙 고정 → 타이밍 겹치면 포개짐.
//   해결: 한 번에 하나만 .show. 우선순위(prio) 높은 팝업이 낮은 걸 선점(suspend) → 닫히면 낮은 게 복귀(resume).
//     · 위협성(전투·습격)=3 > 채집(passive)=1. 동률은 선점 안 함(먼저 뜬 게 유지).
//   콘센트: 각 팝업이 .show 토글 대신 ctx.tutoSlot.show(id,prio,el)/hide(id,el) 호출. 이 파일만 수정 + 3팝업 라우팅.
//   ※폴백: ctx.tutoSlot 없으면 각 팝업은 기존대로 직접 .show(무해).

export function initTutoSlot(ctx){
  const want = new Map();   // id → { prio, el }  (표시 원하는 팝업들)
  const els  = new Map();   // id → el           (hide 후에도 .show 정리용)
  let active = null;        // 현재 .show 중인 id (동시 1개)

  function apply(){
    // 표시 대기 중 최고 prio 선택(동률=먼저 등록된 것 유지 — 삽입순 Map 순회 + 엄격 비교)
    let best=null, bp=-Infinity;
    for(const [id,w] of want){ if(w.prio > bp){ bp=w.prio; best=id; } }
    if(best === active){ if(active && want.has(active)) want.get(active).el.classList.add('show'); return; }
    if(active){ const prev = want.get(active) || (els.has(active) ? { el:els.get(active) } : null); if(prev && prev.el) prev.el.classList.remove('show'); }
    active = best;
    if(active) want.get(active).el.classList.add('show');
  }

  ctx.tutoSlot = {
    // 팝업이 보이길 원함(슬롯이 실제 표시 여부 결정)
    show(id, prio, el){ if(window.__noTuto) return;   // 🧪 임시 테스트: 튜토 팝업 OFF (game.html 토글, 복구 ?tuto=1)
      if(!el) return; els.set(id, el); want.set(id, { prio:prio||1, el }); apply(); },
    // 팝업이 닫힘(슬롯 반납 → 대기 중 다음 팝업 복귀)
    hide(id, el){ const e = el || els.get(id); if(e) e.classList.remove('show'); want.delete(id); if(active===id) active=null; apply(); },
    active(){ return active; },
    // ❎ X 닫기용 — 현재 표시 중인 팝업 1개 닫기(대기 중 다음 팝업은 apply로 복귀). 재트리거되면 다시 뜸.
    dismiss(){ if(!active) return null; const was=active; const e=els.get(active); if(e) e.classList.remove('show'); want.delete(active); active=null; apply(); return was; },
  };
  console.log('[tutoslot] 중앙 튜토 팝업 단일 슬롯 등록 — 동시노출 방지 + 우선순위 선점/복귀.');
  return ctx.tutoSlot;
}
