import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, isAllowedNavigation } from '../src/main/security.js';

describe('desktop sender validation', () => {
  it('accepts only the packaged renderer file or the configured loopback dev origin', () => {
    expect(
      isTrustedIpcSender(
        'file:///app/dist/index.html',
        undefined,
        'file:///app/dist/index.html',
      ),
    ).toBe(true);
    expect(
      isTrustedIpcSender(
        'http://127.0.0.1:5173/',
        'http://127.0.0.1:5173/',
      ),
    ).toBe(true);
    expect(isTrustedIpcSender('https://attacker.example/', undefined)).toBe(false);
    expect(
      isTrustedIpcSender(
        'http://localhost:5173/',
        'http://127.0.0.1:5173/',
      ),
    ).toBe(false);
  });

  it('blocks navigation to other pages, schemes, or origins', () => {
    expect(isAllowedNavigation('https://attacker.example/', undefined, 'file:///app/dist/index.html')).toBe(false);
    expect(isAllowedNavigation('file:///etc/passwd', undefined, 'file:///app/dist/index.html')).toBe(false);
    expect(isAllowedNavigation('file://attacker/app/dist/index.html', undefined, 'file:///app/dist/index.html')).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', undefined, 'file:///app/dist/index.html')).toBe(false);
  });
});
