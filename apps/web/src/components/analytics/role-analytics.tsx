'use client'

import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

type WarehouseData = {
  daily: { date: string; shipments: number; quantity: number }[]
  agingBuckets: { label: string; orders: number; quantity: number }[]
  customers: { customerCode: string; customerName: string; orders: number; quantity: number }[]
  returns: { reason: string; returns: number; requestedQuantity: number; receivedQuantity: number; normalQuantity: number; defectiveQuantity: number }[]
}
type CustomerData = {
  daily: { date: string; orders: number; netAmount: string }[]
  productSpend: { sku: string; name: string; quantity: number; amount: string }[]
  monthlyFinance: { month: string; ledgerAmount: string; paidAmount: string }[]
}

const config = {
  shipments: { label: '출고 건수', color: '#2563eb' }, quantity: { label: '수량', color: '#10b981' },
  orders: { label: '주문', color: '#2563eb' }, netAmount: { label: '순매입', color: '#0f766e' },
  requestedQuantity: { label: '요청', color: '#64748b' }, receivedQuantity: { label: '입고 검사', color: '#2563eb' },
  normalQuantity: { label: '정상', color: '#10b981' }, defectiveQuantity: { label: '불량', color: '#ef4444' },
  ledgerAmount: { label: '거래 원장', color: '#2563eb' }, paidAmount: { label: '결제 배분', color: '#10b981' },
  amount: { label: '금액', color: '#2563eb' },
} satisfies ChartConfig
const shortDate = (value: string) => value.slice(5).replace('-', '.')
const moneyAxis = (value: number) => value >= 1000000 ? `${Math.round(value/1000000)}백만` : value >= 10000 ? `${Math.round(value/10000)}만` : String(value)

export function WarehouseAnalyticsPanel({ view }: { view: 'shipments' | 'returns' }) {
  const [data,setData] = useState<WarehouseData | null>(null)
  useEffect(() => { void fetch('/api/warehouse/analytics?days=30',{credentials:'same-origin'}).then(async response => setData(response.ok ? await response.json() : null)) },[])
  if (!data) return null
  if (view === 'returns') return <AnalyticsGrid><ChartCard title="반품 사유별 검사 진행" description="최근 30일 요청 수량과 실제 입고 검사 수량입니다."><ChartContainer config={config} className="h-56 w-full"><BarChart data={data.returns} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="reason" tickFormatter={value=>String(value).slice(0,8)}/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="requestedQuantity" fill="var(--color-requestedQuantity)" fillOpacity={0.35}/><Bar dataKey="receivedQuantity" fill="var(--color-receivedQuantity)" radius={3}/></BarChart></ChartContainer></ChartCard><ChartCard title="검사 판정 구성" description="정상 재입고와 불량 격리 대상 수량을 비교합니다."><ChartContainer config={config} className="h-56 w-full"><BarChart data={data.returns} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="reason" width={92} tickFormatter={value=>String(value).slice(0,8)}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="normalQuantity" stackId="result" fill="var(--color-normalQuantity)"/><Bar dataKey="defectiveQuantity" stackId="result" fill="var(--color-defectiveQuantity)" radius={[0,3,3,0]}/></BarChart></ChartContainer></ChartCard></AnalyticsGrid>
  return <AnalyticsGrid><ChartCard title="일별 출고 처리량" description="최근 30일 출고 건수와 품목 수량 흐름입니다."><ChartContainer config={config} className="h-56 w-full"><AreaChart data={data.daily} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24}/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Area dataKey="quantity" fill="var(--color-quantity)" fillOpacity={0.14} stroke="var(--color-quantity)"/><Line dataKey="shipments" stroke="var(--color-shipments)"/></AreaChart></ChartContainer></ChartCard><ChartCard title="출고 대기 경과 시간" description="오래 대기한 주문부터 작업 우선순위를 정합니다."><ChartContainer config={config} className="h-56 w-full"><BarChart data={data.agingBuckets} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="label"/><YAxis allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="orders" fill="var(--color-shipments)" radius={3}/><Bar dataKey="quantity" fill="var(--color-quantity)" radius={3}/></BarChart></ChartContainer></ChartCard></AnalyticsGrid>
}

export function CustomerAnalyticsPanel({ view }: { view: 'orders' | 'finance' }) {
  const [data,setData] = useState<CustomerData | null>(null)
  useEffect(() => { void fetch('/api/analytics?days=30',{credentials:'same-origin'}).then(async response => setData(response.ok ? await response.json() : null)) },[])
  if (!data) return null
  const daily=data.daily.map(item=>({...item,netAmount:Number(item.netAmount)})), monthly=data.monthlyFinance.map(item=>({...item,ledgerAmount:Number(item.ledgerAmount),paidAmount:Number(item.paidAmount)})), products=data.productSpend.map(item=>({...item,amount:Number(item.amount)}))
  if(view==='finance') return <AnalyticsGrid><ChartCard title="월별 거래와 결제" description="최근 6개월 원장 금액과 결제 배분액입니다."><ChartContainer config={config} className="h-56 w-full"><ComposedChart data={monthly} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="month"/><YAxis tickFormatter={moneyAxis}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Bar dataKey="ledgerAmount" fill="var(--color-ledgerAmount)" fillOpacity={0.24} radius={3}/><Line dataKey="paidAmount" stroke="var(--color-paidAmount)" strokeWidth={2}/></ComposedChart></ChartContainer></ChartCard><ChartCard title="상품별 거래 금액" description="최근 30일 실제 출고 원장 기준 상위 품목입니다."><ChartContainer config={config} className="h-56 w-full"><BarChart data={products} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false}/><XAxis type="number" tickFormatter={moneyAxis}/><YAxis type="category" dataKey="sku" width={82}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="amount" fill="var(--color-amount)" radius={3}/></BarChart></ChartContainer></ChartCard></AnalyticsGrid>
  return <AnalyticsGrid><ChartCard title="일별 주문 흐름" description="최근 30일 주문 건수와 실제 거래 금액입니다."><ChartContainer config={config} className="h-56 w-full"><ComposedChart data={daily} accessibilityLayer><CartesianGrid vertical={false}/><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24}/><YAxis yAxisId="money" tickFormatter={moneyAxis}/><YAxis yAxisId="orders" orientation="right" allowDecimals={false}/><ChartTooltip content={<ChartTooltipContent/>}/><ChartLegend content={<ChartLegendContent/>}/><Area yAxisId="money" dataKey="netAmount" fill="var(--color-netAmount)" fillOpacity={0.14} stroke="var(--color-netAmount)"/><Line yAxisId="orders" dataKey="orders" stroke="var(--color-orders)" strokeWidth={2}/></ComposedChart></ChartContainer></ChartCard><ChartCard title="자주 구매한 상품" description="최근 30일 출고 수량이 높은 품목입니다."><ChartContainer config={config} className="h-56 w-full"><BarChart data={[...products].sort((a,b)=>b.quantity-a.quantity)} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false}/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="sku" width={82}/><ChartTooltip content={<ChartTooltipContent/>}/><Bar dataKey="quantity" fill="var(--color-quantity)" radius={3}/></BarChart></ChartContainer></ChartCard></AnalyticsGrid>
}

function AnalyticsGrid({children}:{children:React.ReactNode}){return <section className="grid gap-4 xl:grid-cols-2" aria-label="업무 분석">{children}</section>}
function ChartCard({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>}
