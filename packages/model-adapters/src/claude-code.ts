import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ProviderModel } from '@agentic-qa/domain/agent';
import { AgentCompletionRequestSchema, type AgentCompletionRequest, type ModelProviderAdapter } from './provider.js';

type CliRunner = (args: string[], input: string) => Promise<string>;
const CATALOG: ProviderModel[] = [
  { providerId: 'claude-code', modelId: 'sonnet', displayName: 'Claude Sonnet (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } },
  { providerId: 'claude-code', modelId: 'opus', displayName: 'Claude Opus (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 } },
  { providerId: 'claude-code', modelId: 'haiku', displayName: 'Claude Haiku (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 } },
];
const CliResponseSchema = z.object({ result: z.string().max(1_000_000), usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).passthrough().optional() }).passthrough();

async function runClaudeCli(args: string[], input: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'agentic-qa-claude-'));
  try {
    const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'TEMP', 'TMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!] as const] : []));
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      let stdout = '';
      let settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(stdout); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1000).unref(); finish(new Error('Claude Code did not complete within the 120 second limit.')); }, 120_000);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); if (Buffer.byteLength(stdout) > 5_000_000) { child.kill('SIGTERM'); finish(new Error('Claude Code response exceeded the 5 MB limit.')); } });
      child.on('error', () => finish(new Error('Claude Code CLI is unavailable. Install Claude Code and connect a Claude plan account.')));
      child.on('close', (code) => code === 0 ? finish() : finish(new Error(`Claude Code request failed (exit ${code ?? 'unknown'}). Check the signed-in account, selected model access and plan limits.`)));
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

function requestInput(request: AgentCompletionRequest): string {
  return `${request.system}\n\nKeep the response within ${request.maxOutputTokens} output tokens. Return exactly one JSON object that conforms to the requested result shape. Do not include markdown fences or commentary.\n\n${request.input}`;
}

async function complete<T>(runner: CliRunner, request: AgentCompletionRequest): Promise<{ value: T; inputTokens: number; outputTokens: number }> {
  const parsedRequest = AgentCompletionRequestSchema.parse({ modelId: request.modelId, system: request.system, input: request.input, maxOutputTokens: request.maxOutputTokens });
  const model = CATALOG.find(({ modelId }) => modelId === parsedRequest.modelId);
  if (!model) throw new Error('The selected model is not in the Claude Code model catalog.');
  const input = requestInput({ ...parsedRequest, schema: request.schema });
  if (Buffer.byteLength(input) > 1_000_000) throw new Error('Claude Code prompt exceeded the 1 MB limit.');
  let outputSchema: string;
  try { outputSchema = JSON.stringify(z.toJSONSchema(request.schema)); }
  catch { throw new Error('The requested Claude Code result schema cannot be represented as JSON Schema.'); }
  if (Buffer.byteLength(outputSchema) > 24_000) throw new Error('Claude Code result schema exceeded the safe CLI argument limit.');
  const args = [
    '--print', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{}', '--setting-sources', '', '--tools', '',
    '--permission-mode', 'dontAsk', '--model', model.modelId, '--json-schema', outputSchema,
  ];
  let raw: string;
  try { raw = await runner(args, input); } catch (error) { throw error instanceof Error ? error : new Error('Claude Code request failed.'); }
  let response: z.infer<typeof CliResponseSchema>;
  try { response = CliResponseSchema.parse(JSON.parse(raw)); }
  catch { throw new Error('Claude Code returned an invalid structured result.'); }
  let value: unknown;
  try { value = JSON.parse(response.result); }
  catch { throw new Error('Claude Code returned an invalid structured result.'); }
  const validated = request.schema.safeParse(value);
  if (!validated.success) throw new Error('Claude Code returned a structured result that did not match the requested schema.');
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  if (outputTokens > parsedRequest.maxOutputTokens) throw new Error('Claude Code response exceeded the requested output-token budget.');
  return { value: validated.data as T, inputTokens, outputTokens };
}

function createAdapter(runner: CliRunner) {
  return {
    providerId: 'claude-code' as const,
    async listModels(_apiKey: string): Promise<ProviderModel[]> { return CATALOG.map((model) => structuredClone(model)); },
    complete<T>(_apiKey: string, request: AgentCompletionRequest) { return complete<T>(runner, request); },
  } satisfies ModelProviderAdapter;
}

export const claudeCodeAdapter = Object.assign(createAdapter(runClaudeCli), { withRunner: createAdapter });
