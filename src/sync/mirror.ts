import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { GitError, redact, UsageError } from "./errors.js";

const execFileAsync = promisify(execFile);

/** Identity for commits in the central repo (they don't need to be signed). */
const BOT_IDENTITY = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
};

export interface MirrorOptions {
  /** Remote URL, possibly with a token in it. */
  cloneUrl: string;
  /** Strings that must never appear in error messages (e.g. the token). */
  secrets: readonly string[];
  /** Local folder whose contents are mirrored. */
  source: string;
  /** Folder in the central repo, POSIX-style. */
  dest: string;
  branch: string;
  base: string;
  commitMessage: string;
  /** Parent folder for the temporary clone. Defaults to the OS temp dir. */
  workRoot?: string;
}

export type MirrorResult =
  | { changed: false }
  | { changed: true; sha: string; files: number; createdBranch: boolean };

/**
 * Replace `dest` on `branch` of the central repo with the contents of
 * `source` (deletions included), commit and push. The branch is created from
 * `base` when it does not exist yet.
 */
export async function mirror(opts: MirrorOptions): Promise<MirrorResult> {
  await assertDirectory(opts.source);

  const work = await mkdtemp(join(opts.workRoot ?? tmpdir(), "doccum-"));
  const git = (...args: string[]) => run(args, work, opts.secrets);

  try {
    await git("init", "-q");
    await git("config", "core.autocrlf", "false");
    await git("remote", "add", "origin", opts.cloneUrl);

    const createdBranch = !(await remoteBranchExists(git, opts.branch));
    const startFrom = createdBranch ? opts.base : opts.branch;
    if (createdBranch && !(await remoteBranchExists(git, opts.base))) {
      throw new GitError(
        `Neither branch "${opts.branch}" nor base "${opts.base}" exist in the central repo.`,
        "Check --base, and that the central repo has at least one commit.",
      );
    }

    await git(
      "fetch",
      "-q",
      "--depth",
      "1",
      "origin",
      `refs/heads/${startFrom}`,
    );
    await git("checkout", "-q", "-B", opts.branch, "FETCH_HEAD");

    const target = join(work, ...opts.dest.split("/"));
    await rm(target, { recursive: true, force: true });
    await cp(opts.source, target, {
      recursive: true,
      filter: (src) => basename(src) !== ".git",
    });

    await git("add", "-A", "--", opts.dest);
    const staged = await git("diff", "--cached", "--name-only");
    const files = staged.split("\n").filter(Boolean).length;
    if (files === 0) return { changed: false };

    await git("commit", "-q", "-m", opts.commitMessage);
    await git("push", "-q", "origin", `HEAD:refs/heads/${opts.branch}`);
    const sha = await git("rev-parse", "HEAD");

    return { changed: true, sha, files, createdBranch };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

type Git = (...args: string[]) => Promise<string>;

async function remoteBranchExists(git: Git, branch: string): Promise<boolean> {
  const out = await git(
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  );
  return out !== "";
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new UsageError(`--source "${path}" is not a folder.`);
  }
}

async function run(
  args: string[],
  cwd: string,
  secrets: readonly string[],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: { ...process.env, ...BOT_IDENTITY, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const { stderr, message } = err as { stderr?: string; message: string };
    const detail = (stderr?.trim() || message).split("\n").slice(-3).join(" ");
    throw new GitError(redact(`git ${args[0]} failed: ${detail}`, secrets));
  }
}
