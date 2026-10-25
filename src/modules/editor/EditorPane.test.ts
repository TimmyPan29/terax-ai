import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./EditorPane.tsx", import.meta.url),
  "utf8",
);

describe("PDF preview integration", () => {
  it("loads the searchable PDF viewer only when required", () => {
    expect(source).toContain(
      'lazy(() => import("@/modules/editor/pdf/PdfPane"))',
    );
    expect(source).toContain("<PdfPane");
    expect(source).not.toContain("<iframe");
  });
  it("routes PDF text and binary files to the same viewer", () => {
    expect(source.indexOf("<PdfPane")).toBeLessThan(
      source.indexOf('doc.status === "binary" || doc.status === "toolarge"'),
    );
  });
  it("forwards the editor search handle to PDF search requests", () => {
    const search = source.slice(
      source.indexOf("openSearch: () => {"),
      source.indexOf("focus: () => {"),
    );
    expect(search).toContain('path.toLowerCase().endsWith(".pdf")');
    expect(search).toContain("setPdfSearchRequest((value) => value + 1)");
    expect(source).toContain("searchRequest={pdfSearchRequest}");
    expect(search).toContain("openSearchPanel(view)");
  });
  it("retains reload and active-tab visibility boundaries", () => {
    expect(source).toMatch(/\?v=\$\{reloadRevision\}/);
    expect(source).toContain("key={assetUrl}");
    expect(source).toContain("visible={visible}");
  });
});
