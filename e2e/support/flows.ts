/**
 * Helpers compartidos por los specs de T23 (QA integral). Son las mismas piezas que
 * T18–T21 copiaban en cada archivo (registro por la UI + Mailpit, login hidratado,
 * llamadas por el BFF con CSRF, fixtures completos por API real); se juntan acá para
 * que el recorrido principal y el barrido responsive no repitan 300 líneas. Los specs
 * anteriores conservan sus copias: no se tocaron para no cambiar lo ya evidenciado.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { deleteMail, waitForMail } from "./mailpit";

const run = promisify(execFile);

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Navegación cliente tras un click: margen porque el host de pruebas suele estar cargado. */
export const NAVIGATION = { timeout: 90_000 } as const;

export type Json = Record<string, unknown>;
export type ApiResult = Readonly<{ status: number; json: Json | null; text: string }>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type CatalogItem = Readonly<{ id: number; name: string; code: string }>;
export type DocumentType = Readonly<{ id: number; category: string; label?: string; required: boolean; requires_expiration: boolean }>;
export type Catalogs = Readonly<{
  cities: readonly CatalogItem[];
  languages: readonly CatalogItem[];
  services: readonly CatalogItem[];
  document_types: readonly DocumentType[];
}>;

export function evidencePath(task: string, filename: string): string {
  return fileURLToPath(new URL(`../../../docs/evidence/${task}/${filename}`, import.meta.url));
}

export async function compose(args: readonly string[], timeout = 180_000): Promise<string> {
  const { stdout } = await run("docker", ["compose", ...args], { cwd: REPO_ROOT, timeout });
  return stdout;
}

/** Promover a admin solo es posible por consola: la misma vía que usa un operador. */
export async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  return compose(["exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra]);
}

/** Consulta de control directa a PostgreSQL (solo lectura o ajuste de reloj de fixtures). */
export async function sql(query: string): Promise<string> {
  const stdout = await compose(
    ["exec", "-T", "postgres", "sh", "-c", 'psql -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', "psql", query],
    60_000,
  );
  return stdout.trim();
}

/** Estado `running/healthy` (o `exited/`) del contenedor de un servicio de Compose. */
export async function serviceState(service: string): Promise<string> {
  const id = (await compose(["ps", "-a", "-q", service])).trim().split("\n")[0] ?? "";
  if (!id) return "missing/";
  const { stdout } = await run(
    "docker",
    ["inspect", "-f", "{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}", id],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
  return stdout.trim();
}

export async function stopService(service: string): Promise<void> {
  await compose(["stop", service]);
  await expect.poll(() => serviceState(service), { timeout: 180_000, intervals: [1_000] }).toMatch(/^exited\//);
}

export async function startService(service: string): Promise<void> {
  await compose(["start", service]);
  await expect.poll(() => serviceState(service), { timeout: 240_000, intervals: [2_000] }).toBe("running/healthy");
}

export function ulid(value: string | null | undefined): string {
  expect(value ?? "", "id público con forma de ULID").toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  return value as string;
}

/** Fecha de negocio (D12): la misma regla que usa el backend para "hoy". */
export function businessToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function addDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

/** Primer día de un bloque de `length` días futuros dentro de un mismo mes. */
export function futureBlockStart(length: number): string {
  const tomorrow = addDays(businessToday(), 1);
  return addDays(tomorrow, length - 1).slice(0, 7) === tomorrow.slice(0, 7)
    ? tomorrow
    : `${addDays(tomorrow, length - 1).slice(0, 7)}-01`;
}

/** PDF mínimo real: arranca con %PDF-, sin contenido ejecutable ni marcado mixto. */
export const SYNTHETIC_PDF = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj",
  "trailer<</Root 1 0 R/Size 4>>",
  "%%EOF",
  "",
].join("\n");

export function syntheticPdf(): Buffer {
  return Buffer.from(SYNTHETIC_PDF, "latin1");
}

export function fakePhone(): string {
  return `+54 9 2901 ${String(100_000 + Math.floor(Math.random() * 899_999))}`;
}

/** Espera el fiber de React en un elemento: señal concreta de hidratación. */
export async function waitForHydrated(page: Page, selector: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    return element !== null && Object.keys(element).some((key) => key.startsWith("__react"));
  }, selector, { timeout });
}

export async function registerAndVerify(
  page: Page,
  request: APIRequestContext,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/?auth=register");
  const registration = page.getByRole("dialog", { name: "Crear una cuenta" });
  await expect(registration).toBeVisible({ timeout: 30_000 });
  await waitForHydrated(page, '[role="dialog"] input');
  await expect(registration.getByLabel("Nombre")).toBeFocused({ timeout: 15_000 });
  await registration.getByLabel("Nombre").fill(name);
  await registration.getByLabel("Email").fill(email);
  await registration.getByLabel("Contraseña", { exact: true }).fill(password);
  await registration.getByLabel("Confirmar contraseña").fill(password);
  await expect(registration.getByLabel("Nombre")).toHaveValue(name);
  await expect(registration.getByLabel("Email")).toHaveValue(email);
  await expect(registration.getByLabel("Contraseña", { exact: true })).toHaveValue(password);
  await registration.getByRole("button", { name: /crear cuenta/i }).click();
  await expect(registration.getByText("Cuenta creada")).toBeVisible({ timeout: 60_000 });

  const mail = await waitForMail(request, email, "verify-email");
  await page.goto(mail.link);
  const verification = page.getByRole("dialog", { name: "Verificar correo" });
  await expect(verification).toBeVisible({ timeout: 30_000 });
  await expect(verification.getByText(/tu correo quedó verificado/i)).toBeVisible({ timeout: 60_000 });
  await deleteMail(request, mail.id);
  await verification.getByRole("button", { name: /ir al inicio de sesión/i }).click();
}

/** Login desde el modal con margen y una recarga si el shell no hidrató con el host saturado. */
export async function loginHydrated(page: Page, email: string, password: string, userName: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Bienvenido" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByLabel("Email")).toBeFocused({ timeout: 15_000 });
  const fillAndSubmit = async () => {
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Contraseña").fill(password);
    await expect(dialog.getByLabel("Email")).toHaveValue(email);
    await expect(dialog.getByLabel("Contraseña")).toHaveValue(password);
    await dialog.getByRole("button", { name: /iniciar sesión/i }).click();
  };
  await fillAndSubmit();
  // Al hidratar, el shell agrega `?profile=` del perfil activo: si eso pasa antes de que
  // Playwright muestree la URL, esperar solo `/app` falla para siempre (suite T23 #2, t21).
  try {
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, NAVIGATION);
  } catch {
    if (!/\/app$/.test(new URL(page.url()).pathname)) await fillAndSubmit();
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, NAVIGATION);
  }
  await waitForAccountName(page, userName);
}

/** El nombre de cuenta del header aparece cuando `/me` resolvió: el árbol ya hidrató. */
async function waitForAccountName(page: Page, userName: string): Promise<void> {
  const accountName = page.locator("header").getByText(userName, { exact: true });
  try {
    await expect(accountName).toBeVisible({ timeout: 60_000 });
  } catch {
    await page.reload();
    await expect(accountName).toBeVisible({ timeout: 90_000 });
  }
}

export async function registerAndLogin(page: Page, request: APIRequestContext, name: string, email: string, password: string): Promise<void> {
  await registerAndVerify(page, request, name, email, password);
  await loginHydrated(page, email, password, name);
}

/** Navega por URL y espera el nombre de cuenta del header (≥861 px lo muestra). */
export async function openHydrated(page: Page, path: string, userName: string): Promise<void> {
  await page.goto(path);
  await waitForAccountName(page, userName);
}

/** Llamada real a través del BFF, con las cookies y el CSRF de la app. */
export async function api(page: Page, method: HttpMethod, path: string, body?: unknown): Promise<ApiResult> {
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
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? JSON.parse(text) as Record<string, unknown> : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }, { method, path, body });
}

export async function expectApi(page: Page, method: HttpMethod, path: string, body?: unknown): Promise<Json> {
  let result = await api(page, method, path, body);
  // Host saturado: GET/PUT/PATCH de setup son idempotentes y se reintentan ante 502+; POST no.
  for (let retry = 0; retry < 2 && method !== "POST" && result.status >= 502; retry += 1) {
    await page.waitForTimeout(2_000);
    result = await api(page, method, path, body);
  }
  expect(result.status, `${method} ${path}: ${result.text.slice(0, 400)}`).toBeLessThan(300);
  return result.json ?? {};
}

export async function uploadPdf(page: Page, profileId: string, type: DocumentType, filename: string, validUntil: string): Promise<string> {
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
  return ulid((JSON.parse(result.text) as { data: { id: string } }).data.id);
}

export function byName(items: readonly CatalogItem[], name: string): CatalogItem {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`Missing catalog item ${name}`);
  return item;
}

export async function catalogs(page: Page): Promise<Catalogs> {
  return (await expectApi(page, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
}

export type ProfileSetup = Readonly<{
  category: "guide" | "tourism_company" | "transport_company";
  displayName: string;
  contactEmail: string;
  phone?: string;
  documentFilename: string;
  label: string;
}>;

/** Alta completa por API real: datos, cobertura, documento requerido, términos y finalización. */
export async function createCompletedProfile(page: Page, catalog: Catalogs, setup: ProfileSetup): Promise<string> {
  const ushuaia = byName(catalog.cities, "Ushuaia");
  const created = await expectApi(page, "POST", "/api/backend/v1/profiles", {
    category: setup.category,
    display_name: setup.displayName,
  });
  const profileId = ulid((created.data as { id: string }).id);
  await expectApi(page, "PUT", `/api/backend/v1/profiles/${profileId}/cities`, { city_ids: [ushuaia.id] });
  const common = {
    display_name: setup.displayName,
    description: `Perfil de prueba ${setup.label} (${setup.category}).`,
    contact_email: setup.contactEmail,
    phone: setup.phone ?? fakePhone(),
    primary_city_id: ushuaia.id,
    language_ids: [byName(catalog.languages, "Español").id],
    service_ids: [byName(catalog.services, setup.category === "transport_company" ? "Traslado de pasajeros" : "Guiado").id],
  };
  const specific = setup.category === "guide"
    ? { education_summary: "Tecnicatura en guía de turismo.", qualifications: [] }
    : setup.category === "tourism_company"
      ? { legal_name: `${setup.displayName} SA`, years_active: 5 }
      : {
          legal_name: `${setup.displayName} SRL`,
          fleet_description: "Dos combis de 19 asientos.",
          fleet_vehicles: [{ vehicle_type: "Combi", quantity: 2, capacity: 19 }],
        };
  await expectApi(page, "PATCH", `/api/backend/v1/profiles/${profileId}`, { ...common, ...specific });
  for (const type of catalog.document_types.filter((item) => item.category === setup.category && item.required)) {
    await uploadPdf(page, profileId, type, setup.documentFilename, addDays(businessToday(), 400));
  }
  await expectApi(page, "POST", `/api/backend/v1/profiles/${profileId}/terms`, { version: "demo-v1", accepted: true });
  await expectApi(page, "POST", `/api/backend/v1/profiles/${profileId}/complete`);
  return profileId;
}

export type GrantInput = Readonly<{
  status?: "active" | "inactive" | "suspended";
  expiresAt?: string | null;
  monthlyLimit?: number;
  galleryEnabled?: boolean;
}>;

/** PUT admin del grant; devuelve la versión nueva para la siguiente edición. */
export async function putAccess(adminPage: Page, profileId: string, expectedVersion: number, reason: string, grant: GrantInput = {}): Promise<number> {
  const response = await expectApi(adminPage, "PUT", `/api/backend/v1/admin/profiles/${profileId}/access`, {
    status: grant.status ?? "active",
    starts_at: null,
    expires_at: grant.expiresAt ?? null,
    city_limit: 3,
    monthly_contact_limit: grant.monthlyLimit ?? 10,
    gallery_enabled: grant.galleryEnabled ?? false,
    expected_version: expectedVersion,
    reason,
  });
  const version = (response.data as { grant: { version: number } | null }).grant?.version;
  expect(typeof version, "versión del grant en la respuesta").toBe("number");
  return version as number;
}

export async function publishDays(page: Page, profileId: string, cityId: number, dates: readonly string[]): Promise<void> {
  const month = dates[0]?.slice(0, 7) ?? "";
  const current = await expectApi(page, "GET", `/api/backend/v1/profiles/${profileId}/availability?month=${month}`);
  const version = (current.data as { version: number }).version;
  await expectApi(page, "PUT", `/api/backend/v1/profiles/${profileId}/availability`, {
    expected_version: version,
    days: dates.map((date) => ({ date, available: true, city_id: cityId })),
  });
}

/** Captura de página completa desde arriba (el header sticky no tapa contenido). */
export async function fullPageEvidence(page: Page, path: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true, path });
}

export async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll, `overflow horizontal en ${label}`).toBeLessThanOrEqual(sizes.client);
}

export type SmallTarget = Readonly<{ element: string; text: string; width: number; height: number; inline: boolean }>;
export type LayoutReport = Readonly<{
  width: number;
  documentWidth: number;
  overflowPixels: number;
  /** Elementos que salen por la derecha sin un ancestro que los recorte o desplace. */
  offenders: readonly string[];
  /** Controles visibles con ancho o alto < 44 px (R22). `inline`: link dentro de un párrafo (excepción WCAG 2.5.8). */
  smallTargets: readonly SmallTarget[];
  focusableCount: number;
}>;

/**
 * Medición de layout en el viewport actual: overflow horizontal del documento y
 * tamaño de cada control visible. Un checkbox o radio cuenta con el tamaño de su
 * label (el target real que se toca); un link dentro de texto corrido se informa
 * como `inline` porque WCAG lo exceptúa, pero igual queda registrado.
 */
export async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    const describe = (element: Element): string => {
      const id = element.id ? `#${element.id}` : "";
      const name = element.getAttribute("aria-label") ?? element.getAttribute("name") ?? "";
      const classes = typeof element.className === "string" && element.className
        ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
      return `${element.tagName.toLowerCase()}${id}${classes}${name ? `[${name}]` : ""}`;
    };
    const hiddenForUsers = (element: Element): boolean => {
      if (element.closest("[aria-hidden='true'], [hidden], [inert]")) return true;
      const style = window.getComputedStyle(element);
      return style.visibility === "hidden" || style.display === "none";
    };
    // Desplazamiento horizontal intencional (tablas, carruseles): el contenido sigue alcanzable.
    const insideScrollContainer = (element: Element): boolean => {
      for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const overflowX = window.getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    // Cajas sin texto ni rol (brillos, texturas): pueden exceder el viewport porque se recortan a propósito.
    const decorative = (element: Element): boolean =>
      (element.textContent ?? "").trim() === "" &&
      !element.matches("img, svg, video, canvas, input, select, textarea, button, a, [role]");

    // T23: un contenido que sale por la derecha es un defecto aunque `overflow: hidden/clip`
    // (por ejemplo `body { overflow-x: clip }`) lo recorte y el documento no crezca: el
    // texto o el control queda cortado. Así se encontró el título del hero cortado a 390 px.
    const offenders: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > client + 1 && !hiddenForUsers(element) && !insideScrollContainer(element) && !decorative(element)) {
        offenders.push(`${describe(element)} right=${Math.round(rect.right)}`);
        if (offenders.length >= 10) break;
      }
    }

    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';
    const smallTargets: { element: string; text: string; width: number; height: number; inline: boolean }[] = [];
    let focusableCount = 0;
    for (const element of Array.from(document.querySelectorAll(selector))) {
      if (hiddenForUsers(element)) continue;
      if ((element as HTMLButtonElement).disabled) continue;
      let target: Element = element;
      const type = element.getAttribute("type");
      if (element.tagName === "INPUT" && (type === "checkbox" || type === "radio")) {
        target = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null) ?? element;
      }
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Fuera de pantalla a propósito (honeypot, skip links sin foco).
      if (rect.right <= 0 || rect.bottom <= -5000) continue;
      focusableCount += 1;
      if (rect.width + 0.5 >= 44 && rect.height + 0.5 >= 44) continue;
      const parentTag = element.parentElement?.tagName ?? "";
      const inline = element.tagName === "A" && ["P", "LI", "SPAN", "SMALL", "DD", "TD"].includes(parentTag) &&
        (element.parentElement?.textContent ?? "").trim().length > (element.textContent ?? "").trim().length;
      smallTargets.push({
        element: describe(element),
        text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inline,
      });
    }

    return {
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      overflowPixels: Math.max(0, document.documentElement.scrollWidth - client),
      offenders,
      smallTargets,
      focusableCount,
    };
  });
}

/** Dos frames: el layout del nuevo viewport ya está aplicado. */
export async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}
