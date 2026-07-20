import { Add01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  accumulateScaleFactor,
  isTrackpadPinch,
  trackpadPinchScaleFactor,
} from "./lib/pdfZoom";
import "./PdfPreviewPane.css";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Props = {
  assetUrl: string;
  title?: string;
};

type ViewerStatus = "loading" | "ready" | "error";

export function PdfPreviewPane({ assetUrl, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const unusedWheelFactorRef = useRef(1);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [error, setError] = useState("");
  const [scale, setScale] = useState(100);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;

    const abortController = new AbortController();
    const { signal } = abortController;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      linkService,
      supportsPinchToZoom: true,
    });
    let loadingTask: PDFDocumentLoadingTask | null = null;

    pdfViewerRef.current = pdfViewer;
    linkService.setViewer(pdfViewer);
    setStatus("loading");
    setError("");

    eventBus.on(
      "pagesinit",
      () => {
        pdfViewer.currentScaleValue = "page-width";
        setStatus("ready");
      },
      { signal },
    );
    eventBus.on(
      "scalechanging",
      (event: { scale?: number }) => {
        if (typeof event.scale === "number") {
          setScale(Math.round(event.scale * 100));
        }
      },
      { signal },
    );

    const load = async () => {
      try {
        loadingTask = getDocument({ url: assetUrl });
        const pdfDocument = await loadingTask.promise;
        if (signal.aborted) return;
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
      } catch (reason) {
        if (signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      }
    };
    void load();

    return () => {
      abortController.abort();
      pdfViewerRef.current = null;
      pdfViewer.setDocument(null as never);
      linkService.setDocument(null);
      if (loadingTask) void loadingTask.destroy();
    };
  }, [assetUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const abortController = new AbortController();
    const onWheel = (event: WheelEvent) => {
      if (!isTrackpadPinch(event)) return;

      event.preventDefault();
      event.stopPropagation();
      const pdfViewer = pdfViewerRef.current;
      if (!pdfViewer) return;

      const next = accumulateScaleFactor(
        pdfViewer.currentScale,
        trackpadPinchScaleFactor(event.deltaY),
        unusedWheelFactorRef.current,
      );
      unusedWheelFactorRef.current = next.unusedFactor;
      pdfViewer.updateScale({
        drawingDelay: 150,
        scaleFactor: next.factor,
        origin: [event.clientX, event.clientY],
      });
    };

    container.addEventListener("wheel", onWheel, {
      passive: false,
      signal: abortController.signal,
    });
    return () => abortController.abort();
  }, []);

  const zoom = useCallback((steps: number) => {
    pdfViewerRef.current?.updateScale({ steps });
  }, []);

  const resetZoom = useCallback(() => {
    if (pdfViewerRef.current) {
      pdfViewerRef.current.currentScaleValue = "page-width";
    }
  }, []);

  return (
    <div className="pdf-preview" title={title}>
      <div className="pdf-preview__toolbar">
        <button
          type="button"
          className="pdf-preview__zoom-button"
          disabled={status !== "ready"}
          onClick={() => zoom(-1)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="pdf-preview__scale"
          disabled={status !== "ready"}
          onClick={resetZoom}
          title="Fit page width"
        >
          {scale}%
        </button>
        <button
          type="button"
          className="pdf-preview__zoom-button"
          disabled={status !== "ready"}
          onClick={() => zoom(1)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
        </button>
      </div>
      <div ref={containerRef} className="pdf-preview__viewer-container">
        <div ref={viewerRef} className="pdfViewer pdf-preview__viewer" />
      </div>
      {status === "loading" ? (
        <div className="pdf-preview__message">Rendering PDF...</div>
      ) : null}
      {status === "error" ? (
        <div className="pdf-preview__message pdf-preview__message--error">
          Unable to render PDF{error ? `: ${error}` : "."}
        </div>
      ) : null}
    </div>
  );
}
