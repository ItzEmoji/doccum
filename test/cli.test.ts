import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ["src/cli.ts", ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_TOKEN: "" },
  });
  return {
    code: result.status,
    out: stripVTControlCharacters(result.stdout + result.stderr),
  };
}

describe("cli", () => {
  test("--version prints just the version for scripts", () => {
    expect(cli("--version")).toEqual({ code: 0, out: `${version}\n` });
  });

  test.each([[], ["--help"], ["-h"]])("%p shows the styled help", (...args) => {
    const { code, out } = cli(...args);
    expect(code).toBe(0);
    expect(out).toMatch(
      new RegExp(`┌ +doccum ${version.replaceAll(".", "\\.")}`),
    );
    expect(out).toContain("◆  Commands");
    expect(out).toContain("sync");
  });

  test("routes sync, including its own help", () => {
    const { code, out } = cli("sync", "--help");
    expect(code).toBe(0);
    expect(out).toContain("--central-repo");
  });

  test("rejects an unknown command with exit 2", () => {
    const { code, out } = cli("deploy");
    expect(code).toBe(2);
    expect(out).toContain('Unknown command "deploy"');
  });
});
