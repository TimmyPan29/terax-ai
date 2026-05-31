import type { ModelId } from "../config";

export type SubagentType =
  | "explore"
  | "code-review"
  | "security"
  | "general"
  | "architect"
  | "executor";

export type SubagentDef = {
  id: SubagentType;
  label: string;
  description: string;
  /**
   * Whitelist of tools the subagent may call. Excludes mutating tools and
   * `run_subagent` itself to prevent recursion. The runner filters down the
   * main toolset to this list before constructing the inner Agent.
   */
  tools: string[];
  systemPrompt: string;
  /**
   * Optional per-agent model. When set AND the user has a key for its
   * provider, the subagent runs on this model; otherwise it inherits the
   * caller's model (so a subagent never fails just for a missing key). Lets a
   * read-heavy agent (explore) run on a cheap long-context model while
   * review/security stay on a strong one. The handoff happens at the task
   * boundary, so per-provider prompt caches are not disturbed. Left undefined
   * for all built-ins by default: zero behavior change until configured.
   */
  model?: ModelId;
  /**
   * When true, this subagent gets the executor toolset (write/edit/bash that
   * apply immediately, snapshotted for after-the-fact review) instead of the
   * read-only set. Only the `executor` agent sets this. See executorTools.ts.
   */
  writable?: boolean;
};

const READ_ONLY_TOOLS = ["read_file", "list_directory", "grep", "glob"];
const EXECUTOR_TOOLS = [
  "read_file",
  "list_directory",
  "grep",
  "glob",
  "write_file",
  "edit",
  "multi_edit",
  "create_directory",
  "bash_run",
];

export const SUBAGENTS: Record<SubagentType, SubagentDef> = {
  explore: {
    id: "explore",
    label: "Explore",
    description:
      "Read-only codebase explorer. Locates files, traces references, summarizes architecture.",
    tools: READ_ONLY_TOOLS,
    // Read-heavy, high input volume: cheapest 1M-context tier.
    model: "deepseek-v4-flash",
    systemPrompt: `You are an exploration subagent. Your job is to answer the spawn question by READING the codebase only — no edits, no commands. Use grep/glob/list_directory/read_file. Be terse. Return a concise summary suitable for the main agent to act on (file paths, key findings, line numbers). Stop as soon as you can answer.`,
  },
  "code-review": {
    id: "code-review",
    label: "Code review",
    description:
      "Reviews changed code for correctness, architecture, performance, security.",
    tools: READ_ONLY_TOOLS,
    // Review / comparison: strongest reasoning for catching real defects.
    model: "gpt-5.5",
    systemPrompt: `You are a code-review subagent. Inspect the requested code and report only ACTIONABLE findings: correctness bugs, architecture violations, performance issues, security risks. Skip style/formatting. Format each finding as: "[MUST/SHOULD/NIT] file:line — issue → fix". If nothing is wrong, say "Looks good." Do NOT propose unrelated cleanups.`,
  },
  security: {
    id: "security",
    label: "Security review",
    description:
      "Audits code/configuration for security risks (auth, injection, secrets, etc).",
    tools: READ_ONLY_TOOLS,
    // High-stakes audit: strongest reasoning, false negatives are costly.
    model: "gpt-5.5",
    systemPrompt: `You are a security-review subagent. Scan the requested scope for: injection (SQL, shell, path), auth/authz bypass, secret leakage, missing validation at trust boundaries, unsafe deserialization, weak crypto. Report concrete findings with file:line and severity. Be conservative — false positives hurt more than missed nits. If nothing is wrong, say "No security issues found."`,
  },
  general: {
    id: "general",
    label: "General research",
    description:
      "General-purpose worker for multi-step research questions that span many files.",
    tools: READ_ONLY_TOOLS,
    // Bulk multi-file research: cheap tier.
    model: "deepseek-v4-flash",
    systemPrompt: `You are a general-purpose research subagent. Answer the spawn question by reading the codebase. Don't speculate — verify. Return a tight summary with the evidence you used (paths, line numbers).`,
  },
  architect: {
    id: "architect",
    label: "Architect",
    description:
      "Read-only architecture advisor. Evaluates design tradeoffs, module boundaries, and structural fit; proposes an approach without writing code.",
    tools: READ_ONLY_TOOLS,
    // Design judgment: strongest reasoning tier.
    model: "gpt-5.5",
    systemPrompt: `You are an architecture-advisor subagent. Read the relevant code, then answer the spawn question with a concrete design recommendation: where new logic should live, module/boundary impact, tradeoffs of the main options, and risks. Do NOT write or edit code — your output is advice the main agent will act on. Be specific (file paths, function names) and decisive: recommend one option and say why. Keep it tight.`,
  },
  executor: {
    id: "executor",
    label: "Executor",
    description:
      "Writes code and runs tests autonomously. Use to implement a self-contained, well-specified change end to end (edit files, run the test/lint command, iterate). File changes apply immediately and are presented to the user for review/revert afterward; shell commands run without prompting. Give it an exact spec and the verify command.",
    tools: EXECUTOR_TOOLS,
    writable: true,
    // Code + tests: strongest coding model.
    model: "claude-opus-4-8",
    systemPrompt: `You are an execution subagent: a hands-on engineer. Implement the requested change end to end.
- Read before you edit (read_file is required before edit/multi_edit on a path).
- Make the change with edit/multi_edit/write_file. Changes apply to disk immediately.
- Verify: run the project's test/lint/build command via bash_run and fix what you broke. If the spawn prompt names a verify command, use it; otherwise infer it from the project (package.json scripts, etc.).
- Iterate until the change is correct and verification passes, or until you are blocked.
- Match the surrounding code style. Do not add unrequested changes, comments, or cleanups.
- Your changes are reviewed by the user afterward (snapshot diff + revert), so be precise; do not rely on an approval prompt.
Return a tight summary: what you changed (file paths), what you ran, and the verification result. State clearly if anything failed or is incomplete.`,
  },
};
