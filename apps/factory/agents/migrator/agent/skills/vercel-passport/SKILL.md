---
name: vercel-passport
description: Add the auth layer to an app deployed behind Vercel Passport. Use whenever the app needs login, sign-in, the current user, protected routes, or per-user data and it deploys on a Vercel Enterprise team with Passport — the platform authenticates every visitor at the edge, so the app only reads a verified identity header. Never build login pages, OAuth flows, or password storage for these apps.
---

# vercel-passport: auth without building auth

Apps on this team deploy behind Vercel Passport. Passport authenticates every
visitor against the organization's identity provider (Okta, Auth0, any OIDC
provider) before a request ever reaches the app. By the time your code runs,
the visitor is already signed in.

So the entire auth layer of the app is: read the verified identity from a
request header. Do not add NextAuth, Clerk, Better Auth, password forms,
signup flows, or a users table for authentication. If a task says "add login"
or "users should sign in", it is already done at the platform level — your job
is only to use the identity.

How the identity reaches you: Vercel injects a signed token into the
`x-vercel-oidc-passport-token` request header on every authenticated request.
Vercel strips any client-supplied value for that header, so on a protected
deployment it can be trusted. The stable user id is the token's
`external_sub` claim; email and name are present only if the identity
provider shares them.

## Setup

1. Passport must be enabled on the Vercel project (Project Settings >
   Passport, an Enterprise feature). When the team has a Passport default,
   brand-new projects deploy already protected — nothing to enable per
   project. If `getUser()` returns null on a deployed app, this toggle is
   the first thing to check. There is nothing to install or configure in
   code.

2. Add the auth helper. Copy `assets/auth.ts` (next to this SKILL.md) into
   the project as `lib/auth.ts`, verbatim. If you can't locate the skill
   folder, download the canonical copy:

   ```bash
   curl -fsSL -o lib/auth.ts https://raw.githubusercontent.com/remiconnesson/vercel-passport-skill/main/skills/vercel-passport/assets/auth.ts
   ```

3. For local dev (no Passport on localhost), add a pretend user to
   `.env.local`:

   ```bash
   PASSPORT_DEV_USER=you@example.com
   ```

   The fallback only activates in development builds; deployed apps never
   use it.

## API

```ts
import { getUser, requireUser, getUserFromRequest, UnauthenticatedError } from "@/lib/auth";

const user = await getUser();        // PassportUser | null — server components, actions, route handlers
const user = await requireUser();    // PassportUser — throws UnauthenticatedError when absent
const user = getUserFromRequest(request); // framework-agnostic, for middleware/non-Next code

user.id;      // stable id from the identity provider — key all per-user data by this
user.email;   // string | null — only if the identity provider shares it
user.name;    // string | null — same
user.claims;  // every claim in the Passport token
user.isDevFallback; // true when this is the PASSPORT_DEV_USER stand-in
```

Semantics worth knowing:

- Server-side only. The token header never reaches the browser; there is no
  client-side "session". A client component that needs the user gets it as a
  prop from a server component.
- `email` and `name` are not guaranteed — render fallbacks (`user.name ??
  user.email ?? "there"`), and never use email as a storage key (`user.id`
  is the stable identifier).
- `getUser()` returning null on a deployed app means Passport is not enabled
  on that project — it is not a code problem.

## What's in the token (verified on a live Passport deployment)

`user.claims` contains the full token payload. Claims you can use beyond
`external_sub`/`email`/`name`:

| Claim | Example | Notes |
|---|---|---|
| `environment` | `"production"` | Or `"preview"` — which deployment the visitor is on |
| `project`, `owner` | project and team slugs | Handy for logging |
| `email_verified` | `true` | Only when the identity provider shares it |
| `sub` | `owner:<team_id>:connector:<connector_id>:principal:<external_sub>` | Vercel's composite id; prefer `external_sub` |
| `iss` | `https://passport.vercel.com/<team-slug>` | |
| `iat`, `exp` | ~12 hours apart | Vercel manages session renewal; read identity per request, don't cache it across sessions |

The authorization request to the identity provider asks for the
`openid email profile` scopes, so providers like Okta typically do share
email and name — but keep the null-safe rendering anyway.

## Recipes

### Personalized server component

```tsx
// app/page.tsx
import { getUser } from "@/lib/auth";

export default async function Home() {
  const user = await getUser();
  return <main>Welcome, {user?.name ?? user?.email ?? "there"}!</main>;
}
```

### Route handler that requires a user

```ts
// app/api/me/route.ts
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json({ id: user.id, email: user.email, name: user.name });
}
```

### Per-user data

Key records by `user.id`. If the project also has the vercel-blob-db skill
(a data layer on Vercel Blob), they compose directly:

```ts
// app/actions.ts
"use server";
import { requireUser } from "@/lib/auth";
import { getCollection } from "@/lib/blob-db";

type Preferences = { theme: string };
const preferences = getCollection<Preferences>("preferences");

export async function saveTheme(theme: string) {
  const user = await requireUser();
  await preferences.set(user.id, { theme }); // one record per user
}
```

### Simple authorization (allowlist or claim check)

Passport answers "who is this?"; the app decides "what may they do?". Keep it
simple:

```ts
import { requireUser } from "@/lib/auth";

const ADMINS = new Set(["alice@example.com", "bob@example.com"]);

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.email || !ADMINS.has(user.email)) {
    throw new Error("Admins only");
  }
  return user;
}
```

If the identity provider sends roles or groups, they appear in `user.claims`
— inspect `JSON.stringify(user.claims)` once in dev to see what's available.

## Rules

- Never build a second authentication system (NextAuth, Clerk, Better Auth,
  password forms, magic links) into an app behind Passport. One exception:
  if the task explicitly targets a public-facing app on a non-Enterprise
  project, Passport doesn't apply — say so instead of forcing it.
- Read identity only through `lib/auth.ts`. Don't parse the header or the
  `_vercel_passport` cookie by hand elsewhere.
- Never key data by email or name; use `user.id`.
- Never send the raw token to the browser or log it. Pass plain fields
  (`id`, `name`, `email`) to client components instead.
- Trust the header only inside the app itself. If you forward requests to
  another service, that service must not blindly trust a header it didn't
  receive from Vercel.

## Troubleshooting

- `getUser()` is null locally: set `PASSPORT_DEV_USER` in `.env.local` and
  restart the dev server.
- `getUser()` is null on the deployment: Passport isn't enabled for that
  project (Project Settings > Passport), or the visitor reached the app
  through an unprotected URL.
- `email`/`name` are null on real users: the identity provider isn't sharing
  profile claims — the IdP application needs the `profile`/`email` scopes.
  Design UI to work with nulls either way.
- Passport toggle missing in settings: the project isn't on an Enterprise
  team with Passport access — ask the team admin (or the hackathon
  organizers).

## Limits, honestly

Passport is authentication only — roles and permissions are the app's job
(see the authorization recipe). It is an Enterprise feature configured by
team admins, not something code can enable. Profile claims depend entirely
on the identity provider. And this skill targets Next.js App Router apps;
for other frameworks, `getUserFromRequest(request)` works anywhere a
standard `Request` exists.
