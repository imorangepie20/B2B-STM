# 출고별 배송·인도 관리

출고 원장과 분리된 `shipment_deliveries`, `shipment_delivery_events`를 추가해 배송 준비→예정→배송 중→인도 완료 상태를 관리합니다. 배송 실패 후 재예약을 지원하고, 인도 완료에는 수령인·확인 방식·증빙 메모가 필요합니다. 기존 출고는 `0031_backfill_shipment_deliveries.sql`로 배송 준비 상태에 편입했습니다.

창고 `/warehouse/deliveries`는 상단 현황, 검색·상태 필터, 출고별 목록, 선택 상세 작업 패널로 구성했습니다. 택배사·운송장·예정일, 출발, 실패, 수령 증빙을 한 화면에서 기록합니다. 모든 변경은 `requestId` 멱등 처리와 배송 행 잠금을 사용하며 완료된 인도는 되돌릴 수 없습니다. 날짜·문자열 길이와 상태별 필수값도 API에서 검증합니다.

관리자 주문 이력에는 출고별 배송 상태와 운송장·증빙을, 거래처 주문 상세에는 부분 출고별 배송 조회를 연결했습니다. 배송 변경은 통합 감사 로그에 남고 `ops:verify`가 상태별 필수 데이터 누락을 검사합니다. 데모 데이터는 배송 예정·배송 중·인도 완료를 각각 포함합니다.

검증 결과:

- `npm.cmd run test:foundation`: 67/67 통과
- `npm.cmd run build:api`, `npm.cmd run build:web`: production build 통과
- `npm.cmd run test:e2e --workspace=@b2b-stm/web`: 전체 업무 흐름 통과
- `npm.cmd run ui:verify-recent`: 14개 화면의 데스크톱·모바일 28/28 통과
- `npm.cmd run ops:verify`: 28개 테이블 스냅샷과 10개 무결성 검사 통과
