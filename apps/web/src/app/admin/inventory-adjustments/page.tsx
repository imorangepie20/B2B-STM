"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import { RefreshCwIcon, SearchIcon } from "lucide-react"
import { OrderPagination, type PageMetadata } from "@/components/orders/order-pagination"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { AdminAnalyticsPanel } from "@/components/analytics/admin-analytics"
import { ExportButtons } from "@/components/export-buttons"

type Inventory = { warehouseId: string; productId: string; warehouseCode: string; sku: string; name: string; saleUnit: string; onHandQuantity: number; reservedQuantity: number; availableQuantity: number }
const fieldClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
async function csrf() { const response = await fetch("/api/auth/csrf", { credentials: "same-origin" }); if (!response.ok) throw new Error("보안 토큰을 준비할 수 없습니다."); return (await response.json() as { csrfToken: string }).csrfToken }

export default function InventoryAdjustmentsPage() {
  const [inventory, setInventory] = useState<Inventory[]>([])
  const [selected, setSelected] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [appliedSearch, setAppliedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [metadata, setMetadata] = useState<PageMetadata>({ page: 1, pageSize: 50, total: 0, totalPages: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    const parameters = new URLSearchParams({ page: String(page), pageSize: "50" })
    if (appliedSearch) parameters.set("query", appliedSearch)
    const response = await fetch(`/api/admin/inventory?${parameters}`, { credentials: "same-origin" })
    if (!response.ok) { setMessage("MFA 인증을 마친 관리자 권한이 필요합니다."); setLoading(false); return }
    const result = await response.json() as PageMetadata & { items: Inventory[] }
    if (result.totalPages > 0 && page > result.totalPages) { setPage(result.totalPages); return }
    setInventory(result.items)
    setMetadata(result)
    const keys = new Set(result.items.map(item => `${item.warehouseId}:${item.productId}`))
    setSelected(current => keys.has(current) ? current : `${result.items[0]?.warehouseId ?? ""}:${result.items[0]?.productId ?? ""}`)
    setLoading(false)
  }, [appliedSearch, page])

  useEffect(() => { void load() }, [load])
  useEffect(() => { const timer = setTimeout(() => { setAppliedSearch(search.trim()); setPage(1) }, 300); return () => clearTimeout(timer) }, [search])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const formElement = event.currentTarget as HTMLFormElement
    const target = inventory.find(item => `${item.warehouseId}:${item.productId}` === selected)
    const form = new FormData(formElement)
    const quantityDelta = Number(form.get("quantityDelta"))
    const reason = String(form.get("reason") ?? "").trim()
    if (!target || !Number.isInteger(quantityDelta) || !quantityDelta || !reason) return setMessage("재고 항목, 증감 수량, 사유를 입력해 주세요.")
    setBusy(true); setMessage("")
    try {
      const response = await fetch("/api/admin/inventory/adjustments", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID(), warehouseId: target.warehouseId, productId: target.productId, quantityDelta, reason }) })
      if (!response.ok) throw new Error("예약수량보다 보유수량이 적어지는 정정은 할 수 없습니다.")
      const result = await response.json() as { onHandQuantity: number }
      formElement.reset(); setMessage(`재고를 정정했습니다. 현재 보유수량은 ${result.onHandQuantity}입니다.`); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : "재고 정정에 실패했습니다.") }
    finally { setBusy(false) }
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">재고 정정</h1><p className="mt-1 text-sm text-muted-foreground">실사 차이·파손 등 수량 증감 사유를 기록합니다.</p></div><div className="flex flex-wrap gap-2"><ExportButtons dataset="inventory" filters={{ query: appliedSearch }} /><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCwIcon className={loading ? "animate-spin" : ""}/>새로고침</Button></div></div>
    {message && <div role="status" className="rounded-md border bg-muted/50 px-4 py-3 text-sm">{message}</div>}
    <Card><CardContent className="py-3"><label className="relative block"><SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="창고, SKU, 상품명 검색" aria-label="재고 검색"/></label></CardContent></Card>
    <AdminAnalyticsPanel view="inventory" />

    <OrderPagination metadata={metadata} loading={loading} onPageChange={setPage}/>
    <Card className="max-w-3xl"><CardHeader><CardTitle>정정 내역 입력</CardTitle><CardDescription>검색 결과 {metadata.total.toLocaleString("ko-KR")}건 · 수량과 사유는 재고 원장에 함께 기록됩니다.</CardDescription></CardHeader><CardContent><form className="grid gap-5" onSubmit={submit}><label className="grid gap-2 text-sm font-medium">재고 항목<select className={fieldClass} value={selected} onChange={event => setSelected(event.target.value)} required disabled={!inventory.length}>{inventory.map(item => <option value={`${item.warehouseId}:${item.productId}`} key={`${item.warehouseId}:${item.productId}`}>{item.warehouseCode} · {item.sku} · {item.name} · 보유 {item.onHandQuantity} / 예약 {item.reservedQuantity}</option>)}</select></label><label className="grid gap-2 text-sm font-medium">증감 수량<Input name="quantityDelta" type="number" step="1" inputMode="numeric" placeholder="예: -2 또는 5" required /></label><label className="grid gap-2 text-sm font-medium">정정 사유<Input name="reason" maxLength={300} placeholder="예: 파손 수량 확인" required /></label><div className="flex justify-end"><Button type="submit" disabled={busy || !inventory.length}>{busy ? "정정 중…" : "재고 정정 확정"}</Button></div></form></CardContent></Card>
  </div>
}
