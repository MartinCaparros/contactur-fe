import type { ChannelAuthorizationHandler, Options } from "pusher-js";

/** Configuración pública de Reverb. La key es pública; el secret nunca llega al navegador. */
export type RealtimeConfig = Readonly<{
  key: string;
  host: string;
  port: number;
  forceTLS: boolean;
}>;

/**
 * Lee la configuración pública de Reverb. Los accesos son literales porque Next solo
 * inlinea `process.env.NEXT_PUBLIC_*` escrito así. Sin key, host o puerto válido no hay
 * websocket: el cliente queda en `unavailable` y las vistas usan el polling visible.
 */
export function realtimeConfigFromEnv(): RealtimeConfig | null {
  const key = process.env.NEXT_PUBLIC_REVERB_APP_KEY;
  const host = process.env.NEXT_PUBLIC_REVERB_HOST;
  const port = Number(process.env.NEXT_PUBLIC_REVERB_PORT);
  const scheme = process.env.NEXT_PUBLIC_REVERB_SCHEME;
  if (!key || !host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { key, host, port, forceTLS: scheme === "https" };
}

/**
 * Opciones de pusher-js para Reverb. `cluster` es obligatorio para la librería pero no
 * se usa porque `wsHost` apunta a Reverb. Sin stats: no se envía telemetría a Pusher.
 */
export function pusherOptions(config: RealtimeConfig, authorize: ChannelAuthorizationHandler): Options {
  return {
    cluster: "mt1",
    wsHost: config.host,
    wsPort: config.port,
    wssPort: config.port,
    forceTLS: config.forceTLS,
    enabledTransports: ["ws", "wss"],
    disableStats: true,
    channelAuthorization: { customHandler: authorize },
  };
}
