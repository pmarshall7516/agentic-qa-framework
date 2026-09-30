import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { Finding, Observation, QAReport, RunManifest } from '@agentic-qa/domain/run';
import { DelegationDiagramSchema, type DelegationDiagram, type DelegationPlan } from '@agentic-qa/domain/agent';

export interface ReportBundle {
  manifest: RunManifest;
  contract: QAContract;
  observations: Observation[];
  findings: Finding[];
  report: QAReport;
  delegationPlan?: DelegationPlan;
  delegationDiagram?: DelegationDiagram;
  agentSummary?: string;
  agentUsage?: { inputTokens: number; outputTokens: number; providerCalls: number; costUsd: number };
}

export type ReportFormat = 'html' | 'markdown' | 'json';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function escapeMarkdown(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+!|])/g, '\\$1').replace(/\r?\n/g, ' ');
}

function sourceLabel(contract: QAContract, criterionId: string): string {
  const criterion = contract.criteria.find(({ id }) => id === criterionId);
  if (!criterion) return criterionId;
  const source = criterion.source;
  if ('workItemId' in source) return `ADO ${source.organization}/${source.projectId}/#${source.workItemId} rev ${source.revision} (${source.field})`;
  if ('agentProposed' in source) return `Agent-proposed (${source.decision.toLowerCase()}) from ${source.sourceRefs.map(({ workItemId, revision }) => `#${workItemId} rev ${revision}`).join(', ')}`;
  return `User added by ${source.author}`;
}

function delegationFlows(diagram: DelegationDiagram): string[] {
  const validated = DelegationDiagramSchema.parse(diagram);
  const labels = new Map(validated.nodes.map(({ id, label }) => [id, label]));
  const edgesBySource = new Map<string, string[]>();
  for (const edge of validated.edges) edgesBySource.set(edge.from, [...(edgesBySource.get(edge.from) ?? []), edge.to]);
  const flows: string[] = [];
  const visit = (id: string, path: string[], visited: Set<string>) => {
    if (id === 'summary') { flows.push(path.map((nodeId) => labels.get(nodeId) ?? nodeId).join(' → ')); return; }
    for (const next of edgesBySource.get(id) ?? []) if (!visited.has(next) && flows.length < 32) visit(next, [...path, next], new Set([...visited, next]));
  };
  visit('orchestrator', ['orchestrator'], new Set(['orchestrator']));
  return flows;
}

export function renderMarkdown(bundle: ReportBundle): string {
  const { manifest, contract, report } = bundle;
  const limits = manifest.limits ?? {};
  const inputUsed = bundle.agentUsage?.inputTokens ?? limits.modelInputTokensUsed ?? 'not reported';
  const outputUsed = bundle.agentUsage?.outputTokens ?? limits.modelOutputTokensUsed ?? 'not reported';
  const inputLimit = limits.modelInputTokens ?? 'unspecified';
  const outputLimit = limits.modelOutputTokens ?? 'unspecified';
  const criteria = contract.criteria.map((criterion) => {
    const result = report.criterionResults.find(({ criterionId }) => criterionId === criterion.id);
    const observations = bundle.observations.filter(({ scenarioId }) => criterion.scenarioIds.includes(scenarioId));
    const evidence = observations.length ? observations.map((item) => `  - ${item.worker}: ${item.status} — ${escapeMarkdown(item.assertion)}${item.diagnostic ? `\n    - Diagnostic: ${escapeMarkdown(item.diagnostic.stage)} / ${escapeMarkdown(item.diagnostic.category)} — ${escapeMarkdown(item.diagnostic.detail)}\n    - Next action: ${escapeMarkdown(item.diagnostic.nextAction)}\n    - Retryable: ${item.diagnostic.retryable ? 'yes' : 'no'}` : ''}${item.artifactIds.length ? ` (artifact IDs: ${item.artifactIds.map(escapeMarkdown).join(', ')})` : ''}`).join('\n') : '  - No observations were recorded.';
    return `### ${escapeMarkdown(criterion.id)} · ${result?.state ?? 'UNVERIFIED'}\n\n- Expected: ${escapeMarkdown(criterion.expectedBehavior)}\n- Source: ${escapeMarkdown(sourceLabel(contract, criterion.id))}\n- Required layers: ${criterion.requiredLayers.join(', ') || 'none'}\n- Missing evidence: ${result?.missingEvidence.map(escapeMarkdown).join('; ') || 'none'}\n\nEvidence:\n${evidence}`;
  }).join('\n\n');
  const findingRows = bundle.findings.length ? bundle.findings.map((finding) => `- **${finding.kind}**${finding.criterionId ? ` for ${escapeMarkdown(finding.criterionId)}` : ''}: ${escapeMarkdown(finding.rationale)}${finding.humanOverride ? ` (reviewed by ${escapeMarkdown(finding.humanOverride.author)}; reclassified from ${escapeMarkdown(finding.humanOverride.previousKind)})` : ''}${finding.unresolved ? ' (unresolved)' : ''}`).join('\n') : 'No findings recorded.';
  const delegationRows = bundle.delegationPlan?.assignments.map((assignment) => `- **${escapeMarkdown(assignment.label)}** · ${assignment.layer} · ${assignment.status} · results: ${escapeMarkdown(assignment.resultTypes.join(', '))} · evidence refs: ${assignment.evidenceIds.length}`).join('\n');
  const flows = bundle.delegationDiagram ? delegationFlows(bundle.delegationDiagram) : [];
  return [
    '# Agentic QA report',
    '',
    `**Verdict:** ${report.verdict}  `,
    `**Execution:** ${report.executionState}  `,
    `**Run:** ${manifest.runId}  `,
    `**Completed:** ${report.completedAt}`,
    '',
    `**Target:** ${manifest.targetKind}${manifest.siteBaseUrl ? ` · ${escapeMarkdown(manifest.siteBaseUrl)}` : ''}  `,
    `**Contract:** ${contract.id} revision ${contract.revision}  `,
    `**Model:** ${manifest.modelId ?? 'none'}${manifest.modelId ? ` · input tokens ${inputUsed}/${inputLimit} · output tokens ${outputUsed}/${outputLimit}` : ''}  `,
    `**Sources:** ${manifest.sources.map((source) => `${escapeMarkdown(source.organization)}/${escapeMarkdown(source.projectId)}/#${source.workItemId} rev ${source.revision}`).join(', ') || 'none'}`,
    '',
    `## Why this verdict\n\n${escapeMarkdown(report.explanation)}`,
    '',
    `## Criterion coverage\n\n${criteria || 'No criteria were recorded. A report with no criteria cannot pass.'}`,
    ...(delegationRows ? [`## Agent delegation\n\n${escapeMarkdown(bundle.delegationPlan!.summary)}\n\n${flows.length ? `Flow:\n${flows.map((flow) => `- ${escapeMarkdown(flow)}`).join('\n')}\n\n` : ''}${delegationRows}${bundle.agentUsage ? `\n\nProvider calls: ${bundle.agentUsage.providerCalls}; tokens: ${bundle.agentUsage.inputTokens} input / ${bundle.agentUsage.outputTokens} output; estimated cost: $${bundle.agentUsage.costUsd.toFixed(4)}.` : ''}${bundle.agentSummary ? `\n\n### Results summary\n\n${escapeMarkdown(bundle.agentSummary)}` : ''}`] : []),
    '',
    `## Findings\n\n${findingRows}`,
    '',
    'Generated locally by Agentic QA. This report is a decision aid and does not claim exhaustive coverage.',
  ].join('\n');
}

export function renderHtml(bundle: ReportBundle): string {
  const { manifest, contract, report } = bundle;
  const limits = manifest.limits ?? {};
  const criteria = contract.criteria.map((criterion) => {
    const result = report.criterionResults.find(({ criterionId }) => criterionId === criterion.id);
    const observations = bundle.observations.filter(({ scenarioId }) => criterion.scenarioIds.includes(scenarioId));
    const evidence = observations.length
      ? `<ul>${observations.map((item) => `<li>${escapeHtml(item.worker)} · ${escapeHtml(item.status)} — ${escapeHtml(item.assertion)}${item.diagnostic ? `<p><strong>${escapeHtml(item.diagnostic.stage)} / ${escapeHtml(item.diagnostic.category)}:</strong> ${escapeHtml(item.diagnostic.detail)}<br><strong>Next action:</strong> ${escapeHtml(item.diagnostic.nextAction)}<br><small>${item.diagnostic.retryable ? 'Retryable' : 'Review target/plan before retrying'}</small></p>` : ''}${item.artifactIds.length ? `<br><small>Restricted artifact IDs: ${item.artifactIds.map(escapeHtml).join(', ')}</small>` : ''}</li>`).join('')}</ul>`
      : '<p>No observations were recorded.</p>';
    return `<article><h3>${escapeHtml(criterion.id)} · ${escapeHtml(result?.state ?? 'UNVERIFIED')}</h3><p><strong>Expected:</strong> ${escapeHtml(criterion.expectedBehavior)}</p><p><strong>Source:</strong> ${escapeHtml(sourceLabel(contract, criterion.id))}</p><p><strong>Required layers:</strong> ${escapeHtml(criterion.requiredLayers.join(', ') || 'none')}</p><p><strong>Missing evidence:</strong> ${escapeHtml(result?.missingEvidence.join('; ') || 'none')}</p><h4>Evidence</h4>${evidence}</article>`;
  }).join('');
  const findings = bundle.findings.length
    ? `<ul>${bundle.findings.map((finding) => `<li><strong>${escapeHtml(finding.kind)}</strong>${finding.criterionId ? ` for ${escapeHtml(finding.criterionId)}` : ''}: ${escapeHtml(finding.rationale)}${finding.humanOverride ? ` (reviewed by ${escapeHtml(finding.humanOverride.author)}; reclassified from ${escapeHtml(finding.humanOverride.previousKind)})` : ''}${finding.unresolved ? ' (unresolved)' : ''}</li>`).join('')}</ul>`
    : '<p>No findings recorded.</p>';
  const sourceList = manifest.sources.map((source) => `${source.organization}/${source.projectId}/#${source.workItemId} rev ${source.revision}`).join(', ') || 'none';
  const inputUsed = bundle.agentUsage?.inputTokens ?? limits.modelInputTokensUsed ?? 'not reported';
  const outputUsed = bundle.agentUsage?.outputTokens ?? limits.modelOutputTokensUsed ?? 'not reported';
  const modelUsage = manifest.modelId ? `<p><strong>Model:</strong> ${escapeHtml(manifest.modelId)} · input tokens ${escapeHtml(String(inputUsed))}/${escapeHtml(String(limits.modelInputTokens ?? 'unspecified'))} · output tokens ${escapeHtml(String(outputUsed))}/${escapeHtml(String(limits.modelOutputTokens ?? 'unspecified'))}</p>` : '<p><strong>Model:</strong> none</p>';
  const flows = bundle.delegationDiagram ? delegationFlows(bundle.delegationDiagram) : [];
  const delegation = bundle.delegationPlan ? `<h2>Agent delegation</h2><p>${escapeHtml(bundle.delegationPlan.summary)}</p><ul>${bundle.delegationPlan.assignments.map((assignment) => `<li><strong>${escapeHtml(assignment.label)}</strong> · ${escapeHtml(assignment.layer)} · ${escapeHtml(assignment.status)} · ${escapeHtml(assignment.resultTypes.join(', '))} · ${assignment.evidenceIds.length} evidence references</li>`).join('')}</ul>${bundle.agentUsage ? `<p>Provider calls: ${bundle.agentUsage.providerCalls}; tokens: ${bundle.agentUsage.inputTokens} input / ${bundle.agentUsage.outputTokens} output; estimated cost: $${bundle.agentUsage.costUsd.toFixed(4)}.</p>` : ''}${bundle.agentSummary ? `<h3>Results summary</h3><pre>${escapeHtml(bundle.agentSummary)}</pre>` : ''}` : '';
  const diagramFlowHtml = flows.length ? `<h3>Delegation flow</h3><ul>${flows.map((flow) => `<li>${escapeHtml(flow)}</li>`).join('')}</ul>` : '';
  const body = `<h1>Agentic QA report</h1><p><strong>Verdict:</strong> ${escapeHtml(report.verdict)} · <strong>Execution:</strong> ${escapeHtml(report.executionState)}</p><p><strong>Run:</strong> ${escapeHtml(manifest.runId)}</p><p><strong>Completed:</strong> ${escapeHtml(report.completedAt)}</p><p><strong>Target:</strong> ${escapeHtml(manifest.targetKind)}${manifest.siteBaseUrl ? ` · ${escapeHtml(manifest.siteBaseUrl)}` : ''}</p>${modelUsage}<p><strong>Sources:</strong> ${escapeHtml(sourceList)}</p><h2>Why this verdict</h2><p>${escapeHtml(report.explanation)}</p><h2>Criterion coverage</h2>${criteria || '<p>No criteria were recorded. A report with no criteria cannot pass.</p>'}${delegation}${diagramFlowHtml}<h2>Findings</h2>${findings}<footer>Generated locally by Agentic QA. This report is a decision aid and does not claim exhaustive coverage.</footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Agentic QA report</title><style>body{font:15px/1.6 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#202b38}h1,h2,h3{font-family:system-ui,sans-serif;color:#172331}h1{font-size:30px}h2{border-bottom:1px solid #e4e9ef;padding-bottom:7px;margin-top:32px}p{margin:7px 0}.list{padding-left:18px;color:#526171}code{font-family:ui-monospace,monospace}</style></head><body>${body}</body></html>`;
}

export function renderReport(bundle: ReportBundle, format: ReportFormat): string {
  if (format === 'json') {
    const exportBundle = {
      ...bundle,
      ...(Array.isArray((bundle as ReportBundle & { repositoryTests?: unknown }).repositoryTests)
        ? { repositoryTests: (bundle as ReportBundle & { repositoryTests: Array<{ commandId?: string; path: string; content?: string; scenarioIds?: string[]; testCaseIds?: string[] }> }).repositoryTests.map(({ content: _content, ...metadata }) => metadata) }
        : {}),
      contract: {
        ...bundle.contract,
        scenarios: (bundle.contract.scenarios ?? []).map((scenario) => ({
          ...scenario,
          steps: (scenario.steps ?? []).map((step) => step.action === 'fill' ? { ...step, value: '[REDACTED]' } : step),
        })),
      },
    };
    return `${JSON.stringify(exportBundle, null, 2)}\n`;
  }
  if (format === 'markdown') return `${renderMarkdown(bundle)}\n`;
  return renderHtml(bundle);
}
