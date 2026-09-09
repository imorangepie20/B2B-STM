# 포트폴리오 아키텍처와 운영 인수 증빙

## 변경 이유

구현 화면만으로는 주문·재고·출고·반품·정산의 연결 구조와 운영 수준 검증 범위를 평가하기 어렵습니다. 구현한 범위와 미실행 항목을 분리하고 재현 가능한 증거로 제시할 자료가 필요했습니다.

## 변경 내용

- 위시켓용 프로젝트 설명, 완료 기준별 운영 인수표와 대표 화면 인덱스를 `docs/portfolio/`에 추가했습니다.
- 저장소와 확정 문서를 근거로 Archify architecture JSON과 독립 실행형 HTML을 생성했습니다.
- 다이어그램 검증 receipt, viewport별 라이트·다크 캡처와 contact sheet를 함께 보관했습니다.
- 목표 규모 지속 부하 시험은 미실행 상태로 명확히 표시했습니다.

## 최신 검증

- Archify `validate`: showcase 9/9, error 0, warning 0
- Archify `deliver`: specification·artifact SHA-256 생성
- Archify `visual-check`: 네 desktop viewport containment·readability 통과
- `admin:verify`, `db:verify`, `ops:verify` 통과
- `ops:acceptance-smoke`: 권한 9/9, 300건 p95 96.0ms, 예기치 않은 오류 0건

## 제한

- 로컬 스모크를 목표 규모 운영 성능으로 주장하지 않습니다.
- 다이어그램의 고정 viewer UI는 영어이며 작성 내용은 한국어입니다.
