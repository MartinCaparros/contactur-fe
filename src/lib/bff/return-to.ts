const LOCAL_ORIGIN = "https://contactur.invalid";
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export function safeReturnTo(
  candidate: string | null | undefined,
  fallback = "/app",
): string {
  if (!candidate) return fallback;

  const value = candidate.trim();
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    ENCODED_PATH_SEPARATOR.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    if (parsed.origin !== LOCAL_ORIGIN || !parsed.pathname.startsWith("/")) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
