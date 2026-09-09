# 서버 세션과 역할 경계

최초 구현: 2026-09-06. 최종 갱신: 2026-09-09.

## 현재 구현

- 비밀번호 로그인, 서버 세션 cookie, 절대 만료와 2시간 유휴 만료
- Origin 검사, 세션에 묶인 CSRF 토큰, 로그아웃과 세션 폐기
- 이메일·IP별 로그인 실패 제한과 초기화 운영 명령
- customer, warehouse, operations, settlement, system 역할과 거래처 소속 검사
- 계정 초대·수락, 비밀번호 재설정, 활성·비활성 전환과 세션 철회
- SMTP 초대·재설정 전달 결과 및 실패 기록
- TOTP MFA 등록·검증, 복구 코드 단회 사용·재발급, 관리자 기기 초기화
- system·operations·settlement 업무 공간의 MFA 강제
- Web 보호 레이아웃의 세션·역할·MFA 선검사와 만료 시 로그인 이동
- 계정 상태와 MFA 초기화의 관리자 감사 로그

세션 토큰은 32바이트 난수이며 DB에는 SHA-256 해시만 저장합니다. `SessionGuard`를 기본 API guard로 사용하고 공개 endpoint를 명시적으로 제한합니다. 모든 업무 API는 화면 경로와 별도로 현재 역할과 거래처 범위를 검사합니다.

## 검증된 경계

- 비로그인 401, 역할 불일치·타 거래처 접근 403
- 역할 회수, 계정 차단, 세션 폐기·만료 다음 요청 거절
- 중복·잘못된 cookie, 외부 Origin, CSRF 누락 거절
- MFA 비밀 암호화, TOTP 재사용 방지, 복구 코드 단회 사용과 실패 제한
- 초대·재설정 token 단회 사용과 경쟁 요청
- 계정 비활성화와 MFA 초기화의 세션 즉시 철회
- 미인증 `/admin`, `/portal`, `/warehouse` 직접 접근의 로그인 화면 이동

최신 전체 검증은 `npm.cmd run test:foundation` 65/65와 역할별 Playwright 업무 E2E입니다.

## 남은 범위

- 실제 배포 환경의 보안 header·TLS·cookie 정책 최종 검수
- 장기 세션·인증 이벤트 보존 기간과 정리 배치
- 외부 IdP/SSO는 첫 운영 범위 밖입니다.

세부 변경은 [계정 생명주기](../changes/2026-09-06-account-lifecycle.md), [MFA](../changes/2026-09-06-mfa.md), [계정 이메일 전달](../changes/2026-09-09-account-email-delivery.md), [보호 업무 화면 세션 가드](../changes/2026-09-09-workspace-session-guard.md)를 참고합니다.
