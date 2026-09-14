import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTarGz, gitBlobSha } from "../runtime/lib/tarball.ts";
const exec = promisify(execFile);

test("tar.gz archives read like GitHub tarballs: first segment stripped, modes, long paths, blob ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "factory-tar-"));
  try {
    const root = join(dir, "owner-repo-abc1234");
    const deep = "a".repeat(60) + "/" + "b".repeat(60) + "/" + "c".repeat(40) + ".txt";
    await mkdir(join(root, "server", "utils"), { recursive: true });
    await mkdir(join(root, deep, ".."), { recursive: true });
    await writeFile(join(root, "server", "utils", "todos.ts"), "export const x = 1;\n");
    await writeFile(join(root, "scripts.sh"), "#!/bin/sh\necho hi\n"); await chmod(join(root, "scripts.sh"), 0o755);
    await writeFile(join(root, deep), "deep");
    await exec("tar", ["-czf", join(dir, "a.tgz"), "-C", dir, "owner-repo-abc1234"]);
    const entries = readTarGz(await readFile(join(dir, "a.tgz")));
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    assert.equal(byPath.get("server/utils/todos.ts")?.content.toString(), "export const x = 1;\n");
    assert.equal(byPath.get("server/utils/todos.ts")?.mode, "100644");
    assert.equal(byPath.get("scripts.sh")?.mode, "100755");
    assert.equal(byPath.get(deep)?.content.toString(), "deep");
    assert.ok(!entries.some(entry => entry.path.startsWith("owner-repo")));
    // Git's blob id for known content ("hello\n" -> ce0136...).
    assert.equal(gitBlobSha(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
