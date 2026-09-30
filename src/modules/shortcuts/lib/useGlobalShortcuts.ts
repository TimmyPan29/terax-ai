import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { IS_MAC } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  SHORTCUTS,
  matchBinding,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";

export type ShortcutHandler = (e: KeyboardEvent) => void;
export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

export type UseGlobalShortcutsOptions = {
  isDisabled?: (id: ShortcutId, e: KeyboardEvent) => boolean;
};

export function useGlobalShortcuts(
  handlers: ShortcutHandlers,
  options?: UseGlobalShortcutsOptions,
) {
  const latest = useRef({ handlers, options });
  latest.current = { handlers, options };

  // Access the shortcuts from the store
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { handlers, options } = latest.current;
      for (const s of SHORTCUTS) {
        if (e.repeat && !s.allowRepeat) continue;
        const bindings = userShortcuts[s.id] || s.defaultBindings;
        const isMatch = bindings.some((b) => matchBinding(e, b, s.id));
        if (!isMatch) continue;
        if (options?.isDisabled?.(s.id, e)) return;
        const h = handlers[s.id];
        if (!h) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        h(e);
        return;
      }
    };
    const onDomKey = (e: KeyboardEvent) => {
      if (
        IS_MAC &&
        e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        ["w", "t"].includes(e.key.toLowerCase())
      )
        return;
      onKey(e);
    };
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    if (IS_MAC) {
      for (const [event, key, code] of [
        ["terax:close-pane", "w", "KeyW"],
        ["terax:new-terminal", "t", "KeyT"],
      ] as const) {
        void getCurrentWindow()
          .listen(event, () => {
            if (!disposed) {
              onKey(new KeyboardEvent("keydown", { key, code, metaKey: true }));
            }
          })
          .then((off) => {
            if (disposed) off();
            else unlisteners.push(off);
          })
          .catch((error: unknown) => {
            console.error(
              `Could not listen for native shortcut ${event}`,
              error,
            );
          });
      }
    }
    window.addEventListener("keydown", onDomKey, { capture: true });
    return () => {
      disposed = true;
      for (const off of unlisteners) off();
      window.removeEventListener("keydown", onDomKey, { capture: true });
    };
  }, [userShortcuts]);
}
