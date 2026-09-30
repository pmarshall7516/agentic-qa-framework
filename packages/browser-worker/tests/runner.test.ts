import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { browserLaunchOptions, runBrowserScenario } from '../src/runner.js';

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
    const progress = [] as Array<{ stepId: string; order: number; status: string }>;
    const result = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      onStepProgress: (step) => { progress.push(step); },
      scenario: scenario([{ action: 'goto', path: '/' }, { action: 'expectText', text: 'Ready to search' }]),
    });
    expect(result.observation.status, result.observation.assertion).toBe('PASSED');
    expect(result.steps.map(({ stepId, order, status }) => ({ stepId, order, status }))).toEqual([
      { stepId: 'scenario-site:step:1', order: 1, status: 'PASSED' },
      { stepId: 'scenario-site:step:2', order: 2, status: 'PASSED' },
    ]);
    expect(result.artifacts.filter(({ kind }) => kind === 'screenshot').map(({ stepId, order }) => ({ stepId, order }))).toEqual([
      { stepId: 'scenario-site:step:1', order: 1 },
      { stepId: 'scenario-site:step:2', order: 2 },
    ]);
    expect(result.observation.artifactIds).toHaveLength(2);
    expect(progress.map(({ stepId, order, status }) => ({ stepId, order, status }))).toEqual([
      { stepId: 'scenario-site:step:1', order: 1, status: 'PASSED' },
      { stepId: 'scenario-site:step:2', order: 2, status: 'PASSED' },
    ]);
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
    expect(result.steps.map(({ stepId, order, status }) => ({ stepId, order, status }))).toEqual([
      { stepId: 'scenario-site:step:1', order: 1, status: 'PASSED' },
      { stepId: 'scenario-site:step:2', order: 2, status: 'FAILED' },
    ]);
    expect(result.artifacts.filter((artifact) => artifact.kind === 'screenshot' && artifact.redactionState === 'restricted').map(({ stepId, order }) => ({ stepId, order }))).toEqual([
      { stepId: 'scenario-site:step:1', order: 1 },
      { stepId: 'scenario-site:step:2', order: 2 },
    ]);
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

  it('keeps Chromium headless by default and exposes the visible-window setting', () => {
    expect(browserLaunchOptions().headless).toBe(true);
    expect(browserLaunchOptions(true).headless).toBe(false);
  });

  it('fills selected account secrets without including values in observations or progress', async () => {
    const site = await serve((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<label>Email address<input type="text"></label><label>Password<input type="password"></label><button>Sign in</button><div id="status"></div><script>document.querySelector("button").onclick=()=>document.querySelector("#status").textContent="Dashboard ready"</script>'); });
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const username = 'qa-user-canary@example.test';
    const password = 'qa-password-secret-canary';
    const result = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      testAccounts: { '33333333-3333-4333-8333-333333333333': { username, password } },
      scenario: scenario([
        { action: 'fillSecret', accountId: '33333333-3333-4333-8333-333333333333', field: 'username', role: 'textbox', name: 'Email address' },
        { action: 'fillSecret', accountId: '33333333-3333-4333-8333-333333333333', field: 'password', role: 'textbox', name: 'Password' },
        { action: 'click', role: 'button', name: 'Sign in' },
        { action: 'expectText', text: 'Dashboard ready' },
      ]),
    });
    expect(result.observation.status, result.observation.assertion).toBe('PASSED');
    expect(JSON.stringify({ observation: result.observation, steps: result.steps })).not.toContain(username);
    expect(JSON.stringify({ observation: result.observation, steps: result.steps })).not.toContain(password);
  }, 30_000);

  it('returns an actionable blocked diagnostic for missing account fields and visible sign-in pages', async () => {
    const site = await serve((_request, response) => response.end('<h1>Sign in to your account</h1><label>Email address<input></label><label>Password<input type="password"></label>'));
    scratch = await mkdtemp(path.join(tmpdir(), 'qa-browser-worker-'));
    const missingAccount = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      scenario: scenario([{ action: 'fillSecret', accountId: '33333333-3333-4333-8333-333333333333', field: 'password', role: 'textbox', name: 'Password' }]),
    });
    expect(missingAccount.observation.diagnostic).toMatchObject({ category: 'missing_test_account', stage: 'authentication', retryable: true });
    const authPage = await runBrowserScenario({
      runId, target: { siteBaseUrl: site.origin, allowedOrigins: [site.origin] }, artifactDirectory: scratch,
      timeoutMs: 10_000, actionLimit: 10,
      scenario: scenario([{ action: 'expectText', text: 'Dashboard ready' }]),
    });
    expect(authPage.observation.diagnostic).toMatchObject({ category: 'authentication_required', stage: 'authentication' });
    expect(authPage.observation.diagnostic?.nextAction).toContain('named test account');
  }, 30_000);
});
