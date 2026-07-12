/**
 * LLM Client — abstraction over the AI model provider.
 *
 * Design principles:
 * - Timeout: 30s default with configurable override
 * - Retry: up to 3 attempts with exponential backoff
 * - Degradation: graceful fallback to placeholder when LLM is unavailable
 */

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseUrl?: string;
}

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCallResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
      ...config,
    };
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= (this.config.maxRetries ?? DEFAULT_MAX_RETRIES); attempt++) {
      try {
        return await this._callWithTimeout(options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < (this.config.maxRetries ?? DEFAULT_MAX_RETRIES)) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — return a graceful fallback
    return this.fallbackResponse(options, lastError);
  }

  private async _callWithTimeout(options: LLMCallOptions): Promise<LLMCallResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        `${this.config.baseUrl ?? this.defaultBaseUrl()}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model,
            system: options.systemPrompt,
            messages: [{ role: 'user', content: options.userPrompt }],
            max_tokens: options.maxTokens ?? 1024,
            temperature: options.temperature ?? 0.7,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      return {
        content: (data as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? JSON.stringify(data),
        usage: {
          inputTokens: ((data as { usage?: { input_tokens?: number } }).usage?.input_tokens) ?? 0,
          outputTokens: ((data as { usage?: { output_tokens?: number } }).usage?.output_tokens) ?? 0,
          cost: 0, // Will be calculated per-model in a future update
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private defaultBaseUrl(): string {
    switch (this.config.provider) {
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'openai':
        return 'https://api.openai.com';
    }
  }

  private fallbackResponse(
    _options: LLMCallOptions,
    error: Error | null,
  ): LLMCallResult {
    console.warn(`[LLM] Falling back to placeholder response. Error: ${error?.message}`);
    return {
      content: 'The world holds its breath, awaiting the next chapter...',
      usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
    };
  }
}

// Singleton factory
let defaultClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!defaultClient) {
    defaultClient = new LLMClient({
      provider: (process.env.LLM_PROVIDER as 'anthropic' | 'openai') ?? 'anthropic',
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'claude-sonnet-4-6',
      baseUrl: process.env.LLM_BASE_URL,
    });
    console.log(`[LLM] Client initialized: provider=${defaultClient['config'].provider}, model=${defaultClient['config'].model}`);
  }
  return defaultClient;
}
