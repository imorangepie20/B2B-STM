# 목표 규모 성능 시험 설계

작성일: 2026-09-07

## 격리 원칙

성능 시험은 기존 Docker PostgreSQL 안의 `b2b_stm_perf`에서만 실행한다. `b2b_stm`과 `b2b_stm_test`에는 fixture를 만들거나 초기화하지 않는다. 모든 mutation 명령은 host가 `127.0.0.1` 또는 `localhost`이고 database가 정확히 `b2b_stm_perf`인지 검사한다.

적용된 migration 파일은 checksum 때문에 수정하지 않는다. 로컬 테스트용 앱·migration 역할의 자격 증명을 재사용하되 database는 분리한다. 성능 DB URL은 `.env.local`의 테스트 URL에서 database 이름만 바꿔 실행 시 파생하며 별도 비밀값을 저장하지 않는다.

## 데이터 프로필

| 프로필 | 거래처 | SKU | 주문 | 주문행 | 거래처 단가 |
|---|---:|---:|---:|---:|---:|
| `rehearsal` | 10 | 100 | 1,000 | 10,000 | 1,000 |
| `target` | 100 | 1,000 | 100,000 | 1,000,000 | 100,000 |

주문당 주문행은 10개로 고정한다. ID와 업무 코드는 결정적으로 생성해 같은 프로필을 다시 만들었을 때 건수와 분포를 재현한다. fixture 생성 후 실제 table count와 재고·예약 무결성을 대조한다.

## 실행 단계

1. 성능 DB가 없으면 명시적인 provisioning 명령으로 생성한다.
2. 기존 migration을 성능 DB에 적용한다.
3. `rehearsal` fixture를 생성하고 count·무결성·페이지 조회를 확인한다.
4. `target` fixture를 생성하고 `ANALYZE` 후 측정한다.
5. 30개 작업자, 조회 70%·변경 30%, 30분 workload를 실행한다.
6. 같은 SKU 동시 주문 확정 30건과 동일 요청 재전송 10회를 별도로 실행해 초과 예약과 중복 원장이 0건인지 확인한다.

## 판정과 기록

목록·상세 조회 p95 1초, 일반 mutation p95 2초, 예상하지 못한 5xx 0.1% 미만을 목표로 한다. 장비, PostgreSQL version, fixture count, 실행 시간, endpoint별 p50·p95·최대값, 오류와 무결성 결과를 JSON과 변경 문서에 남긴다.
