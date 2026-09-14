/**
 * auth.ts: the auth layer for apps deployed behind Vercel Passport.
 *
 * This file is vendored. Copy it to lib/auth.ts and leave it as is, so you
 * can later refresh it from the canonical source:
 * https://raw.githubusercontent.com/remiconnesson/vercel-passport-skill/main/skills/vercel-passport/assets/auth.ts
 *
 * Version 1.0.0. No dependencies.
 *
 * How it works:
 * - Vercel Passport authenticates every visitor against the team's identity
 *   provider at the platform edge, before requests reach this app. There is
 *   no login page, OAuth flow, session table, or password to build.
 * - After authentication, Vercel injects a signed identity token into the
 *   x-vercel-oidc-passport-token request header. Vercel strips any
 *   client-supplied value for that header, so on a protected deployment the
 *   header can be trusted as-is.
 * - Locally there is no Passport. Set PASSPORT_DEV_USER in .env.local to
 *   simulate a signed-in user during development. The fallback is disabled
 *   in production builds, so it can never leak into a deployment.
 */

export type PassportUser = {
  /**
   * Stable visitor id (the token's `external_sub` claim, issued by the
   * identity provider). Key all per-user data by this — never by email,
   * which can change or be absent.
   */
  id: string;
  /** Only present when the identity provider returns it. Handle null. */
  email: string | null;
  /** Only present when the identity provider returns it. Handle null. */
  name: string | null;
  /** All claims from the Passport token, for anything beyond id/email/name. */
  claims: Record<string, unknown>;
  /** True when this user came from PASSPORT_DEV_USER, not a real session. */
  isDevFallback: boolean;
};

export class UnauthenticatedError extends Error {}

const HEADER = "x-vercel-oidc-passport-token";

/**
 * The signed-in visitor, or null when there is no identity.
 * Next.js App Router only (server components, server actions, route
 * handlers). In other contexts use getUserFromRequest().
 */
export async function getUser(): Promise<PassportUser | null> {
  // Imported lazily so this file also loads outside Next.js, where only
  // getUserFromRequest() is usable.
  const { headers } = await import("next/headers");
  const headerList = await headers();
  return userFromToken(headerList.get(HEADER));
}

/** Framework-agnostic variant: works anywhere you hold a Request. */
export function getUserFromRequest(request: Request): PassportUser | null {
  return userFromToken(request.headers.get(HEADER));
}

/**
 * Like getUser(), but throws UnauthenticatedError instead of returning null.
 * Use in code that must have a user (mutations, per-user reads).
 */
export async function requireUser(): Promise<PassportUser> {
  const user = await getUser();
  if (!user) {
    throw new UnauthenticatedError(
      "No Passport identity on this request. On Vercel: enable Passport in " +
        "Project Settings > Passport (Enterprise). Locally: set " +
        "PASSPORT_DEV_USER=you@example.com in .env.local.",
    );
  }
  return user;
}

function userFromToken(token: string | null): PassportUser | null {
  if (token) {
    const claims = decodeJwtPayload(token);
    if (claims && typeof claims.external_sub === "string") {
      return {
        id: claims.external_sub,
        email: typeof claims.email === "string" ? claims.email : null,
        name: typeof claims.name === "string" ? claims.name : null,
        claims,
        isDevFallback: false,
      };
    }
    return null;
  }

  // Local-development fallback. NODE_ENV is "production" on every Vercel
  // build (previews included), so this branch only runs on a dev machine,
  // and only when explicitly opted in via PASSPORT_DEV_USER.
  const devUser = process.env.PASSPORT_DEV_USER;
  if (process.env.NODE_ENV !== "production" && devUser) {
    return {
      id: `dev:${devUser}`,
      email: devUser.includes("@") ? devUser : null,
      name: devUser,
      claims: {},
      isDevFallback: true,
    };
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(payload, "base64url").toString("utf8")
        : new TextDecoder().decode(
            Uint8Array.from(
              atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
              (char) => char.charCodeAt(0),
            ),
          );
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
