/**
 * A tiny in-memory stand-in for the parts of the GitHub API doccum uses, so
 * tests exercise the real Octokit client over HTTP.
 */
export interface FakePull {
  number: number;
  node_id: string;
  html_url: string;
  head: string;
  base: string;
  title: string;
  body: string;
  merged?: string;
}

export interface FakeComment {
  id: number;
  issue: number;
  body: string;
}

export interface FakeGitHub {
  url: string;
  pulls: FakePull[];
  comments: FakeComment[];
  autoMerge: Map<string, string>;
  /** Error message GraphQL returns for enablePullRequestAutoMerge, if any. */
  autoMergeError?: string;
  /** Status to answer every REST request with, to simulate failures. */
  failWith?: {
    status: number;
    message: string;
    headers?: Record<string, string>;
  };
  stop(): void;
}

export function startFakeGitHub(): FakeGitHub {
  const state: Omit<FakeGitHub, "url" | "stop"> = {
    pulls: [],
    comments: [],
    autoMerge: new Map(),
  };
  let nextId = 1;

  const json = (
    data: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) => Response.json(data, { status, headers });

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const body =
        req.method === "GET" ? {} : ((await req.json()) as Record<string, any>);

      if (state.failWith) {
        const { status, message, headers } = state.failWith;
        return json({ message }, status, headers);
      }

      if (path === "/graphql") {
        if (state.autoMergeError) {
          return json({
            data: null,
            errors: [{ message: state.autoMergeError }],
          });
        }
        const { pullRequestId, mergeMethod } = body.variables;
        state.autoMerge.set(pullRequestId, mergeMethod);
        return json({
          data: { enablePullRequestAutoMerge: { clientMutationId: null } },
        });
      }

      let m: RegExpMatchArray | null;
      if ((m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/))) {
        const [, owner, repo] = m;
        if (req.method === "GET") {
          const head = url.searchParams.get("head");
          const base = url.searchParams.get("base");
          return json(
            state.pulls
              .filter(
                (p) =>
                  !p.merged && `${owner}:${p.head}` === head && p.base === base,
              )
              .map((p) => ({
                ...p,
                head: { ref: p.head },
                base: { ref: p.base },
              })),
          );
        }
        const n = nextId++;
        const pull: FakePull = {
          number: n,
          node_id: `PR_${n}`,
          html_url: `https://github.com/${owner}/${repo}/pull/${n}`,
          head: body.head,
          base: body.base,
          title: body.title,
          body: body.body,
        };
        state.pulls.push(pull);
        return json(pull, 201);
      }

      if ((m = path.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/))) {
        const pull = state.pulls.find((p) => p.number === Number(m![1]))!;
        pull.merged = body.merge_method;
        return json({ merged: true, sha: "abc" });
      }

      if (
        (m = path.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/))
      ) {
        const issue = Number(m[1]);
        if (req.method === "GET") {
          return json(state.comments.filter((c) => c.issue === issue));
        }
        const comment = { id: nextId++, issue, body: body.body };
        state.comments.push(comment);
        return json(comment, 201);
      }

      if (
        (m = path.match(/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/))
      ) {
        const comment = state.comments.find((c) => c.id === Number(m![1]))!;
        comment.body = body.body;
        return json(comment);
      }

      return json({ message: `Not Found: ${req.method} ${path}` }, 404);
    },
  });

  return Object.assign(state, {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  });
}
