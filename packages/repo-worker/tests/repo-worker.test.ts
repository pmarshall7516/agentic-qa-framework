import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RepositoryConfigSchema } from '../src/config.js';
import { createRepositorySnapshot } from '../src/snapshot.js';
import { mapJUnitAssertions, parseJUnit, runRepositoryChecks } from '../src/runner.js';

const validConfig = {
  schemaVersion: 1,
  project: { name: 'fixture' },
  repository: { include: ['**/*'], exclude: [] },
  setup: [],
  tests: [{ id: 'unit', label: 'Run unit checks', executable: 'npm', arguments: ['run', 'qa:unit'], workingDirectory: '.', timeoutSeconds: 30, network: 'none', resultFormat: 'none', resultPaths: [], scenarioMappings: [] }],
  limits: { browserActions: 100, runSeconds: 1800, artifactMiB: 500 },
};

describe('repository worker config boundary', () => {
  it('parses JUnit testcase failures as direct, named assertion results', async () => {
    const cases = await parseJUnit('<testsuites><testsuite tests="2"><testcase classname="Search" name="title appears"/><testcase classname="Search" name="filters stay"><failure message="expected selected">assertion failed</failure></testcase></testsuite></testsuites>');
    expect(cases).toEqual([
      { name: 'Search.title appears', passed: true, message: 'Test passed' },
      { name: 'Search.filters stay', passed: false, message: 'assertion failed' },
    ]);
  });

  it('requires exact JUnit testcase identities for each mapped Scenario', () => {
    const mapped = mapJUnitAssertions(
      [{ name: 'Search.title appears', passed: true }, { name: 'Other.unrelated', passed: true }],
      [{ scenarioId: 'criterion-search-repo', testCaseIds: ['Search.title appears', 'Search.filters remain'] }],
    );
    expect(mapped).toEqual([{ scenarioId: 'criterion-search-repo', status: 'ERROR', assertion: '1/2 mapped JUnit assertions matched; 0 failed. 1 expected test identities were missing.' }]);
  });

  it('rejects shell interpolation, network access, unknown fields, and path escapes', () => {
    expect(RepositoryConfigSchema.safeParse({ ...validConfig, surprise: true }).success).toBe(false);
    expect(RepositoryConfigSchema.safeParse({ ...validConfig, tests: [{ ...validConfig.tests[0], arguments: ['$(touch /tmp/pwned)'] }] }).success).toBe(false);
    expect(RepositoryConfigSchema.safeParse({ ...validConfig, tests: [{ ...validConfig.tests[0], network: 'approved-registries' }] }).success).toBe(false);
    expect(RepositoryConfigSchema.safeParse({ ...validConfig, tests: [{ ...validConfig.tests[0], workingDirectory: '../../' }] }).success).toBe(false);
  });

  it('copies only configured regular files and excludes secrets and symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-repo-snapshot-'));
    const sourcePath = join(root, 'source'); const targetPath = join(root, 'snapshot');
    await mkdir(sourcePath);
    await writeFile(join(sourcePath, 'package.json'), '{"name":"fixture"}');
    await writeFile(join(sourcePath, '.env'), 'SECRET=canary');
    await writeFile(join(sourcePath, 'id_rsa'), 'private key');
    await writeFile(join(sourcePath, 'ignored.txt'), 'not selected');
    await symlink(join(sourcePath, '.env'), join(sourcePath, 'link.env'));
    const config = RepositoryConfigSchema.parse({ ...validConfig, repository: { include: ['**/*'], exclude: [] } });
    try {
      const result = await createRepositorySnapshot({ sourcePath, destinationPath: targetPath, config });
      expect(result.copiedFiles).toBe(2);
      expect(result.excludedPaths).toEqual(expect.arrayContaining(['.env', 'id_rsa']));
      expect(await readFile(join(targetPath, 'package.json'), 'utf8')).toContain('fixture');
      await expect(readFile(join(targetPath, '.env'), 'utf8')).rejects.toThrow();
      await expect(readFile(join(targetPath, 'link.env'), 'utf8')).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('passes only fixed isolation flags and executable argument arrays to Docker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-repo-runner-'));
    const sourcePath = join(root, 'source'); const snapshotPath = join(root, 'snapshot'); const dockerLog = join(root, 'docker.log'); const docker = join(root, 'docker');
    await mkdir(sourcePath); await writeFile(join(sourcePath, 'package.json'), '{}');
    await writeFile(docker, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(dockerLog)}\nif [ "$1" = "create" ]; then printf '%064d\\n' 0; fi\nexit 0\n`); await chmod(docker, 0o700);
    const config = RepositoryConfigSchema.parse(validConfig);
    try {
      const result = await runRepositoryChecks({ runId: randomUUID(), repositoryPath: sourcePath, config, snapshotPath, timeoutMs: 5000, dockerPath: docker });
      expect(result.blocked).toBeUndefined();
      expect(result.observations[0]?.status).toBe('PASSED');
      const calls = await readFile(dockerLog, 'utf8');
      expect(calls).toContain('--network=none');
      expect(calls).toContain('--read-only');
      expect(calls).toContain('--cap-drop=ALL');
      expect(calls).toContain('--pids-limit=128');
      expect(calls).toContain('--memory=2g');
      expect(calls).toContain('--cpus=2');
      expect(calls).toContain('--user=10001:10001');
      expect(calls).toContain('--tmpfs=/workspace:rw,exec,nosuid,nodev,size=1g,mode=1777');
      expect(calls).toContain('npm run qa:unit');
      expect(calls).toContain('tar -xf - -C /workspace');
      expect(calls).toContain('\nrm --force');
      expect(calls).not.toContain('type=bind');
      expect(calls).not.toContain('/.ssh');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('captures bounded command stdout and stderr in a restricted log artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-repo-capture-'));
    const sourcePath = join(root, 'source'); const snapshotPath = join(root, 'snapshot');
    const artifactDirectory = join(root, 'artifacts'); const docker = join(root, 'docker');
    await mkdir(sourcePath); await writeFile(join(sourcePath, 'package.json'), '{}');
    await writeFile(docker, `#!/bin/sh\nif [ "$1" = image ]; then exit 0; fi\nif [ "$1" = create ]; then printf '%064d\\n' 0; exit 0; fi\nif [ "$1" = exec ]; then if [ "$2" = --interactive ]; then cat >/dev/null; exit 0; fi; node -e 'process.stdout.write("x".repeat(120000));process.stderr.write("e".repeat(6000))'; exit 0; fi\nexit 0\n`);
    await chmod(docker, 0o700);
    const config = RepositoryConfigSchema.parse(validConfig);
    try {
      const result = await runRepositoryChecks({ runId: randomUUID(), repositoryPath: sourcePath, config, snapshotPath, artifactDirectory, timeoutMs: 5000, dockerPath: docker });
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]).toMatchObject({ kind: 'log', commandId: 'unit' });
      const contents = await readFile(result.artifacts[0]!.path, 'utf8');
      expect(contents.length).toBeLessThanOrEqual(104100);
      expect(contents).toContain('x'.repeat(100));
      expect(contents).toContain('e'.repeat(100));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects JUnit output larger than the remaining evidence budget before writing it to the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-repo-junit-limit-'));
    const sourcePath = join(root, 'source'); const snapshotPath = join(root, 'snapshot');
    const dockerLog = join(root, 'docker.log'); const docker = join(root, 'docker');
    await mkdir(sourcePath); await writeFile(join(sourcePath, 'package.json'), '{}');
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(dockerLog)}
if [ "$1" = image ]; then exit 0; fi
if [ "$1" = create ]; then printf '%064d\\n' 0; exit 0; fi
if [ "$1" = exec ]; then
  if [ "$2" = --interactive ]; then cat >/dev/null; exit 0; fi
  if [ "$3" = node ]; then head -c 1000 /dev/zero | tr '\\0' x; exit 0; fi
  exit 0
fi
if [ "$1" = cp ]; then printf '%s' '<testsuites><testsuite><testcase name="sample"/></testsuite></testsuites>' > "$3"; exit 0; fi
exit 0
`); await chmod(docker, 0o700);
    const config = RepositoryConfigSchema.parse({
      ...validConfig,
      tests: [{ ...validConfig.tests[0], resultFormat: 'junit', resultPaths: ['results.xml'] }],
    });
    try {
      const result = await runRepositoryChecks({ runId: randomUUID(), repositoryPath: sourcePath, config, snapshotPath, timeoutMs: 5000, maxArtifactBytes: 200, dockerPath: docker });
      expect(result.blocked).toMatch(/JUnit output exceeds the remaining evidence size limit/i);
      expect(result.artifacts).toHaveLength(1);
      expect(await readFile(dockerLog, 'utf8')).not.toMatch(/^cp /m);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
