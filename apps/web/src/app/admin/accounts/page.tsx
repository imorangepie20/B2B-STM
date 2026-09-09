"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { CheckIcon, CopyIcon, KeyRoundIcon, RefreshCwIcon, SearchIcon, UserPlusIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Account = { id: string; email: string; accountType: "internal" | "customer"; customerId: string | null; customerCode: string | null; customerName: string | null; roles: string[]; active: boolean; passwordConfigured: boolean; invitationPending: boolean; tokenExpiresAt: string | null; lastDelivery: null | { status: "sent" | "failed" } }
type Customer = { id: string; code: string; name: string }
type IssuedToken = { email: string; purpose: "invitation" | "password_reset"; token: string; expiresAt: string; delivery: { status: "sent" | "failed" | "manual" } }
type Me = { id: string }

const roleLabels: Record<string, string> = { system: "시스템", operations: "운영", warehouse: "창고", settlement: "정산", customer: "거래처" }
const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

async function csrf() { return (await (await fetch("/api/auth/csrf", { credentials: "same-origin" })).json() as { csrfToken: string }).csrfToken }
async function post(path: string, body: object) { return fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": await csrf() }, body: JSON.stringify(body) }) }

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [query, setQuery] = useState("")
  const [accountType, setAccountType] = useState<"internal" | "customer">("internal")
  const [roles, setRoles] = useState<string[]>(["operations"])
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const [issued, setIssued] = useState<IssuedToken | null>(null)
  const [statusTarget, setStatusTarget] = useState<Account | null>(null)
  const [statusReason, setStatusReason] = useState("")

  const load = useCallback(async () => {
    const [accountsResponse, catalogResponse, meResponse] = await Promise.all([
      fetch("/api/auth/users", { credentials: "same-origin" }),
      fetch("/api/admin/catalog", { credentials: "same-origin" }),
      fetch("/api/auth/me", { credentials: "same-origin" }),
    ])
    if (!accountsResponse.ok || !catalogResponse.ok || !meResponse.ok) { setMessage("system 권한과 MFA 인증을 확인해 주세요."); return }
    setAccounts(await accountsResponse.json() as Account[])
    setCustomers((await catalogResponse.json() as { customers: Customer[] }).customers)
    setMe(await meResponse.json() as Me)
  }, [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? accounts.filter(account => `${account.email} ${account.customerCode ?? ""} ${account.customerName ?? ""} ${account.roles.join(" ")}`.toLowerCase().includes(needle)) : accounts
  }, [accounts, query])

  function toggleRole(role: string) { setRoles(current => current.includes(role) ? current.filter(value => value !== role) : [...current, role]) }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("invite"); setMessage(""); setIssued(null)
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get("email"))
    const response = await post("/api/auth/invitations", { email, accountType, customerId: accountType === "customer" ? data.get("customerId") : null, roles: accountType === "customer" ? ["customer"] : roles })
    if (!response.ok) setMessage(response.status === 409 ? "이미 등록된 이메일입니다." : "계정을 초대하지 못했습니다. 입력값과 권한을 확인해 주세요.")
    else { const result = await response.json() as Omit<IssuedToken,"email"|"purpose">; setIssued({ email, purpose: "invitation", ...result }); setMessage(result.delivery.status === "sent" ? "초대 이메일을 발송했습니다." : "이메일을 발송하지 못했습니다. 표시된 토큰을 직접 전달하세요."); form.reset(); await load() }
    setBusy("")
  }

  async function issue(account: Account, purpose: "invitation" | "password_reset") {
    setBusy(account.id); setMessage(""); setIssued(null)
    const endpoint = purpose === "invitation" ? "invitation" : "password-reset"
    const response = await post(`/api/auth/users/${account.id}/${endpoint}`, {})
    if (!response.ok) setMessage("토큰을 발급하지 못했습니다. 계정 상태를 새로고침해 확인해 주세요.")
    else { const result = await response.json() as Omit<IssuedToken,"email"|"purpose">; setIssued({ email: account.email, purpose, ...result }); setMessage(result.delivery.status === "sent" ? "이메일을 발송했습니다." : "이메일 발송이 비활성화됐거나 실패했습니다. 토큰을 직접 전달하세요."); await load() }
    setBusy("")
  }

  async function changeStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!statusTarget) return
    setBusy(statusTarget.id); setMessage("")
    const response = await post(`/api/auth/users/${statusTarget.id}/status`, { active: !statusTarget.active, reason: statusReason })
    if (!response.ok) setMessage("계정 상태를 변경하지 못했습니다. 본인 계정은 비활성화할 수 없습니다.")
    else { setMessage(statusTarget.active ? "계정을 비활성화하고 로그인 세션과 발급 토큰을 폐기했습니다." : "계정을 다시 활성화했습니다."); setStatusTarget(null); setStatusReason(""); await load() }
    setBusy("")
  }

  async function copyToken() { if (!issued) return; await navigator.clipboard.writeText(issued.token); setMessage("토큰을 클립보드에 복사했습니다.") }

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">계정 관리</h1><p className="mt-1 text-sm text-muted-foreground">업무 사용자를 초대하고 접근 상태와 비밀번호 설정 절차를 관리합니다.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCwIcon />새로고침</Button></div>
    {message && <div role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
    {issued && <Card className="border-primary/30"><CardHeader><CardTitle>{issued.purpose === "invitation" ? "초대" : "비밀번호 재설정"} 토큰 <Badge variant={issued.delivery.status === "sent" ? "default" : "outline"}>{issued.delivery.status === "sent" ? "이메일 발송" : "직접 전달"}</Badge></CardTitle><CardDescription>{issued.email} · {new Date(issued.expiresAt).toLocaleString("ko-KR")}까지 유효 · 다시 표시되지 않습니다.</CardDescription></CardHeader><CardContent><div className="flex gap-2"><Input className="font-mono text-xs" readOnly value={issued.token}/><Button onClick={() => void copyToken()}><CopyIcon />복사</Button></div><p className="mt-2 text-xs text-muted-foreground">사용자는 로그인 화면의 ‘초대·비밀번호 설정’에서 토큰을 입력합니다.</p></CardContent></Card>}
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserPlusIcon className="size-4"/>사용자 초대</CardTitle><CardDescription>계정 유형에 맞는 역할과 거래처 소속을 지정합니다.</CardDescription></CardHeader><CardContent><form className="grid gap-4" onSubmit={invite}><label className="grid gap-1.5 text-sm font-medium">이메일<Input name="email" type="email" required placeholder="user@company.com"/></label><label className="grid gap-1.5 text-sm font-medium">계정 유형<select className={selectClass} value={accountType} onChange={event => { const value = event.target.value as "internal" | "customer"; setAccountType(value); setRoles(value === "customer" ? ["customer"] : ["operations"]) }}><option value="internal">내부 업무 계정</option><option value="customer">거래처 계정</option></select></label>{accountType === "customer" ? <label className="grid gap-1.5 text-sm font-medium">소속 거래처<select name="customerId" required defaultValue="" className={selectClass}><option value="" disabled>거래처 선택</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></label> : <fieldset className="grid gap-2"><legend className="text-sm font-medium">업무 역할</legend><div className="grid grid-cols-2 gap-2">{["operations","warehouse","settlement","system"].map(role => <label key={role} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)}/>{roleLabels[role]}</label>)}</div></fieldset>}<Button type="submit" disabled={busy === "invite" || !roles.length}>{busy === "invite" ? "발급 중…" : "초대 토큰 발급"}</Button></form></CardContent></Card>
      <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>등록 계정</CardTitle><CardDescription>총 {accounts.length}개 · 활성 {accounts.filter(account => account.active).length}개</CardDescription></div><label className="relative block sm:w-72"><SearchIcon className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="이메일·거래처·역할 검색"/></label></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>계정</TableHead><TableHead>소속·역할</TableHead><TableHead>상태</TableHead><TableHead className="text-right">작업</TableHead></TableRow></TableHeader><TableBody>{filtered.map(account => <TableRow key={account.id}><TableCell><strong className="block text-sm">{account.email}</strong><span className="text-xs text-muted-foreground">{account.accountType === "customer" ? "거래처 계정" : "내부 계정"}</span></TableCell><TableCell><div className="flex flex-wrap gap-1">{account.roles.map(role => <Badge variant="secondary" key={role}>{roleLabels[role] ?? role}</Badge>)}</div>{account.customerName && <p className="mt-1 text-xs text-muted-foreground">{account.customerCode} · {account.customerName}</p>}</TableCell><TableCell><Badge variant={account.active ? "default" : "outline"}>{account.active ? "활성" : "비활성"}</Badge><p className="mt-1 text-xs text-muted-foreground">{account.passwordConfigured ? "비밀번호 설정 완료" : account.invitationPending ? "초대 수락 대기" : "초대 필요"}</p></TableCell><TableCell><div className="flex min-w-max justify-end gap-1.5">{account.active && (account.passwordConfigured ? <Button size="sm" variant="outline" disabled={busy === account.id} onClick={() => void issue(account,"password_reset")}><KeyRoundIcon/>재설정</Button> : <Button size="sm" variant="outline" disabled={busy === account.id} onClick={() => void issue(account,"invitation")}><RefreshCwIcon/>재초대</Button>)}<Button size="sm" variant={account.active ? "destructive" : "outline"} disabled={account.id === me?.id || busy === account.id} onClick={() => { setStatusTarget(account); setStatusReason("") }}>{account.active ? "비활성화" : "활성화"}</Button></div></TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">조건에 맞는 계정이 없습니다.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    </div>
    {statusTarget && <Card className={statusTarget.active ? "border-destructive/30" : "border-primary/30"}><CardHeader><CardTitle>{statusTarget.email} {statusTarget.active ? "비활성화" : "활성화"}</CardTitle><CardDescription>{statusTarget.active ? "즉시 로그아웃되며 사용 중인 초대·재설정 토큰도 폐기됩니다." : "다시 로그인하고 업무 권한을 사용할 수 있습니다."}</CardDescription></CardHeader><CardContent><form className="grid gap-3" onSubmit={changeStatus}><label className="grid gap-1.5 text-sm font-medium">변경 사유<Input value={statusReason} onChange={event => setStatusReason(event.target.value)} minLength={4} maxLength={300} required placeholder="승인된 변경 사유를 입력하세요"/></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setStatusTarget(null)}>취소</Button><Button type="submit" variant={statusTarget.active ? "destructive" : "default"} disabled={statusReason.trim().length < 4}>{statusTarget.active ? "계정 비활성화" : <><CheckIcon/>계정 활성화</>}</Button></div></form></CardContent></Card>}
  </div>
}
