import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptArtifact, deleteRunEvidence, encryptArtifact } from '../src/artifacts.js';

const runId = '22222222-2222-4222-8222-222222222222';

describe('encrypted evidence files', () => {
  let directory = '';
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

  it('encrypts evidence with authenticated metadata and verifies its hash on read', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'qa-evidence-'));
    const sourcePath = path.join(directory, 'trace.zip');
    const evidenceRoot = path.join(directory, 'evidence');
    const canary = Buffer.from('restricted trace secret-value-canary');
    await writeFile(sourcePath, canary);
    const artifact = await encryptArtifact({ runId, kind: 'trace', sourcePath, evidenceRoot, key: Buffer.alloc(32, 17), maxBytes: 1024 });
    const encrypted = await readFile(path.join(evidenceRoot, artifact.relativePath));
    expect(encrypted.includes(Buffer.from('secret-value-canary'))).toBe(false);
    expect(artifact.bytes).toBe(canary.byteLength);
    await expect(decryptArtifact({ artifact, evidenceRoot, key: Buffer.alloc(32, 17) })).resolves.toEqual(canary);
    await expect(decryptArtifact({ artifact, evidenceRoot, key: Buffer.alloc(32, 18) })).rejects.toThrow('Unable to decrypt');
  });

  it('rejects oversized evidence and removes all evidence for one run', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'qa-evidence-'));
    const sourcePath = path.join(directory, 'shot.png');
    const evidenceRoot = path.join(directory, 'evidence');
    await writeFile(sourcePath, Buffer.alloc(12, 1));
    await expect(encryptArtifact({ runId, kind: 'screenshot', sourcePath, evidenceRoot, key: Buffer.alloc(32), maxBytes: 10 })).rejects.toThrow('size limit');
    const artifact = await encryptArtifact({ runId, kind: 'screenshot', sourcePath, evidenceRoot, key: Buffer.alloc(32, 1), maxBytes: 20 });
    await deleteRunEvidence(evidenceRoot, runId);
    await expect(readFile(path.join(evidenceRoot, artifact.relativePath))).rejects.toThrow();
  });
});
