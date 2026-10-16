import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createGitHub,
  enableAutoMerge,
  findOrOpenPullRequest,
  upsertPreviewComment,
} from "../src/sync/pr.js";
import { GitHubError } from "../src/sync/errors.js";
import { startFakeGitHub, type FakeGitHub } from "./fake-github.js";

let fake: FakeGitHub;
const repo = { owner: "ItzEmoji", repo: "docs" };

function client() {
  return createGitHub("token", fake.url);
}

beforeEach(() => {
  fake = startFakeGitHub();
});

afterEach(() => {
  fake.stop();
});

describe("findOrOpenPullRequest", () => {
  const request = {
    ...repo,
    branch: "test",
    base: "main",
    title: "test: feat(test): test",
  };

  test("opens a pull request when none is open", async () => {
    const pr = await findOrOpenPullRequest(client(), request);

    expect(pr).toEqual({
      number: 1,
      nodeId: "PR_1",
      url: "https://github.com/ItzEmoji/docs/pull/1",
      created: true,
    });
    expect(fake.pulls[0]).toMatchObject({
      head: "test",
      base: "main",
      title: request.title,
    });
  });

  test("reuses the open pull request for the same branch and base", async () => {
    await findOrOpenPullRequest(client(), request);
    const again = await findOrOpenPullRequest(client(), {
      ...request,
      title: "other",
    });

    expect(again).toMatchObject({ number: 1, created: false });
    expect(fake.pulls).toHaveLength(1);
  });

  test("maps API failures to a GitHubError", async () => {
    fake.failWith = { status: 401, message: "Bad credentials" };
    await expect(
      findOrOpenPullRequest(client(), request),
    ).rejects.toBeInstanceOf(GitHubError);
  });
});

describe("upsertPreviewComment", () => {
  const url = "https://a1b2c3d4.docs.itzemoji.com/test";

  test("posts the preview comment with a hidden per-project marker", async () => {
    const outcome = await upsertPreviewComment(client(), {
      ...repo,
      number: 1,
      project: "test",
      url,
    });

    expect(outcome).toBe("created");
    expect(fake.comments[0]!.body).toBe(
      `<!-- doccum-preview:test -->\n🚀 Your preview is ready: [${url}](${url})`,
    );
  });

  test("edits the existing comment instead of posting another", async () => {
    await upsertPreviewComment(client(), {
      ...repo,
      number: 1,
      project: "test",
      url,
    });
    const newer = "https://ffffffff.docs.itzemoji.com/test";

    const outcome = await upsertPreviewComment(client(), {
      ...repo,
      number: 1,
      project: "test",
      url: newer,
    });

    expect(outcome).toBe("updated");
    expect(fake.comments).toHaveLength(1);
    expect(fake.comments[0]!.body).toContain(newer);
  });

  test("keeps a separate comment per project sharing the pull request", async () => {
    await upsertPreviewComment(client(), {
      ...repo,
      number: 1,
      project: "test",
      url,
    });
    await upsertPreviewComment(client(), {
      ...repo,
      number: 1,
      project: "api",
      url,
    });

    expect(fake.comments).toHaveLength(2);
  });
});

describe("enableAutoMerge", () => {
  const pr = {
    ...repo,
    number: 1,
    nodeId: "PR_1",
    mergeMethod: "squash" as const,
  };

  beforeEach(async () => {
    await findOrOpenPullRequest(client(), {
      ...repo,
      branch: "test",
      base: "main",
      title: "t",
    });
  });

  test("enables auto-merge with the requested method", async () => {
    expect(await enableAutoMerge(client(), pr)).toBe("auto-merge");
    expect(fake.autoMerge.get("PR_1")).toBe("SQUASH");
  });

  test.each([
    "Pull request Auto merge is not allowed for this repository",
    "Pull request is in clean status",
    "Pull request is in unstable status",
  ])("falls back to a direct merge when GitHub says %p", async (message) => {
    fake.autoMergeError = message;

    expect(await enableAutoMerge(client(), pr)).toBe("merged");
    expect(fake.pulls[0]!.merged).toBe("squash");
  });

  test("does not merge directly on other GraphQL errors", async () => {
    fake.autoMergeError = "Something else broke";

    await expect(enableAutoMerge(client(), pr)).rejects.toBeInstanceOf(
      GitHubError,
    );
    expect(fake.pulls[0]!.merged).toBeUndefined();
  });
});
