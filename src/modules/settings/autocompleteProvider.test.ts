import { getProvider, PROVIDERS } from "@/modules/ai/config";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  normalizeAutocompleteProvider,
} from "@/modules/settings/store";
import { describe, expect, it, vi } from "vitest";

const { entries } = vi.hoisted(() => ({ entries: vi.fn() }));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    entries = entries;
  },
}));

describe("autocomplete provider compatibility", () => {
  it("loads legacy Copilot settings with a matching default provider and model", async () => {
    entries.mockResolvedValue([
      ["autocompleteEnabled", true],
      ["autocompleteProvider", "copilot-account"],
      ["autocompleteModelId", "copilot-account-gpt-5.4-mini"],
    ]);
    const preferences = await loadPreferences();
    expect(preferences.autocompleteEnabled).toBe(true);
    expect(preferences.autocompleteProvider).toBe(
      DEFAULT_PREFERENCES.autocompleteProvider,
    );
    expect(preferences.autocompleteModelId).toBe(
      DEFAULT_PREFERENCES.autocompleteModelId,
    );
  });

  it("preserves a supported provider's custom model", async () => {
    entries.mockResolvedValue([
      ["autocompleteProvider", "openrouter"],
      ["autocompleteModelId", "custom/model"],
    ]);
    const preferences = await loadPreferences();
    expect(preferences.autocompleteProvider).toBe("openrouter");
    expect(preferences.autocompleteModelId).toBe("custom/model");
  });

  it("preserves every currently supported provider", () => {
    for (const provider of PROVIDERS) {
      expect(normalizeAutocompleteProvider(provider.id)).toBe(provider.id);
    }
  });

  it("makes removed and malformed stored providers safe to render", () => {
    for (const value of [
      "copilot-account",
      "unknown",
      "",
      null,
      undefined,
      42,
      {},
    ]) {
      const provider = normalizeAutocompleteProvider(value);
      expect(provider).toBe(DEFAULT_PREFERENCES.autocompleteProvider);
      expect(() => getProvider(provider)).not.toThrow();
    }
  });
});
