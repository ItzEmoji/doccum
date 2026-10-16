import { posix } from "node:path";
import { parseArgs } from "node:util";
import { toDoccumError, UsageError } from "../sync/errors.js";
import { mirror } from "../sync/mirror.js";
import {
  createGitHub,
  enableAutoMerge,
  findOrOpenPullRequest,
  upsertPreviewComment,
} from "../sync/pr.js";
import { previewUrl } from "../sync/preview.js";
import type { HelpSpec, Ui } from "../ui.js";

export interface SyncDeps {
  ui: Ui;
  env: Record<string, string | undefined>;
}

/** `doccum sync`: returns the process exit code. */
export async function syncCommand(
  argv: string[],
  { ui, env }: SyncDeps,
): Promise<number> {
  try {
    const parsed = parseSyncArgs(argv);
    if (parsed.help) {
      ui.help(SYNC_HELP);
      return 0;
    }

    const token = env.GITHUB_TOKEN ?? "";
    if (token === "") {
      throw new UsageError(
        "GITHUB_TOKEN is not set.",
        "Use a PAT or GitHub App token with write access to the central repo.",
      );
    }

    await runSync(parsed.options, {
      ui,
      token,
      apiUrl: env.GITHUB_API_URL,
      serverUrl: env.GITHUB_SERVER_URL || "https://github.com",
    });
    return 0;
  } catch (err) {
    const error = toDoccumError(err, "doccum sync");
    ui.fail(error);
    return error.exitCode;
  }
}

interface RunContext {
  ui: Ui;
  token: string;
  apiUrl: string | undefined;
  serverUrl: string;
}

async function runSync(
  o: SyncOptions,
  { ui, token, apiUrl, serverUrl }: RunContext,
) {
  const central = `${o.owner}/${o.repo}`;
  const commitMessage = `${o.project}: ${o.message}`;

  ui.intro("doccum sync");
  ui.info(`${o.project}  →  ${central}/${o.dest}  on  ${o.branch}`);

  const result = await ui.task(
    `Mirroring ${o.source}`,
    () =>
      mirror({
        cloneUrl: cloneUrl(serverUrl, o.owner, o.repo, token),
        secrets: [token, encodeURIComponent(token)],
        source: o.source,
        dest: o.dest,
        branch: o.branch,
        base: o.base,
        commitMessage,
      }),
    (r) =>
      r.changed
        ? `Mirrored ${plural(r.files, "file")} → ${central}@${o.branch}${
            r.createdBranch ? ` (new branch from ${o.base})` : ""
          }`
        : "No changes",
  );

  if (!result.changed) {
    ui.outro(
      `Nothing to sync: ${o.dest}/ on ${o.branch} is already up to date.`,
    );
    return;
  }

  ui.step(`Commit ${result.sha.slice(0, 8)}  ${commitMessage.split("\n")[0]}`);

  const gh = createGitHub(token, apiUrl);
  const repo = { owner: o.owner, repo: o.repo };

  const pr = await ui.task(
    "Opening pull request",
    () =>
      findOrOpenPullRequest(gh, {
        ...repo,
        branch: o.branch,
        base: o.base,
        title: commitMessage.split("\n")[0]!,
      }),
    (p) =>
      `PR #${p.number} ${p.created ? "opened" : "updated"} (${o.branch} → ${o.base})`,
  );

  const url = previewUrl(result.sha, o.domain, o.project);

  await ui.task(
    "Posting preview comment",
    () =>
      upsertPreviewComment(gh, {
        ...repo,
        number: pr.number,
        project: o.project,
        url,
      }),
    (outcome) => `Preview comment ${outcome}`,
  );

  await ui.task(
    "Enabling auto-merge",
    () =>
      enableAutoMerge(gh, {
        ...repo,
        number: pr.number,
        nodeId: pr.nodeId,
        mergeMethod: o.mergeMethod,
      }),
    (outcome) =>
      outcome === "auto-merge"
        ? `Auto-merge enabled (${o.mergeMethod})`
        : `Merged directly (${o.mergeMethod}): auto-merge was not available`,
  );

  ui.info(pr.url);
  ui.outro(`🚀 ${url}`);
}

/** HTTPS clone URL with the token as credentials (other schemes unchanged). */
function cloneUrl(
  server: string,
  owner: string,
  repo: string,
  token: string,
): string {
  const url = new URL(`${server.replace(/\/+$/, "")}/${owner}/${repo}.git`);
  if (url.protocol === "https:" || url.protocol === "http:") {
    url.username = "x-access-token";
    url.password = token;
  }
  return url.href;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface SyncOptions {
  project: string;
  source: string;
  owner: string;
  repo: string;
  branch: string;
  base: string;
  message: string;
  domain: string;
  mergeMethod: MergeMethod;
  /** Folder in the central repo, POSIX-style, no leading `./` or trailing `/`. */
  dest: string;
}

export type ParsedSyncArgs =
  { help: true } | { help: false; options: SyncOptions };

export const SYNC_FLAGS = {
  project: "Project name, used in commit messages and the preview URL",
  source: "Local folder whose contents are mirrored",
  "central-repo": "Central repository as owner/name",
  branch: "Branch to create or update in the central repo",
  base: "Base branch the pull request targets",
  message: "Original commit message",
  domain: "Preview domain, e.g. docs.itzemoji.com",
  "merge-method": "merge, squash or rebase",
  dest: "Folder in the central repo (default: <project>/)",
} as const;

type Flag = keyof typeof SYNC_FLAGS;

const REQUIRED: Flag[] = [
  "project",
  "source",
  "central-repo",
  "branch",
  "base",
  "message",
  "domain",
  "merge-method",
];

const flagRows = (flags: Flag[]): [string, string][] =>
  flags.map((flag) => [`--${flag} <value>`, SYNC_FLAGS[flag]]);

export const SYNC_HELP: HelpSpec = {
  title: "doccum sync",
  description:
    "Mirror a docs folder into the central repo, open a preview PR,\ncomment the preview URL and enable auto-merge.",
  sections: [
    {
      title: "Usage",
      rows: [["doccum sync", "--project <name> --source <dir> ..."]],
    },
    { title: "Required", rows: flagRows(REQUIRED) },
    {
      title: "Optional",
      rows: [...flagRows(["dest"]), ["-h, --help", "Show this help"]],
    },
    {
      title: "Environment",
      rows: [
        [
          "GITHUB_TOKEN",
          "Token with write access to the central repo (required)",
        ],
        ["GITHUB_API_URL", "GitHub API URL (default: https://api.github.com)"],
        [
          "GITHUB_SERVER_URL",
          "GitHub URL used for cloning (default: https://github.com)",
        ],
      ],
    },
  ],
  footer:
    "Exit codes: 0 ok · 1 unexpected · 2 usage · 3 git · 4 GitHub/network",
};

export function parseSyncArgs(argv: string[]): ParsedSyncArgs {
  let values: Partial<Record<Flag | "help", string | boolean>>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        ...Object.fromEntries(
          Object.keys(SYNC_FLAGS).map((flag) => [flag, { type: "string" }]),
        ),
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err) {
    throw new UsageError((err as Error).message, "Run `doccum sync --help`.");
  }

  if (values.help) return { help: true };

  const get = (flag: Flag) => (values[flag] as string | undefined) ?? "";

  const missing = REQUIRED.filter((flag) => get(flag).trim() === "");
  if (missing.length > 0) {
    throw new UsageError(
      `Missing required ${missing.length === 1 ? "flag" : "flags"}: ${missing
        .map((flag) => `--${flag}`)
        .join(", ")}`,
      "Run `doccum sync --help`.",
    );
  }

  const project = get("project");
  if (!/^[A-Za-z0-9._-]+$/.test(project) || /^\.+$/.test(project)) {
    throw new UsageError(
      `Invalid --project "${project}": use letters, digits, ".", "_" or "-".`,
    );
  }

  const [owner, repo, ...rest] = get("central-repo").split("/");
  if (!owner || !repo || rest.length > 0) {
    throw new UsageError(
      `Invalid --central-repo "${get("central-repo")}": expected owner/name.`,
    );
  }

  const mergeMethod = get("merge-method");
  if (!(MERGE_METHODS as readonly string[]).includes(mergeMethod)) {
    throw new UsageError(
      `Invalid --merge-method "${mergeMethod}": expected merge|squash|rebase.`,
    );
  }

  const branch = get("branch");
  const base = get("base");
  if (branch === base) {
    throw new UsageError(
      `--branch and --base are both "${base}": a pull request needs two different branches.`,
    );
  }

  return {
    help: false,
    options: {
      project,
      source: get("source"),
      owner,
      repo,
      branch,
      base,
      message: get("message"),
      domain: get("domain"),
      mergeMethod: mergeMethod as MergeMethod,
      dest: normaliseDest(get("dest") || `${project}/`),
    },
  };
}

function normaliseDest(raw: string): string {
  const unixy = raw.replaceAll("\\", "/");
  const dest = posix.normalize(unixy).replace(/^\.\//, "").replace(/\/+$/, "");
  if (
    dest === "" ||
    dest === "." ||
    dest === ".." ||
    dest.startsWith("../") ||
    posix.isAbsolute(dest) ||
    /^[A-Za-z]:/.test(dest) ||
    dest.split("/").includes(".git")
  ) {
    throw new UsageError(
      `Invalid --dest "${raw}": must be a folder inside the central repo.`,
    );
  }
  return dest;
}
