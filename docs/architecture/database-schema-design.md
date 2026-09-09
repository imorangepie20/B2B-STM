# DB 스키마 설계 초안

2026-09-05 작성, 2026-09-07 구현 현황 갱신. 아래 표는 전체 설계안이며 구현된 영역은 관련 migration과 변경 기록을 기준으로 확인합니다.
기준은 확정 업무·기술 구조입니다. 인증과 금액의 구체 필드는 미승인 통합 설계안에 의존합니다.

## 공통 규칙

- 내부 PK는 UUID, 사용자 표시 번호는 별도 유일 키입니다. 표시 번호를 인증 수단으로 사용하지 않습니다.
- 시각은 `timestamptz`, 업무 귀속일·지급일은 `date`로 구분합니다.
- 변경 가능한 집계 행은 `version`, 생성·변경 시각을 갖습니다. 확정 원장은 삭제·덮어쓰기 대신 반대 거래를 추가합니다.
- 수량은 고정 포장 단위 정수입니다. 금액은 정확한 decimal 저장을 사용하며 구체 정밀도는 금액 정책 승인 후 고정합니다.
- 거래 이력이 참조하는 상품·거래처는 비활성화하며 cascade 삭제하지 않습니다.
- 조회용 합계와 원본 원장의 대조 방법을 함께 둡니다. 여러 행의 합계를 단일 CHECK로 보장했다고 간주하지 않습니다.

## 테이블과 관계

| 영역 | 테이블 제안 | 주요 필드·관계 |
|---|---|---|
| 거래처 | customers | code 유일, name, active, payment_terms, version. 거래처별 잠금 기준 행 |
| 사용자 | users, user_roles | 정규화 email 유일, customer_id 선택, 계정 구분·활성·역할. 내부/거래처 역할 혼합 금지 |
| 인증 | sessions, account_tokens, mfa_credentials | 사용자 FK, 토큰 해시·용도·만료·폐기. MFA 비밀은 암호화. 인증안 승인 조건부 |
| 기준 정보 | suppliers, products, customer_prices | SKU 유일, 포장 단위, 거래처+상품 가격, 유효 정보·version |
| 창고 | warehouses, inventory_balances | 첫 버전 창고 1개, (warehouse_id, product_id) 유일, 정상·예약·검수대기·불량·보류·version |
| 입고 | receipts, receipt_lines | 공급처·확정 상태·상품·수량·단위 스냅샷 |
| 주문 | orders, order_lines | 거래처·표시 번호·출고 조건·배송 스냅샷, 품목별 상품명·단가·세금 정책·포장 스냅샷 |
| 취소 | order_cancellations, order_cancellation_requests | 확정 취소의 주문 FK·사유·처리자·시각. 거래처 요청의 사유·상태·요청자와 승인/반려 처리자·시각·사유 |
| 예약 | reservations, reservation_events | 주문 품목·재고 FK, 현재 예약 수량, 예약/해제/출고 소비 이벤트 |
| 물류 | shipments, shipment_lines | 주문·담당자·version·진행 상태, 주문 품목·예약·피킹·검수·출고 수량 |
| 재고 원장 | inventory_movements | 잔액 행 FK, 버킷·부호 있는 수량, 업무 원인·참조·반대 거래 FK |
| 반품 | returns, return_lines | 거래처·회수 상태, 원출고 품목·요청·승인 수량 |
| 반품 실물 | return_receipts, return_inspections | 반품 품목·분할 도착·정상/불량 검수·고객 반환/폐기 기록 참조 |
| 반품 금액 | return_credits, return_credit_lines | 원반품·원출고·인정 수량·공급가액·세액·확정 상태 |
| 실사 | stock_counts, stock_count_lines, inventory_adjustments | 실측 시각·SKU·수량·기준 version, 정정 승인·사유·예약 조정 참조 |
| 정산 거래 | receivable_entries | 거래처·귀속일·종류·공급가액·세액·원출고/차감/기초잔액 참조 |
| 월 정산 | settlements, settlement_lines | 거래처+월 유일, 초안/확정·지급일·version. 각 정산 항목은 원거래 FK |
| 입금 | payments | 거래처·입금일·원금·은행 참조·취소 원기록·version |
| 배분 | allocations, allocation_reversals | 입금 또는 확정 크레딧 출처, 대상 청구·금액, 역처리 참조 |
| 환불 | refunds | 입금 또는 크레딧 출처·실제 송금일·금액·참조·취소 기록 |
| 공통 | command_results, audit_events, outbox_jobs | 요청 유일키·본문 해시·결과 참조, 작업자/업무 이력, 작업 lease·재시도 |
| 출고 담당 | shipment_work_assignments, shipment_work_assignment_events | 주문별 현재 담당 1명, 시작·반납·완료·취소 이력과 사유 |
| 피킹·검수 | shipment_work_lines, shipment_work_line_events | 예약별 현재 피킹·검수 수량, 정정·출고·초기화 이력 |
| 첨부·이관 | attachments, import_batches, import_rows | 비공개 저장 키·검사 상태·업무 참조, 파일 해시·행 오류·실행 결과 |

테이블 개수 자체가 목표가 아닙니다. 다중 버킷 이동·원거래 추적·분할 반품과 금액 인정의 독립성을 유지할 때 필요한 경계입니다.
예약 이벤트·실사 정정처럼 다중 원인 참조가 필요한 경우 명시적 FK 또는 원인별 연결 테이블을 사용합니다.
단순 문자열 `source_type/source_id`만으로 참조 무결성을 보장했다고 주장하지 않습니다.

## 핵심 제약

1. 주문 품목: 주문 수량 > 0, 취소·출고·예약 누계 >= 0, 취소+출고+예약 <= 주문 수량.
2. 재고 잔액: 각 버킷과 예약 >= 0, 예약 <= 정상 보유. 실사 부족은 보류·예약 조정 후 정정합니다.
3. 작업 품목: 검수 <= 피킹 <= 작업 배정 수량. 출고 확정량은 검수량 이내이며 해당 주문 잔량을 초과하지 않습니다.
4. 반품: 다른 요청을 포함한 유효 요청 총량 <= 원출고량. 입고·검수·인정 총량은 각 선행 단계의 잔량 이내입니다.
5. 배분·환불: 출처는 입금 또는 확정 크레딧 중 정확히 하나. 출처와 대상의 거래처가 같아야 합니다.
6. command_results: (actor_id, command_type, request_id) 유일. 성공 결과와 업무 변경을 함께 커밋합니다.
7. 정산 거래: 한 출고 품목 또는 한 차감 품목에 원거래 1건. 취소/정정 거래는 별도 원거래를 참조합니다.
8. settlement_lines: receivable_entry_id 유일. 정산 초안 재생성은 그 초안 소유 항목만 교체하며 확정 항목은 고정합니다.
9. 금액: 유효 배분+환불이 출처 원금/크레딧을 초과하지 않고 청구 배분이 미수보다 크지 않아야 합니다.

단일 행 제약은 DB CHECK·NOT NULL·유일 키로, 다중 행 누계는 공통 잠금·트랜잭션으로 검증합니다.
거래처 일치 참조는 가능한 경우 (customer_id, id) 복합 유일키와 FK로 강제합니다.
실제 DDL 작성 시 모든 관계의 제약 위치를 확인합니다.

## 상태와 책임

- 주문: submitted → confirmed 또는 rejected, confirmed → cancelled. 부분 출고·완료는 수량에서 계산하고 승인 상태와 구분합니다.
- 취소 요청: submitted → approved 또는 rejected. 주문별 검토 중 요청은 하나만 허용하고 승인 시 주문 취소와 미출고 예약 해제를 같은 트랜잭션에서 처리합니다.
- 출고: ready → picking → inspected → shipped. 취소/보류는 원인과 해제 이력을 남깁니다.
- 현재 출고 구현은 주문별 단일 담당을 배정하고 부분 출고 동안 유지합니다. 전량 출고 또는 취소 시 현재 담당을 제거하되 이벤트 이력은 보존합니다.
- 반품: 요청 승인 상태, 실물 처리 상태, 금액 인정 상태를 각각 관리합니다.
- 정산: draft → finalized. 확정 이후 오류는 조정 거래로 처리합니다.
- 입금: recorded → voided. 배분 해제와 원기록 보존을 같은 트랜잭션에서 처리합니다.
- 작업 큐: pending → running → succeeded/failed. lease 만료 작업만 회수하며 이전 실행기의 늦은 완료는 소유권 토큰으로 거절합니다.

초기 재고와 기초 미수도 원장 거래로 입력합니다. 임의 잔액 UPDATE만으로 이관하지 않습니다.
기초 크레딧 등 추가 초기 항목 필요 여부는 실제 이관 데이터로 확인합니다.

## 실사 정정의 동시성 보완

실사 시작 시 해당 SKU 작업을 보류하고 물리 이동 중단 여부를 확인합니다. 진행 중 작업이 끝나기 전에 실측을 확정하지 않습니다.
관련 주문·거래처 목록은 변경될 수 있으므로 정정 시 잠금 규약 순서로 잠근 뒤 관련 예약 집합을 다시 확인합니다.
새 참조가 생겼다면 트랜잭션을 중단하고 다시 읽으며 SKU 잠금을 가진 채 거래처 잠금을 뒤늦게 추가하지 않습니다.
보류 상태는 입고·출고·반품 복귀 등 모든 물리 이동 명령에서 검사해야 합니다.

## 조회 인덱스와 이관

- 주문: (customer_id, created_at, id), (approval_status, created_at, id).
- 출고 작업: (status, assignee_id, created_at, id).
- 원장: (inventory_balance_id, occurred_at, id), 정산 거래: (customer_id, business_date, id).
- 작업 큐: (status, available_at, id), 세션: token_hash 유일·만료 정리 인덱스.
- 첫 마이그레이션부터 FK 역참조와 자주 쓰는 목록 필터를 확인하고 실제 쿼리 계획으로 추가 인덱스를 판단합니다.
- migration은 전용 계정으로 실행하며 앱 시작 때 자동 destructive sync를 하지 않습니다.
- PostgreSQL 16의 빈 테스트 DB 생성→migration→seed→업무 검증→재실행 검사를 수행합니다.

핵심 주문·예약·출고·반품·정산·입금·계정·출고 담당·피킹·검수·실사 테이블은 `0032_stock_counts.sql`까지 migration과 실제 PostgreSQL 통합 테스트를 적용했습니다. 이 문서의 다중 재고 버킷, 환불·outbox·첨부 관련 테이블은 목표 설계이며 아직 모두 구현된 것은 아닙니다. 목표 규모 30분 부하 본 시험은 사용자 요청으로 중단돼 있습니다.
