import { z } from 'zod';
import { AgentCompletionRequestSchema, type AgentCompletionRequest, type ModelProviderAdapter, providerJson, validateApiKey } from './provider.js';
import { ProviderModelSchema } from '@agentic-qa/domain/agent';

const OpenRouterModelsSchema = z.object({
  data: z.array(z.object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(300),
    context_length: z.number().int().positive().optional(),
    pricing: z.object({ prompt: z.string(), completion: z.string() }).passthrough(),
    supported_parameters: z.array(z.string()).max(200),
  }).passthrough()).max(2000),
}).passthrough();

function usdPerMillion(value: string): number | undefined {
  const dollarsPerToken = Number(value);
  if (!Number.isFinite(dollarsPerToken) || dollarsPerToken < 0) return undefined;
  return dollarsPerToken * 1_000_000;
}

export const openRouterAdapter: ModelProviderAdapter = {
  providerId: 'openrouter',
  async listModels(apiKey, fetcher = fetch) {
    validateApiKey(apiKey);
    const response = await fetcher('https://openrouter.ai/api/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
    });
    const result = OpenRouterModelsSchema.parse(await providerJson(response, 'OpenRouter'));
    return result.data.flatMap((model) => {
      const parameters = new Set(model.supported_parameters);
      const inputUsdPerMillionTokens = usdPerMillion(model.pricing.prompt);
      const outputUsdPerMillionTokens = usdPerMillion(model.pricing.completion);
      if (!parameters.has('tools') || !(parameters.has('response_format') || parameters.has('structured_outputs')) || inputUsdPerMillionTokens === undefined || outputUsdPerMillionTokens === undefined) return [];
      return [ProviderModelSchema.parse({
        providerId: 'openrouter', modelId: model.id, displayName: model.name,
        capabilities: {
          structuredOutput: true, toolUse: true,
          ...(model.context_length ? { contextTokens: model.context_length } : {}),
          inputUsdPerMillionTokens, outputUsdPerMillionTokens,
        },
      })];
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
  async complete<T>(apiKey: string, input: AgentCompletionRequest, fetcher: typeof fetch = fetch) {
    validateApiKey(apiKey);
    const request = AgentCompletionRequestSchema.parse({ modelId: input.modelId, system: input.system, input: input.input, maxOutputTokens: input.maxOutputTokens }) as AgentCompletionRequest;
    const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.input }],
        max_tokens: request.maxOutputTokens,
        response_format: { type: 'json_schema', json_schema: { name: 'agent_result', strict: true, schema: z.toJSONSchema(input.schema) } },
      }),
      redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(60_000),
    });
    const parsed = z.object({
      choices: z.array(z.object({ message: z.object({ content: z.string().max(1_000_000).nullable().optional() }).passthrough() }).passthrough()).max(10),
      usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).passthrough(),
    }).passthrough().parse(await providerJson(response, 'OpenRouter'));
    const text = parsed.choices[0]?.message.content;
    if (!text) throw new Error('OpenRouter returned no structured agent result.');
    let decoded: unknown;
    try { decoded = JSON.parse(text); } catch { throw new Error('OpenRouter returned invalid JSON for the agent result.'); }
    return { value: input.schema.parse(decoded) as T, inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens };
  },
};
