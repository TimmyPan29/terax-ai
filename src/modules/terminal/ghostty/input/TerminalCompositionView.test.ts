import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import { TerminalCompositionView } from "@/modules/terminal/ghostty/input/TerminalCompositionView";
import { describe, expect, it, vi } from "vitest";

function harness() {
  const writeStyle = vi.fn();
  const input = Object.assign(new EventTarget(), {
    style: new Proxy(
      { cssText: "opacity:0;width:1px" },
      {
        set(target, property, value) {
          writeStyle();
          return Reflect.set(target, property, value);
        },
      },
    ),
    value: "",
    setAttribute: vi.fn(),
  });
  const cursor = { x: 3, y: 5 };
  const model = {
    cols: 80,
    rows: 24,
    cursor: () => cursor,
    scrollPosition: () => ({ offset: 0 }),
  };
  const metrics = {
    font: {
      family: "monospace",
      size: 14,
      weight: "400",
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    cellWidth: 10,
    cellHeight: 20,
    baseline: 15,
  };
  const view = new TerminalCompositionView({
    input: input as unknown as HTMLTextAreaElement,
    model: model as unknown as GhosttyTerminalModelApi,
    metrics: () => metrics,
    theme: () => ({
      background: [0, 0, 0],
      foreground: [255, 255, 255],
      cursor: [255, 255, 255],
      palette: [],
      selection: { color: [0, 0, 0], alpha: 0.5 },
    }),
  });
  return { input, cursor, metrics, model, view, writeStyle };
}

describe("TerminalCompositionView", () => {
  it("reveals the native composition at the cursor without replacing its marked text", () => {
    const h = harness();
    try {
      h.input.dispatchEvent(new Event("compositionstart"));
      h.input.value = "ㄋㄧˇ";
      h.view.sync();
      expect(h.input.style.cssText).toContain("opacity:1");
      expect(h.input.style.cssText).toContain("left:30px;top:100px");
      expect(h.input.value).toBe("ㄋㄧˇ");
      h.cursor.x = 6;
      h.metrics.cellHeight = 24;
      h.view.sync();
      expect(h.input.style.cssText).toContain("left:60px;top:120px");
      expect(h.input.value).toBe("ㄋㄧˇ");
      h.input.dispatchEvent(new Event("compositionend"));
      expect(h.input.style.cssText).toBe("opacity:0;width:1px");
    } finally {
      h.view.dispose();
    }
  });

  it("keeps right-edge composition inside the viewport", () => {
    const h = harness();
    h.cursor.x = 79;
    h.cursor.y = 23;
    h.input.dispatchEvent(new Event("compositionstart"));
    expect(h.input.style.cssText).toContain("left:780px;top:460px;width:20px");
    h.view.dispose();
  });

  it.each(["blur", "hide", "dispose"])(
    "restores the proxy and removes stale presentation on %s",
    (action) => {
      const h = harness();
      h.input.dispatchEvent(new Event("compositionstart"));
      if (action === "blur") h.input.dispatchEvent(new Event("blur"));
      else if (action === "hide") h.view.hide();
      else h.view.dispose();
      expect(h.input.style.cssText).toBe("opacity:0;width:1px");
      h.writeStyle.mockClear();
      h.view.sync();
      expect(h.writeStyle).not.toHaveBeenCalled();
      h.view.dispose();
      h.input.dispatchEvent(new Event("compositionstart"));
      expect(h.writeStyle).not.toHaveBeenCalled();
    },
  );

  it("does no DOM work while inactive or when presentation is unchanged", () => {
    const h = harness();
    h.view.sync();
    expect(h.writeStyle).not.toHaveBeenCalled();
    h.input.dispatchEvent(new Event("compositionstart"));
    h.writeStyle.mockClear();
    h.view.sync();
    expect(h.writeStyle).not.toHaveBeenCalled();
    h.view.dispose();
  });
});
