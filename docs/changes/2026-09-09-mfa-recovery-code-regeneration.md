# MFA 복구 코드 재발급

## 변경 이유

최초 MFA 등록 때만 복구 코드를 받을 수 있어 코드 분실 시 관리자가 MFA 전체를 초기화해야 했습니다.

## 변경 내용

- `/admin/account-security`에서 본인 비밀번호와 새 TOTP 코드로 복구 코드 10개를 재발급합니다.
- 재발급 시 기존 복구 코드를 같은 트랜잭션에서 모두 폐기합니다.
- 새 코드는 응답 화면에서 한 번만 표시하며 DB에는 SHA-256 해시만 저장합니다.
- 사용한 TOTP 재전송, 잘못된 비밀번호, MFA 미확인 세션을 거부하고 `recovery_codes_regenerated` 감사 이벤트를 기록합니다.

## 검증

- migration `0026_mfa_recovery_code_regeneration.sql`을 개발·테스트 DB에 적용했습니다.
- 기존 코드 폐기, 새 코드 단회 사용, TOTP 재사용 차단을 포함해 foundation 60건과 API·웹 build가 통과했습니다.
