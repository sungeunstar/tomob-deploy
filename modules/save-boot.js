// save-boot.js — 이어하기 복원과 자동저장 시작 사이의 부팅 게이트(순수 mock 테스트 가능).
export async function restoreAndStartAutosave(save, shouldRestore){
  if(!save) return {ok:false,reason:'save-unavailable'};
  let restored={ok:true,skipped:true};
  if(shouldRestore) restored=await save.restore();
  if(restored?.redirecting||restored?.ok===false) return restored;
  save.startAutosave();
  return restored===false ? {ok:false,reason:'restore-failed'} : restored;
}
