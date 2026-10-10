import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchNativeEscape,
  type NativeEscapeEvent,
} from "@/modules/shortcuts/lib/nativeEscape";

const press: NativeEscapeEvent = {
  kind: "keydown",
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
};

beforeEach(() => {
  vi.stubGlobal(
    "KeyboardEvent",
    class extends Event {
      key: string;
      code: string;
      repeat: boolean;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
      constructor(kind: string, init: KeyboardEventInit) {
        super(kind, init);
        this.key = init.key ?? "";
        this.code = init.code ?? "";
        this.repeat = init.repeat ?? false;
        this.shiftKey = init.shiftKey ?? false;
        this.ctrlKey = init.ctrlKey ?? false;
        this.altKey = init.altKey ?? false;
        this.metaKey = init.metaKey ?? false;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("native fullscreen Escape", () => {
  it("follows current focus and lets the focused application handler consume Escape", () => {
    const terminal = new EventTarget();
    const chat = new EventTarget();
    const terminalKey = vi.fn();
    const chatKey = vi.fn((event: Event) => event.preventDefault());
    terminal.addEventListener("keydown", terminalKey);
    chat.addEventListener("keydown", chatKey);
    const targetDocument = {
      activeElement: terminal as unknown as Element | null,
      dispatchEvent: vi.fn(),
    };
    dispatchNativeEscape(press, targetDocument);
    targetDocument.activeElement = chat as unknown as Element;
    dispatchNativeEscape(press, targetDocument);
    expect(terminalKey).toHaveBeenCalledOnce();
    expect(chatKey).toHaveBeenCalledOnce();
    expect(chatKey.mock.calls[0][0].defaultPrevented).toBe(true);
    expect(targetDocument.dispatchEvent).not.toHaveBeenCalled();
  });

  it("dispatches after a titlebar click leaves no focused input", () => {
    const dispatchEvent = vi.fn();
    dispatchNativeEscape(press, { activeElement: null, dispatchEvent });
    expect(dispatchEvent).toHaveBeenCalledOnce();
    const event = dispatchEvent.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe("Escape");
    expect(event.bubbles && event.cancelable && event.composed).toBe(true);
  });

  it("keeps key release, repeat and modifiers for terminal keyboard protocols", () => {
    const dispatchEvent = vi.fn();
    dispatchNativeEscape(
      {
        ...press,
        kind: "keyup",
        repeat: true,
        shiftKey: true,
        ctrlKey: true,
        altKey: true,
        metaKey: true,
      },
      { activeElement: null, dispatchEvent },
    );
    const event = dispatchEvent.mock.calls[0][0] as KeyboardEvent;
    expect(event.type).toBe("keyup");
    expect(event.code).toBe("Escape");
    expect(
      event.repeat &&
        event.shiftKey &&
        event.ctrlKey &&
        event.altKey &&
        event.metaKey,
    ).toBe(true);
  });
});
