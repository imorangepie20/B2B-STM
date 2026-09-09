# 초기 데이터 CSV 이관

## 변경 이유

실제 업체가 제공하는 거래처·상품·단가·재고를 수작업으로 하나씩 입력하지 않고, 반영 전 오류와 기존 데이터 충돌을 확인하면서 안전하게 초기화할 기능이 필요했습니다.

## 변경 내용

- `0024_initial_imports.sql`에 파일 hash와 반영 집계를 보존하는 `import_batches`, 행별 결과를 보존하는 `import_rows`를 추가했습니다.
- CSV parser가 UTF-8 BOM, 큰따옴표와 escaped quote, CRLF/LF, 고정 header, 최대 크기·행 수, 업무 코드 정규화를 처리합니다.
- `POST /api/admin/imports/preview`가 전체 파일을 읽고 생성·건너뜀·오류를 행별로 반환합니다.
- `POST /api/admin/imports/apply`가 파일 hash로 잠근 뒤 transaction 안에서 다시 검증하고 기준정보·단가·재고 원장을 반영합니다.
- `GET /api/admin/imports`가 최근 완료 batch 20개를 반환합니다.
- `/admin/imports`에 CSV 선택, 형식 예시 다운로드, 미리보기, 오류 표시, 반영과 이력 화면을 추가했습니다.
- 관리자 상단 navigation의 가로 공간을 조정해 1440px에서 메뉴가 줄바꿈되지 않게 했습니다.
- 운영 검증에 `import_batches`, `import_rows` 수량과 batch/행 집계 일치 검사를 포함했습니다.

## 안전 장치

- MFA를 완료한 `system`·`operations` 역할만 접근합니다.
- 같은 식별자의 기존 값이 다르면 자동 update하지 않습니다.
- 초기 재고가 이미 존재하면 덮어쓰지 않습니다.
- 같은 파일 hash의 순차·동시 재요청은 기존 batch 결과를 반환합니다.
- 오류 파일은 transaction 전체를 rollback합니다.
- 초기 재고는 `inventory_adjustments`와 `inventory_movements`에 원장을 남깁니다.

## 검증 결과

- parser 테스트: quoted UTF-8, 정규화, 중복, 숫자 오류, 참조 오류, header, 인용부호, 2,000행 제한 통과
- DB 통합 테스트: preview, 6개 유형 반영, 재고 원장 일치, 충돌 차단, 동시 반복 요청 통과
- API·웹 production build 통과
- 실제 Chromium: 파일 선택 → 미리보기 → 6행 반영 → 최근 이력 확인 통과
- 1440px 캡처에서 상단 메뉴 한 줄 유지와 가로 넘침 없음 확인
- `npm.cmd run test:foundation`: 전체 42개 통과
- `npm.cmd run db:verify`: 개발·테스트 앱/마이그레이션 역할과 환경 간 접근 차단 통과
- `npm.cmd run ops:verify`: API live/ready, 22개 테이블, 7개 정합성 검사 통과
- `npm.cmd run db:rehearse-restore`: 129,849 bytes 백업을 임시 DB에 복원하고 22개 테이블·7개 정합성 비교 통과
- 화면 캡처: [초기 데이터 이관](../screenshots/initial-import-admin.png)
