import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import fg from 'fast-glob';
import type { RepositoryConfig } from './config.js';

const SECRET_NAME = /(^|\/)(\.env(?:\..*)?|\.npmrc|nuget\.config|\.pypirc|\.netrc|\.git-credentials|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx)|.*(?:secret|credential|token).*)$/i;
const ALWAYS_EXCLUDE = /(^|\/)(\.git|node_modules|bin|obj|TestResults|\.ssh|\.aws|\.azure|\.config|\.npm|\.docker|\.kube)(\/|$)|(^|\/)(Thumbs\.db|\.DS_Store)$/i;

export function isExcludedRepositoryPath(relativePath: string): boolean {
  return SECRET_NAME.test(relativePath) || ALWAYS_EXCLUDE.test(relativePath);
}

const TEXT_SOURCE = /\.(?:[cm]?[jt]sx?|json|ya?ml|html|css|md|cs|csx|razor|cshtml|sln|slnx|csproj|props|targets|vb|vbproj|fs|fsproj|xml)$/i;
const SECRET_TEXT = [
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*["']?[^\s"'`,;]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16})\b/g,
];

export interface RepositoryContextFile { path: string; content: string }

/** Read a small, redacted source view from the exact configured repository include/exclude scope. */
export async function readRepositoryContext(input: { sourcePath: string; config: RepositoryConfig; maxFiles?: number; maxBytes?: number }): Promise<RepositoryContextFile[]> {
  const source = await realpath(input.sourcePath);
  const selected = new Set<string>();
  for (const pattern of input.config.repository.include) {
    const matches = await fg(pattern, { cwd: source, dot: true, onlyFiles: true, followSymbolicLinks: false, unique: true });
    for (const item of matches) selected.add(item.split(sep).join('/'));
  }
  for (const pattern of input.config.repository.exclude) {
    for (const item of await fg(pattern, { cwd: source, dot: true, onlyFiles: true, followSymbolicLinks: false, unique: true })) selected.delete(item.split(sep).join('/'));
  }
  const candidates = [...selected].filter((item) => !isExcludedRepositoryPath(item) && TEXT_SOURCE.test(item) && !/(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|CHANGELOG|LICENSE)(?:$|\.)/i.test(item)).sort();
  const maxFiles = input.maxFiles ?? 24;
  const maxBytes = input.maxBytes ?? 60_000;
  const files: RepositoryContextFile[] = [];
  let total = 0;
  for (const relativePath of candidates) {
    if (files.length >= maxFiles || total >= maxBytes) break;
    const sourceFile = resolve(source, relativePath);
    const inside = relative(source, sourceFile);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Repository context path escaped the selected root: ${relativePath}`);
    let handle;
    try { handle = await open(sourceFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch { continue; }
    let content: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink > 1 || info.size > 100_000 || info.size === 0) continue;
      content = await handle.readFile();
    } finally { await handle.close(); }
    if (content.includes(0)) { content.fill(0); continue; }
    const remaining = maxBytes - total;
    const text = content.toString('utf8').slice(0, remaining);
    content.fill(0);
    const redacted = SECRET_TEXT.reduce((value, pattern) => value.replace(pattern, '[REDACTED]'), text);
    if (!redacted.trim()) continue;
    total += Buffer.byteLength(redacted);
    files.push({ path: relativePath, content: redacted });
  }
  return files;
}

export interface SnapshotResult { path: string; sha256: string; copiedFiles: number; totalBytes: number; excludedPaths: string[] }

export async function createRepositorySnapshot(input: { sourcePath: string; destinationPath: string; config: RepositoryConfig; maxBytes?: number }): Promise<SnapshotResult> {
  const source = await realpath(input.sourcePath);
  const normalized = process.platform === 'win32' ? source.toLocaleLowerCase('en-US') : source;
  const home = process.platform === 'win32' ? (await realpath(homedir())).toLocaleLowerCase('en-US') : await realpath(homedir());
  const root = process.platform === 'win32' ? parse(source).root.toLocaleLowerCase('en-US') : parse(source).root;
  if (normalized === home || normalized === root) throw new Error('Choose a repository subfolder. The home directory and filesystem root cannot be used as repository targets.');
  await mkdir(input.destinationPath, { recursive: true, mode: 0o777 });
  const excludedPaths: string[] = [];
  const selected = new Set<string>();
  for (const pattern of input.config.repository.include) {
    const matches = await fg(pattern, { cwd: source, dot: true, onlyFiles: true, followSymbolicLinks: false, unique: true });
    for (const relativePath of matches) selected.add(relativePath.split(sep).join('/'));
  }
  for (const pattern of input.config.repository.exclude) {
    for (const item of await fg(pattern, { cwd: source, dot: true, onlyFiles: true, followSymbolicLinks: false, unique: true })) selected.delete(item.split(sep).join('/'));
  }
  const sorted = [...selected].sort();
  const hash = createHash('sha256');
  let totalBytes = 0;
  let copiedFiles = 0;
  const ceiling = input.maxBytes ?? 1_000_000_000;
  for (const relativePath of sorted) {
    if (isExcludedRepositoryPath(relativePath)) { excludedPaths.push(relativePath); continue; }
    const sourceFile = resolve(source, relativePath);
    const inside = relative(source, sourceFile);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`Repository path escaped the selected root: ${relativePath}`);
    let fileHandle;
    try { fileHandle = await open(sourceFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch { throw new Error(`Repository snapshot contains an unreadable or symbolic link: ${relativePath}`); }
    let content: Buffer;
    try {
      const info = await fileHandle.stat();
      if (!info.isFile() || info.nlink > 1) throw new Error(`Repository snapshot contains a non-regular or hard-linked file: ${relativePath}`);
      if (info.size > 100 * 1024 * 1024) throw new Error(`Repository file exceeds the 100 MiB per-file snapshot limit: ${relativePath}`);
      totalBytes += info.size;
      if (totalBytes > ceiling) throw new Error(`Repository snapshot exceeds the ${ceiling}-byte size limit.`);
      content = await fileHandle.readFile();
    } finally { await fileHandle.close(); }
    hash.update(relativePath).update('\0').update(content).update('\0');
    const destination = resolve(input.destinationPath, relativePath);
    const targetRelative = relative(input.destinationPath, destination);
    if (!targetRelative || targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) throw new Error('Snapshot destination escaped its root.');
    await mkdir(dirname(destination), { recursive: true, mode: 0o777 });
    const output = await open(destination, 'wx', 0o666);
    try { await output.writeFile(content); } finally { await output.close(); content.fill(0); }
    copiedFiles += 1;
  }
  return { path: input.destinationPath, sha256: hash.digest('hex'), copiedFiles, totalBytes, excludedPaths };
}
