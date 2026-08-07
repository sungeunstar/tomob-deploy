// questfx.js — 퀘스트 3D 시각효과 2종.
//   ① 동료(퀘스트 발주 NPC) 머리 위 금색 느낌표(!) 빌보드 — 퀘스트 진행 중 상시(ui/quest_mark.png).
//   ② 첫 목표지점 빛기둥 — 단순 금색 수직 빛기둥(반투명 원기둥, 은은한 펄스). questline이 위치 발행.
//      (2026-07-13 밤 재작업: 이중 나선+타겟링+불티 파티클 버전 폐기 — 사령관 지시 "그냥 간단하게 빛기둥만")
//   데이터 배선: questline.js 가 window.__questStep(진행단계) + ctx.questBeam({x,z} | null, 목표 위치)을 세팅 → 이 모듈은 읽어서 그림.
//   동료 참조: ctx.crew.figureGroup() (crew.js — 오프닝/이어하기 공용 피규어). game.html에서 initCrew·initQuestline 뒤 initQuestFx(ctx).
import * as THREE from 'three';

const BEAM_H = 150;                       // 빛기둥 높이
const GOLD = new THREE.Color(0xffcf5a);   // 퀘스트 금색

export function initQuestFx(ctx){
  const scene = ctx.scene;
  if(!scene){ console.warn('[questfx] ctx.scene 없음 — 스킵'); return null; }

  // ══════════ ① 동료 머리 위 느낌표(!) 빌보드 ══════════
  let _texOK=null;
  const tex = new THREE.TextureLoader().load('/ui/quest_mark.png',
    ()=>{ _texOK=true; console.log('[questfx] ! 텍스처 로드 OK (/ui/quest_mark.png)'); },
    undefined,
    (e)=>{ _texOK=false; console.warn('[questfx] ⚠️ ! 텍스처 로드 실패 — /ui/quest_mark.png 404? 서버 재시작 필요할 수 있음', e); });
  try{ tex.colorSpace = THREE.SRGBColorSpace; }catch(_){}
  // depthTest:false = 지형/배에 가려지지 않고 항상 동료 위에 표시(클래식 MMO 퀘스트 마커).
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false, depthWrite:false, opacity:0 }));
  mark.scale.set(1.6, 3.2, 1);   // 느낌표 = 세로로 김
  mark.renderOrder = 12; mark.visible = false; scene.add(mark);
  const _fpos = new THREE.Vector3();

  function followerGroup(){ return (ctx.crew && ctx.crew.figureGroup && ctx.crew.figureGroup())
    || (ctx.follower && ctx.follower.group) || null; }

  // ══════════ ② 목표지점 빛기둥 — 단순 수직 원기둥 + 은은한 펄스(사령관 지시: "간단하게 빛기둥만") ══════════
  const BU={ uTime:{value:0}, uCol:{value:GOLD.clone()}, uOpen:{value:0} };
  const pillar=new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.2, BEAM_H, 32, 1, true), new THREE.ShaderMaterial({
    uniforms:BU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false,
    vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`varying vec2 vUv; uniform float uTime,uOpen; uniform vec3 uCol;
      void main(){
        float y=vUv.y;
        float fade=smoothstep(1.0,0.5,y)*smoothstep(0.0,0.04,y);   // 밑동 살짝 페이드, 위로 갈수록 은은히 사라짐
        float pulse=0.85+0.15*sin(uTime*1.6);
        float I=fade*pulse*uOpen;
        gl_FragColor=vec4(uCol*I*1.4, clamp(I*0.9,0.0,1.0)); }`}));
  pillar.renderOrder=10;
  const beam=new THREE.Group(); beam.add(pillar);
  beam.visible=false; scene.add(beam);
  const beamLight=new THREE.PointLight(GOLD.getHex(), 0, 140, 2); scene.add(beamLight);

  function groundY(x,z){ return (ctx.terrain && ctx.terrain.groundAt) ? ctx.terrain.groundAt(x,z,5000) : 0; }

  // ══════════ ① 느낌표 마커 — 모든 추종자(동료 NPC) 머리 위(작게, depthTest off=항상 위) ══════════
  //   ★2026-07-13 사령관 확정: 퀘스트 발주 NPC(동료) 머리 위에 '작게'. 플레이어 아님. 추종자 여럿이면 전부 동일하게.
  let _forced=false, HEAD=2.5, MW=0.34, MH=0.82; const _dbg={};
  mark.scale.set(MW, MH, 1);
  const markPool=[mark];   // 스프라이트 풀(추종자 수만큼). 머티리얼 공유(opacity 일괄 페이드).
  function getMark(i){ if(markPool[i]) return markPool[i];
    const m=new THREE.Sprite(mark.material); m.scale.set(MW,MH,1); m.renderOrder=12; m.visible=false; scene.add(m); markPool[i]=m; return m; }
  // 추종자 피규어 목록 — crew.figures()(여럿) 우선, 없으면 figureGroup()(1) / ctx.follower.group.
  function followerFigures(){
    const cr=ctx.crew;
    if(cr && cr.figures){ const a=cr.figures(); if(Array.isArray(a)) return a.filter(Boolean); }
    if(cr && cr.figureGroup){ const f=cr.figureGroup(); return f?[f]:[]; }
    if(ctx.follower && ctx.follower.group) return [ctx.follower.group];
    return [];
  }
  ctx.onUpdate(dt=>{
    const t = (BU.uTime.value += dt);

    // ── ① 느낌표: '미수락 퀘스트' 알림 전용(WoW식) — force()로만 제어 ──
    const step = (typeof window!=='undefined') ? window.__questStep : null;
    // ★버그 수정(2026-07-15, 사령관): 최초 대화([E]) 후에도 느낌표가 안 사라지던 것.
    //   원인 = questActive를 #quest.show(퀘스트 트래커 표시)에 묶어서, opening이 force(false)로 꺼도
    //   곧바로 questline이 #quest에 .show를 붙이며(=퀘스트 진행 내내 유지) 다시 켜졌음.
    //   → #quest.show 클로즈 제거. 느낌표는 오직 force(true/false)로만 켜고 끈다.
    //   흐름: opening이 말 걸기 전 force(true) → [E] 대화 순간 force(false) → 이후 퀘스트 진행 내내 OFF.
    const questActive = _forced;
    const figs = questActive ? followerFigures() : [];
    _dbg.step=step; _dbg.questActive=questActive; _dbg.followers=figs.length; _dbg.head=HEAD; _dbg.scale=[MW,MH];
    const bob = Math.sin(t*2.4)*0.12;
    mark.material.opacity = Math.max(0, Math.min(1, (mark.material.opacity||0) + (figs.length?dt*3:-dt*3)));   // 공유 페이드
    const N = Math.max(markPool.length, figs.length);
    for(let i=0;i<N;i++){ const m=getMark(i); const f=figs[i];
      if(f && f.visible!==false && mark.material.opacity>0.01){ f.getWorldPosition(_fpos); m.position.set(_fpos.x, _fpos.y+HEAD+bob, _fpos.z); m.visible=true; }
      else m.visible=false;
    }

    // ── ② 나선 마커: ctx.questBeam({x,z}) 세팅 시 그 위치에 표시 ──
    const tgt = ctx.questBeam;
    const wantBeam = !!(tgt && typeof tgt.x==='number');
    BU.uOpen.value += ((wantBeam?1:0) - BU.uOpen.value) * Math.min(1, dt*2.4);   // 부드러운 등장/소멸
    if(BU.uOpen.value>0.01){
      if(wantBeam){
        const gy = Math.max(0, groundY(tgt.x, tgt.z));   // 섬 지면(물속이면 해수면 0)
        beam.position.set(tgt.x, gy + BEAM_H*0.5, tgt.z);
        beamLight.position.set(tgt.x, gy+8, tgt.z);
      }
      beamLight.intensity = BU.uOpen.value*(30+Math.sin(t*3)*7);
      beam.visible=true; beamLight.visible=true;
    } else { beam.visible=false; beamLight.visible=false; }
  });

  ctx.questfx = { mark, beam,
    force(on=true){ _forced=on; return on; },   // 🔧 테스트: 퀘스트 없어도 강제 표시
    setScale(w,h){ MW=w; MH=h; for(const m of markPool) m.scale.set(w,h,1); return [w,h]; },   // 🔧 라이브 튜닝: 느낌표 크기(풀 전체)
    setHead(v){ HEAD=v; return HEAD; },                       // 🔧 라이브 튜닝: 머리 위 높이
    state(){ return { texLoaded:_texOK, ..._dbg, opacity:+(mark.material.opacity||0).toFixed(2), pool:markPool.length,
      forced:_forced, questBeam:ctx.questBeam||null }; },   // 🔍 진단
    dispose(){ try{ for(const m of markPool) scene.remove(m); scene.remove(beam, beamLight); }catch(_){} } };
  try{ window.__questfx = ctx.questfx; }catch(_){}
  console.log('[questfx] 퀘스트 시각효과 등록 — 동료 머리 위 ! + 목표 나선 상승 마커. 진단: window.__questfx.state() / 강제표시: __questfx.force()');
  return ctx.questfx;
}
