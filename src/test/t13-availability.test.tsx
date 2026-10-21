import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { PrivateApp, navigationFor } from "@/features/app/AppShell";
import type { AccessEvaluation, City, CurrentAccount, Profile, ProfileCategory } from "@/features/app/api";
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

const PROFILE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const AVAILABILITY_PATH = `/api/backend/v1/profiles/${PROFILE_ID}/availability`;

const ushuaia: City = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR",
  timezone: "America/Argentina/Ushuaia",
};
const rioGrande: City = {
  id: 2,
  name: "Río Grande",
  province_code: "V",
  country_code: "AR",
  timezone: "America/Argentina/Ushuaia",
};

/**
 * 2026-11-10T02:30Z en UTC ya es martes 10, pero en Buenos Aires todavía es lunes 9:
 * "hoy" tiene que salir de la fecha local de negocio (D12), no de la UTC.
 */
const NOW = new Date("2026-11-10T02:30:00Z");

function profile(category: ProfileCategory, cities: City[] = [ushuaia, rioGrande]): Profile {
  const common = {
    id: PROFILE_ID,
    category,
    display_name: `Perfil ${category}`,
    slug: `perfil-${category}`,
    description: "Descripción de prueba",
    status: "published" as const,
    onboarding_step: 4,
    completed_at: "2026-10-01T12:00:00Z",
    primary_city: cities[0] ?? null,
    cities,
    languages: [{ id: 1, code: "es", name: "Español" }],
    services: [{ id: 1, code: "trekking", name: "Trekking" }],
    contact_email: "contacto@example.test",
    phone: "+5492901000000",
    avatar: null,
    gallery: [],
    verified: false,
  };
  switch (category) {
    case "tourism_company":
      return { ...common, category, company: { legal_name: "Turismo Austral SA", years_active: 8 } };
    case "guide":
      return { ...common, category, guide: { education_summary: "Tecnicatura" }, qualifications: [] };
    case "driver":
      return { ...common, category, driver: { license_type: "D2", vehicle_type: "Minibús", vehicle_capacity: 12 } };
    case "instructor":
      return { ...common, category, instructor: { training_summary: "Instructor" }, specialties: [], qualifications: [] };
    case "transport_company":
      return {
        ...common,
        category,
        transport_company: { legal_name: "Traslados SA", fleet_description: null },
        fleet_vehicles: [],
      };
  }
}

function access(state: "active" | "expired" = "active", category: ProfileCategory = "guide"): AccessEvaluation {
  const active = state === "active";
  const receiver = category !== "tourism_company";
  return {
    profile_id: PROFILE_ID,
    effective_state: state,
    allowed: active,
    denial_code: active ? null : "subscription_expired",
    grant: {
      status: "active",
      starts_at: "2026-01-01T00:00:00Z",
      expires_at: active ? null : "2026-11-01T00:00:00Z",
      city_limit: null,
      monthly_contact_limit: null,
      gallery_enabled: true,
      version: 1,
    },
    capabilities: {
      can_search: active,
      can_send_contact_requests: active && !receiver,
      can_publish_availability: active && receiver,
      can_receive_contact_requests: active && receiver,
      can_use_gallery: active,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-11-10T02:30:00Z",
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
      capabilities: access("active", value.category).capabilities,
    }],
    notification_preferences: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function problem(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: { code, message, ...(fields ? { fields } : {}) }, request_id: `req-${code}` }, status);
}

type ServerMonth = { version: number; available: Record<string, City> };

/** Mes completo como el backend T12: un ítem por día, sin fila = bloqueado. */
function monthBody(month: string, server: ServerMonth) {
  const [year, monthNumber] = month.split("-").map(Number);
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const city = server.available[date] ?? null;
    return { date, available: city !== null, city };
  });
  return { data: { profile_id: PROFILE_ID, month, version: server.version, days } };
}

type Backend = {
  months: Record<string, ServerMonth>;
  availabilityGets: string[];
  fetchMock: MockInstance<typeof fetch>;
};

function mockBackend(
  value: Profile,
  evaluation: AccessEvaluation,
  months: Record<string, ServerMonth> = {},
): Backend {
  const backend: Omit<Backend, "fetchMock"> = { months, availabilityGets: [] };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(value) }));
    if (url.endsWith(`${PROFILE_ID}/access`)) return Promise.resolve(jsonResponse({ data: evaluation }));
    const availability = /\/availability\?month=(\d{4}-\d{2})$/.exec(url);
    if (availability) {
      const month = availability[1];
      backend.availabilityGets.push(month);
      return Promise.resolve(jsonResponse(monthBody(month, backend.months[month] ?? { version: 0, available: {} })));
    }
    if (url.endsWith(PROFILE_ID)) return Promise.resolve(jsonResponse({ data: value }));
    throw new Error(`Unexpected GET ${url}`);
  });
  return { ...backend, fetchMock };
}

function day(date: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`button[data-date="${date}"]`);
  if (!button) throw new Error(`Missing day ${date}`);
  return button;
}

async function renderCalendar(): Promise<void> {
  render(<PrivateApp view="availability" />);
  await screen.findByRole("heading", { level: 1, name: "Disponibilidad" });
  await waitFor(() => expect(day("2026-11-10")).not.toHaveAttribute("data-state", "loading"));
}

function putBody(index = 0): unknown {
  const call = vi.mocked(browserMutation).mock.calls[index];
  if (!call) throw new Error(`Missing PUT ${index}`);
  expect(call[0]).toBe(AVAILABILITY_PATH);
  expect(call[1]?.method).toBe("PUT");
  return JSON.parse(String(call[1]?.body));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState({}, "", `/app/availability?profile=${PROFILE_ID}`);
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("T13 — menú y mini-calendario por categoría", () => {
  it("la empresa turística no tiene Disponibilidad en el menú ni mini-calendario, y no pide el calendario", async () => {
    expect(navigationFor("tourism_company").map((item) => item.label)).not.toContain("Disponibilidad");
    const company = profile("tourism_company");
    window.history.replaceState({}, "", "/app");
    const backend = mockBackend(company, access("active", "tourism_company"));

    render(<PrivateApp />);
    await screen.findByRole("heading", { level: 1, name: company.display_name });

    expect(screen.queryByRole("link", { name: /Disponibilidad/ })).toBeNull();
    expect(screen.queryByText(/Disponibilidad/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Próximos 14 días" })).toBeNull();
    expect(backend.fetchMock.mock.calls.some(([url]) => String(url).includes("/availability"))).toBe(false);
  });

  it("la empresa que abre /app/availability ve una explicación y no un calendario", async () => {
    const company = profile("tourism_company");
    const backend = mockBackend(company, access("active", "tourism_company"));

    render(<PrivateApp view="availability" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Sin calendario para este perfil" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(backend.availabilityGets).toEqual([]);
  });

  it.each(["guide", "driver", "instructor", "transport_company"] as const)(
    "%s tiene Disponibilidad como enlace real",
    (category) => {
      const item = navigationFor(category).find((entry) => entry.label === "Disponibilidad");
      expect(item).toEqual({ label: "Disponibilidad", href: "/app/availability" });
    },
  );

  it("el receptor ve el ítem en el menú y el mini-calendario vacío sin decir ocupado", async () => {
    const guide = profile("guide");
    window.history.replaceState({}, "", "/app");
    mockBackend(guide, access());

    render(<PrivateApp />);
    await screen.findByRole("heading", { level: 1, name: guide.display_name });

    expect(screen.getByRole("link", { name: "Disponibilidad" }))
      .toHaveAttribute("href", `/app/availability?profile=${PROFILE_ID}`);
    const mini = await screen.findByRole("region", { name: "Próximos 14 días" });
    expect(await within(mini).findByText("Sin disponibilidad publicada en los próximos 14 días.")).toBeInTheDocument();
    expect(mini.textContent).not.toMatch(/ocupado/i);
  });

  it("el mini-calendario muestra 14 días desde mañana leyendo los dos meses que abarca", async () => {
    // 25 de noviembre en Buenos Aires: mañana es 26/11 y el día 14 cae el 9/12.
    vi.setSystemTime(new Date("2026-11-25T15:00:00Z"));
    const guide = profile("guide");
    window.history.replaceState({}, "", "/app");
    const backend = mockBackend(guide, access(), {
      "2026-11": { version: 5, available: { "2026-11-25": ushuaia, "2026-11-27": ushuaia } },
      "2026-12": { version: 5, available: { "2026-12-03": rioGrande, "2026-12-10": ushuaia } },
    });

    render(<PrivateApp />);
    const mini = await screen.findByRole("region", { name: "Próximos 14 días" });
    const list = await within(mini).findByRole("list", { name: "Próximos 14 días desde mañana" });
    const items = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(14);
    expect(items[0]).toHaveAttribute("data-date", "2026-11-26");
    expect(items[13]).toHaveAttribute("data-date", "2026-12-09");
    expect(backend.availabilityGets.sort()).toEqual(["2026-11", "2026-12"]);
    expect(within(mini).getByText("2 de 14 días disponibles desde mañana.")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("viernes 27 de noviembre, disponible en Ushuaia");
    expect(items[7]).toHaveTextContent("jueves 3 de diciembre, disponible en Río Grande");
    expect(items[0]).toHaveTextContent("jueves 26 de noviembre, bloqueado");
    expect(within(mini).getByRole("link", { name: "Editar disponibilidad" }))
      .toHaveAttribute("href", `/app/availability?profile=${PROFILE_ID}`);
    // Solo lectura: nada interactivo dentro de la grilla compacta.
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("T13 — calendario mensual", () => {
  it("usa la fecha local de negocio: hoy y el pasado no se editan y cada día tiene aria-label completo", async () => {
    mockBackend(profile("guide"), access(), { "2026-11": { version: 3, available: { "2026-11-12": ushuaia } } });
    await renderCalendar();

    expect(screen.getByRole("grid", { name: "Noviembre 2026" })).toBeInTheDocument();
    // La semana empieza en lunes; noviembre de 2026 arranca un domingo (6 celdas vacías).
    const headers = screen.getAllByRole("columnheader");
    ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"].forEach((name, index) => {
      expect(headers[index]).toHaveAccessibleName(name);
    });
    const firstWeek = screen.getAllByRole("row")[1];
    expect(within(firstWeek).getAllByRole("button")).toHaveLength(1);
    expect(within(firstWeek).getByRole("button")).toHaveAttribute("data-date", "2026-11-01");

    const today = day("2026-11-09");
    expect(today).toHaveAccessibleName("lunes 9 de noviembre, hoy, bloqueado, no editable");
    expect(today).toHaveAttribute("aria-disabled", "true");
    expect(today).toHaveTextContent("HOY");
    const past = day("2026-11-08");
    expect(past).toHaveAccessibleName("domingo 8 de noviembre, bloqueado, no editable");
    expect(past).toHaveAttribute("aria-disabled", "true");

    const tomorrow = day("2026-11-10");
    expect(tomorrow).toHaveAccessibleName("martes 10 de noviembre, bloqueado");
    expect(tomorrow).not.toHaveAttribute("aria-disabled");
    expect(tomorrow).toHaveAttribute("aria-pressed", "false");
    expect(day("2026-11-12")).toHaveAccessibleName("jueves 12 de noviembre, disponible en Ushuaia");
    // Estado distinguible sin color: código de ciudad y glifo de bloqueado.
    expect(day("2026-11-12")).toHaveTextContent("USH");
    expect(tomorrow).toHaveTextContent("—");

    fireEvent.click(today);
    fireEvent.click(past);
    expect(today).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText("Ningún día seleccionado.")).toBeInTheDocument();
    expect(screen.queryByText(/Sin disponibilidad publicada/)).toBeNull();
  });

  it("el último día del mes abre en el mes real de hoy y el siguiente enfoca mañana", async () => {
    vi.setSystemTime(new Date("2026-11-30T15:00:00Z"));
    const backend = mockBackend(profile("guide"), access());
    render(<PrivateApp view="availability" />);

    expect(await screen.findByRole("grid", { name: "Noviembre 2026" })).toBeInTheDocument();
    await waitFor(() => expect(day("2026-11-30")).not.toHaveAttribute("data-state", "loading"));
    expect(day("2026-11-30")).toHaveAccessibleName("lunes 30 de noviembre, hoy, bloqueado, no editable");
    expect(day("2026-11-30")).toHaveAttribute("tabindex", "0");

    fireEvent.click(screen.getByRole("button", { name: "Mes siguiente, Diciembre 2026" }));
    expect(await screen.findByRole("grid", { name: "Diciembre 2026" })).toBeInTheDocument();
    await waitFor(() => expect(day("2026-12-01")).not.toHaveAttribute("data-state", "loading"));
    expect(day("2026-12-01")).toHaveAttribute("tabindex", "0");
    expect(day("2026-12-01")).not.toHaveAttribute("aria-disabled");
    expect(backend.availabilityGets).toEqual(["2026-11", "2026-12"]);
  });

  it("muestra Sin disponibilidad publicada cuando el mes no tiene días habilitados", async () => {
    mockBackend(profile("guide"), access());
    await renderCalendar();

    expect(screen.getByText("Sin disponibilidad publicada en noviembre 2026.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ocupado/i);
  });

  it("se navega con teclado: flechas, roving tabindex, Enter/Espacio, rango con Shift y cambio de mes", async () => {
    const backend = mockBackend(profile("guide"), access());
    await renderCalendar();

    const tomorrow = day("2026-11-10");
    expect(tomorrow).toHaveAttribute("tabindex", "0");
    expect(day("2026-11-11")).toHaveAttribute("tabindex", "-1");
    tomorrow.focus();

    fireEvent.keyDown(tomorrow, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(day("2026-11-11")));
    expect(day("2026-11-11")).toHaveAttribute("tabindex", "0");
    expect(tomorrow).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(day("2026-11-11"), { key: "Enter" });
    expect(day("2026-11-11")).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(day("2026-11-11"), { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(day("2026-11-18")));
    fireEvent.keyDown(day("2026-11-18"), { key: " ", shiftKey: true });
    // Rango inclusivo 11 → 18.
    expect(screen.getByText("8 días seleccionados.")).toBeInTheDocument();
    expect(day("2026-11-14")).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(day("2026-11-18"), { key: " " });
    expect(day("2026-11-18")).toHaveAttribute("aria-pressed", "false");

    // Moverse hacia hoy deja el foco en un día no editable, anunciado como tal.
    fireEvent.keyDown(day("2026-11-18"), { key: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(day("2026-11-16")));
    fireEvent.keyDown(day("2026-11-16"), { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(day("2026-11-09")));
    fireEvent.keyDown(day("2026-11-09"), { key: "Enter" });
    expect(day("2026-11-09")).not.toHaveAttribute("aria-pressed");

    fireEvent.keyDown(day("2026-11-09"), { key: "PageDown" });
    expect(await screen.findByRole("grid", { name: "Diciembre 2026" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(day("2026-12-09")));
    expect(backend.availabilityGets).toContain("2026-12");
  });

  it("la selección masiva arma el lote exacto con expected_version y available:false sin city_id", async () => {
    mockBackend(profile("guide"), access(), {
      "2026-11": { version: 3, available: { "2026-11-12": ushuaia, "2026-11-14": ushuaia } },
    });
    await renderCalendar();

    fireEvent.click(day("2026-11-10"));
    fireEvent.click(day("2026-11-12"), { shiftKey: true });
    expect(screen.getByText("3 días seleccionados.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Ciudad" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Río Grande" }));

    fireEvent.click(day("2026-11-14"));
    // 13 ya está bloqueado en el servidor: bloquearlo no agrega nada al lote.
    fireEvent.click(day("2026-11-13"));
    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));

    expect(day("2026-11-10")).toHaveAccessibleName("martes 10 de noviembre, disponible en Río Grande, cambio sin guardar");
    expect(day("2026-11-14")).toHaveAccessibleName("sábado 14 de noviembre, bloqueado, cambio sin guardar");
    expect(day("2026-11-13")).toHaveAccessibleName("viernes 13 de noviembre, bloqueado");
    expect(screen.getByRole("heading", { name: "4 cambios sin guardar" })).toBeInTheDocument();

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse(monthBody("2026-11", {
      version: 4,
      available: { "2026-11-10": rioGrande, "2026-11-11": rioGrande, "2026-11-12": rioGrande },
    })));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Guardamos 4 días. Versión del calendario: 4.")).toBeInTheDocument();
    expect(putBody()).toStrictEqual({
      expected_version: 3,
      days: [
        { date: "2026-11-10", available: true, city_id: 2 },
        { date: "2026-11-11", available: true, city_id: 2 },
        { date: "2026-11-12", available: true, city_id: 2 },
        { date: "2026-11-14", available: false },
      ],
    });
    expect(day("2026-11-10")).toHaveAccessibleName("martes 10 de noviembre, disponible en Río Grande");
    expect(day("2026-11-14")).toHaveAccessibleName("sábado 14 de noviembre, bloqueado");
    expect(screen.queryByRole("heading", { name: /sin guardar/ })).toBeNull();

    // El siguiente lote parte de la versión nueva que devolvió el PUT.
    fireEvent.click(day("2026-11-20"));
    fireEvent.change(screen.getByRole("combobox", { name: "Ciudad" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse(monthBody("2026-11", {
      version: 5,
      available: { "2026-11-10": rioGrande, "2026-11-11": rioGrande, "2026-11-12": rioGrande, "2026-11-20": ushuaia },
    })));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Guardamos 1 día. Versión del calendario: 5.")).toBeInTheDocument();
    expect(putBody(1)).toStrictEqual({
      expected_version: 4,
      days: [{ date: "2026-11-20", available: true, city_id: 1 }],
    });
  });

  it("un 422 por ítem se muestra en el día correcto y el borrador queda intacto", async () => {
    mockBackend(profile("guide"), access(), { "2026-11": { version: 2, available: {} } });
    await renderCalendar();

    fireEvent.click(day("2026-11-10"));
    fireEvent.click(day("2026-11-11"), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));
    vi.mocked(browserMutation).mockResolvedValueOnce(problem(422, "validation_failed", "Los datos enviados no son válidos.", {
      "days.1.city_id": ["La ciudad no pertenece al perfil."],
      days: ["La disponibilidad resultante usaría 2 ciudades y el límite es 1."],
    }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se guardó ningún día");
    expect(alert).toHaveTextContent("La disponibilidad resultante usaría 2 ciudades y el límite es 1.");
    expect(day("2026-11-11")).toHaveAccessibleName(
      "miércoles 11 de noviembre, disponible en Ushuaia, cambio sin guardar, error: La ciudad no pertenece al perfil.",
    );
    expect(day("2026-11-11")).toHaveAttribute("data-error", "true");
    expect(day("2026-11-10")).not.toHaveAttribute("data-error");
    expect(day("2026-11-10")).toHaveAccessibleName("martes 10 de noviembre, disponible en Ushuaia, cambio sin guardar");
    const pendingItem = document.querySelector('li[data-date="2026-11-11"]');
    expect(pendingItem).toHaveTextContent("La ciudad no pertenece al perfil.");
    expect(screen.getByRole("heading", { name: "2 cambios sin guardar" })).toBeInTheDocument();

    // Corregir el día con error limpia su marca sin tocar el resto del borrador.
    fireEvent.click(day("2026-11-11"));
    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(day("2026-11-11")).not.toHaveAttribute("data-error");
    expect(screen.getByRole("heading", { name: "1 cambio sin guardar" })).toBeInTheDocument();
  });

  it("un 409 explica el conflicto, no reenvía y recargar trae el estado nuevo conservando el borrador", async () => {
    const backend = mockBackend(profile("guide"), access(), { "2026-11": { version: 6, available: {} } });
    await renderCalendar();

    fireEvent.click(day("2026-11-10"));
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));
    vi.mocked(browserMutation).mockResolvedValueOnce(
      problem(409, "stale_availability", "El calendario cambió; recargalo antes de volver a aplicar."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Otra sesión cambió el calendario");
    expect(alert).toHaveTextContent("No guardamos ni reenviamos tus cambios");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(day("2026-11-10")).toHaveAccessibleName("martes 10 de noviembre, disponible en Ushuaia, cambio sin guardar");

    // Otra sesión publicó el 15; recargar lo trae con la versión nueva.
    backend.months["2026-11"] = { version: 7, available: { "2026-11-15": rioGrande } };
    const getsBefore = backend.availabilityGets.length;
    fireEvent.click(within(alert).getByRole("button", { name: "Recargar calendario" }));

    await waitFor(() => expect(day("2026-11-15")).toHaveAccessibleName("domingo 15 de noviembre, disponible en Río Grande"));
    expect(backend.availabilityGets.length).toBe(getsBefore + 1);
    expect(browserMutation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Otra sesión cambió el calendario")).toBeNull();
    expect(day("2026-11-10")).toHaveAccessibleName("martes 10 de noviembre, disponible en Ushuaia, cambio sin guardar");

    // Recién una acción explícita vuelve a guardar, y con la versión recargada.
    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse(monthBody("2026-11", {
      version: 8,
      available: { "2026-11-10": ushuaia, "2026-11-15": rioGrande },
    })));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Guardamos 1 día. Versión del calendario: 8.")).toBeInTheDocument();
    expect(putBody(1)).toStrictEqual({
      expected_version: 7,
      days: [{ date: "2026-11-10", available: true, city_id: 1 }],
    });
  });

  it("rollback: un error de red no aplica nada, conserva el borrador y reintentar reenvía el mismo lote", async () => {
    mockBackend(profile("guide"), access(), { "2026-11": { version: 1, available: { "2026-11-12": ushuaia } } });
    await renderCalendar();

    fireEvent.click(day("2026-11-10"));
    fireEvent.click(day("2026-11-12"));
    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(screen.getByRole("heading", { name: "1 cambio sin guardar" })).toBeInTheDocument();
    fireEvent.click(day("2026-11-11"));
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));

    vi.mocked(browserMutation).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos conectar con el servidor.");
    expect(alert).toHaveTextContent("Tu borrador sigue intacto");
    // Nada quedó aplicado a medias: el 12 sigue confirmado como disponible y el borrador marcado.
    expect(day("2026-11-12")).toHaveAccessibleName("jueves 12 de noviembre, bloqueado, cambio sin guardar");
    expect(day("2026-11-11")).toHaveAccessibleName("miércoles 11 de noviembre, disponible en Ushuaia, cambio sin guardar");
    expect(screen.getByRole("heading", { name: "2 cambios sin guardar" })).toBeInTheDocument();

    vi.mocked(browserMutation).mockResolvedValueOnce(jsonResponse(monthBody("2026-11", {
      version: 2,
      available: { "2026-11-11": ushuaia },
    })));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar guardado" }));
    expect(await screen.findByText("Guardamos 2 días. Versión del calendario: 2.")).toBeInTheDocument();
    expect(putBody(1)).toStrictEqual(putBody(0));
    expect(putBody(1)).toStrictEqual({
      expected_version: 1,
      days: [
        { date: "2026-11-11", available: true, city_id: 1 },
        { date: "2026-11-12", available: false },
      ],
    });
  });

  it("sin acceso vigente muestra el calendario en solo lectura con enlace a Acceso", async () => {
    mockBackend(profile("guide"), access("expired"), { "2026-11": { version: 4, available: { "2026-11-12": ushuaia } } });
    await renderCalendar();

    const notice = screen.getByText("Calendario en solo lectura").closest("div");
    expect(notice).toHaveTextContent("La vigencia de tu habilitación finalizó.");
    expect(within(notice as HTMLElement).getByRole("link", { name: "Ver estado de acceso" }))
      .toHaveAttribute("href", `/app/access?profile=${PROFILE_ID}`);
    expect(day("2026-11-12")).toHaveAccessibleName("jueves 12 de noviembre, disponible en Ushuaia, solo lectura");
    expect(day("2026-11-10")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(day("2026-11-10"));
    expect(day("2026-11-10")).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByRole("button", { name: /Disponible en/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
  });

  it("un 403 de acceso al guardar pasa a solo lectura sin perder el borrador", async () => {
    mockBackend(profile("guide"), access(), { "2026-11": { version: 4, available: {} } });
    await renderCalendar();

    fireEvent.click(day("2026-11-10"));
    fireEvent.click(screen.getByRole("button", { name: "Disponible en Ushuaia" }));
    vi.mocked(browserMutation).mockResolvedValueOnce(
      problem(403, "subscription_expired", "La habilitación del perfil está vencida."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Calendario en solo lectura");
    expect(alert).toHaveTextContent("La vigencia de tu habilitación finalizó.");
    expect(alert).toHaveTextContent("Tu borrador no se guardó y sigue en esta pantalla.");
    expect(within(alert).getByRole("link", { name: "Ver estado de acceso" }))
      .toHaveAttribute("href", `/app/access?profile=${PROFILE_ID}`);
    expect(screen.getByRole("heading", { name: "1 cambio sin guardar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
    expect(day("2026-11-11")).toHaveAttribute("aria-disabled", "true");
  });

  it("sin ciudades en el perfil explica que primero hay que cargarlas", async () => {
    mockBackend(profile("transport_company", []), access("active", "transport_company"));
    await renderCalendar();

    expect(screen.getByText("Primero cargá tus ciudades")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cargar ciudades en el perfil" }))
      .toHaveAttribute("href", `/app/profile?profile=${PROFILE_ID}`);
    expect(day("2026-11-10")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Bloquear" })).toBeNull();
  });
});
