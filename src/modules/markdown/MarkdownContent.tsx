import { lazy, Suspense } from "react";
import { Streamdown } from "streamdown";
import { markdownComponents } from "./markdownComponents";

const MarkdownMath = lazy(() => import("./MarkdownMath"));
const MarkdownMermaid = lazy(() => import("./MarkdownMermaid"));
const MarkdownFull = lazy(() => import("./MarkdownFull"));

export default function MarkdownContent({ content }: { content: string }) {
  const hasMath = /\\[([]|\$\$|\$[^$\s]/.test(content);
  const hasMermaid = /(?:```|~~~)mermaid(?:[\s{]|$)/.test(content);

  if (hasMath && hasMermaid) {
    return (
      <Suspense
        fallback={
          <p className="text-[12px] text-muted-foreground">Loading preview…</p>
        }
      >
        <MarkdownFull content={content} />
      </Suspense>
    );
  }

  if (hasMath) {
    return (
      <Suspense
        fallback={
          <p className="text-[12px] text-muted-foreground">Loading math…</p>
        }
      >
        <MarkdownMath content={content} />
      </Suspense>
    );
  }

  if (hasMermaid) {
    return (
      <Suspense
        fallback={
          <p className="text-[12px] text-muted-foreground">Loading diagram…</p>
        }
      >
        <MarkdownMermaid content={content} />
      </Suspense>
    );
  }

  return (
    <Streamdown
      className="min-w-0 select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={markdownComponents}
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {content}
    </Streamdown>
  );
}
