# 초기 데이터 이관 사용 안내

## 화면

관리자 로그인과 MFA 인증 후 `http://127.0.0.1:3101/admin/imports`에서 사용합니다. 상단 메뉴의 `데이터 이관`으로 이동할 수 있습니다.

## 사용 순서

1. `형식 예시 다운로드`를 눌러 `initial-import-template.csv`를 받습니다.
2. UTF-8 CSV에 거래처·공급처·창고·상품을 먼저 작성하고 단가와 초기 재고 행을 작성합니다.
3. CSV 파일을 선택하고 `미리보기`를 누릅니다.
4. 생성 예정, 기존 값과 같아 건너뛸 행, 오류 행을 확인합니다.
5. 오류가 0개일 때 `검증 결과 반영`을 누릅니다.
6. 최근 이관 이력에서 전체·생성·건너뜀 행 수를 확인합니다.

## CSV header

```csv
recordType,code,name,saleUnit,customerCode,sku,warehouseCode,quantity,unitPrice
```

| recordType | 입력 열 |
|---|---|
| `customer` | `code`, `name` |
| `supplier` | `code`, `name` |
| `warehouse` | `code`, `name` |
| `product` | `sku`, `name`, `saleUnit` |
| `price` | `customerCode`, `sku`, `unitPrice` |
| `stock` | `warehouseCode`, `sku`, `quantity` |

코드와 SKU는 대문자로 정규화됩니다. `quantity`와 `unitPrice`는 0 이상의 정수만 허용합니다. 쉼표가 들어간 명칭은 큰따옴표로 감쌉니다.

## 충돌 처리

- 기존 값과 완전히 같은 행은 `건너뜀`으로 처리합니다.
- 같은 코드의 이름·판매 단위·단가가 다르면 오류로 중단합니다.
- 초기 재고가 이미 존재하는 창고·상품에는 다른 초기 수량을 덮어쓰지 않습니다.
- 같은 내용의 파일은 파일명이 달라도 hash가 같으면 다시 반영하지 않습니다.
- 오류가 있는 파일은 일부 행도 저장하지 않습니다.

## 재고 기록

초기 재고는 `inventory_balances`만 직접 변경하지 않습니다. `초기 데이터 이관` 사유의 `inventory_adjustments`와 `inventory_movements`를 함께 생성하므로 이후 재고 원장 대조가 가능합니다.

## 제한

- 파일 크기: 1MiB 이하
- 데이터 행: 최대 2,000행
- 문자 인코딩: UTF-8
- 권한: MFA가 완료된 `system` 또는 `operations`
- 원본 CSV는 DB에 저장하지 않으며 파일명, SHA-256, 행 판정과 집계만 보존합니다.

