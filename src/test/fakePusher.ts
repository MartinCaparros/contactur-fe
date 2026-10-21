/**
 * Fake controlable de pusher-js para Vitest. `setup.ts` lo registra como mock global:
 * por defecto conecta y suscribe solo (así las suites anteriores a T16 ven el modo
 * `live` sin red ni authorizer). T16 cambia el comportamiento con `fakePusher.mode`.
 */
import type { ChannelAuthorizationHandler, Options } from "pusher-js";

type Callback = (data: unknown) => void;
type GlobalCallback = (eventName: string, data: unknown) => void;

export type FakeSubscriptionMode =
  /** Éxito automático (asincrónico, como un ida y vuelta real) sin llamar al authorizer. */
  | "auto"
  /** Llama al `customHandler` real y resuelve la suscripción según su callback. */
  | "authorizer"
  /** No resuelve nada: el test llama a `succeed`/`fail`. */
  | "manual";

export class FakeChannel {
  readonly name: string;
  private readonly callbacks = new Map<string, Set<Callback>>();
  private readonly globals = new Set<GlobalCallback>();

  constructor(name: string) {
    this.name = name;
  }

  bind(eventName: string, callback: Callback): this {
    const set = this.callbacks.get(eventName) ?? new Set<Callback>();
    set.add(callback);
    this.callbacks.set(eventName, set);
    return this;
  }

  unbind(eventName?: string, callback?: Callback): this {
    if (!eventName) this.callbacks.clear();
    else if (!callback) this.callbacks.delete(eventName);
    else this.callbacks.get(eventName)?.delete(callback);
    return this;
  }

  bind_global(callback: GlobalCallback): this {
    this.globals.add(callback);
    return this;
  }

  unbind_global(callback?: GlobalCallback): this {
    if (callback) this.globals.delete(callback);
    else this.globals.clear();
    return this;
  }

  /** Como `Channel.emit` de pusher-js: primero los globales, luego los del evento. */
  emit(eventName: string, data: unknown): void {
    for (const callback of [...this.globals]) callback(eventName, data);
    for (const callback of [...(this.callbacks.get(eventName) ?? [])]) callback(data);
  }

  get listenerCount(): number {
    return this.globals.size + [...this.callbacks.values()].reduce((total, set) => total + set.size, 0);
  }
}

class FakeConnection {
  state = "initialized";
  private readonly listeners = new Map<string, Set<Callback>>();

  bind(eventName: string, callback: Callback): this {
    const set = this.listeners.get(eventName) ?? new Set<Callback>();
    set.add(callback);
    this.listeners.set(eventName, set);
    return this;
  }

  unbind(eventName?: string, callback?: Callback): this {
    if (!eventName) this.listeners.clear();
    else if (!callback) this.listeners.delete(eventName);
    else this.listeners.get(eventName)?.delete(callback);
    return this;
  }

  setState(next: string): void {
    const previous = this.state;
    if (previous === next) return;
    this.state = next;
    for (const callback of [...(this.listeners.get("state_change") ?? [])]) callback({ previous, current: next });
  }
}

export const fakePusher = {
  instances: [] as FakePusher[],
  mode: "auto" as FakeSubscriptionMode,
  autoConnect: true,
  reset(): void {
    fakePusher.instances.length = 0;
    fakePusher.mode = "auto";
    fakePusher.autoConnect = true;
  },
  latest(): FakePusher {
    const instance = fakePusher.instances.at(-1);
    if (!instance) throw new Error("No se creó ningún cliente de pusher-js");
    return instance;
  },
};

export default class FakePusher {
  readonly key: string;
  readonly options: Options;
  readonly connection = new FakeConnection();
  readonly channels = new Map<string, FakeChannel>();
  readonly subscribeCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  disconnected = false;
  private socketCounter = 0;

  constructor(key: string, options: Options) {
    this.key = key;
    this.options = options;
    fakePusher.instances.push(this);
    if (fakePusher.autoConnect) {
      this.connection.setState("connecting");
      this.connection.setState("connected");
    }
  }

  subscribe(name: string): FakeChannel {
    const existing = this.channels.get(name);
    if (existing) return existing;
    const channel = new FakeChannel(name);
    this.channels.set(name, channel);
    this.subscribeCalls.push(name);
    if (this.connection.state === "connected") this.resolveSubscription(channel);
    return channel;
  }

  unsubscribe(name: string): void {
    this.channels.delete(name);
    this.unsubscribeCalls.push(name);
  }

  disconnect(): void {
    this.disconnected = true;
    this.connection.setState("disconnected");
  }

  // --- Controles de test -------------------------------------------------------------

  /** Cambia el estado de conexión; al volver a `connected` re-suscribe todo, como pusher-js. */
  setState(state: string): void {
    this.connection.setState(state);
    if (state === "connected") for (const channel of this.channels.values()) this.resolveSubscription(channel);
  }

  succeed(name: string): void {
    this.channel(name).emit("pusher:subscription_succeeded", {});
  }

  fail(name: string, status?: number): void {
    this.channel(name).emit("pusher:subscription_error", {
      type: "AuthError",
      error: "rechazado",
      ...(status === undefined ? {} : { status }),
    });
  }

  /** Emite un evento del servidor en un canal suscripto. */
  emit(name: string, eventName: string, data: unknown): void {
    this.channel(name).emit(eventName, data);
  }

  channel(name: string): FakeChannel {
    const channel = this.channels.get(name);
    if (!channel) throw new Error(`Canal no suscripto: ${name}`);
    return channel;
  }

  private resolveSubscription(channel: FakeChannel): void {
    if (fakePusher.mode === "manual") return;
    if (fakePusher.mode === "auto") {
      void Promise.resolve().then(() => {
        if (this.channels.get(channel.name) === channel) channel.emit("pusher:subscription_succeeded", {});
      });
      return;
    }
    const authorization = this.options.channelAuthorization;
    if (!authorization || !("customHandler" in authorization)) throw new Error("Falta channelAuthorization.customHandler");
    const handler: ChannelAuthorizationHandler = authorization.customHandler;
    this.socketCounter += 1;
    handler({ socketId: `1234.${this.socketCounter}`, channelName: channel.name }, (error) => {
      if (this.channels.get(channel.name) !== channel) return;
      // pusher-js solo agrega `status` cuando el error es su HTTPAuthError interno; con un
      // customHandler el status no viaja y el cliente tiene que recordarlo por su cuenta.
      if (error) channel.emit("pusher:subscription_error", { type: "AuthError", error: error.message });
      else channel.emit("pusher:subscription_succeeded", {});
    });
  }
}
