import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from 'react';
import { getPlans, getServerPlans, subscribePlans } from '@/lib/plans-store';
import { getCustomers, getServerCustomers, subscribeCustomers } from '@/lib/customers-store';
import { getBilling, getServerBilling, subscribeBilling } from '@/lib/billing-store';
import { getOperations, getServerOperations, subscribeOperations } from '@/lib/operations-store';
import { getRouters, getServerRouters, subscribeRouters } from '@/lib/routers-store';
import { getCustomerAction, getServerCustomerAction, subscribeCustomerActions } from '@/lib/customer-actions-store';
import { getOverview, getServerOverview, subscribeOverview } from '@/lib/overview-store';
import { ListSkeleton } from '@/components/ui/skeleton';

const Overview = lazy(() => import('./OverviewPanel'));
const Plans = lazy(() => import('./PlansPanel'));
const Customers = lazy(() => import('./CustomersPanel'));
const Billing = lazy(() => import('./BillingPanel'));
const Operations = lazy(() => import('./OperationsPanel'));
const Routers = lazy(() => import('./RoutersPanel'));
const CustomerActions = lazy(() => import('./CustomerActions'));

class PanelError extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <p role="alert">No se pudo cargar esta sección. <button type="button" onClick={() => location.reload()}>Recargar página</button></p>;
    return this.props.children;
  }
}

export default function DeferredPanels() {
  const overview = useSyncExternalStore(subscribeOverview, getOverview, getServerOverview);
  const plans = useSyncExternalStore(subscribePlans, getPlans, getServerPlans);
  const customers = useSyncExternalStore(subscribeCustomers, getCustomers, getServerCustomers);
  const billing = useSyncExternalStore(subscribeBilling, getBilling, getServerBilling);
  const operations = useSyncExternalStore(subscribeOperations, getOperations, getServerOperations);
  const routers = useSyncExternalStore(subscribeRouters, getRouters, getServerRouters);
  const action = useSyncExternalStore(subscribeCustomerActions, getCustomerAction, getServerCustomerAction);
  return <>
    <PanelError><Suspense fallback={<div role="status" aria-label="Cargando sección…" className="grid gap-6 py-6"><ListSkeleton rows={4} /></div>}>
      {overview.context && <Overview />}
      {plans.visible && <Plans />}
      {customers.context && <Customers />}
      {billing.visible && <Billing />}
      {operations.visible && <Operations />}
      {routers.visible && <Routers />}
    </Suspense></PanelError>
    <PanelError><Suspense fallback={<p role="status">Cargando acción…</p>}>
      {action && <CustomerActions />}
    </Suspense></PanelError>
  </>;
}
