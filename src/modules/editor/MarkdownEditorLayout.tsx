import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { MarkdownViewMode } from "@/modules/markdown/MarkdownViewToggle";
import {
  lazy,
  type ReactNode,
  Suspense,
  useDeferredValue,
  useLayoutEffect,
  useEffect,
  useRef,
} from "react";
import { usePanelRef } from "react-resizable-panels";

const MarkdownContent = lazy(
  () => import("@/modules/markdown/MarkdownContent"),
);

function LivePreview({ content }: { content: string }) {
  const deferredContent = useDeferredValue(content);
  if (deferredContent.length > 4 * 1024 * 1024) {
    return (
      <p className="text-xs text-muted-foreground">
        Document is too large for live preview.
      </p>
    );
  }
  return (
    <Suspense
      fallback={
        <p className="text-xs text-muted-foreground">Loading preview…</p>
      }
    >
      <MarkdownContent content={deferredContent} />
    </Suspense>
  );
}

export function MarkdownEditorLayout({
  children,
  content,
  mode,
  visible,
}: {
  children: ReactNode;
  content: string;
  mode: MarkdownViewMode;
  visible: boolean;
}) {
  const sourceContainerRef = useRef<HTMLDivElement>(null);
  const previewContainerRef = useRef<HTMLElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const sourceRef = usePanelRef();
  const previewRef = usePanelRef();

  useLayoutEffect(() => {
    if (mode === "raw") {
      sourceRef.current?.expand();
      previewRef.current?.collapse();
    } else if (mode === "rendered") {
      previewRef.current?.expand();
      sourceRef.current?.collapse();
    } else {
      sourceRef.current?.resize("50%");
    }
  }, [mode, sourceRef, previewRef]);

  useEffect(() => {
    if (!visible || mode !== "split") return;
    const sourceContainer = sourceContainerRef.current;
    const preview = previewContainerRef.current;
    const previewContent = previewContentRef.current;
    if (!sourceContainer || !preview || !previewContent) return;

    let frame: number | undefined;
    const sync = () => {
      frame = undefined;
      const source = sourceContainer.querySelector<HTMLElement>(".cm-scroller");
      if (!source) return;
      const sourceRange = source.scrollHeight - source.clientHeight;
      const progress =
        sourceRange > 0
          ? Math.min(1, Math.max(0, source.scrollTop / sourceRange))
          : 0;
      preview.scrollTop =
        progress * Math.max(0, preview.scrollHeight - preview.clientHeight);
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(sync);
    };
    const onScroll = (event: Event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("cm-scroller")
      ) {
        schedule();
      }
    };
    sourceContainer.addEventListener("scroll", onScroll, true);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(sourceContainer);
    resizeObserver.observe(preview);
    resizeObserver.observe(previewContent);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(sourceContainer, {
      childList: true,
      subtree: true,
    });
    schedule();
    return () => {
      sourceContainer.removeEventListener("scroll", onScroll, true);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [mode, visible]);

  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel
        id="markdown-source"
        panelRef={sourceRef}
        defaultSize={
          mode === "rendered" ? "0%" : mode === "raw" ? "100%" : "50%"
        }
        minSize="20%"
        collapsible
        disabled={mode !== "split"}
        aria-hidden={mode === "rendered"}
      >
        <div
          ref={sourceContainerRef}
          className="h-full min-w-0"
          inert={mode === "rendered"}
        >
          {children}
        </div>
      </ResizablePanel>
      <ResizableHandle
        disabled={mode !== "split"}
        className={mode !== "split" ? "hidden" : undefined}
        aria-label="Resize Markdown source and preview"
      />
      <ResizablePanel
        id="markdown-preview"
        panelRef={previewRef}
        defaultSize={
          mode === "raw" ? "0%" : mode === "rendered" ? "100%" : "50%"
        }
        minSize="20%"
        collapsible
        disabled={mode !== "split"}
        aria-hidden={mode === "raw"}
      >
        <section
          ref={previewContainerRef}
          className="h-full min-w-0 overflow-auto bg-background px-8 py-6"
          aria-label="Markdown preview"
        >
          <div ref={previewContentRef}>
            {visible && mode !== "raw" && <LivePreview content={content} />}
          </div>
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
