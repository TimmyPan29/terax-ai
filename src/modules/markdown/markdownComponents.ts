import { createElement, type ReactNode } from "react";
import { MarkdownLink } from "./MarkdownLink";

export const markdownComponents = {
  a: MarkdownLink,
  inlineCode: ({
    className: _,
    children,
    ...rest
  }: {
    className?: string;
    children?: ReactNode;
  }) =>
    createElement(
      "code",
      {
        className:
          "rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[0.875em] text-foreground",
        ...rest,
      },
      children,
    ),
};
