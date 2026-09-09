# Zorin OS·Cloudflare Tunnel 배포 설계

작성일: 2026-09-10
상태: 사용자 승인

## 목적과 범위

B2B-STM을 사용자의 Zorin OS 노트북에 독립 Docker Compose 스택으로 배포하고 `https://stm.approid.team`에서 제공한다. 같은 서버의 `alpha-momega` 배포 방식은 구조만 참고한다. 두 프로젝트의 코드, PostgreSQL database·volume·계정, Docker network, 비밀값, Cloudflare Tunnel token을 공유하지 않는다.

이번 범위는 다음을 포함한다.

- GitHub Actions 기반 CI
- Zorin용 API·Web production image와 Compose 구성
- 독립 PostgreSQL과 ClamAV
- migration, DEMO 초기 데이터, 초기 system 관리자 생성 절차
- 독립 Cloudflare Tunnel과 `stm.approid.team` 연결
- 구조화 로그, 로그 순환, healthcheck, 외부 가용성 검사
- 배포·재부팅·롤백 검증 절차

목표 규모 성능 시험과 별도 복원 환경의 최종 RPO/RTO 측정은 포함하지 않는다.

## 배포 토폴로지

서버 경로는 `~/apps/b2b-stm`, Compose project 이름은 `b2b-stm`으로 고정한다. 하나의 전용 bridge network에 다음 서비스를 둔다.

| 서비스 | 역할 | 접근 범위 |
| --- | --- | --- |
| `postgres` | `b2b_stm` 운영 DB | Compose network 내부 전용 |
| `clamav` | 첨부 파일 `INSTREAM` 검사 | Compose network 내부 `3310` |
| `api` | NestJS 업무 API | 내부 `3200`, 호스트 `127.0.0.1:3200` |
| `web` | Next.js UI와 동일 origin API proxy | 내부 `3101`, 호스트 `127.0.0.1:3101` |
| `tunnel` | Cloudflare Tunnel connector | 외부 ingress만 사용 |

공개 요청 흐름은 `stm.approid.team -> Cloudflare Tunnel -> web:3101`이다. 브라우저의 `/api/*` 요청은 Next.js가 `http://api:3200/api/*`로 전달한다. API를 별도 공개 hostname으로 노출하지 않아 session cookie와 Origin·CSRF 검증을 단일 origin에 유지한다.

Next.js rewrite 대상은 production build에 `API_BACKEND_ORIGIN=http://api:3200`으로 주입한다. API는 `APP_ORIGIN=https://stm.approid.team`, `API_HOST=0.0.0.0`, `API_PORT=3200`으로 실행한다.

모든 장기 실행 서비스는 `restart: unless-stopped`를 사용한다. PostgreSQL과 ClamAV healthcheck가 통과한 뒤 API를 시작하고, API `/api/health/ready`가 통과한 뒤 Web과 Tunnel을 운영 상태로 판단한다.

## 컨테이너와 공급망

API와 Web은 Node.js 24 production multi-stage Dockerfile을 사용한다. runtime image에는 production dependency와 build 결과만 복사하고 비권한 `node` 사용자로 실행한다. 소스의 `.env.local`, 로컬 로그, screenshot, 테스트 결과, 원본 테마는 build context에서 제외한다.

PostgreSQL 16과 ClamAV, cloudflared는 공식 image의 명시 버전을 사용한다. 구현 시 공식 registry에서 현재 지원 tag와 architecture 호환성을 확인하고, 실제 검증한 image digest를 Compose에 기록한다. dependency 설치는 `npm ci`로 lockfile을 따른다.

## 비밀값과 권한

실제 환경 파일은 서버의 `infra/secrets/`에만 두고 파일 권한을 `600`, 디렉터리 권한을 `700`으로 제한한다. Git에는 key 이름과 생성 방법만 담은 예시를 보관한다.

- `database.env`: 운영 DB와 application·migration 계정 자격증명
- `api.env`: `DATABASE_URL`, `APP_ORIGIN`, CSRF secret, MFA 암호화 키, SMTP, ClamAV 설정
- `web.env`: production API backend origin
- `tunnel.env`: B2B-STM 전용 Cloudflare Tunnel token

CSRF secret과 MFA key는 cryptographically secure random 값으로 새로 생성한다. SMTP credential, Cloudflare token, DB password, 초기 관리자 password는 명령 출력·Git·문서·Docker image layer에 남기지 않는다. `alpha-momega`의 secret 파일이나 token을 읽거나 복사하지 않는다.

API production 설정은 `ATTACHMENT_SCAN_MODE=clamav`를 강제한다. ClamAV가 응답하지 않으면 readiness가 실패하고 첨부 저장도 fail-closed 처리한다. SMTP 설정이 유효하지 않으면 공개 전환을 중단한다.

## 데이터 초기화

노트북의 현재 `b2b_stm` database를 복사하지 않는다. 새 PostgreSQL volume에서 다음 순서로 초기화한다.

1. database와 application·migration role 생성
2. migration 계정으로 모든 migration 적용과 checksum 확인
3. 명시적 배포 확인 인수가 있는 one-shot 명령으로 DEMO 업무 데이터 생성
4. 서버에서 새 system 관리자 생성
5. DEMO 자격증명과 초기 관리자 전달 정보를 서버 전용 권한 파일에 저장
6. application 계정에 DDL 권한이 없는지 확인

배포 seed는 database 이름이 정확히 `b2b_stm`이고 Compose 내부 PostgreSQL service를 가리킬 때만 허용한다. 실행자는 별도의 확인 문자열을 함께 전달해야 한다. 같은 DEMO namespace를 재실행하면 결정적 ID와 upsert 규칙으로 복구하며, 운영 사용자가 추가한 비-DEMO 데이터는 삭제하지 않는다. reset 명령은 배포 절차에 포함하지 않는다.

기존 로컬 계정, session, login failure, MFA credential은 이전하지 않는다. 공개 hostname 확인 전 새 관리자 MFA 등록을 완료한다.

## CI

GitHub Actions workflow 하나가 `push`와 `pull_request`에서 실행된다.

1. Node.js 24와 lockfile cache 구성
2. `npm ci --ignore-scripts`
3. PostgreSQL 16 service에 전용 test database·role 구성
4. test migration 적용
5. `npm run test:foundation` 실행
6. `npm run build:api`, `npm run build:web` 실행
7. `npm run repo:verify-public` 실행
8. Docker image build 검증

공유 test DB의 fixture 충돌을 막기 위해 foundation test는 파일 단위 직렬 실행을 유지한다. CI에는 운영 DB, Zorin SSH key, Cloudflare token, SMTP credential을 저장하지 않는다. 실제 배포는 CI 성공 commit을 Zorin에서 수동으로 가져와 실행한다.

## 배포와 롤백

최초 배포는 Zorin SSH session에서 수행한다.

1. 저장소를 `~/apps/b2b-stm`에 clone하고 배포 대상 commit을 기록한다.
2. 예시에서 서버 전용 secret 파일을 만들고 권한과 필수 key를 검사한다.
3. PostgreSQL과 ClamAV를 시작하고 healthcheck를 확인한다.
4. migration, DEMO seed, 관리자 bootstrap one-shot 명령을 실행한다.
5. API와 Web image를 build하고 서비스를 시작한다.
6. local live·ready·Web 응답을 검사한다.
7. `b2b-stm-zorin` named tunnel을 만들고 `stm.approid.team` public hostname을 `http://web:3101`에 연결한다.
8. Tunnel connector를 시작하고 외부 HTTPS 검증을 수행한다.

배포 실패 시 새 image와 application container만 직전 성공 commit으로 되돌린다. 이미 성공한 migration은 down migration으로 자동 복구하지 않는다. schema가 forward compatible하지 않은 변경은 배포 전에 별도 migration·rollback 계획을 요구한다. `docker compose down -v`는 운영 절차에서 금지하여 PostgreSQL volume 삭제를 막는다.

## 로그와 가용성

API는 JSON line 형식으로 timestamp, level, request ID, method, route template, status, duration, principal ID가 있으면 해당 ID, 오류 분류를 stdout에 기록한다. cookie, authorization header, CSRF token, password, MFA secret, 파일 본문, SMTP·DB URL은 기록하지 않는다. 예상하지 못한 오류는 stack을 server log에 남기되 HTTP 응답에는 내부 정보를 노출하지 않는다.

모든 container log는 Docker `local` driver에서 `max-size=10m`, `max-file=3`으로 순환한다. PostgreSQL, ClamAV, API, Web에 healthcheck를 둔다. GitHub Actions의 schedule job은 `https://stm.approid.team/api/health/ready`를 정기 검사하며 실패 시 workflow 알림을 발생시킨다. 전용 오류 집계 제품과 SMS·메신저 호출은 이번 범위에서 추가하지 않고 후속 운영 확장으로 남긴다.

## Cloudflare Tunnel

Tunnel 이름은 `b2b-stm-zorin`, public hostname은 `stm.approid.team`으로 고정한다. `alpha-momega` tunnel과 token을 재사용하지 않는다. Tunnel은 inbound port forwarding 없이 outbound connector로만 연결한다. Cloudflare dashboard 또는 공식 CLI에서 hostname route가 정확한 tunnel에 연결됐는지 확인한 뒤 token을 `tunnel.env`에 저장한다.

Cloudflare가 제공하는 HTTPS를 외부 경계로 사용하고, connector와 Web 사이 통신은 전용 Docker network 내부 HTTP를 사용한다. Web 이외의 container는 public hostname이나 공개 host port를 갖지 않는다.

## 검증과 완료 기준

배포 완료는 다음 증거가 모두 있을 때만 선언한다.

- GitHub CI 전체 성공
- Zorin의 5개 서비스가 정상 또는 healthy
- `http://127.0.0.1:3200/api/health/live`와 `/ready` HTTP 200
- `http://127.0.0.1:3101` HTTP 200
- `https://stm.approid.team`와 `/api/health/ready` HTTP 200
- 익명 `/admin`, `/portal/orders`, `/warehouse/shipments`가 로그인으로 이동
- 새 system 관리자 로그인·MFA와 역할별 workspace 접근
- DEMO 거래처·상품·주문·출고·정산 데이터 조회
- 정상 첨부 업로드 성공, 악성·scanner 장애 첨부 저장 거부
- Docker log에 secret이 없고 순환 설정이 적용됨
- Zorin 재부팅 후 DB·ClamAV·API·Web·Tunnel 자동 복구
- `alpha-momega` 서비스, volume, hostname 응답에 변화가 없음

실제 SMTP 발송, Cloudflare 외부 경로, 재부팅 자동 복구는 로컬 build 성공만으로 대체하지 않고 Zorin에서 직접 검증한다.
