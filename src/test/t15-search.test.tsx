import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import type {
  AccessEvaluation,
  City,
  CurrentAccount,
  DirectoryProfile,
  Profile,
  ProfileCategory,
  SafeProfile,
  SearchResult,
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

const ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TARGET_A = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const TARGET_B = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const TARGET_C = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const SEARCH_PATH = `/api/backend/v1/profiles/${ACTOR_ID}/search`;
const NOW = new Date("2026-11-10T15:00:00Z");

/** Datos de contacto de fixtures: nunca deben llegar al DOM de la ficha. */
const LEAKED_EMAIL = "filtrado-contacto@example.test";
const LEAKED_PHONE = "+5492901999999";

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };
const rioGrande: City = { id: 2, name: "Río Grande", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

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
    contact_email: "propio@example.test",
    phone: "+5492901000000",
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

function access(category: ProfileCategory, active = true): AccessEvaluation {
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
      capabilities: access(value.category).capabilities,
    }],
    notification_preferences: [],
  };
}

function safeProfile(id: string, name: string, verified = false): SafeProfile {
  return {
    id,
    category: "guide",
    display_name: name,
    description: "Guía de montaña en Tierra del Fuego.",
    primary_city: ushuaia,
    cities: [ushuaia, rioGrande],
    languages: [{ id: 1, code: "es", name: "Español" }, { id: 2, code: "en", name: "Inglés" }],
    services: [{ id: 1, code: "guiado", name: "Guiado" }],
    avatar: null,
    gallery: [],
    verified,
    category_details: { education_summary: "Tecnicatura en guía de turismo" },
  };
}

function result(
  id: string,
  name: string,
  status: SearchResult["availability_status"] = "unspecified",
  matched = 0,
  requested = 0,
  verified = false,
): SearchResult {
  return { safe_profile: safeProfile(id, name, verified), matched_days: matched, requested_days: requested, availability_status: status };
}

function page(items: SearchResult[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20, search_seed: "2026-11-10" } };
}

const catalogs = {
  data: {
    categories: [],
    cities: [ushuaia, rioGrande],
    services: [],
    languages: [],
    specialties: [],
    document_types: [],
  },
  meta: { next_cursor: null, per_page: 50 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status);
}

type Handler = (url: string) => Promise<Response>;

type Backend = { calls: string[]; searchCalls: () => string[]; fetchMock: MockInstance<typeof fetch> };

function mockBackend(
  actor: Profile,
  handlers: Partial<Record<"search" | "directory" | "availability", Handler>> = {},
  evaluation: AccessEvaluation = access(actor.category),
): Backend {
  const calls: string[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(actor) }));
    if (url.includes("/catalogs")) return Promise.resolve(jsonResponse(catalogs));
    if (url.endsWith(`${ACTOR_ID}/access`)) return Promise.resolve(jsonResponse({ data: evaluation }));
    if (url.startsWith(SEARCH_PATH)) {
      if (!handlers.search) throw new Error(`Unexpected search ${url}`);
      return handlers.search(url);
    }
    if (/\/directory\/[0-9A-Z]{26}\/availability\?/.test(url)) {
      if (!handlers.availability) throw new Error(`Unexpected availability ${url}`);
      return handlers.availability(url);
    }
    if (/\/directory\/[0-9A-Z]{26}$/.test(url)) {
      if (!handlers.directory) throw new Error(`Unexpected directory ${url}`);
      return handlers.directory(url);
    }
    if (url.endsWith(`/profiles/${ACTOR_ID}`)) return Promise.resolve(jsonResponse({ data: actor }));
    throw new Error(`Unexpected GET ${url}`);
  });
  return { calls, searchCalls: () => calls.filter((url) => url.startsWith(SEARCH_PATH)), fetchMock };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function renderSearch(): Promise<void> {
  render(<PrivateApp view="search" />);
  await screen.findByRole("heading", { level: 1, name: "Buscar profesionales" });
}

function card(name: string): HTMLElement {
  return screen.getByRole("article", { name });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}`);
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("T15 — menú y acceso al buscador", () => {
  it("habilita Buscar solo para la empresa turística", async () => {
    expect(navigationFor("tourism_company").find((item) => item.label === "Buscar"))
      .toEqual({ label: "Buscar", href: "/app/search" });
    for (const category of ["guide", "driver", "instructor", "transport_company"] as const) {
      expect(navigationFor(category).map((item) => item.label)).not.toContain("Buscar");
    }

    window.history.replaceState({}, "", "/app");
    mockBackend(actorProfile("tourism_company"));
    render(<PrivateApp />);
    await screen.findByRole("heading", { level: 1, name: "Actor tourism_company" });
    const link = screen.getByRole("link", { name: "Buscar" });
    expect(link).toHaveAttribute("href", `/app/search?profile=${ACTOR_ID}`);
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("un receptor que entra por URL ve la explicación y no se busca nada", async () => {
    const backend = mockBackend(actorProfile("guide"));
    render(<PrivateApp view="search" />);

    expect(await screen.findByRole("heading", { level: 1, name: "La búsqueda es para empresas turísticas" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Filtros de búsqueda" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Buscar" })).toBeNull();
    expect(backend.searchCalls()).toEqual([]);
    expect(backend.calls.some((url) => url.includes("/catalogs"))).toBe(false);
  });
});

describe("T15 — filtros, URL y tarjetas", () => {
  it("los filtros combinados producen el query string exacto, se reflejan en la URL y sobreviven a recargar", async () => {
    const backend = mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(jsonResponse(page([]))),
    });
    await renderSearch();
    await waitFor(() => expect(backend.searchCalls()).toEqual([SEARCH_PATH]));
    await screen.findByRole("option", { name: "Ushuaia" });

    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "guide" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Ana Paz " } });
    fireEvent.change(screen.getByLabelText("Ciudad"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-11-22" } });
    fireEvent.click(screen.getByRole("radio", { name: "Al menos un día del rango" }));
    fireEvent.change(screen.getByLabelText("Verificación"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar perfiles" }));

    const expected = "type=guide&name=Ana+Paz&city_id=1&date_from=2026-11-20&date_to=2026-11-22&match_mode=any&verified=true";
    await waitFor(() => expect(backend.searchCalls().at(-1)).toBe(`${SEARCH_PATH}?${expected}`));
    expect(window.location.search).toBe(`?profile=${ACTOR_ID}&${expected}`);

    // "Recargar": un montaje nuevo con la misma URL repite la búsqueda y rellena el formulario.
    cleanup();
    backend.calls.length = 0;
    await renderSearch();
    await waitFor(() => expect(backend.searchCalls()).toEqual([`${SEARCH_PATH}?${expected}`]));
    expect(screen.getByLabelText("Categoría")).toHaveValue("guide");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Ana Paz");
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-22");
    expect(screen.getByRole("radio", { name: "Al menos un día del rango" })).toBeChecked();
    expect(screen.getByLabelText("Verificación")).toHaveValue("true");
    await waitFor(() => expect(screen.getByLabelText("Ciudad")).toHaveValue("1"));
  });

  it("una URL con cursor viejo se normaliza: el cursor no se envía ni queda en la URL", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&type=driver&cursor=viejo`);
    const backend = mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(jsonResponse(page([]))),
    });
    await renderSearch();
    await waitFor(() => expect(backend.searchCalls()).toEqual([`${SEARCH_PATH}?type=driver`]));
    expect(window.location.search).toBe(`?profile=${ACTOR_ID}&type=driver`);
  });

  it("muestra disponible, parcial N de M y nada para unspecified, con badge verificado en texto", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&date_from=2026-11-20&date_to=2026-11-22&match_mode=any`);
    mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(jsonResponse(page([
        result(TARGET_A, "Guía Completa", "available", 3, 3, true),
        result(TARGET_B, "Guía Parcial", "partial", 2, 3),
        result(TARGET_C, "Guía Sin Rango", "unspecified", 0, 0),
      ]))),
    });
    await renderSearch();

    const complete = await screen.findByRole("article", { name: "Guía Completa" });
    expect(complete).toHaveTextContent("Disponible los 3 días");
    expect(within(complete).getByText("Verificado")).toBeInTheDocument();
    expect(complete).toHaveTextContent("Ushuaia");
    expect(complete).toHaveTextContent("Español, Inglés");
    expect(within(complete).getByRole("link", { name: "Ver ficha de Guía Completa" }))
      .toHaveAttribute("href", `/app/profiles/${TARGET_A}?profile=${ACTOR_ID}`);

    const partial = card("Guía Parcial");
    expect(partial).toHaveTextContent("Disponibilidad parcial: 2 de 3 días");
    expect(within(partial).queryByText("Verificado")).toBeNull();

    const unspecified = card("Guía Sin Rango");
    expect(unspecified.textContent).not.toMatch(/Disponib/);
    expect(screen.getByText("3 perfiles cargados")).toBeInTheDocument();
  });
});

describe("T15 — estados de la búsqueda", () => {
  it("vacío en modo all con rango sugiere any y lo aplica", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&city_id=1&date_from=2026-11-20&date_to=2026-11-22`);
    const backend = mockBackend(actorProfile("tourism_company"), {
      search: (url) => Promise.resolve(jsonResponse(page(url.includes("match_mode=any")
        ? [result(TARGET_B, "Guía Parcial", "partial", 2, 3)]
        : []))),
    });
    await renderSearch();

    expect(await screen.findByRole("heading", { name: "Ningún perfil coincide con estos filtros" })).toBeInTheDocument();
    expect(screen.getByText(/Probá con “Al menos un día del rango”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver coincidencias parciales" }));

    expect(await screen.findByRole("article", { name: "Guía Parcial" })).toHaveTextContent("Disponibilidad parcial: 2 de 3 días");
    expect(backend.searchCalls().at(-1)).toBe(`${SEARCH_PATH}?city_id=1&date_from=2026-11-20&date_to=2026-11-22&match_mode=any`);
    expect(screen.getByRole("radio", { name: "Al menos un día del rango" })).toBeChecked();
    expect(window.location.search).toContain("match_mode=any");
  });

  it("vacío sin rango no ofrece el modo any", async () => {
    mockBackend(actorProfile("tourism_company"), { search: () => Promise.resolve(jsonResponse(page([]))) });
    await renderSearch();
    expect(await screen.findByRole("heading", { name: "Ningún perfil coincide con estos filtros" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver coincidencias parciales" })).toBeNull();
  });

  it("Cargar más usa el cursor opaco y agrega la segunda página", async () => {
    const backend = mockBackend(actorProfile("tourism_company"), {
      search: (url) => Promise.resolve(jsonResponse(url.includes("cursor=")
        ? page([result(TARGET_B, "Segunda Página")])
        : page([result(TARGET_A, "Primera Página")], "cursor-firmado-1"))),
    });
    await renderSearch();
    await screen.findByRole("article", { name: "Primera Página" });
    expect(screen.getByText("1 perfil cargado · hay más resultados")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("article", { name: "Segunda Página" })).toBeInTheDocument();
    expect(card("Primera Página")).toBeInTheDocument();
    expect(backend.searchCalls()).toEqual([SEARCH_PATH, `${SEARCH_PATH}?cursor=cursor-firmado-1`]);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(window.location.search).not.toContain("cursor");
  });

  it("descarta la respuesta tardía de filtros anteriores", async () => {
    const slow = deferred<Response>();
    mockBackend(actorProfile("tourism_company"), {
      search: (url) => url.includes("name=nuevo")
        ? Promise.resolve(jsonResponse(page([result(TARGET_B, "Resultado Nuevo")])))
        : slow.promise,
    });
    await renderSearch();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar perfiles" }));
    expect(await screen.findByRole("article", { name: "Resultado Nuevo" })).toBeInTheDocument();

    await act(async () => {
      slow.resolve(jsonResponse(page([result(TARGET_A, "Resultado Viejo")])));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("article", { name: "Resultado Viejo" })).toBeNull();
    expect(card("Resultado Nuevo")).toBeInTheDocument();
  });

  it("409 search_cursor_mismatch vuelve a la primera página con los mismos filtros", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&type=guide`);
    const backend = mockBackend(actorProfile("tourism_company"), {
      search: (url) => Promise.resolve(url.includes("cursor=")
        ? problem(409, "search_cursor_mismatch", "El cursor no corresponde a estos filtros.")
        : jsonResponse(page([result(TARGET_A, "Primera Página")], "cursor-de-otros-filtros"))),
    });
    await renderSearch();
    await screen.findByRole("article", { name: "Primera Página" });

    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText(/Volvimos a la primera página con los mismos filtros/)).toBeInTheDocument();
    await waitFor(() => expect(backend.searchCalls()).toEqual([
      `${SEARCH_PATH}?type=guide`,
      `${SEARCH_PATH}?type=guide&cursor=cursor-de-otros-filtros`,
      `${SEARCH_PATH}?type=guide`,
    ]));
    expect(await screen.findByRole("article", { name: "Primera Página" })).toBeInTheDocument();
  });

  it("403 explica el denial code real y enlaza a acceso", async () => {
    mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(problem(403, "subscription_expired", "Acceso vencido.")),
    });
    await renderSearch();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No podés usar el buscador en este momento");
    expect(alert).toHaveTextContent("La habilitación de este perfil venció");
    expect(within(alert).getByRole("link", { name: "Ver estado de acceso" }))
      .toHaveAttribute("href", `/app/access?profile=${ACTOR_ID}`);
  });

  it("422 muestra el error junto al filtro correspondiente", async () => {
    window.history.replaceState({}, "", `/app/search?profile=${ACTOR_ID}&date_from=2026-11-01&date_to=2027-03-01`);
    mockBackend(actorProfile("tourism_company"), {
      search: () => Promise.resolve(problem(422, "validation_failed", "Los datos enviados no son válidos.", {
        date_to: ["El rango no puede superar 90 días."],
      })),
    });
    await renderSearch();

    const message = await screen.findByText("El rango no puede superar 90 días.");
    const dateTo = screen.getByLabelText("Hasta");
    expect(dateTo).toHaveAttribute("aria-invalid", "true");
    expect(dateTo.getAttribute("aria-describedby")).toContain(message.id);
    expect(screen.getByLabelText("Desde")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Revisá los filtros");
  });
});

function directoryData(): DirectoryProfile & { profile: SafeProfile & { contact_email: string; phone: string } } {
  return {
    // El backend no envía contacto; se simula una fuga para probar que la UI solo lee la whitelist.
    profile: { ...safeProfile(TARGET_B, "Guía Parcial", true), contact_email: LEAKED_EMAIL, phone: LEAKED_PHONE },
    document_statuses: [
      { document_type: { code: "guide_license", label: "Credencial de guía" }, status: "approved", valid_until: "2027-12-31", is_currently_valid: true },
      { document_type: { code: "insurance", label: "Seguro de responsabilidad" }, status: "pending", valid_until: null, is_currently_valid: false },
      { document_type: { code: "first_aid", label: "Primeros auxilios" }, status: "missing", valid_until: null, is_currently_valid: false },
    ],
    qualifications: [{ title: "Guía de alta montaña", institution: "Instituto Austral", completed_on: "2020-03-01", expires_on: null }],
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
  return { data: { profile_id: TARGET_B, version: 3, available_days: days } };
}

describe("T15 — ficha read-only", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/app/profiles/${TARGET_B}?profile=${ACTOR_ID}`);
  });

  it("muestra datos sanitizados, documentos legibles, referencias vacías, calendario y formulario de solicitud para empresa", async () => {
    const backend = mockBackend(actorProfile("tourism_company"), {
      directory: () => Promise.resolve(jsonResponse({ data: directoryData() })),
      availability: (url) => Promise.resolve(jsonResponse(availabilityBody(url))),
    });
    render(<PrivateApp view="directory" targetProfileId={TARGET_B} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Guía Parcial" })).toBeInTheDocument();
    expect(screen.getByText("Verificado")).toBeInTheDocument();
    expect(screen.getByText("Ushuaia, Río Grande")).toBeInTheDocument();
    expect(screen.getByText("Tecnicatura en guía de turismo")).toBeInTheDocument();
    expect(screen.getByText("Guía de alta montaña")).toBeInTheDocument();

    const documents = screen.getByRole("region", { name: "Documentación" });
    expect(documents).toHaveTextContent("Credencial de guía");
    expect(documents).toHaveTextContent("Aprobado · vigente hasta 31/12/2027");
    expect(documents).toHaveTextContent("En revisión");
    expect(documents).toHaveTextContent("Sin cargar");
    expect(screen.getByRole("region", { name: "Referencias" })).toHaveTextContent("Todavía no tiene referencias visibles.");

    const calendar = screen.getByRole("region", { name: "Disponibilidad publicada" });
    expect(await within(calendar).findByText("2 días disponibles en noviembre 2026.")).toBeInTheDocument();
    expect(calendar.querySelector('li[data-date="2026-11-20"]')).toHaveAttribute("data-state", "available");
    expect(calendar.querySelector('li[data-date="2026-11-20"]')).toHaveTextContent("disponible en Ushuaia");
    expect(calendar.querySelector('li[data-date="2026-11-22"]')).toHaveTextContent("sin disponibilidad publicada");
    expect(calendar).not.toHaveTextContent(/ocupado/i);
    expect(backend.calls).toContain(`/api/backend/v1/profiles/${ACTOR_ID}/directory/${TARGET_B}/availability?month=2026-11`);

    fireEvent.click(within(calendar).getByRole("button", { name: /^Mes siguiente/ }));
    expect(await within(calendar).findByText("Sin disponibilidad publicada en diciembre 2026.")).toBeInTheDocument();

    // T18 reemplazó el CTA deshabilitado por el formulario real; nada se envía hasta el submit.
    const form = screen.getByRole("form", { name: "Solicitud de contacto" });
    expect(within(form).getByLabelText("Servicio solicitado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solicitar contacto" })).toBeNull();
    expect(screen.getByRole("main")).not.toHaveTextContent(/Disponible en próxima etapa/);
    expect(browserMutation).not.toHaveBeenCalled();
    expect(backend.calls.some((url) => url.includes("contact-requests"))).toBe(false);

    // P18 (frontend): ni el texto ni el HTML de la ficha contienen contacto.
    const html = document.body.innerHTML;
    expect(html).not.toContain("@");
    expect(html).not.toContain(LEAKED_PHONE);
    expect(html).not.toContain("2901999999");
    expect(html).not.toContain("+5492901000000");
  });

  it("un receptor ve la ficha sin ningún CTA de envío", async () => {
    mockBackend(actorProfile("guide"), {
      directory: () => Promise.resolve(jsonResponse({ data: directoryData() })),
      availability: (url) => Promise.resolve(jsonResponse(availabilityBody(url))),
    });
    render(<PrivateApp view="directory" targetProfileId={TARGET_B} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Guía Parcial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Solicitar/ })).toBeNull();
    expect(screen.queryByText(/Disponible en próxima etapa\. El contacto/)).toBeNull();
    expect(screen.getByText(/Las solicitudes de contacto las inician las empresas turísticas/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Volver al resumen" })).toHaveAttribute("href", `/app?profile=${ACTOR_ID}`);
    expect(document.body.innerHTML).not.toContain("@");
  });

  it("un target no elegible (404) muestra perfil no disponible sin datos", async () => {
    mockBackend(actorProfile("tourism_company"), {
      directory: () => Promise.resolve(problem(404, "not_found", "El recurso solicitado no existe.")),
    });
    render(<PrivateApp view="directory" targetProfileId={TARGET_C} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Perfil no disponible" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Solicitud de contacto" })).toBeNull();
  });

  it("un identificador inválido no consulta el directorio", async () => {
    const backend = mockBackend(actorProfile("tourism_company"));
    render(<PrivateApp view="directory" targetProfileId="no-es-un-ulid" />);
    expect(await screen.findByRole("heading", { level: 1, name: "Perfil no disponible" })).toBeInTheDocument();
    expect(backend.calls.some((url) => url.includes("/directory/"))).toBe(false);
  });
});
