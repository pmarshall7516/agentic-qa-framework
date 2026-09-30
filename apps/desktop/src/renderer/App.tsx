import { useEffect, useMemo, useState } from 'react';
import type { AdoGitRef, AdoGitRepository, AdoProject, AdoTeam } from '@agentic-qa/ado/client';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { ProviderModel } from '@agentic-qa/domain/agent';
import type { Scenario } from '@agentic-qa/domain/qa-contract';
import type { AppScreen, DesktopApi, DesktopState, DraftPlan, QueueItemView, TargetConfig } from '../shared/ipc.js';
import { errorMessage } from './error-message.js';
import { SprintWorkPicker } from './SprintWorkPicker.js';

const navigation: Array<{ id: AppScreen; label: string }> = [
  { id: 'work-items', label: 'Work items' },
  { id: 'queue', label: 'QA Queue' },
  { id: 'history', label: 'Runs' },
];
const BUILT_IN_WORK_ITEM_TYPES = new Set(['user story', 'product backlog item', 'issue', 'requirement', 'task']);

const EMPTY_STATE: DesktopState = {
  azureCliAvailable: false,
  accounts: [],
  queue: [],
  modelProviderConfigured: false,
  modelProvider: 'openai',
  modelId: '',
  modelMaxOutputTokens: 1200,
};

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
        {item.comments?.length ? <details className="work-comments"><summary>{item.comments.length} ADO comments</summary><ul>{item.comments.map((comment, index) => <li key={index}>{comment}</li>)}</ul></details> : null}
      </div>
      {item.kind === 'REQUIREMENT' && onChildren ? <button className="text-button child-toggle" type="button" onClick={() => onChildren(item.id)}>{childrenExpanded ? 'Hide tasks' : 'Browse child tasks'}</button> : null}
      <button
        className={queued ? 'button quiet' : 'button outline'}
        type="button"
        disabled={queued || (item.kind !== 'REQUIREMENT' && item.kind !== 'TASK')}
        onClick={() => onAdd(item.id)}
      >
        {queued ? 'Queued' : 'Add to queue'}
      </button>
    </article>
  );
}

function QueueWorkItemRow({ view, index, queueLength, busy, onMove, onRemove }: {
  view: QueueItemView;
  index: number;
  queueLength: number;
  busy: boolean;
  onMove: (key: string, direction: 'up' | 'down') => void;
  onRemove: (key: string) => void;
}) {
  const { entry, snapshot } = view;
  const task = snapshot?.kind === 'TASK';
  return <article className={`queue-card ${task ? 'queue-card-task' : 'queue-card-story'}`}>
    <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
    <div className="queue-copy"><div className="work-meta"><span>{snapshot?.type ?? 'Work item'}</span><span>#{entry.workItemId}</span><span>{snapshot?.projectName ?? entry.projectId}</span>{snapshot?.parentId ? <span>Parent #{snapshot.parentId}</span> : null}</div><h3>{snapshot?.title ?? 'Work item details unavailable'}</h3><p>{entry.organization} · {snapshot?.state ?? 'Unknown state'} · Revision {snapshot?.revision ?? '—'}</p>{entry.stale ? <span className="stale-badge">Source changed or inaccessible · refresh before run</span> : null}</div>
    <div className="queue-actions"><button aria-label={`Move item ${entry.workItemId} up`} className="icon-button" disabled={busy || index === 0} onClick={() => onMove(entry.key, 'up')}>↑</button><button aria-label={`Move item ${entry.workItemId} down`} className="icon-button" disabled={busy || index === queueLength - 1} onClick={() => onMove(entry.key, 'down')}>↓</button><button className="text-button remove-button" type="button" disabled={busy} onClick={() => onRemove(entry.key)}>Remove</button></div>
  </article>;
}

function buildQueueProjectGroups(queue: QueueItemView[]) {
  const projects = new Map<string, { key: string; label: string; items: Array<{ view: QueueItemView; index: number }> }>();
  queue.forEach((view, index) => {
    const { entry } = view;
    const key = `${entry.organization.toLocaleLowerCase('en-US')}:${entry.projectId.toLocaleLowerCase('en-US')}`;
    const project = projects.get(key) ?? { key, label: `${entry.organization} / ${view.snapshot?.projectName ?? entry.projectId}`, items: [] };
    project.items.push({ view, index });
    projects.set(key, project);
  });
  return [...projects.values()].map((project) => {
    const stories = project.items.filter(({ view }) => view.snapshot?.kind === 'REQUIREMENT').map((story) => {
      const tasks = project.items.filter(({ view }) => view.snapshot?.kind === 'TASK' && view.snapshot.parentId === story.view.entry.workItemId);
      return { story, tasks };
    });
    const nestedTaskKeys = new Set(stories.flatMap(({ tasks }) => tasks.map(({ view }) => view.entry.key)));
    const storyKeys = new Set(stories.map(({ story }) => story.view.entry.key));
    const otherItems = project.items.filter(({ view }) => !storyKeys.has(view.entry.key) && !nestedTaskKeys.has(view.entry.key));
    return { ...project, stories, otherItems };
  });
}

function PlanSummary({ draftPlan, queue, target }: { draftPlan?: DraftPlan; queue: QueueItemView[]; target?: TargetConfig }) {
  const stories = queue.filter(({ snapshot }) => snapshot?.kind === 'REQUIREMENT');
  const tasks = queue.filter(({ snapshot }) => snapshot?.kind === 'TASK');
  const projects = [...new Set(queue.map(({ entry, snapshot }) => `${entry.organization} / ${snapshot?.projectName ?? entry.projectId}`))];
  const projectSummary = projects.length > 2 ? `${projects.length} Azure DevOps projects` : projects.join(' · ') || 'No project selected';
  const storyLabel = stories.every(({ snapshot }) => ['user story', 'product backlog item'].includes(snapshot?.type.toLocaleLowerCase('en-US') ?? '')) ? 'Story' : 'Requirement';
  const storySummary = `${stories.length} ${storyLabel}${stories.length === 1 ? '' : 's'}`;
  const taskSummary = `${tasks.length} Task${tasks.length === 1 ? '' : 's'}`;
  const criterionCount = draftPlan?.contract.criteria.length ?? 0;
  const criterionSummary = `${criterionCount} acceptance ${criterionCount === 1 ? 'criterion' : 'criteria'}`;
  const checks = draftPlan?.manifest.targetKind === 'site' ? 'Browser checks'
    : draftPlan?.manifest.targetKind === 'repository' ? 'Repository checks'
      : draftPlan?.manifest.targetKind === 'both' ? 'Repository and browser checks' : 'Not selected';
  const targetName = target?.siteBaseUrl
    ?? target?.adoRepository?.name
    ?? (target?.repositoryPath ? 'Local repository' : 'Target details unavailable');

  return <section className="plan-summary" aria-labelledby="plan-summary-title">
    <h2 id="plan-summary-title">Plan summary</h2>
    <dl className="plan-summary-grid">
      <div><dt>Selected work</dt><dd>{storySummary} · {taskSummary}</dd></div>
      <div><dt>Project scope</dt><dd>{projectSummary}</dd></div>
      <div><dt>Coverage</dt><dd>{criterionSummary} · {checks}</dd></div>
      <div><dt>Target</dt><dd>{targetName}</dd></div>
    </dl>
    {tasks.length ? <p className="plan-summary-note">Tasks provide context; they do not verify their Story's acceptance criteria.</p> : null}
    {criterionCount === 0 ? <p className="plan-summary-warning" role="note">No Story acceptance criteria were found. Add or clarify acceptance criteria before approving a QA run.</p> : null}
  </section>;
}

function OrchestratorPlan({ draftPlan }: { draftPlan?: DraftPlan }) {
  if (!draftPlan) return null;
  const repository = draftPlan.contract.scenarios.filter(({ layer }) => layer === 'repo');
  const browser = draftPlan.contract.scenarios.filter(({ layer }) => layer === 'browser');
  const both = repository.length > 0 && browser.length > 0;
  return <div className="panel orchestrator-plan"><div className="panel-title-row"><div><h2>Orchestrator plan</h2><p>The agent selects a justified testing layer for each criterion. The app enforces approved scenarios, targets, commands and run limits.</p></div><span className="verdict-badge">{both ? '2 worker lanes' : '1 worker lane'}</span></div><ol>
    <li><strong>Freeze and validate sources</strong><span>ADO revisions, target origin, repository snapshot/config hash and reviewed QA Contract.</span></li>
    {repository.length ? <li><strong>Delegate to Repository worker · {repository.length} Scenario{repository.length === 1 ? '' : 's'}</strong><span>{draftPlan.repositoryCommands?.length ?? 0} reviewed command{draftPlan.repositoryCommands?.length === 1 ? '' : 's'} in the isolated container; only mapped JUnit assertions can verify a criterion.</span></li> : null}
    {browser.length ? <li><strong>Delegate to Playwright worker · {browser.length} Scenario{browser.length === 1 ? '' : 's'}</strong><span>Approved-origin browser actions only; capture an encrypted screenshot after each completed step.</span></li> : null}
    <li><strong>Assemble evidence and compute verdict</strong><span>Join observations and artifacts to their Scenario and Acceptance Criterion; unresolved gaps remain NEEDS_REVIEW.</span></li>
  </ol>{both ? <p className="field-help">Worker lanes currently run in the reviewed manifest order under one cancellation signal and time limit.</p> : null}</div>;
}

export function App({
  api,
  initialState,
}: {
  api: DesktopApi;
  initialState?: DesktopState;
}) {
  const [state, setState] = useState<DesktopState>(initialState ?? EMPTY_STATE);
  const [screen, setScreen] = useState<AppScreen>(initialState?.selectedProject ? 'work-items' : initialState?.selectedAccountId ? 'project' : 'connections');
  const [organization, setOrganization] = useState(initialState?.selectedOrganization ?? '');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [projects, setProjects] = useState<AdoProject[]>([]);
  const [workItemTypes, setWorkItemTypes] = useState<string[]>([]);
  const [adoTeams, setAdoTeams] = useState<AdoTeam[]>([]);
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
  const [repositoryConfigDraft, setRepositoryConfigDraft] = useState('');
  const [repositorySource, setRepositorySource] = useState<TargetConfig['repositorySource']>(initialState?.target?.repositorySource ?? (initialState?.target?.adoRepository ? 'ado-git' : 'local'));
  const [gitRepositories, setGitRepositories] = useState<AdoGitRepository[]>([]);
  const [gitRefs, setGitRefs] = useState<AdoGitRef[]>([]);
  const [selectedGitRepository, setSelectedGitRepository] = useState<AdoGitRepository | undefined>(initialState?.target?.adoRepository ? { id: initialState.target.adoRepository.id, name: initialState.target.adoRepository.name } : undefined);
  const [selectedGitRef, setSelectedGitRef] = useState<AdoGitRef | undefined>(initialState?.target?.adoRepository ? { name: initialState.target.adoRepository.refName, objectId: initialState.target.adoRepository.commit } : undefined);
  const [draftPlan, setDraftPlan] = useState<DraftPlan>();
  const [modelId, setModelId] = useState(initialState?.modelId ?? '');
  const [modelProvider, setModelProvider] = useState<'openai' | 'anthropic' | 'openrouter'>(initialState?.modelProvider ?? 'openai');
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [modelMaxOutputTokens, setModelMaxOutputTokens] = useState(initialState?.modelMaxOutputTokens ?? 1200);
  const [profileId, setProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileOrganization, setProfileOrganization] = useState(initialState?.selectedOrganization ?? '');
  const [profileProjectId, setProfileProjectId] = useState(initialState?.selectedProject?.id ?? '');
  const [profileProjectName, setProfileProjectName] = useState(initialState?.selectedProject?.name ?? '');
  const [profileTeam, setProfileTeam] = useState('');
  const [profileColumn, setProfileColumn] = useState('');
  const [profileStoryIds, setProfileStoryIds] = useState('');
  const [runs, setRuns] = useState<Array<{ manifest: DraftPlan['manifest']; report?: import('@agentic-qa/domain/run').QAReport }>>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedRun, setSelectedRun] = useState<NonNullable<Awaited<ReturnType<DesktopApi['getRun']>>>>();
  const [artifactPreviews, setArtifactPreviews] = useState<Record<string, string>>({});
  const [runProgress, setRunProgress] = useState<Awaited<ReturnType<DesktopApi['getRunProgress']>>>([]);
  const [activeRunId, setActiveRunId] = useState('');
  const [browserInstalled, setBrowserInstalled] = useState(false);
  const [repoWorkerInstalled, setRepoWorkerInstalled] = useState(false);
  const [reviewFindingId, setReviewFindingId] = useState('');
  const [reviewKind, setReviewKind] = useState<'PRODUCT_FAILURE' | 'TEST_FAILURE' | 'ENVIRONMENT_FAILURE' | 'FLAKY_TEST' | 'AMBIGUOUS_REQUIREMENT'>('PRODUCT_FAILURE');
  const [reviewAuthor, setReviewAuthor] = useState('');
  const [reviewReason, setReviewReason] = useState('');

  const queuedIds = useMemo(
    () => new Set(state.queue.map(({ entry }) => `${entry.organization.toLowerCase()}:${entry.projectId}:${entry.workItemId}`)),
    [state.queue],
  );
  const queueProjectGroups = useMemo(() => buildQueueProjectGroups(state.queue), [state.queue]);

  useEffect(() => {
    if (initialState) return;
    void api.getState().then(async (next) => {
      setState(next);
      setOrganization(next.selectedOrganization ?? '');
      setProfileOrganization(next.selectedOrganization ?? '');
      setProfileProjectId(next.selectedProject?.id ?? '');
      setProfileProjectName(next.selectedProject?.name ?? '');
      setScreen(next.selectedProject ? 'work-items' : next.selectedAccountId ? 'project' : 'connections');
      setTargetKind(next.target?.targetKind ?? 'site');
      setSiteBaseUrl(next.target?.siteBaseUrl ?? '');
      setRepositoryPath(next.target?.repositoryPath ?? '');
      setRepositorySource(next.target?.repositorySource ?? (next.target?.adoRepository ? 'ado-git' : 'local'));
      setSelectedGitRepository(next.target?.adoRepository ? { id: next.target.adoRepository.id, name: next.target.adoRepository.name } : undefined);
      setSelectedGitRef(next.target?.adoRepository ? { name: next.target.adoRepository.refName, objectId: next.target.adoRepository.commit } : undefined);
      setModelProvider(next.modelProvider ?? 'openai');
      setModelId(next.modelId ?? '');
      setModelMaxOutputTokens(next.modelMaxOutputTokens ?? 1200);
      if (next.selectedProject) setWorkItemTypes(await api.listWorkItemTypes());
    }).catch((cause) => setError(errorMessage(cause)));
  }, [api, initialState]);

  useEffect(() => {
    if (screen !== 'run-setup') return;
    void api.isBrowserInstalled().then(setBrowserInstalled).catch(() => setBrowserInstalled(false));
    void api.isRepoWorkerImageInstalled().then(setRepoWorkerInstalled).catch(() => setRepoWorkerInstalled(false));
  }, [api, screen]);

  useEffect(() => {
    if (screen !== 'project' || !state.selectedAccountId || organizations.length) return;
    void api.listOrganizations().then(setOrganizations).catch((cause) => setError(errorMessage(cause)));
  }, [api, organizations.length, screen, state.selectedAccountId]);

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
    setOrganization(next.selectedOrganization ?? '');
    if (!profileId) {
      setProfileOrganization(next.selectedOrganization ?? '');
      setProfileProjectId(next.selectedProject?.id ?? '');
      setProfileProjectName(next.selectedProject?.name ?? '');
    }
    if (next.target) {
      setTargetKind(next.target.targetKind);
      setSiteBaseUrl(next.target.siteBaseUrl ?? '');
      setRepositoryPath(next.target.repositoryPath ?? '');
      setRepositorySource(next.target.repositorySource ?? (next.target.adoRepository ? 'ado-git' : 'local'));
      setSelectedGitRepository(next.target.adoRepository ? { id: next.target.adoRepository.id, name: next.target.adoRepository.name } : undefined);
      setSelectedGitRef(next.target.adoRepository ? { name: next.target.adoRepository.refName, objectId: next.target.adoRepository.commit } : undefined);
    }
      setModelProvider(next.modelProvider ?? 'openai');
    setModelId(next.modelId ?? '');
    setModelMaxOutputTokens(next.modelMaxOutputTokens ?? 1200);
  }

  async function signIn() {
    if (!state.azureCliAvailable) return;
    await run(async () => {
      const next = await api.signIn();
      updateState(next);
      const found = await api.listOrganizations();
      setOrganizations(found);
      setScreen('project');
      setNotice(found.length ? `Found ${found.length} Azure DevOps organizations.` : 'Sign-in complete. Add an Azure DevOps organization to continue.');
    });
  }

  async function refreshOrganizations() {
    await run(async () => {
      const found = await api.listOrganizations();
      setOrganizations(found);
      setNotice(found.length ? `Found ${found.length} Azure DevOps organizations.` : 'No organizations were returned for this account. You can add one by name.');
    });
  }

  async function connectOrganization(name = organization) {
    await run(async () => {
      const next = await api.selectOrganization(name.trim());
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
      const target = composeTargetConfig();
      const next = await api.saveTarget(target);
      updateState(next);
      if (target.targetKind !== 'site' && repositoryConfigDraft.trim()) await api.saveRepositoryConfigDraft({ target, content: repositoryConfigDraft });
      const plan = await api.createDraftPlan();
      setDraftPlan(plan);
      setScreen('plan');
    });
  }

  function composeTargetConfig(): TargetConfig {
    const needsSite = targetKind !== 'repository';
    const parsedUrl = needsSite && siteBaseUrl ? new URL(siteBaseUrl) : undefined;
    return {
      targetKind,
      ...(targetKind !== 'site' && repositorySource === 'local' && repositoryPath ? { repositorySource, repositoryPath } : {}),
      ...(targetKind !== 'site' && repositorySource === 'ado-git' && selectedGitRepository && selectedGitRef && state.selectedProject && state.selectedOrganization ? { repositorySource, adoRepository: { organization: state.selectedOrganization, projectId: state.selectedProject.id, id: selectedGitRepository.id, name: selectedGitRepository.name, refName: selectedGitRef.name, commit: selectedGitRef.objectId } } : {}),
      ...(needsSite && siteBaseUrl ? { siteBaseUrl } : {}),
      allowedOrigins: parsedUrl ? [parsedUrl.origin] : [],
    };
  }

  async function loadRepositoryConfigDraft() {
    const target = composeTargetConfig();
    await run(async () => setRepositoryConfigDraft(await api.getRepositoryConfigDraft(target)));
  }

  async function saveRepositoryConfigOnly() {
    const target = composeTargetConfig();
    await run(async () => {
      await api.saveTarget(target);
      await api.saveRepositoryConfigDraft({ target, content: repositoryConfigDraft });
      setNotice('Repository configuration saved locally in encrypted app storage. It has not been written to the repository.');
    });
  }

  async function saveRepositoryConfigAndRefreshPlan() {
    const target = composeTargetConfig();
    await run(async () => {
      await api.saveRepositoryConfigDraft({ target, content: repositoryConfigDraft });
      const plan = await api.createDraftPlan();
      setDraftPlan(plan);
      setNotice('Configuration saved locally and plan refreshed against current ADO revisions.');
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
    setDraftPlan({ ...draftPlan, contract: {
      ...draftPlan.contract,
      criteria: draftPlan.contract.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, expectedBehavior } : criterion),
    } });
  }

  function promoteTaskCandidate(candidateId: string) {
    if (!draftPlan) return;
    const candidate = draftPlan.contract.taskCandidates.find(({ id }) => id === candidateId);
    if (!candidate || candidate.disposition !== 'PROPOSED') return;
    const layer = draftPlan.manifest.targetKind === 'site' ? 'browser' as const : 'repo' as const;
    const criterionId = `${candidate.id}-criterion`;
    const scenarioId = `${candidate.id}-${layer}`;
    const text = candidate.text.slice(0, 1000);
    const criteria = [...draftPlan.contract.criteria, {
      id: criterionId, source: { userAdded: true as const, author: 'Local QA plan editor', derivedFrom: candidate.source },
      expectedBehavior: text, requiredLayers: [layer], scenarioIds: [scenarioId], ambiguityNotes: [],
    }];
    const scenarios = [...draftPlan.contract.scenarios, {
      id: scenarioId, criterionIds: [criterionId], layer, preconditions: [],
      steps: layer === 'browser' ? [{ action: 'expectText' as const, text }] : [],
      expectedObservations: [text], risk: 'medium' as const, approved: false,
    }];
    setDraftPlan({ ...draftPlan, contract: {
      ...draftPlan.contract, criteria, scenarios,
      taskCandidates: draftPlan.contract.taskCandidates.map((item) => item.id === candidateId ? { ...item, disposition: 'ACCEPTED', criterionId } : item),
    } });
  }

  function rejectTaskCandidate(candidateId: string) {
    if (!draftPlan) return;
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, taskCandidates: draftPlan.contract.taskCandidates.map((item) => item.id === candidateId ? { ...item, disposition: 'REJECTED', criterionId: undefined } : item) } });
  }

  function updateScenarioStep(scenarioId: string, index: number, step: Scenario['steps'][number]) {
    if (!draftPlan) return;
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
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => scenario.id === scenarioId && scenario.steps.length < 100 ? { ...scenario, steps: [...scenario.steps, blankStep('expectText')] } : scenario) } });
  }

  function removeScenarioStep(scenarioId: string, index: number) {
    if (!draftPlan) return;
    setDraftPlan({ ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => scenario.id === scenarioId ? { ...scenario, steps: scenario.steps.filter((_, candidateIndex) => candidateIndex !== index) } : scenario) } });
  }

  async function approvePlan() {
    if (!draftPlan) return;
    await run(async () => {
      const approved = { ...draftPlan, contract: { ...draftPlan.contract, scenarios: draftPlan.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
      await api.approvePlan(approved);
      setDraftPlan(undefined);
      const runId = approved.manifest.runId;
      setSelectedRunId(runId);
      setSelectedRun(undefined);
      setScreen('history');
      const [nextRuns, detail] = await Promise.all([api.listRuns(), api.getRun(runId)]);
      setRuns(nextRuns);
      setSelectedRun(detail);
      setReviewFindingId(detail?.findings.find((finding) => !finding.humanOverride)?.id ?? '');
      setNotice('Plan approved. This QA run is ready to start.');
    });
  }

  async function importModelKey() {
    await run(async () => {
      const imported = await api.importModelKey();
      if (imported) updateState(await api.getState());
      setNotice(imported ? 'OpenAI key imported into encrypted local storage. The key was not returned to the renderer.' : 'Key import cancelled.');
    });
  }

  async function connectProvider() {
    await run(async () => {
      const imported = await api.importProviderKey(modelProvider);
      if (!imported) { setNotice('Provider key import canceled.'); return; }
      const models = await api.listProviderModels(modelProvider);
      setProviderModels(models);
      const priorModel = modelProvider === state.modelProvider ? state.modelId ?? '' : '';
      updateState(await api.getState());
      setModelId(models.some(({ modelId: id }) => id === priorModel) ? priorModel : '');
      setNotice(`${modelProvider === 'openai' ? 'OpenAI' : modelProvider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} connected. ${models.length} supported models discovered.`);
    });
  }

  async function discoverProviderModels() {
    await run(async () => {
      const models = await api.listProviderModels(modelProvider);
      setProviderModels(models);
      setNotice(`${models.length} supported models discovered.`);
    });
  }

  async function saveModelSettings() {
    await run(async () => {
      await api.saveAgentModelSettings({ providerId: modelProvider, modelId: modelId.trim(), maxOutputTokens: modelMaxOutputTokens });
      updateState(await api.getState());
      setNotice('Required agent provider, model and output-token limit saved locally.');
    });
  }

  async function saveAdoProfile() {
    const storyIds = profileStoryIds.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean).map(Number);
    if (storyIds.some((id) => !Number.isSafeInteger(id) || id < 1)) { setError('Story IDs must be positive numbers separated by commas or spaces.'); return; }
    await run(async () => {
      const next = await api.saveAdoProfile({ ...(profileId ? { id: profileId } : {}), name: profileName, organization: profileOrganization, project: { ...(profileProjectId.trim() ? { id: profileProjectId } : {}), name: profileProjectName }, team: profileTeam, boardColumn: profileColumn, storyIds });
      updateState(next);
      setProfileId('');
      setProfileName('');
      setProfileTeam('');
      setProfileColumn('');
      setProfileStoryIds('');
      setNotice('Azure DevOps configuration profile saved locally.');
    });
  }

  async function importAdoProfilesConfig() {
    await run(async () => {
      const next = await api.importAdoProfilesConfig();
      updateState(next);
      if (next.selectedProject) {
        setWorkItemTypes(await api.listWorkItemTypes());
        setScreen('work-items');
      }
      setNotice(next.adoProfiles?.length ? 'Azure DevOps profiles imported and validated from the configuration file.' : 'No configuration file was imported.');
    });
  }

  function editAdoProfile(profile: NonNullable<DesktopState['adoProfiles']>[number]) {
    setProfileId(profile.id);
    setProfileName(profile.name);
    setProfileOrganization(profile.organization);
    setProfileProjectId(profile.project.id);
    setProfileProjectName(profile.project.name);
    setProfileTeam(profile.team);
    setProfileColumn(profile.boardColumn);
    setProfileStoryIds(profile.storyIds.join(', '));
  }

  async function refreshPlan() {
    await run(async () => {
      const plan = await api.createDraftPlan();
      setDraftPlan(plan);
    });
  }

  async function createRerunPlan(runId: string) {
    await run(async () => {
      const plan = await api.createDraftPlan(runId);
      setDraftPlan(plan);
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
    await run(async () => Promise.all([api.getRun(runId), api.getRunProgress(runId)]), ([detail, progress]) => {
      setSelectedRunId(runId);
      setSelectedRun(detail);
      setArtifactPreviews({});
      setRunProgress(progress);
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

  async function previewEvidence(artifactId: string) {
    if (!selectedRun || artifactPreviews[artifactId]) return;
    await run(async () => {
      const dataUrl = await api.getArtifactPreview(selectedRun.manifest.runId, artifactId);
      setArtifactPreviews((current) => ({ ...current, [artifactId]: dataUrl }));
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
    let settled = false;
    const pending = api.startRun(runId).finally(() => { settled = true; });
    await run(async () => {
      while (!settled) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
        const [progress, detail] = await Promise.all([api.getRunProgress(runId), api.getRun(runId)]);
        setRunProgress(progress);
        if (detail) setSelectedRun(detail);
      }
      const report = await pending;
      const [detail, progress] = await Promise.all([api.getRun(runId), api.getRunProgress(runId)]);
      if (detail) setSelectedRun(detail);
      setRunProgress(progress);
      return report;
    }, (report) => {
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

  const screenTitle = navigation.find(({ id }) => id === screen)?.label ?? (screen === 'settings' ? 'Settings' : screen === 'connections' ? 'Sign in' : screen === 'project' ? 'Organization' : screen === 'run-setup' ? 'New run' : screen === 'plan' ? 'Plan review' : 'Workspace');
  const activeNavigation = screen === 'run-setup' || screen === 'plan' ? 'history' : screen === 'project' ? 'work-items' : screen;

  return (
    <div className={`app-frame ${screen === 'connections' ? 'onboarding-frame' : ''}`} data-theme="dark">
      {screen !== 'connections' ? <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-symbol" aria-hidden="true">AQ</div>
          <div className="brand-name"><strong>Agentic QA</strong><span>LOCAL QA WORKSPACE</span></div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${activeNavigation === item.id ? 'selected' : ''}`}
              aria-current={activeNavigation === item.id ? 'page' : undefined}
              onClick={() => { setScreen(item.id); if (item.id === 'history') void openHistory(); }}
            >
              <span>{item.label}</span>
              {item.id === 'queue' && state.queue.length > 0 ? (
                <span className="nav-count">{state.queue.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            type="button"
            className={`nav-item sidebar-settings ${activeNavigation === 'settings' ? 'selected' : ''}`}
            aria-current={activeNavigation === 'settings' ? 'page' : undefined}
            onClick={() => setScreen('settings')}
          >
            <span>Settings</span>
          </button>
          <div className="privacy-mark"><span>●</span> Stored on this device</div>
          <div className="version-mark">Version 1.0 · Local</div>
        </div>
      </aside> : null}

      <div className="main-column">
        {screen !== 'connections' ? <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{screenTitle}</strong></div>
          <div className="context-pills">
            <span className="context-pill"><i className={state.selectedAccountId ? 'connected' : ''} />
              {state.accounts.find(({ homeAccountId }) => homeAccountId === state.selectedAccountId)?.username ?? 'Azure DevOps not connected'}
            </span>
            {state.selectedOrganization ? <span className="context-pill organization-pill">{state.selectedOrganization}</span> : null}
            {state.selectedProject ? <span className="context-pill project-pill">{state.selectedProject.name}</span> : null}
          </div>
        </header> : null}

        <main className="content-area">
          {error ? <div className="message error-message" role="alert">{error}</div> : null}
          {notice ? <div className="message success-message" role="status">{notice}</div> : null}

          {screen === 'connections' ? (
            <section className="page-section">
              <div className="page-heading">
                <div><p className="eyebrow">WELCOME</p><h1>Start your QA workspace</h1></div>
              </div>
              <p className="page-description">Sign in with your Azure DevOps account to choose an organization and add Stories or Tasks to your local QA Queue.</p>
              <div className="panel connection-panel">
                <div className="panel-illustration" aria-hidden="true"><span>↗</span><div>ADO</div></div>
                <div className="panel-body">
                  <div className="panel-title-row"><div><h2>Azure DevOps Services</h2><p>Read-only access · data stays on this device</p></div><span className="security-tag">READ ONLY</span></div>
                  <p className="field-help">Azure CLI opens Microsoft sign-in in your system browser and reuses the account already signed in on this machine.</p>
                  <button className="button primary microsoft-button" type="button" disabled={busy || !state.azureCliAvailable} onClick={() => void signIn()}><span className="ms-grid" aria-hidden="true"><i /><i /><i /><i /></span>{busy ? 'Opening sign-in…' : 'Sign in with Azure DevOps'}</button>
                  {!state.azureCliAvailable ? <p className="field-help" role="note">Azure CLI is not installed. Install Azure CLI, then restart this app.</p> : <p className="field-help" role="note">Sign-in opens your system browser through Azure CLI. Your existing CLI sign-in is reused.</p>}
                  <div className="permission-note"><span>🔒</span><p>Azure CLI manages sign-in on this machine. A short-lived ADO token is used only in the app's main process; the renderer and QA workers never receive it.</p></div>
                </div>
              </div>
            </section>
          ) : null}

          {screen === 'project' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">ORGANIZATION</p><h1>Choose an organization</h1></div><span className="context-pill">{state.accounts.find(({ homeAccountId }) => homeAccountId === state.selectedAccountId)?.username ?? 'Azure DevOps account'}</span></div>
              <p className="page-description">Select an organization available to your account, or add one by name. We’ll check access before saving it.</p>
              <div className="panel selection-panel">
                <div className="panel-title-row"><div><h2>Already have an ADO config file?</h2><p>Import organization, project, team, board column and Story IDs to finish setup without entering them here.</p></div><button className="button outline" type="button" disabled={busy || !state.selectedAccountId} onClick={() => void importAdoProfilesConfig()}>Import profiles config file…</button></div>
                <div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void refreshOrganizations()}>{busy ? 'Checking…' : 'Refresh organizations'}</button></div>
                {organizations.length || state.savedOrganizations?.length ? <div className="project-list"><div className="list-heading"><div><span className="eyebrow">AVAILABLE TO THIS ACCOUNT</span><h2>{organizations.length || state.savedOrganizations?.length} organizations</h2></div></div>{organizations.map((item) => <button type="button" className="project-card" key={item.id} onClick={() => { setOrganization(item.name); void connectOrganization(item.name); }}><span className="project-icon">{item.name.slice(0, 1).toUpperCase()}</span><span className="project-name"><strong>{item.name}</strong><small>{state.savedOrganizations?.includes(item.name) ? 'Saved organization' : 'Available organization'}</small></span><span className="project-arrow">→</span></button>)}</div> : null}
                <label className="field-label" htmlFor="organization">Add organization by name</label>
                <div className="inline-form"><input id="organization" className="text-input" value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="contoso" /><button type="button" className="button primary" disabled={busy || !organization.trim() || !state.selectedAccountId} onClick={() => void connectOrganization()}>{busy ? 'Checking…' : 'Add organization'}</button></div>
                {!state.selectedAccountId ? <p className="field-help">Sign in with Azure DevOps first.</p> : null}
                <div className="project-list">
                  <div className="list-heading"><div><span className="eyebrow">PROJECTS</span><h2>{projects.length ? `${projects.length} projects` : 'Choose an organization first'}</h2></div></div>
                  {projects.map((project) => <button type="button" className={`project-card ${state.selectedProject?.id === project.id ? 'active' : ''}`} key={project.id} onClick={() => void selectProject(project)}><span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span><span className="project-name"><strong>{project.name}</strong><small>{project.state ?? 'Azure DevOps project'}</small></span><span className="project-arrow">→</span></button>)}
                  {!projects.length ? <div className="empty-card"><span className="empty-icon">⌕</span><strong>Projects will appear here</strong><p>Enter an organization above to list projects available to this account.</p></div> : null}
                </div>
              </div>
            </section>
          ) : null}

          {screen === 'work-items' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">WORK ITEMS</p><h1>Find work to verify</h1></div></div>
              <p className="page-description">Search Stories and Tasks in <strong>{projectLabel(state.selectedProject)}</strong>. Add a Story, its child Tasks, or both to the local QA Queue.</p>
              <SprintWorkPicker api={api} activeAdoProfileId={state.activeAdoProfileId} queuedIds={queuedIds} onQueueChanged={updateState} onError={setError} onNotice={setNotice} />
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
              <div className="page-heading"><div><p className="eyebrow">READY TO REVIEW</p><h1>Your QA Queue</h1></div><span className="step-count">{state.queue.length} items</span></div>
              <p className="page-description">Selected work stays on this device. Queue order changes presentation only; it does not affect verdict priority.</p>
              <div className="queue-toolbar"><div><strong>{state.queue.length} selected</strong><span>Stories with their queued Tasks · grouped by Azure DevOps project</span></div><div className="button-row"><button className="button outline" type="button" disabled={busy || !state.queue.length} onClick={() => void mutateQueue(() => api.refreshQueue())}>{busy ? 'Refreshing…' : 'Refresh source revisions'}</button><button className="button primary" type="button" disabled={!state.queue.length} onClick={() => setScreen('run-setup')}>Start QA</button></div></div>
              <div className="queue-list">{queueProjectGroups.map((project) => <section className="queue-project-group" aria-label={project.label} key={project.key}><h2>{project.label}</h2>{project.stories.map(({ story, tasks }) => <section className="queue-story-group" aria-label={`Story #${story.view.entry.workItemId} ${story.view.snapshot?.title ?? 'Work item details unavailable'}`} key={story.view.entry.key}><QueueWorkItemRow view={story.view} index={story.index} queueLength={state.queue.length} busy={busy} onMove={(key, direction) => void mutateQueue(() => api.moveQueueItem(key, direction))} onRemove={(key) => void mutateQueue(() => api.removeQueueItem(key))} />{tasks.length ? <div className="queue-task-rows" aria-label={`Tasks under Story #${story.view.entry.workItemId}`}>{tasks.map(({ view, index }) => <QueueWorkItemRow key={view.entry.key} view={view} index={index} queueLength={state.queue.length} busy={busy} onMove={(key, direction) => void mutateQueue(() => api.moveQueueItem(key, direction))} onRemove={(key) => void mutateQueue(() => api.removeQueueItem(key))} />)}</div> : null}</section>)}{project.otherItems.length ? <div className="queue-other-items">{project.stories.length ? <h3>Other queued work</h3> : null}{project.otherItems.map(({ view, index }) => <QueueWorkItemRow key={view.entry.key} view={view} index={index} queueLength={state.queue.length} busy={busy} onMove={(key, direction) => void mutateQueue(() => api.moveQueueItem(key, direction))} onRemove={(key) => void mutateQueue(() => api.removeQueueItem(key))} />)}</div> : null}</section>)}{!state.queue.length ? <div className="empty-card"><span className="empty-icon">＋</span><strong>Your queue is ready for requirements</strong><p>Search a project and add work items. A task can inform QA scope, but it does not prove its parent’s acceptance criteria.</p><button className="button outline" type="button" onClick={() => setScreen('work-items')}>Find work items</button></div> : null}</div>
            </section>
          ) : null}

          {screen === 'run-setup' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">NEW RUN</p><h1>Set up a QA run</h1></div></div>
              <p className="page-description">Choose which target this contract must cover. Repository checks use a disposable snapshot; site checks stay within the approved origin.</p>
              <div className="panel selection-panel run-setup-panel">
                <label className="field-label" htmlFor="target-kind">Target layers</label>
                <select id="target-kind" className="text-input target-select" value={targetKind} onChange={(event) => setTargetKind(event.target.value as TargetConfig['targetKind'])}>
                  <option value="site">Site only</option><option value="repository">Repository only</option><option value="both">Repository and site</option>
                </select>
                {targetKind !== 'site' ? <div className="target-block"><label className="field-label" htmlFor="repository-source">Repository source</label><select id="repository-source" className="text-input" value={repositorySource} onChange={(event) => setRepositorySource(event.target.value as 'local' | 'ado-git')}><option value="local">Local folder</option><option value="ado-git">Azure DevOps Git</option></select>{repositorySource === 'local' ? <><div className="inline-form"><input id="repo-path" className="text-input" value={repositoryPath} readOnly placeholder="Choose a repository folder" /><button className="button outline" type="button" disabled={busy} onClick={() => void chooseRepository()}>Choose folder…</button></div><p className="field-help">The selected source will be copied into a temporary snapshot before repository commands run.</p></> : <><div className="button-row"><button className="button outline" type="button" disabled={busy || !state.selectedProject} onClick={() => void loadGitRepositories()}>Load project repositories</button></div><label className="field-label" htmlFor="ado-git-repository">Repository</label><select id="ado-git-repository" className="text-input" value={selectedGitRepository?.id ?? ''} onChange={(event) => { const repository = gitRepositories.find(({ id }) => id === event.target.value); if (repository) void selectGitRepository(repository); }}><option value="">Choose repository</option>{gitRepositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select><label className="field-label" htmlFor="ado-git-ref">Ref and commit</label><select id="ado-git-ref" className="text-input" value={selectedGitRef?.name ?? ''} onChange={(event) => setSelectedGitRef(gitRefs.find(({ name }) => name === event.target.value))}><option value="">Choose branch or tag</option>{gitRefs.map((ref) => <option key={`${ref.name}:${ref.objectId}`} value={ref.name}>{ref.name} · {ref.objectId.slice(0, 12)}</option>)}</select><p className="field-help">The chosen ref is resolved to its commit SHA. Only configured, non-secret files from that frozen commit are staged locally; the worker receives no ADO token.</p></>}</div> : null}
                {targetKind !== 'site' ? <details className="target-block"><summary>Advanced repository command settings</summary><p className="field-help">Most repositories need no manual setup. Agentic QA detects a root npm test script automatically. Use custom JSON only when you need to select another command or exact JUnit mappings.</p><div className="panel-title-row"><div><strong>Custom repository configuration</strong><p className="field-help">Stored encrypted with this app; it does not change repository files.</p></div><button className="button outline" type="button" disabled={busy || (repositorySource === 'local' ? !repositoryPath : !selectedGitRepository || !selectedGitRef)} onClick={() => void loadRepositoryConfigDraft()}>{repositoryConfigDraft ? 'Reload configuration' : 'Load configuration starter'}</button></div>{repositoryConfigDraft ? <><textarea className="contract-textarea payload-preview" aria-label="Repository configuration JSON" value={repositoryConfigDraft} onChange={(event) => setRepositoryConfigDraft(event.target.value)} /><div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void saveRepositoryConfigOnly()}>Save local configuration</button></div></> : null}</details> : null}
                {targetKind !== 'repository' ? <div className="target-block"><label className="field-label" htmlFor="site-url">Development or staging URL</label><input id="site-url" className="text-input" value={siteBaseUrl} onChange={(event) => setSiteBaseUrl(event.target.value)} placeholder="https://staging.example.test" /><p className="field-help">Only the origin in this URL will be approved for the browser worker. Production URLs are not recommended.</p></div> : null}
                {targetKind !== 'repository' ? <div className="target-block"><div className="queue-toolbar"><div><strong>Local Chromium browser</strong><span>{browserInstalled ? 'Installed and ready' : 'Required for site checks; downloads to this device (about 300 MB).'}</span></div><button className="button outline" type="button" disabled={busy || browserInstalled} onClick={() => void installBrowser()}>{busy ? 'Installing…' : browserInstalled ? 'Installed' : 'Install browser'}</button></div></div> : null}
                {targetKind !== 'site' ? <div className="target-block"><div className="queue-toolbar"><div><strong>Docker repository worker</strong><span>{repoWorkerInstalled ? 'Worker image installed' : 'Docker Desktop required; prepares the pinned Node 22 and .NET 10 worker image.'}</span></div><button className="button outline" type="button" disabled={busy || repoWorkerInstalled} onClick={() => void installRepoWorker()}>{busy ? 'Preparing…' : repoWorkerInstalled ? 'Installed' : 'Prepare worker'}</button></div></div> : null}
                <div className="button-row"><button className="button primary" type="button" disabled={busy || !state.queue.length || !state.modelProviderConfigured || !state.modelId || (targetKind !== 'repository' && !siteBaseUrl.trim()) || (targetKind !== 'site' && (repositorySource === 'local' ? !repositoryPath : !selectedGitRepository || !selectedGitRef))} onClick={() => void saveRunTarget()}>{busy ? 'Preparing…' : 'Prepare agentic QA plan'}</button>{!state.modelProviderConfigured || !state.modelId ? <span className="field-help">Configure a provider and supported model in Settings first.</span> : null}</div>
              </div>
            </section>
          ) : null}

          {screen === 'plan' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">PLAN REVIEW</p><h1>Review the QA plan</h1></div><span className="step-count">{draftPlan?.contract.criteria.length ?? 0} criteria</span></div>
              <p className="page-description">The source revision and acceptance-criteria field are frozen in this draft. Edit expected behavior and required evidence before saving the contract.</p>
              <PlanSummary draftPlan={draftPlan} queue={state.queue} target={state.target} />
              <OrchestratorPlan draftPlan={draftPlan} />
              {draftPlan?.notes.map((note) => <div className="message review-message" key={note}>{note}</div>)}
              {draftPlan?.contract.coverageGaps?.map((gap) => <div className="message error-message" role="note" key={gap.id}>{gap.message} This source gap keeps the run at NEEDS_REVIEW until the Requirement is updated in Azure DevOps and the plan is refreshed.</div>)}
              {draftPlan?.contract.taskCandidates?.length ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Task descriptions · scope context</h2><p>Each description is tied to its ADO revision. Promote a Task into a candidate check only after reviewing it; a Task does not establish its parent Requirement’s Acceptance Criteria.</p></div></div>{draftPlan.contract.taskCandidates.map((candidate) => <div className="command-preview-row" key={candidate.id}><strong>ADO Task #{candidate.source.workItemId} · {candidate.disposition.toLocaleLowerCase('en-US')}</strong><p>{candidate.text}</p><small>{candidate.source.field} · revision {candidate.source.revision}</small>{candidate.disposition === 'PROPOSED' ? <div className="button-row"><button className="button outline" type="button" onClick={() => promoteTaskCandidate(candidate.id)}>Add as candidate criterion</button><button className="text-button" type="button" onClick={() => rejectTaskCandidate(candidate.id)}>Ignore this Task</button></div> : candidate.disposition === 'ACCEPTED' ? <small>Linked to candidate criterion {candidate.criterionId}. Review its checks below.</small> : null}</div>)}</div> : null}
              {draftPlan?.repositoryCommands?.length ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Repository commands</h2><p>Exact argument arrays run inside the isolated worker, with networking disabled.</p></div><button className="button outline" type="button" disabled={busy} onClick={() => void refreshPlan()}>Refresh after config edits</button></div>{draftPlan.repositoryCommands.map((command) => <div className="command-preview-row" key={command.id}><strong>{command.label} · {command.timeoutSeconds}s</strong><code>{command.executable} {command.arguments.map((argument) => JSON.stringify(argument)).join(' ')}</code><small>Directory: {command.workingDirectory} · Results: {command.resultFormat ?? 'none'}{command.scenarioMappings.length ? ` · Scenarios: ${command.scenarioMappings.map(({ scenarioId, testCaseIds }) => `${scenarioId} ← ${testCaseIds.join(', ')}`).join('; ')}` : ' · diagnostic only'}</small></div>)}</div> : null}
              {draftPlan?.manifest.targetKind !== 'site' ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Local repository configuration</h2><p>Use the plan’s Repository Scenario IDs in each JUnit command’s scenarioMappings. A command without a mapping is diagnostic and cannot prove acceptance criteria.</p></div><button className="button outline" type="button" disabled={busy} onClick={() => void loadRepositoryConfigDraft()}>Load saved JSON</button></div>{repositoryConfigDraft ? <><textarea className="contract-textarea payload-preview" aria-label="Repository configuration JSON for mapping scenarios" value={repositoryConfigDraft} onChange={(event) => setRepositoryConfigDraft(event.target.value)} /><div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void saveRepositoryConfigAndRefreshPlan()}>Save and refresh plan</button></div></> : <p className="field-help">Load the saved configuration to map exact JUnit testcase IDs to the reviewed scenarios.</p>}</div> : null}
              <div className="disclosure-card"><div className="disclosure-icon">✓</div><div><strong>One approval covers this agentic run envelope</strong><p>After approval, the configured provider receives the selected Story and Task content, Acceptance Criteria, task links, selected file-scope patterns, approved site origin, and command IDs. If the Orchestrator selects repository coverage, a bounded, secret-filtered sample of approved text source files is also sent to the backend specialist to write tests. Environment files, credential files and known secret-shaped values are excluded or redacted. No provider request occurs before approval.</p></div></div>
              {draftPlan?.envelopePreview ? <div className="panel command-preview"><div className="panel-title-row"><div><h2>Approved context and limits</h2><p>{draftPlan.envelopePreview.providerId} / {draftPlan.envelopePreview.modelId} · estimated cost ceiling ${draftPlan.envelopePreview.budget.maxCostUsd.toFixed(2)} · {draftPlan.envelopePreview.budget.maxProviderCalls} provider calls · {draftPlan.envelopePreview.budget.maxAgents} agents · {draftPlan.envelopePreview.budget.maxRunSeconds}s</p></div></div><p className="field-help">Sources and revisions: {Object.entries(draftPlan.envelopePreview.sourceRevisions).map(([key, revision]) => `${key} r${revision}`).join(' · ')}</p><p className="field-help">Repository scope: {draftPlan.envelopePreview.repositoryPaths.join(', ') || 'not selected'} · Commands: {draftPlan.envelopePreview.commandIds.join(', ') || 'none'} · Approved origins: {draftPlan.envelopePreview.allowedOrigins.join(', ') || 'none'}</p></div> : null}
              <div className="criteria-list">{draftPlan?.contract.criteria.map((criterion) => <article className="criterion-card" key={criterion.id}>
                <div className="criterion-source"><span>ADO #{criterion.source && 'workItemId' in criterion.source ? criterion.source.workItemId : 'Local'}</span><span>revision {criterion.source && 'revision' in criterion.source ? criterion.source.revision : '—'}</span><span>{criterion.source && 'field' in criterion.source ? criterion.source.field : 'User-added'}</span></div>
                <label className="field-label" htmlFor={`criterion-${criterion.id}`}>Expected behavior</label>
                <textarea id={`criterion-${criterion.id}`} className="contract-textarea" value={criterion.expectedBehavior} onChange={(event) => updateCriterion(criterion.id, event.target.value)} />
                <div className="required-layers"><span className="field-label">Evidence plan</span><span>The Orchestrator will select repository, browser or both coverage from the Acceptance Criterion, linked Tasks, and approved target.</span></div>
                {criterion.scenarioIds.map((scenarioId) => {
                  const scenario = draftPlan.contract.scenarios.find(({ id }) => id === scenarioId);
                  if (!scenario) return null;
                  return <div className="scenario-editor" key={scenario.id}><div className="scenario-heading"><strong>{scenario.summary ?? (scenario.layer === 'browser' ? 'Browser scenario' : 'Repository evidence')}{scenario.id.startsWith('ai-') ? ' · AI suggestion' : ''}</strong><span>{scenario.layer}</span></div><p className="field-help">Expected observations: {scenario.expectedObservations.join(' · ')}</p>{scenario.layer === 'browser' ? <><p className="field-help">Actions use accessible roles and exact control names. Approval permits only the configured site origin. Do not use real credentials. AI suggestions are untrusted; inspect every step and expected observation.</p>{scenario.steps.map((step, index) => <ScenarioStepEditor key={`${scenario.id}-${index}`} scenarioId={scenario.id} index={index} step={step} onChange={(next) => updateScenarioStep(scenario.id, index, next)} onRemove={() => removeScenarioStep(scenario.id, index)} />)}<button className="button outline" type="button" disabled={scenario.steps.length >= 100} onClick={() => addScenarioStep(scenario.id)}>Add browser action</button></> : <><p className="field-help">Repository tests are detected and run automatically when supported. Exact JUnit mappings can link a named test to this Acceptance Criterion; without a mapping, repository output is diagnostic and coverage remains NEEDS_REVIEW.</p><code className="scenario-id">{scenario.id}</code></>}</div>;
                })}
              </article>)}{draftPlan && !draftPlan.contract.criteria.length ? <div className="empty-card"><strong>No source acceptance criteria were found</strong><p>This plan cannot be approved as a passing run. Add or clarify a Requirement with acceptance criteria first.</p></div> : null}</div>
              {draftPlan?.manifest.targetKind !== 'site' ? <details className="panel command-preview"><summary>Advanced: custom repository configuration</summary><p>Only edit this when automatic test discovery selected the wrong command or you need exact JUnit mappings. A command without exact mappings is diagnostic and cannot verify an Acceptance Criterion.</p><div className="panel-title-row"><div><h2>Local repository configuration</h2><p>Saved encrypted in this app; the repository is not modified.</p></div><button className="button outline" type="button" disabled={busy} onClick={() => void loadRepositoryConfigDraft()}>Load saved JSON</button></div>{repositoryConfigDraft ? <><textarea className="contract-textarea payload-preview" aria-label="Repository configuration JSON for advanced repository settings" value={repositoryConfigDraft} onChange={(event) => setRepositoryConfigDraft(event.target.value)} /><div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void saveRepositoryConfigAndRefreshPlan()}>Save and refresh plan</button></div></> : <p className="field-help">Custom JSON is optional. Normal npm projects are detected without it.</p>}</details> : null}
              <div className="queue-toolbar"><div><strong>Run context and evidence scope</strong><span>{draftPlan?.manifest.targetKind} · {draftPlan?.manifest.sources.length} source snapshots · {draftPlan?.manifest.siteBaseUrl ?? 'No site URL'} · {state.modelProvider} / {state.modelId}{draftPlan?.manifest.repositorySource?.kind === 'ado-git' ? ` · ${draftPlan.manifest.repositorySource.refName} @ ${draftPlan.manifest.sourceCommit?.slice(0, 12)}` : draftPlan?.manifest.repositorySource?.kind === 'local' ? ` · local tree ${draftPlan.manifest.localGitState ?? 'state unavailable'}` : ''}</span></div><button className="button primary" type="button" disabled={busy || !draftPlan?.contract.criteria.length || draftPlan?.contract.criteria.some((criterion) => !criterion.expectedBehavior.trim())} onClick={() => void approvePlan()}>{busy ? 'Saving…' : 'Approve reviewed QA scope'}</button></div>
            </section>
          ) : null}

          {screen === 'settings' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1></div></div>
              <p className="page-description">Manage your Azure DevOps account and required agent provider. QA runs cannot start until a supported provider and model are configured.</p>
              <div className="panel selection-panel">
                <div className="panel-title-row"><div><h2>Azure DevOps account</h2><p>Authentication runs through Azure CLI in your system browser. Access is read-only.</p></div><span className="security-tag">{state.selectedAccountId ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
                {state.accounts.map((account) => <div className="account-row" key={account.homeAccountId}><span className="account-avatar">{(account.displayName ?? account.username).slice(0, 1).toUpperCase()}</span><div><strong>{account.displayName ?? account.username}{state.selectedAccountId === account.homeAccountId ? ' · Active' : ''}</strong><span>{account.username}</span></div>{state.selectedAccountId === account.homeAccountId ? <button className="button quiet" type="button" disabled={busy} onClick={() => void run(() => api.signOut(account.homeAccountId), updateState)}>Disconnect</button> : <button className="button quiet" type="button" disabled={busy} onClick={() => void run(() => api.selectAccount(account.homeAccountId), updateState)}>Use account</button>}</div>)}
                <button className="button primary" type="button" disabled={busy || !state.azureCliAvailable} onClick={() => void signIn()}>{state.accounts.length ? 'Add or refresh CLI account' : 'Sign in with Azure DevOps'}</button>
                {state.selectedAccountId ? <p className="field-help">Disconnect only clears Agentic QA's selected account. Azure CLI stays signed in for your other tools.</p> : null}
                {!state.azureCliAvailable ? <p className="field-help" role="note">Azure CLI is not installed. Install Azure CLI, then restart this app.</p> : null}
                <div className="permission-note"><span>🔒</span><p>Azure CLI keeps the sign-in on this machine. A short-lived ADO token is used only in the main process and never sent to QA workers.</p></div>
              </div>
              <div className="panel selection-panel">
                <div className="panel-title-row"><div><h2>Azure DevOps configuration profiles</h2><p>Save each organization/project/team/board-column setup once, then switch profiles before runs. These settings stay encrypted with this app's local data.</p></div></div>
                <div className="button-row"><button className="button outline" type="button" disabled={busy || !state.selectedAccountId} onClick={() => void importAdoProfilesConfig()}>Import profiles config file…</button><button className="button outline" type="button" disabled={busy || !state.adoProfiles?.length} onClick={() => void run(async () => { const saved = await api.exportAdoProfilesConfig(); setNotice(saved ? 'Configuration exported from your saved app settings.' : 'Configuration export canceled.'); })}>Export current settings…</button><span className="field-help">Import or export version 1 JSON; credentials are never included.</span></div>
                {state.adoProfiles?.length ? <div className="saved-organizations">{state.adoProfiles.map((profile) => <div className="profile-card" key={profile.id}><div><strong>{profile.name}{state.activeAdoProfileId === profile.id ? ' · Active' : ''}</strong><span>{profile.organization} / {profile.project.name} · {profile.team} · {profile.boardColumn} · {profile.storyIds.length} Stories</span></div><div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void run(() => api.activateAdoProfile(profile.id), updateState)}>{state.activeAdoProfileId === profile.id ? 'Selected' : 'Use for runs'}</button><button className="button quiet" type="button" disabled={busy} onClick={() => editAdoProfile(profile)}>Edit</button><button className="button quiet" type="button" disabled={busy} onClick={() => void run(() => api.deleteAdoProfile(profile.id), updateState)}>Remove</button></div></div>)}</div> : <p className="field-help">No profiles saved. Create one from the configuration file values you use for QA.</p>}
                <div className="filters-row settings-fields"><label>Profile name<input className="text-input" value={profileName} maxLength={100} onChange={(event) => setProfileName(event.target.value)} placeholder="Derse QA" /></label><label>Organization URL or name<input className="text-input" value={profileOrganization} maxLength={500} onChange={(event) => setProfileOrganization(event.target.value)} placeholder="https://dev.azure.com/Xorbix" /></label></div>
                <div className="filters-row settings-fields"><label>Project name<input className="text-input" value={profileProjectName} maxLength={200} onChange={(event) => setProfileProjectName(event.target.value)} placeholder="Derse" /></label><label>Project ID <span className="field-help">Optional · resolves from project name</span><input className="text-input" value={profileProjectId} maxLength={200} onChange={(event) => setProfileProjectId(event.target.value)} placeholder="Project ID" /></label><label>Team<input className="text-input" value={profileTeam} maxLength={200} onChange={(event) => setProfileTeam(event.target.value)} placeholder="Derse Team" /></label></div>
              <div className="button-row"><button className="button outline" type="button" disabled={busy || !profileOrganization.trim() || !profileProjectName.trim()} onClick={() => void run(async () => { const teams = await api.listAdoTeams({ organization: profileOrganization.trim(), project: { ...(profileProjectId.trim() ? { id: profileProjectId.trim() } : {}), name: profileProjectName.trim() } }); setAdoTeams(teams); if (teams.length) setProfileTeam((current) => teams.some(({ name }) => name === current) ? current : teams.find(({ name }) => name.toLocaleLowerCase('en-US') === profileProjectName.toLocaleLowerCase('en-US'))?.name ?? teams[0]!.name); setNotice(teams.length ? `Loaded ${teams.length} teams from the selected Azure DevOps project.` : 'No teams were returned for this project.'); })}>Load project teams</button>{adoTeams.length ? <label>Team<select className="text-input" value={profileTeam} onChange={(event) => setProfileTeam(event.target.value)}><option value="">Choose a team</option>{adoTeams.map(({ id, name }) => <option key={id} value={name}>{name}</option>)}</select></label> : <label>Team<input className="text-input" value={profileTeam} maxLength={200} onChange={(event) => setProfileTeam(event.target.value)} placeholder="Load teams or enter a team name" /></label>}</div>
                <div className="filters-row settings-fields"><label>Taskboard column <span className="field-help">Optional · used by the legacy configured task loader</span><input className="text-input" value={profileColumn} maxLength={120} onChange={(event) => setProfileColumn(event.target.value)} placeholder="Leave blank to include all sprint Tasks" /></label><label>Story IDs <span className="field-help">Optional · sprint browsing finds Stories automatically</span><input className="text-input" value={profileStoryIds} maxLength={1600} onChange={(event) => setProfileStoryIds(event.target.value)} placeholder="20024, 19997" /></label></div>
                <div className="button-row"><button className="button primary" type="button" disabled={busy || !profileName.trim() || !profileOrganization.trim() || !profileProjectName.trim() || !profileTeam.trim()} onClick={() => void saveAdoProfile()}>{profileId ? 'Save profile' : 'Add profile'}</button>{profileId ? <button className="button quiet" type="button" onClick={() => { setProfileId(''); setProfileName(''); }}>Cancel edit</button> : null}</div>
              </div>
              <div className="panel selection-panel">
                <div className="panel-title-row"><div><h2>Organizations</h2><p>Saved separately for each signed-in account.</p></div><button className="button outline" type="button" onClick={() => setScreen('project')}>Manage organizations</button></div>
                {state.savedOrganizations?.length ? <div className="saved-organizations">{state.savedOrganizations.map((name) => <span className="context-pill" key={name}>{name}</span>)}</div> : <p className="field-help">No organizations saved yet.</p>}
              </div>
              <div className="panel selection-panel model-settings">
                <div className="panel-title-row"><div><h2>Required AI agent provider</h2><p>{state.modelProviderConfigured ? `${modelProvider === 'openai' ? 'OpenAI' : modelProvider === 'anthropic' ? 'Anthropic' : 'OpenRouter'} API key is stored locally. The key is never returned to the renderer or sent to workers.` : 'Connect a provider before planning or running QA. No deterministic plan fallback is available.'}</p></div><span className="security-tag">{state.modelProviderConfigured ? 'CONNECTED' : 'REQUIRED'}</span></div>
                <div className="filters-row settings-fields"><label>Provider<select className="text-input" value={modelProvider} onChange={(event) => { const next = event.target.value as 'openai' | 'anthropic' | 'openrouter'; setModelProvider(next); setProviderModels([]); setModelId(''); }}><option value="openai">OpenAI API</option><option value="anthropic">Anthropic API key</option><option value="openrouter">OpenRouter API key · multi-model catalog</option></select></label><button className="button outline" type="button" disabled={busy} onClick={() => void connectProvider()}>Import key and discover models…</button></div>
                <div className="filters-row settings-fields"><label>Search models<input className="text-input" type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search discovered models" /></label><label>Supported model<select className="text-input" value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Choose a supported model</option>{providerModels.filter(({ displayName, modelId: id }) => `${displayName} ${id}`.toLocaleLowerCase().includes(modelSearch.toLocaleLowerCase())).map(({ modelId: id, displayName, capabilities }) => <option key={id} value={id}>{displayName} · {id} · ${capabilities.inputUsdPerMillionTokens ?? '?'} / ${capabilities.outputUsdPerMillionTokens ?? '?'} per 1M tokens</option>)}</select></label><label>Max output tokens<input className="text-input" type="number" min={256} max={32000} step={256} value={modelMaxOutputTokens} onChange={(event) => setModelMaxOutputTokens(Number(event.target.value))} /></label></div>
                <div className="button-row"><button className="button outline" type="button" disabled={busy || !state.modelProviderConfigured} onClick={() => void discoverProviderModels()}>Refresh model list</button><button className="button primary" type="button" disabled={busy || !state.modelProviderConfigured || !modelId} onClick={() => void saveModelSettings()}>Save required agent model</button></div>
                {state.modelProviderConfigured ? <button className="button quiet" type="button" disabled={busy} onClick={() => void run(async () => { await api.clearModelKey(); setProviderModels([]); setModelId(''); updateState(await api.getState()); setNotice('Provider key and selected agent model removed from encrypted local storage.'); })}>Remove provider connection</button> : null}
                <small>Choose a private one-line key file in the native picker. The main process reads it, stores it in encrypted local settings, and never sends it to the renderer. Model discovery lists models that report structured output, tool use and pricing. OpenRouter provides a broad catalog behind one key. This release accepts Anthropic API keys; a Claude Pro/Max subscription requires a separate Claude Code CLI adapter and is not connected here.</small>
              </div>
            </section>
          ) : null}

          {screen === 'history' ? (
            <section className="page-section">
              <div className="page-heading"><div><p className="eyebrow">LOCAL RECORDS</p><h1>Run history</h1></div><button className="button outline" type="button" disabled={busy} onClick={() => void openHistory()}>Refresh</button></div>
              <p className="page-description">Approved run manifests and source evidence remain immutable. Reviewer decisions are appended and shown as the current verdict.</p>
              <div className="queue-list">{runs.map(({ manifest, report }) => <button type="button" className="history-row" key={manifest.runId} onClick={() => void openRun(manifest.runId)}><span className="queue-index">{manifest.startedAt.slice(0, 10)}</span><span className="project-name"><strong>{manifest.targetKind} · {manifest.sources.length} source snapshots</strong><small>Run {manifest.runId}</small></span><span className="verdict-badge">{report ? `${report.executionState} · ${report.verdict}` : selectedRunId === manifest.runId ? 'Manifest saved' : 'Not started'}</span></button>)}{!runs.length ? <div className="empty-card"><span className="empty-icon">◷</span><strong>No saved runs yet</strong><p>Approve an Orchestrator plan to create the first immutable manifest.</p><button className="button outline" type="button" onClick={() => setScreen('run-setup')}>Set up a run</button></div> : null}</div>
              {selectedRun ? <div className="panel report-preview">
                {(() => { const report = selectedRun.reviewedReport ?? selectedRun.report; return <>
                <div className="panel-title-row"><div><h2>{report ? 'Local report preview' : 'Approved run manifest'}</h2><p>{report ? `${report.executionState} · ${report.verdict}${selectedRun.reviewedReport ? ' · reviewed' : ''}` : 'Ready to execute'}</p></div></div>
                {selectedRun.delegationDiagram && selectedRun.delegationPlan ? <div className="delegation-diagram" aria-label="Generated agent delegation diagram">
                  <div className="delegation-orchestrator"><span>Orchestrator</span></div>
                  <div className="delegation-branches">{selectedRun.delegationPlan.assignments.map((assignment) => {
                    const node = selectedRun.delegationDiagram!.nodes.find(({ id }) => id === `agent:${assignment.id}`);
                    const result = selectedRun.delegationDiagram!.nodes.find(({ id }) => id === `result:${assignment.id}`);
                    const delegated = selectedRun.delegationDiagram!.edges.some(({ from, to }) => from === 'orchestrator' && to === `agent:${assignment.id}`);
                    return delegated ? <div className="delegation-branch" key={assignment.id}><span className="delegation-arrow" aria-hidden="true">↓</span><div className={`delegation-agent status-${assignment.status}`}><strong>{node?.label ?? assignment.label}</strong><small>{assignment.layer} · {assignment.status}</small></div><span className="delegation-arrow" aria-hidden="true">↓</span><div className="delegation-result"><strong>{result?.label ?? assignment.resultTypes.join(' · ')}</strong><small>{assignment.evidenceIds.length} evidence reference(s)</small></div></div> : null;
                  })}</div>
                  {selectedRun.delegationDiagram.nodes.some(({ id }) => id === 'agent:reviewer') ? <><span className="delegation-arrow" aria-hidden="true">↓</span><div className={`delegation-agent status-${selectedRun.delegationDiagram.nodes.find(({ id }) => id === 'agent:reviewer')?.status ?? 'queued'}`}><strong>Evidence Reviewer</strong><small>{selectedRun.delegationDiagram.nodes.find(({ id }) => id === 'agent:reviewer')?.status ?? 'queued'}</small></div></> : null}
                  <span className="delegation-arrow" aria-hidden="true">↓</span><div className="delegation-summary"><strong>{selectedRun.delegationDiagram.nodes.find(({ id }) => id === 'summary')?.label ?? 'Findings, proof and summary'}</strong></div>
                  <p className="field-help">Provider plan: {selectedRun.delegationPlan.summary}{selectedRun.agentUsage ? ` · ${selectedRun.agentUsage.providerCalls} calls · ${selectedRun.agentUsage.inputTokens + selectedRun.agentUsage.outputTokens} tokens · estimated $${selectedRun.agentUsage.costUsd.toFixed(4)}` : ''}</p>
                  {selectedRun.agentSummary ? <pre className="agent-summary">{selectedRun.agentSummary}</pre> : null}
                  {selectedRun.reviewerReport?.codeReview.length ? <section aria-label="AI generated test code review"><h3>Generated test code review</h3>{selectedRun.reviewerReport.codeReview.map((item, index) => <div className="review-message" key={`${item.path}:${item.line}:${index}`}><strong>{item.severity.toLocaleUpperCase('en-US')} · {item.path}:{item.line}</strong><p>{item.comment}</p><small>Recommendation: {item.recommendation}</small></div>)}</section> : null}
                </div> : null}
                {runProgress.length ? <div className="run-progress" aria-label="Orchestrator and worker progress"><h3>Orchestrator and worker activity</h3><ol>{runProgress.map((event, index) => <li key={`${event.runId}:${index}`} className={`progress-${event.state.toLowerCase()}`}><span>{event.worker} · {event.stage}</span><strong>{event.state}</strong><p>{event.message}</p><time>{new Date(event.at).toLocaleTimeString()}</time></li>)}</ol></div> : null}
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
                            if (!artifact) return null;
                            return <div className="artifact-evidence" key={artifactId}>
                              {artifact.kind === 'screenshot' ? <><button className="text-button" type="button" disabled={busy} onClick={() => void previewEvidence(artifactId)}>{artifact.sequence ? `View step ${artifact.sequence} screenshot` : 'View screenshot'}</button>{artifactPreviews[artifactId] ? <img className="evidence-screenshot" src={artifactPreviews[artifactId]} alt={`Restricted Playwright screenshot${artifact.sequence ? ` for step ${artifact.sequence}` : ''}`} /> : null}</> : null}
                              <button className="text-button" type="button" disabled={busy} onClick={() => void exportEvidence(artifactId)}>Save restricted {artifact.kind} evidence ({Math.ceil(artifact.bytes / 1024)} KB)</button>
                            </div>;
                          })}
                        </div>) : <span>No direct observations were recorded.</span>}
                      </div>
                    </div>;
                  })}</div>
                  <div className="button-row"><button className="button outline" type="button" disabled={busy} onClick={() => void createRerunPlan(selectedRun.manifest.runId)}>Create rerun plan</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('html')}>Export HTML</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('markdown')}>Export Markdown</button><button className="button outline" type="button" disabled={busy} onClick={() => void exportSelectedRun('json')}>Export JSON</button><button className="button outline" type="button" disabled={busy} onClick={() => void deleteSelectedRun()}>Delete run…</button></div>
                  {selectedRun.findings.some((finding) => !finding.humanOverride) ? <div className="review-panel"><h3>Reviewer classification</h3><p className="field-help">Reviewer decisions are appended; original observations and the first report remain preserved.</p><label className="field-label" htmlFor="review-finding">Finding</label><select id="review-finding" className="text-input" value={reviewFindingId} onChange={(event) => setReviewFindingId(event.target.value)}>{selectedRun.findings.filter((finding) => !finding.humanOverride).map((finding) => <option key={finding.id} value={finding.id}>{finding.kind} · {finding.rationale.slice(0, 100)}</option>)}</select><div className="filters-row"><label>Classification<select aria-label="Reviewer classification" value={reviewKind} onChange={(event) => setReviewKind(event.target.value as typeof reviewKind)}><option value="PRODUCT_FAILURE">Product failure</option><option value="TEST_FAILURE">Test failure</option><option value="ENVIRONMENT_FAILURE">Environment failure</option><option value="FLAKY_TEST">Flaky test</option><option value="AMBIGUOUS_REQUIREMENT">Ambiguous requirement</option></select></label><label>Reviewer<input className="text-input" value={reviewAuthor} maxLength={200} onChange={(event) => setReviewAuthor(event.target.value)} /></label></div><label className="field-label" htmlFor="review-reason">Reason</label><textarea id="review-reason" className="contract-textarea" value={reviewReason} maxLength={4000} onChange={(event) => setReviewReason(event.target.value)} /><div className="button-row"><button className="button primary" type="button" disabled={busy || !reviewFindingId || !reviewAuthor.trim() || !reviewReason.trim()} onClick={() => void classifySelectedFinding()}>Save reviewer classification</button></div></div> : null}
                  {selectedRun.findings.filter((finding) => finding.humanOverride).map((finding) => <div className="review-message" key={finding.id}>Reviewed by {finding.humanOverride!.author}: {finding.kind} — {finding.humanOverride!.reason}</div>)}
                </> : <>
                  <p className="field-help">Review the generated Playwright scenarios and backend test source before authorizing execution. Repository tests are written only into the disposable worker snapshot and run through the approved JUnit command.</p>
                  {selectedRun.repositoryTests?.length ? <div className="agent-generated-scenarios"><h3>Backend generated unit tests</h3>{selectedRun.repositoryTests.map((test, index) => <details className="command-preview" key={`${test.path}:${index}`}><summary>{test.path} · {test.scenarioIds.length} linked scenario(s)</summary><p className="field-help">JUnit command: {test.commandId} · expected test cases: {test.testCaseIds.join(', ')}</p><pre className="generated-test-source"><code>{test.content}</code></pre></details>)}</div> : null}
                  {selectedRun.contract.scenarios.filter(({ layer }) => layer === 'browser').length ? <div className="agent-generated-scenarios">{selectedRun.contract.scenarios.filter(({ layer }) => layer === 'browser').map((scenario) => <details className="command-preview" key={scenario.id}><summary>{scenario.summary ?? scenario.id} · {scenario.risk} risk · {scenario.steps.length} Playwright steps</summary><p className="field-help">Acceptance criteria: {scenario.criterionIds.join(', ')}</p><ol>{scenario.steps.map((step, index) => <li key={`${scenario.id}-${index}`}><code>{JSON.stringify(step)}</code></li>)}</ol><p className="field-help">Expected evidence: {scenario.expectedObservations.join(' · ')}</p></details>)}</div> : null}
                  <div className="button-row"><button className="button primary" type="button" disabled={busy || Boolean(activeRunId)} onClick={() => void startSelectedRun()}>{activeRunId ? 'Run in progress…' : 'Approve generated checks and start'}</button>{activeRunId ? <button className="button outline" type="button" onClick={() => void cancelSelectedRun()}>Cancel run</button> : null}</div>
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
