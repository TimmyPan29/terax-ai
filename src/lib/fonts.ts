const NERD_FONT_CANDIDATES = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

// CJK system fonts appended so the WebGL atlas resolves wide-char glyphs in a
// deterministic order instead of per-glyph dynamic fallback — the latter
// produced cell-overflow ghosting because cell metrics were already locked to
// the Latin face by the time CJK codepoints arrived.
const CJK_CHAIN =
  '"PingFang SC", "PingFang TC", "Hiragino Sans GB", "Hiragino Sans", ' +
  '"Apple SD Gothic Neo", "Microsoft YaHei", "Noto Sans CJK SC", ' +
  '"Noto Sans CJK TC", "Noto Sans CJK JP", "Noto Sans CJK KR"';
const FALLBACK_CHAIN = `"JetBrains Mono", SFMono-Regular, Menlo, ${CJK_CHAIN}, monospace`;

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  // Prime the browser's font lookup for both Latin and CJK with a representative
  // codepoint so the atlas doesn't measure mid-render and produce stale tiles.
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrains Mono"'),
    document.fonts.load('700 14px "JetBrains Mono"'),
    document.fonts.load('400 14px "PingFang SC"', "中"),
    document.fonts.load('400 14px "Hiragino Sans GB"', "中"),
    document.fonts.load('400 14px "Microsoft YaHei"', "中"),
    document.fonts.load('400 14px "Noto Sans CJK SC"', "中"),
  ]).then(() => undefined);
  return monoReady;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return detectMonoFontFamily();
  // A comma means the user gave a full stack; otherwise quote the single family.
  // Strip any quotes first so a stray quote can't produce a malformed token.
  const head = name.includes(",")
    ? name
    : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${FALLBACK_CHAIN}`;
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined" || !document.fonts) {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`12px "${f}"`)) {
        detected = `"${f}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    } catch {
      // Some browsers throw on invalid font shorthand; ignore.
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}
