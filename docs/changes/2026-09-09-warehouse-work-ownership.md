# 창고 출고 작업 담당과 인계

## 배경

기존 출고 화면은 주문별 수량 입력과 재고 잠금은 제공했지만, 어느 창고 담당자가 피킹 중인지 표시하지 않았습니다. 두 담당자가 같은 주문을 열어 동시에 준비하면 나중 요청은 재고 충돌로 실패하더라도 현장 피킹은 중복될 수 있었습니다.

## 변경 내용

- `shipment_work_assignments`는 주문별 현재 담당자를 한 명만 유지합니다.
- `shipment_work_assignment_events`는 작업 시작, 사유가 있는 반납, 출고 완료, 주문 취소 종료를 작업자와 함께 보존합니다.
- 작업 시작은 주문 행을 잠근 transaction에서 처리합니다. 이미 다른 담당자가 선점한 주문은 `409 Conflict`로 거절합니다.
- 출고 API를 화면 밖에서 직접 호출해도 담당자가 없으면 같은 transaction에서 자동 선점합니다. 부분 출고 뒤에는 담당을 유지하고 전량 출고하면 자동 종료합니다.
- 거래처 취소 검토 요청이 접수되면 진행 중인 담당을 자동 반납해 창고 큐와 취소 상태가 어긋나지 않게 했습니다.
- 창고 화면은 `담당자 미지정`, `내 작업`, `다른 담당자가 작업 중`을 구분하며 내 작업에서만 수량 입력과 출고 확정을 허용합니다. 교대 시 300자 이내 사유를 기록하고 반납할 수 있습니다.
- 관리자 감사 로그에서 출고 작업 시작·반납·완료 이력을 조회할 수 있습니다.

## API

- `POST /api/warehouse/shipments/orders/:orderId/claim`
- `POST /api/warehouse/shipments/orders/:orderId/release`
- `GET /api/warehouse/shipments/queue` 응답에 `assignedTo`, `assignedToEmail`, `assignedAt`, `assignmentMine` 추가

두 변경 API는 UUID `requestId`를 사용하며 성공 결과와 업무 변경을 함께 커밋합니다.

## 검증

- 두 창고 계정의 동시 선점 차단
- 타 담당자의 직접 출고 차단
- 같은 작업 시작 요청 재전송 결과 일치
- 사유 없는 반납 차단과 반납 후 다른 담당자 선점
- 전량 출고 뒤 현재 담당 자동 삭제 및 전체 이벤트 보존
- 개발 DB 샘플 주문 하나에 창고 담당 상태 구성

실행 결과:

- `npm.cmd run test:foundation`: 65/65 통과
- `npm.cmd run build:api`, `npm.cmd run build:web`: production build 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 담당 시작을 포함한 전체 업무 흐름 통과
- `npm.cmd run ui:verify-recent`: 데스크톱·모바일 26/26 통과
- `npm.cmd run db:verify`: 개발·테스트 DB와 역할 경계 통과
- `npm.cmd run ops:verify`: 24개 운영 스냅샷 테이블과 8개 무결성 검사 통과
