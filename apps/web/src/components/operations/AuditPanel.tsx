import { useEffect, useState } from 'react';
import { TableCell, TableRow } from '@/components/ui/table';
import { PanelShell } from '@/components/panel-shell';
import { DataTable } from '@/components/shared/table';
import { type OperationsContext } from '@/features/operations/operations-store';
import type { AuditItem } from './types';

// ---------- Auditoría ----------

export function AuditView({ context }: { context: OperationsContext }) {
  const [list, setList] = useState<AuditItem[] | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    context.request('audit').then(a => { if (!cancelled) setList(Array.isArray(a) ? a : []); }).catch(() => { if (!cancelled) { setList([]); setNotice('No se pudo cargar la auditoría.'); } });
    return () => { cancelled = true; };
  }, [context]);
  return <PanelShell title="Auditoría" description="Últimas 200 operaciones realizadas por usuarios autenticados."
    notice={notice}>
    <DataTable
      headings={['Fecha', 'Usuario', 'Operación']}
      empty="Sin movimientos registrados todavía."
      rows={(list || []).map((a, i) => <TableRow key={i}>
        <TableCell>{context.date(a.created_at)}</TableCell>
        <TableCell>{a.username}</TableCell>
        <TableCell>{a.action}</TableCell>
      </TableRow>)} />
  </PanelShell>;
}
