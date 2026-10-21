import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SvgEditorLayout } from "@/modules/editor/SvgEditorLayout";

const hooks = vi.hoisted(() => ({
  source: false,
  effects: [] as Array<() => () => void>,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [
    typeof initial === "boolean" ? hooks.source : initial,
    vi.fn(),
  ],
  useEffect: (effect: () => () => void) => hooks.effects.push(effect),
}));

function render(visible = true) {
  return renderToStaticMarkup(
    <SvgEditorLayout
      content={
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      }
      path={"C:\\images\\diagram.svg"}
      visible={visible}
    >
      <textarea defaultValue="source buffer" />
    </SvgEditorLayout>,
  );
}

describe("SVG editor preview", () => {
  it("uses an isolated image blob and releases its URL on cleanup", async () => {
    hooks.source = false;
    hooks.effects = [];
    const markup = render();
    expect(markup).toContain('aria-label="SVG view"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("source buffer");
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:svg-preview");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const cleanup = hooks.effects[0]();
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toContain("<svg");
    cleanup();
    expect(revoke).toHaveBeenCalledWith("blob:svg-preview");
    vi.restoreAllMocks();
  });

  it("does no preview resource work for hidden tabs or Source mode", () => {
    hooks.source = false;
    hooks.effects = [];
    render(false);
    expect(hooks.effects).toHaveLength(0);
    hooks.source = true;
    expect(render()).toContain("source buffer");
    expect(hooks.effects).toHaveLength(0);
  });

  it("routes ready text SVG documents to the preview and tracks unsaved source edits", () => {
    const pane = readFileSync(
      new URL("./EditorPane.tsx", import.meta.url),
      "utf8",
    );
    expect(pane.indexOf("<SvgEditorLayout")).toBeGreaterThan(
      pane.indexOf('doc.status === "binary"'),
    );
    expect(pane).toContain('path.toLowerCase().endsWith(".svg")');
    expect(pane).toContain("if (hasLivePreview)");
    expect(pane).toContain("previewBuffer?.document === doc");
  });
});
