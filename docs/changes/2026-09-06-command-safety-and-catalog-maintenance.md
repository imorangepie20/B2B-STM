# 중복 요청 방지와 기준정보 유지보수

## 변경 이유

입금과 입고는 운영자가 버튼을 다시 누르거나 네트워크 응답을 받지 못해 요청을 재시도할 수 있습니다. 같은 요청이 두 번 반영되면 결제 잔액과 재고가 실제 값에서 벗어납니다. 또한 거래처·상품·단가는 등록 뒤에도 운영 정보가 바뀔 수 있습니다.

## 변경 내용

- `POST /api/admin/payments`, `POST /api/admin/payments/:id/allocations`, `POST /api/admin/payments/:id/void`는 `requestId`와 `command_results`를 사용해 멱등하게 처리합니다.
- `POST /api/admin/receipts`도 `requestId`를 사용해 동일 입고의 재반영을 막습니다.
- `0019_order_cancellation.sql`로 주문 상태에 `cancelled`를 추가했습니다.
- `POST /api/admin/orders/:orderId/cancel`은 미출고 예약만 해제하고, 이미 출고한 수량과 출고 원장은 유지합니다.
- 거래처명과 상품명·판매단위 수정, 개별 거래처 단가 비활성화, 단가 이력 조회 API를 추가했습니다.

## 검증

- 동시 결제 등록·배분 재시도가 동일 결과를 반환하는지 확인했습니다.
- 동시 입고 재시도가 재고와 입고 기록을 한 번만 생성하는지 확인했습니다.
- 부분 출고 뒤 주문 취소가 예약 잔량만 해제하는지 확인했습니다.
- 거래처·상품 수정, 단가 비활성화, 단가 이력 조회를 통합 테스트로 확인했습니다.
