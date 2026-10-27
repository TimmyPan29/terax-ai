import { describe, expect, it } from "vitest";
import { computeCommandHighlightRanges } from "./shellEditor";

describe("computeCommandHighlightRanges", () => {
  const known = new Set(["git", "ls", "rg", "custom-tool"]);

  it("highlights valid commands and flags", () => {
    const ranges = computeCommandHighlightRanges("git status --short -b", known);
    expect(ranges).toEqual([
      { from: 0, to: 3, kind: "valid" },
      { from: 11, to: 18, kind: "flag" },
      { from: 19, to: 21, kind: "flag" },
    ]);
  });

  it("marks unknown commands as invalid", () => {
    const ranges = computeCommandHighlightRanges("notacommand --help", known);
    expect(ranges).toEqual([
      { from: 0, to: 11, kind: "invalid" },
      { from: 12, to: 18, kind: "flag" },
    ]);
  });

  it("highlights commands across pipes and separators", () => {
    const ranges = computeCommandHighlightRanges("ls -la | rg foo && badcmd", known);
    expect(ranges).toEqual([
      { from: 0, to: 2, kind: "valid" },
      { from: 3, to: 6, kind: "flag" },
      { from: 9, to: 11, kind: "valid" },
      { from: 19, to: 25, kind: "invalid" },
    ]);
  });

  it("keeps command position after precommands and env assignments", () => {
    const ranges = computeCommandHighlightRanges("FOO=1 sudo custom-tool -v", known);
    expect(ranges).toEqual([
      { from: 6, to: 10, kind: "valid" },
      { from: 11, to: 22, kind: "valid" },
      { from: 23, to: 25, kind: "flag" },
    ]);
  });
});
