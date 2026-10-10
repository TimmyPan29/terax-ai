import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { IS_MAC } from "@/lib/platform";
import {
  dispatchNativeEscape,
  type NativeEscapeEvent,
} from "@/modules/shortcuts/lib/nativeEscape";

export function useNativeEscape(): void {
  useEffect(() => {
    if (!IS_MAC) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .listen<NativeEscapeEvent>("terax:fullscreen-escape", ({ payload }) => {
        if (!disposed) dispatchNativeEscape(payload);
      })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error: unknown) => {
        console.error("Could not listen for native fullscreen Escape", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
