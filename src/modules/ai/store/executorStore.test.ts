import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the native FS layer so revert logic can be tested without Tauri.
const writeFile = vi.fn<(path: string, content: string) => Promise<void>>();
const deleteFile = vi.fn<(path: string) => Promise<void>>();
vi.mock("../lib/native", () => ({
  native: {
    writeFile: (p: string, c: string) => writeFile(p, c),
    deleteFile: (p: string) => deleteFile(p),
  },
}));

// In-memory stand-in for tauri-plugin-store's LazyStore, so persistence and
// crash-recovery can be exercised without Tauri. JSON round-trips on get/set
// mirror the real plugin's serialization (and catch aliasing bugs).
const { storeData } = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    constructor(_path: string, _opts?: unknown) {}
    async get<T>(key: string): Promise<T | undefined> {
      const v = storeData.get(key);
      return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      storeData.set(key, JSON.parse(JSON.stringify(value)));
    }
    async save(): Promise<void> {}
  },
}));

import { useExecutorStore, type ExecutorRun } from "./executorStore";

const DISK_KEY = "executor:pendingRuns";
function disk(): ExecutorRun[] {
  return (storeData.get(DISK_KEY) as ExecutorRun[] | undefined) ?? [];
}
/**
 * Drain the store's serialized write queue. loadPersistedRuns enqueues its read
 * at the tail of that queue and awaits it, so once it resolves every prior
 * fire-and-forget persist/remove has run. (It also reloads pendingReviews;
 * callers that want a clean slate overwrite state afterward.)
 */
async function flushPersistence(): Promise<void> {
  await useExecutorStore.getState().loadPersistedRuns();
}

function reset() {
  useExecutorStore.setState({ active: null, pendingReviews: [] });
  storeData.clear();
  writeFile.mockReset().mockResolvedValue(undefined);
  deleteFile.mockReset().mockResolvedValue(undefined);
}

describe("executorStore — run lifecycle", () => {
  beforeEach(reset);

  it("snapshots only the first touch of a path", () => {
    const s = useExecutorStore.getState();
    s.beginRun("test");
    s.snapshot("/a.ts", "v1", false);
    s.snapshot("/a.ts", "v2", false); // later edit — must NOT overwrite snapshot
    const run = useExecutorStore.getState().active!;
    expect(run.snapshots["/a.ts"].before).toBe("v1");
  });

  it("moves a touched run to pendingReviews on endRun", () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/a.ts", "orig", false);
    s.endRun(id);
    const st = useExecutorStore.getState();
    expect(st.active).toBeNull();
    expect(st.pendingReviews).toHaveLength(1);
    expect(st.pendingReviews[0].id).toBe(id);
  });

  it("does not queue a review for a run that touched nothing", () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("noop");
    s.endRun(id);
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("queues a review for a commands-only run", () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("cmd");
    s.recordCommand({ command: "pnpm test", cwd: null, exitCode: 0 });
    s.endRun(id);
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(1);
  });
});

describe("executorStore — revert", () => {
  beforeEach(reset);

  it("revertAll restores edited files and deletes new files", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/edited.ts", "before-content", false);
    s.snapshot("/created.ts", "", true);
    s.endRun(id);

    await useExecutorStore.getState().revertAll(id);

    expect(writeFile).toHaveBeenCalledWith("/edited.ts", "before-content");
    expect(deleteFile).toHaveBeenCalledWith("/created.ts");
    expect(deleteFile).not.toHaveBeenCalledWith("/edited.ts");
    // Review consumed.
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("revertOne reverts a single file and keeps the rest in review", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/a.ts", "a-before", false);
    s.snapshot("/b.ts", "b-before", false);
    s.endRun(id);

    await useExecutorStore.getState().revertOne(id, "/a.ts");

    expect(writeFile).toHaveBeenCalledWith("/a.ts", "a-before");
    const run = useExecutorStore.getState().pendingReviews[0];
    expect(run.snapshots["/a.ts"]).toBeUndefined();
    expect(run.snapshots["/b.ts"]).toBeDefined();
  });

  it("revertOne drops the whole review once the last file is handled", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/only.ts", "x", false);
    s.endRun(id);

    await useExecutorStore.getState().revertOne(id, "/only.ts");
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("keepAll drops the review without touching disk", () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/a.ts", "x", false);
    s.endRun(id);

    useExecutorStore.getState().keepAll(id);
    expect(writeFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("keepOne retains a commands-only run until commands are the only thing left", () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("test");
    s.snapshot("/a.ts", "x", false);
    s.recordCommand({ command: "pnpm test", cwd: null, exitCode: 0 });
    s.endRun(id);

    // Keeping the only file still leaves a run with recorded commands.
    useExecutorStore.getState().keepOne(id, "/a.ts");
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(1);
  });
});

describe("executorStore — persistence & crash recovery (Phase 2.1)", () => {
  beforeEach(reset);

  it("persists each first-touch snapshot to disk during the run", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("running");
    s.snapshot("/a.ts", "a-before", false);
    s.snapshot("/b.ts", "", true);
    s.recordCommand({ command: "pnpm test", cwd: "/", exitCode: null });

    await flushPersistence();

    const persisted = disk().find((r) => r.id === id);
    expect(persisted).toBeDefined();
    expect(persisted!.snapshots["/a.ts"].before).toBe("a-before");
    expect(persisted!.snapshots["/b.ts"].wasNew).toBe(true);
    expect(persisted!.commands).toHaveLength(1);
  });

  it("recovers an interrupted (crashed mid-run) run on reload, as reviewable", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("interrupted");
    s.snapshot("/x.ts", "before", false);

    // Flush fire-and-forget persists, then simulate a crash: in-memory state is
    // gone, but the persisted store survives on disk. The run never reached
    // endRun, so on disk it still has awaitingReview === false.
    await flushPersistence();
    useExecutorStore.setState({ active: null, pendingReviews: [] });
    expect(disk().find((r) => r.id === id)?.awaitingReview).toBe(false);

    // Relaunch.
    await useExecutorStore.getState().loadPersistedRuns();
    const recovered = useExecutorStore
      .getState()
      .pendingReviews.find((r) => r.id === id);
    expect(recovered).toBeDefined();
    expect(recovered!.awaitingReview).toBe(true); // forced reviewable on load
    expect(recovered!.snapshots["/x.ts"].before).toBe("before");
  });

  it("keepAll clears disk so the run cannot resurrect on reload (race fix)", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("kept");
    s.snapshot("/a.ts", "x", false);
    s.endRun(id); // enqueues a persist

    // keepAll enqueues a remove right after; the serialized queue guarantees
    // remove runs after persist, so disk ends empty (no zombie review).
    useExecutorStore.getState().keepAll(id);

    await flushPersistence();
    expect(disk().find((r) => r.id === id)).toBeUndefined();

    useExecutorStore.setState({ active: null, pendingReviews: [] });
    await useExecutorStore.getState().loadPersistedRuns();
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("revertAll clears disk so the run cannot resurrect on reload", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("reverted");
    s.snapshot("/a.ts", "a-before", false);
    s.endRun(id);

    await useExecutorStore.getState().revertAll(id); // awaits removePersisted
    expect(disk().find((r) => r.id === id)).toBeUndefined();

    useExecutorStore.setState({ active: null, pendingReviews: [] });
    await useExecutorStore.getState().loadPersistedRuns();
    expect(useExecutorStore.getState().pendingReviews).toHaveLength(0);
  });

  it("does not persist a run that touched nothing", async () => {
    const s = useExecutorStore.getState();
    const id = s.beginRun("noop");
    s.endRun(id);

    await flushPersistence();
    expect(disk()).toHaveLength(0);
  });
});
