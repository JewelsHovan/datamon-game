import { defineConfig } from "vitest/config";

// public/ holds the datamon assets, the packed art (public/fighters/<slug>/{manifest.json,atlas.webp},
// effects, stages) and _headers (Cloudflare cache rules, spec 013); the build copies it to dist/.
// Asset URLs are relative, so the build works from any base path.
export default defineConfig({
  base: "./",
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
