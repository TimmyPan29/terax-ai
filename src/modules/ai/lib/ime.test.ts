import { describe, expect, it } from "vitest";
import { isImeCommitEnter } from "./ime";

const enter = {
  key: "Enter",
  isComposing: false,
  keyCode: 13,
};

describe("isImeCommitEnter", () => {
  it("recognizes active composition from browser and local state", () => {
    expect(
      isImeCommitEnter({ ...enter, isComposing: true }, false, null, 100),
    ).toBe(true);
    expect(isImeCommitEnter(enter, true, null, 100)).toBe(true);
  });

  it("recognizes Chromium IME process events", () => {
    expect(isImeCommitEnter({ ...enter, keyCode: 229 }, false, null, 100)).toBe(
      true,
    );
  });

  it("guards Enter immediately after compositionend", () => {
    expect(isImeCommitEnter(enter, false, 100, 150)).toBe(true);
    expect(isImeCommitEnter(enter, false, 100, 151)).toBe(false);
  });

  it("allows ordinary Enter and ignores non-Enter composition keys", () => {
    expect(isImeCommitEnter(enter, false, null, 100)).toBe(false);
    expect(
      isImeCommitEnter(
        { key: "Space", isComposing: true, keyCode: 229 },
        true,
        null,
        100,
      ),
    ).toBe(false);
  });
});
