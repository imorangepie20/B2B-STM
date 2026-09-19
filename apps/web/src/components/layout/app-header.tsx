"use client"

import { useRouter } from "next/navigation"
import { LogOutIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"

export function AppHeader({ identity = "시스템 관리자" }: { identity?: string }) {
  const router = useRouter()

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
        <SidebarTrigger aria-label="메뉴 접기 또는 펼치기" title="메뉴 접기 또는 펼치기" className="-ml-1" />
        <div className="min-w-0"><Breadcrumbs /></div>
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
