import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fitImageScale,
  imageLayout,
  imageZoomScroll,
  MAX_IMAGE_ZOOM,
  MIN_IMAGE_ZOOM,
  stepImageZoom,
  type ImageSize,
} from "@/modules/editor/lib/imageViewport";

const buttonClass =
  "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40";

export function ImagePreview({
  src,
  alt,
  errorMessage = "Unable to display image.",
}: {
  src: string;
  alt: string;
  errorMessage?: string;
}) {
  const viewportRef = useRef<HTMLElement>(null);
  const [image, setImage] = useState<ImageSize | null>(null);
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const previousLayout = useRef<ReturnType<typeof imageLayout> | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () =>
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = zoom ?? (image ? fitImageScale(image, viewport) : 1);
  const layout = image ? imageLayout(image, viewport, scale) : null;
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element || !image) return;
    const next = imageLayout(image, viewport, scale);
    if (previousLayout.current) {
      const position = imageZoomScroll(
        previousLayout.current,
        next,
        pendingScroll.current ?? {
          left: element.scrollLeft,
          top: element.scrollTop,
        },
      );
      element.scrollLeft = position.left;
      element.scrollTop = position.top;
    }
    pendingScroll.current = null;
    previousLayout.current = next;
  }, [image, viewport, scale]);

  const changeZoom = (next: number | null) => {
    const element = viewportRef.current;
    if (element)
      pendingScroll.current = {
        left: element.scrollLeft,
        top: element.scrollTop,
      };
    setZoom(next);
  };

  const ready = image !== null && !failed;
  return (
    <div className="zoom-exempt flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <fieldset
        aria-label="Image zoom"
        className="flex shrink-0 items-center justify-center gap-1 border-b border-border px-2 py-1"
      >
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          className={buttonClass}
          disabled={!ready || scale <= MIN_IMAGE_ZOOM}
          onClick={() => changeZoom(stepImageZoom(scale, -1))}
        >
          −
        </button>
        <output
          aria-label="Zoom level"
          className="min-w-14 text-center text-xs text-foreground tabular-nums"
        >
          {failed
            ? "Unavailable"
            : ready
              ? `${Math.round(scale * 100)}%`
              : "Loading…"}
        </output>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          className={buttonClass}
          disabled={!ready || scale >= MAX_IMAGE_ZOOM}
          onClick={() => changeZoom(stepImageZoom(scale, 1))}
        >
          +
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!ready}
          aria-pressed={zoom === null}
          onClick={() => changeZoom(null)}
        >
          Fit
        </button>
        <button
          type="button"
          title="Actual size"
          aria-label="Actual size"
          className={buttonClass}
          disabled={!ready}
          aria-pressed={zoom === 1}
          onClick={() => changeZoom(1)}
        >
          100%
        </button>
      </fieldset>
      <section
        ref={viewportRef}
        aria-label="Image preview"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The scroll viewport needs focus for arrow-key scrolling.
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
      >
        {failed ? (
          <p role="alert" className="p-6 text-center text-xs text-destructive">
            {errorMessage}
          </p>
        ) : (
          <div
            className="grid min-h-full min-w-full place-items-center"
            style={{ width: layout?.stageWidth, height: layout?.stageHeight }}
          >
            <img
              src={src}
              alt={alt}
              decoding="async"
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setImage({ width: naturalWidth, height: naturalHeight });
                } else setFailed(true);
              }}
              onError={() => setFailed(true)}
              className="block max-w-none shrink-0"
              style={{
                width: layout?.width,
                height: layout?.height,
                visibility: image ? "visible" : "hidden",
                backgroundImage:
                  "conic-gradient(var(--muted) 0.25turn, transparent 0.25turn 0.5turn, var(--muted) 0.5turn 0.75turn, transparent 0.75turn)",
                backgroundSize: "20px 20px",
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}
