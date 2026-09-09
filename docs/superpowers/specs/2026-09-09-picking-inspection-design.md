# 피킹·검수 출고 통제 설계

## 목표

창고 출고를 `담당 배정 → 피킹 → 검수 → 출고` 순서로 강제하고, 부분 출고·수량 정정·작업 인계·취소 요청·중복 요청이 같은 재고 트랜잭션 안에서 일관되게 처리되도록 한다.

## 업무 규칙

- 주문 담당자만 피킹·검수·출고 수량을 변경할 수 있다.
- 예약 품목별 현재 피킹 수량과 검수 수량을 저장하며 `0 <= 검수 <= 피킹 <= 예약 잔량`을 유지한다.
- 피킹과 검수 명령은 품목별 현재 수량을 교체하는 방식이다. 검수된 수량 아래로 피킹을 낮출 수 없다.
- 출고 수량은 검수 수량을 넘을 수 없다. 출고 확정과 함께 피킹·검수 수량에서도 같은 수량을 차감한다.
- 부분 출고 후 남은 피킹·검수 수량은 다음 출고에 사용할 수 있다.
- 작업 반납 시 피킹·검수 상태를 보존해 다음 담당자가 이어받는다.
- 취소 검토 요청 시 미출고 피킹·검수 수량을 0으로 초기화하고 이력을 기록한 뒤 담당자를 자동 반납한다.
- 각 명령은 `requestId`로 멱등 처리하고 예약·작업 상태 행을 잠근다.

## 데이터와 API

- `shipment_work_lines`: 예약별 현재 `picked_quantity`, `inspected_quantity`, 수정자와 시각, version을 저장한다.
- `shipment_work_line_events`: 변경 전후 수량과 `picked`, `inspected`, `shipped`, `reset` 이벤트를 append-only로 저장한다.
- `POST /api/warehouse/shipments/orders/:orderId/pick`
- `POST /api/warehouse/shipments/orders/:orderId/inspect`
- 두 명령 본문은 `{ requestId, lines: [{ reservationId, quantity }] }`이다.
- 출고 대기 응답에는 `pickedQuantity`, `inspectedQuantity`, `shippableQuantity`를 포함한다.

## 화면

창고 작업 상세에서 품목마다 예약 잔량, 피킹, 검수, 출고 가능 수량을 함께 표시한다. 담당자는 피킹 저장, 검수 완료, 출고 확정을 단계별로 실행하며 각 입력의 최대 수량은 서버 규칙과 동일하게 제한한다.

## 완료 기준

- 미검수 수량의 출고가 API에서 거절된다.
- 동시 수정과 중복 명령에도 수량 제약과 이벤트 이력이 보존된다.
- 부분 출고, 담당 반납·재배정, 취소 검토 초기화가 통합 테스트로 검증된다.
- API와 Web build, DB 무결성 검사, 창고 화면 브라우저 검증을 통과한다.
