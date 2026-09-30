import { z } from 'zod';
import { AgentCompletionRequestSchema, type AgentCompletionRequest, type ModelProviderAdapter, modelResponseSchema, normalizedModel, providerJson, validateApiKey } from './provider.js';
import type { ProviderModel } from '@agentic-qa/domain/agent';

const ANTHROPIC_MODEL_PRICES = new Map([
  ['claude-sonnet-5-5', { input: 2, output: 10 }],
  ['claude-opus-5-5', { input: 4, output: 20 }],
  ['claude-fable-5-1', { input: 10, output: 50 }],
  ['claude-haiku-4-5-20251001', { input: 1, output: 5 }],
]);

const CapabilitySchema = z.object({ supported: z.boolean().optional() }).passthrough().nullable().optional();
const AnthropicModelSchema = z.object({
  id: z.string().min(1).max(200), display_name: z.string().min(1).max(200), max_input_tokens: z.number().int().nonnegative().nullable().optional(),
  capabilities: z.object({ structured_outputs: CapabilitySchema }).passthrough().nullable().optional(),
}).passthrough();
const AnthropicModelListSchema = modelResponseSchema(AnthropicModelSchema);

export const anthropicAdapter: ModelProviderAdapter = {
  providerId: 'anthropic',
  async listModels(apiKey, fetcher = fetch) {
    validateApiKey(apiKey);
    const models: ProviderModel[] = [];
    const seen = new Set<string>();
    let afterId: string | undefined;
    for (let page = 0; page < 20; page++) {
      const url = new URL('https://api.anthropic.com/v1/models');
      url.searchParams.set('limit', '100');
      if (afterId) url.searchParams.set('after_id', afterId);
      const response = await fetcher(url, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
      });
      const parsed = AnthropicModelListSchema.parse(await providerJson(response, 'Anthropic'));
      for (const model of parsed.data) {
        const structuredOutput = model.capabilities?.structured_outputs?.supported === true;
        const price = ANTHROPIC_MODEL_PRICES.get(model.id);
        if (!structuredOutput || !price || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(normalizedModel({
          providerId: 'anthropic', modelId: model.id, displayName: model.display_name,
          capabilities: {
            structuredOutput, toolUse: true,
            ...(model.max_input_tokens && model.max_input_tokens > 0 ? { contextTokens: model.max_input_tokens } : {}),
            inputUsdPerMillionTokens: price.input, outputUsdPerMillionTokens: price.output,
          },
        }));
      }
      if (!parsed.has_more) break;
      if (!parsed.last_id || parsed.last_id === afterId) throw new Error('Anthropic model discovery returned an invalid pagination cursor.');
      afterId = parsed.last_id;
      if (page === 19) throw new Error('Anthropic model discovery exceeded the pagination limit.');
    }
    return models;
  },
  async complete<T>(apiKey: string, input: AgentCompletionRequest, fetcher: typeof fetch = fetch) {
    validateApiKey(apiKey);
    const request = AgentCompletionRequestSchema.parse({ modelId: input.modelId, system: input.system, input: input.input, maxOutputTokens: input.maxOutputTokens }) as AgentCompletionRequest;
    const response = await fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId, max_tokens: request.maxOutputTokens, system: request.system,
        messages: [{ role: 'user', content: request.input }],
        output_config: { format: { type: 'json_schema', schema: z.toJSONSchema(input.schema) } },
      }),
      redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60_000),
    });
    const parsed = z.object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).max(100),
      usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
    }).passthrough().parse(await providerJson(response, 'Anthropic'));
    const text = parsed.content.filter(({ type }) => type === 'text').map(({ text }) => text ?? '').join('');
    if (!text) throw new Error('Anthropic returned no structured agent result.');
    let decoded: unknown;
    try { decoded = JSON.parse(text); } catch { throw new Error('Anthropic returned invalid JSON for the agent result.'); }
    return { value: input.schema.parse(decoded) as T, inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens };
  },
};
