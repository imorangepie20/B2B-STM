# 상품·입고·재고 원장 기반

## 변경 이유

인증 후 제품 화면에 업무 메뉴가 없었던 근본 원인은 주문 전에 필요한 상품, 창고, 입고, 재고 원장 데이터 모델이 없었기 때문입니다. 주문 재고 예약이 현재 잔량과 분리된 기록을 기준으로 동작하도록 이 기반을 먼저 추가했습니다.

## 변경 내용

- `0008_catalog_inventory.sql` migration으로 `suppliers`, `warehouses`, `products`, `inventory_balances`, `receipts`, `receipt_lines`, `inventory_movements`를 추가했습니다.
- 상품/SKU, 공급처 코드, 창고 코드는 정규화된 대문자 값만 허용합니다.
- 재고 잔량은 `(warehouse_id, product_id)` 단위로 보관하며, `0 <= reserved_quantity <= on_hand_quantity` 제약을 DB에서 강제합니다.
- 입고 확정 기록과 재고 이동 기록을 분리해 이후 출고·반품·재고 정정이 동일한 원장을 참조하도록 했습니다.
- 입고 이동은 해당 입고 라인을 한 번만 참조할 수 있어 동일 입고의 중복 반영을 막습니다.

## 검증

- 개발 DB와 테스트 DB에 `0008_catalog_inventory.sql`을 각각 적용했습니다.
- 재고 예약이 보유 수량을 넘거나 음수 보유 재고를 만들려는 요청이 DB 제약으로 거부되는 테스트를 추가했습니다.
- `npm.cmd run test:foundation`: 17개 테스트를 통과했습니다.
- `npm.cmd run db:verify`를 통과했습니다.

## 다음 작업

이 스키마 위에 system/operations 역할의 상품·창고·입고 등록 API와 관리자 화면을 연결합니다. 재고 예약은 주문 확인 API에서 같은 트랜잭션으로 구현합니다.
