import { z } from 'zod';
import type { ProviderModel } from '@agentic-qa/domain/agent';
import { runClaudeCliCommand } from './claude-cli.js';
import { AgentCompletionRequestSchema, type AgentCompletionRequest, type ModelProviderAdapter } from './provider.js';

type CliRunner = (args: string[], input: string, timeoutMs?: number) => Promise<string>;
const CATALOG: ProviderModel[] = [
  { providerId: 'claude-code', modelId: 'sonnet', displayName: 'Claude Sonnet (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } },
  { providerId: 'claude-code', modelId: 'opus', displayName: 'Claude Opus (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20 } },
  { providerId: 'claude-code', modelId: 'haiku', displayName: 'Claude Haiku (subscription)', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5 } },
];
const CliResponseSchema = z.object({ result: z.string().max(1_000_000), usage: z.object({ input_tokens: z.number().int().nonnegative().optional(), output_tokens: z.number().int().nonnegative().optional() }).passthrough().optional() }).passthrough();

async function runClaudeCli(args: string[], input: string, timeoutMs = 120_000): Promise<string> {
  const result = await runClaudeCliCommand(args, input, { timeoutMs, maxOutputBytes: 5_000_000 });
  if (result.code !== 0) throw new Error(`Claude Code request failed (exit ${result.code}). Check the signed-in account, selected model access and plan limits.`);
  return result.output;
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
  try { raw = await runner(args, input, parsedRequest.maxOutputTokens === 8 ? 45_000 : undefined); } catch (error) { throw error instanceof Error ? error : new Error('Claude Code request failed.'); }
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

async function probe(runner: CliRunner, modelId: string, timeoutMs = 30_000): Promise<void> {
  const model = CATALOG.find(({ modelId: supportedId }) => supportedId === modelId);
  if (!model) throw new Error('The selected model is not in the Claude Code model catalog.');
  const raw = await runner([
    '--print', '--output-format', 'json', '--no-session-persistence', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{}', '--setting-sources', '', '--tools', '',
    '--permission-mode', 'dontAsk', '--model', model.modelId,
  ], 'Reply with OK.', timeoutMs);
  let decoded: unknown;
  try { decoded = JSON.parse(raw); }
  catch { throw new Error('Claude Code returned an invalid reachability response.'); }
  const response = CliResponseSchema.safeParse(decoded);
  if (!response.success || !response.data.result.trim()) throw new Error('Claude Code returned no text for the reachability prompt.');
}

function createAdapter(runner: CliRunner) {
  return {
    providerId: 'claude-code' as const,
    async listModels(_apiKey: string): Promise<ProviderModel[]> { return CATALOG.map((model) => structuredClone(model)); },
    async probe(_apiKey: string, modelId: string): Promise<void> { await probe(runner, modelId); },
    async discoverModels(): Promise<ProviderModel[]> {
      const results = await Promise.all(CATALOG.map(async (model) => {
        try {
          await probe(runner, model.modelId, 30_000);
          return structuredClone(model);
        } catch {
          // A model is shown only when the connected Claude Code account can use it.
          return undefined;
        }
      }));
      const available = results.filter((model): model is ProviderModel => model !== undefined);
      if (!available.length) throw new Error('No supported Claude models could be verified for this account. Check Claude Code sign-in and plan access, then try again.');
      return available;
    },
    complete<T>(_apiKey: string, request: AgentCompletionRequest) { return complete<T>(runner, request); },
  } satisfies ModelProviderAdapter;
}

export const claudeCodeAdapter = Object.assign(createAdapter(runClaudeCli), { withRunner: createAdapter });
