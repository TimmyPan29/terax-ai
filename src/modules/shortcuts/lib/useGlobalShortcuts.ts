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
        e.key.toLowerCase() === "w"
      )
        return;
      onKey(e);
    };
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (IS_MAC) {
      void getCurrentWindow()
        .listen("terax:close-pane", () => {
          if (!disposed) {
            onKey(
              new KeyboardEvent("keydown", {
                key: "w",
                code: "KeyW",
                metaKey: true,
              }),
            );
          }
        })
        .then((off) => {
          if (disposed) off();
          else unlisten = off;
        })
        .catch((error: unknown) => {
          console.error("Could not listen for native pane close", error);
        });
    }
    window.addEventListener("keydown", onDomKey, { capture: true });
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", onDomKey, { capture: true });
    };
  }, [userShortcuts]);
}
