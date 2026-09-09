# SDTPL_ADM 기반 전체 UI 재구축

## 변경 이유

기존 웹 화면은 중앙 카드 하나가 전체 화면을 차지해 모달 또는 임시 데모처럼 보였고, 실제 주문·재고·출고·정산 업무에서 필요한 내비게이션과 정보 밀도를 제공하지 못했습니다. 또한 `SDTPL_ADM`을 참고만 한 별도 컴포넌트가 만들어져 원본 테마와 시각적 차이가 커졌습니다.

## 변경 내용

- `SDTPL_ADM`의 Tailwind 4 토큰과 shadcn/base-ui 컴포넌트 소스를 `apps/web`에 복사했습니다.
- `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Table`, `Avatar`, `Breadcrumb`, `Sidebar`, `Sheet`, `Tooltip` 등 실제 테마 컴포넌트를 사용합니다.
- 데스크톱은 상단 전역 업무 메뉴와 최대 1600px 작업 영역을 사용하고, 모바일은 접을 수 있는 역할별 사이드바를 사용합니다.
- 관리자, 거래처 포털, 창고 업무에 각각 역할별 메뉴와 헤더를 적용했습니다.
- 로그인과 MFA 등록·확인·복구 코드 화면을 동일한 토큰과 입력 컴포넌트로 교체했습니다.
- 관리자 주문·재고 정정·기준정보·반품·정산·입금·계정 보안 화면과 거래처 주문·반품·정산, 창고 출고·반품 검수 화면의 기존 페이지별 CSS를 제거했습니다.
- 공식 `geist` 패키지의 variable 웹폰트를 `apps/web/src/app/fonts/GeistSans-Variable.woff2`로 포함하고 `next/font/local`로 로드합니다. 한글 글리프는 `Apple SD Gothic Neo`, `Malgun Gothic` 순서로 대체합니다.
- 기존 E2E가 삭제된 디자인 클래스에 결합되어 있던 부분을 접근 가능한 label과 button name 기준으로 변경했습니다.

## 유지한 동작

- API endpoint, CSRF, 세션, 역할 및 MFA 경계
- 주문 접수와 확정, 재고 예약, 부분 출고
- 반품 요청, 창고 검수, 정상 재고 복귀, 불량 처리
- 정산 초안과 마감, 입금 등록과 배분
- `requestId` 기반 중복 요청 처리

## 검증 결과

- `npm.cmd run build:web`: 통과
- `npm.cmd run build:api`: 통과
- `npm.cmd run test:foundation`: 28건 통과
- `npm.cmd run db:verify`: 운영·migration·테스트 DB 연결 및 환경 분리 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 로그인 → 주문 → 확정 → 부분 출고 → 반품 → 검수 → 불량 처리 → 정산 → 입금 배분 통과

## 화면 검토 자료

- `docs/screenshots/sdtpl-admin-topnav-desktop.png`
- `docs/screenshots/sdtpl-admin-operations-dashboard.png`
- `docs/screenshots/sdtpl-admin-master-data.png`
- `docs/screenshots/sdtpl-admin-operations-mobile.png`
- `docs/screenshots/sdtpl-portal-desktop.png`
- `docs/screenshots/sdtpl-warehouse-mobile.png`
- `docs/screenshots/sdtpl-login-desktop.png`

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
