/**
 * UsageWidget — widget vanilla de historial de consumo montado dentro de React.
 * Compartido con el portal del residente; su ciclo de vida termina con el dialog.
 */
import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usageMarkup, mountUsage, type UsageHistory } from '@/shared/lib/usage';
import type { CustomerActionContext } from '@/features/customers/customer-actions-store';
import { IconButton } from '@/components/shared/icon-button';

export function UsageWidget({ context }: { context: CustomerActionContext }) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }).slice(0, 7);

  useEffect(() => {
    const element = root.current!;
    body.current!.innerHTML = usageMarkup(false);
    return mountUsage(
      element,
      (m: string): Promise<UsageHistory> =>
        context.request(`customers/${context.customer.id}/usage?month=${encodeURIComponent(m)}`),
    );
  }, [context]);

  return (
    <div ref={root}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <label htmlFor="action-usage-month" className="text-sm font-medium">Mes</label>
          <Input id="action-usage-month" data-usage-month type="month" min="2000-01" max={month} defaultValue={month} />
        </div>
        <IconButton label="Actualizar consumo" type="button" variant="outline" size="icon-sm" data-usage-refresh><RefreshCw aria-hidden="true" /></IconButton>
      </div>
      <div ref={body} />
    </div>
  );
}
