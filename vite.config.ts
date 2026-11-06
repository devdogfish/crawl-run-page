import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// DEV ONLY: POST /__proto/<fn> calls an export of src/lib/proto-api.ts (the prototype's data, shaped like the backend's
// Core) and returns it as JSON. The Python backend's PrototypeCore uses this; delete it with proto-api.ts on integration.
// Loaded through ssrLoadModule so edits to the data files are picked up without restarting.
function protoApi(): Plugin {
  return {
    name: "proto-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__proto", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        const fn = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (req.method !== "POST" || !fn) return send(405, { error: "POST /__proto/<function>" });
        try {
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const mod = (await server.ssrLoadModule("/src/lib/proto-api.ts")) as Record<string, unknown>;
          const f = mod[fn];
          if (typeof f !== "function") return send(404, { error: `No function "${fn}" in proto-api.ts` });
          send(200, await f(raw ? JSON.parse(raw) : {}));
        } catch (e) {
          send(400, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), protoApi()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The Python backend (backend/, `pnpm dev:api`): chat, navigation, the MCP server. Without it the app falls back
  // to scripted answers (the backend marks its responses with X-Crawler-AI).
  server: { proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } } },
});
