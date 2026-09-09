# 관리자 운영 대시보드와 기준정보 화면 분리

## 변경 이유

기존 관리자 첫 화면에는 공급처·창고·상품 등록 폼이 운영 지표와 함께 배치되어 있었습니다. 이 구조는 주문, 반품, 재고, 입금 중 무엇을 먼저 처리해야 하는지 빠르게 판단하기 어렵고 실제 운영 대시보드의 정보 밀도도 낮췄습니다.

## 변경 내용

- `/admin`을 운영 판단 중심의 전체 화면 대시보드로 재구성했습니다.
- 처리 대기 주문, 처리 대기 반품, 가용 재고 없음, 미배분 입금, 총 가용 재고, 운영 상품을 실제 API 응답과 재고 합계로 표시합니다.
- 전체 창고의 보유·예약·가용 수량과 예약 비중을 실제 재고 데이터로 계산합니다.
- 주문 확정, 반품 처리, 월 정산 초안, 재고 정정 화면으로 이동하는 바로가기를 추가했습니다.
- 입고 빠른 처리와 검색 가능한 창고별 재고표를 같은 화면에 유지했습니다.
- 공급처·창고·상품 등록을 `/admin/pricing`으로 이동하고 거래처 등록도 함께 제공하도록 정리했습니다.
- `/admin/pricing` 메뉴 이름을 `기준정보 · 단가`로 변경하고 기준정보 건수, 신규 등록, 거래처·상품 수정, 단가 저장과 목록을 한 화면에 구성했습니다.
- 모든 역할의 상단 헤더에서 CSRF 보호 로그아웃을 실행할 수 있도록 로그아웃 버튼을 복구했습니다.
- KPI 카드, 입력, 버튼, 배지, 표는 `SDTPL_ADM`에서 복사한 shadcn/base-ui 컴포넌트와 토큰을 사용합니다.
- 데스크톱 1440px에서는 KPI 6개를 한 줄에 배치하고 모바일에서는 한 열로 전환합니다.

## 데이터 기준

- 운영 대기 건수와 미배분 입금: `GET /api/admin/dashboard`
- 거래처·공급처·창고·상품: `GET /api/admin/catalog`
- 보유·예약·가용 수량: `GET /api/admin/inventory`
- 예약 비중: 전체 `reservedQuantity / onHandQuantity`

표시를 위한 임의 업무 수치나 가짜 추세 데이터는 추가하지 않았습니다.

## 검증 결과

- `npm.cmd run build:web`: 통과, 17개 route 생성
- Playwright 1440px `/admin`, `/admin/pricing`: 문서 가로 넘침 없음
- Playwright 390px `/admin`: 문서 가로 넘침 없음
- 브라우저 계산 스타일: `geistSans, "geistSans Fallback", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 로그인부터 주문, 부분 출고, 반품, 검수, 차감, 정산, 입금 배분, 로그아웃까지 통과

## 화면 검토 자료

- `docs/screenshots/sdtpl-admin-operations-dashboard.png`
- `docs/screenshots/sdtpl-admin-master-data.png`
- `docs/screenshots/sdtpl-admin-operations-mobile.png`

`SDTPL_ADM/` 원본은 수정하지 않았습니다.
