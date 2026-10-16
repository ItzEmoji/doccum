#!/usr/bin/env node
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const HELP = `doccum ${pkg.version}

Manage, build and deploy multiple documentation projects.

Usage:
  doccum [options]

Options:
  -h, --help     Show this help
  -v, --version  Show the version
`;

const [arg] = process.argv.slice(2);

switch (arg) {
  case "-v":
  case "--version":
    console.log(pkg.version);
    break;
  case undefined:
  case "-h":
  case "--help":
    console.log(HELP);
    break;
  default:
    console.error(`Unknown option: ${arg}\n\n${HELP}`);
    process.exitCode = 1;
}
