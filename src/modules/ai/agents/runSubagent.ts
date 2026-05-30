import { generateText, stepCountIs } from "ai";
import {
  DEFAULT_MODEL_ID,
  getModel,
  providerNeedsKey,
  type ModelId,
} from "../config";
import {
  buildConfiguredLanguageModel,
  type LocalProviderConfig,
} from "../lib/agent";
import type { ProviderKeys } from "../lib/keyring";
import type { ToolContext } from "../tools/context";
import { buildFsTools } from "../tools/fs";
import { buildSearchTools } from "../tools/search";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  /** Caller's model — the fallback when the subagent has no bound model, or
   *  when its bound model's provider has no configured key. */
  modelId: ModelId;
  toolContext: ToolContext;
  /** Local/gateway provider config (base URLs + runtime model ids). Needed so
   *  a subagent can run on lmstudio/mlx/ollama/openrouter/openai-compatible
   *  models, whether bound or inherited from the caller. */
  local?: LocalProviderConfig;
  onStep?: (label: string) => void;
};

type RunResult = {
  summary: string;
  stepCount: number;
  durationMs: number;
  /** The model the subagent actually ran on (after key-aware resolution). */
  modelId: ModelId;
};

/** Bound model wins only when its provider has a usable key; otherwise fall
 *  back to the caller's model so a subagent never dies for a missing key. */
function resolveModelId(
  bound: ModelId | undefined,
  fallback: ModelId,
  keys: ProviderKeys,
): ModelId {
  if (!bound) return fallback;
  const provider = getModel(bound).provider;
  const hasKey = !providerNeedsKey(provider) || !!keys[provider];
  return hasKey ? bound : fallback;
}

export async function runSubagent({
  type,
  prompt,
  keys,
  modelId,
  toolContext,
  local,
  onStep,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const readOnly: Record<string, unknown> = {
    ...buildFsTools(toolContext),
    ...buildSearchTools(toolContext),
  };
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in readOnly) tools[t] = readOnly[t];
  }

  const resolvedModelId = resolveModelId(def.model, modelId, keys);
  const model = await buildConfiguredLanguageModel(
    resolvedModelId,
    keys,
    local ?? {},
  );

  const start = Date.now();
  const result = await generateText({
    model,
    system: def.systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
    onStepFinish: (step) => {
      if (!onStep) return;
      const last = step.toolCalls?.[step.toolCalls.length - 1];
      if (last) onStep(`${type}: ${last.toolName}`);
    },
  });

  return {
    summary: result.text || "(no output)",
    stepCount: result.steps?.length ?? 0,
    durationMs: Date.now() - start,
    modelId: resolvedModelId,
  };
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
