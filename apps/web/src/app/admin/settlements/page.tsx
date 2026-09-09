"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import { PrinterIcon, RefreshCwIcon } from "lucide-react"
import { AdminAnalyticsPanel } from "@/components/analytics/admin-analytics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButtons } from "@/components/export-buttons"

type Customer = { id: string; code: string; name: string }
type Settlement = { id: string; customerId: string; customerCode: string; customerName: string; period: string; status: string; supplyAmount: string; taxAmount: string; totalAmount: string; allocatedAmount: string; dueDate: string | null }
type Line = { id: string; entryType: string; businessDate: string; sku: string; productName: string; quantity: number; unitPrice: string; supplyAmount: string; taxAmount: string; amount: string; taxCategory: string; taxRateBps: number }
type Detail = Omit<Settlement, "allocatedAmount"> & { paymentDueDay: number; finalizedAt: string | null; lines: Line[] }

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const won = (value: string | number) => `${Number(value).toLocaleString("ko-KR")}원`
const date = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR").format(new Date(`${value}T00:00:00+09:00`)) : "마감 전"

export default function SettlementsPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [customerId, setCustomerId] = useState("")
  const [period, setPeriod] = useState("")
  const [message, setMessage] = useState("")

  const load = useCallback(async (filterCustomerId = customerId, filterPeriod = period) => {
    const params = new URLSearchParams()
    if (filterCustomerId) params.set("customerId", filterCustomerId)
    if (filterPeriod) params.set("period", filterPeriod)
    const [catalogResponse, settlementResponse] = await Promise.all([
      fetch("/api/admin/catalog", { credentials: "same-origin" }),
      fetch(`/api/admin/settlements?${params}`, { credentials: "same-origin" }),
    ])
    if (!catalogResponse.ok || !settlementResponse.ok) return setMessage("정산 정보를 불러오지 못했습니다.")
    setCustomers((await catalogResponse.json() as { customers: Customer[] }).customers)
    setSettlements(await settlementResponse.json() as Settlement[])
  }, [customerId, period])

  useEffect(() => { void load() }, [load])
  const filter = (event: FormEvent) => { event.preventDefault(); void load() }
  const openDetail = async (id: string) => {
    const response = await fetch(`/api/admin/settlements/${id}`, { credentials: "same-origin" })
    if (!response.ok) return setMessage("거래명세서를 불러오지 못했습니다.")
    setDetail(await response.json() as Detail)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">정산 조회 · 거래명세서</h1><p className="mt-1 text-sm text-muted-foreground">공급가액, 부가세, 지급 기한과 입금 배분 상태를 확인합니다.</p></div>
        <div className="flex flex-wrap gap-2"><ExportButtons dataset="settlements" filters={{ customerId, period }} /><Button variant="outline" onClick={() => void load()}><RefreshCwIcon />새로고침</Button></div>
      </div>
      {message && <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">{message}</div>}
      <AdminAnalyticsPanel view="finance" />
      <Card className="print:hidden"><CardContent className="pt-6"><form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={filter}><label className="grid flex-1 gap-2 text-sm font-medium">거래처<select className={selectClass} value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">전체 거래처</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label><label className="grid gap-2 text-sm font-medium">정산월<Input type="month" value={period} onChange={event => setPeriod(event.target.value)} /></label><Button type="submit">필터 적용</Button></form></CardContent></Card>
      <Card className="print:hidden"><CardHeader><CardTitle>정산 목록</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>정산월</TableHead><TableHead>거래처</TableHead><TableHead className="text-right">공급가액</TableHead><TableHead className="text-right">세액</TableHead><TableHead className="text-right">합계</TableHead><TableHead>지급 기한</TableHead><TableHead>상태</TableHead><TableHead /></TableRow></TableHeader><TableBody>{settlements.map(item => <TableRow key={item.id}><TableCell>{item.period}</TableCell><TableCell><b>{item.customerCode}</b><span className="ml-2 text-muted-foreground">{item.customerName}</span></TableCell><TableCell className="text-right">{won(item.supplyAmount)}</TableCell><TableCell className="text-right">{won(item.taxAmount)}</TableCell><TableCell className="text-right font-medium">{won(item.totalAmount)}</TableCell><TableCell>{date(item.dueDate)}</TableCell><TableCell><Badge variant="secondary">{item.status}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void openDetail(item.id)}>명세서</Button></TableCell></TableRow>)}</TableBody></Table>{!settlements.length && <p className="py-12 text-center text-sm text-muted-foreground">조건에 맞는 정산이 없습니다.</p>}</CardContent></Card>
      {detail && <Statement detail={detail} />}
    </div>
  )
}

function Statement({ detail }: { detail: Detail }) {
  return <Card id="transaction-statement" className="print:border-0 print:shadow-none"><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium tracking-[0.16em] text-muted-foreground">STM · TRANSACTION STATEMENT</p><CardTitle className="mt-2 text-xl">거래명세서</CardTitle><p className="mt-1 text-sm text-muted-foreground">{detail.customerCode} · {detail.customerName} · {detail.period}</p></div><Button className="print:hidden" variant="outline" onClick={() => window.print()}><PrinterIcon />인쇄</Button></div></CardHeader><CardContent className="space-y-5 pt-6"><div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border md:grid-cols-4"><Summary label="공급가액" value={won(detail.supplyAmount)} /><Summary label="부가세" value={won(detail.taxAmount)} /><Summary label="청구 합계" value={won(detail.totalAmount)} /><Summary label="지급 기한" value={date(detail.dueDate)} /></div><Table><TableHeader><TableRow><TableHead>거래일</TableHead><TableHead>구분</TableHead><TableHead>품목</TableHead><TableHead className="text-right">수량 × 단가</TableHead><TableHead className="text-right">공급가액</TableHead><TableHead className="text-right">세액</TableHead><TableHead className="text-right">합계</TableHead></TableRow></TableHeader><TableBody>{detail.lines.map(line => <TableRow key={line.id}><TableCell>{String(line.businessDate).slice(0, 10)}</TableCell><TableCell>{line.entryType === "shipment" ? "출고" : line.entryType === "return_credit" ? "반품 차감" : "환불 조정"}</TableCell><TableCell><b>{line.sku}</b><span className="ml-2 text-muted-foreground">{line.productName}</span><span className="block text-xs text-muted-foreground">{line.taxCategory === "exempt" ? "면세" : `과세 ${line.taxRateBps / 100}%`}</span></TableCell><TableCell className="text-right tabular-nums">{line.quantity} × {won(line.unitPrice)}</TableCell><TableCell className="text-right">{won(line.supplyAmount)}</TableCell><TableCell className="text-right">{won(line.taxAmount)}</TableCell><TableCell className="text-right font-medium">{won(line.amount)}</TableCell></TableRow>)}</TableBody></Table><p className="text-xs text-muted-foreground">지급 조건: 익월 {detail.paymentDueDay}일. 해당 일이 없는 달은 말일이며 휴일 자동 이동은 적용하지 않습니다.</p></CardContent></Card>
}

function Summary({ label, value }: { label: string; value: string }) { return <div className="bg-background p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="mt-1 block tabular-nums">{value}</strong></div> }
