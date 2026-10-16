import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function write(dir: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

/** Isolate git from the developer's config (e.g. commit signing). */
export function isolateGitConfig(): void {
  const globalConfig = join(
    mkdtempSync(join(tmpdir(), "doccum-gitcfg-")),
    "config",
  );
  writeFileSync(globalConfig, "");
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
}

/** Create a bare repo at `remote` whose `main` holds `files`. */
export function seedRemote(
  root: string,
  remote: string,
  files: Record<string, string>,
): void {
  const seed = mkdtempSync(join(root, "seed-"));
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "init", "-q", "-b", "main", seed);
  write(seed, files);
  git(seed, "add", "-A");
  git(
    seed,
    "-c",
    "user.name=seed",
    "-c",
    "user.email=seed@x",
    "commit",
    "-qm",
    "seed",
  );
  git(seed, "push", "-q", remote, "main");
}
