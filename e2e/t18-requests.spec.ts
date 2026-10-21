import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";

import { deleteMail, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t18/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

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
type Contact = Readonly<{ email: string; phone: string }>;

/** Navegación cliente tras un click: margen extra porque el host de pruebas está muy cargado. */
const NAVIGATION = { timeout: 90_000 } as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t18/${filename}`, import.meta.url));
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

/**
 * Copia local de `login` (support/mailpit.ts) con más margen: con load average ~10 el
 * shell tardó más de 30 s en hidratar tras el login. Si no hidrató, recarga una vez.
 */
async function loginHydrated(page: Page, email: string, password: string, userName: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Bienvenido" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  // El modal enfoca "Email" en un requestAnimationFrame: si llega en medio del fill, la
  // contraseña termina en "Email". Se espera ese foco y se confirman los valores.
  await expect(dialog.getByLabel("Email")).toBeFocused({ timeout: 15_000 });
  const fillAndSubmit = async () => {
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Contraseña").fill(password);
    await expect(dialog.getByLabel("Email")).toHaveValue(email);
    await expect(dialog.getByLabel("Contraseña")).toHaveValue(password);
    await dialog.getByRole("button", { name: /iniciar sesión/i }).click();
  };
  await fillAndSubmit();
  try {
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, NAVIGATION);
  } catch {
    // El login llegó a devolver 502 a los 46 s con el host saturado; reintentar es seguro.
    if (!/\/app$/.test(new URL(page.url()).pathname)) await fillAndSubmit();
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, NAVIGATION);
  }
  const accountName = page.locator("header").getByText(userName, { exact: true });
  try {
    await expect(accountName).toBeVisible({ timeout: 60_000 });
  } catch {
    await page.reload();
    await expect(accountName).toBeVisible({ timeout: 90_000 });
  }
}

async function registerAndLogin(page: Page, request: APIRequestContext, name: string, email: string, password: string) {
  await registerAndVerify(page, request, name, email, password);
  await loginHydrated(page, email, password, name);
}

/** Navega por URL y espera el nombre de cuenta del header: garantiza hidratación. */
async function openHydrated(page: Page, path: string, userName: string): Promise<void> {
  await page.goto(path);
  const accountName = page.locator("header").getByText(userName, { exact: true });
  try {
    await expect(accountName).toBeVisible({ timeout: 60_000 });
  } catch {
    // Con el host saturado, `/me` llegó a responder 502 tras 20 s (timeout del BFF):
    // la UI muestra "No pudimos abrir tu cuenta". Es capacidad del entorno; se recarga una vez.
    await page.reload();
    await expect(accountName).toBeVisible({ timeout: 90_000 });
  }
}

/**
 * Setup por la API real a través del BFF, desde el navegador logueado: mismas cookies,
 * mismo header CSRF que usa la app. Solo para fixtures; el recorrido se prueba por la UI.
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
  let result = await api(page, method, path, body);
  // Fixtures en un host saturado: el BFF corta a los 10 s con 502 aunque Laravel termine
  // después. GET/PUT/PATCH de setup son idempotentes, así que se reintentan; POST no.
  for (let retry = 0; retry < 2 && method !== "POST" && result.status >= 502; retry += 1) {
    await page.waitForTimeout(2_000);
    result = await api(page, method, path, body);
  }
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
    description: `Perfil de prueba T18 (${setup.category}).`,
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
    reason: "Demo T18: habilitación para solicitudes de contacto.",
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

/** P18: ni el DOM vivo ni el HTML SSR ni el payload RSC de la ruta traen contacto. */
async function expectPageWithoutContact(page: Page, path: string, needles: readonly string[], where: string): Promise<void> {
  expectNoContact(await page.content(), needles, `DOM de ${where}`);
  const ssr = await page.request.get(path);
  expect(ssr.ok(), `GET ${path}`).toBe(true);
  expectNoContact(await ssr.text(), needles, `HTML SSR de ${where}`);
  const rsc = await page.request.get(path, { headers: { RSC: "1" } });
  expectNoContact(await rsc.text(), needles, `payload RSC de ${where}`);
}

/**
 * El stack local corre `next dev`: la primera visita a una ruta la compila y, con el
 * host cargado, eso tardó 37 s. Se precalientan las rutas de T18 durante el setup para
 * que las esperas del recorrido midan la UI y no el compilador.
 */
async function warmRoutes(page: Page, paths: readonly string[]): Promise<void> {
  for (const path of paths) await page.request.get(path, { timeout: 180_000 });
}

/** Teléfono ficticio único por corrida, para que las búsquedas de fuga no choquen con restos. */
function fakePhone(): string {
  return `+54 9 2901 ${String(100_000 + Math.floor(Math.random() * 899_999))}`;
}

/** Completa y envía el formulario de la ficha; devuelve el id público de la solicitud creada. */
async function sendContactRequest(
  page: Page,
  companyId: string,
  targetName: string,
  fields: Readonly<{ service: string; from?: string; to?: string; city?: string }>,
  forbidden: readonly string[],
): Promise<string> {
  const form = page.getByRole("form", { name: "Solicitud de contacto" });
  await expect(form).toBeVisible();
  await form.getByLabel("Servicio solicitado").fill(fields.service);
  if (fields.from && fields.to) {
    await form.getByLabel("Desde (opcional)").fill(fields.from);
    await form.getByLabel("Hasta (opcional)").fill(fields.to);
  }
  if (fields.city) await form.getByLabel("Ciudad (opcional)").selectOption({ label: fields.city });
  await expect(form.getByLabel("Servicio solicitado")).toHaveValue(fields.service);

  const created = page.waitForResponse((response: Response) =>
    response.url().endsWith(`/profiles/${companyId}/contact-requests`) && response.request().method() === "POST");
  await form.getByRole("button", { name: "Enviar solicitud" }).click();
  const response = await created;
  const raw = await response.text();
  expect(response.status(), raw).toBe(201);
  expectNoContact(raw, forbidden, "respuesta cruda del envío");

  await expect(page.getByRole("heading", { name: `Solicitud enviada a ${targetName}` })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Queda pendiente hasta que el perfil responda" })).toBeVisible();
  return (JSON.parse(raw) as { data: { id: string } }).data.id;
}

/** Abre la bandeja desde el menú lateral, como lo haría la persona usuaria. */
async function openInbox(page: Page, profileId: string, userName: string, tab: "Enviadas" | "Recibidas"): Promise<void> {
  await openHydrated(page, `/app?profile=${profileId}`, userName);
  await page.getByRole("complementary", { name: "Navegación del perfil" }).getByRole("link", { name: "Solicitudes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/requests\\?profile=${profileId}$`), NAVIGATION);
  await expect(page.getByRole("heading", { level: 1, name: "Solicitudes" })).toBeVisible();
  await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab")).toHaveCount(1);
}

test("T18 match por la UI: envío, bandejas, aceptar/rechazar/cancelar y contacto bajo demanda", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(1_200_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T18 ${crypto.randomUUID().slice(0, 6)}`;
  const password = `T18-${crypto.randomUUID()}-Aa9!`;
  const users = {
    company: { name: "Empresa T18", email: `t18-company-${suffix}@example.test` },
    guide1: { name: "Guía Uno T18", email: `t18-guide1-${suffix}@example.test` },
    guide2: { name: "Guía Dos T18", email: `t18-guide2-${suffix}@example.test` },
    guide3: { name: "Guía Tres T18", email: `t18-guide3-${suffix}@example.test` },
    admin: { name: "Admin T18", email: `t18-admin-${suffix}@example.test` },
  };
  const companyName = `Empresa Solicitante ${tag}`;
  const guide1Name = `Guía Aceptante ${tag}`;
  const guide2Name = `Guía Rechazante ${tag}`;
  const guide3Name = `Guía Cancelada ${tag}`;
  const companyContact: Contact = { email: `t18-contacto-empresa-${suffix}@example.test`, phone: fakePhone() };
  const guide1Contact: Contact = { email: `t18-contacto-guia1-${suffix}@example.test`, phone: fakePhone() };
  const guide2Contact: Contact = { email: `t18-contacto-guia2-${suffix}@example.test`, phone: fakePhone() };
  const guide3Contact: Contact = { email: `t18-contacto-guia3-${suffix}@example.test`, phone: fakePhone() };
  const companyNeedles = [...contactNeedles(companyContact.email, companyContact.phone), users.company.email];
  const guide1Needles = [...contactNeedles(guide1Contact.email, guide1Contact.phone), users.guide1.email];
  const guide2Needles = [...contactNeedles(guide2Contact.email, guide2Contact.phone), users.guide2.email];
  const guide3Needles = [...contactNeedles(guide3Contact.email, guide3Contact.phone), users.guide3.email];
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const guide1Context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guide2Context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guide3Context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext();
  const guide1Page = await guide1Context.newPage();
  const guide2Page = await guide2Context.newPage();
  const guide3Page = await guide3Context.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Fixtures por la API real (BFF): empresa y tres guías completos y habilitados.
    await registerAndLogin(guide1Page, request, users.guide1.name, users.guide1.email, password);
    await warmRoutes(guide1Page, ["/app/requests", "/app/requests/01M00000000000000000000000", "/app/search", "/app/profiles/01M00000000000000000000000"]);
    const catalogs = (await expectApi(guide1Page, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
    const ushuaia = byName(catalogs.cities, "Ushuaia");
    const guide1Id = await createCompletedProfile(guide1Page, catalogs, {
      category: "guide",
      displayName: guide1Name,
      contactEmail: guide1Contact.email,
      phone: guide1Contact.phone,
      documentFilename: `credencial-guia1-t18-${suffix}.pdf`,
    });

    await registerAndLogin(guide2Page, request, users.guide2.name, users.guide2.email, password);
    const guide2Id = await createCompletedProfile(guide2Page, catalogs, {
      category: "guide",
      displayName: guide2Name,
      contactEmail: guide2Contact.email,
      phone: guide2Contact.phone,
      documentFilename: `credencial-guia2-t18-${suffix}.pdf`,
    });

    await registerAndLogin(guide3Page, request, users.guide3.name, users.guide3.email, password);
    const guide3Id = await createCompletedProfile(guide3Page, catalogs, {
      category: "guide",
      displayName: guide3Name,
      contactEmail: guide3Contact.email,
      phone: guide3Contact.phone,
      documentFilename: `credencial-guia3-t18-${suffix}.pdf`,
    });

    await registerAndLogin(page, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(page, catalogs, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: companyContact.email,
      phone: companyContact.phone,
      documentFilename: `registro-empresa-t18-${suffix}.pdf`,
    });

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    for (const profileId of [guide1Id, guide2Id, guide3Id, companyId]) await grantAccess(adminPage, profileId);

    // Rango de 3 días futuros dentro de un mismo mes, publicado por el guía 1.
    const tomorrow = addDays(businessToday(), 1);
    const d1 = addDays(tomorrow, 2).slice(0, 7) === tomorrow.slice(0, 7) ? tomorrow : `${addDays(tomorrow, 2).slice(0, 7)}-01`;
    const d3 = addDays(d1, 2);
    await publishDays(guide1Page, guide1Id, ushuaia.id, [d1, addDays(d1, 1), d3]);

    // 2. La empresa encuentra al guía 1 en el buscador, abre la ficha y envía la solicitud.
    await openHydrated(page, `/app/search?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: "Buscar profesionales" })).toBeVisible();
    await page.getByLabel("Categoría").selectOption("guide");
    await page.getByLabel("Nombre").fill(tag);
    await page.getByRole("button", { name: "Buscar perfiles" }).click();
    const guide1Card = page.getByRole("article", { name: guide1Name });
    await expect(guide1Card).toBeVisible();
    await guide1Card.getByRole("link", { name: `Ver ficha de ${guide1Name}` }).click();
    await expect(page).toHaveURL(`/app/profiles/${guide1Id}?profile=${companyId}`, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: guide1Name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Solicitar contacto" })).toBeVisible();

    const service1 = `Guiado bilingüe para un grupo de 12 personas en Ushuaia (${tag}).`;
    const request1 = await sendContactRequest(page, companyId, guide1Name, {
      service: service1,
      from: d1,
      to: d3,
      city: "Ushuaia",
    }, guide1Needles);
    expectNoContact(await page.content(), guide1Needles, "DOM tras el envío");

    await page.getByRole("link", { name: "Ver solicitud", exact: true }).click();
    await expect(page).toHaveURL(`/app/requests/${request1}?profile=${companyId}`, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1, name: `Solicitud a ${guide1Name}` })).toBeVisible();
    await expect(page.getByText("Estado: Pendiente")).toBeVisible();
    await expect(page.getByText(service1)).toBeVisible();
    await expect(page.getByText(/tenía disponibilidad publicada para todas las fechas pedidas/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver datos de contacto" })).toHaveCount(0);

    // 3. Antes de aceptar: sin contacto del guía en DOM, HTML SSR ni RSC (detalle y ficha).
    await expectPageWithoutContact(page, `/app/requests/${request1}?profile=${companyId}`, guide1Needles, "detalle pendiente (empresa)");

    await openInbox(page, companyId, users.company.name, "Enviadas");
    const sentRow1 = page.getByRole("article", { name: guide1Name, exact: true });
    await expect(sentRow1).toContainText("Estado: Pendiente");
    await expect(sentRow1).toContainText("Ushuaia");
    await expect(sentRow1).toContainText(/Vence el \d{2}\/\d{2}\/\d{4}/);
    expectNoContact(await page.content(), guide1Needles, "DOM de Enviadas");

    await openHydrated(page, `/app/profiles/${guide1Id}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: guide1Name })).toBeVisible();
    await expectPageWithoutContact(page, `/app/profiles/${guide1Id}?profile=${companyId}`, guide1Needles, "ficha del guía (empresa)");

    // 4. El guía la ve en Recibidas, abre el detalle (sin contacto de la empresa) y acepta.
    await openInbox(guide1Page, guide1Id, users.guide1.name, "Recibidas");
    const receivedRow1 = guide1Page.getByRole("article", { name: companyName, exact: true });
    await expect(receivedRow1).toContainText("Estado: Pendiente");
    expectNoContact(await guide1Page.content(), companyNeedles, "DOM de Recibidas");

    const guideDetail = guide1Page.waitForResponse((response: Response) =>
      response.url().endsWith(`/contact-requests/${request1}`) && response.request().method() === "GET");
    await receivedRow1.getByRole("link", { name: `Ver solicitud de ${companyName}` }).click();
    await expect(guide1Page).toHaveURL(`/app/requests/${request1}?profile=${guide1Id}`, NAVIGATION);
    expectNoContact(await (await guideDetail).text(), companyNeedles, "respuesta cruda del detalle (guía)");
    await expect(guide1Page.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    await expect(guide1Page.getByText("Estado: Pendiente")).toBeVisible();
    await expect(guide1Page.getByText(service1)).toBeVisible();
    await expectPageWithoutContact(guide1Page, `/app/requests/${request1}?profile=${guide1Id}`, companyNeedles, "detalle pendiente (guía)");

    await guide1Page.getByRole("button", { name: "Aceptar", exact: true }).click();
    const acceptDialog = guide1Page.getByRole("dialog", { name: "¿Aceptar la solicitud?" });
    await expect(acceptDialog).toBeVisible();
    await expect(acceptDialog).toContainText(`Solicitud de ${companyName}`);
    await expect(acceptDialog).toContainText("no reserva tu calendario ni confirma una contratación");
    await expect(acceptDialog.getByRole("button", { name: "Volver" })).toBeFocused();
    await acceptDialog.getByRole("button", { name: "Aceptar solicitud" }).click();
    await expect(acceptDialog).toBeHidden();
    await expect(guide1Page.getByText("Estado: Aceptada")).toBeVisible();
    await expect(guide1Page.getByRole("status").filter({ hasText: "Listo: la solicitud quedó aceptada." })).toBeVisible();
    await expect(guide1Page.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await expect(guide1Page.getByRole("button", { name: "Rechazar", exact: true })).toHaveCount(0);

    // 5a. El guía revela el contacto bajo demanda: antes del click no está en el DOM.
    expectNoContact(await guide1Page.content(), companyNeedles, "DOM aceptado antes de revelar (guía)");
    await guide1Page.getByRole("button", { name: "Ver datos de contacto" }).click();
    const companyCard = guide1Page.getByRole("article", { name: companyName, exact: true });
    await expect(companyCard).toContainText(companyContact.email);
    await expect(companyCard).toContainText(companyContact.phone);
    const guideOwnCard = guide1Page.getByRole("article", { name: "Tus datos declarados" });
    await expect(guideOwnCard).toContainText(guide1Contact.email);
    await expect(guideOwnCard).toContainText(guide1Contact.phone);
    await expect(companyCard.getByRole("link", { name: companyContact.email })).toHaveAttribute("href", `mailto:${companyContact.email}`);

    // 5b. La empresa ve "Aceptada"; el contacto del guía aparece solo tras el click.
    await openHydrated(page, `/app/requests/${request1}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: `Solicitud a ${guide1Name}` })).toBeVisible();
    await expect(page.getByText("Estado: Aceptada")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver datos de contacto" })).toBeVisible();
    await expectPageWithoutContact(page, `/app/requests/${request1}?profile=${companyId}`, guide1Needles, "detalle aceptado sin revelar (empresa)");

    const contactResponse = page.waitForResponse((response: Response) =>
      response.url().endsWith(`/contact-requests/${request1}/contact`) && response.request().method() === "GET");
    await page.getByRole("button", { name: "Ver datos de contacto" }).click();
    expect((await contactResponse).status()).toBe(200);
    const guideCard = page.getByRole("article", { name: guide1Name, exact: true });
    await expect(guideCard).toContainText(guide1Contact.email);
    await expect(guideCard).toContainText(guide1Contact.phone);
    const companyOwnCard = page.getByRole("article", { name: "Tus datos declarados" });
    await expect(companyOwnCard).toContainText(companyContact.email);
    await expect(companyOwnCard).toContainText(companyContact.phone);
    await expect(guideCard.getByRole("link", { name: guide1Contact.email })).toHaveAttribute("href", `mailto:${guide1Contact.email}`);
    // El contacto revelado del guía 1 nunca incluye datos de otros guías.
    expectNoContact(await page.content(), [...guide2Needles, ...guide3Needles], "detalle aceptado revelado");

    await fullPageEvidence(page, "t18-detalle-aceptada-contacto-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(guideCard).toContainText(guide1Contact.email);
    await assertNoHorizontalOverflow(page, 390, "detalle aceptado con contacto");
    await fullPageEvidence(page, "t18-detalle-aceptada-contacto-390.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Ocultar datos de contacto" }).click();
    await expect(page.getByRole("button", { name: "Ver datos de contacto" })).toBeVisible();
    expectNoContact(await page.content(), guide1Needles, "DOM tras ocultar el contacto");

    // 6. Rechazo: la empresa envía al guía 2, el guía 2 rechaza y no hay contacto.
    await openHydrated(page, `/app/profiles/${guide2Id}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: guide2Name })).toBeVisible();
    const service2 = `Recorrido histórico por el centro de Ushuaia (${tag}).`;
    const request2 = await sendContactRequest(page, companyId, guide2Name, { service: service2 }, guide2Needles);

    await openInbox(guide2Page, guide2Id, users.guide2.name, "Recibidas");
    const receivedRow2 = guide2Page.getByRole("article", { name: companyName, exact: true });
    await expect(receivedRow2).toContainText("Estado: Pendiente");
    await expect(receivedRow2).toContainText("Sin fechas indicadas");
    await receivedRow2.getByRole("link", { name: `Ver solicitud de ${companyName}` }).click();
    await expect(guide2Page).toHaveURL(`/app/requests/${request2}?profile=${guide2Id}`, NAVIGATION);
    await expect(guide2Page.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    await guide2Page.getByRole("button", { name: "Rechazar", exact: true }).click();
    const rejectDialog = guide2Page.getByRole("dialog", { name: "¿Rechazar la solicitud?" });
    await expect(rejectDialog).toBeVisible();
    await rejectDialog.getByRole("button", { name: "Rechazar solicitud" }).click();
    await expect(rejectDialog).toBeHidden();
    await expect(guide2Page.getByText("Estado: Rechazada")).toBeVisible();
    await expect(guide2Page.getByText(/ya no admite cambios/)).toBeVisible();
    await expect(guide2Page.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await expect(guide2Page.getByRole("button", { name: "Rechazar", exact: true })).toHaveCount(0);
    await expect(guide2Page.getByRole("button", { name: "Ver datos de contacto" })).toHaveCount(0);
    expectNoContact(await guide2Page.content(), companyNeedles, "DOM del rechazo (guía 2)");

    await openInbox(page, companyId, users.company.name, "Enviadas");
    await expect(page.getByRole("article", { name: guide2Name, exact: true })).toContainText("Estado: Rechazada");
    await page.getByRole("link", { name: `Ver solicitud a ${guide2Name}` }).click();
    await expect(page).toHaveURL(`/app/requests/${request2}?profile=${companyId}`, NAVIGATION);
    await expect(page.getByText("Estado: Rechazada")).toBeVisible();
    await expect(page.getByText(/ya no admite cambios\. No se comparten datos de contacto\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver datos de contacto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Datos de contacto" })).toHaveCount(0);
    await expectPageWithoutContact(page, `/app/requests/${request2}?profile=${companyId}`, guide2Needles, "detalle rechazado (empresa)");

    // 7. Cancelación: la empresa envía al guía 3 y la cancela desde el detalle.
    await openHydrated(page, `/app/profiles/${guide3Id}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: guide3Name })).toBeVisible();
    const service3 = `Excursión al Parque Nacional para 6 personas (${tag}).`;
    const request3 = await sendContactRequest(page, companyId, guide3Name, { service: service3 }, guide3Needles);
    await page.getByRole("link", { name: "Ver solicitud", exact: true }).click();
    await expect(page).toHaveURL(`/app/requests/${request3}?profile=${companyId}`, NAVIGATION);
    await expect(page.getByText("Estado: Pendiente")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar solicitud" }).click();
    const cancelDialog = page.getByRole("dialog", { name: "¿Cancelar la solicitud?" });
    await expect(cancelDialog).toBeVisible();
    await expect(cancelDialog).toContainText(`Solicitud a ${guide3Name}`);
    await cancelDialog.getByRole("button", { name: "Cancelar solicitud" }).click();
    await expect(cancelDialog).toBeHidden();
    await expect(page.getByText("Estado: Cancelada")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Listo: la solicitud quedó cancelada." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar solicitud" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ver datos de contacto" })).toHaveCount(0);

    await openInbox(guide3Page, guide3Id, users.guide3.name, "Recibidas");
    const receivedRow3 = guide3Page.getByRole("article", { name: companyName, exact: true });
    await expect(receivedRow3).toContainText("Estado: Cancelada");
    await receivedRow3.getByRole("link", { name: `Ver solicitud de ${companyName}` }).click();
    await expect(guide3Page).toHaveURL(`/app/requests/${request3}?profile=${guide3Id}`, NAVIGATION);
    await expect(guide3Page.getByText("Estado: Cancelada")).toBeVisible();
    await expect(guide3Page.getByText(/ya no admite cambios/)).toBeVisible();
    await expect(guide3Page.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await expect(guide3Page.getByRole("button", { name: "Rechazar", exact: true })).toHaveCount(0);
    await expect(guide3Page.getByRole("button", { name: "Ver datos de contacto" })).toHaveCount(0);
    expectNoContact(await guide3Page.content(), companyNeedles, "DOM de la cancelada (guía 3)");

    // 8. Un receptor no ve formulario ni CTA de envío en la ficha de otro perfil.
    await openHydrated(guide1Page, `/app/profiles/${guide2Id}?profile=${guide1Id}`, users.guide1.name);
    await expect(guide1Page.getByRole("heading", { level: 1, name: guide2Name })).toBeVisible();
    await expect(guide1Page.getByText(/Las solicitudes de contacto las inician las empresas turísticas/)).toBeVisible();
    await expect(guide1Page.getByRole("form", { name: "Solicitud de contacto" })).toHaveCount(0);
    await expect(guide1Page.getByRole("button", { name: /Enviar solicitud|Solicitar/ })).toHaveCount(0);
    await expect(guide1Page.getByRole("heading", { name: "Solicitar contacto" })).toHaveCount(0);
    expectNoContact(await guide1Page.content(), guide2Needles, "ficha del guía 2 vista por el guía 1");

    // 9. Evidencia: bandejas a 1440 y 390, sin overflow horizontal en móvil.
    await openInbox(page, companyId, users.company.name, "Enviadas");
    await expect(page.getByText("3 solicitudes cargadas")).toBeVisible();
    await expect(page.getByRole("article", { name: guide1Name, exact: true })).toContainText("Estado: Aceptada");
    await expect(page.getByRole("article", { name: guide2Name, exact: true })).toContainText("Estado: Rechazada");
    await expect(page.getByRole("article", { name: guide3Name, exact: true })).toContainText("Estado: Cancelada");
    expectNoContact(await page.content(), [...guide1Needles, ...guide2Needles, ...guide3Needles], "DOM de Enviadas final");
    await fullPageEvidence(page, "t18-enviadas-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("article", { name: guide1Name, exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page, 390, "Enviadas");
    await fullPageEvidence(page, "t18-enviadas-390.png");

    await openInbox(guide1Page, guide1Id, users.guide1.name, "Recibidas");
    await expect(guide1Page.getByText("1 solicitud cargada")).toBeVisible();
    await expect(guide1Page.getByRole("article", { name: companyName, exact: true })).toContainText("Estado: Aceptada");
    expectNoContact(await guide1Page.content(), companyNeedles, "DOM de Recibidas final");
    await fullPageEvidence(guide1Page, "t18-recibidas-1440.png");
    await guide1Page.setViewportSize({ width: 390, height: 844 });
    await expect(guide1Page.getByRole("article", { name: companyName, exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(guide1Page, 390, "Recibidas");
    await fullPageEvidence(guide1Page, "t18-recibidas-390.png");
  } finally {
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guide1Context.close();
    await guide2Context.close();
    await guide3Context.close();
    await adminContext.close();
  }
});
