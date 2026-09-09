# MFA 기기 재등록 Implementation Plan

상태: 구현·검증 완료. 체크박스는 당시 실행 순서를 보존한 기록이며 현재 완료 판단에는 [현재 개발 인계](../../overview/current-development-context.md)를 사용합니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MFA를 등록한 활성 계정의 분실·교체 기기를 system 관리자가 감사 가능하게 초기화하고, 사용자가 새 TOTP 기기를 등록하도록 만든다.

**Architecture:** `MfaService`에 system 역할·MFA 검증을 포함한 초기화 트랜잭션과 목록 조회를 둔다. 마이그레이션은 MFA 및 계정 감사 이벤트 제약을 확장하고 초기화 이력을 보존한다. 관리자 화면은 전용 API만 사용해 대상 계정과 사유를 제출한다.

**Tech Stack:** NestJS, PostgreSQL, Next.js, TypeScript, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-06-mfa-device-recovery-design.md`

## Global Constraints

- 대상은 `mfa_credentials.confirmed_at`이 있는 활성 계정이다.
- `system` 역할과 현재 세션의 MFA 확인이 모두 필요하다.
- 초기화는 기존 세션, 복구 코드, TOTP 비밀값을 하나의 DB 트랜잭션에서 폐기한다.
- 모든 변경은 `docs/`에 한국어로 기록하고, 코드·API·경로 이름은 원문을 유지한다.

---

### Task 1: 감사 스키마와 API 회귀 테스트

**Files:**
- Create: `apps/api/db/migrations/0021_mfa_device_recovery.sql`
- Modify: `scripts/tests/mfa.test.mjs`

**Interfaces:**
- Produces: `mfa_device_resets(user_id, reset_by, reason, created_at)` and event values `reset`, `mfa_reset`.
- Produces: API expectations for `POST /api/auth/users/:id/mfa-reset`.

- [ ] **Step 1: Write the failing test**

Append a test that creates a MFA-confirmed system actor and a separate MFA-confirmed target, calls the reset endpoint with `{ requestId, reason }`, and asserts `200`, revoked target sessions, deleted recovery codes, cleared credential state, one device-reset row and one each of `reset` and `mfa_reset` events.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm.cmd run build:api; node --env-file=.env.local --test scripts/tests/mfa.test.mjs`

Expected: endpoint returns `404` before the controller/service exists.

- [ ] **Step 3: Add the migration**

Create `0021_mfa_device_recovery.sql`: replace the named `mfa_events_event_check` and `identity_events_event_check` constraints with value lists including `reset` and `mfa_reset`; create `mfa_device_resets` with UUID primary key, target and actor FKs, non-blank reason, timestamp, and an index by `(user_id, created_at DESC)`.

- [ ] **Step 4: Apply migrations and retain the failing endpoint test**

Run: `npm.cmd run db:migrate; npm.cmd run build:api; node --env-file=.env.local --test scripts/tests/mfa.test.mjs`

Expected: migrations succeed; endpoint assertion still fails.

### Task 2: MFA reset service and controller

**Files:**
- Modify: `apps/api/src/identity/mfa.service.ts`
- Modify: `apps/api/src/identity/account-lifecycle.controller.ts`
- Test: `scripts/tests/mfa.test.mjs`

**Interfaces:**
- Consumes: `POST /api/auth/users/:id/mfa-reset` body `{ requestId: string, reason: string }`.
- Produces: `MfaService.resetByAdministrator(sessionToken, targetUserId, body)` returning `{ userId, status: 'mfa_reset' }`.
- Produces: `MfaService.enrolledUsers(sessionToken)` returning only active MFA-confirmed accounts.

- [ ] **Step 1: Implement minimal input and actor validation**

Validate UUID target/request IDs and trimmed 4–300-character reason. In a transaction, lock the actor session and user, require active internal `system` role and `mfa_verified_at`, then reject self-reset with `409`.

- [ ] **Step 2: Implement atomic credential revocation**

Lock the active target and MFA credential. Reject a missing confirmed credential with `409`. Clear credential secret/enrollment/replay/lock values, delete all target recovery codes, revoke all active sessions, insert `mfa_device_resets`, `mfa_events('reset')`, and `identity_events('mfa_reset')`.

- [ ] **Step 3: Add idempotency**

Use `command_results` with command type `mfa.reset` and the actor/request UUID so a repeated request returns the stored `{ userId, status }` result and cannot write a second reset event.

- [ ] **Step 4: Expose the two controller routes**

Add `GET /api/auth/users/mfa-enrolled` and `POST /api/auth/users/:id/mfa-reset` to `AccountLifecycleController`; session/CSRF guards remain inherited from the current controller/app configuration.

- [ ] **Step 5: Run focused tests**

Run: `npm.cmd run build:api; node --env-file=.env.local --test scripts/tests/mfa.test.mjs`

Expected: reset, repeated request, self-reset, non-system actor and non-enrolled target assertions pass.

### Task 3: 관리자 계정 보안 화면

**Files:**
- Create: `apps/web/src/app/admin/account-security/page.tsx`
- Create: `apps/web/src/app/admin/account-security/account-security.css`
- Modify: `apps/web/src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/users/mfa-enrolled`, `POST /api/auth/users/:id/mfa-reset`.
- Produces: `/admin/account-security` MFA 초기화 UI and dashboard link.

- [ ] **Step 1: Create the page**

Load the MFA-confirmed account list, render email/roles/enrollment time, disable the current actor, require a 4–300-character reason and explicit confirmation, then submit a generated `requestId` with the CSRF token.

- [x] **Step 2: Add minimal styling and navigation**

Reuse admin shell conventions for a readable light-theme table/form. Provide the `/admin/account-security` route for system administrators.

- [ ] **Step 3: Build the web app**

Run: `npm.cmd run build:web`

Expected: Next.js production build succeeds.

### Task 4: Full verification and documentation

**Files:**
- Create: `docs/changes/2026-09-06-mfa-device-recovery.md`
- Modify: `docs/overview/current-development-context.md`

- [ ] **Step 1: Run regression verification**

Run: `npm.cmd run build:api; npm.cmd run build:web; npm.cmd run test:foundation; npm.cmd run db:verify; npm.cmd run test:e2e --workspace=@b2b-stm/web`

Expected: all commands pass.

- [ ] **Step 2: Document the delivered behavior**

Record the reason for device recovery, transaction contents, API/UI behavior, and exact verification outcomes in the change log and current context.
