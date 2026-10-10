import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";

beforeEach(() => {
  useChatStore.setState({
    panelOpen: false,
    mini: { open: false },
    focusSignal: 0,
    pendingPrefill: "previous selection",
  });
});

describe("AI agent toggle", () => {
  it("opens both surfaces atomically and requests input focus", () => {
    const updates: unknown[] = [];
    const off = useChatStore.subscribe((s) => updates.push(s));
    useChatStore.getState().toggleAgent();
    off();
    expect(updates).toHaveLength(1);
    expect(useChatStore.getState()).toMatchObject({
      panelOpen: true,
      mini: { open: true },
      focusSignal: 1,
      pendingPrefill: null,
    });
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
  ])("closes both when panel=%s and chat=%s", (panelOpen, miniOpen) => {
    useChatStore.setState({ panelOpen, mini: { open: miniOpen } });
    useChatStore.getState().toggleAgent();
    expect(useChatStore.getState()).toMatchObject({
      panelOpen: false,
      mini: { open: false },
      focusSignal: 0,
    });
  });

  it("requests focus again after closing and reopening", () => {
    for (let i = 0; i < 3; i++) useChatStore.getState().toggleAgent();
    expect(useChatStore.getState()).toMatchObject({
      panelOpen: true,
      mini: { open: true },
      focusSignal: 2,
    });
  });
});
