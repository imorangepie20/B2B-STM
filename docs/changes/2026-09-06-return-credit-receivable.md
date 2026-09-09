# 검수 반품의 금액 차감 원장

## 변경 이유

반품 검수와 재고 복귀는 물류 기록이며, 거래처 미수 차감은 운영자의 금액 승인으로 별도 처리해야 한다. 이미 생성된 출고 미수나 확정된 정산 기록을 직접 수정하면 감사 추적과 마감 보존이 깨진다.

## 구현 내용

- `0014_return_credits.sql`에서 검수 건별 `return_credits`와 음수 `receivable_entries` 참조를 추가했다.
- `0015_receivable_credit_amount_check.sql`에서 출고 원장은 양수, 반품 차감 원장은 음수로 저장하면서 절대 금액이 수량×원출고 단가와 일치하도록 제약을 보완했다.
- 운영자 MFA 권한은 `POST /api/admin/returns/inspections/:inspectionId/credit`으로 검수 수량 이내의 인정 수량을 승인한다.
- 승인 시 `return_credits`와 `entry_type='return_credit'` 음수 미수 원장을 같은 트랜잭션으로 만든다. 원출고 `order_lines.unit_price`를 그대로 사용한다.
- 동일 검수 건은 한 번만 승인할 수 있으며, 같은 `requestId` 재시도는 저장된 결과를 재생한다.
- 미승인 검수 목록은 `GET /api/admin/returns/credits/pending`, 운영 화면은 `/admin/return-credits`에서 확인하고 승인한다.

## 검증

- 반품 통합 테스트에서 5개 출고 후 정상 3·불량 1 검수, 정상 재고 복귀, 검수 대기 목록, 3개 인정 차감, 원출고 단가 10,000원과 -30,000원 미수 원장을 확인했다.
- `npm.cmd run test:foundation` 22개 통과, `npm.cmd run db:verify` 통과.
- API·웹 빌드 및 TypeScript 검사를 통과했다.
