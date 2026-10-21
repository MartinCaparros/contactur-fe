import type { Metadata } from "next";

import { PrivateApp } from "@/features/app/AppShell";

// D19: el directorio es visible solo a miembros y no se indexa.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SearchPage() {
  return <PrivateApp view="search" />;
}
