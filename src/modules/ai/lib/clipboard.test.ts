import { describe, expect, it, vi } from "vitest";
import { clipboardImageFiles } from "./clipboard";

function file(type: string, name: string): File {
  return { type, name } as File;
}

function clipboardData({
  files = [],
  items = [],
}: {
  files?: File[];
  items?: Array<{ kind: string; type: string; file: File | null }>;
}) {
  return {
    files,
    items: items.map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: vi.fn(() => item.file),
    })),
  } as unknown as Pick<DataTransfer, "files" | "items">;
}

describe("clipboardImageFiles", () => {
  it("extracts image file items without treating clipboard text as a file", () => {
    const image = file("image/png", "image.png");
    const data = clipboardData({
      items: [
        { kind: "string", type: "text/plain", file: null },
        { kind: "file", type: "image/png", file: image },
      ],
    });

    expect(clipboardImageFiles(data)).toEqual([image]);
  });

  it("falls back to the clipboard file list when items are unavailable", () => {
    const image = file("image/jpeg", "photo.jpg");
    const text = file("text/plain", "notes.txt");

    expect(
      clipboardImageFiles(clipboardData({ files: [image, text] })),
    ).toEqual([image]);
  });

  it("returns no files for a text-only paste", () => {
    const data = clipboardData({
      items: [{ kind: "string", type: "text/plain", file: null }],
    });

    expect(clipboardImageFiles(data)).toEqual([]);
  });
});
