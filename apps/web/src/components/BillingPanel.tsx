import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Plus, Receipt, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { getBilling, getServerBilling, subscribeBilling, type BillingContext, type Invoice, type Payment } from '@/lib/billing-store';
import { receiptHtml, printReceipt } from '@/scripts/receipt.js';

type Draft =
  | { type: 'billing' }
  | { type: 'pay'; invoice: Invoice }
  | { type: 'reverse'; payment: Payment }
  | { type: 'receipt'; payment: Payment }
  | { type: 'overdue' };

const methodLabels: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', qr: 'QR', other: 'Otro', legacy: 'Histórico' };

function BillingDialog({ context, close, saved, restoreFocus }: { context: BillingContext; close: () => void; saved: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values = new FormData(event.currentTarget);
    sending.current = true; setPending(true); setError('');
    try {
      await context.request('billing', {
        period: String(values.get('period') || ''),
        due: String(values.get('due') || ''),
        ...(context.buildingId ? { building_id: context.buildingId } : {}),
      });
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo generar las mensualidades.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Generar mensualidades</DialogTitle><DialogDescription>Se generan cuotas para departamentos vigentes con plan asignado, sin duplicar periodos.</DialogDescription></DialogHeader>
      <DialogBody><form id="billing-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="billing-period" className="text-sm font-medium">Periodo</label><Input id="billing-period" name="period" type="month" required defaultValue={context.today.slice(0, 7)} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="billing-due" className="text-sm font-medium">Fecha de vencimiento</label><Input id="billing-due" name="due" type="date" required defaultValue={context.today} disabled={pending} /></div>
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="billing-form" disabled={pending}>{pending ? 'Generando…' : 'Generar'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PayDialog({ context, invoice, close, saved, restoreFocus }: { context: BillingContext; invoice: Invoice; close: () => void; saved: () => void; restoreFocus: () => void }) {
  const balance = invoice.amount - Number(invoice.paid_total);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [amountText, setAmountText] = useState('');
  const sending = useRef(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values = new FormData(event.currentTarget);
    const raw = String(values.get('amount') || '').trim();
    if (raw) {
      const cents = Math.round(Number(raw) * 100);
      if (!Number.isFinite(cents) || cents < 1 || cents > balance) { setError(`El importe debe estar entre 0.01 y ${context.money(balance)}. Vacío = pago total.`); return; }
    }
    sending.current = true; setPending(true); setError('');
    try {
      await context.request('pay', {
        id: invoice.id,
        ...(raw ? { amount: Number(raw) } : {}),
        method: String(values.get('method') || 'cash'),
        reference: String(values.get('reference') || '').trim(),
        request_key: crypto.randomUUID(),
      });
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar el pago.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Registrar pago</DialogTitle><DialogDescription>Departamento {invoice.apartment} · {invoice.period}. Saldo: {context.money(balance)}. Vacío = pago total.</DialogDescription></DialogHeader>
      <DialogBody><form id="pay-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="pay-amount" className="text-sm font-medium">Importe (opcional)</label><Input id="pay-amount" name="amount" type="number" min="0.01" max={balance / 100} step="0.01" value={amountText} onChange={event => setAmountText(event.target.value)} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="pay-method" className="text-sm font-medium">Método</label><NativeSelect id="pay-method" name="method" defaultValue="cash" disabled={pending}><NativeSelectOption value="cash">Efectivo</NativeSelectOption><NativeSelectOption value="other">Otro</NativeSelectOption></NativeSelect></div>
        <div className="grid gap-2"><label htmlFor="pay-reference" className="text-sm font-medium">Referencia</label><Input id="pay-reference" name="reference" maxLength={160} disabled={pending} /></div>
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="pay-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar pago'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ReverseDialog({ context, payment, close, saved, restoreFocus }: { context: BillingContext; payment: Payment; close: () => void; saved: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
    if (!reason) { setError('Escribe el motivo de la reversión.'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      await context.request('payments/reverse', { id: payment.id, reason });
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo revertir el pago.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Revertir pago #{payment.id}</DialogTitle><DialogDescription>El pago original se conserva. Se reabre el saldo y, si está vencido, se solicita suspensión.</DialogDescription></DialogHeader>
      <DialogBody><form id="reverse-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="reverse-reason" className="text-sm font-medium">Motivo</label><Input id="reverse-reason" name="reason" required maxLength={300} disabled={pending} /></div>
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="reverse-form" disabled={pending}>{pending ? 'Revirtiendo…' : 'Revertir'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ReceiptDialog({ context, payment, close, restoreFocus }: { context: BillingContext; payment: Payment; close: () => void; restoreFocus: () => void }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');
  const [width, setWidth] = useState('80');
  const receipt = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    context.request(`payments/${payment.id}/receipt`).then(result => {
      if (cancelled) return;
      const p = { ...result.payment, building_name: result.payment.building_name || result.settings.building_name };
      receipt.current = p;
      setHtml(receiptHtml(p, context.currency));
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar el recibo.'); });
    return () => { cancelled = true; };
  }, [context, payment.id]);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Recibo #{payment.id}</DialogTitle><DialogDescription>Comprobante interno de pago.</DialogDescription></DialogHeader>
      <DialogBody>
      {error ? <FormError message={error} /> : html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-sm text-muted-foreground">Cargando recibo…</p>}
      <div className="grid gap-2"><label htmlFor="ticket-width" className="text-sm font-medium">Papel</label><NativeSelect id="ticket-width" value={width} onChange={event => setWidth(event.target.value)}><NativeSelectOption value="80">80 mm</NativeSelectOption><NativeSelectOption value="58">58 mm</NativeSelectOption></NativeSelect></div>
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button><Button type="button" disabled={!receipt.current} onClick={() => { if (receipt.current) printReceipt(receipt.current, context.currency, Number(width)); }}>Imprimir / guardar PDF</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function OverdueDialog({ context, close, saved, restoreFocus }: { context: BillingContext; close: () => void; saved: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try {
      await context.request('overdue', {});
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo revisar los vencimientos.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Revisar vencimientos</DialogTitle><DialogDescription>¿Revisar vencimientos y solicitar suspensión de servicios en mora, respetando los días de gracia?</DialogDescription></DialogHeader>
      <DialogBody><form id="overdue-form" onSubmit={submit} aria-busy={pending} className="grid gap-4">
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="overdue-form" disabled={pending}>{pending ? 'Revisando…' : 'Revisar'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function BillingView({ context }: { context: BillingContext }) {
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const isBilling = context.page === 'billing';
  const pagination = isBilling ? context.pagination.invoices : context.pagination.payments;
  const pages = Math.max(1, Math.ceil(pagination.total / context.pagination.size));
  function open(next: Draft, button: HTMLButtonElement) { trigger.current = button; setDraft(next); setNotice(''); }
  function close() { setDraft(undefined); }
  function restore() { trigger.current?.focus(); }
  async function saved(message: string) {
    close(); setNotice(message);
    try { await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado. Usa Actualizar.`); }
  }
  return <PanelShell id="billing-panel" title={isBilling ? 'Mensualidades y pagos' : 'Historial de pagos'}
    description={isBilling ? 'Los abonos reducen el saldo. Los bloqueos manuales se conservan al pagar.' : 'Recibos internos y reversiones con motivo; las operaciones originales se conservan.'}
    actions={<><Button type="button" variant="outline" onClick={() => { void context.refresh().catch(() => setNotice('No se pudo actualizar el listado. Reintenta.')); }}>Actualizar</Button>
      {isBilling && <>
        {context.isAdmin && <Button type="button" variant="outline" onClick={event => open({ type: 'overdue' }, event.currentTarget)}>Revisar vencimientos</Button>}
        {context.canPay && <Button type="button" onClick={event => open({ type: 'billing' }, event.currentTarget)}><Plus aria-hidden="true" />Generar mensualidades</Button>}
      </>}
    </>}>
    {context.customerId && <Card><CardContent className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Estado de cuenta del departamento seleccionado.</p><Button type="button" variant="outline" size="sm" onClick={() => { void context.clearStatement().catch(() => setNotice('No se pudo quitar el filtro.')); }}>Ver todos</Button><Button type="button" variant="outline" size="sm" onClick={() => context.goto(isBilling ? 'payments' : 'billing')}>{isBilling ? 'Ver pagos' : 'Ver mensualidades'}</Button></CardContent></Card>}
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    {isBilling ? <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Departamento', 'Periodo', 'Vencimiento', 'Importe / saldo', 'Estado', 'Pago'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{context.invoices.map(i => {
          const balance = i.amount - Number(i.paid_total);
          const overdue = !i.paid_at && i.due < context.today;
          return <TableRow key={i.id}>
            <TableCell><strong>{i.apartment}</strong><br /><span className="text-muted-foreground">{i.name}</span></TableCell>
            <TableCell>{i.period}</TableCell>
            <TableCell>{i.due}</TableCell>
            <TableCell>{context.money(i.amount)}<br /><span className="text-muted-foreground">Saldo {context.money(balance)}</span></TableCell>
            <TableCell><StatusText tone={overdue ? 'danger' : 'default'}>{i.paid_at ? 'Pagada' : overdue ? 'Vencida' : 'Pendiente'}</StatusText>{Number(i.paid_total) > 0 && <><br /><span className="text-muted-foreground">Abonado {context.money(Number(i.paid_total))}</span></>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">{i.paid_at ? <span className="text-muted-foreground">{context.date(i.paid_at)}</span> : context.canPay ? <Button type="button" variant="outline" size="sm" onClick={event => open({ type: 'pay', invoice: i }, event.currentTarget)}>Abonar / pago total</Button> : null}</div></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </CardContent></Card> : <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Recibo', 'Departamento / periodo', 'Importe', 'Método / referencia', 'Fecha / usuario', 'Acciones'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{context.payments.map(p => <TableRow key={p.id}>
          <TableCell>#{p.id}{p.reversed_at && <><br /><span className="text-muted-foreground">Revertido: {p.reversal_reason}</span></>}</TableCell>
          <TableCell>{p.apartment}<br /><span className="text-muted-foreground">{p.period}</span></TableCell>
          <TableCell>{context.money(p.amount)}</TableCell>
          <TableCell>{methodLabels[p.method] || p.method}<br /><span className="text-muted-foreground">{p.reference}</span></TableCell>
          <TableCell>{context.date(p.created_at)}<br /><span className="text-muted-foreground">{p.actor || 'Histórico'}</span></TableCell>
          <TableCell><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={event => open({ type: 'receipt', payment: p }, event.currentTarget)}><Receipt aria-hidden="true" />Ver recibo</Button>{context.isAdmin && !p.reversed_at && <Button type="button" variant="outline" size="sm" onClick={event => open({ type: 'reverse', payment: p }, event.currentTarget)}><RotateCcw aria-hidden="true" />Revertir</Button>}</div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>}
    {((isBilling ? context.invoices : context.payments) as unknown[]).length === 0 && <Card><CardContent><p className="text-sm text-muted-foreground">No hay registros.</p></CardContent></Card>}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={pagination.page <= 1} onClick={() => { void context.paginate(isBilling ? 'invoices' : 'payments', pagination.page - 1).catch(() => setNotice('No se pudo cambiar de página.')); }}>← Anteriores</Button><p className="text-sm">Página {pagination.page} de {pages} · {pagination.total} registros</p><Button type="button" variant="outline" disabled={pagination.page >= pages} onClick={() => { void context.paginate(isBilling ? 'invoices' : 'payments', pagination.page + 1).catch(() => setNotice('No se pudo cambiar de página.')); }}>Siguientes →</Button></div>
    {draft?.type === 'billing' && <BillingDialog context={context} close={close} saved={() => { void saved('Mensualidades generadas.'); }} restoreFocus={restore} />}
    {draft?.type === 'pay' && <PayDialog context={context} invoice={draft.invoice} close={close} saved={() => { void saved('Pago registrado.'); }} restoreFocus={restore} />}
    {draft?.type === 'reverse' && <ReverseDialog context={context} payment={draft.payment} close={close} saved={() => { void saved('Pago revertido.'); }} restoreFocus={restore} />}
    {draft?.type === 'receipt' && <ReceiptDialog context={context} payment={draft.payment} close={close} restoreFocus={restore} />}
    {draft?.type === 'overdue' && <OverdueDialog context={context} close={close} saved={() => { void saved('Revisión de vencimientos completada.'); }} restoreFocus={restore} />}
  </PanelShell>;
}

export default function BillingPanel() {
  const state = useSyncExternalStore(subscribeBilling, getBilling, getServerBilling);
  return state.visible && state.context ? <BillingView key={`${state.context.userId}:${state.context.buildingId}:${state.context.page}:${state.context.customerId || 0}`} context={state.context} /> : null;
}
