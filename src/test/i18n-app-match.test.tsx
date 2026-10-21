import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { PrivateApp } from "@/features/app/AppShell";
import type {
  AccessEvaluation,
  City,
  ContactRequest,
  CurrentAccount,
  DirectoryProfile,
  Profile,
  ProfileCategory,
  Reference,
  SafeProfile,
  SearchResult,
} from "@/features/app/api";
import { browserMutation } from "@/lib/browser/auth";

import { inLocale } from "./i18n";

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
const REF_A = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const NOW = new Date("2026-11-10T15:00:00Z");

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };
const rioGrande: City = { id: 2, name: "Río Grande", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

function actorProfile(category: "tourism_company" | "guide"): Profile {
  const common = {
    id: category === "tourism_company" ? COMPANY_ID : GUIDE_ID,
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
    phone: "+5492901000000",
    avatar: null,
    gallery: [],
    verified: false,
  };
  return category === "tourism_company"
    ? { ...common, category, company: { legal_name: "Turismo Austral SA", years_active: 8 } }
    : { ...common, category, guide: { education_summary: null }, qualifications: [] };
}

function access(category: ProfileCategory): AccessEvaluation {
  const sender = category === "tourism_company";
  return {
    profile_id: sender ? COMPANY_ID : GUIDE_ID,
    effective_state: "active",
    allowed: true,
    denial_code: null,
    grant: null,
    capabilities: {
      can_search: true,
      can_send_contact_requests: sender,
      can_publish_availability: !sender,
      can_receive_contact_requests: !sender,
      can_use_gallery: true,
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
      capabilities: access(value.category).capabilities,
    }],
    notification_preferences: [],
  };
}

function guideSafe(verified = true): SafeProfile {
  return {
    id: GUIDE_ID,
    category: "guide",
    display_name: "Guía Austral",
    description: "Guía de montaña en Tierra del Fuego.",
    primary_city: ushuaia,
    cities: [ushuaia, rioGrande],
    languages: [{ id: 1, code: "es", name: "Spanish" }],
    services: [{ id: 1, code: "guiado", name: "Guiding" }],
    avatar: null,
    gallery: [],
    verified,
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
  return {
    id: REQUEST_ID,
    sender: companySafe(),
    recipient: guideSafe(),
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

function reference(overrides: Partial<Reference> = {}): Reference {
  return {
    id: REF_A,
    contact_request_id: REQUEST_ID,
    author: companySafe(),
    subject: guideSafe(),
    body: "Coordinación impecable durante toda la excursión.",
    visibility: "hidden",
    moderated: false,
    moderation_reason: null,
    created_at: "2026-11-10T02:30:00Z",
    ...overrides,
  };
}

function directoryData(): DirectoryProfile {
  return {
    profile: guideSafe(),
    document_statuses: [
      { document_type: { code: "guide_license", label: "Guide licence" }, status: "approved", valid_until: "2027-12-31", is_currently_valid: true },
      { document_type: { code: "first_aid", label: "First aid" }, status: "missing", valid_until: null, is_currently_valid: false },
    ],
    qualifications: [],
    fleet_vehicles: [],
    specialties: [],
    visible_references: [],
  };
}

function availabilityBody(url: string) {
  const month = /month=(\d{4}-\d{2})/.exec(url)?.[1] ?? "2026-11";
  const days = month === "2026-11"
    ? [{ date: "2026-11-20", city: ushuaia }, { date: "2026-11-21", city: ushuaia }]
    : [];
  return { data: { profile_id: GUIDE_ID, version: 3, available_days: days } };
}

const catalogs = {
  data: { categories: [], cities: [ushuaia, rioGrande], services: [], languages: [], specialties: [], document_types: [] },
  meta: { next_cursor: null, per_page: 50 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function page<T>(items: T[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20, search_seed: "2026-11-10" } };
}

type Handler = (url: string) => Promise<Response>;
type Handlers = Partial<Record<"search" | "directory" | "requests" | "detail" | "references", Handler>>;

function mockBackend(actor: Profile, handlers: Handlers = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    const pick = (handler: Handler | undefined) => {
      if (!handler) throw new Error(`Unexpected GET ${url}`);
      return handler(url);
    };
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(actor) }));
    if (url.includes("/catalogs")) return Promise.resolve(jsonResponse(catalogs));
    if (url.endsWith(`${actor.id}/access`)) return Promise.resolve(jsonResponse({ data: access(actor.category) }));
    if (url.includes("/notifications")) return Promise.resolve(jsonResponse(page([])));
    if (url.includes(`/profiles/${actor.id}/search`)) return pick(handlers.search);
    if (url.includes(`/profiles/${actor.id}/references`)) return pick(handlers.references);
    if (/\/contact-requests\/[0-9A-Z]{26}$/.test(url)) return pick(handlers.detail);
    if (/\/contact-requests(\?|$)/.test(url)) return pick(handlers.requests);
    if (/\/directory\/[0-9A-Z]{26}\/availability\?/.test(url)) return Promise.resolve(jsonResponse(availabilityBody(url)));
    if (/\/directory\/[0-9A-Z]{26}$/.test(url)) return pick(handlers.directory);
    if (url.endsWith(`/profiles/${actor.id}`)) return Promise.resolve(jsonResponse({ data: actor }));
    throw new Error(`Unexpected GET ${url}`);
  });
}

function searchResult(status: SearchResult["availability_status"], matched: number, requested: number): SearchResult {
  return { safe_profile: guideSafe(), matched_days: matched, requested_days: requested, availability_status: status };
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

describe("i18n — búsqueda en inglés", () => {
  it("filtros, tarjeta de resultado y conteo", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${COMPANY_ID}&date_from=2026-11-20&date_to=2026-11-22&match_mode=any`);
    mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(jsonResponse(page([searchResult("partial", 2, 3)]))),
    });
    render(inLocale("en", <PrivateApp view="search" />));

    expect(await screen.findByRole("heading", { level: 1, name: "Search professionals" })).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Search filters" });
    expect(within(form).getByRole("radio", { name: "Every day in the range" })).toBeInTheDocument();
    expect(within(form).getByRole("radio", { name: "At least one day in the range" })).toBeChecked();
    expect(within(form).getByRole("button", { name: "Search profiles" })).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    expect(await within(form).findByRole("option", { name: "All cities" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: "Verified only" })).toBeInTheDocument();

    const card = await screen.findByRole("article", { name: "Guía Austral" });
    expect(card).toHaveTextContent("Partial availability: 2 of 3 days");
    expect(within(card).getByRole("link", { name: "View Guía Austral's profile" })).toBeInTheDocument();
    expect(screen.getByText("1 profile loaded")).toBeInTheDocument();
  });

  it("estado vacío y aviso para un perfil receptor", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${COMPANY_ID}`);
    mockBackend(actorProfile("tourism_company"), { search: () => Promise.resolve(jsonResponse(page([]))) });
    render(inLocale("en", <PrivateApp view="search" />));

    expect(await screen.findByRole("heading", { name: "No profiles match these filters" })).toBeInTheDocument();
    expect(screen.getByText("Try removing a filter or widening the date range.")).toBeInTheDocument();

    cleanup();
    window.history.replaceState({}, "", `/app/search?profile=${GUIDE_ID}`);
    vi.restoreAllMocks();
    mockBackend(actorProfile("guide"));
    render(inLocale("en", <PrivateApp view="search" />));
    expect(await screen.findByRole("heading", { level: 1, name: "Search is for tourism companies" })).toBeInTheDocument();
    expect(screen.getByText(/^Profiles in the guide category receive contact requests;/)).toBeInTheDocument();
  });
});

describe("i18n — ficha del directorio en inglés", () => {
  it("encabezado, documentos, resumen de disponibilidad y formulario de solicitud", async () => {
    window.history.replaceState({}, "", `/app/profiles/${GUIDE_ID}?profile=${COMPANY_ID}`);
    mockBackend(actorProfile("tourism_company"), { directory: () => Promise.resolve(jsonResponse({ data: directoryData() })) });
    render(inLocale("en", <PrivateApp view="directory" targetProfileId={GUIDE_ID} />));

    expect(await screen.findByRole("heading", { level: 1, name: "Guía Austral" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to search" })).toBeInTheDocument();
    expect(screen.getByText("Main city: Ushuaia")).toBeInTheDocument();

    const documents = screen.getByRole("region", { name: "Documents" });
    expect(documents).toHaveTextContent("valid until 31/12/2027");
    expect(documents).toHaveTextContent("Not added");
    expect(documents).toHaveTextContent("Only the review status is shown; the files are private.");
    expect(screen.getByText("No visible references yet.")).toBeInTheDocument();

    const calendar = screen.getByRole("region", { name: "Published availability" });
    expect(await within(calendar).findByText("2 days available in November 2026.")).toBeInTheDocument();
    expect(calendar.querySelector('li[data-date="2026-11-20"]')).toHaveTextContent("available in Ushuaia");
    expect(calendar.querySelector('li[data-date="2026-11-22"]')).toHaveTextContent("no published availability");
    expect(within(calendar).getByRole("button", { name: /^Next month: / })).toBeInTheDocument();

    const form = screen.getByRole("form", { name: "Contact request" });
    expect(within(form).getByLabelText("Requested service")).toBeInTheDocument();
    expect(within(form).getByLabelText("From (optional)")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Send request" })).toBeInTheDocument();
    expect(form).toHaveTextContent("They're context for the profile: they don't book their calendar.");

    // Validación del cliente en inglés.
    fireEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(await within(form).findByText("Describe the service you need.")).toBeInTheDocument();
    expect(browserMutation).not.toHaveBeenCalled();
  });
});

describe("i18n — solicitudes en inglés", () => {
  it("bandeja enviada: pestaña, estado, fechas y vencimiento con hora de Argentina", async () => {
    window.history.replaceState({}, "", `/app/requests?profile=${COMPANY_ID}`);
    mockBackend(actorProfile("tourism_company"), { requests: () => Promise.resolve(jsonResponse(page([contactRequest()]))) });
    render(inLocale("en", <PrivateApp view="requests" />));

    const tabs = within(await screen.findByRole("tablist", { name: "Request inboxes" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Sent"]);
    const row = await screen.findByRole("article", { name: "Guía Austral" });
    expect(row).toHaveTextContent("Status: Pending");
    expect(row).toHaveTextContent("20/11/2026 to 22/11/2026");
    expect(row).toHaveTextContent("Expires on 17/11/2026 at 12:00 (Argentina time)");
    expect(within(row).getByRole("link", { name: "View request to Guía Austral" })).toBeInTheDocument();
  });

  it("bandeja recibida vacía", async () => {
    window.history.replaceState({}, "", `/app/requests?profile=${GUIDE_ID}`);
    mockBackend(actorProfile("guide"), { requests: () => Promise.resolve(jsonResponse(page([]))) });
    render(inLocale("en", <PrivateApp view="requests" />));

    expect(await screen.findByRole("heading", { name: "No received requests yet" })).toBeInTheDocument();
    expect(screen.getByText("When a tourism company sends you a request, it will appear here.")).toBeInTheDocument();
  });

  it("detalle pendiente para el destino: aceptar/rechazar, historial y vencimiento", async () => {
    window.history.replaceState({}, "", `/app/requests/${REQUEST_ID}?profile=${GUIDE_ID}`);
    mockBackend(actorProfile("guide"), { detail: () => Promise.resolve(jsonResponse({ data: contactRequest() })) });
    render(inLocale("en", <PrivateApp view="request" requestId={REQUEST_ID} />));

    expect(await screen.findByRole("heading", { level: 1, name: "Request from Turismo Austral" })).toBeInTheDocument();
    expect(screen.getByText("Status: Pending")).toBeInTheDocument();
    const service = screen.getByRole("region", { name: "Requested service" });
    expect(service).toHaveTextContent("Requested dates");
    expect(service).toHaveTextContent("This is for information only: it isn't a booking.");
    expect(screen.getByText("Expires on 17/11/2026 at 12:00 (Argentina time). After that it can no longer be accepted."))
      .toBeInTheDocument();

    const history = screen.getByRole("region", { name: "History" });
    expect(history).toHaveTextContent("Sent10/11/2026 at 12:00 (Argentina time)");
    expect(history).toHaveTextContent("Expires17/11/2026 at 12:00 (Argentina time)");

    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Requesting company" })).toHaveTextContent("Turismo Austral");
  });
});

describe("i18n — referencias en inglés", () => {
  it("pestañas, fila recibida y estado vacío de las escritas", async () => {
    window.history.replaceState({}, "", `/app/references?profile=${GUIDE_ID}`);
    mockBackend(actorProfile("guide"), {
      references: (url) => Promise.resolve(jsonResponse(page(url.includes("direction=authored") ? [] : [reference()]))),
    });
    render(inLocale("en", <PrivateApp view="references" />));

    expect(await screen.findByRole("heading", { level: 1, name: "References" })).toBeInTheDocument();
    const tablist = screen.getByRole("tablist", { name: "References by direction" });
    expect(within(tablist).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Received", "Written by you"]);

    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    expect(row).toHaveTextContent("Written by");
    expect(row).toHaveTextContent("Tourism company");
    expect(row).toHaveTextContent("09/11/2026");
    expect(row).toHaveTextContent("Status: Hidden on your profile");
    expect(within(row).getByRole("button", { name: "Publish on my profile" })).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "View the related request with Turismo Austral" })).toBeInTheDocument();
    expect(screen.getByText("1 reference loaded")).toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole("tab", { name: "Written by you" }));
    expect(await screen.findByRole("heading", { name: "You haven't written any references yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View requests" })).toBeInTheDocument();
  });
});
