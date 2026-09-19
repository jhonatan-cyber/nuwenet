import { useState } from 'react';
import { LayoutGrid, Table2, User, Phone, ArrowDown, ArrowUp, Pencil, BarChart3, ExternalLink, Receipt, Network, Archive, RotateCcw, Wifi, WifiOff, Search, Plus, MoreHorizontal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ConfirmDialog, Pagination } from '@/components/shared/dialog';
import { useListControls } from '@/shared/lib/use-list-controls';
import { IconButton } from '@/components/shared/icon-button';
import { DataTable } from '@/components/shared/table';
import { editCustomer, type Customer, type CustomersContext } from '@/features/customers/customers-store';

const networkLabels: Record<string, string> = {
  pending: 'Pendiente',
  running: 'Aplicando',
  applied: 'Aplicado',
  failed: 'Fallido',
  legacy_failed: 'Fallo histórico',
};

export function CustomerList({ context }: { context: CustomersContext }) {
  const [search, setSearch] = useState(context.search);
  const [notice, setNotice] = useState('');
  const [toDelete, setToDelete] = useState<Customer | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('nuwenet_customers_view') as 'cards' | 'table') || 'cards';
    }
    return 'cards';
  });

  const handleViewChange = (mode: 'cards' | 'table') => {
    setViewMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('nuwenet_customers_view', mode);
    }
  };

  const { page, pages, setPage } = useListControls({
    total: context.pagination.total,
    pageSize: context.size,
    page: context.pagination.page,
    setPage: next => { context.paginate(next).catch(() => setNotice('No se pudo cambiar de página.')); },
  });
  async function confirmDelete(customer: Customer) {
    if (!context.canEdit) return;
    setDeletePending(true);
    try {
      await context.save('customers/delete', { id: customer.id });
      setToDelete(null);
      setNotice(`Departamento ${customer.apartment} eliminado definitivamente.`);
      await context.refresh().catch(() => setNotice(`Departamento ${customer.apartment} eliminado, pero no se pudo actualizar el listado.`));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo eliminar el departamento.');
    } finally {
      setDeletePending(false);
    }
  }

  const actionIconMap: Record<string, { Icon: any; label: string; dynamic?: (c: Customer) => { Icon: any; label: string } }> = {
    'usage-history': { Icon: BarChart3, label: 'Consumo mensual' },
    'portal-link': { Icon: ExternalLink, label: 'Portal del residente' },
    'statement': { Icon: Receipt, label: 'Estado de cuenta' },
    'set-ip': { Icon: Network, label: 'Cambiar IP' },
    'archive': {
      Icon: Archive, label: 'Desactivar',
      dynamic: (c) => c.archived
        ? { Icon: RotateCcw, label: 'Activar' }
        : { Icon: Archive, label: 'Desactivar' }
    },
    'access': {
      Icon: WifiOff, label: 'Cortar internet',
      dynamic: (c) => c.status === 'active'
        ? { Icon: WifiOff, label: 'Cortar internet' }
        : { Icon: Wifi, label: 'Reactivar internet' }
    },
  };

  const action = (customer: Customer, name: string) => {
    const cfg = actionIconMap[name];
    if (!cfg) return null;
    const resolved = cfg.dynamic ? cfg.dynamic(customer) : cfg;
    const Icon = resolved.Icon;
    return (
      <IconButton
        key={name}
        label={resolved.label}
        type="button"
        variant="outline"
        size="icon-sm"
        data-action={name}
        data-id={customer.id}
      >
        <Icon aria-hidden="true" />
      </IconButton>
    );
  };

  return (
    <div id="customers-panel" className="grid gap-5 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          {context.overview ? (
            <h2 className="text-2xl font-semibold tracking-tight">Departamentos</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">Departamentos</h1>
          )}
          <p className="text-sm text-muted-foreground">Edita datos y planes; desactiva conservando el historial o elimina definitivamente.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Selector de vista */}
          <div className="inline-flex rounded-lg border bg-muted/40 p-1 shadow-2xs" role="group" aria-label="Cambiar vista">
            <IconButton
              label="Vista de tarjetas"
              type="button"
              variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
              size="icon-sm"
              className={`${viewMode === 'cards' ? 'shadow-xs' : 'text-muted-foreground'}`}
              onClick={() => handleViewChange('cards')}
              aria-pressed={viewMode === 'cards'}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Vista de tabla"
              type="button"
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="icon-sm"
              className={`${viewMode === 'table' ? 'shadow-xs' : 'text-muted-foreground'}`}
              onClick={() => handleViewChange('table')}
              aria-pressed={viewMode === 'table'}
            >
              <Table2 className="size-4" aria-hidden="true" />
            </IconButton>
          </div>

          {context.canEdit && (
            <IconButton label="Agregar departamento" onClick={() => editCustomer(null)} size="icon-sm">
              <Plus className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>

      {/* Filtros (solo en vista no-overview) */}
      {!context.overview && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={event => {
            event.preventDefault();
            void context.filter(search, context.archived).catch(() => setNotice('No se pudo buscar. Reintenta.'));
          }}
        >
          <div className="grid flex-1 gap-1.5 min-w-[200px]">
            <label className="text-sm font-medium" htmlFor="customer-search">
              Buscar departamento
            </label>
            <Input
              id="customer-search"
              placeholder="Departamento o titular"
              maxLength={160}
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <IconButton label="Buscar" type="submit" variant="outline" size="icon-sm">
            <Search className="size-4" aria-hidden="true" />
          </IconButton>
          <div className="grid gap-1.5">
            <label className="text-sm font-medium" htmlFor="archived-filter">
              Mostrar
            </label>
            <NativeSelect
              id="archived-filter"
              value={context.archived}
              onChange={event => {
                void context.filter(search, event.target.value).catch(() => setNotice('No se pudo cambiar el filtro.'));
              }}
            >
              <NativeSelectOption value="0">Activos</NativeSelectOption>
              <NativeSelectOption value="1">Desactivados</NativeSelectOption>
            </NativeSelect>
          </div>
        </form>
      )}

      <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>
        {notice}
      </p>

      {/* Vista de Contenido (Tarjetas o Tabla) */}
      {!context.customers.length ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No hay registros.</p>
          </CardContent>
        </Card>
      ) : viewMode === 'cards' ? (
        /* Tarjetas */
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {context.customers.map(customer => (
            <Card key={customer.id} data-customer-id={customer.id} className="min-w-0 transition-shadow hover:shadow-xs">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold tracking-tight text-foreground [overflow-wrap:anywhere]">
                        {customer.apartment}
                      </h3>
                      {customer.archived ? <Badge variant="outline-destructive">Desactivado</Badge> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium text-foreground/90 [overflow-wrap:anywhere]">
                        <User className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        {customer.name || 'Vacío · sin titular'}
                      </span>
                      {customer.phone && (
                        <span className="flex items-center gap-1 text-xs">
                          <Phone className="size-3 text-muted-foreground" aria-hidden="true" />
                          {customer.phone}
                        </span>
                      )}
                      {context.buildings.length > 1 && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {context.buildings.find(b => b.id === customer.building_id)?.name || `Edificio ${customer.building_id}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge
                      variant={customer.status === 'suspended' ? 'outline-destructive' : 'outline'}
                      className={`gap-1 font-medium ${customer.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : ''}`}
                    >
                      <span className={`size-1.5 rounded-full ${customer.status === 'suspended' ? 'bg-destructive' : 'bg-emerald-500'}`} />
                      {customer.status === 'suspended' ? 'Suspensión solicitada' : 'Servicio activo'}
                    </Badge>
                    {Number(customer.debt) > 0 ? (
                      <span className="text-xs font-semibold text-destructive">Debe {context.money(customer.debt)}</span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">● Al día</span>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-3">
                {/* Métricas e información técnica */}
                <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-3">
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Plan</span>
                    <p className="font-semibold text-xs text-foreground truncate mt-0.5">{customer.plan_name || 'Sin plan'}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      {customer.down != null && customer.up != null ? (
                        <>
                          <ArrowDown className="size-3 text-emerald-500" /> {customer.down}M
                          <span className="text-muted-foreground/50">/</span>
                          <ArrowUp className="size-3 text-blue-500" /> {customer.up}M
                        </>
                      ) : (
                        'Sin velocidad'
                      )}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">IP Privada</span>
                    <p className="font-mono font-medium text-xs text-foreground truncate mt-0.5">
                      {customer.ip || 'Sin IP'}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Red</span>
                    <p className="text-xs font-medium text-foreground truncate mt-0.5">
                      {!customer.ip ? 'Sin red' : (
                        <>
                          {customer.manual_hold ? 'Bloqueo · ' : ''}
                          {networkLabels[customer.network_state] || 'Sin verificar'}
                        </>
                      )}
                    </p>
                    {customer.ip && customer.network_checked_at && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {context.date(customer.network_checked_at)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                {context.canEdit && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {action(customer, 'usage-history')}
                    {action(customer, 'portal-link')}
                    <IconButton label={`Editar ${customer.apartment}`} tip="Editar" variant="outline" size="icon-sm" onClick={() => editCustomer(customer)}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </IconButton>
                    {action(customer, 'statement')}
                    {action(customer, 'set-ip')}
                    {action(customer, 'archive')}
                    {!customer.archived && action(customer, 'access')}
                    <IconButton label={`Eliminar ${customer.apartment}`} tip="Eliminar definitivamente" variant="outline" size="icon-sm" onClick={() => { setNotice(''); setToDelete(customer); }}>
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Tabla */
        <DataTable
          tableClassName="[&_th]:font-semibold [&_th:last-child]:pr-4 [&_th:last-child]:text-right"
          headings={['Depto.', 'Titular / Contacto', 'Plan', 'IP Privada', 'Estado', 'Red', 'Saldo', ...(context.canEdit ? ['Acciones'] : [])]}
          rows={context.customers.map(customer => (
                <TableRow key={customer.id} data-customer-id={customer.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-foreground">{customer.apartment}</span>
                      {customer.archived ? <Badge variant="outline-destructive">Desactivado</Badge> : null}
                    </div>
                    {context.buildings.length > 1 && (
                      <p className="text-xs text-muted-foreground">
                        {context.buildings.find(b => b.id === customer.building_id)?.name || `Edificio ${customer.building_id}`}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium">
                      <User className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                      <span className="[overflow-wrap:anywhere]">{customer.name || 'Sin titular'}</span>
                    </div>
                    {customer.phone && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                        <Phone className="size-3 text-muted-foreground shrink-0" aria-hidden="true" />
                        <span>{customer.phone}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{customer.plan_name || 'Sin plan'}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      {customer.down != null && customer.up != null ? (
                        <>
                          <ArrowDown className="size-3 text-emerald-500" aria-hidden="true" /> {customer.down}M
                          <span className="text-muted-foreground/50">/</span>
                          <ArrowUp className="size-3 text-blue-500" aria-hidden="true" /> {customer.up}M
                        </>
                      ) : (
                        'Sin velocidad'
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {customer.ip ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium text-foreground">
                        {customer.ip}
                      </code>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin IP</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={customer.status === 'suspended' ? 'outline-destructive' : 'outline'}
                      className={`gap-1 font-medium ${customer.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : ''}`}
                    >
                      <span className={`size-1.5 rounded-full ${customer.status === 'suspended' ? 'bg-destructive' : 'bg-emerald-500'}`} />
                      {customer.status === 'suspended' ? 'Suspensión solicitada' : 'Servicio activo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">
                      {!customer.ip ? (
                        <span className="text-muted-foreground">Sin red</span>
                      ) : (
                        <>
                          {customer.manual_hold && <span className="font-semibold text-destructive mr-1">Bloqueo manual ·</span>}
                          <span className="text-muted-foreground">{networkLabels[customer.network_state] || 'Sin verificar'}</span>
                          {customer.network_checked_at && (
                            <p className="text-[11px] text-muted-foreground/80 mt-0.5">{context.date(customer.network_checked_at)}</p>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {Number(customer.debt) > 0 ? (
                      <span className="font-semibold text-destructive">Debe {context.money(customer.debt)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" /> Al día
                      </span>
                    )}
                  </TableCell>
                  {context.canEdit && (
                    <TableCell className="text-right pr-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${customer.apartment}`}>
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem data-action="usage-history" data-id={customer.id}>
                            <BarChart3 aria-hidden="true" />
                            <span>Consumo mensual</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem data-action="portal-link" data-id={customer.id}>
                            <ExternalLink aria-hidden="true" />
                            <span>Portal del residente</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => editCustomer(customer)}>
                            <Pencil aria-hidden="true" />
                            <span>Editar</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem data-action="statement" data-id={customer.id}>
                            <Receipt aria-hidden="true" />
                            <span>Estado de cuenta</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem data-action="set-ip" data-id={customer.id}>
                            <Network aria-hidden="true" />
                            <span>Cambiar IP</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem data-action="archive" data-id={customer.id}>
                            {customer.archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}
                            <span>{customer.archived ? 'Activar' : 'Desactivar'}</span>
                          </DropdownMenuItem>
                          {!customer.archived && (
                            <DropdownMenuItem data-action="access" data-id={customer.id}>
                              {customer.status === 'active' ? <WifiOff aria-hidden="true" /> : <Wifi aria-hidden="true" />}
                              <span>{customer.status === 'active' ? 'Cortar internet' : 'Reactivar internet'}</span>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => { setNotice(''); setToDelete(customer); }} className="text-destructive focus:text-destructive">
                            <Trash2 aria-hidden="true" />
                            <span>Eliminar</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))} />
      )}

      {toDelete && <ConfirmDialog
        title="Eliminar departamento"
        message={[`Vas a eliminar definitivamente ${toDelete.apartment}${toDelete.name ? ` (${toDelete.name || 'Sin titular'}${toDelete.plan_name ? ` · ${toDelete.plan_name}` : ''})` : ''}.`,
          `Se borran sus cuotas, pagos, órdenes y consumo.${Number(toDelete.debt) > 0 ? ` Tiene saldo pendiente: ${context.money(toDelete.debt)}.` : ''} Desactiva en su lugar si quieres conservar el historial.`].join(' ')}
        confirmLabel="Sí, eliminar definitivamente"
        destructive
        onConfirm={() => confirmDelete(toDelete)}
        close={() => { if (!deletePending) setToDelete(null); }} />}

      {/* Paginación */}
      {!!context.customers.length && (
        <Pagination page={page} pages={pages} total={context.pagination.total} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
      )}
    </div>
  );
}
