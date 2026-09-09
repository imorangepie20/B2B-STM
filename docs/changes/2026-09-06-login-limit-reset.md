# 개발 로그인 제한 초기화

## 변경 이유

초기 관리자 계정이 로컬 제품 웹에서 여러 번 로그인에 실패해 이메일 및 loopback IP 기준 로그인 제한에 도달했습니다.

## 변경 내용

- `scripts/reset-login-limits.mjs`와 `npm.cmd run auth:reset-login-limit`을 추가했습니다.
- `RESET_LOGIN_EMAIL`에 지정한 계정의 이메일 제한 기록과 로컬 개발 환경의 `127.0.0.1`, `::1`, `::ffff:127.0.0.1` IP 제한 기록만 트랜잭션으로 삭제합니다.
- 스크립트는 `b2b_stm` 개발 DB만 허용하며, 비밀번호·사용자·세션·MFA 데이터는 수정하지 않습니다.

## 검증

- 로컬 system 관리자 계정을 대상으로 제한 기록 10건을 삭제했습니다.
- `npm.cmd run admin:verify`로 초기 관리자 계정과 MFA 암호화 키가 계속 준비된 상태임을 확인했습니다.
