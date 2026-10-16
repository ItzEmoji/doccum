import { Octokit } from "@octokit/rest";
import type { MergeMethod } from "../commands/sync.js";
import { GitHubError, toDoccumError } from "./errors.js";

export type GitHub = Octokit;

export function createGitHub(token: string, baseUrl?: string): GitHub {
  return new Octokit({
    auth: token,
    userAgent: "doccum",
    ...(baseUrl ? { baseUrl } : {}),
  });
}

interface Repo {
  owner: string;
  repo: string;
}

export interface PullRequest {
  number: number;
  nodeId: string;
  url: string;
  created: boolean;
}

/** Reuse the open PR from `branch` into `base`, or open one. */
export async function findOrOpenPullRequest(
  gh: GitHub,
  req: Repo & { branch: string; base: string; title: string },
): Promise<PullRequest> {
  try {
    const { data: open } = await gh.rest.pulls.list({
      owner: req.owner,
      repo: req.repo,
      state: "open",
      head: `${req.owner}:${req.branch}`,
      base: req.base,
      per_page: 1,
    });
    const existing = open[0];
    if (existing) {
      return {
        number: existing.number,
        nodeId: existing.node_id,
        url: existing.html_url,
        created: false,
      };
    }

    const { data: pr } = await gh.rest.pulls.create({
      owner: req.owner,
      repo: req.repo,
      head: req.branch,
      base: req.base,
      title: req.title,
      body: "Opened by [doccum](https://www.npmjs.com/package/@itzemoji/doccum).",
    });
    return {
      number: pr.number,
      nodeId: pr.node_id,
      url: pr.html_url,
      created: true,
    };
  } catch (err) {
    throw toDoccumError(err, "Opening the pull request");
  }
}

export function previewMarker(project: string): string {
  return `<!-- doccum-preview:${project} -->`;
}

/**
 * Post the preview comment, or edit this project's earlier one (found by its
 * hidden marker) so each project keeps a single, current comment.
 */
export async function upsertPreviewComment(
  gh: GitHub,
  req: Repo & { number: number; project: string; url: string },
): Promise<"created" | "updated"> {
  const marker = previewMarker(req.project);
  const body = `${marker}\n🚀 Your preview is ready: [${req.url}](${req.url})`;

  try {
    const comments = await gh.paginate(gh.rest.issues.listComments, {
      owner: req.owner,
      repo: req.repo,
      issue_number: req.number,
      per_page: 100,
    });
    const existing = comments.find((c) => c.body?.includes(marker));

    if (existing) {
      await gh.rest.issues.updateComment({
        owner: req.owner,
        repo: req.repo,
        comment_id: existing.id,
        body,
      });
      return "updated";
    }

    await gh.rest.issues.createComment({
      owner: req.owner,
      repo: req.repo,
      issue_number: req.number,
      body,
    });
    return "created";
  } catch (err) {
    throw toDoccumError(err, "Updating the preview comment");
  }
}

/**
 * GraphQL errors meaning auto-merge can't be queued, but the PR can be merged
 * right away: the repo disallows auto-merge, or nothing is left to wait for.
 */
const MERGE_NOW = [
  /auto ?-?merge is not allowed/i,
  /is in clean status/i,
  /is in unstable status/i,
];

/** Enable auto-merge; fall back to merging directly when that's not possible. */
export async function enableAutoMerge(
  gh: GitHub,
  req: Repo & { number: number; nodeId: string; mergeMethod: MergeMethod },
): Promise<"auto-merge" | "merged"> {
  try {
    await gh.graphql(
      `mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(
          input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }
        ) {
          clientMutationId
        }
      }`,
      { pullRequestId: req.nodeId, mergeMethod: req.mergeMethod.toUpperCase() },
    );
    return "auto-merge";
  } catch (err) {
    const messages = graphqlMessages(err);
    if (!messages) throw toDoccumError(err, "Enabling auto-merge");
    if (!messages.some((m) => MERGE_NOW.some((re) => re.test(m)))) {
      throw new GitHubError(
        `Enabling auto-merge failed: ${messages.join("; ")}`,
      );
    }
  }

  try {
    await gh.rest.pulls.merge({
      owner: req.owner,
      repo: req.repo,
      pull_number: req.number,
      merge_method: req.mergeMethod,
    });
    return "merged";
  } catch (err) {
    throw toDoccumError(err, "Merging the pull request");
  }
}

function graphqlMessages(err: unknown): string[] | undefined {
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  return errors.map((e: { message?: unknown }) => String(e.message));
}
