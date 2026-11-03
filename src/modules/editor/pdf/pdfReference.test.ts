import type { PDFDocumentProxy } from "pdfjs-dist";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderReference } from "./pdfReference";

afterEach(() => vi.unstubAllGlobals());

function fixture(dest: unknown) {
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  vi.stubGlobal("window", { document: { createElement: () => canvas } });
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const target = {
    view: [0, 0, 600, 800],
    getViewport: () => ({
      width: 600,
      height: 800,
      convertToViewportPoint: (x: number, y: number) => [x, 800 - y],
    }),
    render,
  };
  const document = {
    numPages: 4,
    getPage: vi.fn(async (page: number) =>
      page === 2
        ? { getAnnotations: async () => [{ id: "link", dest }] }
        : target,
    ),
    getDestination: vi.fn(async () => [0, { name: "XYZ" }, 20, 700]),
    getPageIndex: vi.fn(async () => 0),
  };
  return {
    document: document as unknown as PDFDocumentProxy,
    calls: document,
    canvas,
    render,
  };
}

describe("reference preview", () => {
  it("resolves named destinations and renders the destination without navigating", async () => {
    const { document, calls, canvas } = fixture("cite.key");
    const result = await renderReference(
      document,
      2,
      "link",
      new AbortController().signal,
    );
    expect(calls.getDestination).toHaveBeenCalledWith("cite.key");
    expect(calls.getPage).toHaveBeenCalledWith(1);
    expect(result).toEqual({ canvas, page: 1, x: 20, y: 100 });
  });
  it("resolves page references and fit destinations", async () => {
    const { document, calls } = fixture([
      { num: 8, gen: 0 },
      { name: "FitH" },
      600,
    ]);
    const result = await renderReference(
      document,
      2,
      "link",
      new AbortController().signal,
    );
    expect(calls.getPageIndex).toHaveBeenCalledWith({ num: 8, gen: 0 });
    expect(result).toMatchObject({ page: 1, y: 200 });
  });
  it("does not render missing or cancelled references", async () => {
    const { document, render } = fixture(null);
    expect(
      await renderReference(document, 2, "link", new AbortController().signal),
    ).toBeNull();
    const abort = new AbortController();
    abort.abort();
    expect(await renderReference(document, 2, "link", abort.signal)).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
  it("cancels a render when the preview closes", async () => {
    const { document, render } = fixture([0, { name: "Fit" }]);
    const cancel = vi.fn();
    let finish = () => {};
    render.mockImplementation(() => ({
      promise: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      cancel,
    }));
    const abort = new AbortController();
    const pending = renderReference(document, 2, "link", abort.signal);
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    abort.abort();
    finish();
    expect(await pending).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
