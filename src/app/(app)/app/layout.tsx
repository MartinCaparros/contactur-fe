import type { ReactNode } from "react";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type AppLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function AppLayout({ children }: AppLayoutProps) {
  return children;
}
