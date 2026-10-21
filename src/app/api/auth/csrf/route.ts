import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_COOKIE_NAMES,
  csrfBindingCookieOptions,
  csrfCookieOptions,
} from "@/lib/bff/config";
import { csrfBinding, issueCsrfToken } from "@/lib/bff/security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest): NextResponse {
  const token = issueCsrfToken();
  const response = NextResponse.json(
    { data: { csrf_token: token } },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(
    AUTH_COOKIE_NAMES.csrf,
    token,
    csrfCookieOptions(request.url),
  );
  response.cookies.set(
    AUTH_COOKIE_NAMES.csrfBinding,
    csrfBinding(token),
    csrfBindingCookieOptions(request.url),
  );
  return response;
}
