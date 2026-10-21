import { fireEvent, screen, waitFor, within } from "@testing-library/dom";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import HomePage from "../app/(public)/page";
import { inLocale, setLocaleCookie } from "./i18n";

/**
 * Landing en inglés: header, secciones, demos, modal de acceso (con la validación por
 * campo de T23) y formulario de contacto. El español lo cubren home, t19 y t23.
 */

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function render(ui: ReactNode) {
  activeContainer = document.createElement("div");
  document.body.append(activeContainer);
  activeRoot = createRoot(activeContainer);
  flushSync(() => activeRoot?.render(ui));
}

function renderEnglish() {
  render(inLocale("en", <HomePage />));
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function csrfResponse(): Response {
  return jsonResponse({ data: { csrf_token: "csrf-i18n-landing" } });
}

/** El campo queda inválido, con su mensaje asociado por aria-describedby. */
function expectFieldError(field: HTMLElement, message: string) {
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
}

async function openLogin(): Promise<HTMLElement> {
  renderEnglish();
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  return screen.findByRole("dialog", { name: "Welcome" });
}

afterEach(() => {
  if (activeRoot) flushSync(() => activeRoot?.unmount());
  activeContainer?.remove();
  activeRoot = null;
  activeContainer = null;
  window.history.replaceState({}, "", "/");
  document.cookie = "contactur_csrf=; Max-Age=0; Path=/";
  setLocaleCookie(null);
  document.documentElement.lang = "";
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("i18n — landing en inglés", () => {
  it("header: navegación, acciones y selector de idioma con EN activo", () => {
    renderEnglish();

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    for (const name of ["About us", "Profiles", "How it works", "Access", "FAQ", "Contact"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create profile" })).toHaveAttribute("href", "#onboarding");

    // Un selector en la barra y otro dentro del menú móvil.
    const switches = screen.getAllByRole("group", { name: "Language" });
    expect(switches).toHaveLength(2);
    const english = within(switches[0]).getByRole("button", { name: "EN English" });
    expect(english).toHaveAttribute("aria-pressed", "true");
    expect(english).toHaveAttribute("title", "Switch language to English");
    expect(within(switches[0]).getByRole("button", { name: "ES Español" })).toHaveAttribute("aria-pressed", "false");

    const content = document.body.textContent ?? "";
    expect(content).not.toMatch(/Iniciar sesión|Quiénes somos|Cómo funciona|Preguntas frecuentes|Solicitudes/);
  });

  it("hero, estadísticas y pie de página", () => {
    renderEnglish();

    expect(screen.getByRole("heading", { level: 1, name: /connect with\s*professionals\s*in tourism/i })).toBeInTheDocument();
    expect(screen.getByText("B2B platform · Professional tourism")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create my profile →" })).toHaveAttribute("href", "#onboarding");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#como-funciona");
    expect(screen.getByLabelText("Demo profiles")).toHaveTextContent("Under review");

    const stats = screen.getByRole("region", { name: "Contactur at a glance" });
    expect(stats).toHaveTextContent("Current interface");
    expect(stats).toHaveTextContent("EN");
    expect(stats).toHaveTextContent("Access grant");

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("heading", { name: "Platform" })).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Request the privacy notice" })).toBeInTheDocument();
    expect(within(footer).getByText("Interface in English")).toBeInTheDocument();
  });

  it("secciones, perfiles, demos y FAQ operable", async () => {
    renderEnglish();

    for (const name of [
      /a tool for\s*professional tourism/i,
      /five profiles,\s*one platform/i,
      /dates blocked\s*by default/i,
      /^your workspace$/i,
      /four steps and\s*a careful review/i,
      /capabilities for\s*every need/i,
      /^everything you need to know$/i,
      /^have a question\?$/i,
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    const profilesSection = document.querySelector<HTMLElement>("#perfiles");
    expect(profilesSection).not.toBeNull();
    expect(
      within(profilesSection as HTMLElement)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(["Tourism company", "Professional guide", "Professional driver", "Specialist instructor", "Passenger transport"]);

    // Demo de disponibilidad: rótulos de los días, fechas de ejemplo y aviso local.
    expect(screen.getByRole("button", { name: "5 April 2027, available. Demo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "12 April 2027, reference day. Demo" })).toBeDisabled();
    expect(screen.getByLabelText("From · demo")).toHaveValue("12 Apr 2027");
    fireEvent.click(screen.getByRole("button", { name: "Search the demo →" }));
    expect(await screen.findByText("Local demo: the filters were applied to fictional data.")).toHaveAttribute("role", "status");
    expect(screen.getAllByRole("link", { name: "Ask about access" })).toHaveLength(3);

    const first = screen.getByRole("button", { name: "Is Contactur for tourists?" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    const question = screen.getByRole("button", { name: "Who can start a request?" });
    expect(question).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(question);
    await waitFor(() => expect(question).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByText(/^Only a tourism company with granted access can send a request/)).toBeVisible();
  });

  it("login: rótulos, errores por campo, resumen y error genérico en inglés", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const dialog = await openLogin();
    expect(dialog).toHaveAccessibleDescription("Log in with your Contactur account.");
    expect(within(dialog).getByRole("button", { name: "Close login" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Forgot your password?" })).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "See how sign-up works" })).toBeInTheDocument();
    expect(within(dialog).getByText("or")).toBeInTheDocument();

    const email = within(dialog).getByLabelText("Email");
    const password = within(dialog).getByLabelText("Password");
    expect(email).toHaveAttribute("placeholder", "you@email.com");
    fireEvent.click(within(dialog).getByRole("button", { name: "Log in →" }));

    await waitFor(() => expectFieldError(email, "Enter your email."));
    expectFieldError(password, "Enter your password.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Check the highlighted fields in the form.");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: "ana@" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log in →" }));
    await waitFor(() => expectFieldError(email, "Enter a valid email, for example name@domain.com."));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(jsonResponse({
        error: { code: "invalid_credentials", message: "Invalid credentials." },
        request_id: "request-i18n-login",
      }, 401));
    fireEvent.change(email, { target: { value: "ana@example.test" } });
    fireEvent.change(password, { target: { value: "not-a-real-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Log in →" }));

    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "We couldn't log you in. Check your details and try again.",
    ));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
  });

  it("alta: rótulos, pista de contraseña y validación de cortesía en inglés", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const login = await openLogin();
    fireEvent.click(within(login).getByRole("link", { name: "See how sign-up works" }));
    const dialog = await screen.findByRole("dialog", { name: "Create an account" });
    expect(dialog).toHaveAccessibleDescription(
      "Signing up creates your account. It doesn't create profiles or grant access automatically.",
    );

    const name = within(dialog).getByLabelText("Name");
    const password = within(dialog).getByLabelText("Password");
    const confirmation = within(dialog).getByLabelText("Confirm password");
    expect(password).toHaveAccessibleDescription("At least 12 characters.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Create account →" }));
    await waitFor(() => expectFieldError(name, "Enter your name."));
    expectFieldError(within(dialog).getByLabelText("Email"), "Enter your email.");
    expectFieldError(password, "Choose a password of at least 12 characters.");
    expectFieldError(confirmation, "Repeat the password.");

    fireEvent.change(name, { target: { value: "A" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.change(password, { target: { value: "short" } });
    fireEvent.change(confirmation, { target: { value: "other" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account →" }));

    await waitFor(() => expectFieldError(name, "Your name must be at least 2 characters."));
    expectFieldError(password, "Your password must be at least 12 characters.");
    expect(password).toHaveAccessibleDescription(expect.stringContaining("At least 12 characters."));
    expectFieldError(confirmation, "The passwords don't match.");
    expect(within(dialog).getByRole("button", { name: "I already have an account" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recuperación: email vacío, envío aceptado y vuelta al login en inglés", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const login = await openLogin();
    fireEvent.click(within(login).getByRole("link", { name: "Forgot your password?" }));
    const dialog = await screen.findByRole("dialog", { name: "Recover your password" });
    expect(dialog).toHaveAccessibleDescription("We'll send you instructions if the email belongs to an account.");

    const email = within(dialog).getByLabelText("Email");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send instructions →" }));
    await waitFor(() => expectFieldError(email, "Enter your email."));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    fireEvent.change(email, { target: { value: "unknown@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send instructions →" }));

    expect(await within(dialog).findByText("Check your email")).toBeVisible();
    expect(
      within(dialog).getByText("If the email belongs to an account, you'll receive instructions to reset your password."),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back to login" }));
    expect(await screen.findByRole("dialog", { name: "Welcome" })).toBeInTheDocument();
  });

  it("enlaces de la URL: verificación inválida y aviso de cierre local en inglés", async () => {
    window.history.replaceState({}, "", "/?auth=verify&logout=local");
    renderEnglish();

    const dialog = await screen.findByRole("dialog", { name: "Verify email" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The verification link isn't valid.");
    expect(within(dialog).getByRole("button", { name: "Go to login" })).toBeInTheDocument();
    expect(
      screen.getByText("You were logged out on this device. We couldn't confirm the session was revoked on the server."),
    ).toHaveAttribute("role", "status");
  });

  it("contacto: rótulos, opciones y mensajes de error en inglés (los de Laravel pasan tal cual)", async () => {
    document.cookie = "contactur_csrf=csrf-i18n-landing; Path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderEnglish();

    const form = screen.getByRole("form", { name: "Have a question?" }) as HTMLFormElement;
    expect(within(form).getByLabelText("Name")).toHaveAttribute("placeholder", "Your name");
    expect(within(form).getByLabelText("Email")).toHaveAttribute("placeholder", "you@email.com");
    expect(within(form).getByLabelText("Message")).toHaveAttribute("placeholder", "Tell us what you need");
    const category = within(form).getByLabelText("Category (optional)");
    expect(within(category).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "No category",
      "Access enquiry",
      "Profile sign-up",
      "General support",
      "Privacy or terms",
    ]);

    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "P" } });
    fireEvent.change(within(form).getByLabelText("Email"), { target: { value: "paula@example.test" } });
    fireEvent.change(within(form).getByLabelText("Message"), { target: { value: "Short" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send enquiry →" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "We couldn't send your enquiry. Try again in a few minutes.",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: { code: "rate_limited", message: "Too many requests." }, request_id: "req-i18n-429" },
      429,
      { "retry-after": "120" },
    ));
    fireEvent.click(within(form).getByRole("button", { name: "Send enquiry →" }));
    await waitFor(() => expect(within(form).getByRole("alert")).toHaveTextContent(
      "You've sent too many messages in a row. Wait 2 minutes and try again.",
    ));

    // Laravel ya responde en el idioma de la request: el mensaje por campo se muestra igual.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "validation_failed",
        message: "The given data was invalid.",
        fields: { name: ["The name field must be at least 2 characters."] },
      },
      request_id: "req-i18n-422",
    }, 422));
    fireEvent.click(within(form).getByRole("button", { name: "Send enquiry →" }));
    await waitFor(() => expect(within(form).getByRole("alert")).toHaveTextContent(
      "Check the highlighted fields in the form.",
    ));
    const name = within(form).getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("The name field must be at least 2 characters.");
    expect(within(form).queryByText(/We've received your enquiry/)).toBeNull();
  });
});
