'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PaperclipIcon, RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type ShipmentLine = { shipmentLineId: string; shipmentId: string; sku: string; productName: string; shippedQuantity: number; requestedQuantity: number };

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('보안 토큰을 준비할 수 없습니다.');
  return (await response.json() as { csrfToken: string }).csrfToken;
}

export default function CustomerReturnsPage() {
  const [lines, setLines] = useState<ShipmentLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<File | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/returns/shipment-lines', { credentials: 'same-origin' });
    if (!response.ok) { setMessage('출고 이력을 불러오지 못했습니다. 다시 로그인해 주세요.'); return; }
    setLines(await response.json() as ShipmentLine[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    const selected = lines.map(line => ({ shipmentLineId: line.shipmentLineId, quantity: Number(quantities[line.shipmentLineId] || 0), reason: (reasons[line.shipmentLineId] || '').trim(), shipmentId: line.shipmentId })).filter(line => Number.isInteger(line.quantity) && line.quantity > 0);
    if (!selected.length) { setMessage('반품할 품목과 수량을 입력해 주세요.'); return; }
    if (new Set(selected.map(line => line.shipmentId)).size !== 1) { setMessage('한 번의 요청에는 같은 출고 건의 품목만 선택할 수 있습니다.'); return; }
    if (selected.some(line => !line.reason)) { setMessage('각 반품 품목의 사유를 입력해 주세요.'); return; }
    setBusy(true);
    try {
      if (evidence && (!["image/jpeg","image/png","application/pdf"].includes(evidence.type) || evidence.size > 10 * 1024 * 1024)) throw new Error('증빙은 JPEG·PNG·PDF 파일당 최대 10MB입니다.');
      const response = await fetch('/api/returns', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() }, body: JSON.stringify({ requestId: crypto.randomUUID(), lines: selected.map(({ shipmentLineId, quantity, reason }) => ({ shipmentLineId, quantity, reason })) }) });
      if (!response.ok) throw new Error('반품 요청을 접수하지 못했습니다. 이미 요청한 수량을 확인해 주세요.');
      const result = await response.json() as { id: string };
      let attachmentFailed = false;
      if (evidence) { const upload = await fetch(`/api/attachments/return/${result.id}?filename=${encodeURIComponent(evidence.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': evidence.type, 'x-csrf-token': await csrf() }, body: evidence }); attachmentFailed = !upload.ok; }
      setQuantities({}); setReasons({}); setEvidence(null); setMessage(attachmentFailed ? '반품 요청은 접수됐지만 증빙 첨부에 실패했습니다. 창고 담당자에게 전달해 주세요.' : '반품 요청과 증빙이 접수되었습니다. 창고 검수 후 정상 수량만 재고로 복귀합니다.'); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '반품 요청을 접수하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">반품 요청</h1><p className="mt-1 text-sm text-muted-foreground">실제 출고된 품목만 요청할 수 있으며 창고 검수 전에는 재고와 정산이 바뀌지 않습니다.</p></div><Button type="button" variant="outline" onClick={() => void load()}><RefreshCwIcon/>이력 새로고침</Button></div>{message && <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm" role="status">{message}</div>}<form className="space-y-4" onSubmit={submit}><Card><CardHeader><CardTitle>출고 품목 이력</CardTitle></CardHeader><CardContent className="p-0"><div className="divide-y">{lines.map(line => { const remaining = line.shippedQuantity - line.requestedQuantity; return <div className="grid gap-4 px-6 py-4 lg:grid-cols-[1fr_120px_280px] lg:items-end" key={line.shipmentLineId}><div><span className="text-xs text-muted-foreground">출고 {line.shipmentId.slice(0, 8)}</span><strong className="mt-1 block text-sm">{line.sku} · {line.productName}</strong><span className="mt-1 block text-xs text-muted-foreground">출고 {line.shippedQuantity} · 요청 가능 {remaining}</span></div><label className="grid gap-2 text-sm font-medium">수량<Input aria-label={`${line.productName} 반품 수량`} type="number" min="0" max={remaining} step="1" inputMode="numeric" disabled={remaining === 0} value={quantities[line.shipmentLineId] || ''} onChange={event => setQuantities(current => ({ ...current, [line.shipmentLineId]: event.target.value }))} placeholder="0" /></label><label className="grid gap-2 text-sm font-medium">사유<Input aria-label={`${line.productName} 반품 사유`} disabled={remaining === 0} value={reasons[line.shipmentLineId] || ''} onChange={event => setReasons(current => ({ ...current, [line.shipmentLineId]: event.target.value }))} placeholder="예: 파손" /></label></div> })}{!lines.length && <p className="py-12 text-center text-sm text-muted-foreground">반품을 요청할 출고 품목이 없습니다.</p>}</div></CardContent></Card><Card><CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><PaperclipIcon className="size-5 text-muted-foreground"/><label className="grid flex-1 gap-1 text-sm font-medium">반품 증빙 <span className="text-xs font-normal text-muted-foreground">선택 사항 · JPEG·PNG·PDF, 최대 10MB</span><Input type="file" accept="image/jpeg,image/png,application/pdf" onChange={event => setEvidence(event.target.files?.[0] ?? null)}/></label></CardContent></Card><div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-4 backdrop-blur"><Button type="submit" size="lg" disabled={busy || !lines.length}>{busy ? '반품 요청 접수 중…' : '반품 요청 접수'}</Button></div></form></div>;
}
