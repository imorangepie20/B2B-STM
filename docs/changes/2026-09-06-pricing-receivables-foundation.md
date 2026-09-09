# 거래처 단가와 출고 미수 원장

## 변경 이유

출고 금액은 주문 당시 거래처 단가를 보존해야 하며, 주문 접수나 재고 예약 단계에서는 미수가 발생하면 안 된다. 실제 출고된 수량을 기준으로만 정산의 근거를 남겨야 이후 반품 차감·월 마감·입금 배분이 같은 원장을 참조할 수 있다.

## 구현 내용

- `0013_customer_prices_receivables.sql`에서 `customer_prices`, `receivable_entries`를 추가하고 `order_lines.unit_price` 스냅샷 필드를 추가했다.
- 운영자 MFA 권한으로 거래처와 거래처별 상품 판매 단가를 등록하거나 갱신할 수 있다.
- 고객 주문 화면의 상품 조회는 활성 단가가 있는 품목만 보여 주고, 주문 제출은 그 단가를 `order_lines.unit_price`에 고정한다.
- 출고 처리에서 각 `shipment_line`에 연결된 미수 원장 한 건을 같은 트랜잭션으로 생성한다. `shipment_line_id` 유일 제약과 출고 명령의 `requestId` 재생으로 중복 미수를 방지한다.
- 정산 또는 시스템 역할은 MFA 인증 뒤 `/api/admin/receivables`에서 전체 출고 미수 원장을 확인할 수 있다. 고객은 `/api/receivables`로 자기 거래처 원장만 조회한다.
- 운영 화면은 `/admin/pricing`, 정산 원장 화면은 `/admin/settlements`에 추가했다.

## 범위와 다음 단계

이번 단계의 원장은 출고 발생 금액만 다룬다. 반품 금액 승인에 따른 차감, 월 정산 초안·확정, 입금 배분·취소·환불 기록은 출고 원장을 변경하지 않고 이후 별도 거래로 연결한다.

## 검증

- `scripts/tests/order-reservation.test.mjs`는 고객 단가가 주문에 고정되고, 부분 출고 2건에서 각각 20,000원·30,000원 미수가 생성되며 관리자 원장 조회와 일치함을 확인한다.
- `npm.cmd run test:foundation` 22개 통과, `npm.cmd run db:verify` 통과.
- `npm.cmd run build:api`, `npx.cmd tsc --noEmit -p apps/web/tsconfig.json`, `npm.cmd run build:web`를 통과했다.
