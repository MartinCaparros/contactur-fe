import type { CookieOptions } from "./types";

export { AUTH_COOKIE_NAMES } from "./names";

const DEFAULT_REFRESH_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_CSRF_MAX_AGE_SECONDS = 60 * 60;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const configured = process.env[name];
  if (configured === undefined || configured === "") return fallback;
  if (!/^\d+$/.test(configured)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function refreshMaxAgeSeconds(): number {
  return positiveIntegerFromEnv(
    "BFF_REFRESH_TTL_SECONDS",
    DEFAULT_REFRESH_MAX_AGE_SECONDS,
  );
}

export function csrfMaxAgeSeconds(): number {
  return positiveIntegerFromEnv(
    "BFF_CSRF_TTL_SECONDS",
    DEFAULT_CSRF_MAX_AGE_SECONDS,
  );
}

export function upstreamTimeoutMs(): number {
  return positiveIntegerFromEnv(
    "BFF_UPSTREAM_TIMEOUT_MS",
    DEFAULT_UPSTREAM_TIMEOUT_MS,
  );
}

export function backendApiUrl(path: string): URL {
  const configured = process.env.BACKEND_INTERNAL_URL;
  if (!configured) {
    throw new Error("BACKEND_INTERNAL_URL is required");
  }

  const base = new URL(configured);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("BACKEND_INTERNAL_URL must use HTTP or HTTPS");
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}/api/v1/${path.replace(/^\/+/, "")}`;
  base.search = "";
  base.hash = "";
  return base;
}

export function authCookieOptions(
  requestUrl: string,
  maxAge: number,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge,
  };
}

export function csrfCookieOptions(requestUrl: string): CookieOptions {
  return {
    ...authCookieOptions(requestUrl, csrfMaxAgeSeconds()),
    httpOnly: false,
  };
}

export function csrfBindingCookieOptions(requestUrl: string): CookieOptions {
  return authCookieOptions(requestUrl, csrfMaxAgeSeconds());
}
