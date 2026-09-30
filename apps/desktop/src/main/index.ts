import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { runClaudeCliCommand } from '@agentic-qa/model-adapters/claude-cli';
import { openQaStore } from '@agentic-qa/storage/database';
import { AzureCliAdoAuthService } from '@agentic-qa/ado/azure-cli-auth';
import { DesktopController } from './controller.js';
import { registerIpcHandlers } from './ipc.js';
import { REPO_WORKER_IMAGE } from '@agentic-qa/repo-worker/runner';
import type { ModelStreamEvent } from '../shared/ipc.js';

const devServerUrl = !app.isPackaged && process.env.VITE_DEV_SERVER_URL === 'http://127.0.0.1:5173'
  ? process.env.VITE_DEV_SERVER_URL
  : undefined;
app.setName('Agentic QA');
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173; style-src 'self' 'unsafe-inline' http://127.0.0.1:5173; img-src 'self' data:; connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";

function runClaudeCommand(args: string[], timeoutMs: number, captureOutput = false): Promise<{ code: number; output: string }> {
  return runClaudeCliCommand(args, '', { timeoutMs, maxOutputBytes: captureOutput ? 16_384 : 64_000 })
    .then(({ code, output }) => ({ code, output: captureOutput ? output : '' }));
}

async function claudeAccountStatus(): Promise<{ connected: boolean; email?: string }> {
  const status = await runClaudeCommand(['auth', 'status', '--json'], 10_000, true);
  if (status.code !== 0) return { connected: false };
  try {
    const parsed: unknown = JSON.parse(status.output);
    if (!parsed || typeof parsed !== 'object') return { connected: false };
    const auth = parsed as { loggedIn?: unknown; apiProvider?: unknown; authMethod?: unknown; email?: unknown };
    const connected = auth.loggedIn === true && auth.apiProvider === 'firstParty' && typeof auth.authMethod === 'string' && auth.authMethod !== 'none';
    const email = typeof auth.email === 'string' && auth.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auth.email) ? auth.email : undefined;
    return { connected, ...(connected && email ? { email } : {}) };
  } catch { return { connected: false }; }
}

async function claudeAccountConnected(): Promise<boolean> {
  return (await claudeAccountStatus()).connected;
}

function dockerCommand(args: string[], timeoutMs = 10_000): Promise<{ code: number; errorText: string; output: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME'];
    const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!] as const] : []));
    const child = spawn('docker', args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let errorText = '';
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString('utf8')).slice(-4000); });
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-20_000); });
    child.on('error', (error) => { clearTimeout(timer); rejectCommand(error); });
    child.on('close', (code) => resolveCommand({ code: timedOut ? 124 : code ?? 1, errorText: timedOut ? `Docker command exceeded ${Math.floor(timeoutMs / 1000)} seconds.` : errorText, output }));
  });
}

async function cleanupManagedContainers(): Promise<void> {
  const result = await dockerCommand(['ps', '--quiet', '--all', '--filter', 'label=agentic-qa.managed=true'], 2_000).catch(() => undefined);
  if (!result || result.code !== 0) return;
  const ids = result.output.split(/\r?\n/).filter((id) => /^[a-f0-9]{12,64}$/i.test(id));
  if (ids.length) await dockerCommand(['rm', '--force', ...ids], 5_000).catch(() => undefined);
}

async function getDatabaseKey(keyPath: string): Promise<Buffer> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed credential protection is unavailable. Encrypted local storage cannot be opened.');
  }
  try {
    const encrypted = await readFile(keyPath, 'utf8');
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(encrypted, 'base64')), 'base64');
    if (key.length !== 32) {
      key.fill(0);
      throw new Error('Stored database key is invalid.');
    }
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unable to unlock the local storage key.');
    const key = randomBytes(32);
    try {
      const encrypted = safeStorage.encryptString(key.toString('base64')).toString('base64');
      await writeFile(keyPath, encrypted, { flag: 'wx', mode: 0o600 });
      await chmod(keyPath, 0o600);
      return key;
    } catch {
      key.fill(0);
      throw new Error('Unable to create the OS-protected local storage key.');
    }
  }
}

async function createWindow(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const scratchRoot = join(app.getPath('temp'), 'agentic-qa');
  const browserPath = join(userDataPath, 'playwright-browsers');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const localRequire = createRequire(__filename);
  const playwrightCliPath = join(dirname(localRequire.resolve('playwright/package.json')), 'cli.js');
  const { chromium } = localRequire('playwright') as typeof import('playwright');
  await mkdir(userDataPath, { recursive: true, mode: 0o700 });
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await chmod(scratchRoot, 0o700);
  void cleanupManagedContainers();
  for (const entry of await readdir(scratchRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('agentic-qa-')) await rm(join(scratchRoot, entry.name), { recursive: true, force: true }).catch(() => undefined);
  }
  const store = await openQaStore({
    databasePath: join(userDataPath, 'qa-data.sqlite3'),
    key: () => getDatabaseKey(join(userDataPath, 'storage-key.enc')),
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 680,
    backgroundColor: '#f5f6f8',
    title: 'Agentic QA',
    icon: join(app.getAppPath(), 'dist', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  const progressWindows = new Map<string, BrowserWindow>();
  const progressWindowsReady = new Set<string>();
  const waitingModelEvents = new Map<string, ModelStreamEvent[]>();
  const sendModelEvent = (event: ModelStreamEvent) => {
    if (!window.isDestroyed()) window.webContents.send('qa:model-stream', event);
    const progressWindow = progressWindows.get(event.streamId);
    if (!progressWindow || progressWindow.isDestroyed()) return;
    if (progressWindowsReady.has(event.streamId)) {
      progressWindow.webContents.send('qa:model-stream', event);
      return;
    }
    const queue = [...(waitingModelEvents.get(event.streamId) ?? []), event];
    let queuedChars = queue.reduce((total, item) => total + (item.type === 'text' ? item.chunk.length : item.message.length), 0);
    while (queue.length > 2000 || queuedChars > 100_000) {
      const removed = queue.shift();
      if (!removed) break;
      queuedChars -= removed.type === 'text' ? removed.chunk.length : removed.message.length;
    }
    waitingModelEvents.set(event.streamId, queue);
  };
  const openPlanProgressWindow = async (streamId: string) => {
    const existing = progressWindows.get(streamId);
    if (existing && !existing.isDestroyed()) { existing.focus(); return; }
    const progressWindow = new BrowserWindow({
      width: 820, height: 680, minWidth: 600, minHeight: 440,
      backgroundColor: '#111820', title: 'Plan agent progress', parent: window, autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
        sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false,
      },
    });
    progressWindow.setMenuBarVisibility(false);
    progressWindows.set(streamId, progressWindow);
    progressWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    progressWindow.webContents.on('will-navigate', (event, url) => {
      const trusted = devServerUrl ? new URL(url).origin === new URL(devServerUrl).origin : url === packagedUrl;
      if (!trusted) event.preventDefault();
    });
    progressWindow.on('closed', () => {
      progressWindows.delete(streamId);
      progressWindowsReady.delete(streamId);
      waitingModelEvents.delete(streamId);
    });
    try {
      if (devServerUrl) {
        const progressUrl = new URL(devServerUrl);
        progressUrl.searchParams.set('planProgress', streamId);
        await progressWindow.loadURL(progressUrl.toString());
      } else {
        await progressWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'), { query: { planProgress: streamId } });
      }
    } catch (error) {
      if (!progressWindow.isDestroyed()) progressWindow.close();
      throw error;
    }
  };
  const readyPlanProgressWindow = (streamId: string) => {
    const progressWindow = progressWindows.get(streamId);
    if (!progressWindow || progressWindow.isDestroyed()) return;
    progressWindowsReady.add(streamId);
    for (const event of waitingModelEvents.get(streamId) ?? []) progressWindow.webContents.send('qa:model-stream', event);
    waitingModelEvents.delete(streamId);
  };
  const controller = new DesktopController({
    store,
    emitModelStream: sendModelEvent,
    openPlanProgressWindow,
    readyPlanProgressWindow,
    browserExecutablePath: () => chromium.executablePath(),
    installBrowser: () => new Promise<void>((resolveInstall, rejectInstall) => {
      const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME'];
      const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!] as const] : []));
      const child = spawn(process.execPath, [playwrightCliPath, 'install', 'chromium'], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browserPath },
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
      let errorText = '';
      child.stderr.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString('utf8')).slice(-4000); });
      child.on('error', rejectInstall);
      child.on('close', (code) => code === 0 ? resolveInstall() : rejectInstall(new Error(`Chromium download failed (${code ?? 'unknown exit'}). ${errorText}`)));
    }),
    confirmDeleteRun: async (runId) => {
      const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Delete run'], defaultId: 0, cancelId: 0, title: 'Delete QA run', message: 'Permanently delete this run, its report, and encrypted evidence?', detail: `Run ${runId}` });
      return answer.response === 1;
    },
    selectSignOutDataAction: async (username) => {
      const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Keep local QA data', 'Delete local QA data'], defaultId: 1, cancelId: 0, title: 'Sign out of Azure DevOps', message: `Choose what to do with the local QA data on this device before signing out as ${username}.`, detail: 'Deleting removes all local QA Queue entries, saved work item snapshots, run history, reports, encrypted evidence, and saved Azure DevOps selections. This applies to every account on this device. Your app registration and OpenAI provider settings are kept.' });
      return answer.response === 1 ? 'keep' : answer.response === 2 ? 'delete' : 'cancel';
    },
    repoWorkerImageProbe: async () => (await dockerCommand(['image', 'inspect', REPO_WORKER_IMAGE])).code === 0,
    installRepoWorkerImage: async () => {
      const context = app.isPackaged
        ? join(process.resourcesPath, 'repo-worker')
        : join(app.getAppPath(), '..', '..', 'packages', 'repo-worker', 'image');
      const result = await dockerCommand(['build', '--pull', '--tag', REPO_WORKER_IMAGE, context], 15 * 60_000);
      if (result.code !== 0) throw new Error(`Unable to prepare the pinned Node 22 and .NET 10 repository worker image. Start Docker Desktop and check access to the official Node and Microsoft .NET registries. ${result.errorText}`);
    },
    evidenceRoot: join(userDataPath, 'evidence'),
    scratchRoot,
    artifactKey: () => getDatabaseKey(join(userDataPath, 'storage-key.enc')),
    authFactory: async () => new AzureCliAdoAuthService(),
    isClaudeAccountConnected: claudeAccountConnected,
    getClaudeAccountEmail: async () => (await claudeAccountStatus()).email,
    startClaudeLogin: async () => {
      const result = await runClaudeCommand(['auth', 'login'], 5 * 60_000);
      if (result.code !== 0) throw new Error('Claude Code sign-in did not complete. Finish sign-in in the browser, then retry.');
    },
    chooseRepository: async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'dontAddToRecent'] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    chooseModelKeyFile: async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Plain text API key', extensions: ['txt'] }] });
      return result.canceled ? undefined : result.filePaths[0];
    },
    readAdoProfilesConfig: async () => {
      const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Azure DevOps profiles', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0]) return undefined;
      const filePath = result.filePaths[0];
      if ((await stat(filePath)).size > 128 * 1024) throw new Error('The selected Azure DevOps profile config file is too large.');
      return readFile(filePath, 'utf8');
    },
    saveAdoProfilesConfig: async (contents) => {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: 'ado-profiles.json',
        filters: [{ name: 'Azure DevOps profiles', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, contents, { mode: 0o600 });
      await chmod(result.filePath, 0o600);
      return true;
    },
    saveReportFile: async (filename, contents, format) => {
      const extension = format === 'markdown' ? 'md' : format;
      const result = await dialog.showSaveDialog(window, {
        defaultPath: filename,
        filters: [{ name: `${extension.toUpperCase()} report`, extensions: [extension] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, contents, { mode: 0o600 });
      await chmod(result.filePath, 0o600);
      return true;
    },
    saveEvidenceFile: async (filename, contents, restricted) => {
      if (restricted) {
        const answer = await dialog.showMessageBox(window, {
          type: 'warning', buttons: ['Cancel', 'Save restricted evidence'], defaultId: 0, cancelId: 0,
          title: 'Export restricted evidence', message: 'This evidence may contain credentials, personal data, or private application content.',
          detail: 'The file will be decrypted and saved only to the location you choose. Keep it in an approved private location.',
        });
        if (answer.response !== 1) return false;
      }
      const extension = filename.split('.').at(-1) ?? 'bin';
      const result = await dialog.showSaveDialog(window, { defaultPath: filename, filters: [{ name: 'QA evidence', extensions: [extension] }] });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, contents, { mode: 0o600 });
      await chmod(result.filePath, 0o600);
      return true;
    },
  });
  const packagedUrl = pathToFileURL(join(app.getAppPath(), 'dist', 'index.html')).toString();
  const disposeIpc = registerIpcHandlers(ipcMain, controller, { devServerUrl, packagedAppUrl: packagedUrl });
  window.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
    if (isMainFrame) console.error(`Renderer failed to load (${code}): ${description} [${failedUrl}]`);
  });
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2 && /content security policy|failed to load|uncaught/i.test(message)) console.error(`Renderer diagnostic: ${message.slice(0, 500)}`);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const trusted = devServerUrl
      ? new URL(url).origin === new URL(devServerUrl).origin
      : url === packagedUrl;
    if (!trusted) event.preventDefault();
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [devServerUrl ? DEV_CSP : APP_CSP],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });
  window.on('closed', () => { disposeIpc(); void store.close(); });

  if (devServerUrl) await window.loadURL(devServerUrl);
  else await window.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else app.whenReady().then(() => createWindow()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'The application failed to start securely.';
  console.error(message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
