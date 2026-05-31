import { tool } from "ai";
import { z } from "zod";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { runSubagent } from "../agents/runSubagent";
import { SUBAGENTS, type SubagentType } from "../agents/registry";
import { useChatStore } from "../store/chatStore";
import type { ToolContext } from "./context";

const TYPE_KEYS = Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]];

export function buildSubagentTools(ctx: ToolContext) {
  return {
    run_subagent: tool({
      description: `Spawn an isolated subagent with its own restricted toolset and a fresh message history. Delegate a self-contained job (large search, code review, security audit, architecture advice, or an end-to-end code change) without polluting your own context. The subagent returns a single text summary; pick a 'type' that matches its job.

Types:
${TYPE_KEYS.map((k) => `- ${k}: ${SUBAGENTS[k].description}`).join("\n")}

Most types are read-only and auto-execute. The 'executor' type writes files and runs commands directly; its file changes are snapshotted and surfaced to the user for review/revert after it finishes.`,
      inputSchema: z.object({
        type: z.enum(TYPE_KEYS),
        prompt: z
          .string()
          .describe(
            "Self-contained instruction. The subagent has no memory of prior conversation — include all relevant context.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short label shown in the chat UI for the spawn card."),
      }),
      execute: async ({ type, prompt, description }) => {
        const { apiKeys, selectedModelId, patchAgentMeta, openMini } =
          useChatStore.getState();
        const prefs = usePreferencesStore.getState();
        try {
          const r = await runSubagent({
            type,
            prompt,
            keys: apiKeys,
            modelId: selectedModelId,
            modelOverride: prefs.subagentModelOverrides[type],
            toolContext: ctx,
            local: {
              lmstudioBaseURL: prefs.lmstudioBaseURL,
              lmstudioModelId: prefs.lmstudioModelId,
              mlxBaseURL: prefs.mlxBaseURL,
              mlxModelId: prefs.mlxModelId,
              ollamaBaseURL: prefs.ollamaBaseURL,
              ollamaModelId: prefs.ollamaModelId,
              openaiCompatibleBaseURL: prefs.openaiCompatibleBaseURL,
              openaiCompatibleModelId: prefs.openaiCompatibleModelId,
              openrouterModelId: prefs.openrouterModelId,
            },
            onStep: (label) => patchAgentMeta({ step: label }),
          });
          // Surface the executor's review (snapshot diff) by opening the mini
          // window when it touched files.
          if (r.filesTouched.length > 0) openMini();
          return {
            type,
            description,
            model: r.modelId,
            summary: r.summary,
            stepCount: r.stepCount,
            durationMs: r.durationMs,
            ...(r.filesTouched.length > 0
              ? { filesTouched: r.filesTouched }
              : {}),
          };
        } catch (e) {
          return { error: String(e), type };
        }
      },
    }),
  } as const;
}
