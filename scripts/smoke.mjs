import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const directory = await mkdtemp(join(tmpdir(), "framehuddle-package-"));
try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], { encoding: "utf8" }));
  const allowed = new Set(["package.json", "README.md", "LICENSE", "THIRD_PARTY_LICENSES", "dist/index.js"]);
  assert(packed[0].files.every(file => allowed.has(file.path)), "Unexpected file in public package");
  const prefix = join(directory, "installation");
  execFileSync("npm", ["install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed[0].filename)], { stdio: "pipe" });
  const entry = join(prefix, "node_modules", "framehuddle", "dist", "index.js");
  assert.equal(execFileSync(process.execPath, [entry, "--version"], { cwd: directory, encoding: "utf8" }).trim(), pkg.version);
  assert.match(execFileSync(process.execPath, [entry, "--help"], { cwd: directory, encoding: "utf8" }), /exports import/);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("FRAMEHUDDLE_") || key.startsWith("VF_")) delete env[key];
  const result = spawnSync(process.execPath, [entry, "projects", "list", "--json"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(JSON.parse(result.stderr).error, /API_KEY/);
  console.log(`Verified standalone framehuddle ${pkg.version} package.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
