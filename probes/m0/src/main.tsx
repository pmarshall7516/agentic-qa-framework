import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, type RuntimeInfo } from './App';
import './styles.css';

declare global {
  interface Window {
    probe?: {
      getRuntimeInfo: () => Promise<RuntimeInfo>;
    };
  }
}

const root = createRoot(document.getElementById('root')!);
root.render(<App runtime={null} />);

if (window.probe) {
  void window.probe.getRuntimeInfo().then((runtime) => {
    root.render(<App runtime={runtime} />);
  });
}
