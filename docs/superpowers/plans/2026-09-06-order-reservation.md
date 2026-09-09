# 주문·재고 예약 구현 계획

상태: 구현·검증 완료. 체크박스는 당시 계획 기록이며 현재 완료 상태는 [제품 구현 현황](2026-09-05-product-delivery-plan.md)을 기준으로 합니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래처 주문을 접수하고, 운영 담당자가 확정할 때만 가용재고 범위에서 예약한다.

**Architecture:** `orders`와 `order_lines`는 접수 상태와 당시 상품 정보를 보존한다. 확정 명령은 한 PostgreSQL transaction 안에서 주문·재고 행을 잠근 뒤 `reservations`, `reservation_events`, `command_results`를 함께 기록한다. 요청 키가 같은 명령은 저장된 결과를 반환한다.

**Tech Stack:** NestJS, `pg`, PostgreSQL 16, Node.js test runner

**Spec:** `docs/business-logic/order-and-allocation-policy.md`, `docs/architecture/database-schema-design.md`

## Global Constraints

- 주문 접수는 `submitted` 상태만 생성하며 재고를 예약하지 않는다.
- 주문 확정은 `system` 또는 `operations` 역할과 MFA 인증이 필요하다.
- 예약 수량은 `on_hand_quantity - reserved_quantity`를 넘지 않고, 부족하면 가능한 수량만 예약한다.
- 동일 `(actor_id, command_type, request_id)`는 동일 결과를 돌려주며 업무 변경을 중복 실행하지 않는다.
- 의미 있는 변경은 `docs/`에 한국어로 기록한다.

---

### Task 1: 주문·예약 데이터 제약

**Files:**
- Create: `apps/api/db/migrations/0009_orders_reservations.sql`
- Test: `scripts/tests/order-reservation.test.mjs`

- [x] 주문, 주문 품목, 예약, 예약 이력, 명령 결과 테이블과 필요한 FK·CHECK·고유 제약을 작성한다.
- [x] 주문 수량과 예약 상태가 DB 제약으로 보호되는 테스트를 먼저 작성하고 실패를 확인한다.
- [x] migration을 개발·테스트 DB에 적용하고 테스트를 통과시킨다.

### Task 2: 주문 접수와 확정 API

**Files:**
- Create: `apps/api/src/orders/order.service.ts`
- Create: `apps/api/src/orders/order.controller.ts`
- Modify: `apps/api/src/application.ts`
- Test: `scripts/tests/order-reservation.test.mjs`

- [x] 고객 주문 접수, 권한 차단, 재고 미예약을 검증하는 실패 테스트를 작성하고 실패를 확인한다.
- [x] 최소 주문 서비스와 controller를 작성해 테스트를 통과시킨다.
- [x] 중복 요청 재사용, 일부 예약, 동시 확정의 가용재고 상한을 검증하는 실패 테스트를 작성하고 실패를 확인한다.
- [x] 주문·재고 행 잠금 transaction과 `command_results` 재사용을 구현해 테스트를 통과시킨다.

### Task 3: 관리자 주문 조회·화면 연결

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create or Modify: `apps/web/src/app/admin/orders/page.tsx`
- Create or Modify: `apps/web/src/app/admin/orders/orders.css`
- Modify: `docs/overview/current-development-context.md`
- Modify: `docs/README.md`
- Create: `docs/changes/2026-09-06-order-reservation.md`

- [x] 관리자 주문 목록과 확정 API 응답을 표시하고, `/admin/orders`에서 직접 이동할 수 있게 한다.
- [x] 화면 빌드와 모바일 화면 검증을 수행한다.
- [x] 변경 이유, 업무 흐름, 검증 결과를 문서화한다.
