import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import {
  checkShellCommand,
  checkWritableCanonical,
} from "../lib/security";
import { useExecutorStore } from "../store/executorStore";
import { resolvePath, type ToolContext } from "./context";
import { buildFsTools } from "./fs";
import { buildSearchTools } from "./search";

/**
 * Tools for the `executor` subagent: read + search (reused, read-only) plus
 * file mutations and shell that WRITE IMMEDIATELY (no plan queue, no SDK
 * approval — generateText ignores needsApproval anyway).
 *
 * Safety model (Phase 2, snapshot-after-the-fact review):
 *  - Every mutating call snapshots the file on first touch this run via
 *    useExecutorStore, so the user can Keep/Revert the whole run afterward.
 *  - Every call still passes the security deny-list (checkWritableCanonical /
 *    checkShellCommand) — that guard is NEVER bypassed.
 *  - Shell commands run without a per-command gate (user chose "全部放行")
 *    but are recorded for the review surface. They cannot be reverted.
 */

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Read current on-disk content + existence, for snapshotting before a write. */
async function snapshotBeforeWrite(abs: string): Promise<void> {
  const store = useExecutorStore.getState();
  // snapshot() is first-touch-only, so re-reading here on later edits is
  // avoided by short-circuiting when we already hold a snapshot for this path.
  if (store.active?.snapshots[abs]) return;
  let before = "";
  let wasNew = false;
  try {
    const r = await native.readFile(abs);
    before = r.kind === "text" ? r.content : "";
  } catch {
    wasNew = true;
  }
  store.snapshot(abs, before, wasNew);
}

type EditOp = { old_string: string; new_string: string; replace_all?: boolean };

function applyEditsToBuffer(
  original: string,
  edits: EditOp[],
): { ok: true; content: string; replacements: number } | { ok: false; error: string } {
  let content = original;
  let total = 0;
  for (const e of edits) {
    if (e.old_string === e.new_string)
      return { ok: false, error: "old_string and new_string are identical" };
    if (e.old_string.length === 0)
      return { ok: false, error: "old_string cannot be empty" };
    if (e.replace_all) {
      let n = 0;
      let i = 0;
      while ((i = content.indexOf(e.old_string, i)) !== -1) {
        n++;
        i += e.old_string.length;
      }
      if (n === 0)
        return {
          ok: false,
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
        };
      content = content.split(e.old_string).join(e.new_string);
      total += n;
    } else {
      const first = content.indexOf(e.old_string);
      if (first === -1)
        return {
          ok: false,
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
        };
      const second = content.indexOf(e.old_string, first + 1);
      if (second !== -1)
        return {
          ok: false,
          error:
            "old_string is not unique. Provide more surrounding context, or set replace_all=true.",
        };
      content =
        content.slice(0, first) +
        e.new_string +
        content.slice(first + e.old_string.length);
      total += 1;
    }
  }
  return { ok: true, content, replacements: total };
}

/** One persistent shell per chat session for executor bash (cwd persists). */
const executorShells = new Map<string, Promise<number>>();
function getExecutorShell(
  sessionKey: string,
  cwd: string | null,
): Promise<number> {
  let p = executorShells.get(sessionKey);
  if (!p) {
    p = native.shellSessionOpen(cwd);
    executorShells.set(sessionKey, p);
  }
  return p;
}

export function buildExecutorTools(ctx: ToolContext) {
  const fs = buildFsTools(ctx); // read_file, list_directory (+ write/create we override)
  const search = buildSearchTools(ctx); // grep, glob

  return {
    // ---- read-only (reuse verbatim) ----
    read_file: fs.read_file,
    list_directory: fs.list_directory,
    grep: search.grep,
    glob: search.glob,

    // ---- mutations: snapshot, then write immediately ----
    write_file: tool({
      description:
        "Create or overwrite a file. Writes immediately. The change is snapshotted so the user can review/revert the whole task afterward. Prefer `edit`/`multi_edit` for in-place changes.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(
          reqPath,
          native.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        await snapshotBeforeWrite(abs);
        try {
          await native.writeFile(abs, content);
          ctx.readCache.set(abs, { size: content.length, hash: djb2(content) });
          return { path: abs, bytesWritten: content.length, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    edit: tool({
      description:
        "Replace an exact string in a file and write immediately. Requires read_file on this path first. `old_string` must be unique unless `replace_all`. Snapshotted for after-the-fact review.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(
          reqPath,
          native.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        const r = await native.readFile(abs);
        if (r.kind !== "text")
          return { error: `cannot edit ${r.kind} file`, path: abs };
        const applied = applyEditsToBuffer(r.content, [
          { old_string, new_string, replace_all },
        ]);
        if (!applied.ok) return { error: applied.error, path: abs };
        await snapshotBeforeWrite(abs);
        try {
          await native.writeFile(abs, applied.content);
          ctx.readCache.set(abs, {
            size: applied.content.length,
            hash: djb2(applied.content),
          });
          return { path: abs, replacements: applied.replacements, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    multi_edit: tool({
      description:
        "Apply several exact-string replacements to a single file atomically, then write immediately. Aborts before writing if any old_string is missing/non-unique. Requires prior read_file. Snapshotted for review.",
      inputSchema: z.object({
        path: z.string(),
        edits: z
          .array(
            z.object({
              old_string: z.string(),
              new_string: z.string(),
              replace_all: z.boolean().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ path, edits }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(
          reqPath,
          native.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        const r = await native.readFile(abs);
        if (r.kind !== "text")
          return { error: `cannot edit ${r.kind} file`, path: abs };
        const applied = applyEditsToBuffer(r.content, edits);
        if (!applied.ok) return { error: applied.error, path: abs };
        await snapshotBeforeWrite(abs);
        try {
          await native.writeFile(abs, applied.content);
          ctx.readCache.set(abs, {
            size: applied.content.length,
            hash: djb2(applied.content),
          });
          return { path: abs, replacements: applied.replacements, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    create_directory: tool({
      description:
        "Create a directory (and missing parents) immediately. Snapshotted so the user can revert (delete) it on review.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const reqPath = resolvePath(path, ctx.getCwd());
        const safety = await checkWritableCanonical(
          reqPath,
          native.canonicalize,
        );
        if (!safety.ok) return { error: safety.reason, path: reqPath };
        const abs = safety.canonical;
        // Treat as a new path for revert (revert => delete the dir).
        await snapshotBeforeWrite(abs);
        try {
          await native.createDir(abs);
          return { path: abs, ok: true };
        } catch (e) {
          return { error: String(e), path: abs };
        }
      },
    }),

    // ---- shell: runs immediately (no gate), recorded, not revertable ----
    bash_run: tool({
      description:
        "Run a foreground shell command in this task's persistent shell (cwd persists across calls). Use for lint/test/build/search. Runs immediately. NEVER invoke interactive tools (vim, less, top) — they hang. Side effects are NOT revertable; the command is recorded for the user's review.",
      inputSchema: z.object({
        command: z.string(),
        timeout_secs: z.number().int().min(1).max(300).optional(),
      }),
      execute: async ({ command, timeout_secs }) => {
        const safety = checkShellCommand(command);
        if (!safety.ok) return { error: safety.reason };
        const sid = ctx.getSessionId();
        if (!sid) return { error: "no active chat session" };
        const cwd = ctx.getCwd();
        try {
          const shellId = await getExecutorShell(`exec:${sid}`, cwd);
          const r = await native.shellSessionRun(
            shellId,
            command,
            cwd,
            timeout_secs,
          );
          useExecutorStore.getState().recordCommand({
            command,
            cwd,
            exitCode: r.exit_code,
          });
          return {
            command,
            stdout: r.stdout,
            stderr: r.stderr,
            exit_code: r.exit_code,
            timed_out: r.timed_out,
            truncated: r.truncated,
            cwd_after: r.cwd_after,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),
  } as const;
}
