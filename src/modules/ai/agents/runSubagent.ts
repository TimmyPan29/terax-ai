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
import { buildExecutorTools } from "../tools/executorTools";
import { useExecutorStore } from "../store/executorStore";
import { SUBAGENTS, type SubagentType } from "./registry";

const SUBAGENT_MAX_STEPS = 12;
// The executor writes + tests + iterates, so it needs more headroom than a
// read-only investigator.
const EXECUTOR_MAX_STEPS = 40;

type Args = {
  type: SubagentType;
  prompt: string;
  keys: ProviderKeys;
  /** Caller's model — the fallback when the subagent has no bound model, or
   *  when its bound model's provider has no configured key. */
  modelId: ModelId;
  /** User-configured model for this subagent type (Settings → Agents). When
   *  set, it takes precedence over the type's built-in default. */
  modelOverride?: ModelId;
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
  /** Files the executor touched this run (canonical paths). Empty for
   *  read-only subagents. The caller surfaces these for review. */
  filesTouched: string[];
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
  modelOverride,
  toolContext,
  local,
  onStep,
}: Args): Promise<RunResult> {
  const def = SUBAGENTS[type];
  if (!def) throw new Error(`unknown subagent type: ${type}`);

  const isExecutor = def.writable === true;

  // Executor gets the full read+write+shell toolset; read-only subagents get
  // the filtered read-only set. The whitelist in def.tools still gates which
  // tools are actually exposed (so an executor without "bash_run" can't run it).
  const available: Record<string, unknown> = isExecutor
    ? buildExecutorTools(toolContext)
    : { ...buildFsTools(toolContext), ...buildSearchTools(toolContext) };
  const tools: Record<string, unknown> = {};
  for (const t of def.tools) {
    if (t in available) tools[t] = available[t];
  }

  // User override (Settings) beats the type's built-in default; both still go
  // through key-aware resolution so a missing key falls back to the caller's.
  const resolvedModelId = resolveModelId(
    modelOverride ?? def.model,
    modelId,
    keys,
  );
  const model = await buildConfiguredLanguageModel(
    resolvedModelId,
    keys,
    local ?? {},
  );

  const runId = isExecutor
    ? useExecutorStore.getState().beginRun(def.label)
    : null;

  const start = Date.now();
  try {
    const result = await generateText({
      model,
      system: def.systemPrompt,
      prompt,
      tools: tools as Parameters<typeof generateText>[0]["tools"],
      stopWhen: stepCountIs(
        isExecutor ? EXECUTOR_MAX_STEPS : SUBAGENT_MAX_STEPS,
      ),
      onStepFinish: (step) => {
        if (!onStep) return;
        const last = step.toolCalls?.[step.toolCalls.length - 1];
        if (last) onStep(`${type}: ${last.toolName}`);
      },
    });

    const finished = runId
      ? useExecutorStore.getState().endRun(runId)
      : null;

    return {
      summary: result.text || "(no output)",
      stepCount: result.steps?.length ?? 0,
      durationMs: Date.now() - start,
      modelId: resolvedModelId,
      filesTouched: finished ? Object.keys(finished.snapshots) : [],
    };
  } catch (e) {
    // Surface whatever the executor already changed for review even on failure.
    if (runId) useExecutorStore.getState().endRun(runId);
    throw e;
  }
}

export const DEFAULT_SUBAGENT_MODEL: ModelId = DEFAULT_MODEL_ID;
