# Zorin OS 배포 실행서

이 문서는 B2B-STM을 Zorin OS의 `~/apps/b2b-stm`에 독립된 Docker Compose 스택으로 배포하고 `https://stm.approid.team`에 연결하는 절차다. `alpha-momega`의 코드, 데이터베이스, 볼륨, 네트워크, 포트, 비밀값 및 Tunnel은 읽거나 변경하지 않는다.

## 1. 읽기 전용 사전 점검

```bash
ssh approid@192.168.219.174
uname -a
df -h
free -h
docker version
docker compose version
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
ss -lnt | grep -E ':(3101|3200)\b' || true
```

`127.0.0.1:3101` 또는 `127.0.0.1:3200` 충돌, 디스크 부족, Docker 비정상이 있으면 여기서 중단한다. 기존 컨테이너·볼륨을 정리해 공간을 만들지 않는다.

## 2. 저장소 준비

```bash
mkdir -p ~/apps
git clone https://github.com/imorangepie20/B2B-STM.git ~/apps/b2b-stm
cd ~/apps/b2b-stm
git switch main
git pull --ff-only
git rev-parse HEAD
```

배포할 SHA는 GitHub CI가 통과한 SHA와 같아야 한다.

## 3. 서버 전용 비밀값

```bash
cd ~/apps/b2b-stm
install -d -m 700 infra/secrets
install -d -m 700 infra/runtime
umask 077
cp infra/secrets/compose.env.example infra/secrets/compose.env
cp infra/secrets/database.env.example infra/secrets/database.env
cp infra/secrets/migration.env.example infra/secrets/migration.env
cp infra/secrets/api.env.example infra/secrets/api.env
cp infra/secrets/web.env.example infra/secrets/web.env
cp infra/secrets/tunnel.env.example infra/secrets/tunnel.env
chmod 600 infra/secrets/*.env
```

DB migrator 비밀번호와 application 비밀번호는 서로 다르게 만들고 `openssl rand -hex 32`로 생성한다. URL 안의 비밀번호는 URL encoding한 값을 쓴다. `CSRF_SECRET`과 `MFA_ENCRYPTION_KEY`도 각각 독립적으로 생성한다. 운영 SMTP의 `SMTP_URL`, `MAIL_FROM`과 새 `b2b-stm-zorin` Tunnel token을 입력한다. 비밀값을 터미널 출력이나 shell history에 남기지 않는다.

```bash
infra/scripts/check-secrets.sh
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml config --quiet
```

## 4. 이미지 고정과 빌드

최초 배포에서 `postgres:16.15-alpine`, `clamav/clamav:stable`, `cloudflare/cloudflared:latest`를 pull한 뒤 실제 `RepoDigest`를 확인한다. 확인된 amd64 digest는 `infra/compose.zorin.yml`에 반영해 커밋·CI 통과 후 서버를 fast-forward한다. 태그만 사용한 상태로 운영 전환하지 않는다.

```bash
docker pull postgres:16.15-alpine
docker pull clamav/clamav:stable
docker pull cloudflare/cloudflared:latest
docker image inspect --format '{{index .RepoDigests 0}}' postgres:16.15-alpine
docker image inspect --format '{{index .RepoDigests 0}}' clamav/clamav:stable
docker image inspect --format '{{index .RepoDigests 0}}' cloudflare/cloudflared:latest
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml build api web
```

## 5. 데이터베이스와 DEMO 초기화

노트북 개발 DB를 복사하지 않는다. 새 `b2b_stm` 볼륨에 migration과 DEMO seed를 실행한다.

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml up -d postgres clamav
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml ps
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml run --rm migrate
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml run --rm migrate
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml run --rm demo-seed
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml run --rm demo-seed
test -s infra/runtime/demo-credentials.json
```

두 번째 migration은 `0 applied`, 두 번째 seed는 변경 없이 종료돼야 한다. DEMO 자격 증명 파일은 mode `600`으로 유지한다.

관리자 계정은 hidden prompt에서만 비밀번호를 입력한다.

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml run --rm --entrypoint node api scripts/bootstrap-admin.mjs --deployment --email admin@stm.approid.team
```

## 6. 애플리케이션과 Tunnel 시작

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml up -d api web
curl --fail --max-time 10 http://127.0.0.1:3200/api/health/live
curl --fail --max-time 10 http://127.0.0.1:3200/api/health/ready
curl --location --fail --max-time 10 http://127.0.0.1:3101/
```

Cloudflare에서 기존 Tunnel을 수정하지 말고 `b2b-stm-zorin` named tunnel을 새로 만든다. Public hostname `stm.approid.team`의 service는 `http://web:3101`이다. 기존 DNS 레코드가 있으면 덮어쓰기 전에 중단하고 충돌을 보고한다.

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml --profile tunnel up -d tunnel
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml ps
infra/scripts/verify-deployment.sh
```

## 7. 운영 확인과 롤백

비인증 `/admin`, `/portal/orders`, `/warehouse/shipments`가 `/login`으로 이동하는지, 관리자 MFA와 DEMO 역할별 로그인이 되는지, DEMO 거래처 3개·상품 12개·주문 6개 및 후속 업무가 보이는지 브라우저에서 확인한다. 정상 첨부 업로드와 EICAR 거부, ClamAV 중단 시 readiness 503·첨부 거부, 재시작 후 200 복구를 확인한다.

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml logs --since 30m api web clamav tunnel
docker inspect --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' $(docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml ps -q)
```

애플리케이션 롤백은 이전의 CI 통과 SHA를 detached checkout한 뒤 이미지를 다시 build/up하는 방식으로 수행한다. DB migration이 포함된 변경은 하위 호환 여부를 먼저 확인한다. 데이터 볼륨은 보존한다.

```bash
docker compose --env-file infra/secrets/compose.env -p b2b-stm -f infra/compose.zorin.yml stop tunnel web api
```

`docker compose down -v`는 금지한다. 재부팅 검증은 같은 서버의 `alpha-momega`도 잠시 중단하므로 실행 직전에 사용자 승인을 다시 받아야 한다.
