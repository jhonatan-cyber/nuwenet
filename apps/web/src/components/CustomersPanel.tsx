/**
 * CustomersPanel — dispatcher de la sección de departamentos.
 *
 * Lista + paginación  → customers/CustomerList.tsx
 * Dialog alta/edición → customers/CustomerEditor.tsx
 */
import { useSyncExternalStore } from 'react';
import { getCustomers, getServerCustomers, subscribeCustomers } from '@/features/customers/customers-store';
import { CustomerList }   from './customers/CustomerList';
import { CustomerEditor } from './customers/CustomerEditor';

export default function CustomersPanel() {
  const state = useSyncExternalStore(subscribeCustomers, getCustomers, getServerCustomers);
  if (!state.context) return null;
  return (
    <div key={`${state.context.userId}:${state.context.buildingId}:${state.context.overview}`}>
      <CustomerList context={state.context} />
      {state.draft !== undefined && <CustomerEditor customer={state.draft} context={state.context} />}
    </div>
  );
}
