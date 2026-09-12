# 현재 개발 인계

## 2026-09-13 채용 포트폴리오 소개

사용자 승인으로 루트 `README.md`를 GitHub 대표 프로젝트의 채용 담당자용 소개로 개편했습니다. 핵심 문제·해결 방식, 설계 판단, 코드와 검증 증거를 먼저 배치하고 역할별 화면·로컬 실행을 연결했습니다. 테스트 결과는 2026-09-09~10 검증 이력이며 이번 문서 작업의 새 실행 결과가 아닙니다. 열어둔 Chrome의 배포 관리자 대시보드는 읽기 전용으로 확인했습니다. 개인 기여율·실사용 실적을 추정하지 않았으며 업무 구현과 배포 설정은 변경하지 않았습니다. 상세 변경·검증 범위는 [채용 소개 개편 기록](../changes/2026-09-13-recruiter-portfolio-readme.md)을 참조합니다.

## 2026-09-10 배포 진행

추가 확인: 운영 system 관리자 계정 1개 활성 및 MFA 등록 확정 확인. 관리자 생성·MFA는 완료되었으며 아래 미완료 표기는 이전 기록이다.

최신: `https://stm.approid.team` 공개 연결 완료. Tunnel 정상, 외부 Web·API readiness HTTP 200, 브라우저 미인증 로그인 이동 확인. 메일은 비활성 상태이며 system 관리자 bootstrap·MFA, 인증된 첨부/EICAR·장애 복구·재부팅 검증은 남아 있다. 아래 token 대기는 이전 진행 기록이다.

Zorin 전용 스택의 API·Web·DB·ClamAV가 healthy이며 서버 내부 Web 200·API readiness 정상이다. 새 DEMO 데이터 생성 및 재실행 무변경을 확인했다. `badd5f6`의 GitHub CI 전체 통과. 사용자 승인으로 SMTP는 `MAIL_TRANSPORT=disabled` 상태다. Cloudflare 전용 터널은 생성했으나 token 입력 대기이며 `stm.approid.team` 외부 연결은 미완료다. 상세 증거는 [배포 변경 기록](../changes/2026-09-10-zorin-cloudflare-deployment.md)을 참조한다.

최종 갱신: 2026-09-13. 이번 갱신은 채용 포트폴리오 소개 문서 변경이며 기능 검증 이력의 날짜는 아래에 별도로 표시합니다.

새 대화에서는 [다음 대화 작업 인계](next-session-handoff.md)를 먼저 확인합니다.

## 제품 목표와 경계

B2B-STM은 카페·음식점용 비식품 포장재·소모품 도매업체를 위한 주문·재고·출고·반품·정산 시스템입니다. 거래처 주문 포털, 창고 담당 화면, 관리자 화면이 하나의 PostgreSQL 업무 기록을 사용합니다.

`C:\Users\jowoo\alpahMomega` 부동산 프로젝트와 코드·DB·계정·비밀값을 공유하지 않습니다. `SDTPL_ADM/`은 UI 기준 원본이며 수정하지 않습니다. 필요한 토큰·컴포넌트·Geist Sans는 `apps/web`에 복사해 사용합니다.

## 기술과 실행

- Web: Next.js 16.3.4, React 19.2.4, Tailwind CSS 4, shadcn/base-ui, Recharts 3.8.0
- API: NestJS 11.2.3, Node.js 24
- DB: 기존 Docker PostgreSQL 16.15의 `b2b_stm`, 테스트 `b2b_stm_test`
- DB 접근: `pg`, parameterized SQL, 순차 migration과 checksum
- 웹: `http://127.0.0.1:3101`
- API: `http://127.0.0.1:3200`

웹과 API는 현재 위 포트에서 새 production build로 실행 중입니다. `.env.local`과 `.demo-credentials.json`은 로컬 전용이며 내용을 문서·로그·공개 저장소에 복사하지 않습니다.

## 구현 완료 범위

### 인증·계정

- 비밀번호 로그인, 서버 세션, Origin·CSRF, 로그아웃, 실패 제한
- 거래처·창고·운영·정산·시스템 역할과 거래처 데이터 격리
- 계정 초대·수락·재설정·활성 상태와 SMTP 전달 결과
- TOTP MFA, 복구 코드, 재발급, 관리자 기기 초기화
- 보호 업무 레이아웃의 세션·역할·MFA 선검사와 만료 시 로그인 이동

### 기준정보·입고·재고

- 거래처·공급처·창고·상품·판매 단위·거래처 단가
- 빠른 입고 확정, 재고 잔액과 이동 원장
- 사유가 있는 재고 정정
- SKU별 재고 실사 보류·실측 확정·최근 주문 예약 조정과 감사 이력
- CSV 미리보기·오류 행·중복 실행 방지와 초기 재고 이관

### 주문·출고

- 거래처별 상품·단가 조회와 주문 단가·판매 단위 스냅샷
- 관리자 확정 시 가용 재고 범위 예약, 부족 잔량과 추가 입고 후 재배정
- 부분 출고, 예약·정상 재고 차감, 출고·미수 원장 원자적 생성
- 담당자 기반 피킹·검수 수량 저장, 정정 이력, 검수 수량 이내 부분 출고
- 출고별 배송 예정·운송장·배송 중·실패 재예약·인도 완료와 수령 증빙
- 거래처 잔량 취소 요청과 관리자 승인·반려, 검토 중 출고·재배정 차단
- 주문별 창고 담당 한 명, 경쟁 담당자·타 담당자 출고 차단
- 사유가 있는 담당 반납, 부분 출고 동안 담당 유지, 완료·취소 시 자동 종료

### 반품·정산·입금

- 원출고 기반 거래처 반품 요청과 초과·중복 수량 차단
- 창고 정상·불량 검수, 정상 재고 복귀와 불량 격리
- 관리자 반품 차감과 마감 후 다음 기간 조정
- 거래처·월별 정산 초안과 마감
- 입금 등록·부분 배분·다중 배분·배분 취소·입금 취소
- 주문 과세 정책 스냅샷, 누적 부분 출고 세액 반올림, 반품 세액 차감
- 거래처별 지급 기한 스냅샷과 관리자·거래처 인쇄 거래명세서

### 조회·통계·운영

- 관리자·창고·거래처의 서버 검색·필터·페이지 처리
- 주문 이력·재고 현황·정산 현황의 필터 연동 CSV·Excel 내보내기와 감사 기록
- 배송·반품 JPEG·PNG·PDF 증빙의 비공개 저장, 서명 검사, 역할·거래처별 다운로드
- ClamAV `INSTREAM` 기반 저장 전 악성 파일 검사, 운영 fail-closed와 readiness 확인
- 주문·출고·정산 메일 outbox, 중복 방지, 자동·수동 실패 재처리와 관리자 현황 화면
- 실제 PostgreSQL 집계 기반 기간 통계와 역할별 Recharts 그래프
- 수량·금액·계정·MFA·출고 담당·배송 처리 통합 감사 로그
- 반복 가능한 DEMO 데이터와 역할별 계정
- DB 권한·무결성·백업 복원·운영 인수 스모크
- 공개 README, 위시켓 설명, 대표 화면, Archify 아키텍처와 데모 동선

## 최신 검증 증거

- `npm.cmd run test:fault-recovery`: 주문 commit 후 응답 유실, API 인스턴스 교체, 동일 결과 재생과 중복 0건 통과
- `npm.cmd run build:web`: 보호 업무 화면 세션 가드 반영 후 통과
- `npm.cmd run test:auth-redirect`: 미인증 `/admin`, `/portal/orders`, `/warehouse/shipments` 로그인 이동 통과
- `npm.cmd run build:api`: 첨부 악성 파일 검사 연동 후 통과
- 스캐너·설정·readiness 집중 테스트 5/5 통과, 첨부 대상 통합 테스트 1/1 통과
- `npm.cmd run test:foundation`: 알림 구현 전 기준 71/71, 알림 대상 통합 테스트 통과. 장시간 전체 재실행은 사용자 요청으로 중단
- `npm.cmd run build:api`: 통과
- `npm.cmd run build:web`: 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 로그인부터 담당 시작·피킹·검수·부분 출고·반품·정산·입금·취소 승인까지 통과
- `npm.cmd run ui:verify-recent`: 16개 화면 × 데스크톱·모바일 32/32
- `npm.cmd run db:verify`: 개발·테스트 DB와 역할 경계 통과
- `npm.cmd run ops:verify`: 36개 스냅샷 테이블, 15개 무결성 검사 통과
- `npm.cmd run repo:verify-public`: 제외 규칙 7개, 공개 후보 417개 경로 통과
- 로컬 API ready, `/admin/notifications`와 인증된 알림 API HTTP 200

목표 규모 30분 본 시험은 실행하지 않았습니다. 로컬 운영 인수 스모크 결과를 실배포 성능으로 확대 해석하지 않습니다.

## 남은 작업 순서

1. CI, 실제 배포, 오류 추적·로그·가용성 알림과 실제 ClamAV 연결 확인
2. 별도 복원 환경의 최종 RPO/RTO 측정
3. 주문 100,000건·동시 사용자 30명·30분 본 시험

성능 시험과 장시간 전체 회귀 테스트는 사용자 요청으로 중단된 상태입니다. 다음 구현 대상은 CI와 실제 배포·관측성 구성입니다.

## 주요 문서

- [프로젝트 개요](project-brief.md)
- [단계별 현황과 로드맵](roadmap.md)
- [제품 구현 현황과 후속 계획](../superpowers/plans/2026-09-05-product-delivery-plan.md)
- [시스템 구조](../architecture/system-outline.md)
- [업무 시나리오](../business-logic/operating-scenarios.md)
- [로컬 샘플 데이터](demo-data-guide.md)
- [운영 인수 증빙](../portfolio/operational-acceptance-evidence.md)
- [출고 담당과 인계](../changes/2026-09-09-warehouse-work-ownership.md)
- [피킹·검수 기반 출고 통제](../changes/2026-09-09-picking-inspection.md)
- [출고별 배송·인도 관리](../changes/2026-09-09-shipment-delivery-lifecycle.md)
- [재고 실사 보류와 예약 조정](../changes/2026-09-09-stock-count-holds.md)
- [불량품 해결과 실제 환불](../changes/2026-09-09-defect-resolution-refunds.md)
- [세금·지급 기한·거래명세서](../changes/2026-09-09-tax-payment-terms-statements.md)
- [운영 데이터 CSV·Excel 내보내기](../changes/2026-09-09-operational-data-export.md)
- [배송·반품 첨부 증빙](../changes/2026-09-09-business-attachments.md)
- [첨부 악성 파일 검사 연동](../changes/2026-09-09-attachment-malware-scanning.md)
- [주문·출고·정산 알림 Outbox](../changes/2026-09-09-notification-outbox.md)
- [역할별 업무 통계](../changes/2026-09-09-rich-operational-analytics.md)
- [최근 화면 시각 검증](../changes/2026-09-09-recent-pages-visual-qa.md)
