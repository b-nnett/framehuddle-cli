import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function formula(version, sha256) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid release metadata");
  return `class Framehuddle < Formula
  desc "Projects, screenshot exports, and pinned feedback from the terminal"
  homepage "https://github.com/b-nnett/framehuddle-cli"
  url "https://github.com/b-nnett/framehuddle-cli/releases/download/v${version}/framehuddle-${version}.tgz"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    libexec.install "dist", "package.json", "THIRD_PARTY_LICENSES"
    (bin/"framehuddle").write_env_script formula_opt_bin("node")/"node", libexec/"dist/index.js", {}
  end

  def caveats
    <<~EOS
      Install the Framehuddle agent skill from your project directory:
        npx skills add b-nnett/framehuddle-cli --skill framehuddle

      Choose your coding agent when prompted, or add --global for all projects.
      Setup and examples: https://framehuddle.com/api-docs
    EOS
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/framehuddle --version").strip
    assert_match "exports import", shell_output("#{bin}/framehuddle --help")
    system bin/"framehuddle", "init", "--project", "11111111-1111-4111-8111-111111111111"
    config = JSON.parse((testpath/"framehuddle.config.json").read)
    assert_equal "11111111-1111-4111-8111-111111111111", config["projectId"]
  end
end
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive, destination] = process.argv.slice(2);
  if (!archive || !destination) throw new Error("Usage: node scripts/formula.mjs ARCHIVE DESTINATION");
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  // Never let a rerun of an older tag downgrade the Homebrew formula.
  let previous = "";
  try { previous = await readFile(destination, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const old = previous.match(/releases\/download\/v(\d+\.\d+\.\d+)\//)?.[1];
  if (old) {
    const a = old.split(".").map(Number), b = version.split(".").map(Number);
    const differing = a.findIndex((value, index) => value !== b[index]);
    if (differing !== -1 && a[differing] > b[differing]) throw new Error(`Refusing to downgrade Homebrew from ${old} to ${version}`);
  }
  const sha = createHash("sha256").update(await readFile(archive)).digest("hex");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, formula(version, sha));
}
