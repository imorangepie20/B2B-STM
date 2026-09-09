# 정산·입금·배분 기반

- 거래처별 월 정산 초안과 확정, 항목 유일 제약을 추가했다.
- 출고·반품 차감 원장을 정산 상세와 거래처 포털에서 조회할 수 있다.
- 입금 등록, 확정 정산 배분, 잔액 초과·거래처 불일치 차단, 취소와 배분 역처리를 구현했다.
- 미배분 입금은 `GET /api/admin/payments`와 `GET /api/payments`에서 확인한다.
- `npm.cmd run build:web`, `npm.cmd run test:foundation` 23개, `npm.cmd run db:verify`를 통과했다.
