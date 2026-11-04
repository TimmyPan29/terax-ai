import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPdfSelectionOnBlankPointer } from "./pdfSelection";

class TestElement {
  constructor(readonly interactive = false) {}
  closest() {
    return this.interactive ? this : null;
  }
}

function fixture() {
  vi.stubGlobal("Element", TestElement);
  const blank = new TestElement();
  const text = new TestElement(true);
  const outside = new TestElement();
  const selection = {
    anchorNode: text,
    focusNode: text,
    isCollapsed: false,
    removeAllRanges: vi.fn(),
  };
  const container = {
    contains: (node: unknown) => node === blank || node === text,
    ownerDocument: { getSelection: () => selection },
  } as unknown as HTMLElement;
  const event = {
    target: blank,
    button: 0,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  } as unknown as PointerEvent;
  return { blank, text, outside, selection, container, event };
}

afterEach(() => vi.unstubAllGlobals());

describe("PDF text selection", () => {
  it("clears a PDF selection when the primary pointer presses blank space", () => {
    const { event, container, selection } = fixture();
    clearPdfSelectionOnBlankPointer(event, container);
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
  });

  it("preserves selection when interacting with text, links, or another surface", () => {
    const { event, container, selection, text, outside } = fixture();
    clearPdfSelectionOnBlankPointer(
      { ...event, target: text } as unknown as PointerEvent,
      container,
    );
    clearPdfSelectionOnBlankPointer(
      { ...event, target: outside } as unknown as PointerEvent,
      container,
    );
    selection.anchorNode = outside;
    selection.focusNode = outside;
    clearPdfSelectionOnBlankPointer(event, container);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
  });

  it.each([
    { button: 2 },
    { button: 1 },
    { shiftKey: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
  ])("preserves selection for modified or non-primary input: %o", (change) => {
    const { event, container, selection } = fixture();
    clearPdfSelectionOnBlankPointer(
      { ...event, ...change } as PointerEvent,
      container,
    );
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
  });
});
