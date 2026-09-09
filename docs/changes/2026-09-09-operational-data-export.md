# 운영 데이터 CSV·Excel 내보내기

작성일: 2026-09-09.

## 변경 이유

목록 화면의 현재 페이지를 브라우저에서 조립하면 페이지 밖 데이터가 누락되고, 권한·감사·대량 제한을 일관되게 적용하기 어렵습니다. 주문 이력, 재고 현황, 정산 현황을 기존 서버 필터와 같은 조건으로 다시 조회해 업무 파일로 내려받도록 구현했습니다.

## 구현 내용

- `GET /api/admin/exports/:dataset`에서 `orders`, `inventory`, `settlements`를 `csv` 또는 `xlsx`로 생성합니다.
- 주문·재고는 운영·시스템 역할, 정산은 정산·시스템 역할과 MFA를 요구합니다.
- CSV는 UTF-8 BOM과 RFC 4180 방식 인용을 사용해 한글 Excel 호환성을 확보했습니다.
- ExcelJS로 실제 XLSX 워크북, 고정 header, 자동 필터, 첫 행 고정, 숫자 셀과 열 너비를 생성합니다.
- 수식으로 해석될 수 있는 텍스트를 이스케이프하고 한 번에 최대 10,000행으로 제한합니다.
- 내보낸 작업자, 대상, 형식, 필터, 행 수를 `data_exports`와 통합 감사 로그에 보존합니다. 파일 원문은 서버에 남기지 않습니다.
- 주문 이력·재고 정정·정산 조회 화면에 현재 필터를 이어받는 CSV와 Excel 버튼을 추가했습니다.

## 검증 결과

- 개발·테스트 DB에 `0036_data_exports.sql` 적용
- API와 Web production build 통과
- 권한 없는 거래처 계정의 관리자 내보내기 `403`
- 주문 CSV의 BOM, header, 필터 결과와 다운로드 header 확인
- 생성한 재고 XLSX를 ExcelJS로 다시 열어 worksheet, header, 데이터 행, 숫자 셀 확인
- `npm.cmd run test:foundation`: 70/70 통과
- `npm.cmd run ops:verify`: 34개 테이블과 15개 무결성 검사 통과

ExcelJS가 사용하는 구버전 `uuid`에 대한 npm advisory가 있으나, 이 구현은 해당 패키지의 UUID 버퍼 API를 호출하지 않습니다. 운영 의존성 감사에는 기존 NestJS multipart 관련 항목과 함께 계속 표시되므로 후속 의존성 갱신에서 제거합니다.
