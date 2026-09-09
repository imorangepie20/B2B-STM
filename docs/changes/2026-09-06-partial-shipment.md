# 창고 부분 출고

`0010_partial_shipments.sql`은 출고 이력 `shipments`, `shipment_lines`와 예약의 누적 출고수량 `shipped_quantity`를 추가했습니다. `inventory_movements`는 출고 품목 참조를 보관하며, 입고·출고 원장 행은 각각 해당 품목 참조가 있어야 합니다.

창고 역할은 `GET /api/warehouse/shipments/queue`에서 남은 예약수량을 확인하고 `POST /api/warehouse/shipments`로 실제 출고수량을 확정합니다. 명령은 하나의 주문·창고 안에서만 출고 품목을 묶으며, 예약·재고 잔액 행을 잠근 뒤 보유·예약수량을 동시에 차감합니다. 같은 `requestId` 재전송은 `command_results`의 원래 응답을 반환합니다.

`/warehouse/shipments`는 창고 계정 로그인 뒤 자동으로 열리는 모바일 우선 출고 화면입니다. 예약 잔여수량보다 큰 값은 API에서 거절되고, 같은 예약을 여러 출고로 나누어 처리할 수 있습니다.
