"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DownloadIcon, FileIcon, PaperclipIcon, UploadIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Attachment = { id: string; filename: string; mediaType: string; byteSize: number; createdAt: string; uploadedBy: string }

async function csrf() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" })
  if (!response.ok) throw new Error("보안 토큰을 준비하지 못했습니다.")
  return (await response.json() as { csrfToken: string }).csrfToken
}

export function AttachmentPanel({ resourceType, resourceId, canUpload = false, lazy = false }: { resourceType: "shipment" | "return"; resourceId: string; canUpload?: boolean; lazy?: boolean }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [opened, setOpened] = useState(!lazy)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    const response = await fetch(`/api/attachments/${resourceType}/${resourceId}`, { credentials: "same-origin" })
    if (!response.ok) return setMessage("첨부 증빙을 불러오지 못했습니다.")
    setItems(await response.json() as Attachment[]); setMessage("")
  }, [resourceId, resourceType])
  useEffect(() => { if (opened) void load() }, [load, opened])
  const upload = async () => {
    const file = input.current?.files?.[0]
    if (!file) return setMessage("JPEG, PNG 또는 PDF 파일을 선택해 주세요.")
    if (!["image/jpeg","image/png","application/pdf"].includes(file.type) || file.size > 10 * 1024 * 1024) return setMessage("JPEG·PNG·PDF만 가능하며 파일당 최대 10MB입니다.")
    setBusy(true); setMessage("")
    try {
      const response = await fetch(`/api/attachments/${resourceType}/${resourceId}?filename=${encodeURIComponent(file.name)}`, { method: "POST", credentials: "same-origin", headers: { "content-type": file.type, "x-csrf-token": await csrf() }, body: file })
      if (!response.ok) throw new Error(response.status === 409 ? "같은 파일이 이미 있거나 첨부 한도 5개를 초과했습니다." : "파일 내용과 형식을 확인해 주세요.")
      if (input.current) input.current.value = ""
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : "첨부에 실패했습니다.") }
    finally { setBusy(false) }
  }
  if (!opened) return <Button type="button" size="sm" variant="outline" onClick={() => setOpened(true)}><PaperclipIcon />증빙 보기</Button>
  return <div className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="flex items-center gap-2 text-sm"><PaperclipIcon className="size-4" />첨부 증빙</strong><p className="mt-1 text-xs text-muted-foreground">JPEG·PNG·PDF · 파일당 10MB · 최대 5개</p></div>{canUpload && <div className="flex items-center gap-2"><Input ref={input} className="max-w-64" type="file" accept="image/jpeg,image/png,application/pdf" aria-label="증빙 파일"/><Button type="button" size="sm" onClick={() => void upload()} disabled={busy || items.length >= 5}><UploadIcon />{busy ? "업로드 중" : "첨부"}</Button></div>}</div>{message && <p className="mt-3 text-xs text-destructive" role="status">{message}</p>}<div className="mt-3 divide-y">{items.map(item => <div className="flex items-center gap-3 py-2" key={item.id}><FileIcon className="size-4 text-muted-foreground"/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.filename}</strong><span className="text-[11px] text-muted-foreground">{(item.byteSize / 1024).toFixed(1)}KB · {item.uploadedBy}</span></div><Button size="icon-sm" variant="ghost" render={<a href={`/api/attachments/file/${item.id}/content`} download aria-label={`${item.filename} 다운로드`} />}><DownloadIcon /></Button></div>)}{!items.length && <p className="py-3 text-xs text-muted-foreground">등록된 증빙이 없습니다.</p>}</div></div>
}
