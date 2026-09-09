# 거래처 단가와 출고 미수 원장 구현 계획

상태: 구현·검증 완료. 체크박스는 당시 계획 기록입니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래처별 단가를 주문에 고정하고, 실제 출고 수량만큼 미수 원장을 한 번 생성한다.

**Architecture:** `customer_prices`는 현재 거래처 단가를 관리하고, 주문 제출 시 해당 금액을 `order_lines.unit_price`에 스냅샷으로 저장한다. 창고 출고 트랜잭션은 각 `shipment_line`에 1:1로 연결된 `receivable_entries`를 생성해 재고 차감과 금액 발생을 같은 커밋에서 보장한다.

**Tech Stack:** NestJS, PostgreSQL 16, Next.js, Node test runner

**Spec:** `docs/business-logic/returns-and-settlement-policy.md`

## Global Constraints

- 금액은 원 단위 정수 `bigint`로 저장하고 출고 당시 단가를 변경하지 않는다.
- 재고 예약·출고와 미수 원장은 단일 PostgreSQL 트랜잭션으로 처리한다.
- 고객은 자기 거래처 가격과 주문만 조회하고, 운영·시스템 역할은 MFA 후 기준 정보를 변경한다.
- 모든 명령은 `requestId` 재시도에서 중복 원장을 만들지 않는다.

### Task 1: 가격·금액 스키마

**Files:**
- Create: `apps/api/db/migrations/0013_customer_prices_receivables.sql`
- Test: `scripts/tests/order-reservation.test.mjs`

- [ ] 단가·주문 단가 스냅샷·출고 미수 테이블과 FK·유일 제약을 추가한다.
- [ ] 출고 라인 기준 중복 없는 미수 원장을 검증하는 통합 테스트를 작성한다.

### Task 2: 단가 조회와 주문 스냅샷

**Files:**
- Modify: `apps/api/src/catalog/catalog.service.ts`
- Modify: `apps/api/src/catalog/catalog.controller.ts`
- Modify: `apps/api/src/orders/order.service.ts`
- Test: `scripts/tests/order-reservation.test.mjs`

- [ ] 고객별 단가 등록 API와 운영자 권한을 추가한다.
- [ ] 주문 가능 상품 조회와 주문 제출이 고객 단가를 읽고 `order_lines.unit_price`에 고정하는지 테스트한다.

### Task 3: 출고 미수 생성과 조회

**Files:**
- Modify: `apps/api/src/orders/order.service.ts`
- Create: `apps/api/src/receivables/receivable.service.ts`
- Create: `apps/api/src/receivables/receivable.controller.ts`
- Modify: `apps/api/src/application.ts`
- Test: `scripts/tests/order-reservation.test.mjs`

- [ ] 출고 트랜잭션이 `shipment_line`마다 공급가 미수 1건을 생성하고 같은 요청 재시도에서 중복 생성하지 않음을 검증한다.
- [ ] MFA가 확인된 정산·시스템 역할의 거래처별 미수 원장 조회 API를 추가한다.

### Task 4: 운영 화면·문서·회귀 검증

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`
- Create: `apps/web/src/app/admin/settlements/page.tsx`
- Create: `docs/changes/2026-09-06-pricing-receivables-foundation.md`

- [ ] 관리자 화면에서 거래처 단가를 등록하고 미수 원장을 읽는다.
- [ ] API·웹 빌드, 전체 통합 테스트, DB 권한 검증과 HTTP 응답을 실행한다.
