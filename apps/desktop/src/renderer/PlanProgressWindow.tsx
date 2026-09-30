import { useEffect, useState } from 'react';
import type { DesktopApi, ModelStreamEvent } from '../shared/ipc.js';

export function PlanProgressWindow({ api, streamId }: { api: DesktopApi; streamId: string }) {
  const [status, setStatus] = useState<'RUNNING' | 'COMPLETED' | 'FAILED'>('RUNNING');
  const [message, setMessage] = useState('Connecting to the Plan agent…');
  const [phase, setPhase] = useState('Plan preparation');
  const [response, setResponse] = useState('');

  useEffect(() => {
    const unsubscribe = api.onModelStream((event: ModelStreamEvent) => {
      if (event.streamId !== streamId) return;
      if (event.type === 'status') {
        setStatus(event.status);
        setPhase(event.phase);
        setMessage(event.message);
      } else {
        setPhase(event.phase);
        setResponse((current) => `${current}${event.chunk}`.slice(-60_000));
      }
    });
    void api.readyPlanProgressWindow(streamId);
    return unsubscribe;
  }, [api, streamId]);

  return <main className="plan-progress-window">
    <header className="plan-progress-header">
      <p className="eyebrow">AGENTIC QA · PLAN AGENT</p>
      <h1>Plan agent progress</h1>
      <p>The selected saved model is preparing your QA plan.</p>
    </header>
    <section className={`plan-progress-status status-${status.toLowerCase()}`} aria-live="polite">
      <span className="plan-progress-indicator" aria-hidden="true" />
      <div><strong>{message}</strong><small>{phase.replaceAll('-', ' ')}</small></div>
      <span className="plan-progress-state">{status === 'RUNNING' ? 'In progress' : status === 'COMPLETED' ? 'Ready' : 'Needs attention'}</span>
    </section>
    <section className="plan-progress-output" aria-label="Streaming model response">
      <div className="plan-progress-output-title"><h2>Model response</h2><span>{response ? 'Streaming' : 'Waiting for response text'}</span></div>
      <pre aria-live="off">{response || 'The Plan agent response will appear here as it arrives.'}</pre>
    </section>
    <p className="plan-progress-footer">This window can stay open while you review the plan in Agentic QA.</p>
  </main>;
}
