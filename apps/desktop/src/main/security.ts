function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function configuredDevOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = parseUrl(value);
  if (
    !url ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    !url.port
  ) {
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

  const devOrigin = configuredDevOrigin(devServerUrl);
  if (devOrigin) return target.origin === devOrigin.origin;

  const packaged = packagedAppUrl ? parseUrl(packagedAppUrl) : undefined;
  return Boolean(
    target.protocol === 'file:' &&
      target.host === '' &&
      packaged?.protocol === 'file:' &&
      packaged.host === '' &&
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
