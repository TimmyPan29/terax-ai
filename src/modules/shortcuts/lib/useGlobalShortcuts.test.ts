import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effects: [] as Array<() => () => void>,
  native: new Map<string, () => void>(),
  listen: vi.fn(),
  shortcuts: {} as Record<
    string,
    import("@/modules/shortcuts/shortcuts").KeyBinding[]
  >,
}));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => state.effects.push(effect),
}));
vi.mock("@/lib/platform", () => ({ IS_MAC: true, MOD_PROP: "meta" }));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (s: unknown) => unknown) =>
    select({ shortcuts: state.shortcuts }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: state.listen }),
}));
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";

class TestKeyboardEvent extends Event {
  code = "";
  key: string;
  metaKey: boolean;
  ctrlKey = false;
  altKey = false;
  shiftKey = false;
  repeat = false;
  constructor(type: string, init: { key: string; metaKey?: boolean }) {
    super(type, { cancelable: true });
    this.key = init.key;
    this.metaKey = init.metaKey ?? false;
  }
}
let cleanup: (() => void) | undefined;
beforeEach(() => {
  state.effects = [];
  state.shortcuts = {};
  state.native.clear();
  state.listen.mockReset();
  state.listen.mockImplementation((_event, callback) => {
    state.native.set(_event, callback);
    return Promise.resolve(vi.fn());
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("KeyboardEvent", TestKeyboardEvent);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

function mount(close = vi.fn(), isDisabled = vi.fn(() => false)) {
  // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise effect registration and cleanup.
  useGlobalShortcuts({ "tab.close": close }, { isDisabled });
  cleanup = state.effects[0]();
  return close;
}

describe("native pane close", () => {
  it("closes through the existing handler without a parent DOM key event", () => {
    const close = mount();
    state.native.get("terax:close-pane")?.();
    expect(close).toHaveBeenCalledOnce();
    expect(state.listen).toHaveBeenCalledWith(
      "terax:close-pane",
      expect.any(Function),
    );
  });
  it("leaves DOM Cmd+W to the native menu so one press cannot close two panes", () => {
    const close = mount();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", metaKey: true }),
    );
    expect(close).not.toHaveBeenCalled();
    state.native.get("terax:close-pane")?.();
    expect(close).toHaveBeenCalledOnce();
  });
  it("respects disabled shortcuts", () => {
    const close = mount(
      vi.fn(),
      vi.fn(() => true),
    );
    state.native.get("terax:close-pane")?.();
    expect(close).not.toHaveBeenCalled();
  });
  it("honors user bindings instead of forcing the default close action", () => {
    state.shortcuts = { "tab.close": [{ meta: true, key: "q" }] };
    const close = mount();
    state.native.get("terax:close-pane")?.();
    expect(close).not.toHaveBeenCalled();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "q", metaKey: true }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it("disposes listeners that finish registering after unmount", async () => {
    const off = vi.fn();
    const resolve = new Map<string, (off: () => void) => void>();
    state.listen.mockImplementation((_event, callback) => {
      state.native.set(_event, callback);
      return new Promise<() => void>((done) => {
        resolve.set(_event, done);
      });
    });
    const close = mount();
    cleanup?.();
    cleanup = undefined;
    state.native.get("terax:close-pane")?.();
    for (const done of resolve.values()) done(off);
    await Promise.resolve();
    expect(off).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("native new terminal", () => {
  function mountNewTerminal(isDisabled = vi.fn(() => false)) {
    const create = vi.fn();
    const close = vi.fn();
    // biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked to exercise effect registration and cleanup.
    useGlobalShortcuts(
      { "tab.new": create, "tab.close": close },
      { isDisabled },
    );
    cleanup = state.effects[0]();
    return { create, close };
  }

  it("opens a terminal without a parent DOM key event from the PDF frame", () => {
    const { create, close } = mountNewTerminal();
    state.native.get("terax:new-terminal")?.();
    expect(create).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it("leaves DOM Cmd+T to the native menu so one press opens one terminal", () => {
    const { create } = mountNewTerminal();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "t", metaKey: true }),
    );
    expect(create).not.toHaveBeenCalled();
    state.native.get("terax:new-terminal")?.();
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps the close event separate from the new-terminal event", () => {
    const { create, close } = mountNewTerminal();
    state.native.get("terax:close-pane")?.();
    expect(close).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("honors disabled shortcuts", () => {
    const { create } = mountNewTerminal(vi.fn(() => true));
    state.native.get("terax:new-terminal")?.();
    expect(create).not.toHaveBeenCalled();
  });

  it("honors remapped new-terminal bindings", () => {
    state.shortcuts = { "tab.new": [{ meta: true, key: "y" }] };
    const { create } = mountNewTerminal();
    state.native.get("terax:new-terminal")?.();
    expect(create).not.toHaveBeenCalled();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "y", metaKey: true }),
    );
    expect(create).toHaveBeenCalledOnce();
  });

  it("removes both native listeners on unmount", async () => {
    const off = vi.fn();
    state.listen.mockImplementation((_event, callback) => {
      state.native.set(_event, callback);
      return Promise.resolve(off);
    });
    const { create, close } = mountNewTerminal();
    await Promise.resolve();
    cleanup?.();
    cleanup = undefined;
    state.native.get("terax:new-terminal")?.();
    state.native.get("terax:close-pane")?.();
    expect(off).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
