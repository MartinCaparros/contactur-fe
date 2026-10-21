import { cleanup, render as renderAdmin, screen as adminScreen } from "@testing-library/react";
import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import HomePage from "../app/(public)/page";
import { AdminBackoffice } from "@/features/admin/AdminShell";
import type { CurrentAccount } from "@/features/app/api";

/**
 * T23 (P28): errores por campo accesibles en los formularios del modal de acceso y
 * suspensión inmediata también en el backoffice (P27). Antes de T23 los formularios
 * del modal usaban la validación nativa: Chrome mostraba un globo en el idioma del
 * navegador, sin aria-invalid ni texto asociado al campo.
 */

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function render(ui: ReactNode) {
  activeContainer = document.createElement("div");
  document.body.append(activeContainer);
  activeRoot = createRoot(activeContainer);
  flushSync(() => activeRoot?.render(ui));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiErrorResponse(status: number, code: string, message: string, fields?: Record<string, string[]>): Response {
  return jsonResponse({ error: fields ? { code, message, fields } : { code, message }, request_id: "req-t23" }, status);
}

afterEach(() => {
  if (activeRoot) flushSync(() => activeRoot?.unmount());
  activeContainer?.remove();
  activeRoot = null;
  activeContainer = null;
  cleanup();
  window.history.replaceState({}, "", "/");
  document.cookie = "contactur_csrf=; Max-Age=0; Path=/";
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

async function openDialog(name: string, link?: RegExp): Promise<HTMLElement> {
  render(<HomePage />);
  fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  const login = await screen.findByRole("dialog", { name: "Bienvenido" });
  if (!link) return login;
  fireEvent.click(within(login).getByRole("link", { name: link }));
  return screen.findByRole("dialog", { name });
}

/** El campo queda inválido, con su mensaje en texto asociado por aria-describedby. */
function expectFieldError(field: HTMLElement, message: string) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
}

describe("T23 — errores por campo en el modal de acceso", () => {
  it("login vacío: no envía, marca cada campo, enfoca el primero y resume en un alert", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const dialog = await openDialog("Bienvenido");
    const email = within(dialog).getByLabelText("Email");
    const password = within(dialog).getByLabelText("Contraseña");
    expect(email.closest("form")).toHaveAttribute("novalidate");

    fireEvent.click(within(dialog).getByRole("button", { name: /iniciar sesión/i }));

    await waitFor(() => expectFieldError(email, "Ingresá tu email."));
    expectFieldError(password, "Ingresá tu contraseña.");
    await waitFor(() => expect(email).toHaveFocus());
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Revisá los datos marcados en el formulario.");
    expect(fetchMock).not.toHaveBeenCalled();

    // Editar un campo retira solo su error.
    fireEvent.change(email, { target: { value: "ana@" } });
    await waitFor(() => expect(email).not.toHaveAttribute("aria-invalid"));
    expect(password).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: /iniciar sesión/i }));
    await waitFor(() => expectFieldError(email, "Ingresá un email válido, por ejemplo nombre@dominio.com."));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("login con datos completos envía y conserva el error genérico ante credenciales inválidas", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-t23" } }))
      .mockResolvedValueOnce(apiErrorResponse(401, "invalid_credentials", "Credenciales inválidas."));
    const dialog = await openDialog("Bienvenido");
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /iniciar sesión/i }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "No pudimos iniciar sesión. Revisá tus datos e intentá nuevamente.",
    );
    // En login no se informa la política de contraseñas ni se marca un campo concreto.
    expect(within(dialog).getByLabelText("Contraseña")).not.toHaveAttribute("aria-invalid");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
  });

  it("alta: contraseña corta y confirmación distinta se explican junto a cada campo sin enviar", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const dialog = await openDialog("Crear una cuenta", /conocer el proceso de alta/i);
    const password = within(dialog).getByLabelText("Contraseña");
    expect(password).toHaveAccessibleDescription("Al menos 12 caracteres.");
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Ana" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(password, { target: { value: "corta" } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar contraseña"), { target: { value: "otra" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /crear cuenta/i }));

    await waitFor(() => expectFieldError(password, "La contraseña debe tener al menos 12 caracteres."));
    expect(password).toHaveAccessibleDescription(expect.stringContaining("Al menos 12 caracteres."));
    expectFieldError(within(dialog).getByLabelText("Confirmar contraseña"), "Las contraseñas no coinciden.");
    expect(within(dialog).getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(password).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("alta: el 422 de Laravel se muestra por campo y enfoca el primero", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: { csrf_token: "csrf-t23" } }))
      .mockResolvedValueOnce(apiErrorResponse(422, "validation_failed", "Los datos no son válidos.", {
        email: ["El campo email debe ser una dirección de correo válida."],
      }));
    const dialog = await openDialog("Crear una cuenta", /conocer el proceso de alta/i);
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Ana Torres" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(within(dialog).getByLabelText("Contraseña"), { target: { value: "Clave-segura-2026" } });
    fireEvent.change(within(dialog).getByLabelText("Confirmar contraseña"), { target: { value: "Clave-segura-2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /crear cuenta/i }));

    const email = within(dialog).getByLabelText("Email");
    await waitFor(() => expectFieldError(email, "El campo email debe ser una dirección de correo válida."));
    await waitFor(() => expect(email).toHaveFocus());
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Revisá los datos marcados en el formulario.");
    expect(within(dialog).queryByText("Cuenta creada")).toBeNull();
  });

  it("recuperación: email vacío se explica en el campo y no llama al BFF", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const dialog = await openDialog("Recuperar contraseña", /olvidaste tu contraseña/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /enviar instrucciones/i }));

    const email = within(dialog).getByLabelText("Email");
    await waitFor(() => expectFieldError(email, "Ingresá tu email."));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

type LocationStub = Readonly<{ replaced: string[]; restore: () => void }>;

function stubLocation(pathname: string): LocationStub {
  const original = Object.getOwnPropertyDescriptor(window, "location");
  const replaced: string[] = [];
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: `http://localhost${pathname}`,
      origin: "http://localhost",
      pathname,
      search: "",
      hash: "",
      replace: (target: string) => { replaced.push(target); },
      assign: (target: string) => { replaced.push(target); },
    },
  });
  return { replaced, restore: () => { if (original) Object.defineProperty(window, "location", original); } };
}

function adminAccount(status: CurrentAccount["user"]["status"]): CurrentAccount {
  return {
    user: {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: "Admin T23",
      email: "admin-t23@example.test",
      email_verified_at: "2026-01-01T00:00:00Z",
      system_role: "admin",
      status,
    },
    profiles: [],
    notification_preferences: [],
  };
}

describe("T23 — suspensión inmediata en el backoffice (P27)", () => {
  it.each([
    ["/me confirma la suspensión", () => jsonResponse({ data: adminAccount("suspended") })],
    ["/me falla después del 403", () => apiErrorResponse(502, "upstream_unavailable", "Servicio no disponible.")],
  ])("un 403 account_suspended de un panel restringe sin recargar: %s", async (_label, secondMe) => {
    const location = stubLocation("/admin/users");
    let meCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        meCalls += 1;
        return Promise.resolve(meCalls === 1 ? jsonResponse({ data: adminAccount("active") }) : secondMe());
      }
      if (url.includes("/admin/users")) {
        return Promise.resolve(apiErrorResponse(403, "account_suspended", "Tu cuenta está suspendida."));
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    try {
      renderAdmin(<AdminBackoffice view="users" />);

      expect(await adminScreen.findByRole("heading", { name: "El backoffice está restringido" })).toBeVisible();
      expect(meCalls).toBe(2);
      expect(adminScreen.queryByRole("complementary", { name: "Navegación del backoffice" })).toBeNull();
      expect(adminScreen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
      expect(location.replaced).toEqual([]);
    } finally {
      location.restore();
    }
  });
});
