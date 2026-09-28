# Windgate 16 — 광산 Interior 시스템

## 구조
- 섬 지형은 더 이상 절개하지 않는다.
- 기존 `building_mine_blue.fbx`는 외부 광산 입구로 유지한다.
- 입구 트리거를 지나면 별도 월드 좌표의 광산 Interior로 전환한다.
- 전환 시 짧은 페이드를 사용해 텔레포트를 숨긴다.
- 본편 `player.js`는 수정하지 않는다.

## Interior
- 기존 mine-kit Tunnel1/2/3를 시각 에셋으로 사용
- 실제 이동 충돌은 단순 floor / wall / ceiling collider로 분리
- Support, Lantern, Crate, Planks, Ore는 충돌 없는 장식
- 광물: 철광석, 구리, 코발트, 석탄, 금
- 입구로 돌아오면 원래 섬 광산 앞에 복귀

## 실행
- 광산 입구: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v16.html?place=cave
- 광산 내부: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v16.html?zone=mine
