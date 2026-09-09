# Zorin OS·Cloudflare Tunnel Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B2B-STM을 독립 Docker Compose 스택으로 Zorin OS에 배포하고 `https://stm.approid.team`에서 안전하게 운영한다.

**Architecture:** `postgres`, `clamav`, `api`, `web`, `tunnel`을 `b2b-stm` 전용 Compose network와 volume에서 실행한다. Cloudflare Tunnel은 Web만 공개하고 Next.js가 동일 origin `/api`를 내부 API로 전달한다. CI는 검증만 수행하며 실제 배포는 Zorin SSH session에서 수동 실행한다.

**Tech Stack:** Node.js 24, NestJS 11, Next.js 16 standalone, PostgreSQL 16, ClamAV `clamd`, Docker Compose, Cloudflare Tunnel, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-10-zorin-cloudflare-deployment-design.md`

## Global Constraints

- 서버 경로는 `~/apps/b2b-stm`, Compose project 이름은 `b2b-stm`이다.
- 공개 origin은 `https://stm.approid.team` 하나이며 API hostname을 별도로 공개하지 않는다.
- `alpha-momega`의 코드, database, role, volume, network, port, secret, Tunnel token을 읽거나 변경하지 않는다.
- 운영 database는 새 `b2b_stm`이며 노트북 database를 복사하지 않는다.
- 운영 첨부 검사는 `ATTACHMENT_SCAN_MODE=clamav`로 fail-closed 한다.
- 실제 secret은 Git과 image layer에 넣지 않고 Zorin `infra/secrets/`에서 mode `600`으로 관리한다.
- `docker compose down -v`는 실행하지 않는다.
- 사용자 요청에 따라 TDD는 배포 안전장치와 로그 계약의 실패 경계에만 적용한다.
- 목표 규모 성능 시험과 최종 RPO/RTO 측정은 이 계획에서 실행하지 않는다.

---

### Task 1: Production 초기화 안전장치

**Files:**
- Modify: `scripts/lib/demo-seed.mjs`
- Modify: `scripts/seed-demo-data.mjs`
- Modify: `scripts/tests/demo-seed.test.mjs`
- Modify: `scripts/bootstrap-admin.mjs`
- Modify: `scripts/lib/bootstrap-admin.mjs`
- Modify: `scripts/tests/bootstrap.check.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DATABASE_URL`, 선택적 `DEMO_CREDENTIALS_PATH`
- Produces: `assertDemoDeploymentTarget(connectionString): URL`, `assertBootstrapDeploymentTarget(connectionString): URL`, `npm run demo:seed:deployment`, `npm run admin:bootstrap:deployment`

- [ ] **Step 1: deployment 대상 검증 실패 테스트 추가**

`scripts/tests/demo-seed.test.mjs`에 다음 경계를 추가한다.

```js
import { assertDemoDeploymentTarget } from '../lib/demo-seed.mjs';

test('deployment demo seed accepts only the compose production database', () => {
  assert.equal(assertDemoDeploymentTarget('postgresql://app:secret@postgres:5432/b2b_stm').hostname, 'postgres');
  assert.throws(() => assertDemoDeploymentTarget('postgresql://app:secret@postgres:5432/b2b_stm_test'));
  assert.throws(() => assertDemoDeploymentTarget('postgresql://app:secret@other-db:5432/b2b_stm'));
});
```

- [ ] **Step 2: RED 확인**

Run: `node --env-file=.env.local --test scripts/tests/demo-seed.test.mjs`
Expected: `assertDemoDeploymentTarget` export가 없어 FAIL.

- [ ] **Step 3: 최소 production seed 경계 구현**

`scripts/lib/demo-seed.mjs`에 정확한 service와 database만 허용한다.

```js
export function assertDemoDeploymentTarget(connectionString) {
  const target = new URL(connectionString);
  assert(['postgresql:', 'postgres:'].includes(target.protocol), 'PostgreSQL URL required');
  assert.equal(target.pathname, '/b2b_stm', 'B2B production database required');
  assert.equal(target.hostname, 'postgres', 'Compose PostgreSQL service required');
  return target;
}
```

`scripts/seed-demo-data.mjs`는 인수 전체가 다음 두 형식 중 하나일 때만 실행한다.

```js
const args = process.argv.slice(2);
const deployment = args.length === 2 && args[0] === '--deployment' && args[1] === '--confirm-seed=B2B_STM_DEMO';
const development = args.length === 1 && args[0] === '--development';
assert(development || deployment, 'Select an explicit demo seed target');
if (deployment) assertDemoDeploymentTarget(process.env.DATABASE_URL);
else assertDemoTarget(process.env.DATABASE_URL);
```

deployment에서는 `DEMO_CREDENTIALS_PATH=/run/b2b-stm-secrets/demo-credentials.json`을 필수로 하고 해당 절대 경로에 임시 파일과 최종 JSON을 mode `600`으로 쓴다. development의 기존 `.demo-credentials.json` 동작은 유지한다.

`package.json`에 다음 script를 추가한다.

```json
"demo:seed:deployment": "node scripts/seed-demo-data.mjs --deployment --confirm-seed=B2B_STM_DEMO"
```

- [ ] **Step 4: deployment 관리자 bootstrap 경계 구현**

`scripts/lib/bootstrap-admin.mjs`에 `assertBootstrapDeploymentTarget`을 추가해 database `/b2b_stm`과 hostname `postgres`만 허용한다. `scripts/bootstrap-admin.mjs`는 기존 `--email` development 형식과 `--deployment --email` production 형식을 구분한다. deployment 형식에서는 `.env.local`을 만들거나 수정하지 않고 이미 주입된 `MFA_ENCRYPTION_KEY`가 정확히 64자리 hex인지 확인한 뒤 hidden TTY prompt와 기존 `bootstrapAdmin` transaction을 사용한다.

`scripts/tests/bootstrap.check.mjs`에는 `postgres:5432/b2b_stm`만 deployment 대상으로 허용하고 test database·다른 hostname을 거부하는 assertion을 추가한다. `package.json`에는 다음 script를 추가한다.

```json
"admin:bootstrap:deployment": "node scripts/bootstrap-admin.mjs --deployment --email"
```

- [ ] **Step 5: GREEN과 기존 경계 확인**

Run: `node --env-file=.env.local --test scripts/tests/demo-seed.test.mjs`
Expected: 모든 테스트 PASS.

Run: `npm.cmd run demo:seed`
Expected: 기존 DEMO 데이터가 있으면 변경 없이 정상 종료.

Run: `node --env-file=.env.local --test scripts/tests/bootstrap.check.mjs`
Expected: 모든 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add package.json scripts/bootstrap-admin.mjs scripts/lib/bootstrap-admin.mjs scripts/lib/demo-seed.mjs scripts/seed-demo-data.mjs scripts/tests/bootstrap.check.mjs scripts/tests/demo-seed.test.mjs
git commit -m "feat: add guarded deployment initialization"
```

### Task 2: API 요청 로그와 안전한 예외 기록

**Files:**
- Create: `apps/api/src/observability/request-observability.ts`
- Modify: `apps/api/src/application.ts`
- Modify: `scripts/tests/api.test.mjs`

**Interfaces:**
- Consumes: Express request/response와 선택적 incoming `x-request-id`
- Produces: `requestIdMiddleware`, `SafeExceptionFilter`, JSON line stdout/stderr 로그

- [ ] **Step 1: 로그 계약 테스트 추가**

`scripts/tests/api.test.mjs`에서 `console.log`와 `console.error`를 임시 수집하고 실제 Nest HTTP 요청을 보낸다. 응답 `x-request-id`가 UUID이며 완료 로그가 아래 필드만 포함하는지 확인한다.

```js
assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);
assert.deepEqual(Object.keys(entry).sort(), ['durationMs','level','method','requestId','route','status','timestamp'].sort());
assert.equal(entry.route, '/api/health/live');
assert.equal(JSON.stringify(entry).includes('cookie'), false);
```

존재하지 않는 route의 404는 완료 로그만 남기고, 의도적으로 발생시킨 500은 `errorClass`와 동일 request ID를 stderr에 남기되 request header와 database URL을 포함하지 않는지 확인한다.

- [ ] **Step 2: RED 확인**

Run: `node --env-file=.env.local --test scripts/tests/api.test.mjs`
Expected: `x-request-id`와 JSON log가 없어 FAIL.

- [ ] **Step 3: 최소 관측성 구현**

`request-observability.ts`에서 client 값을 신뢰하지 않고 매 요청 `randomUUID()`를 만든다. `res.locals.requestId`와 `x-request-id`에 저장하고 `finish` event에서 한 줄 JSON을 기록한다. `req.route?.path`가 없으면 URL query를 제거한 pathname만 사용한다. principal이 설정된 경우에만 `principalId`를 추가한다.

`SafeExceptionFilter`는 `HttpException`을 기존 상태·본문으로 응답하고, 예상하지 못한 오류는 다음 stderr 구조와 generic 500만 반환한다.

```ts
console.error(JSON.stringify({
  timestamp: new Date().toISOString(), level: 'error', requestId,
  errorClass: exception instanceof Error ? exception.name : 'UnknownError',
  stack: exception instanceof Error ? exception.stack : undefined,
}));
```

cookie, headers, body, URL credential은 log 객체에 전달하지 않는다. `application.ts`에서 middleware와 global filter를 등록하고 기존 `logger: false`는 유지한다.

- [ ] **Step 4: GREEN 확인**

Run: `node --env-file=.env.local --test scripts/tests/api.test.mjs`
Expected: 모든 테스트 PASS.

Run: `npm.cmd run build:api`
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/api/src/application.ts apps/api/src/observability/request-observability.ts scripts/tests/api.test.mjs
git commit -m "feat: add safe API request observability"
```

### Task 3: Production Docker image와 Compose stack

**Files:**
- Create: `.dockerignore`
- Create: `apps/api/Dockerfile`
- Create: `apps/web/Dockerfile`
- Modify: `apps/web/next.config.ts`
- Create: `infra/compose.zorin.yml`
- Create: `infra/postgres/init/10-application-role.sh`
- Create: `infra/secrets/database.env.example`
- Create: `infra/secrets/api.env.example`
- Create: `infra/secrets/web.env.example`
- Create: `infra/secrets/tunnel.env.example`
- Create: `infra/secrets/compose.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `infra/secrets/*.env`, build arg `API_BACKEND_ORIGIN`
- Produces: `b2b-stm-postgres`, `b2b-stm-clamav`, `b2b-stm-api`, `b2b-stm-web`, `b2b-stm-tunnel`

- [ ] **Step 1: Next standalone와 build-time 내부 API 설정**

`apps/web/next.config.ts`에 `output: 'standalone'`을 추가한다. Web Dockerfile build stage는 아래 값을 `npm run build --workspace=@b2b-stm/web` 전에 설정한다.

```dockerfile
ARG API_BACKEND_ORIGIN=http://api:3200
ENV API_BACKEND_ORIGIN=${API_BACKEND_ORIGIN}
```

- [ ] **Step 2: API·Web multi-stage Dockerfile 작성**

두 Dockerfile은 repository root context를 사용한다. build stage에서 root lockfile로 `npm ci`, 해당 workspace build를 실행한다. API runtime에는 `apps/api/dist`, migration SQL, `scripts/`, production dependency만 둔다. Web runtime에는 `.next/standalone`, `.next/static`, `public`만 두고 두 서비스 모두 `USER node`로 실행한다.

API command는 `node apps/api/dist/main.js`, Web command는 standalone 출력 구조의 `node apps/web/server.js`로 고정한다.

- [ ] **Step 3: PostgreSQL 초기 role script 작성**

`10-application-role.sh`는 `B2B_APP_USER`와 `B2B_APP_PASSWORD`가 없으면 즉시 실패한다. `psql -v ON_ERROR_STOP=1`과 identifier/literal quoting으로 application role을 생성하고 다음 권한만 부여한다.

```sql
REVOKE ALL ON DATABASE b2b_stm FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE b2b_stm TO b2b_stm_app;
GRANT USAGE ON SCHEMA public TO b2b_stm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO b2b_stm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE b2b_stm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO b2b_stm_app;
```

- [ ] **Step 4: Compose 작성**

`infra/compose.zorin.yml`은 project name `b2b-stm`, 전용 network와 `postgres-data`, `clamav-data` volume을 선언한다. host publish는 다음 두 loopback만 허용한다.

```yaml
ports:
  - "127.0.0.1:3200:3200" # api
  - "127.0.0.1:3101:3101" # web
```

`migrate`와 `demo-seed`는 API image의 one-shot profile service로 둔다. `demo-seed`에는 `./secrets:/run/b2b-stm-secrets` bind mount를 지정한다. Tunnel은 동일 network에서 `http://web:3101`에 접근하며 `TUNNEL_TOKEN`을 `tunnel.env`에서 읽는다.

모든 장기 서비스에 `restart: unless-stopped`, `local` log driver, `max-size: 10m`, `max-file: "3"`을 적용한다. API healthcheck는 `/api/health/ready`, Web healthcheck는 `/`, PostgreSQL은 `pg_isready`, ClamAV는 `PING`을 사용한다.

- [ ] **Step 5: secret 예시와 제외 규칙 작성**

example 파일에는 key만 두고 실제 값 대신 `REPLACE_...`를 사용한다. `.gitignore`는 `infra/secrets/*`를 제외하되 `!infra/secrets/*.example`만 허용한다. `.dockerignore`는 `.git`, `.env*`, `.demo-credentials*`, `node_modules`, `.next`, `dist`, logs, screenshots, `SDTPL_ADM`, `.tools`를 제외한다.

- [ ] **Step 6: image와 Compose 검증**

Run: `docker compose -f infra/compose.zorin.yml --env-file infra/secrets/compose.env.example config --quiet`
Expected: exit 0. 실제 secret 대신 검증용 example을 참조하도록 별도 `compose.env.example`을 포함한다.

Run: `docker build -f apps/api/Dockerfile -t b2b-stm-api:verify .`
Expected: exit 0.

Run: `docker build -f apps/web/Dockerfile --build-arg API_BACKEND_ORIGIN=http://api:3200 -t b2b-stm-web:verify .`
Expected: exit 0.

- [ ] **Step 7: 커밋**

```bash
git add .dockerignore .gitignore apps/api/Dockerfile apps/web/Dockerfile apps/web/next.config.ts infra
git commit -m "feat: add isolated Zorin deployment stack"
```

### Task 4: GitHub CI와 외부 availability 검사

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/availability.yml`

**Interfaces:**
- Consumes: GitHub-hosted runner와 PostgreSQL service
- Produces: commit quality gate와 `stm.approid.team` readiness schedule

- [ ] **Step 1: CI workflow 작성**

`ci.yml`은 `push`와 `pull_request`에 실행하고 `permissions: contents: read`만 부여한다. Ubuntu runner의 PostgreSQL 16 service는 `POSTGRES_DB=b2b_stm_test`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`로 격리한다. job env는 다음과 같다.

```yaml
TEST_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/b2b_stm_test
TEST_MIGRATION_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/b2b_stm_test
```

step 순서는 checkout, Node 24, `npm ci`, `node scripts/migrate.mjs --test`, `npm run test:foundation`, API/Web build, 공개 저장소 검사, 두 Docker image build다.

- [ ] **Step 2: availability workflow 작성**

`availability.yml`은 배포 전에는 `workflow_dispatch`만 제공한다. `curl --fail --silent --show-error --max-time 10 --retry 2 https://stm.approid.team/api/health/ready`가 실패하면 job을 실패시킨다. workflow 자체에는 secret과 write permission을 두지 않는다. Task 7의 외부 검증이 끝난 뒤 15분 schedule trigger를 추가한다.

- [ ] **Step 3: 로컬 동등 명령 검증**

Run: `npm.cmd run test:foundation`
Expected: 76개 이상, fail 0.

Run: `npm.cmd run build:api`
Expected: exit 0.

Run: `npm.cmd run build:web`
Expected: exit 0.

Run: `npm.cmd run repo:verify-public`
Expected: exit 0.

- [ ] **Step 4: 커밋·푸시와 CI 확인**

```bash
git add .github/workflows/ci.yml .github/workflows/availability.yml
git commit -m "ci: validate deployment and public readiness"
git push origin main
```

GitHub Actions에서 `ci.yml`의 모든 step이 성공한 commit SHA를 기록한다. 아직 배포 전인 availability failure는 예상 상태로 구분하며 deployment 완료 후 수동 재실행해 성공시킨다.

### Task 5: Zorin 배포 runbook과 검증 script

**Files:**
- Create: `infra/scripts/check-secrets.sh`
- Create: `infra/scripts/verify-deployment.sh`
- Create: `docs/overview/zorin-deployment-runbook.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Zorin Docker Compose, secret 파일, public hostname
- Produces: 반복 가능한 preflight·smoke 명령과 운영 runbook

- [ ] **Step 1: secret preflight 작성**

`check-secrets.sh`는 `infra/secrets`가 mode `700`, 실제 env 파일이 mode `600`인지 확인한다. 각 필수 key가 존재하고 값이 비어 있거나 `REPLACE_`로 시작하면 실패한다. 값 자체는 출력하지 않는다. `api.env`의 `APP_ORIGIN`, `ATTACHMENT_SCAN_MODE`, `CLAMAV_HOST`가 각각 설계값과 일치하는지도 검사한다.

- [ ] **Step 2: 배포 smoke script 작성**

`verify-deployment.sh`는 다음 URL을 `curl --fail --max-time 10`으로 확인한다.

```text
http://127.0.0.1:3200/api/health/live
http://127.0.0.1:3200/api/health/ready
http://127.0.0.1:3101/
https://stm.approid.team/
https://stm.approid.team/api/health/ready
```

익명 workspace URL 세 개는 redirect를 따라 최종 URL이 `/`인지 검사한다. 실패 시 response body나 secret을 출력하지 않고 URL label과 status만 표시한다.

- [ ] **Step 3: runbook 작성**

runbook에 최초 clone, secret 생성, image digest 확인, migration, seed, 관리자 bootstrap, Compose 시작, Tunnel 연결, log 확인, 재배포, 롤백, backup 전 주의 사항을 정확한 명령으로 기록한다. `down -v` 금지와 `alpha-momega` compose를 현재 디렉터리에서 실행하지 않는 규칙을 눈에 띄게 둔다.

- [ ] **Step 4: shell syntax와 문서 링크 검증**

Run on Zorin or WSL: `bash -n infra/scripts/check-secrets.sh infra/scripts/verify-deployment.sh`
Expected: exit 0.

Run: `rg -n "zorin-deployment-runbook" README.md docs/README.md`
Expected: runbook link가 최소 한 곳에서 발견됨.

- [ ] **Step 5: 커밋·푸시**

```bash
git add README.md docs/overview/zorin-deployment-runbook.md infra/scripts
git commit -m "docs: add guarded Zorin deployment runbook"
git push origin main
```

### Task 6: Zorin에 독립 stack 배포

**Files:**
- Server-only create: `~/apps/b2b-stm/infra/secrets/compose.env`
- Server-only create: `~/apps/b2b-stm/infra/secrets/database.env`
- Server-only create: `~/apps/b2b-stm/infra/secrets/api.env`
- Server-only create: `~/apps/b2b-stm/infra/secrets/web.env`
- Server-only create: `~/apps/b2b-stm/infra/secrets/tunnel.env`

**Interfaces:**
- Consumes: `origin/main`의 CI 성공 commit, 사용자 제공 SMTP credential
- Produces: Tunnel 제외 4개 healthy Zorin 서비스와 새 DEMO DB

- [ ] **Step 1: read-only server preflight**

SSH `approid@192.168.219.174`에 접속해 OS, disk, memory, Docker/Compose version, 기존 container와 port `3101`, `3200` 사용 여부를 확인한다. `alpha-momega` container·volume에는 mutation 명령을 실행하지 않는다. 충돌이나 disk 부족이 있으면 중단하고 사용자에게 보고한다.

- [ ] **Step 2: clone과 commit 고정**

```bash
mkdir -p ~/apps
git clone https://github.com/imorangepie20/B2B-STM.git ~/apps/b2b-stm
cd ~/apps/b2b-stm
git switch main
git pull --ff-only
git rev-parse HEAD
```

로컬에서 확인한 CI 성공 SHA와 서버 `HEAD`가 일치해야 다음 단계로 간다.

- [ ] **Step 3: 서버 전용 secret 생성**

`umask 077`로 디렉터리와 파일을 만들고 `openssl rand -hex 32`로 DB password, CSRF secret, MFA key를 각각 독립 생성한다. `api.env`에는 정확히 다음 production 경계를 기록한다.

```dotenv
NODE_ENV=production
APP_ORIGIN=https://stm.approid.team
API_HOST=0.0.0.0
API_PORT=3200
NOTIFICATION_WORKER_ENABLED=true
ATTACHMENT_SCAN_MODE=clamav
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
CLAMAV_TIMEOUT_MS=5000
```

사용자에게 받은 새 `SMTP_URL`과 `MAIL_FROM`을 같은 파일에 저장한다. 값은 session output에 echo하지 않는다. `check-secrets.sh`가 성공해야 진행한다.

- [ ] **Step 4: image digest와 image build 검증**

PostgreSQL 16, ClamAV stable, cloudflared image를 pull한 뒤 `docker image inspect --format '{{index .RepoDigests 0}}'`로 x86_64에서 실제 digest를 확인한다. 확인한 digest를 `compose.zorin.yml`에 반영하고 별도 commit·push 후 서버를 fast-forward한다.

API와 Web image를 build한다. build log에 secret 값이 나타나지 않았는지 key 이름 기준으로 검사하고 image history에 env 파일 COPY가 없는지 확인한다.

- [ ] **Step 5: DB·ClamAV 초기화**

```bash
docker compose -p b2b-stm -f infra/compose.zorin.yml up -d postgres clamav
docker compose -p b2b-stm -f infra/compose.zorin.yml run --rm migrate
docker compose -p b2b-stm -f infra/compose.zorin.yml run --rm demo-seed
```

두 번째 migration은 applied 0건이어야 한다. 두 번째 seed는 DEMO 데이터가 이미 있고 credential 파일이 존재한다는 이유로 변경 없이 종료해야 한다. DB role 검사로 application 계정의 table DML은 가능하고 DDL은 거부되는지 확인한다.

- [ ] **Step 6: 관리자 bootstrap과 application 시작**

system 관리자 email은 `admin@stm.approid.team`으로 생성한다. bootstrap password는 interactive hidden prompt에서만 입력하고 기록하지 않는다. API 시작 전 `MFA_ENCRYPTION_KEY`가 이미 server secret에 있으므로 bootstrap 명령이 이를 교체하지 않도록 deployment용 interactive command를 사용한다.

```bash
docker compose -p b2b-stm -f infra/compose.zorin.yml up -d api web
```

local live, ready, Web health가 모두 성공해야 Tunnel 단계로 간다.

### Task 7: Cloudflare Tunnel과 실제 운영 검증

**Files:**
- Server-only modify: `~/apps/b2b-stm/infra/secrets/tunnel.env`
- Modify: `.github/workflows/availability.yml`
- Modify after evidence: `docs/portfolio/operational-acceptance-evidence.md`

**Interfaces:**
- Consumes: Cloudflare 계정의 `approid.team` zone, healthy Web service
- Produces: `b2b-stm-zorin` connector와 `https://stm.approid.team`

- [ ] **Step 1: 독립 named tunnel 생성**

Cloudflare dashboard에서 `b2b-stm-zorin` tunnel을 새로 만든다. 기존 `alpha-momega` tunnel을 수정하지 않는다. 새 connector token을 Zorin의 `tunnel.env`에 mode `600`으로 저장하고 token을 대화·로그·Git에 출력하지 않는다.

- [ ] **Step 2: public hostname 연결**

`stm.approid.team`의 service를 `http://web:3101`로 지정한다. 동일 hostname의 기존 DNS record가 있으면 덮어쓰기 전에 사용자에게 충돌을 보고한다. Tunnel container를 시작하고 connector가 healthy인지 확인한다.

- [ ] **Step 3: 외부 smoke와 인증 경계 검증**

`infra/scripts/verify-deployment.sh`를 실행한 뒤 실제 브라우저에서 다음을 확인한다.

- 익명 `/admin`, `/portal/orders`, `/warehouse/shipments`는 로그인으로 이동
- `admin@stm.approid.team` 로그인 후 MFA 등록과 admin 접근
- 서버 전용 credential 파일의 DEMO customer·warehouse·operations 계정 로그인
- 거래처 3, 상품 12, 주문 6과 출고·반품·정산 샘플 표시
- 정상 파일 업로드 성공
- EICAR test signature 파일 업로드가 거부되고 DB에 attachment가 생기지 않음
- ClamAV container를 잠시 stop했을 때 readiness 503과 첨부 저장 거부, 재시작 후 200 복구

EICAR 검증은 전용 테스트 attachment만 사용하고 완료 후 삭제한다. scanner 중지 시간에는 운영 사용자가 없음을 확인한다.

- [ ] **Step 4: availability schedule 활성화**

외부 readiness 성공 후 `.github/workflows/availability.yml`에 다음 schedule을 추가하고 workflow를 수동 실행해 성공을 확인한다.

```yaml
schedule:
  - cron: "*/15 * * * *"
```

- [ ] **Step 5: log·rotation·secret 검사**

Docker inspect로 모든 장기 container의 `local` log driver와 rotation option을 확인한다. API request log에 request ID·status·duration이 있고 cookie, password, token, connection URL이 없는지 key pattern으로 검사한다.

- [ ] **Step 6: 재부팅 검증 승인과 실행**

Zorin 재부팅은 같은 서버의 `alpha-momega`도 잠시 중단하므로 실행 직전에 사용자 승인을 다시 받는다. 승인 후 재부팅하고 5개 B2B 서비스 자동 복구, public ready 200, `alpha-momega` 기존 hostname 정상 응답을 확인한다.

- [ ] **Step 7: 운영 증거 기록과 커밋**

`docs/portfolio/operational-acceptance-evidence.md`에 배포 commit SHA, 서비스 health, 외부 URL, ClamAV 정상·장애 결과, 재부팅 결과, `alpha-momega` 무변경 결과를 기록한다. secret, 내부 IP, account password, Tunnel ID/token은 기록하지 않는다.

```bash
git add .github/workflows/availability.yml docs/portfolio/operational-acceptance-evidence.md
git commit -m "docs: record Zorin production acceptance"
git push origin main
```

### Task 8: 현재 상태와 인수 문서 마감

**Files:**
- Modify: `docs/overview/current-development-context.md`
- Modify: `docs/overview/next-session-handoff.md`
- Modify: `docs/overview/roadmap.md`
- Create: `docs/changes/2026-09-10-zorin-cloudflare-deployment.md`
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: Task 1~7의 실제 검증 증거
- Produces: 다음 세션이 재배포·장애 대응을 이어갈 수 있는 기준 상태

- [ ] **Step 1: 변경 기록 작성**

CI, Docker stack, DB 초기화, ClamAV, request log, Tunnel, 실제 검증 결과와 미검증 항목을 한국어로 기록한다. 실패 후 수정이 있었다면 증상이 아니라 근본 원인과 최종 검증을 함께 남긴다.

- [ ] **Step 2: overview 갱신**

CI·실제 배포·관측성·ClamAV 실제 연결 항목을 완료 여부에 맞게 갱신한다. 다음 구현 순서는 별도 복원 환경 RPO/RTO 측정으로 이동하고, 성능 시험은 사용자 요청 전까지 중단 상태를 유지한다.

- [ ] **Step 3: 최종 검증**

Run: `npm.cmd run test:foundation`
Expected: fail 0.

Run: `npm.cmd run build:api`
Expected: exit 0.

Run: `npm.cmd run build:web`
Expected: exit 0.

Run: `npm.cmd run repo:verify-public`
Expected: exit 0, secret pattern 0.

Run on Zorin: `infra/scripts/verify-deployment.sh`
Expected: local·public health와 익명 redirect 모두 PASS.

- [ ] **Step 4: 문서 커밋·푸시**

```bash
git add docs
git commit -m "docs: complete Zorin deployment handoff"
git push origin main
```
