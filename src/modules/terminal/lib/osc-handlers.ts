import type { IMarker, Terminal } from "@xterm/xterm";

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell — which fires between commands — should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
): PromptTracker {
  let marker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    // OSC 133 A — start of new prompt (between commands).
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      // OSC 133 B — command begins. From here on, treat all output as
      // untrusted until we see D (command exit) or the next A (new prompt).
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      // OSC 133 C — command pre-execution marker; still inside command.
      if (state) state.inCommand = true;
    } else if (data.startsWith("D")) {
      // OSC 133 D — command ends.
      if (state) state.inCommand = false;
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

// ---------------------------------------------------------------------------
// OSC 52 — clipboard write
// ---------------------------------------------------------------------------

/** Maximum decoded payload size (bytes) we accept from a single OSC 52. */
const MAX_OSC52_BYTES = 100 * 1024; // 100 KiB

/**
 * Registers an OSC 52 handler that writes base64-encoded text to the system
 * clipboard.
 *
 * Sequence format: `OSC 52 ; Pc ; Pd ST`
 *  - Pc: clipboard selection (`c` = clipboard, `s` = primary, etc.)
 *  - Pd: base64-encoded UTF-8 text, or `?` to request the current contents.
 *
 * Read requests (`?`) are silently ignored — exposing clipboard contents to a
 * remote process is a security risk. Write payloads larger than
 * {@link MAX_OSC52_BYTES} are dropped to prevent memory-bomb abuse.
 */
export function registerClipboardHandler(term: Terminal): () => void {
  const d = term.parser.registerOscHandler(52, (data) => {
    const idx = data.indexOf(";");
    if (idx === -1) return true;

    const pd = data.slice(idx + 1);

    // Ignore clipboard-read queries.
    if (pd === "?" || pd === "") return true;

    try {
      const raw = atob(pd);
      if (raw.length > MAX_OSC52_BYTES) return true;

      // Decode the raw binary string as UTF-8.
      const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);

      void navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // Invalid base64 — silently drop.
    }

    return true;
  });

  return () => d.dispose();
}

// ---------------------------------------------------------------------------
// OSC 7 — cwd
// ---------------------------------------------------------------------------

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}
