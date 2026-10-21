import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";

import { useAccountLocale } from "@/features/app/accountLocale";
import { ApiRequestError } from "@/features/app/api";
import { backendHeaders, callBackendJson } from "@/lib/bff/transport";
import { localeFromCookieHeader, normalizeLocale } from "@/lib/i18n/config";
import { LanguageSwitch } from "@/lib/i18n/LanguageSwitch";
import { useLocale, useT } from "@/lib/i18n/LocaleProvider";
import { translate } from "@/lib/i18n/translate";

import { inLocale, setLocaleCookie } from "./i18n";

afterEach(() => {
  cleanup();
  setLocaleCookie(null);
  document.documentElement.lang = "es";
  vi.restoreAllMocks();
});

function LanguageProbe() {
  const t = useT();
  return <p data-testid="probe">{t("Idioma")}</p>;
}

describe("i18n — traducción", () => {
  it("español devuelve el texto fuente; inglés su traducción, con parámetros", () => {
    expect(translate("es", "Idioma")).toBe("Idioma");
    expect(translate("en", "Idioma")).toBe("Language");
    expect(translate("en", "Cambiar el idioma a {language}", { language: "English" })).toBe("Switch language to English");
    expect(translate("es", "Cambiar el idioma a {language}", { language: "Español" })).toBe("Cambiar el idioma a Español");
  });

  it("sin traducción muestra el español en vez de romper la pantalla", () => {
    expect(translate("en", "Texto que nadie tradujo")).toBe("Texto que nadie tradujo");
  });

  it("solo hay dos idiomas: cualquier inglés es en, el resto es", () => {
    expect(normalizeLocale("en-GB")).toBe("en");
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("es-AR")).toBe("es");
    expect(normalizeLocale("fr")).toBe("es");
    expect(normalizeLocale(undefined)).toBe("es");
    expect(localeFromCookieHeader("a=1; contactur_locale=en; b=2")).toBe("en");
    expect(localeFromCookieHeader("contactur_locale=xx")).toBe("es");
    expect(localeFromCookieHeader(null)).toBe("es");
  });
});

describe("i18n — selector ES | EN", () => {
  it("cambia toda la interfaz sin recargar, recuerda la cookie y actualiza <html lang>", async () => {
    render(inLocale("es", <><LanguageSwitch /><LanguageProbe /></>));
    const group = screen.getByRole("group", { name: "Idioma" });
    const spanish = screen.getByRole("button", { name: "ES Español" });
    const english = screen.getByRole("button", { name: "EN English" });
    expect(group).toBeInTheDocument();
    expect(spanish).toHaveAttribute("aria-pressed", "true");
    expect(english).toHaveAttribute("aria-pressed", "false");
    expect(english).toHaveAttribute("lang", "en");
    expect(screen.getByTestId("probe")).toHaveTextContent("Idioma");

    fireEvent.click(english);

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("Language"));
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EN English" })).toHaveAttribute("aria-pressed", "true");
    expect(document.cookie).toContain("contactur_locale=en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("onChange solo se llama al cambiar de verdad (no al repetir el idioma activo)", () => {
    const onChange = vi.fn();
    render(inLocale("es", <LanguageSwitch onChange={onChange} />));
    fireEvent.click(screen.getByRole("button", { name: "ES Español" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "EN English" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });
});

function AccountProbe({ user }: Readonly<{ user: { id: string; locale?: "es-AR" | "en" } | null }>) {
  const locale = useLocale();
  const persist = useAccountLocale(user);
  return (
    <>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => persist("es")}>guardar</button>
    </>
  );
}

describe("i18n — idioma de la cuenta", () => {
  it("al cargar la cuenta, su idioma manda una sola vez y elegir otro lo guarda con PATCH /me", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/api/auth/csrf")) {
        return new Response(JSON.stringify({ data: { csrf_token: "csrf-i18n" } }), { headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 422, headers: { "content-type": "application/json" } });
    });
    const user = { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", locale: "en" as const };
    const { rerender } = render(inLocale("es", <AccountProbe user={user} />));
    await waitFor(() => expect(screen.getByTestId("locale")).toHaveTextContent("en"));

    // Un re-render con la misma cuenta no vuelve a imponer su idioma.
    rerender(inLocale("es", <AccountProbe user={{ ...user }} />));
    expect(screen.getByTestId("locale")).toHaveTextContent("en");

    fireEvent.click(screen.getByRole("button", { name: "guardar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/backend/v1/me", expect.objectContaining({ method: "PATCH" })));
    const patch = fetchMock.mock.calls.find(([input]) => String(input) === "/api/backend/v1/me");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ locale: "es-AR" });
  });
});

describe("i18n — API y BFF", () => {
  it("el BFF manda a Laravel el idioma de la cookie (nunca el Accept-Language del navegador)", () => {
    const english = new NextRequest("https://contactur.test/api/backend/v1/me", {
      headers: { cookie: "contactur_locale=en", "accept-language": "de-DE" },
    });
    const spanish = new NextRequest("https://contactur.test/api/backend/v1/me", { headers: { "accept-language": "en-US" } });
    expect(backendHeaders(english, null).get("accept-language")).toBe("en");
    expect(backendHeaders(spanish, null).get("accept-language")).toBe("es");
  });

  it("las acciones de auth del BFF también envían el idioma", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    await callBackendJson("auth/register", { name: "Ana" }, null, undefined, null, "en");
    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("accept-language")).toBe("en");
  });

  it("los mensajes fijos del cliente se traducen al idioma activo; los de Laravel quedan como llegan", () => {
    setLocaleCookie("en");
    expect(new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502).message)
      .toBe("The server response wasn't in the expected format.");
    expect(new ApiRequestError("The email field is required.", 422).message).toBe("The email field is required.");
    setLocaleCookie(null);
    expect(new ApiRequestError("La respuesta del servidor no tiene el formato esperado.", 502).message)
      .toBe("La respuesta del servidor no tiene el formato esperado.");
  });
});
