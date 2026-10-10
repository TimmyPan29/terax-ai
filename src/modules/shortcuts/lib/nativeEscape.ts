export type NativeEscapeEvent = {
  kind: "keydown" | "keyup";
  repeat: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

export function dispatchNativeEscape(
  payload: NativeEscapeEvent,
  targetDocument: Pick<Document, "activeElement" | "dispatchEvent"> = document,
): void {
  const event = new KeyboardEvent(payload.kind, {
    key: "Escape",
    code: "Escape",
    repeat: payload.repeat,
    shiftKey: payload.shiftKey,
    ctrlKey: payload.ctrlKey,
    altKey: payload.altKey,
    metaKey: payload.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  (targetDocument.activeElement ?? targetDocument).dispatchEvent(event);
}
