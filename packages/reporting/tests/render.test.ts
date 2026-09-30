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

  it('renders blocked diagnostics with the concrete next action in HTML and Markdown', () => {
    const input = { ...bundle, observations: [{ id: '44444444-4444-4444-8444-444444444444', runId: bundle.manifest.runId, scenarioId: 's-1', status: 'FAILED', worker: 'browser', startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: 'The site displayed a sign-in page.', artifactIds: [], sourceIdentity: 'https://test.example', diagnostic: { stage: 'authentication', category: 'authentication_required', detail: 'Sign-in is required.', nextAction: 'Select a named account and retry.', retryable: true } }] };
    expect(renderReport(input, 'markdown')).toContain('Next action: Select a named account and retry.');
    expect(renderReport(input, 'html')).toContain('authentication_required');
    expect(renderReport(input, 'json')).toContain('Select a named account and retry.');
  });

  it('redacts browser form values from exported JSON contracts', () => {
    const input = { ...bundle, contract: { ...bundle.contract, scenarios: [{ id: 's-1', steps: [{ action: 'fill', role: 'textbox', name: 'Password', value: 'credential-canary' }] }] } };
    const json = renderReport(input, 'json');
    expect(json).not.toContain('credential-canary');
    expect(json).toContain('[REDACTED]');
  });

  it('does not include generated repository test source in ordinary JSON report exports', () => {
    const input = { ...bundle, repositoryTests: [{ commandId: 'repo-test', path: 'tests/generated.test.ts', content: 'const privateGeneratedTestSource = "do not export";', scenarioIds: ['s-1'], testCaseIds: ['c-1'] }] };
    const json = renderReport(input, 'json');
    expect(json).not.toContain('privateGeneratedTestSource');
    expect(json).not.toContain('do not export');
    expect(json).toContain('generated.test.ts');
  });

  it('reports provider model and token usage without exposing credentials', () => {
    const input = { ...bundle, manifest: { ...bundle.manifest, modelId: 'gpt-5.6-terra', limits: { modelInputTokensUsed: 80, modelInputTokens: 12000, modelOutputTokensUsed: 40, modelOutputTokens: 1200 } } };
    expect(renderReport(input, 'markdown')).toContain('input tokens 80/12000');
    expect(renderReport(input, 'html')).toContain('output tokens 40/1200');
    expect(renderReport(input, 'json')).not.toContain('apiKey');
  });

  it('exports the validated delegation flow and reviewer summary in HTML and Markdown', () => {
    const input = { ...bundle, delegationPlan: { summary: 'The orchestrator selected backend evidence.', assignments: [{ id: 'backend', label: 'Backend', layer: 'repo', status: 'completed', resultTypes: ['JUnit results'], evidenceIds: [] }] }, delegationDiagram: { nodes: [{ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' }, { id: 'agent:backend', kind: 'agent', label: 'Backend' }, { id: 'result:backend', kind: 'result', label: 'JUnit results' }, { id: 'agent:reviewer', kind: 'agent', label: 'Evidence Reviewer' }, { id: 'summary', kind: 'summary', label: 'Findings and proof' }], edges: [{ from: 'orchestrator', to: 'agent:backend' }, { from: 'agent:backend', to: 'result:backend' }, { from: 'result:backend', to: 'agent:reviewer' }, { from: 'agent:reviewer', to: 'summary' }] }, agentSummary: 'ac-1 · supported · observation 44444444-4444-4444-8444-444444444444' };
    expect(renderReport(input, 'markdown')).toContain('Orchestrator → Backend → JUnit results');
    expect(renderReport(input, 'html')).toContain('Evidence Reviewer');
    expect(renderReport(input, 'markdown')).toContain('observation 44444444');
  });
});
