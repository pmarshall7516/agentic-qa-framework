import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { ScenarioSchema, type Scenario } from '@agentic-qa/domain/qa-contract';
import { ObservationSchema, type Observation } from '@agentic-qa/domain/run';

export interface BrowserTarget {
  siteBaseUrl: string;
  allowedOrigins: string[];
}

export interface BrowserScenarioResult {
  observation: Observation;
  artifacts: Array<{ id: string; kind: 'trace' | 'screenshot'; path: string; sha256: string; bytes: number; redactionState: 'restricted'; stepId?: string; order?: number }>;
  steps: Array<{ stepId: string; order: number; action: Scenario['steps'][number]['action']; status: 'PASSED' | 'FAILED'; assertion: string; completedAt: string }>;
  cancelled: boolean;
  diagnostic?: NonNullable<Observation['diagnostic']>;
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PLAYWRIGHT_BROWSERS_PATH'];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
}

export function browserLaunchOptions(showBrowserWindow = false) {
  return { headless: !showBrowserWindow, chromiumSandbox: true, env: safeEnvironment() };
}

async function fileArtifact(path: string, kind: 'trace' | 'screenshot') {
  const bytes = await stat(path);
  const content = await import('node:fs/promises').then(({ readFile }) => readFile(path));
  return { id: randomUUID(), kind, path, sha256: createHash('sha256').update(content).digest('hex'), bytes: bytes.size, redactionState: 'restricted' as const };
}

function allowedTarget(input: BrowserTarget): { base: URL; origins: Set<string> } {
  const base = new URL(input.siteBaseUrl);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Browser target must use HTTPS or an HTTP loopback host.');
  if (base.username || base.password || base.search || base.hash) throw new Error('Browser target URL cannot contain credentials, query parameters, or a fragment.');
  const origins = new Set(input.allowedOrigins);
  if (!origins.size || !origins.has(base.origin) || origins.size > 1) throw new Error('Only the configured site origin may be approved in this release.');
  for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error('Approved browser targets must be origins, not paths.');
  return { base, origins };
}

function transportNormalizedOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  else if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  return parsed.origin;
}

type BrowserSecretMap = Record<string, Partial<Record<'username' | 'password', string>>>;

async function applyStep(page: Page, step: Scenario['steps'][number], base: URL, timeoutMs: number, testAccounts: BrowserSecretMap): Promise<string> {
  switch (step.action) {
    case 'goto': {
      const destination = new URL(step.path, base);
      if (destination.origin !== base.origin) throw new Error('Scenario navigation is outside the approved origin.');
      await page.goto(destination.toString(), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return `Navigated to ${destination.pathname}`;
    }
    case 'click':
      await page.getByRole(step.role, { name: step.name, exact: true }).click({ timeout: timeoutMs });
      return `Clicked ${step.role} “${step.name}”`;
    case 'fill':
      await page.getByRole(step.role, { name: step.name, exact: true }).fill(step.value, { timeout: timeoutMs });
      return `Filled ${step.role} “${step.name}”`;
    case 'fillSecret': {
      const value = testAccounts[step.accountId]?.[step.field];
      if (!value) throw new Error(`Selected test account is missing the ${step.field} field.`);
      await page.getByRole(step.role, { name: step.name, exact: true }).fill(value, { timeout: timeoutMs });
      return `Filled ${step.field} from selected test account into ${step.role} “${step.name}”`;
    }
    case 'press':
      await page.getByRole(step.role, { name: step.name, exact: true }).press(step.key, { timeout: timeoutMs });
      return `Pressed ${step.key} in ${step.role} “${step.name}”`;
    case 'expectVisible':
      await page.getByRole(step.role, { name: step.name, exact: true }).waitFor({ state: 'visible', timeout: timeoutMs });
      return `Verified visible ${step.role} “${step.name}”`;
    case 'expectText':
      await page.getByText(step.text, { exact: false }).first().waitFor({ state: 'visible', timeout: timeoutMs });
      return `Verified visible text “${step.text.slice(0, 240)}”`;
  }
}

function secretsFrom(map: BrowserSecretMap): string[] {
  return Object.values(map).flatMap((fields) => Object.values(fields)).filter((value): value is string => Boolean(value));
}

function redactSecrets(value: string, secrets: string[]): string {
  return secrets.reduce((result, secret) => result.replaceAll(secret, '[REDACTED]'), value).slice(0, 4000);
}

async function classifyFailure(page: Page | undefined, error: unknown, step: Scenario['steps'][number] | undefined, accounts: BrowserSecretMap): Promise<NonNullable<Observation['diagnostic']>> {
  const message = redactSecrets(error instanceof Error ? error.message : 'Browser scenario failed.', secretsFrom(accounts));
  const url = page && !page.isClosed() ? page.url().toLocaleLowerCase('en-US').split(/[?#]/, 1)[0] ?? '' : '';
  let pageText = '';
  if (page && !page.isClosed()) {
    try { pageText = redactSecrets(`${await page.title()} ${await page.locator('body').innerText({ timeout: 500 }).catch(() => '')}`.toLocaleLowerCase('en-US'), secretsFrom(accounts)); } catch { /* page diagnostics are best effort */ }
  }
  if (/missing the (username|password) field/i.test(message)) return { stage: 'authentication', category: 'missing_test_account', detail: message, nextAction: 'Open Settings, add or update the named test account for this site origin, select it in run setup, then create a fresh plan.', retryable: true };
  if (/access denied|access is denied|forbidden|not authorized|http 403/.test(`${url} ${pageText} ${message.toLocaleLowerCase('en-US')}`)) return { stage: 'authentication', category: 'access_denied', detail: 'The site denied access to the selected account.', nextAction: 'Confirm that the selected test account has access to this environment and that the site URL is correct.', retryable: true };
  if (/multi.factor|two.factor|verification code|authenticator|one.time password|mfa/.test(`${url} ${pageText}`)) return { stage: 'authentication', category: 'manual_authentication_required', detail: 'The site requires an interactive MFA or verification step that the approved scenario cannot complete.', nextAction: 'Complete the sign-in challenge manually or provide an approved test account flow that does not require an unsupported challenge, then retry.', retryable: true };
  if (/login|log-in|sign.in|signin|auth\//.test(url) || /sign in to your account|log in to continue|email address.{0,80}password/.test(pageText)) return { stage: 'authentication', category: 'authentication_required', detail: 'The site displayed a sign-in page before the expected check completed.', nextAction: 'Select a valid named test account for this origin and make sure the scenario includes the required username/password fields and submit action.', retryable: true };
  if (/net::err_|timeout|connection refused|name_not_resolved|dns|navigation failed/i.test(message)) return { stage: 'navigation', category: 'target_unavailable', detail: message, nextAction: 'Confirm the development site is reachable from this computer, then retry the run.', retryable: true };
  if (message.includes('outside the approved origin') || message.includes('approved origin')) return { stage: 'navigation', category: 'policy_blocked', detail: message, nextAction: 'Review the approved site URL and update the run target before creating a new plan.', retryable: false };
  if (!step) return { stage: 'environment', category: 'browser_unavailable', detail: message, nextAction: 'Install or repair the local Playwright Chromium browser from Run setup, then retry.', retryable: true };
  return { stage: step.action.startsWith('expect') ? 'assertion' : 'interaction', category: step.action.startsWith('expect') ? 'assertion_failed' : 'selector_or_action_failed', detail: message, nextAction: step.action.startsWith('expect') ? 'Compare the observed page with the acceptance criterion and inspect the restricted screenshot/trace before classifying this as a product defect.' : 'Inspect the restricted screenshot/trace and confirm the accessible control name and run preconditions before retrying.', retryable: true };
}

export async function runBrowserScenario(options: {
  runId: string;
  target: BrowserTarget;
  scenario: unknown;
  artifactDirectory: string;
  timeoutMs: number;
  actionLimit: number;
  showBrowserWindow?: boolean;
  testAccounts?: BrowserSecretMap;
  signal?: AbortSignal;
  now?: () => string;
  onStepProgress?: (step: BrowserScenarioResult['steps'][number]) => void | Promise<void>;
}): Promise<BrowserScenarioResult> {
  const scenario = ScenarioSchema.parse(options.scenario);
  if (scenario.layer !== 'browser' || !scenario.approved) throw new Error('Only approved browser scenarios can execute.');
  if (!scenario.steps.length) throw new Error('Browser scenario has no executable assertions.');
  if (scenario.steps.length + 1 > options.actionLimit) throw new Error('Scenario and initial navigation exceed the configured browser action limit.');
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 600_000) throw new Error('Browser timeout is outside the permitted range.');
  const { base, origins } = allowedTarget(options.target);
  await mkdir(options.artifactDirectory, { recursive: true, mode: 0o700 });
  const now = options.now ?? (() => new Date().toISOString());
  const observationId = randomUUID();
  const startedAt = now();
  const artifacts: BrowserScenarioResult['artifacts'] = [];
  const steps: BrowserScenarioResult['steps'] = [];
  let activeStep: { step: Scenario['steps'][number]; order: number; stepId: string } | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let cancelled = false;
  let status: Observation['status'] = 'PASSED';
  let assertion = 'All approved browser assertions passed.';
  let diagnostic: NonNullable<Observation['diagnostic']> | undefined;
  const testAccounts = options.testAccounts ?? {};
  const scratch = options.artifactDirectory;
  const abortBrowser = () => {
    cancelled = true;
    void context?.close();
    void browser?.close();
  };
  options.signal?.addEventListener('abort', abortBrowser, { once: true });
  try {
    if (options.signal?.aborted) throw new DOMException('Run cancelled.', 'AbortError');
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ ...browserLaunchOptions(options.showBrowserWindow), timeout: options.timeoutMs });
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', ignoreHTTPSErrors: false });
    await context.route('**/*', async (route) => {
      let origin = '';
      try { origin = new URL(route.request().url()).origin; } catch { /* reject malformed or opaque requests */ }
      if (!origins.has(origin)) await route.abort('blockedbyclient');
      else await route.continue();
    });
    context.routeWebSocket('**/*', (webSocketRoute) => {
      let origin = '';
      try { origin = transportNormalizedOrigin(webSocketRoute.url()); } catch { /* reject malformed sockets */ }
      if (origins.has(origin)) webSocketRoute.connectToServer();
      else webSocketRoute.close({ code: 1008, reason: 'Origin is not approved.' });
    });
    const page = await context.newPage();
    page.on('popup', (popup) => { void popup.close(); });
    page.on('filechooser', () => { /* file upload is not an enabled scenario action */ });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: scenario.id });
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    let completed = 0;
    for (const [index, step] of scenario.steps.entries()) {
      if (options.signal?.aborted) throw new DOMException('Run cancelled.', 'AbortError');
      activeStep = { step, order: index + 1, stepId: `${scenario.id}:step:${index + 1}` };
      assertion = await applyStep(page, step, base, options.timeoutMs, testAccounts);
      const screenshotPath = join(scratch, `${observationId}-step-${String(index + 1).padStart(4, '0')}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 });
        const artifact = await fileArtifact(screenshotPath, 'screenshot');
        artifacts.push({ ...artifact, path: screenshotPath, stepId: activeStep.stepId, order: activeStep.order });
      } catch { /* evidence capture is best effort and cannot turn a passing assertion into a failed check */ }
      const completedStep = { stepId: activeStep.stepId, order: activeStep.order, action: step.action, status: 'PASSED' as const, assertion, completedAt: now() };
      steps.push(completedStep);
      try { await options.onStepProgress?.(completedStep); } catch { /* progress reporting cannot change the observation */ }
      activeStep = undefined;
      completed += 1;
    }
    if (completed === 0) throw new Error('No browser assertions were executed.');
  } catch (error) {
    cancelled = options.signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
    status = cancelled ? 'ERROR' : 'FAILED';
    diagnostic = cancelled ? undefined : await classifyFailure(context?.pages()[0], error, activeStep?.step, testAccounts);
    assertion = cancelled ? 'Browser scenario was cancelled.' : redactSecrets(error instanceof Error ? error.message : 'Browser scenario failed.', secretsFrom(testAccounts)).slice(0, 1000);
    if (context) {
      try {
        const page = context.pages()[0];
        if (page && !page.isClosed() && activeStep) {
          const screenshotPath = join(scratch, `${observationId}-step-${String(activeStep.order).padStart(4, '0')}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 }).catch(() => undefined);
          if (await stat(screenshotPath).then(() => true).catch(() => false)) {
            const artifact = await fileArtifact(screenshotPath, 'screenshot');
            artifacts.push({ ...artifact, path: screenshotPath, stepId: activeStep.stepId, order: activeStep.order });
          }
        } else if (page && !page.isClosed() && steps.length === 0) {
          // Preserve a scenario-level screenshot if setup or initial navigation failed before a step began.
          const screenshotPath = join(scratch, `${observationId}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 }).catch(() => undefined);
          if (await stat(screenshotPath).then(() => true).catch(() => false)) artifacts.push({ ...(await fileArtifact(screenshotPath, 'screenshot')), path: screenshotPath });
        }
      } catch { /* a failed capture never changes the test observation */ }
    }
    if (activeStep) {
      const failedStep = { stepId: activeStep.stepId, order: activeStep.order, action: activeStep.step.action, status: 'FAILED' as const, assertion, completedAt: now() };
      steps.push(failedStep);
      try { await options.onStepProgress?.(failedStep); } catch { /* progress reporting cannot change the observation */ }
      activeStep = undefined;
    }
  } finally {
    options.signal?.removeEventListener('abort', abortBrowser);
    if (context) {
      const tracePath = join(scratch, `${observationId}.trace.zip`);
      await context.tracing.stop({ path: tracePath }).catch(() => undefined);
      if (status !== 'PASSED' && await stat(tracePath).then(() => true).catch(() => false)) artifacts.push(await fileArtifact(tracePath, 'trace'));
      await context.close().catch(() => undefined);
    }
    await browser?.close().catch(() => undefined);
  }
  const observation = ObservationSchema.parse({
    id: observationId,
    runId: options.runId,
    scenarioId: scenario.id,
    status,
    worker: 'browser',
    startedAt,
    endedAt: now(),
    assertion,
    artifactIds: artifacts.map(({ id }) => id),
    sourceIdentity: base.origin,
    ...(diagnostic ? { diagnostic } : {}),
  });
  return { observation, artifacts, steps, cancelled, ...(diagnostic ? { diagnostic } : {}) };
}
