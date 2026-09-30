import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { anthropicAdapter } from '../src/anthropic.js';
import { openAiAdapter } from '../src/openai.js';
import { openRouterAdapter } from '../src/openrouter.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('provider adapters', () => {
  it('lists only supported OpenAI agent models from the account model list', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6-sol' }, { id: 'text-embedding-3-small' }] }));
    const models = await openAiAdapter.listModels('sk-test-key-with-sufficient-length', fetcher as typeof fetch);
    expect(models.map(({ modelId }) => modelId)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(models[0]?.capabilities.inputUsdPerMillionTokens).toBe(0.1);
  });

  it('uses Anthropic model capability metadata and bounded pagination', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', max_input_tokens: 1000000, capabilities: { structured_outputs: { supported: true } } }], has_more: true, last_id: 'claude-sonnet-5-5' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', capabilities: { structured_outputs: { supported: true } } }, { id: 'claude-unknown', display_name: 'Unknown', capabilities: { structured_outputs: { supported: false } } }], has_more: false, last_id: 'end' }));
    const models = await anthropicAdapter.listModels('anthropic-test-key-with-sufficient-length', fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(models.map(({ modelId }) => modelId)).toEqual(['claude-sonnet-5-5']);
    expect(models[0]?.capabilities.contextTokens).toBe(1_000_000);
    expect(models[0]?.capabilities.outputUsdPerMillionTokens).toBe(10);
  });

  it('validates OpenAI structured output and reports token usage', async () => {
    const schema = z.object({ plan: z.string() }).strict();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { store: boolean; text: { format: { type: string; strict: boolean } } };
      expect(body.store).toBe(false);
      expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
      return jsonResponse({ output_text: '{"plan":"delegate"}', usage: { input_tokens: 75, output_tokens: 12 } });
    });
    const result = await openAiAdapter.complete('sk-test-key-with-sufficient-length', { modelId: 'gpt-6-luna', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100, schema }, fetcher as typeof fetch);
    expect(result).toEqual({ value: { plan: 'delegate' }, inputTokens: 75, outputTokens: 12 });
  });

  it('uses the Anthropic Messages endpoint and validates structured output', async () => {
    const schema = z.object({ plan: z.string() }).strict();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('anthropic-version')).toBe('2023-06-01');
      const body = JSON.parse(String(init?.body)) as { output_config: { format: { type: string } }; max_tokens: number };
      expect(body.output_config.format.type).toBe('json_schema');
      return jsonResponse({ content: [{ type: 'text', text: '{"plan":"delegate"}' }], usage: { input_tokens: 70, output_tokens: 9 } });
    });
    const result = await anthropicAdapter.complete('anthropic-test-key-with-sufficient-length', { modelId: 'claude-sonnet-5-5', system: 'Act as the QA planner.', input: 'Plan this work.', maxOutputTokens: 100, schema }, fetcher as typeof fetch);
    expect(result).toEqual({ value: { plan: 'delegate' }, inputTokens: 70, outputTokens: 9 });
  });

  it('rejects provider failure and malformed structured output without leaking response text', async () => {
    await expect(openAiAdapter.listModels('sk-test-key-with-sufficient-length', async () => jsonResponse({ message: 'secret-shaped provider output' }, 401) as Response)).rejects.toThrow('HTTP 401');
    await expect(anthropicAdapter.complete('anthropic-test-key-with-sufficient-length', { modelId: 'claude-sonnet-5-5', system: 'system', input: 'input', maxOutputTokens: 100, schema: z.object({ plan: z.string() }) }, async () => jsonResponse({ content: [], usage: { input_tokens: 0, output_tokens: 0 } }) as Response)).rejects.toThrow('no structured agent result');
  });

  it('lists only OpenRouter models with reported prices, tool use and structured outputs', async () => {
    const fetcher = async () => jsonResponse({ data: [
      { id: 'anthropic/claude-sonnet-latest', name: 'Claude Sonnet', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools', 'response_format'] },
      { id: 'vendor/basic', name: 'Basic', pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] },
    ] });
    const models = await openRouterAdapter.listModels('openrouter-test-key-with-sufficient-length', fetcher as typeof fetch);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelId: 'anthropic/claude-sonnet-latest', providerId: 'openrouter', capabilities: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15, toolUse: true, structuredOutput: true } });
  });

  it('sends OpenRouter structured requests to its fixed HTTPS endpoint', async () => {
    const schema = z.object({ plan: z.string() }).strict();
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init?.redirect).toBe('error');
      return jsonResponse({ choices: [{ message: { content: '{"plan":"delegate"}' } }], usage: { prompt_tokens: 80, completion_tokens: 25 } });
    });
    const result = await openRouterAdapter.complete('openrouter-test-key-with-sufficient-length', { modelId: 'anthropic/claude-sonnet-latest', system: 'system', input: 'input', maxOutputTokens: 100, schema }, fetcher as typeof fetch);
    expect(result).toEqual({ value: { plan: 'delegate' }, inputTokens: 80, outputTokens: 25 });
  });
});
