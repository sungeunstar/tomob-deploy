// seabed.js — 해저 바닥 = 월드 전역 보편 평면(사령관 확정). 섬 위치와 무관, 모든 것 아래를 덮는 고정 낮은 Y 바닥.
//   ① 비주얼: water.js처럼 카메라 추종하는 모래 평면(고정 Y=level). 은은한 사구는 월드좌표 셰이더 변위(카메라 이동에 불변).
//      three 표준 재질 → 씬 안개(수중 청록 murk)가 그대로 먹혀 먼 바닥은 자연 페이드.
//   ② 물리: 큰 static cuboid 콜라이더 1개(평평한 바닥) — 잠수해 내려가면 여기 안착. 트라이메시 불필요.
import * as THREE from 'three';

export function initSeabed(ctx, { level=-25, size=1000, seg=120, collider=true }={}){
  const { scene, camera, onUpdate, world, RAPIER } = ctx;

  // ── ① 비주얼 평면(카메라 추종) ──
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI/2);   // XZ 평면(법선 +Y)
  const mat = new THREE.MeshStandardMaterial({
    color:0xc2b087, roughness:1.0, metalness:0.0, side:THREE.DoubleSide,   // 밝은 모래(수중 안개가 muted)
  });
  // 은은한 사구(월드좌표 기반) + 마루/골 톤 변조. 카메라 따라와도 지형이 흐르지 않음.
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vSand;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 _wp = (modelMatrix * vec4(position,1.0)).xyz;
        float _d = sin(_wp.x*0.028)*1.9 + cos(_wp.z*0.024)*1.6
                 + sin((_wp.x+_wp.z)*0.014)*1.1 + sin(_wp.x*0.09+_wp.z*0.065)*0.5;   // 완만한 사구
        transformed.y += _d;
        vSand = clamp(0.5 + _d*0.16, 0.0, 1.0);
      `);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vSand;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.74, 1.06, vSand);   // 골(젖은 어두운 모래)↔마루(밝은 모래)
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = level;
  mesh.renderOrder = -2;   // water(-1)보다 먼저(아래) — 투명 수면 뒤로 비침
  scene.add(mesh);
  onUpdate(()=>{ mesh.position.set(camera.position.x, level, camera.position.z); });   // 카메라 xz 추종

  // ── ② 물리: 큰 static cuboid 바닥 1개 ──
  let floorBody=null;
  if(collider && world && RAPIER){
    try{
      const HALF=6000, TH=2;   // 12km × 12km, 두께 4m. 윗면이 level에 오도록 중심 = level-TH.
      floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, level-TH, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(HALF, TH, HALF), floorBody);
    }catch(e){ console.warn('[seabed] 콜라이더 생성 실패', e&&e.message); }
  }

  ctx.seabed = { mesh, mat, level, floorBody, heightAt(){ return level; } };
  return ctx.seabed;
}
