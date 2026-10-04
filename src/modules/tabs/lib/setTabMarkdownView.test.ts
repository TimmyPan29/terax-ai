import { describe, expect, it } from "vitest";
import {
  type EditorTab,
  type MarkdownTab,
  setTabMarkdownView,
  type Tab,
} from "./useTabs";

const editor: EditorTab = {
  id: 1,
  kind: "editor",
  spaceId: "one",
  title: "article.md",
  path: "/repo/article.md",
  dirty: true,
  preview: false,
  overrideLanguage: "markdown",
};

describe("setTabMarkdownView", () => {
  it("keeps dirty editors mounted across all view transitions", () => {
    let tab: Tab = editor;
    for (const mode of ["split", "rendered", "raw", "split"] as const) {
      tab = setTabMarkdownView(tab, mode);
      expect(tab).toEqual({ ...editor, markdownView: mode });
    }
  });

  it("converts a read-only preview to an editor with the same identity", () => {
    const tab: MarkdownTab = {
      id: 2,
      kind: "markdown",
      spaceId: "two",
      cold: false,
      title: "article.md",
      path: "C:\\repo\\article.md",
    };
    for (const mode of ["raw", "split"] as const) {
      expect(setTabMarkdownView(tab, mode)).toEqual({
        ...tab,
        kind: "editor",
        dirty: false,
        preview: false,
        markdownView: mode,
      });
    }
    expect(setTabMarkdownView(tab, "rendered")).toBe(tab);
  });

  it("leaves non-Markdown files and unrelated tab kinds unchanged", () => {
    const source = { ...editor, path: "/repo/main.ts" };
    const preview = {
      id: 3,
      kind: "preview",
      spaceId: "one",
      title: "Web",
      url: "https://example.com",
    } as const;
    expect(setTabMarkdownView(source, "split")).toBe(source);
    expect(setTabMarkdownView(preview, "split")).toBe(preview);
  });

  it("does not replace a tab when its selected view is unchanged", () => {
    const tab = { ...editor, markdownView: "split" } as const;
    expect(setTabMarkdownView(tab, "split")).toBe(tab);
  });
});
