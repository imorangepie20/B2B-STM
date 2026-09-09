# 창고 검색, 불량 반품 처리, 운영 대시보드

## 변경 이유

창고 담당자는 긴 출고 대기 목록에서 상품을 빠르게 찾아야 하고, 불량 반품은 정상 재고 복귀와 별도로 보류 또는 폐기 결정을 기록해야 합니다. 관리자는 주문·재고·반품·입금의 우선 처리량을 한 화면에서 확인할 수 있어야 합니다.

## 변경 내용

- `/warehouse/shipments`에 SKU, 상품명, 거래처 기준의 출고 대기 검색을 추가했습니다.
- `0020_return_defect_dispositions.sql`로 불량 반품의 보류(`quarantine`)·폐기(`disposed`) 감사 기록을 추가했습니다.
- `POST /api/admin/returns/inspections/:inspectionId/defects`는 검사된 불량 수량을 초과하지 않도록 검증하고 중복 요청을 막습니다.
- `GET /api/admin/dashboard`와 관리자 첫 화면의 요약 카드는 처리 대기 주문, 재고 부족 상품, 처리 대기 반품, 미배분 입금을 표시합니다.

## 검증

- 반품 검사 뒤 불량 수량 보류 기록과 정상 재고 복귀 분리를 통합 테스트로 검증했습니다.
- 운영 대시보드 API 응답 구조를 통합 테스트로 검증했습니다.
- `npm.cmd run test:foundation` 27개 통과, `npm.cmd run db:verify` 통과, `npm.cmd run build:web` 통과.
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`로 Playwright 로그인 화면의 접근성과 모바일 폭을 검증했습니다.
