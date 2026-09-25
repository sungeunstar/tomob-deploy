// volfire.js — 🔥 mattatz 볼류메트릭 Fire (three r160 포팅)
//   원본: mattatz/THREE.Fire (레이마칭 절차적 볼류메트릭 불). _Fire.src.js / _FireShader.src.js.
//   r160 이식점: Matrix4.getInverse() 제거 → copy().invert(). ShaderMaterial은 cameraPosition/modelMatrix 자동 주입.
//   쓰임: 모닥불(campfire.js)·횃불(torch.js) — 밤에 가까이 오래 보는 불(빌보드 판때기 대체).
//   불 텍스처(반경↔높이 프로파일) = /_fire_mattatz2.png (핫코어 바닥중심 → 위/바깥 감쇠).
import * as THREE from 'three';

// ── 공유 불 텍스처 (한 번만 로드) ──
let _tex = null;
function fireTex(){
  if(_tex) return _tex;
  _tex = new THREE.TextureLoader().load('/tomob-deploy/_fire_mattatz2.png');
  _tex.magFilter = _tex.minFilter = THREE.LinearFilter;
  _tex.wrapS = _tex.wrapT = THREE.ClampToEdgeWrapping;
  _tex.colorSpace = THREE.SRGBColorSpace;
  return _tex;
}

const VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main(){
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  }`;

// cameraPosition·modelMatrix 등은 three가 ShaderMaterial 프리픽스로 자동 주입.
const FRAG = /* glsl */`
  uniform vec3 color;
  uniform float time;
  uniform float seed;
  uniform mat4 invModelMatrix;
  uniform vec3 scale;
  uniform vec4 noiseScale;
  uniform float magnitude;
  uniform float lacunarity;
  uniform float gain;
  uniform float exposure;
  uniform sampler2D fireTex;
  varying vec3 vWorldPos;

  // ── ashima simplex noise 3D ──
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float turbulence(vec3 p){
    float sum = 0.0, freq = 1.0, amp = 1.0;
    for(int i = 0; i < OCTIVES; i++){
      sum += abs(snoise(p * freq)) * amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum;
  }

  // 텍스처는 불의 형상/밀도만 제공(r=밀도). 색은 열 램프로 생성.
  vec4 samplerFire(vec3 p, vec4 sc){
    vec2 st = vec2(sqrt(dot(p.xz, p.xz)), p.y);
    if(st.x <= 0.0 || st.x >= 1.0 || st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
    float h = st.y;                       // 원본 높이(열 낙차용, 난류 전)
    p.y -= (seed + time) * sc.w;
    p *= sc.xyz;
    st.y += sqrt(st.y) * magnitude * turbulence(p);
    if(st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
    float dens = texture2D(fireTex, st).r;
    return vec4(dens, h, 0.0, dens);      // r=밀도, g=바닥부터의 높이(열)
  }

  vec3 localize(vec3 p){ return (invModelMatrix * vec4(p, 1.0)).xyz; }

  // 열(밀도·높이) → 실제 불 색: 바닥 흰-노랑 코어 → 주황 → 붉은 끝
  vec3 fireRamp(float dens, float hgt){
    // 아래일수록·짙을수록 뜨겁게. hgt 0=바닥(뜨겁), 1=위(식음)
    float heat = clamp(dens * 1.15 - hgt * 0.55, 0.0, 1.0);
    vec3 red  = vec3(0.72, 0.06, 0.015);
    vec3 orng = vec3(1.0, 0.42, 0.08);
    vec3 yell = vec3(1.0, 0.82, 0.32);
    vec3 core = vec3(1.0, 0.97, 0.82);
    vec3 c = mix(red, orng, smoothstep(0.10, 0.45, heat));
    c = mix(c, yell, smoothstep(0.42, 0.72, heat));
    c = mix(c, core, smoothstep(0.72, 0.95, heat));
    return c;
  }

  void main(){
    vec3 rayPos = vWorldPos;
    vec3 rayDir = normalize(rayPos - cameraPosition);
    float rayLen = 0.0288 * length(scale.xyz);
    float dens = 0.0, hsum = 0.0;
    for(int i = 0; i < ITERATIONS; i++){
      rayPos += rayDir * rayLen;
      vec3 lp = localize(rayPos);
      lp.y += 0.5;
      lp.xz *= 2.0;
      vec4 s = samplerFire(lp, noiseScale);
      dens += s.r;
      hsum += s.g * s.r;                   // 밀도가중 평균 높이
    }
    float a = clamp(dens, 0.0, 1.0);
    if(a < 0.006) discard;
    float hgt = dens > 0.001 ? hsum / dens : 0.5;
    vec3 c = fireRamp(dens, hgt) * color * exposure;
    gl_FragColor = vec4(c, a);
  }`;

/**
 * 볼류메트릭 불 메쉬 생성. 반환 mesh에 .update(timeSec) 호출 필요(매 프레임).
 * @param {object} o
 *   color      : THREE.Color|hex — 불 색조 곱 (기본 따뜻한 주황)
 *   iterations : 레이마칭 스텝 (기본 20, 성능↔품질). 횃불 등 작은 불은 낮춰도 됨.
 *   magnitude/lacunarity/gain/noiseScale : 불 형상 튜닝 (원본 기본값)
 */
export function makeVolFire(o = {}){
  const iters = o.iterations != null ? o.iterations : 20;
  const mat = new THREE.ShaderMaterial({
    defines: { ITERATIONS: String(iters|0), OCTIVES: '3' },
    uniforms: {
      fireTex:        { value: fireTex() },
      color:          { value: new THREE.Color(o.color != null ? o.color : 0xffb055) },
      time:           { value: 0 },
      seed:           { value: Math.random() * 19.19 },
      invModelMatrix: { value: new THREE.Matrix4() },
      scale:          { value: new THREE.Vector3(1,1,1) },
      noiseScale:     { value: o.noiseScale || new THREE.Vector4(1, 2, 1, 0.3) },
      magnitude:      { value: o.magnitude != null ? o.magnitude : 1.3 },
      lacunarity:     { value: o.lacunarity != null ? o.lacunarity : 2.0 },
      gain:           { value: o.gain != null ? o.gain : 0.5 },
      exposure:       { value: o.exposure != null ? o.exposure : 1.6 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: o.depthTest != null ? o.depthTest : true,   // 지형/오브젝트가 불을 가리도록 (벽 뒤 관통 방지)
    blending: o.blending != null ? o.blending : THREE.AdditiveBlending,   // 밤 씬에서 발광
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), mat);
  mesh.renderOrder = 985;
  // 매 프레임: 역모델행렬·시간·스케일 갱신
  mesh.update = function(timeSec){
    this.updateMatrixWorld();
    mat.uniforms.invModelMatrix.value.copy(this.matrixWorld).invert();   // r160: getInverse 제거됨
    if(timeSec !== undefined) mat.uniforms.time.value = timeSec;
    mat.uniforms.scale.value.copy(this.scale);
  };
  mesh.material = mat;
  return mesh;
}
