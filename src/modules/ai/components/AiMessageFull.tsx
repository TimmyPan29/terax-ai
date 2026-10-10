import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { AiMermaidCode } from "@/modules/ai/components/AiMermaidCode";
import { previewMath } from "@/modules/markdown/lib/mathPlugin";
import { mermaid } from "@streamdown/mermaid";
import "katex/dist/katex.min.css";
import "@/modules/markdown/math.css";
const plugins = { math: previewMath, mermaid };
export default function AiMessageFull(props: MessageResponseProps) {
  return (
    <MessageResponse
      {...props}
      plugins={plugins}
      components={{ ...props.components, code: AiMermaidCode }}
    />
  );
}
