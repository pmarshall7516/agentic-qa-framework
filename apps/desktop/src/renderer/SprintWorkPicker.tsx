import { useEffect, useMemo, useState } from 'react';
import type { AdoIteration, AdoTaskboardItem } from '@agentic-qa/ado/client';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { DesktopApi, DesktopState } from '../shared/ipc.js';
import { errorMessage } from './error-message.js';

export function SprintWorkPicker({ api, activeAdoProfileId, queuedIds, onQueueChanged, onError, onNotice }: {
  api: DesktopApi;
  activeAdoProfileId?: string;
  queuedIds: Set<string>;
  onQueueChanged: (state: DesktopState) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [iterations, setIterations] = useState<AdoIteration[]>([]);
  const [iterationId, setIterationId] = useState('');
  const [sprintQuery, setSprintQuery] = useState('');
  const [sprintOpen, setSprintOpen] = useState(false);
  const [activeSprintOption, setActiveSprintOption] = useState(-1);
  const [stories, setStories] = useState<WorkItemSnapshot[]>([]);
  const [taskboardItems, setTaskboardItems] = useState<AdoTaskboardItem[]>([]);
  const [workItemQuery, setWorkItemQuery] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [childrenByStory, setChildrenByStory] = useState<Record<number, WorkItemSnapshot[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [afterId, setAfterId] = useState<number>();
  const [loadingIterations, setLoadingIterations] = useState(false);
  const [loadingStories, setLoadingStories] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedIteration = useMemo(() => iterations.find(({ id }) => id === iterationId), [iterations, iterationId]);
  const matchingIterations = useMemo(() => {
    const query = sprintQuery.trim().toLocaleLowerCase('en-US');
    return iterations.filter(({ name, path }) => !query || `${name} ${path ?? ''}`.toLocaleLowerCase('en-US').includes(query));
  }, [iterations, sprintQuery]);
  const taskColumns = useMemo(() => [...new Set(taskboardItems.map(({ column }) => column.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [taskboardItems]);

  function chooseIteration(iteration: AdoIteration) {
    setIterationId(iteration.id);
    setSprintQuery('');
    setSprintOpen(false);
    setActiveSprintOption(0);
    setStories([]);
    setTaskboardItems([]);
    setSelected(new Set());
    setChildrenByStory({});
    setExpanded(new Set());
    setAfterId(undefined);
    setWorkItemQuery('');
    setSelectedColumns(new Set());
  }

  async function refreshIterations() {
    if (!activeAdoProfileId) return;
    setLoadingIterations(true);
    onError('');
    try {
      const found = await api.listProfileIterations();
      setIterations(found);
      const selected = found.find(({ id }) => id === iterationId) ?? found.find(({ timeFrame }) => timeFrame === 'current') ?? found[0];
      setIterationId(selected?.id ?? '');
      setSprintQuery('');
      if (!found.length) onNotice('No sprints are available for this project team. The sprint search stays available and has no options.');
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setLoadingIterations(false);
    }
  }

  useEffect(() => {
    setIterations([]);
    setIterationId('');
    setSprintQuery('');
    setSprintOpen(false);
    setStories([]);
    setTaskboardItems([]);
    setWorkItemQuery('');
    setSelectedColumns(new Set());
    setSelected(new Set());
    setChildrenByStory({});
    setExpanded(new Set());
    setAfterId(undefined);
    if (activeAdoProfileId) void refreshIterations();
  }, [activeAdoProfileId, api]);

  async function loadStories(append = false) {
    if (!selectedIteration) return;
    setLoadingStories(true);
    onError('');
    try {
      const [page, taskboardItems] = await Promise.all([
        api.searchActiveStories(selectedIteration.id, append ? afterId : undefined),
        api.listSprintTaskboard(selectedIteration.id),
      ]);
      setTaskboardItems(taskboardItems);
      setStories((current) => {
        if (!append) return page.items;
        const seen = new Set(current.map(({ id }) => id));
        return [...current, ...page.items.filter(({ id }) => !seen.has(id))];
      });
      setAfterId(page.nextAfterId);
      if (!append) {
        setSelected(new Set());
        setChildrenByStory({});
        setExpanded(new Set());
        setWorkItemQuery('');
      }
      if (!page.items.length && !append) onNotice(`No active Requirements were found in “${selectedIteration.name}”.`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setLoadingStories(false);
    }
  }

  async function toggleChildren(story: WorkItemSnapshot) {
    if (expanded.has(story.id)) {
      setExpanded((current) => { const next = new Set(current); next.delete(story.id); return next; });
      return;
    }
    try {
      const children = childrenByStory[story.id] ?? await api.getChildren(story.id);
      setChildrenByStory((current) => ({ ...current, [story.id]: children.filter(({ kind }) => kind === 'TASK') }));
      setExpanded((current) => new Set(current).add(story.id));
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  function select(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function addSelected() {
    if (!selected.size) return;
    setSaving(true);
    onError('');
    try {
      const parentByTaskId = new Map(Object.entries(childrenByStory).flatMap(([parentId, children]) => (children ?? []).map(({ id }) => [id, Number(parentId)] as const)));
      const selections = [...selected].map((workItemId) => ({ workItemId, ...(parentByTaskId.has(workItemId) ? { parentId: parentByTaskId.get(workItemId)! } : {}) }));
      onQueueChanged(await api.addQueueItems(selections));
      onNotice(`Added ${selected.size} selected ${selected.size === 1 ? 'work item' : 'work items'} to the QA Queue.`);
      setSelected(new Set());
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const selectable = [...stories, ...Object.values(childrenByStory).flat()];
  const availableSelected = selectable.filter(({ id, organization, projectId }) => selected.has(id) && !queuedIds.has(`${organization.toLowerCase()}:${projectId}:${id}`));
  const query = workItemQuery.trim().toLocaleLowerCase('en-US');
  const matchesWorkItem = (item: WorkItemSnapshot) => !query || String(item.id).includes(query) || (item.title ?? '').toLocaleLowerCase('en-US').includes(query);
  const columnByTaskId = new Map(taskboardItems.map(({ workItemId, column }) => [workItemId, column.trim()]));
  const storyMatches = (story: WorkItemSnapshot) => matchesWorkItem(story);
  const taskMatches = (task: WorkItemSnapshot) => matchesWorkItem(task) && (!selectedColumns.size || selectedColumns.has(columnByTaskId.get(task.id) ?? ''));
  const visibleStories = stories.filter((story) => storyMatches(story) || (childrenByStory[story.id] ?? []).some(taskMatches));

  return <section className={`panel selection-panel sprint-picker${selected.size ? ' selection-active' : ''}`} aria-labelledby="sprint-picker-title">
    <div className="panel-title-row"><div><p className="eyebrow">SPRINT SCOPE</p><h2 id="sprint-picker-title">Active Stories by sprint</h2><p>Choose a sprint, browse its active Requirements, then select Stories and child Tasks for the QA Queue.</p></div>
      <button className="button outline" type="button" disabled={!activeAdoProfileId || loadingIterations} onClick={() => void refreshIterations()}>{loadingIterations ? 'Loading sprints…' : 'Refresh sprints'}</button></div>
    <>
      {!activeAdoProfileId ? <p className="field-help">Choose an organization and project to load this project’s sprints.</p> : null}
      <div className="sprint-controls"><div className="sprint-combobox"><label htmlFor="sprint-search">Sprint</label><input id="sprint-search" className="text-input" role="combobox" aria-label="Sprint" aria-autocomplete="list" aria-expanded={sprintOpen} aria-controls="sprint-options" aria-activedescendant={sprintOpen && activeSprintOption >= 0 && matchingIterations[activeSprintOption] ? `sprint-option-${matchingIterations[activeSprintOption]!.id}` : undefined} autoComplete="off" value={sprintOpen ? sprintQuery : selectedIteration?.name ?? ''} placeholder={iterations.length ? 'Search sprints…' : 'No sprints available'} disabled={loadingIterations} onFocus={(event) => { event.currentTarget.select(); setSprintQuery(''); setActiveSprintOption(-1); setSprintOpen(true); }} onBlur={() => { setSprintOpen(false); setSprintQuery(''); }} onChange={(event) => { setSprintQuery(event.target.value); setActiveSprintOption(-1); setSprintOpen(true); }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && matchingIterations.length) { event.preventDefault(); setSprintOpen(true); setActiveSprintOption((current) => current < 0 ? 0 : Math.min(current + 1, matchingIterations.length - 1)); }
        else if (event.key === 'ArrowUp' && matchingIterations.length) { event.preventDefault(); setSprintOpen(true); setActiveSprintOption((current) => current < 0 ? matchingIterations.length - 1 : Math.max(current - 1, 0)); }
        else if (event.key === 'Enter' && sprintOpen && matchingIterations.length) { event.preventDefault(); chooseIteration(matchingIterations[activeSprintOption] ?? matchingIterations[0]!); }
        else if (event.key === 'Escape' && sprintOpen) { event.preventDefault(); setSprintOpen(false); setSprintQuery(''); }
      }} />{sprintOpen ? <div className="sprint-options" id="sprint-options" role="listbox" aria-label="Matching sprints">{matchingIterations.length ? matchingIterations.map((iteration, index) => <div id={`sprint-option-${iteration.id}`} className={`sprint-option${index === activeSprintOption ? ' active' : ''}`} role="option" aria-selected={iteration.id === iterationId} key={iteration.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSprintOption(index)} onClick={() => chooseIteration(iteration)}><span>{iteration.name}{iteration.timeFrame === 'current' ? ' · Current' : ''}</span><small>{iteration.path}</small></div>) : <div className="sprint-no-options" role="status">{iterations.length ? 'No matching sprints.' : 'No sprints available for this project.'}</div>}</div> : null}</div>
        <button className="button primary" type="button" disabled={!selectedIteration || loadingStories} onClick={() => void loadStories()}>{loadingStories ? 'Loading Stories…' : 'Load active Stories'}</button>
      </div>
      <p className="field-help">Active includes Requirement types discovered from this project’s Azure DevOps categories. Done and removed items stay out of the list.</p>
      {stories.length ? <>
        <div className="sprint-filter-row"><label className="sprint-work-search">Filter Stories and Tasks<input className="text-input" type="search" role="searchbox" aria-label="Filter Stories and Tasks" placeholder="Search by ADO ID or name…" value={workItemQuery} onChange={(event) => setWorkItemQuery(event.target.value)} /><small>Search Stories and loaded Tasks by ID or name.</small></label>
          <details className="task-column-filter"><summary aria-label="Task columns">Task columns{selectedColumns.size ? <span className="task-column-count">{selectedColumns.size}</span> : null}</summary><div className="task-column-menu"><fieldset><legend>Filter Tasks by sprint column</legend>{taskColumns.length ? taskColumns.map((column) => <label key={column}><input type="checkbox" checked={selectedColumns.has(column)} onChange={(event) => setSelectedColumns((current) => { const next = new Set(current); if (event.target.checked) next.add(column); else next.delete(column); return next; })} />{column}</label>) : <p className="field-help">No taskboard columns were returned for this sprint.</p>}</fieldset>{selectedColumns.size ? <button className="text-button" type="button" onClick={() => setSelectedColumns(new Set())}>Clear column filters</button> : null}</div></details>
        </div>
        <div className="sprint-selection-toolbar"><span>{query ? `${visibleStories.length} of ${stories.length} Stories · ` : `${stories.length} Stories · `}{selected.size} selected</span></div>
        {visibleStories.length ? <div className="sprint-story-list">{visibleStories.map((story) => <article className="sprint-story" key={`${story.organization}:${story.projectId}:${story.id}`}>
          <label className="sprint-item-select"><input type="checkbox" aria-label={`Select #${story.id} ${story.title || 'Requirement'}`} checked={selected.has(story.id)} disabled={queuedIds.has(`${story.organization.toLowerCase()}:${story.projectId}:${story.id}`)} onChange={(event) => select(story.id, event.target.checked)} /><span><strong>#{story.id} · {story.title || 'Untitled Requirement'}</strong><small>{story.type} · {story.state}</small></span></label>
          {expanded.has(story.id) ? <><div className="sprint-task-list">{childrenByStory[story.id]?.length ? childrenByStory[story.id]!.filter((task) => (!query || storyMatches(story) || matchesWorkItem(task)) && (!selectedColumns.size || selectedColumns.has(columnByTaskId.get(task.id) ?? ''))).map((task) => {
            const column = columnByTaskId.get(task.id);
            return <label className="sprint-item-select" key={task.id}><input type="checkbox" aria-label={`Select #${task.id} ${task.title || 'Task'}`} checked={selected.has(task.id)} disabled={queuedIds.has(`${task.organization.toLowerCase()}:${task.projectId}:${task.id}`)} onChange={(event) => select(task.id, event.target.checked)} /><span><strong>#{task.id} · {task.title || 'Untitled Task'}</strong><small className="sprint-task-meta">Task · {task.state}<span className="sprint-task-column" aria-label={`Taskboard column: ${column ?? 'Not in selected sprint'}`}>{column ?? 'Not in selected sprint'}</span></small></span></label>;
          }) : <p className="field-help">{childrenByStory[story.id]?.length ? 'No child Tasks match the text and column filters.' : 'No child Tasks are linked to this Story in Azure DevOps.'}</p>}</div><button className="text-button sprint-hide-tasks" type="button" onClick={() => void toggleChildren(story)}>Hide Tasks</button></> : <button className="text-button" type="button" onClick={() => void toggleChildren(story)}>{childrenByStory[story.id] ? `Show ${childrenByStory[story.id]!.length} Tasks` : 'Load child Tasks'}</button>}
        </article>)}</div> : <p className="field-help" role="status">No Stories or loaded Tasks match “{workItemQuery}”.</p>}
        {afterId !== undefined ? <button className="button outline" type="button" disabled={loadingStories} onClick={() => void loadStories(true)}>{loadingStories ? 'Loading…' : 'Load more Stories'}</button> : null}
        {selected.size ? <div className="selection-footer" role="region" aria-label="QA Queue selection actions"><div className="selection-footer-inner"><span>{availableSelected.length} selected</span><button className="button primary" type="button" disabled={saving || !availableSelected.length} onClick={() => void addSelected()}>{saving ? 'Adding…' : `Add ${availableSelected.length || ''} selected to QA Queue`}</button></div></div> : null}
      </> : null}
    </>
  </section>;
}
