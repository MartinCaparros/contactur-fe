import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";

import { deleteMail, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t20/", import.meta.url));
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

/** Navegación cliente tras un click: margen extra porque el host de pruebas está muy cargado. */
const NAVIGATION = { timeout: 90_000 } as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t20/${filename}`, import.meta.url));
}

async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/** Consulta de solo lectura a Postgres. Los valores interpolados se validan antes (ULID). */
async function sql(query: string): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "postgres", "sh", "-c", 'psql -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', "psql", query],
    { cwd: REPO_ROOT, timeout: 60_000 },
  );
  return stdout.trim();
}

function ulid(value: string | null | undefined): string {
  expect(value ?? "", "id público con forma de ULID").toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  return value as string;
}

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t20-[a-z0-9-]+@example\.test$/);
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

/** Copia de T18/T19: login con margen y una recarga si el shell no hidrató con el host saturado. */
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

/** Llamada real a través del BFF, con las cookies y el CSRF de la app (setup y POST/PATCH forzados). */
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

/** Un request forzado que Laravel debe rechazar con `status` y `code` exactos. */
async function expectProblem(
  page: Page,
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  status: number,
  code: string,
): Promise<void> {
  const result = await api(page, method, path, body);
  expect(result.status, `${method} ${path}: ${JSON.stringify(result.json)}`).toBe(status);
  expect((result.json?.error as { code?: string } | undefined)?.code, `${method} ${path}`).toBe(code);
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
    description: `Perfil de prueba T20 (${setup.category}).`,
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

async function grantAccess(adminPage: Page, profileId: string): Promise<void> {
  await expectApi(adminPage, "PUT", `/api/backend/v1/admin/profiles/${profileId}/access`, {
    status: "active",
    starts_at: null,
    expires_at: null,
    city_limit: 3,
    monthly_contact_limit: 10,
    gallery_enabled: false,
    expected_version: 0,
    reason: "Demo T20: habilitación para referencias.",
  });
}

/** Solicitud de la empresa por API (setup); devuelve el id público. */
async function sendRequestByApi(page: Page, senderId: string, targetId: string, service: string): Promise<string> {
  const created = await expectApi(page, "POST", `/api/backend/v1/profiles/${senderId}/contact-requests`, {
    target_profile_id: targetId,
    service_description: service,
  });
  return ulid((created.data as { id: string }).id);
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

/** Referencias = texto libre (R17): ni estrellas, ni puntajes, ni controles de calificación. */
async function expectNoRatings(scope: Locator, where: string): Promise<void> {
  const text = await scope.innerText();
  expect(text, `${where}: símbolo de estrella`).not.toMatch(/[★☆⭐]/u);
  expect(text, `${where}: "estrellas"`).not.toMatch(/estrellas?/i);
  expect(text, `${where}: "puntaje"`).not.toMatch(/puntaje/i);
  expect(text, `${where}: "calificación"`).not.toMatch(/calificaci[oó]n/i);
  // "/5" como puntaje ("4/5", "4,5 / 5"). Las fechas dd/mm/aaaa nunca dejan un 5 suelto tras "/".
  expect(text, `${where}: "/5"`).not.toMatch(/\/\s*5(?!\d)/);
  expect(
    await scope.locator('input[type="range"], input[type="radio"], [role="slider"], [role="radiogroup"], meter').count(),
    `${where}: controles de puntaje`,
  ).toBe(0);
}

/** Abre la ficha de directorio y devuelve el JSON crudo que recibió el navegador. */
async function openDirectory(page: Page, actorId: string, targetId: string, userName: string, targetName: string): Promise<string> {
  const loaded = page.waitForResponse((response: Response) =>
    response.url().endsWith(`/profiles/${actorId}/directory/${targetId}`) && response.request().method() === "GET",
  { timeout: 120_000 });
  await openHydrated(page, `/app/profiles/${targetId}?profile=${actorId}`, userName);
  const response = await loaded;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: targetName })).toBeVisible();
  return response.text();
}

/** P25: ni el DOM, ni el HTML SSR, ni el payload RSC, ni la API de la ficha traen el texto oculto. */
async function expectDirectoryWithout(page: Page, path: string, rawApi: string, needle: string, where: string): Promise<void> {
  expect(rawApi.includes(needle), `API de ${where} contiene ${needle}`).toBe(false);
  expect((await page.content()).includes(needle), `DOM de ${where} contiene ${needle}`).toBe(false);
  const ssr = await page.request.get(path, { timeout: 120_000 });
  expect(ssr.ok(), `GET ${path}`).toBe(true);
  expect((await ssr.text()).includes(needle), `HTML SSR de ${where} contiene ${needle}`).toBe(false);
  const rsc = await page.request.get(path, { headers: { RSC: "1" }, timeout: 120_000 });
  expect((await rsc.text()).includes(needle), `payload RSC de ${where} contiene ${needle}`).toBe(false);
}

function referencesRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Referencias", exact: true });
}

function requestReferenceRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Referencia", exact: true });
}

/** Detalle de una solicitud aceptada → escribe la referencia por la UI; devuelve su id público. */
async function writeReference(
  page: Page,
  actorId: string,
  requestId: string,
  counterpartName: string,
  body: string,
  beforeSubmit?: () => Promise<void>,
): Promise<string> {
  const section = requestReferenceRegion(page);
  await expect(section).toBeVisible();
  const textarea = section.getByLabel(`Dejá una referencia sobre ${counterpartName}`);
  await expect(textarea).toBeVisible({ timeout: 60_000 });
  await textarea.fill(body);
  await expect(textarea).toHaveValue(body);
  await expect(section.getByText(`${body.trim().length} de 2000 caracteres (mínimo 20).`)).toBeVisible();
  if (beforeSubmit) await beforeSubmit();
  const created = page.waitForResponse((response: Response) =>
    response.url().endsWith(`/profiles/${actorId}/contact-requests/${requestId}/references`) && response.request().method() === "POST");
  await section.getByRole("button", { name: "Enviar referencia" }).click();
  const response = await created;
  const raw = await response.text();
  expect(response.status(), raw).toBe(201);
  const data = (JSON.parse(raw) as { data: { id: string; visibility: string; moderated: boolean; body: string } }).data;
  expect(data.visibility).toBe("hidden");
  expect(data.moderated).toBe(false);
  expect(data.body).toBe(body);
  const confirmation = section.getByRole("status");
  await expect(confirmation.getByRole("heading", { name: `Referencia guardada sobre ${counterpartName}` })).toBeVisible();
  await expect(confirmation).toContainText(`Estado: Pendiente de publicación por ${counterpartName}`);
  await expect(section.locator("textarea")).toHaveCount(0);
  return ulid(data.id);
}

/** Tras recargar, el detalle muestra la existente y no vuelve a ofrecer el formulario. */
async function expectExistingReference(page: Page, counterpartName: string, statusText: string, body: string): Promise<void> {
  const section = requestReferenceRegion(page);
  await expect(section.getByRole("heading", { name: `Ya dejaste una referencia sobre ${counterpartName}` })).toBeVisible({ timeout: 60_000 });
  await expect(section).toContainText(`Estado: ${statusText}`);
  await expect(section.getByText(body.split("\n")[0] as string)).toBeVisible();
  await expect(section.locator("textarea")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Enviar referencia" })).toHaveCount(0);
}

/** Abre Referencias desde el menú lateral, como lo haría la persona usuaria. */
async function openReferencesFromMenu(page: Page, profileId: string, userName: string): Promise<void> {
  await openHydrated(page, `/app?profile=${profileId}`, userName);
  await page.getByRole("complementary", { name: "Navegación del perfil" }).getByRole("link", { name: "Referencias", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/references\\?profile=${profileId}(&direction=received)?$`), NAVIGATION);
  await expect(page.getByRole("heading", { level: 1, name: "Referencias" })).toBeVisible();
}

async function selectTab(page: Page, tab: "Recibidas" | "Escritas por vos"): Promise<void> {
  const button = page.getByRole("tab", { name: tab });
  if ((await button.getAttribute("aria-selected")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
}

function referenceCard(page: Page, counterpartName: string): Locator {
  return page.getByRole("tabpanel").getByRole("article", { name: counterpartName, exact: true });
}

function notificationItem(page: Page, title: string): Locator {
  return page.getByRole("article", { name: title, exact: true });
}

/** Filtro del panel admin por estado de moderación (form real con "Aplicar filtros"). */
async function applyAdminFilter(adminPage: Page, label: "Todas" | "Sin moderar" | "Moderadas"): Promise<void> {
  const loaded = adminPage.waitForResponse((response: Response) =>
    response.url().includes("/api/backend/v1/admin/references") && response.request().method() === "GET", { timeout: 120_000 });
  await adminPage.getByLabel("Estado").selectOption({ label });
  await adminPage.getByRole("button", { name: "Aplicar filtros" }).click();
  expect((await loaded).status()).toBe(200);
  await expect(adminPage.getByText(`Estado consultado: ${label}`)).toBeVisible();
}

test("T20 referencias: alta bilateral, duplicado, publicación por el destinatario y moderación (P25)", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(1_500_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T20-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T20-${crypto.randomUUID()}-Aa9!`;
  const users = {
    company: { name: "Empresa T20", email: syntheticEmail(`t20-company-${suffix}@example.test`) },
    guideA: { name: "Guía A T20", email: syntheticEmail(`t20-guide-a-${suffix}@example.test`) },
    guideB: { name: "Guía B T20", email: syntheticEmail(`t20-guide-b-${suffix}@example.test`) },
    admin: { name: "Admin T20", email: syntheticEmail(`t20-admin-${suffix}@example.test`) },
  };
  const companyName = `Empresa Referente ${tag}`;
  const guideAName = `Guía Referida ${tag}`;
  const guideBName = `Guía Pendiente ${tag}`;
  // Texto con salto de línea y marcas que parecen HTML: tienen que verse como texto.
  const companyBody = `Trabajamos con la guía en Ushuaia y la coordinación fue impecable (${tag}-E).\nSegunda línea con <b>marcas</b> & símbolos que no son HTML.`;
  const guideBody = `La empresa organizó el grupo con mucha claridad (${tag}-G).\nVolvería a trabajar con este equipo.`;
  const companyNeedle = `${tag}-E`;
  const hideReason = `Moderación T20 ${tag}: el texto menciona datos a revisar.`;
  const restoreReason = `Restauración T20 ${tag}: revisado, no infringe las reglas.`;
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const guideAContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guideBContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guideAPage = await guideAContext.newPage();
  const guideBPage = await guideBContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Fixtures por la API real (BFF con CSRF): empresa y dos guías completos y habilitados.
    await registerAndLogin(guideAPage, request, users.guideA.name, users.guideA.email, password);
    const catalogs = (await expectApi(guideAPage, "GET", "/api/backend/v1/catalogs?per_page=50")).data as Catalogs;
    const guideAId = await createCompletedProfile(guideAPage, catalogs, {
      category: "guide",
      displayName: guideAName,
      contactEmail: `t20-contacto-guia-a-${suffix}@example.test`,
      documentFilename: `credencial-guia-a-t20-${suffix}.pdf`,
    });
    await registerAndLogin(guideBPage, request, users.guideB.name, users.guideB.email, password);
    const guideBId = await createCompletedProfile(guideBPage, catalogs, {
      category: "guide",
      displayName: guideBName,
      contactEmail: `t20-contacto-guia-b-${suffix}@example.test`,
      documentFilename: `credencial-guia-b-t20-${suffix}.pdf`,
    });
    await registerAndLogin(page, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(page, catalogs, {
      category: "tourism_company",
      displayName: companyName,
      contactEmail: `t20-contacto-empresa-${suffix}@example.test`,
      documentFilename: `registro-empresa-t20-${suffix}.pdf`,
    });

    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    for (const profileId of [guideAId, guideBId, companyId]) await grantAccess(adminPage, profileId);

    // Match aceptado (empresa → guía A) y una solicitud que queda pendiente (empresa → guía B).
    const acceptedId = await sendRequestByApi(page, companyId, guideAId, `Guiado en Ushuaia para 10 personas (${tag}).`);
    await expectApi(guideAPage, "POST", `/api/backend/v1/profiles/${guideAId}/contact-requests/${acceptedId}/accept`);
    const pendingId = await sendRequestByApi(page, companyId, guideBId, `Recorrido por el Fin del Mundo (${tag}).`);

    // 2. Alta bilateral por la UI. Empresa: detalle → "Referencia" → texto con salto de línea.
    // Se hidrata a 1440 (a ≤640 px el header oculta el nombre de cuenta) y se pasa a 390.
    await openHydrated(page, `/app/requests/${acceptedId}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: `Solicitud a ${guideAName}` })).toBeVisible();
    await expect(page.getByText("Estado: Aceptada")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const companyRefId = await writeReference(page, companyId, acceptedId, guideAName, companyBody, async () => {
      await assertNoHorizontalOverflow(page, 390, "detalle con el formulario de referencia");
      await fullPageEvidence(page, "t20-detalle-form-390.png");
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHydrated(page, `/app/requests/${acceptedId}?profile=${companyId}`, users.company.name);
    await expectExistingReference(page, guideAName, `Pendiente de publicación por ${guideAName}`, companyBody);

    // Guía A: misma sección desde su lado, referencia sobre la empresa.
    await openHydrated(guideAPage, `/app/requests/${acceptedId}?profile=${guideAId}`, users.guideA.name);
    await expect(guideAPage.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    const guideRefId = await writeReference(guideAPage, guideAId, acceptedId, companyName, guideBody);
    expect(guideRefId).not.toBe(companyRefId);
    await openHydrated(guideAPage, `/app/requests/${acceptedId}?profile=${guideAId}`, users.guideA.name);
    await expectExistingReference(guideAPage, companyName, `Pendiente de publicación por ${companyName}`, guideBody);

    // 3. Duplicado: un segundo POST de la empresa por el BFF → 409; la UI no ofrece otro formulario.
    await expectProblem(page, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests/${acceptedId}/references`,
      { body: `Segundo intento de referencia para el mismo match (${tag}).` }, 409, "reference_already_exists");
    expect(await sql(`SELECT count(*) FROM "references" r JOIN contact_requests c ON c.id = r.contact_request_id WHERE c.public_id = '${acceptedId}'`))
      .toBe("2");

    // 4. Sin match aceptado: el detalle pendiente no tiene sección "Referencia" y el POST forzado → 409.
    await openHydrated(page, `/app/requests/${pendingId}?profile=${companyId}`, users.company.name);
    await expect(page.getByRole("heading", { level: 1, name: `Solicitud a ${guideBName}` })).toBeVisible();
    await expect(page.getByText("Estado: Pendiente")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Servicio solicitado" })).toBeVisible();
    await expect(requestReferenceRegion(page)).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
    await expectProblem(page, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests/${pendingId}/references`,
      { body: `Referencia sin match aceptado, debe rechazarse (${tag}).` }, 409, "contact_request_not_accepted");

    // 5. Oculta no es pública: la ficha del guía A no la muestra (DOM, SSR, RSC ni API).
    const directoryPath = `/app/profiles/${guideAId}?profile=${companyId}`;
    let rawDirectory = await openDirectory(page, companyId, guideAId, users.company.name, guideAName);
    await expect(referencesRegion(page).getByText("Todavía no tiene referencias visibles.")).toBeVisible();
    await expectDirectoryWithout(page, directoryPath, rawDirectory, companyNeedle, "la ficha con la referencia oculta");

    // 6. El destinatario publica desde Referencias (menú) → Recibidas.
    await openReferencesFromMenu(guideAPage, guideAId, users.guideA.name);
    await selectTab(guideAPage, "Recibidas");
    const received = referenceCard(guideAPage, companyName);
    await expect(received).toHaveCount(1);
    await expect(received).toContainText("Estado: Oculta en tu ficha");
    await expect(received).toContainText(companyNeedle);
    await expect(received).toHaveAttribute("data-reference-id", companyRefId);
    const published = guideAPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/profiles/${guideAId}/references/${companyRefId}/visibility`) && response.request().method() === "PATCH");
    await received.getByRole("button", { name: "Publicar en mi ficha" }).click();
    const publishResponse = await published;
    expect(publishResponse.status(), await publishResponse.text()).toBe(200);
    await expect(received).toContainText("Estado: Publicada en tu ficha");
    await expect(received.getByRole("button", { name: "Ocultar de mi ficha" })).toBeVisible();
    // Persistió: tras recargar sigue publicada.
    await openHydrated(guideAPage, `/app/references?profile=${guideAId}&direction=received`, users.guideA.name);
    await selectTab(guideAPage, "Recibidas");
    await expect(received).toContainText("Estado: Publicada en tu ficha");
    // El destinatario no puede editar el texto: no hay textarea, campo editable ni botón de edición.
    const referencesPanel = guideAPage.getByRole("region", { name: "Referencias", exact: true });
    await expect(referencesPanel.locator("textarea, input[type='text'], [contenteditable]")).toHaveCount(0);
    await expect(referencesPanel.getByRole("button", { name: /editar|modificar/i })).toHaveCount(0);
    await expect(referencesPanel.getByRole("link", { name: /editar|modificar/i })).toHaveCount(0);
    await expectNoRatings(referencesPanel, "Referencias (recibidas del guía)");
    await fullPageEvidence(guideAPage, "t20-recibidas-1440.png");
    // El AUTOR no decide la visibilidad: PATCH forzado de la empresa → 403 `forbidden`.
    await expectProblem(page, "PATCH", `/api/backend/v1/profiles/${companyId}/references/${companyRefId}/visibility`,
      { visibility: "hidden" }, 403, "forbidden");

    // 7. La empresa recarga la ficha: el texto aparece como texto plano, con su salto de línea.
    rawDirectory = await openDirectory(page, companyId, guideAId, users.company.name, guideAName);
    expect(rawDirectory.includes(companyNeedle), "la API de la ficha trae la referencia publicada").toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    const directoryReferences = referencesRegion(page);
    const publicItem = directoryReferences.locator(`li[data-reference-id="${companyRefId}"]`);
    await expect(publicItem).toBeVisible();
    await expect(directoryReferences.locator("li[data-reference-id]")).toHaveCount(1);
    const rendered = await publicItem.locator("blockquote").evaluate((element) => ({
      text: element.textContent,
      inner: (element as HTMLElement).innerText,
      html: element.innerHTML,
      children: element.children.length,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(rendered.text, "texto exacto del autor").toBe(companyBody);
    expect(rendered.children, "sin elementos HTML dentro del texto").toBe(0);
    expect(rendered.html).toContain("&lt;b&gt;marcas&lt;/b&gt;");
    expect(rendered.whiteSpace).toBe("pre-wrap");
    expect(rendered.inner, "salto de línea visible").toContain("\n");
    await expect(publicItem.locator("small")).toContainText(`${companyName} · Empresa`);
    await expect(directoryReferences.getByText("Todavía no tiene referencias visibles.")).toHaveCount(0);
    await expectNoRatings(directoryReferences, "región Referencias de la ficha");
    await assertNoHorizontalOverflow(page, 390, "ficha de directorio con referencia");
    // Captura de página completa desde arriba: con scroll previo, el header sticky queda
    // pintado en el medio de la imagen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ animations: "disabled", fullPage: true, path: evidencePath("t20-ficha-referencia-390.png") });

    // "Escritas por vos" de la empresa: publicada por el guía. Sin overflow a 390.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openReferencesFromMenu(page, companyId, users.company.name);
    await page.setViewportSize({ width: 390, height: 844 });
    await selectTab(page, "Escritas por vos");
    await expect(page).toHaveURL(new RegExp(`/app/references\\?profile=${companyId}&direction=authored$`));
    const authored = referenceCard(page, guideAName);
    await expect(authored).toHaveCount(1);
    await expect(authored).toContainText(`Estado: Publicada por ${guideAName}`);
    await expect(authored.getByRole("button", { name: /Publicar en mi ficha|Ocultar de mi ficha/ })).toHaveCount(0);
    await assertNoHorizontalOverflow(page, 390, "Referencias (escritas por la empresa)");
    await expectNoRatings(page.getByRole("region", { name: "Referencias", exact: true }), "Referencias (escritas por la empresa)");
    await page.setViewportSize({ width: 1440, height: 1000 });

    // 8. Moderación: el admin entra por el menú del backoffice, filtra "Sin moderar" y oculta.
    await openHydrated(adminPage, "/admin", users.admin.name);
    await adminPage.getByRole("complementary", { name: "Navegación del backoffice" }).getByRole("link", { name: "Referencias", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/admin\/references$/, NAVIGATION);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Referencias" })).toBeVisible();
    await applyAdminFilter(adminPage, "Sin moderar");
    const adminItem = adminPage.locator("li[data-reference-id]").filter({ hasText: companyNeedle });
    await expect(adminItem).toHaveCount(1);
    await expect(adminItem).toHaveAttribute("data-reference-id", companyRefId);
    await expect(adminItem).toContainText(`${companyName} → ${guideAName}`);
    await expect(adminItem).toContainText("Moderación: Sin moderación");
    await expect(adminItem).toContainText("Visibilidad: Publicada por el destinatario");
    await adminItem.getByRole("button", { name: "Ocultar", exact: true }).click();
    const hideDialog = adminPage.getByRole("dialog", { name: "Ocultar la referencia por moderación" });
    await expect(hideDialog).toBeVisible();
    await expect(hideDialog).toContainText(`Referencia de ${companyName} sobre ${guideAName}`);
    await hideDialog.getByLabel("Motivo (obligatorio)").fill(hideReason);
    await expect(hideDialog.getByLabel("Motivo (obligatorio)")).toHaveValue(hideReason);
    const hidden = adminPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/admin/references/${companyRefId}/moderate`) && response.request().method() === "POST");
    await hideDialog.getByRole("button", { name: "Ocultar referencia" }).click();
    const hideResponse = await hidden;
    expect(hideResponse.status(), await hideResponse.text()).toBe(200);
    await expect(hideDialog).toBeHidden();
    await expect(adminPage.getByRole("status").filter({ hasText: "Cambio aplicado y listado actualizado" }))
      .toContainText(`La referencia de «${companyName}» sobre «${guideAName}» quedó oculta por moderación.`);
    // Con el filtro "Sin moderar" vigente la fila sale del listado; en "Moderadas" figura con su motivo.
    await expect(adminItem).toHaveCount(0);
    await applyAdminFilter(adminPage, "Moderadas");
    await expect(adminItem).toHaveCount(1);
    await expect(adminItem).toContainText("Moderación: Oculta por moderación");
    await expect(adminItem).toContainText(hideReason);
    await expect(adminItem).toContainText("Visibilidad: Publicada por el destinatario");
    await expect(adminItem.getByRole("button", { name: "Restaurar", exact: true })).toBeVisible();
    const adminPanel = adminPage.getByRole("region", { name: "Referencias", exact: true });
    await expectNoRatings(adminPanel, "panel admin de referencias");
    await fullPageEvidence(adminPage, "t20-admin-moderacion-1440.png");

    // La ficha ya no la muestra (aunque el destinatario la tenga publicada).
    rawDirectory = await openDirectory(page, companyId, guideAId, users.company.name, guideAName);
    await expect(referencesRegion(page).getByText("Todavía no tiene referencias visibles.")).toBeVisible();
    await expectDirectoryWithout(page, directoryPath, rawDirectory, companyNeedle, "la ficha con la referencia moderada");

    // El destinatario ve el motivo y no tiene toggle; un PATCH forzado → 409 `reference_moderated`.
    await openHydrated(guideAPage, `/app/references?profile=${guideAId}&direction=received`, users.guideA.name);
    await selectTab(guideAPage, "Recibidas");
    await expect(received).toContainText("Estado: Oculta por moderación");
    await expect(received).toContainText(`Motivo de moderación: ${hideReason}`);
    await expect(received.getByRole("button", { name: /Publicar en mi ficha|Ocultar de mi ficha/ })).toHaveCount(0);
    await expectProblem(guideAPage, "PATCH", `/api/backend/v1/profiles/${guideAId}/references/${companyRefId}/visibility`,
      { visibility: "hidden" }, 409, "reference_moderated");
    await expectProblem(guideAPage, "PATCH", `/api/backend/v1/profiles/${guideAId}/references/${companyRefId}/visibility`,
      { visibility: "visible" }, 409, "reference_moderated");

    // Avisos in-app a autor y destinatario (`administrative_change`), sin texto ni motivo.
    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    const authorHidden = notificationItem(page, "Administración ocultó una referencia que escribiste");
    await expect(authorHidden).toHaveCount(1, { timeout: 60_000 });
    await expect(authorHidden).toContainText("Perfil");
    await expect(authorHidden.getByRole("link", { name: "Ver referencias" })).toHaveAttribute(
      "href", `/app/references?profile=${companyId}&direction=authored`);
    for (const needle of [companyNeedle, hideReason]) expect(await authorHidden.innerText()).not.toContain(needle);
    await openHydrated(guideAPage, `/app/notifications?profile=${guideAId}`, users.guideA.name);
    const subjectHidden = notificationItem(guideAPage, "Administración ocultó una referencia sobre tu perfil");
    await expect(subjectHidden).toHaveCount(1, { timeout: 60_000 });
    await expect(subjectHidden.getByRole("link", { name: "Ver referencias" })).toHaveAttribute(
      "href", `/app/references?profile=${guideAId}&direction=received`);
    for (const needle of [companyNeedle, hideReason]) expect(await subjectHidden.innerText()).not.toContain(needle);

    // Restaurar con motivo: vuelve a la ficha porque el destinatario la tenía publicada.
    await adminItem.getByRole("button", { name: "Restaurar", exact: true }).click();
    const restoreDialog = adminPage.getByRole("dialog", { name: "Restaurar la referencia" });
    await expect(restoreDialog).toBeVisible();
    await restoreDialog.getByLabel("Motivo (obligatorio)").fill(restoreReason);
    await expect(restoreDialog.getByLabel("Motivo (obligatorio)")).toHaveValue(restoreReason);
    const restored = adminPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/admin/references/${companyRefId}/moderate`) && response.request().method() === "POST");
    await restoreDialog.getByRole("button", { name: "Restaurar referencia" }).click();
    const restoreResponse = await restored;
    const restoreRaw = await restoreResponse.text();
    expect(restoreResponse.status(), restoreRaw).toBe(200);
    const restoredData = (JSON.parse(restoreRaw) as { data: { moderated: boolean; visibility: string; moderation_reason: string | null } }).data;
    expect(restoredData).toMatchObject({ moderated: false, visibility: "visible", moderation_reason: null });
    await expect(restoreDialog).toBeHidden();
    await expect(adminPage.getByRole("status").filter({ hasText: "Cambio aplicado y listado actualizado" }))
      .toContainText(`La referencia de «${companyName}» sobre «${guideAName}» quedó sin moderación. Publicada por el destinatario.`);
    await applyAdminFilter(adminPage, "Sin moderar");
    await expect(adminItem).toHaveCount(1);
    await expect(adminItem).toContainText("Moderación: Sin moderación");
    await expect(adminItem).toContainText("Visibilidad: Publicada por el destinatario");
    await expect(adminItem).not.toContainText(hideReason);

    await openDirectory(page, companyId, guideAId, users.company.name, guideAName);
    await expect(referencesRegion(page).locator(`li[data-reference-id="${companyRefId}"] blockquote`)).toHaveText(companyBody);
    await openHydrated(guideAPage, `/app/references?profile=${guideAId}&direction=received`, users.guideA.name);
    await selectTab(guideAPage, "Recibidas");
    await expect(received).toContainText("Estado: Publicada en tu ficha");
    await expect(received).not.toContainText("Motivo de moderación");
    await expect(received.getByRole("button", { name: "Ocultar de mi ficha" })).toBeVisible();

    await openHydrated(page, `/app/notifications?profile=${companyId}`, users.company.name);
    await expect(notificationItem(page, "Administración restauró una referencia que escribiste")).toHaveCount(1, { timeout: 60_000 });
    await expect(authorHidden).toHaveCount(1);
    await openHydrated(guideAPage, `/app/notifications?profile=${guideAId}`, users.guideA.name);
    await expect(notificationItem(guideAPage, "Administración restauró una referencia sobre tu perfil")).toHaveCount(1, { timeout: 60_000 });
    await expect(subjectHidden).toHaveCount(1);

    // Auditoría: una fila por transición real, con el motivo y sin el texto de la referencia.
    const audit = await sql(
      `SELECT action || '|' || reason || '|' || (position('${companyNeedle}' in coalesce(safe_changes::text, '')) > 0)::text FROM audit_logs WHERE target_type = 'reference' AND target_id = '${companyRefId}' ORDER BY id`,
    );
    expect(audit.split("\n")).toEqual([`reference.hidden|${hideReason}|false`, `reference.restored|${restoreReason}|false`]);
    expect(await sql(
      `SELECT count(*) FROM profile_notifications n JOIN profiles p ON p.id = n.profile_id WHERE n.type = 'administrative_change' AND p.public_id IN ('${companyId}', '${guideAId}') AND n.safe_data->>'reference_id' = '${companyRefId}'`,
    ), "avisos administrative_change de la referencia (2 ocultar + 2 restaurar)").toBe("4");
  } finally {
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideAContext.close();
    await guideBContext.close();
    await adminContext.close();
  }
});
