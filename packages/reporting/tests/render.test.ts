import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/render.js';

const bundle: any = {
  manifest: { runId: '22222222-2222-4222-8222-222222222222', targetKind: 'site', siteBaseUrl: 'https://test.example', sources: [] },
  contract: { id: '11111111-1111-4111-8111-111111111111', revision: 1, criteria: [{ id: 'c-1', expectedBehavior: '<script>alert(1)</script>', requiredLayers: ['browser'], scenarioIds: ['s-1'], source: { userAdded: true, author: 'QA' } }] },
  observations: [], findings: [],
  report: { verdict: 'NEEDS_REVIEW', executionState: 'COMPLETED', completedAt: '2026-09-27T12:00:00.000Z', explanation: 'No observations.' , criterionResults: [{ criterionId: 'c-1', state: 'UNVERIFIED', missingEvidence: ['No evidence'] }] },
};

describe('local report renderers', () => {
  it('escapes untrusted source content in static HTML and includes no scripts', () => {
    const html = renderReport(bundle, 'html');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain("default-src 'none'");
  });

  it('renders auditable JSON and Markdown with verdict policy explanation', () => {
    expect(renderReport(bundle, 'json')).toContain('NEEDS_REVIEW');
    expect(renderReport(bundle, 'markdown')).toContain('No observations.');
    expect(renderReport(bundle, 'markdown')).toContain('No evidence');
  });

  it('includes evidence artifact identities in exported criterion observations', () => {
    const artifactId = '33333333-3333-4333-8333-333333333333';
    const input = { ...bundle, observations: [{ id: '44444444-4444-4444-8444-444444444444', runId: bundle.manifest.runId, scenarioId: 's-1', status: 'FAILED', worker: 'browser', startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: 'Expected text was missing.', artifactIds: [artifactId], sourceIdentity: 'https://test.example' }] };
    expect(renderReport(input, 'markdown')).toContain(artifactId);
    expect(renderReport(input, 'html')).toContain(artifactId);
  });

  it('redacts browser form values from exported JSON contracts', () => {
    const input = { ...bundle, contract: { ...bundle.contract, scenarios: [{ id: 's-1', steps: [{ action: 'fill', role: 'textbox', name: 'Password', value: 'credential-canary' }] }] } };
    const json = renderReport(input, 'json');
    expect(json).not.toContain('credential-canary');
    expect(json).toContain('[REDACTED]');
  });

  it('reports provider model and token usage without exposing credentials', () => {
    const input = { ...bundle, manifest: { ...bundle.manifest, modelId: 'gpt-5.6-terra', limits: { modelInputTokensUsed: 80, modelInputTokens: 12000, modelOutputTokensUsed: 40, modelOutputTokens: 1200 } } };
    expect(renderReport(input, 'markdown')).toContain('input tokens 80/12000');
    expect(renderReport(input, 'html')).toContain('output tokens 40/1200');
    expect(renderReport(input, 'json')).not.toContain('apiKey');
  });
});
