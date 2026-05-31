import { create } from "zustand";
import { native } from "../lib/native";
import { LazyStore } from "@tauri-apps/plugin-store";

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
 *
 * Snapshots persist to tauri-plugin-store (Phase 2.1), so they survive app
 * crashes. On startup, persisted runs are loaded into pendingReviews.
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

  /** Load persisted runs from disk (called on app startup). */
  loadPersistedRuns: () => Promise<void>;
};

const EXECUTOR_STORE_KEY = "executor:pendingRuns";
let persistedStore: LazyStore | null = null;

async function getStore(): Promise<LazyStore> {
  if (!persistedStore) {
    persistedStore = new LazyStore(".executor.json", {
      defaults: {},
      autoSave: 300,
    });
  }
  return persistedStore;
}

async function persistRun(run: ExecutorRun): Promise<void> {
  try {
    const store = await getStore();
    const runs = (await store.get<ExecutorRun[]>(EXECUTOR_STORE_KEY)) || [];
    const idx = runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      runs[idx] = run;
    } else {
      runs.unshift(run);
    }
    await store.set(EXECUTOR_STORE_KEY, runs);
    await store.save();
  } catch (e) {
    console.error("[executorStore] Failed to persist run:", e);
  }
}

async function removePersisted(runId: string): Promise<void> {
  try {
    const store = await getStore();
    const runs = (await store.get<ExecutorRun[]>(EXECUTOR_STORE_KEY)) || [];
    const filtered = runs.filter((r) => r.id !== runId);
    if (filtered.length !== runs.length) {
      await store.set(EXECUTOR_STORE_KEY, filtered);
      await store.save();
    }
  } catch (e) {
    console.error("[executorStore] Failed to remove persisted run:", e);
  }
}

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


export const useExecutorStore = create<ExecutorState>((set, get) => {
  // Load persisted runs immediately when store is created
  getStore()
    .then(async (store) => {
      const runs = (await store.get<ExecutorRun[]>(EXECUTOR_STORE_KEY)) || [];
      const awaiting = runs.filter((r) => r.awaitingReview);
      if (awaiting.length > 0) {
        set({ pendingReviews: awaiting });
      }
    })
    .catch((e) => console.error("[executorStore] Failed to load on init:", e));

  return {
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
    if (finished.awaitingReview) {
      persistRun(finished).catch((e) =>
        console.error("[executorStore] endRun persist failed:", e),
      );
    }
    return finished;
  },

  revertAll: async (runId) => {
    const run = get().pendingReviews.find((r) => r.id === runId);
    if (!run) return [];
    const snaps = Object.values(run.snapshots);
    const results: RevertResult[] = [];
    for (const s of snaps) results.push(await applyRevert(s));
    set({ pendingReviews: get().pendingReviews.filter((r) => r.id !== runId) });
    await removePersisted(runId);
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
    if (stillHasWork) {
      const updated = { ...run, snapshots: rest };
      set({
        pendingReviews: get().pendingReviews.map((r) =>
          r.id === runId ? updated : r,
        ),
      });
      await persistRun(updated);
    } else {
      set({
        pendingReviews: get().pendingReviews.filter((r) => r.id !== runId),
      });
      await removePersisted(runId);
    }
    return result;
  },

  keepAll: (runId) => {
    set({ pendingReviews: get().pendingReviews.filter((r) => r.id !== runId) });
    removePersisted(runId).catch((e) =>
      console.error("[executorStore] keepAll remove failed:", e),
    );
  },

  keepOne: (runId, path) => {
    const run = get().pendingReviews.find((r) => r.id === runId);
    if (!run) return;
    const { [path]: _dropped, ...rest } = run.snapshots;
    const stillHasWork =
      Object.keys(rest).length > 0 || run.commands.length > 0;
    if (stillHasWork) {
      const updated = { ...run, snapshots: rest };
      set({
        pendingReviews: get().pendingReviews.map((r) =>
          r.id === runId ? updated : r,
        ),
      });
      persistRun(updated).catch((e) =>
        console.error("[executorStore] keepOne persist failed:", e),
      );
    } else {
      set({
        pendingReviews: get().pendingReviews.filter((r) => r.id !== runId),
      });
      removePersisted(runId).catch((e) =>
        console.error("[executorStore] keepOne remove failed:", e),
      );
    }
  },

  loadPersistedRuns: async () => {
    try {
      const store = await getStore();
      const runs = (await store.get<ExecutorRun[]>(EXECUTOR_STORE_KEY)) || [];
      const awaiting = runs.filter((r) => r.awaitingReview);
      if (awaiting.length > 0) {
        const existing = get().pendingReviews;
        // Dedup: merge persisted into current, preferring persisted (fresher).
        const merged = awaiting.concat(
          existing.filter((r) => !awaiting.find((p) => p.id === r.id)),
        );
        set({ pendingReviews: merged });
      }
    } catch (e) {
      console.error("[executorStore] Failed to load persisted runs:", e);
    }
  },
  };
});
