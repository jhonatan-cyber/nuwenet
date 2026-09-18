import { AsyncLocalStorage } from 'node:async_hooks';
export interface Actor { id: string; username: string; role: string }
export const requestContext = new AsyncLocalStorage<Actor>();

// B7: actor de sistema explícito para tareas internas (scheduler, cola,
// pruebas de infraestructura). La ausencia de contexto ya no otorga
// privilegios: los servicios deben rechazarla y el sistema debe usar este
// actor de forma deliberada.
export const SYSTEM_ACTOR: Actor = { id: 'system', username: 'Sistema', role: 'system' };
export function isSystem(actor: Actor | undefined): boolean {
  return actor?.role === 'system';
}
export function runAsSystem<T>(fn: () => T): T {
  return requestContext.run(SYSTEM_ACTOR, fn);
}
