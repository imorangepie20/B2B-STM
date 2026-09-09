# 초기 데이터 CSV 이관 설계

## 목표

관리자가 실제 업체의 거래처·공급처·창고·상품·거래처별 단가·초기 재고를 CSV로 검토한 뒤 한 번에 반영합니다. 오류가 있는 파일은 일부 행도 반영하지 않고, 같은 파일의 반복 반영을 막으며 초기 재고는 감사 가능한 원장으로 기록합니다.

## 파일 형식

UTF-8 CSV 한 파일에 다음 고정 header를 사용합니다.

```csv
recordType,code,name,saleUnit,customerCode,sku,warehouseCode,quantity,unitPrice
```

| recordType | 필수 값 | 의미 |
|---|---|---|
| `customer` | `code`, `name` | 거래처 |
| `supplier` | `code`, `name` | 공급처 |
| `warehouse` | `code`, `name` | 창고 |
| `product` | `sku`, `name`, `saleUnit` | 상품 |
| `price` | `customerCode`, `sku`, `unitPrice` | 거래처별 판매 단가 |
| `stock` | `warehouseCode`, `sku`, `quantity` | 초기 정상 재고 |

코드와 SKU는 trim 후 대문자로 정규화합니다. 수량은 0 이상의 안전한 정수, 단가는 0 이상의 안전한 정수 원 단위입니다. 파일은 1MiB, 데이터 2,000행으로 제한합니다.

## 미리보기와 충돌 정책

- header, CSV 인용부호, 필수 값, 숫자, 파일 내부 중복, 참조 관계를 전부 검사합니다.
- 같은 파일 안에서 정의한 거래처·창고·상품을 뒤의 단가·재고 행이 참조할 수 있습니다.
- DB의 기존 기준정보와 값이 정확히 같으면 `skip`으로 표시합니다.
- 같은 코드의 이름·판매 단위·단가가 다르면 자동 덮어쓰지 않고 오류로 표시합니다.
- 초기 재고는 기존 잔액이 없거나 보유·예약 수량이 모두 0일 때만 반영합니다.
- 오류가 하나라도 있으면 반영 버튼을 사용할 수 없습니다.

## 반영 트랜잭션

1. 파일 내용을 다시 파싱하고 SHA-256을 계산합니다.
2. 파일 hash advisory lock과 `import_batches.file_hash` unique 제약으로 중복 실행을 직렬화합니다.
3. 미리보기와 같은 검증을 DB transaction 안에서 다시 수행합니다.
4. 기준정보를 dependency 순서로 생성합니다.
5. 단가를 생성하고 초기 재고는 `inventory_adjustments`와 `inventory_movements`의 `adjustment` 원장으로 기록합니다.
6. 각 CSV 행의 `created` 또는 `skipped` 결과를 `import_rows`에 보존합니다.
7. batch 결과와 업무 변경을 함께 commit합니다.

## 권한과 보안

- MFA를 완료한 `system` 또는 `operations` 역할만 미리보기와 반영을 호출합니다.
- 서버는 client의 미리보기 결과를 신뢰하지 않고 파일 원문을 다시 검증합니다.
- 오류 응답에 DB 문장이나 자격 증명을 포함하지 않습니다.
- 원본 파일 내용은 DB에 장기 저장하지 않고 filename, hash, 건수, 결과와 행별 식별 정보만 보존합니다.

## 완료 기준

- 정상 파일 preview와 apply가 같은 행 판단을 사용합니다.
- 오류 파일은 DB를 변경하지 않습니다.
- 같은 파일의 순차·동시 재요청은 한 번만 반영됩니다.
- 초기 재고와 재고 원장의 합계가 일치합니다.
- 관리자 화면에서 파일 선택, 오류 행 확인, 반영 결과와 최근 batch를 확인할 수 있습니다.

