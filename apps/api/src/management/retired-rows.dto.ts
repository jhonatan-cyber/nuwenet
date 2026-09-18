import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// Límites de la consulta del archivo. Son parte del contrato de la petición y los
// comparte el CLI, que llama al servicio sin pasar por el ValidationPipe.
export const ARCHIVE_PAGE_LIMIT = 50;
export const ARCHIVE_MAX_PAGE = 500;

export class ArchivedRowsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(ARCHIVE_MAX_PAGE) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) offset?: number;
  @IsOptional() @IsIn(['csv', 'json']) format?: 'csv' | 'json';
}
