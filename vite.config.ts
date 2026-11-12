import { defineConfig } from "vitest/config";

// public/ holds the datamon assets and, once spec 002 packs them,
// public/fighters/<slug>/{manifest.json,atlas.png}. Asset URLs are relative,
// so the build works from any base path.
export default defineConfig({
  base: "./",
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
