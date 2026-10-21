import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { deleteMail, login, waitForMail } from "./support/mailpit";

const EVIDENCE_DIRECTORY = fileURLToPath(
  new URL("../../docs/evidence/t10/", import.meta.url),
);

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t10/${filename}`, import.meta.url));
}

const GUIDE_DOCUMENT_LABEL = "Habilitación profesional de guía";

/** PDF mínimo real: arranca con %PDF-, sin contenido ejecutable ni marcado mixto. */
function syntheticPdf(): Buffer {
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj",
    "trailer<</Root 1 0 R/Size 4>>",
    "%%EOF",
    "",
  ].join("\n");
  return Buffer.from(body, "latin1");
}

function isoDateIn(days: number): string {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

function profileIdFrom(page: Page): string {
  const value = new URL(page.url()).searchParams.get("profile");
  expect(value, "la URL del alta debe exponer el ULID público del borrador").toBeTruthy();
  return value as string;
}

test("T10 alta documental real, recuperación de pasos y edición de perfil", async ({
  page,
  request,
}) => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `t10-${suffix}@example.test`;
  const password = `T10-${crypto.randomUUID()}-Aa9!`;
  const contactEmail = `contacto-${suffix}@example.test`;
  const mailIds = new Set<string>();

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });

  try {
    await page.goto("/?auth=register");
    const registration = page.getByRole("dialog", { name: "Crear una cuenta" });
    await expect(registration).toBeVisible({ timeout: 15_000 });
    await registration.getByLabel("Nombre").fill("Guía T10");
    await registration.getByLabel("Email").fill(email);
    await registration.getByLabel("Contraseña", { exact: true }).fill(password);
    await registration.getByLabel("Confirmar contraseña").fill(password);
    await registration.getByRole("button", { name: /crear cuenta/i }).click();
    await expect(registration.getByText("Cuenta creada")).toBeVisible();

    const verificationMail = await waitForMail(request, email, "verify-email");
    mailIds.add(verificationMail.id);
    await page.goto(verificationMail.link);
    const verification = page.getByRole("dialog", { name: "Verificar correo" });
    await expect(verification).toBeVisible({ timeout: 15_000 });
    await expect(verification.getByText(/tu correo quedó verificado/i)).toBeVisible();
    await deleteMail(request, verificationMail.id);
    mailIds.delete(verificationMail.id);

    await verification.getByRole("button", { name: /ir al inicio de sesión/i }).click();
    await login(page, email, password, "Guía T10");

    // Paso 1: la cuenta sin perfiles ofrece el alta y crea el borrador real.
    await page.getByRole("link", { name: "Crear perfil" }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await expect(page.getByRole("heading", { level: 2, name: "1. Categoría y nombre" })).toBeVisible();
    await page.getByRole("combobox", { name: /Categoría/ }).selectOption({ label: "Guía" });
    await page.getByLabel("Nombre visible").fill("Guía Austral T10");
    await page.getByRole("button", { name: "Crear borrador" }).click();

    // Paso 2: datos comunes y específicos de la categoría.
    await expect(page.getByRole("heading", { level: 2, name: "2. Datos y cobertura" })).toBeVisible();
    const profileId = profileIdFrom(page);
    await page.getByLabel("Descripción").fill("Guía profesional de montaña con base en Ushuaia.");
    await page.getByLabel("Email de contacto").fill(contactEmail);
    await page.getByLabel("Teléfono").fill("+54 9 2901 555000");
    await page.getByRole("combobox", { name: /Ciudad principal/ }).selectOption({ label: "Ushuaia" });
    await page.getByRole("group", { name: "Ciudades donde trabajás" })
      .getByRole("checkbox", { name: "Ushuaia" }).check();
    await page.getByRole("group", { name: "Idiomas" })
      .getByRole("checkbox", { name: "Español" }).check();
    await page.getByRole("group", { name: "Servicios" })
      .getByRole("checkbox", { name: "Guiado" }).check();
    await page.getByLabel("Resumen de formación").fill("Tecnicatura en guía de turismo y rescate en montaña.");
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("01-onboarding-paso2-datos.png"),
    });
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    // Paso 3: sin documentación válida el avance está bloqueado.
    await expect(page.getByRole("heading", { level: 2, name: "3. Documentación requerida" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: GUIDE_DOCUMENT_LABEL })).toBeVisible();
    await expect(page.getByText("Pendiente de carga")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar a revisión" })).toBeDisabled();

    // Recuperación real del callejón sin salida: una sesión retomada en el paso 4
    // sin documentos recibe 422 fields.documents y vuelve al paso 3.
    await page.evaluate(
      (id) => window.sessionStorage.setItem(`contactur:onboarding-step:${id}`, "4"),
      profileId,
    );
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "4. Revisión y términos" })).toBeVisible();
    await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
    await expect(page.getByText("Debés aceptar los términos demo-v1 para continuar.")).toBeVisible();
    await page.getByRole("checkbox", { name: /acepto los términos de demostración/i }).check();
    await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "3. Documentación requerida" })).toBeVisible();
    await expect(page.getByRole("alert")
      .filter({ hasText: "El perfil todavía no cumple los requisitos de finalización." })
      .first()).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("02-recuperacion-paso4-a-paso3.png"),
    });

    // Carga real del PDF requerido.
    await page.getByLabel("Archivo PDF").setInputFiles({
      name: "habilitacion-guia-t10.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf(),
    });
    await page.getByLabel("Número de registro").fill(`GT10-${suffix.slice(-6)}`);
    await page.getByLabel("Vigente hasta").fill(isoDateIn(365));
    await page.getByRole("button", { name: "Subir documento" }).click();
    await expect(page.getByText("Documento cargado y pendiente de revisión.")).toBeVisible();
    const currentDocuments = page.getByRole("region", { name: "Documentos actuales" });
    await expect(currentDocuments.getByText("habilitacion-guia-t10.pdf")).toBeVisible();
    await expect(currentDocuments.getByText(/Estado: Pendiente de revisión/)).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("03-documento-pendiente-de-revision.png"),
    });

    // Paso 4 nuevamente: los términos ya aceptados devuelven 409 y la finalización continúa.
    await page.getByRole("button", { name: "Continuar a revisión" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "4. Revisión y términos" })).toBeVisible();
    await page.getByRole("checkbox", { name: /acepto los términos de demostración/i }).check();
    await page.getByRole("button", { name: "Aceptar y solicitar finalización" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Pendiente de habilitación manual" })).toBeVisible();
    await expect(page.getByText(/no concedió acceso, grant ni pago/i)).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("04-alta-completa-sin-habilitacion.png"),
    });

    // Acceso: la finalización no habilitó nada.
    await page.getByRole("link", { name: "Ir al panel" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Guía Austral T10" })).toBeVisible();
    await page.getByRole("link", { name: "Acceso", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Acceso del perfil" })).toBeVisible();
    await expect(page.getByText("Inactivo", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Funciones restringidas" })).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: evidencePath("05-acceso-inactivo.png"),
    });

    // Desde T21 todos los destinos del menú existen: no quedan enlaces deshabilitados
    // ni textos "Disponible en próxima etapa" (gate de T21: sin placeholders).
    await expect(page.locator('[role="link"][aria-disabled="true"]')).toHaveCount(0);
    await expect(page.getByText("Disponible en próxima etapa")).toHaveCount(0);
    const nav = page.getByRole("complementary", { name: "Navegación del perfil" });
    for (const label of ["Perfil", "Referencias", "Acceso", "Ajustes"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", /\?profile=/);
    }

    // Edición del perfil con capacidades reales.
    await page.getByRole("link", { name: "Perfil", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Editar perfil" })).toBeVisible();
    await expect(page.getByText("Galería bloqueada por la habilitación actual")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar a galería" })).toHaveCount(0);

    // 422 real del backend vinculado al campo.
    await page.getByLabel("Email de contacto").fill("correo-invalido");
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    const contactField = page.getByLabel("Email de contacto");
    await expect(contactField).toHaveAttribute("aria-invalid", "true");
    const describedBy = await contactField.getAttribute("aria-describedby");
    expect(describedBy).toBe("profile-contact_email-error");
    await expect(page.locator("#profile-contact_email-error")).toBeVisible();
    await page.getByRole("region", { name: "Datos y cobertura" }).screenshot({
      animations: "disabled",
      path: evidencePath("06-editor-422-email-de-contacto.png"),
    });

    await page.getByLabel("Email de contacto").fill(contactEmail);
    await page.getByRole("button", { name: "Guardar perfil" }).click();
    await expect(page.getByText("Los datos del perfil quedaron actualizados.")).toBeVisible();
    await expect(page.getByLabel("Email de contacto")).not.toHaveAttribute("aria-invalid", "true");

    // Descarga por el BFF autenticado con el nombre original.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar" }).click();
    const downloaded = await download;
    expect(downloaded.suggestedFilename()).toBe("habilitacion-guia-t10.pdf");
    await page.getByRole("region", { name: "Documentos", exact: true }).screenshot({
      animations: "disabled",
      path: evidencePath("07-editor-documento-descargable.png"),
    });
    await page.getByRole("region", { name: "Galería" }).screenshot({
      animations: "disabled",
      path: evidencePath("08-editor-galeria-bloqueada.png"),
    });

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await Promise.all([...mailIds].map((id) => deleteMail(request, id)));
  }
});
