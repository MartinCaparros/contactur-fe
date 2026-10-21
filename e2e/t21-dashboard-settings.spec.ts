import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Locator, type Page, type Response, type WebSocket } from "@playwright/test";

import { MAILPIT_URL, deleteMail, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t21/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Con el socket vivo no hay polling: si el KPI cambia sin recargar es por el evento.
 * El margen es por el host cargado (la re-consulta pasa por el BFF); la prueba de que
 * fue en vivo es el frame recibido por el websocket.
 */
const LIVE_TIMEOUT_MS = 45_000;
/** P27: la suspensión de la cuenta se refleja sin recargar en ~15 s. */
const SUSPENSION_TIMEOUT_MS = 15_000;

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
type Metric = Readonly<{ key: string; value: number }>;
type Frame = Readonly<{ at: number; direction: "in" | "out"; payload: string }>;
type DecodedFrame = Readonly<{ event: string | null; channel: string | null; data: unknown }>;
type MailAddress = Readonly<{ Address: string; Name?: string }>;
type MailSummary = Readonly<{ ID: string; Subject: string; To: readonly MailAddress[] | null }>;
type MailQuery = Readonly<{ to: string; subjectIncludes?: string }>;

/** Navegación cliente tras un click: margen extra porque el host de pruebas está muy cargado. */
const NAVIGATION = { timeout: 90_000 } as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t21/${filename}`, import.meta.url));
}

async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

function ulid(value: string | null | undefined): string {
  expect(value ?? "", "id público con forma de ULID").toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  return value as string;
}

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t21-[a-z0-9-]+@example\.test$/);
  return value;
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

/** Espera el fiber de React en un elemento: señal concreta de hidratación. */
async function waitForHydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    return element !== null && Object.keys(element).some((key) => key.startsWith("__react"));
  }, selector, { timeout: 60_000 });
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
  await waitForHydrated(page, '[role="dialog"] input');
  await registration.getByLabel("Nombre").fill(name);
  await registration.getByLabel("Email").fill(email);
  await registration.getByLabel("Contraseña", { exact: true }).fill(password);
  await registration.getByLabel("Confirmar contraseña").fill(password);
  await expect(registration.getByLabel("Nombre")).toHaveValue(name);
  await expect(registration.getByLabel("Email")).toHaveValue(email);
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

/** Copia de T18–T20: login con margen y una recarga si el shell no hidrató con el host saturado. */
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
    await page.reload();
    await expect(accountName).toBeVisible({ timeout: 90_000 });
  }
}

/** Llamada real a través del BFF, con las cookies y el CSRF de la app (setup y lecturas de control). */
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
  // Host saturado: GET/PUT/PATCH de setup son idempotentes y se reintentan ante 502+; POST no.
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
  documentFilename: string;
}>;

/** Alta completa por API: datos, cobertura, documento requerido, términos y finalización. */
async function createCompletedProfile(page: Page, catalogs: Catalogs, setup: ProfileSetup): Promise<string> {
  const ushuaia = byName(catalogs.cities, "Ushuaia");
  const created = await expectApi(page, "POST", "/api/backend/v1/profiles", {
    category: setup.category,
    display_name: setup.displayName,
  });
  const profileId = ulid((created.data as { id: string }).id);
  await expectApi(page, "PUT", `/api/backend/v1/profiles/${profileId}/cities`, { city_ids: [ushuaia.id] });
  const common = {
    display_name: setup.displayName,
    description: `Perfil de prueba T21 (${setup.category}).`,
    contact_email: setup.contactEmail,
    phone: `+54 9 2901 ${String(100_000 + Math.floor(Math.random() * 899_999))}`,
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

/** PUT admin del grant (copia de T19); devuelve la versión nueva para la siguiente edición. */
async function putAccess(adminPage: Page, profileId: string, expectedVersion: number, monthlyLimit: number, reason: string): Promise<number> {
  const response = await expectApi(adminPage, "PUT", `/api/backend/v1/admin/profiles/${profileId}/access`, {
    status: "active",
    starts_at: null,
    expires_at: null,
    city_limit: 3,
    monthly_contact_limit: monthlyLimit,
    gallery_enabled: false,
    expected_version: expectedVersion,
    reason,
  });
  const version = (response.data as { grant: { version: number } | null }).grant?.version;
  expect(typeof version, "versión del grant en la respuesta").toBe("number");
  return version as number;
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

/** Marca en `window`: si sobrevive, la página no se recargó (un cambio "en vivo" de verdad). */
async function setReloadMarker(page: Page, value: string): Promise<void> {
  await page.evaluate((marker) => {
    (window as unknown as { __t21Marker?: string }).__t21Marker = marker;
  }, value);
}

async function reloadMarker(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __t21Marker?: string }).__t21Marker ?? null);
}

// --- KPIs ------------------------------------------------------------------------

function metricCard(page: Page, key: string): Locator {
  return page.locator(`[data-metric="${key}"]`);
}

/** Valor mostrado en la tarjeta (primer <dd>), como entero. */
async function cardValue(page: Page, key: string): Promise<number> {
  const text = (await metricCard(page, key).locator("dd").first().innerText()).trim();
  expect(text, `valor de la tarjeta ${key}`).toMatch(/^\d[\d.]*$/);
  return Number(text.replaceAll(".", ""));
}

/** Métricas que devuelve Laravel por el BFF para el perfil (fuente de verdad del tablero). */
async function apiMetrics(page: Page, profileId: string): Promise<Map<string, number>> {
  const body = await expectApi(page, "GET", `/api/backend/v1/profiles/${profileId}/dashboard`);
  const data = body.data as { profile_id: string; metrics: Metric[] };
  expect(data.profile_id).toBe(profileId);
  return new Map(data.metrics.map((metric) => [metric.key, metric.value]));
}

/** Cada tarjeta visible coincide con la API y no hay tarjetas que la API no informa. */
async function expectCardsMatchApi(page: Page, profileId: string): Promise<Map<string, number>> {
  const metrics = await apiMetrics(page, profileId);
  await expect(page.locator("[data-metric]")).toHaveCount(metrics.size, { timeout: 60_000 });
  for (const [key, value] of metrics) {
    await expect(metricCard(page, key).locator("dd").first(), `tarjeta ${key}`).toHaveText(new Intl.NumberFormat("es-AR").format(value), { timeout: 30_000 });
  }
  return metrics;
}

// --- Websocket (copia reducida de T19) --------------------------------------------

function decodeFrame(payload: string): DecodedFrame {
  try {
    const outer = JSON.parse(payload) as { event?: unknown; channel?: unknown; data?: unknown };
    let data = outer.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // `data` puede ser texto plano.
      }
    }
    return {
      event: typeof outer.event === "string" ? outer.event : null,
      channel: typeof outer.channel === "string" ? outer.channel : null,
      data,
    };
  } catch {
    return { event: null, channel: null, data: null };
  }
}

/** Registra los frames del websocket de una pestaña (antes de navegar). */
function trackSocket(page: Page): Frame[] {
  const frames: Frame[] = [];
  page.on("websocket", (socket: WebSocket) => {
    const record = (direction: Frame["direction"]) => (frame: { payload: string | Buffer }) => {
      frames.push({ at: Date.now(), direction, payload: typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8") });
    };
    socket.on("framereceived", record("in"));
    socket.on("framesent", record("out"));
  });
  return frames;
}

function findFrame(frames: readonly Frame[], since: number, event: (name: string) => boolean, channel: string): Frame | undefined {
  return frames.find((frame) => {
    if (frame.direction !== "in" || frame.at < since) return false;
    const decoded = decodeFrame(frame.payload);
    return decoded.event !== null && event(decoded.event) && decoded.channel === channel;
  });
}

/** Espera la suscripción al canal privado del perfil: recién ahí "en vivo" es verificable. */
async function waitSubscribed(frames: readonly Frame[], profileId: string, since: number): Promise<void> {
  await expect.poll(
    () => findFrame(frames, since, (name) => name === "pusher_internal:subscription_succeeded", `private-profile.${profileId}`) !== undefined,
    { timeout: 60_000, intervals: [250] },
  ).toBe(true);
}

async function waitFrame(frames: readonly Frame[], profileId: string, since: number, suffix: string): Promise<void> {
  await expect.poll(
    () => findFrame(frames, since, (name) => name.endsWith(suffix), `private-profile.${profileId}`) !== undefined,
    { timeout: LIVE_TIMEOUT_MS, intervals: [250] },
  ).toBe(true);
}

// --- Mailpit (copia reducida de T19) ----------------------------------------------

function sameAddress(list: readonly MailAddress[] | null | undefined, address: string): boolean {
  return (list ?? []).some((entry) => entry.Address.toLowerCase() === address.toLowerCase());
}

async function mailsMatching(request: APIRequestContext, query: MailQuery): Promise<MailSummary[]> {
  const response = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=1000`);
  expect(response.ok(), "Mailpit /api/v1/messages").toBe(true);
  const messages = ((await response.json()) as { messages?: MailSummary[] }).messages ?? [];
  return messages.filter((mail) =>
    sameAddress(mail.To, query.to) && (query.subjectIncludes === undefined || mail.Subject.includes(query.subjectIncludes)));
}

async function waitForMessage(request: APIRequestContext, query: MailQuery, timeout = 90_000): Promise<MailSummary> {
  await expect.poll(async () => (await mailsMatching(request, query)).length, { timeout, intervals: [500] }).toBeGreaterThan(0);
  const [found] = await mailsMatching(request, query);
  if (!found) throw new Error(`Mailpit no tiene ${JSON.stringify(query)}`);
  return found;
}

test("T21 resumen y ajustes: KPIs reales, en vivo, cambio de email/contraseña y suspensión inmediata (P27)", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(1_500_000);
  const baseURL = testInfo.project.use.baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T21-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T21-${crypto.randomUUID()}-Aa9!`;
  const newPassword = `T21-nueva-${crypto.randomUUID()}-Bb8!`;
  const users = {
    guide: { name: "Guía T21", email: syntheticEmail(`t21-guide-${suffix}@example.test`) },
    company: { name: "Empresa T21", email: syntheticEmail(`t21-company-${suffix}@example.test`) },
    admin: { name: "Admin T21", email: syntheticEmail(`t21-admin-${suffix}@example.test`) },
  };
  const guideNewName = "Guía T21 Renombrada";
  const guideNewEmail = syntheticEmail(`t21-guide-new-${suffix}@example.test`);
  const guideName = `Guía Tablero ${tag}`;
  const companyName = `Empresa Tablero ${tag}`;
  let promoted = false;
  let companyUserId: string | null = null;
  let companySuspended = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const guideContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guidePage = await guideContext.newPage();
  const companyPage = await companyContext.newPage();
  const adminPage = await adminContext.newPage();
  const guideFrames = trackSocket(guidePage);
  const companyFrames = trackSocket(companyPage);

  try {
    // 1. Fixtures por la API real (BFF con CSRF): guía y empresa completos y habilitados.
    await registerAndLogin(guidePage, request, users.guide.name, users.guide.email, password);
    const catalogs = (await expectApi(guidePage, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
    const ushuaia = byName(catalogs.cities, "Ushuaia");
    const guideId = await createCompletedProfile(guidePage, catalogs, {
      category: "guide",
      displayName: guideName,
      contactEmail: `t21-contacto-guia-${suffix}@example.test`,
      documentFilename: `credencial-guia-t21-${suffix}.pdf`,
    });
    await registerAndLogin(companyPage, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(companyPage, catalogs, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: `t21-contacto-empresa-${suffix}@example.test`,
      documentFilename: `registro-empresa-t21-${suffix}.pdf`,
    });

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    const guideVersion = await putAccess(adminPage, guideId, 0, 10, "Demo T21: habilitación del guía.");
    await putAccess(adminPage, companyId, 0, 10, "Demo T21: habilitación de la empresa.");

    // El guía publica 3 días futuros del mismo mes (desde mañana); la empresa le escribe una vez.
    const tomorrow = addDays(businessToday(), 1);
    const d1 = addDays(tomorrow, 2).slice(0, 7) === tomorrow.slice(0, 7) ? tomorrow : `${addDays(tomorrow, 2).slice(0, 7)}-01`;
    await publishDays(guidePage, guideId, ushuaia.id, [d1, addDays(d1, 1), addDays(d1, 2)]);
    const created = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests`, {
      target_profile_id: guideId,
      service_description: `Guiado en Ushuaia para 8 personas (${tag}).`,
    });
    const requestId = ulid((created.data as { id: string }).id);

    // 2. KPIs del guía: valores reales, iguales a GET /dashboard (Laravel) por el BFF.
    let since = Date.now();
    await openHydrated(guidePage, `/app?profile=${guideId}`, users.guide.name);
    await expect(guidePage.getByRole("heading", { level: 2, name: "Indicadores del perfil" })).toBeVisible();
    const guideMetrics = await expectCardsMatchApi(guidePage, guideId);
    expect(guideMetrics.get("pending_contact_requests")).toBe(1);
    expect(guideMetrics.get("available_future_days")).toBe(3);
    expect(guideMetrics.get("visible_references")).toBe(0);
    const unreadBefore = guideMetrics.get("unread_notifications") ?? 0;
    expect(unreadBefore, "el guía tiene al menos la solicitud recibida sin leer").toBeGreaterThanOrEqual(1);
    await expect(metricCard(guidePage, "available_future_days")).toContainText("Días disponibles a futuro");
    await expect(metricCard(guidePage, "pending_contact_requests")).toContainText("Solicitudes pendientes");
    await expect(metricCard(guidePage, "unread_notifications")).toContainText("Notificaciones sin leer");
    await expect(metricCard(guidePage, "visible_references")).toContainText("Referencias publicadas");
    await fullPageEvidence(guidePage, "t21-resumen-guia-1440.png");

    // 3. En vivo: el admin edita el grant del guía → notification.created → el KPI sube sin recargar.
    await waitSubscribed(guideFrames, guideId, since);
    await setReloadMarker(guidePage, tag);
    since = Date.now();
    await putAccess(adminPage, guideId, guideVersion, 12, `Demo T21 ${tag}: ajuste del cupo mensual.`);
    await waitFrame(guideFrames, guideId, since, "notification.created");
    await expect.poll(() => cardValue(guidePage, "unread_notifications"), { timeout: LIVE_TIMEOUT_MS, intervals: [500] })
      .toBeGreaterThan(unreadBefore);
    expect(await reloadMarker(guidePage), "el KPI cambió sin recargar la página").toBe(tag);
    const unreadAfter = (await apiMetrics(guidePage, guideId)).get("unread_notifications");
    expect(await cardValue(guidePage, "unread_notifications")).toBe(unreadAfter);

    // Cada tarjeta enlaza a su vista; "Ver solicitudes pendientes" lleva al filtro con la solicitud.
    await expect(metricCard(guidePage, "available_future_days").getByRole("link", { name: "Ver disponibilidad" }))
      .toHaveAttribute("href", `/app/availability?profile=${guideId}`);
    await expect(metricCard(guidePage, "unread_notifications").getByRole("link", { name: "Ver notificaciones sin leer" }))
      .toHaveAttribute("href", `/app/notifications?profile=${guideId}&unread=true`);
    await expect(metricCard(guidePage, "visible_references").getByRole("link", { name: "Ver referencias recibidas" }))
      .toHaveAttribute("href", new RegExp(`^/app/references\\?profile=${guideId}(&direction=received)?$`));
    await metricCard(guidePage, "pending_contact_requests").getByRole("link", { name: "Ver solicitudes pendientes" }).click();
    await expect(guidePage).toHaveURL(new RegExp(`/app/requests\\?profile=${guideId}&status=pending$`), NAVIGATION);
    await expect(guidePage.getByRole("heading", { level: 1, name: "Solicitudes" })).toBeVisible();
    await expect(guidePage.getByLabel("Estado", { exact: true })).toHaveValue("pending");
    const pendingRow = guidePage.getByRole("article", { name: companyName, exact: true });
    await expect(pendingRow).toBeVisible({ timeout: 60_000 });
    await expect(pendingRow).toContainText("Estado: Pendiente");
    await expect(pendingRow.getByRole("link", { name: `Ver solicitud de ${companyName}` }))
      .toHaveAttribute("href", `/app/requests/${requestId}?profile=${guideId}`);

    // KPIs de la empresa: pendiente 1 y SIN tarjeta de días disponibles (la API la omite).
    await openHydrated(companyPage, `/app?profile=${companyId}`, users.company.name);
    const companyMetrics = await expectCardsMatchApi(companyPage, companyId);
    expect(companyMetrics.get("pending_contact_requests")).toBe(1);
    expect(companyMetrics.has("available_future_days")).toBe(false);
    await expect(metricCard(companyPage, "available_future_days")).toHaveCount(0);
    await expect(companyPage.getByText("Días disponibles a futuro")).toHaveCount(0);
    // A ≤640 px el header oculta el nombre de cuenta: se hidrata a 1440 y se pasa a 390.
    await companyPage.setViewportSize({ width: 390, height: 844 });
    await expect(metricCard(companyPage, "pending_contact_requests")).toBeVisible();
    await assertNoHorizontalOverflow(companyPage, 390, "resumen de la empresa");
    await fullPageEvidence(companyPage, "t21-resumen-empresa-390.png");
    await companyPage.setViewportSize({ width: 1440, height: 1000 });

    // 4. Ajustes del guía desde el menú: nombre → header.
    await openHydrated(guidePage, `/app?profile=${guideId}`, users.guide.name);
    await guidePage.getByRole("complementary", { name: "Navegación del perfil" }).getByRole("link", { name: "Ajustes", exact: true }).click();
    await expect(guidePage).toHaveURL(/\/app\/settings(\?profile=[0-9A-Z]{26})?$/, NAVIGATION);
    await expect(guidePage.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    const accountForm = guidePage.getByRole("form", { name: "Datos de la cuenta" });
    await accountForm.getByLabel("Nombre").fill(guideNewName);
    await expect(accountForm.getByLabel("Nombre")).toHaveValue(guideNewName);
    await accountForm.getByRole("button", { name: "Guardar nombre" }).click();
    await expect(accountForm.getByRole("status")).toHaveText("Guardamos el nombre de tu cuenta.");
    await expect(guidePage.locator("header").getByText(guideNewName, { exact: true })).toBeVisible();
    await expect(guidePage.locator("header").getByText(users.guide.name, { exact: true })).toHaveCount(0);

    // Email: 202 con la contraseña actual; el enlace llega al email NUEVO.
    const emailForm = guidePage.getByRole("form", { name: "Cambiar email" });
    await emailForm.getByLabel("Nuevo email").fill(guideNewEmail);
    await emailForm.getByLabel("Contraseña actual").fill(password);
    await expect(emailForm.getByLabel("Nuevo email")).toHaveValue(guideNewEmail);
    await expect(emailForm.getByLabel("Contraseña actual")).toHaveValue(password);
    const emailRequested = guidePage.waitForResponse((response: Response) =>
      response.url().endsWith("/api/backend/v1/me/change-email") && response.request().method() === "POST");
    await emailForm.getByRole("button", { name: "Enviar enlace de confirmación" }).click();
    const emailResponse = await emailRequested;
    expect(emailResponse.status(), await emailResponse.text()).toBe(202);
    await expect(emailForm.getByRole("status")).toHaveText(
      `Te enviamos un enlace a ${guideNewEmail} para confirmar el cambio. Hasta entonces seguís usando ${users.guide.email}.`);
    await fullPageEvidence(guidePage, "t21-ajustes-1440.png");

    const changeMail = await waitForMail(request, guideNewEmail, "verify-email");
    const verifySubject = await waitForMessage(request, { to: guideNewEmail, subjectIncludes: "Verificá tu nuevo email" });
    expect(verifySubject.ID).toBe(changeMail.id);
    // El enlace se abre como desde el cliente de correo: pestaña nueva sin sesión.
    const mailContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const mailPage = await mailContext.newPage();
      await mailPage.goto(changeMail.link);
      const verification = mailPage.getByRole("dialog", { name: "Verificar correo" });
      await expect(verification).toBeVisible({ timeout: 30_000 });
      await expect(verification.getByText(/tu correo quedó verificado/i)).toBeVisible({ timeout: 30_000 });
    } finally {
      await mailContext.close();
    }
    await deleteMail(request, changeMail.id);
    // Aviso de seguridad al email ANTERIOR.
    await waitForMessage(request, { to: users.guide.email, subjectIncludes: "El email de tu cuenta cambió" });
    const me = await expectApi(guidePage, "GET", "/api/backend/v1/me");
    expect((me.data as { user: { email: string; name: string } }).user).toMatchObject({ email: guideNewEmail, name: guideNewName });
    await openHydrated(guidePage, "/app/settings", guideNewName);
    await expect(guidePage.getByRole("region", { name: "Datos de la cuenta" })).toContainText(guideNewEmail);

    // Contraseña: éxito → todas las sesiones revocadas → `/?auth=login`.
    const staleCookies = await guideContext.cookies();
    const passwordForm = guidePage.getByRole("form", { name: "Cambiar contraseña" });
    await passwordForm.getByLabel("Contraseña actual").fill(password);
    await passwordForm.getByLabel("Nueva contraseña", { exact: true }).fill(newPassword);
    await passwordForm.getByLabel("Repetí la nueva contraseña").fill(newPassword);
    await expect(passwordForm.getByLabel("Nueva contraseña", { exact: true })).toHaveValue(newPassword);
    await expect(passwordForm.getByLabel("Repetí la nueva contraseña")).toHaveValue(newPassword);
    // El logout local se retiene hasta leer el mensaje: después de él la página redirige.
    let releaseLogout: () => void = () => undefined;
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });
    await guidePage.route("**/api/auth/logout", async (route) => {
      await logoutGate;
      await route.continue();
    });
    const passwordChanged = guidePage.waitForResponse((response: Response) =>
      response.url().endsWith("/api/backend/v1/me/change-password") && response.request().method() === "POST");
    await passwordForm.getByRole("button", { name: "Cambiar contraseña" }).click();
    const passwordResponse = await passwordChanged;
    expect(passwordResponse.status(), await passwordResponse.text()).toBe(200);
    await expect(passwordForm.getByRole("status")).toContainText(
      "Actualizamos tu contraseña. Por seguridad cerramos todas tus sesiones, incluida esta.");
    releaseLogout();
    await expect(guidePage).toHaveURL(/\/\?auth=login$/, NAVIGATION);
    await guidePage.unroute("**/api/auth/logout");

    // La sesión vieja (cookies previas al cambio) ya no sirve: 401 por el BFF.
    const staleContext = await browser.newContext();
    try {
      await staleContext.addCookies(staleCookies);
      const stale = await staleContext.request.get(new URL("/api/backend/v1/me", baseURL).href);
      expect(stale.status(), "GET /me con la sesión anterior al cambio de contraseña").toBe(401);
    } finally {
      await staleContext.close();
    }

    // Login con el email NUEVO y la contraseña NUEVA → /app.
    await loginHydrated(guidePage, guideNewEmail, newPassword, guideNewName);
    // El shell agrega `?profile=` del perfil activo tras hidratar.
    await expect(guidePage).toHaveURL(/\/app(\?profile=[0-9A-Z]{26})?$/);
    await expect(guidePage.locator("header").getByText(guideNewName, { exact: true })).toBeVisible();

    // 5. Suspensión inmediata (P27): la empresa tiene el resumen abierto.
    since = Date.now();
    await openHydrated(companyPage, `/app?profile=${companyId}`, users.company.name);
    await expect(metricCard(companyPage, "pending_contact_requests")).toBeVisible({ timeout: 60_000 });
    await waitSubscribed(companyFrames, companyId, since);
    const listed = await expectApi(adminPage, "GET", `/api/backend/v1/admin/users?q=${encodeURIComponent(users.company.email)}`);
    const companyUser = (listed.data as { id: string; email: string }[]).find((user) => user.email === users.company.email);
    companyUserId = ulid(companyUser?.id);
    await setReloadMarker(companyPage, tag);
    const suspendedAt = Date.now();
    await expectApi(adminPage, "PATCH", `/api/backend/v1/admin/users/${companyUserId}/status`, {
      status: "suspended",
      reason: `Suspensión de prueba T21 ${tag}.`,
    });
    companySuspended = true;
    const restricted = companyPage.getByRole("heading", { level: 1, name: "Tu navegación está restringida" });
    await expect(restricted).toBeVisible({ timeout: SUSPENSION_TIMEOUT_MS });
    const elapsed = Date.now() - suspendedAt;
    console.log(`[T21] vista restringida ${elapsed} ms después del PATCH de suspensión`);
    await expect(companyPage.getByText("Cuenta suspendida", { exact: true })).toBeVisible();
    expect(await reloadMarker(companyPage), "la restricción llegó sin recargar la página").toBe(tag);
    expect(new URL(companyPage.url()).pathname).toBe("/app");
    await expect(companyPage.locator("[data-metric]")).toHaveCount(0);
    await expect(companyPage.getByRole("heading", { name: "Indicadores del perfil" })).toHaveCount(0);
    await expect(companyPage.getByLabel("Perfil activo")).toHaveCount(0);
    await expect(companyPage.getByRole("complementary", { name: "Navegación del perfil" })).toHaveCount(0);
    await expect(companyPage.getByRole("link", { name: "Contactar soporte" })).toBeVisible();
    await expect(companyPage.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    await fullPageEvidence(companyPage, "t21-cuenta-suspendida-1440.png");

    // Reactivación para dejar la cuenta como estaba.
    const reactivated = await expectApi(adminPage, "PATCH", `/api/backend/v1/admin/users/${companyUserId}/status`, {
      status: "active",
      reason: `Reactivación de prueba T21 ${tag}.`,
    });
    expect((reactivated.data as { status: string }).status).toBe("active");
    companySuspended = false;
  } finally {
    if (companySuspended && companyUserId) {
      await api(adminPage, "PATCH", `/api/backend/v1/admin/users/${companyUserId}/status`, {
        status: "active",
        reason: "Reactivación tras un fallo del spec T21.",
      }).catch(() => undefined);
    }
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideContext.close();
    await companyContext.close();
    await adminContext.close();
  }
});
