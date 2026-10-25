import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(async () => {}),
  viewerDocument: vi.fn(),
  findDocument: vi.fn(),
  events: [] as Array<{ name: string; data: unknown }>,
  options: {} as { abortSignal?: AbortSignal; annotationMode?: number },
  resolve: (_value: object) => {},
}));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  AnnotationMode: { ENABLE: 1 },
  AnnotationEditorType: { DISABLE: -1 },
  PasswordResponses: { INCORRECT_PASSWORD: 2 },
  getDocument: mocks.getDocument,
}));
vi.mock("pdfjs-dist/legacy/web/pdf_viewer.mjs", () => ({
  FindState: { PENDING: 3 },
  EventBus: class {
    on() {}
    dispatch(name: string, data: unknown) {
      mocks.events.push({ name, data });
    }
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFFindController: class {
    setDocument = mocks.findDocument;
  },
  PDFViewer: class {
    pagesCount = 3;
    currentPageNumber = 1;
    currentScale = 1;
    currentScaleValue = "";
    setDocument = mocks.viewerDocument;
    constructor(options: typeof mocks.options) {
      mocks.options = options;
    }
  },
}));
import { createPdfSession } from "@/modules/editor/pdf/pdfSession";

beforeEach(() => {
  mocks.getDocument.mockReset();
  mocks.destroy.mockClear();
  mocks.viewerDocument.mockClear();
  mocks.findDocument.mockClear();
  mocks.events = [];
  mocks.getDocument.mockImplementation(() => ({
    promise: new Promise<object>((resolve) => {
      mocks.resolve = resolve;
    }),
    destroy: mocks.destroy,
  }));
  vi.stubGlobal("document", { baseURI: "http://tauri.localhost/index.html" });
});
afterEach(() => vi.unstubAllGlobals());
const callbacks = () => ({
  onReady: vi.fn(),
  onPage: vi.fn(),
  onMatches: vi.fn(),
  onPassword: vi.fn(),
});
const container = {} as HTMLDivElement;

describe("PDF session lifecycle", () => {
  it("destroys the loading task exactly once when cancelled before the document resolves", async () => {
    const abort = new AbortController();
    const promise = createPdfSession(
      container,
      "http://asset.localhost/C%3A%5Ctest.pdf",
      abort.signal,
      callbacks(),
    );
    await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalledOnce());
    abort.abort();
    mocks.resolve({ numPages: 3 });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.viewerDocument).not.toHaveBeenCalledWith(
      expect.objectContaining({ numPages: 3 }),
    );
  });

  it("does not construct a document after an obsolete lazy import completes", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      createPdfSession(container, "old.pdf", abort.signal, callbacks()),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it("forwards literal search options, direction and close events and releases the document on abort", async () => {
    const abort = new AbortController();
    const promise = createPdfSession(
      container,
      "http://asset.localhost/file.pdf",
      abort.signal,
      callbacks(),
    );
    await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalledOnce());
    mocks.resolve({ numPages: 3 });
    const session = await promise;
    session.find(
      { query: "PDF.* 中文", caseSensitive: true, wholeWords: true },
      true,
      true,
    );
    expect(mocks.events[mocks.events.length - 1]).toMatchObject({
      name: "find",
      data: {
        type: "again",
        query: "PDF.* 中文",
        caseSensitive: true,
        entireWord: true,
        findPrevious: true,
        highlightAll: true,
      },
    });
    session.closeFind();
    expect(mocks.events[mocks.events.length - 1]?.name).toBe("findbarclose");
    expect(mocks.options.abortSignal).toBe(abort.signal);
    expect(mocks.options.annotationMode).toBe(1);
    abort.abort();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.viewerDocument).toHaveBeenLastCalledWith(null);
  });

  it("cleans up a failed PDF load and retains local resource URLs", async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error("Invalid PDF")),
      destroy: mocks.destroy,
    });
    await expect(
      createPdfSession(
        container,
        "bad.pdf",
        new AbortController().signal,
        callbacks(),
      ),
    ).rejects.toThrow("Invalid PDF");
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapUrl: "http://tauri.localhost/pdfjs/cmaps/",
        standardFontDataUrl: "http://tauri.localhost/pdfjs/standard_fonts/",
      }),
    );
  });
});
