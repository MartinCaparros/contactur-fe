/** Canal del directorio: solo cuentas con un perfil que hoy puede buscar. */
export const DIRECTORY_CHANNEL = "private-directory";

/** Canal propio de un perfil: solo su titular (permitido aunque el acceso esté vencido). */
export function profileChannel(profileId: string): string {
  return `private-profile.${profileId}`;
}

/**
 * Nombres exactos de `broadcastAs()` en Laravel. Con pusher-js directo (sin Echo) el
 * evento llega con este nombre, sin el punto inicial que Echo usa para no anteponer
 * el namespace `App\Events`.
 */
export const REALTIME_EVENTS = {
  availabilityChanged: "availability.changed",
  directoryChanged: "directory.changed",
  accessChanged: "access.changed",
  /** T19: `{profile_id, notification_id}` en el canal del perfil; solo invalida. */
  notificationCreated: "notification.created",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Los payloads son solo avisos de invalidación: se leen para decidir si conviene
 * re-consultar la API autorizada y nunca se renderizan.
 */
export function payloadProfileId(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.profile_id === "string" ? payload.profile_id : null;
}

export function payloadVersion(payload: unknown): number | null {
  return isRecord(payload) && typeof payload.version === "number" && Number.isInteger(payload.version)
    ? payload.version
    : null;
}
