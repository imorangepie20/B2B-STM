# 관리자 주문 목록·상세 작업 화면

## 변경 이유

기존 `/admin/orders`는 주문마다 독립 카드를 반복해 표시했습니다. 주문 수량만 보이고 예약·출고·미확보 수량이 없어 부분 예약과 부분 출고 상태를 판단하기 어려웠으며, 전량 출고된 주문도 계속 처리 목록에 남았습니다. 취소 요청에는 실제 사유 입력 없이 고정 문구가 저장됐습니다.

## 변경 내용

### 주문 조회 API

- `GET /api/admin/orders`의 품목 응답에 `saleUnit`, `unitPrice`, `requestedQuantity`, `reservedQuantity`, `shippedQuantity`, `remainingReservedQuantity`, `waitingQuantity`를 추가했습니다.
- `unitPrice`는 금액 정밀도를 유지하도록 문자열로 반환합니다.
- 접수 주문은 모두 표시하고, 확정 주문은 `requestedQuantity > shippedQuantity`인 품목이 하나 이상 있을 때만 표시합니다.
- 전량 출고된 확정 주문은 처리 대상 목록에서 제외합니다.
- 접수 주문을 먼저, 같은 상태에서는 오래된 주문을 먼저 반환합니다.

### 관리자 화면

- 상단에 확정 대기 건수, 출고 진행 건수, 미확보 수량을 표시합니다.
- 주문번호, 거래처, 창고, SKU, 상품명 검색과 접수·확정 상태 필터를 제공합니다.
- 데스크톱은 좌측 처리 목록과 우측 주문 상세를 동시에 표시합니다.
- 주문 상세에서 품목별 `주문 / 출고 / 예약 / 미확보` 수량과 주문 금액을 비교합니다.
- 주문 확정 시 최신 가용 재고만 예약된다는 영향을 화면에 명시합니다.
- 확정 주문의 미출고 예약 취소에는 사용자가 입력한 필수 사유를 API에 전달합니다.
- 모바일은 목록과 상세를 세로로 배치하고 품목표만 카드 내부에서 가로 스크롤합니다.

## 검증 결과

- 새 조회 계약 테스트는 구현 전 기존 응답에서 실패했고, 구현 후 통과했습니다.
- 부분 출고 후 `shippedQuantity=2`, `remainingReservedQuantity=3`이 조회되는지 검증했습니다.
- 전량 출고 후 해당 주문이 처리 목록에서 제외되는지 검증했습니다.
- `npm.cmd run build:api`: 통과
- `npm.cmd run build:web`: 통과, 17개 route 생성
- `npm.cmd run test:foundation`: 28건 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 로그인부터 주문 확정, 부분 출고, 반품, 정산, 입금 배분, 로그아웃까지 통과
- Playwright 1440px와 390px: 문서 가로 넘침 없음

## 화면 검토 자료

- `docs/screenshots/sdtpl-admin-orders-desktop.png`
- `docs/screenshots/sdtpl-admin-orders-mobile.png`

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
