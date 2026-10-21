import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DocumentsPanel } from "@/features/app/DocumentsPanel";
import { CategoryFields, OnboardingPage } from "@/features/app/OnboardingPage";
import { ProfileEditor } from "@/features/app/ProfileEditor";
import { persistProfileData } from "@/features/app/profilePersistence";
import { ACTIVE_PROFILE_KEY } from "@/features/app/session";
import type {
  AccessEvaluation,
  Catalogs,
  CurrentAccount,
  DocumentRecord,
  Profile,
  ProfileCategory,
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

const PROFILE_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const DOCUMENT_PENDING_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAZ";
const DOCUMENT_APPROVED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB0";
const DOCUMENT_REJECTED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB1";
const USER_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const MEDIA_ID = "01ARZ3NDEKTSV4RRFFQ69G5FB2";

const city = {
  id: 1,
  name: "Ushuaia",
  province_code: "V",
  country_code: "AR" as const,
  timezone: "America/Argentina/Ushuaia",
};
const secondCity = {
  id: 2,
  name: "El Calafate",
  province_code: "Z",
  country_code: "AR" as const,
  timezone: "America/Argentina/Rio_Gallegos",
};

const documentType = {
  id: 1,
  code: "guide_license",
  category: "guide" as const,
  label: "Credencial de guía",
  requires_expiration: true,
  required: true,
  jurisdiction: null,
};

const catalogs: Catalogs = {
  categories: [
    { code: "tourism_company", name: "Empresa turística", is_receiver: false, has_availability: false },
    { code: "guide", name: "Guía", is_receiver: true, has_availability: true },
    { code: "driver", name: "Conductor", is_receiver: true, has_availability: true },
    { code: "instructor", name: "Instructor", is_receiver: true, has_availability: true },
    { code: "transport_company", name: "Empresa de transporte", is_receiver: true, has_availability: true },
  ],
  cities: [city, secondCity],
  services: [{ id: 1, code: "trekking", name: "Trekking" }],
  languages: [{ id: 1, code: "es", name: "Español" }],
  specialties: [{ id: 1, code: "ski", name: "Esquí" }],
  document_types: [documentType],
};

function profile(category: ProfileCategory = "guide", onboardingStep = 2): Profile {
  const common = {
    id: PROFILE_ID,
    category,
    display_name: `Perfil ${category}`,
    slug: `perfil-${category}`,
    description: "Perfil profesional de prueba",
    status: "draft" as const,
    onboarding_step: onboardingStep,
    completed_at: null,
    primary_city: city,
    cities: [city, secondCity],
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

function access(canUseGallery: boolean): AccessEvaluation {
  return {
    profile_id: PROFILE_ID,
    effective_state: canUseGallery ? "active" : "inactive",
    allowed: canUseGallery,
    denial_code: canUseGallery ? null : "subscription_required",
    grant: canUseGallery ? {
      status: "active",
      starts_at: "2026-01-01T00:00:00Z",
      expires_at: null,
      city_limit: null,
      monthly_contact_limit: null,
      gallery_enabled: true,
      version: 1,
    } : null,
    capabilities: {
      can_search: false,
      can_send_contact_requests: false,
      can_publish_availability: canUseGallery,
      can_receive_contact_requests: canUseGallery,
      can_use_gallery: canUseGallery,
      can_view_history: true,
      can_reject_pending_requests: true,
    },
    contact_quota: null,
    evaluated_at: "2026-03-01T12:00:00Z",
  };
}

function account(draft = profile()): CurrentAccount {
  return {
    user: {
      id: USER_ID,
      name: "Persona T10",
      email: "t10@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "user",
      status: "active",
    },
    profiles: [{
      id: draft.id,
      category: draft.category,
      display_name: draft.display_name,
      status: draft.status,
      completed_at: draft.completed_at,
      access_state: "inactive",
      capabilities: access(false).capabilities,
    }],
    notification_preferences: [],
  };
}

function documentRecord(
  status: DocumentRecord["status"] = "pending",
  id = DOCUMENT_PENDING_ID,
): DocumentRecord {
  return {
    id,
    profile_id: PROFILE_ID,
    document_type: documentType,
    original_filename: `${status}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 120,
    registration_number: "GUIA-001",
    valid_until: "2099-12-31",
    status,
    reviewed_at: status === "pending" ? null : "2026-03-01T12:00:00Z",
    rejection_reason: status === "rejected" ? "La imagen no es legible." : null,
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
  return jsonResponse({ data: catalogs, meta: { next_cursor: null, per_page: 50, total: 2 } });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/profile");
  window.sessionStorage.clear();
  vi.mocked(browserMutation).mockReset();
  vi.mocked(readBrowserApiError).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("T10 — formularios de cinco categorías", () => {
  it.each([
    ["tourism_company", ["Razón social", "Años de actividad"]],
    ["guide", ["Resumen de formación", "Título o calificación"]],
    ["driver", ["Tipo de licencia", "Capacidad del vehículo"]],
    ["instructor", ["Resumen de capacitación", "Especialidades"]],
    ["transport_company", ["Descripción de flota", "Capacidad por unidad"]],
  ] as const)("renderiza campos reutilizables de %s", (category, labels) => {
    render(<CategoryFields profile={profile(category)} catalogs={catalogs} />);
    for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("ordena PATCH antes de PUT al quitar la ciudad principal y refresca el perfil", async () => {
    const current = profile("guide");
    const refreshed = { ...current, primary_city: secondCity, cities: [secondCity] };
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: refreshed }))
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_ID, cities: [secondCity] } }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: refreshed }));

    const result = await persistProfileData(current, {
      display_name: current.display_name,
      primary_city_id: secondCity.id,
    }, [secondCity.id]);

    expect(result.primary_city?.id).toBe(secondCity.id);
    expect(browserMutation).toHaveBeenNthCalledWith(
      1,
      `/api/backend/v1/profiles/${PROFILE_ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      2,
      `/api/backend/v1/profiles/${PROFILE_ID}/cities`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ city_ids: [secondCity.id] }) }),
    );
  });
});

describe("T10 — documentos privados", () => {
  it("envía multipart exacto sin Content-Type manual y refresca la lista", async () => {
    let uploaded = false;
    const pending = documentRecord();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).includes("/documents")) return Promise.resolve(documentsResponse(uploaded ? [pending] : []));
      throw new Error(`GET inesperado ${String(input)}`);
    });
    vi.mocked(browserMutation).mockImplementation((_path, init) => {
      uploaded = true;
      expect(init?.headers).toBeUndefined();
      return Promise.resolve(jsonResponse({ data: pending }, 201));
    });

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} requiredOnly />);
    await screen.findByText("No hay documentos cargados.");
    const form = screen.getByRole("heading", { name: documentType.label }).closest("section");
    expect(form).not.toBeNull();
    const file = new File(["%PDF-1.4 synthetic"], "credencial.pdf", { type: "application/pdf" });
    fireEvent.change(within(form as HTMLElement).getByLabelText(/Archivo PDF/), { target: { files: [file] } });
    fireEvent.change(within(form as HTMLElement).getByLabelText(/Número de registro/), { target: { value: "GUIA-001" } });
    fireEvent.change(within(form as HTMLElement).getByLabelText("Vigente hasta"), { target: { value: "2099-12-31" } });
    fireEvent.click(within(form as HTMLElement).getByRole("button", { name: "Subir documento" }));

    expect(await screen.findByText("Documento cargado y pendiente de revisión.")).toBeInTheDocument();
    const init = vi.mocked(browserMutation).mock.calls[0]?.[1];
    const multipart = init?.body as FormData;
    expect([...multipart.keys()]).toEqual(["document_type_id", "file", "registration_number", "valid_until"]);
    expect(multipart.get("document_type_id")).toBe(String(documentType.id));
    expect((multipart.get("file") as File).name).toBe("credencial.pdf");
    expect(init?.headers).toBeUndefined();
  });

  it("muestra 422 junto al campo y lo vincula con aria-describedby", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(documentsResponse([]));
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      error: {
        code: "validation_failed",
        message: "Los datos enviados no son válidos.",
        fields: { file: ["El archivo no tiene un MIME válido."], valid_until: ["La fecha es obligatoria."] },
      },
      request_id: "req-t10-422",
    }, 422));

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />);
    const fileInput = await screen.findByLabelText(/Archivo PDF/);
    fireEvent.change(fileInput, { target: { files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));

    expect(await screen.findByText("El archivo no tiene un MIME válido.")).toHaveAttribute("role", "alert");
    expect(fileInput).toHaveAttribute("aria-invalid", "true");
    expect(fileInput.getAttribute("aria-describedby")).toBe(screen.getByText("El archivo no tiene un MIME válido.").id);
    expect(screen.getByLabelText(/^Vigente hasta/)).toHaveAttribute("aria-invalid", "true");
  });

  it("distingue pending, approved vigente y rejected con motivo sin paths ni checksum", async () => {
    const documents = [
      documentRecord("pending"),
      documentRecord("approved", DOCUMENT_APPROVED_ID),
      documentRecord("rejected", DOCUMENT_REJECTED_ID),
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(documentsResponse(documents));

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />);

    expect((await screen.findAllByText("Pendiente de revisión")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Estado: Aprobado y vigente/)).toBeInTheDocument();
    expect(screen.getByText(/Estado: Rechazado/)).toBeInTheDocument();
    expect(screen.getByText(/Motivo: La imagen no es legible\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/checksum|private_path|documents\//i);
  });

  it("descarga por el BFF autenticado y elimina con refresh", async () => {
    const pending = documentRecord();
    let deleted = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/download")) return Promise.resolve(new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }));
      if (url.includes("/documents")) return Promise.resolve(documentsResponse(deleted ? [] : [pending]));
      throw new Error(`GET inesperado ${url}`);
    });
    vi.mocked(browserMutation).mockImplementation(() => {
      deleted = true;
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const createObjectURL = vi.fn(() => "blob:t10-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />);
    await screen.findAllByText("pending.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/v1/profiles/${PROFILE_ID}/documents/${DOCUMENT_PENDING_ID}/download`,
      { credentials: "same-origin", cache: "no-store" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByText("No hay documentos cargados.")).toBeInTheDocument();
    expect(browserMutation).toHaveBeenCalledWith(
      `/api/backend/v1/profiles/${PROFILE_ID}/documents/${DOCUMENT_PENDING_ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("T10 — media y capacidad de galería", () => {
  it("explica el bloqueo real y no renderiza mutaciones si can_use_gallery=false", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([]));
      throw new Error(`GET inesperado ${url}`);
    });

    render(<ProfileEditor profile={profile()} access={access(false)} onProfileChange={vi.fn()} />);

    expect(await screen.findByText(/access\.capabilities\.can_use_gallery=false/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar a galería|Eliminar imagen/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualizar avatar" })).toBeInTheDocument();
  });

  it("habilita upload/delete de galería y manda solo image/position", async () => {
    const galleryProfile = {
      ...profile(),
      gallery: [{ id: MEDIA_ID, url: "http://localhost:8080/storage/media/gallery.png", mime_type: "image/png" as const, width: 1, height: 1, position: 0 }],
    };
    const updated = { ...galleryProfile, gallery: [] };
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([]));
      if (url.endsWith(PROFILE_ID)) return Promise.resolve(jsonResponse({ data: updated }));
      throw new Error(`GET inesperado ${url}`);
    });
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: galleryProfile.gallery[0] }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const onProfileChange = vi.fn();

    render(<ProfileEditor profile={galleryProfile} access={access(true)} onProfileChange={onProfileChange} />);
    const uploadButton = await screen.findByRole("button", { name: "Agregar a galería" });
    fireEvent.change(screen.getByLabelText("Imagen JPEG o PNG"), {
      target: { files: [new File(["png"], "gallery.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText(/Posición/), { target: { value: "0" } });
    fireEvent.click(uploadButton);
    await waitFor(() => expect(onProfileChange).toHaveBeenCalled());

    const uploadInit = vi.mocked(browserMutation).mock.calls[0]?.[1];
    expect(uploadInit?.headers).toBeUndefined();
    expect([...(uploadInit?.body as FormData).keys()]).toEqual(["image", "position"]);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar imagen" }));
    await waitFor(() => expect(browserMutation).toHaveBeenCalledTimes(2));
    expect(browserMutation).toHaveBeenLastCalledWith(
      `/api/backend/v1/profiles/${PROFILE_ID}/gallery/${MEDIA_ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("T10 — onboarding documental real", () => {
  it("sube el requerido, refresca, completa con pending y guarda el perfil activo", async () => {
    const draft = profile("guide", 2);
    const pending = documentRecord();
    const completed: Profile = { ...draft, status: "published", onboarding_step: 4, completed_at: "2026-03-01T12:00:00Z" };
    let uploaded = false;
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_ID}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(draft) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse(uploaded ? [pending] : []));
      if (url.endsWith(PROFILE_ID)) return Promise.resolve(jsonResponse({ data: draft }));
      throw new Error(`GET inesperado ${url}`);
    });
    vi.mocked(browserMutation).mockImplementation((path) => {
      if (path.endsWith("/documents")) {
        uploaded = true;
        return Promise.resolve(jsonResponse({ data: pending }, 201));
      }
      if (path.endsWith("/terms")) return Promise.resolve(jsonResponse({ data: { profile_id: PROFILE_ID, version: "demo-v1", accepted_at: "2026-03-01T12:00:00Z" } }, 201));
      if (path.endsWith("/complete")) return Promise.resolve(jsonResponse({ data: completed }));
      throw new Error(`Mutación inesperada ${path}`);
    });

    render(<OnboardingPage />);
    await screen.findByRole("heading", { name: "3. Documentación requerida" });
    await screen.findByText("No hay documentos cargados.");
    const continueButton = screen.getByRole("button", { name: "Continuar a revisión" });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Archivo PDF/), {
      target: { files: [new File(["%PDF-1.4"], "required.pdf", { type: "application/pdf" })] },
    });
    fireEvent.change(screen.getByLabelText(/^Vigente hasta/), { target: { value: "2099-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    expect(await screen.findByRole("heading", { name: "4. Revisión y términos" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Acepto los términos/));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y solicitar finalización" }));

    expect(await screen.findByRole("heading", { name: "Pendiente de habilitación manual" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(ACTIVE_PROFILE_KEY)).toBe(PROFILE_ID);
    expect(browserMutation).toHaveBeenCalledWith(
      `/api/backend/v1/profiles/${PROFILE_ID}/complete`,
      expect.objectContaining({ method: "POST", body: undefined }),
    );
    expect(vi.mocked(browserMutation).mock.calls.map(([path]) => path).join(" ")).not.toMatch(/grant|pago|payment/i);
  });

  it("si el upload falla mantiene step3 y no llama terms/complete", async () => {
    const draft = profile("guide", 2);
    window.history.replaceState({}, "", `/app/onboarding?profile=${PROFILE_ID}`);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) return Promise.resolve(jsonResponse({ data: account(draft) }));
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([]));
      if (url.endsWith(PROFILE_ID)) return Promise.resolve(jsonResponse({ data: draft }));
      throw new Error(`GET inesperado ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({
      error: { code: "validation_failed", message: "Archivo inválido.", fields: { file: ["Archivo inválido."] } },
      request_id: "req-upload-failed",
    }, 422));

    render(<OnboardingPage />);
    await screen.findByRole("heading", { name: "3. Documentación requerida" });
    await screen.findByText("No hay documentos cargados.");
    fireEvent.change(screen.getByLabelText(/Archivo PDF/), {
      target: { files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));

    expect((await screen.findAllByText("Archivo inválido.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "3. Documentación requerida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar a revisión" })).toBeDisabled();
    expect(vi.mocked(browserMutation).mock.calls.some(([path]) => path.endsWith("/terms") || path.endsWith("/complete"))).toBe(false);
  });
});

describe("T10 — errores accesibles por categoría", () => {
  it.each([
    ["tourism_company", "legal_name", "Razón social inválida.", /Razón social/],
    ["guide", "qualifications.0.title", "Falta la calificación.", /Título o calificación/],
    ["driver", "license_type", "Falta la licencia.", /Tipo de licencia/],
    ["transport_company", "fleet_vehicles.0.capacity", "Falta la capacidad.", /Capacidad por unidad/],
  ] as const)("vincula el 422 específico de %s con su control", (category, field, message, label) => {
    render(<CategoryFields profile={profile(category)} catalogs={catalogs} fields={{ [field]: [message] }} />);
    const control = screen.getByLabelText(label);
    const describedBy = control.getAttribute("aria-describedby");
    const error = describedBy ? document.getElementById(describedBy) : null;
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(error).not.toBeNull();
    expect(error).toHaveTextContent(message);
    expect(error).toHaveAttribute("role", "alert");
  });

  it("vincula specialties del instructor con el grupo accesible", () => {
    render(<CategoryFields profile={profile("instructor")} catalogs={catalogs} fields={{ specialties: ["Elegí una especialidad."] }} />);
    const group = screen.getByRole("group", { name: "Especialidades" });
    const error = screen.getByText("Elegí una especialidad.");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.getAttribute("aria-describedby")).toBe(error.id);
  });
});

describe("T10 — transición segura de ciudad principal", () => {
  it("agrega B transitoriamente antes de cambiar A→B cuando B aún no pertenecía al perfil", async () => {
    const current = { ...profile("guide"), cities: [city] };
    const refreshed = { ...current, primary_city: secondCity, cities: [secondCity] };
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_ID, cities: [city, secondCity] } }))
      .mockResolvedValueOnce(jsonResponse({ data: refreshed }))
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_ID, cities: [secondCity] } }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: refreshed }));

    await persistProfileData(current, { display_name: current.display_name, primary_city_id: secondCity.id }, [secondCity.id]);

    expect(browserMutation).toHaveBeenNthCalledWith(
      1,
      `/api/backend/v1/profiles/${PROFILE_ID}/cities`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ city_ids: [city.id, secondCity.id] }) }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      2,
      `/api/backend/v1/profiles/${PROFILE_ID}`,
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      3,
      `/api/backend/v1/profiles/${PROFILE_ID}/cities`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ city_ids: [secondCity.id] }) }),
    );
  });

  it("elimina A de forma segura limpiando primero primary_city", async () => {
    const current = profile("guide");
    const refreshed = { ...current, primary_city: null, cities: [secondCity] };
    vi.mocked(browserMutation)
      .mockResolvedValueOnce(jsonResponse({ data: refreshed }))
      .mockResolvedValueOnce(jsonResponse({ data: { profile_id: PROFILE_ID, cities: [secondCity] } }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: refreshed }));

    await persistProfileData(current, { display_name: current.display_name, primary_city_id: null }, [secondCity.id]);

    expect(browserMutation).toHaveBeenNthCalledWith(
      1,
      `/api/backend/v1/profiles/${PROFILE_ID}`,
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"primary_city_id":null') }),
    );
    expect(browserMutation).toHaveBeenNthCalledWith(
      2,
      `/api/backend/v1/profiles/${PROFILE_ID}/cities`,
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ city_ids: [secondCity.id] }) }),
    );
  });
});

describe("T10 — descarga firmada y éxitos parciales", () => {
  it("usa signed_url JSON segura sin convertirla a blob/PDF", async () => {
    const pending = documentRecord();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/download")) {
        return Promise.resolve(jsonResponse({ data: { signed_url: "https://files.example.test/signed/document", expires_at: "2099-01-01T00:00:00Z" } }));
      }
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([pending]));
      throw new Error(`GET inesperado ${url}`);
    });
    const createObjectURL = vi.fn(() => "blob:no-debe-usarse");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let clickedHref = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
    });

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />);
    await screen.findAllByText("pending.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Descargar" }));

    await waitFor(() => expect(clickedHref).toBe("https://files.example.test/signed/document"));
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("informa documento guardado si falla el refresh y reintenta sin repetir el upload", async () => {
    let documentReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/documents")) {
        documentReads += 1;
        if (documentReads === 2) {
          return Promise.resolve(jsonResponse({ error: { code: "backend_unavailable", message: "Refresh caído." }, request_id: "req-refresh" }, 502));
        }
        return Promise.resolve(documentsResponse([]));
      }
      throw new Error(`GET inesperado ${url}`);
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({ data: documentRecord() }, 201));

    render(<DocumentsPanel profileId={PROFILE_ID} documentTypes={[documentType]} />);
    await screen.findByText("No hay documentos cargados.");
    fireEvent.change(screen.getByLabelText(/Archivo PDF/), {
      target: { files: [new File(["%PDF"], "guardado.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Subir documento" }));

    expect(await screen.findByText(/Documento guardado, no pudimos refrescar/)).toBeInTheDocument();
    expect(browserMutation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar actualización documental" }));
    expect(await screen.findByText("La información documental quedó actualizada.")).toBeInTheDocument();
    expect(browserMutation).toHaveBeenCalledTimes(1);
  });
});

describe("T10 — media soportada, 422 y refresh parcial", () => {
  const media = {
    id: MEDIA_ID,
    url: "https://files.example.test/media.png",
    mime_type: "image/png" as const,
    width: 100,
    height: 100,
    position: 0,
  };

  function mockEditorGets(profileRefresh: Response | (() => Response) = jsonResponse({ data: profile() })) {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/catalogs")) return Promise.resolve(catalogsResponse());
      if (url.includes("/documents")) return Promise.resolve(documentsResponse([]));
      if (url.endsWith(PROFILE_ID)) return Promise.resolve(typeof profileRefresh === "function" ? profileRefresh() : profileRefresh.clone());
      throw new Error(`GET inesperado ${url}`);
    });
  }

  it("limita avatar y galería a JPEG/PNG y muestra sus 422 junto al campo", async () => {
    mockEditorGets();
    vi.mocked(browserMutation).mockImplementation((path) => Promise.resolve(jsonResponse({
      error: {
        code: "validation_failed",
        message: "Imagen inválida.",
        fields: { image: [path.endsWith("/avatar") ? "Avatar inválido." : "Galería inválida."] },
      },
      request_id: "req-media-422",
    }, 422)));

    render(<ProfileEditor profile={profile()} access={access(true)} onProfileChange={vi.fn()} />);
    const avatarInput = await screen.findByLabelText("Nueva imagen JPEG o PNG");
    const galleryInput = screen.getByLabelText("Imagen JPEG o PNG");
    expect(avatarInput).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(galleryInput).toHaveAttribute("accept", "image/jpeg,image/png");

    fireEvent.change(avatarInput, { target: { files: [new File(["bad"], "avatar.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar avatar" }));
    const avatarError = await screen.findByText("Avatar inválido.");
    expect(avatarInput).toHaveAttribute("aria-invalid", "true");
    expect(avatarInput.getAttribute("aria-describedby")).toBe(avatarError.id);

    fireEvent.change(galleryInput, { target: { files: [new File(["bad"], "gallery.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a galería" }));
    const galleryError = await screen.findByText("Galería inválida.");
    expect(galleryInput).toHaveAttribute("aria-invalid", "true");
    expect(galleryInput.getAttribute("aria-describedby")).toBe(galleryError.id);
  });

  it("conserva éxito de avatar y permite refrescar sin volver a subir", async () => {
    let profileReads = 0;
    mockEditorGets(() => {
      profileReads += 1;
      return profileReads === 1
        ? jsonResponse({ error: { code: "backend_unavailable", message: "Refresh caído." }, request_id: "req-avatar-refresh" }, 502)
        : jsonResponse({ data: { ...profile(), avatar: media } });
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({ data: media }, 201));
    const onProfileChange = vi.fn();

    render(<ProfileEditor profile={profile()} access={access(true)} onProfileChange={onProfileChange} />);
    const input = await screen.findByLabelText("Nueva imagen JPEG o PNG");
    fireEvent.change(input, { target: { files: [new File(["png"], "avatar.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Actualizar avatar" }));

    expect(await screen.findByText(/Avatar guardado, no pudimos refrescar/)).toBeInTheDocument();
    const multipart = vi.mocked(browserMutation).mock.calls[0]?.[1]?.body as FormData;
    expect([...multipart.keys()]).toEqual(["image"]);
    expect(browserMutation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar actualización del avatar" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalled());
    expect(browserMutation).toHaveBeenCalledTimes(1);
  });

  it("conserva éxito de galería y permite refrescar sin volver a subir", async () => {
    let profileReads = 0;
    mockEditorGets(() => {
      profileReads += 1;
      return profileReads === 1
        ? jsonResponse({ error: { code: "backend_unavailable", message: "Refresh caído." }, request_id: "req-gallery-refresh" }, 502)
        : jsonResponse({ data: { ...profile(), gallery: [media] } });
    });
    vi.mocked(browserMutation).mockResolvedValue(jsonResponse({ data: media }, 201));
    const onProfileChange = vi.fn();

    render(<ProfileEditor profile={profile()} access={access(true)} onProfileChange={onProfileChange} />);
    const input = await screen.findByLabelText("Imagen JPEG o PNG");
    fireEvent.change(input, { target: { files: [new File(["png"], "gallery.png", { type: "image/png" })] } });
    fireEvent.change(screen.getByLabelText(/Posición/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar a galería" }));

    expect(await screen.findByText(/Imagen guardada, no pudimos refrescar/)).toBeInTheDocument();
    const multipart = vi.mocked(browserMutation).mock.calls[0]?.[1]?.body as FormData;
    expect([...multipart.keys()]).toEqual(["image", "position"]);
    expect(browserMutation).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar actualización de la galería" }));
    await waitFor(() => expect(onProfileChange).toHaveBeenCalled());
    expect(browserMutation).toHaveBeenCalledTimes(1);
  });
});
