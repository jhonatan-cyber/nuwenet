/**
 * Catálogo interno de los componentes compartidos del panel (`shared/dialog.tsx`,
 * `shared/table.tsx`, `panel-shell.tsx`): cada sección muestra un componente en
 * sus variantes reales para revisión visual. Se monta desde `/catalogo` y no
 * forma parte del panel de gestión.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Printer, Search, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { ConfirmDialog, DialogActions, DialogHead, FormField, Pagination, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { IconButton } from '@/components/shared/icon-button';

type Draft = 'form' | 'info' | 'confirm' | 'error' | 'busy' | null;

type Sample = { id: string; apartment: string; holder: string; plan: string; debt: number; active: boolean };

const samples: Sample[] = [
  { id: '1', apartment: '101', holder: 'Ana Quispe', plan: 'Hogar 100', debt: 0, active: true },
  { id: '2', apartment: '102', holder: 'Luis Mamani', plan: 'Hogar 50', debt: 15000, active: true },
  { id: '3', apartment: '201', holder: 'Sin titular', plan: 'Sin plan', debt: 0, active: false },
];

function Section({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return <section id={id} className="grid gap-4 border-t pt-8">
    <div className="grid gap-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="grid gap-6">{children}</div>
  </section>;
}

/** Ejemplo de fila completa: estado, saldo y acciones de la tabla. */
function Rows({ onDelete }: { onDelete?: () => void }) {
  const [active, setActive] = useState<Record<string, boolean>>(() => Object.fromEntries(samples.map(sample => [sample.id, sample.active])));
  const rows = samples.map(sample => <TableRow key={sample.id}>
    <TableCell>
      <div className="flex items-center gap-2">
        <span className="text-base font-bold">{sample.apartment}</span>
        {!sample.active && <Badge variant="outline-destructive">Desactivado</Badge>}
      </div>
    </TableCell>
    <TableCell>{sample.holder}</TableCell>
    <TableCell>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{sample.plan}</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ArrowDown className="size-3" aria-hidden="true" /> 100
          <ArrowUp className="size-3" aria-hidden="true" /> 30 Mbps
        </span>
      </div>
    </TableCell>
    <TableCell>
      {sample.debt > 0
        ? <StatusText tone="danger">Debe Bs 150.00</StatusText>
        : <StatusText>Al día</StatusText>}
    </TableCell>
    <TableCell>
      <div className="flex items-center justify-end gap-2">
        <Switch size="sm" checked={active[sample.id]} onCheckedChange={value => setActive(current => ({ ...current, [sample.id]: value }))} aria-label={`Servicio de ${sample.apartment}`} />
        <IconButton label={`Editar ${sample.apartment}`} tip="Editar" type="button" variant="outline" size="icon-sm"><Pencil aria-hidden="true" /></IconButton>
        <IconButton label={`Eliminar ${sample.apartment}`} tip="Eliminar definitivamente" type="button" variant="outline" size="icon-sm" onClick={onDelete}><Trash2 aria-hidden="true" /></IconButton>
      </div>
    </TableCell>
  </TableRow>);
  return rows;
}

/** Diálogo con formulario: guarda de mentira y enseña el bloqueo mientras envía. */
function FormDialog({ close, restoreFocus }: { close: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title="Editar departamento" description="El guardado simulado dura un segundo: en ese momento el diálogo no se puede cerrar." />
    <DialogBody>
      <form id="catalog-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); setPending(true); window.setTimeout(() => { setPending(false); close(); }, 1000); }}>
        <FormField id="catalog-apartment" label="Departamento"><Input id="catalog-apartment" defaultValue="101" required disabled={pending} /></FormField>
        <FormField id="catalog-holder" label="Nombre del titular (opcional)" hint="Sin titular el departamento queda vacío."><Input id="catalog-holder" defaultValue="Ana Quispe" disabled={pending} /></FormField>
        <FormField id="catalog-plan" label="Plan"><NativeSelect id="catalog-plan" defaultValue="hogar-100" disabled={pending}>
          <NativeSelectOption value="hogar-100">Hogar 100</NativeSelectOption>
          <NativeSelectOption value="hogar-50">Hogar 50</NativeSelectOption>
        </NativeSelect></FormField>
        <FormField label="Servicio"><div className="flex items-center gap-2 text-sm"><Switch id="catalog-active" defaultChecked /> Activo</div></FormField>
      </form>
    </DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Guardar" form="catalog-form" />
  </PendingDialog>;
}

/** Diálogo informativo de solo lectura: footer a medida con una acción extra. */
function InfoDialog({ close, restoreFocus }: { close: () => void; restoreFocus: () => void }) {
  return <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus} className="sm:max-w-2xl">
    <DialogHead title="Recibo #1042" description="Comprobante interno de pago." />
    <DialogBody>
      <p className="text-sm text-muted-foreground">Aquí va el contenido del recibo. Se cierra con Escape, con el clic fuera, con la X o con «Cerrar»; el foco vuelve al botón que lo abrió.</p>
      <FormField id="catalog-width" label="Papel"><NativeSelect id="catalog-width" defaultValue="80">
        <NativeSelectOption value="80">80 mm</NativeSelectOption>
        <NativeSelectOption value="58">58 mm</NativeSelectOption>
      </NativeSelect></FormField>
    </DialogBody>
    <DialogActions>
      <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
      <IconButton label="Imprimir / guardar PDF" type="button" size="icon-sm"><Printer aria-hidden="true" /></IconButton>
    </DialogActions>
  </PendingDialog>;
}

export default function Catalog() {
  const [draft, setDraft] = useState<Draft>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyDemo, setBusyDemo] = useState(false);
  const [page, setPage] = useState(2);
  const { capture, restore } = useDialogFocus();
  const open = (next: Draft) => (event: { currentTarget: HTMLButtonElement }) => { capture(event.currentTarget); setDraft(next); };

  return <div className="grid gap-10">
    <Section id="panel" title="PanelShell" description="Chrome de cada sección: título, descripción, acciones y el aviso en vivo.">
      <PanelShell title="Planes de internet" description="Los cambios de precio se aplican a futuras mensualidades."
        notice="Plan guardado."
        actions={<>
          <IconButton label="Crear plan" type="button" size="icon-sm"><Plus aria-hidden="true" /></IconButton>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Buscar"><Search aria-hidden="true" /></Button>
        </>}>
        <Card><CardContent><p className="text-sm text-muted-foreground">Contenido de la sección.</p></CardContent></Card>
      </PanelShell>

      <PanelShell tone="destructive" title="Edificios" description="Aviso con tono destructivo y sin botones en la cabecera." notice="No se pudo guardar el edificio.">
        <Card><CardContent><p className="text-sm text-muted-foreground">Sin `actions` la cabecera no reserva espacio.</p></CardContent></Card>
      </PanelShell>
    </Section>

    <Section id="estado" title="StatusText, Badge y FormError" description="Los tres estados en línea que aparecen dentro de las tablas y los formularios.">
      <div className="flex flex-wrap items-center gap-6">
        <StatusText>Activo</StatusText>
        <StatusText tone="danger">Desactivado</StatusText>
        <Badge variant="outline"><Users aria-hidden="true" />3 deptos</Badge>
        <Badge variant="outline-destructive">Desactivado</Badge>
        <FormError message="No se pudo guardar el plan." />
      </div>
    </Section>

    <Section id="campos" title="FormField" description="Etiqueta, control y ayuda. Con `id` la etiqueta apunta al control; sin `id` es un grupo (checkbox, radio, fieldset).">
      <div className="grid max-w-2xl gap-4">
        <FormField id="catalog-field-a" label="Nombre del plan" hint="Hasta 160 caracteres."><Input id="catalog-field-a" defaultValue="Hogar 100" /></FormField>
        <FormField id="catalog-field-b" label="Precio mensual"><Input id="catalog-field-b" type="number" defaultValue={150} /></FormField>
        <FormField id="catalog-field-c" label="Edificio"><NativeSelect id="catalog-field-c" defaultValue="norte"><NativeSelectOption value="norte">Edificio Norte</NativeSelectOption></NativeSelect></FormField>
        <FormField label="Opciones del grupo"><div className="grid gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" defaultChecked /> DHCP en WAN</label>
          <label className="flex items-center gap-2"><input type="checkbox" /> NAT saliente</label>
        </div></FormField>
        <FormField id="catalog-field-d" label="Campo ocupado" hint="Mientras hay un envío los controles quedan deshabilitados."><Input id="catalog-field-d" defaultValue="No editable" disabled /></FormField>
      </div>
    </Section>

    <Section id="tablas" title="DataTable" description="Listado con encabezado, filas y estado vacío. Las filas son un arreglo de `TableRow` o un componente que las rinde. Variantes `card` (panel), `box` (caja con sombra) y `plain` (dentro de otra tarjeta), y `dense` para diálogos y tarjetas de router.">
      <DataTable
        headings={['Departamento', 'Titular', 'Plan y velocidad', 'Saldo', { label: 'Acciones', className: 'text-right' }]}
        tableClassName="[&_th:last-child]:text-right"
        rows={<Rows onDelete={() => setDeleting(true)} />} />

      <DataTable
        headings={['Departamento', 'Titular', 'Plan y velocidad', 'Saldo', { label: 'Acciones', className: 'text-right' }]}
        empty="No se encontraron departamentos con los filtros seleccionados."
        rows={[]} />

      <DataTable
        variant="box"
        headings={['Nombre', { label: 'Edificio', className: 'hidden sm:table-cell' }, { label: 'Uso', className: 'hidden md:table-cell' }, 'Precio']}
        tableClassName="[&_th:last-child]:text-right [&_td:last-child]:text-right"
        rows={[
          <TableRow key="100"><TableCell><span className="font-medium">Hogar 100</span></TableCell><TableCell className="hidden sm:table-cell text-muted-foreground">Edificio Norte</TableCell><TableCell className="hidden md:table-cell"><Badge variant="outline">12 deptos</Badge></TableCell><TableCell><span className="font-semibold tabular-nums">Bs 150,00</span></TableCell></TableRow>,
          <TableRow key="50" className="opacity-70"><TableCell><span className="font-medium">Hogar 50</span></TableCell><TableCell className="hidden sm:table-cell text-muted-foreground">Edificio Norte</TableCell><TableCell className="hidden md:table-cell"><Badge variant="outline">4 deptos</Badge></TableCell><TableCell><span className="font-semibold tabular-nums">Bs 90,00</span></TableCell></TableRow>,
        ]} />

      <Card><CardContent className="grid gap-4">
        <h3 className="text-lg font-semibold">Variante plana y densa, dentro de una tarjeta con su propio título</h3>
        <DataTable variant="plain" dense
          headings={['Servicio', 'Puerto', 'Estado', 'IP permitida']}
          rows={[
            <TableRow key="www"><TableCell><strong>www</strong></TableCell><TableCell>80</TableCell><TableCell>Activo</TableCell><TableCell>Cualquiera</TableCell></TableRow>,
            <TableRow key="api"><TableCell><strong>api</strong></TableCell><TableCell>8728</TableCell><TableCell>Activo</TableCell><TableCell>192.168.10.0/24</TableCell></TableRow>,
          ]} />
      </CardContent></Card>
    </Section>

    <Section id="paginacion" title="Pagination" description="Anterior/siguiente con tooltip y resumen. Se deshabilita en los extremos, durante un envío o con `disableAll`.">
      <Pagination page={page} pages={5} total={48} onPrev={() => setPage(current => Math.max(1, current - 1))} onNext={() => setPage(current => Math.min(5, current + 1))} />
      <Pagination page={1} pages={1} total={4} onPrev={() => {}} onNext={() => {}} />
      <Pagination page={3} pages={5} total={48} disableAll onPrev={() => {}} onNext={() => {}} />
      <Pagination page={2} pages={5} total={48} onPrev={() => {}} onNext={() => {}} />
    </Section>

    <Section id="dialogos" title="Diálogos" description="Escape, clic fuera, la X y Cancelar cierran; mientras hay un envío ninguna de las cuatro funciona. Al cerrar, el foco vuelve al botón que abrió el diálogo.">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={open('form')}>Diálogo con formulario</Button>
        <Button type="button" variant="outline" onClick={open('info')}>Diálogo informativo</Button>
        <Button type="button" variant="outline" onClick={open('confirm')}>Confirmación destructiva</Button>
        <Button type="button" variant="outline" onClick={open('error')}>Confirmación que falla</Button>
        <Button type="button" variant="outline" onClick={event => { capture(event.currentTarget); setBusyDemo(true); window.setTimeout(() => setBusyDemo(false), 5000); }}>Bloqueado durante 5 s</Button>
      </div>

      <Card><CardContent className="grid gap-3">
        <h3 className="text-lg font-semibold">SubmitRow fuera de un diálogo</h3>
        <p className="text-sm text-muted-foreground">El footer estándar: Cancelar + acción principal, con la etiqueta de ocupación y el botón deshabilitado mientras `busy`.</p>
        <div className="rounded-lg border">
          <SubmitRow busy={false} onClose={() => {}} label="Guardar" form="catalog-form" />
        </div>
        <div className="rounded-lg border">
          <SubmitRow busy onClose={() => {}} label="Guardar" busyLabel="Generando…" form="catalog-form" />
        </div>
        <div className="rounded-lg border">
          <SubmitRow busy={false} onClose={() => {}} label="Eliminar" submitVariant="destructive" onConfirm={() => {}} />
        </div>
      </CardContent></Card>
    </Section>

    {draft === 'form' && <FormDialog close={() => setDraft(null)} restoreFocus={restore} />}
    {draft === 'info' && <InfoDialog close={() => setDraft(null)} restoreFocus={restore} />}
    {draft === 'confirm' && <ConfirmDialog
      title="Eliminar plan"
      message="Esta acción es permanente. Vas a eliminar el plan Hogar 100. El backend rechazará la eliminación si aún tiene departamentos vigentes."
      confirmLabel="Sí, eliminar plan"
      destructive
      onConfirm={() => new Promise<void>(resolve => window.setTimeout(resolve, 700))}
      close={() => setDraft(null)}
      restoreFocus={restore} />}
    {draft === 'error' && <ConfirmDialog
      title="Quitar conexión"
      message="El equipo no responde: la operación falla y el error se anuncia en un role=alert con los botones rehabilitados."
      confirmLabel="Quitar"
      onConfirm={() => Promise.reject(new Error('No se pudo quitar la conexión: el router no respondió.'))}
      close={() => setDraft(null)}
      restoreFocus={restore} />}

    {busyDemo && <PendingDialog busy onClose={() => setBusyDemo(false)}>
      <DialogHead title="Envío en curso" description="Prueba Escape, el clic fuera y la X: el diálogo no cierra hasta que termina. Se cierra solo a los 5 segundos." />
      <DialogBody><p className="text-sm text-muted-foreground">Los botones del footer también están deshabilitados mientras dura el envío.</p></DialogBody>
      <SubmitRow busy onClose={() => setBusyDemo(false)} label="Guardar" busyLabel="Generando…" onConfirm={() => {}} />
    </PendingDialog>}

    {deleting && <ConfirmDialog
      title="Eliminar departamento"
      message="Vas a eliminar definitivamente 101 (Ana Quispe · Hogar 100). Se borran sus cuotas, pagos y consumo. Desactiva en su lugar si quieres conservar el historial."
      confirmLabel="Sí, eliminar definitivamente"
      destructive
      onConfirm={() => new Promise<void>(resolve => window.setTimeout(resolve, 500))}
      close={() => setDeleting(false)} />}
  </div>;
}
