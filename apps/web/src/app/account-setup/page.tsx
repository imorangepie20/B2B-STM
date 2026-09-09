"use client"

import { FormEvent, useEffect, useState } from "react"
import Link from "next/link"
import { KeyRoundIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Purpose = "invitation" | "password_reset"
const selectClass = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

async function csrf() { return (await (await fetch("/api/auth/csrf", { credentials: "same-origin" })).json() as { csrfToken: string }).csrfToken }

export default function AccountSetupPage() {
  const [purpose, setPurpose] = useState<Purpose>("invitation"), [token,setToken]=useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false)
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get("purpose");if(requested==="invitation"||requested==="password_reset")setPurpose(requested);const issued=params.get("token");if(issued)setToken(issued)},[])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("")
    const form = new FormData(event.currentTarget)
    if (form.get("password") !== form.get("confirmation")) { setMessage("비밀번호 확인이 일치하지 않습니다."); setBusy(false); return }
    const path = purpose === "invitation" ? "/api/auth/invitations/accept" : "/api/auth/password-reset/complete"
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify({ token: form.get("token"), password: form.get("password") }) })
    if (response.ok) setDone(true); else setMessage("토큰이 만료됐거나 이미 사용되었습니다. 관리자에게 재발급을 요청하세요.")
    setBusy(false)
  }
  return <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(320px,0.9fr)_1.1fr]"><section className="hidden flex-col justify-between border-r bg-muted/50 p-12 lg:flex"><Brand/><div><p className="text-sm text-muted-foreground">안전한 업무 계정 시작</p><p className="mt-3 max-w-md text-3xl font-semibold leading-tight">관리자가 발급한 토큰으로 비밀번호를 설정합니다.</p></div><p className="text-xs text-muted-foreground">STM Order &amp; Stock Management</p></section><section className="flex items-center justify-center p-6 sm:p-10"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><Brand/></div><p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">ACCOUNT SECURITY</p><h1 className="mt-3 text-2xl font-semibold tracking-tight">초대·비밀번호 설정</h1>{done ? <div className="mt-7 space-y-4"><div className="rounded-md border bg-muted/40 p-4 text-sm">비밀번호 설정을 완료했습니다. 새 비밀번호로 로그인하세요.</div><Link className={buttonVariants({ className: "w-full" })} href="/">로그인으로 이동</Link></div> : <form className="mt-7 grid gap-4" onSubmit={submit}><label className="grid gap-1.5 text-sm font-medium">작업 유형<select className={selectClass} value={purpose} onChange={event => setPurpose(event.target.value as Purpose)}><option value="invitation">초대 계정 최초 설정</option><option value="password_reset">비밀번호 재설정</option></select></label><label className="grid gap-1.5 text-sm font-medium">관리자 발급 토큰<Input name="token" value={token} onChange={event=>setToken(event.target.value)} className="font-mono text-xs" pattern="[a-f0-9]{64}" maxLength={64} required autoComplete="off"/></label><label className="grid gap-1.5 text-sm font-medium">새 비밀번호<Input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label className="grid gap-1.5 text-sm font-medium">새 비밀번호 확인<Input name="confirmation" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label>{message && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</div>}<Button type="submit" size="lg" disabled={busy}>{busy ? "처리 중…" : "비밀번호 설정"}</Button><Link className={buttonVariants({ variant: "ghost" })} href="/">로그인으로 돌아가기</Link></form>}</div></section></main>
}

function Brand() { return <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><KeyRoundIcon className="size-5"/></span><strong className="text-base leading-tight">STM<span className="block text-[10px] font-normal tracking-[0.14em] text-muted-foreground">ORDER &amp; STOCK</span></strong></div> }
