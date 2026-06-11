import { invoke } from "@tauri-apps/api/core";
import {
  getProvider,
  KEYRING_SERVICE,
  PROVIDERS,
  providerSupportsKey,
  type ProviderId,
} from "../config";

export type ProviderKeys = Record<ProviderId, string | null>;

export const EMPTY_PROVIDER_KEYS: ProviderKeys = {
  openai: null,
  "openai-account": null,
  "copilot-account": null,
  anthropic: null,
  google: null,
  "google-account": null,
  xai: null,
  cerebras: null,
  groq: null,
  deepseek: null,
  mistral: null,
  openrouter: null,
  "openai-compatible": null,
  lmstudio: null,
  mlx: null,
  ollama: null,
};

export async function getKey(provider: ProviderId): Promise<string | null> {
  if (!providerSupportsKey(provider)) return null;
  try {
    const v = await invoke<string | null>("secrets_get", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function setKey(provider: ProviderId, key: string): Promise<void> {
  if (!providerSupportsKey(provider)) {
    throw new Error(`${provider} does not use an API key`);
  }
  const trimmed = key.trim();
  if (!trimmed) throw new Error("API key is empty");
  await invoke("secrets_set", {
    service: KEYRING_SERVICE,
    account: getProvider(provider).keyringAccount,
    password: trimmed,
  });
  try {
    localStorage.setItem(`has_key:${provider}`, "true");
  } catch {
    // ignore localStorage storage failures (e.g. private tabs)
  }
}

export async function clearKey(provider: ProviderId): Promise<void> {
  if (!providerSupportsKey(provider)) return;
  try {
    await invoke("secrets_delete", {
      service: KEYRING_SERVICE,
      account: getProvider(provider).keyringAccount,
    });
  } catch {
    // already absent — fine
  }
  try {
    localStorage.setItem(`has_key:${provider}`, "false");
  } catch {
    // ignore
  }
}

export async function getAllKeys(): Promise<ProviderKeys> {
  const out = { ...EMPTY_PROVIDER_KEYS };
  const need = PROVIDERS.filter((p) => providerSupportsKey(p.id));
  const needCheck: typeof need = [];

  for (const p of need) {
    let cached: string | null = null;
    try {
      cached = localStorage.getItem(`has_key:${p.id}`);
    } catch {
      // ignore
    }
    if (cached === "true") {
      out[p.id] = "••••••••";
    } else if (cached === "false") {
      out[p.id] = null;
    } else {
      needCheck.push(p);
    }
  }

  if (needCheck.length > 0) {
    try {
      const results = await invoke<(string | null)[]>("secrets_get_all", {
        service: KEYRING_SERVICE,
        accounts: needCheck.map((p) => p.keyringAccount),
      });
      needCheck.forEach((p, i) => {
        const v = results[i];
        const hasKey = v && v.length > 0;
        try {
          localStorage.setItem(`has_key:${p.id}`, hasKey ? "true" : "false");
        } catch {
          // ignore
        }
        out[p.id] = hasKey ? "••••••••" : null;
      });
    } catch {
      for (const p of needCheck) {
        const v = await getKey(p.id);
        const hasKey = !!v;
        try {
          localStorage.setItem(`has_key:${p.id}`, hasKey ? "true" : "false");
        } catch {
          // ignore
        }
        out[p.id] = hasKey ? "••••••••" : null;
      }
    }
  }

  return out;
}

export function hasAnyKey(keys: ProviderKeys): boolean {
  return PROVIDERS.some((p) => providerSupportsKey(p.id) && !!keys[p.id]);
}
