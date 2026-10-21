/** @vitest-environment node */

import nextConfig from "../../next.config";

async function headersFor(appUrl: string | undefined) {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = appUrl;
  try {
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/:path*");
    return new Map((rules?.[0]?.headers ?? []).map((header) => [header.key.toLowerCase(), header.value]));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
}

describe("T22 — cabeceras de seguridad del frontend y el BFF", () => {
  it("impide embeber la app y cierra base/form/object en todas las rutas", async () => {
    const headers = await headersFor("http://localhost:3000");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    const csp = headers.get("content-security-policy") ?? "";
    for (const directive of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"]) {
      expect(csp).toContain(directive);
    }
    expect(headers.get("permissions-policy")).toContain("geolocation=()");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("agrega HSTS solo con una URL pública https", async () => {
    expect((await headersFor("http://localhost:3000")).has("strict-transport-security")).toBe(false);
    expect((await headersFor(undefined)).has("strict-transport-security")).toBe(false);
    expect((await headersFor("https://contactur.example")).get("strict-transport-security")).toContain("max-age=31536000");
  });
});
