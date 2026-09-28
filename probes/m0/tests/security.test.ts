import { describe, expect, it } from 'vitest';
import {
  isAllowedNavigation,
  isTrustedIpcSender,
  getElectronSecurityPolicy,
  validateProbeResult,
} from '../src/security';

describe('Electron security policy', () => {
  it('keeps renderer privileges disabled and navigation local', () => {
    expect(getElectronSecurityPolicy()).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowedNavigationProtocols: ['file:'],
    });
  });
});

describe('Electron navigation and IPC origin checks', () => {
  it('allows only the packaged app URL or the configured loopback dev URL', () => {
    expect(
      isAllowedNavigation('file:///app/index.html', undefined, 'file:///app/index.html'),
    ).toBe(true);
    expect(
      isAllowedNavigation('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'),
    ).toBe(true);
    expect(
      isAllowedNavigation('https://attacker.example/', 'http://127.0.0.1:5173/'),
    ).toBe(false);
  });

  it('rejects IPC from remote, malformed, and unconfigured development senders', () => {
    expect(
      isTrustedIpcSender('file:///app/index.html', undefined, 'file:///app/index.html'),
    ).toBe(true);
    expect(isTrustedIpcSender('https://attacker.example/', undefined)).toBe(false);
    expect(
      isTrustedIpcSender('http://localhost:5173/', 'http://127.0.0.1:5173/'),
    ).toBe(false);
  });
});

describe('probe evidence validation', () => {
  it('refuses a PASS result without a concrete evidence path', () => {
    expect(() =>
      validateProbeResult({
        status: 'PASS',
        platform: 'darwin-arm64',
        evidencePath: '',
        reason: 'built',
      }),
    ).toThrow('PASS results require an evidence path');
  });

  it('rejects secret-shaped fields instead of serializing them', () => {
    expect(() =>
      validateProbeResult({
        status: 'PASS',
        platform: 'darwin-arm64',
        evidencePath: 'artifacts/build.json',
        reason: 'built',
        accessToken: 'must-not-be-recorded',
      }),
    ).toThrow('Probe results may contain only approved fields');
  });
});
