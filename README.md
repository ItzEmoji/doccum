# doccum

Manage, build and deploy multiple documentation projects from one CLI.

> Early development — nothing useful yet.

## Install

```bash
npm install -g @itzemoji/doccum
```

## Development

```bash
bun install
bun run build         # compile src/ to dist/
bun run typecheck
bun run format        # format with Prettier
bun run format:check  # what CI runs
```

## Releasing

Commits on `main` must follow [Conventional Commits](https://www.conventionalcommits.org/).
PRs are squash-merged, so the PR title is the commit message — CI checks it.

Every push to `main` runs [semantic-release](https://github.com/semantic-release/semantic-release).
If the new commits warrant a release (`feat` → minor, `fix`/`perf` → patch,
`!` or `BREAKING CHANGE` → major), it publishes to npmjs.com (via trusted
publishing) and GitHub Packages, then tags the commit and creates the GitHub
release. There is no release PR and no committed changelog — the release
notes live on the GitHub release.
