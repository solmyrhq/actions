"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const lib = require("./lib.js");

const MARKER = "<!-- codex-code-review:0123456789abcdef0123456789abcdef01234567:42:1 -->";

function scratch({ summary = `${MARKER}\nSummary.`, comments = [], threads = [] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "review-publish-"));
  fs.writeFileSync(path.join(directory, "summary.md"), summary);
  fs.writeFileSync(path.join(directory, "resolve.json"), JSON.stringify({ threads }));
  comments.forEach((comment, index) => {
    fs.writeFileSync(path.join(directory, `comment-${index + 1}.json`), JSON.stringify(comment));
  });
  return directory;
}

const thread = (overrides = {}) => ({
  isResolved: false,
  pullRequest: { number: 7, repository: { nameWithOwner: "solmyrhq/x" } },
  comments: { nodes: [{ author: { login: "github-actions" }, body: `<!-- codex-code-review:abc:1:1 -->\nx` }] },
  ...overrides,
});

// A GitHub that records each call. `failPosts` lists routes whose POST fails;
// `threads` maps thread IDs to the node that the query returns.
function fakeGitHub({ failPosts = [], threads = {}, posted } = {}) {
  const calls = [];
  const issueComments = [];
  return {
    calls,
    async post(route, body) {
      calls.push(["POST", route, body]);
      if (failPosts.some((pattern) => pattern.test(route))) {
        throw new Error("HTTP 422");
      }
      if (route.endsWith(`/issues/7/comments`)) issueComments.push({ user: { login: "github-actions[bot]" }, body: body.body });
      return {};
    },
    async paginate(route) {
      calls.push(["GET", route]);
      return posted ?? issueComments;
    },
    async graphql(query, variables) {
      const mutation = query.includes("resolveReviewThread");
      calls.push([mutation ? "RESOLVE" : "QUERY", variables.threadId]);
      return mutation ? {} : { node: threads[variables.threadId] ?? null };
    },
  };
}

const quiet = { info() {}, warning() {} };
const run = (github, directory) =>
  lib.publish({ github, repository: "solmyrhq/x", pr: 7, markerName: "codex-code-review", marker: MARKER, directory, log: quiet });

test("inline comments are posted before the summary, in file order", async () => {
  const github = fakeGitHub();
  const directory = scratch({ comments: [{ body: `${MARKER}\none`, path: "a", line: 1 }, { body: `${MARKER}\ntwo`, path: "b", line: 2 }] });
  assert.deepEqual(await run(github, directory), { failed: false });
  assert.deepEqual(github.calls.map(([method, route, body]) => [method, route, body?.body]), [
    ["POST", "/repos/solmyrhq/x/pulls/7/comments", `${MARKER}\none`],
    ["POST", "/repos/solmyrhq/x/pulls/7/comments", `${MARKER}\ntwo`],
    ["POST", "/repos/solmyrhq/x/issues/7/comments", `${MARKER}\nSummary.`],
    ["GET", "/repos/solmyrhq/x/issues/7/comments", undefined],
  ]);
});

test("a comment that GitHub rejects is added to the summary without its marker", async () => {
  const github = fakeGitHub({ failPosts: [/\/pulls\/7\/comments$/] });
  await run(github, scratch({ comments: [{ body: `${MARKER}\nThe finding.`, path: "a.ts", line: 9 }] }));
  const summary = github.calls.find(([method, route]) => method === "POST" && route.endsWith("/issues/7/comments"))[2].body;
  assert.match(summary, /### Inline comment that could not be posted\n\n`a\.ts` line 9\n\nThe finding\.$/);
  assert.equal(summary.split(MARKER).length, 2, "the marker appears more than once");
});

test("a nominated thread that this review opened on this pull request is resolved", async () => {
  const github = fakeGitHub({ threads: { PRRT_1: thread() } });
  assert.deepEqual(await run(github, scratch({ threads: [{ id: "PRRT_1", reason: "Fixed." }] })), { failed: false });
  assert.ok(github.calls.some(([kind, id]) => kind === "RESOLVE" && id === "PRRT_1"));
});

test("a thread from a person, another review, another pull request, another repository or nowhere is refused", async () => {
  const cases = {
    person: thread({ comments: { nodes: [{ author: { login: "pocketarc" }, body: "<!-- codex-code-review:a:1:1 -->" }] } }),
    opencode: thread({ comments: { nodes: [{ author: { login: "github-actions" }, body: "<!-- opencode-code-review:a:1:1 -->" }] } }),
    elsewhere: thread({ pullRequest: { number: 8, repository: { nameWithOwner: "solmyrhq/x" } } }),
    otherRepository: thread({ pullRequest: { number: 7, repository: { nameWithOwner: "solmyrhq/y" } } }),
    missing: null,
  };
  for (const [name, node] of Object.entries(cases)) {
    const github = fakeGitHub({ threads: { PRRT_1: node } });
    assert.deepEqual(await run(github, scratch({ threads: [{ id: "PRRT_1", reason: "x" }] })), { failed: true }, name);
    assert.ok(!github.calls.some(([kind]) => kind === "RESOLVE"), `${name} was resolved`);
  }
});

test("a thread that is already resolved is left alone and is not a failure", async () => {
  const github = fakeGitHub({ threads: { PRRT_1: thread({ isResolved: true }) } });
  assert.deepEqual(await run(github, scratch({ threads: [{ id: "PRRT_1", reason: "x" }] })), { failed: false });
  assert.ok(!github.calls.some(([kind]) => kind === "RESOLVE"));
});

test("the run fails when no posted summary starts with this run's marker", async () => {
  const github = fakeGitHub({ posted: [{ user: { login: "github-actions[bot]" }, body: "<!-- codex-code-review:old:1:1 -->" }] });
  await assert.rejects(run(github, scratch()), /No summary comment/);
  const impostor = fakeGitHub({ posted: [{ user: { login: "someone" }, body: `${MARKER}\nx` }] });
  await assert.rejects(run(impostor, scratch()), /No summary comment/);
});

test("the client follows the next link until the last page", async () => {
  const pages = {
    "https://api.test/r?per_page=100": { link: '<https://api.test/r?page=2>; rel="next", <https://api.test/r?page=2>; rel="last"', body: [1, 2] },
    "https://api.test/r?page=2": { link: '<https://api.test/r?per_page=100>; rel="first"', body: [3] },
  };
  const fetch = async (url) => ({
    ok: true,
    headers: new Headers({ link: pages[url].link }),
    text: async () => JSON.stringify(pages[url].body),
  });
  const github = lib.client({ token: "t", apiUrl: "https://api.test", graphqlUrl: "https://api.test/graphql", fetch });
  assert.deepEqual(await github.paginate("/r"), [1, 2, 3]);
});

test("a GraphQL error in a 200 response is raised", async () => {
  const fetch = async () => ({ ok: true, headers: new Headers(), text: async () => JSON.stringify({ errors: [{ message: "nope" }] }) });
  const github = lib.client({ token: "t", apiUrl: "https://api.test", graphqlUrl: "https://api.test/graphql", fetch });
  await assert.rejects(github.graphql("query { x }", {}), /GraphQL error: nope/);
});
