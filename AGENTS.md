# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this project is

`doccum` (`@itzemoji/doccum` on npm) is a TypeScript CLI for managing, building
and deploying multiple documentation projects from one place. It is in early
development — the only command so far is `doccum sync`.

### `doccum sync`

Status: **implemented**. Part 1 of the design (command + structure) and the
terminal UI were approved; the user then asked to go straight to
implementation, so parts 2–4 were decided during implementation (see "Decided
during implementation" below) and still await the user's review.

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

#### Decided during implementation (parts 2–4, pending user review)

- **PR**: reuse the open PR from `<branch>` into `--base`, otherwise open one
  titled with the first line of the central commit message.
- **Preview comment**: the marker is per project, `<!-- doccum-preview:<project> -->`,
  so projects sharing a branch/PR each keep their own comment.
- **Auto-merge**: GraphQL `enablePullRequestAutoMerge`. If GitHub says
  auto-merge isn't allowed, or the PR is in clean/unstable status (nothing to
  wait for), merge directly via REST with `--merge-method`. Any other error
  fails.
- **Mirror**: `git init` + shallow fetch of the branch (or `--base` if the
  branch is new), replace `<dest>/` (never copying `.git`), commit as
  `github-actions[bot]`, push. The token goes in the HTTPS clone URL and is
  redacted from every error. `--branch` must differ from `--base`.
- **Environment**: `GITHUB_TOKEN` (required), plus the standard Actions
  variables `GITHUB_API_URL` and `GITHUB_SERVER_URL` (GitHub Enterprise works).
- **Exit codes**: 0 ok, 1 unexpected, 2 usage, 3 git, 4 GitHub/network. Every
  error is printed through `ui.fail` with a hint — no unhandled crashes.
- **Tests** (`bun test`, in `test/`): mirror runs real git against a local
  bare repo with an isolated git config; `pr.ts` and the full command run real
  Octokit against an in-memory fake GitHub (`test/fake-github.ts`, `Bun.serve`).

## Tooling

- Package manager / runner: **Bun** (`bun install`, `bun run <script>`).
  Published output targets **Node >= 20**.
- `bun run build` — compile `src/` to `dist/` with `tsc`.
- `bun run typecheck` — type-check without emitting.
- `bun run format` / `bun run format:check` — Prettier (CI runs the check).
- TypeScript is strict, ESM (`"module": "NodeNext"`), with
  `verbatimModuleSyntax` — use `import type` for type-only imports and `.js`
  extensions in relative imports.

Before finishing a change, run `bun test`, `bun run typecheck`, `bun run build` and
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
