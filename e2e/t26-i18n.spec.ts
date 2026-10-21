import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

import {
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
  ulid,
  waitForHydrated,
  type LayoutReport,
} from "./support/flows";
import { MAILPIT_URL, deleteMail, waitForMail } from "./support/mailpit";

/**
 * T26 — Español / inglés en Chrome real:
 *  1. Selector ES | EN de la landing y de la app: cambia sin recargar, actualiza
 *     `<html lang>`, queda en la cookie (también en el HTML SSR) y, con sesión, en la
 *     cuenta (`PATCH /me`). El alta en inglés manda el correo de verificación en inglés y
 *     Laravel responde los errores en el idioma de la interfaz. En otro dispositivo, el
 *     idioma de la cuenta manda al iniciar sesión.
 *  2. Barrido responsive de la landing y de todas las pantallas autenticadas en inglés
 *     (el texto suele ser más largo): sin overflow, sin contenido cortado, targets ≥44 px
 *     y sin rótulos de interfaz en español.
 */

const TASK = "t26";
const evidencePath = (filename: string) => evidenceFor(TASK, filename);
const WIDTHS = [1440, 1024, 768, 390, 360] as const;
const HEIGHT_FOR: Record<number, number> = { 1440: 900, 1024: 768, 768: 1024, 390: 844, 360: 800 };

/**
 * Rótulos de interfaz que solo aparecen en español. Los datos (nombres de perfiles,
 * ciudades, descripciones) no se traducen, así que la lista evita palabras que puedan
 * venir de los datos sintéticos del spec.
 */
const SPANISH_UI = [
  "Cerrar sesión", "Solicitudes", "Notificaciones", "Ajustes", "Disponibilidad", "Referencias",
  "Buscar", "Guardar", "Volver", "Cargando", "Reintentar", "Ingresá", "Revisá", "No pudimos",
  "Todavía", "Perfil activo", "Idioma", "Iniciar sesión", "Crear perfil", "Pendiente",
];

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t26-[a-z0-9-]+@example\.test$/);
  return value;
}

type MailDetail = Readonly<{ Subject?: string; Text?: string; HTML?: string }>;

async function mailDetail(request: APIRequestContext, id: string): Promise<MailDetail> {
  const response = await request.get(`${MAILPIT_URL}/api/v1/message/${encodeURIComponent(id)}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as MailDetail;
}

async function htmlLang(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.lang);
}

async function localeCookie(context: BrowserContext): Promise<string | undefined> {
  return (await context.cookies()).find((cookie) => cookie.name === "contactur_locale")?.value;
}

/**
 * Marca de los datos sintéticos de cada spec (`T15 1a2b3c`, `T20-1a2b3c`, `T23N-1a2b3c`…).
 * En la suite completa el backoffice lista perfiles de specs anteriores con nombres en
 * español (p. ej. "Guía Pendiente T20-…"): son datos, no rótulos, y no se traducen.
 */
const SYNTHETIC_TAG = /\bT\d{2}[A-Z]?[- ][0-9a-f]{6}/;

/** Palabras de interfaz en español visibles (fuera de los datos). */
async function spanishLeaks(page: Page): Promise<string[]> {
  const text = await page.evaluate((tagSource) => {
    const tag = new RegExp(tagSource);
    let visible = document.body.innerText;
    // Se quitan del texto visible solo los nodos de texto que llevan la marca de un spec.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue?.trim() ?? "";
      if (value && tag.test(value)) visible = visible.replaceAll(value, " ");
    }
    return visible;
  }, SYNTHETIC_TAG.source);
  return SPANISH_UI.filter((word) => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u").test(text));
}

type Measurement = LayoutReport & Readonly<{ route: string; viewport: string; spanish: readonly string[] }>;

async function sweepWidths(page: Page, route: string, ready: () => Locator, screenshotName?: string): Promise<Measurement[]> {
  const results: Measurement[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT_FOR[width] });
    await settleLayout(page);
    await expect(ready()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(150);
    const report = await measureLayout(page);
    results.push({ ...report, route, viewport: `${width}x${HEIGHT_FOR[width]}`, spanish: await spanishLeaks(page) });
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
    expect(result.spanish, `rótulos en español en ${result.route} a ${result.viewport}`).toEqual([]);
  }
}

/** Pasa la cuenta y el navegador a inglés y recarga: el shell aplica el idioma de la cuenta. */
async function switchAccountToEnglish(page: Page): Promise<void> {
  await expectApi(page, "PATCH", "/api/backend/v1/me", { locale: "en" });
  await page.context().addCookies([{ name: "contactur_locale", value: "en", url: new URL(page.url()).origin }]);
}

test("T26 idioma: selector, cookie, <html lang>, cuenta, correo y errores de la API en inglés", async ({ browser, request }) => {
  test.setTimeout(600_000);
  await mkdir(evidencePath(""), { recursive: true });
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const user = { name: "Jane Walker T26", email: syntheticEmail(`t26-switch-${suffix}@example.test`) };
  const password = `T26-${crypto.randomUUID()}-Aa9!`;
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // El nombre de cuenta del header (señal de hidratación de `loginHydrated`) solo se
  // muestra ≥861 px: se entra a 1440 y después se mide el header a 390.
  const otherDevice = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();

  try {
    // 1. Landing: español por defecto; EN cambia todo sin recargar y queda en la cookie.
    await page.goto("/");
    await waitForHydrated(page, "header button");
    expect(await htmlLang(page)).toBe("es");
    const spanishSwitch = page.getByRole("group", { name: "Idioma" });
    await expect(spanishSwitch.getByRole("button", { name: "ES Español" })).toHaveAttribute("aria-pressed", "true");
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await spanishSwitch.getByRole("button", { name: "EN English" }).click();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "About us" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/connect with/i);
    expect(navigations, "cambiar el idioma no recarga la página").toEqual([]);
    expect(await htmlLang(page)).toBe("en");
    expect(await localeCookie(desktop)).toBe("en");
    expect(await spanishLeaks(page)).toEqual([]);
    await fullPageEvidence(page, evidencePath("t26-landing-en-1440.png"));

    // El SSR ya sale en inglés con la cookie: sin parpadeo en español al recargar.
    const ssr = await page.request.get("/");
    const ssrHtml = await ssr.text();
    expect(ssrHtml).toMatch(/<html[^>]* lang="en"/);
    expect(ssrHtml).toContain("About us");
    expect(ssrHtml).not.toContain("Quiénes somos");
    await page.reload();
    await expect(page.getByRole("group", { name: "Language" }).getByRole("button", { name: "EN English" })).toHaveAttribute("aria-pressed", "true");

    // 2. Alta en inglés: la cuenta nace en inglés y el correo de verificación también.
    await page.goto("/?auth=register");
    const registration = page.getByRole("dialog", { name: "Create an account" });
    await expect(registration).toBeVisible({ timeout: 30_000 });
    await waitForHydrated(page, '[role="dialog"] input');
    await expect(registration.getByLabel("Name")).toBeFocused({ timeout: 15_000 });
    await registration.getByLabel("Name").fill(user.name);
    await registration.getByLabel("Email").fill(user.email);
    await registration.getByLabel("Password", { exact: true }).fill(password);
    await registration.getByLabel("Confirm password").fill(password);
    await expect(registration.getByLabel("Name")).toHaveValue(user.name);
    await registration.getByRole("button", { name: /create account/i }).click();
    await expect(registration.getByText("Account created")).toBeVisible({ timeout: 60_000 });

    const verification = await waitForMail(request, user.email, "verify-email");
    const verificationMail = await mailDetail(request, verification.id);
    evidence.verificationMail = { subject: verificationMail.Subject, text: verificationMail.Text };
    expect(verificationMail.Subject).toBe("Verify your email");
    expect(verificationMail.Text).toContain("Confirm your email address to continue on Contactur.");
    expect(verificationMail.Text).toContain("Regards, the Contactur team");
    expect(verificationMail.Text).not.toMatch(/Verificá|Confirmá|Saludos/);
    await page.goto(verification.link);
    const verify = page.getByRole("dialog", { name: "Verify email" });
    await expect(verify.getByText("Your email is verified. You can now log in.")).toBeVisible({ timeout: 60_000 });
    await deleteMail(request, verification.id);
    await verify.getByRole("button", { name: "Go to login" }).click();

    const login = page.getByRole("dialog", { name: "Welcome" });
    await expect(login.getByLabel("Email")).toBeFocused({ timeout: 15_000 });
    await login.getByLabel("Email").fill(user.email);
    await login.getByLabel("Password").fill(password);
    await expect(login.getByLabel("Password")).toHaveValue(password);
    await login.getByRole("button", { name: "Log in →" }).click();
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, { timeout: 90_000 });
    await expect(page.locator("header").getByText(user.name, { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your professional profile" })).toBeVisible();
    expect(await htmlLang(page)).toBe("en");
    expect(await spanishLeaks(page)).toEqual([]);
    const me = await expectApi(page, "GET", "/api/backend/v1/me");
    expect((me.data as { user: { locale: string } }).user.locale).toBe("en");

    // 3. El BFF manda el idioma de la cookie a Laravel: validación por campo en inglés.
    const englishError = await api(page, "PATCH", "/api/backend/v1/me", { name: "A" });
    expect(englishError.status).toBe(422);
    const englishFields = (englishError.json?.error as { code: string; message: string; fields: Record<string, string[]> });
    expect(englishFields.code).toBe("validation_failed");
    expect(englishFields.message).toBe("The data sent is not valid.");
    expect(englishFields.fields.name?.[0]).toBe("The name field must be at least 2 characters.");

    // 4. En la app, ES guarda el idioma en la cuenta (PATCH /me) y los errores vuelven al español.
    const header = page.locator("header");
    const toSpanish = page.waitForResponse((response) => response.url().endsWith("/api/backend/v1/me") && response.request().method() === "PATCH");
    await header.getByRole("group", { name: "Language" }).getByRole("button", { name: "ES Español" }).click();
    expect((await toSpanish).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Creá tu perfil profesional" })).toBeVisible();
    expect(await htmlLang(page)).toBe("es");
    expect(await localeCookie(desktop)).toBe("es");
    expect(((await expectApi(page, "GET", "/api/backend/v1/me")).data as { user: { locale: string } }).user.locale).toBe("es-AR");
    const spanishError = await api(page, "PATCH", "/api/backend/v1/me", { name: "A" });
    expect((spanishError.json?.error as { code: string }).code).toBe("validation_failed");
    expect((spanishError.json?.error as { fields: Record<string, string[]> }).fields.name?.[0]).toBe("El campo nombre debe tener al menos 2 caracteres.");

    const toEnglish = page.waitForResponse((response) => response.url().endsWith("/api/backend/v1/me") && response.request().method() === "PATCH");
    await header.getByRole("group", { name: "Idioma" }).getByRole("button", { name: "EN English" }).click();
    expect((await toEnglish).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    expect(((await expectApi(page, "GET", "/api/backend/v1/me")).data as { user: { locale: string } }).user.locale).toBe("en");

    // 5. Otro dispositivo, sin cookie (español): al entrar manda el idioma de la cuenta.
    const phone = await otherDevice.newPage();
    await phone.goto("/?auth=login");
    await expect(phone.getByRole("dialog", { name: "Bienvenido" })).toBeVisible({ timeout: 30_000 });
    await waitForHydrated(phone, '[role="dialog"] input');
    expect(await htmlLang(phone)).toBe("es");
    await loginHydrated(phone, user.email, password, user.name);
    await expect(phone.getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 30_000 });
    await expect(phone.getByRole("heading", { name: "Create your professional profile" })).toBeVisible();
    expect(await htmlLang(phone)).toBe("en");
    expect(await localeCookie(otherDevice)).toBe("en");
    await phone.setViewportSize({ width: 390, height: 844 });
    await settleLayout(phone);
    const phoneLayout = await measureLayout(phone);
    evidence.appHeader390 = phoneLayout;
    expect(phoneLayout.overflowPixels, `overflow del header en inglés a 390: ${phoneLayout.offenders.join(", ")}`).toBe(0);
    expect(phoneLayout.smallTargets.filter((target) => !target.inline)).toEqual([]);
    await phone.screenshot({ animations: "disabled", path: evidencePath("t26-app-en-otro-dispositivo-390.png") });

    // 6. Cerrar sesión deja la landing en el idioma elegido.
    await phone.getByRole("button", { name: "Log out" }).click();
    await expect(phone).toHaveURL(/\/$/, { timeout: 60_000 });
    await expect(phone.locator("header").getByRole("button", { name: "Log in" })).toBeVisible({ timeout: 30_000 });
    expect(await htmlLang(phone)).toBe("en");
  } finally {
    await writeFile(evidencePath("switch-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`).catch(() => undefined);
    await desktop.close();
    await otherDevice.close();
  }
});

test("T26 barrido responsive en inglés (landing, app y backoffice)", async ({ browser, request }) => {
  test.setTimeout(1_800_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T26R-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T26-${crypto.randomUUID()}-Aa9!`;
  const users = {
    guide: { name: "Sweep Guide T26", email: syntheticEmail(`t26-sweep-guide-${suffix}@example.test`) },
    company: { name: "Sweep Company T26", email: syntheticEmail(`t26-sweep-company-${suffix}@example.test`) },
    admin: { name: "Sweep Admin T26", email: syntheticEmail(`t26-sweep-admin-${suffix}@example.test`) },
  };
  const guideName = `Long-named mountain guide from Tierra del Fuego ${tag}`;
  const companyName = `Southern excursions and adventure travel company ${tag}`;
  let promoted = false;
  const measurements: Measurement[] = [];

  await mkdir(evidencePath(""), { recursive: true });
  const visitorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guideContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guidePage = await guideContext.newPage();
  const companyPage = await companyContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Landing y modal de acceso en inglés.
    const visitor = await visitorContext.newPage();
    await visitor.goto("/");
    await waitForHydrated(visitor, "header button");
    await visitor.getByRole("group", { name: "Idioma" }).getByRole("button", { name: "EN English" }).click();
    await expect(visitor.getByRole("heading", { level: 1 })).toContainText(/connect with/i);
    measurements.push(...await sweepWidths(visitor, "/ (en)", () => visitor.getByRole("heading", { level: 1 }), "t26-landing-en"));
    await visitor.goto("/?auth=login");
    const dialog = visitor.getByRole("dialog", { name: "Welcome" });
    await waitForHydrated(visitor, '[role="dialog"] input');
    await dialog.getByRole("button", { name: "Log in →" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Check the highlighted fields in the form.");
    measurements.push(...await sweepWidths(visitor, "/?auth=login (en, errores)", () => dialog.getByRole("alert"), "t26-login-en-errores"));

    // 2. Datos reales (en español, como los crea cada helper) y después cuentas en inglés.
    await registerAndLogin(guidePage, request, users.guide.name, users.guide.email, password);
    const catalog = await loadCatalogs(guidePage);
    const ushuaia = byName(catalog.cities, "Ushuaia");
    const guideId = await createCompletedProfile(guidePage, catalog, {
      category: "guide",
      displayName: guideName,
      contactEmail: `t26-sweep-contact-guide-${suffix}@example.test`,
      documentFilename: `guide-licence-t26-${suffix}.pdf`,
      label: "T26",
    });
    await registerAndLogin(companyPage, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(companyPage, catalog, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: `t26-sweep-contact-company-${suffix}@example.test`,
      documentFilename: `company-registration-t26-${suffix}.pdf`,
      label: "T26",
    });
    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    await putAccess(adminPage, guideId, 0, `T26 sweep ${tag}: access grant.`, { galleryEnabled: true });
    await putAccess(adminPage, companyId, 0, `T26 sweep ${tag}: access grant.`);

    const d1 = futureBlockStart(3);
    const d3 = addDays(d1, 2);
    await publishDays(guidePage, guideId, ushuaia.id, [d1, addDays(d1, 1), d3]);
    const created = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests`, {
      target_profile_id: guideId,
      service_description: `Full-day guiding with a deliberately long description to check line wrapping on small screens (${tag}).`,
      requested_from: d1,
      requested_to: d3,
      requested_city_id: ushuaia.id,
    });
    const requestId = ulid((created.data as { id: string }).id);
    await expectApi(guidePage, "POST", `/api/backend/v1/profiles/${guideId}/contact-requests/${requestId}/accept`);
    const companyRef = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests/${requestId}/references`, {
      body: `Excellent coordination and punctuality throughout the day; we would work together again (${tag}).`,
    });
    await expectApi(guidePage, "POST", `/api/backend/v1/profiles/${guideId}/contact-requests/${requestId}/references`, {
      body: `The company shared the itinerary well in advance and kept to what was agreed (${tag}).`,
    });
    await expectApi(guidePage, "PATCH", `/api/backend/v1/profiles/${guideId}/references/${ulid((companyRef.data as { id: string }).id)}/visibility`, { visibility: "visible" });
    for (const page of [guidePage, companyPage, adminPage]) await switchAccountToEnglish(page);

    // 3. Barrido: cada ruta se carga e hidrata a 1440 y se mide en los cinco anchos.
    const search = `/app/search?profile=${companyId}&type=guide&name=${encodeURIComponent(tag)}&city_id=${ushuaia.id}&date_from=${d1}&date_to=${d3}&match_mode=all`;
    const routes: ReadonlyArray<Readonly<{ page: Page; user: string; path: string; ready: (page: Page) => Locator; shot: string }>> = [
      { page: companyPage, user: users.company.name, path: `/app?profile=${companyId}`, ready: (p) => p.locator("[data-metric]").first(), shot: "t26-app-dashboard" },
      { page: companyPage, user: users.company.name, path: `/app/profile?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Edit profile" }), shot: "t26-app-profile" },
      { page: companyPage, user: users.company.name, path: search, ready: (p) => p.getByRole("article", { name: guideName }), shot: "t26-app-search" },
      { page: companyPage, user: users.company.name, path: `/app/profiles/${guideId}?profile=${companyId}`, ready: (p) => p.getByRole("region", { name: "References", exact: true }).locator("li[data-reference-id]").first(), shot: "t26-app-directory-profile" },
      { page: companyPage, user: users.company.name, path: `/app/requests?profile=${companyId}`, ready: (p) => p.getByRole("article", { name: guideName, exact: true }), shot: "t26-app-requests" },
      { page: companyPage, user: users.company.name, path: `/app/requests/${requestId}?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: `Request to ${guideName}` }), shot: "t26-app-request-detail" },
      { page: companyPage, user: users.company.name, path: `/app/notifications?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Notifications" }), shot: "t26-app-notifications" },
      { page: companyPage, user: users.company.name, path: `/app/references?profile=${companyId}`, ready: (p) => p.getByRole("tabpanel"), shot: "t26-app-references" },
      { page: companyPage, user: users.company.name, path: `/app/settings?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Settings" }), shot: "t26-app-settings" },
      { page: companyPage, user: users.company.name, path: `/app/access?profile=${companyId}`, ready: (p) => p.getByRole("heading", { level: 1, name: "Profile access" }), shot: "t26-app-access" },
      { page: companyPage, user: users.company.name, path: `/app/availability?profile=${companyId}`, ready: (p) => p.locator("main h1").first(), shot: "t26-app-availability-company" },
      { page: guidePage, user: users.guide.name, path: `/app/availability?profile=${guideId}`, ready: (p) => p.locator('button[data-date]:not([data-state="loading"])').first(), shot: "t26-app-calendar-guide" },
      { page: guidePage, user: users.guide.name, path: `/app/requests/${requestId}?profile=${guideId}`, ready: (p) => p.getByRole("heading", { level: 1, name: `Request from ${companyName}` }), shot: "t26-app-request-guide" },
      { page: guidePage, user: users.guide.name, path: `/app/profile?profile=${guideId}`, ready: (p) => p.getByRole("region", { name: "Gallery" }), shot: "t26-app-profile-guide" },
      { page: adminPage, user: users.admin.name, path: "/app/onboarding", ready: (p) => p.getByRole("heading", { level: 2, name: "1. Category and name" }), shot: "t26-app-onboarding" },
      { page: adminPage, user: users.admin.name, path: "/admin", ready: (p) => p.getByRole("heading", { level: 1, name: "Admin dashboard" }), shot: "t26-admin-dashboard" },
      { page: adminPage, user: users.admin.name, path: "/admin/users", ready: (p) => p.locator("li[data-user-id]").first(), shot: "t26-admin-accounts" },
      { page: adminPage, user: users.admin.name, path: "/admin/profiles", ready: (p) => p.locator("[data-profile-id]").first(), shot: "t26-admin-profiles" },
      { page: adminPage, user: users.admin.name, path: "/admin/documents", ready: (p) => p.getByRole("heading", { level: 1, name: "Documents" }), shot: "t26-admin-documents" },
      { page: adminPage, user: users.admin.name, path: "/admin/references", ready: (p) => p.getByRole("heading", { level: 1, name: "References" }), shot: "t26-admin-references" },
      { page: adminPage, user: users.admin.name, path: "/admin/audit-logs", ready: (p) => p.locator("li[data-audit-id]").first(), shot: "t26-admin-audit-log" },
    ];
    for (const route of routes) {
      await openHydrated(route.page, route.path, route.user);
      await expect(route.ready(route.page)).toBeVisible({ timeout: 90_000 });
      await route.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      expect(await htmlLang(route.page), `<html lang> en ${route.path}`).toBe("en");
      const label = route.path.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ":id").replace(/name=[^&]+/, "name=:tag");
      measurements.push(...await sweepWidths(route.page, label, () => route.ready(route.page), route.shot));
    }
    expectCleanLayout(measurements);
  } finally {
    await writeFile(evidencePath("responsive-en-measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`).catch(() => undefined);
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await visitorContext.close();
    await guideContext.close();
    await companyContext.close();
    await adminContext.close();
  }
});
