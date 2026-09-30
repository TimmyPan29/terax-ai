import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import {
  rgbToCss,
  type TerminalFontMetrics,
  type TerminalGpuTheme,
} from "@/modules/terminal/ghostty/gpu/terminalVisuals";

type Options = {
  readonly input: HTMLTextAreaElement;
  readonly model: GhosttyTerminalModelApi;
  readonly metrics: () => TerminalFontMetrics;
  readonly theme: () => TerminalGpuTheme;
};

export class TerminalCompositionView {
  private active = false;
  private presentation = "";
  private originalStyle = "";

  constructor(private readonly options: Options) {
    const { input } = options;
    input.setAttribute("wrap", "off");
    input.addEventListener("compositionstart", this.start);
    input.addEventListener("compositionend", this.end);
    input.addEventListener("blur", this.end);
  }

  sync(): void {
    if (!this.active) return;
    const { input, model } = this.options;
    const metrics = this.options.metrics();
    const theme = this.options.theme();
    const cursor = model.cursor();
    const { offset } = model.scrollPosition();
    const width = model.cols * metrics.cellWidth;
    const left = Math.max(
      0,
      Math.min(cursor.x * metrics.cellWidth, width - 2 * metrics.cellWidth),
    );
    const top = Math.max(
      0,
      Math.min(cursor.y + offset, model.rows - 1) * metrics.cellHeight,
    );
    const style = [
      "position:absolute",
      `left:${left}px`,
      `top:${top}px`,
      `width:${Math.max(metrics.cellWidth, width - left)}px`,
      `height:${metrics.cellHeight}px`,
      "opacity:1",
      "resize:none",
      "pointer-events:none",
      "z-index:15",
      "border:0",
      "padding:0",
      "margin:0",
      "outline:none",
      "border-radius:0",
      "overflow:hidden",
      "box-sizing:border-box",
      `font-family:${metrics.font.family}`,
      `font-size:${metrics.font.size}px`,
      `font-weight:${metrics.font.weight}`,
      `letter-spacing:${metrics.font.letterSpacing}px`,
      `line-height:${metrics.cellHeight}px`,
      `color:${rgbToCss(theme.foreground)}`,
      `background-color:${rgbToCss(theme.background)}`,
      "text-decoration:underline",
    ].join(";");
    if (style === this.presentation) return;
    this.presentation = style;
    input.style.cssText = style;
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.options.input.style.cssText = this.originalStyle;
    this.presentation = "";
  }

  dispose(): void {
    this.hide();
    const { input } = this.options;
    input.removeEventListener("compositionstart", this.start);
    input.removeEventListener("compositionend", this.end);
    input.removeEventListener("blur", this.end);
  }

  private readonly start = (): void => {
    if (!this.active) {
      this.originalStyle = this.options.input.style.cssText;
      this.active = true;
    }
    this.sync();
  };

  private readonly end = (): void => {
    this.hide();
  };
}
