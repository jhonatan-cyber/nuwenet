import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      return response.status(exception.getStatus()).json({ error: Array.isArray(message) ? message.join(' ') : message || exception.message });
    }
    const databaseError = exception as { code?: string; errno?: string; constraint?: string } | null;
    if ((exception instanceof Error && exception.message.includes('UNIQUE constraint failed: customers.apartment')) ||
        ((databaseError?.code === '23505' || databaseError?.errno === '23505') && databaseError.constraint === 'customers_apartment_key')) {
      return response.status(400).json({ error: 'Este departamento ya está registrado.' });
    }
    this.logger.error(exception);
    return response.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}
