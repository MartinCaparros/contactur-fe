import { browserMutation } from "@/lib/browser/auth";

export const BROADCAST_AUTH_PATH = "/api/backend/v1/broadcasting/auth";

/** Lo que pusher-js espera del authorizer (la librería no exporta este tipo). */
export type ChannelAuthorizationData = Readonly<{ auth: string; channel_data?: string }>;

/**
 * Error de autorización de canal. El mensaje es genérico a propósito: nunca incluye
 * el socket, la firma ni el cuerpo de la respuesta.
 */
export class RealtimeAuthError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`La autorización del canal fue rechazada (${status}).`);
    this.name = "RealtimeAuthError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Autoriza un canal privado por el BFF (CSRF incluido por `browserMutation`). El
 * backend revalida ownership y capacidades en cada suscripción y responde
 * `{data:{auth, channel_data}}`; pusher-js espera el objeto interno, así que se
 * desenvuelve `data`. Cualquier status distinto de 2xx es un `RealtimeAuthError`.
 */
export async function requestChannelAuthorization(
  socketId: string,
  channelName: string,
): Promise<ChannelAuthorizationData> {
  const response = await browserMutation(BROADCAST_AUTH_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ socket_id: socketId, channel_name: channelName }),
  });
  if (!response.ok) throw new RealtimeAuthError(response.status);

  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.data) || typeof body.data.auth !== "string" || body.data.auth === "") {
    throw new RealtimeAuthError(502);
  }
  const channelData = body.data.channel_data;
  return typeof channelData === "string"
    ? { auth: body.data.auth, channel_data: channelData }
    : { auth: body.data.auth };
}
