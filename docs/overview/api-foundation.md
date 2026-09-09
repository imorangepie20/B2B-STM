# API와 마이그레이션 실행 기반

최초 작성: 2026-09-05. 이 문서는 제품 계획 1단계의 당시 실행 기반 기록입니다. 현재 인증·업무 API까지 구현됐으며 최신 상태는 [현재 개발 인계](current-development-context.md)와 [제품 구현 현황](../superpowers/plans/2026-09-05-product-delivery-plan.md)을 기준으로 합니다.

## 구현

- 루트 npm workspace에서 `apps/api`를 관리합니다. 테마 사본은 기존 pnpm 환경으로 유지합니다.
- NestJS common/core/platform-express 11.2.3, TypeScript 5.9.3으로 API를 빌드합니다.
- 환경 설정에서 DB URL 형식·B2B DB 이름·API 포트를 검사하고 운영 모드에서 테스트 DB를 거절합니다.
- API 기본 바인딩은 `127.0.0.1:3200`입니다. API_HOST·API_PORT로 변경할 수 있습니다.
- `/api/health/live`는 프로세스 응답, `/api/health/ready`는 DB의 application_metadata와 설정된 ClamAV `clamd`의 `PING` 결과를 제공합니다.
- DB 미접속·미적용 스키마 또는 운영 첨부 검사기 장애는 준비 상태 503으로 처리합니다. 연결 문자열·비밀번호는 응답과 시작 오류에 노출하지 않습니다.
- 종료 시 DB pool을 닫습니다. 업무 API가 없으므로 `/api/orders`는 404입니다.

## 마이그레이션

`apps/api/db/migrations/`의 번호순 SQL을 동일 연결·트랜잭션에서 적용합니다.
트랜잭션 advisory lock으로 동시 실행을 직렬화하고 SHA-256 체크섬·적용 이력을 별도 migration_meta 스키마에 저장합니다.
적용된 파일 변경·누락·뒤늦은 이전 번호 추가를 거절합니다. 중간 실패 시 이번 실행 전체를 롤백합니다.
SQL은 검토된 저장소 파일만 실행하며 트랜잭션 외부 실행이 필요한 migration은 현재 지원하지 않습니다.

첫 migration은 앱 식별 메타데이터만 생성했습니다. 인증·주문·재고·피킹·검수 테이블은 이후 `0029_shipment_picking_inspection.sql`까지 순차 migration으로 추가됐습니다.
실행 환경은 `--development` 또는 `--test`로 명시해야 합니다. 이 실행기는 로컬 B2B DB 이름만 허용합니다.

## 명령

루트에서 실행합니다. `.env.local`은 Git 제외이며 비밀값을 출력하지 않습니다.

```text
npm ci --ignore-scripts
npm run build:api
npm run db:migrate -- --test
npm run test:foundation
npm run db:migrate -- --development
npm run db:verify
npm run start:api
```

## 검증 결과

- API TypeScript 빌드 통과.
- 테스트 3개 통과: 환경 검증, 실제 Nest HTTP·준비 상태·DB 장애, 실제 PostgreSQL migration 반복/동시/체크섬/누락/롤백.
- migration 검증은 명시적 테스트 DB의 임시 스키마만 사용하고 해당 스키마를 정리합니다.
- 테스트와 개발 DB에 0001 적용. 개발 DB 재실행에서 적용 0건 확인.
- 4개 역할 권한·앱 DDL 차단·환경 간 교차 접속 차단 재검증 통과.
- 실제 실행 API의 live·ready 모두 HTTP 200, `{ "status": "ok" }` 확인.
- npm 설치 시 audit 취약점 0개. 별도 API ESLint 구성은 아직 없으며 이번 타입 검증을 lint 통과로 표현하지 않습니다.
- 원본 테마 Git 상태 변경 없음, `.env.local`·API dist Git 제외 확인.

## 당시 다음 작업과 제한

아래 내용은 2026-09-05 당시 남아 있던 범위입니다. 인증·업무 저장·제품 웹은 이후 구현됐고 CI와 실제 배포는 현재도 남아 있습니다. health 성공만으로 운영 준비 전체가 완료된 것은 아닙니다.
DB 검증 결과는 신규 B2B DB 범위이며 기존 부동산 DB의 보안·무결성을 재검증한 것은 아닙니다.
