import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { syncCommand } from "../src/commands/sync.js";
import { createUi } from "../src/ui.js";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.js";
import { git, isolateGitConfig, seedRemote, write } from "./git-helpers.js";

let root: string;
let remote: string;
let source: string;
let fake: FakeGitHub;

function argv(): string[] {
  return [
    "--project",
    "test",
    "--source",
    source,
    "--central-repo",
    "ItzEmoji/docs",
    "--branch",
    "test",
    "--base",
    "main",
    "--message",
    "feat(test): test",
    "--domain",
    "docs.itzemoji.com",
    "--merge-method",
    "squash",
  ];
}

async function run(
  args: string[],
  env: Record<string, string | undefined> = {},
) {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += chunk.toString()));
  const code = await syncCommand(args, {
    ui: createUi(output),
    env: {
      GITHUB_TOKEN: "tok",
      GITHUB_API_URL: fake.url,
      GITHUB_SERVER_URL: pathToFileURL(root).href,
      ...env,
    },
  });
  return { code, out: stripVTControlCharacters(text) };
}

beforeAll(isolateGitConfig);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "doccum-sync-"));
  remote = join(root, "ItzEmoji", "docs.git");
  source = join(root, "docs");
  seedRemote(root, remote, { "README.md": "central" });
  write(source, { "index.md": "# hi" });
  fake = startFakeGitHub();
});

afterEach(() => {
  fake.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("syncCommand", () => {
  test("mirrors, opens a PR, comments the preview and enables auto-merge", async () => {
    const { code, out } = await run(argv());

    const sha8 = git(remote, "rev-parse", "test").slice(0, 8);
    const url = `https://${sha8}.docs.itzemoji.com/test`;
    expect(code).toBe(0);
    expect(git(remote, "log", "-1", "--format=%s", "test")).toBe(
      "test: feat(test): test",
    );
    expect(fake.pulls[0]).toMatchObject({ head: "test", base: "main" });
    expect(fake.comments[0]!.body).toContain(`[${url}](${url})`);
    expect(fake.autoMerge.get("PR_1")).toBe("SQUASH");
    expect(out).toContain(url);
    expect(out).toContain("#1");
  });

  test("stops early with exit 0 when there is nothing to sync", async () => {
    await run(argv());
    const { code, out } = await run(argv());

    expect(code).toBe(0);
    expect(out).toContain("No changes");
    expect(fake.comments).toHaveLength(1);
  });

  test("prints help with every flag and exits 0", async () => {
    const { code, out } = await run(["--help"]);

    expect(code).toBe(0);
    expect(out).toContain("--central-repo");
    expect(out).toContain("--merge-method");
  });

  test("exits 2 on a usage error", async () => {
    const { code, out } = await run(["--project", "test"]);

    expect(code).toBe(2);
    expect(out).toContain("Missing required flags");
  });

  test("exits 2 when GITHUB_TOKEN is not set", async () => {
    const { code, out } = await run(argv(), { GITHUB_TOKEN: undefined });

    expect(code).toBe(2);
    expect(out).toContain("GITHUB_TOKEN");
  });

  test("exits 4 on a GitHub API failure without leaking the token", async () => {
    fake.failWith = { status: 401, message: "Bad credentials" };
    const { code, out } = await run(argv(), { GITHUB_TOKEN: "sekrit-token" });

    expect(code).toBe(4);
    expect(out).toContain("rejected the token");
    expect(out).not.toContain("sekrit-token");
  });
});
