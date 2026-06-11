import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import {
  codexRequest,
  codexStatus,
  ensureCodexSubscription,
  onCodexEvent,
  type CodexStatus,
} from "@/modules/ai/codex/client";

export type CodexAccount = {
  type: "chatgpt";
  email: string;
  planType: string;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  inputModalities: string[];
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
};

type State = {
  phase: "idle" | "loading" | "disconnected" | "connected" | "error";
  cli: CodexStatus | null;
  account: CodexAccount | null;
  models: CodexModel[];
  rateLimits: Record<string, unknown> | null;
  loginId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

let eventsInstalled = false;
const CONNECTED_MARKER = "terax.codex-account-connected";

function writeConnectedMarker(connected: boolean) {
  try {
    window.localStorage.setItem(CONNECTED_MARKER, connected ? "1" : "0");
  } catch {
    // The marker is only a startup optimization.
  }
}

function installEvents() {
  if (eventsInstalled) return;
  eventsInstalled = true;
  onCodexEvent((event) => {
    if (event.method === "account/login/completed") {
      const success = event.params?.success === true;
      if (success) {
        void useCodexStore.getState().refresh();
      } else {
        useCodexStore.setState({
          phase: "error",
          loginId: null,
          error: String(event.params?.error ?? "OpenAI login failed"),
        });
      }
    } else if (event.method === "account/updated") {
      void useCodexStore.getState().refresh();
    } else if (event.method === "account/rateLimits/updated") {
      useCodexStore.setState({
        rateLimits:
          (event.params?.rateLimits as Record<string, unknown> | undefined) ??
          null,
      });
    } else if (event.method === "terax/codex/processExited") {
      useCodexStore.setState({
        phase: "error",
        error: "Codex app-server exited. The next request will restart it.",
      });
    }
  });
}

async function loadModels(): Promise<CodexModel[]> {
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const response: {
      data: CodexModel[];
      nextCursor?: string | null;
    } = await codexRequest("model/list", {
      cursor,
      limit: 100,
      includeHidden: false,
    });
    models.push(...response.data);
    cursor = response.nextCursor ?? null;
    if (!cursor) break;
  }
  return models.filter((model) => !model.hidden);
}

export const useCodexStore = create<State>((set) => ({
  phase: "idle",
  cli: null,
  account: null,
  models: [],
  rateLimits: null,
  loginId: null,
  error: null,

  refresh: async () => {
    set({ phase: "loading", error: null });
    const cli = await codexStatus();
    if (!cli.installed) {
      set({
        phase: "error",
        cli,
        account: null,
        models: [],
        error: "Codex CLI is not installed or is not available on PATH.",
      });
      return;
    }
    if (!cli.compatible) {
      set({
        phase: "error",
        cli,
        account: null,
        models: [],
        error: `Codex CLI ${cli.version ?? ""} is too old. Install codex-cli 0.139.0 or newer.`,
      });
      return;
    }
    try {
      installEvents();
      await ensureCodexSubscription();
      const response = await codexRequest<{
        account: CodexAccount | { type: string } | null;
        requiresOpenaiAuth: boolean;
      }>("account/read", { refreshToken: false });
      const account =
        response.account?.type === "chatgpt"
          ? (response.account as CodexAccount)
          : null;
      if (!account) {
        writeConnectedMarker(false);
        set({
          phase: "disconnected",
          cli: { ...cli, running: true },
          account: null,
          models: [],
          rateLimits: null,
          loginId: null,
        });
        return;
      }
      const [models, limits] = await Promise.all([
        loadModels(),
        codexRequest<{ rateLimits?: Record<string, unknown> }>(
          "account/rateLimits/read",
        ).catch(() => ({ rateLimits: undefined })),
      ]);
      set({
        phase: "connected",
        cli: { ...cli, running: true },
        account,
        models,
        rateLimits: limits.rateLimits ?? null,
        loginId: null,
        error: null,
      });
      writeConnectedMarker(true);
    } catch (error) {
      set({
        phase: "error",
        cli,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  login: async () => {
    set({ phase: "loading", error: null });
    try {
      installEvents();
      await ensureCodexSubscription();
      const response = await codexRequest<{
        type: "chatgpt";
        authUrl: string;
        loginId: string;
      }>("account/login/start", {
        type: "chatgpt",
        codexStreamlinedLogin: true,
      });
      set({ loginId: response.loginId, phase: "disconnected" });
      await openUrl(response.authUrl);
    } catch (error) {
      set({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  logout: async () => {
    set({ phase: "loading", error: null });
    try {
      await codexRequest("account/logout");
      set({
        phase: "disconnected",
        account: null,
        models: [],
        rateLimits: null,
        loginId: null,
      });
      writeConnectedMarker(false);
    } catch (error) {
      set({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

export function codexAccountConnected(): boolean {
  return useCodexStore.getState().phase === "connected";
}

export function codexAccountWasConnected(): boolean {
  try {
    return window.localStorage.getItem(CONNECTED_MARKER) === "1";
  } catch {
    return false;
  }
}
