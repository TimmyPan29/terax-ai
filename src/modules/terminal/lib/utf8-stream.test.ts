import { describe, expect, it } from "vitest";
import { stitchUtf8 } from "./utf8-stream";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...b: number[]) => new Uint8Array(b);

// "中" = E4 B8 AD, "好" = E5 A5 BD, "🎉" = F0 9F 8E 89
describe("stitchUtf8", () => {
  it("passes ASCII through untouched", () => {
    const { out, tail } = stitchUtf8(null, enc("hello\n"));
    expect(Array.from(out)).toEqual(Array.from(enc("hello\n")));
    expect(tail).toBeNull();
  });

  it("passes a complete CJK string through", () => {
    const { out, tail } = stitchUtf8(null, enc("中文"));
    expect(Array.from(out)).toEqual(Array.from(enc("中文")));
    expect(tail).toBeNull();
  });

  it("holds a CJK char split across two chunks", () => {
    // First chunk ends after the first 2 of 中's 3 bytes.
    const first = bytes(0xe4, 0xb8);
    const r1 = stitchUtf8(null, first);
    expect(r1.out.length).toBe(0);
    expect(Array.from(r1.tail!)).toEqual([0xe4, 0xb8]);

    // Next chunk delivers the final byte plus more text; tail is stitched on.
    const r2 = stitchUtf8(r1.tail, bytes(0xad, 0x21)); // 中 + "!"
    expect(Array.from(r2.out)).toEqual([0xe4, 0xb8, 0xad, 0x21]);
    expect(r2.tail).toBeNull();
  });

  it("holds an emoji (4-byte) split at every boundary", () => {
    const full = enc("🎉"); // F0 9F 8E 89
    for (let split = 1; split <= 3; split++) {
      const r1 = stitchUtf8(null, full.subarray(0, split));
      expect(r1.out.length).toBe(0);
      expect(Array.from(r1.tail!)).toEqual(Array.from(full.subarray(0, split)));
      const r2 = stitchUtf8(r1.tail, full.subarray(split));
      expect(Array.from(r2.out)).toEqual(Array.from(full));
      expect(r2.tail).toBeNull();
    }
  });

  it("emits the leading complete chars and holds only the torn tail", () => {
    // "好" complete + first 2 bytes of "中"
    const chunk = new Uint8Array([...enc("好"), 0xe4, 0xb8]);
    const { out, tail } = stitchUtf8(null, chunk);
    expect(Array.from(out)).toEqual(Array.from(enc("好")));
    expect(Array.from(tail!)).toEqual([0xe4, 0xb8]);
  });

  it("does not hold escape sequences (pure ASCII)", () => {
    const csi = enc("\x1b[?2004h\x1b[0m");
    const { out, tail } = stitchUtf8(null, csi);
    expect(Array.from(out)).toEqual(Array.from(csi));
    expect(tail).toBeNull();
  });

  it("passes malformed lone continuation bytes through (does not hold forever)", () => {
    const { out, tail } = stitchUtf8(null, bytes(0x80, 0x80));
    expect(Array.from(out)).toEqual([0x80, 0x80]);
    expect(tail).toBeNull();
  });
});
