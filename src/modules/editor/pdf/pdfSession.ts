import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/legacy/web/pdf_viewer.css";
import "@/modules/editor/pdf/pdf.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfFindOptions = {
  query: string;
  caseSensitive: boolean;
  wholeWords: boolean;
};
export type PdfSession = Awaited<ReturnType<typeof createPdfSession>>;

export async function createPdfSession(
  container: HTMLDivElement,
  url: string,
  signal: AbortSignal,
  callbacks: {
    onReady: (pages: number) => void;
    onPage: (page: number) => void;
    onMatches: (current: number, total: number, pending: boolean) => void;
    onPassword: (submit: (value: string) => void, incorrect: boolean) => void;
  },
) {
  const { EventBus, FindState, PDFLinkService, PDFFindController, PDFViewer } =
    await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
  if (signal.aborted) throw new DOMException("PDF closed", "AbortError");
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  linkService.externalLinkEnabled = false;
  const findController = new PDFFindController({ eventBus, linkService });
  const assets = new URL("pdfjs/", document.baseURI).href;
  const viewerOptions = {
    container,
    eventBus,
    linkService,
    findController,
    abortSignal: signal,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    imageResourcesPath: `${assets}images/`,
    enableAutoLinking: false,
    enableDetailCanvas: false,
    maxCanvasPixels: 4 * 1024 * 1024,
    maxCanvasDim: 4096,
  };
  const viewer = new PDFViewer(viewerOptions);
  linkService.setViewer(viewer);
  const task = pdfjs.getDocument({
    url,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  });
  task.onPassword = (submit: (value: string) => void, reason: number) =>
    callbacks.onPassword(
      submit,
      reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
    );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    findController.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
    viewer.setDocument(null as unknown as pdfjs.PDFDocumentProxy);
    linkService.setDocument(null);
    void task.destroy();
  };
  signal.addEventListener("abort", dispose, { once: true });
  eventBus.on(
    "pagesinit",
    () => {
      viewer.currentScaleValue = "page-width";
      callbacks.onReady(viewer.pagesCount);
    },
    { signal },
  );
  eventBus.on(
    "pagechanging",
    ({ pageNumber }: { pageNumber: number }) => callbacks.onPage(pageNumber),
    { signal },
  );
  eventBus.on(
    "updatefindmatchescount",
    ({ matchesCount }: { matchesCount: { current: number; total: number } }) =>
      callbacks.onMatches(matchesCount.current, matchesCount.total, false),
    { signal },
  );
  eventBus.on(
    "updatefindcontrolstate",
    ({
      state,
      matchesCount,
    }: {
      state: number;
      matchesCount: { current: number; total: number };
    }) =>
      callbacks.onMatches(
        matchesCount.current,
        matchesCount.total,
        state === FindState.PENDING,
      ),
    { signal },
  );
  try {
    const document = await task.promise;
    if (signal.aborted) throw new DOMException("PDF closed", "AbortError");
    linkService.setDocument(document);
    viewer.setDocument(document);
  } catch (error) {
    signal.removeEventListener("abort", dispose);
    dispose();
    throw error;
  }
  return {
    find(options: PdfFindOptions, again = false, backwards = false) {
      eventBus.dispatch("find", {
        source: container,
        type: again ? "again" : "",
        query: options.query,
        caseSensitive: options.caseSensitive,
        entireWord: options.wholeWords,
        highlightAll: true,
        findPrevious: backwards,
        matchDiacritics: false,
      });
    },
    closeFind() {
      eventBus.dispatch("findbarclose", { source: container });
    },
    goToPage(page: number) {
      viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, page));
    },
    zoom(direction: -1 | 1) {
      viewer.currentScale = Math.max(
        0.25,
        Math.min(4, viewer.currentScale * 1.25 ** direction),
      );
    },
    fit() {
      viewer.currentScaleValue = "page-width";
    },
  };
}
