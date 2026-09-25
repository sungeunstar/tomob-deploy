// shipwreck.js — 배 격침(데미지→두 동강 절단→천천히 침몰 + 화재/연기/물보라).
//   ★사령관이 만든 _destruct_C_sink.html 의 sink 시스템을 "그대로" 이식(재현 아님).
//      Fire(볼류메트릭 mattatz THREE.Fire) · impactFx · damage(roll+화재) · sliceAndSink(두 동강+물리조각)
//      · updateSinking(부력) 을 모듈화. ship.js 로드 배(ctx.ships)에 작동.
//   적용 차이(하네스→ship.js): 길이축 = ship 로컬 x(deckW), 월드변환 = ship.mesh.matrixWorld,
//      물리 = ctx.world/ctx.RAPIER(physics.js), 수면 = ctx.water.level, 소리 = ctx.sound.
//   API: ctx.shipwreck.damage(ship, worldPoint, dir)  — 피격(화재+roll, HP는 navalcombat 관리)
//        ctx.shipwreck.sink(ship)                      — 격침(두 동강 절단+침몰 시작)
//        ctx.shipwreck.wrecking(ship)                  — 침몰 중 여부
//
// ⚡ 퍼포먼스 개보수(해전 피격 프레임드랍 박멸 — cannon.js와 같은 처방):
//   ① 화재 PointLight 풀 상주(intensity 0) — 피격마다 라이트 add/remove = 씬 전체 셰이더 재컴파일 폭탄.
//      라이트는 씬 루트 상주 고정, 매 프레임 화염 월드좌표를 '따라감'(배/덩이에 안 붙임 → 개수 불변).
//   ② Fire 볼류메트릭 메시 풀 + init 프리워밍(renderer.compile) — 첫 화점의 무거운 레이마칭 셰이더
//      컴파일 히칫 제거 + 피격마다 지오/머티리얼 생성 제거.
//   ③ 나무 파편 풀 — 피격마다 Rapier 강체 3개 생성/제거하던 것을 setEnabled 토글 재사용으로.
//   ④ 연기/물보라 스프라이트 풀 — 매 스폰 new Sprite(new SpriteMaterial) GC 스파이크 + dispose 누수 제거.
//   ⑤ 격침 절단 convexHull 입력 다운샘플(≤400점) — 수만 정점 배 격침 시 수백 ms 멈춤 완화.
//   ⑥ 🔥 화점 위치 갑판 클램프 — hitTest 판정박스가 선체보다 커서(여유 +3/+2.5) 불이 배 밖
//      허공에 뜨던 것 → 갑판 보행 범위(deckW/deckL) 안으로 클램프해 배 위에 붙게.
import * as THREE from 'three';
import { createLightPool, createVisiblePool, radialTexture } from './fxpool.js';   // R1: 풀/텍스처 공용화(수치·개수 불변)

// ═══════════ 불꽃 = mattatz THREE.Fire 볼류메트릭(레이마칭) — 하네스 그대로 ═══════════
const FIRE_TEX = new THREE.TextureLoader().load('/tomob-deploy/_fire_ref.png');
FIRE_TEX.magFilter = FIRE_TEX.minFilter = THREE.LinearFilter;
FIRE_TEX.wrapS = FIRE_TEX.wrapT = THREE.ClampToEdgeWrapping;

const FireShader = {
  defines: { ITERATIONS: '20', OCTIVES: '3' },
  uniforms: {
    fireTex:{ value:null }, color:{ value:null }, time:{ value:0.0 }, seed:{ value:0.0 },
    invModelMatrix:{ value:null }, scale:{ value:null },
    noiseScale:{ value:new THREE.Vector4(1,2,1,0.55) },
    magnitude:{ value:1.8 }, lacunarity:{ value:2.0 }, gain:{ value:0.5 },
  },
  vertexShader: [
    'varying vec3 vWorldPos;',
    'void main() {',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform vec3 color; uniform float time; uniform float seed;',
    'uniform mat4 invModelMatrix; uniform vec3 scale; uniform vec4 noiseScale;',
    'uniform float magnitude; uniform float lacunarity; uniform float gain;',
    'uniform sampler2D fireTex; varying vec3 vWorldPos;',
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}',
    'vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}',
    'float snoise(vec3 v){',
    '  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);',
    '  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);',
    '  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);',
    '  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);',
    '  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));',
    '  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);',
    '  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;',
    '  vec4 h=1.0-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);',
    '  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));',
    '  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;',
    '  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);',
    '  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));',
    '  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;',
    '  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;',
    '  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));',
    '}',
    'float turbulence(vec3 p){ float sum=0.0,freq=1.0,amp=1.0; for(int i=0;i<OCTIVES;i++){ sum+=abs(snoise(p*freq))*amp; freq*=lacunarity; amp*=gain; } return sum; }',
    'vec4 samplerFire(vec3 p, vec4 sc){ vec2 st=vec2(sqrt(dot(p.xz,p.xz)),p.y); if(st.x<=0.0||st.x>=1.0||st.y<=0.0||st.y>=1.0) return vec4(0.0); p.y-=(seed+time)*sc.w; p*=sc.xyz; st.y+=sqrt(st.y)*magnitude*turbulence(p); if(st.y<=0.0||st.y>=1.0) return vec4(0.0); return texture2D(fireTex,st); }',
    'vec3 localize(vec3 p){ return (invModelMatrix*vec4(p,1.0)).xyz; }',
    'void main(){',
    '  vec3 rayPos=vWorldPos; vec3 rayDir=normalize(rayPos-cameraPosition);',
    '  float rayLen=0.0288*length(scale.xyz); vec4 col=vec4(0.0);',
    '  for(int i=0;i<ITERATIONS;i++){ rayPos+=rayDir*rayLen; vec3 lp=localize(rayPos); lp.y+=0.5; lp.xz*=2.0; col+=samplerFire(lp,noiseScale); }',
    '  col.a=col.r; gl_FragColor=col*vec4(color,1.0);',
    '}'
  ].join('\n')
};

class Fire extends THREE.Mesh {
  constructor(color){
    const mat = new THREE.ShaderMaterial({
      defines: FireShader.defines, uniforms: THREE.UniformsUtils.clone(FireShader.uniforms),
      vertexShader: FireShader.vertexShader, fragmentShader: FireShader.fragmentShader,
      transparent:true, depthWrite:false, depthTest:true });
    mat.uniforms.fireTex.value = FIRE_TEX;
    mat.uniforms.color.value = (color && color.isColor) ? color : new THREE.Color(color || 0xeeeeee);
    mat.uniforms.invModelMatrix.value = new THREE.Matrix4();
    mat.uniforms.scale.value = new THREE.Vector3(1,1,1);
    mat.uniforms.seed.value = Math.random()*19.19;
    super(new THREE.BoxGeometry(1,1,1), mat);
  }
  update(time){
    const u=this.material.uniforms; this.updateMatrixWorld();
    u.invModelMatrix.value.copy(this.matrixWorld).invert();
    if(time!==undefined) u.time.value=time;
    this._ws=this._ws||new THREE.Vector3(); this._tp=this._tp||new THREE.Vector3(); this._tq=this._tq||new THREE.Quaternion();
    this.matrixWorld.decompose(this._tp,this._tq,this._ws); u.scale.value.copy(this._ws);
  }
  dispose(){ this.geometry.dispose(); this.material.dispose(); }
}

// 부드러운 연기/불꽃/물보라 스프라이트 텍스처 — R1: fxpool radialTexture 공용화(128px·원형·srgb·색스톱 그대로)
const _rt = stops => radialTexture(128, stops, { inner:2, edge:62, circle:true, srgb:true });
const TEX_SMOKE = _rt([[0,'rgba(80,80,80,0.95)'],[0.5,'rgba(70,70,70,0.45)'],[1,'rgba(60,60,60,0)']]);
const TEX_SPLASH= _rt([[0,'rgba(255,255,255,0.95)'],[0.5,'rgba(220,235,240,0.5)'],[1,'rgba(200,225,235,0)']]);
const woodInner = new THREE.MeshStandardMaterial({ color:0x6b4a2b, roughness:0.95, metalness:0.0, side:THREE.DoubleSide });

// ── 침몰 파라미터(하네스 검증값) ──
// ★원본 _destruct_C_sink.html updateSinking 수치 그대로 (재구현 금지 — 사령관 지시)
const GRAV_SCALE=0.4, LIN_DAMP=0.85, ANG_DAMP=0.84;
const BUOY_DECAY=0.085, BUOY_FORCE=8.0;   // 부력 배율 0초 1.0 → ~12초 소진(점진 침수)
const FADE_DEPTH=3.5, FADE_RATE=0.5, FADE_GONE=2.0;
const MAX_CHUNKS=120;    // 안전 상한(원본엔 없음 — 다중 격침 대비)
const FIRE_FW=3.4;          // 화염 월드 높이
const MAX_FIRES=4;          // 배당 동시 화점 제한
// ── ⚡ 풀 크기 ──
const N_FIRE=8;            // 볼류메트릭 화염 풀(전 배 합산 동시 상한)
const N_FIRELIGHT=3;       // 화재 점광원 풀(고갈 시 화염만·빛 생략 — cannon.js와 동일 정책). ⚡2026-07-22 6→3(노는 광원도 픽셀마다 계산됨)
const N_SMOKE=24, N_SPLASH=10, N_DEBRIS=18;
const HULL_MAX_PTS=400;    // 격침 덩이 convexHull 입력 정점 상한(다운샘플)

export function initShipwreck(ctx){
  const { scene } = ctx;
  const world = ctx.world, RAPIER = ctx.RAPIER;
  const chunks = [];   // { mesh, body, age, fadeT, removed }
  const smokes = [], splashes = [];
  const wreckFires = [];   // 화점 { fire(풀), ls(라이트슬롯)|null, ship, t, smokeT, dead }
  if(!world || !RAPIER) console.warn('[shipwreck] ctx.world/RAPIER 없음 — 침몰 물리 제한');

  const _v = new THREE.Vector3(), _sb = new THREE.Box3(), _wp = new THREE.Vector3();
  const SEA = () => (ctx.water ? (ctx.water.level||0) : 0);

  // ── ① 화재 점광원 풀 — 씬 루트 상주(intensity 0). add/remove·reparent 일체 금지(라이트 개수 변동
  //      = 씬 전체 셰이더 재컴파일). 매 프레임 화염 월드좌표를 따라간다. ──
  const fireLightPool=createLightPool(scene, N_FIRELIGHT, { color:0xff7820, distance:16 });   // R1: fxpool 공용화(개수·색·거리 불변)
  const grabFireLight=()=>fireLightPool.grab();

  // ── ② Fire 볼류메트릭 메시 풀 — 생성은 init 1회. 사용 시 배/덩이에 부착(메시 reparent는 재컴파일 무관). ──
  const firePool=[];
  for(let i=0;i<N_FIRE;i++){ const f=new Fire(new THREE.Color(0xffcc66)); f.visible=false; f.position.set(0,-999,0); scene.add(f); f._busy=false; firePool.push(f); }
  function grabFire(){ const f=firePool.find(f=>!f._busy); if(f) f._busy=true; return f||null; }
  // 화점 슬롯 회수(라이트 소등 + 화염 풀 반납). wreckFires 배열에서의 제거는 update 루프가 dead로 수행.
  function releaseWreckFire(f){
    if(f.dead) return; f.dead=true;
    if(f.fire){ if(f.fire.parent) f.fire.parent.remove(f.fire);
      f.fire.visible=false; f.fire.position.set(0,-999,0); scene.add(f.fire); f.fire._busy=false; }
    if(f.ls){ fireLightPool.release(f.ls); f.ls=null; }
  }

  // ── ④ 연기/물보라 스프라이트 풀 (머티리얼 = 슬롯당 1회 생성, visible 토글) — R1: fxpool 공용화(개수 불변) ──
  const smokePool=createVisiblePool(scene, N_SMOKE, ()=>new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_SMOKE, transparent:true, opacity:0, depthWrite:false })));
  const splashPool=createVisiblePool(scene, N_SPLASH, ()=>new THREE.Sprite(new THREE.SpriteMaterial({ map:TEX_SPLASH, transparent:true, opacity:0, depthWrite:false })));

  function spawnSmoke(p, scale, rise, life){
    const sp=smokePool.grab(); if(!sp) return;   // 고갈 시 생략(할당 0 유지)
    sp.position.copy(p); sp.scale.setScalar(scale); sp.material.opacity=0.85; sp.visible=true;
    smokes.push({ s:sp, life, max:life, rise, grow:scale*0.9 });
  }
  function spawnSplash(p){
    const sp=splashPool.grab(); if(!sp) return;
    sp.position.copy(p); sp.position.y=SEA()+0.1; sp.scale.setScalar(1.5); sp.material.opacity=0.9; sp.visible=true;
    splashes.push({ s:sp, life:0.9, max:0.9 });
  }

  function bakeWorld(sub){
    const src = sub.geometry.index ? sub.geometry.toNonIndexed() : sub.geometry.clone();
    src.applyMatrix4(sub.matrixWorld); return src;
  }

  // ── 화점: 피격점에 화염(배 자식으로 부착 → 기울면 같이 기움). 동시 MAX_FIRES 제한 ──
  function addFire(ship, worldPoint){
    if(!ship.mesh) return;
    ship._fires = ship._fires || [];
    if(ship._fires.length >= MAX_FIRES) return;
    const fire=grabFire(); if(!fire) return;   // 풀 고갈 = 화점 생략
    ship.mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(ship.mesh.matrixWorld).invert();
    const local = worldPoint.clone().applyMatrix4(inv);
    // ⑥ ★갑판 안으로 클램프 — navalcombat hitTest 판정박스가 선체보다 크게 잡혀(+3/+2.5 여유)
    //    피격 로컬점이 배 밖일 수 있음 → 불이 허공에 뜨던 원인. 갑판 보행 범위 안으로 스냅.
    //    축 규약: deckW=길이축(x)·deckL=폭축(z, ship.js에서 이미 절반 폭). deckCx/deckCz=갑판 중심 오프셋.
    const cx=ship.deckCx||0, cz=ship.deckCz||0;
    const hl=(ship.deckW||30)*0.5*0.85, hw=(ship.deckL||10)*0.5*0.8;
    local.x=Math.max(cx-hl, Math.min(cx+hl, local.x));
    local.z=Math.max(cz-hw, Math.min(cz+hw, local.z));
    // 갑판 윗면 부근에 스냅(공중/배밖 방지)
    const deckTop = (ship.deckLocalY != null ? ship.deckLocalY : 4) + 0.5;
    fire.scale.set(FIRE_FW*0.6, FIRE_FW, FIRE_FW*0.6);
    fire.position.set(local.x, deckTop - FIRE_FW*0.40, local.z);
    fire.renderOrder = 5; fire.visible = true;
    if(fire.parent) fire.parent.remove(fire);
    ship.mesh.add(fire);
    const ls = grabFireLight();   // 라이트는 씬 상주 슬롯 — 부착하지 않고 매 프레임 따라감
    const f = { fire, ls, ship, t:Math.random()*6, smokeT:0, dead:false };
    ship._fires.push(f); wreckFires.push(f);
  }

  // ── ③ 피격 나무 파편 풀 — Rapier 강체를 init에 만들어 두고 setEnabled 토글로 재사용(피격마다 생성/제거 0) ──
  const debrisGeo=new THREE.BoxGeometry(0.4,0.25,0.55);
  const debrisMat=new THREE.MeshStandardMaterial({ color:0x6a4622, roughness:1 });
  const debrisPool=[];
  const _bodyOff=b=>{ if(b.setEnabled) b.setEnabled(false); else { b.setGravityScale(0,false); b.sleep(); } };
  const _bodyOn =b=>{ if(b.setEnabled) b.setEnabled(true); else b.setGravityScale(1,true); };
  if(world){
    for(let i=0;i<N_DEBRIS;i++){
      const d=new THREE.Mesh(debrisGeo,debrisMat); d.castShadow=true; d.visible=false; scene.add(d);
      const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(i*5-45,-700,0).setLinearDamping(0.6).setAngularDamping(0.7));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.2,0.13,0.28).setRestitution(0.15).setFriction(0.8).setDensity(0.6), body);
      _bodyOff(body);
      debrisPool.push({ mesh:d, body, busy:false, life:0 });
    }
  }
  function impactFx(point, dir){
    if(world){
      let n=0;
      for(const slot of debrisPool){
        if(n>=3) break; if(slot.busy) continue;
        slot.busy=true; slot.life=2.4; n++;
        const b=slot.body;
        _bodyOn(b);
        b.setTranslation({ x:point.x, y:point.y, z:point.z }, true);
        b.setLinvel({x:0,y:0,z:0}, true); b.setAngvel({x:0,y:0,z:0}, true);
        slot.mesh.position.copy(point); slot.mesh.visible=true;
        const ax=dir?dir.x:0, az=dir?dir.z:0;
        b.applyImpulse({ x:ax*0.7+(Math.random()-0.5)*0.9, y:Math.random()*0.5+0.2, z:az*0.7+(Math.random()-0.5)*0.9 }, true);
        b.applyTorqueImpulse({ x:(Math.random()-0.5)*0.4,y:(Math.random()-0.5)*0.4,z:(Math.random()-0.5)*0.4 }, true);
      }
    }
    spawnSmoke(point.clone().add(new THREE.Vector3(0,0.8,0)), 2.2, 1.0, 1.7);
    spawnSmoke(point.clone().add(new THREE.Vector3((Math.random()-0.5),1.4,(Math.random()-0.5))), 1.5, 1.3, 1.2);
  }

  // ── 피격(미격침): 화재 + 타격FX + roll 누적(기울기) ──
  function damage(ship, worldPoint, dir){
    if(!ship || ship._wrecking) return;
    if(worldPoint){ impactFx(worldPoint, dir); addFire(ship, worldPoint); }
    ship._wreckRoll = Math.min(0.32, (ship._wreckRoll||0) + 0.05 + Math.random()*0.02);   // 한쪽으로 점점 기울기
    ctx.sound?.play?.('ship_crash', {vol:0.3});
  }

  // 월드 지오 → Rapier 동적 강체 + 바깥 폭발 임펄스(outSpeed=배 크기 비례).
  function makePiece(geoWorld, material, impactCenter, outSpeed){
    geoWorld.computeBoundingBox();
    const c=new THREE.Vector3(); geoWorld.boundingBox.getCenter(c);
    geoWorld.translate(-c.x,-c.y,-c.z);
    const baseMat=(Array.isArray(material)?material[0]:material)||woodInner;
    const useMat=baseMat.clone(); useMat.side=THREE.DoubleSide;
    const pm=new THREE.Mesh(geoWorld, useMat); pm.position.copy(c); pm.castShadow=true; scene.add(pm);
    let body=null;
    if(world){
      body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x,c.y,c.z)
        .setLinearDamping(LIN_DAMP).setAngularDamping(ANG_DAMP).setGravityScale(GRAV_SCALE).setCanSleep(false));
      // ⑤ ★convexHull 입력 다운샘플: 수만 정점 배는 전체 배열을 넘기면 격침 순간 수백 ms 멈춤.
      //    convex hull은 외곽 형상만 필요 → ≤HULL_MAX_PTS 점 스트라이드 샘플로 충분(파편 충돌용 근사).
      let col=null;
      try{
        const arr=geoWorld.getAttribute('position').array, n=arr.length/3;
        const stride=Math.max(1, Math.ceil(n/HULL_MAX_PTS));
        let pts;
        if(stride>1){ const m=Math.ceil(n/stride); pts=new Float32Array(m*3);
          let w=0; for(let i=0;i<n;i+=stride){ pts[w++]=arr[i*3]; pts[w++]=arr[i*3+1]; pts[w++]=arr[i*3+2]; } }
        else pts=new Float32Array(arr);
        col=RAPIER.ColliderDesc.convexHull(pts);
      }catch(e){ col=null; }
      world.createCollider((col||RAPIER.ColliderDesc.cuboid(1.5,1.0,2.0)).setDensity(0.35).setRestitution(0.05).setFriction(0.9), body);
      const away=c.clone().sub(impactCenter); away.y=0; if(away.lengthSq()<0.04) away.set(Math.random()-0.5,0,Math.random()-0.5); away.normalize();
      const m=body.mass(), spd=outSpeed||3;
      body.applyImpulse({ x:away.x*spd*m, y:(0.6+Math.random()*1.0)*m, z:away.z*spd*m }, true);
      body.applyTorqueImpulse({ x:(Math.random()-0.5)*0.8*m, y:(Math.random()-0.5)*0.5*m, z:(Math.random()-0.5)*0.8*m }, true);
    }
    const ch={ mesh:pm, body, age:0, fadeT:0, removed:false };
    chunks.push(ch); return ch;
  }

  // ── 격침: 두 동강(뱃머리/선미) × 현측 4덩이 절단 → 물리 폭발 → 부력 침몰 ──
  function sink(ship){
    if(!ship || !ship.mesh || ship._wrecking) return 0;
    ship._wrecking = true;
    ship.mesh.updateMatrixWorld(true);

    const box=new THREE.Box3().setFromObject(ship.mesh);
    const center=box.getCenter(new THREE.Vector3());
    const span=box.getSize(new THREE.Vector3());
    const outSpeed=THREE.MathUtils.clamp(Math.max(span.x,span.z)*0.2, 4, 14);
    const fwd=(ship.forward?ship.forward.clone():new THREE.Vector3(1,0,0)); fwd.y=0;
    if(fwd.lengthSq()<1e-6) fwd.set(1,0,0); fwd.normalize();
    const beam=new THREE.Vector3(-fwd.z,0,fwd.x);
    const deckTopW=ship.mesh.position.y + (ship.deckLocalY!=null?ship.deckLocalY:(box.min.y+(box.max.y-box.min.y)*0.25 - ship.mesh.position.y));
    const hullCutY=deckTopW+2.5;
    const impactCenter=new THREE.Vector3(center.x, deckTopW, center.z);

    // 선체(낮은 부위) vs 상부(돛대/돛) — 높이 기반(재질명 배마다 불일치)
    const hullSubs=[], otherSubs=[];
    ship.mesh.traverse(o=>{ if(o.isMesh && o.geometry && o.geometry.getAttribute('position')){
      if(/arrow|marker/i.test(o.name||'') || o.isSprite || o instanceof Fire) return;
      _sb.setFromObject(o); (((_sb.min.y+_sb.max.y)*0.5)<=hullCutY ? hullSubs : otherSubs).push(o); } });
    if(!hullSubs.length) hullSubs.push(...otherSubs.splice(0));

    let hullMat=null, big=-1;
    for(const s of hullSubs){ const v=_sb.setFromObject(s).getSize(_v).lengthSq(); if(v>big){ big=v; hullMat=Array.isArray(s.material)?s.material[0]:s.material; } }

    // 모든 선체 삼각형 → 4버킷(뱃머리/선미 × 좌/우현)
    const buckets=[0,1,2,3].map(()=>({p:[],n:[],u:[]}));
    for(const sub of hullSubs){
      const g=bakeWorld(sub);
      const pos=g.getAttribute('position'),nor=g.getAttribute('normal'),uv=g.getAttribute('uv');
      for(let i=0;i<pos.count;i+=3){
        let cx=0,cy=0,cz=0; for(let k=0;k<3;k++){ cx+=pos.getX(i+k); cy+=pos.getY(i+k); cz+=pos.getZ(i+k); }
        _v.set(cx/3-center.x, cy/3-center.y, cz/3-center.z);
        const T=buckets[(_v.dot(fwd)>=0?1:0)+(_v.dot(beam)>=0?2:0)];
        for(let k=0;k<3;k++){ const j=i+k; T.p.push(pos.getX(j),pos.getY(j),pos.getZ(j));
          if(nor)T.n.push(nor.getX(j),nor.getY(j),nor.getZ(j)); if(uv)T.u.push(uv.getX(j),uv.getY(j)); }
      }
      g.dispose();
    }
    const newChunks=[];
    for(const T of buckets){
      if(T.p.length<9) continue;
      const ng=new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(T.p,3));
      if(T.n.length) ng.setAttribute('normal', new THREE.Float32BufferAttribute(T.n,3)); else ng.computeVertexNormals();
      if(T.u.length) ng.setAttribute('uv', new THREE.Float32BufferAttribute(T.u,2));
      newChunks.push(makePiece(ng, hullMat, impactCenter, outSpeed));
    }

    // 상부 부위(돛대/돛) → 가까운 덩이에 부착(함께 침몰)
    //   ★재질 clone 필수: 침몰 페이드가 opacity를 낮추는데, 원본 공유 시 리스폰된 살아있는 배까지 투명해짐(투명 버그).
    for(const sub of otherSubs){
      const g=bakeWorld(sub); g.computeBoundingBox(); const c=new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x,-c.y,-c.z);
      const om0=Array.isArray(sub.material)?sub.material[0]:sub.material;
      const pm=new THREE.Mesh(g, om0?om0.clone():undefined); pm.castShadow=true;
      let best=null,bd=1e9; for(const ch of newChunks){ const d=ch.mesh.position.distanceToSquared(c); if(d<bd){bd=d;best=ch;} }
      if(best){ best.mesh.add(pm); pm.position.copy(c.clone().sub(best.mesh.position)); }
      else { pm.position.copy(c); scene.add(pm); }
    }

    // 화재 → 가장 가까운 덩이에 재부착(덩이 따라 침몰). ★라이트는 씬 상주 풀 — reparent 안 함(개수 불변),
    //   update 루프가 화염 월드좌표를 계속 따라가므로 덩이와 함께 이동/침몰한다.
    ship._fires = ship._fires || [];
    for(const f of ship._fires){
      if(f.dead || !f.fire) continue;
      f.fire.getWorldPosition(_wp);
      if(f.fire.parent) f.fire.parent.remove(f.fire);
      let best=null,bd=1e9; for(const ch of newChunks){ const d=ch.mesh.position.distanceToSquared(_wp); if(d<bd){bd=d;best=ch;} }
      if(best){ best.mesh.add(f.fire); f.fire.position.copy(_wp).sub(best.mesh.position); }
      else releaseWreckFire(f);   // 덩이가 없으면 즉시 회수(소등+풀 반납)
    }

    // 절단 연출: 막타 연기 버스트 + 굉음 + 물보라
    for(let i=0;i<8;i++) spawnSmoke(new THREE.Vector3(center.x+(Math.random()-0.5)*span.x*0.8, deckTopW+1+Math.random()*2.5, center.z+(Math.random()-0.5)*span.z*0.6), 3.5+Math.random()*1.8, 1.2, 2.2+Math.random());
    spawnSplash(new THREE.Vector3(center.x, SEA(), center.z));
    ctx.sound?.play?.('ship_crash', {vol:0.85}); ctx.sound?.play?.('big_splash', {vol:0.7});

    console.log('[shipwreck] 격침 절단 —', ship.profile||ship.name||'ship', '덩이', newChunks.length, '부속', otherSubs.length, '화점', ship._fires.length);
    ship._fires = [];   // 화점은 덩이로 이관됨(wreckFires가 계속 관리)
    return newChunks.length;
  }

  // ── 메인 루프: 화재(라이트 추종·연기) + 부력 침몰 + 연기/물보라/파편 ──
  ctx.onUpdate(dt=>{
    const sea=SEA();
    // 화점: 화염 셰이더 시간 + ★상주 라이트가 화염 월드좌표 추종 + 발광 플리커 + 연기
    for(let i=wreckFires.length-1;i>=0;i--){
      const f=wreckFires[i];
      if(f.dead || !f.fire.parent || f.fire.parent===scene){ releaseWreckFire(f); wreckFires.splice(i,1); continue; }
      f.t+=dt; const flick=0.7+Math.abs(Math.sin(f.t*9))*0.5;
      f.fire.update(f.t);
      f.fire.getWorldPosition(_wp);
      if(f.ls){ f.ls.light.position.set(_wp.x, _wp.y+5, _wp.z); f.ls.light.intensity=9*flick; }
      f.smokeT-=dt; if(f.smokeT<=0){ f.smokeT=0.32;
        spawnSmoke(_wp.clone().add(new THREE.Vector3((Math.random()-0.5)*1.0,2.2,(Math.random()-0.5)*1.0)), 1.8, 1.6, 2.2); }
    }
    // (기울기 roll은 ship.js rotation 처리 방식과 충돌 위험 → v1 보류. 화재가 피격 누적의 핵심 신호.)

    // ★격침 잔해 침몰 = 사령관 원본 _destruct_C_sink.html updateSinking 그대로 (SEA_Y→sea).
    //   부력(아르키메데스): 잠긴 깊이만큼 떠받치다가 buoy가 ~12초에 걸쳐 소진(점진 침수) → 천천히 가라앉아 수면 정착 후 잠김 → 페이드.
    if(chunks.length > MAX_CHUNKS){ const over=chunks.length-MAX_CHUNKS; for(let k=0;k<over;k++) chunks[k].age=Math.max(chunks[k].age||0, 999); }   // 안전 상한(원본엔 없음)
    for(let i=chunks.length-1;i>=0;i--){
      const ch=chunks[i]; if(ch.removed){ chunks.splice(i,1); continue; }
      ch.age=(ch.age||0)+dt;
      if(!ch.body) continue;
      const buoy=Math.max(0, 1 - ch.age*BUOY_DECAY);          // 부력 배율: 0초 1.0 → ~12초 소진
      { const tr=ch.body.translation(), lv=ch.body.linvel();
        const sub=(sea - tr.y) + 0.6;                            // 잠긴 깊이(+오프셋: 절반쯤 잠겨 뜨도록)
        if(sub > 0){ const f=(sub*BUOY_FORCE*buoy - lv.y*2.0)*ch.body.mass()*dt; ch.body.applyImpulse({x:0,y:f,z:0}, true); } }
      const tr=ch.body.translation(), q=ch.body.rotation();
      ch.mesh.position.set(tr.x,tr.y,tr.z); ch.mesh.quaternion.set(q.x,q.y,q.z,q.w);
      // 수면 통과 시 물보라(+물입수음). ★noWater 게이트 — 잔해가 정리 안 된 채 새 지형(수면 근접)에 얹히면
      //   위치 무관·풀볼륨으로 무한 재생되던 것(버그①) 방지. clear()가 본체 대응, 이건 방어선.
      if(Math.abs(tr.y-sea)<1.8 && Math.random()<0.14){
        spawnSplash(new THREE.Vector3(tr.x+(Math.random()-0.5)*3, sea, tr.z+(Math.random()-0.5)*3));
        if(!(ctx.sound&&ctx.sound.noWater) && Math.random()<0.6) ctx.sound && ctx.sound.sfxPath && ctx.sound.sfxPath('/suimo_splash'+(1+(Math.random()*3|0))+'.wav', 0.4); }
      // 충분히 잠기면 페이드 → 제거
      if(tr.y < sea-FADE_DEPTH){
        ch.fadeT = (ch.fadeT||0) + dt;
        ch.mesh.traverse(o=>{ if(o.isMesh && o.material && !(o.material.uniforms)){ const ms=Array.isArray(o.material)?o.material:[o.material];
          for(const m of ms){ if(m){ m.transparent=true; m.opacity=Math.max(0, 1-ch.fadeT*FADE_RATE); m.depthWrite=false; } } } });
        if(ch.fadeT>FADE_GONE){
          // ★덩이에 붙은 화점 회수(dispose 전에 — 풀 화염 지오/셰이더 보호 + 라이트 소등).
          //   원본은 이 회수가 없어 제거된 덩이의 화점이 wreckFires에 영원히 남았다(누적 누수).
          const rel=[]; ch.mesh.traverse(o=>{ if(o instanceof Fire) rel.push(o); });
          for(const fo of rel){ const f=wreckFires.find(w=>w.fire===fo);
            if(f) releaseWreckFire(f);
            else { if(fo.parent) fo.parent.remove(fo); fo.visible=false; fo.position.set(0,-999,0); scene.add(fo); fo._busy=false; } }
          scene.remove(ch.mesh); ch.mesh.traverse(o=>{ if(o.isMesh&&o.geometry&&!(o instanceof Fire))o.geometry.dispose(); });
          try{ if(ch.body) world.removeRigidBody(ch.body); }catch(e){} ch.body=null; ch.removed=true; chunks.splice(i,1); }
      }
    }

    // 나무 파편(풀) — 만료 시 강체 비활성 + 풀 반납(제거/생성 없음)
    for(const slot of debrisPool){
      if(!slot.busy) continue;
      const t=slot.body.translation(), r=slot.body.rotation();
      slot.mesh.position.set(t.x,t.y,t.z); slot.mesh.quaternion.set(r.x,r.y,r.z,r.w);
      slot.life-=dt;
      if(slot.life<=0){ slot.busy=false; slot.mesh.visible=false;
        _bodyOff(slot.body); slot.body.setTranslation({x:0,y:-700,z:0}, false); }
    }
    // 연기/물보라(풀) — 만료 시 visible 토글 반납
    for(let i=smokes.length-1;i>=0;i--){ const s=smokes[i]; s.life-=dt; const k=1-s.life/s.max;
      s.s.position.y+=s.rise*dt; s.s.scale.setScalar(s.s.scale.x+s.grow*dt); s.s.material.opacity=Math.max(0,(1-k))*0.85;
      if(s.life<=0){ smokePool.park(s.s); smokes.splice(i,1); } }
    for(let i=splashes.length-1;i>=0;i--){ const s=splashes[i]; s.life-=dt; const k=1-s.life/s.max;
      s.s.scale.setScalar(1.5+k*2.2); s.s.material.opacity=Math.max(0,1-k)*0.9;
      if(s.life<=0){ splashPool.park(s.s); splashes.splice(i,1); } }
  });

  // ── ② 프리워밍 — Fire 레이마칭 셰이더 + 연기/물보라/파편 머티리얼을 로드 시점에 컴파일(첫 피격 히칫 제거). ──
  try{
    const f0=firePool[0], s0=smokePool.items[0], p0=splashPool.items[0], d0=debrisPool[0]&&debrisPool[0].mesh;
    if(f0){ f0.visible=true; f0.position.set(0,-990,0); }
    if(s0){ s0.visible=true; s0.position.set(0,-990,0); }
    if(p0){ p0.visible=true; p0.position.set(0,-990,0); }
    if(d0){ d0.visible=true; d0.position.set(0,-990,0); }
    if(ctx.renderer && ctx.camera) ctx.renderer.compile(scene, ctx.camera);
    if(f0){ f0.visible=false; f0.position.set(0,-999,0); }
    if(s0){ s0.visible=false; s0.position.set(0,-999,0); }
    if(p0){ p0.visible=false; p0.position.set(0,-999,0); }
    if(d0){ d0.visible=false; d0.position.set(0,-999,0); }
  }catch(e){ console.warn('[shipwreck] prewarm skip', e); }

  // ⚓ 소화(消火) — 반파 배 수리 시 화점 전량 회수(라이트 소등+화염 풀 반납). navalcombat cripple ↔ harbor 수리 짝.
  function extinguish(ship){
    if(!ship) return 0; let n=0;
    for(const f of [...wreckFires]){ if(f.ship===ship && !f.dead){ releaseWreckFire(f); n++; } }
    if(ship._fires) ship._fires.length=0;
    return n;
  }
  // ★버그①: 침몰 잔해 전체 회수 — 전투 종료/장면 전환(opening→game 등) 시 호출. 페이드 대기(FADE_GONE)까지
  //   기다리지 않고 즉시 정리 — 잔해가 새 지형(수면고도 다름)에 얹혀 FADE_DEPTH에 못 닿아 무한 재생되던 것 원천 차단.
  //   제거 로직 = 위 페이드-완료 정리 블록(:401~408)과 동일(화점 회수→scene.remove→geometry dispose→world.removeRigidBody).
  function clear(){
    for(let i=chunks.length-1;i>=0;i--){
      const ch=chunks[i];
      if(ch.mesh){
        const rel=[]; ch.mesh.traverse(o=>{ if(o instanceof Fire) rel.push(o); });
        for(const fo of rel){ const f=wreckFires.find(w=>w.fire===fo);
          if(f) releaseWreckFire(f);
          else { if(fo.parent) fo.parent.remove(fo); fo.visible=false; fo.position.set(0,-999,0); scene.add(fo); fo._busy=false; } }
        scene.remove(ch.mesh); ch.mesh.traverse(o=>{ if(o.isMesh&&o.geometry&&!(o instanceof Fire)) o.geometry.dispose(); });
      }
      try{ if(ch.body) world.removeRigidBody(ch.body); }catch(e){}
      ch.body=null; ch.removed=true;
    }
    chunks.length = 0;
  }
  ctx.shipwreck = { damage, sink, extinguish, clear, wrecking: ship=>!!(ship&&ship._wrecking), chunks,
    stat:()=>({ chunks:chunks.length, fires:wreckFires.length, smokes:smokes.length,
      pool:{ fire:firePool.filter(f=>f._busy).length+'/'+N_FIRE, light:fireLightPool.slots.filter(s=>s.busy).length+'/'+N_FIRELIGHT,
             debris:debrisPool.filter(s=>s.busy).length+'/'+N_DEBRIS } }) };
  console.log('[shipwreck] 격침 시스템 등록(사령관 _destruct_C_sink 이식) — 데미지+화재+두 동강+부력 침몰. world=', !!world,
    '| ⚡풀: fire'+N_FIRE+' light'+N_FIRELIGHT+' smoke'+N_SMOKE+' debris'+N_DEBRIS);
  return ctx.shipwreck;
}

// [근거]
// 확정: 격침 = 데미지(화재 누적+기울기) → 두 동강 절단 → 부력으로 천천히 침몰. (출처: 사령관 _destruct_C_sink.html)
// 확정: Fire(볼류메트릭 mattatz THREE.Fire + _fire_ref.png)·impactFx·updateSinking 부력 수치 = 하네스 그대로 이식.
// 확정: 적용 대상 = ship.js 배(forward/deckLocalY/mesh.matrixWorld·ctx.world Rapier·ctx.water.level). 길이축 = forward.
// 확정(⚡2026-07-03 피격 프레임드랍 수술): 라이트 add/remove = 씬 전체 셰이더 재컴파일 — cannon.js ①과 동일
//   원인(출처: [[voyage-light-recompile-trap]] + cannon.js 주석). 화재 라이트 = 씬 상주 풀 + 월드좌표 추종으로 교체.
// 확정: Rapier setEnabled 토글 = @dimforge/rapier3d-compat 0.14 지원(출처: physics.js import 버전). 구버전 폴백=sleep+gravityScale0.
// 확정(⑥ 화점 위치): navalcombat.js hitTest 판정박스 = 선체 절반 + 여유(hl +3 / hw +2.5) → 피격점이 배 밖 가능
//   (출처: navalcombat.js:156~158). 갑판 클램프 범위 = ship.js deckW(길이)·deckL(폭=이미 절반) 보행 규약.
// 제안: 풀 크기(fire8·light6·smoke24·splash10·debris18)·convexHull 400점 상한 = 일제사격 5문×동시 다척 기준 여유값. 실플레이 후 조정 가능.
// 미정: 하네스의 pre-split woodInner cut-cap 정밀 절단면은 DoubleSide 외판으로 대체(침몰 중 거의 안 보임).
