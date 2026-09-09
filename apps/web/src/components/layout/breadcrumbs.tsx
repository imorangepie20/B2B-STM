"use client"

import { Fragment } from "react"
import { usePathname } from "next/navigation"
import { routeLabels } from "@/lib/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

export function Breadcrumbs() {
  const segments = usePathname().split("/").filter(Boolean)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`
          const last = index === segments.length - 1
          return (
            <Fragment key={href}>
              <BreadcrumbItem>
                {last ? (
                  <BreadcrumbPage>{routeLabels[segment] ?? segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{routeLabels[segment] ?? segment}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
