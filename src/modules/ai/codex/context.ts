import type { UIMessage } from "@ai-sdk/react";

export function previousConversationContext(
  messages: UIMessage[],
  latestId: string,
): string {
  const rows: string[] = [];
  for (const message of messages.slice(-13)) {
    if (message.id === latestId || message.role === "system") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) continue;
    rows.push(`${message.role === "user" ? "User" : "Assistant"}:\n${text}`);
  }
  if (rows.length === 0) return "";
  const content = rows.join("\n\n").slice(-16 * 1024);
  return `<previous-provider-context>\n${content}\n</previous-provider-context>`;
}

