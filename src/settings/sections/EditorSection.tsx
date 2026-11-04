import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  FORMATTER_LABELS,
  FORMATTERS,
} from "@/modules/editor/lib/externalFormat";
import { EXPOSED_LANGUAGES } from "@/modules/editor/lib/languageDefinitions";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  AUTO_SAVE_DELAY_MAX,
  AUTO_SAVE_DELAY_MIN,
  clampAutoSaveDelay,
  clampEditorWordWrapColumn,
  clampPdfPreviewHeight,
  clampPdfPreviewWidth,
  EDITOR_FONT_SIZES,
  EDITOR_WORD_WRAP_COLUMN_MAX,
  EDITOR_WORD_WRAP_COLUMN_MIN,
  type EditorFormatter,
  PDF_PREVIEW_HEIGHT_MAX,
  PDF_PREVIEW_HEIGHT_MIN,
  PDF_PREVIEW_SIZE_PRESETS,
  PDF_PREVIEW_WIDTH_MAX,
  PDF_PREVIEW_WIDTH_MIN,
  setEditorAutoSave,
  setEditorAutoSaveDelay,
  setEditorCustomFormatCommand,
  setEditorFontSize,
  setEditorFormatOnSave,
  setEditorFormatter,
  setEditorFormatterByLang,
  setEditorWordWrap,
  setEditorWordWrapColumn,
  setPdfPreviewHeight,
  setPdfPreviewSize,
  setPdfPreviewWidth,
  setVimMode,
} from "@/modules/settings/store";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { LspServersGroup } from "../components/LspServersGroup";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

const AUTO_SAVE_STEP = 100;

export function EditorSection() {
  const editorFontSize = usePreferencesStore((s) => s.editorFontSize);
  const vimMode = usePreferencesStore((s) => s.vimMode);
  const editorWordWrap = usePreferencesStore((s) => s.editorWordWrap);
  const editorWordWrapColumn = usePreferencesStore(
    (s) => s.editorWordWrapColumn,
  );
  const editorAutoSave = usePreferencesStore((s) => s.editorAutoSave);
  const editorAutoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);
  const editorFormatOnSave = usePreferencesStore((s) => s.editorFormatOnSave);
  const editorFormatter = usePreferencesStore((s) => s.editorFormatter);
  const editorFormatterByLang = usePreferencesStore(
    (s) => s.editorFormatterByLang,
  );
  const pdfPreviewWidth = usePreferencesStore((s) => s.pdfPreviewWidth);
  const pdfPreviewHeight = usePreferencesStore((s) => s.pdfPreviewHeight);
  const usesCustom =
    editorFormatter === "custom" ||
    Object.values(editorFormatterByLang).includes("custom");

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Editor"
        description="Editing behavior, saving, and language servers."
      />

      <div className="flex flex-col gap-2">
        <Label>Appearance</Label>
        <SettingRow title="Font size" description="Code editor text size.">
          <Select
            value={String(editorFontSize)}
            onValueChange={(v) => void setEditorFontSize(Number(v))}
          >
            <SelectTrigger size="sm" className="h-8 w-28 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_FONT_SIZES.map((size) => (
                <SelectItem
                  key={size}
                  value={String(size)}
                  className="text-[12px]"
                >
                  {size} px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editing</Label>
        <SettingRow
          title="Vim mode"
          description="Enable Vim keybindings in the code editor."
        >
          <Switch
            checked={vimMode}
            onCheckedChange={(v) => void setVimMode(v)}
          />
        </SettingRow>
        <SettingRow
          title="Word wrap"
          description="Wrap long lines instead of scrolling horizontally."
        >
          <Switch
            checked={editorWordWrap}
            onCheckedChange={(v) => void setEditorWordWrap(v)}
          />
        </SettingRow>
        {editorWordWrap && (
          <WordWrapColumnInput
            value={editorWordWrapColumn}
            onChange={(v) => void setEditorWordWrapColumn(v)}
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Saving</Label>
        <SettingRow
          title="Auto save"
          description="Automatically save files after a delay when changes are detected."
        >
          <Switch
            checked={editorAutoSave}
            onCheckedChange={(v) => void setEditorAutoSave(v)}
          />
        </SettingRow>
        {editorAutoSave && (
          <AutoSaveDelayInput
            value={editorAutoSaveDelay}
            onChange={(v) => void setEditorAutoSaveDelay(v)}
          />
        )}
        <SettingRow
          title="Format on save"
          description="Format the file on explicit save (Cmd+S / :w) with the formatter below."
        >
          <Switch
            checked={editorFormatOnSave}
            onCheckedChange={(v) => void setEditorFormatOnSave(v)}
          />
        </SettingRow>
        {editorFormatOnSave && (
          <>
            <SettingRow
              title="Formatter"
              description="Language server formats the buffer before writing; external tools run on the saved file from your PATH."
            >
              <FormatterSelect
                value={editorFormatter}
                onChange={(v) => void setEditorFormatter(v)}
              />
            </SettingRow>
            {usesCustom && <CustomFormatCommandInput />}
            <FormatterOverrides />
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>PDF Preview</Label>
        <PdfPreviewSizeControls
          width={pdfPreviewWidth}
          height={pdfPreviewHeight}
          onChangeSize={(w, h) => void setPdfPreviewSize(w, h)}
          onChangeWidth={(w) => void setPdfPreviewWidth(w)}
          onChangeHeight={(h) => void setPdfPreviewHeight(h)}
        />
      </div>

      <LspServersGroup />
    </div>
  );
}

const FORMATTER_OPTIONS: EditorFormatter[] = [
  "lsp",
  ...(Object.keys(FORMATTERS) as EditorFormatter[]),
  "custom",
];

function FormatterSelect({
  value,
  onChange,
}: {
  value: EditorFormatter;
  onChange: (v: EditorFormatter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EditorFormatter)}>
      <SelectTrigger className="h-8 w-40 text-[12px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FORMATTER_OPTIONS.map((id) => (
          <SelectItem key={id} value={id}>
            {FORMATTER_LABELS[id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CustomFormatCommandInput() {
  const stored = usePreferencesStore((s) => s.editorCustomFormatCommand);
  const [draft, setDraft] = useState(stored);

  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  return (
    <SettingRow
      title="Custom command"
      description="Runs on the saved file; {file} is replaced with the quoted path (appended when omitted)."
    >
      <Input
        value={draft}
        placeholder="mytool --fix {file}"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== stored) void setEditorCustomFormatCommand(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 w-64 font-mono text-[12px] md:text-[12px]"
      />
    </SettingRow>
  );
}

function FormatterOverrides() {
  const byLang = usePreferencesStore((s) => s.editorFormatterByLang);
  const entries = Object.entries(byLang);
  const unused = EXPOSED_LANGUAGES.filter((l) => !(l.ext in byLang));

  const update = (next: Record<string, EditorFormatter>) =>
    void setEditorFormatterByLang(next);

  return (
    <>
      <SettingRow
        title="Language overrides"
        description="Use a different formatter for specific languages (e.g. Ruff for Python)."
      >
        <button
          type="button"
          disabled={unused.length === 0}
          className="h-8 rounded-md border border-border px-3 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          onClick={() => {
            const first = unused[0];
            if (first) update({ ...byLang, [first.ext]: "lsp" });
          }}
        >
          Add override
        </button>
      </SettingRow>
      {entries.map(([lang, formatter]) => (
        <div
          key={lang}
          className="flex items-center justify-end gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5"
        >
          <Select
            value={lang}
            onValueChange={(nextLang) => {
              if (nextLang === lang) return;
              const next = { ...byLang };
              delete next[lang];
              next[nextLang] = formatter;
              update(next);
            }}
          >
            <SelectTrigger className="h-7 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPOSED_LANGUAGES.filter(
                (l) => l.ext === lang || !(l.ext in byLang),
              ).map((l) => (
                <SelectItem key={l.ext} value={l.ext}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormatterSelect
            value={formatter}
            onChange={(v) => update({ ...byLang, [lang]: v })}
          />
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Remove override"
            onClick={() => {
              const next = { ...byLang };
              delete next[lang];
              update(next);
            }}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}

function AutoSaveDelayInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampAutoSaveDelay(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title="Auto save delay"
      description="Delay before unsaved changes are saved automatically."
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={AUTO_SAVE_DELAY_MIN}
          max={AUTO_SAVE_DELAY_MAX}
          step={AUTO_SAVE_STEP}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">ms</span>
      </div>
    </SettingRow>
  );
}

function WordWrapColumnInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampEditorWordWrapColumn(n);
    setDraft(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  return (
    <SettingRow
      title="Wrap column"
      description="Soft-wrap at this column, or earlier when the editor is narrower."
    >
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={EDITOR_WORD_WRAP_COLUMN_MIN}
          max={EDITOR_WORD_WRAP_COLUMN_MAX}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[11px] text-muted-foreground">columns</span>
      </div>
    </SettingRow>
  );
}

function PdfPreviewSizeControls({
  width,
  height,
  onChangeSize,
  onChangeWidth,
  onChangeHeight,
}: {
  width: number;
  height: number;
  onChangeSize: (width: number, height: number) => void;
  onChangeWidth: (width: number) => void;
  onChangeHeight: (height: number) => void;
}) {
  const [widthDraft, setWidthDraft] = useState(String(width));
  const [heightDraft, setHeightDraft] = useState(String(height));

  useEffect(() => {
    setWidthDraft(String(width));
  }, [width]);

  useEffect(() => {
    setHeightDraft(String(height));
  }, [height]);

  const activePreset =
    PDF_PREVIEW_SIZE_PRESETS.find(
      (preset) => preset.width === width && preset.height === height,
    )?.id ?? "custom";

  const commitWidth = () => {
    const n = Number(widthDraft);
    if (!Number.isFinite(n)) {
      setWidthDraft(String(width));
      return;
    }
    const clamped = clampPdfPreviewWidth(n);
    setWidthDraft(String(clamped));
    if (clamped !== width) onChangeWidth(clamped);
  };

  const commitHeight = () => {
    const n = Number(heightDraft);
    if (!Number.isFinite(n)) {
      setHeightDraft(String(height));
      return;
    }
    const clamped = clampPdfPreviewHeight(n);
    setHeightDraft(String(clamped));
    if (clamped !== height) onChangeHeight(clamped);
  };

  return (
    <>
      <SettingRow
        title="Reference preview size"
        description="Floating popup window size when Cmd/Ctrl + Right-clicking a PDF link or equation reference."
      >
        <Select
          value={activePreset}
          onValueChange={(value) => {
            const preset = PDF_PREVIEW_SIZE_PRESETS.find((p) => p.id === value);
            if (preset) onChangeSize(preset.width, preset.height);
          }}
        >
          <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PDF_PREVIEW_SIZE_PRESETS.map((preset) => (
              <SelectItem
                key={preset.id}
                value={preset.id}
                className="text-[12px]"
              >
                {preset.label}
              </SelectItem>
            ))}
            {activePreset === "custom" && (
              <SelectItem value="custom" className="text-[12px]">
                Custom ({width} × {height})
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        title="Preview dimensions"
        description={`Custom width (${PDF_PREVIEW_WIDTH_MIN}–${PDF_PREVIEW_WIDTH_MAX} px) and height (${PDF_PREVIEW_HEIGHT_MIN}–${PDF_PREVIEW_HEIGHT_MAX} px).`}
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            aria-label="PDF preview width"
            min={PDF_PREVIEW_WIDTH_MIN}
            max={PDF_PREVIEW_WIDTH_MAX}
            step={20}
            value={widthDraft}
            onChange={(e) => setWidthDraft(e.target.value)}
            onBlur={commitWidth}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[11px] text-muted-foreground">×</span>
          <Input
            type="number"
            aria-label="PDF preview height"
            min={PDF_PREVIEW_HEIGHT_MIN}
            max={PDF_PREVIEW_HEIGHT_MAX}
            step={20}
            value={heightDraft}
            onChange={(e) => setHeightDraft(e.target.value)}
            onBlur={commitHeight}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-8 w-20 rounded-md border border-border bg-background px-2.5 text-right text-[12px] md:text-[12px] tabular-nums outline-none focus:border-foreground/40 focus-visible:ring-0 focus-visible:border-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[11px] text-muted-foreground">px</span>
        </div>
      </SettingRow>
    </>
  );
}
