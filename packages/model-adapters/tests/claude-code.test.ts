import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { StructuredOutputValidationError } from '../src/provider.js';
import { claudeCodeAdapter } from '../src/claude-code.js';

describe('Claude Code subscription adapter', () => {
  it('offers curated searchable Claude Code model aliases without an API key', async () => {
    const models = await claudeCodeAdapter.listModels('');
    expect(models.map(({ modelId }) => modelId)).toEqual(['sonnet', 'opus', 'haiku']);
    expect(models.every(({ providerId, capabilities }) => providerId === 'claude-code' && capabilities.structuredOutput && capabilities.toolUse)).toBe(true);
  });

  it('runs a stateless tool-free structured completion through the signed-in CLI', async () => {
    const runCli = vi.fn(async (args: string[], input: string) => {
      expect(args).toContain('--no-session-persistence');
      expect(args).toContain('--strict-mcp-config');
      expect(args).not.toContain('--mcp-config');
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
      expect(args[args.indexOf('--tools') + 1]).toBe('');
      expect(args).toContain('--tools');
      expect(args).toContain('');
      expect(args).toContain('--setting-sources');
      expect(args).toContain('');
      expect(args).toContain('--model');
      expect(input).toContain('Plan this work.');
      return JSON.stringify({ result: '{"plan":"delegate"}', usage: { input_tokens: 45, output_tokens: 8 } });
    });
    const adapter = claudeCodeAdapter.withRunner(runCli);
    const result = await adapter.complete('', { modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100, schema: z.object({ plan: z.string() }).strict() });
    expect(result).toEqual({ value: { plan: 'delegate' }, inputTokens: 45, outputTokens: 8 });
  });

  it('honors the longer planning timeout and accepts the raised output ceiling', async () => {
    const runCli = vi.fn(async (_args: string[], _input: string, timeoutMs?: number) => {
      expect(timeoutMs).toBe(600_000);
      return JSON.stringify({ result: '{"plan":"complete"}', usage: { input_tokens: 45, output_tokens: 40_000 } });
    });
    const adapter = claudeCodeAdapter.withRunner(runCli);

    await expect(adapter.complete('', {
      modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 64_000,
      timeoutMs: 600_000, schema: z.object({ plan: z.string() }).strict(),
    })).resolves.toMatchObject({ value: { plan: 'complete' }, outputTokens: 40_000 });
  });

  it('accepts Claude Code structured_output results and streams assistant text deltas', async () => {
    const streamed: string[] = [];
    const runCli = vi.fn(async (args: string[], _input: string, _timeout: number | undefined, onStdout?: (chunk: string) => void) => {
      expect(args).toContain('stream-json');
      expect(args).toContain('--include-partial-messages');
      onStdout?.(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"plan":' } } })}\n`);
      onStdout?.(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '"delegate"}' } } })}\n`);
      return `${JSON.stringify({ type: 'result', is_error: false, structured_output: { plan: 'delegate' }, usage: { input_tokens: 45, output_tokens: 8 } })}\n`;
    });
    const adapter = claudeCodeAdapter.withRunner(runCli);
    const result = await adapter.complete('', {
      modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100,
      schema: z.object({ plan: z.string() }).strict(), onText: (chunk) => streamed.push(chunk),
    });

    expect(result.value).toEqual({ plan: 'delegate' });
    expect(streamed.join('')).toBe('{"plan":"delegate"}');
  });

  it('uses completed structured tool JSON when Claude Code omits structured_output from the final result', async () => {
    const streamed: string[] = [];
    const adapter = claudeCodeAdapter.withRunner(async (_args, _input, _timeout, onStdout) => {
      onStdout?.(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"plan":' } } })}\n`);
      onStdout?.(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"delegate"}' } } })}\n`);
      return `${JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: null })}\n`;
    });

    await expect(adapter.complete('', {
      modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100,
      schema: z.object({ plan: z.string() }).strict(), onText: (chunk) => streamed.push(chunk),
    })).resolves.toMatchObject({ value: { plan: 'delegate' } });
    expect(streamed.join('')).toBe('{"plan":"delegate"}');
  });

  it('recovers schema-valid JSON returned inside Claude Code markdown result text', async () => {
    const adapter = claudeCodeAdapter.withRunner(async () => JSON.stringify({
      type: 'result', is_error: false,
      result: 'Here is the plan:\n```json\n{"plan":"delegate"}\n```',
      structured_output: null,
    }));

    await expect(adapter.complete('', {
      modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100,
      schema: z.object({ plan: z.string() }).strict(),
    })).resolves.toMatchObject({ value: { plan: 'delegate' } });
  });

  it('keeps schema-invalid JSON available for the Plan agent correction attempt', async () => {
    const adapter = claudeCodeAdapter.withRunner(async () => JSON.stringify({
      type: 'result', is_error: false, result: '{"featureSummary":"Wrong shape"}', structured_output: null,
    }));

    await expect(adapter.complete('', {
      modelId: 'sonnet', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100,
      schema: z.object({ featureSummary: z.string(), proposals: z.array(z.unknown()) }).strict(),
    })).rejects.toMatchObject({
      name: 'StructuredOutputValidationError',
      candidate: { featureSummary: 'Wrong shape' },
      issues: expect.arrayContaining([expect.objectContaining({ path: 'proposals', message: expect.any(String) })]),
    });
  });

  it('rejects invalid model ids and malformed or schema-invalid CLI results', async () => {
    await expect(claudeCodeAdapter.complete('', { modelId: 'custom-shell-command', system: 'system', input: 'input', maxOutputTokens: 100, schema: z.object({ plan: z.string() }) })).rejects.toThrow('not in the Claude Code model catalog');
    const malformed = claudeCodeAdapter.withRunner(async () => '{"result":"not-json"}');
    await expect(malformed.complete('', { modelId: 'sonnet', system: 'system', input: 'input', maxOutputTokens: 100, schema: z.object({ plan: z.string() }) })).rejects.toThrow(/JSON result|structured result/i);
  });

  it('does not treat a Claude CLI error envelope as a reachable account model', async () => {
    const errorResponse = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
    });
    const adapter = claudeCodeAdapter.withRunner(async () => errorResponse);

    await expect(adapter.discoverModels()).rejects.toThrow(/Claude Code says this CLI is not signed in/i);
  });

  it('reports an error envelope with an empty result as a CLI error instead of a blank response', async () => {
    const errorResponse = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: '' });
    const adapter = claudeCodeAdapter.withRunner(async () => errorResponse);

    await expect(adapter.probe('', 'haiku')).rejects.toThrow(/Claude Code returned an error instead of a model response/i);
  });

  it('lists only models that return a non-error prompt response for the connected account', async () => {
    const runCli = vi.fn(async (args: string[]) => {
      const modelId = args[args.indexOf('--model') + 1];
      return JSON.stringify(modelId === 'haiku'
        ? { type: 'result', subtype: 'success', is_error: false, result: 'OK' }
        : { type: 'result', subtype: 'success', is_error: true, result: 'This account cannot access that model.' });
    });
    const adapter = claudeCodeAdapter.withRunner(runCli);

    const models = await adapter.discoverModels();

    expect(models.map(({ modelId }) => modelId)).toEqual(['haiku']);
    expect(runCli).toHaveBeenCalledTimes(3);
  });

  it('keeps model prompts isolated without passing an empty MCP config that stalls Claude Code', async () => {
    const runCli = vi.fn(async (args: string[]) => {
      expect(args).toContain('--strict-mcp-config');
      expect(args).not.toContain('--mcp-config');
      expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
      expect(args[args.indexOf('--tools') + 1]).toBe('');
      return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'OK' });
    });
    const adapter = claudeCodeAdapter.withRunner(runCli);

    await adapter.probe('', 'haiku');
  });
});
