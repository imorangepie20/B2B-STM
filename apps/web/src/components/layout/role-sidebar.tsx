"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { PackageCheckIcon } from "lucide-react"
import { portalNav, warehouseNav } from "@/lib/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

export function RoleSidebar({ role }: { role: "portal" | "warehouse" }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const items = role === "portal" ? portalNav : warehouseNav
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((first, second) => second.href.length - first.href.length)[0]?.href
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PackageCheckIcon className="size-4" />
          </div>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block text-sm font-semibold">STM</span>
            <span className="block text-[10px] tracking-[0.12em] text-muted-foreground">
              {role === "portal" ? "ORDER PORTAL" : "WAREHOUSE"}
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{role === "portal" ? "거래처 업무" : "창고 업무"}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => {
              const Icon = item.icon
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} onClick={closeMobileSidebar} />}
                    isActive={item.href === activeHref}
                    tooltip={item.title}
                  >
                    <Icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
