import type { components } from "@/lib/api/generated";

export type ApiError = components["schemas"]["ErrorResponse"];
export type AuthSession = components["schemas"]["AuthSession"];
export type User = components["schemas"]["User"];

export type PublicAuthSession = {
  data: {
    user: User;
  };
};

export type CookieOptions = {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};
