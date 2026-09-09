# MFA 기기 재등록과 복구 코드 폐기

## 변경 이유

TOTP 기기를 분실하거나 교체한 사용자가 기존 MFA를 통과할 수 없을 때, system 관리자가 세션과 복구 코드를 함께 폐기하는 운영 절차가 필요했다. 기존 구현은 사용자 본인의 TOTP 확인 또는 복구 코드 사용만 지원했다.

## 변경 내용

- `0021_mfa_device_recovery.sql`에서 `mfa_events`에 `reset`, `identity_events`에 `mfa_reset` 이벤트를 추가했다.
- `mfa_device_resets`에 대상 계정, 실행자, 사유, 시각을 보존한다.
- `POST /api/auth/users/:id/mfa-reset`은 MFA를 완료한 active `system` 역할만 실행할 수 있다. 대상은 MFA가 등록된 active 계정으로 한정하며 자기 계정 초기화는 거절한다.
- 한 트랜잭션에서 TOTP 비밀값·등록 상태·재사용 방지값·실패 잠금을 초기화하고, 복구 코드와 활성 세션을 폐기한 뒤 감사 이벤트를 기록한다.
- `requestId`와 `command_results`를 사용해 같은 초기화 요청을 한 번만 반영한다.
- `GET /api/auth/users/mfa-enrolled`과 `/admin/account-security`을 추가했다. 화면에서는 사유와 폐기 확인을 모두 입력해야 요청할 수 있다.

## 검증 결과

- `npm.cmd run build:api` 통과
- `npm.cmd run build:web` 통과
- `npm.cmd run test:foundation` 통과: 28건
- `npm.cmd run db:verify` 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web` 통과
- 로컬 재시작 후 `GET /api/health/ready`, `GET /admin/account-security`가 모두 `200`으로 응답함을 확인했다.

## 2026-09-07 화면 밀도 보정

- 공통 인증 화면의 큰 제목 규칙이 보안 화면에 적용되던 문제를 전용 CSS로 재정의했다.
- 제목을 26px, 본문을 13~14px로 낮추고 카드 여백·목록 행·버튼 높이를 줄였다.
- 보안 화면의 최대 폭을 880px로 조정해 목록과 초기화 양식이 과도하게 좁아지지 않게 했다.

## 2026-09-07 한글 웹폰트 적용

- `pretendard` 패키지의 동적 서브셋 가변 폰트를 웹 앱에 포함했다.
- 외부 CDN 요청 없이 `Pretendard Variable`을 기본 글꼴로 사용하고, 시스템 한글 글꼴은 대체 글꼴로 유지한다.

## 2026-09-07 전체 화면 타이포그래피 정리

- 주문·재고·반품·단가·정산 화면에서 직접 지정하던 `Arial`과 `Georgia`를 제거하고 Pretendard 상속으로 통일했다.
- 공통 제목은 24~30px, 업무 화면 제목은 24~28px, 설명 문구는 13px로 맞췄다.
- 주문·출고·재고 정정 화면 카드 여백과 주요 버튼 높이를 조정해 보안 화면과 비슷한 정보 밀도를 유지한다.
