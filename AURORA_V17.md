# Windgate 17 — Final authored outdoor pass

Windgate 17은 Windgate 07의 안정적인 outdoor island와 네이티브 이동/물/포탈 구조를 유지하면서,
중요한 장소와 이동 시퀀스를 수작업 authored layer로 고도화한 버전이다.

## 유지한 원칙
- 지형 높이/본편 `player.js`/기존 물 시뮬레이션/포탈 핵심 로직은 유지한다.
- 새 아트 패스는 장식 중심이며 플레이 경로의 기존 collision을 바꾸지 않는다.
- 산길과 POI는 표지판보다 실루엣, 재료 변화, 폐허, 작업 흔적으로 읽게 한다.
- 광산 내부는 만들지 않고 외부 작업장과 산에 파묻힌 입구까지만 완성한다.

## 완료된 수작업 패스

### 1. 정상 성소 · Summit s6
- 정상으로 올라가는 길의 인공적인 절삭감을 줄인 비정형 노출 지면
- 산길 가장자리 암반/옛 옹벽 잔해
- 포탈 주변 성소의 끊어진 기초 평면
- 6개 구간의 무너진 석벽
- 잔존 기둥과 쓰러진 기둥 드럼
- 붕괴 방향이 읽히는 잔해 밀도
- 중앙 포탈 접근 동선 유지

### 2. 폭포·계곡 · Waterfall w1
- 두 단계 폭포 옆 비대칭 암벽 어깨
- 상단 수원 / 중간 수반 / 하단 라군 재질과 지형 성격 분리
- 젖은 암반, splash moss, 충돌부 돌
- 라군과 보행로 사이 침식 지면
- 기존 terrain-clipped water와 물리 구조 유지

### 3. 광산 · Final map f1
- 광산 입구 뒤 절개 암반을 여러 층으로 구성
- 작업장 지면의 채굴 흉터
- 바깥으로 흘러내린 tailings
- 목재 보강 구조와 쓰러진 지지대
- 광산 앞마당 가장자리의 파손된 광차
- 기존 레일/광석/랜턴 authored exterior와 결합

### 4. 중간 이동 구간 · Final map f1
- 항구→숲→폭포→폐허→정상 사이 6개 reveal gate
- 다음 공간이 한눈에 보이지 않도록 바위와 수목을 경로 바깥에 배치
- 코너 이후 공간이 다시 열리는 구조 강화
- 옛 순례길 포장 파편을 연속 경계석이 아닌 짧은 흔적으로만 배치
- 주요 정상/폭포 sightline은 보존

### 5. 항구·선착장 · Final map f1
- 낡은 부두 말뚝과 처진 밧줄
- 해안에 밀려온 목재
- 끊어진 옛 석축
- 시작 동선을 방해하지 않는 소규모 화물
- 모래/작업 흔적으로 오브젝트와 지면 연결

### 6. 전체 섬 실루엣 · Final map f1
- 기존 물리 능선을 따라 능선 crown rock/tree cluster 보강
- 주요 전망축은 비워두고 나머지 구간의 노출을 줄임
- 공터처럼 보이는 노출 구간에 바람에 깎인 지면 scar 추가

### 7. 최종 환경 톤
- tone mapping exposure 1.00
- fog density 0.0009
- hemi 1.40 / sun 2.0 / fill 0.45
- 기존 sky/water/portal shader 유지
- 최종 QA report에 summit / waterfall / finalMap authored module 상태를 노출

## 현재 빌드
- qualityVersion: `aurora-v17g-final-map-pass`
- Summit: `s6`
- Waterfall: `w1`
- Final map: `f1`

## 검수 링크
- 전체: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?rev=3e582fff
- 정상: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?place=summit17&rev=3e582fff
- 폭포: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?place=falls&rev=3e582fff
- 광산: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?place=mine-yard17&rev=3e582fff
- 항구: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?place=dock&rev=3e582fff
- 전체 지형: https://sungeunstar.github.io/tomob-deploy/sandbox-aurora-v17.html?view=overview&rev=3e582fff

## 검증
- 신규 `windgate17-final-map-manual.js`: syntax OK
- 신규 `windgate17-waterfall-manual.js`: syntax OK
- `windgate17-summit-manual.js`: syntax OK
- 통합 `aurora-refuge-v17.js`: syntax OK
- 외부 Chromium 직접 렌더 검수는 현재 실행 환경의 네트워크 정책으로 GitHub Pages 접근이 차단되어 수행하지 못했다.
