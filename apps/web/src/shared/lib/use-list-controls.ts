/**
 * useListControls — búsqueda, filtros y paginación de los listados del panel.
 *
 * La lógica (conteo de páginas, ajuste de página, recorte) vive en funciones
 * puras exportadas; el hook solo la conecta al estado de React. Dos modos:
 *  - Cliente (`items`): la lista completa vive en el componente y se filtra y
 *    pagina en el navegador (planes); el recorte se aplica con `slice`.
 *  - Servidor (`total`): el servidor ya trae la página; aquí se calcula el
 *    número de páginas y se pide otra con `setPage` (facturación, departamentos).
 */
import { useEffect, useState } from 'react';

// ---------- Lógica pura (testeable sin React) ----------

/** Número de páginas de un listado; siempre hay al menos una. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Página válida para un total dado: dentro de [1, pages]. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

/** Recorta la página `page` de una lista ya filtrada. */
export function slicePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}

// ---------- Hook ----------

export type ListControls = {
  page: number;
  pages: number;
  total: number;
  setPage: (next: number | ((current: number) => number)) => void;
  /** Recorta la página actual; en modo servidor devuelve la lista tal cual. */
  slice: <T>(items: readonly T[]) => T[];
  clamp: (page: number) => number;
};

const EMPTY: readonly unknown[] = [];

export function useListControls(options: { items: readonly unknown[]; pageSize: number; resetKeys?: readonly unknown[] }): ListControls;
export function useListControls(options: { total: number; pageSize: number; page: number; setPage: (next: number) => void }): ListControls;
export function useListControls(options: { items?: readonly unknown[]; total?: number; pageSize: number; page?: number; setPage?: (next: number) => void; resetKeys?: readonly unknown[] }): ListControls {
  const { pageSize } = options;
  const client = 'items' in options;
  const [clientPage, setClientPage] = useState(1);
  // En modo cliente reinicia la página al primer registro cuando cambian
  // búsqueda o filtros; en modo servidor lo hace el store (`filter`, `paginate`).
  const resetKeys = (client && options.resetKeys) || EMPTY;
  useEffect(() => { setClientPage(1); }, resetKeys); // eslint-disable-line react-hooks/exhaustive-deps

  if (client) {
    const items = options.items ?? EMPTY;
    const total = items.length;
    const pages = pageCount(total, pageSize);
    const page = Math.min(clientPage, pages);
    return {
      page, pages, total,
      setPage: next => setClientPage(current => {
        const target = typeof next === 'function' ? next(current) : next;
        return clampPage(target, total, pageSize);
      }),
      slice: <T,>(list: readonly T[]) => slicePage(list, page, pageSize),
      clamp: (value: number) => clampPage(value, total, pageSize),
    };
  }

  const total = options.total ?? 0;
  const requestPage = options.setPage ?? (() => {});
  return {
    page: options.page ?? 1,
    pages: pageCount(total, pageSize),
    total,
    setPage: (next: number | ((current: number) => number)) => {
      // `page` llega por props en cada render, así que `current` es la página viva.
      const target = typeof next === 'function' ? next(options.page ?? 1) : next;
      void requestPage(clampPage(target, total, pageSize));
    },
    slice: <T,>(list: readonly T[]) => list as T[],
    clamp: (value: number) => clampPage(value, total, pageSize),
  };
}
