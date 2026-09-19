import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verifyBackup } from '../../apps/api/dist/management/backup.service.js';
import { backupKey, decryptFile } from '../../apps/api/dist/management/backup-crypto.js';

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) throw new Error('Uso: bun tools/db/restore-backup.ts <respaldo> <directorio nuevo>. No sobrescribe una base existente.');
const source = realpathSync(path.resolve(sourceArg)), destination = path.resolve(destinationArg);
const manifest = await verifyBackup(source);
if (existsSync(destination)) throw new Error('El destino debe ser un directorio nuevo para conservar la base actual.');
if (destination === source || destination.startsWith(source + path.sep)) throw new Error('El destino debe estar fuera del respaldo.');
mkdirSync(destination, { recursive: true });
// La recuperación se ejecuta sobre el esquema seleccionado en nuwenet; este script
// verifica el paquete y deja el volcado listo sin tocar la base en uso.
for (const name of Object.keys(manifest.files)) {
  if (manifest.encrypted) await decryptFile(backupKey(), path.join(source, `${name}.enc`), path.join(destination, name));
  else copyFileSync(path.join(source, name), path.join(destination, name));
}
// Verify the actual restored copy, not just the source archive: describe it
// as plaintext (it is, after decryption) and run the standard verification.
const plain = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
plain.encrypted = false; delete plain.package;
writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(plain, null, 2));
await verifyBackup(destination);
console.log(`Paquete verificado en ${destination}. Restaura nuwenet.dump con pg_restore --dbname nuwenet --schema <esquema_del_manifiesto> y configura ROUTER_ENCRYPTION_KEY con router.key.`);
