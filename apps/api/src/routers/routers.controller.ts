export * from './routers-crud.controller';
export * from './routers-ops.controller';
import { RoutersCrudController } from './routers-crud.controller';
import { RoutersOpsController } from './routers-ops.controller';

/** Compatibilidad: antes existía un único `RoutersController`. */
export class RoutersController extends RoutersCrudController {}
void RoutersOpsController;
