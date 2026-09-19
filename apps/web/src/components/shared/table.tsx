import { Children, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Listado con encabezado, filas y estado vacío, el esqueleto de tabla que antes
 * repetía cada panel. El mensaje vacío ocupa una sola fila con todas las columnas
 * a su alcance, así ninguna tabla queda con solo su cabecera.
 */

/** Cabecera suelta, o con clases propias para ocultarla en pantallas chicas, por ejemplo. */
type Heading = ReactNode | { label: ReactNode; className?: string };

function headingCell(heading: Heading): { label: ReactNode; className?: string } {
  return heading !== null && typeof heading === 'object' && 'label' in heading
    ? heading as { label: ReactNode; className?: string }
    : { label: heading as ReactNode };
}

export function DataTable({ headings, rows, empty, dense, variant = 'card', className, tableClassName }: {
  /** Celdas de cabecera, en orden; cada una puede ser un texto o `{ label, className }`. */
  headings: Heading[];
  /** Filas del cuerpo: un arreglo de `<TableRow>` o un solo nodo (por ejemplo un componente que las rinde). Sin filas se muestra el estado vacío. */
  rows: ReactNode;
  /** Mensaje de la fila única que se muestra cuando no hay filas. Omítelo (o pasa `null`) para no dibujar fila alguna, por ejemplo mientras el listado carga. */
  empty?: ReactNode;
  /** Celdas más compactas, para tablas dentro de una tarjeta de router o un diálogo. */
  dense?: boolean;
  /** Envoltura: `card` (listados de panel), `box` (caja con borde) o `plain` (sin envoltura). */
  variant?: 'card' | 'box' | 'plain';
  /** Clases de la envoltura. */
  className?: string;
  /** Clases de la propia `<table>`. */
  tableClassName?: string;
}) {
  const body = Children.toArray(rows);
  const table = <Table dense={dense} className={tableClassName}>
    <TableHeader><TableRow>{headings.map((heading, index) => {
      const { label, className: headClassName } = headingCell(heading);
      return <TableHead key={index} className={headClassName}>{label}</TableHead>;
    })}</TableRow></TableHeader>
    <TableBody>{body.length ? body : empty == null ? null : <TableRow><TableCell colSpan={headings.length} className="p-4 text-muted-foreground">{empty}</TableCell></TableRow>}</TableBody>
  </Table>;
  if (variant === 'plain') return table;
  if (variant === 'box') return <div className={cn('overflow-hidden rounded-lg border bg-card shadow-xs', className)}>{table}</div>;
  return <Card className={cn('overflow-hidden', className)}><CardContent className="p-0">{table}</CardContent></Card>;
}
