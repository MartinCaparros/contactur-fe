import { existsSync } from "node:fs";
import { platform } from "node:os";

import { defineConfig, devices } from "@playwright/test";

const MACOS_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeExecutablePath = process.env.PLAYWRIGHT_CHROME_PATH ||
  (!process.env.CI && platform() === "darwin" && existsSync(MACOS_CHROME_PATH)
    ? MACOS_CHROME_PATH
    : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Un solo worker, igual que CI: los recorridos son largos y comparten un único
  // servidor de desarrollo y backend. En paralelo, sobre un host cargado, las
  // solicitudes superaban el timeout de 10 s del BFF (nginx registraba 499) y el
  // fallo era de capacidad del entorno, no del producto.
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(chromeExecutablePath
      ? { launchOptions: { executablePath: chromeExecutablePath } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Con PLAYWRIGHT_BASE_URL (scripts/dev/e2e.sh: build de producción en :3100) el
  // servidor ya está levantado: no se arranca `next dev`. En CI eso evitaba que
  // Playwright intentara ocupar :3000, que ya sirve el contenedor `frontend` (T24).
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        reuseExistingServer: !process.env.CI,
        url: "http://localhost:3000",
      },
});
