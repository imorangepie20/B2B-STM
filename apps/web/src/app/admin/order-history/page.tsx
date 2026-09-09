"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  Clock3Icon,
  HistoryIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SearchIcon,
  StoreIcon,
  TruckIcon,
  WarehouseIcon,
  XCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { OrderPagination, type PageMetadata } from "@/components/orders/order-pagination"
import { AdminAnalyticsPanel } from "@/components/analytics/admin-analytics"
import { ExportButtons } from "@/components/export-buttons"

type FulfillmentStatus = "submitted" | "in_progress" | "completed" | "cancelled" | "rejected"
type Filter = "all" | FulfillmentStatus

type OrderLine = {
  sku: string
  name: string
  saleUnit: string
  unitPrice: string | null
  requestedQuantity: number
  shippedQuantity: number
  remainingReservedQuantity: number
  waitingQuantity: number
  cancelledQuantity: number
}

type ShipmentLine = {
  shipmentLineId: string
  ledgerId: string | null
  sku: string
  name: string
  saleUnit: string
  quantity: number
  unitPrice: string | null
  amount: string | null
}

type Shipment = {
  id: string
  shippedAt: string
  shippedBy: string
  quantity: number
  amount: string
  deliveryStatus: DeliveryStatus | null
  scheduledDate: string | null
  carrierName: string | null
  trackingNumber: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  recipientName: string | null
  proofMethod: string | null
  proofNote: string | null
  failureReason: string | null
  lines: ShipmentLine[]
}

type DeliveryStatus = "ready" | "scheduled" | "in_transit" | "delivered" | "failed"

const deliveryLabel: Record<DeliveryStatus, string> = { ready: "배차 대기", scheduled: "배송 예정", in_transit: "배송 중", delivered: "배송 완료", failed: "배송 실패" }

type CancellationRequest = {
  id: string
  status: "submitted" | "approved" | "rejected"
  reason: string
  requestedAt: string
  requestedBy: string
  reviewNote: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

type Order = {
  id: string
  status: string
  fulfillmentStatus: FulfillmentStatus
  createdAt: string
  confirmedAt: string | null
  updatedAt: string
  customerCode: string
  customerName: string
  warehouseCode: string
  warehouseName: string
  cancellationReason: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationRequests: CancellationRequest[]
  lines: OrderLine[]
  shipments: Shipment[]
}

const statusLabel: Record<FulfillmentStatus, string> = {
  submitted: "접수",
  in_progress: "출고 진행",
  completed: "출고 완료",
  cancelled: "취소",
  rejected: "거절",
}

const sum = (order: Order, field: keyof Pick<OrderLine, "requestedQuantity" | "shippedQuantity" | "remainingReservedQuantity" | "waitingQuantity" | "cancelledQuantity">) =>
  order.lines.reduce((total, line) => total + line[field], 0)

const won = (value: string | null | undefined) => `${BigInt(value ?? "0").toLocaleString("ko-KR")}원`
const shortId = (value: string) => `#${value.slice(0, 8).toUpperCase()}`

export default function AdminOrderHistoryPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<PageMetadata>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [selectedId, setSelectedId] = useState("")
  const [query, setQuery] = useState("")
  const [appliedQuery,setAppliedQuery]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage("")
    const params=new URLSearchParams({page:String(page),pageSize:"50",status:filter});if(appliedQuery)params.set("query",appliedQuery);if(from)params.set("from",from);if(to)params.set("to",to)
    const response = await fetch(`/api/admin/orders/history?${params}`, { credentials: "same-origin" })
    if (!response.ok) {
      setMessage("주문 이력을 불러오지 못했습니다.")
      setLoading(false)
      return
    }
    const result = await response.json() as PageMetadata & { items: Order[] }
    if (result.totalPages > 0 && page > result.totalPages) {
      setPage(result.totalPages)
      return
    }
    const nextOrders = result.items
    setOrders(nextOrders)
    setPagination(result)
    setSelectedId(current => nextOrders.some(order => order.id === current) ? current : (nextOrders[0]?.id ?? ""))
    setLoading(false)
  }, [page,appliedQuery,filter,from,to])

  useEffect(() => { void load() }, [load])
  useEffect(()=>{const id=setTimeout(()=>{setAppliedQuery(query.trim());setPage(1)},300);return()=>clearTimeout(id)},[query])

  const counts = useMemo(() => ({
    active: orders.filter(order => order.fulfillmentStatus === "submitted" || order.fulfillmentStatus === "in_progress").length,
    completed: orders.filter(order => order.fulfillmentStatus === "completed").length,
    cancelled: orders.filter(order => order.fulfillmentStatus === "cancelled" || order.fulfillmentStatus === "rejected").length,
    shipments: orders.reduce((total, order) => total + order.shipments.length, 0),
  }), [orders])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return orders.filter(order => {
      const statusMatches = filter === "all" || order.fulfillmentStatus === filter
      const queryMatches = !normalized || [order.id, order.customerCode, order.customerName, order.warehouseCode, order.warehouseName, order.cancellationReason ?? "", ...order.cancellationRequests.flatMap(request => [request.reason, request.reviewNote ?? "", request.requestedBy, request.reviewedBy ?? ""]), ...order.lines.flatMap(line => [line.sku, line.name]), ...order.shipments.map(shipment => shipment.id)]
        .some(value => value.toLowerCase().includes(normalized))
      return statusMatches && queryMatches
    })
  }, [filter, orders, query])

  const selected = orders.find(order => order.id === selectedId) ?? null

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">주문 이력</h1><p className="mt-1 text-sm text-muted-foreground">접수부터 출고 완료·취소까지 주문과 실제 출고 원장을 추적합니다.</p></div>
      <div className="flex flex-wrap gap-2"><ExportButtons dataset="orders" filters={{ query: appliedQuery, status: filter, from, to }} /><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCwIcon className={loading ? "animate-spin" : ""} />새로고침</Button></div>
    </div>

    {message && <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"><AlertCircleIcon className="size-4 text-muted-foreground" />{message}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="주문 이력 현황">
      <Summary label="진행 주문" value={counts.active} unit="건" icon={Clock3Icon} />
      <Summary label="출고 완료" value={counts.completed} unit="건" icon={CheckCircle2Icon} />
      <Summary label="취소 · 거절" value={counts.cancelled} unit="건" icon={XCircleIcon} />
      <Summary label="실제 출고" value={counts.shipments} unit="건" icon={TruckIcon} />
    </section>

    <Card><CardContent className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
      <label className="relative block min-w-0 flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="주문번호, 거래처, 출고번호, SKU, 취소 사유 검색" aria-label="주문 이력 검색" /></label>
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1" aria-label="주문 이력 상태 필터">
        {(["all", "submitted", "in_progress", "completed", "cancelled"] as const).map(value => <Button type="button" size="sm" variant="ghost" className={cn("flex-1 lg:flex-none", filter === value && "bg-background shadow-sm hover:bg-background")} key={value} onClick={() => {setFilter(value);setPage(1)}}>{value === "all" ? "전체" : statusLabel[value]}</Button>)}
      </div>
      <Input className="lg:w-36" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1)}} aria-label="이력 시작일"/><Input className="lg:w-36" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1)}} aria-label="이력 종료일"/><span className="text-xs text-muted-foreground">{pagination.total.toLocaleString("ko-KR")}건</span>
    </CardContent></Card>

    <AdminAnalyticsPanel view="orders" />

    <OrderPagination metadata={pagination} loading={loading} onPageChange={setPage} />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(330px,0.72fr)_minmax(0,1.65fr)]">
      <Card className="xl:sticky xl:top-20"><CardHeader className="border-b"><CardTitle>전체 주문</CardTitle><CardDescription>완료·취소 주문도 보존해 표시합니다.</CardDescription></CardHeader><CardContent className="max-h-[720px] overflow-y-auto p-0">
        {filtered.map(order => <button type="button" key={order.id} onClick={() => setSelectedId(order.id)} className={cn("w-full border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50", selectedId === order.id && "bg-muted")}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><strong className="truncate text-sm">{order.customerName}</strong><StatusBadge status={order.fulfillmentStatus} /></div><p className="mt-1 font-mono text-[11px] text-muted-foreground">{shortId(order.id)} · {order.warehouseCode}</p></div><time className="shrink-0 text-[11px] text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("ko-KR")}</time></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><Quantity label="주문" value={sum(order, "requestedQuantity")} /><Quantity label="출고" value={sum(order, "shippedQuantity")} /><Quantity label="출고 건" value={order.shipments.length} /></div>
        </button>)}
        {!filtered.length && <p className="px-4 py-14 text-center text-sm text-muted-foreground">조건에 맞는 주문 이력이 없습니다.</p>}
      </CardContent></Card>
      {selected ? <OrderHistoryDetail order={selected} /> : <Card><CardContent className="grid min-h-72 place-items-center text-sm text-muted-foreground">왼쪽 목록에서 주문을 선택해 주세요.</CardContent></Card>}
    </div>
  </div>
}

function OrderHistoryDetail({ order }: { order: Order }) {
  return <div className="space-y-4">
    <Card><CardHeader className="border-b"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="mb-2 flex items-center gap-2"><StatusBadge status={order.fulfillmentStatus} /><span className="font-mono text-xs text-muted-foreground">{shortId(order.id)}</span></div><CardTitle className="text-lg">{order.customerName}</CardTitle><CardDescription>{order.customerCode} · {order.lines.length}개 품목</CardDescription></div><div className="sm:text-right"><p className="text-xs text-muted-foreground">누적 출고 금액</p><strong className="mt-1 block text-xl tabular-nums">{won(order.shipments.reduce((total, shipment) => total + BigInt(shipment.amount), 0n).toString())}</strong></div></div></CardHeader><CardContent className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Info label="접수 일시" value={new Date(order.createdAt).toLocaleString("ko-KR")} icon={CalendarClockIcon} /><Info label="확정 일시" value={order.confirmedAt ? new Date(order.confirmedAt).toLocaleString("ko-KR") : "확정 전"} icon={PackageCheckIcon} /><Info label="출고 창고" value={`${order.warehouseName} · ${order.warehouseCode}`} icon={WarehouseIcon} /><Info label="거래처" value={order.customerCode} icon={StoreIcon} /></div>
      <div className="hidden overflow-x-auto rounded-lg border sm:block"><Table><TableHeader><TableRow><TableHead>상품</TableHead><TableHead className="text-right">단가</TableHead><TableHead className="text-right">주문</TableHead><TableHead className="text-right">출고</TableHead><TableHead className="text-right">예약</TableHead><TableHead className="text-right">미확보</TableHead><TableHead className="text-right">취소</TableHead></TableRow></TableHeader><TableBody>{order.lines.map(line => <TableRow key={line.sku}><TableCell><strong>{line.name}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{line.sku}</span></TableCell><TableCell className="text-right tabular-nums">{won(line.unitPrice)}</TableCell><TableCell className="text-right tabular-nums">{line.requestedQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.shippedQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.remainingReservedQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.waitingQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.cancelledQuantity}</TableCell></TableRow>)}</TableBody></Table></div>
      <div className="space-y-2 sm:hidden">{order.lines.map(line => <OrderLineCard key={line.sku} line={line} />)}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><Total label="주문" value={sum(order, "requestedQuantity")} /><Total label="누적 출고" value={sum(order, "shippedQuantity")} /><Total label="출고 예약" value={sum(order, "remainingReservedQuantity")} /><Total label="미확보" value={sum(order, "waitingQuantity")} /><Total label="취소" value={sum(order, "cancelledQuantity")} /></div>
      {order.fulfillmentStatus === "cancelled" && <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-orange-900"><XCircleIcon className="size-4" />주문 취소 기록</div><p className="mt-2 text-sm text-orange-950">{order.cancellationReason ?? "이전 데이터: 취소 사유 기록 없음"}</p><p className="mt-1 text-xs text-orange-800">{order.cancelledAt ? new Date(order.cancelledAt).toLocaleString("ko-KR") : "취소 시각 미기록"}{order.cancelledBy ? ` · ${order.cancelledBy}` : ""}</p></div>}
      {order.cancellationRequests.length > 0 && <CancellationRequestLedger requests={order.cancellationRequests} />}
    </CardContent></Card>
    <ShipmentLedger shipments={order.shipments} />
  </div>
}

function CancellationRequestLedger({ requests }: { requests: CancellationRequest[] }) {
  return <div className="rounded-lg border"><div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3"><div><strong className="text-sm">취소 요청 검토 기록</strong><p className="mt-0.5 text-xs text-muted-foreground">거래처 요청과 관리자 처리 결과를 시간순으로 보존합니다.</p></div><Badge variant="secondary">{requests.length}건</Badge></div><div className="divide-y">{requests.map(request => <div className="p-4" key={request.id}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge variant={request.status === "approved" ? "destructive" : "outline"}>{request.status === "submitted" ? "검토 중" : request.status === "approved" ? "승인" : "반려"}</Badge><span className="font-mono text-[11px] text-muted-foreground">{shortId(request.id)}</span></div><time className="text-xs text-muted-foreground">{new Date(request.requestedAt).toLocaleString("ko-KR")}</time></div><p className="mt-2 text-sm font-medium">{request.reason}</p><p className="mt-1 text-xs text-muted-foreground">요청자 {request.requestedBy}</p>{request.status !== "submitted" && <div className="mt-3 rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{request.status === "rejected" ? "반려 사유" : "처리 결과"}</p><p className="mt-1 text-sm">{request.reviewNote ?? "잔량 취소 승인"}</p><p className="mt-1 text-xs text-muted-foreground">{request.reviewedAt ? new Date(request.reviewedAt).toLocaleString("ko-KR") : "처리 시각 미기록"}{request.reviewedBy ? ` · ${request.reviewedBy}` : ""}</p></div>}</div>)}</div></div>
}

function ShipmentLedger({ shipments }: { shipments: Shipment[] }) {
  return <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>실제 출고 원장</CardTitle><CardDescription>출고 건과 생성된 매출 원장을 주문 기준으로 연결합니다.</CardDescription></div><Badge variant="secondary">{shipments.length}건</Badge></div></CardHeader><CardContent className="space-y-3">
    {shipments.map(shipment => <div className="overflow-hidden rounded-lg border" key={shipment.id}><div className="flex flex-col gap-2 bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><TruckIcon className="size-4 text-muted-foreground" /><strong className="font-mono text-xs">출고 {shortId(shipment.id)}</strong>{shipment.deliveryStatus && <DeliveryBadge status={shipment.deliveryStatus} />}</div><p className="mt-1 text-xs text-muted-foreground">{new Date(shipment.shippedAt).toLocaleString("ko-KR")} · {shipment.shippedBy}</p></div><div className="flex gap-4 text-sm"><span>수량 <strong className="tabular-nums">{shipment.quantity}</strong></span><span>금액 <strong className="tabular-nums">{won(shipment.amount)}</strong></span></div></div>
      {shipment.deliveryStatus && <div className="grid gap-2 border-b px-4 py-3 text-xs sm:grid-cols-3"><DeliveryField label="배송 정보" value={shipment.carrierName && shipment.trackingNumber ? `${shipment.carrierName} · ${shipment.trackingNumber}` : "운송 정보 등록 전"} /><DeliveryField label="일정/완료" value={shipment.deliveredAt ? new Date(shipment.deliveredAt).toLocaleString("ko-KR") : shipment.scheduledDate ?? "일정 미정"} /><DeliveryField label={shipment.deliveryStatus === "failed" ? "실패 사유" : "인수 증빙"} value={shipment.failureReason ?? (shipment.recipientName ? `${shipment.recipientName} · ${shipment.proofNote ?? "인수 확인"}` : "인수 전")} /></div>}
      <div className="hidden sm:block"><Table><TableHeader><TableRow><TableHead>상품</TableHead><TableHead>매출 원장</TableHead><TableHead className="text-right">수량</TableHead><TableHead className="text-right">단가</TableHead><TableHead className="text-right">금액</TableHead></TableRow></TableHeader><TableBody>{shipment.lines.map(line => <TableRow key={line.shipmentLineId}><TableCell><strong>{line.name}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{line.sku}</span></TableCell><TableCell className="font-mono text-xs">{line.ledgerId ? shortId(line.ledgerId) : "미생성"}</TableCell><TableCell className="text-right tabular-nums">{line.quantity}</TableCell><TableCell className="text-right tabular-nums">{won(line.unitPrice)}</TableCell><TableCell className="text-right font-medium tabular-nums">{won(line.amount)}</TableCell></TableRow>)}</TableBody></Table></div>
      <div className="divide-y sm:hidden">{shipment.lines.map(line => <div className="p-3" key={line.shipmentLineId}><div className="flex items-start justify-between gap-3"><div><strong className="text-sm">{line.name}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{line.sku} · {line.ledgerId ? `원장 ${shortId(line.ledgerId)}` : "원장 미생성"}</p></div><strong className="shrink-0 text-sm tabular-nums">{won(line.amount)}</strong></div><p className="mt-2 text-xs text-muted-foreground">{line.quantity} {line.saleUnit} × {won(line.unitPrice)}</p></div>)}</div>
    </div>)}
    {!shipments.length && <div className="grid min-h-28 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground"><span className="flex items-center gap-2"><ReceiptTextIcon className="size-4" />아직 실제 출고 원장이 없습니다.</span></div>}
  </CardContent></Card>
}

function StatusBadge({ status }: { status: FulfillmentStatus }) { return <Badge variant={status === "cancelled" || status === "rejected" ? "destructive" : status === "completed" ? "secondary" : "outline"}>{statusLabel[status]}</Badge> }
function DeliveryBadge({ status }: { status: DeliveryStatus }) { return <Badge variant={status === "failed" ? "destructive" : status === "delivered" ? "secondary" : "outline"}>{deliveryLabel[status]}</Badge> }
function DeliveryField({ label, value }: { label: string; value: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 truncate font-medium" title={value}>{value}</p></div> }
function Summary({ label, value, unit, icon: Icon }: { label: string; value: number; unit: string; icon: typeof HistoryIcon }) { return <Card size="sm"><CardHeader className="grid grid-cols-[1fr_auto]"><CardDescription>{label}</CardDescription><span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span><CardTitle className="mt-1 text-2xl tabular-nums">{value.toLocaleString("ko-KR")} <span className="text-sm font-normal text-muted-foreground">{unit}</span></CardTitle></CardHeader></Card> }
function Quantity({ label, value }: { label: string; value: number }) { return <span><span className="text-muted-foreground">{label}</span><strong className="ml-1 tabular-nums">{value}</strong></span> }
function Info({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarClockIcon }) { return <div className="rounded-lg bg-muted/50 p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-1.5 truncate text-sm font-medium" title={value}>{value}</p></div> }
function Total({ label, value }: { label: string; value: number }) { return <div role="group" aria-label={`${label} ${value}`} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString("ko-KR")}</p></div> }
function OrderLineCard({ line }: { line: OrderLine }) { return <div className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-sm">{line.name}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{line.sku} · {line.saleUnit}</p></div><strong className="shrink-0 text-sm tabular-nums">{won(line.unitPrice)}</strong></div><div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-xs"><Quantity label="주문" value={line.requestedQuantity} /><Quantity label="출고" value={line.shippedQuantity} /><Quantity label="예약" value={line.remainingReservedQuantity} /><Quantity label="미확보" value={line.waitingQuantity} /><Quantity label="취소" value={line.cancelledQuantity} /></div></div> }
