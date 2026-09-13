import { SetMetadata } from '@nestjs/common';

// B7: roles declarativos por controlador/ruta. El guard los hace cumplir;
// main.ts conserva su middleware como defensa en profundidad durante la
// transición, pero la autorización canónica vive aquí.
export const ROLES_KEY = 'nuwenet_roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
