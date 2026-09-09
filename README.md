# Framehuddle CLI

Manage projects, publish screenshot exports, and work through pinned feedback from the terminal. Requires Node.js 24 or later.

## Install

```sh
brew install b-nnett/framehuddle/framehuddle
framehuddle --help
```

Homebrew installs Node.js automatically. Upgrade with `brew update && brew upgrade framehuddle`.

Versioned packages and SHA-256 checksums are also available in [GitHub Releases](https://github.com/b-nnett/framehuddle-cli/releases). With Node.js 24 or later, install a downloaded package using `npm install -g ./framehuddle-0.1.0.tgz`. Distribution currently uses GitHub Releases and Homebrew; no npm registry account is required.

## Development

```sh
git clone https://github.com/b-nnett/framehuddle-cli.git
cd framehuddle-cli
npm ci
npm run check
npm run dev -- --help
```

See [RELEASING.md](RELEASING.md) for the automated release process. The CLI is a standalone MIT-licensed project; it does not require the Framehuddle web app to build or run.

## Connect

Create a scoped API key in Framehuddle **Settings → API keys**, then supply it through `FRAMEHUDDLE_API_KEY` in your environment or secret manager. `VF_API_KEY` is also supported. The CLI never stores credentials in project files or accepts keys as command-line arguments.

The default API origin is `https://framehuddle.com`. Override it with `--url`, `FRAMEHUDDLE_URL`, or `VF_URL`, in that order. HTTP is accepted only for localhost development. Redirects are refused; use the canonical origin directly.

```sh
framehuddle projects list --json
framehuddle init --project PROJECT_ID --export EXPORT_ID
framehuddle exports list --json
framehuddle feedback --status open --json
```

`init` creates `framehuddle.config.json` in the current directory, containing only `projectId` and optional `exportId`. It refuses to overwrite existing files. Edit the IDs in that file when switching versions, or override them per command. Defaults are read from the current directory, not parent directories. Use `--config FILE` to select a different file.

Selection precedence: `--project` / `--export`, then `FRAMEHUDDLE_PROJECT_ID` / `FRAMEHUDDLE_EXPORT_ID`, then config. IDs are explicit UUIDs; the CLI does not guess the latest version. `projects get ID` and `exports get ID` accept positional overrides.

## Commands

```sh
# Projects
framehuddle projects list --json
framehuddle projects create --name "Mobile app" --description "iOS review"
framehuddle projects get PROJECT_ID
framehuddle projects update --project PROJECT_ID --name "Mobile v2"
framehuddle projects archive --project PROJECT_ID --yes

# Exports (uses the project selected above)
framehuddle exports validate ./export.visual-feedback.json
framehuddle exports import ./export.visual-feedback.json --json
framehuddle exports list --json
framehuddle exports get EXPORT_ID

# Feedback and comments (requires both project and export)
framehuddle feedback --status open --json > feedback.json
framehuddle comments list --status resolved --json
framehuddle comments add --screen welcome --body "Check spacing" --x 0.25 --y 0.5
framehuddle comments reply ROOT_COMMENT_ID --body "Updated and verified"
framehuddle comments edit COMMENT_ID --body "Updated wording"
framehuddle comments resolve ROOT_COMMENT_ID
framehuddle comments reopen ROOT_COMMENT_ID
framehuddle comments delete COMMENT_ID --yes

# Download an original private screenshot; refuses to overwrite a file
framehuddle screens get welcome --output ./welcome.png
```

Feedback includes every page of comments, root thread IDs, frame titles, nested sections, image URLs, dimensions, and pixel coordinates computed from normalized pins. `comments list` skips the manifest lookup and needs only `comments:read`. Replies reuse their root thread’s screen and pin, and require both comment read and write scopes.

Export validation uses the application's schema, validates placement and declared dimensions, and checks base64, checksums, and decoded byte limits before any API request. Actual image formats and pixel dimensions are additionally verified by the server. Imports remove embedded images from the manifest, upload original bytes with up to three workers, and publish only after every upload succeeds. Rerun an identical version after interruption to resume safely; a changed manifest needs a new version.

## Output and failures

- `--json` returns one JSON document on stdout. Errors return one JSON object on stderr, with an HTTP status when available.
- Without `--json`, objects are pretty-printed JSON and collections use one JSON object per line, or `No results.` for empty collections.
- Progress always goes to stderr. When redirecting output from the repository, use `npm run --silent dev -- ... --json` to suppress npm's script banner.
- Exit code `0` means success; `1` means invalid input, a local I/O failure, or an API failure.
- Requests time out after 60 seconds. A 429 is retried at most twice, honoring `Retry-After` values up to 120 seconds. Other errors are not automatically retried. A network failure can occur after a mutation reached the server; check its outcome before repeating project or comment creation.
- `archive` and `delete` require `--yes`. Downloads and config creation never overwrite existing files.

| Workflow | API key scopes |
| --- | --- |
| List/read projects | `projects:read` |
| Create/update/archive projects | `projects:write` (name-only updates also read the existing description and need `projects:read`) |
| List/read exports, download screenshots | `exports:read` |
| Import exports | `exports:write` |
| Read feedback with frame context | `exports:read`, `comments:read` |
| Add/edit/resolve/delete comments | `comments:write` |
| Reply to a thread | `comments:read`, `comments:write` |

Project creation requires an unrestricted key. Server-side ownership and role policies still apply. API key creation and sharing stay in the signed-in web app.
