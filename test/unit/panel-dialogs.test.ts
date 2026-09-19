/**
 * Reglas de los diálogos compartidos del panel, sin navegador:
 *   - Mientras hay un envío en curso ningún camino de cierre funciona
 *     (botón de cerrar, Escape, clic fuera) y los botones quedan deshabilitados.
 *   - Al cerrarse, el foco vuelve al botón que abrió el diálogo.
 *
 * Se ejecutan sobre el árbol de elementos que devuelve cada componente al
 * invocarlo (sin renderizarlo) y sobre el hook montado con `renderToStaticMarkup`.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../../apps/web/src/components/ui/button';
import { PendingDialog, SubmitRow, useDialogFocus } from '../../apps/web/src/components/shared/dialog';

type Node = ReactElement<Record<string, any>>;
type DialogProps = Parameters<typeof PendingDialog>[0];
type FocusApi = ReturnType<typeof useDialogFocus>;

/** Recorre el árbol de elementos devuelto por un componente (los hijos ya están creados). */
function collect(node: unknown, found: Node[] = []): Node[] {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach(child => collect(child, found)); return found; }
  const element = node as Node;
  if (element.type) found.push(element);
  collect(element.props?.children, found);
  return found;
}

/** Props del primer elemento del árbol que define `key`. */
function propsWith(tree: unknown, key: string): Record<string, any> {
  const hit = collect(tree).find(element => key in element.props);
  assert.ok(hit, `no se encontró un elemento con ${key}`);
  return hit.props;
}

/** Ejecuta un manejador de cierre y devuelve si pidió cancelar la acción por defecto. */
function press(handler: unknown): number {
  let prevented = 0;
  (handler as (event: { preventDefault: () => void }) => void)({ preventDefault: () => { prevented += 1; } });
  return prevented;
}

/** Botones del footer, en orden. */
const buttonsOf = (tree: unknown) => collect(tree).filter(element => element.type === Button).map(element => element.props);

const dialog = (props: Partial<DialogProps> = {}) => PendingDialog({
  busy: false,
  onClose: () => {},
  children: null,
  ...props,
} as DialogProps);

test('PendingDialog: con un envío en curso ningún camino de cierre escapa al bloqueo', () => {
  let closed = 0;
  const tree = dialog({ busy: true, onClose: () => { closed += 1; } });
  const state = propsWith(tree, 'onOpenChange');
  const content = propsWith(tree, 'onEscapeKeyDown');

  state.onOpenChange(false);
  assert.equal(closed, 0, 'el cambio a cerrado no cierra mientras envía');
  assert.equal(press(content.onEscapeKeyDown), 1, 'Escape se cancela');
  assert.equal(press(content.onPointerDownOutside), 1, 'el clic fuera se cancela');
  assert.equal(content.showCloseButton, false, 'el botón de cerrar se oculta');
});

test('PendingDialog: sin envío en curso cierra por cualquiera de los caminos', () => {
  let closed = 0;
  const tree = dialog({ onClose: () => { closed += 1; } });
  const state = propsWith(tree, 'onOpenChange');
  const content = propsWith(tree, 'onEscapeKeyDown');

  state.onOpenChange(false);
  assert.equal(closed, 1, 'cerrar de verdad llama a onClose');
  assert.equal(press(content.onEscapeKeyDown), 0, 'Escape no se cancela');
  assert.equal(press(content.onPointerDownOutside), 0, 'el clic fuera no se cancela');
  assert.equal(content.showCloseButton, true, 'el botón de cerrar se muestra');
});

test('PendingDialog: abrir nunca cierra y `open` puede venir del store', () => {
  let closed = 0;
  const tree = dialog({ open: false, onClose: () => { closed += 1; } });

  propsWith(tree, 'onOpenChange').onOpenChange(true);
  assert.equal(closed, 0, 'la apertura nunca cierra');
  assert.equal(propsWith(tree, 'open').open, false, 'respeta `open` controlado');
  assert.equal(dialog().props.open, true, 'visible por defecto');
});

test('PendingDialog: el foco inicial va al diálogo, no a su primer control', () => {
  const content = propsWith(dialog(), 'onOpenAutoFocus');
  let focused = 0;
  let prevented = 0;
  content.onOpenAutoFocus({ preventDefault: () => { prevented += 1; }, target: { focus: () => { focused += 1; } } });
  assert.equal(prevented, 1, 'cancela el foco automático de Radix');
  assert.equal(focused, 1, 'enfoca el contenedor del diálogo');

  let withoutTarget = 0;
  const event = { preventDefault: () => { withoutTarget += 1; }, target: null };
  content.onOpenAutoFocus(event);
  assert.equal(withoutTarget, 1, 'sin contenedor tampoco falla');
});

test('PendingDialog: al cerrarse devuelve el foco y anula el que daría el navegador', () => {
  let restored = 0;
  const tree = dialog({ restoreFocus: () => { restored += 1; } });
  const content = propsWith(tree, 'onCloseAutoFocus');

  assert.equal(press(content.onCloseAutoFocus), 1, 'evita que el navegador mueva el foco');
  assert.equal(restored, 1, 'devuelve el foco al botón que lo abrió');
});

test('PendingDialog: sin disparador registrado el cierre no falla', () => {
  const content = propsWith(dialog(), 'onCloseAutoFocus');
  assert.equal(press(content.onCloseAutoFocus), 1, 'sigue anulando el foco por defecto');
});

test('SubmitRow: durante el envío Cancelar y la acción quedan deshabilitados', () => {
  const [cancel, submit] = buttonsOf(SubmitRow({ busy: true, onClose: () => {}, label: 'Guardar', form: 'plan-form' }));

  assert.equal(cancel.disabled, true, 'Cancelar queda deshabilitado');
  assert.equal(cancel.children, 'Cancelar');
  assert.equal(submit.disabled, true, 'la acción principal queda deshabilitada');
  assert.equal(submit.children, 'Guardando…', 'muestra la etiqueta de ocupación');
  assert.equal(submit.form, 'plan-form', 'el envío apunta al formulario del diálogo');
});

test('SubmitRow: en reposo muestra la etiqueta real y sus variantes', () => {
  const [cancel, submit] = buttonsOf(SubmitRow({ busy: false, onClose: () => {}, label: 'Guardar', busyLabel: 'Generando…', form: 'pay-form' }));
  assert.ok(!cancel.disabled, 'Cancelar queda habilitado');
  assert.ok(!submit.disabled, 'la acción queda habilitada');
  assert.equal(submit.children, 'Guardar', 'no usa la etiqueta de ocupación en reposo');
  assert.equal(submit.type, 'submit', 'el botón envía el formulario');

  let confirmed = 0;
  const [cancelConfirm, confirm] = buttonsOf(SubmitRow({ busy: false, onClose: () => {}, label: 'Eliminar', submitVariant: 'destructive', onConfirm: () => { confirmed += 1; } }));
  assert.ok(!cancelConfirm.disabled, 'Cancelar queda habilitado');
  assert.equal(confirm.children, 'Eliminar');
  assert.equal(confirm.type, 'button', 'sin form no envía nada');
  confirm.onClick();
  assert.equal(confirmed, 1, 'sin form ejecuta onConfirm');
});

test('SubmitRow: los interruptores de cancelar y de la acción son independientes', () => {
  const [cancel, submit] = buttonsOf(SubmitRow({ busy: false, onClose: () => {}, label: 'Revisar', cancelDisabled: true, submitDisabled: true }));
  assert.equal(cancel.disabled, true, 'Cancelar respeta su propio bloqueo');
  assert.equal(submit.disabled, true, 'la acción respeta su propio bloqueo');
});

test('useDialogFocus: devuelve el foco al último botón capturado', () => {
  let api: FocusApi | null = null;
  function Harness() { api = useDialogFocus(); return null; }
  renderToStaticMarkup(createElement(Harness));
  assert.ok(api, 'el hook entrega capture y restore');
  const hook = api as FocusApi;

  const calls = { first: 0, second: 0 };
  const first = { focus: () => { calls.first += 1; } } as unknown as HTMLButtonElement;
  const second = { focus: () => { calls.second += 1; } } as unknown as HTMLButtonElement;

  hook.restore();
  assert.equal(calls.first + calls.second, 0, 'sin captura previa no mueve el foco');

  hook.capture(first);
  hook.restore();
  assert.equal(calls.first, 1, 'devuelve el foco al disparador');

  hook.capture(second);
  hook.restore();
  assert.equal(calls.second, 1, 'gana el último disparador capturado');
  assert.equal(calls.first, 1, 'el disparador anterior ya no se usa');
});
