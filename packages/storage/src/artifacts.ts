import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { ArtifactSchema, type Artifact } from '@agentic-qa/domain/run';

const MAGIC = Buffer.from('AQE1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function derivedKey(masterKey: Buffer, runId: string): Buffer {
  if (masterKey.byteLength !== 32) throw new Error('Artifact encryption key must be exactly 32 bytes.');
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(runId), Buffer.from('agentic-qa-evidence-v1'), 32));
}

function assertInside(root: string, candidate: string): void {
  const absoluteRoot = resolve(root);
  const absoluteCandidate = resolve(candidate);
  if (absoluteCandidate !== absoluteRoot && !absoluteCandidate.startsWith(`${absoluteRoot}${sep}`)) throw new Error('Artifact path escaped the evidence directory.');
}

export async function encryptArtifact(options: {
  runId: string;
  kind: Artifact['kind'];
  sourcePath: string;
  evidenceRoot: string;
  key: Buffer;
  maxBytes: number;
}): Promise<Artifact> {
  const runId = ArtifactSchema.shape.runId.parse(options.runId);
  const id = randomUUID();
  const plaintext = await readFile(options.sourcePath);
  if (!plaintext.byteLength || plaintext.byteLength > options.maxBytes) throw new Error('Artifact exceeds the configured retention size limit.');
  const plaintextBytes = plaintext.byteLength;
  const sha256 = createHash('sha256').update(plaintext).digest('hex');
  const fileName = `${id}.aqe`;
  const relativePath = `${runId}/${fileName}`;
  const destination = resolve(options.evidenceRoot, relativePath);
  assertInside(options.evidenceRoot, destination);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const key = derivedKey(options.key, runId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${id}|${runId}|${options.kind}`));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, envelope, { flag: 'wx', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw new Error('Unable to persist encrypted evidence.');
  } finally {
    key.fill(0);
    plaintext.fill(0);
    encrypted.fill(0);
    options.key.fill(0);
  }
  return ArtifactSchema.parse({ id, runId, kind: options.kind, relativePath, sha256, bytes: plaintextBytes, redactionState: 'restricted' });
}

export async function decryptArtifact(options: { artifact: Artifact; evidenceRoot: string; key: Buffer }): Promise<Buffer> {
  const artifact = ArtifactSchema.parse(options.artifact);
  const path = resolve(options.evidenceRoot, artifact.relativePath);
  assertInside(options.evidenceRoot, path);
  const envelope = await readFile(path);
  if (envelope.byteLength < MAGIC.length + IV_BYTES + TAG_BYTES || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Encrypted evidence format is invalid.');
  const iv = envelope.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = envelope.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const key = derivedKey(options.key, artifact.runId);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${artifact.id}|${artifact.runId}|${artifact.kind}`));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (createHash('sha256').update(plaintext).digest('hex') !== artifact.sha256) {
      plaintext.fill(0);
      throw new Error('Evidence integrity check failed.');
    }
    return plaintext;
  } catch {
    throw new Error('Unable to decrypt or verify local evidence.');
  } finally {
    key.fill(0);
    options.key.fill(0);
  }
}

export async function deleteRunEvidence(evidenceRoot: string, runIdInput: string): Promise<void> {
  const runId = ArtifactSchema.shape.runId.parse(runIdInput);
  const runDirectory = resolve(evidenceRoot, runId);
  assertInside(evidenceRoot, runDirectory);
  await rm(runDirectory, { recursive: true, force: true });
}
