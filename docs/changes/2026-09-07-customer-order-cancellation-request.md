# 거래처 미출고 잔량 취소 요청과 관리자 검토

## 변경 이유

기존에는 관리자가 주문을 직접 취소할 수만 있어 거래처가 남은 공급을 중단해 달라고 요청하고 그 처리 결과를 확인하는 업무 흐름이 없었습니다. 취소 검토 중에도 창고 출고나 추가 재고 배정이 가능하면 담당자 검토와 실제 출고가 경합해 의도하지 않은 출고가 발생할 수 있었습니다.

## 변경 내용

### 취소 요청과 감사 데이터

- migration `0023_order_cancellation_requests.sql`로 `order_cancellation_requests`를 추가했습니다.
- 요청 사유·요청자·요청 시각과 `submitted`, `approved`, `rejected` 상태를 저장합니다.
- 승인·반려에는 처리자와 처리 시각을 저장하고, 반려에는 비어 있지 않은 처리 사유를 필수로 저장합니다.
- 주문별 `submitted` 요청은 하나만 허용하되 반려 후에는 새 요청을 제출할 수 있습니다.
- 거래처 요청과 관리자 승인·반려는 각각 `requestId`로 한 번만 반영되며 같은 요청의 재전송은 저장된 결과를 반환합니다.

### 업무 경합과 승인 처리

- `POST /api/orders/:orderId/cancellation-requests`는 로그인 거래처 자신의 확정 주문 중 미출고 수량이 있는 주문만 접수합니다.
- 검토 중인 주문은 창고 출고 큐에서 제외하고 실제 출고 명령과 `POST /api/admin/orders/:orderId/allocate` 추가 배정을 차단합니다.
- 검토 중에는 `POST /api/admin/orders/:orderId/cancel` 직접 취소도 차단해 승인 기록을 우회하지 못하게 했습니다.
- `POST /api/admin/order-cancellation-requests/:requestId/approve`는 주문과 요청을 잠그고 미출고 활성 예약만 해제합니다. 이미 출고된 수량, 출고 원장과 정산 근거는 유지합니다.
- 승인 사유는 거래처가 제출한 원문으로 `order_cancellations`에 기록하며 주문 취소, 예약 해제, 재고 예약 감소, 검토 상태, 중복 요청 결과를 하나의 트랜잭션으로 확정합니다.
- `POST /api/admin/order-cancellation-requests/:requestId/reject`는 반려 사유를 기록하고 주문을 확정 상태로 유지해 출고 보류를 해제합니다.

### 역할별 화면

- `/portal/orders/history`에서 확정 주문의 미출고 잔량 취소를 요청합니다.
- 검토 중에는 요청 사유와 출고·추가 배정 보류를 표시하고, 반려 후에는 관리자 사유를 확인한 뒤 다시 요청할 수 있습니다.
- `/admin/orders`는 보류 주문에 `취소 요청`을 표시하고 요청 사유를 본 자리에서 승인하거나 사유를 입력해 반려합니다. 보류 중에는 재배정과 직접 취소 작업을 숨깁니다.
- `/admin/order-history`는 거래처 요청 원문, 요청자, 승인·반려 결과, 처리자와 처리 시각을 시간순 감사 기록으로 표시합니다.

## 검증 내용

- 같은 거래처 요청을 동시에 두 번 보내도 요청 행이 하나만 생성되는지 확인했습니다.
- 별도 요청 ID로 보류 요청을 중복 제출하면 거절되는지 확인했습니다.
- 검토 중 출고 큐 제외, 직접 출고·추가 배정·직접 관리자 취소 차단을 확인했습니다.
- 관리자 반려 사유가 거래처 이력에 표시되고 출고 큐가 다시 열리는지 확인했습니다.
- 부분 출고 2개 후 잔량 3개를 승인 취소해 재고 예약만 0으로 줄고 기존 매출 원장이 유지되는지 확인했습니다.
- 실제 브라우저에서 부분 출고·반품·정산·입금 이후 거래처 요청, 창고 보류, 관리자 승인, 거래처·관리자 이력 확인까지 수행했습니다.

## 검증 결과

- `node --env-file=.env.local scripts/migrate.mjs --development`: `0023` 적용
- `node --env-file=.env.local scripts/migrate.mjs --test`: `0023` 적용
- `npm.cmd run db:verify`: 통과
- `npm.cmd run build:api`: 통과
- `npm.cmd run build:web`: 통과, 19개 route 생성
- `npm.cmd run test:foundation`: 32건 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 취소 요청·보류·승인과 기존 원장 보존을 포함한 전체 업무 흐름 통과
- Playwright 1440px·390px: 거래처·관리자 화면 가로 넘침 없음

## 화면 검토 자료

- `docs/screenshots/sdtpl-customer-cancellation-request-desktop.png`
- `docs/screenshots/sdtpl-customer-cancellation-request-mobile.png`
- `docs/screenshots/sdtpl-admin-cancellation-review-desktop.png`
- `docs/screenshots/sdtpl-admin-cancellation-review-mobile.png`

현재 출고 모델에는 별도 피킹 시작 상태가 없습니다. 따라서 보류 요청은 아직 확정되지 않은 새 출고를 차단하며, 먼저 커밋된 출고는 유지하고 필요 시 반품 흐름으로 처리합니다.

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
