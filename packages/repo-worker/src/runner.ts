import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import tar from 'tar-stream';
import { parseStringPromise } from 'xml2js';
import { ObservationSchema, type Observation } from '@agentic-qa/domain/run';
import type { RepositoryConfig } from './config.js';
import { createRepositorySnapshot } from './snapshot.js';

export const REPO_WORKER_IMAGE = 'node:22-bookworm-slim';
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'npx']);

export interface RepoCapturedArtifact { kind: 'log' | 'test-result'; commandId: string; scenarioIds: string[]; path: string }
export interface RepoExecutionResult { snapshot: { sha256: string; copiedFiles: number; totalBytes: number; excludedPaths: string[] }; observations: Observation[]; artifacts: RepoCapturedArtifact[]; blocked?: string }
export interface RepoRunnerOptions { runId: string; repositoryPath: string; config: RepositoryConfig; snapshotPath: string; artifactDirectory?: string; maxArtifactBytes?: number; timeoutMs: number; expectedSnapshotHash?: string; signal?: AbortSignal; dockerPath?: string; workerImage?: string }

function runProcess(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal, input?: Readable): Promise<{ code: number; output: string; errorOutput: string; cancelled: boolean; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME'];
    const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!] as const] : []));
    const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    let cancelled = false;
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-100_000); });
    child.stderr.on('data', (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString('utf8')).slice(-4000); });
    if (input) {
      const stdin = child.stdin;
      if (!stdin) { reject(new Error('Docker worker input stream is unavailable.')); return; }
      input.on('error', () => child.kill('SIGTERM'));
      stdin.on('error', () => input.destroy());
      input.pipe(stdin);
    } else child.stdin.end();
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); }, timeoutMs);
    const abort = () => { cancelled = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolvePromise({ code: code ?? 1, output, errorOutput, cancelled, timedOut }); });
  });
}

function waitForEntry(callback: (complete: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise((resolveEntry, rejectEntry) => callback((error) => error ? rejectEntry(error) : resolveEntry()));
}

async function appendSnapshotDirectory(pack: ReturnType<typeof tar.pack>, root: string, current = root): Promise<void> {
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    const stat = await lstat(path);
    const name = relative(root, path).split(sep).join('/');
    if (stat.isSymbolicLink() || stat.nlink > 1 || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Snapshot changed after validation: ${name}`);
    if (stat.isDirectory()) {
      await waitForEntry((callback) => { pack.entry({ name: `${name}/`, type: 'directory', mode: 0o755 }, callback); });
      await appendSnapshotDirectory(pack, root, path);
    } else {
      const output = pack.entry({ name, size: stat.size, mode: 0o644 }, (error) => { if (error) pack.destroy(error); });
      await pipeline(createReadStream(path), output);
    }
  }
}

function createArgs(runId: string): string[] {
  return [
    'create', '--name', `agentic-qa-${runId}`, '--label=agentic-qa.managed=true', `--label=agentic-qa.run=${runId}`,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true', '--pids-limit=128',
    '--memory=2g', '--cpus=2', '--user=10001:10001',
    '--tmpfs=/workspace:rw,exec,nosuid,nodev,size=1g,mode=1777', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
    '--workdir=/workspace', '--env=HOME=/tmp', REPO_WORKER_IMAGE, 'node', '-e', 'setInterval(() => {}, 2147483647)',
  ];
}

function safeContainerPath(value: string): string {
  const resolved = resolve('/workspace', value).replaceAll('\\', '/');
  if (resolved !== '/workspace' && !resolved.startsWith('/workspace/')) throw new Error(`Repository command path escaped its snapshot: ${value}`);
  return resolved;
}

function safeResultPath(value: string): string {
  if (value.startsWith('/') || value.includes('\\') || value.split('/').includes('..') || value.includes('\0')) throw new Error(`Invalid JUnit result path: ${value}`);
  return value;
}

export async function parseJUnit(content: string): Promise<Array<{ name: string; passed: boolean; message: string }>> {
  if (Buffer.byteLength(content) > 50 * 1024 * 1024) throw new Error('JUnit result exceeds the 50 MiB parser limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('JUnit documents cannot define DTDs or custom entities.');
  const parsed = await parseStringPromise(content, { explicitArray: false, attrkey: '$', strict: true });
  const suiteList = (node: any): any[] => !node ? [] : Array.isArray(node.testsuite) ? node.testsuite : node.testsuite ? [node.testsuite] : Array.isArray(node) ? node.flatMap(suiteList) : [];
  const suites = parsed.testsuites ? suiteList(parsed.testsuites) : [parsed.testsuite ?? parsed].flat();
  const cases = suites.flatMap((suite: any) => {
    const cases = suite.testcase ? (Array.isArray(suite.testcase) ? suite.testcase : [suite.testcase]) : [];
    return cases.map((test: any) => ({ name: `${test.$?.classname ? `${test.$.classname}.` : ''}${test.$?.name ?? 'unknown'}`.slice(0, 400), passed: !test.failure && !test.error && !test.skipped, message: String(test.failure?._ ?? test.failure?.$?.message ?? test.error?._ ?? test.error?.$?.message ?? (test.skipped ? 'Skipped test' : 'Test passed')).slice(0, 1000) }));
  });
  if (cases.length > 20_000) throw new Error('JUnit result exceeds the 20,000 testcase parser limit.');
  return cases;
}

export function mapJUnitAssertions(cases: Array<{ name: string; passed: boolean }>, mappings: RepositoryConfig['tests'][number]['scenarioMappings']): Array<{ scenarioId: string; status: Observation['status']; assertion: string }> {
  return mappings.map((mapping) => {
    const matched = cases.filter(({ name }) => mapping.testCaseIds.includes(name));
    const missing = mapping.testCaseIds.filter((name) => !matched.some(({ name: matchedName }) => name === matchedName));
    const failed = matched.filter(({ passed }) => !passed).length;
    const status: Observation['status'] = !matched.length || missing.length ? 'ERROR' : failed ? 'FAILED' : 'PASSED';
    return { scenarioId: mapping.scenarioId, status, assertion: `${matched.length}/${mapping.testCaseIds.length} mapped JUnit assertions matched; ${failed} failed.${missing.length ? ` ${missing.length} expected test identities were missing.` : ''}` };
  });
}

export async function runRepositoryChecks(options: RepoRunnerOptions): Promise<RepoExecutionResult> {
  const observationFor = (scenarioId: string, status: Observation['status'], assertion: string, startedAt: string): Observation => ObservationSchema.parse({ id: randomUUID(), runId: options.runId, scenarioId, status, worker: 'repo', startedAt, endedAt: new Date().toISOString(), assertion, artifactIds: [], sourceIdentity: 'disposable repository snapshot' });
  const snapshot = await createRepositorySnapshot({ sourcePath: options.repositoryPath, destinationPath: options.snapshotPath, config: options.config });
  if (options.expectedSnapshotHash && snapshot.sha256 !== options.expectedSnapshotHash) return { snapshot, observations: [], artifacts: [], blocked: 'Repository source files changed after the plan was reviewed. Create a new plan.' };
  const observations: Observation[] = [];
  const artifacts: RepoCapturedArtifact[] = [];
  let capturedArtifactBytes = 0;
  const captureArtifact = async (kind: RepoCapturedArtifact['kind'], commandId: string, scenarioIds: string[], content: string) => {
    if (!options.artifactDirectory) return;
    const bytes = Buffer.byteLength(content);
    if (capturedArtifactBytes + bytes > (options.maxArtifactBytes ?? 500 * 1024 * 1024)) throw new Error('Repository command logs and test results exceeded the approved artifact size limit.');
    await mkdir(options.artifactDirectory, { recursive: true, mode: 0o700 });
    const fileName = `${artifacts.length}-${commandId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${kind === 'log' ? 'log' : 'xml'}`;
    const path = join(options.artifactDirectory, fileName);
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    capturedArtifactBytes += bytes;
    artifacts.push({ kind, commandId, scenarioIds, path });
  };
  let containerId = '';
  const docker = options.dockerPath ?? 'docker';
  const workerImage = options.workerImage ?? REPO_WORKER_IMAGE;
  const resultRoot = resolve(options.snapshotPath, `.qa-results-${options.runId}`);
  try {
    const probe = await runProcess(docker, ['image', 'inspect', workerImage], 10_000, options.signal);
    if (probe.cancelled) return { snapshot, observations, artifacts, blocked: 'Repository worker setup was cancelled.' };
    if (probe.code !== 0) return { snapshot, observations, artifacts, blocked: `Required worker image ${workerImage} is not available locally. Prepare it from Run setup before running repository checks.` };
    const args = createArgs(options.runId);
    args[args.indexOf(REPO_WORKER_IMAGE)] = workerImage;
    const created = await runProcess(docker, args, 20_000, options.signal);
    containerId = created.output.trim().split(/\s+/).at(-1) ?? '';
    if (created.cancelled) return { snapshot, observations, artifacts, blocked: 'Repository worker setup was cancelled.' };
    if (created.code !== 0 || !/^[a-f0-9]{12,64}$/i.test(containerId)) return { snapshot, observations, artifacts, blocked: 'Docker could not create the isolated repository worker.' };
    const started = await runProcess(docker, ['start', containerId], 10_000, options.signal);
    if (started.code !== 0) return { snapshot, observations, artifacts, blocked: 'Docker could not start the isolated repository worker.' };
    const archive = tar.pack();
    const copiedPromise = runProcess(docker, ['exec', '--interactive', containerId, 'tar', '-xf', '-', '-C', '/workspace'], Math.min(60_000, Math.max(1, options.timeoutMs)), options.signal, archive as unknown as Readable);
    try { await appendSnapshotDirectory(archive, snapshot.path); archive.finalize(); }
    catch (error) { archive.destroy(); await copiedPromise.catch(() => undefined); throw error; }
    const copied = await copiedPromise;
    if (copied.code !== 0) return { snapshot, observations, artifacts, blocked: `The filtered repository snapshot could not be copied into the isolated worker. ${copied.errorOutput.slice(-1000)}` };

    for (const command of [...options.config.setup, ...options.config.tests]) {
      if (!ALLOWED_COMMANDS.has(command.executable)) return { snapshot, observations, artifacts, blocked: `Executable ${command.executable} is outside the repository worker allowlist.` };
      const workingDirectory = safeContainerPath(command.workingDirectory);
      const mappedResultPaths = command.resultPaths.map(safeResultPath);
      const startedAt = new Date().toISOString();
      const result = await runProcess(docker, ['exec', '--workdir', workingDirectory, containerId, command.executable, ...command.arguments], Math.min(command.timeoutSeconds * 1000, Math.max(1, options.timeoutMs)), options.signal);
      const scenarioIds = command.scenarioMappings.length ? command.scenarioMappings.map(({ scenarioId }) => scenarioId) : [command.id];
      await captureArtifact('log', command.id, scenarioIds, `STDOUT (last 100 KB)\n${result.output || '(empty)'}\n\nSTDERR (last 4 KB)\n${result.errorOutput || '(empty)'}\n`);
      if (result.cancelled) { observations.push(observationFor(command.id, 'ERROR', 'Repository command was cancelled.', startedAt)); break; }
      if (result.timedOut) { observations.push(observationFor(command.id, 'ERROR', `Repository command exceeded ${command.timeoutSeconds} seconds.`, startedAt)); break; }
      if (command.resultFormat === 'junit') {
        const cases: Array<{ name: string; passed: boolean; message: string }> = [];
        await mkdir(resultRoot, { recursive: true, mode: 0o700 });
        for (const [index, path] of mappedResultPaths.entries()) {
          const resultPath = join(resultRoot, `${command.id}-${index}.xml`);
          const sizeProbe = await runProcess(docker, ['exec', containerId, 'wc', '-c', `/workspace/${path}`], 15_000, options.signal);
          const size = /^(\d+)\s/.exec(sizeProbe.output.trim());
          const remainingBytes = (options.maxArtifactBytes ?? 500 * 1024 * 1024) - capturedArtifactBytes;
          if (size && Number(size[1]) > remainingBytes) throw new Error('JUnit output exceeds the remaining evidence size limit.');
          const copiedResult = await runProcess(docker, ['cp', `${containerId}:/workspace/${path}`, resultPath], 15_000, options.signal);
          if (copiedResult.code !== 0) continue;
          let content: string | undefined;
          try {
            const info = await lstat(resultPath);
            if (!info.isFile() || info.isSymbolicLink()) continue;
            content = await readFile(resultPath, 'utf8');
            cases.push(...await parseJUnit(content));
          } catch { /* missing or invalid reports are represented as missing evidence */ }
          if (content !== undefined) {
            if (capturedArtifactBytes + Buffer.byteLength(content) > (options.maxArtifactBytes ?? 500 * 1024 * 1024)) throw new Error('JUnit output exceeds the remaining evidence size limit.');
            await captureArtifact('test-result', `${command.id}-${index}`, scenarioIds, content);
          }
        }
        if (!cases.length) {
          for (const mapping of command.scenarioMappings) observations.push(observationFor(mapping.scenarioId, 'ERROR', 'JUnit output was empty or missing; a zero process exit cannot verify a criterion.', startedAt));
          if (!command.scenarioMappings.length) observations.push(observationFor(command.id, 'ERROR', 'JUnit output was empty or missing.', startedAt));
        } else if (command.scenarioMappings.length) {
          const mappedCaseIds = new Set(command.scenarioMappings.flatMap(({ testCaseIds }) => testCaseIds));
          for (const mapped of mapJUnitAssertions(cases, command.scenarioMappings)) observations.push(observationFor(mapped.scenarioId, mapped.status, mapped.assertion, startedAt));
          for (const testcase of cases.filter(({ name }) => !mappedCaseIds.has(name))) observations.push(observationFor(`${command.id}:${testcase.name}`, testcase.passed ? 'PASSED' : 'FAILED', testcase.passed ? 'JUnit assertion passed but is not mapped to an acceptance criterion.' : 'Unmapped JUnit assertion failed and needs reviewer classification.', startedAt));
        } else for (const testcase of cases) observations.push(observationFor(`${command.id}:${testcase.name}`, testcase.passed ? 'PASSED' : 'FAILED', testcase.passed ? 'JUnit assertion passed but is not mapped to an acceptance criterion.' : 'Unmapped JUnit assertion failed and needs reviewer classification.', startedAt));
      } else observations.push(observationFor(command.id, result.code === 0 ? 'PASSED' : 'FAILED', `Command exited ${result.code}.`, startedAt));
      if (result.code !== 0) break;
    }
    return { snapshot, observations, artifacts };
  } catch (error) {
    return { snapshot, observations, artifacts, blocked: error instanceof Error ? error.message.slice(0, 1000) : 'Repository worker failed.' };
  } finally {
    if (containerId && /^[a-f0-9]{12,64}$/i.test(containerId)) await runProcess(docker, ['rm', '--force', containerId], 10_000).catch(() => undefined);
    await rm(resultRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
