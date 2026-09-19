import { useState, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableCell, TableRow } from '@/components/ui/table';
import { PanelShell } from '@/components/panel-shell';
import { DataTable } from '@/components/shared/table';
import { getOverview, getServerOverview, subscribeOverview, type OverviewContext } from '@/features/overview/overview-store';
import { overviewView } from '@/lib/pages';

const networkLabels: Record<string, string> = { pending: 'Pendiente', running: 'Aplicando', applied: 'Aplicado', failed: 'Fallido', legacy_failed: 'Fallo histórico' };
const taskNames: Record<string, string> = { usage: 'Consumo', linked: 'Vinculación', network: 'Red', overdue: 'Vencimientos', billing: 'Facturación', backups: 'Respaldos', sessions: 'Sesiones' };
const taskLabel = (name: string) => taskNames[name] || (String(name).startsWith('router:') ? `Router ${String(name).slice(7)}` : name);

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'failed' ? 'outline-destructive' : 'outline'}>{networkLabels[status] || status}</Badge>;
}

function OverviewView({ context, notice }: { context: OverviewContext; notice: string }) {
  const { summary } = context;
  const cards: [string, string, string][] = [
    ['Departamentos', String(summary?.customers ?? 0), 'Unidades vigentes'],
    ['Servicios activos', String(summary?.active ?? 0), 'Estado solicitado; verifica la red'],
  ];
  if (context.isAdmin) {
    cards.push(['Cobrado este mes', context.money(summary?.collected ?? 0), 'Pagos recibidos, excluye reversiones']);
    cards.push(['Saldo vencido', context.money(summary?.overdue ?? 0), 'Descuenta los abonos recibidos']);
  }
  return <PanelShell id="overview-panel" title="Tu edificio, conectado." description="Administra el servicio de internet desde un solo lugar." notice={notice}>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([title, value, note]) => <Card key={title}>
      <CardContent><p className="text-sm text-muted-foreground">{title}</p><p className="mt-4 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">{value}</p><small className="mt-2 block text-sm text-muted-foreground">{note}</small></CardContent>
    </Card>)}</div>
  </PanelShell>;
}

function NetworkView({ context, notice, setNotice }: { context: OverviewContext; notice: string; setNotice: (value: string) => void }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  async function retry(id: string) {
    if (retrying !== null) return;
    setRetrying(id); setNotice('');
    try { await context.request('network/retry', { id }); await context.refresh(); }
    catch (err) { setNotice(err instanceof Error ? err.message : 'No se pudo reintentar la orden.'); }
    finally { setRetrying(null); }
  }
  return <PanelShell id="network-panel" tone="destructive" title="Control de acceso" description="Órdenes persistentes con reintento automático. Una orden fallida permanece visible." notice={notice}>
    <DataTable
      headings={['Departamento', 'Orden', 'Resultado', 'Intentos', 'Próximo intento', 'Acción']}
      empty="Sin órdenes de acceso pendientes."
      rows={context.commands.map(command => <TableRow key={command.id}>
          <TableCell>{command.apartment}</TableCell>
          <TableCell>{command.action === 'activate' ? 'Activar' : 'Suspender'}</TableCell>
          <TableCell><StatusBadge status={command.status} />{command.last_error && <small className="mt-1 block text-muted-foreground">{command.last_error}</small>}</TableCell>
          <TableCell>{command.attempts}</TableCell>
          <TableCell>{['failed', 'pending'].includes(command.status) ? context.date(command.next_attempt || '') : '—'}</TableCell>
          <TableCell>{command.status === 'failed' && context.superadmin ? <Button type="button" variant="outline" size="icon-sm" title="Reintentar" aria-label={`Reintentar orden de ${command.apartment}`} disabled={retrying !== null} onClick={() => { void retry(command.id); }}><RotateCcw aria-hidden="true" /></Button> : null}</TableCell>
        </TableRow>)} />
  </PanelShell>;
}

function ActivityView({ context, notice }: { context: OverviewContext; notice: string }) {
  const tasks = [...(context.automation.tasks || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const queue = context.automation.queue || { pending: 0, failed: 0, oldest: null };
  const oldest = queue.oldest ? `, más antigua: ${context.date(queue.oldest)}` : '';
  return <PanelShell id="activity-panel" title="Actividad" description="Últimos 40 movimientos." notice={notice}>
    <Card><CardContent className="grid gap-4">
      <div><h2 className="text-lg font-semibold">Tareas automáticas</h2><p className="text-sm text-muted-foreground">Cola de red: {queue.pending} pendientes, {queue.failed} fallidas{oldest}.</p></div>
      <DataTable
        variant="plain"
        headings={['Tarea', 'Último éxito', 'Duración', 'Último error']}
        empty="Sin tareas automáticas ejecutadas."
        rows={tasks.map(task => <TableRow key={task.name}>
          <TableCell>{taskLabel(task.name)}</TableCell>
          <TableCell>{task.last_success ? context.date(task.last_success) : '—'}</TableCell>
          <TableCell>{task.duration_ms != null ? `${task.duration_ms} ms` : '—'}</TableCell>
          <TableCell>{task.last_error || '—'}</TableCell>
        </TableRow>)} />
    </CardContent></Card>
    <Card><CardContent className="grid gap-2">
      <h2 className="text-lg font-semibold">Movimientos</h2>
      <ul className="grid text-sm">{context.events.map((event, index) => <li key={`${event.created_at}:${index}`} className="border-b py-4 last:border-0">
        {event.message}<small className="mt-1 block text-xs text-muted-foreground">{context.date(event.created_at)} · {event.actor || 'Sistema'}</small>
      </li>)}</ul>
      {!context.events.length && <p className="text-sm text-muted-foreground">No hay movimientos registrados.</p>}
    </CardContent></Card>
  </PanelShell>;
}

function OverviewPanelView({ context }: { context: OverviewContext }) {
  const [notice, setNotice] = useState('');
  const view = overviewView(context.page);
  if (view === 'network') return <NetworkView context={context} notice={notice} setNotice={setNotice} />;
  if (view === 'activity') return <ActivityView context={context} notice={notice} />;
  return <OverviewView context={context} notice={notice} />;
}

export default function OverviewPanel() {
  const state = useSyncExternalStore(subscribeOverview, getOverview, getServerOverview);
  return state.context ? <OverviewPanelView key={`${state.context.userId}:${state.context.page}`} context={state.context} /> : null;
}
