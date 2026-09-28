import { useEffect, useMemo, useState } from 'react';
import type { AdoGitRef, AdoGitRepository, AdoProject } from '@agentic-qa/ado/client';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { Scenario } from '@agentic-qa/domain/qa-contract';
import type { AppScreen, DesktopApi, DesktopState, DraftPlan, ModelPayloadPreview, TargetConfig } from '../shared/ipc.js';

const navigation: Array<{ id: AppScreen; label: string; number: string }> = [
  { id: 'connections', label: 'Connections', number: '01' },
  { id: 'project', label: 'Project', number: '02' },
  { id: 'work-items', label: 'Work items', number: '03' },
  { id: 'queue', label: 'QA Queue', number: '04' },
  { id: 'run-setup', label: 'Run setup', number: '05' },
  { id: 'plan', label: 'Plan review', number: '06' },
  { id: 'history', label: 'History', number: '07' },
];
const BUILT_IN_WORK_ITEM_TYPES = new Set(['user story', 'product backlog item', 'issue', 'requirement', 'task']);

const EMPTY_STATE: DesktopState = {
  clientIdConfigured: false,
  accounts: [],
  queue: [],
  modelProviderConfigured: false,
  modelId: 'gpt-5.6-terra',
  modelMaxOutputTokens: 1200,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested operation could not be completed.';
}

function projectLabel(project?: AdoProject): string {
  return project?.name ?? 'Choose a project';
}

function blankStep(action: string): Scenario['steps'][number] {
  switch (action) {
    case 'goto': return { action, path: '/' };
    case 'click': return { action, role: 'button', name: '' };
    case 'fill': return { action, role: 'textbox', name: '', value: '' };
    case 'press': return { action, role: 'textbox', name: '', key: 'Enter' };
    case 'expectVisible': return { action, role: 'heading', name: '' };
    default: return { action: 'expectText', text: '' };
  }
}

function ScenarioStepEditor({ scenarioId, index, step, onChange, onRemove }: {
  scenarioId: string; index: number; step: Scenario['steps'][number];
  onChange: (step: Scenario['steps'][number]) => void; onRemove: () => void;
}) {
  const label = `Step ${index + 1}`;
  return <div className="scenario-step">
    <div className="scenario-step-top"><strong>{label}</strong><button className="text-button remove-button" type="button" onClick={onRemove}>Remove</button></div>
    <label className="field-label" htmlFor={`${scenarioId}-${index}-action`}>Action</label>
    <select id={`${scenarioId}-${index}-action`} className="text-input" value={step.action} onChange={(event) => onChange(blankStep(event.target.value))}>
      <option value="goto">Navigate to path</option><option value="click">Click control</option><option value="fill">Fill text field</option><option value="press">Press key</option><option value="expectVisible">Expect control visible</option><option value="expectText">Expect text visible</option>
    </select>
    {step.action === 'goto' ? <><label className="field-label">Path on the approved site<input className="text-input" value={step.path} maxLength={1000} onChange={(event) => onChange({ ...step, path: event.target.value.startsWith('/') ? event.target.value : `/${event.target.value}` })} /></label></> : null}
    {step.action === 'click' || step.action === 'fill' || step.action === 'press' || step.action === 'expectVisible' ? <div className="filters-row"><label>Accessible role<select aria-label={`${label} accessible role`} value={step.role} onChange={(event) => onChange({ ...step, role: event.target.value } as Scenario['steps'][number])}>{(step.action === 'click' ? ['button', 'link', 'tab', 'checkbox'] : step.action === 'expectVisible' ? ['button', 'link', 'heading', 'textbox', 'status', 'alert'] : ['textbox', 'searchbox']).map((role) => <option key={role} value={role}>{role}</option>)}</select></label>{step.action !== 'expectVisible' && step.action !== 'click' ? <label>Field name<input className="text-input" value={step.name} maxLength={200} onChange={(event) => onChange({ ...step, name: event.target.value } as Scenario['steps'][number])} /></label> : <label>Control name<input className="text-input" value={step.name} maxLength={200} onChange={(event) => onChange({ ...step, name: event.target.value } as Scenario['steps'][number])} /></label>}</div> : null}
    {step.action === 'fill' ? <label className="field-label">Non-secret value<input className="text-input" value={step.value} maxLength={2000} onChange={(event) => onChange({ ...step, value: event.target.value })} /><small>Do not enter passwords, API keys, or real account secrets. This release does not manage test credentials.</small></label> : null}
    {step.action === 'press' ? <label className="field-label">Key<select className="text-input" value={step.key} onChange={(event) => onChange({ ...step, key: event.target.value as 'Enter' | 'Escape' | 'Tab' })}><option>Enter</option><option>Escape</option><option>Tab</option></select></label> : null}
    {step.action === 'expectText' ? <label className="field-label">Expected visible text<textarea className="contract-textarea" value={step.text} maxLength={1000} onChange={(event) => onChange({ ...step, text: event.target.value })} /></label> : null}
  </div>;
}

function WorkItemCard({
  item,
  queued,
  onAdd,
  onChildren,
  childrenExpanded,
}: {
  item: WorkItemSnapshot;
  queued: boolean;
  onAdd: (id: number) => void;
  onChildren?: (id: number) => void;
  childrenExpanded?: boolean;
}) {
  return (
    <article className="work-card">
      <div className="work-type-icon" aria-hidden="true">
        {item.kind === 'REQUIREMENT' ? 'R' : item.kind === 'TASK' ? 'T' : 'W'}
      </div>
      <div className="work-copy">
        <div className="work-meta">
          <span>{item.type || 'Type not set'}</span>
          <span>#{item.id}</span>
          {item.parentId ? <span>Parent #{item.parentId}</span> : null}
        </div>
        <h3>{item.title || 'Title not set'}</h3>
        <p>{item.state || 'State not set'} · Revision {item.revision}</p>
        {item.acceptanceCriteria ? (
          <p className="criteria-excerpt">{item.acceptanceCriteria.slice(0, 180)}</p>
        ) : (
          <p className="criteria-missing">No acceptance criteria field was returned.</p>
        )}
      </div>
      {item.kind === 'REQUIREMENT' && onChildren ? <button className="text-button child-toggle" type="button" onClick={() => onChildren(item.id)}>{childrenExpanded ? 'Hide tasks' : 'Browse child tasks'}</button> : null}
      <button
        className={queued ? 'button quiet' : 'button outline'}
        type="button"
        disabled={queued}
        onClick={() => onAdd(item.id)}
      >
        {queued ? 'Queued' : 'Add to queue'}
      </button>
    </article>
  );
}

export function App({
  api,
  initialState,
}: {
  api: DesktopApi;
  initialState?: DesktopState;
}) {
  const [state, setState] = useState<DesktopState>(initialState ?? EMPTY_STATE);
  const [screen, setScreen] = useState<AppScreen>('connections');
  const [organization, setOrganization] = useState(initialState?.selectedOrganization ?? '');
  const [clientId, setClientId] = useState(initialState?.clientId ?? '');
  const [projects, setProjects] = useState<AdoProject[]>([]);
  const [workItemTypes, setWorkItemTypes] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [results, setResults] = useState<WorkItemSnapshot[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchAfterId, setSearchAfterId] = useState<number>();
  const [activeSearch, setActiveSearch] = useState<import('../shared/ipc.js').SearchItemsInput>();
  const [childrenByParent, setChildrenByParent] = useState<Record<number, WorkItemSnapshot[]>>({});
  const [expandedParents, setExpandedParents] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [targetKind, setTargetKind] = useState<TargetConfig['targetKind']>(initialState?.target?.targetKind ?? 'site');
  const [siteBaseUrl, setSiteBaseUrl] = useState(initialState?.target?.siteBaseUrl ?? '');
  const [repositoryPath, setRepositoryPath] = useState(initialState?.target?.repositoryPath ?? '');
  const [repositorySource, setRepositorySource] = useState<TargetConfig['repositorySource']>(initialState?.target?.repositorySource ?? (initialState?.target?.adoRepository ? 'ado-git' : 'local'));
  const [gitRepositories, setGitRepositories] = useState<AdoGitRepository[]>([]);
  const [gitRefs, setGitRefs] = useState<AdoGitRef[]>([]);
  const [selectedGitRepository, setSelectedGitRepository] = useState<AdoGitRepository | undefined>(initialState?.target?.adoRepository ? { id: initialState.target.adoRepository.id, name: initialState.target.adoRepository.name } : undefined);
  const [selectedGitRef, setSelectedGitRef] = useState<AdoGitRef | undefined>(initialState?.target?.adoRepository ? { name: initialState.target.adoRepository.refName, objectId: initialState.target.adoRepository.commit } : undefined);
  const [draftPlan, setDraftPlan] = useState<DraftPlan>();
  const [modelPreview, setModelPreview] = useState<ModelPayloadPreview>();
  const [modelId, setModelId] = useState(initialState?.modelId ?? 'gpt-5.6-terra');
  const [modelMaxOutputTokens, setModelMaxOutputTokens] = useState(initialState?.modelMaxOutputTokens ?? 1200);
  const [modelIncludedCriteria, setModelIncludedCriteria] = useState<string[]>([]);
  const [runs, setRuns] = useState<Array<{ manifest: DraftPlan['manifest']; report?: import('@agentic-qa/domain/run').QAReport }>>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRun, setSelectedRun] = useState<NonNullable<Awaited<ReturnType<DesktopApi['getRun']>>>>();
  const [activeRunId, setActiveRunId] = useState('');
  const [browserInstalled, setBrowserInstalled] = useState(false);
  const [repoWorkerInstalled, setRepoWorkerInstalled] = useState(false);
  const [reviewFindingId, setReviewFindingId] = useState('');
  const [reviewKind, setReviewKind] = useState<'PRODUCT_FAILURE' | 'TEST_FAILURE' | 'ENVIRONMENT_FAILURE' | 'FLAKY_TEST' | 'AMBIGUOUS_REQUIREMENT'>('PRODUCT_FAILURE');
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [reviewReason, setReviewReason] = useState('');

  const queuedIds = useMemo(
    () => new Set(state.queue.map(({ entry }) => `${entry.organization}:${entry.projectId}:${entry.workItemId}`)),
    [state.queue],
  );

  useEffect(() => {
    if (initialState) return;
    void api.getState().then((next) => {
      setState(next);
      setClientId(next.clientId ?? '');
      setOrganization(next.selectedOrganization ?? '');
      setTargetKind(next.target?.targetKind ?? 'site');
      setSiteBaseUrl(next.target?.siteBaseUrl ?? '');
      setRepositoryPath(next.target?.repositoryPath ?? '');
      setRepositorySource(next.target?.repositorySource ?? (next.target?.adoRepository ? 'ado-git' : 'local'));
      setSelectedGitRepository(next.target?.adoRepository ? { id: next.target.adoRepository.id, name: next.target.adoRepository.name } : undefined);
      setSelectedGitRef(next.target?.adoRepository ? { name: next.target.adoRepository.refName, objectId: next.target.adoRepository.commit } : undefined);
      setModelId(next.modelId ?? 'gpt-5.6-terra');
      setModelMaxOutputTokens(next.modelMaxOutputTokens ?? 1200);
    }).catch((cause) => setError(errorMessage(cause)));
  }, [api, initialState]);

  useEffect(() => {
    if (screen !== 'run-setup') return;
    void api.isBrowserInstalled().then(setBrowserInstalled).catch(() => setBrowserInstalled(false));
    void api.isRepoWorkerImageInstalled().then(setRepoWorkerInstalled).catch(() => setRepoWorkerInstalled(false));
  }, [api, screen]);

  async function installBrowser() {
    await run(async () => {
      await api.installBrowser();
      setBrowserInstalled(await api.isBrowserInstalled());
      setNotice('Chromium is installed locally and ready for site checks.');
    });
  }

  async function installRepoWorker() {
    await run(async () => {
      await api.installRepoWorkerImage();
      setRepoWorkerInstalled(await api.isRepoWorkerImageInstalled());
      setNotice('The local repository worker image is ready.');
    });
  }

  async function run<T>(operation: () => Promise<T>, success?: (value: T) => void) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await operation();
      success?.(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function updateState(next: DesktopState) {
    setState(next);
    setClientId(next.clientId ?? '');
    setOrganization(next.selectedOrganization ?? '');
    if (next.target) {
      setTargetKind(next.target.targetKind);
      setSiteBaseUrl(next.target.siteBaseUrl ?? '');
      setRepositoryPath(next.target.repositoryPath ?? '');
      setRepositorySource(next.target.repositorySource ?? (next.target.adoRepository ? 'ado-git' : 'local'));
      setSelectedGitRepository(next.target.adoRepository ? { id: next.target.adoRepository.id, name: next.target.adoRepository.name } : undefined);
      setSelectedGitRef(next.target.adoRepository ? { name: next.target.adoRepository.refName, objectId: next.target.adoRepository.commit } : undefined);
    }
    setModelId(next.modelId ?? 'gpt-5.6-terra');
    setModelMaxOutputTokens(next.modelMaxOutputTokens ?? 1200);
  }

  async function saveClientId() {
    await run(() => api.saveClientId(clientId.trim()), (next) => {
      updateState(next);
      setNotice('Application ID saved on this device.');
    });
  }

  async function connectOrganization() {
    await run(async () => {
      const next = await api.selectOrganization(organization.trim());
      updateState(next);
      const found = await api.listProjects();
      setProjects(found);
      setScreen('project');
    });
  }

  async function selectProject(project: AdoProject) {
    await run(async () => {
      const next = await api.selectProject(project);
      updateState(next);
      const types = await api.listWorkItemTypes();
      setWorkItemTypes(types);
      setScreen('work-items');
    });
  }

  async function search() {
    if (!searchTerm.trim()) {
      setError('Enter a work item ID or title phrase to search.');
      return;
    }
    if (!state.selectedProject) {
      setError('Choose an Azure DevOps project before searching.');
      return;
    }
    await run(async () => {
      const input = {
        term: searchTerm,
        types: typeFilter ? [typeFilter] : [],
        states: stateFilter ? [stateFilter] : [],
      };
      const items = await api.searchItems(input);
      setResults(items.items);
      setActiveSearch(input);
      setSearchAfterId(items.nextAfterId);
      setSearchHasMore(items.nextAfterId !== undefined);
    });
  }

  async function loadMoreSearchResults() {
    if (!activeSearch || searchAfterId === undefined) return;
    await run(async () => {
      const page = await api.searchItems({ ...activeSearch, afterId: searchAfterId });
      setResults((current) => {
        const seen = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !seen.has(id))];
      });
      setSearchAfterId(page.nextAfterId);
      setSearchHasMore(page.nextAfterId !== undefined);
    });
  }

  async function mutateQueue(operation: () => Promise<DesktopState>) {
    await run(operation, updateState);
  }

  async function saveRunTarget() {
    await run(async () => {
      const needsSite = targetKind !== 'repository';
      const parsedUrl = needsSite && siteBaseUrl ? new URL(siteBaseUrl) : undefined;
      const target: TargetConfig = {
        targetKind,
        ...(targetKind !== 'site' && repositorySource === 'local' && repositoryPath ? { repositorySource, repositoryPath } : {}),
        ...(targetKind !== 'site' && repositorySource === 'ado-git' && selectedGitRepository && selectedGitRef && state.selectedProject && state.selectedOrganization ? { repositorySource, adoRepository: { organization: state.selectedOrganization, projectId: state.selectedProject.id, id: selectedGitRepository.id, name: selectedGitRepository.name, refName: selectedGitRef.name, commit: selectedGitRef.objectId } } : {}),
        ...(needsSite && siteBaseUrl ? { siteBaseUrl } : {}),
        allowedOrigins: parsedUrl ? [parsedUrl.origin] : [],
      };
      const next = await api.saveTarget(target);
      updateState(next);
      const plan = await api.createDraftPlan();
      setDraftPlan(plan);
      setModelIncludedCriteria(plan.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map(({ id }) => id));
      setScreen('plan');
    });
  }

  async function chooseRepository() {
    await run(async () => {
      const selected = await api.chooseRepository();
      if (selected) setRepositoryPath(selected);
    });
  }

  async function loadGitRepositories() {
    await run(() => api.listGitRepositories(), setGitRepositories);
  }

  async function selectGitRepository(repository: AdoGitRepository) {
    setSelectedGitRepository(repository);
    setSelectedGitRef(undefined);
    await run(() => api.listGitRefs(repository.id), setGitRefs);
  }

  function updateCriterion(criterionId: string, expectedBehavior: string) {
    if (!draftPlan) return;
    setModelPreview(undefined);
    setDraftPlan({ ...draftPlan, contract: {
      ...draftPlan.contract,
      criteria: draftPlan.contract.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, expectedBehavior } : criterion),
    } });
  }

  function toggleLayer(criterionId: string, layer: 'repo' | 'browser') {
    if (!draftPlan) return;
    setModelPreview(undefined);
    const criterion = draftPlan.contract.criteria.find(({ id }) => id === criterionId);
    if (!criterion) return;
    const remove = criterion.requiredLayers.includes(layer);
    const scenarioId = `${criterionId}-${layer}`;
    const criteria = draftPlan.contract.criteria.map((item) => item.id !== criterionId ? item : {
      ...item,
      requiredLayers: remove ? item.requiredLayers.filter((required) => required !== layer) : [...item.requiredLayers, layer],
      scenarioIds: remove ? item.scenarioIds.filter((id) => id !== scenarioId) : [...item.scenarioIds, scenarioId],
    });
    const scenarios = remove
      ? draftPlan.contract.scenarios.filter(({ id }) => id !== scenarioId)
      : [...draftPlan.contract.scenarios, {
          id: scenarioId, criterionIds: [criterionId], layer, preconditions: [],
          steps: layer === 'browser' ? [{ action: 'expectText' as const, text: criterion.expectedBehavior }] : [],
          expectedObservations: [criterion.expectedBehavior], risk: 'medium' as const, approved: false,
        }];
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, criteria, scenarios } });
  }

  function updateScenarioStep(scenarioId: string, index: number, step: Scenario['steps'][number]) {
    if (!draftPlan) return;
    setModelPreview(undefined);
    setDraftPlan({ ...draftPlan, contract: {
      ...draftPlan.contract,
      scenarios: draftPlan.contract.scenarios.map((scenario) => scenario.id !== scenarioId ? scenario : {
        ...scenario,
        steps: scenario.steps.map((candidate, candidateIndex) => candidateIndex === index ? step : candidate),
      }),
    } });
  }

  function addScenarioStep(scenarioId: string) {
    if (!draftPlan) return;
    setModelPreview(undefined);
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => scenario.id === scenarioId && scenario.steps.length < 100 ? { ...scenario, steps: [...scenario.steps, blankStep('expectText')] } : scenario) } });
  }

  function removeScenarioStep(scenarioId: string, index: number) {
    if (!draftPlan) return;
    setModelPreview(undefined);
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => scenario.id === scenarioId ? { ...scenario, steps: scenario.steps.filter((_, candidateIndex) => candidateIndex !== index) } : scenario) } });
  }

  async function approvePlan() {
    if (!draftPlan) return;
    await run(async () => {
      const approved = { ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
      await api.approvePlan(approved);
      setDraftPlan(undefined);
      const nextRuns = await api.listRuns();
      setRuns(nextRuns);
      setNotice('Approved plan saved as an immutable run manifest.');
      setScreen('history');
    });
  }

  async function importModelKey() {
    await run(async () => {
      const imported = await api.importModelKey();
      if (imported) updateState(await api.getState());
      setNotice(imported ? 'OpenAI key imported into encrypted local storage. The key was not returned to the renderer.' : 'Key import cancelled.');
    });
  }

  async function saveModelSettings() {
    await run(async () => {
      await api.saveModelSettings({ model: modelId.trim(), maxOutputTokens: modelMaxOutputTokens });
      updateState(await api.getState());
      setNotice('Provider model and output-token limit saved locally.');
    });
  }

  async function previewModelRequest() {
    if (!draftPlan) return;
    await run(async () => {
      setModelPreview(await api.previewModelRequest(draftPlan.manifest.runId, modelIncludedCriteria));
      setNotice('Review the exact payload below. No provider request has been sent.');
    });
  }

  async function sendApprovedModelRequest() {
    if (!draftPlan || !modelPreview) return;
    await run(async () => {
      const suggested = await api.generateModelSuggestions(modelPreview.previewId);
      const added = suggested.contract.scenarios.filter(({ id }) => id.startsWith('ai-'));
      setDraftPlan((current) => {
        if (!current) return suggested;
        const byCriterion = new Map(added.flatMap((scenario) => scenario.criterionIds.map((criterionId) => [criterionId, scenario.id] as const)));
        return {
          ...current,
          manifest: suggested.manifest,
          notes: [...current.notes, ...suggested.notes.filter((note) => !current.notes.includes(note))],
          contract: {
            ...current.contract,
            criteria: current.contract.criteria.map((criterion) => ({ ...criterion, scenarioIds: [...criterion.scenarioIds, ...(byCriterion.has(criterion.id) ? [byCriterion.get(criterion.id)!] : [])] })),
            scenarios: [...current.contract.scenarios, ...added],
          },
        };
      });
      setModelPreview(undefined);
      updateState(await api.getState());
      setNotice(`${added.length} untrusted scenario suggestion${added.length === 1 ? '' : 's'} added for review. The model did not execute checks or set a verdict.`);
    });
  }

  async function refreshPlan() {
    await run(async () => {
      const plan = await api.createDraftPlan();
      setDraftPlan(plan);
      setModelIncludedCriteria(plan.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map(({ id }) => id));
      setModelPreview(undefined);
    });
  }

  async function createRerunPlan(runId: string) {
    await run(async () => {
      const plan = await api.createDraftPlan(runId);
      setDraftPlan(plan);
      setModelIncludedCriteria(plan.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map(({ id }) => id));
      setModelPreview(undefined);
      setSelectedRunId('');
      setSelectedRun(undefined);
      setScreen('plan');
      setNotice(`New draft created from run ${runId}. Review the refreshed sources and approve the new manifest.`);
    });
  }

  async function openHistory() {
    await run(() => api.listRuns(), setRuns);
  }

  async function openRun(runId: string) {
    await run(() => api.getRun(runId), (detail) => {
      setSelectedRunId(runId);
      setSelectedRun(detail);
      setReviewFindingId(detail?.findings.find((finding) => !finding.humanOverride)?.id ?? '');
      setNotice(detail?.report ? `${detail.report.executionState} · ${detail.report.verdict} · ${detail.report.explanation}` : 'This manifest is saved. Execution has not started yet.');
    });
  }

  async function exportSelectedRun(format: 'html' | 'markdown' | 'json') {
    if (!selectedRun) return;
    await run(() => api.exportReport(selectedRun.manifest.runId, format), (saved) => {
      if (saved) setNotice(`${format.toUpperCase()} report saved to the selected location.`);
    });
  }

  async function exportEvidence(artifactId: string) {
    if (!selectedRun) return;
    await run(() => api.exportArtifact(selectedRun.manifest.runId, artifactId), (saved) => {
      if (saved) setNotice('Restricted evidence was saved to the location you selected.');
    });
  }

  async function classifySelectedFinding() {
    if (!selectedRun || !reviewFindingId) return;
    await run(async () => {
      const reviewedReport = await api.classifyFinding({ runId: selectedRun.manifest.runId, findingId: reviewFindingId, kind: reviewKind, author: reviewAuthor, reason: reviewReason });
      const detail = await api.getRun(selectedRun.manifest.runId);
      setSelectedRun(detail);
      setRuns(await api.listRuns());
      setReviewFindingId(detail?.findings.find((finding) => !finding.humanOverride)?.id ?? '');
      setReviewReason('');
      setNotice(`Reviewer classification saved. Current verdict: ${reviewedReport.verdict}.`);
    });
  }

  async function deleteSelectedRun() {
    if (!selectedRun) return;
    await run(async () => {
      const deleted = await api.deleteRun(selectedRun.manifest.runId);
      if (!deleted) return;
      setSelectedRun(undefined); setSelectedRunId(''); setRuns(await api.listRuns());
      setNotice('Run and its local evidence were deleted.');
    });
  }

  async function startSelectedRun() {
    if (!selectedRun || selectedRun.report) return;
    const runId = selectedRun.manifest.runId;
    setActiveRunId(runId);
    await run(() => api.startRun(runId), (report) => {
      setSelectedRun((current) => current ? { ...current, report } : current);
      void api.listRuns().then(setRuns);
      setNotice(`${report.executionState} · ${report.verdict} · ${report.explanation}`);
    });
    setActiveRunId('');
  }

  async function cancelSelectedRun() {
    if (!activeRunId) return;
    try {
      await api.cancelRun(activeRunId);
      setNotice('Cancellation requested. The worker will stop and save a partial report.');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function toggleChildren(parentId: number) {
    if (expandedParents.has(parentId)) {
      setExpandedParents((current) => { const next = new Set(current); next.delete(parentId); return next; });
      return;
    }
    const cached = childrenByParent[parentId];
    if (cached) {
      setExpandedParents((current) => new Set(current).add(parentId));
      return;
    }
    await run(() => api.getChildren(parentId), (children) => {
      setChildrenByParent((current) => ({ ...current, [parentId]: children }));
      setExpandedParents((current) => new Set(current).add(parentId));
    });
  }

  const screenTitle = navigation.find(({ id }) => id === screen)?.label ?? 'Connections';

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-symbol" aria-hidden="true">AQ</div>
          <div className="brand-name"><strong>Agentic QA</strong><span>LOCAL QA WORKSPACE</span></div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${screen === item.id ? 'selected' : ''}`}
              aria-current={screen === item.id ? 'page' : undefined}
              onClick={() => { setScreen(item.id); if (item.id === 'history') void openHistory(); }}
            >
              <span className="nav-number">{item.number}</span>
              <span>{item.label}</span>
              {item.id === 'queue' && state.queue.length > 0 ? (
                <span className="nav-count">{state.queue.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-mark"><span>●</span> Stored on this device</div>
          <div className="version-mark">Version 1.0 · Local</div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{screenTitle}</strong></div>
          <div className="context-pills">
            <span className="context-pill"><i className={state.accounts.length ? 'connected' : ''} />
              {state.accounts[0]?.username ?? 'Azure DevOps not connected'}
            </span>
            {state.selectedProject ? <span className="context-pill project-pill">{state.selectedProject.name}</span> : null}
          </div>
        </header>

        <main className="content-area">
          {error ? <div className="message error-message" role="alert">{error}</div> : null}
          {notice ? <div className="message success-message" role="status">{notice}</div> : null}

          {screen === 'connections' ? (
            <section className="page-section">
              <div className="page-heading">
                <div><p className="eyebrow">STEP 01 · ACCOUNT</p><h1>Connect your work</h1></div>
                <span className="step-count">01 <i>/</i> 04</span>
              </div>
              <p className="page-description">Sign in with your Entra account to read Azure DevOps work items. Your app ID and queue stay on this computer.</p>
              <div className="panel connection-panel">
                <div className="panel-illustration" aria-hidden="true"><span>↗</span><div>ADO</div></div>
                <div className="panel-body">
                  <div className="panel-title-row"><div><h2>Azure DevOps Services</h2><p>Delegated, read-only access</p></div><span className="security-tag">READ ONLY</span></div>
                  {!state.clientIdConfigured ? (
                    <>
                      <label className="field-label" htmlFor="client-id">Entra application client ID</label>
                      <input id="client-id" className="text-input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
                      <p className="field-help">Use a public client registration with Azure DevOps delegated read permissions. No client secret is used.</p>
                      <details className="registration-help">
                        <summary>Set up the Entra public client</summary>
                        <ol>
                          <li>Register an app for accounts in any organizational directory.</li>
                          <li>Under Authentication, add the Mobile and desktop platform with redirect URI <code>http://localhost</code>.</li>
                          <li>Under API permissions, add Azure DevOps delegated read scopes: <code>vso.profile</code>, <code>vso.project</code>, and <code>vso.work</code>. Add <code>vso.code</code> only if you plan to use an ADO Git repository target.</li>
                          <li>Do not add a client secret, application permissions, <code>user_impersonation</code>, or write/manage scopes. Tenant policy may require an administrator to approve delegated consent.</li>
                        </ol>
                      </details>
                      <div className="button-row">
                        <button className="button primary" type="button" disabled={busy || !clientId.trim()} onClick={() => void saveClientId()}>{busy ? 'Saving…' : 'Save application ID'}</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="saved-client-id"><span className="check-mark">✓</span><div><strong>Public client configured</strong><span>{state.clientId}</span></div><button className="text-button" type="button" onClick={() => setState({ ...state, clientIdConfigured: false })}>Edit</button></div>
                      {state.accounts.length ? (
                        <div className="account-list">{state.accounts.map((account) => <div className="account-row" key={account.homeAccountId}><span className="account-avatar">{(account.displayName ?? account.username).slice(0, 1).toUpperCase()}</span><div><strong>{account.displayName ?? account.username}</strong><span>{account.username}</span></div><button className="button quiet" type="button" disabled={busy} onClick={() => void run(() => api.signOut(account.homeAccountId), updateState)}>Sign out</button></div>)}</div>
                      ) : <button className="button primary microsoft-button" type="button" disabled={busy} onClick={() => void run(() => api.signIn(), updateState)}><span className="ms-grid" aria-hidden="true"><i /><i /><i /><i /></span>{busy ? 'Opening Microsoft sign-in…' : 'Sign in with Microsoft'}</button>}
                      <p className="field-help">The system browser handles sign-in. Personal Microsoft accounts are not supported for this first release.</p>
                    </>
                  )}
                  <div className="permission-note"><span>🔒</span><p>Tokens stay in the encrypted system cache. The renderer and repository worker never receive them.</p></div>
                </div>
              </div>
            </section>
          ) : null}

          {screen === 'project' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 02 · SCOPE</p><h1>Choose your project</h1></div><span className="step-count">02 <i>/</i> 04</span></div>
              <p className="page-description">Connect to an organization where your signed-in account has access. You can enter its validated Azure DevOps URL.</p>
              <div className="panel selection-panel">
                <label className="field-label" htmlFor="organization">Organization</label>
                <div className="inline-form"><input id="organization" className="text-input" value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="contoso or https://dev.azure.com/contoso" /><button type="button" className="button primary" disabled={busy || !organization.trim() || state.accounts.length === 0} onClick={() => void connectOrganization()}>{busy ? 'Loading…' : 'Find projects'}</button></div>
                {!state.accounts.length ? <p className="field-help">Connect an Azure DevOps account first.</p> : null}
                <div className="project-list">
                  <div className="list-heading"><div><span className="eyebrow">ACCESSIBLE PROJECTS</span><h2>{projects.length ? `${projects.length} projects` : 'No project selected'}</h2></div></div>
                  {projects.map((project) => <button type="button" className={`project-card ${state.selectedProject?.id === project.id ? 'active' : ''}`} key={project.id} onClick={() => void selectProject(project)}><span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span><span className="project-name"><strong>{project.name}</strong><small>{project.state ?? 'Azure DevOps project'}</small></span><span className="project-arrow">→</span></button>)}
                  {!projects.length ? <div className="empty-card"><span className="empty-icon">⌕</span><strong>Projects will appear here</strong><p>Enter an organization above to list projects available to this account.</p></div> : null}
                </div>
              </div>
            </section>
          ) : null}

          {screen === 'work-items' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 03 · REQUIREMENTS</p><h1>Find work to verify</h1></div><span className="step-count">03 <i>/</i> 04</span></div>
              <p className="page-description">Search work items in <strong>{projectLabel(state.selectedProject)}</strong>. Requirements and child tasks are kept distinct in the QA Queue.</p>
              <div className="search-panel">
                <label className="field-label" htmlFor="work-search">Work item ID or title</label>
                <div className="search-line"><div className="search-input-wrap"><span aria-hidden="true">⌕</span><input id="work-search" className="search-input" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setSearchHasMore(false); }} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="e.g. 4821 or remember filters" /></div><button className="button primary" type="button" disabled={busy || !state.selectedProject} onClick={() => void search()}>{busy ? 'Searching…' : 'Search work items'}</button></div>
                <div className="filters-row"><label>Type <select aria-label="Filter by work item type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setSearchHasMore(false); }}><option value="">All types</option>{workItemTypes.map((type) => <option key={type}>{type}</option>)}</select></label><label>State <select aria-label="Filter by state" value={stateFilter} onChange={(event) => { setStateFilter(event.target.value); setSearchHasMore(false); }}><option value="">All states</option>{['New', 'Active', 'Resolved', 'Closed', 'To Do', 'Doing', 'Done'].map((value) => <option key={value}>{value}</option>)}</select></label></div>
                {workItemTypes.some((type) => !BUILT_IN_WORK_ITEM_TYPES.has(type.toLocaleLowerCase('en-US'))) ? <div className="custom-type-mappings"><strong>Map custom work item types</strong><p className="field-help">Choose how this project’s custom types should participate in QA. Mapping changes refresh queued source snapshots.</p>{workItemTypes.filter((type) => !BUILT_IN_WORK_ITEM_TYPES.has(type.toLocaleLowerCase('en-US'))).map((type) => <label className="filters-row" key={type}>{type}<select aria-label={`Map ${type}`} value={state.customTypeMappings?.[type] ?? 'OTHER'} disabled={busy} onChange={(event) => void mutateQueue(() => api.saveWorkItemTypeMapping(type, event.target.value as 'REQUIREMENT' | 'TASK' | 'OTHER'))}><option value="OTHER">Context only</option><option value="REQUIREMENT">Requirement</option><option value="TASK">Task</option></select></label>)}</div> : null}
              </div>
              <div className="results-heading"><h2>Search results</h2><span>{results.length ? `${results.length} items` : ''}</span></div>
              <div className="results-list">{results.map((item) => <div className="result-group" key={`${item.organization}:${item.projectId}:${item.id}`}><WorkItemCard item={item} queued={queuedIds.has(`${item.organization.toLowerCase()}:${item.projectId}:${item.id}`)} onAdd={(id) => void mutateQueue(() => api.addQueueItem(id))} onChildren={(id) => void toggleChildren(id)} childrenExpanded={expandedParents.has(item.id)} />{expandedParents.has(item.id) ? <div className="child-items">{childrenByParent[item.id]?.length ? childrenByParent[item.id]!.map((child) => <WorkItemCard key={child.id} item={child} queued={queuedIds.has(`${child.organization.toLowerCase()}:${child.projectId}:${child.id}`)} onAdd={(id) => void mutateQueue(() => api.addQueueItem(id))} />) : <div className="child-empty">No child tasks were returned for this requirement.</div>}</div> : null}</div>)}{!results.length ? <div className="empty-card"><span className="empty-icon">⌕</span><strong>Search this project</strong><p>Results include current source revisions. Add requirements or tasks to your local QA Queue.</p></div> : null}</div>
              {searchHasMore ? <div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void loadMoreSearchResults()}>{busy ? 'Loading…' : 'Load more work items'}</button></div> : null}
            </section>
          ) : null}

          {screen === 'queue' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 04 · READY TO REVIEW</p><h1>Your QA Queue</h1></div><span className="step-count">{state.queue.length} <i>items</i></span></div>
              <p className="page-description">Selected work stays on this device. Queue order changes presentation only; it does not affect verdict priority.</p>
              <div className="queue-toolbar"><div><strong>{state.queue.length} selected</strong><span>Grouped by Azure DevOps project</span></div><button className="button outline" type="button" disabled={busy || !state.queue.length} onClick={() => void mutateQueue(() => api.refreshQueue())}>{busy ? 'Refreshing…' : 'Refresh source revisions'}</button></div>
              <div className="queue-list">{state.queue.map(({ entry, snapshot }, index) => <article className="queue-card" key={entry.key}><span className="queue-index">{String(index + 1).padStart(2, '0')}</span><div className="queue-copy"><div className="work-meta"><span>{snapshot?.type ?? 'Work item'}</span><span>#{entry.workItemId}</span><span>{snapshot?.projectName ?? entry.projectId}</span></div><h3>{snapshot?.title ?? 'Work item details unavailable'}</h3><p>{entry.organization} · {snapshot?.state ?? 'Unknown state'} · Revision {snapshot?.revision ?? '—'}</p>{entry.stale ? <span className="stale-badge">Source changed or inaccessible · refresh before run</span> : null}</div><div className="queue-actions"><button aria-label={`Move item ${entry.workItemId} up`} className="icon-button" disabled={busy || index === 0} onClick={() => void mutateQueue(() => api.moveQueueItem(entry.key, 'up'))}>↑</button><button aria-label={`Move item ${entry.workItemId} down`} className="icon-button" disabled={busy || index === state.queue.length - 1} onClick={() => void mutateQueue(() => api.moveQueueItem(entry.key, 'down'))}>↓</button><button className="text-button remove-button" type="button" disabled={busy} onClick={() => void mutateQueue(() => api.removeQueueItem(entry.key))}>Remove</button></div></article>)}{!state.queue.length ? <div className="empty-card"><span className="empty-icon">＋</span><strong>Your queue is ready for requirements</strong><p>Search a project and add work items. A task can inform QA scope, but it does not prove its parent’s acceptance criteria.</p><button className="button outline" type="button" onClick={() => setScreen('work-items')}>Find work items</button></div> : null}</div>
            </section>
          ) : null}

          {screen === 'run-setup' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 05 · TARGET</p><h1>Set up a QA run</h1></div><span className="step-count">05 <i>/</i> 07</span></div>
              <p className="page-description">Choose which target this contract must cover. Repository checks use a disposable snapshot; site checks stay within the approved origin.</p>
              <div className="panel selection-panel run-setup-panel">
                <label className="field-label" htmlFor="target-kind">Target layers</label>
                <select id="target-kind" className="text-input target-select" value={targetKind} onChange={(event) => setTargetKind(event.target.value as TargetConfig['targetKind'])}>
                  <option value="site">Site only</option><option value="repository">Repository only</option><option value="both">Repository and site</option>
                </select>
                {targetKind !== 'site' ? <div className="target-block"><label className="field-label" htmlFor="repository-source">Repository source</label><select id="repository-source" className="text-input" value={repositorySource} onChange={(event) => setRepositorySource(event.target.value as 'local' | 'ado-git')}><option value="local">Local folder</option><option value="ado-git">Azure DevOps Git</option></select>{repositorySource === 'local' ? <><div className="inline-form"><input id="repo-path" className="text-input" value={repositoryPath} readOnly placeholder="Choose a repository folder" /><button className="button outline" type="button" disabled={busy} onClick={() => void chooseRepository()}>Choose folder…</button></div><p className="field-help">The selected source will be copied into a temporary snapshot before repository commands run.</p></> : <><div className="button-row"><button className="button outline" type="button" disabled={busy || !state.selectedProject} onClick={() => void loadGitRepositories()}>Load project repositories</button></div><label className="field-label" htmlFor="ado-git-repository">Repository</label><select id="ado-git-repository" className="text-input" value={selectedGitRepository?.id ?? ''} onChange={(event) => { const repository = gitRepositories.find(({ id }) => id === event.target.value); if (repository) void selectGitRepository(repository); }}><option value="">Choose repository</option>{gitRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select><label className="field-label" htmlFor="ado-git-ref">Ref and commit</label><select id="ado-git-ref" className="text-input" value={selectedGitRef?.name ?? ''} onChange={(event) => setSelectedGitRef(gitRefs.find(({ name }) => name === event.target.value))}><option value="">Choose branch or tag</option>{gitRefs.map((ref) => <option key={`${ref.name}:${ref.objectId}`} value={ref.name}>{ref.name} · {ref.objectId.slice(0, 12)}</option>)}</select><p className="field-help">The chosen ref is resolved to its commit SHA. Only configured, non-secret files from that frozen commit are staged locally; the worker receives no ADO token.</p></>}</div> : null}
                {targetKind !== 'repository' ? <div className="target-block"><label className="field-label" htmlFor="site-url">Development or staging URL</label><input id="site-url" className="text-input" value={siteBaseUrl} onChange={(event) => setSiteBaseUrl(event.target.value)} placeholder="https://staging.example.test" /><p className="field-help">Only the origin in this URL will be approved for the browser worker. Production URLs are not recommended.</p></div> : null}
                {targetKind !== 'repository' ? <div className="target-block"><div className="queue-toolbar"><div><strong>Local Chromium browser</strong><span>{browserInstalled ? 'Installed and ready' : 'Required for site checks; downloads to this device (about 300 MB).'}</span></div><button className="button outline" type="button" disabled={busy || browserInstalled} onClick={() => void installBrowser()}>{busy ? 'Installing…' : browserInstalled ? 'Installed' : 'Install browser'}</button></div></div> : null}
                {targetKind !== 'site' ? <div className="target-block"><div className="queue-toolbar"><div><strong>Docker repository worker</strong><span>{repoWorkerInstalled ? 'Worker image installed' : 'Docker Desktop required; prepares the local Node 22 worker image.'}</span></div><button className="button outline" type="button" disabled={busy || repoWorkerInstalled} onClick={() => void installRepoWorker()}>{busy ? 'Preparing…' : repoWorkerInstalled ? 'Installed' : 'Prepare worker'}</button></div></div> : null}
                <div className="target-block model-settings">
                  <div className="panel-title-row"><div><h2>Optional AI scenario suggestions</h2><p>{state.modelProviderConfigured ? 'OpenAI is configured. Planning stays local unless you preview and approve a specific request.' : 'No provider is configured. Local deterministic planning works without an API key.'}</p></div></div>
                  <div className="filters-row"><label>OpenAI model<input className="text-input" value={modelId} maxLength={80} onChange={(event) => setModelId(event.target.value)} placeholder="gpt-5.6-terra" /></label><label>Max output tokens<input className="text-input" type="number" min={256} max={4096} step={128} value={modelMaxOutputTokens} onChange={(event) => setModelMaxOutputTokens(Number(event.target.value))} /></label></div>
                  <div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void saveModelSettings()}>Save provider settings</button>{state.modelProviderConfigured ? <button className="button outline" type="button" disabled={busy} onClick={() => void run(async () => { await api.clearModelKey(); updateState(await api.getState()); setNotice('OpenAI key removed from encrypted local storage.'); })}>Remove API key</button> : <button className="button outline" type="button" disabled={busy} onClick={() => void importModelKey()}>Import API key file…</button>}</div>
                  <small>Choose a private plain-text file containing one API key. The main process imports it into the encrypted local database; the key is never returned to renderer state or sent to workers. Delete the source file after import. ADO text is sent only after a separate preview approval. No repository files, tasks, secrets, tool calls or verdicts are sent. OpenAI data-handling and retention terms apply.</small>
                </div>
                <div className="button-row"><button className="button primary" type="button" disabled={busy || !state.queue.length || (targetKind !== 'repository' && !siteBaseUrl.trim()) || (targetKind !== 'site' && (repositorySource === 'local' ? !repositoryPath : !selectedGitRepository || !selectedGitRef))} onClick={() => void saveRunTarget()}>{busy ? 'Preparing…' : 'Review local plan'}</button></div>
              </div>
            </section>
          ) : null}

          {screen === 'plan' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 06 · CONTRACT</p><h1>Review the QA plan</h1></div><span className="step-count">{draftPlan?.contract.criteria.length ?? 0} criteria</span></div>
              <p className="page-description">The source revision and acceptance-criteria field are frozen in this draft. Edit expected behavior and required evidence before saving the contract.</p>
              {draftPlan?.notes.map((note) => <div className="message review-message" key={note}>{note}</div>)}
              {draftPlan?.repositoryCommands?.length ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Repository commands</h2><p>Exact argument arrays run inside the isolated worker, with networking disabled.</p></div><button className="button outline" type="button" disabled={busy} onClick={() => void refreshPlan()}>Refresh after config edits</button></div>{draftPlan.repositoryCommands.map((command) => <div className="command-preview-row" key={command.id}><strong>{command.label} · {command.timeoutSeconds}s</strong><code>{command.executable} {command.arguments.map((argument) => JSON.stringify(argument)).join(' ')}</code><small>Directory: {command.workingDirectory} · Results: {command.resultFormat ?? 'none'}{command.scenarioMappings.length ? ` · Scenarios: ${command.scenarioMappings.map(({ scenarioId, testCaseIds }) => `${scenarioId} ← ${testCaseIds.join(', ')}`).join('; ')}` : ' · diagnostic only'}</small></div>)}</div> : null}
              <div className="disclosure-card"><div className="disclosure-icon">✓</div><div><strong>{state.modelProviderConfigured ? 'Provider is optional and approval-gated' : 'Disclosure preview: no transmission'}</strong><p>{state.modelProviderConfigured ? 'The local draft makes no provider request. To request optional browser-scenario suggestions, review the exact acceptance-criteria payload first and approve it in the next step. Repository files and task descriptions are never included.' : 'Source: local encrypted ADO queue snapshots. Files included: none. Provider key is not configured. No model request is sent.'}</p></div></div>
              {state.modelProviderConfigured ? <div className="target-block"><strong>Choose criteria to disclose</strong><p className="field-help">Only checked browser acceptance criteria are sent. Work-item descriptions, tasks, files and artifacts stay local.</p><div className="model-criteria-list">{draftPlan?.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map((criterion) => <label key={criterion.id}><input type="checkbox" disabled={Boolean(modelPreview)} checked={modelIncludedCriteria.includes(criterion.id)} onChange={(event) => { setModelPreview(undefined); setModelIncludedCriteria((current) => event.target.checked ? [...current, criterion.id] : current.filter((id) => id !== criterion.id)); }} />{criterion.expectedBehavior}</label>)}</div><div className="button-row"><button className="button outline" type="button" disabled={busy || !modelIncludedCriteria.length} onClick={() => void previewModelRequest()}>Preview AI request</button></div></div> : null}
              {modelPreview ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Exact provider payload · no request sent yet</h2><p>OpenAI · {modelPreview.model} · estimated input ≤ {modelPreview.estimatedInputTokens.toLocaleString()} tokens · maximum output {modelPreview.maxOutputTokens.toLocaleString()} tokens. Review acceptance-criteria text and prompt before approving.</p></div><button className="text-button" type="button" onClick={() => setModelPreview(undefined)}>Discard preview</button></div><textarea className="contract-textarea payload-preview" aria-label="Exact provider payload" readOnly value={JSON.stringify(modelPreview.requestBody, null, 2)} /><div className="button-row"><button className="button primary" type="button" disabled={busy} onClick={() => void sendApprovedModelRequest()}>Approve this payload and send to OpenAI</button></div></div> : null}
              <div className="criteria-list">{draftPlan?.contract.criteria.map((criterion) => <article className="criterion-card" key={criterion.id}>
                <div className="criterion-source"><span>ADO #{criterion.source && 'workItemId' in criterion.source ? criterion.source.workItemId : 'Local'}</span><span>revision {criterion.source && 'revision' in criterion.source ? criterion.source.revision : '—'}</span><span>{criterion.source && 'field' in criterion.source ? criterion.source.field : 'User-added'}</span></div>
                <label className="field-label" htmlFor={`criterion-${criterion.id}`}>Expected behavior</label>
                <textarea id={`criterion-${criterion.id}`} className="contract-textarea" value={criterion.expectedBehavior} onChange={(event) => updateCriterion(criterion.id, event.target.value)} />
                <div className="required-layers"><span className="field-label">Required evidence layers</span>{(['repo', 'browser'] as const).map((layer) => <label key={layer}><input type="checkbox" checked={criterion.requiredLayers.includes(layer)} disabled={criterion.requiredLayers.length === 1 && criterion.requiredLayers.includes(layer)} onChange={() => toggleLayer(criterion.id, layer)} />{layer === 'repo' ? 'Repository' : 'Browser'}</label>)}</div>
                {criterion.scenarioIds.map((scenarioId) => {
                  const scenario = draftPlan.contract.scenarios.find(({ id }) => id === scenarioId);
                  if (!scenario) return null;
                  return <div className="scenario-editor" key={scenario.id}><div className="scenario-heading"><strong>{scenario.summary ?? (scenario.layer === 'browser' ? 'Browser scenario' : 'Repository evidence')}{scenario.id.startsWith('ai-') ? ' · AI suggestion' : ''}</strong><span>{scenario.layer}</span></div><p className="field-help">Expected observations: {scenario.expectedObservations.join(' · ')}</p>{scenario.layer === 'browser' ? <><p className="field-help">Actions use accessible roles and exact control names. Approval permits only the configured site origin. Do not use real credentials. AI suggestions are untrusted; inspect every step and expected observation.</p>{scenario.steps.map((step, index) => <ScenarioStepEditor key={`${scenario.id}-${index}`} scenarioId={scenario.id} index={index} step={step} onChange={(next) => updateScenarioStep(scenario.id, index, next)} onRemove={() => removeScenarioStep(scenario.id, index)} />)}<button className="button outline" type="button" disabled={scenario.steps.length >= 100} onClick={() => addScenarioStep(scenario.id)}>Add browser action</button></> : <><p className="field-help">Map this Scenario ID to a JUnit command in <code>.agentic-qa.yml</code>. A command exit code by itself cannot verify a criterion.</p><code className="scenario-id">{scenario.id}</code></>}</div>;
                })}
              </article>)}{draftPlan && !draftPlan.contract.criteria.length ? <div className="empty-card"><strong>No source acceptance criteria were found</strong><p>This plan cannot be approved as a passing run. Add or clarify a Requirement with acceptance criteria first.</p></div> : null}</div>
              <div className="queue-toolbar"><div><strong>Run manifest preview</strong><span>{draftPlan?.manifest.targetKind} · {draftPlan?.manifest.sources.length} source snapshots · {draftPlan?.manifest.siteBaseUrl ?? 'No site URL'}{draftPlan?.manifest.repositorySource?.kind === 'ado-git' ? ` · ${draftPlan.manifest.repositorySource.refName} @ ${draftPlan.manifest.sourceCommit?.slice(0, 12)}` : draftPlan?.manifest.repositorySource?.kind === 'local' ? ` · local tree ${draftPlan.manifest.localGitState ?? 'state unavailable'}` : ''}</span></div><button className="button primary" type="button" disabled={busy || !draftPlan?.contract.criteria.length || draftPlan?.contract.criteria.some((criterion) => !criterion.expectedBehavior.trim())} onClick={() => void approvePlan()}>{busy ? 'Saving…' : 'Approve contract and save run'}</button></div>
            </section>
          ) : null}

          {screen === 'history' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">STEP 07 · LOCAL RECORDS</p><h1>Run history</h1></div><button className="button outline" type="button" disabled={busy} onClick={() => void openHistory()}>Refresh</button></div>
              <p className="page-description">Approved run manifests and source evidence remain immutable. Reviewer decisions are appended and shown as the current verdict.</p>
              <div className="queue-list">{runs.map(({ manifest, report }) => <button type="button" className="history-row" key={manifest.runId} onClick={() => void openRun(manifest.runId)}><span className="queue-index">{manifest.startedAt.slice(0, 10)}</span><span className="project-name"><strong>{manifest.targetKind} · {manifest.sources.length} source snapshots</strong><small>Run {manifest.runId}</small></span><span className="verdict-badge">{report ? `${report.executionState} · ${report.verdict}` : selectedRunId === manifest.runId ? 'Manifest saved' : 'Not started'}</span></button>)}{!runs.length ? <div className="empty-card"><span className="empty-icon">◷</span><strong>No saved runs yet</strong><p>Approve a reviewed local plan to create the first immutable manifest.</p><button className="button outline" type="button" onClick={() => setScreen('run-setup')}>Set up a run</button></div> : null}</div>
              {selectedRun ? <div className="panel report-preview">
                {(() => { const report = selectedRun.reviewedReport ?? selectedRun.report; return <>
                <div className="panel-title-row"><div><h2>{report ? 'Local report preview' : 'Approved run manifest'}</h2><p>{report ? `${report.executionState} · ${report.verdict}${selectedRun.reviewedReport ? ' · reviewed' : ''}` : 'Ready to execute'}</p></div></div>
                {report ? <>
                  <p className="report-explanation">{report.explanation}</p>
                  <div className="report-criteria">{selectedRun.contract.criteria.map((criterion) => {
                    const result = report.criterionResults.find(({ criterionId }) => criterionId === criterion.id);
                    const linkedScenarioIds = new Set(criterion.scenarioIds);
                    const observations = selectedRun.observations.filter(({ scenarioId }) => linkedScenarioIds.has(scenarioId));
                    return <div className="report-criterion" key={criterion.id}>
                      <strong>{result?.state ?? 'UNVERIFIED'} · {criterion.expectedBehavior}</strong>
                      <span>Required: {criterion.requiredLayers.join(', ')} · Missing: {result?.missingEvidence.join(', ') || 'none'}</span>
                      <div className="report-evidence-list"><span className="field-label">Direct observations</span>
                        {observations.length ? observations.map((observation) => <div className="report-evidence-item" key={observation.id}>
                          <strong>{observation.worker} · {observation.status}</strong><span>{observation.assertion}</span>
                          {observation.artifactIds.map((artifactId) => {
                            const artifact = selectedRun.artifacts.find(({ id }) => id === artifactId);
                            return artifact ? <button className="text-button" type="button" key={artifactId} disabled={busy} onClick={() => void exportEvidence(artifactId)}>Save restricted {artifact.kind} evidence ({Math.ceil(artifact.bytes / 1024)} KB)</button> : null;
                          })}
                        </div>) : <span>No direct observations were recorded.</span>}
                      </div>
                    </div>;
                  })}</div>
                  <div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void createRerunPlan(selectedRun.manifest.runId)}>Create rerun plan</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('html')}>Export HTML</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('markdown')}>Export Markdown</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('json')}>Export JSON</button><button className="button outline" type="button" disabled={busy} onClick={() => void deleteSelectedRun()}>Delete run…</button></div>
                  {selectedRun.findings.some((finding) => !finding.humanOverride) ? <div className="review-panel"><h3>Reviewer classification</h3><p className="field-help">Reviewer decisions are appended; original observations and the first report remain preserved.</p><label className="field-label" htmlFor="review-finding">Finding</label><select id="review-finding" className="text-input" value={reviewFindingId} onChange={(event) => setReviewFindingId(event.target.value)}>{selectedRun.findings.filter((finding) => !finding.humanOverride).map((finding) => <option key={finding.id} value={finding.id}>{finding.kind} · {finding.rationale.slice(0, 100)}</option>)}</select><div className="filters-row"><label>Classification<select aria-label="Reviewer classification" value={reviewKind} onChange={(event) => setReviewKind(event.target.value as typeof reviewKind)}><option value="PRODUCT_FAILURE">Product failure</option><option value="TEST_FAILURE">Test failure</option><option value="ENVIRONMENT_FAILURE">Environment failure</option><option value="FLAKY_TEST">Flaky test</option><option value="AMBIGUOUS_REQUIREMENT">Ambiguous requirement</option></select></label><label>Reviewer<input className="text-input" value={reviewAuthor} maxLength={200} onChange={(event) => setReviewAuthor(event.target.value)} /></label></div><label className="field-label" htmlFor="review-reason">Reason</label><textarea id="review-reason" className="contract-textarea" value={reviewReason} maxLength={4000} onChange={(event) => setReviewReason(event.target.value)} /><div className="button-row"><button className="button primary" type="button" disabled={busy || !reviewFindingId || !reviewAuthor.trim() || !reviewReason.trim()} onClick={() => void classifySelectedFinding()}>Save reviewer classification</button></div></div> : null}
                  {selectedRun.findings.filter((finding) => finding.humanOverride).map((finding) => <div className="review-message" key={finding.id}>Reviewed by {finding.humanOverride!.author}: {finding.kind} — {finding.humanOverride!.reason}</div>)}
                </> : <>
                  <p className="field-help">The manifest and reviewed contract are immutable. Start the run to execute its approved checks and collect evidence.</p>
                  <div className="button-row"><button className="button primary" type="button" disabled={busy || Boolean(activeRunId)} onClick={() => void startSelectedRun()}>{activeRunId ? 'Run in progress…' : 'Start approved run'}</button>{activeRunId ? <button className="button outline" type="button" onClick={() => void cancelSelectedRun()}>Cancel run</button> : null}</div>
                </>}
                </>; })()}
              </div> : null}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
