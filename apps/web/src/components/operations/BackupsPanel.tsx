import { useEffect, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PanelShell } from '@/components/panel-shell';
import { DataTable } from '@/components/shared/table';
import { type OperationsContext } from '@/features/operations/operations-store';
import type { BackupItem } from './types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Respaldos ----------

export function BackupsView({ context }: { context: OperationsContext }) {
  const [list, setList] = useState<BackupItem[] | null>(null);
  const [policy, setPolicy] = useState<Record<string, any> | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, p] = await Promise.all([context.request('backups'), context.request('backups/policy')]);
        if (!cancelled) { setList(Array.isArray(b) ? b : []); setPolicy(p || {}); }
      } catch { if (!cancelled) setList([]); }
    })();
    return () => { cancelled = true; };
  }, [context]);
  async function reload() {
    try {
      const [b, p] = await Promise.all([context.request('backups'), context.request('backups/policy')]);
      setList(Array.isArray(b) ? b : []); setPolicy(p || {});
      await context.refresh();
    } catch { setNotice('No se pudo actualizar el listado.'); }
  }
  return <PanelShell title="Respaldos" description="Copias verificadas de la base y la clave de los routers."
    actions={<IconButton label={busy === 'new' ? 'Creando respaldo…' : 'Crear respaldo ahora'} type="button" size="icon-sm" disabled={busy !== null} onClick={() => { if (busy) return; setBusy('new'); context.request('backups', {}).then(() => { setNotice('Respaldo creado y verificado.'); return reload(); }).catch(err => setNotice(err instanceof Error ? err.message : 'No se pudo crear el respaldo.')).finally(() => setBusy(null)); }}><Plus aria-hidden="true" /></IconButton>} notice={notice}>
    <DataTable
      headings={['Respaldo', 'Fecha', 'Motor', 'Acción']}
      empty="Aún no hay respaldos. Crea el primero."
      rows={(list || []).map(b => <TableRow key={b.name}>
        <TableCell>{b.name}</TableCell>
        <TableCell>{context.date(b.created_at)}</TableCell>
        <TableCell>{b.driver}</TableCell>
        <TableCell><IconButton label={busy === b.name ? 'Verificando…' : `Verificar integridad · ${b.name}`} type="button" variant="outline" size="icon-sm" disabled={busy !== null} onClick={() => { if (busy) return; setBusy(b.name); context.request(`backups/${encodeURIComponent(b.name)}/verify`, {}).then(() => setNotice('Integridad del respaldo verificada.')).catch(err => setNotice(err instanceof Error ? err.message : 'No se pudo verificar.')).finally(() => setBusy(null)); }}><ShieldCheck aria-hidden="true" /></IconButton></TableCell>
      </TableRow>)} />
    {policy && <Card><CardContent><p className="text-sm text-muted-foreground">{policy.retention_days} días de retención; se conservan al menos {policy.minimum_copies} copias verificadas. Copia externa: {policy.external_configured ? (policy.external_available ? 'configurada' : 'destino no disponible') : 'pendiente de configurar'}. La restauración se realiza en un directorio nuevo, sin sobrescribir la base en uso. El procedimiento está documentado en la guía de operación del proyecto.</p></CardContent></Card>}
  </PanelShell>;
}
