# 로컬 샘플 데이터와 운영 복구 검증

## 변경 이유

빈 개발 DB에서는 역할별 화면과 예외 업무 흐름을 바로 확인하기 어렵고, 백업 파일이 생성된다는 사실만으로 실제 복구 가능성을 보장할 수 없었습니다. 기존 데이터와 격리된 반복 가능한 샘플과 복원 후 원본 비교 절차가 필요했습니다.

## 변경 내용

- `scripts/lib/demo-seed.mjs`에 거래처 3곳, 상품 12개, 주문 6개의 고정 정의와 개발 DB 제한 검사를 추가했습니다.
- `scripts/seed-demo-data.mjs`가 입고·재고·주문·예약·부분 출고·취소 요청·반품·정산·입금을 하나의 트랜잭션으로 생성합니다.
- 샘플 주문번호 앞 8자리가 화면에서 서로 다르게 보이도록 고정 UUID를 구성했습니다.
- 비밀번호는 실행 시 무작위 생성하고 Git에서 제외된 `.demo-credentials.json`에만 저장합니다.
- `scripts/reset-demo-data.mjs`가 로컬 개발 DB의 DEMO 네임스페이스만 안전하게 초기화합니다.
- `apps/web/e2e/demo-data-smoke.cjs`가 거래처·창고·관리자 화면을 실제 Chromium에서 읽고 캡처합니다. 관리자 검증용 임시 세션은 검증 종료 시 삭제합니다.
- `scripts/verify-operations.mjs`는 API live/ready, 핵심 20개 테이블 수량, 6개 정합성 검사를 확인합니다.
- `scripts/rehearse-backup-restore.mjs`는 현재 DB를 custom-format으로 백업하고 임시 DB에 복원한 뒤 테이블 수량과 정합성 결과를 원본과 비교하고 임시 DB를 삭제합니다.

## 안전 장치

- 시드·초기화·복원 리허설은 명시적인 개발 옵션과 로컬 `/b2b_stm` DB만 허용합니다.
- 샘플이 일부만 존재하거나 로컬 자격 증명 파일 상태가 맞지 않으면 자동 덮어쓰기 없이 중단합니다.
- 시드 완료 전 정합성 위반이 있으면 전체 트랜잭션을 롤백합니다.
- 복원 리허설은 원본 DB를 수정하지 않고 별도 임시 DB에서 수행합니다.

## 검증 결과

- `npm.cmd run test:foundation`: 샘플 안전성·반복성 검사를 포함한 전체 테스트 통과
- `npm.cmd run demo:seed`: 3개 거래처, 12개 상품, 6개 주문, 반품 1건, 정산 2건, 입금 2건 생성
- `npm.cmd run demo:verify-browser`: 거래처 주문 내역, 창고 출고 큐, 관리자 운영·주문 화면 통과
- `npm.cmd run ops:verify`: API live/ready, 20개 테이블, 6개 정합성 검사 통과
- `npm.cmd run db:rehearse-restore`: 백업 123,496 bytes 생성, 임시 DB 복원 후 20개 테이블과 6개 정합성 검사 일치

