import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mac: false,
  effects: [] as Array<() => () => void>,
}));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => state.effects.push(effect),
}));
vi.mock("@/lib/platform", () => ({
  get IS_MAC() {
    return state.mac;
  },
  get IS_WINDOWS() {
    return !state.mac;
  },
  get MOD_PROP() {
    return state.mac ? "meta" : "ctrl";
  },
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: unknown) => unknown) =>
    select({ shortcuts: {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: () => Promise.resolve(() => {}) }),
}));
class TestKey extends Event {
  key = "f";
  code = "KeyF";
  metaKey = state.mac;
  ctrlKey = !state.mac;
  altKey = false;
  shiftKey = false;
  repeat = false;
  constructor() {
    super("keydown", { cancelable: true });
  }
}
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

describe("PDF find shortcut", () => {
  it.each([true, false])(
    "dispatches search and prevents the webview default on macOS=%s",
    async (mac) => {
      state.mac = mac;
      state.effects = [];
      vi.resetModules();
      vi.stubGlobal("window", new EventTarget());
      const { useGlobalShortcuts } = await import(
        "@/modules/shortcuts/lib/useGlobalShortcuts"
      );
      const openSearch = vi.fn();
      useGlobalShortcuts({ "search.focus": openSearch });
      cleanup = state.effects[0]();
      const key = new TestKey();
      window.dispatchEvent(key);
      expect(key.defaultPrevented).toBe(true);
      expect(openSearch).toHaveBeenCalledOnce();
      const repeat = new TestKey();
      repeat.repeat = true;
      window.dispatchEvent(repeat);
      expect(openSearch).toHaveBeenCalledOnce();
    },
  );
});
