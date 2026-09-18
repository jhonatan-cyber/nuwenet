// Adapted from shadcn/ui new-york-v4 registry (MIT).
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

/** Placeholder de carga para listados: respeta reduced-motion vía ui.css. */
function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export { Skeleton, ListSkeleton }
