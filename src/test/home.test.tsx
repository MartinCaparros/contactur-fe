import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import { StrictMode, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import HomePage from "../app/(public)/page";

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function render(ui: ReactNode) {
  activeContainer = document.createElement("div");
  document.body.append(activeContainer);
  activeRoot = createRoot(activeContainer);
  flushSync(() => activeRoot?.render(ui));
}

afterEach(() => {
  if (activeRoot) flushSync(() => activeRoot?.unmount());
  activeContainer?.remove();
  activeRoot = null;
  activeContainer = null;
  window.history.replaceState({}, "", "/");
  document.cookie = "contactur_csrf=; Max-Age=0; Path=/";
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("T03 — landing de Contactur", () => {
  it("muestra las secciones principales y los cinco perfiles", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /conectá con\s*profesionales\s*del turismo/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /una herramienta para\s*el turismo profesional/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /cinco perfiles,\s*una plataforma/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /tu espacio de trabajo/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /cuatro pasos y\s*revisión responsable/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /capacidades según\s*cada necesidad/i })).toBeInTheDocument();
    const profilesSection = document.querySelector("#perfiles");
    expect(profilesSection).not.toBeNull();
    expect(within(profilesSection as HTMLElement).getAllByRole("heading", { name: /empresa turística|guía profesional|conductor profesional|instructor especializado|transporte de pasajeros/i })).toHaveLength(5);
    expect(screen.getByRole("button", { name: /enviar consulta/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/preparado para integrar|canal de soporte en preparación|listo para integrar/i);
  });

  it("abre login desde el botón, enfoca email y no ofrece selector de perfil", async () => {
    render(<HomePage />);
    const trigger = screen.getByRole("button", { name: "Iniciar sesión" });

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Bienvenido" });
    const email = within(dialog).getByLabelText("Email");
    await waitFor(() => expect(email).toHaveFocus());
    expect(window.location.search).toBe("?auth=login");
    expect(within(dialog).queryByLabelText(/perfil|rol/i)).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("muestra aviso de cierre local sin afirmar revocación y limpia su marcador", async () => {
    window.history.replaceState({}, "", "/?logout=local");
    render(<HomePage />);

    const notice = await screen.findByText(
      "La sesión local se cerró. No pudimos confirmar la revocación remota.",
    );
    expect(notice).toHaveAttribute("role", "status");
    expect(window.location.search).toBe("");
  });

  it("abre por URL y al cerrar conserva los demás parámetros", async () => {
    window.history.replaceState({}, "", "/?origen=campana&auth=login&vista=compacta");
    render(<HomePage />);

    const dialog = await screen.findByRole("dialog", { name: "Bienvenido" });
    fireEvent.click(within(dialog).getByRole("button", { name: /cerrar inicio de sesión/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("auth")).toBeNull();
    expect(params.get("origen")).toBe("campana");
    expect(params.get("vista")).toBe("compacta");
  });

  it("atrapa el foco y Escape cierra devolviéndolo al disparador", async () => {
    render(<HomePage />);
    const trigger = screen.getByRole("button", { name: "Iniciar sesión" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Bienvenido" });
    const close = within(dialog).getByRole("button", { name: /cerrar inicio de sesión/i });
    const lastLink = within(dialog).getByRole("link", { name: /conocer el proceso de alta/i });

    lastLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastLink).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("no publica recorridos comerciales ni promesas de otros idiomas", () => {
    render(<HomePage />);
    const content = document.body.textContent ?? "";

    expect(content).not.toMatch(/membresía|precio|checkout|pago|plan básico|plan profesional|equipo|inglés|english/i);
    expect(content).not.toMatch(/activar mi perfil|activo de inmediato|perfil activo en minutos/i);
    expect(screen.getAllByRole("link", { name: "Consultar acceso" })).toHaveLength(3);
    expect(screen.getByText(/habilitación manual pendiente/i)).toBeInTheDocument();
    expect(screen.getByText("Verificado")).toBeInTheDocument();
    expect(screen.getAllByText("Acceso activo").length).toBeGreaterThan(0);
  });

  it("expone FAQ operable con estado accesible", async () => {
    render(<HomePage />);
    const question = screen.getByRole("button", { name: /quién puede iniciar una solicitud/i });

    expect(question).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(question);
    await waitFor(() => expect(question).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByText(/solo una empresa turística con acceso habilitado/i)).toBeVisible();
    fireEvent.click(question);
    await waitFor(() => expect(question).toHaveAttribute("aria-expanded", "false"));
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("T05 — formularios de autenticación reales", () => {
  it("muestra error genérico de login sin enumerar cuentas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-test" } }))
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "invalid_credentials", message: "Credenciales inválidas." },
        request_id: "request-login",
      }, 401));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const dialog = await screen.findByRole("dialog", { name: "Bienvenido" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "missing@example.test" } });
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "not-a-real-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /iniciar sesión/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente.",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("registra name/email/password/confirmation y explica verificación sin activar perfiles", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-register" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          user: {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            name: "Persona Ejemplo",
            email: "person@example.test",
            email_verified_at: null,
            system_role: "user",
            status: "active",
          },
        },
      }, 201));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const login = await screen.findByRole("dialog", { name: "Bienvenido" });
    fireEvent.click(within(login).getByRole("link", { name: /conocer el proceso de alta/i }));
    const dialog = await screen.findByRole("dialog", { name: "Crear una cuenta" });
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Persona Ejemplo" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "Clave-segura-2026" } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar contraseña"), { target: { value: "Clave-segura-2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /crear cuenta/i }));

    expect(await within(dialog).findByText("Cuenta creada")).toBeVisible();
    expect(within(dialog).getByText(/no creó un perfil ni concedió habilitación/i)).toBeVisible();
    const request = fetchMock.mock.calls.at(-1)?.[1];
    expect(String(request?.body)).not.toMatch(/role|profile|grant/i);
  });

  it("recovery muestra respuesta genérica solo cuando upstream acepta", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-recovery" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    render(<HomePage />);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const login = await screen.findByRole("dialog", { name: "Bienvenido" });
    fireEvent.click(within(login).getByRole("link", { name: /olvidaste tu contraseña/i }));
    const dialog = await screen.findByRole("dialog", { name: "Recuperar contraseña" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "unknown@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /enviar instrucciones/i }));

    expect(await within(dialog).findByText(/recibirás instrucciones para restablecer/i)).toBeVisible();
  });

  it.each([403, 422, 429, 502])(
    "recovery muestra error operativo genérico ante HTTP %s",
    async (status) => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-recovery" } }))
        .mockResolvedValueOnce(jsonResponse({
          error: { code: "upstream_detail", message: "Detalle no visible" },
          request_id: "request-recovery",
        }, status));
      render(<HomePage />);
      fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
      const login = await screen.findByRole("dialog", { name: "Bienvenido" });
      fireEvent.click(within(login).getByRole("link", { name: /olvidaste tu contraseña/i }));
      const dialog = await screen.findByRole("dialog", { name: "Recuperar contraseña" });
      fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "unknown@example.test" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /enviar instrucciones/i }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "No pudimos enviar las instrucciones. Intentá nuevamente más tarde.",
      );
      expect(within(dialog).queryByText("Detalle no visible")).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /enviar instrucciones/i })).toBeVisible();
    },
  );

  it("consume reset una vez tras resincronizar y limpia query/hash antes del POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-reset" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    window.history.replaceState(
      {},
      "",
      "/?auth=reset-password#token=secret-link-token&email=person%40example.test",
    );
    render(<HomePage />);

    const dialog = await screen.findByRole("dialog", { name: "Nueva contraseña" });
    expect(within(dialog).getByLabelText("Email")).toHaveValue("person@example.test");
    expect(window.location.search).toBe("?auth=reset-password");
    expect(window.location.hash).toBe("");
    expect(dialog).not.toHaveTextContent("secret-link-token");

    flushSync(() => window.dispatchEvent(new PopStateEvent("popstate")));

    fireEvent.change(within(dialog).getByLabelText("Nueva contraseña"), {
      target: { value: "Nueva-clave-segura-2026" },
    });
    fireEvent.change(within(dialog).getByLabelText("Confirmar contraseña"), {
      target: { value: "Nueva-clave-segura-2026" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /guardar contraseña/i }));

    expect(await within(dialog).findByText(/contraseña actualizada/i)).toBeVisible();
    const resetRequests = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/auth/reset-password",
    );
    expect(resetRequests).toHaveLength(1);
    expect(JSON.parse(String(resetRequests[0]?.[1]?.body))).toMatchObject({
      token: "secret-link-token",
      email: "person@example.test",
    });
    expect(window.location.search).toBe("?auth=reset-password");
    expect(window.location.hash).toBe("");
  });

  it("captura verify desde hash bajo StrictMode, hace un solo POST y limpia la URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        expect(new URLSearchParams(window.location.search).has("token")).toBe(false);
        expect(window.location.hash).toBe("");
        return jsonResponse({ data: { csrf_token: "csrf-verify" } });
      })
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    window.history.replaceState({}, "", "/?auth=verify-email#token=verify-link-token");
    render(
      <StrictMode>
        <HomePage />
      </StrictMode>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Verificar correo" });
    expect(await within(dialog).findByText(/tu correo quedó verificado/i)).toBeVisible();
    expect(window.location.search).toBe("?auth=verify-email");
    expect(window.location.hash).toBe("");
    const verifyRequests = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/auth/email/verify",
    );
    expect(verifyRequests).toHaveLength(1);
    expect(JSON.parse(String(verifyRequests[0]?.[1]?.body))).toMatchObject({
      token: "verify-link-token",
    });
  });
});
