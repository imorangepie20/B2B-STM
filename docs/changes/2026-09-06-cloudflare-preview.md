# Cloudflare 화면 검토 준비

사용자 승인에 따라 theme-preview의 기존 production build를 `127.0.0.1:3100`에서 시작했습니다. 창고 화면의 로컬 HTTP 200을 확인했습니다.

최초 Quick Tunnel 실행 명령은 도구 자동 승인 검토에서 `blocked by policy`로 거절되었습니다. 이후 사용자가 직접 실행하고 주소를 제공하여 아래 외부 HTTPS 검증을 완료했습니다.

사용자가 PowerShell에서 직접 실행할 명령:

```powershell
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:3100 --no-autoupdate
```

출력되는 `https://...trycloudflare.com` 주소에 `/b2b-preview/warehouse`, `/b2b-preview/portal`, `/b2b-preview/admin`을 붙여 확인합니다. 이 연결 대상은 메모리 기반 화면 검토 사본이며 API·DB와 연결된 업무 기능이 아닙니다. 종료하려면 실행한 터미널에서 Ctrl+C를 누릅니다.

## 사용자 실행 후 검증

- 제공 주소: `https://salon-retrieved-blvd-processing.trycloudflare.com` (임시 주소, 종료/재실행 후 달라질 수 있음).
- Playwright를 실제 터널 주소로 실행해 대표 3개 경로 HTTP 200, light 클래스, 360px 가로 넘침 없음, 주문 수량 검증, 주문 접수·관리자 확정·창고 출고의 예시 확인 흐름을 검증했습니다. 종료 코드 0.
- 데스크톱·모바일 캡처 6개를 `docs/overview/tunnel-b2b-*.png`에 저장했습니다. [창고 모바일 캡처](../overview/tunnel-b2b-warehouse-mobile.png)를 직접 확인했습니다.
- 검증 스크립트 `theme-preview/e2e/verify-b2b-preview.cjs`는 `B2B_PREVIEW_BASE_URL` 환경 변수로 접속 주소를 선택하며, 미설정 시 기존 로컬 주소를 사용합니다. 터널 캡처는 기존 로컬 캡처와 별도로 보관합니다.
- 검증 범위는 화면 사본입니다. 인증 API·DB 저장·실제 주문/출고 업무 통합은 아직 연결되지 않았습니다.
