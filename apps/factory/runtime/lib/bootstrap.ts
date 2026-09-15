// Host-only bootstrap of a target for one v0 prototype, run before the migrator starts:
// generate the target repository from the shell template, create its git-linked Vercel
// project behind Passport, and deploy `main` (the bare shell) to production. Every step is
// idempotent: an existing repository or project is reused, a stale `dev` branch without an
// open pull request is cleared, and an open `dev` pull request blocks a second delivery.
// The credentials here (bootstrapEnv) are never available to a station.
import { z } from "zod";
import { WorkError } from "./work-github.ts";
import { bootstrapEnv, factoryBranch, githubOrganization, passportConnectorId, templateRepository, vercelTeamId } from "./factory-config.ts";

export interface BootstrapInput { repository: string; prototype: { repository: string; ref: string } }
export interface BootstrapResult {
  repository: string;
  repositoryUrl: string;
  prototype: { repository: string; ref: string; revision: string };
  templateRepository: string;
  projectName: string;
  projectId: string;
  productionUrl: string;
  deploymentId?: string;
  created: { repository: boolean; project: boolean; deployment: boolean };
  warnings: string[];
  at: string;
}

const repoName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);

/** software-factory-workshop/adeo-kanban-proto -> software-factory-workshop/adeo-kanban-nuxt */
export function deriveTargetRepository(prototype: string): string {
  const [owner, name] = repoName.parse(prototype).split("/") as [string, string];
  const stem = name.replace(/[-_.]?(proto(type)?|v0)$/i, "").replace(/[-_.]+$/, "") || name;
  return `${githubOrganization === owner ? owner : githubOrganization}/${stem}-nuxt`.toLowerCase();
}

function credential(name: string): string {
  const value = process.env[name];
  if (!value) throw new WorkError("bootstrap_unconfigured", `The host is missing ${name}; the target cannot be generated.`);
  return value;
}

async function github(token: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const response = await fetch(`https://api.github.com/${path}`, {
    method: init.method || (init.body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(30_000)]),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : null;
  return { status: response.status, ok: response.ok, data, message: typeof data?.message === "string" ? data.message : "" };
}

async function vercel(token: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("teamId", vercelTeamId);
  const response = await fetch(url, {
    method: init.method || (init.body === undefined ? "GET" : "POST"), redirect: "error",
    headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.any([init.signal || new AbortController().signal, AbortSignal.timeout(30_000)]),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : null;
  const error = data?.error as { message?: string; code?: string } | undefined;
  // The credential is described, never printed: length and prefix are enough to tell a stale or truncated value apart.
  const message = error ? `${error.code ? `${error.code}: ` : ""}${error.message || ""}${response.status === 403 ? ` (token ${token.length} chars, ${token.slice(0, 4)}…, via ${response.headers.get("x-vercel-id") || "?"})` : ""}` : "";
  return { status: response.status, ok: response.ok, data, message };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function bootstrapTarget(input: BootstrapInput, signal?: AbortSignal): Promise<BootstrapResult> {
  const repository = repoName.parse(input.repository);
  const [owner, name] = repository.split("/") as [string, string];
  if (owner !== githubOrganization) throw new WorkError("invalid_request", `Targets are generated inside ${githubOrganization} only.`);
  if (repository === input.prototype.repository || repository === templateRepository) throw new WorkError("invalid_request", "The target must differ from the prototype and the template.");
  const gh = credential(bootstrapEnv.github);
  const vc = credential(bootstrapEnv.vercel);
  const warnings: string[] = [];
  const created = { repository: false, project: false, deployment: false };

  // 1. The prototype must be readable at its ref; its revision is recorded on the delivery.
  const proto = await github(gh, `repos/${repoName.parse(input.prototype.repository)}/commits/${encodeURIComponent(input.prototype.ref)}`, { signal });
  if (!proto.ok) throw new WorkError("invalid_request", `Prototype ${input.prototype.repository}@${input.prototype.ref} is not readable (HTTP ${proto.status}${proto.message ? `: ${proto.message}` : ""}).`);
  const prototypeRevision = sha.parse(proto.data?.sha);

  // 2. Target repository: reuse, or generate from the template.
  let repo = await github(gh, `repos/${repository}`, { signal });
  if (repo.status === 404) {
    const generated = await github(gh, `repos/${templateRepository}/generate`, { signal, body: { owner, name, private: true, include_all_branches: false, description: `Nuxt migration of ${input.prototype.repository} (generated by the ADEO micro-factory)` } });
    if (!generated.ok) throw new WorkError("bootstrap_failed", `Could not generate ${repository} from ${templateRepository}: HTTP ${generated.status}${generated.message ? ` ${generated.message}` : ""}.`);
    created.repository = true;
    for (let attempt = 0; ; attempt += 1) {
      const main = await github(gh, `repos/${repository}/git/ref/heads/main`, { signal });
      if (main.ok) break;
      if (attempt >= 20) throw new WorkError("bootstrap_failed", `${repository} was generated but main is not readable yet; retry the same request.`);
      await sleep(1500);
    }
    repo = await github(gh, `repos/${repository}`, { signal });
  } else if (!repo.ok) throw new WorkError("bootstrap_failed", `Cannot read ${repository}: HTTP ${repo.status}${repo.message ? ` ${repo.message}` : ""}.`);
  const repoId = z.number().parse(repo.data?.id);
  const repositoryUrl = z.string().url().parse(repo.data?.html_url);

  // 3. The factory branch: an open PR from it belongs to another delivery; a stale ref is cleared.
  const branch = await github(gh, `repos/${repository}/git/ref/heads/${factoryBranch}`, { signal });
  if (branch.ok) {
    const open = await github(gh, `repos/${repository}/pulls?state=open&head=${owner}:${factoryBranch}&per_page=5`, { signal });
    const pulls = z.array(z.object({ number: z.number(), html_url: z.string() })).parse(open.data ?? []);
    if (pulls.length) throw new WorkError("target_busy", `${repository} already has an open pull request from ${factoryBranch} (#${pulls[0]!.number}). Merge or close it before starting another delivery for this prototype.`);
    const removed = await github(gh, `repos/${repository}/git/refs/heads/${factoryBranch}`, { signal, method: "DELETE" });
    if (!removed.ok) throw new WorkError("bootstrap_failed", `Could not clear the stale ${factoryBranch} branch in ${repository} (HTTP ${removed.status}).`);
    warnings.push(`A stale ${factoryBranch} branch without an open pull request was removed from ${repository}.`);
  }

  // 4. Vercel project, git-linked to the target, behind the same Passport connector as the cockpit.
  // When the Vercel credential is rejected but GitHub already shows Vercel deployments for this
  // repository, the project exists and is linked: the delivery proceeds on that evidence with a
  // warning instead of blocking (a fresh prototype still needs a valid token to create its project).
  const projectName = name.toLowerCase();
  let projectId = "";
  let deploymentId: string | undefined;
  let project = await vercel(vc, `/v9/projects/${projectName}`, { signal });
  if (project.status === 401 || project.status === 403) {
    const seen = await github(gh, `repos/${repository}/deployments?per_page=5`, { signal });
    const ghDeployments = z.array(z.object({ id: z.number(), environment: z.string(), sha: z.string() })).parse(seen.data ?? []);
    const production = ghDeployments.find(d => /^production$/i.test(d.environment));
    if (!production) throw new WorkError("bootstrap_unconfigured", `The Vercel credential ${bootstrapEnv.vercel} was rejected (${project.message || `HTTP ${project.status}`}) and ${repository} has no Vercel deployment yet. Create a token at vercel.com/account/tokens, set it on the cockpit project and redeploy.`);
    warnings.push(`Vercel credential rejected (${project.message || `HTTP ${project.status}`}); the project was verified through the ${ghDeployments.length} Vercel deployment(s) GitHub records for ${repository}. Set a valid ${bootstrapEnv.vercel} before migrating a new prototype.`);
    deploymentId = `github:${production.id}`;
    projectId = "verified-via-github";
  } else {
    if (project.status === 404) {
      project = await vercel(vc, "/v11/projects", { signal, body: { name: projectName, framework: "nuxtjs", gitRepository: { type: "github", repo: repository } } });
      if (!project.ok) throw new WorkError("bootstrap_failed", `Could not create the Vercel project ${projectName}: HTTP ${project.status}${project.message ? ` ${project.message}` : ""}.`);
      created.project = true;
    } else if (!project.ok) throw new WorkError("bootstrap_failed", `Cannot read the Vercel project ${projectName}: HTTP ${project.status}${project.message ? ` ${project.message}` : ""}.`);
    projectId = z.string().parse(project.data?.id);
    const link = project.data?.link as { repo?: string; org?: string } | undefined;
    if (link && link.org && link.repo && `${link.org}/${link.repo}` !== repository) throw new WorkError("target_busy", `Vercel project ${projectName} is linked to ${link.org}/${link.repo}, not ${repository}.`);
    if (!link?.repo) {
      const linked = await vercel(vc, `/v9/projects/${projectId}/link`, { signal, body: { type: "github", repo: repository } });
      if (!linked.ok) warnings.push(`Vercel project ${projectName} exists but could not be linked to ${repository}: ${linked.message || `HTTP ${linked.status}`}.`);
    }
    const passport = project.data?.passport as { connectorId?: string } | null | undefined;
    if (passport?.connectorId !== passportConnectorId) {
      const protectedProject = await vercel(vc, `/v9/projects/${projectId}`, { signal, method: "PATCH", body: { passport: { connectorId: passportConnectorId, deploymentType: "all" } } });
      if (!protectedProject.ok) warnings.push(`Passport could not be enabled on ${projectName}: ${protectedProject.message || `HTTP ${protectedProject.status}`}. Enable it by hand before opening the preview.`);
    }
    const attached = await vercel(vc, `/v1/connect/connectors/${passportConnectorId}/projects/${projectId}`, { signal, body: { environments: ["production", "preview", "development"] } });
    if (!attached.ok) warnings.push(`The Passport connector could not be attached to ${projectName}: ${attached.message || `HTTP ${attached.status}`}.`);

    // 5. Production is the shell on main until a person merges the factory's pull request. A
    // deployment created through the API for a repository linked seconds earlier stays BLOCKED
    // (observed 15 Sep, twice, no error code), so production is started the way Vercel expects:
    // a push. An empty commit on main (same tree) is enough; the git integration builds it.
    const existing = await vercel(vc, `/v6/deployments?projectId=${projectId}&target=production&limit=5`, { signal });
    const deployments = z.array(z.object({ uid: z.string(), state: z.string().optional() })).parse((existing.data?.deployments as unknown[]) ?? []);
    const live = deployments.find(d => ["READY", "BUILDING", "QUEUED", "INITIALIZING"].includes(d.state ?? ""));
    if (live) deploymentId = live.uid;
    else {
      const head = await github(gh, `repos/${repository}/git/ref/heads/main`, { signal });
      const headSha = sha.parse((head.data?.object as { sha?: string } | undefined)?.sha);
      const commit = await github(gh, `repos/${repository}/git/commits/${headSha}`, { signal });
      const tree = sha.parse((commit.data?.tree as { sha?: string } | undefined)?.sha);
      const pushed = await github(gh, `repos/${repository}/git/commits`, { signal, body: { message: `factory: deploy the shell on main for ${input.prototype.repository}\n\nEmpty commit that starts the production deployment of the generated target.`, tree, parents: [headSha] } });
      if (!pushed.ok) warnings.push(`Could not create the bootstrap commit on main: ${pushed.message || `HTTP ${pushed.status}`}.`);
      else {
        const moved = await github(gh, `repos/${repository}/git/refs/heads/main`, { signal, method: "PATCH", body: { sha: sha.parse(pushed.data?.sha), force: false } });
        if (!moved.ok) warnings.push(`Could not move main to the bootstrap commit: ${moved.message || `HTTP ${moved.status}`}.`);
        else {
          created.deployment = true;
          for (let attempt = 0; attempt < 20 && !deploymentId; attempt += 1) {
            await sleep(3000);
            const started = await vercel(vc, `/v6/deployments?projectId=${projectId}&target=production&limit=3`, { signal });
            deploymentId = z.array(z.object({ uid: z.string(), meta: z.record(z.string(), z.unknown()).optional() })).parse((started.data?.deployments as unknown[]) ?? []).find(d => d.meta?.githubCommitSha === pushed.data?.sha)?.uid;
          }
          if (!deploymentId) warnings.push("The push landed but Vercel has not reported its production deployment yet; it appears on the project shortly.");
        }
      }
    }
  }

  return {
    repository, repositoryUrl,
    prototype: { ...input.prototype, revision: prototypeRevision },
    templateRepository, projectName, projectId,
    productionUrl: `https://${projectName}.vercel.app`,
    deploymentId, created, warnings, at: new Date().toISOString(),
  };
}
