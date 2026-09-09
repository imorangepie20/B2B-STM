"use client"

import { ChangeEvent, useCallback, useEffect, useState } from "react"
import { AlertCircleIcon, CheckCircle2Icon, FileSpreadsheetIcon, FileUpIcon, RefreshCwIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type ImportRow = { rowNumber: number; recordType: string; key: string; result?: "created" | "skipped" }
type ImportError = { rowNumber: number; message: string }
type Preview = { filename: string; totalRows: number; createdRows: number; skippedRows: number; errors: ImportError[]; rows: ImportRow[] }
type Batch = { id: string; filename: string; status: string; totalRows: number; createdRows: number; skippedRows: number; createdAt: string }

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' })
  return (await response.json() as { csrfToken: string }).csrfToken
}

export default function InitialImportsPage() {
  const [file, setFile] = useState<{ filename: string; content: string } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [busy, setBusy] = useState<"preview" | "apply" | "">("")
  const [message, setMessage] = useState("")

  const loadBatches = useCallback(async () => {
    const response = await fetch('/api/admin/imports', { credentials: 'same-origin' })
    if (response.ok) setBatches(await response.json() as Batch[])
  }, [])
  useEffect(() => { void loadBatches() }, [loadBatches])

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    setPreview(null); setMessage("")
    if (!selected) return setFile(null)
    if (selected.size > 1024 * 1024) { setFile(null); return setMessage('CSV 파일은 1MiB 이하여야 합니다.') }
    setFile({ filename: selected.name, content: await selected.text() })
  }

  async function request(path: 'preview' | 'apply') {
    if (!file) return
    setBusy(path); setMessage("")
    try {
      const response = await fetch(`/api/admin/imports/${path}`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify(file),
      })
      const result = await response.json()
      if (!response.ok) {
        if (Array.isArray(result?.errors)) setPreview({ filename: file.filename, totalRows: 0, createdRows: 0, skippedRows: 0, rows: [], errors: result.errors })
        throw new Error(result?.message === 'CSV validation failed' ? '오류 행을 수정한 뒤 다시 미리보기 해주세요.' : '파일 형식과 관리자 권한을 확인해 주세요.')
      }
      if (path === 'preview') {
        setPreview(result as Preview)
        setMessage(result.errors.length ? '오류 행이 있어 반영할 수 없습니다.' : '미리보기가 완료되었습니다. 생성·건너뜀 수량을 확인해 주세요.')
      } else {
        setMessage(result.duplicate ? '이미 반영된 같은 파일입니다. 데이터는 추가되지 않았습니다.' : `${result.createdRows}개 행을 반영했습니다.`)
        setPreview(null); setFile(null); await loadBatches()
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '이관 요청을 처리하지 못했습니다.') }
    finally { setBusy("") }
  }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-semibold tracking-tight">초기 데이터 이관</h1><p className="mt-1 text-sm text-muted-foreground">거래처·상품·단가·초기 재고 CSV를 검증한 뒤 한 번에 반영합니다.</p></div>
      <Button variant="outline" onClick={() => void loadBatches()}><RefreshCwIcon />이력 새로고침</Button>
    </div>

    {message && <div role="status" className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"><AlertCircleIcon className="size-4 text-muted-foreground" />{message}</div>}

    <section className="grid items-start gap-4 xl:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardHeader><CardTitle>CSV 파일 검토</CardTitle><CardDescription>먼저 미리보기로 모든 행을 검증합니다. 오류가 있으면 어떤 행도 반영하지 않습니다.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="grid min-h-36 cursor-pointer place-items-center rounded-lg border border-dashed bg-muted/20 p-6 text-center transition-colors hover:bg-muted/40">
            <span><FileUpIcon className="mx-auto mb-3 size-7 text-muted-foreground" /><strong className="block text-sm">{file?.filename ?? 'UTF-8 CSV 파일 선택'}</strong><span className="mt-1 block text-xs text-muted-foreground">최대 1MiB · 2,000행</span></span>
            <input className="sr-only" type="file" accept=".csv,text/csv" onChange={event => void chooseFile(event)} />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" render={<a href="/samples/initial-import-template.csv" download />}><FileSpreadsheetIcon />형식 예시 다운로드</Button>
            <div className="flex gap-2"><Button variant="outline" disabled={!file || !!busy} onClick={() => void request('preview')}>{busy === 'preview' ? '검증 중…' : '미리보기'}</Button><Button disabled={!preview || preview.errors.length > 0 || !!busy} onClick={() => void request('apply')}>{busy === 'apply' ? '반영 중…' : '검증 결과 반영'}</Button></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>파일 작성 기준</CardTitle><CardDescription>코드와 SKU는 대문자로 정규화합니다.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[['customer', 'code · name'], ['supplier', 'code · name'], ['warehouse', 'code · name'], ['product', 'sku · name · saleUnit'], ['price', 'customerCode · sku · unitPrice'], ['stock', 'warehouseCode · sku · quantity']].map(([type, fields]) => <div className="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0" key={type}><Badge variant="secondary" className="font-mono">{type}</Badge><span className="text-right text-xs text-muted-foreground">{fields}</span></div>)}
        </CardContent>
      </Card>
    </section>

    {preview && <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>미리보기 결과</CardTitle><CardDescription>{preview.filename} · 총 {preview.totalRows}행</CardDescription></div><div className="flex gap-2"><Badge variant="secondary">생성 {preview.createdRows}</Badge><Badge variant="outline">건너뜀 {preview.skippedRows}</Badge>{preview.errors.length > 0 && <Badge variant="destructive">오류 {preview.errors.length}</Badge>}</div></div></CardHeader>
      <CardContent className="p-0"><div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>행</TableHead><TableHead>종류</TableHead><TableHead>업무 식별자</TableHead><TableHead>판정</TableHead></TableRow></TableHeader><TableBody>{preview.rows.map(row => { const error=preview.errors.find(item=>item.rowNumber===row.rowNumber); return <TableRow key={row.rowNumber}><TableCell>{row.rowNumber}</TableCell><TableCell><Badge variant="outline" className="font-mono">{row.recordType}</Badge></TableCell><TableCell className="font-mono text-xs">{row.key}</TableCell><TableCell>{error ? <span className="text-sm text-destructive">{error.message}</span> : <span className="inline-flex items-center gap-1 text-sm"><CheckCircle2Icon className="size-4 text-emerald-600" />{row.result === 'skipped' ? '기존 값과 같음' : '생성 예정'}</span>}</TableCell></TableRow>})}</TableBody></Table></div></CardContent>
    </Card>}

    <Card>
      <CardHeader><CardTitle>최근 이관 이력</CardTitle><CardDescription>같은 파일 내용은 한 번만 반영됩니다.</CardDescription></CardHeader>
      <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>파일</TableHead><TableHead>반영 일시</TableHead><TableHead className="text-right">전체</TableHead><TableHead className="text-right">생성</TableHead><TableHead className="text-right">건너뜀</TableHead></TableRow></TableHeader><TableBody>{batches.map(batch => <TableRow key={batch.id}><TableCell><strong className="text-sm">{batch.filename}</strong><p className="font-mono text-[11px] text-muted-foreground">#{batch.id.slice(0,8).toUpperCase()}</p></TableCell><TableCell className="text-xs text-muted-foreground">{new Date(batch.createdAt).toLocaleString('ko-KR')}</TableCell><TableCell className="text-right">{batch.totalRows}</TableCell><TableCell className="text-right">{batch.createdRows}</TableCell><TableCell className="text-right">{batch.skippedRows}</TableCell></TableRow>)}{!batches.length && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">아직 이관 이력이 없습니다.</TableCell></TableRow>}</TableBody></Table></CardContent>
    </Card>
  </div>
}

