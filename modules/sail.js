// sail.js — 천 물리 돛(verlet cloth). 모든 배 공용. ★메인급 시스템(항해게임 핵심: 바람 추진·전술·몰입).
//   격자 정점을 verlet 적분 + 거리 제약(천 안 늘어남)으로 시뮬. 위 활대 고정, 바람 힘으로 부풀고 펄럭.
//   배(parent) 로컬 공간에서 시뮬 → 배 회전/이동은 parent가 처리, 바람만 로컬 변환해 force.
//   ship.js가 돛 메시 위치/크기를 추출해 makeClothSail() 호출, 원본 돛 메시는 숨김.
import * as THREE from 'three';

// opts: parent(THREE.Object3D 배 mesh), localPos({x,y,z} 돛 중심 로컬), width(가로=z), height(세로=y),
//        map(돛 텍스처), getWindWorld(out:Vector3 → 월드 바람벡터 채움). segW/segH 격자 분할.
export function makeClothSail(ctx, { parent, localPos, width, height, segW=14, segH=11, map, sailColor, getWindWorld, getFurl, pin='edges', plane='zy' }){
  // 격자 = 기본 xy평면(법선 +z, width→x). plane='zy'면 rotateY(90°)로 법선 +x(돛 면 = z×y, width→z) = caravel 가로돛.
  //   plane='xy'면 안 돌림 = 법선 +z(돛 면 = x×y, width→x) = egyptian 등 앞뒤향 돛.
  const NA = plane==='xy' ? 2 : 0, TA = plane==='xy' ? 0 : 2;   // 법선축(부풂)·가로축(흔들림). y(1)는 항상 중력.
  const geo = new THREE.PlaneGeometry(width, height, segW, segH);
  if(plane!=='xy') geo.rotateY(Math.PI/2);
  const pa = geo.attributes.position, N = pa.count;
  const pos = new Float32Array(N*3), prev = new Float32Array(N*3), home = new Float32Array(N*3), pinned = new Uint8Array(N);
  for(let i=0;i<N;i++){ const ix=i*3;
    pos[ix]=pa.getX(i)+localPos.x; pos[ix+1]=pa.getY(i)+localPos.y; pos[ix+2]=pa.getZ(i)+localPos.z;
    prev[ix]=pos[ix]; prev[ix+1]=pos[ix+1]; prev[ix+2]=pos[ix+2];
    home[ix]=pos[ix]; home[ix+1]=pos[ix+1]; home[ix+2]=pos[ix+2]; }   // home = 펴진 원위치(furl 복귀 기준)
  // 격자 인덱스. c=가로(z), r=세로. ★위 활대(topR)는 인덱스 가정 대신 실제 y로 판정(flip 배 대응).
  const gw=segW+1, gh=segH+1, idx=(c,r)=>r*gw+c, cons=[];
  const topR = pos[idx(0,0)*3+1] > pos[idx(0,gh-1)*3+1] ? 0 : gh-1;   // y 큰 쪽 행 = 위 활대
  const botR = topR===0 ? gh-1 : 0;
  // ★고정점. 'edges'=4 테두리 전부(안쪽만 펄럭), 'square'=위 활대 전체+아래 양 모서리(진짜 사각돛), 'top'=위 활대만(깃발식).
  for(let r=0;r<gh;r++) for(let c=0;c<gw;c++){
    let p=false;
    if(pin==='edges')       p=(c===0||c===gw-1||r===0||r===gh-1);
    else if(pin==='square') p=(r===topR)||(r===botR&&(c===0||c===gw-1));
    else                    p=(r===topR);
    if(p) pinned[idx(c,r)]=1;
  }
  // 거리 제약(structural 가로·세로 + shear 대각). rest = 초기 거리.
  const D=(a,b)=>Math.hypot(pos[a*3]-pos[b*3],pos[a*3+1]-pos[b*3+1],pos[a*3+2]-pos[b*3+2]);
  for(let r=0;r<gh;r++) for(let c=0;c<gw;c++){ const a=idx(c,r);
    if(c<gw-1) cons.push([a,idx(c+1,r),D(a,idx(c+1,r))]);
    if(r<gh-1) cons.push([a,idx(c,r+1),D(a,idx(c,r+1))]);
    if(c<gw-1&&r<gh-1) cons.push([a,idx(c+1,r+1),D(a,idx(c+1,r+1))]);
  }
  // 메시: 균일색(emissiveMap, 조명 무관) — cloth라 노멀은 매 프레임 재계산하지만 안전하게.
  const posAttr = new THREE.BufferAttribute(pos,3);
  geo.setAttribute('position', posAttr);
  const _hm=!!map;   // map 있으면 텍스처(caravel), 없으면 단색 천색(egyptian 등 수동돛)
  const mat = new THREE.MeshLambertMaterial({ map, emissive:new THREE.Color(_hm?0xffffff:0x6a5e44), emissiveMap:map, emissiveIntensity:_hm?0.7:0.35, color:_hm?0x6f6f6f:(sailColor||0xcdbb94), side:THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled=false; mesh.name='ClothSail';
  parent.add(mesh);

  // ── verlet 시뮬 (고정 타임스텝) ──
  const DT=1/60, DT2=DT*DT, DAMP=0.985, ITER=4, GRAV=-6.0;
  const ROLL_R=Math.max(0.15,height*0.06), ROLL_WRAP=0.75;   // 접힌 돛 롤: 반지름(두께)·행당 감김(rad)
  const _qi=new THREE.Quaternion(), _wW=new THREE.Vector3(), _wL=new THREE.Vector3();
  let _t=0, _acc=0;
  function simulate(){
    parent.getWorldQuaternion(_qi); _qi.invert();
    _wW.set(0,0,0); getWindWorld(_wW); _wL.copy(_wW).applyQuaternion(_qi);   // 바람 → 배 로컬(가속도 단위)
    const gust=0.7+0.3*Math.sin(_t*0.6);                                     // 바람 강약(breath)
    for(let i=0;i<N;i++){ if(pinned[i]) continue; const ix=i*3;
      let vx=(pos[ix]-prev[ix])*DAMP, vy=(pos[ix+1]-prev[ix+1])*DAMP, vz=(pos[ix+2]-prev[ix+2])*DAMP;
      prev[ix]=pos[ix]; prev[ix+1]=pos[ix+1]; prev[ix+2]=pos[ix+2];
      // 난류(위치·시간 노이즈) — 살아있는 펄럭(가속도 ~20)
      const turb=(Math.sin(_t*5.0+pos[ix+1]*0.4) + Math.sin(_t*7.3+pos[ix+2]*0.25)*0.7)*20.0;
      const vv=[vx,vy,vz], wl=[_wL.x,_wL.y,_wL.z];
      pos[ix+NA] += vv[NA] + (wl[NA]*gust + turb)*DT2;          // 법선축 = 부풂 + 난류
      pos[ix+1]  += vv[1]  + (GRAV + wl[1]*0.4)*DT2;            // 중력 + 바람 수직
      pos[ix+TA] += vv[TA] + (wl[TA]*gust*0.5 + turb*0.3)*DT2;  // 가로 흔들림
    }
    for(let k=0;k<ITER;k++) for(let e=0;e<cons.length;e++){ const c=cons[e], a=c[0]*3, b=c[1]*3, rest=c[2];
      let dx=pos[b]-pos[a], dy=pos[b+1]-pos[a+1], dz=pos[b+2]-pos[a+2];
      const d=Math.hypot(dx,dy,dz)||1e-6, f=(d-rest)/d*0.5;
      dx*=f; dy*=f; dz*=f;
      if(!pinned[c[0]]){ pos[a]+=dx; pos[a+1]+=dy; pos[a+2]+=dz; }
      if(!pinned[c[1]]){ pos[b]-=dx; pos[b+1]-=dy; pos[b+2]-=dz; }
    }
    // 🌬️ furl(돛 접기): 0=완전 펴짐 ~ 1=위 활대 둘레로 감긴 원통(두툼한 말린 돛). 제약 후 적용.
    //   목표 = 활대 둘레 원통 표면(활대에서 멀수록 더 감김) → 한 줄로 안 뭉치고 두께 남음. furl로 home↔원통 보간.
    //   아래 모서리(pinned)도 따라 말림 → 양옆 삼각형 없음. furl=0이면 home 복귀, 자유 정점은 펄럭 유지.
    const furl = getFurl ? getFurl() : 0;
    const R=ROLL_R, WRAP=ROLL_WRAP;                      // R=롤 두께(반지름), WRAP=행당 감김(rad)
    for(let c=0;c<gw;c++){ const topI=idx(c,topR)*3, topx=pos[topI], topy=pos[topI+1];
      for(let r=0;r<gh;r++){ if(r===topR) continue; const vi=idx(c,r), ix=vi*3;
        const ang=Math.abs(r-topR)*WRAP;                 // 활대에서 멀수록 더 감김(여러 겹 원통)
        const rx=topx+R*Math.sin(ang), ry=topy+R*(1-Math.cos(ang)), rz=home[ix+2];   // 활대 위로 감김
        const tx=home[ix]+(rx-home[ix])*furl, ty=home[ix+1]+(ry-home[ix+1])*furl, tz=home[ix+2]+(rz-home[ix+2])*furl;
        if(pinned[vi]){ pos[ix]=tx; pos[ix+1]=ty; pos[ix+2]=tz; }                 // 아래 모서리: 목표에 고정(말림↔복귀)
        else { pos[ix]+=(tx-pos[ix])*furl; pos[ix+1]+=(ty-pos[ix+1])*furl; pos[ix+2]+=(tz-pos[ix+2])*furl; }  // 자유: 펄럭+말림
      } }
  }
  ctx.onUpdate(dt=>{ _acc+=Math.min(dt,0.05); let n=0;
    while(_acc>=DT && n<4){ _t+=DT; simulate(); _acc-=DT; n++; }
    posAttr.needsUpdate=true; geo.computeVertexNormals();
  });
  return { mesh, get pinned(){return pinned;} };
}
