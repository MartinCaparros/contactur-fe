import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", ...configDefaults.exclude],
    // La landing y el shell privado renderizan árboles grandes: con varios workers
    // en paralelo un render que aislado tarda ~1s puede superar el default de 5s.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
