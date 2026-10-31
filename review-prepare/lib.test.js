"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const lib = require("./lib.js");

const REPOSITORY = "solmyrhq/x";

const pull = (overrides = {}) => ({
  number: 7,
  state: "open",
  draft: false,
  head: { sha: "a".repeat(40), repo: { full_name: REPOSITORY } },
  base: { sha: "b".repeat(40) },
  ...overrides,
});

const github = (body) => ({
  routes: [],
  async get(route) {
    this.routes.push(route);
    return body;
  },
});

const run = (gh) => lib.prepare({ github: gh, repository: REPOSITORY, pr: 7, artifactPrefix: "codex-review", run: { id: "42", attempt: "2" } });

test("an open pull request from this repository is reviewed, with its commits and an artifact named after this run", async () => {
  const gh = github(pull());
  assert.deepEqual(await run(gh), {
    review: true,
    prNumber: 7,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    artifact: "codex-review-42-2",
  });
  assert.deepEqual(gh.routes, ["/repos/solmyrhq/x/pulls/7"]);
});

test("a closed pull request, a draft, a fork and a deleted fork are not reviewed", async () => {
  const cases = {
    "it is closed": pull({ state: "closed" }),
    "it is a draft": pull({ draft: true }),
    "it is from a fork": pull({ head: { sha: "a".repeat(40), repo: { full_name: "someone/x" } } }),
  };
  for (const [reason, body] of Object.entries(cases)) {
    assert.deepEqual(await run(github(body)), { review: false, reason }, reason);
  }
  assert.deepEqual(await run(github(pull({ head: { sha: "a".repeat(40), repo: null } }))), { review: false, reason: "it is from a fork" });
});
