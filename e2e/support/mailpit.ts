import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MAILPIT_URL = "http://127.0.0.1:8025";

type UnknownRecord = Record<string, unknown>;

export type AuthMailKind = "verify-email" | "reset-password";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["ID", "Id", "id"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

function stringsIn(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => stringsIn(entry, output));
  } else if (isRecord(value)) {
    Object.values(value).forEach((entry) => stringsIn(entry, output));
  }
  return output;
}

/**
 * El backend arma los links con la URL pública de desarrollo (:3000). Si la corrida
 * apunta a otro servidor (p. ej. `next start` en :3100 vía PLAYWRIGHT_BASE_URL), se
 * conserva ruta, query y fragmento (token) y solo se cambia el origen.
 */
function rebaseOnTarget(url: URL): string {
  const target = process.env.PLAYWRIGHT_BASE_URL;
  if (!target) return url.href;
  const base = new URL(target);
  const rebased = new URL(url.href);
  rebased.protocol = base.protocol;
  rebased.host = base.host;
  return rebased.href;
}

export async function waitForMail(
  request: APIRequestContext,
  recipient: string,
  kind: AuthMailKind,
): Promise<{ id: string; link: string }> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const listResponse = await request.get(`${MAILPIT_URL}/api/v1/messages`);
    expect(listResponse.ok()).toBe(true);
    const list: unknown = await listResponse.json();
    const messages = isRecord(list) && Array.isArray(list.messages) ? list.messages : [];

    for (const summary of messages) {
      if (!JSON.stringify(summary).includes(recipient)) continue;
      const id = messageId(summary);
      if (!id) continue;

      const detailResponse = await request.get(
        `${MAILPIT_URL}/api/v1/message/${encodeURIComponent(id)}`,
      );
      expect(detailResponse.ok()).toBe(true);
      const detail: unknown = await detailResponse.json();
      const content = stringsIn(detail)
        .join("\n")
        .replace(/=\r?\n/g, "")
        .replaceAll("&amp;", "&")
        .replaceAll("=3D", "=");
      const links = content.match(
        /https?:\/\/(?:localhost|127\.0\.0\.1):3000\/\?auth=(?:verify-email|reset-password)(?:[&#][^\s<>"']*)?/g,
      ) ?? [];

      for (const candidate of links) {
        let url: URL;
        try {
          url = new URL(candidate);
        } catch {
          continue;
        }
        if (url.searchParams.get("auth") !== kind) continue;

        const fragmentParams = new URLSearchParams(url.hash.slice(1));
        const token = fragmentParams.get("token") ?? url.searchParams.get("token");
        const email = fragmentParams.get("email") ?? url.searchParams.get("email");
        if (!token || (kind === "reset-password" && !email)) continue;

        return { id, link: rebaseOnTarget(url) };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Mailpit did not receive the ${kind} message in time`);
}

/**
 * Limpieza de buzón, no aserto: con varios DELETE en paralelo Mailpit llegó a cortar
 * el socket ("socket hang up") después de que el recorrido ya había pasado. Un error
 * acá no debe tirar el test; lo que quede se borra con la limpieza general.
 */
export async function deleteMail(request: APIRequestContext, id: string): Promise<void> {
  for (const endpoint of [
    `${MAILPIT_URL}/api/v1/messages/${encodeURIComponent(id)}`,
    `${MAILPIT_URL}/api/v1/message/${encodeURIComponent(id)}`,
  ]) {
    try {
      const response = await request.delete(endpoint);
      if (response.ok()) return;
    } catch {
      // Se intenta la otra ruta y, si tampoco responde, se deja para la limpieza general.
    }
  }
}

/**
 * Inicia sesión desde el modal de la landing y espera el shell privado real.
 * El shell de T08 no saluda por nombre en el encabezado principal, así que se
 * espera el nombre de cuenta del header: solo aparece cuando /me resolvió, lo
 * que garantiza que el árbol ya está hidratado antes de interactuar con él.
 */
export async function login(page: Page, email: string, password: string, userName: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Bienvenido" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const submit = dialog.getByRole("button", { name: /iniciar sesión/i });
  // El modal enfoca "Email" en un requestAnimationFrame al abrir. Con el host cargado ese
  // frame llegó a correr en medio del `fill` de la contraseña y el texto terminó en
  // "Email" (suite del 1/10/2026): una persona no tipea antes del primer frame, el test
  // sí. Se espera ese foco inicial, se confirman los valores antes de enviar y, si hay
  // que reintentar, se vuelve a completar.
  await expect(dialog.getByLabel("Email")).toBeFocused({ timeout: 15_000 });
  const fillAndSubmit = async () => {
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Contraseña").fill(password);
    await expect(dialog.getByLabel("Email")).toHaveValue(email);
    await expect(dialog.getByLabel("Contraseña")).toHaveValue(password);
    await submit.click();
  };
  await fillAndSubmit();
  // Con el host saturado un login llegó a superar el timeout del BFF (nginx 499) aunque
  // Laravel responde en <1 s en reposo. Se espera lo primero que ocurra: llegar a /app o
  // que la UI vuelva a habilitar el botón con su error genérico. Solo en el segundo caso
  // se reintenta, una vez; es seguro porque el login no tiene efectos de negocio.
  try {
    await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, { timeout: 45_000 });
  } catch {
    const onApp = () => /\/app$/.test(new URL(page.url()).pathname);
    await expect.poll(async () => {
      if (onApp()) return "app";
      return (await submit.isVisible()) && (await submit.isEnabled()) ? "retry" : "waiting";
    }, { timeout: 60_000, intervals: [500] }).not.toBe("waiting");
    if (!onApp()) {
      await fillAndSubmit();
      await expect(page).toHaveURL(/\/app(\?profile=[0-9A-HJKMNP-TV-Z]{26})?$/, { timeout: 60_000 });
    }
  }
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.locator("header").getByText(userName, { exact: true })).toBeVisible();
}

/**
 * Cierra la sesión desde el shell ya hidratado. El botón existe en el markup antes de
 * que React le adjunte el handler, así que primero se espera el nombre de cuenta del
 * header: ese nodo aparece solo cuando `/me` resolvió, o sea después de hidratar.
 */
export async function logout(page: Page, userName: string): Promise<void> {
  await expect(page.locator("header").getByText(userName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/$/);
}
