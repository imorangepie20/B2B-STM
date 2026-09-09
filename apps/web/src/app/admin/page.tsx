'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  PackagePlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  ShoppingCartIcon,
  TruckIcon,
  WalletCardsIcon,
  WarehouseIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AdminAnalyticsPanel } from '@/components/analytics/admin-analytics'

type Item = { id: string; code?: string; sku?: string; name: string }
type Data = { customers: Item[]; suppliers: Item[]; warehouses: Item[]; products: Item[] }
type Stock = {
  warehouseCode: string
  sku: string
  name: string
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
}
type Dashboard = {
  days: 7 | 30 | 90
  generatedAt: string
  period: { orders: number; shipments: number; grossSalesAmount: string; returnDeductionAmount: string; netSalesAmount: string }
  orderStatus: { submitted: number; confirmed: number; rejected: number }
  fulfillment: { requestedQuantity: number; shippedQuantity: number; rate: number }
  inventory: { onHandQuantity: number; reservedQuantity: number; availableQuantity: number; reservationRate: number }
  settlement: { billedAmount: string; collectedAmount: string; outstandingAmount: string; collectionRate: number }
  pendingOrders: number
  lowStockProducts: number
  pendingReturns: number
  unallocatedPaymentAmount: string
}

const donutChartConfig = {
  submitted: { label: '처리 대기', color: '#f59e0b' },
  confirmed: { label: '확정', color: '#10b981' },
  rejected: { label: '거절', color: '#ef4444' },
  reserved: { label: '예약', color: '#2563eb' },
  available: { label: '가용', color: '#10b981' },
  empty: { label: '데이터 없음', color: '#e5e7eb' },
} satisfies ChartConfig

const collectionChartConfig = {
  value: { label: '수금률', color: '#10b981' },
} satisfies ChartConfig

const control = 'h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
  return (await response.json() as { csrfToken: string }).csrfToken
}

async function post(path: string, body: object) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
    body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
  })
}

export default function AdminPage() {
  const [data, setData] = useState<Data>({ customers: [], suppliers: [], warehouses: [], products: [] })
  const [stock, setStock] = useState<Stock[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<7 | 30 | 90>(7)

  const load = useCallback(async () => {
    setLoading(true)
    const [catalog, inventory, summary] = await Promise.all([
      fetch('/api/admin/catalog', { credentials: 'same-origin' }),
      fetch('/api/admin/inventory', { credentials: 'same-origin' }),
      fetch(`/api/admin/dashboard?days=${days}`, { credentials: 'same-origin' }),
    ])
    if (!catalog.ok) {
      setMessage('관리자 권한과 MFA 인증을 확인해 주세요.')
      setLoading(false)
      return
    }
    setData(await catalog.json() as Data)
    setStock(inventory.ok ? await inventory.json() as Stock[] : [])
    setDashboard(summary.ok ? await summary.json() as Dashboard : null)
    setLoading(false)
  }, [days])

  useEffect(() => { void load() }, [load])

  const receipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const response = await post('/api/admin/receipts', {
      supplierId: form.get('supplierId'),
      warehouseId: form.get('warehouseId'),
      lines: [{ productId: form.get('productId'), quantity: Number(form.get('quantity')) }],
    })
    setMessage(response.ok ? '입고를 확정했습니다.' : '입고 등록에 실패했습니다.')
    if (response.ok) {
      formElement.reset()
      await load()
    }
  }

  const filteredStock = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return stock
    return stock.filter(item => [item.name, item.sku, item.warehouseCode].some(value => value.toLowerCase().includes(normalized)))
  }, [query, stock])

  const kpis = [
    { href: '/admin/orders', label: `신규 주문 (${days}일)`, value: dashboard?.period.orders, unit: '건', detail: `처리 대기 ${dashboard?.pendingOrders ?? 0}건`, icon: ShoppingCartIcon, bar: 'bg-blue-500' },
    { href: '/warehouse/shipments', label: `출고 (${days}일)`, value: dashboard?.period.shipments, unit: '건', detail: `수량 이행률 ${dashboard?.fulfillment.rate ?? 0}%`, icon: TruckIcon, bar: 'bg-emerald-500' },
    { href: '/admin/settlements', label: `순매출 (${days}일)`, value: dashboard ? money(dashboard.period.netSalesAmount) : undefined, unit: '원', detail: `출고 매출 ${dashboard ? money(dashboard.period.grossSalesAmount) : 0}원`, icon: BanknoteIcon, bar: 'bg-cyan-500' },
    { href: '/admin/return-credits', label: `반품 차감 (${days}일)`, value: dashboard ? money(dashboard.period.returnDeductionAmount) : undefined, unit: '원', detail: `처리 대기 ${dashboard?.pendingReturns ?? 0}건`, icon: RotateCcwIcon, bar: 'bg-orange-500' },
    { href: '/admin/payments', label: '정산 미수금', value: dashboard ? money(dashboard.settlement.outstandingAmount) : undefined, unit: '원', detail: `수금률 ${dashboard?.settlement.collectionRate ?? 0}%`, icon: WalletCardsIcon, bar: 'bg-violet-500' },
    { href: '/admin/inventory-adjustments', label: '가용 재고 없음', value: dashboard?.lowStockProducts, unit: '품목', detail: `현재 가용 ${dashboard?.inventory.availableQuantity.toLocaleString('ko-KR') ?? 0}개`, icon: AlertCircleIcon, bar: 'bg-red-500' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">운영 현황</h1>
          <p className="mt-1 text-sm text-muted-foreground">주문부터 출고·재고·정산까지 핵심 흐름을 한눈에 확인합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <CalendarDaysIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <select aria-label="통계 조회 기간" className={`${control} w-28 pl-8`} value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}>
              <option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option>
            </select>
          </label>
          <Button variant="outline" onClick={() => void load()} disabled={loading} aria-label="대시보드 새로고침">
            <RefreshCwIcon className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">새로고침</span>
          </Button>
        </div>
      </div>

      {message && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <AlertCircleIcon className="size-4 text-muted-foreground" />
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-label="핵심 운영 지표">
        {kpis.map(({ href, label, value, unit, detail, icon: Icon, bar }) => (
          <Link href={href} key={label} className="group">
            <Card size="sm" className="h-full min-h-36 rounded-[10px] transition-shadow group-hover:shadow-sm">
              <CardHeader className="grid grid-cols-[1fr_auto] gap-x-3">
                <CardDescription className="text-xs font-medium">{label}</CardDescription>
                <span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <CardTitle className="mt-1 text-2xl font-semibold tabular-nums">
                  {value ?? '—'} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="mt-auto space-y-2">
                <p className="text-xs text-muted-foreground">{detail}</p>
                <div className="h-0.5 overflow-hidden rounded-full bg-muted"><div className={`h-full w-full ${bar}`} /></div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>

      <AdminAnalyticsPanel view="overview" defaultDays={days} />

    <section className="grid gap-4 xl:grid-cols-3" aria-label="업무 흐름 분석">
        <Card>
          <CardHeader>
            <CardTitle>주문 처리 분포</CardTitle>
            <CardDescription>최근 {days}일 접수 주문의 현재 상태입니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-44 items-center gap-6">
            <Donut
              label={`주문 ${dashboard?.period.orders ?? 0}건`}
              segments={[
                { name: '처리 대기', value: dashboard?.orderStatus.submitted ?? 0, color: '#f59e0b' },
                { name: '확정', value: dashboard?.orderStatus.confirmed ?? 0, color: '#10b981' },
                { name: '거절', value: dashboard?.orderStatus.rejected ?? 0, color: '#ef4444' },
              ]}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <LegendRow label="처리 대기" value={dashboard?.orderStatus.submitted ?? 0} color="bg-amber-500" />
              <LegendRow label="확정" value={dashboard?.orderStatus.confirmed ?? 0} color="bg-emerald-500" />
              <LegendRow label="거절" value={dashboard?.orderStatus.rejected ?? 0} color="bg-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>재고 구성</CardTitle>
            <CardDescription>현재 모든 창고의 예약·가용 수량입니다.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-44 items-center gap-6">
            <Donut
              label={`보유 ${(dashboard?.inventory.onHandQuantity ?? 0).toLocaleString('ko-KR')}개`}
              segments={[
                { name: '예약', value: dashboard?.inventory.reservedQuantity ?? 0, color: '#2563eb' },
                { name: '가용', value: dashboard?.inventory.availableQuantity ?? 0, color: '#10b981' },
              ]}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <LegendRow label="예약" value={dashboard?.inventory.reservedQuantity ?? 0} color="bg-blue-600" />
              <LegendRow label="가용" value={dashboard?.inventory.availableQuantity ?? 0} color="bg-emerald-500" />
              <p className="border-t pt-3 text-xs text-muted-foreground">보유 재고 중 예약 비중 <strong className="text-foreground">{dashboard?.inventory.reservationRate ?? 0}%</strong></p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>정산 수금 현황</CardTitle>
            <CardDescription>확정 정산서의 누적 수금 진행률입니다.</CardDescription>
          </CardHeader>
          <CardContent className="min-h-44 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <MoneyValue label="청구" value={dashboard?.settlement.billedAmount} />
              <MoneyValue label="수금" value={dashboard?.settlement.collectedAmount} />
              <MoneyValue label="미수" value={dashboard?.settlement.outstandingAmount} emphasis />
            </div>
            <CollectionChart rate={dashboard?.settlement.collectionRate ?? 0} />
            <Button variant="outline" className="w-full" render={<Link href="/admin/payments" />}>입금 배분 관리 <ArrowRightIcon /></Button>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>오늘의 처리 대기</CardTitle>
            <CardDescription>현재 담당자가 확인해야 할 운영 항목입니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <QueueValue href="/admin/orders" icon={ClipboardListIcon} label="주문 확정" value={dashboard?.pendingOrders ?? 0} unit="건" />
            <QueueValue href="/admin/return-credits" icon={RotateCcwIcon} label="반품 처리" value={dashboard?.pendingReturns ?? 0} unit="건" />
            <QueueValue href="/admin/payments" icon={WalletCardsIcon} label="미배분 입금" value={money(dashboard?.unallocatedPaymentAmount)} unit="원" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>기준정보</CardTitle><CardDescription>현재 운영 중인 업무 기준입니다.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4">
            <CountRow label="거래처" value={data.customers.length} /><CountRow label="공급처" value={data.suppliers.length} />
            <CountRow label="창고" value={data.warehouses.length} /><CountRow label="상품" value={data.products.length} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>처리 바로가기</CardTitle>
            <CardDescription>대기 업무 화면으로 바로 이동합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <QuickLink href="/admin/orders" icon={ClipboardListIcon} label="주문 확정·예약" />
            <QuickLink href="/admin/return-credits" icon={RotateCcwIcon} label="반품 검수·차감" />
            <QuickLink href="/admin/settlement-drafts" icon={WalletCardsIcon} label="월 정산 초안" />
            <QuickLink href="/admin/inventory-adjustments" icon={WarehouseIcon} label="재고 정정" />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground"><PackagePlusIcon className="size-4" /></span>
            <div>
              <CardTitle>입고 빠른 처리</CardTitle>
              <CardDescription>확정 즉시 선택한 창고의 보유 수량에 반영됩니다.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2 md:grid-cols-[1fr_1fr_1.4fr_0.7fr_auto]" onSubmit={receipt}>
            <select aria-label="공급처" className={control} name="supplierId" required defaultValue="">
              <option value="" disabled>공급처 선택</option>
              {data.suppliers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
            <select aria-label="창고" className={control} name="warehouseId" required defaultValue="">
              <option value="" disabled>창고 선택</option>
              {data.warehouses.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
            <select aria-label="상품" className={control} name="productId" required defaultValue="">
              <option value="" disabled>상품 선택</option>
              {data.products.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
            </select>
            <Input aria-label="입고 수량" name="quantity" type="number" min="1" placeholder="수량" required />
            <Button type="submit"><PackagePlusIcon />입고 확정</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b sm:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>창고별 재고</CardTitle>
            <CardDescription>상품과 창고를 검색해 예약 가능 수량을 확인합니다.</CardDescription>
          </div>
          <label className="relative mt-3 block w-full sm:mt-0 sm:w-72">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="SKU, 상품명, 창고 검색" />
          </label>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>창고</TableHead>
                <TableHead className="text-right">보유</TableHead>
                <TableHead className="text-right">예약</TableHead>
                <TableHead className="text-right">가용</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStock.map(item => (
                <TableRow key={`${item.warehouseCode}-${item.sku}`}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                  <TableCell>{item.warehouseCode}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.onHandQuantity.toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.reservedQuantity.toLocaleString('ko-KR')}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{item.availableQuantity.toLocaleString('ko-KR')}</TableCell>
                  <TableCell><Badge variant={item.availableQuantity > 0 ? 'secondary' : 'destructive'}>{item.availableQuantity > 0 ? '가용' : '확인 필요'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!filteredStock.length && <p className="py-10 text-center text-sm text-muted-foreground">조건에 맞는 재고가 없습니다.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function money(value?: string) {
  return Number(value ?? 0).toLocaleString('ko-KR')
}

function Donut({ label, segments }: { label: string; segments: { name: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const data = total ? segments.filter(segment => segment.value > 0) : [{ name: '데이터 없음', value: 1, color: '#e5e7eb' }]
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={label}>
      <ChartContainer config={donutChartConfig} className="size-28 aspect-square" initialDimension={{ width: 112, height: 112 }}>
        <PieChart accessibilityLayer>
          {total > 0 && <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />}
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={36} outerRadius={52} paddingAngle={total ? 2 : 0} strokeWidth={0} isAnimationActive={false}>
            {data.map(segment => <Cell key={segment.name} fill={segment.color} />)}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-xs font-semibold leading-tight">{label}</div>
    </div>
  )
}

function CollectionChart({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/20 p-2.5">
      <div className="relative size-20 shrink-0" role="img" aria-label={`수금률 ${rate}%`}>
        <ChartContainer config={collectionChartConfig} className="size-20 aspect-square" initialDimension={{ width: 80, height: 80 }}>
          <RadialBarChart accessibilityLayer data={[{ name: '수금률', value: rate, fill: '#10b981' }]} innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" background cornerRadius={8} isAnimationActive={false} />
          </RadialBarChart>
        </ChartContainer>
        <strong className="pointer-events-none absolute inset-0 grid place-items-center text-sm tabular-nums">{rate}%</strong>
      </div>
      <div className="min-w-0 text-xs"><p className="font-medium">확정 정산서 수금률</p><p className="mt-1 text-muted-foreground">배분 완료 입금을 기준으로 계산합니다.</p></div>
    </div>
  )
}

function LegendRow({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="flex items-center gap-2 text-xs"><span className={`size-2 rounded-full ${color}`} /><span className="text-muted-foreground">{label}</span><strong className="ml-auto tabular-nums">{value.toLocaleString('ko-KR')}건</strong></div>
}

function MoneyValue({ label, value, emphasis = false }: { label: string; value?: string; emphasis?: boolean }) {
  return <div className="rounded-lg bg-muted/50 p-2.5"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`mt-1 truncate text-sm font-semibold tabular-nums ${emphasis ? 'text-red-600' : ''}`}>{money(value)}원</p></div>
}

function QueueValue({ href, icon: Icon, label, value, unit }: { href: string; icon: typeof ClipboardListIcon; label: string; value: number | string; unit: string }) {
  return <Link href={href} className="group/queue rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/60"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-3 text-xl font-semibold tabular-nums">{value}<span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span></p></Link>
}

function CountRow({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between border-b py-2 last:border-0"><span className="text-sm text-muted-foreground">{label}</span><strong className="tabular-nums">{value.toLocaleString('ko-KR')}</strong></div>
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof ClipboardListIcon; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted">
      <Icon className="size-4 text-muted-foreground" />
      <span>{label}</span>
      <ArrowRightIcon className="ml-auto size-3.5 text-muted-foreground" />
    </Link>
  )
}
