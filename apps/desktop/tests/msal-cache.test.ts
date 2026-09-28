import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSafeStorageMsalCache } from '../src/main/msal-cache.js';

describe('OS-protected MSAL persistence adapter', () => {
  let directory = '';
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

  it('persists only OS-encrypted cache content and reloads it', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'qa-msal-cache-'));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: vi.fn((value: string) => Buffer.from(value.split('').reverse().join(''))),
      decryptString: vi.fn((value: Buffer) => value.toString().split('').reverse().join('')),
    };
    const cache = createSafeStorageMsalCache({ filePath: path.join(directory, 'cache.bin'), safeStorage });
    const tokenCanary = 'highly-sensitive-token-canary';
    await cache.save(JSON.stringify({ accessToken: tokenCanary }));
    const disk = await readFile(path.join(directory, 'cache.bin'), 'utf8');
    expect(disk).not.toContain(tokenCanary);
    await expect(cache.load()).resolves.toContain(tokenCanary);
  });

  it('fails closed when OS-backed encryption is unavailable or the cache cannot be decrypted', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'qa-msal-cache-'));
    const unavailable = createSafeStorageMsalCache({ filePath: path.join(directory, 'cache.bin'), safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' } });
    await expect(unavailable.save('cache')).rejects.toThrow('unavailable');
    await expect(unavailable.load()).rejects.toThrow('unavailable');
    const broken = createSafeStorageMsalCache({ filePath: path.join(directory, 'cache.bin'), safeStorage: { isEncryptionAvailable: () => true, encryptString: () => Buffer.alloc(0), decryptString: () => { throw new Error('bad ciphertext'); } } });
    await (await import('node:fs/promises')).writeFile(path.join(directory, 'cache.bin'), 'broken');
    await expect(broken.load()).rejects.toThrow('Unable to unlock');
  });
});
