import { buildLanguageModel } from "@/modules/ai/lib/agent";
import { EMPTY_PROVIDER_KEYS } from "@/modules/ai/lib/keyring";
import { describe, expect, it } from "vitest";

describe("account model transport boundary", () => {
  it("rejects account models before constructing an API provider", async () => {
    await expect(
      buildLanguageModel("openai-account", EMPTY_PROVIDER_KEYS, "gpt-5.6"),
    ).rejects.toThrow("OpenAI account models require the Codex transport.");
  });
});
