import { describe, expect, it } from "vitest";
import { computeCommandHighlightRanges } from "./shellEditor";

describe("computeCommandHighlightRanges", () => {
  const known = new Set(["git", "ls", "rg", "sudo", "custom-tool"]);

  it("highlights valid commands and flags", () => {
    const ranges = computeCommandHighlightRanges(
      "git status --short -b",
      known,
    );
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
    const ranges = computeCommandHighlightRanges(
      "ls -la | rg foo && badcmd",
      known,
    );
    expect(ranges).toEqual([
      { from: 0, to: 2, kind: "valid" },
      { from: 3, to: 6, kind: "flag" },
      { from: 9, to: 11, kind: "valid" },
      { from: 19, to: 25, kind: "invalid" },
    ]);
  });

  it("keeps command position after precommands and env assignments", () => {
    const ranges = computeCommandHighlightRanges(
      "FOO=1 sudo custom-tool -v",
      known,
    );
    expect(ranges).toEqual([
      { from: 6, to: 10, kind: "valid" },
      { from: 11, to: 22, kind: "valid" },
      { from: 23, to: 25, kind: "flag" },
    ]);
  });

  it("keeps command position after quoted and mixed assignment values", () => {
    for (const prefix of [
      'FOO="bar"',
      "FOO='bar baz'",
      'FOO=one" two"three',
      'FOO="escaped \\"quote\\""',
      "FOO=one\\ two",
    ]) {
      const line = `${prefix} git --help | notacommand`;
      expect(computeCommandHighlightRanges(line, known)).toEqual([
        { from: prefix.length + 1, to: prefix.length + 4, kind: "valid" },
        { from: prefix.length + 5, to: prefix.length + 11, kind: "flag" },
        { from: prefix.length + 14, to: prefix.length + 25, kind: "invalid" },
      ]);
    }
  });

  it("does not treat completion suggestions as executable commands", () => {
    expect(computeCommandHighlightRanges("docker", new Set())).toEqual([
      { from: 0, to: 6, kind: "invalid" },
    ]);
    expect(
      computeCommandHighlightRanges("docker", new Set(["docker"])),
    ).toEqual([{ from: 0, to: 6, kind: "valid" }]);
  });

  it("avoids declaring unknown commands invalid before the inventory loads", () => {
    expect(computeCommandHighlightRanges("maybe --help", null)).toEqual([
      { from: 6, to: 12, kind: "flag" },
    ]);
  });

  it("does not interpret quoted arguments as commands or flags", () => {
    expect(computeCommandHighlightRanges('git "--not-a-flag"', known)).toEqual([
      { from: 0, to: 3, kind: "valid" },
    ]);
  });
});
