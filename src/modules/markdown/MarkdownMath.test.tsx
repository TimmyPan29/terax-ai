import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownMath from "./MarkdownMath";

const render = (content: string) =>
  renderToStaticMarkup(<MarkdownMath content={content} />);

describe("Markdown math rendering", () => {
  it.each([
    String.raw`Inline \(\frac{x_i^2}{2}\) text`,
    String.raw`\[\int_0^1 x^2\,dx\]`,
    "$$\nx^2\n$$",
    "Inline $$x_i$$ text",
    String.raw`\[
\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\]`,
    String.raw`\[
\begin{aligned}a &= b + c \\ d &= e\end{aligned}
\]`,
  ])("renders actual KaTeX and MathML: %s", (source) => {
    const html = render(source);
    expect(html).toContain('class="katex"');
    expect(html).toContain("<math");
    expect(html).not.toContain("Invalid formula");
  });

  it("uses display mode and a scroll container for brackets", () => {
    const html = render(String.raw`\[x^2\]`);
    expect(html).toContain('class="markdown-math-block"');
    expect(html).toContain('class="katex-display"');
  });

  it("retains invalid source and a local error while rendering adjacent math", () => {
    const html = render(String.raw`Before \(\frac{\) after \(x^2\).`);
    expect(html).toContain(String.raw`\(\frac{\)`);
    expect(html).toContain("Invalid formula");
    expect(html).toContain('class="katex"');
    expect(html).toContain("Before");
    expect(html).toContain("after");
  });

  it.each([
    "`\\(x^2\\)`",
    "```latex\n\\[x^2\\]\n```",
    "```math\nx^2\n```",
    "```terax-math-display\nx^2\n```",
    '<code class="language-terax-math-display">x^2</code>',
    "    \\(x^2\\)",
    String.raw`\\(x^2\\)`,
    "<pre>\\(x^2\\)</pre>",
    "[link](https://example.com/\\(x\\))",
  ])("does not convert code, escapes, HTML or URL content: %s", (source) => {
    expect(render(source)).not.toContain('class="katex"');
  });

  it("preserves links and markdown inside a math document", () => {
    const html = render(
      String.raw`**bold** [link](https://example.com) \(x\) and \*literal\*`,
    );
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("*literal*");
  });

  it("handles formulas in list and quote containers", () => {
    const html = render(String.raw`- \(x_i\)

> \[
> \begin{aligned}a &= b \\ c &= d\end{aligned}
> \]`);
    expect(html.match(/class="katex"/g)).toHaveLength(2);
  });

  it("leaves unclosed delimiters as ordinary markdown", () => {
    expect(render(String.raw`Before \(unfinished`)).not.toContain(
      'class="katex"',
    );
  });

  describe("table cell math rendering", () => {
    it("renders inline, dollar, and display formulas in table headers and data cells", () => {
      const markdown = [
        String.raw`| Type \(T_1\) | Formula \[\sum x\] | Notes $$\sigma$$ |`,
        "| :--- | :--- | :--- |",
        String.raw`| inline | \(x_i^2 + \frac{1}{2}\) | Primary inline |`,
        String.raw`| dollar | $$\alpha + \beta$$ | Primary dollar |`,
        String.raw`| display | \[\int_0^1 x^2\,dx\] | Primary display |`,
      ].join("\n");
      const html = render(markdown);

      expect(html).toContain('data-streamdown="table"');
      expect(html).toContain('data-streamdown="table-header-cell"');
      expect(html).toContain('data-streamdown="table-cell"');
      expect(html).toContain('class="katex"');
      expect(html).toContain("<math");
      expect(html).toContain('class="markdown-math-block"');
      expect(html).toContain('class="markdown-math-inline"');
      expect(html).not.toContain("Invalid formula");
    });

    it("renders multiple formulas within the same cell", () => {
      const markdown = [
        "| Formula pairs |",
        "| :--- |",
        String.raw`| Left \(a^2\) and right \(b^2\), plus $$\gamma$$ |`,
      ].join("\n");
      const html = render(markdown);
      const matches = html.match(/class="katex"/g);
      expect(matches).toHaveLength(3);
    });

    it("isolates invalid formulas to their cell without breaking valid neighbors", () => {
      const markdown = [
        "| Invalid | Valid |",
        "| :--- | :--- |",
        String.raw`| \(\frac{\) | \(x_i^2 + 1\) |`,
      ].join("\n");
      const html = render(markdown);

      expect(html).toContain(String.raw`\(\frac{\)`);
      expect(html).toContain("Invalid formula");
      expect(html).toContain('class="markdown-math-error"');
      expect(html).toContain('class="katex"');
    });

    it("preserves code and links within table cells alongside math", () => {
      const markdown = [
        "| Code | Link | Math |",
        "| :--- | :--- | :--- |",
        "| `\\(x^2\\)` and `code` | [doc](https://example.com) | \\(y = mx + b\\) |",
      ].join("\n");
      const html = render(markdown);

      expect(html).toContain(String.raw`>\(x^2\)</code>`);
      expect(html).toContain(">code</code>");
      expect(html).toContain('href="https://example.com/"');
      expect(html).toContain('class="katex"');
    });

    it("renders single-dollar inline formulas in markdown tables", () => {
      const markdown = [
        "| 維度 | 填寫重點提示 |",
        "| :--- | :--- |",
        String.raw`| **3. 模型輸入 (Inputs)** | 具體數學輸入維度與形式（如：接收訊號 $\mathbf{y} \in \mathbb{C}^{MN \times 1}$、估計通道 $\widehat{\mathbf{H}}$、誤差變異數 $\sigma_{\mathrm{e}}^2$、Pilot Mask、SNR）。 |`,
        String.raw`| **4. 模型輸出 (Outputs)** | 輸出形式（如：*Bit-wise Soft LLRs*、*Symbol-level Hard Index (Softmax)*、預編碼矩陣 $\mathbf{W}$、功率係數 $p_c, p_k$）。 |`,
      ].join("\n");
      const html = render(markdown);

      expect(html).toContain('class="katex"');
      expect(html).not.toContain("Invalid formula");
      const matches = html.match(/class="katex"/g);
      expect(matches).toHaveLength(5);
    });
  });
});


