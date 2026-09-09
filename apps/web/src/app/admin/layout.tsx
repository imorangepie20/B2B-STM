import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceSessionGuard } from "@/components/layout/workspace-session-guard"

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <WorkspaceSessionGuard workspace="admin"><SidebarProvider>
      <div className="md:hidden"><AppSidebar /></div>
      <SidebarInset>
        <AppHeader role="admin" />
        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 lg:px-8 lg:py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider></WorkspaceSessionGuard>
  )
}
