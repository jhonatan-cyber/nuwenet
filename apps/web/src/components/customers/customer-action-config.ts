/**
 * customer-action-config.ts
 * Configuración declarativa de cada "kind" de acción sobre un departamento.
 * Separa el qué (textos, rutas, payload) del cómo (render del dialog).
 */
import type { CustomerActionContext } from '@/features/customers/customer-actions-store';

export type ActionKind = NonNullable<CustomerActionContext['kind']>;

export interface ActionConfig {
  title(ctx: CustomerActionContext): string;
  description(ctx: CustomerActionContext): string;
  submitLabel(ctx: CustomerActionContext): string;
  route: string;
  buildBody(ctx: CustomerActionContext, values: FormData): Record<string, unknown>;
}

// Tipos de acción que no tienen formulario de submit propio
export const READ_ONLY_KINDS: ActionKind[] = ['portal-link', 'usage-history'];

export const actionConfig: Partial<Record<ActionKind, ActionConfig>> = {
  'rotate-portal-link': {
    title: ctx  => `Regenerar enlace de ${ctx.customer.apartment}`,
    description: () => 'Se invalidará de inmediato el enlace anterior. Pagos e historial se conservan. El nuevo enlace se mostrará una sola vez.',
    submitLabel: () => 'Regenerar e invalidar anterior',
    route: 'customers/portal-link',
    buildBody: ctx => ({ id: ctx.customer.id }),
  },
  'change-holder': {
    title: ctx  => `Cambio de titular de ${ctx.customer.apartment}`,
    description: () => 'Actualiza el titular e invalida el acceso anterior. El nuevo enlace se mostrará una sola vez.',
    submitLabel: () => 'Cambiar titular e invalidar acceso',
    route: 'customers/change-holder',
    buildBody: (ctx, values) => ({
      id: ctx.customer.id,
      name: String(values.get('name') || '').trim(),
      phone: String(values.get('phone') || '').trim(),
    }),
  },
  'set-ip': {
    title: ctx  => `IP de ${ctx.customer.apartment}`,
    description: () => 'Se limpiarán las reglas de la dirección anterior y se aplicará el estado del servicio a la nueva. Vacío para quitarla.',
    submitLabel: () => 'Guardar',
    route: 'customers/ip',
    buildBody: (ctx, values) => ({
      id: ctx.customer.id,
      ip: String(values.get('ip') || '').trim() || undefined,
    }),
  },
  archive: {
    title: ctx  => ctx.customer.archived ? 'Activar departamento' : 'Desactivar departamento',
    description: ctx => `${ctx.customer.archived ? 'Activar' : 'Desactivar y suspender'} el departamento ${ctx.customer.apartment}. Se conserva su historial.`,
    submitLabel: ctx => ctx.customer.archived ? 'Activar' : 'Desactivar',
    route: 'customers/archive',
    buildBody: ctx => ({ id: ctx.customer.id, archived: !ctx.customer.archived }),
  },
  access: {
    title: ctx  => ctx.customer.status === 'active' ? 'Cortar internet' : 'Reactivar internet',
    description: ctx => `${ctx.customer.status === 'active' ? 'Cortar' : 'Reactivar'} el internet del departamento ${ctx.customer.apartment}. La orden se enviará al equipo central configurado.`,
    submitLabel: ctx => ctx.customer.status === 'active' ? 'Cortar' : 'Reactivar',
    route: 'access',
    buildBody: ctx => ({ id: ctx.customer.id, status: ctx.customer.status === 'active' ? 'suspended' : 'active' }),
  },
};
