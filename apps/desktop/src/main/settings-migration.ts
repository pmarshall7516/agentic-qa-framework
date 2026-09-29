import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

interface SettingsStore {
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function migrateLegacyClientId(store: SettingsStore, userDataPath: string, configuredClientId: string): Promise<void> {
  const legacyValue = await store.getSetting('entra.clientId');
  if (typeof legacyValue !== 'string') return;

  const legacyClientId = legacyValue.trim();
  if (isUuid(legacyClientId) && legacyClientId.toLowerCase() !== configuredClientId.toLowerCase()) {
    const cacheName = `entra-${createHash('sha256').update(legacyClientId.toLowerCase()).digest('hex').slice(0, 20)}.bin`;
    await rm(join(userDataPath, cacheName), { force: true });
  }
  await store.setSetting('entra.clientId', null);
}
