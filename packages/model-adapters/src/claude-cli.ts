import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

interface ClaudeCommand {
  executable: string;
  prefixArguments: string[];
  extraEnvironment?: Record<string, string>;
}

function environmentValue(name: string): string | undefined {
  const key = Object.keys(process.env).find((candidate) => candidate.toLocaleUpperCase('en-US') === name);
  return key ? process.env[key] : undefined;
}

function claudeEnvironment(): Record<string, string> {
  const allowed = ['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'CLAUDE_CODE_GIT_BASH_PATH'];
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = environmentValue(key);
    return value ? [[key, value] as const] : [];
  }));
}

async function isFile(path: string): Promise<boolean> {
  try { await access(path, constants.R_OK); return true; }
  catch { return false; }
}

async function resolveWindowsClaudeCommand(): Promise<ClaudeCommand> {
  const pathValue = environmentValue('PATH') ?? '';
  const directories = pathValue.split(';').map((value) => value.trim().replace(/^"|"$/g, '')).filter(Boolean);

  // Prefer the native CLI executable. It can be launched directly without a shell.
  for (const directory of directories) {
    const executable = join(directory, 'claude.exe');
    if (await isFile(executable)) return { executable, prefixArguments: [] };
  }

  // npm installs a .cmd shim, which Windows cannot launch with shell:false. Resolve
  // the standard global npm package entry point and run it with Electron's Node mode.
  for (const directory of directories) {
    const shim = join(directory, 'claude.cmd');
    if (!await isFile(shim)) continue;
    const entryPoint = join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (await isFile(entryPoint)) {
      return { executable: process.execPath, prefixArguments: [entryPoint], extraEnvironment: { ELECTRON_RUN_AS_NODE: '1' } };
    }
  }

  throw new Error('Claude Code could not be launched on Windows. Install the native Claude Code CLI or the global @anthropic-ai/claude-code npm package, then restart Agentic QA.');
}

async function resolveClaudeCommand(): Promise<ClaudeCommand> {
  if (process.platform === 'win32') return resolveWindowsClaudeCommand();
  return { executable: 'claude', prefixArguments: [] };
}

export async function runClaudeCliCommand(
  args: string[],
  input: string,
  options: { timeoutMs: number; maxOutputBytes?: number; captureStderr?: boolean; onStdout?: (chunk: string) => void },
): Promise<{ code: number; output: string; errorOutput: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'agentic-qa-claude-'));
  try {
    const command = await resolveClaudeCommand();
    const env = { ...claudeEnvironment(), ...command.extraEnvironment };
    return await new Promise((resolve, reject) => {
      const child = spawn(command.executable, [...command.prefixArguments, ...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let errorOutput = '';
      let settled = false;
      let timedOut = false;
      const finish = (error?: Error, code = 1) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve({ code, output, errorOutput });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
      }, options.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        output += text;
        try { options.onStdout?.(text); } catch { /* UI streaming must not interrupt model completion. */ }
        if (Buffer.byteLength(output) > (options.maxOutputBytes ?? 32_000)) {
          child.kill('SIGTERM');
          finish(new Error('Claude Code response exceeded its output limit.'));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (options.captureStderr) errorOutput = (errorOutput + chunk.toString('utf8')).slice(-2_000);
      });
      child.on('error', () => finish(new Error('Claude Code could not be started. Install Claude Code and restart Agentic QA.')));
      child.on('close', (code) => {
        if (timedOut) finish(new Error(`Claude Code did not complete within ${Math.ceil(options.timeoutMs / 1000)} seconds.`));
        else finish(undefined, code ?? 1);
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}
