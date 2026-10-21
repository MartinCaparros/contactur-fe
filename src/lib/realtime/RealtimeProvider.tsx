"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { requestChannelAuthorization } from "./authorizer";
import { realtimeConfigFromEnv } from "./config";
import {
  type ChannelStatus,
  type ConnectionStatus,
  type RealtimeClientConstructor,
  type RealtimeEventHandler,
  RealtimeManager,
} from "./manager";

export type { ChannelStatus, ConnectionStatus } from "./manager";

const RealtimeContext = createContext<RealtimeManager | null>(null);

/**
 * pusher-js se carga recién en el navegador, dentro de un efecto: el HTML/RSC nunca
 * lo evalúa y la landing no suma el chunk.
 */
async function loadPusherClient(): Promise<RealtimeClientConstructor> {
  const loaded: unknown = (await import("pusher-js")).default;
  if (typeof loaded === "function") return loaded as RealtimeClientConstructor;
  // Interop defensivo si el bundler envuelve el UMD en otro `default`.
  const nested: unknown = typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : null;
  if (typeof nested === "function") return nested as RealtimeClientConstructor;
  throw new Error("pusher-js no expone un constructor.");
}

function redirectToLogin(): void {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/?auth=login&returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * Una conexión por shell privado montado (una por pestaña). Solo se abre con
 * `enabled` (cuenta activa cargada y sin logout en curso) y se cierra al
 * deshabilitar o desmontar.
 */
export function RealtimeProvider({ enabled, children }: Readonly<{ enabled: boolean; children: ReactNode }>) {
  const [manager] = useState(() => new RealtimeManager({
    config: realtimeConfigFromEnv(),
    load: loadPusherClient,
    authorize: requestChannelAuthorization,
    onUnauthorized: redirectToLogin,
  }));

  useEffect(() => {
    if (!enabled) return;
    manager.start();
    return () => manager.stop();
  }, [enabled, manager]);

  return <RealtimeContext.Provider value={enabled ? manager : null}>{children}</RealtimeContext.Provider>;
}

/** Estado de la conexión. Sin provider activo no hay websocket: `unavailable`. */
export function useRealtimeStatus(): ConnectionStatus {
  const manager = useContext(RealtimeContext);
  const subscribe = useCallback((listener: () => void) => manager ? manager.onChange(listener) : () => {}, [manager]);
  return useSyncExternalStore(
    subscribe,
    () => manager?.getConnectionStatus() ?? "unavailable",
    () => "connecting",
  );
}

/**
 * Suscribe `handler` a `eventNames` de `channelName` mientras el componente esté
 * montado. `null` no suscribe nada (por ejemplo, cuando se perdió la capacidad).
 * Devuelve el estado del canal, o `null` si no hay canal o provider.
 */
export function useRealtimeEvents(
  channelName: string | null,
  eventNames: readonly string[],
  handler: RealtimeEventHandler,
): ChannelStatus | null {
  const manager = useContext(RealtimeContext);
  const handlerRef = useRef(handler);
  const eventsKey = eventNames.join("\n");

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!manager || !channelName) return;
    const events = new Set(eventsKey.split("\n").filter(Boolean));
    return manager.listen(channelName, events, (eventName, payload) => handlerRef.current(eventName, payload));
  }, [manager, channelName, eventsKey]);

  const subscribe = useCallback((listener: () => void) => manager ? manager.onChange(listener) : () => {}, [manager]);
  return useSyncExternalStore(
    subscribe,
    () => manager && channelName ? manager.getChannelStatus(channelName) : null,
    () => null,
  );
}

/**
 * - `live`: socket conectado y canal suscripto; los avisos disparan `refresh()`.
 * - `polling`: socket o canal no disponibles; `refresh()` cada `pollMs`.
 * - `connecting`: todavía conectando (como máximo 5 s antes de pasar a polling).
 * - `denied`: el backend rechazó el canal; no se hace polling.
 * - `off`: sin canal o sin provider; no hay tiempo real ni polling.
 */
export type InvalidationMode = "live" | "polling" | "connecting" | "denied" | "off";

export type InvalidationOptions = Readonly<{
  channel: string | null;
  events: readonly string[];
  /** Decide si un aviso concreto merece re-consultar; recibe el payload pero no debe guardarlo. */
  filter?: (eventName: string, payload: unknown) => boolean;
  refresh: () => void;
  pollMs?: number;
  debounceMs?: number;
}>;

export const POLL_INTERVAL_MS = 30000;
export const INVALIDATION_DEBOUNCE_MS = 250;

/**
 * Convierte avisos de invalidación en re-consultas de la API autorizada. Nunca
 * entrega el payload a la vista: solo llama a `refresh()`.
 */
export function useInvalidationRefresh({
  channel,
  events,
  filter,
  refresh,
  pollMs = POLL_INTERVAL_MS,
  debounceMs = INVALIDATION_DEBOUNCE_MS,
}: InvalidationOptions): Readonly<{ mode: InvalidationMode }> {
  const manager = useContext(RealtimeContext);
  const refreshRef = useRef(refresh);
  const filterRef = useRef(filter);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degraded = useRef(false);
  const wasLive = useRef(false);
  const debounceRef = useRef(debounceMs);

  useEffect(() => {
    refreshRef.current = refresh;
    filterRef.current = filter;
    debounceRef.current = debounceMs;
  }, [refresh, filter, debounceMs]);

  const onEvent = useCallback((eventName: string, payload: unknown) => {
    if (filterRef.current && !filterRef.current(eventName, payload)) return;
    // Una ráfaga de avisos dentro de la ventana termina en una sola re-consulta.
    if (debounceTimer.current !== null) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      refreshRef.current();
    }, debounceRef.current);
  }, []);

  const connection = useRealtimeStatus();
  const channelStatus = useRealtimeEvents(channel, events, onEvent);

  let mode: InvalidationMode;
  if (!manager || channel === null || channelStatus === null) mode = "off";
  else if (channelStatus === "denied") mode = "denied";
  else if (connection === "unavailable" || channelStatus === "error") mode = "polling";
  else if (connection === "connected" && channelStatus === "subscribed") mode = "live";
  else mode = "connecting";

  useEffect(() => () => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = null;
  }, []);

  // Al volver a `live` tras polling o tras un corte se re-consulta una vez: en el medio
  // pudieron perderse avisos. La primera conexión no re-consulta porque la vista acaba
  // de cargar sus datos.
  useEffect(() => {
    switch (mode) {
      case "live":
        if (degraded.current) refreshRef.current();
        degraded.current = false;
        wasLive.current = true;
        break;
      case "polling":
        degraded.current = true;
        break;
      case "connecting":
        // Reconectando un canal que ya estuvo vivo: también es un corte.
        if (wasLive.current) degraded.current = true;
        break;
      default:
        degraded.current = false;
        wasLive.current = false;
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "polling" || pollMs <= 0) return;
    const interval = setInterval(() => refreshRef.current(), pollMs);
    return () => clearInterval(interval);
  }, [mode, pollMs]);

  return { mode };
}
