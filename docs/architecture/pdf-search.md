# PDF text search

PDF tabs use a lazy PDF.js viewer because the previous native PDF iframe did not
provide a consistent find interface across WKWebView and WebView2.

The existing `search.focus` shortcut dispatch calls the editor handle. PDF paths
increment a search request signal, so Cmd-F on macOS and Ctrl-F on Windows open
and focus the PDF search field even while the viewer is loading. Other files
retain CodeMirror search. Enter and Shift-Enter navigate matches across pages;
Escape closes the field. Matches are highlighted and counted. Case-sensitive
and whole-word matching follow the interaction model reviewed in Pdfcraft.
Search requires a PDF text layer; this implementation does not add OCR.

The engine, worker and viewer CSS load only when a PDF is visible. Hidden tabs
abort loading/rendering, remove the page canvases and destroy the worker. React
retains the current page, query and find controls. Rendering is capped at four
million canvas pixels per page. PDF scripting and annotation editing are not
installed. External PDF links are disabled; the toolbar can reveal the original
file in the OS file manager.

CMaps, standard fonts, image decoder WASM, ICC profiles, annotation images and
license notices are emitted from the pinned dependency into `dist/pdfjs/`.
No CDN is used. `connect-src` permits only the existing application origins and
the specific Tauri asset origins needed to fetch local PDFs. The PDF worker uses
the existing `worker-src 'self' blob:` policy.

The PDF code and worker have a separate 650 kB gzip budget. The existing startup,
non-PDF, terminal and Mermaid budgets are retained. The measured PDF code and
worker are approximately 605 kB gzip; the startup JS remains approximately
237 kB gzip. Support assets are separate from the JavaScript budget.

Verification for v1.0.4:

- Regression tests cover macOS/Windows shortcut dispatch, search routing,
  cancellation during loading, failed loads and worker destruction.
- The eager graph test excludes PDF.js from both window startup paths.
- Development and production browser tests use Mozilla PDF.js's public
  `tracemonkey.pdf` fixture. A `trace` query finds 416 matches; case-sensitive
  search finds 339, and whole-word case-sensitive search finds 261.
- Browser tests cover highlighting, forward/backward traversal, page wrapping,
  Escape, hidden-tab cleanup, page restoration, invalid files and the configured
  CSP. Windows URL tests use an encoded local path with Chinese characters,
  spaces and a `#` character.
- Browser platform flags exercise both shortcut configurations. They are not
  native WKWebView/WebView2 desktop interaction tests. Windows and macOS CI run
  the PDF shortcut, lifecycle and integration regression tests.

Reference fixture:
https://github.com/mozilla/pdf.js/blob/master/test/pdfs/tracemonkey.pdf
