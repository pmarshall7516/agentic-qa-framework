import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { RepositoryConfigSchema } from '../src/config.js';
import { REPO_WORKER_IMAGE, runRepositoryChecks } from '../src/runner.js';

const enabled = process.env.QA_DOCKER_INTEGRATION === '1';
const dockerTest = it.skipIf(!enabled);
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'qa-docker-boundary-'));
  roots.push(root);
  const sourcePath = join(root, 'source'); const snapshotPath = join(root, 'snapshot');
  await mkdir(sourcePath);
  await writeFile(join(sourcePath, 'fixture.js'), '/* snapshot canary */\n');
  const config = RepositoryConfigSchema.parse({
    schemaVersion: 1, project: { name: 'worker-boundary-fixture' }, repository: { include: ['**/*'], exclude: [] }, setup: [],
    tests: [{ id: 'boundary', label: 'Boundary probe', executable: 'node', arguments: ['-e', 'process.exit(0)'], workingDirectory: '.', timeoutSeconds: 20, network: 'none', resultFormat: 'none', resultPaths: [], scenarioMappings: [] }],
    limits: { browserActions: 100, runSeconds: 60, artifactMiB: 10 },
  });
  return { root, sourcePath, snapshotPath, config };
}

describe('repository worker Docker integration', () => {
  dockerTest('copies only the filtered snapshot, blocks host paths and egress, and removes its container', async () => {
    const { root, sourcePath, snapshotPath, config } = await setup();
    const hostSecret = join(root, 'host-secret-canary');
    await writeFile(hostSecret, 'secret must not cross into the container');
    const runId = randomUUID();
    const probeScript = `const fs=require('node:fs');const net=require('node:net');if(fs.existsSync(${JSON.stringify(hostSecret)}))process.exit(2);const s=net.createConnection({host:'192.0.2.1',port:80});s.setTimeout(600);s.on('connect',()=>process.exit(3));s.on('timeout',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(4),1000);`;
    const result = await runRepositoryChecks({
      runId, repositoryPath: sourcePath, snapshotPath, config: { ...config, tests: [{ ...config.tests[0]!, arguments: ['-e', probeScript] }] },
      timeoutMs: 15_000, workerImage: REPO_WORKER_IMAGE,
    });
    expect(result.blocked).toBeUndefined();
    expect(result.observations[0]?.status).toBe('PASSED');
    const containers = await new Promise<string>((resolve, reject) => {
      const child = spawn('docker', ['ps', '--all', '--quiet', '--filter', `label=agentic-qa.run=${runId}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
      child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error('docker ps failed')));
    });
    expect(containers).toBe('');
  });

  dockerTest('force-removes the labeled container after cancellation', async () => {
    const { sourcePath, snapshotPath, config } = await setup();
    const runId = randomUUID(); const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1_500);
    try {
      const result = await runRepositoryChecks({
        runId, repositoryPath: sourcePath, snapshotPath, config: { ...config, tests: [{ ...config.tests[0]!, arguments: ['-e', 'setInterval(()=>{},1000)'] }] },
        timeoutMs: 10_000, signal: abort.signal, workerImage: REPO_WORKER_IMAGE,
      });
      expect(abort.signal.aborted).toBe(true);
      expect(result.observations.some(({ status }) => status === 'ERROR')).toBe(true);
      const inspect = await new Promise<string>((resolve, reject) => {
        const child = spawn('docker', ['ps', '--all', '--quiet', '--filter', `label=agentic-qa.run=${runId}`], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
        child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error('docker ps failed')));
      });
      expect(inspect).toBe('');
    } finally { clearTimeout(timer); }
  });

  dockerTest('applies the configured identity, resource limits, filesystem boundary, and socket isolation', async () => {
    const { root, sourcePath, snapshotPath, config } = await setup();
    const artifactDirectory = join(root, 'captured');
    const runId = randomUUID();
    const probe = `const fs=require('node:fs');const mounts=fs.readFileSync('/proc/mounts','utf8').trim().split('\\n');const rootMount=mounts.find(x=>x.split(' ')[1]==='/')||'';const workspaceMount=mounts.find(x=>x.split(' ')[1]==='/workspace')||'';const values={uid:process.getuid(),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),dockerSocket:fs.existsSync('/var/run/docker.sock'),hostCanary:fs.existsSync(${JSON.stringify(join(root, 'host-secret-canary'))}),rootReadOnly:rootMount.split(' ')[3]?.split(',').includes('ro')===true,workspaceTmpfs:workspaceMount.split(' ')[0]==='tmpfs'&&workspaceMount.split(' ')[3]?.split(',').includes('rw')===true};fs.writeFileSync('/workspace/agentic-qa-scratch-probe','x');console.log(JSON.stringify(values));if(values.uid!==10001||values.memory!=='2147483648'||values.pids!=='128'||values.cpu!=='200000 100000'||values.dockerSocket||values.hostCanary||!values.rootReadOnly||!values.workspaceTmpfs)process.exit(7);`;
    await writeFile(join(root, 'host-secret-canary'), 'must remain outside the container');
    const result = await runRepositoryChecks({
      runId, repositoryPath: sourcePath, snapshotPath, artifactDirectory,
      config: { ...config, tests: [{ ...config.tests[0]!, arguments: ['-e', probe] }] },
      timeoutMs: 15_000, workerImage: REPO_WORKER_IMAGE,
    });
    expect(result.blocked).toBeUndefined();
    expect(result.observations[0]?.status).toBe('PASSED');
    const log = await readFile(result.artifacts[0]!.path, 'utf8');
    expect(log).toContain('"uid":10001');
    expect(log).toContain('"memory":"2147483648"');
    expect(log).toContain('"pids":"128"');
    expect(log).toContain('"cpu":"200000 100000"');
    expect(log).toContain('"dockerSocket":false');
    expect(log).toContain('"hostCanary":false');
    expect(log).toContain('"rootReadOnly":true');
    expect(log).toContain('"workspaceTmpfs":true');
  });
});
