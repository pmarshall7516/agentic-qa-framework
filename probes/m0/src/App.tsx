export interface RuntimeInfo {
  shell: string;
  appVersion: string;
  platform: string;
  arch: string;
}

const gates = [
  'Entra sign-in and ADO read',
  'Encrypted local storage',
  'Repository worker isolation',
  'Windows package launch',
];

function friendlyPlatform(platform: string, arch: string): string {
  const osName =
    platform === 'darwin'
      ? 'macOS'
      : platform === 'win32'
        ? 'Windows'
        : platform;
  return `${osName} ${arch}`;
}

export function App({ runtime }: { runtime: RuntimeInfo | null }) {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">AQ</div>
        <div className="brand-copy">
          <strong>Agentic QA</strong>
          <span>Local feasibility probe</span>
        </div>
        <span className="status-pill"><i />Probe build</span>
      </header>

      <section className="intro">
        <p className="eyebrow">MILESTONE 0 · PLATFORM AND SECURITY</p>
        <h1>Agentic QA feasibility probe</h1>
        <p className="description">
          Validate the desktop shell and local execution boundary before product
          runs can use your Azure DevOps data or repositories.
        </p>
      </section>

      <section className="runtime-card" aria-label="Runtime details">
        <div>
          <span className="label">Desktop shell</span>
          <strong>{runtime?.shell ?? 'Loading…'}</strong>
        </div>
        <div>
          <span className="label">Host runtime</span>
          <strong>
            {runtime
              ? friendlyPlatform(runtime.platform, runtime.arch)
              : 'Loading…'}
          </strong>
        </div>
        <div>
          <span className="label">Probe version</span>
          <strong>{runtime?.appVersion ?? 'Loading…'}</strong>
        </div>
      </section>

      <section className="gates" aria-labelledby="gate-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RELEASE GATES</p>
            <h2 id="gate-heading">Evidence still required</h2>
          </div>
          <span className="not-run-count">{gates.length} not run</span>
        </div>
        <ul>
          {gates.map((gate) => (
            <li key={gate}>
              <span className="gate-dot" aria-hidden="true" />
              <span>{gate}</span>
              <span className="not-run">Not run</span>
            </li>
          ))}
        </ul>
      </section>

      <footer>
        No credentials or repository content are read by this probe screen.
      </footer>
    </main>
  );
}
