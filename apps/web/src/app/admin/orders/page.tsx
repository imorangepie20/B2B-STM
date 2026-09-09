"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircleIcon,
  BoxesIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  Clock3Icon,
  HistoryIcon,
  PackageCheckIcon,
  RefreshCwIcon,
  SearchIcon,
  StoreIcon,
  WarehouseIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { OrderPagination, type PageMetadata } from "@/components/orders/order-pagination"

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
}

type Order = {
  id: string
  status: "submitted" | "confirmed"
  createdAt: string
  confirmedAt: string | null
  customerCode: string
  customerName: string
  warehouseCode: string
  cancellationRequest: { id: string; reason: string; requestedAt: string } | null
  lines: Line[]
}

type StatusFilter = "all" | Order["status"]

async function csrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" })
  if (!response.ok) throw new Error("보안 토큰을 준비하지 못했습니다.")
  return (await response.json() as { csrfToken: string }).csrfToken
}

const sum = (order: Order, field: keyof Pick<Line, "requestedQuantity" | "shippedQuantity" | "remainingReservedQuantity" | "waitingQuantity">) =>
  order.lines.reduce((total, line) => total + line[field], 0)

const money = (value: bigint) => `${value.toLocaleString("ko-KR")}원`

const orderAmount = (order: Order) => order.lines.reduce(
  (total, line) => total + BigInt(line.unitPrice) * BigInt(line.requestedQuantity),
  0n,
)

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<PageMetadata>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })
  const [selectedId, setSelectedId] = useState("")
  const [message, setMessage] = useState("")
  const [busyId, setBusyId] = useState("")
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState(""), [from,setFrom]=useState(""), [to,setTo]=useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [cancelReason, setCancelReason] = useState("")
  const [reviewNote, setReviewNote] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const params=new URLSearchParams({page:String(page),pageSize:"50",status}); if(appliedQuery)params.set("query",appliedQuery);if(from)params.set("from",from);if(to)params.set("to",to)
    const response = await fetch(`/api/admin/orders?${params}`, { credentials: "same-origin" })
    if (!response.ok) {
      setMessage("주문 목록을 불러오지 못했습니다.")
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
  }, [page,appliedQuery,status,from,to])

  useEffect(() => { void load() }, [load])
  useEffect(()=>{const id=setTimeout(()=>{setAppliedQuery(query.trim());setPage(1)},300);return()=>clearTimeout(id)},[query])

  const command = async (order: Order, action: "confirm" | "allocate" | "cancel") => {
    if (action === "cancel" && !cancelReason.trim()) {
      setMessage("취소 사유를 입력해 주세요.")
      return
    }
    setBusyId(order.id)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          ...(action === "cancel" ? { reason: cancelReason.trim() } : {}),
        }),
      })
      if (!response.ok) {
        setMessage(action === "cancel" ? "주문을 취소하지 못했습니다. 최신 처리 상태를 다시 확인해 주세요." : action === "allocate" ? "미확보 수량을 배정하지 못했습니다. 최신 재고와 주문 상태를 다시 확인해 주세요." : "주문을 확정하지 못했습니다. 가용 재고와 최신 상태를 다시 확인해 주세요.")
        await load()
        return
      }
      const result = await response.json() as { reservedQuantity?: number; unreservedQuantity?: number; allocatedQuantity?: number; unallocatedQuantity?: number; releasedQuantity?: number }
      if (action === "confirm") {
        setMessage(`주문을 확정했습니다. 예약 ${result.reservedQuantity ?? 0}개 · 미확보 ${result.unreservedQuantity ?? 0}개`)
      } else if (action === "allocate") {
        setMessage(`최신 가용 재고를 다시 배정했습니다. 추가 예약 ${result.allocatedQuantity ?? 0}개 · 남은 미확보 ${result.unallocatedQuantity ?? 0}개`)
      } else {
        setMessage(`미출고 예약 ${result.releasedQuantity ?? 0}개를 해제하고 주문을 취소했습니다.`)
        setCancelReason("")
      }
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주문 처리 중 오류가 발생했습니다.")
    } finally {
      setBusyId("")
    }
  }

  const reviewCancellation = async (order: Order, action: "approve" | "reject") => {
    if (!order.cancellationRequest) return
    if (action === "reject" && !reviewNote.trim()) {
      setMessage("반려 사유를 입력해 주세요.")
      return
    }
    setBusyId(order.id)
    setMessage("")
    try {
      const response = await fetch(`/api/admin/order-cancellation-requests/${order.cancellationRequest.id}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
        body: JSON.stringify({ requestId: crypto.randomUUID(), ...(action === "reject" ? { reviewNote: reviewNote.trim() } : {}) }),
      })
      if (!response.ok) {
        setMessage("취소 요청을 처리하지 못했습니다. 최신 주문 상태를 다시 확인해 주세요.")
        await load()
        return
      }
      const result = await response.json() as { releasedQuantity?: number }
      setMessage(action === "approve" ? `취소 요청을 승인하고 미출고 예약 ${result.releasedQuantity ?? 0}개를 해제했습니다.` : "취소 요청을 반려했습니다. 주문의 출고 보류가 해제됩니다.")
      setReviewNote("")
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "취소 요청 처리 중 오류가 발생했습니다.")
    } finally {
      setBusyId("")
    }
  }

  const counts = useMemo(() => ({
    submitted: orders.filter(order => order.status === "submitted").length,
    confirmed: orders.filter(order => order.status === "confirmed").length,
    waiting: orders.reduce((total, order) => total + sum(order, "waitingQuantity"), 0),
  }), [orders])

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return orders.filter(order => {
      const statusMatches = status === "all" || order.status === status
      const queryMatches = !normalized || [order.id, order.customerCode, order.customerName, order.warehouseCode, ...order.lines.flatMap(line => [line.sku, line.name])]
        .some(value => value.toLowerCase().includes(normalized))
      return statusMatches && queryMatches
    })
  }, [orders, query, status])

  const selected = orders.find(order => order.id === selectedId) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">주문 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">접수 주문을 확인하고 품목별 예약·출고·미확보 수량을 기준으로 처리합니다.</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" render={<Link href="/admin/order-history" />}><HistoryIcon />완료·취소 이력</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCwIcon className={loading ? "animate-spin" : ""} />새로고침</Button></div>
      </div>

      {message && <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"><AlertCircleIcon className="size-4 text-muted-foreground" />{message}</div>}

      <section className="grid gap-3 sm:grid-cols-3" aria-label="주문 처리 현황">
        <SummaryCard label="확정 대기" value={counts.submitted} unit="건" icon={Clock3Icon} />
        <SummaryCard label="출고 진행" value={counts.confirmed} unit="건" icon={PackageCheckIcon} />
        <SummaryCard label="미확보 수량" value={counts.waiting} unit="개" icon={BoxesIcon} />
      </section>

      <Card>
        <CardContent className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
          <label className="relative block min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="주문번호, 거래처, SKU, 상품명 검색" aria-label="주문 검색" />
          </label>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1" aria-label="주문 상태 필터">
            {(["all", "submitted", "confirmed"] as const).map(value => (
              <Button key={value} size="sm" variant="ghost" className={cn("flex-1 lg:flex-none", status === value && "bg-background shadow-sm hover:bg-background")} onClick={() => {setStatus(value);setPage(1)}}>
                {value === "all" ? "전체" : value === "submitted" ? "접수" : "확정"}
              </Button>
            ))}
          </div>
          <Input className="lg:w-36" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1)}} aria-label="주문 시작일"/><Input className="lg:w-36" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1)}} aria-label="주문 종료일"/><span className="text-xs text-muted-foreground">{pagination.total.toLocaleString("ko-KR")}건</span>
        </CardContent>
      </Card>

      <OrderPagination metadata={pagination} loading={loading} onPageChange={setPage} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.6fr)]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader className="border-b">
            <CardTitle>처리 대상 주문</CardTitle>
            <CardDescription>접수 순서대로 표시하며 전량 출고된 주문은 제외됩니다.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[680px] overflow-y-auto p-0">
            {filteredOrders.map(order => (
              <button
                type="button"
                key={order.id}
                onClick={() => { setSelectedId(order.id); setCancelReason(""); setReviewNote("") }}
                className={cn("w-full border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50", selectedId === order.id && "bg-muted")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-sm">{order.customerName}</strong>
                      <OrderStatus status={order.status} />
                      {order.cancellationRequest && <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-800">취소 요청</Badge>}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()} · {order.warehouseCode}</p>
                  </div>
                  <time className="shrink-0 text-[11px] text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("ko-KR")}</time>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Quantity label="주문" value={sum(order, "requestedQuantity")} />
                  <Quantity label="출고" value={sum(order, "shippedQuantity")} />
                  <Quantity label="대기" value={sum(order, "waitingQuantity")} warning={sum(order, "waitingQuantity") > 0} />
                </div>
              </button>
            ))}
            {!filteredOrders.length && <p className="px-4 py-14 text-center text-sm text-muted-foreground">조건에 맞는 처리 대상 주문이 없습니다.</p>}
          </CardContent>
        </Card>

        {selected ? <OrderDetail order={selected} busy={busyId === selected.id} cancelReason={cancelReason} setCancelReason={setCancelReason} reviewNote={reviewNote} setReviewNote={setReviewNote} command={command} reviewCancellation={reviewCancellation} /> : (
          <Card><CardContent className="grid min-h-72 place-items-center text-sm text-muted-foreground">왼쪽 목록에서 주문을 선택해 주세요.</CardContent></Card>
        )}
      </div>
    </div>
  )
}

function OrderDetail({ order, busy, cancelReason, setCancelReason, reviewNote, setReviewNote, command, reviewCancellation }: {
  order: Order
  busy: boolean
  cancelReason: string
  setCancelReason: (value: string) => void
  reviewNote: string
  setReviewNote: (value: string) => void
  command: (order: Order, action: "confirm" | "allocate" | "cancel") => Promise<void>
  reviewCancellation: (order: Order, action: "approve" | "reject") => Promise<void>
}) {
  const requested = sum(order, "requestedQuantity")
  const shipped = sum(order, "shippedQuantity")
  const reserved = sum(order, "remainingReservedQuantity")
  const waiting = sum(order, "waitingQuantity")

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2"><OrderStatus status={order.status} /><span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8).toUpperCase()}</span></div>
            <CardTitle className="text-lg">{order.customerName}</CardTitle>
            <CardDescription>{order.customerCode} · {order.lines.length}개 품목</CardDescription>
          </div>
          <div className="text-left sm:text-right"><p className="text-xs text-muted-foreground">주문 금액</p><strong className="mt-1 block text-xl tabular-nums">{money(orderAmount(order))}</strong></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="접수 일시" value={new Date(order.createdAt).toLocaleString("ko-KR")} icon={CalendarClockIcon} />
          <Info label="확정 일시" value={order.confirmedAt ? new Date(order.confirmedAt).toLocaleString("ko-KR") : "확정 전"} icon={CheckCircle2Icon} />
          <Info label="출고 창고" value={order.warehouseCode} icon={WarehouseIcon} />
          <Info label="거래처" value={order.customerCode} icon={StoreIcon} />
        </div>

        <div className="hidden overflow-x-auto rounded-lg border sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead className="text-right">주문</TableHead>
                <TableHead className="text-right">출고</TableHead>
                <TableHead className="text-right">예약</TableHead>
                <TableHead className="text-right">미확보</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lines.map(line => (
                <TableRow key={line.sku}>
                  <TableCell><strong>{line.name}</strong><span className="ml-2 font-mono text-xs text-muted-foreground">{line.sku}</span><span className="ml-2 text-xs text-muted-foreground">/ {line.saleUnit}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{money(BigInt(line.unitPrice))}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{line.requestedQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.shippedQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.remainingReservedQuantity}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", line.waitingQuantity > 0 && "font-semibold text-orange-600")}>{line.waitingQuantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-2 sm:hidden">
          {order.lines.map(line => <OrderLineCard line={line} key={line.sku} />)}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Total label="주문" value={requested} />
          <Total label="누적 출고" value={shipped} />
          <Total label="출고 예약" value={reserved} />
          <Total label="미확보 대기" value={waiting} warning={waiting > 0} />
        </div>

        {order.status === "submitted" ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><strong className="text-sm">최신 가용 재고로 주문 확정</strong><p className="mt-1 text-xs text-muted-foreground">확정 시점에 확보 가능한 수량만 예약되고 부족분은 대기로 남습니다.</p></div>
            <Button className="sm:min-w-48" disabled={busy} onClick={() => void command(order, "confirm")}><ClipboardCheckIcon />{busy ? "처리 중…" : "주문 확정 · 재고 예약"}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {order.cancellationRequest ? <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><Badge variant="outline" className="border-orange-300 bg-background text-orange-800">검토 대기</Badge><time className="text-xs text-orange-800">{new Date(order.cancellationRequest.requestedAt).toLocaleString("ko-KR")}</time></div><strong className="mt-3 block text-sm text-orange-950">거래처 미출고 잔량 취소 요청</strong><p className="mt-1 text-sm text-orange-950">{order.cancellationRequest.reason}</p><p className="mt-2 text-xs text-orange-800">검토 중에는 이 주문의 재고 배정과 창고 출고가 보류됩니다.</p></div></div><div className="mt-4 border-t border-orange-200 pt-4"><Input aria-label="취소 요청 반려 사유" value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="반려 시 사유를 입력해 주세요" /><div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => void reviewCancellation(order, "reject")}>{busy ? "처리 중…" : "사유 입력 후 반려"}</Button><Button variant="destructive" disabled={busy} onClick={() => void reviewCancellation(order, "approve")}>{busy ? "처리 중…" : "잔량 취소 승인"}</Button></div></div></div> : <>
            {waiting > 0 && <div className="flex flex-col gap-3 rounded-lg border border-orange-200 bg-orange-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><strong className="text-sm text-orange-950">미확보 {waiting.toLocaleString("ko-KR")}개 재고 배정</strong><p className="mt-1 text-xs text-orange-800">추가 입고된 최신 가용 재고를 확인해 이 주문의 부족 수량에 다시 예약합니다.</p></div>
              <Button className="sm:min-w-44" disabled={busy} onClick={() => void command(order, "allocate")}><BoxesIcon />{busy ? "처리 중…" : "미확보 재배정"}</Button>
            </div>}
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-3"><strong className="text-sm">미출고 잔량 취소</strong><p className="mt-1 text-xs text-muted-foreground">이미 출고된 수량은 유지하고 활성 예약을 해제합니다. 취소 사유는 필수입니다.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="주문 취소 사유" value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="예: 거래처 요청으로 잔량 취소" />
                <Button className="sm:min-w-44" variant="destructive" disabled={busy} onClick={() => void command(order, "cancel")}>{busy ? "처리 중…" : "미출고 예약 취소"}</Button>
              </div>
            </div>
            </>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function OrderStatus({ status }: { status: Order["status"] }) {
  return <Badge variant={status === "submitted" ? "outline" : "secondary"}>{status === "submitted" ? "접수" : "확정"}</Badge>
}

function SummaryCard({ label, value, unit, icon: Icon }: { label: string; value: number; unit: string; icon: typeof Clock3Icon }) {
  return <Card size="sm"><CardHeader className="grid grid-cols-[1fr_auto]"><CardDescription>{label}</CardDescription><span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span><CardTitle className="mt-1 text-2xl tabular-nums">{value.toLocaleString("ko-KR")} <span className="text-sm font-normal text-muted-foreground">{unit}</span></CardTitle></CardHeader></Card>
}

function Quantity({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <span><span className="text-muted-foreground">{label}</span><strong className={cn("ml-1 tabular-nums", warning && "text-orange-600")}>{value}</strong></span>
}

function Info({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarClockIcon }) {
  return <div className="rounded-lg bg-muted/50 p-3"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-1.5 truncate text-sm font-medium" title={value}>{value}</p></div>
}

function Total({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div role="group" aria-label={`${label} ${value}`} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-1 text-xl font-semibold tabular-nums", warning && "text-orange-600")}>{value.toLocaleString("ko-KR")}</p></div>
}

function OrderLineCard({ line }: { line: Line }) {
  return <div className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-sm">{line.name}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">{line.sku} · {line.saleUnit}</p></div><strong className="shrink-0 text-sm tabular-nums">{money(BigInt(line.unitPrice))}</strong></div><div className="mt-3 grid grid-cols-4 gap-2 border-t pt-3 text-xs"><Quantity label="주문" value={line.requestedQuantity} /><Quantity label="출고" value={line.shippedQuantity} /><Quantity label="예약" value={line.remainingReservedQuantity} /><Quantity label="미확보" value={line.waitingQuantity} warning={line.waitingQuantity > 0} /></div></div>
}
