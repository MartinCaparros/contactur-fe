import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AccessPanel, PrivateApp, navigationFor } from "@/features/app/AppShell";
import type { AccessEvaluation, CurrentAccount, Profile } from "@/features/app/api";
import { ConfirmDialog } from "@/features/app/ConfirmDialog";
import { dashboardMetricViews, formatMetricValue } from "@/features/app/dashboardModel";
import { browserMutation } from "@/lib/browser/auth";
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

const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const COMPANY_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const ushuaia = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR" as const, timezone: "America/Argentina/Ushuaia" };

const company: Profile = {
  id: COMPANY_ID,
  category: "tourism_company",
  display_name: "Turismo Austral",
  slug: "turismo-austral",
  description: null,
  status: "draft",
  onboarding_step: 3,
  completed_at: null,
  primary_city: ushuaia,
  cities: [ushuaia],
  languages: [],
  services: [],
  contact_email: "propio@example.test",
  phone: null,
  avatar: null,
  gallery: [],
  verified: false,
  company: { legal_name: "Turismo Austral SA", years_active: 8 },
};

function access(overrides: Partial<AccessEvaluation> = {}): AccessEvaluation {
  return {
    profile_id: COMPANY_ID,
    effective_state: "active",
    allowed: true,
    denial_code: null,
    grant: {
      status: "active",
      starts_at: "2026-01-15T12:00:00Z",
      expires_at: null,
      city_limit: null,
      monthly_contact_limit: 10,
      gallery_enabled: true,
      version: 1,
    },
    capabilities: {
      can_search: true,
      can_send_contact_requests: true,
      can_publish_availability: false,
      can_receive_contact_requests: false,
      can_use_gallery: true,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: { month_start: "2026-11-01", used: 3, limit: 10, remaining: 7 },
    evaluated_at: "2026-11-10T15:00:00Z",
    ...overrides,
  };
}

function account(profiles: readonly Profile[], user: Partial<CurrentAccount["user"]> = {}): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: null,
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
      capabilities: access().capabilities,
    })),
    notification_preferences: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function dashboardBody(metrics: Readonly<Record<string, number>>) {
  const evaluation = access();
  return {
    data: {
      profile_id: COMPANY_ID,
      metrics: Object.entries(metrics).map(([key, value]) => ({ key, value })),
      capabilities: evaluation.capabilities,
      access: evaluation,
    },
  };
}

type Routes = Readonly<{
  me?: () => Response;
  dashboard?: () => Response;
}>;

function mockBackend(profiles: readonly Profile[], routes: Routes = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(routes.me?.() ?? jsonResponse({ data: account(profiles) }));
    if (url.includes("/notifications?")) return Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 20 } }));
    if (url.endsWith(`/profiles/${COMPANY_ID}/dashboard`)) {
      return Promise.resolve(routes.dashboard?.() ?? jsonResponse(dashboardBody({ pending_contact_requests: 1234 })));
    }
    if (url.endsWith(`/profiles/${COMPANY_ID}/access`)) return Promise.resolve(jsonResponse({ data: access() }));
    if (url.endsWith(`/profiles/${COMPANY_ID}`)) return Promise.resolve(jsonResponse({ data: company }));
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
});

afterEach(() => {
  cleanup();
  setLocaleCookie(null);
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("i18n app-core — shell en inglés", () => {
  it("header, menú, resumen e indicadores del perfil activo", async () => {
    window.history.replaceState({}, "", `/app?profile=${COMPANY_ID}`);
    mockBackend([company]);
    render(inLocale("en", <PrivateApp />));

    expect(await screen.findByRole("heading", { level: 1, name: "Turismo Austral" })).toBeInTheDocument();
    const banner = screen.getByRole("banner");
    expect(within(banner).getByRole("link", { name: "Go to Contactur" })).toHaveAttribute("href", "/");
    expect(within(banner).getByRole("combobox", { name: "Active profile" })).toHaveDisplayValue("Turismo Austral · Tourism company");
    expect(within(banner).getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Log out" })).toBeEnabled();

    const nav = screen.getByRole("complementary", { name: "Profile navigation" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent?.trim()))
      .toEqual(["Dashboard", "Search", "Requests", "Profile", "References", "Access", "Settings", "Notifications"]);
    expect(within(nav).getByRole("link", { name: "Notifications" }))
      .toHaveAttribute("href", `/app/notifications?profile=${COMPANY_ID}`);

    expect(screen.getByText("Complete your profile details to introduce yourself to the professional network.")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Setup step 3 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your profile is still a draft" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume setup" })).toHaveAttribute("href", `/app/onboarding?profile=${COMPANY_ID}`);

    const metrics = screen.getByRole("region", { name: "Profile metrics" });
    const card = await within(metrics).findByRole("term");
    expect(card).toHaveTextContent("Pending requests");
    // en-GB: separador de miles con coma (es-AR usa punto).
    expect(within(metrics).getAllByRole("definition")[0]).toHaveTextContent("1,234");
    expect(within(metrics).getByRole("link", { name: "View pending requests" }))
      .toHaveAttribute("href", `/app/requests?profile=${COMPANY_ID}&status=pending`);
  });

  it("un error de los indicadores se explica en inglés con Try again", async () => {
    window.history.replaceState({}, "", `/app?profile=${COMPANY_ID}`);
    mockBackend([company], { dashboard: () => new Response(null, { status: 500 }) });
    render(inLocale("en", <PrivateApp />));

    const metrics = await screen.findByRole("region", { name: "Profile metrics" });
    const alert = await within(metrics).findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load the metrics");
    expect(alert).toHaveTextContent("Try again in a few seconds. The rest of the dashboard is still available.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("si /me falla muestra el error en inglés, también el mensaje fijo del cliente", async () => {
    setLocaleCookie("en");
    mockBackend([], { me: () => new Response(null, { status: 502 }) });
    render(inLocale("en", <PrivateApp />));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "We couldn't open your account" })).toBeInTheDocument();
    expect(alert).toHaveTextContent("We couldn't load the requested data.");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("cuenta sin perfiles y cuenta suspendida", async () => {
    mockBackend([]);
    render(inLocale("en", <PrivateApp />));
    expect(await screen.findByRole("heading", { name: "Create your professional profile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create profile" })).toHaveAttribute("href", "/app/onboarding");
    cleanup();
    vi.restoreAllMocks();

    mockBackend([company], { me: () => jsonResponse({ data: account([company], { status: "suspended" }) }) });
    render(inLocale("en", <PrivateApp />));
    expect(await screen.findByRole("heading", { level: 1, name: "Your access is restricted" })).toBeInTheDocument();
    expect(screen.getByText("Account suspended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/#contacto");
  });

  it("los rótulos de navigationFor siguen siendo el texto fuente (se traducen al mostrarlos)", () => {
    expect(navigationFor("guide").map((item) => item.label))
      .toEqual(["Disponibilidad", "Solicitudes", "Perfil", "Referencias", "Acceso", "Ajustes", "Notificaciones"]);
  });
});

describe("i18n app-core — acceso en inglés", () => {
  it("estado, vigencia con fecha en-GB, capacidades y cuota", () => {
    render(inLocale("en", <AccessPanel access={access()} />));
    expect(screen.getByRole("heading", { level: 1, name: "Profile access" })).toBeInTheDocument();
    expect(screen.getByText("Effective status")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Validity" })).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["From", "To", "Evaluated"]);
    expect(screen.getByText("No expiry date set")).toBeInTheDocument();
    const startsAt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date("2026-01-15T12:00:00Z"));
    expect(screen.getByText(startsAt)).toBeInTheDocument();
    expect(startsAt).toMatch(/Jan 2026/);
    expect(screen.getByRole("heading", { name: "Capabilities" })).toBeInTheDocument();
    expect(screen.getByText("Search professionals")).toBeInTheDocument();
    expect(screen.getByText("Decline pending requests")).toBeInTheDocument();
    expect(screen.getByText("3 used · 7 available")).toBeInTheDocument();
  });

  it("perfil vencido: funciones restringidas y contacto con soporte", () => {
    render(inLocale("en", (
      <AccessPanel
        access={access({
          effective_state: "expired",
          allowed: false,
          denial_code: "subscription_expired",
          contact_quota: { month_start: "2026-11-01", used: 0, limit: null, remaining: null },
        })}
      />
    )));
    expect(screen.getByText("Expired")).toBeInTheDocument();
    const notice = screen.getByRole("status");
    expect(within(notice).getByRole("heading", { name: "Restricted features" })).toBeInTheDocument();
    expect(notice).toHaveTextContent("The validity period has ended.");
    expect(notice).toHaveTextContent("Capabilities blocked right now: 2.");
    expect(within(notice).getByRole("link", { name: "Contact support" })).toBeInTheDocument();
    expect(screen.getByText("0 used · no limit set")).toBeInTheDocument();
  });
});

describe("i18n app-core — ajustes en inglés", () => {
  it("secciones, rótulos y validación del cliente", async () => {
    window.history.replaceState({}, "", `/app/settings?profile=${COMPANY_ID}`);
    mockBackend([company]);
    render(inLocale("en", <PrivateApp view="settings" />));

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/These settings belong to your account and apply to all your profiles/)).toBeInTheDocument();

    const accountSection = screen.getByRole("region", { name: "Account details" });
    expect(within(accountSection).getByText("Current email")).toBeInTheDocument();
    expect(within(accountSection).getByText("Email not verified")).toBeInTheDocument();
    const accountForm = screen.getByRole("form", { name: "Account details" });
    fireEvent.change(within(accountForm).getByLabelText("Name"), { target: { value: "A" } });
    fireEvent.click(within(accountForm).getByRole("button", { name: "Save name" }));
    expect(await within(accountForm).findByText("Enter a name between 2 and 120 characters long.")).toBeInTheDocument();

    const emailForm = screen.getByRole("form", { name: "Change email" });
    expect(within(emailForm).getByLabelText("New email")).toBeInTheDocument();
    fireEvent.click(within(emailForm).getByRole("button", { name: "Send confirmation link" }));
    expect(await within(emailForm).findByText("Enter the new email.")).toBeInTheDocument();
    expect(within(emailForm).getByText("Enter your current password.")).toBeInTheDocument();

    const passwordForm = screen.getByRole("form", { name: "Change password" });
    expect(within(passwordForm).getByText("Between 12 and 128 characters.")).toBeInTheDocument();
    fireEvent.change(within(passwordForm).getByLabelText("Current password"), { target: { value: "Actual-2026" } });
    fireEvent.change(within(passwordForm).getByLabelText("New password"), { target: { value: "corta" } });
    fireEvent.change(within(passwordForm).getByLabelText("Repeat the new password"), { target: { value: "otra" } });
    fireEvent.click(within(passwordForm).getByRole("button", { name: "Change password" }));
    expect(await within(passwordForm).findByText("The new password must be between 12 and 128 characters long.")).toBeInTheDocument();
    expect(within(passwordForm).getByText("The confirmation doesn't match the new password.")).toBeInTheDocument();
    expect(browserMutation).not.toHaveBeenCalled();
  });

  it("un 429 se explica en inglés", async () => {
    window.history.replaceState({}, "", `/app/settings?profile=${COMPANY_ID}`);
    mockBackend([company]);
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      error: { code: "too_many_requests", message: "Too many requests." },
      request_id: "req-429",
    }, 429));
    render(inLocale("en", <PrivateApp view="settings" />));

    const form = await screen.findByRole("form", { name: "Account details" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Ana María Torres" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save name" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Too many attempts in a row. Wait a moment and try again.");
  });
});

describe("i18n app-core — diálogo y modelo del resumen", () => {
  it("ConfirmDialog traduce sus botones propios", () => {
    const { rerender } = render(inLocale("en", (
      <ConfirmDialog
        title="Cancel request"
        subject="Guía Austral"
        description="The request will be cancelled."
        confirmLabel="Cancel request"
        pending={false}
        error={null}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />
    )));
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    rerender(inLocale("en", (
      <ConfirmDialog
        title="Cancel request"
        subject="Guía Austral"
        description="The request will be cancelled."
        confirmLabel="Cancel request"
        pending
        error={null}
        onConfirm={() => undefined}
        onClose={() => undefined}
      />
    )));
    expect(screen.getByRole("button", { name: "Processing…" })).toBeDisabled();
  });

  it("dashboardMetricViews y formatMetricValue: inglés con t/locale, español por defecto", () => {
    const metrics = [{ key: "available_future_days", value: 12500 }];
    expect(dashboardMetricViews(metrics, COMPANY_ID, translator("en"))[0]).toMatchObject({
      label: "Upcoming available days",
      hint: "Dates published from tomorrow onwards.",
      linkLabel: "View availability",
    });
    expect(dashboardMetricViews(metrics, COMPANY_ID)[0]?.label).toBe("Días disponibles a futuro");
    expect(formatMetricValue(12500, "en")).toBe("12,500");
    expect(formatMetricValue(12500)).toBe("12.500");
  });
});
