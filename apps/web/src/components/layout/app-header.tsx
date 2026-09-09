"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useRouter } from "next/navigation"
import { LogOutIcon, PackageCheckIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"
import { adminNavGroups, portalNav, warehouseNav } from "@/lib/navigation"
import { cn } from "@/lib/utils"

export function AppHeader({ role = "admin", identity = "시스템 관리자" }: { role?: "admin" | "portal" | "warehouse"; identity?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const items: Array<{ href: string; title: string }> = []
  if (role === "admin") {
    for (const group of adminNavGroups) {
      for (const item of group.items) items.push({ href: item.href, title: item.title })
    }
  } else {
    for (const item of role === "portal" ? portalNav : warehouseNav) {
      items.push({ href: item.href, title: item.title })
    }
  }
  const activeHref = items
    .filter(item => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((first, second) => second.href.length - first.href.length)[0]?.href

  const logout = async () => {
    const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" })
    if (!csrfResponse.ok) return
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string }
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    })
    if (response.ok) {
      router.push("/")
      router.refresh()
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center border-b bg-background/95 px-4 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3">
        <SidebarTrigger className="-ml-1 md:hidden" />
        <Link href={role === "admin" ? "/admin" : role === "portal" ? "/portal/orders" : "/warehouse/shipments"} className="hidden w-44 shrink-0 items-center gap-2 md:flex xl:w-48">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><PackageCheckIcon className="size-4" /></span>
          <span className="whitespace-nowrap text-sm font-semibold">STM <span className="ml-1 hidden font-normal text-muted-foreground xl:inline">ORDER &amp; STOCK</span></span>
        </Link>
        <div className="min-w-0 md:hidden"><Breadcrumbs /></div>
        <nav className="mx-auto hidden items-center rounded-lg border bg-muted/40 p-1 md:flex" aria-label="주요 업무">
          {items.map(item => {
            const active = item.href === activeHref
            return <Link className={cn("whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground", active && "bg-background text-foreground shadow-sm")} href={item.href} key={item.href}>{item.title}</Link>
          })}
        </nav>
        <div className="ml-auto flex w-auto shrink-0 items-center justify-end gap-1 2xl:w-44">
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:inline">{identity}</span>
          <Avatar className="size-8"><AvatarFallback>{identity.slice(0, 1)}</AvatarFallback></Avatar>
          <Button aria-label="로그아웃" title="로그아웃" variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOutIcon />
            <span className="hidden 2xl:inline">로그아웃</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
