# 부분 출고 구현 계획

상태: 구현·검증 완료. 현재는 주문별 창고 담당과 인계까지 확장됐습니다.

**Goal:** 창고 담당자가 확정 주문의 예약수량을 나누어 출고하고 재고원장에 남긴다.

**Architecture:** 예약은 `shipped_quantity`로 누적 출고량을 보관한다. 출고 명령은 예약·재고 잔액을 행 잠금으로 읽어 잔여 예약수량만 출고하고, `shipments`, `shipment_lines`, `inventory_movements`, `command_results`를 같은 transaction에서 기록한다.

**Tech Stack:** NestJS, PostgreSQL 16, Next.js, Node.js test runner

**Spec:** `docs/business-logic/order-and-allocation-policy.md`

### Task 1: 출고 데이터 모델

- [ ] `shipments`, `shipment_lines`, 예약 출고 누적수량, 출고 재고원장 FK를 migration으로 추가한다.
- [ ] 예약수량을 초과하는 출고와 원장 참조 누락이 DB·transaction에서 차단되는 테스트를 작성한다.

### Task 2: 창고 API

- [ ] 창고 대기열과 부분 출고의 실패 테스트를 작성한다.
- [ ] `GET /api/warehouse/shipments/queue`, `POST /api/warehouse/shipments`를 구현한다.
- [ ] 중복 요청 재사용과 여러 차례 출고의 재고·예약 수량을 검증한다.

### Task 3: 창고 모바일 화면과 기록

- [ ] `/warehouse/shipments` 화면에서 출고 대기열과 수량 입력을 제공한다.
- [ ] 빌드·전체 테스트·실행 서버 경로를 검증하고 변경 기록을 작성한다.
