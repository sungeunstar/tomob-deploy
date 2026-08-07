// waterfallfx.js — 폭포 + 물웅덩이. 지하 2층 폭포 대홀(buildCascadeHall)용.
// ─────────────────────────────────────────────────────────────────────────────
// ★정본 참조(/vfx 규율):
//   · 물/포말 = `modules/water.js` — Gerstner 파고 + 마루 흰거품(crest foam) + 프레넬 알파. 여기선 **잔잔한 실내 웅덩이**라
//     Gerstner 진폭을 크게 줄이고, 대신 **폭포 낙하 지점에서 퍼지는 파문**을 주축으로 삼는다.
//   · fbm 노이즈 스크롤 = `modules/gate.js` NOISE(값노이즈 5옥타브). 결을 던전 다른 VFX와 통일한다.
// ⛔ 단색 MeshBasic Plane 금지(사령관 "짜친다"). 전부 ShaderMaterial + fbm + 애니메이션.
//
// 구조:
//   ① sheet : 떨어지는 물줄기. 세로 스크롤 fbm으로 **길게 늘어진 물살**, 가장자리는 흩어져 페이드.
//   ② crest : 물이 턱을 넘는 지점의 밝은 마루.
//   ③ mist  : 낙하 지점에서 피어오르는 물안개(additive, 위로 흐름).
//   ④ pool  : 웅덩이 수면 — 낙하점에서 퍼지는 동심 파문 + 잔결 + 프레넬.
//   ⑤ light : 상주 PointLight 1개(add/remove 반복 = 셰이더 재컴파일 폭탄 → 금지).
import * as THREE from 'three';

const NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+11.7;a*=.5;}return v;}
`;
const VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
// 수면은 월드 좌표가 필요하다(파문 중심을 월드로 잡아야 카메라와 무관하게 고정된다).
const VS_W = `varying vec2 vUv; varying vec3 vW;
  void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

/**
 * @param {object} o  w 폭(m) · h 낙하 높이(m) · poolW/poolD 웅덩이 크기 · dir 물줄기가 바라보는 방향(rad)
 * @returns { group, update(dt), dispose() }
 */
export function createWaterfall(o = {}){
  const W = o.w || 7, H = o.h || 27;
  const group = new THREE.Group();
  const U = { uTime:{ value:0 }, uH:{ value:H }, uW:{ value:W } };

  // ── ① 떨어지는 물줄기 ──
  //   세로로 아주 길게 늘인 노이즈 = 물살 가닥. 아래로 갈수록 빨라지고(중력) 흩어진다.
  const sheetMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, vertexShader: VS,
    fragmentShader: NOISE + `
      varying vec2 vUv; uniform float uTime,uH,uW;
      void main(){
        float x = vUv.x*2.0-1.0;            // -1..1 (가로)
        float y = 1.0 - vUv.y;              // 0=위(마루) → 1=아래(착수)
        // 낙하 가속 — 아래로 갈수록 결이 빨리 흐르고 세로로 더 늘어난다.
        float sp = 0.9 + 1.9*y;
        vec2 nc = vec2(x*7.0, vUv.y*2.2 - uTime*sp*1.35);
        float s1 = fbm(nc);
        float s2 = fbm(nc*2.6 + vec2(7.3, -uTime*sp*0.9));
        float streak = smoothstep(0.24, 0.80, s1*0.6 + s2*0.4);
        // 가장자리 — 위는 폭이 좁고 아래로 갈수록 퍼지며 흩어진다.
        float spread = 0.72 + 0.28*y;
        float edge = smoothstep(spread, spread*0.62, abs(x));
        float frayed = edge * (0.55 + 0.45*streak);          // 가장자리가 결에 따라 너덜해짐
        // 착수 직전은 안개에 먹혀 흐려진다.
        float bottomFade = smoothstep(1.0, 0.82, y);
        float I = (0.30 + 0.70*streak) * frayed * bottomFade;
        vec3 water = mix(vec3(0.42,0.62,0.74), vec3(0.90,0.96,1.0), streak*0.85);
        gl_FragColor = vec4(water, clamp(I*0.92, 0.0, 1.0));
      }`
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 1, 1), sheetMat);
  sheet.position.y = H/2; sheet.renderOrder = 3; group.add(sheet);

  // ── ② 마루 — 물이 턱을 넘는 지점. 여기만 밝고 두껍다.
  const crestMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.AdditiveBlending, vertexShader: VS,
    fragmentShader: NOISE + `
      varying vec2 vUv; uniform float uTime;
      void main(){
        float x = vUv.x*2.0-1.0;
        float n = fbm(vec2(x*6.0, -uTime*1.6))*0.6 + fbm(vec2(x*13.0, -uTime*2.4))*0.4;
        float lip = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.6, vUv.y);   // 마루 띠
        float edge = smoothstep(0.95, 0.6, abs(x));
        float I = lip*edge*(0.35 + 0.65*smoothstep(0.3,0.8,n));
        gl_FragColor = vec4(vec3(0.86,0.94,1.0)*I, clamp(I,0.0,1.0));
      }`
  });
  const crest = new THREE.Mesh(new THREE.PlaneGeometry(W*1.06, 2.6, 1, 1), crestMat);
  crest.position.y = H - 0.6; crest.position.z = 0.05; crest.renderOrder = 4; group.add(crest);

  // ── ③ 물안개 — 착수 지점에서 피어오름. additive라 어두운 동공에서 은은히 빛난다.
  const mistMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.AdditiveBlending, vertexShader: VS,
    fragmentShader: NOISE + `
      varying vec2 vUv; uniform float uTime;
      void main(){
        vec2 p = vUv*2.0-1.0;
        float n = fbm(vec2(p.x*2.4, p.y*1.5 - uTime*0.42))*0.62 + fbm(vec2(p.x*5.5, p.y*3.0 - uTime*0.7))*0.38;
        float puff = smoothstep(0.34, 0.86, n);
        float rise = smoothstep(1.0, -0.15, p.y);        // 위로 갈수록 옅어짐
        float side = smoothstep(1.0, 0.15, abs(p.x));
        float I = puff*rise*side*0.36;
        gl_FragColor = vec4(vec3(0.72,0.84,0.94)*I, clamp(I,0.0,1.0));
      }`
  });
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(W*2.4, 9, 1, 1), mistMat);
  mist.position.y = 3.4; mist.position.z = 0.6; mist.renderOrder = 5; group.add(mist);

  // ── ⑤ 광원 — 상주 1개. 착수 지점을 은은히 밝혀 폭포가 어둠에 묻히지 않게.
  const light = new THREE.PointLight(0x9ad0ee, 9, 34, 2);
  light.position.set(0, 3.0, 1.2); light.userData._base = 9; group.add(light);

  const mats = [sheetMat, crestMat, mistMat];
  return {
    group, U, light,
    update(dt){ U.uTime.value += dt;
      // 착수 광원이 물살에 따라 미세하게 흔들린다(빛과 그림이 따로 놀지 않게)
      light.intensity = 9 * (0.86 + 0.14*Math.sin(U.uTime.value*3.1));
    },
    dispose(){ sheet.geometry.dispose(); crest.geometry.dispose(); mist.geometry.dispose(); for(const m of mats) m.dispose(); },
  };
}

/**
 * 물웅덩이 수면 — 폭포 착수점에서 퍼지는 파문이 주축. 잔잔한 실내 물.
 * @param {object} o  w,d 크기 · impact {x,z}(수면 로컬 좌표) 낙하 지점
 */
export function createPool(o = {}){
  const w = o.w || 40, d = o.d || 40;
  const U = {
    uTime: { value: 0 },
    uImpact: { value: new THREE.Vector2(o.impact ? o.impact.x : 0, o.impact ? o.impact.z : 0) },
    uSize: { value: new THREE.Vector2(w, d) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, vertexShader: VS_W,
    fragmentShader: NOISE + `
      varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform vec2 uImpact,uSize;
      void main(){
        vec2 p = (vUv-0.5)*uSize;                       // 수면 로컬 좌표(m)
        float r = length(p - uImpact);
        // ★파문 — 착수점에서 바깥으로 퍼지는 동심파. 거리에 따라 감쇠하고 파장이 늘어난다(실제 물결처럼).
        float ring = sin(r*0.85 - uTime*2.6) * exp(-r*0.055);
        float ring2 = sin(r*1.9 - uTime*4.1) * exp(-r*0.11) * 0.5;
        float wave = (ring + ring2);
        // 잔결 — water.js의 마루 포말 개념을 실내용으로 축소. fbm 두 겹이 서로 다른 속도로 흐른다.
        float fn = fbm(p*0.22 + vec2(uTime*0.06, -uTime*0.04))*0.6
                 + fbm(p*0.55 - vec2(uTime*0.09, uTime*0.05))*0.4;
        float ripple = wave*0.5 + (fn-0.5)*0.55;
        // 착수점 흰 거품 — 폭포가 때리는 곳은 하얗게 부서진다.
        float foam = smoothstep(7.0, 1.2, r) * (0.45 + 0.55*fbm(p*1.1 + vec2(0.0,-uTime*1.5)));
        foam = clamp(foam, 0.0, 1.0);
        // 프레넬 — 비스듬히 볼수록 반사가 강해 물처럼 보인다(water.js와 같은 처리).
        vec3 vd = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(vd.y, 0.0, 1.0), 2.6);
        vec3 deep = vec3(0.055,0.135,0.175), shallow = vec3(0.16,0.34,0.40);
        vec3 col = mix(deep, shallow, clamp(0.42 + ripple*0.75, 0.0, 1.0));
        col = mix(col, vec3(0.62,0.78,0.86), fres*0.72);
        col = mix(col, vec3(0.90,0.95,0.99), foam*0.8);
        float a = clamp(0.66 + fres*0.3 + foam*0.3, 0.0, 0.97);
        gl_FragColor = vec4(col, a);
      }`
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), mat);
  mesh.rotation.x = -Math.PI/2; mesh.renderOrder = 2;
  return { mesh, U, update(dt){ U.uTime.value += dt; }, dispose(){ mesh.geometry.dispose(); mat.dispose(); } };
}
