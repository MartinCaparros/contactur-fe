import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AdminBackoffice } from "@/features/admin/AdminShell";
import type {
  AdminMetrics,
  AdminProfileEntry,
  AdminUser,
  ProfileStatus,
} from "@/features/admin/api";
import type { AccessEvaluation, CurrentAccount, Profile } from "@/features/app/api";
import { browserMutation, readBrowserApiError } from "@/lib/browser/auth";

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

const ADMIN_ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const USER_ANA_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const USER_BRUNO_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB2";
const USER_ADMIN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
const PROFILE_PUBLISHED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const PROFILE_SUSPENDED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";

const city = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR" as const,
  timezone: "America/Argentina/Ushuaia",
};

type LocationStub = Readonly<{ replaced: string[]; restore: () => void }>;

function stubLocation(pathname: string, search = ""): LocationStub {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const replaced: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: `http://localhost${pathname}${search}`,
      origin: "http://localhost",
      pathname,
      search,
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

function account(
  overrides: Partial<CurrentAccount["user"]> = {},
): CurrentAccount {
  return {
    user: {
      id: ADMIN_ACTOR_ID,
      name: "Admin Contactur",
      email: "admin@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "admin",
      status: "active",
      ...overrides,
    },
    profiles: [],
    notification_preferences: [],
  };
}

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: USER_ANA_ID,
    name: "Ana Torres",
    email: "ana@example.test",
    email_verified_at: "2026-01-02T09:00:00Z",
    system_role: "user",
    status: "active",
    created_at: "2026-01-01T10:00:00Z",
    profile_count: 1,
    ...overrides,
  };
}

function guideProfile(options: Readonly<{
  id?: string;
  name?: string;
  status?: ProfileStatus;
  completedAt?: string | null;
  onboardingStep?: number;
}> = {}): Profile {
  return {
    id: options.id ?? PROFILE_PUBLISHED_ID,
    category: "guide",
    display_name: options.name ?? "Lucía Andina",
    slug: "lucia-andina",
    description: "Guía de montaña habilitada",
    status: options.status ?? "published",
    onboarding_step: options.onboardingStep ?? 4,
    completed_at: options.completedAt === undefined ? "2026-02-01T12:00:00Z" : options.completedAt,
    primary_city: city,
    cities: [city],
    languages: [{ id: 1, code: "es", name: "Español" }],
    services: [{ id: 1, code: "trekking", name: "Trekking" }],
    avatar: null,
    gallery: [],
    verified: true,
    guide: { education_summary: "Tecnicatura en turismo" },
    qualifications: [],
  };
}

function accessEvaluation(
  profileId: string,
  state: AccessEvaluation["effective_state"],
): AccessEvaluation {
  const active = state === "active";
  return {
    profile_id: profileId,
    effective_state: state,
    allowed: active,
    denial_code: active
      ? null
      : state === "expired"
        ? "subscription_expired"
        : state === "suspended"
          ? "profile_suspended"
          : "subscription_required",
    grant: null,
    capabilities: {
      can_search: active,
      can_send_contact_requests: active,
      can_publish_availability: false,
      can_receive_contact_requests: active,
      can_use_gallery: active,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-03-01T12:00:00Z",
  };
}

function profileEntry(options: Readonly<{
  id?: string;
  name?: string;
  status?: ProfileStatus;
  completedAt?: string | null;
  onboardingStep?: number;
  accessState?: AccessEvaluation["effective_state"];
  ownerName?: string;
}> = {}): AdminProfileEntry {
  const profile = guideProfile(options);
  return {
    profile,
    owner: adminUser({ name: options.ownerName ?? "Ana Torres" }),
    access: accessEvaluation(profile.id, options.accessState ?? "active"),
  };
}

function metrics(overrides: Partial<AdminMetrics> = {}): AdminMetrics {
  return {
    users: { active: 12, suspended: 3 },
    profiles_by_category: {
      tourism_company: 2,
      guide: 4,
      driver: 1,
      instructor: 0,
      transport_company: 1,
    },
    profiles_by_access_state: { inactive: 3, active: 4, expired: 1, suspended: 0 },
    documents_pending: 5,
    contact_requests_by_status: {},
    support_inquiries_pending: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
): Response {
  return jsonResponse(
    { error: fields ? { code, message, fields } : { code, message }, request_id: "req-t11" },
    status,
  );
}

function metricCard(metric: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-metric="${metric}"]`);
  if (!element) throw new Error(`Missing metric card ${metric}`);
  return element;
}

let location_: LocationStub;

beforeEach(() => {
  location_ = stubLocation("/admin");
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  location_.restore();
});

describe("T11 — guard de experiencia del backoffice", () => {
  it("no muestra el backoffice a una cuenta con system_role user y la devuelve al shell", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: account({ system_role: "user" }) }),
    );

    render(<AdminBackoffice view="dashboard" />);

    await waitFor(() => expect(location_.replaced).toEqual(["/app"]));
    expect(screen.queryByRole("heading", { name: "Panel administrativo" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Cuentas" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Redirigiendo…");
  });

  it("ante un 401 vuelve al login con returnTo interno", async () => {
    location_.restore();
    location_ = stubLocation("/admin/users", "?status=suspended");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiErrorResponse(401, "unauthenticated", "La sesión expiró."),
    );

    render(<AdminBackoffice view="users" />);

    await waitFor(() => expect(location_.replaced).toEqual([
      `/?auth=login&returnTo=${encodeURIComponent("/admin/users?status=suspended")}`,
    ]));
    expect(screen.queryByRole("heading", { name: "Cuentas" })).toBeNull();
  });

  it("muestra un 403 del backend como falta de permisos y no como listado vacío", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/users")) {
        return Promise.resolve(
          apiErrorResponse(403, "forbidden", "No tenés permisos para realizar esta acción."),
        );
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<AdminBackoffice view="users" />);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("No tenés permisos sobre esta información");
    expect(notice).toHaveTextContent("403");
    expect(notice).toHaveTextContent("No tenés permisos para realizar esta acción.");
    expect(screen.queryByText(/Ninguna cuenta coincide con los filtros aplicados/)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("enlaza los seis destinos implementados, incluida la moderación de referencias (T20)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/metrics")) return Promise.resolve(jsonResponse({ data: metrics() }));
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<AdminBackoffice view="dashboard" />);
    await screen.findByRole("heading", { name: "Panel administrativo" });

    const destinations: readonly (readonly [string, string])[] = [
      ["Panel", "/admin"],
      ["Cuentas", "/admin/users"],
      ["Perfiles", "/admin/profiles"],
      ["Documentos", "/admin/documents"],
      ["Referencias", "/admin/references"],
      ["Auditoría", "/admin/audit-logs"],
    ];
    const nav = screen.getByRole("complementary", { name: "Navegación del backoffice" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(destinations.map(([label]) => label));
    for (const [label, href] of destinations) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
      expect(link).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.queryByText(/Disponible en próxima etapa/)).toBeNull();
  });
});

describe("T11 — métricas", () => {
  it("informa ausencia de fuente de datos sin renderizar un 0 en esos dos KPI", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/metrics")) {
        return Promise.resolve(jsonResponse({
          data: metrics({ support_inquiries_pending: null, contact_requests_by_status: {} }),
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<AdminBackoffice view="dashboard" />);
    await screen.findByRole("heading", { name: "Panel administrativo" });
    await screen.findByRole("heading", { name: "Perfiles por categoría" });

    for (const metric of ["support_inquiries_pending", "contact_requests_by_status"]) {
      const card = metricCard(metric);
      expect(card).toHaveAttribute("data-source", "missing");
      expect(card).toHaveTextContent("Sin fuente de datos todavía");
      expect(card.textContent ?? "").not.toMatch(/\d/);
    }
    expect(metricCard("documents_pending")).toHaveTextContent("5");
  });

  it("muestra los contadores cuando la fuente de datos existe", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/metrics")) {
        return Promise.resolve(jsonResponse({
          data: metrics({
            support_inquiries_pending: 7,
            contact_requests_by_status: { pending: 4, accepted: 2 },
          }),
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<AdminBackoffice view="dashboard" />);
    await screen.findByRole("heading", { name: "Panel administrativo" });
    await screen.findByRole("heading", { name: "Perfiles por categoría" });

    const support = metricCard("support_inquiries_pending");
    expect(support).not.toHaveAttribute("data-source");
    expect(support).toHaveTextContent("7");
    expect(support).not.toHaveTextContent("Sin fuente de datos todavía");

    const contact = metricCard("contact_requests_by_status");
    expect(contact).not.toHaveAttribute("data-source");
    expect(contact).toHaveTextContent("6");
    expect(contact).toHaveTextContent("Pendientes: 4");
    expect(contact).toHaveTextContent("Aceptadas: 2");
    expect(contact).not.toHaveTextContent("pending");

    expect(metricCard("users_active")).toHaveTextContent("12");
    expect(metricCard("users_suspended")).toHaveTextContent("3");
  });

  it("aplica el rango de fechas como query string del endpoint de métricas", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/metrics")) {
        calls.push(url);
        return Promise.resolve(jsonResponse({ data: metrics() }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    render(<AdminBackoffice view="dashboard" />);
    await screen.findByRole("heading", { name: "Panel administrativo" });
    // El encabezado aparece antes de que el efecto del panel dispare la consulta:
    // esperar la llamada evita una carrera que se manifestaba bajo carga.
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toBe("/api/backend/v1/admin/metrics");

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-02-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar rango" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toBe("/api/backend/v1/admin/metrics?date_from=2026-02-01&date_to=2026-02-28");
  });
});

describe("T11 — cuentas", () => {
  function usersFetch(calls: string[], options: Readonly<{ failRefresh?: boolean }> = {}) {
    let listCalls = 0;
    return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/users")) {
        calls.push(url);
        listCalls += 1;
        if (options.failRefresh && listCalls === 2) {
          return Promise.resolve(
            apiErrorResponse(502, "backend_unavailable", "El servicio no está disponible."),
          );
        }
        if (url.includes("cursor=88")) {
          return Promise.resolve(jsonResponse({
            data: [adminUser({ id: USER_BRUNO_ID, name: "Bruno Paz", status: "suspended", profile_count: 0 })],
            meta: { next_cursor: null, per_page: 25, total: 3 },
          }));
        }
        return Promise.resolve(jsonResponse({
          data: [
            adminUser(),
            adminUser({ id: USER_ADMIN_ID, name: "Root Contactur", email: "root@example.test", system_role: "admin", profile_count: 0 }),
          ],
          meta: { next_cursor: "88", per_page: 25, total: 3 },
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
  }

  it("combina búsqueda, filtro de estado y segunda página por cursor sin ofrecer suspender una cuenta admin", async () => {
    const calls: string[] = [];
    usersFetch(calls);

    render(<AdminBackoffice view="users" />);
    await screen.findByRole("heading", { name: "Cuentas" });
    await screen.findByText("Ana Torres");

    expect(calls[0]).toBe("/api/backend/v1/admin/users?per_page=25");

    const adminRow = document.querySelector<HTMLElement>(`[data-user-id="${USER_ADMIN_ID}"]`);
    if (!adminRow) throw new Error("Missing admin row");
    expect(within(adminRow).queryByRole("button", { name: "Suspender cuenta" })).toBeNull();
    expect(adminRow).toHaveTextContent("Cuenta de administración");
    const anaRow = document.querySelector<HTMLElement>(`[data-user-id="${USER_ANA_ID}"]`);
    if (!anaRow) throw new Error("Missing Ana row");
    expect(within(anaRow).getByRole("button", { name: "Suspender cuenta" })).toBeEnabled();
    expect(anaRow).toHaveTextContent("Cuenta: Activa");

    fireEvent.change(screen.getByLabelText("Buscar por nombre o correo"), { target: { value: " ana " } });
    fireEvent.change(screen.getByLabelText("Estado de la cuenta"), { target: { value: "suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toBe("/api/backend/v1/admin/users?q=ana&status=suspended&per_page=25");

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toBe("/api/backend/v1/admin/users?q=ana&status=suspended&cursor=88&per_page=25");
    expect(await screen.findByText("Bruno Paz")).toBeInTheDocument();
    expect(screen.getByText(/Página 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });

  it("no envía la mutación con un motivo vacío o solo de espacios", async () => {
    usersFetch([]);

    render(<AdminBackoffice view="users" />);
    await screen.findByText("Ana Torres");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-user-id="${USER_ANA_ID}"]`)!,
    ).getByRole("button", { name: "Suspender cuenta" }));

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByLabelText("Motivo (obligatorio)");
    expect(textarea).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Suspender cuenta" }));
    expect(browserMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("El motivo es obligatorio");

    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspender cuenta" }));
    expect(browserMutation).not.toHaveBeenCalled();
  });

  it("manda status y reason exactos al path correcto y explica el 409 admin_account_protected", async () => {
    usersFetch([]);
    vi.mocked(browserMutation).mockResolvedValue(
      apiErrorResponse(
        409,
        "admin_account_protected",
        "Una cuenta administradora no puede suspenderse desde el backoffice.",
      ),
    );

    render(<AdminBackoffice view="users" />);
    await screen.findByText("Ana Torres");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-user-id="${USER_ANA_ID}"]`)!,
    ).getByRole("button", { name: "Suspender cuenta" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "  Revisión administrativa de seguridad  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspender cuenta" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(browserMutation).toHaveBeenCalledWith(
      `/api/backend/v1/admin/users/${USER_ANA_ID}/status`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "suspended", reason: "Revisión administrativa de seguridad" }),
      }),
    );

    const conflict = await within(screen.getByRole("dialog")).findByText(
      /El backend protege las cuentas administradoras/,
    );
    expect(conflict).toHaveTextContent("El estado de la cuenta no cambió.");
    expect(screen.queryByText(/No pudimos cambiar el estado de la cuenta/)).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("muestra el 422 de reason junto al textarea y vinculado por aria-describedby", async () => {
    usersFetch([]);
    vi.mocked(browserMutation).mockResolvedValue(
      apiErrorResponse(422, "validation_failed", "Los datos enviados no son válidos.", {
        reason: ["El motivo debe tener al menos 3 caracteres no vacíos."],
      }),
    );

    render(<AdminBackoffice view="users" />);
    await screen.findByText("Ana Torres");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-user-id="${USER_ANA_ID}"]`)!,
    ).getByRole("button", { name: "Suspender cuenta" }));

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByLabelText("Motivo (obligatorio)");
    fireEvent.change(textarea, { target: { value: "Motivo suficiente" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspender cuenta" }));

    const fieldError = await within(dialog).findByText(
      "El motivo debe tener al menos 3 caracteres no vacíos.",
    );
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(fieldError.id).not.toBe("");
    expect(textarea.getAttribute("aria-describedby")?.split(" ")).toContain(fieldError.id);
    expect(fieldError.closest("form")).toBe(textarea.closest("form"));
  });

  it("separa el éxito de la mutación del refresco fallido del listado", async () => {
    const calls: string[] = [];
    usersFetch(calls, { failRefresh: true });
    vi.mocked(browserMutation).mockResolvedValue(
      jsonResponse({ data: adminUser({ status: "suspended" }) }),
    );

    render(<AdminBackoffice view="users" />);
    await screen.findByText("Ana Torres");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-user-id="${USER_ANA_ID}"]`)!,
    ).getByRole("button", { name: "Suspender cuenta" }));

    fireEvent.change(
      within(screen.getByRole("dialog")).getByLabelText("Motivo (obligatorio)"),
      { target: { value: "Revisión administrativa" } },
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspender cuenta" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Cambio aplicado; el listado no se pudo refrescar");
    expect(notice).toHaveTextContent("La cuenta «Ana Torres» quedó en estado Suspendida.");
    expect(notice).toHaveTextContent("El cambio quedó guardado y auditado en el backend.");
    expect(notice).toHaveTextContent("no repitas la acción");
    expect(notice).not.toHaveTextContent(/no pudimos cambiar el estado/i);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar actualización del listado" }));
    await waitFor(() => expect(calls).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(
      "Cambio aplicado y listado actualizado",
    ));
  });
});

describe("T11 — perfiles", () => {
  function profilesFetch(calls: string[]) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/admin/profiles")) {
        calls.push(url);
        return Promise.resolve(jsonResponse({
          data: [
            profileEntry({ accessState: "suspended" }),
            profileEntry({
              id: PROFILE_SUSPENDED_ID,
              name: "Bruno Paz",
              status: "suspended",
              completedAt: null,
              onboardingStep: 2,
              accessState: "inactive",
              ownerName: "Bruno Paz",
            }),
          ],
          meta: { next_cursor: null, per_page: 25, total: 2 },
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
  }

  it("distingue estado del perfil de estado de acceso y combina los cuatro filtros", async () => {
    const calls: string[] = [];
    profilesFetch(calls);

    render(<AdminBackoffice view="profiles" />);
    await screen.findByRole("heading", { name: "Perfiles" });
    await screen.findByText("Lucía Andina");
    expect(calls[0]).toBe("/api/backend/v1/admin/profiles?per_page=25");

    const published = document.querySelector<HTMLElement>(`[data-profile-id="${PROFILE_PUBLISHED_ID}"]`);
    const suspended = document.querySelector<HTMLElement>(`[data-profile-id="${PROFILE_SUSPENDED_ID}"]`);
    if (!published || !suspended) throw new Error("Missing profile rows");

    // Mismo texto "Suspendido" en dos ejes distintos: el prefijo los separa.
    expect(within(published).getByText(/^Perfil: Publicado$/)).toBeInTheDocument();
    expect(within(published).getByText(/^Acceso: Suspendido$/)).toBeInTheDocument();
    expect(within(suspended).getByText(/^Perfil: Suspendido$/)).toBeInTheDocument();
    expect(within(suspended).getByText(/^Acceso: Inactivo$/)).toBeInTheDocument();
    expect(within(published).getByRole("button", { name: "Suspender perfil" })).toBeInTheDocument();
    expect(within(suspended).getByRole("button", { name: "Restaurar perfil" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Buscar por nombre"), { target: { value: "lucia" } });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "guide" } });
    fireEvent.change(screen.getByLabelText("Estado del perfil"), { target: { value: "suspended" } });
    fireEvent.change(screen.getByLabelText("Estado de acceso"), { target: { value: "expired" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    const applied = new URL(calls[1], "http://localhost");
    expect(applied.pathname).toBe("/api/backend/v1/admin/profiles");
    expect(Object.fromEntries(applied.searchParams)).toEqual({
      q: "lucia",
      category: "guide",
      status: "suspended",
      access_state: "expired",
      per_page: "25",
    });
  });

  it("al restaurar un perfil incompleto muestra el estado devuelto por el backend y lo explica", async () => {
    const calls: string[] = [];
    profilesFetch(calls);
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      data: profileEntry({
        id: PROFILE_SUSPENDED_ID,
        name: "Bruno Paz",
        status: "draft",
        completedAt: null,
        onboardingStep: 2,
        accessState: "inactive",
        ownerName: "Bruno Paz",
      }),
    }));

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Bruno Paz");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-profile-id="${PROFILE_SUSPENDED_ID}"]`)!,
    ).getByRole("button", { name: "Restaurar perfil" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Restaurar tampoco concede acceso");
    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Revisión finalizada sin hallazgos" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar perfil" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(browserMutation).toHaveBeenCalledWith(
      `/api/backend/v1/admin/profiles/${PROFILE_SUSPENDED_ID}/status`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "published", reason: "Revisión finalizada sin hallazgos" }),
      }),
    );

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("estado Borrador");
    expect(notice).toHaveTextContent("nunca completó el alta");
    expect(notice).toHaveTextContent("no se publicó");
    expect(notice).toHaveTextContent("El grant de acceso no se modificó: sigue en Inactivo.");
    expect(notice.textContent ?? "").not.toMatch(/estado Publicado/);
  });

  it("cierra el diálogo con Escape sin mutar nada", async () => {
    profilesFetch([]);

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");
    fireEvent.click(within(
      document.querySelector<HTMLElement>(`[data-profile-id="${PROFILE_PUBLISHED_ID}"]`)!,
    ).getByRole("button", { name: "Suspender perfil" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByLabelText("Motivo (obligatorio)")).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(browserMutation).not.toHaveBeenCalled();
  });
});
