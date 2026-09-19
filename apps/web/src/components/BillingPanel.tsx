import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { ArrowLeftRight, CalendarClock, List, Plus, Printer, Receipt, RotateCcw, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { DialogHead, DialogActions, FormField, Pagination, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { getBilling, getServerBilling, subscribeBilling, type BillingContext, type Invoice, type Payment } from '@/features/billing/billing-store';
import { receiptHtml, printReceipt } from '@/shared/lib/receipt';
import { useListControls } from '@/shared/lib/use-list-controls';
import { IconButton } from '@/components/shared/icon-button';

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
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title="Generar mensualidades" description="Se generan cuotas para departamentos vigentes con plan asignado, sin duplicar periodos." />
    <DialogBody><form id="billing-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
      <FormField id="billing-period" label="Periodo"><Input id="billing-period" name="period" type="month" required defaultValue={context.today.slice(0, 7)} disabled={pending} /></FormField>
      <FormField id="billing-due" label="Fecha de vencimiento"><Input id="billing-due" name="due" type="date" required defaultValue={context.today} disabled={pending} /></FormField>
      <FormError message={error} />
    </form></DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Generar" busyLabel="Generando…" form="billing-form" />
  </PendingDialog>;
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
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title="Registrar pago" description={`Departamento ${invoice.apartment} · ${invoice.period}. Saldo: ${context.money(balance)}. Vacío = pago total.`} />
    <DialogBody><form id="pay-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
      <FormField id="pay-amount" label="Importe (opcional)"><Input id="pay-amount" name="amount" type="number" min="0.01" max={balance / 100} step="0.01" value={amountText} onChange={event => setAmountText(event.target.value)} disabled={pending} /></FormField>
      <FormField id="pay-method" label="Método"><NativeSelect id="pay-method" name="method" defaultValue="cash" disabled={pending}><NativeSelectOption value="cash">Efectivo</NativeSelectOption><NativeSelectOption value="other">Otro</NativeSelectOption></NativeSelect></FormField>
      <FormField id="pay-reference" label="Referencia"><Input id="pay-reference" name="reference" maxLength={160} disabled={pending} /></FormField>
      <FormError message={error} />
    </form></DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Guardar pago" form="pay-form" />
  </PendingDialog>;
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
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title={`Revertir pago #${payment.id}`} description="El pago original se conserva. Se reabre el saldo y, si está vencido, se solicita suspensión." />
    <DialogBody><form id="reverse-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
      <FormField id="reverse-reason" label="Motivo"><Input id="reverse-reason" name="reason" required maxLength={300} disabled={pending} /></FormField>
      <FormError message={error} />
    </form></DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Revertir" busyLabel="Revirtiendo…" form="reverse-form" />
  </PendingDialog>;
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
  return <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title={`Recibo #${payment.id}`} description="Comprobante interno de pago." />
    <DialogBody>
      {error ? <FormError message={error} /> : html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-sm text-muted-foreground">Cargando recibo…</p>}
      <FormField id="ticket-width" label="Papel"><NativeSelect id="ticket-width" value={width} onChange={event => setWidth(event.target.value)}><NativeSelectOption value="80">80 mm</NativeSelectOption><NativeSelectOption value="58">58 mm</NativeSelectOption></NativeSelect></FormField>
    </DialogBody>
    <DialogActions>
      <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
      <IconButton label="Imprimir / guardar PDF" type="button" size="icon-sm" disabled={!receipt.current} onClick={() => { if (receipt.current) printReceipt(receipt.current, context.currency, Number(width)); }}><Printer aria-hidden="true" /></IconButton>
    </DialogActions>
  </PendingDialog>;
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
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title="Revisar vencimientos" description="¿Revisar vencimientos y solicitar suspensión de servicios en mora, respetando los días de gracia?" />
    <DialogBody><form id="overdue-form" onSubmit={submit} aria-busy={pending} className="grid gap-4">
      <FormError message={error} />
    </form></DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Revisar" busyLabel="Revisando…" form="overdue-form" />
  </PendingDialog>;
}

function BillingView({ context }: { context: BillingContext }) {
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const { capture, restore } = useDialogFocus();
  const isBilling = context.page === 'billing';
  const pagination = isBilling ? context.pagination.invoices : context.pagination.payments;
  const list = useListControls({ total: pagination.total, pageSize: context.pagination.size, page: pagination.page,
    setPage: next => { context.paginate(isBilling ? 'invoices' : 'payments', next).catch(() => setNotice('No se pudo cambiar de página.')); } });
  const empty = isBilling ? !context.invoices.length : !context.payments.length;
  function open(next: Draft, button: HTMLButtonElement) { capture(button); setDraft(next); setNotice(''); }
  function close() { setDraft(undefined); }
  async function saved(message: string) {
    close(); setNotice(message);
    try { await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado.`); }
  }
  return <PanelShell id="billing-panel" title={isBilling ? 'Mensualidades y pagos' : 'Historial de pagos'}
    description={isBilling ? 'Los abonos reducen el saldo. Los bloqueos manuales se conservan al pagar.' : 'Recibos internos y reversiones con motivo; las operaciones originales se conservan.'}
    actions={isBilling ? <>
      {context.isAdmin && <IconButton label="Revisar vencimientos" type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'overdue' }, event.currentTarget)}><CalendarClock aria-hidden="true" /></IconButton>}
      {context.canPay && <IconButton label="Generar mensualidades" type="button" size="icon-sm" onClick={event => open({ type: 'billing' }, event.currentTarget)}><Plus aria-hidden="true" /></IconButton>}
    </> : undefined}>
    {context.customerId && <Card><CardContent className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">Estado de cuenta del departamento seleccionado.</p><IconButton label="Ver todos" type="button" variant="outline" size="icon-sm" onClick={() => { void context.clearStatement().catch(() => setNotice('No se pudo quitar el filtro.')); }}><List aria-hidden="true" /></IconButton><IconButton label={isBilling ? 'Ver pagos' : 'Ver mensualidades'} type="button" variant="outline" size="icon-sm" onClick={() => context.goto(isBilling ? 'payments' : 'billing')}><ArrowLeftRight aria-hidden="true" /></IconButton></CardContent></Card>}
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    {empty ? <Card><CardContent className="py-8 text-center"><p className="text-sm text-muted-foreground">{isBilling ? 'Aún no hay mensualidades generadas.' : 'Aún no hay pagos registrados.'}</p></CardContent></Card> : <>{isBilling ? <DataTable
      headings={['Departamento', 'Periodo', 'Vencimiento', 'Importe / saldo', 'Estado', 'Pago']}
      rows={context.invoices.map(i => {
          const balance = i.amount - Number(i.paid_total);
          const overdue = !i.paid_at && i.due < context.today;
          return <TableRow key={i.id}>
            <TableCell><strong>{i.apartment}</strong><br /><span className="text-muted-foreground">{i.name}</span></TableCell>
            <TableCell>{i.period}</TableCell>
            <TableCell>{i.due}</TableCell>
            <TableCell>{context.money(i.amount)}<br /><span className="text-muted-foreground">Saldo {context.money(balance)}</span></TableCell>
            <TableCell><StatusText tone={overdue ? 'danger' : 'default'}>{i.paid_at ? 'Pagada' : overdue ? 'Vencida' : 'Pendiente'}</StatusText>{Number(i.paid_total) > 0 && <><br /><span className="text-muted-foreground">Abonado {context.money(Number(i.paid_total))}</span></>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">{i.paid_at ? <span className="text-muted-foreground">{context.date(i.paid_at)}</span> : context.canPay ? <IconButton label={`Abonar / pago total · ${i.apartment} ${i.period}`} type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'pay', invoice: i }, event.currentTarget)}><Wallet aria-hidden="true" /></IconButton> : null}</div></TableCell>
          </TableRow>;
        })} /> : <DataTable
      headings={['Recibo', 'Departamento / periodo', 'Importe', 'Método / referencia', 'Fecha / usuario', 'Acciones']}
      rows={context.payments.map(p => <TableRow key={p.id}>
          <TableCell>#{p.id}{p.reversed_at && <><br /><span className="text-muted-foreground">Revertido: {p.reversal_reason}</span></>}</TableCell>
          <TableCell>{p.apartment}<br /><span className="text-muted-foreground">{p.period}</span></TableCell>
          <TableCell>{context.money(p.amount)}</TableCell>
          <TableCell>{methodLabels[p.method] || p.method}<br /><span className="text-muted-foreground">{p.reference}</span></TableCell>
          <TableCell>{context.date(p.created_at)}<br /><span className="text-muted-foreground">{p.actor || 'Histórico'}</span></TableCell>
          <TableCell><div className="flex flex-wrap gap-2"><IconButton label={`Ver recibo #${p.id}`} type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'receipt', payment: p }, event.currentTarget)}><Receipt aria-hidden="true" /></IconButton>{context.isAdmin && !p.reversed_at && <IconButton label={`Revertir pago #${p.id}`} type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'reverse', payment: p }, event.currentTarget)}><RotateCcw aria-hidden="true" /></IconButton>}</div></TableCell>
        </TableRow>)} />}</>}
    {!empty && <Pagination page={list.page} pages={list.pages} total={list.total} onPrev={() => { list.setPage(list.page - 1); }} onNext={() => { list.setPage(list.page + 1); }} />}
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
