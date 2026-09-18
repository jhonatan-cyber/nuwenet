// Adapted from shadcn/ui new-york-v4 registry (MIT), 2026-09-15.
// Keeps this application's existing table look (bordered body rows, plain cells)
// and makes the compact preference reach every panel table from this one place.
import * as React from "react"
import { cn } from "@/lib/utils"

function Table({
  className,
  dense = false,
  ...props
}: React.ComponentProps<"table"> & {
  /** Tighter cells for tables nested inside a router card or dialog. */
  dense?: boolean
}) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        data-dense={dense ? "" : undefined}
        className={cn("w-full text-sm", dense && "[&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-0", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr]:border-t", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={className} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" className={cn("p-3 text-left in-data-[density=compact]:py-2", className)} {...props} />
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("p-3 in-data-[density=compact]:py-2", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
