import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/roles.decorator';
import { ArchivedRowsQuery } from './retired-rows.dto';
import { RetiredRowsService } from './retired-rows.service';

// Consulta y exportación del archivo de la migración 28. Solo super-admin, como
// los respaldos: el contenido es heterogéneo (jsonb de tablas retiradas) y no
// tiene ámbito por edificio.
@Roles('superadmin')
@Controller('retired-rows')
export class RetiredRowsController {
  constructor(private readonly archived: RetiredRowsService) {}
  @Get() tables() { return this.archived.tables(); }
  @Get(':table') page(@Param('table') table: string, @Query() query: ArchivedRowsQuery) { return this.archived.page(table, query.limit, query.offset); }
  @Get(':table/export')
  async download(@Param('table') table: string, @Query() query: ArchivedRowsQuery, @Res({ passthrough: true }) res: Response) {
    const format = query.format ?? 'csv';
    const { rows, content } = await this.archived.export(table, format);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="archivo-${table}-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'ndjson'}"`);
    res.setHeader('X-Archived-Rows', String(rows));
    return content;
  }
}
