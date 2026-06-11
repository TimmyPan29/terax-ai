import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import { previousConversationContext } from "@/modules/ai/codex/context";

describe("previousConversationContext", () => {
  it("imports only prior visible text messages", () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Earlier question" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Earlier answer" },
          {
            type: "dynamic-tool",
            toolName: "ignored",
            toolCallId: "t1",
            state: "output-available",
            input: {},
            output: "secret output",
          },
        ],
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "Current question" }],
      },
    ];
    const result = previousConversationContext(messages, "u2");
    expect(result).toContain("Earlier question");
    expect(result).toContain("Earlier answer");
    expect(result).not.toContain("Current question");
    expect(result).not.toContain("secret output");
  });
});

