import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import {
  type AccessEvaluation,
  type City,
  type ContactQuota,
  type ContactRequest,
  type CurrentAccount,
  type DirectoryProfile,
  IDEMPOTENCY_KEY_PATTERN,
  type Profile,
  type ProfileCategory,
  type SafeProfile,
} from "@/features/app/api";
import { browserMutation } from "@/lib/browser/auth";

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
const REQUEST_B = "01ARZ3NDEKTSV4RRFFQ69G5FC2";
const NOW = new Date("2026-11-10T15:00:00Z");

/** Contacto de fixtures: nunca debe llegar al DOM antes del click en una aceptada. */
const LEAKED_EMAIL = "filtrado-contacto@example.test";
const LEAKED_PHONE = "+5492901999999";
const OWN_EMAIL = "propio@example.test";
const OWN_PHONE = "+5492901000000";
const COMPANY_CONTACT_EMAIL = "empresa-contacto@example.test";
const COMPANY_CONTACT_PHONE = "+5492901111111";
const GUIDE_CONTACT_EMAIL = "guia-contacto@example.test";
const GUIDE_CONTACT_PHONE = "+5492901222222";

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };
const rioGrande: City = { id: 2, name: "Río Grande", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

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
    contact_email: OWN_EMAIL,
    phone: OWN_PHONE,
    avatar: null,
    gallery: [],
    verified: false,
  };
  switch (category) {
    case "tourism_company":
      return { ...common, category, company: { legal_name: "Turismo Austral SA", years_active: 8 } };
    case "guide":
      return { ...common, category, guide: { education_summary: null }, qualifications: [] };
    case "driver":
      return { ...common, category, driver: { license_type: null, vehicle_type: null, vehicle_capacity: null } };
    case "instructor":
      return { ...common, category, instructor: { training_summary: null }, specialties: [], qualifications: [] };
    case "transport_company":
      return { ...common, category, transport_company: { legal_name: "Traslados SA", fleet_description: null }, fleet_vehicles: [] };
  }
}

function access(
  category: ProfileCategory,
  options: Readonly<{ state?: "active" | "expired"; quota?: ContactQuota | null; canSend?: boolean }> = {},
): AccessEvaluation {
  const active = (options.state ?? "active") === "active";
  const sender = category === "tourism_company";
  return {
    profile_id: category === "tourism_company" ? COMPANY_ID : GUIDE_ID,
    effective_state: active ? "active" : "expired",
    allowed: active,
    denial_code: active ? null : "subscription_expired",
    grant: null,
    capabilities: {
      can_search: active,
      can_send_contact_requests: options.canSend ?? (active && sender),
      can_publish_availability: active && !sender,
      can_receive_contact_requests: active && !sender,
      can_use_gallery: active,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: options.quota ?? null,
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
      capabilities: access(value.category).capabilities,
    }],
    notification_preferences: [],
  };
}

function guideSafe(): SafeProfile {
  return {
    id: GUIDE_ID,
    category: "guide",
    display_name: "Guía Austral",
    description: "Guía de montaña en Tierra del Fuego.",
    primary_city: ushuaia,
    cities: [ushuaia, rioGrande],
    languages: [{ id: 1, code: "es", name: "Español" }],
    services: [{ id: 1, code: "guiado", name: "Guiado" }],
    avatar: null,
    gallery: [],
    verified: true,
    category_details: { education_summary: "Tecnicatura en guía de turismo" },
  };
}

function companySafe(): SafeProfile {
  return {
    id: COMPANY_ID,
    category: "tourism_company",
    display_name: "Turismo Austral",
    description: "Excursiones en el fin del mundo.",
    primary_city: ushuaia,
    cities: [ushuaia],
    languages: [],
    services: [],
    avatar: null,
    gallery: [],
    verified: false,
    category_details: { legal_name: "Turismo Austral SA", years_active: 8 },
  };
}

function contactRequest(overrides: Partial<ContactRequest> = {}): ContactRequest {
  // El backend no envía contacto en el snapshot; se simula una fuga para probar la whitelist.
  const leakySender = { ...companySafe(), contact_email: LEAKED_EMAIL, phone: LEAKED_PHONE };
  const leakyRecipient = { ...guideSafe(), contact_email: LEAKED_EMAIL, phone: LEAKED_PHONE };
  return {
    id: REQUEST_ID,
    sender: leakySender,
    recipient: leakyRecipient,
    service_description: "Guía bilingüe para trekking al Glaciar Martial con un grupo de 8 personas.",
    requested_from: "2026-11-20",
    requested_to: "2026-11-22",
    requested_city: ushuaia,
    status: "pending",
    availability_status: "available",
    expires_at: "2026-11-17T15:00:00Z",
    responded_at: null,
    cancelled_at: null,
    created_at: "2026-11-10T15:00:00Z",
    ...overrides,
  };
}

const CONTACTS_FOR_COMPANY = {
  data: {
    contact_request_id: REQUEST_ID,
    actor: { profile_id: COMPANY_ID, display_name: "Turismo Austral", contact_email: COMPANY_CONTACT_EMAIL, phone: COMPANY_CONTACT_PHONE },
    counterpart: { profile_id: GUIDE_ID, display_name: "Guía Austral", contact_email: GUIDE_CONTACT_EMAIL, phone: GUIDE_CONTACT_PHONE },
  },
};

function directoryData(): DirectoryProfile {
  return {
    profile: guideSafe(),
    document_statuses: [],
    qualifications: [],
    fleet_vehicles: [],
    specialties: [],
    visible_references: [],
  };
}

const catalogs = {
  data: { categories: [], cities: [ushuaia, rioGrande], services: [], languages: [], specialties: [], document_types: [] },
  meta: { next_cursor: null, per_page: 50 },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status);
}

function listPage(items: ContactRequest[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20 } };
}

type Handler = (url: string) => Promise<Response>;
type Handlers = Partial<Record<"list" | "detail" | "contact" | "directory" | "availability", Handler>>;
type Backend = { calls: string[]; fetchMock: MockInstance<typeof fetch> };

function requestsBase(actorId: string): string {
  return `/api/backend/v1/profiles/${actorId}/contact-requests`;
}

function mockBackend(actor: Profile, handlers: Handlers = {}, evaluation: AccessEvaluation = access(actor.category)): Backend {
  const calls: string[] = [];
  const base = requestsBase(actor.id);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(actor) }));
    if (url.includes("/catalogs")) return Promise.resolve(jsonResponse(catalogs));
    if (url.endsWith(`${actor.id}/access`)) return Promise.resolve(jsonResponse({ data: evaluation }));
    if (url.startsWith(base)) {
      const rest = url.slice(base.length);
      const handler = /^\/[0-9A-Z]{26}\/contact$/.test(rest)
        ? handlers.contact
        : /^\/[0-9A-Z]{26}$/.test(rest)
          ? handlers.detail
          : rest === "" || rest.startsWith("?")
            ? handlers.list
            : undefined;
      if (!handler) throw new Error(`Unexpected contact-requests GET ${url}`);
      return handler(url);
    }
    if (/\/directory\/[0-9A-Z]{26}\/availability\?/.test(url)) {
      return handlers.availability
        ? handlers.availability(url)
        : Promise.resolve(jsonResponse({ data: { profile_id: GUIDE_ID, version: 1, available_days: [] } }));
    }
    if (/\/directory\/[0-9A-Z]{26}$/.test(url)) {
      if (!handlers.directory) throw new Error(`Unexpected directory ${url}`);
      return handlers.directory(url);
    }
    if (url.endsWith(`/profiles/${actor.id}`)) return Promise.resolve(jsonResponse({ data: actor }));
    throw new Error(`Unexpected GET ${url}`);
  });
  return { calls, fetchMock };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mutationCalls(): Array<Readonly<{ url: string; init: RequestInit }>> {
  return vi.mocked(browserMutation).mock.calls.map(([url, init]) => ({ url: String(url), init: init ?? {} }));
}

function keyOf(call: Readonly<{ init: RequestInit }>): string | null {
  return new Headers(call.init.headers).get("Idempotency-Key");
}

function contactCalls(backend: Backend): string[] {
  return backend.calls.filter((url) => url.endsWith("/contact"));
}

function expectNoContactInDom(): void {
  const html = document.body.innerHTML;
  for (const value of [
    "@",
    LEAKED_EMAIL,
    LEAKED_PHONE,
    "2901999999",
    OWN_EMAIL,
    OWN_PHONE,
    COMPANY_CONTACT_EMAIL,
    COMPANY_CONTACT_PHONE,
    GUIDE_CONTACT_EMAIL,
    GUIDE_CONTACT_PHONE,
    "2901222222",
  ]) {
    expect(html).not.toContain(value);
  }
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
});

describe("T18 — menú", () => {
  it("habilita Solicitudes para la empresa y para todas las categorías receptoras", async () => {
    for (const category of ["tourism_company", "guide", "driver", "instructor", "transport_company"] as const) {
      expect(navigationFor(category).find((item) => item.label === "Solicitudes"))
        .toEqual({ label: "Solicitudes", href: "/app/requests" });
    }

    window.history.replaceState({}, "", "/app");
    mockBackend(actorProfile("guide"));
    render(<PrivateApp />);
    await screen.findByRole("heading", { level: 1, name: "Guía Austral" });
    const link = screen.getByRole("link", { name: "Solicitudes" });
    expect(link).toHaveAttribute("href", `/app/requests?profile=${GUIDE_ID}`);
    expect(link).not.toHaveAttribute("aria-disabled");
  });
});

async function renderDirectory(actor: Profile, evaluation: AccessEvaluation = access(actor.category)): Promise<Backend> {
  window.history.replaceState({}, "", `/app/profiles/${GUIDE_ID}?profile=${actor.id}`);
  const backend = mockBackend(actor, { directory: () => Promise.resolve(jsonResponse({ data: directoryData() })) }, evaluation);
  render(<PrivateApp view="directory" targetProfileId={GUIDE_ID} />);
  await screen.findByRole("heading", { level: 1, name: "Guía Austral" });
  return backend;
}

function fillDescription(value: string): void {
  fireEvent.change(screen.getByLabelText("Servicio solicitado"), { target: { value } });
}

function submitRequest(): void {
  fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
}

describe("T18 — envío desde la ficha", () => {
  it("muestra el formulario solo a la empresa con capacidad y nunca a un receptor", async () => {
    const quota: ContactQuota = { month_start: "2026-11-01", used: 2, limit: 5, remaining: 3 };
    const backend = await renderDirectory(actorProfile("tourism_company"), access("tourism_company", { quota }));
    const form = screen.getByRole("form", { name: "Solicitud de contacto" });
    expect(within(form).getByLabelText("Servicio solicitado")).toBeRequired();
    expect(within(form).getByLabelText("Desde (opcional)")).toHaveAttribute("min", "2026-11-10");
    const city = within(form).getByLabelText("Ciudad (opcional)");
    expect(within(city).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Sin ciudad indicada", "Ushuaia", "Río Grande"]);
    expect(form).toHaveTextContent("Te quedan 3 solicitudes este mes.");
    expect(backend.calls.some((url) => url.includes("contact-requests"))).toBe(false);
    expect(browserMutation).not.toHaveBeenCalled();

    cleanup();
    backend.fetchMock.mockRestore();
    await renderDirectory(actorProfile("guide"));
    expect(screen.queryByRole("form", { name: "Solicitud de contacto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar solicitud" })).toBeNull();
    expect(screen.getByText(/Las solicitudes de contacto las inician las empresas turísticas/)).toBeInTheDocument();
  });

  it("con el cupo mensual agotado explica el uso del mes y no muestra el formulario", async () => {
    const quota: ContactQuota = { month_start: "2026-11-01", used: 5, limit: 5, remaining: 0 };
    await renderDirectory(actorProfile("tourism_company"), access("tourism_company", { quota, canSend: false }));

    expect(screen.getByRole("heading", { name: "Alcanzaste el límite mensual de solicitudes" })).toBeInTheDocument();
    expect(screen.getByText(/Usaste 5 de 5 solicitudes de contacto del mes iniciado el 01\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver estado de acceso" })).toHaveAttribute("href", `/app/access?profile=${COMPANY_ID}`);
    expect(screen.queryByRole("form", { name: "Solicitud de contacto" })).toBeNull();
  });

  it("envía el body exacto con una Idempotency-Key válida y enlaza al detalle", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: contactRequest() }, 201, { "idempotency-replayed": "false" }));

    fillDescription("  Guía bilingüe para trekking  ");
    fireEvent.change(screen.getByLabelText("Desde (opcional)"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Hasta (opcional)"), { target: { value: "2026-11-22" } });
    fireEvent.change(screen.getByLabelText("Ciudad (opcional)"), { target: { value: "2" } });
    submitRequest();

    const link = await screen.findByRole("link", { name: "Ver solicitud" });
    expect(link).toHaveAttribute("href", `/app/requests/${REQUEST_ID}?profile=${COMPANY_ID}`);
    expect(screen.getByRole("heading", { name: "Solicitud enviada a Guía Austral" })).toBeInTheDocument();
    expect(screen.getByText(/hasta el 17\/11\/2026 a las 12:00 \(hora de Argentina\)/)).toBeInTheDocument();

    const [call] = mutationCalls();
    expect(call?.url).toBe(requestsBase(COMPANY_ID));
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      target_profile_id: GUIDE_ID,
      service_description: "Guía bilingüe para trekking",
      requested_from: "2026-11-20",
      requested_to: "2026-11-22",
      requested_city_id: 2,
    });
    const key = call ? keyOf(call) : null;
    expect(key).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(new Headers(call?.init.headers).get("content-type")).toBe("application/json");
    expectNoContactInDom();
  });

  it("sin datos opcionales envía solo destino y servicio; sin descripción no envía", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    submitRequest();
    expect(await screen.findByText("Describí el servicio que necesitás.")).toBeInTheDocument();
    expect(screen.getByLabelText("Servicio solicitado")).toHaveAttribute("aria-invalid", "true");
    expect(browserMutation).not.toHaveBeenCalled();

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({ data: contactRequest({ requested_from: null, requested_to: null, requested_city: null }) }, 201));
    fillDescription("Traslado al aeropuerto");
    submitRequest();
    await screen.findByRole("link", { name: "Ver solicitud" });
    expect(JSON.parse(String(mutationCalls()[0]?.init.body))).toEqual({
      target_profile_id: GUIDE_ID,
      service_description: "Traslado al aeropuerto",
    });
  });

  it("un reintento tras error de red reutiliza la misma key y el backend reproduce la solicitud", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse({ data: contactRequest() }, 201, { "idempotency-replayed": "true" }));

    fillDescription("Guía bilingüe para trekking");
    submitRequest();
    expect(await screen.findByText(/problema de conexión/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Solicitud de contacto" })).toBeInTheDocument();

    submitRequest();
    expect(await screen.findByText(/es la misma solicitud, no se duplicó/)).toBeInTheDocument();
    const [first, second] = mutationCalls();
    expect(first && keyOf(first)).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(second && keyOf(second)).toBe(first && keyOf(first));
  });

  it("cambiar el contenido después de un error genera una key nueva", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    fillDescription("Guía bilingüe para trekking");
    submitRequest();
    await screen.findByText(/problema de conexión/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar solicitud" })).toBeEnabled());
    submitRequest();
    await waitFor(() => expect(mutationCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enviar solicitud" })).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Ciudad (opcional)"), { target: { value: "1" } });
    submitRequest();
    await waitFor(() => expect(mutationCalls()).toHaveLength(3));

    const keys = mutationCalls().map(keyOf);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[2]).toMatch(IDEMPOTENCY_KEY_PATTERN);
  });

  it.each([
    {
      name: "contact_request_pending",
      response: () => problem(409, "contact_request_pending", "Ya existe una solicitud pendiente para este perfil."),
      text: /Ya tenés una solicitud pendiente con este perfil/,
      requestsLink: true,
    },
    {
      name: "contact_request_already_accepted",
      response: () => problem(409, "contact_request_already_accepted", "Ya hay una solicitud aceptada."),
      text: /Este perfil ya aceptó una solicitud tuya/,
      requestsLink: true,
    },
    {
      name: "contact_request_cooldown con fecha en hora de Argentina",
      response: () => problem(409, "contact_request_cooldown", "Todavía no podés reenviar.", { retry_after: ["2026-11-17T18:30:00Z"] }),
      text: /Vas a poder enviar otra desde el 17\/11\/2026 a las 15:30 \(hora de Argentina\)/,
      requestsLink: false,
    },
    {
      name: "capability_not_available",
      response: () => problem(403, "capability_not_available", "La categoría no envía."),
      text: /Tu categoría de perfil no envía solicitudes de contacto/,
      requestsLink: false,
    },
    {
      name: "subscription_expired",
      response: () => problem(403, "subscription_expired", "Acceso vencido."),
      text: /La habilitación de tu perfil venció/,
      requestsLink: false,
    },
  ])("explica $name con mensaje propio", async ({ response, text, requestsLink }) => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation).mockResolvedValueOnce(response());
    fillDescription("Guía bilingüe para trekking");
    submitRequest();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    if (requestsLink) {
      expect(within(alert).getByRole("link", { name: "Ver mis solicitudes" })).toHaveAttribute("href", `/app/requests?profile=${COMPANY_ID}`);
    } else {
      expect(within(alert).queryByRole("link", { name: "Ver mis solicitudes" })).toBeNull();
    }
  });

  it("capability_limit_reached en el POST reemplaza el formulario por la explicación del cupo", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(403, "capability_limit_reached", "Se alcanzó el límite de la capacidad solicitada.", {
      capability: ["can_send_contact_requests"],
      limit: ["5"],
    }));
    fillDescription("Guía bilingüe para trekking");
    submitRequest();

    expect(await screen.findByRole("heading", { name: "Alcanzaste el límite mensual de solicitudes" })).toBeInTheDocument();
    expect(screen.getByText(/Tu habilitación permite 5 solicitudes de contacto por mes/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Solicitud de contacto" })).toBeNull();
  });

  it("idempotency_conflict se explica y el próximo envío usa una key nueva", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(problem(409, "idempotency_conflict", "La key ya se usó con otro contenido."))
      .mockResolvedValueOnce(jsonResponse({ data: contactRequest() }, 201));
    fillDescription("Guía bilingüe para trekking");
    submitRequest();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Este intento de envío ya se había usado con otros datos/);
    submitRequest();
    await screen.findByRole("link", { name: "Ver solicitud" });
    const [first, second] = mutationCalls().map(keyOf);
    expect(second).toMatch(IDEMPOTENCY_KEY_PATTERN);
    expect(second).not.toBe(first);
  });

  it("422 muestra el error junto al campo correspondiente", async () => {
    await renderDirectory(actorProfile("tourism_company"));
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Los datos enviados no son válidos.", {
      requested_from: ["La fecha no puede ser anterior a hoy."],
    }));
    fillDescription("Guía bilingüe para trekking");
    fireEvent.change(screen.getByLabelText("Desde (opcional)"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Hasta (opcional)"), { target: { value: "2026-11-21" } });
    submitRequest();

    const message = await screen.findByText("La fecha no puede ser anterior a hoy.");
    const from = screen.getByLabelText("Desde (opcional)");
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(from.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.getByLabelText("Hasta (opcional)")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Servicio solicitado")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Revisá los datos marcados en el formulario.");
  });
});

async function renderList(actor: Profile, list: Handler): Promise<Backend> {
  window.history.replaceState({}, "", `/app/requests?profile=${actor.id}`);
  const backend = mockBackend(actor, { list });
  render(<PrivateApp view="requests" />);
  await screen.findByRole("heading", { level: 1, name: "Solicitudes" });
  return backend;
}

function listCalls(backend: Backend, actorId: string): string[] {
  const base = requestsBase(actorId);
  return backend.calls.filter((url) => url.startsWith(`${base}?`) || url === base);
}

describe("T18 — bandeja", () => {
  it("la empresa ve solo Enviadas, con contraparte, servicio, fechas, estado en texto y vencimiento", async () => {
    const backend = await renderList(actorProfile("tourism_company"), () => Promise.resolve(jsonResponse(listPage([contactRequest()]))));

    const tabs = within(screen.getByRole("tablist", { name: "Bandejas de solicitudes" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Enviadas"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    const row = await screen.findByRole("article", { name: "Guía Austral" });
    expect(row).toHaveTextContent("Guía");
    expect(within(row).getByText("Verificado")).toBeInTheDocument();
    expect(row).toHaveTextContent("Guía bilingüe para trekking al Glaciar Martial");
    expect(row).toHaveTextContent("20/11/2026 al 22/11/2026");
    expect(row).toHaveTextContent("Estado: Pendiente");
    expect(row).toHaveTextContent("Vence el 17/11/2026 a las 12:00 (hora de Argentina)");
    expect(within(row).getByRole("link", { name: "Ver solicitud a Guía Austral" }))
      .toHaveAttribute("href", `/app/requests/${REQUEST_ID}?profile=${COMPANY_ID}`);
    expect(listCalls(backend, COMPANY_ID)).toEqual([`${requestsBase(COMPANY_ID)}?direction=sent`]);
    expect(contactCalls(backend)).toEqual([]);
    expectNoContactInDom();
  });

  it("un receptor ve solo Recibidas y las pendientes vencidas por reloj llegan como vencidas", async () => {
    const backend = await renderList(actorProfile("guide"), () => Promise.resolve(jsonResponse(listPage([
      contactRequest({ status: "expired" }),
    ]))));

    const tabs = within(screen.getByRole("tablist", { name: "Bandejas de solicitudes" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Recibidas"]);
    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    expect(row).toHaveTextContent("Empresa turística");
    expect(row).toHaveTextContent("Estado: Vencida");
    expect(row).not.toHaveTextContent("Vence el");
    expect(listCalls(backend, GUIDE_ID)).toEqual([`${requestsBase(GUIDE_ID)}?direction=received`]);
  });

  it("el filtro de estado va a la query y a la URL; Cargar más usa el cursor sin escribirlo en la URL", async () => {
    const base = requestsBase(COMPANY_ID);
    const backend = await renderList(actorProfile("tourism_company"), (url) => {
      if (url.includes("cursor=41")) {
        return Promise.resolve(jsonResponse(listPage([contactRequest({ id: REQUEST_B, status: "accepted", service_description: "Segunda página" })])));
      }
      if (url.includes("status=accepted")) {
        return Promise.resolve(jsonResponse(listPage([contactRequest({ status: "accepted", service_description: "Primera página" })], "41")));
      }
      return Promise.resolve(jsonResponse(listPage([])));
    });
    expect(await screen.findByRole("heading", { name: "Todavía no hay solicitudes enviadas" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "accepted" } });
    expect(await screen.findByText("Primera página")).toBeInTheDocument();
    expect(window.location.search).toBe(`?profile=${COMPANY_ID}&status=accepted`);
    expect(screen.getByText("1 solicitud cargada · hay más")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Segunda página")).toBeInTheDocument();
    expect(screen.getByText("Primera página")).toBeInTheDocument();
    expect(listCalls(backend, COMPANY_ID)).toEqual([
      `${base}?direction=sent`,
      `${base}?direction=sent&status=accepted`,
      `${base}?direction=sent&status=accepted&cursor=41`,
    ]);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(window.location.search).not.toContain("cursor");
  });

  it("descarta la respuesta tardía de un filtro anterior", async () => {
    const slow = deferred<Response>();
    await renderList(actorProfile("tourism_company"), (url) => url.includes("status=cancelled")
      ? Promise.resolve(jsonResponse(listPage([contactRequest({ status: "cancelled", service_description: "Filtro nuevo" })])))
      : slow.promise);

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "cancelled" } });
    expect(await screen.findByText("Filtro nuevo")).toBeInTheDocument();
    await act(async () => {
      slow.resolve(jsonResponse(listPage([contactRequest({ service_description: "Filtro viejo" })])));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("Filtro viejo")).toBeNull();
    expect(screen.getByText("Filtro nuevo")).toBeInTheDocument();
  });
});

async function renderDetail(
  actor: Profile,
  handlers: Handlers,
  evaluation: AccessEvaluation = access(actor.category),
): Promise<Backend> {
  window.history.replaceState({}, "", `/app/requests/${REQUEST_ID}?profile=${actor.id}`);
  const backend = mockBackend(actor, handlers, evaluation);
  render(<PrivateApp view="request" requestId={REQUEST_ID} />);
  await screen.findByRole("heading", { level: 1, name: /^Solicitud (a|de) / });
  return backend;
}

function detailCalls(backend: Backend, actorId: string): string[] {
  return backend.calls.filter((url) => url === `${requestsBase(actorId)}/${REQUEST_ID}`);
}

describe("T18 — detalle y decisiones", () => {
  it("el destino con pendiente ve Aceptar y Rechazar, el servicio completo y la ficha segura de la empresa", async () => {
    const backend = await renderDetail(actorProfile("guide"), { detail: () => Promise.resolve(jsonResponse({ data: contactRequest() })) });

    expect(screen.getByRole("heading", { level: 1, name: "Solicitud de Turismo Austral" })).toBeInTheDocument();
    expect(screen.getByText("Estado: Pendiente")).toBeInTheDocument();
    const service = screen.getByRole("region", { name: "Servicio solicitado" });
    expect(service).toHaveTextContent("Guía bilingüe para trekking al Glaciar Martial con un grupo de 8 personas.");
    expect(service).toHaveTextContent("20/11/2026 al 22/11/2026");
    expect(service).toHaveTextContent("Ushuaia");
    expect(service).toHaveTextContent("Es un dato informativo: no es una reserva.");

    const company = screen.getByRole("region", { name: "Empresa solicitante" });
    expect(company).toHaveTextContent("Turismo Austral");
    expect(company).toHaveTextContent("Excursiones en el fin del mundo.");
    expect(within(company).queryByRole("link")).toBeNull();

    const history = screen.getByRole("region", { name: "Historial" });
    expect(history).toHaveTextContent("Enviada10/11/2026 a las 12:00 (hora de Argentina)");
    expect(history).toHaveTextContent("Vence17/11/2026 a las 12:00 (hora de Argentina)");

    expect(screen.getByRole("button", { name: "Aceptar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar solicitud" })).toBeNull();
    expect(screen.getByText(/No reserva tu calendario ni confirma una contratación/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver datos de contacto" })).toBeNull();
    expect(contactCalls(backend)).toEqual([]);
    expectNoContactInDom();
  });

  it("el emisor con pendiente ve solo Cancelar y un enlace a la ficha del perfil", async () => {
    await renderDetail(actorProfile("tourism_company"), { detail: () => Promise.resolve(jsonResponse({ data: contactRequest() })) });

    expect(screen.getByRole("heading", { level: 1, name: "Solicitud a Guía Austral" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar solicitud" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Perfil solicitado" })).getByRole("link", { name: "Ver ficha completa" }))
      .toHaveAttribute("href", `/app/profiles/${GUIDE_ID}?profile=${COMPANY_ID}`);
  });

  it("con acceso vencido el destino puede rechazar pero no aceptar (D21)", async () => {
    await renderDetail(
      actorProfile("guide"),
      { detail: () => Promise.resolve(jsonResponse({ data: contactRequest() })) },
      access("guide", { state: "expired" }),
    );
    expect(screen.queryByRole("button", { name: "Aceptar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeInTheDocument();
    expect(screen.getByText(/no podés aceptar solicitudes, pero sí rechazarlas/)).toBeInTheDocument();
  });

  it("nadie ve acciones en estados terminales", async () => {
    const terminal = [
      { status: "accepted", responded_at: "2026-11-11T13:00:00Z" },
      { status: "rejected", responded_at: "2026-11-11T13:00:00Z" },
      { status: "expired" },
      { status: "cancelled", cancelled_at: "2026-11-11T13:00:00Z" },
    ] as const;
    for (const category of ["guide", "tourism_company"] as const) {
      for (const overrides of terminal) {
        const backend = await renderDetail(actorProfile(category), { detail: () => Promise.resolve(jsonResponse({ data: contactRequest(overrides) })) });
        for (const name of ["Aceptar", "Rechazar", "Cancelar solicitud"]) {
          expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(screen.getByText(/^Estado: /)).toBeInTheDocument();
        cleanup();
        backend.fetchMock.mockRestore();
      }
    }
  });

  it("aceptar confirma en un diálogo, manda POST sin body, muestra el estado devuelto y separa el refresco fallido", async () => {
    let detailRequests = 0;
    const backend = await renderDetail(actorProfile("guide"), {
      detail: () => {
        detailRequests += 1;
        return Promise.resolve(detailRequests === 1
          ? jsonResponse({ data: contactRequest() })
          : problem(500, "backend_unavailable", "El servicio no está disponible temporalmente."));
      },
    });
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({
      data: contactRequest({ status: "accepted", responded_at: "2026-11-10T16:00:00Z" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    const dialog = screen.getByRole("dialog", { name: "¿Aceptar la solicitud?" });
    expect(dialog).toHaveAccessibleDescription(/no reserva tu calendario ni confirma una contratación/);
    expect(within(dialog).getByRole("button", { name: "Volver" })).toHaveFocus();
    expect(browserMutation).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Aceptar solicitud" }));
    expect(await screen.findByText(/Listo: la solicitud quedó aceptada\./)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Estado: Aceptada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar" })).toBeNull();

    const [call] = mutationCalls();
    expect(call?.url).toBe(`${requestsBase(GUIDE_ID)}/${REQUEST_ID}/accept`);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.body).toBeUndefined();
    expect(call?.init.headers).toBeUndefined();

    expect(await screen.findByText(/No pudimos actualizar el detalle/)).toBeInTheDocument();
    expect(screen.getByText(/Listo: la solicitud quedó aceptada\./)).toBeInTheDocument();
    expect(detailCalls(backend, GUIDE_ID)).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Historial" })).toHaveTextContent("Aceptada10/11/2026 a las 13:00");

    // Aceptada: el contacto queda disponible, pero solo bajo demanda.
    expect(screen.getByRole("button", { name: "Ver datos de contacto" })).toBeInTheDocument();
    expect(contactCalls(backend)).toEqual([]);
    expectNoContactInDom();
  });

  it("Escape cierra el diálogo sin mutar", async () => {
    await renderDetail(actorProfile("tourism_company"), { detail: () => Promise.resolve(jsonResponse({ data: contactRequest() })) });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
    const dialog = screen.getByRole("dialog", { name: "¿Cancelar la solicitud?" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(browserMutation).not.toHaveBeenCalled();
  });

  it("contact_request_not_pending tras una carrera se explica y refresca al estado vigente", async () => {
    let detailRequests = 0;
    await renderDetail(actorProfile("guide"), {
      detail: () => {
        detailRequests += 1;
        return Promise.resolve(jsonResponse({ data: contactRequest(detailRequests === 1 ? {} : { status: "expired" }) }));
      },
    });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(409, "contact_request_not_pending", "La solicitud ya no está pendiente."));

    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rechazar solicitud" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/La solicitud ya no está pendiente: otra acción o su vencimiento cambiaron el estado/);
    expect(await screen.findByText("Estado: Vencida")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rechazar" })).toBeNull();
    expect(mutationCalls()[0]?.url).toBe(`${requestsBase(GUIDE_ID)}/${REQUEST_ID}/reject`);
  });
});

describe("T18 — contacto posterior al match", () => {
  const accepted = () => contactRequest({ status: "accepted", responded_at: "2026-11-11T13:00:00Z" });

  it("no se pide al montar y solo aparece tras el click en una aceptada", async () => {
    const backend = await renderDetail(actorProfile("tourism_company"), {
      detail: () => Promise.resolve(jsonResponse({ data: accepted() })),
      contact: () => Promise.resolve(jsonResponse(CONTACTS_FOR_COMPANY)),
    });

    expect(contactCalls(backend)).toEqual([]);
    expectNoContactInDom();

    fireEvent.click(screen.getByRole("button", { name: "Ver datos de contacto" }));
    const counterpart = await screen.findByRole("article", { name: "Guía Austral" });
    expect(within(counterpart).getByRole("link", { name: GUIDE_CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${GUIDE_CONTACT_EMAIL}`);
    expect(within(counterpart).getByRole("link", { name: GUIDE_CONTACT_PHONE })).toHaveAttribute("href", `tel:${GUIDE_CONTACT_PHONE}`);
    const own = screen.getByRole("article", { name: "Tus datos declarados" });
    expect(own).toHaveTextContent(COMPANY_CONTACT_EMAIL);
    expect(own).toHaveTextContent(COMPANY_CONTACT_PHONE);
    expect(contactCalls(backend)).toEqual([`${requestsBase(COMPANY_ID)}/${REQUEST_ID}/contact`]);

    // No persiste fuera del componente: ni sessionStorage ni URL.
    const stored = Object.keys(window.sessionStorage).map((key) => window.sessionStorage.getItem(key) ?? "").join("|");
    expect(stored).not.toContain(GUIDE_CONTACT_EMAIL);
    expect(window.location.href).not.toContain("contact");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar datos de contacto" }));
    expect(document.body.innerHTML).not.toContain(GUIDE_CONTACT_EMAIL);
  });

  it("counterpart_access_unavailable se explica sin revelar el estado de la otra parte", async () => {
    await renderDetail(actorProfile("tourism_company"), {
      detail: () => Promise.resolve(jsonResponse({ data: accepted() })),
      contact: () => Promise.resolve(problem(403, "counterpart_access_unavailable", "La otra parte no tiene acceso vigente para concretar el contacto.")),
    });

    fireEvent.click(screen.getByRole("button", { name: "Ver datos de contacto" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/la otra parte no puede concretar el contacto/);
    expect(alert.textContent).not.toMatch(/venc|suspend|habilitaci|vigente/i);
    expectNoContactInDom();
  });

  it("un 403 del propio acceso explica el motivo propio y no muestra contacto", async () => {
    await renderDetail(actorProfile("tourism_company"), {
      detail: () => Promise.resolve(jsonResponse({ data: accepted() })),
      contact: () => Promise.resolve(problem(403, "subscription_expired", "Acceso vencido.")),
    });

    fireEvent.click(screen.getByRole("button", { name: "Ver datos de contacto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/La habilitación de tu perfil venció/);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expectNoContactInDom();
  });
});
