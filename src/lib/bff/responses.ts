import { NextResponse } from "next/server";

// Los mensajes del BFF viajan en español (texto fuente); `ApiRequestError` los traduce
// en el navegador al idioma activo. `tk()` los deja a la vista del test de paridad.
import { tk } from "@/lib/i18n/translate";

import type { ApiError, AuthSession, PublicAuthSession } from "./types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const SAFE_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "idempotency-replayed",
  "retry-after",
  "x-content-type-options",
  "x-request-id",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

export function sanitizeApiError(value: unknown): ApiError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;

  const code = safeString(value.error.code, 120);
  const message = safeString(value.error.message, 1000);
  const requestId = safeString(value.request_id, 200);
  if (!code || !message || !requestId) return null;

  const fields: Record<string, string[]> = {};
  if (isRecord(value.error.fields)) {
    for (const [field, messages] of Object.entries(value.error.fields)) {
      if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(field) || !Array.isArray(messages)) continue;
      const safeMessages = messages
        .map((entry) => safeString(entry, 1000))
        .filter((entry): entry is string => entry !== null)
        .slice(0, 10);
      if (safeMessages.length > 0) fields[field] = safeMessages;
    }
  }

  return {
    error: {
      code,
      message,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    },
    request_id: requestId,
  };
}

export function genericApiError(
  code = "upstream_error",
  message: string = tk("No pudimos completar la solicitud."),
): ApiError {
  return {
    error: { code, message },
    request_id: crypto.randomUUID(),
  };
}

export class BackendFailure extends Error {
  constructor(
    readonly status: number,
    readonly payload: ApiError,
  ) {
    super(payload.error.message);
    this.name = "BackendFailure";
  }
}

export async function readBackendFailure(response: Response): Promise<BackendFailure> {
  let payload: ApiError | null = null;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = sanitizeApiError(await response.json());
    } catch {
      payload = null;
    }
  }

  return new BackendFailure(
    response.status,
    payload ?? genericApiError(
      response.status >= 500 ? "backend_unavailable" : "request_rejected",
      response.status >= 500
        ? tk("El servicio no está disponible temporalmente.")
        : tk("La solicitud no pudo completarse."),
    ),
  );
}

export function failureResponse(failure: BackendFailure): NextResponse {
  return NextResponse.json(failure.payload, {
    status: failure.status,
    headers: NO_STORE_HEADERS,
  });
}

export function browserSecurityError(
  code: string,
  message: string,
  status = 403,
): NextResponse {
  return NextResponse.json(genericApiError(code, message), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export function publicSession(session: AuthSession): PublicAuthSession {
  return { data: { user: session.user } };
}

export function parseAuthSession(value: unknown): AuthSession | null {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.user)) return null;

  const data = value.data;
  if (!isRecord(data) || !isRecord(data.user)) return null;
  const user = data.user;
  if (
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string" ||
    data.token_type !== "Bearer" ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    typeof user.id !== "string" ||
    typeof user.name !== "string" ||
    typeof user.email !== "string" ||
    (user.email_verified_at !== null && typeof user.email_verified_at !== "string") ||
    (user.system_role !== "user" && user.system_role !== "admin") ||
    (user.status !== "active" && user.status !== "suspended")
  ) {
    return null;
  }

  return data as AuthSession;
}

export async function parseAuthSessionResponse(response: Response): Promise<AuthSession> {
  if (!response.ok) throw await readBackendFailure(response);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new BackendFailure(
      502,
      genericApiError("invalid_backend_response", tk("El servicio devolvió una respuesta inválida.")),
    );
  }

  const session = parseAuthSession(body);
  if (!session) {
    throw new BackendFailure(
      502,
      genericApiError("invalid_backend_response", tk("El servicio devolvió una respuesta inválida.")),
    );
  }
  return session;
}

export async function proxyBackendResponse(response: Response): Promise<NextResponse> {
  if (!response.ok) return failureResponse(await readBackendFailure(response));

  const headers = new Headers(NO_STORE_HEADERS);
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (response.status === 204 || response.status === 205) {
    return new NextResponse(null, { status: response.status, headers });
  }

  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    headers,
  });
}
