import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  REPO_ROOT,
  addDays,
  adminCommand,
  api,
  byName,
  catalogs as loadCatalogs,
  createCompletedProfile,
  evidencePath as evidenceFor,
  expectApi,
  fullPageEvidence,
  futureBlockStart,
  loginHydrated,
  measureLayout,
  openHydrated,
  publishDays,
  putAccess,
  registerAndLogin,
  registerAndVerify,
  settleLayout,
  startService,
  stopService,
  ulid,
  waitForHydrated,
  type LayoutReport,
} from "./support/flows";

/**
 * T23 — QA visual y de accesibilidad en Chrome real:
 *  1. Landing: comparación estructural con `references/landing-original.html`, login
 *     solo como modal (también desde /login), teclado (trap, Escape, retorno de foco),
 *     errores por campo, targets ≥44 px y `prefers-reduced-motion`.
 *  2. Barrido responsive de todas las pantallas autenticadas (app y backoffice) a
 *     1440/1024/768/390/360 sin overflow horizontal ni controles <44 px, y el
 *     comportamiento con el backend caído (nginx detenido → 502 del BFF).
 */

const TASK = "t23";
const evidencePath = (filename: string) => evidenceFor(TASK, filename);
const WIDTHS = [1440, 1024, 768, 390, 360] as const;
const HEIGHT_FOR: Record<number, number> = { 1440: 900, 1024: 768, 768: 1024, 390: 844, 360: 800 };

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t23-[a-z0-9-]+@example\.test$/);
  return value;
}

type Measurement = LayoutReport & Readonly<{ route: string; viewport: string }>;

/** Mide la ruta ya cargada en cada ancho (CSS responsive sobre la misma página hidratada). */
async function sweepWidths(page: Page, route: string, ready: () => Locator, screenshotName?: string): Promise<Measurement[]> {
  const results: Measurement[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] });
    await settleLayout(page);
    await expect(ready()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(150);
    const report = await measureLayout(page);
    results.push({ ...report, route, viewport: `${width}x${HEIGHT_FOR[width]}` });
    if (screenshotName && width === 390) await fullPageEvidence(page, evidencePath(`${screenshotName}-390.png`));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return results;
}

function expectCleanLayout(results: readonly Measurement[]): void {
  for (const result of results) {
    expect(result.overflowPixels, `overflow horizontal en ${result.route} a ${result.viewport}: ${result.offenders.join(", ")}`).toBe(0);
    expect(result.offenders, `contenido cortado por la derecha en ${result.route} a ${result.viewport}`).toEqual([]);
    const blocking = result.smallTargets.filter((target) => !target.inline);
    expect(blocking, `controles <44 px en ${result.route} a ${result.viewport}`).toEqual([]);
  }
}

/** Duración máxima (s) de transiciones y animaciones de toda la página. */
async function maxMotionSeconds(page: Page): Promise<number> {
  return page.evaluate(() => {
    const seconds = (value: string) => Math.max(0, ...value.split(",").map((part) => {
      const trimmed = part.trim();
      return trimmed.endsWith("ms") ? Number.parseFloat(trimmed) / 1000 : Number.parseFloat(trimmed) || 0;
    }));
    let max = 0;
    for (const element of Array.from(document.querySelectorAll("*"))) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = window.getComputedStyle(element, pseudo);
        const animated = style.animationName !== "none" ? seconds(style.animationDuration) : 0;
        max = Math.max(max, seconds(style.transitionDuration), animated);
      }
    }
    return max;
  });
}

/** Títulos de sección (h2) en orden: base de la comparación estructural con el original. */
async function sectionOutline(page: Page): Promise<string[]> {
  // El original no usa <main>/<section>: se toman todos los h2 fuera de diálogos.
  return page.evaluate(() => Array.from(document.querySelectorAll("h2"))
    .filter((heading) => !heading.closest("[role='dialog']"))
    .map((heading) => (heading.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((text, index, all) => text && all.indexOf(text) === index));
}

test("T23 landing: comparación con el HTML original, login por teclado, errores por campo y reduced motion", async ({ browser }) => {
  test.setTimeout(600_000);
  await mkdir(evidencePath(""), { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const original = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const originalPage = await original.newPage();
  const landing: Record<string, unknown> = { generatedAt: new Date().toISOString() };

  try {
    // 1. Comparación con la referencia canónica: mismo ritmo de secciones, sin overflow.
    const originalUrl = new URL("references/landing-original.html", pathToFileURL(REPO_ROOT)).href;
    await originalPage.goto(originalUrl, { waitUntil: "domcontentloaded" });
    await originalPage.waitForTimeout(1_500);
    await page.goto("/");
    await waitForHydrated(page, "header button");
    const comparison: Record<string, unknown>[] = [];
    for (const width of [1440, 768, 390] as const) {
      for (const target of [originalPage, page]) {
        await target.setViewportSize({ width, height: HEIGHT_FOR[width] });
        await settleLayout(target);
      }
      const [originalLayout, reactLayout] = await Promise.all([measureLayout(originalPage), measureLayout(page)]);
      const [originalHeight, reactHeight] = await Promise.all([
        originalPage.evaluate(() => document.documentElement.scrollHeight),
        page.evaluate(() => document.documentElement.scrollHeight),
      ]);
      comparison.push({
        viewport: `${width}x${HEIGHT_FOR[width]}`,
        original: { height: originalHeight, overflowPixels: originalLayout.overflowPixels },
        react: { height: reactHeight, overflowPixels: reactLayout.overflowPixels, smallTargets: reactLayout.smallTargets },
        heightRatio: Number((reactHeight / originalHeight).toFixed(3)),
      });
      expect(reactLayout.overflowPixels, `overflow de la landing a ${width}`).toBe(0);
      expect(reactLayout.offenders, `contenido cortado en la landing a ${width}`).toEqual([]);
      await fullPageEvidence(page, evidencePath(`t23-landing-${width}.png`));
    }
    landing.comparison = comparison;
    landing.outline = { original: await sectionOutline(originalPage), react: await sectionOutline(page) };
    expect((landing.outline as { react: string[] }).react.length).toBeGreaterThanOrEqual(8);

    const landingSweep = await sweepWidths(page, "/", () => page.getByRole("heading", { level: 1 }).first());
    landing.sweep = landingSweep;
    expectCleanLayout(landingSweep);

    // 2. Reduced motion: con `reduce` ninguna transición/animación supera 0,01 ms; sin
    //    preferencia sí hay movimiento (la regla global es la que lo apaga).
    landing.motionReduce = await maxMotionSeconds(page);
    expect(landing.motionReduce as number).toBeLessThanOrEqual(0.001);
    const motion = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    try {
      const motionPage = await motion.newPage();
      await motionPage.goto("/");
      await waitForHydrated(motionPage, "header button");
      landing.motionNoPreference = await maxMotionSeconds(motionPage);
      expect(landing.motionNoPreference as number).toBeGreaterThan(0.05);
    } finally {
      await motion.close();
    }

    // 3. No existe pantalla de login aparte: /login termina en el modal de la landing.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/\?auth=login$/, { timeout: 30_000 });
    await expect(page.getByRole("dialog", { name: "Bienvenido" })).toBeVisible();

    // 4. Teclado: el botón del header abre el modal con Enter, el foco queda atrapado,
    //    Escape cierra y el foco vuelve al disparador.
    await page.goto("/");
    await waitForHydrated(page, "header button");
    const trigger = page.locator("header").getByRole("button", { name: "Iniciar sesión" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Bienvenido" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Email")).toBeFocused();
    const focusables = await dialog.evaluate((element) => element.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).length);
    landing.dialogFocusables = focusables;
    for (let step = 0; step < focusables + 2; step += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Tab ${step + 1} sigue dentro del modal`).toBe(true);
    }
    await dialog.getByRole("button", { name: "Cerrar inicio de sesión" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link", { name: "Conocer el proceso de alta" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(/\/$/);

    // 5. Errores por campo: Enter con el formulario vacío no envía, marca y enfoca.
    await trigger.press("Enter");
    await expect(dialog.getByLabel("Email")).toBeFocused();
    await page.keyboard.press("Enter");
    const email = dialog.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription("Ingresá tu email.");
    await expect(dialog.getByLabel("Contraseña")).toHaveAccessibleDescription("Ingresá tu contraseña.");
    await expect(dialog.getByRole("alert")).toHaveText("Revisá los datos marcados en el formulario.");
    await expect(email).toBeFocused();
    expect(await dialog.locator("form").evaluate((form) => (form as HTMLFormElement).noValidate)).toBe(true);
    await page.keyboard.type("persona@");
    await expect(email).not.toHaveAttribute("aria-invalid");
    await page.setViewportSize({ width: 390, height: 844 });
    await settleLayout(page);
    const modalLayout = await measureLayout(page);
    landing.modal390 = modalLayout;
    expect(modalLayout.overflowPixels).toBe(0);
    expect(modalLayout.smallTargets.filter((target) => !target.inline)).toEqual([]);
    await page.screenshot({ animations: "disabled", path: evidencePath("t23-login-errores-por-campo-390.png") });

    // Registro: contraseña corta y confirmación distinta, sin llamar al BFF.
    await page.goto("/?auth=register");
    const registration = page.getByRole("dialog", { name: "Crear una cuenta" });
    await waitForHydrated(page, '[role="dialog"] input');
    await expect(registration.getByLabel("Nombre")).toBeFocused();
    let registerCalls = 0;
    page.on("request", (candidate) => {
      if (candidate.url().endsWith("/api/auth/register")) registerCalls += 1;
    });
    await registration.getByLabel("Nombre").fill("Persona T23");
    await registration.getByLabel("Email").fill("persona-t23@example.test");
    await registration.getByLabel("Contraseña", { exact: true }).fill("corta");
    await registration.getByLabel("Confirmar contraseña").fill("distinta");
    await registration.getByRole("button", { name: /crear cuenta/i }).click();
    await expect(registration.getByLabel("Contraseña", { exact: true })).toHaveAccessibleDescription(/La contraseña debe tener al menos 12 caracteres\./);
    await expect(registration.getByLabel("Confirmar contraseña")).toHaveAccessibleDescription("Las contraseñas no coinciden.");
    await expect(registration.getByLabel("Contraseña", { exact: true })).toBeFocused();
    expect(registerCalls).toBe(0);
    await page.screenshot({ animations: "disabled", path: evidencePath("t23-registro-errores-por-campo-390.png") });
  } finally {
    await writeFile(evidencePath("landing-measurements.json"), `${JSON.stringify(landing, null, 2)}\n`);
    await context.close();
    await original.close();
  }
});

test("T23 barrido responsive autenticado (app y backoffice) y backend caído", async ({ browser, request }) => {
  test.setTimeout(1_800_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T23R-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T23-${crypto.randomUUID()}-Aa9!`;
  const users = {
    guide: { name: "Guía Barrido T23", email: syntheticEmail(`t23-sweep-guide-${suffix}@example.test`) },
    company: { name: "Empresa Barrido T23", email: syntheticEmail(`t23-sweep-company-${suffix}@example.test`) },
    admin: { name: "Admin Barrido T23", email: syntheticEmail(`t23-sweep-admin-${suffix}@example.test`) },
  };
  const guideName = `Guía con nombre largo de Tierra del Fuego ${tag}`;
  const companyName = `Empresa de excursiones australes ${tag}`;
  let promoted = false;
  let nginxStopped = false;
  const measurements: Measurement[] = [];

  await mkdir(evidencePath(""), { recursive: true });
  const guideContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guidePage = await guideContext.newPage();
  const companyPage = await companyContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Datos reales en todas las pantallas: match aceptado, referencias y notificaciones.
    await registerAndLogin(guidePage, request, users.guide.name, users.guide.email, password);
    const catalog = await loadCatalogs(guidePage);
    const ushuaia = byName(catalog.cities, "Ushuaia");
    const guideId = await createCompletedProfile(guidePage, catalog, {
      category: "guide",
      displayName: guideName,
      contactEmail: `t23-sweep-contacto-guia-${suffix}@example.test`,
      documentFilename: `credencial-barrido-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndLogin(companyPage, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(companyPage, catalog, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: `t23-sweep-contacto-empresa-${suffix}@example.test`,
      documentFilename: `registro-barrido-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    await putAccess(adminPage, guideId, 0, `Barrido T23 ${tag}: habilitación.`, { galleryEnabled: true });
    await putAccess(adminPage, companyId, 0, `Barrido T23 ${tag}: habilitación.`);

    const d1 = futureBlockStart(3);
    const d3 = addDays(d1, 2);
    await publishDays(guidePage, guideId, ushuaia.id, [d1, addDays(d1, 1), d3]);
    const created = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests`, {
      target_profile_id: guideId,
      service_description: `Guiado de día completo con un texto largo para probar el ajuste de línea en pantallas chicas (${tag}).`,
      requested_from: d1,
      requested_to: d3,
      requested_city_id: ushuaia.id,
    });
    const requestId = ulid((created.data as { id: string }).id);
    await expectApi(guidePage, "POST", `/api/backend/v1/profiles/${guideId}/contact-requests/${requestId}/accept`);
    const companyRef = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests/${requestId}/references`, {
      body: `Excelente coordinación y puntualidad durante toda la jornada; repetiríamos (${tag}).`,
    });
    await expectApi(guidePage, "POST", `/api/backend/v1/profiles/${guideId}/contact-requests/${requestId}/references`, {
      body: `La empresa comunicó el itinerario con tiempo y respetó lo acordado (${tag}).`,
    });
    await expectApi(guidePage, "PATCH", `/api/backend/v1/profiles/${guideId}/references/${ulid((companyRef.data as { id: string }).id)}/visibility`, { visibility: "visible" });

    // 2. Barrido: cada ruta se carga e hidrata a 1440 y se mide en los cinco anchos.
    const search = `/app/search?profile=${companyId}&type=guide&name=${encodeURIComponent(tag)}&city_id=${ushuaia.id}&date_from=${d1}&date_to=${d3}&match_mode=all`;
    const routes: ReadonlyArray<Readonly<{ page: Page; user: string; path: string; ready: (page: Page) => Locator; shot: string }>> = [
      { page: companyPage, user: users.company.name, path: `/app?profile=${companyId}`, ready: (p) => p.locator("[data-metric]").first(), shot: "t23-app-resumen" },
      { page: companyPage, user: users.company.name, path: `/app/profile?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Editar perfil" }), shot: "t23-app-perfil" },
      { page: companyPage, user: users.company.name, path: search, ready: (p) => p.getByRole("article", { name: guideName }), shot: "t23-app-buscar" },
      { page: companyPage, user: users.company.name, path: `/app/profiles/${guideId}?profile=${companyId}`, ready: (p) => p.getByRole("region", { name: "Referencias", exact: true }).locator("li[data-reference-id]").first(), shot: "t23-app-ficha" },
      { page: companyPage, user: users.company.name, path: `/app/requests?profile=${companyId}`, ready: (p) => p.getByRole("article", { name: guideName, exact: true }), shot: "t23-app-solicitudes" },
      { page: companyPage, user: users.company.name, path: `/app/requests/${requestId}?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: `Solicitud a ${guideName}` }), shot: "t23-app-solicitud-detalle" },
      { page: companyPage, user: users.company.name, path: `/app/notifications?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Notificaciones" }), shot: "t23-app-notificaciones" },
      { page: companyPage, user: users.company.name, path: `/app/references?profile=${companyId}`, ready: (p) => p.getByRole("tabpanel"), shot: "t23-app-referencias" },
      { page: companyPage, user: users.company.name, path: `/app/settings?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Ajustes" }), shot: "t23-app-ajustes" },
      { page: companyPage, user: users.company.name, path: `/app/access?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Acceso del perfil" }), shot: "t23-app-acceso" },
      { page: companyPage, user: users.company.name, path: `/app/availability?profile=${companyId}`, ready: (p) => p.locator("main h1").first(), shot: "t23-app-disponibilidad-empresa" },
      { page: guidePage, user: users.guide.name, path: `/app/availability?profile=${guideId}`, ready: (p) => p.locator('button[data-date]:not([data-state="loading"])').first(), shot: "t23-app-calendario-guia" },
      { page: guidePage, user: users.guide.name, path: `/app/requests/${requestId}?profile=${guideId}`, ready: (p) => p.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` }), shot: "t23-app-solicitud-guia" },
      { page: guidePage, user: users.guide.name, path: `/app/profile?profile=${guideId}`, ready: (p) => p.getByRole("region", { name: "Galería" }), shot: "t23-app-perfil-guia" },
      { page: adminPage, user: users.admin.name, path: "/app/onboarding", ready: (p) => p.getByRole("heading", { level: 2, name: "1. Categoría y nombre" }), shot: "t23-app-onboarding" },
      { page: adminPage, user: users.admin.name, path: "/admin", ready: (p) => p.getByRole("heading", { level: 1, name: "Panel administrativo" }), shot: "t23-admin-panel" },
      { page: adminPage, user: users.admin.name, path: "/admin/users", ready: (p) => p.locator("li[data-user-id]").first(), shot: "t23-admin-cuentas" },
      { page: adminPage, user: users.admin.name, path: "/admin/profiles", ready: (p) => p.locator("[data-profile-id]").first(), shot: "t23-admin-perfiles" },
      { page: adminPage, user: users.admin.name, path: "/admin/documents", ready: (p) => p.getByRole("heading", { level: 1, name: "Documentos" }), shot: "t23-admin-documentos" },
      { page: adminPage, user: users.admin.name, path: "/admin/references", ready: (p) => p.getByRole("heading", { level: 1, name: "Referencias" }), shot: "t23-admin-referencias" },
      { page: adminPage, user: users.admin.name, path: "/admin/audit-logs", ready: (p) => p.locator("li[data-audit-id]").first(), shot: "t23-admin-auditoria" },
    ];
    for (const route of routes) {
      await openHydrated(route.page, route.path, route.user);
      await expect(route.ready(route.page)).toBeVisible({ timeout: 90_000 });
      await route.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      const label = route.path.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id").replace(/name=[^&]+/, "name=:tag");
      measurements.push(...await sweepWidths(route.page, label, () => route.ready(route.page), route.shot));
    }
    expectCleanLayout(measurements);

    // 3. Backend caído: nginx detenido → el BFF responde 502 genérico. La sesión no se
    //    pierde, nada inventa éxito y "Reintentar" recupera la vista al volver el servicio.
    await openHydrated(companyPage, `/app/requests?profile=${companyId}`, users.company.name);
    await expect(companyPage.getByRole("article", { name: guideName, exact: true })).toBeVisible({ timeout: 60_000 });
    await stopService("nginx");
    nginxStopped = true;
    const down = await api(companyPage, "GET", "/api/backend/v1/me");
    expect(down.status).toBe(502);
    expect((down.json?.error as { code?: string } | undefined)?.code).toBe("backend_unavailable");
    await companyPage.reload();
    const accountError = companyPage.getByRole("alert").filter({ hasText: "No pudimos abrir tu cuenta" });
    await expect(accountError).toBeVisible({ timeout: 60_000 });
    await expect(accountError).toContainText("El servicio no está disponible temporalmente.");
    await expect(companyPage).toHaveURL(new RegExp(`/app/requests\\?profile=${companyId}$`));
    expect((await companyContext.cookies()).some((cookie) => cookie.name === "contactur_refresh")).toBe(true);
    await fullPageEvidence(companyPage, evidencePath("t23-error-backend-caido-app-1440.png"));

    await adminPage.reload();
    const adminError = adminPage.getByRole("alert").filter({ hasText: "No pudimos abrir el backoffice" });
    await expect(adminError).toBeVisible({ timeout: 60_000 });
    await expect(adminError.getByRole("button", { name: "Reintentar" })).toBeVisible();

    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto("/?auth=login");
      const loginDialog = visitorPage.getByRole("dialog", { name: "Bienvenido" });
      await waitForHydrated(visitorPage, '[role="dialog"] input');
      await expect(loginDialog.getByLabel("Email")).toBeFocused();
      await loginDialog.getByLabel("Email").fill(users.company.email);
      await loginDialog.getByLabel("Contraseña").fill(password);
      await loginDialog.getByRole("button", { name: /iniciar sesión/i }).click();
      await expect(loginDialog.getByRole("alert")).toHaveText("No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente.", { timeout: 60_000 });
      await expect(loginDialog.getByRole("button", { name: /iniciar sesión/i })).toBeEnabled();
      await expect(visitorPage).toHaveURL(/\?auth=login$/);
      await visitorPage.screenshot({ animations: "disabled", path: evidencePath("t23-error-backend-caido-login-390.png") });

      await loginDialog.getByRole("button", { name: "Cerrar inicio de sesión" }).click();
      const contactForm = visitorPage.locator("#contacto form");
      await contactForm.scrollIntoViewIfNeeded();
      await contactForm.getByLabel("Nombre").fill("Visitante T23");
      await contactForm.getByLabel("Email").fill(syntheticEmail(`t23-sweep-visitante-${suffix}@example.test`));
      await contactForm.getByLabel("Mensaje").fill(`Consulta mientras el servicio está caído (${tag}).`);
      await contactForm.getByRole("button", { name: /enviar consulta/i }).click();
      await expect(contactForm.getByRole("alert")).toHaveText("No pudimos enviar tu consulta. Intentá de nuevo en unos minutos.", { timeout: 60_000 });
      await expect(contactForm.getByRole("status")).toHaveText("");
      await contactForm.screenshot({ animations: "disabled", path: evidencePath("t23-error-backend-caido-contacto-390.png") });
    } finally {
      await visitor.close();
    }

    await startService("nginx");
    nginxStopped = false;
    await accountError.getByRole("button", { name: "Reintentar" }).click();
    await expect(companyPage.locator("header").getByText(users.company.name, { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(companyPage.getByRole("article", { name: guideName, exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    if (nginxStopped) await startService("nginx").catch(() => undefined);
    await writeFile(evidencePath("responsive-measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`).catch(() => undefined);
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideContext.close();
    await companyContext.close();
    await adminContext.close();
  }
});
