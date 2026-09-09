# 피킹·검수 기반 출고 통제

## 변경 이유

기존 출고 API는 예약 잔량만 확인해 피킹과 검수 기록 없이 재고를 차감할 수 있었습니다. 실제 창고에서는 집품 수량과 검수 완료 수량을 분리하고 검수된 수량만 출고해야 오출고와 동시 작업 오류를 추적할 수 있습니다.

## 변경 내용

- `0029_shipment_picking_inspection.sql`에 예약별 현재 피킹·검수 상태와 append-only 변경 이벤트를 추가했습니다.
- `POST /api/warehouse/shipments/orders/:orderId/pick`, `POST /api/warehouse/shipments/orders/:orderId/inspect`를 추가했습니다.
- 출고는 검수 완료 수량을 잠그고 그 범위 안에서만 처리하며, 부분 출고량을 피킹·검수 잔량에서 함께 차감합니다.
- 작업 반납 후에도 수량을 보존하고, 취소 검토 요청과 주문 취소 시에는 수량을 초기화하고 사유를 기록합니다.
- `/warehouse/shipments`를 피킹·검수·출고 3단계 작업 화면으로 변경했습니다.
- 감사 로그와 운영 무결성 검사에 피킹·검수 작업 상태를 포함했습니다.

## 검증

- 검수 없는 출고가 실패하는 TDD red 상태를 먼저 확인했습니다.
- 피킹 초과, 검수 초과, 멱등 재전송, 부분 출고 잔량, 작업 인계, 취소 초기화를 PostgreSQL 통합 테스트에 추가했습니다.
- `npm.cmd run test:foundation`: 66/66 통과
- `npm.cmd run build:api`, `npm.cmd run build:web`: production build 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 피킹→검수→부분 출고를 포함한 전체 업무 흐름 통과
- `npm.cmd run db:verify`, `npm.cmd run ops:verify`: 26개 테이블 스냅샷과 9개 무결성 검사 통과
- `npm.cmd run demo:verify-browser`: 담당 작업의 피킹 4개·검수 2개 실제 표시 확인
- `npm.cmd run ui:verify-recent`: 13개 화면의 데스크톱·모바일 26/26 통과
