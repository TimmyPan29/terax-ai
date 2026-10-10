import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { previewMath } from "@/modules/markdown/lib/mathPlugin";
import "katex/dist/katex.min.css";
import "@/modules/markdown/math.css";
const plugins = { math: previewMath };
export default function AiMessageMath(props: MessageResponseProps) {
  return <MessageResponse {...props} plugins={plugins} />;
}
