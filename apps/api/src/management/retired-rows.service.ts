import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ARCHIVE_MAX_PAGE, ARCHIVE_PAGE_LIMIT } from './retired-rows.dto';

// Único dueño de la lectura del archivo que deja la migración 28: filas de tablas
// heredadas que ya no tienen tabla propia. Aquí solo se lee y se exporta (nadie
// escribe salvo la migración). Sin ámbito por edificio: el contenido es jsonb
// heterogéneo y se consulta con permisos de super-admin, igual que los respaldos.
//
// Lo usan el endpoint de consulta y `scripts/database.mjs archive`, así que ambos
// caminos comparten formato, paginación y mensajes de error.

export interface ArchivedRow { id: string; retired_at: string; row: Record<string, unknown> }
export interface ArchivedTable { table_name: string; rows: number; retired_from: string; retired_to: string }
export interface ArchivedPage { table_name: string; total: number; limit: number; offset: number; rows: ArchivedRow[] }
export interface ArchivedExport { table_name: string; rows: number; content: string }

const ARCHIVE = 'retired_rows';
const BATCH = 1000;
const TABLE_NAME = /^[a-z][a-z0-9_]{0,40}$/;

// Celda CSV según RFC 4180: los objetos anidados se conservan como JSON.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Injectable()
export class RetiredRowsService {
  constructor(private readonly db: DatabaseService) {}

  // Inventario: qué tablas quedaron archivadas, cuántas filas y cuándo se
  // retiraron. Devuelve vacío si el esquema todavía no llegó a la migración 28.
  tables(): Promise<ArchivedTable[]> {
    return this.db.read(async tx => {
      const [archive] = await tx`SELECT to_regclass(${ARCHIVE}) AS name`;
      if (!archive.name) return [];
      return tx<ArchivedTable[]>`SELECT table_name, COUNT(*)::int AS rows, MIN(retired_at) AS retired_from, MAX(retired_at) AS retired_to
        FROM retired_rows GROUP BY table_name ORDER BY table_name`;
    });
  }

  async page(table: string, limit?: number, offset?: number): Promise<ArchivedPage> {
    await this.ensure(table);
    const size = limit ?? ARCHIVE_PAGE_LIMIT;
    if (!Number.isInteger(size) || size < 1 || size > ARCHIVE_MAX_PAGE) throw new BadRequestException(`limit debe estar entre 1 y ${ARCHIVE_MAX_PAGE}.`);
    const start = offset ?? 0;
    if (!Number.isInteger(start) || start < 0) throw new BadRequestException('offset debe ser un entero no negativo.');
    return this.db.read(async tx => {
      const [total] = await tx<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM retired_rows WHERE table_name=${table}`;
      const rows = await tx<ArchivedRow[]>`SELECT id, retired_at, row_data AS row FROM retired_rows WHERE table_name=${table}
        ORDER BY retired_at, id LIMIT ${size} OFFSET ${start}`;
      return { table_name: table, total: total.total, limit: size, offset: start, rows };
    });
  }

  // `csv` para abrir el archivo en una hoja de cálculo; `json` (una línea JSON por
  // fila) para recuperarlo sin pérdida. Se lee por lotes para no cargar la tabla
  // entera de una vez. El número de filas lo cuenta el propio exportador: en CSV no
  // se puede deducir del texto, porque una celda puede contener saltos de línea.
  async export(table: string, format: 'csv' | 'json' = 'csv'): Promise<ArchivedExport> {
    await this.ensure(table);
    const lines: string[] = [];
    let rows = 0;
    if (format === 'json') {
      for await (const batch of this.batch(table)) {
        for (const row of batch) {
          lines.push(JSON.stringify({ table_name: table, retired_at: row.retired_at, row: row.row }));
          rows++;}}
      return { table_name: table, rows, content: lines.length ? `${lines.join('\n')}\n` : '' };
    }
    // La cabecera es la unión de claves de las filas (jsonb ya las tiene ordenadas).
    const header = await this.db.read(async tx => (await tx<{ key: string }[]>`
      SELECT DISTINCT jsonb_object_keys(row_data) AS key FROM retired_rows WHERE table_name=${table} ORDER BY key`).map(entry => entry.key));
    lines.push(['retirado_en', ...header].map(csvCell).join(','));
    for await (const batch of this.batch(table)) {
      for (const row of batch) {
        lines.push([row.retired_at, ...header.map(key => csvCell(row.row[key]))].join(','));
        rows++;}}
    return { table_name: table, rows, content: `${lines.join('\r\n')}\r\n` };
  }

  private async *batch(table: string) {
    for (let offset = 0; ; offset += BATCH) {
      const rows = await this.db.read(tx => tx<ArchivedRow[]>`SELECT id, retired_at, row_data AS row FROM retired_rows
        WHERE table_name=${table} ORDER BY retired_at, id LIMIT ${BATCH} OFFSET ${offset}`);
      if (!rows.length) return;
      yield rows;
      if (rows.length < BATCH) return;
    }
  }

  // Un nombre arbitrario nunca llega a la consulta: primero tiene la forma de un
  // identificador y después tiene que existir en el archivo. El mensaje dice qué
  // hay disponible para no obligar a consultar el inventario aparte.
  private async ensure(table: string) {
    if (!TABLE_NAME.test(table)) throw new BadRequestException('Nombre de tabla inválido.');
    const archived = await this.tables();
    if (!archived.some(entry => entry.table_name === table)) {
      throw new BadRequestException(archived.length
        ? `No hay filas archivadas de "${table}". Tablas archivadas: ${archived.map(entry => entry.table_name).join(', ')}.`
        : 'Este esquema no tiene contenido archivado: la migración 28 aún no retiró ninguna tabla.');
    }
  }
}
