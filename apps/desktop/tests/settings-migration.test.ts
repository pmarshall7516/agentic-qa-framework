import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateLegacyClientId } from '../src/main/settings-migration.js';

describe('desktop settings migration', () => {
  it('removes a legacy client cache when the app switches to its build-configured client ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-client-id-migration-'));
    const legacyClientId = '11111111-1111-4111-8111-111111111111';
    const cachePath = join(directory, `entra-${createHash('sha256').update(legacyClientId).digest('hex').slice(0, 20)}.bin`);
    const settings = new Map<string, unknown>([['entra.clientId', legacyClientId]]);
    const store = {
      getSetting: async (key: string) => settings.get(key),
      setSetting: async (key: string, value: unknown) => { settings.set(key, value); },
    };
    await writeFile(cachePath, 'legacy encrypted cache');

    try {
      await migrateLegacyClientId(store, directory, '22222222-2222-4222-8222-222222222222');
      await expect(readFile(cachePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(settings.get('entra.clientId')).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a cache that already belongs to the configured public client ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-client-id-migration-'));
    const clientId = '11111111-1111-4111-8111-111111111111';
    const cachePath = join(directory, `entra-${createHash('sha256').update(clientId).digest('hex').slice(0, 20)}.bin`);
    const settings = new Map<string, unknown>([['entra.clientId', clientId]]);
    const store = {
      getSetting: async (key: string) => settings.get(key),
      setSetting: async (key: string, value: unknown) => { settings.set(key, value); },
    };
    await writeFile(cachePath, 'matching encrypted cache');

    try {
      await migrateLegacyClientId(store, directory, clientId);
      await expect(readFile(cachePath, 'utf8')).resolves.toBe('matching encrypted cache');
      expect(settings.get('entra.clientId')).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
