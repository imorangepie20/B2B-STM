# Cloudflare Quick Tunnel 원격 접근 복구

## 변경 이유

원격 주소에서 `unexpected status 401 Unauthorized: Proxy authentication must be configured before remote access is allowed`가 표시됐습니다. 개발 검토용 외부 접근을 다시 사용할 수 있어야 했습니다.

## 근본 원인

STM 웹과 API 로컬 프로세스가 종료돼 있었고, 기존 Cloudflare Quick Tunnel 프로세스와 `cloudflared` 실행 파일도 없었습니다. 이전 `trycloudflare.com` 주소는 프로세스 수명에 묶인 임시 주소이므로 더 이상 STM 웹을 가리키지 않았습니다. 해당 401은 제품 인증 API가 아니라 이전 원격 프록시 경로에서 반환된 응답입니다.

## 변경 내용

- `npm.cmd run start:api`와 `npm.cmd run start:web`로 `127.0.0.1:3200`, `127.0.0.1:3101`을 재기동했습니다.
- 로컬 전용 `tools/cloudflared.exe`를 사용해 `cloudflared tunnel --url http://127.0.0.1:3101 --no-autoupdate`로 Quick Tunnel을 실행했습니다. 실행 파일은 공개 저장소에서 제외합니다.
- Quick Tunnel은 검토·테스트 전용입니다. 주소는 터널 프로세스가 실행되는 동안만 유효하며, 운영 공개에는 고정 도메인과 Cloudflare 계정 기반 named tunnel을 별도로 구성해야 합니다.

## 검증

- `http://127.0.0.1:3101` 응답 `200`
- `http://127.0.0.1:3200/api/health/ready` 응답 `200`
- 새 Quick Tunnel 주소에서 STM 로그인 페이지의 HTTP 응답 `200`
