import { performance } from "node:perf_hooks";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import MarkdownMath from "./MarkdownMath";

it("renders a document containing 200 formulas", () => {
  const content = Array.from(
    { length: 100 },
    (_, index) => String.raw`
## Equation ${index}

Inline \(x_i^2 + \frac{1}{2}\).

\[
\begin{aligned}
F(x) &= \int_0^x t^2\,dt \\
A &= \begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\end{aligned}
\]
`,
  ).join("\n");
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const html = renderToStaticMarkup(<MarkdownMath content={content} />);
    times.push(performance.now() - start);
    expect(html.match(/class="katex"/g)).toHaveLength(200);
    expect(html).not.toContain("Invalid formula");
  }
  if (process.env.MATH_BENCH) {
    process.stdout.write(
      JSON.stringify({
        formulas: 200,
        bytes: Buffer.byteLength(content),
        renderMs: times,
      }),
    );
  }
}, 20_000);
