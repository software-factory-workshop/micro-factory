// Minimal tar.gz reader for GitHub repository archives. One archive request replaces one
// REST call per file, which is what kept a run at ~300 GitHub API calls against a 5000/h
// installation budget shared by every station and every participant.
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

export type TarEntry = { path: string; mode: string; content: Buffer };

function octal(buffer: Buffer, start: number, length: number): number {
  const text = buffer.subarray(start, start + length).toString("ascii").replace(/\0.*$/s, "").trim();
  return text === "" ? 0 : parseInt(text, 8);
}
function str(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
}
function paxPath(data: Buffer): string | undefined {
  // pax records: "<len> key=value\n"
  let offset = 0; let found: string | undefined;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset); if (space < 0) break;
    const length = Number(data.subarray(offset, space).toString("ascii")); if (!Number.isFinite(length) || length <= 0) break;
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const eq = record.indexOf("="); if (eq > 0 && record.slice(0, eq) === "path") found = record.slice(eq + 1);
    offset += length;
  }
  return found;
}

/** Parse a gzip'd tar. Regular files only; the first path segment (GitHub's `owner-repo-sha/`) is stripped. */
export function readTarGz(archive: Buffer): TarEntry[] {
  const tar = gunzipSync(archive);
  const entries: TarEntry[] = [];
  let offset = 0; let longName: string | undefined; let paxName: string | undefined;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const name = str(header, 0, 100); const prefix = str(header, 345, 155);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = data.toString("utf8").replace(/\0+$/, ""); continue; }
    if (type === "x") { paxName = paxPath(data); continue; }
    if (type === "g") continue;
    const fullName = paxName ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined; paxName = undefined;
    if (type !== "0" && type !== "\0" && type !== "7") continue; // directories, links, pax globals
    const stripped = fullName.split("/").slice(1).join("/");
    if (!stripped) continue;
    const mode = (octal(header, 100, 8) & 0o111) ? "100755" : "100644";
    entries.push({ path: stripped, mode, content: Buffer.from(data) });
  }
  return entries;
}

/** Git blob object id for content, to check an archive entry against the tree the host already read. */
export function gitBlobSha(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}
