import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  Cancel01Icon,
  FileEditIcon,
  FilePlusIcon,
  Tick02Icon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import {
  useExecutorStore,
  type ExecutorRun,
  type FileSnapshot,
} from "../store/executorStore";

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * After-the-fact review for an `executor` subagent run. The executor wrote
 * files directly (snapshotted on first touch); here the user inspects the diff
 * and Keeps or Reverts — the snapshot-mode safety net (the executor runs via
 * generateText, which has no live approval gate). Shell commands are shown
 * read-only: they already ran and cannot be reverted.
 */
export function ExecutorReview() {
  const pending = useExecutorStore((s) => s.pendingReviews);
  if (pending.length === 0) return null;
  // Review the most recent run; older ones queue behind it.
  const run = pending[0];
  return <RunReview key={run.id} run={run} />;
}

function RunReview({ run }: { run: ExecutorRun }) {
  const revertAll = useExecutorStore((s) => s.revertAll);
  const keepAll = useExecutorStore((s) => s.keepAll);
  const [busy, setBusy] = useState(false);

  const snaps = Object.values(run.snapshots);

  const onRevertAll = async () => {
    setBusy(true);
    try {
      const results = await revertAll(run.id);
      const failed = results.filter((r) => !r.ok);
      if (failed.length) console.error("executor revert failures:", failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background/85 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold tracking-tight">
            Executor review
          </span>
          <span className="text-[10.5px] text-muted-foreground">
            {run.label} · {snaps.length} file
            {snaps.length === 1 ? "" : "s"}
            {run.commands.length > 0
              ? ` · ${run.commands.length} command${run.commands.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-[11px] hover:bg-destructive/10 hover:text-destructive"
            onClick={onRevertAll}
            disabled={busy || snaps.length === 0}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
            Revert all
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={() => keepAll(run.id)}
            disabled={busy}
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
            Keep all
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-auto p-3">
        {snaps.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {snaps.map((s) => (
              <SnapshotRow key={s.path} runId={run.id} snap={s} busy={busy} />
            ))}
          </ul>
        ) : null}

        {run.commands.length > 0 ? (
          <div className="mt-1">
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
              <HugeiconsIcon
                icon={TerminalIcon}
                size={11}
                strokeWidth={1.75}
              />
              Commands run (not revertable)
            </div>
            <ul className="flex flex-col gap-0.5">
              {run.commands.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-2 rounded bg-muted/40 px-2 py-1 font-mono text-[10.5px]"
                >
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      c.exitCode === 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : c.exitCode == null
                          ? "text-muted-foreground"
                          : "text-destructive",
                    )}
                  >
                    {c.exitCode == null ? "·" : c.exitCode}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {c.command}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SnapshotRow({
  runId,
  snap,
  busy,
}: {
  runId: string;
  snap: FileSnapshot;
  busy: boolean;
}) {
  const revertOne = useExecutorStore((s) => s.revertOne);
  const keepOne = useExecutorStore((s) => s.keepOne);
  const [open, setOpen] = useState(false);
  const [proposed, setProposed] = useState<string | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const Icon = snap.wasNew ? FilePlusIcon : FileEditIcon;

  // Lazy-load the current on-disk content (the "after") only when expanded —
  // the store holds the "before" snapshot; the after is whatever is on disk now.
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && proposed === null) {
      const { native } = await import("../lib/native");
      try {
        const r = await native.readFile(snap.path);
        setProposed(r.kind === "text" ? r.content : "(binary)");
      } catch {
        setProposed("(deleted or unreadable)");
      }
    }
  };

  return (
    <li className="group/row overflow-hidden rounded-md border border-border/50 bg-card">
      <div className="flex items-start gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "mt-0.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-label="Toggle diff"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={11} strokeWidth={1.75} />
        </button>
        <HugeiconsIcon
          icon={Icon}
          size={13}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 font-mono text-[11.5px]">
            <span className="truncate text-foreground">
              {basename(snap.path)}
            </span>
            {snap.wasNew ? (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                new
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {snap.path}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-5 hover:bg-destructive/10 hover:text-destructive"
            onClick={async () => {
              setLocalBusy(true);
              try {
                await revertOne(runId, snap.path);
              } finally {
                setLocalBusy(false);
              }
            }}
            disabled={busy || localBusy}
            aria-label="Revert this file"
            title="Revert"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-5"
            onClick={() => keepOne(runId, snap.path)}
            disabled={busy || localBusy}
            aria-label="Keep this file"
            title="Keep"
          >
            <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {open ? (
        <div className="border-t border-border/40 bg-muted/20 px-2.5 py-2">
          {proposed === null ? (
            <div className="text-[11px] italic text-muted-foreground">
              loading…
            </div>
          ) : (
            <UnifiedDiffPreview original={snap.before} proposed={proposed} />
          )}
        </div>
      ) : null}
    </li>
  );
}

function UnifiedDiffPreview({
  original,
  proposed,
}: {
  original: string;
  proposed: string;
}) {
  const a = original.split("\n");
  const b = proposed.split("\n");
  const setA = new Set(a);
  const setB = new Set(b);

  const lines: Array<{ kind: "add" | "del"; text: string }> = [];
  for (const l of a) if (!setB.has(l)) lines.push({ kind: "del", text: l });
  for (const l of b) if (!setA.has(l)) lines.push({ kind: "add", text: l });

  if (lines.length === 0) {
    return (
      <div className="text-[11px] italic text-muted-foreground">
        no line-level changes
      </div>
    );
  }

  const MAX = 80;
  const shown = lines.slice(0, MAX);
  const rest = lines.length - shown.length;

  return (
    <div className="overflow-hidden rounded border border-border/40 font-mono text-[11px] leading-relaxed">
      <div className="max-h-72 overflow-auto">
        {shown.map((l, i) => (
          <div
            key={i}
            className={cn(
              "flex whitespace-pre",
              l.kind === "add"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive",
            )}
          >
            <span className="w-4 shrink-0 select-none px-1 text-center opacity-70">
              {l.kind === "add" ? "+" : "-"}
            </span>
            <span className="min-w-0 flex-1 overflow-x-auto pr-2">
              {l.text || " "}
            </span>
          </div>
        ))}
        {rest > 0 ? (
          <div className="px-2 py-1 text-[10px] italic text-muted-foreground">
            … {rest} more changes
          </div>
        ) : null}
      </div>
    </div>
  );
}
