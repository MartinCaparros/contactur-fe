import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { AdminBackoffice } from "@/features/admin/AdminShell";
import { type AdminReferenceEntry, auditActionLabel, auditTargetTypeLabel } from "@/features/admin/api";
import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import type {
  AccessEvaluation,
  AppNotification,
  City,
  ContactRequest,
  CurrentAccount,
  DirectoryProfile,
  Profile,
  ProfileCategory,
  Reference,
  SafeProfile,
} from "@/features/app/api";
import { describeNotification } from "@/features/app/notificationsModel";
import { formatArgentinaDate, referencesHref } from "@/features/app/referencesModel";
import { isAllowedBackendRoute } from "@/lib/bff/allowlist";
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
const OTHER_COMPANY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const REQUEST_B = "01ARZ3NDEKTSV4RRFFQ69G5FC2";
const REF_A = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const REF_B = "01ARZ3NDEKTSV4RRFFQ69G5FD2";
const REF_C = "01ARZ3NDEKTSV4RRFFQ69G5FD3";

/** Cuerpo con HTML inyectado y saltos de línea: tiene que llegar al DOM como texto. */
const HTML_BODY = "Excelente coordinación del grupo.\n<img src=x onerror=alert(1)><b>negrita</b>\nVolveríamos a trabajar juntos.";

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

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

function access(category: ProfileCategory, state: "active" | "expired" = "active"): AccessEvaluation {
  const active = state === "active";
  const sender = category === "tourism_company";
  return {
    profile_id: category === "tourism_company" ? COMPANY_ID : GUIDE_ID,
    effective_state: state,
    allowed: active,
    denial_code: active ? null : "subscription_expired",
    grant: null,
    capabilities: {
      can_search: active && sender,
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

function account(value: Profile, role: "user" | "admin" = "user"): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: role,
      status: "active",
    },
    profiles: role === "admin" ? [] : [{
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

function safe(id: string, category: ProfileCategory, name: string): SafeProfile {
  const base = {
    id,
    display_name: name,
    description: null,
    primary_city: ushuaia,
    cities: [ushuaia],
    languages: [],
    services: [],
    avatar: null,
    gallery: [],
    verified: false,
  };
  return category === "tourism_company"
    ? { ...base, category, category_details: { legal_name: `${name} SA`, years_active: 5 } }
    : { ...base, category: "guide", category_details: { education_summary: null } };
}

const companySafe = () => safe(COMPANY_ID, "tourism_company", "Turismo Austral");
const guideSafe = () => safe(GUIDE_ID, "guide", "Guía Austral");
const otherCompanySafe = () => safe(OTHER_COMPANY_ID, "tourism_company", "Expediciones Sur");

/** Referencia recibida por la guía: la escribió la empresa del match. */
function reference(overrides: Partial<Reference> = {}): Reference {
  return {
    id: REF_A,
    contact_request_id: REQUEST_ID,
    author: companySafe(),
    subject: guideSafe(),
    body: "Coordinación impecable durante toda la excursión al Glaciar Martial.",
    visibility: "hidden",
    moderated: false,
    moderation_reason: null,
    // 23:30 del 09/11 en Argentina: la fecha no puede salir del día UTC.
    created_at: "2026-11-10T02:30:00Z",
    ...overrides,
  };
}

function contactRequest(overrides: Partial<ContactRequest> = {}): ContactRequest {
  return {
    id: REQUEST_ID,
    sender: companySafe(),
    recipient: guideSafe(),
    service_description: "Guía bilingüe para trekking.",
    requested_from: null,
    requested_to: null,
    requested_city: null,
    status: "accepted",
    availability_status: "unspecified",
    expires_at: "2026-11-17T15:00:00Z",
    responded_at: "2026-11-10T16:00:00Z",
    cancelled_at: null,
    created_at: "2026-11-10T15:00:00Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status);
}

function page<T>(items: T[], nextCursor: string | null = null) {
  return { data: items, meta: { next_cursor: nextCursor, per_page: 20 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

type Handler = (url: string) => Promise<Response>;
type Handlers = Partial<Record<"references" | "detail" | "directory" | "adminReferences", Handler>>;
type Backend = { calls: string[]; fetchMock: MockInstance<typeof fetch> };

const REFERENCES_BASE = (profileId: string) => `/api/backend/v1/profiles/${profileId}/references`;

function mockBackend(
  actor: Profile,
  handlers: Handlers = {},
  evaluation: AccessEvaluation = access(actor.category),
  role: "user" | "admin" = "user",
): Backend {
  const calls: string[] = [];
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(actor, role) }));
    if (url.includes("/admin/references")) {
      if (!handlers.adminReferences) throw new Error(`Unexpected admin GET ${url}`);
      return handlers.adminReferences(url);
    }
    if (url.endsWith(`${actor.id}/access`)) return Promise.resolve(jsonResponse({ data: evaluation }));
    if (url.includes("/notifications")) return Promise.resolve(jsonResponse(page([])));
    if (url.startsWith(REFERENCES_BASE(actor.id))) {
      if (!handlers.references) throw new Error(`Unexpected references GET ${url}`);
      return handlers.references(url);
    }
    if (/\/contact-requests\/[0-9A-Z]{26}$/.test(url)) {
      if (!handlers.detail) throw new Error(`Unexpected detail GET ${url}`);
      return handlers.detail(url);
    }
    if (/\/directory\/[0-9A-Z]{26}\/availability\?/.test(url)) {
      return Promise.resolve(jsonResponse({ data: { profile_id: GUIDE_ID, version: 1, available_days: [] } }));
    }
    if (/\/directory\/[0-9A-Z]{26}$/.test(url)) {
      if (!handlers.directory) throw new Error(`Unexpected directory GET ${url}`);
      return handlers.directory(url);
    }
    if (url.endsWith(`/profiles/${actor.id}`)) return Promise.resolve(jsonResponse({ data: actor }));
    throw new Error(`Unexpected GET ${url}`);
  });
  return { calls, fetchMock };
}

function referenceCalls(backend: Backend, actorId: string): string[] {
  return backend.calls.filter((url) => url.startsWith(REFERENCES_BASE(actorId)));
}

function mutationCalls(): Array<Readonly<{ url: string; init: RequestInit }>> {
  return vi.mocked(browserMutation).mock.calls.map(([url, init]) => ({ url: String(url), init: init ?? {} }));
}

function article(name: string | RegExp): HTMLElement {
  return screen.getByRole("article", { name });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("T20 — menú", () => {
  it("habilita Referencias y Ajustes para todas las categorías", async () => {
    for (const category of ["tourism_company", "guide", "driver", "instructor", "transport_company"] as const) {
      const items = navigationFor(category);
      expect(items.find((item) => item.label === "Referencias"))
        .toEqual({ label: "Referencias", href: "/app/references" });
      // T21 habilitó Ajustes.
      expect(items.find((item) => item.label === "Ajustes")).toEqual({ label: "Ajustes", href: "/app/settings" });
    }

    window.history.replaceState({}, "", "/app");
    mockBackend(actorProfile("guide"));
    render(<PrivateApp />);
    await screen.findByRole("heading", { level: 1, name: "Guía Austral" });
    const link = screen.getByRole("link", { name: "Referencias" });
    expect(link).toHaveAttribute("href", `/app/references?profile=${GUIDE_ID}`);
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("link", { name: "Ajustes" })).toHaveAttribute("href", `/app/settings?profile=${GUIDE_ID}`);
  });
});

async function renderReferences(actor: Profile, handler: Handler, search = ""): Promise<Backend> {
  window.history.replaceState({}, "", `/app/references?profile=${actor.id}${search}`);
  const backend = mockBackend(actor, { references: handler });
  render(<PrivateApp view="references" />);
  await screen.findByRole("heading", { level: 1, name: "Referencias" });
  return backend;
}

describe("T20 — listado de referencias", () => {
  it("abre las recibidas con la dirección en la URL y muestra contraparte, fecha, estado y texto plano", async () => {
    const backend = await renderReferences(actorProfile("guide"), () => Promise.resolve(jsonResponse(page([
      reference({ body: HTML_BODY }),
    ]))));

    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    expect(referenceCalls(backend, GUIDE_ID)).toEqual([`${REFERENCES_BASE(GUIDE_ID)}?direction=received&per_page=20`]);
    expect(window.location.search).toBe(`?profile=${GUIDE_ID}&direction=received`);
    expect(screen.getByRole("tab", { name: "Recibidas" })).toHaveAttribute("aria-selected", "true");
    expect(row).toHaveTextContent("Escrita por");
    expect(row).toHaveTextContent("Empresa turística");
    expect(row).toHaveTextContent("09/11/2026");
    expect(row).toHaveTextContent("Estado: Oculta en tu ficha");
    // Texto plano: el HTML no se interpreta y los saltos de línea se conservan.
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector("b")).toBeNull();
    expect(within(row).getByText((_, element) => element?.tagName === "P" && element.textContent === HTML_BODY)).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Ver la solicitud relacionada con Turismo Austral" }))
      .toHaveAttribute("href", `/app/requests/${REQUEST_ID}?profile=${GUIDE_ID}`);
    expect(within(row).getByRole("button", { name: "Publicar en mi ficha" })).toBeEnabled();
    // Sin puntajes ni estrellas en ninguna forma.
    expect(document.querySelector('input[type="range"], input[type="number"]')).toBeNull();
    expect(screen.getByRole("main")).not.toHaveTextContent(/★|estrella|puntaje|calificaci/i);
  });

  it("cambia a escritas por vos con textos de estado del destinatario y moderación visible", async () => {
    const backend = await renderReferences(actorProfile("tourism_company"), (url) => {
      const direction = new URL(url, "http://x").searchParams.get("direction");
      return Promise.resolve(jsonResponse(page(direction === "authored"
        ? [
            reference({ id: REF_A }),
            reference({ id: REF_B, contact_request_id: REQUEST_B, subject: safe(GUIDE_ID, "guide", "Guía Patagónica"), visibility: "visible" }),
            reference({ id: REF_C, subject: safe(GUIDE_ID, "guide", "Guía Moderada"), visibility: "visible", moderated: true, moderation_reason: "Incluye datos personales de terceros." }),
          ]
        : [])));
    });

    expect(await screen.findByRole("heading", { name: "Todavía no recibiste referencias" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Escritas por vos" }));

    const pending = await screen.findByRole("article", { name: "Guía Austral" });
    expect(window.location.search).toBe(`?profile=${COMPANY_ID}&direction=authored`);
    expect(referenceCalls(backend, COMPANY_ID)).toContain(`${REFERENCES_BASE(COMPANY_ID)}?direction=authored&per_page=20`);
    expect(pending).toHaveTextContent("Sobre");
    expect(pending).toHaveTextContent("Guía");
    expect(pending).toHaveTextContent("Estado: Pendiente de publicación por Guía Austral");
    expect(article("Guía Patagónica")).toHaveTextContent("Estado: Publicada por Guía Patagónica");
    const moderated = article("Guía Moderada");
    expect(moderated).toHaveTextContent("Estado: Oculta por moderación");
    expect(moderated).toHaveTextContent("Motivo de moderación: Incluye datos personales de terceros.");
    // Quien escribió no decide la visibilidad.
    expect(screen.queryByRole("button", { name: /mi ficha/ })).toBeNull();
  });

  it("abre la pestaña de la URL y carga más por cursor sin duplicar ni escribir el cursor en la URL", async () => {
    const backend = await renderReferences(actorProfile("tourism_company"), (url) => {
      const cursor = new URL(url, "http://x").searchParams.get("cursor");
      return Promise.resolve(jsonResponse(cursor === "c2"
        ? page([reference({ id: REF_A }), reference({ id: REF_B, subject: safe(GUIDE_ID, "guide", "Guía Segunda") })])
        : page([reference({ id: REF_A })], "c2")));
    }, "&direction=authored");

    await screen.findByRole("article", { name: "Guía Austral" });
    expect(screen.getByRole("tab", { name: "Escritas por vos" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByRole("article", { name: "Guía Segunda" });

    expect(referenceCalls(backend, COMPANY_ID)).toEqual([
      `${REFERENCES_BASE(COMPANY_ID)}?direction=authored&per_page=20`,
      `${REFERENCES_BASE(COMPANY_ID)}?direction=authored&per_page=20&cursor=c2`,
    ]);
    expect([...document.querySelectorAll("[data-reference-id]")].map((element) => element.getAttribute("data-reference-id")))
      .toEqual([REF_A, REF_B]);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(window.location.search).not.toContain("cursor");
  });

  it("muestra el estado vacío de escritas con el camino a las solicitudes y explica un 403", async () => {
    await renderReferences(actorProfile("guide"), () => Promise.resolve(jsonResponse(page([]))), "&direction=authored");
    expect(await screen.findByRole("heading", { name: "Todavía no escribiste referencias" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver solicitudes" })).toHaveAttribute("href", `/app/requests?profile=${GUIDE_ID}`);

    cleanup();
    vi.restoreAllMocks();
    await renderReferences(actorProfile("guide"), () => Promise.resolve(problem(403, "account_suspended", "Cuenta suspendida.")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tu cuenta está suspendida y no puede realizar esta acción.");
  });
});

describe("T20 — publicar u ocultar en la ficha", () => {
  it("publica de forma optimista y conserva lo que confirmó el backend", async () => {
    await renderReferences(actorProfile("guide"), () => Promise.resolve(jsonResponse(page([reference()]))));
    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    const pending = deferred<Response>();
    vi.mocked(browserMutation).mockReturnValueOnce(pending.promise);

    fireEvent.click(within(row).getByRole("button", { name: "Publicar en mi ficha" }));

    // Optimista: el estado cambia antes de la respuesta y el botón queda bloqueado.
    expect(row).toHaveTextContent("Estado: Publicada en tu ficha");
    expect(within(row).getByRole("button", { name: "Ocultar de mi ficha" })).toBeDisabled();
    const [call] = mutationCalls();
    expect(call?.url).toBe(`${REFERENCES_BASE(GUIDE_ID)}/${REF_A}/visibility`);
    expect(call?.init.method).toBe("PATCH");
    expect(JSON.parse(String(call?.init.body))).toEqual({ visibility: "visible" });

    pending.resolve(jsonResponse({ data: reference({ visibility: "visible" }) }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "Ocultar de mi ficha" })).toBeEnabled());
    expect(row).toHaveTextContent("Estado: Publicada en tu ficha");
  });

  it("revierte ante un 403 de acceso y lo explica junto a la referencia", async () => {
    await renderReferences(actorProfile("guide"), () => Promise.resolve(jsonResponse(page([reference({ visibility: "visible" })]))));
    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(403, "profile_suspended", "Perfil suspendido."));

    fireEvent.click(within(row).getByRole("button", { name: "Ocultar de mi ficha" }));

    expect(await within(row).findByRole("alert")).toHaveTextContent("Tu perfil está suspendido y no puede realizar esta acción.");
    expect(row).toHaveTextContent("Estado: Publicada en tu ficha");
    const button = within(row).getByRole("button", { name: "Ocultar de mi ficha" });
    expect(button).toBeEnabled();
    expect(button.getAttribute("aria-describedby")).toContain(`reference-error-${REF_A}`);
    expect(JSON.parse(String(mutationCalls()[0]?.init.body))).toEqual({ visibility: "hidden" });
  });

  it("ante 409 reference_moderated explica, revierte y relee el listado", async () => {
    let listCalls = 0;
    const backend = await renderReferences(actorProfile("guide"), () => {
      listCalls += 1;
      return Promise.resolve(jsonResponse(page([listCalls === 1
        ? reference()
        : reference({ moderated: true, moderation_reason: "Contenido ajeno al servicio." })])));
    });
    const row = await screen.findByRole("article", { name: "Turismo Austral" });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(409, "reference_moderated", "La referencia está moderada."));

    fireEvent.click(within(row).getByRole("button", { name: "Publicar en mi ficha" }));

    expect(await screen.findByText(/Administración ocultó esta referencia por moderación mientras la mirabas/)).toBeInTheDocument();
    const refreshed = await screen.findByText("Motivo de moderación: Contenido ajeno al servicio.");
    const updated = refreshed.closest("article");
    expect(updated).toHaveTextContent("Estado: Oculta por moderación");
    expect(within(updated as HTMLElement).queryByRole("button", { name: /mi ficha/ })).toBeNull();
    expect(referenceCalls(backend, GUIDE_ID)).toHaveLength(2);
  });
});

async function renderDetail(
  actor: Profile,
  request: ContactRequest,
  references: Handler,
  evaluation: AccessEvaluation = access(actor.category),
): Promise<Backend> {
  window.history.replaceState({}, "", `/app/requests/${request.id}?profile=${actor.id}`);
  const backend = mockBackend(actor, {
    detail: () => Promise.resolve(jsonResponse({ data: request })),
    references,
  }, evaluation);
  render(<PrivateApp view="request" requestId={request.id} />);
  await screen.findByRole("heading", { level: 1, name: /Solicitud (de|a) / });
  return backend;
}

const LOOKUP_URL = (actorId: string) => `${REFERENCES_BASE(actorId)}?direction=authored&per_page=50`;
const CREATE_URL = (actorId: string) => `/api/backend/v1/profiles/${actorId}/contact-requests/${REQUEST_ID}/references`;

describe("T20 — referencia desde el detalle de una solicitud aceptada", () => {
  it("valida 20–2000, envía el texto recortado y muestra la referencia creada con su estado", async () => {
    const backend = await renderDetail(actorProfile("guide"), contactRequest(), () => Promise.resolve(jsonResponse(page([
      reference({ id: REF_B, contact_request_id: REQUEST_B, author: guideSafe(), subject: otherCompanySafe() }),
    ]))));
    const region = screen.getByRole("region", { name: "Referencia" });
    const form = await within(region).findByRole("form", { name: "Referencia" });
    expect(referenceCalls(backend, GUIDE_ID)).toEqual([LOOKUP_URL(GUIDE_ID)]);
    expect(region).toHaveTextContent("empieza oculta: Turismo Austral decide si la publica en su ficha");
    expect(region).toHaveTextContent("no se puede editar");

    const textarea = within(form).getByLabelText("Dejá una referencia sobre Turismo Austral");
    expect(textarea).toHaveAttribute("maxlength", "2000");
    fireEvent.change(textarea, { target: { value: "   Muy buena   " } });
    expect(form).toHaveTextContent("9 de 2000 caracteres (mínimo 20).");
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));

    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.getAttribute("aria-describedby")).toContain("reference-body-error");
    expect(document.getElementById("reference-body-error")).toHaveTextContent("Escribí al menos 20 caracteres");
    expect(browserMutation).not.toHaveBeenCalled();

    const text = "  Empresa muy organizada.\nPagos y horarios claros desde el primer día.  ";
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse({
      data: reference({ id: REF_C, author: guideSafe(), subject: companySafe(), body: text.trim() }),
    }, 201));
    fireEvent.change(textarea, { target: { value: text } });
    expect(textarea).not.toHaveAttribute("aria-invalid");
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));

    expect(await within(region).findByRole("heading", { name: "Referencia guardada sobre Turismo Austral" })).toBeInTheDocument();
    const [call] = mutationCalls();
    expect(call?.url).toBe(CREATE_URL(GUIDE_ID));
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(String(call?.init.body))).toEqual({ body: text.trim() });
    expect(region).toHaveTextContent("Estado: Pendiente de publicación por Turismo Austral");
    expect(within(region).queryByRole("form")).toBeNull();
    expect(within(region).getByRole("link", { name: "Ver tus referencias" }))
      .toHaveAttribute("href", `/app/references?profile=${GUIDE_ID}&direction=authored`);
    // La sección nunca pide ni muestra datos de contacto.
    expect(backend.calls.some((url) => url.endsWith("/contact"))).toBe(false);
  });

  it("ante 409 reference_already_exists lo explica y enlaza a las escritas", async () => {
    await renderDetail(actorProfile("tourism_company"), contactRequest(), () => Promise.resolve(jsonResponse(page([]))));
    const region = screen.getByRole("region", { name: "Referencia" });
    const form = await within(region).findByRole("form", { name: "Referencia" });
    fireEvent.change(within(form).getByLabelText("Dejá una referencia sobre Guía Austral"), {
      target: { value: "Guía muy profesional y atenta con todo el grupo." },
    });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(409, "reference_already_exists", "Ya existe."));
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));

    const alert = await within(region).findByRole("alert");
    expect(alert).toHaveTextContent("Ya dejaste una referencia en este match");
    expect(within(alert).getByRole("link", { name: "Ver tus referencias" }))
      .toHaveAttribute("href", `/app/references?profile=${COMPANY_ID}&direction=authored`);
    expect(within(region).queryByRole("form")).toBeNull();
  });

  it("vincula un 422 de body al textarea y explica un 403 de acceso", async () => {
    await renderDetail(actorProfile("guide"), contactRequest(), () => Promise.resolve(jsonResponse(page([]))));
    const region = screen.getByRole("region", { name: "Referencia" });
    const form = await within(region).findByRole("form", { name: "Referencia" });
    const textarea = within(form).getByLabelText("Dejá una referencia sobre Turismo Austral");
    fireEvent.change(textarea, { target: { value: "Texto suficientemente largo para validar." } });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Datos inválidos.", {
      body: ["La referencia debe tener entre 20 y 2000 caracteres."],
    }));
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));

    await waitFor(() => expect(textarea).toHaveAttribute("aria-invalid", "true"));
    expect(textarea.getAttribute("aria-describedby")?.split(" ")).toEqual(["reference-body-hint", "reference-body-counter", "reference-body-error"]);
    expect(document.getElementById("reference-body-error")).toHaveTextContent("La referencia debe tener entre 20 y 2000 caracteres.");

    vi.mocked(browserMutation).mockResolvedValueOnce(problem(403, "subscription_expired", "Vencida."));
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("La habilitación de tu perfil venció");
  });

  it("muestra la referencia existente en lugar del formulario", async () => {
    await renderDetail(actorProfile("guide"), contactRequest(), () => Promise.resolve(jsonResponse(page([
      reference({ id: REF_B, author: guideSafe(), subject: companySafe(), visibility: "visible", body: "Ya la había escrito antes con cuidado." }),
    ]))));
    const region = screen.getByRole("region", { name: "Referencia" });
    expect(await within(region).findByRole("heading", { name: "Ya dejaste una referencia sobre Turismo Austral" })).toBeInTheDocument();
    expect(region).toHaveTextContent("Estado: Publicada por Turismo Austral");
    expect(region).toHaveTextContent("Ya la había escrito antes con cuidado.");
    expect(within(region).queryByRole("form")).toBeNull();
  });

  it("con 409 contact_request_not_accepted explica y relee el detalle", async () => {
    let detailCalls = 0;
    window.history.replaceState({}, "", `/app/requests/${REQUEST_ID}?profile=${GUIDE_ID}`);
    mockBackend(actorProfile("guide"), {
      detail: () => {
        detailCalls += 1;
        return Promise.resolve(jsonResponse({ data: contactRequest(detailCalls === 1 ? {} : { status: "cancelled", cancelled_at: "2026-11-10T17:00:00Z" }) }));
      },
      references: () => Promise.resolve(jsonResponse(page([]))),
    });
    render(<PrivateApp view="request" requestId={REQUEST_ID} />);
    const form = await screen.findByRole("form", { name: "Referencia" });
    fireEvent.change(within(form).getByLabelText(/Dejá una referencia sobre/), { target: { value: "Una referencia con el largo mínimo pedido." } });
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(409, "contact_request_not_accepted", "No aceptada."));
    fireEvent.click(within(form).getByRole("button", { name: "Enviar referencia" }));

    expect(await screen.findByText("Estado: Cancelada")).toBeInTheDocument();
    expect(detailCalls).toBe(2);
    expect(screen.queryByRole("region", { name: "Referencia" })).toBeNull();
  });

  it("no ofrece referencias en solicitudes pendientes ni rechazadas", async () => {
    for (const status of ["pending", "rejected"] as const) {
      const backend = await renderDetail(actorProfile("guide"), contactRequest({ status, responded_at: status === "pending" ? null : "2026-11-10T16:00:00Z" }), () => Promise.resolve(jsonResponse(page([]))));
      expect(screen.queryByRole("region", { name: "Referencia" })).toBeNull();
      expect(screen.queryByLabelText(/Dejá una referencia/)).toBeNull();
      expect(referenceCalls(backend, GUIDE_ID)).toEqual([]);
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it("con acceso vencido no ofrece el formulario y lo explica", async () => {
    await renderDetail(actorProfile("guide"), contactRequest(), () => Promise.resolve(jsonResponse(page([]))), access("guide", "expired"));
    const region = screen.getByRole("region", { name: "Referencia" });
    await waitFor(() => expect(region).toHaveTextContent("La habilitación de tu perfil venció"));
    expect(within(region).queryByRole("form")).toBeNull();
  });
});

describe("T20 — referencias en la ficha del directorio", () => {
  it("muestra autor, categoría y fecha de Argentina con el cuerpo como texto", async () => {
    const data: DirectoryProfile = {
      profile: guideSafe(),
      document_statuses: [],
      qualifications: [],
      fleet_vehicles: [],
      specialties: [],
      visible_references: [{ id: REF_A, author: otherCompanySafe(), body: HTML_BODY, created_at: "2026-11-10T02:30:00Z" }],
    };
    window.history.replaceState({}, "", `/app/profiles/${GUIDE_ID}?profile=${COMPANY_ID}`);
    mockBackend(actorProfile("tourism_company"), { directory: () => Promise.resolve(jsonResponse({ data })) });
    render(<PrivateApp view="directory" targetProfileId={GUIDE_ID} />);
    await screen.findByRole("heading", { level: 1, name: "Guía Austral" });

    const region = screen.getByRole("region", { name: "Referencias" });
    const item = region.querySelector(`[data-reference-id="${REF_A}"]`);
    expect(item).not.toBeNull();
    expect(item?.querySelector("blockquote")?.textContent).toBe(HTML_BODY);
    expect(item?.querySelector("img")).toBeNull();
    expect(item?.querySelector("b")).toBeNull();
    expect(item).toHaveTextContent("Expediciones Sur · Empresa turística · 09/11/2026");
  });

  it("formatea la fecha en hora de Argentina y no por el día UTC", () => {
    expect(formatArgentinaDate("2026-11-10T02:30:00Z")).toBe("09/11/2026");
    expect(formatArgentinaDate("2026-11-10T15:00:00Z")).toBe("10/11/2026");
  });
});

function notification(safeData: Record<string, unknown>): AppNotification {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FE1",
    type: "administrative_change",
    safe_data: safeData,
    read_at: null,
    created_at: "2026-11-10T15:00:00Z",
  };
}

describe("T20 — avisos y auditoría", () => {
  it("titula la moderación según el rol y enlaza a la pestaña correspondiente", () => {
    const hiddenAuthor = describeNotification(notification({ change: "reference_hidden", reference_id: REF_A, role: "author", profile_id: GUIDE_ID }));
    expect(hiddenAuthor.title).toBe("Administración ocultó una referencia que escribiste");
    expect(hiddenAuthor.referencesDirection).toBe("authored");

    const hiddenSubject = describeNotification(notification({ change: "reference_hidden", reference_id: REF_A, role: "subject", profile_id: GUIDE_ID }));
    expect(hiddenSubject.title).toBe("Administración ocultó una referencia sobre tu perfil");
    expect(hiddenSubject.referencesDirection).toBe("received");

    expect(describeNotification(notification({ change: "reference_restored", reference_id: REF_A, role: "author" })).title)
      .toBe("Administración restauró una referencia que escribiste");
    const restoredSubject = describeNotification(notification({ change: "reference_restored", reference_id: REF_A, role: "subject", extra: "<b>x</b>" }));
    expect(restoredSubject.title).toBe("Administración restauró una referencia sobre tu perfil");
    expect(restoredSubject.description).not.toContain("<b>");

    // Sin `reference_id` válido no hay enlace; otros cambios administrativos tampoco lo tienen.
    expect(describeNotification(notification({ change: "reference_hidden", reference_id: "<script>", role: "author" })).referencesDirection).toBeNull();
    expect(describeNotification(notification({ change: "access_updated", reference_id: REF_A })).referencesDirection).toBeNull();
    expect(referencesHref(GUIDE_ID, "authored")).toBe(`/app/references?profile=${GUIDE_ID}&direction=authored`);
  });

  it("traduce las acciones y el destino de auditoría de referencias", () => {
    expect(auditActionLabel("reference.hidden")).toBe("Referencia ocultada por moderación");
    expect(auditActionLabel("reference.restored")).toBe("Referencia restaurada por moderación");
    expect(auditTargetTypeLabel("reference")).toBe("Referencia");
    expect(isAllowedBackendRoute("GET", "admin/references")).toBe(true);
    expect(isAllowedBackendRoute("POST", `admin/references/${REF_A}/moderate`)).toBe(true);
    expect(isAllowedBackendRoute("PATCH", `profiles/${GUIDE_ID}/references/${REF_A}/visibility`)).toBe(true);
  });
});

function adminReference(overrides: Partial<AdminReferenceEntry> = {}): AdminReferenceEntry {
  return { ...reference({ body: HTML_BODY }), moderated_at: null, ...overrides };
}

const ADMIN_BASE = "/api/backend/v1/admin/references";

async function renderAdmin(handler: Handler): Promise<Backend> {
  const backend = mockBackend(actorProfile("guide"), { adminReferences: handler }, access("guide"), "admin");
  render(<AdminBackoffice view="references" />);
  await screen.findByRole("heading", { level: 1, name: "Referencias" });
  return backend;
}

function adminCalls(backend: Backend): string[] {
  return backend.calls.filter((url) => url.startsWith(ADMIN_BASE) && !url.includes("/moderate"));
}

describe("T20 — moderación en el backoffice", () => {
  it("lista autor → destinatario con ULIDs y texto plano, y traduce filtros y cursor a la query", async () => {
    const backend = await renderAdmin((url) => {
      const params = new URL(url, "http://x").searchParams;
      return Promise.resolve(jsonResponse({
        data: [adminReference()],
        meta: { next_cursor: params.get("cursor") ? null : "40", per_page: 25, total: 2 },
      }));
    });

    const card = (await screen.findByRole("heading", { name: "Turismo Austral → Guía Austral" })).closest("li") as HTMLElement;
    expect(card).toHaveTextContent("Turismo Austral · Empresa turística");
    expect(card).toHaveTextContent("Guía Austral · Guía");
    expect(card).toHaveTextContent(COMPANY_ID);
    expect(card).toHaveTextContent(GUIDE_ID);
    expect(card).toHaveTextContent("Moderación: Sin moderación");
    expect(card).toHaveTextContent("Visibilidad: Oculta por el destinatario");
    expect(card.querySelector("img")).toBeNull();
    expect(within(card).getByText((_, element) => element?.tagName === "P" && element.textContent === HTML_BODY)).toBeInTheDocument();
    expect(adminCalls(backend)).toEqual([`${ADMIN_BASE}?per_page=25`]);

    const apply = () => screen.getByRole("button", { name: "Aplicar filtros" });
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(adminCalls(backend)).toContain(`${ADMIN_BASE}?cursor=40&per_page=25`));
    await waitFor(() => expect(apply()).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Perfil autor o destinatario (opcional)"), { target: { value: ` ${GUIDE_ID.toLowerCase()} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(adminCalls(backend)).toContain(`${ADMIN_BASE}?moderated=true&profile=${GUIDE_ID}&per_page=25`));
    await waitFor(() => expect(apply()).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => expect(adminCalls(backend)).toContain(`${ADMIN_BASE}?moderated=false&profile=${GUIDE_ID}&per_page=25`));
    expect(within(screen.getByLabelText("Estado")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Todas", "Sin moderar", "Moderadas"]);
  });

  it("valida el ULID del perfil antes de consultar", async () => {
    const backend = await renderAdmin(() => Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 25 } })));
    await screen.findByText("Ninguna referencia coincide con los filtros aplicados.");
    const input = screen.getByLabelText("Perfil autor o destinatario (opcional)");
    fireEvent.change(input, { target: { value: "no-es-un-ulid" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ingresá el identificador público del perfil");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("admin-references-profile-error");
    expect(adminCalls(backend)).toEqual([`${ADMIN_BASE}?per_page=25`]);
  });

  it("oculta con motivo obligatorio, envía el body exacto y muestra el estado devuelto", async () => {
    let moderatedNow = false;
    await renderAdmin(() => Promise.resolve(jsonResponse({
      data: [moderatedNow
        ? adminReference({ moderated: true, moderation_reason: "Incluye datos personales de terceros.", moderated_at: "2026-11-10T18:00:00Z" })
        : adminReference()],
      meta: { next_cursor: null, per_page: 25 },
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Ocultar" }));

    const dialog = screen.getByRole("dialog", { name: "Ocultar la referencia por moderación" });
    expect(dialog).toHaveTextContent("Referencia de Turismo Austral sobre Guía Austral");
    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), { target: { value: "  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ocultar referencia" }));
    expect(await within(dialog).findByText(/El motivo es obligatorio/)).toBeInTheDocument();
    expect(browserMutation).not.toHaveBeenCalled();

    vi.mocked(browserMutation).mockImplementationOnce(async () => {
      moderatedNow = true;
      return jsonResponse({ data: reference({ body: HTML_BODY, moderated: true, moderation_reason: "Incluye datos personales de terceros." }) });
    });
    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), { target: { value: "  Incluye datos personales de terceros. " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ocultar referencia" }));

    expect(await screen.findByText("Cambio aplicado y listado actualizado")).toBeInTheDocument();
    const [call] = mutationCalls();
    expect(call?.url).toBe(`${ADMIN_BASE}/${REF_A}/moderate`);
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(String(call?.init.body))).toEqual({ action: "hide", reason: "Incluye datos personales de terceros." });
    expect(screen.getByText(/La referencia de «Turismo Austral» sobre «Guía Austral» quedó oculta por moderación\./)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    const card = screen.getByRole("heading", { name: "Turismo Austral → Guía Austral" }).closest("li") as HTMLElement;
    expect(card).toHaveTextContent("Moderación: Oculta por moderación");
    expect(card).toHaveTextContent("Incluye datos personales de terceros.");
    expect(within(card).getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
  });

  it("muestra un 403 del listado como falta de permisos", async () => {
    await renderAdmin(() => Promise.resolve(problem(403, "forbidden", "No tenés permisos para realizar esta acción.")));
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("No tenés permisos sobre esta información");
    expect(screen.queryByText(/Ninguna referencia coincide/)).toBeNull();
  });
});
