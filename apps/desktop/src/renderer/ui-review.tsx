import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createUiReviewFixture } from './ui-review-api.js';
import './styles.css';
import './run.css';
import './results.css';
import './reports.css';

const root = document.getElementById('root');
if (!root) throw new Error('UI review root is missing.');

const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'workspace';
const fixture = createUiReviewFixture(scenario);
createRoot(root).render(<StrictMode><App api={fixture.api} initialState={fixture.state} /></StrictMode>);
