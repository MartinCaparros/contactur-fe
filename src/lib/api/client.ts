import type { paths } from "./generated";

export type ApiPaths = paths;

export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: init.cache ?? "no-store",
  });
}
