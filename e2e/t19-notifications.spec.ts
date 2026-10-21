import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Locator, type Page, type Response, type WebSocket } from "@playwright/test";

import { MAILPIT_URL, deleteMail, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t19/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SUPPORT_EMAIL = "soporte@contactur.test";

/**
 * Con el socket vivo no hay polling: si el ítem aparece sin recargar es por el evento.
 * El margen es por el host cargado (el refetch de la lista pasa por el BFF); la prueba
 * de que fue en vivo es el frame `notification.created` recibido por el websocket.
 */
const LIVE_TIMEOUT_MS = 45_000;
/** Ventana para afirmar que un correo NO llega (el worker procesa en ~1–3 s en reposo). */
const NO_MAIL_WINDOW_MS = 15_000;

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
type Frame = Readonly<{ at: number; direction: "in" | "out"; payload: string }>;
type DecodedFrame = Readonly<{ event: string | null; channel: string | null; data: unknown }>;
type MailAddress = Readonly<{ Address: string; Name?: string }>;
type MailSummary = Readonly<{
  ID: string;
  Subject: string;
  To: readonly MailAddress[] | null;
  ReplyTo?: readonly MailAddress[] | null;
}>;
type MailDetail = MailSummary & Readonly<{ Text: string; HTML: string; body: string }>;
type MailQuery = Readonly<{ to: string; subjectIncludes?: string; replyTo?: string }>;
type Sent = Readonly<{ id: string; clickedAt: number; respondedAt: number }>;

/** Navegación cliente tras un click: margen extra porque el host de pruebas está muy cargado. */
const NAVIGATION = { timeout: 90_000 } as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t19/${filename}`, import.meta.url));
}

async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/** Consulta de solo lectura a Postgres. Los valores interpolados se validan antes (ULID/email sintético). */
async function sql(query: string): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "postgres", "sh", "-c", 'psql -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', "psql", query],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
  return stdout.trim();
}

function ulid(value: string | null): string {
  expect(value ?? "", "id público con forma de ULID").toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  return value as string;
}

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t19-[a-z0-9-]+@example\.test$/);
  return value;
}

async function emailStatus(notificationId: string): Promise<string> {
  return sql(`SELECT email_status FROM profile_notifications WHERE public_id = '${ulid(notificationId)}'`);
}

/** Resetea el rate limit del formulario público (claves md5 por IP; ver el script). */
async function clearSupportLimiter(): Promise<void> {
  await run("./scripts/dev/clear-support-limiter.sh", [], { cwd: REPO_ROOT, timeout: 120_000 });
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

/** Copia de T18: login con margen y una recarga si el shell no hidrató con el host saturado. */
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

/** Setup por la API real a través del BFF, con las cookies y el CSRF de la app. Solo fixtures. */
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
    description: `Perfil de prueba T19 (${setup.category}).`,
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

/** PUT admin del grant; devuelve la versión nueva (la siguiente edición la manda como expected_version). */
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

function fakePhone(): string {
  return `+54 9 2901 ${String(100_000 + Math.floor(Math.random() * 899_999))}`;
}

/** Completa y envía el formulario de la ficha (UI). Devuelve id e instantes de click y de 201. */
async function sendContactRequest(
  page: Page,
  recipientName: string,
  service: string,
  forbidden: readonly string[],
): Promise<Sent> {
  const form = page.getByRole("form", { name: "Solicitud de contacto" });
  await expect(form).toBeVisible();
  await form.getByLabel("Servicio solicitado").fill(service);
  await expect(form.getByLabel("Servicio solicitado")).toHaveValue(service);
  const created = page.waitForResponse((response: Response) =>
    /\/profiles\/[0-9A-Z]{26}\/contact-requests$/.test(response.url()) && response.request().method() === "POST");
  const clickedAt = Date.now();
  await form.getByRole("button", { name: "Enviar solicitud" }).click();
  const response = await created;
  const respondedAt = Date.now();
  const raw = await response.text();
  expect(response.status(), raw).toBe(201);
  expectNoContact(raw, forbidden, "respuesta cruda del envío");
  await expect(page.getByRole("heading", { name: `Solicitud enviada a ${recipientName}` })).toBeVisible();
  return { id: ulid((JSON.parse(raw) as { data: { id: string } }).data.id), clickedAt, respondedAt };
}

/** Confirma Aceptar/Rechazar en el detalle (UI) y devuelve el instante de la respuesta del backend. */
async function decide(page: Page, requestId: string, action: "Aceptar" | "Rechazar"): Promise<number> {
  await page.getByRole("button", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `¿${action} la solicitud?` });
  await expect(dialog).toBeVisible();
  const decided = page.waitForResponse((response: Response) =>
    response.url().includes(`/contact-requests/${requestId}`) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: `${action} solicitud` }).click();
  const response = await decided;
  const at = Date.now();
  expect(response.status(), await response.text()).toBeLessThan(300);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(action === "Aceptar" ? "Estado: Aceptada" : "Estado: Rechazada")).toBeVisible();
  return at;
}

// --- Websocket -------------------------------------------------------------------

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

/** Frame `notification.created` del perfil recibido después de `since`; el payload solo trae ids. */
async function notificationFrame(frames: readonly Frame[], profileId: string, since: number, forbidden: readonly string[]): Promise<Frame> {
  const lookup = () => findFrame(frames, since, (name) => name.endsWith("notification.created"), `private-profile.${profileId}`);
  await expect.poll(() => lookup() !== undefined, { timeout: LIVE_TIMEOUT_MS, intervals: [250] }).toBe(true);
  const frame = lookup();
  if (!frame) throw new Error(`Sin frame notification.created para ${profileId}`);
  expectNoContact(frame.payload, forbidden, "frame notification.created");
  return frame;
}

/** Arranca antes de la acción y devuelve el instante en que el locator quedó visible. */
function seenAt(locator: Locator): Promise<number> {
  return expect(locator).toBeVisible({ timeout: LIVE_TIMEOUT_MS }).then(() => Date.now());
}

// --- Mailpit ---------------------------------------------------------------------

function sameAddress(list: readonly MailAddress[] | null | undefined, address: string): boolean {
  return (list ?? []).some((entry) => entry.Address.toLowerCase() === address.toLowerCase());
}

async function listMail(request: APIRequestContext): Promise<MailSummary[]> {
  const response = await request.get(`${MAILPIT_URL}/api/v1/messages?limit=1000`);
  expect(response.ok(), "Mailpit /api/v1/messages").toBe(true);
  return ((await response.json()) as { messages?: MailSummary[] }).messages ?? [];
}

async function mailsMatching(request: APIRequestContext, query: MailQuery): Promise<MailSummary[]> {
  return (await listMail(request)).filter((mail) =>
    sameAddress(mail.To, query.to) &&
    (query.subjectIncludes === undefined || mail.Subject.includes(query.subjectIncludes)) &&
    (query.replyTo === undefined || sameAddress(mail.ReplyTo, query.replyTo)));
}

async function readMail(request: APIRequestContext, id: string): Promise<MailDetail> {
  const response = await request.get(`${MAILPIT_URL}/api/v1/message/${encodeURIComponent(id)}`);
  expect(response.ok(), `Mailpit /api/v1/message/${id}`).toBe(true);
  const detail = (await response.json()) as Omit<MailDetail, "body">;
  // Blade escapa `&` también en la vista de texto; se normaliza para leer el link.
  const body = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.replace(/=\r?\n/g, "").replaceAll("&amp;", "&");
  return { ...detail, body };
}

async function waitForMessage(request: APIRequestContext, query: MailQuery, timeout = 90_000): Promise<MailDetail> {
  await expect.poll(async () => (await mailsMatching(request, query)).length, { timeout, intervals: [500] }).toBeGreaterThan(0);
  const [found] = await mailsMatching(request, query);
  if (!found) throw new Error(`Mailpit no tiene ${JSON.stringify(query)}`);
  return readMail(request, found.ID);
}

/** Durante toda la ventana no aparece ningún correo que matchee. */
async function noMessage(request: APIRequestContext, query: MailQuery, windowMs = NO_MAIL_WINDOW_MS): Promise<void> {
  const deadline = Date.now() + windowMs;
  do {
    expect(await mailsMatching(request, query), `correo inesperado: ${JSON.stringify(query)}`).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  expect(await mailsMatching(request, query), `correo inesperado: ${JSON.stringify(query)}`).toHaveLength(0);
}

/** Vacía el buzón de una dirección (API v1 de Mailpit: DELETE /messages con IDs). */
async function purgeMailTo(request: APIRequestContext, to: string): Promise<void> {
  const ids = (await mailsMatching(request, { to })).map((mail) => mail.ID);
  if (ids.length > 0) {
    const response = await request.delete(`${MAILPIT_URL}/api/v1/messages`, { data: { IDs: ids } });
    expect(response.ok(), "Mailpit DELETE /api/v1/messages").toBe(true);
  }
  expect(await mailsMatching(request, { to })).toHaveLength(0);
}

/** Link de login del correo, reescrito al servidor de la corrida como hace support/mailpit.ts. */
function loginLink(body: string): URL {
  const match = body.match(/https?:\/\/[^\s<>"']+\/\?auth=login&returnTo=[^\s<>"']+/);
  if (!match) throw new Error("El correo no trae el link de login con returnTo");
  const url = new URL(match[0]);
  const target = process.env.PLAYWRIGHT_BASE_URL;
  if (target) {
    const base = new URL(target);
    url.protocol = base.protocol;
    url.host = base.host;
  }
  return url;
}

// --- Notificaciones ----------------------------------------------------------------

function notificationItem(page: Page, title: string): Locator {
  return page.getByRole("article", { name: title, exact: true });
}

function notificationsLink(page: Page): Locator {
  return page.getByRole("complementary", { name: "Navegación del perfil" }).getByRole("link", { name: /^Notificaciones/ });
}

async function titleCounts(page: Page): Promise<Record<string, number>> {
  const titles = await page.locator("article[data-notification-id] h2").allTextContents();
  return titles.reduce<Record<string, number>>((counts, title) => ({ ...counts, [title]: (counts[title] ?? 0) + 1 }), {});
}

/** P26 visible: cada evento una sola vez, por id público y por título. */
async function expectEachOnce(page: Page, expected: Readonly<Record<string, number>>, where: string): Promise<void> {
  const total = Object.values(expected).reduce((sum, value) => sum + value, 0);
  await expect(page.locator("article[data-notification-id]")).toHaveCount(total);
  const ids = await page.locator("article[data-notification-id]").evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-notification-id") ?? ""));
  expect(new Set(ids).size, `ids repetidos en ${where}: ${ids.join(", ")}`).toBe(ids.length);
  expect(await titleCounts(page), `títulos en ${where}`).toEqual(expected);
}

test("T19 notificaciones: centro en vivo, insignia, correos según preferencias y esenciales", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(1_500_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T19 ${crypto.randomUUID().slice(0, 6)}`;
  const password = `T19-${crypto.randomUUID()}-Aa9!`;
  const users = {
    company: { name: "Empresa T19", email: syntheticEmail(`t19-company-${suffix}@example.test`) },
    guideA: { name: "Guía A T19", email: syntheticEmail(`t19-guide-a-${suffix}@example.test`) },
    guideB: { name: "Guía B T19", email: syntheticEmail(`t19-guide-b-${suffix}@example.test`) },
    admin: { name: "Admin T19", email: syntheticEmail(`t19-admin-${suffix}@example.test`) },
  };
  const companyName = `Empresa Avisos ${tag}`;
  const guideAName = `Guía Avisada ${tag}`;
  const guideBName = `Guía Rechazante ${tag}`;
  const companyContact: Contact = { email: `t19-contacto-empresa-${suffix}@example.test`, phone: fakePhone() };
  const guideAContact: Contact = { email: `t19-contacto-guia-a-${suffix}@example.test`, phone: fakePhone() };
  const guideBContact: Contact = { email: `t19-contacto-guia-b-${suffix}@example.test`, phone: fakePhone() };
  const companyNeedles = [...contactNeedles(companyContact.email, companyContact.phone), users.company.email];
  const guideANeedles = [...contactNeedles(guideAContact.email, guideAContact.phone), users.guideA.email];
  const guideBNeedles = [...contactNeedles(guideBContact.email, guideBContact.phone), users.guideB.email];
  const frameNeedles = [tag, companyName, guideAName, guideBName, ...companyNeedles, ...guideANeedles, ...guideBNeedles];
  const measurements: string[] = [];
  const measure = (label: string, ms: number) => {
    const line = `[T19] ${label}: ${ms} ms`;
    measurements.push(line);
    console.log(line);
  };
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const guideAContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guideBContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext();
  const guideAPage = await guideAContext.newPage();
  const guideBPage = await guideBContext.newPage();
  const adminPage = await adminContext.newPage();
  const companyFrames = trackSocket(page);
  const guideAFrames = trackSocket(guideAPage);

  try {
    // 1. Fixtures por la API real (BFF): empresa y dos guías completos y habilitados.
    await registerAndLogin(guideAPage, request, users.guideA.name, users.guideA.email, password);
    const catalogs = (await expectApi(guideAPage, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
    const guideAId = ulid(await createCompletedProfile(guideAPage, catalogs, {
      category: "guide",
      displayName: guideAName,
      contactEmail: guideAContact.email,
      phone: guideAContact.phone,
      documentFilename: `credencial-guia-a-t19-${suffix}.pdf`,
    }));
    await registerAndLogin(guideBPage, request, users.guideB.name, users.guideB.email, password);
    const guideBId = ulid(await createCompletedProfile(guideBPage, catalogs, {
      category: "guide",
      displayName: guideBName,
      contactEmail: guideBContact.email,
      phone: guideBContact.phone,
      documentFilename: `credencial-guia-b-t19-${suffix}.pdf`,
    }));
    await registerAndLogin(page, request, users.company.name, users.company.email, password);
    const companyId = ulid(await createCompletedProfile(page, catalogs, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: companyContact.email,
      phone: companyContact.phone,
      documentFilename: `registro-empresa-t19-${suffix}.pdf`,
    }));

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    const grantReason = "Demo T19: habilitación para notificaciones.";
    const guideAVersion = await putAccess(adminPage, guideAId, 0, 10, grantReason);
    await putAccess(adminPage, guideBId, 0, 10, grantReason);
    await putAccess(adminPage, companyId, 0, 10, grantReason);

    // 1b. Bienvenida: in-app ("Cuenta") en el centro de la empresa y sin correo propio.
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: "Notificaciones" })).toBeVisible();
    const welcome = notificationItem(page, "Te damos la bienvenida a Contactur");
    await expect(welcome).toHaveCount(1);
    await expect(welcome).toContainText("Cuenta");
    // El aviso de acceso del setup sale por el worker después del de verificación: si ya
    // llegó, la cola pasó por los correos del registro.
    await waitForMessage(request, { to: users.company.email, subjectIncludes: "Cambios en tu acceso" });
    await waitForMessage(request, { to: users.company.email, subjectIncludes: "Email verificado" });
    const companySubjects = (await mailsMatching(request, { to: users.company.email })).map((mail) => mail.Subject);
    expect(companySubjects.filter((subject) => /bienvenid/i.test(subject)), "correo de bienvenida").toHaveLength(0);
    for (const subject of companySubjects) {
      expect(["Verificá tu email", "Email verificado", "Cambios en tu acceso"], `asunto inesperado: ${subject}`).toContain(subject);
    }
    expect(await sql(
      `SELECT string_agg(n.email_status, ',') FROM profile_notifications n JOIN users u ON u.id = n.user_id WHERE u.email = '${users.company.email}' AND n.type = 'welcome'`,
    ), "email_status de la bienvenida").toBe("not_applicable");

    // Buzones en cero para contar exacto desde acá (el aviso del setup ya llegó a cada uno).
    await waitForMessage(request, { to: users.guideA.email, subjectIncludes: "Cambios en tu acceso" });
    await waitForMessage(request, { to: users.guideB.email, subjectIncludes: "Cambios en tu acceso" });
    for (const email of [users.company.email, users.guideA.email, users.guideB.email]) await purgeMailTo(request, email);

    // El guía A arranca sin no leídas para que la insignia mida solo el aviso nuevo.
    const setupUnread = await expectApi(guideAPage, "GET", `/api/backend/v1/profiles/${guideAId}/notifications?unread=true&per_page=20`);
    for (const item of setupUnread.data as Array<{ id: string }>) {
      await expectApi(guideAPage, "POST", `/api/backend/v1/profiles/${guideAId}/notifications/${ulid(item.id)}/read`);
    }

    // 2. Recibida (P26): el guía A tiene el centro abierto; la empresa envía por la ficha.
    let since = Date.now();
    await openHydrated(guideAPage, `/app/notifications?profile=${guideAId}`, users.guideA.name);
    await waitSubscribed(guideAFrames, guideAId, since);
    await expect(notificationsLink(guideAPage)).toHaveAttribute("data-unread", "0");
    await expect(notificationsLink(guideAPage)).toHaveAccessibleName("Notificaciones");

    await openHydrated(page, `/app/profiles/${guideAId}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: guideAName })).toBeVisible();
    const service1 = `Guiado bilingüe para 12 personas en Ushuaia, ${tag}.`;
    const receivedItem = notificationItem(guideAPage, `Nueva solicitud de ${companyName}`);
    const receivedSeen = seenAt(receivedItem);
    const request1 = await sendContactRequest(page, guideAName, service1, guideANeedles);
    const receivedVisibleAt = await receivedSeen;
    const receivedFrame = await notificationFrame(guideAFrames, guideAId, request1.clickedAt, frameNeedles);
    measure("recibida: click Enviar → frame notification.created (guía A)", receivedFrame.at - request1.clickedAt);
    measure("recibida: 201 → ítem visible sin recargar", receivedVisibleAt - request1.respondedAt);
    await expect(guideAPage.getByRole("link", { name: "Notificaciones, 1 sin leer", exact: true })).toBeVisible();
    await expect(notificationsLink(guideAPage)).toHaveAttribute("data-unread", "1");
    await expect(receivedItem).toHaveAttribute("data-read", "false");
    await expect(receivedItem).toContainText("No leída");
    await expect(receivedItem).toContainText("Perfil");
    await expect(guideAPage.getByTestId("notifications-live")).toHaveText("Llegó 1 notificación nueva.");
    expectNoContact(await guideAPage.content(), companyNeedles, "DOM del centro (guía A)");
    await fullPageEvidence(guideAPage, "t19-centro-guia-1440.png");

    // Correo de la recibida: uno solo, con nombre, servicio y link de login con returnTo.
    const receivedMail = await waitForMessage(request, { to: users.guideA.email, subjectIncludes: "Nueva solicitud" });
    expect(receivedMail.Subject).toBe("Nueva solicitud de contacto");
    expect(await mailsMatching(request, { to: users.guideA.email, subjectIncludes: "Nueva solicitud" })).toHaveLength(1);
    expect(receivedMail.Text).toContain(companyName);
    expect(receivedMail.Text).toContain(service1);
    expectNoContact(`${receivedMail.Subject}\n${receivedMail.body}`, companyNeedles, "correo de solicitud recibida");
    const link = loginLink(receivedMail.body);
    expect(link.pathname).toBe("/");
    expect(link.searchParams.get("auth")).toBe("login");
    expect(link.searchParams.get("returnTo")).toBe(`/app/requests/${request1.id}?profile=${guideAId}`);
    console.log(`[T19] link del correo (reescrito a la corrida): ${link.href}`);

    // "Ver solicitud" abre el detalle con el perfil activo y marca leída.
    const notificationId = ulid(await receivedItem.getAttribute("data-notification-id"));
    const markedRead = guideAPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/notifications/${notificationId}/read`) && response.request().method() === "POST");
    await receivedItem.getByRole("link", { name: "Ver solicitud" }).click();
    await expect(guideAPage).toHaveURL(`/app/requests/${request1.id}?profile=${guideAId}`, NAVIGATION);
    await expect(guideAPage.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    await expect(guideAPage.getByText("Estado: Pendiente")).toBeVisible();
    expect((await markedRead).status()).toBe(200);
    await notificationsLink(guideAPage).click();
    await expect(guideAPage).toHaveURL(`/app/notifications?profile=${guideAId}`, NAVIGATION);
    await expect(receivedItem).toHaveAttribute("data-read", "true");
    await expect(receivedItem).toContainText("Leída");
    await expect(notificationsLink(guideAPage)).toHaveAttribute("data-unread", "0");
    await expect(notificationsLink(guideAPage)).toHaveAccessibleName("Notificaciones");

    // 3. Preferencias: la empresa apaga el correo de rechazo; persiste tras recargar.
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    const rejectedPreference = page.getByRole("checkbox", { name: "Cuando rechazan una solicitud que enviaste" });
    await expect(rejectedPreference).toBeChecked();
    await rejectedPreference.uncheck();
    await page.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Preferencias guardadas." })).toBeVisible();
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    await expect(rejectedPreference).not.toBeChecked();
    for (const label of ["Cuando recibís una solicitud de contacto", "Cuando aceptan una solicitud que enviaste", "Cuando una solicitud vence sin respuesta"]) {
      await expect(page.getByRole("checkbox", { name: label })).toBeChecked();
    }
    await fullPageEvidence(page, "t19-preferencias-1440.png");

    // 4. Rechazo con el correo apagado: in-app en vivo, sin correo, `skipped_preference`.
    await openHydrated(page, `/app/profiles/${guideBId}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: guideBName })).toBeVisible();
    const request2 = await sendContactRequest(page, guideBName, `Recorrido histórico por Ushuaia, ${tag}.`, guideBNeedles);
    since = Date.now();
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    await waitSubscribed(companyFrames, companyId, since);
    await openHydrated(guideBPage, `/app/requests/${request2.id}?profile=${guideBId}`, users.guideB.name);
    await expect(guideBPage.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    const rejectedItem = notificationItem(page, `Tu solicitud a ${guideBName} fue rechazada`);
    const rejectedSeen = seenAt(rejectedItem);
    const rejectClick = Date.now();
    const rejectedAt = await decide(guideBPage, request2.id, "Rechazar");
    const rejectedVisibleAt = await rejectedSeen;
    const rejectedFrame = await notificationFrame(companyFrames, companyId, rejectClick, frameNeedles);
    measure("rechazada: confirmar → frame notification.created (empresa)", rejectedFrame.at - rejectClick);
    measure("rechazada: respuesta → ítem visible sin recargar", rejectedVisibleAt - rejectedAt);
    const rejectedId = ulid(await rejectedItem.getAttribute("data-notification-id"));
    expect(await emailStatus(rejectedId), "email_status del rechazo").toBe("skipped_preference");
    await noMessage(request, { to: users.company.email, subjectIncludes: "Solicitud rechazada" });

    // 5. Aceptación con el correo encendido: in-app en vivo y un correo sin contacto.
    await openHydrated(guideAPage, `/app/requests/${request1.id}?profile=${guideAId}`, users.guideA.name);
    await expect(guideAPage.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    const acceptedItem = notificationItem(page, `Tu solicitud a ${guideAName} fue aceptada`);
    const acceptedSeen = seenAt(acceptedItem);
    const acceptClick = Date.now();
    const acceptedAt = await decide(guideAPage, request1.id, "Aceptar");
    const acceptedVisibleAt = await acceptedSeen;
    const acceptedFrame = await notificationFrame(companyFrames, companyId, acceptClick, frameNeedles);
    measure("aceptada: confirmar → frame notification.created (empresa)", acceptedFrame.at - acceptClick);
    measure("aceptada: respuesta → ítem visible sin recargar", acceptedVisibleAt - acceptedAt);
    const acceptedMail = await waitForMessage(request, { to: users.company.email, subjectIncludes: "Solicitud aceptada" });
    expect(await mailsMatching(request, { to: users.company.email, subjectIncludes: "Solicitud aceptada" })).toHaveLength(1);
    expect(acceptedMail.Text).toContain(guideAName);
    expectNoContact(`${acceptedMail.Subject}\n${acceptedMail.body}`, guideANeedles, "correo de solicitud aceptada");
    expect(loginLink(acceptedMail.body).searchParams.get("returnTo")).toBe(`/app/requests/${request1.id}?profile=${companyId}`);
    expectNoContact(await page.content(), [...guideANeedles, ...guideBNeedles], "DOM del centro (empresa)");

    await expect(page.getByRole("link", { name: "Notificaciones, 5 sin leer", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(acceptedItem).toBeVisible();
    await assertNoHorizontalOverflow(page, 390, "centro de notificaciones (empresa)");
    await fullPageEvidence(page, "t19-centro-empresa-390.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    // 6. Esencial: con los cuatro opcionales apagados, el cambio de acceso igual llega.
    since = Date.now();
    await openHydrated(guideAPage, `/app/notifications?profile=${guideAId}`, users.guideA.name);
    await waitSubscribed(guideAFrames, guideAId, since);
    for (const label of [
      "Cuando recibís una solicitud de contacto",
      "Cuando aceptan una solicitud que enviaste",
      "Cuando rechazan una solicitud que enviaste",
      "Cuando una solicitud vence sin respuesta",
    ]) {
      await guideAPage.getByRole("checkbox", { name: label }).uncheck();
    }
    await guideAPage.getByRole("button", { name: "Guardar preferencias" }).click();
    await expect(guideAPage.getByRole("status").filter({ hasText: "Preferencias guardadas." })).toBeVisible();
    const me = await expectApi(guideAPage, "GET", "/api/backend/v1/me");
    const savedPreferences = (me.data as { notification_preferences: Array<{ event_type: string; email_enabled: boolean }> }).notification_preferences;
    expect(savedPreferences.filter((preference) => preference.email_enabled)).toHaveLength(0);
    expect(savedPreferences).toHaveLength(4);

    const accessItems = notificationItem(guideAPage, "Administración actualizó tu acceso");
    await expect(accessItems).toHaveCount(1);
    const accessSeen = expect(accessItems).toHaveCount(2, { timeout: LIVE_TIMEOUT_MS }).then(() => Date.now());
    const accessStart = Date.now();
    await putAccess(adminPage, guideAId, guideAVersion, 12, "Demo T19: ampliación del cupo mensual.");
    const accessAt = Date.now();
    const accessVisibleAt = await accessSeen;
    const accessFrame = await notificationFrame(guideAFrames, guideAId, accessStart, frameNeedles);
    measure("acceso: PUT admin → frame notification.created (guía A)", accessFrame.at - accessStart);
    measure("acceso: respuesta del PUT → ítem visible sin recargar", accessVisibleAt - accessAt);
    await expect(accessItems.first()).toHaveAttribute("data-read", "false");
    await expect(guideAPage.getByRole("link", { name: "Notificaciones, 1 sin leer", exact: true })).toBeVisible();
    const accessMail = await waitForMessage(request, { to: users.guideA.email, subjectIncludes: "Cambios en tu acceso" });
    expect(await mailsMatching(request, { to: users.guideA.email, subjectIncludes: "Cambios en tu acceso" })).toHaveLength(1);
    expect(accessMail.Text).toContain(guideAName);
    expect(accessMail.body).not.toContain("ampliación del cupo");
    const accessId = ulid(await accessItems.first().getAttribute("data-notification-id"));
    await expect.poll(() => emailStatus(accessId), { timeout: 30_000 }).toBe("sent");

    // 7. Idempotencia visible: tras recargar, cada evento una sola vez (id y título).
    await openHydrated(guideAPage, `/app/notifications?profile=${guideAId}`, users.guideA.name);
    await expectEachOnce(guideAPage, {
      "Te damos la bienvenida a Contactur": 1,
      "Verificaste tu correo": 1,
      "Administración actualizó tu acceso": 2,
      [`Nueva solicitud de ${companyName}`]: 1,
    }, "centro del guía A");
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    await expectEachOnce(page, {
      "Te damos la bienvenida a Contactur": 1,
      "Verificaste tu correo": 1,
      "Administración actualizó tu acceso": 1,
      [`Tu solicitud a ${guideBName} fue rechazada`]: 1,
      [`Tu solicitud a ${guideAName} fue aceptada`]: 1,
    }, "centro de la empresa");
    // Y sin correos duplicados ni tardíos al cierre.
    expect(await mailsMatching(request, { to: users.guideA.email, subjectIncludes: "Nueva solicitud" })).toHaveLength(1);
    expect(await mailsMatching(request, { to: users.company.email, subjectIncludes: "Solicitud aceptada" })).toHaveLength(1);
    expect(await mailsMatching(request, { to: users.company.email, subjectIncludes: "Solicitud rechazada" })).toHaveLength(0);
    expect(await mailsMatching(request, { to: users.guideA.email, subjectIncludes: "Cambios en tu acceso" })).toHaveLength(1);
    console.log(measurements.join("\n"));
  } finally {
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideAContext.close();
    await guideBContext.close();
    await adminContext.close();
  }
});

test("T19 formulario público de contacto: error accesible, envío real, honeypot y 390 px", async ({ browser, request }) => {
  test.setTimeout(600_000);
  // Corridas repetidas no deben chocar con el límite de 5 por hora de la IP del host.
  await clearSupportLimiter();
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T19-${crypto.randomUUID().slice(0, 8)}`;
  const shortVisitor = syntheticEmail(`t19-visitante-corto-${suffix}@example.test`);
  const visitor = syntheticEmail(`t19-visitante-${suffix}@example.test`);
  const bot = syntheticEmail(`t19-bot-${suffix}@example.test`);

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto("/#contacto");
    const form = page.getByRole("form", { name: "¿Tenés alguna consulta?" });
    await expect(form).toBeVisible({ timeout: 60_000 });
    await waitForHydrated(page, '#contacto textarea[name="message"]');
    const section = page.locator("#contacto");
    const status = form.locator("#contact-form-status");
    const alert = form.getByRole("alert");
    const message = form.getByLabel("Mensaje");
    const posted = () => page.waitForResponse((response: Response) =>
      response.url().endsWith("/api/backend/v1/support-inquiries") && response.request().method() === "POST");
    const fill = async (name: string, email: string, text: string) => {
      await form.getByLabel("Nombre").fill(name);
      await form.getByLabel("Email").fill(email);
      await form.getByLabel("Categoría (opcional)").selectOption({ label: "Soporte general" });
      await message.fill(text);
      await expect(message).toHaveValue(text);
    };
    await assertNoHorizontalOverflow(page, 390, "landing");

    // a) Mensaje corto: lo rechaza Laravel y el error queda junto a "Mensaje".
    await fill(`Visitante corto ${tag}`, shortVisitor, "Hola");
    const shortResponse = posted();
    await form.getByRole("button", { name: "Enviar consulta →" }).click();
    expect((await shortResponse).status()).toBe(422);
    await expect(message).toHaveAttribute("aria-invalid", "true");
    await expect(message).toHaveAttribute("aria-describedby", "contact-message-error");
    await expect(form.locator("#contact-message-error")).toHaveText(/\S/);
    await expect(message).toBeFocused();
    await expect(alert).toHaveText("Revisá los datos marcados en el formulario.");
    await expect(status).toHaveText("");
    await expect(page.getByText(/Recibimos tu consulta/)).toHaveCount(0);
    await assertNoHorizontalOverflow(page, 390, "formulario con error");
    await section.screenshot({ animations: "disabled", path: evidencePath("t19-contacto-error-390.png") });

    // b) Envío válido: estado visible y un único correo a soporte con Reply-To del visitante.
    const text = `Consulta de prueba ${tag}: quisiera saber cómo dar de alta mi perfil de guía.`;
    await fill(`Visitante ${tag}`, visitor, text);
    const okResponse = posted();
    await form.getByRole("button", { name: "Enviar consulta →" }).click();
    expect((await okResponse).status()).toBe(202);
    await expect(status).toHaveText("Recibimos tu consulta. Te vamos a responder por email.");
    await expect(alert).toHaveCount(0);
    await expect(message).not.toHaveAttribute("aria-invalid", "true");
    await expect(message).toHaveValue("");
    const supportMail = await waitForMessage(request, { to: SUPPORT_EMAIL, replyTo: visitor });
    expect(await mailsMatching(request, { to: SUPPORT_EMAIL, replyTo: visitor })).toHaveLength(1);
    expect(supportMail.Subject).toMatch(/^Nueva consulta de soporte/);
    expect(supportMail.Text).toContain(tag);
    expect(sameAddress(supportMail.ReplyTo, visitor)).toBe(true);
    await assertNoHorizontalOverflow(page, 390, "formulario enviado");
    await section.screenshot({ animations: "disabled", path: evidencePath("t19-contacto-ok-390.png") });

    // c) Bot: honeypot completado por script. Sin éxito, mensaje genérico y sin correo.
    await fill(`Bot ${tag}`, bot, `Mensaje automático ${tag} con el honeypot completo.`);
    await page.evaluate(() => {
      const honeypot = document.querySelector<HTMLInputElement>('#contacto input[name="website"]');
      if (!honeypot) throw new Error("Falta el honeypot");
      honeypot.value = "https://spam.example.test";
    });
    const botResponse = posted();
    await form.getByRole("button", { name: "Enviar consulta →" }).click();
    expect((await botResponse).status()).toBe(422);
    await expect(alert).toHaveText("No pudimos procesar tu consulta. Revisá los datos e intentá de nuevo.");
    await expect(status).toHaveText("");
    await expect(page.getByText(/Recibimos tu consulta/)).toHaveCount(0);
    await expect(form.locator('[aria-invalid="true"]')).toHaveCount(0);
    await noMessage(request, { to: SUPPORT_EMAIL, replyTo: bot });
    expect(await mailsMatching(request, { to: SUPPORT_EMAIL, replyTo: shortVisitor })).toHaveLength(0);
    expect(await sql(`SELECT count(*) FROM support_inquiries WHERE email IN ('${bot}', '${shortVisitor}')`)).toBe("0");
    expect(await sql(`SELECT count(*) FROM support_inquiries WHERE email = '${visitor}'`)).toBe("1");
    await assertNoHorizontalOverflow(page, 390, "formulario tras el bot");
  } finally {
    await context.close();
  }
});
