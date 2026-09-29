import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedNavigation, isTrustedIpcSender } from '../src/security';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let packagedAppUrl = '';

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url;
  return Boolean(
    senderUrl &&
      isTrustedIpcSender(senderUrl, devServerUrl, packagedAppUrl || undefined),
  );
}

function registerIpc(): void {
  ipcMain.handle('probe:runtime-info', (event) => {
    if (!trustedSender(event)) {
      throw new Error('Untrusted renderer');
    }
    return {
      shell: 'Electron',
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    };
  });
}

function applyCsp(window: BrowserWindow): void {
  const developmentSources = devServerUrl
    ? "'self' http://127.0.0.1:* ws://127.0.0.1:*"
    : "'self'";
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self' ${developmentSources}; style-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-src 'none'`,
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  packagedAppUrl = pathToFileURL(indexPath).href;

  const window = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 540,
    minHeight: 540,
    backgroundColor: '#0c1118',
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  applyCsp(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devServerUrl, packagedAppUrl)) {
      event.preventDefault();
    }
  });
  window.once('ready-to-show', () => window.show());

  if (devServerUrl) {
    await window.loadURL(devServerUrl);
  } else {
    await window.loadFile(indexPath);
  }
}

void app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
