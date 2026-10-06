import type { LlmClient, LlmRequest, LlmUsage } from "../deps";

export class LlmError extends Error {
  readonly status = 502;
}

/** Ollama's chat API. `format: "json"` makes the model emit valid JSON. */
export function ollama(opts: { url?: string; model?: string } = {}): LlmClient {
  const url = (opts.url ?? "http://localhost:11434").replace(/\/$/, "");
  const model = opts.model ?? "llama3.1:8b";
  const client = {
    model: `ollama/${model}`,
    async complete(req: LlmRequest) {
      return (await client.completeWithUsage(req)).text;
    },
    async completeWithUsage({ system, prompt, json }: LlmRequest): Promise<{ text: string; usage?: LlmUsage }> {
      const res = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          ...(json ? { format: "json" } : {}),
          options: { temperature: 0 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      }).catch((e: Error) => {
        throw new LlmError(`Ollama unreachable at ${url}: ${e.message}`);
      });
      if (!res.ok) throw new LlmError(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      return { text: body.message?.content ?? "", usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 } };
    },
  };
  return client;
}

/** Claude via the Messages API. */
export function anthropic(opts: { apiKey: string; model?: string }): LlmClient {
  const model = opts.model ?? "claude-sonnet-5-5";
  const client = {
    model: `anthropic/${model}`,
    async complete(req: LlmRequest) {
      return (await client.completeWithUsage(req)).text;
    },
    async completeWithUsage({ system, prompt }: LlmRequest): Promise<{ text: string; usage?: LlmUsage }> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2000, temperature: 0, system, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(120_000),
      }).catch((e: Error) => {
        throw new LlmError(`Claude API unreachable: ${e.message}`);
      });
      if (!res.ok) throw new LlmError(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      return {
        text: (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""),
        usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 },
      };
    },
  };
  return client;
}

/** LLM_PROVIDER = ollama (default) | anthropic | none */
export function llmFromEnv(env: NodeJS.ProcessEnv): LlmClient | undefined {
  const provider = (env.LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "none") return undefined;
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY");
    return anthropic({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
  }
  return ollama({ url: env.OLLAMA_URL, model: env.OLLAMA_MODEL });
}
