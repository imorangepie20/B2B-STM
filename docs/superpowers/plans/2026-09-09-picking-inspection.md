# Picking and Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검수 완료된 예약 수량만 출고할 수 있는 창고 피킹·검수 흐름을 구축한다.

**Architecture:** 예약별 현재 작업 상태와 append-only 이벤트를 분리한다. 기존 주문 담당자·예약·재고 잠금 트랜잭션에 피킹, 검수, 출고 차감을 결합한다.

**Tech Stack:** NestJS 11, PostgreSQL 16, Next.js 16, React 19

**Spec:** `docs/superpowers/specs/2026-09-09-picking-inspection-design.md`

## Global Constraints

- `0 <= inspectedQuantity <= pickedQuantity <= remainingQuantity`
- 모든 변경 명령은 UUID `requestId`로 멱등 처리한다.
- 창고 UI는 `SDTPL_ADM` 기반 기존 컴포넌트와 Geist Sans를 사용한다.

---

### Task 1: DB 상태와 실패 테스트

**Files:**
- Create: `apps/api/db/migrations/0029_shipment_picking_inspection.sql`
- Modify: `scripts/tests/order-reservation.test.mjs`

**Interfaces:**
- Produces: 예약별 작업 상태 테이블과 피킹·검수·출고 제약 통합 테스트

- [x] 미검수 출고, 초과 피킹·검수, 멱등 재전송, 부분 출고, 인계, 취소 초기화 테스트를 먼저 작성한다.
- [x] 기존 API에서 실패하는지 확인한다.
- [x] DB CHECK, FK, 조회 인덱스와 app/test role 권한 migration을 작성한다.

### Task 2: 피킹·검수 API와 출고 통제

**Files:**
- Modify: `apps/api/src/orders/order.service.ts`
- Modify: `apps/api/src/orders/order.controller.ts`

**Interfaces:**
- Produces: `setPickedQuantities(actorId, orderId, body)`, `setInspectedQuantities(actorId, orderId, body)`
- Consumes: `{ requestId, lines: [{ reservationId, quantity }] }`

- [x] 담당자와 예약을 잠그는 공통 작업 수량 명령을 구현한다.
- [x] queue에 세 작업 수량을 추가한다.
- [x] `ship`이 검수 수량을 검사하고 출고량만큼 차감하도록 수정한다.
- [x] 취소 요청이 상태를 초기화하고 이벤트를 기록하도록 수정한다.
- [x] 통합 테스트를 실행해 통과시킨다.

### Task 3: 창고 작업 화면

**Files:**
- Modify: `apps/web/src/app/warehouse/shipments/page.tsx`

**Interfaces:**
- Consumes: queue 작업 수량, pick/inspect API
- Produces: 단계별 피킹 저장·검수 완료·출고 UI

- [x] 품목별 단계 상태와 독립 입력을 추가한다.
- [x] 서버 제약과 같은 클라이언트 검증을 적용한다.
- [x] API와 Web production build를 실행한다.

### Task 4: 운영 검증과 문서 현행화

**Files:**
- Modify: `scripts/lib/operational-integrity.mjs`
- Create: `docs/changes/2026-09-09-picking-inspection.md`
- Modify: `docs/overview/current-development-context.md`

**Interfaces:**
- Produces: 작업 상태 무결성 검사와 구현·검증 근거

- [x] 비활성 예약 잔량과 수량 순서 위반 검사를 추가한다.
- [x] migration, foundation tests, builds, DB/운영 검사를 실행한다.
- [x] 화면을 브라우저에서 데스크톱·모바일 폭으로 확인한다.
- [x] 검증 결과와 다음 작업을 문서에 기록한다.
