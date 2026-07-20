import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "EditorPane.tsx"), "utf8");
const pdfBranch =
  src.match(/if \(isPdf\) \{([\s\S]*?)\n {6}\}\n\n {6}if \(isImage/)?.[1] ?? "";
const pdfContainerClass =
  pdfBranch.match(/<div className="([^"]+)">/)?.[1] ?? "";
const pdfIframeClass =
  pdfBranch.match(/<iframe[\s\S]*?className="([^"]+)"/)?.[1] ?? "";

describe("EditorPane PDF preview layout", () => {
  it("uses a dedicated PDF branch", () => {
    expect(pdfBranch).not.toBe("");
    expect(src).toMatch(/if \(isImage \|\| isVideo \|\| isAudio\)/);
    expect(src).not.toMatch(
      /if \(isImage \|\| isVideo \|\| isAudio \|\| isPdf\)/,
    );
  });

  it("fills the pane without centered media padding or scrolling", () => {
    expect(pdfContainerClass).toContain("zoom-exempt");
    expect(pdfContainerClass).toContain("h-full");
    expect(pdfContainerClass).toContain("w-full");
    expect(pdfContainerClass).toContain("min-w-0");
    expect(pdfContainerClass).toContain("overflow-hidden");
    expect(pdfContainerClass).not.toMatch(
      /(?:items-center|justify-center|overflow-auto|p-4)/,
    );
  });

  it("keeps the native PDF iframe inside the available width", () => {
    expect(pdfIframeClass).toContain("block");
    expect(pdfIframeClass).toContain("h-full");
    expect(pdfIframeClass).toContain("w-full");
    expect(pdfIframeClass).toContain("min-w-0");
    expect(pdfIframeClass).toContain("border-0");
  });
});
