import { describe, expect, it } from "vitest";
import { applyUnifiedPatch } from "@/modules/ai/codex/patch";

describe("applyUnifiedPatch", () => {
  it("applies replacements and insertions", () => {
    const result = applyUnifiedPatch(
      "one\ntwo\nthree\n",
      [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,4 @@",
        " one",
        "-two",
        "+second",
        "+between",
        " three",
      ].join("\n"),
    );
    expect(result).toEqual({
      ok: true,
      content: "one\nsecond\nbetween\nthree\n",
    });
  });

  it("rejects a patch whose context does not match", () => {
    expect(
      applyUnifiedPatch("one\ntwo\n", "@@ -1,2 +1,2 @@\n one\n-wrong\n+next"),
    ).toEqual({ ok: false });
  });
});

