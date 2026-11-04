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
    getDestination: vi.fn(
      async (_name: string): Promise<unknown[] | null> => [
        0,
        { name: "XYZ" },
        20,
        700,
      ],
    ),
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
  it("recovers a stale equation name from a unique section-qualified anchor", async () => {
    const { document, calls } = fixture("equation.3");
    calls.getDestination.mockImplementation(async (name: string) => {
      if (name === "equation.3") return [0, { name: "Fit" }];
      if (name === "equation.2.3") return [2, { name: "XYZ" }, 120, 600];
      return null;
    });
    const result = await renderReference(
      document,
      2,
      "link",
      new AbortController().signal,
    );
    expect(result).toMatchObject({ page: 3, x: 120, y: 200 });
    expect(calls.getPage).toHaveBeenCalledWith(3);
    const firstLookupCount = calls.getDestination.mock.calls.length;
    await renderReference(document, 2, "link", new AbortController().signal);
    expect(calls.getDestination).toHaveBeenCalledTimes(firstLookupCount + 1);
  });
  it("does not guess when a stale equation anchor is absent or ambiguous", async () => {
    for (const ambiguous of [false, true]) {
      const { document, calls, render } = fixture("equation.3");
      calls.getDestination.mockImplementation(async (name: string) => {
        if (name === "equation.3") return [0, { name: "Fit" }];
        if (ambiguous && ["equation.2.3", "equation.4.3"].includes(name))
          return [2, { name: "XYZ" }, 120, 600];
        return null;
      });
      expect(
        await renderReference(
          document,
          2,
          "link",
          new AbortController().signal,
        ),
      ).toBeNull();
      expect(render).not.toHaveBeenCalled();
    }
  });
  it("preserves ordinary first-page destinations and citations", async () => {
    const { document, calls } = fixture("cite.example");
    calls.getDestination.mockResolvedValue([0, { name: "Fit" }]);
    const result = await renderReference(
      document,
      2,
      "link",
      new AbortController().signal,
    );
    expect(result?.page).toBe(1);
    expect(calls.getDestination).toHaveBeenCalledTimes(1);
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
  it("supersamples DOM canvases with HiDPI transform and column-fit scale", async () => {
    const style = { width: "", height: "", display: "" };
    const canvas = { width: 0, height: 0, style, getContext: () => ({}) };
    vi.stubGlobal("window", {
      devicePixelRatio: 2,
      document: { createElement: () => canvas },
    });
    const render = vi.fn(() => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }));
    const getViewport = vi.fn(({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      convertToViewportPoint: (x: number, y: number) => [
        x * scale,
        (800 - y) * scale,
      ],
    }));
    const document = {
      numPages: 4,
      getPage: vi.fn(async (page: number) =>
        page === 2
          ? {
              view: [0, 0, 600, 800],
              getAnnotations: async () => [
                {
                  id: "eq-1",
                  dest: [0, { name: "FitR" }, 60, 500, 540, 640],
                  rect: [480, 390, 520, 410],
                },
              ],
            }
          : {
              view: [0, 0, 600, 800],
              getViewport,
              render,
            },
      ),
      getDestination: vi.fn(),
      getPageIndex: vi.fn(async () => 0),
    } as unknown as PDFDocumentProxy;
    const result = await renderReference(
      document,
      2,
      { relX: 500 / 600, relY: 0.5, previewWidth: 720, zoom: 1.25 },
      new AbortController().signal,
    );
    expect(result?.page).toBe(1);
    expect(canvas.width).toBeGreaterThan(2000);
    expect(style.width).toMatch(/^\d+px$/);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: [2, 0, 0, 2, 0, 0],
      }),
    );
  });
});
