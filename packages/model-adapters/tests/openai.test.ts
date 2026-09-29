import { describe, expect, it, vi } from 'vitest';
import { buildModelPayload, redactModelText, requestScenarioSuggestions } from '../src/openai.js';

const plan = {
  contract: {
    criteria: [
      { id: 'criterion-1', expectedBehavior: 'Results show the title', requiredLayers: ['browser'] },
      { id: 'criterion-2', expectedBehavior: 'Task details are not sent', requiredLayers: ['repo'] },
    ],
  },
};

describe('OpenAI model adapter', () => {
  it('previews only browser acceptance criteria with a fixed token budget', () => {
    const preview = buildModelPayload(plan, 'gpt-5.6-terra', 1024);
    expect(preview.provider).toBe('OpenAI');
    expect(preview.requestBody).toMatchObject({ model: 'gpt-5.6-terra', store: false, max_output_tokens: 1024 });
    const text = JSON.stringify(preview.requestBody);
    expect(text).toContain('Results show the title');
    expect(text).not.toContain('Task details are not sent');
    expect(text).not.toContain('workItemId');
  });

  it('redacts credential canaries from previewed acceptance criteria', () => {
    const input = { contract: { criteria: [{ id: 'criterion-1', expectedBehavior: 'Use api_key=sk-test-provider-secret-value to authenticate', requiredLayers: ['browser'] }] } };
    const preview = buildModelPayload(input, 'gpt-5.6-terra', 512);
    expect(JSON.stringify(preview.requestBody)).not.toContain('sk-test-provider-secret-value');
    expect(JSON.stringify(preview.requestBody)).toContain('[REDACTED]');
    expect(redactModelText('Authorization: Bearer abc.def.ghi')).toContain('[REDACTED]');
  });

  it('sends only to the fixed Responses endpoint and validates structured model output', async () => {
    const preview = buildModelPayload(plan, 'gpt-5.6-terra', 512);
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-test-secret', 'content-type': 'application/json' });
      expect(init?.redirect).toBe('error');
      expect(init?.referrerPolicy).toBe('no-referrer');
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(512);
      const outputText = JSON.stringify({ suggestions: [{ criterionId: 'criterion-1', title: 'Check visible results', expectedObservations: ['The title appears'], steps: [{ action: 'expectText', text: 'The title appears' }] }] });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: outputText }] }], usage: { input_tokens: 280, output_tokens: 42 } }), { status: 200 });
    });
    const result = await requestScenarioSuggestions('sk-test-secret', preview, fetcher as typeof fetch);
    expect(result.suggestions.suggestions[0].steps).toEqual([{ action: 'expectText', text: 'The title appears' }]);
    expect(result.usage).toEqual({ inputTokens: 280, outputTokens: 42 });
  });

  it('rejects model-suggested credentials and malformed responses', async () => {
    const preview = buildModelPayload(plan, 'gpt-5.6-terra', 512);
    const response = (output_text: string) => vi.fn(async () => new Response(JSON.stringify({ output_text }), { status: 200 })) as unknown as typeof fetch;
    const unsafe = JSON.stringify({ suggestions: [{ criterionId: 'criterion-1', title: 'Login', expectedObservations: ['OK'], steps: [{ action: 'fill', role: 'textbox', name: 'Password', value: 'do-not-send' }] }] });
    await expect(requestScenarioSuggestions('sk-test-secret', preview, response(unsafe))).rejects.toThrow();
    await expect(requestScenarioSuggestions('sk-test-secret', preview, response('not-json'))).rejects.toThrow('valid JSON');
    const overBudget = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify({ suggestions: [] }), usage: { input_tokens: 12001, output_tokens: 1 } }), { status: 200 })) as unknown as typeof fetch;
    await expect(requestScenarioSuggestions('sk-test-secret', preview, overBudget)).rejects.toThrow('exceeded the configured request budget');
    const secretOutput = vi.fn(async () => new Response(JSON.stringify({ output_text: JSON.stringify({ suggestions: [{ criterionId: 'criterion-1', title: 'api_key=sk-test-provider-secret-value', expectedObservations: ['OK'], steps: [] }] }) }), { status: 200 })) as unknown as typeof fetch;
    await expect(requestScenarioSuggestions('sk-test-secret', preview, secretOutput)).rejects.toThrow('secret-like content');
    await expect(requestScenarioSuggestions('sk-test-secret', preview, vi.fn(async () => new Response('unauthorized', { status: 401 }) as unknown as Response))).rejects.toThrow('HTTP 401');
  });

  it('refuses a plan with no browser criteria', () => {
    expect(() => buildModelPayload({ contract: { criteria: [{ id: 'repo-only', expectedBehavior: 'Compile', requiredLayers: ['repo'] }] } }, 'gpt-5.6-terra', 512)).toThrow('no browser criteria');
  });
});
