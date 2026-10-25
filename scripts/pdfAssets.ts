import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

export function pdfAssets(): Plugin {
  const root = path.resolve(import.meta.dirname, "../node_modules/pdfjs-dist");
  const folders = ["cmaps", "standard_fonts", "wasm", "iccs", "images"];
  let building = false;
  return {
    name: "terax-pdf-assets",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (!building) return;
      this.emitFile({
        type: "asset", fileName: "pdfjs/LICENSE",
        source: await readFile(path.join(root, "LICENSE")),
      });
      for (const folder of folders) {
        for (const name of await readdir(path.join(root, folder === "images" ? "web/images" : folder))) {
          this.emitFile({
            type: "asset", fileName: `pdfjs/${folder}/${name}`,
            source: await readFile(path.join(root, folder === "images" ? "web/images" : folder, name)),
          });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use("/pdfjs", async (request, response, next) => {
        const parts = request.url?.split("?")[0].split("/").filter(Boolean) ?? [];
        if (parts.length !== 2 || !folders.includes(parts[0]) ||
          !/^[\w.-]+$/.test(parts[1]) || parts[1].includes("..")) return next();
        try {
          const data = await readFile(path.join(root, parts[0] === "images" ? "web/images" : parts[0], parts[1]));
          response.setHeader("Content-Type", parts[1].endsWith(".wasm")
            ? "application/wasm" : "application/octet-stream");
          response.end(data);
        } catch {
          next();
        }
      });
    },
  };
}
