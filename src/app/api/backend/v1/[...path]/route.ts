import { NextRequest, NextResponse } from "next/server";

import { isAllowedBackendRoute, normalizeBackendPath } from "@/lib/bff/allowlist";
import { applySessionCookies, clearAuthCookies } from "@/lib/bff/cookies";
import { AUTH_COOKIE_NAMES } from "@/lib/bff/config";
import { refreshSession } from "@/lib/bff/refresh";
import {
  BackendFailure,
  browserSecurityError,
  failureResponse,
  genericApiError,
  proxyBackendResponse,
} from "@/lib/bff/responses";
import { readRequestCookie, validateBrowserMutation } from "@/lib/bff/security";
import { RequestBodyTooLarge, callBackend, readRequestBody } from "@/lib/bff/transport";
import { tk } from "@/lib/i18n/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

function isMutation(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    genericApiError("backend_unavailable", tk("El servicio no está disponible temporalmente.")),
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path: pathParts } = await context.params;
  const path = normalizeBackendPath(pathParts);
  if (!path || !isAllowedBackendRoute(request.method, path)) {
    return browserSecurityError("route_not_allowed", tk("La ruta solicitada no está disponible."), 404);
  }

  if (isMutation(request.method)) {
    const securityError = validateBrowserMutation(request);
    if (securityError) {
      return browserSecurityError(securityError.code, securityError.message);
    }
  }

  let body: ArrayBuffer | undefined;
  try {
    body = await readRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) {
      return browserSecurityError(
        "payload_too_large",
        tk("La solicitud supera el tamaño permitido."),
        413,
      );
    }
    return browserSecurityError("invalid_request", tk("No pudimos leer la solicitud."), 400);
  }

  const accessToken = readRequestCookie(request, AUTH_COOKIE_NAMES.access);
  let backendResponse: Response;
  try {
    backendResponse = await callBackend(request, path, accessToken, body);
  } catch {
    return unavailableResponse();
  }

  if (backendResponse.status !== 401) {
    return proxyBackendResponse(backendResponse);
  }

  const refreshToken = readRequestCookie(request, AUTH_COOKIE_NAMES.refresh);
  if (!refreshToken) {
    const response = await proxyBackendResponse(backendResponse);
    clearAuthCookies(response, request.url);
    return response;
  }

  let session;
  try {
    session = await refreshSession(refreshToken);
  } catch (error) {
    if (error instanceof BackendFailure) {
      const response = failureResponse(error);
      if (error.status === 401) clearAuthCookies(response, request.url);
      return response;
    }
    return unavailableResponse();
  }

  let retryResponse: Response;
  try {
    retryResponse = await callBackend(request, path, session.access_token, body);
  } catch {
    const response = unavailableResponse();
    applySessionCookies(response, session, request.url);
    return response;
  }

  let response: NextResponse;
  try {
    response = await proxyBackendResponse(retryResponse);
  } catch {
    response = unavailableResponse();
  }

  if (retryResponse.status === 401) {
    clearAuthCookies(response, request.url);
  } else {
    applySessionCookies(response, session, request.url);
  }
  return response;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
