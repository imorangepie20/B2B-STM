'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircleIcon,
  CalendarClockIcon,
  CheckCheckIcon,
  ClipboardListIcon,
  PackageCheckIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  StoreIcon,
  UserCheckIcon,
  UserRoundXIcon,
  WarehouseIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { OrderPagination, type PageMetadata } from '@/components/orders/order-pagination'
import { cn } from '@/lib/utils'
import { WarehouseAnalyticsPanel } from '@/components/analytics/role-analytics'

type QueueItem = {
  reservationId: string
  orderId: string
  orderCreatedAt: string
  confirmedAt: string
  customerCode: string
  customerName: string
  warehouseCode: string
  sku: string
  productName: string
  saleUnit: string
  remainingQuantity: number
  pickedQuantity: number
  inspectedQuantity: number
  shippableQuantity: number
  assignedTo: string | null
  assignedToEmail: string | null
  assignedAt: string | null
  assignmentMine: boolean
}

type ShipmentOrder = {
  orderId: string
  orderCreatedAt: string
  confirmedAt: string
  customerCode: string
  customerName: string
  warehouseCode: string
  assignedTo: string | null
  assignedToEmail: string | null
  assignedAt: string | null
  assignmentMine: boolean
  lines: QueueItem[]
}

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('보안 토큰을 준비할 수 없습니다.')
  return (await response.json() as { csrfToken: string }).csrfToken
}

function groupQueue(queue: QueueItem[]) {
  const grouped = new Map<string, ShipmentOrder>()
  for (const item of queue) {
    const order = grouped.get(item.orderId)
    if (order) {
      order.lines.push(item)
    } else {
      grouped.set(item.orderId, {
        orderId: item.orderId,
        orderCreatedAt: item.orderCreatedAt,
        confirmedAt: item.confirmedAt,
        customerCode: item.customerCode,
        customerName: item.customerName,
        warehouseCode: item.warehouseCode,
        assignedTo: item.assignedTo,
        assignedToEmail: item.assignedToEmail,
        assignedAt: item.assignedAt,
        assignmentMine: item.assignmentMine,
        lines: [item],
      })
    }
  }
  return [...grouped.values()]
}

const totalRemaining = (order: ShipmentOrder) => order.lines.reduce((total, line) => total + line.remainingQuantity, 0)

export default function WarehouseShipmentsPage() {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [pickQuantities, setPickQuantities] = useState<Record<string, string>>({})
  const [inspectionQuantities, setInspectionQuantities] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [releaseReason, setReleaseReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [metadata, setMetadata] = useState<PageMetadata>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const parameters = new URLSearchParams({ page: String(page), pageSize: '50' })
    if (appliedSearch) parameters.set('query', appliedSearch)
    const response = await fetch(`/api/warehouse/shipments/queue?${parameters}`, { credentials: 'same-origin' })
    if (!response.ok) {
      setMessage('창고 권한을 확인하거나 다시 로그인해 주세요.')
      setLoading(false)
      return
    }
    const result = await response.json() as PageMetadata & { items: QueueItem[] }
    if (result.totalPages > 0 && page > result.totalPages) { setPage(result.totalPages); return }
    const nextQueue = result.items
    const orderIds = new Set(nextQueue.map(item => item.orderId))
    setQueue(nextQueue)
    setMetadata(result)
    setSelectedOrderId(current => orderIds.has(current) ? current : (nextQueue[0]?.orderId ?? ''))
    setLoading(false)
  }, [appliedSearch, page])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const orders = useMemo(() => groupQueue(queue), [queue])
  const visibleOrders = orders
  const selectedOrder = orders.find(order => order.orderId === selectedOrderId) ?? null

  useEffect(() => {
    if (!selectedOrder) { setPickQuantities({}); setInspectionQuantities({}); setQuantities({}); return }
    setPickQuantities(Object.fromEntries(selectedOrder.lines.map(item => [item.reservationId, String(item.pickedQuantity)])))
    setInspectionQuantities(Object.fromEntries(selectedOrder.lines.map(item => [item.reservationId, String(item.inspectedQuantity)])))
    setQuantities({})
  }, [selectedOrder])

  const selectedLines = useMemo(() => selectedOrder?.lines.map(item => ({
    reservationId: item.reservationId,
    quantity: Number(quantities[item.reservationId] || 0),
    remainingQuantity: item.shippableQuantity,
  })).filter(item => Number.isInteger(item.quantity) && item.quantity > 0) ?? [], [quantities, selectedOrder])
  const selectedQuantity = selectedLines.reduce((total, item) => total + item.quantity, 0)
  const remainingAfter = selectedOrder ? Math.max(0, totalRemaining(selectedOrder) - selectedQuantity) : 0

  const setAll = () => {
    if (!selectedOrder) return
    setQuantities(Object.fromEntries(selectedOrder.lines.map(item => [item.reservationId, String(item.shippableQuantity)])))
  }

  const clear = () => setQuantities({})

  const saveWork = async (stage: 'pick' | 'inspect') => {
    if (!selectedOrder) return
    const source = stage === 'pick' ? pickQuantities : inspectionQuantities
    const lines = selectedOrder.lines.map(item => ({ reservationId: item.reservationId, quantity: Number(source[item.reservationId] ?? 0) }))
    if (lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 0)) { setMessage('수량은 0 이상의 정수로 입력해 주세요.'); return }
    if (stage === 'pick' && lines.some((line, index) => line.quantity > selectedOrder.lines[index].remainingQuantity || line.quantity < selectedOrder.lines[index].inspectedQuantity)) { setMessage('피킹 수량은 현재 검수 수량 이상, 예약 잔량 이하여야 합니다.'); return }
    if (stage === 'inspect' && lines.some((line, index) => line.quantity > selectedOrder.lines[index].pickedQuantity)) { setMessage('검수 수량은 피킹 수량을 초과할 수 없습니다.'); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/warehouse/shipments/orders/${selectedOrder.orderId}/${stage}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID(), lines }),
      })
      if (!response.ok) { await load(); throw new Error(stage === 'pick' ? '피킹 수량 저장에 실패했습니다.' : '검수 완료 처리에 실패했습니다.') }
      setMessage(stage === 'pick' ? '피킹 수량을 저장했습니다.' : '검수 완료 수량을 저장했습니다.')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '작업 수량 저장에 실패했습니다.') } finally { setBusy(false) }
  }

  const claim = async () => {
    if (!selectedOrder) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/warehouse/shipments/orders/${selectedOrder.orderId}/claim`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID() }),
      })
      if (!response.ok) { await load(); throw new Error('다른 담당자가 먼저 시작한 작업입니다.') }
      setMessage('출고 작업을 시작했습니다.')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '작업 시작에 실패했습니다.') } finally { setBusy(false) }
  }

  const release = async () => {
    if (!selectedOrder || !releaseReason.trim()) { setMessage('인계 또는 반납 사유를 입력해 주세요.'); return }
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/warehouse/shipments/orders/${selectedOrder.orderId}/release`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID(), reason: releaseReason.trim() }),
      })
      if (!response.ok) { await load(); throw new Error('작업 반납에 실패했습니다. 담당 상태를 다시 확인해 주세요.') }
      setReleaseReason(''); setQuantities({}); setMessage('작업을 반납했습니다. 다른 담당자가 이어서 시작할 수 있습니다.')
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : '작업 반납에 실패했습니다.') } finally { setBusy(false) }
  }

  const ship = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('')
    if (!selectedOrder || !selectedLines.length) {
      setMessage('출고할 수량을 하나 이상 입력해 주세요.')
      return
    }
    if (selectedLines.some(item => item.quantity > item.remainingQuantity)) {
      setMessage('출고 수량이 검수 완료 수량을 초과했습니다.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/warehouse/shipments', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ requestId: crypto.randomUUID(), lines: selectedLines.map(({ reservationId, quantity }) => ({ reservationId, quantity })) }),
      })
      if (!response.ok) {
        await load()
        throw new Error('출고 확정에 실패했습니다. 최신 예약 잔여수량을 다시 확인해 주세요.')
      }
      const result = await response.json() as { shippedQuantity: number }
      setQuantities({})
      setMessage(`${result.shippedQuantity.toLocaleString('ko-KR')}개를 출고 처리했습니다.`)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '출고 확정에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">출고 작업</h1>
          <p className="mt-1 text-sm text-muted-foreground">담당 작업을 시작한 뒤 피킹, 검수, 출고를 순서대로 처리합니다.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={loading ? 'animate-spin' : ''} />새로고침
        </Button>
      </div>

      {message && <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status"><AlertCircleIcon className="size-4 text-muted-foreground" />{message}</div>}

      <WarehouseAnalyticsPanel view="shipments" />

      <section className="grid gap-3 sm:grid-cols-3" aria-label="출고 대기 현황">
        <SummaryCard label="전체 대기 주문" value={metadata.total} unit="건" icon={ClipboardListIcon} />
        <SummaryCard label="현재 페이지 품목" value={queue.length} unit="개" icon={PackageCheckIcon} />
        <SummaryCard label="현재 페이지 예약 잔량" value={queue.reduce((total, item) => total + item.remainingQuantity, 0)} unit="개" icon={WarehouseIcon} />
      </section>

      <Card>
        <CardContent className="py-3">
          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="주문번호, 거래처, SKU, 상품명 검색" aria-label="출고 작업 검색" />
          </label>
        </CardContent>
      </Card>

      <OrderPagination metadata={metadata} loading={loading} onPageChange={setPage} />

      <form onSubmit={ship} className="grid items-start gap-4 xl:grid-cols-[minmax(300px,0.68fr)_minmax(0,1.55fr)]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader className="border-b">
            <CardTitle>주문별 대기 작업</CardTitle>
            <CardDescription>확정 시각 순서로 표시합니다.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[680px] overflow-y-auto p-0">
            {visibleOrders.map(order => (
              <button
                type="button"
                key={order.orderId}
                onClick={() => { setSelectedOrderId(order.orderId); setQuantities({}) }}
                className={cn('w-full border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50', selectedOrderId === order.orderId && 'bg-muted')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><strong className="block truncate text-sm">{order.customerName}</strong><p className="mt-1 font-mono text-[11px] text-muted-foreground">#{order.orderId.slice(0, 8).toUpperCase()}</p></div>
                  <div className="flex flex-col items-end gap-1"><Badge variant="outline">{order.warehouseCode}</Badge>{order.assignmentMine ? <Badge className="bg-emerald-600">내 작업</Badge> : order.assignedTo ? <Badge variant="secondary">작업 중</Badge> : null}</div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">{order.lines.length}개 품목</span><span>예약 잔량 <strong className="tabular-nums">{totalRemaining(order)}</strong></span></div>
                <p className="mt-2 text-[11px] text-muted-foreground">확정 {new Date(order.confirmedAt).toLocaleString('ko-KR')}</p>
              </button>
            ))}
            {!visibleOrders.length && <p className="px-4 py-14 text-center text-sm text-muted-foreground">조건에 맞는 출고 작업이 없습니다.</p>}
          </CardContent>
        </Card>

        {selectedOrder ? (
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><div className="mb-2 flex items-center gap-2"><Badge variant="secondary">출고 대기</Badge><span className="font-mono text-xs text-muted-foreground">#{selectedOrder.orderId.slice(0, 8).toUpperCase()}</span></div><CardTitle className="text-lg">{selectedOrder.customerName}</CardTitle><CardDescription>{selectedOrder.customerCode}</CardDescription></div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:text-right"><span className="text-muted-foreground">출고 창고</span><strong>{selectedOrder.warehouseCode}</strong><span className="text-muted-foreground">예약 잔량</span><strong>{totalRemaining(selectedOrder).toLocaleString('ko-KR')}개</strong></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={cn('rounded-lg border p-3', selectedOrder.assignmentMine ? 'border-emerald-200 bg-emerald-50/70' : selectedOrder.assignedTo ? 'border-amber-200 bg-amber-50/70' : 'bg-muted/30')}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2.5"><UserCheckIcon className="mt-0.5 size-4 text-muted-foreground" /><div><strong className="block text-sm">{selectedOrder.assignmentMine ? '내가 담당 중인 작업' : selectedOrder.assignedTo ? '다른 담당자가 작업 중' : '담당자 미지정'}</strong><p className="mt-0.5 text-xs text-muted-foreground">{selectedOrder.assignedToEmail ?? '작업 시작 후 출고 수량을 입력할 수 있습니다.'}</p></div></div>
                  {!selectedOrder.assignedTo && <Button type="button" size="sm" onClick={() => void claim()} disabled={busy}><UserCheckIcon />작업 시작</Button>}
                </div>
                {selectedOrder.assignmentMine && <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row"><Input value={releaseReason} maxLength={300} onChange={event => setReleaseReason(event.target.value)} placeholder="교대·인계 또는 반납 사유" aria-label="작업 반납 사유" /><Button type="button" variant="outline" onClick={() => void release()} disabled={busy || !releaseReason.trim()}><UserRoundXIcon />작업 반납</Button></div>}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Info label="거래처" value={selectedOrder.customerCode} icon={StoreIcon} />
                <Info label="출고 창고" value={selectedOrder.warehouseCode} icon={WarehouseIcon} />
                <Info label="주문 확정" value={new Date(selectedOrder.confirmedAt).toLocaleString('ko-KR')} icon={CalendarClockIcon} />
              </div>

              <div className="grid gap-2 sm:grid-cols-3" aria-label="출고 작업 단계">
                <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3"><span className="text-xs font-medium text-blue-700">1단계</span><strong className="mt-1 block text-sm">피킹 수량 저장</strong><p className="mt-1 text-xs text-muted-foreground">선반에서 꺼낸 실제 수량을 입력합니다.</p></div>
                <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3"><span className="text-xs font-medium text-violet-700">2단계</span><strong className="mt-1 block text-sm">검수 완료</strong><p className="mt-1 text-xs text-muted-foreground">SKU와 수량을 확인한 결과를 기록합니다.</p></div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"><span className="text-xs font-medium text-emerald-700">3단계</span><strong className="mt-1 block text-sm">출고 확정</strong><p className="mt-1 text-xs text-muted-foreground">검수 수량 안에서 재고를 차감합니다.</p></div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><h2 className="text-sm font-semibold">품목별 작업 수량</h2><p className="mt-0.5 text-xs text-muted-foreground">수량 정정도 각 단계의 저장 버튼으로 이력에 남습니다.</p></div>
                <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="outline" onClick={() => setPickQuantities(Object.fromEntries(selectedOrder.lines.map(item => [item.reservationId, String(item.remainingQuantity)])))} disabled={!selectedOrder.assignmentMine || busy}>전량 피킹 입력</Button><Button type="button" size="sm" variant="outline" onClick={() => setInspectionQuantities(Object.fromEntries(selectedOrder.lines.map(item => [item.reservationId, String(item.pickedQuantity)])))} disabled={!selectedOrder.assignmentMine || busy}>피킹분 검수 입력</Button></div>
              </div>

              <div className="divide-y overflow-hidden rounded-lg border">
                {selectedOrder.lines.map(item => {
                  const quantity = Number(quantities[item.reservationId] || 0)
                  const validQuantity = Number.isInteger(quantity) && quantity >= 0 ? quantity : 0
                  return (
                    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(180px,1fr)_80px_repeat(3,minmax(105px,0.55fr))] lg:items-end" key={item.reservationId}>
                      <span className="min-w-0"><span className="font-mono text-xs text-muted-foreground">{item.sku}</span><strong className="mt-1 block truncate text-sm">{item.productName}</strong><span className="mt-1 block text-xs text-muted-foreground">단위 {item.saleUnit}</span></span>
                      <span className="rounded-md bg-muted/50 px-2 py-2 text-center"><span className="block text-[11px] text-muted-foreground">예약 잔량</span><strong className="tabular-nums">{item.remainingQuantity}</strong></span>
                      <label><span className="mb-1.5 block text-xs font-medium text-blue-700">피킹</span><Input className="h-10 text-right font-semibold" aria-label={`${item.productName} 피킹 수량`} type="number" min="0" max={item.remainingQuantity} step="1" inputMode="numeric" value={pickQuantities[item.reservationId] ?? '0'} onChange={event => setPickQuantities(current => ({ ...current, [item.reservationId]: event.target.value }))} disabled={!selectedOrder.assignmentMine || busy} /></label>
                      <label><span className="mb-1.5 block text-xs font-medium text-violet-700">검수 완료</span><Input className="h-10 text-right font-semibold" aria-label={`${item.productName} 검수 수량`} type="number" min="0" max={item.pickedQuantity} step="1" inputMode="numeric" value={inspectionQuantities[item.reservationId] ?? '0'} onChange={event => setInspectionQuantities(current => ({ ...current, [item.reservationId]: event.target.value }))} disabled={!selectedOrder.assignmentMine || busy} /></label>
                      <label><span className="mb-1.5 block text-xs font-medium text-emerald-700">이번 출고 <span className="font-normal text-muted-foreground">/ 가능 {item.shippableQuantity}</span></span><Input className="h-10 text-right font-semibold" aria-label={`${item.productName} 출고 수량`} aria-invalid={quantity > item.shippableQuantity || quantity < 0 || !Number.isInteger(quantity) ? true : undefined} type="number" min="0" max={item.shippableQuantity} step="1" inputMode="numeric" value={quantities[item.reservationId] || ''} onChange={event => setQuantities(current => ({ ...current, [item.reservationId]: event.target.value }))} placeholder="0" disabled={!selectedOrder.assignmentMine || busy} /></label>
                      <span className="text-xs text-muted-foreground lg:col-start-5">출고 후 검수 잔량 <strong className="text-foreground">{Math.max(0, item.shippableQuantity - validQuantity)}</strong></span>
                    </div>
                  )
                })}
              </div>

              <div className="grid gap-2 border-t pt-4 sm:grid-cols-2"><Button type="button" variant="outline" className="border-blue-200 text-blue-800" onClick={() => void saveWork('pick')} disabled={busy || !selectedOrder.assignmentMine}>피킹 수량 저장</Button><Button type="button" variant="outline" className="border-violet-200 text-violet-800" onClick={() => void saveWork('inspect')} disabled={busy || !selectedOrder.assignmentMine}>검수 완료 저장</Button></div>

              <div className="sticky bottom-0 rounded-lg border bg-background/95 p-4 shadow-sm backdrop-blur">
                <div className="mb-3 flex justify-end gap-1"><Button type="button" size="sm" variant="ghost" onClick={clear} disabled={!selectedOrder.assignmentMine}><RotateCcwIcon />출고 입력 초기화</Button><Button type="button" size="sm" variant="outline" onClick={setAll} disabled={!selectedOrder.assignmentMine}><CheckCheckIcon />검수분 전량 출고</Button></div>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <ShipmentTotal label="선택 품목" value={selectedLines.length} unit="개" />
                  <ShipmentTotal label="이번 출고" value={selectedQuantity} unit="개" emphasis />
                  <ShipmentTotal label="출고 후 잔량" value={remainingAfter} unit="개" />
                </div>
                <Button type="submit" size="lg" className="h-11 w-full text-sm" disabled={busy || !selectedOrder.assignmentMine || !selectedLines.length}><PackageCheckIcon />{busy ? '출고 확정 중…' : selectedOrder.assignmentMine ? '출고 확정' : '작업 시작 후 출고 가능'}</Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">확정하면 재고와 예약이 함께 차감되고 정산 대상 출고 원장이 생성됩니다.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="grid min-h-72 place-items-center text-sm text-muted-foreground">왼쪽 목록에서 출고할 주문을 선택해 주세요.</CardContent></Card>
        )}
      </form>
    </div>
  )
}

function SummaryCard({ label, value, unit, icon: Icon }: { label: string; value: number; unit: string; icon: typeof ClipboardListIcon }) {
  return <Card size="sm"><CardHeader className="grid grid-cols-[1fr_auto]"><CardDescription>{label}</CardDescription><span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span><CardTitle className="mt-1 text-2xl tabular-nums">{value.toLocaleString('ko-KR')} <span className="text-sm font-normal text-muted-foreground">{unit}</span></CardTitle></CardHeader></Card>
}

function Info({ label, value, icon: Icon }: { label: string; value: string; icon: typeof StoreIcon }) {
  return <div className="rounded-lg bg-muted/50 p-3"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</span><strong className="mt-1.5 block truncate text-sm" title={value}>{value}</strong></div>
}

function ShipmentTotal({ label, value, unit, emphasis = false }: { label: string; value: number; unit: string; emphasis?: boolean }) {
  return <div role="group" aria-label={`${label} ${value}${unit}`} className="rounded-md bg-muted/50 px-2 py-2"><span className="block text-[11px] text-muted-foreground">{label}</span><strong className={cn('mt-0.5 block text-base tabular-nums', emphasis && 'text-emerald-600')}>{value.toLocaleString('ko-KR')}<span className="ml-0.5 text-xs font-normal">{unit}</span></strong></div>
}
