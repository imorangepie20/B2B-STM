# 관리자 기준정보·입고·재고 화면

`/admin` 화면에서 MFA를 완료한 system/operations 사용자가 공급처, 창고, 상품을 등록하고 단일 상품 입고를 확정할 수 있습니다. 입고 확정은 `receipts`, `receipt_lines`, `inventory_balances`, `inventory_movements`를 하나의 DB 트랜잭션으로 갱신합니다. 재고 현황은 보유·예약·가용 수량을 창고와 SKU별로 표시합니다.

API는 `POST /api/admin/catalog/suppliers`, `warehouses`, `products`, `POST /api/admin/receipts`, `GET /api/admin/catalog`, `GET /api/admin/inventory`입니다. MFA나 관리자 역할이 없는 세션은 거부합니다.

`npm.cmd run build:api`, `npm.cmd run build:web`, `npm.cmd run test:foundation`(17개)을 통과했고, 재시작한 서버에서 `/admin`은 `200`, 비인증 관리자 API는 `401`을 반환하는 것을 확인했습니다.
