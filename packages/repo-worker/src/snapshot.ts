import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import fg from 'fast-glob';
import type { RepositoryConfig } from './config.js';

const SECRET_NAME = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx)|.*(?:secret|credential|token).*)$/i;
const ALWAYS_EXCLUDE = /(^|\/)(\.git|node_modules|\.ssh|\.aws|\.azure|\.config|\.npm|\.docker|\.kube)(\/|$)|(^|\/)(Thumbs\.db|\.DS_Store)$/i;

export function isExcludedRepositoryPath(relativePath: string): boolean {
  return SECRET_NAME.test(relativePath) || ALWAYS_EXCLUDE.test(relativePath);
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
