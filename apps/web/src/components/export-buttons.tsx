import { DownloadIcon, FileSpreadsheetIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ExportButtons({ dataset, filters = {} }: { dataset: "orders" | "inventory" | "settlements"; filters?: Record<string, string> }) {
  const href = (format: "csv" | "xlsx") => {
    const parameters = new URLSearchParams({ format })
    for (const [key, value] of Object.entries(filters)) if (value) parameters.set(key, value)
    return `/api/admin/exports/${dataset}?${parameters}`
  }
  return <div className="flex flex-wrap gap-2">
    <Button variant="outline" render={<a href={href("csv")} download />}><DownloadIcon />CSV</Button>
    <Button variant="outline" render={<a href={href("xlsx")} download />}><FileSpreadsheetIcon />Excel</Button>
  </div>
}
