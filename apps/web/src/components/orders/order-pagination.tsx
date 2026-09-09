"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export type PageMetadata = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function OrderPagination({ metadata, loading, onPageChange }: {
  metadata: PageMetadata
  loading: boolean
  onPageChange: (page: number) => void
}) {
  if (metadata.totalPages <= 1) return null
  return (
    <nav className="flex items-center justify-between rounded-lg border bg-card px-3 py-2" aria-label="목록 페이지">
      <p className="text-xs text-muted-foreground">
        전체 <strong className="font-medium text-foreground">{metadata.total.toLocaleString("ko-KR")}</strong>건 · {metadata.page}/{metadata.totalPages}페이지
      </p>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" disabled={loading || metadata.page <= 1} onClick={() => onPageChange(metadata.page - 1)}>
          <ChevronLeftIcon />이전
        </Button>
        <Button size="sm" variant="outline" disabled={loading || metadata.page >= metadata.totalPages} onClick={() => onPageChange(metadata.page + 1)}>
          다음<ChevronRightIcon />
        </Button>
      </div>
    </nav>
  )
}
