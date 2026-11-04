import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfReferenceTarget =
  | string
  | {
      id?: string;
      relX?: number;
      relY?: number;
      previewWidth?: number;
      zoom?: number;
    };

function matchAnnotationAtPoint(
  annotations: Array<{ id?: string; dest?: unknown; rect?: number[] }>,
  view: number[],
  relX: number,
  relY: number,
) {
  const [xMin = 0, yMin = 0, xMax = 600, yMax = 800] = view;
  const pdfX = xMin + relX * (xMax - xMin);
  const pdfY = yMax - relY * (yMax - yMin);
  for (const pad of [0, 6]) {
    const hit = annotations.find((item) => {
      if (!item.dest || !Array.isArray(item.rect) || item.rect.length < 4)
        return false;
      const [x1, y1, x2, y2] = item.rect;
      return (
        pdfX >= Math.min(x1, x2) - pad &&
        pdfX <= Math.max(x1, x2) + pad &&
        pdfY >= Math.min(y1, y2) - pad &&
        pdfY <= Math.max(y1, y2) + pad
      );
    });
    if (hit?.dest) return hit.dest;
  }
  return null;
}

async function pageIndex(document: PDFDocumentProxy, ref: unknown) {
  return typeof ref === "number"
    ? ref
    : document.getPageIndex(
        ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0],
      );
}

const recoveredEquations = new WeakMap<
  PDFDocumentProxy,
  Map<string, unknown[] | null>
>();

async function recoverEquationDestination(
  document: PDFDocumentProxy,
  name: string,
  signal: AbortSignal,
): Promise<unknown[] | null> {
  const suffix = /^equation\.(\d+(?:\.\d+)*)$/.exec(name)?.[1];
  if (!suffix) return null;
  const cached = recoveredEquations.get(document);
  if (cached?.has(name)) return cached.get(name) ?? null;

  let match: unknown[] | null = null;
  for (let start = 0; start <= 32; start += 8) {
    if (signal.aborted) return null;
    const results = await Promise.all(
      Array.from({ length: Math.min(8, 33 - start) }, (_, offset) =>
        document.getDestination(`equation.${start + offset}.${suffix}`),
      ),
    );
    for (const candidate of results) {
      if (!Array.isArray(candidate) || candidate[0] == null) continue;
      if (
        candidate[1]?.name === "Fit" &&
        (await pageIndex(document, candidate[0])) === 0
      )
        continue;
      if (match) return null;
      match = candidate;
    }
  }
  if (signal.aborted) return null;
  const results = cached ?? new Map<string, unknown[] | null>();
  if (results.size >= 128) {
    const oldest = results.keys().next().value;
    if (oldest !== undefined) results.delete(oldest);
  }
  results.set(name, match);
  if (!cached) recoveredEquations.set(document, results);
  return match;
}

/** Render an internal link's destination without moving the main viewer. */
export async function renderReference(
  document: PDFDocumentProxy,
  sourcePage: number,
  targetSpec: PdfReferenceTarget,
  signal: AbortSignal,
) {
  const source = await document.getPage(sourcePage);
  const annotations = await source.getAnnotations();
  const id = typeof targetSpec === "string" ? targetSpec : targetSpec.id;
  const byId = id ? annotations.find((item) => item.id === id)?.dest : null;
  const destination =
    byId ??
    (typeof targetSpec === "object" &&
    typeof targetSpec.relX === "number" &&
    typeof targetSpec.relY === "number" &&
    Array.isArray(source.view)
      ? matchAnnotationAtPoint(
          annotations,
          source.view,
          targetSpec.relX,
          targetSpec.relY,
        )
      : null);
  if (!destination || signal.aborted) return null;
  let target =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
  if (!Array.isArray(target) || target[0] == null || signal.aborted)
    return null;
  let index = await pageIndex(document, target[0]);
  if (
    typeof destination === "string" &&
    /^equation\.(\d+(?:\.\d+)*)$/.test(destination) &&
    index === 0 &&
    target.length === 2 &&
    target[1]?.name === "Fit"
  ) {
    target = await recoverEquationDestination(document, destination, signal);
    if (!target || target[0] == null || signal.aborted) return null;
    index = await pageIndex(document, target[0]);
  }
  if (index < 0 || index >= document.numPages || signal.aborted) return null;
  const page = await document.getPage(index + 1);
  if (signal.aborted) return null;
  const base = page.getViewport({ scale: 1 });
  const previewWidth =
    typeof targetSpec === "object" &&
    typeof targetSpec.previewWidth === "number" &&
    targetSpec.previewWidth > 0
      ? targetSpec.previewWidth
      : 560;
  const zoom =
    typeof targetSpec === "object" &&
    typeof targetSpec.zoom === "number" &&
    targetSpec.zoom > 0
      ? targetSpec.zoom
      : 1;
  // Sioyek / Skim column-fit scale: size the text column (~82% of page width)
  // to fit the floating preview width at crisp reading magnification.
  const columnScale = (previewWidth - 24) / Math.max(1, base.width * 0.82);
  const cssScale = Math.min(
    4,
    Math.max(1.65, Math.min(2.6, columnScale)) * zoom,
  );
  const viewport = page.getViewport({ scale: cssScale });
  const canvas = window.document.createElement("canvas");
  // Supersample by devicePixelRatio (minimum 2x on DOM canvases) so LaTeX
  // equations, subscripts, and vector glyphs render razor-sharp on Retina/HiDPI.
  const dpr = canvas.style
    ? Math.min(4, Math.max(2, window.devicePixelRatio || 1))
    : 1;
  canvas.width = Math.ceil(viewport.width * dpr);
  canvas.height = Math.ceil(viewport.height * dpr);
  if (canvas.style) {
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    canvas.style.display = "block";
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to render reference preview");
  const render = page.render({
    canvas,
    canvasContext: context,
    viewport,
    ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}),
  });
  const cancel = () => render.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await render.promise;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  if (signal.aborted) return null;
  const kind = target[1]?.name;
  const y =
    kind === "XYZ"
      ? target[3]
      : kind === "FitH" || kind === "FitBH"
        ? target[2]
        : kind === "FitR"
          ? target[5]
          : null;
  const x =
    kind === "XYZ" || kind === "FitR" || kind === "FitV" || kind === "FitBV"
      ? target[2]
      : null;
  const point = viewport.convertToViewportPoint(
    typeof x === "number" ? x : page.view[0],
    typeof y === "number" ? y : page.view[3],
  );
  return { canvas, page: index + 1, x: point[0], y: point[1] };
}
