import type { PDFDocumentProxy } from "pdfjs-dist";

/** Render an internal link's destination without moving the main viewer. */
export async function renderReference(
  document: PDFDocumentProxy,
  sourcePage: number,
  annotationId: string,
  signal: AbortSignal,
) {
  const source = await document.getPage(sourcePage);
  const annotations = await source.getAnnotations();
  const destination = annotations.find(
    (item) => item.id === annotationId,
  )?.dest;
  if (!destination || signal.aborted) return null;
  const target =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
  if (!Array.isArray(target) || target[0] == null || signal.aborted)
    return null;
  const index =
    typeof target[0] === "number"
      ? target[0]
      : await document.getPageIndex(target[0]);
  if (index < 0 || index >= document.numPages || signal.aborted) return null;
  const page = await document.getPage(index + 1);
  if (signal.aborted) return null;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(1.5, 1800 / Math.max(base.width, base.height)),
  });
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to render reference preview");
  const render = page.render({ canvas, canvasContext: context, viewport });
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
        : null;
  const x = kind === "XYZ" ? target[2] : null;
  const point = viewport.convertToViewportPoint(
    typeof x === "number" ? x : page.view[0],
    typeof y === "number" ? y : page.view[3],
  );
  return { canvas, page: index + 1, x: point[0], y: point[1] };
}
