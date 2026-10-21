import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { deleteMail, login, waitForMail } from "./support/mailpit";

const run = promisify(execFile);

const EVIDENCE_DIRECTORY = fileURLToPath(
  new URL("../../docs/evidence/t11/", import.meta.url),
);

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t11/${filename}`, import.meta.url));
}

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Promover a administrador es deliberadamente imposible por API: sería una escalada de
 * privilegios. La única vía es el comando de consola, el mismo que usa un operador en
 * una instalación limpia.
 */
async function adminCommand(email: string, extra: readonly string[] = []): Promise<string> {
  const { stdout } = await run(
    "docker",
    ["compose", "exec", "-T", "backend", "php", "artisan", "contactur:admin", email, ...extra],
    { cwd: REPO_ROOT },
  );
  return stdout;
}

/** PDF mínimo real: arranca con %PDF-, sin contenido ejecutable ni marcado mixto. */
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

function isoDateIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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
  await registration.getByLabel("Nombre").fill(name);
  await registration.getByLabel("Email").fill(email);
  await registration.getByLabel("Contraseña", { exact: true }).fill(password);
  await registration.getByLabel("Confirmar contraseña").fill(password);
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

test("T11 backoffice real: habilita la demo completa y un usuario normal no accede", async ({
  page,
  browser,
  request,
}) => {
  // Dos cuentas con sesiones simultáneas, un alta documental completa, cinco pantallas
  // del backoffice y dos vueltas por Mailpit: no entra en el timeout global.
  test.setTimeout(900_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const adminEmail = `t11-admin-${suffix}@example.test`;
  const ownerEmail = `t11-owner-${suffix}@example.test`;
  const password = `T11-${crypto.randomUUID()}-Aa9!`;
  // Nombre único por corrida: la cola documental del backoffice lista documentos de
  // todos los perfiles, así que un nombre repetido haría ambiguo el localizador.
  const documentFilename = `habilitacion-t11-${suffix}.pdf`;
  let promoted = false;

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  // El titular conserva su sesión durante todo el recorrido: así se puede comprobar que
  // habilitar y suspender desde el backoffice impactan sobre una sesión viva.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  try {
    // 1. Titular: cuenta real, perfil de guía completo y un documento pendiente.
    await registerAndVerify(page, request, "Titular T11", ownerEmail, password);
    await login(page, ownerEmail, password, "Titular T11");
    await page.getByRole("link", { name: "Crear perfil" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await page.getByRole("combobox", { name: /Categoría/ }).selectOption({ label: "Guía" });
    await page.getByLabel("Nombre visible").fill("Guía Backoffice T11");
    await page.getByRole("button", { name: "Crear borrador" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "2. Datos y cobertura" })).toBeVisible();
    const profileId = new URL(page.url()).searchParams.get("profile");
    expect(profileId).toBeTruthy();
    await page.getByLabel("Descripción").fill("Guía de montaña para la demo administrativa.");
    await page.getByLabel("Email de contacto").fill(`contacto-${suffix}@example.test`);
    await page.getByLabel("Teléfono").fill("+54 9 2901 555111");
    await page.getByRole("combobox", { name: /Ciudad principal/ }).selectOption({ label: "Ushuaia" });
    await page.getByRole("group", { name: "Ciudades donde trabajás" })
      .getByRole("checkbox", { name: "Ushuaia" }).check();
    await page.getByRole("group", { name: "Idiomas" })
      .getByRole("checkbox", { name: "Español" }).check();
    await page.getByRole("group", { name: "Servicios" })
      .getByRole("checkbox", { name: "Guiado" }).check();
    await page.getByLabel("Resumen de formación").fill("Tecnicatura en guía de turismo.");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    await expect(page.getByRole("heading", { level: 2, name: "3. Documentación requerida" })).toBeVisible();
    await page.getByLabel("Archivo PDF").setInputFiles({
      name: documentFilename,
      mimeType: "application/pdf",
      buffer: syntheticPdf(),
    });
    await page.getByLabel("Vigente hasta").fill(isoDateIn(400));
    await page.getByRole("button", { name: "Subir documento" }).click();
    await expect(page.getByText("Documento cargado y pendiente de revisión.")).toBeVisible();
    await page.getByRole("button", { name: "Continuar a revisión" }).click();
    await page.getByRole("checkbox", { name: /acepto los términos de demostración/i }).check();
    await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pendiente de habilitación manual" })).toBeVisible();

    // Un usuario normal no accede al backoffice: el guard lo devuelve a su shell.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app(\?|$)/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Guía Backoffice T11" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cuentas" })).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("01-usuario-normal-no-accede-al-backoffice.png"),
    });

    // 2. Administración: cuenta real promovida por consola, la única vía posible.
    await registerAndVerify(adminPage, request, "Admin T11", adminEmail, password);
    const promotion = await adminCommand(adminEmail);
    promoted = true;
    expect(promotion).toContain("admin");
    expect(promotion).not.toMatch(/\$2y\$/);

    await login(adminPage, adminEmail, password, "Admin T11");
    await adminPage.goto("/admin");
    await expect(adminPage.getByRole("heading", { level: 1, name: "Panel administrativo" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { level: 3, name: "Perfiles por categoría" })).toBeVisible();
    // Desde T17 las solicitudes de contacto y desde T19 las consultas de soporte tienen
    // tabla real: ninguna de las dos se informa como "sin fuente" y ambas muestran número.
    const supportCard = adminPage.locator('[data-metric="support_inquiries_pending"]');
    await expect(supportCard).not.toHaveAttribute("data-source", "missing");
    await expect(supportCard).toContainText("Consultas de soporte sin responder");
    await expect(supportCard).toContainText(/\d+/);
    await expect(adminPage.getByText("Sin fuente de datos todavía")).toHaveCount(0);
    const requestsCard = adminPage.locator('[data-metric="contact_requests_by_status"]');
    await expect(requestsCard).not.toHaveAttribute("data-source", "missing");
    await expect(requestsCard).toContainText("Solicitudes de contacto");
    await expect(requestsCard).toContainText(/Pendientes: \d+ · Aceptadas: \d+ · Rechazadas: \d+ · Vencidas: \d+ · Canceladas: \d+/);
    await adminPage.locator(`[class*="metricGrid"]`).first().screenshot({
      animations: "disabled",
      path: evidencePath("02-panel-metricas-sin-inventar-datos.png"),
    });
    await adminPage.locator("article")
      .filter({ has: adminPage.getByRole("heading", { level: 3, name: "Perfiles por categoría" }) })
      .screenshot({
        animations: "disabled",
        path: evidencePath("03-panel-metricas-desgloses.png"),
      });

    // 3. Revisión documental real: descarga por la ruta protegida y aprobación.
    await adminPage.getByRole("link", { name: "Documentos", exact: true }).click();
    await expect(adminPage.getByRole("heading", { level: 1, name: "Documentos" })).toBeVisible();
    await expect(adminPage.getByText(/Estado consultado: pendientes\./)).toBeVisible();
    const documentCard = adminPage.locator("li", { hasText: documentFilename }).first();
    // La cola es global y pagina de a 25: con pendientes de otras corridas (p. ej. los
    // guías de T18) el documento puede quedar en una página posterior. Se avanza por
    // cursor como lo haría la persona revisora, sin filtrar por nada que el spec no sepa.
    const nextPage = adminPage.getByRole("navigation", { name: "Paginación por cursor" })
      .getByRole("button", { name: "Página siguiente" });
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      try {
        await expect(documentCard).toBeVisible({ timeout: 8_000 });
        break;
      } catch {
        if (!(await nextPage.isEnabled())) break;
        await nextPage.click();
      }
    }
    await expect(documentCard).toBeVisible();
    await documentCard.screenshot({
      animations: "disabled",
      path: evidencePath("04-cola-documental-pendiente.png"),
    });

    const download = adminPage.waitForEvent("download");
    await documentCard.getByRole("button", { name: "Descargar archivo" }).click();
    expect((await download).suggestedFilename()).toBe(documentFilename);

    await documentCard.getByRole("button", { name: "Aprobar documento" }).click();
    const reviewDialog = adminPage.getByRole("dialog");
    await expect(reviewDialog).toContainText("Aprobar no admite motivo");
    await reviewDialog.getByRole("button", { name: "Aprobar documento" }).click();
    await expect(adminPage.getByRole("status").filter({ hasText: "quedó en estado Aprobado" }))
      .toBeVisible();
    await adminPage.screenshot({
      animations: "disabled",
      path: evidencePath("05-documento-aprobado-sin-conceder-acceso.png"),
    });

    // 4. Habilitación manual con motivo y versión esperada.
    await adminPage.getByRole("link", { name: "Perfiles", exact: true }).click();
    await expect(adminPage.getByRole("heading", { level: 1, name: "Perfiles" })).toBeVisible();
    const profileCard = adminPage.locator(`[data-profile-id="${profileId}"]`);
    await expect(profileCard).toBeVisible();
    await expect(profileCard).toContainText("Sin habilitación registrada (versión 0)");
    await expect(profileCard.getByText("Acceso: Inactivo")).toBeVisible();
    await profileCard.getByRole("button", { name: "Editar habilitación" }).click();

    const grantDialog = adminPage.getByRole("dialog");
    await expect(grantDialog).toContainText("No es un pago ni una suscripción");
    await expect(adminPage.locator("[data-grant-expected-version]"))
      .toHaveAttribute("data-grant-expected-version", "0");
    await grantDialog.getByLabel("Estado de la habilitación").selectOption("active");
    await grantDialog.getByLabel("Límite de ciudades").fill("3");
    await grantDialog.getByLabel("Límite mensual de solicitudes de contacto").fill("10");
    await grantDialog.getByLabel("Galería habilitada").check();
    await grantDialog.getByLabel("Motivo (obligatorio)")
      .fill("Documentación aprobada: se habilita la demo completa.");
    await grantDialog.getByRole("button", { name: "Guardar habilitación" }).click();

    const grantNotice = adminPage.getByRole("status").filter({ hasText: "versión 1" });
    await expect(grantNotice).toBeVisible();
    await expect(grantNotice).toContainText("El estado del perfil no cambió");
    await expect(profileCard.getByText("Acceso: Activo")).toBeVisible();
    await profileCard.screenshot({
      animations: "disabled",
      path: evidencePath("06-habilitacion-manual-activa.png"),
    });

    // 5. Auditoría: los dos eventos quedaron registrados sin datos sensibles.
    await adminPage.getByRole("link", { name: "Auditoría", exact: true }).click();
    await expect(adminPage.getByRole("heading", { level: 1, name: "Auditoría" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { level: 3, name: "Habilitación manual reemplazada" }).first())
      .toBeVisible();
    await expect(adminPage.getByRole("heading", { level: 3, name: "Documento aprobado" }).first())
      .toBeVisible();
    const auditBody = await adminPage.locator("main").textContent();
    expect(auditBody).not.toContain(ownerEmail);
    expect(auditBody).not.toContain(adminEmail);
    expect(auditBody).toContain("Documentación aprobada: se habilita la demo completa.");
    await adminPage.locator("li[data-audit-id]").first().screenshot({
      animations: "disabled",
      path: evidencePath("07-auditoria-evento-sin-datos-sensibles.png"),
    });

    // 6. La habilitación impacta sobre la sesión viva del titular: demo completa. Con el
    // host cargado el shell llegó a tardar más de 30 s en resolver /me + perfil + acceso.
    await page.goto("/app/access");
    await expect(page.getByRole("heading", { level: 1, name: "Acceso del perfil" })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Activo", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Funciones restringidas" })).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("08-titular-con-acceso-activo.png"),
    });
    await page.goto("/app/profile");
    await expect(page.getByRole("heading", { level: 1, name: "Editar perfil" })).toBeVisible();
    // La galería habilitada por el grant deja de estar bloqueada, sin recrear la sesión.
    await expect(page.getByText("Galería bloqueada por la habilitación actual")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agregar a galería" })).toBeVisible();
    await expect(page.getByText(/Estado: Aprobado/)).toBeVisible();
    await page.getByRole("region", { name: "Galería" }).screenshot({
      animations: "disabled",
      path: evidencePath("09-galeria-habilitada-por-el-grant.png"),
    });

    // 7. Suspensión de la cuenta con motivo: la sesión viva queda restringida.
    await adminPage.goto("/admin/users");
    await expect(adminPage.getByRole("heading", { level: 1, name: "Cuentas" })).toBeVisible();
    await adminPage.getByLabel("Buscar por nombre o correo").fill(ownerEmail);
    await adminPage.getByRole("button", { name: "Aplicar filtros" }).click();
    const ownerRow = adminPage.locator("li[data-user-id]").filter({ hasText: ownerEmail }).first();
    await expect(ownerRow).toBeVisible();
    await ownerRow.getByRole("button", { name: "Suspender cuenta" }).click();
    const suspendDialog = adminPage.getByRole("dialog");
    await suspendDialog.getByLabel("Motivo (obligatorio)")
      .fill("Verificación administrativa del recorrido de suspensión.");
    await suspendDialog.getByRole("button", { name: "Suspender cuenta" }).click();
    await expect(adminPage.getByRole("status").filter({ hasText: "quedó en estado Suspendida" }))
      .toBeVisible();
    await ownerRow.screenshot({
      animations: "disabled",
      path: evidencePath("10-cuenta-suspendida-con-motivo.png"),
    });

    // La propia cuenta de administración no se puede suspender desde el backoffice.
    await adminPage.getByLabel("Buscar por nombre o correo").fill(adminEmail);
    await adminPage.getByRole("button", { name: "Aplicar filtros" }).click();
    const adminRow = adminPage.locator("li[data-user-id]").filter({ hasText: adminEmail }).first();
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByRole("button", { name: "Suspender cuenta" })).toHaveCount(0);
    await expect(adminRow).toContainText("Cuenta de administración");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Tu navegación está restringida" }))
      .toBeVisible();
    await expect(page.getByText("Cuenta suspendida")).toBeVisible();
    await expect(page.getByRole("link", { name: "Perfil", exact: true })).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("11-titular-suspendido-navegacion-restringida.png"),
    });

    // Una cuenta suspendida tampoco puede abrir una sesión nueva.
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.goto("/?auth=login");
      const loginDialog = freshPage.getByRole("dialog", { name: "Bienvenido" });
      await expect(loginDialog).toBeVisible({ timeout: 15_000 });
      await loginDialog.getByLabel("Email").fill(ownerEmail);
      await loginDialog.getByLabel("Contraseña").fill(password);
      await loginDialog.getByRole("button", { name: /iniciar sesión/i }).click();
      await expect(loginDialog.getByText(/no pudimos iniciar sesión/i)).toBeVisible();
      await expect(freshPage).toHaveURL(/\?auth=login/);
    } finally {
      await freshContext.close();
    }
  } finally {
    if (promoted) await adminCommand(adminEmail, ["--demote"]).catch(() => undefined);
    await adminContext.close();
  }
});
