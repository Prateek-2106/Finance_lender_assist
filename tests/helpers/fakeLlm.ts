import type { LlmClient } from "../../src/deps";

/** Replies from a script, in order, and records every prompt it was sent. */
export function fakeLlm(...replies: (string | object)[]) {
  const prompts: { system: string; prompt: string }[] = [];
  const llm: LlmClient = {
    model: "fake/test",
    async complete({ system, prompt }) {
      prompts.push({ system, prompt });
      const next = replies.shift();
      if (next === undefined) throw new Error("fakeLlm: script ran out of replies");
      return typeof next === "string" ? next : JSON.stringify(next);
    },
  };
  return { llm, prompts };
}
