export type ProbeStatus = 'PASS' | 'FAIL' | 'NOT RUN';

export interface ProbeResultInput {
  status: ProbeStatus;
  platform: string;
  evidencePath: string;
  reason: string;
  [field: string]: unknown;
}

const allowedResultFields = new Set([
  'status',
  'platform',
  'evidencePath',
  'reason',
]);

export function getElectronSecurityPolicy() {
  return Object.freeze({
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    allowedNavigationProtocols: Object.freeze(['file:']),
  });
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isConfiguredLoopbackDevServer(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = parseUrl(value);
  if (!url || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    return undefined;
  }
  return url;
}

export function isAllowedNavigation(
  candidate: string,
  devServerUrl: string | undefined,
  packagedAppUrl?: string,
): boolean {
  const target = parseUrl(candidate);
  if (!target) return false;

  const devServer = isConfiguredLoopbackDevServer(devServerUrl);
  if (devServer) return target.origin === devServer.origin;

  const packaged = packagedAppUrl ? parseUrl(packagedAppUrl) : undefined;
  return Boolean(
    target.protocol === 'file:' &&
      packaged?.protocol === 'file:' &&
      target.pathname === packaged.pathname,
  );
}

export function isTrustedIpcSender(
  senderUrl: string,
  devServerUrl: string | undefined,
  packagedAppUrl?: string,
): boolean {
  return isAllowedNavigation(senderUrl, devServerUrl, packagedAppUrl);
}

export function validateProbeResult(input: ProbeResultInput): ProbeResultInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Probe result must be an object');
  }

  if (Object.keys(input).some((field) => !allowedResultFields.has(field))) {
    throw new Error('Probe results may contain only approved fields');
  }

  if (!['PASS', 'FAIL', 'NOT RUN'].includes(input.status)) {
    throw new Error('Probe status must be PASS, FAIL, or NOT RUN');
  }
  if (typeof input.platform !== 'string' || input.platform.trim().length === 0) {
    throw new Error('Probe results require a platform');
  }
  if (input.status === 'PASS' && input.evidencePath.trim().length === 0) {
    throw new Error('PASS results require an evidence path');
  }
  if (input.status !== 'PASS' && input.reason.trim().length === 0) {
    throw new Error('Non-PASS results require a reason');
  }

  return Object.freeze({
    status: input.status,
    platform: input.platform.trim(),
    evidencePath: input.evidencePath.trim(),
    reason: input.reason.trim(),
  });
}
