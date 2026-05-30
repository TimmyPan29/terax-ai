import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Terminal } from "@xterm/xterm";
import {
  createShellIntegrationState,
  registerClipboardHandler,
  registerCwdHandler,
  registerPromptTracker,
} from "./osc-handlers";

/**
 * Minimal in-memory fake of the xterm `Terminal` surface we touch — just
 * enough to register OSC handlers and invoke them with crafted payloads.
 * The OSC handler signature is `(data: string) => boolean | Promise<boolean>`.
 */
type OscHandler = (data: string) => boolean | Promise<boolean>;

function makeFakeTerm() {
  const handlers = new Map<number, OscHandler>();
  const term = {
    parser: {
      registerOscHandler(code: number, handler: OscHandler) {
        handlers.set(code, handler);
        return { dispose: () => handlers.delete(code) };
      },
    },
    registerMarker: vi.fn().mockReturnValue({ isDisposed: false, dispose: vi.fn() }),
  } as unknown as Terminal;
  return { term, handlers };
}

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: {
    getState: vi.fn(() => ({
      terminalOsc52Clipboard: true,
    })),
  },
}));

describe("OSC 7 cwd handler — gated by OSC 133 in-command state", () => {
  it("accepts OSC 7 when no command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // OSC 133 A means "new prompt is about to be drawn" — we're between
    // commands and OSC 7 from the shell is legitimate here.
    handlers.get(133)?.("A");
    handlers.get(7)?.("file://host/home/me/project");

    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("rejects OSC 7 emitted while a command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    // Simulate: user runs `ssh attacker.host`, which prints attacker bytes
    // including an OSC 7 trying to silently move the AI's cwd into /etc.
    handlers.get(133)?.("A"); // prompt drawn
    handlers.get(133)?.("B"); // command begins (user hit enter)
    handlers.get(7)?.("file://host/etc"); // attacker injection

    expect(onCwd).not.toHaveBeenCalled();
  });

  it("re-accepts OSC 7 after command finishes (OSC 133 D)", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    const onCwd = vi.fn();
    registerPromptTracker(term, state);
    registerCwdHandler(term, onCwd, state);

    handlers.get(133)?.("A");
    handlers.get(133)?.("B"); // running
    handlers.get(7)?.("file://host/etc"); // blocked
    handlers.get(133)?.("D;0"); // command exited
    handlers.get(7)?.("file://host/home/me/new-cwd"); // legitimate post-cmd OSC 7

    expect(onCwd).toHaveBeenCalledTimes(1);
    expect(onCwd).toHaveBeenCalledWith("/home/me/new-cwd");
  });

  it("works without state for backwards compatibility (legacy callers)", () => {
    // The state parameter is optional — when omitted, OSC 7 is always
    // honored (legacy behavior). Tests must confirm we didn't break this.
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file://host/home/me/project");
    expect(onCwd).toHaveBeenCalledWith("/home/me/project");
  });

  it("normalizes Windows drive-letter OSC 7 paths", () => {
    const { term, handlers } = makeFakeTerm();
    const onCwd = vi.fn();
    registerCwdHandler(term, onCwd);

    handlers.get(7)?.("file:///C:/Users/me/project");
    expect(onCwd).toHaveBeenCalledWith("C:/Users/me/project");
  });
});

// ---------------------------------------------------------------------------
// OSC 52 clipboard handler
// ---------------------------------------------------------------------------

describe("OSC 52 clipboard handler", () => {
  const writeTextMock = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

  beforeEach(() => {
    writeTextMock.mockClear();
    // Node/vitest doesn't provide navigator.clipboard — polyfill it.
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });
    } else {
      navigator.clipboard.writeText = writeTextMock;
    }
    vi.mocked(usePreferencesStore.getState).mockReturnValue({
      terminalOsc52Clipboard: true,
    } as any);
  });

  it("writes decoded base64 text to the clipboard", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    // "hello" → base64 "aGVsbG8="
    handlers.get(52)?.("c;aGVsbG8=");

    expect(writeTextMock).toHaveBeenCalledWith("hello");
  });

  it("rejects OSC 52 emitted while a command is running", () => {
    const { term, handlers } = makeFakeTerm();
    const state = createShellIntegrationState();
    registerPromptTracker(term, state);
    registerClipboardHandler(term, state);

    // Simulate command running
    handlers.get(133)?.("A"); // prompt drawn
    handlers.get(133)?.("B"); // command begins
    
    // Attempt OSC 52
    handlers.get(52)?.("c;aGVsbG8=");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("rejects OSC 52 if user preference is disabled", () => {
    vi.mocked(usePreferencesStore.getState).mockReturnValue({
      terminalOsc52Clipboard: false,
    } as any);

    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    handlers.get(52)?.("c;aGVsbG8=");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("ignores read queries (Pd === '?')", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    handlers.get(52)?.("c;?");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("ignores empty Pd", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    handlers.get(52)?.("c;");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("drops payloads exceeding 100 KiB", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    // Create a base64 string that decodes to > 100 KiB.
    const big = btoa("x".repeat(100 * 1024 + 1));
    handlers.get(52)?.(`c;${big}`);

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("handles invalid base64 gracefully", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    // "!!!" is not valid base64.
    handlers.get(52)?.("c;!!!");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("drops data without a semicolon separator", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    handlers.get(52)?.("aGVsbG8=");

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("correctly decodes multi-byte UTF-8 (CJK characters)", () => {
    const { term, handlers } = makeFakeTerm();
    registerClipboardHandler(term);

    // Encode "你好" as UTF-8 bytes then base64.
    const encoded = btoa(
      String.fromCharCode(
        ...new TextEncoder().encode("你好"),
      ),
    );
    handlers.get(52)?.(`c;${encoded}`);

    expect(writeTextMock).toHaveBeenCalledWith("你好");
  });

  it("disposes cleanly", () => {
    const { term, handlers } = makeFakeTerm();
    const dispose = registerClipboardHandler(term);

    dispose();

    // Handler should be removed from the map.
    expect(handlers.has(52)).toBe(false);
  });
});
