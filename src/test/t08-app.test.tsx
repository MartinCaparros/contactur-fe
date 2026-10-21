import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";

import {
  ACTIVE_PROFILE_KEY,
  AccessPanel,
  PrivateApp,
  navigationFor,
} from "@/features/app/AppShell";
import { CategoryFields, OnboardingPage } from "@/features/app/OnboardingPage";
import {
  isAccessResponse,
  type AccessEvaluation,
  type Catalogs,
  type CurrentAccount,
  type Profile,
  type ProfileCategory,
} from "@/features/app/api";
import type { components } from "@/lib/api/generated";
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

const PROFILE_A = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const PROFILE_B = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const capabilities = {
  can_search: false,
  can_send_contact_requests: false,
  can_publish_availability: false,
  can_receive_contact_requests: false,
  can_use_gallery: false,
  can_view_history: true,
  can_reject_pending_requests: true,
};

const city = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR" as const,
  timezone: "America/Argentina/Ushuaia",
};

const catalogs: Catalogs = {
  categories: [
    { code: "tourism_company", name: "Empresa turística", is_receiver: false, has_availability: false },
    { code: "guide", name: "Guía", is_receiver: true, has_availability: true },
    { code: "driver", name: "Conductor", is_receiver: true, has_availability: true },
    { code: "instructor", name: "Instructor", is_receiver: true, has_availability: true },
    { code: "transport_company", name: "Empresa de transporte", is_receiver: true, has_availability: true },
  ],
  cities: [city],
  services: [{ id: 1, code: "trekking", name: "Trekking" }],
  languages: [{ id: 1, code: "es", name: "Español" }],
  specialties: [{ id: 1, code: "ski", name: "Esquí" }],
  document_types: [
    {
      id: 1,
      code: "required",
      category: "guide",
      label: "Credencial de guía",
      requires_expiration: true,
      required: true,
      jurisdiction: null,
    },
  ],
};

function profile(category: ProfileCategory, id = PROFILE_A, name = `Perfil ${category}`, onboardingStep = 2): Profile {
  const common = {
    id,
    category,
    display_name: name,
    slug: `perfil-${category}`,
    description: `Descripción ${name}`,
    status: "draft" as const,
    onboarding_step: onboardingStep,
    completed_at: null,
    primary_city: city,
    cities: [city],
    languages: catalogs.languages,
    services: catalogs.services,
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
      return {
        ...common,
        category,
        guide: { education_summary: "Tecnicatura en turismo" },
        qualifications: [{ title: "Guía", institution: "Instituto", completed_on: "2025-01-10", expires_on: null }],
      };
    case "driver":
      return { ...common, category, driver: { license_type: "D2", vehicle_type: "Minibús", vehicle_capacity: 12 } };
    case "instructor":
      return {
        ...common,
        category,
        instructor: { training_summary: "Instructor certificado" },
        specialties: catalogs.specialties,
        qualifications: [{ title: "Instructor", institution: "Instituto", completed_on: "2025-01-10", expires_on: null }],
      };
    case "transport_company":
      return {
        ...common,
        category,
        transport_company: { legal_name: "Traslados Australes SA", fleet_description: "Flota habilitada" },
        fleet_vehicles: [{ id: 1, vehicle_type: "Bus", quantity: 2, capacity: 40 }],
      };
  }
}

function access(
  id = PROFILE_A,
  effectiveState: AccessEvaluation["effective_state"] = "active",
): AccessEvaluation {
  const isActive = effectiveState === "active";
  return {
    profile_id: id,
    effective_state: effectiveState,
    allowed: isActive,
    denial_code: isActive
      ? null
      : effectiveState === "expired"
        ? "subscription_expired"
        : effectiveState === "suspended"
          ? "profile_suspended"
          : "subscription_required",
    grant: {
      status: effectiveState === "suspended" ? "suspended" : isActive || effectiveState === "expired" ? "active" : "inactive",
      starts_at: "2026-01-01T00:00:00Z",
      expires_at: effectiveState === "expired" ? "2026-02-01T00:00:00Z" : null,
      city_limit: null,
      monthly_contact_limit: null,
      gallery_enabled: isActive,
      version: 1,
    },
    capabilities: isActive
      ? {
          can_search: true,
          can_send_contact_requests: true,
          can_publish_availability: false,
          can_receive_contact_requests: false,
          can_use_gallery: true,
          can_view_history: true,
          can_reject_pending_requests: true,
        }
      : capabilities,
    contact_quota: null,
    evaluated_at: "2026-03-01T12:00:00Z",
  };
}

function summary(value: Profile) {
  return {
    id: value.id,
    category: value.category,
    display_name: value.display_name,
    status: value.status,
    completed_at: value.completed_at,
    access_state: "inactive" as const,
    capabilities,
  };
}

function account(profiles: Profile[] = []): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Ana Torres",
      email: "ana@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
    },
    profiles: profiles.map(summary),
    notification_preferences: [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function catalogsResponse(): Response {
  return jsonResponse({ data: catalogs, meta: { next_cursor: null, per_page: 50, total: catalogs.cities.length } });
}

function renderIsolated(ui: ReactElement) {
  return render(ui);
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("T08 — shell privado", () => {
  it("ofrece crear un perfil cuando /me no devuelve perfiles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: account() }));

    renderIsolated(<PrivateApp />);

    expect(await screen.findByRole("heading", { name: "Creá tu perfil profesional" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear perfil" })).toHaveAttribute("href", "/app/onboarding");
  });

  it("al cambiar A→B vacía A, aborta sus requests y descarta su respuesta tardía", async () => {
    const first = profile("guide", PROFILE_A, "Perfil A");
    const second = profile("driver", PROFILE_B, "Perfil B");
    let resolveProfileA: ((response: Response) => void) | undefined;
    let resolveAccessA: ((response: Response) => void) | undefined;
    const pendingProfileA = new Promise<Response>((resolve) => { resolveProfileA = resolve; });
    const pendingAccessA = new Promise<Response>((resolve) => { resolveAccessA = resolve; });
    const signals: AbortSignal[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([first, second]) }));
      if (init?.signal) signals.push(init.signal);
      if (url.endsWith(`${PROFILE_A}/access`)) return pendingAccessA;
      if (url.endsWith(PROFILE_A)) return pendingProfileA;
      if (url.endsWith(`${PROFILE_B}/access`)) return Promise.resolve(jsonResponse({ data: access(PROFILE_B) }));
      if (url.endsWith(PROFILE_B)) return Promise.resolve(jsonResponse({ data: second }));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderIsolated(<PrivateApp />);
    const selector = await screen.findByRole("combobox", { name: "Perfil activo" });
    await waitFor(() => expect(signals).toHaveLength(2));

    fireEvent.change(selector, { target: { value: PROFILE_B } });
    expect(screen.queryByText("Descripción Perfil A")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Perfil B" })).toBeInTheDocument();
    expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
    expect(window.sessionStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(PROFILE_B);
    expect(new URL(window.location.href).searchParams.get("profile")).toBe(PROFILE_B);

    resolveProfileA?.(jsonResponse({ data: first }));
    resolveAccessA?.(jsonResponse({ data: access(PROFILE_A) }));
    await Promise.all([pendingProfileA, pendingAccessA]);
    await Promise.resolve();

    expect(screen.getByRole("heading", { name: "Perfil B" })).toBeInTheDocument();
    expect(screen.queryByText("Descripción Perfil A")).not.toBeInTheDocument();
  });

  it("logout limpia la selección activa antes de completar la revocación", async () => {
    const selected = profile("guide", PROFILE_A, "Perfil para salir");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([selected]) }));
      if (url.endsWith(`${PROFILE_A}/access`)) return Promise.resolve(jsonResponse({ data: access(PROFILE_A) }));
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: selected }));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockReturnValue(new Promise<Response>(() => undefined));

    renderIsolated(<PrivateApp />);
    await screen.findByRole("heading", { name: "Perfil para salir" });
    expect(window.sessionStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(PROFILE_A);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(window.sessionStorage.getItem(ACTIVE_PROFILE_KEY)).toBeNull();
    expect(browserMutation).toHaveBeenCalledWith("/api/auth/logout");
  });

  it("ignora el 401 tardío de /me cuando el cierre de sesión ya comenzó", async () => {
    let resolveMe: ((response: Response) => void) | undefined;
    const pendingMe = new Promise<Response>((resolve) => {
      resolveMe = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingMe);
    vi.mocked(browserMutation).mockReturnValue(new Promise<Response>(() => undefined));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    renderIsolated(<PrivateApp />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/v1/me",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    ));

    const logoutButton = screen.getByRole("button", { name: "Cerrar sesión" });
    fireEvent.click(logoutButton);
    expect(browserMutation).toHaveBeenCalledWith("/api/auth/logout");
    expect(screen.getByRole("button", { name: "Cerrando…" })).toBeDisabled();

    resolveMe?.(new Response(null, { status: 401 }));
    await pendingMe;
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tu cuenta…");
    const consoleOutput = consoleError.mock.calls.flat().map(String).join("\n");
    expect(consoleOutput).not.toContain("Not implemented: navigation");
  });

  it("define menús por categoría sin tratar transporte como emisor", () => {
    const shared = ["Perfil", "Referencias", "Acceso", "Ajustes", "Notificaciones"];
    expect(navigationFor("tourism_company").map((item) => item.label)).toEqual(["Buscar", "Solicitudes", ...shared]);
    for (const category of ["guide", "driver", "instructor", "transport_company"] as const) {
      expect(navigationFor(category).map((item) => item.label)).toEqual(["Disponibilidad", "Solicitudes", ...shared]);
    }
  });

  it("usa fallback sin permisos inferidos únicamente cuando falla el endpoint de access", async () => {
    const selected = profile("guide", PROFILE_A, "Perfil sin evaluación");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([selected]) }));
      if (url.endsWith(`${PROFILE_A}/access`)) {
        return Promise.resolve(jsonResponse({
          error: { code: "backend_unavailable", message: "No se pudo evaluar el acceso." },
          request_id: "req-access",
        }, 502));
      }
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: selected }));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderIsolated(<PrivateApp view="access" />);

    expect(await screen.findByRole("heading", { name: "Acceso no disponible" })).toBeInTheDocument();
    expect(screen.getByText("No pudimos consultar el estado de acceso")).toBeInTheDocument();
    expect(screen.getByText(/No se infirió ningún permiso/)).toBeInTheDocument();
    expect(screen.queryByText(/pendiente de integración/i)).not.toBeInTheDocument();
  });
});

describe("T08 — acceso", () => {
  it.each([
    ["inactive", "Inactivo"],
    ["expired", "Vencido"],
    ["suspended", "Suspendido"],
    ["active", "Activo"],
  ] as const)("muestra estado %s, vigencia y capacidades", (state, label) => {
    renderIsolated(<AccessPanel access={access(PROFILE_A, state)} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vigencia" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Capacidades" })).toBeInTheDocument();
    expect(screen.getByText("Buscar profesionales")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/pago|precio|checkout|renovar/i);
    if (state !== "active") expect(screen.getByRole("link", { name: "Contactar soporte" })).toBeInTheDocument();
  });

  it.each([
    ["account_suspended", "suspended"],
    ["profile_suspended", "suspended"],
    ["capability_limit_reached", "active"],
  ] as const)("acepta el denial code específico %s", (denialCode, state) => {
    const response = {
      data: {
        ...access(PROFILE_A, state),
        allowed: false,
        denial_code: denialCode,
      },
    };

    expect(isAccessResponse(response)).toBe(true);
  });

  it("rechaza el denial code suspended genérico removido del contrato", () => {
    const response = {
      data: {
        ...access(PROFILE_A, "suspended"),
        denial_code: "suspended",
      },
    };

    expect(isAccessResponse(response)).toBe(false);
  });
});

describe("T08 — onboarding", () => {
  it("crea un borrador real con categoría y display_name", async () => {
    const created = profile("guide", PROFILE_A, "Lucía Andina", 1);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account() }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(jsonResponse({ error: { code: "not_found", message: "No implementado" }, request_id: "req-1" }, 404));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({ data: created }, 201));

    renderIsolated(<OnboardingPage />);
    await screen.findByRole("heading", { name: "1. Categoría y nombre" });
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "guide" } });
    fireEvent.change(screen.getByLabelText("Nombre visible"), { target: { value: "Lucía Andina" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));

    expect(await screen.findByRole("heading", { name: "2. Datos y cobertura" })).toBeInTheDocument();
    expect(browserMutation).toHaveBeenCalledWith(
      "/api/backend/v1/profiles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ category: "guide", display_name: "Lucía Andina" }),
      }),
    );
    expect(window.sessionStorage.getItem("contactur:onboarding-profile")).toBe(PROFILE_A);
  });

  it("detecta un borrador de /me y lo retoma por ULID en su paso persistido", async () => {
    const draft = profile("guide", PROFILE_A, "Guía guardada", 2);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: draft }));
      if (url.includes("/documents")) return Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 50, total: 0 } }));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderIsolated(<OnboardingPage />);
    const resumeButton = await screen.findByRole("button", { name: "Retomar" });
    fireEvent.click(resumeButton);

    expect(await screen.findByRole("heading", { name: "3. Documentación requerida" })).toBeInTheDocument();
    expect(screen.getByText("Credencial de guía")).toBeInTheDocument();
    expect(await screen.findByText("Pendiente de carga")).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("profile")).toBe(PROFILE_A);
  });

  it("muestra los campos específicos de las cinco categorías", () => {
    const cases: ReadonlyArray<readonly [ProfileCategory, RegExp[]]> = [
      ["tourism_company", [/Datos de la empresa turística/i, /Razón social/i, /Años de actividad/i]],
      ["guide", [/Datos de guía/i, /Resumen de formación/i, /Formación y calificaciones/i]],
      ["driver", [/Datos de conducción/i, /Tipo de licencia/i, /Capacidad del vehículo/i]],
      ["instructor", [/Datos de instrucción/i, /Resumen de capacitación/i, /Especialidades/i]],
      ["transport_company", [/Datos de la empresa de transporte/i, /Descripción de flota/i, /Vehículos de flota/i]],
    ];

    for (const [category, labels] of cases) {
      const view = renderIsolated(<CategoryFields profile={profile(category)} catalogs={catalogs} />);
      for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("persiste ciudades antes del PATCH y avanza con respuestas tipadas reales", async () => {
    const existing = profile("guide", PROFILE_A, "Guía nueva", 1);
    const draft: Profile = { ...existing, primary_city: null, cities: [] };
    const updated: Profile = { ...draft, onboarding_step: 2, primary_city: city, cities: [city] };
    const citiesResponse = {
      data: { profile_id: PROFILE_A, cities: [city] },
    } satisfies { data: components["schemas"]["ProfileCitiesData"] };
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_A}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: draft }));
      if (url.includes("/documents")) return Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 50, total: 0 } }));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockImplementation((path) => {
      if (path.endsWith("/cities")) return Promise.resolve(jsonResponse(citiesResponse));
      if (path.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: updated }));
      throw new Error(`Unexpected mutation ${path}`);
    });

    renderIsolated(<OnboardingPage />);
    await screen.findByRole("heading", { name: "2. Datos y cobertura" });
    fireEvent.change(screen.getByLabelText("Ciudad principal"), { target: { value: String(city.id) } });
    fireEvent.click(screen.getByRole("checkbox", { name: city.name }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));

    expect(await screen.findByRole("heading", { name: "3. Documentación requerida" })).toBeInTheDocument();
    expect(browserMutation).toHaveBeenNthCalledWith(
      1,
      `/api/backend/v1/profiles/${PROFILE_A}/cities`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ city_ids: [city.id] }) }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      2,
      `/api/backend/v1/profiles/${PROFILE_A}`,
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining(`"primary_city_id":${city.id}`) }),
    );
    expect(screen.getByText("Credencial de guía")).toBeInTheDocument();
  });

  it("vuelve a step3 ante documents, persiste la recuperación y reintenta tras terms_already_accepted", async () => {
    const draft = profile("guide", PROFILE_A, "Guía bloqueada", 4);
    const pendingDocument = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
      profile_id: PROFILE_A,
      document_type: catalogs.document_types[0],
      original_filename: "credencial.pdf",
      mime_type: "application/pdf" as const,
      size_bytes: 120,
      registration_number: null,
      valid_until: "2099-12-31",
      status: "pending" as const,
      reviewed_at: null,
      rejection_reason: null,
      uploaded_at: "2026-03-01T11:00:00Z",
      is_currently_valid: false,
    };
    const documentsError = {
      error: { code: "profile_incomplete", message: "El perfil está incompleto.", fields: { documents: ["Falta documentación requerida."] } },
      request_id: "req-complete",
    };
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_A}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: draft }));
      if (url.includes("/documents")) return Promise.resolve(jsonResponse({ data: [pendingDocument], meta: { next_cursor: null, per_page: 50, total: 1 } }));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_A, version: "demo-v1", accepted_at: "2026-03-01T12:00:00Z" } }, 201))
      .mockResolvedValueOnce(jsonResponse(documentsError, 422))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "terms_already_accepted", message: "Los términos ya fueron aceptados." },
        request_id: "req-terms-retry",
      }, 409))
      .mockResolvedValueOnce(jsonResponse(documentsError, 422));

    const firstView = renderIsolated(<OnboardingPage />);
    await screen.findByRole("heading", { name: "4. Revisión y términos" });
    expect(screen.getByRole("button", { name: "Volver a documentos" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Acepto los términos/));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y solicitar finalización" }));

    expect(await screen.findByRole("heading", { name: "3. Documentación requerida" })).toBeInTheDocument();
    expect(screen.getByText("El perfil está incompleto.")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(`contactur:onboarding-step:${PROFILE_A}`)).toBe("3");
    const continueButton = await screen.findByRole("button", { name: "Continuar a revisión" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);
    await screen.findByRole("heading", { name: "4. Revisión y términos" });
    fireEvent.click(screen.getByLabelText(/Acepto los términos/));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y solicitar finalización" }));
    await screen.findByRole("heading", { name: "3. Documentación requerida" });
    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(4));

    expect(browserMutation).toHaveBeenNthCalledWith(
      1,
      `/api/backend/v1/profiles/${PROFILE_A}/terms`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ version: "demo-v1", accepted: true }) }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      2,
      `/api/backend/v1/profiles/${PROFILE_A}/complete`,
      expect.objectContaining({ method: "POST", body: undefined }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      3,
      `/api/backend/v1/profiles/${PROFILE_A}/terms`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ version: "demo-v1", accepted: true }) }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      4,
      `/api/backend/v1/profiles/${PROFILE_A}/complete`,
      expect.objectContaining({ method: "POST", body: undefined }),
    );

    firstView.unmount();
    vi.mocked(browserMutation).mockReset();
    renderIsolated(<OnboardingPage />);
    expect(await screen.findByRole("heading", { name: "3. Documentación requerida" })).toBeInTheDocument();
  });

  it("mantiene como error cualquier otro 409 al aceptar términos", async () => {
    const draft = profile("guide", PROFILE_A, "Guía con conflicto", 3);
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_A}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: draft }));
      if (url.includes("/documents")) return Promise.resolve(jsonResponse({ data: [], meta: { next_cursor: null, per_page: 50, total: 0 } }));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      error: { code: "terms_version_conflict", message: "La versión de términos cambió." },
      request_id: "req-terms-conflict",
    }, 409));

    renderIsolated(<OnboardingPage />);
    await screen.findByRole("heading", { name: "4. Revisión y términos" });
    fireEvent.click(screen.getByLabelText(/Acepto los términos/));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y solicitar finalización" }));

    expect(await screen.findByText("La versión de términos cambió.")).toBeInTheDocument();
    expect(browserMutation).toHaveBeenCalledTimes(1);
    expect(browserMutation).not.toHaveBeenCalledWith(
      `/api/backend/v1/profiles/${PROFILE_A}/complete`,
      expect.anything(),
    );
  });
});

describe("T10 — recuperación y navegación futura", () => {
  it("mantiene Resumen, Perfil y Acceso como links y ya no muestra destinos de próximas etapas", async () => {
    const selected = profile("guide", PROFILE_A, "Perfil navegable");
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([selected]) }));
      if (url.endsWith(`${PROFILE_A}/access`)) return Promise.resolve(jsonResponse({ data: access(PROFILE_A) }));
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: selected }));
      throw new Error(`Unexpected GET ${url}`);
    });

    renderIsolated(<PrivateApp />);
    await screen.findByRole("heading", { name: "Perfil navegable" });

    expect(screen.getByRole("link", { name: "Resumen" })).toHaveAttribute("href", `/app?profile=${PROFILE_A}`);
    expect(screen.getByRole("link", { name: "Perfil" })).toHaveAttribute("href", `/app/profile?profile=${PROFILE_A}`);
    expect(screen.getByRole("link", { name: "Acceso" })).toHaveAttribute("href", `/app/access?profile=${PROFILE_A}`);
    // T13 habilitó el calendario para categorías receptoras.
    expect(screen.getByRole("link", { name: "Disponibilidad" })).toHaveAttribute("href", `/app/availability?profile=${PROFILE_A}`);
    // T18 habilitó Solicitudes para ambas ramas.
    expect(screen.getByRole("link", { name: "Solicitudes" })).toHaveAttribute("href", `/app/requests?profile=${PROFILE_A}`);
    // T19 habilitó Notificaciones para todas las categorías.
    expect(screen.getByRole("link", { name: "Notificaciones" })).toHaveAttribute("href", `/app/notifications?profile=${PROFILE_A}`);
    // T20 habilitó Referencias para todas las categorías.
    expect(screen.getByRole("link", { name: "Referencias" })).toHaveAttribute("href", `/app/references?profile=${PROFILE_A}`);
    // T21 habilitó Ajustes y retiró el renderer de destinos pendientes.
    expect(screen.getByRole("link", { name: "Ajustes" })).toHaveAttribute("href", `/app/settings?profile=${PROFILE_A}`);
    expect(screen.getByRole("link", { name: "Ajustes" })).not.toHaveAttribute("aria-disabled");
    expect(document.body).not.toHaveTextContent(/Disponible en próxima etapa/);
  });

  it("vuelve a step2 ante 422 de datos y vincula fields comunes y específicos", async () => {
    const draft = profile("guide", PROFILE_A, "Guía incompleta", 4);
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_A}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account([draft]) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.endsWith(PROFILE_A)) return Promise.resolve(jsonResponse({ data: draft }));
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_A, version: "demo-v1", accepted_at: "2026-03-01T12:00:00Z" } }, 201))
      .mockResolvedValueOnce(jsonResponse({
        error: {
          code: "profile_incomplete",
          message: "Revisá los datos del perfil.",
          fields: {
            description: ["Completá la descripción."],
            contact_email: ["Completá un contacto válido."],
            cities: ["Elegí al menos una ciudad."],
            languages: ["Elegí al menos un idioma."],
            services: ["Elegí al menos un servicio."],
            "guide.education_summary": ["Completá la formación."],
          },
        },
        request_id: "req-profile-fields",
      }, 422));

    renderIsolated(<OnboardingPage />);
    await screen.findByRole("heading", { name: "4. Revisión y términos" });
    fireEvent.click(screen.getByLabelText(/Acepto los términos/));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y solicitar finalización" }));

    expect(await screen.findByRole("heading", { name: "2. Datos y cobertura" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Descripción/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Email de contacto/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Ciudades donde trabajás" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Idiomas" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Servicios" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Resumen de formación/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Completá la formación.")).toHaveAttribute("role", "alert");
    expect(window.sessionStorage.getItem(`contactur:onboarding-step:${PROFILE_A}`)).toBe("2");
  });
});
