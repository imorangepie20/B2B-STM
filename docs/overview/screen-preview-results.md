# 실제 제품 화면 검토 결과

검토일: 2026-09-09. 현재 제품 화면은 `SDTPL_ADM` 라이트 테마의 구조와 Geist Sans를 적용하고 실제 API·PostgreSQL 데모 데이터에 연결합니다. 초기 기획용 `/b2b-preview` 화면은 검토 기준에서 제외했습니다.

## 최신 검토 범위

다음 7개 화면을 데스크톱 1440×900과 모바일 390×844에서 확인했습니다.

| 역할 | 화면 |
|---|---|
| 시스템 관리자 | 계정 관리, 계정 보안, 감사 로그 |
| 운영 관리자 | 재고 정정, 반품 차감·불량 처리 |
| 창고 담당자 | 출고 작업, 반품 검수 대기 |

`npm.cmd run ui:verify-recent`는 관리자·창고 계정에 만료 1시간의 임시 세션을 만들고 실행 후 삭제합니다. 비밀번호와 MFA 비밀값은 사용하지 않거나 출력하지 않습니다.

## 검증 결과

- 7개 경로 × 2개 viewport, 총 14/14 통과
- 모든 경로의 기대 제목과 실제 데이터 표시 확인
- 문서 전체 가로 넘침 0건
- 브라우저 console error 0건
- 상태 코드 400 이상인 동일 출처 요청 0건
- 모든 화면의 `body`에 Geist Sans 적용, 기본 본문 크기 16px 확인
- 감사 로그 표는 모바일에서 카드 내부 가로 스크롤을 사용해 열을 보존합니다.

기계 판독 결과는 [recent-pages-visual-qa.json](recent-pages-visual-qa.json)에 보관합니다.

## 대표 캡처

- [계정 보안 모바일](../screenshots/recent-pages/admin-account-security-mobile.png)
- [감사 로그 데스크톱](../screenshots/recent-pages/admin-audit-events-desktop.png) / [모바일](../screenshots/recent-pages/admin-audit-events-mobile.png)
- [재고 정정 데스크톱](../screenshots/recent-pages/admin-inventory-adjustments-desktop.png) / [모바일](../screenshots/recent-pages/admin-inventory-adjustments-mobile.png)
- [반품 차감 데스크톱](../screenshots/recent-pages/admin-return-credits-desktop.png) / [모바일](../screenshots/recent-pages/admin-return-credits-mobile.png)
- [출고 작업 데스크톱](../screenshots/recent-pages/warehouse-shipments-desktop.png) / [모바일](../screenshots/recent-pages/warehouse-shipments-mobile.png)
- [반품 검수 데스크톱](../screenshots/recent-pages/warehouse-returns-desktop.png) / [모바일](../screenshots/recent-pages/warehouse-returns-mobile.png)

## 재현 방법

1. API `http://127.0.0.1:3200`과 웹 `http://127.0.0.1:3101`을 실행합니다.
2. 루트에서 `npm.cmd run ui:verify-recent`를 실행합니다.
3. JSON receipt와 `docs/screenshots/recent-pages/`의 새 캡처를 확인합니다.

이 검사는 최근 관리자·창고 화면의 시각 회귀 스모크입니다. 거래처 주문부터 정산까지의 업무 변경 검증은 Playwright 업무 E2E와 운영 인수 증빙을 함께 사용합니다.
