import { cn } from "@/lib/utils";

export type MarkdownViewMode = "rendered" | "raw" | "split";

type Props = {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
  className?: string;
};

export function MarkdownViewToggle({ mode, onChange, className }: Props) {
  return (
    <fieldset
      className={cn(
        "absolute right-3 top-3 z-10 inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-card/85 p-0.5 text-[11px] shadow-sm backdrop-blur",
        className,
      )}
      aria-label="Markdown view"
    >
      <button
        type="button"
        onClick={() => onChange("rendered")}
        aria-pressed={mode === "rendered"}
        className={cn(
          "rounded px-2 py-0.5 transition-colors",
          mode === "rendered"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Rendered
      </button>
      <button
        type="button"
        onClick={() => onChange("raw")}
        aria-pressed={mode === "raw"}
        className={cn(
          "rounded px-2 py-0.5 transition-colors",
          mode === "raw"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Raw
      </button>
      <button
        type="button"
        onClick={() => onChange("split")}
        aria-pressed={mode === "split"}
        className={cn(
          "rounded px-2 py-0.5 transition-colors",
          mode === "split"
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Split
      </button>
    </fieldset>
  );
}
