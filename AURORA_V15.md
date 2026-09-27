# Windgate 15 — 광산 재구축

v14의 문제였던 mine-kit 터널 외형이 산 바깥으로 노출되는 구조를 폐기했다.

- 기존 `building_mine_blue.fbx`는 입구 파사드로 유지한다.
- 산 지형 메시를 실제로 절개해 자연 암반형 갱도를 만든다.
- 렌더 지형과 Rapier 충돌은 동일한 절개 메시를 사용한다.
- mine-kit의 Tunnel1/2/3는 사용하지 않는다.
- 기존 mine-kit에서는 갱목, 랜턴, 상자, 판자, Ore 에셋만 내부 디테일로 사용한다.
- Ore 노드에는 `철광석 / 구리 / 코발트 / 석탄 / 금` 이름을 `userData.ore`에 넣는다.

실행:
- 광산 입구: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v15.html?place=mine-mouth
- 광산 굽이: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v15.html?place=mine-bend
- 광물 작업실: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v15.html?place=mine-room
