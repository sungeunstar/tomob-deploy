// torch.js — 🔥 횃불 불빛 + 불꽃 VFX. 횃불(LOADOUT 'torch') 장착 중일 때 점화.
//   ★밤 가시성 게임메커닉: 밤은 어둡게 두고, 횃불을 들면 주변이 제대로 보인다.
//   ① 빛  = 따뜻한 주황 PointLight(감쇠·깜빡임, cave.js 랜턴 패턴). 손 높이 추종.
//   ② 불꽃 = volfire.js 볼류메트릭(레이마칭 GLSL, 열 램프). 횃불 끝(쇠바구니)에 위치, 항상 세로(불은 위로 상승).
//   위치/크기는 __torchTune(y,z,s) 또는 ctx.torch.tune 으로 라이브 조정(모델 확정 후 값 고정).
//   의존: ctx.scene · ctx.camera · ctx.player(currentTool·pos·heldR·vmModel·isThird) · ctx.onUpdate.
import * as THREE from 'three';
import { makeVolFire } from '/tomob-deploy/modules/volfire.js';

export function initTorch(ctx){
  const COL   = new THREE.Color(0xffa24a);
  const RANGE = 24, BASE = 9.5;
  const light = new THREE.PointLight(COL, 0, RANGE, 2.0);
  light.castShadow = false; light.visible = true;   // ★항상 상주·visible(intensity 0=꺼진 효과). visible 토글=씬 전체 셰이더 재컴파일 히칫이라 금지([[voyage-light-recompile-trap]]).
  ctx.scene.add(light);

  // ── 🔥 볼류메트릭 불꽃 (레이마칭, 손 횃불용 경량 iterations) ──
  const FLAME = { tipY: 0.30, tipZ: 0.0, scale: 0.30 };   // 손 위 tip 오프셋 + 가로크기(튜닝 지점)
  const VF_EXP = 1.75;          // 기본 노출(밝기) — lvl로 페이드
  const VF_ASPECT = 2.0;        // 세로/가로 비(횃불 불은 갸름하게)
  const flame = makeVolFire({ color:0xffe6c0, iterations:14, exposure:VF_EXP });
  flame.frustumCulled=false; flame.visible=false;
  ctx.scene.add(flame);

  let lvl = 0, t = 0;
  const _lit = () => ctx.player && ctx.player.currentTool === 'torch';
  const _tip = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3();

  // 손(든 모델) 월드좌표 + 월드-up 오프셋 = 쇠바구니(불꽃) 위치. 손 회전축은 무시(항상 위로).
  function tipWorld(out){
    const pl = ctx.player; if(!pl) return false;
    const m = pl.isThird ? pl.heldR : (pl.vmModel || pl.heldR);
    if(m){ m.updateWorldMatrix(true,false); m.getWorldPosition(out); m.getWorldQuaternion(_q);
      _up.set(0,1,0).applyQuaternion(_q);                 // 막대(모델 +Y) 방향 = 비스듬해도 막대 끝으로
      out.addScaledVector(_up, FLAME.tipY); return true; }
    const p=pl.pos; out.set(p.x, p.y+1.3+FLAME.tipY, p.z); return true;   // 폴백: 손 높이
  }

  ctx.onUpdate(dt => {
    dt = dt ?? 0.016; t += dt;
    const on = _lit();
    lvl += ((on ? 1 : 0) - lvl) * Math.min(1, dt * 7);
    if (lvl < 0.003 && !on){ light.intensity=0; flame.visible=false; return; }   // ★intensity만 0(visible 토글 금지=재컴파일 방지). 라이트는 상주.
    const flick = 0.84 + Math.sin(t*7.3)*0.10 + Math.sin(t*13.1 + 1.3)*0.05 + (Math.random()-0.5)*0.06;
    // 빛 = 손 높이(+tip 약간 위) 추종
    if (ctx.player){ const p = ctx.player.pos; light.position.set(p.x, p.y + 1.3 + FLAME.tipY*0.6, p.z); }
    light.intensity = BASE * lvl * flick;
    // 🔥 볼류메트릭 불 = 든 모델 tip에 세로로(불은 항상 위로 상승) 배치. lvl로 노출 페이드.
    if(tipWorld(_tip)){
      const s = FLAME.scale * (0.9 + 0.12*flick);
      flame.scale.set(s, s*VF_ASPECT*(0.94+0.08*Math.sin(t*9.0)), s);
      flame.position.set(_tip.x, _tip.y + flame.scale.y*0.5, _tip.z);   // 박스 바닥=tip → 불 밑동이 막대 끝
      flame.rotation.set(0,0,0);
      flame.material.uniforms.exposure.value = VF_EXP * lvl;
      flame.visible = true;
      flame.update(t);
    } else flame.visible=false;
  });

  ctx.torch = {
    get lit(){ return _lit(); }, get level(){ return lvl; }, light, flame,
    tune(y,z,s){ if(y!=null)FLAME.tipY=+y; if(z!=null)FLAME.tipZ=+z; if(s!=null)FLAME.scale=+s; return {...FLAME}; },
  };
  console.log('[torch] 횃불 불빛+불꽃 준비 — currentTool==="torch" 시 점화.');
  return ctx.torch;
}
