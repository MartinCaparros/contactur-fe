import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  adminCommand,
  evidencePath as evidenceFor,
  loginHydrated,
  measureLayout,
  openHydrated,
  registerAndVerify,
  settleLayout,
  waitForHydrated,
} from "./support/flows";
import { MAILPIT_URL, deleteMail, waitForMail } from "./support/mailpit";

/**
 * T27 — logos oficiales en Chrome real, contra el build de producción:
 *  1. Landing: isotipo (logo-02) en header, footer y modal, cargado y a la altura prevista;
 *     íconos del navegador (favicon, icon.png, apple-icon) enlazados en el <head> y servidos.
 *  2. App, alta y backoffice: el isotipo reemplaza el cuadro "CT" en los cuatro headers, sin
 *     overflow ni targets <44 px a 390 px. El correo de recuperación trae el logo a color
 *     (logo-01) servido por el frontend público y enlazado al sitio.
 */

const TASK = "t27";
const evidencePath = (filename: string) => evidenceFor(TASK, filename);
const MARK = "/brand/contactur-mark.webp";
const EMAIL_LOGO = "/brand/contactur-logo-email.png";
const MARK_RATIO = 140 / 92;

type MarkBox = Readonly<{ where: string; width: number; height: number }>;

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t27-[a-z0-9-]+@example\.test$/);
  return value;
}

/** El isotipo dentro de `scope`: cargado de verdad (no un ícono roto), decorativo y a `height` px. */
async function expectBrandMark(scope: Locator, where: string, height: number): Promise<MarkBox> {
  const mark = scope.locator(`img[src="${MARK}"]`);
  await expect(mark).toHaveCount(1);
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("alt", "");
  await expect
    .poll(() => mark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 140 && image.naturalHeight === 92))
    .toBe(true);
  const box = await mark.boundingBox();
  expect(box, `caja del isotipo en ${where}`).not.toBeNull();
  expect(box?.height, `alto del isotipo en ${where}`).toBeCloseTo(height, 0);
  expect(box?.width, `ancho del isotipo en ${where}`).toBeCloseTo(height * MARK_RATIO, 0);
  await expect(scope.getByText("CT", { exact: true })).toHaveCount(0);
  return { where, width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
}

async function expectCleanHeader(page: Page, where: string): Promise<void> {
  await settleLayout(page);
  const report = await measureLayout(page);
  expect(report.overflowPixels, `overflow en ${where}: ${report.offenders.join(", ")}`).toBe(0);
  expect(report.smallTargets.filter((target) => !target.inline), `controles <44 px en ${where}`).toEqual([]);
}

async function expectImageResponse(request: APIRequestContext, url: string, type: RegExp): Promise<void> {
  const response = await request.get(url);
  expect(response.status(), url).toBe(200);
  expect(response.headers()["content-type"], url).toMatch(type);
  expect((await response.body()).byteLength, url).toBeGreaterThan(500);
}

type MailDetail = Readonly<{ HTML?: string; Text?: string }>;

test("T27 landing: isotipo en header y footer, íconos del navegador y archivos de marca", async ({ page }) => {
  test.setTimeout(240_000);
  await mkdir(evidencePath(""), { recursive: true });
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  const marks: MarkBox[] = [];

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForHydrated(page, "header button");
  const header = page.locator("header").first();
  const footer = page.locator("footer");
  marks.push(await expectBrandMark(header, "landing header 1440", 28));
  await expect(header.getByRole("link", { name: "Contactur" })).toHaveAttribute("href", "#inicio");
  await header.screenshot({ animations: "disabled", path: evidencePath("t27-landing-header-1440.png") });
  await footer.scrollIntoViewIfNeeded();
  marks.push(await expectBrandMark(footer, "landing footer 1440", 28));
  await footer.screenshot({ animations: "disabled", path: evidencePath("t27-landing-footer-1440.png") });

  // ≤768 px el texto se oculta y queda el isotipo: el enlace sigue siendo un target de 44 px.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  marks.push(await expectBrandMark(header, "landing header 390", 28));
  await expectCleanHeader(page, "landing 390");
  await header.screenshot({ animations: "disabled", path: evidencePath("t27-landing-header-390.png") });

  // Íconos: Next los enlaza por convención de archivo; cada uno tiene que existir y servirse.
  const icons = await page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]').evaluateAll((links) =>
    links.map((link) => ({
      rel: link.getAttribute("rel"),
      href: link.getAttribute("href"),
      sizes: link.getAttribute("sizes"),
      type: link.getAttribute("type"),
    })),
  );
  evidence.icons = icons;
  const favicon = icons.find((icon) => icon.rel === "icon" && /\/favicon\.ico/.test(icon.href ?? ""));
  const png = icons.find((icon) => icon.rel === "icon" && /\/icon\.png/.test(icon.href ?? ""));
  const apple = icons.find((icon) => icon.rel === "apple-touch-icon");
  expect(favicon, "favicon.ico enlazado").toBeDefined();
  expect(png?.sizes, "icon.png enlazado con su tamaño").toBe("192x192");
  expect(apple?.sizes, "apple-touch-icon enlazado con su tamaño").toBe("180x180");
  const origin = new URL(page.url()).origin;
  await expectImageResponse(page.request, new URL(favicon?.href ?? "", origin).href, /image\/(x-icon|vnd\.microsoft\.icon)/);
  await expectImageResponse(page.request, new URL(png?.href ?? "", origin).href, /image\/png/);
  await expectImageResponse(page.request, new URL(apple?.href ?? "", origin).href, /image\/png/);
  await expectImageResponse(page.request, `${origin}${MARK}`, /image\/webp/);
  // El que referencian los correos (FRONTEND_URL + ruta).
  await expectImageResponse(page.request, `${origin}${EMAIL_LOGO}`, /image\/png/);

  evidence.marks = marks;
  await writeFile(evidencePath("landing-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
});

test("T27 app, alta, backoffice, modal de acceso y correo con los logos oficiales", async ({ browser, request }) => {
  test.setTimeout(600_000);
  await mkdir(evidencePath(""), { recursive: true });
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const user = { name: "Brand Admin T27", email: syntheticEmail(`t27-brand-${suffix}@example.test`) };
  const password = `T27-${crypto.randomUUID()}-Aa9!`;
  const marks: MarkBox[] = [];
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  let promoted = false;
  const member = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });

  try {
    // Cuenta admin sin perfiles: entra al shell de la app (alta pendiente), al alta y al backoffice.
    const page = await member.newPage();
    await registerAndVerify(page, request, user.name, user.email, password);
    expect(await adminCommand(user.email)).toContain("admin");
    promoted = true;
    await loginHydrated(page, user.email, password, user.name);

    const shells: ReadonlyArray<Readonly<{ path: string; where: string; ready: (p: Page) => Locator; shot: string }>> = [
      { path: "/app", where: "app", ready: (p) => p.getByRole("heading", { name: "Creá tu perfil profesional" }), shot: "t27-app-header" },
      { path: "/app/onboarding", where: "alta", ready: (p) => p.getByRole("heading", { level: 2, name: "1. Categoría y nombre" }), shot: "t27-onboarding-header" },
      { path: "/admin", where: "backoffice", ready: (p) => p.getByRole("heading", { level: 1, name: "Panel administrativo" }), shot: "t27-admin-header" },
    ];
    for (const shell of shells) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openHydrated(page, shell.path, user.name);
      await expect(shell.ready(page)).toBeVisible({ timeout: 90_000 });
      const header = page.locator("header").first();
      marks.push(await expectBrandMark(header, `${shell.where} 1440`, 30));
      await header.screenshot({ animations: "disabled", path: evidencePath(`${shell.shot}-1440.png`) });
      for (const width of [390, 360] as const) {
        await page.setViewportSize({ width, height: 844 });
        marks.push(await expectBrandMark(header, `${shell.where} ${width}`, 30));
        await expectCleanHeader(page, `${shell.where} ${width}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await settleLayout(page);
      await header.screenshot({ animations: "disabled", path: evidencePath(`${shell.shot}-390.png`) });
    }

    // Modal de acceso y recuperación: el correo de restablecimiento trae el logo a color.
    const visit = await visitor.newPage();
    await visit.goto("/?auth=login");
    const login = visit.getByRole("dialog", { name: "Bienvenido" });
    await expect(login).toBeVisible({ timeout: 30_000 });
    await waitForHydrated(visit, '[role="dialog"] input');
    marks.push(await expectBrandMark(login, "modal de acceso 390", 28));
    await visit.screenshot({ animations: "disabled", path: evidencePath("t27-modal-acceso-390.png") });
    await login.getByRole("link", { name: /olvidaste tu contraseña/i }).click();
    const recovery = visit.getByRole("dialog", { name: "Recuperar contraseña" });
    await expect(recovery).toBeVisible();
    await recovery.getByLabel("Email").fill(user.email);
    await recovery.getByRole("button", { name: /enviar instrucciones/i }).click();
    await expect(recovery.getByText(/si el email corresponde a una cuenta/i)).toBeVisible({ timeout: 60_000 });

    const resetMail = await waitForMail(request, user.email, "reset-password");
    const detail = (await (await request.get(`${MAILPIT_URL}/api/v1/message/${encodeURIComponent(resetMail.id)}`)).json()) as MailDetail;
    const html = detail.HTML ?? "";
    const logo = html.match(/<a href="([^"]+)"[^>]*>\s*<img src="([^"]+\/brand\/contactur-logo-email\.png)" width="120" height="48" alt="Contactur"/);
    expect(logo, "logo enlazado en el header del correo").not.toBeNull();
    const [, logoHref = "", logoSrc = ""] = logo ?? [];
    evidence.resetMail = { logoHref, logoSrc, textHasLogo: (detail.Text ?? "").includes("contactur-logo-email") };
    expect(new URL(logoHref).origin, "el logo enlaza al sitio público, no a la API").toBe(new URL(logoSrc).origin);
    expect(new URL(logoHref).port).not.toBe("8080");
    expect(detail.Text ?? "").not.toContain("contactur-logo-email");

    // El HTML real del correo, con el origen del logo llevado al servidor de esta corrida.
    const runOrigin = new URL(visit.url()).origin;
    const mailPage = await visitor.newPage();
    await mailPage.setViewportSize({ width: 720, height: 900 });
    await mailPage.setContent(html.replaceAll(new URL(logoSrc).origin, runOrigin), { waitUntil: "load" });
    const mailLogo = mailPage.locator(`img[src="${runOrigin}${EMAIL_LOGO}"]`);
    await expect.poll(() => mailLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 120)).toBe(true);
    await mailPage.screenshot({ animations: "disabled", path: evidencePath("t27-correo-recuperacion.png"), clip: { x: 0, y: 0, width: 720, height: 520 } });
    await deleteMail(request, resetMail.id);

    evidence.marks = marks;
  } finally {
    await writeFile(evidencePath("shell-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`).catch(() => undefined);
    if (promoted) await adminCommand(user.email, ["--demote"]).catch(() => undefined);
    await member.close();
    await visitor.close();
  }
});
