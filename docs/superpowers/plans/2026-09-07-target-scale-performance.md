# 목표 규모 성능 시험 구현 계획

상태: 성능 DB·fixture·workload·판정 도구와 rehearsal까지 구현했습니다. 주문 100,000건·동시 사용자 30명·30분 본 시험은 사용자 요청으로 중단했습니다.

1. 성능 DB URL, fixture 프로필, 예상 건수를 테스트 우선으로 구현한다.
2. `b2b_stm_perf` 전용 provisioning과 migration 명령을 구현한다.
3. 두 fixture 프로필을 set 기반 SQL로 생성하고 실제 건수·무결성을 검증한다.
4. API를 성능 DB에 연결해 페이지 조회 workload를 측정한다.
5. 동시 주문 확정과 중복 요청 재전송의 재고·원장 무결성을 검증한다.
6. rehearsal을 실행한 뒤 목표 규모 fixture와 본 시험을 실행한다.
7. 결과와 재실행 절차를 문서화하고 전체 회귀 검증을 수행한다.
