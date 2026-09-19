import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLegacySource, legacyRevision, legacySource, usesRegistry } from '../../tools/db/legacy-revision';

const dist = path.resolve('apps/api/dist');
const cache = path.resolve('node_modules/.cache');

// El ensayo de actualización se monta desde una revisión del historial: si esa revisión
// desaparece, deja de ser autosuficiente o cambia el nombre del archivo, el ensayo se queda
// mudo justo cuando hace falta. Esta prueba falla antes de que eso ocurra.
test('ensayo: la base heredada se puede construir desde el historial', async () => {
  const revision = legacyRevision();
  assert.doesNotThrow(() => execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], { stdio: 'pipe' }), `la revisión heredada ${revision} no existe`);
  const fuente = legacySource(revision, dist);
  assert.match(fuente, /class DatabaseService/, 'la revisión heredada ya no trae el servicio de base de datos');
  assert.ok(!usesRegistry(fuente), 'la revisión heredada ya depende del registro de migraciones');
  assert.doesNotThrow(() => assertLegacySource(fuente, revision));
  assert.match(fuente, /id INTEGER/i, 'la revisión heredada ya no declara identificadores enteros');
  // Igual que el ensayo: el archivo vive dentro del proyecto y debe cargar sin hermanos.
  const directorio = path.join(cache, `nuwenet-prueba-heredada-${randomUUID()}`);
  mkdirSync(directorio, { recursive: true });
  try {
    const archivo = path.join(directorio, 'legacy-database.service.ts');
    writeFileSync(archivo, fuente);
    const { DatabaseService } = await import(pathToFileURL(archivo).href);
    const servicio = new DatabaseService();
    assert.equal(typeof servicio.read, 'function');
    assert.equal(typeof servicio.write, 'function');
    await servicio.onModuleDestroy();
  } finally { rmSync(directorio, { recursive: true, force: true }); }
}, 60000);

// El ensayo completo es la única comprobación que recorre el montaje real: esquema de prueba,
// arranque del código anterior, datos, y arranque del código actual encima.
test('ensayo: una base entera real se actualiza entera', () => {
  const ensayo = spawnSync(process.execPath, ['tools/ops/upgrade-rehearsal.ts'], { encoding: 'utf8', timeout: 240000 });
  const salida = `${ensayo.stdout || ''}${ensayo.stderr || ''}`;
  assert.equal(ensayo.status, 0, `el ensayo de actualización falló:\n${salida.slice(-2000)}`);
  assert.match(salida, /Ensayo de actualización correcto/, 'el ensayo terminó sin confirmar la conversión');
}, 300000);
