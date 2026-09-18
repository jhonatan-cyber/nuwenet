import { BadRequestException, Injectable } from '@nestjs/common';
import { readCapabilities, type RouterAdapter, type RouterCredentials, type RouterSnapshot, type RouterTarget } from '../router.types';

/**
 * Base TR-369 / Broadband Forum USP.
 *
 * El protocolo existe (USP Controller ↔ Agent sobre el equipo), pero cada
 * fabricante/modelo lo expone de forma distinta y exige acceso habilitado en
 * el dispositivo (controlador USP, credenciales y permisos por objeto de datos).
 * Por eso este adaptador es solo el punto de extensión: declara el nivel
 * "solo consulta" hasta que un modelo concreto implemente identificación y,
 * después, escritura verificada como el resto de adaptadores.
 */
@Injectable()
export class Tr369Adapter implements RouterAdapter {
  readonly description = {
    id: 'tr369-usp' as const,
    name: 'TR-369 / USP (base)',
    requirements: 'Equipo residencial con agente USP y acceso del controlador habilitado (ruta del controlador, credenciales y objetos permitidos según el fabricante). Sin modelo validado: registra la conexión manualmente y amplía este adaptador por modelo/firmware antes de anunciar soporte.',
    capabilities: { ...readCapabilities },
  };

  async inspect(_target: RouterTarget, _credentials: RouterCredentials): Promise<RouterSnapshot> {
    throw new BadRequestException(
      'TR-369 base no consulta equipos automáticamente: habilita el agente USP en el dispositivo y registra un adaptador por modelo validado. Usa Configuración avanzada con otro adaptador o deja el equipo como inventario sin integración.',
    );
  }
}
