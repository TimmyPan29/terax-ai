const IME_COMMIT_GRACE_MS = 50;

type ImeKeyboardEvent = Pick<KeyboardEvent, "isComposing" | "key" | "keyCode">;

export function isImeCommitEnter(
  event: ImeKeyboardEvent,
  composing: boolean,
  lastCompositionEnd: number | null,
  now: number,
): boolean {
  if (event.key !== "Enter") return false;
  if (composing || event.isComposing || event.keyCode === 229) return true;
  return (
    lastCompositionEnd !== null &&
    now >= lastCompositionEnd &&
    now - lastCompositionEnd <= IME_COMMIT_GRACE_MS
  );
}
