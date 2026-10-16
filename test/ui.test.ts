import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { createUi } from "../src/ui.js";
import { DoccumError } from "../src/sync/errors.js";

function capture() {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += chunk.toString()));
  return { ui: createUi(output), text: () => stripVTControlCharacters(text) };
}

describe("ui", () => {
  test("frames a run with an intro and an outro", () => {
    const { ui, text } = capture();
    ui.intro("doccum sync");
    ui.step("Mirrored 3 files");
    ui.outro("Done");

    expect(text()).toMatch(/┌ +doccum sync/);
    expect(text()).toContain("◇  Mirrored 3 files");
    expect(text()).toContain("└  Done");
  });

  test("task shows the completion message and returns the result", async () => {
    const { ui, text } = capture();
    const result = await ui.task(
      "Working",
      async () => 42,
      (n) => `Got ${n}`,
    );

    expect(result).toBe(42);
    expect(text()).toContain("Got 42");
  });

  test("task marks the step as failed and rethrows", async () => {
    const { ui, text } = capture();
    const boom = new Error("boom");

    await expect(
      ui.task(
        "Pushing",
        async () => Promise.reject(boom),
        () => "never",
      ),
    ).rejects.toBe(boom);
    expect(text()).toContain("Pushing");
    expect(text()).not.toContain("never");
  });

  test("fail prints the message and the hint", () => {
    const { ui, text } = capture();
    ui.fail(new DoccumError("Push rejected", 3, "Pull first."));

    expect(text()).toContain("Push rejected");
    expect(text()).toContain("Pull first.");
  });

  test("help renders titled sections of aligned rows", () => {
    const { ui, text } = capture();
    ui.help({
      title: "doccum 1.0.0",
      description: "Manage docs.",
      sections: [
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

    const out = text();
    expect(out).toMatch(/┌ +doccum 1.0.0/);
    expect(out).toContain("│  Manage docs.");
    expect(out).toContain("◆  Options");
    expect(out).toContain("│  -h, --help     Show this help");
    expect(out).toContain("│  -v, --version  Show the version");
    expect(out).toContain("└  Run `doccum <command> --help` for details");
  });
});
