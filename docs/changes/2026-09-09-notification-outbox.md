# 주문·출고·정산 알림 Outbox

작성일: 2026-09-09.

## 변경 이유

주문 제출, 출고 생성, 정산 마감의 DB 반영과 메일 발송을 한 요청에서 직접 처리하면 외부 SMTP 장애가 핵심 업무 transaction을 실패시키거나, 재요청 때 같은 메일이 중복 발송될 수 있습니다. 업무 결과와 알림 의도를 같은 transaction에 기록한 뒤 별도 worker가 전달하도록 분리했습니다.

## 구현 내용

- `notification_outbox`에 이벤트·업무 대상·수신자·제목·본문·상태·시도 횟수·다음 시도 시각을 저장합니다.
- 주문 제출은 운영 담당자, 출고 생성과 정산 마감은 해당 거래처의 활성 사용자에게 알림을 적재합니다.
- 업무 transaction 안에서 outbox를 함께 기록하므로 업무 반영만 되고 알림이 유실되는 구간을 없앴습니다.
- 이벤트·업무 대상·수신자 unique 제약으로 중복 요청과 여러 API 인스턴스의 중복 적재를 막습니다.
- worker는 `FOR UPDATE SKIP LOCKED`로 최대 20건을 점유하고, 실패 시 지수 간격으로 최대 8회 재시도합니다. 5분 이상 멈춘 처리 건도 다시 회수합니다.
- `/admin/notifications`에서 최근 200건과 대기·완료·실패 수를 확인하고, 대기 건 처리와 실패 건 수동 재시도를 실행할 수 있습니다.
- 로컬 데모에는 대기·완료·실패 상태를 각각 1건씩 제공합니다. 실제 자동 발송은 SMTP와 `NOTIFICATION_WORKER_ENABLED=true`를 설정한 환경에서만 동작합니다.

## 검증 결과

- 개발·테스트 DB에 `0038_notification_outbox.sql` 적용
- 업무 transaction 적재, 중복 방지, 거래처 수신자, 실패 초기화 통합 테스트 통과
- API와 Web production build 통과
- 인증된 `GET /api/admin/notifications`: HTTP 200, 데모 3건과 `failed·pending·sent` 상태 확인
- `GET /admin/notifications`: HTTP 200
- `npm.cmd run ops:verify`: 36개 테이블과 15개 무결성 검사 통과

장시간 전체 회귀 테스트 재실행은 사용자 요청으로 중단했습니다. 기존 테스트는 유지하며 이후 큰 기능 완료 시점에만 실행합니다.
