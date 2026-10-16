import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mirror, type MirrorOptions } from "../src/sync/mirror.js";
import { GitError, UsageError } from "../src/sync/errors.js";
import { git, isolateGitConfig, seedRemote, write } from "./git-helpers.js";

let root: string;
let remote: string;
let source: string;

/** List files on a remote branch. */
function remoteFiles(branch: string): string[] {
  return git(remote, "ls-tree", "-r", "--name-only", branch).split("\n").sort();
}

function options(overrides: Partial<MirrorOptions> = {}): MirrorOptions {
  return {
    cloneUrl: pathToFileURL(remote).href,
    secrets: [],
    source,
    dest: "test",
    branch: "test",
    base: "main",
    commitMessage: "test: feat(test): test",
    ...overrides,
  };
}

beforeAll(isolateGitConfig);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "doccum-mirror-"));
  remote = join(root, "central.git");
  source = join(root, "docs");
  seedRemote(root, remote, { "other/keep.md": "keep", "test/old.md": "old" });

  write(source, { "index.md": "# hi", "guide/a.md": "a" });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("mirror", () => {
  test("creates the branch from base and replaces dest with the source", async () => {
    const result = await mirror(options());

    expect(result).toEqual({
      changed: true,
      createdBranch: true,
      files: 3,
      sha: git(remote, "rev-parse", "test"),
    });
    expect(remoteFiles("test")).toEqual([
      "other/keep.md",
      "test/guide/a.md",
      "test/index.md",
    ]);
    expect(git(remote, "log", "-1", "--format=%s", "test")).toBe(
      "test: feat(test): test",
    );
    expect(git(remote, "rev-parse", "test~1")).toBe(
      git(remote, "rev-parse", "main"),
    );
  });

  test("builds on top of an existing branch", async () => {
    const first = await mirror(options());
    write(source, { "index.md": "# changed" });

    const second = await mirror(options({ commitMessage: "test: second" }));

    expect(second).toMatchObject({
      changed: true,
      createdBranch: false,
      files: 1,
    });
    expect(git(remote, "rev-parse", "test~1")).toBe(
      first.changed ? first.sha : "",
    );
  });

  test("reports no changes and pushes nothing when dest already matches", async () => {
    await mirror(options());
    const before = git(remote, "rev-parse", "test");

    expect(await mirror(options())).toEqual({ changed: false });
    expect(git(remote, "rev-parse", "test")).toBe(before);
  });

  test("never copies a .git folder from the source", async () => {
    write(source, { ".git/HEAD": "ref: refs/heads/x" });
    await mirror(options());
    expect(remoteFiles("test")).not.toContain("test/.git/HEAD");
  });

  test("fails with a GitError when neither branch nor base exist", async () => {
    await expect(mirror(options({ base: "nope" }))).rejects.toBeInstanceOf(
      GitError,
    );
  });

  test("fails with a UsageError when the source folder is missing", async () => {
    await expect(
      mirror(options({ source: join(root, "missing") })),
    ).rejects.toBeInstanceOf(UsageError);
  });

  test("redacts secrets from git error messages", async () => {
    const err = await mirror(
      options({
        cloneUrl: pathToFileURL(join(root, "s3cret-repo")).href,
        secrets: ["s3cret"],
      }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as Error).message).not.toContain("s3cret");
  });

  test("cleans up its temporary clone", async () => {
    const workRoot = join(root, "work");
    mkdirSync(workRoot);
    await mirror(options({ workRoot }));
    expect(readdirSync(workRoot)).toEqual([]);
  });
});
