import { describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from '../src/main/ipc.js';

function fixture() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const ipc = {
    handle: vi.fn((channel: string, listener: (...args: any[]) => unknown) => handlers.set(channel, listener)),
    removeHandler: vi.fn(),
  };
  const api = {
    getState: vi.fn(async () => ({ queue: [] })),
    saveAdoProfile: vi.fn(async () => ({ queue: [] })),
    listOrganizations: vi.fn(async () => []),
    listProfileIterations: vi.fn(async () => []),
    listSprintTaskboard: vi.fn(async () => []),
    listAdoTeams: vi.fn(async () => []),
    searchActiveStories: vi.fn(async () => ({ items: [] })),
    addQueueItems: vi.fn(async () => ({ queue: [] })),
    exportAdoProfilesConfig: vi.fn(async () => true),
  } as any;
  const dispose = registerIpcHandlers(ipc, api, { devServerUrl: 'http://127.0.0.1:5173/' });
  return { handlers, api, dispose, ipc };
}

describe('validated desktop IPC', () => {
  it('rejects untrusted sender origins before dispatch', async () => {
    const { handlers, api } = fixture();
    await expect(handlers.get('qa:get-state')!({ senderFrame: { url: 'https://attacker.example/' } })).rejects.toThrow('Untrusted');
    expect(api.getState).not.toHaveBeenCalled();
  });

  it('rejects unexpected payload arguments and registers a fixed channel set', async () => {
    const { handlers, api, ipc } = fixture();
    await expect(handlers.get('qa:get-state')!({ senderFrame: { url: 'http://127.0.0.1:5173/' } }, 'extra')).rejects.toThrow();
    expect(api.getState).not.toHaveBeenCalled();
    expect(ipc.handle).toHaveBeenCalledTimes(54);
    expect([...handlers.keys()]).toContain('qa:generate-model-suggestions');
    expect([...handlers.keys()]).toContain('qa:list-git-repositories');
    expect([...handlers.keys()]).toContain('qa:save-work-item-type-mapping');
    expect([...handlers.keys()]).toContain('qa:export-artifact');
    expect([...handlers.keys()]).toContain('qa:get-artifact-preview');
    expect([...handlers.keys()]).toContain('qa:get-run-progress');
    expect([...handlers.keys()]).toContain('qa:save-repository-config-draft');
    expect([...handlers.keys()]).toContain('qa:get-repository-config-draft');
    expect([...handlers.keys()]).toContain('qa:list-organizations');
    expect([...handlers.keys()]).toContain('qa:list-sprint-taskboard');
    expect([...handlers.keys()]).not.toContain('qa:save-client-id');
    await expect(handlers.get('qa:list-git-refs')!({ senderFrame: { url: 'http://127.0.0.1:5173/' } }, '../invalid')).rejects.toThrow();
  });

  it('discovers organizations only from a trusted renderer', async () => {
    const { handlers, api } = fixture();
    await expect(handlers.get('qa:list-organizations')!({ senderFrame: { url: 'https://attacker.example/' } })).rejects.toThrow('Untrusted');
    await expect(handlers.get('qa:list-organizations')!({ senderFrame: { url: 'http://127.0.0.1:5173/' } })).resolves.toEqual([]);
    expect(api.listOrganizations).toHaveBeenCalledOnce();
  });

  it('validates sprint browsing and bounded bulk queue payloads before dispatch', async () => {
    const { handlers, api } = fixture();
    const sender = { senderFrame: { url: 'http://127.0.0.1:5173/' } };
    await expect(handlers.get('qa:search-active-stories')!(sender, 'bad-iteration')).rejects.toThrow();
    expect(api.searchActiveStories).not.toHaveBeenCalled();
    await expect(handlers.get('qa:add-queue-items')!(sender, [])).rejects.toThrow();
    await expect(handlers.get('qa:add-queue-items')!(sender, Array(201).fill({ workItemId: 1 }))).rejects.toThrow();
    await expect(handlers.get('qa:add-queue-items')!(sender, [{ workItemId: 1, parentId: 2, arbitrary: true }])).rejects.toThrow();
    expect(api.addQueueItems).not.toHaveBeenCalled();
    await expect(handlers.get('qa:list-profile-iterations')!(sender)).resolves.toEqual([]);
    await expect(handlers.get('qa:list-sprint-taskboard')!(sender, 'bad-iteration')).rejects.toThrow();
    expect(api.listSprintTaskboard).not.toHaveBeenCalled();
    await expect(handlers.get('qa:list-sprint-taskboard')!(sender, '11111111-1111-4111-8111-111111111111')).resolves.toEqual([]);
    await expect(handlers.get('qa:list-ado-teams')!(sender, { organization: 'org', project: { name: 'Project' } })).resolves.toEqual([]);
    await expect(handlers.get('qa:export-ado-profiles-config')!(sender)).resolves.toBe(true);
  });

  it('accepts a blank taskboard column for sprint based profile selection', async () => {
    const { handlers, api } = fixture();
    const sender = { senderFrame: { url: 'http://127.0.0.1:5173/' } };
    const profile = { name: 'Derse QA', organization: 'Xorbix', project: { id: 'project-1', name: 'Derse' }, team: 'Derse Team', boardColumn: '', storyIds: [] };
    await expect(handlers.get('qa:save-ado-profile')!(sender, profile)).resolves.toEqual({ queue: [] });
    expect(api.saveAdoProfile).toHaveBeenCalledWith(profile);
  });
});
