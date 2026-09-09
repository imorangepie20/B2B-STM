# 개발 환경 구성 현황

최초 구성: 2026-09-05. 최종 갱신: 2026-09-09.

## 실행 구성

- Node.js 24.19.0
- Next.js 16.3.4, React 19.2.4
- NestJS 11.2.3
- PostgreSQL 16.15, `pg@8.23.0`
- Recharts 3.8.0
- Tailwind CSS 4, shadcn/base-ui, Geist Sans

제품 workspace는 `apps/web`, `apps/api`이며 루트 npm workspace에서 함께 관리합니다. 웹은 `http://127.0.0.1:3101`, API는 `http://127.0.0.1:3200`에서 실행하고 Next.js가 동일 출처 `/api` 요청을 NestJS로 전달합니다.

## PostgreSQL 분리

기존 `property-manager-postgres` 컨테이너를 재사용하되 DB와 역할은 별도로 구성했습니다.

| 환경 | DB | 앱 역할 | migration 역할 |
|---|---|---|---|
| 개발 | `b2b_stm` | `b2b_stm_app` | `b2b_stm_migrator` |
| 테스트 | `b2b_stm_test` | `b2b_stm_test_app` | `b2b_stm_test_migrator` |

PUBLIC 접근과 앱 역할의 DDL을 제한하고 환경 간 교차 접속을 차단했습니다. migration은 순차 SQL 파일과 checksum으로 관리하며 앱 시작 시 자동 schema sync를 사용하지 않습니다. 비밀값은 `.env.local`에만 두고 Git에서 제외합니다.

## 주요 명령

```powershell
npm.cmd ci
node --env-file=.env.local scripts/migrate.mjs --development
node --env-file=.env.local scripts/migrate.mjs --test
npm.cmd run build:api
npm.cmd run build:web
npm.cmd run test:foundation
npm.cmd run start:api
npm.cmd run start:web
```

샘플 데이터는 `npm.cmd run demo:seed`, DB·역할 검사는 `npm.cmd run db:verify`, 운영 무결성은 `npm.cmd run ops:verify`로 확인합니다.

## 현재 검증

- 개발·테스트 DB와 네 역할의 실제 TCP 접속, DDL 제한, 환경 간 교차 접속 차단
- migration 반복·checksum·rollback·동시 실행
- foundation 65/65, API·Web production build
- 실제 브라우저 전체 업무 E2E와 16개 화면·두 viewport 시각 검증 32/32
- 운영 dependency 감사 취약점 0건

## 남은 운영 환경 작업

- CI 자동 실행
- 실제 배포 환경·도메인·TLS 구성
- 오류 추적, 로그 수집, 가용성 알림
- 별도 복원 환경의 최종 RPO/RTO 측정
- 목표 규모 성능 본 시험은 사용자 요청으로 중단

기존 부동산 DB와 역할 권한은 변경하지 않았습니다.
