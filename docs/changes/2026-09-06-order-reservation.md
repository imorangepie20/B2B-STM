# 주문 접수와 재고 예약

거래처 주문은 접수 시점에 재고를 차감하거나 예약하지 않고 `submitted` 상태로 저장합니다. 운영 담당자가 MFA 인증을 마친 뒤 주문을 확정할 때, 해당 주문과 재고 잔액 행을 같은 PostgreSQL transaction에서 잠가 SKU별 가용수량만 `reserved_quantity`에 반영합니다.

`0009_orders_reservations.sql`은 `orders`, `order_lines`, `reservations`, `reservation_events`, `command_results`를 추가했습니다. 주문 품목은 SKU·상품명·판매단위를 당시 값으로 보존하며, 예약은 주문 품목 하나에 하나만 연결됩니다. 예약된 수량은 주문 수량과 보유 재고를 넘을 수 없습니다.

`POST /api/orders`는 거래처 역할만 사용할 수 있고, `POST /api/admin/orders/:orderId/confirm`과 `GET /api/admin/orders`는 MFA를 마친 `system` 또는 `operations` 역할만 사용할 수 있습니다. 모든 생성·확정 명령은 `requestId`를 요구하며, `(actor_id, command_type, request_id)`가 같으면 저장한 응답을 반환합니다. 같은 요청이 동시에 들어와도 advisory transaction lock으로 한 번만 반영합니다.

`scripts/tests/order-reservation.test.mjs`로 접수 시 미예약, 일부 예약, 동일 요청 재사용, 동시 확정에서 가용재고 상한을 검증했습니다. 관리자 주문 화면은 `/admin/orders`에서 접수 주문을 확인하고 확정 결과의 예약·미예약 수량을 안내합니다.
