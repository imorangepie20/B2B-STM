# 관리자 재고 정정

관리자와 운영 담당자는 MFA 인증 뒤 `/admin/inventory-adjustments`에서 재고를 증감 정정할 수 있습니다. 정정은 수량과 사유를 필수로 기록하며, `inventory_adjustments`와 `inventory_movements`를 같은 transaction에서 생성합니다.

감소 정정으로 보유수량이 이미 예약된 수량보다 작아지는 경우는 거절합니다. 정정 명령에는 `requestId`가 필요하고 같은 `(actor_id, command_type, request_id)`는 저장한 결과를 반환합니다.

관리자·운영 역할 계정은 MFA 검증이 끝나면 `/admin`으로 자동 이동합니다.
