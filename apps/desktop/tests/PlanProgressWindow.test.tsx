// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanProgressWindow } from '../src/renderer/PlanProgressWindow.js';
import type { DesktopApi, ModelStreamEvent } from '../src/shared/ipc.js';

afterEach(cleanup);

describe('PlanProgressWindow', () => {
  it('subscribes before releasing queued events and renders status plus streamed model output', async () => {
    let listener: ((event: ModelStreamEvent) => void) | undefined;
    const readyPlanProgressWindow = vi.fn(async () => undefined);
    const api = {
      onModelStream: vi.fn((callback: (event: ModelStreamEvent) => void) => {
        listener = callback;
        return vi.fn();
      }),
      readyPlanProgressWindow,
    } as unknown as DesktopApi;
    const streamId = '77777777-7777-4777-8777-777777777777';

    render(<PlanProgressWindow api={api} streamId={streamId} />);

    expect(screen.getByRole('heading', { name: 'Plan agent progress' })).toBeTruthy();
    await waitFor(() => expect(readyPlanProgressWindow).toHaveBeenCalledWith(streamId));
    act(() => listener?.({ type: 'status', streamId, scope: 'planning', phase: 'work-item-synthesis', status: 'RUNNING', message: 'Plan agent is synthesizing selected work items.', at: new Date().toISOString() }));
    act(() => listener?.({ type: 'text', streamId, scope: 'planning', phase: 'work-item-synthesis', chunk: '{"featureSummary":"', at: new Date().toISOString() }));
    act(() => listener?.({ type: 'text', streamId: '88888888-8888-4888-8888-888888888888', scope: 'planning', phase: 'work-item-synthesis', chunk: 'wrong stream', at: new Date().toISOString() }));

    expect(screen.getByText('Plan agent is synthesizing selected work items.')).toBeTruthy();
    expect(screen.getByLabelText('Streaming model response').textContent).toContain('{"featureSummary":"');
    expect(screen.getByLabelText('Streaming model response').textContent).not.toContain('wrong stream');

    act(() => listener?.({ type: 'status', streamId, scope: 'planning', phase: 'plan-ready', status: 'COMPLETED', message: 'The Plan agent finished.' , at: new Date().toISOString() }));
    expect(screen.getByText('Ready')).toBeTruthy();
  });
});
