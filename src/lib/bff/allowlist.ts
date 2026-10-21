type AllowedRoute = Readonly<{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: RegExp;
}>;

const ID = "[0-9A-HJKMNP-TV-Z]{26}";
const exact = (path: string) => new RegExp(`^${path}$`);

// Derivada de contracts/openapi.yaml. Cada método+ruta debe agregarse aquí de forma explícita.
const ALLOWED_BACKEND_ROUTES: readonly AllowedRoute[] = [
  { method: "GET", pattern: exact("me") },
  { method: "PATCH", pattern: exact("me") },
  { method: "POST", pattern: exact("me/change-email") },
  { method: "POST", pattern: exact("me/change-password") },
  { method: "GET", pattern: exact("catalogs") },
  { method: "POST", pattern: exact("profiles") },
  { method: "GET", pattern: exact(`profiles/${ID}`) },
  { method: "PATCH", pattern: exact(`profiles/${ID}`) },
  { method: "POST", pattern: exact(`profiles/${ID}/complete`) },
  { method: "POST", pattern: exact(`profiles/${ID}/terms`) },
  { method: "PUT", pattern: exact(`profiles/${ID}/cities`) },
  { method: "POST", pattern: exact(`profiles/${ID}/avatar`) },
  { method: "POST", pattern: exact(`profiles/${ID}/gallery`) },
  { method: "DELETE", pattern: exact(`profiles/${ID}/gallery/${ID}`) },
  { method: "GET", pattern: exact(`profiles/${ID}/documents`) },
  { method: "POST", pattern: exact(`profiles/${ID}/documents`) },
  { method: "GET", pattern: exact(`profiles/${ID}/documents/${ID}/download`) },
  { method: "DELETE", pattern: exact(`profiles/${ID}/documents/${ID}`) },
  { method: "GET", pattern: exact(`profiles/${ID}/access`) },
  { method: "GET", pattern: exact(`profiles/${ID}/availability`) },
  { method: "PUT", pattern: exact(`profiles/${ID}/availability`) },
  { method: "GET", pattern: exact(`profiles/${ID}/search`) },
  { method: "GET", pattern: exact(`profiles/${ID}/directory/${ID}`) },
  { method: "GET", pattern: exact(`profiles/${ID}/directory/${ID}/availability`) },
  { method: "GET", pattern: exact(`profiles/${ID}/contact-requests`) },
  { method: "POST", pattern: exact(`profiles/${ID}/contact-requests`) },
  { method: "GET", pattern: exact(`profiles/${ID}/contact-requests/${ID}`) },
  { method: "POST", pattern: exact(`profiles/${ID}/contact-requests/${ID}/accept`) },
  { method: "POST", pattern: exact(`profiles/${ID}/contact-requests/${ID}/reject`) },
  { method: "POST", pattern: exact(`profiles/${ID}/contact-requests/${ID}/cancel`) },
  { method: "GET", pattern: exact(`profiles/${ID}/contact-requests/${ID}/contact`) },
  { method: "POST", pattern: exact(`profiles/${ID}/contact-requests/${ID}/references`) },
  { method: "GET", pattern: exact(`profiles/${ID}/references`) },
  { method: "PATCH", pattern: exact(`profiles/${ID}/references/${ID}/visibility`) },
  { method: "GET", pattern: exact(`profiles/${ID}/dashboard`) },
  { method: "GET", pattern: exact(`profiles/${ID}/notifications`) },
  { method: "POST", pattern: exact(`profiles/${ID}/notifications/${ID}/read`) },
  { method: "POST", pattern: exact("broadcasting/auth") },
  { method: "POST", pattern: exact("support-inquiries") },
  { method: "GET", pattern: exact("admin/users") },
  { method: "GET", pattern: exact("admin/profiles") },
  { method: "PATCH", pattern: exact(`admin/users/${ID}/status`) },
  { method: "PATCH", pattern: exact(`admin/profiles/${ID}/status`) },
  { method: "GET", pattern: exact("admin/documents") },
  { method: "POST", pattern: exact(`admin/documents/${ID}/review`) },
  { method: "PUT", pattern: exact(`admin/profiles/${ID}/access`) },
  { method: "GET", pattern: exact("admin/references") },
  { method: "POST", pattern: exact(`admin/references/${ID}/moderate`) },
  { method: "GET", pattern: exact("admin/metrics") },
  { method: "GET", pattern: exact("admin/audit-logs") },
] as const;

const INVALID_PATH_PART = /(?:^|\/)(?:\.{1,2})(?:\/|$)|[\\:\u0000-\u001f]/;

export function normalizeBackendPath(parts: readonly string[]): string | null {
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;

  const path = parts.join("/");
  if (
    path.startsWith("/") ||
    path.startsWith("//") ||
    INVALID_PATH_PART.test(path) ||
    /%(?:2e|2f|5c)/i.test(path)
  ) {
    return null;
  }

  return path;
}

export function isAllowedBackendRoute(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  return ALLOWED_BACKEND_ROUTES.some(
    (route) => route.method === normalizedMethod && route.pattern.test(path),
  );
}
