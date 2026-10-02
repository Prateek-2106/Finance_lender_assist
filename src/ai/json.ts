import type { z } from "zod";
import type { LlmClient } from "../deps";
import { LlmError } from "./providers";

/** Pulls the first JSON object out of a reply that may be wrapped in prose or ``` fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object in the reply");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Asks for JSON matching `schema`. On a parse or shape error it retries once,
 * telling the model exactly what was wrong; after that it gives up with a 502.
 */
export async function completeJson<S extends z.ZodType>(
  llm: LlmClient,
  req: { system: string; prompt: string },
  schema: S,
  retries = 1,
): Promise<z.output<S>> {
  let prompt = req.prompt;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const reply = await llm.complete({ system: req.system, prompt, json: true });
    try {
      const r = schema.safeParse(extractJson(reply));
      if (r.success) return r.data;
      lastError = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = (e as Error).message;
    }
    prompt = `${req.prompt}\n\nYour previous reply was rejected: ${lastError}\nReply again with only the JSON object, matching the format exactly.`;
  }
  throw new LlmError(`Model did not return valid JSON after ${retries + 1} attempts: ${lastError}`);
}
