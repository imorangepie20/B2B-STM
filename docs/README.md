# B2B-STM 문서 안내

운영 배포: [Zorin OS 배포 실행서](overview/zorin-deployment-runbook.md)

카페·음식점용 비식품 포장재·소모품 도매업을 위한 B2B 주문·재고·출고·정산 시스템입니다.
기획 승인 후 주문·재고·출고·반품·정산·입금의 핵심 업무 흐름과 역할별 웹 화면을 구현했습니다. 현재 범위와 남은 작업은 아래 현재 개발 인계를 기준으로 확인합니다.

| 문서 | 내용 |
|---|---|
| [핵심 원칙](project-rules/core-principles.md) | 기존 프로젝트에서 계승한 작업 원칙 |
| [문서 접근 순서](project-rules/doc-access-order.md) | 세션 시작과 구현 전 확인 절차 |
| [과도한 토큰 사용 보고서](reports/2026-09-09-excessive-token-usage-report.md) | 이번 작업의 반복 호출·검증 순서 문제와 재발 방지 기준 |
| [응답 유실·API 재시작 장애 주입](changes/2026-09-10-response-loss-api-restart.md) | 커밋 후 응답 폐기·인스턴스 교체·동일 결과 재생 검증 |
| [도구와 테마 계승](project-rules/tooling-and-theme.md) | 스킬·플러그인·하네스 적용 범위와 원본 보존 |
| [재사용 가능한 프로젝트 하네스](harness/README.md) | 다른 프로젝트로 옮길 규칙·스킬·플러그인·검증 문서와 템플릿 |
| [Archify 하네스 적용](harness/archify-guide.md) | 구조·업무 흐름 다이어그램 설치와 검증 절차 |
| [포트폴리오 증빙](portfolio/README.md) | 위시켓 설명·대표 화면·아키텍처·운영 인수 결과 |
| [포트폴리오 데모 진행 순서](portfolio/demo-walkthrough.md) | 실제 샘플 데이터로 역할별 업무를 설명하는 순서 |
| [designlang 디자인 분석 도구](changes/2026-09-07-designlang-tooling.md) | 지정 GitHub 도구 설치·실행·첫 화면 분석 결과 |
| [프로젝트 하네스 문서화 이력](changes/2026-09-07-portable-project-harness.md) | 범용 규칙·스킬·플러그인·템플릿 분리와 검증 |
| [기능성 UI 정식 구현 하네스 규칙](changes/2026-09-09-harness-functional-ui-rule.md) | 외형 모사 금지와 검증된 라이브러리·컴포넌트·브라우저 검증 기준 |
| [프로젝트 개요](overview/project-brief.md) | 목표·대상·개발 범위·완료 기준 |
| [현재 개발 인계](overview/current-development-context.md) | 실행 환경·완료 범위·최신 검증·남은 작업 |
| [다음 대화 작업 인계](overview/next-session-handoff.md) | 새 대화 시작 위치·직전 완료 범위·다음 순서·검증 방식 |
| [운영 데이터 CSV·Excel 내보내기](changes/2026-09-09-operational-data-export.md) | 서버 필터·역할 권한·감사 기록이 적용된 업무 파일 다운로드 |
| [배송·반품 첨부 증빙](changes/2026-09-09-business-attachments.md) | 비공개 파일 저장·형식 검사·업무 권한·화면 연결 |
| [첨부 악성 파일 검사 연동](changes/2026-09-09-attachment-malware-scanning.md) | ClamAV INSTREAM 검사·운영 fail-closed·준비 상태 확인 |
| [주문·출고·정산 알림 Outbox](changes/2026-09-09-notification-outbox.md) | 트랜잭션 적재·중복 방지·메일 발송·실패 재시도·관리 화면 |
| [초기 데이터 이관 안내](overview/initial-data-import-guide.md) | CSV 형식·미리보기·충돌 정책·반영 절차 |
| [운영 인수 스모크 점검](overview/operational-acceptance-guide.md) | 역할별 접근 통제·30개 동시 조회·성능 결과 판정 |
| [로컬 샘플 데이터 사용 안내](overview/demo-data-guide.md) | 샘플 계정·업무 상태·시드·초기화·브라우저 확인 방법 |
| [개발 환경 구성](overview/development-environment.md) | 현재 기술 버전·DB 역할·실행·검증·배포 잔여 작업 |
| [API 실행 기반](overview/api-foundation.md) | API·환경 검증·migration 명령과 실제 DB/HTTP 검증 |
| [서버 세션·역할 경계](overview/identity-boundary.md) | 인증 기본 차단·만료·역할 회수·MFA 접근 검사 |
| [CSRF·로그아웃 변경](changes/2026-09-06-csrf-logout.md) | 동일 출처 검사·세션에 묶인 토큰·로그아웃·실패 제한 보정 |
| [보호 업무 화면 세션 가드](changes/2026-09-09-workspace-session-guard.md) | 만료 세션의 빈 화면 노출 차단과 로그인 이동·주기 재확인 |
| [계정 생명주기 변경](changes/2026-09-06-account-lifecycle.md) | 초대·수락·관리자 재설정·일회성 토큰·비밀번호 변경 경합 |
| [관리자 계정 운영 화면](changes/2026-09-09-account-administration.md) | 계정 목록·초대·재설정·활성 상태·공개 비밀번호 설정 |
| [계정 이메일 전달](changes/2026-09-09-account-email-delivery.md) | SMTP 초대·재설정 링크, 발송 결과 기록과 실패 시 직접 전달 |
| [MFA API 변경](changes/2026-09-06-mfa.md) | 등록·인증·복구 코드·암호화·실패 제한과 남은 범위 |
| [MFA 복구 코드 재발급](changes/2026-09-09-mfa-recovery-code-regeneration.md) | 본인 재인증·기존 코드 폐기·새 코드 단회 표시 |
| [아키텍처와 도메인 개요](architecture/system-outline.md) | 적용 기술·시스템 경계·도메인 관계와 남은 구조 |
| [기술 구조와 정합성 설계](architecture/transaction-and-module-design.md) | 구현된 모듈·트랜잭션·잠금·중복 요청 처리 |
| [인증·금액·운영 설계](architecture/auth-money-operations-design.md) | 세션·계정·정확한 금액 계산·Docker 확인·복원 방안 |
| [DB 스키마 설계](architecture/database-schema-design.md) | 테이블·관계·수량/금액 제약·잠금 보완 |
| [제품 구현 현황과 후속 계획](superpowers/plans/2026-09-05-product-delivery-plan.md) | 영역별 완료·부분 완료·미구현 체크리스트 |
| [화면 구성과 업무 연결](architecture/screen-and-navigation-design.md) | 실제 역할별 경로·화면·후속 물류 UI |
| [기획·구현 현행 점검표](overview/planning-completion-checklist.md) | 구현 완료·잔여·후속 범위 구분 |
| [대표 화면 검토 결과](overview/screen-preview-results.md) | 3개 화면 URL·동작·검증·캡처 |
| [업무 시나리오](business-logic/operating-scenarios.md) | 구현된 정상·예외 흐름과 후속 범위 |
| [주문·재고 확보 정책](business-logic/order-and-allocation-policy.md) | 확정된 승인·예약·부분 출고·취소 정책 |
| [반품·정산 정책](business-logic/returns-and-settlement-policy.md) | 확정된 검수·차감·마감·입금 배분·환불 정책 |
| [첫 운영 버전 기준](overview/operating-baseline.md) | 확정된 규모·권한·범위·성능·복구 검수 목표 |
| [테마 실행과 검토](overview/theme-review.md) | 실행 명령·검증 결과·남은 시각 검수 |
| [단계별 현황과 로드맵](overview/roadmap.md) | 완료 단계와 현장 물류·배포 후속 순서 |
| [의사결정 기록](decisions/decision-log.md) | 사용자 확정과 제안 구분 |
| [PostgreSQL 환경 결정](decisions/postgresql-environment.md) | 기존 Docker 재사용·전용 DB와 계정·테스트 분리 |
| [문서 기반 구성 이력](changes/2026-09-05-project-documentation.md) | 이번 변경과 검증 |
| [SDTPL_ADM 기반 전체 UI 재구축](changes/2026-09-07-sdtpl-ui-rebuild.md) | 테마 컴포넌트·상단 메뉴·Geist 웹폰트·역할별 화면 재구축 |
| [관리자 운영 대시보드](changes/2026-09-07-admin-operations-dashboard.md) | 운영 지표·입고·재고 현황과 기준정보 화면 분리 |
| [관리자 대시보드 기간 통계](changes/2026-09-09-admin-dashboard-statistics.md) | 실제 주문·출고·매출·반품·재고·정산 집계와 분석 카드 |
| [역할별 업무 통계 그래프 확장](changes/2026-09-09-rich-operational-analytics.md) | 관리자·창고·거래처의 추세·누적·순위 그래프와 권한별 집계 API |
| [공개 README와 포트폴리오 제출 자료 정리](changes/2026-09-09-portfolio-readme-finalization.md) | 대표 화면·업무 흐름·실행·검증·공개 한계가 드러나는 제출본 |
| [관리자 주문 작업 화면](changes/2026-09-07-admin-order-workspace.md) | 주문 검색·목록·상세와 예약·출고·미확보 수량 표시 |
| [창고 주문별 출고 작업](changes/2026-09-07-warehouse-shipment-workspace.md) | 주문 단위 선택·수량 입력·출고 후 잔량 확인 |
| [창고 출고 작업 담당과 인계](changes/2026-09-09-warehouse-work-ownership.md) | 주문별 단일 담당, 경쟁 차단, 사유 있는 반납과 완료 자동 종료 |
| [출고별 배송·인도 관리](changes/2026-09-09-shipment-delivery-lifecycle.md) | 배송 일정·운송장·실패 재예약·인수 증빙과 역할별 조회 |
| [재고 실사 보류와 예약 조정](changes/2026-09-09-stock-count-holds.md) | SKU 이동 보류, 실측 확정, 최근 주문 예약 해제와 감사 기록 |
| [불량품 해결과 실제 환불](changes/2026-09-09-defect-resolution-refunds.md) | 격리품 공급처 반환·폐기, 원천 잔액 기반 실제 환불과 감사 기록 |
| [거래처 주문 진행 이력](changes/2026-09-07-customer-order-history.md) | 거래처별 주문 상태·수량·금액 조회와 역할별 수량 일치 검증 |
| [관리자 주문 이력·출고 원장](changes/2026-09-07-admin-order-history.md) | 완료·취소 주문 조회, 실제 출고·매출 원장 연결, 취소 사유 보존 |
| [미확보 주문 재배정](changes/2026-09-07-backorder-reallocation.md) | 추가 입고 재고의 안전한 재예약과 동시·중복 요청 검증 |
| [거래처 잔량 취소 요청](changes/2026-09-07-customer-order-cancellation-request.md) | 취소 요청 중 출고 보류와 관리자 승인·반려, 감사 이력 |
| [샘플 데이터와 운영 복구 검증](changes/2026-09-07-demo-data-and-operations-verification.md) | 반복 가능한 DEMO 데이터·브라우저 확인·백업 복원 리허설 |
| [초기 데이터 CSV 이관](changes/2026-09-07-initial-data-import.md) | 기준정보·단가·초기 재고 미리보기와 원장 반영 |
| [운영 인수 권한·성능 스모크](changes/2026-09-07-operational-acceptance-smoke.md) | 권한 행렬과 실제 API 동시 조회 측정 자동화 |
| [주문 목록 서버 페이지 처리](changes/2026-09-07-order-list-pagination.md) | 목표 규모 대응 주문 조회 제한과 화면 페이지 이동 |
| [주문 전체 데이터 서버 필터](changes/2026-09-09-order-server-filters.md) | 주문 검색·상태·기간 조건과 전체 건수 일치 |
| [운영 감사 로그](changes/2026-09-09-operational-audit-log.md) | 주요 업무 변경의 작업자·대상·사유 통합 조회 |
| [창고 대기 업무 서버 페이지 처리](changes/2026-09-09-warehouse-queue-pagination.md) | 출고·반품 대기 검색과 주문 경계 보존 페이지 처리 |
| [관리자 재고·반품 서버 페이지 처리](changes/2026-09-09-admin-inventory-return-pagination.md) | 재고 정정·반품 차감 검색과 대량 목록 페이지 처리 |
| [최근 운영 화면 반응형 시각 검증](changes/2026-09-09-recent-pages-visual-qa.md) | 관리자·창고·거래처 16개 화면, 32개 데스크톱·모바일 조합의 자동·직접 검토 |
| [기준 문서 현행화](changes/2026-09-09-documentation-current-state.md) | 계획·환경·인증·아키텍처·정책·화면 문서의 실제 구현 상태 교정 |

문서의 `확정`은 사용자 요청 또는 명시적 동의를 근거로 합니다. `제안`은 승인 전 설계안입니다.
현재 상태와 다음 작업은 `overview/current-development-context.md`와 `superpowers/plans/2026-09-05-product-delivery-plan.md`를 우선 기준으로 합니다. 날짜별 변경 기록은 당시 구현·검증 이력으로 보존합니다.
