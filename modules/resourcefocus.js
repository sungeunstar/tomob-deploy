// resourcefocus.js — 광물·나무 근접 포커스: 가까이 가면 ①이름표(뭔지) ②살짝 금빛 외곽선(인버티드-헐).
//   OutlinePass(포스트프로세싱)는 magic 블룸이 composer 슬롯을 점유 → 충돌. 대신 per-focus 백페이스 헐 아웃라인(1개만).
//   근접·거리는 카메라 아닌 "플레이어" 기준(3인칭에서도 동작, mine.js와 동일 원칙).
import * as THREE from 'three';

export function initResourceFocus(ctx){
  const scene=ctx.scene, camera=ctx.camera;
  if(!scene||!camera||!ctx.onUpdate) return;

  const FOCUS_R=6.5;          // 이 반경 안에 들어오면 포커스
  const OUTLINE_SCALE=1.055;  // 헐 외곽선 두께(원본 대비)
  const OUTLINE_MAT=new THREE.MeshBasicMaterial({ color:0xffd884, side:THREE.BackSide, transparent:true, opacity:0.85, depthWrite:false });

  // ── 이름표(투영 DOM) ──
  const label=document.createElement('div'); label.id='resLabel';
  label.style.cssText='position:fixed;z-index:6;transform:translate(-50%,-100%);pointer-events:none;display:none;'
    +'font:600 13px system-ui,"Malgun Gothic",sans-serif;color:#f3e6bd;white-space:nowrap;letter-spacing:.03em;'
    +'padding:4px 12px;border-radius:9px;background:rgba(12,18,27,.82);border:1px solid rgba(201,168,90,.55);'
    +'box-shadow:0 4px 14px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,231,160,.16);text-shadow:0 1px 2px #000;';
  label.innerHTML='<span id="resLabelIco"></span><span id="resLabelTxt"></span><span id="resLabelHint" style="color:#8fb3c2;font-weight:400;margin-left:7px;font-size:11px;"></span>';
  document.body.appendChild(label);
  const icoEl=label.querySelector('#resLabelIco'), txtEl=label.querySelector('#resLabelTxt'), hintEl=label.querySelector('#resLabelHint');

  let focus=null;      // { obj, kind:'ore'|'tree', outline, labelPos }
  const _pp=new THREE.Vector3();

  function addOutline(mesh){
    if(!mesh||!mesh.geometry) return null;
    const o=new THREE.Mesh(mesh.geometry, OUTLINE_MAT); o.scale.setScalar(OUTLINE_SCALE);
    o.renderOrder=-1; o.raycast=()=>{}; o.castShadow=o.receiveShadow=false; o.userData._resOutline=true;
    mesh.add(o); return o;                          // 자식 → 원본 변환 상속(월드스케일 = 원본×1.055)
  }
  function clearFocus(){ if(focus&&focus.outline&&focus.outline.parent){ focus.outline.parent.remove(focus.outline); } focus=null; label.style.display='none'; }

  function setFocus(obj, kind, name){
    if(focus&&focus.obj===obj) return;               // 동일 대상 유지
    clearFocus();
    const box=new THREE.Box3().setFromObject(obj);   // 외곽선 추가 전 실측
    // 라벨 높이 = 밑동 위 최대 3m로 캡(큰 나무 정수리에 달면 옆에서 화면 밖으로 벗어남). 수평 = 원점(줄기/광석 중심).
    const baseY=obj.position.y, topY=baseY + Math.min(box.max.y-baseY, 3.0) + 0.4;
    const lp=new THREE.Vector3(obj.position.x, topY, obj.position.z);
    focus={ obj, kind, outline:addOutline(obj), labelPos:lp };
    icoEl.textContent = kind==='ore'?'':'';
    txtEl.textContent = name;
    hintEl.textContent = kind==='ore'?'채광':'벌목';
  }

  let acc=0;
  ctx.onUpdate((dt)=>{
    acc+=(dt||0.016);
    const pp=ctx.player?ctx.player.pos:camera.position; _pp.set(pp.x,pp.y,pp.z);

    // 후보 탐색은 100ms마다(매프레임 전 노드 순회 방지) — 포커스 대상 재선정
    if(acc>=0.1){ acc=0;
      let best=null,bestKind=null,bestName=null,bd=FOCUS_R*FOCUS_R;
      const env=ctx.environment;
      if(env){
        const ores=env.ORE_NODES||[];
        for(const m of ores){ if(!m||!m.position||!m.parent) continue;
          const dx=m.position.x-_pp.x, dy=m.position.y-_pp.y, dz=m.position.z-_pp.z, d2=dx*dx+dy*dy+dz*dz;   // ★3D 거리(절벽 위/아래 오탐 방지)
          if(d2<bd){ bd=d2; best=m; bestKind='ore'; bestName=(m.userData&&m.userData.ore)||'광물'; } }
        const trees=env.TREES||[];
        for(const T of trees){ if(!T||T.state!=='stand'||!T.obj||!T.obj.position) continue;
          const p=T.obj.position, dx=p.x-_pp.x, dy=p.y-_pp.y, dz=p.z-_pp.z, d2=dx*dx+dy*dy+dz*dz;   // 나무=밑동(발밑) 기준 근접
          if(d2<bd){ bd=d2; best=T.obj; bestKind='tree'; bestName='나무'; } }
      }
      if(best) setFocus(best, bestKind, bestName); else clearFocus();
    }

    // 매프레임: 이름표 투영 + 외곽선 펄스
    if(focus&&focus.obj&&focus.obj.parent&&focus.labelPos){
      const ndc=focus.labelPos.clone().project(camera);
      if(ndc.z>1){ label.style.display='none'; }                        // 카메라 뒤 → 숨김
      else {
        label.style.display='block';
        label.style.left=((ndc.x*0.5+0.5)*innerWidth)+'px';
        label.style.top =((-ndc.y*0.5+0.5)*innerHeight)+'px';
      }
      if(focus.outline){ OUTLINE_MAT.opacity = 0.62 + 0.26*Math.sin(performance.now()*0.005); }   // ★살짝 펄스
    } else if(focus){ clearFocus(); }
  });

  ctx.resourceFocus={ clear:clearFocus };
  console.log('[resourcefocus] 근접 포커스(이름표+금빛 외곽선) 활성 — 광석/나무 '+FOCUS_R+'m');
  return ctx.resourceFocus;
}
