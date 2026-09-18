import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import { previewMath } from "./lib/mathPlugin";
import { markdownComponents } from "./markdownComponents";
import "katex/dist/katex.min.css";
import "./math.css";

const plugins = { math: previewMath, mermaid };

export default function MarkdownFull({ content }: { content: string }) {
  return (
    <Streamdown
      className="min-w-0 select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={markdownComponents}
      plugins={plugins}
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {content}
    </Streamdown>
  );
}
