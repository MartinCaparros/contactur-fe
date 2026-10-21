import { expect, test, type Response } from "@playwright/test";

import {
  NAVIGATION,
  adminCommand,
  api,
  catalogs as loadCatalogs,
  compose,
  createCompletedProfile,
  evidencePath as evidenceFor,
  expectApi,
  fullPageEvidence,
  loginHydrated,
  openHydrated,
  putAccess,
  registerAndLogin,
  registerAndVerify,
  sql,
  startService,
  stopService,
  ulid,
} from "./support/flows";

/**
 * T23 — "Recorrido negativo adicional" de docs/pruebas.md, en un navegador real:
 * rechazo + cooldown, vencimiento con el scheduler detenido (y job reintentado sin
 * duplicar), un perfil de transporte que intenta iniciar, una cuenta que intenta editar
 * un perfil ajeno y abrir su archivo privado, y el enlace privado que deja de abrir al
 * cerrar la sesión. La revocación de acceso con la página abierta la cubre T16.
 */

const TASK = "t23";
const evidencePath = (filename: string) => evidenceFor(TASK, filename);

function syntheticEmail(value: string): string {
  expect(value).toMatch(/^t23-[a-z0-9-]+@example\.test$/);
  return value;
}

function errorCode(json: Record<string, unknown> | null): string | undefined {
  return (json?.error as { code?: string } | undefined)?.code;
}

async function artisan(args: readonly string[]): Promise<string> {
  return compose(["exec", "-T", "backend", "php", "artisan", ...args]);
}

test("T23 recorrido negativo: cooldown, vencimiento sin scheduler, transporte, perfil ajeno y archivo privado", async ({
  browser,
  request,
}) => {
  test.setTimeout(1_500_000);
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const tag = `T23N-${crypto.randomUUID().slice(0, 6)}`;
  const password = `T23-${crypto.randomUUID()}-Aa9!`;
  const users = {
    company: { name: "Empresa Negativa T23", email: syntheticEmail(`t23-neg-company-${suffix}@example.test`) },
    rejecter: { name: "Guía Rechaza T23", email: syntheticEmail(`t23-neg-rejecter-${suffix}@example.test`) },
    expiring: { name: "Guía Vence T23", email: syntheticEmail(`t23-neg-expiring-${suffix}@example.test`) },
    transport: { name: "Transporte T23", email: syntheticEmail(`t23-neg-transport-${suffix}@example.test`) },
    admin: { name: "Admin Negativo T23", email: syntheticEmail(`t23-neg-admin-${suffix}@example.test`) },
  };
  const names = {
    company: `Empresa Negativa ${tag}`,
    rejecter: `Guía Rechaza ${tag}`,
    expiring: `Guía Vence ${tag}`,
    transport: `Transporte Austral ${tag}`,
  };
  let promoted = false;
  let schedulerStopped = false;

  const contexts = await Promise.all(Object.keys(users).map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })));
  const [companyPage, rejecterPage, expiringPage, transportPage, adminPage] = await Promise.all(contexts.map((context) => context.newPage()));
  const [, rejecterContext] = contexts;

  try {
    // 1. Fixtures por la API real (BFF con CSRF): cuatro perfiles completos y habilitados.
    await registerAndLogin(rejecterPage, request, users.rejecter.name, users.rejecter.email, password);
    const catalog = await loadCatalogs(rejecterPage);
    const rejecterId = await createCompletedProfile(rejecterPage, catalog, {
      category: "guide",
      displayName: names.rejecter,
      contactEmail: `t23-neg-contacto-rechaza-${suffix}@example.test`,
      documentFilename: `credencial-rechaza-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndLogin(expiringPage, request, users.expiring.name, users.expiring.email, password);
    const expiringId = await createCompletedProfile(expiringPage, catalog, {
      category: "guide",
      displayName: names.expiring,
      contactEmail: `t23-neg-contacto-vence-${suffix}@example.test`,
      documentFilename: `credencial-vence-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndLogin(transportPage, request, users.transport.name, users.transport.email, password);
    const transportId = await createCompletedProfile(transportPage, catalog, {
      category: "transport_company",
      displayName: names.transport,
      contactEmail: `t23-neg-contacto-transporte-${suffix}@example.test`,
      documentFilename: `registro-transporte-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndLogin(companyPage, request, users.company.name, users.company.email, password);
    const companyId = await createCompletedProfile(companyPage, catalog, {
      category: "tourism_company",
      displayName: names.company,
      contactEmail: `t23-neg-contacto-empresa-${suffix}@example.test`,
      documentFilename: `registro-empresa-neg-t23-${suffix}.pdf`,
      label: "T23",
    });
    await registerAndVerify(adminPage, request, users.admin.name, users.admin.email, password);
    expect(await adminCommand(users.admin.email)).toContain("admin");
    promoted = true;
    await loginHydrated(adminPage, users.admin.email, password, users.admin.name);
    for (const profileId of [rejecterId, expiringId, transportId, companyId]) {
      await putAccess(adminPage, profileId, 0, `Recorrido negativo T23 ${tag}: habilitación.`);
    }

    // 2. Rechazo + cooldown: la empresa solicita por la ficha, el guía rechaza por la UI y
    //    un reenvío inmediato se explica con la fecha desde la que podrá volver a enviar.
    const ficha = `/app/profiles/${rejecterId}?profile=${companyId}`;
    await openHydrated(companyPage, ficha, users.company.name);
    await expect(companyPage.getByRole("heading", { level: 1, name: names.rejecter })).toBeVisible({ timeout: 60_000 });
    const form = companyPage.getByRole("form", { name: "Solicitud de contacto" });
    await form.getByLabel("Servicio solicitado").fill(`Traslado y guiado a Lapataia (${tag}).`);
    const first = companyPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/profiles/${companyId}/contact-requests`) && response.request().method() === "POST");
    await form.getByRole("button", { name: "Enviar solicitud" }).click();
    const firstResponse = await first;
    expect(firstResponse.status(), await firstResponse.text()).toBe(201);
    const rejectedId = ulid(((await firstResponse.json()) as { data: { id: string } }).data.id);

    await openHydrated(rejecterPage, `/app/requests/${rejectedId}?profile=${rejecterId}`, users.rejecter.name);
    await expect(rejecterPage.getByText("Estado: Pendiente")).toBeVisible({ timeout: 60_000 });
    await rejecterPage.getByRole("button", { name: "Rechazar", exact: true }).click();
    const rejectDialog = rejecterPage.getByRole("dialog", { name: "¿Rechazar la solicitud?" });
    await rejectDialog.getByRole("button", { name: "Rechazar solicitud" }).click();
    await expect(rejecterPage.getByText("Estado: Rechazada")).toBeVisible({ timeout: 60_000 });

    await openHydrated(companyPage, ficha, users.company.name);
    const retryForm = companyPage.getByRole("form", { name: "Solicitud de contacto" });
    await retryForm.getByLabel("Servicio solicitado").fill(`Segundo intento inmediato (${tag}).`);
    const second = companyPage.waitForResponse((response: Response) =>
      response.url().endsWith(`/profiles/${companyId}/contact-requests`) && response.request().method() === "POST");
    await retryForm.getByRole("button", { name: "Enviar solicitud" }).click();
    const secondResponse = await second;
    const secondBody = (await secondResponse.json()) as Record<string, unknown>;
    expect(secondResponse.status()).toBeGreaterThanOrEqual(400);
    expect(errorCode(secondBody)).toBe("contact_request_cooldown");
    await expect(companyPage.getByRole("alert").filter({ hasText: /Una solicitud reciente con este perfil terminó hace poco\. Vas a poder enviar otra desde el \d{2}\/\d{2}\/\d{4}/ }))
      .toBeVisible();
    await fullPageEvidence(companyPage, evidencePath("t23-neg-01-cooldown-1440.png"));
    expect(await sql(`SELECT count(*) FROM contact_requests c JOIN profiles s ON s.id = c.sender_profile_id JOIN profiles r ON r.id = c.recipient_profile_id WHERE s.public_id = '${companyId}' AND r.public_id = '${rejecterId}'`))
      .toBe("1");

    // 3. Vencimiento con el scheduler detenido: el reloj de la solicitud se lleva al pasado
    //    (equivalente E2E del FrozenClock de los tests de backend); nadie la materializa.
    await stopService("scheduler");
    schedulerStopped = true;
    const created = await expectApi(companyPage, "POST", `/api/backend/v1/profiles/${companyId}/contact-requests`, {
      target_profile_id: expiringId,
      service_description: `Excursión que vence sin respuesta (${tag}).`,
    });
    const expiringRequestId = ulid((created.data as { id: string }).id);
    await sql(`UPDATE contact_requests SET created_at = now() - interval '8 days', expires_at = now() - interval '1 minute' WHERE public_id = '${expiringRequestId}'`);

    await openHydrated(expiringPage, `/app/requests/${expiringRequestId}?profile=${expiringId}`, users.expiring.name);
    await expect(expiringPage.getByText("Estado: Vencida")).toBeVisible({ timeout: 60_000 });
    await expect(expiringPage.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await expect(expiringPage.getByRole("button", { name: "Rechazar", exact: true })).toHaveCount(0);
    const forcedAccept = await api(expiringPage, "POST", `/api/backend/v1/profiles/${expiringId}/contact-requests/${expiringRequestId}/accept`);
    expect(forcedAccept.status).toBe(409);
    expect(errorCode(forcedAccept.json)).toBe("contact_request_not_pending");
    expect(await sql(`SELECT status FROM contact_requests WHERE public_id = '${expiringRequestId}'`)).toBe("pending");
    await fullPageEvidence(expiringPage, evidencePath("t23-neg-02-vencida-sin-scheduler-1440.png"));
    await openHydrated(companyPage, `/app/requests?profile=${companyId}`, users.company.name);
    await expect(companyPage.getByRole("article", { name: names.expiring, exact: true })).toContainText("Estado: Vencida", { timeout: 60_000 });

    // Al volver el scheduler, el job (reintentado) materializa una vez y notifica una vez por participante.
    await startService("scheduler");
    schedulerStopped = false;
    await artisan(["contactur:expire-contact-requests"]);
    expect(await sql(`SELECT status FROM contact_requests WHERE public_id = '${expiringRequestId}'`)).toBe("expired");
    const expiredNotifications = `SELECT count(*) FROM profile_notifications WHERE dedupe_key LIKE 'contact_request_expired:${expiringRequestId}:%'`;
    expect(await sql(expiredNotifications)).toBe("2");
    const rerun = await artisan(["contactur:expire-contact-requests"]);
    expect(rerun).toContain("Solicitudes marcadas como expired: 0.");
    expect(await sql(expiredNotifications)).toBe("2");

    // 4. Un perfil de transporte no inicia solicitudes: la ficha lo explica y el POST forzado es 403.
    await openHydrated(transportPage, `/app/profiles/${rejecterId}?profile=${transportId}`, users.transport.name);
    await expect(transportPage.getByRole("heading", { level: 1, name: names.rejecter })).toBeVisible({ timeout: 60_000 });
    await expect(transportPage.getByText(/Las solicitudes de contacto las inician las empresas turísticas/)).toBeVisible();
    await expect(transportPage.getByRole("form", { name: "Solicitud de contacto" })).toHaveCount(0);
    const transportPost = await api(transportPage, "POST", `/api/backend/v1/profiles/${transportId}/contact-requests`, {
      target_profile_id: rejecterId,
      service_description: `Intento de un transporte (${tag}).`,
    });
    expect(transportPost.status).toBe(403);
    expect(errorCode(transportPost.json)).toBe("capability_not_available");
    await fullPageEvidence(transportPage, evidencePath("t23-neg-03-transporte-sin-envio-1440.png"));

    // 5. Perfil ajeno y archivo privado: la cuenta de transporte no puede editar ni leer al guía.
    const rejecterDocuments = await expectApi(rejecterPage, "GET", `/api/backend/v1/profiles/${rejecterId}/documents`);
    const documentId = ulid((rejecterDocuments.data as Array<{ id: string }>)[0]?.id);
    const downloadPath = `/api/backend/v1/profiles/${rejecterId}/documents/${documentId}/download`;
    for (const [method, path, body] of [
      ["PATCH", `/api/backend/v1/profiles/${rejecterId}`, { display_name: `Tomado por otra cuenta ${tag}` }],
      ["GET", `/api/backend/v1/profiles/${rejecterId}`, undefined],
      ["GET", `/api/backend/v1/profiles/${rejecterId}/documents`, undefined],
      ["GET", downloadPath, undefined],
    ] as const) {
      const result = await api(transportPage, method, path, body);
      expect(result.status, `${method} ${path} desde otra cuenta`).toBe(404);
      expect(result.text).not.toContain(names.rejecter);
    }
    expect(await sql(`SELECT display_name FROM profiles WHERE public_id = '${rejecterId}'`)).toBe(names.rejecter);

    // El titular sí descarga; con las cookies de esa sesión, después del logout, el enlace no abre.
    const ownDownload = await rejecterPage.request.get(downloadPath);
    expect(ownDownload.status()).toBe(200);
    expect(ownDownload.headers()["content-type"]).toContain("application/pdf");
    expect((await ownDownload.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const capturedCookies = await rejecterContext.cookies();
    await openHydrated(rejecterPage, `/app?profile=${rejecterId}`, users.rejecter.name);
    await rejecterPage.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(rejecterPage).toHaveURL(/\/(\?.*)?$/, NAVIGATION);
    expect((await rejecterPage.request.get(downloadPath)).status()).toBe(401);
    const replayContext = await browser.newContext();
    try {
      await replayContext.addCookies(capturedCookies);
      const replay = await replayContext.request.get(new URL(downloadPath, rejecterPage.url()).href);
      expect(replay.status(), "cookies de una sesión cerrada").toBe(401);
      expect((await replay.body()).subarray(0, 5).toString("latin1")).not.toBe("%PDF-");
    } finally {
      await replayContext.close();
    }
  } finally {
    if (schedulerStopped) await startService("scheduler").catch(() => undefined);
    if (promoted) await adminCommand(users.admin.email, ["--demote"]).catch(() => undefined);
    await Promise.all(contexts.map((context) => context.close()));
  }
});
