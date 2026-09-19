/** Query state of the panel shell: pagination, search and active filters. */
export interface PanelQuery {
  customer_page: number;
  invoice_page: number;
  payment_page: number;
  search: string;
  archived: string;
  building_id?: string;
  customer_id?: string;
}

const integerKeys = ['customer_page', 'invoice_page', 'payment_page'] as const;
const maxValue = 1000000;
const uuidv7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const defaultQuery = (): PanelQuery => ({ customer_page: 1, invoice_page: 1, payment_page: 1, search: '', archived: '0' });

/** Fresh query for another section; keeps the selected building. */
export function resetQuery(previous?: PanelQuery): PanelQuery {
  const next = defaultQuery();
  if (previous?.building_id) next.building_id = previous.building_id;
  return next;
}

/** Query for the newly selected building: filters and the chosen customer survive, pagination restarts. */
export function selectBuilding(query: PanelQuery, buildingId: string): PanelQuery {
  return { ...query, building_id: buildingId, customer_page: 1, invoice_page: 1, payment_page: 1 };
}

/** Query restored from the address bar on load. */
export function queryFromSearch(search: string): PanelQuery {
  const query = defaultQuery();
  const params = new URLSearchParams(search);
  for (const key of integerKeys) {
    const value = Number(params.get(key));
    if (Number.isInteger(value) && value > 0 && value <= maxValue) query[key] = value;
  }
  for (const key of ['building_id', 'customer_id'] as const) {
    const value = (params.get(key) || '').toLowerCase();
    if (uuidv7.test(value)) query[key] = value;
  }
  const text = params.get('search');
  if (text !== null) query.search = text.slice(0, 160);
  if (params.get('archived') === '1') query.archived = '1';
  return query;
}

/** URL parameters for the state endpoint and for the address bar. */
export function queryParams(query: PanelQuery, extra: Record<string, string | number> = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) {
    if (value === '' || value === null || value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}
