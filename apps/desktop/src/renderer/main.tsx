import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { PlanProgressWindow } from './PlanProgressWindow.js';
import './styles.css';
import './run.css';
import './results.css';
import './reports.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
const streamId = new URLSearchParams(window.location.search).get('planProgress');
const validStreamId = streamId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(streamId) ? streamId : undefined;
createRoot(root).render(<StrictMode>{validStreamId ? <PlanProgressWindow api={window.qa} streamId={validStreamId} /> : <App api={window.qa} />}</StrictMode>);
