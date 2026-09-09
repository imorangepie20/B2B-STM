# 계정 초대·비밀번호 설정과 관리자 재설정

## 구현 범위

기존 세션 인증에 계정을 생성하고 최초 비밀번호를 설정하는 경로가 없어 계정 생명주기 API를 추가했습니다. 발급 권한은 활성 system 역할과 MFA 확인 세션이며, 트랜잭션 안에서 권한·세션을 다시 검사합니다.

| Endpoint | 동작 |
|---|---|
| POST /api/auth/invitations | email, accountType, customerId, roles로 비밀번호 미설정 계정 생성 및 24시간 토큰 발급 |
| POST /api/auth/users/:id/invitation | 최초 설정 전 계정의 초대 재발급 |
| POST /api/auth/invitations/accept | token, password로 최초 비밀번호 설정 |
| POST /api/auth/users/:id/password-reset | 관리자 승인 30분 재설정 토큰 발급 |
| POST /api/auth/password-reset/complete | token, password로 비밀번호 변경 및 모든 세션 폐기 |

모든 POST는 기존 Origin·CSRF 검사를 통과해야 합니다. 수락과 완료만 비로그인 접근을 허용합니다. 발급 결과는 userId, token, expiresAt을 no-store 응답으로 한 번 반환합니다. 토큰은 URL·로그에 넣지 않으며 DB에는 SHA-256 해시만 저장합니다. 메일 발송이나 사용자 본인 요청에 의한 자동 재설정은 구현하지 않았습니다.

신규 비밀번호는 12–128 Unicode 코드 포인트, UTF-8 512바이트 이하를 허용합니다. 별도 trim이나 정규화를 하지 않습니다. `argon2@0.45.1`의 Argon2id 기본 설정을 사용합니다. [공식 라이브러리](https://github.com/ranisalt/node-argon2)의 해시·검증 API를 확인했습니다. 기존 scrypt 해시는 로그인 호환성을 유지하며 새 설정부터 Argon2id로 저장합니다. 유출 비밀번호 목록 검사는 후속 운영 보완입니다.

## 정합성과 감사

0006 migration에 account_tokens와 identity_events를 추가했습니다. 계정당 미소비·미폐기 토큰 하나만 허용하며 재발급하면 이전 토큰을 폐기합니다. 만료·용도·계정 활성·거래처 활성 상태를 확인한 뒤 비밀번호 변경, 토큰 소비, 세션 폐기, 이벤트 기록을 같은 트랜잭션으로 처리합니다. 수락은 자동 로그인하지 않습니다.

낮은 빈도의 계정 생명주기 명령은 공통 advisory lock으로 직렬화하고 사용자 행도 잠급니다. 로그인은 비밀번호 조회부터 사용자 행을 잠가 재설정과 겹칠 때 이전 비밀번호로 새 세션을 발급하지 않도록 했습니다. 변경 중이던 비밀번호를 무시하고 세션을 발급하는 기존 경합을 테스트로 재현한 후 수정했습니다.

identity_events는 발생 대상·작업자·종류·시각을 저장합니다. 변조 방지 감사 저장소나 보존 정책은 아직 적용하지 않았습니다. MFA 등록이 미구현이므로 관리자 발급 API의 MFA 조건을 실제 사용자 화면에서 충족시키는 운영 흐름은 남아 있습니다.

## 검증

- API TypeScript 빌드 통과.
- foundation 테스트 15개 통과: MFA/역할 발급 제한, 거래처 소속과 비활성 거래처 거절, 초대 수락 후 실제 로그인, 재발급·만료·용도 불일치·비활성 계정 거절, 토큰 동시 소비 1회, 재설정 후 세션 폐기, 로그인/비밀번호 변경 경합 포함.
- 개발·테스트 DB에 0006 적용. 테스트 계정은 테스트 DB에서만 만들고 정리했습니다.
- argon2 설치 시 install script 미승인 경고가 있었으나 포함된 바이너리로 실제 해시·검증 테스트는 통과했습니다. 다른 OS 배포에서도 native 모듈 로딩을 검증해야 합니다.

다음은 MFA 등록·검증·복구와 초기 관리자 준비 절차, 계정 화면, 메일 전달 방식입니다. 현재 Cloudflare 화면 사본에는 이 API가 연결되지 않았습니다.
