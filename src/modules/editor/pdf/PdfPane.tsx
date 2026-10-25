import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PdfSession } from "@/modules/editor/pdf/pdfSession";

const button = "rounded px-2 py-1 text-xs hover:bg-accent disabled:opacity-40";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef<PdfSession | null>(null);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!visible || !container) return;
    const abort = new AbortController();
    const resumePage = lastPage.current;
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
  return (
    <div className="terax-pdf zoom-exempt flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
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
      </div>
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
}
