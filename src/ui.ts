/**
 * Terminal output in the style of Vercel's `skills` CLI. This is the only
 * module that talks to @clack/prompts, so the look can change in one place.
 */
import { cancel, intro, log, outro, spinner } from "@clack/prompts";
import type { Writable } from "node:stream";
import { styleText } from "node:util";
import type { DoccumError } from "./sync/errors.js";

export interface HelpSpec {
  title: string;
  description: string;
  sections: { title: string; rows: [string, string][] }[];
  footer: string;
}

export interface Ui {
  intro(title: string): void;
  step(message: string): void;
  info(message: string): void;
  /** Run `fn` behind a spinner; `done` turns its result into the final line. */
  task<T>(
    label: string,
    fn: () => Promise<T>,
    done: (result: T) => string,
  ): Promise<T>;
  fail(err: DoccumError): void;
  outro(message: string): void;
  help(spec: HelpSpec): void;
}

export function createUi(output: Writable = process.stdout): Ui {
  const opts = { output };

  return {
    intro: (title) => intro(styleText("inverse", ` ${title} `), opts),
    step: (message) => log.step(message, opts),
    info: (message) => log.info(message, opts),

    async task(label, fn, done) {
      const s = spinner(opts);
      s.start(label);
      try {
        const result = await fn();
        s.stop(done(result));
        return result;
      } catch (err) {
        s.error(label);
        throw err;
      }
    },

    fail(err) {
      log.error(err.message, opts);
      if (err.hint) log.message(styleText("dim", err.hint), opts);
      cancel("Stopped", opts);
    },

    outro: (message) => outro(message, opts),

    help(spec) {
      intro(styleText("inverse", ` ${spec.title} `), opts);
      log.message(spec.description, opts);
      for (const section of spec.sections) {
        const width = Math.max(...section.rows.map(([left]) => left.length));
        log.message(
          [
            styleText("bold", section.title),
            ...section.rows.map(
              ([left, right]) =>
                `${styleText("cyan", left.padEnd(width))}  ${styleText("dim", right)}`,
            ),
          ],
          { ...opts, symbol: styleText("cyan", "◆") },
        );
      }
      outro(spec.footer, opts);
    },
  };
}
