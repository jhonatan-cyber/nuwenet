// Validación de punta a punta del proyecto con un solo comando.
//
// Uso: bun run verify [--sin-navegador]
//
// Pasos, en orden (lo barato primero y la compilación una sola vez):
//
//   check    tipos de la API y de la web, sin emitir
//   build    API a apps/api/dist y web a apps/web/dist (lo que sirve la API)
//   base     conexión de PostgreSQL y estado del ledger de migraciones (sin efectos)
//   test     suites de bun: unitarias, contrato e integración sobre PostgreSQL
//   dialogs  E2E de navegador: diálogos, tablas, catálogo y todas las secciones
//   ui       E2E de navegador: recorrido completo del panel, de punta a punta
//
// Requisitos:
//   - La conexión PostgreSQL del .env del proyecto. Cada prueba crea su propio
//     esquema `nuwenet_*` y borra solo ese esquema; no se crean ni borran bases.
//   - `pg_dump` y `pg_restore` para los escenarios de respaldo y de archivo heredado.
//   - Chromium de Playwright para los pasos de navegador:
//     `bunx playwright install chromium` (o BROWSER_CHANNEL=chrome para usar Chrome).
//
// `--sin-navegador` omite los dos pasos de navegador: sirve en máquinas sin Chromium
// y deja la validación en tipos, compilación y suites.
import { spawnSync } from 'node:child_process';

interface Paso {
  nombre: string;
  detalle: string;
  comando: string[];
  /** Qué revisar cuando falla. */
  pista: string;
  /** Con esto, el paso se queda con las líneas que importan en vez de volcar toda su salida. */
  resumen?: RegExp;
}

const pasos: Paso[] = [
  {
    nombre: 'check',
    detalle: 'tipos de API y web',
    comando: ['run', 'check'],
    pista: 'Corrige los errores de tipo o de plantilla que muestra el propio comando.',
  },
  {
    nombre: 'build',
    detalle: 'API y web a dist',
    comando: ['run', 'build'],
    pista: 'El build alimenta las suites y las pruebas de navegador; revisa el primer error de compilación.',
  },
  {
    nombre: 'base',
    detalle: 'conexión y ledger de migraciones',
    comando: ['tools/db/database.ts', 'status'],
    resumen: /Pendientes|Al día|Versiones en el ledger|ledger no existe/,
    pista: 'Revisa la conexión PostgreSQL del .env y ejecuta "bun run db:migrate" si hay pendientes.',
  },
  {
    nombre: 'test',
    detalle: 'unitarias, contrato e integración',
    comando: ['test', './test'],
    pista: 'Requiere PostgreSQL con permiso CREATE sobre la base y pg_dump/pg_restore instalados.',
  },
  {
    nombre: 'dialogs',
    detalle: 'E2E de navegador: diálogos, tablas y catálogo',
    comando: ['tools/e2e/verify-dialogs.ts'],
    pista: 'Instala el navegador con "bunx playwright install chromium" e imprime el motivo del fallo.',
  },
  {
    nombre: 'ui',
    detalle: 'E2E de navegador: recorrido completo del panel',
    comando: ['tools/e2e/smoke-ui.ts'],
    pista: 'Los fallos guardan una captura en el directorio temporal del sistema; revisa el motivo impreso.',
  },
];

const sinNavegador = process.argv.includes('--sin-navegador');
const seleccionados = sinNavegador ? pasos.filter(paso => paso.nombre !== 'dialogs' && paso.nombre !== 'ui') : pasos;

function duracion(milisegundos: number): string {
  const segundos = milisegundos / 1000;
  if (segundos < 60) return `${segundos.toFixed(1)} s`;
  const minutos = Math.floor(segundos / 60);
  return `${minutos} m ${Math.round(segundos - minutos * 60)} s`;
}

console.log(`Validación de punta a punta: ${seleccionados.map(paso => paso.nombre).join(' → ')}${sinNavegador ? ' (sin navegador)' : ''}`);
const comenzado = Date.now();
for (const paso of seleccionados) {
  const inicio = Date.now();
  console.log(`\n· ${paso.nombre} — ${paso.detalle}`);
  const resultado = spawnSync(process.execPath, paso.comando, { stdio: paso.resumen ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  const transcurrido = duracion(Date.now() - inicio);
  if (paso.resumen) {
    for (const linea of String(resultado.stdout ?? '').split('\n')) if (paso.resumen.test(linea)) console.log(`  ${linea.trim()}`);
  }
  if (resultado.error) {
    console.error(`\nFallo en "${paso.nombre}" tras ${transcurrido}: ${resultado.error.message}`);
    console.error(paso.pista);
    process.exit(1);
  }
  if (resultado.status !== 0) {
    console.error(`\nFallo en "${paso.nombre}" tras ${transcurrido} (código ${resultado.status}).`);
    console.error(paso.pista);
    console.error(`Los pasos siguientes no se ejecutaron; para repetir solo una parte: ${paso.comando.join(' ')}`);
    process.exit(1);
  }
  console.log(`  ✓ ${paso.nombre} en ${transcurrido}`);
}

const navegador = sinNavegador ? '' : ' y los dos recorridos de navegador';
console.log(`\nValidación correcta: ${seleccionados.length} pasos${navegador} en ${duracion(Date.now() - comenzado)}.`);
