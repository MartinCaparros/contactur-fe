import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { deleteMail, login, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t15/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VIEWPORTS = [360, 390, 768, 1024, 1440] as const;

type Json = Record<string, unknown>;
type ApiResult = Readonly<{ status: number; json: Json | null }>;
type CatalogItem = Readonly<{ id: number; name: string; code: string }>;
type DocumentType = Readonly<{ id: number; category: string; required: boolean; requires_expiration: boolean }>;
type Catalogs = Readonly<{
  cities: readonly CatalogItem[];
  languages: readonly CatalogItem[];
  services: readonly CatalogItem[];
  document_types: readonly DocumentType[];
}>;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t15/${filename}`, import.meta.url));
}

async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/** Fecha de negocio (D12): la misma regla que usa el backend para "hoy". */
function businessToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

const SYNTHETIC_PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj",
  "trailer<</Root 1 0 R/Size 4>>",
  "%%EOF",
  "",
].join("\n");

/** Espera el fiber de React en el input del modal: señal concreta de hidratación. */
async function waitForHydratedInput(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const input = document.querySelector('[role="dialog"] input');
    return input !== null && Object.keys(input).some((key) => key.startsWith("__react"));
  }, undefined, { timeout: 30_000 });
}

async function registerAndVerify(
  page: Page,
  request: APIRequestContext,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/?auth=register");
  const registration = page.getByRole("dialog", { name: "Crear una cuenta" });
  await expect(registration).toBeVisible({ timeout: 15_000 });
  await waitForHydratedInput(page);
  await registration.getByLabel("Nombre").fill(name);
  await registration.getByLabel("Email").fill(email);
  await registration.getByLabel("Contraseña", { exact: true }).fill(password);
  await registration.getByLabel("Confirmar contraseña").fill(password);
  await expect(registration.getByLabel("Nombre")).toHaveValue(name);
  await expect(registration.getByLabel("Contraseña", { exact: true })).toHaveValue(password);
  await registration.getByRole("button", { name: /crear cuenta/i }).click();
  await expect(registration.getByText("Cuenta creada")).toBeVisible();

  const mail = await waitForMail(request, email, "verify-email");
  await page.goto(mail.link);
  const verification = page.getByRole("dialog", { name: "Verificar correo" });
  await expect(verification).toBeVisible({ timeout: 15_000 });
  await expect(verification.getByText(/tu correo quedó verificado/i)).toBeVisible();
  await deleteMail(request, mail.id);
  await verification.getByRole("button", { name: /ir al inicio de sesión/i }).click();
}

async function registerAndLogin(page: Page, request: APIRequestContext, name: string, email: string, password: string) {
  await registerAndVerify(page, request, name, email, password);
  await login(page, email, password, name);
}

/** Navega por URL y espera el nombre de cuenta del header: garantiza hidratación. */
async function openHydrated(page: Page, path: string, userName: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("header").getByText(userName, { exact: true })).toBeVisible({ timeout: 30_000 });
}

/**
 * Setup por la API real a través del BFF, desde el navegador logueado: mismas cookies,
 * mismo header CSRF que usa la app. Solo para fixtures; el gate se prueba por la UI.
 */
async function api(page: Page, method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<ApiResult> {
  return page.evaluate(async ({ method, path, body }) => {
    const cookie = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("contactur_csrf="));
    let token = cookie ? decodeURIComponent(cookie.slice("contactur_csrf=".length)) : "";
    if (!token && method !== "GET") {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      token = ((await csrf.json()) as { data: { csrf_token: string } }).data.csrf_token;
    }
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["x-csrf-token"] = token;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) as Record<string, unknown> : null };
  }, { method, path, body });
}

async function expectApi(page: Page, method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<Json> {
  const result = await api(page, method, path, body);
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.json)}`).toBeLessThan(300);
  return result.json ?? {};
}

async function uploadPdf(page: Page, profileId: string, type: DocumentType, filename: string, validUntil: string): Promise<void> {
  const result = await page.evaluate(async ({ profileId, typeId, filename, validUntil, pdf }) => {
    const cookie = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("contactur_csrf="));
    const token = cookie ? decodeURIComponent(cookie.slice("contactur_csrf=".length)) : "";
    const form = new FormData();
    form.append("document_type_id", String(typeId));
    form.append("file", new File([pdf], filename, { type: "application/pdf" }));
    if (validUntil) form.append("valid_until", validUntil);
    const response = await fetch(`/api/backend/v1/profiles/${profileId}/documents`, {
      method: "POST",
      headers: { "x-csrf-token": token },
      body: form,
      credentials: "same-origin",
      cache: "no-store",
    });
    return { status: response.status, text: await response.text() };
  }, { profileId, typeId: type.id, filename, validUntil: type.requires_expiration ? validUntil : "", pdf: SYNTHETIC_PDF });
  expect(result.status, `upload ${filename}: ${result.text}`).toBe(201);
}

function byName(items: readonly CatalogItem[], name: string): CatalogItem {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing catalog item ${name}`);
  return item;
}

type ProfileSetup = Readonly<{
  category: "guide" | "tourism_company";
  displayName: string;
  contactEmail: string;
  phone: string;
  documentFilename: string;
}>;

/** Alta completa por API: datos, cobertura, documento requerido, términos y finalización. */
async function createCompletedProfile(page: Page, catalogs: Catalogs, setup: ProfileSetup): Promise<string> {
  const ushuaia = byName(catalogs.cities, "Ushuaia");
  const created = await expectApi(page, "POST", "/api/backend/v1/profiles", {
    category: setup.category,
    display_name: setup.displayName,
  });
  const profileId = (created.data as { id: string }).id;
  await expectApi(page, "PUT", `/api/backend/v1/profiles/${profileId}/cities`, { city_ids: [ushuaia.id] });
  const common = {
    display_name: setup.displayName,
    description: `Perfil de prueba T15 (${setup.category}).`,
    contact_email: setup.contactEmail,
    phone: setup.phone,
    primary_city_id: ushuaia.id,
    language_ids: [byName(catalogs.languages, "Español").id],
    service_ids: [byName(catalogs.services, "Guiado").id],
  };
  await expectApi(page, "PATCH", `/api/backend/v1/profiles/${profileId}`, setup.category === "guide"
    ? { ...common, education_summary: "Tecnicatura en guía de turismo.", qualifications: [] }
    : { ...common, legal_name: `${setup.displayName} SA`, years_active: 5 });
  for (const type of catalogs.document_types.filter((item) => item.category === setup.category && item.required)) {
    await uploadPdf(page, profileId, type, setup.documentFilename, addDays(businessToday(), 400));
  }
  await expectApi(page, "POST", `/api/backend/v1/profiles/${profileId}/terms`, { version: "demo-v1", accepted: true });
  await expectApi(page, "POST", `/api/backend/v1/profiles/${profileId}/complete`);
  return profileId;
}

async function grantAccess(adminPage: Page, profileId: string): Promise<void> {
  await expectApi(adminPage, "PUT", `/api/backend/v1/admin/profiles/${profileId}/access`, {
    status: "active",
    starts_at: null,
    expires_at: null,
    city_limit: 3,
    monthly_contact_limit: 10,
    gallery_enabled: false,
    expected_version: 0,
    reason: "Demo T15: habilitación para el buscador.",
  });
}

async function publishDays(page: Page, profileId: string, cityId: number, dates: readonly string[]): Promise<void> {
  const month = dates[0]?.slice(0, 7) ?? "";
  const current = await expectApi(page, "GET", `/api/backend/v1/profiles/${profileId}/availability?month=${month}`);
  const version = (current.data as { version: number }).version;
  await expectApi(page, "PUT", `/api/backend/v1/profiles/${profileId}/availability`, {
    expected_version: version,
    days: dates.map((date) => ({ date, available: true, city_id: cityId })),
  });
}

async function fullPageEvidence(page: Page, filename: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true, path: evidencePath(filename) });
}

async function assertNoHorizontalOverflow(page: Page, width: number, label: string): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll, `overflow horizontal en ${label} a ${width}px`).toBeLessThanOrEqual(sizes.client);
}

/** Contacto en las variantes en que podría filtrarse: tal cual, sin espacios y solo dígitos. */
function contactNeedles(email: string, phone: string): string[] {
  return [email, phone, phone.replace(/\s+/g, ""), phone.replace(/\D/g, "")];
}

function expectNoContact(haystack: string, needles: readonly string[], where: string): void {
  for (const needle of needles) expect(haystack.includes(needle), `${where} contiene ${needle}`).toBe(false);
}

test("T15 buscador y ficha reales: filtros combinados, all/any, URL, ficha segura y CTA por rol", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(900_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T15 ${crypto.randomUUID().slice(0, 6)}`;
  const password = `T15-${crypto.randomUUID()}-Aa9!`;
  const users = {
    full: { name: "Guía Completo T15", email: `t15-full-${suffix}@example.test` },
    partial: { name: "Guía Parcial T15", email: `t15-partial-${suffix}@example.test` },
    company: { name: "Empresa T15", email: `t15-company-${suffix}@example.test` },
    admin: { name: "Admin T15", email: `t15-admin-${suffix}@example.test` },
  };
  const fullName = `Guía Completa ${tag}`;
  const partialName = `Guía Parcial ${tag}`;
  const partialContact = { email: `contacto-parcial-${suffix}@example.test`, phone: "+54 9 2901 555152" };
  const fullContact = { email: `contacto-completo-${suffix}@example.test`, phone: "+54 9 2901 555151" };
  const partialNeedles = [...contactNeedles(partialContact.email, partialContact.phone), users.partial.email];
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fullContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const partialContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext();
  const fullPage = await fullContext.newPage();
  const partialPage = await partialContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Fixtures por la API real (BFF): dos guías publicados, empresa y admin.
    await registerAndLogin(fullPage, request, users.full.name, users.full.email, password);
    const catalogsBody = await expectApi(fullPage, "GET", "/api/backend/v1/catalogs?per_page=50");
    const catalogs = catalogsBody.data as Catalogs;
    const ushuaia = byName(catalogs.cities, "Ushuaia");
    const fullId = await createCompletedProfile(fullPage, catalogs, {
      category: "guide",
      displayName: fullName,
      contactEmail: fullContact.email,
      phone: fullContact.phone,
      documentFilename: `credencial-completa-t15-${suffix}.pdf`,
    });

    await registerAndLogin(partialPage, request, users.partial.name, users.partial.email, password);
    const partialId = await createCompletedProfile(partialPage, catalogs, {
      category: "guide",
      displayName: partialName,
      contactEmail: partialContact.email,
      phone: partialContact.phone,
      documentFilename: `credencial-parcial-t15-${suffix}.pdf`,
    });

    await registerAndLogin(page, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(page, catalogs, {
      category: "tourism_company",
      displayName: `Empresa Buscadora ${tag}`,
      contactEmail: `contacto-empresa-${suffix}@example.test`,
      phone: "+54 9 2901 555150",
      documentFilename: `registro-empresa-t15-${suffix}.pdf`,
    });

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await login(adminPage, users.admin.email, password, users.admin.name);
    for (const profileId of [fullId, partialId, companyId]) await grantAccess(adminPage, profileId);

    // Rango de 3 días futuros dentro de un mismo mes.
    const tomorrow = addDays(businessToday(), 1);
    const d1 = addDays(tomorrow, 2).slice(0, 7) === tomorrow.slice(0, 7) ? tomorrow : `${addDays(tomorrow, 2).slice(0, 7)}-01`;
    const [d2, d3] = [addDays(d1, 1), addDays(d1, 2)];
    await publishDays(fullPage, fullId, ushuaia.id, [d1, d2, d3]);
    await publishDays(partialPage, partialId, ushuaia.id, [d1, d2]);

    // 2. La empresa busca por la UI: categoría + nombre + ciudad + rango en modo all.
    const searchRequests: string[] = [];
    page.on("request", (candidate) => {
      if (candidate.url().includes(`/profiles/${companyId}/search`)) searchRequests.push(candidate.url());
    });
    await openHydrated(page, `/app?profile=${companyId}`, users.company.name);
    const companyNav = page.getByRole("complementary", { name: "Navegación del perfil" });
    await companyNav.getByRole("link", { name: "Buscar" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/search\\?profile=${companyId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Buscar profesionales" })).toBeVisible();
    await expect(page.getByLabel("Ciudad")).toBeEnabled();

    await page.getByLabel("Categoría").selectOption("guide");
    await page.getByLabel("Nombre").fill(tag);
    await page.getByLabel("Ciudad").selectOption({ label: "Ushuaia" });
    await page.getByLabel("Desde").fill(d1);
    await page.getByLabel("Hasta").fill(d3);
    await expect(page.getByRole("radio", { name: "Todos los días del rango" })).toBeChecked();
    await page.getByRole("button", { name: "Buscar perfiles" }).click();

    const fullCard = page.getByRole("article", { name: fullName });
    const partialCard = page.getByRole("article", { name: partialName });
    await expect(fullCard).toBeVisible();
    await expect(fullCard).toContainText("Disponible los 3 días");
    await expect(page.getByText("1 perfil cargado")).toBeVisible();
    await expect(partialCard).toHaveCount(0);
    const allQuery = `type=guide&name=${encodeURIComponent(tag).replace(/%20/g, "+")}&city_id=${ushuaia.id}&date_from=${d1}&date_to=${d3}&match_mode=all`;
    expect(searchRequests.at(-1)).toContain(`/search?${allQuery}`);
    await fullPageEvidence(page, "01-busqueda-all-1440.png");

    // 3. Modo any: aparecen ambos y el parcial informa 2 de 3.
    await page.getByRole("radio", { name: "Al menos un día del rango" }).check();
    await page.getByRole("button", { name: "Buscar perfiles" }).click();
    await expect(partialCard).toBeVisible();
    await expect(partialCard).toContainText("Disponibilidad parcial: 2 de 3 días");
    await expect(fullCard).toContainText("Disponible los 3 días");
    const anyQuery = allQuery.replace("match_mode=all", "match_mode=any");
    await expect(page).toHaveURL(`/app/search?profile=${companyId}&${anyQuery}`);
    await fullPageEvidence(page, "02-busqueda-any-parcial-1440.png");

    // 4. Recargar conserva filtros y resultados.
    await page.reload();
    await expect(page.locator("header").getByText(users.company.name, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(partialCard).toContainText("Disponibilidad parcial: 2 de 3 días");
    await expect(page.getByLabel("Nombre")).toHaveValue(tag);
    await expect(page.getByLabel("Desde")).toHaveValue(d1);
    await expect(page.getByLabel("Hasta")).toHaveValue(d3);
    await expect(page.getByLabel("Ciudad")).toHaveValue(String(ushuaia.id));
    await expect(page.getByRole("radio", { name: "Al menos un día del rango" })).toBeChecked();
    await expect(page).toHaveURL(`/app/search?profile=${companyId}&${anyQuery}`);

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(partialCard).toBeVisible();
      await assertNoHorizontalOverflow(page, width, "búsqueda");
      for (const target of [
        page.getByRole("button", { name: "Buscar perfiles" }),
        partialCard.getByRole("link", { name: `Ver ficha de ${partialName}` }),
        page.getByLabel("Ciudad"),
      ]) {
        const box = await target.boundingBox();
        expect(box?.height ?? 0, `alto táctil a ${width}px`).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fullPageEvidence(page, "03-busqueda-any-390.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    // 5. Ficha del parcial: calendario público, documentos, referencias vacías y formulario de solicitud (T18).
    const contactRequests: string[] = [];
    page.on("request", (candidate) => {
      if (candidate.url().includes("contact-requests")) contactRequests.push(candidate.url());
    });
    const directoryResponse = page.waitForResponse((response: Response) =>
      response.url().endsWith(`/directory/${partialId}`) && response.request().method() === "GET");
    const availabilityResponse = page.waitForResponse((response: Response) =>
      response.url().includes(`/directory/${partialId}/availability`));
    await partialCard.getByRole("link", { name: `Ver ficha de ${partialName}` }).click();
    await expect(page).toHaveURL(`/app/profiles/${partialId}?profile=${companyId}`);
    await expect(page.getByRole("heading", { level: 1, name: partialName })).toBeVisible();
    const rawDirectory = await (await directoryResponse).text();
    const rawAvailability = await (await availabilityResponse).text();
    expectNoContact(rawDirectory, partialNeedles, "respuesta cruda de la ficha");
    expectNoContact(rawAvailability, partialNeedles, "respuesta cruda de disponibilidad");

    const calendar = page.getByRole("region", { name: "Disponibilidad publicada" });
    if (d1.slice(0, 7) !== businessToday().slice(0, 7)) {
      await calendar.getByRole("button", { name: /^Mes siguiente/ }).click();
    }
    await expect(calendar.locator(`li[data-date="${d1}"]`)).toHaveAttribute("data-state", "available");
    await expect(calendar.locator(`li[data-date="${d1}"]`)).toContainText("disponible en Ushuaia");
    await expect(calendar.locator(`li[data-date="${d2}"]`)).toHaveAttribute("data-state", "available");
    await expect(calendar.locator(`li[data-date="${d3}"]`)).toHaveAttribute("data-state", "unpublished");
    await expect(calendar.locator(`li[data-date="${d3}"]`)).toContainText("sin disponibilidad publicada");
    await expect(calendar).toContainText("2 días disponibles en");
    await expect(page.getByRole("region", { name: "Documentación" })).toContainText("En revisión");
    await expect(page.getByRole("region", { name: "Referencias" })).toContainText("Todavía no tiene referencias visibles.");

    // Desde T18 el CTA deshabilitado de T15 es el formulario real de solicitud. Aquí
    // solo se comprueba que aparece y que abrir la ficha no dispara ningún envío; el
    // recorrido de envío completo vive en e2e/t18-requests.spec.ts.
    await expect(page.getByRole("heading", { level: 2, name: "Solicitar contacto" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Solicitud de contacto" })).toBeVisible();
    const cta = page.getByRole("button", { name: "Enviar solicitud" });
    await expect(cta).toBeEnabled();
    await expect(page.getByText(/^Disponible en próxima etapa\./)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(contactRequests).toEqual([]);
    await expect(page).toHaveURL(`/app/profiles/${partialId}?profile=${companyId}`);

    // P18: ni el DOM ni el HTML SSR/RSC traen contacto del guía.
    expectNoContact(await page.content(), partialNeedles, "DOM de la ficha");
    const ssr = await page.request.get(`/app/profiles/${partialId}?profile=${companyId}`);
    expect(ssr.ok()).toBe(true);
    expectNoContact(await ssr.text(), partialNeedles, "HTML SSR de la ficha");
    const rsc = await page.request.get(`/app/profiles/${partialId}?profile=${companyId}`, { headers: { RSC: "1" } });
    expectNoContact(await rsc.text(), partialNeedles, "payload RSC de la ficha");
    await fullPageEvidence(page, "04-ficha-empresa-1440.png");

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(cta).toBeVisible();
      await assertNoHorizontalOverflow(page, width, "ficha");
      expect((await cta.boundingBox())?.height ?? 0, `alto del CTA a ${width}px`).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fullPageEvidence(page, "05-ficha-empresa-390.png");

    // 6. Un guía logueado: sin Buscar en el menú, /app/search explica y no busca, ficha sin CTA.
    const guideSearchRequests: string[] = [];
    fullPage.on("request", (candidate) => {
      if (candidate.url().includes("/search")) guideSearchRequests.push(candidate.url());
    });
    await openHydrated(fullPage, `/app?profile=${fullId}`, users.full.name);
    const guideNav = fullPage.getByRole("complementary", { name: "Navegación del perfil" });
    await expect(guideNav.getByRole("link", { name: "Disponibilidad" })).toBeVisible();
    await expect(guideNav.getByText("Buscar")).toHaveCount(0);

    await openHydrated(fullPage, `/app/search?profile=${fullId}`, users.full.name);
    await expect(fullPage.getByRole("heading", { level: 1, name: "La búsqueda es para empresas turísticas" })).toBeVisible();
    await expect(fullPage.getByRole("form", { name: "Filtros de búsqueda" })).toHaveCount(0);
    expect(guideSearchRequests.filter((url) => url.includes("/api/backend/"))).toEqual([]);

    await openHydrated(fullPage, `/app/profiles/${partialId}?profile=${fullId}`, users.full.name);
    await expect(fullPage.getByRole("heading", { level: 1, name: partialName })).toBeVisible();
    await expect(fullPage.getByRole("region", { name: "Disponibilidad publicada" })).toBeVisible();
    await expect(fullPage.getByRole("button", { name: /Solicitar/ })).toHaveCount(0);
    await expect(fullPage.getByText(/Las solicitudes de contacto las inician las empresas turísticas/)).toBeVisible();
    expectNoContact(await fullPage.content(), partialNeedles, "DOM de la ficha vista por un guía");
    await fullPageEvidence(fullPage, "06-ficha-guia-sin-cta-1440.png");
  } finally {
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await fullContext.close();
    await partialContext.close();
    await adminContext.close();
  }
});
