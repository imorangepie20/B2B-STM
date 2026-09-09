'use client'

import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { CalendarDaysIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

export type AdminAnalytics = {
  days: 7 | 30 | 90
  daily: { date: string; orders: number; shipments: number; grossSalesAmount: string; returnDeductionAmount: string; netSalesAmount: string }[]
  topProducts: { sku: string; name: string; shippedQuantity: number; netSalesAmount: string }[]
  inventoryByWarehouse: { warehouseCode: string; warehouseName: string; onHandQuantity: number; reservedQuantity: number; availableQuantity: number }[]
  lowStockProductsList: { warehouseCode: string; sku: string; name: string; onHandQuantity: number; reservedQuantity: number; availableQuantity: number }[]
  returnReasons: { reason: string; returns: number; requestedQuantity: number; normalQuantity: number; defectiveQuantity: number }[]
  monthlyFinance: { month: string; billedAmount: string; collectedAmount: string; outstandingAmount: string }[]
  topDebtors: { customerCode: string; customerName: string; billedAmount: string; collectedAmount: string; outstandingAmount: string }[]
}

type View = 'overview' | 'orders' | 'inventory' | 'returns' | 'finance'

const config = {
  orders: { label: '주문', color: '#2563eb' },
  shipments: { label: '출고', color: '#10b981' },
  grossSalesAmount: { label: '출고 매출', color: '#2563eb' },
  returnDeductionAmount: { label: '반품 차감', color: '#f97316' },
  netSalesAmount: { label: '순매출', color: '#0f766e' },
  reservedQuantity: { label: '예약', color: '#2563eb' },
  availableQuantity: { label: '가용', color: '#10b981' },
  requestedQuantity: { label: '요청', color: '#64748b' },
  normalQuantity: { label: '정상', color: '#10b981' },
  defectiveQuantity: { label: '불량', color: '#ef4444' },
  billedAmount: { label: '청구', color: '#2563eb' },
  collectedAmount: { label: '수금', color: '#10b981' },
  outstandingAmount: { label: '미수', color: '#f97316' },
  shippedQuantity: { label: '출고 수량', color: '#2563eb' },
} satisfies ChartConfig

const moneyAxis = (value: number) => value >= 1000000 ? `${Math.round(value / 1000000)}백만` : value >= 10000 ? `${Math.round(value / 10000)}만` : String(value)
const shortDate = (value: string) => value.slice(5).replace('-', '.')
const numeric = <T extends object>(items: T[], keys: (keyof T)[]) => items.map(item => {
  const copy = { ...item } as T
  for (const key of keys) copy[key] = Number(item[key]) as T[keyof T]
  return copy
})

export function AdminAnalyticsPanel({ view, defaultDays = 30 }: { view: View; defaultDays?: 7 | 30 | 90 }) {
  const [days, setDays] = useState<7 | 30 | 90>(defaultDays)
  const [data, setData] = useState<AdminAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => setDays(defaultDays), [defaultDays])
  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/admin/dashboard?days=${days}`, { credentials: 'same-origin' })
    setData(response.ok ? await response.json() as AdminAnalytics : null)
    setLoading(false)
  }, [days])
  useEffect(() => { void load() }, [load])

  return <section className="space-y-3" aria-label="업무 통계">
    <div className="flex items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">업무 분석</h2><p className="text-xs text-muted-foreground">전체 업무 데이터를 같은 기간 기준으로 집계합니다.</p></div>
      {view !== 'overview' && <div className="flex items-center gap-2">
        <label className="relative"><CalendarDaysIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"/><select className="h-8 rounded-md border border-input bg-background pl-8 pr-7 text-xs" aria-label="통계 기간" value={days} onChange={event => setDays(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="통계 새로고침"><RefreshCwIcon className={loading ? 'animate-spin' : ''}/></Button>
      </div>}
    </div>
    {!data ? <Card><CardContent className="grid h-52 place-items-center text-sm text-muted-foreground">통계를 불러오는 중입니다.</CardContent></Card> : <Charts view={view} data={data}/>} 
  </section>
}

function Charts({ view, data }: { view: View; data: AdminAnalytics }) {
  const daily = numeric(data.daily, ['grossSalesAmount', 'returnDeductionAmount', 'netSalesAmount'])
  const finance = numeric(data.monthlyFinance, ['billedAmount', 'collectedAmount', 'outstandingAmount'])
  const products = data.topProducts
  const debtors = numeric(data.topDebtors, ['billedAmount', 'collectedAmount', 'outstandingAmount'])
  if (view === 'orders') return <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><ChartCard title="일별 주문과 출고" description="접수량과 실제 출고 건수의 흐름입니다."><ChartContainer config={config} className="h-64 w-full"><AreaChart data={daily} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28}/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Area dataKey="orders" type="monotone" fill="var(--color-orders)" fillOpacity={0.16} stroke="var(--color-orders)"/><Area dataKey="shipments" type="monotone" fill="var(--color-shipments)" fillOpacity={0.12} stroke="var(--color-shipments)"/></AreaChart></ChartContainer></ChartCard><ProductChart data={products}/></div>
  if (view === 'inventory') return <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]"><ChartCard title="창고별 재고 구성" description="예약 재고와 즉시 출고 가능한 수량을 비교합니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={data.inventoryByWarehouse} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="warehouseCode"/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="reservedQuantity" stackId="stock" fill="var(--color-reservedQuantity)" radius={[0,0,3,3]}/><Bar dataKey="availableQuantity" stackId="stock" fill="var(--color-availableQuantity)" radius={[3,3,0,0]}/></BarChart></ChartContainer></ChartCard><ChartCard title="가용 재고 위험 품목" description="가용 수량이 적은 품목부터 표시합니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={data.lowStockProductsList} layout="vertical" accessibilityLayer margin={{left:8}}><CartesianGrid horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="sku" width={76}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="availableQuantity" fill="var(--color-availableQuantity)" radius={3}/></BarChart></ChartContainer></ChartCard></div>
  if (view === 'returns') return <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]"><ChartCard title="반품 사유별 판정" description="요청 수량 중 정상 복귀와 불량 처리 수량을 비교합니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={data.returnReasons} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="reason" tickFormatter={value => String(value).slice(0,8)}/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="normalQuantity" stackId="return" fill="var(--color-normalQuantity)"/><Bar dataKey="defectiveQuantity" stackId="return" fill="var(--color-defectiveQuantity)" radius={[3,3,0,0]}/></BarChart></ChartContainer></ChartCard><ChartCard title="반품 요청량" description="사유별 전체 요청 수량입니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={data.returnReasons} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="reason" width={96} tickFormatter={value => String(value).slice(0,8)}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="requestedQuantity" fill="var(--color-requestedQuantity)" radius={3}/></BarChart></ChartContainer></ChartCard></div>
  if (view === 'finance') return <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><ChartCard title="월별 청구·수금·미수" description="최근 6개월 확정 정산의 회수 흐름입니다."><ChartContainer config={config} className="h-64 w-full"><ComposedChart data={finance} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="month"/><YAxis tickFormatter={moneyAxis}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="billedAmount" fill="var(--color-billedAmount)" fillOpacity={0.22} radius={3}/><Line dataKey="collectedAmount" stroke="var(--color-collectedAmount)" strokeWidth={2}/><Line dataKey="outstandingAmount" stroke="var(--color-outstandingAmount)" strokeWidth={2}/></ComposedChart></ChartContainer></ChartCard><ChartCard title="거래처별 미수 순위" description="회수 우선순위를 미수 잔액 기준으로 정렬합니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={debtors} layout="vertical" accessibilityLayer margin={{left:8}}><CartesianGrid horizontal={false}/><XAxis type="number" tickFormatter={moneyAxis}/><YAxis type="category" dataKey="customerCode" width={72}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="outstandingAmount" fill="var(--color-outstandingAmount)" radius={3}/></BarChart></ChartContainer></ChartCard></div>
  return <div className="grid gap-4 xl:grid-cols-2"><ChartCard title="일별 순매출 흐름" description="출고 매출과 반품 차감을 함께 반영합니다."><ChartContainer config={config} className="h-64 w-full"><ComposedChart data={daily} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28}/><YAxis tickFormatter={moneyAxis}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="returnDeductionAmount" fill="var(--color-returnDeductionAmount)" fillOpacity={0.35}/><Area dataKey="grossSalesAmount" type="monotone" fill="var(--color-grossSalesAmount)" fillOpacity={0.12} stroke="var(--color-grossSalesAmount)"/><Line dataKey="netSalesAmount" stroke="var(--color-netSalesAmount)" strokeWidth={2}/></ComposedChart></ChartContainer></ChartCard><ProductChart data={products}/></div>
}

function ProductChart({ data }: { data: AdminAnalytics['topProducts'] }) { return <ChartCard title="상품별 출고 순위" description="기간 내 실제 출고 수량 기준 상위 품목입니다."><ChartContainer config={config} className="h-64 w-full"><BarChart data={data} layout="vertical" accessibilityLayer margin={{left:8}}><CartesianGrid horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="sku" width={76}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="shippedQuantity" fill="var(--color-shippedQuantity)" radius={3}/></BarChart></ChartContainer></ChartCard> }
function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card> }
