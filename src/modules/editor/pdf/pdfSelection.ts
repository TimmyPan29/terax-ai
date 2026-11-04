export function clearPdfSelectionOnBlankPointer(
  event: PointerEvent,
  container: HTMLElement,
): void {
  if (
    event.button !== 0 ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !(event.target instanceof Element) ||
    !container.contains(event.target)
  )
    return;

  if (
    event.target.closest(
      'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], .textLayer span, .textLayer br',
    )
  )
    return;

  const selection = container.ownerDocument.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    (!container.contains(selection.anchorNode) &&
      !container.contains(selection.focusNode))
  )
    return;
  selection.removeAllRanges();
}
