# 관리자 주문 이력·출고 원장·취소 감사 기록

## 변경 이유

관리자 주문 관리 화면은 처리 대상만 표시하므로 전량 출고된 주문을 다시 찾을 수 없었습니다. 실제 출고 건과 생성된 매출 원장이 주문 상세에서 연결되지 않았고, 주문 취소 사유는 명령 응답에만 포함되어 재조회와 감사가 불가능했습니다.

## 변경 내용

### 취소 감사 데이터

- migration `0022_order_cancellation_audit.sql`로 `order_cancellations`를 추가했습니다.
- 주문 ID를 기본키로 사용해 주문당 하나의 확정 취소 기록만 허용합니다.
- 비어 있지 않은 사유, 처리자, 처리 시각을 저장합니다.
- 예약 잔량 해제, 취소 기록 생성, 주문 상태 변경, 중복 요청 결과 저장을 같은 트랜잭션에서 처리합니다.
- 이미 존재하던 취소 주문은 추측한 사유로 채우지 않으며 화면에서 이전 데이터임을 구분합니다.

### 관리자 주문 이력 API

- `GET /api/admin/orders/history`는 접수·진행·완료·취소·거절 주문을 모두 최근 순으로 반환합니다.
- 주문 상태와 수량을 조합해 `submitted`, `in_progress`, `completed`, `cancelled`, `rejected` 이행 상태를 계산합니다.
- 각 주문에 주문·출고·예약·미확보·취소 수량과 취소 감사 기록을 포함합니다.
- 실제 `shipments`와 `shipment_lines`를 주문에 묶고 출고 시각·담당자·수량을 제공합니다.
- 각 출고 품목은 `receivable_entries`의 매출 원장 ID, 단가, 금액과 연결됩니다.
- 거래처 `GET /api/orders`에도 확정 취소 사유와 시각을 제공해 관리자 처리 결과를 확인할 수 있게 했습니다.

### 관리자 주문 이력 화면

- `/admin/order-history`를 추가하고 전역 메뉴와 주문 관리 화면에서 이동할 수 있게 했습니다.
- 진행·완료·취소 주문과 실제 출고 건수를 요약하고 주문번호, 거래처, 출고번호, SKU, 취소 사유로 검색합니다.
- 주문 상세에 수량 비교, 취소 사유·시각·처리자, 실제 출고 건과 매출 원장 ID를 표시합니다.
- 데스크톱은 목록·상세·원장 표를 한 작업 영역에 배치합니다.
- 모바일은 주문 품목과 출고 원장을 카드로 전환해 별도 가로 스크롤 없이 확인합니다.

## 테스트 보완

- 두 차례 부분 출고 후 관리자 처리 목록에서는 주문이 빠지지만 이력에는 `completed`로 남는지 검증합니다.
- 출고 2개·3개의 두 건과 각각의 매출 원장 ID·금액이 주문 이력에 연결되는지 검증합니다.
- 부분 출고 후 잔량 취소를 반복 전송해도 취소 감사 행이 하나만 생성되고 사유·처리자가 보존되는지 검증합니다.
- 관리자와 거래처 주문 이력에서 같은 취소 사유·시각을 조회하는지 검증합니다.
- 브라우저 E2E에서 부분 출고 후 관리자 주문 이력의 수량과 실제 출고 원장 표를 확인합니다.

## 검증 결과

- `npm.cmd run db:verify`: 통과
- `npm.cmd run build:api`: 통과
- `npm.cmd run build:web`: 통과, 19개 route 생성
- `npm.cmd run test:foundation`: 28건 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 관리자 주문 이력과 출고 원장 확인을 포함한 전체 업무 흐름 통과
- Playwright 1440px: 문서 폭 1440px, 가로 넘침 없음
- Playwright 390px: 진행 주문과 취소 주문 모두 문서 폭 390px, 가로 넘침 없음

## 화면 검토 자료

- `docs/screenshots/sdtpl-admin-order-history-desktop.png`
- `docs/screenshots/sdtpl-admin-order-history-mobile.png`
- `docs/screenshots/sdtpl-admin-order-history-cancelled-mobile.png`

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
