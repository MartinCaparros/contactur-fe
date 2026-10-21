import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las respuestas del frontend y del BFF (T22).
 *
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY`: ni la landing (con el modal
 *   de login) ni el panel se pueden embeber en otro sitio (clickjacking).
 * - `base-uri`, `form-action` y `object-src` cierran inyecciones de `<base>`, envíos de
 *   formularios a otro origen y plugins. No se restringen scripts con CSP: Next inyecta
 *   scripts inline de hidratación y una política por nonce queda como mejora futura.
 * - HSTS solo cuando la URL pública es https (en local sería ignorado y confuso).
 */
function securityHeaders(): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    },
  ];
  if (process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
