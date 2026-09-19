/**
 * shared/dialog.tsx — componentes reutilizables para los dialogs del panel.
 *
 * Todo dialog del panel usa el patrón de header/footer fijos documentado en
 * `ui/dialog.tsx` y comparte estas reglas:
 *   - Mientras hay un envío pendiente no se cierra (Escape, clic fuera, botón).
 *   - Al cerrar el foco vuelve al botón que lo abrió (`useDialogFocus`).
 *   - El footer es Cancelar + acción principal con etiqueta de ocupación.
 *   - Los botones de envío fuera del <form> usan el atributo `form`.
 *
 * Composición típica:
 *   <PendingDialog busy={pending} onClose={close} restoreFocus={restore}>
 *     <DialogHead title="…" description="…" />
 *     <DialogBody>
 *       <form id="mi-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>…</form>
 *     </DialogBody>
 *     <SubmitRow form="mi-form" busy={pending} onClose={close} label="Guardar" />
 *   </PendingDialog>
 */
import { useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormError } from '@/components/panel-shell';
import { IconButton } from '@/components/shared/icon-button';
import { cn } from '@/lib/utils';

/** Shell de `DialogContent` con header y footer fijos; solo `DialogBody` hace scroll. */
const DIALOG_SHELL = 'flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0';
const DIALOG_HEAD = 'shrink-0 px-6 pt-6';
const DIALOG_FOOT = 'shrink-0 border-t px-6 py-4';

/**
 * Retiene el botón que abrió un diálogo para devolverle el foco al cerrar.
 * Capture el botón con `capture(event.currentTarget)` al abrir y pase `restore`
 * como `restoreFocus` del diálogo.
 */
export function useDialogFocus() {
  const trigger = useRef<HTMLButtonElement | null>(null);
  function capture(button: HTMLButtonElement) { trigger.current = button; }
  function restore() { trigger.current?.focus(); }
  return { capture, restore };
}

/**
 * Dialog que bloquea su cierre mientras `busy` es verdadero y devuelve el foco
 * al cerrarse. Los hijos se componen con `DialogHead`, `DialogBody` y footer.
 * Con `busy=false` el cierre pide `onClose` como cualquier dialog informativo.
 */
export function PendingDialog({ open = true, busy, onClose, restoreFocus, className, id, showCloseButton = !busy, children }: {
  /** Controlado para diálogos que se abren desde un store; por defecto visible. */
  open?: boolean;
  busy: boolean;
  onClose: () => void;
  restoreFocus?: () => void;
  /** Clases extra sobre el shell fijo, p. ej. `sm:max-w-3xl`. */
  className?: string;
  /** id del `DialogContent`; algunas pruebas lo usan como selector. */
  id?: string;
  showCloseButton?: boolean;
  children: ReactNode;
}) {
  return <Dialog open={open} onOpenChange={openState => { if (!openState && !busy) onClose(); }}>
    <DialogContent
      id={id}
      className={cn(DIALOG_SHELL, className)}
      showCloseButton={showCloseButton}
      onOpenAutoFocus={event => {
        // El foco inicial va al propio diálogo y no a su primer control: si ese
        // control lleva tooltip, el tooltip se abre al recibir el foco, queda por
        // encima del diálogo y se queda la primera pulsación de Escape.
        event.preventDefault();
        (event.target as HTMLElement | null)?.focus?.();
      }}
      onCloseAutoFocus={event => { event.preventDefault(); restoreFocus?.(); }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onPointerDownOutside={event => { if (busy) event.preventDefault(); }}
    >
      {children}
    </DialogContent>
  </Dialog>;
}

/** Header fijo del dialog: título y descripción opcionales. */
export function DialogHead({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return <DialogHeader className={DIALOG_HEAD}>
    {title != null && <DialogTitle>{title}</DialogTitle>}
    {description != null && <DialogDescription>{description}</DialogDescription>}
  </DialogHeader>;
}

/** Footer fijo del dialog para footers a medida (recibos, pestañas, etc.). */
export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <DialogFooter className={cn(DIALOG_FOOT, className)}>{children}</DialogFooter>;
}

/** Campo de formulario estándar: etiqueta, control y texto de ayuda opcional. */
export function FormField({ id, label, hint, className, children }: {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('grid gap-2', className)}>
    {id
      ? <label htmlFor={id} className="text-sm font-medium">{label}</label>
      : <span className="text-sm font-medium">{label}</span>}
    {children}
    {hint != null && <p className="text-sm text-muted-foreground">{hint}</p>}
  </div>;
}

/**
 * Footer estándar de confirmación: Cancelar + acción principal. La acción envía
 * un `<form>` con `form={id}` o ejecuta `onConfirm`. `extra` añade botones
 * entre ambos (p. ej. imprimir).
 */
export function SubmitRow({ busy, onClose, label, busyLabel = 'Guardando…', cancelLabel = 'Cancelar', cancelDisabled, submitDisabled, submitVariant, form, onConfirm, extra }: {
  busy: boolean;
  onClose: () => void;
  /** Etiqueta del botón principal. */
  label: ReactNode;
  /** Etiqueta mientras `busy`. */
  busyLabel?: string;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  submitDisabled?: boolean;
  submitVariant?: 'default' | 'destructive';
  /** id del `<form>` a enviar; sin él, use `onConfirm`. */
  form?: string;
  onConfirm?: () => void;
  extra?: ReactNode;
}) {
  return <DialogActions>
    <Button type="button" variant="outline" onClick={onClose} disabled={busy || cancelDisabled}>{cancelLabel}</Button>
    {extra}
    {form
      ? <Button type="submit" form={form} variant={submitVariant} disabled={busy || submitDisabled}>{busy ? busyLabel : label}</Button>
      : <Button type="button" variant={submitVariant} disabled={busy || submitDisabled} onClick={onConfirm}>{busy ? busyLabel : label}</Button>}
  </DialogActions>;
}

/**
 * Dialog de confirmación para acciones destructivas o reversibles con una
 * promesa: Cancelar + confirmar, bloqueado mientras se ejecuta y con el error
 * en un `role="alert"`.
 */
export function ConfirmDialog({ title, message, confirmLabel, destructive, onConfirm, close, restoreFocus }: {
  title: string;
  message: string;
  confirmLabel: string;
  /** Usa el botón destructivo para acciones irreversibles. */
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  close: () => void;
  /** Sin él, Radix devuelve el foco a su origen por defecto. */
  restoreFocus?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title={title} description={message} />
    <DialogBody><FormError message={error} /></DialogBody>
    <SubmitRow busy={pending} onClose={close} label={confirmLabel} submitVariant={destructive ? 'destructive' : undefined}
      onConfirm={() => {
        setPending(true); setError('');
        onConfirm().then(close).catch(err => { setError(err instanceof Error ? err.message : 'No se pudo completar.'); setPending(false); });
      }} />
  </PendingDialog>;
}

/**
 * Barra de paginación compartida por las tablas del panel: anterior/siguiente
 * con tooltip y resumen «Página X de Y · N registros».
 */
export function Pagination({ page, pages, total, onPrev, onNext, disableAll, className }: {
  page: number;
  pages: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
  disableAll?: boolean;
  className?: string;
}) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>
    <IconButton label="Anteriores" type="button" variant="outline" size="icon-sm" disabled={page <= 1 || disableAll} onClick={onPrev}>
      <ChevronLeft className="size-4" aria-hidden="true" />
    </IconButton>
    <p className="text-sm">Página {page} de {pages} · {total} registros</p>
    <IconButton label="Siguientes" type="button" variant="outline" size="icon-sm" disabled={page >= pages || disableAll} onClick={onNext}>
      <ChevronRight className="size-4" aria-hidden="true" />
    </IconButton>
  </div>;
}
