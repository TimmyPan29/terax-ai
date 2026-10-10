import { MarkdownLink } from "@/modules/markdown/MarkdownLink";
import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiMessageResponse } from "@/modules/ai/components/AiMessageResponse";

const chatComponents = { code: MarkdownCode, a: MarkdownLink };

async function render(content: string, streaming = false) {
  const stream = await renderToReadableStream(
    <AiMessageResponse streaming={streaming} components={chatComponents}>
      {content}
    </AiMessageResponse>,
  );
  await stream.allReady;
  return new Response(stream).text();
}

describe("AI chat rich Markdown", () => {
  it.each([false, true])(
    "renders preview math with streaming=%s",
    async (streaming) => {
      const html = await render(
        String.raw`Inline \(x_i^2\)

\[\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}\]

| Formula |
| --- |
| $\sigma^2$ |`,
        streaming,
      );
      expect(html.match(/class="katex"/g)).toHaveLength(3);
      expect(html).toContain("<math");
      expect(html).toContain('class="markdown-math-block"');
    },
  );

  it("retains invalid and incomplete formulas without breaking adjacent math", async () => {
    const html = await render(
      String.raw`\(\frac{\) and \(x^2\) then \(unfinished`,
      true,
    );
    expect(html).toContain("Invalid formula");
    expect(html).toContain('class="katex"');
    expect(html).toContain("unfinished");
  });

  it.each([false, true])(
    "routes diagrams through Mermaid with streaming=%s",
    async (streaming) => {
      const html = await render(
        "\\(x^2\\)\n\n```mermaid\ngraph TD\n A --> B\n```",
        streaming,
      );
      expect(html).toContain('class="katex"');
      expect(html).toMatch(/data-streamdown="mermaid-block"|animate-spin/);
      expect(html).not.toContain('data-language="mermaid"');
    },
  );

  it("preserves literal math in code and ordinary chat code blocks", async () => {
    const html = await render(
      "`\\(x^2\\)`\n\n```typescript\nconst answer = 42;\n```\n\n\\(y\\)",
    );
    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain(String.raw`\(x^2\)`);
    expect(html).toContain("const");
    expect(html).toContain("answer");
  });
  it("renders a diagram without requiring math", async () => {
    const html = await render("~~~mermaid\ngraph LR\n A --> B\n~~~");
    expect(html).toMatch(/data-streamdown="mermaid-block"|animate-spin/);
    expect(html).not.toContain('class="katex"');
  });

  it("renders plain Markdown and links without rich plugins", async () => {
    const html = await render("**Answer** [reference](https://example.com)");
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('href="https://example.com/"');
  });
});
