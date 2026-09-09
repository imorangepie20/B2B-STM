"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  BoxesIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  Clock3Icon,
  PackageCheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
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
import { CustomerAnalyticsPanel } from "@/components/analytics/role-analytics"

type Line = {
  sku: string
  name: string
  saleUnit: string
  unitPrice: string
  requestedQuantity: number
  reservedQuantity: number
  shippedQuantity: number
  remainingReservedQuantity: number
  waitingQuantity: number
  cancelledQuantity: number
}

type Order = {
  id: string
  status: "submitted" | "confirmed" | "cancelled" | "rejected"
  createdAt: string
  confirmedAt: string | null
  warehouseCode: string
  warehouseName: string
  cancellationReason: string | null
  cancelledAt: string | null
  cancellationRequest: {
    id: string
    status: "submitted" | "approved" | "rejected"
    reason: string
    requestedAt: string
    reviewNote: string | null
    reviewedAt: string | null
  } | null
  lines: Line[]
  shipments: CustomerShipment[]
}

type DeliveryStatus = "ready" | "scheduled" | "in_transit" | "delivered" | "failed"
type CustomerShipment = {
  id: string
  shippedAt: string
  quantity: number
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
}

const deliveryLabel: Record<DeliveryStatus, string> = { ready: "배차 대기", scheduled: "배송 예정", in_transit: "배송 중", delivered: "배송 완료", failed: "배송 지연" }

type Progress = "received" | "waiting" | "reserved" | "partial" | "completed" | "cancelled" | "rejected"
type Filter = "all" | "active" | "completed" | "cancelled"

const sum = (order: Order, field: keyof Pick<Line, "requestedQuantity" | "shippedQuantity" | "remainingReservedQuantity" | "waitingQuantity" | "cancelledQuantity">) =>
  order.lines.reduce((total, line) => total + line[field], 0)

const amount = (order: Order) => order.lines.reduce((total, line) => total + BigInt(line.unitPrice) * BigInt(line.requestedQuantity), 0n)
const money = (value: bigint) => `${value.toLocaleString("ko-KR")}원`

function progress(order: Order): Progress {
  if (order.status === "cancelled") return "cancelled"
  if (order.status === "rejected") return "rejected"
  if (order.status === "submitted") return "received"
  const requested = sum(order, "requestedQuantity")
  const shipped = sum(order, "shippedQuantity")
  const reserved = sum(order, "remainingReservedQuantity")
  const waiting = sum(order, "waitingQuantity")
  if (shipped === requested) return "completed"
  if (shipped > 0) return "partial"
  if (reserved > 0 && waiting > 0) return "waiting"
  if (waiting > 0) return "waiting"
  return "reserved"
}

const progressLabel: Record<Progress, string> = {
  received: "접수",
  waiting: "일부 확보",
  reserved: "출고 대기",
  partial: "부분 출고",
  completed: "출고 완료",
  cancelled: "취소",
  rejected: "거절",
}

export default function CustomerOrderHistoryPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<PageMetadata>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [selectedId, setSelectedId] = useState("")
  const [query, setQuery] = useState("")
  const [appliedQuery,setAppliedQuery]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState("")
  const [cancelReason, setCancelReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const params=new URLSearchParams({page:String(page),pageSize:"50",status:filter});if(appliedQuery)params.set("query",appliedQuery);if(from)params.set("from",from);if(to)params.set("to",to)
    const response = await fetch(`/api/orders?${params}`, { credentials: "same-origin" })
    if (!response.ok) {
      setMessage("주문 내역을 불러오지 못했습니다. 다시 로그인해 주세요.")
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

  const requestCancellation = async (order: Order) => {
    if (!cancelReason.trim()) {
      setMessage("잔량 취소 요청 사유를 입력해 주세요.")
      return
    }
    setBusyId(order.id)
    setMessage("")
    try {
      const tokenResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" })
      if (!tokenResponse.ok) throw new Error("보안 토큰을 준비하지 못했습니다.")
      const { csrfToken } = await tokenResponse.json() as { csrfToken: string }
      const response = await fetch(`/api/orders/${order.id}/cancellation-requests`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ requestId: crypto.randomUUID(), reason: cancelReason.trim() }),
      })
      if (!response.ok) {
        setMessage("잔량 취소를 요청하지 못했습니다. 최신 주문 상태를 확인해 주세요.")
        await load()
        return
      }
      setCancelReason("")
      setMessage("잔량 취소 요청을 접수했습니다. 검토 중에는 추가 배정과 출고가 보류됩니다.")
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "잔량 취소 요청 중 오류가 발생했습니다.")
    } finally {
      setBusyId("")
    }
  }

  const totals = useMemo(() => ({
    active: orders.filter(order => !["completed", "cancelled", "rejected"].includes(progress(order))).length,
    waiting: orders.reduce((total, order) => total + sum(order, "waitingQuantity"), 0),
    shipped: orders.reduce((total, order) => total + sum(order, "shippedQuantity"), 0),
  }), [orders])

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return orders.filter(order => {
      const state = progress(order)
      const filterMatches = filter === "all" || (filter === "active" && !["completed", "cancelled", "rejected"].includes(state)) || state === filter
      const queryMatches = !normalized || [order.id, order.warehouseCode, order.warehouseName, ...order.lines.flatMap(line => [line.sku, line.name])]
        .some(value => value.toLowerCase().includes(normalized))
      return filterMatches && queryMatches
    })
  }, [filter, orders, query])

  const selected = orders.find(order => order.id === selectedId) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">주문 내역</h1><p className="mt-1 text-sm text-muted-foreground">접수한 주문의 재고 확보와 출고 진행 상태를 확인합니다.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCwIcon className={loading ? "animate-spin" : ""} />새로고침</Button><Button render={<Link href="/portal/orders" />}><PlusIcon />새 주문</Button></div>
      </div>

      {message && <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status"><AlertCircleIcon className="size-4 text-muted-foreground" />{message}</div>}

      <CustomerAnalyticsPanel view="orders" />

      <section className="grid gap-3 sm:grid-cols-3" aria-label="내 주문 현황">
        <SummaryCard label="진행 주문" value={totals.active} unit="건" icon={Clock3Icon} />
        <SummaryCard label="미확보 수량" value={totals.waiting} unit="개" icon={BoxesIcon} />
        <SummaryCard label="누적 출고" value={totals.shipped} unit="개" icon={TruckIcon} />
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
          <label className="relative block min-w-0 flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="주문번호, 창고, SKU, 상품명 검색" aria-label="주문 내역 검색" /></label>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {(["all", "active", "completed", "cancelled"] as const).map(value => <Button type="button" size="sm" variant="ghost" className={cn("flex-1 lg:flex-none", filter === value && "bg-background shadow-sm hover:bg-background")} key={value} onClick={() => {setFilter(value);setPage(1)}}>{value === "all" ? "전체" : value === "active" ? "진행" : value === "completed" ? "완료" : "취소"}</Button>)}
          </div>
          <Input className="lg:w-36" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1)}} aria-label="주문 시작일"/><Input className="lg:w-36" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1)}} aria-label="주문 종료일"/><span className="text-xs text-muted-foreground">{pagination.total}건</span>
        </CardContent>
      </Card>

      <OrderPagination metadata={pagination} loading={loading} onPageChange={setPage} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(310px,0.72fr)_minmax(0,1.6fr)]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader className="border-b"><CardTitle>주문 목록</CardTitle><CardDescription>최근 접수한 주문부터 표시합니다.</CardDescription></CardHeader>
          <CardContent className="max-h-[680px] overflow-y-auto p-0">
            {filteredOrders.map(order => {
              const state = progress(order)
              return <button type="button" key={order.id} onClick={() => { setSelectedId(order.id); setCancelReason("") }} className={cn("w-full border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50", selectedId === order.id && "bg-muted")}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-xs">#{order.id.slice(0, 8).toUpperCase()}</strong><ProgressBadge state={state} />{order.cancellationRequest?.status === "submitted" && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">취소 검토</Badge>}</div><p className="mt-1.5 text-sm font-medium">{order.warehouseName}</p><p className="text-xs text-muted-foreground">{order.warehouseCode}</p></div><time className="text-[11px] text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("ko-KR")}</time></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><Quantity label="주문" value={sum(order, "requestedQuantity")} /><Quantity label="출고" value={sum(order, "shippedQuantity")} /><Quantity label="잔량" value={sum(order, "remainingReservedQuantity") + sum(order, "waitingQuantity")} warning={state === "waiting"} /></div></button>
            })}
            {!filteredOrders.length && <p className="px-4 py-14 text-center text-sm text-muted-foreground">조건에 맞는 주문이 없습니다.</p>}
          </CardContent>
        </Card>

        {selected ? <OrderDetail order={selected} busy={busyId === selected.id} cancelReason={cancelReason} setCancelReason={setCancelReason} requestCancellation={requestCancellation} /> : <Card><CardContent className="grid min-h-72 place-items-center text-sm text-muted-foreground">왼쪽 목록에서 주문을 선택해 주세요.</CardContent></Card>}
      </div>
    </div>
  )
}

function OrderDetail({ order, busy, cancelReason, setCancelReason, requestCancellation }: {
  order: Order
  busy: boolean
  cancelReason: string
  setCancelReason: (value: string) => void
  requestCancellation: (order: Order) => Promise<void>
}) {
  const state = progress(order)
  const requested = sum(order, "requestedQuantity")
  const shipped = sum(order, "shippedQuantity")
  const reserved = sum(order, "remainingReservedQuantity")
  const waiting = sum(order, "waitingQuantity")
  const cancelled = sum(order, "cancelledQuantity")
  const hasUnshipped = requested > shipped
  const cancellationRequest = order.cancellationRequest
  return <Card><CardHeader className="border-b"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="mb-2 flex flex-wrap items-center gap-2"><ProgressBadge state={state} />{cancellationRequest?.status === "submitted" && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">취소 검토 중</Badge>}<span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</span></div><CardTitle className="text-lg">{order.warehouseName}</CardTitle><CardDescription>{order.warehouseCode} · {order.lines.length}개 품목</CardDescription></div><div className="sm:text-right"><p className="text-xs text-muted-foreground">주문 금액</p><strong className="mt-1 block text-xl tabular-nums">{money(amount(order))}</strong></div></div></CardHeader><CardContent className="space-y-5"><div className="grid gap-2 sm:grid-cols-3"><Info label="접수 일시" value={new Date(order.createdAt).toLocaleString("ko-KR")} icon={CalendarClockIcon} /><Info label="확정 일시" value={order.confirmedAt ? new Date(order.confirmedAt).toLocaleString("ko-KR") : "운영 담당자 확인 전"} icon={CheckCircle2Icon} /><Info label="출고 창고" value={`${order.warehouseName} · ${order.warehouseCode}`} icon={WarehouseIcon} /></div><div className="hidden overflow-x-auto rounded-lg border sm:block"><Table><TableHeader><TableRow><TableHead>상품</TableHead><TableHead className="text-right">단가</TableHead><TableHead className="text-right">주문</TableHead><TableHead className="text-right">출고</TableHead><TableHead className="text-right">예약</TableHead><TableHead className="text-right">미확보</TableHead><TableHead className="text-right">취소</TableHead></TableRow></TableHeader><TableBody>{order.lines.map(line => <TableRow key={line.sku}><TableCell><strong>{line.name}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{line.sku}</span><span className="ml-2 text-xs text-muted-foreground">/ {line.saleUnit}</span></TableCell><TableCell className="text-right tabular-nums">{money(BigInt(line.unitPrice))}</TableCell><TableCell className="text-right font-medium tabular-nums">{line.requestedQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.shippedQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.remainingReservedQuantity}</TableCell><TableCell className={cn("text-right tabular-nums", line.waitingQuantity > 0 && "font-semibold text-orange-600")}>{line.waitingQuantity}</TableCell><TableCell className="text-right tabular-nums">{line.cancelledQuantity}</TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-2 sm:hidden">{order.lines.map(line => <OrderLineCard key={line.sku} line={line} />)}</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><Total label="주문" value={requested} /><Total label="누적 출고" value={shipped} /><Total label="출고 예약" value={reserved} /><Total label={order.status === "submitted" ? "확정 전" : "미확보"} value={waiting} warning={waiting > 0} /><Total label="취소" value={cancelled} /></div><CustomerDeliveryLedger shipments={order.shipments} />{state === "cancelled" && <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-orange-900"><XCircleIcon className="size-4" />주문 취소 사유</div><p className="mt-2 text-sm text-orange-950">{order.cancellationReason ?? "이전 데이터: 취소 사유 기록 없음"}</p>{order.cancelledAt && <p className="mt-1 text-xs text-orange-800">{new Date(order.cancelledAt).toLocaleString("ko-KR")}</p>}</div>}{cancellationRequest && <CancellationRequestStatus request={cancellationRequest} />}{order.status === "confirmed" && hasUnshipped && cancellationRequest?.status !== "submitted" && <div className="rounded-lg border bg-muted/30 p-4"><div className="mb-3"><strong className="text-sm">미출고 잔량 취소 요청</strong><p className="mt-1 text-xs text-muted-foreground">운영 담당자가 승인하면 이미 출고된 수량은 유지되고 남은 예약만 해제됩니다.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Input aria-label="잔량 취소 요청 사유" value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="예: 행사 일정 변경으로 잔량 취소 요청" /><Button variant="destructive" className="sm:min-w-40" disabled={busy} onClick={() => void requestCancellation(order)}>{busy ? "요청 중…" : "잔량 취소 요청"}</Button></div></div>}<ProgressNotice state={state} /></CardContent></Card>
}

function CustomerDeliveryLedger({ shipments }: { shipments: CustomerShipment[] }) {
  if (!shipments.length) return null
  return <section className="rounded-lg border" aria-label="배송 조회"><div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3"><div><strong className="text-sm">배송 조회</strong><p className="mt-0.5 text-xs text-muted-foreground">부분 출고별 배송 일정과 운송장 정보를 확인합니다.</p></div><Badge variant="secondary">{shipments.length}건</Badge></div><div className="divide-y">{shipments.map(shipment => <div className="p-4" key={shipment.id}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><TruckIcon className="size-4 text-muted-foreground" /><strong className="font-mono text-xs">#{shipment.id.slice(0, 8).toUpperCase()}</strong>{shipment.deliveryStatus && <Badge variant={shipment.deliveryStatus === "failed" ? "destructive" : shipment.deliveryStatus === "delivered" ? "secondary" : "outline"}>{deliveryLabel[shipment.deliveryStatus]}</Badge>}</div><span className="text-xs text-muted-foreground">{shipment.quantity.toLocaleString("ko-KR")}개 출고</span></div><div className="mt-3 grid gap-3 text-xs sm:grid-cols-3"><DeliveryValue label="배송 일정" value={shipment.deliveredAt ? `완료 ${new Date(shipment.deliveredAt).toLocaleString("ko-KR")}` : shipment.scheduledDate ?? "일정 등록 전"} /><DeliveryValue label="택배/운송장" value={shipment.carrierName && shipment.trackingNumber ? `${shipment.carrierName} · ${shipment.trackingNumber}` : "운송 정보 등록 전"} /><DeliveryValue label={shipment.deliveryStatus === "failed" ? "안내" : "인수 확인"} value={shipment.failureReason ?? (shipment.recipientName ? `${shipment.recipientName} · ${shipment.proofNote ?? "인수 완료"}` : "배송 완료 후 표시됩니다.")} /></div></div>)}</div></section>
}

function DeliveryValue({ label, value }: { label: string; value: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div> }

function CancellationRequestStatus({ request }: { request: NonNullable<Order["cancellationRequest"]> }) {
  const submitted = request.status === "submitted"
  return <div className={cn("rounded-lg border p-4", submitted ? "border-orange-200 bg-orange-50/60" : "bg-muted/30")}><div className="flex flex-wrap items-center justify-between gap-2"><strong className={cn("text-sm", submitted && "text-orange-950")}>{submitted ? "잔량 취소 검토 중" : request.status === "approved" ? "잔량 취소 승인" : "잔량 취소 반려"}</strong><time className="text-xs text-muted-foreground">{new Date(request.requestedAt).toLocaleString("ko-KR")}</time></div><p className="mt-2 text-sm">{request.reason}</p>{submitted && <p className="mt-2 text-xs text-orange-800">검토가 끝날 때까지 이 주문의 추가 배정과 출고가 보류됩니다.</p>}{request.status === "rejected" && <div className="mt-3 border-t pt-3"><p className="text-xs text-muted-foreground">관리자 반려 사유</p><p className="mt-1 text-sm font-medium">{request.reviewNote}</p></div>}</div>
}

function OrderLineCard({ line }: { line: Line }) {
  return <div className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-sm">{line.name}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{line.sku} · {line.saleUnit}</p></div><strong className="shrink-0 text-sm tabular-nums">{money(BigInt(line.unitPrice))}</strong></div><div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-3"><LineQuantity label="주문" value={line.requestedQuantity} /><LineQuantity label="출고" value={line.shippedQuantity} /><LineQuantity label="예약" value={line.remainingReservedQuantity} /><LineQuantity label="미확보" value={line.waitingQuantity} warning={line.waitingQuantity > 0} /><LineQuantity label="취소" value={line.cancelledQuantity} /></div></div>
}

function LineQuantity({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div><p className="text-[11px] text-muted-foreground">{label}</p><strong className={cn("mt-0.5 block text-sm tabular-nums", warning && "text-orange-600")}>{value.toLocaleString("ko-KR")}</strong></div>
}

function ProgressBadge({ state }: { state: Progress }) {
  const destructive = state === "cancelled" || state === "rejected"
  return <Badge variant={destructive ? "destructive" : state === "completed" ? "secondary" : "outline"}>{progressLabel[state]}</Badge>
}

function ProgressNotice({ state }: { state: Progress }) {
  const content: Record<Progress, [string, string, typeof Clock3Icon]> = {
    received: ["주문 접수 완료", "운영 담당자가 최신 재고를 확인해 공급 가능 수량을 확정합니다.", Clock3Icon],
    waiting: ["일부 수량 확보", "확보된 수량은 출고 대기 중이며 부족 수량은 추가 입고 또는 배정을 기다립니다.", BoxesIcon],
    reserved: ["출고 준비 중", "주문 수량이 예약되어 창고 출고 작업을 기다리고 있습니다.", PackageCheckIcon],
    partial: ["부분 출고 진행", "일부 수량이 출고됐으며 남은 예약 또는 미확보 수량이 있습니다.", TruckIcon],
    completed: ["출고 완료", "주문 수량 전부가 출고됐습니다. 정산 내역에서 출고 금액을 확인할 수 있습니다.", CheckCircle2Icon],
    cancelled: ["주문 취소", "미출고 잔량이 취소됐으며 이미 출고된 수량은 유지됩니다.", XCircleIcon],
    rejected: ["주문 거절", "운영 담당자가 주문을 확정하지 않았습니다.", XCircleIcon],
  }
  const [title, description, Icon] = content[state]
  return <div className="flex gap-3 rounded-lg border bg-muted/30 p-4"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-background"><Icon className="size-4 text-muted-foreground" /></span><div><strong className="text-sm">{title}</strong><p className="mt-1 text-xs text-muted-foreground">{description}</p></div></div>
}

function SummaryCard({ label, value, unit, icon: Icon }: { label: string; value: number; unit: string; icon: typeof Clock3Icon }) { return <Card size="sm"><CardHeader className="grid grid-cols-[1fr_auto]"><CardDescription>{label}</CardDescription><span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span><CardTitle className="mt-1 text-2xl tabular-nums">{value.toLocaleString("ko-KR")} <span className="text-sm font-normal text-muted-foreground">{unit}</span></CardTitle></CardHeader></Card> }
function Quantity({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <span><span className="text-muted-foreground">{label}</span><strong className={cn("ml-1 tabular-nums", warning && "text-orange-600")}>{value}</strong></span> }
function Info({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarClockIcon }) { return <div className="rounded-lg bg-muted/50 p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-1.5 truncate text-sm font-medium" title={value}>{value}</p></div> }
function Total({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) { return <div role="group" aria-label={`${label} ${value}`} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-xl font-semibold tabular-nums", warning && "text-orange-600")}>{value.toLocaleString("ko-KR")}</p></div> }
