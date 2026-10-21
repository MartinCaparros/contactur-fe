/** @vitest-environment node */

import { NextRequest, NextResponse } from "next/server";

import { GET as csrfGet } from "@/app/api/auth/csrf/route";
import { GET as proxyGet } from "@/app/api/backend/v1/[...path]/route";
import { isAllowedBackendRoute, normalizeBackendPath } from "@/lib/bff/allowlist";
import {
  authCookieOptions,
  csrfBindingCookieOptions,
  csrfCookieOptions,
  csrfMaxAgeSeconds,
  refreshMaxAgeSeconds,
} from "@/lib/bff/config";
import { clearAuthCookies } from "@/lib/bff/cookies";
import { coordinateRefresh } from "@/lib/bff/refresh";
import { proxyBackendResponse, publicSession } from "@/lib/bff/responses";
import { safeReturnTo } from "@/lib/bff/return-to";
import { csrfBinding, validateBrowserMutation } from "@/lib/bff/security";
import { backendHeaders, callBackendJson, clientAddress } from "@/lib/bff/transport";
import type { AuthSession } from "@/lib/bff/types";

const ENV_NAMES = [
  "BACKEND_INTERNAL_URL",
  "BFF_REFRESH_TTL_SECONDS",
  "BFF_CSRF_TTL_SECONDS",
  "BFF_UPSTREAM_TIMEOUT_MS",
] as const;
const originalEnv = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

function restoreEnvironment(): void {
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function mutationRequest(overrides: Record<string, string> = {}): Request {
  const token = "csrf-value";
  return new Request("https://contactur.test/api/auth/login", {
    method: "POST",
    headers: {
      host: "contactur.test",
      origin: "https://contactur.test",
      cookie: `contactur_csrf=${token}; contactur_csrf_binding=${csrfBinding(token)}`,
      "x-csrf-token": token,
      ...overrides,
    },
  });
}

function authSession(suffix: string): AuthSession {
  return {
    user: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: "Persona de prueba",
      email: "person@example.test",
      email_verified_at: null,
      system_role: "user",
      status: "active",
    },
    access_token: `access-${suffix}`,
    refresh_token: `refresh-${suffix}`,
    token_type: "Bearer",
    expires_in: 900,
  };
}

function apiFailure(status = 401): Response {
  return new Response(JSON.stringify({
    error: { code: "authentication_required", message: "Necesitás iniciar sesión." },
    request_id: crypto.randomUUID(),
  }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sessionResponse(session: AuthSession): Response {
  return new Response(JSON.stringify({ data: session }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.BACKEND_INTERNAL_URL = "https://backend.contactur.test";
  delete process.env.BFF_REFRESH_TTL_SECONDS;
  delete process.env.BFF_CSRF_TTL_SECONDS;
  delete process.env.BFF_UPSTREAM_TIMEOUT_MS;
});

afterEach(() => {
  restoreEnvironment();
  vi.restoreAllMocks();
});

describe("P05 — frontera browser del BFF", () => {
  it("exige Origin, cookie/header CSRF y binding HttpOnly coincidentes", () => {
    expect(validateBrowserMutation(mutationRequest())).toBeNull();

    const missing = mutationRequest({ cookie: "", "x-csrf-token": "" });
    expect(validateBrowserMutation(missing)?.code).toBe("csrf_validation_failed");

    const mismatch = mutationRequest({ "x-csrf-token": "other-value" });
    expect(validateBrowserMutation(mismatch)?.code).toBe("csrf_validation_failed");

    const invalidBinding = mutationRequest({
      cookie: "contactur_csrf=csrf-value; contactur_csrf_binding=invalid-binding",
    });
    expect(validateBrowserMutation(invalidBinding)?.code).toBe("csrf_validation_failed");

    const foreign = mutationRequest({ origin: "https://attacker.test" });
    expect(validateBrowserMutation(foreign)?.code).toBe("invalid_request_origin");
  });

  it("emite y rota token legible con binding host-only HttpOnly", () => {
    const request = new NextRequest("https://contactur.test/api/auth/csrf");
    const first = csrfGet(request);
    const second = csrfGet(request);
    const firstToken = first.cookies.get("contactur_csrf")?.value;
    const firstBinding = first.cookies.get("contactur_csrf_binding")?.value;
    const secondToken = second.cookies.get("contactur_csrf")?.value;
    const setCookies = first.headers.getSetCookie().join("\n");

    expect(firstToken).toBeTruthy();
    expect(firstBinding).toBe(csrfBinding(firstToken ?? ""));
    expect(secondToken).not.toBe(firstToken);
    expect(setCookies).toMatch(/contactur_csrf_binding=.*HttpOnly/i);
    expect(setCookies).not.toMatch(/Domain=/i);
  });

  it("define cookies host-only, Path raíz y Secure solo bajo HTTPS", () => {
    expect(authCookieOptions("https://contactur.test/api/auth/login", 900)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 900,
    });
    expect(authCookieOptions("http://localhost:3000/api/auth/login", 900).secure).toBe(false);
    expect(csrfCookieOptions("https://contactur.test/api/auth/csrf")).toEqual({
      httpOnly: false,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 3600,
    });
    expect(csrfBindingCookieOptions("https://contactur.test/api/auth/csrf")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 3600,
    });
  });

  it("toma TTL refresh/CSRF del env y conserva defaults 14d/1h", () => {
    expect(refreshMaxAgeSeconds()).toBe(14 * 24 * 60 * 60);
    expect(csrfMaxAgeSeconds()).toBe(60 * 60);

    process.env.BFF_REFRESH_TTL_SECONDS = "12345";
    process.env.BFF_CSRF_TTL_SECONDS = "6789";
    expect(refreshMaxAgeSeconds()).toBe(12345);
    expect(csrfMaxAgeSeconds()).toBe(6789);
  });

  it("limpia también cookie y binding CSRF al cerrar sesión", () => {
    const response = NextResponse.json({ ok: true });
    clearAuthCookies(response, "https://contactur.test/api/auth/logout", true);
    const setCookies = response.headers.getSetCookie().join("\n");

    expect(setCookies).toContain("contactur_csrf=");
    expect(setCookies).toContain("contactur_csrf_binding=");
    expect(setCookies).toMatch(/contactur_csrf_binding=.*HttpOnly/i);
    expect(setCookies).not.toMatch(/Domain=/i);
  });

  it("rechaza returnTo externo, protocol-relative y codificado", () => {
    expect(safeReturnTo("https://attacker.test/session")).toBe("/app");
    expect(safeReturnTo("//attacker.test/session")).toBe("/app");
    expect(safeReturnTo("/%2f%2fattacker.test")).toBe("/app");
    expect(safeReturnTo("/app?tab=cuenta#estado")).toBe("/app?tab=cuenta#estado");
  });

  it("bloquea método, ruta absoluta, traversal y rutas no contractuales", () => {
    expect(isAllowedBackendRoute("GET", "me")).toBe(true);
    expect(isAllowedBackendRoute("POST", "me")).toBe(false);
    expect(isAllowedBackendRoute("GET", "auth/login")).toBe(false);
    expect(isAllowedBackendRoute("GET", "https://attacker.test")).toBe(false);
    expect(normalizeBackendPath(["https:", "attacker.test"])).toBeNull();
    expect(normalizeBackendPath(["profiles", "..", "me"])).toBeNull();
    expect(normalizeBackendPath(["profiles", "%2e%2e", "me"])).toBeNull();
  });

  it("aplica AbortSignal con timeout configurable a fetch upstream", async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    process.env.BFF_UPSTREAM_TIMEOUT_MS = "4321";

    await callBackendJson("auth/logout", undefined);

    expect(timeoutSpy).toHaveBeenCalledWith(4321);
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL("https://backend.contactur.test/api/v1/auth/logout"),
      expect.objectContaining({ signal: timeoutController.signal }),
    );
  });
});

describe("P03 — refresh coordinado", () => {
  it("rota una sola vez para dos requests y no serializa tokens al browser", async () => {
    const session = authSession(crypto.randomUUID());
    let rotations = 0;
    const rotate = async () => {
      rotations += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return session;
    };
    const oldRefresh = `old-refresh-${crypto.randomUUID()}`;

    const [first, second] = await Promise.all([
      coordinateRefresh(oldRefresh, rotate),
      coordinateRefresh(oldRefresh, rotate),
    ]);

    expect(rotations).toBe(1);
    expect(first).toBe(session);
    expect(second).toBe(session);
    const browserBody = JSON.stringify(publicSession(first));
    expect(browserBody).not.toContain(session.access_token);
    expect(browserBody).not.toContain(session.refresh_token);
    expect(browserBody).not.toContain("access_token");
    expect(browserBody).not.toContain("refresh_token");
  });

  it("aplica las cookies rotadas si el retry falla por red", async () => {
    const oldRefresh = `old-refresh-${crypto.randomUUID()}`;
    const session = authSession(crypto.randomUUID());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiFailure())
      .mockResolvedValueOnce(sessionResponse(session))
      .mockRejectedValueOnce(new TypeError("network failure"));
    const request = new NextRequest("https://contactur.test/api/backend/v1/me", {
      headers: {
        cookie: `contactur_access=expired; contactur_refresh=${oldRefresh}`,
      },
    });

    const response = await proxyGet(request, {
      params: Promise.resolve({ path: ["me"] }),
    });
    const setCookies = response.headers.getSetCookie().join("\n");

    expect(response.status).toBe(502);
    expect(setCookies).toContain(`contactur_access=${session.access_token}`);
    expect(setCookies).toContain(`contactur_refresh=${session.refresh_token}`);
    expect(setCookies).toMatch(/Path=\//);
  });

  it("conserva limpieza de cookies si el retry rotado devuelve 401", async () => {
    const oldRefresh = `old-refresh-${crypto.randomUUID()}`;
    const session = authSession(crypto.randomUUID());
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiFailure())
      .mockResolvedValueOnce(sessionResponse(session))
      .mockResolvedValueOnce(apiFailure());
    const request = new NextRequest("https://contactur.test/api/backend/v1/me", {
      headers: {
        cookie: `contactur_access=expired; contactur_refresh=${oldRefresh}`,
      },
    });

    const response = await proxyGet(request, {
      params: Promise.resolve({ path: ["me"] }),
    });
    const setCookies = response.headers.getSetCookie().join("\n");

    expect(response.status).toBe(401);
    expect(setCookies).toMatch(/contactur_access=;.*Max-Age=0/i);
    expect(setCookies).toMatch(/contactur_refresh=;.*Max-Age=0/i);
    expect(setCookies).not.toContain(session.access_token);
    expect(setCookies).not.toContain(session.refresh_token);
  });
});

describe("T10 — proxy de descargas", () => {
  const profileId = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
  const documentId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";

  function downloadRequest(): NextRequest {
    return new NextRequest(`https://contactur.test/api/backend/v1/profiles/${profileId}/documents/${documentId}/download`, {
      headers: { cookie: "contactur_access=access-download" },
    });
  }

  const routeContext = {
    params: Promise.resolve({ path: ["profiles", profileId, "documents", documentId, "download"] }),
  };

  it("preserva bytes binarios, disposition, nosniff y fuerza no-store", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="credencial.pdf"',
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=3600",
      },
    }));

    const response = await proxyGet(downloadRequest(), routeContext);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="credencial.pdf"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserva la rama JSON firmada y sus headers sin exponerla como binario", async () => {
    const payload = {
      data: {
        signed_url: "https://files.example.test/signed/document",
        expires_at: "2099-01-01T00:00:00Z",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="credencial.pdf"',
        "x-content-type-options": "nosniff",
      },
    }));

    const response = await proxyGet(downloadRequest(), routeContext);

    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="credencial.pdf"');
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("T18 — headers de idempotencia", () => {
  it("preserva Idempotency-Replayed del 201 y sigue descartando headers no permitidos", async () => {
    const payload = { data: { id: "01ARZ3NDEKTSV4RRFFQ69G5FC1" } };
    const response = await proxyBackendResponse(new Response(JSON.stringify(payload), {
      status: 201,
      headers: {
        "content-type": "application/json",
        "idempotency-replayed": "true",
        "set-cookie": "upstream=1",
        "cache-control": "public, max-age=60",
      },
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("idempotency-replayed")).toBe("true");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("T19 — IP del cliente hacia Laravel", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost:3000/api/backend/v1/support-inquiries", { method: "POST", headers });

  afterEach(() => {
    delete process.env.BFF_CLIENT_IP_HEADER;
  });

  it("sin BFF_CLIENT_IP_HEADER no reenvía ninguna IP: el X-Forwarded-For del cliente es falsificable", () => {
    const spoofed = request({ "x-forwarded-for": "198.51.100.77", "x-real-ip": "198.51.100.78", authorization: "Bearer navegador" });
    expect(clientAddress(spoofed)).toBeNull();
    const headers = backendHeaders(spoofed, null);
    expect(headers.has("x-forwarded-for")).toBe(false);
    // El navegador tampoco puede inyectar su propio Authorization a través del BFF.
    expect(headers.get("authorization")).toBeNull();
  });

  it("con el header del borde configurado reenvía solo ese valor validado e ignora el X-Forwarded-For entrante", () => {
    process.env.BFF_CLIENT_IP_HEADER = "X-Real-IP";
    const headers = backendHeaders(request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.77" }), null);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");

    expect(clientAddress(request({ "x-real-ip": "::ffff:198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientAddress(request({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    // Una cadena o basura no se interpreta: el borde tiene que mandar un único valor.
    expect(clientAddress(request({ "x-real-ip": "203.0.113.7, 10.0.0.1" }))).toBeNull();
    expect(clientAddress(request({ "x-real-ip": "<script>" }))).toBeNull();
    expect(clientAddress(request({}))).toBeNull();

    // Configurar el propio X-Forwarded-For como fuente se rechaza: volvería a ser falsificable.
    process.env.BFF_CLIENT_IP_HEADER = "x-forwarded-for";
    expect(clientAddress(request({ "x-forwarded-for": "203.0.113.7" }))).toBeNull();
  });
});
