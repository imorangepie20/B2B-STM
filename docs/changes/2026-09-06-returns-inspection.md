# 출고 기준 반품 요청과 창고 검수

## 변경 이유

거래처가 출고 후 반품을 요청할 때 주문 단계의 수량을 기준으로 처리하면 부분 출고와 실제 재고 이동을 분리할 수 없다. 반품은 실제 `shipment_lines`를 기준으로 요청하고, 창고 검수 결과에 따라서만 재고를 복귀시켜야 한다.

## 구현 내용

- `0012_returns.sql`에서 `returns`, `return_lines`, `return_inspections`를 추가했다.
- 반품 요청은 고객 소유의 실제 출고 라인만 선택할 수 있으며, 같은 출고 건 안에서만 묶을 수 있다.
- 각 출고 라인의 누적 반품 요청 수량이 실제 출고 수량을 넘으면 `409 Conflict`로 거절한다.
- `requestId`와 `command_results`를 사용해 반품 요청과 검수 확정의 중복 호출을 같은 결과로 재생한다.
- 창고 검수는 부분 입고를 허용하고, 입고 수량을 정상 수량과 불량 수량으로 정확히 분리해야 한다. 불량 수량에는 사유가 필수다.
- 정상 수량만 `inventory_balances.on_hand_quantity`에 더하고, `inventory_movements`에 `movement_type='return'` 및 `return_inspection_id`를 남긴다. 불량 수량은 `return_inspections`에 수량과 사유로 보존하며 판매 가능 재고에는 넣지 않는다.
- 고객 화면은 `/portal/returns`, 창고 모바일 화면은 `/warehouse/returns`에 제공한다.

## 검증

- `node --env-file=.env.local --test scripts/tests/order-reservation.test.mjs`에서 고객 반품 요청, 동일 요청 재시도, 출고 수량 초과 차단, 정상 3·불량 1 검수, 정상 수량만 재고 복귀와 원장 기록을 검증했다.
- `npm.cmd run build:api`, `npx.cmd tsc --noEmit -p apps/web/tsconfig.json`, `npm.cmd run build:web`를 통과했다.
