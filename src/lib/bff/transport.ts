import { localeFromCookieHeader, type Locale } from "@/lib/i18n/config";

import { backendApiUrl, upstreamTimeoutMs } from "./config";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const SAFE_REQUEST_HEADERS = ["accept", "content-type", "idempotency-key"] as const;

export class RequestBodyTooLarge extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLarge";
  }
}

export async function readRequestBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestBodyTooLarge();
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) throw new RequestBodyTooLarge();
  return body;
}

/**
 * IP del navegador para que Laravel aplique sus límites por cliente y no por BFF.
 *
 * Nunca se usa el `X-Forwarded-For` entrante: Next solo lo completa si falta
 * (`??=` con la IP del socket), así que un cliente que lo manda elige su propia IP y
 * evade los límites (hallazgo del E2E de T19). La IP sale únicamente del header que
 * nombra `BFF_CLIENT_IP_HEADER` (p. ej. `x-real-ip`), que el proxy de borde delante de
 * Next tiene que SOBRESCRIBIR en cada request. Sin esa variable no se reenvía nada y
 * Laravel ve la IP del BFF (límites compartidos, pero no falsificables).
 * Se manda un único valor validado, nunca la cadena cruda.
 */
export function clientAddress(request: Request): string | null {
  const header = process.env.BFF_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!header || header === "x-forwarded-for" || !/^[a-z0-9-]{1,64}$/.test(header)) return null;
  const raw = request.headers.get(header)?.trim() ?? "";
  if (raw.includes(",")) return null;
  const candidate = raw.replace(/^::ffff:/i, "");
  if (!candidate || candidate.length > 45) return null;
  return /^[0-9a-f:.]+$/i.test(candidate) ? candidate : null;
}

export function backendHeaders(request: Request, accessToken: string | null): Headers {
  const headers = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const client = clientAddress(request);
  if (client) headers.set("x-forwarded-for", client);
  headers.set("accept-language", requestLocale(request));
  return headers;
}

/**
 * Idioma de la interfaz para Laravel (mensajes de error y validación): sale de la cookie
 * `contactur_locale`, nunca del `Accept-Language` del navegador, para que la API hable el
 * mismo idioma que la pantalla. Siempre `es` o `en`.
 */
export function requestLocale(request: Request): Locale {
  return localeFromCookieHeader(request.headers.get("cookie"));
}

function upstreamSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(upstreamTimeoutMs());
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

export async function callBackend(
  request: Request,
  path: string,
  accessToken: string | null,
  body?: ArrayBuffer,
): Promise<Response> {
  const url = backendApiUrl(path);
  url.search = new URL(request.url).search;

  return fetch(url, {
    method: request.method,
    headers: backendHeaders(request, accessToken),
    body,
    cache: "no-store",
    redirect: "manual",
    signal: upstreamSignal(request.signal),
  });
}

export async function callBackendJson(
  path: string,
  body: Record<string, unknown> | undefined,
  accessToken: string | null = null,
  signal?: AbortSignal,
  forwardedFor: string | null = null,
  locale: Locale | null = null,
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  if (locale) headers.set("accept-language", locale);

  return fetch(backendApiUrl(path), {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
    signal: upstreamSignal(signal),
  });
}
