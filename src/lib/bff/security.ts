import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { tk } from "@/lib/i18n/translate";

import { AUTH_COOKIE_NAMES } from "./config";

export type BrowserMutationError = {
  code: "invalid_request_origin" | "csrf_validation_failed";
  message: string;
};

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function equalDigests(left: Buffer, right: Buffer): boolean {
  return timingSafeEqual(left, right);
}

export function issueCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfBinding(token: string): string {
  return tokenDigest(token).toString("base64url");
}

export function validateBrowserMutation(
  request: Pick<Request, "headers" | "url">,
): BrowserMutationError | null {
  const host = request.headers.get("host");
  const originHeader = request.headers.get("origin");

  if (!host || !originHeader || host.includes(",")) {
    return {
      code: "invalid_request_origin",
      message: tk("No pudimos validar el origen de la solicitud."),
    };
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return {
      code: "invalid_request_origin",
      message: tk("No pudimos validar el origen de la solicitud."),
    };
  }

  if (
    (origin.protocol !== "http:" && origin.protocol !== "https:") ||
    origin.host.toLowerCase() !== host.toLowerCase()
  ) {
    return {
      code: "invalid_request_origin",
      message: tk("No pudimos validar el origen de la solicitud."),
    };
  }

  const cookieToken = readCookie(
    request.headers.get("cookie"),
    AUTH_COOKIE_NAMES.csrf,
  );
  const headerToken = request.headers.get("x-csrf-token");
  const binding = readCookie(
    request.headers.get("cookie"),
    AUTH_COOKIE_NAMES.csrfBinding,
  );

  if (!cookieToken || !headerToken || !binding) {
    return {
      code: "csrf_validation_failed",
      message: tk("La validación de seguridad venció. Recargá e intentá nuevamente."),
    };
  }

  const tokenMatches = equalDigests(tokenDigest(cookieToken), tokenDigest(headerToken));
  const bindingMatches = equalDigests(
    tokenDigest(binding),
    tokenDigest(csrfBinding(cookieToken)),
  );
  if (!tokenMatches || !bindingMatches) {
    return {
      code: "csrf_validation_failed",
      message: tk("La validación de seguridad venció. Recargá e intentá nuevamente."),
    };
  }

  return null;
}

export function readRequestCookie(
  request: Pick<Request, "headers">,
  name: string,
): string | null {
  return readCookie(request.headers.get("cookie"), name);
}
