import { readFileSync } from "node:fs";
import { join } from "node:path";

import { screen, within } from "@testing-library/dom";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import HomePage from "../app/(public)/page";
import { BRAND_MARK_SRC } from "../lib/brand/BrandMark";

/**
 * T27 — logos oficiales. Next toma los íconos por convención de nombre (`src/app/favicon.ico`,
 * `icon.png`, `apple-icon.png`) y el isotipo sale de `public/`: si un archivo se renombra o se
 * pierde, no hay error de build, solo desaparece la marca. Estos tests lo atrapan.
 */
const ROOT = join(__dirname, "..", "..");

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
});

/** Ancho y alto del encabezado PNG (IHDR). */
function pngSize(path: string): readonly [number, number] {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/**
 * Ancho y alto de un WebP sin pérdida (VP8L, como lo genera `cwebp -lossless`) y si usa
 * transparencia: el isotipo va sobre headers oscuros y no puede traer fondo.
 */
function losslessWebp(path: string): Readonly<{ width: number; height: number; alpha: boolean }> {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(bytes.subarray(8, 16).toString("latin1")).toBe("WEBPVP8L");
  const bits = bytes.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
}

describe("T27 — logos oficiales de Contactur", () => {
  it("la landing usa el isotipo oficial en header, footer y sin el cuadro de iniciales", () => {
    render(<HomePage />);
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();

    for (const region of [header as HTMLElement, footer as HTMLElement]) {
      const marks = Array.from(region.querySelectorAll("img")).filter((image) => image.getAttribute("src") === BRAND_MARK_SRC);
      expect(marks).toHaveLength(1);
      // Decorativo: el nombre lo da el texto "Contactur" que lo acompaña.
      expect(marks[0]).toHaveAttribute("alt", "");
      expect(marks[0]).toHaveAttribute("width", "140");
      expect(marks[0]).toHaveAttribute("height", "92");
      expect(within(region).queryByText("CT", { exact: true })).toBeNull();
    }
    expect(within(header as HTMLElement).getByRole("link", { name: "Contactur" })).toHaveAttribute("href", "#inicio");
    expect(screen.queryAllByRole("img", { name: "" })).toHaveLength(0);
  });

  it("los archivos de marca existen con las medidas que esperan el componente, Next y los correos", () => {
    expect(losslessWebp(join(ROOT, "public", BRAND_MARK_SRC))).toEqual({ width: 140, height: 92, alpha: true });
    // Correo (logo-01 recortado): el HTML del mail fija 120 × 48.
    expect(pngSize(join(ROOT, "public/brand/contactur-logo-email.png"))).toEqual([120, 48]);
    expect(pngSize(join(ROOT, "src/app/icon.png"))).toEqual([192, 192]);
    expect(pngSize(join(ROOT, "src/app/apple-icon.png"))).toEqual([180, 180]);

    const favicon = readFileSync(join(ROOT, "src/app/favicon.ico"));
    // ICONDIR: reservado 0, tipo 1 (ícono) y tres tamaños (16, 32 y 48 px).
    expect([favicon.readUInt16LE(0), favicon.readUInt16LE(2), favicon.readUInt16LE(4)]).toEqual([0, 1, 3]);
    const sizes = [0, 1, 2].map((index) => favicon.readUInt8(6 + index * 16));
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });
});
