import { create } from "zustand";
import { native } from "../lib/native";

/**
 * Executor subagent run tracking + snapshot-based revert.
 *
 * The executor subagent (Phase 2) writes files and runs shell commands
 * directly (it runs via generateText, which does NOT honor the AI SDK's
 * `needsApproval` flag — see runSubagent). To keep terax's "every change is
 * reviewable" guarantee, we take a snapshot of each file the FIRST time the
 * executor touches it in a run, then surface the full set as an after-the-fact
 * diff the user can Keep or Revert.
 *
 * Shell commands cannot be snapshotted/reverted (side effects are not a diff);
 * per the user's "全部放行" choice they run without a gate, but every command
 * is recorded here so the review surface shows what the executor did.
 */

export type FileSnapshot = {
  path: string;
  /** Content before the executor's first touch this run. "" for new files. */
  before: string;
  /** True if the file did not exist when first touched (revert => delete). */
  wasNew: boolean;
};

export type ExecutorCommand = {
  command: string;
  cwd: string | null;
  exitCode: number | null;
};

export type ExecutorRun = {
  id: string;
  /** run_subagent description, shown as the review header. */
  label: string;
  startedAt: number;
  finishedAt: number | null;
  /** Snapshots keyed by canonical path; one per touched file (first touch). */
  snapshots: Record<string, FileSnapshot>;
  /** Shell commands the executor ran, in order. Display-only. */
  commands: ExecutorCommand[];
  /** Set once the run ends and the review surface should show. */
  awaitingReview: boolean;
};

export type RevertResult = { path: string; ok: boolean; error?: string };

type ExecutorState = {
  /** The currently-running executor run, if any. Only one at a time. */
  active: ExecutorRun | null;
  /** Finished runs awaiting user review (most recent first). */
  pendingReviews: ExecutorRun[];

  /** Begin a run. Returns the run id. */
  beginRun: (label: string) => string;
  /**
   * Record a snapshot for a path if this run hasn't seen it yet. Idempotent
   * per path: only the FIRST touch is captured, so revert restores the
   * pre-run state regardless of how many times the executor edits the file.
   * No-op if there is no active run (defensive).
   */
  snapshot: (path: string, before: string, wasNew: boolean) => void;
  /** Record a shell command the executor ran (display-only). */
  recordCommand: (cmd: ExecutorCommand) => void;
  /** End the active run; moves it to pendingReviews if it touched anything. */
  endRun: (id: string) => ExecutorRun | null;

  /** Revert every snapshot in a pending run, then drop it from review. */
  revertAll: (runId: string) => Promise<RevertResult[]>;
  /** Revert a single file in a pending run; drops that snapshot. */
  revertOne: (runId: string, path: string) => Promise<RevertResult>;
  /** Accept all changes in a run: just drop it from review (files stay). */
  keepAll: (runId: string) => void;
  /** Accept a single file: drop its snapshot from the run. */
  keepOne: (runId: string, path: string) => void;
};

let runSeq = 1;
function newRunId(): string {
  return `exec-${Date.now().toString(36)}-${(runSeq++).toString(36)}`;
}

/** Restore one snapshot to disk: rewrite original content, or delete if new. */
async function applyRevert(snap: FileSnapshot): Promise<RevertResult> {
  try {
    if (snap.wasNew) {
      await native.deleteFile(snap.path);
    } else {
      await native.writeFile(snap.path, snap.before);
    }
    return { path: snap.path, ok: true };
  } catch (e) {
    return { path: snap.path, ok: false, error: String(e) };
  }
}

export const useExecutorStore = create<ExecutorState>((set, get) => ({
  active: null,
  pendingReviews: [],

  beginRun: (label) => {
    const id = newRunId();
    set({
      active: {
        id,
        label,
        startedAt: Date.now(),
        finishedAt: null,
        snapshots: {},
        commands: [],
        awaitingReview: false,
      },
    });
    return id;
  },

  snapshot: (path, before, wasNew) => {
    const active = get().active;
    if (!active) return;
    if (active.snapshots[path]) return; // first touch only
    set({
      active: {
        ...active,
        snapshots: {
          ...active.snapshots,
          [path]: { path, before, wasNew },
        },
      },
    });
  },

  recordCommand: (cmd) => {
    const active = get().active;
    if (!active) return;
    set({
      active: { ...active, commands: [...active.commands, cmd] },
    });
  },

  endRun: (id) => {
    const active = get().active;
    if (!active || active.id !== id) {
      // Stale end (e.g. superseded run). Clear active if it matches nothing.
      return null;
    }
    const finished: ExecutorRun = {
      ...active,
      finishedAt: Date.now(),
      awaitingReview:
        Object.keys(active.snapshots).length > 0 ||
        active.commands.length > 0,
    };
    set({
      active: null,
      pendingReviews: finished.awaitingReview
        ? [finished, ...get().pendingReviews]
        : get().pendingReviews,
    });
    return finished;
  },

  revertAll: async (runId) => {
    const run = get().pendingReviews.find((r) => r.id === runId);
    if (!run) return [];
    const snaps = Object.values(run.snapshots);
    const results: RevertResult[] = [];
    for (const s of snaps) results.push(await applyRevert(s));
    set({ pendingReviews: get().pendingReviews.filter((r) => r.id !== runId) });
    return results;
  },

  revertOne: async (runId, path) => {
    const run = get().pendingReviews.find((r) => r.id === runId);
    const snap = run?.snapshots[path];
    if (!run || !snap) {
      return { path, ok: false, error: "snapshot not found" };
    }
    const result = await applyRevert(snap);
    const { [path]: _dropped, ...rest } = run.snapshots;
    const stillHasWork =
      Object.keys(rest).length > 0 || run.commands.length > 0;
    set({
      pendingReviews: stillHasWork
        ? get().pendingReviews.map((r) =>
            r.id === runId ? { ...r, snapshots: rest } : r,
          )
        : get().pendingReviews.filter((r) => r.id !== runId),
    });
    return result;
  },

  keepAll: (runId) => {
    set({ pendingReviews: get().pendingReviews.filter((r) => r.id !== runId) });
  },

  keepOne: (runId, path) => {
    const run = get().pendingReviews.find((r) => r.id === runId);
    if (!run) return;
    const { [path]: _dropped, ...rest } = run.snapshots;
    const stillHasWork =
      Object.keys(rest).length > 0 || run.commands.length > 0;
    set({
      pendingReviews: stillHasWork
        ? get().pendingReviews.map((r) =>
            r.id === runId ? { ...r, snapshots: rest } : r,
          )
        : get().pendingReviews.filter((r) => r.id !== runId),
    });
  },
}));
