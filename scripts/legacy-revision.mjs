// Dueño único de "cuál es la revisión heredada" y de cómo se obtiene su servicio.
//
// La era heredada es la anterior al registro de migraciones: allí `database.service.ts`
// contenía el esquema y se bastaba a sí mismo. Se deduce del historial —el padre del
// commit que añadió el registro— para que siga siendo válida una vez que ese trabajo
// está commiteado (donde HEAD ya es el código nuevo) y tanto tras un merge normal como
// tras uno aplastado. La usan el ensayo (`scripts/upgrade-rehearsal.mjs`) y su prueba.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGISTRY_PATH = 'apps/api/src/database/migrations/index.ts';
export const SERVICE_PATH = 'apps/api/src/database/database.service.ts';

export function legacyRevision() {
  let adiciones;
  try {
    adiciones = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--', REGISTRY_PATH])
      .toString().trim().split('\n').filter(Boolean);
  } catch (error) {
    throw new Error(`No se pudo leer el historial de ${REGISTRY_PATH} (${error.message.trim().split('\n')[0]}). Un clon sin historial no puede reconstruir la base heredada del ensayo.`);
  }
  if (!adiciones.length) throw new Error(`El historial no tiene el commit que añadió ${REGISTRY_PATH}: el ensayo no puede reconstruir la base heredada (¿clon superficial?).`);
  return `${adiciones[adiciones.length - 1]}^`;
}

// Fuente del servicio heredado. El import de la conexión apunta al build actual porque el
// archivo temporal vive dentro del proyecto y `postgres-config.ts` no se resuelve desde fuera.
export function legacySource(revision, dist = path.resolve('apps/api/dist')) {
  return execFileSync('git', ['show', `${revision}:${SERVICE_PATH}`]).toString()
    .replace("from './postgres-config'", `from '${pathToFileURL(path.join(dist, 'database/postgres-config.js')).href}'`);
}

// Premisa del ensayo: en esa revisión el esquema vivía entero en el servicio. Si la fuente ya
// importa el registro, el ensayo no puede montar la base heredada; se avisa con el motivo en vez
// de dejar que falle la resolución del módulo dentro del archivo temporal.
export const usesRegistry = fuente => /from '\.\/migrations'/.test(fuente);

export function assertLegacySource(fuente, revision) {
  if (usesRegistry(fuente)) {
    throw new Error(`La revisión ${revision} ya usa el registro de migraciones (${REGISTRY_PATH}); el ensayo necesita una anterior al cambio de identificadores.`);
  }
}
