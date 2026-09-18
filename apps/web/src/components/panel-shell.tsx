import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Panel chrome shared by every section: root container, title row, action buttons
 * and the live notice region. `CustomersPanel` keeps its own header because it
 * switches between h1 and h2 and stays side by side on small screens, and the
 * routers and billing panels render the notice themselves, below their own cards.
 */
export function PanelShell({ id, title, description, actions, notice, tone = 'muted', className, children }: {
  id?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  /** Omit it to render the notice inside `children` instead. */
  notice?: string;
  tone?: 'muted' | 'destructive';
  className?: string;
  children: ReactNode;
}) {
  return <div id={id} className={cn('grid gap-6 py-6', className)}>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {notice !== undefined && <p role="status" className={notice ? (tone === 'destructive' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground') : 'sr-only'}>{notice}</p>}
    {children}
  </div>;
}

/** Inline form error announced by assistive technology. */
export function FormError({ id, message }: { id?: string; message: string }) {
  return <p id={id} role="alert" className="text-sm text-destructive">{message}</p>;
}

/** Plain status word used inside cards and table cells. */
export function StatusText({ tone = 'default', className, children }: { tone?: 'default' | 'danger'; className?: string; children: ReactNode }) {
  return <span className={cn('font-medium', tone === 'danger' && 'text-destructive', className)}>{children}</span>;
}
