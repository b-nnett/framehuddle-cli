# Releasing Framehuddle

The source of truth is this standalone repository. Stable releases use semantic versions (`X.Y.Z`) and annotated Git tags (`vX.Y.Z`). The npm package and bundled CLI both take their version from `package.json`.

## Ship a version

1. Make changes and add their release notes under `## Unreleased` in `CHANGELOG.md`.
2. Merge/push those changes to `main`. Wait for CI to pass.
3. On a clean checkout of `main`, run:

   ```sh
   npm ci
   npm run release -- patch
   # Or: minor, major, or an explicit increasing version such as 0.2.0
   ```

The script verifies that local `main` matches GitHub, updates package and lockfile versions, dates the changelog, runs all checks, commits, creates an annotated tag, and atomically pushes the commit and tag. A failed check leaves the proposed files available for inspection; no tag is pushed. If the atomic push fails after the local release commit/tag exists, fix the remote divergence and push the reviewed commit/tag manually; do not blindly run a second version bump.

## Automated pipeline

A version tag triggers `.github/workflows/release.yml`:

1. Run type checking, tests, build, and standalone-package smoke tests on macOS and Linux with Node 24 and 26.
2. Install and test the candidate package through a temporary Homebrew tap on macOS and Linux before publication. Verify the tag matches `package.json` and its commit belongs to `main`.
3. Build the executable from the locked dependencies. Package only the executable, package metadata, documentation, and licenses.
4. Publish a GitHub Release with a universal `framehuddle-X.Y.Z.tgz` package and `SHA256SUMS`. GitHub also provides tagged source archives.
5. Update `b-nnett/homebrew-framehuddle` with the versioned download URL and computed checksum. The tap runs its own macOS/Linux install tests.

Users receive updates with `brew update && brew upgrade framehuddle`. The package is distributed through GitHub Releases and Homebrew; this pipeline does not publish to the npm registry.

## Credentials and maintenance

The source repository uses its built-in `GITHUB_TOKEN` with `contents: write` only in the publish job. `HOMEBREW_TAP_DEPLOY_KEY` is an SSH key whose public half is registered as a write-enabled deploy key **only on the Homebrew tap repository**. It grants no access to the app repository or other projects. CI for pull requests has read-only permissions and no deploy key.

To rotate the deploy key, create a new Ed25519 key, register its public half under the tap's Settings → Deploy keys with write access, set the private half as the source repository's `HOMEBREW_TAP_DEPLOY_KEY` Actions secret, then remove the old deploy key. Never commit keys.

GitHub Actions and npm dependencies are checked weekly by Dependabot. Review and merge its updates through CI.

## Recovery

- Re-run a failed release from Actions, or `gh workflow run release.yml --ref vX.Y.Z`.
- This workflow never replaces published assets. A rerun checks the existing bytes and resumes the tap update. This is a workflow guarantee; GitHub-enforced immutable releases are a separate repository setting.
- Before creating or repairing a draft, publication must successfully read the complete release history, including drafts. A successful empty history permits the first release; API, authentication, malformed-response, and network failures abort publication. Both new releases and recovered drafts must be newer than every published stable release.
- Older already-published releases may have their assets verified without changing GitHub's latest marker; the tap's downgrade guard still prevents replacing a newer Homebrew version.
- The formula generator refuses to downgrade a newer tap version when an older workflow is rerun.
- Do not move or delete a published tag. Fix a bad release with a new patch version.
- If users need to hold a known-good installed release, they can use `brew pin framehuddle` and later `brew unpin framehuddle`.
- The first release is bootstrapped by pushing the reviewed initial source commit and an annotated `v0.1.0` tag; subsequent releases use the script above.
