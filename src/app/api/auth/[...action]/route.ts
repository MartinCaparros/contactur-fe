import { NextRequest, NextResponse } from "next/server";

import { applySessionCookies, clearAuthCookies } from "@/lib/bff/cookies";
import { AUTH_COOKIE_NAMES } from "@/lib/bff/config";
import { refreshSession } from "@/lib/bff/refresh";
import {
  BackendFailure,
  browserSecurityError,
  failureResponse,
  genericApiError,
  parseAuthSessionResponse,
  proxyBackendResponse,
  publicSession,
} from "@/lib/bff/responses";
import { readRequestCookie, validateBrowserMutation } from "@/lib/bff/security";
import { callBackendJson, clientAddress, requestLocale } from "@/lib/bff/transport";
import { tk } from "@/lib/i18n/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_AUTH_BODY_BYTES = 64 * 1024;

const AUTH_ACTIONS = {
  register: {
    backendPath: "auth/register",
    fields: ["name", "email", "password", "password_confirmation"],
    sessionResponse: true,
    bearer: false,
  },
  login: {
    backendPath: "auth/login",
    fields: ["email", "password"],
    sessionResponse: true,
    bearer: false,
  },
  refresh: {
    backendPath: "auth/refresh",
    fields: [],
    sessionResponse: true,
    bearer: false,
  },
  logout: {
    backendPath: "auth/logout",
    fields: [],
    sessionResponse: false,
    bearer: true,
  },
  "forgot-password": {
    backendPath: "auth/forgot-password",
    fields: ["email"],
    sessionResponse: false,
    bearer: false,
  },
  "reset-password": {
    backendPath: "auth/reset-password",
    fields: ["token", "email", "password", "password_confirmation"],
    sessionResponse: false,
    bearer: false,
  },
  "email/verify": {
    backendPath: "auth/email/verify",
    fields: ["token"],
    sessionResponse: false,
    bearer: false,
  },
  "email/resend": {
    backendPath: "auth/email/resend",
    fields: [],
    sessionResponse: false,
    bearer: true,
  },
} as const;

type AuthAction = keyof typeof AUTH_ACTIONS;
type RouteContext = { params: Promise<{ action: string[] }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function authBody(
  request: NextRequest,
  fields: readonly string[],
): Promise<Record<string, unknown>> {
  if (fields.length === 0) return {};

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_AUTH_BODY_BYTES) {
    throw new BackendFailure(
      413,
      genericApiError("payload_too_large", tk("La solicitud supera el tamaño permitido.")),
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new BackendFailure(
      422,
      genericApiError("invalid_json", tk("El cuerpo de la solicitud no es JSON válido.")),
    );
  }

  if (!isRecord(decoded)) return {};
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(decoded, field)).map((field) => [field, decoded[field]]),
  );
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    genericApiError("backend_unavailable", tk("El servicio no está disponible temporalmente.")),
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const accessToken = readRequestCookie(request, AUTH_COOKIE_NAMES.access);
  let response: NextResponse;

  try {
    const backendResponse = await callBackendJson("auth/logout", undefined, accessToken);
    response = await proxyBackendResponse(backendResponse);
  } catch {
    response = NextResponse.json(
      genericApiError(
        "logout_revocation_unknown",
        tk("La sesión local se cerró, pero no pudimos confirmar la revocación remota."),
      ),
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  clearAuthCookies(response, request.url, true);
  return response;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const securityError = validateBrowserMutation(request);
  if (securityError) {
    return browserSecurityError(securityError.code, securityError.message);
  }

  const { action: actionParts } = await context.params;
  const action = actionParts.join("/");
  if (!Object.hasOwn(AUTH_ACTIONS, action)) {
    return browserSecurityError("route_not_allowed", tk("La ruta solicitada no está disponible."), 404);
  }

  if (action === "logout") return handleLogout(request);

  try {
    if (action === "refresh") {
      const refreshToken = readRequestCookie(request, AUTH_COOKIE_NAMES.refresh);
      if (!refreshToken) {
        return browserSecurityError("authentication_required", tk("Necesitás iniciar sesión."), 401);
      }

      try {
        const session = await refreshSession(refreshToken);
        const response = NextResponse.json(publicSession(session), {
          headers: { "Cache-Control": "no-store" },
        });
        applySessionCookies(response, session, request.url);
        return response;
      } catch (error) {
        if (error instanceof BackendFailure) {
          const response = failureResponse(error);
          if (error.status === 401) clearAuthCookies(response, request.url);
          return response;
        }
        return unavailableResponse();
      }
    }

    const config = AUTH_ACTIONS[action as AuthAction];
    const body = await authBody(request, config.fields);
    const accessToken = config.bearer
      ? readRequestCookie(request, AUTH_COOKIE_NAMES.access)
      : null;
    // La IP del navegador viaja para que los límites por IP de Laravel (login,
    // recuperación) sean por cliente y no por BFF.
    const backendResponse = await callBackendJson(
      config.backendPath,
      body,
      accessToken,
      undefined,
      clientAddress(request),
      // El alta guarda este idioma en la cuenta: el correo de verificación ya sale en él.
      requestLocale(request),
    );

    if (config.sessionResponse) {
      const session = await parseAuthSessionResponse(backendResponse);
      const response = NextResponse.json(publicSession(session), {
        status: backendResponse.status,
        headers: { "Cache-Control": "no-store" },
      });
      applySessionCookies(response, session, request.url);
      return response;
    }

    return proxyBackendResponse(backendResponse);
  } catch (error) {
    if (error instanceof BackendFailure) return failureResponse(error);
    return unavailableResponse();
  }
}
