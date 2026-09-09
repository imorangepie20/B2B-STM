# 정산 운영 화면 및 결제 재배분 보강

## 변경 이유

정산 원장만 조회할 수 있던 상태에서는 거래처·정산월별 정산 상태, 정산 근거, 미배분 입금과 취소 뒤의 재배분 가능 금액을 업무 화면에서 일관되게 확인하기 어려웠습니다.

## 변경 내용

- `GET /api/admin/settlements`에 `customerId`, `period` 필터를 추가했습니다. 각 정산은 거래처 정보, 정산 합계, 유효 배분 합계를 포함합니다.
- `/admin/settlements`에서 거래처·정산월을 필터링하고 정산별 출고 청구·반품 차감 근거 행을 조회합니다.
- `/admin/payments`에서 거래처 선택 입금 등록, 미배분 입금 선택, 같은 거래처의 마감 정산 배분, 입금 취소와 결제 이력을 제공합니다.
- 취소된 입금의 `unallocatedAmount`는 `0`으로 표시합니다. 취소 시 연결된 배분은 역분개되며, 새 입금으로 다시 배분할 수 있습니다.
- 마감된 정산의 출고 건에 대한 반품 차감은 다음 달 첫날의 `receivable_entries.business_date`로 기록되는지 통합 테스트로 검증했습니다.
- `/admin/settlement-drafts`에서 초안 생성 뒤 근거 행을 검토하고 정산을 마감할 수 있도록 보완했습니다.

## 검증

- `npm.cmd run build:api`
- `node --env-file=.env.local --test --test-name-pattern "settlement draft fixes" scripts/tests/order-reservation.test.mjs`
- `npm.cmd run build:web`

정산 통합 시나리오는 부분 출고 후 정산 초안·마감, 정산 목록 필터, 마감 후 반품 차감의 다음 달 이월, 입금 배분·취소·새 입금 재배분을 검증합니다.
