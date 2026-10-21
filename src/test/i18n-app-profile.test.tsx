import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AvailabilityCalendar, AvailabilityView } from "@/features/app/AvailabilityCalendar";
import { AvailabilityMiniCalendar } from "@/features/app/AvailabilityMiniCalendar";
import { longDateLabel, monthTitle, shortDateLabel, weekdayShortNames } from "@/features/app/availabilityModel";
import { DocumentsPanel } from "@/features/app/DocumentsPanel";
import { NotificationsView } from "@/features/app/NotificationsView";
import {
  describeNotification,
  notificationDateText,
  relativeTimeText,
  unreadAccessibleName,
} from "@/features/app/notificationsModel";
import { CategoryFields, OnboardingPage } from "@/features/app/OnboardingPage";
import { ProfileEditor } from "@/features/app/ProfileEditor";
import type {
  AccessEvaluation,
  AppNotification,
  Catalogs,
  City,
  CurrentAccount,
  DocumentRecord,
  Profile,
  ProfileCategory,
} from "@/features/app/api";
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

const PROFILE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FC1";
const DOCUMENT_APPROVED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const DOCUMENT_REJECTED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const N1 = "01ARZ3NDEKTSV4RRFFQ69G5FN1";
const N2 = "01ARZ3NDEKTSV4RRFFQ69G5FN2";
const N3 = "01ARZ3NDEKTSV4RRFFQ69G5FN3";

const ushuaia: City = { id: 1, name: "Ushuaia", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };
const rioGrande: City = { id: 2, name: "Río Grande", province_code: "V", country_code: "AR", timezone: "America/Argentina/Ushuaia" };

const documentType = {
  id: 1,
  code: "guide_license",
  category: "guide" as const,
  label: "Credencial de guía",
  requires_expiration: true,
  required: true,
  jurisdiction: null,
};

// Los nombres del catálogo los traduce Laravel; acá llegan como datos y no se tocan.
const catalogs: Catalogs = {
  categories: [
    { code: "tourism_company", name: "Tourism company", is_receiver: false, has_availability: false },
    { code: "guide", name: "Guide", is_receiver: true, has_availability: true },
    { code: "driver", name: "Driver", is_receiver: true, has_availability: true },
    { code: "instructor", name: "Instructor", is_receiver: true, has_availability: true },
    { code: "transport_company", name: "Transport company", is_receiver: true, has_availability: true },
  ],
  cities: [ushuaia, rioGrande],
  services: [{ id: 1, code: "trekking", name: "Trekking" }],
  languages: [{ id: 1, code: "en", name: "English" }],
  specialties: [{ id: 1, code: "ski", name: "Skiing" }],
  document_types: [documentType],
};

function profile(category: ProfileCategory = "guide", overrides: Partial<Profile> = {}): Profile {
  const common = {
    id: PROFILE_ID,
    category,
    display_name: "Andes Guide",
    slug: "andes-guide",
    description: "Test profile",
    status: "published" as const,
    onboarding_step: 4,
    completed_at: "2026-10-01T12:00:00Z",
    primary_city: ushuaia,
    cities: [ushuaia, rioGrande],
    languages: catalogs.languages,
    services: catalogs.services,
    contact_email: "contact@example.test",
    phone: "+5492901000000",
    avatar: null,
    gallery: [],
    verified: false,
  };
  const value: Profile = (() => {
    switch (category) {
      case "tourism_company":
        return { ...common, category, company: { legal_name: "Austral Tours SA", years_active: 8 } };
      case "guide":
        return { ...common, category, guide: { education_summary: null }, qualifications: [] };
      case "driver":
        return { ...common, category, driver: { license_type: "D2", vehicle_type: "Minibus", vehicle_capacity: 12 } };
      case "instructor":
        return { ...common, category, instructor: { training_summary: null }, specialties: [], qualifications: [] };
      case "transport_company":
        return {
          ...common,
          category,
          transport_company: { legal_name: "Austral Transfers SA", fleet_description: null },
          fleet_vehicles: [],
        };
    }
  })();
  return { ...value, ...overrides } as Profile;
}

function access(allowed: boolean, category: ProfileCategory = "guide"): AccessEvaluation {
  const receiver = category !== "tourism_company";
  return {
    profile_id: PROFILE_ID,
    effective_state: allowed ? "active" : "inactive",
    allowed,
    denial_code: allowed ? null : "subscription_required",
    grant: null,
    capabilities: {
      can_search: allowed,
      can_send_contact_requests: allowed && !receiver,
      can_publish_availability: allowed && receiver,
      can_receive_contact_requests: allowed && receiver,
      can_use_gallery: allowed,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-11-10T12:00:00Z",
  };
}

function account(drafts: readonly Profile[] = []): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
    },
    profiles: drafts.map((value) => ({
      id: value.id,
      category: value.category,
      display_name: value.display_name,
      status: value.status,
      completed_at: value.completed_at,
      access_state: "inactive",
      capabilities: access(false).capabilities,
    })),
    notification_preferences: [],
  };
}

function documentRecord(status: DocumentRecord["status"], id: string): DocumentRecord {
  return {
    id,
    profile_id: PROFILE_ID,
    document_type: documentType,
    original_filename: `${status}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 120,
    registration_number: "GUIDE-001",
    valid_until: "2099-12-31",
    status,
    reviewed_at: "2026-03-01T12:00:00Z",
    rejection_reason: status === "rejected" ? "The image is unreadable." : null,
    uploaded_at: "2026-03-01T11:00:00Z",
    is_currently_valid: status === "approved",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function documentsResponse(documents: DocumentRecord[]): Response {
  return jsonResponse({ data: documents, meta: { next_cursor: null, per_page: 50, total: documents.length } });
}

function catalogsResponse(): Response {
  return jsonResponse({ data: catalogs, meta: { next_cursor: null, per_page: 50, total: 5 } });
}

/** Mes completo como el backend: un ítem por día, sin fila = bloqueado. */
function monthBody(month: string, available: Record<string, City>, version = 1) {
  const [year, monthNumber] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const city = available[date] ?? null;
    return { date, available: city !== null, city };
  });
  return { data: { profile_id: PROFILE_ID, month, version, days } };
}

function notification(id: string, type: string, safeData: Record<string, unknown>, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: type as AppNotification["type"],
    safe_data: safeData,
    read_at: null,
    created_at: "2026-11-10T14:00:00Z",
    ...overrides,
  };
}

function day(date: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[data-date="${date}"]`);
  if (!button) throw new Error(`Missing day ${date}`);
  return button;
}

afterEach(() => {
  cleanup();
  setLocaleCookie(null);
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("i18n app-profile — modelos", () => {
  const en = translator("en");

  it("fechas del calendario en inglés; español sigue siendo el valor por defecto", () => {
    expect(longDateLabel("2026-11-10", "en")).toBe("Tuesday 10 November");
    expect(shortDateLabel("2026-09-05", "en")).toBe("5 Sep");
    expect(monthTitle("2026-11", "en")).toBe("November 2026");
    expect(weekdayShortNames("en")).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(longDateLabel("2026-11-10")).toBe("martes 10 de noviembre");
    expect(monthTitle("2026-11")).toBe("Noviembre 2026");
  });

  it("arma avisos en inglés leyendo solo claves conocidas de safe_data como texto", () => {
    const received = describeNotification(notification(N1, "contact_request_received", {
      profile_id: PROFILE_ID,
      contact_request_id: REQUEST_ID,
      counterpart_display_name: "<b>Andes</b> Tours",
      counterpart_category: "tourism_company",
      role: "recipient",
    }), en);
    expect(received.title).toBe("New request from <b>Andes</b> Tours");
    expect(received.counterpartCategory).toBe("Tourism company");
    expect(received.description).toBe("Reply from Requests. Accepting enables contact, but it doesn't confirm a booking.");

    const rejected = describeNotification(notification(N2, "administrative_change", {
      change: "document_rejected",
      document_type: "Guide licence",
      rejection_reason: "Unreadable file",
      unknown: { html: "<script>" },
    }), en);
    expect(rejected.title).toBe("Document rejected: Guide licence");
    expect(rejected.description).toBe("Reason: Unreadable file. You can upload it again from your profile.");
    expect(describeNotification(notification(N3, "something_new", {}), en).title).toBe("New notification");
  });

  it("fecha relativa por idioma e insignia accesible", () => {
    const now = Date.parse("2026-11-10T15:00:00Z");
    expect(relativeTimeText("2026-11-10T14:59:30Z", now, "en")).toBe("just now");
    expect(notificationDateText("2026-11-10T14:00:00Z", now, "en")).toBe("1 hour ago · 10/11/2026 at 11:00 (Argentina time)");
    expect(notificationDateText("2026-11-10T14:00:00Z", now)).toBe("hace 1 hora · 10/11/2026 a las 11:00 (hora de Argentina)");
    expect(unreadAccessibleName(3, false, en)).toBe("Notifications, 3 unread");
    expect(unreadAccessibleName(20, true, en)).toBe("Notifications, more than 20 unread");
    expect(unreadAccessibleName(0, false)).toBe("Notificaciones");
  });
});

describe("i18n app-profile — alta y perfil", () => {
  it("el alta se muestra en inglés: pasos, formulario, borradores y validación local", async () => {
    window.history.replaceState({}, "", "/app/onboarding");
    const draft = profile("guide", { status: "draft", completed_at: null, onboarding_step: 1, display_name: "Draft guide" });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      throw new Error(`Unexpected GET ${url}`);
    });

    render(inLocale("en", <OnboardingPage />));

    expect(await screen.findByRole("heading", { level: 1, name: "Create a profile" })).toBeInTheDocument();
    expect(screen.getByText("Professional setup")).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Setup progress" });
    expect(within(steps).getByText("Category")).toBeInTheDocument();
    expect(within(steps).getByText("Review")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "1. Category and name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Select a category" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Saved drafts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/app");

    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText("Select a valid category from the catalogue.")).toBeInTheDocument();
  });

  it("los campos por categoría se rotulan en inglés", () => {
    render(inLocale("en", <CategoryFields profile={profile("transport_company")} catalogs={catalogs} />));
    expect(screen.getByRole("group", { name: "Transport company details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Fleet vehicles" })).toBeInTheDocument();
    expect(screen.getByLabelText("Capacity per vehicle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add vehicle" })).toBeInTheDocument();
  });

  it("el editor de perfil traduce media, galería bloqueada y el formulario", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([]));
      throw new Error(`Unexpected GET ${url}`);
    });

    render(inLocale("en", <ProfileEditor profile={profile("guide")} access={access(false)} onProfileChange={vi.fn()} />));

    expect(screen.getByRole("heading", { level: 1, name: "Edit profile" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toHaveValue("Andes Guide");
    expect(screen.getByRole("group", { name: "Cities where you work" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avatar or logo" })).toBeInTheDocument();
    expect(screen.getByLabelText("No avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("New JPEG or PNG image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update avatar" })).toBeInTheDocument();
    expect(screen.getByText("Gallery locked by your current access grant")).toBeInTheDocument();
    expect(await screen.findByText("No documents uploaded.")).toBeInTheDocument();
  });

  it("documentos: estados, fecha en en-GB, motivo de rechazo y acciones", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(documentsResponse([
      documentRecord("approved", DOCUMENT_APPROVED_ID),
      documentRecord("rejected", DOCUMENT_REJECTED_ID),
    ]));

    render(inLocale("en", <DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />));

    expect(await screen.findByRole("heading", { name: "Current documents" })).toBeInTheDocument();
    expect(screen.getByText("Status: Approved and valid · Validity: 31 Dec 2099")).toBeInTheDocument();
    expect(screen.getByText("Status: Rejected · Validity: 31 Dec 2099")).toBeInTheDocument();
    expect(screen.getByText("Reason: The image is unreadable.")).toBeInTheDocument();
    expect(screen.getByText("Required · expiry date required")).toBeInTheDocument();
    expect(screen.getByLabelText(/PDF, JPEG or PNG file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload replacement" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("documentos: un error de formato se explica en inglés", async () => {
    setLocaleCookie("en");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ unexpected: true }));

    render(inLocale("en", <DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't list the documents");
    expect(alert).toHaveTextContent("The server response wasn't in the expected format.");
    expect(screen.getByText("Not uploaded yet")).toBeInTheDocument();
  });
});

describe("i18n app-profile — disponibilidad", () => {
  // 02:30 UTC del 10/11 sigue siendo lunes 9 en Buenos Aires: "hoy" es el 9.
  const NOW = new Date("2026-11-10T02:30:00Z");

  function mockAvailability(available: Record<string, City>) {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const match = /\/availability\?month=(\d{4}-\d{2})$/.exec(url);
      if (match) return Promise.resolve(jsonResponse(monthBody(match[1] ?? "", available)));
      throw new Error(`Unexpected GET ${url}`);
    });
  }

  it("calendario: título, días, leyenda, borrador y acciones en inglés", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mockAvailability({ "2026-11-12": rioGrande });

    render(inLocale("en", <AvailabilityCalendar profile={profile("guide")} access={access(true)} />));

    expect(screen.getByRole("heading", { level: 1, name: "Availability" })).toBeInTheDocument();
    expect(screen.getByRole("grid", { name: "November 2026" })).toBeInTheDocument();
    await waitFor(() => expect(day("2026-11-10")).not.toHaveAttribute("data-state", "loading"));

    const monday = screen.getByRole("columnheader", { name: "Monday" });
    expect(monday).toHaveTextContent("Mo");
    expect(day("2026-11-09")).toHaveAccessibleName("Monday 9 November, today, blocked, not editable");
    expect(day("2026-11-09")).toHaveTextContent("TODAY");
    expect(day("2026-11-12")).toHaveAccessibleName("Thursday 12 November, available in Río Grande");
    expect(screen.getByRole("button", { name: "Next month, December 2026" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Calendar key" })).getByText("Available in Ushuaia")).toBeInTheDocument();
    expect(screen.getByText("No days selected.")).toBeInTheDocument();

    fireEvent.click(day("2026-11-10"));
    expect(screen.getByText("1 day selected.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Available in Ushuaia" }));

    const pending = screen.getByRole("region", { name: "1 unsaved change" });
    expect(within(pending).getByText("10 Nov")).toBeInTheDocument();
    expect(within(pending).getByText("Available in Ushuaia")).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Discard changes" })).toBeInTheDocument();
    expect(day("2026-11-10")).toHaveAccessibleName("Tuesday 10 November, available in Ushuaia, unsaved change");
  });

  it("solo lectura y perfil sin calendario en inglés", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mockAvailability({});

    const { unmount } = render(inLocale("en", <AvailabilityCalendar profile={profile("guide")} access={access(false)} />));
    expect(screen.getByText("Read-only calendar")).toBeInTheDocument();
    expect(screen.getByText(/Your profile doesn't have an active access grant yet\. You can view your calendar, but you can't publish changes\./))
      .toBeInTheDocument();
    expect(await screen.findByText("No availability published for November 2026.")).toBeInTheDocument();
    unmount();

    render(inLocale("en", <AvailabilityView profile={profile("tourism_company")} access={access(true, "tourism_company")} />));
    expect(screen.getByRole("heading", { level: 1, name: "No calendar for this profile" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeInTheDocument();
  });

  it("resumen de 14 días en inglés", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mockAvailability({ "2026-11-10": ushuaia });

    render(inLocale("en", <AvailabilityMiniCalendar profileId={PROFILE_ID} cities={[ushuaia, rioGrande]} />));

    const mini = screen.getByRole("region", { name: "Next 14 days" });
    expect(within(mini).getByRole("link", { name: "Edit availability" })).toBeInTheDocument();
    expect(await within(mini).findByText("1 of 14 days available from tomorrow.")).toBeInTheDocument();
    const list = within(mini).getByRole("list", { name: "Next 14 days from tomorrow" });
    expect(within(list).getByText("Tuesday 10 November, available in Ushuaia")).toBeInTheDocument();
    expect(within(list).getByText("Wednesday 11 November, blocked")).toBeInTheDocument();
  });
});

describe("i18n app-profile — notificaciones", () => {
  const NOW = new Date("2026-11-10T15:00:00Z");

  function renderCenter(items: AppNotification[]) {
    window.history.replaceState({}, "", `/app/notifications?profile=${PROFILE_ID}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (/\/notifications\?/.test(url)) {
        const unread = new URL(url, "http://x").searchParams.get("unread") === "true";
        const data = unread ? items.filter((item) => item.read_at === null) : items;
        return Promise.resolve(jsonResponse({ data, meta: { next_cursor: null, per_page: 20 } }));
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    render(inLocale("en", (
      <NotificationsView profile={profile("tourism_company")} preferences={[]} onUnreadChanged={vi.fn()} onAccountChange={vi.fn()} />
    )));
  }

  it("centro: avisos, estado de lectura, fechas y preferencias en inglés", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    renderCenter([
      notification(N1, "contact_request_received", {
        profile_id: PROFILE_ID,
        contact_request_id: REQUEST_ID,
        role: "recipient",
        counterpart_display_name: "Patagonia Treks",
        counterpart_category: "guide",
      }),
      notification(N2, "welcome", {}, { read_at: "2026-11-10T14:30:00Z" }),
      notification(N3, "administrative_change", { profile_id: PROFILE_ID, change: "access_updated" }),
    ]);

    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByText("Notifications for Andes Guide and your account. Those for your other profiles appear when you switch the active profile."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Unread" })).toHaveAttribute("aria-pressed", "false");

    const list = await screen.findByRole("list", { name: "Notifications: all" });
    expect(screen.getByText("3 notifications loaded")).toBeInTheDocument();
    const first = within(list).getByRole("article", { name: "New request from Patagonia Treks" });
    expect(first).toHaveTextContent("Profile");
    expect(first).toHaveTextContent("Guide");
    expect(first).toHaveTextContent("Unread");
    expect(first).toHaveTextContent("1 hour ago · 10/11/2026 at 11:00 (Argentina time)");
    expect(within(first).getByRole("link", { name: "View request" })).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
    const welcome = within(list).getByRole("article", { name: "Welcome to Contactur" });
    expect(welcome).toHaveTextContent("Account");
    expect(welcome).toHaveTextContent("Read");
    expect(within(list).getByRole("heading", { name: "The admin team updated your access" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Email preferences" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "When you receive a contact request" })).toBeChecked();
    expect(screen.getByText("Administrative changes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "In-platform only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeInTheDocument();
  });

  it("estado vacío del filtro de no leídas en inglés", async () => {
    renderCenter([notification(N2, "welcome", {}, { read_at: "2026-11-10T14:30:00Z" })]);
    await screen.findByRole("list", { name: "Notifications: all" });

    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(await screen.findByRole("heading", { name: "You have no unread notifications" })).toBeInTheDocument();
    expect(screen.getByText("The ones you've read are still available under “All”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(await screen.findByRole("list", { name: "Notifications: all" })).toBeInTheDocument();
  });
});
