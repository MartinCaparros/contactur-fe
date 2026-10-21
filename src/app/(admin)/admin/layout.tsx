import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type AdminLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function AdminLayout({ children }: AdminLayoutProps) {
  return children;
}
