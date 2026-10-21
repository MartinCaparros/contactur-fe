import type { ChannelAuthorizationHandler, Options } from "pusher-js";

import { type ChannelAuthorizationData, RealtimeAuthError } from "./authorizer";
import { type RealtimeConfig, pusherOptions } from "./config";

export type ConnectionStatus = "connecting" | "connected" | "unavailable";
export type ChannelStatus = "pending" | "subscribed" | "denied" | "error";
export type RealtimeEventHandler = (eventName: string, payload: unknown) => void;

/** Superficie mínima de pusher-js que usa el cliente (y que imita el fake de los tests). */
export interface RealtimeChannelLike {
  bind(eventName: string, callback: (data: unknown) => void): unknown;
  unbind(eventName?: string, callback?: (data: unknown) => void): unknown;
  bind_global(callback: (eventName: string, data: unknown) => void): unknown;
  unbind_global(callback?: (eventName: string, data: unknown) => void): unknown;
}

export interface RealtimeClientLike {
  connection: {
    state: string;
    bind(eventName: string, callback: (change: unknown) => void): unknown;
    unbind(eventName?: string, callback?: (change: unknown) => void): unknown;
  };
  subscribe(channelName: string): RealtimeChannelLike;
  unsubscribe(channelName: string): void;
  disconnect(): void;
}

export type RealtimeClientConstructor = new (key: string, options: Options) => RealtimeClientLike;

export type RealtimeDependencies = Readonly<{
  config: RealtimeConfig | null;
  load: () => Promise<RealtimeClientConstructor>;
  authorize: (socketId: string, channelName: string) => Promise<ChannelAuthorizationData>;
  onUnauthorized: () => void;
}>;

/** Un "connecting" (o una suscripción pendiente) más largo que esto cuenta como no disponible. */
export const STALL_TIMEOUT_MS = 5000;

type Listener = Readonly<{ events: ReadonlySet<string>; handler: RealtimeEventHandler }>;

type ChannelEntry = {
  status: ChannelStatus;
  lastAuthStatus: number | null;
  listeners: Set<Listener>;
  channel: RealtimeChannelLike | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  onSucceeded: (data: unknown) => void;
  onError: (data: unknown) => void;
  onEvent: (eventName: string, data: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Una conexión compartida por pestaña con ref-counting por canal.
 *
 * - Los canales se registran aunque pusher-js todavía no haya cargado; se suscriben
 *   en cuanto existe el cliente.
 * - Cada suscripción (y cada re-suscripción tras reconectar) pasa por el authorizer,
 *   que revalida acceso en Laravel. Un 403 deja el canal `denied` y lo saca de
 *   pusher-js para que no se reintente en loop.
 * - Los eventos solo se reenvían a los handlers; el manager no guarda payloads.
 */
export class RealtimeManager {
  private readonly deps: RealtimeDependencies;
  private client: RealtimeClientLike | null = null;
  private connection: ConnectionStatus = "connecting";
  private readonly channels = new Map<string, ChannelEntry>();
  private readonly changeListeners = new Set<() => void>();
  private connectingTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private runId = 0;

  constructor(deps: RealtimeDependencies) {
    this.deps = deps;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connection;
  }

  /** Estado de un canal; un canal sin registrar se informa como pendiente. */
  getChannelStatus(channelName: string): ChannelStatus {
    return this.channels.get(channelName)?.status ?? "pending";
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const run = ++this.runId;
    const config = this.deps.config;
    if (!config) {
      this.setConnection("unavailable");
      return;
    }
    this.setConnection("connecting");
    this.armConnectingTimer();
    void this.deps.load().then(
      (Client) => {
        if (!this.running || run !== this.runId) return;
        const client = new Client(config.key, pusherOptions(config, this.authorizeChannel));
        this.client = client;
        client.connection.bind("state_change", this.onStateChange);
        this.applyClientState(client.connection.state);
        for (const [name, entry] of this.channels) {
          if (entry.status === "pending") this.armPendingTimer(entry);
          this.attach(name, entry);
        }
      },
      () => {
        if (!this.running || run !== this.runId) return;
        this.clearConnectingTimer();
        this.setConnection("unavailable");
      },
    );
  }

  /** Cierra el socket (logout/desmontaje). Los registros vivos se re-suscriben si se vuelve a iniciar. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.runId += 1;
    this.clearConnectingTimer();
    const client = this.client;
    this.client = null;
    for (const entry of this.channels.values()) {
      this.unbindEntry(entry);
      this.clearPendingTimer(entry);
      entry.status = "pending";
      entry.lastAuthStatus = null;
    }
    if (client) {
      client.connection.unbind("state_change", this.onStateChange);
      client.disconnect();
    }
    this.connection = "connecting";
    this.notify();
  }

  /**
   * Registra un handler para `eventNames` en `channelName`. Varios consumidores del
   * mismo canal comparten una sola suscripción; la última liberación la cierra.
   */
  listen(channelName: string, eventNames: ReadonlySet<string>, handler: RealtimeEventHandler): () => void {
    let entry = this.channels.get(channelName);
    if (!entry) {
      entry = this.createEntry(channelName);
      this.channels.set(channelName, entry);
      if (this.client) this.armPendingTimer(entry);
      this.attach(channelName, entry);
      this.notify();
    }
    const listener: Listener = { events: eventNames, handler };
    const owned = entry;
    owned.listeners.add(listener);
    return () => {
      if (this.channels.get(channelName) !== owned) return;
      owned.listeners.delete(listener);
      if (owned.listeners.size > 0) return;
      this.channels.delete(channelName);
      this.clearPendingTimer(owned);
      this.detach(channelName, owned);
      this.notify();
    };
  }

  private readonly authorizeChannel: ChannelAuthorizationHandler = (params, callback) => {
    void this.deps.authorize(params.socketId, params.channelName).then(
      (data) => {
        const entry = this.channels.get(params.channelName);
        if (entry) entry.lastAuthStatus = null;
        callback(null, data);
      },
      (reason: unknown) => {
        const status = reason instanceof RealtimeAuthError ? reason.status : null;
        const entry = this.channels.get(params.channelName);
        if (entry) entry.lastAuthStatus = status;
        if (status === 401) this.deps.onUnauthorized();
        callback(reason instanceof Error ? reason : new Error("No pudimos autorizar el canal."), null);
      },
    );
  };

  private readonly onStateChange = (change: unknown) => {
    if (isRecord(change) && typeof change.current === "string") this.applyClientState(change.current);
  };

  /**
   * connected → connected; unavailable/failed/disconnected → unavailable;
   * initialized/connecting → connecting (5 s como máximo). `unavailable` se mantiene
   * hasta volver a conectar para que el aviso de polling no parpadee entre reintentos.
   */
  private applyClientState(raw: string): void {
    if (raw === "connected") {
      this.clearConnectingTimer();
      this.setConnection("connected");
      return;
    }
    if (this.connection === "connected") this.markChannelsPending();
    if (raw === "initialized" || raw === "connecting") {
      if (this.connection === "unavailable") return;
      this.setConnection("connecting");
      this.armConnectingTimer();
      return;
    }
    this.clearConnectingTimer();
    this.setConnection("unavailable");
  }

  private createEntry(channelName: string): ChannelEntry {
    const entry: ChannelEntry = {
      status: "pending",
      lastAuthStatus: null,
      listeners: new Set(),
      channel: null,
      pendingTimer: null,
      onSucceeded: () => {
        this.clearPendingTimer(entry);
        entry.lastAuthStatus = null;
        this.setChannelStatus(entry, "subscribed");
      },
      onError: (data: unknown) => {
        this.clearPendingTimer(entry);
        const status = isRecord(data) && typeof data.status === "number" ? data.status : entry.lastAuthStatus;
        if (status === 403) {
          // Sin permiso: no se reintenta. Un consumidor nuevo vuelve a validar al suscribir.
          this.detach(channelName, entry);
          this.setChannelStatus(entry, "denied");
          return;
        }
        this.setChannelStatus(entry, "error");
      },
      onEvent: (eventName: string, data: unknown) => {
        if (eventName.startsWith("pusher:") || eventName.startsWith("pusher_internal:")) return;
        for (const listener of [...entry.listeners]) {
          if (listener.events.has(eventName)) listener.handler(eventName, data);
        }
      },
    };
    return entry;
  }

  private attach(channelName: string, entry: ChannelEntry): void {
    if (!this.client || entry.channel || entry.status === "denied") return;
    const channel = this.client.subscribe(channelName);
    entry.channel = channel;
    channel.bind("pusher:subscription_succeeded", entry.onSucceeded);
    channel.bind("pusher:subscription_error", entry.onError);
    channel.bind_global(entry.onEvent);
  }

  private unbindEntry(entry: ChannelEntry): void {
    const channel = entry.channel;
    if (!channel) return;
    channel.unbind("pusher:subscription_succeeded", entry.onSucceeded);
    channel.unbind("pusher:subscription_error", entry.onError);
    channel.unbind_global(entry.onEvent);
    entry.channel = null;
  }

  private detach(channelName: string, entry: ChannelEntry): void {
    if (!entry.channel) return;
    this.unbindEntry(entry);
    this.client?.unsubscribe(channelName);
  }

  private markChannelsPending(): void {
    for (const entry of this.channels.values()) {
      if (entry.status === "denied" || entry.status === "pending") continue;
      entry.status = "pending";
      this.armPendingTimer(entry);
    }
    this.notify();
  }

  private setChannelStatus(entry: ChannelEntry, status: ChannelStatus): void {
    if (entry.status === status) return;
    entry.status = status;
    this.notify();
  }

  private armPendingTimer(entry: ChannelEntry): void {
    this.clearPendingTimer(entry);
    entry.pendingTimer = setTimeout(() => {
      entry.pendingTimer = null;
      if (entry.status === "pending") this.setChannelStatus(entry, "error");
    }, STALL_TIMEOUT_MS);
  }

  private clearPendingTimer(entry: ChannelEntry): void {
    if (entry.pendingTimer === null) return;
    clearTimeout(entry.pendingTimer);
    entry.pendingTimer = null;
  }

  private armConnectingTimer(): void {
    if (this.connectingTimer !== null) return;
    this.connectingTimer = setTimeout(() => {
      this.connectingTimer = null;
      if (this.running && this.connection === "connecting") this.setConnection("unavailable");
    }, STALL_TIMEOUT_MS);
  }

  private clearConnectingTimer(): void {
    if (this.connectingTimer === null) return;
    clearTimeout(this.connectingTimer);
    this.connectingTimer = null;
  }

  private setConnection(status: ConnectionStatus): void {
    if (this.connection === status) return;
    this.connection = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}
