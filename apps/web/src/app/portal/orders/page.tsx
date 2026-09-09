'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Warehouse = { id: string; code: string; name: string };
type Product = { id: string; sku: string; name: string; saleUnit: string; warehouseId: string; availableQuantity: number };
type Catalog = { warehouses: Warehouse[]; products: Product[] };

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('보안 토큰을 준비할 수 없습니다.');
  return (await response.json() as { csrfToken: string }).csrfToken;
}

export default function CustomerOrdersPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog>({ warehouses: [], products: [] });
  const [warehouseId, setWarehouseId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch('/api/orders/catalog', { credentials: 'same-origin' });
    if (!response.ok) { setMessage('주문 가능한 상품을 불러올 수 없습니다. 다시 로그인해 주세요.'); return; }
    const result = await response.json() as Catalog;
    setCatalog(result); setWarehouseId(current => current || result.warehouses[0]?.id || '');
  }, []);
  useEffect(() => { void load(); }, [load]);
  const products = useMemo(() => catalog.products.filter(product => product.warehouseId === warehouseId), [catalog.products, warehouseId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    const lines = products.map(product => ({ productId: product.id, quantity: Number(quantities[product.id] || 0) })).filter(line => Number.isInteger(line.quantity) && line.quantity > 0);
    if (!warehouseId || !lines.length) { setMessage('주문할 상품의 수량을 하나 이상 입력해 주세요.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/orders', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID(), warehouseId, lines }) });
      if (!response.ok) throw new Error('주문 접수에 실패했습니다. 수량과 상품 상태를 확인해 주세요.');
      setQuantities({});
      router.push('/portal/orders/history');
    } catch (error) { setMessage(error instanceof Error ? error.message : '주문 접수에 실패했습니다.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">상품 주문</h1><p className="mt-1 text-sm text-muted-foreground">주문 접수 후 운영 담당자가 가용재고를 확인해 확정합니다.</p></div><Button type="button" variant="outline" onClick={() => void load()}><RefreshCwIcon/>상품 새로고침</Button></div>{message && <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm" role="status">{message}</div>}<form className="space-y-4" onSubmit={submit}><Card><CardContent className="pt-6"><label className="grid max-w-md gap-2 text-sm font-medium">출고 창고<select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setQuantities({}); }} required>{catalog.warehouses.map(warehouse => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label></CardContent></Card><Card><CardHeader><CardTitle>주문 상품</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y">{products.map(product => <label className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_120px] sm:items-center" key={product.id}><span><strong className="block text-sm">{product.sku} · {product.name}</strong><span className="mt-1 block text-xs text-muted-foreground">가용 {product.availableQuantity} {product.saleUnit}</span></span><Input aria-label={`${product.name} 주문 수량`} type="number" min="0" step="1" inputMode="numeric" value={quantities[product.id] || ''} onChange={event => setQuantities(current => ({ ...current, [product.id]: event.target.value }))} placeholder="0" /></label>)}{!products.length && <p className="py-12 text-center text-sm text-muted-foreground">이 창고에서 주문 가능한 상품이 없습니다.</p>}</div></CardContent></Card><div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-4 backdrop-blur"><Button type="submit" size="lg" disabled={busy || !products.length}>{busy ? '주문 접수 중…' : '주문 접수'}</Button></div></form></div>;
}
