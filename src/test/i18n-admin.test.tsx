import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AdminBackoffice, type AdminView } from "@/features/admin/AdminShell";
import {
  type AdminDocumentEntry,
  type AdminMetrics,
  type AdminProfileEntry,
  type AdminReferenceEntry,
  type AdminUser,
  type AuditLog,
  auditActionLabel,
  categoryLabel,
  formatBusinessDateTime,
  formatDateTime,
} from "@/features/admin/api";
import type { AccessEvaluation, CurrentAccount, Profile, SafeProfile } from "@/features/app/api";
import { browserMutation, readBrowserApiError } from "@/lib/browser/auth";
import { translator } from "@/lib/i18n/translate";

import { inLocale, setLocaleCookie } from "./i18n";

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

/**
 * Backoffice en inglés: el shell y los seis paneles con `inLocale("en")` y la cookie en
 * inglés (los mensajes que se arman fuera del render la leen). El español ya lo cubren
 * `t11-admin*.test.tsx`, `t20` y `t21` sin wrapper.
 */

const ADMIN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const PROFILE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const DOCUMENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const AUDIT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD1";
const AUDIT_UNKNOWN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FD2";
const REFERENCE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FE1";
const COMPANY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FF1";
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FG1";

const ushuaia = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR" as const,
  timezone: "America/Argentina/Ushuaia",
};
const rioGrande = { ...ushuaia, id: 2, name: "Río Grande" };
const tolhuin = { ...ushuaia, id: 3, name: "Tolhuin" };

const GUIDE_TYPE = {
  id: 7,
  code: "guide_license",
  category: "guide" as const,
  label: "Guide licence",
  requires_expiration: true,
  required: true,
  jurisdiction: null,
};

const capabilities = {
  can_search: true,
  can_send_contact_requests: true,
  can_publish_availability: true,
  can_receive_contact_requests: true,
  can_use_gallery: true,
  can_view_history: true,
  can_reject_pending_requests: true,
};

type LocationStub = Readonly<{ replaced: string[]; restore: () => void }>;

function stubLocation(pathname: string): LocationStub {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const replaced: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: `http://localhost${pathname}`,
      origin: "http://localhost",
      protocol: "http:",
      pathname,
      search: "",
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

function account(overrides: Partial<CurrentAccount["user"]> = {}): CurrentAccount {
  return {
    user: {
      id: ADMIN_ID,
      name: "Admin Contactur",
      email: "admin@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "admin",
      status: "active",
      // La cuenta ya eligió inglés: al cargar `/me` el idioma de la cuenta no cambia nada.
      locale: "en",
      ...overrides,
    },
    profiles: [],
    notification_preferences: [],
  };
}

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: USER_ID,
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

function profile(): Profile {
  return {
    id: PROFILE_ID,
    category: "guide",
    display_name: "Lucía Andina",
    slug: "lucia-andina",
    description: "Guía de montaña habilitada",
    status: "published",
    onboarding_step: 4,
    completed_at: "2026-02-01T12:00:00Z",
    primary_city: ushuaia,
    cities: [ushuaia, rioGrande, tolhuin],
    languages: [{ id: 1, code: "es", name: "Spanish" }],
    services: [{ id: 1, code: "trekking", name: "Trekking" }],
    avatar: null,
    gallery: [],
    verified: true,
    guide: { education_summary: "Tecnicatura en turismo" },
    qualifications: [],
  };
}

function profileEntry(): AdminProfileEntry {
  return {
    profile: profile(),
    owner: adminUser(),
    access: {
      profile_id: PROFILE_ID,
      effective_state: "suspended",
      allowed: false,
      denial_code: "profile_suspended",
      grant: grant(),
      capabilities,
      contact_quota: null,
      evaluated_at: "2026-03-05T12:00:00Z",
    },
  };
}

function documentEntry(): AdminDocumentEntry {
  return {
    document: {
      id: DOCUMENT_ID,
      profile_id: PROFILE_ID,
      document_type: GUIDE_TYPE,
      original_filename: "licence.pdf",
      mime_type: "application/pdf",
      size_bytes: 148_000,
      registration_number: null,
      valid_until: "2027-05-30",
      status: "pending",
      reviewed_at: null,
      rejection_reason: null,
      uploaded_at: "2026-03-02T11:30:00Z",
      is_currently_valid: true,
    },
    profile: {
      id: PROFILE_ID,
      category: "guide",
      display_name: "Lucía Andina",
      status: "published",
      completed_at: "2026-02-01T12:00:00Z",
      access_state: "active",
      capabilities,
    },
    owner: adminUser(),
  };
}

function metrics(): AdminMetrics {
  return {
    users: { active: 12, suspended: 3 },
    profiles_by_category: { tourism_company: 2, guide: 4, driver: 1, instructor: 0, transport_company: 1 },
    profiles_by_access_state: { inactive: 3, active: 4, expired: 1, suspended: 0 },
    documents_pending: 5,
    contact_requests_by_status: { pending: 4, rejected: 2 },
    support_inquiries_pending: null,
  };
}

function auditLog(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: AUDIT_ID,
    actor_user_id: ADMIN_ID,
    target_type: "profile",
    target_id: PROFILE_ID,
    action: "access_grant.replaced",
    reason: null,
    safe_changes: { before: null, after: { gallery_enabled: true }, removed_city_ids: [] },
    request_id: "req_01JCONTACTUR0001",
    created_at: "2026-03-05T12:00:00Z",
    ...overrides,
  };
}

function party(id: string, name: string, category: "guide" | "tourism_company"): SafeProfile {
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
    : { ...base, category, category_details: { education_summary: null } };
}

function adminReference(): AdminReferenceEntry {
  return {
    id: REFERENCE_ID,
    contact_request_id: REQUEST_ID,
    author: party(COMPANY_ID, "Turismo Austral", "tourism_company"),
    subject: party(PROFILE_ID, "Lucía Andina", "guide"),
    body: "Impeccable coordination throughout the trip.",
    visibility: "visible",
    moderated: false,
    moderation_reason: null,
    created_at: "2026-11-10T02:30:00Z",
    moderated_at: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function apiErrorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message }, request_id: "req-i18n-admin" }, status);
}

function page(data: readonly unknown[], total: number | null = data.length) {
  return { data, meta: { next_cursor: null, per_page: 25, total } };
}

type Handler = (url: string) => Response;

/** `/me` responde siempre la cuenta admin; cada test responde su endpoint. */
function mockBackend(handler: Handler, user: CurrentAccount = account()) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: user }));
    return Promise.resolve(handler(url));
  });
}

function renderAdmin(view: AdminView) {
  return render(inLocale("en", <AdminBackoffice view={view} />));
}

const en = translator("en");

let location_: LocationStub;

beforeEach(() => {
  location_ = stubLocation("/admin");
  setLocaleCookie("en");
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  location_.restore();
  setLocaleCookie(null);
  document.documentElement.lang = "es";
});

describe("i18n admin — helpers de api.ts", () => {
  it("traducen con t/locale y sin argumentos siguen devolviendo español", () => {
    expect(categoryLabel("guide", en)).toBe("Guide");
    expect(categoryLabel("guide")).toBe("Guía");
    expect(auditActionLabel("reference.hidden", en)).toBe("Reference hidden by moderation");
    expect(auditActionLabel("reference.hidden")).toBe("Referencia ocultada por moderación");
    // Una acción nueva del backend no tiene rótulo: la UI muestra el código crudo.
    expect(auditActionLabel("future.action", en)).toBeNull();

    const value = "2026-03-05T12:00:00Z";
    const english = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    expect(formatDateTime(value, "en")).toBe(english);
    expect(formatDateTime(null, "en")).toBe("No date");
    expect(formatDateTime(null)).toBe("Sin fecha");
    expect(formatBusinessDateTime("2026-12-31T15:00:00Z", "en")).toMatch(/^31 Dec 2026, 12:00 \(Argentina time\)$/);
    expect(formatBusinessDateTime("2026-12-31T15:00:00Z")).toMatch(/\(hora de Argentina\)$/);
  });
});

describe("i18n admin — shell y métricas", () => {
  it("header, navegación y panel administrativo en inglés", async () => {
    mockBackend((url) => {
      if (url.includes("/admin/metrics")) return jsonResponse({ data: metrics() });
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("dashboard");

    expect(screen.getByRole("status")).toHaveTextContent("Checking your account…");
    expect(await screen.findByRole("heading", { level: 1, name: "Admin dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Back office", { selector: "header span" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Contactur" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();

    const nav = screen.getByRole("complementary", { name: "Back office navigation" });
    expect(within(nav).getByText("Admin")).toBeInTheDocument();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Accounts",
      "Profiles",
      "Documents",
      "References",
      "Audit log",
    ]);
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await screen.findByRole("heading", { name: "Profiles by category" });
    expect(screen.getByRole("button", { name: "Apply range" })).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveAttribute("type", "date");
    expect(screen.getByRole("heading", { name: "Active accounts" })).toBeInTheDocument();

    const contact = document.querySelector<HTMLElement>('[data-metric="contact_requests_by_status"]');
    expect(contact).toHaveTextContent("Contact requests");
    expect(contact).toHaveTextContent("Pending: 4 · Declined: 2");
    const support = document.querySelector<HTMLElement>('[data-metric="support_inquiries_pending"]');
    expect(support).toHaveTextContent("Unanswered support enquiries");
    expect(support).toHaveTextContent("No data source yet");
    expect(support?.textContent ?? "").not.toMatch(/\d/);

    const categories = screen.getByRole("article", { name: "Profiles by category" });
    expect(within(categories).getByText("Tourism company")).toBeInTheDocument();
    expect(within(categories).getByText("Guide")).toBeInTheDocument();
    const access = screen.getByRole("article", { name: "Profiles by access state" });
    expect(within(access).getByText("Inactive")).toBeInTheDocument();
    expect(within(access).getByText("Expired")).toBeInTheDocument();
  });

  it("cuenta admin suspendida: vista restringida en inglés", async () => {
    mockBackend((url) => {
      throw new Error(`Unexpected GET ${url}`);
    }, account({ status: "suspended" }));

    renderAdmin("dashboard");

    expect(await screen.findByRole("heading", { name: "The back office is restricted" })).toBeInTheDocument();
    expect(screen.getByText("Account suspended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/#contacto");
  });

  it("un 403 se explica como falta de permisos, en inglés", async () => {
    mockBackend((url) => {
      if (url.includes("/admin/metrics")) return apiErrorResponse(403, "forbidden", "This action is unauthorized.");
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("dashboard");

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("You don't have permission to view this information");
    expect(notice).toHaveTextContent("The backend returned 403 for this admin request.");
    expect(notice).toHaveTextContent("This action is unauthorized.");
  });
});

describe("i18n admin — cuentas", () => {
  it("listado, paginación, validación del motivo y resultado de la mutación en inglés", async () => {
    let listCalls = 0;
    mockBackend((url) => {
      if (url.includes("/admin/users")) {
        listCalls += 1;
        return jsonResponse(page(listCalls === 1 ? [adminUser()] : [adminUser({ status: "suspended" })], 3));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({ data: adminUser({ status: "suspended" }) }));

    renderAdmin("users");

    expect(await screen.findByRole("heading", { level: 1, name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Account filters" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search by name or email")).toBeInTheDocument();
    const status = screen.getByLabelText<HTMLSelectElement>("Account status");
    expect(Array.from(status.options).map((option) => option.textContent)).toEqual(["All statuses", "Active", "Suspended"]);

    const row = await screen.findByText("Ana Torres").then((name) => name.closest("li") as HTMLElement);
    expect(row).toHaveTextContent("Account: Active");
    expect(row).toHaveTextContent("System role");
    expect(row).toHaveTextContent("User");
    const created = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date("2026-01-01T10:00:00Z"));
    expect(row).toHaveTextContent(created);
    expect(created).toMatch(/Jan 2026/);

    expect(screen.getByText("Accounts on this page: 1.")).toBeInTheDocument();
    const pagination = screen.getByRole("navigation", { name: "Cursor pagination" });
    expect(pagination).toHaveTextContent("Page 1 · Records on screen: 1 · 3 in total · last page");
    expect(within(pagination).getByRole("button", { name: "Next page" })).toBeDisabled();

    fireEvent.click(within(row).getByRole("button", { name: "Suspend account" }));
    const dialog = screen.getByRole("dialog", { name: "Suspend the account" });
    expect(dialog).toHaveTextContent("The account keeps its data");
    const textarea = within(dialog).getByLabelText("Reason (required)");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend account" }));
    expect(browserMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A reason is required and needs at least 3 characters.");

    fireEvent.change(textarea, { target: { value: "Security review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend account" }));

    const notice = await screen.findByRole("status");
    await waitFor(() => expect(notice).toHaveTextContent("Change applied and list refreshed"));
    expect(notice).toHaveTextContent("The account “Ana Torres” is now Suspended. The reason was recorded in the audit log.");
  });

  it("estado vacío y error de formato del cliente en inglés", async () => {
    mockBackend((url) => {
      if (url.includes("/admin/users?q=nadie")) return jsonResponse(page([]));
      if (url.includes("/admin/users")) return jsonResponse({ data: "no es una lista" });
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("users");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't list the accounts");
    expect(alert).toHaveTextContent("The server response wasn't in the expected format.");

    fireEvent.change(screen.getByLabelText("Search by name or email"), { target: { value: "nadie" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText("No accounts match the applied filters.")).toBeInTheDocument();
  });
});

describe("i18n admin — perfiles y habilitación", () => {
  it("tarjeta y diálogo de habilitación con fechas en hora de Argentina", async () => {
    mockBackend((url) => {
      if (url.includes("/admin/profiles")) return jsonResponse(page([profileEntry()]));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("profiles");

    expect(await screen.findByRole("heading", { level: 1, name: "Profiles" })).toBeInTheDocument();
    const card = await screen.findByText("Lucía Andina").then((name) => name.closest("li") as HTMLElement);
    expect(within(card).getByText(/^Profile: Published$/)).toBeInTheDocument();
    expect(within(card).getByText(/^Access: Suspended$/)).toBeInTheDocument();
    expect(card).toHaveTextContent("Active · version 4 · until 31 Dec 2026, 12:00 (Argentina time)");
    expect(card).toHaveTextContent("Cities: 3 · Requests per month: 10 · Gallery: enabled");
    expect(card).toHaveTextContent("Document verification");
    expect(card).toHaveTextContent("Verified");
    expect(within(card).getByRole("button", { name: "Suspend profile" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Edit access grant" }));
    const dialog = screen.getByRole("dialog", { name: "Edit the manual access grant" });
    expect(dialog).toHaveTextContent("Lucía Andina · Guide · owner Ana Torres");
    expect(dialog).toHaveTextContent("It isn't a payment or a subscription");
    expect(dialog).toHaveTextContent("Active · from 1 Mar 2026, 12:00 (Argentina time) · until 31 Dec 2026, 12:00 (Argentina time)");
    expect(within(dialog).getByLabelText<HTMLSelectElement>("Access grant status").value).toBe("active");
    expect(dialog).toHaveTextContent("Up to 3 cities.");
    expect(dialog).toHaveTextContent("Up to 10 requests per month.");
    expect(within(dialog).getByLabelText("Gallery enabled")).toBeChecked();

    fireEvent.change(within(dialog).getByLabelText("City limit"), { target: { value: "1" } });
    const group = within(dialog).getByRole("group", { name: "Cities to keep (required)" });
    expect(group).toHaveTextContent("The new limit is below the profile's 3 current cities");
    expect(group).toHaveTextContent("You're keeping 0 of 3 cities; the new limit allows up to 1.");
    fireEvent.click(within(group).getByRole("checkbox", { name: "Ushuaia · main city" }));
    expect(group).toHaveTextContent("Losing future availability: Río Grande, Tolhuin.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save access grant" }));
    expect(browserMutation).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/A reason is required/)).toBeInTheDocument();
  });
});

describe("i18n admin — cola documental", () => {
  it("filtros, tarjeta, diálogo de aprobación y conflicto del backend en inglés", async () => {
    mockBackend((url) => {
      if (url.includes("/catalogs")) {
        return jsonResponse({
          data: { categories: [], cities: [], services: [], languages: [], specialties: [], document_types: [GUIDE_TYPE] },
          meta: { next_cursor: null, per_page: 100, total: 1 },
        });
      }
      if (url.includes("/admin/documents")) return jsonResponse(page([documentEntry()]));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(
      apiErrorResponse(409, "document_not_pending", "The document has already been reviewed."),
    );

    renderAdmin("documents");

    expect(await screen.findByRole("heading", { level: 1, name: "Documents" })).toBeInTheDocument();
    const statusSelect = screen.getByLabelText<HTMLSelectElement>("Document status");
    expect(Array.from(statusSelect.options).map((option) => option.textContent)).toEqual([
      "Pending (backend default)",
      "Pending review",
      "Approved",
      "Rejected",
    ]);
    expect(await screen.findByRole("option", { name: "Guide licence · Guide" })).toBeInTheDocument();
    expect(screen.getByText(/Status queried: pending\./)).toBeInTheDocument();
    expect(screen.getByText("Documents on this page: 1.")).toBeInTheDocument();

    const card = document.querySelector<HTMLElement>(`[data-document-id="${DOCUMENT_ID}"]`);
    if (!card) throw new Error("Missing document card");
    expect(card).toHaveTextContent("Document: Pending review");
    expect(card).toHaveTextContent("Required · expiry date required");
    expect(card).toHaveTextContent("30 May 2027 · valid");
    expect(card).toHaveTextContent("No number declared");
    expect(card).toHaveTextContent("Not reviewed");
    expect(within(card).getByRole("button", { name: "Download file" })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Approve document" }));
    const dialog = screen.getByRole("dialog", { name: "Approve the document" });
    expect(dialog).toHaveTextContent("Declared validity: 30 May 2027 · valid.");
    expect(dialog).toHaveTextContent("Approving takes no reason, so none is sent.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve document" }));

    const conflict = await within(dialog).findByText(/The document is no longer pending review/);
    expect(conflict).toHaveTextContent("The backend replied: The document has already been reviewed.");
  });
});

describe("i18n admin — referencias", () => {
  it("moderación de referencias en inglés", async () => {
    location_.restore();
    location_ = stubLocation("/admin/references");
    mockBackend((url) => {
      if (url.includes("/admin/references")) return jsonResponse(page([adminReference()]));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("references");

    expect(await screen.findByRole("heading", { level: 1, name: "References" })).toBeInTheDocument();
    const card = await screen.findByText("Impeccable coordination throughout the trip.")
      .then((body) => body.closest("li") as HTMLElement);
    expect(card).toHaveTextContent("Moderation: Not moderated");
    expect(card).toHaveTextContent("Visibility: Published by the recipient");
    expect(card).toHaveTextContent("Turismo Austral · Tourism company");
    expect(screen.getByText("Status queried: All.")).toBeInTheDocument();

    const filter = screen.getByLabelText<HTMLSelectElement>("Status");
    expect(Array.from(filter.options).map((option) => option.textContent)).toEqual(["All", "Not moderated", "Moderated"]);

    fireEvent.change(screen.getByLabelText("Author or recipient profile (optional)"), { target: { value: "no-ulid" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    expect(await screen.findByText(/Enter the profile's public identifier/)).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: "Hide" }));
    const dialog = screen.getByRole("dialog", { name: "Hide the reference through moderation" });
    expect(dialog).toHaveTextContent("Reference from Turismo Austral about Lucía Andina");
    expect(within(dialog).getByRole("button", { name: "Hide reference" })).toBeInTheDocument();
  });
});

describe("i18n admin — auditoría", () => {
  it("rótulos traducidos, código crudo para acciones nuevas y cambios registrados", async () => {
    location_.restore();
    location_ = stubLocation("/admin/audit-logs");
    mockBackend((url) => {
      if (url.includes("/admin/audit-logs")) {
        return jsonResponse(page([
          auditLog(),
          auditLog({ id: AUDIT_UNKNOWN_ID, action: "future.action", target_type: "future_target", safe_changes: {} }),
        ]));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    renderAdmin("audit-logs");

    expect(await screen.findByRole("heading", { level: 1, name: "Audit log" })).toBeInTheDocument();
    const known = await screen.findByRole("heading", { level: 3, name: "Access grant replaced" })
      .then((heading) => heading.closest("li") as HTMLElement);
    expect(known).toHaveTextContent("Target · Profile");
    expect(known).toHaveTextContent("Actor (public identifier)");
    expect(known).toHaveTextContent("No reason recorded");
    expect(known).toHaveTextContent("Recorded changes");
    expect(known).toHaveTextContent("no value");
    expect(known).toHaveTextContent("yes");
    expect(known).toHaveTextContent("empty list");

    // Sin rótulo para la acción ni el destino: se muestran los códigos tal cual llegaron.
    const unknown = screen.getByRole("heading", { level: 3, name: "future.action" }).closest("li") as HTMLElement;
    expect(unknown).toHaveTextContent("future_target");
    expect(unknown).toHaveTextContent("The event didn't record detailed changes.");

    expect(screen.getByLabelText("Action")).toBeInTheDocument();
    const target = screen.getByLabelText<HTMLSelectElement>("Target type");
    expect(Array.from(target.options).map((option) => option.textContent)).toEqual([
      "All targets",
      "Account",
      "Profile",
      "Profile document",
      "Profile gallery",
      "Reference",
    ]);
    expect(screen.getByText("Events on this page: 2.")).toBeInTheDocument();
  });
});
