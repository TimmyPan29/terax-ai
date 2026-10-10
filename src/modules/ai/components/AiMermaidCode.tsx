import {
  MarkdownCode,
  markdownCodeText,
} from "@/components/ai-elements/markdown-code";
import { mermaid } from "@streamdown/mermaid";
import { type ComponentProps, type ReactNode, useContext } from "react";
import { Streamdown, StreamdownContext } from "streamdown";

const plugins = { mermaid };

export function AiMermaidCode(
  props: ComponentProps<"code"> | Record<string, unknown>,
) {
  const { isAnimating, mode } = useContext(StreamdownContext);
  if (
    typeof props.className !== "string" ||
    !/^language-mermaid(?:\s|$)/.test(props.className)
  ) {
    return (
      <MarkdownCode
        className={
          typeof props.className === "string" ? props.className : undefined
        }
      >
        {props.children as ReactNode}
      </MarkdownCode>
    );
  }
  const code = markdownCodeText(props.children as ReactNode);
  return (
    <Streamdown
      plugins={plugins}
      mode={mode}
      isAnimating={isAnimating}
      parseIncompleteMarkdown={false}
    >
      {`\`\`\`mermaid\n${code}\n\`\`\``}
    </Streamdown>
  );
}
