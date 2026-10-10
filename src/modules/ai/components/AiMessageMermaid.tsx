import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { AiMermaidCode } from "@/modules/ai/components/AiMermaidCode";
import { mermaid } from "@streamdown/mermaid";
const plugins = { mermaid };
export default function AiMessageMermaid(props: MessageResponseProps) {
  return (
    <MessageResponse
      {...props}
      plugins={plugins}
      components={{ ...props.components, code: AiMermaidCode }}
    />
  );
}
