# 제품 웹 인증 화면 연결

## 변경 이유

초기 관리자 계정과 MFA API가 준비되어 있었지만, 실제 사용자가 브라우저에서 로그인하고 MFA를 등록할 제품 화면이 없었습니다. `theme-preview/`는 디자인 검토 전용이므로 운영 API와 연결하지 않습니다.

## 변경 내용

- `apps/web`에 Next.js 제품 웹 workspace를 추가했습니다.
- 밝은 테마의 로그인 화면에 이메일·비밀번호 입력, 오류 표시, 모바일 폭 대응을 구현했습니다.
- `/api/:path*`를 `API_BACKEND_ORIGIN`(기본 `http://127.0.0.1:3200`)으로 rewrite하여 브라우저는 한 출처에서 API를 호출합니다.
- `APP_ORIGIN=http://127.0.0.1:3101`을 개발 환경에 적용했습니다.
- system, operations, settlement 역할은 로그인 뒤 MFA 상태를 확인합니다. 미등록 계정은 비밀번호 재확인, TOTP 설정 키/URI 표시, 코드 확인, 복구 코드 보관 순서로 등록을 완료합니다.
- `GET /api/auth/mfa/status`를 추가했습니다. 세션이 확인된 본인 계정의 MFA 완료 여부만 `{ enrolled: boolean }`으로 반환합니다.
- MFA 비밀과 복구 코드는 서버 로그나 문서에 기록하지 않고, 등록 중인 브라우저 메모리에서만 표시합니다.

## 검증

- `npm.cmd run build:api`
- `node --test scripts/tests/mfa.test.mjs`: MFA 미등록/등록 상태 조회, 암호화 저장, 재사용 방지, 복구 코드 단회 사용을 통과했습니다.
- `npm.cmd run build:web`
- `http://127.0.0.1:3200/api/health/ready`, `http://127.0.0.1:3101/api/health/ready`가 모두 `200`을 반환했습니다.
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 390px 폭 로그인 화면의 접근 가능한 레이블과 가로 넘침 없음을 확인했습니다.
- [모바일 로그인 화면](../overview/web-login-mobile.png)을 Playwright로 캡처해 시각 검토했습니다.

## 남은 범위

이 화면은 인증 진입점입니다. 거래처 주문, 창고 모바일 출고, 관리자 업무 화면은 다음 도메인 구현 단계에서 추가합니다. Cloudflare Quick Tunnel은 계속 `theme-preview/`의 디자인 검토용이며 제품 웹/API에 연결하지 않았습니다.
