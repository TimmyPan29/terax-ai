export function applyUnifiedPatch(
  original: string,
  patch: string,
): { ok: true; content: string } | { ok: false } {
  const source = original.split("\n");
  if (source[source.length - 1] === "") source.pop();
  const output: string[] = [];
  let sourceIndex = 0;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let sawHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (!header) continue;
    sawHunk = true;
    const oldStart = Number(header[1]);
    const target = oldStart === 0 ? 0 : oldStart - 1;
    if (target < sourceIndex || target > source.length) return { ok: false };
    output.push(...source.slice(sourceIndex, target));
    sourceIndex = target;

    for (i += 1; i < lines.length && !lines[i].startsWith("@@ "); i++) {
      const line = lines[i];
      if (line.startsWith("\\ No newline at end of file")) continue;
      const marker = line[0];
      const text = line.slice(1);
      if (marker === " ") {
        if (source[sourceIndex] !== text) return { ok: false };
        output.push(text);
        sourceIndex++;
      } else if (marker === "-") {
        if (source[sourceIndex] !== text) return { ok: false };
        sourceIndex++;
      } else if (marker === "+") {
        output.push(text);
      } else if (line.length > 0) {
        return { ok: false };
      }
    }
    i--;
  }

  if (!sawHunk) return { ok: false };
  output.push(...source.slice(sourceIndex));
  const trailingNewline = original.endsWith("\n") || patch.includes("\n+");
  return {
    ok: true,
    content: `${output.join("\n")}${trailingNewline ? "\n" : ""}`,
  };
}

