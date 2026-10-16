# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

`doccum` (`@itzemoji/doccum` on npm) is a TypeScript CLI for managing, building
and deploying multiple documentation projects from one place. It is in early
development — `src/cli.ts` currently only handles `--help` and `--version`.

### In progress: `doccum sync` (design phase)

Status: part 1 of the design (command + structure) and the terminal UI
approach are **approved**. The user asked to go straight to implementation;
parts 2–4 (PR/comment/auto-merge details, error handling, testing) are being
decided during implementation and recorded below for review.

#### Terminal UI (approved)

The whole CLI (help, version, errors, every command) uses the look of Vercel's
`npx skills` CLI: `@clack/prompts` — a `│` gutter, `◇`/`◆` step markers,
spinners, `┌` intro and `└` outro. In GitHub Actions (`CI=true`) clack prints
static lines instead of animating, so the same code works locally and in CI.

- `src/ui.ts` is the **only** module that imports clack. Commands call its
  helpers (`intro`, `task`, `step`, `fail`, `outro`, help rendering) so the
  styling stays swappable in one place.
- Argument parsing uses the built-in `node:util` `parseArgs` (subcommands,
  required-flag validation, per-command `--help`) — no extra dependency.

#### What it does

There are many **source repos** (one per docs project) and one **central
repo** that Cloudflare Pages deploys to `docs.itzemoji.com`, with each project
in its own folder. A GitHub Actions workflow in a source repo runs
`doccum sync` on push. Example: commit `feat(test): test` on branch `test` in
source repo `test` →

1. Mirror the project's files into the central repo, branch `test` (exact same
   branch name; created if missing). Commit message: `test: feat(test): test`
   (`<project>: <original message>`).
2. Take the new central commit's SHA, first **8** chars, and build
   `https://<sha8>.<domain>/<project>`. The user confirmed their Cloudflare
   setup serves previews at that URL — do not poll Cloudflare. Keep this in
   one pure function so it is easy to change.
3. Open a PR in the central repo (`<branch>` → `--base`), or reuse the open
   one.
4. Comment `🚀 Your preview is ready: [<url>](<url>)`. On later pushes,
   **edit** that same comment (found via a hidden `<!-- doccum-preview -->`
   marker) instead of posting a new one.
5. Enable auto-merge (fall back to a direct merge if auto-merge isn't
   available — details still to be designed in part 2).

#### Decisions made

- Runs as a `doccum` CLI subcommand called from GitHub Actions — no webhook
  server.
- **No defaults**: every flag is required, except `--dest`, which defaults to
  `<project>/`.
- Two projects using the same branch name share one central branch/PR — that
  is fine.
- Files are written with the **git CLI** (shallow clone → check out/create
  branch → replace `<dest>/` with `--source` contents, deletions included →
  commit → push). Bot commits in the central repo don't need to be signed.
- If the mirror produces no changes: log "no changes", exit 0, no commit/PR.
- Auth: `GITHUB_TOKEN` env var with write access to the central repo (a PAT
  or GitHub App token — the Actions `github.token` can't reach other repos).
- API errors (rate limits, existing PR, network) must be caught and reported
  without an unhandled crash.

#### Agreed CLI

```
doccum sync \
  --project test \
  --source ./docs \
  --central-repo ItzEmoji/docs \
  --branch "$GITHUB_REF_NAME" \
  --base main \
  --message "$HEAD_COMMIT_MESSAGE" \
  --domain docs.itzemoji.com \
  --merge-method squash \
  [--dest test/]
```

#### Agreed module layout (`src/`)

| File               | Job                                                                 |
| ------------------ | ------------------------------------------------------------------- |
| `cli.ts`           | existing entry; routes `sync`                                       |
| `ui.ts`            | the only clack importer: intro/task/step/fail/outro + help          |
| `commands/sync.ts` | parse/validate flags, run the steps in order                        |
| `sync/mirror.ts`   | git clone/branch/replace/commit/push, returns SHA                   |
| `sync/preview.ts`  | pure `(sha, domain, project)` → URL                                 |
| `sync/pr.ts`       | Octokit (`@octokit/rest`): find/open PR, upsert comment, auto-merge |
| `sync/errors.ts`   | map Octokit/network errors to readable messages + exit codes        |

## Tooling

- Package manager / runner: **Bun** (`bun install`, `bun run <script>`).
  Published output targets **Node >= 20**.
- `bun run build` — compile `src/` to `dist/` with `tsc`.
- `bun run typecheck` — type-check without emitting.
- `bun run format` / `bun run format:check` — Prettier (CI runs the check).
- TypeScript is strict, ESM (`"module": "NodeNext"`), with
  `verbatimModuleSyntax` — use `import type` for type-only imports and `.js`
  extensions in relative imports.

Before finishing a change, run `bun run typecheck`, `bun run build` and
`bun run format:check`.

## Git and release conventions

- **Commits must always be signed** with the GPG key already configured in the
  local git config. Never pass `--no-gpg-sign`, `-c commit.gpgsign=false` or
  otherwise bypass signing. If signing fails, stop and ask — don't work around
  it.
- **Never add a `Co-Authored-By` trailer** (or any other co-author/attribution
  trailer) to commit messages.
- Commit messages and PR titles follow
  [Conventional Commits](https://www.conventionalcommits.org/). PRs are
  squash-merged, so the PR title becomes the commit on `main` — CI validates it.
- Work on a branch (e.g. `feat/...`, `fix/...`), never directly on `main`.
- Releases are fully automated by semantic-release on every push to `main`
  (npmjs.com via trusted publishing + GitHub Packages). Don't bump the version
  in `package.json` or write a changelog by hand.

## License

GPL-3.0-or-later. New source files fall under the same license.
