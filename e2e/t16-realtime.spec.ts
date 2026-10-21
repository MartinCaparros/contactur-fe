import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page, type WebSocket } from "@playwright/test";

import { deleteMail, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t16/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BROADCAST_AUTH_PATH = "/api/backend/v1/broadcasting/auth";
const DIRECTORY_CHANNEL = "private-directory";

/** P15/R10: un cambio de disponibilidad tiene que verse en la búsqueda abierta en ≤2 s. No se relaja. */
const LIVE_LATENCY_MS = 2_000;
/** Intervalo de polling del cliente (POLL_INTERVAL_MS en src/lib/realtime/RealtimeProvider.tsx). */
const POLLING_INTERVAL_MS = 30_000;
/** Con el socket caído la vista re-consulta cada 30 s; el margen cubre la consulta en un host cargado. */
const POLLING_LATENCY_MS = 40_000;

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
type Frame = Readonly<{ at: number; direction: "in" | "out"; url: string; payload: string }>;
type DecodedFrame = Readonly<{ event: string | null; channel: string | null; data: unknown }>;
type AuthResponse = Readonly<{ at: number; channel: string; status: number }>;

/** Navegación cliente tras un click: margen extra porque el host de pruebas está muy cargado. */
const NAVIGATION = { timeout: 90_000 } as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t16/${filename}`, import.meta.url));
}

async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/** `docker compose …` en la raíz del repo; stop/start pueden tardar con el host cargado. */
async function compose(args: readonly string[]): Promise<string> {
  const { stdout } = await run("docker", ["compose", ...args], { cwd: REPO_ROOT, timeout: 240_000 });
  return stdout;
}

/** `estado/salud` del contenedor de Reverb, p. ej. `running/healthy` o `exited/unhealthy`. */
async function reverbState(): Promise<string> {
  const id = (await compose(["ps", "-a", "-q", "reverb"])).trim().split("\n")[0] ?? "";
  if (!id) return "missing/";
  const { stdout } = await run(
    "docker",
    ["inspect", "-f", "{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}", id],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
  return stdout.trim();
}

async function stopReverb(): Promise<void> {
  await compose(["stop", "reverb"]);
  await expect.poll(reverbState, { timeout: 180_000, intervals: [1_000] }).toMatch(/^exited\//);
}

async function startReverb(): Promise<void> {
  await compose(["start", "reverb"]);
  await expect.poll(reverbState, { timeout: 240_000, intervals: [2_000] }).toBe("running/healthy");
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

/** Copia de `loginHydrated` de t18: más margen y una recarga si el shell no hidrató. */
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

/** Espera el nombre de cuenta del header (solo aparece cuando `/me` resolvió, o sea hidratado). */
async function waitForShell(page: Page, userName: string): Promise<void> {
  const accountName = page.locator("header").getByText(userName, { exact: true });
  try {
    await expect(accountName).toBeVisible({ timeout: 60_000 });
  } catch {
    // Con el host saturado `/me` llegó a responder 502; se recarga una vez.
    await page.reload();
    await expect(accountName).toBeVisible({ timeout: 90_000 });
  }
}

async function openHydrated(page: Page, path: string, userName: string): Promise<void> {
  await page.goto(path);
  await waitForShell(page, userName);
}

/** Setup por la API real a través del BFF, desde el navegador logueado (cookies y CSRF de la app). */
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
  // Solo fixtures: GET/PUT/PATCH idempotentes se reintentan ante un 502 del BFF; POST no.
  for (let retry = 0; retry < 2 && method !== "POST" && result.status >= 502; retry += 1) {
    await page.waitForTimeout(2_000);
    result = await api(page, method, path, body);
  }
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.json)}`).toBeLessThan(300);
  return result.json ?? {};
}

/**
 * PUT medido: `at` es el `Date.now()` del navegador apenas llega la respuesta. Navegador
 * y runner comparten el reloj del host, así que se puede restar con marcas de otra página.
 * Sin reintentos: es el paso cuyo efecto en tiempo real se está midiendo.
 */
async function timedPut(page: Page, path: string, body: unknown): Promise<Readonly<{ status: number; text: string; at: number }>> {
  return page.evaluate(async ({ path, body }) => {
    const cookie = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("contactur_csrf="));
    let token = cookie ? decodeURIComponent(cookie.slice("contactur_csrf=".length)) : "";
    if (!token) {
      const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", cache: "no-store" });
      token = ((await csrf.json()) as { data: { csrf_token: string } }).data.csrf_token;
    }
    const response = await fetch(path, {
      method: "PUT",
      headers: { "x-csrf-token": token, "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const at = Date.now();
    return { status: response.status, text: await response.text(), at };
  }, { path, body });
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
    description: `Perfil de prueba T16 (${setup.category}).`,
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

function accessBody(status: "active" | "inactive", expectedVersion: number, reason: string) {
  return {
    status,
    starts_at: null,
    expires_at: null,
    city_limit: 3,
    monthly_contact_limit: 10,
    gallery_enabled: false,
    expected_version: expectedVersion,
    reason,
  };
}

/** Habilita el perfil y devuelve la versión del grant (para la revocación posterior). */
async function grantAccess(adminPage: Page, profileId: string): Promise<number> {
  const response = await expectApi(adminPage, "PUT", `/api/backend/v1/admin/profiles/${profileId}/access`,
    accessBody("active", 0, "Demo T16: habilitación para tiempo real."));
  const version = (response.data as { grant: { version: number } | null }).grant?.version;
  expect(typeof version, "versión del grant").toBe("number");
  return version as number;
}

type DayChange = Readonly<{ date: string; available: boolean }>;

/** Cambia días del mes con el contrato real (available=false no lleva city_id). Devuelve `at` del 200. */
async function changeAvailability(page: Page, profileId: string, cityId: number, changes: readonly DayChange[]): Promise<number> {
  const month = changes[0]?.date.slice(0, 7) ?? "";
  const current = await expectApi(page, "GET", `/api/backend/v1/profiles/${profileId}/availability?month=${month}`);
  const version = (current.data as { version: number }).version;
  const result = await timedPut(page, `/api/backend/v1/profiles/${profileId}/availability`, {
    expected_version: version,
    days: changes.map((change) => change.available
      ? { date: change.date, available: true, city_id: cityId }
      : { date: change.date, available: false }),
  });
  expect(result.status, `PUT availability: ${result.text}`).toBe(200);
  return result.at;
}

/**
 * Marca con el reloj del host el primer instante en que la tarjeta del perfil aparece o
 * desaparece del DOM (MutationObserver): mide la latencia sin el intervalo de reintento
 * de los asertos de Playwright.
 */
async function watchCard(page: Page, profileId: string, want: "present" | "absent"): Promise<void> {
  await page.evaluate(({ selector, want }) => {
    const scope = window as unknown as { __t16Card?: number | null; __t16Observer?: MutationObserver };
    scope.__t16Observer?.disconnect();
    scope.__t16Card = null;
    const check = () => {
      if (scope.__t16Card !== null) return;
      const present = document.querySelector(selector) !== null;
      if ((want === "present") === present) {
        scope.__t16Card = Date.now();
        scope.__t16Observer?.disconnect();
      }
    };
    scope.__t16Observer = new MutationObserver(check);
    scope.__t16Observer.observe(document.body, { childList: true, subtree: true });
    check();
  }, { selector: `article[data-profile-id="${profileId}"]`, want });
}

async function cardChangedAt(page: Page): Promise<number> {
  const at = await page.evaluate(() => (window as unknown as { __t16Card?: number | null }).__t16Card ?? null);
  expect(at, "el observer registró el cambio de la tarjeta").not.toBeNull();
  return at as number;
}

function decodeFrame(payload: string): DecodedFrame {
  try {
    const outer = JSON.parse(payload) as { event?: unknown; channel?: unknown; data?: unknown };
    let data = outer.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        // `data` puede ser texto plano; se conserva tal cual.
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

function isAppEvent(frame: DecodedFrame): boolean {
  return frame.event !== null && !frame.event.startsWith("pusher:") && !frame.event.startsWith("pusher_internal:");
}

async function fullPageEvidence(page: Page, filename: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true, path: evidencePath(filename) });
}

/** Contacto en las variantes en que podría filtrarse: tal cual, sin espacios y solo dígitos. */
function contactNeedles(email: string, phone: string): string[] {
  return [email, phone, phone.replace(/\s+/g, ""), phone.replace(/\D/g, "")];
}

function expectNoNeedles(haystack: string, needles: readonly string[], where: string): void {
  for (const needle of needles) expect(haystack.includes(needle), `${where} contiene ${needle}`).toBe(false);
}

async function warmRoutes(page: Page, paths: readonly string[]): Promise<void> {
  for (const path of paths) await page.request.get(path, { timeout: 180_000 });
}

function fakePhone(): string {
  return `+54 9 2901 ${String(100_000 + Math.floor(Math.random() * 899_999))}`;
}

test("T16 tiempo real: P15 en vivo ≤2 s, polling sin Reverb, reconexión y revocación con socket abierto", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(1_200_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T16 ${crypto.randomUUID().slice(0, 6)}`;
  const password = `T16-${crypto.randomUUID()}-Aa9!`;
  const users = {
    company: { name: "Empresa T16", email: `t16-company-${suffix}@example.test` },
    guide: { name: "Guía T16", email: `t16-guide-${suffix}@example.test` },
    admin: { name: "Admin T16", email: `t16-admin-${suffix}@example.test` },
  };
  const companyName = `Empresa Tiempo Real ${tag}`;
  const guideName = `Guía Tiempo Real ${tag}`;
  const companyContact: Contact = { email: `t16-contacto-empresa-${suffix}@example.test`, phone: fakePhone() };
  const guideContact: Contact = { email: `t16-contacto-guia-${suffix}@example.test`, phone: fakePhone() };
  const guideDomNeedles = [guideName, ...contactNeedles(guideContact.email, guideContact.phone), users.guide.email];
  // Los frames solo pueden traer ids, versiones y meses: nada de nombres, contacto ni emails de cuenta.
  const frameNeedles = [
    tag,
    guideName,
    companyName,
    ...contactNeedles(guideContact.email, guideContact.phone),
    ...contactNeedles(companyContact.email, companyContact.phone),
    users.guide.email,
    users.company.email,
    users.admin.email,
  ];
  const measurements: string[] = [];
  const measure = (label: string, ms: number) => {
    const line = `[T16] ${label}: ${ms} ms`;
    measurements.push(line);
    console.log(line);
  };
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const guideContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext();
  const guidePage = await guideContext.newPage();
  const adminPage = await adminContext.newPage();

  // Frames del websocket de la empresa (contexto A) y respuestas de autorización de canal.
  const frames: Frame[] = [];
  page.on("websocket", (socket: WebSocket) => {
    const record = (direction: Frame["direction"]) => (frame: { payload: string | Buffer }) => {
      frames.push({
        at: Date.now(),
        direction,
        url: socket.url(),
        payload: typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8"),
      });
    };
    socket.on("framereceived", record("in"));
    socket.on("framesent", record("out"));
  });
  const authResponses: AuthResponse[] = [];
  page.on("response", (response) => {
    if (!response.url().endsWith(BROADCAST_AUTH_PATH) || response.request().method() !== "POST") return;
    let channel = "";
    try {
      channel = (JSON.parse(response.request().postData() ?? "{}") as { channel_name?: string }).channel_name ?? "";
    } catch {
      channel = "";
    }
    authResponses.push({ at: Date.now(), channel, status: response.status() });
  });
  // Instante en que la empresa SALE a buscar (no cuándo responde el backend): separa la
  // cadencia del polling, que es del cliente, de la latencia del backend, que es del host.
  const searchRequests: number[] = [];
  page.on("request", (candidate) => {
    if (candidate.method() === "GET" && /\/api\/backend\/v1\/profiles\/[0-9A-Z]{26}\/search\?/.test(candidate.url())) {
      searchRequests.push(Date.now());
    }
  });
  const received = (since = 0) => frames
    .filter((frame) => frame.direction === "in" && frame.at >= since)
    .map((frame) => ({ ...frame, decoded: decodeFrame(frame.payload) }));

  try {
    // 1. Fixtures por la API real (BFF): guía y empresa completos y habilitados, sin disponibilidad.
    await registerAndLogin(guidePage, request, users.guide.name, users.guide.email, password);
    await warmRoutes(guidePage, ["/app/search"]);
    const catalogs = (await expectApi(guidePage, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
    const ushuaia = byName(catalogs.cities, "Ushuaia");
    const guideId = await createCompletedProfile(guidePage, catalogs, {
      category: "guide",
      displayName: guideName,
      contactEmail: guideContact.email,
      phone: guideContact.phone,
      documentFilename: `credencial-guia-t16-${suffix}.pdf`,
    });

    await registerAndLogin(page, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(page, catalogs, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: companyContact.email,
      phone: companyContact.phone,
      documentFilename: `registro-empresa-t16-${suffix}.pdf`,
    });

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    await grantAccess(adminPage, guideId);
    const companyGrantVersion = await grantAccess(adminPage, companyId);

    // Dos días futuros consecutivos dentro del mismo mes.
    const tomorrow = addDays(businessToday(), 1);
    const d1 = addDays(tomorrow, 1).slice(0, 7) === tomorrow.slice(0, 7) ? tomorrow : addDays(tomorrow, 1);
    const d2 = addDays(d1, 1);
    expect(d2.slice(0, 7)).toBe(d1.slice(0, 7));

    // 2. La empresa busca por la UI: guía + nombre + Ushuaia + rango de 2 días en modo "all".
    await openHydrated(page, `/app/search?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: "Buscar profesionales" })).toBeVisible();
    await expect(page.getByLabel("Ciudad")).toBeEnabled();
    await page.getByLabel("Categoría").selectOption("guide");
    await page.getByLabel("Nombre").fill(tag);
    await page.getByLabel("Ciudad").selectOption({ label: "Ushuaia" });
    await page.getByLabel("Desde").fill(d1);
    await page.getByLabel("Hasta").fill(d2);
    await expect(page.getByRole("radio", { name: "Todos los días del rango" })).toBeChecked();
    await page.getByRole("button", { name: "Buscar perfiles" }).click();
    await expect(page).toHaveURL(new RegExp(`date_from=${d1}.*date_to=${d2}`));

    const guideCard = page.locator(`article[data-profile-id="${guideId}"]`);
    const realtime = page.locator('[role="status"][data-realtime]');
    const pollingNotice = page.getByText(/Sin conexión en tiempo real: actualizamos los resultados cada 30 segundos/);
    await expect(page.getByRole("heading", { name: "Ningún perfil coincide con estos filtros" })).toBeVisible();
    await expect(guideCard).toHaveCount(0);
    await expect(realtime).toHaveAttribute("data-realtime", "live", { timeout: 60_000 });
    expect(authResponses.some((entry) => entry.channel === DIRECTORY_CHANNEL && entry.status === 200),
      "private-directory autorizado al abrir la búsqueda").toBe(true);

    // 3. P15 en vivo: el guía publica ambos días y la tarjeta aparece sola en ≤2 s.
    await watchCard(page, guideId, "present");
    const publishAt = await changeAvailability(guidePage, guideId, ushuaia.id, [
      { date: d1, available: true },
      { date: d2, available: true },
    ]);
    await expect(guideCard).toBeVisible({ timeout: 20_000 });
    const publishSeen = await cardChangedAt(page);
    measure("P15 en vivo, publicación → tarjeta visible", publishSeen - publishAt);
    await expect(page.getByRole("article", { name: guideName })).toBeVisible();
    expect(received(publishAt - 5_000).some(({ decoded }) =>
      decoded.event === "availability.changed" && decoded.channel === DIRECTORY_CHANNEL &&
      (decoded.data as { profile_id?: unknown } | null)?.profile_id === guideId),
    "llegó availability.changed del guía por private-directory").toBe(true);
    await fullPageEvidence(page, "t16-live-1440.png");
    expect.soft(publishSeen - publishAt, "P15: publicación visible en ≤2 s").toBeLessThanOrEqual(LIVE_LATENCY_MS);

    // 4. Fallback: sin Reverb la vista pasa a polling visible y el cambio llega por re-consulta.
    const stopAt = Date.now();
    await stopReverb();
    measure("docker compose stop reverb (hasta exited)", Date.now() - stopAt);
    await expect(realtime).toHaveAttribute("data-realtime", "polling", { timeout: 60_000 });
    await expect(pollingNotice).toBeVisible();
    measure("stop reverb → data-realtime=polling", Date.now() - stopAt);
    await expect(guideCard).toBeVisible();
    await fullPageEvidence(page, "t16-polling-1440.png");

    await watchCard(page, guideId, "absent");
    const removeAt = await changeAvailability(guidePage, guideId, ushuaia.id, [{ date: d2, available: false }]);
    // La tarjeta sale cuando responde la primera re-consulta posterior al cambio. Con el host
    // cargado esa respuesta llegó a tardar 15 s en el backend, así que la espera total es amplia;
    // lo que se exige estricto es la cadencia: la re-consulta sale dentro del intervalo de 30 s.
    await expect(guideCard).toHaveCount(0, { timeout: 90_000 });
    const removeSeen = await cardChangedAt(page);
    const firstPollAfter = searchRequests.find((at) => at >= removeAt);
    expect(firstPollAfter, "hubo una re-consulta por polling después del cambio").toBeDefined();
    measure("polling, baja de un día → sale la re-consulta", (firstPollAfter as number) - removeAt);
    measure("polling, baja de un día → tarjeta fuera", removeSeen - removeAt);
    expect((firstPollAfter as number) - removeAt, "la re-consulta sale dentro del intervalo de 30 s (+2 s)")
      .toBeLessThanOrEqual(POLLING_INTERVAL_MS + 2_000);
    expect.soft(removeSeen - removeAt, "baja visible por polling en ≤40 s (incluye latencia del backend)")
      .toBeLessThanOrEqual(POLLING_LATENCY_MS);
    await expect(page.getByRole("heading", { name: "Ningún perfil coincide con estos filtros" })).toBeVisible();
    await expect(realtime).toHaveAttribute("data-realtime", "polling");
    expect(received(stopAt).filter(({ decoded }) => isAppEvent(decoded)), "sin eventos por websocket con Reverb caído").toHaveLength(0);

    // 5. Reconexión: pusher-js reintenta solo; vuelve a live y se va el aviso.
    const startAt = Date.now();
    await startReverb();
    measure("docker compose start reverb (hasta healthy)", Date.now() - startAt);
    await expect(realtime).toHaveAttribute("data-realtime", "live", { timeout: 90_000 });
    await expect(pollingNotice).toBeHidden();
    measure("start reverb → data-realtime=live", Date.now() - startAt);

    await watchCard(page, guideId, "present");
    const republishAt = await changeAvailability(guidePage, guideId, ushuaia.id, [{ date: d2, available: true }]);
    await expect(guideCard).toBeVisible({ timeout: 20_000 });
    const republishSeen = await cardChangedAt(page);
    measure("P15 tras reconectar, republicación → tarjeta visible", republishSeen - republishAt);
    expect.soft(republishSeen - republishAt, "P15 tras reconectar en ≤2 s").toBeLessThanOrEqual(LIVE_LATENCY_MS);

    // 6. Revocación con el socket abierto: sin recargar, bloqueo, sin tarjeta y sin canal del directorio.
    await watchCard(page, guideId, "absent");
    const revoke = await timedPut(adminPage, `/api/backend/v1/admin/profiles/${companyId}/access`,
      accessBody("inactive", companyGrantVersion, "Demo T16: revocación con el buscador abierto."));
    expect(revoke.status, `PUT admin access: ${revoke.text}`).toBe(200);
    await expect(page.getByRole("heading", { name: "No podés usar el buscador en este momento" })).toBeVisible({ timeout: 10_000 });
    const revokeSeen = await cardChangedAt(page);
    measure("revocación → tarjeta fuera / bloqueo", revokeSeen - revoke.at);
    await expect(guideCard).toHaveCount(0);
    await expect(realtime).toHaveAttribute("data-realtime", /^(off|denied)$/, { timeout: 15_000 });
    console.log(`[T16] data-realtime tras revocar: ${await realtime.getAttribute("data-realtime")}`);

    // El cliente libera el canal del directorio en el mismo socket (no hubo recarga).
    let unsubscribedAt = 0;
    await expect.poll(() => {
      const frame = frames.find((candidate) => {
        if (candidate.direction !== "out" || candidate.at < revoke.at) return false;
        const decoded = decodeFrame(candidate.payload);
        return decoded.event === "pusher:unsubscribe" &&
          (decoded.data as { channel?: unknown } | null)?.channel === DIRECTORY_CHANNEL;
      });
      unsubscribedAt = frame?.at ?? 0;
      return unsubscribedAt > 0;
    }, { timeout: 15_000 }).toBe(true);
    measure("revocación → pusher:unsubscribe de private-directory", unsubscribedAt - revoke.at);

    // El guía cambia de nuevo su disponibilidad: la empresa no recibe ni muestra nada del guía.
    const afterRevokeAt = await changeAvailability(guidePage, guideId, ushuaia.id, [{ date: d1, available: false }]);
    const quietUntil = Date.now() + 6_000;
    while (Date.now() < quietUntil) {
      expectNoNeedles(await page.content(), [...guideDomNeedles, `data-profile-id="${guideId}"`], "DOM tras revocar");
      await page.waitForTimeout(500);
    }
    expect(received(unsubscribedAt).filter(({ decoded }) => decoded.channel === DIRECTORY_CHANNEL),
      "sin frames de private-directory después del unsubscribe").toHaveLength(0);
    console.log(`[T16] frames recibidos tras el cambio post-revocación: ${received(afterRevokeAt).length}`);
    await expect(page.getByRole("heading", { name: "No podés usar el buscador en este momento" })).toBeVisible();
    await fullPageEvidence(page, "t16-revocada-1440.png");

    // Recarga: el directorio ya no se autoriza; el canal propio sí (acceso inactivo ≠ perfil suspendido).
    const reloadAt = Date.now();
    await page.reload();
    await waitForShell(page, users.company.name);
    await expect(page.getByRole("heading", { name: "No podés usar el buscador en este momento" })).toBeVisible();
    await expect(realtime).toHaveAttribute("data-realtime", /^(off|denied)$/);
    await expect.poll(() => authResponses.find((entry) =>
      entry.at >= reloadAt && entry.channel === `private-profile.${companyId}`)?.status ?? null, { timeout: 60_000 }).toBe(200);
    const directoryAfterReload = authResponses.filter((entry) => entry.at >= reloadAt && entry.channel === DIRECTORY_CHANNEL);
    console.log(`[T16] auth de private-directory pedidas por el cliente tras recargar: ${JSON.stringify(directoryAfterReload.map((entry) => entry.status))}`);
    expect(directoryAfterReload.filter((entry) => entry.status === 200), "ningún 200 para private-directory").toHaveLength(0);
    for (const entry of directoryAfterReload) expect(entry.status).toBe(403);

    // El cliente ni lo pide (sabe que no hay can_search); se fuerza con el socket_id real del socket nuevo.
    const established = received(reloadAt).filter(({ decoded }) => decoded.event === "pusher:connection_established").at(-1);
    const socketId = (established?.decoded.data as { socket_id?: unknown } | undefined)?.socket_id;
    expect(typeof socketId, "socket_id del socket abierto tras recargar").toBe("string");
    const forced = await api(page, "POST", BROADCAST_AUTH_PATH, { socket_id: socketId, channel_name: DIRECTORY_CHANNEL });
    console.log(`[T16] auth forzada de private-directory tras revocar: ${forced.status} ${JSON.stringify(forced.json)}`);
    expect(forced.status).toBe(403);
    expect(JSON.stringify(forced.json)).not.toContain('"auth"');

    // 7. Ningún frame recibido trae datos de perfil: solo ids, versiones y meses.
    const all = received();
    const events = all.filter(({ decoded }) => isAppEvent(decoded));
    console.log(`[T16] frames recibidos: ${all.length}; eventos de app: ${events.length} (${[...new Set(events.map(({ decoded }) => `${decoded.event}@${decoded.channel}`))].join(", ")})`);
    expect(events.some(({ decoded }) => decoded.event === "availability.changed"), "hubo eventos que revisar").toBe(true);
    for (const frame of all) {
      expectNoNeedles(frame.payload, frameNeedles, "frame crudo");
      expectNoNeedles(JSON.stringify(frame.decoded), frameNeedles, "frame decodificado");
    }
    for (const { decoded } of events) {
      const keys = decoded.data && typeof decoded.data === "object" ? Object.keys(decoded.data) : [];
      // Solo IDs y versiones: `notification_id` es el ID público del aviso de T19.
      for (const key of keys) {
        expect(["profile_id", "version", "months", "notification_id"], `clave ${key} en ${decoded.event}`).toContain(key);
      }
    }
    console.log(`[T16] resumen de mediciones:\n${measurements.join("\n")}`);
  } finally {
    // Reverb siempre vuelve a quedar arriba, aunque el test falle a mitad.
    await startReverb().catch((reason: unknown) => console.error(`[T16] no se pudo restaurar Reverb: ${String(reason)}`));
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideContext.close();
    await adminContext.close();
  }
});
