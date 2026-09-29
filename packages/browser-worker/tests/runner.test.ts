import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runBrowserScenario } from '../src/runner.js';

const runId = '22222222-2222-4222-8222-222222222222';
let scratch = '';
let servers: Array<ReturnType<typeof createServer>> = [];

async function serve(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server did not bind.');
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

const scenario = (steps: unknown[]) => ({
  id: 'scenario-site', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [], steps,
  expectedObservations: ['The page shows the expected heading.'], risk: 'low', approved: true,
});

describe('isolated browser worker', () => {
  afterEach(async () => {
    for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
    servers = [];
    if (scratch) await rm(scratch, { recursive: true, force: true });
    scratch = '';
  }, 30_000);

  it('runs only approved-origin assertions in a fresh context', async () => {
    let blockedOriginRequests = 0;
    const external = await serve((_request, response) => { blockedOriginRequests += 1; response.end('should not load'); });
    const site = await serve((_request, response) => response.end(`<h1>Ready to search</h1><script>fetch('${external.origin}/collect').catch(()=>{})</script>`));
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const result = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      scenario: scenario([{ action: 'goto', path: '/' }, { action: 'expectText', text: 'Ready to search' }]),
    });
    expect(result.observation.status).toBe('PASSED');
    expect(result.observation.artifactIds).toEqual([]);
    expect(blockedOriginRequests).toBe(0);
    expect(result.observation.sourceIdentity).toBe(site.origin);
  }, 30_000);

  it('blocks WebSocket handshakes to origins outside the approved site', async () => {
    let externalSocketUpgrades = 0;
    const external = await serve((_request, response) => response.end('unused'));
    external.server.on('upgrade', (_request, socket) => { externalSocketUpgrades += 1; socket.destroy(); });
    const site = await serve((_request, response) => response.end(`<h1>Ready</h1><script>new WebSocket('ws://127.0.0.1:${new URL(external.origin).port}/collect');setTimeout(()=>document.body.insertAdjacentHTML('beforeend','<p>socket attempt settled</p>'),300)</script>`));
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const result = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10, scenario: scenario([{ action: 'expectText', text: 'socket attempt settled' }]),
    });
    expect(result.observation.status).toBe('PASSED');
    expect(externalSocketUpgrades).toBe(0);
  }, 30_000);

  it('keeps failed screenshots and traces restricted, and rejects invalid origins before launch', async () => {
    const site = await serve((_request, response) => response.end('<h1>Current view</h1>'));
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const result = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      scenario: scenario([{ action: 'goto', path: '/' }, { action: 'expectText', text: 'Missing content' }]),
    });
    expect(result.observation.status).toBe('FAILED');
    expect(result.artifacts.some((artifact) => artifact.kind === 'screenshot' && artifact.redactionState === 'restricted')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.kind === 'trace' && artifact.redactionState === 'restricted')).toBe(true);
    await expect(runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: ['https://attacker.example'] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10, scenario: scenario([{ action: 'expectText', text: 'x' }]),
    })).rejects.toThrow('Only the configured site origin');
  }, 30_000);

  it('enforces action budget and cancellation', async () => {
    const site = await serve((_request, response) => response.end('<p>Ready</p>'));
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const selectedScenario = scenario([{ action: 'expectText', text: 'Ready' }]);
    await expect(runBrowserScenario({ runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch, timeoutMs: 10_000, actionLimit: 0, scenario: selectedScenario })).rejects.toThrow('action limit');
    const abort = new AbortController();
    abort.abort();
    const result = await runBrowserScenario({ runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch, timeoutMs: 10_000, actionLimit: 10, scenario: selectedScenario, signal: abort.signal });
    expect(result.cancelled).toBe(true);
    expect(result.observation.status).toBe('ERROR');
  });
});
