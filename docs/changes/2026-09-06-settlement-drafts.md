# 월 정산 초안과 확정

- `0016_settlements.sql`로 거래처·귀속월 유일 정산과 원장 항목 유일 정산 라인을 추가했다.
- `POST /api/admin/settlements`는 아직 포함되지 않은 해당 월 미수 원장을 초안에 고정한다.
- `POST /api/admin/settlements/:id/finalize`는 초안만 확정하며 확정 후 재확정을 거절한다.
- `/admin/settlement-drafts`에서 초안 생성과 확정을 제공한다.
- 통합 테스트는 동시 초안 요청에서 한 건만 생성되고, 확정 뒤 재확정이 차단됨을 검증했다.
