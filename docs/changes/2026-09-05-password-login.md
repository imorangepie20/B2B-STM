# 비밀번호 로그인과 세션 발급

## 변경 이유

인증 스키마와 세션 검증 경계가 준비되어 실제 사용자가 로그인해 세션을 발급받는 흐름이 필요했습니다.

## 변경 내용

- `0003_password_login.sql`: `users.password_hash` 추가.
- `0004_login_failure_limits.sql`: 이메일/IP별 15분 실패 기록 테이블 추가.
- `0005_login_failure_permissions.sql`: 애플리케이션 역할에 실패 기록 처리에 필요한 최소 권한 부여.
- `POST /api/auth/login`: 이메일 정규화, 활성 계정 비밀번호 검증, 기존 세션 폐기, 새 세션 발급.
- 비밀번호는 서버 내부 `scrypt` 포맷으로 검증하고 원문을 저장하지 않습니다.
- 세션 원문은 HttpOnly·SameSite=Lax 쿠키로 한 번만 전달하며 DB에는 SHA-256 해시만 저장합니다.
- 실패 응답은 계정 존재 여부를 드러내지 않는 401로 통일하고, 실패가 5회를 초과하면 429를 반환합니다.

## 검증 결과

- `npm.cmd run build:api` 통과.
- test/development DB에 migration 적용 후 재실행 시 0건 확인.
- `npm.cmd run test:foundation` 6개 통과: health, DB 장애, 세션 권한 경계, 로그인 성공·세션 교체, 실패 제한, migration 동시성.

## 남은 범위

CSRF 토큰 검증, 초대·비밀번호 재설정, MFA 등록·검증은 다음 인증 작업에서 구현합니다.
