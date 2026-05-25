import { describe, expect, it } from "vitest";
import { DormantRing } from "./dormantRing";
import { stitchUtf8 } from "./utf8-stream";

/**
 * Reproduction of the reported bug: CJK garbles to `�` after switching a
 * terminal pane away and back, when a multi-byte char happens to be split
 * across PTY chunks at the moment of the switch.
 *
 * This drives the REAL `DormantRing` and `stitchUtf8`, and models xterm's
 * internal UTF-8 decoding with a standard streaming `TextDecoder`. The crucial
 * faithfulness point: when the renderer pool releases+rebinds a slot it calls
 * `term.reset()`, which discards any incomplete trailing bytes the live decoder
 * was holding. We model that by throwing the live decoder away on release.
 */

// "好" = E5 A5 BD, "中" = E4 B8 AD, then "!"
const HAO = [0xe5, 0xa5, 0xbd];
const ZHONG = [0xe4, 0xb8, 0xad];

type Term = {
  screen: string;
  dec: TextDecoder;
};

function newTerm(): Term {
  return { screen: "", dec: new TextDecoder("utf-8") };
}

function write(t: Term, bytes: Uint8Array): void {
  t.screen += t.dec.decode(bytes, { stream: true });
}

/**
 * Runs the full bound → switch-away → dormant → switch-back flow.
 * `useFix` toggles the session-level UTF-8 stitching that the real
 * `deliverPtyBytes` performs.
 */
function runFlow(useFix: boolean): string {
  const ring = new DormantRing();
  let tail: Uint8Array | null = null;
  let term: Term | null = newTerm(); // bound

  const deliver = (chunk: Uint8Array) => {
    let out = chunk;
    if (useFix) {
      const r = stitchUtf8(tail, chunk);
      out = r.out;
      tail = r.tail;
      if (out.length === 0) return;
    }
    if (term) write(term, out);
    else ring.push(out);
  };

  // Chunk 1 (bound): "好" + first 2 bytes of "中" — char torn at the boundary.
  deliver(new Uint8Array([...HAO, ZHONG[0], ZHONG[1]]));

  // Switch away: snapshot the already-decoded screen, then drop the live
  // decoder (== term.reset()), discarding any bytes it was still holding.
  const snapshot = term.screen;
  term = null;

  // Chunk 2 (dormant): final byte of "中" + "!".
  deliver(new Uint8Array([ZHONG[2], 0x21]));

  // Switch back: fresh term, replay snapshot text, then drain the ring.
  term = newTerm();
  term.screen = snapshot;
  ring.drain((bytes) => write(term!, bytes));

  return term.screen;
}

describe("CJK split across a tab/pane switch", () => {
  it("reproduces the garble without the stitch fix", () => {
    expect(runFlow(false)).toBe("好�!"); // 中 lost, orphan byte → �
  });

  it("preserves the character with the stitch fix", () => {
    expect(runFlow(true)).toBe("好中!");
  });
});
