"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

type Workspace = "admin" | "portal" | "warehouse"
type Principal = { customerId: string | null; roles: string[]; mfaVerified: boolean }
type Status = "checking" | "allowed" | "redirecting" | "unavailable"

function canAccess(principal: Principal, workspace: Workspace, pathname: string) {
  if (workspace === "portal") return Boolean(principal.customerId) && principal.roles.includes("customer")
  if (workspace === "warehouse") return principal.roles.includes("warehouse") || (principal.roles.includes("system") && principal.mfaVerified)
  if (!principal.mfaVerified) return false
  if (principal.roles.includes("system")) return true
  if (["/admin/accounts", "/admin/account-security"].some(path => pathname === path || pathname.startsWith(`${path}/`))) return false
  if (pathname === "/admin/refunds" || pathname.startsWith("/admin/refunds/")) return principal.roles.includes("settlement")
  if (["/admin/settlement-drafts", "/admin/settlements", "/admin/payments"].some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return principal.roles.includes("operations") && principal.roles.includes("settlement")
  }
  return principal.roles.includes("operations")
}

export function WorkspaceSessionGuard({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<Status>("checking")
  const [authorizedPath, setAuthorizedPath] = useState("")
  const requestGeneration = useRef(0)
  const currentRequest = useRef<AbortController | null>(null)
  const redirecting = useRef(false)

  const validate = useCallback(async () => {
    if (redirecting.current) return
    const generation = ++requestGeneration.current
    currentRequest.current?.abort()
    const controller = new AbortController()
    currentRequest.current = controller
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      if (generation !== requestGeneration.current || redirecting.current) return
      if (response.status === 401 || response.status === 403) {
        redirecting.current = true
        setStatus("redirecting")
        router.replace("/")
        router.refresh()
        return
      }
      if (!response.ok) {
        setStatus("unavailable")
        return
      }
      const principal = await response.json() as Principal
      if (generation !== requestGeneration.current || redirecting.current) return
      if (!canAccess(principal, workspace, pathname)) {
        redirecting.current = true
        setStatus("redirecting")
        router.replace("/")
        router.refresh()
        return
      }
      setAuthorizedPath(pathname)
      setStatus("allowed")
    } catch {
      if (controller.signal.aborted || generation !== requestGeneration.current || redirecting.current) return
      setStatus("unavailable")
    }
  }, [pathname, router, workspace])

  useEffect(() => {
    void validate()
    const interval = window.setInterval(() => void validate(), 60_000)
    const onFocus = () => void validate()
    const onVisibility = () => { if (document.visibilityState === "visible") void validate() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      requestGeneration.current++
      currentRequest.current?.abort()
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [validate])

  if (status === "allowed" && authorizedPath === pathname) return children

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        {status === "unavailable" ? (
          <>
            <div role="status" aria-live="polite">
              <strong className="text-sm">인증 상태를 확인하지 못했습니다.</strong>
              <p className="mt-1 text-sm text-muted-foreground">서버 연결을 확인한 뒤 다시 시도해 주세요.</p>
            </div>
            <Button type="button" variant="outline" onClick={() => { setStatus("checking"); void validate() }}>
              <RefreshCwIcon /> 다시 시도
            </Button>
          </>
        ) : (
          <>
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground" role="status" aria-live="polite">{status === "redirecting" ? "로그인 화면으로 이동합니다." : "인증 상태를 확인하고 있습니다."}</span>
          </>
        )}
      </div>
    </main>
  )
}
