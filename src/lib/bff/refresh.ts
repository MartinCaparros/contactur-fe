import { createHash } from "node:crypto";

import { callBackendJson } from "./transport";
import { parseAuthSessionResponse } from "./responses";
import type { AuthSession } from "./types";

type RefreshEntry = {
  promise: Promise<AuthSession>;
  settled: boolean;
  expiresAt: number;
};

type RefreshGlobal = typeof globalThis & {
  __contacturRefreshes?: Map<string, RefreshEntry>;
};

const REFRESH_RESULT_TTL_MS = 3_000;
const refreshes = ((globalThis as RefreshGlobal).__contacturRefreshes ??= new Map());

function refreshHash(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("base64url");
}

function pruneExpired(now: number): void {
  for (const [key, entry] of refreshes) {
    if (entry.settled && entry.expiresAt <= now) refreshes.delete(key);
  }
}

export function coordinateRefresh(
  refreshToken: string,
  operation: () => Promise<AuthSession>,
): Promise<AuthSession> {
  const now = Date.now();
  pruneExpired(now);
  const key = refreshHash(refreshToken);
  const existing = refreshes.get(key);
  if (existing && (!existing.settled || existing.expiresAt > now)) {
    return existing.promise;
  }

  const entry: RefreshEntry = {
    promise: Promise.resolve().then(operation),
    settled: false,
    expiresAt: Number.POSITIVE_INFINITY,
  };
  refreshes.set(key, entry);

  void entry.promise.then(
    () => {
      entry.settled = true;
      entry.expiresAt = Date.now() + REFRESH_RESULT_TTL_MS;
      const timer = setTimeout(() => {
        if (refreshes.get(key) === entry) refreshes.delete(key);
      }, REFRESH_RESULT_TTL_MS);
      timer.unref?.();
    },
    () => {
      entry.settled = true;
      entry.expiresAt = Date.now();
      if (refreshes.get(key) === entry) refreshes.delete(key);
    },
  );

  return entry.promise;
}

export function refreshSession(refreshToken: string): Promise<AuthSession> {
  return coordinateRefresh(refreshToken, async () => {
    const response = await callBackendJson("auth/refresh", { refresh_token: refreshToken });
    return parseAuthSessionResponse(response);
  });
}
