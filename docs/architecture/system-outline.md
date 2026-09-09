# 아키텍처와 도메인 개요

최종 갱신: 2026-09-09. Next.js 16.3.4·React 19.2.4·NestJS 11.2.3·PostgreSQL 16 구성을 적용했습니다. 기존 Docker에는 B2B 전용 개발·테스트 DB와 역할만 추가했습니다. 첨부 검사는 ClamAV `clamd` TCP `INSTREAM` 연동을 사용하며 실제 배포 환경은 미확정입니다.

구체화한 제안은 [기술 구조와 정합성 설계](transaction-and-module-design.md)를 참고합니다.

## 적용 기술

제품 웹은 Next.js App Router, 업무 API는 NestJS, 데이터베이스는 PostgreSQL을 사용합니다. DB 접근은 `pg`와 명시적 SQL migration을 사용하며 ORM 자동 schema sync는 사용하지 않습니다. 주문·출고·정산 메일은 PostgreSQL outbox와 API worker로 처리하며, 그 밖의 범용 비동기 작업 큐와 배포 서비스는 아직 구현·선택하지 않았습니다.

## 시스템 경계

- 거래처 포털: 소속 거래처에 허용된 상품·단가·주문·정산만 접근.
- 창고 모바일: 입고·피킹·검수·출고·반품 검수 등 작업 중심.
- 관리자: 기준 정보, 주문 배정, 재고 정정, 정산·입금, 권한과 감사 조회.
- 공통 업무 API와 DB가 상태 변경의 기준을 담당하며 각 화면에서 별도 계산 규칙을 만들지 않습니다.

## 핵심 관계

```text
customer -> price agreement -> order -> order line
order line -> reservation -> shipment line -> settlement -> payment allocation
supplier -> receipt -> inventory ledger
shipment line -> return -> inspection -> inventory ledger / settlement adjustment
stock count -> inventory adjustment -> inventory ledger
```

실제 테이블과 제약은 [DB 스키마 설계](database-schema-design.md)와 `apps/api/db/migrations`를 기준으로 합니다.

## 구현 결과와 남은 문제

- 주문·예약·출고·취소·반품 수량과 재고·정산 원장을 분리해 저장합니다.
- 행 잠금과 `command_results`로 동시 예약·중복 명령을 제어합니다.
- 주문 단가·판매 단위를 스냅샷하고 출고 기준 미수와 반품 차감을 원거래에 연결합니다.
- 역할과 거래처 격리를 모든 API 서버 경계에서 검사합니다.
- 세금·반올림·지급 기한·거래명세서와 실제 환불을 구현했습니다. 주문·출고·정산 알림 outbox와 첨부 저장 전 악성 파일 fail-closed 검사를 구현했고, 범용 비동기 작업 큐와 실제 배포 운영은 남아 있습니다.

부동산 프로젝트의 엔터티·테이블·인증·배포 설정은 이 시스템의 설계 근거로 자동 채택하지 않습니다.
