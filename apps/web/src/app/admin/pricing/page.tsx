"use client"

import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react"
import { Building2Icon, PackageIcon, RefreshCwIcon, StoreIcon, TagsIcon, WarehouseIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Item = { id: string; code?: string; sku?: string; name: string; saleUnit?: string; paymentDueDay?: number }
type Catalog = { customers: Item[]; suppliers: Item[]; warehouses: Item[]; products: Item[] }
type Price = {
  customerId: string
  customerCode: string
  customerName: string
  productId: string
  sku: string
  productName: string
  saleUnit: string
  unitPrice: string
  taxCategory: "taxable" | "exempt"
  taxRateBps: number
  paymentDueDay: number
  active: boolean
  updatedAt: string
}

const control = "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

async function csrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" })
  return (await response.json() as { csrfToken: string }).csrfToken
}

async function post(path: string, body: object) {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
    body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
  })
}

export default function PricingPage() {
  const [catalog, setCatalog] = useState<Catalog>({ customers: [], suppliers: [], warehouses: [], products: [] })
  const [prices, setPrices] = useState<Price[]>([])
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [catalogResponse, pricesResponse] = await Promise.all([
      fetch("/api/admin/catalog", { credentials: "same-origin" }),
      fetch("/api/admin/catalog/customer-prices", { credentials: "same-origin" }),
    ])
    if (!catalogResponse.ok || !pricesResponse.ok) {
      setMessage("기준정보를 불러오지 못했습니다.")
      setLoading(false)
      return
    }
    setCatalog(await catalogResponse.json() as Catalog)
    setPrices(await pricesResponse.json() as Price[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const createCatalog = async (event: FormEvent<HTMLFormElement>, kind: "customers" | "suppliers" | "warehouses" | "products", success: string) => {
    event.preventDefault()
    const form = event.currentTarget
    const response = await post(`/api/admin/catalog/${kind}`, Object.fromEntries(new FormData(form)))
    setMessage(response.ok ? `${success} 등록했습니다.` : `${success} 등록에 실패했습니다. 코드와 입력값을 확인해 주세요.`)
    if (response.ok) {
      form.reset()
      await load()
    }
  }

  const savePrice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const response = await post("/api/admin/catalog/customer-prices", {
      customerId: form.get("customerId"),
      productId: form.get("productId"),
      unitPrice: Number(form.get("unitPrice")),
      taxCategory: form.get("taxCategory"),
      taxRateBps: form.get("taxCategory") === "exempt" ? 0 : Number(form.get("taxRateBps")),
    })
    setMessage(response.ok ? "단가를 저장했습니다." : "단가를 저장하지 못했습니다.")
    if (response.ok) {
      formElement.reset()
      await load()
    }
  }

  const updateCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await post(`/api/admin/catalog/customers/${form.get("customerId")}`, { name: form.get("name"), paymentDueDay: Number(form.get("paymentDueDay")) })
    setMessage(response.ok ? "거래처명과 지급 기한을 수정했습니다." : "거래처 정보를 수정하지 못했습니다.")
    if (response.ok) await load()
  }

  const updateProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await post(`/api/admin/catalog/products/${form.get("productId")}`, { name: form.get("name"), saleUnit: form.get("saleUnit") })
    setMessage(response.ok ? "상품 정보를 수정했습니다." : "상품 정보를 수정하지 못했습니다.")
    if (response.ok) await load()
  }

  const deactivate = async (price: Price) => {
    const response = await post("/api/admin/catalog/customer-prices/deactivate", { customerId: price.customerId, productId: price.productId })
    setMessage(response.ok ? "단가를 비활성화했습니다." : "단가를 비활성화하지 못했습니다.")
    if (response.ok) await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">기준정보 · 단가</h1>
          <p className="mt-1 text-sm text-muted-foreground">거래처·공급처·창고·상품을 등록하고 거래처별 판매 단가를 관리합니다.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon className={loading ? "animate-spin" : ""} />새로고침
        </Button>
      </div>

      {message && <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="기준정보 현황">
        <SummaryCard label="거래처" value={catalog.customers.length} icon={StoreIcon} />
        <SummaryCard label="공급처" value={catalog.suppliers.length} icon={Building2Icon} />
        <SummaryCard label="창고" value={catalog.warehouses.length} icon={WarehouseIcon} />
        <SummaryCard label="상품" value={catalog.products.length} icon={PackageIcon} />
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold">기준정보 등록</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">업무에서 사용할 식별 코드와 명칭을 등록합니다. 코드는 등록 후 중복 사용할 수 없습니다.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <CompactForm title="거래처 등록" description="주문 및 정산 대상" onSubmit={event => void createCatalog(event, "customers", "거래처")}>
            <Input name="code" required placeholder="거래처 코드" />
            <Input name="name" required placeholder="거래처명" />
            <Input name="paymentDueDay" type="number" min="1" max="31" defaultValue="10" required aria-label="익월 지급일" />
            <Button type="submit">거래처 등록</Button>
          </CompactForm>
          <CompactForm title="공급처 등록" description="상품 입고 공급처" onSubmit={event => void createCatalog(event, "suppliers", "공급처")}>
            <Input name="code" required placeholder="공급처 코드" />
            <Input name="name" required placeholder="공급처명" />
            <Button type="submit">공급처 등록</Button>
          </CompactForm>
          <CompactForm title="창고 등록" description="재고 보관 위치" onSubmit={event => void createCatalog(event, "warehouses", "창고")}>
            <Input name="code" required placeholder="창고 코드" />
            <Input name="name" required placeholder="창고명" />
            <Button type="submit">창고 등록</Button>
          </CompactForm>
          <CompactForm title="상품 등록" description="주문 및 재고 품목" onSubmit={event => void createCatalog(event, "products", "상품")}>
            <Input name="sku" required placeholder="SKU" />
            <Input name="name" required placeholder="상품명" />
            <Input name="saleUnit" required placeholder="판매 단위 (예: BOX)" />
            <Button type="submit">상품 등록</Button>
          </CompactForm>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold">정보 수정 · 판매 단가</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">단가 변경값은 새 주문부터 적용되며 접수된 주문의 단가는 보존됩니다.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <CompactForm title="거래처 정보 수정" onSubmit={updateCustomer}>
            <select aria-label="수정할 거래처" className={control} name="customerId" required defaultValue="">
              <option value="" disabled>거래처 선택</option>
              {catalog.customers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
            <Input name="name" required placeholder="새 거래처명" />
            <Input name="paymentDueDay" type="number" min="1" max="31" defaultValue="10" required placeholder="익월 지급일" />
            <Button type="submit" variant="outline">거래처 정보 수정</Button>
          </CompactForm>
          <CompactForm title="상품 정보 수정" onSubmit={updateProduct}>
            <select aria-label="수정할 상품" className={control} name="productId" required defaultValue="">
              <option value="" disabled>상품 선택</option>
              {catalog.products.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
            </select>
            <div className="grid grid-cols-[1fr_0.55fr] gap-2">
              <Input name="name" required placeholder="새 상품명" />
              <Input name="saleUnit" required placeholder="판매 단위" />
            </div>
            <Button type="submit" variant="outline">상품 정보 수정</Button>
          </CompactForm>
          <CompactForm title="거래처 단가 저장" onSubmit={savePrice}>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="단가 거래처" className={control} name="customerId" required defaultValue="">
                <option value="" disabled>거래처 선택</option>
                {catalog.customers.map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
              <select aria-label="단가 상품" className={control} name="productId" required defaultValue="">
                <option value="" disabled>상품 선택</option>
                {catalog.products.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
              </select>
            </div>
            <Input name="unitPrice" type="number" min="0" required placeholder="판매 단가 (원)" />
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="과세 구분" className={control} name="taxCategory" required defaultValue="taxable">
                <option value="taxable">과세</option><option value="exempt">면세</option>
              </select>
              <Input name="taxRateBps" type="number" min="1" max="10000" defaultValue="1000" required aria-label="세율 만분율" />
            </div>
            <Button type="submit"><TagsIcon />단가 저장</Button>
          </CompactForm>
        </div>
      </section>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>거래처 단가 목록</CardTitle>
          <CardDescription>활성 단가와 이전에 비활성화한 단가 상태를 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>거래처</TableHead>
                <TableHead>상품</TableHead>
                <TableHead>판매 단위</TableHead>
                <TableHead className="text-right">단가</TableHead>
                <TableHead>세금</TableHead>
                <TableHead>지급 조건</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.map(price => (
                <TableRow key={`${price.customerId}-${price.productId}`}>
                  <TableCell><b>{price.customerCode}</b><span className="ml-2 text-muted-foreground">{price.customerName}</span></TableCell>
                  <TableCell><b>{price.sku}</b><span className="ml-2 text-muted-foreground">{price.productName}</span></TableCell>
                  <TableCell>{price.saleUnit}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{Number(price.unitPrice).toLocaleString("ko-KR")}원</TableCell>
                  <TableCell>{price.taxCategory === "exempt" ? "면세" : `과세 ${(price.taxRateBps / 100).toLocaleString("ko-KR")}%`}</TableCell>
                  <TableCell>익월 {price.paymentDueDay}일</TableCell>
                  <TableCell><Badge variant={price.active ? "secondary" : "outline"}>{price.active ? "활성" : "비활성"}</Badge></TableCell>
                  <TableCell>{price.active && <Button size="sm" variant="outline" onClick={() => void deactivate(price)}>비활성화</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!prices.length && <p className="py-10 text-center text-sm text-muted-foreground">등록된 거래처 단가가 없습니다.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof StoreIcon }) {
  return (
    <Card size="sm">
      <CardHeader className="grid grid-cols-[1fr_auto]">
        <CardDescription>{label}</CardDescription>
        <span className="row-span-2 grid size-7 place-items-center rounded-md bg-muted text-muted-foreground"><Icon className="size-3.5" /></span>
        <CardTitle className="mt-1 text-2xl tabular-nums">{value.toLocaleString("ko-KR")} <span className="text-sm font-normal text-muted-foreground">개</span></CardTitle>
      </CardHeader>
    </Card>
  )
}

function CompactForm({ title, description, onSubmit, children }: { title: string; description?: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form className="grid gap-2" onSubmit={onSubmit}>{children}</form>
      </CardContent>
    </Card>
  )
}
