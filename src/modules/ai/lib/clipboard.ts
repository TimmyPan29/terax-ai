type ClipboardData = Pick<DataTransfer, "files" | "items">;

export function clipboardImageFiles(data: ClipboardData): File[] {
  const itemImages = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (itemImages.length > 0) return itemImages;

  return Array.from(data.files).filter((file) =>
    file.type.startsWith("image/"),
  );
}
