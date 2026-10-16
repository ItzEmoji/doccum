# doccum

Manage, build and deploy multiple documentation projects from one CLI.

> Early development.

## Install

```bash
npm install -g @itzemoji/doccum
```

## `doccum sync`

Mirrors a docs folder into a central repo, opens a preview pull request,
comments the preview URL (`https://<sha8>.<domain>/<project>`) and enables
auto-merge, falling back to a direct merge when auto-merge isn't available.
Run it from a GitHub Actions workflow in each source repo:

```yaml
on: push
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: |
          npx @itzemoji/doccum sync \
            --project test \
            --source ./docs \
            --central-repo ItzEmoji/docs \
            --branch "$GITHUB_REF_NAME" \
            --base main \
            --message "$HEAD_COMMIT_MESSAGE" \
            --domain docs.itzemoji.com \
            --merge-method squash
        env:
          # A PAT or GitHub App token with write access to the central repo.
          GITHUB_TOKEN: ${{ secrets.DOCS_TOKEN }}
          HEAD_COMMIT_MESSAGE: ${{ github.event.head_commit.message }}
```

Every flag is required except `--dest` (default `<project>/`). Run
`doccum sync --help` for details.

## Development

```bash
bun install
bun run build         # compile src/ to dist/
bun run typecheck     # src and tests
bun test              # run the tests
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
