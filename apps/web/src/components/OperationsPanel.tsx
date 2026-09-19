import { useSyncExternalStore } from 'react';
import { getOperations, getServerOperations, subscribeOperations } from '@/features/operations/operations-store';
import { BuildingsView } from './operations/BuildingsPanel';
import { SettingsView } from './operations/SettingsPanel';
import { UsersView } from './operations/UsersPanel';
import { BackupsView } from './operations/BackupsPanel';
import { AuditView } from './operations/AuditPanel';

/** Enrutador de secciones operativas: cada panel vive en `operations/`. */
export default function OperationsPanel() {
  const state = useSyncExternalStore(subscribeOperations, getOperations, getServerOperations);
  if (!state.visible || !state.context) return null;
  const context = state.context;
  const key = `${state.context.userId}:${state.context.page}`;
  if (context.page === 'buildings') return <BuildingsView key={key} context={context} />;
  if (context.page === 'settings') return <SettingsView key={key} context={context} />;
  if (context.page === 'users') return <UsersView key={key} context={context} />;
  if (context.page === 'backups') return <BackupsView key={key} context={context} />;
  return <AuditView key={`${key}:audit`} context={context} />;
}
