import type { LlmClient } from "../deps";

export class LlmError extends Error {
  readonly status = 502;
}

/** Ollama's chat API. `format: "json"` makes the model emit valid JSON. */
export function ollama(opts: { url?: string; model?: string } = {}): LlmClient {
  const url = (opts.url ?? "http://localhost:11434").replace(/\/$/, "");
  const model = opts.model ?? "llama3.1:8b";
  return {
    model: `ollama/${model}`,
    async complete({ system, prompt, json }) {
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
      const body = (await res.json()) as { message?: { content?: string } };
      return body.message?.content ?? "";
    },
  };
}

/** Claude via the Messages API. */
export function anthropic(opts: { apiKey: string; model?: string }): LlmClient {
  const model = opts.model ?? "claude-sonnet-5-5";
  return {
    model: `anthropic/${model}`,
    async complete({ system, prompt }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2000, temperature: 0, system, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(120_000),
      }).catch((e: Error) => {
        throw new LlmError(`Claude API unreachable: ${e.message}`);
      });
      if (!res.ok) throw new LlmError(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
    },
  };
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
