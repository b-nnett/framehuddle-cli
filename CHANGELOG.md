# Changelog

## Unreleased

- Publish an installable Framehuddle agent skill with feedback, screenshot, thread, and export workflows.
- Show the skill installation command and setup link after Homebrew installs and upgrades.

## 0.1.3 — 2026-09-09

- Require successful, complete release-history validation before publishing new releases or recovering drafts; prevent older versions replacing newer releases.
- Report the current root pin consistently for feedback replies and accept uppercase UUIDs when replying.
- Bound import files before parsing, validate image budgets before decoding, and handle large base64 images with a simple character scan.
- Preserve HTTP status codes for null and other unexpected JSON error bodies.
- Correct direct-download installation instructions and clarify the workflow's published-asset preservation guarantee.

## 0.1.2 — 2026-09-09

- Fix the Homebrew executable wrapper on macOS and Linux.
- Test a full Homebrew installation on both platforms before publishing any release.

## 0.1.1 — 2026-09-09

- Fix automatic Homebrew publication when the formula does not exist yet.
- Make release retries preserve published archive bytes across npm/tar metadata differences.

## 0.1.0 — 2026-09-09

- Public Framehuddle CLI with project management, screenshot export validation and imports, feedback retrieval, comments, and private screenshot downloads.
- Environment-based API authentication, local project defaults, pagination, bounded rate-limit retries, and JSON output.
- Homebrew installation, versioned GitHub release packages, SHA-256 checksums, and automated tap updates.
