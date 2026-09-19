/**
 * Reglas de useListControls, sin navegador:
 *  - Lógica pura: conteo de páginas, ajuste de página y recorte.
 *  - Modo cliente: primer render (página 1), recorte de la página actual,
 *    totales y recorte con listas vacías. La navegación con estado necesita
 *    renderizador: el ajuste de página queda fijado por `clampPage`.
 *  - Modo servidor: delega en `setPage` inyectado, clampeando a [1, pages],
 *    y no recorta la lista.
 *
 * El hook se monta con `renderToStaticMarkup` (react-dom/server): la sonda
 * captura los controles del primer render y los tests usan esa captura.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clampPage, pageCount, slicePage, useListControls, type ListControls } from '../../apps/web/src/shared/lib/use-list-controls';

/** Monta el hook en un render estático y devuelve los controles del primer render. */
function mount(props: Parameters<typeof useListControls>[0]): ListControls {
  let captured: ListControls | undefined;
  function Probe() {
    captured = useListControls(props);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(captured, 'el hook no se ejecutó');
  return captured!;
}

/** Espía de setPage para el modo servidor. */
function setPagesSpy(): { calls: number[]; fn: (next: number) => void } {
  const calls: number[] = [];
  return { calls, fn: next => { calls.push(next); } };
}

test('pageCount: siempre hay al menos una página', () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(1, 10), 1);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
  assert.equal(pageCount(48, 10), 5);
});

test('clampPage: mantiene la página dentro de [1, pages]', () => {
  assert.equal(clampPage(0, 100, 10), 1);
  assert.equal(clampPage(-3, 100, 10), 1);
  assert.equal(clampPage(5, 100, 10), 5);
  assert.equal(clampPage(99, 100, 10), 10);
  assert.equal(clampPage(99, 0, 10), 1);
});

test('slicePage: recorta la página pedida y devuelve [] fuera de rango', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(slicePage(items, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(slicePage(items, 2, 10), [11, 12]);
  assert.deepEqual(slicePage(items, 3, 10), []);
});

test('modo cliente: primer render arranca en la página 1 con recorte correcto', () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  const controls = mount({ items, pageSize: 10 });
  assert.equal(controls.page, 1);
  assert.equal(controls.pages, 2);
  assert.equal(controls.total, 12);
  assert.deepEqual(controls.slice(items), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('modo cliente: lista vacía da una página y recorte vacío', () => {
  const controls = mount({ items: [], pageSize: 10 });
  assert.equal(controls.page, 1);
  assert.equal(controls.pages, 1);
  assert.equal(controls.total, 0);
  assert.deepEqual(controls.slice([]), []);
});

test('modo servidor: expone la página pedida y delega clampeando', () => {
  const spy = setPagesSpy();
  const controls = mount({ total: 48, pageSize: 10, page: 2, setPage: spy.fn });
  assert.equal(controls.page, 2);
  assert.equal(controls.pages, 5);
  assert.equal(controls.total, 48);
  controls.setPage(3);
  assert.deepEqual(spy.calls, [3]);
  controls.setPage(99);
  assert.deepEqual(spy.calls, [3, 5]);
  controls.setPage(0);
  assert.deepEqual(spy.calls, [3, 5, 1]);
});

test('modo servidor: no recorta la lista que ya viene paginada', () => {
  const spy = setPagesSpy();
  const controls = mount({ total: 4, pageSize: 10, page: 1, setPage: spy.fn });
  assert.deepEqual(controls.slice(['a', 'b']), ['a', 'b']);
});

test('modo servidor: el updater funcional recibe la página actual', () => {
  const spy = setPagesSpy();
  const controls = mount({ total: 100, pageSize: 10, page: 4, setPage: spy.fn });
  controls.setPage(current => current + 1);
  assert.deepEqual(spy.calls, [5]);
  controls.setPage(current => current - 10);
  assert.deepEqual(spy.calls, [5, 1]);
});
