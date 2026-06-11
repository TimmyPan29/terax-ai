/**
 * GitHub Copilot OAuth — Device-Flow Authentication
 *
 * The `gh auth token` produces a `gho_` token whose integrator is locked to
 * `copilot-4-cli`.  That integrator doesn't have access to Gemini models.
 *
 * To unlock the full model roster (including gemini-3.1-pro-preview, gemini-3.5-flash,
 * etc.) we perform a GitHub Device Flow using the official Copilot VS-Code
 * Client-ID and then exchange the resulting `ghu_` token for a short-lived
 * Copilot session-token via `/copilot_internal/v2/token`.
 *
 * The session token is cached in-memory with TTL-based refresh.
 */

import { createProxyFetch } from "./proxyFetch";
import { invoke } from "@tauri-apps/api/core";
import { KEYRING_SERVICE } from "../config";
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const SESSION_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

const localProxyFetch = createProxyFetch({ allowPrivateNetwork: true });

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface SessionToken {
  token: string;
  expires_at: number; // epoch seconds
}

let cachedGhuToken: string | null = null;
let cachedSession: SessionToken | null = null;

// Allow the UI to register a callback that shows the user code + verification URI
type AuthPromptCallback = (userCode: string, verificationUri: string) => void;
let onAuthPrompt: AuthPromptCallback | null = null;

export function setOnCopilotAuthPrompt(cb: AuthPromptCallback) {
  onAuthPrompt = cb;
}

// ---------------------------------------------------------------------------
// Step 1: Device Flow — obtain a ghu_ token
// ---------------------------------------------------------------------------

async function deviceFlow(): Promise<string> {
  // Request device code
  const codeRes = await localProxyFetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GitHubCopilotChat/0.30.0" },
    body: `client_id=${COPILOT_CLIENT_ID}&scope=copilot`,
  });
  const codeData: DeviceCodeResponse = await codeRes.json();

  // Notify the UI so the user can authorize
  const { toast } = await import("sonner");
  toast("GitHub Copilot Authentication", {
    description: `Please authorize. Code: ${codeData.user_code}`,
    action: {
      label: "Open Browser",
      onClick: () => {
        // use tauri open
        import("@tauri-apps/plugin-opener").then((m) => m.openUrl(codeData.verification_uri));
      },
    },
    duration: 30000,
  });

  if (onAuthPrompt) {
    onAuthPrompt(codeData.user_code, codeData.verification_uri);
  } else {
    console.warn(
      `[CopilotAuth] Please visit ${codeData.verification_uri} and enter code: ${codeData.user_code}`,
    );
  }

  // Poll for access token
  const interval = (codeData.interval || 5) * 1000;
  const deadline = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    const tokenRes = await localProxyFetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GitHubCopilotChat/0.30.0" },
      body: `client_id=${COPILOT_CLIENT_ID}&device_code=${codeData.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`,
    });
    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      return tokenData.access_token as string;
    }
    if (tokenData.error === "authorization_pending") continue;
    if (tokenData.error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`Device flow failed: ${tokenData.error_description || tokenData.error}`);
  }
  throw new Error("Device flow timed out — user did not authorize in time.");
}

// ---------------------------------------------------------------------------
// Step 2: Exchange ghu_ token for a Copilot session token
// ---------------------------------------------------------------------------

async function exchangeForSessionToken(ghuToken: string): Promise<SessionToken> {
  const res = await localProxyFetch(SESSION_TOKEN_URL, {
    headers: {
      Authorization: `Bearer ${ghuToken}`,
      "Editor-Version": "vscode/1.115.0",
      "Editor-Plugin-Version": "copilot-chat/0.30.0",
      "Copilot-Integration-Id": "vscode-chat",
      "User-Agent": "GitHubCopilotChat/0.30.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Session token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    token: data.token,
    expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + 1800,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid Copilot session token.
 * - On first call, triggers Device Flow (user must authorize in browser).
 * - Caches the ghu_ token permanently (in-memory) for the session.
 * - Caches the session token and refreshes it when it expires.
 */
export async function getCopilotSessionToken(): Promise<string> {
  // If we have a valid cached session token, return it
  if (cachedSession && cachedSession.expires_at > Date.now() / 1000 + 60) {
    return cachedSession.token;
  }

  // Load from keychain if we don't have it in memory
  if (!cachedGhuToken) {
    try {
      const v = await invoke<string | null>("secrets_get", {
        service: KEYRING_SERVICE,
        account: "copilot-ghu-token",
      });
      if (v) cachedGhuToken = v;
    } catch {
      // Ignore missing key
    }
  }

  // If we still don't have a ghu_ token, run the device flow
  if (!cachedGhuToken) {
    cachedGhuToken = await deviceFlow();
    try {
      await invoke("secrets_set", {
        service: KEYRING_SERVICE,
        account: "copilot-ghu-token",
        password: cachedGhuToken,
      });
    } catch {
      // Ignore
    }
  }

  // Exchange for session token
  try {
    cachedSession = await exchangeForSessionToken(cachedGhuToken);
  } catch (e) {
    // If exchange fails, the ghu_ token might be expired; re-run device flow
    cachedGhuToken = await deviceFlow();
    try {
      await invoke("secrets_set", {
        service: KEYRING_SERVICE,
        account: "copilot-ghu-token",
        password: cachedGhuToken,
      });
    } catch {}
    cachedSession = await exchangeForSessionToken(cachedGhuToken);
  }

  return cachedSession.token;
}

/**
 * Returns true if the user has already completed the Copilot Device Flow
 * (i.e. we have a cached ghu_ token or one in the keychain).
 */
export async function isCopilotAuthenticated(): Promise<boolean> {
  if (cachedGhuToken) return true;
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: "copilot-ghu-token",
    });
    return !!v;
  } catch {
    return false;
  }
}

/**
 * Clear all cached tokens (e.g. on logout).
 */
export async function clearCopilotAuth() {
  cachedGhuToken = null;
  cachedSession = null;
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: "copilot-ghu-token",
    });
  } catch {}
}
