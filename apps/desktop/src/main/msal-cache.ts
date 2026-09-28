import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MsalCacheStore } from '@agentic-qa/ado/auth';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export function createSafeStorageMsalCache(options: { filePath: string; safeStorage: SafeStoragePort }): MsalCacheStore {
  return {
    async load() {
      if (!options.safeStorage.isEncryptionAvailable()) throw new Error('OS-backed token-cache encryption is unavailable.');
      let encrypted: string;
      try {
        encrypted = await readFile(options.filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error('Unable to read the encrypted sign-in cache.');
      }
      try {
        return options.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        throw new Error('Unable to unlock the encrypted sign-in cache. Sign out and remove the local cache if account recovery is needed.');
      }
    },
    async save(serializedCache) {
      if (!options.safeStorage.isEncryptionAvailable()) throw new Error('OS-backed token-cache encryption is unavailable.');
      const encrypted = options.safeStorage.encryptString(serializedCache).toString('base64');
      const directory = dirname(options.filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporaryPath = `${options.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, encrypted, { flag: 'wx', mode: 0o600 });
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, options.filePath);
      } catch {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw new Error('Unable to persist the encrypted sign-in cache.');
      }
    },
  };
}
