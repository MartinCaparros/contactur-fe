import Image from "next/image";

import styles from "./BrandMark.module.css";

/**
 * Isotipo de Contactur recortado de `references/brand/logo-02.webp` (140 × 92 px, ~2 KB).
 * Los íconos del navegador (`src/app/favicon.ico`, `icon.png`, `apple-icon.png`) usan la
 * versión blanca sobre el azul de marca de `logo-03`; los correos, `logo-01`.
 */
export const BRAND_MARK_SRC = "/brand/contactur-mark.webp";
const BRAND_MARK_WIDTH = 140;
const BRAND_MARK_HEIGHT = 92;

/**
 * Isotipo para headers, footer y modal de acceso. Es decorativo (`alt=""`): el nombre
 * accesible lo da el enlace que lo contiene o el texto "Contactur" que lo acompaña.
 * `unoptimized` porque el archivo ya está recortado y no gana nada con el optimizador.
 */
export function BrandMark({ className }: Readonly<{ className?: string }>) {
  return (
    <Image
      className={className ? `${styles.mark} ${className}` : styles.mark}
      src={BRAND_MARK_SRC}
      alt=""
      width={BRAND_MARK_WIDTH}
      height={BRAND_MARK_HEIGHT}
      loading="eager"
      unoptimized
    />
  );
}
