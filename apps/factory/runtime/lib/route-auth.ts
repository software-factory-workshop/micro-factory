import { localDev, vercelOidc, ForbiddenError, type AuthFn } from "eve/channels/auth";
import { z } from "zod";
import { passportProjectId } from "./factory-config.ts";
const claimsSchema = z.object({ external_sub: z.string().min(1), exp: z.number() });

// Vercel strips spoofed Passport headers and injects a verified visitor token.
// https://vercel.com/kb/guide/vercel-passport-nextjs
const passport: AuthFn = request => {
  if (process.env.VERCEL !== "1" || process.env.VERCEL_PROJECT_ID !== passportProjectId) return null;
  const token = request.headers.get("x-vercel-oidc-passport-token");
  if (!token) return null;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (origin && new URL(origin).host !== host) throw new ForbiddenError();
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString()));
    if (claims.exp * 1000 <= Date.now()) return null;
    return { authenticator: "oidc", principalId: claims.external_sub, principalType: "user", attributes: { provider: "vercel-passport" } };
  } catch { return null; }
};


export const factoryAuth = [passport, vercelOidc(), localDev()];
