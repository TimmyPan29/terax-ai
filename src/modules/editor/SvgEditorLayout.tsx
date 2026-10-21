import { type ReactNode, useDeferredValue, useEffect, useState } from "react";

function SvgImage({ content, path }: { content: string; path: string }) {
  const deferredContent = useDeferredValue(content);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([deferredContent], { type: "image/svg+xml" }),
    );
    setUrl(next);
    setFailed(false);
    return () => URL.revokeObjectURL(next);
  }, [deferredContent]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-4">
      {failed ? (
        <p role="alert" className="text-xs text-destructive">
          Unable to render SVG. Open Source to inspect the file.
        </p>
      ) : url ? (
        <img
          src={url}
          alt={path.split(/[\\/]/).pop() ?? path}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain"
          style={{
            backgroundImage:
              "conic-gradient(var(--muted) 0.25turn, transparent 0.25turn 0.5turn, var(--muted) 0.5turn 0.75turn, transparent 0.75turn)",
            backgroundSize: "20px 20px",
          }}
        />
      ) : null}
    </div>
  );
}

export function SvgEditorLayout({
  children,
  content,
  path,
  visible,
}: {
  children: ReactNode;
  content: string;
  path: string;
  visible: boolean;
}) {
  const [source, setSource] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <fieldset
        aria-label="SVG view"
        className="flex justify-end gap-1 border-b border-border px-3 py-1 text-xs"
      >
        <button
          type="button"
          aria-pressed={!source}
          onClick={() => setSource(false)}
          className="rounded px-2 py-1 hover:bg-accent"
        >
          Rendered
        </button>
        <button
          type="button"
          aria-pressed={source}
          onClick={() => setSource(true)}
          className="rounded px-2 py-1 hover:bg-accent"
        >
          Source
        </button>
      </fieldset>
      <div className={source ? "min-h-0 flex-1" : "hidden"} inert={!source}>
        {children}
      </div>
      {visible && !source && <SvgImage content={content} path={path} />}
    </div>
  );
}
