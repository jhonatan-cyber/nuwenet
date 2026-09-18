import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SQL, type TransactionSQL } from 'bun';
import { connectPostgres, postgresSchema } from './postgres-config';
import { runMigrations } from './migrations';

export type DatabaseDriver = 'postgres';

// Dueño de la conexión y de las transacciones. El esquema vive en `migrations/`
// (véase el mapa en `migrations/index.ts`), que se aplica al arrancar.
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly driver: DatabaseDriver;
  readonly schema: string;
  private readonly sql: SQL;
  private readonly logger = new Logger(DatabaseService.name);

  constructor() {
    if (process.env.DB_DRIVER && process.env.DB_DRIVER !== 'postgres') throw new Error('NuweNet requiere PostgreSQL. Configura DB_DRIVER=postgres y la conexión.');
    this.driver = 'postgres';
    this.schema = postgresSchema();
    this.sql = connectPostgres();
  }

  async onModuleInit() {
    await runMigrations(this);
    this.logger.log(`Base de datos preparada: ${this.driver}.`);
  }

  read<T>(operation: (tx: TransactionSQL) => Promise<T>): Promise<T> {
    return this.sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', operation);
  }

  write<T>(operation: (tx: TransactionSQL) => Promise<T>): Promise<T> {
    return this.sql.begin(async tx => {
      // A transaction-scoped lock serializes management changes across API instances.
      // This protects payment idempotency and access decisions from concurrent requests.
      await tx`SELECT pg_advisory_xact_lock(78123, 1)`;
      return operation(tx);
    });
  }

  // Only for isolated operational records (task locks and diagnostics).
  // Payments, customer changes and consumption keep the business lock in write().
  writeOperational<T>(resource:string, operation:(tx:TransactionSQL)=>Promise<T>):Promise<T> {
    return this.sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(78124, hashtext(${this.schema+':'+resource}))`;
      return operation(tx);
    });
  }

  async onModuleDestroy() {
    await this.sql.close();
  }
}
