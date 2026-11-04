import type { PdfSession } from "@/modules/editor/pdf/pdfSession";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const button = "rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-40";

type LinkHit = {
  pageNumber: number;
  id?: string;
  relX?: number;
  relY?: number;
};

function findLinkAtEvent(
  container: HTMLElement,
  event: MouseEvent,
): LinkHit | null {
  const targetEl =
    event.target instanceof Element
      ? event.target
      : ((event.target as Node | null)?.parentElement ?? null);
  const directAnchor = targetEl?.closest<HTMLAnchorElement>(
    ".linkAnnotation[data-internal-link] a[data-element-id], .linkAnnotation a[data-element-id]",
  );
  const directSection = targetEl?.closest<HTMLElement>(
    ".linkAnnotation[data-internal-link][data-annotation-id], .linkAnnotation[data-annotation-id]",
  );
  let pageElement = (
    directAnchor ??
    directSection ??
    targetEl
  )?.closest<HTMLElement>(".page[data-page-number]");
  if (!pageElement) {
    for (const candidate of container.querySelectorAll<HTMLElement>(
      ".page[data-page-number]",
    )) {
      const rect = candidate.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        pageElement = candidate;
        break;
      }
    }
  }
  const pageNumber = Number(pageElement?.dataset.pageNumber);
  if (!pageElement || !pageNumber) return null;
  let id =
    directAnchor?.dataset.elementId ?? directSection?.dataset.annotationId;
  if (!id) {
    // Fallback when .textLayer.selecting disables pointer-events on .annotationLayer
    // or when clicking slightly beside a narrow equation reference like (1).
    const candidates = pageElement.querySelectorAll<HTMLElement>(
      ".linkAnnotation[data-internal-link] a[data-element-id], .linkAnnotation a[data-element-id], .linkAnnotation[data-annotation-id]",
    );
    for (const pad of [0, 6]) {
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left - pad &&
          event.clientX <= rect.right + pad &&
          event.clientY >= rect.top - pad &&
          event.clientY <= rect.bottom + pad
        ) {
          id =
            el.dataset.elementId ??
            el.closest<HTMLElement>("[data-annotation-id]")?.dataset
              .annotationId;
          if (id) break;
        }
      }
      if (id) break;
    }
  }
  const pageRect = pageElement.getBoundingClientRect();
  const relX =
    pageRect.width > 0
      ? Math.max(
          0,
          Math.min(1, (event.clientX - pageRect.left) / pageRect.width),
        )
      : undefined;
  const relY =
    pageRect.height > 0
      ? Math.max(
          0,
          Math.min(1, (event.clientY - pageRect.top) / pageRect.height),
        )
      : undefined;
  if (!id && (relX === undefined || relY === undefined)) return null;
  return { pageNumber, id, relX, relY };
}

export default function PdfPane({
  url,
  visible,
  searchRequest,
  onReload,
  onReveal,
}: {
  url: string;
  visible: boolean;
  searchRequest: number;
  onReload: () => void;
  onReveal: () => void;
}) {
  const passwordId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [portalHost] = useState(() => document.createElement("div"));
  const [focusMode, setFocusMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef<PdfSession | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const lastTrigger = useRef<{ time: number; page: number; id?: string }>({
    time: 0,
    page: 0,
  });
  const previewWidth = usePreferencesStore((s) => s.pdfPreviewWidth);
  const previewHeight = usePreferencesStore((s) => s.pdfPreviewHeight);
  const [preview, setPreview] = useState<{
    x: number;
    y: number;
    hit: LinkHit;
    zoom: number;
    page?: number;
    error?: string;
    rendered?: { canvas: HTMLCanvasElement; x: number; y: number };
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const lastPage = useRef(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWords, setWholeWords] = useState(false);
  const [matches, setMatches] = useState({
    current: 0,
    total: 0,
    pending: false,
  });
  const [password, setPassword] = useState<{
    submit: (value: string) => void;
    incorrect: boolean;
  } | null>(null);
  const [passwordValue, setPasswordValue] = useState("");

  useLayoutEffect(() => {
    const parent = focusMode ? document.body : hostRef.current;
    if (!parent) return;
    portalHost.className = focusMode
      ? "fixed inset-0 z-[45]"
      : "h-full min-h-0 w-full min-w-0";
    parent.appendChild(portalHost);
  }, [focusMode, portalHost]);

  useLayoutEffect(() => () => portalHost.remove(), [portalHost]);

  useEffect(() => {
    if (!visible) setFocusMode(false);
  }, [visible]);

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        searchOpen ||
        preview ||
        password
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setFocusMode(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, searchOpen, preview, password]);

  useEffect(() => {
    const container = containerRef.current;
    if (!visible || !container) return;
    const abort = new AbortController();
    const resumePage = lastPage.current;
    previewAbort.current?.abort();
    setPreview(null);
    setReady(false);
    setError("");
    setPassword(null);
    void import("@/modules/editor/pdf/pdfSession")
      .then(({ createPdfSession }) => {
        if (abort.signal.aborted) return;
        return createPdfSession(container, url, abort.signal, {
          onReady: (count) => {
            if (abort.signal.aborted) return;
            setPages(count);
            setPassword(null);
            setReady(true);
            session.current?.goToPage(resumePage);
          },
          onPage: (number) => {
            if (!abort.signal.aborted) {
              lastPage.current = number;
              setPage(number);
            }
          },
          onMatches: (current, total, pending) => {
            if (!abort.signal.aborted) setMatches({ current, total, pending });
          },
          onPassword: (submit, incorrect) => {
            if (!abort.signal.aborted) {
              setPassword({ submit, incorrect });
              setPasswordValue("");
            }
          },
        }).then((value) => {
          if (!abort.signal.aborted) session.current = value;
        });
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted) {
          abort.abort();
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      abort.abort();
      previewAbort.current?.abort();
      session.current = null;
      container.replaceChildren(
        Object.assign(document.createElement("div"), {
          className: "pdfViewer",
        }),
      );
    };
  }, [url, visible]);

  useLayoutEffect(() => {
    if (searchRequest === 0) return;
    setSearchOpen(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [searchRequest]);
  useLayoutEffect(() => {
    if (searchOpen && visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [searchOpen, visible]);
  useEffect(() => {
    if (ready && visible && searchOpen)
      session.current?.find({ query, caseSensitive, wholeWords });
  }, [query, caseSensitive, wholeWords, ready, visible, searchOpen]);

  const loadReferencePreview = useCallback(
    (hit: LinkHit, x: number, y: number, zoom: number) => {
      if (!session.current) return;
      previewAbort.current?.abort();
      const abort = new AbortController();
      previewAbort.current = abort;
      setPreview((prev) => ({
        x,
        y,
        hit,
        zoom,
        page: prev?.hit === hit ? prev.page : undefined,
        rendered: prev?.hit === hit ? prev.rendered : undefined,
      }));
      void session.current
        .renderReference(
          hit.pageNumber,
          {
            id: hit.id,
            relX: hit.relX,
            relY: hit.relY,
            previewWidth,
            zoom,
          },
          abort.signal,
        )
        .then((result) => {
          if (abort.signal.aborted) return;
          if (!result) {
            setPreview({
              x,
              y,
              hit,
              zoom,
              error: "Reference destination unavailable",
            });
            return;
          }
          setPreview({
            x,
            y,
            hit,
            zoom,
            page: result.page,
            rendered: result,
          });
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setPreview({
              x,
              y,
              hit,
              zoom,
              error: "Unable to load reference",
            });
        });
    },
    [previewWidth],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !visible) return;
    const isPreviewModifier = (event: MouseEvent | PointerEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
      return isMac ? event.metaKey : event.ctrlKey;
    };
    const close = () => {
      previewAbort.current?.abort();
      setPreview(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (previewRef.current?.contains(event.target as Node)) return;
      // Ignore right-click / Cmd+Right-click events so opening a preview is never self-cancelled.
      if (event.button === 2 || isPreviewModifier(event)) return;
      if (Date.now() - lastTrigger.current.time < 250) return;
      close();
    };
    const triggerFromEvent = (event: MouseEvent) => {
      if (!isPreviewModifier(event)) return;
      if (event.type === "contextmenu") {
        event.preventDefault();
      }
      if (!session.current) return;
      const hit = findLinkAtEvent(container, event);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (
        event.type === "contextmenu" &&
        now - lastTrigger.current.time < 400 &&
        lastTrigger.current.page === hit.pageNumber &&
        lastTrigger.current.id === hit.id
      ) {
        return;
      }
      lastTrigger.current = { time: now, page: hit.pageNumber, id: hit.id };
      const bounds = container.getBoundingClientRect();
      const boxW = Math.min(previewWidth, Math.max(240, bounds.width - 16));
      const boxH = Math.min(previewHeight, Math.max(180, bounds.height - 16));
      const relCursorX = event.clientX - bounds.left;
      const relCursorY = event.clientY - bounds.top;
      const x = Math.max(
        8,
        Math.min(relCursorX - 36, Math.max(8, bounds.width - boxW - 8)),
      );
      const belowY = relCursorY + 14;
      const aboveY = relCursorY - boxH - 12;
      const y =
        belowY + boxH <= bounds.height - 8
          ? Math.max(8, belowY)
          : aboveY >= 8
            ? aboveY
            : Math.max(
                8,
                Math.min(relCursorY, Math.max(8, bounds.height - boxH - 8)),
              );
      loadReferencePreview(hit, x, y, 1);
    };
    const onContainerPointerDown = (event: PointerEvent) => {
      if (event.button === 2 && isPreviewModifier(event)) {
        triggerFromEvent(event);
      }
    };
    container.addEventListener("pointerdown", onContainerPointerDown, true);
    container.addEventListener("contextmenu", triggerFromEvent);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      container.removeEventListener(
        "pointerdown",
        onContainerPointerDown,
        true,
      );
      container.removeEventListener("contextmenu", triggerFromEvent);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [visible, previewWidth, previewHeight, loadReferencePreview]);

  useLayoutEffect(() => {
    if (!preview?.rendered) return;
    const scroll = previewRef.current?.querySelector<HTMLDivElement>(
      "[data-preview-scroll]",
    );
    if (!scroll) return;
    scroll.replaceChildren(preview.rendered.canvas);
    const cssCanvasWidth =
      preview.rendered.canvas.offsetWidth ||
      Number.parseFloat(preview.rendered.canvas.style?.width || "") ||
      preview.rendered.canvas.width;
    const viewWidth = scroll.clientWidth || previewWidth;
    const viewHeight = scroll.clientHeight || previewHeight - 32;
    const targetX = preview.rendered.x;
    // Sioyek / Skim horizontal framing: when the PDF destination anchor is near
    // the left or right margin (typical for LaTeX \label / \eqref), center the
    // page content horizontally so the full equation and its number are visible.
    const isMarginAnchor =
      cssCanvasWidth > 0 &&
      (targetX <= cssCanvasWidth * 0.22 || targetX >= cssCanvasWidth * 0.78);
    scroll.scrollLeft = Math.max(
      0,
      isMarginAnchor && cssCanvasWidth > viewWidth
        ? Math.round((cssCanvasWidth - viewWidth) / 2)
        : Math.round(targetX - 30),
    );
    // Sioyek vertical framing: leave ~28% vertical headroom above the anchor
    // so multi-line equations, integrals, and fractions above the baseline are not clipped.
    scroll.scrollTop = Math.max(
      0,
      Math.round(preview.rendered.y - Math.max(40, viewHeight * 0.28)),
    );
  }, [preview, previewWidth, previewHeight]);

  const zoomPreview = (factor: number) => {
    if (!preview) return;
    const nextZoom = Math.max(0.75, Math.min(2.5, preview.zoom * factor));
    if (nextZoom === preview.zoom) return;
    loadReferencePreview(preview.hit, preview.x, preview.y, nextZoom);
  };

  const openSearch = () => {
    setSearchOpen(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  };
  const closeSearch = () => {
    setSearchOpen(false);
    session.current?.closeFind();
    containerRef.current?.focus();
  };
  const enterFocusMode = () => {
    closeSearch();
    previewAbort.current?.abort();
    setPreview(null);
    setFocusMode(true);
  };
  const viewer = (
    <div
      className={`terax-pdf ${focusMode ? "" : "zoom-exempt"} flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground`}
    >
      {!focusMode && (
        <div
          role="toolbar"
          aria-label="PDF controls"
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1"
        >
          <button type="button" className={button} onClick={openSearch}>
            Find
          </button>
          <button
            type="button"
            className={button}
            aria-label="Previous page"
            disabled={!ready || page <= 1}
            onClick={() => session.current?.goToPage(page - 1)}
          >
            ‹
          </button>
          <output className="text-xs tabular-nums" aria-label="PDF page">
            {page} / {pages || "…"}
          </output>
          <button
            type="button"
            className={button}
            aria-label="Next page"
            disabled={!ready || page >= pages}
            onClick={() => session.current?.goToPage(page + 1)}
          >
            ›
          </button>
          <button
            type="button"
            className={button}
            aria-label="Zoom out"
            disabled={!ready}
            onClick={() => session.current?.zoom(-1)}
          >
            −
          </button>
          <button
            type="button"
            className={button}
            aria-label="Zoom in"
            disabled={!ready}
            onClick={() => session.current?.zoom(1)}
          >
            +
          </button>
          <button
            type="button"
            className={button}
            disabled={!ready}
            onClick={() => session.current?.fit()}
          >
            Fit width
          </button>
          <button type="button" className={button} onClick={onReload}>
            Reload
          </button>
          <button type="button" className={button} onClick={onReveal}>
            Show in folder
          </button>
          <button type="button" className={button} onClick={enterFocusMode}>
            Focus mode
          </button>
        </div>
      )}
      {searchOpen && (
        <search
          aria-label="Find in PDF"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2"
        >
          <input
            ref={inputRef}
            type="search"
            aria-label="Find in PDF"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              }
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                session.current?.find(
                  { query, caseSensitive, wholeWords },
                  true,
                  e.shiftKey,
                );
              }
            }}
            placeholder="Find in PDF"
            className="min-w-24 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <output aria-live="polite" className="text-xs tabular-nums">
            {query
              ? matches.pending
                ? "Searching…"
                : matches.total
                  ? `${matches.current} of ${matches.total}`
                  : "No matches"
              : ""}
          </output>
          <button
            type="button"
            className={button}
            aria-label="Previous match"
            disabled={!ready || !matches.total}
            onClick={() =>
              session.current?.find(
                { query, caseSensitive, wholeWords },
                true,
                true,
              )
            }
          >
            ↑
          </button>
          <button
            type="button"
            className={button}
            aria-label="Next match"
            disabled={!ready || !matches.total}
            onClick={() =>
              session.current?.find({ query, caseSensitive, wholeWords }, true)
            }
          >
            ↓
          </button>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Match case
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={wholeWords}
              onChange={(e) => setWholeWords(e.target.checked)}
            />
            Whole words
          </label>
          <button
            type="button"
            className={button}
            aria-label="Close PDF search"
            onClick={closeSearch}
          >
            ×
          </button>
        </search>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          role="document"
          aria-label="PDF document"
          tabIndex={-1}
          className="absolute inset-0 overflow-auto outline-none"
        >
          <div className="pdfViewer" />
        </div>
        {focusMode && (
          <button
            type="button"
            className="absolute right-3 top-3 z-10 rounded border border-border bg-background px-2 py-1 text-xs text-foreground shadow-sm hover:bg-accent"
            onClick={() => setFocusMode(false)}
          >
            Exit focus mode
          </button>
        )}
        {preview && (
          <div
            ref={previewRef}
            role="dialog"
            aria-label="Reference preview"
            className="absolute z-20 flex max-h-[calc(100%-16px)] max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-md border border-border bg-background/95 shadow-2xl backdrop-blur-sm"
            style={{
              left: preview.x,
              top: preview.y,
              width: previewWidth,
              height: previewHeight,
            }}
            onWheel={(e) => {
              if (e.metaKey || e.ctrlKey) {
                e.preventDefault();
                zoomPreview(e.deltaY < 0 ? 1.2 : 1 / 1.2);
              }
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1 text-xs">
              <span className="truncate font-medium">
                {preview.page
                  ? `Reference · page ${preview.page}`
                  : preview.error || "Loading reference…"}
              </span>
              <div className="flex items-center gap-0.5">
                {preview.page && (
                  <>
                    <button
                      type="button"
                      aria-label="Zoom out preview"
                      className={button}
                      onClick={() => zoomPreview(1 / 1.25)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label="Zoom in preview"
                      className={button}
                      onClick={() => zoomPreview(1.25)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      aria-label="Go to referenced page"
                      className={button}
                      onClick={() => {
                        if (preview.page)
                          session.current?.goToPage(preview.page);
                        previewAbort.current?.abort();
                        setPreview(null);
                      }}
                    >
                      Go
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label="Close reference preview"
                  className={button}
                  onClick={() => {
                    previewAbort.current?.abort();
                    setPreview(null);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div
              data-preview-scroll
              className="min-h-0 flex-1 overflow-auto bg-white"
            />
          </div>
        )}
        {!ready && !error && !password && (
          <p
            role="status"
            className="pointer-events-none absolute inset-x-0 top-5 text-center text-xs text-muted-foreground"
          >
            Loading PDF…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="absolute inset-x-0 top-5 bg-background p-4 text-center text-xs text-destructive"
          >
            Unable to open PDF: {error}
          </p>
        )}
        {password && (
          <form
            className="absolute inset-x-0 top-5 mx-auto flex max-w-sm flex-col gap-2 rounded border border-border bg-background p-4"
            onSubmit={(e) => {
              e.preventDefault();
              password.submit(passwordValue);
              setPassword(null);
            }}
          >
            <label htmlFor={passwordId} className="text-sm">
              {password.incorrect
                ? "Incorrect password. Try again."
                : "This PDF requires a password."}
            </label>
            <input
              id={passwordId}
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              className="rounded border border-border p-2"
            />
            <button type="submit" className={button}>
              Unlock PDF
            </button>
          </form>
        )}
      </div>
    </div>
  );
  return (
    <>
      <div ref={hostRef} className="h-full min-h-0 w-full min-w-0" />
      {createPortal(viewer, portalHost)}
    </>
  );
}
