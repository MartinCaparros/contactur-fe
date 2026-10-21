import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AdminBackoffice } from "@/features/admin/AdminShell";
import type { AdminDocumentEntry, AdminProfileEntry, AdminUser, AuditLog } from "@/features/admin/api";
import type {
  AccessEvaluation,
  Catalogs,
  CurrentAccount,
  DocumentRecord,
  OwnedProfileSummary,
  Profile,
} from "@/features/app/api";
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

// `asyncUtilTimeout` se configura globalmente en `src/test/setup.ts`.

const ADMIN_ACTOR_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OWNER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const PROFILE_GUIDE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const PROFILE_WITHOUT_GRANT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const DOCUMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const AUDIT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const AUDIT_ID_2 = "01ARZ3NDEKTSV4RRFFQ69G5FD2";

const GUIDE_TYPE = {
  id: 7,
  code: "guide_license",
  category: "guide" as const,
  label: "Licencia de guía",
  requires_expiration: true,
  required: true,
  jurisdiction: null,
};

const DRIVER_TYPE = {
  id: 9,
  code: "driver_license",
  category: "driver" as const,
  label: "Licencia de conducir",
  requires_expiration: true,
  required: true,
  jurisdiction: null,
};

const ushuaia = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR" as const,
  timezone: "America/Argentina/Ushuaia",
};

const rioGrande = { ...ushuaia, id: 2, name: "Río Grande" };
const tolhuin = { ...ushuaia, id: 3, name: "Tolhuin" };

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

function account(): CurrentAccount {
  return {
    user: {
      id: ADMIN_ACTOR_ID,
      name: "Admin Contactur",
      email: "admin@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "admin",
      status: "active",
    },
    profiles: [],
    notification_preferences: [],
  };
}

function owner(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: OWNER_ID,
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

const capabilities = {
  can_search: true,
  can_send_contact_requests: true,
  can_publish_availability: true,
  can_receive_contact_requests: true,
  can_use_gallery: true,
  can_view_history: true,
  can_reject_pending_requests: true,
};

function profileSummary(overrides: Partial<OwnedProfileSummary> = {}): OwnedProfileSummary {
  return {
    id: PROFILE_GUIDE_ID,
    category: "guide",
    display_name: "Lucía Andina",
    status: "published",
    completed_at: "2026-02-01T12:00:00Z",
    access_state: "active",
    capabilities,
    ...overrides,
  };
}

function documentRecord(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: DOCUMENT_ID,
    profile_id: PROFILE_GUIDE_ID,
    document_type: GUIDE_TYPE,
    original_filename: "licencia-guia.pdf",
    mime_type: "application/pdf",
    size_bytes: 148_000,
    registration_number: "TF-2291",
    valid_until: "2027-05-30",
    status: "pending",
    reviewed_at: null,
    rejection_reason: null,
    uploaded_at: "2026-03-02T11:30:00Z",
    is_currently_valid: true,
    ...overrides,
  };
}

function documentEntry(overrides: Partial<DocumentRecord> = {}): AdminDocumentEntry {
  return {
    document: documentRecord(overrides),
    profile: profileSummary(),
    owner: owner(),
  };
}

function catalogs(): Catalogs {
  return {
    categories: [
      { code: "guide", name: "Guía", is_receiver: true, has_availability: true },
      { code: "driver", name: "Conductor", is_receiver: true, has_availability: true },
    ],
    cities: [ushuaia, rioGrande, tolhuin],
    services: [{ id: 1, code: "trekking", name: "Trekking" }],
    languages: [{ id: 1, code: "es", name: "Español" }],
    specialties: [{ id: 1, code: "montania", name: "Montaña" }],
    document_types: [GUIDE_TYPE, DRIVER_TYPE],
  };
}

function guideProfile(options: Readonly<{
  id?: string;
  name?: string;
  cities?: readonly typeof ushuaia[];
  primaryCity?: typeof ushuaia | null;
}> = {}): Profile {
  return {
    id: options.id ?? PROFILE_GUIDE_ID,
    category: "guide",
    display_name: options.name ?? "Lucía Andina",
    slug: "lucia-andina",
    description: "Guía de montaña habilitada",
    status: "published",
    onboarding_step: 4,
    completed_at: "2026-02-01T12:00:00Z",
    primary_city: options.primaryCity === undefined ? ushuaia : options.primaryCity,
    cities: [...(options.cities ?? [ushuaia])],
    languages: [{ id: 1, code: "es", name: "Español" }],
    services: [{ id: 1, code: "trekking", name: "Trekking" }],
    avatar: null,
    gallery: [],
    verified: true,
    guide: { education_summary: "Tecnicatura en turismo" },
    qualifications: [],
  };
}

function accessEvaluation(options: Readonly<{
  profileId?: string;
  grant?: AccessEvaluation["grant"];
  state?: AccessEvaluation["effective_state"];
}> = {}): AccessEvaluation {
  const state = options.state ?? "active";
  return {
    profile_id: options.profileId ?? PROFILE_GUIDE_ID,
    effective_state: state,
    allowed: state === "active",
    denial_code: state === "active" ? null : "subscription_required",
    grant: options.grant === undefined ? grant() : options.grant,
    capabilities,
    contact_quota: null,
    evaluated_at: "2026-03-05T12:00:00Z",
  };
}

function grant(overrides: Partial<NonNullable<AccessEvaluation["grant"]>> = {}) {
  return {
    status: "active" as const,
    starts_at: "2026-03-01T15:00:00Z",
    expires_at: "2026-12-31T15:00:00Z",
    city_limit: 3,
    monthly_contact_limit: 10,
    gallery_enabled: true,
    version: 4,
    ...overrides,
  };
}

function profileEntry(options: Readonly<{
  id?: string;
  name?: string;
  cities?: readonly typeof ushuaia[];
  primaryCity?: typeof ushuaia | null;
  grant?: AccessEvaluation["grant"];
  state?: AccessEvaluation["effective_state"];
}> = {}): AdminProfileEntry {
  const profile = guideProfile(options);
  return {
    profile,
    owner: owner(),
    access: accessEvaluation({ profileId: profile.id, grant: options.grant, state: options.state }),
  };
}

function auditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: AUDIT_ID,
    actor_user_id: ADMIN_ACTOR_ID,
    target_type: "profile",
    target_id: PROFILE_GUIDE_ID,
    action: "access_grant.replaced",
    reason: "Habilitación revisada con el titular",
    safe_changes: {
      before: null,
      after: { status: "active", city_limit: 2, gallery_enabled: true },
      removed_city_ids: [2, 3],
    },
    request_id: "req_01JCONTACTUR0001",
    created_at: "2026-03-05T12:00:00Z",
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

function card(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
}

function mutationBody(index = 0): Record<string, unknown> {
  const call = vi.mocked(browserMutation).mock.calls[index];
  if (!call) throw new Error(`Missing mutation call ${index}`);
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function rawMutationBody(index = 0): string {
  const call = vi.mocked(browserMutation).mock.calls[index];
  if (!call) throw new Error(`Missing mutation call ${index}`);
  return String((call[1] as RequestInit).body);
}

let location_: LocationStub;

beforeEach(() => {
  location_ = stubLocation("/admin/documents");
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  location_.restore();
});

/** Cola documental con catálogo real y una carga pendiente. */
function documentsFetch(
  calls: string[],
  options: Readonly<{
    entries?: readonly AdminDocumentEntry[];
    nextCursor?: string | null;
    listStatus?: number;
    listCode?: string;
    catalogsFails?: boolean;
  }> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
    if (url.includes("/catalogs")) {
      if (options.catalogsFails) {
        return Promise.resolve(apiErrorResponse(502, "backend_unavailable", "El catálogo no responde."));
      }
      return Promise.resolve(jsonResponse({
        data: catalogs(),
        meta: { next_cursor: null, per_page: 100, total: 2 },
      }));
    }
    if (url.includes("/admin/documents")) {
      calls.push(url);
      if (options.listStatus) {
        return Promise.resolve(apiErrorResponse(
          options.listStatus,
          options.listCode ?? "forbidden",
          "No tenés permisos para realizar esta acción.",
        ));
      }
      return Promise.resolve(jsonResponse({
        data: options.entries ?? [documentEntry()],
        meta: { next_cursor: options.nextCursor ?? null, per_page: 25, total: 1 },
      }));
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

describe("T11 — cola documental", () => {
  it("abre en la cola de pendientes, lo comunica y no ofrece los estados internos", async () => {
    const calls: string[] = [];
    documentsFetch(calls);

    render(<AdminBackoffice view="documents" />);
    await screen.findByRole("heading", { name: "Documentos" });
    await screen.findByText("Licencia de guía");

    expect(calls[0]).toBe("/api/backend/v1/admin/documents?per_page=25");
    expect(screen.getByText(/mientras no elijas un estado, el\s+backend devuelve solo esa cola/)).toBeInTheDocument();
    expect(screen.getByText(/Estado consultado: pendientes\./)).toBeInTheDocument();

    const statusSelect = screen.getByLabelText<HTMLSelectElement>("Estado del documento");
    const options = Array.from(statusSelect.querySelectorAll("option"));
    expect(options.map((option) => option.value)).toEqual(["", "pending", "approved", "rejected"]);
    const optionText = options.map((option) => option.textContent ?? "").join(" | ");
    expect(optionText).not.toMatch(/superseded|retired/i);
    expect(optionText).not.toMatch(/todos/i);
  });

  it("manda estado, categoría y tipo documental como query string del contrato", async () => {
    const calls: string[] = [];
    documentsFetch(calls);

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");

    fireEvent.change(screen.getByLabelText("Estado del documento"), { target: { value: "approved" } });
    fireEvent.change(screen.getByLabelText("Categoría del perfil"), { target: { value: "guide" } });
    await screen.findByRole("option", { name: /Licencia de guía · Guía/ });
    fireEvent.change(screen.getByLabelText("Tipo documental"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    const applied = new URL(calls[1], "http://localhost");
    expect(applied.pathname).toBe("/api/backend/v1/admin/documents");
    expect(Object.fromEntries(applied.searchParams)).toEqual({
      status: "approved",
      category: "guide",
      document_type_id: "7",
      per_page: "25",
    });
    expect(screen.getByText(/Estado consultado: Aprobado\./)).toBeInTheDocument();
  });

  it("no ofrece un tipo documental de otra categoría y limpia la combinación imposible", async () => {
    const calls: string[] = [];
    documentsFetch(calls);

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");
    await screen.findByRole("option", { name: /Licencia de conducir · Conductor/ });

    fireEvent.change(screen.getByLabelText("Tipo documental"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Categoría del perfil"), { target: { value: "guide" } });

    expect(screen.getByLabelText<HTMLSelectElement>("Tipo documental").value).toBe("");
    expect(screen.queryByRole("option", { name: /Licencia de conducir · Conductor/ })).toBeNull();
  });

  it("aprobar manda exactamente {action:\"approve\"} sin rejection_reason", async () => {
    documentsFetch([]);
    vi.mocked(browserMutation).mockResolvedValue(
      jsonResponse({ data: documentRecord({ status: "approved", reviewed_at: "2026-03-06T10:00:00Z" }) }),
    );

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");

    fireEvent.click(within(card(`[data-document-id="${DOCUMENT_ID}"]`))
      .getByRole("button", { name: "Aprobar documento" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Aprobar no admite motivo");
    expect(within(dialog).queryByLabelText(/Motivo/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprobar documento" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(browserMutation).mock.calls[0][0]).toBe(
      `/api/backend/v1/admin/documents/${DOCUMENT_ID}/review`,
    );
    expect(mutationBody()).toEqual({ action: "approve" });
    expect(mutationBody()).not.toHaveProperty("rejection_reason");
    expect(rawMutationBody()).toBe('{"action":"approve"}');

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("quedó en estado Aprobado");
    expect(notice).toHaveTextContent("no concede acceso");
  });

  it("rechazar exige motivo y manda {action:\"reject\", rejection_reason}", async () => {
    documentsFetch([]);
    vi.mocked(browserMutation).mockResolvedValue(
      jsonResponse({
        data: documentRecord({
          status: "rejected",
          reviewed_at: "2026-03-06T10:00:00Z",
          rejection_reason: "El archivo está ilegible",
        }),
      }),
    );

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");

    fireEvent.click(within(card(`[data-document-id="${DOCUMENT_ID}"]`))
      .getByRole("button", { name: "Rechazar documento" }));

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByLabelText("Motivo del rechazo (obligatorio)");
    expect(textarea).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar documento" }));
    expect(browserMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("El motivo es obligatorio");

    fireEvent.change(textarea, { target: { value: "  El archivo está ilegible  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar documento" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(mutationBody()).toEqual({ action: "reject", rejection_reason: "El archivo está ilegible" });
  });

  it("distingue los tres conflictos reales del backend con mensaje propio", async () => {
    const conflicts = [
      { status: 409, code: "document_not_pending", pattern: /ya no está pendiente de revisión/ },
      { status: 409, code: "document_file_unavailable", pattern: /ya no está disponible en el almacenamiento privado/ },
      { status: 422, code: "document_expired", pattern: /No se puede aprobar un documento vencido/ },
    ] as const;
    const seen: string[] = [];

    for (const conflict of conflicts) {
      documentsFetch([]);
      vi.mocked(browserMutation).mockResolvedValue(
        apiErrorResponse(conflict.status, conflict.code, `Detalle de ${conflict.code}.`),
      );

      render(<AdminBackoffice view="documents" />);
      await screen.findByText("Licencia de guía");
      fireEvent.click(within(card(`[data-document-id="${DOCUMENT_ID}"]`))
        .getByRole("button", { name: "Aprobar documento" }));
      fireEvent.click(within(screen.getByRole("dialog"))
        .getByRole("button", { name: "Aprobar documento" }));

      const alert = await within(screen.getByRole("dialog")).findByText(conflict.pattern);
      expect(alert).toHaveTextContent(`Detalle de ${conflict.code}.`);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      seen.push(alert.textContent ?? "");

      cleanup();
      vi.mocked(browserMutation).mockReset();
      vi.restoreAllMocks();
    }

    expect(new Set(seen).size).toBe(3);
    for (const text of seen) {
      expect(text).not.toMatch(/No pudimos registrar la revisión/);
    }
  });

  it("descarga por la ruta protegida y conserva el nombre original del archivo", async () => {
    const fetchMock = documentsFetch([]);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/catalogs")) {
        return Promise.resolve(jsonResponse({
          data: catalogs(),
          meta: { next_cursor: null, per_page: 100, total: 2 },
        }));
      }
      if (url.endsWith("/download")) {
        return Promise.resolve(new Response("%PDF", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }));
      }
      if (url.includes("/admin/documents")) {
        return Promise.resolve(jsonResponse({
          data: [documentEntry()],
          meta: { next_cursor: null, per_page: 25, total: 1 },
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const createObjectURL = vi.fn(() => "blob:t11-download");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");
    fireEvent.click(screen.getByRole("button", { name: "Descargar archivo" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/v1/profiles/${PROFILE_GUIDE_ID}/documents/${DOCUMENT_ID}/download`,
      { credentials: "same-origin", cache: "no-store" },
    );
    expect(downloads).toEqual(["licencia-guia.pdf"]);
  });

  it("con la variante JSON del contrato abre la url firmada y no arma un blob", async () => {
    const fetchMock = documentsFetch([]);
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/catalogs")) {
        return Promise.resolve(jsonResponse({
          data: catalogs(),
          meta: { next_cursor: null, per_page: 100, total: 2 },
        }));
      }
      if (url.endsWith("/download")) {
        return Promise.resolve(jsonResponse({
          data: {
            signed_url: "https://files.example.test/signed/licencia",
            expires_at: "2099-01-01T00:00:00Z",
          },
        }));
      }
      if (url.includes("/admin/documents")) {
        return Promise.resolve(jsonResponse({
          data: [documentEntry()],
          meta: { next_cursor: null, per_page: 25, total: 1 },
        }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const createObjectURL = vi.fn(() => "blob:no-debe-usarse");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let clickedHref = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
    });

    render(<AdminBackoffice view="documents" />);
    await screen.findByText("Licencia de guía");
    fireEvent.click(screen.getByRole("button", { name: "Descargar archivo" }));

    await waitFor(() => expect(clickedHref).toBe("https://files.example.test/signed/licencia"));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("un 403 en la cola se muestra como falta de permisos y no como cola vacía", async () => {
    documentsFetch([], { listStatus: 403 });

    render(<AdminBackoffice view="documents" />);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("No tenés permisos sobre esta información");
    expect(notice).toHaveTextContent("403");
    expect(screen.queryByText(/No hay documentos pendientes de revisión/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Aprobar documento" })).toBeNull();
  });

  it("un 401 en la cola vuelve al login conservando el destino interno", async () => {
    location_.restore();
    location_ = stubLocation("/admin/documents", "?status=approved");
    documentsFetch([], { listStatus: 401, listCode: "unauthenticated" });

    render(<AdminBackoffice view="documents" />);

    await waitFor(() => expect(location_.replaced).toContain(
      `/?auth=login&returnTo=${encodeURIComponent("/admin/documents?status=approved")}`,
    ));
  });
});

/** Perfiles con habilitación manual editable desde la tarjeta. */
function profilesFetch(
  calls: string[],
  options: Readonly<{ entries?: readonly AdminProfileEntry[]; secondPage?: readonly AdminProfileEntry[] }> = {},
) {
  let listCalls = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
    if (url.includes("/admin/profiles")) {
      calls.push(url);
      listCalls += 1;
      const entries = listCalls > 1 && options.secondPage ? options.secondPage : options.entries ?? [profileEntry()];
      return Promise.resolve(jsonResponse({
        data: entries,
        meta: { next_cursor: null, per_page: 25, total: entries.length },
      }));
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

describe("T11 — habilitación manual del perfil", () => {
  beforeEach(() => {
    location_.restore();
    location_ = stubLocation("/admin/profiles");
  });

  it("precarga el grant vigente y manda gallery_enabled booleano con la versión esperada", async () => {
    profilesFetch([]);
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      data: accessEvaluation({ grant: grant({ version: 5 }) }),
    }));

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");
    fireEvent.click(within(card(`[data-profile-id="${PROFILE_GUIDE_ID}"]`))
      .getByRole("button", { name: "Editar habilitación" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("No es un pago ni una suscripción");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Estado de la habilitación").value).toBe("active");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Habilitada desde").value).toBe("2026-03-01T12:00");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Habilitada hasta").value).toBe("2026-12-31T12:00");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Límite de ciudades").value).toBe("3");
    expect(within(dialog).getByLabelText<HTMLInputElement>("Límite mensual de solicitudes de contacto").value).toBe("10");
    expect(within(dialog).getByLabelText("Galería habilitada")).toBeChecked();
    expect(card("[data-grant-expected-version]")).toHaveAttribute("data-grant-expected-version", "4");

    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Habilitación revisada con el titular" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar habilitación" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(browserMutation).mock.calls[0][0]).toBe(
      `/api/backend/v1/admin/profiles/${PROFILE_GUIDE_ID}/access`,
    );
    expect((vi.mocked(browserMutation).mock.calls[0][1] as RequestInit).method).toBe("PUT");
    expect(mutationBody()).toEqual({
      status: "active",
      starts_at: "2026-03-01T15:00:00.000Z",
      expires_at: "2026-12-31T15:00:00.000Z",
      city_limit: 3,
      monthly_contact_limit: 10,
      gallery_enabled: true,
      expected_version: 4,
      reason: "Habilitación revisada con el titular",
    });
    expect(typeof mutationBody().gallery_enabled).toBe("boolean");
    expect(rawMutationBody()).toContain('"gallery_enabled":true');
    expect(rawMutationBody()).not.toContain('"gallery_enabled":"true"');
    expect(mutationBody()).not.toHaveProperty("cities_to_keep");

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("versión 5");
    expect(notice).toHaveTextContent("El estado del perfil no cambió: sigue en Publicado.");
  });

  it("un perfil sin habilitación registrada se administra con expected_version 0", async () => {
    profilesFetch([], {
      entries: [profileEntry({
        id: PROFILE_WITHOUT_GRANT_ID,
        name: "Bruno Paz",
        grant: null,
        state: "inactive",
      })],
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      data: accessEvaluation({
        profileId: PROFILE_WITHOUT_GRANT_ID,
        grant: grant({ version: 1, status: "inactive", starts_at: null, expires_at: null, city_limit: null, monthly_contact_limit: null, gallery_enabled: false }),
        state: "inactive",
      }),
    }));

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Bruno Paz");
    expect(card(`[data-profile-id="${PROFILE_WITHOUT_GRANT_ID}"]`)).toHaveTextContent(
      "Sin habilitación registrada (versión 0)",
    );
    fireEvent.click(within(card(`[data-profile-id="${PROFILE_WITHOUT_GRANT_ID}"]`))
      .getByRole("button", { name: "Editar habilitación" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("El perfil no tiene habilitación registrada todavía.");
    expect(card("[data-grant-expected-version]")).toHaveAttribute("data-grant-expected-version", "0");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Estado de la habilitación").value).toBe("inactive");
    expect(within(dialog).getByLabelText("Galería habilitada")).not.toBeChecked();

    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Alta manual pendiente de documentación" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar habilitación" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(mutationBody()).toEqual({
      status: "inactive",
      starts_at: null,
      expires_at: null,
      city_limit: null,
      monthly_contact_limit: null,
      gallery_enabled: false,
      expected_version: 0,
      reason: "Alta manual pendiente de documentación",
    });
  });

  it("explica el 409 stale_access_grant, ofrece releer y no reenvía a ciegas", async () => {
    const calls: string[] = [];
    profilesFetch(calls, {
      entries: [profileEntry()],
      secondPage: [profileEntry({ grant: grant({ version: 9, city_limit: 1 }) })],
    });
    vi.mocked(browserMutation).mockResolvedValue(
      apiErrorResponse(409, "stale_access_grant", "El grant fue modificado por otra operación."),
    );

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");
    fireEvent.click(within(card(`[data-profile-id="${PROFILE_GUIDE_ID}"]`))
      .getByRole("button", { name: "Editar habilitación" }));

    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Extensión acordada con el titular" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Guardar habilitación" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    const conflict = await within(screen.getByRole("dialog")).findByText(/Otra persona modificó esta habilitación/);
    expect(conflict).toHaveTextContent("el backend no aplicó ningún cambio");
    expect(conflict).toHaveTextContent("no la reenviamos con la versión nueva por tu cuenta");
    expect(card("[data-grant-expected-version]")).toHaveAttribute("data-grant-expected-version", "4");

    const callsBeforeReload = calls.length;
    fireEvent.click(within(screen.getByRole("dialog"))
      .getByRole("button", { name: "Releer la habilitación y reintentar" }));

    await waitFor(() => expect(calls.length).toBe(callsBeforeReload + 1));
    await waitFor(() => expect(card("[data-grant-expected-version]"))
      .toHaveAttribute("data-grant-expected-version", "9"));
    // Releer nunca reenvía: la mutación sigue en una sola llamada.
    expect(browserMutation).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
      "la versión vigente ahora es 9",
    );
    expect(within(screen.getByRole("dialog")).getByLabelText<HTMLInputElement>("Límite de ciudades").value).toBe("1");
  });

  it("bajar city_limit exige elegir ciudades, advierte la pérdida futura y no elige por el usuario", async () => {
    profilesFetch([], {
      entries: [profileEntry({ cities: [ushuaia, rioGrande, tolhuin], primaryCity: ushuaia })],
    });
    vi.mocked(browserMutation).mockResolvedValue(
      apiErrorResponse(422, "validation_failed", "Los datos enviados no son válidos.", {
        cities_to_keep: ["La selección supera el nuevo city_limit."],
      }),
    );

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");
    fireEvent.click(within(card(`[data-profile-id="${PROFILE_GUIDE_ID}"]`))
      .getByRole("button", { name: "Editar habilitación" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("group", { name: /Ciudades a conservar/ })).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("Límite de ciudades"), { target: { value: "1" } });

    const group = within(dialog).getByRole("group", { name: /Ciudades a conservar \(obligatorio\)/ });
    expect(group).toHaveTextContent("Las ciudades excluidas pierden sus");
    expect(group).toHaveTextContent("disponibilidades futuras");
    expect(group).toHaveTextContent("Nadie elige por vos");
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(group).toHaveTextContent("Conservás 0 de 3 ciudades");

    fireEvent.click(within(group).getByRole("checkbox", { name: /Ushuaia · ciudad principal/ }));
    expect(group).toHaveTextContent("Conservás 1 de 3 ciudades");
    expect(group).toHaveTextContent("Pierden disponibilidad futura: Río Grande, Tolhuin.");

    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Reducción acordada de cobertura" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar habilitación" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(mutationBody().cities_to_keep).toEqual([1]);
    expect(mutationBody().city_limit).toBe(1);

    const fieldError = await within(screen.getByRole("dialog"))
      .findByText("La selección supera el nuevo city_limit.");
    const freshGroup = within(screen.getByRole("dialog"))
      .getByRole("group", { name: /Ciudades a conservar/ });
    expect(fieldError.id).not.toBe("");
    expect(freshGroup.getAttribute("aria-describedby")?.split(" ")).toContain(fieldError.id);
    expect(freshGroup).toContainElement(fieldError);
  });

  it("con city_limit 0 avisa que no queda ninguna ciudad y manda una selección vacía", async () => {
    profilesFetch([], {
      entries: [profileEntry({ cities: [ushuaia, rioGrande], primaryCity: ushuaia })],
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      data: accessEvaluation({ grant: grant({ version: 5, city_limit: 0 }) }),
    }));

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");
    fireEvent.click(within(card(`[data-profile-id="${PROFILE_GUIDE_ID}"]`))
      .getByRole("button", { name: "Editar habilitación" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Límite de ciudades"), { target: { value: "0" } });
    const group = within(dialog).getByRole("group", { name: /Ciudades a conservar/ });
    expect(group).toHaveTextContent("se envía una selección vacía");
    expect(group).toHaveTextContent("Pierden disponibilidad futura: Ushuaia, Río Grande.");

    fireEvent.change(within(dialog).getByLabelText("Motivo (obligatorio)"), {
      target: { value: "Bloqueo de cobertura por revisión" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar habilitación" }));

    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(1));
    expect(mutationBody().city_limit).toBe(0);
    expect(mutationBody().cities_to_keep).toEqual([]);
  });

  it("mantiene separado el estado del perfil de la habilitación en la misma tarjeta", async () => {
    profilesFetch([]);

    render(<AdminBackoffice view="profiles" />);
    await screen.findByText("Lucía Andina");

    const profileCard = card(`[data-profile-id="${PROFILE_GUIDE_ID}"]`);
    expect(profileCard).toHaveTextContent(
      "El cambio de estado del perfil no altera el grant de acceso ni su versión.",
    );
    expect(profileCard).toHaveTextContent("Editar la habilitación es la otra acción");
    expect(profileCard).toHaveTextContent("Activo · versión 4");
    expect(within(profileCard).getByRole("button", { name: "Suspender perfil" })).toBeInTheDocument();
    expect(within(profileCard).getByRole("button", { name: "Editar habilitación" })).toBeInTheDocument();
  });
});

/** Auditoría de solo lectura. */
function auditFetch(
  calls: string[],
  options: Readonly<{ logs?: readonly AuditLog[]; nextCursor?: string | null; status?: number; code?: string; fields?: Record<string, string[]> }> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
    if (url.includes("/admin/audit-logs")) {
      calls.push(url);
      if (options.status) {
        return Promise.resolve(apiErrorResponse(
          options.status,
          options.code ?? "forbidden",
          "No tenés permisos para realizar esta acción.",
          options.fields,
        ));
      }
      if (url.includes("cursor=77")) {
        return Promise.resolve(jsonResponse({
          data: [auditLog({
            id: AUDIT_ID_2,
            action: "document.approved",
            target_type: "profile_document",
            target_id: DOCUMENT_ID,
            reason: null,
            safe_changes: {},
          })],
          meta: { next_cursor: null, per_page: 25, total: 2 },
        }));
      }
      return Promise.resolve(jsonResponse({
        data: options.logs ?? [auditLog()],
        meta: { next_cursor: options.nextCursor ?? "77", per_page: 25, total: 2 },
      }));
    }
    throw new Error(`Unexpected GET ${url}`);
  });
}

describe("T11 — auditoría", () => {
  beforeEach(() => {
    location_.restore();
    location_ = stubLocation("/admin/audit-logs");
  });

  it("combina los cuatro filtros y avanza por cursor conservándolos", async () => {
    const calls: string[] = [];
    auditFetch(calls);

    render(<AdminBackoffice view="audit-logs" />);
    await screen.findByRole("heading", { name: "Auditoría" });
    await screen.findByText("Habilitación manual reemplazada");
    expect(calls[0]).toBe("/api/backend/v1/admin/audit-logs?per_page=25");

    fireEvent.change(screen.getByLabelText("Acción"), { target: { value: " document.approved " } });
    fireEvent.change(screen.getByLabelText("Tipo de destino"), { target: { value: "profile_document" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-03-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(Object.fromEntries(new URL(calls[1], "http://localhost").searchParams)).toEqual({
      action: "document.approved",
      target_type: "profile_document",
      date_from: "2026-03-01",
      date_to: "2026-03-31",
      per_page: "25",
    });

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(Object.fromEntries(new URL(calls[2], "http://localhost").searchParams)).toEqual({
      action: "document.approved",
      target_type: "profile_document",
      date_from: "2026-03-01",
      date_to: "2026-03-31",
      cursor: "77",
      per_page: "25",
    });
    expect(await screen.findByRole("heading", { name: "Documento aprobado" })).toBeInTheDocument();
    expect(screen.getByText(/Página 2/)).toBeInTheDocument();
  });

  it("renderiza safe_changes sin asumir claves y no reemplaza los ULID por correos", async () => {
    auditFetch([], {
      nextCursor: null,
      logs: [auditLog({
        safe_changes: {
          before: null,
          after: { status: "suspended", city_limit: null, gallery_enabled: false },
          removed_city_ids: [2, 3],
          clave_futura_desconocida: { anidado: { hoja: "valor" } },
          lista_vacia: [],
        },
      })],
    });

    render(<AdminBackoffice view="audit-logs" />);
    await screen.findByRole("heading", { name: "Habilitación manual reemplazada" });
    const logCard = card(`[data-audit-id="${AUDIT_ID}"]`);

    // Claves crudas humanizadas, incluida una que la UI no conoce.
    expect(logCard).toHaveTextContent("removed city ids");
    expect(logCard).toHaveTextContent("clave futura desconocida");
    expect(logCard).toHaveTextContent("anidado");
    expect(logCard).toHaveTextContent("hoja");
    expect(logCard).toHaveTextContent("valor");
    expect(logCard).toHaveTextContent("lista vacia");
    expect(logCard).toHaveTextContent("lista vacía");
    expect(logCard).toHaveTextContent("sin valor");
    expect(logCard).toHaveTextContent("no");

    // Identificadores públicos, no datos de contacto.
    expect(logCard).toHaveTextContent(ADMIN_ACTOR_ID);
    expect(logCard).toHaveTextContent(PROFILE_GUIDE_ID);
    expect(logCard.textContent ?? "").not.toContain("@");
    expect(logCard).toHaveTextContent("req_01JCONTACTUR0001");
    expect(within(logCard).queryByRole("button")).toBeNull();
  });

  it("muestra el 422 de rango junto a su campo y vinculado por aria-describedby", async () => {
    auditFetch([], {
      status: 422,
      code: "validation_failed",
      fields: { date_to: ["La fecha final no puede ser anterior a la inicial."] },
    });

    render(<AdminBackoffice view="audit-logs" />);

    const fieldError = await screen.findByText("La fecha final no puede ser anterior a la inicial.");
    const input = screen.getByLabelText("Hasta");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(fieldError.id);
  });

  it("un 403 se muestra como falta de permisos y un 401 vuelve al login", async () => {
    auditFetch([], { status: 403 });

    render(<AdminBackoffice view="audit-logs" />);
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("No tenés permisos sobre esta información");
    expect(screen.queryByText(/Ningún evento de auditoría coincide/)).toBeNull();

    cleanup();
    vi.restoreAllMocks();
    auditFetch([], { status: 401, code: "unauthenticated" });

    render(<AdminBackoffice view="audit-logs" />);
    await waitFor(() => expect(location_.replaced).toContain(
      `/?auth=login&returnTo=${encodeURIComponent("/admin/audit-logs")}`,
    ));
  });
});
