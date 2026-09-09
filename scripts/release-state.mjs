import assert from "node:assert/strict";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const parts = version => {
  assert(stable.test(version), `Invalid stable version: ${version}`);
  return version.split(".").map(BigInt);
};

export function publicationState(version, pages) {
  const candidate = parts(version);
  assert(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), "Invalid release history response");
  const releases = pages.flat();
  for (const release of releases) {
    assert(release && typeof release === "object" && typeof release.tag_name === "string" &&
      typeof release.draft === "boolean" && typeof release.prerelease === "boolean", "Invalid release in history response");
  }
  const matches = releases.filter(release => release.tag_name === `v${version}`);
  assert(matches.length <= 1, "Multiple releases found for the same tag");
  const existing = matches[0] ?? null;
  if (existing && !existing.draft) return { existing };
  for (const release of releases.filter(release => !release.draft && !release.prerelease)) {
    const previous = parts(release.tag_name.replace(/^v/, ""));
    const difference = candidate.findIndex((value, index) => value !== previous[index]);
    assert(difference !== -1 && candidate[difference] > previous[difference],
      `Refusing to publish v${version}: ${release.tag_name} is already published`);
  }
  return { existing };
}
