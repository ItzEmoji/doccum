#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { syncCommand } from "./commands/sync.js";
import { UsageError } from "./sync/errors.js";
import { createUi } from "./ui.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const ui = createUi();

function showHelp(): void {
  ui.help({
    title: `doccum ${pkg.version}`,
    description: "Manage, build and deploy multiple documentation projects.",
    sections: [
      {
        title: "Commands",
        rows: [
          ["sync", "Mirror docs to the central repo and open a preview PR"],
        ],
      },
      {
        title: "Options",
        rows: [
          ["-h, --help", "Show this help"],
          ["-v, --version", "Show the version"],
        ],
      },
    ],
    footer: "Run `doccum <command> --help` for details",
  });
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case "-v":
    case "--version":
      console.log(pkg.version);
      return 0;
    case undefined:
    case "-h":
    case "--help":
      showHelp();
      return 0;
    case "sync":
      return syncCommand(rest, { ui, env: process.env });
    default: {
      const error = new UsageError(
        `Unknown command "${command}".`,
        "Run `doccum --help` to see the available commands.",
      );
      ui.fail(error);
      return error.exitCode;
    }
  }
}

process.exitCode = await main(process.argv.slice(2));
