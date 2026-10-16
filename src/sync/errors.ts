import { RequestError } from "@octokit/request-error";

/** An expected failure with a readable message and a process exit code. */
export class DoccumError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Invalid command-line usage. Exit code 2. */
export class UsageError extends DoccumError {
  constructor(message: string, hint?: string) {
    super(message, 2, hint);
  }
}

/** A git command failed. Exit code 3. */
export class GitError extends DoccumError {
  constructor(message: string, hint?: string) {
    super(message, 3, hint);
  }
}

/** The GitHub API or the network failed. Exit code 4. */
export class GitHubError extends DoccumError {
  constructor(message: string, hint?: string) {
    super(message, 4, hint);
  }
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const NETWORK_HINT = "Check the runner's connection and try again.";

/**
 * Turn anything thrown while doing `action` into a DoccumError, so the CLI
 * can always print a readable message and exit with a meaningful code.
 */
export function toDoccumError(err: unknown, action: string): DoccumError {
  if (err instanceof DoccumError) return err;

  const failed = (reason: string) => `${action} failed: ${reason}`;

  if (err instanceof RequestError) {
    if (!err.response) {
      return new GitHubError(
        failed(`network error talking to GitHub (${err.message}).`),
        NETWORK_HINT,
      );
    }
    return fromHttpError(err, failed);
  }

  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_CODES.has(code)) {
      return new GitHubError(
        failed(`network error (${err.message}).`),
        NETWORK_HINT,
      );
    }
    return new DoccumError(failed(err.message), 1);
  }

  return new DoccumError(failed(String(err)), 1);
}

function fromHttpError(
  err: RequestError,
  failed: (reason: string) => string,
): GitHubError {
  const headers = err.response?.headers ?? {};
  const remaining = headers["x-ratelimit-remaining"];
  const reset = headers["x-ratelimit-reset"];
  const retryAfter = headers["retry-after"];

  if ((err.status === 403 || err.status === 429) && String(remaining) === "0") {
    const resetAt = reset
      ? new Date(Number(reset) * 1000).toISOString()
      : "later";
    return new GitHubError(
      failed("GitHub API rate limit exceeded."),
      `The limit resets at ${resetAt}.`,
    );
  }
  if ((err.status === 403 || err.status === 429) && retryAfter !== undefined) {
    return new GitHubError(
      failed("GitHub secondary rate limit hit."),
      `Retry after ${retryAfter} seconds.`,
    );
  }

  switch (err.status) {
    case 401:
      return new GitHubError(
        failed("GitHub rejected the token (401)."),
        "Check that GITHUB_TOKEN is set to a valid PAT or GitHub App token.",
      );
    case 403:
      return new GitHubError(
        failed(`the token lacks permission (${err.message}).`),
        "The token needs write access to contents and pull requests in the central repo.",
      );
    case 404:
      return new GitHubError(
        failed("repository or resource not found (404)."),
        "Check --central-repo and that GITHUB_TOKEN has access to it.",
      );
    case 422:
      return new GitHubError(
        failed(`GitHub rejected the request: ${err.message}`),
      );
    default:
      return new GitHubError(
        failed(`GitHub returned ${err.status}: ${err.message}`),
        err.status >= 500
          ? "GitHub may be having problems; try again."
          : undefined,
      );
  }
}

/** Replace every occurrence of each secret with `***`. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret !== "")
    .reduce((out, secret) => out.split(secret).join("***"), text);
}
