import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'aria-label' | 'children'> & {
  /** Texto del `aria-label` del botón y del tooltip, salvo que se pase `tip`. */
  label: string;
  /** Contenido del tooltip cuando no coincide con `label` (p. ej. solo la acción, sin el registro). */
  tip?: ReactNode;
  children: ReactNode;
};

/**
 * Botón de icono con tooltip: `label` alimenta el `aria-label` y el tooltip de
 * una vez. Variantes de `Button` pasan por `rest` (sin `aria-label`, que se
 * reserva para `label`).
 */
export function IconButton({ label, tip, children, ...rest }: IconButtonProps) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} {...rest}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent>{tip ?? label}</TooltipContent>
  </Tooltip>;
}
