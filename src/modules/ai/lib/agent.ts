import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  type JSONValue,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import {
  DEFAULT_MODEL_ID,
  getModel,
  getModelContextLimit,
  LMSTUDIO_DEFAULT_BASE_URL,
  MAX_AGENT_STEPS,
  MLX_DEFAULT_BASE_URL,
  modelKeepsReasoning,
  OLLAMA_DEFAULT_BASE_URL,
  providerNeedsKey,
  resolveThinkingEnabled,
  selectSystemPrompt,
  type ModelId,
  type ProviderId,
} from "../config";
import { buildTools, type ToolContext } from "../tools/tools";
import { compactModelMessagesDetailed } from "./compact";
import { getKey, type ProviderKeys } from "./keyring";
import { createProxyFetch } from "./proxyFetch";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> =
  {
    read_file: (i) => `Reading ${shortPath(i.path)}`,
    list_directory: (i) => `Listing ${shortPath(i.path)}`,
    grep: (i) => `Grepping ${ellipsize(String(i.pattern ?? ""), 40)}`,
    glob: (i) => `Globbing ${ellipsize(String(i.pattern ?? ""), 40)}`,
    edit: (i) => `Editing ${shortPath(i.path)}`,
    multi_edit: (i) => `Editing ${shortPath(i.path)}`,
    write_file: (i) => `Writing ${shortPath(i.path)}`,
    create_directory: (i) => `Creating ${shortPath(i.path)}`,
    bash_run: (i) => `Running ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_background: (i) =>
      `Spawning ${ellipsize(String(i.command ?? ""), 60)}`,
    bash_logs: () => `Reading logs`,
    bash_list: () => `Listing background processes`,
    bash_kill: () => `Stopping background process`,
    suggest_command: (i) =>
      `Suggesting ${ellipsize(String(i.command ?? ""), 60)}`,
    todo_write: (i) =>
      `Updating plan (${Array.isArray(i.todos) ? i.todos.length : 0} items)`,
    run_subagent: (i) => `Spawning ${String(i.type ?? "subagent")} subagent`,
  };

function shortPath(p: unknown): string {
  if (typeof p !== "string") return "";
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function ellipsize(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type BuildModelOptions = {
  modelIdOverride?: string;
  lmstudioBaseURL?: string;
  mlxBaseURL?: string;
  ollamaBaseURL?: string;
  openaiCompatibleBaseURL?: string;
};

const modelCache = new Map<string, LanguageModel>();

export async function buildLanguageModel(
  provider: ProviderId,
  keys: ProviderKeys,
  resolvedModelId: string,
  options: BuildModelOptions = {},
): Promise<LanguageModel> {
  let key = keys[provider] ?? "";
  if (providerNeedsKey(provider)) {
    if (key === "••••••••" || !key) {
      const actualKey = await getKey(provider);
      if (!actualKey) {
        throw new Error(
          `No API key configured for ${provider}. Open Settings → AI to add one.`,
        );
      }
      key = actualKey;
    }
  }
  const lmstudioURL = options.lmstudioBaseURL ?? LMSTUDIO_DEFAULT_BASE_URL;
  const mlxURL = options.mlxBaseURL ?? MLX_DEFAULT_BASE_URL;
  const ollamaURL = options.ollamaBaseURL ?? OLLAMA_DEFAULT_BASE_URL;
  const compatURL = options.openaiCompatibleBaseURL ?? "";
  const cacheKey = `${provider} ${key} ${resolvedModelId} ${lmstudioURL} ${mlxURL} ${ollamaURL} ${compatURL}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;

  let built: LanguageModel;
  switch (provider) {
    case "openai-account": {
      throw new Error(
        "OpenAI Account uses Codex app-server and cannot be built as a language model.",
      );
    }
    case "copilot-account": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      const { getCopilotSessionToken } =
        await import("./copilotAuth");
      
      const upstreamModel = resolvedModelId.replace("copilot-account-", "");
      const isGemini = upstreamModel.startsWith("gemini");
      
      // For Gemini models we need a proper ghu_-based session token
      // because the gh-cli gho_ token's integrator (copilot-4-cli)
      // does not have Gemini in its allow-list.
      let sessionToken: string | null = null;
      if (isGemini) {
        sessionToken = await getCopilotSessionToken();
      }

      const copilotProxyFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init) {
          const newHeaders: Record<string, string> = {};
          if (init.headers instanceof Headers) {
            init.headers.forEach((v, k) => { newHeaders[k] = v; });
          } else if (Array.isArray(init.headers)) {
            for (const [k, v] of init.headers) newHeaders[k] = v;
          } else if (init.headers) {
            Object.assign(newHeaders, init.headers);
          }
          if (isGemini) {
            // Use session token directly — bypass Rust-side gh auth
            newHeaders["copilot-integration-id"] = "vscode-chat";
            delete newHeaders["x-terax-auth"];
            if (sessionToken) {
              newHeaders["authorization"] = `Bearer ${sessionToken}`;
            }
          } else {
            // Non-Gemini: keep using x-terax-auth for Rust-side gh auth
            newHeaders["copilot-integration-id"] = "copilot-chat";
          }
          newHeaders["editor-version"] = "vscode/1.115.0";
          newHeaders["editor-plugin-version"] = "copilot-chat/0.30.0";
          init.headers = newHeaders;
        }
        if (init?.body && typeof init.body === "string") {
          try {
            const parsed = JSON.parse(init.body);
            if (getModel(resolvedModelId as ModelId).tags?.includes("reasoning")) {
              if (!upstreamModel.startsWith("gpt-5")) {
                parsed.reasoning_effort = "high";
              }
            }
            return localProxyFetch(input, { ...init, body: JSON.stringify(parsed) });
          } catch (e) {
            // ignore
          }
        }
        return localProxyFetch(input, init);
      };

      let finalModel = upstreamModel === "copilot" ? "gpt-5.4-mini" : upstreamModel;
      if (finalModel === "gpt-5.4-mini") {
        finalModel = "gpt-5-mini";
      }
      
      built = createOpenAICompatible({
        name: "copilot-account",
        baseURL: "https://api.githubcopilot.com",
        apiKey: "dummy",
        headers: isGemini
          ? { "editor-version": "vscode/1.115.0", "editor-plugin-version": "copilot-chat/0.30.0", "Copilot-Integration-Id": "vscode-chat" }
          : { "x-terax-auth": "copilot", "editor-version": "vscode/1.115.0", "editor-plugin-version": "copilot-chat/0.30.0", "Copilot-Integration-Id": "copilot-chat" },
        fetch: copilotProxyFetch,
      })(finalModel);
      break;
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      built = createOpenAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      // We run inside a Tauri webview (a browser origin). Anthropic blocks
      // cross-origin browser requests unless this header opts in, otherwise the
      // fetch fails CORS and WKWebView surfaces it only as "Load failed".
      built = createAnthropic({
        apiKey: key,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(resolvedModelId);
      break;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      built = createGoogleGenerativeAI({ apiKey: key })(resolvedModelId);
      break;
    }
    case "google-account": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      
      const upstreamModel = resolvedModelId === "google-account-gemini-2.5-pro" ? "gemini-2.5-pro" : resolvedModelId;
      
      built = createGoogleGenerativeAI({ 
        baseURL: "https://us-central1-aiplatform.googleapis.com/v1/projects/dummy-gcp-project-id/locations/us-central1/publishers/google",
        apiKey: "dummy",
        headers: { "x-terax-auth": "google" },
        fetch: localProxyFetch,
      })(upstreamModel);
      break;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      built = createXai({ apiKey: key })(resolvedModelId);
      break;
    }
    case "cerebras": {
      const { createCerebras } = await import("@ai-sdk/cerebras");
      built = createCerebras({ apiKey: key })(resolvedModelId);
      break;
    }
    case "deepseek": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "deepseek",
        baseURL: "https://api.deepseek.com",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "mistral": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "mistral",
        baseURL: "https://api.mistral.ai/v1",
        apiKey: key,
      })(resolvedModelId);
      break;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      built = createGroq({ apiKey: key })(resolvedModelId);
      break;
    }
    case "openrouter": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        headers: {
          "HTTP-Referer": "https://terax.ai",
          "X-Title": "Terax",
        },
      })(resolvedModelId);
      break;
    }
    case "openai-compatible": {
      if (!compatURL) {
        throw new Error(
          "OpenAI-compatible provider has no base URL. Set it in Settings → Models.",
        );
      }
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "openai-compatible",
        baseURL: compatURL,
        apiKey: key || undefined,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    case "lmstudio": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "lmstudio",
        baseURL: lmstudioURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    case "mlx": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "mlx",
        baseURL: mlxURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    case "ollama": {
      const { createOpenAICompatible } =
        await import("@ai-sdk/openai-compatible");
      built = createOpenAICompatible({
        name: "ollama",
        baseURL: ollamaURL,
        fetch: localProxyFetch,
      })(resolvedModelId);
      break;
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive as ProviderId}`);
    }
  }
  modelCache.set(cacheKey, built);
  return built;
}

export type LocalProviderConfig = {
  lmstudioBaseURL?: string;
  lmstudioModelId?: string;
  mlxBaseURL?: string;
  mlxModelId?: string;
  ollamaBaseURL?: string;
  ollamaModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openrouterModelId?: string;
};

export function buildConfiguredLanguageModel(
  modelId: ModelId,
  keys: ProviderKeys,
  local: LocalProviderConfig = {},
): Promise<LanguageModel> {
  const m = getModel(modelId);
  let resolvedId: string = m.id;
  if (m.id === "lmstudio-local") {
    if (!local.lmstudioModelId?.trim()) {
      throw new Error(
        "LM Studio: no model id set. Open Settings → Models and enter the model id loaded in LM Studio.",
      );
    }
    resolvedId = local.lmstudioModelId.trim();
  } else if (m.id === "mlx-local") {
    if (!local.mlxModelId?.trim()) {
      throw new Error(
        "MLX: no model id set. Open Settings → Models and enter the model id served by mlx_lm.server.",
      );
    }
    resolvedId = local.mlxModelId.trim();
  } else if (m.id === "ollama-local") {
    if (!local.ollamaModelId?.trim()) {
      throw new Error(
        "Ollama: no model id set. Open Settings → Models and enter the model id (e.g. the name from `ollama list`).",
      );
    }
    resolvedId = local.ollamaModelId.trim();
  } else if (m.id === "openai-compatible-custom") {
    if (!local.openaiCompatibleModelId?.trim()) {
      throw new Error(
        "OpenAI-compatible: no model id set. Open Settings → Models.",
      );
    }
    resolvedId = local.openaiCompatibleModelId.trim();
  } else if (m.id === "openrouter-custom") {
    if (!local.openrouterModelId?.trim()) {
      throw new Error(
        "OpenRouter: no model id set. Open Settings → Models and enter an OpenRouter model id (e.g. anthropic/claude-sonnet-4-6).",
      );
    }
    resolvedId = local.openrouterModelId.trim();
  }
  return buildLanguageModel(m.provider, keys, resolvedId, {
    lmstudioBaseURL: local.lmstudioBaseURL,
    mlxBaseURL: local.mlxBaseURL,
    ollamaBaseURL: local.ollamaBaseURL,
    openaiCompatibleBaseURL: local.openaiCompatibleBaseURL,
  });
}

const PLAN_MODE_PROMPT = `## PLAN MODE — ACTIVE
Mutating tools (write_file, edit, multi_edit, create_directory) will queue their changes for the user to review as a single diff. Do NOT execute bash_run or bash_background while plan mode is active — restrict yourself to reads (read_file, grep, glob, list_directory) and the queued mutations. After queueing the full set of edits, stop and return a brief summary; do not continue acting until the user has accepted/rejected.`;

function buildStableSystem(
  modelId: ModelId,
  persona: { name: string; instructions: string } | null,
  customInstructions: string | undefined,
  projectMemory: string | null,
): string {
  const base = selectSystemPrompt(getModel(modelId).id);
  const personaBlock = persona?.instructions.trim()
    ? `\n\n## ACTIVE AGENT — ${persona.name}\n${persona.instructions.trim()}`
    : "";
  const customBlock = customInstructions?.trim()
    ? `\n\n## USER CUSTOM INSTRUCTIONS — follow unless they conflict with safety rules above\n${customInstructions.trim()}`
    : "";
  const memoryBlock =
    projectMemory && projectMemory.trim().length > 0
      ? `\n\n## PROJECT — TERAX.md\n${projectMemory.trim()}`
      : "";
  return `${base}${memoryBlock}${personaBlock}${customBlock}`;
}

// OpenAI / Gemini / DeepSeek apply prefix caching automatically; only
// Anthropic needs explicit breakpoints. Mark the stable system prefix and
// the rotating conversation tail.
function applyCacheBreakpoints(
  messages: ModelMessage[],
  provider: ProviderId,
): ModelMessage[] {
  if (provider !== "anthropic" || messages.length === 0) return messages;
  const marker = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
  };
  const withMarker = (m: ModelMessage): ModelMessage => ({
    ...m,
    providerOptions: { ...(m.providerOptions ?? {}), ...marker },
  });
  const out = messages.slice();
  out[0] = withMarker(out[0]);
  const lastIdx = out.length - 1;
  if (lastIdx > 0) out[lastIdx] = withMarker(out[lastIdx]);
  return out;
}

// Per-provider "deep thinking" knobs. Only the native SDKs expose a switch;
// gateway/local providers think (or not) based on the chosen model, so we send
// nothing for them. Returns undefined when thinking is off — letting the model
// fall back to its own default rather than force-disabling (which some models,
// e.g. Gemini 3 Pro, reject).
function buildThinkingProviderOptions(
  provider: ProviderId,
  enabled: boolean,
): Record<string, Record<string, JSONValue>> | undefined {
  if (!enabled) return undefined;
  switch (provider) {
    case "anthropic":
      return {
        anthropic: { thinking: { type: "enabled", budgetTokens: 6000 } },
      };
    case "google":
      return {
        google: { thinkingConfig: { thinkingBudget: -1, includeThoughts: true } },
      };
    case "copilot-account":
    case "openai":
      return { openai: { reasoningEffort: "high" } };
    case "deepseek":
      return {
        deepseek: {
          reasoningEffort: "high",
          extraBody: { thinking: { type: "enabled" } },
        },
      };
    case "openrouter":
      return {
        openrouter: {
          reasoningEffort: "high",
          extraBody: { thinking: { type: "enabled" } },
        },
      };
    default:
      return undefined;
  }
}

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type AgentUsageDelta = AgentUsage & {
  lastInputTokens: number;
  lastCachedTokens: number;
};

const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
};

export type RunAgentOptions = {
  keys: ProviderKeys;
  modelId?: ModelId;
  customInstructions?: string;
  agentPersona?: { name: string; instructions: string } | null;
  toolContext: ToolContext;
  onStep?: (step: string | null) => void;
  onUsage?: (delta: AgentUsageDelta) => void;
  onCompact?: (info: { droppedCount: number }) => void;
  onFinishMeta?: (info: { hitStepCap: boolean; finishReason: string }) => void;
  lmstudioBaseURL?: string;
  lmstudioModelId?: string;
  mlxBaseURL?: string;
  mlxModelId?: string;
  ollamaBaseURL?: string;
  ollamaModelId?: string;
  openaiCompatibleBaseURL?: string;
  openaiCompatibleModelId?: string;
  openaiCompatibleContextLimit?: number;
  openrouterModelId?: string;
  planMode?: boolean;
  projectMemory?: string | null;
  /** User's "deep thinking" toggle. Layered over model capability — ignored for
   *  always-thinking and non-thinking models. */
  thinkingEnabled?: boolean;
  uiMessages: UIMessage[];
  abortSignal?: AbortSignal;
};

export async function runAgentStream(opts: RunAgentOptions) {
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;
  const model = await buildConfiguredLanguageModel(modelId, opts.keys, {
    lmstudioBaseURL: opts.lmstudioBaseURL,
    lmstudioModelId: opts.lmstudioModelId,
    mlxBaseURL: opts.mlxBaseURL,
    mlxModelId: opts.mlxModelId,
    ollamaBaseURL: opts.ollamaBaseURL,
    ollamaModelId: opts.ollamaModelId,
    openaiCompatibleBaseURL: opts.openaiCompatibleBaseURL,
    openaiCompatibleModelId: opts.openaiCompatibleModelId,
    openrouterModelId: opts.openrouterModelId,
  });
  const provider = getModel(modelId).provider;

  const stableSystem = buildStableSystem(
    modelId,
    opts.agentPersona ?? null,
    opts.customInstructions,
    opts.projectMemory ?? null,
  );

  const history = await convertToModelMessages(opts.uiMessages);
  const prunedHistory = pruneMessages({
    messages: history,
    reasoning: modelKeepsReasoning(modelId) ? "none" : "before-last-message",
    emptyMessages: "remove",
  });
  const compact = compactModelMessagesDetailed(
    prunedHistory,
    getModelContextLimit(
      getModel(modelId).id,
      opts.openaiCompatibleContextLimit,
    ),
  );
  const compactedHistory = compact.messages;
  if (compact.compacted) {
    opts.onCompact?.({ droppedCount: compact.droppedCount });
  }

  const messages: ModelMessage[] = [{ role: "system", content: stableSystem }];
  if (opts.planMode) {
    messages.push({ role: "system", content: PLAN_MODE_PROMPT });
  }
  messages.push(...compactedHistory);

  const finalMessages = applyCacheBreakpoints(messages, provider);

  const thinkingProviderOptions = buildThinkingProviderOptions(
    provider,
    resolveThinkingEnabled(getModel(modelId).id, opts.thinkingEnabled ?? false),
  );

  let stepsSeen = 0;
  return streamText({
    model,
    messages: finalMessages,
    tools: buildTools(opts.toolContext),
    ...(thinkingProviderOptions
      ? { providerOptions: thinkingProviderOptions }
      : {}),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    abortSignal: opts.abortSignal,
    onStepFinish: (step) => {
      stepsSeen++;
      if (opts.onStep) {
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) {
          const label = TOOL_LABELS[last.toolName];
          opts.onStep(
            label
              ? label((last.input ?? {}) as Record<string, unknown>)
              : `Calling ${last.toolName}`,
          );
        } else if (step.text) {
          opts.onStep("Writing");
        }
      }
      if (opts.onUsage && step.usage) {
        const u = step.usage;
        const stepInput = u.inputTokens ?? 0;
        const stepCached = u.inputTokenDetails?.cacheReadTokens ?? 0;
        opts.onUsage({
          inputTokens: stepInput,
          outputTokens: u.outputTokens ?? 0,
          cachedInputTokens: stepCached,
          lastInputTokens: stepInput,
          lastCachedTokens: stepCached,
        });
      }
    },
    onFinish: (result) => {
      opts.onStep?.(null);
      const finishReason =
        (result as { finishReason?: string } | undefined)?.finishReason ?? "";
      opts.onFinishMeta?.({
        hitStepCap: stepsSeen >= MAX_AGENT_STEPS,
        finishReason,
      });
    },
  });
}

export { EMPTY_USAGE };
