import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import viteConfig from '../vite.config';

describe('M0 probe screen', () => {
  it('uses relative asset URLs so packaged file URLs load bundled assets', () => {
    expect(viteConfig.base).toBe('./');
  });

  it('shows runtime identity and makes no claim about unrun gates', () => {
    const markup = renderToStaticMarkup(
      <App
        runtime={{
          shell: 'Electron',
          appVersion: '0.1.0',
          platform: 'darwin',
          arch: 'arm64',
        }}
      />,
    );

    expect(markup).toContain('Agentic QA feasibility probe');
    expect(markup).toContain('Electron');
    expect(markup).toContain('macOS arm64');
    expect(markup).toContain('Not run');
  });
});
