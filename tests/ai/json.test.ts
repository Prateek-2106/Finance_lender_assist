import { z } from "zod";
import { completeJson, extractJson } from "../../src/ai/json";
import { LlmError } from "../../src/ai/providers";
import { fakeLlm } from "../helpers/fakeLlm";

const S = z.object({ ok: z.boolean() });

describe("extractJson", () => {
  it("finds JSON inside prose and code fences", () => {
    expect(extractJson('Sure! ```json\n{"ok": true}\n``` hope that helps')).toEqual({ ok: true });
  });
  it("throws when there is none", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("completeJson", () => {
  it("retries once, feeding back what was wrong", async () => {
    const { llm, prompts } = fakeLlm("not json", { ok: true });
    expect(await completeJson(llm, { system: "s", prompt: "p" }, S)).toEqual({ ok: true });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.prompt).toMatch(/previous reply was rejected/);
  });
  it("feeds back schema errors too", async () => {
    const { llm, prompts } = fakeLlm({ ok: "yes" }, { ok: false });
    expect(await completeJson(llm, { system: "s", prompt: "p" }, S)).toEqual({ ok: false });
    expect(prompts[1]!.prompt).toMatch(/ok:/);
  });
  it("gives up with a 502 after the retry", async () => {
    const { llm } = fakeLlm("nope", "still nope");
    await expect(completeJson(llm, { system: "s", prompt: "p" }, S)).rejects.toBeInstanceOf(LlmError);
  });
});
