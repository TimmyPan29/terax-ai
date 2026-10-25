import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(
    new URL("../../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const directives = new Map<string, string[]>(
  config.app.security.csp.split(";").map((directive: string) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }),
);

describe("local image and media asset policy", () => {
  it("allows PDF fetches from each platform asset protocol", () => {
    expect(directives.get("connect-src")).toEqual(
      expect.arrayContaining([
        "asset:",
        "http://asset.localhost",
        "https://asset.localhost",
      ]),
    );
  });
  it.each(["img-src", "media-src"])(
    "%s permits the Windows HTTP asset origin and the other platform schemes",
    (directive) => {
      expect(directives.get(directive)).toEqual(
        expect.arrayContaining([
          "'self'",
          "asset:",
          "http://asset.localhost",
          "https://asset.localhost",
          "blob:",
        ]),
      );
    },
  );

  it("keeps SVG Blob previews and image attachments allowed", () => {
    expect(directives.get("img-src")).toEqual(
      expect.arrayContaining(["blob:", "data:"]),
    );
  });

  it.each(["img-src", "media-src"])(
    "%s restricts network access to the specific local asset host",
    (directive) => {
      for (const source of [
        "*",
        "http:",
        "https:",
        "http://*.localhost",
        "https://*.localhost",
      ]) {
        expect(directives.get(directive)).not.toContain(source);
      }
    },
  );

  it("enables the asset protocol used by file previews", () => {
    expect(config.app.security.assetProtocol.enable).toBe(true);
  });
});
