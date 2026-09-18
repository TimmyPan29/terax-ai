import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import { markdownComponents } from "./markdownComponents";

const plugins = { mermaid };

export default function MarkdownMermaid({ content }: { content: string }) {
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
