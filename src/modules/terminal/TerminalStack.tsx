import type { Tab } from "@/modules/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { leafIds } from "./lib/panes";
import { resumeAllSlots, suspendAllSlots } from "./lib/rendererPool";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
}: Props) {
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  useEffect(() => {
    const live = new Set<number>();
    for (const t of terminals) for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  // Suspend xterm's WebGL renderer while the window is backgrounded so WebKit
  // stops the per-frame canvas-flush + sync IPC to the GPU XPC that otherwise
  // burns ~9% CPU at idle. Grace period absorbs brief focus blips.
  useEffect(() => {
    const SUSPEND_DELAY_MS = 2000;
    let suspendTimer: ReturnType<typeof setTimeout> | null = null;
    let resumeRaf: number | null = null;
    let unlistenFocus: (() => void) | undefined;
    let alive = true;

    const activate = () => {
      if (suspendTimer !== null) {
        clearTimeout(suspendTimer);
        suspendTimer = null;
      }
      if (resumeRaf !== null) return;
      resumeRaf = requestAnimationFrame(() => {
        resumeRaf = null;
        resumeAllSlots();
      });
    };

    const deactivate = () => {
      if (resumeRaf !== null) {
        cancelAnimationFrame(resumeRaf);
        resumeRaf = null;
      }
      if (suspendTimer !== null) return;
      suspendTimer = setTimeout(() => {
        suspendTimer = null;
        suspendAllSlots();
      }, SUSPEND_DELAY_MS);
    };

    const evaluate = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        activate();
      } else {
        deactivate();
      }
    };

    document.addEventListener("visibilitychange", evaluate);

    getCurrentWindow()
      .onFocusChanged(evaluate)
      .then((u) => {
        if (alive) unlistenFocus = u;
        else u();
      })
      .catch(() => {});

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", evaluate);
      unlistenFocus?.();
      if (suspendTimer !== null) clearTimeout(suspendTimer);
      if (resumeRaf !== null) cancelAnimationFrame(resumeRaf);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
            }}
            aria-hidden={!tabVisible}
          >
            <PaneTreeView
              node={t.paneTree}
              tabVisible={tabVisible}
              activeLeafId={t.activeLeafId}
              onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
              getBundle={getBundle}
            />
          </div>
        );
      })}
    </div>
  );
}
