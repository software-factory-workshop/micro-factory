import { createHash } from 'node:crypto';
import { githubInput } from './github-input.mjs';
import { readTarGz, gitBlobSha } from './tarball.ts';
import { factoryModelIds, factoryRepository, prototypeRepository, passportProjectId, vercelTeamId, vercelTeamName } from './factory-config.ts';

export const repository = factoryRepository;
export const scope = { team: vercelTeamName, teamId: vercelTeamId, projectId: passportProjectId };
export const model = factoryModelIds.migrator;

export function verifyGatewayScope(oidc, apiKey) {
  if (apiKey) throw new Error("The factory uses project OIDC for AI Gateway. Unset AI_GATEWAY_API_KEY before running this agent.");
  return verifyScope(oidc);
}

export function verifyScope(oidc) {
  const claims = JSON.parse(Buffer.from(oidc.split('.')[1], 'base64url').toString());
  if (claims.owner !== scope.team || claims.owner_id !== scope.teamId || claims.project_id !== scope.projectId || !Number.isFinite(claims.exp) || claims.exp * 1000 < Date.now() + 300000) {
    throw new Error('Wrong team/project or expiring OIDC token; refusing to spend.');
  }
  return claims;
}

async function github(path, token, signal, repo = repository) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(20000)]),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub read failed: HTTP ${response.status}`);
  return { data: await response.json(), next: response.headers.get('link')?.includes('rel="next"') };
}

export async function readGithub(input, token, signal) {
  const { resource, number } = githubInput.parse(input);
  const endpoint = resource === 'issue_comments' ? `issues/${number}/comments` : resource;
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const { data, next } = await github(`${endpoint}?state=all&per_page=100&page=${page}`, token, signal);
    if (!Array.isArray(data)) throw new Error('Unexpected GitHub inventory response.');
    items.push(...data.map(item => ({ number: item.number, url: item.html_url, title: item.title, body: item.body, state: item.state, updatedAt: item.updated_at, labels: item.labels?.map(label => label.name), isPullRequest: !!item.pull_request })));
    if (!next) return { repository, resource, capturedAt: new Date().toISOString(), complete: true, items };
  }
  throw new Error('GitHub inventory exceeds the bounded pagination limit.');
}

export function includeSource(file) {
  return !file.startsWith('factory/evidence/') && !file.split('/').some(part => part === '.git' || part === '.eve' || part === '.vercel' || part === 'evals' || part === 'node_modules' || part.startsWith('.env')) && !file.endsWith('.pem') && !file.endsWith('.key');
}

export function manifestFor(entries) {
  return entries.map(({ file, content }) => ({ file, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }));
}


// One archive request per revision instead of one blob request per file; every entry is checked
// against the blob id the tree names, and a missing or different entry falls back to git/blobs.
async function archiveEntries(token, repo, revision, signal) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/tarball/${revision}`, {
      redirect: 'follow',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok) return undefined;
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > 200000000) return undefined;
    return new Map(readTarGz(archive).map(entry => [entry.path, entry.content]));
  } catch {
    return undefined;
  }
}

export async function loadRepository(token, signal, repo = repository, ref = 'main') {
  const { data: commit } = await github(`commits/${ref}`, token, signal, repo);
  if (!/^[a-f0-9]{40}$/.test(commit.sha) || !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)) throw new Error('Invalid repository revision.');
  const { data: tree } = await github(`git/trees/${commit.commit.tree.sha}?recursive=1`, token, signal, repo);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Repository tree is incomplete.');
  const selected = tree.tree.filter(item => item.type === 'blob' && item.mode !== '120000' && includeSource(item.path));
  if (selected.length > 1500 || selected.reduce((sum, item) => sum + (item.size ?? 0), 0) > 50000000) throw new Error('Source snapshot exceeds the station limit.');
  const archived = await archiveEntries(token, repo, commit.sha, signal);
  const entries = [];
  for (let offset = 0; offset < selected.length; offset += 6) {
    entries.push(...await Promise.all(selected.slice(offset, offset + 6).map(async item => {
      if (!/^[a-f0-9]{40}$/.test(item.sha) || item.path.split('/').includes('..') || item.path.startsWith('/')) throw new Error('Invalid source path.');
      const fromArchive = archived?.get(item.path);
      if (fromArchive && gitBlobSha(fromArchive) === item.sha) return { file: item.path, content: fromArchive };
      const { data: blob } = await github(`git/blobs/${item.sha}`, token, signal, repo);
      if (blob.encoding !== 'base64') throw new Error('Unsupported source encoding.');
      return { file: item.path, content: Buffer.from(blob.content, 'base64') };
    })));
  }
  return { revision: commit.sha, repository: repo, entries };
}

export { prototypeRepository };
