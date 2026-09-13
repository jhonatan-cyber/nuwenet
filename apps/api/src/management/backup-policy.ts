import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const snapshotName = /^snapshot-[\dT-]+-[a-f0-9-]+$/;
const packageName = /^[\w.-]+\.enc$/;
export function backupPolicy() {
  const days = Number(process.env.BACKUP_RETENTION_DAYS || 30), keep = Number(process.env.BACKUP_KEEP_MIN || 3);
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(keep) || keep < 1) throw new Error('Configura una retención positiva y al menos un respaldo conservado.');
  return { days, keep, external: process.env.BACKUP_EXTERNAL_DIR || null };
}
function packageFiles(manifest: { files: Record<string, unknown>; package?: Record<string, unknown>; encrypted?: boolean }) {
  // En disco solo existe una representación: cifrada (.enc) o heredada en
  // texto plano. Copiar nombres de la otra rompe la copia externa.
  const names = manifest.encrypted ? [...Object.keys(manifest.package || {}), 'manifest.json'] : [...Object.keys(manifest.files), 'manifest.json'];
  for (const file of names) {
    if (!['nuwenet.dump', 'router.key', 'manifest.json'].includes(file) && !packageName.test(file)) throw new Error('Archivo de respaldo inválido.');
  }
  return names;
}
export async function maintainBackups(root: string, current: string, verify: (dir: string) => Promise<unknown>) {
  const policy = backupPolicy(), canonical = realpathSync(root);
  let copied = false;
  if (policy.external) {
    // Do not silently create a local directory when a removable/network volume is missing.
    if (!existsSync(policy.external)) throw new Error('La carpeta externa de respaldos no está disponible. El respaldo local se conservó.');
    const external = realpathSync(policy.external);
    if (external === canonical || external.startsWith(canonical + path.sep)) throw new Error('La carpeta externa debe estar fuera de los respaldos locales.');
    const source = path.join(canonical, current), destination = path.join(external, current);
    if (!snapshotName.test(current) || existsSync(destination)) throw new Error('El destino del respaldo ya existe o no es válido.');
    mkdirSync(destination);
    const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
    for (const file of packageFiles(manifest)) copyFileSync(path.join(source, file), path.join(destination, file));
    await verify(destination); copied = true;
  }
  const snapshots = readdirSync(canonical).filter(n => snapshotName.test(n)).flatMap(name => {
    const dir = path.join(canonical, name);
    try { if (lstatSync(dir).isSymbolicLink() || path.dirname(realpathSync(dir)) !== canonical) return []; const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')); return [{ name, dir, date: Date.parse(m.created_at) }]; } catch { return []; }
  }).filter(s => Number.isFinite(s.date)).sort((a, b) => b.date - a.date);
  const removed: string[] = [];
  for (const s of snapshots.slice(policy.keep)) {
    if (s.name === current || s.date > Date.now() - policy.days * 86400000) continue;
    try {
      await verify(s.dir);
      const files = readdirSync(s.dir);
      if (files.some(f => !['nuwenet.dump', 'router.key', 'manifest.json'].includes(f) && !packageName.test(f) || !lstatSync(path.join(s.dir, f)).isFile())) continue;
      for (const file of files) unlinkSync(path.join(s.dir, file));
      rmdirSync(s.dir); removed.push(s.name);
    } catch { /* Preserve any backup whose structure or integrity cannot be verified. */ }
  }
  return { external_copied: copied, removed };
}
