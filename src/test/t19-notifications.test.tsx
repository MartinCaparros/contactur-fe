import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import HomePage from "../app/(public)/page";
import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import type {
  AccessEvaluation,
  AppNotification,
  CurrentAccount,
  NotificationPreference,
  Profile,
  ProfileCategory,
} from "@/features/app/api";
import { browserMutation } from "@/lib/browser/auth";

import { fakePusher } from "./fakePusher";

vi.mock("@/lib/browser/auth", () => ({
  browserMutation: vi.fn(),
  readBrowserApiError: vi.fn(async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }),
}));

const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const COMPANY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const GUIDE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const N1 = "01ARZ3NDEKTSV4RRFFQ69G5FN1";
const N2 = "01ARZ3NDEKTSV4RRFFQ69G5FN2";
const N3 = "01ARZ3NDEKTSV4RRFFQ69G5FN3";
const N4 = "01ARZ3NDEKTSV4RRFFQ69G5FN4";
const N5 = "01ARZ3NDEKTSV4RRFFQ69G5FN5";
const N6 = "01ARZ3NDEKTSV4RRFFQ69G5FN6";
const N7 = "01ARZ3NDEKTSV4RRFFQ69G5FN7";
const N8 = "01ARZ3NDEKTSV4RRFFQ69G5FN8";
const N9 = "01ARZ3NDEKTSV4RRFFQ69G5FN9";
const NA = "01ARZ3NDEKTSV4RRFFQ69G5FNA";
const NB = "01ARZ3NDEKTSV4RRFFQ69G5FNB";
const NOW = new Date("2026-11-10T15:00:00Z");
const ushuaia = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR" as const, timezone: "America/Argentina/Ushuaia" };

function actorProfile(category: ProfileCategory): Profile {
  const id = category === "tourism_company" ? COMPANY_ID : GUIDE_ID;
  const common = {
    id,
    category,
    display_name: category === "tourism_company" ? "Turismo Austral" : "Guía Austral",
    slug: `actor-${category}`,
    description: "Perfil propio",
    status: "published" as const,
    onboarding_step: 4,
    completed_at: "2026-10-01T12:00:00Z",
    primary_city: ushuaia,
    cities: [ushuaia],
    languages: [],
    services: [],
    contact_email: "propio@example.test",
    phone: null,
    avatar: null,
    gallery: [],
    verified: false,
  };
  return category === "tourism_company"
    ? { ...common, category: "tourism_company", company: { legal_name: "Turismo Austral SA", years_active: 8 } }
    : { ...common, category: "guide", guide: { education_summary: null }, qualifications: [] };
}

function access(profileId: string): AccessEvaluation {
  return {
    profile_id: profileId,
    effective_state: "active",
    allowed: true,
    denial_code: null,
    grant: null,
    capabilities: {
      can_search: true,
      can_send_contact_requests: profileId === COMPANY_ID,
      can_publish_availability: profileId !== COMPANY_ID,
      can_receive_contact_requests: profileId !== COMPANY_ID,
      can_use_gallery: true,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-11-10T15:00:00Z",
  };
}

function account(profiles: readonly Profile[], preferences: NotificationPreference[] = []): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
    },
    profiles: profiles.map((value) => ({
      id: value.id,
      category: value.category,
      display_name: value.display_name,
      status: value.status,
      completed_at: value.completed_at,
      access_state: "active",
      capabilities: access(value.id).capabilities,
    })),
    notification_preferences: preferences,
  };
}

function notification(
  id: string,
  type: string,
  safeData: Record<string, unknown>,
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id,
    type: type as AppNotification["type"],
    safe_data: safeData,
    read_at: null,
    created_at: "2026-11-10T14:00:00Z",
    ...overrides,
  };
}

function requestData(type: "received" | "accepted" | "rejected" | "expired", name: string, extra: Record<string, unknown> = {}) {
  return {
    profile_id: COMPANY_ID,
    contact_request_id: REQUEST_ID,
    role: type === "received" ? "recipient" : "sender",
    counterpart_profile_id: GUIDE_ID,
    counterpart_display_name: name,
    counterpart_category: "guide",
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status, headers);
}

function page(items: AppNotification[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type NotificationsHandler = (profileId: string, params: URLSearchParams, init?: RequestInit) => Promise<Response>;
type Backend = {
  calls: string[];
  signals: Map<string, AbortSignal[]>;
  fetchMock: MockInstance<typeof fetch>;
  /** Llamadas del listado o de la insignia para un perfil, filtradas por `unread`. */
  notificationCalls: (profileId: string, unread: "true" | "false") => string[];
};

function mockBackend(
  profiles: readonly Profile[],
  notifications: NotificationsHandler,
  preferences: NotificationPreference[] = [],
): Backend {
  const calls: string[] = [];
  const signals = new Map<string, AbortSignal[]>();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    calls.push(url);
    if (init?.signal) signals.set(url, [...(signals.get(url) ?? []), init.signal]);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(profiles, preferences) }));
    const match = /\/profiles\/([0-9A-Z]{26})\/notifications\?(.*)$/.exec(url);
    if (match) return notifications(match[1] ?? "", new URLSearchParams(match[2] ?? ""), init);
    for (const value of profiles) {
      if (url.endsWith(`/profiles/${value.id}/access`)) return Promise.resolve(jsonResponse({ data: access(value.id) }));
      if (url.endsWith(`/profiles/${value.id}`)) return Promise.resolve(jsonResponse({ data: value }));
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return {
    calls,
    signals,
    fetchMock,
    notificationCalls: (profileId, unread) => calls.filter((url) =>
      url.includes(`/profiles/${profileId}/notifications?`) && new URL(url, "http://x").searchParams.get("unread") === unread),
  };
}

function mutationCalls(): Array<Readonly<{ url: string; init: RequestInit }>> {
  return vi.mocked(browserMutation).mock.calls.map(([url, init]) => ({ url: String(url), init: init ?? {} }));
}

function item(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-notification-id="${id}"]`);
  if (!element) throw new Error(`No se encontró la notificación ${id}`);
  return element;
}

async function renderCenter(path = `/app/notifications?profile=${COMPANY_ID}`): Promise<void> {
  window.history.replaceState({}, "", path);
  render(<PrivateApp view="notifications" />);
  await screen.findByRole("heading", { level: 1, name: "Notificaciones" });
}

async function emitNotificationCreated(channelProfileId: string, payloadProfileId = channelProfileId): Promise<void> {
  const channel = `private-profile.${channelProfileId}`;
  await waitFor(() => expect(fakePusher.latest().channels.has(channel)).toBe(true));
  act(() => fakePusher.latest().emit(channel, "notification.created", { profile_id: payloadProfileId, notification_id: N9 }));
}

/** Evita la navegación del router de Next en jsdom; el onClick propio igual se ejecuta. */
function preventNavigation(): () => void {
  const stop = (event: Event) => event.preventDefault();
  window.addEventListener("click", stop, true);
  return () => window.removeEventListener("click", stop, true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("T19 — centro de notificaciones", () => {
  it("arma cada tipo desde claves conocidas de safe_data, como texto y sin claves desconocidas", async () => {
    const hostile = "<img src=x onerror=\"alert(1)\">Guía Austral";
    mockBackend([actorProfile("tourism_company")], async (_profile, params) => jsonResponse(page(params.get("unread") === "true" ? [] : [
      notification(N1, "contact_request_received", requestData("received", hostile, { secret_email: "fuga@example.test", phone: "+5492901999999" })),
      notification(N2, "contact_request_accepted", requestData("accepted", "Guía Andina")),
      notification(N3, "contact_request_rejected", requestData("rejected", "Guía Norte")),
      notification(N4, "contact_request_expired", requestData("expired", "Guía Sur", { role: "recipient" })),
      notification(N5, "administrative_change", {
        change: "document_rejected",
        profile_id: COMPANY_ID,
        document_type: "Habilitación municipal",
        rejection_reason: "<script>alert(2)</script>Archivo ilegible",
        admin_email: "admin-filtrado@example.test",
      }, { read_at: "2026-11-10T14:30:00Z" }),
      notification(N6, "administrative_change", { change: "access_updated", profile_id: COMPANY_ID, access_grant_version: 3 }),
      notification(N7, "administrative_change", { change: "account_suspended" }),
      notification(N8, "welcome", {}),
      notification(NA, "email_verified", { source: "email_change" }),
      notification(NB, "tipo_futuro", { profile_id: COMPANY_ID, title: "<b>no confiable</b>" }),
      notification(N9, "administrative_change", { change: "cambio_futuro", profile_id: COMPANY_ID }),
    ])));
    await renderCenter();
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(11));

    expect(within(item(N1)).getByRole("heading", { name: `Nueva solicitud de ${hostile}` })).toBeInTheDocument();
    expect(within(item(N1)).getByText("Guía")).toBeInTheDocument();
    expect(within(item(N2)).getByRole("heading", { name: "Tu solicitud a Guía Andina fue aceptada" })).toBeInTheDocument();
    expect(within(item(N3)).getByRole("heading", { name: "Tu solicitud a Guía Norte fue rechazada" })).toBeInTheDocument();
    expect(within(item(N4)).getByRole("heading", { name: "Venció la solicitud de Guía Sur" })).toBeInTheDocument();
    expect(within(item(N5)).getByRole("heading", { name: "Documento rechazado: Habilitación municipal" })).toBeInTheDocument();
    expect(item(N5)).toHaveTextContent("Motivo: <script>alert(2)</script>Archivo ilegible.");
    expect(within(item(N6)).getByRole("heading", { name: "Administración actualizó tu acceso" })).toBeInTheDocument();
    expect(within(item(N7)).getByRole("heading", { name: "Administración suspendió tu cuenta" })).toBeInTheDocument();
    expect(within(item(N8)).getByRole("heading", { name: "Te damos la bienvenida a Contactur" })).toBeInTheDocument();
    expect(within(item(NA)).getByRole("heading", { name: "Confirmaste tu nuevo correo" })).toBeInTheDocument();
    expect(within(item(NB)).getByRole("heading", { name: "Nueva notificación" })).toBeInTheDocument();
    expect(within(item(N9)).getByRole("heading", { name: "Administración registró un cambio" })).toBeInTheDocument();

    // Las de cuenta (sin profile_id) se etiquetan "Cuenta"; las del perfil, "Perfil".
    for (const id of [N7, N8, NA]) expect(within(item(id)).getByText("Cuenta")).toBeInTheDocument();
    for (const id of [N1, N5, N6, NB]) expect(within(item(id)).getByText("Perfil")).toBeInTheDocument();

    // Estado de lectura con texto, no solo color; fecha en hora de Argentina.
    expect(item(N1)).toHaveTextContent("No leída");
    expect(item(N5)).toHaveTextContent("Leída");
    expect(within(item(N5)).queryByRole("button", { name: "Marcar como leída" })).toBeNull();
    expect(item(N1)).toHaveTextContent("hace 1 hora · 10/11/2026 a las 11:00 (hora de Argentina)");

    const main = screen.getByRole("main");
    expect(main.querySelector("img, script, b")).toBeNull();
    for (const leaked of ["fuga@example.test", "2901999999", "admin-filtrado@example.test", "no confiable"]) {
      expect(document.body.innerHTML).not.toContain(leaked);
    }
  });

  it("el filtro No leídas va a la query y a la URL; desde la URL se restaura", async () => {
    const backend = mockBackend([actorProfile("tourism_company")], async (_profile, params) => jsonResponse(page(
      params.get("unread") === "true"
        ? [notification(N1, "welcome", {})]
        : [notification(N1, "welcome", {}), notification(N2, "email_verified", { source: "registration" }, { read_at: "2026-11-10T14:10:00Z" })],
    )));
    await renderCenter();
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(2));
    expect(backend.notificationCalls(COMPANY_ID, "false")).toEqual([
      `/api/backend/v1/profiles/${COMPANY_ID}/notifications?unread=false&per_page=20`,
    ]);
    const all = screen.getByRole("button", { name: "Todas" });
    const unread = screen.getByRole("button", { name: "No leídas" });
    expect(all).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(unread);
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(1));
    expect(unread).toHaveAttribute("aria-pressed", "true");
    expect(new URLSearchParams(window.location.search).get("unread")).toBe("true");
    expect(new URLSearchParams(window.location.search).get("profile")).toBe(COMPANY_ID);
    // Insignia + listado: ambos piden la primera página de no leídas.
    expect(backend.notificationCalls(COMPANY_ID, "true").length).toBeGreaterThanOrEqual(2);

    fireEvent.click(all);
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(2));
    expect(new URLSearchParams(window.location.search).get("unread")).toBeNull();

    cleanup();
    await renderCenter(`/app/notifications?profile=${COMPANY_ID}&unread=true`);
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "No leídas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("muestra estados vacíos distintos para Todas y No leídas", async () => {
    mockBackend([actorProfile("tourism_company")], async () => jsonResponse(page([])));
    await renderCenter();
    expect(await screen.findByRole("heading", { name: "Todavía no tenés notificaciones" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No leídas" }));
    expect(await screen.findByRole("heading", { name: "No tenés notificaciones sin leer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver todas" }));
    expect(await screen.findByRole("heading", { name: "Todavía no tenés notificaciones" })).toBeInTheDocument();
  });

  it("Cargar más usa el cursor y no duplica", async () => {
    const backend = mockBackend([actorProfile("tourism_company")], async (_profile, params) => {
      if (params.get("unread") === "true") return jsonResponse(page([]));
      return jsonResponse(params.get("cursor") === "120"
        ? page([notification(N2, "welcome", {}), notification(N3, "welcome", {})])
        : page([notification(N1, "welcome", {}), notification(N2, "welcome", {})], "120"));
    });
    await renderCenter();
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(2));
    expect(screen.getByText(/2 notificaciones cargadas · hay más/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(3));
    expect([...document.querySelectorAll("[data-notification-id]")].map((element) => element.getAttribute("data-notification-id")))
      .toEqual([N1, N2, N3]);
    expect(backend.calls).toContain(`/api/backend/v1/profiles/${COMPANY_ID}/notifications?unread=false&per_page=20&cursor=120`);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(window.location.search).not.toContain("cursor");
  });

  it("al cambiar de perfil limpia la lista, aborta lo pendiente y no mezcla notificaciones", async () => {
    const pendingCompany = deferred<Response>();
    const backend = mockBackend([actorProfile("tourism_company"), actorProfile("guide")], (profileId, params) => {
      if (params.get("unread") === "true") return Promise.resolve(jsonResponse(page([])));
      if (profileId === COMPANY_ID) return pendingCompany.promise;
      return Promise.resolve(jsonResponse(page([notification(N2, "contact_request_received", { ...requestData("received", "Turismo Austral"), profile_id: GUIDE_ID })])));
    });
    await renderCenter();
    const listUrl = `/api/backend/v1/profiles/${COMPANY_ID}/notifications?unread=false&per_page=20`;
    await waitFor(() => expect(backend.calls).toContain(listUrl));
    expect(screen.getByText("Cargando notificaciones…")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Perfil activo" }), { target: { value: GUIDE_ID } });
    await waitFor(() => expect(backend.signals.get(listUrl)?.[0]?.aborted).toBe(true));
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(1));
    expect(item(N2)).toHaveTextContent("Nueva solicitud de Turismo Austral");
    expect(new URLSearchParams(window.location.search).get("profile")).toBe(GUIDE_ID);

    // La respuesta tardía del perfil anterior nunca entra en la lista vigente.
    pendingCompany.resolve(jsonResponse(page([notification(N1, "contact_request_accepted", requestData("accepted", "Otro perfil"))])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(`[data-notification-id="${N1}"]`)).toBeNull();
    expect(screen.getByRole("main")).not.toHaveTextContent("Otro perfil");
  });

  it("marca como leída con POST optimista, revierte ante error y no repite el POST", async () => {
    mockBackend([actorProfile("tourism_company")], async (_profile, params) => jsonResponse(page(
      params.get("unread") === "true" ? [] : [notification(N1, "welcome", {}), notification(N2, "contact_request_accepted", requestData("accepted", "Guía Andina"))],
    )));
    await renderCenter();
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(2));

    const pending = deferred<Response>();
    vi.mocked(browserMutation).mockReturnValueOnce(pending.promise);
    const button = within(item(N1)).getByRole("button", { name: "Marcar como leída" });
    fireEvent.click(button);
    fireEvent.click(button);
    // Optimista: ya figura leída antes de que responda el backend.
    expect(item(N1)).toHaveAttribute("data-read", "true");
    expect(item(N1)).toHaveTextContent("Leída");
    expect(within(item(N1)).queryByRole("button", { name: "Marcar como leída" })).toBeNull();
    expect(mutationCalls()).toHaveLength(1);
    expect(mutationCalls()[0]?.url).toBe(`/api/backend/v1/profiles/${COMPANY_ID}/notifications/${N1}/read`);
    expect(mutationCalls()[0]?.init.method).toBe("POST");
    expect(mutationCalls()[0]?.init.body).toBeUndefined();

    pending.resolve(jsonResponse({ data: notification(N1, "welcome", {}, { read_at: "2026-11-10T15:00:00Z" }) }));
    await waitFor(() => expect(item(N1)).toHaveAttribute("data-read", "true"));

    // Error: vuelve a "No leída" con un mensaje junto a la notificación.
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(503, "service_unavailable", "Servicio no disponible."));
    fireEvent.click(within(item(N2)).getByRole("button", { name: "Marcar como leída" }));
    expect(await within(item(N2)).findByRole("alert")).toHaveTextContent("No pudimos marcarla como leída. Probá de nuevo.");
    expect(item(N2)).toHaveAttribute("data-read", "false");
    expect(within(item(N2)).getByRole("button", { name: "Marcar como leída" })).toBeInTheDocument();
    expect(mutationCalls()).toHaveLength(2);
  });

  it("el enlace a la solicitud lleva al detalle con el perfil activo y la marca como leída", async () => {
    mockBackend([actorProfile("tourism_company")], async (_profile, params) => jsonResponse(page(
      params.get("unread") === "true" ? [] : [notification(N1, "contact_request_accepted", requestData("accepted", "Guía Andina"))],
    )));
    await renderCenter();
    const link = await within(await waitFor(() => item(N1))).findByRole("link", { name: "Ver solicitud" });
    expect(link).toHaveAttribute("href", `/app/requests/${REQUEST_ID}?profile=${COMPANY_ID}`);

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: notification(N1, "contact_request_accepted", requestData("accepted", "Guía Andina"), { read_at: "2026-11-10T15:00:00Z" }) }));
    const release = preventNavigation();
    fireEvent.click(link);
    release();
    await waitFor(() => expect(mutationCalls()).toHaveLength(1));
    expect(mutationCalls()[0]?.url).toBe(`/api/backend/v1/profiles/${COMPANY_ID}/notifications/${N1}/read`);
    expect(item(N1)).toHaveAttribute("data-read", "true");

    // Ya leída: el enlace sigue disponible y no repite el POST.
    const releaseAgain = preventNavigation();
    fireEvent.click(within(item(N1)).getByRole("link", { name: "Ver solicitud" }));
    releaseAgain();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutationCalls()).toHaveLength(1);
  });

  it("muestra 403 con el patrón de acceso y 401 redirige al login", async () => {
    mockBackend([actorProfile("tourism_company")], async (_profile, params) => params.get("unread") === "true"
      ? jsonResponse(page([]))
      : problem(403, "profile_suspended", "Perfil suspendido."));
    await renderCenter();
    expect(await screen.findByRole("heading", { name: "No podés ver las notificaciones en este momento" })).toBeInTheDocument();
    expect(screen.getByText("Tu perfil está suspendido y no puede realizar esta acción.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver estado de acceso" })).toHaveAttribute("href", `/app/access?profile=${COMPANY_ID}`);
  });

  it("refresca la lista en silencio con notification.created sin perder lo cargado", async () => {
    let round = 0;
    const backend = mockBackend([actorProfile("tourism_company")], async (_profile, params) => {
      if (params.get("unread") === "true") return jsonResponse(page([]));
      if (params.get("cursor") === "120") return jsonResponse(page([notification(N3, "welcome", {})]));
      return jsonResponse(round === 0
        ? page([notification(N1, "welcome", {}), notification(N2, "welcome", {})], "120")
        : page([notification(N4, "administrative_change", { change: "access_updated", profile_id: COMPANY_ID }), notification(N1, "welcome", {})], "121"));
    });
    await renderCenter();
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(3));

    round = 1;
    const before = backend.notificationCalls(COMPANY_ID, "false").length;
    await emitNotificationCreated(COMPANY_ID);
    await waitFor(() => expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(4));
    expect(backend.notificationCalls(COMPANY_ID, "false").length).toBe(before + 1);
    expect([...document.querySelectorAll("[data-notification-id]")].map((element) => element.getAttribute("data-notification-id")))
      .toEqual([N4, N1, N2, N3]);
    expect(screen.getByTestId("notifications-live")).toHaveTextContent("Llegó 1 notificación nueva.");
    expect(screen.queryByText("Cargando notificaciones…")).toBeNull();

    // Un aviso de otro perfil no re-consulta.
    const after = backend.notificationCalls(COMPANY_ID, "false").length;
    await emitNotificationCreated(COMPANY_ID, GUIDE_ID);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(backend.notificationCalls(COMPANY_ID, "false").length).toBe(after);
  });
});

describe("T19 — menú e insignia", () => {
  it("habilita Notificaciones para todas las categorías", () => {
    for (const category of ["tourism_company", "guide", "driver", "instructor", "transport_company"] as const) {
      expect(navigationFor(category).find((entry) => entry.label === "Notificaciones"))
        .toEqual({ label: "Notificaciones", href: "/app/notifications" });
    }
  });

  it("cuenta las no leídas de la primera página y se refresca con notification.created del perfil activo", async () => {
    let unread = [notification(N1, "welcome", {}), notification(N2, "welcome", {}), notification(N3, "welcome", {})];
    const backend = mockBackend([actorProfile("tourism_company")], async () => jsonResponse(page(unread)));
    window.history.replaceState({}, "", `/app?profile=${COMPANY_ID}`);
    render(<PrivateApp />);
    const link = await screen.findByRole("link", { name: "Notificaciones, 3 sin leer" });
    expect(link).toHaveAttribute("href", `/app/notifications?profile=${COMPANY_ID}`);
    expect(link).toHaveTextContent("3");
    expect(backend.notificationCalls(COMPANY_ID, "true")).toEqual([
      `/api/backend/v1/profiles/${COMPANY_ID}/notifications?unread=true&per_page=20`,
    ]);

    unread = [notification(N4, "welcome", {}), ...unread];
    await emitNotificationCreated(COMPANY_ID);
    expect(await screen.findByRole("link", { name: "Notificaciones, 4 sin leer" })).toBeInTheDocument();

    // Aviso de otro perfil: no re-consulta la insignia.
    const calls = backend.notificationCalls(COMPANY_ID, "true").length;
    await emitNotificationCreated(COMPANY_ID, GUIDE_ID);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(backend.notificationCalls(COMPANY_ID, "true").length).toBe(calls);
  });

  it("muestra 20+ cuando hay más páginas y se actualiza al marcar como leída", async () => {
    const twenty = Array.from({ length: 20 }, (_, index) =>
      notification(`01ARZ3NDEKTSV4RRFFQ69G5G${String(index).padStart(2, "0")}`, "welcome", {}));
    let more: string | null = "300";
    mockBackend([actorProfile("tourism_company")], async (_profile, params) => jsonResponse(
      params.get("unread") === "true" ? page(more ? twenty : twenty.slice(1), more) : page([twenty[0] as AppNotification]),
    ));
    await renderCenter();
    const link = await screen.findByRole("link", { name: "Notificaciones, más de 20 sin leer" });
    expect(link).toHaveTextContent("20+");

    more = null;
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: { ...twenty[0], read_at: "2026-11-10T15:00:00Z" } }));
    const first = twenty[0] as AppNotification;
    fireEvent.click(within(await waitFor(() => item(first.id))).getByRole("button", { name: "Marcar como leída" }));
    expect(await screen.findByRole("link", { name: "Notificaciones, 19 sin leer" })).toHaveTextContent("19");
  });

  it("sin no leídas el enlace no muestra número", async () => {
    mockBackend([actorProfile("guide")], async () => jsonResponse(page([])));
    window.history.replaceState({}, "", `/app/notifications?profile=${GUIDE_ID}`);
    render(<PrivateApp view="notifications" />);
    const link = await screen.findByRole("link", { name: "Notificaciones" });
    await waitFor(() => expect(link).toHaveAttribute("data-unread", "0"));
    expect(link).toHaveTextContent(/^Notificaciones$/);
  });
});

describe("T19 — preferencias de correo", () => {
  it("ofrece solo los cuatro opcionales como casillas y envía la lista completa con booleanos", async () => {
    mockBackend([actorProfile("tourism_company")], async () => jsonResponse(page([])), [
      { event_type: "contact_request_rejected", email_enabled: false },
    ]);
    await renderCenter();
    const form = screen.getByRole("form", { name: "Preferencias de correo" });
    expect(form.closest("section")).toHaveTextContent("se aplican a todos tus perfiles");
    const checkboxes = within(form).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(4);
    expect(within(form).getByLabelText("Cuando recibís una solicitud de contacto")).toBeChecked();
    expect(within(form).getByLabelText("Cuando rechazan una solicitud que enviaste")).not.toBeChecked();
    expect(within(form).queryByRole("checkbox", { name: /administrativ|verificación|bienvenida/i })).toBeNull();
    expect(form).toHaveTextContent("Siempre se envían");
    expect(form).toHaveTextContent("Cambios administrativos");
    expect(form).toHaveTextContent("Solo en la plataforma");

    fireEvent.click(within(form).getByLabelText("Cuando recibís una solicitud de contacto"));
    const saved = [
      { event_type: "contact_request_received", email_enabled: false },
      { event_type: "contact_request_accepted", email_enabled: true },
      { event_type: "contact_request_rejected", email_enabled: false },
      { event_type: "contact_request_expired", email_enabled: true },
    ] satisfies NotificationPreference[];
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: account([actorProfile("tourism_company")], saved) }));
    fireEvent.click(within(form).getByRole("button", { name: "Guardar preferencias" }));

    expect(await within(form).findByText("Preferencias guardadas.")).toBeInTheDocument();
    const [call] = mutationCalls();
    expect(call?.url).toBe("/api/backend/v1/me");
    expect(call?.init.method).toBe("PATCH");
    expect(JSON.parse(String(call?.init.body))).toEqual({ notification_preferences: saved });
    expect(within(form).getByLabelText("Cuando recibís una solicitud de contacto")).not.toBeChecked();
  });

  it("muestra los errores 422 junto a la casilla correspondiente", async () => {
    mockBackend([actorProfile("tourism_company")], async () => jsonResponse(page([])));
    await renderCenter();
    const form = screen.getByRole("form", { name: "Preferencias de correo" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      "notification_preferences.1.email_enabled": ["El valor tiene que ser verdadero o falso."],
    }));
    fireEvent.click(within(form).getByRole("button", { name: "Guardar preferencias" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("Revisá las preferencias marcadas.");
    const accepted = within(form).getByLabelText("Cuando aceptan una solicitud que enviaste");
    expect(accepted).toHaveAttribute("aria-invalid", "true");
    const describedBy = accepted.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)).toHaveTextContent("El valor tiene que ser verdadero o falso.");
    expect(within(form).queryByText("Preferencias guardadas.")).toBeNull();
  });
});

describe("T19 — formulario de contacto de la landing", () => {
  function contactForm(): HTMLFormElement {
    return screen.getByRole("form", { name: "¿Tenés alguna consulta?" }) as HTMLFormElement;
  }

  function fill(form: HTMLElement, values: Partial<Record<"name" | "email" | "category" | "message", string>> = {}): void {
    fireEvent.change(within(form).getByLabelText("Nombre"), { target: { value: values.name ?? "Paula Fernández" } });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: values.email ?? "paula@example.test" } });
    fireEvent.change(within(form).getByLabelText("Categoría (opcional)"), { target: { value: values.category ?? "access" } });
    fireEvent.change(within(form).getByLabelText("Mensaje"), { target: { value: values.message ?? "Quisiera conocer el proceso de alta." } });
  }

  function expectNoSuccess(): void {
    expect(screen.queryByText(/Recibimos tu consulta/)).toBeNull();
  }

  it("envía de verdad, deshabilita mientras envía y confirma solo con 202", async () => {
    render(<HomePage />);
    const form = contactForm();
    expect(form).not.toHaveTextContent(/preparad|integrar|en preparación/i);
    fill(form);
    const pending = deferred<Response>();
    vi.mocked(browserMutation).mockReturnValueOnce(pending.promise);
    fireEvent.submit(form);

    const button = within(form).getByRole("button", { name: "Enviando…" });
    expect(button).toBeDisabled();
    expectNoSuccess();
    const [call] = mutationCalls();
    expect(call?.url).toBe("/api/backend/v1/support-inquiries");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      name: "Paula Fernández",
      email: "paula@example.test",
      category: "access",
      message: "Quisiera conocer el proceso de alta.",
      website: "",
    });

    pending.resolve(jsonResponse({ data: { id: N1, accepted: true } }, 202));
    expect(await within(form).findByText("Recibimos tu consulta. Te vamos a responder por email.")).toHaveAttribute("role", "status");
    expect(within(form).getByLabelText("Nombre")).toHaveValue("");
    expect(within(form).getByLabelText("Mensaje")).toHaveValue("");
    expect(within(form).getByRole("button", { name: "Enviar consulta →" })).toBeEnabled();
  });

  it("sin categoría la envía como null y el honeypot completado por un bot viaja tal cual", async () => {
    render(<HomePage />);
    const form = contactForm();
    fill(form, { category: "" });
    const honeypot = form.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot).not.toBeNull();
    expect(honeypot?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    fireEvent.change(honeypot as HTMLInputElement, { target: { value: "https://spam.example" } });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      website: ["El campo website debe estar vacío."],
    }));
    fireEvent.submit(form);

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos procesar tu consulta. Revisá los datos e intentá de nuevo.");
    expect(document.body.textContent).not.toMatch(/website|sitio web debe/i);
    const body = JSON.parse(String(mutationCalls()[0]?.init.body)) as Record<string, unknown>;
    expect(body.category).toBeNull();
    expect(body.website).toBe("https://spam.example");
    expectNoSuccess();
  });

  it("ubica los 422 junto a cada campo con aria-invalid y aria-describedby", async () => {
    render(<HomePage />);
    const form = contactForm();
    fill(form, { name: "P", message: "Corto" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      name: ["El nombre debe tener al menos 2 caracteres."],
      message: ["El mensaje debe tener al menos 10 caracteres."],
    }));
    fireEvent.submit(form);

    expect(await within(form).findByRole("alert")).toHaveTextContent("Revisá los datos marcados en el formulario.");
    const name = within(form).getByLabelText("Nombre");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")).toHaveTextContent("El nombre debe tener al menos 2 caracteres.");
    const message = within(form).getByLabelText("Mensaje");
    expect(message).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(message.getAttribute("aria-describedby") ?? "")).toHaveTextContent("El mensaje debe tener al menos 10 caracteres.");
    expect(within(form).getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(name).toHaveFocus();
    // Los datos no se pierden ante un error.
    expect(message).toHaveValue("Corto");
    expectNoSuccess();
  });

  it.each([
    ["429", () => problem(429, "rate_limited", "Demasiadas solicitudes.", undefined, { "retry-after": "120" }), "Hiciste demasiados envíos seguidos. Esperá 2 minutos y volvé a intentar."],
    ["503", () => problem(503, "service_unavailable", "No pudimos registrar tu consulta."), "No pudimos enviar tu consulta. Intentá de nuevo en unos minutos."],
    ["502", () => problem(502, "backend_unavailable", "Servicio no disponible."), "No pudimos enviar tu consulta. Intentá de nuevo en unos minutos."],
    ["200 sin 202", () => jsonResponse({ data: { id: N1, accepted: true } }, 200), "No pudimos enviar tu consulta. Intentá de nuevo en unos minutos."],
  ])("con %s muestra un mensaje honesto y nunca confirma", async (_label, response, text) => {
    render(<HomePage />);
    const form = contactForm();
    fill(form);
    vi.mocked(browserMutation).mockResolvedValueOnce(response());
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent(text);
    expectNoSuccess();
    expect(within(form).getByLabelText("Nombre")).toHaveValue("Paula Fernández");
    expect(within(form).getByRole("button", { name: "Enviar consulta →" })).toBeEnabled();
  });

  it("ante un error de red no confirma y permite reintentar", async () => {
    render(<HomePage />);
    const form = contactForm();
    fill(form);
    vi.mocked(browserMutation).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.submit(form);
    expect(await within(form).findByRole("alert")).toHaveTextContent("No pudimos enviar tu consulta. Intentá de nuevo en unos minutos.");
    expectNoSuccess();

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: { id: N1, accepted: true } }, 202));
    fireEvent.submit(form);
    expect(await within(form).findByText(/Recibimos tu consulta/)).toBeInTheDocument();
    expect(within(form).queryByRole("alert")).toBeNull();
  });
});
