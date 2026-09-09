# 로컬 샘플 데이터 사용 안내

## 목적

개발 DB에서 주문·재고·출고·반품·정산·입금 화면을 별도 입력 작업 없이 확인하기 위한 샘플 데이터입니다. `DEMO-` 코드와 고정 UUID를 사용하므로 기존 관리자 계정과 일반 업무 데이터는 건드리지 않습니다.

## 접속

- 웹: `http://127.0.0.1:3101`
- 거래처 주문 담당자: `demo.customer@stm.local`
- 거래처 베이커리 담당자: `demo.bakery@stm.local`
- 거래처 키친 담당자: `demo.kitchen@stm.local`
- 창고 담당자: `demo.warehouse@stm.local`
- 운영 담당자: `demo.operations@stm.local`
- 비밀번호: 저장소 루트의 `.demo-credentials.json`에서 확인합니다. 이 파일은 로컬에서만 생성되고 Git에서 제외됩니다.

운영 담당자는 관리자 권한 경계 확인을 위해 첫 로그인에서 MFA 등록이 필요합니다. 기존 system 관리자 계정으로 로그인하면 MFA 등록 없이 이미 구성된 관리자 화면과 같은 샘플 데이터를 확인할 수 있습니다.

## 포함된 업무 상태

- 접수되어 관리자 확정을 기다리는 주문
- 일부 출고 후 예약 잔량이 남은 주문
- 재고 부족으로 일부 수량이 미확보된 주문
- 창고 담당자가 작업을 시작해 `내 작업`으로 표시되는 출고 대기 주문
- 거래처가 잔량 취소를 요청해 출고가 보류된 주문
- 전량 출고가 끝난 주문과 검수 대기 반품
- 잔량 취소가 승인되어 출고분만 원장에 남은 주문
- 작성 중 정산, 마감 정산, 일부 배분 입금, 미배분 입금
- 2개 공급처, 서울 통합물류센터 1곳, 상품 12개와 거래처별 단가

## 명령

```powershell
npm.cmd run demo:seed
npm.cmd run demo:verify-browser
```

`demo:seed`는 같은 샘플이 이미 있으면 아무것도 변경하지 않습니다. 샘플을 처음 상태로 다시 만들 때만 아래 명령을 순서대로 실행합니다.

```powershell
npm.cmd run demo:reset
npm.cmd run demo:seed
```

두 명령은 `127.0.0.1` 또는 `localhost`의 `/b2b_stm` 개발 DB만 허용합니다. `demo:reset`은 `DEMO-` 코드와 `demo.*@stm.local` 계정에 연결된 레코드만 트랜잭션으로 삭제합니다.

## 화면 검증 결과

- 거래처 주문 내역: 접수 주문과 부분 출고 주문, 품목별 주문·출고·예약·미확보 수량 확인
- 창고 모바일 출고 큐: 출고 가능한 2개 주문, `내 작업` 담당 상태, 취소 검토 중 주문 제외 확인
- 관리자 주문 관리: 접수·부분 출고·미확보·취소 요청 주문 확인
- 캡처: [거래처 주문 내역](../screenshots/demo-customer-order-history.png), [창고 모바일 출고 큐](../screenshots/demo-warehouse-queue-mobile.png), [관리자 주문 관리](../screenshots/demo-admin-orders.png)
