import { AppHeader } from "@/components/layout/app-header"
import { RoleSidebar } from "@/components/layout/role-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceSessionGuard } from "@/components/layout/workspace-session-guard"

export default function WarehouseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SidebarProvider><RoleSidebar role="warehouse"/><SidebarInset><AppHeader identity="창고 담당자"/><WorkspaceSessionGuard workspace="warehouse"><main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 lg:px-8 lg:py-6">{children}</main></WorkspaceSessionGuard></SidebarInset></SidebarProvider>
}
