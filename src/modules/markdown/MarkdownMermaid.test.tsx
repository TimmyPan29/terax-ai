import { mermaid } from "@streamdown/mermaid";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it } from "vitest";
import MarkdownFull from "./MarkdownFull";
import MarkdownMermaid from "./MarkdownMermaid";
import { markdownComponents } from "./markdownComponents";

describe("Markdown Mermaid rendering", () => {
  it("enters the mermaid diagram branch for mermaid code blocks", () => {
    const content = [
      "# Architecture",
      "",
      "```mermaid",
      "graph TD",
      "  A[Client] --> B[Server]",
      "```",
    ].join("\n");

    const html = renderToStaticMarkup(<MarkdownMermaid content={content} />);

    // Streamdown wraps mermaid in a Suspense boundary with a skeleton loader.
    // In server/SSR rendering, this produces either the animated loading skeleton
    // or the resolved mermaid-block, never a plain code block.
    expect(html).toMatch(/data-streamdown="mermaid-block"|animate-spin/);
    expect(html).not.toContain('data-streamdown="code-block"');
  });

  it("renders non-mermaid code blocks as standard code blocks", () => {
    const content = [
      "```typescript",
      "const answer: number = 42;",
      "```",
    ].join("\n");

    const html = renderToStaticMarkup(<MarkdownMermaid content={content} />);

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('data-language="typescript"');
    expect(html).toContain("const answer: number = 42;");
  });

  it("renders mermaid as a standard code block when mermaid plugin is not present", () => {
    const content = [
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
    ].join("\n");

    const html = renderToStaticMarkup(
      <Streamdown
        className="min-w-0 select-text"
        components={markdownComponents}
        mode="static"
        parseIncompleteMarkdown={false}
      >
        {content}
      </Streamdown>,
    );

    expect(html).toContain('data-streamdown="code-block"');
    expect(html).toContain('data-language="mermaid"');
  });

  it("verifies the streamdown mermaid plugin interface contract", () => {
    expect(mermaid.name).toBe("mermaid");
    expect(mermaid.type).toBe("diagram");
    expect(mermaid.language).toBe("mermaid");
    expect(typeof mermaid.getMermaid).toBe("function");

    const instance = mermaid.getMermaid();
    expect(typeof instance.initialize).toBe("function");
    expect(typeof instance.render).toBe("function");
  });

  it("renders both math formulas and mermaid blocks in MarkdownFull", () => {
    const content = [
      "# Analysis",
      "",
      "Formula: \\(E = mc^2\\)",
      "",
      "```mermaid",
      "graph LR",
      "  Input --> Process --> Output",
      "```",
      "",
      "$$\\int_0^1 x^2 dx$$",
    ].join("\n");

    const html = renderToStaticMarkup(<MarkdownFull content={content} />);

    // Math formulas rendered via KaTeX
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");

    // Mermaid block handled via Streamdown mermaid plugin
    expect(html).toMatch(/data-streamdown="mermaid-block"|animate-spin/);
    expect(html).not.toContain('data-language="mermaid"');
  });

  it("matches mermaid blocks using fence detection patterns", () => {
    const mermaidFencePattern = /(?:```|~~~)mermaid(?:[\s{]|$)/;

    expect(mermaidFencePattern.test("```mermaid\ngraph TD\n```")).toBe(true);
    expect(mermaidFencePattern.test("~~~mermaid\ngraph LR\n~~~")).toBe(true);
    expect(mermaidFencePattern.test("```mermaid {title=\"flow\"}\n```")).toBe(
      true,
    );
    expect(mermaidFencePattern.test("```mermaid-other\n```")).toBe(false);
    expect(mermaidFencePattern.test("```typescript\nconst x = 1;\n```")).toBe(
      false,
    );
    expect(mermaidFencePattern.test("Plain text without code")).toBe(false);
  });
});
