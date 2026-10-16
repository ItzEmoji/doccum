import { describe, expect, test } from "bun:test";
import { RequestError } from "@octokit/request-error";
import {
  DoccumError,
  GitError,
  redact,
  toDoccumError,
  UsageError,
} from "../src/sync/errors.js";

function httpError(
  status: number,
  message = "boom",
  headers: Record<string, string> = {},
): RequestError {
  return new RequestError(message, status, {
    request: { method: "GET", url: "https://api.github.com/x", headers: {} },
    response: { status, url: "https://api.github.com/x", headers, data: {} },
  });
}

describe("toDoccumError", () => {
  test("passes DoccumErrors through unchanged", () => {
    const err = new UsageError("bad flag");
    expect(toDoccumError(err, "Parsing flags")).toBe(err);
  });

  test("explains a rejected token (401) with exit code 4", () => {
    const err = toDoccumError(httpError(401), "Opening the pull request");
    expect(err.exitCode).toBe(4);
    expect(err.message).toBe(
      "Opening the pull request failed: GitHub rejected the token (401).",
    );
    expect(err.hint).toContain("GITHUB_TOKEN");
  });

  test("reports a rate limit with its reset time", () => {
    const reset = Date.UTC(2026, 9, 16, 12, 30) / 1000;
    const err = toDoccumError(
      httpError(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
      }),
      "Commenting",
    );
    expect(err.message).toContain("rate limit");
    expect(err.hint).toContain("2026-10-16T12:30:00.000Z");
  });

  test("reports a secondary rate limit (429 with retry-after)", () => {
    const err = toDoccumError(
      httpError(429, "slow down", { "retry-after": "60" }),
      "Commenting",
    );
    expect(err.message).toContain("rate limit");
    expect(err.hint).toContain("60 seconds");
  });

  test("explains a 403 that is not a rate limit as missing permissions", () => {
    const err = toDoccumError(
      httpError(403, "Resource not accessible"),
      "Merging",
    );
    expect(err.message).toContain("permission");
    expect(err.message).toContain("Resource not accessible");
  });

  test("explains a 404 as a missing repo or inaccessible token", () => {
    const err = toDoccumError(httpError(404), "Opening the pull request");
    expect(err.message).toContain("not found");
    expect(err.hint).toContain("access");
  });

  test("includes GitHub's message for validation errors (422)", () => {
    const err = toDoccumError(
      httpError(422, "Validation Failed: no commits between main and test"),
      "Opening the pull request",
    );
    expect(err.message).toContain("no commits between main and test");
  });

  test("treats a request error without a response as a network failure", () => {
    const err = new RequestError("fetch failed", 500, {
      request: { method: "GET", url: "https://api.github.com/x", headers: {} },
    });
    expect(toDoccumError(err, "Commenting").message).toContain("network");
  });

  test("treats Node socket errors as network failures", () => {
    const err = Object.assign(
      new Error("getaddrinfo ENOTFOUND api.github.com"),
      {
        code: "ENOTFOUND",
      },
    );
    const mapped = toDoccumError(err, "Commenting");
    expect(mapped.message).toContain("network");
    expect(mapped.exitCode).toBe(4);
  });

  test("wraps unknown errors with exit code 1", () => {
    const mapped = toDoccumError(new Error("weird"), "Mirroring");
    expect(mapped).toBeInstanceOf(DoccumError);
    expect(mapped.exitCode).toBe(1);
    expect(mapped.message).toBe("Mirroring failed: weird");
  });

  test("git errors use exit code 3", () => {
    expect(new GitError("push rejected").exitCode).toBe(3);
  });
});

describe("redact", () => {
  test("replaces every occurrence of each secret", () => {
    expect(redact("https://x:tok@github.com tok", ["tok"])).toBe(
      "https://x:***@github.com ***",
    );
  });

  test("ignores empty secrets", () => {
    expect(redact("abc", [""])).toBe("abc");
  });
});
