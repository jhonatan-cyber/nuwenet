// Adapted from shadcn/ui new-york-v4 registry (MIT), 2026-09-15.
// Variants are trimmed to the two this application renders: a muted chip for
// normal states and the same chip with destructive text for failures.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        outline: "bg-muted",
        "outline-destructive": "bg-muted text-destructive",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  }
)

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
