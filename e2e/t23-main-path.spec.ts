import { mkdir } from "node:fs/promises";

import { expect, test, type Locator, type Page, type Response } from "@playwright/test";

import {
  NAVIGATION,
  addDays,
  adminCommand,
  api,
  businessToday,
  evidencePath as evidenceFor,
  expectApi,
  fakePhone,
  fullPageEvidence,
  futureBlockStart,
  loginHydrated,
  openHydrated,
  registerAndVerify,
  sql,
  syntheticPdf,
  ulid,
} from "./support/flows";

/**
 * T23 — Recorrido E2E principal de docs/pruebas.md, de punta a punta en una sola
 * corrida y por la UI: registrar guía y empresa → verificar con Mailpit → completar
 * ambos perfiles → bloqueo inicial → admin habilita → el guía publica días futuros en
 * Ushuaia → la empresa busca fecha/ciudad → ficha sin contacto → solicita con servicio
 * → el guía revisa la empresa y acepta → ambos ven el contacto → referencias cruzadas
 * → el destinatario publica una → admin vence el acceso → el perfil desaparece de la
 * búsqueda y sus operaciones se bloquean sin borrar historial.
 *
 * Solo dos pasos usan la API por el BFF, ambos de administración y ya probados por la
 * UI en T11: aprobar el documento del guía (para que la búsqueda muestre "Verificado")
 * y nada más. Todo lo demás es la interfaz real.
 */

const TASK = "t23";
const evidencePath = (filename: string) => evidenceFor(TASK, filename);

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t23-[a-z0-9-]+@example\.test$/);
  return value;
}

function contactNeedles(email: string, phone: string): string[] {
  return [email, phone, phone.replace(/\s+/g, ""), phone.replace(/\D/g, "")];
}

function expectNoContact(haystack: string, needles: readonly string[], where: string): void {
  for (const needle of needles) expect(haystack.includes(needle), `${where} contiene ${needle}`).toBe(false);
}

/** P18: ni el DOM vivo ni el HTML SSR ni el payload RSC de la ruta traen contacto. */
async function expectPageWithoutContact(page: Page, path: string, needles: readonly string[], where: string): Promise<void> {
  expectNoContact(await page.content(), needles, `DOM de ${where}`);
  const ssr = await page.request.get(path, { timeout: 120_000 });
  expect(ssr.ok(), `GET ${path}`).toBe(true);
  expectNoContact(await ssr.text(), needles, `HTML SSR de ${where}`);
  const rsc = await page.request.get(path, { headers: { RSC: "1" }, timeout: 120_000 });
  expectNoContact(await rsc.text(), needles, `payload RSC de ${where}`);
}

/** "Habilitada hasta" del diálogo admin: hora de Argentina, formato de datetime-local. */
function argentinaLocalInput(offsetMinutes: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + offsetMinutes * 60_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

type OnboardingInput = Readonly<{
  category: "Guía" | "Empresa turística";
  displayName: string;
  contactEmail: string;
  phone: string;
  documentFilename: string;
  fillSpecific: (page: Page) => Promise<void>;
}>;

/** Alta por la UI (pasos 1–4), como T10, para cualquiera de las dos categorías del recorrido. */
async function onboardViaUi(page: Page, input: OnboardingInput): Promise<string> {
  await page.getByRole("link", { name: "Crear perfil" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/, NAVIGATION);
  await expect(page.getByRole("heading", { level: 2, name: "1. Categoría y nombre" })).toBeVisible();
  await page.getByRole("combobox", { name: /Categoría/ }).selectOption({ label: input.category });
  await page.getByLabel("Nombre visible").fill(input.displayName);
  await page.getByRole("button", { name: "Crear borrador" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "2. Datos y cobertura" })).toBeVisible({ timeout: 60_000 });
  const profileId = ulid(new URL(page.url()).searchParams.get("profile"));
  await page.getByLabel("Descripción").fill(`Perfil del recorrido principal T23 (${input.category}).`);
  await page.getByLabel("Email de contacto").fill(input.contactEmail);
  await page.getByLabel("Teléfono").fill(input.phone);
  await page.getByRole("combobox", { name: /Ciudad principal/ }).selectOption({ label: "Ushuaia" });
  await page.getByRole("group", { name: "Ciudades donde trabajás" }).getByRole("checkbox", { name: "Ushuaia" }).check();
  await page.getByRole("group", { name: "Idiomas" }).getByRole("checkbox", { name: "Español" }).check();
  await page.getByRole("group", { name: "Servicios" }).getByRole("checkbox", { name: "Guiado" }).check();
  await input.fillSpecific(page);
  await page.getByRole("button", { name: "Guardar y continuar" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "3. Documentación requerida" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Continuar a revisión" })).toBeDisabled();
  await page.getByLabel("Archivo PDF").setInputFiles({
    name: input.documentFilename,
    mimeType: "application/pdf",
    buffer: syntheticPdf(),
  });
  const validUntil = page.getByLabel("Vigente hasta");
  if (await validUntil.count() > 0) await validUntil.fill(addDays(businessToday(), 400));
  await page.getByRole("button", { name: "Subir documento" }).click();
  await expect(page.getByText("Documento cargado y pendiente de revisión.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continuar a revisión" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "4. Revisión y términos" })).toBeVisible();
  await page.getByRole("checkbox", { name: /acepto los términos de demostración/i }).check();
  await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Pendiente de habilitación manual" })).toBeVisible({ timeout: 60_000 });
  return profileId;
}

function profileNav(page: Page): Locator {
  return page.getByRole("complementary", { name: "Navegación del perfil" });
}

async function openFromMenu(page: Page, profileId: string, userName: string, label: string, heading: string): Promise<void> {
  await openHydrated(page, `/app?profile=${profileId}`, userName);
  await profileNav(page).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible(NAVIGATION);
}

/** Habilitación manual por el diálogo del backoffice (T11), con motivo obligatorio. */
async function editGrantViaUi(
  adminPage: Page,
  profileId: string,
  options: Readonly<{ status: "active"; expiresAt?: string; reason: string }>,
): Promise<Locator> {
  await adminPage.goto("/admin/profiles");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Perfiles" })).toBeVisible({ timeout: 60_000 });
  const card = adminPage.locator(`[data-profile-id="${profileId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole("button", { name: "Editar habilitación" }).click();
  const dialog = adminPage.getByRole("dialog");
  await expect(dialog).toContainText("No es un pago ni una suscripción");
  await dialog.getByLabel("Estado de la habilitación").selectOption(options.status);
  await dialog.getByLabel("Límite de ciudades").fill("3");
  await dialog.getByLabel("Límite mensual de solicitudes de contacto").fill("10");
  if (options.expiresAt !== undefined) await dialog.getByLabel("Habilitada hasta").fill(options.expiresAt);
  await dialog.getByLabel("Motivo (obligatorio)").fill(options.reason);
  await dialog.getByRole("button", { name: "Guardar habilitación" }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  return card;
}

function dayButton(page: Page, date: string): Locator {
  return page.locator(`button[data-date="${date}"]`);
}

/** Muestra el mes de `date` con estado real del servidor (copia de T13). */
async function showMonthOf(page: Page, date: string): Promise<void> {
  const target = dayButton(page, date);
  const grid = page.getByRole("grid");
  for (let step = 0; step < 3 && await target.count() === 0; step += 1) {
    await expect(grid).toBeVisible();
    await expect(grid).not.toHaveAttribute("aria-busy", "true");
    if (await target.count() > 0) break;
    await page.getByRole("button", { name: /^Mes siguiente/ }).click();
  }
  await expect(target).toBeVisible();
  await expect(target).not.toHaveAttribute("data-state", "loading");
}

async function runSearch(page: Page, tag: string, from: string, to: string): Promise<void> {
  await page.getByLabel("Categoría").selectOption("guide");
  await page.getByLabel("Nombre").fill(tag);
  await page.getByLabel("Ciudad").selectOption({ label: "Ushuaia" });
  await page.getByLabel("Desde").fill(from);
  await page.getByLabel("Hasta").fill(to);
  await page.getByRole("button", { name: "Buscar perfiles" }).click();
}

function requestReferenceRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Referencia", exact: true });
}

async function writeReference(page: Page, actorId: string, requestId: string, counterpartName: string, body: string): Promise<string> {
  const section = requestReferenceRegion(page);
  const textarea = section.getByLabel(`Dejá una referencia sobre ${counterpartName}`);
  await expect(textarea).toBeVisible({ timeout: 60_000 });
  await textarea.fill(body);
  await expect(textarea).toHaveValue(body);
  const created = page.waitForResponse((response: Response) =>
    response.url().endsWith(`/profiles/${actorId}/contact-requests/${requestId}/references`) && response.request().method() === "POST");
  await section.getByRole("button", { name: "Enviar referencia" }).click();
  const response = await created;
  const raw = await response.text();
  expect(response.status(), raw).toBe(201);
  return ulid((JSON.parse(raw) as { data: { id: string } }).data.id);
}

test("T23 recorrido principal por la UI: alta → habilitación → match → contacto → referencias → vencimiento", async ({
  browser,
  request,
}) => {
  test.setTimeout(1_800_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T23-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T23-${crypto.randomUUID()}-Aa9!`;
  const users = {
    guide: { name: "Guía T23", email: syntheticEmail(`t23-main-guide-${suffix}@example.test`) },
    company: { name: "Empresa T23", email: syntheticEmail(`t23-main-company-${suffix}@example.test`) },
    admin: { name: "Admin T23", email: syntheticEmail(`t23-main-admin-${suffix}@example.test`) },
  };
  const guideName = `Guía Austral ${tag}`;
  const companyName = `Empresa Fueguina ${tag}`;
  const guideContact = { email: `t23-contacto-guia-${suffix}@example.test`, phone: fakePhone() };
  const companyContact = { email: `t23-contacto-empresa-${suffix}@example.test`, phone: fakePhone() };
  const guideNeedles = [...contactNeedles(guideContact.email, guideContact.phone), users.guide.email];
  const companyNeedles = [...contactNeedles(companyContact.email, companyContact.phone), users.company.email];
  const companyReference = `La coordinación con ${guideName} fue puntual y clara durante todo el recorrido (${tag}).`;
  const guideReference = `${companyName} envió la información del grupo con tiempo y respetó lo acordado (${tag}).`;
  let promoted = false;

  await mkdir(evidencePath(""), { recursive: true });
  const guideContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guidePage = await guideContext.newPage();
  const companyPage = await companyContext.newPage();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Registro y verificación por Mailpit (UI) de guía y empresa; alta completa por la UI.
    await registerAndVerify(guidePage, request, users.guide.name, users.guide.email, password);
    await loginHydrated(guidePage, users.guide.email, password, users.guide.name);
    const guideId = await onboardViaUi(guidePage, {
      category: "Guía",
      displayName: guideName,
      contactEmail: guideContact.email,
      phone: guideContact.phone,
      documentFilename: `habilitacion-guia-t23-${suffix}.pdf`,
      fillSpecific: (page) => page.getByLabel("Resumen de formación").fill("Tecnicatura en guía de turismo y montaña."),
    });

    await registerAndVerify(companyPage, request, users.company.name, users.company.email, password);
    await loginHydrated(companyPage, users.company.email, password, users.company.name);
    const companyId = await onboardViaUi(companyPage, {
      category: "Empresa turística",
      displayName: companyName,
      contactEmail: companyContact.email,
      phone: companyContact.phone,
      documentFilename: `registro-empresa-t23-${suffix}.pdf`,
      fillSpecific: async (page) => {
        await page.getByLabel("Razón social").fill(`${companyName} SA`);
        await page.getByLabel("Años de actividad").fill("7");
      },
    });

    // 2. Bloqueo inicial: sin habilitación el calendario es de solo lectura y la búsqueda se niega.
    await openFromMenu(guidePage, guideId, users.guide.name, "Disponibilidad", "Disponibilidad");
    await expect(guidePage.getByText("Calendario en solo lectura")).toBeVisible();
    await expect(guidePage.getByRole("button", { name: "Guardar cambios" })).toHaveCount(0);
    await openFromMenu(companyPage, companyId, users.company.name, "Buscar", "Buscar profesionales");
    await expect(companyPage.getByText("Este perfil todavía no tiene una habilitación vigente para usar el directorio.")).toBeVisible({ timeout: 60_000 });
    const blockedSearch = await api(companyPage, "GET", `/api/backend/v1/profiles/${companyId}/search`);
    expect(blockedSearch.status).toBe(403);
    expect((blockedSearch.json?.error as { code?: string } | undefined)?.code).toBe("subscription_required");
    await fullPageEvidence(companyPage, evidencePath("t23-main-01-busqueda-bloqueada-1440.png"));

    // 3. Admin (promovido por consola) aprueba el documento del guía y habilita ambos por la UI.
    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    const guideDocuments = await expectApi(guidePage, "GET", `/api/backend/v1/profiles/${guideId}/documents`);
    const guideDocumentId = ulid((guideDocuments.data as Array<{ id: string }>)[0]?.id);
    await expectApi(adminPage, "POST", `/api/backend/v1/admin/documents/${guideDocumentId}/review`, { action: "approve" });
    const guideCard = await editGrantViaUi(adminPage, guideId, { status: "active", reason: `Recorrido T23 ${tag}: habilitación del guía.` });
    await expect(guideCard.getByText("Acceso: Activo")).toBeVisible({ timeout: 60_000 });
    const companyCard = await editGrantViaUi(adminPage, companyId, { status: "active", reason: `Recorrido T23 ${tag}: habilitación de la empresa.` });
    await expect(companyCard.getByText("Acceso: Activo")).toBeVisible({ timeout: 60_000 });

    // 4. El guía publica tres días futuros en Ushuaia por teclado en el calendario.
    const d1 = futureBlockStart(3);
    const d2 = addDays(d1, 1);
    const d3 = addDays(d1, 2);
    await openFromMenu(guidePage, guideId, users.guide.name, "Disponibilidad", "Disponibilidad");
    await expect(guidePage.getByText("Calendario en solo lectura")).toHaveCount(0);
    await showMonthOf(guidePage, d1);
    await dayButton(guidePage, d1).focus();
    await guidePage.keyboard.press("Enter");
    await guidePage.keyboard.press("ArrowRight");
    await expect(dayButton(guidePage, d2)).toBeFocused();
    await guidePage.keyboard.press("Space");
    await guidePage.keyboard.press("ArrowRight");
    await expect(dayButton(guidePage, d3)).toBeFocused();
    await guidePage.keyboard.press("Space");
    await expect(guidePage.getByText("3 días seleccionados.")).toBeVisible();
    await guidePage.getByRole("button", { name: "Disponible en Ushuaia", exact: true }).click();
    await guidePage.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(guidePage.getByText(/^Guardamos 3 días\. Versión del calendario: \d+\.$/)).toBeVisible({ timeout: 60_000 });
    for (const date of [d1, d2, d3]) {
      await expect(dayButton(guidePage, date)).toHaveAttribute("aria-label", /disponible en Ushuaia$/);
    }

    // 5. La empresa busca por fecha y ciudad y abre la ficha: sin contacto en DOM, SSR ni RSC.
    await openFromMenu(companyPage, companyId, users.company.name, "Buscar", "Buscar profesionales");
    await runSearch(companyPage, tag, d1, d3);
    const resultCard = companyPage.getByRole("article", { name: guideName });
    await expect(resultCard).toBeVisible({ timeout: 60_000 });
    await expect(resultCard).toContainText("Disponible los 3 días");
    await expect(resultCard).toContainText("Verificado");
    expectNoContact(await companyPage.content(), guideNeedles, "DOM de resultados");
    await fullPageEvidence(companyPage, evidencePath("t23-main-02-busqueda-resultado-1440.png"));
    await resultCard.getByRole("link", { name: `Ver ficha de ${guideName}` }).click();
    await expect(companyPage).toHaveURL(`/app/profiles/${guideId}?profile=${companyId}`, NAVIGATION);
    await expect(companyPage.getByRole("heading", { level: 1, name: guideName })).toBeVisible();
    await expectPageWithoutContact(companyPage, `/app/profiles/${guideId}?profile=${companyId}`, guideNeedles, "ficha del guía");

    // 6. Solicita indicando el servicio, las fechas y la ciudad.
    const service = `Guiado de trekking para 8 personas en Ushuaia (${tag}).`;
    const form = companyPage.getByRole("form", { name: "Solicitud de contacto" });
    await form.getByLabel("Servicio solicitado").fill(service);
    await form.getByLabel("Desde (opcional)").fill(d1);
    await form.getByLabel("Hasta (opcional)").fill(d3);
    await form.getByLabel("Ciudad (opcional)").selectOption({ label: "Ushuaia" });
    const created = companyPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/profiles/${companyId}/contact-requests`) && response.request().method() === "POST");
    await form.getByRole("button", { name: "Enviar solicitud" }).click();
    const createdResponse = await created;
    const createdRaw = await createdResponse.text();
    expect(createdResponse.status(), createdRaw).toBe(201);
    expectNoContact(createdRaw, guideNeedles, "respuesta del envío");
    const requestId = ulid((JSON.parse(createdRaw) as { data: { id: string } }).data.id);
    await expect(companyPage.getByRole("heading", { name: `Solicitud enviada a ${guideName}` })).toBeVisible();

    // 7. El guía la ve en Solicitudes, revisa la empresa (ficha segura, sin contacto) y acepta.
    await openFromMenu(guidePage, guideId, users.guide.name, "Solicitudes", "Solicitudes");
    const received = guidePage.getByRole("article", { name: companyName, exact: true });
    await expect(received).toContainText("Estado: Pendiente", { timeout: 60_000 });
    await received.getByRole("link", { name: `Ver solicitud de ${companyName}` }).click();
    await expect(guidePage).toHaveURL(`/app/requests/${requestId}?profile=${guideId}`, NAVIGATION);
    await expect(guidePage.getByRole("heading", { level: 1, name: `Solicitud de ${companyName}` })).toBeVisible();
    await expect(guidePage.getByText(service)).toBeVisible();
    const companySection = guidePage.getByRole("region", { name: "Empresa solicitante" });
    await expect(companySection.getByRole("heading", { level: 3, name: companyName })).toBeVisible();
    await expect(companySection).toContainText("Es la ficha segura del perfil: no incluye datos de contacto.");
    await expectPageWithoutContact(guidePage, `/app/requests/${requestId}?profile=${guideId}`, companyNeedles, "detalle pendiente (guía)");
    await guidePage.getByRole("button", { name: "Aceptar", exact: true }).click();
    const acceptDialog = guidePage.getByRole("dialog", { name: "¿Aceptar la solicitud?" });
    await expect(acceptDialog.getByRole("button", { name: "Volver" })).toBeFocused();
    await acceptDialog.getByRole("button", { name: "Aceptar solicitud" }).click();
    await expect(guidePage.getByText("Estado: Aceptada")).toBeVisible({ timeout: 60_000 });

    // 8. Ambos acceden al contacto bajo demanda.
    await guidePage.getByRole("button", { name: "Ver datos de contacto" }).click();
    const companyContactCard = guidePage.getByRole("article", { name: companyName, exact: true });
    await expect(companyContactCard).toContainText(companyContact.email, { timeout: 60_000 });
    await expect(companyContactCard).toContainText(companyContact.phone);
    await openHydrated(companyPage, `/app/requests/${requestId}?profile=${companyId}`, users.company.name);
    await expect(companyPage.getByText("Estado: Aceptada")).toBeVisible({ timeout: 60_000 });
    await companyPage.getByRole("button", { name: "Ver datos de contacto" }).click();
    const guideContactCard = companyPage.getByRole("article", { name: guideName, exact: true });
    await expect(guideContactCard).toContainText(guideContact.email, { timeout: 60_000 });
    await expect(guideContactCard).toContainText(guideContact.phone);
    await fullPageEvidence(companyPage, evidencePath("t23-main-03-contacto-aceptado-1440.png"));

    // 9. Referencias cruzadas desde el detalle; ambas nacen ocultas.
    await openHydrated(companyPage, `/app/requests/${requestId}?profile=${companyId}`, users.company.name);
    const companyRefId = await writeReference(companyPage, companyId, requestId, guideName, companyReference);
    await openHydrated(guidePage, `/app/requests/${requestId}?profile=${guideId}`, users.guide.name);
    const guideRefId = await writeReference(guidePage, guideId, requestId, companyName, guideReference);
    expect(guideRefId).not.toBe(companyRefId);

    // 10. El destinatario (guía) publica la referencia de la empresa; la ficha la muestra.
    await openFromMenu(guidePage, guideId, users.guide.name, "Referencias", "Referencias");
    const receivedTab = guidePage.getByRole("tab", { name: "Recibidas" });
    if ((await receivedTab.getAttribute("aria-selected")) !== "true") await receivedTab.click();
    await expect(guidePage.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    const receivedReference = guidePage.getByRole("tabpanel").getByRole("article", { name: companyName, exact: true });
    await expect(receivedReference).toContainText("Estado: Oculta en tu ficha");
    await receivedReference.getByRole("button", { name: "Publicar en mi ficha" }).click();
    await expect(receivedReference).toContainText("Estado: Publicada en tu ficha", { timeout: 60_000 });
    await openHydrated(companyPage, `/app/profiles/${guideId}?profile=${companyId}`, users.company.name);
    const publicReferences = companyPage.getByRole("region", { name: "Referencias", exact: true });
    await expect(publicReferences.locator(`li[data-reference-id="${companyRefId}"]`)).toContainText(companyReference, { timeout: 60_000 });
    await fullPageEvidence(companyPage, evidencePath("t23-main-04-ficha-con-referencia-1440.png"));

    // 11. Admin vence el acceso del guía por la UI (vencimiento ya pasado, sin scheduler).
    const expiredCard = await editGrantViaUi(adminPage, guideId, {
      status: "active",
      expiresAt: argentinaLocalInput(-10),
      reason: `Recorrido T23 ${tag}: vencimiento del acceso del guía.`,
    });
    await expect(expiredCard.getByText("Acceso: Vencido")).toBeVisible({ timeout: 60_000 });
    await expiredCard.screenshot({ animations: "disabled", path: evidencePath("t23-main-05-admin-vence-acceso.png") });

    // 12. El perfil desaparece de la búsqueda y su ficha deja de estar disponible.
    await openFromMenu(companyPage, companyId, users.company.name, "Buscar", "Buscar profesionales");
    await runSearch(companyPage, tag, d1, d3);
    await expect(companyPage.getByRole("heading", { name: "Ningún perfil coincide con estos filtros" })).toBeVisible({ timeout: 60_000 });
    await expect(companyPage.getByRole("article", { name: guideName })).toHaveCount(0);
    await openHydrated(companyPage, `/app/profiles/${guideId}?profile=${companyId}`, users.company.name);
    await expect(companyPage.getByRole("heading", { level: 1, name: "Perfil no disponible" })).toBeVisible({ timeout: 60_000 });

    // 13. Operaciones del guía bloqueadas, historial intacto.
    await openFromMenu(guidePage, guideId, users.guide.name, "Acceso", "Acceso del perfil");
    await expect(guidePage.getByText("Vencido", { exact: true })).toBeVisible();
    await openFromMenu(guidePage, guideId, users.guide.name, "Disponibilidad", "Disponibilidad");
    await expect(guidePage.getByText("Calendario en solo lectura")).toBeVisible();
    await openFromMenu(guidePage, guideId, users.guide.name, "Solicitudes", "Solicitudes");
    await expect(guidePage.getByRole("article", { name: companyName, exact: true })).toContainText("Estado: Aceptada", { timeout: 60_000 });
    await openHydrated(guidePage, `/app/requests/${requestId}?profile=${guideId}`, users.guide.name);
    await expect(guidePage.getByText(service)).toBeVisible();
    await guidePage.getByRole("button", { name: "Ver datos de contacto" }).click();
    await expect(guidePage.getByText(/La habilitación de tu perfil venció\..*Mientras tanto no se muestran datos de contacto\./)).toBeVisible({ timeout: 60_000 });
    expectNoContact(await guidePage.content(), companyNeedles, "detalle del guía vencido");
    await fullPageEvidence(guidePage, evidencePath("t23-main-06-guia-vencido-historial-1440.png"));

    await openHydrated(companyPage, `/app/requests/${requestId}?profile=${companyId}`, users.company.name);
    await expect(companyPage.getByText("Estado: Aceptada")).toBeVisible({ timeout: 60_000 });
    await companyPage.getByRole("button", { name: "Ver datos de contacto" }).click();
    await expect(companyPage.getByText("Los datos de contacto no están disponibles en este momento porque la otra parte no puede concretar el contacto. Probá más adelante.")).toBeVisible({ timeout: 60_000 });
    expectNoContact(await companyPage.content(), guideNeedles, "detalle de la empresa con el guía vencido");

    await openFromMenu(guidePage, guideId, users.guide.name, "Referencias", "Referencias");
    await expect(guidePage.getByRole("tabpanel")).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
    await expect(guidePage.getByRole("tabpanel").getByRole("article", { name: companyName, exact: true }))
      .toContainText("Estado: Publicada en tu ficha");

    // Sin borrado: la solicitud, las dos referencias y el documento siguen en la base.
    expect(await sql(`SELECT status FROM contact_requests WHERE public_id = '${requestId}'`)).toBe("accepted");
    expect(await sql(`SELECT count(*) FROM "references" r JOIN contact_requests c ON c.id = r.contact_request_id WHERE c.public_id = '${requestId}'`)).toBe("2");
    expect(await sql(`SELECT count(*) FROM availability_days a JOIN profiles p ON p.id = a.profile_id WHERE p.public_id = '${guideId}' AND a.date BETWEEN '${d1}' AND '${d3}'`)).toBe("3");
  } finally {
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await guideContext.close();
    await companyContext.close();
    await adminContext.close();
  }
});
