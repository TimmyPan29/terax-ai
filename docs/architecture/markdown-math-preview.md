# Markdown math preview

Implemented on `feat/markdown-katex-math`, against baseline `1e58f10`.

## Rendering

Only `.md` Rendered previews opt into the math renderer. Raw editing and AI chat
retain their existing behavior. The preview stays behind `MarkdownStackLazy`;
a conservative delimiter check additionally imports `MarkdownMath` only for
potential math documents. This check does not rewrite content and may also load
the renderer for delimiters inside code examples.

`remarkLatex` adds a micromark text construct before CommonMark character escapes.
It recognizes `\(...\)` and `\[...\]`, including multiline matrices and aligned
expressions. Markdown itself owns code, fenced code, HTML and destination parsing.
The official `@streamdown/math` plugin supplies `$$` and single-dollar `$...$` inline
parsing with KaTeX rendering; currency expressions like `$50` remain ordinary text.
Unclosed delimiters fall back to ordinary Markdown parsing.

The remark pass generates stable internal IDs stored in the per-document VFile
and attaches them via language-terax-math-(inline|display)-<id> class names.
After Streamdown's HTML sanitization, the rehype pass resolves these IDs directly,
ensuring formulas in markdown tables, headers, and container blocks render reliably
without depending on node source offsets. Code fences and non-matching math
classes remain standard code elements. KaTeX's default untrusted mode remains enabled.

Invalid KaTeX expressions retain their full source delimiters, show an inline
Invalid formula label, and expose the parse error in a tooltip. Other expressions
continue rendering. Display formulas have a focusable, named horizontal scroll
region. Math inherits the active theme's foreground; errors use --destructive.

KaTeX's own CSS and font assets are bundled through Vite with no CDN references.
The explicit markdown-katex chunk contains only the engine: assigning the whole
math plugin to this chunk also pulls shared parser dependencies into it and makes
ordinary Streamdown imports load KaTeX prematurely.

Reference: [Streamdown math plugin](https://streamdown.ai/docs/plugins/math).

## Automated validation, 2026-09-18

- Math module: 32 tests passed, including table cell formulas (inline, dollar, display),
  headers, data rows, multiple formulas per cell, isolated errors, code, and links,
  as well as actual React HTML/MathML rendering, fractions, scripts, integrals,
  matrices, aligned equations, escapes, HTML and links.
- Full frontend suite: 1,189 tests passed across 168 files.
- `pnpm lint`: passed with existing repository warnings.
- `pnpm check-types` and `pnpm build --manifest`: passed in a validation copy
  containing tracked project files plus this change. The original workspace has
  untracked `commands.test 2.ts`, `useExplorerDnd.test 2.ts`, and
  `useTerminalFileDrop.test 2.ts` files with stale types; they block both commands
  in that workspace and were left untouched. The validation copy shares the
  installed dependencies and uses `--config.verify-deps-before-run=false` to
  prevent pnpm from replacing the shared dependency directory.
- `cargo clippy --all-targets --locked -- -D warnings`: passed.
- `cargo nextest` is unavailable; `cargo test --locked`: 356 passed, 1 ignored.
- Production manifest traversal: main, settings, and MarkdownStack static import
  graphs exclude KaTeX; MarkdownStack dynamically imports MarkdownMath.
- Production CSS audit: 59 local font files and 1 inlined font, all resolvable;
  zero external font URLs.

## Size and rendering measurements

Same-machine Vite production builds, before and after the change. Totals below
compare JavaScript, CSS and font assets; they exclude unrelated public files and
the optional build manifest. Gzip uses Python's default compression level 9.

| Added asset category | Bytes |
| --- | ---: |
| JavaScript | 274,921 |
| JavaScript, gzip | 82,020 |
| CSS | 29,309 |
| Fonts (WOFF2, WOFF and TTF) | 1,072,948 |
| Total uncompressed JS, CSS and fonts | 1,377,178 |

KaTeX engine chunk: 258,687 bytes. The math renderer chunk is 14,784 bytes.
All font formats supplied by KaTeX's stylesheet remain packaged for offline use.

`MATH_BENCH=1 pnpm exec vitest run src/modules/markdown/MarkdownMath.performance.test.tsx`
renders a 16,289-byte document with 200 formulas, including integrals, fractions,
alignment and matrices. Three consecutive `renderToStaticMarkup` calls measured
389.6 ms, 240.9 ms and 230.9 ms on this host. This measures parsing, KaTeX, React
and HTML serialization after module import. It does not measure dynamic import,
font loading, browser layout or Tauri paint time.

## Tauri visual acceptance still pending

`pnpm tauri dev` compiled and launched successfully. Native UI automation could
not obtain its window (`cgWindowNotFound` and `timeoutReached`), including a
separate temporary preview app. No visual pass is claimed.

Use `docs/fixtures/markdown-math.md` to finish these checks in Tauri:

- Confirm fractions, scripts, matrices and alignment use the bundled fonts.
- Check light and dark themes, including the local error text.
- Scroll the long expression horizontally without moving the document sideways.
- Switch Raw to Rendered and back; confirm source and code examples stay intact.
- Repeat offline to verify actual font loading in the native webview.

KaTeX compatibility applies; this is not a full LaTeX or MathJax implementation.
