import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, lstat, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIRECTORIES = ['dist', 'scripts', 'tests', 'docs', 'bin', '.github'];
const FILES = ['package.json', 'package-lock.json', 'tsconfig.json', 'playwright.config.mjs',
  'README.md', 'INICIO_RAPIDO_ES.md', 'ARQUITECTURA_ES.md', 'CONTRIBUTING.md', 'LICENSE',
  'kpi-atelier.cmd', '.gitignore', '.gitattributes', '.editorconfig'];
const GENERATED = ['EXPORTACION.json', 'SHA256SUMS.txt'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Explicit inventory excludes installed dependencies, credentials, user data and old releases.
export async function releaseFiles(root = ROOT) {
  const files = [...FILES];
  async function visit(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`No se empaquetan enlaces: ${relative}/${entry.name}`);
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const directory of DIRECTORIES) await visit(directory);
  for (const file of files) if (!(await lstat(path.join(root, file))).isFile()) throw new Error(`Archivo inválido: ${file}`);
  return files.sort();
}

export async function prepareRelease(root = ROOT) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Versión de paquete inválida.');
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('package-lock.json no coincide con package.json.');
  const files = await releaseFiles(root);
  let commit = null, dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim());
  } catch { /* An extracted source release has no Git metadata. */ }
  const manifest = { app: 'KPI Atelier', version, source_commit: commit, working_tree_modified: dirty,
    files, omissions: ['Git history, local browser data and installed npm dependencies',
      'Machine-specific External Tool registration; recreate with scripts/install-pbitool.ps1'],
    validation: 'Run npm run check before distribution. Packaging verifies bytes, not application behavior.' };
  await writeFile(path.join(root, 'EXPORTACION.json'), JSON.stringify(manifest, null, 2) + '\n');
  const lines = await Promise.all([...files, 'EXPORTACION.json'].sort().map(async file => `${hash(await readFile(path.join(root, file)))}  ${file}`));
  await writeFile(path.join(root, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  return { version, files: [...files, ...GENERATED] };
}

export async function verifyRelease(root = ROOT, { exact = false } = {}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'EXPORTACION.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  if (manifest.version !== pkg.version || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('Versiones inconsistentes.');
  const expected = [...manifest.files, 'EXPORTACION.json'].sort();
  const lines = (await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
  const names = [];
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
    if (!match || path.isAbsolute(match[2]) || match[2].includes('\\') || match[2].split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Entrada de checksum inválida.');
    const [, digest, file] = match;
    if (hash(await readFile(path.join(root, file))) !== digest) throw new Error(`Hash distinto: ${file}`);
    names.push(file);
  }
  if (JSON.stringify(names.sort()) !== JSON.stringify(expected)) throw new Error('El inventario y los hashes no coinciden.');
  if (JSON.stringify(await releaseFiles(root)) !== JSON.stringify([...manifest.files].sort())) throw new Error('Inventario de fuentes incompleto.');
  if (exact) {
    const actual = (await readdir(root, { recursive: true, withFileTypes: true })).filter(e => !e.isDirectory()).map(e => {
      if (!e.isFile()) throw new Error('El paquete contiene un enlace.');
      return path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/');
    }).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected, 'SHA256SUMS.txt'].sort())) throw new Error('Archivos inesperados en el paquete.');
  }
  return { version: pkg.version, count: names.length };
}

export async function stageRelease(destination, root = ROOT) {
  const { files, version } = await prepareRelease(root);
  await mkdir(destination, { recursive: false });
  for (const file of files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }
  await verifyRelease(destination, { exact: true });
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, destination] = process.argv.slice(2);
  if (command === 'stage' && destination) console.log(await stageRelease(path.resolve(destination)));
  else if (command === 'verify') console.log(await verifyRelease(destination ? path.resolve(destination) : ROOT, { exact: Boolean(destination) }));
  else throw new Error('Uso: node scripts/release.mjs stage <directorio nuevo> | verify [directorio]');
}
