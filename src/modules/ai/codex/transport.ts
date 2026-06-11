import type { UIMessage } from "@ai-sdk/react";
import {
  createUIMessageStream,
  type ChatTransport,
  type UIMessageChunk,
} from "ai";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePlanStore } from "@/modules/ai/store/planStore";
import { native } from "@/modules/ai/lib/native";
import {
  codexRequest,
  codexRespond,
  onCodexEvent,
  type CodexEvent,
} from "@/modules/ai/codex/client";
import { useCodexStore } from "@/modules/ai/codex/store";
import { previousConversationContext } from "@/modules/ai/codex/context";

type SessionBinding = {
  threadId?: string;
  contextImported?: boolean;
};

type Deps = {
  sessionId: string;
  getSession: () => SessionBinding;
  setThread: (threadId: string, contextImported: boolean) => void;
  getCwd: () => string | null;
  getWorkspaceRoot: () => string | null;
  getCustomInstructions: () => string;
  getAgentPersona: () => { name: string; instructions: string } | null;
  onStep: (step: string | null) => void;
  onUsage: (usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    lastInputTokens: number;
    lastCachedTokens: number;
  }) => void;
};

type PendingApproval = {
  requestId: string | number;
  itemId: string;
};

const pendingApprovals = new Map<string, PendingApproval>();

export function respondToCodexApproval(
  approvalId: string,
  approved: boolean,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  void codexRespond(pending.requestId, {
    decision: approved ? "accept" : "decline",
  });
  return true;
}

export function createCodexTransport(
  deps: Deps,
): ChatTransport<UIMessage> {
  return {
    async sendMessages(options) {
      return createUIMessageStream<UIMessage>({
        originalMessages: options.messages,
        execute: async ({ writer }) => {
          await ensureConnected();
          const contextAlreadyImported =
            deps.getSession().contextImported === true;
          const thread = await ensureThread(deps);
          const threadId = thread.id;
          const current = currentModel();
          const input = latestUserInput(
            options.messages,
            contextAlreadyImported,
          );
          const textId = new Set<string>();
          const reasoningId = new Set<string>();
          const tools = new Set<string>();
          let activeTurnId: string | null = null;
          let settled = false;
          let removeListener = () => {};

          writer.write({ type: "start" });

          const done = new Promise<void>((resolve, reject) => {
            removeListener = onCodexEvent((event) => {
              if (!eventBelongsToThread(event, threadId)) return;
              try {
                if (handleEvent(event, writer.write, {
                  textId,
                  reasoningId,
                  tools,
                  onStep: deps.onStep,
                  onUsage: deps.onUsage,
                })) {
                  settled = true;
                  closeOpenParts(writer.write, textId, reasoningId);
                  writer.write({ type: "finish", finishReason: "stop" });
                  removeListener();
                  resolve();
                }
              } catch (error) {
                settled = true;
                removeListener();
                reject(error);
              }
            });
          });

          const abort = () => {
            if (activeTurnId) {
              void codexRequest("turn/interrupt", {
                threadId,
                turnId: activeTurnId,
              });
            }
          };
          options.abortSignal?.addEventListener("abort", abort, { once: true });

          try {
            const response = await codexRequest<{
              turn: { id: string };
            }>("turn/start", {
              threadId,
              input,
              cwd: deps.getCwd() ?? deps.getWorkspaceRoot(),
              approvalPolicy: "on-request",
              model: current.model,
              effort: current.effort || null,
              collaborationMode: {
                mode: usePlanStore.getState().active ? "plan" : "default",
                settings: {
                  model: current.model,
                  reasoning_effort: current.effort || null,
                  developer_instructions: thread.developerInstructions,
                },
              },
            });
            activeTurnId = response.turn.id;
            if (options.abortSignal?.aborted) abort();
            await done;
          } finally {
            options.abortSignal?.removeEventListener("abort", abort);
            if (!settled) {
              removeListener();
              closeOpenParts(writer.write, textId, reasoningId);
            }
          }
        },
      });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

async function ensureConnected() {
  const store = useCodexStore.getState();
  if (store.phase !== "connected") await store.refresh();
  const next = useCodexStore.getState();
  if (next.phase !== "connected") {
    throw new Error(
      next.error ?? "Sign in to OpenAI Account in Settings before chatting.",
    );
  }
}

function currentModel(): { model: string; effort: string } {
  const prefs = usePreferencesStore.getState();
  const models = useCodexStore.getState().models;
  const selected =
    models.find(
      (candidate) =>
        candidate.id === prefs.codexModelId ||
        candidate.model === prefs.codexModelId,
    ) ??
    models.find((candidate) => candidate.isDefault) ??
    models[0];
  if (!selected) throw new Error("No Codex model is available for this account.");
  const effort =
    selected.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === prefs.codexReasoningEffort,
    )
      ? prefs.codexReasoningEffort
      : selected.defaultReasoningEffort;
  return { model: selected.model, effort };
}

async function ensureThread(
  deps: Deps,
): Promise<{ id: string; developerInstructions: string }> {
  const existing = deps.getSession().threadId;
  const current = currentModel();
  const cwd =
    deps.getCwd() ??
    deps.getWorkspaceRoot() ??
    (await native.workspaceCurrentDir());
  const instructions = await buildDeveloperInstructions(deps, cwd);
  if (existing) {
    try {
      await codexRequest("thread/resume", {
        threadId: existing,
        cwd,
        model: current.model,
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        runtimeWorkspaceRoots: deps.getWorkspaceRoot()
          ? [deps.getWorkspaceRoot()]
          : [cwd],
        developerInstructions: instructions,
      });
      return { id: existing, developerInstructions: instructions };
    } catch (error) {
      if (!isMissingThreadError(error)) throw error;
    }
  }
  const response = await codexRequest<{
    thread: { id: string };
  }>("thread/start", {
    cwd,
    model: current.model,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    runtimeWorkspaceRoots: deps.getWorkspaceRoot()
      ? [deps.getWorkspaceRoot()]
      : [cwd],
    developerInstructions: instructions,
    ephemeral: false,
    serviceName: "terax",
  });
  deps.setThread(response.thread.id, true);
  return {
    id: response.thread.id,
    developerInstructions: instructions,
  };
}

function isMissingThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /thread|rollout/i.test(message) &&
    /not found|missing|removed/i.test(message)
  );
}

async function buildDeveloperInstructions(deps: Deps, cwd: string) {
  const blocks: string[] = [];
  const custom = deps.getCustomInstructions().trim();
  if (custom) blocks.push(custom);
  const persona = deps.getAgentPersona();
  if (persona) {
    blocks.push(`You are ${persona.name}.\n${persona.instructions.trim()}`);
  }
  const root = deps.getWorkspaceRoot() ?? cwd;
  try {
    const memory = await native.readFile(`${root.replace(/\/$/, "")}/TERAX.md`);
    if (memory.kind === "text") {
      blocks.push(memory.content.slice(0, 32 * 1024));
    }
  } catch {
    // Project memory is optional.
  }
  return blocks.join("\n\n");
}

function latestUserInput(
  messages: UIMessage[],
  contextAlreadyImported: boolean,
): Array<Record<string, unknown>> {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) throw new Error("No user message to send.");
  const input: Array<Record<string, unknown>> = [];
  for (const part of latest.parts) {
    if (part.type === "text") {
      input.push({ type: "text", text: part.text });
    } else if (part.type === "file" && part.mediaType.startsWith("image/")) {
      input.push({ type: "image", url: part.url });
    }
  }
  if (!contextAlreadyImported && messages.length > 1) {
    const context = previousConversationContext(messages, latest.id);
    if (context) input.unshift({ type: "text", text: context });
  }
  return input;
}

type EventState = {
  textId: Set<string>;
  reasoningId: Set<string>;
  tools: Set<string>;
  onStep: (step: string | null) => void;
  onUsage: Deps["onUsage"];
};

function handleEvent(
  event: CodexEvent,
  write: (chunk: UIMessageChunk) => void,
  state: EventState,
): boolean {
  const params = event.params ?? {};
  switch (event.method) {
    case "item/agentMessage/delta": {
      const id = String(params.itemId);
      ensureText(write, state.textId, id);
      write({ type: "text-delta", id, delta: String(params.delta ?? "") });
      break;
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta": {
      const id = String(params.itemId);
      ensureReasoning(write, state.reasoningId, id);
      write({
        type: "reasoning-delta",
        id,
        delta: String(params.delta ?? ""),
      });
      break;
    }
    case "item/started": {
      const item = asRecord(params.item);
      startItem(write, item, state.tools);
      state.onStep(itemStep(item));
      break;
    }
    case "item/fileChange/patchUpdated": {
      const itemId = String(params.itemId);
      write({
        type: "tool-input-available",
        toolCallId: itemId,
        toolName: "codex_file_change",
        input: { changes: params.changes },
        dynamic: true,
        providerExecuted: true,
      });
      state.tools.add(itemId);
      break;
    }
    case "item/completed": {
      const item = asRecord(params.item);
      completeItem(write, item, state);
      const itemId = String(item.id ?? "");
      for (const [approvalId, pending] of pendingApprovals) {
        if (pending.itemId === itemId) pendingApprovals.delete(approvalId);
      }
      state.onStep(null);
      break;
    }
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval": {
      const itemId = String(params.itemId);
      const approvalId = `codex:${String(event.id)}`;
      if (!state.tools.has(itemId)) {
        const isCommand = event.method.includes("commandExecution");
        write({
          type: "tool-input-available",
          toolCallId: itemId,
          toolName: isCommand ? "codex_command" : "codex_file_change",
          input: params,
          dynamic: true,
          providerExecuted: true,
        });
        state.tools.add(itemId);
      }
      if (event.id !== undefined) {
        pendingApprovals.set(approvalId, { requestId: event.id, itemId });
        write({
          type: "tool-approval-request",
          approvalId,
          toolCallId: itemId,
        });
      }
      break;
    }
    case "thread/tokenUsage/updated": {
      const usage = asRecord(params.tokenUsage);
      const total = asRecord(usage.total);
      const last = asRecord(usage.last);
      state.onUsage({
        inputTokens: numberValue(total.inputTokens),
        outputTokens: numberValue(total.outputTokens),
        cachedInputTokens: numberValue(total.cachedInputTokens),
        lastInputTokens: numberValue(last.inputTokens),
        lastCachedTokens: numberValue(last.cachedInputTokens),
      });
      break;
    }
    case "error": {
      if (params.willRetry !== true) {
        const error = asRecord(params.error);
        write({
          type: "error",
          errorText: String(error.message ?? "Codex turn failed"),
        });
      }
      break;
    }
    case "terax/codex/processExited":
      pendingApprovals.clear();
      throw new Error("Codex app-server exited during the turn.");
    case "turn/completed":
      return true;
  }
  return false;
}

function startItem(
  write: (chunk: UIMessageChunk) => void,
  item: Record<string, unknown>,
  tools: Set<string>,
) {
  const type = String(item.type ?? "");
  const id = String(item.id ?? "");
  const toolName = toolNameForItem(type);
  if (!id || !toolName || tools.has(id)) return;
  write({
    type: "tool-input-available",
    toolCallId: id,
    toolName,
    input: toolInput(item),
    dynamic: true,
    providerExecuted: true,
  });
  tools.add(id);
}

function completeItem(
  write: (chunk: UIMessageChunk) => void,
  item: Record<string, unknown>,
  state: EventState,
) {
  const type = String(item.type ?? "");
  const id = String(item.id ?? "");
  if (type === "agentMessage") {
    if (!state.textId.has(id)) {
      ensureText(write, state.textId, id);
      write({ type: "text-delta", id, delta: String(item.text ?? "") });
    }
    write({ type: "text-end", id });
    state.textId.delete(id);
    return;
  }
  if (type === "reasoning" || type === "plan") {
    if (!state.reasoningId.has(id)) {
      const content =
        type === "plan"
          ? String(item.text ?? "")
          : [...stringArray(item.summary), ...stringArray(item.content)].join(
              "\n",
            );
      ensureReasoning(write, state.reasoningId, id);
      if (content) write({ type: "reasoning-delta", id, delta: content });
    }
    write({ type: "reasoning-end", id });
    state.reasoningId.delete(id);
    return;
  }
  const toolName = toolNameForItem(type);
  if (!toolName || !id) return;
  startItem(write, item, state.tools);
  const status = String(item.status ?? "completed");
  if (status === "declined") {
    write({ type: "tool-output-denied", toolCallId: id });
  } else if (status === "failed") {
    write({
      type: "tool-output-error",
      toolCallId: id,
      errorText: String(item.error ?? item.aggregatedOutput ?? "Tool failed"),
      dynamic: true,
      providerExecuted: true,
    });
  } else {
    write({
      type: "tool-output-available",
      toolCallId: id,
      output: toolOutput(item),
      dynamic: true,
      providerExecuted: true,
    });
  }
}

function toolNameForItem(type: string): string | null {
  switch (type) {
    case "commandExecution":
      return "codex_command";
    case "fileChange":
      return "codex_file_change";
    case "mcpToolCall":
      return "codex_mcp";
    case "dynamicToolCall":
      return "codex_tool";
    case "collabAgentToolCall":
      return "codex_subagent";
    case "webSearch":
      return "codex_web_search";
    case "imageView":
      return "codex_image_view";
    case "imageGeneration":
      return "codex_image_generation";
    default:
      return null;
  }
}

function toolInput(item: Record<string, unknown>): unknown {
  switch (item.type) {
    case "commandExecution":
      return { command: item.command, cwd: item.cwd };
    case "fileChange":
      return { changes: item.changes };
    case "mcpToolCall":
      return { server: item.server, tool: item.tool, arguments: item.arguments };
    case "webSearch":
      return { query: item.query, action: item.action };
    default:
      return item;
  }
}

function toolOutput(item: Record<string, unknown>): unknown {
  switch (item.type) {
    case "commandExecution":
      return {
        output: item.aggregatedOutput,
        exitCode: item.exitCode,
        durationMs: item.durationMs,
      };
    case "fileChange":
      return { changes: item.changes, status: item.status };
    case "mcpToolCall":
      return item.result ?? item.error ?? item.status;
    default:
      return item;
  }
}

function itemStep(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case "commandExecution":
      return `Running ${String(item.command ?? "command")}`;
    case "fileChange":
      return "Editing files";
    case "mcpToolCall":
      return `Using ${String(item.tool ?? "MCP tool")}`;
    case "webSearch":
      return `Searching ${String(item.query ?? "the web")}`;
    default:
      return null;
  }
}

function ensureText(
  write: (chunk: UIMessageChunk) => void,
  active: Set<string>,
  id: string,
) {
  if (active.has(id)) return;
  active.add(id);
  write({ type: "text-start", id });
}

function ensureReasoning(
  write: (chunk: UIMessageChunk) => void,
  active: Set<string>,
  id: string,
) {
  if (active.has(id)) return;
  active.add(id);
  write({ type: "reasoning-start", id });
}

function closeOpenParts(
  write: (chunk: UIMessageChunk) => void,
  text: Set<string>,
  reasoning: Set<string>,
) {
  for (const id of text) write({ type: "text-end", id });
  for (const id of reasoning) write({ type: "reasoning-end", id });
  text.clear();
  reasoning.clear();
}

function eventBelongsToThread(event: CodexEvent, threadId: string): boolean {
  if (event.method?.startsWith("terax/codex/")) return true;
  const eventThread = event.params?.threadId;
  return typeof eventThread !== "string" || eventThread === threadId;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
