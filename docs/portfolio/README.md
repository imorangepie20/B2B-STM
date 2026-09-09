# B2B-STM 포트폴리오 자료

중소 유통업체의 거래처 주문부터 창고 출고, 반품, 월 정산과 입금 배분까지 연결한 프로젝트입니다. 아래 자료는 구현 범위, 데모 순서, 검증 결과를 서로 분리해 기록합니다.

## 제출 자료

| 자료 | 용도 |
|---|---|
| [위시켓 프로젝트 설명](wishket-project-summary.md) | 문제, 사용자, 구현 범위, 기술 판단, 공개 한계 |
| [데모 진행 순서](demo-walkthrough.md) | 약 10분 동안 역할별 업무 흐름을 설명하는 순서 |
| [운영 인수 증빙](operational-acceptance-evidence.md) | 완료 기준별 테스트와 운영 검사 결과 |
| [대화형 시스템 아키텍처](b2b-stm-architecture.html) | 역할, API, 업무 모듈, PostgreSQL 원장 관계 |
| [아키텍처 JSON](b2b-stm-architecture.json) | 다이어그램의 typed source |
| [아키텍처 시각 검사](b2b-stm-architecture.visual-check.json) | viewport별 containment와 readability 검사 결과 |

## 대표 화면

### 관리자 운영 현황

주문·출고·매출·반품·재고·정산 지표와 일별 추세, 상품 순위를 한 화면에서 확인합니다.

![관리자 운영 현황](../screenshots/recent-pages/admin-dashboard-desktop.png)

### 거래처 주문 이력

주문 수량, 누적 출고, 예약, 미확보, 취소를 구분하고 미출고 잔량 취소를 요청할 수 있습니다.

![거래처 주문 이력](../screenshots/recent-pages/portal-order-history-desktop.png)

### 창고 출고 작업

출고 대기 경과 시간과 처리량을 확인하고 주문별 예약 잔량 안에서 부분 출고합니다.

![창고 출고 작업](../screenshots/recent-pages/warehouse-shipments-desktop.png)

### 모바일 작업 화면

- [창고 출고 모바일](../screenshots/recent-pages/warehouse-shipments-mobile.png)
- [창고 반품 검사 모바일](../screenshots/recent-pages/warehouse-returns-mobile.png)
- [거래처 주문 이력 모바일](../screenshots/recent-pages/portal-order-history-mobile.png)

모든 화면은 `SDTPL_ADM` 라이트 테마 구조와 Geist Sans를 사용합니다. 최근 Playwright 검증은 관리자·창고·거래처 16개 화면을 데스크톱 1440×900과 모바일 390×844에서 확인해 32/32 통과했습니다.
