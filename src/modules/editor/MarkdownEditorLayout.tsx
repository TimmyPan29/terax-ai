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
        <div className="h-full min-w-0" inert={mode === "rendered"}>
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
          className="h-full min-w-0 overflow-auto bg-background px-8 py-6"
          aria-label="Markdown preview"
        >
          {visible && mode !== "raw" && <LivePreview content={content} />}
        </section>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
