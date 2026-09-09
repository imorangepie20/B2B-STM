# MFA 기기 교체 및 복구 코드 재발급 설계

## 목적

내부 사용자 또는 시스템 관리자가 MFA 기기를 분실·교체했을 때, system 관리자가 감사 가능한 방법으로 기존 MFA 자격 증명과 세션을 폐기하고 사용자가 안전하게 새 기기를 등록하도록 한다.

## 범위와 제외 범위

- 포함: system 관리자 MFA 초기화, 기존 세션·복구 코드 폐기, 감사 이벤트, 관리자 화면, 사용자의 기존 MFA 재등록 흐름, 통합 테스트.
- 제외: 이메일·SMS 발송, 사용자 본인 확인 자동화, 고객 계정의 MFA 강제, 외부 IdP 연동, 기존 복구 코드를 이용한 자동 기기 교체.
- 초기화는 운영 담당자가 별도 본인 확인을 끝낸 뒤 실행하는 명령이다. 화면 자체는 본인 확인을 대체하지 않는다.

## 선택한 정책

1. 대상은 `mfa_credentials.confirmed_at`이 있는 활성 계정으로 한정하고, 실행 권한은 MFA를 완료한 `system` 역할로 한정한다.
2. 초기화는 대상의 `mfa_credentials` 값을 미등록 상태로 되돌리고, 미소비·소비 복구 코드를 모두 삭제한다.
3. 대상의 활성 세션을 전부 철회한다. 따라서 분실된 기기의 기존 세션과 이미 MFA 확인된 브라우저는 즉시 업무 권한을 잃는다.
4. `mfa_events`에는 대상별 `reset` 이벤트를, `identity_events`에는 실행자와 대상이 연결된 `mfa_reset` 이벤트를 남긴다.
5. 대상 사용자는 일반 비밀번호 로그인 후 기존 `Home.load()`의 미등록 분기로 진입해 새 TOTP 기기 등록과 복구 코드 10개 발급을 완료한다.
6. system 관리자는 자기 자신의 MFA를 초기화할 수 없다. 마지막 system MFA 계정의 접근을 잃는 사고를 방지한다.

## API와 권한

### `POST /api/auth/users/:id/mfa-reset`

- 요청 본문: `{ "requestId": UUID, "reason": string }`
- `reason`: 공백 제거 후 4~300자. 기기 분실·교체 승인 근거를 남긴다.
- 성공 응답: `{ "userId": string, "status": "mfa_reset" }`
- 권한: 활성 내부 system 역할, 현재 세션 MFA 확인, Origin/CSRF 검증.
- 오류: UUID·사유 오류는 `400`, 대상 없음·비활성은 `404`, MFA 미등록 대상 또는 system 자기 초기화는 `409`, 권한 부족은 `403`.

## 데이터와 트랜잭션

`0021_mfa_device_recovery.sql`은 `mfa_events_event_check` 제약을 `reset`을 포함하도록 교체하고, `identity_events_event_check` 제약도 `mfa_reset`을 포함하도록 교체한다. 이유와 실행자를 보존하기 위해 `mfa_device_resets` 테이블을 추가한다.

```text
mfa_device_resets
- id uuid PK
- user_id uuid FK users
- reset_by uuid FK users
- reason text
- created_at timestamptz
```

초기화는 하나의 DB 트랜잭션으로 다음 순서를 따른다.

1. 실행자 세션·system 역할·MFA를 잠그고 다시 검증한다.
2. 대상 `users` 행과 `mfa_credentials` 행을 잠근다.
3. 실행자와 대상이 같으면 거절한다.
4. `mfa_credentials`의 secret, 등록 세션, 만료, 확정 시각, TOTP 재사용 방지 값, 실패·잠금 상태를 모두 `NULL` 또는 `0`으로 초기화한다.
5. `mfa_recovery_codes`를 삭제하고 대상의 활성 `sessions`를 철회한다.
6. `mfa_device_resets`, `mfa_events`, `identity_events`를 기록하고 커밋한다.

명령 재시도에 같은 초기화 기록이 중복되지 않도록 요청에는 UUID `requestId`를 포함하고 `command_results`에 `mfa.reset` 결과를 보관한다.

## 화면과 사용자 경험

- 관리자 홈에 `계정 보안` 링크를 추가한다.
- `/admin/account-security`에서 MFA가 등록된 활성 계정을 검색하고 대상, 초기화 사유를 선택한 뒤 확인 버튼으로 초기화한다.
- 초기화 후에는 “기존 세션과 복구 코드가 폐기되었습니다. 사용자는 다시 로그인해 MFA를 등록해야 합니다.”를 표시한다.
- 자기 계정은 목록에서 비활성화하고 서버도 동일하게 거절한다.
- MFA가 초기화된 사용자는 로그인 성공 후 현재의 MFA 등록 화면으로 자동 이동한다. 새 복구 코드는 확인 완료 화면에서 한 번만 표시한다.

## 오류 처리와 보안 경계

- 클라이언트는 성공 응답만으로 인증 상태를 가정하지 않고 API의 `401`/`403`을 로그인 화면 또는 권한 안내로 처리한다.
- DB 트랜잭션 실패 시 세션 철회·MFA 값 삭제·감사 기록이 일부만 반영되지 않는다.
- 초기화 사유, 대상, 실행자, 시각은 감사 조회를 위해 저장하지만 비밀키·복구 코드·세션 토큰은 저장하거나 응답하지 않는다.
- 요청 중복은 동일 결과를 재생하고, 같은 계정에 대한 동시 초기화는 행 잠금으로 직렬화한다.

## 검증 기준

1. MFA를 마친 system 관리자만 다른 활성 계정을 초기화할 수 있다.
2. 초기화 뒤 대상의 활성 세션·복구 코드가 남지 않고 MFA 상태는 미등록이다.
3. 대상이 다시 로그인하면 기존 MFA 확인 대신 새 등록 흐름으로 진입한다.
4. 자기 초기화, 비정상 사유, 비활성 대상, 일반 관리자 요청은 각각 적절히 거절된다.
5. 같은 `requestId` 재시도는 단일 초기화·감사 기록만 남기며 동일 응답을 반환한다.
6. `npm.cmd run build:api`, `npm.cmd run build:web`, `npm.cmd run test:foundation`, `npm.cmd run db:verify`, Playwright 보안 화면 시나리오가 통과한다.
