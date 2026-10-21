import type { NextResponse } from "next/server";

import {
  AUTH_COOKIE_NAMES,
  authCookieOptions,
  csrfBindingCookieOptions,
  csrfCookieOptions,
  refreshMaxAgeSeconds,
} from "./config";
import type { AuthSession } from "./types";

const MAX_ACCESS_AGE_SECONDS = 24 * 60 * 60;

export function applySessionCookies(
  response: NextResponse,
  session: AuthSession,
  requestUrl: string,
): void {
  const accessMaxAge = Math.min(
    MAX_ACCESS_AGE_SECONDS,
    Math.max(1, Math.trunc(session.expires_in)),
  );

  response.cookies.set(
    AUTH_COOKIE_NAMES.access,
    session.access_token,
    authCookieOptions(requestUrl, accessMaxAge),
  );
  response.cookies.set(
    AUTH_COOKIE_NAMES.refresh,
    session.refresh_token,
    authCookieOptions(requestUrl, refreshMaxAgeSeconds()),
  );
}

export function clearAuthCookies(
  response: NextResponse,
  requestUrl: string,
  clearCsrf = false,
): void {
  response.cookies.set(AUTH_COOKIE_NAMES.access, "", {
    ...authCookieOptions(requestUrl, 0),
    expires: new Date(0),
  });
  response.cookies.set(AUTH_COOKIE_NAMES.refresh, "", {
    ...authCookieOptions(requestUrl, 0),
    expires: new Date(0),
  });

  if (clearCsrf) {
    response.cookies.set(AUTH_COOKIE_NAMES.csrf, "", {
      ...csrfCookieOptions(requestUrl),
      maxAge: 0,
      expires: new Date(0),
    });
    response.cookies.set(AUTH_COOKIE_NAMES.csrfBinding, "", {
      ...csrfBindingCookieOptions(requestUrl),
      maxAge: 0,
      expires: new Date(0),
    });
  }
}
