# 브라우저 업무 흐름 E2E와 입금 화면 갱신 보완

## 변경 이유

기존 Playwright 검증은 로그인 화면과 모바일 폭만 확인해 실제 업무 연결을 증명하지 못했습니다. 또한 입금 등록은 API와 데이터베이스에는 저장되지만, 등록 뒤 화면이 갱신되지 않아 바로 정산에 배분할 수 없는 문제가 있었습니다.

## 근본 원인

`apps/web/src/app/admin/payments/page.tsx`의 비동기 제출 처리에서 `await` 뒤 `event.currentTarget.reset()`을 사용했습니다. React 이벤트의 현재 대상은 비동기 경계 뒤에 신뢰할 수 없으므로 예외가 발생했고, 이후의 `load()`와 선택 입금 상태 갱신이 실행되지 않았습니다. 같은 형태가 기준정보 등록과 단가 저장 화면에도 있어 함께 보완했습니다.

## 변경 내용

- `apps/web/e2e/business-flow.cjs`를 추가했습니다. 임시 개발 DB 데이터를 만들고 정리하며, 실제 브라우저에서 다음 흐름을 검증합니다.
  - 거래처 비밀번호 로그인
  - 주문 접수와 관리자 재고 예약 확정
  - 창고 부분 출고
  - 거래처 반품 요청과 창고 불량 검수
  - 관리자 불량 격리와 반품 차감 확정
  - 정산 초안 생성·마감, 입금 등록·배분
- `apps/web/package.json`의 `test:e2e`를 위 시나리오로 연결했습니다.
- 입금 등록·배분, 기준정보 등록·입고 확정, 거래처별 단가 저장 시 제출 전에 `formElement`를 보관하고 비동기 작업 뒤에 사용하도록 변경했습니다.
- 반품 차감 화면의 불량 격리·폐기 요청 구문 오류를 수정하고, 두 처분 버튼을 모바일에서도 구분해 사용할 수 있게 스타일을 추가했습니다.

## 검증

- `npm.cmd run test:e2e --workspace=@b2b-stm/web` 통과
  - `PASS: browser login, order, partial shipment, return, inspection, defect disposition, settlement, and payment allocation`
- `npm.cmd run build:web` 통과

## 운영 범위

E2E는 `DATABASE_URL`이 `b2b_stm`인 경우에만 실행되며, UUID 기반 임시 거래처·계정·상품·창고·거래 기록을 생성한 뒤 모두 삭제합니다. 운영 DB에서 실행하지 않습니다.
