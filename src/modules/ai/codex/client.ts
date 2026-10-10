import { Channel, invoke } from "@tauri-apps/api/core";

export type CodexEvent = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

export type CodexStatus = {
  installed: boolean;
  compatible: boolean;
  running: boolean;
  version: string | null;
  error: string | null;
};

type Listener = (event: CodexEvent) => void;

const listeners = new Set<Listener>();
let subscription: Promise<void> | null = null;

export function codexStatus(): Promise<CodexStatus> {
  return invoke<CodexStatus>("codex_status");
}

export function codexRequest<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invoke<T>("codex_request", { method, params });
}

export function codexRespond(
  id: string | number,
  result: Record<string, unknown>,
): Promise<void> {
  return invoke<void>("codex_respond", { id, result });
}

export async function ensureCodexSubscription(): Promise<void> {
  if (subscription) return subscription;
  const channel = new Channel<CodexEvent>();
  channel.onmessage = (event) => {
    for (const listener of listeners) listener(event);
  };
  subscription = invoke<void>("codex_subscribe", { onEvent: channel }).catch(
    (error) => {
      subscription = null;
      throw error;
    },
  );
  return subscription;
}

export function onCodexEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
