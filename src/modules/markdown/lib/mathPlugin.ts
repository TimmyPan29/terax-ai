import { createMathPlugin } from "@streamdown/math";
import type { Element, Root as HastRoot, RootContent } from "hast";
import type { Nodes, Root } from "mdast";
import { unified } from "unified";
import type { VFile } from "vfile";
import { remarkLatex } from "./remarkLatex";

const official = createMathPlugin({ singleDollarTextMath: true });
const katex = unified().use([official.rehypePlugin]);

type MathSource = { raw: string; display: boolean };
declare module "vfile" {
  interface DataMap {
    teraxMath?: globalThis.Map<string, MathSource>;
  }
}

function findMathId(
  properties: Element["properties"],
): { display: boolean; id: string } | undefined {
  const className = properties?.className;
  if (!className) return undefined;
  const classes = Array.isArray(className) ? className : [className];
  for (const cls of classes) {
    if (typeof cls === "string") {
      const match = cls.match(/^language-terax-math-(display|inline)-(.+)$/);
      if (match) {
        return { display: match[1] === "display", id: match[2] };
      }
    }
  }
  return undefined;
}

function remarkPreviewMath(this: ReturnType<typeof unified>) {
  this.use([official.remarkPlugin]).use(remarkLatex);
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    // Internal IDs distinguish parsed math from code and raw HTML after sanitization.
    const sources = new Map<string, MathSource>();
    file.data.teraxMath = sources;
    const sessionPrefix = Math.random().toString(36).slice(2, 8);
    let counter = 0;
    function walk(node: Nodes) {
      if (node.type === "math" || node.type === "inlineMath") {
        const raw =
          node.position?.start.offset !== undefined &&
          node.position?.end.offset !== undefined
            ? source.slice(node.position.start.offset, node.position.end.offset)
            : node.type === "math"
              ? `$$\n${node.value}\n$$`
              : `\\(${node.value}\\)`;
        const display = node.type === "math" || raw.startsWith("\\[");
        const id = `${sessionPrefix}-${++counter}`;
        sources.set(id, { raw, display });
        node.data = {
          hName: "code",
          hProperties: {
            className: [
              `language-terax-math-${display ? "display" : "inline"}-${id}`,
            ],
          },
          hChildren: [{ type: "text", value: node.value }],
        };
      } else if ("children" in node) {
        for (const child of node.children) walk(child);
      }
    }
    walk(tree);
  };
}

function rehypePreviewMath() {
  return (tree: HastRoot, file: VFile) => {
    function walk(parent: HastRoot | Element) {
      parent.children = parent.children.map((node): RootContent => {
        if (node.type !== "element") return node;
        const mathMeta =
          node.tagName === "code" ? findMathId(node.properties) : undefined;
        const source = mathMeta
          ? file.data.teraxMath?.get(mathMeta.id)
          : undefined;
        if (!source) {
          walk(node);
          return node;
        }
        const { display, raw } = source;
        node.properties = {
          className: [display ? "math-display" : "math-inline"],
        };
        const isolated: HastRoot = { type: "root", children: [node] };
        const rendered = katex.runSync(isolated) as HastRoot;
        const error = rendered.children.find(
          (child) =>
            child.type === "element" &&
            Array.isArray(child.properties.className) &&
            child.properties.className.includes("katex-error"),
        );
        return {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              display ? "markdown-math-block" : "markdown-math-inline",
            ],
            ...(display
              ? { tabIndex: 0, role: "region", ariaLabel: "Math formula" }
              : {}),
          },
          children:
            error?.type === "element"
              ? [
                  {
                    type: "element",
                    tagName: "span",
                    properties: {
                      className: ["markdown-math-error"],
                      title: error.properties.title,
                    },
                    children: [
                      { type: "text", value: raw },
                      {
                        type: "element",
                        tagName: "span",
                        properties: {
                          className: ["markdown-math-error-label"],
                        },
                        children: [{ type: "text", value: "Invalid formula" }],
                      },
                    ],
                  },
                ]
              : (rendered.children as Element["children"]),
        };
      }) as Element["children"];
    }
    walk(tree);
  };
}

export const previewMath = {
  ...official,
  remarkPlugin: remarkPreviewMath,
  rehypePlugin: rehypePreviewMath,
};
