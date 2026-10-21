import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PrivateApp } from "@/features/app/AppShell";
import type { AccessEvaluation, City, CurrentAccount, Profile, ProfileCategory, SearchResult } from "@/features/app/api";
import { AUTH_COOKIE_NAMES } from "@/lib/bff/names";
import { BROADCAST_AUTH_PATH, requestChannelAuthorization } from "@/lib/realtime/authorizer";
import { DIRECTORY_CHANNEL, profileChannel } from "@/lib/realtime/channels";
import { type RealtimeClientConstructor, RealtimeManager } from "@/lib/realtime/manager";

import FakePusher, { fakePusher } from "./fakePusher";

const ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TARGET_A = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const TARGET_B = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const SEARCH_PATH = `/api/backend/v1/profiles/${ACTOR_ID}/search`;
const ACCESS_PATH = `/api/backend/v1/profiles/${ACTOR_ID}/access`;
const OWN_CHANNEL = profileChannel(ACTOR_ID);
const NOW = new Date("2026-11-10T15:00:00Z");
const CSRF = "csrf-de-prueba";
const SIGNATURE = "contactur-test-key:firma-secreta";
const POLLING_TEXT = /Sin conexión en tiempo real: actualizamos los resultados cada 30 segundos/;

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

function actorProfile(category: ProfileCategory): Profile {
  const common = {
    id: ACTOR_ID,
    category,
    display_name: `Actor ${category}`,
    slug: `actor-${category}`,
    description: "Perfil propio",
    status: "published" as const,
    onboarding_step: 4,
    completed_at: "2026-10-01T12:00:00Z",
    primary_city: ushuaia,
    cities: [ushuaia],
    languages: [],
    services: [],
    contact_email: null,
    phone: null,
    avatar: null,
    gallery: [],
    verified: false,
  };
  return category === "tourism_company"
    ? { ...common, category, company: { legal_name: "Turismo Austral SA", years_active: 8 } }
    : { ...common, category: "guide", guide: { education_summary: null }, qualifications: [] };
}

function evaluation(category: ProfileCategory, active = true): AccessEvaluation {
  const sender = category === "tourism_company";
  return {
    profile_id: ACTOR_ID,
    effective_state: active ? "active" : "expired",
    allowed: active,
    denial_code: active ? null : "subscription_expired",
    grant: null,
    capabilities: {
      can_search: active,
      can_send_contact_requests: active && sender,
      can_publish_availability: active && !sender,
      can_receive_contact_requests: active && !sender,
      can_use_gallery: active,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-11-10T15:00:00Z",
  };
}

function account(value: Profile): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
    },
    profiles: [{
      id: value.id,
      category: value.category,
      display_name: value.display_name,
      status: value.status,
      completed_at: value.completed_at,
      access_state: "active",
      capabilities: evaluation(value.category).capabilities,
    }],
    notification_preferences: [],
  };
}

function result(id: string, name: string): SearchResult {
  return {
    safe_profile: {
      id,
      category: "guide",
      display_name: name,
      description: null,
      primary_city: ushuaia,
      cities: [ushuaia],
      languages: [],
      services: [],
      avatar: null,
      gallery: [],
      verified: false,
      category_details: { education_summary: null },
    },
    matched_days: 0,
    requested_days: 0,
    availability_status: "unspecified",
  };
}

function page(items: SearchResult[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20, search_seed: "2026-11-10" } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message }, request_id: `req-${code}` }, status);
}

type ServerMonth = { version: number; available: Record<string, City> };

function monthBody(month: string, server: ServerMonth) {
  const [year, monthNumber] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const city = server.available[date] ?? null;
    return { date, available: city !== null, city };
  });
  return { data: { profile_id: ACTOR_ID, month, version: server.version, days } };
}

type AuthCall = { url: string; headers: Headers; body: unknown };

type Backend = {
  calls: string[];
  authCalls: AuthCall[];
  searchCalls: () => string[];
  accessCalls: () => string[];
  availabilityCalls: () => string[];
  state: {
    access: AccessEvaluation;
    search: (url: string) => Promise<Response>;
    auth: (channelName: string) => Response;
    months: Record<string, ServerMonth>;
  };
};

function mockBackend(actor: Profile): Backend {
  const calls: string[] = [];
  const authCalls: AuthCall[] = [];
  const state: Backend["state"] = {
    access: evaluation(actor.category),
    search: () => Promise.resolve(jsonResponse(page([result(TARGET_A, "Guía Inicial")]))),
    auth: () => jsonResponse({ data: { auth: SIGNATURE, channel_data: null } }),
    months: {},
  };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === BROADCAST_AUTH_PATH) {
      const body: unknown = JSON.parse(String(init?.body));
      authCalls.push({ url, headers: new Headers(init?.headers), body });
      const channelName = typeof body === "object" && body !== null && "channel_name" in body ? String(body.channel_name) : "";
      return Promise.resolve(state.auth(channelName));
    }
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(actor) }));
    if (url.includes("/catalogs")) {
      return Promise.resolve(jsonResponse({
        data: { categories: [], cities: [ushuaia], services: [], languages: [], specialties: [], document_types: [] },
        meta: { next_cursor: null, per_page: 50 },
      }));
    }
    if (url === ACCESS_PATH) return Promise.resolve(jsonResponse({ data: state.access }));
    if (url.startsWith(SEARCH_PATH)) return state.search(url);
    const availability = /\/profiles\/[0-9A-Z]{26}\/availability\?month=(\d{4}-\d{2})$/.exec(url);
    if (availability) {
      const month = availability[1];
      return Promise.resolve(jsonResponse(monthBody(month, state.months[month] ?? { version: 0, available: {} })));
    }
    if (url.endsWith(`/profiles/${ACTOR_ID}`)) return Promise.resolve(jsonResponse({ data: actor }));
    throw new Error(`Unexpected fetch ${url}`);
  });
  return {
    calls,
    authCalls,
    state,
    searchCalls: () => calls.filter((url) => url.startsWith(SEARCH_PATH)),
    accessCalls: () => calls.filter((url) => url === ACCESS_PATH),
    availabilityCalls: () => calls.filter((url) => url.includes("/availability?month=")),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function realtimeRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>("[data-realtime]");
  if (!region) throw new Error("Falta la región de tiempo real");
  return region;
}

async function renderSearch(): Promise<FakePusher> {
  render(<PrivateApp view="search" />);
  await screen.findByRole("article", { name: "Guía Inicial" });
  await waitFor(() => expect(realtimeRegion()).toHaveAttribute("data-realtime", "live"));
  return fakePusher.latest();
}

/** Avanza timers falsos y deja correr las promesas de fetch/json que disparan. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}`);
  window.sessionStorage.clear();
  document.cookie = `${AUTH_COOKIE_NAMES.csrf}=${CSRF}; path=/`;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.cookie = `${AUTH_COOKIE_NAMES.csrf}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});

describe("T16 — authorizer de canales privados", () => {
  it("hace POST al BFF con CSRF y {socket_id, channel_name}, y desenvuelve data para pusher-js", async () => {
    const backend = mockBackend(actorProfile("tourism_company"));
    const data = await requestChannelAuthorization("1234.5678", DIRECTORY_CHANNEL);

    expect(backend.authCalls).toHaveLength(1);
    const [call] = backend.authCalls;
    expect(call.url).toBe("/api/backend/v1/broadcasting/auth");
    expect(call.headers.get("x-csrf-token")).toBe(CSRF);
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({ socket_id: "1234.5678", channel_name: DIRECTORY_CHANNEL });
    const init = vi.mocked(globalThis.fetch).mock.calls.find(([url]) => url === BROADCAST_AUTH_PATH)?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    // channel_data null no se reenvía: pusher-js recibe exactamente {auth}.
    expect(data).toEqual({ auth: SIGNATURE });
  });

  it("al suscribir desde el shell, pusher-js usa el customHandler y la configuración de Reverb", async () => {
    fakePusher.mode = "authorizer";
    const backend = mockBackend(actorProfile("tourism_company"));
    const client = await renderSearch();

    expect(client.key).toBe("contactur-test-key");
    expect(client.options).toMatchObject({
      cluster: "mt1",
      wsHost: "localhost",
      wsPort: 6001,
      wssPort: 6001,
      forceTLS: false,
      enabledTransports: ["ws", "wss"],
      disableStats: true,
    });
    const channels = backend.authCalls.map((call) => (call.body as { channel_name: string }).channel_name).sort();
    expect(channels).toEqual([DIRECTORY_CHANNEL, OWN_CHANNEL].sort());
    expect(backend.authCalls.every((call) => call.headers.get("x-csrf-token") === CSRF)).toBe(true);
    // La firma nunca llega al DOM.
    expect(document.body.innerHTML).not.toContain("firma-secreta");
  });

  it("un 403 deja el canal denegado: sin reintentos, sin polling y sin aviso extra", async () => {
    fakePusher.mode = "authorizer";
    const backend = mockBackend(actorProfile("tourism_company"));
    backend.state.auth = (channelName) => channelName === DIRECTORY_CHANNEL
      ? problem(403, "forbidden", "No autorizado.")
      : jsonResponse({ data: { auth: SIGNATURE, channel_data: null } });

    render(<PrivateApp view="search" />);
    await screen.findByRole("article", { name: "Guía Inicial" });
    await waitFor(() => expect(realtimeRegion()).toHaveAttribute("data-realtime", "denied"));
    const client = fakePusher.latest();
    expect(client.unsubscribeCalls).toContain(DIRECTORY_CHANNEL);
    expect(screen.queryByText(POLLING_TEXT)).toBeNull();

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    await advance(95000);

    expect(backend.searchCalls()).toHaveLength(1);
    const directoryAuths = backend.authCalls.filter((call) => (call.body as { channel_name: string }).channel_name === DIRECTORY_CHANNEL);
    expect(directoryAuths).toHaveLength(1);
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "denied");
    expect(screen.queryByText(POLLING_TEXT)).toBeNull();
  });
});

describe("T16 — búsqueda abierta", () => {
  it("una ráfaga de availability.changed re-consulta una sola vez la primera página, en silencio", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&type=guide&city_id=1`);
    const backend = mockBackend(actorProfile("tourism_company"));
    backend.state.search = () => Promise.resolve(jsonResponse(page([result(TARGET_A, "Guía Inicial")])));
    const client = await renderSearch();
    expect(backend.searchCalls()).toEqual([`${SEARCH_PATH}?type=guide&city_id=1`]);

    const refreshed = deferred<Response>();
    backend.state.search = () => refreshed.promise;
    act(() => {
      for (const version of [5, 6, 7]) {
        client.emit(DIRECTORY_CHANNEL, "availability.changed", { profile_id: TARGET_A, version, months: ["2026-11"] });
      }
    });

    await waitFor(() => expect(backend.searchCalls()).toHaveLength(2));
    // Mientras la re-consulta está en vuelo no hay "cargando": los resultados siguen visibles.
    expect(screen.queryByText("Buscando perfiles…")).toBeNull();
    expect(screen.getByRole("region", { name: "Resultados" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("article", { name: "Guía Inicial" })).toBeInTheDocument();

    await act(async () => {
      refreshed.resolve(jsonResponse(page([result(TARGET_A, "Guía Inicial"), result(TARGET_B, "Guía Nueva")])));
    });
    expect(await screen.findByRole("article", { name: "Guía Nueva" })).toBeInTheDocument();
    expect(backend.searchCalls()).toEqual([`${SEARCH_PATH}?type=guide&city_id=1`, `${SEARCH_PATH}?type=guide&city_id=1`]);
    expect(realtimeRegion()).toHaveTextContent("Resultados actualizados.");

    // Nada más en cola: la ráfaga de tres avisos fue una sola consulta.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(backend.searchCalls()).toHaveLength(2);
  });

  it("el payload del aviso nunca se renderiza", async () => {
    const backend = mockBackend(actorProfile("tourism_company"));
    const client = await renderSearch();

    act(() => {
      client.emit(DIRECTORY_CHANNEL, "directory.changed", { profile_id: "<b>x</b>" });
      client.emit(DIRECTORY_CHANNEL, "availability.changed", { profile_id: "<b>x</b>", version: 99, months: ["<i>m</i>"] });
    });
    await waitFor(() => expect(backend.searchCalls()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const html = document.body.innerHTML;
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("&lt;b&gt;x");
    expect(html).not.toContain("<i>m</i>");
    expect(html).not.toContain("&lt;i&gt;m");
    expect(screen.queryByText(/<b>|99/)).toBeNull();
  });

  it("sin websocket muestra el aviso de 30 s, re-consulta cada 30 s y al reconectar re-consulta una vez y lo quita", async () => {
    const backend = mockBackend(actorProfile("tourism_company"));
    const client = await renderSearch();
    expect(screen.queryByText(POLLING_TEXT)).toBeNull();

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    act(() => client.setState("unavailable"));

    const notice = screen.getByText(POLLING_TEXT);
    // Visible dentro de la región polite y sin prometer actualizaciones instantáneas.
    expect(realtimeRegion()).toHaveAttribute("role", "status");
    expect(within(realtimeRegion()).getByText(POLLING_TEXT)).toBe(notice);
    expect(notice.textContent).not.toMatch(/instant|inmediat|tiempo real\./i);
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "polling");
    expect(backend.searchCalls()).toHaveLength(1);

    await advance(29000);
    expect(backend.searchCalls()).toHaveLength(1);
    await advance(1000);
    expect(backend.searchCalls()).toHaveLength(2);
    await advance(30000);
    expect(backend.searchCalls()).toHaveLength(3);

    act(() => client.setState("connected"));
    await advance(0);
    expect(backend.searchCalls()).toHaveLength(4);
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "live");
    expect(screen.queryByText(POLLING_TEXT)).toBeNull();

    // Ya en vivo no hay más polling.
    await advance(60000);
    expect(backend.searchCalls()).toHaveLength(4);
  });

  it("un 'connecting' de más de 5 s cuenta como no disponible", async () => {
    fakePusher.autoConnect = false;
    mockBackend(actorProfile("tourism_company"));
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    render(<PrivateApp view="search" />);
    // Solo se drenan promesas (0 ms): el reloj del "connecting" no avanza mientras carga.
    for (let index = 0; index < 30 && !screen.queryByRole("article", { name: "Guía Inicial" }); index += 1) {
      await advance(0);
    }
    expect(screen.getByRole("article", { name: "Guía Inicial" })).toBeInTheDocument();
    act(() => fakePusher.latest().setState("connecting"));
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "connecting");
    expect(screen.queryByText(POLLING_TEXT)).toBeNull();

    await advance(5100);
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "polling");
    expect(screen.getByText(POLLING_TEXT)).toBeInTheDocument();
  });
});

describe("T16 — acceso del perfil activo", () => {
  it("access.changed re-evalúa el acceso; sin can_search se libera el canal del directorio y se muestra el bloqueo", async () => {
    const backend = mockBackend(actorProfile("tourism_company"));
    const client = await renderSearch();
    expect(backend.accessCalls()).toHaveLength(1);
    expect(client.channels.has(DIRECTORY_CHANNEL)).toBe(true);

    backend.state.access = evaluation("tourism_company", false);
    backend.state.search = () => Promise.resolve(problem(403, "subscription_expired", "Acceso vencido."));
    act(() => client.emit(OWN_CHANNEL, "access.changed", { profile_id: ACTOR_ID }));

    await waitFor(() => expect(backend.accessCalls()).toHaveLength(2));
    await waitFor(() => expect(client.unsubscribeCalls).toContain(DIRECTORY_CHANNEL));
    expect(client.channels.has(DIRECTORY_CHANNEL)).toBe(false);
    // El canal propio lo comparten shell y buscador: sigue suscripto.
    expect(client.channels.has(OWN_CHANNEL)).toBe(true);
    expect(client.unsubscribeCalls).not.toContain(OWN_CHANNEL);
    expect(await screen.findByRole("heading", { name: "No podés usar el buscador en este momento" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Guía Inicial" })).toBeNull();
    expect(realtimeRegion()).toHaveAttribute("data-realtime", "off");
  });
});

describe("T16 — calendario propio", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-11-10T02:30:00Z"));
    window.history.replaceState({}, "", `/app/availability?profile=${ACTOR_ID}`);
  });

  function day(date: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`button[data-date="${date}"]`);
    if (!button) throw new Error(`Missing day ${date}`);
    return button;
  }

  async function renderCalendar(): Promise<{ backend: Backend; client: FakePusher }> {
    const backend = mockBackend(actorProfile("guide"));
    backend.state.months = { "2026-11": { version: 3, available: {} } };
    render(<PrivateApp view="availability" />);
    await screen.findByRole("heading", { level: 1, name: "Disponibilidad" });
    await waitFor(() => expect(day("2026-11-20")).toHaveAttribute("data-state", "blocked"));
    await waitFor(() => expect(realtimeRegion()).toHaveAttribute("data-realtime", "live"));
    return { backend, client: fakePusher.latest() };
  }

  it("sin borrador, una versión más nueva recarga el mes en silencio", async () => {
    const { backend, client } = await renderCalendar();
    expect(backend.availabilityCalls()).toHaveLength(1);

    // Un aviso con la misma versión (por ejemplo, el propio guardado) se ignora.
    act(() => client.emit(OWN_CHANNEL, "availability.changed", { profile_id: ACTOR_ID, version: 3, months: ["2026-11"] }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(backend.availabilityCalls()).toHaveLength(1);

    backend.state.months = { "2026-11": { version: 4, available: { "2026-11-20": ushuaia } } };
    act(() => client.emit(OWN_CHANNEL, "availability.changed", { profile_id: ACTOR_ID, version: 4, months: ["2026-11"] }));

    await waitFor(() => expect(day("2026-11-20")).toHaveAttribute("data-state", "available"));
    expect(backend.availabilityCalls()).toHaveLength(2);
    expect(screen.queryByText("El calendario cambió en otra sesión")).toBeNull();
    expect(document.querySelector('[data-state="loading"]')).toBeNull();
  });

  it("con borrador conserva los cambios y avisa que el calendario cambió en otra sesión", async () => {
    const { backend, client } = await renderCalendar();
    fireEvent.click(day("2026-11-21"));
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));
    expect(await screen.findByRole("heading", { name: "1 cambio sin guardar" })).toBeInTheDocument();

    backend.state.months = { "2026-11": { version: 5, available: { "2026-11-20": ushuaia } } };
    act(() => client.emit(OWN_CHANNEL, "availability.changed", { profile_id: ACTOR_ID, version: 5, months: ["2026-11"] }));

    expect(await screen.findByText("El calendario cambió en otra sesión")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1 cambio sin guardar" })).toBeInTheDocument();
    expect(day("2026-11-21")).toHaveAttribute("data-draft", "true");
    // El estado confirmado no se reemplazó: el 409 del guardado sigue protegiendo.
    expect(day("2026-11-20")).toHaveAttribute("data-state", "blocked");
  });
});

describe("T16 — ciclo de vida de suscripciones", () => {
  function managerWithFake() {
    const manager = new RealtimeManager({
      config: { key: "k", host: "localhost", port: 6001, forceTLS: false },
      load: () => Promise.resolve(FakePusher as unknown as RealtimeClientConstructor),
      authorize: () => Promise.resolve({ auth: "firma" }),
      onUnauthorized: () => {},
    });
    return manager;
  }

  it("dos consumidores comparten la suscripción; la última liberación la cierra", async () => {
    const manager = managerWithFake();
    manager.start();
    await waitFor(() => expect(fakePusher.instances).toHaveLength(1));
    const client = fakePusher.latest();

    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = manager.listen(DIRECTORY_CHANNEL, new Set(["directory.changed"]), first);
    const releaseSecond = manager.listen(DIRECTORY_CHANNEL, new Set(["directory.changed", "availability.changed"]), second);
    expect(client.subscribeCalls).toEqual([DIRECTORY_CHANNEL]);
    await waitFor(() => expect(manager.getChannelStatus(DIRECTORY_CHANNEL)).toBe("subscribed"));

    client.emit(DIRECTORY_CHANNEL, "availability.changed", { profile_id: TARGET_A });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    releaseFirst();
    expect(client.unsubscribeCalls).toEqual([]);
    client.emit(DIRECTORY_CHANNEL, "directory.changed", { profile_id: TARGET_A });
    expect(second).toHaveBeenCalledTimes(2);

    releaseSecond();
    expect(client.unsubscribeCalls).toEqual([DIRECTORY_CHANNEL]);
    expect(client.channels.has(DIRECTORY_CHANNEL)).toBe(false);
    manager.stop();
    expect(client.disconnected).toBe(true);
  });

  it("subscription_error con status 403 queda denied; otro error queda error", async () => {
    fakePusher.mode = "manual";
    const manager = managerWithFake();
    manager.start();
    await waitFor(() => expect(fakePusher.instances).toHaveLength(1));
    const client = fakePusher.latest();
    manager.listen(DIRECTORY_CHANNEL, new Set(["directory.changed"]), vi.fn());
    manager.listen(OWN_CHANNEL, new Set(["access.changed"]), vi.fn());
    expect(manager.getChannelStatus(DIRECTORY_CHANNEL)).toBe("pending");

    client.fail(DIRECTORY_CHANNEL, 403);
    client.fail(OWN_CHANNEL, 500);
    expect(manager.getChannelStatus(DIRECTORY_CHANNEL)).toBe("denied");
    expect(manager.getChannelStatus(OWN_CHANNEL)).toBe("error");
    expect(client.unsubscribeCalls).toEqual([DIRECTORY_CHANNEL]);
    manager.stop();
  });

  it("al desmontar el shell se liberan los canales y se cierra el socket", async () => {
    mockBackend(actorProfile("tourism_company"));
    const client = await renderSearch();
    expect(client.channels.size).toBe(2);
    cleanup();
    expect(client.disconnected).toBe(true);
  });
});
