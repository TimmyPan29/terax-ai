import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/modules/ai/store/chatStore";

vi.mock("@/modules/ai/lib/sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/ai/lib/sessions")>()),
  saveSessionsList: vi.fn(),
  saveActiveId: vi.fn(),
}));

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

describe("new AI chat", () => {
  it("creates a distinct thread, preserves history, opens both surfaces and focuses input", () => {
    const previous = {
      id: "previous",
      title: "Existing chat",
      createdAt: 1,
      updatedAt: 1,
    };
    useChatStore.setState({
      sessions: [previous],
      activeSessionId: previous.id,
    });
    useChatStore.getState().newChat();
    const first = useChatStore.getState().activeSessionId;
    expect(first).not.toBe(previous.id);
    expect(useChatStore.getState()).toMatchObject({
      panelOpen: true,
      mini: { open: true },
      focusSignal: 1,
      pendingPrefill: null,
      sessions: [
        expect.objectContaining({ id: first, title: "New chat" }),
        previous,
      ],
    });
    useChatStore.getState().newChat();
    expect(useChatStore.getState().activeSessionId).not.toBe(first);
    expect(useChatStore.getState().sessions).toHaveLength(3);
    expect(useChatStore.getState().focusSignal).toBe(2);
  });
});
