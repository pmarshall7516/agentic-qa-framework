import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = await mkdtemp(join(tmpdir(), 'agentic-qa-ui-review-'));
const server = await createServer({
  configFile: join(appRoot, 'vite.config.ts'),
  root: appRoot,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
const consoleErrors = [];

async function openScenario(scenario) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${server.resolvedUrls.local[0]}ui-review.html?scenario=${scenario}`);
  return page;
}

async function capture(page, name, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole('main').waitFor();
  await page.screenshot({ path: join(screenshots, `${name}-${width}.png`), fullPage: true });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  assert.ok(layout.document <= layout.viewport, `${name} overflows horizontally at ${width}px: ${JSON.stringify(layout)}`);
  assert.match(layout.colorScheme, /dark/, `${name} does not declare dark color controls.`);
  return layout;
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true });

  const page = await openScenario('onboarding');
  assert.match(await page.title(), /Agentic QA/);
  await page.getByRole('heading', { name: 'Start your QA workspace' }).waitFor();
  await capture(page, '01-onboarding');
  await page.getByRole('button', { name: 'Sign in with Azure DevOps' }).click();
  await page.getByRole('heading', { name: 'Choose an organization', exact: true }).waitFor();
  await capture(page, '02-organizations');
  await page.getByRole('button', { name: /Contoso/ }).click();
  await page.getByRole('button', { name: /Portal Experience/ }).click();
  await page.getByRole('heading', { name: 'Find work to verify' }).waitFor();
  await page.locator('.brand-symbol img').waitFor();
  assert.equal(await page.locator('.brand-symbol img').evaluate((image) => image.naturalWidth), 1024, 'the provided app icon should load at its native 1024px width');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.getByRole('button', { name: 'Import key and discover models…' }).click();
  await page.getByText('1 supported models discovered.').waitFor();
  await page.getByLabel('Search models').fill('terra');
  await page.getByLabel('Supported model').selectOption('gpt-5.6-terra');
  await page.getByRole('button', { name: 'Save required agent model' }).click();
  await page.getByText('Required agent provider, model and output-token limit saved locally.').waitFor();
  await page.getByLabel('Account label').fill('QA Editor');
  await page.getByLabel('Exact site origin').fill('https://staging.example.test');
  await page.getByLabel('Username').fill('qa-user@example.test');
  await page.getByLabel('Password').fill('fixture-password-canary');
  await page.getByRole('button', { name: 'Save encrypted test account' }).click();
  await page.getByText('Encrypted test account saved. Its username and password are not available for readback.').waitFor();
  assert.equal(await page.getByLabel('Password').inputValue(), '', 'saved password field should clear immediately');
  await page.getByLabel('Provider').selectOption('claude-code');
  await page.getByRole('button', { name: 'Connect Claude account…' }).click();
  await page.getByText('Claude account connected. 3 supported models discovered.').waitFor();
  await page.getByLabel('Search models').fill('sonnet');
  await page.getByLabel('Supported model').selectOption('sonnet');
  await page.getByRole('button', { name: 'Save required agent model' }).click();
  await page.getByText('Required agent provider, model and output-token limit saved locally.').waitFor();
  await page.getByRole('button', { name: 'Work items' }).click();
  await page.getByRole('heading', { name: 'Find work to verify' }).waitFor();
  await capture(page, '03-work-items');
  await capture(page, '03-work-items', 800);
  await page.getByLabel('Work item ID or title').fill('4821');
  await page.getByRole('button', { name: 'Search work items' }).click();
  await page.getByText('Search keeps the selected filters').waitFor();
  const story = page.locator('.work-card').filter({ hasText: 'Search keeps the selected filters' });
  await story.getByRole('button', { name: 'Browse child tasks' }).click();
  await page.getByText('Persist filter selection while opening results').waitFor();
  await story.getByRole('button', { name: 'Add to queue' }).click();
  await page.locator('.work-card').filter({ hasText: 'Persist filter selection while opening results' }).getByRole('button', { name: 'Add to queue' }).click();
  await page.getByRole('button', { name: 'QA Queue' }).click();
  await page.getByRole('heading', { name: 'Your QA Queue' }).waitFor();
  await capture(page, '04-queue');
  await capture(page, '04-queue', 800);
  await page.getByRole('button', { name: 'Start QA' }).click();
  await page.getByRole('heading', { name: 'Set up a QA run' }).waitFor();
  await page.getByLabel('Development or staging URL').fill('https://staging.example.test');
  await page.getByLabel('Named test accounts').selectOption('66666666-6666-4666-8666-666666666666');
  await page.getByLabel('Extra QA context or instructions (optional)').fill('Use the editor role and verify the filtered result list.');
  await page.getByLabel('Show Playwright browser window while testing').check();
  await capture(page, '05-run-setup');
  await page.getByRole('button', { name: 'Prepare agentic QA plan' }).click();
  await page.getByRole('heading', { name: 'Review the QA plan' }).waitFor();
  await page.getByRole('heading', { name: 'Orchestrator plan' }).waitFor();
  await page.getByText(/QA Editor/).waitFor();
  await page.getByText(/Use the editor role and verify the filtered result list/).waitFor();
  await page.getByText(/visible Playwright window/).waitFor();
  await capture(page, '06-plan-review');
  await capture(page, '06-plan-review', 800);
  await page.getByRole('button', { name: 'Approve reviewed QA scope' }).click();
  await page.getByRole('heading', { name: 'Run history' }).waitFor();
  await page.getByRole('button', { name: 'Approve generated checks and start' }).click();
  await page.getByText('Local report preview').waitFor();
  await page.locator('.report-preview .panel-title-row p').filter({ hasText: 'COMPLETED' }).waitFor();

  const history = await openScenario('report');
  await history.getByRole('button', { name: 'Runs' }).click();
  await history.getByRole('button', { name: /site · 1 source snapshots/ }).click();
  await history.getByText('Local report preview').waitFor();
  await capture(history, '07-report');

  const blocked = await openScenario('blocked-report');
  await blocked.getByRole('button', { name: 'Runs' }).click();
  await blocked.getByRole('button', { name: /site · 1 source snapshots/ }).click();
  await blocked.getByText('authentication_required').waitFor();
  await blocked.getByText('Select a named test account for this site origin and create a fresh plan.').waitFor();
  await capture(blocked, '07-blocked-report');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await capture(page, '08-settings');
  await capture(page, '08-settings', 800);
  await page.getByRole('button', { name: 'Manage organizations' }).click();
  await page.getByRole('heading', { name: 'Choose an organization', exact: true }).waitFor();
  await capture(page, '09-organization-management', 800);

  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join(' | ')}`);
  console.log(`Playwright UI review passed. Screenshots: ${screenshots}`);
  console.log('Checked onboarding, required provider/model discovery and search, named test account save and clearing, organization/project selection, work search and child Tasks, Queue, run context/account/headed-browser controls, plan disclosure, success and blocked reports, Settings, 800px overflow, and browser errors.');
} finally {
  await browser?.close();
  await server.close();
}
