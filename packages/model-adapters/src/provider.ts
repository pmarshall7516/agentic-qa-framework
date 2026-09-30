import { z } from 'zod';
import { ProviderModelSchema, type ProviderModel } from '@agentic-qa/domain/agent';

export const AgentCompletionRequestSchema = z.object({
  modelId: z.string().min(1).max(200),
  system: z.string().min(1).max(20_000),
  input: z.string().min(1).max(1_000_000),
  maxOutputTokens: z.number().int().positive().max(32_000),
}).strict();

export interface AgentCompletionRequest extends z.infer<typeof AgentCompletionRequestSchema> { schema: z.ZodType; onText?: (chunk: string) => void }
export interface AgentCompletion<T = unknown> { value: T; inputTokens: number; outputTokens: number }
export interface ModelProviderAdapter {
  readonly providerId: ProviderModel['providerId'];
  listModels(apiKey: string, fetcher?: typeof fetch): Promise<ProviderModel[]>;
  discoverModels?: () => Promise<ProviderModel[]>;
  probe: (apiKey: string, modelId: string, fetcher?: typeof fetch) => Promise<void>;
  complete: <T>(apiKey: string, request: AgentCompletionRequest, fetcher?: typeof fetch) => Promise<AgentCompletion<T>>;
}

export function validateModelId(modelId: string): string {
  return z.string().min(1).max(200).parse(modelId);
}

export function validateApiKey(apiKey: string): void {
  if (!apiKey || apiKey.length > 500 || /[\r\n\0]/.test(apiKey)) throw new Error('The saved provider API key is invalid.');
}

export async function providerJson(response: Response, provider: string): Promise<unknown> {
  if (!response.ok) {
    const safeStatus = response.status;
    throw new Error(`${provider} request failed with HTTP ${safeStatus}. Check the provider key, model access and account limits.`);
  }
  const body = await response.text();
  if (Buffer.byteLength(body) > 5_000_000) throw new Error(`${provider} response exceeded the 5 MB limit.`);
  try { return JSON.parse(body) as unknown; }
  catch { throw new Error(`${provider} returned an invalid JSON response.`); }
}

export function normalizedModel(input: unknown): ProviderModel {
  return ProviderModelSchema.parse(input);
}

export function modelResponseSchema<T extends z.ZodType>(data: T) {
  return z.object({ data: z.array(data).max(1000), has_more: z.boolean().optional(), last_id: z.string().nullable().optional() }).passthrough();
}
