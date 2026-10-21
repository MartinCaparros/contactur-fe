import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const frontendDir = process.cwd();
const workspaceDir = resolve(frontendDir, "..");
const evidenceDir = resolve(workspaceDir, "docs/evidence/t03");
const profileDir = resolve(frontendDir, ".playwright-t03-profile");
const tempDir = resolve(frontendDir, ".playwright-t03-tmp");
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH;

if (!chromePath) {
  throw new Error("PLAYWRIGHT_CHROME_PATH es obligatorio; no se descargarán navegadores.");
}

await mkdir(evidenceDir, { recursive: true });
await rm(profileDir, { recursive: true, force: true });
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
process.env.TMPDIR = tempDir;

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const captures = new Set(["390x844", "768x1024", "1440x900"]);
const originalUrl = pathToFileURL(resolve(workspaceDir, "references/landing-original.html")).href;
const appUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const measurements = [];

let context;
try {
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    viewport: viewports[0],
    reducedMotion: "reduce",
    locale: "es-AR",
    args: ["--disable-sync", "--no-first-run", "--no-default-browser-check"],
  });
  const page = context.pages()[0] ?? (await context.newPage());

  for (const viewport of viewports) {
    const sizeName = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(`${appUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.readyState === "complete");
    await page.emulateMedia({ reducedMotion: "reduce" });

    const metric = await page.evaluate(() => {
      const documentWidth = document.documentElement.scrollWidth;
      const bodyWidth = document.body.scrollWidth;
      const widest = Math.max(documentWidth, bodyWidth);
      const smallTargets = Array.from(
        document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([type="hidden"]):not([tabindex="-1"]), select, textarea',
        ),
      )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 60) ?? element.tagName,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
          };
        })
        .filter((target) => target.width > 0 && target.height > 0 && (target.width < 44 || target.height < 44));
      return {
        viewportWidth: window.innerWidth,
        documentWidth,
        bodyWidth,
        widest,
        overflowPixels: Math.max(0, widest - window.innerWidth),
        smallTargets,
      };
    });
    measurements.push({ viewport: sizeName, ...metric });
    if (metric.overflowPixels > 0) {
      throw new Error(`Overflow horizontal de ${metric.overflowPixels}px en ${sizeName}`);
    }
    if (metric.smallTargets.length > 0) {
      throw new Error(`Targets menores a 44px en ${sizeName}: ${JSON.stringify(metric.smallTargets)}`);
    }

    if (captures.has(sizeName)) {
      await page.screenshot({
        path: resolve(evidenceDir, `react-landing-${sizeName}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.goto(originalUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.readyState === "complete");
      await page.screenshot({
        path: resolve(evidenceDir, `original-landing-${sizeName}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }

  for (const viewport of [viewports[1], viewports[4]]) {
    const sizeName = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(`${appUrl}/?auth=login`, { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog", { name: "Bienvenido" });
    await dialog.waitFor();
    await dialog.getByLabel("Email").waitFor();
    const focusedElement = await page.evaluate(() => document.activeElement?.id ?? null);
    if (focusedElement !== "login-email") {
      throw new Error(`El modal no enfocó email en ${sizeName}; foco: ${focusedElement}`);
    }
    await page.screenshot({
      path: resolve(evidenceDir, `react-login-${sizeName}.png`),
      fullPage: false,
      animations: "disabled",
    });
  }

  await page.goto(`${appUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("dialog", { name: "Bienvenido" }).waitFor();
  const redirectedUrl = new URL(page.url());
  if (redirectedUrl.pathname !== "/" || redirectedUrl.searchParams.get("auth") !== "login") {
    throw new Error(`/login no redirigió al modal canónico: ${page.url()}`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    browser: "Google Chrome local",
    chromePath,
    appUrl,
    horizontalOverflow: measurements,
    loginFocus: "login-email en 390x844 y 1440x900",
    loginRedirect: page.url(),
  };
  await writeFile(resolve(evidenceDir, "measurements.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
  await rm(tempDir, { recursive: true, force: true });
}
