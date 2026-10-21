import type { components } from "@/lib/api/generated";
import { AUTH_COOKIE_NAMES } from "@/lib/bff/names";

export type BrowserApiError = components["schemas"]["ErrorResponse"];

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

async function csrfToken(): Promise<string> {
  const existing = cookieValue(AUTH_COOKIE_NAMES.csrf);
  if (existing) return existing;

  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not obtain CSRF token");

  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("data" in body) ||
    typeof body.data !== "object" ||
    body.data === null ||
    !("csrf_token" in body.data) ||
    typeof body.data.csrf_token !== "string"
  ) {
    throw new Error("Invalid CSRF response");
  }
  return body.data.csrf_token;
}

export async function browserMutation(
  input: string,
  init: Omit<RequestInit, "method"> & { method?: "POST" | "PUT" | "PATCH" | "DELETE" } = {},
): Promise<Response> {
  const token = await csrfToken();
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", token);

  return fetch(input, {
    ...init,
    method: init.method ?? "POST",
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
}

export async function readBrowserApiError(response: Response): Promise<BrowserApiError | null> {
  if (!response.headers.get("content-type")?.includes("application/json")) return null;
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string" &&
      "code" in body.error &&
      typeof body.error.code === "string" &&
      "request_id" in body &&
      typeof body.request_id === "string"
    ) {
      return body as BrowserApiError;
    }
  } catch {
    return null;
  }
  return null;
}
