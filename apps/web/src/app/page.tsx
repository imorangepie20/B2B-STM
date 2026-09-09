'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { PackageCheckIcon } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Phase = 'loading' | 'login' | 'mfa' | 'mfaEnroll' | 'mfaConfirm' | 'mfaRecovery' | 'workspace';
type Me = { id: string; customerId: string | null; roles: string[]; mfaVerified: boolean };

async function csrf() {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('보안 토큰을 준비할 수 없습니다.');
  return (await response.json()).csrfToken as string;
}
async function request(path: string, body?: object) {
  const token = await csrf();
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: JSON.stringify(body ?? {}) });
  return response;
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaUri, setMfaUri] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) { setPhase('login'); return; }
    const current = await response.json() as Me;
    setMe(current);
    if (current.roles.includes('customer')) { window.location.assign('/portal/orders'); return; }
    if (current.roles.includes('warehouse') && !current.roles.includes('system')) { window.location.assign('/warehouse/shipments'); return; }
    if (current.mfaVerified && current.roles.some(role => role === 'system' || role === 'operations')) { window.location.assign('/admin'); return; }
    if (!current.roles.some(role => ['operations', 'settlement', 'system'].includes(role)) || current.mfaVerified) {
      setPhase('workspace');
      return;
    }
    const mfaStatus = await fetch('/api/auth/mfa/status', { credentials: 'same-origin' });
    if (!mfaStatus.ok) { setMessage('MFA 설정 상태를 확인할 수 없습니다.'); setPhase('mfa'); return; }
    setPhase((await mfaStatus.json() as { enrolled: boolean }).enrolled ? 'mfa' : 'mfaEnroll');
  };
  useEffect(() => { void load(); }, []);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await request('/api/auth/login', { email, password });
      if (!response.ok) throw new Error(response.status === 429 ? '로그인 시도가 제한되었습니다. 잠시 후 다시 시도하세요.' : '이메일 또는 비밀번호를 확인하세요.');
      setPassword(''); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '로그인에 실패했습니다.'); } finally { setBusy(false); }
  };
  const verifyMfa = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await request('/api/auth/mfa/verify', { code });
      if (!response.ok) throw new Error(response.status === 429 ? '인증 시도가 제한되었습니다. 잠시 후 다시 시도하세요.' : '인증 코드를 확인하세요.');
      setCode(''); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '추가 인증에 실패했습니다.'); } finally { setBusy(false); }
  };
  const enrollMfa = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await request('/api/auth/mfa/enroll', { password });
      if (!response.ok) throw new Error('비밀번호를 확인해 주세요.');
      const enrollment = await response.json() as { secret: string; uri: string };
      setPassword(''); setMfaSecret(enrollment.secret); setMfaUri(enrollment.uri); setPhase('mfaConfirm');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'MFA 등록을 시작하지 못했습니다.'); } finally { setBusy(false); }
  };
  const confirmMfa = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await request('/api/auth/mfa/confirm', { code });
      if (!response.ok) throw new Error('인증 코드를 확인해 주세요.');
      const result = await response.json() as { recoveryCodes: string[] };
      setCode(''); setMfaSecret(''); setMfaUri(''); setRecoveryCodes(result.recoveryCodes); setPhase('mfaRecovery');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'MFA 등록을 완료하지 못했습니다.'); } finally { setBusy(false); }
  };
  const logout = async () => { await request('/api/auth/logout'); setMe(null); setPhase('login'); setMessage('로그아웃했습니다.'); };

  if (phase === 'loading') return <AuthFrame><p className="text-sm text-muted-foreground">보안 세션을 확인하고 있습니다…</p></AuthFrame>;
  if (phase === 'login') return <AuthFrame eyebrow="B2B ORDER · INVENTORY · FULFILLMENT" title="업무 시스템에 로그인" description="거래처 주문, 창고 작업, 관리자 업무를 하나의 기록으로 관리합니다."><form className="grid gap-4" onSubmit={submitLogin}><Field label="이메일"><Input aria-label="이메일" autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required /></Field><Field label="비밀번호"><Input aria-label="비밀번호" autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></Field><Message text={message}/><Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</Button></form><Link className={buttonVariants({ variant: 'ghost', className: 'mt-3 w-full' })} href="/account-setup">초대·비밀번호 설정</Link><p className="mt-4 text-center text-xs text-muted-foreground">토큰 재발급은 시스템 관리자에게 문의하세요.</p></AuthFrame>;
  if (phase === 'mfa') return <AuthFrame eyebrow="ADDITIONAL VERIFICATION" title="인증 앱 코드를 입력하세요" description="관리자·운영·정산 업무에는 추가 인증이 필요합니다."><form className="grid gap-4" onSubmit={verifyMfa}><Field label="6자리 인증 코드"><Input className="h-12 text-center text-lg tracking-[0.35em]" aria-label="6자리 인증 코드" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required /></Field><Message text={message}/><Button type="submit" size="lg" disabled={busy}>{busy ? '확인 중…' : '인증 확인'}</Button></form><Button className="mt-2 w-full" variant="ghost" onClick={logout}>다른 계정으로 로그인</Button></AuthFrame>;
  if (phase === 'mfaEnroll') return <AuthFrame eyebrow="MFA SETUP · 1 OF 3" title="인증 앱을 등록하세요" description="TOTP 인증 앱 등록을 시작하려면 비밀번호를 다시 입력해 주세요."><form className="grid gap-4" onSubmit={enrollMfa}><Field label="비밀번호"><Input aria-label="MFA 등록 비밀번호" autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></Field><Message text={message}/><Button type="submit" size="lg" disabled={busy}>{busy ? '준비 중…' : '등록 시작'}</Button></form><Button className="mt-2 w-full" variant="ghost" onClick={logout}>다른 계정으로 로그인</Button></AuthFrame>;
  if (phase === 'mfaConfirm') return <AuthFrame eyebrow="MFA SETUP · 2 OF 3" title="인증 앱에 키를 추가하세요" description="아래 키 또는 등록 URI를 인증 앱에 입력한 뒤 표시된 6자리 코드를 확인하세요."><KeyValue label="설정 키" value={mfaSecret}/><KeyValue label="등록 URI" value={mfaUri}/><form className="mt-5 grid gap-4" onSubmit={confirmMfa}><Field label="6자리 인증 코드"><Input className="h-12 text-center text-lg tracking-[0.35em]" aria-label="MFA 등록 인증 코드" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required /></Field><Message text={message}/><Button type="submit" size="lg" disabled={busy}>{busy ? '확인 중…' : '등록 완료'}</Button></form></AuthFrame>;
  if (phase === 'mfaRecovery') return <AuthFrame eyebrow="MFA SETUP · 3 OF 3" title="복구 코드를 안전하게 보관하세요" description="인증 앱을 사용할 수 없을 때 각 코드는 한 번만 사용할 수 있으며 이 화면을 닫으면 다시 확인할 수 없습니다."><ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-4">{recoveryCodes.map(recoveryCode => <li className="font-mono text-sm" key={recoveryCode}>{recoveryCode}</li>)}</ul><Button className="mt-5 w-full" size="lg" onClick={() => { setRecoveryCodes([]); void load(); }}>안전하게 보관했습니다</Button></AuthFrame>;
  return <AuthFrame title={me?.roles.includes('system') ? '시스템 관리자' : me?.roles.includes('warehouse') ? '창고 작업' : '거래처 포털'} description="계정과 권한 확인이 완료되었습니다."><Button className="w-full" onClick={logout}>로그아웃</Button></AuthFrame>;
}
function AuthFrame({ eyebrow, title, description, children }: { eyebrow?: string; title?: string; description?: string; children: React.ReactNode }) { return <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(320px,0.9fr)_1.1fr]"><section className="hidden flex-col justify-between border-r bg-muted/50 p-12 lg:flex"><Brand/><div><p className="text-sm text-muted-foreground">주문에서 정산까지 하나의 업무 기록</p><p className="mt-3 max-w-md text-3xl font-semibold leading-tight">거래처, 창고, 운영팀이 같은 흐름에서 일합니다.</p></div><p className="text-xs text-muted-foreground">STM Order &amp; Stock Management</p></section><section className="flex items-center justify-center p-6 sm:p-10"><div className="w-full max-w-md"><div className="mb-10 lg:hidden"><Brand/></div>{eyebrow && <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground">{eyebrow}</p>}{title && <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>}{description && <p className="mt-2 mb-7 text-sm leading-6 text-muted-foreground">{description}</p>}{children}</div></section></main> }
function Brand({ light = false }: { light?: boolean }) { return <div className="flex items-center gap-3"><span className={`flex size-9 items-center justify-center rounded-md ${light ? 'bg-white text-neutral-950' : 'bg-primary text-primary-foreground'}`}><PackageCheckIcon className="size-5"/></span><strong className="text-base leading-tight">STM<span className={`block text-[10px] font-normal tracking-[0.14em] ${light ? 'text-neutral-400' : 'text-muted-foreground'}`}>ORDER &amp; STOCK</span></strong></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-2 text-sm font-medium">{label}{children}</label> }
function Message({ text }: { text: string }) { return text ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{text}</div> : null }
function KeyValue({ label, value }: { label: string; value: string }) { return <div className="mt-4"><span className="text-xs font-medium text-muted-foreground">{label}</span><code className="mt-1 block overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">{value}</code></div> }
