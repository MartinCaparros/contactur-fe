import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { deleteMail, login, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(new URL("../../docs/evidence/t13/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VIEWPORTS = [360, 390, 768, 1024, 1440] as const;

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t13/${filename}`, import.meta.url));
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

function syntheticPdf(): Buffer {
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj",
    "trailer<</Root 1 0 R/Size 4>>",
    "%%EOF",
    "",
  ].join("\n"), "latin1");
}

/**
 * El modal de la landing llega renderizado del servidor: si se escribe antes de que
 * React lo hidrate, el valor puede terminar en otro campo. Se espera a que el input
 * tenga su fiber de React adjunto, la señal concreta de que ya está hidratado.
 */
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

/** Navega por URL y espera el nombre de cuenta del header: garantiza hidratación. */
async function openHydrated(page: Page, path: string, userName: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("header").getByText(userName, { exact: true })).toBeVisible({ timeout: 30_000 });
}

function dayButton(page: Page, date: string): Locator {
  return page.locator(`button[data-date="${date}"]`);
}

/**
 * Muestra el mes de `date` y espera a que el día tenga estado real del servidor.
 *
 * Primero espera a que la grilla esté montada: si se decide "avanzar de mes" antes
 * de que exista, un día del mes actual parece ausente y se salta al mes siguiente.
 * Ese caso solo aparece cuando la fecha objetivo cae en el mes en curso.
 */
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

async function readVersion(page: Page, profileId: string, month: string): Promise<number> {
  const body = await page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, json: await response.json() as unknown };
  }, `/api/backend/v1/profiles/${profileId}/availability?month=${month}`);
  expect(body.status).toBe(200);
  const data = (body.json as { data: { version: number } }).data;
  return data.version;
}

/**
 * Captura de página completa desde arriba: con la página scrolleada, el header sticky
 * se dibuja en el medio de la captura y tapa contenido.
 */
async function fullPageEvidence(page: Page, filename: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ animations: "disabled", fullPage: true, path: evidencePath(filename) });
}

async function assertNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(sizes.scroll, `overflow horizontal a ${width}px`).toBeLessThanOrEqual(sizes.client);
}

test("T13 calendario real: teclado, lote explícito, 409 con borrador intacto, mini-calendario y empresa sin menú", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(600_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const ownerEmail = `t13-owner-${suffix}@example.test`;
  const adminEmail = `t13-admin-${suffix}@example.test`;
  const companyEmail = `t13-company-${suffix}@example.test`;
  const password = `T13-${crypto.randomUUID()}-Aa9!`;
  const ownerName = "Titular T13";
  const documentFilename = `habilitacion-t13-${suffix}.pdf`;
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const companyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const companyPage = await companyContext.newPage();

  try {
    // 1. Guía real con una ciudad y documento, hasta pendiente de habilitación.
    await registerAndVerify(page, request, ownerName, ownerEmail, password);
    await login(page, ownerEmail, password, ownerName);
    await page.getByRole("link", { name: "Crear perfil" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await page.getByRole("combobox", { name: /Categoría/ }).selectOption({ label: "Guía" });
    await page.getByLabel("Nombre visible").fill("Guía Calendario T13");
    await page.getByRole("button", { name: "Crear borrador" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "2. Datos y cobertura" })).toBeVisible();
    const profileId = new URL(page.url()).searchParams.get("profile");
    expect(profileId).toBeTruthy();
    if (!profileId) throw new Error("Missing profile id");
    await page.getByLabel("Descripción").fill("Guía de montaña para la demo del calendario.");
    await page.getByLabel("Email de contacto").fill(`contacto-${suffix}@example.test`);
    await page.getByLabel("Teléfono").fill("+54 9 2901 555131");
    await page.getByRole("combobox", { name: /Ciudad principal/ }).selectOption({ label: "Ushuaia" });
    await page.getByRole("group", { name: "Ciudades donde trabajás" })
      .getByRole("checkbox", { name: "Ushuaia" }).check();
    await page.getByRole("group", { name: "Idiomas" }).getByRole("checkbox", { name: "Español" }).check();
    await page.getByRole("group", { name: "Servicios" }).getByRole("checkbox", { name: "Guiado" }).check();
    await page.getByLabel("Resumen de formación").fill("Tecnicatura en guía de turismo.");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "3. Documentación requerida" })).toBeVisible();
    await page.getByLabel("Archivo PDF").setInputFiles({
      name: documentFilename,
      mimeType: "application/pdf",
      buffer: syntheticPdf(),
    });
    await page.getByLabel("Vigente hasta").fill(addDays(businessToday(), 400));
    await page.getByRole("button", { name: "Subir documento" }).click();
    await expect(page.getByText("Documento cargado y pendiente de revisión.")).toBeVisible();
    await page.getByRole("button", { name: "Continuar a revisión" }).click();
    await page.getByRole("checkbox", { name: /acepto los términos de demostración/i }).check();
    await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pendiente de habilitación manual" })).toBeVisible();

    // 2. Sin habilitación: el calendario se ve en solo lectura, no se esconde.
    const availabilityUrl = `/app/availability?profile=${profileId}`;
    await openHydrated(page, availabilityUrl, ownerName);
    await expect(page.getByRole("heading", { level: 1, name: "Disponibilidad" })).toBeVisible();
    await expect(page.getByText("Calendario en solo lectura")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver estado de acceso" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bloquear" })).toHaveCount(0);

    // 3. Habilitación manual real desde el backoffice.
    await registerAndVerify(adminPage, request, "Admin T13", adminEmail, password);
    const promotion = await adminCommand(adminEmail);
    promoted = true;
    expect(promotion).toContain("admin");
    await login(adminPage, adminEmail, password, "Admin T13");
    await adminPage.goto("/admin/profiles");
    await expect(adminPage.getByRole("heading", { level: 1, name: "Perfiles" })).toBeVisible();
    const profileCard = adminPage.locator(`[data-profile-id="${profileId}"]`);
    await expect(profileCard).toBeVisible();
    await profileCard.getByRole("button", { name: "Editar habilitación" }).click();
    const grantDialog = adminPage.getByRole("dialog");
    await grantDialog.getByLabel("Estado de la habilitación").selectOption("active");
    await grantDialog.getByLabel("Límite de ciudades").fill("3");
    await grantDialog.getByLabel("Límite mensual de solicitudes de contacto").fill("10");
    await grantDialog.getByLabel("Motivo (obligatorio)").fill("Demo T13: se habilita el calendario.");
    await grantDialog.getByRole("button", { name: "Guardar habilitación" }).click();
    await expect(profileCard.getByText("Acceso: Activo")).toBeVisible();

    // 4. Calendario editable: hoy diferenciado y no editable.
    const today = businessToday();
    const tomorrow = addDays(today, 1);
    const sameMonth = addDays(tomorrow, 3).slice(0, 7) === tomorrow.slice(0, 7);
    const firstDay = sameMonth ? tomorrow : `${addDays(tomorrow, 3).slice(0, 7)}-01`;
    const [d1, d2, conflictDraftDay, otherSessionDay] = [0, 1, 2, 3].map((offset) => addDays(firstDay, offset));
    const month = d1.slice(0, 7);

    await openHydrated(page, availabilityUrl, ownerName);
    await expect(page.getByText("Calendario en solo lectura")).toHaveCount(0);
    const todayButton = dayButton(page, today);
    await expect(todayButton).toBeVisible();
    await expect(todayButton).not.toHaveAttribute("data-state", "loading");
    await expect(todayButton).toBeDisabled();
    await expect(todayButton).toHaveAttribute("aria-label", /, hoy, bloqueado, no editable$/);
    await expect(todayButton).toContainText("HOY");
    await expect(page.getByText(/^Sin disponibilidad publicada en /)).toBeVisible();
    await fullPageEvidence(page, "01-calendario-1440-hoy-no-editable.png");

    const initialVersion = await readVersion(page, profileId, month);
    await showMonthOf(page, d1);

    // 5. Selección por teclado de dos días futuros y lote explícito.
    await dayButton(page, d1).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");
    await expect(dayButton(page, d2)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(dayButton(page, d1)).toHaveAttribute("aria-pressed", "true");
    await expect(dayButton(page, d2)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("2 días seleccionados.")).toBeVisible();
    await page.getByRole("button", { name: "Disponible en Ushuaia", exact: true }).click();
    await expect(dayButton(page, d1)).toHaveAttribute("aria-label", /disponible en Ushuaia, cambio sin guardar$/);
    await expect(page.getByRole("heading", { name: "2 cambios sin guardar" })).toBeVisible();
    await fullPageEvidence(page, "02-borrador-por-teclado-1440.png");

    const puts: string[] = [];
    page.on("request", (candidate) => {
      if (candidate.method() === "PUT" && candidate.url().includes("/availability")) puts.push(candidate.postData() ?? "");
    });
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(`Guardamos 2 días. Versión del calendario: ${initialVersion + 1}.`)).toBeVisible();
    expect(JSON.parse(puts[0] ?? "{}")).toStrictEqual({
      expected_version: initialVersion,
      days: [
        { date: d1, available: true, city_id: expect.any(Number) },
        { date: d2, available: true, city_id: expect.any(Number) },
      ],
    });
    await fullPageEvidence(page, "03-guardado-version-nueva-1440.png");

    // 6. Persisten tras recargar.
    await page.reload();
    await expect(page.locator("header").getByText(ownerName, { exact: true })).toBeVisible();
    await showMonthOf(page, d1);
    await expect(dayButton(page, d1)).toHaveAttribute("aria-label", /disponible en Ushuaia$/);
    await expect(dayButton(page, d2)).toHaveAttribute("aria-label", /disponible en Ushuaia$/);
    expect(await readVersion(page, profileId, month)).toBe(initialVersion + 1);

    // 7. Conflicto real: esta pestaña arma un borrador y otra sesión guarda antes.
    await dayButton(page, conflictDraftDay).click();
    await page.getByRole("button", { name: "Disponible en Ushuaia", exact: true }).click();
    await expect(dayButton(page, conflictDraftDay)).toHaveAttribute("aria-label", /cambio sin guardar$/);

    const otherTab = await page.context().newPage();
    await otherTab.setViewportSize({ width: 1440, height: 1000 });
    await openHydrated(otherTab, availabilityUrl, ownerName);
    await showMonthOf(otherTab, otherSessionDay);
    await dayButton(otherTab, otherSessionDay).click();
    await otherTab.getByRole("button", { name: "Disponible en Ushuaia", exact: true }).click();
    await otherTab.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(otherTab.getByText(`Versión del calendario: ${initialVersion + 2}.`)).toBeVisible();
    await otherTab.close();

    const putsBeforeConflict = puts.length;
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    const conflict = page.getByRole("alert").filter({ hasText: "Otra sesión cambió el calendario" });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText("No guardamos ni reenviamos tus cambios");
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await expect(dayButton(page, conflictDraftDay)).toHaveAttribute("aria-label", /disponible en Ushuaia, cambio sin guardar$/);
    await expect(page.getByRole("heading", { name: "1 cambio sin guardar" })).toBeVisible();
    expect(puts.length).toBe(putsBeforeConflict + 1);
    await fullPageEvidence(page, "04-conflicto-409-borrador-intacto-1440.png");

    await conflict.getByRole("button", { name: "Recargar calendario" }).click();
    await expect(dayButton(page, otherSessionDay)).toHaveAttribute("aria-label", /disponible en Ushuaia$/);
    await expect(dayButton(page, conflictDraftDay)).toHaveAttribute("aria-label", /cambio sin guardar$/);
    // Recargar no reenvía el lote.
    expect(puts.length).toBe(putsBeforeConflict + 1);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(`Guardamos 1 día. Versión del calendario: ${initialVersion + 3}.`)).toBeVisible();

    // 8. Responsive: sin overflow horizontal y área táctil ≥ 44 px en cada ancho.
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dayButton(page, d1)).toBeVisible();
      await assertNoHorizontalOverflow(page, width);
      const box = await dayButton(page, d1).boundingBox();
      expect(box?.height ?? 0, `alto de celda a ${width}px`).toBeGreaterThanOrEqual(44);
      const toolbarBox = await page.getByRole("button", { name: "Bloquear" }).boundingBox();
      expect(toolbarBox?.height ?? 0, `alto de acción a ${width}px`).toBeGreaterThanOrEqual(44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await fullPageEvidence(page, "05-calendario-390-mobile.png");

    // 9. Mini-calendario del resumen con los días guardados.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHydrated(page, `/app?profile=${profileId}`, ownerName);
    const mini = page.getByRole("region", { name: "Próximos 14 días" });
    await expect(mini).toBeVisible();
    const miniDays = mini.getByRole("list", { name: "Próximos 14 días desde mañana" }).getByRole("listitem");
    await expect(miniDays).toHaveCount(14);
    await expect(miniDays.first()).toHaveAttribute("data-date", tomorrow);
    for (const date of [d1, d2, conflictDraftDay, otherSessionDay]) {
      await expect(mini.locator(`li[data-date="${date}"]`)).toHaveAttribute("data-state", "available");
    }
    await expect(mini).toContainText("4 de 14 días disponibles desde mañana.");
    await expect(mini.getByRole("link", { name: "Editar disponibilidad" }))
      .toHaveAttribute("href", `/app/availability?profile=${profileId}`);
    await mini.screenshot({ animations: "disabled", path: evidencePath("06-mini-calendario-resumen-1440.png") });
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(page, width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await mini.screenshot({ animations: "disabled", path: evidencePath("07-mini-calendario-390-mobile.png") });

    // 10. Empresa turística: sin Disponibilidad en el menú ni mini-calendario.
    await registerAndVerify(companyPage, request, "Empresa T13", companyEmail, password);
    await login(companyPage, companyEmail, password, "Empresa T13");
    await companyPage.getByRole("link", { name: "Crear perfil" }).click();
    await companyPage.getByRole("combobox", { name: /Categoría/ }).selectOption({ label: "Empresa turística" });
    await companyPage.getByLabel("Nombre visible").fill("Empresa Calendario T13");
    await companyPage.getByRole("button", { name: "Crear borrador" }).click();
    await expect(companyPage.getByRole("heading", { level: 2, name: "2. Datos y cobertura" })).toBeVisible();
    const companyProfileId = new URL(companyPage.url()).searchParams.get("profile");
    expect(companyProfileId).toBeTruthy();
    await openHydrated(companyPage, `/app?profile=${companyProfileId}`, "Empresa T13");
    const companyNav = companyPage.getByRole("complementary", { name: "Navegación del perfil" });
    await expect(companyNav.getByText("Buscar")).toBeVisible();
    await expect(companyNav.getByText("Disponibilidad")).toHaveCount(0);
    await expect(companyPage.getByRole("region", { name: "Próximos 14 días" })).toHaveCount(0);
    await fullPageEvidence(companyPage, "08-empresa-sin-disponibilidad-1440.png");
    await openHydrated(companyPage, `/app/availability?profile=${companyProfileId}`, "Empresa T13");
    await expect(companyPage.getByRole("heading", { level: 1, name: "Sin calendario para este perfil" })).toBeVisible();
    await expect(companyPage.getByRole("grid")).toHaveCount(0);
  } finally {
    if (promoted) await adminCommand(adminEmail, ["--demote"]).catch(() => undefined);
    await adminContext.close();
    await companyContext.close();
  }
});
