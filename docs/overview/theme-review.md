# 테마 실행과 검토

최초 검토: 2026-09-05. 최종 갱신: 2026-09-09. 라이트 모드와 `SDTPL_ADM` 컴포넌트 체계를 제품 전체에 적용했습니다. Playwright로 관리자·창고·거래처 16개 화면을 데스크톱·모바일에서 32/32 검증했습니다. 아래 초기 실행 기록은 당시 테마 선정 과정의 이력입니다.

## 2026-09-07 기준 테마 확정

- `SDTPL_ADM/`은 단순 참고 자료가 아니라 B2B 웹 UI의 기준 테마다.
- 사용자가 직접 만든 테마임을 확인하고, 필요한 UI 코드와 자산을 `apps/web`으로 복사해 사용하는 것을 허용했다.
- 이후 신규·개편 인증, 관리자, 거래처, 창고 UI는 이 테마의 light mode, shadcn 토큰, 사이드바·헤더·카드·폼·표 패턴을 사용한다.
- 원본 `SDTPL_ADM/`은 계속 수정하지 않으며, B2B 업무 API·데이터와 무관한 예제·더미 데이터·AI 앱은 이식하지 않는다.

## 실행 환경

- 작업 경로: `C:\Users\jowoo\B2B-STM\theme-preview`.
- Node.js `v24.19.0`. 전역 pnpm이 없어 `npx.cmd --yes pnpm@10 install --frozen-lockfile`로 설치했습니다. 실제 pnpm 버전은 `10.34.5`입니다.
- 잠금 파일 기준 683개 패키지를 설치했습니다. `pnpm-lock.yaml`은 원본과 동일합니다.
- 설치 시 `msw` 빌드 스크립트는 pnpm 기본 정책에 따라 실행되지 않았습니다. 추가 허용 없이 앱 빌드가 통과했습니다.
- 실행 명령: `npm.cmd run dev -- --hostname 127.0.0.1 --port 3100`.
- 로컬 URL: `http://127.0.0.1:3100/dashboard/ecommerce`.
- 개발 서버는 로컬 루프백에만 바인딩합니다. 서버가 종료됐다면 위 명령으로 다시 실행합니다.

## 확인 결과

- `npm.cmd run build` 종료 코드 0. TypeScript 검사와 101개 정적 페이지 생성 통과.
- `npm.cmd run lint` 종료 코드 0, 오류 0개·기존 테마 경고 28개. 미사용 식별자와 React Compiler·effect 관련 경고 등이 있어 무경고 상태는 아닙니다. 이번 실행 준비에서는 소스를 수정하지 않았습니다.
- `/dashboard/ecommerce`, `/dashboard/default`, `/dashboard/payment` HTTP 200 확인.
- 원본 `SDTPL_ADM/` Git 상태 변경 없음. 제품 업무 코드는 수정하지 않았습니다.
- 연결된 CUA 브라우저가 없고 in-app browser도 사용 불가하여 직접 화면 검수는 수행하지 못했습니다. HTTP 성공은 시각·조작 검증을 대신하지 않습니다.
- UI/UX 스킬 검색은 Python 실행 환경 부재로 실행하지 못했습니다. 검토 시 스킬의 기본 접근성·터치·반응형 점검 항목을 참고하되 검색 결과를 확보했다고 주장하지 않습니다.

## 다음 시각 검수

브라우저를 연결한 뒤 기본·주문·결제 대시보드, 밝은/어두운 모드, 메뉴와 표·입력·확인창을 확인합니다.
데스크톱과 360px 모바일 폭에서 가독성·가로 넘침·터치 영역을 확인해야 합니다.
원본은 영어와 샘플 데이터로 구성돼 있으므로 한국어 주문·출고 화면에 적합한지는 별도 대표 화면 검토가 필요합니다.
테마 확정은 사용자 검토 후 기록합니다. 현재 실행 중인 화면은 B2B 제품 기능이 아닙니다.

## 라이트 모드 확정과 적용

- 사용자 지시: 어두운 테마 대신 밝은 테마 사용. 밝은 모드를 제품 UI 기준으로 확정합니다.
- 사본 루트 ThemeProvider에 `defaultTheme="light"`, `forcedTheme="light"`, `enableSystem={false}`를 적용했습니다. 알림도 `theme="light"`로 통일했습니다.
- 고정 테마에서 동작하지 않는 헤더 테마 전환 버튼을 제거했습니다. 원본은 수정하지 않았습니다.
- `npx.cmd playwright install chromium`으로 검증용 Chromium을 설치했습니다. VS Code 내부 브라우저 연결이 없어도 Playwright로 검증할 수 있습니다.
- `node e2e/verify-light.cjs` 통과: OS 다크 모드와 localStorage의 기존 dark 값을 동시에 설정해도 HTML class와 colorScheme이 모두 light이며 테마 전환 버튼이 없습니다.
- 데스크톱 1440×1000, 모바일 390×844 캡처에서 밝은 배경을 확인했습니다. [데스크톱](theme-light-desktop.png), [모바일](theme-light-mobile.png).
- 변경한 두 TSX 파일의 ESLint 검사 통과. 이전 전체 빌드 결과는 이번 변경 전 기록이며 재빌드하지 않았습니다.
- 캡처의 기본 serif 글꼴과 차트 표시 상태는 추가 테마 검토 대상입니다. 이번 검증은 라이트 모드 적용에 한정하며 전체 UI 완성도를 확인한 것은 아닙니다.
