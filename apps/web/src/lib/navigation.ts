import {
  BoxesIcon,
  ClipboardListIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  HistoryIcon,
  HandCoinsIcon,
  FileUpIcon,
  PackageCheckIcon,
  PackageSearchIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TagsIcon,
  WalletCardsIcon,
  TruckIcon,
  UsersIcon,
  ActivityIcon,
  BellRingIcon,
} from "lucide-react"

export const adminNavGroups = [
  {
    label: "운영 관리",
    items: [
      { href: "/admin", title: "운영 현황", icon: GaugeIcon },
      { href: "/admin/orders", title: "주문 관리", icon: ClipboardListIcon },
      { href: "/admin/order-history", title: "주문 이력", icon: HistoryIcon },
      { href: "/admin/inventory-adjustments", title: "재고 정정", icon: BoxesIcon },
      { href: "/admin/stock-counts", title: "재고 실사", icon: ClipboardCheckIcon },
      { href: "/admin/return-credits", title: "반품 처리", icon: RotateCcwIcon },
    ],
  },
  {
    label: "기준 · 정산",
    items: [
      { href: "/admin/pricing", title: "기준정보 · 단가", icon: TagsIcon },
      { href: "/admin/imports", title: "데이터 이관", icon: FileUpIcon },
      { href: "/admin/settlement-drafts", title: "월 정산 초안", icon: PackageSearchIcon },
      { href: "/admin/settlements", title: "정산 조회", icon: ReceiptTextIcon },
      { href: "/admin/payments", title: "입금 · 배분", icon: WalletCardsIcon },
      { href: "/admin/refunds", title: "실제 환불", icon: HandCoinsIcon },
    ],
  },
  {
    label: "시스템",
    items: [
      { href: "/admin/audit-events", title: "감사 로그", icon: ActivityIcon },
      { href: "/admin/notifications", title: "업무 알림", icon: BellRingIcon },
      { href: "/admin/accounts", title: "계정 관리", icon: UsersIcon },
      { href: "/admin/account-security", title: "계정 보안", icon: ShieldCheckIcon },
    ],
  },
] as const

export const routeLabels: Record<string, string> = {
  admin: "관리자",
  orders: "주문 관리",
  "order-history": "주문 이력",
  history: "주문 내역",
  "inventory-adjustments": "재고 정정",
  "stock-counts": "재고 실사",
  "return-credits": "반품 처리",
  pricing: "기준정보 · 단가",
  imports: "초기 데이터 이관",
  "settlement-drafts": "월 정산 초안",
  settlements: "정산 조회",
  payments: "입금 · 배분",
  refunds: "실제 환불",
  "account-security": "계정 보안",
  accounts: "계정 관리",
  "audit-events": "감사 로그",
  notifications: "업무 알림",
  portal: "거래처 포털",
  warehouse: "창고 업무",
  returns: "반품",
  shipments: "출고 대기",
  deliveries: "배송 관리",
}

export const portalNav = [
  { href: "/portal/orders", title: "상품 주문", icon: ClipboardListIcon },
  { href: "/portal/orders/history", title: "주문 내역", icon: HistoryIcon },
  { href: "/portal/returns", title: "반품 요청", icon: RotateCcwIcon },
  { href: "/portal/settlements", title: "정산 · 입금 내역", icon: ReceiptTextIcon },
] as const

export const warehouseNav = [
  { href: "/warehouse/shipments", title: "출고 대기", icon: TruckIcon },
  { href: "/warehouse/deliveries", title: "배송 관리", icon: PackageSearchIcon },
  { href: "/warehouse/returns", title: "반품 검수", icon: PackageCheckIcon },
] as const
