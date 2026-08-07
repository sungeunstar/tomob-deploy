// fxpool.js — 공용 FX 풀/텍스처 유틸 (리팩토링 R1 — 복붙 4벌 통합. 근거=_REFACTOR_점검.md)
// ⚡ 라이트 풀 원칙([[voyage-light-recompile-trap]]): PointLight는 init 때 n개 씬 상주(intensity 0) —
//    이후 add/remove·visible 토글 일체 금지(라이트 개수 변동 = 씬 전체 머티리얼 셰이더 재컴파일 폭탄).
//    grab=슬롯 점유, release=소등+파킹(-999)+반납. 고갈 시 null(호출부가 빛만 생략).
//    ※각 모듈이 자기 풀을 기존과 동일 개수로 생성 → 씬 라이트 총수·수명 불변(2026-07-03~04 수술 의미 보존).
import * as THREE from 'three';

// ── ① 상주 PointLight 풀 — cannon(5)/shipwreck(6)/monsters(8)/magic(8) 4벌 → 1벌 ──
export function createLightPool(scene, n, { color=0xffffff, distance=10, decay=2 }={}){
  const slots=[];
  for(let i=0;i<n;i++){ const L=new THREE.PointLight(color, 0, distance, decay); L.position.set(0,-999,0); scene.add(L); slots.push({ light:L, busy:false }); }
  return {
    slots,
    grab(){ const s=slots.find(s=>!s.busy); if(s) s.busy=true; return s||null; },
    release(s){ if(!s) return; s.light.intensity=0; s.light.position.set(0,-999,0); s.busy=false; },
  };
}

// ── ② visible 토글 오브젝트 풀(스프라이트/링 메시 등) — make(i)가 Object3D 반환, 숨김 파킹 후 상주 ──
export function createVisiblePool(scene, n, make){
  const items=[];
  for(let i=0;i<n;i++){ const o=make(i); o.visible=false; o.position.set(0,-999,0); scene.add(o); items.push(o); }
  return {
    items,
    grab(){ return items.find(o=>!o.visible)||null; },   // 사용측이 visible=true로 점유 표시
    park(o){ if(!o) return; o.visible=false; o.position.set(0,-999,0); },
  };
}

// ── ③ busy 슬롯 풀(복합 키트 — monsters 스폰FX 등) — make(i)가 슬롯 객체 반환, 숨김/파킹은 호출부 책임 ──
export function createSlotPool(n, make){
  const slots=[];
  for(let i=0;i<n;i++){ const s=make(i); s.busy=false; slots.push(s); }
  return {
    slots,
    grab(){ const s=slots.find(s=>!s.busy); if(s) s.busy=true; return s||null; },
    release(s){ if(s) s.busy=false; },
  };
}

// ── ④ 라디얼 그라디언트 캔버스 텍스처 팩토리 — 6벌 보일러플레이트 통합 ──
//    stops=[[offset,'rgba(...)'],...] — 색스톱은 호출부 값 그대로(비주얼 불변).
//    옵션: inner/edge=그라디언트 반경, circle=사각 fill 대신 원형(shipwreck), srgb=colorSpace 지정.
export function radialTexture(size, stops, { inner=0, edge=size/2, circle=false, srgb=false }={}){
  const cv=document.createElement('canvas'); cv.width=cv.height=size; const g=cv.getContext('2d');
  const c=size/2, grd=g.createRadialGradient(c,c,inner,c,c,edge);
  for(const s of stops) grd.addColorStop(s[0], s[1]);
  g.fillStyle=grd;
  if(circle){ g.beginPath(); g.arc(c,c,edge,0,Math.PI*2); g.fill(); } else g.fillRect(0,0,size,size);
  const t=new THREE.CanvasTexture(cv); if(srgb) t.colorSpace=THREE.SRGBColorSpace; return t;
}
