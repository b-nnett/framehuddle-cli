import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Stable semantic version required");
await mkdir("release-assets", { recursive: true });
const packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", "release-assets"], { encoding: "utf8" }));
const filename = packed[0].filename;
const digest = createHash("sha256").update(await readFile(`release-assets/${filename}`)).digest("hex");
await writeFile("release-assets/SHA256SUMS", `${digest}  ${filename}\n`);
await writeFile("release-assets/NOTES.md", `Install with Homebrew:\n\n\`\`\`sh\nbrew install b-nnett/framehuddle/framehuddle\n\`\`\`\n\nUpgrade with \`brew update && brew upgrade framehuddle\`.\n\nThe package runs on macOS and Linux with Node.js 24 or later. Homebrew installs Node automatically. You can also download \`${filename}\`, verify it with \`shasum -a 256 -c SHA256SUMS\`, and run \`npm install -g ./${filename}\`.\n\nSee [CHANGELOG.md](https://github.com/b-nnett/framehuddle-cli/blob/v${version}/CHANGELOG.md) for changes.\n`);
console.log(`Prepared ${filename} (${digest})`);
