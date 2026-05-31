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

import { useExecutorStore } from "./executorStore";

function reset() {
  useExecutorStore.setState({ active: null, pendingReviews: [] });
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
