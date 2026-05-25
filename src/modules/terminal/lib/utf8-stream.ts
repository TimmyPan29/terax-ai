/**
 * UTF-8 boundary stitching for the PTY byte stream.
 *
 * A single multi-byte UTF-8 character (e.g. a CJK glyph = 3 bytes, an emoji =
 * 4 bytes) can be split across two PTY read chunks. xterm's own decoder buffers
 * such a partial sequence across `write()` calls — but only while the same
 * `Terminal` keeps processing. In Terax a session's bytes are routed either to
 * the live `slot.term` or, when the pane is dormant, to a raw `DormantRing`, and
 * slots are pooled + `reset()` on rebind. If a character's leading bytes land in
 * the live decoder and then the pane is switched away, `reset()` discards them
 * while the trailing bytes go to the ring — on switch-back the orphaned
 * continuation bytes decode to `�` (issue: CJK garbles after tab/pane switch).
 *
 * Stitching at the session level — before the live/dormant split — guarantees
 * both consumers only ever see complete UTF-8 sequences, so a character can
 * never be torn across the boundary. Escape sequences (ESC, CSI, OSC) are pure
 * ASCII (< 0x80) and are never held.
 */

/**
 * Length of the longest prefix of `data` that ends on a complete UTF-8
 * sequence. Returns `data.length` when the buffer already ends cleanly (or ends
 * in malformed bytes we'd rather hand to xterm as replacement chars than hold
 * indefinitely); otherwise the index where the trailing incomplete sequence
 * begins.
 */
function completeUtf8Len(data: Uint8Array): number {
  const n = data.length;
  if (n === 0) return 0;

  // Walk back over continuation bytes (10xxxxxx) to find the last lead byte.
  // A valid sequence has at most 3 continuation bytes; more means malformed.
  let i = n - 1;
  let cont = 0;
  while (i >= 0 && (data[i] & 0xc0) === 0x80) {
    i--;
    if (++cont > 3) return n;
  }
  if (i < 0) return n; // continuation bytes with no lead — malformed, pass through

  const lead = data[i];
  let need: number;
  if ((lead & 0x80) === 0) need = 1; // 0xxxxxxx ASCII
  else if ((lead & 0xe0) === 0xc0) need = 2; // 110xxxxx
  else if ((lead & 0xf0) === 0xe0) need = 3; // 1110xxxx
  else if ((lead & 0xf8) === 0xf0) need = 4; // 11110xxx
  else return n; // invalid lead byte — pass through

  const have = n - i;
  return have >= need ? n : i;
}

export type Utf8Stitch = { out: Uint8Array; tail: Uint8Array | null };

/**
 * Prepend any held `tail` from the previous chunk, then split off a trailing
 * incomplete UTF-8 sequence (≤ 3 bytes) to carry into the next call. `out` is
 * always a run of complete sequences safe to write to xterm or buffer raw.
 */
export function stitchUtf8(
  tail: Uint8Array | null,
  chunk: Uint8Array,
): Utf8Stitch {
  let data: Uint8Array;
  if (tail && tail.length > 0) {
    data = new Uint8Array(tail.length + chunk.length);
    data.set(tail, 0);
    data.set(chunk, tail.length);
  } else {
    data = chunk;
  }

  const cut = completeUtf8Len(data);
  if (cut >= data.length) return { out: data, tail: null };
  return { out: data.subarray(0, cut), tail: data.slice(cut) };
}
