import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AdminBackoffice } from "@/features/admin/AdminShell";
import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import type { AccessEvaluation, CurrentAccount, Profile, ProfileCategory } from "@/features/app/api";
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
const NOW = new Date("2026-11-10T15:00:00Z");
const ushuaia = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR" as const, timezone: "America/Argentina/Ushuaia" };
const CATEGORIES = ["tourism_company", "guide", "driver", "instructor", "transport_company"] as const;

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

function access(profileId: string, overrides: Partial<AccessEvaluation> = {}): AccessEvaluation {
  return {
    profile_id: profileId,
    effective_state: "active",
    allowed: true,
    denial_code: null,
    grant: null,
    capabilities: {
      can_search: profileId === COMPANY_ID,
      can_send_contact_requests: profileId === COMPANY_ID,
      can_publish_availability: profileId !== COMPANY_ID,
      can_receive_contact_requests: profileId !== COMPANY_ID,
      can_use_gallery: true,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-11-10T15:00:00Z",
    ...overrides,
  };
}

const SUSPENDED_ACCOUNT_ACCESS: Partial<AccessEvaluation> = {
  effective_state: "suspended",
  allowed: false,
  denial_code: "account_suspended",
};

const SUSPENDED_PROFILE_ACCESS: Partial<AccessEvaluation> = {
  effective_state: "suspended",
  allowed: false,
  denial_code: "profile_suspended",
};

function account(profiles: readonly Profile[], user: Partial<CurrentAccount["user"]> = {}): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
      ...user,
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
    notification_preferences: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status);
}

type MetricValues = Readonly<Record<string, number>>;

function dashboardBody(profileId: string, values: MetricValues, overrides: Partial<AccessEvaluation> = {}) {
  const evaluation = access(profileId, overrides);
  return {
    data: {
      profile_id: profileId,
      metrics: Object.entries(values).map(([key, value]) => ({ key, value })),
      capabilities: evaluation.capabilities,
      access: evaluation,
    },
  };
}

const COMPANY_METRICS: MetricValues = {
  pending_contact_requests: 3,
  accepted_contact_requests: 2,
  rejected_contact_requests: 1,
  expired_contact_requests: 0,
  unread_notifications: 4,
  visible_references: 5,
};

const GUIDE_METRICS: MetricValues = { ...COMPANY_METRICS, pending_contact_requests: 7, available_future_days: 12 };

type DashboardHandler = (profileId: string, init?: RequestInit) => Promise<Response>;
type Backend = {
  calls: string[];
  signals: Map<string, AbortSignal[]>;
  state: {
    user: Partial<CurrentAccount["user"]>;
    access: Record<string, Partial<AccessEvaluation>>;
  };
  dashboardCalls: (profileId: string) => string[];
  meCalls: () => number;
};

function mockBackend(profiles: readonly Profile[], dashboard: DashboardHandler): Backend {
  const calls: string[] = [];
  const signals = new Map<string, AbortSignal[]>();
  const state: Backend["state"] = { user: {}, access: {} };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    calls.push(url);
    if (init?.signal) signals.set(url, [...(signals.get(url) ?? []), init.signal]);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(profiles, state.user) }));
    if (url.includes("/notifications?")) return Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 20 } }));
    for (const value of profiles) {
      if (url.endsWith(`/profiles/${value.id}/dashboard`)) return dashboard(value.id, init);
      if (url.endsWith(`/profiles/${value.id}/access`)) {
        return Promise.resolve(jsonResponse({ data: access(value.id, state.access[value.id]) }));
      }
      if (url.endsWith(`/profiles/${value.id}`)) return Promise.resolve(jsonResponse({ data: value }));
    }
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
  return {
    calls,
    signals,
    state,
    dashboardCalls: (profileId) => calls.filter((url) => url.endsWith(`/profiles/${profileId}/dashboard`)),
    meCalls: () => calls.filter((url) => url.endsWith("/me")).length,
  };
}

function metric(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-metric="${key}"]`);
  if (!element) throw new Error(`No se encontró el indicador ${key}`);
  return element;
}

function metricsSection(): HTMLElement {
  return screen.getByRole("region", { name: "Indicadores del perfil" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function emit(profileId: string, eventName: string, payload: Record<string, unknown>): Promise<void> {
  const channel = `private-profile.${profileId}`;
  await waitFor(() => expect(fakePusher.latest().channels.has(channel)).toBe(true));
  act(() => fakePusher.latest().emit(channel, eventName, payload));
}

type LocationStub = Readonly<{ replaced: string[]; restore: () => void }>;

/** Reemplaza `window.location` después del montaje: captura los redirects sin navegar. */
function stubLocation(): LocationStub {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const current = new URL(window.location.href);
  const replaced: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: current.href,
      origin: current.origin,
      pathname: current.pathname,
      search: current.search,
      hash: "",
      replace: (target: string) => { replaced.push(target); },
      assign: (target: string) => { replaced.push(target); },
    },
  });
  return {
    replaced,
    restore: () => {
      if (original) Object.defineProperty(window, "location", original);
    },
  };
}

function mutationBody(index: number): unknown {
  const init = vi.mocked(browserMutation).mock.calls[index]?.[1];
  return typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
}

async function renderDashboard(actor: Profile, dashboard: DashboardHandler, others: readonly Profile[] = []): Promise<Backend> {
  window.history.replaceState({}, "", `/app?profile=${actor.id}`);
  const backend = mockBackend([actor, ...others], dashboard);
  render(<PrivateApp />);
  await screen.findByRole("heading", { level: 1, name: actor.display_name });
  return backend;
}

async function renderSettings(actor: Profile = actorProfile("tourism_company")): Promise<Backend> {
  window.history.replaceState({}, "", `/app/settings?profile=${actor.id}`);
  const backend = mockBackend([actor], (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, {}))));
  render(<PrivateApp view="settings" />);
  await screen.findByRole("heading", { level: 1, name: "Ajustes" });
  return backend;
}

let location: LocationStub | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
});

afterEach(() => {
  location?.restore();
  location = null;
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("T21 — Resumen con indicadores reales", () => {
  it("empresa: muestra sus KPIs con etiquetas y enlaces, sin días disponibles ni claves desconocidas", async () => {
    await renderDashboard(actorProfile("tourism_company"), (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, {
      ...COMPANY_METRICS,
      contratos_realizados: 99,
    }))));

    await waitFor(() => expect(document.querySelectorAll("[data-metric]")).toHaveLength(6));
    const expected: ReadonlyArray<readonly [string, string, string, string, string]> = [
      ["pending_contact_requests", "Solicitudes pendientes", "3", "Ver solicitudes pendientes", `/app/requests?profile=${COMPANY_ID}&status=pending`],
      ["accepted_contact_requests", "Solicitudes aceptadas", "2", "Ver solicitudes aceptadas", `/app/requests?profile=${COMPANY_ID}&status=accepted`],
      ["rejected_contact_requests", "Solicitudes rechazadas", "1", "Ver solicitudes rechazadas", `/app/requests?profile=${COMPANY_ID}&status=rejected`],
      ["expired_contact_requests", "Solicitudes vencidas", "0", "Ver solicitudes vencidas", `/app/requests?profile=${COMPANY_ID}&status=expired`],
      ["unread_notifications", "Notificaciones sin leer", "4", "Ver notificaciones sin leer", `/app/notifications?profile=${COMPANY_ID}&unread=true`],
      ["visible_references", "Referencias publicadas", "5", "Ver referencias recibidas", `/app/references?profile=${COMPANY_ID}&direction=received`],
    ];
    expect([...document.querySelectorAll("[data-metric]")].map((element) => element.getAttribute("data-metric")))
      .toEqual(expected.map(([key]) => key));
    for (const [key, label, value, linkLabel, href] of expected) {
      const card = metric(key);
      expect(within(card).getByRole("term")).toHaveTextContent(label);
      expect(within(card).getAllByRole("definition")[0]).toHaveTextContent(value);
      expect(within(card).getByRole("link", { name: linkLabel })).toHaveAttribute("href", href);
    }
    // La empresa no publica disponibilidad: no hay KPI (ni un 0 inventado).
    expect(within(metricsSection()).queryByText("Días disponibles a futuro")).toBeNull();
    expect(metricsSection()).not.toHaveTextContent(/contratos|99|ranking/i);
    expect(metric("accepted_contact_requests")).toHaveTextContent("No implica una contratación.");
  });

  it("receptor: suma los días disponibles a futuro con enlace a Disponibilidad", async () => {
    await renderDashboard(actorProfile("guide"), (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, GUIDE_METRICS))));

    const card = await waitFor(() => metric("available_future_days"));
    expect(within(card).getByRole("term")).toHaveTextContent("Días disponibles a futuro");
    expect(within(card).getAllByRole("definition")[0]).toHaveTextContent("12");
    expect(within(card).getByRole("link", { name: "Ver disponibilidad" })).toHaveAttribute("href", `/app/availability?profile=${GUIDE_ID}`);
    expect(document.querySelectorAll("[data-metric]")).toHaveLength(7);
  });

  it("un error no muestra ceros inventados y Reintentar vuelve a consultar", async () => {
    let fail = true;
    const backend = await renderDashboard(actorProfile("tourism_company"), (profileId) => Promise.resolve(fail
      ? problem(500, "server_error", "Error interno.")
      : jsonResponse(dashboardBody(profileId, COMPANY_METRICS))));

    const alert = await within(metricsSection()).findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar los indicadores");
    expect(document.querySelector("[data-metric]")).toBeNull();
    expect(metricsSection()).not.toHaveTextContent(/\b0\b/);
    expect(metricsSection()).not.toHaveTextContent("Error interno.");

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("3"));
    expect(backend.dashboardCalls(COMPANY_ID)).toHaveLength(2);
    expect(within(metricsSection()).queryByRole("alert")).toBeNull();
  });

  it("descarta una respuesta que no es del perfil activo", async () => {
    await renderDashboard(actorProfile("tourism_company"), () => Promise.resolve(jsonResponse(dashboardBody(GUIDE_ID, GUIDE_METRICS))));

    expect(await within(metricsSection()).findByRole("alert")).toHaveTextContent("No pudimos cargar los indicadores");
    expect(document.querySelector("[data-metric]")).toBeNull();
  });

  it("se actualiza en silencio con los avisos del perfil activo e ignora los de otro perfil", async () => {
    let pending = 7;
    const backend = await renderDashboard(actorProfile("guide"), (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, {
      ...GUIDE_METRICS,
      pending_contact_requests: pending,
    }))));
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("7"));
    expect(backend.dashboardCalls(GUIDE_ID)).toHaveLength(1);

    // Aviso con el profile_id de otro perfil en el canal propio: no re-consulta.
    await emit(GUIDE_ID, "notification.created", { profile_id: COMPANY_ID, notification_id: GUIDE_ID });
    await new Promise((done) => setTimeout(done, 400));
    expect(backend.dashboardCalls(GUIDE_ID)).toHaveLength(1);

    pending = 8;
    await emit(GUIDE_ID, "notification.created", { profile_id: GUIDE_ID, notification_id: GUIDE_ID });
    // Sin pasar por "cargando": los valores anteriores siguen a la vista hasta la respuesta.
    expect(metric("pending_contact_requests")).toBeInTheDocument();
    expect(within(metricsSection()).queryByText("Cargando indicadores…")).toBeNull();
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("8"));
    expect(backend.dashboardCalls(GUIDE_ID)).toHaveLength(2);

    pending = 9;
    await emit(GUIDE_ID, "availability.changed", { profile_id: GUIDE_ID, version: 2, months: ["2026-11"] });
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("9"));

    pending = 10;
    await emit(GUIDE_ID, "access.changed", { profile_id: GUIDE_ID });
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("10"));
    expect(backend.dashboardCalls(GUIDE_ID)).toHaveLength(4);
  });

  it("si la actualización silenciosa falla conserva los últimos valores confirmados y lo avisa", async () => {
    let fail = false;
    await renderDashboard(actorProfile("guide"), (profileId) => Promise.resolve(fail
      ? problem(503, "backend_unavailable", "No disponible.")
      : jsonResponse(dashboardBody(profileId, GUIDE_METRICS))));
    await waitFor(() => metric("pending_contact_requests"));

    fail = true;
    await emit(GUIDE_ID, "notification.created", { profile_id: GUIDE_ID, notification_id: GUIDE_ID });
    expect(await within(metricsSection()).findByText(/No pudimos actualizar los indicadores/)).toBeInTheDocument();
    expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("7");
  });

  it("al cambiar de perfil aborta la consulta anterior y nunca mezcla valores", async () => {
    const companyDashboard = deferred<Response>();
    const backend = await renderDashboard(
      actorProfile("tourism_company"),
      (profileId) => profileId === COMPANY_ID
        ? companyDashboard.promise
        : Promise.resolve(jsonResponse(dashboardBody(profileId, GUIDE_METRICS))),
      [actorProfile("guide")],
    );
    await waitFor(() => expect(backend.dashboardCalls(COMPANY_ID)).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Perfil activo"), { target: { value: GUIDE_ID } });
    await screen.findByRole("heading", { level: 1, name: "Guía Austral" });
    await waitFor(() => expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("7"));
    const companySignal = backend.signals.get(`/api/backend/v1/profiles/${COMPANY_ID}/dashboard`)?.[0];
    expect(companySignal?.aborted).toBe(true);

    // La respuesta tardía del perfil anterior no pisa los valores del activo.
    companyDashboard.resolve(jsonResponse(dashboardBody(COMPANY_ID, { ...COMPANY_METRICS, pending_contact_requests: 99 })));
    await new Promise((done) => setTimeout(done, 50));
    expect(within(metric("pending_contact_requests")).getAllByRole("definition")[0]).toHaveTextContent("7");
    expect(metric("available_future_days")).toBeInTheDocument();
    expect(within(metric("pending_contact_requests")).getByRole("link", { name: "Ver solicitudes pendientes" }))
      .toHaveAttribute("href", `/app/requests?profile=${GUIDE_ID}&status=pending`);
  });
});

describe("T21 — navegación final", () => {
  it("Ajustes es un destino real para todas las categorías y no queda ningún placeholder", async () => {
    for (const category of CATEGORIES) {
      expect(navigationFor(category).find((item) => item.label === "Ajustes")).toEqual({ label: "Ajustes", href: "/app/settings" });
      expect(navigationFor(category).map((item) => item.label)).toEqual(category === "tourism_company"
        ? ["Buscar", "Solicitudes", "Perfil", "Referencias", "Acceso", "Ajustes", "Notificaciones"]
        : ["Disponibilidad", "Solicitudes", "Perfil", "Referencias", "Acceso", "Ajustes", "Notificaciones"]);
    }

    await renderDashboard(actorProfile("tourism_company"), (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, COMPANY_METRICS))));
    const nav = screen.getByRole("complementary", { name: "Navegación del perfil" });
    expect(within(nav).getByRole("link", { name: "Ajustes" })).toHaveAttribute("href", `/app/settings?profile=${COMPANY_ID}`);
    expect(within(nav).getAllByRole("link").every((link) => link.hasAttribute("href") && !link.hasAttribute("aria-disabled"))).toBe(true);
    expect(document.body).not.toHaveTextContent(/Disponible en próxima etapa/);
  });

  it("el backoffice tampoco muestra destinos pendientes", async () => {
    window.history.replaceState({}, "", "/admin");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return Promise.resolve(jsonResponse({ data: { ...account([]), user: { ...account([]).user, system_role: "admin" } } }));
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(<AdminBackoffice view="dashboard" />);
    const nav = await screen.findByRole("complementary", { name: "Navegación del backoffice" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Panel", "Cuentas", "Perfiles", "Documentos", "Referencias", "Auditoría"]);
    expect(links.every((link) => link.hasAttribute("href") && !link.hasAttribute("aria-disabled"))).toBe(true);
    expect(document.body).not.toHaveTextContent(/Disponible en próxima etapa/);
  });
});

describe("T21 — Ajustes de la cuenta", () => {
  it("son de la cuenta: muestran el email actual como solo lectura y guardan el nombre con el body exacto", async () => {
    await renderSettings();
    expect(screen.getByText(/Estos ajustes son de tu cuenta y se aplican a todos tus perfiles/)).toBeInTheDocument();
    const accountSection = screen.getByRole("region", { name: "Datos de la cuenta" });
    expect(within(accountSection).getByText("ana@example.test")).toBeInTheDocument();
    expect(within(accountSection).queryByDisplayValue("ana@example.test")).toBeNull();

    const form = screen.getByRole("form", { name: "Datos de la cuenta" });
    expect(form).toHaveAttribute("novalidate");
    const name = within(form).getByLabelText("Nombre");
    expect(name).toHaveAttribute("autocomplete", "name");

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({
      data: account([actorProfile("tourism_company")], { name: "Ana María Torres" }),
    }));
    fireEvent.change(name, { target: { value: "  Ana María Torres  " } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar nombre" }));

    expect(await within(form).findByText("Guardamos el nombre de tu cuenta.")).toBeInTheDocument();
    expect(vi.mocked(browserMutation).mock.calls[0]?.[0]).toBe("/api/backend/v1/me");
    expect(vi.mocked(browserMutation).mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "PATCH" }));
    expect(mutationBody(0)).toStrictEqual({ name: "Ana María Torres" });
    // El encabezado del shell refleja el nombre confirmado por el backend.
    expect(screen.getByRole("banner")).toHaveTextContent("Ana María Torres");
  });

  it("muestra el 422 del nombre junto al campo", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Datos de la cuenta" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      name: ["El nombre no es válido."],
    }));
    fireEvent.change(within(form).getByLabelText("Nombre"), { target: { value: "Ana" } });
    fireEvent.click(within(form).getByRole("button", { name: "Guardar nombre" }));

    const name = within(form).getByLabelText("Nombre");
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")).toHaveTextContent("El nombre no es válido.");
  });

  it("cambiar email: 409 y 422 junto a cada campo, 429 general y 202 explica el enlace pendiente", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Cambiar email" });
    expect(form).toHaveAttribute("novalidate");
    const email = within(form).getByLabelText("Nuevo email");
    const password = within(form).getByLabelText("Contraseña actual");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("autocomplete", "current-password");

    // Sin datos no se envía nada.
    fireEvent.click(within(form).getByRole("button", { name: "Enviar enlace de confirmación" }));
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(browserMutation).not.toHaveBeenCalled();

    const submit = (value: string) => {
      fireEvent.change(email, { target: { value } });
      fireEvent.change(password, { target: { value: "Clave-segura-2026" } });
      fireEvent.click(within(form).getByRole("button", { name: "Enviar enlace de confirmación" }));
    };

    vi.mocked(browserMutation).mockResolvedValueOnce(problem(409, "email_conflict", "El email solicitado no está disponible."));
    submit("ocupado@example.test");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(password).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById(email.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Ese email no está disponible.");
    expect(mutationBody(0)).toStrictEqual({ email: "ocupado@example.test", password: "Clave-segura-2026" });

    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      password: ["La contraseña no es correcta."],
    }));
    submit("ana.nueva@example.test");
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(password.getAttribute("aria-describedby")).toContain("settings-email-password-error");
    expect(document.getElementById("settings-email-password-error")).toHaveTextContent("La contraseña no es correcta.");

    vi.mocked(browserMutation).mockResolvedValueOnce(problem(429, "too_many_requests", "Demasiados intentos."));
    submit("ana.nueva@example.test");
    expect(await within(form).findByRole("alert")).toHaveTextContent("Hiciste demasiados intentos seguidos.");

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: { accepted: true } }, 202));
    submit(" ana.nueva@example.test ");
    expect(await within(form).findByText(
      "Te enviamos un enlace a ana.nueva@example.test para confirmar el cambio. Hasta entonces seguís usando ana@example.test.",
    )).toHaveAttribute("role", "status");
    expect(vi.mocked(browserMutation).mock.calls[3]?.[0]).toBe("/api/backend/v1/me/change-email");
    expect(mutationBody(3)).toStrictEqual({ email: "ana.nueva@example.test", password: "Clave-segura-2026" });
    expect(password).toHaveValue("");
    // El email actual no cambia hasta confirmar el enlace.
    expect(screen.getByRole("region", { name: "Datos de la cuenta" })).toHaveTextContent("ana@example.test");
  });

  it("cambiar contraseña: valida largo y coincidencia en el cliente antes de enviar", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Cambiar contraseña" });
    expect(form).toHaveAttribute("novalidate");
    const current = within(form).getByLabelText("Contraseña actual");
    const next = within(form).getByLabelText("Nueva contraseña");
    const confirmation = within(form).getByLabelText("Repetí la nueva contraseña");
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(next).toHaveAttribute("autocomplete", "new-password");
    expect(confirmation).toHaveAttribute("autocomplete", "new-password");

    fireEvent.change(current, { target: { value: "Clave-segura-2026" } });
    fireEvent.change(next, { target: { value: "corta" } });
    fireEvent.change(confirmation, { target: { value: "otra" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cambiar contraseña" }));

    await waitFor(() => expect(next).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("settings-new-password-error")).toHaveTextContent("entre 12 y 128 caracteres");
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("settings-new-password-confirmation-error")).toHaveTextContent("La confirmación no coincide");
    expect(current).not.toHaveAttribute("aria-invalid");
    expect(next).toHaveFocus();
    expect(browserMutation).not.toHaveBeenCalled();

    fireEvent.change(next, { target: { value: "Otra-clave-2026" } });
    fireEvent.change(confirmation, { target: { value: "Otra-clave-2027" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cambiar contraseña" }));
    await waitFor(() => expect(next).not.toHaveAttribute("aria-invalid"));
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(browserMutation).not.toHaveBeenCalled();
  });

  it("cambiar contraseña: el 422 de la contraseña actual se muestra junto a ese campo", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Cambiar contraseña" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      current_password: ["La contraseña actual no es correcta."],
    }));
    fireEvent.change(within(form).getByLabelText("Contraseña actual"), { target: { value: "Equivocada-2026" } });
    fireEvent.change(within(form).getByLabelText("Nueva contraseña"), { target: { value: "Otra-clave-2026" } });
    fireEvent.change(within(form).getByLabelText("Repetí la nueva contraseña"), { target: { value: "Otra-clave-2026" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cambiar contraseña" }));

    const current = within(form).getByLabelText("Contraseña actual");
    await waitFor(() => expect(current).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("settings-current-password-error")).toHaveTextContent("La contraseña actual no es correcta.");
    expect(within(form).queryByRole("alert")).toBeNull();
    expect(browserMutation).toHaveBeenCalledTimes(1);
  });

  it("cambiar contraseña: el 200 explica el cierre de sesiones, cierra por el BFF y redirige al login", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Cambiar contraseña" });
    location = stubLocation();
    const logout = deferred<Response>();
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: { message: "Contraseña actualizada." } }))
      .mockReturnValueOnce(logout.promise);

    fireEvent.change(within(form).getByLabelText("Contraseña actual"), { target: { value: "Clave-segura-2026" } });
    fireEvent.change(within(form).getByLabelText("Nueva contraseña"), { target: { value: "Otra-clave-2026" } });
    fireEvent.change(within(form).getByLabelText("Repetí la nueva contraseña"), { target: { value: "Otra-clave-2026" } });
    fireEvent.click(within(form).getByRole("button", { name: "Cambiar contraseña" }));

    expect(await within(form).findByText(/Por seguridad cerramos todas tus sesiones, incluida esta/)).toHaveAttribute("role", "status");
    expect(vi.mocked(browserMutation).mock.calls[0]?.[0]).toBe("/api/backend/v1/me/change-password");
    expect(mutationBody(0)).toStrictEqual({
      current_password: "Clave-segura-2026",
      new_password: "Otra-clave-2026",
      new_password_confirmation: "Otra-clave-2026",
    });
    await waitFor(() => expect(browserMutation).toHaveBeenNthCalledWith(2, "/api/auth/logout"));
    expect(within(form).getByRole("button", { name: "Cambiar contraseña" })).toBeDisabled();

    // La sesión remota ya está revocada: el BFF responde 401 pero igual borra las cookies.
    logout.resolve(problem(401, "unauthenticated", "Sesión revocada."));
    await waitFor(() => expect(location?.replaced).toEqual(["/?auth=login"]));
  });

  it("reutiliza las preferencias de correo de la cuenta", async () => {
    await renderSettings();
    const form = screen.getByRole("form", { name: "Preferencias de correo" });
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: account([actorProfile("tourism_company")]) }));
    fireEvent.click(within(form).getByLabelText("Cuando recibís una solicitud de contacto"));
    fireEvent.click(within(form).getByRole("button", { name: "Guardar preferencias" }));

    expect(await within(form).findByText("Preferencias guardadas.")).toBeInTheDocument();
    expect(vi.mocked(browserMutation).mock.calls[0]?.[0]).toBe("/api/backend/v1/me");
    expect(mutationBody(0)).toEqual({
      notification_preferences: expect.arrayContaining([{ event_type: "contact_request_received", email_enabled: false }]),
    });
  });
});

describe("T21 — suspensión en vigor (P27)", () => {
  it("access.changed con la cuenta suspendida re-consulta /me y restringe sin recargar", async () => {
    const backend = await renderDashboard(actorProfile("guide"), (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, GUIDE_METRICS))));
    await waitFor(() => metric("pending_contact_requests"));
    location = stubLocation();
    expect(backend.meCalls()).toBe(1);

    backend.state.user = { status: "suspended" };
    backend.state.access[GUIDE_ID] = SUSPENDED_ACCOUNT_ACCESS;
    await emit(GUIDE_ID, "access.changed", { profile_id: GUIDE_ID });
    const client = fakePusher.latest();

    expect(await screen.findByRole("heading", { level: 1, name: "Tu navegación está restringida" })).toBeInTheDocument();
    expect(backend.meCalls()).toBe(2);
    expect(document.querySelector("[data-metric]")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Navegación del perfil" })).toBeNull();
    expect(screen.queryByLabelText("Perfil activo")).toBeNull();
    expect(screen.queryByText("Guía Austral")).toBeNull();
    expect(screen.getByRole("link", { name: "Contactar soporte" })).toHaveAttribute("href", "/#contacto");
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
    // Sin recarga ni redirect; el socket se cierra con la cuenta suspendida.
    expect(location.replaced).toEqual([]);
    await waitFor(() => expect(client.disconnected).toBe(true));
  });

  it("un 403 account_suspended de cualquier consulta también restringe la navegación", async () => {
    window.history.replaceState({}, "", `/app?profile=${COMPANY_ID}`);
    const backend = mockBackend([actorProfile("tourism_company")], () => {
      // La suspensión ocurrió entre la carga de /me y la consulta del tablero.
      backend.state.user = { status: "suspended" };
      return Promise.resolve(problem(403, "account_suspended", "La cuenta está suspendida."));
    });
    render(<PrivateApp />);

    expect(await screen.findByRole("heading", { level: 1, name: "Tu navegación está restringida" })).toBeInTheDocument();
    expect(backend.meCalls()).toBe(2);
    expect(screen.queryByRole("complementary", { name: "Navegación del perfil" })).toBeNull();
  });

  it("con el perfil suspendido el menú solo ofrece Perfil, Acceso, Ajustes y Notificaciones y no monta vistas operativas", async () => {
    window.history.replaceState({}, "", `/app/requests?profile=${COMPANY_ID}`);
    const backend = mockBackend([actorProfile("tourism_company")], (profileId) => Promise.resolve(jsonResponse(dashboardBody(profileId, COMPANY_METRICS))));
    backend.state.access[COMPANY_ID] = SUSPENDED_PROFILE_ACCESS;
    render(<PrivateApp view="requests" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Esta sección no está disponible" })).toBeInTheDocument();
    const nav = screen.getByRole("complementary", { name: "Navegación del perfil" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent?.trim()))
      .toEqual(["Resumen", "Perfil", "Acceso", "Ajustes", "Notificaciones"]);
    expect(screen.getByRole("link", { name: "Ver estado de acceso" })).toHaveAttribute("href", `/app/access?profile=${COMPANY_ID}`);
    expect(screen.getByRole("link", { name: "Contactar soporte" })).toHaveAttribute("href", "/#contacto");
    expect(backend.calls.some((url) => url.includes("/contact-requests"))).toBe(false);
    expect(navigationFor("guide", access(GUIDE_ID, SUSPENDED_PROFILE_ACCESS)).map((item) => item.label))
      .toEqual(["Perfil", "Acceso", "Ajustes", "Notificaciones"]);
  });
});
