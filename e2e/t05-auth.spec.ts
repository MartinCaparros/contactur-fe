import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { deleteMail, login, waitForMail } from "./support/mailpit";

const EVIDENCE_DIRECTORY = fileURLToPath(
  new URL("../../docs/evidence/t05/", import.meta.url),
);

function evidencePath(filename: string): string {
  return fileURLToPath(new URL(`../../docs/evidence/t05/${filename}`, import.meta.url));
}

test("T05 auth, refresh concurrente, recovery y seguridad reales", async ({
  page,
  context,
  request,
}) => {
  const email = `t05-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const initialPassword = `T05-${crypto.randomUUID()}-Aa9!`;
  const newPassword = `T05-new-${crypto.randomUUID()}-Bb8!`;
  const mailIds = new Set<string>();

  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });

  try {
    await page.goto("/?auth=register");
    const registration = page.getByRole("dialog", { name: "Crear una cuenta" });
    await expect(registration).toBeVisible({ timeout: 15_000 });
    await registration.getByLabel("Nombre").fill("Persona T05");
    await registration.getByLabel("Email").fill(email);
    await registration.getByLabel("Contraseña", { exact: true }).fill(initialPassword);
    await registration.getByLabel("Confirmar contraseña").fill(initialPassword);
    await registration.getByRole("button", { name: /crear cuenta/i }).click();
    await expect(registration.getByText("Cuenta creada")).toBeVisible();
    await expect(registration.getByLabel("Email")).toHaveCount(0);
    await expect(registration).not.toContainText(email);
    await registration.screenshot({
      animations: "disabled",
      path: evidencePath("01-cuenta-creada-pendiente-verificacion.png"),
    });

    const registrationCookies = await context.cookies();
    const accessCookie = registrationCookies.find((cookie) => cookie.name === "contactur_access");
    const refreshCookie = registrationCookies.find((cookie) => cookie.name === "contactur_refresh");
    const csrfCookie = registrationCookies.find((cookie) => cookie.name === "contactur_csrf");
    const bindingCookie = registrationCookies.find(
      (cookie) => cookie.name === "contactur_csrf_binding",
    );
    const secureCookies = new URL(page.url()).protocol === "https:";

    expect(Boolean(accessCookie && refreshCookie && csrfCookie && bindingCookie)).toBe(true);
    expect(accessCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: secureCookies });
    expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: secureCookies });
    expect(csrfCookie).toMatchObject({ httpOnly: false, sameSite: "Lax", path: "/", secure: secureCookies });
    expect(bindingCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: secureCookies });
    expect(accessCookie?.domain.startsWith(".")).toBe(false);
    expect(refreshCookie?.domain.startsWith(".")).toBe(false);
    expect(csrfCookie?.domain.startsWith(".")).toBe(false);
    expect(bindingCookie?.domain.startsWith(".")).toBe(false);
    expect((accessCookie?.expires ?? 0) > Date.now() / 1000).toBe(true);
    expect((refreshCookie?.expires ?? 0) > Date.now() / 1000).toBe(true);

    const verificationMail = await waitForMail(request, email, "verify-email");
    mailIds.add(verificationMail.id);
    await page.goto(verificationMail.link);
    await expect(page).not.toHaveURL(/(?:token|email)=/);
    const verification = page.getByRole("dialog", { name: "Verificar correo" });
    await expect(verification).toBeVisible({ timeout: 15_000 });
    await expect(verification.getByText(/tu correo quedó verificado/i)).toBeVisible();
    await verification.screenshot({
      animations: "disabled",
      path: evidencePath("02-verificacion-exitosa-url-limpia.png"),
    });
    await deleteMail(request, verificationMail.id);
    mailIds.delete(verificationMail.id);

    await verification.getByRole("button", { name: /ir al inicio de sesión/i }).click();
    await login(page, email, initialPassword, "Persona T05");
    // El shell privado de T08 no publica el email de la cuenta; la identidad
    // visible es el nombre, que igual se enmascara en la evidencia.
    const accountName = page.getByText("Persona T05", { exact: true });
    await expect(page.getByRole("heading", { level: 1, name: "Creá tu perfil profesional" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(email);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      mask: [accountName],
      maskColor: "#5454d4",
      path: evidencePath("03-app-autenticada-identidad-enmascarada.png"),
    });

    const activeCookies = await context.cookies();
    const activeCsrf = activeCookies.find((cookie) => cookie.name === "contactur_csrf");
    const refreshBeforeRace = activeCookies.find(
      (cookie) => cookie.name === "contactur_refresh",
    );
    expect(Boolean(activeCsrf && refreshBeforeRace)).toBe(true);
    const appOrigin = new URL(page.url()).origin;

    const missingOrigin = await context.request.post(`${appOrigin}/api/auth/email/resend`, {
      headers: { "x-csrf-token": activeCsrf?.value ?? "" },
    });
    expect(missingOrigin.status()).toBe(403);
    const foreignOrigin = await context.request.post(`${appOrigin}/api/auth/email/resend`, {
      headers: {
        origin: "https://attacker.example",
        "x-csrf-token": activeCsrf?.value ?? "",
      },
    });
    expect(foreignOrigin.status()).toBe(403);

    await context.clearCookies({ name: "contactur_access" });
    const [firstMe, secondMe] = await Promise.all([
      context.request.get(`${appOrigin}/api/backend/v1/me`),
      context.request.get(`${appOrigin}/api/backend/v1/me`),
    ]);
    expect(firstMe.status()).toBe(200);
    expect(secondMe.status()).toBe(200);
    const cookiesAfterRace = await context.cookies();
    const rotatedRefresh = cookiesAfterRace.find(
      (cookie) => cookie.name === "contactur_refresh",
    );
    expect(rotatedRefresh?.value).toBeTruthy();
    expect(rotatedRefresh?.value).not.toBe(refreshBeforeRace?.value);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
    const loggedOutCookies = await context.cookies();
    for (const name of [
      "contactur_access",
      "contactur_refresh",
      "contactur_csrf",
      "contactur_csrf_binding",
    ]) {
      expect(loggedOutCookies.some((cookie) => cookie.name === name)).toBe(false);
    }

    await page.goto("/app");
    await expect(page).toHaveURL(/\/?\?auth=login&returnTo=%2Fapp$/);
    const protectedLogin = page.getByRole("dialog", { name: "Bienvenido" });
    await expect(protectedLogin).toBeVisible({ timeout: 15_000 });
    await expect(protectedLogin.getByLabel("Email")).toHaveValue("");
    await expect(protectedLogin.getByLabel("Contraseña")).toHaveValue("");
    await page.screenshot({
      animations: "disabled",
      path: evidencePath("04-app-tras-logout-login-sin-credenciales.png"),
    });
    await protectedLogin.getByRole("link", { name: /olvidaste tu contraseña/i }).click();
    const recovery = page.getByRole("dialog", { name: "Recuperar contraseña" });
    await expect(recovery).toBeVisible();
    await recovery.getByLabel("Email").fill(email);
    await recovery.getByRole("button", { name: /enviar instrucciones/i }).click();
    await expect(recovery.getByText(/si el email corresponde a una cuenta/i)).toBeVisible();

    const resetMail = await waitForMail(request, email, "reset-password");
    mailIds.add(resetMail.id);
    await page.goto(resetMail.link);
    await expect(page).not.toHaveURL(/(?:token|email)=/);
    const reset = page.getByRole("dialog", { name: "Nueva contraseña" });
    await expect(reset).toBeVisible({ timeout: 15_000 });
    await expect(reset.getByLabel("Email")).toHaveValue(email);
    await reset.getByLabel("Nueva contraseña").fill(newPassword);
    await reset.getByLabel("Confirmar contraseña").fill(newPassword);
    await reset.getByRole("button", { name: /guardar contraseña/i }).click();
    await expect(reset.getByText(/contraseña actualizada/i)).toBeVisible();
    await deleteMail(request, resetMail.id);
    mailIds.delete(resetMail.id);

    await page.goto("/?auth=login");
    await login(page, email, newPassword, "Persona T05");
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/?auth=login&returnTo=https%3A%2F%2Fattacker.example%2Fsession");
    await login(page, email, newPassword, "Persona T05");
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/);
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    await Promise.all([...mailIds].map((id) => deleteMail(request, id)));
  }
});
