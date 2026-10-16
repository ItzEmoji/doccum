import { describe, expect, test } from "bun:test";
import { parseSyncArgs } from "../src/commands/sync.js";
import { UsageError } from "../src/sync/errors.js";

const valid = [
  "--project",
  "test",
  "--source",
  "./docs",
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

function without(flag: string): string[] {
  const i = valid.indexOf(flag);
  return [...valid.slice(0, i), ...valid.slice(i + 2)];
}

function usageError(argv: string[]): UsageError {
  try {
    parseSyncArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) return err;
    throw err;
  }
  throw new Error("expected a UsageError");
}

describe("parseSyncArgs", () => {
  test("parses every flag and defaults --dest to <project>/", () => {
    expect(parseSyncArgs(valid)).toEqual({
      help: false,
      options: {
        project: "test",
        source: "./docs",
        owner: "ItzEmoji",
        repo: "docs",
        branch: "test",
        base: "main",
        message: "feat(test): test",
        domain: "docs.itzemoji.com",
        mergeMethod: "squash",
        dest: "test",
      },
    });
  });

  test("accepts an explicit --dest and normalises it", () => {
    const parsed = parseSyncArgs([...valid, "--dest", "./guides/test/"]);
    expect(parsed.help ? undefined : parsed.options.dest).toBe("guides/test");
  });

  test("returns help without validating when --help is passed", () => {
    expect(parseSyncArgs(["--help"])).toEqual({ help: true });
  });

  test("lists every missing required flag", () => {
    const err = usageError(without("--project").slice(0, 2));
    expect(err.message).toContain("--project");
    expect(err.message).toContain("--merge-method");
  });

  test("rejects an unknown flag", () => {
    expect(usageError([...valid, "--nope", "x"]).message).toContain("--nope");
  });

  test("rejects an invalid merge method", () => {
    const argv = [...without("--merge-method"), "--merge-method", "fast"];
    expect(usageError(argv).message).toContain("merge|squash|rebase");
  });

  test("rejects a central repo that is not owner/name", () => {
    const argv = [...without("--central-repo"), "--central-repo", "docs"];
    expect(usageError(argv).message).toContain("owner/name");
  });

  test("rejects a project name that is unsafe in a URL path", () => {
    const argv = [...without("--project"), "--project", "a b/c"];
    expect(usageError(argv).message).toContain("--project");
  });

  test.each(["../outside", "/abs", ".", "a/../.."])(
    "rejects --dest %p outside the repo or at its root",
    (dest) => {
      expect(usageError([...valid, "--dest", dest]).message).toContain(
        "--dest",
      );
    },
  );

  test("rejects a branch equal to the base", () => {
    const argv = [...without("--branch"), "--branch", "main"];
    expect(usageError(argv).message).toContain("--base");
  });

  test("rejects an empty message", () => {
    const argv = [...without("--message"), "--message", "  "];
    expect(usageError(argv).message).toContain("--message");
  });
});
