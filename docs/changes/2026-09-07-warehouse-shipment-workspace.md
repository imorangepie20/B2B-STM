# 창고 주문별 출고 작업 화면

## 변경 이유

기존 `/warehouse/shipments`는 모든 주문의 예약 품목을 하나의 폼에 나열했습니다. 작업자가 서로 다른 주문의 수량을 함께 입력할 수 있었고 제출한 뒤에야 한 주문만 처리할 수 있다는 오류를 확인했습니다. 주문 단위 작업 구분, 출고 후 잔량, 확정 결과의 재고·정산 영향도 화면에서 확인하기 어려웠습니다.

## 변경 내용

### 출고 대기 API

- `GET /api/warehouse/shipments/queue`에 `customerCode`, `orderCreatedAt`, `confirmedAt`을 추가했습니다.
- 기존 정렬대로 오래된 주문을 먼저 반환하며 화면에서 주문 단위로 묶습니다.
- API의 단일 주문·단일 창고 검증과 `requestId` 중복 방지는 유지합니다.

### 창고 화면

- 대기 주문 수, 대기 품목 수, 전체 예약 잔량을 상단에 표시합니다.
- 주문번호, 거래처, SKU, 상품명으로 출고 작업을 검색합니다.
- 좌측 주문 목록에서 하나를 선택한 뒤 해당 주문의 예약 품목만 입력할 수 있습니다.
- 품목별 예약 잔량, 이번 출고량, 출고 후 잔량을 동시에 표시합니다.
- `전량 입력`과 `초기화`를 제공하고 0인 품목은 요청에서 제외합니다.
- 확정 전 선택 품목 수, 이번 출고 합계, 출고 후 잔량을 다시 표시합니다.
- 예약 잔량 초과, 음수, 정수가 아닌 입력은 오류 상태로 표시하고 제출을 거부합니다.
- 서버 충돌 시 완료로 표시하지 않고 최신 대기 목록을 다시 조회합니다.
- 출고 확정 시 재고·예약 차감과 정산 대상 출고 원장이 생성된다는 영향을 화면에 명시합니다.
- 모바일에서는 주문 목록과 선택 작업을 세로로 배치하고 주요 수량 입력과 확정 버튼 높이를 44px 이상으로 유지합니다.

## 검증 결과

- 새 출고 대기 조회 계약은 구현 전 실패하고 구현 후 통과했습니다.
- `customerCode`, `orderCreatedAt`, `confirmedAt` 응답을 실제 PostgreSQL 테스트 데이터로 검증했습니다.
- `npm.cmd run build:api`: 통과
- `npm.cmd run build:web`: 통과, 17개 route 생성
- `npm.cmd run test:foundation`: 28건 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 주문 선택, 부분 출고, 반품, 정산, 입금 배분, 로그아웃까지 통과
- Playwright 1440px와 390px: 문서 가로 넘침 없음

## 화면 검토 자료

- `docs/screenshots/sdtpl-warehouse-shipments-desktop.png`
- `docs/screenshots/sdtpl-warehouse-shipments-mobile.png`

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
