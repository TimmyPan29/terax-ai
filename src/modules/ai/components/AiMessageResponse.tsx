import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";
import { lazy, Suspense } from "react";

const MathResponse = lazy(
  () => import("@/modules/ai/components/AiMessageMath"),
);
const MermaidResponse = lazy(
  () => import("@/modules/ai/components/AiMessageMermaid"),
);
const FullResponse = lazy(
  () => import("@/modules/ai/components/AiMessageFull"),
);

export function AiMessageResponse(props: MessageResponseProps) {
  const content = typeof props.children === "string" ? props.children : "";
  const hasMath = /\\[([]|\$\$|\$[^$\s]/.test(content);
  const hasMermaid = /(?:```|~~~)mermaid(?:[\s{]|$)/.test(content);
  const Response =
    hasMath && hasMermaid
      ? FullResponse
      : hasMath
        ? MathResponse
        : hasMermaid
          ? MermaidResponse
          : MessageResponse;
  const responseProps = {
    ...props,
    mode: props.streaming ? ("streaming" as const) : ("static" as const),
    parseIncompleteMarkdown: props.streaming ?? false,
    isAnimating: props.streaming ?? false,
  };
  return (
    <Suspense fallback={<MessageResponse {...responseProps} />}>
      <Response {...responseProps} />
    </Suspense>
  );
}
